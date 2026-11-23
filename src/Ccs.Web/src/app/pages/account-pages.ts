import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';
import { Auth, problemOf } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { SiteService, TicketListItem, TicketsApi, TicketSummary } from '../core/api';
import { Alert, NewPasswordFields, StatusBadge, Submit, TextField } from '../shared/ui';
import { CustomerKpis } from '../shared/customer-kpis';
import { AuthArt } from '../shared/auth-art';

const HOME_ICON = { plus: 'M12 5v14M5 12h14', list: 'M4 6h16M4 12h16M4 18h10' };
/** Home, same as v1: guest hero with two action cards and the illustration; signed-in customers get their dashboard; staff go to the console. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, TPipe, StatusBadge, CustomerKpis, AuthArt],
  template: `
    @if (customer()) {
      <main data-home class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
        <header class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 class="text-3xl font-bold tracking-tight">{{ title() }}</h1>
            <p class="mt-1 text-muted">{{ intro() }}</p>
          </div>
          <a [routerLink]="link('/tickets/new')" class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path [attr.d]="icon.plus" /></svg>{{ 'Home.createCta' | t }}
          </a>
        </header>
        <app-customer-kpis [counts]="counts()" (pick)="openList($event)" />
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section aria-labelledby="home-recent" [class]="card + ' lg:col-span-2'">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h2 id="home-recent" class="text-lg font-bold">{{ 'Home.recentTickets' | t }}</h2>
              <a [routerLink]="link('/tickets')" class="text-sm font-semibold text-brand-ink hover:underline">{{ 'Home.viewAll' | t }}</a>
            </div>
            @if (recent(); as rows) {
              @if (rows.length === 0) { <p class="text-muted">{{ 'Tickets.empty' | t }}</p> }
              @else {
                <ul class="divide-y divide-line">
                  @for (r of rows; track r.id) {
                    <li>
                      <a [routerLink]="link('/tickets/' + r.id)" class="flex min-h-14 flex-wrap items-center justify-between gap-2 py-3 hover:bg-bg">
                        <span class="min-w-0"><span class="block text-sm text-muted" dir="ltr">{{ r.reference }}</span><span class="block truncate font-semibold" dir="auto">{{ r.subject }}</span></span>
                        <app-status-badge [status]="r.status" [custom]="r.customStatus" />
                      </a>
                    </li>
                  }
                </ul>
              }
            }
          </section>
          <div class="flex flex-col gap-4">
            <aside [class]="card">
              <h2 class="text-lg font-bold">{{ 'Home.needHelp' | t }}</h2>
              <p class="mt-2 text-muted">{{ 'Home.needHelpDesc' | t }}</p>
              <a [routerLink]="link('/kb')" class="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Home.browseKb' | t }}</a>
            </aside>
            @if (popular().length) {
              <section aria-labelledby="home-popular" [class]="card">
                <h2 id="home-popular" class="mb-3 text-lg font-bold">{{ popularTitle() }}</h2>
                <ul class="flex flex-col gap-2">
                  @for (a of popular(); track a.id) {
                    <li><a [routerLink]="link('/kb/' + a.slug)" class="flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-bg" dir="auto">{{ i18n.pick(a.titleEn, a.titleAr) }}</a></li>
                  }
                </ul>
              </section>
            }
          </div>
        </div>
      </main>
    } @else if (site.newLook() && !auth.signedIn()) {
      <!-- New look (Settings → Branding → Home and sign-in look), guest home: everything inside the page width (same column
           as the header and footer). Text, two buttons and three points on one side; the picture whole in a rounded frame on the other. -->
      <main data-home class="flex flex-1 flex-col bg-[linear-gradient(180deg,#f5f8ff_0%,#e8effc_100%)]">
        <div class="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-10 lg:grid-cols-[1.05fr_.95fr] lg:gap-14 lg:py-12">
          <div class="flex min-w-0 flex-col items-start gap-5">
            <span class="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-bold text-brand-ink" dir="auto"><span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true"></span>{{ tag() }}</span>
            <h1 class="text-4xl font-extrabold leading-[1.1] tracking-tight md:text-5xl lg:text-[3.5rem]" dir="auto">{{ title() }}</h1>
            <p class="max-w-[34ch] text-pretty text-lg text-ink/80 md:text-xl" dir="auto">{{ intro() }}</p>
            <div class="mt-1 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a [routerLink]="link('/tickets/new')" class="flex min-h-13 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-lg font-bold text-white hover:bg-brand-ink">
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path [attr.d]="icon.plus" /></svg>{{ 'Home.createCta' | t }}</a>
              <a [routerLink]="link('/login')" class="flex min-h-13 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 text-lg font-bold text-brand-ink hover:bg-bg">
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="rtl:-scale-x-100"><path d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></svg>{{ 'Nav.signIn' | t }}</a>
            </div>
            @if (site.info()?.site?.registrationMode !== 'closed') {
              <p class="text-sm text-muted">{{ 'Auth.login.noAccount' | t }} <a [routerLink]="link('/register')" class="font-bold text-brand-ink underline">{{ 'Auth.login.register' | t }}</a></p>
            }
            <ul class="mt-1 flex flex-wrap gap-2.5">
              @for (k of ['point1', 'point2', 'point3']; track k) {
                <li class="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink/85"><span class="grid h-5 w-5 flex-none place-items-center rounded-full bg-ok-soft text-ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span>{{ 'Home.guest.' + k | t }}</li>
              }
            </ul>
          </div>
          <div class="relative mx-auto w-full max-w-md sm:max-w-lg lg:max-w-none" aria-hidden="true">
            <div class="relative aspect-square max-h-[30rem] w-full overflow-hidden rounded-[1.75rem] bg-[linear-gradient(180deg,#e7effd,#9dbdf2_60%,#1d4fb8)] shadow-[0_24px_60px_rgba(11,31,77,.18)] lg:mx-auto lg:max-w-[30rem]">
              @if (site.signinPictureUrl(); as pic) { <img [src]="pic" alt="" class="absolute inset-0 h-full w-full object-contain" /> } @else { <app-auth-art [kind]="look().picture" /> }
            </div>
            <div class="absolute -start-3 bottom-10 hidden items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_10px_26px_rgba(11,31,77,.16)] sm:flex lg:-start-8">
              <span class="grid h-9 w-9 place-items-center rounded-xl bg-ok-soft text-ok"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span>
              <span class="text-sm font-semibold leading-tight">{{ 'Home.guest.card1' | t }}<small class="mt-0.5 block text-xs font-normal text-muted">{{ 'Home.guest.card1Sub' | t }}</small></span>
            </div>
            <div class="absolute -end-2 -top-7 hidden items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_10px_26px_rgba(11,31,77,.16)] sm:flex lg:-end-4">
              <span class="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span>
              <span class="text-sm font-semibold leading-tight">{{ 'Home.guest.card2' | t }}<small class="mt-0.5 block text-xs font-normal text-muted">{{ 'Home.guest.card2Sub' | t }}</small></span>
            </div>
          </div>
        </div>
      </main>
    } @else {
      <main data-home class="flex flex-1 flex-col bg-brand-soft/60">
        <div [class]="auth.signedIn() ? '' : 'md:flex md:flex-1 md:items-center'">
          <section class="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-14 pt-8 md:grid-cols-[1.5fr_1fr] md:pb-16 md:pt-6">
            <div class="flex flex-col gap-5">
              <h1 class="text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">{{ title() }}</h1>
              <p class="text-pretty text-lg text-ink/80">{{ intro() }}</p>
              <div class="mt-3 flex flex-wrap gap-4">
                <a [routerLink]="link('/tickets/new')" [class]="solid">
                  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none"><path [attr.d]="icon.plus" /></svg>
                  <span class="flex flex-col gap-0.5"><b class="text-lg">{{ 'Home.createCta' | t }}</b><span class="text-sm opacity-90">{{ 'Home.createCaption' | t }}</span></span>
                </a>
                <a [routerLink]="link(auth.signedIn() ? '/tickets' : '/login')" [queryParams]="auth.signedIn() ? null : { next: '/tickets' }" [class]="outline">
                  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-none text-brand"><path [attr.d]="icon.list" /></svg>
                  <span class="flex flex-col gap-0.5"><b class="text-lg">{{ 'Home.myTicketsTitle' | t }}</b><span class="text-sm text-muted">{{ (auth.signedIn() ? 'Home.myTicketsCaptionIn' : 'Home.myTicketsCaption') | t }}</span></span>
                </a>
              </div>
            </div>
            <div class="hidden justify-center md:flex">
              <svg aria-hidden="true" viewBox="0 0 420 320" class="h-auto w-full max-w-md" fill="none">
                <ellipse cx="210" cy="292" rx="150" ry="14" fill="#1f64e6" opacity="0.08" />
                <rect x="60" y="70" width="250" height="170" rx="16" fill="#fff" stroke="#c9d8f5" stroke-width="3" />
                <rect x="60" y="70" width="250" height="30" rx="16" fill="#e5eefd" />
                <circle cx="82" cy="85" r="5" fill="#f4a3a3" /><circle cx="98" cy="85" r="5" fill="#f6d28b" /><circle cx="114" cy="85" r="5" fill="#9fdcb9" />
                <rect x="84" y="120" width="120" height="12" rx="6" fill="#1f64e6" opacity="0.85" />
                <rect x="84" y="144" width="170" height="10" rx="5" fill="#c9d8f5" />
                <rect x="84" y="164" width="140" height="10" rx="5" fill="#c9d8f5" />
                <rect x="84" y="196" width="76" height="26" rx="13" fill="#1f64e6" />
                <path d="M40 252h290l-22 22H62z" fill="#c9d8f5" />
                <rect x="250" y="30" width="130" height="84" rx="22" fill="#1f64e6" />
                <path d="M280 114l-6 26 30-26z" fill="#1f64e6" />
                <path d="M287 74v-6a28 28 0 0 1 56 0v6" stroke="#fff" stroke-width="6" stroke-linecap="round" />
                <rect x="279" y="72" width="14" height="22" rx="7" fill="#fff" /><rect x="337" y="72" width="14" height="22" rx="7" fill="#fff" />
                <path d="M344 94c0 8-8 12-20 12" stroke="#fff" stroke-width="5" stroke-linecap="round" />
                <circle cx="350" cy="196" r="44" fill="#e5eefd" />
                <path d="M326 196v-8a24 24 0 0 1 48 0v8" stroke="#1f64e6" stroke-width="9" stroke-linecap="round" />
                <rect x="318" y="194" width="18" height="30" rx="9" fill="#1f64e6" /><rect x="364" y="194" width="18" height="30" rx="9" fill="#1f64e6" />
              </svg>
            </div>
          </section>
        </div>
      </main>
    }`,
})
export class HomePage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  protected readonly site = inject(SiteService);
  private readonly router = inject(Router);
  private readonly tickets = inject(TicketsApi);
  private readonly http = inject(HttpClient);
  protected readonly icon = HOME_ICON;
  protected readonly card = 'rounded-xl border border-line bg-surface p-5 shadow-card';
  private readonly base = 'flex min-h-[84px] flex-1 basis-60 items-center gap-4 rounded-xl px-5 py-4 sm:max-w-80';
  protected readonly solid = this.base + ' bg-brand text-white hover:bg-brand-ink';
  protected readonly outline = this.base + ' border border-line bg-surface text-ink hover:bg-bg';
  protected readonly customer = computed(() => this.auth.isCustomer() && !this.auth.isStaff());
  protected readonly counts = signal<TicketSummary | null>(null);
  // Guest home in the new look: the same picture and tag as the sign-in page.
  protected readonly look = this.site.authDesign;
  private readonly pickLook = (en: string, ar: string, key: string) => ((this.i18n.locale() === 'ar' ? ar : en) || '').trim() || this.i18n.t(key);
  protected readonly tag = computed(() => this.pickLook(this.look().tagEn, this.look().tagAr, 'AuthLook.tag'));
  /** A card opens My tickets on that list ("Total tickets" = all). */
  protected openList(k: string): void { void this.router.navigate([this.link('/tickets')], { queryParams: { filter: k === 'total' ? null : k } }); }
  protected readonly recent = signal<TicketListItem[] | null>(null);
  protected readonly popular = signal<{ id: string; slug: string; titleEn: string; titleAr: string | null }[]>([]);
  private readonly home = computed(() => {
    try { return JSON.parse(this.site.info()?.site?.homeContent ?? '{}') as { show?: { popular?: boolean }; texts?: Record<string, string> }; } catch { return {}; }
  });
  protected readonly popularTitle = computed(() => this.i18n.pick(this.home().texts?.['popularTitleEn'], this.home().texts?.['popularTitleAr']) || this.i18n.t('Home.d.popularTitle'));
  protected readonly title = computed(() => {
    const own = this.i18n.pick(this.site.info()?.site?.homeTitleEn, this.site.info()?.site?.homeTitleAr);
    const me = this.auth.me();
    return own || (me ? this.i18n.t('Home.welcomeBack', { name: me.fullName.split(' ')[0] }) : this.i18n.t('Home.hello'));
  });
  protected readonly intro = computed(() => this.i18n.pick(this.site.info()?.site?.homeIntroEn, this.site.info()?.site?.homeIntroAr) || this.i18n.t('Home.lead'));
  private loaded = false;

  constructor() {
    effect(() => {
      if (this.auth.isStaff()) { void this.router.navigateByUrl(this.link('/console/dashboard'), { replaceUrl: true }); return; }
      if (this.customer() && !this.loaded) { this.loaded = true; untracked(() => void this.load()); }
    });
  }
  private async load(): Promise<void> {
    const [c, r] = await Promise.all([this.tickets.summary(true), this.tickets.list({ view: 'mine', page: 1, pageSize: 5 })]);
    this.counts.set(c); this.recent.set(r.items.slice(0, 5));
    if (this.home().show?.popular ?? true) {
      try { this.popular.set(await firstValueFrom(this.http.get<{ id: string; slug: string; titleEn: string; titleAr: string | null }[]>('/api/kb/popular', { params: { take: 3 } }))); } catch { /* optional */ }
    }
  }
  link(p: string): string { return `/${this.i18n.locale()}${p}`; }
}

