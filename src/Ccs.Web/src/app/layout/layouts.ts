import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { SiteService } from '../core/api';
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
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};

export interface SideItem { path: string; label: string; icon: string; exact?: boolean }
export interface SideGroup { title?: string; items: SideItem[] }

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
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <a [routerLink]="'/' + i18n.locale()" class="block" [attr.aria-label]="name()"><app-logo [name]="name()" [sub]="sub()" /></a>
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
          <div class="min-w-0 flex-1 overflow-hidden"><a [routerLink]="homeLink()" class="block"><app-logo [name]="name()" [sub]="sub()" [dark]="true" /></a></div>
          <a [routerLink]="'/' + i18n.locale() + '/notifications'" [attr.aria-label]="bellLabel()" class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons['bell']" /></svg>
            @if (unread()) { <span aria-hidden="true" class="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">{{ unread() }}</span> }
          </a>
        </div>

        @if (menuOpen()) {
          <div class="lg:hidden">
            <button type="button" tabindex="-1" [attr.aria-label]="'Shell.closeMenu' | t" (click)="menuOpen.set(false)" class="fixed inset-0 z-40 cursor-default bg-black/50"></button>
            <nav id="side-menu" [attr.aria-label]="'Shell.menu' | t" class="fixed inset-y-0 start-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-chrome text-white shadow-2xl">
              <div class="flex items-center gap-2 border-b border-white/10 px-3 py-3">
                <div class="min-w-0 flex-1 overflow-hidden"><app-logo [name]="name()" [sub]="sub()" [dark]="true" /></div>
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
          <div class="px-2 pb-5"><a [routerLink]="homeLink()" class="block"><app-logo [name]="name()" [sub]="sub()" [dark]="true" /></a></div>
          <ng-container *ngTemplateOutlet="groupsTpl" />
        </nav>

        <ng-template #groupsTpl>
          @for (g of groups(); track $index; let gi = $index) {
            <div [class]="gi > 0 ? 'mt-4 border-t border-white/10 pt-3' : ''">
              @if (g.title) { <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-white/50">{{ g.title }}</p> }
              <ul class="flex flex-col gap-1">
                @for (i of g.items; track i.path) {
                  <li>
                    <a [routerLink]="'/' + i18n.locale() + i.path" [attr.aria-current]="isHere(i) ? 'page' : null" (click)="menuOpen.set(false)"
                      class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold" [class]="isHere(i) ? 'bg-brand text-white' : 'text-white/80 hover:bg-white/10'">
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons[i.icon] ?? icons['dashboard']" /></svg>
                      {{ i.label }}
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        </ng-template>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="hidden border-b border-line bg-surface print:hidden lg:block">
          <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
            <div class="flex-1" aria-hidden="true"></div>
            <app-language-switcher />
            <a [routerLink]="'/' + i18n.locale() + '/notifications'" [attr.aria-label]="bellLabel()" class="relative flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-surface hover:bg-bg">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="icons['bell']" /></svg>
              @if (unread()) { <span aria-hidden="true" class="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-white">{{ unread() }}</span> }
            </a>
            <div class="flex items-center gap-2">
              <span aria-hidden="true" class="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">{{ initials() }}</span>
              <a [routerLink]="'/' + i18n.locale() + '/account'" class="flex flex-col text-sm leading-tight hover:underline">
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
  private readonly site = inject(SiteService);
  private readonly router = inject(Router);
  protected readonly icons = ICONS;
  protected readonly menuOpen = signal(false);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)), { initialValue: null });

  protected readonly name = computed(() => this.i18n.pick(this.site.info()?.site?.headerNameEn, this.site.info()?.site?.headerNameAr) || this.i18n.t('Brand.name'));
  protected readonly sub = computed(() => this.auth.isStaff() ? this.i18n.t('Shell.consoleName') : (this.i18n.pick(this.site.info()?.site?.headerSubEn, this.site.info()?.site?.headerSubAr) || this.i18n.t('Brand.tagline')));
  protected readonly unread = computed(() => this.auth.me()?.unreadNotifications ?? 0);
  protected readonly bellLabel = computed(() => this.unread() ? this.i18n.t('Shell.bellUnread', { count: this.unread() }) : this.i18n.t('Shell.bell'));
  protected readonly initials = computed(() => (this.auth.me()?.fullName ?? '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
  protected readonly roleLabel = computed(() => { const r = this.auth.me()?.roles ?? []; const top = ['admin', 'team_leader', 'agent', 'management_viewer', 'customer'].find((x) => r.includes(x)); return top ? this.i18n.t('Roles.' + top) : ''; });
  protected readonly homeLink = computed(() => this.auth.homePath());

  /** Menu groups: customers get the portal menu; staff the console (admin entries arrive with stage 8). */
  protected readonly groups = computed<SideGroup[]>(() => {
    this.i18n.locale();
    const t = (k: string) => this.i18n.t(k);
    if (!this.auth.isStaff()) {
      return [{ items: [
        { path: '/tickets', label: t('Nav.tickets'), icon: 'tickets' },
        { path: '/tickets/new', label: t('Nav.newTicket'), icon: 'plus', exact: true },
        { path: '/notifications', label: t('Nav.notifications'), icon: 'bell' },
        { path: '/kb', label: t('Nav.kb'), icon: 'kb' },
        { path: '/account', label: t('Nav.account'), icon: 'users' },
      ] }];
    }
    const items: SideItem[] = [
      { path: '/console', label: t('Shell.tickets'), icon: 'tickets', exact: true },
    ];
    if (this.auth.has('create_for_customer')) items.push({ path: '/console/tickets/new', label: t('Shell.newTicketForCustomer'), icon: 'plus', exact: true });
    if (this.auth.isStaff() && this.auth.me()?.roles.some((r) => r !== 'management_viewer')) items.push({ path: '/console/saved-replies', label: t('Shell.cannedResponses'), icon: 'kb' });
    items.push({ path: '/kb', label: t('Shell.knowledgeBase'), icon: 'kb' });
    items.push({ path: '/account', label: t('Shell.myAccount'), icon: 'users' });
    const admin = !!this.auth.me()?.roles.includes('admin');
    const adm: SideItem[] = [];
    if (admin) adm.push({ path: '/admin/users', label: t('AdminV2.nav.staff'), icon: 'users' });
    if (admin || this.auth.has('customers_view')) adm.push({ path: '/admin/customers', label: t('AdminV2.nav.customers'), icon: 'customers' });
    if (admin || this.auth.has('approve_customers')) adm.push({ path: '/admin/approvals', label: t('AdminV2.nav.approvals'), icon: 'clock' });
    if (admin) adm.push(
      { path: '/admin/permissions', label: t('AdminV2.nav.permissions'), icon: 'settings' },
      { path: '/admin/organizations', label: t('AdminV2.nav.organizations'), icon: 'dashboard' },
      { path: '/admin/teams', label: t('AdminV2.nav.teams'), icon: 'customers' },
    );
    if (admin || this.auth.has('manage_catalog')) adm.push(
      { path: '/admin/ticket-types', label: t('AdminV2.nav.ticketTypes'), icon: 'tickets' },
      { path: '/admin/catalog', label: t('AdminV2.nav.catalog'), icon: 'kb' },
      { path: '/admin/priorities', label: t('AdminV2.nav.priorities'), icon: 'reports' },
    );
    if (admin || this.auth.has('manage_settings')) adm.push(
      { path: '/admin/sla', label: t('AdminV2.nav.sla'), icon: 'clock' },
      { path: '/admin/ticket-status', label: t('AdminV2.nav.status'), icon: 'tickets' },
    );
    if (admin) adm.push({ path: '/admin/escalation', label: t('AdminV2.nav.escalation'), icon: 'reports' });
    if (admin || this.auth.has('manage_kb')) adm.push({ path: '/admin/kb', label: t('AdminV2.nav.kb'), icon: 'kb' });
    return adm.length ? [{ items }, { title: t('Shell.administration'), items: adm }] : [{ items }];
  });

  isHere(i: SideItem): boolean {
    this.url();
    const path = this.router.url.split('?')[0].replace(/^\/(en|ar)/, '') || '/';
    if (i.exact) return path === i.path;
    if (i.path === '/tickets' && path.startsWith('/tickets/new')) return false;
    return path === i.path || path.startsWith(i.path + '/');
  }

  @HostListener('document:keydown.escape') close(): void { this.menuOpen.set(false); }
}

/** Placeholder used for screens scheduled in a later build stage, so routes and menus are complete now. */
@Component({
  selector: 'app-coming',
  template: `<main class="mx-auto w-full max-w-3xl px-4 py-12"><div class="rounded-md border border-line bg-surface p-8 text-center text-muted">{{ title() }}</div></main>`,
})
export class Coming {
  readonly title = input('');
}
