import { ChangeDetectionStrategy, Component, OnInit, computed, effect, signal, untracked } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { PageAbout } from '../../shared/page-about';
import { PlaceIcon, PlaceTree, TreeBadge, TreePick } from '../../shared/place-tree';
import { AdminBase } from './admin-pages';

interface EscOrg { id: string; name: string; parentId: string | null; isActive: boolean; mode: string; picks: string[]; leader: string | null }
interface EscBranch { id: string; organizationId: string; name: string; isActive: boolean; mode: string | null; picks: string[]; leader: string | null }
/** One step up the chain. key is what "Specific leaders" stores: "branch", or "org:" + organization id. */
interface Step { key: string; role: string; name: string; where: string; gap: boolean; can: boolean }

const MODES = ['any', 'next', 'specific', 'off'];

/**
 * Administration → Escalation: click an organization or branch to see its real chain, the setting it uses and
 * what its agents see; tick several to change them at once. A branch setting beats its organization's.
 */
@Component({
  selector: 'app-admin-escalation',
  imports: [TPipe, Alert, Req, ReqNote, PageAbout, PlaceTree, PlaceIcon],
  template: `
    <main class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Escalation.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Escalation.subtitle' | t }}</p></div>
      <app-page-about key="escalation" tile="up" [points]="['users', 'building', 'swap', 'map']" />
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      <div class="grid items-start gap-6 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <section [class]="card" aria-labelledby="esc-tree">
          <h2 id="esc-tree" class="text-xl font-bold">{{ 'Escalation.treeTitle' | t }}</h2>
          <p class="mb-3 mt-1 text-sm text-muted">{{ 'Escalation.treeHelp' | t }}</p>
          <app-place-tree [orgs]="treeOrgs()" [branches]="treeBranches()" [badgeFn]="badgeFn" [(selected)]="sel" [(tickedOrgs)]="tOrgs" [(tickedBranches)]="tBranches" />
          <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            @for (m of ['any', 'next', 'specific', 'off', 'inherit']; track m) { <span class="rounded-full px-2 py-0.5" [class]="badgeCls(m)">{{ 'Escalation.mode_' + m + '_short' | t }}</span> }
          </div>
        </section>

        <section [class]="card" aria-live="polite">
          @if (place(); as p) {
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3"><app-place-icon [kind]="p.kind" />
                <div><p class="text-xs text-muted" dir="auto">{{ p.kind === 'br' ? ('Escalation.branchOf' | t: { org: p.org.name }) : ('Escalation.organization' | t) }}</p>
                  <h2 class="text-xl font-bold" dir="auto">{{ p.name }}</h2></div></div>
              <span class="rounded-full px-2.5 py-1 text-xs font-bold" [class]="badgeCls(p.own ?? 'inherit')">{{ p.own ? ('Escalation.mode_' + p.own | t) : ('Escalation.usesOrgShort' | t: { org: p.org.name, mode: ('Escalation.mode_' + p.org.mode | t) }) }}</span>
            </div>

            <h3 class="mt-5 font-bold">{{ 'Escalation.chainFor' | t: { name: p.name } }}</h3>
            <ol class="mt-3 flex flex-wrap items-stretch gap-y-3">
              <li class="flex items-stretch">
                <div class="flex w-40 flex-col rounded-xl border-2 border-brand bg-brand-soft p-3"><span class="text-[11px] font-bold text-muted">{{ 'Escalation.stepAgent' | t }}</span><b>{{ 'Escalation.stepAgent' | t }}</b><span class="text-[13px] text-muted">{{ 'Escalation.stepAgentHint' | t }}</span></div>
                <span aria-hidden="true" class="flex w-5 shrink-0 items-center justify-center text-xl text-brand rtl:rotate-180">›</span>
              </li>
              @for (s of steps(); track s.key; let last = $last) {
                <li class="flex items-stretch">
                  <div class="flex w-40 flex-col rounded-xl border-2 p-3" [class]="s.can ? 'border-ok bg-ok-soft' : 'border-dashed border-[#7d8aa3] opacity-70'">
                    <span class="text-[11px] font-bold text-muted">{{ s.role }}</span><b dir="auto">{{ s.name }}</b>
                    <span class="text-[13px] text-muted" dir="auto">{{ s.where }}@if (s.gap) { · {{ 'Escalation.skipped' | t }} }</span></div>
                  @if (!last) { <span aria-hidden="true" class="flex w-5 shrink-0 items-center justify-center text-xl text-brand rtl:rotate-180">›</span> }
                </li>
              }
            </ol>
            <div class="mt-3 flex flex-wrap gap-4 text-[13px] text-muted">
              <span class="flex items-center gap-1.5"><i aria-hidden="true" class="inline-block size-3 rounded-sm border-2 border-brand bg-brand-soft"></i>{{ 'Escalation.lgMe' | t }}</span>
              <span class="flex items-center gap-1.5"><i aria-hidden="true" class="inline-block size-3 rounded-sm border-2 border-ok bg-ok-soft"></i>{{ 'Escalation.lgCan' | t }}</span>
              <span class="flex items-center gap-1.5"><i aria-hidden="true" class="inline-block size-3 rounded-sm border-2 border-dashed border-[#7d8aa3]"></i>{{ 'Escalation.lgNo' | t }}</span>
            </div>
            <p role="status" class="mt-3 rounded-lg bg-bg px-3 py-2.5 text-sm">{{ says() }}</p>

            <div class="mt-5 grid gap-5 xl:grid-cols-2">
              <div class="flex flex-col gap-3 rounded-xl border border-line p-4">
                <h3 class="font-bold">{{ 'Escalation.settingFor' | t: { name: p.name } }}</h3>
                @if (p.kind === 'br' && !p.own) { <p class="rounded-lg bg-bg px-3 py-2 text-sm">{{ 'Escalation.usesOrg' | t: { name: p.name, org: p.org.name, mode: ('Escalation.mode_' + p.org.mode | t) } }}</p> }
                <fieldset class="flex flex-col gap-2">
                  <legend class="mb-1 text-sm font-semibold">{{ 'Escalation.whoTitle' | t }}<app-req /></legend>
                  @for (m of modes; track m) {
                    <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                      <input type="radio" name="esc-mode" class="mt-1 h-5 w-5 accent-[var(--brand)]" [checked]="draft() === m" (change)="setDraft(m)" />
                      <span><span class="block font-semibold">{{ 'Escalation.mode_' + m | t }}</span><span class="block text-sm text-muted">{{ 'Escalation.mode_' + m + '_help' | t }}</span></span>
                    </label>
                    @if (m === 'specific' && draft() === 'specific') {
                      <div class="ms-8 flex flex-col gap-1">
                        @for (s of steps(); track s.key) {
                          <label class="flex min-h-11 items-center gap-2 text-sm" [class]="s.gap ? 'text-muted' : 'cursor-pointer'">
                            <input type="checkbox" class="h-5 w-5" [disabled]="s.gap" [checked]="!s.gap && picks().includes(s.key)" (change)="flipPick(s.key)" />
                            <span dir="auto">{{ s.name }} · {{ s.where || s.role }}@if (s.gap) { ({{ 'Escalation.noLeader' | t }}) }</span>
                          </label>
                        }
                        @if (!validPicks()) { <p role="alert" class="text-sm font-medium text-danger">{{ 'Escalation.pickOne' | t }}</p> }
                      </div>
                    }
                  }
                </fieldset>
                <div class="flex flex-wrap items-center gap-3">
                  <button type="button" [class]="cls.btn" [disabled]="busy() || (draft() === 'specific' && !validPicks())" (click)="savePlace()">{{ 'Escalation.saveFor' | t: { name: p.name } }}</button><app-req-note />
                </div>
                @if (p.kind === 'br' && p.own) {
                  <button type="button" class="cursor-pointer self-start text-start text-sm text-brand-ink underline" (click)="removeOwn()" [disabled]="busy()">{{ 'Escalation.removeOwn' | t: { name: p.name, org: p.org.name } }}</button>
                }
              </div>
              <div class="flex flex-col gap-3 rounded-xl border border-line p-4">
                <h3 class="font-bold">{{ 'Escalation.seesTitle' | t }}</h3>
                @if (offered().length === 0) {
                  <p class="rounded-lg border border-dashed border-[#7d8aa3] p-4 text-sm text-muted">{{ 'Escalation.hidden' | t: { name: p.name } }}</p>
                } @else {
                  <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Escalation.route' | t }}
                    <select [class]="cls.input + ' font-normal'">@for (s of offered(); track s.key) { <option>{{ s.name }} · {{ s.where || s.role }}</option> }</select></label>
                  <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Escalation.reason' | t }}
                    <textarea rows="2" [class]="cls.input + ' py-2 font-normal'" [placeholder]="'Escalation.ex.reasonHint' | t"></textarea></label>
                  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                    <span class="text-sm text-muted">{{ 'Escalation.optionsN' | t: { n: offered().length } }}</span>
                    <span class="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white">{{ 'Escalation.submit' | t }}</span>
                  </div>
                }
              </div>
            </div>
          } @else {
            <p class="text-muted">{{ 'Escalation.pickPrompt' | t }}</p>
          }
        </section>
      </div>

      @if (tOrgs().length || tBranches().length) {
        <div role="region" [attr.aria-label]="'Escalation.bulkLabel' | t" class="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-lg">
          <b>{{ 'Escalation.bulkN' | t: { o: tOrgs().length, b: tBranches().length } }}</b>
          <label class="flex items-center gap-2 text-sm">{{ 'Escalation.bulkSet' | t }}
            <select class="min-h-10 rounded-lg px-2 text-ink" [value]="bulkMode()" (change)="bulkMode.set($any($event.target).value)">
              @for (m of ['any', 'next', 'off', 'inherit']; track m) { <option [value]="m">{{ (m === 'inherit' ? 'Escalation.bulkInherit' : 'Escalation.mode_' + m) | t }}</option> }
            </select></label>
          <button type="button" class="min-h-10 cursor-pointer rounded-lg bg-brand px-4 font-semibold" [disabled]="busy()" (click)="applyBulk()">{{ 'Escalation.bulkApply' | t }}</button>
          <button type="button" class="min-h-10 cursor-pointer rounded-lg border border-white/40 px-4 font-semibold" (click)="tOrgs.set([]); tBranches.set([])">{{ 'Escalation.bulkClear' | t }}</button>
        </div>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminEscalationPage extends AdminBase implements OnInit {
  protected readonly card = 'rounded-xl border border-line bg-surface p-5 shadow-card';
  protected readonly modes = MODES;
  protected readonly data = signal<{ orgs: EscOrg[]; branches: EscBranch[] } | null>(null);
  protected readonly sel = signal<TreePick | null>(null);
  protected readonly tOrgs = signal<string[]>([]);
  protected readonly tBranches = signal<string[]>([]);
  protected readonly bulkMode = signal('any');
  protected readonly draft = signal('any');
  protected readonly picks = signal<string[]>([]);
  /** A new place selected: the form starts again from its setting. */
  private readonly onSelect = effect(() => { this.sel(); untracked(() => this.resetDraft()); });

  protected readonly orgs = computed(() => (this.data()?.orgs ?? []).filter((o) => o.isActive));
  protected readonly treeOrgs = computed(() => this.orgs().map((o) => ({ id: o.id, name: o.name, sub: o.leader ?? this.i18n.t('Escalation.noLeader') })));
  protected readonly treeBranches = computed(() => (this.data()?.branches ?? []).filter((b) => b.isActive)
    .map((b) => ({ id: b.id, organizationId: b.organizationId, name: b.name, sub: b.leader ?? this.i18n.t('Escalation.noLeader') })));
  protected readonly badgeFn = (kind: 'all' | 'org' | 'br', id: string): TreeBadge | null => {
    const m = kind === 'org' ? this.data()?.orgs.find((o) => o.id === id)?.mode : (this.data()?.branches.find((b) => b.id === id)?.mode ?? 'inherit');
    return m ? { text: this.i18n.t('Escalation.mode_' + m + '_short'), cls: this.badgeCls(m) } : null;
  };

  /** The selected place, with its organization and its own setting (a branch may have none). */
  protected readonly place = computed(() => {
    const s = this.sel(); const d = this.data();
    if (!s || !d) return null;
    if (s.kind === 'br') {
      const b = d.branches.find((x) => x.id === s.id); const org = b && d.orgs.find((o) => o.id === b.organizationId);
      return b && org ? { kind: 'br' as const, name: b.name, org, b, own: b.mode } : null;
    }
    const org = d.orgs.find((o) => o.id === s.id);
    return org ? { kind: 'org' as const, name: org.name, org, b: null, own: org.mode as string | null } : null;
  });

  /** The chain for a ticket from the place, as the server builds it (TicketLifecycleService.ChainAsync), with the draft setting applied. */
  protected readonly steps = computed<Step[]>(() => {
    const p = this.place(); if (!p) return [];
    const t = (k: string, x?: Record<string, unknown>) => this.i18n.t('Escalation.' + k, x);
    const steps: Step[] = [];
    if (p.b?.leader) steps.push({ key: 'branch', role: t('stepBranch'), name: p.b.leader, where: p.b.name, gap: false, can: false });
    else steps.push({ key: 'branch', role: t('stepTeam'), name: t('teamLeaderName'), where: p.b ? t('noBranchLeader', { name: p.b.name }) : '', gap: false, can: false });
    const all = this.data()?.orgs ?? [];
    let o: EscOrg | undefined = p.org;
    for (let depth = 0; o && depth <= 30; depth++) {
      steps.push({ key: 'org:' + o.id, role: depth === 0 ? t('roleOrg') : o.parentId ? t('roleParent') : t('roleTop'), name: o.leader ?? t('noLeader'), where: o.name, gap: !o.leader, can: false });
      o = o.parentId ? all.find((x) => x.id === o!.parentId) : undefined;
    }
    const mode = this.draft(); let n = 0;
    for (const s of steps) {
      s.can = !s.gap && mode !== 'off' && (mode === 'specific' ? this.picks().includes(s.key) : mode === 'any' || n === 0);
      if (s.can) n++;
    }
    return steps;
  });
  protected readonly offered = computed(() => this.steps().filter((s) => s.can));
  protected readonly validPicks = computed(() => this.steps().some((s) => !s.gap && this.picks().includes(s.key)));
  protected readonly says = computed(() => {
    const p = this.place(); if (!p) return '';
    const mode = this.draft();
    if (mode === 'off') return this.i18n.t('Escalation.says_off', { name: p.name });
    const names = this.offered().map((s) => s.name);
    if (!names.length) return this.i18n.t('Escalation.says_none');
    const list = names.length === 1 ? names[0] : names.slice(0, -1).join(this.i18n.t('Escalation.listSep')) + this.i18n.t('Escalation.or') + names[names.length - 1];
    return this.i18n.t('Escalation.says_' + mode, { name: p.name, list }) + (this.steps().some((s) => s.gap) ? ' ' + this.i18n.t('Escalation.gapNote') : '');
  });

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      this.data.set(await this.api.get('escalation'));
      if (!this.sel()) { const first = [...this.orgs()].sort((a, b) => a.name.localeCompare(b.name))[0]; if (first) this.sel.set({ kind: 'org', id: first.id }); }
      this.resetDraft();
    } catch (e) { this.fail(e); }
  }
  protected badgeCls(m: string): string {
    return m === 'off' ? 'bg-bg text-muted' : m === 'next' ? 'bg-warn-soft text-warn-ink' : m === 'specific' ? 'bg-brand-soft text-brand-ink' : m === 'inherit' ? 'border border-dashed border-[#7d8aa3] text-muted' : 'bg-ok-soft text-ok';
  }
  /** The form starts from what applies to the selected place. */
  private resetDraft(): void {
    const p = this.place(); if (!p) return;
    const src = p.kind === 'br' && p.b.mode ? p.b : p.org;
    this.draft.set(src.mode ?? 'any'); this.picks.set([...(src.picks ?? [])]);
  }
  protected setDraft(m: string): void {
    this.draft.set(m);
    if (m === 'specific' && !this.validPicks()) this.picks.set(this.steps().filter((s) => !s.gap).map((s) => s.key));
  }
  protected flipPick(k: string): void { this.picks.update((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k])); }

  protected savePlace(): void {
    const p = this.place(); if (!p) return;
    const m = this.draft();
    const body = { mode: m, organizationIds: p.kind === 'org' ? [p.org.id] : [], branchIds: p.kind === 'br' ? [p.b.id] : [], picks: m === 'specific' ? this.picks() : null };
    void this.run(() => this.api.put('escalation', body));
  }
  protected removeOwn(): void {
    const p = this.place(); if (p?.kind !== 'br') return;
    void this.run(() => this.api.put('escalation', { mode: 'inherit', organizationIds: [], branchIds: [p.b.id] }));
  }
  protected applyBulk(): void {
    const m = this.bulkMode();
    const body = { mode: m, organizationIds: m === 'inherit' ? [] : this.tOrgs(), branchIds: this.tBranches() };
    if (!body.organizationIds.length && !body.branchIds.length) return;
    void this.run(async () => { await this.api.put('escalation', body); this.tOrgs.set([]); this.tBranches.set([]); });
  }
}
