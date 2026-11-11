import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountTypeRow, AccessRow } from '../../core/admin-api';
import { TPipe } from '../../core/i18n';
import { Alert, Req } from '../../shared/ui';
import { AdminBase } from './admin-pages';

// Batch 4B: Permissions laid out as in v1 — tabs (Account types | Staff), a table of types with View / Edit,
// one page per type with three numbered steps, and a staff table where the type and auto-assign are picked.

/** v1 lib/permissions/catalog.ts. "manage_users" is Administrator only and never stored, but counts in the total. */
export const PERMISSION_GROUPS = [
  { key: 'tickets', perms: ['reply', 'resolve', 'close', 'change_category', 'assign_self', 'assign_others', 'view_unassigned', 'view_others', 'all_teams'] },
  { key: 'reports', perms: ['reports_own', 'reports_all', 'export'] },
  { key: 'customers', perms: ['customers_view', 'customers_manage', 'approve_customers'] },
  { key: 'admin', perms: ['manage_kb', 'manage_catalog', 'manage_settings', 'manage_canned'] },
];
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms);
export const PERMISSION_TOTAL = ALL_PERMISSIONS.length + 1;

interface StaffLite {
  id: string; fullName: string; email: string; isSelf: boolean; accountTypeId: string | null; autoAssign: boolean;
  teams: { nameEn: string; nameAr: string; isLeader: boolean }[];
}

const TAB = 'px-5 py-3 font-semibold';

