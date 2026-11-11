import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../core/auth';
import { MenuRow, SiteService } from '../../core/api';
import { adminError } from '../../core/admin-api';
import { apiUrl } from '../../core/api-base';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { CLS, Msg } from './admin-pages';

const CHECK = 'flex min-h-11 items-center gap-2';
const TABS = ['', 'home', 'menus', 'email', 'templates', 'messages', 'uploads', 'system', 'signin-codes', 'handover'];
const TAB_LABEL: Record<string, string> = {
  '': 'tabBranding', home: 'tabHome', menus: 'tabMenus', email: 'tabEmail', templates: 'tabTemplates', messages: 'tabMessages',
  uploads: 'tabUploads', system: 'tabSystem', 'signin-codes': 'tabSigninCodes', handover: 'tabHandover',
};

/** Shared helpers for every settings tab: the API, the message line and a save wrapper. */
abstract class Tab {
  protected readonly i18n = inject(I18n);
  protected readonly http = inject(HttpClient);
  protected readonly site = inject(SiteService);
  protected readonly cls = CLS;
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);
  private readonly cdr = inject(ChangeDetectorRef);
  /** Loads data and schedules a re-render: tabs keep plain fields, which zoneless Angular does not track on its own. */
  protected async get<T>(p: string): Promise<T> {
    const r = await firstValueFrom(this.http.get<T>('/api/admin/settings/' + p));
    this.cdr.markForCheck();
    return r;
  }
  protected put(p: string, b: unknown): Promise<unknown> { return firstValueFrom(this.http.put('/api/admin/settings/' + p, b)); }
  protected post<T = unknown>(p: string, b: unknown): Promise<T> { return firstValueFrom(this.http.post<T>('/api/admin/settings/' + p, b)); }
  protected del(p: string): Promise<unknown> { return firstValueFrom(this.http.delete('/api/admin/settings/' + p)); }
  protected async save(fn: () => Promise<unknown>, ok = 'AdminCommon.saved', params?: Record<string, unknown>): Promise<boolean> {
    this.busy.set(true); this.msg.set(null);
    try { await fn(); this.msg.set({ tone: 'success', text: this.i18n.t(ok, params) }); await this.site.load(); return true; }
    catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); return false; }
    finally { this.busy.set(false); }
  }
}
const MSG = `@if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }`;
const SAVE = `<div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button></div>`;
/** Save with the "* Required" legend after it (v1 forms that have required fields). */
const SAVE_REQ = `<div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>`;
const REQ = `<app-req />`;

// ================================================================== branding

