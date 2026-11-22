import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { adminError, generatePassword } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert } from '../../shared/ui';
import { PwEye } from '../../shared/pw-eye';
import { CLS, Msg } from '../admin/admin-pages';

interface POrg { id: string; name: string }
interface PBranch { id: string; organizationId: string; name: string }
interface PType { id: string; nameEn: string; nameAr: string; scopeLevel: string | null }
interface PRow { id: string; fullName: string; email: string; phone: string | null; status: string; roles: string[]; accountTypeId: string | null; organizationId: string | null; branchId: string | null }
interface PData { level: string | null; orgs: POrg[]; branches: PBranch[]; types: PType[]; people: PRow[] }

const BTN = 'min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg';

/**
 * Organization and Branch Admins manage the people inside their own scope. Two uses:
 * - the Staff page (People → Staff): add staff, the staff list, and the branch a team leader leads;
 * - mode "customer" inside Customers: only the "Add a customer" box (the customer list is the Customers table).
 */
@Component({
  selector: 'app-people',
  imports: [TPipe, FormsModule, Alert, PwEye],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="mode() === 'staff' ? 'mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8' : 'flex flex-col gap-6'">
      @if (mode() === 'staff') { <div><h1 class="text-3xl font-bold tracking-tight">{{ 'People.staffTitle' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'People.staffSubtitle' | t }}</p></div> }
      @if (d(); as d) {
        @if (d.orgs.length === 0) {
          <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-ink">{{ 'People.noScope' | t }}</p>
        } @else {
          <details class="rounded-xl border border-line bg-surface shadow-card">
            <summary class="cursor-pointer px-5 py-4 text-lg font-bold">{{ (mode() === 'staff' ? 'People.addStaff' : 'People.addCustomer') | t }}</summary>
            <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="create()">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="flex flex-col gap-1.5"><label for="pp-n" [class]="cls.label">{{ 'People.name' | t }}</label>
                  <input id="pp-n" name="fullName" dir="auto" autocomplete="off" [class]="cls.input" [ngModel]="n().fullName" (ngModelChange)="patch({ fullName: $event })" /></div>
                <div class="flex flex-col gap-1.5"><label for="pp-e" [class]="cls.label">{{ 'People.email' | t }}</label>
                  <input id="pp-e" name="email" type="email" dir="ltr" autocomplete="off" [class]="cls.input" [ngModel]="n().email" (ngModelChange)="patch({ email: $event })" /></div>
                <div class="flex flex-col gap-1.5"><label for="pp-p" [class]="cls.label">{{ 'People.phone' | t }}</label>
                  <input id="pp-p" name="phone" dir="ltr" placeholder="+20 10 1234 5678" autocomplete="off" [class]="cls.input" [ngModel]="n().phone" (ngModelChange)="patch({ phone: $event })" /></div>
                <div class="flex flex-col gap-1.5"><label for="pp-w" [class]="cls.label">{{ 'People.tempPassword' | t }}</label>
                  <span class="flex gap-2"><span class="relative min-w-0 flex-1"><input #ppw id="pp-w" name="password" type="password" dir="ltr" autocomplete="new-password" [class]="cls.input + ' w-full pe-11'" [ngModel]="n().password" (ngModelChange)="patch({ password: $event })" /><app-pw-eye [target]="ppw" /></span>
                    <button type="button" [class]="btn + ' shrink-0'" (click)="patch({ password: gen() })">{{ 'People.generate' | t }}</button></span></div>
                <div class="flex flex-col gap-1.5"><label for="pp-o" [class]="cls.label">{{ 'People.organization' | t }}</label>
                  <select id="pp-o" name="org" [class]="cls.input" [ngModel]="n().organizationId" (ngModelChange)="pickOrg($event)">
                    @for (o of d.orgs; track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                  </select></div>
                <div class="flex flex-col gap-1.5"><label for="pp-b" [class]="cls.label">{{ 'People.branch' | t }}</label>
                  <select id="pp-b" name="branch" [class]="cls.input" [ngModel]="n().branchId" (ngModelChange)="patch({ branchId: $event })">
                    @if (d.level !== 'branch') { <option value="">{{ 'People.noBranch' | t }}</option> }
                    @for (b of myBranches(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
                  </select></div>
                @if (n().kind === 'staff') {
                  <div class="flex flex-col gap-1.5"><label for="pp-t" [class]="cls.label">{{ 'People.accountType' | t }}</label>
                    <select id="pp-t" name="type" [class]="cls.input" [ngModel]="n().accountTypeId" (ngModelChange)="patch({ accountTypeId: $event })">
                      <option value="" disabled>{{ 'People.chooseType' | t }}</option>
                      @for (x of d.types; track x.id) { <option [value]="x.id">{{ typeName(x) }}</option> }
                    </select></div>
                }
              </div>
              @if (createMsg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
              <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'People.create' | t }}</button></div>
            </form>
          </details>
        }

        @if (mode() === 'staff') {
        <div class="flex flex-col gap-3">
          <div><label for="people-q" class="sr-only">{{ 'People.searchLabel' | t }}</label>
            <input id="people-q" type="search" dir="auto" [placeholder]="'People.searchPlaceholder' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base"
              [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
          @if (rows().length === 0) {
            <p class="text-muted">{{ (staffOnly().length ? 'People.noMatch' : 'People.emptyStaff') | t }}</p>
          } @else {
            <ul class="flex flex-col gap-4">
              @for (p of rows(); track p.id) {
                <li class="rounded-xl border border-line bg-surface shadow-card">
                  <button type="button" [attr.aria-expanded]="open() === p.id" (click)="toggle(p)" class="flex w-full cursor-pointer flex-col gap-0.5 p-4 text-start">
                    <span class="flex flex-wrap items-center gap-2">
                      <span class="text-lg font-bold" dir="auto">{{ p.fullName || '-' }}</span>
                      <span class="text-lg font-bold text-brand-ink">({{ roleNames(p) }})</span>
                      <span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="p.status === 'active' ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ 'Status.' + p.status | t }}</span>
                    </span>
                    <span class="text-sm text-muted"><span dir="ltr">{{ p.email }}</span> · <span dir="auto">{{ place(p) }}</span></span>
                  </button>
                  @if (open() === p.id) {
                    <div class="flex flex-col gap-4 border-t border-line p-4">
                      @if (p.status === 'active' || p.status === 'suspended') {
                        <div><button type="button" [class]="btn" [disabled]="busy()" (click)="setStatus(p)">{{ (p.status === 'suspended' ? 'People.reactivate' : 'People.suspend') | t }}</button></div>
                      }
                      @if (isLeader(p) && br()?.branches?.length) {
                        <form class="flex flex-wrap items-end gap-3" (ngSubmit)="setLeads(p)">
                          <div class="flex min-w-56 flex-col gap-1.5"><label [for]="'pl-' + p.id" [class]="cls.label">{{ 'People.leadsBranch' | t }}</label>
                            <select [id]="'pl-' + p.id" name="leads" [class]="cls.input" [(ngModel)]="ed.leads">
                              <option value="">{{ 'People.leadsNone' | t }}</option>
                              @for (b of br()!.branches; track b.id) { <option [value]="b.id">{{ b.name }}@if (b.teamLeaderId && b.teamLeaderId !== p.id) { ({{ 'People.leadNow' | t: { name: b.teamLeader } }}) }</option> }
                            </select>
                            <p class="text-xs text-muted">{{ 'People.leadsHint' | t }}</p></div>
                          <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'People.save' | t }}</button>
                        </form>
                      }
                      @if (isStaff(p)) {
                        <form class="flex flex-wrap items-end gap-3" (ngSubmit)="setType(p)">
                          <div class="flex min-w-56 flex-col gap-1.5"><label [for]="'pt-' + p.id" [class]="cls.label">{{ 'People.accountType' | t }}</label>
                            <select [id]="'pt-' + p.id" name="type" [class]="cls.input" [(ngModel)]="ed.type">
                              <option value="" disabled>{{ 'People.chooseType' | t }}</option>
                              @for (x of d.types; track x.id) { <option [value]="x.id">{{ typeName(x) }}</option> }
                            </select></div>
                          <button type="submit" [class]="cls.btn" [disabled]="busy() || !ed.type">{{ 'People.save' | t }}</button>
                        </form>
                      }
                      <details><summary class="cursor-pointer text-sm font-semibold text-brand-ink">{{ 'People.editDetails' | t }}</summary>
                        <form class="mt-3 flex flex-col gap-3" (ngSubmit)="update(p)">
                          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div class="flex flex-col gap-1.5"><label [for]="'pn-' + p.id" [class]="cls.label">{{ 'People.name' | t }}</label>
                              <input [id]="'pn-' + p.id" name="fullName" dir="auto" [class]="cls.input" [(ngModel)]="ed.fullName" /></div>
                            <div class="flex flex-col gap-1.5"><label [for]="'pe-' + p.id" [class]="cls.label">{{ 'People.email' | t }}</label>
                              <input [id]="'pe-' + p.id" name="email" type="email" dir="ltr" [class]="cls.input" [(ngModel)]="ed.email" /></div>
                            <div class="flex flex-col gap-1.5"><label [for]="'pp-' + p.id" [class]="cls.label">{{ 'People.phone' | t }}</label>
                              <input [id]="'pp-' + p.id" name="phone" dir="ltr" [class]="cls.input" [(ngModel)]="ed.phone" /></div>
                          </div>
                          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'People.save' | t }}</button></div>
                        </form>
                      </details>
                      @if (rowMsg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </div>
        }
      } @else if (loadError()) {
        <app-alert tone="error">{{ loadError() }}</app-alert>
      }
    </div>`,
})
export class PeoplePage {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  protected readonly btn = BTN;
  /** "staff": the Staff page; "customer": only the add box, inside the Customers page. */
  // Routed pages get every input from the address (withComponentInputBinding), and a missing one arrives as undefined: treat that as staff.
  readonly mode = input<'staff' | 'customer', 'staff' | 'customer' | undefined>('staff', { transform: (v) => v ?? 'staff' });
  readonly created = output<void>();
  protected readonly d = signal<PData | null>(null);
  protected readonly loadError = signal('');
  protected readonly busy = signal(false);
  protected readonly createMsg = signal<Msg>(null);
  protected readonly rowMsg = signal<Msg>(null);
  protected readonly q = signal('');
  protected readonly open = signal<string | null>(null);
  protected readonly n = signal({ kind: 'staff' as 'customer' | 'staff', fullName: '', email: '', phone: '', password: '', organizationId: '', branchId: '', accountTypeId: '' });
  protected ed = { fullName: '', email: '', phone: '', type: '', leads: '' };
  /** Branches in my scope, for "Leads branch" on team leaders (Staff page only). */
  protected readonly br = signal<{ branches: { id: string; name: string; teamLeaderId: string | null; teamLeader: string | null }[] } | null>(null);
  protected readonly staffOnly = computed(() => (this.d()?.people ?? []).filter((p) => this.isStaff(p)));

  protected readonly myBranches = computed(() => (this.d()?.branches ?? []).filter((b) => b.organizationId === this.n().organizationId));
  protected readonly rows = computed(() => {
    const needle = this.q().trim().toLowerCase();
    return this.staffOnly().filter((p) => !needle || `${p.fullName} ${p.email} ${p.phone ?? ''} ${this.place(p)} ${p.roles.join(' ')}`.toLowerCase().includes(needle));
  });

  constructor() { void this.load(true); }

  private async load(first = false): Promise<void> {
    try {
      const d = await firstValueFrom(this.http.get<PData>('/api/console/people'));
      this.d.set(d);
      if (first) this.resetNew(d);
      if (this.mode() === 'staff') this.br.set(await firstValueFrom(this.http.get<{ branches: { id: string; name: string; teamLeaderId: string | null; teamLeader: string | null }[] }>('/api/console/branches')).catch(() => null));
    } catch (e) { this.loadError.set(adminError(this.i18n, e)); }
  }
  private resetNew(d: PData): void {
    const org = d.orgs[0]?.id ?? '';
    this.n.set({ kind: this.mode() === 'staff' ? 'staff' : 'customer', fullName: '', email: '', phone: '', password: '', organizationId: org, branchId: this.firstBranch(d, org), accountTypeId: '' });
  }
  private firstBranch(d: PData, org: string): string { return d.level === 'branch' ? (d.branches.find((b) => b.organizationId === org)?.id ?? '') : ''; }
  protected patch(v: Partial<ReturnType<typeof this.n>>): void { this.n.update((x) => ({ ...x, ...v })); }
  protected pickOrg(org: string): void { this.patch({ organizationId: org, branchId: this.firstBranch(this.d()!, org) }); }
  protected gen(): string { return generatePassword(); }
  protected typeName(t: PType): string { return this.i18n.pick(t.nameEn, t.nameAr); }
  protected isStaff(p: PRow): boolean { return p.roles.some((r) => r !== 'customer'); }
  protected isLeader(p: PRow): boolean { return p.roles.includes('team_leader'); }
  protected roleNames(p: PRow): string { return p.roles.map((r) => this.i18n.t('Roles.' + r)).join(', '); }
  protected place(p: PRow): string {
    const d = this.d();
    const org = d?.orgs.find((o) => o.id === p.organizationId)?.name;
    const br = d?.branches.find((b) => b.id === p.branchId)?.name;
    const tp = d?.types.find((t) => t.id === p.accountTypeId);
    return [org, br, tp ? this.typeName(tp) : null].filter(Boolean).join(' · ');
  }
  protected toggle(p: PRow): void {
    this.rowMsg.set(null);
    if (this.open() === p.id) { this.open.set(null); return; }
    this.ed = { fullName: p.fullName, email: p.email, phone: p.phone ?? '', type: this.d()?.types.some((t) => t.id === p.accountTypeId) ? (p.accountTypeId ?? '') : '',
      leads: this.br()?.branches.find((b) => b.teamLeaderId === p.id)?.id ?? '' };
    this.open.set(p.id);
  }

  private async run(fn: () => Promise<unknown>, msg: typeof this.rowMsg): Promise<boolean> {
    this.busy.set(true); msg.set(null);
    try { await fn(); msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') }); await this.load(); return true; }
    catch (e) { msg.set({ tone: 'error', text: adminError(this.i18n, e) }); return false; }
    finally { this.busy.set(false); }
  }
  protected async create(): Promise<void> {
    const v = this.n();
    if (v.kind === 'staff' && !v.accountTypeId) { this.createMsg.set({ tone: 'error', text: this.i18n.t('AdminCommon.errors.typeRequired') }); return; }
    const body = { ...v, phone: v.phone || null, branchId: v.branchId || null, accountTypeId: v.kind === 'staff' ? v.accountTypeId : null };
    if (await this.run(() => firstValueFrom(this.http.post('/api/console/people', body)), this.createMsg)) { this.resetNew(this.d()!); this.created.emit(); }
  }
  protected setStatus(p: PRow): void {
    void this.run(() => firstValueFrom(this.http.post(`/api/console/people/${p.id}/status`, { status: p.status === 'suspended' ? 'active' : 'suspended' })), this.rowMsg);
  }
  /** Makes this team leader the leader of one branch (or of none): sets that branch, and clears the branch they led before. */
  protected setLeads(p: PRow): void {
    const now = this.br()?.branches.find((b) => b.teamLeaderId === p.id)?.id ?? '';
    const next = this.ed.leads;
    if (now === next) return;
    void this.run(async () => {
      if (now) await firstValueFrom(this.http.put(`/api/console/branches/${now}/leader`, { teamLeaderId: null }));
      if (next) await firstValueFrom(this.http.put(`/api/console/branches/${next}/leader`, { teamLeaderId: p.id }));
    }, this.rowMsg);
  }
  protected setType(p: PRow): void { void this.run(() => firstValueFrom(this.http.post(`/api/console/people/${p.id}/type`, { accountTypeId: this.ed.type })), this.rowMsg); }
  protected update(p: PRow): void {
    void this.run(() => firstValueFrom(this.http.put(`/api/console/people/${p.id}`, { fullName: this.ed.fullName, email: this.ed.email, phone: this.ed.phone || null })), this.rowMsg);
  }
}
