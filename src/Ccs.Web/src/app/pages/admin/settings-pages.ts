import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../core/auth';
import { MenuRow, SiteService } from '../../core/api';
import { adminError } from '../../core/admin-api';
import { apiUrl } from '../../core/api-base';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { EMAIL_ALL_PLACEHOLDERS, FormatBar, GLOBAL_TOKENS, PlaceholderInfo, PlaceholderPicker, describeVar } from '../../shared/email-editor';
import { RichText, varsOf } from '../../shared/rich-text';
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
            <div class="grid gap-4 md:grid-cols-2">
              @for (f of sec.fields; track f) {
                <div [class]="'flex flex-col gap-1.5' + (f.startsWith('homeIntro') || f.startsWith('loginNotice') ? ' md:col-span-2' : '')">
                  <label [for]="'b-' + f" [class]="cls.label">{{ 'AdminGeneral.' + f | t }}</label>
                  @if (f.startsWith('homeIntro') || f.startsWith('loginNotice') || f.startsWith('footerText')) {
                    <textarea [id]="'b-' + f" [name]="f" rows="3" [attr.dir]="f.endsWith('Ar') ? 'rtl' : 'auto'" [class]="cls.input + ' py-2'" [(ngModel)]="m[f]"></textarea>
                  } @else {
                    <input [id]="'b-' + f" [name]="f" [attr.dir]="f.endsWith('Ar') ? 'rtl' : f.startsWith('contact') && !f.startsWith('contactHours') ? 'ltr' : 'auto'" [class]="cls.input + ' font-semibold'" [(ngModel)]="m[f]" />
                  }
                </div>
              }
            </div>
            @if (sec.image) {
              <div class="flex flex-col gap-1.5">
                <span [class]="cls.label">{{ 'AdminGeneral.' + sec.image | t }}</span>
                <div class="flex flex-wrap items-center gap-3">
                  @if (img(sec.image); as src) { <img [src]="src" alt="" class="h-16 w-16 rounded-lg border border-line object-contain" /> } @else { <span class="flex h-16 w-16 items-center justify-center rounded-lg border border-line bg-brand-soft text-xs text-muted">{{ 'AdminGeneral.defaultIcon' | t }}</span> }
                  <input type="file" class="text-sm" [attr.aria-label]="'AdminGeneral.' + sec.image | t" accept=".png,.jpg,.jpeg,.webp,.svg,.ico" (change)="upload(sec.image, $any($event.target))" />
                  @if (img(sec.image)) { <button type="button" [class]="cls.btn2" (click)="remove(sec.image)">{{ 'AdminGeneral.removeImage' | t }}</button> }
                </div>
                <p class="text-sm text-muted">{{ 'AdminGeneral.' + sec.image + 'Hint' | t }}</p>
              </div>
            }
          </fieldset>
          @if (sec.title === 'secFooter') {
          <fieldset [class]="cls.card + ' flex flex-col gap-3 p-5'">
            <legend class="sr-only">{{ 'AdminGeneral.secColor' | t }}</legend>
            <div><h2 class="text-lg font-bold">{{ 'AdminGeneral.secColor' | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.secColorHint' | t }}</p></div>
            <div class="flex flex-wrap items-end gap-4">
              <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminGeneral.brandColor' | t }}
                <input name="color" type="color" class="h-11 w-24 cursor-pointer rounded-lg border border-line bg-surface p-1" [ngModel]="m['brandColor'] || '#1f64e6'" (ngModelChange)="m['brandColor'] = $event" /></label>
              <label class="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="useDefaultColor" class="h-5 w-5" [checked]="!m['brandColor']" (change)="m['brandColor'] = $any($event.target).checked ? '' : '#1f64e6'" />{{ 'AdminGeneral.useDefaultColor' | t }}</label>
            </div>
          </fieldset>
          }
        }
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
      <section class="flex flex-col gap-3">
        <div><h2 class="text-xl font-bold">{{ 'AdminGeneral.menuArea.' + area | t }}</h2><p class="text-sm text-muted">{{ 'AdminGeneral.menuAreaHint.' + area | t }}</p></div>
        <ul class="flex flex-col gap-3">
          @for (r of itemsOf(area); track r.id) {
            <li class="rounded-xl border border-line bg-surface shadow-card" [class.ms-6]="!!r.parentId">
              <div class="flex flex-wrap items-center gap-2 px-3 py-3">
                <button type="button" [class]="cls.btn2 + ' !min-h-10 !px-3'" (click)="move(r, -1)" [disabled]="edge(r, -1)" [attr.aria-label]="'AdminGeneral.moveUp' | t">▲</button>
                <button type="button" [class]="cls.btn2 + ' !min-h-10 !px-3'" (click)="move(r, 1)" [disabled]="edge(r, 1)" [attr.aria-label]="'AdminGeneral.moveDown' | t">▼</button>
                <div class="min-w-0 flex-1 ps-1" dir="auto"><p class="font-semibold">{{ i18n.pick(r.labelEn, r.labelAr) }}@if (!r.isVisible) { <span [class]="cls.badgeWarn + ' ms-2'">{{ 'AdminGeneral.hidden' | t }}</span> }</p>
                  <p class="text-sm text-muted"><span dir="ltr">{{ r.kind === 'group' ? ('AdminGeneral.groupLabel' | t) : r.href }}</span>@if (r.systemKey) { · {{ 'AdminGeneral.builtIn' | t }} } @else if (area === 'header' || area === 'footer') { · {{ 'AdminGeneral.aud_' + r.audience | t }} }</p></div>
                <button type="button" [class]="cls.btn2 + ' !min-h-10'" (click)="open.set(open() === r.id ? null : r.id)">{{ (open() === r.id ? 'AdminGeneral.close' : 'AdminGeneral.edit') | t }}</button>
                @if (!r.systemKey) { <button type="button" [class]="cls.danger + ' !min-h-10'" (click)="remove(r)">{{ 'AdminGeneral.delete' | t }}</button> }
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
  protected edge(r: MenuFull, dir: number): boolean {
    const sib = this.rows().filter((x) => x.area === r.area && x.parentId === r.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const j = sib.findIndex((x) => x.id === r.id) + dir;
    return j < 0 || j >= sib.length;
  }
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
  useSmtp: boolean; host: string; port: number; security: string; username: string; hasPassword: boolean; passwordOk?: boolean; fromName: string; fromEmail: string; replyTo: string;
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
            @if (e.hasPassword && e.passwordOk === false) { <p role="alert" class="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{{ 'V2.smtpPasswordUnreadable' | t }}</p> }
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

    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class EmailTab extends Tab implements OnInit {
  private readonly auth = inject(Auth);
  protected e: EmailData | null = null;
  protected password = '';
  protected clear = false;
  protected readonly me = computed(() => this.auth.me()?.email ?? '');
  protected readonly siteName = computed(() => this.i18n.pick(this.site.info()?.site?.siteNameEn, this.site.info()?.site?.siteNameAr));

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    this.e = await this.get<EmailData>('email');
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
}

// ================================================================== email templates

interface TplRow { event: string; locale: string; subject: string; body: string; button: string; link: string }
interface TplDefault { subject: string; body: string; button: string; footer: string }
interface TplDefaults { ticketEvents: string[]; authEvents: string[]; en: Record<string, TplDefault>; ar: Record<string, TplDefault> }
type Fields = { subject: string; body: string; button: string; link: string; greeting: string; footer: string };
const LAYOUT = '_layout';
const NO_FOOTER = '[[none]]';
const DEFAULT_DESIGN = { headerColor: '#0b1a3a', accentColor: '#1f64e6', pageBackground: '#f0f4fb', useLogo: false, showSiteName: true, rounded: true, largeCodeBox: true };

/** The look of every email, with a live preview (v1 EmailDesign, on the Email templates tab). */
@Component({
  selector: 'app-email-design',
  imports: [TPipe, FormsModule, Alert],
  template: `
    <section aria-labelledby="design-h" [class]="cls.card + ' flex flex-col gap-4 p-5'">
      <div><h2 id="design-h" class="text-xl font-bold">{{ 'AdminGeneral.designTitle' | t }}</h2><p class="mt-1 max-w-prose text-sm text-muted">{{ 'AdminGeneral.designIntro' | t }}</p></div>
      <div class="flex flex-wrap items-start gap-6">
        <form class="flex min-w-0 flex-[1_1_18rem] flex-col gap-4" (ngSubmit)="saveDesign()" novalidate>
          @for (c of colors; track c.key) {
            <div class="flex flex-col gap-1.5"><label class="text-sm font-semibold" [for]="'dc-' + c.key">{{ 'AdminGeneral.' + c.label | t }}</label>
              <div class="flex items-center gap-3"><input type="color" [name]="c.key + '-c'" [attr.aria-label]="'AdminGeneral.' + c.label | t" class="h-11 w-16 cursor-pointer rounded-lg border border-line bg-surface p-1" [(ngModel)]="$any(d)[c.key]" (ngModelChange)="refresh()" />
                <input type="text" [id]="'dc-' + c.key" [name]="c.key" maxlength="7" dir="ltr" class="min-h-11 w-32 rounded-lg border border-line bg-surface px-3 font-mono text-sm font-bold" [ngModel]="$any(d)[c.key]" (ngModelChange)="hex(c.key, $event)" /></div></div>
          }
          <div class="flex flex-col gap-1">
            <label class="${CHECK} text-sm font-semibold"><input type="checkbox" name="logo" class="h-5 w-5" [(ngModel)]="d.useLogo" (ngModelChange)="refresh()" [disabled]="!site.logoUrl()" /> {{ 'AdminGeneral.designUseLogo' | t }}</label>
            @if (!site.logoUrl()) { <p class="text-xs text-muted">{{ 'AdminGeneral.designNoLogo' | t }}</p> }
          </div>
          <label class="${CHECK} text-sm font-semibold"><input type="checkbox" name="name" class="h-5 w-5" [(ngModel)]="d.showSiteName" (ngModelChange)="refresh()" /> {{ 'AdminGeneral.designShowName' | t }}</label>
          <label class="${CHECK} text-sm font-semibold"><input type="checkbox" name="code" class="h-5 w-5" [(ngModel)]="d.largeCodeBox" (ngModelChange)="refresh()" /> {{ 'AdminGeneral.designCodeBox' | t }}</label>
          <label class="flex flex-col gap-1.5 text-sm font-semibold">{{ 'AdminGeneral.designCorners' | t }}
            <select name="corners" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [ngModel]="d.rounded ? 'round' : 'square'" (ngModelChange)="d.rounded = $event === 'round'; refresh()">
              <option value="round">{{ 'AdminGeneral.designRound' | t }}</option><option value="square">{{ 'AdminGeneral.designSquare' | t }}</option>
            </select></label>
          ${MSG}
          <div class="flex flex-wrap gap-3">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button>
            <button type="button" [class]="cls.btn2" (click)="d = { ...defaultDesign }; refresh()">{{ 'AdminGeneral.designReset' | t }}</button>
          </div>
        </form>
        <div class="flex min-w-0 flex-[2_1_22rem] flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <p class="text-xs font-semibold text-muted">{{ 'AdminGeneral.tplPreview' | t }}</p>
            <label class="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" class="h-4 w-4" [checked]="rtl" (change)="rtl = !rtl; refresh()" />{{ 'AdminGeneral.designPreviewAr' | t }}</label>
          </div>
          <iframe [title]="'AdminGeneral.tplPreview' | t" [srcdoc]="safe(html())" sandbox="" class="h-[34rem] w-full rounded-md border border-line bg-white"></iframe>
          <p class="text-xs text-muted">{{ 'AdminGeneral.designNote' | t }}</p>
        </div>
      </div>
    </section>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class EmailDesignPanel extends Tab implements OnInit {
  protected readonly colors = [{ key: 'headerColor', label: 'designHeaderBg' }, { key: 'accentColor', label: 'designAccent' }, { key: 'pageBackground', label: 'designPageBg' }];
  protected readonly defaultDesign = DEFAULT_DESIGN;
  protected d = { ...DEFAULT_DESIGN };
  protected rtl = false;
  protected readonly html = signal('');
  private readonly san = inject(DomSanitizer);
  /** The preview HTML comes from our own server and is shown in a sandboxed frame; Angular would otherwise strip its styles. */
  protected safe(h: string): SafeHtml { return this.san.bypassSecurityTrustHtml(h); }
  protected hex(key: string, v: string): void { (this.d as Record<string, unknown>)[key] = v; if (/^#[0-9a-fA-F]{6}$/.test(v)) this.refresh(); }
  private timer: ReturnType<typeof setTimeout> | undefined;
  async ngOnInit(): Promise<void> {
    const e = await this.get<EmailData>('email'); const x = e.design;
    this.d = { headerColor: x.headerColor, accentColor: x.accentColor, pageBackground: x.pageBackground, useLogo: !!x.logoUrl, showSiteName: x.showSiteName, rounded: x.rounded, largeCodeBox: x.largeCodeBox };
    this.refresh();
  }
  protected refresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.post<{ html: string }>('email/design/preview', { design: this.d, rtl: this.rtl }).then((r) => this.html.set(r.html), () => undefined), 250);
  }
  protected saveDesign(): void { void this.save(() => this.put('email/design', this.d)); }
}

/** Email templates (v1 EmailTemplates): event list, editor per language with greeting, subject, formatted body, button, link and footer, live preview, test and reset. */
@Component({
  selector: 'app-set-templates',
  imports: [TPipe, FormsModule, Alert, EmailDesignPanel, PlaceholderPicker, FormatBar],
  template: `
    <app-email-design />
    <div class="flex flex-col gap-4">
      <p class="max-w-prose text-muted">{{ 'AdminGeneral.tplIntro' | t }}</p>
      <div class="flex flex-wrap items-start gap-5">
        <nav [attr.aria-label]="'AdminGeneral.tplList' | t" class="flex w-full flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-card md:w-72 md:shrink-0">
          @for (ev of events(); track ev) {
            <button type="button" (click)="pick(ev)" [attr.aria-current]="ev === cur() ? 'true' : null"
              class="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-start text-sm font-semibold" [class]="ev === cur() ? 'bg-brand-soft text-brand-ink' : 'hover:bg-bg'">
              <span>{{ title(ev) }}</span>
              @if (edited(ev)) { <span class="rounded-full bg-ok-soft px-2 py-0.5 text-xs text-ok">{{ 'AdminGeneral.tplEdited' | t }}</span> }
            </button>
          }
        </nav>
        @if (cur(); as ev) {
          <section class="flex min-w-0 flex-[1_1_28rem] flex-col gap-4" aria-labelledby="tpl-h">
            <div>
              <h2 id="tpl-h" class="mb-1 text-xl font-bold">{{ title(ev) }}</h2>
              <p class="mb-1 text-sm text-muted">{{ ev === layout ? ('AdminGeneral.tplLayoutHint' | t) : who(ev) }}</p>
              @if (ev !== layout) { <p class="text-sm text-muted">{{ 'AdminGeneral.tplAnatomy' | t }}</p> }
            </div>
            <app-placeholder-picker [notice]="needField() ? ('AdminGeneral.tplClickField' | t) : null" (insert)="insert($event)" />
            <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
              @for (loc of locs; track loc) {
                <section class="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  <header class="flex items-center gap-2 border-b border-line bg-bg px-4 py-2.5">
                    <span dir="ltr" class="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-ink">{{ loc === 'en' ? 'EN' : 'AR' }}</span>
                    <h3 class="text-sm font-bold">{{ loc === 'en' ? 'English' : 'العربية' }}</h3>
                  </header>
                  <form class="flex flex-col gap-3 p-4" novalidate (ngSubmit)="saveTpl(ev)">
                    @if (ev !== layout) {
                      <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminGeneral.tplGreeting' | t }}
                        <input [name]="'g' + loc" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" maxlength="200" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base font-semibold" [(ngModel)]="v[loc].greeting" (focus)="track(loc, 'greeting', $event)" (ngModelChange)="preview(loc)" />
                        <span class="text-xs font-normal text-muted">{{ 'AdminGeneral.tplSharedField' | t }}</span></label>
                    }
                    <label class="flex flex-col gap-1 text-sm font-semibold">{{ (ev === layout ? 'AdminGeneral.tplGreeting' : 'AdminGeneral.tplSubject') | t }}
                      <input [name]="'s' + loc" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" maxlength="200" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base font-semibold" [(ngModel)]="v[loc].subject" (focus)="track(loc, 'subject', $event)" (ngModelChange)="preview(loc)" /></label>
                    <label [for]="'tb-' + loc" class="-mb-2 text-sm font-semibold">{{ (ev === layout ? 'AdminGeneral.tplFooter' : 'AdminGeneral.tplBody') | t }}</label>
                    <app-format-bar [el]="bodyEl" [anchor]="true" (changed)="v[loc].body = $event; preview(loc)" />
                    <textarea #bodyEl [id]="'tb-' + loc" [name]="'b' + loc" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" [rows]="ev === layout ? 3 : 5" maxlength="2000"
                      class="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" [(ngModel)]="v[loc].body" (focus)="track(loc, 'body', $event)" (ngModelChange)="preview(loc)"></textarea>
                    <label class="flex flex-col gap-1 text-sm font-semibold">{{ (ev === layout ? 'AdminGeneral.tplButton' : 'AdminGeneral.tplButtonOverride') | t }}
                      <input [name]="'u' + loc" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" maxlength="60" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base font-semibold" [placeholder]="ev === layout ? '' : btnDefault(ev, loc)" [(ngModel)]="v[loc].button" (focus)="track(loc, 'button', $event)" (ngModelChange)="preview(loc)" />
                      @if (ev !== layout) { <span class="text-xs font-normal text-muted">{{ 'AdminGeneral.tplButtonHint' | t: { text: btnDefault(ev, loc) } }}</span> }</label>
                    @if (ev !== layout && !isAuth(ev)) {
                      <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminGeneral.tplLink' | t }}
                        <input [name]="'l' + loc" dir="ltr" maxlength="300" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base font-semibold" [placeholder]="'AdminGeneral.tplLinkAuto' | t" [(ngModel)]="v[loc].link" (focus)="track(loc, 'link', $event)" (ngModelChange)="preview(loc)" />
                        <span class="text-xs font-normal text-muted">{{ 'AdminGeneral.tplLinkHint' | t }}</span></label>
                    }
                    @if (ev !== layout) {
                      <label [for]="'tf-' + loc" class="-mb-2 text-sm font-semibold">{{ 'AdminGeneral.tplFooter' | t }}</label>
                      <app-format-bar [el]="footEl" [anchor]="true" (changed)="v[loc].footer = $event; preview(loc)" />
                      <textarea #footEl [id]="'tf-' + loc" [name]="'f' + loc" [attr.dir]="loc === 'ar' ? 'rtl' : 'ltr'" rows="3" maxlength="2000"
                        class="min-h-20 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base" [(ngModel)]="v[loc].footer" (focus)="track(loc, 'footer', $event)" (ngModelChange)="preview(loc)"></textarea>
                      <p class="-mt-1 text-xs text-muted">{{ 'AdminGeneral.tplSharedField' | t }}</p>
                    }
                    <div class="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
                      <p class="text-xs font-semibold text-muted" dir="auto">{{ 'AdminGeneral.tplPreview' | t }}</p>
                      <p class="text-sm" dir="auto"><span class="text-muted">{{ 'AdminGeneral.tplPreviewSubject' | t }} </span><strong>{{ pv()[loc].subject }}</strong></p>
                      <iframe [title]="'AdminGeneral.tplPreview' | t" [srcdoc]="safe(pv()[loc].html)" sandbox="" class="h-80 w-full rounded-md border border-line bg-white"></iframe>
                      <p class="text-xs text-muted">{{ 'AdminGeneral.tplPreviewNote' | t }}</p>
                    </div>
                    <div class="flex flex-col gap-2">
                      <div><button type="button" (click)="testTpl(ev, loc)" [disabled]="testing()" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40">
                        {{ (testing() && testLoc() === loc ? 'AdminGeneral.tplTestSending' : 'AdminGeneral.tplTestButton') | t }}</button></div>
                      @if (tests()[loc]; as r) { <p [attr.role]="r.ok ? 'status' : 'alert'" class="text-sm font-semibold" [class]="r.ok ? 'text-ok' : 'text-danger'">{{ r.text }}</p> }
                    </div>
                    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                      <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button>
                      <span class="text-xs text-muted">{{ 'AdminGeneral.tplSaveBoth' | t }}</span>
                    </div>
                  </form>
                </section>
              }
            </div>
            ${MSG}
            @if (edited(ev)) { <div><button type="button" [disabled]="busy()" (click)="reset(ev)" class="min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg disabled:opacity-40">{{ 'AdminGeneral.tplReset' | t }}</button></div> }
          </section>
        }
      </div>
      <p class="text-sm text-muted">{{ 'AdminGeneral.tplAuthNote' | t }}</p>
    </div>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class TemplatesTab extends Tab implements OnInit {
  protected readonly layout = LAYOUT;
  protected readonly locs: ('en' | 'ar')[] = ['en', 'ar'];
  protected readonly rows = signal<TplRow[]>([]);
  protected readonly defs = signal<TplDefaults | null>(null);
  protected readonly cur = signal<string | null>(null);
  protected readonly events = computed(() => { const d = this.defs(); return d ? [...d.ticketEvents, ...d.authEvents, LAYOUT] : []; });
  protected v: Record<'en' | 'ar', Fields> = { en: this.blank(), ar: this.blank() };
  private readonly san = inject(DomSanitizer);
  protected safe(h: string): SafeHtml { return this.san.bypassSecurityTrustHtml(h); }
  protected readonly pv = signal<Record<'en' | 'ar', { subject: string; html: string }>>({ en: { subject: '', html: '' }, ar: { subject: '', html: '' } });
  protected readonly needField = signal(false);
  protected readonly testing = signal(false);
  protected readonly testLoc = signal<string | null>(null);
  protected readonly tests = signal<Record<string, { ok: boolean; text: string } | null>>({ en: null, ar: null });
  private focused: { loc: 'en' | 'ar'; k: keyof Fields; el: HTMLInputElement | HTMLTextAreaElement } | null = null;
  private timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

  async ngOnInit(): Promise<void> {
    const [defs] = await Promise.all([this.get<TplDefaults>('templates/defaults'), this.load()]);
    this.defs.set(defs);
    this.pick(defs.ticketEvents[0]);
  }
  private blank(): Fields { return { subject: '', body: '', button: '', link: '', greeting: '', footer: '' }; }
  private async load(): Promise<void> { this.rows.set(await this.get<TplRow[]>('templates')); }
  private row(ev: string, loc: string): TplRow | undefined { return this.rows().find((r) => r.event === ev && r.locale === loc); }
  protected edited(ev: string): boolean { return this.rows().some((r) => r.event === ev); }
  protected isAuth(ev: string): boolean { return !!this.defs()?.authEvents.includes(ev); }
  protected title(ev: string): string { const k = 'AdminGeneral.tplEvents.' + ev; return this.i18n.has(k) ? this.i18n.t(k) : ev; }
  protected who(ev: string): string { const k = 'AdminGeneral.tplWho.' + ev; return this.i18n.has(k) ? this.i18n.t(k) : ''; }
  private def(ev: string, loc: 'en' | 'ar'): TplDefault { return this.defs()?.[loc][ev] ?? { subject: '', body: '', button: '', footer: '' }; }
  /** The button text an email uses when the field is left empty. */
  protected btnDefault(ev: string, loc: 'en' | 'ar'): string { return this.def(ev, loc).button || this.row(LAYOUT, loc)?.button || this.def(LAYOUT, loc).button; }

  /** What the editor starts with: saved text, else the built-in wording (v1 Editor start()). */
  protected pick(ev: string): void {
    this.cur.set(ev); this.msg.set(null); this.tests.set({ en: null, ar: null }); this.focused = null;
    for (const loc of this.locs) {
      const d = this.def(ev, loc), o = this.row(ev, loc), lay = this.row(LAYOUT, loc), dl = this.def(LAYOUT, loc);
      this.v[loc] = {
        subject: o?.subject || d.subject, body: o?.body === NO_FOOTER ? '' : o?.body || d.body, button: o?.button || d.button, link: o?.link ?? '',
        greeting: lay?.subject || dl.subject, footer: lay?.body === NO_FOOTER ? '' : lay?.body || d.footer,
      };
      this.preview(loc, 0);
    }
  }
  protected track(loc: 'en' | 'ar', k: keyof Fields, e: Event): void { this.focused = { loc, k, el: e.target as HTMLInputElement }; this.needField.set(false); }
  protected insert(token: string): void {
    const f = this.focused;
    if (!f) { this.needField.set(true); return; }
    const s = f.el.selectionStart ?? f.el.value.length, e = f.el.selectionEnd ?? s;
    const cur = this.v[f.loc][f.k];
    this.v[f.loc][f.k] = cur.slice(0, s) + token + cur.slice(e);
    this.preview(f.loc);
    requestAnimationFrame(() => { f.el.focus(); f.el.setSelectionRange(s + token.length, s + token.length); });
  }
  protected preview(loc: 'en' | 'ar', wait = 300): void {
    const ev = this.cur(); if (!ev) return;
    clearTimeout(this.timers[loc]);
    this.timers[loc] = setTimeout(() => void this.post<{ subject: string; html: string }>(`templates/${ev}/${loc}/preview`, this.v[loc])
      .then((r) => this.pv.update((p) => ({ ...p, [loc]: r })), () => undefined), wait);
  }
  /** Saves both languages of this email; greeting and footer go to the shared parts (v1 saveTemplateAction). */
  protected async saveTpl(ev: string): Promise<void> {
    const ok = await this.save(async () => {
      for (const loc of this.locs) {
        const x = this.v[loc];
        await this.put('templates', ev === LAYOUT
          ? { event: ev, locale: loc, subject: x.subject, body: x.body, button: x.button, link: '' }
          : { event: ev, locale: loc, subject: x.subject, body: x.body, button: x.button, link: x.link, greeting: x.greeting, footer: x.footer });
      }
    });
    if (ok) await this.load();
  }
  protected async reset(ev: string): Promise<void> {
    if (await this.save(async () => { for (const loc of this.locs) await this.del(`templates/${ev}/${loc}`); })) { await this.load(); this.pick(ev); }
  }
  protected async testTpl(ev: string, loc: 'en' | 'ar'): Promise<void> {
    this.testing.set(true); this.testLoc.set(loc); this.tests.update((t) => ({ ...t, [loc]: null }));
    try {
      const r = await this.post<{ ok: boolean; error: string | null; email: string }>(`templates/${ev}/${loc}/test`, this.v[loc]);
      this.tests.update((t) => ({ ...t, [loc]: { ok: r.ok, text: r.ok ? this.i18n.t('AdminGeneral.tplTestSent', { email: r.email }) : this.i18n.t('AdminGeneral.tplTestFailed', { reason: r.error ?? '' }) } }));
    } catch (e) { this.tests.update((t) => ({ ...t, [loc]: { ok: false, text: adminError(this.i18n, e) } })); }
    finally { this.testing.set(false); }
  }
}

// ================================================================== system messages (any text on any screen)

@Component({
  selector: 'app-set-messages',
  imports: [TPipe, FormsModule, Alert, FormatBar, PlaceholderPicker, RichText],
  template: `
    <div class="flex flex-col gap-4">
      <p class="max-w-prose text-muted">{{ 'AdminSystemMessages.intro' | t }}</p>
      <div class="flex flex-wrap items-start gap-5">
        <nav [attr.aria-label]="'AdminSystemMessages.messagesList' | t" class="flex w-full flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card md:w-80 md:shrink-0">
          <input type="search" [value]="q()" (input)="q.set($any($event.target).value); limit.set(60)" [placeholder]="'AdminSystemMessages.search' | t" [attr.aria-label]="'AdminSystemMessages.search' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" />
          <div class="grid grid-cols-2 gap-2">
            <select [attr.aria-label]="'AdminSystemMessages.area' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" (change)="area.set($any($event.target).value); limit.set(60)">
              <option value="all">{{ 'AdminSystemMessages.allAreas' | t }}</option>
              @for (a of areas(); track a) { <option [value]="a" [selected]="a === area()">{{ areaName(a) }}</option> }
            </select>
            <select [attr.aria-label]="'AdminSystemMessages.type' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" (change)="kind.set($any($event.target).value); limit.set(60)">
              <option value="all">{{ 'AdminSystemMessages.allTypes' | t }}</option>
              <option value="message">{{ 'AdminSystemMessages.typeMessages' | t }}</option>
              <option value="error">{{ 'AdminSystemMessages.typeErrors' | t }}</option>
            </select>
          </div>
          <p class="px-1 text-xs text-muted" role="status">{{ 'AdminSystemMessages.shown' | t: { n: filtered().length, total: entries().length } }}</p>
          <ul class="flex max-h-[34rem] flex-col gap-1 overflow-y-auto">
            @for (e of filtered().slice(0, limit()); track e.key) {
              <li>
                <button type="button" (click)="pick(e.key)" [attr.aria-current]="e.key === sel() ? 'true' : null"
                  class="flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start" [class]="e.key === sel() ? 'bg-brand-soft text-brand-ink' : 'hover:bg-bg'">
                  <span class="line-clamp-2 text-sm font-semibold" dir="auto">{{ textOf(e.key) }}</span>
                  <span class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{{ areaName(e.area) }}</span>
                    @if (e.kind === 'error') { <span class="rounded-full bg-danger-soft px-1.5 text-danger">{{ 'AdminSystemMessages.typeError' | t }}</span> }
                    @if (isEdited(e.key)) { <span class="rounded-full bg-ok-soft px-1.5 text-ok">{{ 'AdminSystemMessages.edited' | t }}</span> }
                  </span>
                </button>
              </li>
            }
          </ul>
          @if (filtered().length > limit()) { <button type="button" class="min-h-9 cursor-pointer rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg" (click)="limit.set(limit() + 60)">{{ 'AdminSystemMessages.more' | t }}</button> }
          @if (!filtered().length) { <p class="px-1 text-sm text-muted">{{ 'AdminSystemMessages.none' | t }}</p> }
        </nav>

        <section class="min-w-0 flex-[1_1_28rem]" aria-live="polite">
          @if (sel(); as k) {
            <form class="flex flex-col gap-4" novalidate (ngSubmit)="saveMsg(k, false)">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-bold">{{ i18n.has(itemKey(k) + '.label') ? i18n.t(itemKey(k) + '.label') : ('AdminSystemMessages.editing' | t) }}</h2>
                  @if (isEdited(k)) { <span class="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-semibold text-ok">{{ 'AdminSystemMessages.edited' | t }}</span> }
                </div>
                <p class="mt-1 text-sm text-muted">{{ i18n.has(itemKey(k) + '.where') ? i18n.t(itemKey(k) + '.where') : ('AdminSystemMessages.whereGeneric' | t) }}</p>
                <code dir="ltr" class="mt-1 inline-block break-all rounded bg-bg px-1.5 py-0.5 text-xs text-muted">{{ k }}</code>
              </div>
              <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
                @for (l of ['en', 'ar']; track l) {
                  <section class="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                    <header class="flex items-center gap-2 border-b border-line bg-bg px-4 py-2.5">
                      <span dir="ltr" class="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-ink">{{ l === 'en' ? 'EN' : 'AR' }}</span>
                      <h3 class="text-sm font-bold">{{ l === 'en' ? 'English' : 'العربية' }}</h3>
                    </header>
                    <div class="flex flex-col gap-3 p-4">
                      @if (isRich(k)) { <app-format-bar [el]="area" [anchor]="true" (changed)="$any(vals)[l] = $event" /> }
                      <textarea #area [name]="'body' + l" [rows]="isRich(k) ? 6 : 4" maxlength="1000" [attr.dir]="l === 'ar' ? 'rtl' : 'ltr'" [attr.aria-label]="l === 'en' ? 'English' : 'العربية'"
                        class="min-h-24 w-full rounded-lg border border-line bg-surface px-3 py-2 text-start text-base" [value]="$any(vals)[l]" (input)="$any(vals)[l] = $any($event.target).value"
                        (focus)="focusEl = area; focusLoc = l; needField.set(false)"></textarea>
                      <div [attr.dir]="l === 'ar' ? 'rtl' : 'ltr'" class="rounded-lg border border-line bg-bg p-3 text-sm">
                        <p class="mb-1 text-xs font-semibold text-muted" dir="auto">{{ 'AdminSystemMessages.preview' | t }}</p>
                        @if ($any(vals)[l].trim()) { @if (isRich(k)) { <app-rich [text]="$any(vals)[l]" /> } @else { <p class="whitespace-pre-line text-start" dir="auto">{{ $any(vals)[l] }}</p> } } @else { <p class="text-muted">-</p> }
                      </div>
                    </div>
                  </section>
                }
              </div>
              <app-placeholder-picker [items]="tokensOf(k)" [notice]="needField() ? ('AdminSystemMessages.clickField' | t) : null" (insert)="insertToken($event)" />
              @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
              <div class="flex flex-wrap gap-2">
                <button type="submit" [disabled]="busy() || !changed()" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{{ 'AdminSystemMessages.save' | t }}</button>
                <button type="button" [disabled]="busy() || (!isEdited(k) && !changed())" (click)="saveMsg(k, true)" class="min-h-11 cursor-pointer rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40">{{ 'AdminSystemMessages.reset' | t }}</button>
              </div>
            </form>
          }
        </section>
      </div>
    </div>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class MessagesTab extends Tab implements OnInit {
  /** Same catalog rules as v1: every plain-text message except this screen's own wording and internal lists. */
  private static readonly HIDDEN = ['AdminSystemMessages', 'Placeholders', 'StatusInfo', 'AdminV2', 'V2'];
  /** v2-only texts that v1 does not have, kept out of the list so the catalogue matches v1. */
  private static readonly HIDDEN_KEYS = ['AdminCommon.errors.flowNewStuck', 'AdminCommon.errors.flowNoResolve'];
  private static readonly ERROR_WORDS = /error|fail|invalid|expired|denied|forbidden|rateLimited|wrong|required|tooLong|taken|notFound|unavailable|tooLarge|badType/i;
  protected readonly q = signal('');
  protected readonly area = signal('all');
  protected readonly kind = signal<'all' | 'message' | 'error'>('all');
  protected readonly limit = signal(60);
  protected readonly sel = signal<string | null>('Auth.register.sentBody');
  private readonly std_ = signal<{ en: Record<string, string>; ar: Record<string, string> }>({ en: {}, ar: {} });
  private readonly over = signal<{ key: string; locale: string; body: string }[]>([]);
  protected vals = { en: '', ar: '' };
  private savedVals = { en: '', ar: '' };
  protected focusEl: HTMLTextAreaElement | null = null;
  protected focusLoc: string | null = null;
  protected readonly needField = signal(false);
  /** Messages shown with formatting on the sign-in pages (v1 SYSTEM_MESSAGES, except the plain title). */
  private static readonly RICH = new Set(['Auth.login.subtitle', 'Auth.login.pendingNotice', 'Auth.login.suspendedNotice', 'Auth.callbackError', 'Auth.register.subtitle',
    'Auth.register.sentBody', 'Auth.forgot.subtitle', 'Auth.code.subtitle', 'Auth.reset.subtitle', 'Auth.mfa.subtitle', 'Auth.errors.emailNotConfirmed', 'Auth.errors.rateLimited', 'Auth.errors.pendingApproval']);
  protected isRich(k: string): boolean { return MessagesTab.RICH.has(k); }
  /** The values this message fills in, then the site-wide ones (v1 tokens + GLOBAL_PLACEHOLDERS). */
  protected tokensOf(k: string): PlaceholderInfo[] {
    const std = this.std_();
    const vars = [...new Set([...varsOf(String(std.en[k] ?? '')), ...varsOf(String(std.ar[k] ?? ''))])].filter((v) => !GLOBAL_TOKENS.includes(v));
    return [...vars.map(describeVar), ...EMAIL_ALL_PLACEHOLDERS.filter((p) => GLOBAL_TOKENS.includes(p.token))];
  }
  protected insertToken(token: string): void {
    const el = this.focusEl, l = this.focusLoc as 'en' | 'ar' | null;
    if (!el || !l) { this.needField.set(true); return; }
    const v = this.vals[l], s = el.selectionStart ?? v.length, e = el.selectionEnd ?? s;
    this.vals[l] = v.slice(0, s) + token + v.slice(e);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  }
  protected readonly entries = computed(() => Object.entries(this.std_()[this.i18n.locale() === 'ar' ? 'ar' : 'en'])
    .filter(([k, v]) => k.split('.').length >= 2 && !MessagesTab.HIDDEN.includes(k.split('.')[0]) && !MessagesTab.HIDDEN_KEYS.includes(k) && !/\{[^}]*,\s*(plural|select|selectordinal)/.test(v) && !/<[A-Za-z/]/.test(v))
    .map(([k]) => ({ key: k, area: k.split('.')[0], kind: MessagesTab.ERROR_WORDS.test(k) ? 'error' : 'message' })));
  protected readonly areas = computed(() => [...new Set(this.entries().map((e) => e.area))].sort((a, b) => this.areaName(a).localeCompare(this.areaName(b))));
  protected readonly filtered = computed(() => {
    const n = this.q().trim().toLowerCase();
    return this.entries().filter((e) => (this.area() === 'all' || e.area === this.area()) && (this.kind() === 'all' || e.kind === this.kind())
      && (!n || e.key.toLowerCase().includes(n) || this.textOf(e.key).toLowerCase().includes(n)));
  });

  async ngOnInit(): Promise<void> {
    const [en, ar] = await Promise.all(['en', 'ar'].map((l) => firstValueFrom(this.http.get<Record<string, unknown>>(`/i18n/${l}.json`))));
    const flat = (o: Record<string, unknown>, p = '', out: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (typeof v === 'string') out[key] = v; else if (v && typeof v === 'object') flat(v as Record<string, unknown>, key, out); }
      return out;
    };
    this.std_.set({ en: flat(en), ar: flat(ar) });
    await this.loadOver();
    this.pick(this.sel() ?? this.entries()[0]?.key ?? '');
  }
  private async loadOver(): Promise<void> { this.over.set(await this.get('messages')); }
  protected areaName(a: string): string { const k = 'AdminSystemMessages.areas.' + a; return this.i18n.has(k) ? this.i18n.t(k) : a; }
  protected itemKey(k: string): string { return 'AdminSystemMessages.items.' + k.replaceAll('.', '_'); }
  private cur(k: string, l: 'en' | 'ar'): string { return this.over().find((o) => o.key === k && o.locale === l)?.body ?? this.std_()[l][k] ?? ''; }
  protected textOf(k: string): string { return this.cur(k, this.i18n.locale() === 'ar' ? 'ar' : 'en'); }
  protected isEdited(k: string): boolean { return this.over().some((o) => o.key === k); }
  protected changed(): boolean { return this.vals.en !== this.savedVals.en || this.vals.ar !== this.savedVals.ar; }
  protected pick(k: string): void {
    this.msg.set(null); this.sel.set(k);
    this.vals = { en: this.cur(k, 'en'), ar: this.cur(k, 'ar') }; this.savedVals = { ...this.vals };
  }
  protected async saveMsg(k: string, reset: boolean): Promise<void> {
    const std = this.std_();
    // Text equal to the standard wording is stored as "no override".
    const body = reset ? { key: k, en: '', ar: '' } : { key: k, en: this.vals.en === std.en[k] ? '' : this.vals.en, ar: this.vals.ar === std.ar[k] ? '' : this.vals.ar };
    if (await this.save(() => this.put('messages', body))) {
      await this.loadOver();
      this.pick(k);
      this.msg.set({ tone: 'success', text: this.i18n.t(reset ? 'AdminSystemMessages.resetDone' : 'AdminSystemMessages.saved') });
    }
  }
}

// ================================================================== uploads

const FILE_GROUPS: Record<string, string[]> = {
  images: ['png', 'jpg', 'gif', 'webp'], documents: ['pdf', 'txt', 'doc', 'docx'], sheets: ['csv', 'xls', 'xlsx'], slides: ['ppt', 'pptx'], archives: ['zip'],
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
            <div class="flex flex-wrap gap-x-5">@for (x of fileGroups[g]; track x) { <label class="flex min-h-10 items-center gap-2 font-mono text-sm"><input type="checkbox" class="h-5 w-5" [checked]="m.exts.has(x)" (change)="toggleExt(x)" /> .{{ x }}@if (x === 'jpg') { .jpeg }</label> }</div></div>
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
  /** jpg and jpeg are one choice, as in v1. */
  protected toggleExt(x: string): void {
    const all = x === 'jpg' ? ['jpg', 'jpeg'] : [x];
    if (this.m.exts.has(x)) all.forEach((e) => this.m.exts.delete(e)); else all.forEach((e) => this.m.exts.add(e));
  }
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
        <h3 class="mt-2 text-lg font-bold">{{ 'AdminSettings.timersTitle' | t }}</h3>
        <p class="-mt-2 text-sm text-muted">{{ 'AdminSettings.timersHelp' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of timers.concat(basic.slice(2, 3)); track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSettings.' + f.label | t }}${REQ}</label><input [id]="f.key" [name]="f.key" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[f.key]" /></div>
          }
        </div>
        <p class="text-sm text-muted">{{ 'AdminSettings.timersHint' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
          @for (f of basic.slice(3); track f.key) {
            <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSettings.' + f.label | t }}${REQ}</label>
              <input [id]="f.key" [name]="f.key" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[f.key]" />
              @if (f.hint) { <p class="text-xs text-muted">{{ 'AdminSettings.' + f.hint | t }}</p> }</div>
          }
        </div>
        <label class="${CHECK}"><input type="checkbox" name="email" class="h-5 w-5" [(ngModel)]="b['email_enabled']" /> {{ 'AdminSettings.email' | t }}</label>
        ${SAVE_REQ}
      </form>

      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="saveReg()">
        <fieldset class="flex flex-col gap-3"><legend class="mb-1 text-lg font-bold">{{ 'AdminSettings.regTitle' | t }}</legend><p class="text-sm text-muted">{{ 'AdminSettings.regHelp' | t }}</p>
        @for (r of modes; track r) {
          <label class="flex items-start gap-2"><input type="radio" name="reg" class="mt-1 h-5 w-5" [value]="r" [(ngModel)]="reg" />
            <span><span class="font-semibold">{{ 'AdminSettings.reg_' + r | t }}</span><span class="block text-sm text-muted">{{ 'AdminSettings.reg_' + r + '_help' | t }}</span></span></label>
        }</fieldset>
        <p class="text-sm text-muted">{{ 'AdminSettings.regNote' | t }}</p>
        ${SAVE}
      </form>

      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="saveCaptcha()">
        <h3 class="text-lg font-bold">{{ 'AdminSettings.captchaTitle' | t }}</h3><p class="text-sm text-muted">{{ 'AdminSettings.captchaHelp' | t }} {{ 'AdminSettings.captchaAlso' | t }}</p>
        @if (reg === 'pick_auto') { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'AdminSettings.captchaRecommended' | t }}</p> }
        @if (cap.fault) { <p role="alert" class="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{{ 'V2.captchaFault.' + cap.fault | t }}</p> }
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
        <h3 class="text-lg font-bold">{{ 'AdminSettings.pwTitle' | t }}</h3><p class="text-sm text-muted">{{ 'AdminSettings.pwHelp' | t }}</p>
        <div class="flex flex-col gap-1.5 md:max-w-xs"><label for="pw-min" [class]="cls.label">{{ 'AdminSettings.pwMinLength' | t }}${REQ}</label><input id="pw-min" name="min" type="number" min="8" max="72" dir="ltr" [class]="cls.input" [(ngModel)]="n['password_min_length']" /></div>
        <fieldset><legend [class]="cls.label">{{ 'AdminSettings.pwComplexity' | t }}</legend>
          @for (x of [['password_require_upper', 'pwUpper'], ['password_require_lower', 'pwLower'], ['password_require_number', 'pwNumber'], ['password_require_special', 'pwSpecial']]; track x[0]) {
            <label class="${CHECK}"><input type="checkbox" [name]="x[0]" class="h-5 w-5" [(ngModel)]="b[x[0]]" /> {{ 'AdminSettings.' + x[1] | t }}</label>
          }</fieldset>
        <p class="text-sm text-muted">{{ 'AdminSettings.pwApplies' | t }}</p>
        <label class="${CHECK} font-semibold"><input type="checkbox" name="exp" class="h-5 w-5" [(ngModel)]="b['password_expiry_enabled']" /> {{ 'AdminSettings.pwExpire' | t }}</label>
        <p class="-mt-2 text-sm text-muted">{{ 'AdminSettings.pwExpireHelp' | t }}</p>
        <div class="grid gap-4 md:grid-cols-2">
            @for (x of [['password_expiry_days', 'pwExpiryDays'], ['password_warn_1_days', 'pwWarn1'], ['password_warn_2_days', 'pwWarn2'], ['password_warn_3_days', 'pwWarn3']]; track x[0]) {
              <div class="flex flex-col gap-1.5"><label [for]="x[0]" [class]="cls.label">{{ 'AdminSettings.' + x[1] | t }}</label><input [id]="x[0]" [name]="x[0]" type="number" dir="ltr" [class]="cls.input" [(ngModel)]="n[x[0]]" /></div>
            }
        </div>
        <p class="text-sm text-muted">{{ 'AdminSettings.pwWarnHint' | t }}</p>
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
  protected cap: { enabled: boolean; siteKey: string; secret: string; hasSecret: boolean; fault?: string | null } = { enabled: false, siteKey: '', secret: '', hasSecret: false };

  async ngOnInit(): Promise<void> {
    const d = await this.get<{ settings: Record<string, string>; registrationMode: string; captcha: { enabled: boolean; siteKey: string; hasSecret: boolean; fault?: string | null } }>('system');
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
  protected async saveCaptcha(): Promise<void> { if (await this.save(() => this.put('captcha', { enabled: this.cap.enabled, siteKey: this.cap.siteKey, secret: this.cap.secret || null }))) { if (this.cap.secret || !this.cap.enabled) this.cap.fault = null; if (this.cap.secret) this.cap.hasSecret = true; this.cap.secret = ''; } }
}

// ================================================================== sign-in codes

@Component({
  selector: 'app-set-signin-codes',
  imports: [TPipe, FormsModule, Alert, RouterLink, Req, ReqNote],
  template: `
    ${MSG}
    <p class="max-w-prose text-muted">{{ 'AdminSigninCodes.intro' | t }}</p>
    @if (m) {
      <form class="flex max-w-xl flex-col gap-4" (ngSubmit)="submit()">
        <section [class]="cls.card + ' flex flex-col gap-4 p-4'">
          <label class="flex items-start justify-between gap-3"><span><span class="font-semibold">{{ 'AdminSigninCodes.switch' | t }}</span>
            <span class="ms-2 rounded-full px-2 py-0.5 text-xs font-bold" [class]="m.enabled ? 'bg-ok-soft text-ok' : 'bg-bg text-muted'">{{ (m.enabled ? 'AdminSigninCodes.on' : 'AdminSigninCodes.off') | t }}</span>
            <span class="block text-sm text-muted">{{ 'AdminSigninCodes.switchHint' | t }}</span></span>
            <input type="checkbox" role="switch" name="on" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="m.enabled" /></label>
          <h2 class="text-lg font-bold">{{ 'AdminSigninCodes.who' | t }}</h2>
          <div role="radiogroup" [attr.aria-label]="'AdminSigninCodes.who' | t" class="flex flex-col gap-3">
            @for (a of ['customers', 'all']; track a) {
              <label class="flex cursor-pointer items-start gap-3 rounded-lg border p-3" [class]="m.audience === a ? 'border-brand bg-brand-soft' : 'border-line'"><input type="radio" name="who" class="mt-1 h-5 w-5" [value]="a" [(ngModel)]="m.audience" />
                <span><span class="font-semibold">{{ 'AdminSigninCodes.' + a | t }}</span><span class="block text-sm text-muted">{{ 'AdminSigninCodes.' + a + 'Hint' | t }}</span></span></label>
            }</div>
        </section>
        <section [class]="cls.card + ' flex flex-col gap-4 p-4'"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.rules' | t }}</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            @for (f of fields; track f.key) {
              <label [class]="cls.label + ' flex flex-col gap-1.5'"><span>{{ 'AdminSigninCodes.' + f.label | t }} ${REQ}</span>
                <input [name]="f.key" type="number" dir="ltr" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 font-normal" [(ngModel)]="$any(m)[f.key]" />
                <span class="text-sm font-normal text-muted">{{ 'AdminSigninCodes.' + f.label + 'Unit' | t }}</span></label>
            }
          </div>
        </section>
        <section [class]="cls.card + ' p-4'"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.safeTitle' | t }}</h2>
          <ul class="mt-2 list-disc ps-5 text-sm">@for (n of [1, 2, 3, 4]; track n) { <li>{{ 'AdminSigninCodes.safe' + n | t }}</li> }</ul></section>
        <section [class]="cls.card + ' flex flex-col gap-2 p-4'"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.mailTitle' | t }}</h2>
          <p class="text-muted">{{ 'AdminSigninCodes.mailHint' | t }}</p>
          <div><a [routerLink]="'/' + i18n.locale() + '/admin/general/settings/templates'" class="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'AdminSigninCodes.mailButton' | t }}</a></div></section>
        <section [class]="cls.card + ' flex flex-col gap-2 p-4'"><h2 class="text-lg font-bold">{{ 'AdminSigninCodes.previewTitle' | t }}</h2>
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
            <div class="flex flex-col gap-1.5"><label for="ho-type" [class]="cls.label">{{ 'AdminHandover.myType' | t }}${REQ}</label>
              <select id="ho-type" name="type" [class]="cls.input" [(ngModel)]="t.myTypeId"><option value="">{{ 'AdminHandover.choose' | t }}</option>
                @for (ty of x.types; track ty.id) { <option [value]="ty.id">{{ i18n.pick(ty.nameEn, ty.nameAr) }}</option> }</select>
              <p class="text-xs text-muted">{{ 'AdminHandover.myTypeHint' | t }}</p></div>
            <div class="flex flex-col gap-1.5"><label for="ho-conf" [class]="cls.label">{{ 'AdminHandover.typeToConfirm' | t: { word: word() } }}${REQ}</label>
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
          @else {
            <form class="flex flex-col gap-4" novalidate (ngSubmit)="removeDemo()">
              <div class="flex flex-col gap-1.5"><label for="ho-del" [class]="cls.label">{{ 'AdminHandover.typeToConfirm' | t: { word: 'DELETE' } }}${REQ}</label>
                <input id="ho-del" name="del" dir="ltr" autocomplete="off" [class]="cls.input + ' max-w-xs'" [(ngModel)]="delWord" /></div>
              <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.danger" [disabled]="busy() || delWord.trim().toUpperCase() !== 'DELETE'">{{ 'AdminHandover.demoButton' | t }}</button><app-req-note /></div>
            </form>
          }
        }
      </section>
    }`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class HandoverTab extends Tab implements OnInit {
  private readonly auth = inject(Auth);
  protected readonly d = signal<HandoverData | null>(null);
  protected readonly word = computed(() => 'TRANSFER');
  protected t = { newAdminId: '', myTypeId: '', confirm: '' };
  protected delWord = '';
  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> { this.d.set(await this.get<HandoverData>('handover')); }
  protected async transfer(): Promise<void> {
    if (this.t.confirm.trim().toUpperCase() !== this.word().toUpperCase()) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminHandover.errors.confirm') }); return; }
    if (await this.save(() => this.post('handover/transfer', this.t))) await this.auth.signOut();
  }
  protected async removeDemo(): Promise<void> {
    if (this.delWord.trim().toUpperCase() !== 'DELETE') return;
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
