import { Component, DestroyRef, ElementRef, effect, inject, input, model, untracked, viewChild } from '@angular/core';
import { I18n } from '../core/i18n';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Loads Cloudflare's script once for the whole app. */
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.dataset['turnstile'] = '1';
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile box (v1 components/turnstile.tsx). Writes the answer into [(token)];
 * bump [resetKey] after every submit so a fresh check is shown (v1 resets on every form answer).
 */
@Component({
  selector: 'app-turnstile',
  template: `<div #box class="min-h-[65px]"></div>`,
})
export class Turnstile {
  readonly siteKey = input.required<string>();
  readonly resetKey = input<unknown>(0);
  readonly token = model('');
  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private readonly i18n = inject(I18n);
  private widget: string | null = null;

  constructor() {
    // (Re)draw when the key or the language changes.
    effect((onCleanup) => {
      const key = this.siteKey();
      const lang = this.i18n.locale() === 'ar' ? 'ar' : 'en';
      const el = this.box().nativeElement;
      let cancelled = false;
      void loadScript().then(() => {
        if (cancelled || !window.turnstile || this.widget) return;
        this.widget = window.turnstile.render(el, {
          sitekey: key, language: lang,
          callback: (t: string) => this.token.set(t),
          'expired-callback': () => this.token.set(''),
          'error-callback': () => this.token.set(''),
        });
      }).catch(() => undefined);
      onCleanup(() => {
        cancelled = true;
        if (this.widget && window.turnstile) window.turnstile.remove(this.widget);
        this.widget = null;
        this.token.set('');
      });
    });
    // A fresh check after every answer from the server (one token can be used only once).
    let first = true;
    effect(() => {
      this.resetKey();
      if (first) { first = false; return; }
      untracked(() => {
        if (this.widget && window.turnstile) window.turnstile.reset(this.widget);
        this.token.set('');
      });
    });
    inject(DestroyRef).onDestroy(() => { if (this.widget && window.turnstile) window.turnstile.remove(this.widget); this.widget = null; });
  }
}
