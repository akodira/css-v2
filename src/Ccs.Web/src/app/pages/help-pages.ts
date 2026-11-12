import { NgTemplateOutlet } from '@angular/common';
import { PlaceholderInfo, PlaceholderPicker } from '../shared/email-editor';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../core/auth';
import { adminError } from '../core/admin-api';
import { I18n, TPipe } from '../core/i18n';
import { Alert, Req } from '../shared/ui';
import { CLS } from './admin/admin-pages';

// ================================================================== help center (public)

interface KbCatPub { id: string; slug: string; nameEn: string; nameAr: string }
interface KbItem { id: string; slug: string; titleEn: string; titleAr: string | null; categoryId: string | null; excerpt: string; excerptAr: string | null; updatedAt: string; publishedAt: string | null }
interface KbArticle {
  id: string; slug: string; titleEn: string; titleAr: string | null; bodyEn: string; bodyAr: string | null; categoryId: string | null; updatedAt: string;
  helpfulCount: number; notHelpfulCount: number; myVote: boolean | null; signedIn: boolean; related: { slug: string; titleEn: string; titleAr: string | null }[];
}

@Component({
  selector: 'app-kb-list',
  imports: [TPipe, RouterLink],
  template: `
    <main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">{{ 'Kb.title' | t }}</h1>
        <p class="mt-1 text-muted">{{ 'Kb.subtitle' | t }}</p>
      </div>
      <form role="search" class="flex gap-2" (submit)="$event.preventDefault(); load()">
        <label for="kbq" class="sr-only">{{ 'Kb.search' | t }}</label>
        <input id="kbq" type="search" dir="auto" maxlength="100" [placeholder]="'Kb.searchPlaceholder' | t" [class]="cls.input" [value]="q()" (input)="q.set($any($event.target).value)" />
        <button type="submit" [class]="cls.btn">{{ 'Kb.searchButton' | t }}</button>
      </form>
      @if (cats().length) {
        <nav [attr.aria-label]="'Kb.categories' | t" class="flex flex-wrap gap-2">
          @for (c of [{ slug: '', nameEn: '', nameAr: '' }].concat(cats()); track c.slug) {
            <button type="button" (click)="cat.set(c.slug); load()" [attr.aria-current]="cat() === c.slug ? 'true' : null"
              class="min-h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold" [class]="cat() === c.slug ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:bg-bg'">
              {{ c.slug ? i18n.pick(c.nameEn, c.nameAr) : ('Kb.all' | t) }}</button>
          }
        </nav>
      }
      @if (loaded() && !items().length) { <p class="text-muted">{{ (q() || cat() ? 'Kb.noResults' : 'Kb.empty') | t }}</p> }
      <ul class="flex flex-col gap-3">
        @for (a of items(); track a.id) {
          <li class="rounded-md border border-line bg-surface p-5">
            <a [routerLink]="kbBase() + '/' + a.slug" class="text-lg font-bold text-brand-ink underline" dir="auto">{{ i18n.pick(a.titleEn, a.titleAr) }}</a>
            <p class="mt-1 text-sm text-muted">{{ meta(a) }}</p>
          </li>
        }
      </ul>
    </main>`,
})
export class KbListPage implements OnInit {
  private readonly kbRouter = inject(Router);
  /** Staff read the knowledge base inside the console frame (v1 /console/kb). */
  protected kbBase(): string { return '/' + this.i18n.locale() + (this.kbRouter.url.includes('/console/kb') ? '/console/kb' : '/kb'); }
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  protected readonly q = signal('');
  protected readonly cat = signal('');
  protected readonly cats = signal<KbCatPub[]>([]);
  protected readonly items = signal<KbItem[]>([]);
  protected readonly loaded = signal(false);

  ngOnInit(): void { void this.load(); }
  /** v1: "Category · Nov 5, 2026" under each title. */
  protected meta(a: KbItem): string {
    const c = this.cats().find((x) => x.id === a.categoryId);
    return [c ? this.i18n.pick(c.nameEn, c.nameAr) : null, a.publishedAt ? this.i18n.day(a.publishedAt) : null].filter(Boolean).join(' · ');
  }
  protected async load(): Promise<void> {
    const params: Record<string, string> = {};
    if (this.q().trim()) params['q'] = this.q().trim();
    if (this.cat()) params['category'] = this.cat();
    try {
      const r = await firstValueFrom(this.http.get<{ categories: KbCatPub[]; items: KbItem[] }>('/api/kb', { params }));
      this.cats.set(r.categories); this.items.set(r.items);
    } finally { this.loaded.set(true); }
  }
}

