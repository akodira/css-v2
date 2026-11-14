import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as base, expect, request, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, passwordFor, type Role } from './accounts';
import { baseUrl } from './env';

/**
 * Sign-in rate limit. The API allows 20 calls to /api/auth/* (sign-in, the refresh of every full page load,
 * sign-out) per 5 minutes per client address. The API trusts X-Forwarded-For from loopback (UseForwardedHeaders),
 * so on the local copy each role gets its own test address (10.77.0.x) and with it its own allowance:
 *  - asRole(role) keeps ONE signed-in page per role for the whole run; move inside it with go() (no reload);
 *  - apiAs(role) gives an API client for the role (the page's token, or one direct API sign-in);
 *  - every /api/auth call is counted per address in results/.auth-calls.json and authBudget() waits before the limit.
 * Plain `page` tests (sign-in cases, rate-limit cases) keep the real address, so the limit itself is still tested.
 * Tokens and cookies live in memory only; nothing secret is written to disk.
 */
const LOG = path.join(__dirname, '..', 'results', '.auth-calls.json');
const WINDOW = 5 * 60_000, LIMIT = 17;
type Key = 'local' | 'helpers' | Role;
const ROLES = Object.keys(ACCOUNTS) as Role[];

/** Test client address of a budget key ('local' = the real address, no header). */
export function ipOf(key: Key): string | null {
  if (key === 'local') return null;
  return key === 'helpers' ? '10.77.1.1' : `10.77.0.${ROLES.indexOf(key) + 1}`;
}
const headersFor = (key: Key): Record<string, string> => { const ip = ipOf(key); return ip ? { 'X-Forwarded-For': ip } : {}; };

function readAll(): Record<string, number[]> {
  try {
    const raw = JSON.parse(fs.readFileSync(LOG, 'utf8')) as Record<string, number[]> | number[];
    const obj = Array.isArray(raw) ? { local: raw } : raw;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.filter((x) => Date.now() - x < WINDOW)]));
  } catch { return {}; }
}
function record(key: Key): void {
  const all = readAll();
  (all[key] ??= []).push(Date.now());
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, JSON.stringify(all));
}

/** Waits until `need` more /api/auth calls of this address fit into the 5-minute window. */
export async function authBudget(need = 2, key: Key = 'local'): Promise<void> {
  for (;;) {
    const log = readAll()[key] ?? [];
    if (log.length + need <= LIMIT) return;
    const wait = WINDOW - (Date.now() - log[0]) + 1_000;
    console.log(`  (waiting ${Math.round(wait / 1000)} s for the sign-in rate limit of ${key})`);
    try { const i = base.info(); i.setTimeout(i.timeout + Math.min(wait, 60_000) + 5_000); } catch { /* outside a test */ }
    await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
  }
}

function watch(ctx: BrowserContext, key: Key, onToken?: (t: string) => void): void {
  ctx.on('request', (r) => { if (r.url().includes('/api/auth/')) record(key); });
  ctx.on('response', async (r) => {
    if (!onToken || !/\/api\/auth\/(sign-in|refresh|mfa|signin-code\/verify)$/.test(new URL(r.url()).pathname) || !r.ok()) return;
    try { const b = await r.json(); if (b?.accessToken) onToken(b.accessToken); } catch { /* not json */ }
  });
}

/** API client with the helper test address (and a token when given). */
export function newApi(token?: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, extraHTTPHeaders: { ...headersFor('helpers'), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}
/** Signs an account in through the API (one auth call on the helper address). Returns the status and the answer. */
export async function signInApi(identifier: string, password: string): Promise<{ status: number; body: Record<string, unknown> }> {
  await authBudget(1, 'helpers');
  const anon = await newApi();
  const r = await anon.post('/api/auth/sign-in', { data: { identifier, password } });
  record('helpers');
  const body = await r.json().catch(() => ({}));
  await anon.dispose();
  return { status: r.status(), body };
}
/** API client signed in as the given account (helper address). */
export async function apiFor(identifier: string, password: string): Promise<APIRequestContext> {
  const r = await signInApi(identifier, password);
  expect(r.status, `sign-in of ${identifier}`).toBe(200);
  expect(r.body.accessToken, 'signed in (no extra step)').toBeTruthy();
  return newApi(r.body.accessToken as string);
}
/** Browser context on the helper address, for pages of throw-away accounts. */
export async function helperContext(browser: import('@playwright/test').Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, extraHTTPHeaders: headersFor('helpers') });
  watch(ctx, 'helpers');
  return ctx;
}

