import { PageAbout } from '../../shared/page-about';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountTypeRow, AdminApi, Lookups, OrgRow, BranchRow, TeamRow, TeamsResult, adminError, generatePassword } from '../../core/admin-api';
import { Auth } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { AddPanel, Alert, Req, ReqNote } from '../../shared/ui';
import { STAFF_KEY, STAFF_TILE_SWITCH, TILE_TEAM } from '../../shared/tiles';
import { PhoneInput, phoneDigits } from '../../shared/phone';
import { PwEye } from '../../shared/pw-eye';
import { AdminBase, CLS, TurnBack } from './admin-pages';
import { PlacePicker, SetupGuide, roleOfType } from './staff-setup';

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

// ================================================================== staff (v1 /admin/users) — Plan B: one card per person, one Save

interface Place { org: string; branch: string | null }
interface StaffRow {
  id: string; fullName: string; email: string; phone: string | null; status: string; roles: string[]; createdAt: string; isSelf: boolean; mfa: boolean;
  typeNameEn: string | null; typeNameAr: string | null; scopeLevel: string | null; accessKind: 'all' | 'none' | 'list'; access: Place[]; leads: string[];
  teams: { teamId: string; nameEn: string; nameAr: string; isLeader: boolean }[];
  accountTypeId: string | null; autoAssign: boolean; canCreateForCustomers: boolean;
  places: { organizationId: string; branchId: string | null }[];
}
interface StaffData { me: string; orgs: Pick[]; branches: BranchPick[]; staff: StaffRow[] }

