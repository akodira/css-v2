import { RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, OnInit, WritableSignal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TPipe } from '../../core/i18n';
import { SiteService } from '../../core/api';
import { Alert, Req, TONE_CLASS, Tone } from '../../shared/ui';
import { AdminBase, HEADER, SEARCH } from './admin-pages';

const CHECK = 'flex min-h-11 items-center gap-2';

// ================================================================== ticket status: names, flow, closure reasons

interface FlowRow { from: string; to: string; actor: 'staff' | 'customer'; requiresReason: boolean }
interface ReasonRow { code: string; nameEn: string; nameAr: string; customerMayReopen: boolean; isSystem: boolean; isActive: boolean; sortOrder: number; inUse: boolean }
interface FlowData { statuses: string[]; transitions: FlowRow[]; reasons: ReasonRow[]; labels: { key: string; locale: string; body: string }[] }
interface LabelModel { staffEn: string; staffAr: string; customerEn: string; customerAr: string; descriptionEn: string; descriptionAr: string; tone: string }
type ReasonModel = Omit<ReasonRow, 'code' | 'isSystem' | 'inUse'> & { code?: string };
const blankReason = (): ReasonModel => ({ nameEn: '', nameAr: '', customerMayReopen: true, isActive: true, sortOrder: 100 });

