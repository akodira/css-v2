import { expect, go, manual, test } from '../support/fixtures';

/** Sheet "EM Settings email". Sending and receiving emails needs a mailbox (and Jobs are off locally), so most is manual. */
test.describe('EM Settings email', () => {
  test('TC-EM-001 SMTP or provider setup', async ({ asRole, apiAs }) => {
    const r = await (await apiAs('admin')).get('/api/admin/settings/email');
    const body = r.ok() ? await r.text() : '';
    expect(body, 'no password or key returned to the browser').not.toMatch(/"(password|smtpPassword|apiKey|secret)"\s*:\s*"[^"*]{4,}"/i);
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/email');
    const pw = page.locator('main input[type="password"]');
    if (await pw.count()) await expect(pw.first(), 'saved password is not shown').toHaveValue(/^(\*+|•+|)$/);
  });

  manual('TC-EM-002', 'Send a test email', 'needs a mailbox');
  manual('TC-EM-003', 'Notification events', 'needs a mailbox to see which emails follow the choices');

  test('TC-EM-004 Edit a template', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/templates');
    await expect(page.locator('main'), 'live preview').toContainText(/preview/i);
    test.info().annotations.push({ type: 'manual part', description: 'saving a template and checking the next email needs a mailbox' });
  });

  manual('TC-EM-005', 'Greeting and footer', 'needs a mailbox to see the emails');
  manual('TC-EM-006', 'Email design', 'needs a mailbox to compare the sent email');
  manual('TC-EM-007', 'Email queue dispatch', 'Jobs are off on the local copy and a mailbox is needed');
  manual('TC-EM-008', 'Arabic emails', 'needs a mailbox');
});
