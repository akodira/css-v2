import { expect, go, open, stamp, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/**
 * Sheet "KB Knowledge base". v2 (owner decision, Nov 2026): the knowledge base needs sign-in. Visitors are sent to
 * /login?next=..., signed-in customers read it inside their frame, staff use /console/kb. Articles made here are named
 * "E2E ..." and deleted at the end.
 */
interface KbAdmin { categories: { id: string; nameEn: string; slug: string }[]; articles: { id: string; slug: string; titleEn: string; status: string; helpful?: number; notHelpful?: number }[] }
const kbAdmin = (api: import('@playwright/test').APIRequestContext) => ok<KbAdmin>(api.get('/api/admin/kb'));

test.describe('KB Knowledge base', () => {
  test('TC-KB-001 Browse and search', async ({ asRole, apiAs, page: visitor }) => {
    await open(visitor, '/en/kb');
    await expect(visitor, 'v2: visitors must sign in').toHaveURL(/\/login\?next=/);
    const list = await ok<{ items?: { titleEn: string }[] } | { titleEn: string }[]>((await apiAs('customer')).get('/api/kb'));
    const items = Array.isArray(list) ? list : list.items ?? [];
    test.skip(!items.length, 'no published articles');
    const page = await asRole('customer');
    await go(page, '/en/kb');
    await expect(page.getByRole('heading', { level: 1, name: t('Kb.title') })).toBeVisible();
    const word = items[0].titleEn.split(/\s+/).find((w) => w.length > 4) ?? items[0].titleEn;
    await page.getByRole('searchbox').first().fill(word);
    await page.getByRole('button', { name: t('Kb.searchButton') }).click();
    await expect(page.locator('main').getByText(items[0].titleEn).first()).toBeVisible();
    await expect(page.locator('main').getByText(/Last updated|\d{4}/).first(), 'date shown').toBeVisible();
  });

  test('TC-KB-002 Open an article and vote', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const cat = (await kbAdmin(admin)).categories[0];
    const slug = `e2e-${Date.now()}`;
    await ok(admin.post('/api/admin/kb-articles', { data: { categoryId: cat?.id ?? null, slug, titleEn: stamp('E2E article'), titleAr: null, bodyEn: 'Automated test article body.', bodyAr: null, status: 'published', visibility: 'public' } }));
    const art = (await kbAdmin(admin)).articles.find((a) => a.slug === slug)!;
    try {
      const page = await asRole('customer');
      await go(page, `/en/kb/${slug}`);
      await expect(page.getByText(t('Kb.wasHelpful'))).toBeVisible();
      await page.getByRole('button', { name: t('Kb.yes'), exact: true }).click();
      await expect(page.getByText(t('Kb.thanks'))).toBeVisible();
      const cust = await apiAs('customer');
      await cust.post(`/api/kb/${slug}/feedback`, { data: { helpful: true } });     // a second vote does not count twice
      const now = (await kbAdmin(admin)).articles.find((a) => a.id === art.id) as unknown as Record<string, unknown>;
      const k = Object.keys(now).find((x) => /helpful/i.test(x) && !/not/i.test(x));
      if (k) expect(now[k], 'one vote per person').toBe(1);
    } finally { await admin.delete(`/api/admin/kb-articles/${art.id}`); }
  });

  test('TC-KB-003 Write an article', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const cat = (await kbAdmin(admin)).categories[0];
    const slug = `e2e-${Date.now()}`;
    const title = stamp('E2E article');
    await ok(admin.post('/api/admin/kb-articles', { data: { categoryId: cat?.id ?? null, slug, titleEn: title, titleAr: `مقال ${title}`, bodyEn: 'English body.', bodyAr: 'نص عربي.', status: 'published', visibility: 'public' } }));
    const art = (await kbAdmin(admin)).articles.find((a) => a.slug === slug)!;
    try {
      const r = await (await apiAs('customer')).get(`/api/kb/${slug}`);
      expect(r.status(), 'visible to customers').toBe(200);
    } finally { await admin.delete(`/api/admin/kb-articles/${art.id}`); }
  });

  test('TC-KB-004 Draft and publish', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const cat = (await kbAdmin(admin)).categories[0];
    const slug = `e2e-${Date.now()}`;
    const body = { categoryId: cat?.id ?? null, slug, titleEn: stamp('E2E draft'), titleAr: null, bodyEn: 'Draft body.', bodyAr: null, status: 'draft', visibility: 'public' };
    await ok(admin.post('/api/admin/kb-articles', { data: body }));
    const art = (await kbAdmin(admin)).articles.find((a) => a.slug === slug)!;
    try {
      const cust = await apiAs('customer');
      expect((await cust.get(`/api/kb/${slug}`)).status(), 'draft hidden').toBe(404);
      await ok(admin.put(`/api/admin/kb-articles/${art.id}`, { data: { ...body, status: 'published' } }));
      expect((await cust.get(`/api/kb/${slug}`)).status(), 'published').toBe(200);
    } finally { await admin.delete(`/api/admin/kb-articles/${art.id}`); }
  });

  test('TC-KB-005 Categories first', async ({ asRole, apiAs }) => {
    const k = await kbAdmin(await apiAs('admin'));
    const page = await asRole('admin');
    await go(page, '/en/admin/kb');
    await expect(page.getByRole('heading', { level: 1, name: t('AdminKb.title') })).toBeVisible();
    const firstCat = page.locator('main').getByText(k.categories[0].nameEn).first();
    await expect(firstCat).toBeVisible();
    if (k.articles[0]) {
      const catY = (await firstCat.boundingBox())!.y;
      const artY = (await page.locator('main').getByText(k.articles[0].titleEn).first().boundingBox())?.y ?? Infinity;
      expect(catY, 'categories come first').toBeLessThan(artY);
    }
  });

  test('TC-KB-006 Permission to manage', async ({ asRole, apiAs }) => {
    expect((await (await apiAs('agent')).get('/api/admin/kb')).status(), 'agent without manage_kb').toBe(403);
    const page = await asRole('agent');
    await go(page, '/en/admin/kb');
    await expect(page.locator('main').getByText(/You do not have permission/).first(), 'not available without manage_kb').toBeVisible();
    expect((await (await apiAs('admin')).get('/api/admin/kb')).status(), 'with it').toBe(200);
  });
});
