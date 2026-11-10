import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import {
  AccessRow, AccountTypeRow, AdminApi, AdminUser, BranchRow, Lookups, OrgRow, TeamRow, TeamsResult, TypeBody, UserBody,
  adminError, generatePassword,
} from '../../core/admin-api';
import { Alert, Req } from '../../shared/ui';
import { WhereEditor } from './where-editor';

// Same look as the v1 admin screens: cards with a header that opens, forms inside.
export const CLS = {
  input: 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base',
  label: 'text-sm font-semibold',
  btn: 'min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:cursor-wait disabled:opacity-60',
  btn2: 'min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg disabled:opacity-60',
  danger: 'min-h-11 cursor-pointer rounded-lg border border-danger bg-surface px-4 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60',
  card: 'rounded-xl border border-line bg-surface shadow-card',
  summary: 'cursor-pointer list-none px-5 py-4',
  badgeOn: 'rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok',
  badgeOff: 'rounded-full border border-line bg-bg px-2 py-0.5 text-xs font-bold text-muted',
  badgeWarn: 'rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn-ink',
};

export type Msg = { tone: 'error' | 'success'; text: string } | null;

/** Shared plumbing: lookups, the message line, a busy flag and name helpers. */
export abstract class AdminBase {
  protected readonly i18n = inject(I18n);
  protected readonly api = inject(AdminApi);
  protected readonly cls = CLS;
  protected readonly lk = signal<Lookups | null>(null);
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);
  protected readonly q = signal('');

  protected async loadLookups(): Promise<void> {
    try { this.lk.set(await this.api.lookups()); } catch (e) { this.fail(e); }
  }
  protected fail(e: unknown): void { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
  protected ok(key = 'AdminCommon.saved', params?: Record<string, unknown>): void { this.msg.set({ tone: 'success', text: this.i18n.t(key, params) }); }

  /** Runs one change, shows the result and reloads the list. */
  protected async run(fn: () => Promise<unknown>, okKey?: string, params?: Record<string, unknown>): Promise<boolean> {
    this.busy.set(true);
    this.msg.set(null);
    try {
      await fn();
      this.ok(okKey, params);
      await this.reload();
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  protected abstract reload(): Promise<void>;

  protected orgName(id: string | null): string { return this.lk()?.orgs.find((o) => o.id === id)?.name ?? ''; }
  protected branchName(id: string | null): string { return this.lk()?.branches.find((b) => b.id === id)?.name ?? ''; }
  protected branchesOf(org: string | null) { return (this.lk()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected typeName(id: string | null): string { const t = this.lk()?.types.find((x) => x.id === id); return t ? this.i18n.pick(t.nameEn, t.nameAr) : ''; }
  protected teamName(id: string): string { const t = this.lk()?.teams.find((x) => x.id === id); return t ? this.i18n.pick(t.nameEn, t.nameAr) : ''; }
  protected matches(...parts: (string | null | undefined)[]): boolean {
    const s = this.q().trim().toLowerCase();
    return !s || parts.some((p) => (p ?? '').toLowerCase().includes(s));
  }
}

export const HEADER = `
  <div>
    <h1 class="text-3xl font-bold tracking-tight">{{ title | t }}</h1>
    <p class="mt-1 max-w-prose text-muted">{{ subtitle | t }}</p>
  </div>
  @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }`;

export const SEARCH = `
  <div class="flex flex-col gap-1.5">
    <label for="adm-q" class="sr-only">{{ 'Shell.searchPageLabel' | t }}</label>
    <input id="adm-q" type="search" dir="auto" [placeholder]="'Shell.searchPagePlaceholder' | t" [class]="cls.input" [value]="q()" (input)="q.set($any($event.target).value)" />
  </div>`;

// ================================================================== person form (staff and customers)

@Component({
  selector: 'app-person-form',
  imports: [FormsModule, TPipe, Req, WhereEditor],
  template: `
    <form class="flex flex-col gap-4" (ngSubmit)="submit()">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><label [for]="id + 'n'" [class]="cls.label">{{ 'Directory.name' | t }}<app-req /></label>
          <input [id]="id + 'n'" name="fullName" dir="auto" required maxlength="120" [class]="cls.input" [(ngModel)]="m.fullName" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'e'" [class]="cls.label">{{ 'Directory.email' | t }}<app-req /></label>
          <input [id]="id + 'e'" name="email" type="email" dir="ltr" required maxlength="254" [class]="cls.input" [(ngModel)]="m.email" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'p'" [class]="cls.label">{{ 'Directory.phone' | t }}</label>
          <input [id]="id + 'p'" name="phone" type="tel" dir="ltr" maxlength="24" [class]="cls.input" [(ngModel)]="m.phone" /></div>
        @if (!user()) {
          <div class="flex flex-col gap-1.5"><label [for]="id + 'w'" [class]="cls.label">{{ 'Directory.tempPassword' | t }}<app-req /></label>
            <div class="flex gap-2"><input [id]="id + 'w'" name="password" dir="ltr" required [class]="cls.input" [(ngModel)]="m.password" autocomplete="new-password" />
              <button type="button" [class]="cls.btn2" (click)="m.password = gen()">{{ 'Directory.generate' | t }}</button></div>
            <p class="text-sm text-muted">{{ 'Directory.tempPasswordHint' | t }}</p></div>
        }
        @if (mode() === 'staff') {
          <div class="flex flex-col gap-1.5"><label [for]="id + 'r'" [class]="cls.label">{{ 'AdminV2.role' | t }}<app-req /></label>
            <select [id]="id + 'r'" name="role" [class]="cls.input" [(ngModel)]="m.role" [disabled]="!!user()?.isSelf">
              @for (r of staffRoles; track r) { <option [value]="r">{{ 'Roles.' + r | t }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 't'" [class]="cls.label">{{ 'AdminUsers.accountType' | t }}</label>
            <select [id]="id + 't'" name="type" [class]="cls.input" [(ngModel)]="m.accountTypeId" [disabled]="!!user()?.isSelf">
              <option [ngValue]="null">{{ 'AdminV2.noType' | t }}</option>
              @for (t of lk()?.types ?? []; track t.id) { <option [ngValue]="t.id">{{ i18n.pick(t.nameEn, t.nameAr) }}</option> }
            </select></div>
        }
        <div class="flex flex-col gap-1.5"><label [for]="id + 'o'" [class]="cls.label">{{ 'Directory.organization' | t }}</label>
          <select [id]="id + 'o'" name="org" [class]="cls.input" [(ngModel)]="m.organizationId" (ngModelChange)="m.branchId = null">
            <option [ngValue]="null">{{ 'Directory.noOrganization' | t }}</option>
            @for (o of lk()?.orgs ?? []; track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
          </select></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'b'" [class]="cls.label">{{ 'Directory.branch' | t }}</label>
          <select [id]="id + 'b'" name="branch" [class]="cls.input" [(ngModel)]="m.branchId" [disabled]="!m.organizationId">
            <option [ngValue]="null">{{ 'Directory.noBranch' | t }}</option>
            @for (b of branches(); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
          </select></div>
      </div>
      @if (mode() === 'staff') {
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="auto" class="h-5 w-5" [(ngModel)]="m.autoAssign" /> {{ 'AdminV2.autoAssign' | t }}</label>
          <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="cfc" class="h-5 w-5" [(ngModel)]="m.canCreateForCustomers" /> {{ 'AdminV2.canCreate' | t }}</label>
        </div>
      }
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (user() ? 'Directory.saveChanges' : 'Directory.create') | t }}</button>
      </div>
    </form>

    @if (user(); as u) {
      <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        @if (!u.isSelf) {
          @if (u.status === 'active') { <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="act.emit({ kind: 'status', value: 'suspended' })">{{ 'AdminUsers.suspend' | t }}</button> }
          @else { <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="act.emit({ kind: 'status', value: 'active' })">{{ 'AdminUsers.reactivate' | t }}</button> }
        }
        <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="act.emit({ kind: 'password', value: gen() })">{{ 'AdminV2.resetPassword' | t }}</button>
        @if (!u.isSelf) {
          @if (confirmDelete()) {
            <span class="text-sm font-semibold">{{ 'Directory.deleteConfirm' | t }}</span>
            <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="confirmDelete.set(false); act.emit({ kind: 'delete', value: '' })">{{ 'Directory.deleteYes' | t }}</button>
            <button type="button" [class]="cls.btn2" (click)="confirmDelete.set(false)">{{ 'Directory.cancel' | t }}</button>
          } @else {
            <button type="button" [class]="cls.danger" (click)="confirmDelete.set(true)">{{ 'Directory.delete' | t }}</button>
          }
        }
      </div>
      <p class="mt-2 text-sm text-muted">{{ 'Directory.deleteHintUser' | t }}</p>
      @if (mode() === 'staff' && u.role !== 'admin') { <app-where-editor [userId]="u.id" [lk]="lk()" /> }
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PersonForm implements OnInit {
  protected readonly i18n = inject(I18n);
  protected readonly cls = CLS;
  protected readonly id = 'pf' + Math.random().toString(36).slice(2, 8);
  readonly mode = input<'staff' | 'customer'>('staff');
  readonly user = input<AdminUser | null>(null);
  readonly lk = input<Lookups | null>(null);
  readonly busy = input(false);
  readonly save = output<UserBody>();
  readonly act = output<{ kind: 'status' | 'password' | 'delete'; value: string }>();
  protected readonly confirmDelete = signal(false);
  protected readonly staffRoles = ['agent', 'team_leader', 'admin', 'management_viewer'];
  protected m: UserBody = this.blank();

  ngOnInit(): void {
    const u = this.user();
    if (u) {
      this.m = {
        fullName: u.fullName, email: u.email, phone: u.phone ?? '', password: '', role: u.role ?? 'agent', accountTypeId: u.accountTypeId,
        organizationId: u.organizationId, branchId: u.branchId, autoAssign: u.autoAssign, canCreateForCustomers: u.canCreateForCustomers,
      };
    }
  }
  private blank(): UserBody {
    return { fullName: '', email: '', phone: '', password: '', role: this.mode?.() === 'customer' ? 'customer' : 'agent', accountTypeId: null, organizationId: null, branchId: null, autoAssign: false, canCreateForCustomers: false };
  }
  protected branches() { return (this.lk()?.branches ?? []).filter((b) => b.organizationId === this.m.organizationId); }
  protected gen(): string { return generatePassword(); }
  protected submit(): void {
    const body = { ...this.m, role: this.mode() === 'customer' ? 'customer' : this.m.role };
    this.save.emit(body);
  }
  reset(): void { this.m = this.blank(); }
}

// ================================================================== staff

@Component({
  selector: 'app-admin-staff',
  imports: [TPipe, Alert, PersonForm],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Directory.addUser' | t }}</span></summary>
        <div class="px-5 pb-5">
          @if (lk()) { <app-person-form #pf mode="staff" [lk]="lk()" [busy]="busy()" (save)="create($event, pf, add)" /> }
        </div>
      </details>
      ${SEARCH}
      @if (!rows()) { <p class="text-muted">…</p> }
      @else if (!filtered().length) { <p class="text-muted">{{ (rows()!.length ? 'AdminUsers.noMatch' : 'AdminUsers.empty') | t }}</p> }
      <ul class="flex flex-col gap-3">
        @for (u of filtered(); track u.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ u.fullName || '-' }}</span>
                <span class="text-lg font-bold text-brand-ink">({{ 'Roles.' + u.role | t }})</span>
                @if (u.isSelf) { <span class="text-sm font-medium text-muted">({{ 'AdminUsers.you' | t }})</span> }
                <span [class]="u.status === 'active' ? cls.badgeOn : u.status === 'pending_approval' ? cls.badgeWarn : cls.badgeOff">{{ 'Status.' + u.status | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted"><span dir="ltr">{{ u.email }}</span>
                @if (u.accountTypeId) { · <span dir="auto">{{ typeName(u.accountTypeId) }}</span> }
                @if (u.teamIds.length) { · {{ 'AdminUsers.teamLine' | t }}: {{ teams(u) }} }
              </span>
            </summary>
            <div class="px-5 pb-5">
              <app-person-form mode="staff" [user]="u" [lk]="lk()" [busy]="busy()" (save)="update(u, $event)" (act)="action(u, $event)" />
            </div>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminStaffPage extends AdminBase implements OnInit {
  protected readonly title: string = 'AdminUsers.title';
  protected readonly subtitle: string = 'AdminUsers.subtitle';
  protected readonly kind: 'staff' | 'customers' = 'staff';
  protected readonly rows = signal<AdminUser[] | null>(null);
  protected readonly filtered = computed(() => (this.rows() ?? []).filter((u) =>
    this.matches(u.fullName, u.email, u.phone, this.i18n.t('Roles.' + u.role), this.typeName(u.accountTypeId), this.orgName(u.organizationId), this.teams(u))));

  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try { this.rows.set(await this.api.get<AdminUser[]>('users?kind=' + this.kind)); } catch (e) { this.fail(e); }
  }
  protected teams(u: AdminUser): string { return u.teamIds.map((t) => this.teamName(t)).join(', '); }

  protected async create(body: UserBody, form: PersonForm, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('users', body), 'Directory.createdUser', { email: body.email, password: body.password })) {
      form.reset();
      box.open = false;
    }
  }
  protected update(u: AdminUser, body: UserBody): void { void this.run(() => this.api.put('users/' + u.id, body)); }
  protected action(u: AdminUser, a: { kind: string; value: string }): void {
    if (a.kind === 'status') void this.run(() => this.api.post(`users/${u.id}/status`, { status: a.value }));
    else if (a.kind === 'password') void this.run(() => this.api.post(`users/${u.id}/password`, { password: a.value }), 'AdminV2.passwordSet', { password: a.value });
    else void this.run(() => this.api.del('users/' + u.id), 'AdminV2.deleted');
  }
}

// ================================================================== customers

@Component({
  selector: 'app-admin-customers',
  imports: [TPipe, Alert, PersonForm],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Customers.addCustomer' | t }}</span></summary>
        <div class="px-5 pb-5">
          @if (lk()) { <app-person-form #pf mode="customer" [lk]="lk()" [busy]="busy()" (save)="create($event, pf, add)" /> }
        </div>
      </details>
      ${SEARCH}
      @if (!rows()) { <p class="text-muted">…</p> }
      @else if (!filtered().length) { <p class="text-muted">{{ 'Customers.empty' | t }}</p> }
      <ul class="flex flex-col gap-3">
        @for (u of filtered(); track u.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ u.fullName || '-' }}</span>
                <span [class]="u.status === 'active' ? cls.badgeOn : cls.badgeOff">{{ 'Status.' + u.status | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted"><span dir="ltr">{{ u.email }}</span>
                @if (u.phone) { · <span dir="ltr">{{ u.phone }}</span> }
                · {{ u.organizationId ? orgName(u.organizationId) + (u.branchId ? ' · ' + branchName(u.branchId) : '') : ('Customers.noOrganization' | t) }}
                · {{ 'Customers.ticketCounts' | t: { total: u.tickets, open: u.openTickets } }}
              </span>
            </summary>
            <div class="px-5 pb-5">
              @if (canManage()) { <app-person-form mode="customer" [user]="u" [lk]="lk()" [busy]="busy()" (save)="update(u, $event)" (act)="action(u, $event)" /> }
              @else { <p class="text-sm text-muted">{{ 'Customers.registered' | t }}: {{ i18n.date(u.createdAt) }}</p> }
            </div>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminCustomersPage extends AdminStaffPage {
  protected override readonly title = 'Customers.title';
  protected override readonly subtitle = 'Customers.subtitle';
  protected override readonly kind = 'customers' as const;
  private readonly auth = inject(Auth);
  protected readonly canManage = computed(() => !!this.auth.me()?.roles.includes('admin') || this.auth.has('customers_manage'));
}

// ================================================================== approvals

@Component({
  selector: 'app-admin-approvals',
  imports: [TPipe, Alert, FormsModule],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      @if (!rows()) { <p class="text-muted">…</p> }
      @else if (!rows()!.length) { <p class="text-muted">{{ 'Approvals.empty' | t }}</p> }
      @else { <p class="font-semibold">{{ 'Approvals.count' | t: { n: rows()!.length } }}</p> }
      <ul class="flex flex-col gap-3">
        @for (u of rows() ?? []; track u.id) {
          <li [class]="cls.card + ' p-5'">
            <p class="text-lg font-bold" dir="auto">{{ u.fullName }}</p>
            <p class="text-sm text-muted"><span dir="ltr">{{ u.email }}</span>@if (u.phone) { · <span dir="ltr">{{ u.phone }}</span> } · {{ 'Approvals.registered' | t: { date: i18n.date(u.createdAt) } }}</p>
            <form class="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" (ngSubmit)="approve(u)">
              <div class="flex flex-col gap-1.5"><label [for]="'ao' + u.id" [class]="cls.label">{{ 'AdminUsers.approve.org' | t }}</label>
                <select [id]="'ao' + u.id" [name]="'o' + u.id" [class]="cls.input" [(ngModel)]="pick[u.id].org" (ngModelChange)="pick[u.id].branch = null">
                  <option [ngValue]="null">{{ 'AdminUsers.approve.pickOrg' | t }}</option>
                  @for (o of lk()?.orgs ?? []; track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
                </select></div>
              <div class="flex flex-col gap-1.5"><label [for]="'ab' + u.id" [class]="cls.label">{{ 'AdminUsers.approve.branch' | t }}</label>
                <select [id]="'ab' + u.id" [name]="'b' + u.id" [class]="cls.input" [(ngModel)]="pick[u.id].branch" [disabled]="!pick[u.id].org">
                  <option [ngValue]="null">{{ 'AdminUsers.approve.noBranch' | t }}</option>
                  @for (b of branchesOf(pick[u.id].org); track b.id) { <option [ngValue]="b.id">{{ b.name }}</option> }
                </select></div>
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
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminApprovalsPage extends AdminBase implements OnInit {
  protected readonly title = 'Approvals.title';
  protected readonly subtitle = 'Approvals.subtitle';
  protected readonly rows = signal<AdminUser[] | null>(null);
  protected pick: Record<string, { org: string | null; branch: string | null; reason: string }> = {};

  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try {
      const rows = await this.api.get<AdminUser[]>('users?kind=pending');
      for (const u of rows) this.pick[u.id] ??= { org: u.organizationId, branch: u.branchId, reason: '' };
      this.rows.set(rows);
    } catch (e) { this.fail(e); }
  }
  protected approve(u: AdminUser): void {
    const p = this.pick[u.id];
    void this.run(() => this.api.post(`users/${u.id}/approve`, { organizationId: p.org, branchId: p.branch }), 'AdminV2.approved');
  }
  protected reject(u: AdminUser): void { void this.run(() => this.api.post(`users/${u.id}/reject`, { reason: this.pick[u.id].reason }), 'AdminV2.rejected'); }
}

// ================================================================== account types and permissions

@Component({
  selector: 'app-type-editor',
  imports: [FormsModule, TPipe, Req],
  template: `
    @if (type()?.isBuiltin) {
      <p class="rounded-lg bg-brand-soft px-4 py-3 text-sm font-medium text-brand-ink">{{ 'Permissions.lockedNote' | t }}</p>
    } @else {
      <form class="flex flex-col gap-5" (ngSubmit)="submit()">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'Permissions.nameEn' | t }}<app-req /></label>
            <input [id]="id + 'en'" name="en" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'Permissions.nameAr' | t }}<app-req /></label>
            <input [id]="id + 'ar'" name="ar" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend [class]="cls.label + ' mb-1'">{{ 'Permissions.stepAccess' | t }}</legend>
          <label class="flex min-h-11 items-center gap-2"><input type="radio" name="all" class="h-5 w-5" [value]="true" [(ngModel)]="m.allAccess" /> {{ 'Permissions.accessAll' | t }}</label>
          <label class="flex min-h-11 items-center gap-2"><input type="radio" name="all" class="h-5 w-5" [value]="false" [(ngModel)]="m.allAccess" /> {{ 'Permissions.accessSelected' | t }}</label>
          @if (!m.allAccess) {
            <p class="text-sm text-muted">{{ 'Permissions.accessHelp' | t }}</p>
            <ul class="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-3">
              @for (o of lk()?.orgs ?? []; track o.id) {
                <li>
                  <label class="flex min-h-10 items-center gap-2 font-semibold"><input type="checkbox" class="h-5 w-5" [checked]="sel.has('o:' + o.id)" (change)="toggle('o:' + o.id)" /> {{ o.name }}</label>
                  @if (!sel.has('o:' + o.id)) {
                    <ul class="ms-7">
                      @for (b of branchesOf(o.id); track b.id) {
                        <li><label class="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" [checked]="sel.has('b:' + b.id)" (change)="toggle('b:' + b.id)" /> {{ b.name }}</label></li>
                      }
                    </ul>
                  }
                </li>
              } @empty { <li class="text-sm text-muted">{{ 'Permissions.noOrgs' | t }}</li> }
            </ul>
          }
        </fieldset>

        <div class="flex flex-col gap-1.5 md:max-w-sm"><label [for]="id + 'sc'" [class]="cls.label">{{ 'AdminV2.scopeLevel' | t }}</label>
          <select [id]="id + 'sc'" name="scope" [class]="cls.input" [(ngModel)]="m.scopeLevel">
            <option [ngValue]="null">{{ 'AdminV2.scopeNone' | t }}</option>
            <option value="organization">{{ 'AdminV2.scopeOrg' | t }}</option>
            <option value="branch">{{ 'AdminV2.scopeBranch' | t }}</option>
          </select>
          <p class="text-sm text-muted">{{ 'AdminV2.scopeHelp' | t }}</p></div>

        <fieldset class="flex flex-col gap-1">
          <legend [class]="cls.label + ' mb-1'">{{ 'Permissions.stepPermissions' | t }}</legend>
          <p class="text-sm text-muted">{{ 'Permissions.permsHelp' | t }}</p>
          <div class="grid gap-x-6 md:grid-cols-2">
            @for (p of lk()?.permissions ?? []; track p) {
              <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="perms.has(p)" (change)="togglePerm(p)" /> {{ 'Permissions.perm.' + p | t }}</label>
            }
          </div>
        </fieldset>

        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (type() ? 'Directory.saveChanges' : 'Directory.create') | t }}</button>
          @if (type() && !type()!.staff) {
            @if (confirmDelete()) {
              <span class="text-sm font-semibold">{{ 'Directory.deleteConfirm' | t }}</span>
              <button type="button" [class]="cls.danger" (click)="remove.emit()">{{ 'Directory.deleteYes' | t }}</button>
              <button type="button" [class]="cls.btn2" (click)="confirmDelete.set(false)">{{ 'Directory.cancel' | t }}</button>
            } @else { <button type="button" [class]="cls.danger" (click)="confirmDelete.set(true)">{{ 'Directory.delete' | t }}</button> }
          }
        </div>
      </form>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class TypeEditor implements OnInit {
  protected readonly cls = CLS;
  protected readonly id = 'te' + Math.random().toString(36).slice(2, 8);
  readonly type = input<AccountTypeRow | null>(null);
  readonly lk = input<Lookups | null>(null);
  readonly busy = input(false);
  readonly save = output<TypeBody>();
  readonly remove = output<void>();
  protected readonly confirmDelete = signal(false);
  protected m = { nameEn: '', nameAr: '', allAccess: true, scopeLevel: null as string | null };
  protected sel = new Set<string>();
  protected perms = new Set<string>(['reply']);

  ngOnInit(): void { this.reset(); }
  reset(): void {
    const t = this.type();
    this.m = { nameEn: t?.nameEn ?? '', nameAr: t?.nameAr ?? '', allAccess: t?.allAccess ?? true, scopeLevel: t?.scopeLevel ?? null };
    this.sel = new Set((t?.access ?? []).map((a) => (a.branchId ? 'b:' + a.branchId : 'o:' + a.organizationId)));
    this.perms = new Set(t?.permissions ?? ['reply']);
    this.confirmDelete.set(false);
  }
  protected branchesOf(org: string) { return (this.lk()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected togglePerm(p: string): void { if (this.perms.has(p)) this.perms.delete(p); else this.perms.add(p); }
  protected toggle(key: string): void { if (this.sel.has(key)) this.sel.delete(key); else this.sel.add(key); }
  protected submit(): void {
    const access: AccessRow[] = [];
    for (const o of this.lk()?.orgs ?? []) {
      if (this.sel.has('o:' + o.id)) access.push({ organizationId: o.id, branchId: null });
      else for (const b of this.branchesOf(o.id)) if (this.sel.has('b:' + b.id)) access.push({ organizationId: o.id, branchId: b.id });
    }
    this.save.emit({ ...this.m, permissions: [...this.perms], access: this.m.allAccess ? [] : access });
  }
}

@Component({
  selector: 'app-admin-types',
  imports: [TPipe, Alert, TypeEditor],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Permissions.addType' | t }}</span></summary>
        <div class="px-5 pb-5">@if (lk()) { <app-type-editor #te [lk]="lk()" [busy]="busy()" (save)="create($event, te, add)" /> }</div>
      </details>
      <ul class="flex flex-col gap-3">
        @for (t of rows() ?? []; track t.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
                @if (t.isBuiltin) { <span [class]="cls.badgeOff">{{ 'Permissions.builtin' | t }}</span> }
              </span>
              <span class="mt-0.5 block text-sm text-muted">
                {{ t.allAccess || t.isBuiltin ? ('Permissions.allOrgs' | t) : access(t) }}
                · {{ 'Permissions.count' | t: { n: t.permissions.length, total: lk()?.permissions?.length ?? 0 } }}
                · {{ 'AdminV2.staffCount' | t: { n: t.staff } }}
              </span>
            </summary>
            <div class="px-5 pb-5">@if (lk()) { <app-type-editor [type]="t" [lk]="lk()" [busy]="busy()" (save)="update(t, $event)" (remove)="remove(t)" /> }</div>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminTypesPage extends AdminBase implements OnInit {
  protected readonly title = 'Permissions.title';
  protected readonly subtitle = 'Permissions.subtitle';
  protected readonly rows = signal<AccountTypeRow[] | null>(null);

  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try { this.rows.set(await this.api.get<AccountTypeRow[]>('account-types')); await this.loadLookups(); } catch (e) { this.fail(e); }
  }
  protected access(t: AccountTypeRow): string {
    return t.access.map((a) => (a.branchId ? `${this.orgName(a.organizationId)} · ${this.branchName(a.branchId)}` : this.orgName(a.organizationId))).join(', ') || '-';
  }
  protected async create(b: TypeBody, ed: TypeEditor, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('account-types', b))) { ed.reset(); box.open = false; }
  }
  protected update(t: AccountTypeRow, b: TypeBody): void { void this.run(() => this.api.put('account-types/' + t.id, b)); }
  protected remove(t: AccountTypeRow): void { void this.run(() => this.api.del('account-types/' + t.id), 'AdminV2.deleted'); }
}

// ================================================================== organizations and branches

type PlaceModel = { name: string; location: string; phone: string; teamLeaderId: string | null; isActive: boolean; sharedAccessEnabled: boolean };

@Component({
  selector: 'app-place-form',
  imports: [FormsModule, TPipe, Req],
  template: `
    <form class="flex flex-col gap-4" (ngSubmit)="submit()">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><label [for]="id + 'n'" [class]="cls.label">{{ (branch() ? 'Directory.branchName' : 'Directory.orgName') | t }}<app-req /></label>
          <input [id]="id + 'n'" name="name" dir="auto" required maxlength="120" [class]="cls.input" [(ngModel)]="m.name" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'l'" [class]="cls.label">{{ 'Directory.teamLeader' | t }}</label>
          <select [id]="id + 'l'" name="leader" [class]="cls.input" [(ngModel)]="m.teamLeaderId">
            <option [ngValue]="null">{{ 'Directory.noLeader' | t }}</option>
            @for (p of lk()?.leaders ?? []; track p.id) { <option [ngValue]="p.id">{{ p.fullName }} ({{ p.email }})</option> }
          </select></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'loc'" [class]="cls.label">{{ 'Directory.location' | t }}</label>
          <input [id]="id + 'loc'" name="loc" dir="auto" maxlength="300" [class]="cls.input" [(ngModel)]="m.location" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'p'" [class]="cls.label">{{ 'Directory.telephone' | t }}</label>
          <input [id]="id + 'p'" name="phone" type="tel" dir="ltr" maxlength="24" [class]="cls.input" [(ngModel)]="m.phone" /></div>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'Directory.active' | t }}</label>
        @if (!branch()) { <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="shared" class="h-5 w-5" [(ngModel)]="m.sharedAccessEnabled" /> {{ 'AdminV2.sharedAccess' | t }}</label> }
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (row() ? 'Directory.saveChanges' : 'Directory.create') | t }}</button>
        @if (row()) {
          @if (confirmDelete()) {
            <span class="text-sm font-semibold">{{ 'Directory.deleteConfirm' | t }}</span>
            <button type="button" [class]="cls.danger" (click)="remove.emit()">{{ 'Directory.deleteYes' | t }}</button>
            <button type="button" [class]="cls.btn2" (click)="confirmDelete.set(false)">{{ 'Directory.cancel' | t }}</button>
          } @else { <button type="button" [class]="cls.danger" (click)="confirmDelete.set(true)">{{ 'Directory.delete' | t }}</button> }
        }
      </div>
      @if (row()) { <p class="text-sm text-muted">{{ (branch() ? 'Directory.deleteHintBranch' : 'Directory.deleteHintOrg') | t }}</p> }
    </form>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PlaceForm implements OnInit {
  protected readonly cls = CLS;
  protected readonly id = 'pl' + Math.random().toString(36).slice(2, 8);
  readonly row = input<BranchRow | OrgRow | null>(null);
  readonly branch = input(false);
  readonly lk = input<Lookups | null>(null);
  readonly busy = input(false);
  readonly save = output<PlaceModel>();
  readonly remove = output<void>();
  protected readonly confirmDelete = signal(false);
  protected m: PlaceModel = { name: '', location: '', phone: '', teamLeaderId: null, isActive: true, sharedAccessEnabled: false };

  ngOnInit(): void { this.reset(); }
  reset(): void {
    const r = this.row();
    this.m = {
      name: r?.name ?? '', location: r?.location ?? '', phone: r?.phone ?? '', teamLeaderId: r?.teamLeaderId ?? null,
      isActive: r?.isActive ?? true, sharedAccessEnabled: (r as OrgRow | null)?.sharedAccessEnabled ?? false,
    };
  }
  protected submit(): void { this.save.emit({ ...this.m }); }
}

@Component({
  selector: 'app-admin-orgs',
  imports: [TPipe, Alert, PlaceForm],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      @if (lk() && !lk()!.leaders.length) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminOrgs.noLeaders' | t }}</p> }
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminOrgs.addOrgBtn' | t }}</span></summary>
        <div class="px-5 pb-5">@if (lk()) { <app-place-form #pf [lk]="lk()" [busy]="busy()" (save)="createOrg($event, pf, add)" /> }</div>
      </details>
      ${SEARCH}
      @if (rows() && !rows()!.length) { <p class="text-muted">{{ 'AdminOrgs.empty' | t }}</p> }
      @else if (rows() && !filtered().length) { <p class="text-muted">{{ 'AdminOrgs.noMatch' | t }}</p> }
      <ul class="flex flex-col gap-3">
        @for (o of filtered(); track o.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ o.name }}</span>
                <span [class]="o.isActive ? cls.badgeOn : cls.badgeOff">{{ (o.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminOrgs.counts' | t: { customers: o.customers, branches: o.branches.length } }}
                @if (o.teamLeaderId) { · {{ 'Directory.teamLeader' | t }}: {{ leader(o.teamLeaderId) }} }</span>
            </summary>
            <div class="flex flex-col gap-5 px-5 pb-5">
              <app-place-form [row]="o" [lk]="lk()" [busy]="busy()" (save)="updateOrg(o, $event)" (remove)="deleteOrg(o)" />
              <section class="border-t border-line pt-4">
                <h2 class="text-lg font-bold">{{ 'AdminOrgs.branches' | t }}</h2>
                @if (!o.branches.length) { <p class="mt-1 text-sm text-muted">{{ 'AdminOrgs.noBranches' | t }}</p> }
                <ul class="mt-3 flex flex-col gap-2">
                  @for (b of o.branches; track b.id) {
                    <li><details class="rounded-lg border border-line">
                      <summary class="cursor-pointer px-4 py-3">
                        <span class="font-semibold" dir="auto">{{ b.name }}</span>
                        <span class="text-sm text-muted"> · {{ 'AdminOrgs.branchCustomers' | t: { count: b.customers } }}</span>
                        @if (!b.isActive) { <span [class]="cls.badgeOff + ' ms-2'">{{ 'Directory.inactive' | t }}</span> }
                      </summary>
                      <div class="px-4 pb-4"><app-place-form [row]="b" [branch]="true" [lk]="lk()" [busy]="busy()" (save)="updateBranch(o, b, $event)" (remove)="deleteBranch(b)" /></div>
                    </details></li>
                  }
                </ul>
                <details class="mt-3 rounded-lg border border-dashed border-line" #addb>
                  <summary class="cursor-pointer px-4 py-3 font-semibold text-brand-ink">{{ 'AdminOrgs.addBranchBtn' | t }}</summary>
                  <div class="px-4 pb-4"><app-place-form #bf [branch]="true" [lk]="lk()" [busy]="busy()" (save)="createBranch(o, $event, bf, addb)" /></div>
                </details>
              </section>
            </div>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminOrgsPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminOrgs.title';
  protected readonly subtitle = 'AdminOrgs.subtitle';
  protected readonly rows = signal<OrgRow[] | null>(null);
  protected readonly filtered = computed(() => (this.rows() ?? []).filter((o) => this.matches(o.name, o.location, ...o.branches.map((b) => b.name))));

  async ngOnInit(): Promise<void> { await Promise.all([this.loadLookups(), this.reload()]); }
  protected async reload(): Promise<void> {
    try { this.rows.set(await this.api.get<OrgRow[]>('organizations')); } catch (e) { this.fail(e); }
  }
  protected leader(id: string): string { return this.lk()?.leaders.find((p) => p.id === id)?.fullName ?? ''; }
  protected async createOrg(m: PlaceModel, f: PlaceForm, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('organizations', m))) { f.reset(); box.open = false; await this.loadLookups(); }
  }
  protected updateOrg(o: OrgRow, m: PlaceModel): void { void this.run(() => this.api.put('organizations/' + o.id, m)); }
  protected async deleteOrg(o: OrgRow): Promise<void> { if (await this.run(() => this.api.del('organizations/' + o.id), 'AdminV2.deleted')) await this.loadLookups(); }
  protected async createBranch(o: OrgRow, m: PlaceModel, f: PlaceForm, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('branches', { ...m, organizationId: o.id }))) { f.reset(); box.open = false; await this.loadLookups(); }
  }
  protected updateBranch(o: OrgRow, b: BranchRow, m: PlaceModel): void { void this.run(() => this.api.put('branches/' + b.id, { ...m, organizationId: o.id })); }
  protected async deleteBranch(b: BranchRow): Promise<void> { if (await this.run(() => this.api.del('branches/' + b.id), 'AdminV2.deleted')) await this.loadLookups(); }
}

// ================================================================== teams

@Component({
  selector: 'app-admin-teams',
  imports: [TPipe, Alert, FormsModule, Req],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      @if (data() && !data()!.candidates.length) { <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminTeams.noStaff' | t }}</p> }
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Directory.addTeam' | t }}</span></summary>
        <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="create(add)">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1.5"><label for="tn-en" [class]="cls.label">{{ 'Directory.nameEn' | t }}<app-req /></label>
              <input id="tn-en" name="en" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="nw.nameEn" /></div>
            <div class="flex flex-col gap-1.5"><label for="tn-ar" [class]="cls.label">{{ 'Directory.nameAr' | t }}<app-req /></label>
              <input id="tn-ar" name="ar" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="nw.nameAr" /></div>
          </div>
          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
        </form>
      </details>
      ${SEARCH}
      @if (data() && !filtered().length) { <p class="text-muted">{{ 'AdminTeams.noMatch' | t }}</p> }
      <ul class="flex flex-col gap-3">
        @for (t of filtered(); track t.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
                <span [class]="t.isActive ? cls.badgeOn : cls.badgeOff">{{ (t.isActive ? 'Directory.active' : 'Directory.inactive') | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminTeams.memberCount' | t: { count: t.members.length } }} · {{ 'Directory.teamLeader' | t }}: <span dir="auto">{{ leaders(t) || '-' }}</span></span>
            </summary>
            <div class="flex flex-col gap-5 px-5 pb-5">
              <section>
                <h2 class="text-lg font-bold">{{ 'AdminTeams.members' | t }}</h2>
                @if (!t.members.length) { <p class="mt-1 text-sm text-muted">{{ 'AdminTeams.none' | t }}</p> }
                <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
                  @for (mb of t.members; track mb.userId) {
                    <li class="flex flex-wrap items-center gap-3 px-4 py-2">
                      <span class="flex-1"><span class="font-semibold" dir="auto">{{ mb.fullName }}</span> <span class="text-sm text-muted" dir="ltr">{{ mb.email }}</span>
                        @if (mb.isLeader) { <span [class]="cls.badgeOn + ' ms-2'">{{ 'AdminTeams.leader' | t }}</span> }</span>
                      @if (canLead(mb.userId)) {
                        <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="setLeader(t, mb.userId, !mb.isLeader)">{{ (mb.isLeader ? 'AdminV2.unsetLeader' : 'AdminV2.setLeader') | t }}</button>
                      }
                      <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="removeMember(t, mb.userId)">{{ 'AdminTeams.remove' | t }}</button>
                    </li>
                  }
                </ul>
                <form class="mt-3 flex flex-wrap items-end gap-2" (ngSubmit)="addMember(t)">
                  <div class="flex min-w-64 flex-1 flex-col gap-1.5"><label [for]="'am' + t.id" [class]="cls.label">{{ 'AdminTeams.add' | t }}</label>
                    <select [id]="'am' + t.id" [name]="'am' + t.id" [class]="cls.input" [(ngModel)]="adding[t.id]">
                      <option [ngValue]="undefined">{{ 'AdminTeams.selectUser' | t }}</option>
                      @for (c of free(t); track c.id) { <option [ngValue]="c.id">{{ c.fullName }} ({{ c.email }}) · {{ 'Roles.' + c.role | t }}</option> }
                    </select></div>
                  <button type="submit" [class]="cls.btn" [disabled]="busy() || !adding[t.id]">{{ 'AdminTeams.save' | t }}</button>
                </form>
              </section>
              <details class="border-t border-line pt-3">
                <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Directory.editDetails' | t }}</summary>
                <form class="mt-3 flex flex-col gap-4" (ngSubmit)="update(t)">
                  <div class="grid gap-4 md:grid-cols-2">
                    <div class="flex flex-col gap-1.5"><label [for]="'te' + t.id" [class]="cls.label">{{ 'Directory.nameEn' | t }}<app-req /></label>
                      <input [id]="'te' + t.id" name="en" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="edit[t.id].nameEn" /></div>
                    <div class="flex flex-col gap-1.5"><label [for]="'ta' + t.id" [class]="cls.label">{{ 'Directory.nameAr' | t }}<app-req /></label>
                      <input [id]="'ta' + t.id" name="ar" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="edit[t.id].nameAr" /></div>
                  </div>
                  <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="act" class="h-5 w-5" [(ngModel)]="edit[t.id].isActive" /> {{ 'Directory.active' | t }}</label>
                  <div class="flex flex-wrap items-center gap-2">
                    <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                    @if (confirmDel() === t.id) {
                      <span class="text-sm font-semibold">{{ 'Directory.deleteConfirm' | t }}</span>
                      <button type="button" [class]="cls.danger" (click)="remove(t)">{{ 'Directory.deleteYes' | t }}</button>
                      <button type="button" [class]="cls.btn2" (click)="confirmDel.set(null)">{{ 'Directory.cancel' | t }}</button>
                    } @else { <button type="button" [class]="cls.danger" (click)="confirmDel.set(t.id)">{{ 'Directory.delete' | t }}</button> }
                  </div>
                  <p class="text-sm text-muted">{{ 'Directory.deleteHintTeam' | t }}</p>
                </form>
              </details>
            </div>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminTeamsPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminTeams.title';
  protected readonly subtitle = 'AdminTeams.subtitle';
  protected readonly data = signal<TeamsResult | null>(null);
  protected readonly confirmDel = signal<string | null>(null);
  protected readonly filtered = computed(() => (this.data()?.teams ?? []).filter((t) => this.matches(t.nameEn, t.nameAr, ...t.members.flatMap((m) => [m.fullName, m.email]))));
  protected nw = { nameEn: '', nameAr: '', isActive: true };
  protected adding: Record<string, string | undefined> = {};
  protected edit: Record<string, { nameEn: string; nameAr: string; isActive: boolean }> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<TeamsResult>('teams');
      for (const t of d.teams) this.edit[t.id] = { nameEn: t.nameEn, nameAr: t.nameAr, isActive: t.isActive };
      this.adding = {};
      this.confirmDel.set(null);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected leaders(t: TeamRow): string { return t.members.filter((m) => m.isLeader).map((m) => m.fullName).join(', '); }
  protected free(t: TeamRow) { const taken = new Set(t.members.map((m) => m.userId)); return (this.data()?.candidates ?? []).filter((c) => !taken.has(c.id)); }
  protected canLead(userId: string): boolean { return this.data()?.candidates.find((c) => c.id === userId)?.role === 'team_leader'; }
  private members(t: TeamRow, change: (list: { userId: string; isLeader: boolean }[]) => { userId: string; isLeader: boolean }[]) {
    const list = change(t.members.map((m) => ({ userId: m.userId, isLeader: m.isLeader })));
    return this.run(() => this.api.put(`teams/${t.id}/members`, { members: list }));
  }
  protected addMember(t: TeamRow): void { const id = this.adding[t.id]; if (id) void this.members(t, (l) => [...l, { userId: id, isLeader: false }]); }
  protected removeMember(t: TeamRow, id: string): void { void this.members(t, (l) => l.filter((m) => m.userId !== id)); }
  protected setLeader(t: TeamRow, id: string, on: boolean): void { void this.members(t, (l) => l.map((m) => (m.userId === id ? { ...m, isLeader: on } : m))); }
  protected async create(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('teams', this.nw))) { this.nw = { nameEn: '', nameAr: '', isActive: true }; box.open = false; }
  }
  protected update(t: TeamRow): void { void this.run(() => this.api.put('teams/' + t.id, this.edit[t.id])); }
  protected remove(t: TeamRow): void { void this.run(() => this.api.del('teams/' + t.id), 'AdminV2.deleted'); }
}