@Component({
  selector: 'app-set-branding',
  imports: [TPipe, FormsModule, Alert],
  template: `
    ${MSG}
    @if (m) {
      <form class="flex flex-col gap-6" (ngSubmit)="submit()">
        @for (sec of sections; track sec.title) {
          <fieldset [class]="cls.card + ' flex flex-col gap-4 p-5'">
            <legend class="sr-only">{{ 'AdminGeneral.' + sec.title | t }}</legend>
            <div><h2 class="text-lg font-bold">{{ 'AdminGeneral.' + sec.title | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.' + sec.title + 'Hint' | t }}</p></div>
            @if (sec.image) {
              <div class="flex flex-wrap items-center gap-3">
                <span [class]="cls.label">{{ 'AdminGeneral.' + sec.image | t }}</span>
                @if (img(sec.image); as src) { <img [src]="src" alt="" class="h-12 w-12 rounded border border-line object-contain" /> } @else { <span class="text-sm text-muted">{{ 'AdminGeneral.defaultIcon' | t }}</span> }
                <label [class]="cls.btn2 + ' inline-flex cursor-pointer items-center'">{{ busy() ? ('AdminGeneral.uploading' | t) : ('AdminCatalog.edit' | t) }}
                  <input type="file" class="sr-only" accept=".png,.jpg,.jpeg,.webp,.svg,.ico" (change)="upload(sec.image, $any($event.target))" /></label>
                @if (img(sec.image)) { <button type="button" [class]="cls.btn2" (click)="remove(sec.image)">{{ 'AdminGeneral.removeImage' | t }}</button> }
                <p class="w-full text-sm text-muted">{{ 'AdminGeneral.' + sec.image + 'Hint' | t }}</p>
              </div>
            }
            <div class="grid gap-4 md:grid-cols-2">
              @for (f of sec.fields; track f) {
                <div [class]="'flex flex-col gap-1.5' + (f.startsWith('homeIntro') || f.startsWith('loginNotice') ? ' md:col-span-2' : '')">
                  <label [for]="'b-' + f" [class]="cls.label">{{ 'AdminGeneral.' + f | t }}</label>
                  @if (f.startsWith('homeIntro') || f.startsWith('loginNotice') || f.startsWith('footerText')) {
                    <textarea [id]="'b-' + f" [name]="f" rows="3" [attr.dir]="f.endsWith('Ar') ? 'rtl' : 'auto'" [class]="cls.input + ' py-2'" [(ngModel)]="m[f]"></textarea>
                  } @else {
                    <input [id]="'b-' + f" [name]="f" [attr.dir]="f.endsWith('Ar') ? 'rtl' : f.startsWith('contact') && !f.startsWith('contactHours') ? 'ltr' : 'auto'" [class]="cls.input" [(ngModel)]="m[f]" />
                  }
                </div>
              }
            </div>
          </fieldset>
        }
        <fieldset [class]="cls.card + ' flex flex-col gap-3 p-5'">
          <legend class="sr-only">{{ 'AdminGeneral.secColor' | t }}</legend>
          <div><h2 class="text-lg font-bold">{{ 'AdminGeneral.secColor' | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.secColorHint' | t }}</p></div>
          <div class="flex flex-wrap items-center gap-3">
            <label for="b-color" [class]="cls.label">{{ 'AdminGeneral.brandColor' | t }}</label>
            <input id="b-color" name="color" type="color" class="h-11 w-16 cursor-pointer rounded border border-line" [ngModel]="m['brandColor'] || '#1f64e6'" (ngModelChange)="m['brandColor'] = $event" />
            <button type="button" [class]="cls.btn2" (click)="m['brandColor'] = ''">{{ 'AdminGeneral.useDefaultColor' | t }}</button>
          </div>
        </fieldset>
        ${SAVE}
      </form>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class BrandingTab extends Tab implements OnInit {
  protected readonly sections = [
    { title: 'secSite', image: 'favicon', fields: ['siteNameEn', 'siteNameAr'] },
    { title: 'secHeader', image: 'logo', fields: ['headerNameEn', 'headerNameAr', 'headerSubEn', 'headerSubAr'] },
    { title: 'secFooter', image: '', fields: ['footerTextEn', 'footerTextAr', 'contactEmail', 'contactPhone', 'contactHoursEn', 'contactHoursAr'] },
    { title: 'secTexts', image: '', fields: ['homeTitleEn', 'homeTitleAr', 'homeIntroEn', 'homeIntroAr', 'loginNoticeEn', 'loginNoticeAr'] },
  ];
  protected m: Record<string, string> | null = null;
  private paths = signal<{ logo: string | null; favicon: string | null }>({ logo: null, favicon: null });

  async ngOnInit(): Promise<void> {
    const s = await this.get<Record<string, string | null>>('branding');
    this.m = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? '']));
    this.paths.set({ logo: s['logoPath'] ?? null, favicon: s['faviconPath'] ?? null });
  }
  protected img(kind: string): string | null { const p = kind === 'logo' ? this.paths().logo : this.paths().favicon; return p ? apiUrl('/api/site/branding/' + p) : null; }
  protected submit(): void { void this.save(() => this.put('branding', this.m)); }
  protected async upload(kind: string, el: HTMLInputElement): Promise<void> {
    const f = el.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    if (await this.save(async () => { const r = await this.post<{ path: string }>('branding/' + kind, fd); this.paths.update((p) => ({ ...p, [kind]: r.path })); })) el.value = '';
  }
  protected remove(kind: string): void { void this.save(async () => { await this.del('branding/' + kind); this.paths.update((p) => ({ ...p, [kind]: null })); }); }
}

// ================================================================== home page

@Component({
  selector: 'app-set-home',
  imports: [TPipe, FormsModule, Alert],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminGeneral.homeIntro' | t }}</p>
    <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
      <h2 class="text-lg font-bold">{{ 'AdminGeneral.homeSec_popular' | t }}</h2>
      <p class="text-sm text-muted">{{ 'AdminGeneral.homeSecHint_popular' | t }}</p>
      <label class="${CHECK}"><input type="checkbox" name="show" class="h-5 w-5" [(ngModel)]="m.showPopular" /> {{ 'AdminGeneral.homeShow' | t }}</label>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><label for="h-en" [class]="cls.label">{{ 'AdminGeneral.home_popularTitle' | t }} (EN)</label><input id="h-en" name="en" dir="ltr" maxlength="120" [class]="cls.input" [(ngModel)]="m.popularTitleEn" [placeholder]="'Home.d.popularTitle' | t" /></div>
        <div class="flex flex-col gap-1.5"><label for="h-ar" [class]="cls.label">{{ 'AdminGeneral.home_popularTitle' | t }} (AR)</label><input id="h-ar" name="ar" dir="rtl" maxlength="120" [class]="cls.input" [(ngModel)]="m.popularTitleAr" /></div>
      </div>
      <p class="text-sm text-muted">{{ 'AdminGeneral.homeNote' | t }}</p>
      ${SAVE}
    </form>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class HomeTab extends Tab implements OnInit {
  protected m = { showPopular: true, popularTitleEn: '', popularTitleAr: '' };
  ngOnInit(): void {
    try {
      const h = JSON.parse(this.site.info()?.site?.homeContent ?? '{}') as { show?: { popular?: boolean }; texts?: Record<string, string> };
      this.m = { showPopular: h.show?.popular ?? true, popularTitleEn: h.texts?.['popularTitleEn'] ?? '', popularTitleAr: h.texts?.['popularTitleAr'] ?? '' };
    } catch { /* defaults */ }
  }
  protected submit(): void { void this.save(() => this.put('home', this.m)); }
}

// ================================================================== menus

type MenuModel = { area: string; parentId: string | null; kind: string; labelEn: string; labelAr: string; href: string; audience: string; newTab: boolean; isVisible: boolean; sortOrder: number };
interface MenuFull extends Omit<MenuRow, 'audience'> { audience: string; isVisible: boolean }

@Component({
  selector: 'app-set-menus',
  imports: [TPipe, FormsModule, Alert, NgTemplateOutlet],
  template: `
    ${MSG}
    @for (area of areas; track area) {
      <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
        <div><h2 class="text-lg font-bold">{{ 'AdminGeneral.menuArea.' + area | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.menuAreaHint.' + area | t }}</p></div>
        <ul class="flex flex-col gap-2">
          @for (r of itemsOf(area); track r.id) {
            <li class="rounded-lg border border-line" [class.ms-6]="!!r.parentId">
              <div class="flex flex-wrap items-center gap-2 px-3 py-2">
                <span class="min-w-0 flex-1 font-semibold" dir="auto">{{ i18n.pick(r.labelEn, r.labelAr) }}
                  <span class="font-mono text-xs font-normal text-muted" dir="ltr">{{ r.kind === 'group' ? ('AdminGeneral.groupLabel' | t) : r.href }}</span>
                  @if (r.systemKey) { <span class="text-sm font-normal text-muted"> · {{ 'AdminGeneral.builtIn' | t }}</span> }
                  @else if (area === 'header' || area === 'footer') { <span class="text-sm font-normal text-muted"> · {{ 'AdminGeneral.aud_' + r.audience | t }}</span> }
                  @if (!r.isVisible) { <span [class]="cls.badgeWarn + ' ms-1'">{{ 'AdminGeneral.hidden' | t }}</span> }</span>
                @if (area === 'header' || area === 'footer') {
                  <button type="button" [class]="cls.btn2" (click)="move(r, -1)" [attr.aria-label]="'AdminGeneral.moveUp' | t">▲</button>
                  <button type="button" [class]="cls.btn2" (click)="move(r, 1)" [attr.aria-label]="'AdminGeneral.moveDown' | t">▼</button>
                }
                <button type="button" [class]="cls.btn2" (click)="open.set(open() === r.id ? null : r.id)">{{ (open() === r.id ? 'AdminGeneral.close' : 'AdminGeneral.edit') | t }}</button>
                @if (!r.systemKey) { <button type="button" [class]="cls.danger" (click)="remove(r)">{{ 'AdminGeneral.delete' | t }}</button> }
              </div>
              @if (open() === r.id) { <form class="border-t border-line p-3" (ngSubmit)="update(r)"><ng-container *ngTemplateOutlet="form; context: { m: ed[r.id], id: r.id, sys: !!r.systemKey }" /></form> }
            </li>
          } @empty { <li class="text-sm text-muted">{{ 'AdminGeneral.emptyMenu' | t }}</li> }
        </ul>
        <div class="flex flex-wrap gap-2">
          <button type="button" [class]="cls.btn2" (click)="startNew(area, 'link')">{{ 'AdminGeneral.addLink' | t }}</button>
          @if (area === 'header') { <button type="button" [class]="cls.btn2" (click)="startNew(area, 'group')">{{ 'AdminGeneral.addGroup' | t }}</button> }
        </div>
        @if (nw?.area === area) { <form class="rounded-lg border border-dashed border-line p-3" (ngSubmit)="create()"><ng-container *ngTemplateOutlet="form; context: { m: nw, id: 'new', sys: false }" /></form> }
      </section>
    }
    <ng-template #form let-m="m" let-id="id" let-sys="sys">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-1"><label [for]="id + 'en'" [class]="cls.label">{{ 'AdminGeneral.labelEn' | t }}</label><input [id]="id + 'en'" name="en" dir="ltr" maxlength="60" required [class]="cls.input" [(ngModel)]="m.labelEn" /></div>
        <div class="flex flex-col gap-1"><label [for]="id + 'ar'" [class]="cls.label">{{ 'AdminGeneral.labelAr' | t }}</label><input [id]="id + 'ar'" name="ar" dir="rtl" maxlength="60" required [class]="cls.input" [(ngModel)]="m.labelAr" /></div>
        @if (m.kind === 'link') {
          <div class="flex flex-col gap-1"><label [for]="id + 'h'" [class]="cls.label">{{ 'AdminGeneral.link' | t }}</label><input [id]="id + 'h'" name="h" dir="ltr" maxlength="500" [readonly]="sys" [class]="cls.input" [(ngModel)]="m.href" />
            <p class="text-xs text-muted">{{ (sys ? 'AdminGeneral.builtInLink' : 'AdminGeneral.linkHint') | t }}</p></div>
        }
        @if (m.area === 'header' || m.area === 'footer') {
          <div class="flex flex-col gap-1"><label [for]="id + 'a'" [class]="cls.label">{{ 'AdminGeneral.audience' | t }}</label>
            <select [id]="id + 'a'" name="a" [class]="cls.input" [(ngModel)]="m.audience">@for (a of audiences; track a) { <option [value]="a">{{ 'AdminGeneral.aud_' + a | t }}</option> }</select></div>
          @if (m.kind === 'link') {
            <div class="flex flex-col gap-1"><label [for]="id + 'p'" [class]="cls.label">{{ 'AdminGeneral.parent' | t }}</label>
              <select [id]="id + 'p'" name="p" [class]="cls.input" [(ngModel)]="m.parentId"><option [ngValue]="null">{{ 'AdminGeneral.noParent' | t }}</option>
                @for (g of groupsOf(m.area); track g.id) { <option [ngValue]="g.id">{{ i18n.pick(g.labelEn, g.labelAr) }}</option> }</select></div>
          }
        }
      </div>
      <div class="mt-2 flex flex-wrap gap-x-6">
        <label class="${CHECK}"><input type="checkbox" name="v" class="h-5 w-5" [(ngModel)]="m.isVisible" /> {{ 'AdminGeneral.visible' | t }}</label>
        @if (m.kind === 'link') { <label class="${CHECK}"><input type="checkbox" name="n" class="h-5 w-5" [(ngModel)]="m.newTab" /> {{ 'AdminGeneral.newTab' | t }}</label> }
      </div>
      <div class="mt-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button></div>
    </ng-template>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class MenusTab extends Tab implements OnInit {
  protected readonly areas = ['header', 'footer', 'console', 'admin', 'general'];
  protected readonly audiences = ['all', 'guest', 'signed_in', 'customer', 'staff'];
  protected readonly rows = signal<MenuFull[]>([]);
  protected readonly open = signal<string | null>(null);
  protected ed: Record<string, MenuModel> = {};
  protected nw: MenuModel | null = null;

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    const rows = await this.get<MenuFull[]>('menus');
    for (const r of rows) this.ed[r.id] = { area: r.area, parentId: r.parentId, kind: r.kind, labelEn: r.labelEn, labelAr: r.labelAr, href: r.href ?? '', audience: r.audience, newTab: r.newTab, isVisible: r.isVisible, sortOrder: r.sortOrder };
    this.rows.set(rows);
  }
  /** Top-level items in order, each group followed by its sub-items. */
  protected itemsOf(area: string): MenuFull[] {
    const all = this.rows().filter((r) => r.area === area).sort((a, b) => a.sortOrder - b.sortOrder);
    return all.filter((r) => !r.parentId).flatMap((r) => [r, ...all.filter((c) => c.parentId === r.id)]);
  }
  protected groupsOf(area: string): MenuFull[] { return this.rows().filter((r) => r.area === area && r.kind === 'group'); }
  protected startNew(area: string, kind: string): void {
    const max = Math.max(0, ...this.rows().filter((r) => r.area === area).map((r) => r.sortOrder));
    this.nw = { area, parentId: null, kind, labelEn: '', labelAr: '', href: '/', audience: 'all', newTab: false, isVisible: true, sortOrder: max + 10 };
  }
  protected async create(): Promise<void> { if (this.nw && await this.save(() => this.post('menus', this.nw))) { this.nw = null; await this.load(); } }
  protected async update(r: MenuFull): Promise<void> { if (await this.save(() => this.put('menus/' + r.id, this.ed[r.id]))) { this.open.set(null); await this.load(); } }
  protected async remove(r: MenuFull): Promise<void> { if (confirm(this.i18n.t(r.kind === 'group' ? 'AdminGeneral.confirmDeleteGroup' : 'AdminGeneral.confirmDelete')) && await this.save(() => this.del('menus/' + r.id), 'AdminV2.deleted')) await this.load(); }
  /** Swaps the order with the neighbour in the same list (same area and parent). */
  protected async move(r: MenuFull, dir: number): Promise<void> {
    const sib = this.rows().filter((x) => x.area === r.area && x.parentId === r.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const i = sib.findIndex((x) => x.id === r.id), j = i + dir;
    if (j < 0 || j >= sib.length) return;
    const a = { ...this.ed[r.id], sortOrder: sib[j].sortOrder }, b = { ...this.ed[sib[j].id], sortOrder: r.sortOrder === sib[j].sortOrder ? r.sortOrder + dir : r.sortOrder };
    if (await this.save(async () => { await this.put('menus/' + r.id, a); await this.put('menus/' + sib[j].id, b); })) await this.load();
  }
}

// ================================================================== email: SMTP, test, design

interface EmailData {
  useSmtp: boolean; host: string; port: number; security: string; username: string; hasPassword: boolean; fromName: string; fromEmail: string; replyTo: string;
  design: { headerColor: string; accentColor: string; pageBackground: string; logoUrl: string | null; showSiteName: boolean; rounded: boolean; largeCodeBox: boolean };
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null;
}

@Component({
  selector: 'app-set-email',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    @if (e) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="saveSmtp()">
        <label class="${CHECK} font-semibold"><input type="checkbox" name="use" class="h-5 w-5" [(ngModel)]="e.useSmtp" /> {{ 'AdminGeneral.useSmtp' | t }}</label>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label for="e-host" [class]="cls.label">{{ 'AdminGeneral.host' | t }}${REQ}</label><input id="e-host" name="host" dir="ltr" [class]="cls.input" [(ngModel)]="e.host" /></div>
          <div class="flex flex-col gap-1.5"><label for="e-port" [class]="cls.label">{{ 'AdminGeneral.port' | t }}${REQ}</label><input id="e-port" name="port" type="number" min="1" max="65535" dir="ltr" [class]="cls.input" [(ngModel)]="e.port" /></div>
          <div class="flex flex-col gap-1.5"><label for="e-sec" [class]="cls.label">{{ 'AdminGeneral.security' | t }}</label>
            <select id="e-sec" name="sec" [class]="cls.input" [(ngModel)]="e.security"><option value="starttls">{{ 'AdminGeneral.secStarttls' | t }}</option><option value="ssl">{{ 'AdminGeneral.secSsl' | t }}</option><option value="none">{{ 'AdminGeneral.secNone' | t }}</option></select>
            <p class="text-xs text-muted">{{ 'AdminGeneral.hint' + (e.security === 'ssl' ? 'Ssl' : e.security === 'none' ? 'None' : 'Starttls') | t }}</p></div>
          <div class="flex flex-col gap-1.5"><label for="e-user" [class]="cls.label">{{ 'AdminGeneral.username' | t }}</label><input id="e-user" name="user" dir="ltr" autocomplete="off" [class]="cls.input" [(ngModel)]="e.username" /></div>
          <div class="flex flex-col gap-1.5"><label for="e-pw" [class]="cls.label">{{ 'AdminGeneral.password' | t }}</label>
            <input id="e-pw" name="pw" type="password" dir="ltr" autocomplete="new-password" [class]="cls.input" [(ngModel)]="password" [placeholder]="e.hasPassword ? ('AdminGeneral.passwordSaved' | t) : ''" />
            <p class="text-xs text-muted">{{ (e.hasPassword ? 'AdminGeneral.passwordKeep' : 'AdminGeneral.passwordNone') | t }}</p>
            @if (e.hasPassword) { <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="clr" [(ngModel)]="clear" /> {{ 'AdminGeneral.clearPassword' | t }}</label> }</div>
          <div class="flex flex-col gap-1.5"><label for="e-fn" [class]="cls.label">{{ 'AdminGeneral.fromName' | t }}</label><input id="e-fn" name="fn" dir="auto" [class]="cls.input" [(ngModel)]="e.fromName" /></div>
          <div class="flex flex-col gap-1.5"><label for="e-fe" [class]="cls.label">{{ 'AdminGeneral.fromEmail' | t }}${REQ}</label><input id="e-fe" name="fe" type="email" dir="ltr" [class]="cls.input" [(ngModel)]="e.fromEmail" /></div>
          <div class="flex flex-col gap-1.5"><label for="e-rt" [class]="cls.label">{{ 'AdminGeneral.replyTo' | t }}</label><input id="e-rt" name="rt" type="email" dir="ltr" [class]="cls.input" [(ngModel)]="e.replyTo" /></div>
        </div>
        ${SAVE_REQ}
      </form>

      <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
        <h2 class="text-lg font-bold">{{ 'AdminGeneral.testTitle' | t }}</h2>
        <p class="text-sm text-muted">{{ 'AdminGeneral.testHint' | t: { email: me() } }}</p>
        <div><button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="test()">{{ busy() ? ('AdminGeneral.testing' | t) : ('AdminGeneral.testSend' | t) }}</button></div>
        @if (e.lastTestAt) {
          <p class="text-sm" [class]="e.lastTestOk ? 'text-ok' : 'text-danger'">{{ e.lastTestOk ? ('AdminGeneral.lastOk' | t: { when: i18n.date(e.lastTestAt) }) : ('AdminGeneral.lastFailed' | t: { when: i18n.date(e.lastTestAt), reason: e.lastTestError ?? '' }) }}</p>
        }
      </section>

      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="saveDesign()">
        <div><h2 class="text-lg font-bold">{{ 'AdminGeneral.designTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.designIntro' | t }}</p></div>
        <div class="flex flex-wrap gap-6">
          @for (c of colors; track c.key) {
            <label class="flex items-center gap-2 text-sm font-semibold"><input type="color" [name]="c.key" class="h-10 w-14 cursor-pointer rounded border border-line" [(ngModel)]="$any(d)[c.key]" /> {{ 'AdminGeneral.' + c.label | t }}</label>
          }
        </div>
        <label class="${CHECK}"><input type="checkbox" name="logo" class="h-5 w-5" [(ngModel)]="d.useLogo" [disabled]="!site.logoUrl()" /> {{ 'AdminGeneral.designUseLogo' | t }}</label>
        @if (!site.logoUrl()) { <p class="-mt-2 text-sm text-muted">{{ 'AdminGeneral.designNoLogo' | t }}</p> }
        <label class="${CHECK}"><input type="checkbox" name="name" class="h-5 w-5" [(ngModel)]="d.showSiteName" /> {{ 'AdminGeneral.designShowName' | t }}</label>
        <label class="${CHECK}"><input type="checkbox" name="code" class="h-5 w-5" [(ngModel)]="d.largeCodeBox" /> {{ 'AdminGeneral.designCodeBox' | t }}</label>
        <fieldset class="flex gap-6"><legend [class]="cls.label">{{ 'AdminGeneral.designCorners' | t }}</legend>
          <label class="${CHECK}"><input type="radio" name="corners" [value]="true" [(ngModel)]="d.rounded" /> {{ 'AdminGeneral.designRound' | t }}</label>
          <label class="${CHECK}"><input type="radio" name="corners" [value]="false" [(ngModel)]="d.rounded" /> {{ 'AdminGeneral.designSquare' | t }}</label></fieldset>
        <div class="overflow-hidden border border-line" [style.background]="d.pageBackground" [class.rounded-xl]="d.rounded">
          <div class="px-5 py-4 font-bold text-white" [style.background]="d.headerColor">@if (d.showSiteName) { {{ siteName() }} }</div>
          <div class="m-4 bg-white p-5 text-sm" [class.rounded-lg]="d.rounded">
            <p>{{ 'Notifications.events.agent_reply.title' | t }}</p>
            @if (d.largeCodeBox) { <p class="my-3 inline-block border border-line px-4 py-2 font-mono text-2xl tracking-widest" [class.rounded-lg]="d.rounded">123456</p> }
            <p class="mt-3"><span class="inline-block px-4 py-2 font-semibold text-white" [class.rounded-lg]="d.rounded" [style.background]="d.accentColor">{{ 'Console.reply.submit' | t }}</span></p>
          </div>
        </div>
        <p class="text-sm text-muted">{{ 'AdminGeneral.designNote' | t }}</p>
        <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button>
          <button type="button" [class]="cls.btn2" (click)="resetDesign()">{{ 'AdminGeneral.designReset' | t }}</button></div>
      </form>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class EmailTab extends Tab implements OnInit {
  private readonly auth = inject(Auth);
  protected readonly colors = [{ key: 'headerColor', label: 'designHeaderBg' }, { key: 'accentColor', label: 'designAccent' }, { key: 'pageBackground', label: 'designPageBg' }];
  protected e: EmailData | null = null;
  protected d = { headerColor: '#0d1b3e', accentColor: '#1f64e6', pageBackground: '#f1f5fb', useLogo: false, showSiteName: true, rounded: true, largeCodeBox: true };
  protected password = '';
  protected clear = false;
  protected readonly me = computed(() => this.auth.me()?.email ?? '');
  protected readonly siteName = computed(() => this.i18n.pick(this.site.info()?.site?.siteNameEn, this.site.info()?.site?.siteNameAr));

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    this.e = await this.get<EmailData>('email');
    const x = this.e.design;
    this.d = { headerColor: x.headerColor, accentColor: x.accentColor, pageBackground: x.pageBackground, useLogo: !!x.logoUrl, showSiteName: x.showSiteName, rounded: x.rounded, largeCodeBox: x.largeCodeBox };
    this.password = ''; this.clear = false;
  }
  protected async saveSmtp(): Promise<void> {
    const e = this.e!;
    if (await this.save(() => this.put('email', { useSmtp: e.useSmtp, host: e.host, port: Number(e.port), security: e.security, username: e.username, password: this.password || null, clearPassword: this.clear, fromName: e.fromName, fromEmail: e.fromEmail, replyTo: e.replyTo }))) await this.load();
  }
  protected async test(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try {
      const r = await this.post<{ ok: boolean; error: string | null; to: string }>('email/test', {});
      this.msg.set(r.ok ? { tone: 'success', text: this.i18n.t('AdminGeneral.testOk', { email: r.to }) } : { tone: 'error', text: this.i18n.t('AdminGeneral.testFailed', { reason: r.error ?? '' }) });
      await this.load();
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); } finally { this.busy.set(false); }
  }
  protected saveDesign(): void { void this.save(() => this.put('email/design', this.d)); }
  protected resetDesign(): void { this.d = { headerColor: '#0d1b3e', accentColor: '#1f64e6', pageBackground: '#f1f5fb', useLogo: false, showSiteName: true, rounded: true, largeCodeBox: true }; }
}

// ================================================================== email templates

interface TplRow { event: string; locale: string; subject: string; body: string; button: string; link: string }
const AUTH_EVENTS = ['auth_signup', 'auth_recovery', 'auth_email_change', 'auth_invite', 'auth_magic_link', 'auth_reauth', 'auth_signin_code', 'auth_signin_code_blocked'];

@Component({
  selector: 'app-set-templates',
  imports: [TPipe, FormsModule, Alert],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminGeneral.tplIntro' | t }}</p>
    <div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <nav [attr.aria-label]="'AdminGeneral.tplList' | t" class="flex flex-col gap-1">
        @for (ev of events(); track ev) {
          <button type="button" (click)="pick(ev)" class="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-start text-sm font-semibold"
            [class]="ev === cur() ? 'bg-brand text-white' : 'hover:bg-bg'">{{ title(ev) }}
            @if (edited(ev)) { <span class="text-xs" [class]="ev === cur() ? 'text-white/80' : 'text-muted'">{{ 'AdminGeneral.tplEdited' | t }}</span> }</button>
        }
      </nav>
      @if (cur(); as ev) {
        <div class="flex flex-col gap-4">
          <p class="text-sm text-muted">{{ who(ev) }}</p>
          <div class="grid gap-4 md:grid-cols-2">
            @for (loc of ['en', 'ar']; track loc) {
              <form [class]="cls.card + ' flex flex-col gap-3 p-4'" (ngSubmit)="saveTpl(ev, loc)">
                <h3 class="font-bold">{{ loc === 'en' ? 'English' : 'العربية' }}</h3>
                <label [for]="'s' + loc" [class]="cls.label">{{ 'AdminGeneral.tplSubject' | t }}</label>
                <input [id]="'s' + loc" name="s" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" maxlength="200" [class]="cls.input" [(ngModel)]="m[loc].subject" [placeholder]="def(ev, loc, 'title')" />
                <label [for]="'b' + loc" [class]="cls.label">{{ 'AdminGeneral.tplBody' | t }}</label>
                <textarea [id]="'b' + loc" name="b" rows="7" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" [class]="cls.input + ' py-2'" [(ngModel)]="m[loc].body" [placeholder]="def(ev, loc, 'body')"></textarea>
                <label [for]="'u' + loc" [class]="cls.label">{{ 'AdminGeneral.tplButtonOverride' | t }}</label>
                <input [id]="'u' + loc" name="u" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" maxlength="60" [class]="cls.input" [(ngModel)]="m[loc].button" />
                @if (!ev.startsWith('auth_')) {
                  <label [for]="'l' + loc" [class]="cls.label">{{ 'AdminGeneral.tplLink' | t }}</label>
                  <input [id]="'l' + loc" name="l" dir="ltr" maxlength="500" [class]="cls.input" [(ngModel)]="m[loc].link" [placeholder]="'AdminGeneral.tplLinkAuto' | t" />
                }
                <p class="text-xs text-muted">{{ 'AdminGeneral.tplPlaceholders' | t }} <span dir="ltr" class="font-mono">{{ '{' }}name{{ '}' }} {{ '{' }}reference{{ '}' }} {{ '{' }}subject{{ '}' }} {{ '{' }}status{{ '}' }} {{ '{' }}code{{ '}' }} {{ '{' }}minutes{{ '}' }} {{ '{' }}siteName{{ '}' }}</span></p>
                <div class="flex flex-wrap gap-2">
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button>
                  <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="testTpl(ev, loc)">{{ 'AdminGeneral.tplTestButton' | t }}</button>
                  @if (row(ev, loc)) { <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="reset(ev, loc)">{{ 'AdminGeneral.tplReset' | t }}</button> }
                </div>
              </form>
            }
          </div>
        </div>
      }
    </div>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class TemplatesTab extends Tab implements OnInit {
  private readonly auth = inject(Auth);
  protected readonly rows = signal<TplRow[]>([]);
  protected readonly cur = signal<string | null>(null);
  protected readonly events = computed(() => {
    const keys = ['ticket_created', 'ticket_assigned', 'agent_reply', 'customer_reply', 'status_changed', 'priority_changed', 'sla_warning', 'sla_breach', 'ticket_resolved', 'ticket_closed', 'ticket_reopened',
      'ticket_escalated', 'account_pending', 'account_approved', 'account_rejected', 'approval_requested', 'account_promoted', 'customer_reminder', 'customer_final_warning', 'resolved_reminder',
      'cancellation_requested', 'cancellation_rejected', 'password_expiring'];
    return [...keys, ...AUTH_EVENTS];
  });
  protected m: Record<string, { subject: string; body: string; button: string; link: string }> = { en: this.blank(), ar: this.blank() };

  async ngOnInit(): Promise<void> { await this.load(); this.pick(this.events()[0]); }
  private blank() { return { subject: '', body: '', button: '', link: '' }; }
  private async load(): Promise<void> { this.rows.set(await this.get<TplRow[]>('templates')); }
  protected row(ev: string, loc: string): TplRow | undefined { return this.rows().find((r) => r.event === ev && r.locale === loc); }
  protected edited(ev: string): boolean { return this.rows().some((r) => r.event === ev); }
  protected title(ev: string): string { const k = 'AdminGeneral.tplEvents.' + ev; return this.i18n.has(k) ? this.i18n.t(k) : ev; }
  protected who(ev: string): string { const k = 'AdminGeneral.tplWho.' + ev; return this.i18n.has(k) ? this.i18n.t(k) : ''; }
  protected def(ev: string, _loc: string, part: string): string { const k = `Notifications.events.${ev}.${part}`; return this.i18n.has(k) ? this.i18n.t(k) : ''; }
  protected pick(ev: string): void {
    this.cur.set(ev);
    for (const loc of ['en', 'ar']) { const r = this.row(ev, loc); this.m[loc] = r ? { subject: r.subject, body: r.body, button: r.button, link: r.link } : this.blank(); }
  }
  protected async saveTpl(ev: string, loc: string): Promise<void> { if (await this.save(() => this.put('templates', { event: ev, locale: loc, ...this.m[loc] }))) await this.load(); }
  protected async reset(ev: string, loc: string): Promise<void> { if (await this.save(() => this.del(`templates/${ev}/${loc}`))) { await this.load(); this.pick(ev); } }
  protected async testTpl(ev: string, loc: string): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try {
      const r = await this.post<{ ok: boolean; error: string | null }>(`templates/${ev}/${loc}/test`, {});
      this.msg.set(r.ok ? { tone: 'success', text: this.i18n.t('AdminGeneral.tplTestSent', { email: this.auth.me()?.email ?? '' }) } : { tone: 'error', text: this.i18n.t('AdminGeneral.tplTestFailed', { reason: r.error ?? '' }) });
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); } finally { this.busy.set(false); }
  }
}

// ================================================================== system messages (any text on any screen)

@Component({
  selector: 'app-set-messages',
  imports: [TPipe, FormsModule, Alert],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminSystemMessages.intro' | t }}</p>
    <div class="flex flex-wrap gap-2">
      <label for="sm-q" class="sr-only">{{ 'AdminSystemMessages.search' | t }}</label>
      <input id="sm-q" type="search" dir="auto" [placeholder]="'AdminSystemMessages.search' | t" [class]="cls.input + ' max-w-md'" [value]="q()" (input)="q.set($any($event.target).value)" />
      <label class="${CHECK} text-sm"><input type="checkbox" [checked]="onlyEdited()" (change)="onlyEdited.set(!onlyEdited())" /> {{ 'AdminSystemMessages.edited' | t }}</label>
    </div>
    <p class="text-sm text-muted">{{ 'AdminSystemMessages.shown' | t: { shown: shown().length, total: matches().length } }}</p>
    <ul class="flex flex-col gap-2">
      @for (k of shown(); track k) {
        <li [class]="cls.card + ' p-4'">
          <div class="flex flex-wrap items-center gap-2"><span class="font-mono text-xs text-muted" dir="ltr">{{ k }}</span>
            @if (isEdited(k)) { <span [class]="cls.badgeWarn">{{ 'AdminSystemMessages.edited' | t }}</span> }</div>
          @if (open() === k) {
            <form class="mt-3 grid gap-3 md:grid-cols-2" (ngSubmit)="saveMsg(k)">
              <div class="flex flex-col gap-1"><label [for]="'en' + k" [class]="cls.label">{{ 'AdminSystemMessages.english' | t }}</label>
                <textarea [id]="'en' + k" name="en" rows="3" dir="ltr" [class]="cls.input + ' py-2'" [(ngModel)]="ed.en" [placeholder]="std(k, 'en')"></textarea></div>
              <div class="flex flex-col gap-1"><label [for]="'ar' + k" [class]="cls.label">{{ 'AdminSystemMessages.arabic' | t }}</label>
                <textarea [id]="'ar' + k" name="ar" rows="3" dir="rtl" [class]="cls.input + ' py-2'" [(ngModel)]="ed.ar" [placeholder]="std(k, 'ar')"></textarea></div>
              <div class="flex flex-wrap gap-2 md:col-span-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSystemMessages.save' | t }}</button>
                <button type="button" [class]="cls.btn2" (click)="ed = { en: '', ar: '' }; saveMsg(k)">{{ 'AdminSystemMessages.reset' | t }}</button>
                <button type="button" [class]="cls.btn2" (click)="open.set(null)">{{ 'AdminSystemMessages.cancel' | t }}</button></div>
            </form>
          } @else {
            <button type="button" class="mt-1 block w-full cursor-pointer text-start" (click)="edit(k)"><span dir="auto">{{ i18n.t(k) }}</span></button>
          }
        </li>
      }
    </ul>
    @if (matches().length > shown().length) { <button type="button" [class]="cls.btn2" (click)="limit.set(limit() + 100)">{{ 'AdminSystemMessages.more' | t }}</button> }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class MessagesTab extends Tab implements OnInit {
  protected readonly q = signal('');
  protected readonly onlyEdited = signal(false);
  protected readonly limit = signal(100);
  protected readonly open = signal<string | null>(null);
  private readonly keys = signal<string[]>([]);
  private readonly std_ = signal<{ en: Record<string, string>; ar: Record<string, string> }>({ en: {}, ar: {} });
  private readonly over = signal<{ key: string; locale: string; body: string }[]>([]);
  protected ed = { en: '', ar: '' };
  protected readonly matches = computed(() => {
    const s = this.q().trim().toLowerCase(); const st = this.std_();
    return this.keys().filter((k) => (!this.onlyEdited() || this.isEdited(k)) && (!s || k.toLowerCase().includes(s) || (st.en[k] ?? '').toLowerCase().includes(s) || (st.ar[k] ?? '').includes(s)));
  });
  protected readonly shown = computed(() => this.matches().slice(0, this.limit()));

  async ngOnInit(): Promise<void> {
    const [en, ar] = await Promise.all(['en', 'ar'].map((l) => firstValueFrom(this.http.get<Record<string, unknown>>(`/i18n/${l}.json`))));
    const flat = (o: Record<string, unknown>, p = '', out: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (typeof v === 'string') out[key] = v; else if (v && typeof v === 'object' && !Array.isArray(v)) flat(v as Record<string, unknown>, key, out); }
      return out;
    };
    const fe = flat(en), fa = flat(ar);
    this.std_.set({ en: fe, ar: fa });
    this.keys.set(Object.keys(fe).filter((k) => !k.startsWith('AdminV2.') && !k.startsWith('Help.')).sort());
    await this.loadOver();
  }
  private async loadOver(): Promise<void> { this.over.set(await this.get('messages')); }
  protected isEdited(k: string): boolean { return this.over().some((o) => o.key === k); }
  protected std(k: string, l: 'en' | 'ar'): string { return this.std_()[l][k] ?? ''; }
  protected edit(k: string): void {
    this.ed = { en: this.over().find((o) => o.key === k && o.locale === 'en')?.body ?? '', ar: this.over().find((o) => o.key === k && o.locale === 'ar')?.body ?? '' };
    this.open.set(k);
  }
  protected async saveMsg(k: string): Promise<void> { if (await this.save(() => this.put('messages', { key: k, en: this.ed.en, ar: this.ed.ar }))) { await this.loadOver(); this.open.set(null); } }
}

// ================================================================== uploads

const FILE_GROUPS: Record<string, string[]> = {
  images: ['png', 'jpg', 'jpeg', 'gif', 'webp'], documents: ['pdf', 'txt', 'doc', 'docx'], sheets: ['csv', 'xls', 'xlsx'], slides: ['ppt', 'pptx'], archives: ['zip'],
};

@Component({
  selector: 'app-set-uploads',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
      <p class="text-muted">{{ 'AdminGeneral.uploadsIntro' | t }}</p>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-1.5"><label for="u-mb" [class]="cls.label">{{ 'AdminGeneral.uploadMaxMb' | t }}${REQ}</label><input id="u-mb" name="mb" type="number" min="1" max="50" dir="ltr" [class]="cls.input" [(ngModel)]="m.maxMb" /></div>
        <div class="flex flex-col gap-1.5"><label for="u-n" [class]="cls.label">{{ 'AdminGeneral.uploadMaxFiles' | t }}${REQ}</label><input id="u-n" name="n" type="number" min="1" max="20" dir="ltr" [class]="cls.input" [(ngModel)]="m.maxFiles" /></div>
      </div>
      <p class="-mt-2 text-sm text-muted">{{ 'AdminGeneral.uploadLimitsHint' | t: { mb: 50, files: 20 } }}</p>
      <fieldset class="flex flex-col gap-3"><legend [class]="cls.label + ' mb-1'">{{ 'AdminGeneral.uploadTypes' | t }}</legend>
        @for (g of groups; track g) {
          <div><h3 class="text-sm font-semibold text-muted">{{ 'AdminGeneral.uploadGroup_' + g | t }}</h3>
            <div class="flex flex-wrap gap-x-5">@for (x of fileGroups[g]; track x) { <label class="flex min-h-10 items-center gap-2 font-mono text-sm"><input type="checkbox" class="h-5 w-5" [checked]="m.exts.has(x)" (change)="toggleExt(x)" /> .{{ x }}</label> }</div></div>
        }
      </fieldset>
      <p class="text-sm text-muted">{{ 'AdminGeneral.uploadsNote' | t }}</p>
      ${SAVE_REQ}
    </form>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class UploadsTab extends Tab implements OnInit {
  protected readonly groups = Object.keys(FILE_GROUPS);
  protected readonly fileGroups = FILE_GROUPS;
  protected m = { maxMb: 10, maxFiles: 5, exts: new Set<string>() };
  ngOnInit(): void {
    const s = this.site.info()?.site;
    let exts: string[] = [];
    try { exts = JSON.parse(s?.uploadExtensions ?? '[]'); } catch { exts = []; }
    this.m = { maxMb: s?.uploadMaxMb ?? 10, maxFiles: s?.uploadMaxFiles ?? 5, exts: new Set(exts) };
  }
  protected toggleExt(x: string): void { if (this.m.exts.has(x)) this.m.exts.delete(x); else this.m.exts.add(x); }
  protected submit(): void { void this.save(() => this.put('uploads', { maxMb: Number(this.m.maxMb), maxFiles: Number(this.m.maxFiles), extensions: [...this.m.exts] })); }
}

// ================================================================== system rules, registration, captcha, password policy

@Component({
  selector: 'app-set-system',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminSettings.subtitle' | t }}</p>
    @if (loaded()) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="saveRules()">
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of basic.slice(0, 2); track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSettings.' + f.label | t }}${REQ}</label>
              <input [id]="f.key" [name]="f.key" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[f.key]" />
              @if (f.hint) { <p class="text-xs text-muted">{{ 'AdminSettings.' + f.hint | t }}</p> }</div>
          }
        </div>
        <h2 class="mt-2 text-lg font-bold">{{ 'AdminSettings.timersTitle' | t }}</h2>
        <p class="-mt-2 text-sm text-muted">{{ 'AdminSettings.timersHelp' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of timers; track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSettings.' + f.label | t }}${REQ}</label><input [id]="f.key" [name]="f.key" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[f.key]" /></div>
          }
        </div>
        <p class="text-sm text-muted">{{ 'AdminSettings.timersHint' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of basic.slice(2); track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSettings.' + f.label | t }}${REQ}</label>
              <input [id]="f.key" [name]="f.key" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[f.key]" />
              @if (f.hint) { <p class="text-xs text-muted">{{ 'AdminSettings.' + f.hint | t }}</p> }</div>
          }
        </div>
        <label class="${CHECK}"><input type="checkbox" name="email" class="h-5 w-5" [(ngModel)]="b['email_enabled']" /> {{ 'AdminSettings.email' | t }}</label>
        ${SAVE_REQ}
      </form>

      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="saveReg()">
        <h2 class="text-lg font-bold">{{ 'AdminSettings.regTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminSettings.regHelp' | t }}</p>
        @for (r of modes; track r) {
          <label class="flex items-start gap-2"><input type="radio" name="reg" class="mt-1 h-5 w-5" [value]="r" [(ngModel)]="reg" />
            <span><span class="font-semibold">{{ 'AdminSettings.reg_' + r | t }}</span><span class="block text-sm text-muted">{{ 'AdminSettings.reg_' + r + '_help' | t }}</span></span></label>
        }
        <p class="text-sm text-muted">{{ 'AdminSettings.regNote' | t }}</p>
        ${SAVE}
      </form>

      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="saveCaptcha()">
        <h2 class="text-lg font-bold">{{ 'AdminSettings.captchaTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminSettings.captchaHelp' | t }} {{ 'AdminSettings.captchaAlso' | t }}</p>
        @if (reg === 'pick_auto') { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'AdminSettings.captchaRecommended' | t }}</p> }
        <label class="${CHECK}"><input type="checkbox" name="cap" class="h-5 w-5" [(ngModel)]="cap.enabled" /> {{ 'AdminSettings.captchaEnable' | t }}</label>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label for="c-key" [class]="cls.label">{{ 'AdminSettings.captchaSiteKey' | t }}</label><input id="c-key" name="key" dir="ltr" [class]="cls.input" [(ngModel)]="cap.siteKey" /></div>
          <div class="flex flex-col gap-1.5"><label for="c-sec" [class]="cls.label">{{ 'AdminSettings.captchaSecretKey' | t }}</label><input id="c-sec" name="sec" type="password" dir="ltr" autocomplete="off" [class]="cls.input" [(ngModel)]="cap.secret" />
            @if (cap.hasSecret) { <p class="text-xs text-muted">{{ 'AdminSettings.captchaSecretSaved' | t }}</p> }</div>
        </div>
        <p class="text-sm text-muted">{{ 'AdminSettings.captchaKeysHint' | t }}</p>
        ${SAVE}
      </form>

      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="savePw()">
        <h2 class="text-lg font-bold">{{ 'AdminSettings.pwTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminSettings.pwHelp' | t }}</p>
        <div class="flex flex-col gap-1.5 md:max-w-xs"><label for="pw-min" [class]="cls.label">{{ 'AdminSettings.pwMinLength' | t }}${REQ}</label><input id="pw-min" name="min" type="number" min="8" max="72" dir="ltr" [class]="cls.input" [(ngModel)]="n['password_min_length']" /></div>
        <fieldset><legend [class]="cls.label">{{ 'AdminSettings.pwComplexity' | t }}</legend>
          @for (x of [['password_require_upper', 'pwUpper'], ['password_require_lower', 'pwLower'], ['password_require_number', 'pwNumber'], ['password_require_special', 'pwSpecial']]; track x[0]) {
            <label class="${CHECK}"><input type="checkbox" [name]="x[0]" class="h-5 w-5" [(ngModel)]="b[x[0]]" /> {{ 'AdminSettings.' + x[1] | t }}</label>
          }</fieldset>
        <label class="${CHECK} font-semibold"><input type="checkbox" name="exp" class="h-5 w-5" [(ngModel)]="b['password_expiry_enabled']" /> {{ 'AdminSettings.pwExpire' | t }}</label>
        <p class="-mt-2 text-sm text-muted">{{ 'AdminSettings.pwExpireHelp' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
            @for (x of [['password_expiry_days', 'pwExpiryDays'], ['password_warn_1_days', 'pwWarn1'], ['password_warn_2_days', 'pwWarn2'], ['password_warn_3_days', 'pwWarn3']]; track x[0]) {
              <div class="flex flex-col gap-1.5"><label [for]="x[0]" [class]="cls.label">{{ 'AdminSettings.' + x[1] | t }}</label><input [id]="x[0]" [name]="x[0]" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[x[0]]" /></div>
            }
        </div>
        <p class="text-sm text-muted">{{ 'AdminSettings.pwWarnHint' | t }}</p>
        <p class="text-sm text-muted">{{ 'AdminSettings.pwApplies' | t }}</p>
        ${SAVE_REQ}
      </form>
      <p class="text-sm text-muted">{{ 'AdminSettings.note' | t }}</p>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SystemTab extends Tab implements OnInit {
  protected readonly basic = [
    { key: 'reopen_window_days', label: 'reopen', hint: 'reopenHint' }, { key: 'auto_close_days', label: 'autoClose', hint: 'autoCloseHint' },
    { key: 'min_reply_chars', label: 'minReply', hint: '' }, { key: 'auto_refresh_seconds', label: 'autoRefresh', hint: 'autoRefreshHint' },
  ];
  protected readonly timers = [
    { key: 'pending_reminder_1_day', label: 'reminder1' }, { key: 'pending_reminder_2_day', label: 'reminder2' }, { key: 'pending_final_day', label: 'finalWarning' },
    { key: 'no_response_close_days', label: 'noResponseClose' }, { key: 'resolved_reminder_day', label: 'resolvedReminder' },
  ];
  protected readonly modes = ['closed', 'approval', 'pick_approval', 'pick_auto'];
  private readonly defaults: Record<string, number> = {
    reopen_window_days: 30, auto_close_days: 5, min_reply_chars: 20, auto_refresh_seconds: 30, pending_reminder_1_day: 2, pending_reminder_2_day: 4, pending_final_day: 7,
    no_response_close_days: 10, resolved_reminder_day: 3, password_min_length: 10, password_expiry_days: 90, password_warn_1_days: 7, password_warn_2_days: 4, password_warn_3_days: 1,
  };
  protected readonly loaded = signal(false);
  protected n: Record<string, number> = {};
  protected b: Record<string, boolean> = {};
  protected reg = 'approval';
  protected cap = { enabled: false, siteKey: '', secret: '', hasSecret: false };

  async ngOnInit(): Promise<void> {
    const d = await this.get<{ settings: Record<string, string>; registrationMode: string; captcha: { enabled: boolean; siteKey: string; hasSecret: boolean } }>('system');
    for (const [k, v] of Object.entries(this.defaults)) this.n[k] = d.settings[k] !== undefined ? Number(JSON.parse(d.settings[k])) : v;
    for (const k of ['email_enabled', 'password_require_upper', 'password_require_lower', 'password_require_number', 'password_require_special', 'password_expiry_enabled'])
      this.b[k] = d.settings[k] !== undefined ? JSON.parse(d.settings[k]) === true : k.startsWith('password_require');
    this.reg = d.registrationMode;
    this.cap = { ...d.captcha, secret: '' };
    this.loaded.set(true);
  }
  private pick(keys: string[]): Record<string, unknown> { return Object.fromEntries(keys.map((k) => [k, k in this.b ? this.b[k] : Number(this.n[k])])); }
  protected saveRules(): void { void this.save(() => this.put('system', { settings: this.pick([...this.basic.map((x) => x.key), ...this.timers.map((x) => x.key), 'email_enabled']) })); }
  protected savePw(): void {
    void this.save(() => this.put('system', { settings: this.pick(['password_min_length', 'password_require_upper', 'password_require_lower', 'password_require_number', 'password_require_special',
      'password_expiry_enabled', 'password_expiry_days', 'password_warn_1_days', 'password_warn_2_days', 'password_warn_3_days']) }));
  }
  protected saveReg(): void { void this.save(() => this.put('registration', { mode: this.reg })); }
  protected async saveCaptcha(): Promise<void> { if (await this.save(() => this.put('captcha', { enabled: this.cap.enabled, siteKey: this.cap.siteKey, secret: this.cap.secret || null }))) { if (this.cap.secret) this.cap.hasSecret = true; this.cap.secret = ''; } }
}

// ================================================================== sign-in codes

@Component({
  selector: 'app-set-signin-codes',
  imports: [TPipe, FormsModule, Alert, RouterLink, Req, ReqNote],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminSigninCodes.intro' | t }}</p>
    @if (m) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
        <label class="${CHECK} font-semibold"><input type="checkbox" role="switch" name="on" class="h-5 w-5" [(ngModel)]="m.enabled" /> {{ 'AdminSigninCodes.switch' | t }}
          <span class="ms-2 rounded-full px-2 py-0.5 text-xs font-bold" [class]="m.enabled ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (m.enabled ? 'AdminSigninCodes.on' : 'AdminSigninCodes.off') | t }}</span></label>
        <p class="-mt-3 text-sm text-muted">{{ 'AdminSigninCodes.switchHint' | t }}</p>
        <fieldset class="flex flex-col gap-1"><legend [class]="cls.label">{{ 'AdminSigninCodes.who' | t }}</legend>
          @for (a of ['customers', 'all']; track a) {
            <label class="flex items-start gap-2"><input type="radio" name="who" class="mt-1 h-5 w-5" [value]="a" [(ngModel)]="m.audience" />
              <span><span class="font-semibold">{{ 'AdminSigninCodes.' + a | t }}</span><span class="block text-sm text-muted">{{ 'AdminSigninCodes.' + a + 'Hint' | t }}</span></span></label>
          }</fieldset>
        <h2 class="text-lg font-bold">{{ 'AdminSigninCodes.rules' | t }}</h2>
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of fields; track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="'sc' + f.key" [class]="cls.label">{{ 'AdminSigninCodes.' + f.label | t }}${REQ}</label>
              <div class="flex items-center gap-2"><input [id]="'sc' + f.key" [name]="f.key" type="number" dir="ltr" class="min-h-11 w-28 rounded-lg border border-line bg-surface px-3" [(ngModel)]="$any(m)[f.key]" />
                <span class="text-sm text-muted">{{ 'AdminSigninCodes.' + f.label + 'Unit' | t }}</span></div></div>
          }
        </div>
        <section class="rounded-lg bg-bg p-4"><h3 class="font-semibold">{{ 'AdminSigninCodes.safeTitle' | t }}</h3>
          <ul class="mt-1 list-disc ps-5 text-sm">@for (n of [1, 2, 3, 4]; track n) { <li>{{ 'AdminSigninCodes.safe' + n | t }}</li> }</ul></section>
        <section class="flex flex-col gap-2"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.mailTitle' | t }}</h2>
          <p class="text-muted">{{ 'AdminSigninCodes.mailHint' | t }}</p>
          <div><a [routerLink]="'/' + i18n.locale() + '/admin/general/settings/templates'" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'AdminSigninCodes.mailButton' | t }}</a></div></section>
        <section class="flex flex-col gap-2"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.previewTitle' | t }}</h2>
          <div aria-hidden="true" class="flex max-w-xs flex-col gap-2.5 rounded-xl border border-dashed border-muted p-4">
            <div class="flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-muted">{{ 'AdminSigninCodes.email' | t }}</div>
            <div class="flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-muted">{{ 'AdminSigninCodes.password' | t }}</div>
            <div class="flex min-h-11 items-center justify-center rounded-lg bg-brand font-bold text-white">{{ 'AdminSigninCodes.signIn' | t }}</div>
            <div class="text-center font-semibold text-brand-ink underline">{{ 'AdminSigninCodes.alt' | t }}</div>
          </div></section>
        ${SAVE_REQ}
      </form>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SigninCodesTab extends Tab implements OnInit {
  protected readonly fields = [
    { key: 'codeLength', label: 'length' }, { key: 'validMinutes', label: 'valid' }, { key: 'maxAttempts', label: 'attempts' },
    { key: 'cooldownSeconds', label: 'cooldown' }, { key: 'dailyLimit', label: 'daily' },
  ];
  protected m: { enabled: boolean; audience: string; codeLength: number; validMinutes: number; maxAttempts: number; cooldownSeconds: number; dailyLimit: number } | null = null;
  async ngOnInit(): Promise<void> { this.m = await this.get('signin-codes'); }
  protected submit(): void {
    const m = this.m!;
    void this.save(() => this.put('signin-codes', { enabled: m.enabled, audience: m.audience, codeLength: Number(m.codeLength), validMinutes: Number(m.validMinutes), maxAttempts: Number(m.maxAttempts), cooldownSeconds: Number(m.cooldownSeconds), dailyLimit: Number(m.dailyLimit) }));
  }
}

// ================================================================== handover

interface HandoverData {
  candidates: { id: string; fullName: string; email: string; typeEn: string | null; typeAr: string | null }[];
  types: { id: string; nameEn: string; nameAr: string }[];
  demo: { users: number; organizations: number; tickets: number; articles: number; realTickets: number; meIsDemo: boolean };
}

@Component({
  selector: 'app-set-handover',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    @if (d(); as x) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="transfer()">
        <h2 class="text-lg font-bold">{{ 'AdminHandover.transferTitle' | t }}</h2>
        <p class="text-sm text-muted">{{ 'AdminHandover.transferIntro' | t }}</p>
        @if (!x.candidates.length) { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'AdminHandover.noCandidates' | t }}</p> } @else {
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-1.5"><label for="ho-new" [class]="cls.label">{{ 'AdminHandover.newAdmin' | t }}${REQ}</label>
              <select id="ho-new" name="new" [class]="cls.input" [(ngModel)]="t.newAdminId"><option value="">{{ 'AdminHandover.choose' | t }}</option>
                @for (c of x.candidates; track c.id) { <option [value]="c.id">{{ c.fullName }} · {{ c.email }}@if (c.typeEn) { · {{ i18n.pick(c.typeEn, c.typeAr) }} }</option> }</select></div>
            <div class="flex flex-col gap-1.5"><label for="ho-type" [class]="cls.label">{{ 'AdminHandover.myType' | t }}</label>
              <select id="ho-type" name="type" [class]="cls.input" [(ngModel)]="t.myTypeId"><option value="">{{ 'AdminHandover.choose' | t }}</option>
                @for (ty of x.types; track ty.id) { <option [value]="ty.id">{{ i18n.pick(ty.nameEn, ty.nameAr) }}</option> }</select>
              <p class="text-xs text-muted">{{ 'AdminHandover.myTypeHint' | t }}</p></div>
            <div class="flex flex-col gap-1.5"><label for="ho-conf" [class]="cls.label">{{ 'AdminHandover.typeToConfirm' | t: { word: word() } }}</label>
              <input id="ho-conf" name="conf" dir="auto" autocomplete="off" [class]="cls.input" [(ngModel)]="t.confirm" /></div>
          </div>
          <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.danger" [disabled]="busy() || !t.newAdminId || !t.myTypeId">{{ 'AdminHandover.transferButton' | t }}</button><app-req-note /></div>
        }
      </form>

      <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
        <h2 class="text-lg font-bold">{{ 'AdminHandover.demoTitle' | t }}</h2>
        <p class="text-sm text-muted">{{ 'AdminHandover.demoIntro' | t }}</p>
        @if (!x.demo.users && !x.demo.organizations && !x.demo.articles) { <p class="text-sm">{{ 'AdminHandover.demoNone' | t }}</p> } @else {
          <ul class="list-disc ps-5 text-sm">
            <li>{{ 'AdminHandover.demoUsers' | t: { n: x.demo.users } }}</li><li>{{ 'AdminHandover.demoOrgs' | t: { n: x.demo.organizations } }}</li>
            <li>{{ 'AdminHandover.demoTickets' | t: { n: x.demo.tickets } }}</li><li>{{ 'AdminHandover.demoArticles' | t: { n: x.demo.articles } }}</li>
          </ul>
          @if (x.demo.meIsDemo) { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'AdminHandover.errors.callerIsDemo' | t }}</p> }
          @else if (x.demo.realTickets) { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'AdminHandover.errors.realTickets' | t }}</p> }
          @else { <div><button type="button" [class]="cls.danger" [disabled]="busy()" (click)="removeDemo()">{{ 'AdminHandover.demoButton' | t }}</button></div> }
        }
      </section>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class HandoverTab extends Tab implements OnInit {
  private readonly auth = inject(Auth);
  protected readonly d = signal<HandoverData | null>(null);
  protected readonly word = computed(() => (this.i18n.locale() === 'ar' ? 'نقل' : 'TRANSFER'));
  protected t = { newAdminId: '', myTypeId: '', confirm: '' };
  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> { this.d.set(await this.get<HandoverData>('handover')); }
  protected async transfer(): Promise<void> {
    if (this.t.confirm.trim().toUpperCase() !== this.word().toUpperCase()) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminHandover.errors.confirm') }); return; }
    if (await this.save(() => this.post('handover/transfer', this.t))) await this.auth.signOut();
  }
  protected async removeDemo(): Promise<void> {
    if (!confirm(this.i18n.t('AdminHandover.demoButton') + '?')) return;
    this.busy.set(true); this.msg.set(null);
    try {
      const r = await this.post<{ users: number; organizations: number; tickets: number; articles: number }>('handover/remove-demo', {});
      this.msg.set({ tone: 'success', text: this.i18n.t('AdminHandover.demoDone', r) });
      await this.load();
    } catch (e) {
      const code = (e as { error?: { code?: string } }).error?.code ?? 'generic';
      this.msg.set({ tone: 'error', text: this.i18n.has('AdminHandover.errors.' + code) ? this.i18n.t('AdminHandover.errors.' + code) : adminError(this.i18n, e) });
    } finally { this.busy.set(false); }
  }
}

// ================================================================== the page with its tabs

@Component({
  selector: 'app-settings-page',
  imports: [TPipe, RouterLink, BrandingTab, HomeTab, MenusTab, EmailTab, TemplatesTab, MessagesTab, UploadsTab, SystemTab, SigninCodesTab, HandoverTab],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'AdminGeneral.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'AdminGeneral.subtitle' | t }}</p></div>
      <nav [attr.aria-label]="'AdminGeneral.tabs' | t" class="flex gap-1 overflow-x-auto border-b border-line md:flex-wrap">
        @for (x of tabs(); track x) {
          <a [routerLink]="'/' + i18n.locale() + '/admin/general/settings' + (x ? '/' + x : '')" [attr.aria-current]="x === cur() ? 'page' : null"
            class="flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold" [class]="x === cur() ? 'border-brand text-brand-ink' : 'border-transparent text-muted hover:text-ink'">{{ 'AdminGeneral.' + label[x] | t }}</a>
        }
      </nav>
      @switch (cur()) {
        @case ('') { <app-set-branding /> }
        @case ('home') { <app-set-home /> }
        @case ('menus') { <app-set-menus /> }
        @case ('email') { <app-set-email /> }
        @case ('templates') { <app-set-templates /> }
        @case ('messages') { <app-set-messages /> }
        @case ('uploads') { <app-set-uploads /> }
        @case ('system') { <app-set-system /> }
        @case ('signin-codes') { <app-set-signin-codes /> }
        @case ('handover') { <app-set-handover /> }
      }
    </main>`,
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SettingsPage {
  protected readonly i18n = inject(I18n);
  private readonly auth = inject(Auth);
  readonly tab = input<string>();
  protected readonly label = TAB_LABEL;
  protected readonly tabs = computed(() => TABS.filter((x) => x !== 'handover' || !!this.auth.me()?.roles.includes('admin')));
  protected readonly cur = computed(() => { const t = this.tab() ?? ''; return this.tabs().includes(t) ? t : ''; });
  constructor() { effect(() => { this.cur(); untracked(() => window.scrollTo({ top: 0 })); }); }
}