/** Account: profile summary, change password, two-step verification (authenticator app). */
@Component({
  selector: 'app-account',
  imports: [TPipe, TextField, Alert, NewPasswordFields, Submit],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'Account.title' | t }}</h1>
        <p class="mt-1 text-muted">{{ 'Account.subtitle' | t }}</p>
      </div>
      @if (auth.me(); as me) {
        @if (me.mfaSetup && !me.mfaEnabled) {
          <p role="alert" class="rounded-lg border px-4 py-3 text-sm font-semibold" [class]="me.mfaSetup.blocked ? 'border-danger bg-danger-soft text-danger' : 'border-[#f1d58f] bg-warn-soft text-warn-ink'">
            {{ me.mfaSetup.blocked ? ('Mfa.requiredNow' | t) : ('Mfa.requiredBy' | t: { date: i18n.day(me.mfaSetup.deadline) }) }}
            <button type="button" class="ms-1 cursor-pointer underline" (click)="goSetup()">{{ 'Mfa.setUpNow' | t }}</button></p>
        }
        <section aria-labelledby="access" class="rounded-md border border-line bg-surface p-6">
          <h2 id="access" class="text-lg font-bold">{{ 'Account.roles' | t }}</h2>
          <ul class="mt-3 flex flex-wrap gap-2">
            @for (r of me.roles; track r) { <li class="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-ink">{{ 'Roles.' + r | t }}</li> }
          </ul>
          <p class="mt-4 text-sm text-muted">{{ 'Account.status' | t }}: <span class="font-semibold text-ink">{{ 'Status.' + (me.accountStatus ?? 'active') | t }}</span></p>
        </section>

        <section aria-labelledby="profile" class="rounded-md border border-line bg-surface p-6">
          <h2 id="profile" class="mb-4 text-lg font-bold">{{ 'Account.profile' | t }}</h2>
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); saveProfile()">
            <div class="flex flex-col gap-1.5">
              <label for="acc-email" class="text-sm font-semibold">{{ 'Account.email' | t }}</label>
              <input id="acc-email" [value]="me.email" readonly dir="ltr" aria-describedby="acc-email-hint" class="min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-muted" />
              <p id="acc-email-hint" class="text-sm text-muted">{{ 'Account.emailNote' | t }}</p>
            </div>
            <app-text-field name="fullName" [label]="'Auth.fields.fullName' | t" autocomplete="name" [maxLength]="120" [required]="true" [(value)]="fullName" [error]="pfErrors()['fullName']" />
            <app-text-field name="phone" type="tel" [label]="'Auth.fields.phone' | t" autocomplete="tel" dir="ltr" [maxLength]="40" [required]="true" [hint]="'Auth.fields.phoneHint' | t" [(value)]="phone" [error]="pfErrors()['phone']" />
            <div class="flex flex-col gap-1.5">
              <label for="acc-lang" class="text-sm font-semibold">{{ 'Auth.fields.language' | t }}</label>
              <select id="acc-lang" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" (change)="lang.set($any($event.target).value)">
                <option value="en" [selected]="lang() === 'en'">{{ 'Language.en' | t }}</option>
                <option value="ar" [selected]="lang() === 'ar'">{{ 'Language.ar' | t }}</option>
              </select>
            </div>
            @if (pfMsg()) { <app-alert [tone]="pfTone()">{{ pfMsg() }}</app-alert> }
            <app-submit [pending]="pfBusy()">{{ 'Account.save' | t }}</app-submit>
          </form>
        </section>

        <section class="rounded-md border border-line bg-surface p-6" aria-labelledby="mfa-title">
          <h2 id="mfa-title" class="mb-4 scroll-mt-24 text-lg font-bold">{{ 'Mfa.title' | t }}</h2>
          <p class="mb-4 text-sm text-muted">{{ 'Mfa.intro' | t }}</p>
          <p class="mb-4 text-sm font-semibold">{{ 'Mfa.status' | t }}: <span [class]="me.mfaEnabled ? 'text-ok' : 'text-muted'">{{ (me.mfaEnabled ? 'Mfa.on' : 'Mfa.off') | t }}</span></p>
          @if (me.mfaEnabled) {
            @if (confirmOff()) {
              <!-- Turning it off needs a current code (security audit M-01). -->
              <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); disableMfa()">
                <p class="text-sm font-semibold">{{ 'Mfa.confirmOff' | t }}</p>
                <app-text-field name="offCode" [label]="'Mfa.codeLabel' | t" [hint]="'Mfa.offCodeHint' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="6" [required]="true" [(value)]="offCode" />
                <div class="flex flex-wrap gap-2">
                  <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-danger px-5 font-semibold text-white">{{ 'Mfa.yesOff' | t }}</button>
                  <button type="button" (click)="confirmOff.set(false); offCode.set('')" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Mfa.cancel' | t }}</button>
                </div>
              </form>
            } @else {
              <button type="button" (click)="confirmOff.set(true)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Mfa.turnOff' | t }}</button>
            }
            @if (mfaErr()) { <app-alert>{{ 'Mfa.errors.' + mfaErr() | t }}</app-alert> }
          }
          @if (!me.mfaEnabled && !qr()) {
            <button type="button" (click)="startMfa()" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Mfa.turnOn' | t }}</button>
          }
          @if (qr()) {
            <ol class="flex list-decimal flex-col gap-3 ps-5">
              <li>{{ 'Mfa.step1' | t }}</li>
              <li>{{ 'Mfa.step2' | t }}
                <img [src]="qr()" [alt]="'Mfa.qrAlt' | t" width="180" height="180" class="mt-2 rounded border border-line" />
                <p class="mt-2 text-sm"><span class="text-muted">{{ 'Mfa.secretLabel' | t }}: </span><code dir="ltr" class="break-all font-semibold">{{ secret() }}</code></p>
              </li>
              <li>{{ 'Mfa.step3' | t }}</li>
            </ol>
            <form class="mt-4 flex flex-col gap-3" (submit)="$event.preventDefault(); confirmMfa()">
              <app-text-field name="otp" [label]="'Mfa.codeLabel' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="6" [required]="true" [(value)]="otp" />
              @if (mfaErr()) { <app-alert>{{ 'Mfa.errors.' + mfaErr() | t }}</app-alert> }
              <div class="flex gap-2">
                <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Mfa.confirm' | t }}</button>
                <button type="button" (click)="qr.set(null)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Mfa.cancel' | t }}</button>
              </div>
            </form>
          }
        </section>

        <section aria-labelledby="dev" class="rounded-md border border-line bg-surface p-6">
          <h2 id="dev" class="text-lg font-bold">{{ 'Devices.title' | t }}</h2>
          <p class="mb-4 mt-1 text-sm text-muted">{{ 'Devices.intro' | t }}</p>
          @if (devMsg()) { <app-alert [tone]="devTone()">{{ devMsg() }}</app-alert> }
          <ul class="flex flex-col divide-y divide-line">
            @for (d of devices(); track d.id) {
              <li class="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><span class="block font-semibold">{{ d.device }}
                  @if (d.current) { <span class="ms-2 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-bold text-ok">{{ 'Devices.thisOne' | t }}</span> }</span>
                  <span class="block text-sm text-muted">{{ 'Devices.lastUsed' | t: { when: i18n.shortDate(d.lastUsed) } }}@if (d.ip) { · <span dir="ltr">{{ d.ip }}</span> }</span></span>
                @if (!d.current) { <button type="button" (click)="endDevice(d.id)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Devices.signOut' | t }}</button> }
              </li>
            } @empty { <li class="py-3 text-sm text-muted">{{ 'Devices.none' | t }}</li> }
          </ul>
          @if (devices().length > 1) {
            <button type="button" (click)="endOthers()" class="mt-3 min-h-11 cursor-pointer rounded-lg border border-danger bg-surface px-4 font-semibold text-danger hover:bg-danger-soft">{{ 'Devices.signOutOthers' | t }}</button>
          }
        </section>

        <section aria-labelledby="pw" class="rounded-md border border-line bg-surface p-6">
          <h2 id="pw" class="mb-4 text-lg font-bold">{{ 'Account.password' | t }}</h2>
          <form class="flex max-w-md flex-col gap-4" novalidate (submit)="$event.preventDefault(); changePassword()">
            <app-text-field name="current" type="password" [label]="'Auth.change.current' | t" autocomplete="current-password" [required]="true" [(value)]="current" [error]="pwErrors()['currentPassword']" />
            <h3 class="mt-2 text-lg font-bold">{{ 'Auth.change.newTitle' | t }}</h3>
            <app-new-password [(value)]="next" [(confirm)]="confirmNext" [error]="pwErrors()['password']" [confirmError]="pwErrors()['confirm']" />
            @if (pwMsg()) { <app-alert [tone]="pwTone()">{{ pwMsg() }}</app-alert> }
            <app-submit [pending]="false">{{ 'Auth.change.submit' | t }}</app-submit>
          </form>
        </section>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AccountPage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  protected readonly site = inject(SiteService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly pwErrors = signal<Record<string, string>>({});
  protected readonly pwMsg = signal<string | null>(null);
  protected readonly pwTone = signal<'error' | 'success'>('success');
  protected readonly qr = signal<string | null>(null);
  protected readonly secret = signal('');
  protected readonly otp = signal('');
  protected readonly mfaErr = signal<string | null>(null);
  protected readonly confirmOff = signal(false);
  protected readonly offCode = signal('');

  // My devices: where I am signed in now.
  protected readonly devices = signal<{ id: string; device: string; ip: string; lastUsed: string; current: boolean }[]>([]);
  protected readonly devMsg = signal<string | null>(null);
  protected readonly devTone = signal<'error' | 'success'>('success');
  constructor() {
    void this.loadDevices();
    // Sent here because two-step must be set up: open the setup at once.
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('setup') && this.auth.me() && !this.auth.me()!.mfaEnabled)
      setTimeout(() => this.goSetup());
  }
  /** Opens the two-step setup and scrolls to it. */
  protected goSetup(): void { document.getElementById('mfa-title')?.scrollIntoView({ behavior: 'smooth' }); if (!this.qr() && !this.auth.me()?.mfaEnabled) void this.startMfa(); }
  private async loadDevices(): Promise<void> {
    try { this.devices.set(await firstValueFrom(this.http.get<{ id: string; device: string; ip: string; lastUsed: string; current: boolean }[]>('/api/me/sessions'))); } catch { /* the list is optional */ }
  }
  protected async endDevice(id: string): Promise<void> {
    this.devMsg.set(null);
    try { await firstValueFrom(this.http.delete('/api/me/sessions/' + id)); this.devTone.set('success'); this.devMsg.set(this.i18n.t('Devices.ended')); }
    catch { this.devTone.set('error'); this.devMsg.set(this.i18n.t('Auth.errors.generic')); }
    await this.loadDevices();
  }
  protected async endOthers(): Promise<void> {
    this.devMsg.set(null);
    try { await firstValueFrom(this.http.post('/api/me/sessions/sign-out-others', {})); this.devTone.set('success'); this.devMsg.set(this.i18n.t('Devices.endedOthers')); }
    catch { this.devTone.set('error'); this.devMsg.set(this.i18n.t('Auth.errors.generic')); }
    await this.loadDevices();
  }
  protected disableMfa(): void {
    this.mfaErr.set(null);
    firstValueFrom(this.http.post('/api/auth/mfa/disable', { code: this.offCode().trim() }))
      .then(() => { this.confirmOff.set(false); this.offCode.set(''); return this.auth.loadMe(); })
      .catch((e) => {
        const code = problemOf(e).code;
        this.mfaErr.set(code === 'mfaWrong' ? 'mfaWrong' : code === 'rateLimited' ? 'locked' : 'disable');
      });
  }
  protected readonly roles = computed(() => (this.auth.me()?.roles ?? []).map((r) => this.i18n.t('Roles.' + r)).join(', '));

  protected readonly confirmNext = signal('');
  // Profile form (v1 ProfileForm): name, phone and language.
  protected readonly fullName = signal(this.auth.me()?.fullName ?? '');
  protected readonly phone = signal(this.auth.me()?.phone ?? '');
  protected readonly lang = signal<string>(this.auth.me()?.preferredLocale ?? this.i18n.locale());
  protected readonly pfErrors = signal<Record<string, string>>({});
  protected readonly pfMsg = signal<string | null>(null);
  protected readonly pfTone = signal<'error' | 'success'>('success');
  protected readonly pfBusy = signal(false);
  saveProfile(): void {
    this.pfErrors.set({}); this.pfMsg.set(null); this.pfBusy.set(true);
    firstValueFrom(this.http.put('/api/me', { fullName: this.fullName(), phone: this.phone(), preferredLocale: this.lang() }))
      .then(async () => { await this.auth.loadMe(); this.pfTone.set('success'); this.pfMsg.set(this.i18n.t('Account.saved')); })
      .catch((e) => {
        const p = problemOf(e);
        if (p.field && p.field !== 'preferredLocale') this.pfErrors.set({ [p.field]: p.code });
        else { this.pfTone.set('error'); this.pfMsg.set(this.i18n.t('Auth.errors.' + (this.i18n.has('Auth.errors.' + p.code) ? p.code : 'generic'))); }
      })
      .finally(() => this.pfBusy.set(false));
  }

  changePassword(): void {
    this.pwErrors.set({}); this.pwMsg.set(null);
    if (this.next() !== this.confirmNext()) { this.pwErrors.set({ confirm: 'passwordMismatch' }); return; }
    firstValueFrom(this.http.post('/api/auth/change-password', { currentPassword: this.current(), password: this.next() }))
      .then(async () => {
        // All sessions end on a password change: sign in again with the new password.
        this.auth.clear();
        await this.router.navigate([`/${this.i18n.locale()}/login`]);
      })
      .catch((e) => {
        const p = problemOf(e);
        if (p.field) this.pwErrors.set({ [p.field]: p.code });
        else { this.pwTone.set('error'); this.pwMsg.set(this.i18n.t('Auth.errors.' + (this.i18n.has('Auth.errors.' + p.code) ? p.code : 'generic'))); }
      });
  }

  async startMfa(): Promise<void> {
    const r = await firstValueFrom(this.http.post<{ secret: string; otpauthUri: string }>('/api/auth/mfa/enroll', {}));
    this.secret.set(r.secret);
    this.qr.set(await QRCode.toDataURL(r.otpauthUri, { width: 180, margin: 1 }));
  }

  confirmMfa(): void {
    this.mfaErr.set(null);
    firstValueFrom(this.http.post('/api/auth/mfa/enroll/verify', { code: this.otp().trim() }))
      .then(async () => { this.auth.clear(); await this.router.navigate([`/${this.i18n.locale()}/login`]); })
      .catch((e) => this.mfaErr.set(problemOf(e).code === 'mfaWrong' ? 'mfaWrong' : 'generic'));
  }
}

