import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Where the API lives. Empty (the default) = same site, under /api.
 * The installer writes config.json with the API's own address when the API runs as a separate IIS site.
 */
let apiBase = '';

export async function loadApiBase(): Promise<void> {
  try {
    const r = await fetch('/config.json', { cache: 'no-store' });
    if (r.ok) apiBase = String(((await r.json()) as { apiBase?: string }).apiBase ?? '').trim().replace(/\/+$/, '');
  } catch {
    apiBase = '';
  }
}

/** Sends /api/... calls to the API's address when it is separate; the refresh cookie goes along (same parent domain). */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) =>
  next(apiBase && req.url.startsWith('/api/') ? req.clone({ url: apiBase + req.url }) : req);
