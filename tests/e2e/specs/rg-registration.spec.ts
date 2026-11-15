import type { APIRequestContext, Page } from '@playwright/test';
import { authBudget, expect, manual, open, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "RG Registration". The local copy runs in "pick organization, approval" mode; cases that need another
 * registration mode (a site setting for everyone) or the confirmation email stay manual.
 * Accounts made here use e2e.*@demo.cts.test and are deleted afterwards when the admin can see them.
 */
const newEmail = () => `${stamp('e2e reg').replace(/\s+/g, '.').toLowerCase()}@demo.cts.test`;
const phone = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const strong = () => `Reg-${Math.random().toString(36).slice(2, 10)}A9!`;

async function openRegister(page: Page, locale = 'en'): Promise<void> {
  await open(page, `/${locale}/register`);
  await expect(page.locator('input[name="fullName"]')).toBeVisible();
}
async function cleanup(admin: APIRequestContext, email: string): Promise<void> {
  const all = await ok<{ people: { id: string; email: string | null }[] }>(admin.get('/api/console/people')).catch(() => ({ people: [] }));
  for (const p of all.people.filter((x) => x.email === email)) await admin.delete(`/api/admin/users/${p.id}`);
}

test.describe('RG Registration', () => {
  test('TC-RG-001 Open registration mode', async ({ page, apiAs }) => {
    // The local copy is in approval mode; the form and the "confirm your email" step are the same in open mode.
    const email = newEmail();
    try {
      await openRegister(page);
      await page.locator('input[name="fullName"]').fill('E2E Registration');
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="phone"]').fill(phone());
      if (await page.locator('#org').count()) await page.locator('#org').selectOption({ index: 1 });
      const pw = strong();
      await page.locator('input[name="password"]').fill(pw);
      await page.locator('input[name="confirmPassword"]').fill(pw);
      await authBudget(1);
      await page.getByRole('button', { name: t('Auth.register.submit') }).click();
      await expect(page.getByRole('heading', { name: t('Auth.register.sentTitle') })).toBeVisible();   // asked to confirm the email
      await expect(page.locator('input[name="code0"]')).toBeVisible();
    } finally { await cleanup(await apiAs('admin'), email); }
  });

  manual('TC-RG-002', 'Email confirmation', 'needs the confirmation code from a mailbox');

  test('TC-RG-003 Pick organization and branch', async ({ page }) => {
    await openRegister(page);
    test.skip(!(await page.locator('#org').count()), 'registration mode does not ask for the organization');
    await expect(page.locator('#branch')).toBeDisabled();
    const orgs = await page.locator('#org option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    const seen = new Set<string>();
    for (const o of orgs.slice(0, 4)) {
      await page.locator('#org').selectOption(o);
      await expect(page.locator('#branch')).toBeEnabled();
      seen.add((await page.locator('#branch option').allTextContents()).join('|'));
    }
    if (orgs.length > 1) expect(seen.size, 'branches follow the organization').toBeGreaterThan(1);
  });

  manual('TC-RG-004', 'Approval mode', 'the account reaches Account approvals only after the email is confirmed (mailbox)');
  manual('TC-RG-005', 'Closed registration', 'needs the registration mode changed to closed for the whole site');

  test('TC-RG-006 Duplicate email or phone', async ({ page }) => {
    await openRegister(page);
    await page.locator('input[name="fullName"]').fill('E2E Duplicate');
    await page.locator('input[name="email"]').fill(ACCOUNTS.customer.email);          // an existing account
    await page.locator('input[name="phone"]').fill(phone());
    if (await page.locator('#org').count()) await page.locator('#org').selectOption({ index: 1 });
    const pw = strong();
    await page.locator('input[name="password"]').fill(pw);
    await page.locator('input[name="confirmPassword"]').fill(pw);
    await authBudget(1);
    await page.getByRole('button', { name: t('Auth.register.submit') }).click();
    // Neutral answer: the same "check your email" step, nothing says the address exists.
    await expect(page.getByRole('heading', { name: t('Auth.register.sentTitle') }).or(page.getByRole('alert'))).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/already (registered|exists|taken)/i);
    await expect(page.getByText(ACCOUNTS.customer.name)).toHaveCount(0);
  });

  test('TC-RG-007 Phone number format', async ({ page }) => {
    await openRegister(page);
    const submit = () => page.getByRole('button', { name: t('Auth.register.submit') }).click();
    await page.locator('input[name="phone"]').fill('0101234');                         // invalid
    await submit();
    await expect(page.getByText(t('Auth.errors.phoneInvalid'))).toBeVisible();
    await page.locator('input[name="phone"]').fill('01012345678');                     // valid local format
    await submit();
    await expect(page.getByText(t('Auth.errors.phoneInvalid'))).toHaveCount(0);
    // v2: the field takes the 11-digit 01... form only (max 11 characters, see the hint); +20... is not typed here.
    await expect(page.locator('input[name="phone"]')).toHaveAttribute('maxlength', '11');
    test.info().annotations.push({ type: 'v2', description: '+201012345678 is not accepted in the form: v2 asks for the 11-digit 01 number (deliberate)' });
  });

  test('TC-RG-008 Password rules and strength', async ({ page }) => {
    await openRegister(page);
    const pw = page.locator('input[name="password"]');
    const rule = (k: string) => page.locator('li').filter({ hasText: t(`Auth.password.rules.${k}`, { min: 10 }) });
    await pw.fill('abc');
    await expect(page.getByText(`${t('Auth.password.strength')}: ${t('Auth.password.levels.1')}`).first()).toBeVisible();
    await expect(rule('lower')).toContainText('✓');
    await expect(rule('upper')).toContainText('✕');
    await pw.fill('Abcdefghij1!');
    for (const k of ['length', 'upper', 'lower', 'number', 'special']) await expect(rule(k)).toContainText('✓');
    await expect(page.getByText(`${t('Auth.password.strength')}: ${t('Auth.password.levels.4')}`).first()).toBeVisible();
    await page.locator('input[name="confirmPassword"]').fill('Abcdefghij1?');
    await page.getByRole('button', { name: t('Auth.register.submit') }).click();
    await expect(page.getByRole('heading', { name: t('Auth.register.sentTitle') }), 'mismatch refused').toHaveCount(0);
    await page.locator('input[name="confirmPassword"]').fill('Abcdefghij1!');
    await expect(page.getByText(t('Auth.password.match'))).toBeVisible();
  });

  test('TC-RG-009 Show-password eye button', async ({ page }) => {
    await openRegister(page);
    for (const name of ['password', 'confirmPassword']) {
      const field = page.locator(`input[name="${name}"]`);
      await field.fill('Some-Password-1!');
      await expect(field).toHaveAttribute('type', 'password');
      await field.locator('xpath=..').getByRole('button', { name: t('Auth.password.show') }).click();
      await expect(field).toHaveAttribute('type', 'text');
    }
  });

  manual('TC-RG-010', 'Captcha on sign-up (when enabled)', 'run with the captcha switched on (see AU TC-AU-021)');

  test('TC-RG-011 Arabic registration form', async ({ page }) => {
    await openRegister(page, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const ar = await import('node:fs').then((fs) => JSON.parse(fs.readFileSync(require.resolve('../../../src/Ccs.Web/public/i18n/ar.json'), 'utf8')));
    await expect(page.getByText(ar.Auth.register.title)).toBeVisible();
    await page.getByRole('button', { name: ar.Auth.register.submit }).click();
    await expect(page.getByText(ar.Auth.errors.nameRequired)).toBeVisible();           // messages in Arabic
    test.info().annotations.push({ type: 'manual part', description: 'the Arabic confirmation email needs a mailbox' });
  });
});
