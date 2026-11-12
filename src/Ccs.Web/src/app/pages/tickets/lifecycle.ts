import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Directive, Injectable, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/auth';
import { I18n, TPipe } from '../../core/i18n';
import { Message, NewTicketOptions, TicketDetail } from '../../core/api';
import { Alert, Req, ReqNote } from '../../shared/ui';

export interface EscalationTarget { id: string; name: string; label: string; ruleKey: string }
export interface TicketLinkDto { kind: 'duplicate_of' | 'follow_up_of'; direction: 'from' | 'to'; otherId: string | null; otherReference: string | null }
export interface CancellationDto { id: string; reason: string; status: string; requesterName: string | null; createdAt: string; decisionNote: string | null }
export interface StaffFieldDto { id: string; key: string; labelEn: string; labelAr: string; type: string; options: string; isRequired: boolean }
export interface TicketLifecycle {
  links: TicketLinkDto[]; cancellation: CancellationDto | null; feedback: { rating: number; comment: string | null } | null;
  escalationTargets: EscalationTarget[]; canEscalate: boolean; canChangeCategory: boolean; canClose: boolean;
  staffFields: StaffFieldDto[]; staffValues: Record<string, string>;
}

const AREA = 'w-full rounded-lg border border-line bg-surface p-3 text-base';
const FIELD = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base';
const BTN = 'min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:opacity-60';
const BTN2 = 'min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg disabled:opacity-60';
const CARD = 'rounded-md border border-line bg-surface p-6';
type Msg = { tone: 'success' | 'error'; text: string } | null;

@Injectable({ providedIn: 'root' })
export class LifecycleApi {
  private readonly http = inject(HttpClient);
  private u(id: string, p: string) { return `/api/tickets/${id}/${p}`; }
  get(id: string): Promise<TicketLifecycle> { return firstValueFrom(this.http.get<TicketLifecycle>(this.u(id, 'lifecycle'))); }
  post<T = unknown>(id: string, p: string, body: unknown = {}): Promise<T> { return firstValueFrom(this.http.post<T>(this.u(id, p), body)); }
  put(id: string, p: string, body: unknown): Promise<unknown> { return firstValueFrom(this.http.put(this.u(id, p), body)); }
  del(id: string, p: string): Promise<unknown> { return firstValueFrom(this.http.delete(this.u(id, p))); }
  suggest(q: string): Promise<{ slug: string; titleEn: string; titleAr: string | null }[]> {
    return firstValueFrom(this.http.get<{ slug: string; titleEn: string; titleAr: string | null }[]>('/api/kb/suggest', { params: { q } }));
  }
}

/** Shared base: a busy flag, one message line and a runner that reports and then asks the page to reload. */
@Directive()
abstract class Panel {
  protected readonly i18n = inject(I18n);
  protected readonly api = inject(LifecycleApi);
  readonly changed = output<void>();
  protected readonly busy = signal(false);
  protected readonly msg = signal<Msg>(null);
  protected readonly cls = { area: AREA, field: FIELD, btn: BTN, btn2: BTN2, card: CARD };
  protected async run(fn: () => Promise<unknown>, okKey: string | null, errNs = 'Lifecycle.errors'): Promise<boolean> {
    this.busy.set(true); this.msg.set(null);
    try { await fn(); if (okKey) this.msg.set({ tone: 'success', text: this.i18n.t(okKey) }); this.changed.emit(); return true; }
    catch (e) { this.msg.set({ tone: 'error', text: this.errText(e, errNs) }); return false; }
    finally { this.busy.set(false); }
  }
  protected errText(e: unknown, ns: string): string {
    const p = problemOf(e);
    const title = String((e as { error?: { title?: string } })?.error?.title ?? '');
    const key = p.field === 'reason' || p.field === 'note' || /reason/.test(title) ? 'reasonRequired'
      : p.field === 'reference' ? 'originalNotFound' : /already pending/.test(title) ? 'alreadyPending'
      : /cannot be cancelled/.test(title) ? 'notCancellable' : /no pending/.test(title) ? 'noPending'
      : p.status === 403 ? 'notAllowed' : p.status === 404 ? 'notFound' : 'generic';
    return this.i18n.has(`${ns}.${key}`) ? this.i18n.t(`${ns}.${key}`) : this.i18n.t('Lifecycle.errors.' + key);
  }
}