/** Moves inside the single-page app without a reload (a reload costs a refresh call). */
export async function go(page: Page, to: string): Promise<void> {
  if (!page.url().startsWith('http')) { await authBudget(1, keyOf(page)); await page.goto(to); return; }
  // Same page with other query: Angular would keep the old component and its filters, so step out first.
  // Ids count as equal too: /tickets/A -> /tickets/B keeps the same component as well.
  const shape = (p: string) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n');
  if (shape(new URL(page.url()).pathname) === shape(to.split('?')[0])) {
    const h1 = await page.locator('main h1').first().textContent({ timeout: 2_000 }).catch(() => null);
    await page.evaluate(() => { history.pushState(null, '', location.pathname.includes('/help') ? '/en/account' : '/en/help'); dispatchEvent(new PopStateEvent('popstate', { state: null })); });
    await expect.poll(() => page.locator('main h1').first().textContent({ timeout: 1_000 }).catch(() => null), { timeout: 8_000 }).not.toBe(h1);
  }
  await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate', { state: null })); }, to);
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** Full page load (counts against the auth limit). */
export async function open(page: Page, to: string): Promise<void> { await authBudget(1, keyOf(page)); await page.goto(to); }

interface RoleSession { ctx: BrowserContext; page: Page; token: string; at: number }
const pageKeys = new WeakMap<Page, Key>();
const keyOf = (page: Page): Key => pageKeys.get(page) ?? 'local';
let lastPage = null as Page | null;

type WorkerFx = {
  asRole: (role: Role) => Promise<Page>;
  apiAs: (role: Role) => Promise<APIRequestContext>;
};

export const test = base.extend<{ authWatch: void }, WorkerFx & { sessions: Map<Role, RoleSession> }>({
  // Count /api/auth calls of the per-test page too (real address).
  authWatch: [async ({ context }, use, info) => {
    watch(context, 'local'); lastPage = null;
    await use();
    // The role pages are not the test's own page, so attach what they showed when a test fails.
    const lp = lastPage as Page | null;
    if (info.status !== info.expectedStatus && lp && !lp.isClosed()) {
      await info.attach('role-page.png', { body: await lp.screenshot().catch(() => Buffer.from('')), contentType: 'image/png' });
      await info.attach('role-page.txt', { body: `${lp.url()}\n\n${await lp.locator('body').ariaSnapshot().catch(() => '')}`, contentType: 'text/plain' });
    }
  }, { auto: true }],

  sessions: [async ({}, use) => {
    const m = new Map<Role, RoleSession>();
    await use(m);
    for (const s of m.values()) await s.ctx.close().catch(() => undefined);   // sessions live in memory only
  }, { scope: 'worker' }],

  asRole: [async ({ browser, sessions }, use) => {
    await use(async (role) => {
      const have = sessions.get(role);
      if (have && !have.page.isClosed()) { lastPage = have.page; return have.page; }
      const ctx = await browser.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, extraHTTPHeaders: headersFor(role) });
      const s: RoleSession = { ctx, page: await ctx.newPage(), token: '', at: 0 };
      pageKeys.set(s.page, role);
      watch(ctx, role, (tk) => { s.token = tk; s.at = Date.now(); });
      lastPage = s.page;
      await authBudget(2, role);
      await s.page.goto('/en/login');
      await s.page.locator('input[name="email"]').fill(ACCOUNTS[role].email);
      await s.page.locator('input[name="password"]').fill(passwordFor(role));
      await s.page.locator('form').getByRole('button', { name: 'Sign in' }).click();
      await expect(s.page).toHaveURL(ACCOUNTS[role].home);
      await expect.poll(() => s.token, { timeout: 10_000 }).not.toBe('');
      sessions.set(role, s);
      return s.page;
    });
  }, { scope: 'worker' }],

  apiAs: [async ({ sessions }, use) => {
    const made: APIRequestContext[] = [];
    // Roles used only through the API sign in directly (1 auth call instead of 2 for a page). Tokens stay in memory.
    const direct = new Map<Role, { token: string; at: number }>();
    await use(async (role) => {
      let token: string;
      const s = sessions.get(role);
      if (s && !s.page.isClosed()) {
        if (Date.now() - s.at > 12 * 60_000) {        // token lives 15 minutes: refresh through the page's cookie
          await authBudget(1, role);
          await s.page.evaluate(() => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }));
          await expect.poll(() => Date.now() - s.at < 60_000, { timeout: 10_000 }).toBe(true);
        }
        token = s.token;
      } else {
        let d = direct.get(role);
        if (!d || Date.now() - d.at > 12 * 60_000) {
          await authBudget(1, role);
          const anon = await request.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, extraHTTPHeaders: headersFor(role) });
          const r = await anon.post('/api/auth/sign-in', { data: { identifier: ACCOUNTS[role].email, password: passwordFor(role) } });
          record(role);
          const b = await r.json().catch(() => ({}));
          await anon.dispose();
          if (!r.ok() || !b.accessToken) throw new Error(`API sign-in of ${role} failed: ${r.status()}`);
          d = { token: b.accessToken as string, at: Date.now() };
          direct.set(role, d);
        }
        token = d.token;
      }
      const c = await request.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, extraHTTPHeaders: { ...headersFor(role), Authorization: `Bearer ${token}` } });
      made.push(c);
      return c;
    });
    for (const c of made) await c.dispose().catch(() => undefined);
  }, { scope: 'worker' }],
});

export { expect };

/** Skipped placeholder for a case that stays manual; keeps "Not run" in the workbook. */
export const manual = (id: string, title: string, why: string) =>
  test(`${id} ${title}`, async () => { test.skip(true, `Manual: ${why}`); });

/** Unique text so a test can find what it just created. */
export const stamp = (p = 'E2E') => `${p} ${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 1000)}`;
