import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../../core/auth';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { TILE_CAT_LG, TILE_CAT_MD, TILE_CAT_SM, TILE_EYE_LG, TILE_EYE_SM, TILE_SUB_SM, TILE_TYPE_LG, TILE_TYPE_MD, TILE_TYPE_SM } from '../../shared/tiles';
import { AdminBase } from './admin-pages';

// ---- contracts (CatalogAdminController.Places) ---------------------------------------------------

interface Owned { ownerOrganizationId: string | null; ownerBranchId: string | null; used: boolean; offered: boolean }
interface PType extends Owned { id: string; code: string | null; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; sortOrder: number; isActive: boolean; tickets: number; sourceCategoryIds: string[] }
interface PSub extends Owned { id: string; categoryId: string; nameEn: string; nameAr: string; isActive: boolean; sortOrder: number; priorityCode: string | null; tickets: number }
interface PCat extends Owned { id: string; nameEn: string; nameAr: string; teamKindId: string | null; isActive: boolean; sortOrder: number; priorityCode: string | null; isPrivate: boolean; autoAssign: boolean; tickets: number; subcategories: PSub[] }
interface PKind extends Owned { id: string; nameEn: string; nameAr: string; handledBy: { teamId: string; nameEn: string; nameAr: string; at: string; members: number } | null }
interface Place { organizationId: string; branchId: string | null; name: string; organizationName: string }
interface View { showOrganization: boolean; showBranch: boolean; showSystem: boolean }
interface PlaceData {
  places: Place[]; place?: Place; view?: View; kinds?: PKind[]; types?: PType[]; categories?: PCat[];
  links?: { typeId: string; categoryId: string }[]; priorities?: { code: string; nameEn: string; nameAr: string; isActive: boolean }[];
}
type TypeModel = { code: string; nameEn: string; nameAr: string; descriptionEn: string; descriptionAr: string; examplesEn: string; examplesAr: string; sortOrder: number; isActive: boolean; categoryIds: string[] };
type CatModel = { nameEn: string; nameAr: string; teamKindId: string | null; isActive: boolean; sortOrder: number; priorityCode: string | null; isPrivate: boolean; autoAssign: boolean; typeIds: string[] };
type SubModel = { categoryId: string; nameEn: string; nameAr: string; isActive: boolean; sortOrder: number; priorityCode: string | null };
type Panel = null | 'useTypes' | 'newType' | 'useCats' | 'newCat' | 'newSub';

