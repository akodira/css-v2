import type { APIRequestContext } from '@playwright/test';
import { expect, go, manual, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "OR Organizations, branches". New organizations and branches are named "E2E ..." and deleted at the end
 * (they have no people or tickets). Existing ones are only read.
 */
interface Org { id: string; name: string; isActive: boolean; teamLeaderId: string | null; customers: number; branches: { id: string; name: string; isActive: boolean; teamLeaderId: string | null }[] }
const orgs = (admin: APIRequestContext) => ok<Org[]>(admin.get('/api/admin/organizations'));
async function newOrg(admin: APIRequestContext): Promise<Org> {
  const name = stamp('E2E org');
  await ok(admin.post('/api/admin/organizations', { data: { name, location: null, phone: null, teamLeaderId: null, isActive: true, sharedAccessEnabled: false } }));
  return (await orgs(admin)).find((o) => o.name === name)!;
}
async function dropOrg(admin: APIRequestContext, o: Org): Promise<void> {
  const now = (await orgs(admin)).find((x) => x.id === o.id);
  for (const b of now?.branches ?? []) await admin.delete(`/api/admin/branches/${b.id}`);
  await admin.delete(`/api/admin/organizations/${o.id}`);
}
const head = (page: import('@playwright/test').Page, name: string) => page.locator('main h2 button[aria-expanded], main h3 button[aria-expanded]').filter({ hasText: name }).first();

test.describe('OR Organizations, branches', () => {
  test('TC-OR-001 Add an organization', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const name = stamp('E2E org');
    try {
      const page = await asRole('admin');
      await go(page, '/en/admin/organizations');
      await page.getByRole('button', { name: t('AdminOrgs.addOrgBtn') }).click();
      await page.getByLabel(t('Directory.orgName')).filter({ visible: true }).first().fill(name);
      await page.getByRole('button', { name: t('Directory.addOrganization'), exact: true }).filter({ visible: true }).first().click();
      await expect.poll(async () => (await orgs(admin)).some((x) => x.name === name), 'listed').toBe(true);
      test.info().annotations.push({ type: 'v2', description: 'v2 has no parent field when adding an organization (see TC-OR-006)' });
    } finally {
      const o = (await orgs(admin)).find((x) => x.name === name);
      if (o) await dropOrg(admin, o);
    }
  });

  test('TC-OR-002 Add a branch', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const o = await newOrg(admin);
    const name = stamp('E2E branch');
    try {
      const page = await asRole('admin');
      await go(page, '/en/admin/organizations');
      await page.getByRole('button', { name: t('AdminOrgs.addBranchBtn') }).click();
      await page.locator('#branch-parent').selectOption(o.id);
      await page.getByLabel(t('Directory.branchName')).filter({ visible: true }).first().fill(name);
      await page.getByRole('button', { name: t('Directory.addBranch'), exact: true }).filter({ visible: true }).first().click();
      await expect.poll(async () => (await orgs(admin)).find((x) => x.id === o.id)?.branches.map((b) => b.name)).toEqual([name]);
      await head(page, o.name).click();
      await expect(page.locator('main').getByText(name).first()).toBeVisible();
    } finally { await dropOrg(admin, o); }
  });

  test('TC-OR-003 Edit details', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const o = await newOrg(admin);
    try {
      const page = await asRole('admin');
      await go(page, '/en/admin/organizations');
      await page.locator('#acc-q').fill(o.name);
      await head(page, o.name).click();
      const panel = page.locator('main [id^="acc-"]').filter({ has: page.locator('summary', { hasText: t('Directory.editDetails') }) }).first();
      await panel.locator('summary', { hasText: t('Directory.editDetails') }).click();
      await panel.locator('input[name="loc"]').first().fill('E2E location');
      await panel.getByRole('button', { name: t('Directory.saveChanges') }).first().click();
      await expect.poll(async () => ((await orgs(admin)).find((x) => x.id === o.id) as unknown as { location: string }).location).toBe('E2E location');
    } finally { await dropOrg(admin, o); }
  });

  test('TC-OR-004 Deactivate', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const o = await newOrg(admin);
    try {
      const before = await ok<{ organizations: { id: string }[] }>(admin.get('/api/site/signup-options'));
      expect(before.organizations.map((x) => x.id)).toContain(o.id);
      await ok(admin.put(`/api/admin/organizations/${o.id}`, { data: { name: o.name, location: null, phone: null, teamLeaderId: null, isActive: false, sharedAccessEnabled: false } }));
      const after = await ok<{ organizations: { id: string }[] }>(admin.get('/api/site/signup-options'));
      expect(after.organizations.map((x) => x.id), 'hidden from new registrations').not.toContain(o.id);
    } finally { await dropOrg(admin, o); }
  });

  test('TC-OR-005 Customers inside', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const dir = await ok<{ email: string; organizationName: string | null }[]>(admin.get('/api/tickets/customers'));
    const orgName = dir.find((x) => x.email.toLowerCase() === ACCOUNTS.customer.email)!.organizationName!;
    const page = await asRole('admin');
    await go(page, '/en/admin/organizations');
    await page.locator('#acc-q').fill(orgName);
    await head(page, orgName).click();
    await expect(page.locator('main').getByText(ACCOUNTS.customer.name).first()).toBeVisible();
  });

  test('TC-OR-006 Hierarchy', async ({ asRole, apiAs }) => {
    // Children count for Organization admins (HCWW covers Cairo, Giza, Al-Qalyubia: see TC-PS-006) ...
    const covered = await ok<{ orgs: { name: string }[] }>((await apiAs('hcwwAdmin')).get('/api/console/people'));
    expect(covered.orgs.map((o) => o.name).join('|')).toMatch(/Cairo/);
    // ... but the parent must be settable on the Organizations page.
    const page = await asRole('admin');
    await go(page, '/en/admin/organizations');
    await page.getByRole('button', { name: t('AdminOrgs.addOrgBtn') }).click();
    await expect(page.locator('main').getByLabel(/parent/i), 'a parent organization field').toBeVisible();
  });

  test('TC-OR-007 Escalation leader per organization', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const withLeader = (await orgs(admin)).find((o) => o.teamLeaderId && o.isActive);
    test.skip(!withLeader, 'no organization has a leader set');
    const page = await asRole('admin');
    await go(page, '/en/admin/organizations');
    await page.locator('#acc-q').fill(withLeader!.name);
    await head(page, withLeader!.name).click();
    const panel = page.locator('main [id^="acc-"]').first();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(t('Directory.noLeader'), { exact: true }), 'shows the leader name').toHaveCount(0);
  });

  manual('TC-OR-008', 'Branch leader overrides', 'needs leaders set on an organization and one of its branches and an escalation to watch');
});
