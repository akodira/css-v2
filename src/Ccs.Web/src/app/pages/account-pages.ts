import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';
import { Auth, problemOf } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { SiteService, TicketListItem, TicketsApi, TicketSummary } from '../core/api';
import { Alert, StatusBadge, TextField } from '../shared/ui';

const HOME_ICON = { plus: 'M12 5v14M5 12h14', list: 'M4 6h16M4 12h16M4 18h10' };
const HOME_KPI = {
  active: { path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', tone: 'bg-warn-soft text-warn-ink' },
  waiting: { path: 'M4 4h16v16H4zM4 7l8 6 8-6', tone: 'bg-danger-soft text-danger' },
  resolved: { path: 'M20 6 9 17l-5-5', tone: 'bg-ok-soft text-ok' },
  closed: { path: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z', tone: 'bg-brand-soft text-brand' },
} as const;
type KpiKey = keyof typeof HOME_KPI;

/** Home, same as v1: guest hero with two action cards and the illustration; signed-in customers get their dashboard; staff go to the console. */
@Component({
  selector: 'app-home',
  imports: [RouterLink, TPipe, StatusBadge],
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
        <dl class="grid grid-cols-2 gap-4 md:grid-cols-4">
          @for (k of kpis; track k) {
            <a [routerLink]="link('/tickets')" [queryParams]="{ filter: k }" [class]="card + ' flex flex-col items-center gap-2 text-center hover:bg-bg'">
              <span aria-hidden="true" class="flex h-12 w-12 items-center justify-center rounded-full" [class]="kpi[k].tone">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="kpi[k].path" /></svg>
              </span>
              <dd class="text-4xl font-bold leading-none">{{ counts()?.[k] ?? '…' }}</dd>
              <dt class="text-sm font-medium text-muted">{{ 'Tickets.summary.' + k | t }}</dt>
            </a>
          }
        </dl>
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
                        <app-status-badge [status]="r.status" />
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
    } @else {
      <main data-home class="bg-brand-soft/60">
        <div [class]="auth.signedIn() ? '' : 'md:flex md:min-h-[calc(100dvh-8.25rem)] md:items-center'">
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
  private readonly site = inject(SiteService);
  private readonly router = inject(Router);
  private readonly tickets = inject(TicketsApi);
  private readonly http = inject(HttpClient);
  protected readonly icon = HOME_ICON;
  protected readonly kpi = HOME_KPI;
  protected readonly kpis = Object.keys(HOME_KPI) as KpiKey[];
  protected readonly card = 'rounded-xl border border-line bg-surface p-5 shadow-card';
  private readonly base = 'flex min-h-[84px] flex-1 basis-60 items-center gap-4 rounded-xl px-5 py-4 sm:max-w-80';
  protected readonly solid = this.base + ' bg-brand text-white hover:bg-brand-ink';
  protected readonly outline = this.base + ' border border-line bg-surface text-ink hover:bg-bg';
  protected readonly customer = computed(() => this.auth.isCustomer() && !this.auth.isStaff());
  protected readonly counts = signal<TicketSummary | null>(null);
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
  imports: [TPipe, TextField, Alert],
  template: `
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'Account.title' | t }}</h1>
        <p class="mt-1 text-muted">{{ 'Account.subtitle' | t }}</p>
      </div>
      @if (auth.me(); as me) {
        <section class="rounded-md border border-line bg-surface p-6">
          <h2 class="mb-3 text-lg font-bold">{{ 'Account.profile' | t }}</h2>
          <dl class="grid gap-3 sm:grid-cols-2">
            <div><dt class="text-sm text-muted">{{ 'Auth.fields.fullName' | t }}</dt><dd class="font-semibold" dir="auto">{{ me.fullName }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Account.email' | t }}</dt><dd class="font-semibold" dir="ltr">{{ me.email }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Auth.fields.phone' | t }}</dt><dd class="font-semibold" dir="ltr">{{ me.phone ?? '-' }}</dd></div>
            <div><dt class="text-sm text-muted">{{ 'Account.roles' | t }}</dt><dd class="font-semibold">{{ roles() }}</dd></div>
          </dl>
        </section>

        <section class="rounded-md border border-line bg-surface p-6">
          <h2 class="mb-3 text-lg font-bold">{{ 'Account.password' | t }}</h2>
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); changePassword()">
            <app-text-field name="current" type="password" [label]="'Auth.change.current' | t" autocomplete="current-password" [required]="true" [(value)]="current" [error]="pwErrors()['currentPassword']" />
            <app-text-field name="next" type="password" [label]="'Auth.change.newTitle' | t" autocomplete="new-password" [required]="true" [hint]="'Auth.password.rules.length' | t: { min: site.info()?.passwordPolicy?.minLength ?? 10 }" [(value)]="next" [error]="pwErrors()['password']" />
            @if (pwMsg()) { <app-alert [tone]="pwTone()">{{ pwMsg() }}</app-alert> }
            <div><button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Auth.change.submit' | t }}</button></div>
          </form>
        </section>

        <section class="rounded-md border border-line bg-surface p-6">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-bold">{{ 'Mfa.title' | t }}</h2>
            <span class="rounded-full px-3 py-1 text-xs font-semibold" [class]="me.mfaEnabled ? 'bg-ok-soft text-ok' : 'bg-bg text-muted border border-line'">{{ (me.mfaEnabled ? 'Mfa.on' : 'Mfa.off') | t }}</span>
          </div>
          <p class="mb-4 text-muted">{{ 'Mfa.intro' | t }}</p>
          @if (me.mfaEnabled) {
            @if (confirmOff()) {
              <div class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">{{ 'Mfa.confirmOff' | t }}</span>
                <button type="button" (click)="disableMfa()" class="min-h-11 cursor-pointer rounded-lg bg-danger px-5 font-semibold text-white">{{ 'Mfa.yesOff' | t }}</button>
                <button type="button" (click)="confirmOff.set(false)" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-5 font-semibold hover:bg-bg">{{ 'Mfa.cancel' | t }}</button></div>
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
  protected disableMfa(): void {
    this.mfaErr.set(null);
    firstValueFrom(this.http.post('/api/auth/mfa/disable', {}))
      .then(() => { this.confirmOff.set(false); return this.auth.loadMe(); })
      .catch(() => this.mfaErr.set('disable'));
  }
  protected readonly roles = computed(() => (this.auth.me()?.roles ?? []).map((r) => this.i18n.t('Roles.' + r)).join(', '));

  changePassword(): void {
    this.pwErrors.set({}); this.pwMsg.set(null);
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
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Notifications.title' | t }}</h1><p class="mt-1 text-muted">{{ 'Notifications.subtitle' | t }}</p></div>
        <button type="button" (click)="markAll()" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg">{{ 'Notifications.markAll' | t }}</button>
      </div>
      <ul class="flex flex-col gap-2">
        @for (n of items(); track n.id) {
          <li class="rounded-md border p-4" [class]="n.readAt ? 'border-line bg-surface' : 'border-brand/40 bg-brand-soft'">
            <p class="font-semibold" dir="auto">{{ title(n) }}</p>
            <p class="text-sm text-muted" dir="auto">{{ body(n) }}</p>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span class="text-muted">{{ i18n.date(n.createdAt) }}</span>
              @if (n.ticketId) { <a [routerLink]="ticketLink(n.ticketId)" (click)="read(n)" class="font-semibold text-brand-ink underline">{{ 'Notifications.open' | t }}</a> }
              @if (!n.readAt) { <button type="button" (click)="read(n)" class="cursor-pointer font-semibold text-brand-ink underline">{{ 'Notifications.markRead' | t }}</button> }
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
  constructor() { this.load(); }
  load(): void { void firstValueFrom(this.http.get<{ items: NotificationRow[] }>('/api/notifications')).then((r) => this.items.set(r.items)); }
  private params(n: NotificationRow): Record<string, unknown> { try { return JSON.parse(n.payload) as Record<string, unknown>; } catch { return {}; } }
  title(n: NotificationRow): string { return this.i18n.t(`Notifications.events.${n.eventType}.title`, this.params(n)); }
  body(n: NotificationRow): string { return this.i18n.t(`Notifications.events.${n.eventType}.body`, this.params(n)); }
  ticketLink(id: string): string { return `/${this.i18n.locale()}${this.auth.isStaff() ? '/console/tickets/' : '/tickets/'}${id}`; }
  read(n: NotificationRow): void { void firstValueFrom(this.http.post(`/api/notifications/${n.id}/read`, {})).then(() => { this.load(); void this.auth.loadMe(); }); }
  markAll(): void { void firstValueFrom(this.http.post('/api/notifications/read-all', {})).then(() => { this.load(); void this.auth.loadMe(); }); }
}
