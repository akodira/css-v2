import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth, problemOf } from '../../core/auth';
import { CommentActions, CustomerLifecycle, LifecycleApi, TicketLifecycle, TicketLinksNotice } from './lifecycle';
import { I18n, TPipe } from '../../core/i18n';
import { NewTicketOptions, Paged, SiteService, TicketDetail, TicketListItem, TicketSummary, TicketsApi } from '../../core/api';
import { AttachmentList, FilePicker, Uploads, checkFiles } from '../../shared/files';
import { Alert, PRIORITY_TONE, Req, ReqNote, STATUS_STRIPE, SortTh, StatusBadge } from '../../shared/ui';

const CARD: Record<string, string> = {
  active: 'border-s-amber-500 bg-warn-soft text-warn-ink',
  waiting: 'border-s-danger bg-danger-soft text-danger',
  resolved: 'border-s-ok bg-ok-soft text-ok',
  closed: 'border-s-brand bg-brand-soft text-brand-ink',
};

/** Auto-refresh every N seconds (Settings, System rules; 0 turns it off). */
export function autoRefresh(load: () => void): void {
  const site = inject(SiteService);
  const destroy = inject(DestroyRef);
  const secs = site.info()?.autoRefreshSeconds ?? 30;
  if (secs > 0) {
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, secs * 1000);
    destroy.onDestroy(() => clearInterval(h));
  }
}

/**
 * Same as v1 AutoRefreshBar: "Updates automatically every N seconds." with Pause / Resume.
 * Re-reads the page data on a timer while the tab is visible; renders nothing when Settings turn it off.
 */
