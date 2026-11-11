import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth, problemOf } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { SiteService } from '../../core/api';
import { Alert, Card, NewPasswordFields, Req, Submit, TextField } from '../../shared/ui';

/** Only same-site paths are accepted as "next" (safeNextPath today). */
function safeNext(raw: string | null | undefined): string | null {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : null;
}

abstract class FormBase {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  protected readonly router = inject(Router);
  protected readonly route = inject(ActivatedRoute);
  protected readonly site = inject(SiteService);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected link(path: string): string { return `/${this.i18n.locale()}${path}`; }

  protected async run(work: () => Promise<void>): Promise<void> {
    this.pending.set(true);
    this.error.set(null);
    this.fieldErrors.set({});
    try { await work(); }
    catch (e) {
      const p = problemOf(e);
      if (p.field) this.fieldErrors.set({ [p.field]: p.code });
      else this.error.set(this.i18n.has('Auth.errors.' + p.code) ? p.code : 'generic');
    } finally { this.pending.set(false); }
  }

  protected async goHome(): Promise<void> {
    const next = safeNext(this.route.snapshot.queryParamMap.get('next'));
    await this.router.navigateByUrl(next ?? this.auth.homePath());
  }
}

@Component({
  selector: 'app-login',
  imports: [Card, Alert, TextField, Submit, RouterLink, TPipe],
  template: `
    <main class="px-4 py-12">
      @if (notice()) { <p role="note" dir="auto" class="mx-auto mb-4 max-w-md rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm font-medium text-brand-ink">{{ notice() }}</p> }
      <app-card [heading]="'Auth.login.title' | t" [subtitle]="'Auth.login.subtitle' | t">
        @if (reason() === 'suspended') { <app-alert>{{ 'Auth.login.suspendedNotice' | t }}</app-alert> }
        @if (reason() === 'pending_approval') { <app-alert>{{ 'Auth.login.pendingNotice' | t }}</app-alert> }
        <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); submit()">
          <app-text-field name="email" [label]="'Auth.fields.identifier' | t" autocomplete="username" dir="ltr" [required]="true" [(value)]="identifier" [error]="fieldErrors()['identifier']" />
          <app-text-field name="password" type="password" [label]="'Auth.fields.password' | t" autocomplete="current-password" [required]="true" [(value)]="password" [error]="fieldErrors()['password']" />
          @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
          <app-submit [pending]="pending()">{{ 'Auth.login.submit' | t }}</app-submit>
        </form>
        <div class="flex flex-col gap-2 text-sm">
          <a [routerLink]="link('/forgot-password')" class="font-semibold text-brand-ink underline">{{ 'Auth.login.forgot' | t }}</a>
          @if (site.info()?.signinCodes?.enabled) { <a [routerLink]="link('/login/code')" [queryParams]="{ next: route.snapshot.queryParamMap.get('next') }" class="font-semibold text-brand-ink underline">{{ 'Auth.login.codeLink' | t }}</a> }
          @if (site.info()?.site?.registrationMode !== 'closed') {
            <p class="text-muted">{{ 'Auth.login.noAccount' | t }} <a [routerLink]="link('/register')" class="font-semibold text-brand-ink underline">{{ 'Auth.login.register' | t }}</a></p>
          }
        </div>
      </app-card>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class LoginPage extends FormBase {
  protected readonly identifier = signal('');
  protected readonly password = signal('');
  protected readonly reason = computed(() => this.route.snapshot.queryParamMap.get('reason'));
  protected readonly notice = computed(() => this.i18n.pick(this.site.info()?.site?.loginNoticeEn, this.site.info()?.site?.loginNoticeAr));

  submit(): void {
    const fe: Record<string, string> = {};
    if (!this.identifier().trim()) fe['identifier'] = 'required';
    if (!this.password()) fe['password'] = 'required';
    if (Object.keys(fe).length) { this.fieldErrors.set(fe); return; }
    void this.run(async () => {
      let s;
      try { s = await this.auth.signIn(this.identifier().trim(), this.password()); }
      catch (e) {
        // Expired password: a code was emailed; open the renewal step (v1 /reset-password?expired=1).
        if (problemOf(e).code === 'passwordExpired') {
          const id = this.identifier().trim();
          await this.router.navigate([this.link('/reset-password')], { queryParams: { email: id.includes('@') ? id : null, expired: 1 } });
          return;
        }
        throw e;
      }
      if (s.mfaRequired) await this.router.navigate([this.link('/mfa')], { queryParamsHandling: 'preserve' });
      else await this.goHome();
    });
  }
}

@Component({
  selector: 'app-mfa',
  imports: [Card, Alert, TextField, Submit, TPipe],
  template: `
    <main class="px-4 py-12">
      <app-card [heading]="'Auth.mfa.title' | t" [subtitle]="'Auth.mfa.subtitle' | t">
        <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); submit()">
          <app-text-field name="code" [label]="'Auth.mfa.label' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="6" [required]="true" [(value)]="code" />
          @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
          <app-submit [pending]="pending()">{{ 'Auth.mfa.submit' | t }}</app-submit>
        </form>
      </app-card>
    </main>`,
})
export class MfaPage extends FormBase {
  protected readonly code = signal('');
  constructor() {
    super();
    if (!this.auth.pendingMfaToken()) void this.router.navigateByUrl(this.link('/login'));
  }
  submit(): void {
    if (!/^\d{6}$/.test(this.code().trim())) { this.error.set('codeFormat'); return; }
    void this.run(async () => { await this.auth.verifyMfa(this.code().trim()); await this.goHome(); });
  }
}

@Component({
  selector: 'app-login-code',
  imports: [Card, Alert, TextField, Submit, RouterLink, TPipe],
  template: `
    <main class="px-4 py-12">
      <app-card [heading]="'Auth.signinCode.title' | t" [subtitle]="(sent() ? 'Auth.signinCode.sent' : 'Auth.signinCode.subtitle') | t">
        @if (!sent()) {
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); request()">
            <app-text-field name="email" type="email" [label]="'Auth.fields.email' | t" autocomplete="email" dir="ltr" [required]="true" [(value)]="email" [error]="fieldErrors()['email']" />
            @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
            <app-submit [pending]="pending()">{{ 'Auth.signinCode.send' | t }}</app-submit>
          </form>
        } @else {
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); verify()">
            <app-text-field name="code" [label]="'Auth.signinCode.codeLabel' | t" [hint]="'Auth.signinCode.codeHint' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="10" [required]="true" [(value)]="code" />
            @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
            <app-submit [pending]="pending()">{{ 'Auth.signinCode.submit' | t }}</app-submit>
          </form>
        }
        <a [routerLink]="link('/login')" class="text-sm font-semibold text-brand-ink underline">{{ 'Auth.signinCode.back' | t }}</a>
      </app-card>
    </main>`,
})
export class LoginCodePage extends FormBase {
  private readonly http = inject(HttpClient);
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly sent = signal(false);
  request(): void {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email().trim())) { this.fieldErrors.set({ email: 'emailInvalid' }); return; }
    void this.run(async () => { await firstValueFrom(this.http.post('/api/auth/signin-code', { email: this.email().trim() })); this.sent.set(true); });
  }
  verify(): void {
    void this.run(async () => {
      const s = await this.auth.verifySigninCode(this.email().trim(), this.code().trim());
      if (s.mfaRequired) await this.router.navigateByUrl(this.link('/mfa'));
      else await this.goHome();
    });
  }
}

interface SignupOrg { id: string; name: string; branches: { id: string; name: string }[] }

@Component({
  selector: 'app-register',
  imports: [Card, Alert, TextField, Submit, Req, RouterLink, TPipe, NewPasswordFields],
  template: `
    <main class="px-4 py-12">
      @if (done()) {
        <app-card [heading]="'Auth.register.sentTitle' | t">
          <app-alert tone="success">{{ (mode() === 'pick_auto' ? 'V2.confirm.bodyAuto' : 'V2.confirm.body') | t }}</app-alert>
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); confirm()">
            <app-text-field name="code" [label]="'Auth.code.label' | t" [hint]="'V2.confirm.hint' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="6" [required]="true" [(value)]="code" />
            @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
            @if (confirmed()) { <app-alert tone="success">{{ (mode() === 'pick_auto' ? 'V2.confirm.doneAuto' : 'V2.confirm.done') | t }}</app-alert> }
            <app-submit [pending]="pending()">{{ 'Auth.code.submit' | t }}</app-submit>
          </form>
          <a [routerLink]="link('/login')" class="text-sm font-semibold text-brand-ink underline">{{ 'Auth.register.login' | t }}</a>
        </app-card>
      } @else {
        <app-card [heading]="'Auth.register.title' | t" [subtitle]="'Auth.register.subtitle' | t">
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); submit()">
            <app-text-field name="fullName" [label]="'Auth.fields.fullName' | t" autocomplete="name" [maxLength]="120" [required]="true" [(value)]="fullName" [error]="fieldErrors()['fullName']" />
            <app-text-field name="email" type="email" [label]="'Auth.fields.email' | t" autocomplete="email" dir="ltr" [required]="true" [(value)]="email" [error]="fieldErrors()['email']" />
            <app-text-field name="phone" type="tel" [label]="'Auth.fields.phone' | t" autocomplete="tel-national" dir="ltr" [maxLength]="11" [required]="true" [hint]="'Auth.fields.phoneHint' | t" [(value)]="phone" [error]="fieldErrors()['phone']" />
            @if (mode() === 'pick_approval' || mode() === 'pick_auto') {
              <div class="flex flex-col gap-1.5">
                <label for="org" class="text-sm font-semibold">{{ 'Auth.fields.organization' | t }}<app-req /></label>
                <select id="org" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base" [value]="orgId()" (change)="orgId.set($any($event.target).value); branchId.set('')">
                  <option value="">{{ 'Auth.fields.pickOrganization' | t }}</option>
                  @for (o of orgs(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                </select>
                @if (fieldErrors()['organizationId']) { <p class="text-sm font-medium text-danger">{{ 'Auth.errors.required' | t }}</p> }
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="branch" class="text-sm font-semibold">{{ 'Auth.fields.branch' | t }}</label>
                <select id="branch" class="min-h-11 rounded-lg border border-line bg-surface px-3 text-base disabled:bg-bg" [disabled]="!orgId()" [value]="branchId()" (change)="branchId.set($any($event.target).value)">
                  <option value="">{{ 'Auth.fields.noBranch' | t }}</option>
                  @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
                </select>
              </div>
            }
            <app-new-password [(value)]="password" [(confirm)]="confirmPw" [error]="fieldErrors()['password']" [confirmError]="fieldErrors()['confirm']" />
            @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
            <app-submit [pending]="pending()">{{ 'Auth.register.submit' | t }}</app-submit>
          </form>
          <p class="text-sm text-muted">{{ 'Auth.register.haveAccount' | t }} <a [routerLink]="link('/login')" class="font-semibold text-brand-ink underline">{{ 'Auth.register.login' | t }}</a></p>
        </app-card>
      }
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class RegisterPage extends FormBase {
  private readonly http = inject(HttpClient);
  protected readonly fullName = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly password = signal('');
  protected readonly confirmPw = signal('');
  protected readonly code = signal('');
  protected readonly orgId = signal('');
  protected readonly branchId = signal('');
  protected readonly done = signal(false);
  protected readonly confirmed = signal(false);
  protected readonly orgs = signal<SignupOrg[]>([]);
  protected readonly mode = computed(() => this.site.info()?.site?.registrationMode ?? 'approval');
  protected readonly branches = computed(() => this.orgs().find((o) => o.id === this.orgId())?.branches ?? []);

  constructor() {
    super();
    void firstValueFrom(this.http.get<{ organizations: SignupOrg[] }>('/api/site/signup-options')).then((r) => this.orgs.set(r.organizations)).catch(() => undefined);
  }

  private passwordProblems(pw: string): string | null {
    const p = this.site.info()?.passwordPolicy ?? { minLength: 10, requireUpper: true, requireLower: true, requireNumber: true, requireSpecial: true };
    if (pw.length < p.minLength) return 'passwordShort';
    if (p.requireUpper && !/[A-Z]/.test(pw)) return 'passwordUpper';
    if (p.requireLower && !/[a-z]/.test(pw)) return 'passwordLower';
    if (p.requireNumber && !/[0-9]/.test(pw)) return 'passwordNumber';
    if (p.requireSpecial && !/[^A-Za-z0-9]/.test(pw)) return 'passwordSpecial';
    return null;
  }

  submit(): void {
    const fe: Record<string, string> = {};
    if (this.fullName().trim().length < 2) fe['fullName'] = 'nameRequired';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email().trim())) fe['email'] = 'emailInvalid';
    if (!/^01[0-9]{9}$/.test(this.phone().trim())) fe['phone'] = this.phone().trim() ? 'phoneInvalid' : 'phoneRequired';
    const pw = this.passwordProblems(this.password());
    if (pw) fe['password'] = pw;
    if (this.password() !== this.confirmPw()) fe['confirm'] = 'passwordMismatch';
    if ((this.mode() === 'pick_approval' || this.mode() === 'pick_auto') && !this.orgId()) fe['organizationId'] = 'required';
    if (Object.keys(fe).length) { this.fieldErrors.set(fe); return; }
    void this.run(async () => {
      await firstValueFrom(this.http.post('/api/auth/register', {
        fullName: this.fullName().trim(), email: this.email().trim(), phone: this.phone().trim(), password: this.password(),
        locale: this.i18n.locale(), organizationId: this.orgId() || null, branchId: this.branchId() || null,
      }));
      this.done.set(true);
    });
  }

  confirm(): void {
    void this.run(async () => {
      await firstValueFrom(this.http.post('/api/auth/confirm-email', { email: this.email().trim(), code: this.code().trim() }));
      this.confirmed.set(true);
    });
  }
}