@Component({
  selector: 'app-kb-article',
  imports: [TPipe, RouterLink, Alert],
  template: `
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <a [routerLink]="kbBase()" class="text-sm font-semibold text-brand-ink hover:underline">← {{ 'Kb.title' | t }}</a>
      @if (missing()) { <app-alert>{{ 'Directory.errors.notFound' | t }}</app-alert> }
      @if (a(); as x) {
        <article [class]="cls.card + ' p-6 sm:p-8'">
          <h1 class="text-3xl font-bold tracking-tight" dir="auto">{{ i18n.pick(x.titleEn, x.titleAr) }}</h1>
          <p class="mt-1 text-sm text-muted">{{ 'Kb.updated' | t: { date: i18n.date(x.updatedAt) } }}</p>
          <div class="mt-6 whitespace-pre-line leading-relaxed" dir="auto">{{ i18n.pick(x.bodyEn, x.bodyAr) }}</div>
        </article>
        <section [class]="cls.card + ' p-5'" [attr.aria-label]="'Kb.feedback' | t">
          <p class="font-semibold">{{ 'Kb.wasHelpful' | t }}</p>
          @if (x.signedIn) {
            <div class="mt-2 flex gap-2">
              <button type="button" [class]="x.myVote === true ? cls.btn : cls.btn2" [attr.aria-pressed]="x.myVote === true" (click)="vote(true)">{{ 'Kb.yes' | t }}</button>
              <button type="button" [class]="x.myVote === false ? cls.btn : cls.btn2" [attr.aria-pressed]="x.myVote === false" (click)="vote(false)">{{ 'Kb.no' | t }}</button>
            </div>
            @if (thanks()) { <p role="status" class="mt-2 text-sm text-ok">{{ 'Kb.thanks' | t }}</p> }
          } @else {
            <p class="mt-1 text-sm text-muted">{{ 'Kb.signInToVote' | t }} <a [routerLink]="'/' + i18n.locale() + '/login'" class="font-semibold text-brand-ink hover:underline">{{ 'Kb.signIn' | t }}</a></p>
          }
          <p class="mt-2 text-sm text-muted">{{ 'Kb.counts' | t: { helpful: x.helpfulCount, notHelpful: x.notHelpfulCount } }}</p>
        </section>
        @if (x.related.length) {
          <section><h2 class="text-lg font-bold">{{ 'Kb.related' | t }}</h2>
            <ul class="mt-2 flex flex-col gap-1">@for (r of x.related; track r.slug) { <li><a [routerLink]="kbBase() + '/' + r.slug" class="text-brand-ink hover:underline" dir="auto">{{ i18n.pick(r.titleEn, r.titleAr) }}</a></li> }</ul>
          </section>
        }
        <section [class]="cls.card + ' flex flex-wrap items-center justify-between gap-3 p-5'">
          <p class="font-semibold">{{ 'Kb.stillNeedHelp' | t }}</p>
          <a [routerLink]="'/' + i18n.locale() + (auth.signedIn() ? '/tickets/new' : '/login')" [class]="cls.btn + ' inline-flex items-center'">{{ 'Kb.openTicket' | t }}</a>
        </section>
      }
    </main>`,
})
export class KbArticlePage {
  private readonly kbRouter = inject(Router);
  /** Staff read the knowledge base inside the console frame (v1 /console/kb). */
  protected kbBase(): string { return '/' + this.i18n.locale() + (this.kbRouter.url.includes('/console/kb') ? '/console/kb' : '/kb'); }
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  readonly slug = input.required<string>();
  protected readonly a = signal<KbArticle | null>(null);
  protected readonly missing = signal(false);
  protected readonly thanks = signal(false);

  constructor() {
    // follows the route parameter, so related links work without leaving the page
    effect(() => { this.slug(); untracked(() => void this.load()); });
  }
  private async load(): Promise<void> {
    this.missing.set(false); this.thanks.set(false);
    try { this.a.set(await firstValueFrom(this.http.get<KbArticle>('/api/kb/' + encodeURIComponent(this.slug())))); }
    catch { this.a.set(null); this.missing.set(true); }
  }
  protected async vote(helpful: boolean): Promise<void> {
    const x = this.a(); if (!x) return;
    try {
      const r = await firstValueFrom(this.http.post<{ helpfulCount: number; notHelpfulCount: number; myVote: boolean }>(`/api/kb/${x.slug}/feedback`, { helpful }));
      this.a.set({ ...x, ...r }); this.thanks.set(true);
    } catch { /* the counts simply stay */ }
  }
}

// ================================================================== saved replies (staff)

