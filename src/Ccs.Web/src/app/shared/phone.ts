import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/** Digits only; "+20 1x…" / "0020 1x…" become the local "01x…" form. */
export function normPhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.startsWith('0020') && d.length >= 14) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = '0' + d.slice(2);
  return d;
}

/** What a person's phone box may hold: digits only, at most 11 (Egyptian mobile 01xxxxxxxxx). */
export const PHONE_MAX = 11;
export function phoneDigits(v: string | null | undefined): string {
  return normPhone(v ?? '').slice(0, PHONE_MAX);
}

/** On a plain <input> (ngModel): letters are dropped and typing stops at 11 digits. */
@Directive({ selector: 'input[appPhone]', host: { inputmode: 'numeric', type: 'tel' } })
export class PhoneInput {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  @HostListener('input') clean(): void {
    const v = phoneDigits(this.el.value);
    if (v === this.el.value) return;
    this.el.value = v;
    // Let ngModel read the cleaned value too.
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
