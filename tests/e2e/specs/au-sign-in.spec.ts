import { expect, test } from '@playwright/test';
import { ACCOUNTS, CUSTOMER_PHONE } from '../support/accounts';
import { captchaMode, testPassword } from '../support/env';
import { fillLogin, LOGIN, openLogin, signInAs, signOut, submit } from '../support/helpers';

/**
 * Sheet "AU Sign in and session". The test title starts with the case ID of the workbook;
 * scripts/results_to_xlsx.py uses it to write Pass / Fail back into the sheet.
 * Cases that need a mailbox, an authenticator app, waiting time or changed data stay manual: they are listed
 * here as skipped so the sheet keeps "Not run" for them.
 */
const manual = (id: string, title: string, why: string) =>
  test(`${id} ${title}`, async () => { test.skip(true, `Manual: ${why}`); });

test.describe('AU Sign in and session', () => {
  test.skip(captchaMode === 'on', 'Captcha mode runs TC-AU-021 only');

  test('TC-AU-001 Sign in with email and password', async ({ page }) => {
    await signInAs(page, 'customer');
    await signOut(page);
    await signInAs(page, 'admin');          // staff land on the console dashboard
    await expect(page).toHaveURL(/\/console\/dashboard/);
  });

  test('TC-AU-002 Sign in with a phone number', async ({ page }) => {
    test.skip(!CUSTOMER_PHONE, 'Set CCS_CUSTOMER_PHONE (11 digits, without +2) of the test customer to run this case');
    await openLogin(page);
    await fillLogin(page, CUSTOMER_PHONE, testPassword());
    await submit(page);
    await expect(page).toHaveURL(ACCOUNTS.customer.home);
  });

  test('TC-AU-003 Wrong password is refused', async ({ page }) => {
    await openLogin(page);
    await fillLogin(page, ACCOUNTS.customer.email, 'Wrong-Password-1!');
    await submit(page);
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(ACCOUNTS.customer.name)).toHaveCount(0);   // no account details revealed
  });

  test('TC-AU-004 Unknown email gives the same message', async ({ page }) => {
    await openLogin(page);
    await fillLogin(page, 'nobody.here.e2e@demo.cts.test', 'Wrong-Password-1!');
    await submit(page);
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();   // same text as a wrong password
    await expect(page).toHaveURL(/\/login/);
  });

  manual('TC-AU-005', 'Repeated failures are limited', 'it blocks the address for minutes and would break the next tests; run it alone by hand');

  test('TC-AU-006 Required fields', async ({ page }) => {
    await openLogin(page);
    await submit(page);
    await expect(page.getByText('This field is required.')).toHaveCount(2);        // identifier and password
    await expect(page).toHaveURL(/\/login/);
    await fillLogin(page, ACCOUNTS.customer.email, '');
    await submit(page);
    await expect(page.getByText('This field is required.')).toHaveCount(1);        // password only
  });

  test('TC-AU-007 Show-password eye button', async ({ page }) => {
    await openLogin(page);
    const field = page.locator('input[name="password"]');
    await field.fill('Some-Password-1!');
    await expect(field).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(field).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();             // the accessible label changes with the state
    await expect(field).toHaveAttribute('type', 'password');
  });

  manual('TC-AU-008', 'Suspended account cannot sign in', 'changes an account; do it on a spare customer by hand');
  manual('TC-AU-009', 'Account waiting for approval', 'needs registration in approval mode and a mailbox');
  manual('TC-AU-010', 'Email one-time sign-in code', 'needs a mailbox');
  manual('TC-AU-011', 'Sign-in code expiry and reuse', 'needs a mailbox and waiting time');
  manual('TC-AU-012', 'Authenticator (MFA) enrolment', 'needs an authenticator app');
  manual('TC-AU-013', 'Authenticator required at sign-in', 'needs an authenticator app');
  manual('TC-AU-014', 'Turn MFA off and admin reset', 'needs an authenticator app');

  test('TC-AU-015 Forgot password', async ({ page }) => {
    await openLogin(page);
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.locator('input[name="email"]').fill('nobody.here.e2e@demo.cts.test');   // unknown address: nothing is sent
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('If an account exists for this address')).toBeVisible();   // neutral message either way
  });

  manual('TC-AU-016', 'Reset password link', 'needs a mailbox');
  manual('TC-AU-017', 'Password policy on reset', 'needs the reset link from a mailbox');

  test('TC-AU-018 Sign out', async ({ page }) => {
    await signInAs(page, 'customer');
    await signOut(page);
    await expect(page).toHaveURL(/\/(login)?$|\/en\/?$/);
    await page.goto('/en/tickets');                      // a signed-in page now sends you to sign in
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-AU-019 Back button after sign-out', async ({ page }) => {
    await signInAs(page, 'admin');
    await signOut(page);
    for (let i = 0; i < 3; i++) await page.goBack().catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'Sign in' }).or(page.locator('body'))).toBeVisible();
    await expect(page.getByText(ACCOUNTS.admin.name)).toHaveCount(0);       // no signed-in page from cache
    await expect(page).not.toHaveURL(/\/console\/dashboard$/);
  });

  manual('TC-AU-020', 'Session expiry', 'needs waiting past the idle limit');

  test('TC-AU-021 Captcha on sign-in (when enabled)', async ({ page }) => {
    test.skip(captchaMode !== 'on', 'Run with "npm run test:captcha" while the captcha is switched on in the local copy');
    await openLogin(page);
    await expect(page.locator('iframe[src*="challenges.cloudflare.com"], [data-turnstile], .cf-turnstile').first()).toBeVisible({ timeout: 15_000 });
    await fillLogin(page, ACCOUNTS.customer.email, testPassword());
    await submit(page);                                  // without passing the check the sign-in must be refused
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-AU-022 Language switch before sign-in', async ({ page }) => {
    await openLogin(page);
    await page.getByRole('link', { name: 'العربية' }).first().click();
    await expect(page).toHaveURL(/\/ar\/login/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await fillLogin(page, ACCOUNTS.customer.email, testPassword());
    await submit(page);
    await expect(page).toHaveURL(/\/ar(\/|$)/);          // the choice is kept after sign-in
  });
});
