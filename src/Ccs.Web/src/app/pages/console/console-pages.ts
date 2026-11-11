import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth, problemOf } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { Paged, SiteService, TicketDetail, TicketListItem, TicketsApi } from '../../core/api';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Alert, ClockInput, PRIORITY_STRIPE, PRIORITY_TONE, SlaChip, SortTh, StatusBadge } from '../../shared/ui';
import { AutoRefreshBar, autoRefresh } from '../tickets/customer-pages';
import { CannedApi } from '../help-pages';
import { AttachmentList, FilePicker, Uploads, checkFiles } from '../../shared/files';
import { NewTicketOptions } from '../../core/api';
import { CommentActions, LifecycleApi, StaffLifecycle, TicketLifecycle } from '../tickets/lifecycle';

const SLA_TONE: Record<string, string> = {
  on_track: 'bg-ok-soft text-ok', due_soon: 'bg-warn-soft text-warn-ink', breached: 'bg-danger-soft text-danger',
  paused: 'bg-bg text-muted border border-line', completed: 'bg-brand-soft text-brand-ink',
};

/** Support console queue: same counters, team SLA strip, views, filters and columns as the current console. */
@Component({
  selector: 'app-console-queue',
  imports: [RouterLink, TPipe, StatusBadge, SortTh, SlaChip],
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

      <dl class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div [class]="stat + ' border-s-4 border-s-brand bg-brand-soft'"><dt class="text-sm font-semibold text-brand-ink">{{ 'Console.summary.mine' | t }}</dt><dd class="text-3xl font-bold text-brand-ink">{{ counts()?.mine ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-violet-500 bg-violet-50'"><dt class="text-sm font-semibold text-violet-800">{{ 'Console.summary.unassigned' | t }}</dt><dd class="text-3xl font-bold text-violet-800">{{ counts()?.unassigned ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-danger bg-danger-soft'"><dt class="text-sm font-semibold text-danger">{{ 'Console.summary.breached' | t }}</dt><dd class="text-3xl font-bold text-danger">{{ counts()?.breached ?? 0 }}</dd></div>
        <div [class]="stat + ' border-s-4 border-s-amber-500 bg-warn-soft'"><dt class="text-sm font-semibold text-warn-ink">{{ 'Console.summary.dueSoon' | t }}</dt><dd class="text-3xl font-bold text-warn-ink">{{ counts()?.dueSoon ?? 0 }}</dd></div>
        <button type="button" (click)="showClosed()" [attr.aria-current]="status() === 'closed' ? 'true' : null" [class]="stat + ' cursor-pointer border-s-4 border-s-ok bg-ok-soft text-start hover:brightness-95' + (status() === 'closed' ? ' ring-2 ring-ok' : '')"><dt class="text-sm font-semibold text-ok">{{ 'Console.summary.closed' | t }}</dt><dd class="text-3xl font-bold text-ok">{{ counts()?.closed ?? 0 }}</dd></button>
      </dl>

      @if (counts()?.strip; as st) {
        <section [attr.aria-label]="'SlaClock.strip_title' | t" class="flex flex-col gap-2">
          <dl class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div [class]="stat"><dt class="text-sm font-semibold text-muted">{{ 'SlaClock.strip_title' | t }}: {{ 'SlaClock.strip_onTrack' | t }}</dt><dd class="text-3xl font-bold text-brand-ink">{{ st.green }}</dd></div>
            <div [class]="stat"><dt class="text-sm font-semibold text-muted">{{ 'SlaClock.strip_title' | t }}: {{ 'SlaClock.strip_close' | t }}</dt><dd class="text-3xl font-bold text-warn-ink">{{ st.yellow }}</dd></div>
            <button type="button" (click)="setSla('due_soon')" [class]="stat + ' cursor-pointer text-start hover:bg-bg'"><dt class="text-sm font-semibold text-muted">{{ 'SlaClock.strip_title' | t }}: {{ 'SlaClock.strip_red' | t }}</dt><dd class="text-3xl font-bold text-danger">{{ st.red }}</dd></button>
            <button type="button" (click)="setSla('breached')" class="cursor-pointer rounded-md border border-danger bg-danger-soft p-4 text-start hover:brightness-95"><dt class="text-sm font-semibold text-danger">{{ 'SlaClock.strip_title' | t }}: {{ 'SlaClock.strip_overdue' | t }}</dt><dd class="text-3xl font-bold text-danger">{{ st.overdue }}</dd></button>
          </dl>
          <p class="text-xs text-muted">{{ 'SlaClock.strip_hint' | t }}</p>
        </section>
      }

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
                  <td class="px-4 py-3"><span class="inline-flex rounded px-2 py-0.5 text-xs font-semibold" [class]="prio(r.priorityColor)">{{ i18n.pick(r.priorityEn, r.priorityAr) || r.priority }}</span></td>
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
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / 25)));

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
  setSla(s: string): void { this.slaF.set(s); this.page.set(1); this.load(); }
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
      view: view !== this.defaultView ? view : null, status: status !== 'active' ? status : null, priority: priority || null, sla: sla || null, team: team || null,
      q: q || null, page: page > 1 ? page : null, sort: sort !== 'updated' ? sort : null, dir: desc ? null : 'asc' } });
    const apiView = view === 'mine' ? 'assigned' : view === 'all' ? undefined : view;
    const st = status === 'active' ? { group: 'open' } : status === 'any' ? {} : { status };
    void this.api.list({ view: apiView, ...st, priority: priority || undefined, sla: sla || undefined, teamId: team || undefined, search: q, page, pageSize: 25, sort, desc }).then((d) => this.data.set(d));
    void firstValueFrom(this.http.get<NonNullable<ReturnType<typeof this.counts>>>('/api/console/counts')).then((c) => this.counts.set(c));
  }
}

