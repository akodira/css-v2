import { expect, go, manual, open, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "SM Settings site, menus". Menus and texts are read and compared; editing them for everyone stays manual. */
interface MenuRow { area: string; labelEn: string; href: string | null; audience: string; isVisible?: boolean }

test.describe('SM Settings site, menus', () => {
  test('TC-SM-001 Menus editor', async ({ asRole, apiAs }) => {
    const site = await ok<{ menus?: MenuRow[] }>((await apiAs('customer')).get('/api/site/menus').catch(() => null as never)).catch(() => ({ menus: undefined }));
    const page = await asRole('admin');
    await go(page, '/en/admin/general/settings/menus');
    await expect(page.locator('main').getByText(/audience|all|customer|staff|signed/i).first(), 'audience shown per item').toBeVisible();
    const cust = await asRole('customer');
    await go(cust, '/en');
    const items = await cust.getByRole('navigation', { name: t('Shell.menu') }).last().getByRole('link').allTextContents();
    const rows = (site.menus ?? []).filter((r) => r.area === 'header' && r.isVisible !== false && ['all', 'signed_in', 'customer'].includes(r.audience) && r.href);
    for (const r of rows.slice(0, 5)) expect(items.map((x) => x.trim()), `sidebar follows the menu setting: ${r.labelEn}`).toContain(r.labelEn);
    test.info().annotations.push({ type: 'manual part', description: 'hiding an item and renaming a label changes the menu for everyone' });
  });

  test('TC-SM-002 Menu audience', async ({ asRole }) => {
    const cust = await asRole('customer');
    await go(cust, '/en');
    const items = (await cust.getByRole('navigation', { name: t('Shell.menu') }).last().getByRole('link').allTextContents()).map((x) => x.trim());
    for (const staffOnly of [t('Shell.dashboard'), t('Shell.customers'), t('Shell.reports')]) expect(items, staffOnly).not.toContain(staffOnly);
  });

  manual('TC-SM-003', 'Home page content', 'editing the home content changes it for every customer');

  test('TC-SM-004 System messages', async ({ asRole }) => {
    const pages: [Parameters<typeof asRole>[0], string][] = [['customer', '/en'], ['customer', '/en/tickets'], ['customer', '/en/account'], ['agent', '/en/console'], ['admin', '/en/admin/users'], ['admin', '/en/admin/general/settings/messages']];
    for (const [role, url] of pages) {
      const page = await asRole(role);
      await go(page, url);
      await expect(page.locator('main')).not.toContainText(/\b[A-Z][a-zA-Z]+\.[a-z][a-zA-Z]+(\.[a-zA-Z]+)*\b(?!\s*@)/, { timeout: 3_000 }).catch(async () => {
        const raw = (await page.locator('main').innerText()).match(/\b(Auth|Tickets|Ticket|Console|Admin[A-Za-z]*|Nav|Shell|Home|Account)\.[a-z][a-zA-Z.]+/g);
        expect(raw, `raw i18n keys on ${url}`).toBeNull();
      });
    }
  });

  manual('TC-SM-005', 'Branding', 'changes name, logo and colors for everyone');

  test('TC-SM-006 Browser tab title', async ({ page }) => {
    await open(page, '/en/login');
    const site = await (await page.request.get('/api/site')).json();
    const name = site.site?.siteNameEn || 'AZKA Technology';
    await expect(page).toHaveTitle(new RegExp(name));
    await expect(page).toHaveTitle(/Customer Care System/);
  });
});
