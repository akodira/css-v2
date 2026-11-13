import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { AREAS, ARTICLES, FLOWS, audienceOf, canSee, pickL, type Article, type Audience, type Flow, type L } from '../help';

type Tab = 'features' | 'flows' | 'howto';
const TABS: Tab[] = ['features', 'flows', 'howto'];
const TONE: Record<string, string> = { a: 'bg-brand-soft text-brand-ink', o: 'bg-ok-soft text-ok', d: 'bg-warn-soft text-warn-ink' };
type Item = { audience: Audience[]; perm?: string | string[] };

/** **bold** inside guide text becomes <strong>; the rest stays plain text (escaped). */
function rich(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/(\*\*[^*]+\*\*)/g).map((p) => (p.startsWith('**') ? `<strong class="font-semibold">${esc(p.slice(2, -2))}</strong>` : esc(p))).join('');
}
const haystack = (a: Article | Flow, locale: string): string => {
  const parts: L[] = [a.title, a.summary];
  if ('steps' in a) parts.push(...a.steps);
  if ('tips' in a && a.tips) parts.push(...a.tips);
  if ('nodes' in a) parts.push(...a.nodes.map((n) => n.label));
  return parts.map((p) => pickL(p, locale)).join(' ').replace(/\*\*/g, '').toLowerCase();
};

/**
 * Help Center, same as v1: features, flows and how-to guides filtered to what the person's role and permissions allow.
 * Tab, topic, search and open guide live in the address (?tab=&area=&q=&a=), so every view can be linked.
 * Used at /help (customers), /console/help (staff) and /admin/general/help (settings managers).
 */