/** Ticket workspace: reply or internal note, status change, claim (spec 7). Escalation, links and fields arrive in stage 4. */
@Component({
  selector: 'app-console-ticket',
  imports: [RouterLink, TPipe, StatusBadge, Alert, AttachmentList, FilePicker, StaffLifecycle, CommentActions, AutoRefreshBar],
  template: `
    @if (t(); as tk) {
      <main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]">
        <div class="flex min-w-0 flex-col gap-6">
          <app-auto-refresh (tick)="load()" />
          <a [routerLink]="link('/console')" class="text-sm font-semibold text-brand-ink underline">{{ 'Console.ticket.back' | t }}</a>
          <header class="flex flex-col gap-3 rounded-md border border-line bg-surface p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="font-semibold" dir="ltr">{{ tk.reference }}</p>
              <app-status-badge [status]="tk.status" [staff]="true" />
            </div>
            <h1 class="text-2xl font-bold tracking-tight" dir="auto">{{ tk.subject }}</h1>
            <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.description }}</p>
            <app-attachments [ticketId]="tk.id" [items]="ticketFiles()" />
          </header>

          <section class="flex flex-col gap-3" aria-labelledby="conv">
            <h2 id="conv" class="text-lg font-bold">{{ 'Console.ticket.conversation' | t }}</h2>
            @for (m of tk.messages; track m.id) {
              @if (m.kind !== 'ticket_files') {
                <article class="rounded-md border p-4" [class]="m.kind === 'internal_note' ? 'border-warn-ink/30 bg-warn-soft' : m.authorIsStaff ? 'border-brand/30 bg-brand-soft/50' : 'border-line bg-surface'">
                  <header class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span class="font-semibold" dir="auto">{{ m.authorName ?? ('Console.ticket.system' | t) }}
                      <span class="ms-2 rounded bg-surface/70 px-1.5 py-0.5 text-xs font-semibold text-muted">{{ (m.kind === 'internal_note' ? 'Console.ticket.internalNote' : m.authorIsStaff ? 'Console.ticket.staffLabel' : 'Console.ticket.customerLabel') | t }}</span></span>
                    <span class="text-muted">{{ i18n.date(m.createdAt) }}</span>
                  </header>
                  <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{{ m.body }}@if (m.editedAt) { <span class="ms-1 text-xs text-muted">({{ 'Comments.edited' | t }})</span> }</p>
                  <app-attachments [ticketId]="tk.id" [items]="m.attachments" />
                  <app-comment-actions [ticketId]="tk.id" [message]="m" [me]="auth.me()?.id ?? null" (changed)="load()" />
                </article>
              }
            } @empty { <p class="text-muted">{{ 'Console.ticket.noComments' | t }}</p> }
          </section>

          @if (tk.canReply || tk.canSeeInternalNotes) {
            <section class="rounded-md border border-line bg-surface p-6">
              <h2 class="mb-3 text-lg font-bold">{{ 'Console.reply.title' | t }}</h2>
              <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); send()">
                <fieldset class="flex flex-wrap gap-4 text-sm">
                  <legend class="mb-1 font-semibold">{{ 'Console.reply.kind' | t }}</legend>
                  @if (tk.canReply) { <label class="flex items-center gap-2"><input type="radio" name="kind" value="public_reply" [checked]="kind() === 'public_reply'" (change)="kind.set('public_reply')" />{{ 'Console.reply.public' | t }}</label> }
                  @if (tk.canSeeInternalNotes) { <label class="flex items-center gap-2"><input type="radio" name="kind" value="internal_note" [checked]="kind() === 'internal_note'" (change)="kind.set('internal_note')" />{{ 'Console.reply.internal' | t }}</label> }
                </fieldset>
                @if (canned().length) {
                  <label for="canned" class="sr-only">{{ 'Shell.cannedResponses' | t }}</label>
                  <select id="canned" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" (change)="insertCanned($any($event.target))">
                    <option value="">{{ 'AdminV2.insertReply' | t }}</option>
                    @for (c of canned(); track c.id) { <option [value]="c.id">{{ c.title }}</option> }
                  </select>
                }
                <label for="body" class="sr-only">{{ 'Console.reply.body' | t }}</label>
                <textarea id="body" rows="5" maxlength="10000" dir="auto" class="rounded-lg border border-line p-3" [class]="kind() === 'internal_note' ? 'bg-warn-soft' : 'bg-surface'" [value]="body()" (input)="body.set($any($event.target).value)"></textarea>
                <app-file-picker [label]="'Console.ticket.attachments' | t" [(files)]="files" [disabled]="pending()" />
                <div><button type="submit" [disabled]="pending()" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:opacity-60">{{ 'Console.reply.submit' | t }}</button></div>
              </form>
            </section>
          }
        </div>

        <aside class="flex flex-col gap-4">
          @if (notice()) { <app-alert [tone]="noticeTone()">{{ notice() }}</app-alert> }
          <section class="rounded-md border border-line bg-surface p-5 text-sm">
            <dl class="flex flex-col gap-2">
              <div><dt class="text-muted">{{ 'Console.ticket.customer' | t }}</dt><dd class="font-semibold" dir="auto">{{ tk.requesterName }}</dd><dd class="text-muted" dir="ltr">{{ tk.requesterEmail }}</dd></div>
              <div><dt class="text-muted">{{ 'Console.ticket.category' | t }}</dt><dd class="font-semibold">{{ i18n.pick(tk.names.categoryEn, tk.names.categoryAr) }}</dd></div>
              <div><dt class="text-muted">{{ 'Console.ticket.team' | t }}</dt><dd class="font-semibold">{{ i18n.pick(tk.names.teamEn, tk.names.teamAr) || ('Console.noTeam' | t) }}</dd></div>
              <div><dt class="text-muted">{{ 'Console.ticket.agent' | t }}</dt><dd class="font-semibold">{{ tk.names.assignee ?? ('Console.unassignedLabel' | t) }}</dd></div>
              <div><dt class="text-muted">{{ 'Console.columns.priority' | t }}</dt><dd><span class="inline-flex rounded px-2 py-0.5 text-xs font-semibold" [class]="prio(tk.names.priorityColor)">{{ i18n.pick(tk.names.priorityEn, tk.names.priorityAr) }}</span></dd></div>
              @if (tk.slaState) {
                <div><dt class="text-muted">{{ 'Console.ticket.sla' | t }}</dt><dd><span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [class]="sla[tk.slaState] ?? ''">{{ 'Sla.' + tk.slaState | t }}</span></dd>
                  <dd class="text-muted">{{ 'Console.ticket.firstResponse' | t }}: {{ i18n.date(tk.firstResponseDue) }}</dd>
                  <dd class="text-muted">{{ 'Console.ticket.resolution' | t }}: {{ i18n.date(tk.resolutionDue) }}</dd></div>
              }
            </dl>
            @if (!tk.assignedAgentId && tk.teamId && auth.has('assign_self')) {
              <button type="button" (click)="claim(tk.teamId!)" class="mt-4 min-h-11 w-full cursor-pointer rounded-lg border border-brand px-4 font-semibold text-brand-ink hover:bg-brand-soft">{{ 'Console.assignForm.claim' | t }}</button>
            }
          </section>

          @if (tk.allowedMoves.length) {
            <section class="rounded-md border border-line bg-surface p-5">
              <h2 class="mb-3 font-bold">{{ 'Console.statusForm.title' | t }}</h2>
              <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); changeStatus()">
                <label for="to" class="text-sm font-semibold">{{ 'Console.statusForm.next' | t }}</label>
                <select id="to" class="min-h-11 rounded-lg border border-line bg-surface px-3" [value]="to()" (change)="to.set($any($event.target).value)">
                  <option value="">{{ 'Console.statusForm.select' | t }}</option>
                  @for (m of tk.allowedMoves; track m) { <option [value]="m">{{ 'StaffStatus.' + m | t }}</option> }
                </select>
                @if (to() === 'resolved') {
                  <label for="res" class="text-sm font-semibold">{{ 'Console.statusForm.resolution' | t }}</label>
                  <textarea id="res" rows="3" dir="auto" class="rounded-lg border border-line p-3" [value]="resolution()" (input)="resolution.set($any($event.target).value)"></textarea>
                }
                @if (to() === 'closed') {
                  <label for="cr" class="text-sm font-semibold">{{ 'Console.statusForm.closureReason' | t }}</label>
                  <select id="cr" class="min-h-11 rounded-lg border border-line bg-surface px-3" [value]="closure()" (change)="closure.set($any($event.target).value)">
                    <option value="">{{ 'Console.statusForm.closureSelect' | t }}</option>
                    @for (c of manualClosures; track c) { <option [value]="c">{{ 'V2.closure.' + c | t }}</option> }
                  </select>
                }
                <label for="why" class="text-sm font-semibold">{{ 'Console.statusForm.reason' | t }}</label>
                <input id="why" dir="auto" class="min-h-11 rounded-lg border border-line px-3" [value]="reason()" (input)="reason.set($any($event.target).value)" />
                <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Console.statusForm.submit' | t }}</button>
              </form>
            </section>
          }
          <app-staff-lifecycle [ticket]="tk" [lc]="lc()" [opts]="opts()" (changed)="load()" />
        </aside>
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
  protected readonly manualClosures = ['no_response', 'duplicate', 'spam', 'other'];
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
    this.lcApi.get(this.id).then((l) => this.lc.set(l)).catch(() => undefined);
    if (!this.opts()) this.api.options().then((o) => this.opts.set(o)).catch(() => undefined);
  }

  private done(key: string): void { this.noticeTone.set('success'); this.notice.set(this.i18n.t(key)); this.load(); }
  private fail(e: unknown): void {
    const p = problemOf(e);
    const map: Record<string, string> = { forbidden: 'notAllowed', not_found: 'notFound' };
    this.noticeTone.set('error');
    this.notice.set(p.status === 400 && /reason/.test(String((e as { error?: { title?: string } })?.error?.title)) ? this.i18n.t('Console.errors.reasonRequired')
      : this.i18n.t('Console.errors.' + (map[p.code] ?? (p.status === 403 ? 'transition' : 'generic'))));
  }

  send(): void {
    const b = this.body().trim();
    if (!b) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.messageLength')); return; }
    if (checkFiles(this.files(), this.uploads.rules()).length) return;
    this.pending.set(true);
    this.api.message(this.id, this.kind(), b)
      .then(async (r) => {
        const failed = this.files().length ? await this.uploads.upload(this.id, r.id, this.files()) : [];
        this.body.set(''); this.files.set([]);
        this.done(this.kind() === 'internal_note' ? 'Console.reply.sentInternal' : 'Console.reply.sentPublic');
        if (failed.length) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('AdminV2.filesFailed', { files: failed.join(', ') })); }
      })
      .catch((e) => this.fail(e)).finally(() => this.pending.set(false));
  }

  changeStatus(): void {
    if (!this.to()) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.statusRequired')); return; }
    if (this.to() === 'closed' && !this.closure()) { this.noticeTone.set('error'); this.notice.set(this.i18n.t('Console.errors.closureRequired')); return; }
    this.api.status(this.id, { to: this.to(), reason: this.reason() || undefined, resolution: this.resolution() || undefined, closureReason: this.closure() || undefined })
      .then(() => { this.to.set(''); this.reason.set(''); this.resolution.set(''); this.closure.set(''); this.done('Console.statusForm.done'); })
      .catch((e) => this.fail(e));
  }

  claim(teamId: string): void {
    this.api.assign(this.id, teamId, this.auth.me()!.id).then(() => this.done('Console.assignForm.done')).catch((e) => this.fail(e));
  }
}
