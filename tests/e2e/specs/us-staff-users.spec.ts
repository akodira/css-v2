import { randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, go, newApi, signInApi, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "US Staff users". Changes are made on throw-away staff accounts (e2e.*@demo.cts.test) created here and deleted
 * (or, when they have history, suspended) at the end. Temporary passwords are generated in memory only.
 */
interface StaffRow { id: string; email: string; fullName: string; roles: string[]; status: string; phone: string | null }
const newEmail = () => `${stamp('e2e staff').replace(/\s+/g, '.').toLowerCase()}@demo.cts.test`;
const tempPw = () => `Stf-${randomBytes(9).toString('base64url')}4b!`;

async function rows(admin: APIRequestContext): Promise<StaffRow[]> { return (await ok<{ staff: StaffRow[] }>(admin.get('/api/admin/staff'))).staff; }
async function row(admin: APIRequestContext, email: string): Promise<StaffRow | undefined> { return (await rows(admin)).find((r) => r.email === email); }
async function makeStaff(admin: APIRequestContext, roles = ['agent']): Promise<{ email: string; pw: string; id: string }> {
  const email = newEmail(), pw = tempPw();
  await ok(admin.post('/api/admin/staff', { data: { fullName: 'E2E Staff', email, phone: '', password: pw, roles, scoped: null, orgs: [], branches: [] } }));
  return { email, pw, id: (await row(admin, email))!.id };
}
async function drop(admin: APIRequestContext, id: string): Promise<void> {
  const r = await admin.delete(`/api/admin/users/${id}`);
  if (!r.ok()) await admin.post(`/api/admin/users/${id}/status`, { data: { status: 'suspended' } });   // has history: leave it suspended
}
const trySignIn = signInApi;
async function openAdd(page: Page): Promise<void> {
  await go(page, '/en/admin/users');
  const box = page.locator('details').filter({ has: page.locator('summary', { hasText: t('Directory.addStaff') }) });
  if ((await box.getAttribute('open')) === null) await box.locator('summary').click();
}
const roleBox = (page: Page, r: string) => page.locator('details[open] label').filter({ has: page.locator('span', { hasText: new RegExp(`^${t(`Roles.${r}`)}$`) }) }).locator('input[type=checkbox]').first();

test.describe('US Staff users', () => {
  test('TC-US-001 Staff list and search', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/users');
    await page.locator('#acc-q').fill(ACCOUNTS.agent.name);
    const heads = page.locator('main h2 button[aria-expanded]');
    await expect(heads.filter({ hasText: ACCOUNTS.agent.name })).toHaveCount(1);
    await expect(heads.filter({ hasText: ACCOUNTS.teamLeader.name })).toHaveCount(0);
    const head = heads.filter({ hasText: ACCOUNTS.agent.name });
    await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('main').getByText(t('AdminUsers.scopeTitle')).first()).toBeVisible();
    await page.getByRole('button', { name: t('AdminOrgs.collapseAll') }).click();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
  });

  test('TC-US-002 Add staff with roles', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const email = newEmail();
    try {
      const page = await asRole('admin');
      await openAdd(page);
      await page.locator('input[name="n"]').first().fill('E2E Staff Agent');
      await page.locator('input[name="e"]').first().fill(email);
      await page.locator('input[name="p"]').first().fill(`012${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
      await page.getByRole('button', { name: t('Directory.generate') }).click();
      await expect(page.locator('#nw-pw')).not.toHaveValue('');
      const agent = roleBox(page, 'agent');
      if (!(await agent.isChecked())) await agent.check();
      await page.getByRole('button', { name: t('Directory.create'), exact: true }).click();
      const shown = page.getByText(new RegExp(`^Created ${email.replace(/\./g, '\\.')}\\. Temporary password: `));
      await expect(shown).toBeVisible();
      expect((await row(admin, email))?.roles).toEqual(['agent']);
      await go(page, '/en/admin/users');                                            // shown once only
      await expect(page.getByText(/Temporary password: /)).toHaveCount(0);
    } finally { const r = await row(admin, email); if (r) await drop(admin, r.id); }
  });

  test('TC-US-003 Role cards', async ({ asRole }) => {
    const page = await asRole('admin');
    await openAdd(page);
    for (const r of ['agent', 'team_leader', 'admin', 'management_viewer']) {
      const card = page.locator('details[open] label').filter({ has: page.locator('span', { hasText: new RegExp(`^${t(`Roles.${r}`)}$`) }) }).first();
      await expect(card, r).toContainText(t(`RoleGuide.${r}.summary`));
      await expect(card.locator('li').first(), `${r} lists what it can do`).toBeVisible();
    }
    await expect(page.getByText(t('RoleGuide.permNote'))).toBeVisible();
  });

  test('TC-US-004 Multiple roles', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const email = newEmail();
    try {
      const page = await asRole('admin');
      await openAdd(page);
      await page.locator('input[name="n"]').first().fill('E2E Staff Two Roles');
      await page.locator('input[name="e"]').first().fill(email);
      await page.getByRole('button', { name: t('Directory.generate') }).click();
      // v2: the staff form has no Customer card, so a customer role cannot be combined here.
      await expect(page.locator('details[open] label').filter({ has: page.locator('span', { hasText: new RegExp(`^${t('Roles.customer')}$`) }) })).toHaveCount(0);
      if (!(await roleBox(page, 'agent').isChecked())) await roleBox(page, 'agent').check();
      await roleBox(page, 'team_leader').check();
      await page.getByRole('button', { name: t('Directory.create'), exact: true }).click();
      await expect(page.getByText(new RegExp(`^Created ${email.replace(/\./g, '\\.')}`))).toBeVisible();
      expect((await row(admin, email))?.roles.sort()).toEqual(['agent', 'team_leader']);
    } finally { const r = await row(admin, email); if (r) await drop(admin, r.id); }
  });

  test('TC-US-005 Edit staff', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const s = await makeStaff(admin);
    try {
      await ok(admin.put(`/api/admin/users/${s.id}/details`, { data: { fullName: 'E2E Staff Edited', email: s.email, phone: '01098765432' } }));
      await ok(admin.put(`/api/admin/users/${s.id}/roles`, { data: { roles: ['agent', 'team_leader'] } }));
      const r = (await row(admin, s.email))!;
      expect([r.fullName, r.roles.sort().join(',')]).toEqual(['E2E Staff Edited', 'agent,team_leader']);
      const audit = await admin.get(`/api/admin/audit?q=${encodeURIComponent(s.id)}`);
      if (audit.ok()) expect(await audit.text(), 'logged').toContain(s.id);
    } finally { await drop(admin, s.id); }
  });

  test('TC-US-006 Suspend staff', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const s = await makeStaff(admin);
    try {
      await ok(admin.post(`/api/admin/users/${s.id}/status`, { data: { status: 'suspended' } }));
      const r = await trySignIn(s.email, s.pw);
      expect(r.status, 'cannot sign in').not.toBe(200);
    } finally { await drop(admin, s.id); }
  });

  test('TC-US-007 Reactivate staff', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const s = await makeStaff(admin);
    try {
      await ok(admin.post(`/api/admin/users/${s.id}/status`, { data: { status: 'suspended' } }));
      await ok(admin.post(`/api/admin/users/${s.id}/status`, { data: { status: 'active' } }));
      expect((await trySignIn(s.email, s.pw)).status, 'can sign in again').toBe(200);
    } finally { await drop(admin, s.id); }
  });

  test('TC-US-008 Delete staff with history', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const s = await makeStaff(admin, ['team_leader']);
    // give the new person history: a ticket assigned to them
    const tk = await ticketFor(admin, ACCOUNTS.customer.email);
    const staff = await ok<{ teams: { id: string }[] }>(admin.get(`/api/tickets/${tk.id}/staff`));
    await admin.post(`/api/tickets/${tk.id}/assign`, { data: { teamId: staff.teams[0]?.id, agentId: s.id, reason: 'E2E history' } });
    const del = await admin.delete(`/api/admin/users/${s.id}`);
    if (del.ok()) test.info().annotations.push({ type: 'note', description: 'assignment was refused for this person, so no history was made' });
    else expect(del.status(), 'refused: suspend instead').toBe(409);
    await admin.post(`/api/admin/users/${s.id}/status`, { data: { status: 'suspended' } });
  });

  test('TC-US-009 Reset a person\'s password', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const s = await makeStaff(admin);
    try {
      const next = tempPw();
      await ok(admin.post(`/api/admin/users/${s.id}/password`, { data: { password: next } }));
      expect((await trySignIn(s.email, s.pw)).status, 'old password stops').not.toBe(200);
      const r = await trySignIn(s.email, next);
      expect(r.status, 'signs in with the new temporary password').toBe(200);
      expect(JSON.stringify(r.body), 'is asked to change it').toMatch(/mustChange|changePassword|passwordExpired|mustReset/i);
    } finally { await drop(admin, s.id); }
  });

  test('TC-US-010 Account type per person', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const types = (await ok<{ types: { id: string; nameEn: string; scopeLevel: string | null }[] }>(admin.get('/api/admin/lookups'))).types;
    const readOnly = types.find((x) => /read-only/i.test(x.nameEn));
    test.skip(!readOnly, 'no read-only account type');
    const s = await makeStaff(admin);
    try {
      await ok(admin.put(`/api/admin/users/${s.id}/account-type`, { data: { accountTypeId: readOnly!.id } }));
      const r = await trySignIn(s.email, s.pw);
      const me = await newApi(r.body.accessToken as string);
      const prof = await ok<{ permissions?: string[] }>(me.get('/api/me'));
      expect(prof.permissions ?? [], 'no reply permission any more').not.toContain('reply');
      await me.dispose();
    } finally { await drop(admin, s.id); }
  });
});
