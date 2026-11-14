import { expect, go, stamp, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, ticketFor } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "SC Saved replies". Replies made here are named "E2E ..." and deleted at the end. */
interface Canned { id: string; title: string; body: string; mine: boolean }
const list = async (api: import('@playwright/test').APIRequestContext) => (await ok<{ items: Canned[] }>(api.get('/api/canned'))).items;

test.describe('SC Saved replies', () => {
  test('TC-SC-001 Create a saved reply', async ({ asRole, apiAs }) => {
    const title = stamp('E2E reply');
    const page = await asRole('agent');
    try {
      await go(page, '/en/console/canned');
      await expect(page.getByRole('heading', { level: 1, name: t('Canned.title') })).toBeVisible();
      await page.getByRole('button', { name: t('Canned.add') }).click();
      await page.getByLabel(t('Canned.name')).fill(title);
      await page.getByLabel(t('Canned.body')).first().fill('Thank you for your patience, we are on it.');
      await page.getByRole('button', { name: t('Canned.save'), exact: true }).click();
      const card = page.locator('main article, main li, main section').filter({ hasText: title }).first();
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: t('Canned.edit') })).toBeVisible();
      await expect(card.getByRole('button', { name: t('Canned.delete') })).toBeVisible();
    } finally {
      const api = await apiAs('agent');
      for (const c of (await list(api)).filter((x) => x.title === title)) await api.delete(`/api/canned/${c.id}`);
    }
  });

  test('TC-SC-002 Edit and delete', async ({ asRole, apiAs }) => {
    const api = await apiAs('agent');
    const title = stamp('E2E reply');
    await ok(api.post('/api/canned', { data: { title, body: 'Original text.', language: 'any', isShared: false } }));
    const page = await asRole('agent');
    await go(page, '/en/console/canned');
    const card = () => page.locator('main article, main li, main section').filter({ hasText: title }).first();
    await card().getByRole('button', { name: t('Canned.edit') }).click();
    await page.getByLabel(t('Canned.body')).first().fill('Changed text.');
    await page.getByRole('button', { name: t('Canned.save'), exact: true }).click();
    await expect.poll(async () => (await list(api)).find((x) => x.title === title)?.body).toBe('Changed text.');
    await card().getByRole('button', { name: t('Canned.delete') }).click();
    const confirm = page.getByRole('button', { name: new RegExp(`^(${t('Directory.deleteYes')}|Yes.*|${t('Canned.delete')})$`) }).last();
    await expect(confirm, 'asks to confirm').toBeVisible();
    await confirm.click();
    await expect.poll(async () => (await list(api)).some((x) => x.title === title)).toBe(false);
  });

  test('TC-SC-003 Use in a ticket', async ({ asRole, apiAs }) => {
    const api = await apiAs('agent');
    const title = stamp('E2E reply');
    await ok(api.post('/api/canned', { data: { title, body: 'Inserted saved reply text.', language: 'any', isShared: false } }));
    try {
      const tk = await ticketFor(await apiAs('admin'), ACCOUNTS.customer.email);
      const page = await asRole('agent');
      await go(page, `/en/console/tickets/${tk.id}`);
      await page.locator('#canned').selectOption({ label: title });
      await expect(page.locator('#body')).toHaveValue(/Inserted saved reply text\./);
    } finally { for (const c of (await list(api)).filter((x) => x.title === title)) await api.delete(`/api/canned/${c.id}`); }
  });

  test('TC-SC-004 Permission to manage', async ({ asRole, apiAs }) => {
    // Saved replies are personal for everyone; manage_canned only allows sharing with all staff.
    const r = await (await apiAs('agent')).get('/api/canned');
    expect(r.status()).toBe(200);
    expect(((await r.json()) as { canShare: boolean }).canShare, 'agent cannot share without the permission').toBe(false);
    const viewer = await asRole('viewer');
    await go(viewer, '/en/console/canned');                                            // route allows agent, leader, admin only
    await expect(viewer.getByRole('heading', { level: 1, name: t('Canned.title') })).toHaveCount(0);
    await expect(viewer).not.toHaveURL(/\/console\/canned/);
  });
});