/** One person: account type (what), Works in (where), teams and ticket switches, saved together; then status, details and turn back. */
@Component({
  selector: 'app-staff-body',
  imports: [TPipe, FormsModule, RouterLink, TurnBack, Req, Alert, PlacePicker, PhoneInput],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    @let u = user();
    @let t = type();
    <div class="flex flex-col">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-semibold"><span dir="auto">{{ u.fullName || '-' }}</span> @if (u.isSelf) { <span class="text-sm font-medium text-muted">({{ 'AdminUsers.you' | t }})</span> }</p>
          <p class="break-all text-sm text-muted" dir="ltr">{{ u.email }}</p>
          <p class="mt-1 text-sm text-muted">{{ 'Status.' + u.status | t }} · {{ i18n.day(u.createdAt) }}@if (u.mfa) { · {{ 'Mfa.badge' | t }} }</p>
          @if (u.leads.length) { <p class="mt-1 text-sm text-muted">{{ 'AdminUsers.leads' | t }}: <b class="text-ink" dir="auto">{{ u.leads.length > 4 ? ('AdminUsers.leadsCount' | t: { n: u.leads.length }) : u.leads.join(' · ') }}</b></p> }
          @if (u.mfa && !u.isSelf) { <button type="button" [class]="quiet + ' mt-2'" [disabled]="busy()" (click)="act.emit({ kind: 'mfa' })">{{ 'Mfa.reset' | t }}</button> }
        </div>
        @if (!u.isSelf && u.status !== 'pending_verification' && u.status !== 'pending_approval') {
          <button type="button" [class]="quiet" [disabled]="busy()" (click)="act.emit({ kind: 'status', value: u.status === 'suspended' ? 'active' : 'suspended' })">{{ (u.status === 'suspended' ? 'AdminUsers.reactivate' : 'AdminUsers.suspend') | t }}</button>
        }
      </div>

      <form class="mt-4 flex flex-col" novalidate (ngSubmit)="save()">
        <div [class]="row">
          <div><p class="font-bold"><label [for]="'ty-' + u.id">{{ 'StaffSetup.type.title' | t }}</label><app-req /></p><p class="text-xs text-muted">{{ 'StaffSetup.type.hint' | t }}</p></div>
          <div class="flex min-w-0 flex-col gap-2">
            <select [id]="'ty-' + u.id" name="ty" [(ngModel)]="typeId" [disabled]="u.isSelf" class="min-h-11 w-full max-w-sm rounded-lg border border-line bg-surface px-3 text-base">
              @if (!typeId) { <option value="" disabled>{{ 'StaffSetup.type.notSet' | t }}</option> }
              @for (x of types(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }} · {{ 'StaffSetup.kinds.' + x.kind | t }}</option> }
            </select>
            @if (u.isSelf) { <p class="text-xs text-muted">{{ 'StaffSetup.type.self' | t }}</p> }
            @if (t) {
              <p class="text-sm text-muted">
                @for (p of canDo(); track p) { <span class="me-2 inline-block"><span aria-hidden="true" class="text-ok">✓</span> {{ 'Permissions.perm.' + p | t }}</span> }
                @if (more()) { <span class="me-2">{{ 'StaffSetup.type.more' | t: { n: more() } }}</span> }
                <a [routerLink]="'/' + i18n.locale() + '/admin/permissions/types/' + t.id" class="font-semibold text-brand-ink underline">{{ 'StaffSetup.type.change' | t }}</a>
              </p>
            }
            <p class="flex gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-ink"><span aria-hidden="true" class="font-extrabold">?</span>{{ 'StaffSetup.type.tip' | t }}</p>
          </div>
        </div>

        <div [class]="row">
          <div><p class="font-bold">{{ 'StaffSetup.where.title' | t }}@if (t && !t.isBuiltin) { <app-req /> }</p><p class="text-xs text-muted">{{ 'StaffSetup.where.hint' | t }}</p></div>
          <div class="flex min-w-0 flex-col gap-2">
            @if (!t) { <p class="text-sm text-muted">{{ 'StaffSetup.where.pickTypeFirst' | t }}</p> }
            @else if (t.isBuiltin) { <p class="text-sm">{{ 'StaffSetup.where.adminAll' | t }}</p> }
            @else {
              <app-place-picker [mode]="pickMode()" [allOrgs]="orgs()" [allBranches]="branches()" [(everywhere)]="everywhere" [(orgs)]="pOrgs" [(branches)]="pBranches" />
              <p class="flex gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-ink"><span aria-hidden="true" class="font-extrabold">?</span>{{ 'StaffSetup.where.tip' | t }}</p>
            }
          </div>
        </div>

        <div [class]="row">
          <div><p class="font-bold">{{ 'StaffSetup.teams.title' | t }}</p></div>
          <div class="flex min-w-0 flex-col gap-2">
            @if (!worksTickets()) { <p class="text-sm text-muted">{{ 'StaffSetup.teams.notFor' | t }}</p> }
            @else {
              <ul class="flex flex-wrap gap-2">
                @for (m of teams; track m.teamId) {
                  <li class="inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-bg py-0.5 ps-3 pe-1 text-sm">
                    <span dir="auto">{{ teamName(m.teamId) }}</span>
                    @if (canLead()) {
                      <label class="flex cursor-pointer items-center gap-1 text-xs font-semibold"><input type="checkbox" class="size-4" [name]="'ld-' + m.teamId" [(ngModel)]="m.isLeader" />{{ 'StaffSetup.teams.leader' | t }}</label>
                    }
                    <button type="button" class="grid size-8 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" [attr.aria-label]="'StaffSetup.where.remove' | t: { name: teamName(m.teamId) }" (click)="dropTeam(m.teamId)">✕</button>
                  </li>
                } @empty { <li class="text-sm text-muted">{{ 'StaffSetup.teams.none' | t }}</li> }
              </ul>
              @if (freeTeams().length) {
                <label class="flex max-w-sm flex-col gap-1 text-sm font-semibold">{{ 'StaffSetup.teams.add' | t }}
                  <select name="addTeam" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base font-normal" [ngModel]="''" (ngModelChange)="addTeam($event)">
                    <option value="">{{ 'StaffSetup.teams.pick' | t }}</option>
                    @for (x of freeTeams(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }
                  </select></label>
              }
            }
          </div>
        </div>

        @if (t && !t.isBuiltin) {
          <div [class]="row">
            <div><p class="font-bold">{{ 'StaffSetup.tickets.title' | t }}</p></div>
            <div class="flex flex-col gap-1">
              <label class="flex min-h-11 items-center gap-2" [class.text-muted]="!worksTickets() || !teams.length"><input type="checkbox" class="size-5" name="aa" [(ngModel)]="autoAssign" [disabled]="!worksTickets() || !teams.length" />{{ 'StaffSetup.tickets.auto' | t }}
                @if (worksTickets() && !teams.length) { <span class="text-xs">({{ 'StaffSetup.tickets.autoNeedsTeam' | t }})</span> }</label>
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="size-5" name="cc" [(ngModel)]="createFor" />{{ 'StaffSetup.tickets.create' | t }}</label>
            </div>
          </div>
        }

        @if (msg(); as m) { <div class="mt-3"><app-alert [tone]="m.tone">{{ m.text }}</app-alert></div> }
        <div class="mt-3 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <button type="button" [class]="quiet" (click)="reset()">{{ 'StaffSetup.cancel' | t }}</button>
          <button type="submit" [class]="cls.btn" [disabled]="saving() || !typeId">{{ 'StaffSetup.save' | t }}</button>
        </div>
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
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.phone' | t }}<input name="p" appPhone dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="d.phone" /></label>
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
  private readonly api = inject(AdminApi);
  protected readonly cls = CLS;
  protected readonly quiet = 'min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60';
  protected readonly row = 'grid grid-cols-1 gap-2 border-t border-line py-4 first:border-t-0 md:grid-cols-[11rem_1fr] md:gap-4';
  readonly user = input.required<StaffRow>();
  readonly types = input<AccountTypeRow[]>([]);
  readonly lk = input<Lookups | null>(null);
  readonly orgs = input<Pick[]>([]);
  readonly branches = input<BranchPick[]>([]);
  readonly busy = input(false);
  readonly act = output<{ kind: string; value?: string; details?: { fullName: string; email: string; phone: string } }>();
  protected readonly asking = signal(false);
  protected readonly saving = signal(false);
  protected readonly msg = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected typeIdSig = signal('');
  protected get typeId(): string { return this.typeIdSig(); }
  protected set typeId(v: string) { this.typeIdSig.set(v); }
  protected everywhere = true;
  protected pOrgs: string[] = [];
  protected pBranches: string[] = [];
  protected teams: { teamId: string; isLeader: boolean }[] = [];
  protected autoAssign = false;
  protected createFor = false;
  protected d = { fullName: '', email: '', phone: '' };
  protected readonly type = computed(() => this.types().find((x) => x.id === this.typeIdSig()) ?? null);
  protected readonly role = computed(() => roleOfType(this.type()));
  protected readonly worksTickets = computed(() => this.role() === 'agent' || this.role() === 'team_leader');
  protected readonly canLead = computed(() => this.role() === 'team_leader');
  protected readonly pickMode = computed<'any' | 'organization' | 'branch'>(() => (this.type()?.scopeLevel as 'organization' | 'branch' | null) ?? 'any');
  protected readonly canDo = computed(() => (this.type()?.permissions ?? []).slice(0, 5));
  protected readonly more = computed(() => Math.max(0, (this.type()?.permissions.length ?? 0) - 5));
  protected freeTeams() { return (this.lk()?.teams ?? []).filter((x) => x.isActive && !this.teams.some((m) => m.teamId === x.id)); }
  protected teamName(id: string): string { const x = this.lk()?.teams.find((y) => y.id === id); return x ? this.i18n.pick(x.nameEn, x.nameAr) : '?'; }
  ngOnInit(): void { this.reset(); }
  protected reset(): void {
    const u = this.user();
    this.typeId = u.accountTypeId ?? '';
    this.pOrgs = u.places.filter((p) => !p.branchId).map((p) => p.organizationId);
    this.pBranches = u.places.filter((p) => p.branchId).map((p) => p.branchId!);
    this.everywhere = u.places.length === 0;
    this.teams = u.teams.map((m) => ({ teamId: m.teamId, isLeader: m.isLeader }));
    this.autoAssign = u.autoAssign; this.createFor = u.canCreateForCustomers;
    this.d = { fullName: u.fullName, email: u.email, phone: phoneDigits(u.phone) };
    this.msg.set(null);
  }
  protected addTeam(id: string): void { if (id && !this.teams.some((m) => m.teamId === id)) this.teams = [...this.teams, { teamId: id, isLeader: false }]; }
  protected dropTeam(id: string): void { this.teams = this.teams.filter((m) => m.teamId !== id); }
  protected async save(): Promise<void> {
    const scoped = this.pickMode();
    const body = {
      accountTypeId: this.typeId, everywhere: scoped === 'any' && this.everywhere,
      orgs: scoped === 'branch' ? [] : this.pOrgs, branches: scoped === 'organization' ? [] : this.pBranches,
      teams: this.worksTickets() ? this.teams : [], autoAssign: this.autoAssign, canCreateForCustomers: this.createFor,
    };
    this.saving.set(true); this.msg.set(null);
    try {
      await this.api.put(`users/${this.user().id}/setup`, body);
      this.msg.set({ tone: 'success', text: this.i18n.t('StaffSetup.saved') });
      this.act.emit({ kind: 'saved' });
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.saving.set(false); }
  }
}

@Component({
  selector: 'app-admin-staff',
  imports: [TPipe, Alert, AddPanel, FormsModule, PhoneInput, StaffBody, Req, ReqNote, PwEye, SetupGuide, PlacePicker],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminUsers.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'StaffSetup.staffSubtitle' | t }}</p></div>
        <app-add #add label="Directory.addStaff">
        <div class="flex flex-col gap-3">
          @if (created(); as c) { <app-alert tone="success">{{ 'Directory.createdUser' | t: c }}</app-alert> }
          <form class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5" novalidate (ngSubmit)="create(add)">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.name' | t }}<app-req /></span><input name="n" dir="auto" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.fullName" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.email' | t }}<app-req /></span><input name="e" type="email" dir="ltr" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.email" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Directory.phone' | t }}<input name="p" appPhone dir="ltr" autocomplete="off" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.phone" /></label>
              <div class="flex flex-col gap-1.5">
                <label for="nw-pw" class="text-sm font-semibold">{{ 'Directory.tempPassword' | t }}<app-req /></label>
                <span class="flex gap-2"><span class="relative min-w-0 flex-1"><input #nwpw id="nw-pw" name="w" type="password" dir="ltr" autocomplete="new-password" [class]="cls.input + ' w-full pe-11'" [(ngModel)]="nw.password" /><app-pw-eye [target]="nwpw" /></span>
                  <button type="button" (click)="nw.password = gen()" class="min-h-11 shrink-0 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Directory.generate' | t }}</button></span>
                <p class="text-sm text-muted">{{ 'Directory.tempPasswordHint' | t }}</p>
              </div>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'StaffSetup.type.title' | t }}<app-req /></span>
                <select name="ty" [class]="cls.input + ' font-normal'" [ngModel]="nwType()" (ngModelChange)="nwType.set($event)">
                  <option value="" disabled>{{ 'StaffSetup.type.pick' | t }}</option>
                  @for (x of types(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }} · {{ 'StaffSetup.kinds.' + x.kind | t }}</option> }
                </select>
                <span class="text-xs font-normal text-muted">{{ 'StaffSetup.type.tip' | t }}</span></label>
            </div>
            @if (nwTypeRow(); as t) {
              @if (!t.isBuiltin) {
                <fieldset class="flex flex-col gap-2">
                  <legend class="text-sm font-semibold">{{ 'StaffSetup.where.title' | t }}<app-req /></legend>
                  <app-place-picker [mode]="$any(t.scopeLevel ?? 'any')" [allOrgs]="data()?.orgs ?? []" [allBranches]="data()?.branches ?? []" [(everywhere)]="nwEverywhere" [(orgs)]="nwOrgs" [(branches)]="nwBranches" />
                  <p class="text-xs text-muted">{{ 'StaffSetup.where.tip' | t }}</p>
                </fieldset>
              } @else { <p class="text-sm text-muted">{{ 'StaffSetup.where.adminAll' | t }}</p> }
            }
            <p class="text-sm text-muted">{{ 'StaffSetup.teamsLater' | t }}</p>
            <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button><app-req-note /></div>
            @if (msg(); as m) { @if (m.tone === 'error') { <app-alert tone="error">{{ m.text }}</app-alert> } }
          </form>
        </div>
        </app-add>
      </div>
      <app-setup-guide #guide page="staff" [autoNeeds]="wantNeeds()" (needs)="showNeeds(guide.needIds())" />
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (data() && !data()!.staff.length) { <p class="text-muted">{{ 'AdminUsers.empty' | t }}</p> }
      @else if (data()) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <label class="sr-only" for="acc-q">{{ 'AdminUsers.searchLabel' | t }}</label>
            <input id="acc-q" type="search" dir="auto" [placeholder]="'AdminUsers.searchPlaceholder' | t" [value]="q()" (input)="q.set($any($event.target).value)"
              class="min-h-11 min-w-60 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
            <label class="sr-only" for="acc-t">{{ 'Permissions.filterType' | t }}</label>
            <select id="acc-t" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event); needIds.set(null)">
              <option value="">{{ 'Permissions.allTypes' | t }}</option>
              @for (x of types(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }
            </select>
            @if (needIds()) { <button type="button" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-warn-soft px-4 text-sm font-semibold text-warn-ink" (click)="needIds.set(null)">{{ 'StaffSetup.filterNeeds' | t }} ✕</button> }
            <span class="text-sm text-muted">{{ 'Permissions.staffCount' | t: { n: filtered().length } }}</span>
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="expandAll()">{{ 'AdminOrgs.expandAll' | t }}</button>
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="opened.set([])">{{ 'AdminOrgs.collapseAll' | t }}</button>
          </div>
          ${STAFF_KEY}
          @if (!filtered().length) { <p class="text-muted">{{ 'AdminUsers.noMatch' | t }}</p> }
          <ul class="flex flex-col gap-4">
            @for (u of filtered(); track u.id) {
              <li class="overflow-hidden rounded-xl border bg-surface shadow-card" [class.border-brand]="isOpen(u.id)" [class.border-line]="!isOpen(u.id)">
                <h2><button type="button" [attr.aria-expanded]="isOpen(u.id)" [attr.aria-controls]="'acc-' + u.id" (click)="toggle(u.id)"
                  class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(u.id) ? 'bg-brand-soft' : 'hover:bg-bg'">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                    class="shrink-0 transition-transform" [class]="isOpen(u.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
                  @let kind = staffKind(u);
                  ${STAFF_TILE_SWITCH}
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-2">
                      <span class="text-lg font-bold" dir="auto">{{ u.fullName || '-' }}</span>
                      @if (u.typeNameEn) { <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand-ink" dir="auto">{{ i18n.pick(u.typeNameEn, u.typeNameAr) }}</span> }
                      @else if (!u.roles.includes('admin')) { <span class="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn-ink">{{ 'StaffSetup.needsType' | t }}</span> }
                      @if (u.isSelf) { <span class="text-sm font-medium text-muted">({{ 'AdminUsers.you' | t }})</span> }
                      <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="u.status === 'active' ? 'bg-ok-soft text-ok' : u.status === 'pending_approval' ? 'bg-warn-soft text-warn-ink' : 'bg-bg text-muted'">{{ 'Status.' + u.status | t }}</span>
                    </span>
                    <span class="mt-0.5 block text-sm text-muted"><span dir="ltr">{{ u.email }}</span> · <span dir="auto">{{ whereText(u) }}</span>@if (u.teams.length) { · <span dir="auto">{{ teamsText(u) }}</span> }</span>
                  </span></button></h2>
                <div [id]="'acc-' + u.id" [hidden]="!isOpen(u.id)" class="border-t border-line px-5 pb-5 pt-4">
                  @if (isOpen(u.id)) { <app-staff-body [user]="u" [types]="types()" [lk]="lk()" [orgs]="data()!.orgs" [branches]="data()!.branches" [busy]="busy()" (act)="action(u, $event, guide)" /> }
                </div></li>
            }
          </ul>
        </div>
      }
    </main>`,
})
export class AdminStaffPage extends AccordionPage implements OnInit {
  /** Which icon a person gets: their role, and for admins of places the level of their place. */
  protected staffKind(u: StaffRow): string {
    if (u.roles.includes('admin')) return 'admin';
    if (!u.typeNameEn) return 'none';
    if (u.scopeLevel === 'organization') return 'org';
    if (u.scopeLevel === 'branch') return 'branch';
    return u.roles.includes('team_leader') ? 'leader' : u.roles.includes('agent') ? 'agent' : 'viewer';
  }
  private readonly route = inject(ActivatedRoute);
  protected readonly data = signal<StaffData | null>(null);
  protected readonly types = signal<AccountTypeRow[]>([]);
  protected readonly created = signal<{ email: string; password: string } | null>(null);
  protected readonly typeFilter = signal('');
  protected readonly needIds = signal<string[] | null>(null);
  protected readonly wantNeeds = signal(false);
  protected nw = { fullName: '', email: '', phone: '', password: '' };
  protected readonly nwType = signal('');
  protected readonly nwTypeRow = computed(() => this.types().find((x) => x.id === this.nwType()) ?? null);
  protected nwEverywhere = true;
  protected nwOrgs: string[] = [];
  protected nwBranches: string[] = [];
  protected readonly filtered = computed(() => {
    const s = this.q().trim().toLowerCase(), ty = this.typeFilter(), need = this.needIds();
    return (this.data()?.staff ?? []).filter((u) => (!ty || u.accountTypeId === ty) && (!need || need.includes(u.id)) && (!s || [u.fullName, u.email, u.phone ?? '', ...u.teams.flatMap((t) => [t.nameEn, t.nameAr]),
      ...u.access.map((a) => a.org + ' ' + (a.branch ?? '')), ...u.leads, u.typeNameEn ?? '', u.typeNameAr ?? ''].join(' ').toLowerCase().includes(s)));
  });
  protected shownIds(): string[] { return this.filtered().map((u) => u.id); }
  async ngOnInit(): Promise<void> {
    const m = this.route.snapshot.queryParamMap;
    this.typeFilter.set(m.get('type') ?? '');
    this.wantNeeds.set(m.get('need') === '1');
    await Promise.all([this.loadLookups(), this.reload()]);
    const open = m.get('open');
    if (open && this.data()?.staff.some((u) => u.id === open)) this.openPerson(open);
  }
  /** A link from Teams (?open=id): that person's card, opened and scrolled into view. */
  private openPerson(id: string): void {
    this.opened.set([id]);
    setTimeout(() => { const el = document.getElementById('acc-' + id)?.closest('li'); el?.scrollIntoView({ block: 'start' }); el?.querySelector<HTMLElement>('h2 button')?.focus({ preventScroll: true }); }, 50);
  }
  protected async reload(): Promise<void> {
    try {
      const [d, t] = await Promise.all([this.api.get<StaffData>('staff'), this.api.get<AccountTypeRow[]>('account-types')]);
      this.data.set(d); this.types.set(t);
    } catch (e) { this.fail(e); }
  }
  /** "Show them" in the guide: only the people who still need an account type or a place. */
  protected showNeeds(ids: string[]): void { this.typeFilter.set(''); this.needIds.set(ids); this.opened.set(ids.slice(0, 1)); }
  protected whereText(u: StaffRow): string {
    if (u.roles.includes('admin') || u.accessKind === 'all') return this.i18n.t('StaffSetup.where.everywhere');
    if (u.accessKind === 'none') return this.i18n.t('StaffSetup.where.noAccess');
    const line = (p: Place) => (p.branch ? `${p.org} · ${p.branch}` : this.i18n.t('StaffSetup.where.allOf', { org: p.org }));
    return u.access.length > 3 ? this.i18n.t('AdminUsers.accessMany', { n: u.access.length }) : u.access.map(line).join(' · ');
  }
  protected teamsText(u: StaffRow): string { return u.teams.map((t) => this.i18n.pick(t.nameEn, t.nameAr) + (t.isLeader ? ` (${this.i18n.t('StaffSetup.teams.leader')})` : '')).join(', '); }
  protected gen(): string { return generatePassword(); }
  protected async create(box: { open: boolean }): Promise<void> {
    const t = this.nwTypeRow();
    const scoped = t?.scopeLevel ?? null;
    const body = {
      ...this.nw, accountTypeId: this.nwType() || null, everywhere: !scoped && this.nwEverywhere,
      orgs: scoped === 'branch' ? [] : this.nwOrgs, branches: scoped === 'organization' ? [] : this.nwBranches,
    };
    if (!body.accountTypeId) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminCommon.errors.typeRequired') }); return; }
    this.created.set(null);
    if (await this.run(() => this.api.post('staff', body))) {
      this.msg.set(null);
      this.created.set({ email: body.email, password: body.password });
      this.nw = { fullName: '', email: '', phone: '', password: '' }; this.nwType.set(''); this.nwEverywhere = true; this.nwOrgs = []; this.nwBranches = [];
      box.open = true;
    }
  }
  protected action(u: StaffRow, a: { kind: string; value?: string; details?: unknown }, guide: SetupGuide): void {
    switch (a.kind) {
      case 'mfa': void this.run(() => this.api.post(`users/${u.id}/reset-mfa`, {})); break;
      case 'status': void this.run(() => this.api.post(`users/${u.id}/status`, { status: a.value }), 'AdminUsers.updated'); break;
      case 'details': void this.run(() => this.api.put(`users/${u.id}/details`, a.details)); break;
      case 'delete': void this.run(() => this.api.del('users/' + u.id), 'AdminV2.deleted'); break;
      case 'saved': void this.refresh(guide); break;
      case 'reload': void this.reload(); break;
    }
  }
  /** After a person card saves: new list and guide, the card stays open (its own message says Saved). */
  private async refresh(guide: SetupGuide): Promise<void> {
    try { const d = await this.api.get<StaffData>('staff'); this.data.set(d); } catch (e) { this.fail(e); }
    await guide.reload();
  }
}

// ================================================================== teams per place (v1 /admin/teams)

interface CatPeople {
  teams: { id: string; kindId: string; members: { userId: string; fullName: string }[] }[];
  categories: { id: string; nameEn: string; nameAr: string; teamKindId: string; isActive: boolean }[];
  chosen: { categoryId: string; teamId: string; userId: string }[];
}
const METHODS = ['fewest', 'turns', 'shared', 'leader'];

@Component({
  selector: 'app-admin-teams',
  imports: [TPipe, Alert, AddPanel, FormsModule, RouterLink, Req, ReqNote, PageAbout],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h1 class="flex items-center gap-3 text-3xl font-bold tracking-tight"><span aria-hidden="true" class="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">${TILE_TEAM}</span>{{ 'AdminTeams.title' | t }}</h1>
        <div class="flex flex-wrap items-start gap-3">
        @if (choosePlaces().length) {
          <button type="button" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-soft px-4 font-semibold text-brand-ink hover:bg-brand/15" [attr.aria-expanded]="choosing()" (click)="choosing.set(!choosing())">+ {{ 'PlaceCat.chooseCurrent' | t }}</button>
        }
        <app-add #add label="Directory.addTeam">
          <form class="flex flex-col gap-4" novalidate (ngSubmit)="create(add)">
            @if (!(data()?.kinds ?? []).length) { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'TeamPlace.noKinds' | t }}</p> }
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.kind' | t }}<app-req /></span>
                <select name="kind" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.kindId"><option value="">{{ 'TeamPlace.pickKind' | t }}</option>
                  <optgroup [label]="'TeamPlace.kindsSystem' | t">@for (k of kindsFor(nw.place, 'system'); track k.id) { <option [value]="k.id">{{ i18n.pick(k.nameEn, k.nameAr) }}</option> }</optgroup>
                  @if (kindsFor(nw.place, 'own').length) { <optgroup [label]="'TeamPlace.kindsOwn' | t">@for (k of kindsFor(nw.place, 'own'); track k.id) { <option [value]="k.id">{{ i18n.pick(k.nameEn, k.nameAr) }}</option> }</optgroup> }
                  <option value="new">{{ 'TeamPlace.newKindOption' | t }}</option></select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.place' | t }}<app-req /></span>
                <select name="place" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.place">
                  @for (p of places(); track p.value) { <option [value]="p.value">{{ p.label }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.method' | t }}</span>
                <select name="method" [class]="cls.input + ' font-normal'" [(ngModel)]="nw.assignMethod"><option value="">{{ 'TeamPlace.methodDefault' | t: { name: methodName(data()?.defaultMethod) } }}</option>
                  @for (m of methods; track m) { <option [value]="m">{{ methodName(m) }}</option> }</select></label>
            </div>
            @if (nw.kindId === 'new') {
              <div class="grid grid-cols-1 gap-4 rounded-xl bg-brand-soft/50 p-4 md:grid-cols-2">
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.newKindEn' | t }}<app-req /></span><input name="nke2" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="nk2.nameEn" /></label>
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.newKindAr' | t }}<app-req /></span><input name="nka2" dir="rtl" lang="ar" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="nk2.nameAr" /></label>
                <p class="text-sm text-muted md:col-span-2">{{ (nw.place ? 'TeamPlace.newKindPlaceHint' : 'TeamPlace.newKindSystemHint') | t }}</p>
              </div>
            }
            <p class="text-sm text-muted">{{ 'TeamPlace.nameAuto' | t }}</p>
            <fieldset class="flex flex-col gap-1">
              <legend class="mb-1 text-sm font-semibold">{{ 'Directory.membersOptional' | t }}</legend>
              <p class="text-sm text-muted">{{ 'TeamPlace.membersOfPlace' | t }}</p>
              @if (!candidatesFor(nw.place).length) { <p class="text-sm text-muted">{{ 'Directory.noStaffToPick' | t }}</p> } @else {
                <ul class="grid max-h-64 grid-cols-1 gap-x-6 overflow-y-auto rounded-lg border border-line p-2 md:grid-cols-2">
                  @for (c of candidatesFor(nw.place); track c.id) {
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
            <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy() || !nw.kindId">{{ 'Directory.create' | t }}</button><app-req-note /></div>
          </form>
        </app-add>
        </div>
      </div>
      @if (choosing()) {
        <section class="flex flex-col gap-3 rounded-xl border border-line border-t-4 border-t-brand bg-surface p-5 shadow-card" aria-labelledby="chk">
          <div class="flex flex-wrap items-start justify-between gap-3"><div><h2 id="chk" class="text-lg font-bold">{{ 'PlaceCat.chooseKinds' | t }}</h2><p class="text-sm text-muted">{{ 'PlaceCat.chooseKindsHint' | t }}</p></div>
            <button type="button" class="min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold text-muted hover:bg-bg" (click)="choosing.set(false)">✕ {{ 'Directory.cancel' | t }}</button></div>
          <label class="flex max-w-md flex-col gap-1.5 text-sm font-semibold">{{ 'TeamPlace.place' | t }}
            <select name="chp" [class]="cls.input + ' font-normal'" [(ngModel)]="chPlace" (ngModelChange)="chosen.clear()">@for (p of choosePlaces(); track p.value) { <option [value]="p.value">{{ p.label }}</option> }</select></label>
          @if (!offeredKinds(chPlace).length) { <p class="text-sm text-muted">{{ 'PlaceCat.nothingLeft' | t }}</p> } @else {
            <ul class="flex flex-col gap-2">
              @for (k of offeredKinds(chPlace); track k.id) {
                <li><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [checked]="chosen.has(k.id)" (change)="flipSet(chosen, k.id)" />
                  <span><b dir="auto">{{ i18n.pick(k.nameEn, k.nameAr) }}</b><span class="block text-sm text-muted">{{ (k.organizationId ? 'PlaceCat.fromOrg' : 'PlaceCat.fromSystem') | t: { name: orgLabel(k.organizationId ?? '') } }}</span></span></label></li>
              }
            </ul>
            <div><button type="button" [class]="cls.btn" [disabled]="busy() || !chosen.size" (click)="useKinds()">{{ 'PlaceCat.useSelected' | t }}</button></div>
          }
        </section>
      }
      <app-page-about key="teams" tile="users" [points]="['ticket', 'eye', 'swap', 'crown']" />
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      @if (data()?.canCentral || myKinds().length) {
        <details class="rounded-xl border border-line bg-surface shadow-card" [open]="data()?.canCentral && !myKinds().length">
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'TeamPlace.kindsTitle' | t }}</span> <span class="text-sm text-muted">· {{ 'TeamPlace.kindsHelp' | t }}</span></summary>
          <div class="flex flex-col gap-3 border-t border-line p-5">
            @for (k of myKinds(); track k.id) {
              <form class="flex flex-wrap items-end gap-3 border-b border-line pb-3" novalidate (ngSubmit)="saveKind(k)">
                <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm font-semibold">{{ 'Directory.nameEn' | t }}<input [name]="'ke' + k.id" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="k.nameEn" /></label>
                <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm font-semibold">{{ 'Directory.nameAr' | t }}<input [name]="'ka' + k.id" dir="rtl" lang="ar" [class]="cls.input + ' font-normal'" [(ngModel)]="k.nameAr" /></label>
                <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" [name]="'kc' + k.id" [(ngModel)]="k.centralFallback" />{{ 'TeamPlace.centralFallback' | t }}</label>
                <button type="submit" [class]="cls.btn2" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-60" [disabled]="busy()" (click)="deleteKind(k)">{{ 'Directory.delete' | t }}<span class="sr-only"> {{ k.nameEn }}</span></button>
              </form>
            }
            @if (data()?.canCentral) {
            <form class="flex flex-wrap items-end gap-3" novalidate (ngSubmit)="addKind()">
              <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm font-semibold"><span>{{ 'TeamPlace.newKindEn' | t }}<app-req /></span><input name="nke" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="nk.nameEn" /></label>
              <label class="flex min-w-48 flex-1 flex-col gap-1 text-sm font-semibold"><span>{{ 'TeamPlace.newKindAr' | t }}<app-req /></span><input name="nka" dir="rtl" lang="ar" [class]="cls.input + ' font-normal'" [(ngModel)]="nk.nameAr" /></label>
              <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'TeamPlace.addKind' | t }}</button>
            </form>
            }
          </div>
        </details>
      }

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
          @for (g of groups(); track g.key) {
          <section class="flex flex-col gap-3">
            <h2 class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted"><span>{{ g.label }}</span><span class="h-px flex-1 bg-line"></span></h2>
          <ul class="flex flex-col gap-4">
            @for (t of g.teams; track t.id) {
  <li class="overflow-hidden rounded-xl border bg-surface shadow-card" [class.border-brand]="isOpen(t.id)" [class.border-line]="!isOpen(t.id)">
    <h3><button type="button" [attr.aria-expanded]="isOpen(t.id)" [attr.aria-controls]="'acc-' + t.id" (click)="toggle(t.id)"
      class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(t.id) ? 'bg-[#f7f9fd]' : 'hover:bg-bg'">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="shrink-0 text-muted transition-transform" [class]="isOpen(t.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
      <span aria-hidden="true" class="hidden size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink sm:grid">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="t.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (t.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
        </span>
        <span class="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold text-muted">
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ t.members.length }}</b> {{ 'AdminTeams.statMembers' | t }}</span>
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ leaderCount(t) }}</b> {{ 'AdminTeams.statLeaders' | t }}</span>
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ autoCount(t) }}</b> {{ 'AdminTeams.statAuto' | t }}</span>
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ t.openTickets ?? 0 }}</b> {{ 'AdminTeams.statOpen' | t }}</span>
          <span class="rounded-md border border-line bg-brand-soft px-2 py-0.5 text-brand-ink">{{ methodName(t.assignMethod || data()?.defaultMethod) }}</span>
        </span>
      </span>
      <span aria-hidden="true" class="hidden shrink-0 md:flex">
        @for (mb of t.members.slice(0, 5); track mb.userId) {
          <span class="-ms-2 grid size-9 place-items-center rounded-full border-2 border-surface text-xs font-bold first:ms-0" [class]="avatarTone(mb.userId)">{{ initials(mb.fullName) }}</span>
        }
        @if (t.members.length > 5) { <span class="-ms-2 grid size-9 place-items-center rounded-full border-2 border-surface bg-bg text-xs font-bold text-muted">+{{ t.members.length - 5 }}</span> }
      </span>
    </button></h3>
    <div [id]="'acc-' + t.id" [hidden]="!isOpen(t.id)" class="border-t border-line">
      @let tab = teamTab[t.id] ?? 'members';
      <div role="tablist" class="flex gap-1 border-b border-line px-5">
        @for (k of teamTabs; track k) {
          <button type="button" role="tab" [attr.aria-selected]="tab === k" (click)="teamTab[t.id] = k"
            class="-mb-px inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-sm font-semibold"
            [class]="tab === k ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">
            {{ 'AdminTeams.tab_' + k | t }}@if (k === 'members') { <span class="rounded-full bg-bg px-2 text-xs">{{ t.members.length }}</span> }</button>
        }
      </div>

      @if (tab === 'members') {
        <div class="flex flex-col gap-4 p-5">
          <form class="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-[#fafcff] p-3" novalidate (ngSubmit)="addMember(t)">
            <select [name]="'am' + t.id" [attr.aria-label]="'AdminTeams.selectUser' | t" class="min-h-11 min-w-60 flex-1 rounded-lg border border-line bg-surface px-3 text-base" [(ngModel)]="adding[t.id]">
              <option [ngValue]="undefined" disabled>{{ 'AdminTeams.selectUser' | t }}</option>
              @for (c of free(t); track c.id) { <option [ngValue]="c.id">{{ c.fullName }} ({{ c.email }})</option> }
            </select>
            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" role="switch" [name]="'al' + t.id" class="peer sr-only" [(ngModel)]="asLeader[t.id]" />
              <span aria-hidden="true" class="relative inline-block h-6 w-10 rounded-full bg-[#cfd8e8] transition peer-checked:bg-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:start-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:start-[1.1rem]"></span>
              {{ 'AdminTeams.leaderSwitch' | t }}</label>
            <button type="submit" [class]="cls.btn" [disabled]="busy() || !adding[t.id]">{{ 'AdminTeams.save' | t }}</button>
          </form>
          @if (!t.members.length) { <p class="text-muted">{{ 'AdminTeams.none' | t }}</p> } @else {
            <ul class="overflow-hidden rounded-xl border border-line">
              @for (mb of t.members; track mb.userId) {
                <li class="flex flex-wrap items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-[#f7f9fd]">
                  <span aria-hidden="true" class="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold" [class]="avatarTone(mb.userId)">{{ initials(mb.fullName) }}</span>
                  <span class="min-w-40 flex-1">@if (data()?.canCentral) { <a [routerLink]="'/' + i18n.locale() + '/admin/users'" [queryParams]="{ open: mb.userId }" class="block font-bold text-brand-ink hover:underline" dir="auto"
                    [attr.aria-label]="'AdminTeams.openProfile' | t: { name: mb.fullName }">{{ mb.fullName }}</a> } @else { <span class="block font-bold" dir="auto">{{ mb.fullName }}</span> }<span class="block text-xs text-muted" dir="ltr">{{ mb.email }}</span></span>
                  <span class="rounded-full px-2 py-0.5 text-xs font-semibold" [class]="mb.isLeader ? 'bg-brand-soft text-brand-ink' : 'bg-bg text-muted'">{{ (mb.isLeader ? 'AdminTeams.leader' : 'AdminTeams.agent') | t }}</span>
                  <span class="hidden min-w-20 text-xs text-muted sm:inline">{{ 'AdminTeams.openCount' | t: { count: mb.openTickets ?? 0 } }}</span>
                  <span class="hidden rounded-full px-2 py-0.5 text-xs font-semibold sm:inline" [class]="mb.autoAssign ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (mb.autoAssign ? 'AdminTeams.autoOn' : 'AdminTeams.autoOff') | t }}</span>
                  <span class="flex gap-1">
                    @if (mb.isLeader || canLead(mb.userId)) {
                      <button type="button" class="min-h-10 cursor-pointer rounded-lg px-2.5 text-sm font-semibold text-muted hover:bg-bg hover:text-ink disabled:opacity-60" [disabled]="busy()" (click)="setLeader(t, mb.userId, !mb.isLeader)">{{ (mb.isLeader ? 'AdminTeams.unLeader' : 'AdminTeams.makeLeader') | t }}<span class="sr-only"> {{ mb.fullName }}</span></button>
                    }
                    <button type="button" class="min-h-10 cursor-pointer rounded-lg px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-60" [disabled]="busy()" (click)="removeMember(t, mb.userId)">{{ 'AdminTeams.remove' | t }}<span class="sr-only"> {{ mb.fullName }}</span></button>
                  </span>
                </li>
              }
            </ul>
          }
        </div>
      }

      @if (tab === 'categories') {
        <div class="flex flex-col gap-3 p-5">
          <p class="text-sm text-muted">{{ 'TeamPlace.catsHelp' | t }}</p>
          @if (!catsOf(t).length) { <p class="text-muted">{{ 'TeamPlace.noCats' | t }}</p> }
          @for (c of catsOf(t); track c.id) {
            @let key = c.id + '|' + t.id;
            <div class="rounded-xl border border-line p-3">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="font-semibold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span>
                <select [attr.aria-label]="'TeamPlace.whoGets' | t: { name: i18n.pick(c.nameEn, c.nameAr) }" class="min-h-11 rounded-lg border border-line bg-surface px-3" [ngModel]="pick[key] ? 'some' : 'all'" (ngModelChange)="setMode(key, $event)">
                  <option value="all">{{ 'TeamPlace.whoAll' | t }}</option><option value="some">{{ 'TeamPlace.whoSome' | t }}</option></select>
              </div>
              @if (pick[key]; as set) {
                <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  @for (mb of t.members; track mb.userId) {
                    <label class="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" [checked]="set.has(mb.userId)" (change)="flipSet(set, mb.userId)" />{{ mb.fullName }}</label>
                  }
                </div>
              }
              <div class="mt-2"><button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="saveCat(c.id, t)">{{ 'AdminCommon.save' | t }}</button></div>
            </div>
          }
        </div>
      }

      @if (tab === 'settings') {
        <div class="flex flex-col gap-4 p-5">
          <form class="flex flex-col gap-4" novalidate (ngSubmit)="update(t)">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.kind' | t }}<app-req /></span>
                <select name="kind" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].kindId">@for (k of kindsFor(edit[t.id].place, 'all'); track k.id) { <option [value]="k.id">{{ i18n.pick(k.nameEn, k.nameAr) }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.place' | t }}<app-req /></span>
                <select name="place" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].place">@for (p of places(); track p.value) { <option [value]="p.value">{{ p.label }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'TeamPlace.method' | t }}</span>
                <select name="method" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].assignMethod"><option value="">{{ 'TeamPlace.methodDefault' | t: { name: methodName(data()?.defaultMethod) } }}</option>
                  @for (m of methods; track m) { <option [value]="m">{{ methodName(m) }}</option> }</select>
                <span class="text-xs font-normal text-muted">{{ 'TeamPlace.methodHelp_' + (edit[t.id].assignMethod || data()?.defaultMethod || 'fewest') | t }}</span></label>
            </div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameEn' | t }}</span><input name="en" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].nameEn" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Directory.nameAr' | t }}</span><input name="ar" dir="rtl" lang="ar" [class]="cls.input + ' font-normal'" [(ngModel)]="edit[t.id].nameAr" /></label>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="act" class="h-5 w-5" [(ngModel)]="edit[t.id].isActive" /> {{ 'AdminTeams.activeLong' | t }}</label>
              <span class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button><app-req-note /></span>
            </div>
          </form>
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f1c7c3] bg-[#fffafa] p-4">
            <div class="max-w-prose"><b>{{ 'AdminTeams.delTitle' | t }}</b><p class="text-sm text-muted">{{ 'Directory.deleteHintTeam' | t }}</p></div>
            @if (confirmDel() === t.id) {
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60" [disabled]="busy()" (click)="remove(t)">{{ 'Directory.deleteYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg" (click)="confirmDel.set(null)">{{ 'Directory.cancel' | t }}</button>
              </span>
            } @else { <button type="button" [class]="cls.danger" (click)="confirmDel.set(t.id)">{{ 'Directory.delete' | t }}</button> }
          </div>
        </div>
      }
    </div></li>
            }
          </ul>
          </section>
          }
          @if ((data()?.borrowed ?? []).length) {
            <section class="flex flex-col gap-3" aria-labelledby="borrowed">
              <h2 id="borrowed" class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted"><span>{{ 'TeamPlace.borrowedTitle' | t }}</span><span class="h-px flex-1 bg-line"></span></h2>
              <ul class="flex flex-col gap-4">
                @for (b of data()!.borrowed!; track b.organizationId + (b.branchId ?? '') + b.kindId) {
                  <li class="rounded-xl border border-line bg-surface shadow-card">
                    <div class="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span aria-hidden="true" class="hidden size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink sm:grid">${TILE_TEAM}</span>
                      <span class="min-w-0 flex-1">
                        <span class="flex flex-wrap items-center gap-2">
                          <span class="text-lg font-bold" dir="auto">{{ b.team ? i18n.pick(b.team.nameEn, b.team.nameAr) : i18n.pick(b.nameEn, b.nameAr) }}</span>
                          <span class="rounded-full bg-[#efe8fd] px-2 py-0.5 text-xs font-bold text-[#5b3aa8]">{{ 'TeamPlace.usedBy' | t: { name: b.placeName } }}</span>
                        </span>
                        @if (b.team; as tm) {
                          <span class="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold text-muted">
                            <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ tm.members.length }}</b> {{ 'AdminTeams.statMembers' | t }}</span>
                            <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ tm.openTickets }}</b> {{ 'AdminTeams.statOpen' | t }}</span>
                            <span class="rounded-md border border-line bg-brand-soft px-2 py-0.5 text-brand-ink">{{ methodName(tm.assignMethod || data()?.defaultMethod) }}</span>
                          </span>
                        }
                      </span>
                      @if (b.team; as tm) {
                        <span aria-hidden="true" class="hidden shrink-0 md:flex">
                          @for (mb of tm.members.slice(0, 5); track $index) { <span class="-ms-2 grid size-9 place-items-center rounded-full border-2 border-surface text-xs font-bold first:ms-0" [class]="avatarTone(mb.fullName)">{{ initials(mb.fullName) }}</span> }
                        </span>
                      }
                    </div>
                    <div class="flex flex-col gap-3 border-t border-dashed border-line px-5 py-3 text-sm text-muted">
                      <p>@if (b.team; as tm) { {{ (tm.at === 'central' ? 'TeamPlace.borrowedCentral' : 'TeamPlace.borrowedOrg') | t: { kind: i18n.pick(b.nameEn, b.nameAr) } }} } @else { <span class="text-warn-ink">{{ 'TeamPlace.borrowedNone' | t: { kind: i18n.pick(b.nameEn, b.nameAr) } }}</span> }</p>
                      <span class="flex flex-wrap gap-2">
                        <button type="button" [class]="cls.btn" (click)="ownTeam(b, add)">{{ 'TeamPlace.createOwn' | t }}</button>
                        <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="stopKind(b)">{{ 'PlaceCat.stopUsing' | t }}</button>
                      </span>
                    </div>
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      }
    </main>`,
})
export class AdminTeamsPage extends AccordionPage implements OnInit {
  protected readonly data = signal<TeamsResult | null>(null);
  protected readonly confirmDel = signal<string | null>(null);
  protected readonly methods = METHODS;
  protected readonly filtered = computed(() => {
    const s = this.q().trim().toLowerCase();
    return (this.data()?.teams ?? []).filter((t) => !s || [t.nameEn, t.nameAr, this.placeLabel(t), ...t.members.flatMap((m) => [m.fullName, m.email])].join(' ').toLowerCase().includes(s));
  });
  /** Teams under a heading per place: central first, then each organization followed by its branches. */
  protected readonly groups = computed(() => {
    const d = this.data(); if (!d) return [];
    const out: { key: string; label: string; teams: TeamRow[] }[] = [];
    const push = (key: string, label: string, teams: TeamRow[]) => { if (teams.length) out.push({ key, label, teams }); };
    const list = this.filtered();
    push('central', this.i18n.t('TeamPlace.central'), list.filter((t) => !t.organizationId));
    const orgIds = [...new Set(list.filter((t) => t.organizationId).map((t) => t.organizationId!))]
      .sort((a, b) => this.orgLabel(a).localeCompare(this.orgLabel(b)));
    for (const o of orgIds) {
      push('o' + o, this.orgLabel(o), list.filter((t) => t.organizationId === o && !t.branchId));
      const bs = [...new Set(list.filter((t) => t.organizationId === o && t.branchId).map((t) => t.branchId!))];
      for (const b of bs) push('b' + b, this.orgLabel(o) + ' · ' + this.branchLabel(b), list.filter((t) => t.branchId === b));
    }
    return out;
  });
  /** Places the caller may put a team in. Value: '' central, 'o:<id>' organization, 'b:<id>' branch. */
  protected readonly places = computed(() => {
    const d = this.data(); if (!d) return [];
    const out: { value: string; label: string }[] = [];
    if (d.canCentral) out.push({ value: '', label: this.i18n.t('TeamPlace.central') });
    for (const o of d.organizations ?? []) out.push({ value: 'o:' + o.id, label: this.i18n.t('TeamPlace.wholeOrg', { name: o.name }) });
    for (const b of d.branches ?? []) out.push({ value: 'b:' + b.id, label: this.orgLabel(b.organizationId) + ' · ' + b.name });
    return out;
  });
  protected orgLabel(id: string): string { const d = this.data(); return d?.organizations?.find((o) => o.id === id)?.name ?? d?.branches?.find((b) => b.organizationId === id)?.organizationName ?? this.orgName(id) ?? ''; }
  private branchLabel(id: string): string { return this.data()?.branches?.find((b) => b.id === id)?.name ?? this.branchName(id) ?? ''; }
  private placeLabel(t: TeamRow): string { return !t.organizationId ? this.i18n.t('TeamPlace.central') : this.orgLabel(t.organizationId) + (t.branchId ? ' · ' + this.branchLabel(t.branchId) : ''); }
  protected methodName(m: string | null | undefined): string { return this.i18n.t('TeamPlace.method_' + (m || 'fewest')); }
  private placeValue(t: TeamRow): string { return t.branchId ? 'b:' + t.branchId : t.organizationId ? 'o:' + t.organizationId : ''; }
  private placeBody(v: string): { organizationId: string | null; branchId: string | null } {
    return v.startsWith('b:') ? { organizationId: null, branchId: v.slice(2) } : v.startsWith('o:') ? { organizationId: v.slice(2), branchId: null } : { organizationId: null, branchId: null };
  }
  protected nw = { kindId: '', place: '', assignMethod: '' };
  protected nk = { nameEn: '', nameAr: '' };
  /** A new kind made while adding a team. */
  protected nk2 = { nameEn: '', nameAr: '' };
  protected readonly choosing = signal(false);
  protected chPlace = '';
  protected chosen = new Set<string>();
  private orgOf(v: string): string | null {
    if (v.startsWith('o:')) return v.slice(2);
    if (v.startsWith('b:')) return this.data()?.branches?.find((b) => b.id === v.slice(2))?.organizationId ?? null;
    return null;
  }
  private placeRef(v: string): { organizationId: string; branchId: string | null } | null {
    const o = this.orgOf(v); return o ? { organizationId: o, branchId: v.startsWith('b:') ? v.slice(2) : null } : null;
  }
  /** Kinds a place can use: the system's, and its own (an organization's own kinds also in its branches). */
  protected kindsFor(v: string, which: 'system' | 'own' | 'all') {
    const org = this.orgOf(v), br = v.startsWith('b:') ? v.slice(2) : null;
    return (this.data()?.kinds ?? []).filter((k) => {
      const own = !!k.organizationId && !!org && k.organizationId === org && (!k.branchId || k.branchId === br);
      return which === 'system' ? !k.organizationId : which === 'own' ? own : !k.organizationId || own;
    });
  }
  /** The system admin edits the system's kinds; organization and branch admins the kinds their places made. */
  protected myKinds() { const d = this.data(); return (d?.kinds ?? []).filter((k) => d?.canCentral ? !k.organizationId : !!k.organizationId); }
  /** Only staff who work in that place (nobody listed under Works in = works everywhere). */
  protected candidatesFor(v: string) {
    const org = this.orgOf(v), br = v.startsWith('b:') ? v.slice(2) : null;
    return (this.data()?.candidates ?? []).filter((c) => !org || !c.places?.length || c.places.some((p) => p.organizationId === org && (!br || !p.branchId || p.branchId === br)));
  }
  protected choosePlaces() { return this.places().filter((p) => p.value); }
  protected offeredKinds(v: string) {
    const ref = this.placeRef(v); if (!ref) return [];
    const used = new Set((this.data()?.kindUses ?? []).filter((u) => u.organizationId === ref.organizationId && (u.branchId ?? null) === ref.branchId).map((u) => u.kindId));
    return this.kindsFor(v, 'all').filter((k) => !used.has(k.id) && !(k.organizationId && (k.branchId ?? null) === ref.branchId && ref.branchId !== null));
  }
  protected async useKinds(): Promise<void> {
    const ref = this.placeRef(this.chPlace); if (!ref) return;
    if (await this.run(() => this.api.post('place-catalog/use', { ...ref, itemKind: 'kind', ids: [...this.chosen], use: true }))) { this.chosen.clear(); this.choosing.set(false); }
  }
  protected stopKind(b: { organizationId: string; branchId: string | null; kindId: string }): void {
    void this.run(() => this.api.post('place-catalog/use', { organizationId: b.organizationId, branchId: b.branchId, itemKind: 'kind', ids: [b.kindId], use: false }));
  }
  /** "Create our own team": the add form opens with the kind and place filled in. */
  protected ownTeam(b: { organizationId: string; branchId: string | null; kindId: string }, box: { open: boolean }): void {
    this.nw = { ...this.nw, kindId: b.kindId, place: b.branchId ? 'b:' + b.branchId : 'o:' + b.organizationId };
    box.open = true; window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  protected nwMembers = new Set<string>();
  protected nwLeaders = new Set<string>();
  protected adding: Record<string, string | undefined> = {};
  protected asLeader: Record<string, boolean> = {};
  protected edit: Record<string, { nameEn: string; nameAr: string; isActive: boolean; kindId: string; place: string; assignMethod: string }> = {};
  /** Category people being edited, keyed "categoryId|teamId"; missing = all staff in the team. */
  protected pick: Record<string, Set<string> | undefined> = {};
  private readonly cats = signal<CatPeople | null>(null);
  protected shownIds(): string[] { return this.filtered().map((t) => t.id); }
  async ngOnInit(): Promise<void> { await this.reload(); if (this.data()?.canCentral) await this.loadLookups(); }
  protected async reload(): Promise<void> {
    try {
      const [d, cp] = await Promise.all([this.api.get<TeamsResult>('teams'), this.api.get<CatPeople>('category-people')]);
      for (const t of d.teams) this.edit[t.id] = { nameEn: t.nameEn, nameAr: t.nameAr, isActive: t.isActive, kindId: t.kindId ?? '', place: this.placeValue(t), assignMethod: t.assignMethod ?? '' };
      this.adding = {}; this.asLeader = {}; this.confirmDel.set(null);
      this.pick = {};
      for (const c of cp.chosen) (this.pick[c.categoryId + '|' + c.teamId] ??= new Set()).add(c.userId);
      if (!this.nw.place) this.nw.place = d.canCentral ? '' : d.branches?.[0] ? 'b:' + d.branches[0].id : d.organizations?.[0] ? 'o:' + d.organizations[0].id : '';
      if (!this.chPlace) this.chPlace = d.organizations?.[0] ? 'o:' + d.organizations[0].id : d.branches?.[0] ? 'b:' + d.branches[0].id : '';
      this.cats.set(cp);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected catsOf(t: TeamRow) { return (this.cats()?.categories ?? []).filter((c) => c.teamKindId === t.kindId); }
  protected setMode(key: string, mode: string): void { this.pick[key] = mode === 'some' ? (this.pick[key] ?? new Set()) : undefined; }
  protected saveCat(categoryId: string, t: TeamRow): void {
    const set = this.pick[categoryId + '|' + t.id];
    void this.run(() => this.api.put('category-people', { categoryId, teamId: t.id, userIds: set ? [...set] : [] }));
  }
  protected flipSet(s: Set<string>, id: string): void { if (s.has(id)) s.delete(id); else s.add(id); }
  protected free(t: TeamRow) { const taken = new Set(t.members.map((m) => m.userId)); return (this.data()?.candidates ?? []).filter((c) => !taken.has(c.id)); }
  private members(t: TeamRow, list: { userId: string; isLeader: boolean }[]) { return this.run(() => this.api.put(`teams/${t.id}/members`, { members: list }), 'AdminTeams.updated'); }
  private list(t: TeamRow) { return t.members.map((m) => ({ userId: m.userId, isLeader: m.isLeader })); }
  protected addMember(t: TeamRow): void { const id = this.adding[t.id]; if (id) void this.members(t, [...this.list(t), { userId: id, isLeader: !!this.asLeader[t.id] }]); }
  protected removeMember(t: TeamRow, id: string): void { void this.members(t, this.list(t).filter((m) => m.userId !== id)); }
  protected readonly teamTabs = ['members', 'categories', 'settings'] as const;
  protected teamTab: Record<string, 'members' | 'categories' | 'settings'> = {};
  protected leaderCount(t: TeamRow): number { return t.members.filter((m) => m.isLeader).length; }
  protected autoCount(t: TeamRow): number { return t.members.filter((m) => m.autoAssign).length; }
  /** Only people holding the Team leader role can lead (the API checks it too). */
  protected canLead(id: string): boolean { return (this.data()?.candidates ?? []).some((c) => c.id === id && c.role === 'team_leader'); }
  protected setLeader(t: TeamRow, id: string, on: boolean): void { void this.members(t, this.list(t).map((m) => (m.userId === id ? { ...m, isLeader: on } : m))); }
  protected initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase(); }
  protected avatarTone(id: string): string {
    const tones = ['bg-brand-soft text-brand-ink', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn-ink', 'bg-[#efe8fd] text-[#5b3aa8]', 'bg-danger-soft text-danger'];
    let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return tones[h % tones.length];
  }
  protected async create(box: { open: boolean }): Promise<void> {
    const members = [...new Set([...this.nwMembers, ...this.nwLeaders])].map((id) => ({ userId: id, isLeader: this.nwLeaders.has(id) }));
    const body = { kindId: this.nw.kindId, ...this.placeBody(this.nw.place), nameEn: null, nameAr: null, isActive: true, assignMethod: this.nw.assignMethod || null };
    const ok = await this.run(async () => {
      // A new kind first: the system's when the team is central, else the place's own.
      if (body.kindId === 'new') body.kindId = (await this.api.post<{ id: string }>('team-kinds', { ...this.nk2, centralFallback: true, sortOrder: (this.data()?.kinds?.length ?? 0) + 1, ...this.placeBody(this.nw.place) })).id;
      const r = await this.api.post<{ id: string }>('teams', body);
      if (members.length) await this.api.put(`teams/${r.id}/members`, { members });
    });
    if (ok) { this.nw = { ...this.nw, kindId: '', assignMethod: '' }; this.nk2 = { nameEn: '', nameAr: '' }; this.nwMembers.clear(); this.nwLeaders.clear(); box.open = false; }
  }
  protected update(t: TeamRow): void {
    const e = this.edit[t.id];
    void this.run(() => this.api.put('teams/' + t.id, { kindId: e.kindId, ...this.placeBody(e.place), nameEn: e.nameEn, nameAr: e.nameAr, isActive: e.isActive, assignMethod: e.assignMethod || null }));
  }
  protected remove(t: TeamRow): void { void this.run(() => this.api.del('teams/' + t.id), 'AdminV2.deleted'); }
  protected saveKind(k: { id: string; nameEn: string; nameAr: string; centralFallback: boolean; sortOrder?: number }): void {
    void this.run(() => this.api.put('team-kinds/' + k.id, { nameEn: k.nameEn, nameAr: k.nameAr, centralFallback: k.centralFallback, sortOrder: k.sortOrder ?? 0 }));
  }
  protected deleteKind(k: { id: string }): void { void this.run(() => this.api.del('team-kinds/' + k.id), 'AdminV2.deleted'); }
  protected async addKind(): Promise<void> {
    if (await this.run(() => this.api.post('team-kinds', { ...this.nk, centralFallback: true, sortOrder: (this.data()?.kinds?.length ?? 0) + 1 }))) this.nk = { nameEn: '', nameAr: '' };
  }
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
        @if (!mode()) {
          <div class="flex w-full flex-wrap gap-2 sm:w-auto">
            <button type="button" [class]="addBtn" (click)="mode.set('org')"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>{{ 'AdminOrgs.addOrgBtn' | t }}</button>
            <button type="button" [class]="addBtn" (click)="mode.set('branch')"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>{{ 'AdminOrgs.addBranchBtn' | t }}</button>
          </div>
        } @else {
          <section class="flex basis-full flex-col gap-3 rounded-xl border border-line border-t-4 border-t-brand bg-surface p-5 shadow-card" (keydown.escape)="mode.set(null)">
            <div class="flex items-start justify-between gap-3">
              <h2 class="text-lg font-bold">{{ (mode() === 'org' ? 'AdminOrgs.addOrgBtn' : 'AdminOrgs.addBranchBtn') | t }}</h2>
              <button type="button" class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted hover:bg-bg hover:text-ink" (click)="mode.set(null)"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>{{ 'AdminCommon.cancel' | t }}</button>
            </div>
        @if (mode() === 'org') { <app-place-form [framed]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createOrg($event)" /> }
        @if (mode() === 'branch') {
          <div class="flex flex-col gap-3">
            @if (!activeOrgs().length) { <p class="text-muted">{{ 'AdminOrgs.needOrg' | t }}</p> } @else {
              <div class="max-w-sm"><label for="branch-parent" class="mb-1 block text-sm font-semibold">{{ 'AdminOrgs.parentOrg' | t }}</label>
                <select id="branch-parent" [class]="cls.input" [(ngModel)]="parent">@for (o of activeOrgs(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }</select></div>
              <app-place-form [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createBranch(parent, $event)" />
            }
          </div>
        }
          </section>
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
      class="flex min-h-16 w-full cursor-pointer items-center gap-3 px-5 py-3 text-start" [class]="isOpen(o.id) ? 'bg-[#f7f9fd]' : 'hover:bg-bg'">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="shrink-0 text-muted transition-transform" [class]="isOpen(o.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M7 4l6 6-6 6" /></svg>
      <span aria-hidden="true" class="hidden size-11 shrink-0 place-items-center rounded-xl bg-[#efe8fd] text-[#5b3aa8] sm:grid">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M16 9h3a2 2 0 0 1 2 2v10M9 7h3M9 11h3M9 15h3"/></svg></span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-lg font-bold" dir="auto">{{ o.name }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="o.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (o.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
        </span>
        <span class="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold text-muted">
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ peopleOf(o.id).length }}</b> {{ 'AdminOrgs.statCustomers' | t }}</span>
          <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ o.branches.length }}</b> {{ 'AdminOrgs.statBranches' | t }}</span>
          @if (waitingOf(o.id); as w) { <span class="rounded-md bg-warn-soft px-2 py-0.5 text-warn-ink"><b>{{ w }}</b> {{ 'AdminOrgs.statWaiting' | t }}</span> }
        </span>
      </span>
      @if (leaderOf(o.teamLeaderId); as l) {
        <span class="hidden shrink-0 items-center gap-2 md:flex">
          <span aria-hidden="true" class="grid size-9 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">{{ initials(l.fullName) }}</span>
          <span class="text-sm leading-tight"><span class="block text-xs text-muted">{{ 'Directory.teamLeader' | t }}</span><b dir="auto">{{ l.fullName }}</b></span>
        </span>
      }
    </button></h2>
    <div [id]="'acc-' + o.id" [hidden]="!isOpen(o.id)" class="border-t border-line">
      @let tab = orgTab[o.id] ?? 'details';
      <div role="tablist" class="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-5">
        @for (k of orgTabs; track k) {
          <button type="button" role="tab" [attr.aria-selected]="tab === k" (click)="orgTab[o.id] = k"
            class="-mb-px inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-semibold"
            [class]="tab === k ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">
            {{ 'AdminOrgs.tab_' + k | t }}
            @if (k === 'branches') { <span class="rounded-full bg-bg px-2 text-xs">{{ o.branches.length }}</span> }
            @if (k === 'customers') { <span class="rounded-full bg-bg px-2 text-xs">{{ peopleOf(o.id).length }}</span> }
          </button>
        }
      </div>

      @if (tab === 'details') {
        <div class="flex flex-col gap-4 p-5">
          <dl class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="rounded-xl border border-line p-3"><dt class="text-xs font-semibold text-muted">{{ 'Directory.location' | t }}</dt><dd class="font-semibold" dir="auto">{{ o.location || '-' }}</dd></div>
            <div class="rounded-xl border border-line p-3"><dt class="text-xs font-semibold text-muted">{{ 'Directory.telephone' | t }}</dt><dd class="font-semibold" dir="ltr">{{ o.phone || '-' }}</dd></div>
            <div class="rounded-xl border border-line p-3"><dt class="text-xs font-semibold text-muted">{{ 'Directory.teamLeader' | t }}</dt><dd class="font-semibold" dir="auto">{{ leaderOf(o.teamLeaderId)?.fullName || '-' }}</dd></div>
          </dl>
          <div class="flex flex-wrap gap-2">
            <button type="button" [class]="toggleBtn" [disabled]="busy()" (click)="setOrgActive(o, !o.isActive)">{{ (o.isActive ? 'Directory.deactivate' : 'Directory.activate') | t }}</button>
            <button type="button" [class]="toggleBtn" [attr.aria-expanded]="editOrg === o.id" (click)="editOrg = editOrg === o.id ? null : o.id">{{ 'Directory.editDetails' | t }}</button>
          </div>
          @if (editOrg === o.id) {
            <div class="rounded-xl border border-line bg-[#fafcff] p-4"><app-place-form [row]="o" [leaders]="leaderList()" [busy]="busy()" (save)="updateOrg(o, $event)" (remove)="deleteOrg(o)" /></div>
          }
        </div>
      }

      @if (tab === 'branches') {
        <div class="flex flex-col gap-4 p-5">
          <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (b of o.branches; track b.id) {
              <li class="flex flex-col gap-2 rounded-xl border p-4" [class]="editBranch === b.id ? 'border-brand bg-brand-soft/40' : 'border-line'">
                <div class="flex flex-wrap items-center gap-2">
                  <b class="flex-1" dir="auto">{{ b.name }}</b>
                  <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="b.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (b.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
                </div>
                <p class="text-sm text-muted">{{ 'AdminOrgs.branchCustomers' | t: { count: branchPeople(b.id) } }}</p>
                <dl class="flex flex-col gap-0.5 text-sm">
                  <div class="flex gap-1.5"><dt class="text-muted">{{ 'Directory.location' | t }}:</dt><dd dir="auto">{{ b.location || '-' }}</dd></div>
                  <div class="flex gap-1.5"><dt class="text-muted">{{ 'Directory.telephone' | t }}:</dt><dd dir="ltr">{{ b.phone || '-' }}</dd></div>
                  <div class="flex gap-1.5"><dt class="text-muted">{{ 'Directory.teamLeader' | t }}:</dt><dd dir="auto">{{ leaderOf(b.teamLeaderId)?.fullName || '-' }}</dd></div>
                </dl>
                <div class="mt-auto flex flex-wrap gap-2 pt-1">
                  <button type="button" [class]="toggleBtn" [attr.aria-expanded]="editBranch === b.id" (click)="editBranch = editBranch === b.id ? null : b.id; addBranchFor = null">{{ 'AdminOrgs.edit' | t }}<span class="sr-only"> {{ b.name }}</span></button>
                  <button type="button" [class]="toggleBtn" [disabled]="busy()" (click)="setBranchActive(o, b, !b.isActive)">{{ (b.isActive ? 'Directory.deactivate' : 'Directory.activate') | t }}<span class="sr-only"> {{ b.name }}</span></button>
                </div>
              </li>
            }
            <li>
              <button type="button" [attr.aria-expanded]="addBranchFor === o.id" (click)="addBranchFor = addBranchFor === o.id ? null : o.id; editBranch = null"
                class="flex h-full min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-line font-semibold text-brand-ink hover:border-brand hover:bg-brand-soft/40">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                {{ 'Directory.addBranch' | t }}</button>
            </li>
          </ul>
          @for (b of o.branches; track b.id) {
            @if (editBranch === b.id) {
              <div class="rounded-xl border border-brand bg-[#fafcff] p-4">
                <h3 class="mb-3 font-bold">{{ 'AdminOrgs.editBranchTitle' | t: { name: b.name } }}</h3>
                <app-place-form [row]="b" [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="updateBranch(o, b, $event)" (remove)="deleteBranch(b)" />
              </div>
            }
          }
          @if (addBranchFor === o.id) {
            <div class="rounded-xl border border-brand bg-[#fafcff] p-4">
              <h3 class="mb-3 font-bold">{{ 'Directory.addBranch' | t }}</h3>
              <app-place-form [branch]="true" [leaders]="leaderList()" [busy]="busy()" (save)="createBranch(o.id, $event)" />
            </div>
          }
        </div>
      }

      @if (tab === 'customers') {
        <div class="flex flex-col gap-3 p-5">
          @if (!peopleOf(o.id).length) { <p class="text-muted">{{ 'AdminOrgs.noCustomers' | t }}</p> } @else {
            <div class="flex flex-wrap items-center gap-2">
              <label class="sr-only" [for]="'cq-' + o.id">{{ 'AdminOrgs.searchCustomers' | t }}</label>
              <input [id]="'cq-' + o.id" type="search" dir="auto" [placeholder]="'AdminOrgs.searchCustomers' | t" [value]="cq[o.id] ?? ''" (input)="cq[o.id] = $any($event.target).value; cPage[o.id] = 0"
                class="min-h-11 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" />
            </div>
            <div class="flex flex-wrap gap-1.5" role="group" [attr.aria-label]="'AdminOrgs.filterBranch' | t">
              @for (f of branchChips(o); track f.id) {
                <button type="button" [attr.aria-pressed]="(cBranch[o.id] ?? '') === f.id" (click)="cBranch[o.id] = f.id; cPage[o.id] = 0"
                  class="min-h-9 cursor-pointer rounded-full border px-3 text-xs font-semibold"
                  [class]="(cBranch[o.id] ?? '') === f.id ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-muted hover:border-brand'">
                  <span dir="auto">{{ f.label }}</span><span class="ms-1.5 opacity-80">{{ f.count }}</span></button>
              }
            </div>
            @let list = customersOf(o);
            @if (!list.length) { <p class="text-muted">{{ 'AdminOrgs.noMatch' | t }}</p> } @else {
              <div class="overflow-hidden rounded-xl border border-line">
                <table class="w-full text-sm">
                  <caption class="sr-only">{{ 'AdminOrgs.customers' | t }}</caption>
                  <thead class="bg-[#f7f9fd] text-xs uppercase tracking-wider text-muted">
                    <tr>
                      <th scope="col" class="px-3 py-2.5 text-start font-bold">{{ 'AdminOrgs.thCustomer' | t }}</th>
                      <th scope="col" class="hidden px-3 py-2.5 text-start font-bold sm:table-cell">{{ 'AdminOrgs.thBranch' | t }}</th>
                      <th scope="col" class="hidden px-3 py-2.5 text-start font-bold md:table-cell">{{ 'Directory.telephone' | t }}</th>
                      <th scope="col" class="px-3 py-2.5 text-start font-bold">{{ 'AdminOrgs.thStatus' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of pageOf(o.id, list); track m.id) {
                      <tr class="border-t border-line hover:bg-[#f9fbfe]">
                        <td class="px-3 py-2.5">
                          <a [routerLink]="'/' + i18n.locale() + '/console/customers/' + m.id" class="font-semibold text-brand-ink hover:underline" dir="auto">{{ m.fullName || m.email }}</a>
                          <span class="block break-all text-xs text-muted" dir="ltr">{{ m.email }}</span>
                          <span class="block text-xs text-muted sm:hidden" dir="auto">{{ m.branchId ? branchName(m.branchId) : ('AdminOrgs.noBranch' | t) }}</span>
                        </td>
                        <td class="hidden px-3 py-2.5 sm:table-cell">@if (m.branchId) { <span class="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink" dir="auto">{{ branchName(m.branchId) }}</span> } @else { <span class="text-xs text-muted">{{ 'AdminOrgs.noBranch' | t }}</span> }</td>
                        <td class="hidden px-3 py-2.5 text-muted md:table-cell" dir="ltr">{{ m.phone || '-' }}</td>
                        <td class="px-3 py-2.5"><span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" [class]="statusTone(m.status)">{{ 'Status.' + m.status | t }}</span></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (list.length > pageSize) {
                @let p = cPage[o.id] ?? 0;
                <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                  <span>{{ 'AdminOrgs.pageOf' | t: { from: p * pageSize + 1, to: Math.min((p + 1) * pageSize, list.length), total: list.length } }}</span>
                  <span class="flex gap-2">
                    <button type="button" [class]="toggleBtn" [disabled]="p === 0" (click)="cPage[o.id] = p - 1">{{ 'AdminOrgs.prev' | t }}</button>
                    <button type="button" [class]="toggleBtn" [disabled]="(p + 1) * pageSize >= list.length" (click)="cPage[o.id] = p + 1">{{ 'AdminOrgs.next' | t }}</button>
                  </span>
                </div>
              }
            }
          }
        </div>
      }
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
  protected readonly addBtn = 'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink sm:flex-none';
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
  protected leaderOf(id: string | null) { return this.leaderList().find((p) => p.id === id) ?? null; }
  protected readonly Math = Math;
  protected readonly pageSize = 25;
  protected readonly orgTabs = ['details', 'branches', 'customers'] as const;
  protected orgTab: Record<string, 'details' | 'branches' | 'customers'> = {};
  protected editOrg: string | null = null;
  protected editBranch: string | null = null;
  protected addBranchFor: string | null = null;
  /** Per organization: search text, branch filter ('' all, '-' no branch, else a branch id) and page. */
  protected cq: Record<string, string> = {};
  protected cBranch: Record<string, string> = {};
  protected cPage: Record<string, number> = {};
  protected waitingOf(org: string): number { return this.peopleOf(org).filter((p) => p.status === 'pending_approval').length; }
  protected initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase(); }
  protected statusTone(s: string): string {
    return s === 'active' ? 'bg-ok-soft text-ok' : s === 'suspended' ? 'bg-danger-soft text-danger' : s === 'pending_approval' ? 'bg-warn-soft text-warn-ink' : 'bg-bg text-muted';
  }
  protected branchChips(o: OrgRow): { id: string; label: string; count: number }[] {
    const all = this.peopleOf(o.id);
    const chips = [{ id: '', label: this.i18n.t('AdminOrgs.allBranches'), count: all.length },
      ...o.branches.map((b) => ({ id: b.id, label: b.name, count: all.filter((p) => p.branchId === b.id).length }))];
    const none = all.filter((p) => !p.branchId).length;
    if (none) chips.push({ id: '-', label: this.i18n.t('AdminOrgs.noBranch'), count: none });
    return chips;
  }
  protected customersOf(o: OrgRow): OrgPerson[] {
    const s = (this.cq[o.id] ?? '').trim().toLowerCase();
    const b = this.cBranch[o.id] ?? '';
    return this.peopleOf(o.id).filter((p) => (!b || (b === '-' ? !p.branchId : p.branchId === b))
      && (!s || [p.fullName, p.email, p.phone ?? ''].join(' ').toLowerCase().includes(s)));
  }
  protected pageOf(org: string, list: OrgPerson[]): OrgPerson[] {
    const p = Math.min(this.cPage[org] ?? 0, Math.max(0, Math.ceil(list.length / this.pageSize) - 1));
    return list.slice(p * this.pageSize, (p + 1) * this.pageSize);
  }
  private body(r: OrgRow | BranchRow): PlaceModel {
    return { name: r.name, location: r.location ?? '', phone: r.phone ?? '', teamLeaderId: r.teamLeaderId, isActive: r.isActive, sharedAccessEnabled: (r as OrgRow).sharedAccessEnabled ?? false };
  }
  protected async createOrg(m: PlaceModel): Promise<void> { if (await this.run(() => this.api.post('organizations', { ...m, isActive: true }))) { this.mode.set(null); await this.loadLookups(); } }
  protected async createBranch(org: string, m: PlaceModel, box?: { open: boolean }): Promise<void> {
    if (await this.run(() => this.api.post('branches', { ...m, isActive: true, organizationId: org }))) { this.mode.set(null); this.addBranchFor = null; if (box) box.open = false; await this.loadLookups(); }
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
  imports: [TPipe, Alert, FormsModule, RouterLink, NgTemplateOutlet],
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
        @if (!done().length) { <p class="rounded-xl border border-line bg-surface p-6 text-muted shadow-card">{{ 'Approvals.approvedEmpty' | t }}</p> } @else {
          <!-- Design: docs/design/approved-accounts-sample.html -->
          <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <form role="search" class="flex flex-wrap items-center gap-3 border-b border-line p-4" (submit)="$event.preventDefault()">
              <label class="relative min-w-0 flex-[1_1_16rem]"><span class="sr-only">{{ 'Approvals.search' | t }}</span>
                <svg aria-hidden="true" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input type="search" maxlength="100" [placeholder]="'Approvals.searchPh' | t" [class]="cls.input + ' ps-10'" [ngModel]="aq()" (ngModelChange)="aq.set($event); page.set(1)" name="aq" /></label>
              <label class="min-w-48 flex-1 sm:flex-none"><span class="sr-only">{{ 'Approvals.colOrg' | t }}</span>
                <select [class]="cls.input" [ngModel]="aOrg()" (ngModelChange)="aOrg.set($event); page.set(1)" name="aorg">
                  <option value="">{{ 'Approvals.allOrgs' | t }}</option>
                  @for (o of doneOrgs(); track o) { <option [value]="o">{{ o }}</option> }
                </select></label>
              <label class="min-w-40 flex-1 sm:flex-none"><span class="sr-only">{{ 'Approvals.colApproved' | t }}</span>
                <select [class]="cls.input" [ngModel]="aDays()" (ngModelChange)="aDays.set(+$event); page.set(1)" name="adays">
                  <option [ngValue]="0">{{ 'Approvals.anyTime' | t }}</option>
                  <option [ngValue]="30">{{ 'Approvals.lastDays' | t: { n: 30 } }}</option>
                  <option [ngValue]="90">{{ 'Approvals.lastDays' | t: { n: 90 } }}</option>
                </select></label>
              <p role="status" class="ms-auto text-sm text-muted">{{ 'Approvals.showing' | t: { shown: filtered().length, total: done().length } }}</p>
            </form>
            @if (!filtered().length) { <p class="p-6 text-center text-muted">{{ 'Approvals.noMatch' | t }}</p> } @else {
              <!-- Tablet and wider: four-column table -->
              <table class="hidden w-full text-sm md:table">
                <caption class="sr-only">{{ 'Approvals.approvedTitle' | t }}</caption>
                <thead class="bg-bg/70 text-xs uppercase tracking-wide text-muted"><tr>
                  <th scope="col" class="px-5 py-3 text-start font-bold">{{ 'Approvals.hCustomer' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-start font-bold">{{ 'Approvals.colPhone' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-start font-bold">{{ 'Approvals.hOrgBranch' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-start font-bold" [attr.aria-sort]="newestFirst() ? 'descending' : 'ascending'">
                    <button type="button" class="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide text-brand-ink hover:underline" (click)="newestFirst.set(!newestFirst()); page.set(1)">
                      {{ 'Approvals.colApproved' | t }}
                      <svg aria-hidden="true" [class]="newestFirst() ? '' : 'rotate-180'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      <span class="sr-only">{{ (newestFirst() ? 'Approvals.sortedNewest' : 'Approvals.sortedOldest') | t }}</span></button></th>
                  @if (canOpen()) { <th scope="col" class="w-10"><span class="sr-only">{{ 'Approvals.open' | t }}</span></th> }
                </tr></thead>
                <tbody>
                  @for (u of shown(); track u.id) {
                    <tr class="border-t border-line align-middle transition-colors" [class]="canOpen() ? 'cursor-pointer hover:bg-bg/70' : ''" (click)="open(u)">
                      <td class="px-5 py-3.5"><ng-container *ngTemplateOutlet="who; context: { $implicit: u }" /></td>
                      <td class="px-5 py-3.5 text-start" dir="ltr">{{ u.phone || '—' }}</td>
                      <td class="px-5 py-3.5"><ng-container *ngTemplateOutlet="org; context: { $implicit: u }" /></td>
                      <td class="px-5 py-3.5"><ng-container *ngTemplateOutlet="when; context: { $implicit: u }" /></td>
                      @if (canOpen()) { <td class="pe-4 text-end text-muted"><svg aria-hidden="true" class="inline rtl:-scale-x-100" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg></td> }
                    </tr>
                  }
                </tbody>
              </table>
              <!-- Phone: one small card per account -->
              <ul class="flex flex-col md:hidden">
                @for (u of shown(); track u.id) {
                  <li class="flex flex-col gap-2 border-t border-line p-4 first:border-t-0" [class]="canOpen() ? 'cursor-pointer' : ''" (click)="open(u)">
                    <ng-container *ngTemplateOutlet="who; context: { $implicit: u }" />
                    <div class="ps-12"><ng-container *ngTemplateOutlet="org; context: { $implicit: u }" /></div>
                    <div class="ps-12"><ng-container *ngTemplateOutlet="when; context: { $implicit: u }" /></div>
                  </li>
                }
              </ul>
            }
            @if (pages() > 1) {
              <nav [attr.aria-label]="'Approvals.pages' | t" class="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg/50 px-5 py-3 text-sm text-muted">
                <span>{{ 'Approvals.pageOf' | t: { page: page(), pages: pages(), size: pageSize } }}</span>
                <span class="flex gap-1.5">
                  <button type="button" class="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-2 font-semibold text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50" [disabled]="page() === 1" (click)="page.set(page() - 1)" [attr.aria-label]="'Approvals.prev' | t">
                    <svg aria-hidden="true" class="rtl:-scale-x-100" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6" /></svg></button>
                  @for (n of pageList(); track n) {
                    <button type="button" class="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border px-2 font-semibold" [class]="n === page() ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:bg-bg'" [attr.aria-current]="n === page() ? 'page' : null" (click)="page.set(n)">{{ n }}</button>
                  }
                  <button type="button" class="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-2 font-semibold text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50" [disabled]="page() === pages()" (click)="page.set(page() + 1)" [attr.aria-label]="'Approvals.next' | t">
                    <svg aria-hidden="true" class="rtl:-scale-x-100" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6" /></svg></button>
                </span>
              </nav>
            }
          </div>
        }
      </section>
    </main>

    <ng-template #who let-u>
      <div class="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold" [class]="avatarTone(u.id)">{{ initials(u.fullName) }}</span>
        <div class="min-w-0">
          @if (canOpen()) {
            <a [routerLink]="profileLink(u)" (click)="$event.stopPropagation()" class="block truncate font-semibold hover:text-brand-ink hover:underline" dir="auto" [attr.aria-label]="'Approvals.openProfile' | t: { name: u.fullName || u.email }">{{ u.fullName || '-' }}</a>
          } @else { <p class="truncate font-semibold" dir="auto">{{ u.fullName || '-' }}</p> }
          <p class="truncate text-start text-xs text-muted" dir="ltr">{{ u.email }}</p>
        </div>
      </div>
    </ng-template>
    <ng-template #org let-u>
      @if (u.organization) { <span class="inline-flex max-w-full truncate rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink" dir="auto">{{ u.organization }}</span> }
      @else { <span class="text-muted">—</span> }
      <p class="mt-1 text-xs text-muted" dir="auto">{{ u.branch || ('Approvals.noBranch' | t) }}</p>
    </ng-template>
    <ng-template #when let-u>
      <div class="flex flex-wrap items-center gap-1.5">
        @if (u.approvedAt) { <span class="font-semibold">{{ i18n.date(u.approvedAt) }}</span> }
        @else { <span class="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{{ 'Approvals.addedDirectly' | t }}</span> }
        @if (waitDays(u); as w) {
          <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold" [class]="w.days > 3 ? 'bg-warn-soft text-warn-ink' : 'bg-bg text-muted'">
            {{ w.days === 0 ? ('Approvals.sameDay' | t) : ('Approvals.afterDays' | t: { n: w.days }) }}</span>
        }
      </div>
      <p class="mt-1 text-xs text-muted" dir="auto">
        @if (u.approvedBy) { {{ 'Approvals.by' | t: { name: u.approvedBy } }} · }{{ 'Approvals.registered' | t: { date: i18n.date(u.registeredAt) } }}</p>
    </ng-template>`,
})
export class AdminApprovalsPage extends AdminBase implements OnInit {
  protected readonly rows = signal<PendingRow[] | null>(null);
  protected readonly done = signal<ApprovedRow[]>([]);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  // Approved accounts table: search, filters, sort and pages (design docs/design/approved-accounts-sample.html).
  protected readonly pageSize = 25;
  protected readonly aq = signal('');
  protected readonly aOrg = signal('');
  protected readonly aDays = signal(0);
  protected readonly newestFirst = signal(true);
  protected readonly page = signal(1);
  protected readonly doneOrgs = computed(() => [...new Set(this.done().map((u) => u.organization).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)));
  protected readonly filtered = computed(() => {
    const q = this.aq().trim().toLowerCase(), org = this.aOrg(), days = this.aDays();
    const since = days ? Date.now() - days * 864e5 : 0;
    const time = (u: ApprovedRow) => new Date(u.approvedAt ?? u.registeredAt).getTime();
    return this.done()
      .filter((u) => !q || [u.fullName, u.email, u.phone ?? ''].some((v) => (v ?? '').toLowerCase().includes(q)))
      .filter((u) => !org || u.organization === org)
      .filter((u) => !since || time(u) >= since)
      .sort((a, b) => (this.newestFirst() ? time(b) - time(a) : time(a) - time(b)));
  });
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
  protected readonly shown = computed(() => { const p = Math.min(this.page(), this.pages()); return this.filtered().slice((p - 1) * this.pageSize, p * this.pageSize); });
  protected readonly pageList = computed(() => Array.from({ length: this.pages() }, (_, i) => i + 1));
  /** Rows open the customer's profile for people who may view customers (the profile needs that permission). */
  protected readonly canOpen = computed(() => this.auth.has('customers_view') || !!this.auth.me()?.roles.includes('admin'));
  protected profileLink(u: ApprovedRow): string { return `/${this.i18n.locale()}/console/customers/${u.id}`; }
  protected open(u: ApprovedRow): void { if (this.canOpen()) void this.router.navigateByUrl(this.profileLink(u)); }
  protected initials(name: string): string { return (name || '?').trim().split(/\s+/).map((w) => [...w][0] ?? '').slice(0, 2).join('').toUpperCase(); }
  private static readonly AVATAR = ['bg-brand-soft text-brand-ink', 'bg-violet-100 text-violet-800', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn-ink'];
  protected avatarTone(id: string): string { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AdminApprovalsPage.AVATAR[h % 4]; }
  /** Whole days between registering and approval (null when there is no approval date). */
  protected waitDays(u: ApprovedRow): { days: number } | null {
    if (!u.approvedAt) return null;
    const day = (s: string) => { const d = new Date(s); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
    return { days: Math.max(0, Math.round((day(u.approvedAt) - day(u.registeredAt)) / 864e5)) };
  }
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

