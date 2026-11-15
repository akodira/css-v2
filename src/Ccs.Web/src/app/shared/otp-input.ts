import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, viewChildren } from '@angular/core';
import { TPipe } from '../core/i18n';

let otpSeq = 0;

/**
 * Six separate boxes for a one-time code (sign-in code, two-step code, email confirmation, password reset).
 * Typing moves to the next box, Backspace goes back, pasting the whole code fills every box.
 * (complete) fires when the last digit is typed, so a page can submit by itself.
 */
@Component({
  selector: 'app-otp-input',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1.5">
      <span [id]="id + '-l'" class="text-sm font-semibold">{{ label() }}<span aria-hidden="true" class="font-bold text-danger"> *</span></span>
      <div role="group" [attr.aria-labelledby]="id + '-l'" [attr.aria-describedby]="error() ? id + '-e' : hint() ? id + '-h' : null" dir="ltr" class="flex justify-center gap-2 sm:gap-2.5">
        @for (i of boxes(); track i) {
          <input #box type="text" inputmode="numeric" maxlength="1" [attr.autocomplete]="i === 0 ? 'one-time-code' : 'off'" [attr.name]="name() + i"
            [attr.aria-label]="'Otp.digit' | t: { n: i + 1, total: length() }" [value]="value()[i] ?? ''"
            (input)="typed(i, $event)" (keydown)="key(i, $event)" (paste)="paste($event)" (focus)="$any($event.target).select()"
            [attr.aria-invalid]="error() ? true : null"
            class="h-14 w-11 rounded-lg border border-line bg-surface text-center text-xl font-bold text-ink focus:border-brand sm:w-12 aria-[invalid=true]:border-danger" />
        }
      </div>
      @if (hint() && !error()) { <p [id]="id + '-h'" class="text-center text-xs text-muted">{{ hint() }}</p> }
      @if (error()) { <p [id]="id + '-e'" class="text-center text-sm font-medium text-danger">{{ 'Auth.errors.' + error() | t }}</p> }
    </div>`,
})
export class OtpInput {
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly error = input<string | undefined>();
  readonly name = input('code');
  readonly length = input(6);
  readonly value = model('');
  readonly complete = output<string>();
  protected readonly id = 'otp' + ++otpSeq;
  protected readonly boxes = computed(() => Array.from({ length: this.length() }, (_, i) => i));
  private readonly inputs = viewChildren<ElementRef<HTMLInputElement>>('box');

  private set(chars: string[]): void {
    const v = chars.join('').replace(/\D/g, '').slice(0, this.length());
    this.value.set(v);
    if (v.length === this.length()) this.complete.emit(v);
  }
  protected typed(i: number, e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.value.replace(/\D/g, '');
    if (d.length > 1) { this.fill(d, i); return; }   // some phones put the whole code in one box
    const chars = this.value().padEnd(this.length(), ' ').split('');
    chars[i] = d || ' ';
    el.value = d;
    this.set(chars.map((c) => (c === ' ' ? '' : c)));
    if (d && i < this.length() - 1) this.focus(i + 1);
  }
  protected key(i: number, e: KeyboardEvent): void {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Backspace' && !el.value && i > 0) { e.preventDefault(); this.focus(i - 1); }
    else if (e.key === 'ArrowLeft' && i > 0) this.focus(i - 1);
    else if (e.key === 'ArrowRight' && i < this.length() - 1) this.focus(i + 1);
  }
  protected paste(e: ClipboardEvent): void {
    const d = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
    if (!d) return;
    e.preventDefault();
    this.fill(d, 0);
  }
  private fill(d: string, from: number): void {
    const chars = this.value().padEnd(this.length(), ' ').split('');
    for (let k = 0; k < d.length && from + k < this.length(); k++) chars[from + k] = d[k];
    this.set(chars.map((c) => (c === ' ' ? '' : c)));
    this.focus(Math.min(from + d.length, this.length() - 1));
  }
  private focus(i: number): void { queueMicrotask(() => this.inputs()[i]?.nativeElement.focus()); }
  /** Puts the cursor in the first box (used when the code step opens). */
  focusFirst(): void { this.focus(0); }
}
