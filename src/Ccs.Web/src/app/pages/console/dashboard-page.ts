import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18n, TPipe } from '../../core/i18n';
import { PRIORITY_TONE, PrioIcon, StatusBadge } from '../../shared/ui';
import { BarList, Donut, GroupedColumns, Ring, StackedBars, TrendChart } from '../../shared/charts';

interface Named { nameEn: string; nameAr: string }
interface Dash {
  kpi: { total: number; fresh: number; working: number; done: number; overdue: number; orgs: number; branches: number };
  created: number; resolved: number; daily: { day: string; created: number; resolved: number }[];
  slaMet: number; slaTotal: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null;
  byStatus: Record<string, number>; byPriority: (Named & { code: string; color: string; icon?: string; n: number })[]; byCategory: (Named & { n: number })[];
  byOrg: { name: string; total: number; resolved: number }[]; byBranch: { name: string; org: string; total: number; resolved: number }[];
  workload: { name: string; n: number }[];
  satisfaction: { count: number; average: number | null; dist: number[]; resolvedTotal: number };
  recent: { id: string; reference: string; subject: string; priority: string; status: string; updatedAt: string; customer: string }[];
  queue: { mine: number; unassigned: number; breached: number };
}

const KPI_ICON: Record<string, { path: string; tone: string }> = {
  total: { path: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z', tone: 'bg-brand-soft text-brand' },
  fresh: { path: 'M4 4h16v16H4zM4 7l8 6 8-6', tone: 'bg-danger-soft text-danger' },
  working: { path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', tone: 'bg-warn-soft text-warn-ink' },
  done: { path: 'M20 6 9 17l-5-5', tone: 'bg-ok-soft text-ok' },
  overdue: { path: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', tone: 'bg-warn-soft text-warn-ink' },
  orgs: { path: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6', tone: 'bg-brand-soft text-brand' },
  branches: { path: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', tone: 'bg-ok-soft text-ok' },
};
const STATUSES = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed', 'reopened'];

/** Staff dashboard: same layout and figures as the current /console/dashboard (last 30 days). */
@Component({
  selector: 'app-dashboard',
  imports: [TPipe, RouterLink, StatusBadge, TrendChart, Ring, BarList, Donut, GroupedColumns, StackedBars, PrioIcon],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Dashboard.title' | t }}</h1><p class="mt-1 text-muted">{{ 'Dashboard.subtitle' | t }}</p></div>
        <p class="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold">{{ 'Dashboard.last30' | t }}</p>
      </header>

      @if (d(); as x) {
        <dl class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          @for (k of ['total', 'fresh', 'working', 'done', 'overdue']; track k) {
            <div [class]="card + ' flex flex-col items-center gap-2 text-center'">
              <span aria-hidden="true" class="flex h-12 w-12 items-center justify-center rounded-full" [class]="icon[k].tone">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon[k].path" /></svg></span>
              <dd class="text-4xl font-bold leading-none">{{ $any(x.kpi)[k] }}</dd>
              <dt class="text-sm font-medium text-muted">{{ 'Dashboard.kpi.' + k | t }}</dt>
            </div>
          }
        </dl>
        <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          @for (k of ['orgs', 'branches']; track k) {
            <div [class]="card + ' flex items-center justify-center gap-5'">
              <span aria-hidden="true" class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" [class]="icon[k].tone">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon[k].path" /></svg></span>
              <div><dd class="text-4xl font-bold leading-none">{{ $any(x.kpi)[k] }}</dd><dt class="mt-1 text-sm font-medium text-muted">{{ 'Dashboard.kpi.' + k | t }}</dt></div>
            </div>
          }
        </dl>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section [class]="card + ' lg:col-span-2'"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.trends' | t }}</h2>
            <app-trend-chart [data]="x.daily" [dayLabel]="'Dashboard.day' | t" [createdLabel]="'Dashboard.created' | t" [resolvedLabel]="'Dashboard.resolved' | t" [summary]="'Dashboard.trendSummary' | t: { created: x.created, resolved: x.resolved }" /></section>
          <section [class]="card"><h2 class="mb-2 text-lg font-bold">{{ 'Dashboard.slaCompliance' | t }}</h2>
            <app-ring [percent]="compliance()" [label]="compliance() === null ? ('Dashboard.slaNone' | t) : ('Dashboard.slaRing' | t: { percent: compliance() })" />
            <p class="mt-2 text-center text-sm text-muted">{{ compliance() === null ? ('Dashboard.slaNone' | t) : ('Dashboard.slaCount' | t: { met: x.slaMet, total: x.slaTotal }) }}</p>
            <p class="mt-1 text-center text-xs text-muted">{{ 'Dashboard.slaNote' | t }}</p></section>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section [class]="card + ' lg:col-span-2'"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.ticketsPerOrg' | t }}</h2>
            @if (x.byOrg.length) { <app-grouped-columns [rows]="orgTop()" [label]="'Dashboard.ticketsPerOrg' | t" [totalLabel]="'Dashboard.totalTickets' | t" [resolvedLabel]="'Dashboard.resolved' | t" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }
            @if (x.byOrg.length > 8) { <p class="mt-2 text-sm text-muted">{{ 'Dashboard.topOf' | t: { shown: 8, total: x.byOrg.length } }}</p> }</section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.orgShare' | t }}</h2>
            @if (orgSlices().length) { <app-donut [slices]="donutOrgs()" [label]="'Dashboard.orgShare' | t" [centre]="'' + orgSum()" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.ticketsPerBranch' | t }}</h2>
            @if (x.byBranch.length) { <div class="max-h-[26rem] overflow-y-auto pe-2"><app-stacked-bars [rows]="branchRows()" [label]="'Dashboard.ticketsPerBranch' | t" [resolvedLabel]="'Dashboard.resolved' | t" [openLabel]="'Dashboard.stillOpen' | t" /></div> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
          <section [class]="card + ' flex flex-col'"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.resolutionRate' | t }}</h2>
            @if (orgSlices().length) {
              <div class="flex max-h-[26rem] flex-1 flex-col overflow-y-auto">
                <ul class="my-auto grid w-full gap-5" style="grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr))">
                  @for (o of orgSlices(); track o.name) {
                    <li class="flex flex-col items-center gap-1 text-center">
                      <app-ring [percent]="pct(o.resolved, o.total)" [label]="o.name + ': ' + (pct(o.resolved, o.total) ?? 0) + '%'" size="h-28 w-28" />
                      <span class="max-w-full text-sm font-semibold [overflow-wrap:anywhere]" dir="auto">{{ o.name }}</span>
                      <span class="text-xs text-muted">{{ o.resolved }}/{{ o.total }}</span>
                    </li>
                  }
                </ul>
              </div>
            } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.byStatus' | t }}</h2>
            @if (statusSlices().length) { <app-donut [slices]="statusSlices()" [label]="'Reports.byStatus' | t" [centre]="'' + statusSum()" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.byPriority' | t }}</h2>
            @if (x.byPriority.length) { <app-bar-list [rows]="named(x.byPriority)" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.byCategory' | t }}</h2>
            @if (x.byCategory.length) { <app-bar-list [rows]="named(x.byCategory)" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.workload' | t }}</h2>
            @if (x.workload.length) { <app-bar-list [rows]="workload()" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.avgFirst' | t }}</h2>
            <p class="text-4xl font-bold">{{ human(x.avgFirstResponseMinutes) }}</p>
            <p class="mt-2 text-sm text-muted">{{ 'Dashboard.avgResolution' | t }}: <b class="text-ink">{{ human(x.avgResolutionMinutes) }}</b></p></section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.csat' | t }}</h2>
            @if (!x.satisfaction.count) { <p class="text-muted">{{ 'Reports.csatNone' | t }}</p> } @else {
              <p class="text-4xl font-bold">{{ x.satisfaction.average }} <span class="text-lg font-medium text-muted">/ 5</span></p>
              <p class="mb-3 mt-1 text-sm text-muted">{{ 'Reports.csatCountLine' | t: { count: x.satisfaction.count, resolved: x.satisfaction.resolvedTotal } }}</p>
              <app-bar-list [rows]="stars()" />
            }</section>
        </div>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section [class]="card + ' lg:col-span-2'">
            <div class="mb-3 flex items-center justify-between gap-3"><h2 class="text-lg font-bold">{{ 'Dashboard.recent' | t }}</h2>
              <a [routerLink]="link('/console')" class="text-sm font-semibold text-brand-ink hover:underline">{{ 'Dashboard.viewAll' | t }}</a></div>
            @if (!x.recent.length) { <p class="text-muted">{{ 'Dashboard.noTickets' | t }}</p> } @else {
              <div class="relative overflow-x-auto"><table class="w-full min-w-[34rem] text-start text-sm">
                <caption class="sr-only">{{ 'Dashboard.recent' | t }}</caption>
                <thead><tr class="border-b border-line text-muted">@for (c of ['ticket', 'customer', 'priority', 'status', 'updated']; track c) { <th scope="col" class="py-2 pe-3 text-start font-semibold">{{ 'Dashboard.col.' + c | t }}</th> }</tr></thead>
                <tbody>
                  @for (r of x.recent; track r.id) {
                    <tr class="border-b border-line last:border-0">
                      <td class="py-3 pe-3"><a [routerLink]="link('/console/tickets/' + r.id)" class="font-semibold text-brand-ink hover:underline" dir="ltr">{{ r.reference }}</a><p class="max-w-56 truncate text-muted" dir="auto">{{ r.subject }}</p></td>
                      <td class="py-3 pe-3" dir="auto">{{ r.customer }}</td>
                      <td class="py-3 pe-3"><span [class]="'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ' + prioTone(r.priority)"><app-prio-icon [name]="prioIcon(r.priority)" [size]="12" />{{ prioName(r.priority) }}</span></td>
                      <td class="py-3 pe-3"><app-status-badge [status]="r.status" [staff]="true" /></td>
                      <td class="py-3 text-muted">{{ ago(r.updatedAt) }}</td>
                    </tr>
                  }
                </tbody></table></div>
            }
          </section>
          <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ 'Dashboard.quick' | t }}</h2>
            <ul class="flex flex-col gap-2">
              <li><a [routerLink]="link('/console')" [queryParams]="{ view: 'unassigned' }" [class]="action + ' bg-brand text-white hover:bg-brand-ink'">{{ 'Dashboard.qaUnassigned' | t }}<span class="rounded-full bg-white/20 px-2 text-xs">{{ x.queue.unassigned }}</span></a></li>
              <li><a [routerLink]="link('/console')" [queryParams]="{ view: 'assigned' }" [class]="action">{{ 'Dashboard.qaMine' | t }}<span class="rounded-full bg-bg px-2 text-xs">{{ x.queue.mine }}</span></a></li>
              <li><a [routerLink]="link('/console')" [queryParams]="{ view: 'all', sla: 'breached', status: 'any' }" [class]="action">{{ 'Dashboard.qaBreached' | t }}<span class="rounded-full bg-bg px-2 text-xs">{{ x.queue.breached }}</span></a></li>
              <li><a [routerLink]="link('/console/reports')" [class]="action">{{ 'Reports.title' | t }}</a></li>
            </ul></section>
        </div>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class DashboardPage {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly icon = KPI_ICON;
  protected readonly card = 'rounded-xl border border-line bg-surface p-5 shadow-card';
  protected readonly action = 'flex min-h-11 items-center justify-between gap-2 rounded-lg border border-line px-4 text-sm font-semibold hover:bg-bg';
  protected readonly d = signal<Dash | null>(null);
  protected readonly compliance = computed(() => { const x = this.d(); return x ? this.pct(x.slaMet, x.slaTotal) : null; });
  protected readonly orgTop = computed(() => (this.d()?.byOrg ?? []).slice(0, 8).map((o) => ({ label: o.name, total: o.total, resolved: o.resolved })));
  protected readonly orgSlices = computed(() => (this.d()?.byOrg ?? []).filter((o) => o.total > 0));
  protected readonly orgSum = computed(() => (this.d()?.byOrg ?? []).reduce((a, o) => a + o.total, 0));
  protected readonly donutOrgs = computed(() => {
    const s = this.orgSlices();
    const top = s.length > 6 ? [...s.slice(0, 6), { name: this.i18n.t('Dashboard.other'), total: s.slice(6).reduce((a, o) => a + o.total, 0), resolved: 0 }] : s;
    return top.map((o) => ({ label: o.name, value: o.total }));
  });
  protected readonly branchRows = computed(() => (this.d()?.byBranch ?? []).map((b) => ({ label: b.name, sub: b.org, total: b.total, resolved: b.resolved })));
  protected readonly statusSlices = computed(() => STATUSES.map((s) => ({ label: this.i18n.t('StaffStatus.' + s), value: this.d()?.byStatus[s] ?? 0 })).filter((x) => x.value > 0));
  protected readonly statusSum = computed(() => this.statusSlices().reduce((a, x) => a + x.value, 0));
  protected readonly workload = computed(() => (this.d()?.workload ?? []).map((w) => ({ label: w.name, value: w.n })));
  protected readonly stars = computed(() => (this.d()?.satisfaction.dist ?? []).map((n, i) => ({ label: this.i18n.t('Reports.csatStars', { count: i + 1 }), value: n })).reverse().filter((x) => x.value > 0));

  constructor() { void firstValueFrom(this.http.get<Dash>('/api/console/dashboard')).then((x) => this.d.set(x)); }

  protected link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  protected pct(a: number, b: number): number | null { return b ? Math.round((a / b) * 100) : null; }
  protected named(rows: (Named & { n: number })[]) { return rows.map((r) => ({ label: this.i18n.pick(r.nameEn, r.nameAr), value: r.n })); }
  protected prioIcon(code: string): string { return this.d()?.byPriority.find((x) => x.code === code)?.icon ?? 'minus'; }
  protected prioName(code: string): string { const p = this.d()?.byPriority.find((x) => x.code === code); return p ? this.i18n.pick(p.nameEn, p.nameAr) : code; }
  protected prioTone(code: string): string { const p = this.d()?.byPriority.find((x) => x.code === code); return PRIORITY_TONE[p?.color ?? 'grey'] ?? PRIORITY_TONE['grey']; }
  protected human(min: number | null): string {
    if (min === null) return '-';
    const u = { d: this.i18n.t('Reports.unitD'), h: this.i18n.t('Reports.unitH'), m: this.i18n.t('Reports.unitM') };
    const total = Math.round(min);
    if (total < 60) return `${total} ${u.m}`;
    if (total < 1440) { const h = Math.floor(total / 60), m = total % 60; return m ? `${h} ${u.h} ${m} ${u.m}` : `${h} ${u.h}`; }
    const dd = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60);
    return h ? `${dd} ${u.d} ${h} ${u.h}` : `${dd} ${u.d}`;
  }
  protected ago(iso: string): string {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(this.i18n.locale(), { numeric: 'auto' });
    const a = Math.abs(s);
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
}
