import { expect, type APIRequestContext } from '@playwright/test';
import { stamp } from './fixtures';

/** Test records created through the API (the same calls the pages make). Subjects start with "E2E" so they are easy to find. */
interface Options {
  types: { id: string; nameEn: string; categoryIds: string[] }[];
  categories: { id: string; nameEn: string; subcategories: { id: string; nameEn: string }[] }[];
  priorities: { code: string; nameEn: string }[];
  fields: { key: string; isRequired: boolean; categoryId: string | null; visibleToCustomer: boolean }[];
  customerPicksPriority: boolean;
}

export async function ok<T = any>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  if (!r.ok()) throw new Error(`${r.url()} -> ${r.status()} ${(await r.text()).slice(0, 300)}`);
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

/** A type + category with no required custom field, so a ticket can be made from the API without guessing values. */
export async function simpleChoice(api: APIRequestContext): Promise<{ typeId: string; categoryId: string; opts: Options }> {
  const opts = await ok<Options>(api.get('/api/tickets/options'));
  // "Technical issue" routes to Technical support, the team of the test agent (Agent Banha); other categories go elsewhere.
  const rank = (cid: string) => (/technical/i.test(opts.categories.find((c) => c.id === cid)?.nameEn ?? '') ? 0 : 1);
  for (const ty of opts.types) for (const cid of [...ty.categoryIds].sort((x, y) => rank(x) - rank(y))) {
    if (rank(cid) === 0 && !opts.fields.some((f) => f.isRequired && f.visibleToCustomer && (!f.categoryId || f.categoryId === cid))) return { typeId: ty.id, categoryId: cid, opts };
  }
  for (const ty of opts.types) for (const cid of ty.categoryIds) {
    if (!opts.fields.some((f) => f.isRequired && f.visibleToCustomer && (!f.categoryId || f.categoryId === cid))) return { typeId: ty.id, categoryId: cid, opts };
  }
  throw new Error('No ticket type/category without required custom fields');
}

export interface Created { id: string; reference: string; subject: string }

/** Creates a ticket as the given account (customer, or staff with requesterId). */
export async function createTicket(api: APIRequestContext, extra: Record<string, unknown> = {}): Promise<Created> {
  const { typeId, categoryId, opts } = await simpleChoice(api);
  const subject = (extra.subject as string) ?? stamp('E2E ticket');
  const body = {
    typeId, categoryId, subcategoryId: null, subject, description: 'Created by the automated browser tests. Safe to close.',
    customValues: {}, priority: opts.customerPicksPriority ? opts.priorities[0]?.code ?? null : null, requesterId: null, ...extra,
  };
  const r = await ok<{ id: string; reference: string }>(api.post('/api/tickets', { data: body }));
  return { ...r, subject };
}

const ids = new Map<string, string>();
/** Profile id of a customer, from the staff "new ticket for a customer" directory. */
export async function customerId(staff: APIRequestContext, email: string): Promise<string> {
  if (!ids.has(email)) {
    const dir = await ok<{ id: string; email: string }[]>(staff.get('/api/tickets/customers'));
    const hit = dir.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!hit) throw new Error(`${email} is not in the staff customer directory`);
    ids.set(email, hit.id);
  }
  return ids.get(email)!;
}

/**
 * A ticket that belongs to the customer but is created by staff: customers may create only 15 tickets per hour
 * (TicketService.MaxTicketsPerHour), staff creating for a customer are exempt.
 */
export async function ticketFor(staff: APIRequestContext, email: string, extra: Record<string, unknown> = {}): Promise<Created> {
  return createTicket(staff, { requesterId: await customerId(staff, email), ...extra });
}

export async function ticket(api: APIRequestContext, id: string): Promise<any> { return ok(api.get(`/api/tickets/${id}`)); }

export async function reply(api: APIRequestContext, id: string, kind: 'public_reply' | 'internal_note', body: string): Promise<{ id: string }> {
  return ok(api.post(`/api/tickets/${id}/messages`, { data: { kind, body } }));
}

/** Moves a ticket as staff; walks through in_progress first when the direct move is not allowed. */
export async function move(api: APIRequestContext, id: string, to: string, extra: Record<string, unknown> = {}): Promise<void> {
  const data = { to, reason: 'Automated test step', ...extra };
  let r = await api.post(`/api/tickets/${id}/status`, { data });
  if (!r.ok()) {
    await api.post(`/api/tickets/${id}/status`, { data: { to: 'in_progress', reason: 'Automated test step' } });
    r = await api.post(`/api/tickets/${id}/status`, { data });
  }
  expect(r.ok(), `move to ${to}: ${r.status()} ${await r.text()}`).toBeTruthy();
}

/** Resolve as staff (resolution text required). */
export async function resolve(api: APIRequestContext, id: string): Promise<void> {
  await move(api, id, 'resolved', { resolution: 'Resolved by the automated browser tests.' });
}

/** A tiny valid PNG (1x1), so the content check accepts it. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
