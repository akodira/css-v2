import { RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, OnInit, WritableSignal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TPipe } from '../../core/i18n';
import { SiteService } from '../../core/api';
import { AddPanel, Alert, Req, ReqNote, TONE_CLASS, Tone } from '../../shared/ui';
import { AdminBase, HEADER, SEARCH } from './admin-pages';
import { PageAbout } from '../../shared/page-about';

const CHECK = 'flex min-h-11 items-center gap-2';

// The page lives in escalation-page.ts; the routes still import it from here.
export { AdminEscalationPage } from './escalation-page';

// ================================================================== knowledge base (admin)

interface KbCat { id: string; slug: string; nameEn: string; nameAr: string; sortOrder: number; isActive: boolean }
interface KbArt { id: string; categoryId: string | null; slug: string; titleEn: string; titleAr: string | null; bodyEn: string; bodyAr: string | null; status: string; visibility: string; helpfulCount: number; notHelpfulCount: number; updatedAt: string }
type CatModel = Omit<KbCat, 'id'>;
type ArtModel = Omit<KbArt, 'id' | 'helpfulCount' | 'notHelpfulCount' | 'updatedAt'>;
const blankKbCat = (): CatModel => ({ slug: '', nameEn: '', nameAr: '', sortOrder: 0, isActive: true });
const blankArt = (): ArtModel => ({ categoryId: null, slug: '', titleEn: '', titleAr: '', bodyEn: '', bodyAr: '', status: 'draft', visibility: 'customers' });

