import { expect, go, manual, test } from '../support/fixtures';

/** Sheet "OP Operations, jobs". Jobs are switched off on the local copy (Jobs:Enabled=false), so job cases stay manual. */
test.describe('OP Operations, jobs', () => {
  manual('TC-OP-001', 'Scheduler runs', 'jobs are off on the local copy; watch the server log on staging');
  manual('TC-OP-002', 'Email retries', 'needs a broken mail setting and the jobs on');
  manual('TC-OP-003', 'Backups and restore', 'restore a backup in a test environment by hand');

  test('TC-OP-004 Health check', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.status()).toBe(200);
    expect(await r.text()).toMatch(/healthy|ok/i);
  });

  test('TC-OP-005 Time zone handling', async ({ asRole, apiAs }) => {
    const items = (await (await (await apiAs('customer')).get('/api/tickets?view=mine&page=1&pageSize=1')).json()).items as { createdAt: string; reference: string }[];
    test.skip(!items.length, 'no tickets');
    const page = await asRole('customer');
    await go(page, '/en/tickets');
    const row = page.locator('main tbody tr').filter({ hasText: items[0].reference });
    const shown = (await row.locator('td').nth(4).innerText()).trim();
    const cairo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(items[0].createdAt));
    const [d] = cairo.split(' ');
    expect(shown, `shown in local (Cairo) time: ${cairo}`).toContain(d);
  });

  manual('TC-OP-006', 'Deployment settings', 'check site URL in email links on the server (needs a mailbox)');

  test('TC-OP-007 Performance', async ({ asRole }) => {
    const page = await asRole('admin');
    const t0 = Date.now();
    await go(page, '/en/console?view=all&status=any');
    await expect(page.locator('main tbody tr').first()).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - t0, 'queue opens in a few seconds').toBeLessThan(5_000);
    await expect(page.locator('main').getByText(/Page 1 of \d+/)).toBeVisible();          // paging
    test.info().annotations.push({ type: 'note', description: 'measured on the local copy, not with 5,000 tickets' });
  });
});
