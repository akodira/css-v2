import type { APIRequestContext, Page } from '@playwright/test';
import { expect, go, manual, stamp, test } from '../support/fixtures';
import { ACCOUNTS, type Role } from '../support/accounts';
import { createTicket, move, ok, PNG, reply, ticket, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "ST Staff tickets". Agent = Agent Banha (type "Agent": no assigning to others, no close, no category change),
 * team leader = Tamer Leader (all), viewer = Laila Hassan (management viewer). Test tickets belong to the test customer
 * and are created by the admin (customers may create only 15 per hour).
 */
const CUSTOMER = ACCOUNTS.customer.email;
type ApiAs = (r: Role) => Promise<APIRequestContext>;
const fresh = async (apiAs: ApiAs) => ticketFor(await apiAs('admin'), CUSTOMER);
const main = (p: Page) => p.locator('main');

async function openTicket(page: Page, id: string): Promise<void> {
  await go(page, `/en/console/tickets/${id}`);
  await expect(main(page).locator('h1')).toBeVisible();
}

test.describe('ST Staff tickets', () => {
  test('TC-ST-001 Queue cards and counts', async ({ asRole, apiAs }) => {
    const page = await asRole('agent');
    await go(page, '/en/console');
    const api = await apiAs('agent');
    const c = await ok<Record<string, number>>(api.get('/api/console/counts'));
    const card = (k: string) => main(page).locator('dl > *').filter({ has: page.locator('dt', { hasText: t(`Console.summary.${k}`) }) }).locator('dd');
    for (const [k, v] of [['mine', c.mine], ['unassigned', c.unassigned], ['breached', c.breached], ['dueSoon', c.dueSoon], ['closed', c.closed]] as const)
      await expect(card(k), k).toHaveText(String(v ?? 0));
    const mine = await ok<{ total: number }>(api.get('/api/tickets?view=assigned&group=open&page=1&pageSize=1'));
    expect(mine.total, 'Assigned to me card = list').toBe(c.mine);
    const un = await ok<{ total: number }>(api.get('/api/tickets?view=unassigned&group=open&page=1&pageSize=1'));
    expect(un.total, 'Unassigned card = list').toBe(c.unassigned);
  });

  test('TC-ST-002 Tickets menu badge', async ({ asRole, apiAs }) => {
    const page = await asRole('agent');
    await go(page, '/en/console/dashboard');
    const c = await ok<Record<string, number>>((await apiAs('agent')).get('/api/console/counts'));
    const link = page.getByRole('navigation', { name: t('Shell.menu') }).first().getByRole('link', { name: new RegExp(`^${t('Shell.tickets')}\\b`) });
    await expect(link).toHaveText(new RegExp(`${c.mine + c.unassigned}\\s*$`));
  });

  test('TC-ST-003 Queue filters and search', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('teamLeader');
    await go(page, '/en/console');
    const form = main(page).locator('form').first();
    await form.getByLabel(t('Console.filters.search')).fill(tk.reference);
    await form.getByRole('button', { name: t('Console.filters.searchButton') }).click();
    await expect(main(page).locator('tbody tr')).toHaveCount(1);
    await expect(main(page).locator('tbody tr').first()).toContainText(tk.reference);
    await form.getByLabel(t('Console.filters.search')).fill('');
    await form.getByLabel(t('Console.filters.status')).selectOption('closed');
    await form.getByRole('button', { name: t('Console.filters.searchButton') }).click();
    await expect(page).toHaveURL(/status=closed/);
    const rows = main(page).locator('tbody tr');
    const n = Math.min(await rows.count(), 5);
    for (let i = 0; i < n; i++) await expect(rows.nth(i).locator('td').nth(4)).toContainText(t('StaffStatus.closed'));
    const th = main(page).locator('thead th').filter({ hasText: t('Console.columns.created') });
    await th.getByRole('button').first().click();
    await expect(page).toHaveURL(/sort=created/);
  });

  manual('TC-ST-004', 'Agent sees only allowed tickets', 'needs an agent whose account type lacks "see colleagues\' tickets" (e.g. Nile Cairo HQ limited); no password for it in .env');

  test('TC-ST-005 Scope is applied', async ({ apiAs }) => {
    // Tamer Leader leads everything except Azka and HCWW: a ticket of an Azka/HCWW customer must stay hidden.
    const admin = await apiAs('admin');
    const dir = await ok<{ id: string; organizationName: string | null }[]>(admin.get('/api/tickets/customers'));
    const outside = dir.find((x) => /azka|hcww/i.test(x.organizationName ?? ''));
    test.skip(!outside, 'no customer in Azka or HCWW in this copy');
    const tk = await createTicket(admin, { requesterId: outside!.id });
    const lead = await apiAs('teamLeader');
    expect([403, 404]).toContain((await lead.get(`/api/tickets/${tk.id}`)).status());
    const list = await ok<{ items: { id: string }[] }>(lead.get(`/api/tickets?search=${encodeURIComponent(tk.reference)}&page=1&pageSize=5`));
    expect(list.items.map((x) => x.id)).not.toContain(tk.id);
    const mine = await fresh(apiAs);                                              // inside the scope: visible
    expect((await lead.get(`/api/tickets/${mine.id}`)).status()).toBe(200);
  });

  test('TC-ST-006 Open a ticket', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    await expect(main(page).locator('h1')).toHaveText(tk.subject);
    await expect(main(page).getByText(t('Console.ticket.firstResponse')).first()).toBeVisible();
    await expect(main(page).getByText(t('Console.ticket.resolution')).first()).toBeVisible();
    await expect(main(page).getByRole('heading', { name: t('Console.ticket.description') })).toBeVisible();
    await expect(main(page).getByRole('heading', { name: t('Console.ticket.customer') })).toBeVisible();
    await expect(main(page).getByText(CUSTOMER)).toBeVisible();
    await expect(main(page).getByRole('heading', { name: t('Console.ticket.conversation') })).toBeVisible();
    await expect(main(page).getByRole('heading', { name: t('Console.ticket.activity') })).toBeVisible();
  });

  test('TC-ST-007 Reply to the customer', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const body = `${stamp('E2E staff reply')} - we are checking this for you now.`;
    await main(page).getByLabel(t('Console.reply.public')).check();
    await page.locator('#body').fill(body);
    await main(page).locator('input[type=file]').setInputFiles({ name: 'staff-proof.png', mimeType: 'image/png', buffer: PNG });
    await main(page).getByRole('button', { name: t('Console.reply.submit'), exact: true }).click();
    await expect(main(page).getByText(t('Console.reply.sentPublic'))).toBeVisible();
    const seen = await ticket(await apiAs('customer'), tk.id);
    const msg = seen.messages.find((m: { body: string }) => m.body === body);
    expect(msg, 'customer sees the reply').toBeTruthy();
    expect(msg.attachments.map((a: { fileName: string }) => a.fileName)).toContain('staff-proof.png');
    const now = await ticket(await apiAs('agent'), tk.id);
    expect(now.status, 'status moves on after the first reply').not.toBe('new');
  });

  test('TC-ST-008 Internal note', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const body = `${stamp('E2E internal note')} - staff only.`;
    await main(page).getByLabel(t('Console.reply.internal')).check();
    await page.locator('#body').fill(body);
    await main(page).getByRole('button', { name: t('Console.reply.submit'), exact: true }).click();
    await expect(main(page).getByText(t('Console.reply.sentInternal'))).toBeVisible();
    await expect(main(page).locator('li').filter({ hasText: body }).locator('span', { hasText: t('Console.ticket.internalNote') }).first()).toBeVisible();
    const seen = await ticket(await apiAs('customer'), tk.id);
    expect(JSON.stringify(seen.messages)).not.toContain(body);                    // never sent to the customer
  });

  test('TC-ST-009 Saved replies in the editor', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const picker = page.locator('#canned');
    test.skip(!(await picker.count()), 'no saved replies available to this agent');
    await picker.selectOption({ index: 1 });
    await expect(page.locator('#body')).not.toHaveValue('');
    await page.locator('#body').fill((await page.locator('#body').inputValue()) + ' (edited)');   // stays editable
    await expect(page.locator('#body')).toHaveValue(/\(edited\)$/);
    await expect(main(page).getByRole('link', { name: t('Console.reply.cannedManage') })).toBeVisible();
  });

  test('TC-ST-010 Change status', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const x = await ok<{ moves: { to: string; requiresReason: boolean }[] }>((await apiAs('agent')).get(`/api/tickets/${tk.id}/staff`));
    const offered = await page.locator('#to option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    expect(offered.sort(), 'only allowed transitions').toEqual(x.moves.map((m) => m.to).sort());
    const target = x.moves.find((m) => m.to === 'in_progress') ?? x.moves.find((m) => m.to !== 'resolved' && m.to !== 'closed')!;
    await page.locator('#to').selectOption(target.to);
    if (target.requiresReason) {
      await main(page).getByRole('button', { name: t('Console.statusForm.submit') }).click();
      await expect(main(page).getByText(t('Console.errors.reasonRequired'))).toBeVisible();
      await page.locator('#why').fill('Automated test reason');
    }
    await main(page).getByRole('button', { name: t('Console.statusForm.submit') }).click();
    await expect(main(page).getByText(t('Console.statusForm.done'))).toBeVisible();
    expect((await ticket(await apiAs('agent'), tk.id)).status).toBe(target.to);
    await expect(main(page).locator('section, aside').filter({ hasText: t('Console.ticket.activity') }).getByText(t(`StaffStatus.${target.to}`)).first()).toBeVisible();
  });

  test('TC-ST-011 Resolve a ticket', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    await move(await apiAs('agent'), tk.id, 'in_progress');
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    await page.locator('#to').selectOption('resolved');
    await page.locator('#res').fill('Fixed by the automated browser test.');
    if (await page.locator('#why').isVisible()) await page.locator('#why').fill('Automated test reason');
    await main(page).getByRole('button', { name: t('Console.statusForm.submit') }).click();
    await expect(main(page).getByText(t('Console.statusForm.done'))).toBeVisible();
    const seen = await ticket(await apiAs('customer'), tk.id);
    expect(seen.status).toBe('resolved');
    expect(seen.resolutionSummary).toContain('Fixed by the automated browser test.');
  });

  test('TC-ST-012 Close a ticket', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    // Status flow of this copy: staff may close from New or Pending customer (with a reason).
    await move(await apiAs('teamLeader'), tk.id, 'pending_customer');
    const agentMoves = (await ok<{ moves: { to: string }[] }>((await apiAs('agent')).get(`/api/tickets/${tk.id}/staff`))).moves.map((m) => m.to);
    expect(agentMoves, 'agents (no Close permission) cannot close').not.toContain('closed');
    const page = await asRole('teamLeader');
    await openTicket(page, tk.id);
    await page.locator('#to').selectOption('closed');
    if (await page.locator('#cr').isVisible()) await page.locator('#cr').selectOption({ index: 1 });
    if (await page.locator('#res').isVisible()) await page.locator('#res').fill('Closed by the automated browser test.');
    if (await page.locator('#why').isVisible()) await page.locator('#why').fill('Automated test reason');
    await main(page).getByRole('button', { name: t('Console.statusForm.submit') }).click();
    await expect(main(page).getByText(t('Console.statusForm.done'))).toBeVisible();
    expect((await ticket(await apiAs('teamLeader'), tk.id)).status).toBe('closed');
  });

  test('TC-ST-013 Change priority', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('teamLeader');
    await openTicket(page, tk.id);
    test.skip(!(await page.locator('#prio').count()), 'the category fixes the priority of this ticket');
    const before = await ok<{ priority: string }>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}`));
    const sla0 = (await ok<{ sla: { resolutionDue: string | null } | null }>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}/staff`))).sla;
    const other = await page.locator('#prio option').evaluateAll((els, cur) => els.map((e) => (e as HTMLOptionElement).value).find((v) => v && v !== cur), before.priority);
    await page.locator('#prio').selectOption(other!);
    await page.locator('#prio-reason').fill('Automated test');
    await main(page).getByRole('button', { name: t('Console.priorityForm.submit') }).click();
    await expect(main(page).getByText(t('Console.priorityForm.done'))).toBeVisible();
    expect((await ticket(await apiAs('teamLeader'), tk.id)).priority).toBe(other);
    const sla1 = (await ok<{ sla: { resolutionDue: string | null } | null }>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}/staff`))).sla;
    if (sla0?.resolutionDue && sla1?.resolutionDue) expect.soft(sla1.resolutionDue, 'SLA target recalculated').not.toBe(sla0.resolutionDue);
  });

  test('TC-ST-014 Assign to an agent', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('teamLeader');
    await openTicket(page, tk.id);
    const team = await page.locator('#as-team').inputValue();
    if (!team) await page.locator('#as-team').selectOption({ index: 1 });
    const agents = await page.locator('#as-agent option').evaluateAll((els) => els.map((e) => ({ v: (e as HTMLOptionElement).value, l: e.textContent?.trim() ?? '' })).filter((o) => o.v));
    test.skip(!agents.length, 'no agent in the team of this ticket');
    await page.locator('#as-agent').selectOption(agents[0].v);
    await page.locator('#as-reason').fill('Automated test assignment');
    await main(page).getByRole('button', { name: t('Console.assignForm.submit'), exact: true }).click();
    await expect(main(page).getByText(t('Console.assignForm.done'))).toBeVisible();
    const now = await ticket(await apiAs('teamLeader'), tk.id);
    expect(now.assignedAgentId).toBe(agents[0].v);
    await expect(main(page).getByText(agents[0].l).first()).toBeVisible();
  });

  test('TC-ST-015 Assign to myself', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const claim = main(page).getByRole('button', { name: t('Console.assignForm.claim') });
    test.skip(!(await claim.count()), 'the agent cannot take tickets of this team (ticket routed outside his team)');
    const c0 = await ok<{ unassigned: number; mine: number }>((await apiAs('agent')).get('/api/console/counts'));
    await claim.click();
    await expect(main(page).getByText(t('Console.assignForm.done'))).toBeVisible();
    await expect(main(page).locator('header').getByText(ACCOUNTS.agent.name)).toBeVisible();
    const c1 = await ok<{ unassigned: number; mine: number }>((await apiAs('agent')).get('/api/console/counts'));
    expect(c1.mine).toBe(c0.mine + 1);
  });

  test('TC-ST-016 Assign needs permission', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    await expect(page.locator('#as-agent')).toHaveCount(0);                       // only "Assign to me" for agents
    const lead = await ok<{ teams: { id: string }[]; members: { teamId: string; userId: string }[] }>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}/staff`));
    const m = lead.members[0];
    test.skip(!m, 'no team members to try');
    const r = await (await apiAs('agent')).post(`/api/tickets/${tk.id}/assign`, { data: { teamId: m.teamId, agentId: m.userId, reason: 'try' } });
    expect(r.status(), 'refused by the API too').toBe(403);
  });

  test('TC-ST-017 Escalate a ticket', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const reason = 'Automated test: needs a leader decision.';
    if (await page.locator('#flow-reason').count()) {
      if (await page.locator('#flow-target').count()) await page.locator('#flow-target').selectOption({ index: 1 });
      await page.locator('#flow-reason').fill(reason);
      await main(page).getByRole('button', { name: t('Escalation.submit'), exact: true }).click();
      await expect(main(page).getByText(t('Escalation.done'))).toBeVisible();
    } else {
      await page.locator('#esc-reason').fill(reason);
      await main(page).getByRole('button', { name: t('Console.escalate.submit'), exact: true }).click();
      await expect(main(page).getByText(t('Console.escalate.done'))).toBeVisible();
    }
    const lc = await ok<Record<string, unknown>>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}/lifecycle`));
    expect(JSON.stringify(lc), 'escalation recorded on the ticket').toMatch(/escalat/i);
  });

  test('TC-ST-018 Auto-assign', async ({ apiAs }) => {
    // The Technical support team of the local copy has auto-assign on: a new ticket gets an agent at once.
    const tk = await fresh(apiAs);
    const d = await ticket(await apiAs('admin'), tk.id);
    expect(d.names.teamEn, 'routed to the team of the category').toBeTruthy();
    expect(d.assignedAgentId, 'assigned automatically').toBeTruthy();
  });

  test('TC-ST-019 Change category', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('teamLeader');
    await openTicket(page, tk.id);
    const before = (await ticket(await apiAs('teamLeader'), tk.id)).categoryId;
    const other = await page.locator('#cat-sel option').evaluateAll((els, cur) => els.map((e) => (e as HTMLOptionElement).value).find((v) => v && v !== cur), before);
    test.skip(!other, 'only one category');
    await page.locator('#cat-sel').selectOption(other!);
    await page.locator('#cat-reason').fill('Automated test');
    await main(page).getByRole('button', { name: t('Console.categoryForm.submit') }).click();
    await expect(main(page).getByText(t('Console.categoryForm.done'))).toBeVisible();
    expect((await ticket(await apiAs('teamLeader'), tk.id)).categoryId).toBe(other);
  });

  test('TC-ST-020 Mark duplicate', async ({ asRole, apiAs }) => {
    const original = await fresh(apiAs);
    const tk = await fresh(apiAs);
    const page = await asRole('teamLeader');                                     // closing as duplicate needs the Close permission (not in the Agent type)
    await openTicket(page, tk.id);
    await page.locator('#dup-ref').fill(original.reference);
    await main(page).getByRole('button', { name: t('Lifecycle.staff.markDuplicate') }).click();
    await expect.poll(async () => (await ticket(await apiAs('teamLeader'), tk.id)).status).toBe('closed');
    const lc = await ok<{ links: { kind: string; otherReference: string }[] }>((await apiAs('teamLeader')).get(`/api/tickets/${tk.id}/lifecycle`));
    expect(lc.links.some((l) => l.kind === 'duplicate_of' && l.otherReference === original.reference)).toBe(true);
  });

  test('TC-ST-021 Cancellation request', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const r = await ok<{ mode: string }>((await apiAs('customer')).post(`/api/tickets/${tk.id}/cancel`, { data: { reason: 'No longer needed (automated test).' } }));
    test.skip(r.mode === 'cancelled', 'settings cancel at once; no request to decide');
    const page = await asRole('teamLeader');
    await openTicket(page, tk.id);
    await expect(main(page).getByText(t('Lifecycle.staff.requestTitle'))).toBeVisible();
    await page.locator('#cr-note').fill('We will keep working on it (automated test).');
    await main(page).getByRole('button', { name: t('Lifecycle.staff.reject') }).click();
    await expect(main(page).getByText(t('Lifecycle.staff.requestTitle'))).toHaveCount(0);
    const lc = await ok<{ cancellation: { status: string } | null }>((await apiAs('customer')).get(`/api/tickets/${tk.id}/lifecycle`));
    expect(lc.cancellation?.status).not.toBe('pending');
  });

  test('TC-ST-022 Create a ticket for a customer', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const dir = await ok<{ id: string; email: string; organizationId: string | null; branchId: string | null }[]>(admin.get('/api/tickets/customers'));
    const me = dir.find((x) => x.email.toLowerCase() === CUSTOMER)!;
    const page = await asRole('admin');                                           // agents/leaders here lack "create for customer"
    await go(page, '/en/console/tickets/new');
    await page.locator('#st-org').selectOption(me.organizationId ?? 'none');
    if (me.branchId) await page.locator('#st-branch').selectOption(me.branchId);
    await page.locator('#st-customer').selectOption(me.id);
    await page.locator('#typeId').selectOption({ index: 1 });
    await page.locator('#cat').selectOption({ index: 1 });
    for (const f of await page.locator('[id^="cf-"]').all()) {
      const kind = await f.evaluate((e) => e.tagName + ':' + ((e as HTMLInputElement).type || ''));
      if (kind.startsWith('SELECT')) await f.selectOption({ index: 1 }); else if (kind.endsWith(':checkbox')) await f.check();
      else if (kind.endsWith(':number')) await f.fill('1'); else if (kind.endsWith(':date')) await f.fill('2026-01-01'); else await f.fill('E2E value');
    }
    if (await page.locator('#prio').count()) await page.locator('#prio').selectOption({ index: 1 });
    const subject = stamp('E2E staff-created');
    await page.locator('#subject').fill(subject);
    await page.locator('#desc').fill('Created for the customer by the automated browser tests.');
    await main(page).getByRole('button', { name: t('NewTicket.submit') }).click();
    await expect(main(page).getByText(/^Ticket [A-Z]+-\d{4}-\d{6} was created\.$/)).toBeVisible();   // StaffTicket.created
    const list = await ok<{ items: { subject: string }[] }>((await apiAs('customer')).get(`/api/tickets?view=mine&search=${encodeURIComponent(subject)}&page=1&pageSize=5`));
    expect(list.items.map((x) => x.subject)).toContain(subject);                 // belongs to the customer
  });

  manual('TC-ST-023', 'SLA clock', 'needs watching the timers over business hours');
  manual('TC-ST-024', 'Overdue and due soon', 'needs a ticket to pass its SLA target (waiting time)');

  test('TC-ST-025 Activity history', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    await move(await apiAs('teamLeader'), tk.id, 'in_progress');
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    const act = main(page).locator('section').filter({ has: page.getByRole('heading', { name: t('Console.ticket.activity') }) });
    await expect(act.getByText(t('StaffStatus.in_progress')).first()).toBeVisible();
    await expect(act.getByText(ACCOUNTS.teamLeader.name).first()).toBeVisible();      // who
  });

  test('TC-ST-026 Read-only ticket for viewers', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    await reply(await apiAs('teamLeader'), tk.id, 'public_reply', 'Staff reply for the viewer check, automated test.');
    const page = await asRole('viewer');
    await openTicket(page, tk.id);
    await expect(main(page).getByText(t('Console.readOnly'))).toBeVisible();
    await expect(main(page).getByText('Staff reply for the viewer check, automated test.')).toBeVisible();
    await expect(page.locator('#body')).toHaveCount(0);
    await expect(page.locator('#to')).toHaveCount(0);
    await expect(page.locator('#as-agent')).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: t('Console.assignForm.claim') })).toHaveCount(0);
  });

  test('TC-ST-027 Attachments download', async ({ asRole, apiAs }) => {
    const tk = await fresh(apiAs);
    const page = await asRole('agent');
    await openTicket(page, tk.id);
    await page.locator('#body').fill('Attachment for the download check, automated test.');
    await main(page).locator('input[type=file]').setInputFiles({ name: 'download-me.png', mimeType: 'image/png', buffer: PNG });
    await main(page).getByRole('button', { name: t('Console.reply.submit'), exact: true }).click();
    await expect(main(page).getByText(t('Console.reply.sentPublic'))).toBeVisible();
    const dl = page.waitForEvent('download');
    await main(page).getByRole('button', { name: /download-me\.png/ }).first().click();
    expect((await dl).suggestedFilename()).toBe('download-me.png');
    const att = (await ticket(await apiAs('agent'), tk.id)).messages.flatMap((m: { attachments: { id: string }[] }) => m.attachments)[0];
    const anon = await page.request.get(`/api/tickets/${tk.id}/attachments/${att.id}`, { headers: { Authorization: '' } });
    expect([401, 403, 404]).toContain(anon.status());                            // no access without a session
  });
});
