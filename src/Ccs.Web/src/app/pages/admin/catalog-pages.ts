import { PageAbout } from '../../shared/page-about';
import { RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TPipe } from '../../core/i18n';
import { Alert, PRIORITY_TONE, PrioIcon, Req, ReqNote } from '../../shared/ui';
import { AdminBase, HEADER, SEARCH } from './admin-pages';

// ---- contracts (CatalogAdminController) --------------------------------------------------------

interface TeamOpt { id: string; nameEn: string; nameAr: string; isActive: boolean }
interface PrioOpt { code: string; nameEn: string; nameAr: string; color: string; icon?: string; isActive: boolean }
interface TypeRow { id: string; code: string | null; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; sortOrder: number; isActive: boolean; categoryIds: string[]; tickets: number }
interface SubRow { id: string; categoryId: string; nameEn: string; nameAr: string; isActive: boolean; sortOrder: number; priorityCode: string | null; tickets: number }
interface CatRow { id: string; nameEn: string; nameAr: string; defaultTeamId: string | null; isActive: boolean; sortOrder: number; priorityCode: string | null; isPrivate: boolean; autoAssign: boolean; typeIds: string[]; tickets: number; subcategories: SubRow[] }
interface FieldRow { id: string; key: string; labelEn: string; labelAr: string; type: string; options: string; isRequired: boolean; validation: string; visibleToCustomer: boolean; categoryId: string | null; isActive: boolean; sortOrder: number; hasValues: boolean }
interface CatalogData { types: TypeRow[]; categories: CatRow[]; fields: FieldRow[]; teams: TeamOpt[]; priorities: PrioOpt[] }

interface PrioRow { code: string; nameEn: string; nameAr: string; color: string; icon: string; sortOrder: number; isActive: boolean; firstResponseMinutes: number | null; resolutionMinutes: number | null; usedBy: number; tickets: number; isDefault: boolean }
interface SlaRow { priority: string; nameEn: string; nameAr: string; color: string; icon?: string; isActive: boolean; firstResponseMinutes: number; resolutionMinutes: number; warningThresholdPct: number; pauseOnPendingCustomer: boolean; pauseOnPendingInternal: boolean; businessHoursId: string | null; warnNotify: string[]; breachNotify: string[]; hasPolicy: boolean }
interface HoursRow { id: string; name: string; timezone: string; isDefault: boolean; schedule: Record<string, string[][]>; holidays: { id: string; date: string; name: string }[] }

const PRIO_DOT: Record<string, string> = { red: 'bg-danger', amber: 'bg-amber-500', blue: 'bg-brand', green: 'bg-ok', grey: 'bg-slate-500', light: 'bg-slate-300' };
const CHECK = 'flex min-h-11 items-center gap-2';

// ================================================================== ticket types

