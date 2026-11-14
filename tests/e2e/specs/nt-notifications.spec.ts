import { expect, go, manual, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, reply, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "NT Notifications". Events are caused through the API as staff; the customer page shows the result. */
test.describe('NT Notifications', () => {
  test('TC-NT-001 Bell count', async ({ asRole, apiAs }) => {
    const cust = await apiAs('customer');
    const before = await ok<{ unread?: number; unreadCount?: number }>(cust.get('/api/notifications?page=1&pageSize=1')).catch(() => ({}) as { unread?: number });
    const tk = await ticketFor(await apiAs('admin'), ACCOUNTS.customer.email);
    await reply(await apiAs('teamLeader'), tk.id, 'public_reply', 'A staff reply that should ring the bell (automated test).');
    const page = await asRole('customer');
    await go(page, '/en/tickets');
    await page.reload();                                                                 // the count comes with the session data
    await expect(page.getByRole('link', { name: /Notifications, \d+ unread/ }).first(), 'bell shows the unread count').toBeVisible();
    void before;
  });

  test('TC-NT-002 Notifications page', async ({ asRole, apiAs }) => {
    const tk = await ticketFor(await apiAs('admin'), ACCOUNTS.customer.email);
    await reply(await apiAs('teamLeader'), tk.id, 'public_reply', 'Reply for the notifications page check (automated test).');
    const page = await asRole('customer');
    await go(page, '/en/notifications');
    const item = page.locator('main li, main article').filter({ hasText: tk.reference }).first();
    await expect(item).toBeVisible();
    await expect(item.getByText(t('Notifications.unread'), { exact: true }).first()).toBeVisible();
    await item.getByRole('link', { name: t('Notifications.open') }).first().click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${tk.id}`));
  });

  test('TC-NT-003 Mark all as read', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/en/notifications');
    const btn = page.getByRole('button', { name: t('Notifications.markAll') });
    if (await btn.isVisible()) await btn.click();
    await expect(page.locator('main').getByText(t('Notifications.unread'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: t('Shell.bell'), exact: true }).first(), 'count resets').toBeVisible();
  });

  manual('TC-NT-004', 'SLA warning notification', 'needs a ticket near its SLA target (waiting time) and the jobs on');

  test('TC-NT-005 Staff notifications page in frame', async ({ asRole }) => {
    const page = await asRole('agent');
    await go(page, '/en/console/dashboard');
    await page.getByRole('link', { name: new RegExp(`^${t('Shell.bell')}`) }).first().click();
    await expect(page).toHaveURL(/\/en\/console\/notifications$/);
    await expect(page.getByRole('heading', { level: 1, name: t('Notifications.title') })).toBeVisible();
    await expect(page.getByRole('navigation', { name: t('Shell.menu') }).first()).toBeVisible();
  });
});
