import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, model, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { I18n, TPipe } from '../../core/i18n';

// Staff and Permissions, Plan B: account type = what a person can do, Works in = where.
// Shared here: the kind rules (same as Ccs.Domain AccountKinds), the setup guide and the Works in picker.

export const KINDS = ['agent', 'team_leader', 'viewer', 'branch_admin', 'organization_admin'] as const;
/** What a viewer may hold: looking and reporting only. */
export const VIEWER_PERMS = ['view_unassigned', 'view_others', 'all_teams', 'reports_own', 'reports_all', 'export', 'customers_view'];

/** Can this permission be ticked for this kind? */
export function permFits(kind: string, p: string): boolean {
  if (kind === 'viewer') return VIEWER_PERMS.includes(p);
  if (kind === 'agent') return p !== 'assign_others';
  return true;
}
/** Permissions a kind always holds (ticked and locked). */
export function permNeeded(kind: string, p: string): boolean {
  return (kind === 'agent' || kind === 'team_leader') && p === 'reply' || (kind === 'team_leader' && p === 'assign_others');
}
export function scopeOfKind(kind: string): 'organization' | 'branch' | null {
  return kind === 'organization_admin' ? 'organization' : kind === 'branch_admin' ? 'branch' : null;
}
/** The staff role a type gives (port of account_type_role): admin, team_leader, agent or management_viewer. */
export function roleOfType(t: { isBuiltin: boolean; permissions: string[] } | undefined | null): string | null {
  if (!t) return null;
  if (t.isBuiltin) return 'admin';
  return t.permissions.includes('assign_others') ? 'team_leader' : t.permissions.includes('reply') ? 'agent' : 'management_viewer';
}

interface Status { orgs: number; branches: number; teams: number; types: number; staff: number; noType: string[]; noPlace: string[] }
const HIDE_KEY = 'ccs.setupGuide.hidden';

