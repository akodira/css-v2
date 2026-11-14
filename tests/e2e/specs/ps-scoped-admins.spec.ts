import { randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiFor, expect, go, manual, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "PS Scoped admins". New accounts are made with e2e.*@demo.cts.test addresses and deleted again at the end of
 * the test. Their temporary passwords are generated in memory (by the page's Generate button or here) and never
 * printed or saved.
 */
interface Lookups { orgs: { id: string; name: string }[]; branches: { id: string; organizationId: string; name: string }[] }
interface StaffRow { id: string; email: string; typeNameEn: string | null; access: { org: string; branch: string | null }[] }

const newEmail = () => `${stamp('e2e').replace(/\s+/g, '.').toLowerCase()}@demo.cts.test`;
const tempPassword = () => `E2e-${randomBytes(9).toString('base64url')}-9a!`;

async function lookups(admin: APIRequestContext): Promise<Lookups> { return ok(admin.get('/api/admin/lookups')); }
async function staffRow(admin: APIRequestContext, email: string): Promise<StaffRow | undefined> {
  const d = await ok<{ staff: StaffRow[] }>(admin.get('/api/admin/staff'));
  return d.staff.find((s) => s.email.toLowerCase() === email.toLowerCase());
}
async function removeUser(admin: APIRequestContext, email: string): Promise<void> {
  const row = await staffRow(admin, email);
  if (row) await admin.delete(`/api/admin/users/${row.id}`);
}
/** Signs the new account in through the API (one auth call on the helper address). */
const signIn = apiFor;

async function openAdd(page: Page): Promise<void> {
  await go(page, '/en/admin/users');
  const box = page.locator('details').filter({ has: page.locator('summary', { hasText: t('Directory.addStaff') }) });
  if (!(await box.getAttribute('open').then((v) => v !== null))) await box.locator('summary').click();
}
const scopedCard = (page: Page, k: 'organization' | 'branch') => page.locator('label').filter({ hasText: t(`RoleGuide.${k}_admin.title`) }).locator('input[type=checkbox]');
const roleCard = (page: Page, r: string) => page.locator('label').filter({ has: page.locator('span', { hasText: new RegExp(`^${t(`Roles.${r}`)}$`) }) }).locator('input[type=checkbox]').first();

async function fillNew(page: Page, email: string): Promise<string> {
  await page.locator('input[name="n"]').first().fill('E2E Scoped Admin');
  await page.locator('input[name="e"]').first().fill(email);
  await page.getByRole('button', { name: t('Directory.generate') }).click();
  return page.locator('#nw-pw').inputValue();                                   // kept in memory only
}

test.describe('PS Scoped admins', () => {
  for (const [id, kind, place, title] of [
    ['TC-PS-001', 'organization', 'Cairo', 'Create an Organization admin'],
    ['TC-PS-002', 'branch', 'Nasr City', 'Create a Branch admin'],
  ] as const) {
    test(`${id} ${title}`, async ({ asRole, apiAs }) => {
      const admin = await apiAs('admin');
      const email = newEmail();
      try {
        const page = await asRole('admin');
        await openAdd(page);
        const pw = await fillNew(page, email);
        await scopedCard(page, kind).check();
        await page.getByRole('searchbox', { name: t(kind === 'organization' ? 'RoleGuide.searchOrgs' : 'RoleGuide.searchBranches') }).fill(place);
        await page.locator('label').filter({ hasText: new RegExp(`^\\s*${place}\\s*$`) }).locator('input[type=checkbox]').first().check();
        await page.getByRole('button', { name: t('Directory.create'), exact: true }).click();
        await expect(page.getByText(new RegExp(`^Created ${email.replace(/\./g, '\\.')}\\.`))).toBeVisible();
        const row = await staffRow(admin, email);
        expect(row, 'created in one step').toBeTruthy();
        expect(row!.typeNameEn ?? '').toMatch(kind === 'organization' ? /organi[sz]ation admin/i : /branch admin/i);
        expect(row!.access.map((a) => (kind === 'organization' ? a.org : a.branch))).toEqual([place]);
        const me = await signIn(email, pw);
        const people = await ok<{ orgs: { name: string }[]; branches: { name: string }[] }>(me.get('/api/console/people'));
        if (kind === 'branch') expect(people.branches.map((b) => b.name)).toEqual([place]);
        else expect(people.orgs.map((o) => o.name)).toContain(place);
        await me.dispose();
      } finally { await removeUser(admin, email); }
    });
  }

  test('TC-PS-003 Scope is required', async ({ asRole, apiAs }) => {
    const email = newEmail();
    const page = await asRole('admin');
    await openAdd(page);
    await fillNew(page, email);
    await scopedCard(page, 'organization').check();
    await page.getByRole('button', { name: t('Directory.create'), exact: true }).click();
    await expect(page.getByText(t('AdminCommon.errors.scopeRequired'))).toBeVisible();
    expect(await staffRow(await apiAs('admin'), email), 'nothing created').toBeUndefined();
  });

  test('TC-PS-004 Scoped cards are exclusive', async ({ asRole }) => {
    const page = await asRole('admin');
    await openAdd(page);
    const agent = roleCard(page, 'agent');
    if (!(await agent.isChecked())) await agent.check();
    await scopedCard(page, 'branch').check();
    await expect(agent).not.toBeChecked();
    await scopedCard(page, 'organization').check();
    await expect(scopedCard(page, 'branch')).not.toBeChecked();
    await agent.check();
    await expect(scopedCard(page, 'organization')).not.toBeChecked();
    await expect(scopedCard(page, 'branch')).not.toBeChecked();
  });

  test('TC-PS-005 Search and Select all', async ({ asRole }) => {
    const page = await asRole('admin');
    await openAdd(page);
    await scopedCard(page, 'branch').check();
    const picker = page.locator('h3', { hasText: t('RoleGuide.scopeBranchTitle') }).locator('..');
    await picker.getByRole('searchbox').fill('Cairo');
    const groups = picker.getByRole('button', { name: t('RoleGuide.selectAll'), exact: true });
    await expect(groups.first()).toBeVisible();
    const boxes = picker.locator('label input[type=checkbox]');
    const shown = await boxes.count();
    await groups.first().click();
    const chips = picker.getByRole('button', { name: /^Remove / });
    const chosen = await chips.count();
    expect(chosen, 'select all ticks the shown rows of that organization').toBeGreaterThan(0);
    expect(chosen).toBeLessThanOrEqual(shown);
    await chips.first().click();                                                   // a chip can be removed
    await expect(chips).toHaveCount(chosen - 1);
    await picker.getByRole('button', { name: t('RoleGuide.clear'), exact: true }).click();
    await expect(picker.getByText(t('RoleGuide.none'))).toBeVisible();
  });

  test('TC-PS-006 Child organizations covered', async ({ asRole, apiAs }) => {
    const me = await apiAs('hcwwAdmin');
    const people = await ok<{ orgs: { name: string }[] }>(me.get('/api/console/people'));
    const names = people.orgs.map((o) => o.name).join(' | ');
    for (const n of ['Cairo', 'Giza', 'Qalyubia']) expect(names, n).toMatch(new RegExp(n, 'i'));
    const page = await asRole('hcwwAdmin');
    await go(page, '/en/console/people');
    await expect(page.getByRole('heading', { level: 1, name: t('People.title') })).toBeVisible();
  });

  test('TC-PS-007 Org admin outside the scope', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const l = await lookups(admin);
    const sara = (await ok<{ id: string; email: string; organizationId: string }[]>(admin.get('/api/tickets/customers'))).find((x) => x.email.toLowerCase() === ACCOUNTS.customer.email)!;
    const cairo = await apiAs('orgAdmin');
    expect([403, 404]).toContain((await cairo.get(`/api/console/customers/${sara.id}`)).status());
    const email = newEmail();
    const r = await cairo.post('/api/console/people', { data: { kind: 'customer', fullName: 'E2E Outside', email, phone: null, password: tempPassword(), organizationId: sara.organizationId, branchId: null, accountTypeId: null } });
    expect(r.status(), 'create outside the scope').toBe(403);
    void l;
  });

  test('TC-PS-008 Branch admin sees only the branch', async ({ asRole, apiAs }) => {
    const me = await apiAs('branchAdmin');
    const people = await ok<{ branches: { id: string; name: string }[]; people: { email: string; branchId: string | null }[] }>(me.get('/api/console/people'));
    expect(people.branches.map((b) => b.name)).toEqual(['Nasr City']);
    expect(people.people.length).toBeGreaterThan(0);
    for (const p of people.people) expect(p.branchId, p.email).toBe(people.branches[0].id);
    const page = await asRole('branchAdmin');
    await go(page, '/en/console/people');
    await expect(page.getByRole('heading', { level: 1, name: t('People.title') })).toBeVisible();
    await expect(page.locator('main').getByText(ACCOUNTS.customer.name)).toHaveCount(0);   // Banha customer not listed
  });

  test('TC-PS-009 Add people inside the scope', async ({ asRole, apiAs }) => {
    test.setTimeout(90_000);
    const admin = await apiAs('admin');
    const me = await apiAs('branchAdmin');
    const ctx = await ok<{ orgs: { id: string }[]; branches: { id: string; organizationId: string; name: string }[]; types: { id: string; scopeLevel: string | null }[] }>(me.get('/api/console/people'));
    const branch = ctx.branches[0];
    const cust = newEmail(), staff = newEmail();
    try {
      const page = await asRole('branchAdmin');
      await go(page, '/en/console/people');
      const add = page.locator('details').filter({ has: page.locator('summary', { hasText: t('People.add') }) });
      if ((await add.count()) && (await add.getAttribute('open')) === null) await add.locator('summary').click();
      await page.getByRole('group', { name: t('People.kind') }).getByRole('button', { name: t('People.kindCustomer') }).click();
      await page.locator('#pp-n').fill('E2E Inside Customer');
      await page.locator('#pp-e').fill(cust);
      if (await page.locator('#pp-o').isEnabled()) await page.locator('#pp-o').selectOption(branch.organizationId);
      await page.locator('#pp-b').selectOption(branch.id);
      await page.getByRole('button', { name: t('People.generate') }).click();
      await page.getByRole('button', { name: t('People.create'), exact: true }).click();
      await expect.poll(async () => (await ok<{ people: { email: string | null }[] }>(me.get('/api/console/people'))).people.some((p) => p.email === cust)).toBe(true);
      const dir = await ok<{ email: string; organizationId: string; branchId: string | null }[]>(admin.get('/api/tickets/customers'));
      const made = dir.find((x) => x.email === cust)!;
      expect([made.organizationId, made.branchId]).toEqual([branch.organizationId, branch.id]);
      const type = ctx.types.find((x) => !x.scopeLevel) ?? ctx.types[0];
      test.skip(!type, 'no account type this admin may give');
      const r = await me.post('/api/console/people', { data: { kind: 'staff', fullName: 'E2E Inside Agent', email: staff, phone: null, password: tempPassword(), organizationId: branch.organizationId, branchId: branch.id, accountTypeId: type.id } });
      expect(r.ok(), `agent in scope: ${r.status()}`).toBeTruthy();
    } finally {
      const all = await ok<{ people: { id: string; email: string | null }[] }>(admin.get('/api/console/people'));
      for (const p of all.people.filter((x) => x.email === cust || x.email === staff)) await admin.delete(`/api/admin/users/${p.id}`);
    }
  });

  manual('TC-PS-010', 'Approve inside the scope', 'needs customers waiting for approval (registration with a mailbox)');

  test('TC-PS-011 Tickets inside the scope', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    await ticketFor(admin, ACCOUNTS.customer.email);                                // a Banha ticket that must stay hidden
    const dir = await ok<{ email: string; branchName: string | null }[]>(admin.get('/api/tickets/customers'));
    const branchOf = new Map(dir.map((x) => [x.email.toLowerCase(), x.branchName]));
    const list = await ok<{ items: { requesterEmail: string }[] }>((await apiAs('branchAdmin')).get('/api/tickets?page=1&pageSize=100'));
    for (const it of list.items) expect(branchOf.get(it.requesterEmail.toLowerCase()), it.requesterEmail).toBe('Nasr City');
    const page = await asRole('branchAdmin');
    await go(page, '/en/console?view=all');
    await expect(page.locator('main').getByText(ACCOUNTS.customer.email)).toHaveCount(0);
  });

  test('TC-PS-012 Scope editing', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const l = await lookups(admin);
    const [a, b] = l.branches.filter((x) => /nasr city|heliopolis|maadi|banha|qalyub/i.test(x.name)).slice(0, 2);
    test.skip(!a || !b, 'needs two branches');
    const email = newEmail(), pw = tempPassword();
    try {
      await ok(admin.post('/api/admin/staff', { data: { fullName: 'E2E Scope Edit', email, phone: '', password: pw, roles: ['agent'], scoped: 'branch', orgs: [], branches: [a.id] } }));
      const before = await signIn(email, pw);
      expect((await ok<{ branches: { id: string }[] }>(before.get('/api/console/people'))).branches.map((x) => x.id)).toEqual([a.id]);
      await before.dispose();
      const row = (await staffRow(admin, email))!;
      await ok(admin.put(`/api/admin/users/${row.id}/scope`, { data: { orgs: [], branches: [b.id] } }));
      const after = await signIn(email, pw);                                      // next load uses the new scope
      expect((await ok<{ branches: { id: string }[] }>(after.get('/api/console/people'))).branches.map((x) => x.id)).toEqual([b.id]);
      await after.dispose();
    } finally { await removeUser(admin, email); }
  });

  manual('TC-PS-013', 'Rollback on failure', 'needs the scope save to be made to fail on purpose (test environment only)');
});
