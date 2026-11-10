import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { BarList, Ring, TrendChart } from '../../shared/charts';
import { Alert } from '../../shared/ui';

const CARD = 'rounded-xl border border-line bg-surface p-5 shadow-card';
const STATUSES = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'closed', 'reopened'];

interface Metrics { total: number; resolved: number; open: number; avgFirst: number | null; avgRes: number | null; slaMet: number; slaTotal: number; avgRating: number | null; ratings: number }
interface Named { nameEn: string | null; nameAr: string | null; n: number }
interface Summary {
  days: number; all: boolean; created: number; resolved: number; avgFirstResponseMinutes: number | null; avgResolutionMinutes: number | null;
  slaMet: number; slaTotal: number; daily: { day: string; created: number; resolved: number }[];
  byStatus: Record<string, number>; byPriority: Record<string, number>; byCategory: Named[]; byTeam: Named[];
  agentPerf: { name: string; m: Metrics }[]; teamPerf: { nameEn: string; nameAr: string; m: Metrics }[];
  satisfaction: { count: number; average: number | null; dist: number[]; resolvedTotal: number };
}
type BRow = Metrics & { key: string; labelEn: string | null; labelAr: string | null; sub: string | null };

/** Minutes as "2 d 4 h" (same rule as today). */
export function human(i18n: I18n, min: number | null): string {
  if (min === null || min === undefined) return '-';
  const u = { d: i18n.t('Reports.unitD'), h: i18n.t('Reports.unitH'), m: i18n.t('Reports.unitM') };
  const total = Math.round(min);
  if (total < 60) return `${total} ${u.m}`;
  if (total < 1440) { const h = Math.floor(total / 60), m = total % 60; return m ? `${h} ${u.h} ${m} ${u.m}` : `${h} ${u.h}`; }
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60);
  return h ? `${d} ${u.d} ${h} ${u.h}` : `${d} ${u.d}`;
}
const pct = (a: number, b: number): number | null => (b ? Math.round((a / b) * 100) : null);
const cairoDay = (offset = 0) => { const d = new Date(Date.now() + offset * 86400000); return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); };

