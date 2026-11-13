import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, type Role } from './accounts';
import { testPassword } from './env';

export const LOGIN = '/en/login';

export async function openLogin(page: Page): Promise<void> {
  await page.goto(LOGIN);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

export async function fillLogin(page: Page, identifier: string, password: string): Promise<void> {
  await page.locator('input[name="email"]').fill(identifier);
  await page.locator('input[name="password"]').fill(password);
}

export async function submit(page: Page): Promise<void> {
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAs(page: Page, role: Role): Promise<void> {
  await openLogin(page);
  await fillLogin(page, ACCOUNTS[role].email, testPassword());
  await submit(page);
  await expect(page).toHaveURL(ACCOUNTS[role].home);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
}
