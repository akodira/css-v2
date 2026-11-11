import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { I18n, TPipe } from '../core/i18n';
import { inject } from '@angular/core';

/** One placeholder that can be typed into an email template, with what it becomes (v1 lib/placeholders). */
export interface PlaceholderInfo { token: string; en: string; ar: string }

export const EMAIL_ALL_PLACEHOLDERS: PlaceholderInfo[] = [
  { token: 'name', en: 'Name of the person who receives the email.', ar: 'اسم الشخص الذي يستلم الرسالة.' },
  { token: 'reference', en: 'Ticket number, for example CTS-2026-000123.', ar: 'رقم التذكرة، مثل CTS-2026-000123.' },
  { token: 'subject', en: 'Subject line of the ticket.', ar: 'عنوان التذكرة.' },
  { token: 'reason', en: 'Why the alert was sent, for example an SLA warning or an escalation reason, or the rejection reason on a rejected account.', ar: 'سبب التنبيه، مثل تحذير اتفاقية الخدمة أو سبب التصعيد، أو سبب رفض الحساب.' },
  { token: 'code', en: 'The one-time verification or password reset code.', ar: 'رمز التحقق أو استعادة كلمة المرور لمرة واحدة.' },
  { token: 'minutes', en: 'How many minutes the code stays valid. Filled in automatically from the settings.', ar: 'عدد الدقائق التي يبقى الرمز صالحًا فيها. تُملأ تلقائيًا من الإعدادات.' },
  { token: 'days', en: 'Days left before the password expires.', ar: 'عدد الأيام المتبقية قبل انتهاء صلاحية كلمة المرور.' },
  { token: 'customer', en: 'Full name of the customer who registered or opened the ticket.', ar: 'الاسم الكامل للعميل الذي سجّل أو فتح التذكرة.' },
  { token: 'customerEmail', en: 'Email address of that customer.', ar: 'البريد الإلكتروني لذلك العميل.' },
  { token: 'siteName', en: 'Name of the system, from General settings.', ar: 'اسم النظام من الإعدادات العامة.' },
  { token: 'supportEmail', en: 'Contact email address, from General settings.', ar: 'بريد التواصل من الإعدادات العامة.' },
  { token: 'supportPhone', en: 'Contact phone number, from General settings.', ar: 'رقم هاتف التواصل من الإعدادات العامة.' },
  { token: 'supportHours', en: 'Support hours, from General settings.', ar: 'ساعات الدعم من الإعدادات العامة.' },
  { token: 'siteUrl', en: 'Web address of the system.', ar: 'عنوان موقع النظام.' },
];

export const GLOBAL_TOKENS = ['siteName', 'supportEmail', 'supportPhone', 'supportHours', 'siteUrl'];

/** What the values the system fills into its own messages mean; unknown names get a generic line (v1 describeVar). */
const VAR_DESC: Record<string, [string, string]> = {
  name: ['A name, filled in by the system.', 'اسم تملؤه المنظومة.'], reference: ['Ticket number, for example CTS-2026-000123.', 'رقم التذكرة، مثل CTS-2026-000123.'],
  subject: ['Subject line of the ticket.', 'عنوان التذكرة.'], reason: ['The reason given, for example for an alert or a rejection.', 'السبب المذكور، مثل سبب تنبيه أو رفض.'],
  n: ['A number, such as how many items match.', 'عدد، مثل عدد العناصر المطابقة.'], count: ['A number of items.', 'عدد العناصر.'], total: ['A total number.', 'إجمالي العدد.'],
  met: ['How many rules are met.', 'عدد القواعد المستوفاة.'], level: ['The strength level of a password.', 'مستوى قوة كلمة المرور.'], when: ['A date and time.', 'تاريخ ووقت.'],
  date: ['A date.', 'تاريخ.'], page: ['The current page number.', 'رقم الصفحة الحالية.'], pages: ['The number of pages.', 'عدد الصفحات.'], files: ['The number of files.', 'عدد الملفات.'],
  mb: ['A size in megabytes.', 'حجم بالميغابايت.'], max: ['The largest allowed number.', 'أكبر عدد مسموح.'], email: ['An email address.', 'عنوان بريد إلكتروني.'],
  customer: ['Full name of the customer.', 'الاسم الكامل للعميل.'], customerEmail: ['Email address of the customer.', 'البريد الإلكتروني للعميل.'], percent: ['A percentage.', 'نسبة مئوية.'],
  days: ['A number of days.', 'عدد الأيام.'], types: ['A list of allowed file types.', 'قائمة بأنواع الملفات المسموحة.'], zone: ['A time zone.', 'منطقة زمنية.'],
  customers: ['How many customers are linked.', 'عدد العملاء المرتبطين.'], branches: ['How many branches are linked.', 'عدد الفروع المرتبطة.'], password: ['A password rule or value.', 'قاعدة أو قيمة لكلمة المرور.'],
};
export function describeVar(token: string): PlaceholderInfo {
  const d = VAR_DESC[token] ?? ['Filled in automatically by the system.', 'تملؤه المنظومة تلقائيًا.'];
  return { token, en: d[0], ar: d[1] };
}

