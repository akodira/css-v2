import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, OnInit, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { feedbackFor } from '../../shared/feedback';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { CLS, Msg } from './admin-pages';

/** Settings → Security pages that are new (lockout policy, locked accounts, overview). The moved parts stay in settings-pages.ts. */

export const API = '/api/admin/settings/';
const MSG = `@if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }`;
const CHECK = 'flex min-h-11 items-start gap-3';

export interface LockedCounts { locked: number; failing: number; unlocked: number; locks7: number }
export interface LockedRow {
  id: string; name: string; email: string | null; phone: string | null; failed: number; lockedAt: string | null; until: string | null;
  adminOnly: boolean; lastFailed: string | null; status: 'locked' | 'active' | 'unlocked';
  unlock: { action: string; at: string | null; by: string | null; reason: string | null } | null;
}
export interface SystemData { settings: Record<string, string>; registrationMode: string; captcha: { enabled: boolean } }
interface CodesData { enabled: boolean; customersMode: string; staffMode: string; adminsMode: string }

/** Settings → Security extras with the defaults the server uses when nothing is saved. */
export const EXTRAS_DEFAULTS = {
  n: { password_history_count: 5, session_max_hours_staff: 12, session_max_days_customers: 14, mfa_setup_days: 7, signin_known_days: 90 } as Record<string, number>,
  b: { password_history_enabled: true, mfa_required_admins: false, mfa_required_staff: false, mfa_required_customers: false, signin_alerts_enabled: true, signin_alerts_admins: true } as Record<string, boolean>,
};
export interface MfaCounts { admins: { total: number; on: number }; staff: { total: number; on: number }; customers: { total: number; on: number } }

export const LOCKOUT_DEFAULTS = {
  n: { lockout_max_attempts: 5, lockout_window_minutes: 15, lockout_duration_minutes: 30, lockout_reset_minutes: 15 } as Record<string, number>,
  b: { lockout_enabled: true, lockout_auto_unlock: true, lockout_notify_user: true, lockout_notify_admins: true } as Record<string, boolean>,
};

/** Reads the saved values (JSON strings) with the defaults for anything not saved yet. */
export function readValues(s: Record<string, string>, n: Record<string, number>, b: Record<string, boolean>) {
  const nn: Record<string, number> = {}, bb: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(n)) nn[k] = s[k] !== undefined ? Number(JSON.parse(s[k])) : v;
  for (const [k, v] of Object.entries(b)) bb[k] = s[k] !== undefined ? JSON.parse(s[k]) === true : v;
  return { n: nn, b: bb };
}

export abstract class SecBase {
  protected readonly i18n = inject(I18n);
  protected readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  protected readonly msg = signal<Msg>(null);
  protected readonly msgNearButton = feedbackFor(this.msg);
  protected readonly busy = signal(false);
  private readonly cdr = inject(ChangeDetectorRef);
  protected async get<T>(p: string): Promise<T> { const r = await firstValueFrom(this.http.get<T>(API + p)); this.cdr.markForCheck(); return r; }
}

// ================================================================== account lockout policy