// ============================================================== comments: edit / delete within 5 minutes (v1 CommentActions)

@Component({
  selector: 'app-comment-actions',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editable()) {
      @switch (mode()) {
        @case ('edit') {
          <div class="mt-2 flex flex-col gap-2">
            <label class="sr-only" [for]="'edit-' + message().id">{{ 'Comments.editLabel' | t }}</label>
            <textarea [id]="'edit-' + message().id" rows="3" maxlength="10000" dir="auto" [class]="cls.area" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
            <div class="flex flex-wrap gap-2">
              <button type="button" [disabled]="busy()" [class]="cls.btn" (click)="save()">{{ 'Comments.save' | t }}</button>
              <button type="button" [disabled]="busy()" [class]="cls.btn2" (click)="mode.set('view')">{{ 'Comments.cancel' | t }}</button>
            </div>
          </div>
        }
        @case ('confirm') {
          <div role="alertdialog" [attr.aria-label]="'Comments.confirmDelete' | t" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-sm">{{ 'Comments.confirmDelete' | t }}</span>
            <button type="button" [disabled]="busy()" class="min-h-11 cursor-pointer rounded-lg bg-danger px-4 font-semibold text-white" (click)="remove()">{{ 'Comments.yesDelete' | t }}</button>
            <button type="button" [disabled]="busy()" [class]="cls.btn2" (click)="mode.set('view')">{{ 'Comments.cancel' | t }}</button>
          </div>
        }
        @default {
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" class="min-h-9 cursor-pointer rounded-md px-2 text-sm font-semibold text-brand-ink hover:bg-bg" (click)="text.set(message().body); mode.set('edit')">{{ 'Comments.edit' | t }}</button>
            <button type="button" class="min-h-9 cursor-pointer rounded-md px-2 text-sm font-semibold text-danger hover:bg-danger-soft" (click)="mode.set('confirm')">{{ 'Comments.delete' | t }}</button>
            <span class="text-xs text-muted">{{ 'Comments.windowNote' | t }}</span>
          </div>
        }
      }
      @if (error()) { <p role="alert" class="mt-1 text-sm font-medium text-danger">{{ error() }}</p> }
    }`,
})
export class CommentActions {
  private readonly i18n = inject(I18n);
  private readonly api = inject(LifecycleApi);
  readonly ticketId = input.required<string>();
  readonly message = input.required<Message>();
  readonly me = input<string | null>(null);
  readonly changed = output<void>();
  protected readonly cls = { area: AREA, btn: BTN, btn2: BTN2 };
  protected readonly mode = signal<'view' | 'edit' | 'confirm'>('view');
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly now = signal(Date.now());
  protected readonly editable = computed(() => {
    const m = this.message();
    return !!this.me() && m.authorId === this.me() && m.kind !== 'system' && this.now() - new Date(m.createdAt).getTime() < 5 * 60_000;
  });
  constructor() {
    // Hide the buttons when the 5-minute window closes.
    const t = setInterval(() => this.now.set(Date.now()), 15_000);
    effect((onCleanup) => onCleanup(() => clearInterval(t)));
  }
  private async go(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { await fn(); this.mode.set('view'); this.changed.emit(); }
    catch (e) {
      const t = String((e as { error?: { title?: string } })?.error?.title ?? '');
      this.error.set(this.i18n.t('Comments.errors.' + (/window/.test(t) ? 'window' : /closed/.test(t) ? 'closed' : problemOf(e).field === 'body' ? 'empty' : 'generic')));
    } finally { this.busy.set(false); }
  }
  protected save(): void { void this.go(() => this.api.put(this.ticketId(), 'messages/' + this.message().id, { body: this.text() })); }
  protected remove(): void { void this.go(() => this.api.del(this.ticketId(), 'messages/' + this.message().id)); }
}

// ============================================================== staff: everything in the console ticket's side column

@Component({
  selector: 'app-staff-lifecycle',
  imports: [TPipe, Alert, RouterLink, Req, ReqNote],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lc(); as lc) {
      @if (on('links') && lc.links.length) {
        <section [class]="cls.card" aria-labelledby="lk"><h2 id="lk" class="mb-3 text-lg font-bold">{{ 'Lifecycle.staff.linksTitle' | t }}</h2>
          <ul class="flex flex-col gap-1 text-sm">
            @for (l of lc.links; track l.kind + l.direction) {
              <li>@if (l.otherId) { <a [routerLink]="link('/console/tickets/' + l.otherId)" class="font-semibold underline" dir="ltr">{{ l.otherReference }}</a> {{ linkText(l) }} } @else { - }</li>
            }
          </ul>
        </section>
      }

      @if (on('links') && lc.cancellation?.status === 'pending' && lc.canClose) {
        <section class="flex flex-col gap-3 rounded-md border border-warn-ink/30 bg-warn-soft p-6" aria-labelledby="cr-title">
          <h2 id="cr-title" class="font-bold">{{ 'Lifecycle.staff.requestTitle' | t }}</h2>
          <p class="text-sm text-muted">{{ 'Lifecycle.staff.requestMeta' | t: { name: lc.cancellation!.requesterName ?? '-', when: i18n.date(lc.cancellation!.createdAt) } }}</p>
          <p class="whitespace-pre-wrap" dir="auto">{{ lc.cancellation!.reason }}</p>
          <div class="flex flex-col gap-1.5">
            <label for="cr-note" class="text-sm font-semibold">{{ 'Lifecycle.staff.note' | t }}</label>
            <textarea id="cr-note" rows="2" maxlength="1000" dir="auto" [class]="cls.area" [value]="note()" (input)="note.set($any($event.target).value)"></textarea>
            <p class="text-sm text-muted">{{ 'Lifecycle.staff.noteHint' | t }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" [class]="cls.btn" [disabled]="busy()" (click)="decide(true)">{{ 'Lifecycle.staff.approve' | t }}</button>
            <button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="decide(false)">{{ 'Lifecycle.staff.reject' | t }}</button>
          </div>
        </section>
      }

      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }

      @if (on('fields') && lc.staffFields.length) {
        <section [class]="cls.card" aria-labelledby="sf"><h2 id="sf" class="mb-3 text-lg font-bold">{{ 'CustomFields.staffOnly' | t }}</h2>
          <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); saveFields()">
            @for (f of lc.staffFields; track f.id) {
              <div class="flex flex-col gap-1.5">
                <label [for]="'sf-' + f.key" class="text-sm font-semibold">{{ i18n.pick(f.labelEn, f.labelAr) }}@if (f.isRequired) {<app-req />}</label>
                @switch (f.type) {
                  @case ('long_text') { <textarea [id]="'sf-' + f.key" rows="3" dir="auto" [class]="cls.area" [value]="val(f.key)" (input)="set(f.key, $any($event.target).value)"></textarea> }
                  @case ('checkbox') { <input [id]="'sf-' + f.key" type="checkbox" class="h-5 w-5" [checked]="val(f.key) === true" (change)="set(f.key, $any($event.target).checked)" /> }
                  @case ('dropdown') {
                    <select [id]="'sf-' + f.key" [class]="cls.field" [value]="val(f.key)" (change)="set(f.key, $any($event.target).value)">
                      <option value="">{{ 'CustomFields.choose' | t }}</option>
                      @for (c of choices(f.options); track c.value) { <option [value]="c.value" [selected]="val(f.key) === c.value">{{ c.label }}</option> }
                    </select>
                  }
                  @case ('number') { <input [id]="'sf-' + f.key" type="number" dir="ltr" [class]="cls.field" [value]="val(f.key)" (input)="set(f.key, $any($event.target).value === '' ? null : +$any($event.target).value)" /> }
                  @case ('date') { <input [id]="'sf-' + f.key" type="date" [class]="cls.field" [value]="val(f.key)" (input)="set(f.key, $any($event.target).value)" /> }
                  @default { <input [id]="'sf-' + f.key" dir="auto" [class]="cls.field" [value]="val(f.key)" (input)="set(f.key, $any($event.target).value)" /> }
                }
              </div>
            }
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'CustomFields.save' | t }}</button></div>
          </form>
        </section>
      }

      @if (on('dupspam') && lc.canClose) {
        <section [class]="cls.card" aria-labelledby="dsp"><h2 id="dsp" class="mb-3 text-lg font-bold">{{ 'Lifecycle.staff.panelTitle' | t }}</h2>
          <form class="flex flex-col gap-2" (submit)="$event.preventDefault(); duplicate()">
            <label for="dup-ref" class="text-sm font-semibold">{{ 'Lifecycle.staff.duplicateOf' | t }}<app-req /></label>
            <input id="dup-ref" dir="ltr" placeholder="CTS-2026-000123" [class]="cls.field" [value]="ref()" (input)="ref.set($any($event.target).value)" />
            <p class="text-sm text-muted">{{ 'Lifecycle.staff.duplicateHint' | t }}</p>
            <div><button type="submit" [class]="cls.btn2" [disabled]="busy() || !ref().trim()">{{ 'Lifecycle.staff.markDuplicate' | t }}</button></div>
          </form>
          <div class="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            <p class="text-sm text-muted">{{ 'Lifecycle.staff.spamHint' | t }}</p>
            @if (confirmSpam()) {
              <div class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">{{ 'Lifecycle.staff.spamConfirm' | t }}</span>
                <button type="button" [class]="cls.btn" [disabled]="busy()" (click)="spam()">{{ 'Lifecycle.staff.spamYes' | t }}</button>
                <button type="button" class="min-h-11 cursor-pointer rounded-lg px-4 font-semibold text-muted hover:text-ink" (click)="confirmSpam.set(false)">{{ 'Lifecycle.staff.keep' | t }}</button></div>
            } @else {
              <div><button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger px-4 font-semibold text-danger hover:bg-danger-soft" (click)="confirmSpam.set(true)">{{ 'Lifecycle.staff.markSpam' | t }}</button></div>
            }
          </div>
        </section>
      }

      @if (on('category') && lc.canChangeCategory && opts()) {
        <section [class]="cls.card" aria-labelledby="chcat"><h2 id="chcat" class="mb-3 text-lg font-bold">{{ 'Console.categoryForm.title' | t }}</h2>
          <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); changeCategory()">
            <div class="flex flex-col gap-1.5"><label for="cat-sel" class="text-sm font-semibold">{{ 'Console.categoryForm.category' | t }}</label>
              <select id="cat-sel" [class]="cls.field" (change)="cat.set($any($event.target).value); sub.set('')">
                @for (c of opts()!.categories; track c.id) { <option [value]="c.id" [selected]="c.id === cat()">{{ i18n.pick(c.nameEn, c.nameAr) }}</option> }
              </select></div>
            <div class="flex flex-col gap-1.5"><label for="sub-sel" class="text-sm font-semibold">{{ 'Console.categoryForm.subcategory' | t }}</label>
              <select id="sub-sel" [class]="cls.field" (change)="sub.set($any($event.target).value)">
                <option value="" [selected]="!sub()">{{ 'Console.categoryForm.none' | t }}</option>
                @for (s of subs(); track s.id) { <option [value]="s.id" [selected]="s.id === sub()">{{ i18n.pick(s.nameEn, s.nameAr) }}</option> }
              </select></div>
            <div class="flex flex-col gap-1.5"><label for="cat-reason" class="text-sm font-semibold">{{ 'Console.categoryForm.reason' | t }}</label>
              <input id="cat-reason" maxlength="1000" dir="auto" [class]="cls.field" [value]="catReason()" (input)="catReason.set($any($event.target).value)" /></div>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Console.categoryForm.submit' | t }}</button></div>
          </form>
        </section>
      }

      @if (on('escalate') && lc.escalationTargets.length) {
        <section [class]="cls.card" aria-labelledby="flowesc"><h2 id="flowesc" class="mb-3 text-lg font-bold">{{ 'Escalation.ticketTitle' | t }}</h2>
          <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); escalateTo()">
            <p class="text-sm text-muted">{{ (lc.escalationTargets.length > 1 ? 'Escalation.ticketHelpMany' : 'Escalation.ticketHelp') | t }}</p>
            <div class="flex flex-col gap-1.5"><label for="flow-target" class="text-sm font-semibold">{{ 'Escalation.route' | t }}</label>
              <select id="flow-target" [class]="cls.field" (change)="target.set($any($event.target).value)">
                @for (r of lc.escalationTargets; track r.id) { <option [value]="r.id" [selected]="r.id === target()">{{ r.name }}{{ r.label ? ' — ' + r.label : '' }}</option> }
              </select></div>
            <div class="flex flex-col gap-1.5"><label for="flow-reason" class="text-sm font-semibold"><span>{{ 'Escalation.reason' | t }}<app-req /></span></label>
              <textarea id="flow-reason" rows="2" maxlength="1000" dir="auto" [class]="cls.area" [value]="escReason()" (input)="escReason.set($any($event.target).value)"></textarea></div>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Escalation.submit' | t }}</button> <app-req-note /></div>
          </form>
        </section>
      } @else if (on('escalate') && lc.canEscalate) {
        <section [class]="cls.card" aria-labelledby="esc"><h2 id="esc" class="mb-3 text-lg font-bold">{{ 'Console.escalate.title' | t }}</h2>
          <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); escalate()">
            <p class="text-sm text-muted">{{ 'Console.escalate.help' | t }}</p>
            <div class="flex flex-col gap-1.5"><label for="esc-reason" class="text-sm font-semibold">{{ 'Console.escalate.reason' | t }}</label>
              <textarea id="esc-reason" rows="2" maxlength="1000" dir="auto" [class]="cls.area" [value]="escReason()" (input)="escReason.set($any($event.target).value)"></textarea></div>
            <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Console.escalate.submit' | t }}</button> <app-req-note /></div>
          </form>
        </section>
      }
    }`,
})
export class StaffLifecycle extends Panel {
  readonly ticket = input.required<TicketDetail>();
  readonly lc = input<TicketLifecycle | null>(null);
  readonly opts = input<NewTicketOptions | null>(null);
  /** Which block to show, so the page can place each one where v1 has it. Empty = all. */
  readonly part = input<'' | 'links' | 'fields' | 'dupspam' | 'category' | 'escalate'>('');
  protected on(p: string): boolean { return !this.part() || this.part() === p; }
  protected readonly note = signal('');
  protected readonly ref = signal('');
  protected readonly confirmSpam = signal(false);
  protected readonly cat = signal('');
  protected readonly sub = signal('');
  protected readonly catReason = signal('');
  protected readonly target = signal('');
  protected readonly escReason = signal('');
  protected readonly values = signal<Record<string, unknown>>({});
  protected readonly subs = computed(() => this.opts()?.categories.find((c) => c.id === this.cat())?.subcategories ?? []);

