import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { MenuRow, SiteService } from '../core/api';
import { LanguageSwitcher, Logo } from '../shared/ui';

const ICONS: Record<string, string> = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  tickets: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4zM9 5v14',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  kb: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  users: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  teams: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  flag: 'M4 22V4M4 4h13l-2.5 4L17 12H4',
  catalog: 'M4 6h16M4 12h16M4 18h10',
  audit: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  chevron: 'M9 6l6 6-6 6',
};

/** Same grouping, icons and colours as the current staff sidebar (lib/site/sidebar.ts). */
const GROUP_OF: Record<string, string> = {
  dashboard: 'top', tickets: 'top',
  customers: 'people', admin_customers: 'people', people: 'people', approvals: 'people', users: 'people', admin_teams: 'people', team: 'people', permissions: 'people', organizations: 'people', hierarchy: 'people',
  catalog: 'rules', ticket_types: 'rules', priorities: 'rules', ticket_status: 'rules', sla_settings: 'rules', escalation: 'rules',
  kb_admin: 'content', kb_console: 'content', canned: 'content',
  reports: 'insights', sla: 'insights', audit: 'insights',
  settings: 'system', help_center: 'system', help: 'system',
};
const GROUP_IDS = ['top', 'people', 'rules', 'content', 'insights', 'system', 'more'];
const GROUP_STYLE: Record<string, { color: string; icon: string }> = {
  top: { color: '#8aa4d6', icon: 'dashboard' }, people: { color: '#5b94f5', icon: 'customers' }, rules: { color: '#f5a524', icon: 'flag' },
  content: { color: '#3ecf8e', icon: 'kb' }, insights: { color: '#b388f5', icon: 'reports' }, system: { color: '#5fd0e0', icon: 'settings' }, more: { color: '#8aa4d6', icon: 'catalog' },
};
const ITEM_ICON: Record<string, string> = {
  dashboard: 'dashboard', tickets: 'tickets', canned: 'kb', team: 'teams', customers: 'customers', people: 'users', approvals: 'users', sla: 'clock',
  reports: 'reports', kb_console: 'kb', users: 'users', hierarchy: 'teams', escalation: 'flag', admin_customers: 'customers', admin_teams: 'teams',
  permissions: 'users', organizations: 'customers', catalog: 'catalog', ticket_types: 'tickets', priorities: 'flag', ticket_status: 'tickets', kb_admin: 'kb',
  sla_settings: 'clock', audit: 'audit', settings: 'settings', help: 'kb', help_center: 'kb',
};
/** Where each menu address lives in this version. Screens not built yet are left out of the menu. */
const ROUTE: Record<string, string> = {
  '/console/dashboard': '/console/dashboard', '/console': '/console', '/console/canned': '/console/canned', '/console/approvals': '/console/approvals',
  '/console/customers': '/console/customers', '/kb': '/console/kb', '/console/kb': '/console/kb',
  '/admin/users': '/admin/users', '/admin/customers': '/console/customers', '/admin/teams': '/admin/teams', '/admin/permissions': '/admin/permissions',
  '/admin/organizations': '/admin/organizations', '/admin/escalation': '/admin/escalation', '/admin/catalog': '/admin/catalog', '/admin/ticket-types': '/admin/ticket-types',
  '/admin/priorities': '/admin/priorities', '/admin/ticket-status': '/admin/ticket-status', '/admin/kb': '/admin/kb', '/admin/sla': '/admin/sla',
  '/admin/general/settings': '/admin/general/settings', '/admin/general/help': '/admin/general/help', '/console/help': '/console/help', '/console/people': '/console/people',
  '/console/reports': '/console/reports', '/console/sla': '/console/sla', '/console/team': '/console/team', '/admin/audit': '/admin/audit',
};

export interface SideItem { path: string; label: string; icon: string; exact?: boolean; badge?: number; also?: string[] }
export interface SideGroup { id?: string; title?: string; color?: string; icon?: string; items: SideItem[] }

