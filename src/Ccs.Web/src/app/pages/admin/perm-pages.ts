import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AccountTypeRow } from '../../core/admin-api';
import { TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { AdminBase } from './admin-pages';
import { KINDS, SetupGuide, permFits, permNeeded, scopeOfKind } from './staff-setup';

// Staff and Permissions, Plan B: this page only manages account types (WHAT people can do).
// Who has which type, and WHERE each person works, is set on the Staff page.

/** v1 lib/permissions/catalog.ts. "manage_users" is Administrator only and never stored, but counts in the total. */
export const PERMISSION_GROUPS = [
  { key: 'tickets', perms: ['reply', 'resolve', 'close', 'change_category', 'assign_self', 'assign_others', 'view_unassigned', 'view_others', 'all_teams'] },
  { key: 'reports', perms: ['reports_own', 'reports_all', 'export'] },
  { key: 'customers', perms: ['customers_view', 'customers_manage', 'approve_customers'] },
  { key: 'admin', perms: ['manage_kb', 'manage_catalog', 'manage_settings', 'manage_canned', 'reset_staff_passwords'] },
];
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms);
export const PERMISSION_TOTAL = ALL_PERMISSIONS.length + 1;

const KIND_TONE: Record<string, string> = {
  administrator: 'bg-ink text-white', organization_admin: 'bg-[#efe9fb] text-[#5b3fb0]', branch_admin: 'bg-[#e3f5f2] text-[#0b6f63]',
  team_leader: 'bg-brand-soft text-brand-ink', agent: 'bg-brand-soft text-brand-ink', viewer: 'bg-bg text-muted',
  office: 'bg-[#fdf1e3] text-[#8a4b0b]',
};

