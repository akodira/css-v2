import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SiteService } from '../../core/api';
import { I18n, TPipe } from '../../core/i18n';
import { AddPanel, Alert, Req, ReqNote, TONE_CLASS, Tone } from '../../shared/ui';
import { AdminBase } from './admin-pages';

// Ticket status → several flows. A flow is a set of statuses and the button moves between them (who may make each move,
// and whether a reason is needed). Automatic moves are built in. A ticket type or a category picks the flow of a new
// ticket; a ticket keeps the flow it started with. Status names and colours are shared by every flow.

const STATUSES = ['new', 'open', 'in_progress', 'pending_customer', 'pending_internal', 'resolved', 'reopened', 'closed'];
const REQUIRED = ['new', 'in_progress', 'resolved', 'closed'];
const KIND: Record<string, string> = { new: 'start', open: 'working', in_progress: 'working', pending_customer: 'waiting', pending_internal: 'waiting', resolved: 'resolved', reopened: 'working', closed: 'closed' };

interface FlowRow { from: string; to: string; actor: 'staff' | 'customer'; requiresReason: boolean }
interface FlowItem { id: string; nameEn: string; nameAr: string; description: string; isDefault: boolean; statuses: string[]; transitions: FlowRow[]; problems: string[]; openTickets: Record<string, number> }
interface Pickable { id: string; nameEn: string; nameAr: string; code?: string | null; flowId: string | null; isActive: boolean }
interface FlowsData { choice: 'type' | 'category'; flows: FlowItem[]; types: Pickable[]; categories: Pickable[] }
interface ReasonRow { code: string; nameEn: string; nameAr: string; customerMayReopen: boolean; isSystem: boolean; isActive: boolean; sortOrder: number; inUse: boolean }
interface StatusData { statuses: string[]; reasons: ReasonRow[]; labels: { key: string; locale: string; body: string }[] }
interface LabelModel { staffEn: string; staffAr: string; customerEn: string; customerAr: string; descriptionEn: string; descriptionAr: string; tone: string }
type ReasonModel = Omit<ReasonRow, 'code' | 'isSystem' | 'inUse'> & { code?: string };
const blankReason = (): ReasonModel => ({ nameEn: '', nameAr: '', customerMayReopen: true, isActive: true, sortOrder: 100 });
interface Draft { nameEn: string; nameAr: string; description: string; statuses: string[]; rows: FlowRow[] }

/** The moves the system makes by itself (same as FlowRules.Automatic on the server). */
function automatic(st: string[]): [string, string, string][] {
  const a: [string, string, string][] = [];
  if (st.includes('open')) a.push(['new', 'open', 'assigned'], ['open', 'in_progress', 'firstReply']); else a.push(['new', 'in_progress', 'firstReply']);
  if (st.includes('pending_customer')) a.push(['pending_customer', 'in_progress', 'customerReplies'], ['pending_customer', 'closed', 'noReply']);
  a.push(['resolved', 'closed', 'afterDays'], ['resolved', st.includes('reopened') ? 'reopened' : 'in_progress', 'customerReplies']);
  return a;
}
/** Same checks as FlowRules.Problems on the server: codes like "unreachable:open". */
function problems(st: string[], rows: FlowRow[]): string[] {
  const p: string[] = [];
  for (const r of REQUIRED) if (!st.includes(r)) p.push('missing:' + r);
  for (const m of rows) if (!st.includes(m.from) || !st.includes(m.to)) p.push(`outside:${m.from}`);
  if (p.length) return p;
  const auto = automatic(st).map(([f, t]) => ({ f, t }));
  const edges = [...rows.map((m) => ({ f: m.from, t: m.to })), ...auto];
  for (const s of st) if (s !== 'new' && !edges.some((e) => e.t === s)) p.push('unreachable:' + s);
  const staff = [...rows.filter((m) => m.actor === 'staff').map((m) => ({ f: m.from, t: m.to })), ...auto];
  const reach = (from: string) => { const seen = new Set([from]); const q = [from]; while (q.length) { const x = q.shift()!; if (x === 'resolved') return true; for (const e of staff) if (e.f === x && !seen.has(e.t)) { seen.add(e.t); q.push(e.t); } } return false; };
  for (const s of st) if (['new', 'open', 'in_progress', 'reopened'].includes(s) && !reach(s)) p.push('no_resolve:' + s);
  for (const s of st) if (KIND[s] === 'waiting' && !edges.some((e) => e.f === s)) p.push('stuck:' + s);
  return p;
}

const TONE_SVG: Record<string, [string, string]> = {
  brand: ['var(--color-brand-soft)', 'var(--color-brand-ink)'], warn: ['var(--color-warn-soft)', 'var(--color-warn-ink)'], ok: ['var(--color-ok-soft)', 'var(--color-ok)'],
  danger: ['var(--color-danger-soft)', 'var(--color-danger)'], muted: ['var(--color-bg)', 'var(--color-muted)'],
};
const POS: Record<string, [number, number]> = { new: [75, 180], open: [260, 180], in_progress: [445, 180], pending_customer: [445, 65], pending_internal: [445, 305], resolved: [645, 180], reopened: [650, 305], closed: [835, 180] };
/** Hand-drawn routes for the usual moves (the admin's picture); any other move is drawn as a straight line. */
const ROUTE: Record<string, [string, string, number, number]> = {
  'in_progress>pending_customer': ['M430 155 V99', 'staffAsks', 382, 132], 'pending_customer>in_progress': ['M478 99 V153', '', 0, 0],
  'in_progress>pending_internal': ['M430 205 V283', 'otherTeam', 380, 252], 'pending_internal>in_progress': ['M455 283 V207', '', 0, 0],
  'in_progress>resolved': ['M515 180 H571', 'fixed', 543, 172], 'resolved>closed': ['M715 172 H776', 'confirms', 745, 164], 'resolved>reopened': ['M630 205 V283', 'reopens', 600, 252],
  'reopened>in_progress': ['M595 285 L522 225', '', 0, 0], 'closed>reopened': ['M830 205 L724 300', 'within30', 805, 270],
  'new>closed': ['M130 205 V392 H845 V209', 'closesReason', 480, 385], 'pending_customer>closed': ['M500 99 C540 140 740 120 800 153', 'closesReason', 690, 118],
};
const AUTO_DRAW: Record<string, [string, string, number, number]> = {
  'new>open': ['M145 180 H186', 'assigned', 165, 214], 'open>in_progress': ['M330 180 H371', 'firstReply', 350, 214], 'new>in_progress': ['M145 168 C230 140 300 140 371 168', 'firstReply', 260, 140],
  'pending_customer>closed': ['M515 60 H865 V151', 'noReply', 690, 52], 'resolved>closed': ['M715 192 H776', 'afterDays', 745, 210],
  'pending_customer>in_progress': ['M455 99 V153', 'customerReplies', 410, 182], 'resolved>reopened': ['M650 205 V283', '', 0, 0], 'resolved>in_progress': ['M600 160 C560 120 540 150 520 168', '', 0, 0],
};

