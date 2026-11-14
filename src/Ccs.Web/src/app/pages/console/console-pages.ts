import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth, problemOf } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { Paged, SiteService, TicketDetail, TicketListItem, TicketsApi } from '../../core/api';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Alert, ClockInput, PRIORITY_STRIPE, PRIORITY_TONE, PrioIcon, Req, ReqNote, SlaChip, SlaClockCard, SortTh, StatusBadge } from '../../shared/ui';
import { AutoRefreshBar, autoRefresh } from '../tickets/customer-pages';
import { CannedApi } from '../help-pages';
import { AttachmentList, FilePicker, Uploads, checkFiles } from '../../shared/files';
import { NewTicketOptions } from '../../core/api';
import { CommentActions, LifecycleApi, StaffLifecycle, TicketLifecycle } from '../tickets/lifecycle';

interface StaffExtra {
  requesterPhone: string | null; teamLeaders: string[];
  sla: { state: string; firstResponseDue: string | null; resolutionDue: string | null; firstRespondedAt: string | null; resolvedAt: string | null; pausedAt: string | null; pausedTotalSeconds: number } | null;
  assignments: { at: string; teamEn: string | null; teamAr: string | null; agent: string | null; by: string | null; reason: string | null }[];
  teams: { id: string; nameEn: string; nameAr: string }[]; members: { teamId: string; userId: string; fullName: string }[];
  priorities: { code: string; nameEn: string; nameAr: string; color: string }[]; fixedPriority: string | null;
  moves: { to: string; requiresReason: boolean }[]; closureReasons: { code: string; nameEn: string; nameAr: string }[];
  canWork: boolean; canReassign: boolean; canClaim: boolean;
}

const SLA_TONE: Record<string, string> = {
  on_track: 'bg-ok-soft text-ok', due_soon: 'bg-warn-soft text-warn-ink', breached: 'bg-danger-soft text-danger',
  paused: 'bg-bg text-muted border border-line', completed: 'bg-brand-soft text-brand-ink',
};

