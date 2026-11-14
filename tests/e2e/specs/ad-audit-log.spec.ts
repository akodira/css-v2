import { expect, go, stamp, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "AD Audit log". The change is made on an E2E team that is deleted again.
 * v2 (security audit): management viewers see the audit field names but not the values.
 */
test.describe('AD Audit log', () => {
  test('TC-AD-001 Audit entries', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const name = stamp('E2E audit team');
    await ok(admin.post('/api/admin/teams', { data: { nameEn: name, nameAr: name, isActive: true } }));
    const team = (await ok<{ teams: { id: string; nameEn: string }[] }>(admin.get('/api/admin/teams'))).teams.find((x) => x.nameEn === name)!;
    await admin.delete(`/api/admin/teams/${team.id}`);
    const page = await asRole('admin');
    await go(page, '/en/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: t('AuditLog.title') })).toBeVisible();
    const row = page.locator('main tbody tr').filter({ hasText: /team/i }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(ACCOUNTS_NAME);                                  // who
    await expect(row.locator('td').first()).toHaveText(/\d/);                         // when
    const viewer = await asRole('viewer');                                             // v2: names, not values
    await go(viewer, '/en/admin/audit');
    await expect(viewer.locator('main tbody tr').first()).toBeVisible();
    await expect(viewer.locator('main')).not.toContainText(name);
  });

  test('TC-AD-002 Filter by type', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/audit');
    const sel = page.getByLabel(t('AuditLog.filterType'));
    const values = await sel.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    test.skip(!values.length, 'no audit types');
    const pick = values.find((v) => /team|ticket|user/.test(v)) ?? values[0];
    await sel.selectOption(pick);
    await page.getByRole('button', { name: t('AuditLog.apply') }).click();
    const rows = page.locator('main tbody tr');
    await expect(rows.first()).toBeVisible();
    const kind = pick.split(/[._]/)[0];
    for (const r of (await rows.all()).slice(0, 5)) await expect(r, `row of type ${pick}`).toContainText(new RegExp(kind, 'i'));
  });

  test('TC-AD-003 Paging', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/audit');
    const next = page.getByRole('button', { name: t('AuditLog.next') });
    test.skip(!(await next.count()), 'only one page of entries');
    const first = await page.locator('main tbody tr').first().innerText();
    await next.click();
    await expect(page.locator('main').getByText(/Page 2 of \d+/)).toBeVisible();
    await expect.poll(() => page.locator('main tbody tr').first().innerText()).not.toBe(first);
    await page.getByRole('button', { name: t('AuditLog.previous') }).click();
    await expect(page.locator('main').getByText(/Page 1 of \d+/)).toBeVisible();
  });
});

const ACCOUNTS_NAME = 'Demo Admin';
