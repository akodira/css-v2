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
            <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'AdminStatus.reasonNameEn' | t }}<app-req /></label>
              <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'AdminStatus.reasonNameAr' | t }}<app-req /></label>
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
      ${HEADER}
      <details [class]="cls.card">
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Escalation.howTitle' | t }}</span></summary>
        <ul class="list-disc px-10 pb-5 text-sm leading-relaxed">@for (n of [1, 2, 3, 4, 5, 6, 7]; track n) { <li>{{ 'Escalation.how' + n | t }}</li> }</ul>
      </details>

      <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
        <h2 class="text-lg font-bold">{{ 'Escalation.modesTitle' | t }}</h2>
        <p class="text-sm text-muted">{{ 'Escalation.modesHelp' | t }}</p>
        <fieldset class="flex flex-col gap-1"><legend [class]="cls.label">{{ 'Escalation.applyMode' | t }}</legend>
          @for (m of modes; track m) {
            <label class="flex items-start gap-2"><input type="radio" name="mode" class="mt-1 h-5 w-5" [checked]="mode() === m" (change)="mode.set(m)" />
              <span><span class="font-semibold">{{ 'Escalation.mode_' + m | t }}</span> <span class="text-sm text-muted">{{ 'Escalation.mode_' + m + '_help' | t }}</span></span></label>
          }
        </fieldset>
        <div><button type="button" [class]="cls.btn" [disabled]="busy() || !count()" (click)="apply()">{{ count() ? ('Escalation.applyTo' | t: { n: count() }) : ('Escalation.applyNone' | t) }}</button></div>
      </section>

      ${SEARCH}
      <ul class="flex flex-col gap-2">
        @for (o of orgs(); track o.id) {
          <li [class]="cls.card + ' p-4'">
            <label class="flex flex-wrap items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="selOrg().has(o.id)" (change)="flip(selOrg, o.id)" />
              <span class="font-bold" dir="auto">{{ o.name }}</span>
              <span [class]="badge(o.mode)">{{ 'Escalation.mode_' + o.mode + '_short' | t }}</span>
              <span class="text-sm text-muted">· {{ o.leader || ('Escalation.noLeader' | t) }}</span></label>
            @if (escBranches(o.id).length) {
              <ul class="ms-7 mt-2 flex flex-col gap-1">
                @for (b of escBranches(o.id); track b.id) {
                  <li><label class="flex flex-wrap items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" [checked]="selBranch().has(b.id)" (change)="flip(selBranch, b.id)" />
                    <span dir="auto">{{ b.name }}</span>
                    <span [class]="badge(b.mode ?? 'inherit')">{{ 'Escalation.mode_' + (b.mode ?? 'inherit') + '_short' | t }}</span>
                    <span class="text-muted">· {{ b.leader || ('Escalation.noLeader' | t) }}</span></label></li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminEscalationPage extends AdminBase implements OnInit {
  protected readonly title = 'Escalation.title';
  protected readonly subtitle = 'Escalation.subtitle';
  protected readonly modes = ['any', 'next', 'off', 'inherit'];
  protected readonly data = signal<{ orgs: EscOrg[]; branches: EscBranch[] } | null>(null);
  protected readonly mode = signal('any');
  protected readonly selOrg = signal(new Set<string>());
  protected readonly selBranch = signal(new Set<string>());
  protected readonly count = computed(() => this.selOrg().size + this.selBranch().size);
  protected readonly orgs = computed(() => (this.data()?.orgs ?? []).filter((o) => this.matches(o.name, ...this.escBranches(o.id).map((b) => b.name))));

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try { this.data.set(await this.api.get('escalation')); this.selOrg.set(new Set()); this.selBranch.set(new Set()); } catch (e) { this.fail(e); }
  }
  protected escBranches(org: string): EscBranch[] { return (this.data()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected flip(sig: WritableSignal<Set<string>>, id: string): void { const s = new Set(sig()); if (s.has(id)) s.delete(id); else s.add(id); sig.set(s); }
  protected badge(m: string): string { return m === 'off' ? this.cls.badgeOff : m === 'inherit' ? this.cls.badgeWarn : this.cls.badgeOn; }
  protected apply(): void {
    const m = this.mode();
    const orgIds = m === 'inherit' ? [] : [...this.selOrg()];
    void this.run(() => this.api.put('escalation', { mode: m, organizationIds: orgIds, branchIds: [...this.selBranch()] }));
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
      ${HEADER}
      <ng-template #catForm let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'AdminKb.nameEn' | t }}<app-req /></label>
            <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'AdminKb.nameAr' | t }}<app-req /></label>
            <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'sl'" [class]="cls.label">{{ 'AdminKb.slug' | t }}</label>
            <input [id]="id + 'sl'" [name]="id + 'sl'" dir="ltr" maxlength="80" [class]="cls.input + ' font-mono'" [(ngModel)]="m.slug" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminKb.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminKb.active' | t }}</label>
        </div>
      </ng-template>
      <ng-template #artForm let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'te'" [class]="cls.label">{{ 'AdminKb.titleEn' | t }}<app-req /></label>
            <input [id]="id + 'te'" [name]="id + 'te'" dir="ltr" required maxlength="200" [class]="cls.input" [(ngModel)]="m.titleEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ta'" [class]="cls.label">{{ 'AdminKb.titleAr' | t }}</label>
            <input [id]="id + 'ta'" [name]="id + 'ta'" dir="rtl" maxlength="200" [class]="cls.input" [(ngModel)]="m.titleAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ca'" [class]="cls.label">{{ 'AdminKb.category' | t }}</label>
            <select [id]="id + 'ca'" [name]="id + 'ca'" [class]="cls.input" [(ngModel)]="m.categoryId">
              <option [ngValue]="null">{{ 'AdminKb.noCategory' | t }}</option>
              @for (c of data()?.categories ?? []; track c.id) { <option [ngValue]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'sl'" [class]="cls.label">{{ 'AdminKb.slug' | t }}</label>
            <input [id]="id + 'sl'" [name]="id + 'sl'" dir="ltr" maxlength="80" [class]="cls.input + ' font-mono'" [(ngModel)]="m.slug" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'st'" [class]="cls.label">{{ 'AdminKb.statusLabel' | t }}</label>
            <select [id]="id + 'st'" [name]="id + 'st'" [class]="cls.input" [(ngModel)]="m.status">
              @for (s of ['draft', 'published', 'archived']; track s) { <option [value]="s">{{ 'AdminKb.status.' + s | t }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'vi'" [class]="cls.label">{{ 'AdminKb.visibilityLabel' | t }}</label>
            <select [id]="id + 'vi'" [name]="id + 'vi'" [class]="cls.input" [(ngModel)]="m.visibility">
              @for (s of ['public', 'customers', 'internal']; track s) { <option [value]="s">{{ 'AdminKb.visibility.' + s | t }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'be'" [class]="cls.label">{{ 'AdminKb.bodyEn' | t }}<app-req /></label>
            <textarea [id]="id + 'be'" [name]="id + 'be'" rows="8" dir="ltr" required [class]="cls.input + ' py-2'" [(ngModel)]="m.bodyEn"></textarea></div>
          <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'ba'" [class]="cls.label">{{ 'AdminKb.bodyAr' | t }}</label>
            <textarea [id]="id + 'ba'" [name]="id + 'ba'" rows="8" dir="rtl" [class]="cls.input + ' py-2'" [(ngModel)]="m.bodyAr"></textarea></div>
        </div>
      </ng-template>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminKb.articles' | t }}</h2>
        <details [class]="cls.card" #adda>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminKb.addArticle' | t }}</span></summary>
          <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="createArt(adda)">
            <ng-container *ngTemplateOutlet="artForm; context: { m: nwArt, id: 'na' }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </details>
        ${SEARCH}
        @if (data() && !arts().length) { <p class="text-muted">{{ 'AdminKb.noArticles' | t }}</p> }
        <ul class="flex flex-col gap-2">
          @for (a of arts(); track a.id) {
            <li><details [class]="cls.card">
              <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-2"><span class="font-bold" dir="auto">{{ i18n.pick(a.titleEn, a.titleAr) }}</span>
                <span [class]="a.status === 'published' ? cls.badgeOn : a.status === 'draft' ? cls.badgeWarn : cls.badgeOff">{{ 'AdminKb.status.' + a.status | t }}</span>
                <span class="text-sm text-muted">{{ 'AdminKb.visibility.' + a.visibility | t }} · 👍 {{ a.helpfulCount }} · 👎 {{ a.notHelpfulCount }} · {{ i18n.date(a.updatedAt) }}</span></span></summary>
              <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="updateArt(a)">
                <ng-container *ngTemplateOutlet="artForm; context: { m: ea[a.id], id: 'a' + a.id }" />
                <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminKb.save' | t }}</button>
                  @if (a.status === 'published') { <a [href]="'/' + i18n.locale() + '/kb/' + a.slug" target="_blank" rel="noopener" [class]="cls.btn2 + ' inline-flex items-center'">{{ 'AdminV2.view' | t }}</a> }
                  <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="del('kb-articles/' + a.id)">{{ 'AdminKb.delete' | t }}</button></div>
              </form>
            </details></li>
          }
        </ul>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminKb.categories' | t }}</h2>
        <ul class="flex flex-col gap-2">
          @for (c of data()?.categories ?? []; track c.id) {
            <li><details [class]="cls.card">
              <summary [class]="cls.summary"><span class="font-bold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span> <span class="font-mono text-sm text-muted" dir="ltr">/{{ c.slug }}</span>
                @if (!c.isActive) { <span [class]="cls.badgeOff + ' ms-2'">{{ 'AdminKb.inactive' | t }}</span> }</summary>
              <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="updateCat(c)">
                <ng-container *ngTemplateOutlet="catForm; context: { m: ec[c.id], id: 'c' + c.id }" />
                <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminKb.save' | t }}</button>
                  <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="del('kb-categories/' + c.id)">{{ 'Directory.delete' | t }}</button></div>
              </form>
            </details></li>
          }
        </ul>
        <details [class]="cls.card" #addc>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminKb.addCategory' | t }}</span></summary>
          <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="createCat(addc)">
            <ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'nc' }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminKbPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminKb.title';
  protected readonly subtitle = 'AdminKb.subtitle';
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
  protected async createArt(box: HTMLDetailsElement): Promise<void> { if (await this.run(() => this.api.post('kb-articles', this.nwArt))) { this.nwArt = blankArt(); box.open = false; } }
  protected updateArt(a: KbArt): void { void this.run(() => this.api.put('kb-articles/' + a.id, this.ea[a.id])); }
  protected async createCat(box: HTMLDetailsElement): Promise<void> { if (await this.run(() => this.api.post('kb-categories', this.nwCat))) { this.nwCat = blankKbCat(); box.open = false; } }
  protected updateCat(c: KbCat): void { void this.run(() => this.api.put('kb-categories/' + c.id, this.ec[c.id])); }
  protected del(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