@Component({
  selector: 'app-admin-status',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet, RouterLink],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <section aria-labelledby="guide" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div><h2 id="guide" class="text-lg font-bold">{{ 'StatusGuide.title' | t }}</h2><p class="max-w-prose text-sm text-muted">{{ 'StatusGuide.openHelp' | t }}</p></div>
        <a [routerLink]="'/' + i18n.locale() + '/admin/ticket-status/guide'" class="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'StatusGuide.open' | t }}</a>
      </section>
      <details [class]="cls.card">
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminStatus.howTitle' | t }}</span></summary>
        <ul class="list-disc px-10 pb-5 text-sm leading-relaxed">
          @for (n of [1, 2, 3, 4]; track n) { <li>{{ 'AdminStatus.how' + n | t }}</li> }
        </ul>
      </details>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminStatus.statusesTitle' | t }}</h2>
        <p class="text-muted">{{ 'AdminStatus.statusesHelp' | t }}</p>
        @for (s of data()?.statuses ?? []; track s) {
          <details [class]="cls.card">
            <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-3">
              <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold" [class]="tone(lab[s].tone || std(s, 'tone'))">{{ 'StaffStatus.' + s | t }}</span>
              <span class="text-sm text-muted">{{ 'StatusInfo.' + s + '_desc' | t }}</span></span></summary>
            <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="saveLabel(s)">
              <p class="text-sm text-muted">{{ 'AdminV2.labelHint' | t }}</p>
              <div class="grid gap-4 md:grid-cols-2">
                @for (f of labelFields; track f.key) {
                  <div class="flex flex-col gap-1.5"><label [for]="s + f.key" [class]="cls.label">{{ f.label | t }} ({{ (f.ar ? 'AdminStatus.arSuffix' : 'AdminStatus.enSuffix') | t }})</label>
                    <input [id]="s + f.key" [name]="f.key" [attr.dir]="f.ar ? 'rtl' : 'ltr'" maxlength="500" [class]="cls.input" [placeholder]="std(s, f.key)" [(ngModel)]="$any(lab[s])[f.key]" /></div>
                }
                <div class="flex flex-col gap-1.5"><label [for]="s + 'tone'" [class]="cls.label">{{ 'AdminStatus.color' | t }}</label>
                  <select [id]="s + 'tone'" name="tone" [class]="cls.input" [(ngModel)]="lab[s].tone">
                    <option value="">{{ 'AdminStatus.reset' | t }} ({{ 'AdminStatus.colors.' + std(s, 'tone') | t }})</option>
                    @for (c of tones; track c) { <option [value]="c">{{ 'AdminStatus.colors.' + c | t }}</option> }
                  </select></div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.save' | t }}</button>
                <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="resetLabel(s)">{{ 'AdminStatus.reset' | t }}</button>
              </div>
            </form>
          </details>
        }
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminStatus.flowTitle' | t }}</h2>
        <p class="text-muted">{{ 'AdminStatus.flowHelp.generic.items.0' | t }}</p>
        @if (problems().length) {
          <div role="alert" class="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"><p class="font-bold">{{ 'AdminStatus.problemsTitle' | t }}</p>
            <ul class="list-disc ps-5">@for (p of problems(); track p) { <li>{{ p }}</li> }</ul></div>
        }
        <div class="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table class="w-full min-w-[40rem] text-sm">
            <thead class="bg-chrome text-white"><tr>
              <th scope="col" class="px-4 py-3 text-start">{{ 'AdminStatus.from' | t }}</th><th scope="col" class="px-4 py-3 text-start">{{ 'AdminStatus.to' | t }}</th>
              <th scope="col" class="px-4 py-3">{{ 'AdminStatus.colStaff' | t }}</th><th scope="col" class="px-4 py-3">{{ 'AdminStatus.colCustomer' | t }}</th><th scope="col" class="px-4 py-3">{{ 'AdminStatus.colReason' | t }}</th>
            </tr></thead>
            <tbody>
              @for (pair of pairs(); track pair.from + pair.to) {
                <tr class="border-b border-line" [class.bg-bg]="pair.first">
                  <th scope="row" class="px-4 py-2 text-start font-semibold">@if (pair.first) { {{ 'StaffStatus.' + pair.from | t }} }</th>
                  <td class="px-4 py-2">{{ 'StaffStatus.' + pair.to | t }}</td>
                  <td class="px-4 py-2 text-center"><input type="checkbox" class="h-5 w-5" [attr.aria-label]="label(pair, 'AdminStatus.colStaff')" [checked]="has(pair, 'staff')" (change)="set(pair, 'staff')" /></td>
                  <td class="px-4 py-2 text-center"><input type="checkbox" class="h-5 w-5" [attr.aria-label]="label(pair, 'AdminStatus.colCustomer')" [checked]="has(pair, 'customer')" (change)="set(pair, 'customer')" /></td>
                  <td class="px-4 py-2 text-center"><input type="checkbox" class="h-5 w-5" [attr.aria-label]="label(pair, 'AdminStatus.colReason')" [disabled]="!has(pair, 'staff') && !has(pair, 'customer')" [checked]="reason(pair)" (change)="setReason(pair)" /></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" [class]="cls.btn" [disabled]="busy() || problems().length > 0" (click)="saveFlow()">{{ 'AdminStatus.flowSave' | t }}</button>
          @if (dirty()) { <span class="text-sm font-semibold text-warn-ink">{{ 'AdminStatus.unsaved' | t }}</span> }
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminStatus.closureTitle' | t }}</h2>
        <p class="text-muted">{{ 'AdminStatus.closureHelp' | t }}</p>
        <ng-template #reasonForm let-m="m" let-id="id" let-system="system">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'AdminStatus.reasonNameEn' | t }}<app-req /></span></label>
              <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'AdminStatus.reasonNameAr' | t }}<app-req /></span></label>
              <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
          </div>
          <div class="flex flex-wrap gap-x-6">
            <label class="${CHECK}"><input type="checkbox" [name]="id + 'mr'" class="h-5 w-5" [(ngModel)]="m.customerMayReopen" /> {{ 'AdminStatus.mayReopen' | t }}</label>
            <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" [disabled]="system" /> {{ 'AdminStatus.active' | t }}</label>
          </div>
        </ng-template>
        <ul class="flex flex-col gap-2">
          @for (r of data()?.reasons ?? []; track r.code) {
            <li><details [class]="cls.card">
              <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-2"><span class="font-bold" dir="auto">{{ i18n.pick(r.nameEn, r.nameAr) }}</span>
                @if (r.isSystem) { <span [class]="cls.badgeOff">{{ 'AdminStatus.builtIn' | t }}</span> }
                @if (!r.isActive) { <span [class]="cls.badgeOff">{{ 'AdminCatalog.inactive' | t }}</span> }</span></summary>
              <form class="flex flex-col gap-3 px-5 pb-5" (ngSubmit)="saveReason(r)">
                <ng-container *ngTemplateOutlet="reasonForm; context: { m: rs[r.code], id: 'r' + r.code, system: r.isSystem }" />
                <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.reasonSave' | t }}</button>
                  @if (!r.isSystem && !r.inUse) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="deleteReason(r)">{{ 'Directory.delete' | t }}</button> }</div>
              </form>
            </details></li>
          }
        </ul>
        <details [class]="cls.card" #addr>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminStatus.reasonAddTitle' | t }}</span></summary>
          <form class="flex flex-col gap-3 px-5 pb-5" (ngSubmit)="addReason(addr)">
            <ng-container *ngTemplateOutlet="reasonForm; context: { m: nwReason, id: 'nr', system: false }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminStatus.reasonAdd' | t }}</button></div>
          </form>
        </details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminStatusPage extends AdminBase implements OnInit {
  private readonly site = inject(SiteService);
  protected readonly title = 'AdminStatus.title';
  protected readonly subtitle = 'AdminStatus.subtitle';
  protected readonly tones = ['brand', 'warn', 'ok', 'danger', 'muted'];
  protected readonly labelFields = [
    { key: 'staffEn', label: 'AdminStatus.staffName', ar: false }, { key: 'staffAr', label: 'AdminStatus.staffName', ar: true },
    { key: 'customerEn', label: 'AdminStatus.customerName', ar: false }, { key: 'customerAr', label: 'AdminStatus.customerName', ar: true },
    { key: 'descriptionEn', label: 'AdminStatus.description', ar: false }, { key: 'descriptionAr', label: 'AdminStatus.description', ar: true },
  ];
  protected readonly data = signal<FlowData | null>(null);
  protected readonly flow = signal<FlowRow[]>([]);
  protected readonly dirty = signal(false);
  protected lab: Record<string, LabelModel> = {};
  protected rs: Record<string, ReasonModel> = {};
  protected nwReason: ReasonModel = blankReason();
  private std_: Record<string, Record<string, string>> = {};

  /** Every from→to pair, grouped by the from status. */
  protected readonly pairs = computed(() => {
    const st = this.data()?.statuses ?? [];
    return st.flatMap((from) => st.filter((to) => to !== from && to !== 'new').map((to, i) => ({ from, to, first: i === 0 })));
  });

  /** The safety checks of the old screen: every status reachable, and Resolved reachable by staff. */
  protected readonly problems = computed(() => {
    const rows = this.flow(); const st = this.data()?.statuses ?? [];
    const name = (s: string) => this.i18n.t('StaffStatus.' + s);
    const out: string[] = [];
    for (const s of st) if (s !== 'new' && !rows.some((r) => r.to === s)) out.push(this.i18n.t('AdminStatus.problem_unreachable', { name: name(s) }));
    const reach = (from: string, target: string, actor?: string) => {
      const seen = new Set([from]); const q = [from];
      while (q.length) { const x = q.shift()!; if (x === target) return true; for (const r of rows) if (r.from === x && (!actor || r.actor === actor) && !seen.has(r.to)) { seen.add(r.to); q.push(r.to); } }
      return false;
    };
    for (const s of ['new', 'open', 'in_progress', 'reopened']) if (st.includes(s) && !reach(s, 'resolved', 'staff')) out.push(this.i18n.t('AdminStatus.problem_no_resolve', { name: name(s) }));
    return out;
  });

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<FlowData>('status-flow');
      const get = (k: string, l: string) => d.labels.find((x) => x.key === k && x.locale === l)?.body ?? '';
      for (const s of d.statuses) {
        this.lab[s] = {
          staffEn: get(`StaffStatus.${s}`, 'en'), staffAr: get(`StaffStatus.${s}`, 'ar'), customerEn: get(`CustomerStatus.${s}`, 'en'), customerAr: get(`CustomerStatus.${s}`, 'ar'),
          descriptionEn: get(`StatusInfo.${s}_desc`, 'en'), descriptionAr: get(`StatusInfo.${s}_desc`, 'ar'), tone: get(`StatusInfo.${s}_tone`, 'en'),
        };
      }
      for (const r of d.reasons) this.rs[r.code] = { nameEn: r.nameEn, nameAr: r.nameAr, customerMayReopen: r.customerMayReopen, isActive: r.isActive, sortOrder: r.sortOrder };
      await this.loadStandard(d.statuses);
      this.flow.set(d.transitions.map((r) => ({ ...r })));
      this.dirty.set(false);
      this.data.set(d);
      await this.site.load();                         // new names show everywhere at once
    } catch (e) { this.fail(e); }
  }
  /** The built-in texts (from the language files), shown as placeholders. */
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
  protected tone(t: string): string { return TONE_CLASS[t as Tone] ?? TONE_CLASS.brand; }
  protected label(p: { from: string; to: string }, col: string): string { return `${this.i18n.t('StaffStatus.' + p.from)} → ${this.i18n.t('StaffStatus.' + p.to)}: ${this.i18n.t(col)}`; }
  protected has(p: { from: string; to: string }, actor: string): boolean { return this.flow().some((r) => r.from === p.from && r.to === p.to && r.actor === actor); }
  protected reason(p: { from: string; to: string }): boolean { return this.flow().some((r) => r.from === p.from && r.to === p.to && r.requiresReason); }
  protected set(p: { from: string; to: string }, actor: 'staff' | 'customer'): void {
    const rows = this.flow();
    const req = this.reason(p);
    this.flow.set(this.has(p, actor) ? rows.filter((r) => !(r.from === p.from && r.to === p.to && r.actor === actor)) : [...rows, { from: p.from, to: p.to, actor, requiresReason: req }]);
    this.dirty.set(true);
  }
  protected setReason(p: { from: string; to: string }): void {
    const on = !this.reason(p);
    this.flow.set(this.flow().map((r) => (r.from === p.from && r.to === p.to ? { ...r, requiresReason: on } : r)));
    this.dirty.set(true);
  }
  protected saveFlow(): void { void this.run(() => this.api.put('status-flow', { rows: this.flow() }), 'AdminStatus.flowSaved'); }
  protected saveLabel(s: string): void { void this.run(() => this.api.put('status-labels/' + s, this.lab[s])); }
  protected resetLabel(s: string): void { void this.run(() => this.api.put('status-labels/' + s, {})); }
  protected saveReason(r: ReasonRow): void { void this.run(() => this.api.put('closure-reasons/' + r.code, this.rs[r.code])); }
  protected deleteReason(r: ReasonRow): void { void this.run(() => this.api.del('closure-reasons/' + r.code), 'AdminV2.deleted'); }
  protected async addReason(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('closure-reasons', this.nwReason))) { this.nwReason = blankReason(); box.open = false; }
  }
}

