import { expect, go, manual, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "AP Account approvals". Approving or rejecting needs a customer who registered AND confirmed the email
 * (mailbox), and acting on real waiting customers would change real data, so those two stay manual.
 */
interface Pending { id: string; email: string; organizationId: string | null; branchId: string | null }

test.describe('AP Account approvals', () => {
  test('TC-AP-001 Pending list', async ({ asRole, apiAs }) => {
    const page = await asRole('admin');
    await go(page, '/en/console/approvals');
    await expect(page.getByRole('heading', { level: 1, name: t('Approvals.title') })).toBeVisible();
    const pending = await ok<Pending[]>((await apiAs('admin')).get('/api/admin/users?kind=pending'));
    if (pending.length) {
      await expect(page.locator('main').getByText(t('Approvals.count', { n: pending.length }))).toBeVisible();
      for (const p of pending.slice(0, 5)) await expect(page.locator('main').getByText(p.email).first()).toBeVisible();
      const item = page.getByRole('navigation', { name: t('Shell.menu') }).first().getByRole('link', { name: new RegExp(t('Approvals.title'), 'i') });
      if (await item.count()) await expect(item.first(), 'menu count = list').toContainText(String(pending.length));
    } else {
      await expect(page.locator('main').getByText(t('Approvals.empty'))).toBeVisible();
    }
  });

  manual('TC-AP-002', 'Approve an account', 'needs a confirmed waiting customer (registration + mailbox); approving real waiting customers changes real data');
  manual('TC-AP-003', 'Reject an account', 'needs a confirmed waiting customer (registration + mailbox); rejecting closes the account');

  test('TC-AP-004 Approved accounts history', async ({ asRole, apiAs }) => {
    const page = await asRole('admin');
    await go(page, '/en/console/approvals');
    const h = page.locator('#approved-h');
    await h.scrollIntoViewIfNeeded();
    await expect(h).toHaveText(new RegExp(t('Approvals.approvedTitle')));
    const approved = await ok<unknown[]>((await apiAs('admin')).get('/api/admin/approved'));
    test.skip(!approved.length, 'no approved customers yet');
    await expect(page.locator('main').getByText(t('Approvals.approvedCount', { n: approved.length })).first(), 'approved list').toBeVisible();
    await expect(page.locator('main').getByText(t('Approvals.approvedSubtitle')).first(), 'shows who approved and when').toBeVisible();
  });

  test('TC-AP-005 Scoped approver', async ({ asRole, apiAs }) => {
    const branch = await apiAs('branchAdmin');
    const r = await branch.get('/api/admin/users?kind=pending');
    expect(r.status(), 'branch admin may approve').toBe(200);
    const mine = (await r.json()) as Pending[];
    const people = await ok<{ branches: { id: string }[] }>(branch.get('/api/console/people'));
    const allowed = new Set(people.branches.map((b) => b.id));
    for (const p of mine) expect(p.branchId && allowed.has(p.branchId), `${p.email} is in the admin's branches`).toBeTruthy();
    const all = await ok<Pending[]>((await apiAs('admin')).get('/api/admin/users?kind=pending'));
    expect(mine.length).toBeLessThanOrEqual(all.length);
    const page = await asRole('branchAdmin');
    await go(page, '/en/console/approvals');
    await expect(page.getByRole('heading', { level: 1, name: t('Approvals.title') })).toBeVisible();
    for (const p of all.filter((x) => !mine.some((m) => m.id === x.id)).slice(0, 5)) await expect(page.locator('main').getByText(p.email)).toHaveCount(0);
  });

  test('TC-AP-006 Approve permission', async ({ asRole, apiAs }) => {
    expect((await (await apiAs('agent')).get('/api/admin/users?kind=pending')).status()).toBe(403);
    const page = await asRole('agent');
    await go(page, '/en/console/approvals');
    await expect(page.locator('main').getByText(t('Approvals.empty'))).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: t('Shell.menu') }).first().getByRole('link', { name: t('Approvals.title') })).toHaveCount(0);
    const notAvailable = page.getByRole('alert').or(page.locator('main').getByText(/not allowed|not available|access/i));
    await expect(notAvailable.first().or(page.locator('main h1').filter({ hasNotText: t('Approvals.title') }))).toBeVisible();
  });
});
