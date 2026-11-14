import type { Page } from '@playwright/test';
import { expect, go, manual, open, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { signInAs, signOut } from '../support/helpers';
import { t } from '../support/i18n';

/** Sheet "UX Language, layout, quality". */
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe('UX Language, layout, quality', () => {
  test('TC-UX-001 Arabic right-to-left', async ({ asRole }) => {
    for (const [role, urls] of [['customer', ['/ar', '/ar/tickets', '/ar/tickets/new', '/ar/account']], ['agent', ['/ar/console', '/ar/console/dashboard']]] as const) {
      const page = await asRole(role);
      for (const u of urls) {
        await go(page, u);
        await expect(page.locator('html'), u).toHaveAttribute('dir', 'rtl');
        expect(await noSideScroll(page), `${u}: no broken layout (side scroll)`).toBe(true);
      }
      await go(page, role === 'customer' ? '/en' : '/en/console/dashboard');
    }
  });

  test('TC-UX-002 Language persistence', async ({ page }) => {
    await signInAs(page, 'customer');
    await page.getByRole('link', { name: 'العربية' }).first().click();
    await expect(page).toHaveURL(/\/ar(\/|$)/);
    await page.getByRole('navigation').last().getByRole('link').nth(1).click();          // move to another page
    await expect(page).toHaveURL(/\/ar(\/|$)/);
    await page.getByRole('button', { name: 'تسجيل الخروج' }).first().click();          // Shell.signOut in Arabic
    await expect(page).toHaveURL(/\/ar(\/|$)/);                                          // still Arabic after sign-out
  });

  test('TC-UX-003 Staff sidebar groups', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/users');
    const menu = page.getByRole('navigation', { name: t('Shell.menu') }).first();
    const groups = menu.getByRole('button', { expanded: true }).or(menu.getByRole('button', { expanded: false }));
    expect(await groups.count(), 'groups').toBeGreaterThanOrEqual(3);
    const people = menu.getByRole('button', { name: /People/ });
    await expect(people, 'the current page\'s group is open').toHaveAttribute('aria-expanded', 'true');
    await people.click();
    await expect(people).toHaveAttribute('aria-expanded', 'false');
    await people.click();
    await expect(people).toHaveAttribute('aria-expanded', 'true');
  });

  test('TC-UX-004 Red counts in the menu', async ({ asRole, apiAs }) => {
    const page = await asRole('admin');
    await go(page, '/en/console/dashboard');
    const c = await (await (await apiAs('admin')).get('/api/console/counts')).json();
    const tickets = page.getByRole('navigation', { name: t('Shell.menu') }).first().getByRole('link', { name: new RegExp(`^${t('Shell.tickets')}`) });
    await expect(tickets).toHaveText(new RegExp(`${c.mine + c.unassigned}\\s*$`));
  });

  test('TC-UX-005 Phone width', async ({ asRole }) => {
    const page = await asRole('customer');
    await page.setViewportSize({ width: 375, height: 812 });
    try {
      for (const u of ['/en', '/en/tickets', '/en/tickets/new', '/en/account', '/en/help']) {
        await go(page, u);
        expect(await noSideScroll(page), `${u}: no horizontal scroll`).toBe(true);
      }
    } finally { await page.setViewportSize({ width: 1280, height: 800 }); }
  });

  test('TC-UX-006 Keyboard use', async ({ page }) => {
    await open(page, '/en/login');
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return { name: el.getAttribute('name') ?? el.textContent?.trim().slice(0, 20) ?? el.tagName, ring: s.outlineStyle !== 'none' || s.boxShadow !== 'none' };
      });
      if (info) { seen.push(info.name); expect(info.ring, `visible focus on ${info.name}`).toBe(true); }
    }
    expect(seen, 'email field reachable').toContain('email');
    expect(seen, 'password field reachable').toContain('password');
  });

  test('TC-UX-007 Empty states', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/en/tickets?q=zzz-no-such-ticket-zzz');
    await page.locator('#q').fill('zzz-no-such-ticket-zzz');
    await page.locator('main form[role=search] button[type=submit]').click();
    await expect(page.locator('main').getByText(t('Tickets.emptyFiltered'))).toBeVisible();
  });

  test('TC-UX-008 Error pages', async ({ page }) => {
    await open(page, '/en/this-page-does-not-exist');
    await expect(page.locator('main, body').first()).toBeVisible();
    await expect(page, 'unknown address goes to a friendly page').toHaveURL(/\/en(\/|$)/);
    await expect(page.locator('body')).not.toContainText(/Cannot GET|404 Not Found|Error:/);
  });

  test('TC-UX-009 Required markers', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/en/tickets/new');
    await expect(page.locator('main label[for="subject"]')).toContainText(/\*|required/i);
    await expect(page.locator('main').getByText(t('Required.note')).first()).toBeVisible();
  });

  test('TC-UX-010 Back button behaviour', async ({ page }) => {
    await signInAs(page, 'customer');
    await page.goto('/en/tickets');
    await page.goto('/en/account');
    await page.goBack();
    await expect(page).toHaveURL(/\/en\/tickets/);
    await signOut(page);
    for (let i = 0; i < 3; i++) await page.goBack().catch(() => undefined);
    await expect(page.getByText(ACCOUNTS.customer.name)).toHaveCount(0);
  });
});

void manual;
