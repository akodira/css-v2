import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { authBudget, expect, go, helperContext, manual, signInApi, stamp, test } from '../support/fixtures';
import { ok } from '../support/data';
import { baseUrl } from '../support/env';
import { t } from '../support/i18n';

/**
 * Sheet "AC My account". Profile and password changes are made on a throw-away customer (e2e.*@demo.cts.test)
 * created by the admin for this file and deleted at the end, so no real account changes.
 * Its temporary password is generated in memory and never printed or saved.
 */
const pw = () => `Acc-${randomBytes(9).toString('base64url')}7a!`;
let email = '';
let password = '';
let ctx: BrowserContext | null = null;
let page: Page;
let token = '';                                    // in memory only

async function signInFresh(browser: Browser, pass: string): Promise<Page> {
  ctx = await helperContext(browser);
  ctx.on('response', async (r) => {
    if (/\/api\/auth\/(sign-in|refresh)$/.test(new URL(r.url()).pathname) && r.ok()) { const b = await r.json().catch(() => null); if (b?.accessToken) token = b.accessToken; }
  });
  const p = await ctx.newPage();
  await authBudget(2, 'helpers');
  await p.goto('/en/login');
  await p.locator('input[name="email"]').fill(email);
  await p.locator('input[name="password"]').fill(pass);
  await p.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(p).not.toHaveURL(/\/login/);
  return p;
}
async function me(p: Page): Promise<{ fullName: string; phone: string | null; preferredLocale: string }> {
  return (await p.request.get('/api/me', { headers: { Authorization: `Bearer ${token}` } })).json();
}

