import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth, problemOf } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { Paged, TicketDetail, TicketListItem, TicketSummary, TicketsApi } from '../../core/api';
import { Alert, PRIORITY_TONE, STATUS_STRIPE, SortTh, StatusBadge } from '../../shared/ui';
import { autoRefresh } from '../tickets/customer-pages';

const SLA_TONE: Record<string, string> = {
  on_track: 'bg-ok-soft text-ok', due_soon: 'bg-warn-soft text-warn-ink', breached: 'bg-danger-soft text-danger',
  paused: 'bg-bg text-muted border border-line', completed: 'bg-brand-soft text-brand-ink',
};

/** Support console queue: summary cards, views, filters, sortable, auto-refresh (spec 7). */
@Component({
  selector: 'app-console-queue',
  imports: [RouterLink, TPipe, StatusBadge, SortTh],
  template: `
    <main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'Console.title' | t }}</h1>
        <p class="mt-1 text-muted">{{ 'Console.subtitle' | t }}</p>
        @if (auth.me()?.viewer && !auth.me()?.staff) { <p class="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm font-medium text-warn-ink">{{ 'Console.readOnly' | t }}</p> }
      </div>

      <dl class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <button type="button" (click)="setView('assigned')" class="cursor-pointer rounded-xl border border-line border-s-4 border-s-brand bg-brand-soft p-4 text-start text-brand-ink shadow-card"><dt class="text-sm font-semibold">{{ 'Console.summary.mine' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ mineCount() }}</dd></button>
        <button type="button" (click)="setView('unassigned')" class="cursor-pointer rounded-xl border border-line border-s-4 border-s-violet-500 bg-violet-50 p-4 text-start text-violet-800 shadow-card"><dt class="text-sm font-semibold">{{ 'Console.summary.unassigned' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ summary()?.unassigned ?? 0 }}</dd></button>
        <div class="rounded-xl border border-line border-s-4 border-s-danger bg-danger-soft p-4 text-danger shadow-card"><dt class="text-sm font-semibold">{{ 'Console.summary.breached' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ summary()?.breached ?? 0 }}</dd></div>
        <button type="button" (click)="setView('closed')" class="cursor-pointer rounded-xl border border-line border-s-4 border-s-ok bg-ok-soft p-4 text-start text-ok shadow-card"><dt class="text-sm font-semibold">{{ 'Console.summary.closed' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ summary()?.closed ?? 0 }}</dd></button>
      </dl>

      <div class="flex flex-wrap items-end justify-between gap-3">
        <nav [attr.aria-label]="'Console.title' | t" class="flex flex-wrap gap-2">
          @for (v of views; track v.key) {
            <button type="button" (click)="setView(v.key)" [attr.aria-current]="v.key === view() ? 'true' : null"
              class="flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-semibold" [class]="v.key === view() ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:bg-bg'">{{ 'Console.views.' + v.label | t }}</button>
          }
        </nav>
        <form role="search" class="flex flex-wrap items-end gap-2" (submit)="$event.preventDefault(); page.set(1); load()">
          <div class="flex flex-col gap-1">
            <label for="st" class="text-sm font-semibold">{{ 'Console.filters.status' | t }}</label>
            <select id="st" class="min-h-11 rounded-lg border border-line bg-surface px-3" [value]="status()" (change)="status.set($any($event.target).value); page.set(1); load()">
              <option value="">{{ 'Console.filters.any' | t }}</option>
              @for (s of statuses; track s) { <option [value]="s">{{ 'StaffStatus.' + s | t }}</option> }
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label for="cq" class="text-sm font-semibold">{{ 'Console.filters.search' | t }}</label>
            <input id="cq" type="search" maxlength="60" dir="auto" class="min-h-11 w-64 max-w-full rounded-lg border border-line bg-surface px-3" [value]="q()" (input)="q.set($any($event.target).value)" />
          </div>
          <button type="submit" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Console.filters.searchButton' | t }}</button>
        </form>
      </div>

      <div class="relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table class="w-full min-w-[60rem] text-start text-sm">
          <caption class="sr-only">{{ 'Console.title' | t }}</caption>
          <thead class="border-b border-line bg-chrome text-white"><tr>
            <th app-sort-th [label]="'Console.columns.ticket' | t" key="ticket" [(sort)]="sort" [(desc)]="desc"></th>
            <th scope="col" class="px-4 font-semibold">{{ 'Console.columns.customer' | t }}</th>
            <th scope="col" class="px-4 font-semibold">{{ 'Console.columns.team' | t }}</th>
            <th app-sort-th [label]="'Console.columns.priority' | t" key="priority" [(sort)]="sort" [(desc)]="desc"></th>
            <th app-sort-th [label]="'Console.columns.status' | t" key="status" [(sort)]="sort" [(desc)]="desc"></th>
            <th scope="col" class="px-4 font-semibold">{{ 'Console.columns.sla' | t }}</th>
            <th app-sort-th [label]="'Console.columns.updated' | t" key="updated" [(sort)]="sort" [(desc)]="desc"></th>
          </tr></thead>
          <tbody>
            @for (r of data()?.items ?? []; track r.id) {
              <tr class="border-b border-line last:border-0 hover:bg-bg" [class]="stripe[r.status] ?? ''">
                <td class="px-4 py-3"><a [routerLink]="link('/console/tickets/' + r.id)" class="font-semibold text-brand-ink hover:underline" dir="ltr">{{ r.reference }}</a><p class="max-w-72 truncate text-ink" dir="auto">{{ r.subject }}</p></td>
                <td class="px-4 py-3" dir="auto">{{ r.requesterName }}</td>
                <td class="px-4 py-3"><p dir="auto">{{ i18n.pick(r.teamEn, r.teamAr) || ('Console.noTeam' | t) }}</p><p class="text-muted" dir="auto">{{ r.assigneeName ?? ('Console.unassignedLabel' | t) }}</p></td>
                <td class="px-4 py-3"><span class="inline-flex rounded px-2 py-0.5 text-xs font-semibold" [class]="prio(r.priorityColor)">{{ i18n.pick(r.priorityEn, r.priorityAr) || r.priority }}</span></td>
                <td class="px-4 py-3"><app-status-badge [status]="r.status" [staff]="true" /></td>
                <td class="px-4 py-3">@if (r.slaState) { <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [class]="sla[r.slaState] ?? ''">{{ 'Sla.' + r.slaState | t }}</span> }</td>
                <td class="whitespace-nowrap px-4 py-3 text-muted">{{ i18n.date(r.updatedAt) }}</td>
              </tr>
            } @empty { <tr><td colspan="7" class="p-10 text-center text-muted">{{ 'Console.empty' | t }}</td></tr> }
          </tbody>
        </table>
      </div>

      @if (pages() > 1) {
        <nav class="flex items-center justify-between gap-3" [attr.aria-label]="'Console.page' | t: { page: page(), pages: pages() }">
          <button type="button" [disabled]="page() <= 1" (click)="go(-1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:invisible">{{ 'Console.previous' | t }}</button>
          <span class="text-sm text-muted">{{ 'Console.page' | t: { page: page(), pages: pages() } }}</span>
          <button type="button" [disabled]="page() >= pages()" (click)="go(1)" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:invisible">{{ 'Console.next' | t }}</button>
        </nav>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class ConsoleQueuePage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly api = inject(TicketsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly stripe = STATUS_STRIPE;
  protected readonly sla = SLA_TONE;
  protected readonly statuses = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed', 'reopened'];
  protected readonly views = [
    { key: 'assigned', label: 'mine' }, { key: 'unassigned', label: 'unassigned' }, { key: 'all', label: 'all' }, { key: 'closed', label: 'closed' },
  ];
  private readonly qp = this.route.snapshot.queryParamMap;
  protected readonly view = signal(this.qp.get('view') ?? 'assigned');
  protected readonly status = signal(this.qp.get('status') ?? '');
  protected readonly q = signal(this.qp.get('q') ?? '');
  protected readonly page = signal(Number(this.qp.get('page') ?? 1) || 1);
  protected readonly sort = signal(this.qp.get('sort') ?? 'updated');
  protected readonly desc = signal(this.qp.get('dir') !== 'asc');
  protected readonly data = signal<Paged<TicketListItem> | null>(null);
  protected readonly summary = signal<TicketSummary | null>(null);
  protected readonly mineCount = signal(0);
  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / 25)));

  constructor() {
    effect(() => { this.sort(); this.desc(); untracked(() => this.load()); });
    autoRefresh(() => this.load());
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  prio(c: string | null): string { return PRIORITY_TONE[c ?? 'grey'] ?? PRIORITY_TONE['grey']; }
  setView(v: string): void { this.view.set(v); this.page.set(1); this.load(); }
  go(d: number): void { this.page.update((p) => p + d); this.load(); }

  load(): void {
    const view = this.view(), status = this.status(), q = this.q().trim(), page = this.page(), sort = this.sort(), desc = this.desc();
    void this.router.navigate([], { replaceUrl: true, queryParams: { view, status: status || null, q: q || null, page: page > 1 ? page : null, sort: sort !== 'updated' ? sort : null, dir: desc ? null : 'asc' } });
    void this.api.list({ view: view === 'all' ? undefined : view, status, search: q, page, pageSize: 25, sort, desc }).then((d) => this.data.set(d));
    void this.api.summary(false).then((s) => this.summary.set(s));
    void this.api.list({ view: 'assigned', pageSize: 1 }).then((d) => this.mineCount.set(d.total));
  }
}

/** Ticket workspace: reply or internal note, status change, claim (spec 7). Escalation, links and fields arrive in stage 4. */
@Component({
  selector: 'app-console-ticket',
  imports: [RouterLink, TPipe, StatusBadge, Alert],
  template: `
    @if (t(); as tk) {
      <main class="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[1fr_22rem]">
        <div class="flex min-w-0 flex-col gap-6">
          <a [routerLink]="link('/console')" class="text-sm font-semibold text-brand-ink underline">{{ 'Console.ticket.back' | t }}</a>
          <header class="flex flex-col gap-3 rounded-md border border-line bg-surface p-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="font-semibold" dir="ltr">{{ tk.reference }}</p>
              <app-status-badge [status]="tk.status" [staff]="true" />
            </div>
            <h1 class="text-2xl font-bold tracking-tight" dir="auto">{{ tk.subject }}</h1>
            <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{{ tk.description }}</p>
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
                  <p class="whitespace-pre-wrap leading-relaxed" dir="auto">{{ m.body }}</p>
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
                <label for="body" class="sr-only">{{ 'Console.reply.body' | t }}</label>
                <textarea id="body" rows="5" maxlength="10000" dir="auto" class="rounded-lg border border-line p-3" [class]="kind() === 'internal_note' ? 'bg-warn-soft' : 'bg-surface'" [value]="body()" (input)="body.set($any($event.target).value)"></textarea>
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
  protected readonly manualClosures = ['no_response', 'duplicate', 'spam', 'other'];
  protected readonly t = signal<TicketDetail | null>(null);
  protected readonly missing = signal(false);
  protected readonly kind = signal<'public_reply' | 'internal_note'>('public_reply');
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
    autoRefresh(() => this.load());
  }

  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  prio(c: string | null): string { return PRIORITY_TONE[c ?? 'grey'] ?? PRIORITY_TONE['grey']; }
  load(): void { this.api.get(this.id).then((t) => { this.t.set(t); if (!t.canReply && t.canSeeInternalNotes) this.kind.set('internal_note'); }).catch(() => this.missing.set(true)); }

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
    this.pending.set(true);
    this.api.message(this.id, this.kind(), b)
      .then(() => { this.body.set(''); this.done(this.kind() === 'internal_note' ? 'Console.reply.sentInternal' : 'Console.reply.sentPublic'); })
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
