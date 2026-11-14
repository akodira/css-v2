import type { APIRequestContext } from '@playwright/test';
import { expect, go, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, ticket, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "TM Teams". New teams are named "E2E team ..." and deleted at the end (a team without tickets can be deleted).
 * Existing teams are only read; the auto-assign rule is checked on Technical support, where it is already on.
 */
interface Team { id: string; nameEn: string; nameAr: string; isActive: boolean; members: { userId: string; fullName: string; isLeader: boolean }[] }
interface Teams { teams: Team[]; candidates: { id: string; fullName: string; role: string }[] }
const teams = (admin: APIRequestContext) => ok<Teams>(admin.get('/api/admin/teams'));
async function newTeam(admin: APIRequestContext, isActive = true): Promise<Team> {
  const name = stamp('E2E team');
  await ok(admin.post('/api/admin/teams', { data: { nameEn: name, nameAr: `فريق ${name}`, isActive } }));
  return (await teams(admin)).teams.find((x) => x.nameEn === name)!;
}
const drop = (admin: APIRequestContext, id: string) => admin.delete(`/api/admin/teams/${id}`);

test.describe('TM Teams', () => {
  test('TC-TM-001 Create a team', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const name = stamp('E2E team');
    try {
      const page = await asRole('admin');
      await go(page, '/en/admin/teams');
      await expect(page.getByRole('heading', { level: 1, name: t('AdminTeams.title') })).toBeVisible();
      const box = page.locator('details').filter({ has: page.locator('summary', { hasText: t('Directory.addTeam') }) });
      if ((await box.getAttribute('open')) === null) await box.locator('summary').click();
      await box.locator('input[name="en"]').fill(name);
      await box.locator('input[name="ar"]').fill(`فريق ${name}`);
      const leader = box.getByLabel(t('Directory.teamLeader'));
      if (await leader.count()) await leader.selectOption({ index: 1 }).catch(() => undefined);
      await box.getByRole('button', { name: t('Directory.create'), exact: true }).click();
      await expect(page.locator('main h2').filter({ hasText: name })).toBeVisible();
      expect((await teams(admin)).teams.some((x) => x.nameEn === name)).toBe(true);
    } finally {
      const tm = (await teams(admin)).teams.find((x) => x.nameEn === name);
      if (tm) await drop(admin, tm.id);
    }
  });

  test('TC-TM-002 Add and remove members', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const tm = await newTeam(admin);
    try {
      const all = await teams(admin);
      const [a, b] = all.candidates.filter((c) => c.role === 'agent').slice(0, 2);
      await ok(admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [{ userId: a.id, isLeader: false }, { userId: b.id, isLeader: false }] } }));
      expect((await teams(admin)).teams.find((x) => x.id === tm.id)!.members.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort());
      await ok(admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [{ userId: a.id, isLeader: false }] } }));
      expect((await teams(admin)).teams.find((x) => x.id === tm.id)!.members.map((m) => m.userId)).toEqual([a.id]);
    } finally {
      await admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [] } });
      await drop(admin, tm.id);
    }
  });

  test('TC-TM-003 Leader checkbox', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const tm = await newTeam(admin);
    try {
      const lead = (await teams(admin)).candidates.find((c) => c.role === 'team_leader')!;
      await ok(admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [{ userId: lead.id, isLeader: true }] } }));
      expect((await teams(admin)).teams.find((x) => x.id === tm.id)!.members[0]).toMatchObject({ userId: lead.id, isLeader: true });
      const agent = (await teams(admin)).candidates.find((c) => c.role === 'agent')!;
      const r = await admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [{ userId: agent.id, isLeader: true }] } });
      expect(r.status(), 'only a Team leader can lead').toBe(400);
    } finally {
      await admin.put(`/api/admin/teams/${tm.id}/members`, { data: { members: [] } });
      await drop(admin, tm.id);
    }
  });

  test('TC-TM-004 Search teams or members', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/teams');
    const q = page.locator('#acc-q');
    const heads = page.locator('main h2 button[aria-expanded]');
    await q.fill('Technical');
    await expect(heads.filter({ hasText: 'Technical support' })).toHaveCount(1);
    await expect(heads.filter({ hasText: 'Sales desk' })).toHaveCount(0);
    await q.fill(ACCOUNTS.agent.name);                                                  // a member's name finds the team
    await expect(heads.filter({ hasText: 'Technical support' })).toHaveCount(1);
    await q.fill('zzz-no-such-team');
    await expect(page.getByText(t('AdminTeams.noMatch'))).toBeVisible();
  });

  test('TC-TM-005 Deactivate a team', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const tm = await newTeam(admin);
    try {
      await ok(admin.put(`/api/admin/teams/${tm.id}`, { data: { nameEn: tm.nameEn, nameAr: tm.nameAr, isActive: false } }));
      expect((await teams(admin)).teams.find((x) => x.id === tm.id)!.isActive).toBe(false);
      const tk = await ticketFor(admin, ACCOUNTS.customer.email);
      const staff = await ok<{ teams: { id: string }[] }>(admin.get(`/api/tickets/${tk.id}/staff`));
      expect(staff.teams.map((x) => x.id), 'not offered for tickets').not.toContain(tm.id);
    } finally { await drop(admin, tm.id); }
  });

  test('TC-TM-006 My team page', async ({ asRole }) => {
    const page = await asRole('teamLeader');
    await go(page, '/en/console/team');
    await expect(page.getByRole('heading', { level: 1, name: t('Team.title') })).toBeVisible();
    await expect(page.locator('main'), 'teams of the leader').toContainText(new RegExp(`${t('Team.leader')}|${t('Team.noTeams')}`), { timeout: 10_000 });
    await expect(page.locator('main').getByText(new RegExp(`${t('Team.on')}|${t('Team.off')}`)).first()).toBeVisible();
    await expect(page.locator('main').getByText(new RegExp(`${t('Team.createOn')}|${t('Team.createOff')}`)).first()).toBeVisible();
  });

  test('TC-TM-007 Auto-assign rule', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const tk = await ticketFor(admin, ACCOUNTS.customer.email);                        // Technical support: auto-assign on
    const d = await ticket(admin, tk.id);
    expect(d.names.teamEn).toBe('Technical support');
    expect(d.assignedAgentId, 'assigned by the rule').toBeTruthy();
  });
});
