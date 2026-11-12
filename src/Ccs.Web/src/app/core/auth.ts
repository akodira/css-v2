import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { I18n } from './i18n';

export interface SessionResponse {
  accessToken: string | null;
  expiresAt: string | null;
  mfaRequired: boolean;
  mfaToken: string | null;
  roles: string[];
  locale: 'en' | 'ar';
}

export interface Me {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  preferredLocale: 'en' | 'ar';
  roles: string[];
  permissions: string[];
  admin: boolean;
  staff: boolean;
  viewer: boolean;
  customer: boolean;
  scopeLevel: string | null;
  leadsTeam?: boolean;
  accountStatus?: string;
  mfaEnabled: boolean;
  unreadNotifications: number;
  idleTimeoutMinutes?: number;
}

/** Problem response from the API: { status, title, code, field? }. */
export interface ApiProblem { status: number; code: string; field?: string }

export function problemOf(err: unknown): ApiProblem {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { code?: string; title?: string; field?: string } | null;
    return { status: err.status, code: body?.code ?? (err.status === 0 ? 'generic' : 'generic'), field: body?.field };
  }
  return { status: 0, code: 'generic' };
}

let idleLimitMs = 5 * 60 * 1000;   // set from Settings > System rules after sign-in; 0 turns idle sign-out off
const IDLE_KEY = 'ccs.lastActive';
const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;

/**
 * Session handling. The access token (15 min) stays in memory only; the refresh token is an HttpOnly,
 * Secure, SameSite=Strict cookie scoped to /api/auth, so script on the page can never read it.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  private readonly token = signal<string | null>(null);
  private mfaToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  readonly me = signal<Me | null>(null);
  readonly signedIn = computed(() => this.me() !== null);
  readonly isStaff = computed(() => !!this.me() && (this.me()!.staff || this.me()!.viewer));
  readonly isCustomer = computed(() => !!this.me()?.customer);

  accessToken(): string | null { return this.token(); }
  pendingMfaToken(): string | null { return this.mfaToken; }
  has(permission: string): boolean { return !!this.me()?.permissions.includes(permission); }

  /** Called once at start-up: restores the session from the refresh cookie, if any. */
  async restore(): Promise<void> {
    // Closed the tab or slept the PC for longer than the idle limit: end the session instead of resuming it.
    if (idleLimitMs > 0 && this.idleFor() > idleLimitMs) { try { await firstValueFrom(this.http.post('/api/auth/sign-out', {})); } catch { /* already gone */ } this.touch(0); return; }
    await this.refresh();
  }

  /** Idle sign-out: 5 minutes without a click, key, scroll or touch (any open tab counts as activity). */
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastTouch = 0;
  private readonly onActivity = (): void => {
    const now = Date.now();
    if (now - this.lastTouch > 5000) { this.lastTouch = now; this.touch(now); }
  };
  private touch(at: number): void { try { localStorage.setItem(IDLE_KEY, String(at || Date.now())); } catch { /* storage blocked */ } }
  private idleFor(): number {
    try { const v = Number(localStorage.getItem(IDLE_KEY)); return v ? Date.now() - v : 0; } catch { return 0; }
  }
  private startIdleWatch(): void {
    if (this.idleTimer) return;
    this.touch(Date.now());
    for (const e of IDLE_EVENTS) window.addEventListener(e, this.onActivity, { passive: true, capture: true });
    this.idleTimer = setInterval(() => {
      if (this.signedIn() && idleLimitMs > 0 && this.idleFor() > idleLimitMs) void this.idleSignOut();
    }, 10000);
  }
  private stopIdleWatch(): void {
    if (!this.idleTimer) return;
    clearInterval(this.idleTimer); this.idleTimer = null;
    for (const e of IDLE_EVENTS) window.removeEventListener(e, this.onActivity, { capture: true });
  }
  private async idleSignOut(): Promise<void> {
    try { await firstValueFrom(this.http.post('/api/auth/sign-out', {})); } catch { /* already gone */ }
    this.clear();
    await this.router.navigate([`/${this.i18n.locale()}/login`], { queryParams: { reason: 'idle' } });
  }

  refresh(): Promise<boolean> {
    this.refreshing ??= firstValueFrom(this.http.post<SessionResponse>('/api/auth/refresh', {}))
      .then(async (s) => { await this.accept(s); return true; })
      .catch(() => { this.clear(); return false; })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async signIn(identifier: string, password: string, captchaToken?: string): Promise<SessionResponse> {
    const s = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/sign-in', { identifier, password, captchaToken }));
    await this.accept(s);
    return s;
  }

  async verifyMfa(code: string): Promise<SessionResponse> {
    const s = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/mfa', { code }));
    await this.accept(s);
    return s;
  }

  async verifySigninCode(email: string, code: string): Promise<SessionResponse> {
    const s = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/signin-code/verify', { email, code }));
    await this.accept(s);
    return s;
  }

  async signOut(): Promise<void> {
    try { await firstValueFrom(this.http.post('/api/auth/sign-out', {})); } catch { /* already gone */ }
    this.clear();
    await this.router.navigateByUrl(`/${this.i18n.locale()}/login`);
  }

  async loadMe(): Promise<void> {
    const me = await firstValueFrom(this.http.get<Me>('/api/me'));
    idleLimitMs = (me.idleTimeoutMinutes ?? 5) * 60 * 1000;
    this.me.set(me);
  }

  /** Where a person lands after signing in (same rule as homeFor() today). */
  homePath(): string {
    const l = this.i18n.locale();
    return this.isStaff() ? `/${l}/console/dashboard` : `/${l}`;   // customers land on Home, as in v1
  }

  private async accept(s: SessionResponse): Promise<void> {
    if (s.mfaRequired) {
      this.mfaToken = s.mfaToken;
      this.token.set(null);
      return;
    }
    this.mfaToken = null;
    this.token.set(s.accessToken);
    await this.loadMe();
    this.startIdleWatch();
  }

  clear(): void {
    this.stopIdleWatch();
    this.token.set(null);
    this.mfaToken = null;
    this.me.set(null);
  }
}

