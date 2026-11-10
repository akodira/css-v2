import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TPipe } from '../../core/i18n';
import { Alert, Req } from '../../shared/ui';
import { AdminBase, HEADER, SEARCH } from './admin-pages';

// ---- contracts (CatalogAdminController) --------------------------------------------------------

interface TeamOpt { id: string; nameEn: string; nameAr: string; isActive: boolean }
interface PrioOpt { code: string; nameEn: string; nameAr: string; color: string; isActive: boolean }
interface TypeRow { id: string; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; sortOrder: number; isActive: boolean; categoryIds: string[]; tickets: number }
interface SubRow { id: string; categoryId: string; nameEn: string; nameAr: string; isActive: boolean; sortOrder: number; priorityCode: string | null; tickets: number }
interface CatRow { id: string; nameEn: string; nameAr: string; defaultTeamId: string | null; isActive: boolean; sortOrder: number; priorityCode: string | null; isPrivate: boolean; autoAssign: boolean; typeIds: string[]; tickets: number; subcategories: SubRow[] }
interface FieldRow { id: string; key: string; labelEn: string; labelAr: string; type: string; options: string; isRequired: boolean; validation: string; visibleToCustomer: boolean; categoryId: string | null; isActive: boolean; sortOrder: number; hasValues: boolean }
interface CatalogData { types: TypeRow[]; categories: CatRow[]; fields: FieldRow[]; teams: TeamOpt[]; priorities: PrioOpt[] }