type TypeModel = Omit<TypeRow, 'id' | 'tickets'>;
const blankType = (): TypeModel => ({ code: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', examplesEn: '', examplesAr: '', sortOrder: 0, isActive: true, categoryIds: [] });

@Component({
  selector: 'app-admin-ticket-types',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <p class="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand-ink">{{ 'AdminTicketTypes.rules' | t }}</p>
      <ng-template #form let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'Directory.nameEn' | t }}<app-req /></span></label>
            <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'Directory.nameAr' | t }}<app-req /></span></label>
            <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'de'" [class]="cls.label">{{ 'AdminTicketTypes.descEn' | t }}</label>
            <textarea [id]="id + 'de'" [name]="id + 'de'" rows="2" dir="ltr" maxlength="1000" [class]="cls.input + ' py-2'" [(ngModel)]="m.descriptionEn"></textarea></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'da'" [class]="cls.label">{{ 'AdminTicketTypes.descAr' | t }}</label>
            <textarea [id]="id + 'da'" [name]="id + 'da'" rows="2" dir="rtl" maxlength="1000" [class]="cls.input + ' py-2'" [(ngModel)]="m.descriptionAr"></textarea></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'xe'" [class]="cls.label">{{ 'AdminTicketTypes.examplesEn' | t }}</label>
            <input [id]="id + 'xe'" [name]="id + 'xe'" dir="ltr" maxlength="1000" [class]="cls.input" [(ngModel)]="m.examplesEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'xa'" [class]="cls.label">{{ 'AdminTicketTypes.examplesAr' | t }}</label>
            <input [id]="id + 'xa'" [name]="id + 'xa'" dir="rtl" maxlength="1000" [class]="cls.input" [(ngModel)]="m.examplesAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'cd'" [class]="cls.label">{{ 'AdminTicketTypes.code' | t }}</label>
            <input [id]="id + 'cd'" [name]="id + 'cd'" dir="ltr" maxlength="4" autocomplete="off" pattern="[A-Za-z]{2,4}" [class]="cls.input + ' font-mono uppercase'" [(ngModel)]="m.code" />
            <p class="text-xs text-muted">{{ 'AdminTicketTypes.codeHint' | t }}</p></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminTicketTypes.colOrder' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          <label [class]="'${CHECK} self-end'"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminTicketTypes.showToCustomers' | t }}</label>
        </div>
        <fieldset class="mt-4">
          <legend [class]="cls.label">{{ 'AdminTicketTypes.availableCategories' | t }}</legend>
          <p class="text-sm text-muted">{{ 'AdminTicketTypes.availableHint' | t }}</p>
          <div class="mt-2 grid gap-x-6 md:grid-cols-3">
            @for (c of data()?.categories ?? []; track c.id) {
              <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="m.categoryIds.includes(c.id)" (change)="toggle(m.categoryIds, c.id)" /> <span dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span></label>
            }
          </div>
        </fieldset>
      </ng-template>

      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminTicketTypes.add' | t }}</span></summary>
        <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="create(add)">
          <ng-container *ngTemplateOutlet="form; context: { m: nw, id: 'tn' }" />
          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
        </form>
      </details>

      <ul class="flex flex-col gap-4">
        @for (t of data()?.types ?? []; track t.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
                @if (t.code) { <span class="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-sm font-bold text-brand-ink" dir="ltr">{{ t.code }}</span> }
                <span [class]="t.isActive ? cls.badgeOn : cls.badgeOff">{{ (t.isActive ? 'AdminTicketTypes.visible' : 'AdminTicketTypes.hidden') | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminTicketTypes.linked' | t: { n: t.categoryIds.length } }} · {{ 'AdminTicketTypes.colTickets' | t }}: {{ t.tickets }}</span>
            </summary>
            <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="update(t)">
              <ng-container *ngTemplateOutlet="form; context: { m: edit[t.id], id: 't' + t.id }" />
              <div class="flex flex-wrap items-center gap-2">
                <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                @if (!t.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('ticket-types/' + t.id)">{{ 'Directory.delete' | t }}</button> }
              </div>
              <p class="text-sm text-muted">{{ 'AdminTicketTypes.deleteHint' | t }}</p>
            </form>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminTicketTypesPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminTicketTypes.title';
  protected readonly subtitle = 'AdminTicketTypes.subtitle';
  protected readonly data = signal<CatalogData | null>(null);
  protected nw: TypeModel = blankType();
  protected edit: Record<string, TypeModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<CatalogData>('catalog');
      for (const t of d.types) this.edit[t.id] = { ...t, categoryIds: [...t.categoryIds] };
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected toggle(list: string[], id: string): void { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); }
  protected async create(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('ticket-types', this.nw))) { this.nw = blankType(); box.open = false; }
  }
  protected update(t: TypeRow): void { void this.run(() => this.api.put('ticket-types/' + t.id, this.edit[t.id])); }
  protected remove(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}

// ================================================================== categories, subcategories and custom fields

type CatModel = Omit<CatRow, 'id' | 'tickets' | 'subcategories'>;
type SubModel = Omit<SubRow, 'id' | 'tickets'>;
interface FieldModel {
  key: string; labelEn: string; labelAr: string; type: string; optionsText: string; isRequired: boolean; visibleToCustomer: boolean;
  categoryId: string | null; isActive: boolean; sortOrder: number; min: number | null; max: number | null; minLength: number | null; maxLength: number | null; pattern: string;
}
const blankCat = (): CatModel => ({ nameEn: '', nameAr: '', defaultTeamId: null, isActive: true, sortOrder: 0, priorityCode: null, isPrivate: false, autoAssign: true, typeIds: [] });
const blankSub = (categoryId: string): SubModel => ({ categoryId, nameEn: '', nameAr: '', isActive: true, sortOrder: 0, priorityCode: null });
const blankField = (): FieldModel => ({ key: '', labelEn: '', labelAr: '', type: 'text', optionsText: '', isRequired: false, visibleToCustomer: true, categoryId: null, isActive: true, sortOrder: 0, min: null, max: null, minLength: null, maxLength: null, pattern: '' });

@Component({
  selector: 'app-admin-catalog',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet, RouterLink, PrioIcon],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminCatalog.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminCatalog.subtitle' | t }}</p></div>
      @if (msg(); as m) { @if (!(msgAt() && m.tone === 'error')) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> } }

      <!-- shared form parts -->
      <ng-template #names let-m="m" let-id="id">
        <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'AdminCatalog.nameEn' | t }}<app-req /></span></label>
          <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'AdminCatalog.nameAr' | t }}<app-req /></span></label>
          <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
      </ng-template>
      <ng-template #catForm let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <ng-container *ngTemplateOutlet="names; context: { m, id }" />
          <div class="flex flex-col gap-1.5"><label [for]="id + 'tm'" [class]="cls.label">{{ 'AdminCatalog.defaultTeam' | t }}</label>
            <select [id]="id + 'tm'" [name]="id + 'tm'" [class]="cls.input" [(ngModel)]="m.defaultTeamId">
              <option [ngValue]="null">{{ 'AdminCatalog.noTeam' | t }}</option>
              @for (x of data()?.teams ?? []; track x.id) { <option [ngValue]="x.id">{{ i18n.pick(x.nameEn, x.nameAr) }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'pr'" [class]="cls.label">{{ 'AdminCatalog.fixedPriority' | t }}</label>
            <select [id]="id + 'pr'" [name]="id + 'pr'" [class]="cls.input" [(ngModel)]="m.priorityCode">
              <option [ngValue]="null">{{ 'AdminCatalog.noFixedPriority' | t }}</option>
              @for (p of data()?.priorities ?? []; track p.code) { <option [ngValue]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
            </select>
            <p class="text-sm text-muted">{{ 'AdminCatalog.fixedPriorityHint' | t }}</p></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          <div class="flex flex-col">
            <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminCatalog.active' | t }}</label>
            <label class="${CHECK}"><input type="checkbox" [name]="id + 'pv'" class="h-5 w-5" [(ngModel)]="m.isPrivate" /> {{ 'AdminCatalog.isPrivate' | t }}</label>
            <label class="${CHECK}"><input type="checkbox" [name]="id + 'aa'" class="h-5 w-5" [(ngModel)]="m.autoAssign" /> {{ 'AdminCatalog.autoAssign' | t }}</label>
          </div>
        </div>
        <p class="mt-2 text-sm text-muted">{{ 'AdminCatalog.isPrivateHint' | t }}</p><p class="text-sm text-muted">{{ 'AdminCatalog.autoAssignHint' | t }}</p>
      </ng-template>
      <ng-template #subForm let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <ng-container *ngTemplateOutlet="names; context: { m, id }" />
          <div class="flex flex-col gap-1.5"><label [for]="id + 'pr'" [class]="cls.label">{{ 'AdminCatalog.fixedPriority' | t }}</label>
            <select [id]="id + 'pr'" [name]="id + 'pr'" [class]="cls.input" [(ngModel)]="m.priorityCode">
              <option [ngValue]="null">{{ 'AdminCatalog.inheritsPriority' | t }}</option>
              @for (p of data()?.priorities ?? []; track p.code) { <option [ngValue]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminCatalog.active' | t }}</label>
        </div>
      </ng-template>
      <ng-template #fieldForm let-m="m" let-id="id" let-locked="locked" let-isNew="isNew">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'k'" [class]="cls.label"><span>{{ 'AdminCatalog.fieldKey' | t }}<app-req /></span></label>
            <input [id]="id + 'k'" [name]="id + 'k'" dir="ltr" required maxlength="41" pattern="[a-z][a-z0-9_]{1,40}" [class]="cls.input" [(ngModel)]="m.key" [readonly]="!isNew" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ty'" [class]="cls.label">{{ 'AdminCatalog.fieldType' | t }}</label>
            <select [id]="id + 'ty'" [name]="id + 'ty'" [class]="cls.input" [(ngModel)]="m.type" [disabled]="locked">
              @for (ft of fieldTypes; track ft) { <option [value]="ft">{{ 'CustomFields.types.' + ft | t }}</option> }
            </select>
            @if (locked) { <p class="text-sm text-muted">{{ 'AdminCommon.errors.typeLocked' | t }}</p> }</div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'le'" [class]="cls.label"><span>{{ 'AdminCatalog.nameEn' | t }}<app-req /></span></label>
            <input [id]="id + 'le'" [name]="id + 'le'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.labelEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'la'" [class]="cls.label"><span>{{ 'AdminCatalog.nameAr' | t }}<app-req /></span></label>
            <input [id]="id + 'la'" [name]="id + 'la'" dir="rtl" required maxlength="120" [class]="cls.input" [(ngModel)]="m.labelAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ca'" [class]="cls.label">{{ 'AdminCatalog.appliesTo' | t }}</label>
            <select [id]="id + 'ca'" [name]="id + 'ca'" [class]="cls.input" [(ngModel)]="m.categoryId">
              <option [ngValue]="null">{{ 'AdminCatalog.allCategories' | t }}</option>
              @for (c of data()?.categories ?? []; track c.id) { <option [ngValue]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          @if (m.type === 'dropdown' || m.type === 'multi_select' || m.type === 'radio') {
            <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'op'" [class]="cls.label"><span>{{ 'AdminCatalog.options' | t }}<app-req /></span></label>
              <textarea [id]="id + 'op'" [name]="id + 'op'" rows="4" dir="auto" [class]="cls.input + ' py-2 font-mono text-sm'" [(ngModel)]="m.optionsText"></textarea>
              <p class="text-sm text-muted">{{ 'AdminCatalog.optionsHint' | t }}</p></div>
          }
          @if (m.type === 'number') {
            <div class="flex flex-col gap-1.5"><label [for]="id + 'mn'" [class]="cls.label">{{ 'AdminCatalog.min' | t }}</label>
              <input [id]="id + 'mn'" [name]="id + 'mn'" type="number" [class]="cls.input" [(ngModel)]="m.min" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'mx'" [class]="cls.label">{{ 'AdminCatalog.max' | t }}</label>
              <input [id]="id + 'mx'" [name]="id + 'mx'" type="number" [class]="cls.input" [(ngModel)]="m.max" /></div>
          }
          @if (m.type === 'text' || m.type === 'long_text') {
            <div class="flex flex-col gap-1.5"><label [for]="id + 'nl'" [class]="cls.label">{{ 'AdminCatalog.minLength' | t }}</label>
              <input [id]="id + 'nl'" [name]="id + 'nl'" type="number" min="0" [class]="cls.input" [(ngModel)]="m.minLength" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'xl'" [class]="cls.label">{{ 'AdminCatalog.maxLength' | t }}</label>
              <input [id]="id + 'xl'" [name]="id + 'xl'" type="number" min="0" [class]="cls.input" [(ngModel)]="m.maxLength" /></div>
            <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'pt'" [class]="cls.label">{{ 'AdminCatalog.pattern' | t }}</label>
              <input [id]="id + 'pt'" [name]="id + 'pt'" dir="ltr" maxlength="300" [class]="cls.input + ' font-mono'" [(ngModel)]="m.pattern" /></div>
          }
        </div>
        <div class="mt-2 flex flex-wrap gap-x-6">
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'rq'" class="h-5 w-5" [(ngModel)]="m.isRequired" /> {{ 'AdminCatalog.required' | t }}</label>
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'vs'" class="h-5 w-5" [(ngModel)]="m.visibleToCustomer" /> {{ 'AdminCatalog.visible' | t }}</label>
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminCatalog.active' | t }}</label>
        </div>
      </ng-template>

      <ng-template #typeForm let-m="m" let-id="id" let-row="row">
        <form [class]="formCls" novalidate (ngSubmit)="row ? updateType(row) : createType()">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminCatalog.nameEn' | t }}<app-req /></span><input [name]="id + 'en'" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminCatalog.nameAr' | t }}<app-req /></span><input [name]="id + 'ar'" dir="rtl" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameAr" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminTicketTypes.descEn' | t }}<textarea [name]="id + 'de'" rows="3" dir="ltr" maxlength="300" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.descriptionEn"></textarea></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminTicketTypes.descAr' | t }}<textarea [name]="id + 'da'" rows="3" dir="rtl" maxlength="300" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.descriptionAr"></textarea></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminTicketTypes.examplesEn' | t }}<input [name]="id + 'xe'" dir="ltr" maxlength="300" [class]="cls.input + ' font-normal'" [(ngModel)]="m.examplesEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminTicketTypes.examplesAr' | t }}<input [name]="id + 'xa'" dir="rtl" maxlength="300" [class]="cls.input + ' font-normal'" [(ngModel)]="m.examplesAr" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminTicketTypes.code' | t }}<input [name]="id + 'cd'" dir="ltr" maxlength="4" autocomplete="off" [class]="cls.input + ' font-mono font-normal uppercase'" [(ngModel)]="m.code" />
              <span class="text-xs font-normal text-muted">{{ 'AdminTicketTypes.codeHint' | t }}</span></label>
          </div>
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-semibold">{{ 'AdminTicketTypes.availableCategories' | t }}</legend>
            <p class="text-sm text-muted">{{ 'AdminTicketTypes.availableHint' | t }}</p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              @for (c of data()?.categories ?? []; track c.id) {
                <label class="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm" dir="auto"><input type="checkbox" class="h-5 w-5" [checked]="m.categoryIds.includes(c.id)" (change)="toggle(m.categoryIds, c.id)" />{{ i18n.pick(c.nameEn, c.nameAr) }}</label>
              }
            </div>
          </fieldset>
          <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminTicketTypes.showToCustomers' | t }}</label>
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (row ? 'AdminCatalog.save' : 'AdminTicketTypes.add') | t }}</button>
            @if (row) {
              <button type="button" (click)="typeEdit.set(null)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'AdminTicketTypes.cancel' | t }}</button>
              @if (asking() === 't' + row.id) {
                <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white" (click)="asking.set(null); remove('ticket-types/' + row.id)">{{ 'Directory.deleteYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold" (click)="asking.set(null)">{{ 'Directory.cancel' | t }}</button>
              } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set('t' + row.id)">{{ 'AdminTicketTypes.delete' | t }}</button> }
              <p class="basis-full text-xs text-muted">{{ 'AdminTicketTypes.deleteHint' | t }}</p>
            }
          </div>
        </form>
      </ng-template>
      <ng-template #moveBtns let-up="up" let-down="down" let-first="first" let-last="last">
        <div class="flex gap-1">
          <button type="button" [disabled]="busy() || first" (click)="up()" [attr.aria-label]="'AdminCatalog.moveUp' | t" [class]="mv"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6" /></svg></button>
          <button type="button" [disabled]="busy() || last" (click)="down()" [attr.aria-label]="'AdminCatalog.moveDown' | t" [class]="mv"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg></button>
        </div>
      </ng-template>

      <!-- ticket types (v1 TicketTypesSection) -->
      <section aria-labelledby="types" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="types" class="text-xl font-bold">{{ 'AdminTicketTypes.title' | t }}</h2><p class="max-w-prose text-muted">{{ 'AdminTicketTypes.subtitle' | t }}</p></div>
          <button type="button" [attr.aria-expanded]="typeAdding()" (click)="typeAdding.set(!typeAdding()); typeEdit.set(null)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'AdminTicketTypes.add' | t }}</button>
        </div>
        @if (typeAdding()) { <ng-container *ngTemplateOutlet="typeForm; context: { m: nwType, id: 'nt', row: null }" /> }
        <div class="overflow-x-auto rounded-md border border-line bg-surface">
          <table class="w-full min-w-[44rem] border-collapse text-start text-sm">
            <caption class="sr-only">{{ 'AdminTicketTypes.title' | t }}</caption>
            <thead class="bg-bg text-xs font-semibold text-muted"><tr>@for (k of typeCols; track k) { <th scope="col" class="px-2 py-3 text-start">{{ 'AdminTicketTypes.' + k | t }}</th> }</tr></thead>
            <tbody>
              @for (r of types(); track r.id; let i = $index, first = $first, last = $last) {
                <tr class="border-t border-line" [class.bg-brand-soft]="typeEdit() === r.id" [class.opacity-70]="!r.isActive">
                  <td class="px-2 py-3"><div class="flex items-center gap-2"><span class="w-5 text-muted" dir="ltr">{{ i + 1 }}</span>
                    <ng-container *ngTemplateOutlet="moveBtns; context: { first, last, up: moveType(r, -1), down: moveType(r, 1) }" /></div></td>
                  <td class="px-2 py-3 font-semibold" dir="auto">{{ i18n.pick(r.nameEn, r.nameAr) }}@if (r.code) { <span class="ms-2 rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-xs font-bold text-brand-ink" dir="ltr">{{ r.code }}</span> }<span class="block text-xs font-normal text-muted" [attr.dir]="i18n.locale() === 'ar' ? 'ltr' : 'rtl'">{{ i18n.locale() === 'ar' ? r.nameEn : r.nameAr }}</span></td>
                  <td class="px-2 py-3">{{ 'AdminTicketTypes.linked' | t: { n: r.categoryIds.length } }}</td>
                  <td class="px-2 py-3">{{ r.tickets }}</td>
                  <td class="px-2 py-3"><span class="rounded-full px-2.5 py-1 text-xs font-semibold" [class]="r.isActive ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (r.isActive ? 'AdminTicketTypes.visible' : 'AdminTicketTypes.hidden') | t }}</span></td>
                  <td class="px-2 py-3"><div class="flex flex-wrap items-start gap-2">
                    <button type="button" (click)="editType(r)" [attr.aria-expanded]="typeEdit() === r.id" [class]="small">{{ 'AdminTicketTypes.edit' | t }}</button>
                    <button type="button" [disabled]="busy()" (click)="setTypeActive(r, !r.isActive)" [class]="small">{{ (r.isActive ? 'AdminTicketTypes.hide' : 'AdminTicketTypes.show') | t }}</button>
                  </div></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="text-sm text-muted">{{ 'AdminTicketTypes.rules' | t }}</p>
        @if (editingType(); as et) {
          <div class="rounded-md border border-brand bg-surface p-3">
            <h3 class="px-2 pb-3 text-lg font-bold" dir="auto">{{ 'AdminTicketTypes.editing' | t: { name: i18n.pick(et.nameEn, et.nameAr) } }}</h3>
            <ng-container *ngTemplateOutlet="typeForm; context: { m: editTypeM[et.id], id: 'et', row: et }" />
          </div>
        }
      </section>

      <!-- categories (v1 overview table) -->
      <section aria-labelledby="cats" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="cats" class="text-xl font-bold">{{ 'AdminCatalog.categories' | t }}</h2>
          <div class="flex flex-wrap gap-2">
            <button type="button" [attr.aria-expanded]="addMode() === 'cat'" (click)="addMode.set(addMode() === 'cat' ? null : 'cat')" class="min-h-11 cursor-pointer rounded-lg border px-4 text-sm font-semibold" [class]="addMode() === 'cat' ? on : off">{{ 'AdminCatalog.addCategoryBtn' | t }}</button>
            <button type="button" [attr.aria-expanded]="addMode() === 'sub'" (click)="addMode.set(addMode() === 'sub' ? null : 'sub')" class="min-h-11 cursor-pointer rounded-lg border px-4 text-sm font-semibold" [class]="addMode() === 'sub' ? on : off">{{ 'AdminCatalog.addSubcategoryBtn' | t }}</button>
          </div>
          @if (addMode() === 'cat') {
            <form class="basis-full" [class]="formCls" novalidate (ngSubmit)="createCat()">
              <ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'nc' }" />
              <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addCategory' | t }}</button></div>
            </form>
          }
          @if (addMode() === 'sub') {
            <div class="flex basis-full flex-col gap-3">
              @if (!(data()?.categories ?? []).length) { <p class="text-muted">{{ 'AdminCatalog.needCategory' | t }}</p> } @else {
                <div class="max-w-sm"><label for="sub-parent" class="mb-1 block text-sm font-semibold">{{ 'AdminCatalog.parentCategory' | t }}</label>
                  <select id="sub-parent" [class]="cls.input" [ngModel]="subParent()" (ngModelChange)="subParent.set($event)">@for (c of data()!.categories; track c.id) { <option [value]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }</select></div>
                <form class="flex flex-col gap-3 rounded border border-line bg-bg p-4" novalidate (ngSubmit)="createSub(subParent())">
                  <ng-container *ngTemplateOutlet="subForm; context: { m: nwSub(subParent()), id: 'ns' }" />
                  <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addSubcategory' | t }}</button></div>
                </form>
              }
            </div>
          }
        </div>
        <div class="overflow-x-auto rounded-md border border-line bg-surface">
          <table class="w-full min-w-[48rem] border-collapse text-start text-sm">
            <caption class="sr-only">{{ 'AdminCatalog.categories' | t }}</caption>
            <thead class="bg-bg text-xs font-semibold text-muted"><tr>@for (k of catCols; track k) { <th scope="col" class="px-2 py-3 text-start">{{ 'AdminCatalog.' + k | t }}</th> }</tr></thead>
            <tbody>
              @for (c of cats(); track c.id; let i = $index, first = $first, last = $last) {
                @let n = c.tickets;
                <tr class="border-t border-line" [class.bg-brand-soft]="catEdit() === c.id">
                  <td class="px-2 py-3"><div class="flex items-center gap-1">
                    @if (c.subcategories.length) {
                      <button type="button" (click)="flipOpen(c.id)" [attr.aria-expanded]="openCats().includes(c.id)" [attr.aria-label]="((openCats().includes(c.id) ? 'AdminCatalog.collapseSubs' : 'AdminCatalog.expandSubs') | t) + ': ' + i18n.pick(c.nameEn, c.nameAr)"
                        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-bg">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" [class]="openCats().includes(c.id) ? 'rotate-90' : 'rtl:rotate-180'"><path d="M9 6l6 6-6 6" /></svg></button>
                    } @else { <span class="size-9 shrink-0"></span> }
                    <span class="text-muted" dir="ltr">{{ i + 1 }}</span></div></td>
                  <td class="px-2 py-3 font-semibold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}@if (c.subcategories.length) { <span class="ms-2 text-xs font-normal text-muted">{{ 'AdminCatalog.subcategories' | t }}: {{ c.subcategories.length }}</span> }</td>
                  <td class="px-2 py-3">@if (prio(c.priorityCode); as p) { <span class="inline-flex items-center gap-1.5"><app-prio-icon [name]="p.icon" [color]="p.color" />{{ i18n.pick(p.nameEn, p.nameAr) }}</span> } @else { <span class="text-muted">{{ 'AdminCatalog.noFixedPriorityShort' | t }}</span> }</td>
                  <td class="px-2 py-3">@if (teamName2(c.defaultTeamId); as tn) { {{ tn }} } @else { <span class="text-muted">{{ 'AdminCatalog.noTeam' | t }}</span> }</td>
                  <td class="px-2 py-3">@if (n > 0) { <a [routerLink]="'/' + i18n.locale() + '/console'" [queryParams]="{ view: 'all', status: 'any', category: c.id }" class="font-semibold text-brand-ink underline">{{ n }} ({{ pct(n) }}%)</a> } @else { <span class="text-muted">0</span> }</td>
                  <td class="px-2 py-3">{{ (c.isPrivate ? 'AdminCatalog.typePrivate' : 'AdminCatalog.typePublic') | t }}</td>
                  <td class="px-2 py-3"><span class="font-semibold">{{ (c.autoAssign ? 'AdminCatalog.on' : 'AdminCatalog.off') | t }}</span></td>
                  <td class="px-2 py-3">{{ (c.isActive ? 'AdminCatalog.active' : 'AdminCatalog.inactive') | t }}</td>
                  <td class="px-2 py-3"><div class="flex items-center gap-1">
                    <ng-container *ngTemplateOutlet="moveBtns; context: { first, last, up: moveCat(c, -1), down: moveCat(c, 1) }" />
                    <button type="button" (click)="editCatOpen(c.id)" class="flex min-h-10 cursor-pointer items-center rounded-lg border border-line bg-surface px-2.5 font-semibold hover:bg-bg">{{ 'AdminCatalog.edit' | t }}</button></div></td>
                </tr>
                @if (openCats().includes(c.id)) {
                  @for (x of c.subcategories; track x.id) {
                    <tr class="border-t border-line bg-bg text-sm">
                      <td class="px-2 py-2"></td>
                      <td class="py-2 ps-8 pe-3 font-medium" dir="auto"><span class="me-2 text-muted" aria-hidden="true">↳</span>{{ i18n.pick(x.nameEn, x.nameAr) }}</td>
                      <td class="px-2 py-2">@if (prio(x.priorityCode); as p) { <span class="inline-flex items-center gap-1.5"><app-prio-icon [name]="p.icon" [color]="p.color" />{{ i18n.pick(p.nameEn, p.nameAr) }}</span> } @else { <span class="text-muted">{{ 'AdminCatalog.inheritsPriority' | t }}</span> }</td>
                      <td class="px-2 py-2 text-muted">-</td><td class="px-2 py-2 text-muted">-</td><td class="px-2 py-2 text-muted">-</td><td class="px-2 py-2 text-muted">-</td>
                      <td class="px-2 py-2">{{ (x.isActive ? 'AdminCatalog.active' : 'AdminCatalog.inactive') | t }}</td>
                      <td class="px-2 py-2"><button type="button" class="cursor-pointer font-semibold text-brand-ink underline" (click)="editCatOpen(c.id)">{{ 'AdminCatalog.edit' | t }}</button></td>
                    </tr>
                  }
                }
              }
            </tbody>
          </table>
        </div>
        @if (editingCat(); as ec) {
          <div id="edit" class="flex flex-col gap-4 rounded-md border border-brand bg-surface p-3">
            <div class="flex items-center justify-between gap-3 px-2">
              <h3 class="text-lg font-bold" dir="auto">{{ 'AdminCatalog.editing' | t: { name: i18n.pick(ec.nameEn, ec.nameAr) } }}</h3>
              <button type="button" class="flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-bg" (click)="catEdit.set(null)">{{ 'AdminCatalog.close' | t }}</button>
            </div>
            <form [class]="formCls" novalidate (ngSubmit)="updateCat(ec)">
              <ng-container *ngTemplateOutlet="catForm; context: { m: editCat[ec.id], id: 'c' + ec.id }" />
              <div class="flex flex-wrap items-center gap-3">
                <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.save' | t }}</button>
                @if (asking() === 'c' + ec.id) {
                  <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                  <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white" (click)="asking.set(null); remove('categories/' + ec.id)">{{ 'Directory.deleteYes' | t }}</button>
                  <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold" (click)="asking.set(null)">{{ 'Directory.cancel' | t }}</button>
                } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set('c' + ec.id)">{{ 'Directory.delete' | t }}</button> }
              </div>
            </form>
            <h3 class="px-2 font-bold">{{ 'AdminCatalog.subcategories' | t }}</h3>
            @for (sx of ec.subcategories; track sx.id) {
              <details class="rounded border border-line"><summary class="min-h-11 cursor-pointer px-4 py-2 font-semibold">{{ i18n.pick(sx.nameEn, sx.nameAr) }}@if (!sx.isActive) { ({{ 'AdminCatalog.inactive' | t }}) }</summary>
                <div class="p-2"><form class="flex flex-col gap-3 rounded border border-line bg-bg p-4" novalidate (ngSubmit)="updateSub(sx)">
                  <ng-container *ngTemplateOutlet="subForm; context: { m: editSub[sx.id], id: 's' + sx.id }" />
                  <div class="flex flex-wrap items-center gap-3">
                    <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.save' | t }}</button>
                    @if (asking() === 's' + sx.id) {
                  <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                  <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white" (click)="asking.set(null); remove('subcategories/' + sx.id)">{{ 'Directory.deleteYes' | t }}</button>
                  <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold" (click)="asking.set(null)">{{ 'Directory.cancel' | t }}</button>
                } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set('s' + sx.id)">{{ 'Directory.delete' | t }}</button> }
                  </div>
                </form></div></details>
            }
          </div>
        }
      </section>

      <!-- type x category matrix (v1 TypeLinksMatrix) -->
      <section aria-labelledby="matrix" class="flex flex-col gap-3">
        <div><h2 id="matrix" class="text-xl font-bold">{{ 'AdminTicketTypes.matrixTitle' | t }}</h2><p class="max-w-prose text-muted">{{ 'AdminTicketTypes.matrixHint' | t }}</p></div>
        <div class="overflow-x-auto rounded-md border border-line bg-surface">
          <table class="w-full min-w-[44rem] border-collapse text-sm">
            <caption class="sr-only">{{ 'AdminTicketTypes.matrixTitle' | t }}</caption>
            <thead class="bg-bg text-xs font-semibold text-muted"><tr>
              <th scope="col" class="px-3 py-3 text-start">{{ 'AdminTicketTypes.colCategory' | t }}</th>
              @for (x of types(); track x.id) { <th scope="col" class="px-2 py-3 text-center" [class.opacity-60]="!x.isActive" dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</th> }
              <th scope="col" class="px-3 py-3 text-center">{{ 'AdminTicketTypes.colTypes' | t }}</th>
            </tr></thead>
            <tbody>
              @for (c of cats(); track c.id) {
                @let k = linkCount(c.id);
                <tr class="border-t border-line">
                  <th scope="row" class="px-3 py-1 text-start font-semibold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</th>
                  @for (x of types(); track x.id) {
                    <td class="px-2 py-1 text-center"><label class="inline-flex size-11 cursor-pointer items-center justify-center">
                      <input type="checkbox" class="h-5 w-5" [checked]="links().has(x.id + ':' + c.id)" (change)="flipLink(x.id + ':' + c.id)" [attr.aria-label]="i18n.pick(c.nameEn, c.nameAr) + ' / ' + i18n.pick(x.nameEn, x.nameAr)" /></label></td>
                  }
                  <td class="px-3 py-1 text-center font-semibold" [class.text-danger]="k === 0">{{ k }} / {{ types().length }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="text-sm text-muted">{{ 'AdminTicketTypes.matrixWarn' | t }}</p>
        <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="saveLinks()">{{ 'AdminTicketTypes.saveLinks' | t }}</button></div>
      </section>

      <!-- custom fields (v1: one collapsible row each) -->
      <section aria-labelledby="flds" class="flex flex-col gap-3">
        <h2 id="flds" class="text-xl font-bold">{{ 'AdminCatalog.fields' | t }}</h2><p class="text-muted">{{ 'AdminCatalog.fieldsHint' | t }}</p>
        @for (f of data()?.fields ?? []; track f.id) {
          <details class="rounded-md border border-line bg-surface"><summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ i18n.pick(f.labelEn, f.labelAr) }} <span class="text-sm font-normal text-muted">({{ 'CustomFields.types.' + f.type | t }}@if (f.isRequired) {, {{ 'AdminCatalog.required' | t }} }@if (!f.visibleToCustomer) {, {{ 'AdminCatalog.staffOnly' | t }} }@if (!f.isActive) {, {{ 'AdminCatalog.inactive' | t }} })</span></summary>
            <div class="p-3"><form [class]="formCls" novalidate (ngSubmit)="updateField(f)">
              <ng-container *ngTemplateOutlet="fieldForm; context: { m: editField[f.id], id: 'f' + f.id, locked: f.hasValues, isNew: false }" />
              <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.save' | t }}</button>
                @if (!f.hasValues) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('fields/' + f.id)">{{ 'Directory.delete' | t }}</button> }</div>
              @if (msgAt() === f.id) { @if (msg(); as m) { @if (m.tone === 'error') { <app-alert tone="error">{{ m.text }}</app-alert> } } }
            </form></div>
          </details>
        }
        <details class="rounded-md border border-line bg-surface" #addf><summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ 'AdminCatalog.addField' | t }}</summary>
          <div class="p-3"><form [class]="formCls" novalidate (ngSubmit)="createField(addf)">
            <ng-container *ngTemplateOutlet="fieldForm; context: { m: nwField, id: 'nf', locked: false, isNew: true }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addField' | t }}</button></div>
            @if (msgAt() === 'new') { @if (msg(); as m) { @if (m.tone === 'error') { <app-alert tone="error">{{ m.text }}</app-alert> } } }
          </form></div></details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminCatalogPage extends AdminBase implements OnInit {
  protected readonly fieldTypes = ['text', 'long_text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'radio'];
  protected readonly formCls = 'flex flex-col gap-4 rounded-md border border-line bg-surface p-5';
  protected readonly small = 'min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg disabled:opacity-60';
  protected readonly mv = 'flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface hover:bg-bg disabled:cursor-not-allowed disabled:opacity-30';
  protected readonly on = 'border-brand bg-brand text-white hover:bg-brand-ink';
  protected readonly off = 'border-line bg-surface hover:bg-bg';
  protected readonly typeCols = ['colOrder', 'colName', 'colCategories', 'colTickets', 'colStatus', 'colActions'];
  protected readonly catCols = ['colOrder', 'colName', 'colPriority', 'colTeam', 'colTickets', 'colType', 'colAuto', 'colStatus', 'colActions'];
  protected readonly data = signal<CatalogData | null>(null);
  protected readonly types = computed(() => [...(this.data()?.types ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn)));
  protected readonly cats = computed(() => [...(this.data()?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn)));
  protected readonly typeAdding = signal(false);
  protected readonly typeEdit = signal<string | null>(null);
  protected readonly catEdit = signal<string | null>(null);
  protected readonly addMode = signal<'cat' | 'sub' | null>(null);
  protected readonly subParent = signal('');
  protected readonly openCats = signal<string[]>([]);
  protected readonly asking = signal<string | null>(null);
  protected readonly links = signal(new Set<string>());
  protected readonly editingType = computed(() => this.types().find((x) => x.id === this.typeEdit()) ?? null);
  protected readonly editingCat = computed(() => this.cats().find((x) => x.id === this.catEdit()) ?? null);
  protected nwType: TypeModel = { ...blankType(), categoryIds: [] };
  protected editTypeM: Record<string, TypeModel> = {};
  protected nwCat: CatModel = blankCat();
  protected nwField: FieldModel = blankField();
  protected editCat: Record<string, CatModel> = {};
  protected editSub: Record<string, SubModel> = {};
  protected editField: Record<string, FieldModel> = {};
  private newSubs: Record<string, SubModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<CatalogData>('catalog');
      for (const t of d.types) this.editTypeM[t.id] = { code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, descriptionEn: t.descriptionEn, descriptionAr: t.descriptionAr, examplesEn: t.examplesEn, examplesAr: t.examplesAr, sortOrder: t.sortOrder, isActive: t.isActive, categoryIds: [...t.categoryIds] };
      for (const c of d.categories) {
        this.editCat[c.id] = { nameEn: c.nameEn, nameAr: c.nameAr, defaultTeamId: c.defaultTeamId, isActive: c.isActive, sortOrder: c.sortOrder, priorityCode: c.priorityCode, isPrivate: c.isPrivate, autoAssign: c.autoAssign, typeIds: [...c.typeIds] };
        for (const s of c.subcategories) this.editSub[s.id] = { categoryId: s.categoryId, nameEn: s.nameEn, nameAr: s.nameAr, isActive: s.isActive, sortOrder: s.sortOrder, priorityCode: s.priorityCode };
      }
      for (const f of d.fields) this.editField[f.id] = toFieldModel(f);
      this.links.set(new Set(d.types.flatMap((t) => t.categoryIds.map((c) => `${t.id}:${c}`))));
      if (!this.subParent() || !d.categories.some((c) => c.id === this.subParent())) this.subParent.set(d.categories[0]?.id ?? '');
      if (!this.nwType.categoryIds.length) this.nwType.categoryIds = d.categories.map((c) => c.id);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected nwSub(catId: string): SubModel { return (this.newSubs[catId] ??= blankSub(catId)); }
  protected toggle(list: string[], id: string): void { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); }
  protected flipOpen(id: string): void { this.openCats.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  protected teamName2(id: string | null): string { const t = this.data()?.teams.find((x) => x.id === id); return t ? this.i18n.pick(t.nameEn, t.nameAr) : ''; }
  protected prio(code: string | null): PrioOpt | undefined { return this.data()?.priorities.find((x) => x.code === code); }
  protected dot(color: string): string { return PRIO_DOT[color] ?? 'bg-slate-400'; }
  protected pct(n: number): number { const all = this.cats().reduce((a, c) => a + c.tickets, 0); return all ? Math.round((n / all) * 100) : 0; }
  protected linkCount(cat: string): number { return this.types().filter((x) => this.links().has(`${x.id}:${cat}`)).length; }
  protected flipLink(k: string): void { this.links.update((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }

  // ---- ticket types
  protected editType(r: TypeRow): void { this.typeEdit.set(this.typeEdit() === r.id ? null : r.id); this.typeAdding.set(false); }
  protected async createType(): Promise<void> {
    const body = { ...this.nwType, sortOrder: (this.types().at(-1)?.sortOrder ?? 0) + 1 };
    if (await this.run(() => this.api.post('ticket-types', body))) { this.nwType = { ...blankType(), categoryIds: [] }; this.typeAdding.set(false); }
  }
  protected async updateType(r: TypeRow): Promise<void> { if (await this.run(() => this.api.put('ticket-types/' + r.id, this.editTypeM[r.id]))) this.typeEdit.set(null); }
  private typeBody(r: TypeRow, patch: Partial<TypeModel> = {}) { return { ...this.editTypeM[r.id], categoryIds: [...r.categoryIds], ...patch }; }
  protected setTypeActive(r: TypeRow, on: boolean): void { void this.run(() => this.api.put('ticket-types/' + r.id, this.typeBody(r, { isActive: on }))); }
  /** One place up or down: every row is renumbered 1..n in the new order (v1 move_ticket_type). */
  protected moveType(r: TypeRow, dir: -1 | 1): () => void {
    return () => {
      const list = [...this.types()]; const i = list.indexOf(r); const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      void this.run(async () => { for (const [k, x] of list.entries()) if (x.sortOrder !== k + 1) await this.api.put('ticket-types/' + x.id, this.typeBody(x, { sortOrder: k + 1 })); });
    };
  }
  /** Saves the matrix: each type whose ticked categories changed (v1 save_type_links). */
  protected saveLinks(): void {
    const on = this.links();
    void this.run(async () => {
      for (const t of this.types()) {
        const ids = this.cats().filter((c) => on.has(`${t.id}:${c.id}`)).map((c) => c.id);
        const same = ids.length === t.categoryIds.length && ids.every((x) => t.categoryIds.includes(x));
        if (!same) await this.api.put('ticket-types/' + t.id, this.typeBody(t, { categoryIds: ids }));
      }
    });
  }

  // ---- categories and subcategories
  protected editCatOpen(id: string): void {
    this.catEdit.set(id);
    requestAnimationFrame(() => document.getElementById('edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  protected async createCat(): Promise<void> {
    const body = { ...this.nwCat, sortOrder: this.nwCat.sortOrder || (this.cats().at(-1)?.sortOrder ?? 0) + 1, typeIds: this.types().map((t) => t.id) };
    if (await this.run(() => this.api.post('categories', body))) { this.nwCat = blankCat(); this.addMode.set(null); }
  }
  protected updateCat(c: CatRow): void { void this.run(() => this.api.put('categories/' + c.id, this.editCat[c.id])); }
  protected moveCat(c: CatRow, dir: -1 | 1): () => void {
    return () => {
      const list = [...this.cats()]; const i = list.indexOf(c); const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      void this.run(async () => { for (const [k, x] of list.entries()) if (x.sortOrder !== k + 1) await this.api.put('categories/' + x.id, { ...this.editCat[x.id], sortOrder: k + 1 }); });
    };
  }
  protected async createSub(catId: string): Promise<void> {
    if (await this.run(() => this.api.post('subcategories', this.nwSub(catId)))) { delete this.newSubs[catId]; this.addMode.set(null); }
  }
  protected updateSub(s: SubRow): void { void this.run(() => this.api.put('subcategories/' + s.id, this.editSub[s.id])); }
  /** Which field form the last error belongs to ('new' or a field id), so it shows under that form. */
  protected readonly msgAt = signal<string | null>(null);
  private pendingAt: string | null = null;
  protected override async run(fn: () => Promise<unknown>, okKey?: string, params?: Record<string, unknown>): Promise<boolean> {
    this.msgAt.set(this.pendingAt); this.pendingAt = null;
    return super.run(fn, okKey, params);
  }
  protected async createField(box: HTMLDetailsElement): Promise<void> {
    this.pendingAt = 'new';
    if (await this.run(() => this.api.post('fields', fieldBody(this.nwField)))) { this.nwField = blankField(); box.open = false; }
  }
  protected updateField(f: FieldRow): void { this.pendingAt = f.id; void this.run(() => this.api.put('fields/' + f.id, fieldBody(this.editField[f.id]))); }
  protected remove(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}

function toFieldModel(f: FieldRow): FieldModel {
  let opts: (string | { value: string; label_en?: string; label_ar?: string })[] = [];
  let rules: { min?: number; max?: number; min_length?: number; max_length?: number; pattern?: string } = {};
  try { opts = JSON.parse(f.options); } catch { /* keep empty */ }
  try { rules = JSON.parse(f.validation); } catch { /* keep empty */ }
  const optionsText = opts.map((o) => (typeof o === 'string' ? o : [o.value, o.label_en ?? '', o.label_ar ?? ''].join(' | '))).join('\n');
  return {
    key: f.key, labelEn: f.labelEn, labelAr: f.labelAr, type: f.type, optionsText, isRequired: f.isRequired, visibleToCustomer: f.visibleToCustomer,
    categoryId: f.categoryId, isActive: f.isActive, sortOrder: f.sortOrder, min: rules.min ?? null, max: rules.max ?? null,
    minLength: rules.min_length ?? null, maxLength: rules.max_length ?? null, pattern: rules.pattern ?? '',
  };
}

function fieldBody(m: FieldModel) {
  const options = m.optionsText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [value, labelEn, labelAr] = l.split('|').map((x) => x.trim());
    return { value, labelEn: labelEn || value, labelAr: labelAr || null };
  });
  const num = (v: number | null) => (v === null || (v as unknown) === '' ? null : Number(v));
  return {
    key: m.key, labelEn: m.labelEn, labelAr: m.labelAr, type: m.type, options, isRequired: m.isRequired, visibleToCustomer: m.visibleToCustomer,
    categoryId: m.categoryId, isActive: m.isActive, sortOrder: Number(m.sortOrder) || 0, min: num(m.min), max: num(m.max),
    minLength: num(m.minLength), maxLength: num(m.maxLength), pattern: m.pattern || null,
  };
}

// ================================================================== priorities

type PrioModel = { nameEn: string; nameAr: string; color: string; icon: string; sortOrder: number; isActive: boolean; firstResponseMinutes: number; resolutionMinutes: number };
const blankPrio = (): PrioModel => ({ nameEn: '', nameAr: '', color: 'blue', icon: 'flag', sortOrder: 50, isActive: true, firstResponseMinutes: 240, resolutionMinutes: 1440 });

@Component({
  selector: 'app-admin-priorities',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet, PrioIcon],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminPriorities.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminPriorities.subtitle' | t }}</p></div>
      <form class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card" novalidate (ngSubmit)="setMode(modeIn)">
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-xl font-bold">{{ 'AdminPriorities.modeTitle' | t }}</legend>
          <p class="mb-2 text-sm text-muted">{{ 'AdminPriorities.modeHelp' | t }}</p>
          @for (md of ['system', 'customer']; track md) {
            <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="mode" class="mt-1 h-5 w-5 accent-[var(--brand)]" [checked]="modeIn === md" (change)="modeIn = md" />
              <span><span class="block font-semibold">{{ 'AdminPriorities.mode_' + md | t }}</span><span class="block text-sm text-muted">{{ 'AdminPriorities.mode_' + md + '_help' | t }}</span></span></label>
          }
        </fieldset>
        @if (modeMsg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
        <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button></div>
      </form>

      <ng-template #form let-m="m" let-id="id" let-row="row">
        <form [class]="row ? 'flex flex-col gap-4 border-t border-line pt-4' : 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-5'" novalidate (ngSubmit)="row ? update(row) : create()">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminPriorities.nameEn' | t }}<app-req /></span><input [name]="id + 'en'" dir="ltr" maxlength="60" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminPriorities.nameAr' | t }}<app-req /></span><input [name]="id + 'ar'" dir="rtl" maxlength="60" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameAr" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminPriorities.color' | t }}
              <select [name]="id + 'co'" [class]="cls.input + ' font-normal'" [(ngModel)]="m.color">@for (c of colors; track c) { <option [value]="c">{{ 'AdminPriorities.colors.' + c | t }}</option> }</select></label>
            <fieldset class="flex flex-col gap-1.5">
              <legend class="text-sm font-semibold">{{ 'AdminPriorities.icon' | t }}</legend>
              <div class="flex flex-wrap gap-2">
                @for (n of icons; track n) {
                  <button type="button" (click)="m.icon = n" [attr.aria-pressed]="m.icon === n" [attr.aria-label]="'AdminPriorities.icons.' + n | t" [title]="'AdminPriorities.icons.' + n | t"
                    class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border" [class]="m.icon === n ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-bg'"><app-prio-icon [name]="n" [size]="20" /></button>
                }
              </div>
            </fieldset>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminPriorities.sort' | t }}<input [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input + ' font-normal'" [(ngModel)]="m.sortOrder" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminPriorities.first' | t }}<app-req /></span><input [name]="id + 'fr'" type="number" min="1" [class]="cls.input + ' font-normal'" [(ngModel)]="m.firstResponseMinutes" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminPriorities.resolution' | t }}<app-req /></span><input [name]="id + 'rs'" type="number" min="1" [class]="cls.input + ' font-normal'" [(ngModel)]="m.resolutionMinutes" /></label>
          </div>
          <p class="text-sm text-muted">{{ 'AdminPriorities.slaHint' | t }}</p>
          <p class="flex items-center gap-2 text-sm"><span class="text-muted">{{ 'AdminPriorities.preview' | t }}</span>
            <span class="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold" [class]="tone(m.color)"><app-prio-icon [name]="m.icon" [size]="12" />{{ m.nameEn || ('AdminPriorities.previewName' | t) }}</span></p>
          @if (row) { <label class="${CHECK}"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminPriorities.active' | t }}</label> }
          @if (msgFor() === (row?.code ?? '+')) { @if (msg(); as mm) { <app-alert [tone]="mm.tone">{{ mm.text }}</app-alert> } }
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (row ? 'AdminPriorities.save' : 'AdminPriorities.add') | t }}</button>
            @if (row && !row.isDefault) {
              @if (asking() === row.code) {
                <span class="text-sm font-semibold text-danger">{{ 'Directory.deleteConfirm' | t }}</span>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 text-sm font-semibold text-white" (click)="asking.set(null); remove(row)">{{ 'Directory.deleteYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold" (click)="asking.set(null)">{{ 'Directory.cancel' | t }}</button>
              } @else { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger/40 bg-surface px-4 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="asking.set(row.code)">{{ 'Directory.delete' | t }}</button> }
            }
          </div>
        </form>
      </ng-template>

      <section aria-labelledby="pl" class="flex flex-col gap-3"><h2 id="pl" class="text-xl font-bold">{{ 'AdminPriorities.list' | t }}</h2>
        @for (p of rows(); track p.code) {
          <details class="rounded-xl border border-line bg-surface shadow-card">
            <summary class="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 px-5 py-3 font-semibold">
              <span class="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold" [class]="tone(p.color)"><app-prio-icon [name]="p.icon" [color]="p.color" [size]="12" />{{ i18n.pick(p.nameEn, p.nameAr) }}</span>
              <span class="text-sm font-normal text-muted">{{ 'AdminPriorities.summary' | t: { first: p.firstResponseMinutes ?? 240, resolution: p.resolutionMinutes ?? 1440 } }}</span>
              @if (p.usedBy) { <span class="text-sm font-normal text-muted">{{ 'AdminPriorities.usedBy' | t: { count: p.usedBy } }}</span> }
              @if (!p.isActive) { <span class="text-sm font-normal text-muted">({{ 'AdminPriorities.inactive' | t }})</span> }
            </summary>
            <div class="flex flex-col gap-4 p-5">
              <ng-container *ngTemplateOutlet="form; context: { m: edit[p.code], id: 'p' + p.code, row: p }" />
              @if (p.isDefault) { <p class="text-sm text-muted">{{ 'AdminPriorities.defaultNote' | t }}</p> }
            </div>
          </details>
        }
        <details class="rounded-xl border border-line bg-surface shadow-card"><summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ 'AdminPriorities.addTitle' | t }}</summary>
          <div class="p-3"><ng-container *ngTemplateOutlet="form; context: { m: nw, id: 'pn', row: null }" /></div></details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminPrioritiesPage extends AdminBase implements OnInit {
  protected readonly colors = ['red', 'amber', 'blue', 'green', 'grey', 'light'];
  protected readonly icons = ['alert', 'arrow_up', 'minus', 'arrow_down', 'bolt', 'flag', 'clock', 'star'];
  protected readonly rows = signal<PrioRow[]>([]);
  protected readonly asking = signal<string | null>(null);
  protected readonly msgFor = signal<string | null>(null);
  protected readonly modeMsg = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected modeIn = 'system';
  protected nw: PrioModel = blankPrio();
  protected edit: Record<string, PrioModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<{ mode: string; priorities: PrioRow[] }>('priorities');
      for (const p of d.priorities) this.edit[p.code] = { nameEn: p.nameEn, nameAr: p.nameAr, color: p.color, icon: p.icon, sortOrder: p.sortOrder, isActive: p.isActive, firstResponseMinutes: p.firstResponseMinutes ?? 240, resolutionMinutes: p.resolutionMinutes ?? 1440 };
      this.modeIn = d.mode;
      this.nw.sortOrder = Math.min(1000, (d.priorities.at(-1)?.sortOrder ?? 0) + 10);
      this.rows.set(d.priorities);
    } catch (e) { this.fail(e); }
  }
  protected tone(c: string): string { return PRIORITY_TONE[c] ?? PRIORITY_TONE['grey']; }
  protected async setMode(m: string): Promise<void> {
    this.msgFor.set(null);
    const ok = await this.run(() => this.api.put('priorities-mode', { mode: m }));
    this.modeMsg.set(this.msg()); this.msg.set(null);
    void ok;
  }
  protected async create(): Promise<void> {
    this.msgFor.set('+');
    if (await this.run(() => this.api.post('priorities', this.nw))) this.nw = { ...blankPrio(), sortOrder: this.nw.sortOrder };
  }
  protected update(p: PrioRow): void { this.msgFor.set(p.code); void this.run(() => this.api.put('priorities/' + p.code, this.edit[p.code])); }
  protected remove(p: PrioRow): void { this.msgFor.set(p.code); void this.run(() => this.api.del('priorities/' + p.code), 'AdminV2.deleted'); }
}

