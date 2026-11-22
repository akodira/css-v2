import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { feedbackFor } from '../../shared/feedback';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { CLS, Msg } from '../admin/admin-pages';

interface BOrg { id: string; name: string; canAdd: boolean }
interface BRow {
  id: string; organizationId: string; name: string; location: string | null; phone: string | null; isActive: boolean;
  teamLeaderId: string | null; teamLeader: string | null; customers: number; staff: number; canDelete: boolean;
}
interface BData { level: string | null; canAdd: boolean; orgs: BOrg[]; leaders: { id: string; fullName: string }[]; branches: BRow[] }
interface BModel { organizationId: string; name: string; location: string; phone: string; teamLeaderId: string; isActive: boolean }

/**
 * People → Branches. Organization admins add, edit, deactivate and delete the branches of their organizations;
 * branch admins edit everything about their own branch. The team leader is picked from team leaders in the same scope.
 */
@Component({
  selector: 'app-branches',
  imports: [TPipe, FormsModule, NgTemplateOutlet, Alert, Req, ReqNote],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Branches.title' | t }}</h1>
          <p class="mt-1 max-w-prose text-muted">{{ (d()?.canAdd ? 'Branches.subtitleOrg' : 'Branches.subtitleBranch') | t }}</p></div>
        @if (d()?.canAdd && editing() !== 'new') { <button type="button" [class]="cls.btn" (click)="startNew()">{{ 'Branches.add' | t }}</button> }
      </div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      <ng-template #formTpl>
        <form class="flex flex-col gap-4 rounded-xl border border-brand bg-surface p-5 shadow-card" novalidate (ngSubmit)="save()">
          <h2 class="text-lg font-bold">{{ (editing() === 'new' ? 'Branches.addTitle' : 'Branches.editTitle') | t }}</h2>
          <div class="grid gap-4 md:grid-cols-2">
            @if (orgChoices().length > 1) {
              <div class="flex flex-col gap-1.5"><label for="br-org" [class]="cls.label">{{ 'Branches.organization' | t }}<app-req /></label>
                <select id="br-org" name="org" [class]="cls.input" [(ngModel)]="m.organizationId">
                  @for (o of orgChoices(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                </select></div>
            }
            <div class="flex flex-col gap-1.5"><label for="br-name" [class]="cls.label">{{ 'Branches.name' | t }}<app-req /></label>
              <input id="br-name" name="name" maxlength="120" dir="auto" autocomplete="off" [class]="cls.input" [(ngModel)]="m.name" /></div>
            <div class="flex flex-col gap-1.5"><label for="br-loc" [class]="cls.label">{{ 'Branches.location' | t }}</label>
              <input id="br-loc" name="location" maxlength="300" dir="auto" autocomplete="off" [class]="cls.input" [(ngModel)]="m.location" /></div>
            <div class="flex flex-col gap-1.5"><label for="br-phone" [class]="cls.label">{{ 'Branches.phone' | t }}</label>
              <input id="br-phone" name="phone" maxlength="40" dir="ltr" autocomplete="off" placeholder="+20 2 0000 0000" [class]="cls.input" [(ngModel)]="m.phone" /></div>
            <div class="flex flex-col gap-1.5"><label for="br-lead" [class]="cls.label">{{ 'Branches.teamLeader' | t }}</label>
              <select id="br-lead" name="lead" [class]="cls.input" [(ngModel)]="m.teamLeaderId">
                <option value="">{{ 'Branches.noLeader' | t }}</option>
                @for (l of d()?.leaders ?? []; track l.id) { <option [value]="l.id">{{ l.fullName }}</option> }
              </select>
              <p class="text-xs text-muted">{{ 'Branches.teamLeaderHint' | t }}</p></div>
            <div class="flex flex-col gap-1.5"><label for="br-st" [class]="cls.label">{{ 'Branches.status' | t }}</label>
              <select id="br-st" name="active" [class]="cls.input" [(ngModel)]="m.isActive">
                <option [ngValue]="true">{{ 'Branches.active' | t }}</option><option [ngValue]="false">{{ 'Branches.inactive' | t }}</option>
              </select>
              <p class="text-xs text-muted">{{ 'Branches.inactiveHint' | t }}</p></div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (editing() === 'new' ? 'Branches.add' : 'AdminCommon.save') | t }}</button>
            <button type="button" [class]="cls.btn2" (click)="editing.set(null)">{{ 'Branches.cancel' | t }}</button>
            <app-req-note />
          </div>
        </form>
      </ng-template>

      @if (editing() === 'new') { <ng-container *ngTemplateOutlet="formTpl" /> }

      @if (d(); as d) {
        @if (!d.branches.length) { <p role="status" class="rounded-md border border-line bg-surface p-6 text-muted">{{ 'Branches.empty' | t }}</p> }
        @else {
          <div class="overflow-x-auto rounded-md border border-line bg-surface">
            <table class="w-full min-w-[52rem] text-start text-sm">
              <caption class="sr-only">{{ 'Branches.title' | t }}</caption>
              <thead class="bg-chrome text-white"><tr>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.name' | t }}</th>
                @if (d.orgs.length > 1) { <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.organization' | t }}</th> }
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.location' | t }}</th>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.phone' | t }}</th>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.teamLeader' | t }}</th>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.customers' | t }}</th>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.staff' | t }}</th>
                <th scope="col" class="px-4 py-3 text-start font-semibold">{{ 'Branches.status' | t }}</th>
                <th scope="col" class="px-4 py-3"><span class="sr-only">{{ 'Branches.actions' | t }}</span></th>
              </tr></thead>
              <tbody>
                @for (b of d.branches; track b.id) {
                  <tr class="border-t border-line align-top">
                    <td class="px-4 py-3 font-semibold" dir="auto">{{ b.name }}</td>
                    @if (d.orgs.length > 1) { <td class="px-4 py-3" dir="auto">{{ orgName(b.organizationId) }}</td> }
                    <td class="px-4 py-3" dir="auto">{{ b.location || '-' }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ b.phone || '-' }}</td>
                    <td class="px-4 py-3" dir="auto">{{ b.teamLeader || '-' }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ b.customers }}</td>
                    <td class="px-4 py-3" dir="ltr">{{ b.staff }}</td>
                    <td class="px-4 py-3"><span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="b.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (b.isActive ? 'Branches.active' : 'Branches.inactive') | t }}</span></td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap items-center justify-end gap-1">
                        <button type="button" [class]="row.btn" (click)="startEdit(b)"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>{{ 'Branches.edit' | t }}</button>
                        @if (b.canDelete && !b.customers && !b.staff) {
                          @if (asking() === b.id) {
                            <span class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">{{ 'Branches.confirmDelete' | t }}</span>
                              <button type="button" [class]="row.danger" [disabled]="busy()" (click)="remove(b)">{{ 'Branches.delete' | t }}</button>
                              <button type="button" [class]="row.btn" (click)="asking.set(null)">{{ 'Branches.cancel' | t }}</button></span>
                          } @else { <button type="button" [class]="row.danger" (click)="asking.set(b.id)"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>{{ 'Branches.delete' | t }}</button> }
                        }
                      </div>
                    </td>
                  </tr>
                  @if (editing() === b.id) { <tr><td [attr.colspan]="d.orgs.length > 1 ? 9 : 8" class="bg-bg p-3"><ng-container *ngTemplateOutlet="formTpl" /></td></tr> }
                }
              </tbody>
            </table>
          </div>
          @if (d.canAdd) { <p class="text-sm text-muted">{{ 'Branches.deleteNote' | t }}</p> }
        }
      } @else if (loadError()) { <app-alert tone="error">{{ loadError() }}</app-alert> }
    </main>`,
})
export class BranchesPage {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  /** Small text buttons inside table rows (the full-size buttons are for forms). */
  protected readonly row = {
    btn: 'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-brand-ink hover:bg-brand-soft disabled:opacity-60',
    danger: 'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-60',
  };
  protected readonly d = signal<BData | null>(null);
  protected readonly loadError = signal('');
  protected readonly msg = signal<Msg>(null);
  protected readonly msgNearButton = feedbackFor(this.msg);
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly asking = signal<string | null>(null);
  protected m: BModel = this.blank();
  /** New branch: only organizations where I may add; editing: mine, or any where I may move it. */
  protected readonly orgChoices = computed(() => (this.d()?.orgs ?? []).filter((o) => o.canAdd || o.id === this.m.organizationId));

  constructor() { void this.load(); }
  private async load(): Promise<void> {
    try { this.d.set(await firstValueFrom(this.http.get<BData>('/api/console/branches'))); }
    catch (e) { this.loadError.set(adminError(this.i18n, e)); }
  }
  private blank(): BModel {
    const org = this.d()?.orgs.find((o) => o.canAdd)?.id ?? '';
    return { organizationId: org, name: '', location: '', phone: '', teamLeaderId: '', isActive: true };
  }
  protected orgName(id: string): string { return this.d()?.orgs.find((o) => o.id === id)?.name ?? '-'; }
  protected startNew(): void { this.m = this.blank(); this.msg.set(null); this.editing.set('new'); }
  protected startEdit(b: BRow): void {
    this.m = { organizationId: b.organizationId, name: b.name, location: b.location ?? '', phone: b.phone ?? '', teamLeaderId: b.teamLeaderId ?? '', isActive: b.isActive };
    this.msg.set(null); this.asking.set(null); this.editing.set(b.id);
  }
  private async run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try { await fn(); this.msg.set({ tone: 'success', text: this.i18n.t(ok) }); this.editing.set(null); this.asking.set(null); await this.load(); }
    catch (e) {
      const code = (e as { error?: { code?: string } }).error?.code ?? '';
      this.msg.set({ tone: 'error', text: this.i18n.has('Branches.errors.' + code) ? this.i18n.t('Branches.errors.' + code) : adminError(this.i18n, e) });
    } finally { this.busy.set(false); }
  }
  protected save(): void {
    const id = this.editing();
    const body = { ...this.m, teamLeaderId: this.m.teamLeaderId || null, location: this.m.location || null, phone: this.m.phone || null };
    void this.run(() => firstValueFrom(id === 'new' ? this.http.post('/api/console/branches', body) : this.http.put('/api/console/branches/' + id, body)),
      id === 'new' ? 'Branches.added' : 'AdminCommon.saved');
  }
  protected remove(b: BRow): void { void this.run(() => firstValueFrom(this.http.delete('/api/console/branches/' + b.id)), 'Branches.deleted'); }
}
