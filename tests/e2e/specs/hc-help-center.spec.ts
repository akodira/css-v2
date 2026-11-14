import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, go, test } from '../support/fixtures';
import { t } from '../support/i18n';

/** Sheet "HC Help Center" (the in-app guide at /help, /console/help, /admin/general/help). */
const AR = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'Ccs.Web', 'public', 'i18n', 'ar.json'), 'utf8'));
const topics = (page: Page) => page.locator('main article h2, main article h3, main li h3, main [role="listitem"] h3, main details summary');
async function topicCount(page: Page): Promise<number> { await page.waitForLoadState('networkidle').catch(() => undefined); return topics(page).count(); }

test.describe('HC Help Center', () => {
  test('TC-HC-001 Customer sees customer topics only', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/en/help');
    await expect(page.getByRole('heading', { level: 1, name: t('Help.title') })).toBeVisible();
    await expect(page.locator('main').getByText(t('Help.subtitleCustomer'))).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/SLA settings|Account types|Scoped admin|Handover/i);
  });

  test('TC-HC-002 Staff topics by permission', async ({ asRole }) => {
    const agent = await asRole('agent');
    await go(agent, '/en/console/help');
    await expect(agent.locator('main').getByText(t('Help.subtitleStaff'))).toBeVisible();
    const nAgent = await topicCount(agent);
    const admin = await asRole('admin');
    await go(admin, '/en/admin/general/help');
    const nAdmin = await topicCount(admin);
    expect(nAgent, 'agent sees fewer topics than the admin').toBeLessThan(nAdmin);
    await expect(agent.locator('main')).not.toContainText(/Handover|Remove demo data/i);
  });

  test('TC-HC-003 Admin sees everything', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/help');
    await expect(page.locator('main').getByText(t('Help.subtitleAdmin'))).toBeVisible();
    for (const word of [/SLA/i, /settings/i, /scoped|organization admin|branch admin/i]) await expect(page.locator('main'), String(word)).toContainText(word);
  });

  test('TC-HC-004 Search', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/help');
    await page.getByRole('searchbox', { name: t('Help.searchLabel') }).or(page.getByPlaceholder(t('Help.searchPlaceholder'))).first().fill('password');
    await page.keyboard.press('Enter');
    await expect(page.locator('main').getByText(/result/i).first()).toBeVisible();
    await expect(page.locator('main')).toContainText(/password/i);
  });

  test('TC-HC-005 Area navigation and tabs', async ({ asRole }) => {
    const page = await asRole('admin');
    await go(page, '/en/admin/general/help');
    for (const tab of ['features', 'flows', 'howto']) {
      const b = page.getByRole('tab', { name: new RegExp(t(`Help.tab.${tab}`)) }).or(page.getByRole('button', { name: new RegExp(t(`Help.tab.${tab}`)) })).first();
      await b.click();
      const label = (await b.textContent()) ?? '';
      const n = /(\d+)/.exec(label)?.[1];
      if (n) await expect.poll(() => topicCount(page), `${tab}: count matches`).toBe(Number(n));
    }
  });

  test('TC-HC-006 Open this page link', async ({ asRole }) => {
    const page = await asRole('agent');
    await go(page, '/en/console/help');
    const link = page.getByRole('link', { name: t('Help.openPage') }).first();
    test.skip(!(await link.count()), 'no topic with a page link for this role');
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp((href ?? '').replace(/[?.]/g, '\\$&')));
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('TC-HC-007 Arabic Help Center', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/ar/help');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: AR.Help.title })).toBeVisible();
    const text = await page.locator('main').innerText();
    const latinWords = (text.match(/\b[A-Za-z]{4,}\b/g) ?? []).filter((w) => !/AZKA|Technology|CTS|Email|SLA|PDF|CSV/i.test(w));
    expect(latinWords.length, `English words left: ${latinWords.slice(0, 8).join(', ')}`).toBeLessThan(5);
    await go(page, '/en/help');
  });

  test('TC-HC-008 Customer Help uses the portal frame', async ({ asRole }) => {
    const page = await asRole('customer');
    await go(page, '/en');
    await page.getByRole('navigation', { name: t('Shell.menu') }).last().getByRole('link', { name: t('Nav.help') }).click();
    await expect(page).toHaveURL(/\/en\/help$/);
    await expect(page.getByRole('navigation', { name: t('Shell.menu') }).last().getByRole('link', { name: t('Nav.tickets') }), 'customer side menu').toBeVisible();
  });
});