@Component({
  selector: 'app-forgot',
  imports: [Card, Alert, TextField, Submit, RouterLink, TPipe],
  template: `
    <main class="px-4 py-12">
      <app-card [heading]="'Auth.forgot.title' | t" [subtitle]="'Auth.forgot.subtitle' | t">
        <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); submit()">
          <app-text-field name="email" type="email" [label]="'Auth.fields.email' | t" autocomplete="email" dir="ltr" [required]="true" [(value)]="email" [error]="fieldErrors()['email']" />
          @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
          <app-submit [pending]="pending()">{{ 'Auth.forgot.submit' | t }}</app-submit>
        </form>
        <a [routerLink]="link('/login')" class="text-sm font-semibold text-brand-ink underline">{{ 'Auth.register.login' | t }}</a>
      </app-card>
    </main>`,
})
export class ForgotPage extends FormBase {
  private readonly http = inject(HttpClient);
  protected readonly email = signal('');
  submit(): void {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email().trim())) { this.fieldErrors.set({ email: 'emailInvalid' }); return; }
    void this.run(async () => {
      await firstValueFrom(this.http.post('/api/auth/forgot-password', { email: this.email().trim() }));
      await this.router.navigate([this.link('/reset-password')], { queryParams: { email: this.email().trim() } });
    });
  }
}