interface PrioRow { code: string; nameEn: string; nameAr: string; color: string; icon: string; sortOrder: number; isActive: boolean; firstResponseMinutes: number | null; resolutionMinutes: number | null; usedBy: number; tickets: number; isDefault: boolean }
interface SlaRow { priority: string; nameEn: string; nameAr: string; color: string; isActive: boolean; firstResponseMinutes: number; resolutionMinutes: number; warningThresholdPct: number; pauseOnPendingCustomer: boolean; pauseOnPendingInternal: boolean; businessHoursId: string | null; warnNotify: string[]; breachNotify: string[]; hasPolicy: boolean }
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
          <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'Directory.nameEn' | t }}<app-req /></label>
            <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'Directory.nameAr' | t }}<app-req /></label>
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
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}

      <!-- shared form parts -->
      <ng-template #names let-m="m" let-id="id">
        <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'AdminCatalog.nameEn' | t }}<app-req /></label>
          <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
        <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'AdminCatalog.nameAr' | t }}<app-req /></label>
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
        <p class="mt-2 text-sm text-muted">{{ 'AdminCatalog.isPrivateHint' | t }} {{ 'AdminCatalog.autoAssignHint' | t }}</p>
        @if (data()?.types?.length) {
          <fieldset class="mt-3"><legend [class]="cls.label">{{ 'TicketTypes.label' | t }}</legend>
            <div class="mt-1 flex flex-wrap gap-x-6">
              @for (ty of data()!.types; track ty.id) {
                <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="m.typeIds.includes(ty.id)" (change)="toggle(m.typeIds, ty.id)" /> <span dir="auto">{{ i18n.pick(ty.nameEn, ty.nameAr) }}</span></label>
              }
            </div></fieldset>
        }
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
          <div class="flex flex-col gap-1.5"><label [for]="id + 'k'" [class]="cls.label">{{ 'AdminCatalog.fieldKey' | t }}<app-req /></label>
            <input [id]="id + 'k'" [name]="id + 'k'" dir="ltr" required maxlength="41" pattern="[a-z][a-z0-9_]{1,40}" [class]="cls.input" [(ngModel)]="m.key" [readonly]="!isNew" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ty'" [class]="cls.label">{{ 'AdminCatalog.fieldType' | t }}</label>
            <select [id]="id + 'ty'" [name]="id + 'ty'" [class]="cls.input" [(ngModel)]="m.type" [disabled]="locked">
              @for (ft of fieldTypes; track ft) { <option [value]="ft">{{ 'CustomFields.types.' + ft | t }}</option> }
            </select>
            @if (locked) { <p class="text-sm text-muted">{{ 'AdminCommon.errors.typeLocked' | t }}</p> }</div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'le'" [class]="cls.label">{{ 'AdminCatalog.nameEn' | t }}<app-req /></label>
            <input [id]="id + 'le'" [name]="id + 'le'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.labelEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'la'" [class]="cls.label">{{ 'AdminCatalog.nameAr' | t }}<app-req /></label>
            <input [id]="id + 'la'" [name]="id + 'la'" dir="rtl" required maxlength="120" [class]="cls.input" [(ngModel)]="m.labelAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ca'" [class]="cls.label">{{ 'AdminCatalog.appliesTo' | t }}</label>
            <select [id]="id + 'ca'" [name]="id + 'ca'" [class]="cls.input" [(ngModel)]="m.categoryId">
              <option [ngValue]="null">{{ 'AdminCatalog.allCategories' | t }}</option>
              @for (c of data()?.categories ?? []; track c.id) { <option [ngValue]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          @if (m.type === 'dropdown' || m.type === 'multi_select' || m.type === 'radio') {
            <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'op'" [class]="cls.label">{{ 'AdminCatalog.options' | t }}<app-req /></label>
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

      <!-- categories -->
      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminCatalog.categories' | t }}</h2>
        <details [class]="cls.card" #addc>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminCatalog.addCategoryBtn' | t }}</span></summary>
          <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="createCat(addc)">
            <ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'nc' }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </details>
        ${SEARCH}
        <ul class="flex flex-col gap-3">
          @for (c of cats(); track c.id) {
            <li><details [class]="cls.card">
              <summary [class]="cls.summary">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-lg font-bold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span>
                  <span [class]="c.isActive ? cls.badgeOn : cls.badgeOff">{{ (c.isActive ? 'AdminCatalog.on' : 'AdminCatalog.off') | t }}</span>
                  @if (c.isPrivate) { <span [class]="cls.badgeWarn">{{ 'AdminCatalog.typePrivate' | t }}</span> }
                </span>
                <span class="mt-0.5 block text-sm text-muted">
                  {{ 'AdminCatalog.colTeam' | t }}: {{ teamName2(c.defaultTeamId) || '-' }}
                  · {{ 'AdminCatalog.colPriority' | t }}: {{ prioName(c.priorityCode) || ('AdminCatalog.noFixedPriorityShort' | t) }}
                  · {{ 'AdminCatalog.colSubs' | t }}: {{ c.subcategories.length }} · {{ 'AdminCatalog.colTickets' | t }}: {{ c.tickets }}
                </span>
              </summary>
              <div class="flex flex-col gap-5 px-5 pb-5">
                <form class="flex flex-col gap-4" (ngSubmit)="updateCat(c)">
                  <ng-container *ngTemplateOutlet="catForm; context: { m: editCat[c.id], id: 'c' + c.id }" />
                  <div class="flex flex-wrap gap-2">
                    <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                    @if (!c.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('categories/' + c.id)">{{ 'Directory.delete' | t }}</button> }
                  </div>
                </form>
                <section class="border-t border-line pt-4">
                  <h3 class="text-lg font-bold">{{ 'AdminCatalog.subcategories' | t }}</h3>
                  @if (!c.subcategories.length) { <p class="mt-1 text-sm text-muted">{{ 'AdminCatalog.noSubs' | t }}</p> }
                  <ul class="mt-2 flex flex-col gap-2">
                    @for (s of c.subcategories; track s.id) {
                      <li><details class="rounded-lg border border-line">
                        <summary class="cursor-pointer px-4 py-3"><span class="font-semibold" dir="auto">{{ i18n.pick(s.nameEn, s.nameAr) }}</span>
                          <span class="text-sm text-muted"> · {{ prioName(s.priorityCode) || ('AdminCatalog.inheritsPriority' | t) }} · {{ 'AdminCatalog.colTickets' | t }}: {{ s.tickets }}</span>
                          @if (!s.isActive) { <span [class]="cls.badgeOff + ' ms-2'">{{ 'AdminCatalog.inactive' | t }}</span> }</summary>
                        <form class="flex flex-col gap-4 px-4 pb-4" (ngSubmit)="updateSub(s)">
                          <ng-container *ngTemplateOutlet="subForm; context: { m: editSub[s.id], id: 's' + s.id }" />
                          <div class="flex flex-wrap gap-2">
                            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                            @if (!s.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('subcategories/' + s.id)">{{ 'Directory.delete' | t }}</button> }
                          </div>
                        </form>
                      </details></li>
                    }
                  </ul>
                  <details class="mt-3 rounded-lg border border-dashed border-line" #adds>
                    <summary class="cursor-pointer px-4 py-3 font-semibold text-brand-ink">{{ 'AdminCatalog.addSubcategoryBtn' | t }}</summary>
                    <form class="flex flex-col gap-4 px-4 pb-4" (ngSubmit)="createSub(c, adds)">
                      <ng-container *ngTemplateOutlet="subForm; context: { m: nwSub(c.id), id: 'ns' + c.id }" />
                      <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
                    </form>
                  </details>
                </section>
              </div>
            </details></li>
          }
        </ul>
      </section>

      <!-- custom fields -->
      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminCatalog.fields' | t }}</h2>
        <p class="text-muted">{{ 'AdminCatalog.fieldsHint' | t }}</p>
        <details [class]="cls.card" #addf>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminCatalog.addField' | t }}</span></summary>
          <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="createField(addf)">
            <ng-container *ngTemplateOutlet="fieldForm; context: { m: nwField, id: 'nf', locked: false, isNew: true }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </details>
        <ul class="flex flex-col gap-3">
          @for (f of data()?.fields ?? []; track f.id) {
            <li><details [class]="cls.card">
              <summary [class]="cls.summary">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-lg font-bold" dir="auto">{{ i18n.pick(f.labelEn, f.labelAr) }}</span>
                  <span class="text-sm font-mono text-muted" dir="ltr">{{ f.key }}</span>
                  <span [class]="f.isActive ? cls.badgeOn : cls.badgeOff">{{ (f.isActive ? 'AdminCatalog.on' : 'AdminCatalog.off') | t }}</span>
                  @if (!f.visibleToCustomer) { <span [class]="cls.badgeWarn">{{ 'AdminCatalog.staffOnly' | t }}</span> }
                </span>
                <span class="mt-0.5 block text-sm text-muted">{{ 'CustomFields.types.' + f.type | t }} · {{ f.categoryId ? catName(f.categoryId) : ('AdminCatalog.allCategories' | t) }}@if (f.isRequired) { · {{ 'AdminCatalog.required' | t }} }</span>
              </summary>
              <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="updateField(f)">
                <ng-container *ngTemplateOutlet="fieldForm; context: { m: editField[f.id], id: 'f' + f.id, locked: f.hasValues, isNew: false }" />
                <div class="flex flex-wrap gap-2">
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                  @if (!f.hasValues) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('fields/' + f.id)">{{ 'Directory.delete' | t }}</button> }
                </div>
              </form>
            </details></li>
          }
        </ul>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminCatalogPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminCatalog.title';
  protected readonly subtitle = 'AdminCatalog.subtitle';
  protected readonly fieldTypes = ['text', 'long_text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'radio'];
  protected readonly data = signal<CatalogData | null>(null);
  protected readonly cats = computed(() => (this.data()?.categories ?? []).filter((c) => this.matches(c.nameEn, c.nameAr, ...c.subcategories.flatMap((s) => [s.nameEn, s.nameAr]))));
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
      for (const c of d.categories) {
        this.editCat[c.id] = { nameEn: c.nameEn, nameAr: c.nameAr, defaultTeamId: c.defaultTeamId, isActive: c.isActive, sortOrder: c.sortOrder, priorityCode: c.priorityCode, isPrivate: c.isPrivate, autoAssign: c.autoAssign, typeIds: [...c.typeIds] };
        for (const s of c.subcategories) this.editSub[s.id] = { categoryId: s.categoryId, nameEn: s.nameEn, nameAr: s.nameAr, isActive: s.isActive, sortOrder: s.sortOrder, priorityCode: s.priorityCode };
      }
      for (const f of d.fields) this.editField[f.id] = toFieldModel(f);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected nwSub(catId: string): SubModel { return (this.newSubs[catId] ??= blankSub(catId)); }
  protected toggle(list: string[], id: string): void { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); }
  protected teamName2(id: string | null): string { const t = this.data()?.teams.find((x) => x.id === id); return t ? this.i18n.pick(t.nameEn, t.nameAr) : ''; }
  protected prioName(code: string | null): string { const p = this.data()?.priorities.find((x) => x.code === code); return p ? this.i18n.pick(p.nameEn, p.nameAr) : ''; }
  protected catName(id: string): string { const c = this.data()?.categories.find((x) => x.id === id); return c ? this.i18n.pick(c.nameEn, c.nameAr) : ''; }

  protected async createCat(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('categories', this.nwCat))) { this.nwCat = blankCat(); box.open = false; }
  }
  protected updateCat(c: CatRow): void { void this.run(() => this.api.put('categories/' + c.id, this.editCat[c.id])); }
  protected async createSub(c: CatRow, box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('subcategories', this.nwSub(c.id)))) { delete this.newSubs[c.id]; box.open = false; }
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
const blankPrio = (): PrioModel => ({ nameEn: '', nameAr: '', color: 'blue', icon: 'flag', sortOrder: 50, isActive: true, firstResponseMinutes: 240, resolutionMinutes: 960 });