@Component({
  selector: 'app-footer',
  imports: [TPipe],
  template: `
    <footer class="mt-10 border-t border-line bg-surface">
      <div class="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-8 gap-y-3 px-4 py-5 text-sm text-muted">
        <div class="flex flex-col gap-1">
          <p>{{ 'Footer.copyright' | t: { name: siteName() } }}</p>
          @if (extra()) { <p dir="auto">{{ extra() }}</p> }
        </div>
        @if (s()?.contactEmail || s()?.contactPhone || hours()) {
          <ul [attr.aria-label]="'Footer.contact' | t" class="flex flex-col gap-0.5">
            @if (s()?.contactEmail) { <li><a [href]="'mailto:' + s()!.contactEmail" dir="ltr" class="inline-block font-semibold text-brand-ink hover:underline">{{ s()!.contactEmail }}</a></li> }
            @if (s()?.contactPhone) { <li><a [href]="'tel:' + tel()" dir="ltr" class="inline-block font-semibold text-brand-ink hover:underline">{{ s()!.contactPhone }}</a></li> }
            @if (hours()) { <li dir="auto">{{ hours() }}</li> }
          </ul>
        }
      </div>
    </footer>`,
})
export class Footer {
  private readonly i18n = inject(I18n);
  private readonly site = inject(SiteService);
  protected readonly s = computed(() => this.site.info()?.site ?? null);
  protected readonly siteName = computed(() => this.i18n.pick(this.s()?.siteNameEn, this.s()?.siteNameAr) || this.i18n.t('Brand.name'));
  protected readonly extra = computed(() => this.i18n.pick(this.s()?.footerTextEn, this.s()?.footerTextAr));
  protected readonly hours = computed(() => this.i18n.pick(this.s()?.contactHoursEn, this.s()?.contactHoursAr));
  protected readonly tel = computed(() => (this.s()?.contactPhone ?? '').replace(/[^+0-9]/g, ''));
}

/** Public header (white bar, logo, language, sign in) and footer - for visitors and the sign-in pages. */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, Logo, LanguageSwitcher, TPipe, Footer],
  template: `
    <header data-site-header class="sticky top-0 z-30 border-b border-line bg-surface md:static">
      <!-- Phone (v1 PublicNav): one slim bar - brand, Sign in, menu button; the panel holds Create account / My Account, language, Sign out -->
      <div class="md:hidden">
        <div class="flex h-16 items-center gap-2 px-3">
          <a [routerLink]="'/' + i18n.locale()" class="block min-w-0 flex-1 overflow-hidden" [attr.aria-label]="name()"><app-logo [name]="name()" [sub]="sub()" [logoUrl]="site.logoUrl()" /></a>
          @if (!auth.signedIn()) {
            <a [routerLink]="'/' + i18n.locale() + '/login'" class="flex min-h-11 shrink-0 items-center rounded-lg bg-brand px-4 text-[0.95rem] font-bold text-white hover:bg-brand-ink">{{ 'Nav.signIn' | t }}</a>
          }
          <button type="button" [attr.aria-expanded]="open()" aria-controls="public-menu" [attr.aria-label]="(open() ? 'Nav.closeMenu' : 'Nav.menu') | t" (click)="open.set(!open())"
            class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface hover:bg-bg">
            @if (open()) {
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            } @else {
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            }
          </button>
        </div>
        @if (open()) {
          <button type="button" tabindex="-1" [attr.aria-label]="'Nav.closeMenu' | t" (click)="open.set(false)" class="fixed inset-x-0 bottom-0 top-16 z-40 cursor-default bg-black/50"></button>
          <nav id="public-menu" [attr.aria-label]="'Nav.menu' | t" class="fixed inset-x-0 top-16 z-50 flex max-h-[calc(100dvh-4rem)] flex-col gap-2 overflow-y-auto border-b border-line bg-surface px-3 pb-4 pt-2 shadow-2xl">
            @if (!auth.signedIn()) {
              @if (site.info()?.site?.registrationMode !== 'closed') {
                <div class="pt-1"><a [routerLink]="'/' + i18n.locale() + '/register'" (click)="open.set(false)" class="flex min-h-12 items-center justify-center rounded-lg border border-brand font-bold text-brand-ink hover:bg-brand-soft">{{ 'Nav.register' | t }}</a></div>
              }
            } @else {
              <div><a [routerLink]="auth.homePath()" (click)="open.set(false)" class="flex min-h-12 items-center rounded-lg px-3 font-semibold text-ink/80 hover:bg-brand-soft hover:text-brand-ink">{{ 'Nav.account' | t }}</a></div>
            }
            <div class="border-t border-line pt-3"><p class="mb-1 px-1 text-xs font-bold text-muted">{{ 'Nav.language' | t }}</p><app-language-switcher /></div>
            @if (auth.signedIn()) {
              <div class="border-t border-line pt-1"><button type="button" (click)="open.set(false); auth.signOut()" class="flex min-h-12 w-full cursor-pointer items-center rounded-lg px-3 font-semibold text-danger hover:bg-bg">{{ 'Nav.signOut' | t }}</button></div>
            }
          </nav>
        }
      </div>
      <!-- Tablet and wider: full header -->
      <div class="mx-auto hidden max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 md:flex">
        <a [routerLink]="'/' + i18n.locale()" class="block" [attr.aria-label]="name()"><app-logo [name]="name()" [sub]="sub()" [logoUrl]="site.logoUrl()" /></a>
        <div class="flex flex-wrap items-center gap-2">
          <app-language-switcher />
          @if (auth.signedIn()) {
            <a [routerLink]="auth.homePath()" class="flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-brand-ink hover:bg-brand-soft">{{ 'Nav.account' | t }}</a>
            <button type="button" (click)="auth.signOut()" class="min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Nav.signOut' | t }}</button>
          } @else {
            @if (site.info()?.site?.registrationMode !== 'closed') {
              <a [routerLink]="'/' + i18n.locale() + '/register'" class="flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-brand-ink hover:bg-brand-soft">{{ 'Nav.register' | t }}</a>
            }
            <a [routerLink]="'/' + i18n.locale() + '/login'" class="flex min-h-10 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-ink">{{ 'Nav.signIn' | t }}</a>
          }
        </div>
      </div>
    </header>
    <div class="flex-1"><router-outlet /></div>
    <app-footer />`,
  host: { class: 'flex flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PublicLayout {
  protected readonly i18n = inject(I18n);
  /** Phone menu; closes on page change and Escape (v1 PublicNav). */
  protected readonly open = signal(false);
  constructor() {
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => this.open.set(false));
  }
  @HostListener('document:keydown.escape') protected esc(): void { this.open.set(false); }
  protected readonly auth = inject(Auth);
  protected readonly site = inject(SiteService);
  protected readonly name = computed(() => this.i18n.pick(this.site.info()?.site?.headerNameEn, this.site.info()?.site?.headerNameAr) || this.i18n.t('Brand.name'));
  protected readonly sub = computed(() => this.i18n.pick(this.site.info()?.site?.headerSubEn, this.site.info()?.site?.headerSubAr) || this.i18n.t('Brand.tagline'));
}

