import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, forwardRef, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TicketsApi } from '../../core/api';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import {
  AccessRow, AccountTypeRow, AdminApi, AdminUser, BranchRow, Lookups, OrgRow, TeamRow, TeamsResult, TypeBody, UserBody,
  adminError, generatePassword,
} from '../../core/admin-api';
import { Alert, Req, StatusBadge } from '../../shared/ui';
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
  imports: [FormsModule, TPipe, Req, WhereEditor, forwardRef(() => TurnBack)],
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
        @if (u.mfaEnabled && !u.isSelf) { <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="act.emit({ kind: 'mfa', value: '' })">{{ 'Mfa.reset' | t }}</button> }
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
      @if (mode() === 'staff' && !u.isSelf) { <app-turn-back [userId]="u.id" (done)="act.emit({ kind: 'status', value: '__reload' })" /> }
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
  readonly act = output<{ kind: 'status' | 'password' | 'delete' | 'mfa'; value: string }>();
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

// ================================================================== customers

interface CustomerRow { id: string; fullName: string; email: string; phone: string | null; accountStatus: string; createdAt: string; organization: string | null; branch: string | null; tickets: number; open: number }

/** Customers screen, same as v1 /console/customers: add form (admins), search, and a table of the customers this person may see. */
@Component({
  selector: 'app-admin-customers',
  imports: [TPipe, Alert, PersonForm, RouterLink, FormsModule],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      @if (isAdmin()) {
        <details [class]="cls.card" #add>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Customers.addCustomer' | t }}</span></summary>
          <div class="px-5 pb-5">
            @if (lk()) { <app-person-form #pf mode="customer" [lk]="lk()" [busy]="busy()" (save)="create($event, pf, add)" /> }
          </div>
        </details>
      }
      <form role="search" class="flex flex-wrap gap-2" (ngSubmit)="search()">
        <label class="sr-only" for="cq">{{ 'Customers.search' | t }}</label>
        <input id="cq" name="q" type="search" dir="auto" [placeholder]="'Customers.searchPlaceholder' | t" [(ngModel)]="term"
          class="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-base" />
        <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Customers.searchButton' | t }}</button>
      </form>
      @if (!rows()) { <p class="text-muted">…</p> }
      @else if (!rows()!.length) { <p role="status" class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Customers.empty' | t }}</p> }
      @else {
        <div class="relative overflow-x-auto rounded-md border border-line bg-surface">
          <table class="w-full min-w-[48rem] text-start">
            <caption class="sr-only">{{ 'Customers.title' | t }}</caption>
            <thead class="bg-chrome text-white"><tr class="text-sm">
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.name' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.email' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.organization' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.branch' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.statusHeader' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.registered' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Customers.tickets' | t }}</th>
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-b border-line last:border-0">
                  <td class="px-4 py-3"><a [routerLink]="'/' + i18n.locale() + '/console/customers/' + r.id" class="font-semibold text-brand-ink underline" dir="auto">{{ r.fullName || r.email }}</a></td>
                  <td class="px-4 py-3" dir="ltr">{{ r.email }}</td>
                  <td class="px-4 py-3" dir="auto">{{ r.organization ?? '-' }}</td>
                  <td class="px-4 py-3" dir="auto">{{ r.branch ?? '-' }}</td>
                  <td class="px-4 py-3">{{ 'Customers.status.' + r.accountStatus | t }}</td>
                  <td class="px-4 py-3">{{ i18n.day(r.createdAt) }}</td>
                  <td class="px-4 py-3">{{ 'Customers.ticketCounts' | t: { total: r.tickets, open: r.open } }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminCustomersPage extends AdminBase implements OnInit {
  protected readonly title = 'Customers.title';
  protected readonly subtitle = 'Customers.subtitle';
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly isAdmin = computed(() => !!this.auth.me()?.roles.includes('admin'));
  protected readonly rows = signal<CustomerRow[] | null>(null);
  protected term = '';

  async ngOnInit(): Promise<void> {
    this.term = this.route.snapshot.queryParamMap.get('q') ?? '';
    await Promise.all([this.isAdmin() ? this.loadLookups() : Promise.resolve(), this.reload()]);
  }
  protected async reload(): Promise<void> {
    try {
      const q = this.term.trim().slice(0, 80);
      this.rows.set(await firstValueFrom(this.http.get<CustomerRow[]>('/api/console/customers', { params: q ? { q } : {} })));
    } catch (e) { this.fail(e); }
  }
  protected search(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { q: this.term.trim() || null }, replaceUrl: true });
    void this.reload();
  }
  protected async create(body: UserBody, form: PersonForm, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('users', body), 'Directory.createdUser', { email: body.email, password: body.password })) {
      form.reset();
      box.open = false;
    }
  }
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

// ================================================================== customer profile (v1 /console/customers/[id])

interface CustomerProfile {
  user: AdminUser; organizationName: string | null; branchName: string | null; canEdit: boolean; isAdmin: boolean;
  tickets: { id: string; reference: string; subject: string; status: string; priority: string; createdAt: string }[];
}

@Component({
  selector: 'app-customer-profile',
  imports: [TPipe, Alert, PersonForm, RouterLink, StatusBadge, FormsModule],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <a [routerLink]="'/' + i18n.locale() + '/admin/customers'" class="text-sm font-semibold text-brand-ink underline">{{ 'Customers.title' | t }}</a>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (d(); as d) {
        <header class="rounded-md border border-line bg-surface p-6">
          <h1 class="text-2xl font-bold tracking-tight" dir="auto">{{ d.user.fullName || d.user.email }}</h1>
          <dl class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><dt class="text-sm text-muted">{{ 'Customers.email' | t }}</dt><dd dir="ltr" class="break-all font-semibold">{{ d.user.email }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Customers.phone' | t }}</dt><dd dir="ltr" class="font-semibold">{{ d.user.phone ?? '-' }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Customers.organization' | t }}</dt><dd class="font-semibold" dir="auto">{{ d.organizationName ?? '-' }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Customers.branch' | t }}</dt><dd class="font-semibold" dir="auto">{{ d.branchName ?? '-' }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Customers.statusHeader' | t }}</dt><dd class="font-semibold">{{ 'Status.' + d.user.status | t }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Customers.registered' | t }}</dt><dd class="font-semibold">{{ i18n.date(d.user.createdAt) }}</dd></div>
          </dl>
        </header>

        @if (d.canEdit && lk()) {
          <section aria-labelledby="edit" class="rounded-md border border-line bg-surface p-6"><h2 id="edit" class="mb-3 text-xl font-bold">{{ 'Customers.edit' | t }}</h2>
            <app-person-form mode="customer" [user]="d.user" [lk]="lk()" [busy]="busy()" (save)="update($event)" (act)="action($event)" />
          </section>
        }

        @if (d.isAdmin && !d.user.isSelf && lk()) {
          <section aria-labelledby="promote" class="rounded-md border border-line bg-surface p-6">
            <h2 id="promote" class="mb-1 text-xl font-bold">{{ 'Promote.title' | t }}</h2>
            <p class="mb-4 max-w-prose text-sm text-muted">{{ 'Promote.intro' | t }}</p>
            <form class="flex flex-col gap-4" (ngSubmit)="promote()">
              <fieldset class="flex flex-col gap-2">
                <legend class="mb-1 text-sm font-semibold">{{ 'Promote.roles' | t }}</legend>
                <div class="flex flex-wrap gap-2">
                  @for (r of staffRoles; track r) {
                    <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4" [class]="pm.role === r ? 'border-brand bg-brand-soft' : 'border-line'">
                      <input type="radio" name="role" [value]="r" [(ngModel)]="pm.role" /> {{ 'Roles.' + r | t }}</label>
                  }
                </div>
                <p class="text-sm text-muted">{{ 'Promote.note' | t }}</p>
              </fieldset>
              @if (pm.role) {
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div class="flex flex-col gap-1.5"><label for="pr-t" [class]="cls.label">{{ 'Promote.accountType' | t }}</label>
                    <select id="pr-t" name="type" [class]="cls.input" [(ngModel)]="pm.accountTypeId">
                      <option [ngValue]="null">{{ 'Promote.noType' | t }}</option>
                      @for (t of lk()!.types; track t.id) { <option [ngValue]="t.id">{{ i18n.pick(t.nameEn, t.nameAr) }}</option> }
                    </select></div>
                  @if (pm.role === 'agent' || pm.role === 'team_leader') {
                    <div class="flex flex-col gap-1.5"><label for="pr-team" [class]="cls.label">{{ 'Promote.team' | t }}</label>
                      <select id="pr-team" name="team" [class]="cls.input" [(ngModel)]="pm.teamId">
                        <option [ngValue]="null">{{ 'Promote.noTeam' | t }}</option>
                        @for (t of activeTeams(); track t.id) { <option [ngValue]="t.id">{{ i18n.pick(t.nameEn, t.nameAr) }}</option> }
                      </select></div>
                    <label class="flex min-h-11 items-center gap-2 md:col-span-2"><input type="checkbox" name="auto" class="h-5 w-5" [(ngModel)]="pm.autoAssign" /> {{ 'Promote.auto' | t }}</label>
                  }
                </div>
              }
              <div><button type="submit" [class]="cls.btn" [disabled]="busy() || !pm.role">{{ 'Promote.button' | t }}</button></div>
            </form>
          </section>
        }

        <section aria-labelledby="hist"><h2 id="hist" class="mb-3 text-xl font-bold">{{ 'Customers.history' | t }}</h2>
          @if (!d.tickets.length) { <p class="text-muted">{{ 'Customers.noTickets' | t }}</p> }
          @else {
            <ul class="flex flex-col gap-2">
              @for (r of d.tickets; track r.id) {
                <li class="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface p-4">
                  <a [routerLink]="'/' + i18n.locale() + '/console/tickets/' + r.id" class="font-semibold text-brand-ink underline" dir="auto"><span dir="ltr">{{ r.reference }}</span> · {{ r.subject }}</a>
                  <span class="flex items-center gap-2"><span class="rounded-full bg-bg px-3 py-1 text-xs font-semibold text-muted">{{ priorityName(r.priority) }}</span><app-status-badge [status]="r.status" [staff]="true" /></span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class CustomerProfilePage extends AdminBase implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly tickets = inject(TicketsApi);
  private readonly prios = signal<{ code: string; nameEn: string; nameAr: string }[]>([]);
  protected readonly d = signal<CustomerProfile | null>(null);
  protected readonly staffRoles = ['agent', 'team_leader', 'admin', 'management_viewer'];
  protected readonly activeTeams = computed(() => (this.lk()?.teams ?? []).filter((t) => t.isActive));
  protected pm = { role: '', accountTypeId: null as string | null, teamId: null as string | null, autoAssign: false };
  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  async ngOnInit(): Promise<void> {
    void this.tickets.options().then((o) => this.prios.set(o.priorities)).catch(() => undefined);
    await Promise.all([this.loadLookups(), this.reload()]);
  }
  protected async reload(): Promise<void> {
    try { this.d.set(await firstValueFrom(this.http.get<CustomerProfile>('/api/console/customers/' + this.id))); } catch (e) { this.fail(e); }
  }
  protected priorityName(code: string): string {
    const p = this.prios().find((x) => x.code === code);
    return p ? this.i18n.pick(p.nameEn, p.nameAr) : code;
  }
  protected update(body: UserBody): void { void this.run(() => this.api.put('users/' + this.id, body)); }
  protected action(a: { kind: string; value: string }): void {
    if (a.kind === 'mfa') { void this.run(() => this.api.post(`users/${this.id}/reset-mfa`, {})); return; }
    if (a.kind === 'status') void this.run(() => this.api.post(`users/${this.id}/status`, { status: a.value }));
    else if (a.kind === 'password') void this.run(() => this.api.post(`users/${this.id}/password`, { password: a.value }), 'AdminV2.passwordSet', { password: a.value });
    else void this.api.del('users/' + this.id).then(() => this.router.navigateByUrl(`/${this.i18n.locale()}/admin/customers`)).catch((e) => this.fail(e));
  }
  protected promote(): void {
    void this.api.post(`users/${this.id}/promote`, this.pm).then(() => this.router.navigateByUrl(`/${this.i18n.locale()}/admin/users`)).catch((e) => this.fail(e));
  }
}

/** Staff → customer, with a confirmation step (v1 TurnBack). */
@Component({
  selector: 'app-turn-back',
  imports: [TPipe, Alert],
  template: `
    <div class="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      <p class="text-sm font-semibold">{{ 'Promote.turnBack' | t }}</p>
      <p class="text-sm text-muted">{{ 'Promote.turnBackNote' | t }}</p>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <div class="flex flex-wrap items-center gap-3">
        @if (ask()) {
          <button type="button" [disabled]="busy()" (click)="go()" class="min-h-11 cursor-pointer rounded-lg bg-danger px-5 font-semibold text-white disabled:opacity-60">{{ 'Promote.turnBackYes' | t }}</button>
          <button type="button" (click)="ask.set(false)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold">{{ 'Promote.cancel' | t }}</button>
        } @else {
          <button type="button" (click)="ask.set(true)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Promote.turnBack' | t }}</button>
        }
      </div>
    </div>`,
})
export class TurnBack {
  private readonly api = inject(AdminApi);
  private readonly i18n = inject(I18n);
  readonly userId = input.required<string>();
  readonly done = output<void>();
  protected readonly ask = signal(false);
  protected readonly busy = signal(false);
  protected readonly msg = signal<Msg>(null);
  protected async go(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try { await this.api.post(`users/${this.userId()}/demote`, {}); this.ask.set(false); this.done.emit(); }
    catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
}