/** Support console queue: counters, views, filters and columns. The "My team" SLA counters are on the SLA report. */
@Component({
  selector: 'app-console-queue',
  imports: [RouterLink, TPipe, StatusBadge, SortTh, SlaChip, PrioIcon],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <h1 class="text-3xl font-bold tracking-tight">{{ 'Console.title' | t }}</h1>
          @if (auth.has('create_for_customer')) { <a [routerLink]="link('/console/tickets/new')" class="flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'StaffTicket.title' | t }}</a> }
        </div>
        <p class="mt-2 text-muted">{{ 'Console.subtitle' | t }}</p>
        @if (readOnly()) { <p role="status" class="mt-3 rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'Console.readOnly' | t }}</p> }
      </header>

      <div class="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>{{ paused() ? ('AutoRefresh.paused' | t) : ('AutoRefresh.note' | t: { seconds: refreshSecs }) }}</span>
        <button type="button" (click)="paused.set(!paused())" class="min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-3 font-semibold text-ink hover:bg-bg">{{ (paused() ? 'AutoRefresh.resume' : 'AutoRefresh.pause') | t }}</button>
      </div>

      <dl class="grid grid-cols-2 gap-4 md:grid-cols-5">
        <div [class]="stat + ' border-s-4 border-s-brand bg-brand-soft'"><dt class="text-sm font-semibold text-brand-ink">{{ 'Console.summary.mine' | t }}</dt><dd class="text-3xl font-bold text-brand-ink">{{ counts()?.mine ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-violet-500 bg-violet-50'"><dt class="text-sm font-semibold text-violet-800">{{ 'Console.summary.unassigned' | t }}</dt><dd class="text-3xl font-bold text-violet-800">{{ counts()?.unassigned ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-danger bg-danger-soft'"><dt class="text-sm font-semibold text-danger">{{ 'Console.summary.breached' | t }}</dt><dd class="text-3xl font-bold text-danger">{{ counts()?.breached ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-amber-500 bg-warn-soft'"><dt class="text-sm font-semibold text-warn-ink">{{ 'Console.summary.dueSoon' | t }}</dt><dd class="text-3xl font-bold text-warn-ink">{{ counts()?.dueSoon ?? 0 }}</dd></div>
        <button type="button" (click)="showClosed()" [attr.aria-current]="status() === 'closed' ? 'true' : null" [class]="stat + ' cursor-pointer border-s-4 border-s-ok bg-ok-soft text-start hover:brightness-95' + (status() === 'closed' ? ' ring-2 ring-ok' : '')"><dt class="text-sm font-semibold text-ok">{{ 'Console.summary.closed' | t }}</dt><dd class="text-3xl font-bold text-ok">{{ counts()?.closed ?? 0 }}</dd></button>
      </dl>

      <nav [attr.aria-label]="'Console.title' | t" class="flex flex-wrap gap-2">
        @for (v of views; track v) {
          @if (v === 'escalated') {
            <button type="button" (click)="setView(v)" [attr.aria-current]="isView(v) ? 'page' : null" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold" [class]="isView(v) ? 'border-warn-ink bg-warn-ink text-white' : 'border-warn-ink bg-warn-soft text-warn-ink hover:brightness-95'">
              {{ 'Console.views.escalated' | t }}<span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="isView(v) ? 'bg-white text-warn-ink' : 'bg-warn-ink text-white'">{{ counts()?.escalated ?? 0 }}</span></button>
            <button type="button" (click)="showClosed()" [attr.aria-current]="status() === 'closed' ? 'page' : null" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold" [class]="status() === 'closed' ? 'border-ok bg-ok text-white' : 'border-ok bg-ok-soft text-ok hover:brightness-95'">
              {{ 'Console.views.closed' | t }}<span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="status() === 'closed' ? 'bg-white text-ok' : 'bg-ok text-white'">{{ counts()?.closed ?? 0 }}</span></button>
          } @else {
            <button type="button" (click)="setView(v)" [attr.aria-current]="isView(v) ? 'page' : null" class="flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-semibold" [class]="isView(v) ? 'border-brand bg-brand text-white' : 'border-line bg-surface hover:bg-bg'">{{ 'Console.views.' + v | t }}</button>
          }
        }
      </nav>

      <form class="grid grid-cols-1 gap-3 rounded-md border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-6" (submit)="$event.preventDefault(); page.set(1); load()">
        <label class="flex flex-col gap-1 text-sm font-semibold lg:col-span-2">{{ 'Console.filters.search' | t }}
          <input type="search" maxlength="80" dir="auto" [class]="field" [value]="q()" (input)="q.set($any($event.target).value)" /></label>
        <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Console.filters.status' | t }}
          <select [class]="field" [value]="status()" (change)="status.set($any($event.target).value)">
            <option value="active">{{ 'Console.filters.active' | t }}</option><option value="any">{{ 'Console.filters.any' | t }}</option>
            @for (s of statuses; track s) { <option [value]="s">{{ 'StaffStatus.' + s | t }}</option> }
          </select></label>
        <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Console.filters.priority' | t }}
          <select [class]="field" [value]="priority()" (change)="priority.set($any($event.target).value)">
            <option value="">{{ 'Console.filters.any' | t }}</option>
            @for (p of prios(); track p.code) { <option [value]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
          </select></label>
        <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Console.filters.sla' | t }}
          <select [class]="field" [value]="slaF()" (change)="slaF.set($any($event.target).value)">
            <option value="">{{ 'Console.filters.any' | t }}</option>
            @for (s of slaStates; track s) { <option [value]="s">{{ 'Sla.' + s | t }}</option> }
          </select></label>
        <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Console.ticket.team' | t }}
          <select [class]="field" [value]="team()" (change)="team.set($any($event.target).value)">
            <option value="">{{ 'Console.filters.any' | t }}</option>
            @for (x of teams(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }
          </select></label>
        <div class="flex items-end"><button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 text-base font-semibold text-white hover:bg-brand-ink">{{ 'Console.filters.searchButton' | t }}</button></div>
      </form>

      @if (data() && !data()!.items.length) { <p class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Console.empty' | t }}</p> }
      @else {
        <div class="relative overflow-x-auto rounded-md border border-line bg-surface">
          <table class="w-full min-w-[56rem] text-start text-sm">
            <caption class="sr-only">{{ 'Console.title' | t }}</caption>
            <thead class="border-b border-line bg-chrome text-white"><tr>
              @for (c of columns; track c) { <th app-sort-th [label]="'Console.columns.' + c | t" [key]="c" [(sort)]="sort" [(desc)]="desc"></th> }
            </tr></thead>
            <tbody>
              @for (r of data()?.items ?? []; track r.id) {
                <tr class="border-b border-line align-top last:border-0 hover:bg-bg" [class]="pstripe[r.priorityColor ?? 'grey'] ?? ''">
                  <td class="px-4 py-3"><a [routerLink]="link('/console/tickets/' + r.id)" class="font-semibold text-brand-ink underline" dir="ltr">{{ r.reference }}</a><p class="mt-1 max-w-64 truncate" dir="auto">{{ r.subject }}</p></td>
                  <td class="px-4 py-3"><p dir="auto">{{ r.requesterName }}</p><p class="text-muted" dir="ltr">{{ r.requesterEmail }}</p></td>
                  <td class="px-4 py-3"><p dir="auto">{{ i18n.pick(r.teamEn, r.teamAr) || ('Console.noTeam' | t) }}</p><p class="text-muted" dir="auto">{{ r.assigneeName ?? ('Console.unassignedLabel' | t) }}</p></td>
                  <td class="px-4 py-3"><span [class]="'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ' + prio(r.priorityColor)"><app-prio-icon [name]="r.priorityIcon ?? 'minus'" [size]="12" />{{ i18n.pick(r.priorityEn, r.priorityAr) || r.priority }}</span></td>
                  <td class="px-4 py-3"><app-status-badge [status]="r.status" [staff]="true" /></td>
                  <td class="px-4 py-3">
                    @if (clockOf(r); as ck) { <app-sla-chip [clock]="ck" /> } @else if (r.slaState) { <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [class]="sla[r.slaState] ?? ''">{{ 'Sla.' + r.slaState | t }}</span> } @else { - }
                    @if (dueOf(r); as due) { <p class="mt-1 text-xs text-muted">{{ 'Console.due' | t: { when: i18n.date(due) } }}</p> }
                  </td>
                  <td class="px-4 py-3 text-muted">{{ i18n.date(r.createdAt) }}</td>
                  <td class="px-4 py-3 text-muted">{{ i18n.date(r.updatedAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <nav class="flex items-center justify-between gap-3" [attr.aria-label]="'Console.page' | t: { page: page(), pages: pages() }">
        @if (page() > 1) { <button type="button" (click)="go(-1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 font-semibold">{{ 'Console.previous' | t }}</button> } @else { <span></span> }
        <span class="text-sm text-muted">{{ 'Console.page' | t: { page: page(), pages: pages() } }}</span>
        @if (page() < pages()) { <button type="button" (click)="go(1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 font-semibold">{{ 'Console.next' | t }}</button> } @else { <span></span> }
      </nav>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class ConsoleQueuePage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly api = inject(TicketsApi);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly refreshSecs = inject(SiteService).info()?.autoRefreshSeconds ?? 30;
  protected readonly sla = SLA_TONE;
  protected readonly pstripe = PRIORITY_STRIPE;
  protected readonly stat = 'rounded-md border border-line bg-surface p-4';
  protected readonly field = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base';
  protected readonly statuses = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed', 'reopened'];
  protected readonly slaStates = ['on_track', 'due_soon', 'breached', 'paused', 'completed'];
  protected readonly views = ['mine', 'unassigned', 'escalated', 'all'];
  protected readonly columns = ['ticket', 'customer', 'team', 'priority', 'status', 'sla', 'created', 'updated'];
  private readonly qp = this.route.snapshot.queryParamMap;
  /** Same default as today: admins, leaders and viewers see all; agents their own. */
  private readonly defaultView = (() => { const r = this.auth.me()?.roles ?? []; return r.some((x) => x === 'admin' || x === 'team_leader' || x === 'management_viewer') ? 'all' : 'mine'; })();
  protected readonly view = signal(this.normView(this.qp.get('view')) ?? this.defaultView);
  protected readonly status = signal(this.qp.get('status') ?? 'active');
  protected readonly priority = signal(this.qp.get('priority') ?? '');
  protected readonly slaF = signal(this.qp.get('sla') ?? '');
  protected readonly team = signal(this.qp.get('team') ?? '');
  /** Set by the ticket count link on Categories (v1: /console?view=all&status=any&category=…). */
  private readonly category = this.qp.get('category') ?? '';
  protected readonly q = signal(this.qp.get('q') ?? '');
  protected readonly page = signal(Number(this.qp.get('page') ?? 1) || 1);
  protected readonly sort = signal(this.qp.get('sort') ?? 'updated');
  protected readonly desc = signal(this.qp.get('dir') !== 'asc');
  protected readonly paused = signal(false);
  protected readonly data = signal<Paged<TicketListItem> | null>(null);
  protected readonly counts = signal<{ mine: number; unassigned: number; breached: number; dueSoon: number; closed: number; escalated: number; strip: { green: number; yellow: number; red: number; overdue: number } | null } | null>(null);
  protected readonly prios = signal<{ code: string; nameEn: string; nameAr: string }[]>([]);
  protected readonly teams = signal<{ id: string; nameEn: string; nameAr: string }[]>([]);
  protected readonly readOnly = computed(() => !(this.auth.me()?.roles ?? []).some((r) => r === 'agent' || r === 'team_leader' || r === 'admin'));
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / 20)));

  constructor() {
    effect(() => { this.sort(); this.desc(); untracked(() => this.load()); });
    autoRefresh(() => { if (!this.paused()) this.load(); });
    void this.api.options().then((o) => this.prios.set(o.priorities.map((p) => ({ code: p.code, nameEn: p.nameEn, nameAr: p.nameAr }))));
    void firstValueFrom(this.http.get<{ id: string; nameEn: string; nameAr: string }[]>('/api/console/teams')).then((t) => this.teams.set(t), () => undefined);
  }

  private normView(v: string | null): string | null { return v === 'assigned' ? 'mine' : v && ['mine', 'unassigned', 'escalated', 'all'].includes(v) ? v : null; }
  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  prio(c: string | null): string { return PRIORITY_TONE[c ?? 'grey'] ?? PRIORITY_TONE['grey']; }
  isView(v: string): boolean { return this.view() === v && this.status() !== 'closed'; }
  setView(v: string): void { this.view.set(v); if (this.status() === 'closed') this.status.set('active'); this.page.set(1); this.load(); }
  showClosed(): void { this.view.set('all'); this.status.set('closed'); this.page.set(1); this.load(); }
  go(d: number): void { this.page.update((p) => p + d); this.load(); }
  clockOf(r: TicketListItem): ClockInput | null {
    if (!r.firstRespondedAt && r.firstResponseDue) return { dueAt: r.firstResponseDue, startAt: r.createdAt, pausedAt: r.pausedAt, pausedTotalSeconds: r.pausedTotalSeconds };
    if (r.resolutionDue) return { dueAt: r.resolutionDue, startAt: r.createdAt, pausedAt: r.pausedAt, pausedTotalSeconds: r.pausedTotalSeconds, doneAt: r.resolvedAt };
    return null;
  }
  dueOf(r: TicketListItem): string | null { return r.firstRespondedAt ? r.resolutionDue : (r.firstResponseDue ?? r.resolutionDue); }

  load(): void {
    const view = this.view(), status = this.status(), priority = this.priority(), sla = this.slaF(), team = this.team(), q = this.q().trim(), page = this.page(), sort = this.sort(), desc = this.desc();
    void this.router.navigate([], { replaceUrl: true, queryParams: {
      view: view !== this.defaultView ? view : null, status: status !== 'active' ? status : null, priority: priority || null, sla: sla || null, team: team || null, category: this.category || null,
      q: q || null, page: page > 1 ? page : null, sort: sort !== 'updated' ? sort : null, dir: desc ? null : 'asc' } });
    const apiView = view === 'mine' ? 'assigned' : view === 'all' ? undefined : view;
    const st = status === 'active' ? { group: 'open' } : status === 'any' ? {} : { status };
    void this.api.list({ view: apiView, ...st, priority: priority || undefined, sla: sla || undefined, teamId: team || undefined, categoryId: this.category || undefined, search: q, page, pageSize: 20, sort, desc }).then((d) => this.data.set(d));
    void firstValueFrom(this.http.get<NonNullable<ReturnType<typeof this.counts>>>('/api/console/counts')).then((c) => this.counts.set(c));
  }
}

/** Ticket workspace: reply or internal note, status change, claim (spec 7). Escalation, links and fields arrive in stage 4. */
@Component({
  selector: 'app-console-ticket',
  imports: [RouterLink, TPipe, StatusBadge, Alert, AttachmentList, FilePicker, StaffLifecycle, CommentActions, AutoRefreshBar, SlaClockCard, Req, ReqNote, PrioIcon],
  template: `
    @if (t(); as tk) {
      <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <app-auto-refresh (tick)="load()" />
        <a [routerLink]="link('/console')" class="text-sm font-semibold text-brand-ink underline">{{ 'Console.ticket.back' | t }}</a>
        @if (x() && !x()!.canWork) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'Console.readOnly' | t }}</p> }

        <header class="flex flex-col gap-3 rounded-md border border-line bg-surface p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p dir="ltr" class="font-semibold">{{ tk.reference }}</p>
            <div class="flex flex-wrap gap-2">
              <span [class]="'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ' + prio(tk.names.priorityColor)"><app-prio-icon [name]="tk.names.priorityIcon ?? 'minus'" [size]="12" />{{ i18n.pick(tk.names.priorityEn, tk.names.priorityAr) }}</span>
              <app-status-badge [status]="tk.status" [staff]="true" />
            </div>
          </div>
          <h1 class="text-2xl font-bold leading-snug tracking-tight" dir="auto">{{ tk.subject }}</h1>
          <p class="text-sm text-muted">
            {{ 'Console.ticket.assignedTo' | t }}: <b class="text-ink" dir="auto">{{ tk.names.assignee ?? ('Console.unassignedLabel' | t) }}</b>
            @if (x()?.teamLeaders?.length) { · {{ 'Console.ticket.teamLeader' | t }}: <b class="text-ink" dir="auto">{{ x()!.teamLeaders.join(', ') }}</b> }
          </p>
        </header>

        @if (x()?.sla; as s) {
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            @if (s.firstResponseDue) {
              <app-sla-clock-card [label]="'Console.ticket.firstResponse' | t"
                [clock]="{ dueAt: s.firstResponseDue, startAt: tk.createdAt, pausedTotalSeconds: s.pausedTotalSeconds, pausedAt: s.firstRespondedAt ? null : s.pausedAt, doneAt: s.firstRespondedAt }"
                [dueText]="s.firstRespondedAt ? ('Console.ticket.metAt' | t) + ' ' + i18n.date(s.firstRespondedAt) : ('Console.ticket.due' | t) + ' ' + i18n.date(s.firstResponseDue)" />
            }
            @if (s.resolutionDue) {
              <app-sla-clock-card [label]="'Console.ticket.resolution' | t"
                [clock]="{ dueAt: s.resolutionDue, startAt: tk.createdAt, pausedTotalSeconds: s.pausedTotalSeconds, pausedAt: s.pausedAt, doneAt: s.resolvedAt }"
                [dueText]="('Console.ticket.due' | t) + ' ' + i18n.date(s.resolutionDue)" />
            }
          </div>
        }

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div class="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <section aria-labelledby="request" class="rounded-md border border-line bg-surface p-6">
              <h2 id="request" class="text-lg font-bold">{{ 'Console.ticket.description' | t }}</h2>
              <p class="mt-3 whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.description }}</p>
              <app-attachments [ticketId]="tk.id" [items]="ticketFiles()" />
            </section>

            @if (tk.status === 'closed' && tk.names.closureEn) {
              <p class="rounded-md border border-line bg-surface px-4 py-3 text-sm"><span class="font-semibold">{{ 'Console.ticket.closureReason' | t }}: </span>{{ i18n.pick(tk.names.closureEn, tk.names.closureAr) }}</p>
            }
            @if (tk.resolutionSummary) {
              <section aria-labelledby="resolution" class="rounded-md border border-brand bg-brand-soft p-6">
                <h2 id="resolution" class="text-lg font-bold text-brand-ink">{{ 'Console.ticket.resolutionSummary' | t }}</h2>
                <p class="mt-3 whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.resolutionSummary }}</p>
              </section>
            }

            <section aria-labelledby="conv" class="flex flex-col gap-3">
              <h2 id="conv" class="text-lg font-bold">{{ 'Console.ticket.conversation' | t }}</h2>
              <ol class="flex flex-col gap-4">
                @for (m of comments(); track m.id) {
                  <li class="flex gap-3" [class.flex-row-reverse]="m.authorId === auth.me()?.id">
                    <span aria-hidden="true" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold" [class]="m.authorId === auth.me()?.id ? 'bg-chrome text-white' : 'bg-brand-soft text-brand-ink'">{{ initials(m.authorName) }}</span>
                    <div class="min-w-0 max-w-[85%] flex-1 sm:max-w-[75%] sm:flex-none">
                      <div class="rounded-2xl border p-4" [class]="m.kind === 'internal_note' ? 'border-warn bg-warn-soft' : m.authorId === auth.me()?.id ? 'border-line bg-surface' : 'border-brand bg-brand-soft'">
                        <p class="text-sm font-semibold"><span dir="auto">{{ m.authorName ?? ('Console.ticket.system' | t) }}</span>
                          <span class="font-normal text-muted"> · {{ (m.kind === 'internal_note' ? 'Console.ticket.internalNote' : m.authorId === tk.requesterId ? 'Console.ticket.customerLabel' : 'Console.ticket.staffLabel') | t }} · {{ i18n.date(m.createdAt) }}@if (m.editedAt) { · {{ 'Comments.edited' | t }} }</span></p>
                        <p class="mt-2 whitespace-pre-wrap leading-relaxed" dir="auto">{{ m.body }}</p>
                        <app-attachments [ticketId]="tk.id" [items]="m.attachments" />
                      </div>
                      <app-comment-actions [ticketId]="tk.id" [message]="m" [me]="auth.me()?.id ?? null" (changed)="load()" />
                    </div>
                  </li>
                } @empty { <p class="text-muted">{{ 'Console.ticket.noComments' | t }}</p> }
              </ol>
            </section>

            @if (tk.canReply) {
              <section aria-labelledby="reply" class="rounded-md border border-line bg-surface p-6">
                <h2 id="reply" class="mb-3 text-lg font-bold">{{ 'Console.reply.title' | t }}</h2>
                <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); send()" novalidate>
                  <fieldset class="flex flex-col gap-1.5">
                    <legend class="text-sm font-semibold">{{ 'Console.reply.kind' | t }}</legend>
                    <label class="flex min-h-11 items-center gap-2"><input type="radio" name="kind" class="h-5 w-5" [checked]="kind() === 'public_reply'" (change)="kind.set('public_reply')" />{{ 'Console.reply.public' | t }}</label>
                    @if (tk.canSeeInternalNotes) { <label class="flex min-h-11 items-center gap-2"><input type="radio" name="kind" class="h-5 w-5" [checked]="kind() === 'internal_note'" (change)="kind.set('internal_note')" />{{ 'Console.reply.internal' | t }}</label> }
                  </fieldset>
                  <div class="flex flex-col gap-1.5">
                    <label for="body" class="text-sm font-semibold">{{ 'Console.reply.body' | t }}<app-req /></label>
                    @if (canned().length) {
                      <div class="flex flex-wrap items-center gap-2">
                        <label for="canned" class="sr-only">{{ 'Console.reply.canned' | t }}</label>
                        <select id="canned" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" (change)="insertCanned($any($event.target))">
                          <option value="">{{ 'Console.reply.cannedPick' | t }}</option>
                          @for (c of canned(); track c.id) { <option [value]="c.id">{{ c.title }}</option> }
                        </select>
                        <a [routerLink]="link('/console/canned')" class="text-sm font-semibold text-brand-ink underline">{{ 'Console.reply.cannedManage' | t }}</a>
                      </div>
                    }
                    <textarea id="body" rows="5" maxlength="10000" dir="auto" class="rounded-lg border border-line p-3 text-base" [class]="kind() === 'internal_note' ? 'bg-warn-soft' : 'bg-surface'" [value]="body()" (input)="body.set($any($event.target).value)"></textarea>
                  </div>
                  <app-file-picker [label]="'NewTicket.attachments' | t" [(files)]="files" [disabled]="pending()" />
                  @if (notice() && where() === 'reply') { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
                  <div><button type="submit" [disabled]="pending()" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:opacity-60">{{ 'Console.reply.submit' | t }}</button> <app-req-note /></div>
                </form>
              </section>
            }
          </div>

          <aside class="flex flex-col gap-6" [attr.aria-label]="'Console.ticket.activity' | t">
            <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="cust">
              <h2 id="cust" class="text-lg font-bold">{{ 'Console.ticket.customer' | t }}</h2>
              <dl class="mt-3 flex flex-col gap-2">
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.customer' | t }}</dt><dd class="font-semibold" dir="auto">{{ tk.requesterName }}</dd></div>
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.email' | t }}</dt><dd dir="ltr" class="break-all">{{ tk.requesterEmail }}</dd></div>
                @if (x()?.requesterPhone) { <div><dt class="text-sm text-muted">{{ 'Console.ticket.phone' | t }}</dt><dd dir="ltr">{{ x()!.requesterPhone }}</dd></div> }
                @if (tk.names.typeEn) { <div><dt class="text-sm text-muted">{{ 'TicketTypes.label' | t }}</dt><dd>{{ i18n.pick(tk.names.typeEn, tk.names.typeAr) }}</dd></div> }
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.category' | t }}</dt><dd>{{ i18n.pick(tk.names.categoryEn, tk.names.categoryAr) }}@if (tk.names.subcategoryEn) { / {{ i18n.pick(tk.names.subcategoryEn, tk.names.subcategoryAr) }} }</dd></div>
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.team' | t }}</dt><dd>{{ i18n.pick(tk.names.teamEn, tk.names.teamAr) || '-' }}</dd></div>
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.agent' | t }}</dt><dd dir="auto">{{ tk.names.assignee ?? ('Console.unassignedLabel' | t) }}</dd></div>
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.created' | t }}</dt><dd>{{ i18n.date(tk.createdAt) }}</dd></div>
                <div><dt class="text-sm text-muted">{{ 'Console.ticket.updated' | t }}</dt><dd>{{ i18n.date(tk.updatedAt) }}</dd></div>
              </dl>
            </section>

            @if (x()?.canWork) { <app-staff-lifecycle part="fields" [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" /> }

            @if (x()?.sla; as s) {
              <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="sla">
                <h2 id="sla" class="text-lg font-bold">{{ 'Console.ticket.sla' | t }}</h2>
                <div class="mt-3 flex flex-col gap-2">
                  <span class="inline-flex w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold" [class]="sla[s.state] ?? ''">{{ 'Sla.' + s.state | t }}</span>
                  @if (s.firstResponseDue) { <p class="text-sm"><span class="text-sm text-muted">{{ 'Console.ticket.firstResponse' | t }}: </span>{{ s.firstRespondedAt ? ('Console.ticket.metAt' | t) + ' ' + i18n.date(s.firstRespondedAt) : ('Console.ticket.due' | t) + ' ' + i18n.date(s.firstResponseDue) }}</p> }
                  @if (s.resolutionDue) { <p class="text-sm"><span class="text-sm text-muted">{{ 'Console.ticket.resolution' | t }}: </span>{{ 'Console.ticket.due' | t }} {{ i18n.date(s.resolutionDue) }}</p> }
                </div>
              </section>
            }

            <app-staff-lifecycle part="links" [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" />

            @if (x()?.canWork) {
              @if (x()!.moves.length) {
                <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="st">
                  <h2 id="st" class="mb-3 text-lg font-bold">{{ 'Console.statusForm.title' | t }}</h2>
                  <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); changeStatus()" novalidate>
                    <div class="flex flex-col gap-1.5">
                      <label for="to" class="text-sm font-semibold">{{ 'Console.statusForm.next' | t }}<app-req /></label>
                      <select id="to" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="to()" (change)="to.set($any($event.target).value)">
                        <option value="">{{ 'Console.statusForm.select' | t }}</option>
                        @for (m of x()!.moves; track m.to) { <option [value]="m.to">{{ 'StaffStatus.' + m.to | t }}</option> }
                      </select>
                    </div>
                    @if (to() === 'resolved') {
                      <div class="flex flex-col gap-1.5"><label for="res" class="text-sm font-semibold"><span>{{ 'Console.statusForm.resolution' | t }}<app-req /></span></label>
                        <textarea id="res" rows="3" maxlength="5000" dir="auto" class="rounded-lg border border-line p-3" [value]="resolution()" (input)="resolution.set($any($event.target).value)"></textarea></div>
                    }
                    @if (to() === 'closed') {
                      <div class="flex flex-col gap-1.5"><label for="cr" class="text-sm font-semibold">{{ 'Console.statusForm.closureReason' | t }}</label>
                        <select id="cr" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="closure()" (change)="closure.set($any($event.target).value)">
                          <option value="">{{ 'Console.statusForm.closureSelect' | t }}</option>
                          @for (c of x()!.closureReasons; track c.code) { <option [value]="c.code">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
                        </select></div>
                    }
                    @if (needsReason()) {
                      <div class="flex flex-col gap-1.5"><label for="why" class="text-sm font-semibold"><span>{{ 'Console.statusForm.reason' | t }}<app-req /></span></label>
                        <textarea id="why" rows="2" maxlength="1000" dir="auto" class="rounded-lg border border-line p-3" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea></div>
                    }
                    @if (notice() && where() === 'status') { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
                    <div><button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Console.statusForm.submit' | t }}</button> <app-req-note /></div>
                  </form>
                </section>
              }

              <app-staff-lifecycle part="dupspam" [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" />

              @if (auth.has('change_category')) {
              <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="pr">
                <h2 id="pr" class="mb-3 text-lg font-bold">{{ 'Console.priorityForm.title' | t }}</h2>
                @if (x()!.fixedPriority) { <p class="mb-3 text-sm text-muted">{{ 'Console.priorityForm.fixedNote' | t: { name: prioName(x()!.fixedPriority!) } }}</p> }
                @if (!x()!.fixedPriority || x()!.fixedPriority !== tk.priority) {
                  <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); setPriority()" novalidate>
                    <div class="flex flex-col gap-1.5"><label for="prio" class="text-sm font-semibold">{{ 'Console.priorityForm.title' | t }}</label>
                      <select id="prio" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="prioSel() || tk.priority" (change)="prioSel.set($any($event.target).value)">
                        @for (p of prioOptions(); track p.code) { <option [value]="p.code" [selected]="p.code === (prioSel() || tk.priority)">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
                      </select></div>
                    <div class="flex flex-col gap-1.5"><label for="prio-reason" class="text-sm font-semibold">{{ 'Console.priorityForm.reason' | t }}</label>
                      <input id="prio-reason" maxlength="1000" dir="auto" class="min-h-11 rounded-lg border border-line px-3 text-base" [value]="prioReason()" (input)="prioReason.set($any($event.target).value)" /></div>
                    @if (notice() && where() === 'priority') { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
                    <div><button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Console.priorityForm.submit' | t }}</button></div>
                  </form>
                }
              </section>
              }

              <app-staff-lifecycle part="category" [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" />
              <app-staff-lifecycle part="escalate" [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" />

              @if (x()!.canReassign || x()!.canClaim) {
                <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="as">
                  <h2 id="as" class="mb-3 text-lg font-bold">{{ 'Console.assignForm.title' | t }}</h2>
                  <div class="flex flex-col gap-4">
                    @if (x()!.canClaim && tk.teamId) {
                      <div><button type="button" (click)="assign(tk.teamId!, auth.me()!.id, '')" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Console.assignForm.claim' | t }}</button></div>
                    }
                    @if (x()!.canReassign) {
                      <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); assign(asTeam(), asAgent() || null, asReason())" novalidate>
                        <div class="flex flex-col gap-1.5"><label for="as-team" class="text-sm font-semibold">{{ 'Console.assignForm.team' | t }}</label>
                          <select id="as-team" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" (change)="asTeam.set($any($event.target).value); asAgent.set('')">
                            <option value="" disabled [selected]="!asTeam()"></option>
                            @for (tm of x()!.teams; track tm.id) { <option [value]="tm.id" [selected]="tm.id === asTeam()">{{ i18n.pick(tm.nameEn, tm.nameAr) }}</option> }
                          </select></div>
                        <div class="flex flex-col gap-1.5"><label for="as-agent" class="text-sm font-semibold">{{ 'Console.assignForm.agent' | t }}</label>
                          <select id="as-agent" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" (change)="asAgent.set($any($event.target).value)">
                            <option value="" [selected]="!asAgent()">{{ 'Console.assignForm.noAgent' | t }}</option>
                            @for (m of agentsOf(asTeam()); track m.userId) { <option [value]="m.userId" [selected]="m.userId === asAgent()">{{ m.fullName }}</option> }
                          </select></div>
                        <div class="flex flex-col gap-1.5"><label for="as-reason" class="text-sm font-semibold">{{ 'Console.assignForm.reason' | t }}</label>
                          <input id="as-reason" maxlength="1000" dir="auto" class="min-h-11 rounded-lg border border-line px-3 text-base" [value]="asReason()" (input)="asReason.set($any($event.target).value)" /></div>
                        @if (notice() && where() === 'assign') { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
                        <div><button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Console.assignForm.submit' | t }}</button> <app-req-note /></div>
                      </form>
                    } @else if (notice() && where() === 'assign') { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
                  </div>
                </section>
              }
            }

            <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="act">
              <h2 id="act" class="text-lg font-bold">{{ 'Console.ticket.activity' | t }}</h2>
              @if (!activity().length) { <p class="mt-3 text-muted">{{ 'Console.ticket.noActivity' | t }}</p> }
              @else {
                <ol class="mt-3 flex flex-col gap-3">
                  @for (a of activity(); track $index) {
                    <li class="text-sm">
                      <p class="font-semibold">{{ a.text }}</p>
                      <p class="text-muted"><span dir="auto">{{ a.who }}</span> · {{ i18n.date(a.at) }}</p>
                      @if (a.reason) { <p dir="auto">{{ 'Console.ticket.reason' | t }}: {{ a.reason }}</p> }
                    </li>
                  }
                </ol>
              }
            </section>
          </aside>
        </div>
      </main>
    } @else if (missing()) {
      <main class="mx-auto w-full max-w-3xl px-4 py-12"><app-alert>{{ 'Console.errors.notFound' | t }}</app-alert></main>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class ConsoleTicketPage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly api = inject(TicketsApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly sla = SLA_TONE;
  private readonly uploads = inject(Uploads);
  protected readonly files = signal<File[]>([]);
  protected readonly ticketFiles = computed(() => (this.t()?.messages ?? []).find((m) => m.kind === 'ticket_files')?.attachments ?? []);
  protected readonly x = signal<StaffExtra | null>(null);
  private readonly http = inject(HttpClient);
  protected readonly where = signal<'reply' | 'status' | 'priority' | 'assign' | ''>('');
  protected readonly prioSel = signal('');
  protected readonly prioReason = signal('');
  protected readonly asTeam = signal('');
  protected readonly asAgent = signal('');
  protected readonly asReason = signal('');
  protected readonly comments = computed(() => (this.t()?.messages ?? []).filter((m) => m.kind !== 'ticket_files' && m.kind !== 'system'));
  protected readonly needsReason = computed(() => !!this.x()?.moves.find((m) => m.to === this.to())?.requiresReason);
  protected readonly prioOptions = computed(() => { const x = this.x(), cur = this.t()?.priority; return (x?.priorities ?? []).filter((p) => !x?.fixedPriority || p.code === x.fixedPriority || p.code === cur); });
  protected prioName(code: string): string { const p = this.x()?.priorities.find((q) => q.code === code); return p ? this.i18n.pick(p.nameEn, p.nameAr) : code; }
  protected agentsOf(team: string): { userId: string; fullName: string }[] { return (this.x()?.members ?? []).filter((m) => m.teamId === team); }
  protected initials(n: string | null): string { return (n ?? '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'; }
  /** Activity: status changes and assignments, oldest first (v1). */
  protected readonly activity = computed(() => {
    const tk = this.t(), x = this.x(); if (!tk) return [];
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t(k, p);
    const sys = t('Console.ticket.system');
    return [
      ...tk.timeline.map((h) => ({ at: h.at, text: `${t('Console.ticket.status')}: ${h.from ? t('StaffStatus.' + h.from) : '-'} ${t('Console.ticket.to')} ${t('StaffStatus.' + h.to)}`, who: h.byName ?? sys, reason: h.reason })),
      ...(x?.assignments ?? []).map((a) => ({ at: a.at, text: `${t('Console.ticket.assignment')}: ${this.i18n.pick(a.teamEn, a.teamAr) || '-'} / ${a.agent ?? t('Console.unassignedLabel')}`, who: a.by ?? sys, reason: a.reason })),
    ].sort((p, q) => p.at.localeCompare(q.at));
  });
  protected readonly t = signal<TicketDetail | null>(null);
  protected readonly missing = signal(false);
  protected readonly kind = signal<'public_reply' | 'internal_note'>('public_reply');
  /** Saved replies (personal and shared) for the reply box; loaded once, ignored if not allowed. */
  protected readonly canned = signal<{ id: string; title: string; body: string; language: string }[]>([]);
  private readonly cannedApi = inject(CannedApi);
  private readonly _loadCanned = this.cannedApi.list().then((r) => this.canned.set(r.items.filter((c) => c.language === 'any' || c.language === this.i18n.locale())), () => undefined);
  protected insertCanned(sel: HTMLSelectElement): void {
    const c = this.canned().find((x) => x.id === sel.value);
    if (c) this.body.set(this.body() ? this.body().trimEnd() + '\n\n' + c.body : c.body);
    sel.value = '';
  }
  protected readonly body = signal('');
  protected readonly to = signal('');
  protected readonly reason = signal('');
  protected readonly resolution = signal('');
  protected readonly closure = signal('');
  protected readonly pending = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly noticeTone = signal<'error' | 'success'>('success');
  private readonly id = this.route.snapshot.paramMap.get('id')!;

  constructor() {
    this.load();
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  prio(c: string | null): string { return PRIORITY_TONE[c ?? 'grey'] ?? PRIORITY_TONE['grey']; }
  private readonly lcApi = inject(LifecycleApi);
  protected readonly lc = signal<TicketLifecycle | null>(null);
  protected readonly opts = signal<NewTicketOptions | null>(null);
  load(): void {
    this.api.get(this.id).then((t) => { this.t.set(t); if (!t.canReply && t.canSeeInternalNotes) this.kind.set('internal_note'); }).catch(() => this.missing.set(true));
    firstValueFrom(this.http.get<StaffExtra>(`/api/tickets/${this.id}/staff`)).then((x) => {
      this.x.set(x);
      if (!this.asTeam()) { this.asTeam.set(this.t()?.teamId ?? ''); this.asAgent.set(this.t()?.assignedAgentId ?? ''); }
    }).catch(() => undefined);
    this.lcApi.get(this.id).then((l) => this.lc.set(l)).catch(() => undefined);
    if (!this.opts()) this.api.options().then((o) => this.opts.set(o)).catch(() => undefined);
  }

  private done(key: string, where: 'reply' | 'status' | 'priority' | 'assign' = 'status'): void { this.where.set(where); this.noticeTone.set('success'); this.notice.set(this.i18n.t(key)); this.load(); }
  private fail(e: unknown): void {
    const p = problemOf(e);
    const map: Record<string, string> = { forbidden: 'notAllowed', not_found: 'notFound' };
    this.noticeTone.set('error');
    this.notice.set(p.status === 400 && /reason/.test(String((e as { error?: { title?: string } })?.error?.title)) ? this.i18n.t('Console.errors.reasonRequired')
      : this.i18n.t('Console.errors.' + (map[p.code] ?? (p.status === 403 ? 'transition' : 'generic'))));
  }

  send(): void {
    const b = this.body().trim();
    this.where.set('reply');
    if (!b) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.messageLength')); return; }
    if (checkFiles(this.files(), this.uploads.rules()).length) return;
    this.pending.set(true);
    this.api.message(this.id, this.kind(), b)
      .then(async (r) => {
        const failed = this.files().length ? await this.uploads.upload(this.id, r.id, this.files()) : [];
        this.body.set(''); this.files.set([]);
        this.done(this.kind() === 'internal_note' ? 'Console.reply.sentInternal' : 'Console.reply.sentPublic', 'reply');
        if (failed.length) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('AdminV2.filesFailed', { files: failed.join(', ') })); }
      })
      .catch((e) => this.fail(e)).finally(() => this.pending.set(false));
  }

  changeStatus(): void {
    this.where.set('status');
    if (this.needsReason() && !this.reason().trim()) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.reasonRequired')); return; }
    if (!this.to()) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.statusRequired')); return; }
    if (this.to() === 'closed' && !this.closure()) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.closureRequired')); return; }
    this.api.status(this.id, { to: this.to(), reason: this.reason() || undefined, resolution: this.resolution() || undefined, closureReason: this.closure() || undefined })
      .then(() => { this.to.set(''); this.reason.set(''); this.resolution.set(''); this.closure.set(''); this.done('Console.statusForm.done'); })
      .catch((e) => this.fail(e));
  }

  assign(teamId: string, agentId: string | null, reason: string): void {
    this.where.set('assign');
    this.api.assign(this.id, teamId, agentId, reason.trim() || undefined).then(() => { this.asReason.set(''); this.done('Console.assignForm.done', 'assign'); }).catch((e) => this.fail(e));
  }

  setPriority(): void {
    this.where.set('priority');
    const code = this.prioSel() || this.t()!.priority;
    firstValueFrom(this.http.post(`/api/tickets/${this.id}/priority`, { priority: code, reason: this.prioReason().trim() || null }))
      .then(() => { this.prioReason.set(''); this.prioSel.set(''); this.done('Console.priorityForm.done', 'priority'); }).catch((e) => this.fail(e));
  }
}