/** The whole flow on one page: boxes show the staff name and, below, what customers see. Click a box to edit it. */
@Component({
  selector: 'app-flow-map',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-x-auto">
      <svg viewBox="0 0 900 420" class="w-full min-w-[52rem]" role="group" [attr.aria-label]="'Flows.mapLabel' | t">
        <defs>
          <marker id="fm-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-brand)" /></marker>
          <marker id="fm-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-ok)" /></marker>
          <marker id="fm-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--color-muted)" /></marker>
        </defs>
        @for (l of lines(); track l.key) {
          <path [attr.d]="l.d" fill="none" [attr.stroke]="l.color" [attr.stroke-width]="l.auto ? 2 : 2.4" [attr.stroke-dasharray]="l.auto ? '6 5' : null" [attr.marker-end]="'url(#' + l.marker + ')'" />
          @if (l.label) { <text [attr.x]="l.x" [attr.y]="l.y" font-size="11" text-anchor="middle" [attr.fill]="l.labelColor">{{ 'Flows.lbl.' + l.label | t }}</text> }
        }
        @for (s of statuses(); track s) {
          <g role="button" tabindex="0" class="cursor-pointer outline-none [&:focus-visible>rect]:stroke-[var(--color-ink)]" [attr.aria-label]="'Flows.editStatus' | t: { name: staffName()(s) }"
            (click)="pick.emit(s)" (keydown.enter)="pick.emit(s)" (keydown.space)="$event.preventDefault(); pick.emit(s)">
            <rect [attr.x]="pos(s)[0] - 70" [attr.y]="pos(s)[1] - 25" width="140" height="50" rx="10" [attr.fill]="tone()(s)[0]" [attr.stroke]="s === current() ? 'var(--color-brand)' : 'var(--color-line)'" [attr.stroke-width]="s === current() ? 4 : 1.5" />
            <text [attr.x]="pos(s)[0]" [attr.y]="pos(s)[1] - 3" font-size="13" font-weight="700" text-anchor="middle" fill="var(--color-ink)">{{ staffName()(s) }}</text>
            <text [attr.x]="pos(s)[0]" [attr.y]="pos(s)[1] + 14" font-size="11" text-anchor="middle" [attr.fill]="tone()(s)[1]">{{ customerName()(s) }}</text>
          </g>
        }
      </svg>
    </div>
    <ul class="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      <li class="flex items-center gap-2"><span aria-hidden="true" class="inline-block w-7 border-t-[3px] border-brand"></span>{{ 'Flows.legendStaff' | t }}</li>
      <li class="flex items-center gap-2"><span aria-hidden="true" class="inline-block w-7 border-t-[3px] border-ok"></span>{{ 'Flows.legendCustomer' | t }}</li>
      <li class="flex items-center gap-2"><span aria-hidden="true" class="inline-block w-7 border-t-[3px] border-dashed border-muted"></span>{{ 'Flows.legendAuto' | t }}</li>
    </ul>`,
})
export class FlowMap {
  readonly statuses = input.required<string[]>();
  readonly rows = input.required<FlowRow[]>();
  readonly current = input<string | null>(null);
  readonly staffName = input.required<(s: string) => string>();
  readonly customerName = input.required<(s: string) => string>();
  readonly tone = input.required<(s: string) => [string, string]>();
  readonly pick = output<string>();
  protected pos(s: string): [number, number] { return POS[s]; }
  protected readonly lines = computed(() => {
    const st = this.statuses(); const out: { key: string; d: string; color: string; marker: string; auto: boolean; label: string; x: number; y: number; labelColor: string }[] = [];
    for (const [f, t] of automatic(st)) {
      const r = AUTO_DRAW[f + '>' + t]; if (!r) continue;
      const green = f === 'pending_customer' && t === 'in_progress';
      out.push({ key: 'a' + f + t, d: r[0], color: green ? 'var(--color-ok)' : 'var(--color-muted)', marker: green ? 'fm-g' : 'fm-d', auto: true, label: r[1], x: r[2], y: r[3], labelColor: 'var(--color-muted)' });
    }
    const done = new Set<string>();
    for (const m of this.rows()) {
      const k = m.from + '>' + m.to; const c = m.actor === 'staff' ? 'var(--color-brand)' : 'var(--color-ok)'; const mk = m.actor === 'staff' ? 'fm-b' : 'fm-g';
      const r = ROUTE[k];
      if (r) { if (done.has(k)) continue; done.add(k); out.push({ key: 'm' + k, d: r[0], color: c, marker: mk, auto: false, label: r[1], x: r[2], y: r[3], labelColor: r[1] === 'closesReason' ? c : 'var(--color-muted)' }); continue; }
      const [x1, y1] = POS[m.from], [x2, y2] = POS[m.to]; const dx = x2 - x1, dy = y2 - y1;
      const k2 = Math.min(70 / Math.abs(dx || 1e-9), 25 / Math.abs(dy || 1e-9)), off = m.actor === 'customer' ? 5 : 0;
      out.push({ key: 'm' + k + m.actor, d: `M${x1 + dx * k2 + off} ${y1 + dy * k2 + off} L${x2 - dx * k2 + off} ${y2 - dy * k2 + off}`, color: c, marker: mk, auto: false, label: '', x: 0, y: 0, labelColor: c });
    }
    return out;
  });
}

@Component({
  selector: 'app-admin-status',
  imports: [TPipe, Alert, AddPanel, FormsModule, Req, ReqNote, NgTemplateOutlet, RouterLink, FlowMap],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminStatus.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Flows.subtitle' | t }}</p></div>
        <a [routerLink]="'/' + i18n.locale() + '/admin/ticket-status/guide'" class="text-sm font-semibold text-brand-ink underline">{{ 'StatusGuide.open' | t }}</a>
      </div>
      <nav class="flex flex-wrap gap-1 border-b-2 border-line" [attr.aria-label]="'AdminStatus.title' | t">
        @for (tb of tabs; track tb) {
          <a [routerLink]="[]" [queryParams]="{ tab: tb === 'flows' ? null : tb }" [attr.aria-current]="tab() === tb ? 'page' : null"
            class="-mb-0.5 min-h-11 border-b-[3px] px-4 py-2.5 font-semibold" [class]="tab() === tb ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">{{ 'Flows.tab.' + tb | t }}</a>
        }
      </nav>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      @if (tab() === 'flows' && !editing()) {
        <div class="flex flex-wrap items-start justify-between gap-3">
          <p class="max-w-prose text-muted">{{ 'Flows.flowsHelp' | t }}</p>
          <app-add #nf label="Flows.newFlow">
            <form class="flex flex-col gap-4" novalidate (ngSubmit)="createFlow(nf)">
              <div class="grid gap-4 md:grid-cols-2">
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Flows.nameEn' | t }}<app-req /></span><input name="en" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.nameEn" /></label>
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Flows.nameAr' | t }}<app-req /></span><input name="ar" dir="rtl" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.nameAr" /></label>
                <label class="flex flex-col gap-1.5 text-sm font-semibold md:col-span-2">{{ 'Flows.copyFrom' | t }}
                  <select name="from" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.copyFrom">@for (f of data()?.flows ?? []; track f.id) { <option [value]="f.id">{{ i18n.pick(f.nameEn, f.nameAr) }}</option> }</select></label>
              </div>
              <p class="text-sm text-muted">{{ 'Flows.newHint' | t }}</p>
              <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Flows.create' | t }}</button><app-req-note /></div>
            </form>
          </app-add>
        </div>
        <ul class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          @for (f of data()?.flows ?? []; track f.id) {
            <li class="flex flex-col gap-2 rounded-xl border bg-surface p-4 shadow-card" [class]="f.isDefault ? 'border-brand ring-1 ring-brand' : 'border-line'">
              <span class="self-start rounded-full px-2.5 py-0.5 text-xs font-bold" [class]="f.isDefault ? 'bg-brand-soft text-brand-ink' : usedBy(f.id).length ? 'bg-bg text-muted' : 'bg-warn-soft text-warn-ink'">
                {{ (f.isDefault ? 'Flows.default' : usedBy(f.id).length ? 'Flows.inUse' : 'Flows.notUsed') | t }}</span>
              <h2 class="text-lg font-bold" dir="auto">{{ i18n.pick(f.nameEn, f.nameAr) }}</h2>
              @if (f.description) { <p class="text-sm text-muted" dir="auto">{{ f.description }}</p> }
              <p class="text-sm">{{ 'Flows.counts' | t: { s: f.statuses.length, m: f.transitions.length } }} ·
                @if (f.problems.length) { <span class="font-semibold text-danger">{{ 'Flows.problemsN' | t: { n: f.problems.length } }}</span> } @else { <span class="text-ok">✓ {{ 'Flows.noProblems' | t }}</span> }</p>
              <p class="text-sm">{{ 'Flows.usedBy' | t }}: <b dir="auto">{{ usedBy(f.id).length ? usedBy(f.id).join(', ') : ('Flows.nothingYet' | t) }}</b></p>
              <p class="text-sm text-muted">{{ 'Flows.openNow' | t: { n: openCount(f) } }}</p>
              <div class="mt-auto flex flex-wrap items-center gap-x-4 border-t border-line pt-2">
                <a [routerLink]="[]" [queryParams]="{ flow: f.id }" class="min-h-11 py-2.5 font-semibold text-brand-ink underline">{{ 'Flows.edit' | t }}<span class="sr-only"> {{ i18n.pick(f.nameEn, f.nameAr) }}</span></a>
                <button type="button" class="min-h-11 cursor-pointer font-semibold text-brand-ink underline" (click)="copy(f)">{{ 'Flows.copy' | t }}</button>
                @if (!f.isDefault) {
                  <button type="button" class="min-h-11 cursor-pointer font-semibold text-brand-ink underline" (click)="makeDefault(f)">{{ 'Flows.makeDefault' | t }}</button>
                  @if (usedBy(f.id).length || openCount(f)) { <span class="text-sm text-muted">{{ 'Flows.cantDelete' | t }}</span> }
                  @else if (asking() === f.id) {
                    <span class="flex flex-wrap items-center gap-2"><button type="button" class="min-h-9 cursor-pointer rounded-lg bg-danger px-3 text-sm font-semibold text-white" (click)="remove(f)">{{ 'Directory.deleteYes' | t }}</button>
                      <button type="button" class="min-h-9 cursor-pointer text-sm underline" (click)="asking.set(null)">{{ 'Directory.cancel' | t }}</button></span>
                  } @else { <button type="button" class="min-h-11 cursor-pointer font-semibold text-danger underline" (click)="asking.set(f.id)">{{ 'Directory.delete' | t }}</button> }
                }
              </div>
            </li>
          }
        </ul>
        <p class="text-sm text-muted">{{ 'Flows.defaultNote' | t }}</p>
      }

      @if (tab() === 'flows' && editing(); as f) {
        @if (draft(); as d) {
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div><a [routerLink]="[]" [queryParams]="{}" class="text-sm font-semibold text-brand-ink underline">← {{ 'Flows.allFlows' | t }}</a>
              <h2 class="mt-1 text-2xl font-bold">{{ 'Flows.editing' | t }}: <span dir="auto">{{ i18n.pick(d.nameEn, d.nameAr) }}</span></h2>
              <p class="text-sm text-muted">{{ 'Flows.usedBy' | t }}: <span dir="auto">{{ usedBy(f.id).length ? usedBy(f.id).join(', ') : ('Flows.nothingYet' | t) }}</span></p></div>
            <ng-container *ngTemplateOutlet="saveBar" />
          </div>
          <section class="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card md:grid-cols-3" [attr.aria-label]="'Flows.flowName' | t">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Flows.nameEn' | t }}<app-req /></span><input name="fen" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [ngModel]="d.nameEn" (ngModelChange)="patch({ nameEn: $event })" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Flows.nameAr' | t }}<app-req /></span><input name="far" dir="rtl" maxlength="80" [class]="cls.input + ' font-normal'" [ngModel]="d.nameAr" (ngModelChange)="patch({ nameAr: $event })" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Flows.description' | t }}<input name="fd" dir="auto" maxlength="300" [class]="cls.input + ' font-normal'" [ngModel]="d.description" (ngModelChange)="patch({ description: $event })" /></label>
          </section>
          <section class="rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="map-h">
            <h3 id="map-h" class="text-lg font-bold">{{ 'Flows.mapTitle' | t }}</h3>
            <p class="text-sm text-muted">{{ 'Flows.mapHelp' | t }}</p>
            <app-flow-map [statuses]="d.statuses" [rows]="d.rows" [current]="cur()" [staffName]="staffName" [customerName]="customerName" [tone]="svgTone" (pick)="openStatus($event)" />
            <div class="mt-3 text-sm" aria-live="polite">
              @if (draftProblems().length) { <ul class="flex flex-col gap-1 font-semibold text-danger">@for (p of draftProblems(); track p) { <li>! {{ problemText(p) }}</li> }</ul> }
              @else { <p class="font-semibold text-ok">✓ {{ 'Flows.allGood' | t }}</p> }
            </div>
          </section>

          @if (cur(); as s) {
            <section id="status-editor" class="rounded-xl border-2 border-brand bg-surface p-5 shadow-card" aria-labelledby="se-h">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 id="se-h" class="flex flex-wrap items-center gap-2 text-xl font-bold">{{ 'Flows.editStatusTitle' | t }} <span [class]="chip(s)">{{ staffName(s) }}</span></h3>
                <button type="button" [class]="cls.btn2" (click)="closeStatus()">{{ 'Flows.close' | t }}</button>
              </div>
              @if (autoFrom(s).length) { <p class="mt-1 text-sm text-muted">{{ 'Flows.autoHere' | t }}: {{ autoFrom(s) }}</p> }
              <div class="mt-4 flex flex-col">
                <div class="border-b border-line pb-4">
                  <p class="flex items-center gap-2 font-bold"><span aria-hidden="true" [class]="stepCls">1</span>{{ 'Flows.step1' | t }} <span class="text-xs font-normal text-muted">({{ 'Flows.sharedNames' | t }})</span></p>
                  <p class="mt-1 text-sm">{{ 'Flows.namesNow' | t }} <span [class]="chip(s)">{{ staffName(s) }}</span> · {{ 'Flows.customersSee' | t }} <span [class]="chip(s)">{{ customerName(s) }}</span>
                    <a [routerLink]="[]" [queryParams]="{ tab: 'statuses', open: s }" class="ms-2 font-semibold text-brand-ink underline">{{ 'Flows.changeNames' | t }}</a></p>
                </div>
                <fieldset class="border-b border-line py-4">
                  <legend class="flex items-center gap-2 font-bold"><span aria-hidden="true" [class]="stepCls">2</span>{{ 'Flows.step2' | t: { name: staffName(s) } }}</legend>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">@for (t of targets(s); track t) { <ng-container *ngTemplateOutlet="pickTpl; context: { g: 'staff', t }" /> }</div>
                </fieldset>
                <fieldset class="border-b border-line py-4">
                  <legend class="flex items-center gap-2 font-bold"><span aria-hidden="true" [class]="stepCls">3</span>{{ 'Flows.step3' | t }}</legend>
                  <p class="mt-1 text-sm text-muted">{{ 'Flows.step3Hint' | t }}</p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">@for (t of targets(s); track t) { <ng-container *ngTemplateOutlet="pickTpl; context: { g: 'customer', t }" /> }</div>
                </fieldset>
                <fieldset class="py-4">
                  <legend class="flex items-center gap-2 font-bold"><span aria-hidden="true" [class]="stepCls">4</span>{{ 'Flows.step4' | t }}</legend>
                  @if (movesFrom(s).length) { <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">@for (t of movesFrom(s); track t) { <ng-container *ngTemplateOutlet="pickTpl; context: { g: 'reason', t }" /> }</div> }
                  @else { <p class="mt-1 text-sm text-muted">{{ 'Flows.step4Empty' | t }}</p> }
                </fieldset>
                <p class="rounded-lg bg-bg px-4 py-3 text-sm"><b>{{ 'Flows.inShort' | t }}</b> {{ summary(s) }}</p>
                <p class="mt-2 text-sm text-muted">{{ 'Flows.saveHint' | t }}</p>
              </div>
            </section>
          }
          <ng-template #pickTpl let-g="g" let-t="t">
            <label class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft" [class]="'border-line'">
              <input type="checkbox" class="size-5 shrink-0" [checked]="has(cur()!, t, g)" (change)="toggle(cur()!, t, g)" />
              <span><b class="block" dir="auto">{{ staffName(t) }}</b><span class="text-xs text-muted">{{ 'Flows.customersSee' | t }} {{ customerName(t) }}</span></span>
            </label>
          </ng-template>

          <section class="rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="list-h">
            <h3 id="list-h" class="text-lg font-bold">{{ 'Flows.inThisFlow' | t }}</h3>
            <div class="mt-3 overflow-x-auto"><table class="w-full min-w-[44rem] text-sm">
              <thead><tr class="text-xs text-muted"><th scope="col" class="px-3 py-2 text-start">{{ 'Flows.colStatus' | t }}</th><th scope="col" class="px-3 py-2 text-start">{{ 'Flows.customersSee' | t }}</th><th scope="col" class="px-3 py-2 text-start">{{ 'Flows.colNext' | t }}</th><th scope="col" class="w-40 px-3 py-2"><span class="sr-only">{{ 'Flows.edit' | t }}</span></th></tr></thead>
              <tbody>
                @for (s of d.statuses; track s) {
                  <tr class="border-t border-line align-top">
                    <th scope="row" class="px-3 py-3 text-start font-normal"><span [class]="chip(s)">{{ staffName(s) }}</span><span class="mt-1 block text-xs text-muted">{{ 'Flows.kind.' + kind(s) | t }}</span></th>
                    <td class="px-3 py-3"><span [class]="chip(s)">{{ customerName(s) }}</span></td>
                    <td class="px-3 py-3">
                      @if (nextText(s, 'staff'); as x) { <p><b class="text-brand-ink">{{ 'Flows.byStaff' | t }}:</b> {{ x }}</p> }
                      @if (nextText(s, 'customer'); as x) { <p><b class="text-ok">{{ 'Flows.byCustomer' | t }}:</b> {{ x }}</p> }
                      @if (autoFrom(s); as x) { <p class="text-muted"><b>{{ 'Flows.byAuto' | t }}:</b> {{ x }}</p> }
                      @if (!nextText(s, 'staff') && !nextText(s, 'customer') && !autoFrom(s)) { <p [class]="s === 'closed' ? 'text-muted' : 'font-semibold text-danger'">{{ (s === 'closed' ? 'Flows.endOfFlow' : 'Flows.stuckHere') | t }}</p> }
                    </td>
                    <td class="px-3 py-3"><span class="flex items-center justify-end gap-3">
                      <button type="button" [class]="cls.btn2" (click)="openStatus(s)">{{ 'Flows.edit' | t }}<span class="sr-only"> {{ staffName(s) }}</span></button>
                      @if (!required(s)) { <button type="button" class="min-h-11 cursor-pointer text-sm text-muted underline hover:text-danger" (click)="dropStatus(s)">{{ 'Flows.remove' | t }}<span class="sr-only"> {{ staffName(s) }}</span></button> }
                      @else { <span class="w-14" aria-hidden="true"></span> }
                    </span></td>
                  </tr>
                }
              </tbody>
            </table></div>
            @if (missing().length) {
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <label class="sr-only" for="addst">{{ 'Flows.addStatus' | t }}</label>
                <select id="addst" #addst class="min-h-11 rounded-lg border border-line bg-surface px-3">@for (s of missing(); track s) { <option [value]="s">{{ staffName(s) }}</option> }</select>
                <button type="button" [class]="cls.btn2" (click)="addStatus(addst.value)">＋ {{ 'Flows.addStatus' | t }}</button>
              </div>
            }
          </section>

          <section class="rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="try-h">
            <h3 id="try-h" class="text-lg font-bold">{{ 'Flows.tryTitle' | t }}</h3><p class="text-sm text-muted">{{ 'Flows.tryHelp' | t }}</p>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <select [attr.aria-label]="'Flows.colStatus' | t" class="min-h-11 rounded-lg border border-line bg-surface px-3" [ngModel]="tryS()" (ngModelChange)="tryS.set($event)">@for (s of d.statuses; track s) { <option [value]="s">{{ staffName(s) }}</option> }</select>
              <select [attr.aria-label]="'Flows.tryWho' | t" class="min-h-11 rounded-lg border border-line bg-surface px-3" [ngModel]="tryW()" (ngModelChange)="tryW.set($event)"><option value="staff">{{ 'Flows.byStaff' | t }}</option><option value="customer">{{ 'Flows.byCustomer' | t }}</option></select>
              <span aria-live="polite" class="flex flex-wrap gap-2">
                @for (m of tryMoves(); track m.to) { <span class="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-ink">{{ tryW() === 'customer' ? customerName(m.to) : staffName(m.to) }}@if (m.requiresReason) { ({{ 'Flows.reasonShort' | t }}) }</span> }
                @empty { <span class="text-sm text-muted">{{ 'Flows.noButtons' | t }}</span> }
              </span>
            </div>
          </section>
          <div class="flex justify-end"><ng-container *ngTemplateOutlet="saveBar" /></div>
          <ng-template #saveBar>
            <div class="flex flex-wrap items-center gap-3">
              @if (dirty()) { <span class="text-sm font-semibold text-warn-ink">{{ 'Flows.unsaved' | t }}</span> }
              <button type="button" [class]="cls.btn2" (click)="resetDraft()" [disabled]="!dirty()">{{ 'Flows.undo' | t }}</button>
              <button type="button" [class]="cls.btn" [disabled]="busy() || draftProblems().length > 0" (click)="saveDraft()">{{ 'Flows.saveFlow' | t }}</button>
            </div>
          </ng-template>
        }
      }

      @if (tab() === 'statuses') {
        <p class="max-w-prose text-muted">{{ 'Flows.statusesHelp' | t }}</p>
        <ul class="flex flex-col gap-3">
          @for (s of statusList; track s) {
            <li><details [class]="cls.card" [open]="openParam() === s">
              <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-3"><span [class]="chip(s)">{{ staffName(s) }}</span><span class="text-sm text-muted">{{ 'Flows.customersSee' | t }}</span><span [class]="chip(s)">{{ customerName(s) }}</span>
                <span class="text-xs text-muted">· {{ 'Flows.kind.' + kind(s) | t }} · {{ 'Flows.inFlows' | t: { list: flowsWith(s) } }}</span></span></summary>
              @if (lab[s]) {
                <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="saveLabel(s)">
                  <p class="text-sm text-muted">{{ 'AdminV2.labelHint' | t }}</p>
                  <div class="grid gap-4 md:grid-cols-2">
                    @for (fl of labelFields; track fl.key) {
                      <div class="flex flex-col gap-1.5"><label [for]="s + fl.key" [class]="cls.label">{{ fl.label | t }} ({{ (fl.ar ? 'AdminStatus.arSuffix' : 'AdminStatus.enSuffix') | t }})</label>
                        <input [id]="s + fl.key" [name]="fl.key" [attr.dir]="fl.ar ? 'rtl' : 'ltr'" maxlength="500" [class]="cls.input" [placeholder]="std(s, fl.key)" [(ngModel)]="$any(lab[s])[fl.key]" /></div>
                    }
                    <div class="flex flex-col gap-1.5"><label [for]="s + 'tone'" [class]="cls.label">{{ 'AdminStatus.color' | t }}</label>
                      <select [id]="s + 'tone'" name="tone" [class]="cls.input" [(ngModel)]="lab[s].tone">
                        <option value="">{{ 'AdminStatus.reset' | t }} ({{ 'AdminStatus.colors.' + std(s, 'tone') | t }})</option>
                        @for (c of tones; track c) { <option [value]="c">{{ 'AdminStatus.colors.' + c | t }}</option> }
                      </select></div>
                  </div>
                  <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.save' | t }}</button><button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="resetLabel(s)">{{ 'AdminStatus.reset' | t }}</button></div>
                </form>
              }
            </details></li>
          }
        </ul>
      }

      @if (tab() === 'who' && data(); as dd) {
        <section class="rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="who-h">
          <h2 id="who-h" class="text-lg font-bold">{{ 'Flows.chooseBy' | t }}</h2>
          <p class="text-sm text-muted">{{ 'Flows.chooseByHelp' | t }}</p>
          <fieldset class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <legend class="sr-only">{{ 'Flows.chooseBy' | t }}</legend>
            @for (m of ['type', 'category']; track m) {
              <label class="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-line p-4 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="mode" class="mt-0.5 size-5" [value]="m" [checked]="mode === m" (change)="setMode(m)" />
                <span><b class="block">{{ 'Flows.by.' + m | t }}</b><span class="text-sm text-muted">{{ 'Flows.by.' + m + 'Hint' | t: { n: m === 'type' ? dd.types.length : dd.categories.length } }}</span></span>
              </label>
            }
          </fieldset>
          <p class="mt-3 rounded-lg bg-bg px-4 py-3 text-sm">{{ 'Flows.keepNote' | t }}</p>
        </section>
        <section class="rounded-xl border border-line bg-surface p-5 shadow-card" aria-labelledby="who2-h">
          <h2 id="who2-h" class="text-lg font-bold">{{ (mode === 'type' ? 'Flows.whichType' : 'Flows.whichCategory') | t }}</h2>
          <div class="mt-3 overflow-x-auto"><table class="w-full min-w-[36rem] text-sm">
            <thead><tr class="text-xs text-muted"><th scope="col" class="px-3 py-2 text-start">{{ (mode === 'type' ? 'Flows.colType' : 'Flows.colCategory') | t }}</th><th scope="col" class="px-3 py-2 text-start">{{ 'Flows.colFlow' | t }}</th></tr></thead>
            <tbody>
              @for (x of (mode === 'type' ? whoTypes : whoCats); track x.id) {
                <tr class="border-t border-line"><th scope="row" class="px-3 py-3 text-start font-semibold"><span dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</span>
                  @if (x.code) { <span class="ms-2 rounded bg-brand-soft px-1.5 text-xs text-brand-ink">{{ x.code }}</span> } @if (!x.isActive) { <span class="ms-2 text-xs text-muted">({{ 'AdminCatalog.inactive' | t }})</span> }</th>
                  <td class="px-3 py-3"><select class="min-h-11 w-full max-w-xs rounded-lg border border-line bg-surface px-3" [attr.aria-label]="'Flows.flowFor' | t: { name: i18n.pick(x.nameEn, x.nameAr) }" [(ngModel)]="x.flowId" (ngModelChange)="whoDirty.set(true)">
                    <option [ngValue]="null">{{ 'Flows.defaultOption' | t: { name: defaultName() } }}</option>
                    @for (f of dd.flows; track f.id) { <option [ngValue]="f.id">{{ i18n.pick(f.nameEn, f.nameAr) }}</option> }
                  </select></td></tr>
              }
            </tbody>
          </table></div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" [class]="cls.btn" [disabled]="busy()" (click)="saveWho()">{{ 'Flows.saveWho' | t }}</button>
            @if (whoDirty()) { <span class="text-sm font-semibold text-warn-ink">{{ 'Flows.unsaved' | t }}</span> }
          </div>
        </section>
      }

      @if (tab() === 'reasons') {
        <section class="flex flex-col gap-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <p class="max-w-prose text-muted">{{ 'AdminStatus.closureHelp' | t }}</p>
            <app-add #addr label="AdminStatus.reasonAddTitle">
              <form class="flex flex-col gap-3" (ngSubmit)="addReason(addr)">
                <ng-container *ngTemplateOutlet="reasonForm; context: { m: nwReason, id: 'nr', system: false }" />
                <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.reasonAdd' | t }}</button><app-req-note /></div>
              </form>
            </app-add>
          </div>
          <ng-template #reasonForm let-m="m" let-id="id" let-system="system">
            <div class="grid gap-4 md:grid-cols-2">
              <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'AdminStatus.reasonNameEn' | t }}<app-req /></span></label>
                <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
              <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'AdminStatus.reasonNameAr' | t }}<app-req /></span></label>
                <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
            </div>
            <div class="flex flex-wrap gap-x-6">
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'mr'" class="h-5 w-5" [(ngModel)]="m.customerMayReopen" /> {{ 'AdminStatus.mayReopen' | t }}</label>
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" [disabled]="system" /> {{ 'AdminStatus.active' | t }}</label>
            </div>
          </ng-template>
          <ul class="flex flex-col gap-4">
            @for (r of sd()?.reasons ?? []; track r.code) {
              <li><details [class]="cls.card">
                <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-2"><span class="font-bold" dir="auto">{{ i18n.pick(r.nameEn, r.nameAr) }}</span>
                  @if (r.isSystem) { <span [class]="cls.badgeOff">{{ 'AdminStatus.builtIn' | t }}</span> }
                  @if (!r.isActive) { <span [class]="cls.badgeOff">{{ 'AdminCatalog.inactive' | t }}</span> }
                  <span class="text-sm text-muted">· {{ 'AdminStatus.mayReopen' | t }}: {{ (r.customerMayReopen ? 'Flows.yes' : 'Flows.no') | t }}</span></span></summary>
                <form class="flex flex-col gap-3 px-5 pb-5" (ngSubmit)="saveReason(r)">
                  <ng-container *ngTemplateOutlet="reasonForm; context: { m: rs[r.code], id: 'r' + r.code, system: r.isSystem }" />
                  <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.reasonSave' | t }}</button>
                    @if (!r.isSystem && !r.inUse) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="deleteReason(r)">{{ 'Directory.delete' | t }}</button> }</div>
                </form>
              </details></li>
            }
          </ul>
        </section>
      }
    </main>`,
})
export class AdminStatusPage extends AdminBase implements OnInit {
  private readonly site = inject(SiteService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly tabs = ['flows', 'statuses', 'who', 'reasons'];
  protected readonly statusList = STATUSES;
  protected readonly tones = ['brand', 'warn', 'ok', 'danger', 'muted'];
  protected readonly stepCls = 'grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white';
  protected readonly labelFields = [
    { key: 'staffEn', label: 'AdminStatus.staffName', ar: false }, { key: 'staffAr', label: 'AdminStatus.staffName', ar: true },
    { key: 'customerEn', label: 'AdminStatus.customerName', ar: false }, { key: 'customerAr', label: 'AdminStatus.customerName', ar: true },
    { key: 'descriptionEn', label: 'AdminStatus.description', ar: false }, { key: 'descriptionAr', label: 'AdminStatus.description', ar: true },
  ];
  protected readonly data = signal<FlowsData | null>(null);
  protected readonly sd = signal<StatusData | null>(null);
  protected readonly tab = signal('flows');
  protected readonly flowParam = signal<string | null>(null);
  protected readonly openParam = signal<string | null>(null);
  protected readonly editing = computed(() => this.data()?.flows.find((f) => f.id === this.flowParam()) ?? null);
  protected readonly draft = signal<Draft | null>(null);
  private saved = '';
  protected readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.saved);
  protected readonly cur = signal<string | null>(null);
  protected readonly asking = signal<string | null>(null);
  protected readonly tryS = signal('in_progress');
  protected readonly tryW = signal<'staff' | 'customer'>('staff');
  protected readonly whoDirty = signal(false);
  protected mode: 'type' | 'category' = 'type';
  protected whoTypes: Pickable[] = [];
  protected whoCats: Pickable[] = [];
  protected nw = { nameEn: '', nameAr: '', copyFrom: '' };
  protected lab: Record<string, LabelModel> = {};
  protected rs: Record<string, ReasonModel> = {};
  protected nwReason: ReasonModel = blankReason();
  private std_: Record<string, Record<string, string>> = {};