// ================================================================== escalation

interface EscOrg { id: string; name: string; parentId: string | null; isActive: boolean; mode: string; leader: string | null }
interface EscBranch { id: string; organizationId: string; name: string; isActive: boolean; mode: string | null; leader: string | null }

@Component({
  selector: 'app-admin-escalation',
  imports: [TPipe, Alert],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Escalation.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Escalation.subtitle' | t }}</p></div>
      <section [class]="card" aria-labelledby="modes">
        <h2 id="modes" class="mb-1 text-xl font-bold">{{ 'Escalation.modesTitle' | t }}</h2>
        <p class="mb-4 text-sm text-muted">{{ 'Escalation.modesHelp' | t }}</p>
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-bg">
              <input type="checkbox" class="h-5 w-5" [checked]="allOn()" (change)="selOrg.set(allOn() ? [] : active().map((o) => o.id))" />{{ 'Escalation.allOrgs' | t }}</label>
            <input type="search" dir="auto" [value]="q()" (input)="q.set($any($event.target).value)" [placeholder]="'Escalation.search' | t" [attr.aria-label]="'Escalation.search' | t" [class]="cls.input + ' max-w-xs'" />
            <span class="text-sm text-muted">{{ 'Escalation.selected' | t: { n: selOrg().length + selBr().length } }}</span>
          </div>
          <ul class="flex max-h-[28rem] flex-col gap-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
            @for (o of shown(); track o.id) {
              @let kids = branchesOf2(o.id);
              @let isOpen = open().includes(o.id) || (needle() !== '' && hasBranchMatch(o.id));
              <li>
                <div class="flex items-center gap-1">
                  <label class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-bg">
                    <input type="checkbox" class="h-5 w-5" [checked]="selOrg().includes(o.id)" (change)="flip(selOrg, o.id)" />
                    <span class="min-w-0 flex-1" dir="auto"><span class="font-semibold">{{ o.name }}</span>@if (o.leader) { <span class="block truncate text-xs text-muted">{{ o.leader }}</span> }</span>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" [class]="badge(o.mode)">{{ 'Escalation.mode_' + o.mode + '_short' | t }}</span>
                  </label>
                  @if (kids.length) {
                    <button type="button" [attr.aria-expanded]="isOpen" (click)="flip(open, o.id)" class="min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-semibold text-brand hover:bg-bg">{{ 'Escalation.branchesN' | t: { n: kids.length } }} {{ isOpen ? '▴' : '▾' }}</button>
                  }
                </div>
                @if (isOpen) {
                  <ul class="ms-8 border-s border-line ps-2">
                    @for (b of kids; track b.id) {
                      @if (!needle() || o.name.toLowerCase().includes(needle()) || b.name.toLowerCase().includes(needle())) {
                        <li><label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-bg">
                          <input type="checkbox" class="h-5 w-5" [checked]="selBr().includes(b.id)" (change)="flip(selBr, b.id)" />
                          <span class="min-w-0 flex-1 truncate" dir="auto">{{ b.name }}</span>
                          @if (b.mode) { <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" [class]="badge(b.mode)">{{ 'Escalation.mode_' + b.mode + '_short' | t }}</span> }
                          @else { <span class="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{{ 'Escalation.mode_inherit_short' | t }}</span> }
                        </label></li>
                      }
                    }
                  </ul>
                }
              </li>
            }
          </ul>
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-1 text-sm font-semibold">{{ 'Escalation.applyMode' | t }}</legend>
            @for (m of modes; track m) {
              <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="mode" class="mt-1 h-5 w-5 accent-[var(--brand)]" [checked]="mode() === m" (change)="mode.set(m)" />
                <span><span class="block font-semibold">{{ 'Escalation.mode_' + m | t }}</span><span class="block text-sm text-muted">{{ 'Escalation.mode_' + m + '_help' | t }}</span></span>
              </label>
            }
          </fieldset>
          @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
          <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="apply()">{{ count() ? ('Escalation.applyTo' | t: { n: count() }) : ('Escalation.applyNone' | t) }}</button></div>
        </div>
      </section>
      <section [class]="card" aria-labelledby="chain">
        <h2 id="chain" class="mb-1 text-xl font-bold">{{ 'Escalation.chainTitle' | t }}</h2>
        <p class="mb-4 text-sm text-muted">{{ 'Escalation.chainHelp' | t }}</p>
        <ol class="flex flex-wrap items-stretch gap-y-3">
          @for (st of steps(); track $index; let last = $last) {
            <li class="flex items-stretch">
              <div class="flex w-40 flex-col rounded-xl border-2 p-3" [class]="$first ? 'border-brand bg-brand-soft' : 'border-line bg-surface'">
                <p class="font-bold leading-tight" dir="auto">{{ st.title }}</p><p class="mt-1 text-sm text-muted" dir="auto">{{ st.sub }}</p>
              </div>
              @if (!last) { <span aria-hidden="true" class="flex w-5 shrink-0 items-center justify-center text-xl text-brand rtl:rotate-180">›</span> }
            </li>
          }
        </ol>
      </section>
      <section [class]="card" aria-labelledby="how">
        <h2 id="how" class="mb-2 text-xl font-bold">{{ 'Escalation.howTitle' | t }}</h2>
        <ol class="list-decimal space-y-2 ps-5 text-muted">@for (n of [1, 2, 3, 4, 5, 6, 7]; track n) { <li>{{ 'Escalation.how' + n | t }}</li> }</ol>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminEscalationPage extends AdminBase implements OnInit {
  protected readonly card = 'rounded-xl border border-line bg-surface p-5 shadow-card';
  protected readonly modes = ['any', 'next', 'off', 'inherit'];
  protected readonly data = signal<{ orgs: EscOrg[]; branches: EscBranch[] } | null>(null);
  protected readonly mode = signal('any');
  protected readonly selOrg = signal<string[]>([]);
  protected readonly selBr = signal<string[]>([]);
  protected readonly open = signal<string[]>([]);
  protected readonly needle = computed(() => this.q().trim().toLowerCase());
  /** Active organizations, v1 order (Postgres collation). */
  protected readonly active = computed(() => (this.data()?.orgs ?? []).filter((o) => o.isActive).sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly shown = computed(() => this.active().filter((o) => !this.needle() || o.name.toLowerCase().includes(this.needle()) || this.hasBranchMatch(o.id)));
  protected readonly allOn = computed(() => this.active().length > 0 && this.selOrg().length === this.active().length);
  protected readonly count = computed(() => (this.mode() === 'inherit' ? 0 : this.selOrg().length) + this.selBr().length);
  /** v1 ChainPreview: Agent → Branch leader → each level of the deepest organization tree, bottom up. */
  protected readonly steps = computed(() => {
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t('Escalation.' + k, p);
    const orgs = this.active();
    const kids = new Map<string, string[]>();
    for (const o of orgs) if (o.parentId) kids.set(o.parentId, [...(kids.get(o.parentId) ?? []), o.id]);
    const depth = (id: string): number => 1 + Math.max(0, ...(kids.get(id) ?? []).map(depth));
    const root = orgs.filter((o) => !o.parentId && kids.has(o.id)).sort((a, b) => depth(b.id) - depth(a.id) || a.name.localeCompare(b.name))[0];
    const steps = [{ title: t('stepAgent'), sub: t('stepAgentHint') }, { title: t('stepBranch'), sub: t('stepBranchHint') }];
    if (root) {
      let layer = [root.id];
      const layers: string[][] = [];
      while (layer.length) { layers.push(layer); layer = layer.flatMap((id) => kids.get(id) ?? []); }
      for (const ids of layers.slice().reverse()) {
        const names = ids.map((id) => orgs.find((o) => o.id === id)?.name ?? '?');
        const leaders = [...new Set(ids.map((id) => orgs.find((o) => o.id === id)?.leader).filter((x): x is string => !!x))];
        steps.push({ title: t('stepLevel', { name: names.length > 3 ? `${names.slice(0, 3).join(' / ')} …` : names.join(' / ') }), sub: leaders.join(', ') || t('noLeader') });
      }
    }
    return steps;
  });

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try { this.data.set(await this.api.get('escalation')); this.selOrg.set([]); this.selBr.set([]); } catch (e) { this.fail(e); }
  }
  protected branchesOf2(org: string): EscBranch[] { return (this.data()?.branches ?? []).filter((b) => b.organizationId === org && b.isActive).sort((a, b) => a.name.localeCompare(b.name)); }
  protected hasBranchMatch(org: string): boolean { return this.branchesOf2(org).some((b) => b.name.toLowerCase().includes(this.needle())); }
  protected flip(sig: WritableSignal<string[]>, id: string): void { sig.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  protected badge(m: string): string { return m === 'off' ? 'bg-bg text-muted' : m === 'next' ? 'bg-warn-soft text-warn-ink' : 'bg-ok-soft text-ok'; }
  protected apply(): void {
    const m = this.mode();
    const orgIds = m === 'inherit' ? [] : this.selOrg();
    void this.run(() => this.api.put('escalation', { mode: m, organizationIds: orgIds, branchIds: this.selBr() }));
  }
}

// ================================================================== knowledge base (admin)

interface KbCat { id: string; slug: string; nameEn: string; nameAr: string; sortOrder: number; isActive: boolean }
interface KbArt { id: string; categoryId: string | null; slug: string; titleEn: string; titleAr: string | null; bodyEn: string; bodyAr: string | null; status: string; visibility: string; helpfulCount: number; notHelpfulCount: number; updatedAt: string }
type CatModel = Omit<KbCat, 'id'>;
type ArtModel = Omit<KbArt, 'id' | 'helpfulCount' | 'notHelpfulCount' | 'updatedAt'>;
const blankKbCat = (): CatModel => ({ slug: '', nameEn: '', nameAr: '', sortOrder: 0, isActive: true });
const blankArt = (): ArtModel => ({ categoryId: null, slug: '', titleEn: '', titleAr: '', bodyEn: '', bodyAr: '', status: 'draft', visibility: 'customers' });

@Component({
  selector: 'app-admin-kb',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminKb.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminKb.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <ng-template #catForm let-m="m" let-id="id" let-isNew="isNew">
        <form [class]="formCls" novalidate (ngSubmit)="isNew ? createCat() : updateCat(id)">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.slug' | t }}<app-req /></span><input name="sl" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="m.slug" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.sort' | t }}<input name="so" type="number" min="0" [class]="cls.input + ' font-normal'" [(ngModel)]="m.sortOrder" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.nameEn' | t }}<app-req /></span><input name="en" dir="ltr" maxlength="120" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.nameAr' | t }}<app-req /></span><input name="ar" dir="rtl" maxlength="120" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameAr" /></label>
          </div>
          <label class="${CHECK}"><input type="checkbox" name="ac" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminKb.active' | t }}</label>
          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (isNew ? 'AdminKb.addCategory' : 'AdminKb.save') | t }}</button></div>
        </form>
      </ng-template>
      <ng-template #artForm let-m="m" let-id="id" let-isNew="isNew">
        <div class="flex flex-col gap-3">
          <form [class]="formCls" novalidate (ngSubmit)="isNew ? createArt() : updateArt(id)">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.slug' | t }}<app-req /></span><input name="sl" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="m.slug" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.category' | t }}
                <select name="ca" [class]="cls.input + ' font-normal'" [(ngModel)]="m.categoryId"><option [ngValue]="null">{{ 'AdminKb.noCategory' | t }}</option>@for (c of data()?.categories ?? []; track c.id) { <option [ngValue]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.statusLabel' | t }}
                <select name="st" [class]="cls.input + ' font-normal'" [(ngModel)]="m.status">@for (x of ['draft', 'published', 'archived']; track x) { <option [value]="x">{{ 'AdminKb.status.' + x | t }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.visibilityLabel' | t }}
                <select name="vi" [class]="cls.input + ' font-normal'" [(ngModel)]="m.visibility">@for (x of ['public', 'customers', 'internal']; track x) { <option [value]="x">{{ 'AdminKb.visibility.' + x | t }}</option> }</select></label>
            </div>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.titleEn' | t }}<app-req /></span><input name="te" dir="ltr" maxlength="200" [class]="cls.input + ' font-normal'" [(ngModel)]="m.titleEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.titleAr' | t }}<input name="ta" dir="rtl" maxlength="200" [class]="cls.input + ' font-normal'" [(ngModel)]="m.titleAr" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.bodyEn' | t }}<app-req /></span><textarea name="be" rows="8" dir="ltr" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.bodyEn"></textarea></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.bodyAr' | t }}<textarea name="ba" rows="8" dir="rtl" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.bodyAr"></textarea></label>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (isNew ? 'AdminKb.addArticle' : 'AdminKb.save') | t }}</button></div>
          </form>
          @if (!isNew) { <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="del('kb-articles/' + id)">{{ 'AdminKb.delete' | t }}</button></div> }
        </div>
      </ng-template>

      <section aria-labelledby="cats" class="flex flex-col gap-3"><h2 id="cats" class="text-xl font-bold">{{ 'AdminKb.categories' | t }}</h2>
        @for (c of data()?.categories ?? []; track c.id) {
          <details [class]="box"><summary [class]="sum">{{ i18n.pick(c.nameEn, c.nameAr) }} <span dir="ltr" class="text-sm font-normal text-muted">({{ c.slug }}@if (!c.isActive) {, {{ 'AdminKb.inactive' | t }} })</span></summary>
            <div class="p-3"><ng-container *ngTemplateOutlet="catForm; context: { m: ec[c.id], id: c.id, isNew: false }" /></div></details>
        }
        <details [class]="box"><summary [class]="sum">{{ 'AdminKb.addCategory' | t }}</summary><div class="p-3"><ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'new', isNew: true }" /></div></details>
      </section>
      <section aria-labelledby="arts" class="flex flex-col gap-3"><h2 id="arts" class="text-xl font-bold">{{ 'AdminKb.articles' | t }}</h2>
        @if (data() && !data()!.articles.length) { <p class="text-muted">{{ 'AdminKb.noArticles' | t }}</p> }
        @for (a of data()?.articles ?? []; track a.id) {
          <details [class]="box"><summary [class]="sum" dir="auto">{{ a.titleEn }} <span class="text-sm font-normal text-muted">({{ 'AdminKb.status.' + a.status | t }}, {{ a.helpfulCount }}/{{ a.notHelpfulCount }})</span></summary>
            <div class="p-3"><ng-container *ngTemplateOutlet="artForm; context: { m: ea[a.id], id: a.id, isNew: false }" /></div></details>
        }
        <details [class]="box"><summary [class]="sum">{{ 'AdminKb.addArticle' | t }}</summary><div class="p-3"><ng-container *ngTemplateOutlet="artForm; context: { m: nwArt, id: 'new', isNew: true }" /></div></details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminKbPage extends AdminBase implements OnInit {
  protected readonly formCls = 'flex flex-col gap-4 rounded-md border border-line bg-surface p-5';
  protected readonly box = 'rounded-md border border-line bg-surface';
  protected readonly sum = 'min-h-11 cursor-pointer px-5 py-3 font-semibold';
  protected readonly data = signal<{ categories: KbCat[]; articles: KbArt[] } | null>(null);
  protected readonly arts = computed(() => (this.data()?.articles ?? []).filter((a) => this.matches(a.titleEn, a.titleAr, a.slug)));
  protected nwArt: ArtModel = blankArt();
  protected nwCat: CatModel = blankKbCat();
  protected ea: Record<string, ArtModel> = {};
  protected ec: Record<string, CatModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<{ categories: KbCat[]; articles: KbArt[] }>('kb');
      for (const a of d.articles) this.ea[a.id] = { categoryId: a.categoryId, slug: a.slug, titleEn: a.titleEn, titleAr: a.titleAr ?? '', bodyEn: a.bodyEn, bodyAr: a.bodyAr ?? '', status: a.status, visibility: a.visibility };
      for (const c of d.categories) this.ec[c.id] = { slug: c.slug, nameEn: c.nameEn, nameAr: c.nameAr, sortOrder: c.sortOrder, isActive: c.isActive };
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected async createArt(): Promise<void> { if (await this.run(() => this.api.post('kb-articles', this.nwArt))) this.nwArt = blankArt(); }
  protected updateArt(id: string): void { void this.run(() => this.api.put('kb-articles/' + id, this.ea[id])); }
  protected async createCat(): Promise<void> { if (await this.run(() => this.api.post('kb-categories', this.nwCat))) this.nwCat = blankKbCat(); }
  protected updateCat(id: string): void { void this.run(() => this.api.put('kb-categories/' + id, this.ec[id])); }
  protected del(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
