import { Signal, effect, untracked } from '@angular/core';

/**
 * "Saved" next to the button that was pressed.
 * Admin pages show their result line at the top of the page, which is off-screen when the form is lower down.
 * This remembers the last button pressed (click or Enter in a form) and puts a short result right after it.
 */
let last: { el: HTMLElement; at: number } | null = null;
let installed = false;
const KEEP_MS = 20000;   // a slow save still finds its button

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('submit', (e) => {
    const sub = (e as SubmitEvent).submitter as HTMLElement | null;
    const form = e.target as HTMLFormElement;
    const el = sub ?? form.querySelector<HTMLElement>('button[type=submit], button:not([type])');
    if (el) last = { el, at: Date.now() };
  }, true);
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.('button');
    if (b && b.type !== 'submit') last = { el: b, at: Date.now() };
  }, true);
}

const ICON_OK = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
const ICON_ERR = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';

/** Shows the result beside the last pressed button, if there is one still on the page. */
export function flashFeedback(tone: 'success' | 'error', text: string): void {
  if (!last || Date.now() - last.at > KEEP_MS || !last.el.isConnected) return;
  const anchor = last.el;
  const old = anchor.nextElementSibling;
  if (old?.hasAttribute('data-feedback')) old.remove();
  const span = document.createElement('span');
  span.setAttribute('data-feedback', '');
  span.setAttribute('role', 'status');
  span.className = tone === 'success'
    ? 'ms-3 inline-flex items-center gap-1.5 align-middle text-sm font-semibold text-ok'
    : 'ms-3 inline-flex max-w-prose items-center gap-1.5 align-middle text-sm font-semibold text-danger';
  span.innerHTML = tone === 'success' ? ICON_OK : ICON_ERR;
  span.append(document.createTextNode(text));
  anchor.insertAdjacentElement('afterend', span);
  setTimeout(() => span.remove(), tone === 'success' ? 5000 : 10000);
}

/** Call from a field initializer: every non-empty message also shows beside the pressed button. */
export function feedbackFor(msg: Signal<{ tone: 'success' | 'error'; text: string } | null>) {
  install();
  return effect(() => {
    const m = msg();
    if (m) untracked(() => flashFeedback(m.tone, m.text));
  });
}