/** Adds the bearer token; on 401 refreshes once and retries; sends people to sign-in when that fails. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const i18n = inject(I18n);
  const isAuthCall = req.url.startsWith('/api/auth/');
  const withToken = (r: HttpRequest<unknown>) => {
    const token = r.url === '/api/auth/mfa' ? auth.pendingMfaToken() : auth.accessToken();
    return token ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : r;
  };
  const sent = withToken(req.clone({ withCredentials: req.url.startsWith('/api/auth/') }));
  return next(sent).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || isAuthCall) return throwError(() => err);
      const code = (err.error as { code?: string } | null)?.code;
      if (err.status === 401 && code !== 'mfaRequired') {
        return from(auth.refresh()).pipe(switchMap((ok) => {
          if (ok) return next(withToken(req));
          void router.navigate([`/${i18n.locale()}/login`], { queryParams: { next: router.url } });
          return throwError(() => err);
        }));
      }
      if (err.status === 403 && (code === 'suspended' || code === 'pendingApproval')) {
        auth.clear();
        void router.navigate([`/${i18n.locale()}/login`], { queryParams: { reason: code === 'suspended' ? 'suspended' : 'pending_approval' } });
      }
      if (err.status === 401 && code === 'mfaRequired') void router.navigate([`/${i18n.locale()}/mfa`]);
      return throwError(() => err);
    }),
  );
};

/** Route guard: signed in, and (optionally) holding one of the roles. */
export function requireRole(roles?: string[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(Auth);
    const router = inject(Router);
    const i18n = inject(I18n);
    const me = auth.me();
    if (!me) return router.createUrlTree([`/${i18n.locale()}/login`], { queryParams: { next: state.url } });
    if (roles && !roles.some((r) => me.roles.includes(r))) return router.createUrlTree([auth.homePath()]);
    return true;
  };
}

export const STAFF_ROLES = ['agent', 'team_leader', 'admin', 'management_viewer'];
