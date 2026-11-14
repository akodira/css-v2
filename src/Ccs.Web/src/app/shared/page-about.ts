import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TPipe } from '../core/i18n';

/** Icons for the points (24px stroke paths). */
const ICONS: Record<string, string> = {
  ticket: 'M4 4h16v12H5.2L4 17.2V4zM8 9h8M8 12h5',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  crown: 'M2 20h20M4 20l2-11 6 5 6-5 2 11',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  key: 'M7.5 20a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.7 12.3 20 3M16 7l3 3M14 9l2 2',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  lock: 'M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  building: 'M3 21h18M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M16 9h3a2 2 0 0 1 2 2v10M9 7h3M9 11h3M9 15h3',
  check: 'M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  list: 'M9 6h12M9 12h12M9 18h12M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2',
  map: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  badge: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 17a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3',
  clock: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9 2h6M12 2v3',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  up: 'M12 19V5M5 12l7-7 7 7',
};
const TONES = [
  'bg-brand-soft text-brand-ink', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn-ink',
  'bg-[#efe8fd] text-[#5b3aa8]', 'bg-danger-soft text-danger', 'bg-bg text-muted',
];

/**
 * "What is this page?" panel under a page title: one line, a few points and a footnote, all from
 * About.<key>.* in the i18n files. Hide remembers the choice in this browser; a small link brings it back.
 */
@Component({
  selector: 'app-page-about',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hidden()) {
      <button type="button" (click)="setHidden(false)" class="inline-flex min-h-11 cursor-pointer items-center gap-1.5 self-start rounded-lg px-1 text-sm font-semibold text-brand-ink hover:underline">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>
        {{ 'About.show' | t }}
      </button>
    } @else {
      <section [attr.aria-labelledby]="'about-' + key()" class="rounded-xl border border-line bg-gradient-to-b from-[#f7f9fd] to-surface p-5 shadow-card">
        <div class="flex items-start gap-3.5">
          <span aria-hidden="true" class="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon(tile())" /></svg></span>
          <p class="m-0 flex-1"><b [id]="'about-' + key()" class="mb-0.5 block text-base">{{ base() + 'title' | t }}</b><span class="text-muted">{{ base() + 'lead' | t }}</span></p>
          <button type="button" (click)="setHidden(true)" class="min-h-9 cursor-pointer rounded-lg px-2.5 text-sm font-semibold text-muted hover:bg-bg">{{ 'About.hide' | t }}</button>
        </div>
        <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" [class]="points().length === 6 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'">
          @for (p of points(); track $index) {
            <div class="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 text-sm text-muted">
              <span aria-hidden="true" class="grid size-8 shrink-0 place-items-center rounded-lg" [class]="tone($index)">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon(p)" /></svg></span>
              <span><b class="mb-0.5 block text-[0.92rem] text-ink">{{ base() + 'p' + ($index + 1) + 't' | t }}</b>{{ base() + 'p' + ($index + 1) | t }}</span>
            </div>
          }
        </div>
        <p class="mt-3.5 mb-0 flex items-start gap-1.5 text-[0.82rem] text-muted">
          <svg aria-hidden="true" class="mt-0.5 shrink-0" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span>{{ base() + 'foot' | t }}</span></p>
      </section>
    }`,
})
export class PageAbout {
  /** i18n group under About, e.g. "teams". */
  readonly key = input.required<string>();
  /** Icon for the tile next to the title. */
  readonly tile = input('users');
  /** One icon per point, in order. */
  readonly points = input<string[]>([]);
  protected readonly base = computed(() => `About.${this.key()}.`);
  private readonly store = computed(() => `ccs.aboutHidden.${this.key()}`);
  private readonly flag = signal<boolean | null>(null);
  protected readonly hidden = computed(() => {
    const f = this.flag();
    if (f !== null) return f;
    try { return localStorage.getItem(this.store()) === '1'; } catch { return false; }
  });
  protected setHidden(v: boolean): void {
    this.flag.set(v);
    try { if (v) localStorage.setItem(this.store(), '1'); else localStorage.removeItem(this.store()); } catch { /* storage blocked */ }
  }
  protected icon(k: string): string { return ICONS[k] ?? ICONS['users']; }
  protected tone(i: number): string { return TONES[i % TONES.length]; }
}