@Component({
  selector: 'app-sec-lockout',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    @if (loaded()) {
      <form class="flex flex-col gap-6" (ngSubmit)="submit()">
        <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
          <label class="flex items-start justify-between gap-3"><span><span class="font-semibold">{{ 'AdminSecurity.lkEnable' | t }}</span>
            <span class="ms-2" [class]="b['lockout_enabled'] ? cls.badgeOn : cls.badgeOff">{{ (b['lockout_enabled'] ? 'AdminSecurity.on' : 'AdminSecurity.off') | t }}</span>
            <span class="block text-sm text-muted">{{ 'AdminSecurity.lkEnableHint' | t }}</span></span>
            <input type="checkbox" role="switch" name="lk-on" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['lockout_enabled']" /></label>
        </section>

        <section [class]="cls.card + ' flex flex-col gap-4 p-5'" [class.opacity-60]="!b['lockout_enabled']">
          <div><h2 class="text-lg font-bold">{{ 'AdminSecurity.lkRules' | t }}</h2><p class="text-sm text-muted">{{ 'AdminSecurity.lkRulesHint' | t }}</p></div>
          <div class="grid gap-4 md:grid-cols-2">
            @for (f of fields; track f.key) {
              <div class="flex flex-col gap-1.5"><label [for]="f.key" [class]="cls.label">{{ 'AdminSecurity.' + f.label | t }}<app-req /></label>
                <div class="flex items-center gap-2"><input [id]="f.key" [name]="f.key" type="number" dir="ltr" [min]="f.min" [max]="f.max" [class]="cls.input + ' max-w-32'" [(ngModel)]="n[f.key]" />
                  <span class="text-sm text-muted">{{ 'AdminSecurity.' + f.unit | t }}</span></div>
                <p class="text-xs text-muted">{{ 'AdminSecurity.' + f.label + 'Hint' | t }}</p></div>
            }
          </div>
          <label class="${CHECK}"><input type="checkbox" name="lk-auto" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['lockout_auto_unlock']" />
            <span><span class="font-semibold">{{ 'AdminSecurity.lkAuto' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.lkAutoHint' | t }}</span></span></label>
          <p role="status" class="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-ink"><b>{{ 'AdminSecurity.inShort' | t }}</b> {{ summary() }}</p>
        </section>

        <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
          <div><h2 class="text-lg font-bold">{{ 'AdminSecurity.lkNotify' | t }}</h2><p class="text-sm text-muted">{{ 'AdminSecurity.lkNotifyHint' | t }}</p></div>
          <label class="${CHECK}"><input type="checkbox" name="lk-user" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['lockout_notify_user']" />
            <span><span class="font-semibold">{{ 'AdminSecurity.lkNotifyUser' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.lkNotifyUserHint' | t }}</span></span></label>
          <label class="${CHECK}"><input type="checkbox" name="lk-admins" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['lockout_notify_admins']" />
            <span><span class="font-semibold">{{ 'AdminSecurity.lkNotifyAdmins' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.lkNotifyAdminsHint' | t }}</span></span></label>
        </section>
        <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminSecurity.lkSave' | t }}</button><app-req-note /></div>
      </form>
    }`,
  host: { class: 'flex flex-col gap-6' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class LockoutPolicyPage extends SecBase implements OnInit {
  protected readonly fields = [
    { key: 'lockout_max_attempts', label: 'lkMax', unit: 'unitAttempts', min: 3, max: 20 },
    { key: 'lockout_window_minutes', label: 'lkWindow', unit: 'unitMinutes', min: 1, max: 1440 },
    { key: 'lockout_duration_minutes', label: 'lkDuration', unit: 'unitMinutes', min: 1, max: 1440 },
    { key: 'lockout_reset_minutes', label: 'lkReset', unit: 'unitMinutes', min: 1, max: 1440 },
  ];
  protected readonly loaded = signal(false);
  protected n: Record<string, number> = {};
  protected b: Record<string, boolean> = {};

  async ngOnInit(): Promise<void> {
    const d = await this.get<SystemData>('system');
    ({ n: this.n, b: this.b } = readValues(d.settings, LOCKOUT_DEFAULTS.n, LOCKOUT_DEFAULTS.b));
    this.loaded.set(true);
  }

  /** "5 failed attempts within 15 minutes lock the account for 30 minutes. …" from the values on screen. */
  protected summary(): string { return lockoutSummary(this.i18n, this.n, this.b); }

  protected async submit(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    const settings: Record<string, unknown> = { ...this.b };
    for (const f of this.fields) settings[f.key] = Number(this.n[f.key]);
    try {
      await firstValueFrom(this.http.put(API + 'system', { settings }));
      this.msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') });
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
}

export function lockoutSummary(i18n: I18n, n: Record<string, number>, b: Record<string, boolean>): string {
  if (!b['lockout_enabled']) return i18n.t('AdminSecurity.sumOff');
  const p = { max: n['lockout_max_attempts'], window: n['lockout_window_minutes'], duration: n['lockout_duration_minutes'], reset: n['lockout_reset_minutes'] };
  return i18n.t(b['lockout_auto_unlock'] ? 'AdminSecurity.sumOn' : 'AdminSecurity.sumOnAdmin', p) + ' ' + i18n.t('AdminSecurity.sumReset', p);
}

// ================================================================== locked accounts

@Component({
  selector: 'app-sec-locked',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    @if (data(); as d) {
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        @for (k of kpis; track k[0]) {
          <li [class]="cls.card + ' p-4'"><span class="block text-sm text-muted">{{ 'AdminSecurity.' + k[1] | t }}</span>
            <span class="text-3xl font-bold" [class]="k[0] === 'locked' && d.counts.locked ? 'text-danger' : ''">{{ $any(d.counts)[k[0]] }}</span></li>
        }
      </ul>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-60 flex-1 flex-col gap-1.5"><label for="lk-q" [class]="cls.label">{{ 'AdminSecurity.search' | t }}</label>
          <input id="lk-q" type="search" [class]="cls.input" autocomplete="off" [placeholder]="'AdminSecurity.searchPh' | t" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
        <div class="flex flex-col gap-1.5"><label for="lk-s" [class]="cls.label">{{ 'AdminSecurity.status' | t }}</label>
          <select id="lk-s" [class]="cls.input + ' min-w-44'" [ngModel]="status()" (ngModelChange)="status.set($event)">
            <option value="">{{ 'AdminSecurity.allStatuses' | t }}</option>
            @for (s of statuses; track s) { <option [value]="s">{{ 'AdminSecurity.st_' + s | t }}</option> }
          </select></div>
      </div>
      <div [class]="cls.card + ' overflow-x-auto'">
        <table class="w-full text-sm">
          <thead class="bg-bg text-start text-xs uppercase tracking-wide text-muted"><tr>
            @for (h of heads; track h) { <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.' + h | t }}</th> }
            <th scope="col" class="px-3 py-2.5"><span class="sr-only">{{ 'AdminSecurity.actions' | t }}</span></th>
          </tr></thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr class="border-t border-line align-top">
                <td class="px-3 py-3 font-semibold" dir="auto">{{ r.name }}</td>
                <td class="px-3 py-3"><span class="block" dir="ltr">{{ r.email || '-' }}</span>@if (r.phone) { <span class="block text-muted" dir="ltr">{{ r.phone }}</span> }</td>
                <td class="px-3 py-3" dir="ltr">{{ r.failed }}</td>
                <td class="px-3 py-3">{{ r.status === 'unlocked' && !r.lockedAt ? '-' : i18n.shortDate(r.lockedAt) }}</td>
                <td class="px-3 py-3">
                  @if (r.status === 'locked') { {{ r.adminOnly ? ('AdminSecurity.adminOnly' | t) : i18n.shortDate(r.until) }} }
                  @else if (r.unlock) {
                    <span class="block">{{ i18n.shortDate(r.unlock.at) }}</span>
                    <span class="block text-xs text-muted">{{ ('AdminSecurity.by_' + r.unlock.action.replace('auth.', '')) | t: { name: r.unlock.by || '' } }}</span>
                    @if (r.unlock.reason) { <span class="block text-xs text-muted" dir="auto">“{{ r.unlock.reason }}”</span> }
                  } @else { - }
                </td>
                <td class="px-3 py-3"><span [class]="badge[r.status]">{{ 'AdminSecurity.st_' + r.status | t }}</span></td>
                <td class="px-3 py-3 text-end">
                  @if (r.status === 'locked') { <button type="button" [class]="cls.btn2 + ' whitespace-nowrap'" (click)="ask(r)">{{ 'AdminSecurity.unlock' | t }}</button> }
                  @else if (r.status === 'active') { <button type="button" [class]="cls.btn2 + ' whitespace-nowrap'" (click)="ask(r)">{{ 'AdminSecurity.clear' | t }}</button> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="px-3 py-8 text-center text-muted">{{ (d.accounts.length ? 'AdminSecurity.noMatch' : 'AdminSecurity.none') | t }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="text-sm text-muted">{{ 'AdminSecurity.lockedNote' | t }}</p>
    }

    <dialog #dlg class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/40" (close)="target.set(null)" aria-labelledby="unlock-title">
      @if (target(); as t) {
        <form class="flex flex-col gap-4 p-5" novalidate (ngSubmit)="unlock()">
          <h2 id="unlock-title" class="text-lg font-bold">{{ (t.status === 'locked' ? 'AdminSecurity.unlockTitle' : 'AdminSecurity.clearTitle') | t }}</h2>
          <p class="text-sm">{{ (t.status === 'locked' ? 'AdminSecurity.unlockText' : 'AdminSecurity.clearText') | t: { name: t.name } }}</p>
          <div class="flex flex-col gap-1.5"><label for="unlock-reason" [class]="cls.label">{{ 'AdminSecurity.reason' | t }}<app-req /></label>
            <textarea id="unlock-reason" name="reason" rows="3" maxlength="300" [class]="cls.input + ' py-2'" [attr.aria-invalid]="reasonError() ? true : null"
              [attr.aria-describedby]="'unlock-reason-hint'" [(ngModel)]="reason"></textarea>
            <p id="unlock-reason-hint" class="text-xs" [class]="reasonError() ? 'font-semibold text-danger' : 'text-muted'">{{ (reasonError() ? 'AdminCommon.errors.unlockReason' : 'AdminSecurity.reasonHint') | t }}</p></div>
          @if (dlgMsg()) { <app-alert tone="error">{{ dlgMsg() }}</app-alert> }
          <div class="flex flex-wrap items-center justify-end gap-3">
            <app-req-note />
            <button type="button" [class]="cls.btn2" (click)="close()">{{ 'AdminSecurity.cancel' | t }}</button>
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ (t.status === 'locked' ? 'AdminSecurity.unlockConfirm' : 'AdminSecurity.clearConfirm') | t }}</button>
          </div>
        </form>
      }
    </dialog>`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class LockedAccountsPage extends SecBase implements OnInit {
  readonly changed = output<LockedCounts>();
  protected readonly kpis = [['locked', 'kLocked'], ['failing', 'kFailing'], ['unlocked', 'kUnlocked'], ['locks7', 'kLocks7']] as const;
  protected readonly heads = ['colName', 'colContact', 'colFailed', 'colLockedAt', 'colUntil', 'colStatus'];
  protected readonly statuses = ['locked', 'active', 'unlocked'] as const;
  protected readonly badge: Record<string, string> = { locked: 'rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger', active: CLS.badgeWarn, unlocked: CLS.badgeOn };
  protected readonly data = signal<{ counts: LockedCounts; accounts: LockedRow[] } | null>(null);
  protected readonly q = signal('');
  protected readonly status = signal('');
  protected readonly rows = computed(() => {
    const d = this.data(); if (!d) return [];
    const q = this.q().trim().toLowerCase(), s = this.status();
    return d.accounts.filter((r) => (!s || r.status === s) && (!q || [r.name, r.email, r.phone].some((x) => x?.toLowerCase().includes(q))));
  });
  protected readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly target = signal<LockedRow | null>(null);
  protected readonly reasonError = signal(false);
  protected readonly dlgMsg = signal('');
  protected reason = '';

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    const d = await this.get<{ counts: LockedCounts; accounts: LockedRow[] }>('security/locked');
    this.data.set(d); this.changed.emit(d.counts);
  }
  protected close(): void { this.dlg().nativeElement.close(); }
  protected ask(r: LockedRow): void {
    this.target.set(r); this.reason = ''; this.reasonError.set(false); this.dlgMsg.set('');
    this.dlg().nativeElement.showModal();
  }
  protected async unlock(): Promise<void> {
    const t = this.target(); if (!t) return;
    const reason = this.reason.trim();
    if (reason.length < 5) { this.reasonError.set(true); document.getElementById('unlock-reason')?.focus(); return; }
    this.reasonError.set(false); this.busy.set(true); this.dlgMsg.set('');
    try {
      await firstValueFrom(this.http.post(API + 'security/unlock/' + t.id, { reason }));
      this.dlg().nativeElement.close();
      this.msg.set({ tone: 'success', text: this.i18n.t(t.status === 'locked' ? 'AdminSecurity.unlocked' : 'AdminSecurity.cleared', { name: t.name }) });
      await this.load();
    } catch (e) { this.dlgMsg.set(adminError(this.i18n, e)); }
    finally { this.busy.set(false); }
  }
}

// ================================================================== overview

@Component({
  selector: 'app-sec-overview',
  imports: [TPipe, RouterLink],
  template: `
    @if (boxes(); as list) {
      <ul class="grid gap-4 md:grid-cols-2">
        @for (x of list; track x.p) {
          <li><a [routerLink]="base()" [queryParams]="{ p: x.p }" [class]="cls.card + ' flex h-full flex-col gap-1.5 p-4 hover:border-brand'">
            <span class="flex items-center justify-between gap-2"><span class="font-bold">{{ 'AdminSecurity.nav_' + x.p | t }}</span>
              <span [class]="x.tone === 'ok' ? cls.badgeOn : x.tone === 'warn' ? cls.badgeWarn : x.tone === 'bad' ? 'rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger' : cls.badgeOff">{{ x.badge }}</span></span>
            <span class="text-sm text-muted">{{ x.text }}</span></a></li>
        }
      </ul>
      <p [class]="cls.card + ' p-4 text-sm'">{{ 'AdminSecurity.fixedNote' | t }}
        <a [routerLink]="'/' + i18n.locale() + '/admin/audit'" class="font-semibold text-brand-ink underline">{{ 'AdminSecurity.openAudit' | t }}</a></p>
    }`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SecurityOverview extends SecBase implements OnInit {
  protected readonly base = computed(() => '/' + this.i18n.locale() + '/admin/general/settings/security');
  protected readonly boxes = signal<{ p: string; text: string; badge: string; tone: 'ok' | 'warn' | 'bad' | 'off' }[] | null>(null);

  async ngOnInit(): Promise<void> {
    const [sys, codes, locked, mfa, rep] = await Promise.all([
      this.get<SystemData>('system'), this.get<CodesData>('signin-codes'), this.get<{ counts: LockedCounts }>('security/locked'),
      this.get<{ counts: MfaCounts }>('security/mfa'), this.get<{ failed: number; locks: number }>('security/report?days=7'),
    ]);
    const x = readValues(sys.settings, EXTRAS_DEFAULTS.n, EXTRAS_DEFAULTS.b);
    const t = (k: string, p?: Record<string, unknown>) => this.i18n.t('AdminSecurity.' + k, p);
    const s = sys.settings, num = (k: string, d: number) => (s[k] !== undefined ? Number(JSON.parse(s[k])) : d), on = (k: string, d: boolean) => (s[k] !== undefined ? JSON.parse(s[k]) === true : d);
    const lk = readValues(s, LOCKOUT_DEFAULTS.n, LOCKOUT_DEFAULTS.b);
    const need = [['password_require_upper', 'pwUpper'], ['password_require_lower', 'pwLower'], ['password_require_number', 'pwNumber'], ['password_require_special', 'pwSymbol']]
      .filter((x) => on(x[0], true)).map((x) => t(x[1]));
    const pwText = t('ovPw', { min: num('password_min_length', 10), need: need.join(this.i18n.locale() === 'ar' ? '، ' : ', ') || '-' }) + ' '
      + (x.b['password_history_enabled'] ? t('ovPwHistory', { n: x.n['password_history_count'] }) + ' ' : '')
      + (on('password_expiry_enabled', false) ? t('ovPwExpiry', { days: num('password_expiry_days', 90) }) : t('ovPwNoExpiry'));
    const req = (['admins', 'staff', 'customers'] as const).filter((g) => x.b['mfa_required_' + g]);
    const list = (a: string[]) => a.join(this.i18n.locale() === 'ar' ? '، ' : ', ');
    const groups = (['customers', 'staff', 'admins'] as const).filter((g) => (codes as unknown as Record<string, string>)[g + 'Mode'] !== 'off');
    const codesOn = codes.enabled && groups.length > 0;
    const c = locked.counts;
    this.boxes.set([
      { p: 'password', text: pwText, badge: t('on'), tone: 'ok' },
      { p: 'lockout', text: lockoutSummary(this.i18n, lk.n, lk.b), badge: t(lk.b['lockout_enabled'] ? 'on' : 'off'), tone: lk.b['lockout_enabled'] ? 'ok' : 'warn' },
      { p: 'locked', text: t('ovLocked', { n: c.locked, f: c.failing }), badge: String(c.locked), tone: c.locked ? 'bad' : 'ok' },
      { p: 'codes', text: codesOn ? t('ovCodesOn', { who: groups.map((g) => t('grp_' + g)).join(this.i18n.locale() === 'ar' ? '، ' : ', ') }) : t('ovCodesOff'), badge: t(codesOn ? 'on' : 'off'), tone: codesOn ? 'ok' : 'off' },
      { p: 'mfa', text: (req.length ? t('ovMfaReq', { who: list(req.map((g) => t('grp_' + g))) }) : t('ovMfaNone')) + ' '
          + t('ovMfaSetUp', { on: mfa.counts.staff.on + mfa.counts.admins.on, total: mfa.counts.staff.total + mfa.counts.admins.total }),
        badge: t(req.length ? 'on' : 'off'), tone: req.length ? 'ok' : 'warn' },
      { p: 'sessions', text: t('ovIdle', { min: num('idle_timeout_minutes', 5) }) + ' ' + t('ovMax', { h: x.n['session_max_hours_staff'], d: x.n['session_max_days_customers'] }), badge: t('on'), tone: 'ok' },
      { p: 'alerts', text: t(x.b['signin_alerts_enabled'] ? 'ovAlertsOn' : 'ovAlertsOff'), badge: t(x.b['signin_alerts_enabled'] ? 'on' : 'off'), tone: x.b['signin_alerts_enabled'] ? 'ok' : 'warn' },
      { p: 'signup', text: t('ovReg_' + sys.registrationMode), badge: t(sys.registrationMode === 'closed' ? 'off' : 'on'), tone: sys.registrationMode === 'closed' ? 'off' : 'ok' },
      { p: 'bots', text: t(sys.captcha.enabled ? 'ovCaptchaOn' : 'ovCaptchaOff'), badge: t(sys.captcha.enabled ? 'on' : 'off'),
        tone: sys.captcha.enabled ? 'ok' : sys.registrationMode === 'closed' ? 'off' : 'warn' },
      { p: 'report', text: t('ovReport', { f: rep.failed, l: rep.locks }), badge: String(rep.failed), tone: 'off' },
    ]);
  }
}
