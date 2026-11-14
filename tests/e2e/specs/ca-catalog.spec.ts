import type { APIRequestContext } from '@playwright/test';
import { expect, go, stamp, test } from '../support/fixtures';
import { ok } from '../support/data';

/**
 * Sheet "CA Catalog". Types, categories and fields made here are named "E2E ..." and deleted at the end of the test
 * (they have no tickets), so customers see them only for a few seconds.
 */
interface Catalog { types: { id: string; nameEn: string; isActive: boolean }[]; categories: { id: string; nameEn: string; isActive: boolean }[] }
const catalog = (admin: APIRequestContext) => ok<Catalog>(admin.get('/api/admin/catalog'));
const opts = (api: APIRequestContext) => ok<{ types: { id: string; nameEn: string; categoryIds: string[] }[]; categories: { id: string; nameEn: string }[]; fields: { key: string; isRequired: boolean; categoryId: string | null }[] }>(api.get('/api/tickets/options'));
async function newCategory(admin: APIRequestContext, typeIds: string[], isActive = true): Promise<string> {
  const name = stamp('E2E category');
  const r = await ok<{ id?: string }>(admin.post('/api/admin/categories', { data: { nameEn: name, nameAr: name, defaultTeamId: null, isActive, sortOrder: 999, priorityCode: null, isPrivate: false, autoAssign: false, typeIds } }));
  return r?.id ?? (await catalog(admin)).categories.find((c) => c.nameEn === name)!.id;
}

test.describe('CA Catalog', () => {
  test('TC-CA-001 Ticket types table', async ({ asRole, apiAs }) => {
    const c = await catalog(await apiAs('admin'));
    const page = await asRole('admin');
    await go(page, '/en/admin/ticket-types');
    for (const ty of c.types.slice(0, 3)) await expect(page.locator('main').getByText(ty.nameEn).first()).toBeVisible();
    await expect(page.locator('main'), 'counts shown').toContainText(/Tickets: \d+/);
  });

  test('TC-CA-002 Add a ticket type', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const anyCat = (await catalog(admin)).categories.find((c) => c.isActive)!;
    const name = stamp('E2E type');
    await ok(admin.post('/api/admin/ticket-types', { data: { nameEn: name, nameAr: name, descriptionEn: null, descriptionAr: null, examplesEn: null, examplesAr: null, sortOrder: 999, isActive: true, categoryIds: [anyCat.id] } }));
    const id = (await catalog(admin)).types.find((x) => x.nameEn === name)!.id;
    try {
      expect((await opts(await apiAs('customer'))).types.map((x) => x.nameEn), 'offered on New ticket').toContain(name);
    } finally { await admin.delete(`/api/admin/ticket-types/${id}`); }
  });

  test('TC-CA-003 Add a category', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const ty = (await catalog(admin)).types.find((x) => x.isActive)!;
    const id = await newCategory(admin, [ty.id]);
    try {
      const o = await opts(await apiAs('customer'));
      expect(o.types.find((x) => x.id === ty.id)!.categoryIds, 'customer can pick it under the type').toContain(id);
    } finally { await admin.delete(`/api/admin/categories/${id}`); }
  });

  test('TC-CA-004 Type and category matrix', async ({ asRole, apiAs }) => {
    const o = await opts(await apiAs('customer'));
    const page = await asRole('admin');
    await go(page, '/en/admin/catalog');
    const table = page.locator('main table').filter({ has: page.locator('th', { hasText: o.types[0].nameEn }) }).first();
    await expect(table, 'a matrix with types as columns').toBeVisible();
    await expect(table.getByText(o.categories[0].nameEn).first()).toBeVisible();
  });

  test('TC-CA-005 Extra fields on a category', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const ty = (await catalog(admin)).types.find((x) => x.isActive)!;
    const cat = await newCategory(admin, [ty.id]);
    const key = `e2e_${Date.now()}`;
    let fieldId: string | undefined;
    try {
      const f = await ok<{ id?: string }>(admin.post('/api/admin/fields', { data: { key, labelEn: 'E2E field', labelAr: 'E2E field', type: 'text', options: null, isRequired: true, visibleToCustomer: true, categoryId: cat, isActive: true, sortOrder: 1, min: null, max: null, minLength: null, maxLength: null, pattern: null } }));
      fieldId = f?.id;
      const o = await opts(await apiAs('customer'));
      expect(o.fields.find((x) => x.key === key)).toMatchObject({ isRequired: true, categoryId: cat });
      const r = await (await apiAs('customer')).post('/api/tickets', { data: { typeId: ty.id, categoryId: cat, subject: 'E2E missing field', description: 'Required field left empty (automated test).', customValues: {} } });
      expect(r.status(), 'required field enforced by the server').toBe(400);
    } finally {
      if (!fieldId) fieldId = (await ok<{ fields: { id: string; key: string }[] }>(admin.get('/api/admin/catalog'))).fields?.find((x) => x.key === key)?.id;
      if (fieldId) await admin.delete(`/api/admin/fields/${fieldId}`);
      await admin.delete(`/api/admin/categories/${cat}`);
    }
  });

  test('TC-CA-006 Deactivate a category', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const ty = (await catalog(admin)).types.find((x) => x.isActive)!;
    const cat = await newCategory(admin, [ty.id], false);
    try {
      const o = await opts(await apiAs('customer'));
      expect(o.categories.map((c) => c.id), 'inactive category not offered').not.toContain(cat);
    } finally { await admin.delete(`/api/admin/categories/${cat}`); }
  });
});
