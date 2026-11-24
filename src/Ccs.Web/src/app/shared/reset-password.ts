import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SiteService } from '../core/api';
import { adminError, generatePassword } from '../core/admin-api';
import { I18n, TPipe } from '../core/i18n';
import { Alert } from './ui';

/**
 * "Reset password" button and its window: the admin lets the system make a strong password (with Copy) or types one.
 * After saving, the password stays on screen with a Copy button until Done.
 */
@Component({
  selector: 'app-reset-password',
  imports: [TPipe, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <button type="button" [class]="btnClass()" [disabled]="disabled()" (click)="open()">{{ 'AdminV2.resetPassword' | t }}</button>
    <dialog #dlg class="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
      [attr.aria-labelledby]="id + '-t'" (close)="reset()" (cancel)="reset()">
      <div class="flex flex-col gap-4 p-5">
        <div class="flex items-start justify-between gap-3">
          <div><h2 [id]="id + '-t'" class="text-lg font-bold">{{ 'ResetPw.title' | t: { name: name() } }}</h2>
            @if (!done()) { <p class="text-sm text-muted">{{ 'ResetPw.help' | t }}</p> }</div>
          <button type="button" class="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-bg hover:text-ink" [attr.aria-label]="'AdminCommon.cancel' | t" (click)="close()">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>

        @if (!done()) {
          <fieldset class="grid gap-2 sm:grid-cols-2"><legend class="sr-only">{{ 'ResetPw.how' | t }}</legend>
            @for (k of kinds; track k) {
              <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5" [class]="how() === k ? 'border-brand bg-brand-soft' : 'border-line'">
                <input type="radio" [name]="id + '-how'" class="mt-1 h-4 w-4" [checked]="how() === k" (change)="how.set(k)" />
                <span><span class="block font-semibold">{{ 'ResetPw.' + k | t }}</span><span class="block text-xs text-muted">{{ 'ResetPw.' + k + 'Help' | t }}</span></span>
              </label>
            }
          </fieldset>

          @if (how() === 'make') {
            <div class="flex flex-wrap items-center gap-2">
              <code class="min-h-11 flex-1 rounded-lg border border-dashed border-line bg-bg px-3 py-2.5 font-mono text-lg font-semibold tracking-wide" dir="ltr">{{ made() }}</code>
              <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-3 font-semibold hover:bg-bg" (click)="made.set(gen())">{{ 'ResetPw.another' | t }}</button>
              <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-3 font-semibold hover:bg-bg" (click)="copy(made())">{{ copied() ? ('ResetPw.copied' | t) : ('ResetPw.copy' | t) }}</button>
            </div>
          } @else {
            <div class="flex flex-col gap-1.5">
              <label [for]="id + '-own'" class="text-sm font-semibold">{{ 'ResetPw.newPassword' | t }}</label>
              <div class="relative">
                <input #own [id]="id + '-own'" [type]="shown() ? 'text' : 'password'" dir="ltr" autocomplete="new-password" [value]="typed()" (input)="typed.set(own.value)"
                  class="min-h-11 w-full rounded-lg border border-line bg-surface ps-3 pe-12 text-base" [attr.aria-describedby]="id + '-rules'" />
                <button type="button" (click)="shown.set(!shown())" [attr.aria-pressed]="shown()" [attr.aria-label]="(shown() ? 'Auth.password.hide' : 'Auth.password.show') | t"
                  class="absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-lg text-ink hover:text-brand">
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />@if (shown()) { <path d="M3 3l18 18" /> }</svg>
                </button>
              </div>
              <ul [id]="id + '-rules'" class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                @for (r of rules(); track r) {
                  <li [class]="checks()[r] ? 'text-ok' : 'text-muted'"><span aria-hidden="true">{{ checks()[r] ? '✓' : '○' }}</span> {{ 'Auth.password.rules.' + r | t: { min: policy().minLength } }}<span class="sr-only">: {{ (checks()[r] ? 'Auth.password.met' : 'Auth.password.notMet') | t }}</span></li>
                }
              </ul>
            </div>
          }
          @if (err()) { <app-alert>{{ err() }}</app-alert> }
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:cursor-wait disabled:opacity-60" [disabled]="busy()" (click)="set()">{{ 'ResetPw.set' | t }}</button>
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg" (click)="close()">{{ 'AdminCommon.cancel' | t }}</button>
          </div>
        } @else {
          <p role="status" class="rounded-lg bg-ok-soft px-3 py-2.5 text-sm font-medium text-ok">{{ 'ResetPw.done' | t: { name: name() } }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="min-h-11 flex-1 rounded-lg border border-dashed border-line bg-bg px-3 py-2.5 font-mono text-lg font-semibold tracking-wide" dir="ltr">{{ done() }}</code>
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-3 font-semibold hover:bg-bg" (click)="copy(done()!)">{{ copied() ? ('ResetPw.copied' | t) : ('ResetPw.copy' | t) }}</button>
          </div>
          <div><button type="button" class="min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink" (click)="close()">{{ 'ResetPw.finish' | t }}</button></div>
        }
      </div>
    </dialog>`,
})
export class ResetPassword {
  private readonly http = inject(HttpClient);
  private readonly site = inject(SiteService);
  private readonly i18n = inject(I18n);
  /** The person's id and name (shown in the title). */
  readonly userId = input.required<string>();
  readonly name = input('');
  readonly disabled = input(false);
  readonly btnClass = input('min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg disabled:opacity-60');
  protected readonly id = 'rp' + Math.random().toString(36).slice(2, 8);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly kinds = ['make', 'type'] as const;
  protected readonly how = signal<'make' | 'type'>('make');
  protected readonly made = signal('');
  protected readonly typed = signal('');
  protected readonly shown = signal(false);
  protected readonly busy = signal(false);
  protected readonly err = signal('');
  protected readonly copied = signal(false);
  /** The password that was set; shown until the window is closed. */
  protected readonly done = signal<string | null>(null);

  protected readonly policy = computed(() => {
    const p = this.site.info()?.passwordPolicy;
    return { minLength: p?.minLength ?? 10, upper: p?.requireUpper ?? true, lower: p?.requireLower ?? true, number: p?.requireNumber ?? true, special: p?.requireSpecial ?? true };
  });
  protected readonly rules = computed(() => (['length', 'upper', 'lower', 'number', 'special'] as const).filter((r) => r === 'length' || this.policy()[r]));
  protected readonly checks = computed<Record<string, boolean>>(() => {
    const pw = this.typed();
    return { length: pw.length >= this.policy().minLength, upper: /\p{Lu}/u.test(pw), lower: /\p{Ll}/u.test(pw), number: /\p{N}/u.test(pw), special: /[^\p{L}\p{N}\s]/u.test(pw) };
  });

  protected gen(): string {
    // A made password always meets the rules, even with a longer minimum length.
    let p = generatePassword();
    while (p.length < this.policy().minLength) p += generatePassword();
    return p;
  }
  protected open(): void { this.reset(); this.made.set(this.gen()); this.dlg().nativeElement.showModal(); }
  protected close(): void { this.dlg().nativeElement.close(); }
  protected reset(): void { this.how.set('make'); this.typed.set(''); this.shown.set(false); this.err.set(''); this.done.set(null); this.copied.set(false); }

  protected async copy(v: string): Promise<void> {
    try { await navigator.clipboard.writeText(v); this.copied.set(true); setTimeout(() => this.copied.set(false), 1600); } catch { /* the password stays on screen to copy by hand */ }
  }

  protected async set(): Promise<void> {
    const pw = this.how() === 'make' ? this.made() : this.typed();
    if (this.how() === 'type' && !this.rules().every((r) => this.checks()[r])) { this.err.set(this.i18n.t('ResetPw.rulesNotMet')); return; }
    this.busy.set(true); this.err.set('');
    try {
      await firstValueFrom(this.http.post(`/api/admin/users/${this.userId()}/password`, { password: pw }));
      this.done.set(pw); this.copied.set(false);
    } catch (e) { this.err.set(adminError(this.i18n, e)); }
    finally { this.busy.set(false); }
  }
}