@Component({
  selector: 'app-help-center',
  imports: [RouterLink, TPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Help.title' | t }}</h1>
        <p class="mt-1 max-w-prose text-muted">{{ subtitle() | t }}</p></div>
      <div class="flex flex-col gap-5">
        <form role="search" class="flex flex-col gap-2 sm:flex-row" (submit)="$event.preventDefault(); go({ q: qInput.value.trim(), a: '' })">
          <label for="help-q" class="sr-only">{{ 'Help.searchLabel' | t }}</label>
          <input #qInput id="help-q" name="q" [value]="p().q ?? ''" maxlength="80" [placeholder]="'Help.searchPlaceholder' | t" class="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-base" />
          <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Help.search' | t }}</button>
        </form>

        <div class="grid items-start gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
          <nav [attr.aria-label]="'Help.topics' | t" class="flex flex-col gap-1 rounded-xl border border-line bg-surface p-3 shadow-card">
            <a [routerLink]="[]" [queryParams]="qp({ area: '' })" [attr.aria-current]="area() === '' ? 'page' : null"
              class="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm font-semibold" [class]="area() === '' ? 'bg-brand-soft text-brand-ink' : 'hover:bg-bg'">
              <span>{{ 'Help.allTopics' | t }}</span><span class="text-xs text-muted">{{ articles().length + flows().length }}</span></a>
            @for (a of areas(); track a.id) {
              <a [routerLink]="[]" [queryParams]="qp({ area: a.id })" [attr.aria-current]="area() === a.id ? 'page' : null"
                class="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm font-semibold" [class]="area() === a.id ? 'bg-brand-soft text-brand-ink' : 'hover:bg-bg'">
                <span>{{ L(a.title) }}</span><span class="text-xs text-muted">{{ a.count }}</span></a>
            }
          </nav>

          <div class="flex min-w-0 flex-col gap-5">
            @if (q()) {
              <p class="text-sm text-muted">{{ 'Help.results' | t: { count: features().length + flowList().length + howtos().length, q: p().q ?? '' } }}
                <a [routerLink]="[]" [queryParams]="qp({ q: '' })" class="font-semibold text-brand-ink underline">{{ 'Help.clear' | t }}</a></p>
            } @else {
              <div role="tablist" [attr.aria-label]="'Help.kinds' | t" class="flex gap-1 overflow-x-auto border-b border-line">
                @for (k of tabs; track k) {
                  <a [routerLink]="[]" [queryParams]="qp({ tab: k, a: '' })" role="tab" [attr.aria-selected]="tab() === k"
                    class="-mb-px flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-semibold" [class]="tab() === k ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">
                    {{ 'Help.tab.' + k | t }}<span class="rounded-full bg-bg px-2 text-xs">{{ counts()[k] }}</span></a>
                }
              </div>
            }
            @if (areaBlurb(); as b) { <p class="text-sm text-muted">{{ b }}</p> }

            @if (show('features')) {
              <section class="flex flex-col gap-4" [attr.aria-label]="'Help.tab.features' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.features' | t }}</h2> }
                @for (a of features(); track a.id) {
                  <article [id]="a.id" class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <h3 class="text-base font-bold">{{ L(a.title) }}</h3>
                      <ng-container *ngTemplateOutlet="badges; context: { $implicit: a }" />
                    </div>
                    <p class="max-w-prose" [innerHTML]="R(a.summary)"></p>
                    <ng-container *ngTemplateOutlet="tipsT; context: { $implicit: a.tips }" />
                    @if (a.path) { <a [routerLink]="link(a.path)" class="inline-flex min-h-11 items-center self-start rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-ink">{{ 'Help.openPage' | t }}</a> }
                  </article>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }

            @if (show('flows')) {
              <section class="flex flex-col gap-4" [attr.aria-label]="'Help.tab.flows' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.flows' | t }}</h2> }
                @for (f of flowList(); track f.id) {
                  <article [id]="f.id" class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <h3 class="text-base font-bold">{{ L(f.title) }}</h3>
                      <ng-container *ngTemplateOutlet="badges; context: { $implicit: f }" />
                    </div>
                    <ol class="flex flex-wrap items-center gap-2">
                      @for (n of f.nodes; track $index) {
                        <li class="flex items-center gap-2">
                          @if ($index > 0) { <span aria-hidden="true" class="text-muted rtl:-scale-x-100">→</span> }
                          <span class="rounded-lg px-3 py-1.5 text-sm font-semibold" [class]="tone(n.tone)">{{ L(n.label) }}</span>
                        </li>
                      }
                    </ol>
                    <p class="max-w-prose text-sm text-muted">{{ L(f.summary) }}</p>
                  </article>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }

            @if (show('howto')) {
              <section class="flex flex-col gap-3" [attr.aria-label]="'Help.tab.howto' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.howto' | t }}</h2> }
                @for (a of howtos(); track a.id) {
                  <details [id]="a.id" [open]="p().a === a.id || q() !== ''" class="group rounded-xl border border-line bg-surface shadow-card">
                    <summary class="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
                      <span><span class="block text-base font-bold">{{ L(a.title) }}</span><span class="block text-sm text-muted">{{ L(a.summary) }}</span></span>
                      <ng-container *ngTemplateOutlet="badges; context: { $implicit: a }" />
                    </summary>
                    <div class="flex flex-col gap-4 border-t border-line p-5">
                      <ol class="flex flex-col gap-3">
                        @for (s of steps(a); track $index) {
                          <li class="flex gap-3">
                            <span aria-hidden="true" class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{{ $index + 1 }}</span>
                            <span class="max-w-prose" [innerHTML]="R(s)"></span>
                          </li>
                        }
                      </ol>
                      <ng-container *ngTemplateOutlet="tipsT; context: { $implicit: a.tips }" />
                      @if (related(a); as rel) {
                        @if (rel.length) {
                          <p class="text-sm"><span class="font-semibold">{{ 'Help.related' | t }}: </span>
                            @for (r of rel; track r.id) {
                              @if (!$first) { <span> · </span> }
                              <a [routerLink]="[]" [queryParams]="{ tab: 'howto', a: r.id }" class="font-semibold text-brand-ink underline">{{ L(r.title) }}</a>
                            }
                          </p>
                        }
                      }
                      @if (a.path) { <a [routerLink]="link(a.path)" class="inline-flex min-h-11 items-center self-start rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-ink">{{ 'Help.openPage' | t }}</a> }
                    </div>
                  </details>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }
          </div>
        </div>
      </div>
    </main>

    <ng-template #badges let-item>
      <span class="flex flex-wrap items-center gap-2"><span class="text-xs text-muted">{{ areaTitle(item.area) }}</span>
        <span class="flex flex-wrap gap-1.5">
          @if (item.audience.length === 0 && !item.perm) { <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Help.for.admin' | t }}</span> }
          @for (x of item.audience; track x) { <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Help.for.' + x | t }}</span> }
          @if (item.perm) { <span class="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn-ink">{{ 'Help.needsPermission' | t }}</span> }
        </span></span>
    </ng-template>
    <ng-template #tipsT let-tips>
      @if (tips?.length) {
        <div class="rounded-lg bg-warn-soft p-3 text-sm text-warn-ink"><p class="font-semibold">{{ 'Help.tips' | t }}</p>
          <ul class="mt-1 list-disc ps-5">@for (x of tips; track $index) { <li [innerHTML]="R(x)"></li> }</ul></div>
      }
    </ng-template>
    <ng-template #emptyT><p class="rounded-xl border border-dashed border-line bg-surface p-6 text-center text-muted">{{ 'Help.empty' | t }}</p></ng-template>
  `,
})
export class HelpCenterPage {
  private readonly i18n = inject(I18n);
  private readonly auth = inject(Auth);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly tabs = TABS;
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly p = computed(() => {
    const m = this.params();
    return { tab: m.get('tab') ?? undefined, area: m.get('area') ?? undefined, q: m.get('q') ?? undefined, a: m.get('a') ?? undefined };
  });
  private readonly who = computed<Audience>(() => audienceOf(this.auth.me()?.roles ?? []));
  private readonly perms = computed(() => new Set(this.auth.me()?.permissions ?? []));
  protected readonly subtitle = computed(() => this.who() === 'customer' ? 'Help.subtitleCustomer' : this.who() === 'admin' ? 'Help.subtitleAdmin' : 'Help.subtitleStaff');
  protected readonly tab = computed<Tab>(() => (TABS.includes(this.p().tab as Tab) ? (this.p().tab as Tab) : 'features'));
  protected readonly q = computed(() => (this.p().q ?? '').trim().toLowerCase().slice(0, 80));
  protected readonly articles = computed(() => ARTICLES.filter((a) => canSee(a, this.who(), this.perms())));
  protected readonly flows = computed(() => FLOWS.filter((f) => canSee(f, this.who(), this.perms())));
  protected readonly areas = computed(() => AREAS.map((a) => ({
    ...a, count: this.articles().filter((x) => x.area === a.id).length + this.flows().filter((x) => x.area === a.id).length,
  })).filter((a) => a.count > 0));
  protected readonly area = computed(() => this.areas().find((a) => a.id === this.p().area)?.id ?? '');
  protected readonly areaBlurb = computed(() => { const a = AREAS.find((x) => x.id === this.area()); return a ? this.L(a.blurb) : ''; });
  private filter<T extends Article | Flow>(list: T[]): T[] {
    const area = this.area(), q = this.q(), loc = this.i18n.locale();
    return list.filter((x) => (!area || x.area === area) && (!q || haystack(x, loc).includes(q)));
  }
  protected readonly features = computed(() => this.filter(this.articles().filter((a) => a.kind === 'feature')));
  protected readonly howtos = computed(() => this.filter(this.articles().filter((a) => a.kind === 'howto')));
  protected readonly flowList = computed(() => this.filter(this.flows()));
  protected readonly counts = computed<Record<Tab, number>>(() => ({ features: this.features().length, flows: this.flowList().length, howto: this.howtos().length }));

  constructor() {
    // Staff reach the guide inside the console; customers have it in the portal (same rule as v1).
    const path = this.route.snapshot.routeConfig?.path;
    if (path === 'help' && this.auth.isStaff()) void this.router.navigate(['/', this.i18n.locale(), 'console', 'help'], { queryParamsHandling: 'preserve', replaceUrl: true });
  }

  protected show(k: Tab): boolean { return this.q() ? this.counts()[k] > 0 : this.tab() === k; }
  protected L(t: L): string { return pickL(t, this.i18n.locale()); }
  protected R(t: L): string { return rich(this.L(t)); }
  protected tone(t?: string): string { return TONE[t ?? ''] ?? 'bg-bg text-ink'; }
  protected areaTitle(id: string): string { const a = AREAS.find((x) => x.id === id); return a ? this.L(a.title) : id; }
  protected steps(a: Article): L[] { return a.kind === 'howto' ? a.steps : []; }
  protected related(a: Article): Article[] {
    if (a.kind !== 'howto' || !a.related) return [];
    return a.related.map((id) => this.articles().find((x) => x.id === id)).filter((x): x is Article => !!x);
  }
  protected link(path: string): string { return `/${this.i18n.locale()}${path === '/' ? '' : path}`; }
  /** Current query with some keys replaced; empty values are dropped. */
  protected qp(over: Record<string, string>): Record<string, string | null> {
    const cur = this.p();
    const base: Record<string, string | null> = { tab: cur.tab ?? null, area: cur.area ?? null, q: cur.q ?? null, a: null };
    for (const [k, v] of Object.entries(over)) base[k] = v || null;
    return base;
  }
  protected go(over: Record<string, string>): void { void this.router.navigate([], { queryParams: this.qp(over) }); }
}
