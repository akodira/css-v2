import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SiteService } from '../../core/api';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { COUNTRIES, countryName } from '../../shared/countries';
import { PhoneFmt, phoneDigits, phoneExample, phoneOk } from '../../shared/phone';
import { CLS, Msg } from './admin-pages';

/** Settings → System → Phone numbers: the mobile number format every phone box follows (server: PhoneFormat). */
@Component({
  selector: 'app-phone-settings',
  imports: [FormsModule, TPipe, Alert, Req, ReqNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="save()">
      <div><h3 class="text-lg font-bold">{{ 'PhoneSettings.title' | t }}</h3><p class="text-sm text-muted">{{ 'PhoneSettings.help' | t }}</p></div>
      <div class="grid gap-4 md:grid-cols-[1.4fr_.8fr_.8fr_1fr]">
        <div class="flex flex-col gap-1.5">
          <label for="ph-country" [class]="cls.label">{{ 'PhoneSettings.country' | t }}</label>
          <input id="ph-search" name="phSearch" type="search" autocomplete="off" [attr.aria-label]="'PhoneSettings.search' | t" [placeholder]="'PhoneSettings.search' | t"
            class="min-h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm" [ngModel]="q()" (ngModelChange)="search($event)" />
          <select id="ph-country" name="phCountry" [class]="cls.input" [ngModel]="country()" (ngModelChange)="pick($event)">
            <option value="">{{ 'PhoneSettings.own' | t }}</option>
            @for (c of shown(); track c.iso) { <option [value]="c.iso">{{ c.name }} ({{ c.code }})</option> }
          </select>
        </div>
        <div class="flex flex-col gap-1.5"><label for="ph-code" [class]="cls.label">{{ 'PhoneSettings.code' | t }}<app-req /></label>
          <input id="ph-code" name="phCode" dir="ltr" maxlength="5" autocomplete="off" [class]="cls.input" [ngModel]="code()" (ngModelChange)="edit(() => code.set($event))" /></div>
        <div class="flex flex-col gap-1.5"><label for="ph-len" [class]="cls.label">{{ 'PhoneSettings.length' | t }}<app-req /></label>
          <input id="ph-len" name="phLen" type="number" min="4" max="15" dir="ltr" [class]="cls.input" [ngModel]="len()" (ngModelChange)="edit(() => len.set($event))" />
          <span class="text-xs text-muted">{{ 'PhoneSettings.lengthHint' | t }}</span></div>
        <div class="flex flex-col gap-1.5"><label for="ph-starts" [class]="cls.label">{{ 'PhoneSettings.starts' | t }}</label>
          <input id="ph-starts" name="phStarts" dir="ltr" autocomplete="off" [class]="cls.input" [ngModel]="starts()" (ngModelChange)="edit(() => starts.set($event))" />
          <span class="text-xs text-muted">{{ 'PhoneSettings.startsHint' | t }}</span></div>
      </div>
      @if (missing()) { <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'PhoneSettings.missing' | t }}</p> }
      <div class="rounded-xl border border-line bg-bg px-4 py-3 text-sm">
        @if (fmt(); as f) {
          {{ (f.starts.length ? 'PhoneSettings.sumStarts' : 'PhoneSettings.sum') | t: { len: f.length, starts: f.starts.join(' / '), example: example() } }}
          {{ 'PhoneSettings.saved' | t }} <b dir="ltr">{{ stored() }}</b>
        } @else { {{ 'PhoneSettings.finish' | t }} }
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-56 flex-1 flex-col gap-1.5"><label for="ph-try" [class]="cls.label">{{ 'PhoneSettings.try' | t }}</label>
          <input id="ph-try" name="phTry" dir="ltr" inputmode="numeric" autocomplete="off" [class]="cls.input" [ngModel]="tryV()" (ngModelChange)="tryIt($event)" /></div>
        <p class="min-h-11 py-2.5 text-sm font-semibold" aria-live="polite">
          @if (tryV() && fmt(); as f) {
            @if (tryOk()) { <span class="text-ok">{{ 'PhoneSettings.tryOk' | t }}</span> }
            @else if (tryV().length < f.length) { <span class="text-muted">{{ 'Auth.phoneCount' | t: { n: tryV().length, len: f.length } }}</span> }
            @else { <span class="text-danger">{{ 'PhoneSettings.tryStarts' | t: { starts: f.starts.join(' / ') } }}</span> }
          }
        </p>
      </div>
      <p class="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-ink">{{ 'PhoneSettings.existing' | t }}</p>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <div class="flex flex-wrap items-center gap-3"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button><app-req-note /></div>
    </form>`,
})
export class PhoneSettings implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly site = inject(SiteService);
  protected readonly i18n = inject(I18n);
  protected readonly cls = CLS;
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);

  protected readonly country = signal('');
  protected readonly code = signal('+20');
  protected readonly len = signal<number | string>(11);
  protected readonly starts = signal('01');
  protected readonly q = signal('');
  protected readonly tryV = signal('');
  protected readonly missing = signal(false);

  private readonly all = computed(() => {
    const loc = this.i18n.locale();
    return COUNTRIES.map((c) => ({ ...c, name: countryName(c.iso, loc) })).sort((a, b) => a.name.localeCompare(b.name, loc));
  });
  /** Countries matching the search (name, ISO code or calling code); the picked one always stays in the list. */
  protected readonly shown = computed(() => {
    const s = this.q().trim().toLowerCase().replace(/^\+/, '');
    if (!s) return this.all();
    const hit = this.all().filter((c) => c.iso === this.country() || c.name.toLowerCase().includes(s) || c.iso.toLowerCase() === s || c.code.slice(1).startsWith(s));
    // Names that start with the search come first (so "eg" finds Egypt before Montenegro).
    const first = (c: { name: string; iso: string }) => (c.name.toLowerCase().startsWith(s) || c.iso.toLowerCase() === s ? 0 : 1);
    return [...hit].sort((a, b) => first(a) - first(b));
  });
  /** The format as typed, or null while the length is missing or out of range. */
  protected readonly fmt = computed<PhoneFmt | null>(() => {
    const n = Number(this.len());
    if (!Number.isInteger(n) || n < 4 || n > 15) return null;
    const code = this.code().trim().startsWith('+') ? this.code().trim() : '+' + this.code().trim();
    return { country: this.country(), countryCode: code, length: n, starts: this.starts().split(',').map((x) => x.trim()).filter(Boolean) };
  });
  protected readonly example = computed(() => { const f = this.fmt(); return f ? phoneExample(f) : ''; });
  protected readonly stored = computed(() => { const f = this.fmt(), e = this.example(); return f ? f.countryCode + (e.startsWith('0') ? e.slice(1) : e) : ''; });
  protected readonly tryOk = computed(() => { const f = this.fmt(); return !!f && phoneOk(this.tryV(), f); });

  async ngOnInit(): Promise<void> {
    const f = await firstValueFrom(this.http.get<PhoneFmt>('/api/admin/settings/phone'));
    this.country.set(f.country); this.code.set(f.countryCode); this.len.set(f.length); this.starts.set(f.starts.join(', '));
  }

  protected search(v: string): void {
    this.q.set(v);
    const first = this.shown()[0];
    if (v.trim() && first && first.iso !== this.country()) this.pick(first.iso);
  }
  protected pick(iso: string): void {
    this.country.set(iso);
    const c = COUNTRIES.find((x) => x.iso === iso);
    this.missing.set(!!c && c.length === null);
    if (c) { this.code.set(c.code); this.len.set(c.length ?? ''); this.starts.set(c.starts.join(', ')); }
    this.tryIt(this.tryV());
  }
  /** Changing a box by hand makes it your own format. */
  protected edit(fn: () => void): void { fn(); this.missing.set(false); this.country.set(''); this.tryIt(this.tryV()); }
  protected tryIt(v: string): void {
    const f = this.fmt();
    this.tryV.set(f ? phoneDigits(v, f) : v.replace(/\D/g, ''));
  }

  protected async save(): Promise<void> {
    const f = this.fmt();
    if (!f) { this.msg.set({ tone: 'error', text: this.i18n.t('AdminCommon.errors.phoneFormat_length') }); return; }
    this.busy.set(true); this.msg.set(null);
    try {
      await firstValueFrom(this.http.put('/api/admin/settings/phone', f));
      await this.site.load();
      this.msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') });
    } catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
}
