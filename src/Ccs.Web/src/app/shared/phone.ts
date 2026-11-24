import { Directive, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';

/** The mobile number format from Settings → System (same rules as PhoneFormat on the server). */
export interface PhoneFmt { country: string; countryCode: string; length: number; starts: string[] }
export const PHONE_DEFAULT: PhoneFmt = { country: 'EG', countryCode: '+20', length: 11, starts: ['01'] };
/** Set by SiteService when /api/site loads; every phone box reads it. */
export const phoneFmt = signal<PhoneFmt>(PHONE_DEFAULT);

/** True when local numbers begin with a 0 that is dropped after the country code (Egypt 010… = +2010…). */
const trunkZero = (f: PhoneFmt) => f.starts.length > 0 && f.starts.every((s) => s.startsWith('0'));

/** Digits as typed locally: "+20 10…" / "0020 10…" / "2010…" become "010…", so a stored "+2010…" reads back as typed.
 *  Not cut to the length (phoneDigits does that), so a sign-in box can say how many were typed. */
export function phoneLocal(v: string | null | undefined, f: PhoneFmt = phoneFmt()): string {
  const raw = (v ?? '').trim();
  let d = raw.replace(/\D/g, '');
  const code = f.countryCode.replace(/\D/g, '');
  let intl = raw.startsWith('+');
  if (!intl && d.startsWith('00')) { d = d.slice(2); intl = true; }
  if (code && d.startsWith(code) && (intl || d.length > f.length)) {
    d = d.slice(code.length);
    // Put back the leading 0 dropped after the country code (Egypt +2010… = 010…; Lebanon +9613… = 03…).
    const own = f.starts.some((s) => d.startsWith(s));
    if (!d.startsWith('0') && (trunkZero(f) || (d.length === f.length - 1 && !own))) d = '0' + d;
  }
  return d;
}
export function phoneDigits(v: string | null | undefined, f: PhoneFmt = phoneFmt()): string { return phoneLocal(v, f).slice(0, f.length); }

/** Full number in the set format: right length and, when set, one of the starts. */
export function phoneOk(v: string, f: PhoneFmt = phoneFmt()): boolean {
  return /^\d+$/.test(v) && v.length === f.length && (!f.starts.length || f.starts.some((s) => v.startsWith(s)));
}

/** An example local number for hints, e.g. 01012345678. */
export function phoneExample(f: PhoneFmt = phoneFmt()): string {
  const s = f.starts[0] ?? '';
  return (s + '12345678901234').slice(0, f.length);
}

/** Values for the phone hint texts: {len} digits, e.g. {example}. */
export const phoneParams = computed(() => ({ len: phoneFmt().length, example: phoneExample() }));

/** On a plain <input> (ngModel): letters are dropped and typing stops at the set length. */
@Directive({ selector: 'input[appPhone]', host: { inputmode: 'numeric', type: 'tel' } })
export class PhoneInput implements OnInit {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  /** An example in the set format, e.g. 01012345678. */
  ngOnInit(): void { if (!this.el.placeholder) this.el.placeholder = phoneExample(); }
  @HostListener('input') clean(): void {
    const v = phoneDigits(this.el.value);
    if (v === this.el.value) return;
    this.el.value = v;
    // Let ngModel read the cleaned value too.
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
