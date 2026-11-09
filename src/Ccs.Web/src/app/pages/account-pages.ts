import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import QRCode from 'qrcode';
import { Auth, problemOf } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { SiteService } from '../core/api';
import { Alert, TextField } from '../shared/ui';

/** Public home: hero, the two main actions, sign-in prompt (the full CMS-driven home arrives with stage 8). */
@Component({
  selector: 'app-home',
  imports: [RouterLink, TPipe],
  template: `
    <main data-home class="flex flex-1 flex-col">
      <section class="bg-chrome px-4 py-16 text-white">
        <div class="mx-auto flex max-w-6xl flex-col gap-4">
          <p class="text-sm font-semibold uppercase tracking-wide text-white/70">{{ 'Home.phase' | t }}</p>
          <h1 class="max-w-2xl text-4xl font-bold tracking-tight">{{ title() }}</h1>
          <p class="max-w-2xl text-lg text-white/80">{{ intro() }}</p>
        </div>
      </section>
      <section class="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2">
        <a [routerLink]="link(auth.isStaff() ? '/console' : '/tickets/new')" class="rounded-xl border border-line bg-surface p-6 shadow-card hover:bg-brand-soft">
          <h2 class="text-xl font-bold">{{ (auth.isStaff() ? 'Home.openConsole' : 'Home.submit') | t }}</h2>
          <p class="mt-1 text-muted">{{ (auth.isStaff() ? 'Home.openConsoleDesc' : 'Home.submitDesc') | t }}</p>
        </a>
        <a [routerLink]="link(auth.isStaff() ? '/console' : '/tickets')" class="rounded-xl border border-line bg-surface p-6 shadow-card hover:bg-brand-soft">
          <h2 class="text-xl font-bold">{{ 'Home.view' | t }}</h2>
          <p class="mt-1 text-muted">{{ (auth.signedIn() ? 'Home.viewDesc' : 'Home.signInToView') | t }}</p>
        </a>
      </section>
    </main>`,
})
export class HomePage {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly site = inject(SiteService);
  protected readonly title = computed(() => this.i18n.pick(this.site.info()?.site?.homeTitleEn, this.site.info()?.site?.homeTitleAr) || this.i18n.t('Home.hello'));
  protected readonly intro = computed(() => this.i18n.pick(this.site.info()?.site?.homeIntroEn, this.site.info()?.site?.homeIntroAr) || this.i18n.t('Home.lead'));
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
