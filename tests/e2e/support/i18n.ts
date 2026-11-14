import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * English texts of the app, read from src/Ccs.Web/public/i18n/en.json, so tests find buttons by the same
 * key the template uses ("Tickets.newTicket") instead of a copied string that drifts.
 */
const file = path.join(__dirname, '..', '..', '..', 'src', 'Ccs.Web', 'public', 'i18n', 'en.json');
const EN = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

/** Text for a key; {placeholders} are filled from params, or cut off when not given. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), EN);
  if (typeof v !== 'string') throw new Error(`Missing i18n key ${key}`);
  return v.replace(/\{\s*(\w+)\s*\}/g, (_, k) => (k in params ? String(params[k]) : ''));
}

/** The text before the first {placeholder}: useful for partial matches. */
export function tStart(key: string): string {
  const v = t(key, {});
  const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], EN) as string;
  const i = raw.search(/\{/);
  return (i >= 0 ? raw.slice(0, i) : v).trim();
}