@Component({
  selector: 'app-reset',
  imports: [Card, Alert, TextField, Submit, RouterLink, TPipe, NewPasswordFields],
  template: `
    <main class="px-4 py-12">
      <app-card [heading]="'Auth.reset.title' | t" [subtitle]="'Auth.reset.subtitle' | t">
        @if (done()) {
          <app-alert tone="success">{{ 'V2.resetDone' | t }}</app-alert>
          <a [routerLink]="link('/login')" class="text-sm font-semibold text-brand-ink underline">{{ 'Auth.register.login' | t }}</a>
        } @else {
          @if (expired) { <app-alert>{{ 'Auth.code.expired' | t }}</app-alert> }
          <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); submit()">
            <app-text-field name="email" type="email" [label]="'Auth.fields.email' | t" dir="ltr" [required]="true" [(value)]="email" />
            <app-text-field name="code" [label]="'Auth.code.label' | t" [hint]="'Auth.code.hint' | t" autocomplete="one-time-code" dir="ltr" [maxLength]="6" [required]="true" [(value)]="code" />
            <app-new-password [(value)]="password" [(confirm)]="confirmPw" [error]="fieldErrors()['password']" [confirmError]="fieldErrors()['confirm']" />
            @if (error()) { <app-alert>{{ 'Auth.errors.' + error() | t }}</app-alert> }
            <app-submit [pending]="pending()">{{ 'Auth.reset.submit' | t }}</app-submit>
          </form>
        }
      </app-card>
    </main>`,
})
export class ResetPage extends FormBase {
  private readonly http = inject(HttpClient);
  protected readonly email = signal(this.route.snapshot.queryParamMap.get('email') ?? '');
  protected readonly expired = this.route.snapshot.queryParamMap.get('expired') === '1';
  protected readonly code = signal('');
  protected readonly password = signal('');
  protected readonly confirmPw = signal('');
  protected readonly done = signal(false);
  submit(): void {
    if (this.password() !== this.confirmPw()) { this.fieldErrors.set({ confirm: 'passwordMismatch' }); return; }
    void this.run(async () => {
      await firstValueFrom(this.http.post('/api/auth/reset-password', { email: this.email().trim(), code: this.code().trim(), password: this.password() }));
      this.done.set(true);
    });
  }
}