/** The placeholders that can be used here, each with what it becomes. Clicking one inserts it where the cursor is (v1 PlaceholderPicker). */
@Component({
  selector: 'app-placeholder-picker',
  imports: [TPipe],
  template: `
    <section aria-labelledby="ph-h" class="rounded-xl border border-line bg-surface p-4">
      <h3 id="ph-h" class="text-sm font-bold">{{ 'Placeholders.title' | t }}</h3>
      <p class="mt-1 text-sm text-muted">{{ 'Placeholders.hint' | t }}</p>
      @if (notice()) { <p role="status" class="mt-2 text-sm font-semibold text-warn-ink">{{ notice() }}</p> }
      <ul class="mt-3 grid gap-2 sm:grid-cols-2">
        @for (p of items(); track p.token) {
          <li>
            <button type="button" (mousedown)="$event.preventDefault()" (click)="insert.emit('{' + p.token + '}')"
              class="flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-line bg-bg px-3 py-2 text-start hover:border-brand">
              <code dir="ltr" class="text-sm font-bold text-brand-ink">{{ '{' + p.token + '}' }}</code>
              <span class="text-xs text-muted">{{ i18n.locale() === 'ar' ? p.ar : p.en }}</span>
            </button>
          </li>
        }
      </ul>
    </section>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPicker {
  protected readonly i18n = inject(I18n);
  readonly items = input<PlaceholderInfo[]>(EMAIL_ALL_PLACEHOLDERS);
  readonly notice = input<string | null>(null);
  readonly insert = output<string>();
}

/** Formatting buttons (bold, italic, list, link, anchor) for one text box (v1 FormatBar). Emits the new text. */
@Component({
  selector: 'app-format-bar',
  imports: [TPipe],
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-1" role="toolbar" [attr.aria-label]="'AdminSystemMessages.toolbar' | t">
        <button type="button" [class]="q + ' font-bold'" (mousedown)="$event.preventDefault()" (click)="wrap('**', '**', 'AdminSystemMessages.sampleBold')">{{ 'AdminSystemMessages.bold' | t }}</button>
        <button type="button" [class]="q + ' italic'" (mousedown)="$event.preventDefault()" (click)="wrap('*', '*', 'AdminSystemMessages.sampleItalic')">{{ 'AdminSystemMessages.italic' | t }}</button>
        <button type="button" [class]="q" (mousedown)="$event.preventDefault()" (click)="list()">{{ 'AdminSystemMessages.list' | t }}</button>
        <button type="button" [class]="q" (mousedown)="$event.preventDefault()" (click)="open('link')">{{ 'AdminSystemMessages.link' | t }}</button>
        @if (anchor()) { <button type="button" [class]="q" (mousedown)="$event.preventDefault()" (click)="open('anchor')">{{ 'AdminSystemMessages.anchor' | t }}</button> }
      </div>
      @if (panel()) {
        <div class="flex flex-col gap-2 rounded-lg border border-line bg-bg p-3">
          @if (panel() === 'link') {
            <input [value]="text()" (input)="text.set($any($event.target).value)" [placeholder]="'AdminSystemMessages.linkText' | t" [attr.aria-label]="'AdminSystemMessages.linkText' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" dir="auto" />
            <input [value]="target()" (input)="target.set($any($event.target).value)" placeholder="https://, /login, mailto:, tel:" [attr.aria-label]="'AdminSystemMessages.linkAddress' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" dir="ltr" />
          } @else {
            <input [value]="target()" (input)="target.set($any($event.target).value.replace(regex, ''))" [placeholder]="'AdminSystemMessages.anchorName' | t" [attr.aria-label]="'AdminSystemMessages.anchorName' | t" class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm" dir="ltr" />
          }
          <div class="flex gap-2">
            <button type="button" [class]="q" [disabled]="!target().trim()" (click)="apply()">{{ 'AdminSystemMessages.insert' | t }}</button>
            <button type="button" [class]="q" (click)="panel.set(null)">{{ 'AdminSystemMessages.cancel' | t }}</button>
          </div>
        </div>
      }
    </div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatBar {
  private readonly i18n = inject(I18n);
  readonly el = input.required<HTMLTextAreaElement>();
  readonly anchor = input(false);
  readonly changed = output<string>();
  protected readonly q = 'min-h-9 cursor-pointer rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40';
  protected readonly regex = /[^A-Za-z0-9_-]/g;
  protected readonly panel = signal<'link' | 'anchor' | null>(null);
  protected readonly text = signal('');
  protected readonly target = signal('');
  private sel: [number, number] = [0, 0];

  private put(str: string, s: number, e: number): void {
    const el = this.el(), v = el.value;
    const next = v.slice(0, s) + str + v.slice(e);
    el.value = next;
    this.changed.emit(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + str.length, s + str.length); });
  }
  protected wrap(before: string, after: string, sampleKey: string): void {
    const el = this.el(), s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    const inner = el.value.slice(s, e) || this.i18n.t(sampleKey);
    this.put(before + inner + after, s, e);
  }
  protected list(): void {
    const el = this.el(), s = el.selectionStart ?? el.value.length;
    const ls = el.value.lastIndexOf('\n', s - 1) + 1;
    this.put('- ', ls, ls);
  }
  protected open(mode: 'link' | 'anchor'): void {
    const el = this.el(), s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    this.sel = [s, e]; this.text.set(el.value.slice(s, e)); this.target.set(''); this.panel.set(mode);
  }
  protected apply(): void {
    const str = this.panel() === 'link' ? `[${this.text().replace(/[\]\n]/g, ' ') || this.target().trim()}](${this.target().trim()})` : `[#${this.target()}]`;
    this.put(str, this.sel[0], this.sel[1]);
    this.panel.set(null);
  }
}
