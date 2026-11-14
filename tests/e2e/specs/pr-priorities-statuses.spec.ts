import { expect, go, stamp, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "PR Priorities, statuses". Changes are made on E2E records that are deleted again; real ones are only read. */
interface Prio { code: string; nameEn: string; color: string; firstResponseMinutes?: number; resolutionMinutes?: number; isActive: boolean }

test.describe('PR Priorities, statuses', () => {
  test('TC-PR-001 Priority list', async ({ asRole, apiAs }) => {
    const raw = await ok<Prio[] | { priorities: Prio[] }>((await apiAs('admin')).get('/api/admin/priorities'));
    const list = Array.isArray(raw) ? raw : raw.priorities;
    const page = await asRole('admin');
    await go(page, '/en/admin/priorities');
    await expect(page.getByRole('heading', { level: 1, name: t('AdminPriorities.title') })).toBeVisible();
    for (const p of list.filter((x) => x.isActive).slice(0, 4)) await expect(page.locator('main').getByText(p.nameEn).first()).toBeVisible();
    await expect(page.locator('main').getByText(/\d+\s*(h|m|d|min|hour)/i).first(), 'SLA targets shown').toBeVisible();
  });

  test('TC-PR-002 Edit a priority', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const name = stamp('E2E prio');
    const made = await admin.post('/api/admin/priorities', { data: { nameEn: name, nameAr: name, color: 'grey', icon: 'minus', sortOrder: 999, isActive: false, firstResponseMinutes: 60, resolutionMinutes: 480 } });
    expect(made.ok(), `create: ${made.status()}`).toBeTruthy();
    const raw = await ok<Prio[] | { priorities: Prio[] }>(admin.get('/api/admin/priorities'));
    const p = (Array.isArray(raw) ? raw : raw.priorities).find((x) => x.nameEn === name)!;
    try {
      await ok(admin.put(`/api/admin/priorities/${p.code}`, { data: { nameEn: `${name} edited`, nameAr: name, color: 'blue', icon: 'minus', sortOrder: 999, isActive: false, firstResponseMinutes: 30, resolutionMinutes: 240 } }));
      const again = await ok<Prio[] | { priorities: Prio[] }>(admin.get('/api/admin/priorities'));
      expect((Array.isArray(again) ? again : again.priorities).find((x) => x.code === p.code)).toMatchObject({ nameEn: `${name} edited`, color: 'blue' });
    } finally { await admin.delete(`/api/admin/priorities/${p.code}`); }
  });

  test('TC-PR-003 Delete a priority in use', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const used = await ok<{ items: { priority?: string }[] }>(admin.get('/api/tickets?page=1&pageSize=1'));
    const code = (used.items[0] as { priority?: string } | undefined)?.priority ?? (await ok<{ priorities: { code: string }[] }>(admin.get('/api/tickets/options'))).priorities[0].code;
    const r = await admin.delete(`/api/admin/priorities/${code}`);
    expect(r.status(), 'refused while tickets use it').toBeGreaterThanOrEqual(400);
  });

  test('TC-PR-004 Status list', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/ticket-status');
    await expect(page.getByRole('heading', { level: 1, name: t('AdminStatus.title') })).toBeVisible();
    for (const s of ['new', 'open', 'resolved', 'closed']) await expect(page.locator('main').getByText(t(`StaffStatus.${s}`), { exact: true }).first()).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: /guide/i }).first(), 'link to the lifecycle guide').toBeVisible();
  });

  test('TC-PR-005 Status guide', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/ticket-status/guide');
    await expect(page.getByRole('heading', { level: 1, name: t('StatusGuide.title') })).toBeVisible();
    for (const s of ['new', 'pending_customer', 'resolved', 'closed', 'reopened']) await expect(page.locator('main').getByText(t(`StaffStatus.${s}`)).first()).toBeVisible();
  });

  test('TC-PR-006 Edit a status reason', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const name = stamp('E2E reason');
    const code = `e2e_${Date.now()}`;
    await ok(admin.post('/api/admin/closure-reasons', { data: { code, nameEn: name, nameAr: name, customerMayReopen: true, isActive: true, sortOrder: 999 } }));
    try {
      const tk = await import('../support/data').then((d) => d.ticketFor(admin, 'sara.banha@demo.cts.test'));
      const x = await ok<{ closureReasons: { code: string; nameEn: string }[] }>(admin.get(`/api/tickets/${tk.id}/staff`));
      expect(x.closureReasons.map((r) => r.nameEn), 'offered when closing').toContain(name);
    } finally { await admin.delete(`/api/admin/closure-reasons/${code}`); }
  });

  test('TC-PR-007 Built-in reasons protected', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const flow = await ok<{ reasons?: { code: string; nameEn: string; isSystem?: boolean }[]; closureReasons?: { code: string; nameEn: string; isSystem?: boolean }[] }>(admin.get('/api/admin/status-flow'));
    const reasons = flow.reasons ?? flow.closureReasons ?? [];
    const sys = reasons.find((r) => /no customer response/i.test(r.nameEn)) ?? reasons.find((r) => r.isSystem);
    expect(sys, 'built-in "No customer response" exists').toBeTruthy();
    const r = await admin.delete(`/api/admin/closure-reasons/${sys!.code}`);
    expect(r.status(), 'refused').toBeGreaterThanOrEqual(400);
  });
});