/** Downloads an API file with the sign-in token (a plain link would not carry it). */
async function download(http: HttpClient, url: string): Promise<void> {
  const res = await firstValueFrom(http.get(url, { observe: 'response', responseType: 'blob' }));
  const name = /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'report.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.body!); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ================================================================== reports

@Component({
  selector: 'app-reports',
  imports: [TPipe, FormsModule, TrendChart, Ring, BarList],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      @if (s(); as r) {
        @if (!r.all) { <header><h1 class="text-3xl font-bold tracking-tight">{{ 'Reports.title' | t }}</h1><p class="mt-1 text-muted">{{ 'Reports.ownOnly' | t }}</p></header> }
        @else {
          <header class="flex flex-wrap items-end justify-between gap-3">
            <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Reports.title' | t }}</h1><p class="mt-1 text-muted">{{ 'Reports.subtitle' | t }}</p></div>
            <nav [attr.aria-label]="'Reports.range' | t" class="flex gap-2">
              @for (d of [7, 30, 90]; track d) {
                <button type="button" (click)="setDays(d)" [attr.aria-current]="d === days() ? 'true' : null" class="flex min-h-10 cursor-pointer items-center rounded-lg border px-4 text-sm font-semibold" [class]="d === days() ? 'border-brand bg-brand text-white' : 'border-line bg-surface hover:bg-bg'">{{ 'Reports.lastDays' | t: { count: d } }}</button>
              }
            </nav>
            @if (canExport()) { <button type="button" [class]="btn2" (click)="exportCsv('summary')">{{ 'Reports.exportCsv' | t }}</button> }
          </header>
          <dl class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div [class]="card"><dt class="text-sm text-muted">{{ 'Reports.created' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ r.created }}</dd></div>
            <div [class]="card"><dt class="text-sm text-muted">{{ 'Reports.resolved' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ r.resolved }}</dd></div>
            <div [class]="card"><dt class="text-sm text-muted">{{ 'Reports.avgFirst' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ h(r.avgFirstResponseMinutes) }}</dd></div>
            <div [class]="card"><dt class="text-sm text-muted">{{ 'Reports.avgResolution' | t }}</dt><dd class="mt-1 text-3xl font-bold">{{ h(r.avgResolutionMinutes) }}</dd></div>
          </dl>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section [class]="card + ' lg:col-span-2'"><h2 class="mb-3 text-lg font-bold">{{ 'Reports.trend' | t }}</h2>
              <app-trend-chart [data]="r.daily" [createdLabel]="'Reports.created' | t" [resolvedLabel]="'Reports.resolved' | t" [summary]="'Reports.trendSummary' | t: { created: r.created, resolved: r.resolved }" /></section>
            <section [class]="card"><h2 class="mb-2 text-lg font-bold">{{ 'Reports.sla' | t }}</h2>
              <app-ring [percent]="pc(r.slaMet, r.slaTotal)" [label]="'Reports.sla' | t" />
              <p class="mt-2 text-center text-sm text-muted">{{ pc(r.slaMet, r.slaTotal) === null ? ('Reports.slaNone' | t) : ('Reports.slaCount' | t: { met: r.slaMet, total: r.slaTotal }) }}</p></section>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            @for (b of breakdowns(); track b.title) {
              <section [class]="card"><h2 class="mb-3 text-lg font-bold">{{ b.title | t }}</h2>@if (b.rows.length) { <app-bar-list [rows]="b.rows" /> } @else { <p class="text-muted">{{ 'Reports.noData' | t }}</p> }</section>
            }
          </div>
        }

        <section id="report-builder" [class]="card + ' flex flex-col gap-4'">
          <div><h2 class="text-lg font-bold">{{ 'Reports.builderTitle' | t }}</h2><p class="text-sm text-muted">{{ 'Reports.builderHint' | t }}</p></div>
          <form class="grid gap-3 md:grid-cols-4" (ngSubmit)="runBuilder()">
            <label class="flex flex-col gap-1 text-sm font-semibold md:col-span-2">{{ 'Reports.reportType' | t }}
              <select name="kind" [class]="field" [(ngModel)]="b.kind">
                @for (g of kindGroups; track g.group) { <optgroup [label]="'Reports.group_' + g.group | t">@for (k of g.kinds; track k) { <option [value]="k">{{ 'Reports.kind_' + k | t }}</option> }</optgroup> }
              </select></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.from' | t }}<input name="from" type="date" [class]="field" [(ngModel)]="b.from" /></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.to' | t }}<input name="to" type="date" [class]="field" [(ngModel)]="b.to" /></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.fOrg' | t }}
              <select name="org" [class]="field" [(ngModel)]="b.org"><option value="">{{ 'Reports.all' | t }}</option>@for (o of opts()?.orgs ?? []; track o.id) { <option [value]="o.id">{{ o.name }}</option> }</select></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.fBranch' | t }}
              <select name="branch" [class]="field" [(ngModel)]="b.branch"><option value="">{{ 'Reports.all' | t }}</option>@for (x of branchesOf(b.org); track x.id) { <option [value]="x.id">{{ x.name }}</option> }</select></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.fTeam' | t }}
              <select name="team" [class]="field" [(ngModel)]="b.team"><option value="">{{ 'Reports.all' | t }}</option>@for (x of opts()?.teams ?? []; track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }</select></label>
            <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'Reports.fStatus' | t }}
              <select name="status" [class]="field" [(ngModel)]="b.status"><option value="">{{ 'Reports.all' | t }}</option>@for (x of statuses; track x) { <option [value]="x">{{ 'StaffStatus.' + x | t }}</option> }</select></label>
            <div class="flex flex-wrap items-end gap-2 md:col-span-4">
              <button type="submit" [class]="btn">{{ 'Reports.display' | t }}</button>
              @for (n of [7, 30, 90]; track n) { <button type="button" [class]="btn2" (click)="quick(n)">{{ 'Reports.lastDays' | t: { count: n } }}</button> }
              @if (rows() && canExport()) { <button type="button" [class]="btn2" (click)="exportCsv('builder')">{{ 'Reports.exportCsv' | t }}</button> }
              @if (rows()) { <button type="button" [class]="btn2" (click)="print()">{{ 'Reports.printPdf' | t }}</button> }
            </div>
          </form>
          @if (rows(); as rs) {
            <p class="text-sm text-muted">{{ 'Reports.resultCount' | t: { count: rs.length } }}</p>
            @if (!rs.length) { <p class="text-muted">{{ 'Reports.noData' | t }}</p> } @else {
              <app-bar-list [rows]="chartRows()" />
              <div class="relative overflow-x-auto"><table class="w-full min-w-[44rem] text-start text-sm">
                <thead><tr class="border-b border-line text-muted">
                  @for (hh of ['Reports.kind_' + b.kind, 'Reports.colTickets', 'Reports.colResolved', 'Reports.colOpen', 'Reports.colAvgFirst', 'Reports.colAvgResolve', 'Reports.colSla', 'Reports.colRating']; track hh) { <th scope="col" class="px-2 py-2 text-start font-semibold">{{ hh | t }}</th> }
                </tr></thead>
                <tbody>
                  @for (r of rs; track r.key) { <tr class="border-b border-line"><th scope="row" class="px-2 py-2 text-start font-medium"><span dir="auto">{{ label(r) }}</span>@if (r.sub) { <span class="block text-xs font-normal text-muted" dir="auto">{{ r.sub }}</span> }</th>
                    <td class="px-2 py-2">{{ r.total }}</td><td class="px-2 py-2">{{ r.resolved }}</td><td class="px-2 py-2">{{ r.open }}</td><td class="px-2 py-2">{{ h(r.avgFirst) }}</td><td class="px-2 py-2">{{ h(r.avgRes) }}</td>
                    <td class="px-2 py-2">{{ pcText(r.slaMet, r.slaTotal) }}</td><td class="px-2 py-2">{{ r.avgRating === null ? '-' : r.avgRating + ' / 5' }}</td></tr> }
                  <tr class="font-bold"><th scope="row" class="px-2 py-2 text-start">{{ 'Reports.totalRow' | t }}</th><td class="px-2 py-2">{{ tot().total }}</td><td class="px-2 py-2">{{ tot().resolved }}</td><td class="px-2 py-2">{{ tot().open }}</td><td></td><td></td><td class="px-2 py-2">{{ pcText(tot().slaMet, tot().slaTotal) }}</td><td></td></tr>
                </tbody></table></div>
            }
          }
        </section>

        @if (r.all) {
          @for (p of perf(); track p.title) {
            <section [class]="card">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-bold">{{ p.title | t }}</h2>@if (canExport()) { <button type="button" [class]="btn2" (click)="exportCsv(p.kind)">{{ 'Reports.exportCsv' | t }}</button> }</div>
              @if (!p.rows.length) { <p class="text-muted">{{ 'Reports.noData' | t }}</p> } @else {
                <div class="relative overflow-x-auto"><table class="w-full min-w-[40rem] text-start text-sm">
                  <thead><tr class="border-b border-line text-muted">@for (hh of [p.col, 'Reports.colTickets', 'Reports.colResolved', 'Reports.colOpen', 'Reports.colAvgFirst', 'Reports.colAvgResolve', 'Reports.colSla', 'Reports.colRating']; track hh) { <th scope="col" class="px-2 py-2 text-start font-semibold">{{ hh | t }}</th> }</tr></thead>
                  <tbody>@for (x of p.rows; track $index) {
                    <tr class="border-b border-line last:border-0"><th scope="row" class="px-2 py-2 text-start font-medium" dir="auto">{{ x.label }}</th>
                      <td class="px-2 py-2">{{ x.m.total }}</td><td class="px-2 py-2">{{ x.m.resolved }}</td><td class="px-2 py-2">{{ x.m.open }}</td><td class="px-2 py-2">{{ h(x.m.avgFirst) }}</td><td class="px-2 py-2">{{ h(x.m.avgRes) }}</td>
                      <td class="px-2 py-2">{{ pcText(x.m.slaMet, x.m.slaTotal) }}</td><td class="px-2 py-2">{{ x.m.avgRating === null ? '-' : x.m.avgRating + ' / 5' }}{{ x.m.ratings ? ' (' + x.m.ratings + ')' : '' }}</td></tr>
                  }</tbody></table></div>
              }
            </section>
          }
          <section [class]="card">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-bold">{{ 'Reports.csat' | t }}</h2>@if (canExport()) { <button type="button" [class]="btn2" (click)="exportCsv('satisfaction')">{{ 'Reports.exportCsv' | t }}</button> }</div>
            @if (!r.satisfaction.count) { <p class="text-muted">{{ 'Reports.csatNone' | t }}</p> } @else {
              <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div><p class="text-4xl font-bold">{{ r.satisfaction.average }} <span class="text-lg font-medium text-muted">/ 5</span></p><p class="mt-1 text-sm text-muted">{{ 'Reports.csatCountLine' | t: { count: r.satisfaction.count, resolved: r.satisfaction.resolvedTotal } }}</p></div>
                <app-bar-list [rows]="stars()" />
              </div>
            }
          </section>
          <p class="text-sm text-muted">{{ 'Reports.note' | t }}</p>
        }
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class ReportsPage implements OnInit {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(Auth);
  protected readonly card = CARD;
  protected readonly field = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm font-normal';
  protected readonly btn = 'min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink';
  protected readonly btn2 = 'inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg';
  protected readonly statuses = STATUSES;
  protected readonly kindGroups = [
    { group: 'volume', kinds: ['day', 'month', 'user', 'category'] }, { group: 'customers', kinds: ['organization', 'branch', 'customer'] },
    { group: 'operations', kinds: ['team', 'priority', 'status'] }, { group: 'performance', kinds: ['sla', 'satisfaction'] },
  ];
  protected readonly days = signal(30);
  protected readonly s = signal<Summary | null>(null);
  protected readonly rows = signal<BRow[] | null>(null);
  protected readonly opts = signal<{ orgs: { id: string; name: string }[]; branches: { id: string; organizationId: string; name: string }[]; teams: { id: string; nameEn: string; nameAr: string }[] } | null>(null);
  private prios: { code: string; nameEn: string; nameAr: string }[] = [];
  protected b = { kind: 'organization', from: cairoDay(-29), to: cairoDay(), org: '', branch: '', team: '', status: '' };
  protected readonly canExport = computed(() => !!this.auth.me()?.roles.includes('admin') || this.auth.has('export'));

  protected readonly breakdowns = computed(() => {
    const r = this.s(); if (!r) return [];
    const nm = (x: Named) => ({ label: this.i18n.pick(x.nameEn, x.nameAr) || this.i18n.t('Reports.none'), value: x.n });
    return [
      { title: 'Reports.byStatus', rows: STATUSES.map((s) => ({ label: this.i18n.t('StaffStatus.' + s), value: r.byStatus[s] ?? 0 })).filter((x) => x.value) },
      { title: 'Reports.byPriority', rows: Object.entries(r.byPriority).map(([k, v]) => ({ label: this.prioName(k), value: v })) },
      { title: 'Reports.byCategory', rows: r.byCategory.map(nm) },
      { title: 'Reports.byTeam', rows: r.byTeam.map(nm) },
    ];
  });
  protected readonly perf = computed(() => {
    const r = this.s(); if (!r) return [];
    return [
      { title: 'Reports.agentPerf', col: 'Reports.colAgent', kind: 'agents', rows: r.agentPerf.map((a) => ({ label: a.name, m: a.m })) },
      { title: 'Reports.teamPerf', col: 'Reports.colTeam', kind: 'teams', rows: r.teamPerf.map((a) => ({ label: this.i18n.pick(a.nameEn, a.nameAr), m: a.m })) },
    ];
  });
  protected readonly stars = computed(() => (this.s()?.satisfaction.dist ?? []).map((n, i) => ({ label: this.i18n.t('Reports.csatStars', { count: i + 1 }), value: n })).reverse().filter((x) => x.value > 0));
  protected readonly tot = computed(() => (this.rows() ?? []).reduce((a, r) => ({ total: a.total + r.total, resolved: a.resolved + r.resolved, open: a.open + r.open, slaMet: a.slaMet + r.slaMet, slaTotal: a.slaTotal + r.slaTotal }), { total: 0, resolved: 0, open: 0, slaMet: 0, slaTotal: 0 }));
  protected readonly chartRows = computed(() => (this.rows() ?? []).slice(0, 12).map((r) => ({ label: this.label(r), value: r.total })));

  async ngOnInit(): Promise<void> {
    await this.load();
    const [lk, opt] = await Promise.all([
      firstValueFrom(this.http.get<{ orgs: { id: string; name: string }[]; branches: { id: string; organizationId: string; name: string }[]; teams: { id: string; nameEn: string; nameAr: string }[] }>('/api/reports/options')).catch(() => null),
      firstValueFrom(this.http.get<{ priorities: { code: string; nameEn: string; nameAr: string }[] }>('/api/tickets/options')).catch(() => null),
    ]);
    this.opts.set(lk); this.prios = opt?.priorities ?? [];
  }
  private async load(): Promise<void> { this.s.set(await firstValueFrom(this.http.get<Summary>('/api/reports/summary', { params: { days: this.days() } }))); }
  protected setDays(d: number): void { this.days.set(d); void this.load(); }
  protected h(v: number | null): string { return human(this.i18n, v); }
  protected pc(a: number, b: number): number | null { return pct(a, b); }
  protected pcText(a: number, b: number): string { const v = pct(a, b); return v === null ? '-' : `${v}%`; }
  protected prioName(code: string): string { const p = this.prios.find((x) => x.code === code); return p ? this.i18n.pick(p.nameEn, p.nameAr) : code; }
  protected branchesOf(org: string) { return (this.opts()?.branches ?? []).filter((x) => !org || x.organizationId === org); }
  protected label(r: BRow): string {
    if (this.b.kind === 'status' && r.labelEn) return this.i18n.t('StaffStatus.' + r.labelEn);
    if (this.b.kind === 'sla' && r.labelEn) return this.i18n.t(r.labelEn === 'met' ? 'Reports.kpi_slaMet' : r.labelEn === 'breached' ? 'Reports.kpi_slaBreached' : 'Reports.none');
    if (this.b.kind === 'satisfaction' && r.labelEn && r.labelEn !== 'none') return this.i18n.t('Reports.csatStars', { count: Number(r.labelEn) });
    return this.i18n.pick(r.labelEn, r.labelAr) || this.i18n.t('Reports.none');
  }
  private builderParams(): Record<string, string> {
    const p: Record<string, string> = { kind: this.b.kind, from: this.b.from, to: this.b.to };
    for (const k of ['org', 'branch', 'team', 'status'] as const) if (this.b[k]) p[k] = this.b[k];
    return p;
  }
  protected async runBuilder(): Promise<void> { this.rows.set((await firstValueFrom(this.http.get<{ rows: BRow[] }>('/api/reports/builder', { params: this.builderParams() }))).rows); }
  protected quick(n: number): void { this.b.from = cairoDay(-(n - 1)); this.b.to = cairoDay(); void this.runBuilder(); }
  protected exportCsv(kind: string): void {
    const p = new URLSearchParams(kind === 'builder' ? { kind, report: this.b.kind, ...this.builderParams(), locale: this.i18n.locale() } : { kind, days: String(this.days()), locale: this.i18n.locale() });
    if (kind === 'builder') p.set('kind', 'builder');
    void download(this.http, '/api/reports/export?' + p.toString());
  }
  protected print(): void { window.print(); }
}

