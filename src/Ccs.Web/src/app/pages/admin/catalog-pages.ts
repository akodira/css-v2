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
interface TypeRow { id: string; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; sortOrder: number; isActive: boolean; categoryIds: string[]; tickets: number }
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
const blankType = (): TypeModel => ({ nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', examplesEn: '', examplesAr: '', sortOrder: 0, isActive: true, categoryIds: [] });

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

      <ul class="flex flex-col gap-3">
        @for (t of data()?.types ?? []; track t.id) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(t.nameEn, t.nameAr) }}</span>
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
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

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
                  <td class="px-2 py-3 font-semibold" dir="auto">{{ i18n.pick(r.nameEn, r.nameAr) }}<span class="block text-xs font-normal text-muted" [attr.dir]="i18n.locale() === 'ar' ? 'ltr' : 'rtl'">{{ i18n.locale() === 'ar' ? r.nameEn : r.nameAr }}</span></td>
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
            </form></div>
          </details>
        }
        <details class="rounded-md border border-line bg-surface" #addf><summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ 'AdminCatalog.addField' | t }}</summary>
          <div class="p-3"><form [class]="formCls" novalidate (ngSubmit)="createField(addf)">
            <ng-container *ngTemplateOutlet="fieldForm; context: { m: nwField, id: 'nf', locked: false, isNew: true }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addField' | t }}</button></div>
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
      for (const t of d.types) this.editTypeM[t.id] = { nameEn: t.nameEn, nameAr: t.nameAr, descriptionEn: t.descriptionEn, descriptionAr: t.descriptionAr, examplesEn: t.examplesEn, examplesAr: t.examplesAr, sortOrder: t.sortOrder, isActive: t.isActive, categoryIds: [...t.categoryIds] };
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
  protected async createField(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('fields', fieldBody(this.nwField)))) { this.nwField = blankField(); box.open = false; }
  }
  protected updateField(f: FieldRow): void { void this.run(() => this.api.put('fields/' + f.id, fieldBody(this.editField[f.id]))); }
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
  imports: [TPipe, Alert, FormsModule, Req, PrioIcon, ReqNote],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminSla.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminSla.subtitle' | t }}</p></div>
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
          <details class="rounded-xl border border-line bg-surface shadow-card">
            <summary class="min-h-11 cursor-pointer px-5 py-3 font-semibold">{{ 'AdminSla.calendars.summary' | t: { name: h.name, zone: h.timezone, count: h.holidays.length } }}</summary>
            <div class="border-t border-line">
              <div class="flex flex-col gap-4 border-b border-line p-5">
                <form class="flex flex-wrap items-end gap-3" novalidate (ngSubmit)="saveHours(h)">
                  <label class="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.calendars.name' | t }}<app-req /></span><input name="nm" maxlength="80" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="c.name" /></label>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.rename' | t }}</button>
                </form>
                <div class="flex flex-col gap-2">
                  <p class="text-sm text-muted">{{ 'AdminSla.calendars.recalcHelp' | t }}</p>
                  <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="recalc(h)">{{ 'AdminSla.calendars.recalc' | t }}</button></div>
                </div>
                <div class="flex flex-col gap-2">
                  <p class="text-sm text-muted">{{ 'AdminSla.calendars.deleteHelp' | t }}</p>
                  <div><button type="button" [disabled]="busy()" (click)="remove('business-hours/' + h.id)" class="min-h-11 cursor-pointer rounded-lg border border-danger px-4 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60">{{ 'AdminSla.calendars.delete' | t }}</button></div>
                </div>
              </div>
              <div class="p-1">
                <form class="flex flex-col gap-4 rounded-md border border-line bg-surface p-5" novalidate (ngSubmit)="saveHours(h)">
                  <label class="flex max-w-sm flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.timezone' | t }}<app-req /></span><input name="tz" dir="ltr" [class]="cls.input + ' font-normal'" [(ngModel)]="c.timezone" /></label>
                  <div class="flex flex-col gap-3">
                    @for (d of days; track d) {
                      <div class="flex flex-wrap items-center gap-3">
                        <label class="flex min-h-11 w-40 items-center gap-2 font-semibold"><input type="checkbox" [name]="d + 'o'" class="h-5 w-5" [(ngModel)]="c.days[d].open" />{{ 'AdminSla.days.' + d | t }}</label>
                        <label class="flex items-center gap-2 text-sm">{{ 'AdminSla.from' | t }}<input type="time" [name]="d + 'f'" [class]="cls.input + ' w-32'" [(ngModel)]="c.days[d].from" /></label>
                        <label class="flex items-center gap-2 text-sm">{{ 'AdminSla.to' | t }}<input type="time" [name]="d + 't'" [class]="cls.input + ' w-32'" [(ngModel)]="c.days[d].to" /></label>
                      </div>
                    }
                  </div>
                  <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.save' | t }}</button></div>
                </form>
              </div>
              <div class="flex flex-col gap-4 border-t border-line p-5">
                <h3 class="font-bold">{{ 'AdminSla.holidays' | t }}</h3>
                @if (!h.holidays.length) { <p class="text-muted">{{ 'AdminSla.noHolidays' | t }}</p> } @else {
                  <ul class="flex flex-col gap-2">
                    @for (x of h.holidays; track x.id) {
                      <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                        <span><span class="font-semibold" dir="ltr">{{ x.date }}</span>{{ ' ' }}<span dir="auto">{{ x.name }}</span></span>
                        <button type="button" [disabled]="busy()" (click)="remove('holidays/' + x.id)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg disabled:opacity-60">{{ 'AdminSla.remove' | t }}<span class="sr-only"> {{ x.name }}</span></button>
                      </li>
                    }
                  </ul>
                }
                <form class="flex flex-wrap items-end gap-3" novalidate (ngSubmit)="addHoliday(h)">
                  <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.date' | t }}<app-req /></span><input type="date" name="hd" [class]="cls.input + ' w-44 font-normal'" [(ngModel)]="hol[h.id].date" /></label>
                  <label class="flex flex-1 flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminSla.holidayName' | t }}<app-req /></span><input name="hn" maxlength="100" dir="auto" [class]="cls.input + ' font-normal'" [(ngModel)]="hol[h.id].name" /></label>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.addHoliday' | t }}</button>
                </form>
              </div>
            </div>
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
          <p class="max-w-prose text-muted">{{ 'AdminSla.calendars.assignHelp' | t }}</p>
          <div class="flex flex-col gap-2">
            @for (o of a.organizations; track o.id) {
              <div class="flex flex-col gap-2">
                <form class="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" (ngSubmit)="assign('organization', o.id, pick['o' + o.id])">
                  <span class="min-w-48 flex-1 font-semibold" dir="auto">{{ o.name }}</span>
                  <select [name]="'o' + o.id" [attr.aria-label]="o.name" [class]="cls.input + ' w-56'" [(ngModel)]="pick['o' + o.id]"><option value="">{{ 'AdminSla.calendars.followDefault' | t }}</option>@for (h of hours(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }</select>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.apply' | t }}</button>
                  @if (applied() === 'o' + o.id) { <span role="status" class="text-sm font-medium text-ok">{{ 'AdminSla.calendars.applied' | t }}</span> }
                </form>
                @for (b of branchesIn(o.id); track b.id) {
                  <form class="ms-6 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" (ngSubmit)="assign('branch', b.id, pick['b' + b.id])">
                    <span class="min-w-48 flex-1 font-semibold" dir="auto">{{ b.name }}</span>
                    <select [name]="'b' + b.id" [attr.aria-label]="b.name" [class]="cls.input + ' w-56'" [(ngModel)]="pick['b' + b.id]"><option value="">{{ 'AdminSla.calendars.followDefault' | t }}</option>@for (h of hours(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }</select>
                    <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.apply' | t }}</button>
                    @if (applied() === 'b' + b.id) { <span role="status" class="text-sm font-medium text-ok">{{ 'AdminSla.calendars.applied' | t }}</span> }
                  </form>
                }
              </div>
            }
            @for (tm of a.teams; track tm.id) {
              <form class="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" (ngSubmit)="assign('team', tm.id, pick['t' + tm.id])">
                <span class="min-w-48 flex-1 font-semibold" dir="auto">{{ i18n.pick(tm.nameEn, tm.nameAr) }}</span>
                <select [name]="'t' + tm.id" [attr.aria-label]="i18n.pick(tm.nameEn, tm.nameAr)" [class]="cls.input + ' w-56'" [(ngModel)]="pick['t' + tm.id]"><option value="">{{ 'AdminSla.calendars.followDefault' | t }}</option>@for (h of hours(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }</select>
                <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.calendars.apply' | t }}</button>
                @if (applied() === 't' + tm.id) { <span role="status" class="text-sm font-medium text-ok">{{ 'AdminSla.calendars.applied' | t }}</span> }
              </form>
            }
          </div>
        </section>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminSlaPage extends AdminBase implements OnInit {
  protected readonly applied = signal<string | null>(null);
  protected pick: Record<string, string> = {};
  protected defIn = '';
  protected readonly days = DAYS;
  protected readonly roles = ['agent', 'team_leader', 'admin'];
  protected readonly policies = signal<SlaRow[]>([]);
  protected readonly hours = signal<HoursRow[]>([]);
  protected pol: Record<string, SlaRow> = {};
  protected cal: Record<string, HoursModel> = {};
  protected hol: Record<string, { date: string; name: string }> = {};
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
      for (const o of a.organizations) this.pick['o' + o.id] = o.businessHoursId ?? '';
      for (const b of a.branches) this.pick['b' + b.id] = b.businessHoursId ?? '';
      for (const t of a.teams) this.pick['t' + t.id] = t.businessHoursId ?? '';
      this.asg.set(a);
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
    this.applied.set(null);
    if (await this.run(() => this.api.put('calendar-assignments', { kind, id, calendarId: cal || null }))) { this.msg.set(null); this.applied.set(kind[0] + id); }
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
        this.hol[h.id] ??= { date: '', name: '' };
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
  protected async addHoliday(h: HoursRow): Promise<void> {
    if (await this.run(() => this.api.post(`business-hours/${h.id}/holidays`, this.hol[h.id]))) this.hol[h.id] = { date: '', name: '' };
  }
  protected remove(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
