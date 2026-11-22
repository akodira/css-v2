import { ChangeDetectionStrategy, Component, Directive, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../../core/auth';
import { adminError } from '../../core/admin-api';
import { TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { API, EXTRAS_DEFAULTS, MfaCounts, SecBase, SystemData, readValues } from './security-pages';

/** Settings → Security extras: password history, longest sign-in and devices, required two-step, sign-in alerts, report. */

const MSG = `@if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }`;
const CHECK = 'flex min-h-11 items-start gap-3';
const DANGER_BADGE = 'rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger';

/** A form of Security extras keys, saved through the same system settings call as the rest. */
@Directive()
abstract class ExtrasForm extends SecBase implements OnInit {
  protected readonly loaded = signal(false);
  protected n: Record<string, number> = {};
  protected b: Record<string, boolean> = {};
  async ngOnInit(): Promise<void> {
    const d = await this.get<SystemData>('system');
    ({ n: this.n, b: this.b } = readValues(d.settings, EXTRAS_DEFAULTS.n, EXTRAS_DEFAULTS.b));
    await this.more();
    this.loaded.set(true);
  }
  protected async more(): Promise<void> { /* extra data for the page */ }
  protected async saveKeys(keys: string[]): Promise<boolean> {
    this.busy.set(true); this.msg.set(null);
    const settings = Object.fromEntries(keys.map((k) => [k, k in this.b ? this.b[k] : Number(this.n[k])]));
    try {
      await firstValueFrom(this.http.put(API + 'system', { settings }));
      this.msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') });
      return true;
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); return false; }
    finally { this.busy.set(false); }
  }
}

// ================================================================== a confirmation with an optional required reason

@Component({
  selector: 'app-sec-confirm',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    <dialog #dlg class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/40" aria-labelledby="sc-title" (close)="open.set(false)">
      @if (open()) {
        <form class="flex flex-col gap-4 p-5" novalidate (ngSubmit)="ok()">
          <h2 id="sc-title" class="text-lg font-bold">{{ title() }}</h2>
          <p class="text-sm">{{ text() }}</p>
          @if (needReason()) {
            <div class="flex flex-col gap-1.5"><label for="sc-reason" class="text-sm font-semibold">{{ 'AdminSecurity.reason' | t }}<app-req /></label>
              <textarea id="sc-reason" name="reason" rows="3" maxlength="300" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base"
                [attr.aria-invalid]="bad() ? true : null" aria-describedby="sc-reason-hint" [(ngModel)]="reason"></textarea>
              <p id="sc-reason-hint" class="text-xs" [class]="bad() ? 'font-semibold text-danger' : 'text-muted'">{{ (bad() ? 'AdminCommon.errors.unlockReason' : 'AdminSecurity.reasonHint') | t }}</p></div>
          }
          @if (error()) { <app-alert tone="error">{{ error() }}</app-alert> }
          <div class="flex flex-wrap items-center justify-end gap-3">
            @if (needReason()) { <app-req-note /> }
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg" (click)="close()">{{ 'AdminSecurity.cancel' | t }}</button>
            <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-danger px-5 font-semibold text-white disabled:opacity-60" [disabled]="busy()">{{ button() }}</button>
          </div>
        </form>
      }
    </dialog>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SecConfirm {
  readonly needReason = input(true);
  readonly confirmed = output<string>();
  protected readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly open = signal(false);
  protected readonly title = signal('');
  protected readonly text = signal('');
  protected readonly button = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  protected readonly bad = signal(false);
  protected reason = '';
  show(title: string, text: string, button: string): void {
    this.title.set(title); this.text.set(text); this.button.set(button);
    this.reason = ''; this.bad.set(false); this.error.set(''); this.open.set(true);
    this.dlg().nativeElement.showModal();
  }
  close(): void { this.dlg().nativeElement.close(); }
  protected ok(): void {
    const r = this.reason.trim();
    if (this.needReason() && r.length < 5) { this.bad.set(true); document.getElementById('sc-reason')?.focus(); return; }
    this.confirmed.emit(r);
  }
}

/** Runs an action from a confirmation: busy while it runs, closes on success, shows the error inside on failure. */
async function confirmRun(dlg: SecConfirm, i18n: SecBase['i18n'], work: () => Promise<unknown>): Promise<boolean> {
  dlg.busy.set(true); dlg.error.set('');
  try { await work(); dlg.close(); return true; }
  catch (e) { dlg.error.set(adminError(i18n, e)); return false; }
  finally { dlg.busy.set(false); }
}

// ================================================================== password history (under Password policy)

@Component({
  selector: 'app-sec-pw-history',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    ${MSG}
    @if (loaded()) {
      <form [class]="cls.card + ' flex flex-col gap-3 p-5'" (ngSubmit)="submit()">
        <h3 class="text-lg font-bold">{{ 'AdminSecurity.histTitle' | t }}</h3>
        <label class="${CHECK}"><input type="checkbox" name="h-on" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['password_history_enabled']" />
          <span><span class="font-semibold">{{ 'AdminSecurity.histOn' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.histOnHint' | t }}</span></span></label>
        <div class="flex flex-col gap-1.5"><label for="h-count" [class]="cls.label">{{ 'AdminSecurity.histCount' | t }}<app-req /></label>
          <div class="flex items-center gap-2"><input id="h-count" name="h-count" type="number" min="1" max="24" dir="ltr" [class]="cls.input + ' max-w-32'" [(ngModel)]="n['password_history_count']" [disabled]="!b['password_history_enabled']" />
            <span class="text-sm text-muted">{{ 'AdminSecurity.unitPasswords' | t }}</span></div>
          <p class="text-xs text-muted">{{ 'AdminSecurity.histCountHint' | t }}</p></div>
        <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>
      </form>
    }`,
  host: { class: 'flex flex-col gap-4' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class PasswordHistoryForm extends ExtrasForm {
  protected submit(): void { void this.saveKeys(['password_history_enabled', 'password_history_count']); }
}

// ================================================================== sessions: longest sign-in and devices

interface SessionRow { id: string; userId: string; name: string; email: string; device: string; ip: string; startedAt: string; lastUsed: string }

@Component({
  selector: 'app-sec-sessions',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote, SecConfirm],
  template: `
    ${MSG}
    @if (loaded()) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
        <div><h3 class="text-lg font-bold">{{ 'AdminSecurity.maxTitle' | t }}</h3><p class="text-sm text-muted">{{ 'AdminSecurity.maxHint' | t }}</p></div>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5"><label for="mx-staff" [class]="cls.label">{{ 'AdminSecurity.maxStaff' | t }}<app-req /></label>
            <div class="flex items-center gap-2"><input id="mx-staff" name="mx-staff" type="number" min="1" max="720" dir="ltr" [class]="cls.input + ' max-w-32'" [(ngModel)]="n['session_max_hours_staff']" />
              <span class="text-sm text-muted">{{ 'AdminSecurity.unitHours' | t }}</span></div>
            <p class="text-xs text-muted">{{ 'AdminSecurity.maxStaffHint' | t }}</p></div>
          <div class="flex flex-col gap-1.5"><label for="mx-cust" [class]="cls.label">{{ 'AdminSecurity.maxCustomers' | t }}<app-req /></label>
            <div class="flex items-center gap-2"><input id="mx-cust" name="mx-cust" type="number" min="1" max="90" dir="ltr" [class]="cls.input + ' max-w-32'" [(ngModel)]="n['session_max_days_customers']" />
              <span class="text-sm text-muted">{{ 'AdminSecurity.unitDays' | t }}</span></div>
            <p class="text-xs text-muted">{{ 'AdminSecurity.maxCustomersHint' | t }}</p></div>
        </div>
        <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>
      </form>

      <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="sn-title">
        <div><h3 id="sn-title" class="text-lg font-bold">{{ 'AdminSecurity.nowTitle' | t }}</h3><p class="text-sm text-muted">{{ 'AdminSecurity.nowHint' | t }}</p></div>
        <div class="flex max-w-md flex-col gap-1.5"><label for="sn-q" [class]="cls.label">{{ 'AdminSecurity.search' | t }}</label>
          <input id="sn-q" type="search" autocomplete="off" [class]="cls.input" [placeholder]="'AdminSecurity.searchPh2' | t" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-bg text-xs uppercase tracking-wide text-muted"><tr>
              <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colPerson' | t }}</th>
              <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colDevice' | t }}</th>
              <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colSince' | t }}</th>
              <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colLastUsed' | t }}</th>
              @if (isAdmin()) { <th scope="col" class="px-3 py-2.5"><span class="sr-only">{{ 'AdminSecurity.actions' | t }}</span></th> }
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-t border-line align-top">
                  <td class="px-3 py-3"><span class="block font-semibold" dir="auto">{{ r.name }}</span><span class="block text-muted" dir="ltr">{{ r.email }}</span></td>
                  <td class="px-3 py-3"><span class="block">{{ r.device }}</span>@if (r.ip) { <span class="block text-muted" dir="ltr">{{ r.ip }}</span> }</td>
                  <td class="px-3 py-3">{{ i18n.shortDate(r.startedAt) }}</td>
                  <td class="px-3 py-3">{{ i18n.shortDate(r.lastUsed) }}</td>
                  @if (isAdmin()) {
                    <td class="px-3 py-3 text-end"><div class="flex flex-wrap justify-end gap-2">
                      <button type="button" [class]="cls.btn2 + ' whitespace-nowrap'" (click)="askOne(r)">{{ 'AdminSecurity.signOutDevice' | t }}</button>
                      <button type="button" [class]="cls.danger + ' whitespace-nowrap'" (click)="askAll(r)">{{ 'AdminSecurity.signOutAll' | t }}</button></div></td>
                  }
                </tr>
              } @empty { <tr><td [attr.colspan]="isAdmin() ? 5 : 4" class="px-3 py-8 text-center text-muted">{{ (list().length ? 'AdminSecurity.noMatch' : 'AdminSecurity.noSessions') | t }}</td></tr> }
            </tbody>
          </table>
        </div>
        <p class="text-sm text-muted">{{ 'AdminSecurity.nowNote' | t }}</p>
      </section>
      <app-sec-confirm #cf (confirmed)="run($event)" />
    }`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class SessionsPage extends ExtrasForm {
  private readonly auth = inject(Auth);
  protected readonly isAdmin = computed(() => !!this.auth.me()?.admin);
  protected readonly list = signal<SessionRow[]>([]);
  protected readonly q = signal('');
  protected readonly rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.list().filter((r) => !q || [r.name, r.email, r.device].some((x) => x?.toLowerCase().includes(q)));
  });
  protected readonly cf = viewChild<SecConfirm>('cf');
  private pending: { kind: 'one' | 'all'; r: SessionRow } | null = null;
  protected override async more(): Promise<void> { this.list.set(await this.get<SessionRow[]>('security/sessions')); }
  protected submit(): void { void this.saveKeys(['session_max_hours_staff', 'session_max_days_customers']); }
  protected askOne(r: SessionRow): void {
    this.pending = { kind: 'one', r };
    this.cf()?.show(this.i18n.t('AdminSecurity.oneTitle'), this.i18n.t('AdminSecurity.oneText', { name: r.name, device: r.device }), this.i18n.t('AdminSecurity.signOutDevice'));
  }
  protected askAll(r: SessionRow): void {
    this.pending = { kind: 'all', r };
    this.cf()?.show(this.i18n.t('AdminSecurity.allTitle'), this.i18n.t('AdminSecurity.allText', { name: r.name }), this.i18n.t('AdminSecurity.signOutAll'));
  }
  protected async run(reason: string): Promise<void> {
    const p = this.pending, dlg = this.cf(); if (!p || !dlg) return;
    const url = p.kind === 'one' ? `security/sessions/${p.r.id}/end` : `security/sign-out/${p.r.userId}`;
    if (await confirmRun(dlg, this.i18n, () => firstValueFrom(this.http.post(API + url, { reason })))) {
      this.msg.set({ tone: 'success', text: this.i18n.t(p.kind === 'one' ? 'AdminSecurity.oneDone' : 'AdminSecurity.allDone', { name: p.r.name }) });
      await this.more();
    }
  }
}

// ================================================================== two-step verification: who must use it

interface MfaPerson { id: string; name: string; email: string; group: string; role: string; on: boolean; deadline: string | null; blocked: boolean }

@Component({
  selector: 'app-sec-mfa',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote, SecConfirm],
  template: `
    ${MSG}
    @if (loaded()) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
        <div><h3 class="text-lg font-bold">{{ 'AdminSecurity.mfaReqTitle' | t }}</h3><p class="text-sm text-muted">{{ 'AdminSecurity.mfaReqHint' | t }}</p></div>
        @for (g of groups; track g) {
          <label class="${CHECK} rounded-xl border border-line p-3"><input type="checkbox" [name]="'mr-' + g" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['mfa_required_' + g]" />
            <span class="flex-1"><span class="font-semibold">{{ 'AdminSecurity.mfaReq_' + g | t }}</span>
              <span class="block text-sm text-muted">{{ 'AdminSecurity.mfaSetUpCount' | t: { on: $any(counts())[g].on, total: $any(counts())[g].total } }}
                @if (g === 'customers') { · {{ 'AdminSecurity.mfaCustNote' | t }} }</span></span></label>
        }
        <div class="flex flex-col gap-1.5"><label for="mf-days" [class]="cls.label">{{ 'AdminSecurity.mfaDays' | t }}<app-req /></label>
          <div class="flex items-center gap-2"><input id="mf-days" name="mf-days" type="number" min="0" max="90" dir="ltr" [class]="cls.input + ' max-w-32'" [(ngModel)]="n['mfa_setup_days']" />
            <span class="text-sm text-muted">{{ 'AdminSecurity.unitDays' | t }}</span></div>
          <p class="text-xs text-muted">{{ 'AdminSecurity.mfaDaysHint' | t }}</p></div>
        <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>
      </form>

      <section [class]="cls.card + ' flex flex-col gap-3 p-5'" aria-labelledby="mf-who">
        <h3 id="mf-who" class="text-lg font-bold">{{ 'AdminSecurity.mfaWho' | t }}</h3>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead class="bg-bg text-xs uppercase tracking-wide text-muted"><tr>
            <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colName' | t }}</th>
            <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colRole' | t }}</th>
            <th scope="col" class="px-3 py-2.5 text-start font-semibold">{{ 'AdminSecurity.colMfa' | t }}</th>
            @if (isAdmin()) { <th scope="col" class="px-3 py-2.5"><span class="sr-only">{{ 'AdminSecurity.actions' | t }}</span></th> }
          </tr></thead>
          <tbody>
            @for (p of people(); track p.id) {
              <tr class="border-t border-line">
                <td class="px-3 py-3"><span class="block font-semibold" dir="auto">{{ p.name }}</span><span class="block text-muted" dir="ltr">{{ p.email }}</span></td>
                <td class="px-3 py-3">{{ 'Roles.' + p.role | t }}</td>
                <td class="px-3 py-3">
                  @if (p.on) { <span [class]="cls.badgeOn">{{ 'AdminSecurity.on' | t }}</span> }
                  @else if (p.blocked) { <span class="${DANGER_BADGE}">{{ 'AdminSecurity.mfaStopped' | t }}</span> }
                  @else if (p.deadline) { <span [class]="cls.badgeWarn">{{ 'AdminSecurity.mfaDaysLeft' | t: { n: daysLeft(p.deadline) } }}</span> }
                  @else { <span [class]="cls.badgeOff">{{ 'AdminSecurity.off' | t }}</span> }
                </td>
                @if (isAdmin()) {
                  <td class="px-3 py-3 text-end">@if (p.on) { <button type="button" [class]="cls.btn2" (click)="askReset(p)">{{ 'AdminSecurity.mfaReset' | t }}</button> }</td>
                }
              </tr>
            } @empty { <tr><td colspan="4" class="px-3 py-8 text-center text-muted">{{ 'AdminSecurity.noStaff' | t }}</td></tr> }
          </tbody>
        </table></div>
      </section>
      <app-sec-confirm #cf [needReason]="false" (confirmed)="reset()" />
    }`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class MfaPolicyPage extends ExtrasForm {
  private readonly auth = inject(Auth);
  protected readonly isAdmin = computed(() => !!this.auth.me()?.admin);
  protected readonly groups = ['admins', 'staff', 'customers'] as const;
  protected readonly counts = signal<MfaCounts | null>(null);
  protected readonly people = signal<MfaPerson[]>([]);
  protected readonly cf = viewChild<SecConfirm>('cf');
  private target: MfaPerson | null = null;
  protected override async more(): Promise<void> {
    const d = await this.get<{ counts: MfaCounts; people: MfaPerson[] }>('security/mfa');
    this.counts.set(d.counts); this.people.set(d.people);
  }
  protected daysLeft(iso: string): number { return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)); }
  protected async submit(): Promise<void> {
    if (await this.saveKeys(['mfa_required_admins', 'mfa_required_staff', 'mfa_required_customers', 'mfa_setup_days'])) await this.more();
  }
  protected askReset(p: MfaPerson): void {
    this.target = p;
    this.cf()?.show(this.i18n.t('AdminSecurity.mfaResetTitle'), this.i18n.t('AdminSecurity.mfaResetText', { name: p.name }), this.i18n.t('AdminSecurity.mfaReset'));
  }
  protected async reset(): Promise<void> {
    const p = this.target, dlg = this.cf(); if (!p || !dlg) return;
    if (await confirmRun(dlg, this.i18n, () => firstValueFrom(this.http.post(`/api/admin/users/${p.id}/reset-mfa`, {})))) {
      this.msg.set({ tone: 'success', text: this.i18n.t('AdminSecurity.mfaResetDone', { name: p.name }) });
      await this.more();
    }
  }
}

// ================================================================== new sign-in alerts

@Component({
  selector: 'app-sec-alerts',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote, RouterLink],
  template: `
    ${MSG}
    @if (loaded()) {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="submit()">
        <label class="${CHECK}"><input type="checkbox" name="al-on" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['signin_alerts_enabled']" />
          <span><span class="font-semibold">{{ 'AdminSecurity.alOn' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.alOnHint' | t }}</span></span></label>
        <label class="${CHECK}"><input type="checkbox" name="al-adm" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="b['signin_alerts_admins']" />
          <span><span class="font-semibold">{{ 'AdminSecurity.alAdmins' | t }}</span><span class="block text-sm text-muted">{{ 'AdminSecurity.alAdminsHint' | t }}</span></span></label>
        <div class="flex flex-col gap-1.5"><label for="al-days" [class]="cls.label">{{ 'AdminSecurity.alKnown' | t }}<app-req /></label>
          <div class="flex items-center gap-2"><input id="al-days" name="al-days" type="number" min="7" max="365" dir="ltr" [class]="cls.input + ' max-w-32'" [(ngModel)]="n['signin_known_days']" />
            <span class="text-sm text-muted">{{ 'AdminSecurity.unitDays' | t }}</span></div>
          <p class="text-xs text-muted">{{ 'AdminSecurity.alKnownHint' | t }}</p></div>
        <p class="text-sm text-muted">{{ 'AdminSecurity.alAlways' | t }}
          <a [routerLink]="'/' + i18n.locale() + '/admin/general/settings/templates'" class="font-semibold text-brand-ink underline">{{ 'AdminSecurity.alTemplates' | t }}</a></p>
        <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>
      </form>
    }`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class AlertsPage extends ExtrasForm {
  protected submit(): void { void this.saveKeys(['signin_alerts_enabled', 'signin_alerts_admins', 'signin_known_days']); }
}

// ================================================================== security report

interface Report {
  days: number; failed: number; locks: number; newDevices: number; adminUnlocks: number;
  perDay: { day: string; failed: number; locks: number }[]; accounts: { name: string; count: number }[]; addresses: { name: string; count: number }[];
}

@Component({
  selector: 'app-sec-report',
  imports: [TPipe, Alert],
  template: `
    ${MSG}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div role="group" [attr.aria-label]="'AdminSecurity.period' | t" class="inline-flex overflow-hidden rounded-lg border border-line">
        @for (d of periods; track d) {
          <button type="button" class="min-h-11 border-s border-line px-4 text-sm font-semibold first:border-s-0" [attr.aria-pressed]="days() === d"
            [class]="days() === d ? 'bg-brand text-white' : 'bg-surface hover:bg-bg'" (click)="load(d)">{{ 'AdminSecurity.lastDays' | t: { n: d } }}</button>
        }
      </div>
      <button type="button" [class]="cls.btn2" [disabled]="busy() || !r()" (click)="download()">{{ 'AdminSecurity.download' | t }}</button>
    </div>
    @if (r(); as r) {
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        @for (k of kpis; track k[0]) {
          <li [class]="cls.card + ' p-4'"><span class="block text-sm text-muted">{{ 'AdminSecurity.' + k[1] | t }}</span><span class="text-3xl font-bold">{{ $any(r)[k[0]] }}</span></li>
        }
      </ul>
      <section [class]="cls.card + ' flex flex-col gap-3 p-5'" aria-labelledby="rp-day">
        <h3 id="rp-day" class="text-lg font-bold">{{ 'AdminSecurity.perDay' | t }}</h3>
        <div class="flex h-48 items-end gap-1 overflow-x-auto" dir="ltr" role="img" [attr.aria-label]="'AdminSecurity.perDayAlt' | t: { f: r.failed, l: r.locks }">
          @for (d of r.perDay; track d.day) {
            <div class="flex h-full min-w-2 flex-1 flex-col justify-end gap-0.5" [title]="d.day + ': ' + d.failed + ' / ' + d.locks">
              <div class="rounded-t bg-brand" [style.height.%]="pct(d.failed)"></div>
              @if (d.locks) { <div class="rounded-t bg-danger" [style.height.%]="pct(d.locks)"></div> }
            </div>
          }
        </div>
        <div class="flex justify-between text-xs text-muted" dir="ltr"><span>{{ i18n.day(r.perDay[0]?.day) }}</span><span>{{ i18n.day(r.perDay[r.perDay.length - 1]?.day) }}</span></div>
        <p class="flex flex-wrap gap-4 text-sm"><span class="flex items-center gap-1.5"><span aria-hidden="true" class="inline-block size-3 rounded-sm bg-brand"></span>{{ 'AdminSecurity.kFailedShort' | t }}</span>
          <span class="flex items-center gap-1.5"><span aria-hidden="true" class="inline-block size-3 rounded-sm bg-danger"></span>{{ 'AdminSecurity.kLocksShort' | t }}</span></p>
      </section>
      <div class="grid gap-4 md:grid-cols-2">
        @for (part of [['accounts', 'topAccounts'], ['addresses', 'topAddresses']]; track part[0]) {
          <section [class]="cls.card + ' flex flex-col gap-2 p-5'">
            <h3 class="text-lg font-bold">{{ 'AdminSecurity.' + part[1] | t }}</h3>
            <ol class="flex flex-col divide-y divide-line text-sm">
              @for (x of $any(r)[part[0]]; track x.name) {
                <li class="flex justify-between gap-3 py-2"><span dir="ltr" class="break-all">{{ x.name.startsWith('(no account)') ? ('AdminSecurity.noAccount' | t) + x.name.slice(12) : x.name }}</span><b>{{ x.count }}</b></li>
              } @empty { <li class="py-2 text-muted">{{ 'AdminSecurity.nothing' | t }}</li> }
            </ol>
          </section>
        }
      </div>
      <p class="text-sm text-muted">{{ 'AdminSecurity.reportNote' | t }}</p>
    }`,
  host: { class: 'flex flex-col gap-5' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class ReportPage extends SecBase implements OnInit {
  protected readonly periods = [7, 30, 90];
  protected readonly kpis = [['failed', 'kFailed'], ['locks', 'kLocksN'], ['newDevices', 'kNewDevices'], ['adminUnlocks', 'kAdminUnlocks']] as const;
  protected readonly days = signal(7);
  protected readonly r = signal<Report | null>(null);
  private max = 1;
  async ngOnInit(): Promise<void> { await this.load(7); }
  protected async load(d: number): Promise<void> {
    this.days.set(d);
    const r = await this.get<Report>('security/report?days=' + d);
    this.max = Math.max(1, ...r.perDay.map((x) => x.failed + x.locks));
    this.r.set(r);
  }
  protected pct(v: number): number { return (v / this.max) * 100; }
  protected async download(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try {
      const blob = await firstValueFrom(this.http.get(API + `security/report.xlsx?days=${this.days()}&lang=${this.i18n.locale()}`, { responseType: 'blob' }));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `security-report-${this.days()}d.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
}
