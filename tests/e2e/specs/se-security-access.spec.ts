import { request } from '@playwright/test';
import { expect, go, manual, test } from '../support/fixtures';
import { ACCOUNTS } from '../support/accounts';
import { ok, PNG, ticketFor } from '../support/data';
import { baseUrl } from '../support/env';
import { t } from '../support/i18n';

/** Sheet "SE Security, access". */
test.describe('SE Security, access', () => {
  test('TC-SE-001 Direct URL to a staff page as a customer', async ({ asRole, apiAs }) => {
    const page = await asRole('customer');
    for (const url of ['/en/console', '/en/console/dashboard', '/en/admin/users']) {
      await go(page, url);
      await expect(page, url).not.toHaveURL(/\/(console|admin)/);                // sent back to the customer home
    }
    expect((await (await apiAs('customer')).get('/api/console/counts')).status()).toBe(403);
  });

  test('TC-SE-002 Direct URL to admin pages as an agent', async ({ asRole, apiAs }) => {
    const page = await asRole('agent');
    for (const url of ['/en/admin/users', '/en/admin/permissions', '/en/admin/organizations', '/en/admin/teams']) {
      await go(page, url);
      await expect(page, url).not.toHaveURL(/\/admin\//);
    }
    const api = await apiAs('agent');
    expect([403, 404]).toContain((await api.get('/api/admin/users')).status());
  });

  test('TC-SE-003 API access without a session', async () => {
    const anon = await request.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true });
    for (const url of ['/api/tickets', '/api/console/counts', '/api/console/people', '/api/admin/users', '/api/notifications']) {
      const r = await anon.get(url);
      expect(r.status(), url).toBe(401);
      expect(await r.text(), `${url} returns no data`).not.toMatch(/"items"\s*:\s*\[\s*\{/);
    }
    await anon.dispose();
  });

  test('TC-SE-004 Data isolation between customers', async ({ asRole, apiAs }) => {
    const admin = await apiAs('admin');
    const dir = await ok<{ id: string; email: string }[]>(admin.get('/api/tickets/customers'));
    const other = dir.find((x) => x.email.toLowerCase() !== ACCOUNTS.customer.email && /hesham|mona|adel/i.test(x.email)) ?? dir.find((x) => x.email.toLowerCase() !== ACCOUNTS.customer.email)!;
    const tk = await ticketFor(admin, other.email);
    const up = await admin.post(`/api/tickets/${tk.id}/attachments`, { multipart: { file: { name: 'private.png', mimeType: 'image/png', buffer: PNG } } });
    expect(up.ok(), `upload: ${up.status()}`).toBeTruthy();
    const att = (await up.json()) as { id: string };
    const me = await apiAs('customer');
    expect([403, 404]).toContain((await me.get(`/api/tickets/${tk.id}`)).status());
    expect([403, 404]).toContain((await me.get(`/api/tickets/${tk.id}/attachments/${att.id}`)).status());
    expect([403, 404]).toContain((await me.post(`/api/tickets/${tk.id}/messages`, { data: { kind: 'public_reply', body: 'Trying to write on another customer ticket.' } })).status());
    const page = await asRole('customer');
    await go(page, `/en/tickets/${tk.id}`);
    await expect(page.locator('main').getByText(t('Ticket.errors.notFound'))).toBeVisible();
  });

  test('TC-SE-005 Scope isolation for scoped admins', async ({ apiAs }) => {
    // Nasr City branch admin: people and tickets of another branch are refused.
    const admin = await apiAs('admin');
    const dir = await ok<{ id: string; email: string; branchName: string | null }[]>(admin.get('/api/tickets/customers'));
    const outside = dir.find((x) => x.email.toLowerCase() === ACCOUNTS.customer.email)!;      // Banha, not Nasr City
    const tk = await ticketFor(admin, outside.email);
    const branch = await apiAs('branchAdmin');
    expect([403, 404]).toContain((await branch.get(`/api/tickets/${tk.id}`)).status());
    expect([403, 404]).toContain((await branch.get(`/api/console/customers/${outside.id}`)).status());
    const people = await ok<{ people: { email: string | null }[] }>(branch.get('/api/console/people'));
    expect(people.people.length, 'sees its own branch').toBeGreaterThan(0);
    expect(people.people.map((p) => (p.email ?? '').toLowerCase())).not.toContain(ACCOUNTS.customer.email);
  });

  test('TC-SE-006 Secrets are not exposed', async ({ asRole }) => {
    const page = await asRole('admin');
    const bodies: string[] = [];
    const grab = async (r: import('@playwright/test').Response) => {
      const ct = r.headers()['content-type'] ?? '';
      if (/json|javascript|html/.test(ct)) bodies.push(await r.text().catch(() => ''));
    };
    page.on('response', grab);
    for (const url of ['/en/console/dashboard', '/en/admin/general/settings/system', '/en/admin/general/settings/email', '/en/admin/general/settings/security']) {
      await go(page, url);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    }
    page.off('response', grab);
    const all = bodies.join('\n');
    expect(all.length).toBeGreaterThan(1000);
    for (const bad of [/Server=.*;(User Id|Password)=/i, /"(smtpPassword|clientSecret|secretKey|turnstileSecret|apiKey)"\s*:\s*"[^"*]{6,}"/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /sk_live_[0-9a-zA-Z]{10,}/])
      expect(all, `no ${bad}`).not.toMatch(bad);
  });

  test('TC-SE-007 Security headers', async ({ apiAs }) => {
    const r = await (await apiAs('customer')).get('/api/tickets/summary?mine=true');
    const h = r.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['cache-control'] ?? '').toContain('no-store');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // The Content-Security-Policy of the pages is set by IIS (src/Ccs.Web/public/web.config); the local dev server does not send it.
    test.info().annotations.push({ type: 'note', description: 'CSP for the pages comes from IIS web.config: check on the server.' });
  });

  manual('TC-SE-008', 'Brute force and rate limits', 'it blocks the address for minutes and would break the other tests; run it alone by hand (limits: 20 auth calls / 5 min, 15 tickets / hour, 5 reset codes / day per account)');

  test('TC-SE-009 Cross-site request protection', async ({ asRole }) => {
    // Every API change needs the Bearer token from memory; the only cookie (refresh) is HttpOnly, SameSite=Strict, path /api/auth.
    const page = await asRole('customer');
    const cookies = await page.context().cookies();
    const refresh = cookies.filter((c) => c.path.startsWith('/api/auth'));
    expect(refresh.length, 'refresh cookie present').toBeGreaterThan(0);
    for (const c of refresh) { expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe('Strict'); }
    expect(cookies.filter((c) => !c.path.startsWith('/api/auth') && /auth|session|token/i.test(c.name)), 'no session cookie sent to other API paths').toHaveLength(0);
    // A form post from another origin carries cookies but no token: refused.
    const r = await page.request.post('/api/tickets', { headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'subject=x&description=y' });
    expect([401, 403, 415]).toContain(r.status());
  });

  test('TC-SE-010 File upload safety', async ({ apiAs }) => {
    const admin = await apiAs('admin');
    const tk = await ticketFor(admin, ACCOUNTS.customer.email);
    const me = await apiAs('customer');
    const up = (name: string, mimeType: string, buffer: Buffer) => me.post(`/api/tickets/${tk.id}/attachments`, { multipart: { file: { name, mimeType, buffer } } });
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary'), Buffer.alloc(200, 0)]);
    expect((await up('invoice.png', 'image/png', exe)).status(), 'renamed executable').toBe(400);     // v2: content must match the extension
    expect((await up('tool.exe', 'application/octet-stream', exe)).status(), 'blocked type').toBe(400);
    expect((await up('big.pdf', 'application/pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024, 32)]))).status(), 'over 10 MB').toBe(400);
    expect((await up('fine.png', 'image/png', PNG)).ok(), 'a real PNG is accepted').toBeTruthy();
  });

  manual('TC-SE-011', 'Password storage', 'needs a review of the database');
  manual('TC-SE-012', 'Logging', 'needs a review of the server log files');
});
