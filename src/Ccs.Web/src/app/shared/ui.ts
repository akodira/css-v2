import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, model, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, LOCALES, TPipe } from '../core/i18n';
import { Router } from '@angular/router';
import { SiteService } from '../core/api';

/** Red asterisk after a mandatory label; the "* Required" legend appears by itself (styles.css). */
@Component({
  selector: 'app-req',
  imports: [TPipe],
  template: `<span data-req class="ms-0.5 font-bold text-danger"><span aria-hidden="true">*</span><span class="sr-only"> ({{ 'Required.mark' | t }})</span></span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Req {}

@Component({
  selector: 'app-req-note',
  imports: [TPipe],
  template: `<span class="req-note text-sm text-muted"><span aria-hidden="true" class="font-bold text-danger">*</span> {{ 'Required.note' | t }}</span>`,
})
export class ReqNote {}

/** Centered auth card (Card in ui.tsx). */
@Component({
  selector: 'app-card',
  template: `
    <section class="mx-auto w-full max-w-md rounded-md border border-line bg-surface p-6 sm:p-8">
      <h1 class="text-2xl font-bold tracking-tight">{{ heading() }}</h1>
      @if (subtitle()) { <p class="mt-2 text-sm leading-relaxed text-muted">{{ subtitle() }}</p> }
      <div class="mt-6 flex flex-col gap-4"><ng-content /></div>
    </section>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Card {
  readonly heading = input.required<string>();
  readonly subtitle = input<string>();
}

@Component({
  selector: 'app-alert',
  template: `<div [attr.role]="tone() === 'error' ? 'alert' : 'status'" class="rounded-lg px-4 py-3 text-sm font-medium"
    [class]="tone() === 'error' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-ink'"><ng-content /></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Alert {
  readonly tone = input<'error' | 'success'>('error');
}

let fieldSeq = 0;

/** Text input with label, hint and error (TextField in ui.tsx). Error is an Auth.errors key. */
@Component({
  selector: 'app-text-field',
  imports: [Req, TPipe],
  template: `
    <div class="flex flex-col gap-1.5">
      <label [for]="id" class="text-sm font-semibold">{{ label() }}@if (required()) {<app-req />}</label>
      <div class="relative">
        <input [id]="id" [name]="name()" [type]="type() === 'password' && shown() ? 'text' : type()" [attr.autocomplete]="autocomplete()" [attr.dir]="type() === 'password' ? 'ltr' : dir()"
          [attr.maxlength]="maxLength()" [required]="required()" [value]="value()" (input)="value.set($any($event.target).value)"
          [attr.aria-invalid]="error() ? true : null" [attr.aria-describedby]="error() ? id + '-err' : hint() ? id + '-hint' : null"
          class="min-h-11 w-full rounded-lg border border-line bg-surface ps-3 text-base read-only:bg-bg read-only:text-muted aria-[invalid=true]:border-danger" [class]="type() === 'password' ? 'pe-12' : 'pe-3'" />
        @if (type() === 'password') {
          <!-- v1 PasswordInput: eye button that shows or hides the text -->
          <button type="button" (click)="shown.set(!shown())" [attr.aria-pressed]="shown()" [attr.aria-label]="(shown() ? 'Auth.password.hide' : 'Auth.password.show') | t"
            class="absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-lg text-ink hover:text-brand">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />@if (shown()) { <path d="M3 3l18 18" /> }
            </svg>
          </button>
        }
      </div>
      @if (hint() && !error()) { <p [id]="id + '-hint'" class="text-sm text-muted">{{ hint() }}</p> }
      @if (error()) { <p [id]="id + '-err'" class="text-sm font-medium text-danger">{{ 'Auth.errors.' + error() | t }}</p> }
    </div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TextField {
  readonly id = `f${++fieldSeq}`;
  readonly name = input.required<string>();
  readonly label = input.required<string>();
  readonly type = input('text');
  readonly autocomplete = input<string>();
  readonly dir = input<'ltr' | 'rtl'>();
  readonly maxLength = input<number>();
  readonly required = input(false);
  readonly hint = input<string>();
  readonly error = input<string | undefined>();
  readonly value = model('');
  protected readonly shown = signal(false);
}

/** Primary submit button, min 44 px, with the "* Required" legend after it. */
@Component({
  selector: 'app-submit',
  imports: [ReqNote],
  template: `
    <button type="submit" [disabled]="pending()" [attr.aria-busy]="pending()"
      class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 text-base font-semibold text-white hover:bg-brand-ink disabled:cursor-wait disabled:opacity-60">
      <ng-content />
    </button>
    <app-req-note />`,
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Submit {
  readonly pending = input(false);
}

/** CTS mark: a headset inside a ring. */
@Component({
  selector: 'app-logo',
  template: `
    <span class="flex items-center gap-2.5">
      @if (logoUrl()) {
        <img [src]="logoUrl()" alt="" width="40" height="40" class="h-10 w-10 object-contain" />
      } @else {
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="21" stroke="#1f64e6" stroke-width="4" />
          <path d="M14 26v-3a10 10 0 0 1 20 0v3" stroke="#1f64e6" stroke-width="3.5" stroke-linecap="round" />
          <rect x="11" y="25" width="6" height="9" rx="3" fill="#1f64e6" />
          <rect x="31" y="25" width="6" height="9" rx="3" fill="#1f64e6" />
          <path d="M34 34c0 3-3 5-8 5" stroke="#1f64e6" stroke-width="3" stroke-linecap="round" />
        </svg>
      }
      <span class="flex min-w-0 flex-col leading-none">
        <span class="whitespace-nowrap font-extrabold" [class]="dark() ? 'text-lg tracking-normal text-white' : 'text-xl tracking-wide text-brand'">{{ name() }}</span>
        @if (sub()) { <span class="mt-1 whitespace-nowrap text-[0.7rem] font-medium" [class]="dark() ? 'text-white/70' : 'text-brand-ink'">{{ sub() }}</span> }
      </span>
    </span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  readonly name = input.required<string>();
  readonly sub = input('');
  readonly dark = input(false);
  readonly logoUrl = input<string | null>(null);
}

/** EN | العربية switch that keeps the current page. */
@Component({
  selector: 'app-language-switcher',
  imports: [RouterLink, TPipe],
  template: `
    <nav [attr.aria-label]="'Home.languageLabel' | t" class="flex overflow-hidden rounded-lg border" [class]="tone() === 'dark' ? 'border-white/30' : 'border-line bg-surface'">
      @for (code of locales; track code) {
        <a [routerLink]="pathFor(code)" [queryParams]="query()" [attr.lang]="code" [attr.hreflang]="code" [attr.aria-current]="code === i18n.locale() ? 'true' : null"
          class="flex min-h-10 items-center px-3 text-sm font-semibold"
          [class]="code === i18n.locale() ? (tone() === 'dark' ? 'bg-white text-chrome' : 'bg-brand-soft text-brand-ink') : (tone() === 'dark' ? 'text-white hover:bg-white/10' : 'text-muted hover:bg-bg')">{{ 'Language.' + code | t }}</a>
      }
    </nav>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class LanguageSwitcher {
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  readonly tone = input<'light' | 'dark'>('light');
  protected readonly locales = LOCALES;
  pathFor(code: string): string {
    const path = this.router.url.split('?')[0].split('#')[0];
    return '/' + code + path.replace(/^\/(en|ar)(?=\/|$)/, '');
  }
  query() { return this.router.parseUrl(this.router.url).queryParams; }
}

/** Status badge with the customer-facing masking (pending_internal shows as "in progress"). */
@Component({
  selector: 'app-status-badge',
  template: `<span class="inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold" [class]="tone()">{{ label() }}</span>`,
})
export class StatusBadge {
  private readonly i18n = inject(I18n);
  readonly status = input.required<string>();
  readonly staff = input(false);
  protected readonly key = computed(() => (!this.staff() && this.status() === 'pending_internal' ? 'in_progress' : this.status()));
  protected readonly label = computed(() => this.staff() && this.i18n.has('StaffStatus.' + this.status()) ? this.i18n.t('StaffStatus.' + this.status()) : this.i18n.t('CustomerStatus.' + this.key()));
  protected readonly tone = computed(() => TONE_CLASS[(this.i18n.t(`StatusInfo.${this.key()}_tone`) as Tone)] ?? TONE_CLASS.brand);
}

export type Tone = 'brand' | 'warn' | 'ok' | 'danger' | 'muted';
export const TONE_CLASS: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  warn: 'bg-warn-soft text-warn-ink',
  ok: 'bg-ok-soft text-ok',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-bg text-muted border border-line',
};

/** Priority chip colours (PRIORITY_TONE today). */
export const PRIORITY_TONE: Record<string, string> = {
  red: 'bg-danger-soft text-danger', amber: 'bg-warn-soft text-warn-ink', blue: 'bg-brand-soft text-brand-ink',
  green: 'bg-ok-soft text-ok', grey: 'bg-bg text-ink border border-line', light: 'bg-surface text-muted border border-line',
};

/** Coloured edge on each staff-table row, by status (spec 7). */
export const STATUS_STRIPE: Record<string, string> = {
  pending_customer: 'border-s-4 border-s-danger', resolved: 'border-s-4 border-s-ok', closed: 'border-s-4 border-s-slate-400',
  new: 'border-s-4 border-s-brand', open: 'border-s-4 border-s-brand', in_progress: 'border-s-4 border-s-amber-500',
  pending_internal: 'border-s-4 border-s-amber-500', reopened: 'border-s-4 border-s-violet-500',
};

/** Sortable column header: click to sort, click again to flip (SortTh). */
@Component({
  selector: 'th[app-sort-th]',
  template: `
    <button type="button" (click)="toggle()" class="flex min-h-11 w-full cursor-pointer items-center gap-1.5 px-4 text-start font-semibold hover:underline"
      [attr.aria-label]="label()">
      {{ label() }}
      <svg aria-hidden="true" width="12" height="14" viewBox="0 0 12 14" fill="currentColor" [class.opacity-40]="!active()">
        <path d="M6 1 10 6H2z" [attr.opacity]="active() && desc() ? 0.3 : 1" />
        <path d="M6 13 2 8h8z" [attr.opacity]="active() && !desc() ? 0.3 : 1" />
      </svg>
    </button>`,
  host: { '[attr.aria-sort]': "active() ? (desc() ? 'descending' : 'ascending') : 'none'", scope: 'col', class: 'p-0' },
})
export class SortTh {
  readonly label = input.required<string>();
  readonly key = input.required<string>();
  readonly sort = model.required<string>();
  readonly desc = model.required<boolean>();
  protected readonly active = computed(() => this.sort() === this.key());
  toggle(): void {
    if (this.active()) this.desc.set(!this.desc());
    else { this.sort.set(this.key()); this.desc.set(this.key() === 'updated' || this.key() === 'created'); }
  }
}

/** Live SLA countdown chip, same rules as the current clock: green above half the time left, yellow below half, red below a fifth. */
export type ClockKind = 'green' | 'yellow' | 'red' | 'overdue' | 'paused' | 'met' | 'late';
export interface ClockInput { dueAt: string; startAt: string; pausedTotalSeconds?: number | null; pausedAt?: string | null; doneAt?: string | null }
export function computeClock(c: ClockInput, now: number): { kind: ClockKind; remainingMs: number } {
  const due = Date.parse(c.dueAt), start = Date.parse(c.startAt);
  const total = Math.max(1, due - start - (c.pausedTotalSeconds ?? 0) * 1000);
  if (c.doneAt) { const done = Date.parse(c.doneAt); return { kind: done <= due ? 'met' : 'late', remainingMs: due - done }; }
  const at = c.pausedAt ? Date.parse(c.pausedAt) : now;
  const remainingMs = due - at, left = Math.max(0, Math.min(1, remainingMs / total));
  if (c.pausedAt) return { kind: 'paused', remainingMs };
  if (remainingMs <= 0) return { kind: 'overdue', remainingMs };
  return { kind: left < 0.2 ? 'red' : left < 0.5 ? 'yellow' : 'green', remainingMs };
}
export function formatDuration(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `00:${pad(m)}:${pad(s % 60)}`;
}
const CHIP: Record<ClockKind, string> = {
  green: 'bg-brand-soft text-brand-ink', yellow: 'bg-warn-soft text-warn-ink', red: 'bg-danger-soft text-danger',
  overdue: 'bg-danger-soft text-danger', paused: 'bg-bg text-muted border border-line', met: 'bg-brand-soft text-brand-ink', late: 'bg-danger-soft text-danger',
};

@Component({
  selector: 'app-sla-chip',
  template: `<span class="inline-flex w-fit items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold tabular-nums" [class]="cls()">{{ text() }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlaChip {
  private readonly i18n = inject(I18n);
  readonly clock = input.required<ClockInput>();
  private readonly v = computed(() => computeClock(this.clock(), Date.now()));
  protected readonly cls = computed(() => CHIP[this.v().kind]);
  protected readonly text = computed(() => {
    const v = this.v(), time = formatDuration(v.remainingMs);
    return v.kind === 'paused' ? this.i18n.t('SlaClock.paused') : v.kind === 'met' ? this.i18n.t('SlaClock.met') : v.kind === 'late' ? this.i18n.t('SlaClock.late')
      : v.kind === 'overdue' ? this.i18n.t('SlaClock.overdueBy', { time }) : this.i18n.t('SlaClock.chip_' + v.kind, { time });
  });
}

const BAR: Record<ClockKind, string> = { green: 'bg-emerald-600', yellow: 'bg-amber-500', red: 'bg-red-600', overdue: 'bg-red-600', paused: 'bg-slate-400', met: 'bg-emerald-600', late: 'bg-red-600' };
const BIG: Record<ClockKind, string> = { green: 'text-brand-ink', yellow: 'text-warn-ink', red: 'text-danger', overdue: 'text-danger', paused: 'text-muted', met: 'text-brand-ink', late: 'text-danger' };

/** Big live SLA timer at the top of the staff ticket page (v1 SlaClockCard): label, state, countdown, due text and a bar. */
@Component({
  selector: 'app-sla-clock-card',
  template: `
    <section class="flex flex-col gap-2 rounded-md border border-line bg-surface p-5" [attr.aria-label]="label()">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-sm font-bold">{{ label() }}</h2>
        <span class="rounded-full px-3 py-0.5 text-xs font-bold" [class]="chip()">{{ state() }}</span>
      </div>
      <p class="text-3xl font-bold tabular-nums" [class]="big()" dir="ltr">{{ main() }}</p>
      <p class="text-sm text-muted">{{ sub() }}</p>
      <div class="h-2 overflow-hidden rounded-full bg-line" role="presentation"><div class="h-full rounded-full" [class]="bar()" [style.width.%]="width()"></div></div>
    </section>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SlaClockCard {
  private readonly i18n = inject(I18n);
  readonly clock = input.required<ClockInput>();
  readonly label = input.required<string>();
  readonly dueText = input.required<string>();
  private readonly now = signal(Date.now());
  private readonly _tick = (() => { const h = setInterval(() => this.now.set(Date.now()), 1000); inject(DestroyRef).onDestroy(() => clearInterval(h)); })();
  private readonly v = computed(() => {
    const c = this.clock(), v = computeClock(c, this.now());
    const due = Date.parse(c.dueAt), total = Math.max(1, due - Date.parse(c.startAt) - (c.pausedTotalSeconds ?? 0) * 1000);
    return { ...v, share: Math.max(0, Math.min(1, v.remainingMs / total)) };
  });
  protected readonly chip = computed(() => CHIP[this.v().kind]);
  protected readonly big = computed(() => BIG[this.v().kind]);
  protected readonly bar = computed(() => BAR[this.v().kind]);
  protected readonly state = computed(() => this.i18n.t('SlaClock.state_' + this.v().kind));
  protected readonly width = computed(() => { const k = this.v().kind; return k === 'overdue' || k === 'late' || k === 'met' ? 100 : Math.round(this.v().share * 100); });
  protected readonly main = computed(() => {
    const v = this.v(), time = formatDuration(v.remainingMs);
    return v.kind === 'paused' ? this.i18n.t('SlaClock.paused') : v.kind === 'met' ? this.i18n.t('SlaClock.met') : v.kind === 'late' ? this.i18n.t('SlaClock.late')
      : v.kind === 'overdue' ? this.i18n.t('SlaClock.overdueBy', { time }) : time;
  });
  protected readonly sub = computed(() => {
    const v = this.v();
    return v.kind === 'paused' ? this.i18n.t('SlaClock.pausedWith', { time: formatDuration(v.remainingMs) })
      : v.kind === 'overdue' || v.kind === 'met' || v.kind === 'late' ? this.dueText() : `${this.i18n.t('SlaClock.left')}, ${this.dueText()}`;
  });
}

export const PRIORITY_STRIPE: Record<string, string> = {
  red: 'border-s-4 border-s-danger', amber: 'border-s-4 border-s-warn', blue: 'border-s-4 border-s-brand', green: 'border-s-4 border-s-ok', grey: '', light: '',
};


/** New password + confirmation with strength bar, rule checklist and live match message (v1 NewPasswordFields). */
@Component({
  selector: 'app-new-password',
  imports: [TextField, TPipe],
  template: `
    <app-text-field [name]="name()" type="password" [label]="label() || ('Auth.fields.password' | t)" autocomplete="new-password" [required]="true" [(value)]="value" [error]="error()" />
    <div class="-mt-2 flex flex-col gap-2">
      <div class="grid grid-cols-4 gap-2" aria-hidden="true">
        @for (n of [1, 2, 3, 4]; track n) { <span class="h-1.5 rounded-full" [class]="level() >= n ? bar[level()] : 'bg-line'"></span> }
      </div>
      <p class="text-sm font-semibold">{{ 'Auth.password.strength' | t }}: <span>{{ 'Auth.password.levels.' + level() | t }}</span></p>
      <ul class="flex flex-col gap-0.5 text-sm">
        @for (r of rules(); track r) {
          <li class="flex items-center gap-2" [class]="!value() ? 'text-muted' : checks()[r] ? 'text-brand-ink' : 'text-danger'">
            <span aria-hidden="true" class="w-4 text-center font-bold">{{ !value() ? '•' : checks()[r] ? '✓' : '✕' }}</span>
            <span>{{ 'Auth.password.rules.' + r | t: { min: policy().minLength } }}<span class="sr-only">: {{ (checks()[r] ? 'Auth.password.met' : 'Auth.password.notMet') | t }}</span></span>
          </li>
        }
      </ul>
      <p class="sr-only" role="status" aria-live="polite">{{ value() ? ('Auth.password.summary' | t: { level: ('Auth.password.levels.' + level() | t), met: met(), total: rules().length }) : '' }}</p>
    </div>
    <app-text-field name="confirmPassword" type="password" [label]="'Auth.fields.confirmPassword' | t" autocomplete="new-password" [required]="true" [(value)]="confirm" [error]="confirmError()" />
    @if (confirm() && confirm() !== value()) { <p role="alert" class="-mt-2 text-sm font-medium text-danger">{{ 'Auth.password.noMatch' | t }}</p> }
    @if (confirm() && confirm() === value()) { <p role="status" class="-mt-2 text-sm font-medium text-brand-ink">{{ 'Auth.password.match' | t }}</p> }`,
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewPasswordFields {
  private readonly site = inject(SiteService);
  readonly name = input('password');
  readonly label = input<string>('');
  readonly value = model('');
  readonly confirm = model('');
  readonly error = input<string | undefined>();
  readonly confirmError = input<string | undefined>();
  protected readonly bar = ['bg-line', 'bg-danger', 'bg-[#d97706]', 'bg-[#ca9a04]', 'bg-brand'];
  protected readonly policy = computed(() => {
    const p = this.site.info()?.passwordPolicy;
    return { minLength: p?.minLength ?? 10, upper: p?.requireUpper ?? true, lower: p?.requireLower ?? true, number: p?.requireNumber ?? true, special: p?.requireSpecial ?? true };
  });
  protected readonly rules = computed(() => (['length', 'upper', 'lower', 'number', 'special'] as const).filter((r) => r === 'length' || this.policy()[r]));
  protected readonly checks = computed<Record<string, boolean>>(() => {
    const pw = this.value();
    return { length: pw.length >= this.policy().minLength, upper: /\p{Lu}/u.test(pw), lower: /\p{Ll}/u.test(pw), number: /\p{N}/u.test(pw), special: /[^\p{L}\p{N}\s]/u.test(pw) };
  });
  protected readonly met = computed(() => this.rules().filter((r) => this.checks()[r]).length);
  protected readonly level = computed(() => { if (!this.value()) return 0; const m = this.met(); return m === this.rules().length ? 4 : Math.max(1, Math.min(3, m - 1)); });
  /** True when every rule is met and both fields match. */
  ok(): boolean { return this.met() === this.rules().length && this.value() === this.confirm(); }
}
