import type { Page } from '@playwright/test';
import { expect, go, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "DB Dashboard". The numbers on the page are compared with /api/console/dashboard of the same account. */
const kpi = (page: Page, k: string) => page.locator('main dl > div, main dl').filter({ has: page.locator('dt', { hasText: new RegExp(`^${t(`Dashboard.kpi.${k}`)}$`) }) }).locator('dd').first();
type Dash = Record<string, unknown>;
const num = (d: Dash, ...keys: string[]): number | undefined => {
  for (const k of keys) { const v = k.split('.').reduce<unknown>((o, x) => (o as Record<string, unknown> | undefined)?.[x], d); if (typeof v === 'number') return v; }
  return undefined;
};

async function open(page: Page): Promise<void> {
  await go(page, '/en/console/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: t('Dashboard.title') })).toBeVisible();
  await expect(kpi(page, 'total')).toHaveText(/\d/);
}

test.describe('DB Dashboard', () => {
  test('TC-DB-001 Dashboard numbers', async ({ asRole, apiAs }) => {
    const page = await asRole('admin');
    await open(page);
    const d = await ok<Dash>((await apiAs('admin')).get('/api/console/dashboard'));
    const total = num(d, 'kpi.total', 'total', 'totals.total');
    if (total !== undefined) await expect(kpi(page, 'total')).toHaveText(String(total));
    await expect(page.getByRole('heading', { name: t('Dashboard.trends') })).toBeVisible();
    const fig = page.locator('figure').filter({ has: page.locator('caption') }).first();
    await expect(fig.locator('caption')).toContainText(/Last 30 days: \d+ tickets created, \d+ resolved\./);
    // sum of the trend table = the caption numbers
    const cells = await fig.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => Number(c.textContent))));
    const [, created, resolved] = /: (\d+) tickets created, (\d+) resolved/.exec((await fig.locator('caption').textContent()) ?? '')!.map(Number);
    expect(cells.reduce((s, r) => s + (r[0] ?? 0), 0)).toBe(created);
    expect(cells.reduce((s, r) => s + (r[1] ?? 0), 0)).toBe(resolved);
    await expect(page.getByRole('heading', { name: t('Reports.byPriority') }).or(page.getByText(t('Reports.byPriority'))).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: t('Reports.byCategory') }).or(page.getByText(t('Reports.byCategory'))).first()).toBeVisible();
  });

  test('TC-DB-002 Dashboard is scoped', async ({ apiAs }) => {
    const all = await ok<Dash>((await apiAs('admin')).get('/api/console/dashboard'));
    const scoped = await ok<Dash>((await apiAs('branchAdmin')).get('/api/console/dashboard'));
    const a = num(all, 'kpi.total', 'total', 'totals.total'), s = num(scoped, 'kpi.total', 'total', 'totals.total');
    expect(a, 'admin total').toBeDefined();
    expect(s!, 'scoped total is smaller').toBeLessThan(a!);
  });

  test('TC-DB-003 Dashboard for an agent', async ({ asRole, apiAs }) => {
    const page = await asRole('agent');
    await open(page);
    const all = num(await ok<Dash>((await apiAs('admin')).get('/api/console/dashboard')), 'kpi.total', 'total', 'totals.total');
    const mine = num(await ok<Dash>((await apiAs('agent')).get('/api/console/dashboard')), 'kpi.total', 'total', 'totals.total');
    expect(mine!, 'own area only').toBeLessThanOrEqual(all!);
    await expect(kpi(page, 'total')).toHaveText(String(mine));
  });

  test('TC-DB-004 Last 30 days range', async ({ asRole }) => {
    const page = await asRole('admin');
    await open(page);
    await expect(page.locator('main').getByText(t('Dashboard.last30')).first()).toBeVisible();
    const days = await page.locator('figure').first().locator('table tbody th').allTextContents();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const start = new Date(today.getTime() - 29 * 86_400_000);
    expect(days.at(-1)?.trim(), 'ends today').toBe(iso(today));
    expect([iso(start), iso(new Date(start.getTime() - 86_400_000))], 'starts 30 days back').toContain(days[0]?.trim());
  });

  test('TC-DB-005 Viewer dashboard', async ({ asRole, apiAs }) => {
    const page = await asRole('viewer');
    await open(page);
    const admin = num(await ok<Dash>((await apiAs('admin')).get('/api/console/dashboard')), 'kpi.total', 'total', 'totals.total');
    await expect(kpi(page, 'total'), 'same numbers as the admin').toHaveText(String(admin));
    await expect(page.locator('main').getByRole('button', { name: /save|edit|delete/i })).toHaveCount(0);
  });
});
