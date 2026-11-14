import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { AREAS, ARTICLES, FLOWS, audienceOf, canSee, pickL, type Article, type Audience, type FeatureOption, type Flow, type L } from '../help';

type Tab = 'features' | 'flows' | 'howto';
const TABS: Tab[] = ['features', 'flows', 'howto'];
const TONE: Record<string, string> = { a: 'bg-brand-soft text-brand-ink', o: 'bg-ok-soft text-ok', d: 'bg-warn-soft text-warn-ink' };
/** Badge colours of option cards (design sample docs/design/help-center-sample.html). */
const OPTION_TONE: Record<string, string> = {
  neutral: 'bg-bg text-muted', brand: 'bg-brand-soft text-brand-ink', purple: 'bg-violet-100 text-violet-800',
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn-ink', danger: 'bg-danger-soft text-danger',
};
const OPTION_DOT: Record<string, string> = {
  neutral: 'bg-muted', brand: 'bg-brand', purple: 'bg-violet-600', ok: 'bg-ok', warn: 'bg-amber-500', danger: 'bg-danger',
};
/** One line icon per topic (24px stroke icons, same family as the side menu). */
const AREA_ICON: Record<string, string> = {
  tickets: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4zM14 5v2M14 11v2M14 17v2',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  kb: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sla: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  catalog: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  people: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  system: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  email: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM22 7l-10 6L2 7',
  site: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
};
type Item = { audience: Audience[]; perm?: string | string[] };

/** **bold** inside guide text becomes <strong>; the rest stays plain text (escaped). */
function rich(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/(\*\*[^*]+\*\*)/g).map((p) => (p.startsWith('**') ? `<strong class="font-semibold">${esc(p.slice(2, -2))}</strong>` : esc(p))).join('');
}
const optionText = (o: FeatureOption): L[] => [o.name, ...(o.tag ? [o.tag] : []), ...(o.text ? [o.text] : []), ...(o.points ?? [])];
const haystack = (a: Article | Flow, locale: string): string => {
  const parts: L[] = [a.title, a.summary];
  if ('steps' in a) parts.push(...a.steps);
  if ('tips' in a && a.tips) parts.push(...a.tips);
  if ('nodes' in a) parts.push(...a.nodes.map((n) => n.label));
  if ('kind' in a && a.kind === 'feature') {
    if (a.rule) parts.push(a.rule);
    if (a.optionsTitle) parts.push(a.optionsTitle);
    for (const o of a.options ?? []) parts.push(...optionText(o));
    parts.push(...(a.points ?? []), ...(a.notes ?? []));
  }
  return parts.map((p) => pickL(p, locale)).join(' ').replace(/\*\*/g, '').toLowerCase();
};