/**
 * Signed-in frame shared by customers and staff (same as CustomerFrame / StaffShell today):
 * dark navigation column on large screens, slim sticky bar with a slide-in menu on phones.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, Logo, LanguageSwitcher, TPipe, Footer, NgTemplateOutlet],
  template: `
    <div class="flex flex-1 flex-col lg:flex-row">
      <div class="sticky top-0 z-30 bg-chrome text-white print:hidden lg:static lg:w-64 lg:shrink-0">
        <div class="flex h-16 items-center gap-2 px-3 lg:hidden">
          <button type="button" [attr.aria-expanded]="menuOpen()" aria-controls="side-menu" [attr.aria-label]="'Shell.menu' | t" (click)="menuOpen.set(true)" class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div class="min-w-0 flex-1 overflow-hidden"><a [routerLink]="homeLink()" class="block"><app-logo [name]="name()" [sub]="sub()" [dark]="true" [logoUrl]="site.logoUrl()" /></a></div>
          <a [routerLink]="area() + '/notifications'" [attr.aria-label]="bellLabel()" class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons['bell']" /></svg>
            @if (unread()) { <span aria-hidden="true" class="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">{{ unread() }}</span> }
          </a>
          <button type="button" [attr.aria-expanded]="sheetOpen()" aria-haspopup="dialog" [attr.aria-label]="'Shell.accountMenu' | t" (click)="menuOpen.set(false); sheetOpen.set(!sheetOpen())"
            class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">{{ initials() }}</button>
        </div>

        @if (sheetOpen()) {
          <div class="lg:hidden">
            <button type="button" tabindex="-1" [attr.aria-label]="'Shell.closeMenu' | t" (click)="sheetOpen.set(false)" class="fixed inset-0 z-40 cursor-default"></button>
            <div role="dialog" [attr.aria-label]="'Shell.accountMenu' | t" class="fixed end-2 top-[4.25rem] z-50 w-[min(20rem,calc(100vw-1rem))] rounded-2xl border border-line bg-surface p-3 text-ink shadow-2xl">
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-3 border-b border-line pb-3">
                  <span aria-hidden="true" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">{{ initials() }}</span>
                  <div class="min-w-0"><p class="truncate font-semibold" dir="auto">{{ auth.me()?.fullName }}</p><p class="text-sm text-muted">{{ roleLabel() }}</p></div>
                </div>
                <a [routerLink]="area() + '/account'" (click)="sheetOpen.set(false)" class="flex min-h-11 items-center rounded-lg px-2 font-semibold hover:bg-bg">{{ 'Shell.myAccount' | t }}</a>
                <div><p class="mb-1 px-2 text-xs font-bold text-muted">{{ 'Shell.language' | t }}</p><app-language-switcher /></div>
                <div class="border-t border-line pt-1"><button type="button" (click)="sheetOpen.set(false); auth.signOut()" class="flex min-h-11 w-full cursor-pointer items-center rounded-lg px-2 font-semibold text-danger hover:bg-bg">{{ 'Shell.signOut' | t }}</button></div>
              </div>
            </div>
          </div>
        }

        @if (menuOpen()) {
          <div class="lg:hidden">
            <button type="button" tabindex="-1" [attr.aria-label]="'Shell.closeMenu' | t" (click)="menuOpen.set(false)" class="fixed inset-0 z-40 cursor-default bg-black/50"></button>
            <nav id="side-menu" [attr.aria-label]="'Shell.menu' | t" class="fixed inset-y-0 start-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-chrome text-white shadow-2xl">
              <div class="flex items-center gap-2 border-b border-white/10 px-3 py-3">
                <div class="min-w-0 flex-1 overflow-hidden"><app-logo [name]="name()" [sub]="sub()" [dark]="true" [logoUrl]="site.logoUrl()" /></div>
                <button type="button" [attr.aria-label]="'Shell.closeMenu' | t" (click)="menuOpen.set(false)" class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <div class="flex-1 overflow-y-auto px-3 py-3"><ng-container *ngTemplateOutlet="groupsTpl" /></div>
              <div class="border-t border-white/10 p-3"><app-language-switcher tone="dark" /></div>
            </nav>
          </div>
        }

        <nav [attr.aria-label]="'Shell.menu' | t" class="hidden px-3 pb-4 lg:sticky lg:top-0 lg:block lg:max-h-screen lg:overflow-y-auto lg:pt-5">
          <div class="px-2 pb-5"><a [routerLink]="homeLink()" class="block"><app-logo [name]="name()" [sub]="sub()" [dark]="true" [logoUrl]="site.logoUrl()" /></a></div>
          <ng-container *ngTemplateOutlet="groupsTpl" />
        </nav>

        <ng-template #groupsTpl>
          <div class="flex flex-col gap-1">
            @for (g of groups(); track g.id ?? $index) {
              @if (!g.title) {
                <ul class="flex flex-col gap-1">@for (i of g.items; track i.path) { <ng-container *ngTemplateOutlet="itemTpl; context: { i, color: g.color }" /> }</ul>
              } @else {
                <div class="mt-1">
                  <button type="button" [attr.aria-expanded]="isOpen(g)" [attr.aria-controls]="'grp-' + g.id" (click)="toggleGroup(g)"
                    class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-bold text-white hover:bg-white/10">
                    <span class="shrink-0" [style.color]="g.color"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons[g.icon ?? 'catalog']" /></svg></span>
                    <span class="min-w-0 flex-1 truncate text-start">{{ g.title }}</span>
                    @if (!isOpen(g) && sum(g)) { <span class="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5484d] px-1.5 text-xs font-bold text-white">{{ sum(g) > 99 ? '99+' : sum(g) }}</span> }
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-white/50 transition-transform motion-reduce:transition-none" [class]="isOpen(g) ? 'rotate-90' : 'rtl:rotate-180'"><path [attr.d]="icons['chevron']" /></svg>
                  </button>
                  @if (isOpen(g)) {
                    <ul [id]="'grp-' + g.id" class="ms-5 mt-1 flex flex-col gap-1 border-s-2 ps-2" [style.border-color]="g.color + '99'">
                      @for (i of g.items; track i.path) { <ng-container *ngTemplateOutlet="itemTpl; context: { i, color: g.color }" /> }
                    </ul>
                  }
                </div>
              }
            }
          </div>
        </ng-template>
        <ng-template #itemTpl let-i="i" let-color="color">
          <li>
            <a [routerLink]="'/' + i18n.locale() + i.path" [attr.aria-current]="isHere(i) ? 'page' : null" (click)="menuOpen.set(false)"
              class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold"
              [class]="isHere(i) ? (color ? 'text-white' : 'bg-brand text-white') : 'text-white/80 hover:bg-white/10'"
              [style.background-color]="isHere(i) && color ? color + '2e' : null">
              <span class="shrink-0" [style.color]="color"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons[i.icon] ?? icons['dashboard']" /></svg></span>
              <span class="min-w-0 flex-1 truncate">{{ i.label }}</span>
              @if (i.badge) { <span class="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e5484d] px-1.5 text-xs font-bold text-white">{{ i.badge > 99 ? '99+' : i.badge }}</span> }
            </a>
          </li>
        </ng-template>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="hidden border-b border-line bg-surface print:hidden lg:block">
          <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            <div class="flex-1" aria-hidden="true"></div>
            <app-language-switcher />
            <a [routerLink]="area() + '/notifications'" [attr.aria-label]="bellLabel()" class="relative flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface hover:bg-bg">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons['bell']" /></svg>
              @if (unread()) { <span aria-hidden="true" class="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">{{ unread() }}</span> }
            </a>
            <div class="flex items-center gap-2">
              <span aria-hidden="true" class="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">{{ initials() }}</span>
              <a [routerLink]="area() + '/account'" class="flex flex-col text-sm leading-tight hover:underline">
                <span class="font-semibold" dir="auto">{{ auth.me()?.fullName }}</span>
                <span class="text-muted">{{ roleLabel() }}</span>
              </a>
            </div>
            <button type="button" (click)="auth.signOut()" class="min-h-10 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg">{{ 'Shell.signOut' | t }}</button>
          </div>
        </div>
        <div class="flex-1"><router-outlet /></div>
        <app-footer />
      </div>
    </div>`,
  host: { class: 'flex flex-1 flex-col' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class Shell {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  protected readonly site = inject(SiteService);
  private readonly router = inject(Router);
  protected readonly icons = ICONS;
  protected readonly menuOpen = signal(false);
  protected readonly sheetOpen = signal(false);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)), { initialValue: null });

  protected readonly name = computed(() => this.i18n.pick(this.site.info()?.site?.headerNameEn, this.site.info()?.site?.headerNameAr) || this.i18n.t('Brand.name'));
  protected readonly sub = computed(() => this.i18n.pick(this.site.info()?.site?.headerSubEn, this.site.info()?.site?.headerSubAr) || this.i18n.t('Brand.tagline'));
  protected readonly unread = computed(() => this.auth.me()?.unreadNotifications ?? 0);
  protected readonly bellLabel = computed(() => this.unread() ? this.i18n.t('Shell.bellUnread', { count: this.unread() }) : this.i18n.t('Shell.bell'));
  protected readonly initials = computed(() => (this.auth.me()?.fullName ?? '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  protected readonly roleLabel = computed(() => { const r = this.auth.me()?.roles ?? []; const top = ['admin', 'team_leader', 'agent', 'management_viewer', 'customer'].find((x) => r.includes(x)); return top ? this.i18n.t('Roles.' + top) : ''; });
  protected readonly homeLink = computed(() => this.auth.homePath());
  /** Staff keep Account and Notifications inside the console (v1 /console/account, /console/notifications). */
  protected readonly area = computed(() => '/' + this.i18n.locale() + (this.auth.isStaff() ? '/console' : ''));

  /** Menu groups: customers get the portal menu; staff the console (admin entries arrive with stage 8). */
  protected readonly groups = computed<SideGroup[]>(() => {
    this.i18n.locale();
    const t = (k: string) => this.i18n.t(k);
    if (!this.auth.isStaff()) return [{ items: this.customerItems() }];
    return this.staffGroups();
  });

  /**
   * Customer menu, same as v1 CustomerFrame: the "header" menu from Settings → Menus, as a signed-in customer sees it
   * (audience all / signed_in / customer, visible only; a group shows its links), plus Notifications if it is missing.
   */
  private customerItems(): SideItem[] {
    const rows = this.site.menus().filter((r) => r.area === 'header');
    const allowed = (r: MenuRow) => (r as MenuRow & { isVisible?: boolean }).isVisible !== false && ['all', 'signed_in', 'customer'].includes(r.audience);
    const label = (r: MenuRow) => this.i18n.pick(r.labelEn, r.labelAr);
    const iconFor = (href: string) => href === '/' ? 'dashboard' : href.startsWith('/tickets/new') ? 'plus' : href.startsWith('/tickets') ? 'tickets'
      : href.startsWith('/kb') ? 'kb' : href.startsWith('/account') ? 'users' : href.startsWith('/notifications') ? 'bell' : 'catalog';
    const item = (r: MenuRow): SideItem => ({ path: r.href!, label: label(r), icon: iconFor(r.href!), exact: r.href === '/' || r.href === '/tickets/new' });
    const byOrder = (a: MenuRow, b: MenuRow) => a.sortOrder - b.sortOrder;
    const items: SideItem[] = [];
    for (const top of rows.filter((r) => !r.parentId && allowed(r)).sort(byOrder)) {
      if (top.kind === 'link') { if (top.href?.startsWith('/')) items.push(item(top)); continue; }
      for (const c of rows.filter((x) => x.parentId === top.id && allowed(x) && x.href?.startsWith('/')).sort(byOrder)) items.push(item(c));
    }
    if (!items.length) {   // no menu saved yet: v1's default header menu
      const t = (k: string) => this.i18n.t(k);
      items.push({ path: '/', label: t('Nav.home'), icon: 'dashboard', exact: true }, { path: '/tickets', label: t('Nav.tickets'), icon: 'tickets' },
        { path: '/kb', label: t('Nav.kb'), icon: 'kb' }, { path: '/help', label: t('Nav.help'), icon: 'catalog' }, { path: '/account', label: t('Nav.account'), icon: 'users' });
    }
    if (!items.some((i) => i.path === '/notifications')) items.push({ path: '/notifications', label: this.i18n.t('Notifications.title'), icon: 'bell' });
    return items;
  }

  /** Red numbers: unassigned tickets and accounts waiting for approval, refreshed with the queue. */
  private readonly badges = signal<{ tickets: number; approvals: number }>({ tickets: 0, approvals: 0 });
  private readonly toggled = signal<Record<string, boolean>>({});
  private readonly http = inject(HttpClient);
  private readonly loadBadges = (() => {
    const run = () => { if (this.auth.isStaff()) void firstValueFrom(this.http.get<{ tickets: number; approvals: number }>('/api/console/badges')).then((b) => this.badges.set(b), () => undefined); };
    run();
    const h = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 60000);
    inject(DestroyRef).onDestroy(() => clearInterval(h));
    return run;
  })();

  /** The staff menu comes from the saved menu (Settings → Menus), grouped like the current sidebar. */
  private staffGroups(): SideGroup[] {
    const me = this.auth.me();
    const roles = me?.roles ?? [];
    const admin = roles.includes('admin');
    const has = (p: string) => this.auth.has(p);
    const canKb = admin || has('manage_kb'), canCatalog = admin || has('manage_catalog'), canSettings = admin || has('manage_settings');
    // Same rules as v1 StaffShell: who sees which built-in item.
    const can: Record<string, boolean> = {
      canned: admin || has('reply'), team: !!me?.leadsTeam, reports: has('reports_own') || has('reports_all'), kb_console: !(admin || canKb),
      users: admin, people: !admin && !!me?.scopeLevel, hierarchy: false, escalation: admin, admin_customers: admin, customers: !admin, admin_teams: admin,
      permissions: admin, organizations: admin, catalog: canCatalog, priorities: canCatalog, ticket_status: canSettings,
      approvals: admin || has('approve_customers'), help: !canSettings, help_center: canSettings, kb_admin: canKb, sla_settings: canSettings,
      audit: admin || roles.includes('management_viewer'), settings: canSettings,
    };
    const rows = [...this.site.menus()];
    // Menus imported before these screens existed get them added here (same defaults as v1's migrations).
    const add = (key: string, area: string, href: string, en: string, ar: string, order: number) => {
      if (!rows.some((r) => r.systemKey === key)) rows.push({ ...(rows[0] ?? {}), id: 'x-' + key, area, kind: 'link', parentId: null, href, systemKey: key, labelEn: en, labelAr: ar, sortOrder: order } as typeof rows[number]);
    };
    add('people', 'console', '/console/people', 'People', 'الأشخاص', 45);
    add('help', 'console', '/console/help', 'Help', 'المساعدة', 90);
    add('help_center', 'general', '/admin/general/help', 'Help Center', 'مركز المساعدة', 20);
    const badge: Record<string, number> = { tickets: this.badges().tickets, approvals: this.badges().approvals };
    const seen = new Set<string>();
    const by = new Map<string, { order: number; item: SideItem }[]>();
    for (const r of rows) {
      if (!['console', 'admin', 'general'].includes(r.area) || r.kind !== 'link' || !r.href) continue;
      if ((r as typeof r & { isVisible?: boolean }).isVisible === false) continue;
      if (r.systemKey && !(can[r.systemKey] ?? true)) continue;
      const path = ROUTE[r.href];
      if (!path || seen.has(path)) continue;          // screens of later stages stay out of the menu until they exist
      seen.add(path);
      const gid = (r.systemKey && GROUP_OF[r.systemKey]) || 'more';
      const item: SideItem = { path, label: this.i18n.locale() === 'ar' ? r.labelAr : r.labelEn, icon: (r.systemKey && ITEM_ICON[r.systemKey]) || 'catalog',
        exact: r.systemKey === 'dashboard' || r.systemKey === 'tickets', also: r.systemKey === 'tickets' ? ['/console/tickets'] : r.systemKey === 'admin_customers' ? ['/console/customers'] : undefined,
        badge: r.systemKey ? badge[r.systemKey] || undefined : undefined };
      (by.get(gid) ?? by.set(gid, []).get(gid)!).push({ order: r.sortOrder, item });
    }
    const titles: Record<string, string> = { people: 'group_people', rules: 'group_rules', content: 'group_content', insights: 'group_insights', system: 'group_system', more: 'group_more' };
    return GROUP_IDS.flatMap((id) => {
      const list = by.get(id);
      if (!list?.length) return [];
      return [{ id, title: id === 'top' ? undefined : this.i18n.t('Shell.' + titles[id]), color: GROUP_STYLE[id].color, icon: GROUP_STYLE[id].icon, items: list.sort((a, b) => a.order - b.order).map((x) => x.item) }];
    });
  }

  protected isOpen(g: SideGroup): boolean { return this.toggled()[g.id ?? ''] ?? g.items.some((i) => this.isHere(i)); }
  protected toggleGroup(g: SideGroup): void { const open = this.isOpen(g); this.toggled.update((t) => ({ ...t, [g.id ?? '']: !open })); }
  protected sum(g: SideGroup): number { return g.items.reduce((n, i) => n + (i.badge ?? 0), 0); }

  isHere(i: SideItem): boolean {
    this.url();
    const path = this.router.url.split('?')[0].replace(/^\/(en|ar)/, '') || '/';
    if (i.also?.some((a) => path === a || path.startsWith(a + '/'))) return true;
    if (i.exact) return path === i.path || (i.path === '/' && path === '');
    if (i.path === '/tickets' && path.startsWith('/tickets/new')) return false;
    if (i.also?.some((a) => path === a || path.startsWith(a + '/'))) return true;
    return path === i.path || path.startsWith(i.path + '/');
  }

  @HostListener('document:keydown.escape') close(): void { this.menuOpen.set(false); this.sheetOpen.set(false); }
}

/** Placeholder used for screens scheduled in a later build stage, so routes and menus are complete now. */
@Component({
  selector: 'app-coming',
  template: `<main class="mx-auto w-full max-w-3xl px-4 py-12"><div class="rounded-md border border-line bg-surface p-8 text-center text-muted">{{ title() }}</div></main>`,
})
export class Coming {
  readonly title = input('');
}