const blankType = (): TypeModel => ({ code: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', examplesEn: '', examplesAr: '', sortOrder: 0, isActive: true, categoryIds: [] });
const blankCat = (): CatModel => ({ nameEn: '', nameAr: '', teamKindId: null, isActive: true, sortOrder: 0, priorityCode: null, isPrivate: false, autoAssign: true, typeIds: [] });
const BTN_SOFT = 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-soft px-4 font-semibold text-brand-ink hover:bg-brand/15';
const TH = 'px-3 py-3 text-start';
const CHIP = { own: 'bg-ok-soft text-ok', sys: 'bg-bg text-muted border border-line', org: 'bg-[#efe8fd] text-[#5b3aa8]' };

/**
 * Own catalog per place: an organization or branch admin chooses ticket types, categories and sub-categories from the
 * system (a branch also from its organization) or creates their own, ticks which categories each type shows in their
 * place, and chooses what their customers see.
 */
@Component({
  selector: 'app-place-catalog',
  imports: [TPipe, Alert, FormsModule, Req, ReqNote, NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ (isAdmin ? 'PlaceCat.titleAdmin' : 'PlaceCat.title') | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ (isAdmin ? 'PlaceCat.subtitleAdmin' : 'PlaceCat.subtitle') | t }}</p></div>
      @if (isAdmin) {
        <p class="flex items-start gap-2 rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand-ink"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="mt-0.5 shrink-0"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
          <span>{{ 'PlaceCat.adminNoteA' | t }} <a [routerLink]="'/' + i18n.locale() + '/admin/catalog'" class="font-semibold underline">{{ 'PlaceCat.adminNoteLink' | t }}</a>{{ 'PlaceCat.adminNoteB' | t }}</span></p>
      }
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      @if (data(); as d) {
        @if (!d.places.length) { <p class="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn-ink">{{ 'PlaceCat.noPlaces' | t }}</p> } @else {
        <div class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          @if (d.places.length > 1) {
            <label class="flex max-w-md flex-col gap-1.5 text-sm font-semibold">{{ 'PlaceCat.place' | t }}
              <select name="place" [class]="cls.input + ' font-normal'" [ngModel]="placeKey()" (ngModelChange)="choosePlace($event)">
                @for (p of d.places; track keyOf(p)) { <option [value]="keyOf(p)">{{ placeLabel(p) }}</option> }</select></label>
          }
          <div role="tablist" class="flex flex-wrap gap-2">
            <button type="button" role="tab" [attr.aria-selected]="sec() === 'types'" (click)="go('types')" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold" [class]="sec() === 'types' ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-bg'">${TILE_TYPE_SM}{{ 'AdminTicketTypes.title' | t }}</button>
            <button type="button" role="tab" [attr.aria-selected]="sec() === 'cats'" (click)="go('cats')" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold" [class]="sec() === 'cats' ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-bg'">${TILE_CAT_SM}{{ 'AdminCatalog.categories' | t }}</button>
            <button type="button" role="tab" [attr.aria-selected]="sec() === 'view'" (click)="go('view')" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold" [class]="sec() === 'view' ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface hover:bg-bg'">${TILE_EYE_SM}{{ 'PlaceCat.viewTitle' | t }}</button>
          </div>
        </div>

        <!-- ================================================= shared forms -->
        <ng-template #typeForm let-m="m" let-id="id">
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
          </div>
          <fieldset class="mt-2">
            <legend [class]="cls.label">{{ 'AdminTicketTypes.availableCategories' | t }}</legend>
            <p class="text-sm text-muted">{{ 'PlaceCat.typeCatsHint' | t: { place: placeName() } }}</p>
            <div class="mt-2 grid gap-x-6 md:grid-cols-3">
              @for (c of usedCats(); track c.id) {
                <label class="flex min-h-10 items-center gap-2"><input type="checkbox" class="h-5 w-5" [checked]="m.categoryIds.includes(c.id)" (change)="flip(m.categoryIds, c.id)" /> <span dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span></label>
              }
            </div>
          </fieldset>
          <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminTicketTypes.showToCustomers' | t }}</label>
        </ng-template>
        <ng-template #catForm let-m="m" let-id="id" let-isNew="isNew">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'AdminCatalog.nameEn' | t }}<app-req /></span></label>
              <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'AdminCatalog.nameAr' | t }}<app-req /></span></label>
              <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'tm'" [class]="cls.label">{{ 'TeamPlace.handledBy' | t }}</label>
              <select [id]="id + 'tm'" [name]="id + 'tm'" [class]="cls.input" [(ngModel)]="m.teamKindId">
                <option [ngValue]="null">{{ 'AdminCatalog.noTeam' | t }}</option>
                @for (k of usedKinds(); track k.id) { <option [ngValue]="k.id">{{ i18n.pick(k.nameEn, k.nameAr) }}</option> }
              </select>
              <p class="text-sm text-muted">{{ 'PlaceCat.kindHint' | t: { place: placeName() } }}</p></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'pr'" [class]="cls.label">{{ 'AdminCatalog.fixedPriority' | t }}</label>
              <select [id]="id + 'pr'" [name]="id + 'pr'" [class]="cls.input" [(ngModel)]="m.priorityCode">
                <option [ngValue]="null">{{ 'AdminCatalog.noFixedPriority' | t }}</option>
                @for (p of prios(); track p.code) { <option [ngValue]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
              </select></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
              <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
            <div class="flex flex-col">
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminCatalog.active' | t }}</label>
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'pv'" class="h-5 w-5" [(ngModel)]="m.isPrivate" /> {{ 'AdminCatalog.isPrivate' | t }}</label>
              <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'aa'" class="h-5 w-5" [(ngModel)]="m.autoAssign" /> {{ 'AdminCatalog.autoAssign' | t }}</label>
            </div>
          </div>
          @if (isNew && usedTypes().length) {
            <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'ty'" class="h-5 w-5" [(ngModel)]="addToTypes" /> {{ 'PlaceCat.addToTypes' | t: { types: typeNames() } }}</label>
          }
        </ng-template>
        <ng-template #subForm let-m="m" let-id="id" let-isNew="isNew">
          <div class="grid gap-4 md:grid-cols-2">
            @if (isNew) {
              <div class="flex flex-col gap-1.5 md:col-span-2"><label [for]="id + 'ct'" [class]="cls.label">{{ 'AdminCatalog.parentCategory' | t }}</label>
                <select [id]="id + 'ct'" [name]="id + 'ct'" [class]="cls.input + ' md:max-w-md'" [(ngModel)]="m.categoryId">
                  @for (c of usedCats(); track c.id) { <option [value]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}@if (!isOwn(c)) { ({{ fromLabel(c) }}) }</option> }
                </select></div>
            }
            <div class="flex flex-col gap-1.5"><label [for]="id + 'en'" [class]="cls.label"><span>{{ 'AdminCatalog.nameEn' | t }}<app-req /></span></label>
              <input [id]="id + 'en'" [name]="id + 'en'" dir="ltr" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameEn" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'ar'" [class]="cls.label"><span>{{ 'AdminCatalog.nameAr' | t }}<app-req /></span></label>
              <input [id]="id + 'ar'" [name]="id + 'ar'" dir="rtl" lang="ar" required maxlength="120" [class]="cls.input" [(ngModel)]="m.nameAr" /></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'pr'" [class]="cls.label">{{ 'AdminCatalog.fixedPriority' | t }}</label>
              <select [id]="id + 'pr'" [name]="id + 'pr'" [class]="cls.input" [(ngModel)]="m.priorityCode">
                <option [ngValue]="null">{{ 'AdminCatalog.inheritsPriority' | t }}</option>
                @for (p of prios(); track p.code) { <option [ngValue]="p.code">{{ i18n.pick(p.nameEn, p.nameAr) }}</option> }
              </select></div>
            <div class="flex flex-col gap-1.5"><label [for]="id + 'so'" [class]="cls.label">{{ 'AdminCatalog.sort' | t }}</label>
              <input [id]="id + 'so'" [name]="id + 'so'" type="number" min="0" max="1000" [class]="cls.input" [(ngModel)]="m.sortOrder" /></div>
          </div>
          <label class="flex min-h-11 items-center gap-2"><input type="checkbox" [name]="id + 'ac'" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminCatalog.active' | t }}</label>
        </ng-template>

        <!-- ================================================= ticket types -->
        @if (sec() === 'types') {
          @if (panel() === 'useTypes') {
            <section [class]="panelCls" aria-labelledby="ut">
              <div class="flex items-start justify-between gap-3"><h2 id="ut" class="text-lg font-bold">{{ 'PlaceCat.chooseTypes' | t }}</h2><button type="button" [class]="closeCls" (click)="panel.set(null)">✕ {{ 'Directory.cancel' | t }}</button></div>
              @if (!offeredTypes().length) { <p class="text-sm text-muted">{{ 'PlaceCat.nothingLeft' | t }}</p> } @else {
                <ul class="flex flex-col gap-2">
                  @for (x of offeredTypes(); track x.id) {
                    <li><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [checked]="picked.has(x.id)" (change)="flipSet(picked, x.id)" />
                      <span><b dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</b>@if (x.code) { <span class="ms-2 rounded bg-brand-soft px-1.5 font-mono text-xs font-bold text-brand-ink">{{ x.code }}</span> }
                        <span class="block text-sm text-muted">{{ fromLabel(x) }} · {{ 'PlaceCat.typeTicked' | t }}</span></span></label></li>
                  }
                </ul>
                <div><button type="button" [class]="cls.btn" [disabled]="busy() || !picked.size" (click)="use('type')">{{ 'PlaceCat.useSelected' | t }}</button></div>
              }
            </section>
          }
          @if (panel() === 'newType') {
            <section [class]="panelCls" aria-labelledby="nt">
              <div class="flex items-start justify-between gap-3"><h2 id="nt" class="text-lg font-bold">{{ 'AdminTicketTypes.add' | t }}</h2><button type="button" [class]="closeCls" (click)="panel.set(null)">✕ {{ 'Directory.cancel' | t }}</button></div>
              <form class="flex flex-col gap-4" (ngSubmit)="createType()">
                <ng-container *ngTemplateOutlet="typeForm; context: { m: nwType, id: 'nt' }" />
                <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminTicketTypes.add' | t }}</button><app-req-note /></div>
              </form>
            </section>
          }
          <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="types">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 flex-1 items-start gap-3">${TILE_TYPE_LG}<div><h2 id="types" class="text-xl font-bold">{{ 'PlaceCat.typesIn' | t: { place: placeName() } }}</h2><p class="text-sm text-muted">{{ 'AdminTicketTypes.subtitle' | t }}</p></div></div>
              <div class="flex flex-wrap gap-2"><button type="button" [class]="softBtn" (click)="open('useTypes')">+ {{ 'PlaceCat.chooseCurrent' | t }}</button><button type="button" [class]="cls.btn" (click)="open('newType')">+ {{ 'AdminTicketTypes.add' | t }}</button></div>
            </div>
            @if (!usedTypes().length) { @if (seesSystem()) { <p class="rounded-lg bg-bg px-4 py-3 text-sm text-muted">{{ 'PlaceCat.noneSeesSystem' | t: { place: placeName() } }}</p> } @else { <p class="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn-ink">{{ 'PlaceCat.noTypes' | t }}</p> } } @else {
            <div class="overflow-x-auto rounded-xl border border-line">
              <table class="w-full min-w-[46rem] border-collapse text-start text-sm">
                <thead class="bg-bg text-xs font-semibold text-muted"><tr>
                  <th scope="col" [class]="th">{{ 'AdminTicketTypes.colName' | t }}</th><th scope="col" [class]="th">{{ 'AdminTicketTypes.colCategories' | t }}</th>
                  <th scope="col" [class]="th">{{ 'AdminTicketTypes.colTickets' | t }}</th><th scope="col" [class]="th">{{ 'AdminTicketTypes.colStatus' | t }}</th>
                  <th scope="col" [class]="th">{{ 'PlaceCat.comesFrom' | t }}</th><th scope="col" [class]="th">{{ 'AdminTicketTypes.colActions' | t }}</th></tr></thead>
                <tbody>
                  @for (x of usedTypes(); track x.id) {
                    <tr class="border-t border-line">
                      <td class="px-3 py-2.5"><div class="flex items-center gap-3">${TILE_TYPE_MD}<div class="min-w-0"><span class="font-bold" dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</span>@if (x.code) { <span class="ms-2 rounded bg-brand-soft px-1.5 font-mono text-xs font-bold text-brand-ink">{{ x.code }}</span> }
                        <span class="block text-xs text-muted" dir="rtl">{{ x.nameAr }}</span></div></div></td>
                      <td class="px-3 py-2.5">@let n = linkCountOfType(x.id); <span [class]="n ? 'font-semibold text-brand-ink' : 'font-semibold text-danger'">{{ 'AdminTicketTypes.linked' | t: { n } }}</span></td>
                      <td class="px-3 py-2.5">{{ x.tickets }}</td>
                      <td class="px-3 py-2.5"><span [class]="x.isActive ? cls.badgeOn : cls.badgeOff">{{ (x.isActive ? 'AdminTicketTypes.visible' : 'AdminTicketTypes.hidden') | t }}</span></td>
                      <td class="px-3 py-2.5"><span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="fromTone(x)">{{ fromLabel(x) }}</span></td>
                      <td class="px-3 py-2.5"><span class="flex flex-wrap gap-1.5">
                        @if (isOwn(x)) { <button type="button" [class]="smBtn" (click)="editOpen.set(editOpen() === x.id ? null : x.id)">{{ 'AdminCatalog.edit' | t }}<span class="sr-only"> {{ x.nameEn }}</span></button> }
                        <button type="button" [class]="smBtn" [disabled]="busy()" (click)="stop('type', x.id)">{{ 'PlaceCat.stopUsing' | t }}<span class="sr-only"> {{ x.nameEn }}</span></button></span></td>
                    </tr>
                    @if (editOpen() === x.id && editType[x.id]) {
                      <tr><td colspan="6" class="bg-[#fafcff] p-4">
                        <form class="flex flex-col gap-4" (ngSubmit)="updateType(x)">
                          <ng-container *ngTemplateOutlet="typeForm; context: { m: editType[x.id], id: 't' + x.id }" />
                          <div class="flex flex-wrap items-center gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                            @if (!x.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('types', x.id)">{{ 'Directory.delete' | t }}</button> }<app-req-note /></div>
                        </form></td></tr>
                    }
                  }
                </tbody>
              </table>
            </div>
            <p class="text-sm text-muted">{{ 'PlaceCat.stopHint' | t }}</p>
            }

            @if (usedTypes().length && usedCats().length) {
              <div class="mt-2 flex flex-col gap-3">
                <div><h3 class="text-lg font-bold">{{ 'PlaceCat.matrixIn' | t: { place: placeName() } }}</h3><p class="max-w-prose text-sm text-muted">{{ 'AdminTicketTypes.matrixHint' | t }} {{ 'PlaceCat.matrixOwn' | t }}</p></div>
                <div class="overflow-x-auto rounded-xl border border-line">
                  <table class="w-full min-w-[40rem] border-collapse text-sm">
                    <thead class="bg-bg text-xs font-semibold text-muted"><tr><th scope="col" [class]="th">{{ 'AdminCatalog.colName' | t }}</th>
                      @for (x of usedTypes(); track x.id) { <th scope="col" class="px-2 py-3 text-center" dir="auto">{{ i18n.pick(x.nameEn, x.nameAr) }}</th> }
                      <th scope="col" class="px-2 py-3 text-center">{{ 'AdminTicketTypes.colTypes' | t }}</th></tr></thead>
                    <tbody>
                      @for (c of usedCats(); track c.id) {
                        @let n = linkCountOfCat(c.id);
                        <tr class="border-t border-line">
                          <th scope="row" class="px-3 py-2.5 text-start font-bold" [class.text-danger]="!n" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</th>
                          @for (x of usedTypes(); track x.id) {
                            <td class="px-2 py-2.5 text-center"><input type="checkbox" class="h-5 w-5" [checked]="links().has(x.id + ':' + c.id)" (change)="flipLink(x.id + ':' + c.id)" [attr.aria-label]="i18n.pick(c.nameEn, c.nameAr) + ' / ' + i18n.pick(x.nameEn, x.nameAr)" /></td>
                          }
                          <td class="px-2 py-2.5 text-center font-bold">{{ n }} / {{ usedTypes().length }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <p class="text-sm text-muted">{{ 'AdminTicketTypes.matrixWarn' | t }}</p>
                <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="saveLinks()">{{ 'AdminTicketTypes.saveLinks' | t }}</button></div>
              </div>
            }
          </section>
        }

        <!-- ================================================= categories and sub-categories -->
        @if (sec() === 'cats') {
          @if (panel() === 'useCats') {
            <section [class]="panelCls" aria-labelledby="uc">
              <div class="flex items-start justify-between gap-3"><h2 id="uc" class="text-lg font-bold">{{ 'PlaceCat.chooseCurrent' | t }}</h2><button type="button" [class]="closeCls" (click)="panel.set(null)">✕ {{ 'Directory.cancel' | t }}</button></div>
              <h3 class="text-sm font-bold">{{ 'AdminCatalog.categories' | t }}</h3>
              @if (!offeredCats().length) { <p class="text-sm text-muted">{{ 'PlaceCat.nothingLeft' | t }}</p> }
              <ul class="flex flex-col gap-2">
                @for (c of offeredCats(); track c.id) {
                  <li><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [checked]="picked.has(c.id)" (change)="flipSet(picked, c.id)" />
                    <span><b dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</b><span class="block text-sm text-muted">{{ fromLabel(c) }} · {{ 'PlaceCat.handledByKind' | t: { kind: kindName(c.teamKindId) } }} · {{ 'PlaceCat.subsCome' | t }}</span></span></label></li>
                }
              </ul>
              <h3 class="mt-2 text-sm font-bold">{{ 'PlaceCat.subsOfYours' | t }}</h3>
              @if (!offeredSubs().length) { <p class="text-sm text-muted">{{ 'PlaceCat.nothingLeft' | t }}</p> }
              <ul class="flex flex-col gap-2">
                @for (s of offeredSubs(); track s.id) {
                  <li><label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [checked]="pickedSubs.has(s.id)" (change)="flipSet(pickedSubs, s.id)" />
                    <span><b dir="auto">{{ catName(s.categoryId) }} › {{ i18n.pick(s.nameEn, s.nameAr) }}</b><span class="block text-sm text-muted">{{ fromLabel(s) }}</span></span></label></li>
                }
              </ul>
              <div><button type="button" [class]="cls.btn" [disabled]="busy() || (!picked.size && !pickedSubs.size)" (click)="useCats()">{{ 'PlaceCat.useSelected' | t }}</button></div>
            </section>
          }
          @if (panel() === 'newCat') {
            <section [class]="panelCls" aria-labelledby="nc">
              <div class="flex items-start justify-between gap-3"><h2 id="nc" class="text-lg font-bold">{{ 'AdminCatalog.addCategory' | t }}</h2><button type="button" [class]="closeCls" (click)="panel.set(null)">✕ {{ 'Directory.cancel' | t }}</button></div>
              <form class="flex flex-col gap-4" (ngSubmit)="createCat()">
                <ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'nc', isNew: true }" />
                <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addCategory' | t }}</button><app-req-note /></div>
              </form>
            </section>
          }
          @if (panel() === 'newSub') {
            <section [class]="panelCls" aria-labelledby="ns">
              <div class="flex items-start justify-between gap-3"><h2 id="ns" class="text-lg font-bold">{{ 'AdminCatalog.addSubcategory' | t }}</h2><button type="button" [class]="closeCls" (click)="panel.set(null)">✕ {{ 'Directory.cancel' | t }}</button></div>
              @if (!usedCats().length) { <p class="text-sm text-muted">{{ 'PlaceCat.noCats' | t }}</p> } @else {
              <form class="flex flex-col gap-4" (ngSubmit)="createSub()">
                <ng-container *ngTemplateOutlet="subForm; context: { m: nwSub, id: 'ns', isNew: true }" />
                <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCatalog.addSubcategory' | t }}</button><app-req-note /></div>
              </form>
              }
            </section>
          }
          <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="cats">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 flex-1 items-start gap-3">${TILE_CAT_LG}<div><h2 id="cats" class="text-xl font-bold">{{ 'PlaceCat.catsIn' | t: { place: placeName() } }}</h2><p class="text-sm text-muted">{{ 'PlaceCat.catsHint' | t }}</p></div></div>
              <div class="flex flex-wrap gap-2"><button type="button" [class]="softBtn" (click)="open('useCats')">+ {{ 'PlaceCat.chooseCurrent' | t }}</button>
                <button type="button" [class]="cls.btn" (click)="open('newCat')">+ {{ 'AdminCatalog.addCategory' | t }}</button><button type="button" [class]="cls.btn" (click)="openSub()">+ {{ 'AdminCatalog.addSubcategory' | t }}</button></div>
            </div>
            @if (!usedCats().length) { @if (seesSystem()) { <p class="rounded-lg bg-bg px-4 py-3 text-sm text-muted">{{ 'PlaceCat.noneSeesSystem' | t: { place: placeName() } }}</p> } @else { <p class="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn-ink">{{ 'PlaceCat.noCats' | t }}</p> } } @else {
            <div class="overflow-x-auto rounded-xl border border-line">
              <table class="w-full min-w-[56rem] border-collapse text-start text-sm">
                <thead class="bg-bg text-xs font-semibold text-muted"><tr>
                  <th scope="col" [class]="th">{{ 'AdminCatalog.colName' | t }}</th><th scope="col" [class]="th">{{ 'AdminCatalog.colPriority' | t }}</th>
                  <th scope="col" [class]="th">{{ 'TeamPlace.handledBy' | t }}</th><th scope="col" [class]="th">{{ 'AdminCatalog.colTickets' | t }}</th>
                  <th scope="col" [class]="th">{{ 'AdminCatalog.colType' | t }}</th><th scope="col" [class]="th">{{ 'AdminCatalog.colAuto' | t }}</th>
                  <th scope="col" [class]="th">{{ 'AdminCatalog.colStatus' | t }}</th><th scope="col" [class]="th">{{ 'PlaceCat.comesFrom' | t }}</th>
                  <th scope="col" [class]="th">{{ 'AdminCatalog.colActions' | t }}</th></tr></thead>
                <tbody>
                  @for (c of usedCats(); track c.id) {
                    <tr class="border-t border-line">
                      <td class="px-3 py-2.5"><div class="flex items-center gap-3">${TILE_CAT_MD}<div><span class="font-bold" dir="auto">{{ i18n.pick(c.nameEn, c.nameAr) }}</span>
                        @if (usedSubsOf(c).length) { <span class="block text-xs text-muted">{{ 'PlaceCat.subCount' | t: { n: usedSubsOf(c).length } }}</span> }</div></div></td>
                      <td class="px-3 py-2.5 text-muted">{{ prioName(c.priorityCode) }}</td>
                      <td class="px-3 py-2.5">{{ kindName(c.teamKindId) }}<span class="block text-xs text-muted">{{ handlerText(c.teamKindId) }}</span></td>
                      <td class="px-3 py-2.5">{{ c.tickets }}</td>
                      <td class="px-3 py-2.5">{{ (c.isPrivate ? 'AdminCatalog.typePrivate' : 'AdminCatalog.typePublic') | t }}</td>
                      <td class="px-3 py-2.5 font-bold">{{ (c.autoAssign ? 'AdminCatalog.on' : 'AdminCatalog.off') | t }}</td>
                      <td class="px-3 py-2.5">{{ (c.isActive ? 'AdminCatalog.active' : 'AdminCatalog.inactive') | t }}</td>
                      <td class="px-3 py-2.5"><span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="fromTone(c)">{{ fromLabel(c) }}</span></td>
                      <td class="px-3 py-2.5"><span class="flex flex-wrap gap-1.5">
                        @if (isOwn(c)) { <button type="button" [class]="smBtn" (click)="editOpen.set(editOpen() === c.id ? null : c.id)">{{ 'AdminCatalog.edit' | t }}<span class="sr-only"> {{ c.nameEn }}</span></button> }
                        <button type="button" [class]="smBtn" [disabled]="busy()" (click)="stop('cat', c.id)">{{ 'PlaceCat.stopUsing' | t }}<span class="sr-only"> {{ c.nameEn }}</span></button></span></td>
                    </tr>
                    @if (editOpen() === c.id && editCat[c.id]) {
                      <tr><td colspan="9" class="bg-[#fafcff] p-4">
                        <form class="flex flex-col gap-4" (ngSubmit)="updateCat(c)">
                          <ng-container *ngTemplateOutlet="catForm; context: { m: editCat[c.id], id: 'c' + c.id, isNew: false }" />
                          <div class="flex flex-wrap items-center gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                            @if (!c.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('categories', c.id)">{{ 'Directory.delete' | t }}</button> }<app-req-note /></div>
                        </form></td></tr>
                    }
                    @for (s of usedSubsOf(c); track s.id) {
                      <tr class="border-t border-line bg-[#fbfcfe]">
                        <td class="py-2 pe-3 ps-10"><div class="flex items-center gap-2">${TILE_SUB_SM}<span dir="auto">{{ i18n.pick(s.nameEn, s.nameAr) }}</span></div></td>
                        <td class="px-3 py-2 text-muted">{{ s.priorityCode ? prioName(s.priorityCode) : ('AdminCatalog.inheritsPriority' | t) }}</td>
                        <td class="px-3 py-2 text-muted">–</td><td class="px-3 py-2">{{ s.tickets }}</td><td class="px-3 py-2 text-muted">–</td><td class="px-3 py-2 text-muted">–</td>
                        <td class="px-3 py-2">{{ (s.isActive ? 'AdminCatalog.active' : 'AdminCatalog.inactive') | t }}</td>
                        <td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-xs font-bold" [class]="fromTone(s)">{{ fromLabel(s) }}</span></td>
                        <td class="px-3 py-2"><span class="flex flex-wrap gap-1.5">
                          @if (isOwn(s)) { <button type="button" [class]="smBtn" (click)="editOpen.set(editOpen() === s.id ? null : s.id)">{{ 'AdminCatalog.edit' | t }}<span class="sr-only"> {{ s.nameEn }}</span></button> }
                          <button type="button" [class]="smBtn" [disabled]="busy()" (click)="stop('sub', s.id)">{{ 'PlaceCat.stopUsing' | t }}<span class="sr-only"> {{ s.nameEn }}</span></button></span></td>
                      </tr>
                      @if (editOpen() === s.id && editSub[s.id]) {
                        <tr><td colspan="9" class="bg-[#fafcff] p-4">
                          <form class="flex flex-col gap-4" (ngSubmit)="updateSub(s)">
                            <ng-container *ngTemplateOutlet="subForm; context: { m: editSub[s.id], id: 's' + s.id, isNew: false }" />
                            <div class="flex flex-wrap items-center gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Directory.saveChanges' | t }}</button>
                              @if (!s.tickets) { <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove('subcategories', s.id)">{{ 'Directory.delete' | t }}</button> }<app-req-note /></div>
                          </form></td></tr>
                      }
                    }
                  }
                </tbody>
              </table>
            </div>
            <p class="text-sm text-muted">{{ 'PlaceCat.stopHint' | t }}</p>
            }
          </section>
        }

        <!-- ================================================= what the customers see -->
        @if (sec() === 'view' && d.view) {
          <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="cv">
            <div class="flex items-start gap-3">${TILE_EYE_LG}<div><h2 id="cv" class="text-xl font-bold">{{ 'PlaceCat.viewTitle' | t }}</h2>
              <p class="text-sm text-muted">{{ (isBranch() ? 'PlaceCat.viewHintBranch' : 'PlaceCat.viewHintOrg') | t: { place: placeName() } }}</p></div></div>
            <fieldset class="flex flex-col gap-2">
              <legend class="sr-only">{{ 'PlaceCat.viewTitle' | t }}</legend>
              <label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [(ngModel)]="view.showOrganization" />
                <span><b>{{ 'PlaceCat.viewOrg' | t: { name: d.place?.organizationName ?? '' } }}</b><span class="block text-sm text-muted">{{ 'PlaceCat.viewOrgHint' | t: { name: d.place?.organizationName ?? '' } }}</span></span></label>
              @if (isBranch()) {
                <label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [(ngModel)]="view.showBranch" />
                  <span><b>{{ 'PlaceCat.viewBranch' | t: { name: placeName() } }}</b><span class="block text-sm text-muted">{{ 'PlaceCat.viewBranchHint' | t: { name: placeName() } }}</span></span></label>
              }
              <label class="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 hover:bg-bg"><input type="checkbox" class="mt-1 h-5 w-5" [(ngModel)]="view.showSystem" />
                <span><b>{{ 'PlaceCat.viewSystem' | t }}</b><span class="block text-sm text-muted">{{ 'PlaceCat.viewSystemHint' | t }}</span></span></label>
            </fieldset>
            @if (!viewOk()) { <p role="alert" class="text-sm font-semibold text-danger">{{ 'PlaceCat.viewOne' | t }}</p> }
            <div><button type="button" [class]="cls.btn" [disabled]="busy() || !viewOk()" (click)="saveView()">{{ 'AdminCommon.save' | t }}</button></div>
            @if (!isBranch()) { <p class="text-sm text-muted">{{ 'PlaceCat.viewBranchesOwn' | t }}</p> }
          </section>
        }
        }
      }
    </main>`,
})
export class PlaceCatalogPage extends AdminBase implements OnInit {
  protected readonly data = signal<PlaceData | null>(null);
  protected readonly sec = signal<'types' | 'cats' | 'view'>('types');
  protected readonly panel = signal<Panel>(null);
  protected readonly editOpen = signal<string | null>(null);
  protected readonly links = signal(new Set<string>());
  protected readonly th = TH;
  protected readonly softBtn = BTN_SOFT;
  protected readonly smBtn = 'min-h-9 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg disabled:opacity-60';
  protected readonly panelCls = 'flex flex-col gap-3 rounded-xl border border-line border-t-4 border-t-brand bg-surface p-5 shadow-card';
  protected readonly closeCls = 'min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold text-muted hover:bg-bg';
  private sel: { organizationId: string; branchId: string | null } | null = null;
  protected picked = new Set<string>();
  protected pickedSubs = new Set<string>();
  protected nwType: TypeModel = blankType();
  protected nwCat: CatModel = blankCat();
  protected nwSub: SubModel = { categoryId: '', nameEn: '', nameAr: '', isActive: true, sortOrder: 0, priorityCode: null };
  protected addToTypes = true;
  protected editType: Record<string, TypeModel> = {};
  protected editCat: Record<string, CatModel> = {};
  protected editSub: Record<string, SubModel> = {};
  protected view: View = { showOrganization: true, showBranch: true, showSystem: true };

  protected readonly usedTypes = computed(() => (this.data()?.types ?? []).filter((x) => x.used));
  protected readonly usedCats = computed(() => (this.data()?.categories ?? []).filter((x) => x.used));
  protected readonly usedKinds = computed(() => (this.data()?.kinds ?? []).filter((x) => x.used || this.isOwn(x)));
  protected readonly offeredTypes = computed(() => (this.data()?.types ?? []).filter((x) => x.offered && !x.used));
  protected readonly offeredCats = computed(() => (this.data()?.categories ?? []).filter((x) => x.offered && !x.used));
  protected readonly offeredSubs = computed(() => this.usedCats().flatMap((c) => c.subcategories.filter((s) => s.offered && !s.used)));
  protected readonly prios = computed(() => (this.data()?.priorities ?? []).filter((p) => p.isActive));
  protected readonly isBranch = computed(() => !!this.data()?.place?.branchId);
  /** The place's customers still get the system list: nothing of its own is not a problem then. */
  protected readonly seesSystem = computed(() => this.data()?.view?.showSystem ?? true);
  protected readonly isAdmin = inject(Auth).me()?.roles?.includes('admin') ?? false;
  protected readonly placeKey = computed(() => { const p = this.data()?.place; return p ? this.keyOf(p) : ''; });

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      if (!this.sel) {
        const first = await this.api.get<PlaceData>('place-catalog');
        const p = first.places[0];
        if (!p) { this.data.set(first); return; }
        this.sel = { organizationId: p.organizationId, branchId: p.branchId };
      }
      const q = 'place-catalog?org=' + this.sel.organizationId + (this.sel.branchId ? '&branch=' + this.sel.branchId : '');
      const d = await this.api.get<PlaceData>(q);
      this.editType = {}; this.editCat = {}; this.editSub = {};
      const links = d.links ?? [];
      for (const x of d.types ?? []) if (this.ownOf(d, x)) this.editType[x.id] = { code: x.code ?? '', nameEn: x.nameEn, nameAr: x.nameAr, descriptionEn: x.descriptionEn, descriptionAr: x.descriptionAr, examplesEn: x.examplesEn, examplesAr: x.examplesAr, sortOrder: x.sortOrder, isActive: x.isActive, categoryIds: links.filter((l) => l.typeId === x.id).map((l) => l.categoryId) };
      for (const c of d.categories ?? []) {
        if (this.ownOf(d, c)) this.editCat[c.id] = { nameEn: c.nameEn, nameAr: c.nameAr, teamKindId: c.teamKindId, isActive: c.isActive, sortOrder: c.sortOrder, priorityCode: c.priorityCode, isPrivate: c.isPrivate, autoAssign: c.autoAssign, typeIds: [] };
        for (const s of c.subcategories) if (this.ownOf(d, s)) this.editSub[s.id] = { categoryId: s.categoryId, nameEn: s.nameEn, nameAr: s.nameAr, isActive: s.isActive, sortOrder: s.sortOrder, priorityCode: s.priorityCode };
      }
      this.links.set(new Set(links.map((l) => `${l.typeId}:${l.categoryId}`)));
      this.view = { ...(d.view ?? this.view) };
      this.picked.clear(); this.pickedSubs.clear(); this.panel.set(null); this.editOpen.set(null);
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }

  // ---- places
  protected keyOf(p: Place): string { return p.organizationId + '|' + (p.branchId ?? ''); }
  protected placeLabel(p: Place): string { return p.branchId ? `${p.organizationName} · ${p.name}` : this.i18n.t('TeamPlace.wholeOrg', { name: p.name }); }
  protected placeName(): string { return this.data()?.place?.name ?? ''; }
  protected choosePlace(key: string): void {
    const [o, b] = key.split('|'); this.sel = { organizationId: o, branchId: b || null };
    this.msg.set(null); void this.reload();
  }
  protected go(s: 'types' | 'cats' | 'view'): void { this.sec.set(s); this.panel.set(null); this.editOpen.set(null); }
  protected open(p: Panel): void { this.picked.clear(); this.pickedSubs.clear(); this.panel.set(this.panel() === p ? null : p); }
  protected openSub(): void { this.nwSub.categoryId ||= this.usedCats()[0]?.id ?? ''; this.open('newSub'); }

  // ---- where an item comes from
  private ownOf(d: PlaceData, x: Owned): boolean { const p = d.place; return !!p && x.ownerOrganizationId === p.organizationId && (x.ownerBranchId ?? null) === p.branchId; }
  protected isOwn(x: Owned): boolean { const d = this.data(); return !!d && this.ownOf(d, x); }
  protected fromLabel(x: Owned): string {
    if (this.isOwn(x)) return this.i18n.t('PlaceCat.own');
    return x.ownerOrganizationId ? this.i18n.t('PlaceCat.fromOrg', { name: this.data()?.place?.organizationName ?? '' }) : this.i18n.t('PlaceCat.fromSystem');
  }
  protected fromTone(x: Owned): string { return this.isOwn(x) ? CHIP.own : x.ownerOrganizationId ? CHIP.org : CHIP.sys; }

  // ---- names
  protected kindName(id: string | null): string { const k = this.data()?.kinds?.find((x) => x.id === id); return k ? this.i18n.pick(k.nameEn, k.nameAr) : this.i18n.t('AdminCatalog.noTeam'); }
  protected handlerText(id: string | null): string {
    const h = this.data()?.kinds?.find((x) => x.id === id)?.handledBy;
    if (!id) return '';
    return h ? this.i18n.t('PlaceCat.handler_' + h.at, { name: this.i18n.pick(h.nameEn, h.nameAr), n: h.members }) : this.i18n.t('PlaceCat.handlerNone');
  }
  protected catName(id: string): string { const c = this.data()?.categories?.find((x) => x.id === id); return c ? this.i18n.pick(c.nameEn, c.nameAr) : ''; }
  protected prioName(code: string | null): string { const p = this.data()?.priorities?.find((x) => x.code === code); return p ? this.i18n.pick(p.nameEn, p.nameAr) : this.i18n.t('PlaceCat.prioDefault'); }
  protected typeNames(): string { return this.usedTypes().map((x) => this.i18n.pick(x.nameEn, x.nameAr)).join(', '); }
  protected usedSubsOf(c: PCat): PSub[] { return c.subcategories.filter((s) => s.used); }

  // ---- matrix
  protected linkCountOfType(id: string): number { return this.usedCats().filter((c) => this.links().has(`${id}:${c.id}`)).length; }
  protected linkCountOfCat(id: string): number { return this.usedTypes().filter((x) => this.links().has(`${x.id}:${id}`)).length; }
  protected flipLink(k: string): void { this.links.update((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }
  protected saveLinks(): void {
    const links = [...this.links()].map((k) => { const [typeId, categoryId] = k.split(':'); return { typeId, categoryId }; });
    void this.run(() => this.api.put('place-catalog/links', { ...this.sel, links }));
  }

  // ---- choose / stop
  protected flip(list: string[], id: string): void { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); }
  protected flipSet(s: Set<string>, id: string): void { if (s.has(id)) s.delete(id); else s.add(id); }
  protected use(kind: 'type' | 'cat' | 'sub'): void { const ids = [...this.picked]; void this.run(() => this.api.post('place-catalog/use', { ...this.sel, itemKind: kind, ids, use: true })); }
  protected useCats(): void {
    const cats = [...this.picked], subs = [...this.pickedSubs];
    void this.run(async () => {
      if (cats.length) await this.api.post('place-catalog/use', { ...this.sel, itemKind: 'cat', ids: cats, use: true });
      if (subs.length) await this.api.post('place-catalog/use', { ...this.sel, itemKind: 'sub', ids: subs, use: true });
    });
  }
  protected stop(kind: 'type' | 'cat' | 'sub', id: string): void { void this.run(() => this.api.post('place-catalog/use', { ...this.sel, itemKind: kind, ids: [id], use: false })); }

  // ---- create your own
  protected async createType(): Promise<void> {
    if (await this.run(() => this.api.post('place-catalog/types', { ...this.sel, item: { ...this.nwType, code: this.nwType.code || null } }))) this.nwType = blankType();
  }
  protected updateType(x: PType): void { const m = this.editType[x.id]; void this.run(() => this.api.put('place-catalog/types/' + x.id, { ...this.sel, item: { ...m, code: m.code || null } })); }
  protected async createCat(): Promise<void> {
    const item = { ...this.nwCat, defaultTeamId: null, typeIds: this.addToTypes ? this.usedTypes().map((x) => x.id) : [] };
    if (await this.run(() => this.api.post('place-catalog/categories', { ...this.sel, item }))) this.nwCat = blankCat();
  }
  protected updateCat(c: PCat): void { void this.run(() => this.api.put('place-catalog/categories/' + c.id, { ...this.sel, item: { ...this.editCat[c.id], defaultTeamId: null, typeIds: null } })); }
  protected async createSub(): Promise<void> {
    if (await this.run(() => this.api.post('place-catalog/subcategories', { ...this.sel, item: this.nwSub }))) this.nwSub = { ...this.nwSub, nameEn: '', nameAr: '', priorityCode: null, sortOrder: 0 };
  }
  protected updateSub(s: PSub): void { void this.run(() => this.api.put('place-catalog/subcategories/' + s.id, { ...this.sel, item: this.editSub[s.id] })); }
  protected remove(kind: 'types' | 'categories' | 'subcategories', id: string): void {
    const q = '?org=' + this.sel!.organizationId + (this.sel!.branchId ? '&branch=' + this.sel!.branchId : '');
    void this.run(() => this.api.del(`place-catalog/${kind}/${id}${q}`), 'AdminV2.deleted');
  }

  // ---- what the customers see
  protected viewOk(): boolean { return this.view.showOrganization || this.view.showSystem || (this.isBranch() && this.view.showBranch); }
  protected saveView(): void { void this.run(() => this.api.put('place-catalog/view', { ...this.sel, ...this.view })); }
}