interface Canned { id: string; title: string; body: string; language: string; isShared: boolean; owner: string; mine: boolean }
type CannedModel = { title: string; body: string; language: string; isShared: boolean };
const blankCanned = (): CannedModel => ({ title: '', body: '', language: 'any', isShared: false });

@Injectable({ providedIn: 'root' })
export class CannedApi {
  private readonly http = inject(HttpClient);
  list(): Promise<{ items: Canned[]; canShare: boolean }> { return firstValueFrom(this.http.get<{ items: Canned[]; canShare: boolean }>('/api/canned')); }
  save(id: string | null, m: CannedModel): Promise<unknown> {
    return firstValueFrom(id ? this.http.put('/api/canned/' + id, m) : this.http.post('/api/canned', m));
  }
  del(id: string): Promise<unknown> { return firstValueFrom(this.http.delete('/api/canned/' + id)); }
}

@Component({
  selector: 'app-canned',
  imports: [TPipe, FormsModule, Alert, Req, PlaceholderPicker, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Canned.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Canned.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <ng-template #form let-m="m" let-id="id">
        <form class="flex flex-col gap-3 rounded-xl border border-line bg-bg p-4" novalidate (ngSubmit)="save(id, m)">
          <div class="flex flex-col gap-1.5"><label [for]="'cn-title-' + (id ?? 'new')" class="text-sm font-semibold">{{ 'Canned.name' | t }}<app-req /></label>
            <input [id]="'cn-title-' + (id ?? 'new')" name="t" maxlength="120" dir="auto" [class]="field" [(ngModel)]="m.title" /></div>
          <div class="flex flex-col gap-1.5"><label [for]="'cn-body-' + (id ?? 'new')" class="text-sm font-semibold">{{ 'Canned.body' | t }}<app-req /></label>
            <textarea #box [id]="'cn-body-' + (id ?? 'new')" name="b" rows="5" maxlength="5000" dir="auto" class="w-full rounded-lg border border-line bg-surface p-3 text-base" [(ngModel)]="m.body"></textarea>
            <p class="text-sm text-muted">{{ 'Canned.bodyHint' | t }}</p>
            <app-placeholder-picker [items]="tokens" (insert)="insert(box, m, $event)" /></div>
          <div class="flex flex-col gap-1.5 sm:max-w-xs"><label [for]="'cn-lang-' + (id ?? 'new')" class="text-sm font-semibold">{{ 'Canned.language' | t }}</label>
            <select [id]="'cn-lang-' + (id ?? 'new')" name="l" [class]="field" [(ngModel)]="m.language">@for (l of langs; track l) { <option [value]="l">{{ 'Canned.lang.' + l | t }}</option> }</select></div>
          @if (canShare()) { <label class="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" name="s" class="h-5 w-5" [(ngModel)]="m.isShared" />{{ 'Canned.shared' | t }}</label> }
          <div class="flex flex-wrap gap-2">
            <button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Canned.save' | t }}</button>
            <button type="button" (click)="id ? editing.set(null) : adding.set(false)" [class]="quiet">{{ 'Canned.cancel' | t }}</button>
          </div>
        </form>
      </ng-template>
      <div class="flex flex-col gap-8">
        <div>
          @if (adding()) { <ng-container *ngTemplateOutlet="form; context: { m: nw, id: null }" /> }
          @else { <button type="button" (click)="adding.set(true)" class="flex min-h-11 cursor-pointer items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink">{{ 'Canned.add' | t }}</button> }
        </div>
        @for (group of groups(); track group.title) {
          <section [attr.aria-labelledby]="'cn-' + group.key" class="flex flex-col gap-3">
            <h2 [id]="'cn-' + group.key" class="text-xl font-bold">{{ group.title | t }}</h2>
            @if (!group.items.length) { <p class="text-muted">{{ 'Canned.empty' | t }}</p> } @else {
              <ul class="flex flex-col gap-3">
                @for (c of group.items; track c.id) {
                  @if (editing() === c.id) { <li><ng-container *ngTemplateOutlet="form; context: { m: ed[c.id], id: c.id }" /></li> }
                  @else {
                    <li class="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                      <div class="flex flex-wrap items-center gap-2">
                        <h3 class="font-bold" dir="auto">{{ c.title }}</h3>
                        <span class="rounded-full px-2 py-0.5 text-xs font-semibold" [class]="c.isShared ? 'bg-brand-soft text-brand-ink' : 'bg-bg text-muted'">{{ (c.isShared ? 'Canned.sharedBadge' : 'Canned.personalBadge') | t }}</span>
                        @if (c.language !== 'any') { <span class="rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted">{{ 'Canned.lang.' + c.language | t }}</span> }
                      </div>
                      <p class="line-clamp-3 whitespace-pre-wrap text-sm text-muted" dir="auto">{{ c.body }}</p>
                      @if (editable(c)) {
                        <div class="flex flex-wrap gap-2">
                          <button type="button" (click)="editing.set(c.id)" [class]="quiet">{{ 'Canned.edit' | t }}</button>
                          @if (asking() === c.id) {
                            <span class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">{{ 'Canned.confirmDelete' | t }}</span>
                              <button type="button" [disabled]="busy()" (click)="remove(c)" class="flex min-h-11 cursor-pointer items-center rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-60">{{ 'Canned.delete' | t }}</button>
                              <button type="button" (click)="asking.set(null)" [class]="quiet">{{ 'Canned.cancel' | t }}</button></span>
                          } @else { <button type="button" (click)="asking.set(c.id)" [class]="quiet + ' text-danger'">{{ 'Canned.delete' | t }}</button> }
                        </div>
                      }
                    </li>
                  }
                }
              </ul>
            }
          </section>
        }
      </div>
    </main>`,
  changeDetection: ChangeDetectionStrategy.Default,
})
export class CannedPage implements OnInit {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(CannedApi);
  protected readonly cls = CLS;
  protected readonly langs = ['any', 'en', 'ar'];
  protected readonly rows = signal<Canned[]>([]);
  protected readonly canShare = signal(false);
  protected readonly busy = signal(false);
  protected readonly msg = signal<{ tone: 'error' | 'success'; text: string } | null>(null);
  protected readonly groups = computed(() => [
    { key: 'mine', title: 'Canned.personalTitle', items: this.rows().filter((c) => !c.isShared) },
    { key: 'shared', title: 'Canned.sharedTitle', items: this.rows().filter((c) => c.isShared) },
  ]);
  protected readonly adding = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly asking = signal<string | null>(null);
  protected readonly quiet = 'flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg';
  protected readonly field = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base';
  /** v1 CANNED_PLACEHOLDERS: filled in from the ticket when the reply is inserted. */
  protected readonly tokens: PlaceholderInfo[] = [
    { token: 'customer_name', en: 'Full name of the customer on this ticket.', ar: 'الاسم الكامل للعميل في هذه التذكرة.' },
    { token: 'customer_email', en: 'Email address of the customer.', ar: 'البريد الإلكتروني للعميل.' },
    { token: 'agent_name', en: 'Your own name, as the person replying.', ar: 'اسمك أنت بصفتك من يرد.' },
    { token: 'reference', en: 'Ticket number, for example CTS-2026-000123.', ar: 'رقم التذكرة، مثل CTS-2026-000123.' },
    { token: 'subject', en: 'Subject line of the ticket.', ar: 'عنوان التذكرة.' },
    { token: 'category', en: 'Category of the ticket.', ar: 'تصنيف التذكرة.' },
    { token: 'team', en: 'Team handling the ticket.', ar: 'الفريق المسؤول عن التذكرة.' },
  ];
  protected insert(el: HTMLTextAreaElement, m: CannedModel, token: string): void {
    const s = el.selectionStart ?? m.body.length, e = el.selectionEnd ?? s;
    m.body = m.body.slice(0, s) + token + m.body.slice(e);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  }
  protected nw: CannedModel = blankCanned();
  protected ed: Record<string, CannedModel> = {};

  ngOnInit(): void { void this.load(); }
  private async load(): Promise<void> {
    const r = await this.api.list();
    for (const c of r.items) this.ed[c.id] = { title: c.title, body: c.body, language: c.language, isShared: c.isShared };
    this.canShare.set(r.canShare); this.rows.set(r.items);
  }
  protected editable(c: Canned): boolean { return c.isShared ? this.canShare() : c.mine; }
  private async act(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    this.busy.set(true); this.msg.set(null);
    try { await fn(); this.msg.set({ tone: 'success', text: this.i18n.t(ok) }); await this.load(); return true; }
    catch (e) {
      const code = (e as { error?: { code?: string } }).error?.code ?? 'generic';
      this.msg.set({ tone: 'error', text: this.i18n.has('Canned.errors.' + code) ? this.i18n.t('Canned.errors.' + code) : adminError(this.i18n, e) });
      return false;
    } finally { this.busy.set(false); }
  }
  protected async save(id: string | null, m: CannedModel): Promise<void> {
    if (await this.act(() => this.api.save(id, m), 'Canned.saved')) { if (id) this.editing.set(null); else { this.nw = blankCanned(); this.adding.set(false); } }
  }
  protected remove(c: Canned): void { this.asking.set(null); void this.act(() => this.api.del(c.id), 'Canned.deleted'); }
}