@Component({
  selector: 'app-admin-permissions',
  imports: [TPipe, Alert, RouterLink, SetupGuide, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Permissions.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'StaffSetup.perm.subtitle' | t }}</p></div>
        <a [routerLink]="base + '/types/new'" class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink sm:w-auto"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>{{ 'Permissions.addType' | t }}</a>
      </div>
      <app-setup-guide page="permissions" />
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <ng-template #card let-x>
        <li class="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <span class="self-start rounded-full px-2.5 py-0.5 text-xs font-bold" [class]="tone[x.kind] ?? tone['agent']">{{ 'StaffSetup.kinds.' + x.kind | t }}</span>
          <h3 class="text-lg font-bold"><span dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</span></h3>
          <p class="text-sm text-muted">{{ (x.defaultKey ? 'Permissions.defaultHint.' + x.defaultKey : 'StaffSetup.kindHint.' + x.kind) | t }}</p>
          <p class="text-sm">{{ x.isBuiltin ? ('Permissions.countAll' | t: { total: total }) : ('Permissions.count' | t: { n: x.permissions.length, total: total }) }}</p>
          @if (changed(x); as n) { <p class="text-xs font-semibold text-warn-ink">{{ 'Permissions.changedN' | t: { n: n } }}</p> }
          <div class="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
            <a [routerLink]="'/' + i18n.locale() + '/admin/users'" [queryParams]="{ type: x.id }" class="min-h-9 pt-1.5 text-sm font-semibold text-brand-ink underline">{{ 'StaffSetup.people' | t: { n: x.staff } }}</a>
            @if (x.isBuiltin) { <a [routerLink]="base + '/types/' + x.id" class="min-h-9 pt-1.5 text-sm text-muted underline">🔒 {{ 'Permissions.view' | t }}</a> }
            @else { <a [routerLink]="base + '/types/' + x.id" class="min-h-9 pt-1.5 text-sm font-semibold text-brand-ink underline">{{ 'Permissions.edit' | t }}<span class="sr-only"> {{ i18n.pick(x.nameEn, x.nameAr) }}</span></a> }
          </div>
        </li>
      </ng-template>
      <section aria-labelledby="pt-def" class="flex flex-col gap-3">
        <div><h2 id="pt-def" class="text-xl font-bold">{{ 'Permissions.defaultsTitle' | t }} <span class="text-sm font-normal text-muted">· {{ defaults().length + 1 }}</span></h2>
          <p class="text-sm text-muted">{{ 'Permissions.defaultsHelp' | t }}</p></div>
        <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (x of defaults(); track x.id) { <ng-container *ngTemplateOutlet="card; context: { $implicit: x }" /> }
          <li class="flex flex-col gap-2 rounded-xl border border-dashed border-line bg-surface p-4 shadow-card">
            <span class="self-start rounded-full bg-[#fff6db] px-2.5 py-0.5 text-xs font-bold text-[#7a5a00]">{{ 'Permissions.customerTitle' | t }}</span>
            <h3 class="text-lg font-bold">{{ 'Permissions.customerTitle' | t }}</h3>
            <p class="text-sm text-muted">{{ 'Permissions.customerHint' | t }}</p>
            <p class="text-sm">{{ 'Permissions.customerFixed' | t }}</p>
            <details class="text-sm"><summary class="min-h-9 cursor-pointer pt-1.5 font-semibold text-brand-ink">{{ 'Permissions.customerWhatTitle' | t }}</summary>
              <p class="text-muted">{{ 'Permissions.customerWhat' | t }}</p></details>
            <div class="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
              <a [routerLink]="'/' + i18n.locale() + '/console/customers'" class="min-h-9 pt-1.5 text-sm font-semibold text-brand-ink underline">{{ 'Permissions.customersN' | t: { n: customers() } }}</a>
              <span class="min-h-9 pt-1.5 text-sm text-muted">🔒 {{ 'Permissions.fixed' | t }}</span>
            </div>
          </li>
        </ul>
      </section>
      <section aria-labelledby="pt-custom" class="flex flex-col gap-3">
        <div><h2 id="pt-custom" class="text-xl font-bold">{{ 'Permissions.customTitle' | t }} <span class="text-sm font-normal text-muted">· {{ custom().length }}</span></h2>
          <p class="text-sm text-muted">{{ 'Permissions.customHelp' | t }}</p></div>
        <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (x of custom(); track x.id) { <ng-container *ngTemplateOutlet="card; context: { $implicit: x }" /> }
          <li><a [routerLink]="base + '/types/new'" class="grid h-full min-h-32 place-items-center rounded-xl border-2 border-dashed border-line p-4 font-semibold text-brand-ink hover:bg-surface">+ {{ 'Permissions.addType' | t }}</a></li>
        </ul>
      </section>
      <ul class="flex flex-col gap-1 text-sm text-muted"><li>{{ 'Permissions.noteEdit' | t }}</li><li>{{ 'Permissions.noteDelete' | t }}</li></ul>
    </main>`,
})
export class AdminPermissionsPage extends AdminBase implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly total = PERMISSION_TOTAL;
  protected readonly tone = KIND_TONE;
  protected readonly types = signal<AccountTypeRow[]>([]);
  protected readonly customers = signal(0);
  protected readonly defaults = computed(() => this.types().filter((x) => x.defaultKey));
  protected readonly custom = computed(() => this.types().filter((x) => !x.defaultKey));
  protected readonly changed = changedFromDefault;
  protected get base(): string { return '/' + this.i18n.locale() + '/admin/permissions'; }
  ngOnInit(): void {
    // The old Staff tab lives on the Staff page now; keep its links working.
    if (this.route.snapshot.queryParamMap.get('tab') === 'staff') {
      const type = this.route.snapshot.queryParamMap.get('type');
      void this.router.navigate(['/' + this.i18n.locale() + '/admin/users'], { queryParams: type ? { type } : {}, replaceUrl: true });
      return;
    }
    void this.reload();
  }
  protected async reload(): Promise<void> {
    try {
      const [types, c] = await Promise.all([this.api.get<AccountTypeRow[]>('account-types'), this.api.get<{ count: number }>('account-types/customers')]);
      this.types.set(types); this.customers.set(c.count);
    } catch (e) { this.fail(e); }
  }
}

/** How many permissions a default type has changed from its default (0 for custom types and the Administrator). */
export function changedFromDefault(x: AccountTypeRow): number {
  if (!x.defaultPermissions || x.isBuiltin) return 0;
  const now = new Set(x.permissions), def = new Set(x.defaultPermissions);
  return [...now].filter((p) => !def.has(p)).length + [...def].filter((p) => !now.has(p)).length;
}

/** One account type: 1 name, 2 kind, 3 permissions. The built-in Administrator opens read only. */
@Component({
  selector: 'app-admin-type',
  imports: [TPipe, Alert, FormsModule, RouterLink, Req, ReqNote],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div>
        <a [routerLink]="base" class="text-sm font-semibold text-brand-ink underline">← {{ 'Permissions.backToTypes' | t }}</a>
        <h1 class="mt-2 text-3xl font-bold tracking-tight">
          {{ row() ? i18n.pick(row()!.nameEn, row()!.nameAr) : ('Permissions.addType' | t) }}
          @if (locked()) { <span class="ms-3 rounded-md bg-brand-soft px-2 py-1 align-middle text-sm font-semibold text-brand-ink">{{ 'Permissions.builtinLocked' | t }}</span> }
          @else if (isDefault()) { <span class="ms-3 rounded-md bg-brand-soft px-2 py-1 align-middle text-sm font-semibold text-brand-ink">{{ 'Permissions.defaultBadge' | t }}</span> }
        </h1>
      </div>
      @if (ready()) {
        <form class="flex flex-col gap-6" novalidate (ngSubmit)="save()">
          @if (locked()) { <div role="note" class="rounded-xl border border-brand/30 bg-brand-soft px-5 py-4 text-brand-ink">{{ 'Permissions.lockedNote' | t }}</div> }
          @else if (isDefault()) { <div role="note" class="rounded-xl border border-brand/30 bg-brand-soft px-5 py-4 text-brand-ink">{{ 'Permissions.defaultNote' | t }}
            @if (changedCount(); as n) { {{ 'Permissions.changedN' | t: { n: n } }}. } @else { {{ 'Permissions.sameAsDefault' | t }} }</div> }
          @if (!row()) {
            <section aria-labelledby="st-from" [class]="card">
              <h2 id="st-from" class="text-xl font-bold">{{ 'Permissions.startFrom' | t }}</h2>
              <p class="text-sm text-muted">{{ 'Permissions.startFromHelp' | t }}</p>
              <select name="from" [class]="cls.input + ' max-w-md'" [ngModel]="from" (ngModelChange)="startFrom($event)" aria-labelledby="st-from">
                <option value="">{{ 'Permissions.startBlank' | t }}</option>
                @for (d of starters(); track d.id) { <option [value]="d.defaultKey">{{ i18n.pick(d.nameEn, d.nameAr) }}</option> }
              </select>
            </section>
          }
          <section aria-labelledby="st-name" [class]="card">
            <h2 id="st-name" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">1</span>{{ 'Permissions.stepName' | t }}</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Permissions.nameEn' | t }}<app-req /></span>
                <input name="en" dir="ltr" maxlength="80" [disabled]="locked() || isDefault()" [class]="cls.input + ' font-normal'" [(ngModel)]="nameEn" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'Permissions.nameAr' | t }}<app-req /></span>
                <input name="ar" dir="rtl" maxlength="80" [disabled]="locked() || isDefault()" [class]="cls.input + ' font-normal'" [(ngModel)]="nameAr" /></label>
            </div>
          </section>
          @if (!locked() && !isDefault()) {
            <section aria-labelledby="st-kind" [class]="card">
              <h2 id="st-kind" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">2</span>{{ 'StaffSetup.perm.kind' | t }}<app-req /></h2>
              <p class="text-sm text-muted">{{ 'StaffSetup.perm.kindHelp' | t }}</p>
              <fieldset class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend class="sr-only">{{ 'StaffSetup.perm.kind' | t }}</legend>
                @for (k of kinds; track k) {
                  <label class="flex cursor-pointer flex-col gap-1 rounded-xl border-2 border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand">
                    <span class="flex items-center gap-2 font-bold"><input type="radio" name="kind" class="size-5" [value]="k" [checked]="kind() === k" [disabled]="kindBlocked(k)" (change)="setKind(k)" />{{ 'StaffSetup.kinds.' + k | t }}</span>
                    <span class="text-sm text-muted">{{ 'StaffSetup.kindHint.' + k | t }}</span>
                  </label>
                }
              </fieldset>
              @if (row() && row()!.staff > 0) { <p class="text-sm text-muted">{{ 'StaffSetup.perm.kindLocked' | t }}</p> }
              @if (scopeOfKind(kind())) { <p class="text-sm text-muted">{{ 'StaffSetup.perm.adminWhere' | t }}</p> }
            </section>
          }
          <section aria-labelledby="st-perms" [class]="card">
            <h2 id="st-perms" class="flex items-center gap-3 text-xl font-bold"><span aria-hidden="true" [class]="step">{{ locked() || isDefault() ? 2 : 3 }}</span>{{ 'StaffSetup.perm.what' | t }}</h2>
            <p class="text-sm text-muted">{{ (locked() ? 'Permissions.permsLockedHelp' : 'StaffSetup.perm.greyed') | t }}</p>
            <label class="flex min-h-11 items-center gap-2 rounded-lg bg-bg px-3 text-muted"><input type="checkbox" class="h-5 w-5" checked disabled />{{ 'Permissions.viewAlways' | t }}</label>
            <fieldset [disabled]="locked()" class="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              <legend class="sr-only">{{ 'StaffSetup.perm.what' | t }}</legend>
              @for (g of groups; track g.key) {
                <div class="flex flex-col">
                  <h3 class="pb-1 text-lg font-bold">{{ 'Permissions.groups.' + g.key | t }}</h3>
                  @for (p of g.perms; track p) {
                    <label class="flex min-h-11 items-center gap-2" [class.text-muted]="!locked() && (!fits(p) || needed(p))">
                      <input type="checkbox" class="h-5 w-5" [checked]="perms.has(p)" [disabled]="!locked() && (!fits(p) || needed(p))" (change)="togglePerm(p)" />{{ 'Permissions.perm.' + p | t }}
                      @if (!locked() && needed(p)) { <span class="text-xs">({{ 'StaffSetup.perm.needed' | t }})</span> }
                      @if (isDefault() && !locked() && perms.has(p) !== defaultHas(p)) { <span class="text-xs font-semibold text-warn-ink">{{ 'Permissions.changedMark' | t }}</span> }
                    </label>
                  }
                  @if (g.key === 'admin') {
                    <label class="flex min-h-11 items-center gap-2 text-muted"><input type="checkbox" class="h-5 w-5" [checked]="locked()" disabled />{{ 'Permissions.perm.manage_users' | t }} <span class="text-sm">({{ 'Permissions.adminOnly' | t }})</span></label>
                  }
                </div>
              }
            </fieldset>
            <p role="status" class="font-semibold text-brand-ink">{{ locked() ? ('Permissions.countAll' | t: { total: total }) : ('Permissions.count' | t: { n: perms.size, total: total }) }}</p>
          </section>
          @if (!locked()) {
            <p class="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand-ink">{{ 'StaffSetup.perm.noPlaces' | t }}@if (row() && row()!.staff > 0) { {{ 'StaffSetup.perm.changes' | t: { n: row()!.staff } }} }</p>
          }
          <div class="flex flex-wrap items-center gap-3">
            @if (!locked()) { <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Permissions.saveType' | t }}</button><app-req-note /> }
            <a [routerLink]="base" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ (locked() ? 'Permissions.backToTypes' : 'Permissions.cancel') | t }}</a>
            @if (isDefault() && !locked()) {
              @if (resetAsk()) {
                <span class="text-sm font-semibold">{{ 'Permissions.resetConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-brand px-4 font-semibold text-white" (click)="reset()">{{ 'Permissions.resetYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold" (click)="resetAsk.set(false)">{{ 'Directory.cancel' | t }}</button>
              } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg disabled:opacity-60" [disabled]="!changedCount()" (click)="resetAsk.set(true)">{{ 'Permissions.reset' | t }}</button> }
            }
            @if (!locked() && row() && !isDefault()) {
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
  protected readonly kinds = KINDS;
  protected readonly scopeOfKind = scopeOfKind;
  protected readonly row = signal<AccountTypeRow | null>(null);
  protected readonly ready = signal(false);
  protected readonly asking = signal(false);
  protected readonly locked = computed(() => !!this.row()?.isBuiltin);
  protected readonly isDefault = computed(() => !!this.row()?.defaultKey);
  protected readonly resetAsk = signal(false);
  protected readonly starters = signal<AccountTypeRow[]>([]);
  protected from = '';
  /** How many permissions differ from the default right now (changes as boxes are ticked). */
  protected changedCount(): number { const r = this.row(); return r ? changedFromDefault({ ...r, permissions: [...this.perms] }) : 0; }
  protected defaultHas(p: string): boolean { return !!this.row()?.defaultPermissions?.includes(p); }
  protected readonly kind = signal<string>('agent');
  protected nameEn = '';
  protected nameAr = '';
  protected perms = new Set<string>(['reply', 'resolve', 'assign_self', 'view_unassigned', 'customers_view', 'reports_own']);
  protected get base(): string { return '/' + this.i18n.locale() + '/admin/permissions'; }
  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    if (this.id() === 'new') {
      try { this.starters.set((await this.api.get<AccountTypeRow[]>('account-types')).filter((x) => x.defaultKey && !x.isBuiltin)); } catch { /* the form still works without it */ }
      this.ready.set(true); return;
    }
    try {
      const t = (await this.api.get<AccountTypeRow[]>('account-types')).find((x) => x.id === this.id());
      if (!t) { void this.router.navigateByUrl(this.base); return; }
      this.row.set(t);
      this.nameEn = t.nameEn; this.nameAr = t.nameAr;
      this.kind.set(t.kind);
      this.perms = new Set(t.isBuiltin ? ALL_PERMISSIONS : t.permissions);
      this.ready.set(true);
    } catch (e) { this.fail(e); }
  }
  protected fits(p: string): boolean { return permFits(this.kind(), p); }
  protected needed(p: string): boolean { return permNeeded(this.kind(), p); }
  /** A type in use cannot move to or from Organization / Branch Admin (that would change where its people work). */
  protected kindBlocked(k: string): boolean {
    const r = this.row();
    return !!r && r.staff > 0 && k !== r.kind && (!!scopeOfKind(k) || !!scopeOfKind(r.kind));
  }
  protected setKind(k: string): void {
    this.kind.set(k);
    const next = new Set([...this.perms].filter((p) => permFits(k, p)));
    for (const p of ALL_PERMISSIONS) if (permNeeded(k, p)) next.add(p);
    this.perms = next;
  }
  /** "Start from a default type": its kind and its default permissions; the name stays the admin's to write. */
  protected startFrom(key: string): void {
    this.from = key;
    const d = this.starters().find((x) => x.defaultKey === key);
    if (!d) return;
    this.kind.set(d.kind);
    this.perms = new Set(d.defaultPermissions ?? d.permissions);
  }
  protected async reset(): Promise<void> {
    this.resetAsk.set(false);
    if (await this.run(() => this.api.post('account-types/' + this.row()!.id + '/reset', {}), 'Permissions.resetDone')) await this.reload();
  }
  protected togglePerm(p: string): void { if (this.perms.has(p)) this.perms.delete(p); else this.perms.add(p); }
  protected async save(): Promise<void> {
    const body = { nameEn: this.nameEn, nameAr: this.nameAr, allAccess: true, scopeLevel: null, permissions: [...this.perms], access: [], kind: this.kind() };
    const ok = await this.run(() => (this.row() ? this.api.put('account-types/' + this.row()!.id, body) : this.api.post('account-types', body)), 'Permissions.savedType');
    if (ok) void this.router.navigateByUrl(this.base);
  }
  protected async remove(): Promise<void> {
    if (await this.run(() => this.api.del('account-types/' + this.row()!.id), 'AdminV2.deleted')) void this.router.navigateByUrl(this.base);
  }
}
