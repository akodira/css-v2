import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TPipe } from '../../core/i18n';

interface Section {
  id: string; title: string; lead?: string; paras?: string[]; steps?: string[]; bullets?: string[]; note?: string; warn?: string;
  table?: { head: string[]; rows: string[][] }; faq?: { q: string; a: string }[];
}

/** Ticket status guide, same as v1: a printable manual with a table of contents (texts in StatusGuide.sections). */
@Component({
  selector: 'app-status-guide',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <a [routerLink]="'/' + i18n.locale() + '/admin/ticket-status'" class="inline-flex min-h-11 items-center font-semibold text-brand-ink underline">{{ 'StatusGuide.back' | t }}</a>
        <button type="button" (click)="print()" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'StatusGuide.print' | t }}</button>
      </div>
      <header>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'StatusGuide.title' | t }}</h1>
        <p class="mt-2 max-w-prose text-muted">{{ 'StatusGuide.subtitle' | t }}</p>
      </header>
      <div class="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav [attr.aria-label]="'StatusGuide.toc' | t" class="print:hidden lg:sticky lg:top-4 lg:self-start">
          <h2 class="mb-2 text-sm font-bold text-muted">{{ 'StatusGuide.toc' | t }}</h2>
          <ol class="flex flex-col gap-0.5 text-sm">
            @for (s of sections(); track s.id) { <li><a [href]="'#' + s.id" (click)="jump($event, s.id)" class="flex min-h-9 items-center rounded-md px-2 hover:bg-brand-soft hover:text-brand-ink">{{ s.title }}</a></li> }
          </ol>
        </nav>
        <div class="flex min-w-0 flex-col gap-10">
          @for (s of sections(); track s.id) {
            <section [id]="s.id" [attr.aria-labelledby]="s.id + '-h'" class="scroll-mt-6">
              <h2 [id]="s.id + '-h'" class="text-2xl font-bold tracking-tight">{{ s.title }}</h2>
              <div class="mt-3 flex max-w-prose flex-col gap-3 leading-relaxed">
                @if (s.lead) { <p class="text-lg">{{ s.lead }}</p> }
                @for (p of s.paras ?? []; track $index) { <p>{{ p }}</p> }
              </div>
              @if (s.table; as tb) {
                <div class="mt-4 overflow-x-auto rounded-xl border border-line">
                  <table class="w-full min-w-[32rem] border-collapse text-start text-sm">
                    <thead class="bg-brand-soft"><tr>@for (h of tb.head; track $index) { <th scope="col" class="px-4 py-2.5 text-start font-bold">{{ h }}</th> }</tr></thead>
                    <tbody>
                      @for (r of tb.rows; track $index) {
                        <tr class="border-t border-line align-top">
                          @for (c of r; track $index) {
                            @if ($first) { <th scope="row" class="px-4 py-2.5 text-start font-semibold">{{ c }}</th> } @else { <td class="px-4 py-2.5">{{ c }}</td> }
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (s.steps) { <ol class="mt-4 flex max-w-prose list-decimal flex-col gap-2 ps-6 leading-relaxed marker:font-bold marker:text-brand">@for (x of s.steps; track $index) { <li>{{ x }}</li> }</ol> }
              @if (s.bullets) { <ul class="mt-4 flex max-w-prose list-disc flex-col gap-2 ps-6 leading-relaxed marker:text-brand">@for (x of s.bullets; track $index) { <li>{{ x }}</li> }</ul> }
              @if (s.faq) {
                <div class="mt-4 flex flex-col gap-2">
                  @for (f of s.faq; track $index) {
                    <details class="rounded-xl border border-line bg-surface open:shadow-card">
                      <summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ f.q }}</summary>
                      <p class="border-t border-line px-5 py-3 leading-relaxed">{{ f.a }}</p>
                    </details>
                  }
                </div>
              }
              @if (s.note) { <p class="mt-4 max-w-prose rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm text-brand-ink">{{ s.note }}</p> }
              @if (s.warn) { <p role="note" class="mt-4 max-w-prose rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ s.warn }}</p> }
            </section>
          }
        </div>
      </div>
    </main>`,
})
export class StatusGuidePage {
  protected readonly i18n = inject(I18n);
  protected readonly sections = computed(() => { this.i18n.locale(); return this.i18n.raw<Section[]>('StatusGuide.sections') ?? []; });
  protected print(): void { window.print(); }
  /** In-page links: scroll without changing the route (the app uses path routing). */
  protected jump(e: Event, id: string): void { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