  constructor() {
    super();
    effect(() => {
      const t = this.ticket(), lc = this.lc();
      untracked(() => {
        this.cat.set(t.categoryId); this.sub.set(t.subcategoryId ?? '');
        this.target.set(lc?.escalationTargets[0]?.id ?? '');
        const v: Record<string, unknown> = {};
        for (const [k, raw] of Object.entries(lc?.staffValues ?? {})) { try { v[k] = JSON.parse(raw); } catch { v[k] = raw; } }
        this.values.set(v);
      });
    });
  }
  protected link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  protected linkText(l: TicketLinkDto): string {
    const key = l.kind === 'duplicate_of' ? (l.direction === 'from' ? 'linkDuplicate' : 'linkDuplicateBy') : (l.direction === 'from' ? 'linkFollowUp' : 'linkFollowUpBy');
    return this.i18n.t('Lifecycle.staff.' + key, { reference: l.otherReference ?? '' });
  }
  protected val(k: string): unknown { return this.values()[k] ?? ''; }
  protected set(k: string, v: unknown): void { this.values.update((x) => ({ ...x, [k]: v })); }
  protected choices(json: string): { value: string; label: string }[] {
    try {
      const arr = JSON.parse(json) as (string | { value: string; label_en?: string; label_ar?: string; labelEn?: string; labelAr?: string })[];
      return arr.map((o) => typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: this.i18n.pick(o.label_en ?? o.labelEn ?? o.value, o.label_ar ?? o.labelAr ?? o.value) });
    } catch { return []; }
  }
  private get id(): string { return this.ticket().id; }
  protected decide(approve: boolean): void {
    void this.run(() => this.api.post(this.id, 'cancellations/' + this.lc()!.cancellation!.id, { approve, note: this.note() }), null).then((ok) => ok && this.note.set(''));
  }
  protected duplicate(): void { void this.run(() => this.api.post(this.id, 'duplicate', { reference: this.ref().trim() }), null).then((ok) => ok && this.ref.set('')); }
  protected spam(): void { void this.run(() => this.api.post(this.id, 'spam'), null).then(() => this.confirmSpam.set(false)); }
  protected changeCategory(): void {
    void this.run(() => this.api.post(this.id, 'category', { categoryId: this.cat(), subcategoryId: this.sub() || null, reason: this.catReason() || null }), 'Console.categoryForm.done', 'Console.errors')
      .then((ok) => ok && this.catReason.set(''));
  }
  protected escalateTo(): void {
    void this.run(() => this.api.post(this.id, 'escalate-to', { target: this.target(), reason: this.escReason() }), 'Escalation.done').then((ok) => ok && this.escReason.set(''));
  }
  protected escalate(): void {
    void this.run(() => this.api.post(this.id, 'escalate', { reason: this.escReason() }), 'Console.escalate.done').then((ok) => ok && this.escReason.set(''));
  }
  protected saveFields(): void {
    const v = Object.fromEntries(Object.entries(this.values()).map(([k, x]) => [k, x === '' ? null : x]));
    void this.run(() => this.api.put(this.id, 'staff-fields', v), 'CustomFields.saved');
  }
}