/** The 5-step setup guide at the top of Staff and Permissions. It ticks steps off from the real data. */
@Component({
  selector: 'app-setup-guide',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (s(); as s) {
      @if (collapsed()) {
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-3 shadow-card">
          <p class="flex flex-wrap items-center gap-3 font-semibold">{{ 'StaffSetup.guide.mini' | t }}
            <span aria-hidden="true" class="flex gap-1">@for (x of steps(); track x.n) { <span class="size-2.5 rounded-full" [class]="x.done ? 'bg-ok' : 'bg-line'"></span> }</span>
            <span class="text-sm font-normal text-muted">{{ 'StaffSetup.guide.progress' | t: { done: done() } }}@if (warn()) { · {{ warn() }} }</span></p>
          <button type="button" class="min-h-11 cursor-pointer text-sm font-semibold text-brand-ink underline" (click)="setHidden(false)">{{ 'StaffSetup.guide.show' | t }}</button>
        </div>
      } @else {
        <section aria-labelledby="sg-title" class="rounded-xl border border-line bg-surface p-5 shadow-card">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h2 id="sg-title" class="text-lg font-bold">{{ 'StaffSetup.guide.title' | t }}</h2>
              <p class="text-sm text-muted">{{ 'StaffSetup.guide.progress' | t: { done: done() } }} {{ 'StaffSetup.guide.auto' | t }}</p></div>
            <button type="button" class="min-h-11 cursor-pointer text-sm font-semibold text-brand-ink underline" (click)="setHidden(true)">{{ 'StaffSetup.guide.hide' | t }}</button>
          </div>
          <div class="my-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" [attr.aria-valuenow]="done()" aria-valuemin="0" aria-valuemax="5" [attr.aria-label]="'StaffSetup.guide.mini' | t">
            <div class="h-full rounded-full bg-ok transition-[width]" [style.width.%]="done() * 20"></div></div>
          <ol class="grid grid-cols-1 gap-3 md:grid-cols-5">
            @for (x of steps(); track x.n) {
              <li class="flex flex-col gap-1.5 rounded-xl border p-3 text-sm" [class]="x.n === now() ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line'">
                <span aria-hidden="true" class="grid size-7 place-items-center rounded-full text-sm font-bold" [class]="x.done ? 'bg-ok-soft text-ok' : x.n === now() ? 'bg-brand text-white' : 'bg-bg text-muted'">{{ x.done ? '✓' : x.n }}</span>
                <b class="text-base">{{ 'StaffSetup.guide.s' + x.n + '.title' | t }}<span class="sr-only"> · {{ (x.done ? 'StaffSetup.guide.doneSr' : 'StaffSetup.guide.todoSr') | t }}</span></b>
                <span class="text-muted">{{ 'StaffSetup.guide.s' + x.n + '.text' | t }}</span>
                <span class="text-xs font-semibold" [class]="x.done ? 'text-ok' : x.n === now() ? 'text-warn-ink' : 'text-muted'">{{ x.state }}</span>
                @if (x.n === 4 && !x.done && page() === 'staff' && (s.noType.length || s.noPlace.length)) {
                  <button type="button" class="mt-auto min-h-9 cursor-pointer self-start text-sm font-semibold text-brand-ink underline" (click)="needs.emit()">{{ 'StaffSetup.guide.s4.go' | t }}</button>
                } @else {
                  <a [routerLink]="x.link" [queryParams]="x.n === 4 && !x.done ? { need: 1 } : null" class="mt-auto min-h-9 self-start pt-1 text-sm font-semibold text-brand-ink underline">{{ x.go | t }}</a>
                }
              </li>
            }
          </ol>
          <p class="mt-4 rounded-lg bg-brand-soft px-4 py-2.5 text-sm text-brand-ink">{{ 'StaffSetup.guide.rule' | t }}</p>
          <details class="mt-3 border-t border-line pt-3">
            <summary class="min-h-9 cursor-pointer font-semibold">{{ 'StaffSetup.guide.everyday' | t }}</summary>
            <ul class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              @for (k of [1, 2, 3, 4]; track k) {
                <li class="rounded-lg border border-line p-3 text-sm"><b class="block">{{ 'StaffSetup.guide.t' + k + '.title' | t }}</b><span class="text-muted">{{ 'StaffSetup.guide.t' + k + '.text' | t }}</span></li>
              }
            </ul>
          </details>
        </section>
      }
    }`,
})
export class SetupGuide implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  readonly page = input<'staff' | 'permissions'>('staff');
  /** "Show them" on the Staff page: filter the list to the people who still need something. */
  readonly needs = output<void>();
  /** Opened from the "Show them" link on Permissions (?need=1): filter once, as soon as the counts arrive. */
  readonly autoNeeds = input(false);
  private autoDone = false;
  protected readonly s = signal<Status | null>(null);
  private readonly hidden = signal(readHidden());
  protected readonly steps = computed(() => {
    const s = this.s()!, l = '/' + this.i18n.locale();
    const four = s.staff > 0 && !s.noType.length && !s.noPlace.length;
    const base = [
      { n: 1, done: s.orgs > 0, link: l + '/admin/organizations', go: 'StaffSetup.guide.s1.go',
        state: s.orgs ? this.i18n.t('StaffSetup.guide.s1.ok', { orgs: s.orgs, branches: s.branches }) : this.i18n.t('StaffSetup.guide.s1.todo') },
      { n: 2, done: s.teams > 0, link: l + '/admin/teams', go: 'StaffSetup.guide.s2.go',
        state: s.teams ? this.i18n.t('StaffSetup.guide.s2.ok', { n: s.teams }) : this.i18n.t('StaffSetup.guide.s2.todo') },
      { n: 3, done: s.types > 0, link: l + '/admin/permissions', go: 'StaffSetup.guide.s3.go', state: this.i18n.t('StaffSetup.guide.s3.ok', { n: s.types }) },
      { n: 4, done: four, link: l + '/admin/users', go: 'StaffSetup.guide.s4.open',
        state: s.noType.length ? this.i18n.t('StaffSetup.guide.s4.todoType', { n: s.noType.length })
          : s.noPlace.length ? this.i18n.t('StaffSetup.guide.s4.todoPlace', { n: s.noPlace.length }) : this.i18n.t('StaffSetup.guide.s4.ok', { n: s.staff }) },
    ];
    const allBefore = base.every((x) => x.done);
    return [...base, { n: 5, done: allBefore, link: l + '/console/branches', go: 'StaffSetup.guide.s5.go', state: this.i18n.t(allBefore ? 'StaffSetup.guide.s5.ok' : 'StaffSetup.guide.s5.wait') }];
  });
  protected readonly done = computed(() => this.steps().filter((x) => x.done).length);
  protected readonly now = computed(() => this.steps().find((x) => !x.done)?.n ?? 0);
  protected readonly warn = computed(() => { const x = this.steps().find((y) => y.n === 4)!; return x.done ? '' : x.state; });
  /** Opened by hand after every step was done: stays open until hidden again. */
  private readonly opened = signal(false);
  protected readonly collapsed = computed(() => this.hidden() || (this.done() === 5 && !this.opened()));
  async ngOnInit(): Promise<void> { await this.reload(); }
  async reload(): Promise<void> {
    try { this.s.set(await firstValueFrom(this.http.get<Status>('/api/admin/setup-status'))); } catch { /* the guide is help only; the page still works */ }
    if (this.autoNeeds() && !this.autoDone && this.needIds().length) { this.autoDone = true; this.needs.emit(); }
  }
  /** Ids of people who still need an account type or a place (the "Show them" filter). */
  needIds(): string[] { const s = this.s(); return s ? [...s.noType, ...s.noPlace] : []; }
  protected setHidden(v: boolean): void {
    this.hidden.set(v);
    this.opened.set(!v);
    try { if (v) localStorage.setItem(HIDE_KEY, '1'); else localStorage.removeItem(HIDE_KEY); } catch { /* private mode */ }
  }
}
function readHidden(): boolean { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } }

interface OrgPick { id: string; name: string }
interface BranchPick { id: string; organizationId: string; name: string }

/**
 * Works in: Everywhere, or only some places shown as chips, added from a search list.
 * mode 'any' = whole organizations or single branches; 'organization' / 'branch' = what an Organization / Branch Admin manages (never everywhere).
 */
@Component({
  selector: 'app-place-picker',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      @if (mode() === 'any') {
        <fieldset class="flex flex-wrap gap-x-6 gap-y-1">
          <legend class="sr-only">{{ 'StaffSetup.where.title' | t }}</legend>
          <label class="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" [name]="uid + '-w'" class="size-5" [checked]="everywhere()" (change)="everywhere.set(true)" />{{ 'StaffSetup.where.everywhere' | t }}</label>
          <label class="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" [name]="uid + '-w'" class="size-5" [checked]="!everywhere()" (change)="everywhere.set(false)" />{{ 'StaffSetup.where.only' | t }}</label>
        </fieldset>
      } @else {
        <p class="text-sm text-muted">{{ (mode() === 'organization' ? 'StaffSetup.where.orgAdmin' : 'StaffSetup.where.branchAdmin') | t }}</p>
      }
      @if (mode() !== 'any' || !everywhere()) {
        <div class="flex flex-wrap items-center gap-2" aria-live="polite">
          @for (c of chips(); track c.id) {
            <span class="inline-flex min-h-9 items-center gap-1 rounded-full border border-line bg-bg py-0.5 ps-3 pe-1 text-sm">
              <span dir="auto">{{ c.label }}</span>
              <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" [attr.aria-label]="'StaffSetup.where.remove' | t: { name: c.label }" (click)="remove(c)">✕</button>
            </span>
          } @empty { <span class="text-sm text-muted">{{ 'StaffSetup.where.none' | t }}</span> }
          <button type="button" class="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-dashed border-brand/50 bg-surface px-3 text-sm font-semibold text-brand-ink hover:border-brand"
            [attr.aria-expanded]="open()" [attr.aria-controls]="uid + '-list'" (click)="open.set(!open())">＋ {{ 'StaffSetup.where.add' | t }}</button>
        </div>
        @if (open()) {
          <div [id]="uid + '-list'" class="max-w-xl rounded-lg border border-line bg-surface p-2">
            <input type="search" dir="auto" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" [placeholder]="'StaffSetup.where.search' | t"
              [attr.aria-label]="'StaffSetup.where.search' | t" [value]="q()" (input)="q.set($any($event.target).value)" (keydown.enter)="$event.preventDefault()" (keydown.escape)="open.set(false)" />
            <ul class="mt-2 max-h-72 overflow-y-auto">
              @for (g of groups(); track g.o.id) {
                <li class="border-b border-line py-1 last:border-b-0">
                  <div class="flex min-h-10 items-center justify-between gap-2 px-2">
                    <b dir="auto">{{ g.o.name }}</b>
                    @if (mode() !== 'branch') {
                      @if (orgs().includes(g.o.id)) { <span class="text-xs font-semibold text-ok">✓ {{ 'StaffSetup.where.added' | t }}</span> }
                      @else { <button type="button" class="min-h-9 cursor-pointer rounded-lg px-2 text-sm font-semibold text-brand-ink underline" (click)="addOrg(g.o.id)">{{ (mode() === 'organization' ? 'StaffSetup.where.addOrg' : 'StaffSetup.where.whole') | t }}</button> }
                    }
                  </div>
                  @if (mode() !== 'organization') {
                    @for (b of g.list; track b.id) {
                      <div class="flex min-h-10 items-center justify-between gap-2 ps-6 pe-2 text-sm">
                        <span dir="auto">{{ b.name }}</span>
                        @if (branches().includes(b.id) || (mode() === 'any' && orgs().includes(g.o.id))) { <span class="text-xs font-semibold text-ok">✓ {{ 'StaffSetup.where.added' | t }}</span> }
                        @else { <button type="button" class="min-h-9 cursor-pointer rounded-lg px-2 font-semibold text-brand-ink underline" (click)="addBranch(b)">{{ 'StaffSetup.where.addBranch' | t }}</button> }
                      </div>
                    }
                  }
                </li>
              } @empty { <li class="p-2 text-sm text-muted">{{ 'StaffSetup.where.noMatch' | t }}</li> }
            </ul>
          </div>
        }
      }
    </div>`,
})
export class PlacePicker {
  private readonly i18n = inject(I18n);
  readonly mode = input<'any' | 'organization' | 'branch'>('any');
  readonly allOrgs = input<OrgPick[]>([]);
  readonly allBranches = input<BranchPick[]>([]);
  readonly everywhere = model(true);
  readonly orgs = model<string[]>([]);
  readonly branches = model<string[]>([]);
  protected readonly uid = 'pp' + Math.random().toString(36).slice(2, 8);
  protected readonly open = signal(false);
  protected readonly q = signal('');
  private orgName(id: string): string { return this.allOrgs().find((o) => o.id === id)?.name ?? '?'; }
  protected readonly chips = computed(() => {
    const m = this.mode();
    const o = m === 'branch' ? [] : this.orgs().map((id) => ({ id, kind: 'org' as const, label: m === 'organization' ? this.orgName(id) : this.i18n.t('StaffSetup.where.allOf', { org: this.orgName(id) }) }));
    const b = m === 'organization' ? [] : this.branches().map((id) => {
      const x = this.allBranches().find((y) => y.id === id);
      return { id, kind: 'branch' as const, label: x ? `${this.orgName(x.organizationId)} · ${x.name}` : '?' };
    });
    return [...o, ...b];
  });
  protected readonly groups = computed(() => {
    const s = this.q().trim().toLowerCase();
    return [...this.allOrgs()].sort((a, b) => a.name.localeCompare(b.name)).map((o) => {
      const all = this.allBranches().filter((b) => b.organizationId === o.id).sort((a, b) => a.name.localeCompare(b.name));
      const orgHit = !s || o.name.toLowerCase().includes(s);
      return { o, orgHit, list: orgHit ? all : all.filter((b) => b.name.toLowerCase().includes(s)) };
    }).filter((g) => (g.orgHit || g.list.length) && (this.mode() !== 'branch' || g.list.length));
  });
  protected addOrg(id: string): void {
    this.orgs.update((l) => (l.includes(id) ? l : [...l, id]));
    // In 'any' mode a whole organization replaces single branches of it.
    if (this.mode() === 'any') { const mine = this.allBranches().filter((b) => b.organizationId === id).map((b) => b.id); this.branches.update((l) => l.filter((x) => !mine.includes(x))); }
  }
  protected addBranch(b: BranchPick): void {
    this.branches.update((l) => (l.includes(b.id) ? l : [...l, b.id]));
  }
  protected remove(c: { id: string; kind: 'org' | 'branch' }): void {
    if (c.kind === 'org') this.orgs.update((l) => l.filter((x) => x !== c.id)); else this.branches.update((l) => l.filter((x) => x !== c.id));
  }
}