// ================================================================== SLA report

interface Tally { met: number; total: number; pct: number | null }
interface SlaData {
  firstResponse: Tally; resolution: Tally; original: { n: number; fr: Tally; rs: Tally }; afterReopen: { n: number; fr: Tally; rs: Tally };
  now: Record<string, number>; atRisk: { id: string; reference: string; subject: string; state: string; due: string | null }[];
}

@Component({
  selector: 'app-sla-report',
  imports: [TPipe, RouterLink],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'SlaReport.title' | t }}</h1><p class="mt-1 text-muted">{{ 'SlaReport.subtitle' | t }} {{ 'SlaReport.period' | t: { days: 30 } }}</p></div>
      @if (d(); as x) {
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          @for (b of [[x.firstResponse, 'SlaReport.firstResponse'], [x.resolution, 'SlaReport.resolution']]; track $index) {
            <div class="rounded-md border border-line bg-surface p-5"><p class="text-sm text-muted">{{ $any(b[1]) | t }}</p>
              <p class="mt-1 text-3xl font-bold">{{ $any(b[0]).pct === null ? ('SlaReport.none' | t) : $any(b[0]).pct + '%' }}</p>
              @if ($any(b[0]).pct !== null) { <p class="text-sm text-muted">{{ 'SlaReport.of' | t: { met: $any(b[0]).met, total: $any(b[0]).total } }} · {{ 'SlaReport.target' | t }}</p> }</div>
          }
        </div>
        <section><h2 class="mb-1 text-lg font-bold">{{ 'SlaReport.cyclesTitle' | t }}</h2><p class="mb-3 max-w-prose text-sm text-muted">{{ 'SlaReport.cyclesHelp' | t }}</p>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            @for (k of ['original', 'afterReopen']; track k) {
              <div class="rounded-md border border-line bg-surface p-5"><h3 class="font-bold">{{ 'SlaReport.' + k | t }}</h3><p class="text-sm text-muted">{{ 'SlaReport.cycleCount' | t: { count: $any(x)[k].n } }}</p>
                <dl class="mt-3 grid grid-cols-2 gap-3">
                  <div><dt class="text-sm text-muted">{{ 'SlaReport.firstResponse' | t }}</dt><dd class="text-2xl font-bold">{{ $any(x)[k].fr.pct === null ? ('SlaReport.none' | t) : $any(x)[k].fr.pct + '%' }}</dd></div>
                  <div><dt class="text-sm text-muted">{{ 'SlaReport.resolution' | t }}</dt><dd class="text-2xl font-bold">{{ $any(x)[k].rs.pct === null ? ('SlaReport.none' | t) : $any(x)[k].rs.pct + '%' }}</dd></div>
                </dl></div>
            }
          </div></section>
        <section><h2 class="mb-3 text-lg font-bold">{{ 'SlaReport.now' | t }}</h2>
          <dl class="grid grid-cols-2 gap-3 md:grid-cols-4">
            @for (s of [['breached', 'breached'], ['due_soon', 'dueSoon'], ['paused', 'paused'], ['on_track', 'onTrack']]; track s[0]) {
              <div class="rounded-md border border-line bg-surface p-5"><dt class="text-sm text-muted">{{ 'SlaReport.' + s[1] | t }}</dt><dd class="text-2xl font-bold">{{ x.now[s[0]] ?? 0 }}</dd></div>
            }
          </dl></section>
        <section><h2 class="mb-3 text-lg font-bold">{{ 'SlaReport.atRisk' | t }}</h2>
          @if (!x.atRisk.length) { <p class="rounded-md border border-line bg-surface p-5 text-muted">{{ 'SlaReport.atRiskEmpty' | t }}</p> } @else {
            <ul class="flex flex-col gap-2">
              @for (r of x.atRisk; track r.id) {
                <li class="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface p-3">
                  <span><a [routerLink]="'/' + i18n.locale() + '/console/tickets/' + r.id" class="font-semibold text-brand-ink underline" dir="ltr">{{ r.reference }}</a> <span dir="auto">{{ r.subject }}</span></span>
                  <span class="flex items-center gap-3"><span class="rounded-full px-2 py-0.5 text-xs font-semibold" [class]="r.state === 'breached' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn-ink'">{{ 'Sla.' + r.state | t }}</span>
                    @if (r.due) { <span class="text-sm text-muted">{{ 'SlaReport.dueAt' | t }} {{ i18n.date(r.due) }}</span> }</span>
                </li>
              }
            </ul>
          }</section>
        <p class="text-sm text-muted">{{ 'SlaReport.note' | t }}</p>
      }
    </main>`,
})
export class SlaReportPage {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly d = signal<SlaData | null>(null);
  constructor() { void firstValueFrom(this.http.get<SlaData>('/api/reports/sla')).then((x) => this.d.set(x)); }
}

// ================================================================== audit log

interface AuditRow { id: number; action: string; entityType: string; entityId: string | null; before: string | null; after: string | null; createdAt: string; actor: string | null }

@Component({
  selector: 'app-audit',
  imports: [TPipe],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header><h1 class="text-3xl font-bold tracking-tight">{{ 'AuditLog.title' | t }}</h1><p class="mt-1 text-muted">{{ 'AuditLog.subtitle' | t }}</p></header>
      <form class="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-card" (submit)="$event.preventDefault(); page.set(1); load()">
        <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AuditLog.filterType' | t }}
          <select class="min-h-11 min-w-56 rounded-lg border border-line bg-surface px-3 text-base" [value]="entity()" (change)="entity.set($any($event.target).value)">
            <option value="">{{ 'AuditLog.allTypes' | t }}</option>@for (x of types(); track x) { <option [value]="x">{{ x }}</option> }</select></label>
        <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'AuditLog.apply' | t }}</button>
      </form>
      @if (rows() && !rows()!.length) { <p class="rounded-xl border border-line bg-surface p-6 text-muted">{{ 'AuditLog.empty' | t }}</p> } @else {
        <div class="relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table class="w-full min-w-[48rem] text-start text-sm">
            <caption class="sr-only">{{ 'AuditLog.title' | t }}</caption>
            <thead class="border-b border-line bg-bg"><tr>@for (c of ['when', 'who', 'action', 'changes']; track c) { <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'AuditLog.col.' + c | t }}</th> }</tr></thead>
            <tbody>
              @for (r of rows() ?? []; track r.id) {
                <tr class="border-b border-line align-top last:border-0">
                  <td class="whitespace-nowrap px-4 py-3 text-muted">{{ i18n.date(r.createdAt) }}</td>
                  <td class="px-4 py-3" dir="auto">{{ r.actor ?? ('AuditLog.system' | t) }}</td>
                  <td class="px-4 py-3"><span class="font-semibold" dir="ltr">{{ r.action }}</span><p class="text-muted" dir="ltr">{{ r.entityId ?? '' }}</p></td>
                  <td class="px-4 py-3">@for (c of changes(r); track c) { <p dir="ltr" class="break-words">{{ c }}</p> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <nav class="flex items-center justify-between gap-3" [attr.aria-label]="'AuditLog.page' | t: { page: page(), pages: pages() }">
        @if (page() > 1) { <button type="button" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg" (click)="go(-1)">{{ 'AuditLog.previous' | t }}</button> } @else { <span></span> }
        <span class="text-sm text-muted">{{ 'AuditLog.page' | t: { page: page(), pages: pages() } }}</span>
        @if (page() < pages()) { <button type="button" class="flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg" (click)="go(1)">{{ 'AuditLog.next' | t }}</button> } @else { <span></span> }
      </nav>
    </main>`,
})
export class AuditPage implements OnInit {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly entity = signal(this.route.snapshot.queryParamMap.get('entity') ?? '');
  protected readonly page = signal(Number(this.route.snapshot.queryParamMap.get('page') ?? 1) || 1);
  protected readonly types = signal<string[]>([]);
  protected readonly rows = signal<AuditRow[] | null>(null);
  private readonly total = signal(0);
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / 25)));
  ngOnInit(): void { void this.load(); }
  protected async load(): Promise<void> {
    void this.router.navigate([], { replaceUrl: true, queryParams: { entity: this.entity() || null, page: this.page() > 1 ? this.page() : null } });
    const r = await firstValueFrom(this.http.get<{ types: string[]; total: number; rows: AuditRow[] }>('/api/admin/audit', { params: { entity: this.entity(), page: this.page() } }));
    this.types.set(r.types); this.total.set(r.total); this.rows.set(r.rows);
  }
  protected go(d: number): void { this.page.update((p) => p + d); void this.load(); }
  /** Up to four changed fields, shown as "field: before → after" (same as today). */
  protected changes(r: AuditRow): string[] {
    const parse = (s: string | null) => { try { const v = s ? JSON.parse(s) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };
    const b = parse(r.before), a = parse(r.after);
    const show = (v: unknown) => { const s = v === null || v === undefined ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 40 ? `${s.slice(0, 40)}...` : s; };
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !['updated_at', 'created_at', 'id'].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .slice(0, 4).map((k) => `${k}: ${show(b[k])} → ${show(a[k])}`);
  }
}

