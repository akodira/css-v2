import type { Page } from '@playwright/test';
import { expect, go, manual, stamp, test } from '../support/fixtures';
import { move, ok, PNG, reply, resolve, ticket, ticketFor } from '../support/data';
import { ACCOUNTS } from '../support/accounts';
import { t } from '../support/i18n';

/**
 * Sheet "CT Customer tickets". Signed in once as the test customer (Sara Banha); staff steps are done through the API
 * as the team leader, the same calls the console makes. Every ticket made here has a subject starting with "E2E".
 */
test.describe('CT Customer tickets', () => {
  let page: Page;
  test.beforeEach(async ({ asRole }) => { page = await asRole('customer'); });

  const main = () => page.locator('main');
  /** A fresh ticket of the test customer (created by the admin for her, see ticketFor). */
  const mine = async (apiAs: (r: 'admin') => Promise<import('@playwright/test').APIRequestContext>) => ticketFor(await apiAs('admin'), ACCOUNTS.customer.email);

  test('TC-CT-001 Customer home and frame', async () => {
    await go(page, '/en');
    const menu = page.getByRole('navigation', { name: t('Shell.menu') }).last();
    for (const label of [t('Nav.home'), t('Nav.tickets')]) await expect(menu.getByRole('link', { name: label })).toBeVisible();
    await expect(menu.getByRole('link', { name: t('Notifications.title') })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${t('Shell.bell')}`) }).or(page.getByRole('button', { name: new RegExp(`^${t('Shell.bell')}`) })).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('Shell.signOut') }).or(page.getByRole('button', { name: t('Shell.accountMenu') })).first()).toBeVisible();
  });

  test('TC-CT-002 My tickets list and cards', async ({ apiAs }) => {
    await go(page, '/en/tickets');
    await expect(page.getByRole('heading', { level: 1, name: t('Tickets.title') })).toBeVisible();
    const api = await apiAs('customer');
    const sum = await ok<Record<string, number>>(api.get('/api/tickets/summary?mine=true'));
    for (const k of ['active', 'waiting', 'resolved', 'closed']) {
      const card = main().locator('dl button').filter({ hasText: t(`Tickets.summary.${k}`) });
      await expect(card.locator('dd')).toHaveText(String(sum[k] ?? 0));
      const list = await ok<{ total: number }>(api.get(`/api/tickets?view=mine&group=${k}&page=1&pageSize=1`));
      expect(list.total, `card ${k} = list total`).toBe(sum[k] ?? 0);
    }
  });

  test('TC-CT-003 Filter by card or status', async () => {
    await go(page, '/en/tickets');
    const filters = main().getByRole('navigation', { name: t('Tickets.title') });
    await filters.getByRole('button', { name: t('Tickets.filters.closed') }).click();
    await expect(page).toHaveURL(/filter=closed/);
    const rows = main().locator('tbody tr');
    if (await rows.count()) await expect(rows.first().locator('td').nth(3)).toContainText(t('CustomerStatus.closed'));
    await filters.getByRole('button', { name: t('Tickets.filters.all') }).click();
    await expect(page).not.toHaveURL(/filter=/);
    await main().locator('dl button').filter({ hasText: t('Tickets.summary.waiting') }).click();
    await expect(page).toHaveURL(/filter=waiting/);
  });

  test('TC-CT-004 Search by reference or subject', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await go(page, '/en/tickets');
    await page.locator('#q').fill(tk.subject);
    await main().getByRole('button', { name: t('Tickets.searchButton') }).click();
    await expect(main().locator('tbody tr')).toHaveCount(1);
    await expect(main().locator('tbody tr').first()).toContainText(tk.reference);
    await page.locator('#q').fill(tk.reference);
    await main().getByRole('button', { name: t('Tickets.searchButton') }).click();
    await expect(main().locator('tbody tr')).toHaveCount(1);
  });

  test('TC-CT-005 Sort columns', async () => {
    await go(page, '/en/tickets');
    const th = main().locator('thead th').filter({ hasText: t('Tickets.col.created') });
    await th.getByRole('button').first().click();
    await expect(page).toHaveURL(/sort=created/);
    const dir1 = /dir=(asc|desc)/.exec(page.url())?.[1];
    await th.getByRole('button').first().click();
    await expect.poll(() => /dir=(asc|desc)/.exec(page.url())?.[1]).not.toBe(dir1);
  });

  test('TC-CT-006 Auto refresh and Pause', async () => {
    test.setTimeout(75_000);
    await go(page, '/en/tickets');
    await expect(main().getByText(t('AutoRefresh.note', { seconds: 30 }))).toBeVisible();
    const refreshed = page.waitForRequest((r) => /\/api\/tickets\?/.test(r.url()), { timeout: 40_000 });
    await refreshed;                                                    // the list reloads by itself
    await main().getByRole('button', { name: t('AutoRefresh.pause') }).click();
    await expect(main().getByText(t('AutoRefresh.paused'))).toBeVisible();
    let calls = 0;
    const count = (r: { url(): string }) => { if (/\/api\/tickets\?/.test(r.url())) calls++; };
    page.on('request', count);
    await page.waitForTimeout(32_000);
    page.off('request', count);
    expect(calls, 'no reload while paused').toBe(0);
    await main().getByRole('button', { name: t('AutoRefresh.resume') }).click();
  });

  test('TC-CT-007 Create a ticket', async () => {
    await go(page, '/en/tickets/new');
    await page.locator('#typeId').selectOption({ index: 1 });
    await page.locator('#cat').selectOption({ index: 1 });
    // fill any required custom field of that category with something valid
    for (const f of await page.locator('[id^="cf-"]').all()) {
      const tag = await f.evaluate((e) => e.tagName + ':' + ((e as HTMLInputElement).type || ''));
      if (tag.startsWith('SELECT')) await f.selectOption({ index: 1 });
      else if (tag.endsWith(':checkbox')) await f.check();
      else if (tag.endsWith(':number')) await f.fill('1');
      else if (tag.endsWith(':date')) await f.fill('2026-01-01');
      else await f.fill('E2E value');
    }
    if (await page.locator('#prio').count()) await page.locator('#prio').selectOption({ index: 1 });
    const subject = stamp('E2E new ticket');
    await page.locator('#subject').fill(subject);
    await page.locator('#desc').fill('Created by the automated browser tests with an attachment.');
    await page.locator('input[type=file]').setInputFiles({ name: 'e2e-proof.png', mimeType: 'image/png', buffer: PNG });
    await main().getByRole('button', { name: t('NewTicket.submit') }).click();
    await expect(page).toHaveURL(/\/en\/tickets\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(main().getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expect(main().getByText(/^[A-Z]+-(\d{4}-\d{6}|\d{2}-\d{4,})$/)).toBeVisible();          // reference like REQ-26-0123 (older: CTS-2026-000123)
    await expect(main().getByRole('button', { name: /e2e-proof\.png/ })).toBeVisible();
  });

  test('TC-CT-008 Ticket type and subcategory', async ({ apiAs }) => {
    const o = await ok<{ types: { id: string; categoryIds: string[] }[]; categories: { id: string }[] }>((await apiAs('customer')).get('/api/tickets/options'));
    await go(page, '/en/tickets/new');
    await expect(page.locator('#cat')).toBeDisabled();                               // type first
    for (const ty of o.types.slice(0, 3)) {
      await page.locator('#typeId').selectOption(ty.id);
      await expect(page.locator('#cat')).toBeEnabled();
      const shown = await page.locator('#cat option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
      expect(shown.sort(), 'categories of this type only').toEqual(o.categories.filter((c) => ty.categoryIds.includes(c.id)).map((c) => c.id).sort());
    }
  });

  test('TC-CT-009 Required fields on new ticket', async () => {
    let posted = 0;
    const count = (r: { url(): string; method(): string }) => { if (r.method() === 'POST' && /\/api\/tickets$/.test(r.url())) posted++; };
    page.on('request', count);
    await go(page, '/en/tickets/new');
    await main().getByRole('button', { name: t('NewTicket.submit') }).click();
    await expect(main().getByText(t('NewTicket.errors.typeRequired'))).toBeVisible();
    await expect(main().getByText(t('NewTicket.errors.categoryRequired'))).toBeVisible();
    await expect(main().getByText(t('NewTicket.errors.subjectLength'))).toBeVisible();
    await expect(main().getByText(t('NewTicket.errors.descriptionLength'))).toBeVisible();
    await expect(page).toHaveURL(/\/tickets\/new/);
    page.off('request', count);
    expect(posted, 'nothing created').toBe(0);
  });

  test('TC-CT-010 Attachment rules', async () => {
    await go(page, '/en/tickets/new');
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024, 1) });
    await expect(main().getByText(t('Files.tooLarge', { name: 'big.pdf', mb: 10 }))).toBeVisible();
    await main().getByRole('button', { name: t('Files.remove') }).click();
    await input.setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(main().getByText(t('Files.badType', { name: 'tool.exe' }))).toBeVisible();
    await main().getByRole('button', { name: t('Files.remove') }).click();
    await input.setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: PNG });
    await expect(main().getByText(/ok\.png/)).toBeVisible();
    await expect(main().getByText(t('Files.badType', { name: 'ok.png' }))).toHaveCount(0);
  });

  test('TC-CT-011 Ticket page', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await go(page, `/en/tickets/${tk.id}`);
    await expect(main().getByRole('heading', { level: 1, name: tk.subject })).toBeVisible();
    await expect(main().getByText(tk.reference)).toBeVisible();
    await expect(main().getByText(t('CustomerStatus.new')).first()).toBeVisible();
    await expect(main().getByRole('heading', { name: t('Ticket.conversation') })).toBeVisible();
    await expect(main().getByText(/SLA/i)).toHaveCount(0);                            // no SLA clocks for customers
  });

  test('TC-CT-012 Reply to a ticket', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await go(page, `/en/tickets/${tk.id}`);
    const body = `${stamp('E2E customer reply')} with enough text to pass the minimum length.`;
    await page.locator('#reply').fill(body);
    await page.locator('input[type=file]').setInputFiles({ name: 'reply-proof.png', mimeType: 'image/png', buffer: PNG });
    await main().getByRole('button', { name: t('Ticket.reply.submit') }).click();
    await expect(main().getByText(t('Ticket.reply.sent'))).toBeVisible();
    await expect(main().locator('article').filter({ hasText: body })).toBeVisible();
    await expect(main().getByRole('button', { name: /reply-proof\.png/ })).toBeVisible();
  });

  test('TC-CT-013 Waiting for you', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    const staff = await apiAs('teamLeader');
    await reply(staff, tk.id, 'public_reply', 'Could you please send us more details about this problem?');
    await move(staff, tk.id, 'pending_customer');
    await go(page, `/en/tickets/${tk.id}`);
    await expect(main().locator('header').getByText(t('CustomerStatus.pending_customer'))).toBeVisible();
    await page.locator('#reply').fill('Here are the extra details you asked for, thank you.');
    await main().getByRole('button', { name: t('Ticket.reply.submit') }).click();
    await expect(main().getByText(t('Ticket.reply.sent'))).toBeVisible();
    await expect.poll(async () => (await ticket(staff, tk.id)).status).not.toBe('pending_customer');
  });

  test('TC-CT-014 Confirm a resolution', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await resolve(await apiAs('teamLeader'), tk.id);
    await go(page, `/en/tickets/${tk.id}`);
    await expect(main().getByText(t('Ticket.reply.resolvedNote'))).toBeVisible();
    await main().getByRole('button', { name: t('Ticket.close.button') }).click();
    await expect(main().locator('header').getByText(t('CustomerStatus.closed'))).toBeVisible();
    await expect(main().getByRole('heading', { name: t('Ticket.feedback.title') })).toBeVisible();
    await expect(main().getByRole('radio', { name: t('Ticket.feedback.star', { n: 5 }) })).toBeAttached();
  });

  test('TC-CT-015 Reopen after resolution', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await resolve(await apiAs('teamLeader'), tk.id);
    await go(page, `/en/tickets/${tk.id}`);
    await page.locator('#reopen').fill('The problem came back this morning.');
    await main().getByRole('button', { name: t('Ticket.reopen.submit'), exact: true }).click();
    await expect(main().locator('header').getByText(t('CustomerStatus.reopened'))).toBeVisible();
  });

  manual('TC-CT-016', 'Reopen after the period', 'needs a ticket closed longer ago than the reopen period (30 days)');

  test('TC-CT-017 Cancel a ticket', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await go(page, `/en/tickets/${tk.id}`);
    await main().getByRole('button', { name: t('Lifecycle.customer.open') }).click();
    await page.locator('#cancel-reason').fill('I solved it myself, thank you.');
    await main().getByRole('button', { name: t('Lifecycle.customer.submit') }).click();
    await expect(main().getByText(t('Lifecycle.customer.cancelled')).or(main().getByText(t('Lifecycle.customer.requested')))).toBeVisible();
  });

  test('TC-CT-018 Follow-up on a closed ticket', async ({ apiAs }) => {
    const cust = await apiAs('customer');
    const tk = await mine(apiAs);
    await resolve(await apiAs('teamLeader'), tk.id);
    await ok(cust.post(`/api/tickets/${tk.id}/status`, { data: { to: 'closed' } }));
    await go(page, `/en/tickets/${tk.id}`);
    await main().getByRole('link', { name: t('Lifecycle.customer.createFollowUp') }).click();
    await expect(page).toHaveURL(/followUp=/);
    await expect(main().getByText(t('Lifecycle.customer.followUpNotice', { reference: tk.reference }))).toBeVisible();
    await page.locator('#typeId').selectOption({ index: 1 });
    await page.locator('#cat').selectOption({ index: 1 });
    if (await page.locator('#prio').count()) await page.locator('#prio').selectOption({ index: 1 });
    await page.locator('#subject').fill(stamp('E2E follow-up'));
    await page.locator('#desc').fill('Follow-up created by the automated browser tests.');
    test.skip(await page.locator('[id^="cf-"]').count() > 0, 'first category has custom fields; covered by TC-CT-007');
    await main().getByRole('button', { name: t('NewTicket.submit') }).click();
    await expect(page).toHaveURL(/\/en\/tickets\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(main().getByText(t('Lifecycle.customer.followUpOf', { reference: tk.reference }).trim().split(tk.reference)[0].trim())).toBeVisible();
  });

  test('TC-CT-019 Rating', async ({ apiAs }) => {
    const cust = await apiAs('customer');
    const tk = await mine(apiAs);
    await resolve(await apiAs('teamLeader'), tk.id);
    await ok(cust.post(`/api/tickets/${tk.id}/status`, { data: { to: 'closed' } }));
    await go(page, `/en/tickets/${tk.id}`);
    await main().getByRole('radio', { name: t('Ticket.feedback.star', { n: 4 }) }).check({ force: true });
    await page.locator('#fb-comment').fill('Quick and helpful.');
    await main().getByRole('button', { name: t('Ticket.feedback.submit') }).click();
    await expect(main().getByText(t('Ticket.feedback.thanks'))).toBeVisible();
    await expect(main().getByRole('button', { name: t('Ticket.feedback.update') })).toBeVisible();   // saved once, can only be updated
  });

  test('TC-CT-020 Customer cannot see others\' tickets', async ({ apiAs }) => {
    const staff = await apiAs('teamLeader');
    const list = await ok<{ items: { id: string; requesterEmail: string }[] }>(staff.get('/api/tickets?page=1&pageSize=50'));
    const other = list.items.find((x) => x.requesterEmail && x.requesterEmail.toLowerCase() !== 'sara.banha@demo.cts.test');
    test.skip(!other, 'no ticket of another customer visible to the team leader');
    await go(page, `/en/tickets/${other!.id}`);
    await expect(main().getByText(t('Ticket.errors.notFound'))).toBeVisible();
    const r = await (await apiAs('customer')).get(`/api/tickets/${other!.id}`);
    expect([403, 404]).toContain(r.status());
  });

  test('TC-CT-021 Notifications bell', async ({ apiAs }) => {
    const tk = await mine(apiAs);
    await reply(await apiAs('teamLeader'), tk.id, 'public_reply', 'Thank you, we are looking into this request now.');
    await go(page, '/en/notifications');
    await expect(page.getByRole('heading', { level: 1, name: t('Notifications.title') })).toBeVisible();
    const item = main().locator('li, article').filter({ hasText: tk.reference }).first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    await main().getByRole('button', { name: t('Notifications.markAll') }).click();
    await expect(main().getByText(t('Notifications.unread'), { exact: true })).toHaveCount(0);
    await item.getByRole('link', { name: t('Notifications.open') }).first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${tk.id}`));
  });
});