/**
 * Help Center, same content as v1: features, flows and how-to guides filtered to what the person's role and permissions allow.
 * Each entry is a card with a topic icon, a one-line lead, the rule that always applies, option cards, points, notes and
 * tips, and a footer with the related how-to guides and the page it describes (design: docs/design/help-center-sample.html).
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
                <span class="flex items-center gap-2"><ng-container *ngTemplateOutlet="iconT; context: { $implicit: a.id, size: 16 }" />{{ L(a.title) }}</span>
                <span class="text-xs text-muted">{{ a.count }}</span></a>
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
              <section class="flex flex-col gap-5" [attr.aria-label]="'Help.tab.features' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.features' | t }}</h2> }
                @for (a of features(); track a.id) {
                  <article [id]="a.id" class="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                    <ng-container *ngTemplateOutlet="headT; context: { $implicit: a, kind: 'feature' }" />
                    @if (hasBody(a)) {
                      <div class="flex flex-col gap-4 p-5">
                        @if (fx(a).rule; as r) {
                          <p class="flex items-start gap-2.5 rounded-lg bg-brand-soft px-3.5 py-2.5 text-[0.95rem] font-semibold text-brand-ink">
                            <svg aria-hidden="true" class="mt-0.5 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            <span [innerHTML]="R(r)"></span></p>
                        }
                        @if (fx(a).options?.length) {
                          <div class="flex flex-col gap-2.5">
                            @if (fx(a).optionsTitle; as ot) { <h4 class="text-xs font-bold uppercase tracking-wide text-muted">{{ L(ot) }}</h4> }
                            @if (chipsOnly(a)) {
                              <ul class="flex flex-wrap gap-2">
                                @for (o of fx(a).options; track $index) { <li class="rounded-full px-3 py-1 text-sm font-semibold" [class]="optTone(o.tone)">{{ L(o.name) }}</li> }
                              </ul>
                            } @else {
                              <ul class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
                                @for (o of fx(a).options; track $index) {
                                  <li class="flex flex-col gap-2 rounded-lg border border-line p-4">
                                    <div class="flex flex-col items-start gap-1.5">
                                      <span class="flex items-center gap-2 font-bold"><span aria-hidden="true" class="h-2.5 w-2.5 shrink-0 rounded-full" [class]="optDot(o.tone)"></span>{{ L(o.name) }}</span>
                                      @if (o.tag) { <span class="rounded-full px-2.5 py-0.5 text-xs font-bold" [class]="optTone(o.tone)">{{ L(o.tag) }}</span> }
                                    </div>
                                    @if (o.text) { <p class="text-sm text-ink/90" [innerHTML]="R(o.text)"></p> }
                                    @if (o.points?.length) {
                                      <ul class="flex flex-col gap-1 text-sm">@for (x of o.points; track $index) {
                                        <li class="flex gap-2"><span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted"></span><span [innerHTML]="R(x)"></span></li> }</ul>
                                    }
                                  </li>
                                }
                              </ul>
                            }
                          </div>
                        }
                        @if (fx(a).points?.length) {
                          <ul class="flex flex-col gap-2">@for (x of fx(a).points; track $index) {
                            <li class="flex gap-2.5"><svg aria-hidden="true" class="mt-1 shrink-0 text-ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                              <span class="max-w-prose" [innerHTML]="R(x)"></span></li> }</ul>
                        }
                        @for (n of fx(a).notes ?? []; track $index) {
                          <p class="flex items-start gap-2.5 text-sm text-muted">
                            <svg aria-hidden="true" class="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                            <span [innerHTML]="R(n)"></span></p>
                        }
                        <ng-container *ngTemplateOutlet="tipsT; context: { $implicit: a.tips }" />
                      </div>
                    }
                    <ng-container *ngTemplateOutlet="footT; context: { $implicit: a, rel: related(a) }" />
                  </article>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }

            @if (show('flows')) {
              <section class="flex flex-col gap-5" [attr.aria-label]="'Help.tab.flows' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.flows' | t }}</h2> }
                @for (f of flowList(); track f.id) {
                  <article [id]="f.id" class="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                    <ng-container *ngTemplateOutlet="headT; context: { $implicit: f, kind: 'flow' }" />
                    <div class="p-5">
                      <ol class="flex flex-wrap items-center gap-2">
                        @for (n of f.nodes; track $index) {
                          <li class="flex items-center gap-2">
                            @if ($index > 0) { <span aria-hidden="true" class="text-muted rtl:-scale-x-100">→</span> }
                            <span class="rounded-lg px-3 py-1.5 text-sm font-semibold" [class]="tone(n.tone)">{{ L(n.label) }}</span>
                          </li>
                        }
                      </ol>
                    </div>
                  </article>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }

            @if (show('howto')) {
              <section class="flex flex-col gap-3" [attr.aria-label]="'Help.tab.howto' | t">
                @if (q()) { <h2 class="text-lg font-bold">{{ 'Help.tab.howto' | t }}</h2> }
                @for (a of howtos(); track a.id) {
                  <details [id]="a.id" [open]="p().a === a.id || q() !== ''" class="group overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                    <summary class="flex min-h-14 cursor-pointer list-none items-start gap-4 p-5 hover:bg-bg/60 [&::-webkit-details-marker]:hidden">
                      <ng-container *ngTemplateOutlet="iconTile; context: { $implicit: a.area }" />
                      <span class="min-w-0 flex-1">
                        <span class="block text-xs font-semibold text-muted">{{ areaTitle(a.area) }} · {{ 'Help.kind.howto' | t }} · {{ 'Help.stepCount' | t: { count: steps(a).length } }}</span>
                        <span class="mt-0.5 block text-base font-bold">{{ L(a.title) }}</span>
                        <span class="mt-0.5 block text-sm text-muted">{{ L(a.summary) }}</span>
                      </span>
                      <span class="flex flex-col items-end gap-2">
                        <ng-container *ngTemplateOutlet="badges; context: { $implicit: a }" />
                        <svg aria-hidden="true" class="text-muted transition-transform group-open:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      </span>
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
                    </div>
                    <ng-container *ngTemplateOutlet="footT; context: { $implicit: a, rel: related(a) }" />
                  </details>
                } @empty { <ng-container *ngTemplateOutlet="emptyT" /> }
              </section>
            }
          </div>
        </div>
      </div>
    </main>

    <!-- Card header: topic icon, "Topic · Kind", title, one-line lead, role badges -->
    <ng-template #headT let-item let-kind="kind">
      <header class="flex flex-wrap items-start gap-4 border-b border-line p-5">
        <ng-container *ngTemplateOutlet="iconTile; context: { $implicit: item.area }" />
        <div class="min-w-0 flex-1 basis-60">
          <p class="text-xs font-semibold text-muted">{{ areaTitle(item.area) }} · {{ 'Help.kind.' + kind | t }}</p>
          <h3 class="mt-0.5 text-lg font-bold tracking-tight">{{ L(item.title) }}</h3>
          <p class="mt-1 max-w-prose text-muted" [innerHTML]="R(item.summary)"></p>
        </div>
        <ng-container *ngTemplateOutlet="badges; context: { $implicit: item }" />
      </header>
    </ng-template>
    <ng-template #iconTile let-area>
      <span aria-hidden="true" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <ng-container *ngTemplateOutlet="iconT; context: { $implicit: area, size: 22 }" /></span>
    </ng-template>
    <ng-template #iconT let-area let-size="size">
      <svg aria-hidden="true" class="shrink-0" [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon(area)" /></svg>
    </ng-template>
    <ng-template #badges let-item>
      <span class="flex flex-wrap gap-1.5">
        @if (item.audience.length === 0 && !item.perm) { <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Help.for.admin' | t }}</span> }
        @for (x of item.audience; track x) { <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Help.for.' + x | t }}</span> }
        @if (item.perm) { <span class="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn-ink">{{ 'Help.needsPermission' | t }}</span> }
      </span>
    </ng-template>
    <ng-template #tipsT let-tips>
      @if (tips?.length) {
        <div class="flex items-start gap-3 rounded-lg bg-warn-soft p-3.5 text-sm text-warn-ink">
          <svg aria-hidden="true" class="mt-0.5 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" /></svg>
          <div class="min-w-0"><p class="font-semibold">{{ 'Help.tips' | t }}</p>
            @if (tips.length === 1) { <p class="mt-0.5" [innerHTML]="R(tips[0])"></p> }
            @else { <ul class="mt-1 flex list-disc flex-col gap-1 ps-5">@for (x of tips; track $index) { <li [innerHTML]="R(x)"></li> }</ul> }
          </div>
        </div>
      }
    </ng-template>
    <!-- Card footer: related how-to guides, and the page the entry describes -->
    <ng-template #footT let-item let-rel="rel">
      @if (rel.length || item.path) {
        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg/50 px-5 py-3.5">
          @if (rel.length) {
            <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <svg aria-hidden="true" class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h7" /></svg>
              <span>{{ 'Help.guides' | t }}:</span>
              @for (r of rel; track r.id) {
                @if (!$first) { <span aria-hidden="true">·</span> }
                <a [routerLink]="[]" [queryParams]="{ tab: 'howto', a: r.id }" class="font-semibold text-brand-ink underline underline-offset-2">{{ L(r.title) }}</a>
              }
            </p>
          } @else { <span></span> }
          @if (item.path) {
            <a [routerLink]="link(item.path)" class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-ink">{{ 'Help.openPage' | t }}
              <svg aria-hidden="true" class="rtl:-scale-x-100" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
          }
        </footer>
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
  protected optTone(t?: string): string { return OPTION_TONE[t ?? 'neutral'] ?? OPTION_TONE['neutral']; }
  protected optDot(t?: string): string { return OPTION_DOT[t ?? 'neutral'] ?? OPTION_DOT['neutral']; }
  protected icon(area: string): string { return AREA_ICON[area] ?? AREA_ICON['kb']; }
  protected areaTitle(id: string): string { const a = AREAS.find((x) => x.id === id); return a ? this.L(a.title) : id; }
  protected steps(a: Article): L[] { return a.kind === 'howto' ? a.steps : []; }
  /** The feature-only parts of an entry (rule, options, points, notes). */
  protected fx(a: Article) { return a.kind === 'feature' ? a : { rule: undefined, optionsTitle: undefined, options: undefined, points: undefined, notes: undefined }; }
  protected hasBody(a: Article): boolean {
    const f = this.fx(a);
    return !!(f.rule || f.options?.length || f.points?.length || f.notes?.length || a.tips?.length);
  }
  /** Options with no text are drawn as a row of coloured chips (for example account statuses). */
  protected chipsOnly(a: Article): boolean { return (this.fx(a).options ?? []).every((o) => !o.text && !o.points?.length && !o.tag); }
  /** How-to guides for the footer: the ones listed on the entry, otherwise (for a feature) the guides that open the same page. */
  protected related(a: Article): Article[] {
    const visible = this.articles().filter((x) => x.kind === 'howto' && x.id !== a.id);
    if (a.related?.length) return a.related.map((id) => visible.find((x) => x.id === id)).filter((x): x is Article => !!x);
    if (a.kind !== 'feature' || !a.path) return [];
    return visible.filter((x) => x.path === a.path).slice(0, 4);
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
