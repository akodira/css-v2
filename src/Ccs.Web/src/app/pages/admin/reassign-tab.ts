import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { PlaceIcon, PlaceTree, TreeBadge, TreePick } from '../../shared/place-tree';
import { CLS, Msg } from './admin-pages';

export interface ReassignRule { on: boolean; to: string[]; reason: 'req' | 'opt'; once: boolean }
interface ROrg { id: string; name: string; parentId: string | null; isActive: boolean; rule: ReassignRule | null }
interface RBranch { id: string; organizationId: string; name: string; isActive: boolean; rule: ReassignRule | null }
interface RData { default: ReassignRule; orgs: ROrg[]; branches: RBranch[] }

const TARGETS = ['agents', 'leader', 'queue', 'auto'];
const OFF: ReassignRule = { on: false, to: [], reason: 'req', once: false };
const STARTER: ReassignRule = { on: true, to: ['agents', 'leader'], reason: 'req', once: false };

/**
 * Settings → Reassign tickets: whether agents may hand over the tickets assigned to them, and to whom. One default
 * for everyone and an own setting for any organization or branch; a place without one uses the level above.
 */
@Component({
  selector: 'app-set-reassign',
  imports: [TPipe, Alert, Req, ReqNote, PlaceTree, PlaceIcon],
  template: `
    @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
    <p role="note" class="rounded-lg border-s-4 border-brand bg-surface px-4 py-3 text-sm text-muted shadow-card">{{ 'AdminReassign.intro' | t }}</p>
    @if (d(); as x) {
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <section [class]="cls.card + ' p-5'" aria-labelledby="ra-tree">
          <h2 id="ra-tree" class="text-lg font-bold">{{ 'AdminReassign.treeTitle' | t }}</h2>
          <p class="mb-3 mt-1 text-sm text-muted">{{ 'AdminReassign.treeHelp' | t }}</p>
          <app-place-tree [orgs]="treeOrgs()" [branches]="treeBranches()" [badgeFn]="badgeFn" [defaultLabel]="'AdminReassign.default' | t" [defaultSub]="'AdminReassign.defaultSub' | t"
            [(selected)]="sel" [(tickedOrgs)]="tOrgs" [(tickedBranches)]="tBranches" />
          <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span class="rounded-full bg-ok-soft px-2 py-0.5 text-ok">{{ 'AdminReassign.badgeOn' | t }}</span>
            <span class="rounded-full bg-bg px-2 py-0.5 text-muted">{{ 'AdminReassign.badgeOff' | t }}</span>
            <span class="rounded-full border border-dashed border-[#7d8aa3] px-2 py-0.5 text-muted">{{ 'AdminReassign.badgeAbove' | t }}</span>
          </div>
        </section>

        <div class="grid items-start gap-6 2xl:grid-cols-[1.1fr_1fr]">
          @if (place(); as p) {
            <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-live="polite">
              <div class="flex items-center gap-3"><app-place-icon [kind]="p.kind" />
                <div><p class="text-xs text-muted" dir="auto">{{ p.crumb }}</p><h2 class="text-lg font-bold" dir="auto">{{ p.name }}</h2></div></div>
              @if (!editing()) {
                <p class="rounded-lg bg-bg px-3 py-2.5 text-sm">{{ 'AdminReassign.usesAbove' | t: { name: p.name, from: p.fromName, state: (eff().on ? 'AdminReassign.stateOn' : 'AdminReassign.stateOff') | t } }}</p>
                <div><button type="button" [class]="cls.btn" (click)="makeOwn()">{{ 'AdminReassign.makeOwn' | t: { name: p.name } }}</button></div>
              } @else {
                @let r = draft();
                <div class="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
                  <span><b class="block">{{ 'AdminReassign.on' | t }}</b><span class="text-sm text-muted">{{ 'AdminReassign.onHelp' | t }}</span></span>
                  <input type="checkbox" role="switch" class="h-6 w-11 shrink-0 cursor-pointer accent-[var(--brand)]" [checked]="r.on" [attr.aria-label]="'AdminReassign.on' | t" (change)="setOn($any($event.target).checked)" />
                </div>
                @if (r.on) {
                  <fieldset class="flex flex-col gap-2 rounded-lg border border-line p-4">
                    <legend class="px-1 text-sm font-semibold">{{ 'AdminReassign.toTitle' | t }}<app-req /></legend>
                    @for (k of targets; track k) {
                      <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0" [checked]="r.to.includes(k)" (change)="flipTo(k)" />
                        <span><b class="block">{{ 'AdminReassign.to_' + k | t }}</b><span class="text-sm text-muted">{{ 'AdminReassign.to_' + k + '_help' | t }}</span></span></label>
                    }
                    @if (!r.to.length) { <p role="alert" class="text-sm font-medium text-danger">{{ 'AdminReassign.pickOne' | t }}</p> }
                  </fieldset>
                  <fieldset class="flex flex-col gap-2 rounded-lg border border-line p-4">
                    <legend class="px-1 text-sm font-semibold">{{ 'AdminReassign.reasonTitle' | t }}</legend>
                    <label class="flex cursor-pointer items-start gap-3"><input type="radio" name="ra-reason" class="mt-0.5 h-5 w-5" [checked]="r.reason === 'req'" (change)="patch({ reason: 'req' })" />
                      <span><b class="block">{{ 'AdminReassign.reasonReq' | t }}</b><span class="text-sm text-muted">{{ 'AdminReassign.reasonReqHelp' | t }}</span></span></label>
                    <label class="flex cursor-pointer items-start gap-3"><input type="radio" name="ra-reason" class="mt-0.5 h-5 w-5" [checked]="r.reason === 'opt'" (change)="patch({ reason: 'opt' })" />
                      <b>{{ 'AdminReassign.reasonOpt' | t }}</b></label>
                  </fieldset>
                  <fieldset class="flex flex-col gap-2 rounded-lg border border-line p-4">
                    <legend class="px-1 text-sm font-semibold">{{ 'AdminReassign.limitTitle' | t }}</legend>
                    <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0" [checked]="r.once" (change)="patch({ once: $any($event.target).checked })" />
                      <span><b class="block">{{ 'AdminReassign.once' | t }}</b><span class="text-sm text-muted">{{ 'AdminReassign.onceHelp' | t }}</span></span></label>
                  </fieldset>
                }
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" [class]="cls.btn" [disabled]="busy() || (r.on && !r.to.length)" (click)="save()">{{ 'AdminReassign.saveFor' | t: { name: p.name } }}</button><app-req-note />
                </div>
                @if (p.kind !== 'all') {
                  <button type="button" class="cursor-pointer self-start text-start text-sm text-brand-ink underline" [disabled]="busy()" (click)="removeOwn()">{{ 'AdminReassign.removeOwn' | t: { name: p.name, above: p.aboveName } }}</button>
                }
              }
            </section>

            <section [class]="cls.card + ' flex flex-col gap-3 p-5'" aria-labelledby="ra-prev">
              <div><h2 id="ra-prev" class="text-lg font-bold">{{ 'AdminReassign.previewTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminReassign.previewHelp' | t }}</p></div>
              @let s = shown();
              @if (!s.on || !s.to.length) {
                <p class="rounded-lg border border-dashed border-[#7d8aa3] p-4 text-sm text-muted">{{ 'AdminReassign.previewOff' | t }}</p>
              } @else {
                <div aria-hidden="true" class="flex flex-col gap-3 rounded-xl border border-line bg-bg/50 p-4">
                  <b>{{ 'Reassign.title' | t }}</b>
                  <span class="text-sm font-semibold">{{ 'Reassign.to' | t }} <span class="text-danger">*</span></span>
                  <span class="flex flex-col gap-1 rounded-lg border border-[#7d8aa3] bg-surface p-2 text-sm">
                    @for (k of order(s.to); track k) { <span>{{ 'AdminReassign.opt_' + k | t }}</span> }
                  </span>
                  <span class="text-sm font-semibold">{{ 'Reassign.reason' | t }} @if (s.reason === 'req') { <span class="text-danger">*</span> } @else { <span class="font-normal text-muted">({{ 'Reassign.optional' | t }})</span> }</span>
                  <span class="flex min-h-14 rounded-lg border border-[#7d8aa3] bg-surface px-3 py-2 text-sm text-muted">{{ 'Reassign.reasonHint' | t }}</span>
                  <span class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                    <span class="text-sm text-muted">{{ (s.once ? 'Reassign.onceNote' : 'Reassign.tellNote') | t }}</span>
                    <span class="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white">{{ 'Reassign.submit' | t }}</span>
                  </span>
                </div>
              }
              <p class="text-sm text-muted">{{ 'AdminReassign.slaNote' | t }}</p>
            </section>
          }
        </div>
      </div>

      @if (tOrgs().length || tBranches().length) {
        <div role="region" [attr.aria-label]="'AdminReassign.bulkLabel' | t" class="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-lg">
          <b>{{ 'Escalation.bulkN' | t: { o: tOrgs().length, b: tBranches().length } }}</b>
          <label class="flex items-center gap-2 text-sm">{{ 'Escalation.bulkSet' | t }}
            <select class="min-h-10 rounded-lg px-2 text-ink" [value]="bulkMode()" (change)="bulkMode.set($any($event.target).value)">
              @for (m of ['copy', 'off', 'inherit']; track m) { <option [value]="m">{{ 'AdminReassign.bulk_' + m | t }}</option> }
            </select></label>
          <button type="button" class="min-h-10 cursor-pointer rounded-lg bg-brand px-4 font-semibold" [disabled]="busy()" (click)="applyBulk()">{{ 'Escalation.bulkApply' | t }}</button>
          <button type="button" class="min-h-10 cursor-pointer rounded-lg border border-white/40 px-4 font-semibold" (click)="tOrgs.set([]); tBranches.set([])">{{ 'Escalation.bulkClear' | t }}</button>
        </div>
      }
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReassignTab implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18n);
  protected readonly cls = CLS;
  protected readonly targets = TARGETS;
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);
  protected readonly d = signal<RData | null>(null);
  protected readonly sel = signal<TreePick | null>({ kind: 'all', id: 'all' });
  protected readonly tOrgs = signal<string[]>([]);
  protected readonly tBranches = signal<string[]>([]);
  protected readonly bulkMode = signal('copy');
  /** The rule being edited, or null while the place still uses the level above. */
  protected readonly own = signal<ReassignRule | null>(null);
  protected readonly editing = computed(() => this.own() !== null);
  protected readonly draft = computed(() => this.own() ?? OFF);

  protected readonly treeOrgs = computed(() => (this.d()?.orgs ?? []).filter((o) => o.isActive).map((o) => ({ id: o.id, name: o.name })));
  protected readonly treeBranches = computed(() => (this.d()?.branches ?? []).filter((b) => b.isActive).map((b) => ({ id: b.id, organizationId: b.organizationId, name: b.name })));
  protected readonly badgeFn = (kind: 'all' | 'org' | 'br', id: string): TreeBadge | null => {
    const r = this.ruleOf(kind, id);
    if (!r) return { text: this.i18n.t('AdminReassign.badgeAboveShort'), cls: 'border border-dashed border-[#7d8aa3] text-muted' };
    return r.on ? { text: this.i18n.t('AdminReassign.badgeOn'), cls: 'bg-ok-soft text-ok' } : { text: this.i18n.t('AdminReassign.badgeOff'), cls: 'bg-bg text-muted' };
  };

  /** The selected place: its own rule, the rule that applies and where that comes from. */
  protected readonly place = computed(() => {
    const s = this.sel(); const x = this.d();
    if (!s || !x) return null;
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t('AdminReassign.' + k, p);
    if (s.kind === 'all') return { kind: 'all' as const, id: 'all', name: t('default'), crumb: t('everywhere'), fromName: '', aboveName: '' };
    if (s.kind === 'br') {
      const b = x.branches.find((y) => y.id === s.id); const o = b && x.orgs.find((y) => y.id === b.organizationId);
      if (!b || !o) return null;
      return { kind: 'br' as const, id: b.id, name: b.name, crumb: t('branchOf', { org: o.name }), fromName: this.fromName('br', b.id), aboveName: o.name };
    }
    const o = x.orgs.find((y) => y.id === s.id); if (!o) return null;
    const parent = o.parentId ? x.orgs.find((y) => y.id === o.parentId) : null;
    return { kind: 'org' as const, id: o.id, name: o.name, crumb: t('organization'), fromName: this.fromName('org', o.id), aboveName: parent?.name ?? t('theDefault') };
  });
  protected readonly eff = computed(() => { const p = this.place(); return p ? this.effective(p.kind, p.id).rule : OFF; });
  /** What the preview shows: the form while editing, else what applies. */
  protected readonly shown = computed(() => this.own() ?? this.eff());

  private readonly onSelect = effect(() => { this.sel(); this.d(); untracked(() => this.resetOwn()); });

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    try { this.d.set(await firstValueFrom(this.http.get<RData>('/api/admin/settings/reassign'))); }
    catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
  }
  private ruleOf(kind: string, id: string): ReassignRule | null {
    const x = this.d(); if (!x) return null;
    if (kind === 'all') return x.default;
    if (kind === 'br') return x.branches.find((b) => b.id === id)?.rule ?? null;
    return x.orgs.find((o) => o.id === id)?.rule ?? null;
  }
  /** Branch → its organization → the ones above → the default. */
  private effective(kind: string, id: string): { rule: ReassignRule; kind: string; id: string } {
    const x = this.d()!;
    if (kind === 'all') return { rule: x.default, kind, id };
    let orgId: string | null = id;
    if (kind === 'br') { const b = x.branches.find((y) => y.id === id); if (b?.rule) return { rule: b.rule, kind, id }; orgId = b?.organizationId ?? null; }
    for (let depth = 0; orgId && depth <= 30; depth++) {
      const o = x.orgs.find((y) => y.id === orgId); if (!o) break;
      if (o.rule) return { rule: o.rule, kind: 'org', id: o.id };
      orgId = o.parentId;
    }
    return { rule: x.default, kind: 'all', id: 'all' };
  }
  private fromName(kind: string, id: string): string {
    const e = this.effective(kind, id);
    return e.kind === 'all' ? this.i18n.t('AdminReassign.theDefault') : (this.d()!.orgs.find((o) => o.id === e.id)?.name ?? '');
  }
  private resetOwn(): void { const p = this.place(); this.own.set(p ? clone(this.ruleOf(p.kind, p.id)) : null); }

  protected order(to: string[]): string[] { return ['queue', 'auto', 'agents', 'leader'].filter((k) => to.includes(k)); }
  protected makeOwn(): void { const e = this.eff(); this.own.set(clone(e.on ? e : STARTER)); }
  protected patch(p: Partial<ReassignRule>): void { this.own.update((r) => ({ ...(r ?? OFF), ...p })); }
  protected setOn(on: boolean): void { this.own.update((r) => ({ ...(r ?? OFF), on, to: on && !(r?.to.length) ? [...STARTER.to] : (r?.to ?? []) })); }
  protected flipTo(k: string): void { this.own.update((r) => { const to = r?.to ?? []; return { ...(r ?? OFF), to: to.includes(k) ? to.filter((x) => x !== k) : [...to, k] }; }); }

  private async put(body: unknown, ok = 'AdminCommon.saved'): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try {
      await firstValueFrom(this.http.put('/api/admin/settings/reassign', body));
      this.msg.set({ tone: 'success', text: this.i18n.t(ok) });
      await this.load();
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
  protected save(): void {
    const p = this.place(); const r = this.own(); if (!p || !r) return;
    void this.put({ default: p.kind === 'all', organizationIds: p.kind === 'org' ? [p.id] : [], branchIds: p.kind === 'br' ? [p.id] : [], rule: r });
  }
  protected removeOwn(): void {
    const p = this.place(); if (!p || p.kind === 'all') return;
    void this.put({ default: false, organizationIds: p.kind === 'org' ? [p.id] : [], branchIds: p.kind === 'br' ? [p.id] : [], rule: null });
  }
  protected applyBulk(): void {
    const m = this.bulkMode();
    const rule = m === 'inherit' ? null : m === 'off' ? OFF : this.shown();
    void this.put({ default: false, organizationIds: this.tOrgs(), branchIds: this.tBranches(), rule }).then(() => { this.tOrgs.set([]); this.tBranches.set([]); });
  }
}

function clone(r: ReassignRule | null): ReassignRule | null { return r ? { ...r, to: [...r.to] } : null; }