  protected readonly draftProblems = computed(() => { const d = this.draft(); return d ? problems(d.statuses, d.rows) : []; });
  protected readonly missing = computed(() => STATUSES.filter((s) => !this.draft()?.statuses.includes(s)));
  protected readonly tryMoves = computed(() => (this.draft()?.rows ?? []).filter((r) => r.from === this.tryS() && r.actor === this.tryW()));

  /** Names everywhere come from the language files plus the admin's overrides (Statuses tab). */
  protected readonly staffName = (s: string): string => this.i18n.t('StaffStatus.' + s);
  protected readonly customerName = (s: string): string => this.i18n.t('CustomerStatus.' + (s === 'pending_internal' ? 'in_progress' : s));
  private toneOf(s: string): string { return this.lab[s]?.tone || this.std(s, 'tone') || 'brand'; }
  protected readonly svgTone = (s: string): [string, string] => TONE_SVG[this.toneOf(s)] ?? TONE_SVG['brand'];
  protected chip(s: string): string { return 'inline-flex rounded-full px-3 py-0.5 text-sm font-semibold ' + (TONE_CLASS[this.toneOf(s) as Tone] ?? TONE_CLASS.brand); }
  protected kind(s: string): string { return KIND[s]; }
  protected required(s: string): boolean { return REQUIRED.includes(s); }

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.subscribe((m) => {
      const t = m.get('tab') ?? 'flows';
      this.tab.set(this.tabs.includes(t) ? t : 'flows');
      this.openParam.set(m.get('open'));
      const f = m.get('flow');
      if (f !== this.flowParam()) { this.flowParam.set(f); this.cur.set(null); this.startDraft(); }
    });
    await this.reload();
  }
  protected async reload(): Promise<void> {
    try {
      const [d, s] = await Promise.all([this.api.get<FlowsData>('flows'), this.api.get<StatusData>('status-flow')]);
      const get = (k: string, l: string) => s.labels.find((x) => x.key === k && x.locale === l)?.body ?? '';
      for (const st of s.statuses) {
        this.lab[st] = {
          staffEn: get(`StaffStatus.${st}`, 'en'), staffAr: get(`StaffStatus.${st}`, 'ar'), customerEn: get(`CustomerStatus.${st}`, 'en'), customerAr: get(`CustomerStatus.${st}`, 'ar'),
          descriptionEn: get(`StatusInfo.${st}_desc`, 'en'), descriptionAr: get(`StatusInfo.${st}_desc`, 'ar'), tone: get(`StatusInfo.${st}_tone`, 'en'),
        };
      }
      for (const r of s.reasons) this.rs[r.code] = { nameEn: r.nameEn, nameAr: r.nameAr, customerMayReopen: r.customerMayReopen, isActive: r.isActive, sortOrder: r.sortOrder };
      await this.loadStandard(s.statuses);
      this.mode = d.choice; this.whoTypes = d.types.map((x) => ({ ...x })); this.whoCats = d.categories.map((x) => ({ ...x })); this.whoDirty.set(false);
      this.nw.copyFrom = d.flows.find((f) => f.isDefault)?.id ?? d.flows[0]?.id ?? '';
      this.sd.set(s); this.data.set(d);
      this.startDraft(true);
      await this.site.load();
    } catch (e) { this.fail(e); }
  }
  private async loadStandard(statuses: string[]): Promise<void> {
    const [en, ar] = await Promise.all(['en', 'ar'].map((l) => fetch(`/i18n/${l}.json`).then((r) => r.json() as Promise<Record<string, Record<string, string>>>)));
    for (const s of statuses) {
      this.std_[s] = {
        staffEn: en['StaffStatus']?.[s] ?? '', staffAr: ar['StaffStatus']?.[s] ?? '', customerEn: en['CustomerStatus']?.[s] ?? '', customerAr: ar['CustomerStatus']?.[s] ?? '',
        descriptionEn: en['StatusInfo']?.[s + '_desc'] ?? '', descriptionAr: ar['StatusInfo']?.[s + '_desc'] ?? '', tone: en['StatusInfo']?.[s + '_tone'] ?? 'brand',
      };
    }
  }
  protected std(s: string, k: string): string { return this.std_[s]?.[k] ?? ''; }

  // ---------------------------------------------------------------- flows list
  protected usedBy(id: string): string[] {
    const d = this.data(); if (!d) return [];
    const def = d.flows.find((f) => f.isDefault)?.id;
    return (d.choice === 'type' ? d.types : d.categories).filter((x) => x.isActive && (x.flowId ?? def) === id).map((x) => this.i18n.pick(x.nameEn, x.nameAr));
  }
  protected openCount(f: FlowItem): number { return Object.values(f.openTickets).reduce((a, b) => a + b, 0); }
  protected defaultName(): string { const f = this.data()?.flows.find((x) => x.isDefault); return f ? this.i18n.pick(f.nameEn, f.nameAr) : ''; }
  protected flowsWith(s: string): string { return (this.data()?.flows ?? []).filter((f) => f.statuses.includes(s)).map((f) => this.i18n.pick(f.nameEn, f.nameAr)).join(', ') || '—'; }
  protected async createFlow(box: { open: boolean }): Promise<void> {
    let id = '';
    if (await this.run(async () => { id = (await this.api.post<{ id: string }>('flows', { ...this.nw, copyFrom: this.nw.copyFrom || null })).id; }, 'Flows.created')) {
      box.open = false; this.nw = { nameEn: '', nameAr: '', copyFrom: this.nw.copyFrom };
      void this.router.navigate([], { queryParams: { flow: id } });
    }
  }
  protected async copy(f: FlowItem): Promise<void> {
    const n = (base: string, suffix: string) => { let x = base + suffix, i = 2; while (this.data()!.flows.some((y) => y.nameEn === x || y.nameAr === x)) x = base + suffix + ' ' + i++; return x; };
    let id = '';
    if (await this.run(async () => { id = (await this.api.post<{ id: string }>('flows', { nameEn: n(f.nameEn, ' (copy)'), nameAr: n(f.nameAr, ' (نسخة)'), description: f.description, copyFrom: f.id })).id; }, 'Flows.created'))
      void this.router.navigate([], { queryParams: { flow: id } });
  }
  protected makeDefault(f: FlowItem): void { void this.run(() => this.api.post(`flows/${f.id}/default`, {}), 'Flows.defaultSaved'); }
  protected remove(f: FlowItem): void { this.asking.set(null); void this.run(() => this.api.del('flows/' + f.id), 'AdminV2.deleted'); }

  // ---------------------------------------------------------------- editing a flow (draft, saved with "Save flow")
  private startDraft(keepIfSame = false): void {
    const f = this.editing();
    if (!f) { this.draft.set(null); return; }
    if (keepIfSame && this.draft() && this.dirty()) return;
    const d: Draft = { nameEn: f.nameEn, nameAr: f.nameAr, description: f.description, statuses: STATUSES.filter((s) => f.statuses.includes(s)), rows: f.transitions.map((r) => ({ ...r })) };
    this.saved = JSON.stringify(d); this.draft.set(d);
  }
  protected resetDraft(): void { this.draft.set(JSON.parse(this.saved)); }
  protected patch(p: Partial<Draft>): void { this.draft.update((d) => (d ? { ...d, ...p } : d)); }
  protected openStatus(s: string): void { this.cur.set(s); this.tryS.set(s); setTimeout(() => document.getElementById('status-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  protected closeStatus(): void { this.cur.set(null); }
  protected targets(s: string): string[] { return (this.draft()?.statuses ?? []).filter((t) => t !== s && t !== 'new'); }
  protected movesFrom(s: string): string[] { return [...new Set((this.draft()?.rows ?? []).filter((r) => r.from === s).map((r) => r.to))]; }
  protected has(s: string, t: string, g: string): boolean {
    const rows = this.draft()?.rows ?? [];
    return g === 'reason' ? rows.some((r) => r.from === s && r.to === t && r.requiresReason) : rows.some((r) => r.from === s && r.to === t && r.actor === g);
  }
  protected toggle(s: string, t: string, g: string): void {
    const d = this.draft(); if (!d) return;
    let rows = d.rows;
    if (g === 'reason') { const on = !this.has(s, t, 'reason'); rows = rows.map((r) => (r.from === s && r.to === t ? { ...r, requiresReason: on } : r)); }
    else if (this.has(s, t, g)) rows = rows.filter((r) => !(r.from === s && r.to === t && r.actor === g));
    else rows = [...rows, { from: s, to: t, actor: g as 'staff' | 'customer', requiresReason: this.has(s, t, 'reason') }];
    this.patch({ rows });
  }
  protected addStatus(s: string): void { const d = this.draft(); if (!d || !s) return; this.patch({ statuses: STATUSES.filter((x) => d.statuses.includes(x) || x === s) }); this.openStatus(s); }
  protected dropStatus(s: string): void {
    const d = this.draft(); if (!d || this.required(s)) return;
    const n = this.editing()?.openTickets[s] ?? 0;
    if (!confirm(this.i18n.t(n ? 'Flows.removeConfirmOpen' : 'Flows.removeConfirm', { name: this.staffName(s), n }))) return;
    this.patch({ statuses: d.statuses.filter((x) => x !== s), rows: d.rows.filter((r) => r.from !== s && r.to !== s) });
    if (this.cur() === s) this.cur.set(null);
  }
  protected nextText(s: string, actor: string): string {
    return (this.draft()?.rows ?? []).filter((r) => r.from === s && r.actor === actor).map((r) => this.staffName(r.to) + (r.requiresReason ? ` (${this.i18n.t('Flows.reasonShort')})` : '')).join(', ');
  }
  protected autoFrom(s: string): string {
    return automatic(this.draft()?.statuses ?? []).filter(([f]) => f === s).map(([, t, why]) => `${this.staffName(t)} (${this.i18n.t('Flows.lbl.' + why)})`).join(', ');
  }
  protected summary(s: string): string {
    const list = (a: string) => (this.draft()?.rows ?? []).filter((r) => r.from === s && r.actor === a).map((r) => this.staffName(r.to));
    const st = list('staff'), cu = list('customer');
    const reasons = this.movesFrom(s).filter((t) => this.has(s, t, 'reason')).map((t) => this.staffName(t));
    return [st.length ? this.i18n.t('Flows.sumStaff', { list: st.join(', ') }) : this.i18n.t('Flows.sumStaffNone'),
      cu.length ? this.i18n.t('Flows.sumCustomer', { list: cu.join(', ') }) : this.i18n.t('Flows.sumCustomerNone'),
      reasons.length ? this.i18n.t('Flows.sumReason', { list: reasons.join(', ') }) : ''].filter(Boolean).join(' ');
  }
  protected problemText(p: string): string { const [code, s] = p.split(':'); return this.i18n.t('Flows.problem.' + code, { name: this.staffName(s) }); }
  protected async saveDraft(): Promise<void> {
    const f = this.editing(), d = this.draft(); if (!f || !d) return;
    if (await this.run(() => this.api.put('flows/' + f.id, { nameEn: d.nameEn, nameAr: d.nameAr, description: d.description, statuses: d.statuses, rows: d.rows }), 'Flows.saved')) this.startDraft();
  }

  // ---------------------------------------------------------------- who uses which flow, names, closure reasons
  protected setMode(m: string): void { this.mode = m === 'category' ? 'category' : 'type'; this.whoDirty.set(true); }
  protected saveWho(): void {
    void this.run(() => this.api.put('flow-choice', {
      mode: this.mode, types: this.whoTypes.map((x) => ({ id: x.id, flowId: x.flowId })), categories: this.whoCats.map((x) => ({ id: x.id, flowId: x.flowId })),
    }), 'Flows.whoSaved');
  }
  protected saveLabel(s: string): void { void this.run(() => this.api.put('status-labels/' + s, this.lab[s])); }
  protected resetLabel(s: string): void { void this.run(() => this.api.put('status-labels/' + s, {})); }
  protected saveReason(r: ReasonRow): void { void this.run(() => this.api.put('closure-reasons/' + r.code, this.rs[r.code])); }
  protected deleteReason(r: ReasonRow): void { void this.run(() => this.api.del('closure-reasons/' + r.code), 'AdminV2.deleted'); }
  protected async addReason(box: { open: boolean }): Promise<void> {
    if (await this.run(() => this.api.post('closure-reasons', this.nwReason))) { this.nwReason = blankReason(); box.open = false; }
  }
}
