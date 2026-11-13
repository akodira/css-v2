import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Lookups, OrgRow, BranchRow, TeamRow, TeamsResult, generatePassword } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { AdminBase, CLS, TurnBack } from './admin-pages';
import { WhereEditor } from './where-editor';

// Batch 4A: Staff, Teams, Organizations and Approvals laid out as in v1 (OrgAccordion rows, role cards, add bars).

abstract class AccordionPage extends AdminBase {
  protected readonly opened = signal<string[]>([]);
  protected isOpen(id: string): boolean { return this.opened().includes(id); }
  protected toggle(id: string): void { this.opened.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  protected abstract shownIds(): string[];
  protected expandAll(): void { this.opened.set(this.shownIds()); }
}

// ================================================================== role cards and scope picker (v1 RoleCards / ScopePicker)

const ROLES = ['customer', 'agent', 'team_leader', 'admin', 'management_viewer'];
const ROLE_ICON: Record<string, string> = {
  customer: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  agent: 'M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v5H5a1 1 0 0 1-1-1v-4Zm16 0h-3v5h2a1 1 0 0 0 1-1v-4Zm-3 5c0 1.5-2 2.5-5 2.5',
  team_leader: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6.5 1a2.5 2.5 0 1 0 0-5M3 19a6 6 0 0 1 12 0m1.5-5.5A5 5 0 0 1 21 19',
  admin: 'M12 3 5 6v5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-3Zm-2.5 9 2 2 3.5-4',
  management_viewer: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
};
const SCOPED: Record<string, { icon: string; color: string }> = {
  organization: { icon: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6', color: '#7c5cd6' },
  branch: { icon: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', color: '#0e9f8e' },
};

/** Cards that say what each role can do; several staff roles may be ticked, Customer stays alone. Optional Organization / Branch Admin cards. */
@Component({
  selector: 'app-role-cards',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2" [class]="withScoped() ? 'lg:grid-cols-3 xl:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-5'">
      @for (r of shown(); track r) {
        <label class="flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border-2 border-line bg-surface p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
          <span class="flex items-center gap-2 font-bold">
            <input type="checkbox" [checked]="roles().includes(r)" (change)="flip(r)" class="h-5 w-5 shrink-0 accent-[var(--brand)]" />
            <span aria-hidden="true" class="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icon[r]" /></svg></span>
            <span>{{ 'Roles.' + r | t }}</span>
          </span>
          <span class="text-sm text-muted">{{ 'RoleGuide.' + r + '.summary' | t }}</span>
          <ul class="list-disc ps-5 text-sm marker:text-brand">@for (k of cans(r); track k) { <li>{{ k | t }}</li> }</ul>
          @if (withScoped()) { <small class="mt-auto border-t border-dashed border-line pt-2 text-xs text-muted">{{ 'RoleGuide.editable' | t }}</small> }
        </label>
      }
      @if (withScoped()) {
        @for (k of ['organization', 'branch']; track k) {
          <label [style.--c]="scopedMeta[k].color" class="flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border-2 border-line bg-surface p-3 has-[:checked]:border-[var(--c)] has-[:checked]:[background:color-mix(in_srgb,var(--c)_12%,var(--color-surface,#fff))] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
            <span class="flex items-center gap-2 font-bold">
              <input type="checkbox" [checked]="scoped() === k" (change)="pickScoped(k)" [style.accent-color]="scopedMeta[k].color" class="h-5 w-5 shrink-0" />
              <span aria-hidden="true" [style.color]="scopedMeta[k].color" class="grid size-7 shrink-0 place-items-center rounded-lg bg-bg">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="scopedMeta[k].icon" /></svg></span>
              <span>{{ 'RoleGuide.' + k + '_admin.title' | t }}</span>
            </span>
            <span class="self-start rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok">{{ 'RoleGuide.tag' | t }}</span>
            <span class="text-sm text-muted">{{ 'RoleGuide.' + k + '_admin.summary' | t }}</span>
            <ul class="list-disc ps-5 text-sm marker:text-brand">@for (c of cans(k + '_admin', 5); track c) { <li>{{ c | t }}</li> }</ul>
            <small class="mt-auto border-t border-dashed border-line pt-2 text-xs text-muted">{{ 'RoleGuide.editable' | t }}</small>
          </label>
        }
      }
    </div>`,
})
export class RoleCards {
  private readonly i18n = inject(I18n);
  readonly roles = model<string[]>([]);
  readonly scoped = model<string | null>(null);
  readonly exclude = input<string[]>([]);
  readonly withScoped = input(false);
  protected readonly icon = ROLE_ICON;
  protected readonly scopedMeta = SCOPED;
  protected readonly shown = computed(() => ROLES.filter((r) => !this.exclude().includes(r)));
  protected cans(r: string, max = 9): string[] { return Array.from({ length: max }, (_, i) => `RoleGuide.${r}.can${i + 1}`).filter((k) => this.i18n.has(k)); }
  protected flip(r: string): void {
    this.scoped.set(null);
    this.roles.update((cur) => {
      if (r === 'customer') return cur.includes('customer') ? [] : ['customer'];
      const without = cur.filter((x) => x !== 'customer');
      return without.includes(r) ? without.filter((x) => x !== r) : [...without, r];
    });
  }
  protected pickScoped(k: string): void {
    if (this.scoped() === k) { this.scoped.set(null); return; }
    this.scoped.set(k); this.roles.set([]);
  }
}

interface Pick { id: string; name: string }
interface BranchPick { id: string; organizationId: string; name: string }

/** Tick the organizations (or branches) an Organization / Branch Admin will manage. */
@Component({
  selector: 'app-scope-picker',
  imports: [TPipe, Req],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [style.--c]="color()" [style.border-color]="color()" class="mt-1 rounded-2xl border-2 p-4 [background:color-mix(in_srgb,var(--c)_5%,var(--color-surface,#fff))]">
      <h3 class="text-base font-bold">{{ (isOrg() ? 'RoleGuide.scopeOrgTitle' : 'RoleGuide.scopeBranchTitle') | t }}<app-req /></h3>
      <p class="mt-1 text-sm text-muted">{{ (isOrg() ? 'RoleGuide.scopeOrgHint' : 'RoleGuide.scopeBranchHint') | t }}</p>
      <div class="my-3 flex flex-wrap gap-2">
        <input type="search" dir="auto" [value]="q()" (input)="q.set($any($event.target).value)" (keydown.enter)="$event.preventDefault()"
          [attr.aria-label]="(isOrg() ? 'RoleGuide.searchOrgs' : 'RoleGuide.searchBranches') | t" [placeholder]="(isOrg() ? 'RoleGuide.searchOrgs' : 'RoleGuide.searchBranches') | t"
          class="min-h-11 min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 text-base" />
        <button type="button" [class]="btn" (click)="setMany(shownIds(), true)">{{ 'RoleGuide.selectShown' | t }}</button>
        <button type="button" [class]="btn" (click)="picked.set([])">{{ 'RoleGuide.clear' | t }}</button>
      </div>
      <div class="mb-3 flex min-h-8 flex-wrap items-center gap-1.5" aria-live="polite">
        @for (id of picked(); track id) {
          <span [style.background-color]="color()" class="inline-flex items-center gap-1.5 rounded-full py-0.5 ps-3 pe-1 text-sm font-semibold text-white">
            <span dir="auto">{{ labelOf(id) }}</span>
            <button type="button" [attr.aria-label]="'RoleGuide.remove' | t: { name: labelOf(id) }" (click)="flip(id)" class="grid size-5 cursor-pointer place-items-center rounded-full bg-white/30 text-xs">✕</button>
          </span>
        } @empty { <span class="text-sm text-muted">{{ 'RoleGuide.none' | t }}</span> }
      </div>
      <div class="max-h-80 overflow-y-auto rounded-lg border border-line bg-surface">
        @if (isOrg()) {
          @for (o of shownOrgs(); track o.id) {
            <label class="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-3 text-sm last:border-b-0 hover:bg-bg">
              <input type="checkbox" [checked]="picked().includes(o.id)" (change)="flip(o.id)" [style.accent-color]="color()" class="size-5 shrink-0" /><span dir="auto">{{ o.name }}</span></label>
          }
        } @else {
          @for (g of groups(); track g.o.id) {
            <div>
              <div class="flex min-h-11 items-center gap-3 border-b border-line bg-bg px-3 text-sm font-bold">
                <span class="min-w-0 flex-1" dir="auto">{{ g.o.name }} <small class="font-normal text-muted">{{ 'RoleGuide.branchesN' | t: { n: g.list.length } }}</small></span>
                <button type="button" [class]="btn" (click)="setMany(ids(g.list), !allIn(g.list))">{{ (allIn(g.list) ? 'RoleGuide.clearGroup' : 'RoleGuide.selectAll') | t }}</button>
              </div>
              @for (b of g.shown; track b.id) {
                <label class="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line ps-10 pe-3 text-sm last:border-b-0 hover:bg-bg">
                  <input type="checkbox" [checked]="picked().includes(b.id)" (change)="flip(b.id)" [style.accent-color]="color()" class="size-5 shrink-0" /><span dir="auto">{{ b.name }}</span></label>
              }
            </div>
          }
        }
        @if (!shownIds().length) { <p class="p-3 text-sm text-muted">{{ 'RoleGuide.noMatch' | t }}</p> }
      </div>
      <p class="mt-2 text-sm text-muted">{{ 'RoleGuide.count' | t: { n: picked().length, shown: shownIds().length, total: isOrg() ? orgs().length : branches().length } }}</p>
      @if (error()) { <p role="alert" class="mt-1 text-sm font-medium text-danger">{{ error() }}</p> }
    </section>`,
})
export class ScopePicker {
  readonly kind = input.required<string>();
  readonly orgs = input<Pick[]>([]);
  readonly branches = input<BranchPick[]>([]);
  readonly error = input<string | null>(null);
  readonly picked = model<string[]>([]);
  protected readonly q = signal('');
  protected readonly btn = 'min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg';
  protected readonly isOrg = computed(() => this.kind() === 'organization');
  protected readonly color = computed(() => SCOPED[this.kind()]?.color ?? '#7c5cd6');
  private readonly needle = computed(() => this.q().trim().toLowerCase());
  protected readonly shownOrgs = computed(() => [...this.orgs()].sort((a, b) => a.name.localeCompare(b.name)).filter((o) => !this.needle() || o.name.toLowerCase().includes(this.needle())));
  protected readonly groups = computed(() => [...this.orgs()].sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => { const list = this.branches().filter((b) => b.organizationId === o.id).sort((a, b) => a.name.localeCompare(b.name)); return { o, list, shown: list.filter((b) => !this.needle() || b.name.toLowerCase().includes(this.needle()) || o.name.toLowerCase().includes(this.needle())) }; })
    .filter((g) => g.shown.length));
  protected readonly shownIds = computed(() => (this.isOrg() ? this.shownOrgs().map((o) => o.id) : this.groups().flatMap((g) => g.shown.map((b) => b.id))));
  protected ids(l: BranchPick[]): string[] { return l.map((b) => b.id); }
  protected allIn(l: BranchPick[]): boolean { return l.every((b) => this.picked().includes(b.id)); }
  protected labelOf(id: string): string {
    if (this.isOrg()) return this.orgs().find((o) => o.id === id)?.name ?? id;
    const b = this.branches().find((x) => x.id === id);
    return b ? `${this.orgs().find((o) => o.id === b.organizationId)?.name ?? '?'} · ${b.name}` : id;
  }
  protected flip(id: string): void { this.picked.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  protected setMany(ids: string[], on: boolean): void { this.picked.update((l) => (on ? [...new Set([...l, ...ids])] : l.filter((x) => !ids.includes(x)))); }
}

// ================================================================== staff (v1 /admin/users)

interface Place { org: string; branch: string | null }
interface StaffRow {
  id: string; fullName: string; email: string; phone: string | null; status: string; roles: string[]; createdAt: string; isSelf: boolean; mfa: boolean;
  typeNameEn: string | null; typeNameAr: string | null; scopeLevel: string | null; accessKind: 'all' | 'none' | 'list'; access: Place[]; leads: string[];
  teams: { nameEn: string; nameAr: string }[];
}
interface StaffData { me: string; orgs: Pick[]; branches: BranchPick[]; staff: StaffRow[] }

/** The body of one staff row: status, what they reach, roles, turn back and edit details (v1 AdminUserBody). */
@Component({
  selector: 'app-staff-body',
  imports: [TPipe, FormsModule, RoleCards, WhereEditor, TurnBack, Req],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    @let u = user();
    <div class="flex flex-col">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-semibold"><span dir="auto">{{ u.fullName || '-' }}</span> @if (u.isSelf) { <span class="text-sm font-medium text-muted">({{ 'AdminUsers.you' | t }})</span> }</p>
          <p class="break-all text-sm text-muted" dir="ltr">{{ u.email }}</p>
          <p class="mt-1 text-sm text-muted">{{ 'Status.' + u.status | t }} · {{ i18n.day(u.createdAt) }}@if (u.mfa) { · {{ 'Mfa.badge' | t }} }</p>
          @if (u.mfa && !u.isSelf) { <button type="button" [class]="quiet + ' mt-2'" [disabled]="busy()" (click)="act.emit({ kind: 'mfa' })">{{ 'Mfa.reset' | t }}</button> }
        </div>
        @if (!u.isSelf && u.status !== 'pending_verification' && u.status !== 'pending_approval') {
          <button type="button" [class]="quiet" [disabled]="busy()" (click)="act.emit({ kind: 'status', value: u.status === 'suspended' ? 'active' : 'suspended' })">{{ (u.status === 'suspended' ? 'AdminUsers.reactivate' : 'AdminUsers.suspend') | t }}</button>
        }
      </div>
      <div class="mt-4 rounded-lg border border-line bg-bg p-3 text-sm">
        <p class="font-semibold">{{ 'AdminUsers.scopeTitle' | t }}</p>
        <ul class="mt-1 flex flex-col gap-1 text-muted">
          @if (u.typeNameEn) { <li>{{ 'AdminUsers.accountType' | t }}: <b class="text-ink" dir="auto">{{ i18n.pick(u.typeNameEn, u.typeNameAr) }}</b></li> }
          <li>{{ 'AdminUsers.access' | t }}: <b class="text-ink" dir="auto">{{ accessText() }}</b></li>
          @if (u.teams.length) { <li>{{ 'AdminUsers.teamLine' | t }}: <b class="text-ink" dir="auto">{{ teamsText() }}</b></li> }
          @if (u.leads.length > 4) {
            <li><details><summary class="cursor-pointer">{{ 'AdminUsers.leads' | t }}: <b class="text-ink">{{ 'AdminUsers.leadsCount' | t: { n: u.leads.length } }}</b></summary><p class="mt-1 text-ink" dir="auto">{{ u.leads.join(' · ') }}</p></details></li>
          } @else if (u.leads.length) { <li>{{ 'AdminUsers.leads' | t }}: <b class="text-ink" dir="auto">{{ u.leads.join(' · ') }}</b></li> }
        </ul>
      </div>
      @if (!u.roles.includes('admin') && (u.scopeLevel || u.roles.includes('agent') || u.roles.includes('team_leader') || u.roles.includes('management_viewer'))) {
        <div class="mt-4 rounded-lg border border-line bg-bg p-3 [&>div]:mt-0 [&>div]:border-0 [&>div]:pt-0"><app-where-editor [userId]="u.id" [lk]="lk()" /></div>
      }
      <form class="mt-4 flex flex-col gap-3" novalidate (ngSubmit)="act.emit({ kind: 'roles', roles: roles })">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-semibold">{{ 'AdminUsers.roles' | t }}</legend>
          <p class="text-sm text-muted">{{ 'RoleGuide.intro' | t }}</p>
          <app-role-cards [(roles)]="roles" [exclude]="['customer']" />
          <p class="text-sm text-muted">{{ 'RoleGuide.note' | t }}</p>
        </fieldset>
        <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminUsers.save' | t }}</button></div>
      </form>
      @if (!u.isSelf) {
        <div class="mt-4 border-t border-line pt-3 [&_.mt-4]:mt-0 [&_.border-t]:border-0 [&_.pt-4]:pt-0">
          <app-turn-back [userId]="u.id" (done)="act.emit({ kind: 'reload' })" />
        </div>
      }
      <details class="mt-4 border-t border-line pt-3">
        <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Directory.editDetails' | t }}</summary>
        <form class="mt-3 flex flex-col gap-4 border-t border-line pt-4" novalidate (ngSubmit)="act.emit({ kind: 'details', details: d })">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.name' | t }}<app-req /></span><input name="n" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="d.fullName" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.email' | t }}<app-req /></span><input name="e" type="email" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="d.email" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.phone' | t }}<input name="p" dir="ltr" placeholder="+20 10 1234 5678" [class]="cls.input + ' font-normal'" [(ngModel)]="d.phone" /></label>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
            @if (!u.isSelf) {
              @if (asking()) {
                <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60" [disabled]="busy()" (click)="asking.set(false); act.emit({ kind: 'delete' })">{{ 'Directory.deleteYes' | t }}</button>
                <button type="button" [class]="quiet" (click)="asking.set(false)">{{ 'Directory.cancel' | t }}</button>
              } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set(true)">{{ 'Directory.delete' | t }}</button> }
              <p class="basis-full text-xs text-muted">{{ 'Directory.deleteHintUser' | t }}</p>
            }
          </div>
        </form>
      </details>
    </div>`,
})
export class StaffBody implements OnInit {
  protected readonly i18n = inject(I18n);
  protected readonly cls = CLS;
  protected readonly quiet = 'min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60';
  readonly user = input.required<StaffRow>();
  readonly lk = input<Lookups | null>(null);
  readonly busy = input(false);
  readonly act = output<{ kind: string; value?: string; roles?: string[]; details?: { fullName: string; email: string; phone: string } }>();
  protected readonly asking = signal(false);
  protected roles: string[] = [];
  protected d = { fullName: '', email: '', phone: '' };
  ngOnInit(): void {
    const u = this.user();
    this.roles = [...u.roles];
    this.d = { fullName: u.fullName, email: u.email, phone: u.phone ?? '' };
  }
  private place(p: Place): string { return p.branch ? `${p.org} · ${p.branch}` : `${p.org} (${this.i18n.t('Directory.allBranches')})`; }
  protected accessText(): string {
    const u = this.user();
    if (u.accessKind === 'all') return this.i18n.t('Directory.allOrgs');
    if (u.accessKind === 'none') return this.i18n.t('Directory.noAccess');
    return u.access.length > 4 ? this.i18n.t('AdminUsers.accessMany', { n: u.access.length }) : u.access.map((p) => this.place(p)).join(' · ');
  }
  protected teamsText(): string { return this.user().teams.map((t) => this.i18n.pick(t.nameEn, t.nameAr)).join(' · '); }
}

@Component({
  selector: 'app-admin-staff',
  imports: [TPipe, Alert, FormsModule, RoleCards, ScopePicker, StaffBody, Req],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminUsers.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminUsers.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <details class="rounded-xl border border-line bg-surface shadow-card" #add>
        <summary class="cursor-pointer px-5 py-4 text-lg font-bold">{{ 'Directory.addStaff' | t }}</summary>
        <div class="flex flex-col gap-3 px-5 pb-5">
          @if (created(); as c) { <app-alert tone="success">{{ 'Directory.createdUser' | t: c }}</app-alert> }
          <form class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" novalidate (ngSubmit)="create(add)">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.name' | t }}<app-req /></span><input name="n" dir="auto" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.fullName" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.email' | t }}<app-req /></span><input name="e" type="email" dir="ltr" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.email" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.phone' | t }}<input name="p" dir="ltr" placeholder="+20 10 1234 5678" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.phone" /></label>
              <div class="flex flex-col gap-1.5">
                <label for="nw-pw" class="text-sm font-semibold">{{ 'Directory.tempPassword' | t }}<app-req /></label>
                <span class="flex gap-2"><input id="nw-pw" name="w" dir="ltr" autocomplete="off" [class]="cls.input" [(ngModel)]="nw.password" />
                  <button type="button" (click)="nw.password = gen()" class="min-h-11 shrink-0 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Directory.generate' | t }}</button></span>
                <p class="text-sm text-muted">{{ 'Directory.tempPasswordHint' | t }}</p>
              </div>
            </div>
            <fieldset class="flex flex-col gap-2">
              <legend class="text-sm font-semibold">{{ 'Directory.roles' | t }}<app-req /></legend>
              <p class="text-sm text-muted">{{ 'RoleGuide.intro' | t }}</p>
              <app-role-cards [(roles)]="nwRoles" [(scoped)]="nwScoped" [exclude]="['customer']" [withScoped]="true" />
              <p class="flex items-start gap-2 rounded-lg bg-brand-soft p-3 text-sm text-brand-ink">{{ 'RoleGuide.permNote' | t }}</p>
              @if (nwScoped) {
                <app-scope-picker [kind]="nwScoped" [orgs]="data()?.orgs ?? []" [branches]="data()?.branches ?? []" [(picked)]="nwPicked" [error]="scopeError() ? ('AdminCommon.errors.scopeRequired' | t) : null" />
              }
            </fieldset>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </div>
      </details>
      @if (data() && !data()!.staff.length) { <p class="text-muted">{{ 'AdminUsers.empty' | t }}</p> }
      @else if (data()) {
        <div class="flex flex-col gap-4">
          
  <div class="flex flex-wrap items-center gap-3">
    <label class="sr-only" for="acc-q">{{ 'AdminUsers.searchLabel' | t }}</label>
    <input id="acc-q" type="search" dir="auto" [placeholder]="'AdminUsers.searchPlaceholder' | t" [value]="q()" (input)="q.set($any($event.target).value)"
      class="min-h-11 min-w-60 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="expandAll()">{{ 'AdminOrgs.expandAll' | t }}</button>
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="opened.set([])">{{ 'AdminOrgs.collapseAll' | t }}</button>
  </div>
          @if (!filtered().length) { <p class="text-muted">{{ 'AdminUsers.noMatch' | t }}</p> }
          <ul class="flex flex-col gap-4">
            @for (u of filtered(); track u.id) {
              
  <li class="overflow-hidden rounded-xl border bg-surface shadow-card" [class.border-brand]="isOpen(u.id)" [class.border-line]="!isOpen(u.id)">
    <h2><button type="button" [attr.aria-expanded]="isOpen(u.id)" [attr.aria-controls]="'acc-' + u.id" (click)="toggle(u.id)"
      class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(u.id) ? 'bg-brand-soft' : 'hover:bg-bg'">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="shrink-0 transition-transform" [class]="isOpen(u.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
      <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-lg font-bold" dir="auto">{{ u.fullName || '-' }}</span>
                  <span class="text-lg font-bold text-brand-ink">({{ roleNames(u) }})</span>
                  @if (u.isSelf) { <span class="text-sm font-medium text-muted">({{ 'AdminUsers.you' | t }})</span> }
                  <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="u.status === 'active' ? 'bg-ok-soft text-ok' : u.status === 'pending_approval' ? 'bg-warn-soft text-warn-ink' : 'bg-bg text-muted'">{{ 'Status.' + u.status | t }}</span>
                </span>
                <span class="mt-0.5 block text-sm text-muted"><span dir="ltr">{{ u.email }}</span>@if (u.typeNameEn) { · <span dir="auto">{{ i18n.pick(u.typeNameEn, u.typeNameAr) }}</span> }</span>
              </span></button></h2>
    <div [id]="'acc-' + u.id" [hidden]="!isOpen(u.id)" class="border-t border-line px-5 pb-5 pt-4">
                @if (isOpen(u.id)) { <app-staff-body [user]="u" [lk]="lk()" [busy]="busy()" (act)="action(u, $event)" /> }
              </div></li>
            }
          </ul>
        </div>
      }
    </main>`,
})
export class AdminStaffPage extends AccordionPage implements OnInit {
  protected readonly data = signal<StaffData | null>(null);
  protected readonly created = signal<{ email: string; password: string } | null>(null);
  protected readonly scopeError = signal(false);
  protected nw = { fullName: '', email: '', phone: '', password: '' };
  protected nwRoles: string[] = ['agent'];
  protected nwScoped: string | null = null;
  protected nwPicked: string[] = [];
  protected readonly filtered = computed(() => {
    const s = this.q().trim().toLowerCase();
    return (this.data()?.staff ?? []).filter((u) => !s || [u.fullName, u.email, u.phone ?? '', this.roleNames(u), ...u.teams.flatMap((t) => [t.nameEn, t.nameAr]),
      ...u.access.map((a) => a.org + ' ' + (a.branch ?? '')), ...u.leads, u.typeNameEn ?? '', u.typeNameAr ?? ''].join(' ').toLowerCase().includes(s));
  });
  protected shownIds(): string[] { return this.filtered().map((u) => u.id); }
  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> { try { this.data.set(await this.api.get<StaffData>('staff')); } catch (e) { this.fail(e); } }
  protected roleNames(u: StaffRow): string { return u.roles.map((r) => this.i18n.t('Roles.' + r)).join(', '); }
  protected gen(): string { return generatePassword(); }
  protected async create(box: HTMLDetailsElement): Promise<void> {
    this.scopeError.set(!!this.nwScoped && !this.nwPicked.length);
    if (this.scopeError()) return;
    const body = {
      ...this.nw, roles: this.nwScoped ? ['agent'] : this.nwRoles, scoped: this.nwScoped,
      orgs: this.nwScoped === 'organization' ? this.nwPicked : [], branches: this.nwScoped === 'branch' ? this.nwPicked : [],
    };
    this.created.set(null);
    if (await this.run(() => this.api.post('staff', body))) {
      this.msg.set(null);
      this.created.set({ email: body.email, password: body.password });
      this.nw = { fullName: '', email: '', phone: '', password: '' }; this.nwRoles = ['agent']; this.nwScoped = null; this.nwPicked = [];
      box.open = true;
    }
  }
  protected action(u: StaffRow, a: { kind: string; value?: string; roles?: string[]; details?: unknown }): void {
    switch (a.kind) {
      case 'mfa': void this.run(() => this.api.post(`users/${u.id}/reset-mfa`, {})); break;
      case 'status': void this.run(() => this.api.post(`users/${u.id}/status`, { status: a.value }), 'AdminUsers.updated'); break;
      case 'roles': void this.run(() => this.api.put(`users/${u.id}/roles`, { roles: a.roles }), 'AdminUsers.updated'); break;
      case 'details': void this.run(() => this.api.put(`users/${u.id}/details`, a.details)); break;
      case 'delete': void this.run(() => this.api.del('users/' + u.id), 'AdminV2.deleted'); break;
      case 'reload': void this.reload(); break;
    }
  }
}

// ================================================================== teams (v1 /admin/teams)

@Component({
  selector: 'app-admin-teams',
  imports: [TPipe, Alert, FormsModule, Req],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminTeams.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminTeams.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <details class="rounded-xl border border-line bg-surface shadow-card" #add>
        <summary class="cursor-pointer px-5 py-4 text-lg font-bold">{{ 'Directory.addTeam' | t }}</summary>
        <div class="px-5 pb-5">
          <form class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" novalidate (ngSubmit)="create(add)">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameEn' | t }}<app-req /></span><input name="en" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.nameEn" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameAr' | t }}<app-req /></span><input name="ar" dir="rtl" lang="ar" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.nameAr" /></label>
            </div>
            <fieldset class="flex flex-col gap-1">
              <legend class="mb-1 text-sm font-semibold">{{ 'Directory.membersOptional' | t }}</legend>
              @if (!(data()?.candidates ?? []).length) { <p class="text-sm text-muted">{{ 'Directory.noStaffToPick' | t }}</p> } @else {
                <ul class="grid max-h-64 grid-cols-1 gap-x-6 overflow-y-auto rounded-lg border border-line p-2 md:grid-cols-2">
                  @for (c of data()!.candidates; track c.id) {
                    <li class="flex min-h-11 items-center justify-between gap-2">
                      <label class="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5 accent-[var(--brand)]" [checked]="nwMembers.has(c.id)" (change)="flipSet(nwMembers, c.id)" /><span class="truncate" dir="auto">{{ c.fullName }} ({{ c.email }})</span></label>
                      <label class="flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-bg px-3 text-xs font-bold text-muted hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white">
                        <input type="checkbox" class="sr-only" [checked]="nwLeaders.has(c.id)" (change)="flipSet(nwLeaders, c.id)" />
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z" /></svg>{{ 'Directory.leaderShort' | t }}</label>
                    </li>
                  }
                </ul>
              }
            </fieldset>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </div>
      </details>
      @if (data() && !data()!.candidates.length) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminTeams.noStaff' | t }}</p> }
      @if (data()) {
        <div class="flex flex-col gap-4">
          
  <div class="flex flex-wrap items-center gap-3">
    <label class="sr-only" for="acc-q">{{ 'AdminTeams.searchLabel' | t }}</label>
    <input id="acc-q" type="search" dir="auto" [placeholder]="'AdminTeams.searchPlaceholder' | t" [value]="q()" (input)="q.set($any($event.target).value)"
      class="min-h-11 min-w-60 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="expandAll()">{{ 'AdminOrgs.expandAll' | t }}</button>
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="opened.set([])">{{ 'AdminOrgs.collapseAll' | t }}</button>
  </div>
          @if (!filtered().length) { <p class="text-muted">{{ 'AdminTeams.noMatch' | t }}</p> }
          <ul class="flex flex-col gap-4">
            @for (t of filtered(); track t.id) {
              
  <li class="overflow-hidden rounded-xl border bg-surface shadow-card" [class.border-brand]="isOpen(t.id)" [class.border-line]="!isOpen(t.id)">
    <h2><button type="button" [attr.aria-expanded]="isOpen(t.id)" [attr.aria-controls]="'acc-' + t.id" (click)="toggle(t.id)"
      class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(t.id) ? 'bg-brand-soft' : 'hover:bg-bg'">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="shrink-0 transition-transform" [class]="isOpen(t.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
      <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
                  <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="t.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (t.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
                </span>
                <span class="mt-0.5 block text-sm text-muted">{{ 'AdminTeams.memberCount' | t: { count: t.members.length } }} · {{ 'Directory.teamLeader' | t }}: <span dir="auto">{{ leaders(t) || '-' }}</span></span>
              </span></button></h2>
    <div [id]="'acc-' + t.id" [hidden]="!isOpen(t.id)" class="border-t border-line px-5 pb-5 pt-4">
                <div class="flex flex-col gap-4">
                  <div class="flex justify-end"><button type="button" class="min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60" [disabled]="busy()" (click)="setActive(t, !t.isActive)">{{ (t.isActive ? 'Directory.deactivate' : 'Directory.activate') | t }}</button></div>
                  @if (!t.members.length) { <p class="text-muted">{{ 'AdminTeams.none' | t }}</p> } @else {
                    <ul class="flex flex-col gap-2">
                      @for (mb of t.members; track mb.userId) {
                        <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                          <span><span class="font-semibold" dir="auto">{{ mb.fullName }}</span>{{ ' ' }}<span class="text-sm text-muted" dir="ltr">{{ mb.email }}</span>
                            @if (mb.isLeader) { <span class="ms-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">{{ 'AdminTeams.leader' | t }}</span> }</span>
                          <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60" [disabled]="busy()" (click)="removeMember(t, mb.userId)">{{ 'AdminTeams.remove' | t }}<span class="sr-only"> {{ mb.fullName }}</span></button>
                        </li>
                      }
                    </ul>
                  }
                  <form class="flex flex-col gap-3 border-t border-line pt-4" novalidate (ngSubmit)="addMember(t)">
                    <h3 class="font-bold">{{ 'AdminTeams.add' | t }}</h3>
                    <select [name]="'am' + t.id" [attr.aria-label]="'AdminTeams.selectUser' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" [(ngModel)]="adding[t.id]">
                      <option [ngValue]="undefined" disabled>{{ 'AdminTeams.selectUser' | t }}</option>
                      @for (c of free(t); track c.id) { <option [ngValue]="c.id">{{ c.fullName }} ({{ c.email }})</option> }
                    </select>
                    <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="'al' + t.id" class="h-5 w-5" [(ngModel)]="asLeader[t.id]" />{{ 'AdminTeams.asLeader' | t }}</label>
                    <div><button type="submit" [class]="cls.btn" [disabled]="busy() || !adding[t.id]">{{ 'AdminTeams.save' | t }}</button></div>
                  </form>
                  <details class="border-t border-line pt-3">
                    <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Directory.editDetails' | t }}</summary>
                    <form class="mt-3 flex flex-col gap-4 border-t border-line pt-4" novalidate (ngSubmit)="update(t)">
                      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameEn' | t }}<app-req /></span><input name="en" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].nameEn" /></label>
                        <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameAr' | t }}<app-req /></span><input name="ar" dir="rtl" lang="ar" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].nameAr" /></label>
                      </div>
                      <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="act" class="h-5 w-5" [(ngModel)]="edit[t.id].isActive" /> {{ 'Directory.active' | t }}</label>
                      <div class="flex flex-wrap items-center gap-3">
                        <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                        
    @if (confirmDel() === t.id) {
      <span class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
        <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60" [disabled]="busy()" (click)="remove(t)">{{ 'Directory.deleteYes' | t }}</button>
        <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="confirmDel.set(null)">{{ 'Directory.cancel' | t }}</button>
      </span>
    } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="confirmDel.set(t.id)">{{ 'Directory.delete' | t }}</button> }
                        <p class="basis-full text-xs text-muted">{{ 'Directory.deleteHintTeam' | t }}</p>
                      </div>
                    </form>
                  </details>
                </div>
              </div></li>
            }
          </ul>
        </div>
      }
    </main>`,
})
export class AdminTeamsPage extends AccordionPage implements OnInit {
  protected readonly data = signal<TeamsResult | null>(null);
  protected readonly confirmDel = signal<string | null>(null);
  protected readonly filtered = computed(() => {
    const s = this.q().trim().toLowerCase();
    return (this.data()?.teams ?? []).filter((t) => !s || [t.nameEn, t.nameAr, ...t.members.flatMap((m) => [m.fullName, m.email])].join(' ').toLowerCase().includes(s));
  });
  protected nw = { nameEn: '', nameAr: '', isActive: true };
  protected nwMembers = new Set<string>();
  protected nwLeaders = new Set<string>();
  protected adding: Record<string, string | undefined> = {};
  protected asLeader: Record<string, boolean> = {};
  protected edit: Record<string, { nameEn: string; nameAr: string; isActive: boolean }> = {};
  protected shownIds(): string[] { return this.filtered().map((t) => t.id); }
  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<TeamsResult>('teams');
      for (const t of d.teams) this.edit[t.id] = { nameEn: t.nameEn, nameAr: t.nameAr, isActive: t.isActive };
      this.adding = {}; this.asLeader = {}; this.confirmDel.set(null);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected flipSet(s: Set<string>, id: string): void { if (s.has(id)) s.delete(id); else s.add(id); }
  protected leaders(t: TeamRow): string { return t.members.filter((m) => m.isLeader).map((m) => m.fullName).join(', '); }
  protected free(t: TeamRow) { const taken = new Set(t.members.map((m) => m.userId)); return (this.data()?.candidates ?? []).filter((c) => !taken.has(c.id)); }
  private members(t: TeamRow, list: { userId: string; isLeader: boolean }[]) { return this.run(() => this.api.put(`teams/${t.id}/members`, { members: list }), 'AdminTeams.updated'); }
  private list(t: TeamRow) { return t.members.map((m) => ({ userId: m.userId, isLeader: m.isLeader })); }
  protected addMember(t: TeamRow): void { const id = this.adding[t.id]; if (id) void this.members(t, [...this.list(t), { userId: id, isLeader: !!this.asLeader[t.id] }]); }
  protected removeMember(t: TeamRow, id: string): void { void this.members(t, this.list(t).filter((m) => m.userId !== id)); }
  protected setActive(t: TeamRow, on: boolean): void { void this.run(() => this.api.put('teams/' + t.id, { nameEn: t.nameEn, nameAr: t.nameAr, isActive: on })); }
  protected async create(box: HTMLDetailsElement): Promise<void> {
    const members = [...new Set([...this.nwMembers, ...this.nwLeaders])].map((id) => ({ userId: id, isLeader: this.nwLeaders.has(id) }));
    const ok = await this.run(async () => {
      const r = await this.api.post<{ id: string }>('teams', this.nw);
      if (members.length) await this.api.put(`teams/${r.id}/members`, { members });
    });
    if (ok) { this.nw = { nameEn: '', nameAr: '', isActive: true }; this.nwMembers.clear(); this.nwLeaders.clear(); box.open = false; }
  }
  protected update(t: TeamRow): void { void this.run(() => this.api.put('teams/' + t.id, this.edit[t.id])); }
  protected remove(t: TeamRow): void { void this.run(() => this.api.del('teams/' + t.id), 'AdminV2.deleted'); }
}

// ================================================================== organizations (v1 /admin/organizations)

type PlaceModel = { name: string; location: string; phone: string; teamLeaderId: string | null; isActive: boolean; sharedAccessEnabled: boolean };
interface OrgPerson { id: string; fullName: string; email: string; phone: string | null; status: string; organizationId: string; branchId: string | null }

/** Name, location, telephone and team leader; the Active box only when editing (v1 OrganizationForm / BranchForm). */
@Component({
  selector: 'app-place-form',
  imports: [FormsModule, TPipe, Req, ReqNote],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <form [class]="row() ? 'flex flex-col gap-4 border-t border-line pt-4' : framed() ? 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-5' : 'flex flex-col gap-4'" novalidate (ngSubmit)="save.emit({ ...m })">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ (branch() ? 'Directory.branchName' : 'Directory.orgName') | t }}<app-req /></span><input name="name" dir="auto" maxlength="120" [class]="cls.input + ' font-normal'" [(ngModel)]="m.name" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.location' | t }}<input name="loc" dir="auto" maxlength="300" [class]="cls.input + ' font-normal'" [(ngModel)]="m.location" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.telephone' | t }}<input name="phone" dir="ltr" maxlength="24" placeholder="+20 2 1234 5678" [class]="cls.input + ' font-normal'" [(ngModel)]="m.phone" /></label>
        <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.teamLeader' | t }}
          <select name="leader" [class]="cls.input" [(ngModel)]="m.teamLeaderId">
            <option [ngValue]="null">{{ 'Directory.noLeader' | t }}</option>
            @for (p of leaders(); track p.id) { <option [ngValue]="p.id">{{ p.fullName }} ({{ p.email }})</option> }
          </select></label>
      </div>
      @if (row()) {
        <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'Directory.active' | t }}</label>
      }
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (row() ? 'Directory.saveChanges' : branch() ? 'Directory.addBranch' : 'Directory.addOrganization') | t }}</button>
        <app-req-note />
        @if (row()) {
          @if (asking()) {
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
              <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white" (click)="asking.set(false); remove.emit()">{{ 'Directory.deleteYes' | t }}</button>
              <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="asking.set(false)">{{ 'Directory.cancel' | t }}</button>
            </span>
          } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set(true)">{{ 'Directory.delete' | t }}</button> }
          <p class="basis-full text-xs text-muted">{{ (branch() ? 'Directory.deleteHintBranch' : 'Directory.deleteHintOrg') | t }}</p>
        }
      </div>
    </form>`,
})
export class PlaceForm implements OnInit {
  protected readonly cls = CLS;
  readonly row = input<BranchRow | OrgRow | null>(null);
  readonly branch = input(false);
  readonly framed = input(false);
  readonly leaders = input<{ id: string; fullName: string; email: string }[]>([]);
  readonly busy = input(false);
  readonly save = output<PlaceModel>();
  readonly remove = output<void>();
  protected readonly asking = signal(false);
  protected m: PlaceModel = { name: '', location: '', phone: '', teamLeaderId: null, isActive: true, sharedAccessEnabled: false };
  ngOnInit(): void { this.reset(); }
  reset(): void {
    const r = this.row();
    this.m = { name: r?.name ?? '', location: r?.location ?? '', phone: r?.phone ?? '', teamLeaderId: r?.teamLeaderId ?? null, isActive: r?.isActive ?? true, sharedAccessEnabled: (r as OrgRow | null)?.sharedAccessEnabled ?? false };
  }
}

@Component({
  selector: 'app-admin-orgs',
  imports: [TPipe, Alert, FormsModule, RouterLink, PlaceForm],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminOrgs.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminOrgs.subtitle' | t }}</p></div>
        <div class="flex flex-wrap gap-2">
          <button type="button" [attr.aria-expanded]="mode() === 'org'" (click)="mode.set(mode() === 'org' ? null : 'org')" class="min-h-11 cursor-pointer rounded-lg border px-4 text-sm font-semibold" [class]="mode() === 'org' ? on : off">{{ 'AdminOrgs.addOrgBtn' | t }}</button>
          <button type="button" [attr.aria-expanded]="mode() === 'branch'" (click)="mode.set(mode() === 'branch' ? null : 'branch')" class="min-h-11 cursor-pointer rounded-lg border px-4 text-sm font-semibold" [class]="mode() === 'branch' ? on : off">{{ 'AdminOrgs.addBranchBtn' | t }}</button>
        </div>
        @if (mode() === 'org') { <div class="basis-full rounded-xl border border-line bg-surface p-5 shadow-card"><app-place-form [framed]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createOrg($event)" /></div> }
        @if (mode() === 'branch') {
          <div class="flex basis-full flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            @if (!activeOrgs().length) { <p class="text-muted">{{ 'AdminOrgs.needOrg' | t }}</p> } @else {
              <div class="max-w-sm"><label for="branch-parent" class="mb-1 block text-sm font-semibold">{{ 'AdminOrgs.parentOrg' | t }}</label>
                <select id="branch-parent" [class]="cls.input" [(ngModel)]="parent">@for (o of activeOrgs(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }</select></div>
              <app-place-form [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createBranch(parent, $event)" />
            }
          </div>
        }
      </header>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (lk() && !leaderList().length) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminOrgs.noLeaders' | t }}</p> }
      @if (rows() && !rows()!.length) { <p class="text-muted">{{ 'AdminOrgs.empty' | t }}</p> }
      @if (rows()?.length) {
        <div class="flex flex-col gap-4">
          
  <div class="flex flex-wrap items-center gap-3">
    <label class="sr-only" for="acc-q">{{ 'AdminOrgs.searchLabel' | t }}</label>
    <input id="acc-q" type="search" dir="auto" [placeholder]="'AdminOrgs.searchPlaceholder' | t" [value]="q()" (input)="q.set($any($event.target).value)"
      class="min-h-11 min-w-60 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="expandAll()">{{ 'AdminOrgs.expandAll' | t }}</button>
    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="opened.set([])">{{ 'AdminOrgs.collapseAll' | t }}</button>
  </div>
          @if (!filtered().length) { <p class="text-muted">{{ 'AdminOrgs.noMatch' | t }}</p> }
          <ul class="flex flex-col gap-4">
            @for (o of filtered(); track o.id) {
              
  <li class="overflow-hidden rounded-xl border bg-surface shadow-card" [class.border-brand]="isOpen(o.id)" [class.border-line]="!isOpen(o.id)">
    <h2><button type="button" [attr.aria-expanded]="isOpen(o.id)" [attr.aria-controls]="'acc-' + o.id" (click)="toggle(o.id)"
      class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(o.id) ? 'bg-brand-soft' : 'hover:bg-bg'">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="shrink-0 transition-transform" [class]="isOpen(o.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
      <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-lg font-bold" dir="auto">{{ o.name }}</span>
                  <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="o.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (o.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
                </span>
                <span class="mt-0.5 block text-sm text-muted">{{ 'AdminOrgs.counts' | t: { customers: peopleOf(o.id).length, branches: o.branches.length } }} · {{ 'Directory.teamLeader' | t }}: <span dir="auto">{{ leaderLabel(o.teamLeaderId) || '-' }}</span></span>
              </span></button></h2>
    <div [id]="'acc-' + o.id" [hidden]="!isOpen(o.id)" class="border-t border-line px-5 pb-5 pt-4">
                <div class="flex flex-col gap-4">
                  <div class="flex justify-end"><button type="button" [class]="toggleBtn" [disabled]="busy()" (click)="setOrgActive(o, !o.isActive)">{{ (o.isActive ? 'Directory.deactivate' : 'Directory.activate') | t }}</button></div>
                  <dl class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div><dt class="text-sm text-muted">{{ 'Directory.location' | t }}</dt><dd class="font-semibold" dir="auto">{{ o.location || '-' }}</dd></div>
                    <div><dt class="text-sm text-muted">{{ 'Directory.telephone' | t }}</dt><dd class="font-semibold" dir="ltr">{{ o.phone || '-' }}</dd></div>
                    <div><dt class="text-sm text-muted">{{ 'Directory.teamLeader' | t }}</dt><dd class="font-semibold" dir="auto">{{ leaderLabel(o.teamLeaderId) || '-' }}</dd></div>
                  </dl>
                  <details class="border-t border-line pt-3">
                    <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Directory.editDetails' | t }}</summary>
                    <div class="mt-3 flex flex-col gap-4"><app-place-form [row]="o" [leaders]="leaderList()" [busy]="busy()" (save)="updateOrg(o, $event)" (remove)="deleteOrg(o)" /></div>
                  </details>
                  <div class="flex flex-col gap-3 border-t border-line pt-4">
                    <h3 class="text-lg font-bold">{{ 'AdminOrgs.branches' | t }}</h3>
                    @if (!o.branches.length) { <p class="text-muted">{{ 'AdminOrgs.noBranches' | t }}</p> } @else {
                      <ul class="flex flex-col gap-3">
                        @for (b of o.branches; track b.id) {
                          <li class="rounded-lg border border-line p-4">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p class="font-bold" dir="auto">{{ b.name }}@if (!b.isActive) { <span class="ms-2 rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{{ 'Directory.inactive' | t }}</span> }</p>
                                <p class="text-sm text-muted">{{ 'AdminOrgs.branchCustomers' | t: { count: branchPeople(b.id) } }}</p>
                              </div>
                              <button type="button" [class]="toggleBtn" [disabled]="busy()" (click)="setBranchActive(o, b, !b.isActive)">{{ (b.isActive ? 'Directory.deactivate' : 'Directory.activate') | t }}</button>
                            </div>
                            <dl class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <div><dt class="text-sm text-muted">{{ 'Directory.location' | t }}</dt><dd class="font-semibold" dir="auto">{{ b.location || '-' }}</dd></div>
                              <div><dt class="text-sm text-muted">{{ 'Directory.telephone' | t }}</dt><dd class="font-semibold" dir="ltr">{{ b.phone || '-' }}</dd></div>
                              <div><dt class="text-sm text-muted">{{ 'Directory.teamLeader' | t }}</dt><dd class="font-semibold" dir="auto">{{ leaderLabel(b.teamLeaderId) || '-' }}</dd></div>
                            </dl>
                            <details class="mt-3 border-t border-line pt-3">
                              <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Directory.editDetails' | t }}</summary>
                              <div class="mt-3 flex flex-col gap-4"><app-place-form [row]="b" [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="updateBranch(o, b, $event)" (remove)="deleteBranch(b)" /></div>
                            </details>
                          </li>
                        }
                      </ul>
                    }
                    <details class="rounded-lg border border-dashed border-line" #addb>
                      <summary class="cursor-pointer px-4 py-3 font-semibold">{{ 'Directory.addBranch' | t }}</summary>
                      <div class="px-4 pb-4"><app-place-form [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createBranch(o.id, $event, addb)" /></div>
                    </details>
                  </div>
                  <div class="flex flex-col gap-3 border-t border-line pt-4">
                    <h3 class="text-lg font-bold">{{ 'AdminOrgs.customers' | t }}</h3>
                    @if (!peopleOf(o.id).length) { <p class="text-muted">{{ 'AdminOrgs.noCustomers' | t }}</p> } @else {
                      <ul class="flex max-h-96 flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line">
                        @for (m of peopleOf(o.id); track m.id) {
                          <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                            <div class="min-w-0">
                              <a [routerLink]="'/' + i18n.locale() + '/console/customers/' + m.id" class="font-semibold text-brand-ink underline" dir="auto">{{ m.fullName || m.email }}</a>
                              <p class="break-all text-sm text-muted" dir="ltr">{{ m.email }}@if (m.phone) { · {{ m.phone }} }</p>
                            </div>
                            <p class="text-sm text-muted">@if (m.branchId) { <span dir="auto">{{ branchName(m.branchId) }}</span> } @else { {{ 'AdminOrgs.noBranch' | t }} } · {{ 'Status.' + m.status | t }}</p>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                </div>
              </div></li>
            }
          </ul>
        </div>
      }
    </main>`,
})
export class AdminOrgsPage extends AccordionPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly rows = signal<OrgRow[] | null>(null);
  protected readonly people = signal<OrgPerson[]>([]);
  protected readonly mode = signal<'org' | 'branch' | null>(null);
  protected readonly on = 'border-brand bg-brand text-white hover:bg-brand-ink';
  protected readonly off = 'border-line bg-surface hover:bg-bg';
  protected readonly toggleBtn = 'min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60';
  protected parent = '';
  protected readonly leaderList = computed(() => this.lk()?.leaders ?? []);
  protected readonly activeOrgs = computed(() => (this.rows() ?? []).filter((o) => o.isActive));
  protected readonly filtered = computed(() => {
    const s = this.q().trim().toLowerCase();
    if (!s) return this.rows() ?? [];
    return (this.rows() ?? []).filter((o) => {
      const theirs = this.peopleOf(o.id);
      // Names only, so a word like "test" in every demo email does not match everything; emails count when the search has "@" (v1).
      const text = [o.name, o.location ?? '', ...o.branches.flatMap((b) => [b.name, b.location ?? '']), this.leaderLabel(o.teamLeaderId).replace(/\s*\(.*\)\s*$/, ''), ...theirs.map((m) => m.fullName),
        ...(s.includes('@') ? theirs.map((m) => m.email) : [])].join(' ').toLowerCase();
      return text.includes(s);
    });
  });
  protected shownIds(): string[] { return this.filtered().map((o) => o.id); }
  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try {
      const [rows, people] = await Promise.all([this.api.get<OrgRow[]>('organizations'), this.api.get<OrgPerson[]>('organizations/people')]);
      // Same order as v1 (Postgres collation): "Al-Qalyubia" before "Alex".
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      for (const o of rows) o.branches.sort(byName);
      this.rows.set(rows.sort(byName)); this.people.set(people);
      if (!this.parent || !rows.some((o) => o.id === this.parent && o.isActive)) this.parent = rows.find((o) => o.isActive)?.id ?? '';
    } catch (e) { this.fail(e); }
  }
  protected peopleOf(org: string): OrgPerson[] { return this.people().filter((p) => p.organizationId === org); }
  protected branchPeople(b: string): number { return this.people().filter((p) => p.branchId === b).length; }
  protected override branchName(id: string): string { return this.rows()?.flatMap((o) => o.branches).find((b) => b.id === id)?.name ?? ''; }
  protected leaderLabel(id: string | null): string { const l = this.leaderList().find((p) => p.id === id); return l ? `${l.fullName} (${l.email})` : ''; }
  private body(r: OrgRow | BranchRow): PlaceModel {
    return { name: r.name, location: r.location ?? '', phone: r.phone ?? '', teamLeaderId: r.teamLeaderId, isActive: r.isActive, sharedAccessEnabled: (r as OrgRow).sharedAccessEnabled ?? false };
  }
  protected async createOrg(m: PlaceModel): Promise<void> { if (await this.run(() => this.api.post('organizations', { ...m, isActive: true }))) { this.mode.set(null); await this.loadLookups(); } }
  protected async createBranch(org: string, m: PlaceModel, box?: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('branches', { ...m, isActive: true, organizationId: org }))) { this.mode.set(null); if (box) box.open = false; await this.loadLookups(); }
  }
  protected updateOrg(o: OrgRow, m: PlaceModel): void { void this.run(() => this.api.put('organizations/' + o.id, m)); }
  protected setOrgActive(o: OrgRow, on: boolean): void { void this.run(() => this.api.put('organizations/' + o.id, { ...this.body(o), isActive: on })); }
  protected setBranchActive(o: OrgRow, b: BranchRow, on: boolean): void { void this.run(() => this.api.put('branches/' + b.id, { ...this.body(b), isActive: on, organizationId: o.id })); }
  protected async deleteOrg(o: OrgRow): Promise<void> { if (await this.run(() => this.api.del('organizations/' + o.id), 'AdminV2.deleted')) await this.loadLookups(); }
  protected updateBranch(o: OrgRow, b: BranchRow, m: PlaceModel): void { void this.run(() => this.api.put('branches/' + b.id, { ...m, organizationId: o.id })); }
  protected async deleteBranch(b: BranchRow): Promise<void> { if (await this.run(() => this.api.del('branches/' + b.id), 'AdminV2.deleted')) await this.loadLookups(); }
}

// ================================================================== approvals (v1 /console/approvals)

interface PendingRow { id: string; fullName: string; email: string; phone: string | null; createdAt: string; organizationId: string | null; branchId: string | null }
interface ApprovedRow { id: string; fullName: string; email: string; phone: string | null; organization: string | null; branch: string | null; registeredAt: string; approvedAt: string | null; approvedBy: string | null }

@Component({
  selector: 'app-admin-approvals',
  imports: [TPipe, Alert, FormsModule],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'Approvals.title' | t }}</h1>
        <p class="mt-2 max-w-prose text-muted">{{ 'Approvals.subtitle' | t }}</p>
        @if (rows()?.length) { <p role="status" class="mt-3 inline-block rounded-lg bg-warn-soft px-4 py-2 text-sm font-semibold text-warn-ink">{{ 'Approvals.count' | t: { n: rows()!.length } }}</p> }
      </header>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (rows() && !rows()!.length) { <p class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Approvals.empty' | t }}</p> }
      <ul class="flex flex-col gap-4">
        @for (u of rows() ?? []; track u.id) {
          <li class="rounded-md border border-line bg-surface p-5">
            <p class="text-lg font-bold" dir="auto">{{ u.fullName || '-' }}</p>
            <p class="mt-0.5 text-sm text-muted"><span dir="ltr">{{ u.email }}</span>@if (u.phone) { · {{ 'Approvals.phone' | t }}: <span dir="ltr">{{ u.phone }}</span> }</p>
            <p class="text-sm text-muted">{{ 'Approvals.registered' | t: { date: i18n.date(u.createdAt) } }}</p>
            <form class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" novalidate (ngSubmit)="approve(u)">
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminUsers.approve.org' | t }}
                <select [name]="'o' + u.id" [class]="cls.input + ' font-normal'" [(ngModel)]="pick[u.id].org" (ngModelChange)="pick[u.id].branch = null">
                  <option [ngValue]="null">{{ 'AdminUsers.approve.pickOrg' | t }}</option>
                  @for (o of activeOrgs(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
                </select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminUsers.approve.branch' | t }}
                <select [name]="'b' + u.id" [class]="cls.input + ' font-normal'" [(ngModel)]="pick[u.id].branch" [disabled]="!pick[u.id].org">
                  <option [ngValue]="null">{{ 'AdminUsers.approve.noBranch' | t }}</option>
                  @for (b of activeBranches(pick[u.id].org); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
                </select></label>
              <button type="submit" [class]="cls.btn" [disabled]="busy() || !pick[u.id].org">{{ 'AdminUsers.approve.submit' | t }}</button>
            </form>
            <details class="mt-3">
              <summary class="cursor-pointer text-sm font-semibold text-danger">{{ 'AdminUsers.approve.reject.summary' | t }}</summary>
              <div class="mt-3 flex flex-col gap-2">
                <label [for]="'ar' + u.id" [class]="cls.label">{{ 'AdminUsers.approve.reject.reason' | t }}</label>
                <textarea [id]="'ar' + u.id" rows="2" dir="auto" maxlength="500" [class]="cls.input + ' py-2'" [(ngModel)]="pick[u.id].reason"></textarea>
                <p class="text-sm text-muted">{{ 'AdminUsers.approve.reject.hint' | t }}</p>
                <div><button type="button" [class]="cls.danger" [disabled]="busy()" (click)="reject(u)">{{ 'AdminUsers.approve.reject.submit' | t }}</button></div>
              </div>
            </details>
          </li>
        }
      </ul>
      <section aria-labelledby="approved-h" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-baseline gap-3">
          <h2 id="approved-h" class="text-2xl font-bold tracking-tight">{{ 'Approvals.approvedTitle' | t }}</h2>
          <span class="rounded-lg bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-ink">{{ 'Approvals.approvedCount' | t: { n: done().length } }}</span>
        </div>
        <p class="max-w-prose text-sm text-muted">{{ 'Approvals.approvedSubtitle' | t }}</p>
        @if (!done().length) { <p class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Approvals.approvedEmpty' | t }}</p> } @else {
          <div class="overflow-x-auto rounded-md border border-line bg-surface">
            <table class="w-full min-w-[56rem] text-sm">
              <thead class="bg-bg text-start text-muted"><tr>
                @for (k of cols; track k) { <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Approvals.' + k | t }}</th> }
              </tr></thead>
              <tbody>
                @for (u of done(); track u.id) {
                  <tr class="border-t border-line align-top">
                    <td class="px-4 py-3 font-semibold" dir="auto">{{ u.fullName || '-' }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ u.email }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ u.phone || '-' }}</td>
                    <td class="px-4 py-3" dir="auto">{{ u.organization || '-' }}</td>
                    <td class="px-4 py-3" dir="auto">{{ u.branch || '-' }}</td>
                    <td class="whitespace-nowrap px-4 py-3">{{ i18n.date(u.registeredAt) }}</td>
                    <td class="whitespace-nowrap px-4 py-3">{{ u.approvedAt ? i18n.date(u.approvedAt) : '-' }}</td>
                    <td class="px-4 py-3" dir="auto">{{ u.approvedBy || '-' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </main>`,
})
export class AdminApprovalsPage extends AdminBase implements OnInit {
  protected readonly rows = signal<PendingRow[] | null>(null);
  protected readonly done = signal<ApprovedRow[]>([]);
  protected readonly cols = ['colName', 'colEmail', 'colPhone', 'colOrg', 'colBranch', 'colRegistered', 'colApproved', 'colApprovedBy'];
  protected pick: Record<string, { org: string | null; branch: string | null; reason: string }> = {};
  protected readonly activeOrgs = computed(() => (this.lk()?.orgs ?? []).filter((o) => (o as { isActive?: boolean }).isActive !== false));
  protected activeBranches(org: string | null) { return this.branchesOf(org).filter((b) => (b as { isActive?: boolean }).isActive !== false); }
  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try {
      const [rows, done] = await Promise.all([this.api.get<PendingRow[]>('users?kind=pending'), this.api.get<ApprovedRow[]>('approved')]);
      for (const u of rows) this.pick[u.id] ??= { org: u.organizationId, branch: u.branchId, reason: '' };
      this.rows.set(rows); this.done.set(done);
    } catch (e) { this.fail(e); }
  }
  protected approve(u: PendingRow): void { const p = this.pick[u.id]; void this.run(() => this.api.post(`users/${u.id}/approve`, { organizationId: p.org, branchId: p.branch }), 'AdminV2.approved'); }
  protected reject(u: PendingRow): void { void this.run(() => this.api.post(`users/${u.id}/reject`, { reason: this.pick[u.id].reason }), 'AdminV2.rejected'); }
}

