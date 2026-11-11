import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, Pipe, PipeTransform, computed, inject, signal } from '@angular/core';
import { IntlMessageFormat } from 'intl-messageformat';
import { firstValueFrom } from 'rxjs';

export type Locale = 'en' | 'ar';
export const LOCALES: readonly Locale[] = ['en', 'ar'];
export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ar';

type Messages = Record<string, unknown>;

/**
 * Same message files and ICU syntax as the current app (next-intl), served from /i18n/{locale}.json.
 * Every address starts with the language (/en/..., /ar/...) and Arabic switches the page to right-to-left.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly http = inject(HttpClient);
  private readonly doc = inject(DOCUMENT);
  private readonly cache = new Map<Locale, Messages>();
  private readonly formats = new Map<string, IntlMessageFormat>();

  readonly locale = signal<Locale>('en');
  readonly dir = computed(() => (this.locale() === 'ar' ? 'rtl' : 'ltr'));
  private readonly messages = signal<Messages>({});
  /** Texts the administrator changed (system messages, e.g. status names), keyed "locale|Key.path". */
  private readonly overrides = signal<Map<string, string>>(new Map());

  setOverrides(rows: { key: string; locale: string; body: string }[]): void {
    this.overrides.set(new Map(rows.map((r) => [`${r.locale}|${r.key}`, r.body])));
    this.formats.clear();
  }

  async use(locale: Locale): Promise<void> {
    if (!this.cache.has(locale)) {
      this.cache.set(locale, await firstValueFrom(this.http.get<Messages>(`/i18n/${locale}.json`)));
    }
    this.messages.set(this.cache.get(locale)!);
    this.locale.set(locale);
    const html = this.doc.documentElement;
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }

  /** t('Auth.login.title') or t('Nav.bellUnread', { count: 3 }). Missing keys show the key, like next-intl. */
  t(key: string, params?: Record<string, unknown>): string {
    const raw = this.overrides().get(`${this.locale()}|${key}`)
      ?? key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Messages)[k] : undefined), this.messages());
    if (typeof raw !== 'string') return key;
    if (!params && !raw.includes('{')) return raw;
    const id = `${this.locale()}|${key}`;
    let f = this.formats.get(id);
    if (!f) {
      try {
        f = new IntlMessageFormat(raw, this.locale());
      } catch {
        return raw;
      }
      this.formats.set(id, f);
    }
    try {
      return String(f.format(params as Record<string, string | number>));
    } catch {
      return raw;
    }
  }

  /** The message value itself (an object or list, e.g. guide sections), like next-intl's t.raw(). */
  raw<T = unknown>(key: string): T | undefined {
    return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Messages)[k] : undefined), this.messages()) as T | undefined;
  }

  has(key: string): boolean {
    if (this.overrides().has(`${this.locale()}|${key}`)) return true;
    return typeof key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Messages)[k] : undefined), this.messages()) === 'string';
  }

  /** pick(locale, en, ar): the field for the current language, falling back to English. */
  pick(en: string | null | undefined, ar: string | null | undefined): string {
    return (this.locale() === 'ar' ? ar || en : en || ar) ?? '';
  }

  /** Date only, v1 dateStyle "medium": "Nov 5, 2026". */
  day(iso: string | null | undefined): string {
    if (!iso) return '-';
    return new Intl.DateTimeFormat(this.locale() === 'ar' ? 'ar' : 'en-US', { dateStyle: 'medium', timeZone: 'Africa/Cairo' }).format(new Date(iso));
  }

  date(iso: string | null | undefined, style: 'medium' | 'short' = 'medium'): string {
    if (!iso) return '-';
    // Same as v1 (next-intl with locale "en" / "ar"): "Nov 5, 2026, 12:32 PM".
    return new Intl.DateTimeFormat(this.locale() === 'ar' ? 'ar' : 'en-US', {
      dateStyle: style, timeStyle: 'short', timeZone: 'Africa/Cairo',
    }).format(new Date(iso));
  }
}

/** {{ 'Tickets.title' | t }} - impure so it follows a language switch without a reload. */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t(key, params);
  }
}