@Component({
  selector: 'app-admin-permissions',
  imports: [TPipe, Alert, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Permissions.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Permissions.subtitle' | t }}</p></div>
      <nav [attr.aria-label]="'Permissions.title' | t" class="flex gap-2 border-b-2 border-line">
        <a [routerLink]="base" [attr.aria-current]="tab() === 'types' ? 'page' : null" [class]="tabCls(tab() === 'types')">{{ 'Permissions.tabTypes' | t }}</a>
        <a [routerLink]="base" [queryParams]="{ tab: 'staff' }" [attr.aria-current]="tab() === 'staff' ? 'page' : null" [class]="tabCls(tab() === 'staff')">{{ 'Permissions.tabStaff' | t }}</a>
      </nav>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @if (tab() === 'types') {
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-muted">{{ 'Permissions.summaryTypes' | t: { types: types().length, staff: staff().length } }}</p>
          <a [routerLink]="base + '/types/new'" class="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Permissions.addType' | t }}</a>
        </div>
        <div class="relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table class="w-full min-w-[720px] border-collapse text-start">
            <thead><tr class="bg-bg text-sm text-muted">
              <th scope="col" class="px-5 py-3 text-start font-semibold">{{ 'Permissions.colType' | t }}</th>
              <th scope="col" class="px-5 py-3 text-start font-semibold">{{ 'Permissions.colAccess' | t }}</th>
              <th scope="col" class="px-5 py-3 text-start font-semibold">{{ 'Permissions.colPerms' | t }}</th>
              <th scope="col" class="px-5 py-3 text-start font-semibold">{{ 'Permissions.colStaff' | t }}</th>
              <th scope="col" class="px-5 py-3"><span class="sr-only">{{ 'Permissions.colActions' | t }}</span></th>
            </tr></thead>
            <tbody>
              @for (x of types(); track x.id) {
                <tr class="border-t border-line">
                  <th scope="row" class="px-5 py-4 text-start font-semibold">
                    <span dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</span>
                    @if (x.isBuiltin) { <span class="ms-2 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">{{ 'Permissions.builtin' | t }}</span> }
                    <span class="mt-0.5 block text-sm font-normal text-muted" dir="auto">{{ i18n.locale() === 'ar' ? x.nameEn : x.nameAr }}</span>
                  </th>
                  <td class="px-5 py-4">{{ accessLabel(x) }}</td>
                  <td class="px-5 py-4">{{ x.isBuiltin ? ('Permissions.countAll' | t: { total: total }) : ('Permissions.count' | t: { n: x.permissions.length, total: total }) }}</td>
                  <td class="px-5 py-4">{{ x.staff }}</td>
                  <td class="px-5 py-4 text-end"><a [routerLink]="base + '/types/' + x.id" class="font-semibold text-brand-ink underline">{{ (x.isBuiltin ? 'Permissions.view' : 'Permissions.edit') | t }}</a></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <ul class="flex flex-col gap-1 text-sm text-muted"><li>{{ 'Permissions.noteEdit' | t }}</li><li>{{ 'Permissions.noteDelete' | t }}</li></ul>
      } @else {
        <form class="flex flex-wrap items-center gap-3" (ngSubmit)="applyFilter()">
          <input name="q" type="search" [(ngModel)]="qIn" [placeholder]="'Permissions.searchStaff' | t" [attr.aria-label]="'Permissions.searchStaff' | t" class="min-h-11 w-80 max-w-full rounded-lg border border-line bg-surface px-3" />
          <select name="type" [(ngModel)]="typeIn" [attr.aria-label]="'Permissions.filterType' | t" class="min-h-11 rounded-lg border border-line bg-surface px-3">
            <option value="">{{ 'Permissions.allTypes' | t }}</option>
            @for (o of types(); track o.id) { <option [value]="o.id">{{ i18n.pick(o.nameEn, o.nameAr) }}</option> }
          </select>
          <button type="submit" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Permissions.filter' | t }}</button>
          <span class="text-muted">{{ 'Permissions.staffCount' | t: { n: rows().length } }}</span>
        </form>
        <div class="relative overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table class="w-full min-w-[960px] border-collapse">
            <thead><tr class="bg-bg text-sm text-muted">
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Permissions.colMember' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Permissions.colTeams' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Permissions.colType' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Permissions.colAccess' | t }}</th>
              <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Permissions.colAuto' | t }}</th>
              <th scope="col" class="px-4 py-3"><span class="sr-only">{{ 'Permissions.save' | t }}</span></th>
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                @let e = edit[r.id];
                @let cur = typeOf(e.typeId);
                <tr class="border-t border-line align-middle">
                  <th scope="row" class="px-4 py-3 text-start font-semibold"><span dir="auto">{{ r.fullName }}</span><span class="block text-sm font-normal text-muted" dir="ltr">{{ r.email }}</span></th>
                  <td class="px-4 py-3 text-muted" dir="auto">{{ teamsOf(r) || '-' }}</td>
                  <td class="px-4 py-3">
                    <select [attr.aria-label]="'Permissions.typeFor' | t: { name: r.fullName }" [disabled]="r.isSelf" [(ngModel)]="e.typeId" (ngModelChange)="e.confirm = false"
                      class="min-h-11 w-full min-w-52 rounded-lg border border-line bg-surface px-3 text-base">
                      @if (!r.accountTypeId) { <option value="" disabled>{{ 'Permissions.notSet' | t }}</option> }
                      @for (x of types(); track x.id) { <option [value]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }
                    </select>
                    @if (r.isSelf) { <span class="block text-xs text-muted">{{ 'Permissions.selfLocked' | t }}</span> }
                  </td>
                  <td class="px-4 py-3">{{ cur ? accessLabel(cur) : '-' }}</td>
                  <td class="px-4 py-3">
                    @if (cur?.isBuiltin || !r.teams.length) { <span class="text-muted">{{ 'Permissions.notApplicable' | t }}</span> } @else {
                      <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5" [(ngModel)]="e.auto" [disabled]="r.isSelf" />{{ (e.auto ? 'Permissions.on' : 'Permissions.off') | t }}</label>
                    }
                  </td>
                  <td class="px-4 py-3 text-end">
                    @if (r.isSelf || !dirty(r)) { <span class="text-sm text-muted">{{ 'Permissions.noChanges' | t }}</span> }
                    @else if (!e.confirm) {
                      <button type="button" [disabled]="busy()" (click)="toAdmin(r) ? (e.confirm = true) : saveRow(r)" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-60">{{ (busy() && savingId === r.id ? 'Permissions.saving' : 'Permissions.save') | t }}</button>
                    }
                  </td>
                </tr>
                @if (e.confirm) {
                  <tr><td colspan="6" class="px-4 pb-3"><div role="alert" class="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-warn-ink">
                    <span class="font-semibold">{{ 'Permissions.confirmAdmin' | t: { name: r.fullName } }}</span>
                    <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-brand px-4 font-semibold text-white" (click)="e.confirm = false; saveRow(r)">{{ 'Permissions.confirmYes' | t }}</button>
                    <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold" (click)="e.confirm = false">{{ 'Permissions.cancel' | t }}</button>
                  </div></td></tr>
                }
                <tr><td colspan="6" class="px-4 pb-3">
                  <details>
                    <summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'Permissions.whatCanDo' | t: { name: r.fullName.split(' ')[0] || r.fullName, type: cur ? i18n.pick(cur.nameEn, cur.nameAr) : '' } }}</summary>
                    <div class="mt-2 flex flex-wrap gap-2">
                      @for (p of all; track p) {
                        @if (granted(cur, p)) { <span class="inline-flex min-h-8 items-center rounded-full bg-brand-soft px-3 text-sm font-medium text-brand-ink">{{ 'Permissions.perm.' + p | t }}</span> }
                        @else { <span class="inline-flex min-h-8 items-center rounded-full bg-bg px-3 text-sm text-muted line-through">{{ 'Permissions.perm.' + p | t }}</span> }
                      }
                    </div>
                    <p class="mt-1 text-xs text-muted">{{ 'Permissions.chipsNote' | t }}</p>
                  </details>
                </td></tr>
              }
            </tbody>
          </table>
        </div>
        <ul class="flex flex-col gap-1 text-sm text-muted"><li>{{ 'Permissions.noteAdminPick' | t }}</li><li>{{ 'Permissions.noteSafety' | t }}</li><li>{{ 'Permissions.noteAuto' | t }}</li></ul>
      }
    </main>`,
})
export class AdminPermissionsPage extends AdminBase implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly total = PERMISSION_TOTAL;
  protected readonly all = ALL_PERMISSIONS;
  protected readonly types = signal<AccountTypeRow[]>([]);
  protected readonly staff = signal<StaffLite[]>([]);
  protected readonly tab = signal<'types' | 'staff'>('types');
  private readonly search = signal({ q: '', type: '' });
  protected qIn = '';
  protected typeIn = '';
  protected savingId = '';
  protected edit: Record<string, { typeId: string; auto: boolean; confirm: boolean }> = {};
  protected get base(): string { return '/' + this.i18n.locale() + '/admin/permissions'; }
  protected tabCls(on: boolean): string { return `${TAB} ${on ? 'border-b-4 border-brand text-brand-ink' : 'text-muted hover:text-ink'}`; }
  protected readonly rows = computed(() => {
    const { q, type } = this.search();
    const s = q.trim().toLowerCase();
    return this.staff().filter((u) => (!s || u.fullName.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) && (!type || u.accountTypeId === type));
  });
  ngOnInit(): void {
    this.route.queryParamMap.subscribe((m) => {
      this.tab.set(m.get('tab') === 'staff' ? 'staff' : 'types');
      this.qIn = m.get('q') ?? ''; this.typeIn = m.get('type') ?? '';
      this.search.set({ q: this.qIn, type: this.typeIn });
    });
    void this.loadLookups();
    void this.reload();
  }
  protected async reload(): Promise<void> {
    try {
      const [types, s] = await Promise.all([this.api.get<AccountTypeRow[]>('account-types'), this.api.get<{ staff: StaffLite[] }>('staff')]);
      this.types.set(types);
      for (const u of s.staff) this.edit[u.id] = { typeId: u.accountTypeId ?? '', auto: u.autoAssign, confirm: false };
      this.staff.set(s.staff);
    } catch (e) { this.fail(e); }
  }
  protected applyFilter(): void {
    void this.router.navigate([this.base], { queryParams: { tab: 'staff', q: this.qIn || null, type: this.typeIn || null } });
  }
  /** v1 accessLabel(): "All organizations", or "N organizations, all / selected branches". */
  protected accessLabel(x: AccountTypeRow): string {
    if (x.allAccess || x.isBuiltin) return this.i18n.t('Permissions.allOrgs');
    const orgs = new Set(x.access.map((a) => a.organizationId));
    const every = [...orgs].every((o) => x.access.some((a) => a.organizationId === o && !a.branchId));
    return this.i18n.t('Permissions.accessSummary', { orgs: orgs.size, all: every ? 1 : 0 });
  }
  protected typeOf(id: string): AccountTypeRow | undefined { return this.types().find((x) => x.id === id); }
  protected teamsOf(r: StaffLite): string { return r.teams.map((t) => this.i18n.pick(t.nameEn, t.nameAr) + (t.isLeader ? ` (${this.i18n.t('Permissions.leader')})` : '')).join(', '); }
  protected granted(t: AccountTypeRow | undefined, p: string): boolean { return !!t && (t.isBuiltin || t.permissions.includes(p)); }
  protected dirty(r: StaffLite): boolean { const e = this.edit[r.id]; return e.typeId !== (r.accountTypeId ?? '') || e.auto !== r.autoAssign; }
  protected toAdmin(r: StaffLite): boolean { const e = this.edit[r.id]; return !!this.typeOf(e.typeId)?.isBuiltin && e.typeId !== r.accountTypeId; }
  protected async saveRow(r: StaffLite): Promise<void> {
    const e = this.edit[r.id];
    this.savingId = r.id;
    await this.run(() => this.api.put(`users/${r.id}/account-type`, { accountTypeId: e.typeId, autoAssign: e.auto && !this.typeOf(e.typeId)?.isBuiltin }));
  }
}

interface AccessEntry { all: boolean; branches: string[] }

/** One account type: 1 name, 2 access, 3 permissions (v1 AccountTypeEditor). The built-in Administrator opens read only. */
@Component({
  selector: 'app-admin-type',
  imports: [TPipe, Alert, FormsModule, RouterLink, Req],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div>
        <a [routerLink]="base" class="text-sm font-semibold text-brand-ink underline">← {{ 'Permissions.tabTypes' | t }}</a>
        <h1 class="mt-2 text-3xl font-bold tracking-tight">
          {{ row() ? i18n.pick(row()!.nameEn, row()!.nameAr) : ('Permissions.addType' | t) }}
          @if (locked()) { <span class="ms-3 rounded-md bg-brand-soft px-2 py-1 align-middle text-sm font-semibold text-brand-ink">{{ 'Permissions.builtinLocked' | t }}</span> }
        </h1>
      </div>
      @if (ready()) {
        <form class="flex flex-col gap-6" novalidate (ngSubmit)="save()">
          @if (locked()) { <div role="note" class="rounded-xl border border-brand/30 bg-brand-soft px-5 py-4 text-brand-ink">{{ 'Permissions.lockedNote' | t }}</div> }
          <section aria-labelledby="st-name" [class]="card">
            <h2 id="st-name" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">1</span>{{ 'Permissions.stepName' | t }}</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Permissions.nameEn' | t }}<app-req />
                <input name="en" dir="ltr" maxlength="80" [disabled]="locked()" [class]="cls.input + ' font-normal'" [(ngModel)]="nameEn" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'Permissions.nameAr' | t }}<app-req />
                <input name="ar" dir="rtl" maxlength="80" [disabled]="locked()" [class]="cls.input + ' font-normal'" [(ngModel)]="nameAr" /></label>
            </div>
          </section>
          <section aria-labelledby="st-access" [class]="card">
            <h2 id="st-access" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">2</span>{{ 'Permissions.stepAccess' | t }}</h2>
            <fieldset class="flex flex-col" [disabled]="locked()">
              <legend class="sr-only">{{ 'Permissions.accessLegend' | t }}</legend>
              <label class="flex min-h-11 items-center gap-2"><input type="radio" name="all" class="h-5 w-5" [checked]="locked() || allAccess" (change)="allAccess = true" />{{ 'Permissions.accessAll' | t }}</label>
              <label class="flex min-h-11 items-center gap-2"><input type="radio" name="all" class="h-5 w-5" [checked]="!locked() && !allAccess" (change)="allAccess = false" />{{ 'Permissions.accessSelected' | t }}</label>
            </fieldset>
            @if (!locked() && !allAccess) {
              <div class="flex flex-wrap items-center gap-3">
                <input type="search" name="q" [(ngModel)]="oq" [placeholder]="'Permissions.searchOrgs' | t" [attr.aria-label]="'Permissions.searchOrgs' | t" [class]="cls.input + ' max-w-sm'" />
                <button type="button" class="cursor-pointer text-sm font-semibold text-brand-ink underline" (click)="selectAll()">{{ 'Permissions.selectAll' | t }}</button>
                <button type="button" class="cursor-pointer text-sm font-semibold text-brand-ink underline" (click)="access = {}">{{ 'Permissions.clear' | t }}</button>
              </div>
              <div class="overflow-hidden rounded-lg border border-line">
                @for (o of visible(); track o.id) {
                  @let a = access[o.id];
                  <div class="border-b border-line px-4 py-1 last:border-b-0">
                    <label class="flex min-h-11 items-center gap-2 font-semibold">
                      <input type="checkbox" class="h-5 w-5" [checked]="!!a?.all" [indeterminate]="!!a && !a.all && a.branches.length > 0" (change)="toggleOrg(o.id)" />
                      <span dir="auto">{{ o.name }}</span>
                      <span class="text-sm font-normal text-muted">{{ a?.all ? ('Permissions.allBranches' | t: { n: branchesOf(o.id).length }) : a?.branches?.length ? ('Permissions.someBranches' | t: { a: a!.branches.length, n: branchesOf(o.id).length }) : ('Permissions.noneSelected' | t) }}</span>
                    </label>
                    @if (branchesOf(o.id).length) {
                      <div class="flex flex-wrap gap-x-7 ps-7">
                        @for (b of branchesOf(o.id); track b.id) {
                          <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="!!a && (a.all || a.branches.includes(b.id))" (change)="toggleBranch(o.id, b.id)" /><span dir="auto">{{ b.name }}</span></label>
                        }
                      </div>
                    }
                  </div>
                } @empty { <p class="px-4 py-3 text-muted">{{ 'Permissions.noOrgs' | t }}</p> }
              </div>
              <p role="status" class="font-semibold text-brand-ink">{{ 'Permissions.selectedSummary' | t: { orgs: selectedOrgs(), branches: selectedBranches() } }}</p>
              <p class="text-sm text-muted">{{ 'Permissions.accessHelp' | t }}</p>
            }
          </section>
          <section aria-labelledby="st-perms" [class]="card">
            <h2 id="st-perms" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">3</span>{{ 'Permissions.stepPermissions' | t }}</h2>
            <p class="text-sm text-muted">{{ (locked() ? 'Permissions.permsLockedHelp' : hasAccess() ? 'Permissions.permsHelp' : 'Permissions.chooseAccessFirst') | t }}</p>
            <label class="flex min-h-11 items-center gap-2 rounded-lg bg-bg px-3 text-muted"><input type="checkbox" class="h-5 w-5" checked disabled />{{ 'Permissions.viewAlways' | t }}</label>
            <fieldset [disabled]="locked() || !hasAccess()" class="grid gap-x-10 gap-y-6 sm:grid-cols-2" [class.opacity-50]="!locked() && !hasAccess()">
              <legend class="sr-only">{{ 'Permissions.stepPermissions' | t }}</legend>
              @for (g of groups; track g.key) {
                <div class="flex flex-col">
                  <h3 class="pb-1 text-lg font-bold">{{ 'Permissions.groups.' + g.key | t }}</h3>
                  @for (p of g.perms; track p) {
                    <label class="flex min-h-11 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="perms.has(p)" (change)="togglePerm(p)" />{{ 'Permissions.perm.' + p | t }}</label>
                  }
                  @if (g.key === 'admin') {
                    <label class="flex min-h-11 items-center gap-2 text-muted"><input type="checkbox" class="h-5 w-5" [checked]="locked()" disabled />{{ 'Permissions.perm.manage_users' | t }} <span class="text-sm">({{ 'Permissions.adminOnly' | t }})</span></label>
                  }
                </div>
              }
            </fieldset>
            <p role="status" class="font-semibold text-brand-ink">{{ locked() ? ('Permissions.countAll' | t: { total: total }) : ('Permissions.count' | t: { n: perms.size, total: total }) }}</p>
            @if (!locked() && perms.has('assign_others')) { <p class="text-sm text-muted">{{ 'Permissions.leaderHint' | t }}</p> }
          </section>
          <div class="flex flex-wrap items-center gap-3">
            @if (!locked()) { <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Permissions.saveType' | t }}</button> }
            <a [routerLink]="base" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ (locked() ? 'Permissions.backToTypes' : 'Permissions.cancel') | t }}</a>
            @if (!locked() && row()) {
              @if (row()!.staff > 0) { <span class="text-sm text-muted">{{ 'Permissions.deleteBlocked' | t: { n: row()!.staff } }}</span> }
              @else if (asking()) {
                <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 font-semibold text-white" (click)="remove()">{{ 'Directory.deleteYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold" (click)="asking.set(false)">{{ 'Directory.cancel' | t }}</button>
              } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 font-semibold text-danger hover:bg-danger-soft" (click)="asking.set(true)">{{ 'Permissions.deleteType' | t }}</button> }
            }
          </div>
          @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
        </form>
      }
    </main>`,
})
export class AdminTypePage extends AdminBase implements OnInit {
  readonly id = input<string>('new');
  private readonly router = inject(Router);
  protected readonly card = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-card';
  protected readonly step = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-white';
  protected readonly groups = PERMISSION_GROUPS;
  protected readonly total = PERMISSION_TOTAL;
  protected readonly row = signal<AccountTypeRow | null>(null);
  protected readonly ready = signal(false);
  protected readonly asking = signal(false);
  protected readonly locked = computed(() => !!this.row()?.isBuiltin);
  protected nameEn = '';
  protected nameAr = '';
  protected allAccess = false;
  protected oq = '';
  protected access: Record<string, AccessEntry> = {};
  protected perms = new Set<string>();
  protected get base(): string { return '/' + this.i18n.locale() + '/admin/permissions'; }
  protected visible() {
    const s = this.oq.trim().toLowerCase();
    const orgs = [...(this.lk()?.orgs ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    return s ? orgs.filter((o) => o.name.toLowerCase().includes(s) || this.branchesOf(o.id).some((b) => b.name.toLowerCase().includes(s))) : orgs;
  }
  protected override branchesOf(org: string | null) { return super.branchesOf(org).slice().sort((a, b) => a.name.localeCompare(b.name)); }
  protected hasAccess(): boolean { return this.locked() || this.allAccess || Object.values(this.access).some((a) => a.all || a.branches.length > 0); }
  protected selectedOrgs(): number { return Object.values(this.access).filter((a) => a.all || a.branches.length).length; }
  protected selectedBranches(): number { return Object.entries(this.access).reduce((n, [id, a]) => n + (a.all ? this.branchesOf(id).length : a.branches.length), 0); }
  async ngOnInit(): Promise<void> {
    await this.loadLookups();
    await this.reload();
  }
  protected async reload(): Promise<void> {
    if (this.id() === 'new') { this.ready.set(true); return; }
    try {
      const t = (await this.api.get<AccountTypeRow[]>('account-types')).find((x) => x.id === this.id());
      if (!t) { void this.router.navigateByUrl(this.base); return; }
      this.row.set(t);
      this.nameEn = t.nameEn; this.nameAr = t.nameAr; this.allAccess = t.allAccess || t.isBuiltin;
      this.access = {};
      for (const r of t.access) {
        const cur = this.access[r.organizationId] ?? { all: false, branches: [] };
        if (!r.branchId) cur.all = true; else cur.branches.push(r.branchId);
        this.access[r.organizationId] = cur;
      }
      this.perms = new Set(t.isBuiltin ? ALL_PERMISSIONS : t.permissions);
      this.ready.set(true);
    } catch (e) { this.fail(e); }
  }
  protected selectAll(): void { this.access = Object.fromEntries((this.lk()?.orgs ?? []).map((o) => [o.id, { all: true, branches: [] }])); }
  protected toggleOrg(id: string): void {
    const c = this.access[id];
    const next = { ...this.access };
    if (c && (c.all || c.branches.length)) delete next[id]; else next[id] = { all: true, branches: [] };
    this.access = next;
  }
  protected toggleBranch(org: string, bid: string): void {
    const all = this.branchesOf(org);
    const c = this.access[org] ?? { all: false, branches: [] };
    const set = new Set(c.all ? all.map((b) => b.id) : c.branches);
    if (set.has(bid)) set.delete(bid); else set.add(bid);
    const next = { ...this.access };
    if (set.size === 0) delete next[org];
    else if (set.size === all.length) next[org] = { all: true, branches: [] };
    else next[org] = { all: false, branches: [...set] };
    this.access = next;
  }
  protected togglePerm(p: string): void { if (this.perms.has(p)) this.perms.delete(p); else this.perms.add(p); }
  protected async save(): Promise<void> {
    const access: AccessRow[] = this.allAccess ? [] : Object.entries(this.access).flatMap(([org, a]) =>
      a.all ? [{ organizationId: org, branchId: null as string | null }] : a.branches.map((b) => ({ organizationId: org, branchId: b as string | null }))) as AccessRow[];
    const body = { nameEn: this.nameEn, nameAr: this.nameAr, allAccess: this.allAccess, scopeLevel: this.row()?.scopeLevel ?? null, permissions: [...this.perms], access };
    const ok = await this.run(() => (this.row() ? this.api.put('account-types/' + this.row()!.id, body) : this.api.post('account-types', body)), 'Permissions.savedType');
    if (ok) void this.router.navigateByUrl(this.base);
  }
  protected async remove(): Promise<void> {
    if (await this.run(() => this.api.del('account-types/' + this.row()!.id), 'AdminV2.deleted')) void this.router.navigateByUrl(this.base);
  }
}
