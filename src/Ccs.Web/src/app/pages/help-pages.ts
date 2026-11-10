import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth } from '../core/auth';
import { adminError } from '../core/admin-api';
import { I18n, TPipe } from '../core/i18n';
import { Alert, Req } from '../shared/ui';
import { CLS } from './admin/admin-pages';

// ================================================================== help center (public)

interface KbCatPub { id: string; slug: string; nameEn: string; nameAr: string }
interface KbItem { id: string; slug: string; titleEn: string; titleAr: string | null; categoryId: string | null; excerpt: string; excerptAr: string | null; updatedAt: string }
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
          <li><a [routerLink]="'/' + i18n.locale() + '/kb/' + a.slug" [class]="cls.card + ' block p-5 hover:border-brand'">
            <span class="block text-lg font-bold text-brand-ink" dir="auto">{{ i18n.pick(a.titleEn, a.titleAr) }}</span>
            <span class="mt-1 block text-sm text-muted" dir="auto">{{ i18n.pick(a.excerpt, a.excerptAr) }}…</span>
          </a></li>
        }
      </ul>
    </main>`,
})
export class KbListPage implements OnInit {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  protected readonly q = signal('');
  protected readonly cat = signal('');
  protected readonly cats = signal<KbCatPub[]>([]);
  protected readonly items = signal<KbItem[]>([]);
  protected readonly loaded = signal(false);

  ngOnInit(): void { void this.load(); }
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
      <a [routerLink]="'/' + i18n.locale() + '/kb'" class="text-sm font-semibold text-brand-ink hover:underline">← {{ 'Kb.title' | t }}</a>
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
            <ul class="mt-2 flex flex-col gap-1">@for (r of x.related; track r.slug) { <li><a [routerLink]="'/' + i18n.locale() + '/kb/' + r.slug" class="text-brand-ink hover:underline" dir="auto">{{ i18n.pick(r.titleEn, r.titleAr) }}</a></li> }</ul>
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
  imports: [TPipe, FormsModule, Alert, Req],
  template: `
    <main class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div><h1 class="text-3xl font-bold tracking-tight">{{ 'Canned.title' | t }}</h1><p class="mt-1 max-w-prose text-muted">{{ 'Canned.subtitle' | t }}</p></div>
      @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
      <details [class]="cls.card" #add>
        <summary [class]="cls.summary"><span class="text-lg font-bold">{{ 'Canned.add' | t }}</span></summary>
        <form class="flex flex-col gap-4 px-5 pb-5" (ngSubmit)="save(null, nw, add)">
          <div class="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div class="flex flex-col gap-1.5"><label for="cn-t" [class]="cls.label">{{ 'Canned.name' | t }}<app-req /></label>
              <input id="cn-t" name="t" dir="auto" required maxlength="120" [class]="cls.input" [(ngModel)]="nw.title" /></div>
            <div class="flex flex-col gap-1.5"><label for="cn-l" [class]="cls.label">{{ 'Canned.language' | t }}</label>
              <select id="cn-l" name="l" [class]="cls.input" [(ngModel)]="nw.language">@for (l of langs; track l) { <option [value]="l">{{ 'Canned.lang.' + l | t }}</option> }</select></div>
          </div>
          <div class="flex flex-col gap-1.5"><label for="cn-b" [class]="cls.label">{{ 'Canned.body' | t }}<app-req /></label>
            <textarea id="cn-b" name="b" rows="5" dir="auto" required maxlength="5000" [class]="cls.input + ' py-2'" [(ngModel)]="nw.body"></textarea></div>
          @if (canShare()) { <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="s" class="h-5 w-5" [(ngModel)]="nw.isShared" /> {{ 'Canned.shared' | t }}</label> }
          <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Canned.save' | t }}</button></div>
        </form>
      </details>
      @for (group of groups(); track group.title) {
        <section class="flex flex-col gap-2">
          <h2 class="text-xl font-bold">{{ group.title | t }}</h2>
          @if (!group.items.length) { <p class="text-sm text-muted">{{ 'Canned.empty' | t }}</p> }
          @for (c of group.items; track c.id) {
            <details [class]="cls.card">
              <summary [class]="cls.summary"><span class="font-bold" dir="auto">{{ c.title }}</span>
                <span class="text-sm text-muted"> · {{ 'Canned.lang.' + c.language | t }}@if (c.isShared) { · {{ c.owner }} }</span></summary>
              @if (editable(c)) {
                <form class="flex flex-col gap-3 px-5 pb-5" (ngSubmit)="save(c.id, ed[c.id])">
                  <div class="grid gap-4 md:grid-cols-[2fr_1fr]">
                    <div class="flex flex-col gap-1.5"><label [for]="'t' + c.id" [class]="cls.label">{{ 'Canned.name' | t }}</label>
                      <input [id]="'t' + c.id" name="t" dir="auto" required maxlength="120" [class]="cls.input" [(ngModel)]="ed[c.id].title" /></div>
                    <div class="flex flex-col gap-1.5"><label [for]="'l' + c.id" [class]="cls.label">{{ 'Canned.language' | t }}</label>
                      <select [id]="'l' + c.id" name="l" [class]="cls.input" [(ngModel)]="ed[c.id].language">@for (l of langs; track l) { <option [value]="l">{{ 'Canned.lang.' + l | t }}</option> }</select></div>
                  </div>
                  <label [for]="'b' + c.id" class="sr-only">{{ 'Canned.body' | t }}</label>
                  <textarea [id]="'b' + c.id" name="b" rows="5" dir="auto" required maxlength="5000" [class]="cls.input + ' py-2'" [(ngModel)]="ed[c.id].body"></textarea>
                  @if (canShare()) { <label class="flex min-h-11 items-center gap-2"><input type="checkbox" name="s" class="h-5 w-5" [(ngModel)]="ed[c.id].isShared" /> {{ 'Canned.shared' | t }}</label> }
                  <div class="flex flex-wrap gap-2"><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'Canned.save' | t }}</button>
                    <button type="button" [class]="cls.danger" [disabled]="busy()" (click)="remove(c)">{{ 'Canned.delete' | t }}</button></div>
                </form>
              } @else { <p class="whitespace-pre-line px-5 pb-5 text-sm" dir="auto">{{ c.body }}</p> }
            </details>
          }
        </section>
      }
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
    { title: 'Canned.personalTitle', items: this.rows().filter((c) => !c.isShared) },
    { title: 'Canned.sharedTitle', items: this.rows().filter((c) => c.isShared) },
  ]);
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
  protected async save(id: string | null, m: CannedModel, box?: HTMLDetailsElement): Promise<void> {
    if (await this.act(() => this.api.save(id, m), 'Canned.saved') && !id) { this.nw = blankCanned(); if (box) box.open = false; }
  }
  protected remove(c: Canned): void { void this.act(() => this.api.del(c.id), 'Canned.deleted'); }
}