@Component({
  selector: 'app-auto-refresh',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (secs > 0) {
      <p class="flex flex-wrap items-center gap-2 text-sm text-muted" role="status">
        <span>{{ paused() ? ('AutoRefresh.paused' | t) : ('AutoRefresh.note' | t: { seconds: secs }) }}</span>
        <button type="button" (click)="paused.set(!paused())" class="min-h-9 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-bg">{{ (paused() ? 'AutoRefresh.resume' : 'AutoRefresh.pause') | t }}</button>
      </p>
    }`,
})
export class AutoRefreshBar {
  readonly tick = output<void>();
  protected readonly secs = inject(SiteService).info()?.autoRefreshSeconds ?? 30;
  protected readonly paused = signal(false);
  private last = Date.now();
  constructor() {
    if (this.secs <= 0) return;
    const run = () => { if (document.visibilityState !== 'visible' || this.paused()) return; this.last = Date.now(); this.tick.emit(); };
    const h = setInterval(run, this.secs * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - this.last >= this.secs * 1000) run(); };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => { clearInterval(h); document.removeEventListener('visibilitychange', onVisible); });
  }
}

@Component({
  selector: 'app-my-tickets',
  imports: [RouterLink, TPipe, StatusBadge, SortTh, AutoRefreshBar],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight">{{ 'Tickets.title' | t }}</h1>
          <p class="mt-1 text-muted">{{ 'Tickets.subtitle' | t }}</p>
        </div>
        <a [routerLink]="link('/tickets/new')" class="flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Tickets.newTicket' | t }}</a>
      </div>
      <app-auto-refresh (tick)="load()" />

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        @for (k of groups; track k) {
          <button type="button" (click)="setGroup(k)" [attr.aria-current]="k === group() ? 'true' : null"
            class="cursor-pointer rounded-xl border border-line border-s-4 p-4 text-start shadow-card hover:brightness-95" [class]="cards[k] + (k === group() ? ' ring-2 ring-current' : '')">
            <dt class="text-sm font-semibold">{{ 'Tickets.summary.' + k | t }}</dt>
            <dd class="mt-1 text-3xl font-bold">{{ count(k) }}</dd>
          </button>
        }
      </dl>

      <div class="flex flex-wrap items-end justify-between gap-3">
        <nav [attr.aria-label]="'Tickets.title' | t" class="flex flex-wrap gap-2">
          @for (f of filters; track f) {
            <button type="button" (click)="setGroup(f)" [attr.aria-current]="f === group() ? 'true' : null"
              class="flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-semibold" [class]="f === group() ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:bg-bg'">{{ 'Tickets.filters.' + f | t }}</button>
          }
        </nav>
        <form role="search" class="flex items-end gap-2" (submit)="$event.preventDefault(); page.set(1); load()">
          <div class="flex flex-col gap-1">
            <label for="q" class="text-sm font-semibold">{{ 'Tickets.searchLabel' | t }}</label>
            <input id="q" type="search" maxlength="60" dir="auto" [value]="q()" (input)="q.set($any($event.target).value)" [placeholder]="'Tickets.searchPlaceholder' | t" class="min-h-11 w-64 max-w-full rounded-lg border border-line bg-surface px-3" />
          </div>
          <button type="submit" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Tickets.searchButton' | t }}</button>
        </form>
      </div>

      @if (data()?.items?.length === 0) {
        <div class="rounded-md border border-line bg-surface p-10 text-center">
          <p class="text-muted">{{ (group() === 'all' && !q() ? 'Tickets.empty' : 'Tickets.emptyFiltered') | t }}</p>
          @if (group() === 'all' && !q()) { <a [routerLink]="link('/tickets/new')" class="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Tickets.emptyCta' | t }}</a> }
        </div>
      } @else if (data()) {
        <div class="relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table class="w-full min-w-[46rem] text-start text-sm">
            <caption class="sr-only">{{ 'Tickets.title' | t }}</caption>
            <thead class="border-b border-line bg-chrome text-white"><tr>
              @for (c of columns; track c) { <th app-sort-th [label]="'Tickets.col.' + c | t" [key]="c" [(sort)]="sort" [(desc)]="desc"></th> }
            </tr></thead>
            <tbody>
              @for (r of data()!.items; track r.id) {
                <tr class="border-b border-line last:border-0 hover:bg-bg" [class]="stripe[r.status] ?? ''">
                  <td class="whitespace-nowrap px-4 py-3"><a [routerLink]="link('/tickets/' + r.id)" class="font-semibold text-brand-ink hover:underline" dir="ltr">{{ r.reference }}</a></td>
                  <td class="max-w-72 truncate px-4 py-3" dir="auto">{{ r.subject }}</td>
                  <td class="px-4 py-3 text-muted">{{ i18n.pick(r.categoryEn, r.categoryAr) }}</td>
                  <td class="px-4 py-3"><app-status-badge [status]="r.status" /></td>
                  <td class="whitespace-nowrap px-4 py-3 text-muted">{{ i18n.date(r.createdAt) }}</td>
                  <td class="whitespace-nowrap px-4 py-3 text-muted">{{ i18n.date(r.updatedAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (pages() > 1) {
        <nav [attr.aria-label]="'Tickets.page' | t: { page: page(), pages: pages() }" class="flex items-center justify-between gap-3">
          @if (page() > 1) { <button type="button" (click)="go(-1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Tickets.previous' | t }}</button> } @else { <span></span> }
          <span class="text-sm text-muted">{{ 'Tickets.page' | t: { page: page(), pages: pages() } }}</span>
          @if (page() < pages()) { <button type="button" (click)="go(1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Tickets.next' | t }}</button> } @else { <span></span> }
        </nav>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class MyTicketsPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly cards = CARD;
  protected readonly stripe = STATUS_STRIPE;
  protected readonly groups = ['active', 'waiting', 'resolved', 'closed'] as const;
  protected readonly filters = ['all', 'active', 'waiting', 'resolved', 'closed'] as const;
  protected readonly columns = ['ticket', 'subject', 'category', 'status', 'created', 'updated'];
  private readonly qp = this.route.snapshot.queryParamMap;

  // Filters live in the address, so they survive paging, refresh and the back button.
  protected readonly group = signal(this.qp.get('filter') ?? 'all');
  protected readonly q = signal(this.qp.get('q') ?? '');
  protected readonly page = signal(Number(this.qp.get('page') ?? 1) || 1);
  protected readonly sort = signal(this.qp.get('sort') ?? 'updated');
  protected readonly desc = signal(this.qp.get('dir') !== 'asc');
  protected readonly data = signal<Paged<TicketListItem> | null>(null);
  protected readonly summary = signal<TicketSummary | null>(null);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / 25)));

  constructor() {
    effect(() => { this.sort(); this.desc(); untracked(() => this.load()); });
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  count(k: string): number { const s = this.summary(); return s ? (s as unknown as Record<string, number>)[k] ?? 0 : 0; }
  setGroup(g: string): void { this.group.set(this.group() === g && g !== 'all' ? 'all' : g); this.page.set(1); this.load(); }
  go(d: number): void { this.page.update((p) => p + d); this.load(); }

  load(): void {
    const g = this.group(), q = this.q().trim(), sort = this.sort(), desc = this.desc(), page = this.page();
    void this.router.navigate([], {
      replaceUrl: true, queryParams: {
        filter: g !== 'all' ? g : null, q: q || null, page: page > 1 ? page : null,
        sort: sort !== 'updated' || !desc ? sort : null, dir: sort !== 'updated' || !desc ? (desc ? 'desc' : 'asc') : null,
      },
    });
    void this.api.list({ view: 'mine', group: g === 'all' ? undefined : g, search: q, page, pageSize: 25, sort, desc }).then((d) => this.data.set(d));
    void this.api.summary(true).then((s) => this.summary.set(s));
  }
}

interface DirRow { id: string; fullName: string; email: string; organizationId: string | null; organizationName: string | null; branchId: string | null; branchName: string | null }

@Component({
  selector: 'app-new-ticket',
  imports: [RouterLink, TPipe, Req, ReqNote, Alert, FilePicker],
  template: `
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      @if (!staff) { <a [routerLink]="link('/tickets')" class="text-sm font-semibold text-brand-ink underline">{{ 'Tickets.title' | t }}</a> }
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ (staff ? 'StaffTicket.title' : 'NewTicket.title') | t }}</h1>
        <p class="mt-1 text-muted">{{ (staff ? 'StaffTicket.subtitle' : 'NewTicket.subtitle') | t }}</p>
      </div>
      @if (created(); as c) {
        <section class="flex flex-col gap-4 rounded-md border border-line bg-surface p-6">
          @if (staff) { <app-alert tone="success">{{ 'StaffTicket.created' | t: { reference: c.reference } }}</app-alert> }
          @if (failedFiles().length) { <app-alert>{{ (staff ? 'StaffTicket.filesFailed' : 'NewTicket.filesFailed') | t: { files: failedFiles().join(', ') } }}</app-alert> }
          <div class="flex flex-wrap gap-2">
            <a [routerLink]="link((staff ? '/console/tickets/' : '/tickets/') + c.id)" class="flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'StaffTicket.view' | t }}</a>
            @if (staff) { <button type="button" (click)="another()" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'StaffTicket.another' | t }}</button> }
          </div>
        </section>
      } @else if (opts(); as o) {
        @if (followUp(); as fu) { <p class="rounded-md border border-line bg-brand-soft p-4 text-sm">{{ 'Lifecycle.customer.followUpNotice' | t: { reference: fu.reference } }}</p> }
        <form class="flex flex-col gap-5 rounded-md border border-line bg-surface p-6" novalidate (submit)="$event.preventDefault(); submit()">
          @if (staff) {
            <div class="flex flex-col gap-1.5">
              <label for="st-org" class="text-sm font-semibold">{{ 'StaffTicket.organization' | t }}</label>
              <select id="st-org" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="orgId()" (change)="pickOrg($any($event.target).value)">
                <option value="">{{ 'StaffTicket.selectOrganization' | t }}</option>
                @for (x of dirOrgs(); track x.id) { <option [value]="x.id">{{ x.name }}</option> }
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="st-branch" class="text-sm font-semibold">{{ 'StaffTicket.branch' | t }}</label>
              <select id="st-branch" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:bg-bg" [value]="branchId()" [disabled]="!orgId() || (!dirBranches().length && !hasNoBranch())"
                (change)="branchId.set($any($event.target).value); customerId.set('')">
                <option value="">{{ 'StaffTicket.selectBranch' | t }}</option>
                @for (x of dirBranches(); track x.id) { <option [value]="x.id">{{ x.name }}</option> }
                @if (hasNoBranch()) { <option [value]="NONE">{{ 'StaffTicket.noBranch' | t }}</option> }
              </select>
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="st-customer" class="text-sm font-semibold">{{ 'StaffTicket.customer' | t }}<app-req /></label>
              <select id="st-customer" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:bg-bg" [value]="customerId()" [disabled]="!branchReady()"
                (change)="customerId.set($any($event.target).value)" [attr.aria-invalid]="err()['customerId'] ? true : null">
                <option value="">{{ 'StaffTicket.selectCustomer' | t }}</option>
                @for (x of dirCustomers(); track x.id) { <option [value]="x.id">{{ x.fullName }} ({{ x.email }})</option> }
              </select>
              @if (err()['customerId']) { <p class="text-sm font-medium text-danger">{{ 'StaffTicket.errors.customerRequired' | t }}</p> }
            </div>
          }
          <div class="flex flex-col gap-1.5">
            <label for="typeId" class="text-sm font-semibold">{{ 'TicketTypes.label' | t }}<app-req /></label>
            <select id="typeId" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base aria-[invalid=true]:border-danger" [value]="typeId()" (change)="pickType($any($event.target).value)"
              [attr.aria-invalid]="err()['typeId'] ? true : null">
              <option value="">{{ 'TicketTypes.select' | t }}</option>
              @for (ty of o.types; track ty.id) { <option [value]="ty.id">{{ i18n.pick(ty.nameEn, ty.nameAr) }}</option> }
            </select>
            @if (currentType(); as ty) {
              @if (i18n.pick(ty.descriptionEn, ty.descriptionAr) || i18n.pick(ty.examplesEn, ty.examplesAr)) {
                <div class="flex flex-col gap-0.5 rounded-lg bg-brand-soft px-3 py-2 text-sm" dir="auto">
                  @if (i18n.pick(ty.descriptionEn, ty.descriptionAr)) { <span>{{ i18n.pick(ty.descriptionEn, ty.descriptionAr) }}</span> }
                  @if (i18n.pick(ty.examplesEn, ty.examplesAr)) { <span class="text-muted">{{ 'TicketTypes.examples' | t: { list: i18n.pick(ty.examplesEn, ty.examplesAr) } }}</span> }
                </div>
              }
            }
            @if (err()['typeId']) { <p class="text-sm font-medium text-danger">{{ 'NewTicket.errors.typeRequired' | t }}</p> }
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="cat" class="text-sm font-semibold">{{ 'NewTicket.category' | t }}<app-req /></label>
            <select id="cat" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:bg-bg" [disabled]="!typeId()" [value]="categoryId()" (change)="categoryId.set($any($event.target).value); subcategoryId.set('')"
              [attr.aria-invalid]="err()['categoryId'] ? true : null">
              <option value="">{{ (typeId() ? 'NewTicket.selectCategory' : 'TicketTypes.chooseTypeFirst') | t }}</option>
              @for (c of categories(); track c.id) { <option [value]="c.id" [selected]="c.id === categoryId()">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
            </select>
            @if (err()['categoryId']) { <p class="text-sm font-medium text-danger">{{ 'NewTicket.errors.categoryRequired' | t }}</p> }
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="sub" class="text-sm font-semibold">{{ (staff ? 'StaffTicket.subcategory' : 'NewTicket.subcategory') | t }}</label>
            <select id="sub" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:bg-bg" [disabled]="!subcategories().length" [value]="subcategoryId()" (change)="subcategoryId.set($any($event.target).value)">
              <option value="">{{ 'NewTicket.noSubcategory' | t }}</option>
              @for (s of subcategories(); track s.id) { <option [value]="s.id" [selected]="s.id === subcategoryId()">{{ i18n.pick(s.nameEn, s.nameAr) }}</option> }
            </select>
          </div>

          @if (o.customerPicksPriority) {
            <div class="flex flex-col gap-1.5">
              <label for="prio" class="text-sm font-semibold">{{ 'NewTicket.priority' | t }}<app-req /></label>
              <select id="prio" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="priority()" (change)="priority.set($any($event.target).value)">
                <option value="">{{ 'NewTicket.selectPriority' | t }}</option>
                @for (p of o.priorities; track p.code) { <option [value]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
              </select>
              <p class="text-sm text-muted">{{ 'NewTicket.priorityHint' | t }}</p>
            </div>
          }

          <div class="flex flex-col gap-1.5">
            <label for="subject" class="text-sm font-semibold">{{ 'NewTicket.subject' | t }}<app-req /></label>
            <input id="subject" maxlength="200" dir="auto" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base aria-[invalid=true]:border-danger"
              [value]="subject()" (input)="subject.set($any($event.target).value); suggestFor($any($event.target).value)" [attr.aria-invalid]="err()['subject'] ? true : null" />
            <p class="text-sm" [class]="err()['subject'] ? 'font-medium text-danger' : 'text-muted'">{{ (err()['subject'] ? 'NewTicket.errors.subjectLength' : 'NewTicket.subjectHint') | t }}</p>
          </div>
          @if (hints().length) {
            <div class="rounded-lg border border-brand/30 bg-brand-soft p-4 text-sm" aria-live="polite">
              <p class="font-semibold">{{ 'NewTicket.suggestions' | t }}</p>
              <ul class="mt-2 flex flex-col gap-1">@for (h of hints(); track h.slug) { <li><a [href]="link('/kb/' + h.slug)" target="_blank" rel="noopener" class="font-semibold text-brand-ink underline" dir="auto">{{ i18n.pick(h.titleEn, h.titleAr) }}</a></li> }</ul>
            </div>
          }

          <div class="flex flex-col gap-1.5">
            <label for="desc" class="text-sm font-semibold">{{ (staff ? 'StaffTicket.description' : 'NewTicket.description') | t }}<app-req /></label>
            <textarea id="desc" rows="7" maxlength="10000" dir="auto" class="rounded-lg border border-line bg-surface p-3 text-base aria-[invalid=true]:border-danger"
              [value]="description()" (input)="description.set($any($event.target).value)" [attr.aria-invalid]="err()['description'] ? true : null"></textarea>
            <p class="text-sm" [class]="err()['description'] ? 'font-medium text-danger' : 'text-muted'">{{ (err()['description'] ? 'NewTicket.errors.descriptionLength' : 'NewTicket.descriptionHint') | t }}</p>
          </div>

          @for (f of fields(); track f.id) {
            <div class="flex flex-col gap-1.5">
              <label [for]="'cf-' + f.key" class="text-sm font-semibold">{{ i18n.pick(f.labelEn, f.labelAr) }}@if (f.isRequired) {<app-req />}</label>
              @switch (f.type) {
                @case ('long_text') { <textarea [id]="'cf-' + f.key" rows="3" dir="auto" class="rounded-lg border border-line bg-surface p-3" (input)="setField(f.key, $any($event.target).value)"></textarea> }
                @case ('checkbox') { <input [id]="'cf-' + f.key" type="checkbox" class="h-5 w-5" (change)="setField(f.key, $any($event.target).checked)" /> }
                @case ('dropdown') {
                  <select [id]="'cf-' + f.key" class="min-h-11 rounded-lg border border-line bg-surface px-3" (change)="setField(f.key, $any($event.target).value)">
                    <option value="">-</option>
                    @for (c of choices(f.options); track c.value) { <option [value]="c.value">{{ c.label }}</option> }
                  </select>
                }
                @case ('number') { <input [id]="'cf-' + f.key" type="number" dir="ltr" class="min-h-11 rounded-lg border border-line bg-surface px-3" (input)="setField(f.key, $any($event.target).value === '' ? null : +$any($event.target).value)" /> }
                @case ('date') { <input [id]="'cf-' + f.key" type="date" class="min-h-11 rounded-lg border border-line bg-surface px-3" (input)="setField(f.key, $any($event.target).value)" /> }
                @default { <input [id]="'cf-' + f.key" dir="auto" class="min-h-11 rounded-lg border border-line bg-surface px-3" (input)="setField(f.key, $any($event.target).value)" /> }
              }
              @if (err()[f.key]) { <p class="text-sm font-medium text-danger">{{ 'Auth.errors.required' | t }}</p> }
            </div>
          }

          <app-file-picker [label]="(staff ? 'StaffTicket.attachments' : 'NewTicket.attachments') | t" [(files)]="files" [disabled]="pending()" />

          @if (error()) { <app-alert>{{ ((staff ? 'StaffTicket.errors.' : 'NewTicket.errors.') + error()) | t }}</app-alert> }
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" [disabled]="pending()" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:opacity-60">{{ (pending() ? 'NewTicket.submitting' : 'NewTicket.submit') | t }}</button>
            <app-req-note />
          </div>
        </form>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class NewTicketPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  protected readonly opts = signal<NewTicketOptions | null>(null);
  protected readonly typeId = signal('');
  protected readonly categoryId = signal('');
  protected readonly subcategoryId = signal('');
  protected readonly priority = signal('');
  protected readonly subject = signal('');
  protected readonly description = signal('');
  protected readonly values = signal<Record<string, unknown>>({});
  protected readonly err = signal<Record<string, boolean>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal(false);

  // Staff "new ticket for a customer" (route data staff: true): organization, then branch, then the customer.
  protected readonly staff = inject(ActivatedRoute).snapshot.data['staff'] === true;
  protected readonly NONE = 'none';
  private readonly http = inject(HttpClient);
  protected readonly dir = signal<DirRow[]>([]);
  protected readonly orgId = signal('');
  protected readonly branchId = signal('');
  protected readonly customerId = signal('');
  protected readonly created = signal<{ id: string; reference: string } | null>(null);
  private readonly uploads = inject(Uploads);
  protected readonly files = signal<File[]>([]);
  protected readonly failedFiles = signal<string[]>([]);
  private readonly lcApi = inject(LifecycleApi);
  protected readonly hints = signal<{ slug: string; titleEn: string; titleAr: string | null }[]>([]);
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly followUp = signal<{ id: string; reference: string } | null>(null);
  protected suggestFor(v: string): void {
    if (this.staff) return;
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (v.trim().length < 3) { this.hints.set([]); return; }
    this.hintTimer = setTimeout(() => void this.lcApi.suggest(v).then((h) => this.hints.set(h)).catch(() => undefined), 400);
  }
  private orgKey(r: DirRow): string { return r.organizationId ?? this.NONE; }
  protected readonly dirOrgs = computed(() => [...new Map(this.dir().map((r) => [this.orgKey(r), r.organizationName ?? this.i18n.t('StaffTicket.noOrganization')])).entries()].map(([id, name]) => ({ id, name })));
  private readonly inOrg = computed(() => this.dir().filter((r) => this.orgKey(r) === this.orgId()));
  protected readonly dirBranches = computed(() => [...new Map(this.inOrg().filter((r) => r.branchId).map((r) => [r.branchId!, r.branchName ?? ''])).entries()].map(([id, name]) => ({ id, name })));
  protected readonly hasNoBranch = computed(() => this.inOrg().some((r) => !r.branchId));
  protected readonly dirCustomers = computed(() => this.inOrg().filter((r) => (this.branchId() === this.NONE ? !r.branchId : r.branchId === this.branchId())));
  protected readonly branchReady = computed(() => this.orgId() !== '' && (this.dirBranches().length === 0 || this.branchId() !== ''));

  // Type first, then the categories that type offers, then subcategory and custom fields.
  protected readonly categories = computed(() => {
    const o = this.opts(); const t = o?.types.find((x) => x.id === this.typeId());
    return o && t ? o.categories.filter((c) => t.categoryIds.includes(c.id)) : [];
  });
  protected readonly currentType = computed(() => this.opts()?.types.find((x) => x.id === this.typeId()) ?? null);
  protected readonly subcategories = computed(() => this.opts()?.categories.find((c) => c.id === this.categoryId())?.subcategories ?? []);
  protected readonly fields = computed(() => (this.opts()?.fields ?? []).filter((f) => f.visibleToCustomer && (!f.categoryId || f.categoryId === this.categoryId())));

  constructor() {
    void this.api.options().then((o) => this.opts.set(o));
    const fu = inject(ActivatedRoute).snapshot.queryParamMap.get('followUp');
    if (!this.staff && fu && /^[0-9a-f-]{36}$/.test(fu)) void this.api.get(fu).then((t) => this.followUp.set({ id: t.id, reference: t.reference })).catch(() => undefined);
    if (this.staff) void firstValueFrom(this.http.get<DirRow[]>('/api/tickets/customers')).then((d) => this.dir.set(d)).catch(() => this.error.set('notAllowed'));
  }
  protected pickOrg(v: string): void {
    this.orgId.set(v); this.customerId.set('');
    const list = this.dir().filter((r) => this.orgKey(r) === v);
    this.branchId.set(v && !list.some((r) => r.branchId) ? this.NONE : '');
  }
  protected another(): void {
    this.created.set(null); this.orgId.set(''); this.branchId.set(''); this.customerId.set(''); this.typeId.set(''); this.categoryId.set(''); this.subcategoryId.set('');
    this.priority.set(''); this.subject.set(''); this.description.set(''); this.values.set({}); this.err.set({}); this.error.set(null); this.files.set([]); this.failedFiles.set([]);
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  pickType(id: string): void { this.typeId.set(id); if (!this.categories().some((c) => c.id === this.categoryId())) { this.categoryId.set(''); this.subcategoryId.set(''); } }
  setField(key: string, v: unknown): void { this.values.update((x) => ({ ...x, [key]: v })); }
  choices(json: string): { value: string; label: string }[] {
    try {
      const arr = JSON.parse(json) as (string | { value: string; label_en?: string; label_ar?: string })[];
      return arr.map((o) => typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: this.i18n.pick(o.label_en ?? o.value, o.label_ar ?? o.value) });
    } catch { return []; }
  }

  submit(): void {
    const e: Record<string, boolean> = {};
    if (this.staff && !this.customerId()) e['customerId'] = true;
    if (!this.typeId()) e['typeId'] = true;
    if (!this.categoryId()) e['categoryId'] = true;
    const s = this.subject().trim(), d = this.description().trim();
    if (s.length < 3 || s.length > 200) e['subject'] = true;
    if (d.length < 10 || d.length > 10000) e['description'] = true;
    for (const f of this.fields()) {
      const v = this.values()[f.key];
      if (f.isRequired && (v === undefined || v === null || v === '' || v === false)) e[f.key] = true;
    }
    this.err.set(e);
    if (Object.keys(e).length || checkFiles(this.files(), this.uploads.rules()).length) return;
    this.pending.set(true);
    this.error.set(null);
    const custom = Object.fromEntries(Object.entries(this.values()).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    this.api.create({
      typeId: this.typeId(), categoryId: this.categoryId(), subcategoryId: this.subcategoryId() || null,
      subject: s, description: d, customValues: custom, priority: this.priority() || null, requesterId: this.staff ? this.customerId() : null,
    }).then(async (r) => {
      const fu = this.followUp();
      if (fu) await this.lcApi.post(r.id, 'follow-up', { of: fu.id }).catch(() => undefined);
      const failed = this.files().length ? await this.uploads.upload(r.id, null, this.files()) : [];
      this.failedFiles.set(failed);
      if (this.staff || failed.length) this.created.set(r); else void this.router.navigateByUrl(this.link('/tickets/' + r.id));
    })
      .catch((err) => {
        const p = problemOf(err);
        const map: Record<string, string> = { typeId: 'typeInvalid', categoryId: 'categoryInvalid', priority: 'priorityRequired', subject: 'subjectLength', description: 'descriptionLength' };
        if (this.staff && p.field === 'requesterId') { this.error.set('notAllowed'); return; }
        this.error.set(p.field && map[p.field] ? map[p.field] : p.status === 403 ? (this.staff ? 'notAllowed' : 'notCustomer') : 'generic');
      })
      .finally(() => this.pending.set(false));
  }
}

@Component({
  selector: 'app-ticket-detail',
  imports: [RouterLink, TPipe, StatusBadge, Alert, AttachmentList, FilePicker, CustomerLifecycle, TicketLinksNotice, CommentActions, AutoRefreshBar, Req],
  template: `
    @if (t(); as tk) {
      <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <app-auto-refresh (tick)="load()" />
        <a [routerLink]="link('/tickets')" class="text-sm font-semibold text-brand-ink underline">{{ 'Tickets.title' | t }}</a>

        <header class="flex flex-col gap-3 rounded-md border border-line bg-surface p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-muted"><span>{{ 'Ticket.reference' | t }}: </span><span dir="ltr" class="font-semibold text-ink">{{ tk.reference }}</span></p>
            <app-status-badge [status]="tk.status" />
          </div>
          <h1 class="text-2xl font-bold leading-snug tracking-tight" dir="auto">{{ tk.subject }}</h1>
          <dl class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-3">
            @if (tk.names.typeEn) { <div><dt class="inline">{{ 'TicketTypes.label' | t }}: </dt><dd class="inline font-semibold text-ink">{{ i18n.pick(tk.names.typeEn, tk.names.typeAr) }}</dd></div> }
            <div><dt class="inline">{{ 'Ticket.category' | t }}: </dt><dd class="inline font-semibold text-ink">{{ i18n.pick(tk.names.categoryEn, tk.names.categoryAr) }}@if (tk.names.subcategoryEn) { / {{ i18n.pick(tk.names.subcategoryEn, tk.names.subcategoryAr) }} }</dd></div>
            <div><dt class="inline">{{ 'Ticket.created' | t }}: </dt><dd class="inline font-semibold text-ink">{{ i18n.date(tk.createdAt) }}</dd></div>
            <div><dt class="inline">{{ 'Ticket.updated' | t }}: </dt><dd class="inline font-semibold text-ink">{{ i18n.date(tk.updatedAt) }}</dd></div>
            <div><dt class="inline">{{ 'Ticket.assignedTo' | t }}: </dt><dd class="inline font-semibold text-ink" dir="auto">{{ tk.names.assignee ?? ('Ticket.notAssigned' | t) }}</dd></div>
            @if (tk.names.teamEn) { <div><dt class="inline">{{ 'Ticket.team' | t }}: </dt><dd class="inline font-semibold text-ink">{{ i18n.pick(tk.names.teamEn, tk.names.teamAr) }}</dd></div> }
            <div><dt class="inline">{{ 'Ticket.priority' | t }}: </dt><dd class="inline"><span class="inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold" [class]="prioTone(tk.names.priorityColor)">{{ i18n.pick(tk.names.priorityEn, tk.names.priorityAr) }}</span></dd></div>
          </dl>
        </header>

        <section aria-labelledby="progress" class="rounded-md border border-line bg-surface p-6">
          <h2 id="progress" class="text-lg font-bold">{{ 'Ticket.progress' | t }}</h2>
          <ol class="mt-4 flex flex-col gap-3">
            @for (s of tk.timeline; track $index; let last = $last) {
              <li class="flex items-start gap-3" [attr.aria-current]="last ? 'step' : null">
                <span aria-hidden="true" class="mt-1.5 h-3 w-3 shrink-0 rounded-full" [class]="last ? 'bg-brand' : 'bg-line'"></span>
                <span><span class="font-semibold">{{ 'CustomerStatus.' + s.to | t }}</span> <span class="text-sm text-muted">· {{ i18n.date(s.at) }}</span></span>
              </li>
            }
          </ol>
        </section>

        <section aria-labelledby="request" class="rounded-md border border-line bg-surface p-6">
          <h2 id="request" class="text-lg font-bold">{{ 'Ticket.description' | t }}</h2>
          <p class="mt-3 whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.description }}</p>
          <app-attachments [ticketId]="tk.id" [items]="ticketFiles()" />
        </section>

        <app-ticket-links-notice [lc]="lc()" />

        @if ((tk.status === 'resolved' || tk.status === 'closed') && tk.resolutionSummary) {
          <section aria-labelledby="resolution" class="rounded-md border border-brand bg-brand-soft p-6">
            <h2 id="resolution" class="text-lg font-bold text-brand-ink">{{ 'Ticket.resolution' | t }}</h2>
            <p class="mt-3 whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.resolutionSummary }}</p>
          </section>
        }

        <section aria-labelledby="conversation" class="flex flex-col gap-3">
          <h2 id="conversation" class="text-lg font-bold">{{ 'Ticket.conversation' | t }}</h2>
          @for (m of replies(); track m.id) {
            <article class="rounded-md border p-4" [class]="m.authorId === tk.requesterId ? 'border-line bg-surface' : 'border-brand/30 bg-brand-soft/50'">
              <header class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span class="font-semibold" dir="auto">{{ m.authorId === tk.requesterId ? ('Ticket.you' | t) : (m.authorName ?? ('Ticket.support' | t)) }}</span>
                <span class="text-muted">{{ i18n.date(m.createdAt) }}</span>
              </header>
              <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{{ m.body }}@if (m.editedAt) { <span class="ms-1 text-xs text-muted">({{ 'Comments.edited' | t }})</span> }</p>
              <app-attachments [ticketId]="tk.id" [items]="m.attachments" />
              <app-comment-actions [ticketId]="tk.id" [message]="m" [me]="auth.me()?.id ?? null" (changed)="load()" />
            </article>
          } @empty { <p class="rounded-md border border-line bg-surface p-4 text-muted">{{ 'Ticket.noReplies' | t }}</p> }
        </section>

        @if (tk.status !== 'closed' && tk.status !== 'resolved') {
          <section class="rounded-md border border-line bg-surface p-6">
            <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); send()">
              <label for="reply" class="text-sm font-semibold">{{ 'Ticket.reply.label' | t }}</label>
              <textarea id="reply" rows="4" maxlength="10000" dir="auto" [placeholder]="'Ticket.reply.placeholder' | t" class="rounded-lg border border-line bg-surface p-3" [value]="reply()" (input)="reply.set($any($event.target).value)"></textarea>
              <app-file-picker [label]="'Ticket.attachments' | t" [(files)]="files" [disabled]="pending()" />
              @if (msg()) { <app-alert [tone]="msgTone()">{{ msg() }}</app-alert> }
              <div><button type="submit" [disabled]="pending()" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:opacity-60">{{ 'Ticket.reply.submit' | t }}</button></div>
            </form>
          </section>
        }

        @if (tk.status === 'resolved') {
          <section class="flex flex-col gap-4 rounded-md border border-line bg-surface p-6">
            <p class="leading-relaxed">{{ 'Ticket.reply.resolvedNote' | t }}</p>
            <div class="flex flex-wrap gap-3">
              <button type="button" (click)="move('closed')" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Ticket.close.button' | t }}</button>
            </div>
          </section>
        }

        @if (tk.canReopen) {
          <section class="flex flex-col gap-3 rounded-md border border-line bg-surface p-6">
            @if (tk.status === 'closed') { <p class="leading-relaxed text-muted">{{ 'Ticket.reply.closedNote' | t }}</p> }
            @if (tk.status !== 'closed') { <h2 class="text-lg font-bold">{{ 'Ticket.reopen.title' | t }}</h2> }
            <label for="reopen" class="text-sm font-semibold">{{ 'Ticket.reopen.reason' | t }}<app-req /></label>
            <textarea id="reopen" rows="3" dir="auto" class="rounded-lg border border-line bg-surface p-3" [value]="reopenReason()" (input)="reopenReason.set($any($event.target).value)"></textarea>
            <p class="text-sm text-muted">{{ 'Ticket.reopen.reasonHint' | t }}</p>
            <div><button type="button" (click)="move('reopened')" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Ticket.reopen.submit' | t }}</button></div>
          </section>
        } @else if (tk.status === 'closed' && !tk.names.closureAllowsReopen) {
          <p class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Ticket.cannotReopen' | t: { reason: i18n.pick(tk.names.closureEn, tk.names.closureAr) } }}</p>
        }
        <app-customer-lifecycle [ticket]="tk" [lc]="lc()" (changed)="load()" />
      </main>
    } @else if (notFound()) {
      <main class="mx-auto w-full max-w-3xl px-4 py-12"><app-alert>{{ 'Ticket.errors.notFound' | t }}</app-alert></main>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class TicketDetailPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(TicketsApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly t = signal<TicketDetail | null>(null);
  protected readonly notFound = signal(false);
  protected readonly reply = signal('');
  protected readonly reopenReason = signal('');
  protected readonly pending = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly msgTone = signal<'error' | 'success'>('success');
  private readonly uploads = inject(Uploads);
  protected readonly auth = inject(Auth);
  private readonly lcApi = inject(LifecycleApi);
  protected readonly lc = signal<TicketLifecycle | null>(null);
  protected readonly files = signal<File[]>([]);
  protected readonly ticketFiles = computed(() => (this.t()?.messages ?? []).find((m) => m.kind === 'ticket_files')?.attachments ?? []);
  protected readonly replies = computed(() => (this.t()?.messages ?? []).filter((m) => m.kind === 'public_reply'));
  private readonly id = this.route.snapshot.paramMap.get('id')!;

  constructor() {
    this.load();
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  prioTone(c: string | null): string { return PRIORITY_TONE[c ?? 'grey'] ?? PRIORITY_TONE['grey']; }

  load(): void {
    this.api.get(this.id).then((t) => this.t.set(t)).catch(() => this.notFound.set(true));
    this.lcApi.get(this.id).then((l) => this.lc.set(l)).catch(() => undefined);
  }

  send(): void {
    const body = this.reply().trim();
    if (!body) { this.msgTone.set('error'); this.msg.set(this.i18n.t('Ticket.errors.messageLength')); return; }
    if (checkFiles(this.files(), this.uploads.rules()).length) return;
    this.pending.set(true);
    this.api.message(this.id, 'public_reply', body)
      .then(async (r) => {
        const failed = this.files().length ? await this.uploads.upload(this.id, r.id, this.files()) : [];
        this.reply.set(''); this.files.set([]);
        this.msgTone.set(failed.length ? 'error' : 'success');
        this.msg.set(failed.length ? this.i18n.t('AdminV2.filesFailed', { files: failed.join(', ') }) : this.i18n.t('Ticket.reply.sent'));
        this.load();
      })
      .catch((e) => { this.msgTone.set('error'); this.msg.set(this.errorText(problemOf(e).code)); })
      .finally(() => this.pending.set(false));
  }

  move(to: 'closed' | 'reopened'): void {
    const reason = to === 'reopened' ? this.reopenReason().trim() : undefined;
    if (to === 'reopened' && (!reason || reason.length < 3)) { this.msgTone.set('error'); this.msg.set(this.i18n.t('Ticket.errors.reasonLength')); return; }
    this.api.status(this.id, { to, reason }).then(() => { this.reopenReason.set(''); this.load(); })
      .catch((e) => { this.msgTone.set('error'); this.msg.set(this.errorText(problemOf(e).code)); });
  }

  private errorText(code: string): string {
    const key = code === 'rate_limited' ? 'rateLimited' : code === 'not_found' ? 'notFound' : code === 'forbidden' ? 'notAllowed' : 'generic';
    return this.i18n.t('Ticket.errors.' + key);
  }
}