test.describe('AC My account', () => {
  test.beforeAll(async ({ browser, apiAs }) => {
    const admin = await apiAs('admin');
    const people = await ok<{ orgs: { id: string }[]; branches: { id: string; organizationId: string }[] }>(admin.get('/api/console/people'));
    const b = people.branches[0];
    email = `${stamp('e2e acc').replace(/\s+/g, '.').toLowerCase()}@demo.cts.test`;
    password = pw();
    await ok(admin.post('/api/console/people', { data: { kind: 'customer', fullName: 'E2E Account', email, phone: null, password, organizationId: b.organizationId, branchId: b.id, accountTypeId: null } }));
    page = await signInFresh(browser, password);
  });
  test.afterAll(async ({ apiAs }) => {
    await ctx?.close();
    const admin = await apiAs('admin');
    const all = await ok<{ people: { id: string; email: string | null }[] }>(admin.get('/api/console/people'));
    for (const p of all.people.filter((x) => x.email === email)) await admin.delete(`/api/admin/users/${p.id}`);
  });

  test('TC-AC-001 Edit profile', async () => {
    await go(page, '/en/account');
    await page.locator('input[name="fullName"]').fill('E2E Account Renamed');
    // v2: My account takes the international form (+20...); registration takes 01... only (reported as a mismatch)
    await page.locator('input[name="phone"]').fill(`+2011${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
    await page.locator('#acc-lang').selectOption('ar');
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/me$/.test(r.url()));
    await page.getByRole('button', { name: t('Account.save') }).click();
    const res = await saved;
    expect(res.status(), `save answer: ${(await res.text()).slice(0, 200)}`).toBeLessThan(300);
    await expect.poll(async () => (await me(page)).fullName).toBe('E2E Account Renamed');
    expect((await me(page)).preferredLocale).toBe('ar');
    const header = page.getByRole('link', { name: /E2E Account Renamed/ }).first();       // name in the top bar
    const atOnce = await header.isVisible({ timeout: 3_000 }).catch(() => false);
    await page.reload();                                                                  // check again after a reload
    await expect(header, 'header shows the new name after a reload').toBeVisible();
    expect(atOnce, 'header shows the new name at once (without a reload)').toBe(true);
    await go(page, '/en/account');
  });

  test('TC-AC-002 Account status shown', async () => {
    await go(page, '/en/account');
    await expect(page.locator('main').getByText(t('Account.status'))).toBeVisible();
    await expect(page.locator('main').getByText(t('Status.active')).first()).toBeVisible();
    await expect(page.locator('main').getByText(t('Roles.customer')).first()).toBeVisible();
    await expect(page.locator('#acc-email')).not.toBeEditable();                      // read-only
  });

  test('TC-AC-004 Password strength checklist', async () => {
    await go(page, '/en/account');
    const pwField = page.locator('#pw input[name="password"], input[name="password"]').first();
    await pwField.fill('abc');
    const rule = (k: string) => page.locator('li').filter({ hasText: t(`Auth.password.rules.${k}`, { min: 10 }) });
    await expect(rule('upper')).toContainText('✕');
    await pwField.fill('Abcdefghij1!');
    for (const k of ['length', 'upper', 'lower', 'number', 'special']) await expect(rule(k)).toContainText('✓');
    await pwField.fill('');
  });

  test('TC-AC-005 Notification preferences', async () => {
    await go(page, '/en/account');
    // v1 had email notification choices on My account.
    await expect(page.locator('main').getByText(/notification/i).first(), 'email notification choices on My account').toBeVisible();
  });

  test('TC-AC-006 Language preference', async () => {
    await go(page, '/en/account');
    await page.locator('#acc-lang').selectOption('en');
    if (!(await page.locator('input[name="phone"]').inputValue())) await page.locator('input[name="phone"]').fill(`+2012${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/me$/.test(r.url()));
    await page.getByRole('button', { name: t('Account.save') }).click();
    expect((await saved).status(), 'saved').toBeLessThan(300);
    await page.getByRole('navigation', { name: t('Nav.language') }).first().getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/ar\//);
    await expect.poll(async () => (await me(page)).preferredLocale, { message: 'header language choice is stored for emails', timeout: 5_000 }).toBe('ar');
  });

  test('TC-AC-008 Authenticator section', async () => {
    await go(page, '/en/account');
    await expect(page.getByRole('heading', { name: t('Mfa.title') })).toBeVisible();
    await expect(page.locator('main').getByText(new RegExp(`${t('Mfa.status')}\\s*:?\\s*${t('Mfa.off')}`))).toBeVisible();
    await page.getByRole('button', { name: t('Mfa.turnOn') }).click();                // shows QR and secret; no app to finish
    await expect(page.getByRole('img', { name: t('Mfa.qrAlt') })).toBeVisible();
    await expect(page.getByText(t('Mfa.secretLabel'))).toBeVisible();
    await page.getByRole('button', { name: t('Mfa.cancel') }).click();
    test.info().annotations.push({ type: 'manual part', description: 'finishing enrolment and turning it off need an authenticator app (v2: turning off asks for a current code)' });
  });

  test('TC-AC-003 Change password', async () => {
    await go(page, '/en/account');
    const next = pw();
    await page.locator('input[name="current"]').fill('Wrong-Current-1!');
    await page.locator('input[name="password"]').fill(next);
    await page.locator('input[name="confirmPassword"]').fill(next);
    await authBudget(1, 'helpers');
    await page.getByRole('button', { name: t('Auth.change.submit') }).click();
    await expect(page.getByText(t('Auth.errors.currentWrong'))).toBeVisible();        // wrong current password refused
    await page.locator('input[name="current"]').fill(password);
    await authBudget(1, 'helpers');
    const changed = page.waitForResponse((r) => /\/api\/auth\/change-password$/.test(r.url()));
    await page.getByRole('button', { name: t('Auth.change.submit') }).click();
    const res = await changed;
    expect(res.status(), `change answer: ${(await res.text()).slice(0, 200)}`).toBeLessThan(300);
    await ctx?.close();
    // old password stops working, the new one works
    expect((await signInApi(email, password)).status, 'old password').not.toBe(200);
    expect((await signInApi(email, next)).status, 'new password').toBe(200);
    password = next;
  });
});

test.describe('AC My account (staff)', () => {
  test('TC-AC-007 Staff My account in the console frame', async ({ asRole }) => {
    const p = await asRole('agent');
    await go(p, '/en/console/dashboard');
    await p.getByRole('link', { name: /Agent Banha/ }).first().click();
    await expect(p).toHaveURL(/\/en\/console\/account$/);
    await expect(p.getByRole('heading', { level: 1, name: t('Account.title') })).toBeVisible();
    await expect(p.getByRole('navigation', { name: t('Shell.menu') }).first()).toBeVisible();   // inside the sidebar frame
    await go(p, '/en/account');                                                         // the customer address redirects
    await expect(p).toHaveURL(/\/en\/console\/account$/);
  });
});