// ============================================================== customer: links notice, cancel, follow-up, feedback

@Component({
  selector: 'app-customer-lifecycle',
  imports: [TPipe, Alert, RouterLink, Req],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lc(); as lc) {
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      @let st = ticket().status;
      @if (st !== 'resolved' && st !== 'closed') {
        @if (lc.cancellation?.status === 'pending') {
          <section class="flex flex-col gap-2 rounded-md border border-line bg-surface p-5" aria-labelledby="cancel-pending">
            <h2 id="cancel-pending" class="font-bold">{{ 'Lifecycle.customer.pendingTitle' | t }}</h2>
            <p class="text-muted">{{ 'Lifecycle.customer.pendingText' | t }}</p>
            <div><button type="button" [class]="cls.btn2" [disabled]="busy()" (click)="withdraw()">{{ 'Lifecycle.customer.withdraw' | t }}</button></div>
          </section>
        } @else {
          <section class="flex flex-col gap-2 rounded-md border border-line bg-surface p-5" aria-labelledby="cancel-title">
            <h2 id="cancel-title" class="font-bold">{{ 'Lifecycle.customer.title' | t }}</h2>
            @if (!open()) {
              <p class="text-muted">{{ 'Lifecycle.customer.help' | t }}</p>
              <div><button type="button" (click)="open.set(true)" class="mt-1 min-h-11 cursor-pointer rounded-lg border border-line px-4 font-semibold hover:bg-brand-soft">{{ 'Lifecycle.customer.open' | t }}</button></div>
            } @else {
              <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); cancel()">
                <div class="flex flex-col gap-1.5"><label for="cancel-reason" class="text-sm font-semibold"><span>{{ 'Lifecycle.customer.reason' | t }}<app-req /></span></label>
                  <textarea id="cancel-reason" rows="3" maxlength="1000" dir="auto" [class]="cls.area" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea></div>
                <div class="flex flex-wrap gap-2">
                  <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Lifecycle.customer.submit' | t }}</button>
                  <button type="button" (click)="open.set(false)" class="min-h-11 cursor-pointer rounded-lg px-4 font-semibold text-muted hover:text-ink">{{ 'Lifecycle.customer.keep' | t }}</button>
                </div>
              </form>
            }
          </section>
        }
      }

      @if (st === 'closed') {
        <section class="flex flex-col gap-2 rounded-md border border-line bg-surface p-5">
          <p class="text-muted">{{ 'Lifecycle.customer.followUpHelp' | t }}</p>
          <div><a [routerLink]="link('/tickets/new')" [queryParams]="{ followUp: ticket().id }" class="inline-flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold hover:bg-brand-soft">{{ 'Lifecycle.customer.createFollowUp' | t }}</a></div>
        </section>
      }

      @if (st === 'resolved' || st === 'closed') {
        <section aria-labelledby="feedback" class="rounded-md border border-line bg-surface p-6">
          <h2 id="feedback" class="mb-3 text-lg font-bold">{{ 'Ticket.feedback.title' | t }}</h2>
          <form class="flex flex-col gap-3" (submit)="$event.preventDefault(); feedback()">
            <fieldset class="flex flex-col gap-1.5">
              <legend class="text-sm font-semibold">{{ 'Ticket.feedback.rating' | t }}</legend>
              <div class="flex gap-1" dir="ltr">
                @for (n of [1, 2, 3, 4, 5]; track n) {
                  <label class="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border text-lg font-bold" [class]="rating() === n ? 'border-brand bg-brand text-white' : 'border-line bg-surface'">
                    <input type="radio" name="rating" [value]="n" [checked]="rating() === n" (change)="rating.set(n)" [attr.aria-label]="'Ticket.feedback.star' | t: { n }" class="absolute inset-0 cursor-pointer opacity-0" /><span aria-hidden="true">{{ n }}</span></label>
                }
              </div>
            </fieldset>
            <div class="flex flex-col gap-1.5"><label for="fb-comment" class="text-sm font-semibold">{{ 'Ticket.feedback.comment' | t }}</label>
              <textarea id="fb-comment" rows="3" maxlength="2000" dir="auto" [class]="cls.area" [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea></div>
            <div><button type="submit" [class]="cls.btn2" [disabled]="busy() || !rating()">{{ (lc.feedback ? 'Ticket.feedback.update' : 'Ticket.feedback.submit') | t }}</button></div>
          </form>
        </section>
      }
    }`,
})
export class CustomerLifecycle extends Panel {
  readonly ticket = input.required<TicketDetail>();
  readonly lc = input<TicketLifecycle | null>(null);
  protected readonly open = signal(false);
  protected readonly reason = signal('');
  protected readonly rating = signal(0);
  protected readonly comment = signal('');
  constructor() {
    super();
    effect(() => { const f = this.lc()?.feedback; untracked(() => { this.rating.set(f?.rating ?? 0); this.comment.set(f?.comment ?? ''); }); });
  }
  protected link(p: string): string { return `/${this.i18n.locale()}${p}`; }
  private get id(): string { return this.ticket().id; }
  protected cancel(): void {
    void this.run(async () => {
      const r = await this.api.post<{ mode: string }>(this.id, 'cancel', { reason: this.reason() });
      this.msg.set({ tone: 'success', text: this.i18n.t(r.mode === 'cancelled' ? 'Lifecycle.customer.cancelled' : 'Lifecycle.customer.requested') });
    }, null).then((ok) => { if (ok) { this.open.set(false); this.reason.set(''); } });
  }
  protected withdraw(): void { void this.run(() => this.api.post(this.id, 'cancel/withdraw'), null); }
  protected feedback(): void { void this.run(() => this.api.post(this.id, 'feedback', { rating: this.rating(), comment: this.comment() || null }), 'Ticket.feedback.thanks'); }
}

/** The notice at the top of a customer ticket: duplicate of / follow-up of / follow-up from. */
@Component({
  selector: 'app-ticket-links-notice',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dup() || follows().length) {
      <section class="flex flex-col gap-1 rounded-md border border-line bg-brand-soft p-4 text-sm" [attr.aria-label]="'Lifecycle.customer.followUpHelp' | t">
        @if (dup(); as d) {
          <p>@if (d.otherId) { {{ 'Lifecycle.customer.duplicateOf' | t: { reference: d.otherReference } }} <a [routerLink]="link('/tickets/' + d.otherId)" class="font-semibold underline">{{ d.otherReference }}</a> }
            @else { {{ 'Lifecycle.customer.duplicateOfHidden' | t }} }</p>
        }
        @for (l of follows(); track l.direction + l.otherId) {
          <p>{{ (l.direction === 'from' ? 'Lifecycle.customer.followUpOf' : 'Lifecycle.customer.followUpFrom') | t: { reference: l.otherReference } }}
            <a [routerLink]="link('/tickets/' + l.otherId)" class="font-semibold underline">{{ l.otherReference }}</a></p>
        }
      </section>
    }`,
})
export class TicketLinksNotice {
  private readonly i18n = inject(I18n);
  readonly lc = input<TicketLifecycle | null>(null);
  protected readonly dup = computed(() => this.lc()?.links.find((l) => l.kind === 'duplicate_of' && l.direction === 'from') ?? null);
  protected readonly follows = computed(() => (this.lc()?.links ?? []).filter((l) => l.kind === 'follow_up_of' && l.otherId));
  protected link(p: string): string { return `/${this.i18n.locale()}${p}`; }
}
