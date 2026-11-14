import { randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, go, manual, signInApi, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { customerId, ok, ticket, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "CM Customers". Account changes are made on throw-away customers (e2e.*@demo.cts.test) created here; they are
 * deleted at the end, or left suspended when they have tickets (history cannot be deleted).
 */
const newEmail = () => `${stamp('e2e cust').replace(/\s+/g, '.').toLowerCase()}@demo.cts.test`;
const tempPw = () => `Cus-${randomBytes(9).toString('base64url')}5c!`;

async function makeCustomer(admin: APIRequestContext): Promise<{ id: string; email: string; pw: string }> {
  const ctx = await ok<{ branches: { id: string; organizationId: string; name: string }[] }>(admin.get('/api/console/people'));
  const b = ctx.branches.find((x) => /banha/i.test(x.name)) ?? ctx.branches[0];
  const email = newEmail(), pw = tempPw();
  const r = await ok<{ id: string }>(admin.post('/api/console/people', { data: { kind: 'customer', fullName: 'E2E Customer', email, phone: null, password: pw, organizationId: b.organizationId, branchId: b.id, accountTypeId: null } }));
  return { id: r.id, email, pw };
}
async function drop(admin: APIRequestContext, id: string): Promise<void> {
  const r = await admin.delete(`/api/admin/users/${id}`);
  if (!r.ok()) await admin.post(`/api/console/people/${id}/status`, { data: { status: 'suspended' } });
}
const signInStatus = async (email: string, password: string) => (await signInApi(email, password)).status;

test.describe('CM Customers', () => {
  test('TC-CM-001 Customer list', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/console/customers');
    await expect(page.getByRole('heading', { level: 1, name: t('Customers.title') })).toBeVisible();
    for (const k of ['name', 'email', 'organization', 'branch', 'statusHeader', 'registered', 'tickets'])
      await expect(page.locator('main thead').getByText(t(`Customers.${k}`), { exact: true }).first(), k).toBeVisible();
    await page.locator('#cq').fill(ACCOUNTS.customer.name);
    await page.getByRole('button', { name: t('Customers.searchButton') }).click();
    await expect(page.locator('main tbody tr').filter({ hasText: ACCOUNTS.customer.email })).toHaveCount(1);
    await expect(page.locator('main tbody tr').filter({ hasText: 'hesham.banha' })).toHaveCount(0);
  });

  test('TC-CM-002 Customer list is scoped', async ({ asRole, apiAs }) => {
    const all = await ok<{ email: string }[]>((await apiAs('admin')).get('/api/admin/users?kind=customers'));
    const branch = await ok<{ email: string; phone?: string | null }[]>((await apiAs('branchAdmin')).get('/api/admin/users?kind=customers'));
    expect(branch.length, 'fewer than the admin').toBeLessThan(all.length);
    expect(branch.map((x) => x.email)).not.toContain(ACCOUNTS.customer.email);      // Banha customer outside Nasr City
    const page = await asRole('teamLeader');
    await go(page, '/en/console/customers');
    await expect(page.getByRole('heading', { level: 1, name: t('Customers.title') })).toBeVisible();
  });

  test('TC-CM-003 Customer profile', async ({ asRole, apiAs }) => {
    const id = await customerId(await apiAs('admin'), ACCOUNTS.customer.email);
    const page = await asRole('admin');
    await go(page, `/en/console/customers/${id}`);
    await expect(page.locator('main h1')).toContainText(ACCOUNTS.customer.name);
    await expect(page.locator('main').getByText(ACCOUNTS.customer.email).first()).toBeVisible();
    await expect(page.locator('main').getByText(t('Customers.status.active')).first()).toBeVisible();
    await expect(page.locator('main').getByText(/CTS-\d{4}-\d{6}/).first(), 'tickets listed').toBeVisible();
  });

  test('TC-CM-004 Add a customer', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const c = await makeCustomer(admin);
    try {
      const list = await ok<{ email: string }[]>(admin.get(`/api/admin/users?kind=customers&q=${encodeURIComponent(c.email)}`));
      expect(list.map((x) => x.email)).toContain(c.email);
      expect(await signInStatus(c.email, c.pw), 'temporary password works').toBe(200);
    } finally { await drop(admin, c.id); }
  });

  manual('TC-CM-005', 'Edit a customer and move branch', 'moving a customer with tickets between branches; check the ticket history by hand');

  test('TC-CM-006 Suspend and reactivate', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const c = await makeCustomer(admin);
    try {
      await ok(admin.post(`/api/console/people/${c.id}/status`, { data: { status: 'suspended' } }));
      expect(await signInStatus(c.email, c.pw), 'refused while suspended').not.toBe(200);
      await ok(admin.post(`/api/console/people/${c.id}/status`, { data: { status: 'active' } }));
      expect(await signInStatus(c.email, c.pw), 'works again').toBe(200);
    } finally { await drop(admin, c.id); }
  });

  test('TC-CM-007 Delete a customer with tickets', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const c = await makeCustomer(admin);
    await ticketFor(admin, c.email);
    const r = await admin.delete(`/api/admin/users/${c.id}`);
    expect(r.status(), 'refused: suspend instead').toBe(409);
    await admin.post(`/api/console/people/${c.id}/status`, { data: { status: 'suspended' } });
  });

  test('TC-CM-008 Customer to staff and back', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const c = await makeCustomer(admin);
    const tk = await ticketFor(admin, c.email);
    await ok(admin.post(`/api/admin/users/${c.id}/promote`, { data: { role: 'agent', accountTypeId: null, teamId: null } }));
    const staff = await ok<{ staff: { email: string; roles: string[] }[] }>(admin.get('/api/admin/staff'));
    expect(staff.staff.find((s) => s.email === c.email)?.roles).toContain('agent');
    await ok(admin.post(`/api/admin/users/${c.id}/demote`, {}));
    expect((await ticket(admin, tk.id)).requesterId, 'ticket history kept').toBe(c.id);
    const after = await ok<{ staff: { email: string }[] }>(admin.get('/api/admin/staff'));
    expect(after.staff.map((s) => s.email)).not.toContain(c.email);
    await admin.post(`/api/console/people/${c.id}/status`, { data: { status: 'suspended' } });
  });

  test('TC-CM-009 Customer export', async ({ asRole }) => {
    const page = await asRole('teamLeader');
    await go(page, '/en/console/customers');
    await expect(page.getByRole('heading', { level: 1, name: t('Customers.title') })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: /export|csv/i }).or(page.locator('main').getByRole('link', { name: /export|csv/i })).first(),
      'export of the customer list (leader has "Export data")').toBeVisible();
  });

  test('TC-CM-010 Customers menu opens the right page', async ({ asRole }) => {
    const page = await asRole('teamLeader');
    await go(page, '/en/console/dashboard');
    const menu = page.getByRole('navigation', { name: t('Shell.menu') }).first();
    for (const group of await menu.getByRole('button').all()) if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await menu.getByRole('link', { name: t('Shell.customers'), exact: true }).first().click();
    await expect(page).toHaveURL(/\/en\/console\/customers$/);
  });
});
