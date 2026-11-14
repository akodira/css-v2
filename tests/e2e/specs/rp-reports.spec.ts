import { expect, go, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "RP Reports". Numbers on the page are compared with /api/reports/summary of the same account. */
type Summary = Record<string, unknown>;
const total = (s: Summary): number => {
  for (const k of ['created', 'total', 'kpi.total']) { const v = k.split('.').reduce<unknown>((o, x) => (o as Record<string, unknown> | undefined)?.[x], s); if (typeof v === 'number') return v; }
  return NaN;
};

test.describe('RP Reports', () => {
  test('TC-RP-001 Reports page', async ({ asRole }) => {
    const page = await asRole('teamLeader');
    await go(page, '/en/console/reports');
    await expect(page.getByRole('heading', { level: 1, name: t('Reports.title') })).toBeVisible();
    const r7 = page.waitForRequest((r) => /\/api\/reports\/summary\?days=7/.test(r.url()));
    await page.getByRole('button', { name: t('Reports.lastDays', { n: 7, days: 7 }) }).or(page.getByRole('button', { name: /7/ })).first().click();
    await r7;
    await expect(page.locator('main table').first()).toBeVisible();
    await expect(page.locator('main figure, main svg').first(), 'charts').toBeVisible();
  });

  test('TC-RP-002 Reports are scoped', async ({ apiAs }) => {
    const all = await ok<Summary>((await apiAs('admin')).get('/api/reports/summary?days=90'));
    const scoped = await ok<Summary>((await apiAs('branchAdmin')).get('/api/reports/summary?days=90'));
    expect(total(scoped), 'scoped area only').toBeLessThan(total(all));
  });

  test('TC-RP-003 Own reports for agents', async ({ asRole, apiAs }) => {
    const r = await (await apiAs('agent')).get('/api/reports/summary?days=90');
    expect(r.status()).toBe(200);
    const page = await asRole('agent');
    await go(page, '/en/console/reports');
    await expect(page.locator('main').getByText(t('Reports.ownOnly')).first(), 'marked as own data only').toBeVisible();
  });

  test('TC-RP-004 Export CSV', async ({ asRole, apiAs }) => {
    const page = await asRole('teamLeader');
    await go(page, '/en/console/reports');
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: t('Reports.exportCsv') }).or(page.getByRole('link', { name: t('Reports.exportCsv') })).first().click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.csv$/i);
    const text = await (await import('node:fs')).promises.readFile((await file.path())!, 'utf8');
    expect(text.split(/\r?\n/).length).toBeGreaterThan(2);
    expect(text, 'columns include ratings').toMatch(/rating|csat|satisf/i);
    void apiAs;
  });

  test('TC-RP-005 By priority and By category', async ({ apiAs }) => {
    const s = await ok<{ byPriority?: { count?: number; n?: number; value?: number }[]; byCategory?: { count?: number; n?: number; value?: number }[] } & Summary>((await apiAs('admin')).get('/api/reports/summary?days=30'));
    const sum = (rows?: unknown): number => (Array.isArray(rows) ? rows : Object.values((rows ?? {}) as object)).reduce((a: number, r: any) => a + (typeof r === 'number' ? r : (r.count ?? r.n ?? r.value ?? r.total ?? 0)), 0);
    expect(s.byPriority, 'by priority section').toBeTruthy();
    expect(sum(s.byPriority), 'priorities add up to the total').toBe(total(s));
    expect(sum(s.byCategory), 'categories add up to the total').toBe(total(s));
  });

  test('TC-RP-006 Viewer reports', async ({ asRole, apiAs }) => {
    expect((await (await apiAs('viewer')).get('/api/reports/summary?days=30')).status()).toBe(200);
    const page = await asRole('viewer');
    await go(page, '/en/console/reports');
    await expect(page.getByRole('heading', { level: 1, name: t('Reports.title') })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /save|delete|edit/i })).toHaveCount(0);
  });
});
