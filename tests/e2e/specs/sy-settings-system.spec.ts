import { expect, go, manual, open, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "SY Settings system". System settings act on the whole site, so changing them stays manual; the browser checks
 * what the pages show and what the public site info reports.
 */
const TABS = ['', 'home', 'menus', 'email', 'templates', 'messages', 'uploads', 'system', 'signin-codes', 'handover'];

test.describe('SY Settings system', () => {
  test('TC-SY-001 Settings tabs', async ({ asRole }) => {
    const page = await asRole('admin');
    for (const tab of TABS) {
      await go(page, `/en/admin/general/settings${tab ? '/' + tab : ''}`);
      await expect(page.locator('main h1, main h2').first(), tab || 'first tab').toBeVisible();
      await expect(page.locator('main').getByRole('alert').filter({ hasText: t('AdminCommon.errors.generic') }), `${tab} loads`).toHaveCount(0);
    }
  });

  manual('TC-SY-002', 'Registration mode', 'changes who can register on the whole site');
  manual('TC-SY-003', 'Captcha settings', 'needs Turnstile keys and changes sign-in for everyone');
  manual('TC-SY-004', 'Captcha safety', 'turning the captcha on with a bad secret affects every sign-in');
  manual('TC-SY-005', 'Password policy', 'changes the password rules for everyone');
  manual('TC-SY-006', 'Timers', 'needs waiting days for auto-close and reminders');

  test('TC-SY-007 System rules', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/system');
    const labels = await page.locator('main label').allTextContents();
    const at = (k: string) => labels.findIndex((l) => l.includes(t(k)));
    expect(at('AdminSettings.reopen'), 'reopen window field').toBeGreaterThanOrEqual(0);
    expect(at('AdminSettings.autoClose'), 'auto-close field').toBeGreaterThanOrEqual(0);
    await expect(page.locator('main').getByText(t('Required.note')).first(), 'required legend').toBeVisible();
  });

  test('TC-SY-008 Uploads', async ({ asRole, apiAs }) => {
    const site = await ok<{ site: { uploadMaxMb: number; uploadExtensions: string } }>((await apiAs('customer')).get('/api/site'));
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/uploads');
    await expect(page.locator('main input').filter({ has: page.locator('xpath=.') }).first()).toBeVisible();
    const values = await page.locator('main input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values, 'current size limit shown').toContain(String(site.site.uploadMaxMb));
    test.info().annotations.push({ type: 'note', description: 'the limits are enforced on upload: see TC-CT-010 and TC-SE-010' });
  });

  test('TC-SY-009 Sign-in codes setting', async ({ asRole, page: visitor }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/signin-codes');
    await expect(page.locator('main').getByText(/\bOn\b|\bOff\b/).first(), 'On/Off label').toBeVisible();
    await open(visitor, '/en/login');
    const info = await (await visitor.request.get('/api/site')).json();
    const link = visitor.getByRole('link', { name: t('Auth.login.codeLink') });
    if (info.signinCodes?.enabled) await expect(link).toBeVisible(); else await expect(link).toHaveCount(0);
  });

  manual('TC-SY-010', 'Handover', 'transfers the administrator role');
  manual('TC-SY-011', 'Remove demo data', 'deletes demo people and tickets');

  test('TC-SY-012 Required markers', async ({ asRole }) => {
    const page = await asRole('admin');
    for (const tab of ['system', 'email', 'uploads']) {
      await go(page, `/en/admin/general/settings/${tab}`);
      if (await page.locator('main [aria-label="required"], main abbr, main .text-danger').filter({ hasText: '*' }).count())
        await expect(page.locator('main').getByText(t('Required.note')).first(), `${tab}: legend`).toBeVisible();
    }
  });
});