interface NotificationRow { id: string; eventType: string; ticketId: string | null; payload: string; readAt: string | null; createdAt: string }

@Component({
  selector: 'app-notifications',
  imports: [TPipe, RouterLink],
  template: `
    <main class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Notifications.title' | t }}</h1><p class="mt-1 text-muted">{{ 'Notifications.subtitle' | t }}</p></div>
        @if (hasUnread()) { <button type="button" (click)="markAll()" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Notifications.markAll' | t }}</button> }
      </div>
      <ul class="flex flex-col gap-3">
        @for (n of items(); track n.id) {
          <li [class]="'rounded-md border p-4 ' + (n.readAt ? 'border-line bg-surface' : 'border-brand bg-brand-soft')">
            <p class="font-semibold" dir="auto">{{ title(n) }}@if (!n.readAt) { <span class="ms-2 rounded-full bg-brand px-2 py-0.5 text-xs text-white">{{ 'Notifications.unread' | t }}</span> }</p>
            <p class="mt-1" dir="auto">{{ body(n) }}</p>
            <p class="mt-2 text-sm text-muted">{{ i18n.date(n.createdAt) }}</p>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              @if (n.ticketId) { <a [routerLink]="ticketLink(n.ticketId)" (click)="read(n)" class="flex min-h-11 items-center font-semibold text-brand-ink underline">{{ 'Notifications.open' | t }}</a> }
              @if (!n.readAt) { <button type="button" (click)="read(n)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-semibold">{{ 'Notifications.markRead' | t }}</button> }
            </div>
          </li>
        } @empty { <li class="rounded-md border border-line bg-surface p-8 text-center text-muted">{{ 'Notifications.empty' | t }}</li> }
      </ul>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class NotificationsPage {
  protected readonly i18n = inject(I18n);
  private readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  protected readonly items = signal<NotificationRow[]>([]);
  protected readonly hasUnread = computed(() => this.items().some((n) => !n.readAt));
  constructor() { this.load(); }
  load(): void { void firstValueFrom(this.http.get<{ items: NotificationRow[] }>('/api/notifications')).then((r) => this.items.set(r.items)); }
  private params(n: NotificationRow): Record<string, unknown> { try { return JSON.parse(n.payload) as Record<string, unknown>; } catch { return {}; } }
  title(n: NotificationRow): string { return this.i18n.t(`Notifications.events.${n.eventType}.title`, this.params(n)); }
  body(n: NotificationRow): string { return this.i18n.t(`Notifications.events.${n.eventType}.body`, this.params(n)); }
  ticketLink(id: string): string { return `/${this.i18n.locale()}${this.auth.isStaff() ? '/console/tickets/' : '/tickets/'}${id}`; }
  read(n: NotificationRow): void { void firstValueFrom(this.http.post(`/api/notifications/${n.id}/read`, {})).then(() => { this.load(); void this.auth.loadMe(); }); }
  markAll(): void { void firstValueFrom(this.http.post('/api/notifications/read-all', {})).then(() => { this.load(); void this.auth.loadMe(); }); }
}