// ================================================================== SLA, working hours, holidays

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
type DayModel = { open: boolean; from: string; to: string };
type HoursModel = { name: string; timezone: string; isDefault: boolean; days: Record<string, DayModel> };
const blankHours = (): HoursModel => ({ name: '', timezone: 'Africa/Cairo', isDefault: false, days: Object.fromEntries(DAYS.map((d) => [d, { open: !['fri', 'sat'].includes(d), from: '09:00', to: '17:00' }])) });

@Component({
  selector: 'app-admin-sla',
  imports: [TPipe, Alert, FormsModule, Req, PrioIcon, ReqNote, PageAbout],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <h1 class="text-3xl font-bold tracking-tight">{{ 'AdminSla.title' | t }}</h1>
      <app-page-about key="sla" tile="clock" [points]="['ticket', 'check', 'calendar', 'pause', 'bell', 'chart']" />
      <p role="status" class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminSla.testNotice' | t }}</p>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      <section aria-labelledby="pol" class="flex flex-col gap-4"><h2 id="pol" class="text-xl font-bold">{{ 'AdminSla.policies' | t }}</h2>
        @for (p of policies(); track p.priority) {
          @let m = pol[p.priority];
          <details class="rounded-xl border border-line bg-surface shadow-card">
            <summary class="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 px-5 py-3 font-semibold">
              <span class="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold" [class]="tone(p.color)"><app-prio-icon [name]="p.icon" [color]="p.color" [size]="12" />{{ i18n.pick(p.nameEn, p.nameAr) }}</span>
              <span class="text-sm font-normal text-muted">{{ 'AdminSla.policySummary' | t: { first: p.firstResponseMinutes, resolution: p.resolutionMinutes, warning: p.warningThresholdPct } }}</span>
            </summary>
            <form class="flex flex-col gap-4 border-t border-line p-5" novalidate (ngSubmit)="savePolicy(p)">
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.firstResponse' | t }}<app-req /></span><input name="fr" type="number" inputmode="numeric" min="1" [class]="cls.input + ' font-normal'" [(ngModel)]="m.firstResponseMinutes" /><span class="text-sm font-normal leading-snug text-muted">{{ 'AdminSla.firstResponseHint' | t }}</span></label>
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.resolution' | t }}<app-req /></span><input name="rs" type="number" inputmode="numeric" min="1" [class]="cls.input + ' font-normal'" [(ngModel)]="m.resolutionMinutes" /><span class="text-sm font-normal leading-snug text-muted">{{ 'AdminSla.resolutionHint' | t }}</span></label>
                <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.warning' | t }}<app-req /></span><input name="wn" type="number" inputmode="numeric" min="1" [class]="cls.input + ' font-normal'" [(ngModel)]="m.warningThresholdPct" /><span class="text-sm font-normal leading-snug text-muted">{{ 'AdminSla.warningHint' | t }}</span></label>
              </div>
              <label class="${CHECK}"><input type="checkbox" name="pc" class="h-5 w-5" [(ngModel)]="m.pauseOnPendingCustomer" />{{ 'AdminSla.pauseCustomer' | t }}</label>
              <label class="${CHECK}"><input type="checkbox" name="pi" class="h-5 w-5" [(ngModel)]="m.pauseOnPendingInternal" />{{ 'AdminSla.pauseInternal' | t }}</label>
              @for (ev of ['warnNotify', 'breachNotify']; track ev) {
                <fieldset class="flex flex-col gap-1"><legend class="text-sm font-semibold">{{ 'AdminSla.' + ev | t }}</legend>
                  <div class="flex flex-wrap gap-4">@for (r of roles; track r) {
                    <label class="${CHECK}"><input type="checkbox" class="h-5 w-5" [checked]="$any(m)[ev].includes(r)" (change)="toggle($any(m)[ev], r)" />{{ 'AdminSla.roles.' + r | t }}</label> }</div></fieldset>
              }
              <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.save' | t }}</button></div>
            </form>
          </details>
        }
      </section>

      <section aria-labelledby="cal" class="flex flex-col gap-3">
        <h2 id="cal" class="text-xl font-bold">{{ 'AdminSla.calendars.title' | t }}</h2>
        <p class="max-w-prose text-muted">{{ 'AdminSla.calendars.help' | t }}</p>
        <form class="flex flex-wrap items-end gap-3" novalidate (ngSubmit)="setDefault()">
          <label class="flex min-w-56 flex-col gap-1.5 text-sm font-semibold">{{ 'AdminSla.calendars.default' | t }}
            <select name="def" [class]="cls.input + ' font-normal'" [(ngModel)]="defIn">@for (h of hours(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }</select></label>
          <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.apply' | t }}</button>
        </form>
        @for (h of hours(); track h.id) {
          @let c = cal[h.id];
          @let tab = calTab[h.id] ?? 'week';
          <details class="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <summary class="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-3.5 bg-[#f7f9fd] px-5 py-3.5">
              <span aria-hidden="true" class="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
              <span class="min-w-48 flex-1">
                <span class="flex flex-wrap items-center gap-2 text-lg font-bold"><span dir="auto">{{ h.name }}</span>@if (h.isDefault) { <span [class]="cls.badgeOn">{{ 'AdminSla.calendars.isDefault' | t }}</span> }</span>
                <span class="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold text-muted">
                  <span class="rounded-md border border-line bg-surface px-2 py-0.5" dir="ltr">{{ h.timezone }}</span>
                  <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ workDays(h) }}</b> {{ 'AdminSla.calendars.statDays' | t }}</span>
                  <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ weekHours(h) }}</b> {{ 'AdminSla.calendars.statHours' | t }}</span>
                  <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ h.holidays.length }}</b> {{ 'AdminSla.calendars.statHol' | t }}</span>
                  <span class="rounded-md border border-line bg-surface px-2 py-0.5"><b class="text-ink">{{ usedBy(h.id) }}</b> {{ 'AdminSla.calendars.statUsed' | t }}</span>
                </span>
              </span>
            </summary>
            <div role="tablist" class="flex gap-1 overflow-x-auto border-y border-line px-5">
              @for (k of calTabs; track k) {
                <button type="button" role="tab" [attr.aria-selected]="tab === k" (click)="calTab[h.id] = k"
                  class="-mb-px inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-semibold"
                  [class]="tab === k ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">
                  {{ 'AdminSla.calendars.t_' + k | t }}@if (k === 'hol') { <span class="rounded-full bg-bg px-2 text-xs">{{ h.holidays.length }}</span> }</button>
              }
            </div>

            @if (tab === 'week') {
              <form class="flex flex-col gap-4 p-5" novalidate (ngSubmit)="saveHours(h)">
                <p class="text-sm font-bold">{{ 'AdminSla.calendars.weekStep1' | t }}</p>
                <div class="grid grid-cols-7 gap-1.5">
                  @for (d of days; track d) {
                    <button type="button" (click)="c.days[d].open = !c.days[d].open" [attr.aria-pressed]="c.days[d].open"
                      [attr.aria-label]="('AdminSla.days.' + d | t) + ': ' + ((c.days[d].open ? 'AdminSla.calendars.work' : 'AdminSla.calendars.weekend') | t)"
                      class="cursor-pointer rounded-lg border px-1 py-2 text-center"
                      [class]="c.days[d].open ? 'border-[#b9cff7] bg-brand-soft text-brand-ink' : 'border-line bg-[repeating-linear-gradient(135deg,#f4f6fa_0_6px,#eceff5_6px_12px)] text-muted'">
                      <b class="block text-sm">{{ dayShort(d) }}</b>
                      <span class="hidden text-[0.7rem] font-semibold sm:block">{{ (c.days[d].open ? 'AdminSla.calendars.work' : 'AdminSla.calendars.weekend') | t }}</span>
                    </button>
                  }
                </div>
                <p class="text-sm font-bold">{{ 'AdminSla.calendars.weekStep2' | t }}</p>
                <div class="flex flex-col gap-2">
                  @for (d of days; track d) {
                    @if (c.days[d].open) {
                      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                        <b class="w-28">{{ 'AdminSla.days.' + d | t }}</b>
                        <label class="flex items-center gap-2 text-sm">{{ 'AdminSla.from' | t }}<input type="time" [name]="d + 'f'" [class]="cls.input + ' w-32'" [ngModel]="c.days[d].from" (ngModelChange)="setTime(h.id, d, 'from', $event)" /></label>
                        <label class="flex items-center gap-2 text-sm">{{ 'AdminSla.to' | t }}<input type="time" [name]="d + 't'" [class]="cls.input + ' w-32'" [ngModel]="c.days[d].to" (ngModelChange)="setTime(h.id, d, 'to', $event)" /></label>
                      </div>
                    } @else {
                      <div class="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-[#f7f9fd] px-3 py-2.5 text-muted">
                        <b class="w-28">{{ 'AdminSla.days.' + d | t }}</b><span class="text-sm">{{ 'AdminSla.calendars.wkNote' | t }}</span>
                      </div>
                    }
                  }
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <label class="${CHECK} text-sm"><input type="checkbox" name="same" class="h-5 w-5" [(ngModel)]="same[h.id]" />{{ 'AdminSla.calendars.sameHours' | t }}</label>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.saveWeek' | t }}</button>
                </div>
              </form>
            }

            @if (tab === 'hol') {
              <div class="flex flex-col gap-4 p-5">
                <form class="grid grid-cols-1 items-end gap-3 rounded-xl border border-dashed border-line bg-[#fafcff] p-3.5 md:grid-cols-[auto_auto_1fr_auto]" novalidate (ngSubmit)="addHoliday(h)">
                  <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.hFrom' | t }}<app-req /></span><input type="date" name="hd" [class]="cls.input + ' w-full font-normal md:w-44'" [(ngModel)]="hol[h.id].date" /></label>
                  <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.hTo' | t }}</span><input type="date" name="ht" [min]="hol[h.id].date" [class]="cls.input + ' w-full font-normal md:w-44'" [(ngModel)]="hol[h.id].to" /></label>
                  <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.holidayName' | t }}<app-req /></span><input name="hn" maxlength="100" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="hol[h.id].name" /></label>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.addHoliday' | t }}</button>
                </form>
                <p class="flex flex-wrap items-center gap-3 text-sm text-muted">{{ 'AdminSla.calendars.rangeHint' | t }} <app-req-note /></p>
                @if (!h.holidays.length) { <p class="text-muted">{{ 'AdminSla.noHolidays' | t }}</p> } @else {
                  @for (g of holidayMonths(h); track g.month) {
                    <h3 class="mt-1 text-xs font-bold uppercase tracking-wider text-muted">{{ g.month }}</h3>
                    <ul class="flex flex-col gap-2">
                      @for (x of g.items; track x.id) {
                        <li class="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                          <span class="w-12 shrink-0 rounded-lg bg-warn-soft py-1 text-center leading-tight text-warn-ink"><b class="block text-lg">{{ x.day }}</b><span class="text-[0.68rem] font-bold uppercase">{{ x.mon }}</span></span>
                          <span class="min-w-0 flex-1"><b class="block" dir="auto">{{ x.name }}</b><span class="text-xs text-muted">{{ x.weekday }} · <span dir="ltr">{{ x.date }}</span></span></span>
                          <button type="button" [disabled]="busy()" (click)="remove('holidays/' + x.id)" class="min-h-11 cursor-pointer rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-60">{{ 'AdminSla.remove' | t }}<span class="sr-only"> {{ x.name }}</span></button>
                        </li>
                      }
                    </ul>
                  }
                }
              </div>
            }

            @if (tab === 'set') {
              <div class="flex flex-col gap-4 p-5">
                <form class="flex flex-col gap-4" novalidate (ngSubmit)="saveHours(h)">
                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.name' | t }}<app-req /></span><input name="nm" maxlength="80" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="c.name" /></label>
                    <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.timezone' | t }}<app-req /></span><input name="tz" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="c.timezone" /></label>
                  </div>
                  <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.save' | t }}</button><app-req-note /></div>
                </form>
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
                  <div class="max-w-prose"><b>{{ 'AdminSla.calendars.recalc' | t }}</b><p class="text-sm text-muted">{{ 'AdminSla.calendars.recalcHelp' | t }}</p></div>
                  <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="recalc(h)">{{ 'AdminSla.calendars.recalcShort' | t }}</button>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f1c7c3] bg-[#fffafa] p-4">
                  <div class="max-w-prose"><b>{{ 'AdminSla.calendars.delete' | t }}</b><p class="text-sm text-muted">{{ 'AdminSla.calendars.deleteHelp' | t }}</p></div>
                  <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('business-hours/' + h.id)">{{ 'AdminSla.calendars.delete' | t }}</button>
                </div>
              </div>
            }
          </details>
        }
        <form class="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-5 shadow-card" novalidate (ngSubmit)="createHours()">
          <label class="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.newName' | t }}<app-req /></span><input name="nn" maxlength="80" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="nwCal.name" /></label>
          <label class="flex min-w-56 flex-1 flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.timezone' | t }}<app-req /></span><input name="nz" dir="ltr" placeholder="Africa/Cairo" [class]="cls.input + ' font-normal'" [(ngModel)]="nwCal.timezone" /></label>
          <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.create' | t }}</button>
          <app-req-note />
        </form>
      </section>

      @if (asg(); as a) {
        <section aria-labelledby="asg" class="flex flex-col gap-3">
          <h2 id="asg" class="text-xl font-bold">{{ 'AdminSla.calendars.assignTitle' | t }}</h2>
          <div class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <p class="flex flex-wrap items-center gap-1.5 text-sm text-muted">{{ 'AdminSla.calendars.orderLbl' | t }}
              <span class="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-ink">{{ 'AdminSla.calendars.oBranch' | t }}</span><span aria-hidden="true" class="rtl:rotate-180">→</span>
              <span class="rounded-full bg-[#efe8fd] px-2.5 py-0.5 text-xs font-semibold text-[#5b3aa8]">{{ 'AdminSla.calendars.oOrg' | t }}</span><span aria-hidden="true" class="rtl:rotate-180">→</span>
              <span class="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-semibold text-warn-ink">{{ 'AdminSla.calendars.oTeam' | t }}</span><span aria-hidden="true" class="rtl:rotate-180">→</span>
              <span class="rounded-full bg-bg px-2.5 py-0.5 text-xs font-semibold text-muted">{{ 'AdminSla.calendars.oDefault' | t }}</span>
            </p>
            <form class="grid grid-cols-1 items-end gap-3 rounded-xl border border-dashed border-line bg-[#fafcff] p-3.5 md:grid-cols-[1.4fr_1fr_auto]" novalidate (ngSubmit)="applyPick()">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.where' | t }}<app-req /></span>
                <select name="where" [class]="cls.input + ' font-normal'" [ngModel]="where" (ngModelChange)="pickWhere($event)">
                  <option value="" disabled>{{ 'AdminSla.calendars.chooseWhere' | t }}</option>
                  <optgroup [label]="'AdminSla.calendars.grpOrgs' | t">
                    @for (o of a.organizations; track o.id) {
                      <option [value]="'organization:' + o.id">{{ o.name }} {{ 'AdminSla.calendars.allBranches' | t }}</option>
                      @for (b of branchesIn(o.id); track b.id) { <option [value]="'branch:' + b.id">&#x2003;↳ {{ b.name }}</option> }
                    }
                  </optgroup>
                  @if (a.teams.length) {
                    <optgroup [label]="'AdminSla.calendars.grpTeams' | t">
                      @for (tm of a.teams; track tm.id) { <option [value]="'team:' + tm.id">{{ i18n.pick(tm.nameEn, tm.nameAr) }}</option> }
                    </optgroup>
                  }
                </select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminSla.calendars.calendar' | t }}
                <select name="calPick" [class]="cls.input + ' font-normal'" [(ngModel)]="calPick"><option value="">{{ 'AdminSla.calendars.followDefault' | t }}</option>@for (h of hours(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }</select></label>
              <button type="submit" [class]="cls.btn" [disabled]="busy() || !where">{{ 'AdminSla.calendars.apply' | t }}</button>
            </form>
            <div>
              <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2"><b>{{ 'AdminSla.calendars.excTitle' | t }}</b><span class="text-sm text-muted">{{ 'AdminSla.calendars.excHint' | t: { name: calName(null) } }}</span></div>
              @if (!exceptions().length) { <p class="rounded-lg border border-dashed border-line p-4 text-sm text-muted">{{ 'AdminSla.calendars.noExceptions' | t }}</p> } @else {
                <div class="overflow-x-auto rounded-xl border border-line">
                  <table class="w-full text-sm">
                    <caption class="sr-only">{{ 'AdminSla.calendars.excTitle' | t }}</caption>
                    <thead class="bg-[#f7f9fd] text-start text-xs uppercase tracking-wider text-muted">
                      <tr><th scope="col" class="px-3 py-2.5 text-start font-bold">{{ 'AdminSla.calendars.thWhere' | t }}</th><th scope="col" class="px-3 py-2.5 text-start font-bold">{{ 'AdminSla.calendars.calendar' | t }}</th><th scope="col" class="hidden px-3 py-2.5 text-start font-bold sm:table-cell">{{ 'AdminSla.calendars.thTz' | t }}</th><th scope="col" class="px-3 py-2.5"><span class="sr-only">{{ 'AdminSla.calendars.backDefault' | t }}</span></th></tr>
                    </thead>
                    <tbody>
                      @for (x of exceptions(); track x.kind + x.id) {
                        <tr class="border-t border-line hover:bg-[#f9fbfe]">
                          <td class="px-3 py-2.5">
                            <span class="mb-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold" [class]="x.kind === 'branch' ? 'bg-brand-soft text-brand-ink' : x.kind === 'organization' ? 'bg-[#efe8fd] text-[#5b3aa8]' : 'bg-warn-soft text-warn-ink'">{{ 'AdminSla.calendars.k_' + x.kind | t }}</span>
                            <b class="block" dir="auto">{{ x.name }}</b>
                            @if (x.kind === 'branch') { <span class="block text-xs text-muted">{{ 'AdminSla.calendars.inOrg' | t: { org: x.org } }}</span> }
                            @if (x.kind === 'organization') { <span class="block text-xs text-muted">{{ 'AdminSla.calendars.orgNote' | t }}</span> }
                          </td>
                          <td class="px-3 py-2.5 font-semibold" dir="auto">{{ calName(x.cal) }}</td>
                          <td class="hidden px-3 py-2.5 text-muted sm:table-cell" dir="ltr">{{ calZone(x.cal) }}</td>
                          <td class="px-3 py-2.5 text-end"><button type="button" [disabled]="busy()" (click)="assign(x.kind, x.id, '')" class="min-h-11 cursor-pointer rounded-lg px-3 font-semibold text-muted hover:bg-bg disabled:opacity-60">{{ 'AdminSla.calendars.backDefault' | t }}<span class="sr-only"> {{ x.name }}</span></button></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          </div>
        </section>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminSlaPage extends AdminBase implements OnInit {
  protected readonly calTabs = ['week', 'hol', 'set'] as const;
  protected calTab: Record<string, 'week' | 'hol' | 'set'> = {};
  /** "Use the same hours for every working day", per calendar. */
  protected same: Record<string, boolean> = {};
  protected where = '';
  protected calPick = '';
  protected defIn = '';
  protected readonly days = DAYS;
  protected readonly roles = ['agent', 'team_leader', 'admin'];
  protected readonly policies = signal<SlaRow[]>([]);
  protected readonly hours = signal<HoursRow[]>([]);
  protected pol: Record<string, SlaRow> = {};
  protected cal: Record<string, HoursModel> = {};
  protected hol: Record<string, { date: string; to: string; name: string }> = {};
  protected nwCal: HoursModel = blankHours();
  protected readonly asg = signal<{ organizations: { id: string; name: string; businessHoursId: string | null }[];
    branches: { id: string; organizationId: string; name: string; businessHoursId: string | null }[];
    teams: { id: string; nameEn: string; nameAr: string; businessHoursId: string | null }[] } | null>(null);

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected tone(c: string): string { return PRIORITY_TONE[c] ?? PRIORITY_TONE['grey']; }
  private async loadAssignments(): Promise<void> {
    try {
      const a = await this.api.get<NonNullable<ReturnType<typeof this.asg>>>('calendar-assignments');
      // v1 order (database collation): "Al-Qalyubia" before "Alex"
      a.organizations.sort((x, y) => x.name.localeCompare(y.name));
      a.branches.sort((x, y) => x.name.localeCompare(y.name));
      a.teams.sort((x, y) => x.nameEn.localeCompare(y.nameEn));
      this.asg.set(a);
      if (this.where) this.calPick = this.currentOf(this.where);
    } catch { /* optional */ }
  }
  /** v1 DefaultCalendar: the chosen calendar becomes the default and every priority target follows it. */
  protected setDefault(): void {
    const id = this.defIn; const h = this.hours().find((x) => x.id === id); if (!h) return;
    void this.run(async () => {
      await this.api.put('business-hours/' + id, { ...this.hoursBody(this.cal[id]), isDefault: true });
      for (const p of this.policies()) await this.api.put('sla/' + p.priority, this.policyBody({ ...this.pol[p.priority], businessHoursId: id }));
    });
  }
  protected branchesIn(org: string) { return (this.asg()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected async assign(kind: string, id: string, cal: string): Promise<void> {
    await this.run(() => this.api.put('calendar-assignments', { kind, id, calendarId: cal || null }));
  }
  /** The place picked in "Organization, branch or team": "organization:<id>", "branch:<id>" or "team:<id>". */
  protected pickWhere(v: string): void { this.where = v; this.calPick = this.currentOf(v); }
  protected applyPick(): void {
    const [kind, id] = this.where.split(':');
    if (kind && id) void this.assign(kind, id, this.calPick);
  }
  private currentOf(v: string): string {
    const [kind, id] = v.split(':'); const a = this.asg();
    const list: { id: string; businessHoursId: string | null }[] = !a ? [] : kind === 'organization' ? a.organizations : kind === 'branch' ? a.branches : a.teams;
    return list.find((x) => x.id === id)?.businessHoursId ?? '';
  }
  /** Places that do not follow the default calendar. */
  protected readonly exceptions = computed(() => {
    const a = this.asg(); if (!a) return [];
    const orgName = (id: string) => a.organizations.find((o) => o.id === id)?.name ?? '';
    return [
      ...a.organizations.filter((o) => o.businessHoursId).map((o) => ({ kind: 'organization', id: o.id, name: o.name, org: '', cal: o.businessHoursId })),
      ...a.branches.filter((b) => b.businessHoursId).map((b) => ({ kind: 'branch', id: b.id, name: b.name, org: orgName(b.organizationId), cal: b.businessHoursId })),
      ...a.teams.filter((t) => t.businessHoursId).map((t) => ({ kind: 'team', id: t.id, name: this.i18n.pick(t.nameEn, t.nameAr), org: '', cal: t.businessHoursId })),
    ];
  });
  protected calZone(id: string | null): string { return this.hours().find((h) => h.id === id)?.timezone ?? ''; }
  protected usedBy(id: string): number { return this.exceptions().filter((x) => x.cal === id).length; }
  protected workDays(h: HoursRow): number { return DAYS.filter((d) => h.schedule[d]?.length).length; }
  protected weekHours(h: HoursRow): number {
    const mins = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0); };
    let total = 0;
    for (const d of DAYS) for (const w of h.schedule[d] ?? []) total += Math.max(0, mins(w[1]) - mins(w[0]));
    return Math.round(total / 6) / 10;
  }
  protected dayShort(d: string): string {
    const i = DAYS.indexOf(d);   // 1 January 2023 was a Sunday
    return new Intl.DateTimeFormat(this.i18n.locale() === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short' }).format(new Date(2023, 0, 1 + i));
  }
  /** Changing one day's hours copies them to every working day while "same hours" is ticked. */
  protected setTime(id: string, d: string, which: 'from' | 'to', v: string): void {
    const c = this.cal[id];
    c.days[d][which] = v;
    if (this.same[id]) for (const x of DAYS) if (c.days[x].open) c.days[x][which] = v;
  }
  protected holidayMonths(h: HoursRow) {
    const loc = this.i18n.locale() === 'ar' ? 'ar-EG' : 'en-GB';
    const fm = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' });
    const fs = new Intl.DateTimeFormat(loc, { month: 'short' });
    const fw = new Intl.DateTimeFormat(loc, { weekday: 'long' });
    const groups: { month: string; items: { id: string; date: string; name: string; day: number; mon: string; weekday: string }[] }[] = [];
    for (const x of [...h.holidays].sort((a, b) => a.date.localeCompare(b.date))) {
      const dt = new Date(x.date.slice(0, 10) + 'T12:00:00');
      const month = fm.format(dt);
      let g = groups.at(-1);
      if (!g || g.month !== month) { g = { month, items: [] }; groups.push(g); }
      g.items.push({ id: x.id, date: x.date.slice(0, 10), name: x.name, day: dt.getDate(), mon: fs.format(dt), weekday: fw.format(dt) });
    }
    return groups;
  }
  protected async recalc(h: HoursRow): Promise<void> {
    let n = 0;
    await this.run(async () => { n = (await this.api.post<{ count: number }>(`business-hours/${h.id}/recalculate`, {})).count; });
    if (this.msg()?.tone === 'success') this.ok('AdminSla.calendars.recalcDone', { count: n });
  }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<{ policies: SlaRow[]; hours: HoursRow[] }>('sla');
      const def = d.hours.find((h) => h.isDefault)?.id ?? null;
      for (const p of d.policies) this.pol[p.priority] = { ...p, businessHoursId: p.businessHoursId ?? def, warnNotify: [...p.warnNotify], breachNotify: [...p.breachNotify] };
      for (const h of d.hours) {
        this.cal[h.id] = {
          name: h.name, timezone: h.timezone, isDefault: h.isDefault,
          days: Object.fromEntries(DAYS.map((day) => { const w = h.schedule[day]?.[0]; return [day, { open: !!w, from: w?.[0] ?? '09:00', to: w?.[1] ?? '17:00' }]; })),
        };
        this.hol[h.id] ??= { date: '', to: '', name: '' };
        const open = DAYS.map((x) => h.schedule[x]?.[0]).filter((w) => !!w);
        this.same[h.id] ??= open.length > 0 && open.every((w) => w[0] === open[0][0] && w[1] === open[0][1]);
      }
      this.policies.set(d.policies.filter((p) => p.hasPolicy));
      this.hours.set(d.hours);
      this.defIn = d.hours.find((h) => h.isDefault)?.id ?? d.hours[0]?.id ?? '';
      await this.loadAssignments();
    } catch (e) { this.fail(e); }
  }
  protected calName(id: string | null): string { return this.hours().find((h) => h.id === id)?.name ?? this.hours().find((h) => h.isDefault)?.name ?? ''; }
  protected toggle(list: string[], v: string): void { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }
  protected savePolicy(p: SlaRow): void {
    void this.run(() => this.api.put('sla/' + p.priority, this.policyBody(this.pol[p.priority])), 'AdminSla.saved');
  }
  private policyBody(m: SlaRow) {
    return {
      firstResponseMinutes: Number(m.firstResponseMinutes), resolutionMinutes: Number(m.resolutionMinutes), warningThresholdPct: Number(m.warningThresholdPct),
      pauseOnPendingCustomer: m.pauseOnPendingCustomer, pauseOnPendingInternal: m.pauseOnPendingInternal, businessHoursId: m.businessHoursId,
      warnNotify: m.warnNotify, breachNotify: m.breachNotify,
    };
  }
  private hoursBody(m: HoursModel) {
    return { name: m.name, timezone: m.timezone, isDefault: m.isDefault, schedule: Object.fromEntries(DAYS.map((d) => [d, m.days[d].open ? [[m.days[d].from, m.days[d].to]] : []])) };
  }
  protected saveHours(h: HoursRow): void { void this.run(() => this.api.put('business-hours/' + h.id, this.hoursBody(this.cal[h.id])), 'AdminSla.saved'); }
  protected async createHours(): Promise<void> {
    if (await this.run(() => this.api.post('business-hours', this.hoursBody(this.nwCal)))) this.nwCal = blankHours();
  }
  /** One holiday per day from From to To (To is optional); days already listed are skipped. At most 31 days at once. */
  protected async addHoliday(h: HoursRow): Promise<void> {
    const f = this.hol[h.id];
    const dates: string[] = [];
    if (f.to && f.date && f.to > f.date) {
      const end = new Date(f.to + 'T12:00:00');
      for (let d = new Date(f.date + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
        const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!h.holidays.some((x) => x.date.slice(0, 10) === s)) dates.push(s);
        if (dates.length > 31) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminSla.calendars.rangeTooLong') }); return; }
      }
      if (!dates.length) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminSla.errors.duplicate') }); return; }
    } else dates.push(f.date);
    const done = await this.run(async () => { for (const date of dates) await this.api.post(`business-hours/${h.id}/holidays`, { date, name: f.name }); },
      dates.length > 1 ? 'AdminSla.calendars.addedRange' : 'AdminCommon.saved', { count: dates.length });
    if (done) this.hol[h.id] = { date: '', to: '', name: '' };
  }
  protected remove(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