@Component({
  selector: 'app-admin-priorities',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <fieldset [class]="cls.card + ' p-5'">
        <legend class="sr-only">{{ 'AdminPriorities.modeTitle' | t }}</legend>
        <p class="text-lg font-bold">{{ 'AdminPriorities.modeTitle' | t }}</p>
        <p class="text-sm text-muted">{{ 'AdminPriorities.modeHelp' | t }}</p>
        @for (md of ['system', 'customer']; track md) {
          <label class="mt-2 flex items-start gap-2"><input type="radio" name="mode" class="mt-1 h-5 w-5" [checked]="mode() === md" (change)="setMode(md)" />
            <span><span class="font-semibold">{{ 'AdminPriorities.mode_' + md | t }}</span><span class="block text-sm text-muted">{{ 'AdminPriorities.mode_' + md + '_help' | t }}</span></span></label>
        }
      </fieldset>

      <ng-template #form let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label">{{ 'AdminPriorities.nameEn' | t }}<app-req /></label>
            <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="60" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label">{{ 'AdminPriorities.nameAr' | t }}<app-req /></label>
            <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" required maxlength="60" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'co'" [class]="cls.label">{{ 'AdminPriorities.color' | t }}</label>
            <select [id]="id + 'co'" [name]="id + 'co'" [class]="cls.input" [(ngModel)]="m.color">
              @for (c of colors; track c) { <option [value]="c">{{ 'AdminPriorities.colors.' + c | t }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'ic'" [class]="cls.label">{{ 'AdminPriorities.icon' | t }}</label>
            <select [id]="id + 'ic'" [name]="id + 'ic'" [class]="cls.input" [(ngModel)]="m.icon">
              @for (c of icons; track c) { <option [value]="c">{{ 'AdminPriorities.icons.' + c | t }}</option> }
            </select></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'fr'" [class]="cls.label">{{ 'AdminPriorities.first' | t }}<app-req /></label>
            <input [id]="id + 'fr'" [name]="id + 'fr'" type="number" min="1" required [class]="cls.input" [(ngModel)]="m.firstResponseMinutes" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'rs'" [class]="cls.label">{{ 'AdminPriorities.resolution' | t }}<app-req /></label>
            <input [id]="id + 'rs'" [name]="id + 'rs'" type="number" min="1" required [class]="cls.input" [(ngModel)]="m.resolutionMinutes" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminPriorities.sort' | t }}</label>
            <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          <label class="${CHECK} self-end"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" [disabled]="id === 'pnormal'" /> {{ 'AdminPriorities.active' | t }}</label>
        </div>
        <p class="text-sm text-muted">{{ 'AdminPriorities.slaHint' | t }}</p>
        <p class="flex items-center gap-2 text-sm">{{ 'AdminPriorities.preview' | t }}
          <span class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 font-semibold"><span class="h-2.5 w-2.5 rounded-full" [class]="dot[m.color]"></span>{{ i18n.pick(m.nameEn, m.nameAr) || ('AdminPriorities.previewName' | t) }}</span></p>
      </ng-template>

      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminPriorities.addTitle' | t }}</span></summary>
        <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="create(add)">
          <ng-container *ngTemplateOutlet="form; context: { m: nw, id: 'pn' }" />
          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminPriorities.add' | t }}</button></div>
        </form>
      </details>

      <ul class="flex flex-col gap-3">
        @for (p of rows(); track p.code) {
          <li><details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2">
                <span class="h-3 w-3 rounded-full" [class]="dot[p.color]"></span>
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(p.nameEn, p.nameAr) }}</span>
                <span [class]="p.isActive ? cls.badgeOn : cls.badgeOff">{{ (p.isActive ? 'AdminPriorities.active' : 'AdminPriorities.inactive') | t }}</span>
              </span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminPriorities.summary' | t: { first: p.firstResponseMinutes ?? '-', resolution: p.resolutionMinutes ?? '-' } }} · {{ 'AdminPriorities.usedBy' | t: { count: p.usedBy } }}</span>
            </summary>
            <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="update(p)">
              @if (p.isDefault) { <p class="rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand-ink">{{ 'AdminPriorities.defaultNote' | t }}</p> }
              <ng-container *ngTemplateOutlet="form; context: { m: edit[p.code], id: 'p' + p.code }" />
              <div class="flex flex-wrap gap-2">
                <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminPriorities.save' | t }}</button>
                @if (!p.isDefault && !p.tickets && !p.usedBy) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove(p)">{{ 'Directory.delete' | t }}</button> }
              </div>
            </form>
          </details></li>
        }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminPrioritiesPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminPriorities.title';
  protected readonly subtitle = 'AdminPriorities.subtitle';
  protected readonly colors = ['red', 'amber', 'blue', 'green', 'grey', 'light'];
  protected readonly icons = ['alert', 'arrow_up', 'minus', 'arrow_down', 'bolt', 'flag', 'clock', 'star'];
  protected readonly dot = PRIO_DOT;
  protected readonly rows = signal<PrioRow[]>([]);
  protected readonly mode = signal('system');
  protected nw: PrioModel = blankPrio();
  protected edit: Record<string, PrioModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<{ mode: string; priorities: PrioRow[] }>('priorities');
      for (const p of d.priorities) this.edit[p.code] = { nameEn: p.nameEn, nameAr: p.nameAr, color: p.color, icon: p.icon, sortOrder: p.sortOrder, isActive: p.isActive, firstResponseMinutes: p.firstResponseMinutes ?? 240, resolutionMinutes: p.resolutionMinutes ?? 960 };
      this.mode.set(d.mode);
      this.rows.set(d.priorities);
    } catch (e) { this.fail(e); }
  }
  protected setMode(m: string): void { void this.run(() => this.api.put('priorities-mode', { mode: m })); }
  protected async create(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('priorities', this.nw))) { this.nw = blankPrio(); box.open = false; }
  }
  protected update(p: PrioRow): void { void this.run(() => this.api.put('priorities/' + p.code, this.edit[p.code])); }
  protected remove(p: PrioRow): void { void this.run(() => this.api.del('priorities/' + p.code), 'AdminV2.deleted'); }
}