// ================================================================== My team

interface TeamMemberRow { teamId: string; userId: string; isLeader: boolean; fullName: string; email: string; autoAssign: boolean; canCreateForCustomers: boolean }

@Component({
  selector: 'app-my-team',
  imports: [TPipe, Alert],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Team.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Team.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (teams() && !teams()!.length) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'Team.noTeams' | t }}</p> }
      @for (t of teams() ?? []; track t.id) {
        <section class="rounded-xl border border-line bg-surface p-6 shadow-card">
          <h2 class="mb-1 text-xl font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</h2>
          <p class="mb-1 text-sm text-muted">{{ 'Team.rule' | t }}</p><p class="mb-4 text-sm text-muted">{{ 'Team.createRule' | t }}</p>
          <ul class="flex flex-col gap-2">
            @for (r of t.members; track r.userId) {
              <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <span><span class="font-semibold" dir="auto">{{ r.fullName }}</span> <span class="text-sm text-muted" dir="ltr">{{ r.email }}</span>
                  @if (r.isLeader) { <span class="ms-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Team.leader' | t }}</span> }</span>
                <div class="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <label class="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" class="h-5 w-5" [checked]="r.autoAssign" (change)="set(r, { autoAssign: $any($event.target).checked })" />{{ 'Team.switchFor' | t: { name: r.fullName } }}</label>
                  <label class="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" class="h-5 w-5" [checked]="r.canCreateForCustomers" (change)="set(r, { canCreateForCustomers: $any($event.target).checked })" />{{ 'Team.createFor' | t: { name: r.fullName } }}</label>
                </div>
              </li>
            }
          </ul>
        </section>
      }
    </main>`,
})
export class MyTeamPage {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly teams = signal<{ id: string; nameEn: string; nameAr: string; members: TeamMemberRow[] }[] | null>(null);
  protected readonly msg = signal<{ tone: 'error' | 'success'; text: string } | null>(null);
  constructor() { void this.load(); }
  private async load(): Promise<void> { this.teams.set(await firstValueFrom(this.http.get<{ id: string; nameEn: string; nameAr: string; members: TeamMemberRow[] }[]>('/api/console/my-team'))); }
  protected async set(r: TeamMemberRow, b: Partial<Pick<TeamMemberRow, 'autoAssign' | 'canCreateForCustomers'>>): Promise<void> {
    try { await firstValueFrom(this.http.put('/api/console/my-team/' + r.userId, b)); this.msg.set({ tone: 'success', text: this.i18n.t('Team.saved') }); await this.load(); }
    catch { this.msg.set({ tone: 'error', text: this.i18n.t('Directory.errors.generic') }); }
  }
}