@Component({
  selector: 'app-admin-kb',
  imports: [TPipe, Alert, AddPanel, FormsModule, Req, ReqNote, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminKb.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminKb.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <ng-template #catForm let-m="m" let-id="id" let-isNew="isNew" let-box="box">
        <form [class]="isNew ? 'flex flex-col gap-4' : formCls" novalidate (ngSubmit)="isNew ? createCat(box) : updateCat(id)">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.slug' | t }}<app-req /></span><input name="sl" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="m.slug" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.sort' | t }}<input name="so" type="number" min="0" [class]="cls.input + ' font-normal'" [(ngModel)]="m.sortOrder" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.nameEn' | t }}<app-req /></span><input name="en" dir="ltr" maxlength="120" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.nameAr' | t }}<app-req /></span><input name="ar" dir="rtl" maxlength="120" [class]="cls.input + ' font-normal'" [(ngModel)]="m.nameAr" /></label>
          </div>
          <label class="${CHECK}"><input type="checkbox" name="ac" class="h-5 w-5" [(ngModel)]="m.isActive" /> {{ 'AdminKb.active' | t }}</label>
          <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (isNew ? 'AdminKb.addCategory' : 'AdminKb.save') | t }}</button><app-req-note /></div>
        </form>
      </ng-template>
      <ng-template #artForm let-m="m" let-id="id" let-isNew="isNew" let-box="box">
        <div class="flex flex-col gap-3">
          <form [class]="isNew ? 'flex flex-col gap-4' : formCls" novalidate (ngSubmit)="isNew ? createArt(box) : updateArt(id)">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.slug' | t }}<app-req /></span><input name="sl" dir="ltr" maxlength="80" [class]="cls.input + ' font-normal'" [(ngModel)]="m.slug" /></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.category' | t }}
                <select name="ca" [class]="cls.input + ' font-normal'" [(ngModel)]="m.categoryId"><option [ngValue]="null">{{ 'AdminKb.noCategory' | t }}</option>@for (c of data()?.categories ?? []; track c.id) { <option [ngValue]="c.id">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.statusLabel' | t }}
                <select name="st" [class]="cls.input + ' font-normal'" [(ngModel)]="m.status">@for (x of ['draft', 'published', 'archived']; track x) { <option [value]="x">{{ 'AdminKb.status.' + x | t }}</option> }</select></label>
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.visibilityLabel' | t }}
                <select name="vi" [class]="cls.input + ' font-normal'" [(ngModel)]="m.visibility">@for (x of ['public', 'customers', 'internal']; track x) { <option [value]="x">{{ 'AdminKb.visibility.' + x | t }}</option> }</select></label>
            </div>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.titleEn' | t }}<app-req /></span><input name="te" dir="ltr" maxlength="200" [class]="cls.input + ' font-normal'" [(ngModel)]="m.titleEn" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.titleAr' | t }}<input name="ta" dir="rtl" maxlength="200" [class]="cls.input + ' font-normal'" [(ngModel)]="m.titleAr" /></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold"><span>{{ 'AdminKb.bodyEn' | t }}<app-req /></span><textarea name="be" rows="8" dir="ltr" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.bodyEn"></textarea></label>
            <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminKb.bodyAr' | t }}<textarea name="ba" rows="8" dir="rtl" class="rounded-lg border border-line bg-surface p-3 text-base font-normal" [(ngModel)]="m.bodyAr"></textarea></label>
            <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (isNew ? 'AdminKb.addArticle' : 'AdminKb.save') | t }}</button><app-req-note /></div>
          </form>
          @if (!isNew) { <div><button type="button" [class]="cls.btn" [disabled]="busy()" (click)="del('kb-articles/' + id)">{{ 'AdminKb.delete' | t }}</button></div> }
        </div>
      </ng-template>

      <section aria-labelledby="cats" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-start justify-between gap-3"><h2 id="cats" class="text-xl font-bold">{{ 'AdminKb.categories' | t }}</h2>
          <app-add #addCat label="AdminKb.addCategory"><ng-container *ngTemplateOutlet="catForm; context: { m: nwCat, id: 'new', isNew: true, box: addCat }" /></app-add></div>
        @for (c of data()?.categories ?? []; track c.id) {
          <details [class]="box"><summary [class]="sum">{{ i18n.pick(c.nameEn, c.nameAr) }} <span dir="ltr" class="text-sm font-normal text-muted">({{ c.slug }}@if (!c.isActive) {, {{ 'AdminKb.inactive' | t }} })</span></summary>
            <div class="p-3"><ng-container *ngTemplateOutlet="catForm; context: { m: ec[c.id], id: c.id, isNew: false }" /></div></details>
        }
      </section>
      <section aria-labelledby="arts" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-start justify-between gap-3"><h2 id="arts" class="text-xl font-bold">{{ 'AdminKb.articles' | t }}</h2>
          <app-add #addArt label="AdminKb.addArticle"><ng-container *ngTemplateOutlet="artForm; context: { m: nwArt, id: 'new', isNew: true, box: addArt }" /></app-add></div>
        @if (data() && !data()!.articles.length) { <p class="text-muted">{{ 'AdminKb.noArticles' | t }}</p> }
        @for (a of data()?.articles ?? []; track a.id) {
          <details [class]="box"><summary [class]="sum" dir="auto">{{ a.titleEn }} <span class="text-sm font-normal text-muted">({{ 'AdminKb.status.' + a.status | t }}, {{ a.helpfulCount }}/{{ a.notHelpfulCount }})</span></summary>
            <div class="p-3"><ng-container *ngTemplateOutlet="artForm; context: { m: ea[a.id], id: a.id, isNew: false }" /></div></details>
        }
      </section>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AdminKbPage extends AdminBase implements OnInit {
  protected readonly formCls = 'flex flex-col gap-4 rounded-md border border-line bg-surface p-5';
  protected readonly box = 'rounded-md border border-line bg-surface';
  protected readonly sum = 'min-h-11 cursor-pointer px-5 py-3 font-semibold';
  protected readonly data = signal<{ categories: KbCat[]; articles: KbArt[] } | null>(null);
  protected readonly arts = computed(() => (this.data()?.articles ?? []).filter((a) => this.matches(a.titleEn, a.titleAr, a.slug)));
  protected nwArt: ArtModel = blankArt();
  protected nwCat: CatModel = blankKbCat();
  protected ea: Record<string, ArtModel> = {};
  protected ec: Record<string, CatModel> = {};

  async ngOnInit(): Promise<void> { await this.reload(); }
  protected async reload(): Promise<void> {
    try {
      const d = await this.api.get<{ categories: KbCat[]; articles: KbArt[] }>('kb');
      for (const a of d.articles) this.ea[a.id] = { categoryId: a.categoryId, slug: a.slug, titleEn: a.titleEn, titleAr: a.titleAr ?? '', bodyEn: a.bodyEn, bodyAr: a.bodyAr ?? '', status: a.status, visibility: a.visibility };
      for (const c of d.categories) this.ec[c.id] = { slug: c.slug, nameEn: c.nameEn, nameAr: c.nameAr, sortOrder: c.sortOrder, isActive: c.isActive };
      this.data.set(d);
    } catch (e) { this.fail(e); }
  }
  protected async createArt(box: { open: boolean }): Promise<void> { if (await this.run(() => this.api.post('kb-articles', this.nwArt))) { this.nwArt = blankArt(); box.open = false; } }
  protected updateArt(id: string): void { void this.run(() => this.api.put('kb-articles/' + id, this.ea[id])); }
  protected async createCat(box: { open: boolean }): Promise<void> { if (await this.run(() => this.api.post('kb-categories', this.nwCat))) { this.nwCat = blankKbCat(); box.open = false; } }
  protected updateCat(id: string): void { void this.run(() => this.api.put('kb-categories/' + id, this.ec[id])); }
  protected del(path: string): void { void this.run(() => this.api.del(path), 'AdminV2.deleted'); }
}