// ================================================================== SLA, working hours, holidays

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
type DayModel = { open: boolean; from: string; to: string };
type HoursModel = { name: string; timezone: string; isDefault: boolean; days: Record<string, DayModel> };
const blankHours = (): HoursModel => ({ name: '', timezone: 'Africa/Cairo', isDefault: false, days: Object.fromEntries(DAYS.map((d) => [d, { open: !['fri', 'sat'].includes(d), from: '09:00', to: '17:00' }])) });

@Component({
  selector: 'app-admin-sla',
  imports: [TPipe, Alert, FormsModule, Req, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      ${HEADER}
      <p class="rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn-ink">{{ 'AdminSla.testNotice' | t }}</p>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminSla.policies' | t }}</h2>
        @for (p of policies(); track p.priority) {
          <details [class]="cls.card">
            <summary [class]="cls.summary">
              <span class="flex flex-wrap items-center gap-2"><span class="h-3 w-3 rounded-full" [class]="dot[p.color]"></span>
                <span class="text-lg font-bold" dir="auto">{{ i18n.pick(p.nameEn, p.nameAr) }}</span>
                @if (!p.isActive) { <span [class]="cls.badgeOff">{{ 'AdminPriorities.inactive' | t }}</span> }</span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminPriorities.summary' | t: { first: p.firstResponseMinutes, resolution: p.resolutionMinutes } }} · {{ calName(p.businessHoursId) }}</span>
            </summary>
            <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="savePolicy(p)">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="flex flex-col gap-1.5"><label [for]="'fr' + p.priority" [class]="cls.label">{{ 'AdminSla.firstResponse' | t }}<app-req /></label>
                  <input [id]="'fr' + p.priority" name="fr" type="number" min="1" required [class]="cls.input" [(ngModel)]="pol[p.priority].firstResponseMinutes" /></div>
                <div class="flex flex-col gap-1.5"><label [for]="'rs' + p.priority" [class]="cls.label">{{ 'AdminSla.resolution' | t }}<app-req /></label>
                  <input [id]="'rs' + p.priority" name="rs" type="number" min="1" required [class]="cls.input" [(ngModel)]="pol[p.priority].resolutionMinutes" /></div>
                <div class="flex flex-col gap-1.5"><label [for]="'wn' + p.priority" [class]="cls.label">{{ 'AdminSla.warning' | t }}</label>
                  <input [id]="'wn' + p.priority" name="wn" type="number" min="1" max="99" [class]="cls.input" [(ngModel)]="pol[p.priority].warningThresholdPct" /></div>
                <div class="flex flex-col gap-1.5"><label [for]="'bh' + p.priority" [class]="cls.label">{{ 'AdminSla.hours' | t }}</label>
                  <select [id]="'bh' + p.priority" name="bh" [class]="cls.input" [(ngModel)]="pol[p.priority].businessHoursId">
                    @for (h of hours(); track h.id) { <option [ngValue]="h.id">{{ h.name }}</option> }
                  </select></div>
              </div>
              <div class="flex flex-col">
                <label class="${CHECK}"><input type="checkbox" name="pc" class="h-5 w-5" [(ngModel)]="pol[p.priority].pauseOnPendingCustomer" /> {{ 'AdminSla.pauseCustomer' | t }}</label>
                <label class="${CHECK}"><input type="checkbox" name="pi" class="h-5 w-5" [(ngModel)]="pol[p.priority].pauseOnPendingInternal" /> {{ 'AdminSla.pauseInternal' | t }}</label>
              </div>
              @for (ev of ['warnNotify', 'breachNotify']; track ev) {
                <fieldset><legend [class]="cls.label">{{ (ev === 'warnNotify' ? 'AdminSla.warnNotify' : 'AdminSla.breachNotify') | t }}</legend>
                  <div class="flex flex-wrap gap-x-6">
                    @for (r of roles; track r) {
                      <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="$any(pol[p.priority])[ev].includes(r)" (change)="toggle($any(pol[p.priority])[ev], r)" /> {{ 'AdminSla.roles.' + r | t }}</label>
                    }
                  </div></fieldset>
              }
              <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.save' | t }}</button></div>
            </form>
          </details>
        }
      </section>

      <ng-template #hoursForm let-m="m" let-id="id">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label [for]="id + 'n'" [class]="cls.label">{{ 'AdminSla.holidayName' | t }}<app-req /></label>
            <input [id]="id + 'n'" [name]="id + 'n'" dir="auto" required maxlength="100" [class]="cls.input" [(ngModel)]="m.name" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="id + 'tz'" [class]="cls.label">{{ 'AdminSla.timezone' | t }}<app-req /></label>
            <input [id]="id + 'tz'" [name]="id + 'tz'" dir="ltr" required maxlength="60" [class]="cls.input" [(ngModel)]="m.timezone" /></div>
        </div>
        <table class="mt-2 w-full max-w-xl text-sm">
          <tbody>
            @for (d of days; track d) {
              <tr class="border-b border-line">
                <th scope="row" class="py-2 text-start font-semibold">{{ 'AdminSla.days.' + d | t }}</th>
                <td><label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [name]="id + d + 'o'" [(ngModel)]="m.days[d].open" /> {{ 'AdminSla.open' | t }}</label></td>
                <td><label class="sr-only" [for]="id + d + 'f'">{{ 'AdminSla.from' | t }}</label><input type="time" [id]="id + d + 'f'" [name]="id + d + 'f'" class="min-h-10 rounded-lg border border-line px-2" [(ngModel)]="m.days[d].from" [disabled]="!m.days[d].open" /></td>
                <td><label class="sr-only" [for]="id + d + 't'">{{ 'AdminSla.to' | t }}</label><input type="time" [id]="id + d + 't'" [name]="id + d + 't'" class="min-h-10 rounded-lg border border-line px-2" [(ngModel)]="m.days[d].to" [disabled]="!m.days[d].open" /></td>
              </tr>
            }
          </tbody>
        </table>
        <label class="${CHECK}"><input type="checkbox" [name]="id + 'df'" class="h-5 w-5" [(ngModel)]="m.isDefault" /> {{ 'AdminV2.defaultCalendar' | t }}</label>
      </ng-template>

      <section class="flex flex-col gap-3">
        <h2 class="text-2xl font-bold">{{ 'AdminSla.hours' | t }}</h2>
        @for (h of hours(); track h.id) {
          <details [class]="cls.card">
            <summary [class]="cls.summary"><span class="flex flex-wrap items-center gap-2"><span class="text-lg font-bold" dir="auto">{{ h.name }}</span>
              @if (h.isDefault) { <span [class]="cls.badgeOn">{{ 'AdminV2.default' | t }}</span> }</span>
              <span class="mt-0.5 block text-sm text-muted" dir="ltr">{{ h.timezone }}</span></summary>
            <div class="flex flex-col gap-5 px-5 pb-5">
              <form class="flex flex-col gap-3" (ngSubmit)="saveHours(h)">
                <ng-container *ngTemplateOutlet="hoursForm; context: { m: cal[h.id], id: 'h' + h.id }" />
                <div class="flex flex-wrap gap-2">
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.save' | t }}</button>
                  @if (!h.isDefault) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('business-hours/' + h.id)">{{ 'Directory.delete' | t }}</button> }
                </div>
              </form>
              <div class="flex flex-col gap-2 border-t border-line pt-4">
                <p class="text-sm text-muted">{{ 'AdminSla.calendars.recalcHelp' | t }}</p>
                <div><button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="recalc(h)">{{ 'AdminSla.calendars.recalc' | t }}</button></div>
              </div>
              <section class="border-t border-line pt-4">
                <h3 class="text-lg font-bold">{{ 'AdminSla.holidays' | t }}</h3>
                @if (!h.holidays.length) { <p class="text-sm text-muted">{{ 'AdminSla.noHolidays' | t }}</p> }
                <ul class="mt-2 divide-y divide-line rounded-lg border border-line">
                  @for (x of h.holidays; track x.id) {
                    <li class="flex items-center gap-3 px-4 py-2"><span class="w-28 font-mono text-sm" dir="ltr">{{ x.date }}</span><span class="flex-1" dir="auto">{{ x.name }}</span>
                      <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="remove('holidays/' + x.id)">{{ 'AdminSla.remove' | t }}</button></li>
                  }
                </ul>
                <form class="mt-3 flex flex-wrap items-end gap-2" (ngSubmit)="addHoliday(h)">
                  <div class="flex flex-col gap-1.5"><label [for]="'hd' + h.id" [class]="cls.label">{{ 'AdminSla.date' | t }}</label>
                    <input [id]="'hd' + h.id" name="hd" type="date" required [class]="cls.input" [(ngModel)]="hol[h.id].date" /></div>
                  <div class="flex min-w-56 flex-1 flex-col gap-1.5"><label [for]="'hn' + h.id" [class]="cls.label">{{ 'AdminSla.holidayName' | t }}</label>
                    <input [id]="'hn' + h.id" name="hn" dir="auto" required maxlength="100" [class]="cls.input" [(ngModel)]="hol[h.id].name" /></div>
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSla.addHoliday' | t }}</button>
                </form>
              </section>
            </div>
          </details>
        }
        @if (asg(); as a) {
          <details [class]="cls.card">
            <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminSla.calendars.assignTitle' | t }}</span>
              <span class="mt-0.5 block text-sm text-muted">{{ 'AdminSla.calendars.assignHelp' | t }}</span></summary>
            <ul class="flex flex-col gap-2 px-5 pb-5">
              @for (o of a.organizations; track o.id) {
                <ng-container *ngTemplateOutlet="assignRow; context: { kind: 'organization', id: o.id, label: o.name, current: o.businessHoursId, indent: false }" />
                @for (b of branchesIn(o.id); track b.id) {
                  <ng-container *ngTemplateOutlet="assignRow; context: { kind: 'branch', id: b.id, label: b.name, current: b.businessHoursId, indent: true }" />
                }
              }
              @for (t of a.teams; track t.id) {
                <ng-container *ngTemplateOutlet="assignRow; context: { kind: 'team', id: t.id, label: i18n.pick(t.nameEn, t.nameAr), current: t.businessHoursId, indent: false }" />
              }
            </ul>
          </details>
        }
        <ng-template #assignRow let-kind="kind" let-id="id" let-label="label" let-current="current" let-indent="indent">
          <li class="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3" [class.ms-6]="indent">
            <span class="min-w-48 flex-1 font-semibold" dir="auto">{{ label }}</span>
            <select [attr.aria-label]="label" [class]="cls.input + ' w-56'" (change)="assign(kind, id, $any($event.target).value)">
              <option value="" [selected]="!current">{{ 'AdminSla.calendars.followDefault' | t }}</option>
              @for (h of hours(); track h.id) { <option [value]="h.id" [selected]="h.id === current">{{ h.name }}</option> }
            </select>
          </li>
        </ng-template>
        <details [class]="cls.card" #addh>
          <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'AdminV2.addCalendar' | t }}</span></summary>
          <form class="flex flex-col gap-3 px-5 pb-5" (ngSubmit)="createHours(addh)">
            <ng-container *ngTemplateOutlet="hoursForm; context: { m: nwCal, id: 'nh' }" />
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.create' | t }}</button></div>
          </form>
        </details>
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminSlaPage extends AdminBase implements OnInit {
  protected readonly title = 'AdminSla.title';
  protected readonly subtitle = 'AdminSla.subtitle';
  protected readonly dot = PRIO_DOT;
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

  async ngOnInit(): Promise<void> {
    await this.reload();
    try { this.asg.set(await this.api.get('calendar-assignments')); } catch { /* optional */ }
  }
  protected branchesIn(org: string) { return (this.asg()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected assign(kind: string, id: string, cal: string): void {
    void this.run(() => this.api.put('calendar-assignments', { kind, id, calendarId: cal || null }), 'AdminSla.calendars.applied');
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
      this.policies.set(d.policies);
      this.hours.set(d.hours);
    } catch (e) { this.fail(e); }
  }
  protected calName(id: string | null): string { return this.hours().find((h) => h.id === id)?.name ?? this.hours().find((h) => h.isDefault)?.name ?? ''; }
  protected toggle(list: string[], v: string): void { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }
  protected savePolicy(p: SlaRow): void {
    const m = this.pol[p.priority];
    void this.run(() => this.api.put('sla/' + p.priority, {
      firstResponseMinutes: Number(m.firstResponseMinutes), resolutionMinutes: Number(m.resolutionMinutes), warningThresholdPct: Number(m.warningThresholdPct),
      pauseOnPendingCustomer: m.pauseOnPendingCustomer, pauseOnPendingInternal: m.pauseOnPendingInternal, businessHoursId: m.businessHoursId,
      warnNotify: m.warnNotify, breachNotify: m.breachNotify,
    }));
  }
  private hoursBody(m: HoursModel) {
    return { name: m.name, timezone: m.timezone, isDefault: m.isDefault, schedule: Object.fromEntries(DAYS.map((d) => [d, m.days[d].open ? [[m.days[d].from, m.days[d].to]] : []])) };
  }
  protected saveHours(h: HoursRow): void { void this.run(() => this.api.put('business-hours/' + h.id, this.hoursBody(this.cal[h.id]))); }
  protected async createHours(box: HTMLDetailsElement): Promise<void> {
    if (await this.run(() => this.api.post('business-hours', this.hoursBody(this.nwCal)))) { this.nwCal = blankHours(); box.open = false; }
  }
  protected async addHoliday(h: HoursRow): Promise<void> {
    if (await this.run(() => this.api.post(`business-hours/${h.id}/holidays`, this.hol[h.id]))) this.hol[h.id] = { date: '', name: '' };
  }
  protected remove(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
