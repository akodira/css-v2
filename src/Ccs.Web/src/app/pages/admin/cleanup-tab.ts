import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert, Req, ReqNote } from '../../shared/ui';
import { CLS, Msg } from './admin-pages';

interface Named { id: string; nameEn?: string; nameAr?: string; name?: string; isActive?: boolean }
interface Org { id: string; name: string; isActive: boolean; people: number; branches: { id: string; name: string; isActive: boolean }[] }
interface Options {
  counts: { tickets: number; customers: number; notifications: number; sessions: number };
  teams: Named[]; organizations: Org[]; types: Named[]; categories: Named[]; subcategories: Named[]; fields: Named[];
  kbArticles: Named[]; kbCategories: Named[]; canned: Named[]; calendars: Named[];
}
interface Person { id: string; fullName: string; email: string; accountStatus: string; tickets: number; role: string | null }
interface TicketHit { id: string; reference: string; subject: string; status: string; createdAt: string }
type Counts = Record<string, number>;

/** Every part of the selection, as the page keeps it. */
function blank() {
  return {
    tickets: { on: false, mode: 'filter', status: 'closed', before: '', org: '', ids: [] as string[], q: '', hits: [] as TicketHit[] },
    customers: { on: false, all: true, status: 'never', ids: [] as string[], q: '', hits: [] as Person[], deleteTickets: false },
    staff: { on: false, ids: [] as string[], q: '', hits: [] as Person[] },
    teams: { on: false, ids: [] as string[], moveTickets: '', moveCats: '' },
    places: { on: false, orgs: [] as string[], branches: [] as string[], removePeople: false },
    catalog: { on: false, types: [] as string[], categories: [] as string[], subcategories: [] as string[], fields: [] as string[] },
    kb: { on: false, articles: [] as string[], categories: [] as string[] },
    canned: { on: false, ids: [] as string[] },
    calendars: { on: false, ids: [] as string[], pastHolidays: false },
    notifications: { on: false, days: 90 },
    sessions: { on: false },
  };
}

/** Order and wording of the preview lines: [count key, tone]. */
const LINES: [string, 'del' | 'keep' | 'move'][] = [
  ['tickets', 'del'], ['messages', 'del'], ['files', 'del'], ['people', 'del'], ['peopleAnonymized', 'keep'], ['openUnassigned', 'move'],
  ['teams', 'del'], ['teamsOff', 'keep'], ['ticketsMoved', 'move'], ['categoriesMoved', 'move'],
  ['organizations', 'del'], ['organizationsOff', 'keep'], ['branches', 'del'], ['branchesOff', 'keep'], ['peopleUnplaced', 'move'],
  ['types', 'del'], ['typesOff', 'keep'], ['categories', 'del'], ['categoriesOff', 'keep'], ['subcategories', 'del'], ['subcategoriesOff', 'keep'],
  ['fields', 'del'], ['fieldsOff', 'keep'], ['kbArticles', 'del'], ['kbCategories', 'del'], ['kbMoved', 'move'], ['canned', 'del'],
  ['calendars', 'del'], ['holidays', 'del'], ['calendarUsersMoved', 'move'], ['notifications', 'del'], ['sessions', 'del'],
];
const TONE = { del: 'text-danger', keep: 'text-warn-ink', move: 'text-brand-ink' };

/** Settings → Clean up data (administrators only): choose, preview (exact, nothing removed), confirm. */
@Component({
  selector: 'app-set-cleanup',
  imports: [TPipe, FormsModule, Alert, Req, ReqNote],
  template: `
    @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
    <p role="note" class="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"><b>{{ 'AdminCleanup.warnTitle' | t }}</b> {{ 'AdminCleanup.warnText' | t }}</p>

    <ol class="flex flex-wrap gap-2" [attr.aria-label]="'AdminCleanup.steps' | t">
      @for (s of ['choose', 'preview', 'confirm']; track s; let i = $index) {
        <li class="flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold" [class]="step() === s ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-muted'" [attr.aria-current]="step() === s ? 'step' : null">
          <span class="flex h-5 w-5 items-center justify-center rounded-full bg-black/10 text-xs">{{ i + 1 }}</span>{{ 'AdminCleanup.step_' + s | t }}</li>
      }
    </ol>

    @if (step() === 'choose') {
      @if (o(); as x) {
        <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="cu-h">
          <div><h2 id="cu-h" class="text-lg font-bold">{{ 'AdminCleanup.chooseTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminCleanup.chooseIntro' | t }}</p></div>
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">

            <!-- Tickets -->
            <div [class]="box(s.tickets.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.tickets.on" /><span><b class="block">{{ 'AdminCleanup.tickets' | t }}</b><small class="text-muted">{{ 'AdminCleanup.ticketsHint' | t: { n: x.counts.tickets } }}</small></span></label>
              @if (s.tickets.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                  <label class="flex items-center gap-2"><input type="radio" name="tm" value="filter" [(ngModel)]="s.tickets.mode" />{{ 'AdminCleanup.ticketsFilter' | t }}</label>
                  @if (s.tickets.mode === 'filter') {
                    <div class="grid gap-3 sm:grid-cols-2 ps-6">
                      <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminCleanup.status' | t }}
                        <select [class]="cls.input" [(ngModel)]="s.tickets.status">@for (k of ['any', 'closed', 'done', 'dropped']; track k) { <option [value]="k">{{ 'AdminCleanup.st_' + k | t }}</option> }</select></label>
                      <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminCleanup.createdBefore' | t }}<input type="date" [class]="cls.input" [(ngModel)]="s.tickets.before" /></label>
                      <label class="flex flex-col gap-1 text-sm font-semibold sm:col-span-2">{{ 'AdminCleanup.organization' | t }}
                        <select [class]="cls.input" [(ngModel)]="s.tickets.org"><option value="">{{ 'AdminCleanup.any' | t }}</option>@for (g of x.organizations; track g.id) { <option [value]="g.id">{{ g.name }}</option> }</select></label>
                    </div>
                  }
                  <label class="flex items-center gap-2"><input type="radio" name="tm" value="pick" [(ngModel)]="s.tickets.mode" />{{ 'AdminCleanup.ticketsPick' | t }}</label>
                  @if (s.tickets.mode === 'pick') {
                    <div class="flex flex-col gap-2 ps-6">
                      <form class="flex gap-2" (submit)="$event.preventDefault(); findTickets()"><input type="search" dir="auto" [class]="cls.input" [attr.aria-label]="'AdminCleanup.searchTickets' | t" [placeholder]="'AdminCleanup.searchTickets' | t" [(ngModel)]="s.tickets.q" name="tq" /><button type="submit" [class]="cls.btn2">{{ 'AdminCleanup.search' | t }}</button></form>
                      <div class="max-h-48 overflow-auto rounded-lg border border-line">
                        @for (t of s.tickets.hits; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.tickets.ids.includes(t.id)" (change)="flip(s.tickets.ids, t.id)" /><b dir="ltr">{{ t.reference }}</b><span class="truncate" dir="auto">{{ t.subject }}</span></label> }
                        @empty { <p class="px-3 py-2 text-sm text-muted">{{ 'AdminCleanup.searchFirst' | t }}</p> }
                      </div>
                      <p class="text-sm text-muted">{{ 'AdminCleanup.picked' | t: { n: s.tickets.ids.length } }}</p>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Customers -->
            <div [class]="box(s.customers.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.customers.on" /><span><b class="block">{{ 'AdminCleanup.customers' | t }}</b><small class="text-muted">{{ 'AdminCleanup.customersHint' | t: { n: x.counts.customers } }}</small></span></label>
              @if (s.customers.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                  <label class="flex items-center gap-2"><input type="radio" name="cm" [value]="true" [(ngModel)]="s.customers.all" />{{ 'AdminCleanup.customersAll' | t }}</label>
                  @if (s.customers.all) {
                    <label class="flex flex-col gap-1 ps-6 text-sm font-semibold">{{ 'AdminCleanup.accountStatus' | t }}
                      <select [class]="cls.input" [(ngModel)]="s.customers.status">@for (k of ['never', 'suspended', 'pending', 'any']; track k) { <option [value]="k">{{ 'AdminCleanup.as_' + k | t }}</option> }</select></label>
                  }
                  <label class="flex items-center gap-2"><input type="radio" name="cm" [value]="false" [(ngModel)]="s.customers.all" />{{ 'AdminCleanup.customersPick' | t }}</label>
                  @if (!s.customers.all) {
                    <div class="flex flex-col gap-2 ps-6">
                      <form class="flex gap-2" (submit)="$event.preventDefault(); findPeople('customer')"><input type="search" dir="auto" [class]="cls.input" [attr.aria-label]="'AdminCleanup.searchPeople' | t" [placeholder]="'AdminCleanup.searchPeople' | t" [(ngModel)]="s.customers.q" name="cq" /><button type="submit" [class]="cls.btn2">{{ 'AdminCleanup.search' | t }}</button></form>
                      <div class="max-h-48 overflow-auto rounded-lg border border-line">
                        @for (p of s.customers.hits; track p.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.customers.ids.includes(p.id)" (change)="flip(s.customers.ids, p.id)" /><span dir="auto">{{ p.fullName }}</span><span class="truncate text-muted" dir="ltr">{{ p.email }}</span><span class="ms-auto text-xs text-muted">{{ 'AdminCleanup.ticketsN' | t: { n: p.tickets } }}</span></label> }
                        @empty { <p class="px-3 py-2 text-sm text-muted">{{ 'AdminCleanup.searchFirst' | t }}</p> }
                      </div>
                      <p class="text-sm text-muted">{{ 'AdminCleanup.picked' | t: { n: s.customers.ids.length } }}</p>
                    </div>
                  }
                  <fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold">{{ 'AdminCleanup.withTickets' | t }}</legend>
                    <label class="flex items-start gap-2 text-sm"><input type="radio" name="cd" class="mt-1" [value]="false" [(ngModel)]="s.customers.deleteTickets" />{{ 'AdminCleanup.keepTickets' | t }}</label>
                    <label class="flex items-start gap-2 text-sm"><input type="radio" name="cd" class="mt-1" [value]="true" [(ngModel)]="s.customers.deleteTickets" />{{ 'AdminCleanup.deleteTickets' | t }}</label></fieldset>
                </div>
              }
            </div>

            <!-- Staff -->
            <div [class]="box(s.staff.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.staff.on" /><span><b class="block">{{ 'AdminCleanup.staff' | t }}</b><small class="text-muted">{{ 'AdminCleanup.staffHint' | t }}</small></span></label>
              @if (s.staff.on) {
                <div class="flex flex-col gap-2 border-t border-line pt-3">
                  <form class="flex gap-2" (submit)="$event.preventDefault(); findPeople('staff')"><input type="search" dir="auto" [class]="cls.input" [attr.aria-label]="'AdminCleanup.searchPeople' | t" [placeholder]="'AdminCleanup.searchPeople' | t" [(ngModel)]="s.staff.q" name="sq" /><button type="submit" [class]="cls.btn2">{{ 'AdminCleanup.search' | t }}</button></form>
                  <div class="max-h-48 overflow-auto rounded-lg border border-line">
                    @for (p of s.staff.hits; track p.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.staff.ids.includes(p.id)" (change)="flip(s.staff.ids, p.id)" /><span dir="auto">{{ p.fullName }}</span><span class="truncate text-muted" dir="ltr">{{ p.email }}</span>@if (p.role) { <span class="ms-auto text-xs text-muted">{{ 'AdminSla.roles.' + p.role | t }}</span> }</label> }
                    @empty { <p class="px-3 py-2 text-sm text-muted">{{ 'AdminCleanup.searchFirst' | t }}</p> }
                  </div>
                  <p class="text-sm text-muted">{{ 'AdminCleanup.picked' | t: { n: s.staff.ids.length } }} · {{ 'AdminCleanup.staffRule' | t }}</p>
                </div>
              }
            </div>

            <!-- Teams -->
            <div [class]="box(s.teams.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.teams.on" /><span><b class="block">{{ 'AdminCleanup.teams' | t }}</b><small class="text-muted">{{ 'AdminCleanup.teamsHint' | t }}</small></span></label>
              @if (s.teams.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                 
                  <div class="max-h-40 overflow-auto rounded-lg border border-line">@for (t of x.teams; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.teams.ids.includes(t.id)" (change)="flip(s.teams.ids, t.id)" />{{ name(t) }}</label> }</div>
                  <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminCleanup.moveTickets' | t }}
                    <select [class]="cls.input" [(ngModel)]="s.teams.moveTickets"><option value="">{{ 'AdminCleanup.noTeam' | t }}</option>@for (t of x.teams; track t.id) { @if (!s.teams.ids.includes(t.id)) { <option [value]="t.id">{{ name(t) }}</option> } }</select></label>
                  <label class="flex flex-col gap-1 text-sm font-semibold">{{ 'AdminCleanup.moveCategories' | t }}
                    <select [class]="cls.input" [(ngModel)]="s.teams.moveCats"><option value="">{{ 'AdminCleanup.noTeam' | t }}</option>@for (t of x.teams; track t.id) { @if (!s.teams.ids.includes(t.id)) { <option [value]="t.id">{{ name(t) }}</option> } }</select></label>
                </div>
              }
            </div>

            <!-- Organizations and branches -->
            <div [class]="box(s.places.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.places.on" /><span><b class="block">{{ 'AdminCleanup.places' | t }}</b><small class="text-muted">{{ 'AdminCleanup.placesHint' | t }}</small></span></label>
              @if (s.places.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                  <div class="max-h-56 overflow-auto rounded-lg border border-line">
                    @for (g of x.organizations; track g.id) {
                      <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm font-semibold"><input type="checkbox" [checked]="s.places.orgs.includes(g.id)" (change)="flip(s.places.orgs, g.id)" />{{ g.name }}<span class="ms-auto text-xs font-normal text-muted">{{ 'AdminCleanup.peopleN' | t: { n: g.people } }}</span></label>
                      @if (!s.places.orgs.includes(g.id)) { @for (b of g.branches; track b.id) { <label class="flex items-center gap-2 border-b border-line py-1.5 pe-3 ps-9 text-sm"><input type="checkbox" [checked]="s.places.branches.includes(b.id)" (change)="flip(s.places.branches, b.id)" />{{ b.name }}</label> } }
                    }
                  </div>
                  <fieldset class="flex flex-col gap-2"><legend class="text-sm font-semibold">{{ 'AdminCleanup.placePeople' | t }}</legend>
                    <label class="flex items-start gap-2 text-sm"><input type="radio" name="pp" class="mt-1" [value]="false" [(ngModel)]="s.places.removePeople" />{{ 'AdminCleanup.placeKeep' | t }}</label>
                    <label class="flex items-start gap-2 text-sm"><input type="radio" name="pp" class="mt-1" [value]="true" [(ngModel)]="s.places.removePeople" />{{ 'AdminCleanup.placeRemove' | t }}</label></fieldset>
                </div>
              }
            </div>

            <!-- Ticket catalog -->
            <div [class]="box(s.catalog.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.catalog.on" /><span><b class="block">{{ 'AdminCleanup.catalog' | t }}</b><small class="text-muted">{{ 'AdminCleanup.catalogHint' | t }}</small></span></label>
              @if (s.catalog.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                  @for (g of catalogGroups; track g[0]) {
                    <div><p class="mb-1 text-sm font-semibold">{{ 'AdminCleanup.cat_' + g[0] | t }}</p>
                      <div class="max-h-32 overflow-auto rounded-lg border border-line">@for (t of $any(x)[g[1]]; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="$any(s.catalog)[g[0]].includes(t.id)" (change)="flip($any(s.catalog)[g[0]], t.id)" />{{ name(t) }}@if (t.isActive === false) { <span class="text-xs text-muted">({{ 'AdminCleanup.off' | t }})</span> }</label> } @empty { <p class="px-3 py-1.5 text-sm text-muted">—</p> }</div></div>
                  }
                </div>
              }
            </div>

            <!-- Knowledge base -->
            <div [class]="box(s.kb.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.kb.on" /><span><b class="block">{{ 'AdminCleanup.kb' | t }}</b><small class="text-muted">{{ 'AdminCleanup.kbHint' | t }}</small></span></label>
              @if (s.kb.on) {
                <div class="flex flex-col gap-3 border-t border-line pt-3">
                  <div><p class="mb-1 text-sm font-semibold">{{ 'AdminCleanup.kbArticles' | t }}</p><div class="max-h-32 overflow-auto rounded-lg border border-line">@for (t of x.kbArticles; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.kb.articles.includes(t.id)" (change)="flip(s.kb.articles, t.id)" />{{ name(t) }}</label> } @empty { <p class="px-3 py-1.5 text-sm text-muted">—</p> }</div></div>
                  <div><p class="mb-1 text-sm font-semibold">{{ 'AdminCleanup.kbCategories' | t }}</p><div class="max-h-32 overflow-auto rounded-lg border border-line">@for (t of x.kbCategories; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.kb.categories.includes(t.id)" (change)="flip(s.kb.categories, t.id)" />{{ name(t) }}</label> } @empty { <p class="px-3 py-1.5 text-sm text-muted">—</p> }</div></div>
                </div>
              }
            </div>

            <!-- Canned responses -->
            <div [class]="box(s.canned.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.canned.on" /><span><b class="block">{{ 'AdminCleanup.canned' | t }}</b><small class="text-muted">{{ 'AdminCleanup.cannedHint' | t }}</small></span></label>
              @if (s.canned.on) {
                <div class="max-h-40 overflow-auto rounded-lg border border-line">@for (t of x.canned; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.canned.ids.includes(t.id)" (change)="flip(s.canned.ids, t.id)" /><span dir="auto">{{ t.name }}</span></label> } @empty { <p class="px-3 py-1.5 text-sm text-muted">—</p> }</div>
              }
            </div>

            <!-- Calendars and holidays -->
            <div [class]="box(s.calendars.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.calendars.on" /><span><b class="block">{{ 'AdminCleanup.calendars' | t }}</b><small class="text-muted">{{ 'AdminCleanup.calendarsHint' | t }}</small></span></label>
              @if (s.calendars.on) {
                <div class="flex flex-col gap-2 border-t border-line pt-3">
                  <div class="max-h-32 overflow-auto rounded-lg border border-line">@for (t of x.calendars; track t.id) { <label class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm"><input type="checkbox" [checked]="s.calendars.ids.includes(t.id)" (change)="flip(s.calendars.ids, t.id)" />{{ t.name }}</label> } @empty { <p class="px-3 py-1.5 text-sm text-muted">{{ 'AdminCleanup.noCalendars' | t }}</p> }</div>
                  <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" [(ngModel)]="s.calendars.pastHolidays" />{{ 'AdminCleanup.pastHolidays' | t }}</label>
                </div>
              }
            </div>

            <!-- Notifications and email queue -->
            <div [class]="box(s.notifications.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.notifications.on" /><span><b class="block">{{ 'AdminCleanup.notifications' | t }}</b><small class="text-muted">{{ 'AdminCleanup.notificationsHint' | t: { n: x.counts.notifications } }}</small></span></label>
              @if (s.notifications.on) {
                <label class="flex flex-col gap-1 border-t border-line pt-3 text-sm font-semibold">{{ 'AdminCleanup.olderThan' | t }}<input type="number" min="0" inputmode="numeric" [class]="cls.input + ' max-w-40'" [(ngModel)]="s.notifications.days" /></label>
              }
            </div>

            <!-- Sign-in sessions -->
            <div [class]="box(s.sessions.on)">
              <label class="flex cursor-pointer items-start gap-3"><input type="checkbox" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="s.sessions.on" /><span><b class="block">{{ 'AdminCleanup.sessions' | t }}</b><small class="text-muted">{{ 'AdminCleanup.sessionsHint' | t }}</small></span></label>
            </div>
          </div>

          <div><h3 class="font-bold">{{ 'AdminCleanup.neverTitle' | t }}</h3>
            <ul class="mt-1 grid gap-x-6 gap-y-1 text-sm text-muted sm:grid-cols-2">@for (k of ['audit', 'me', 'roles', 'settings', 'counter', 'calendar']; track k) { <li>🔒 {{ 'AdminCleanup.never_' + k | t }}</li> }</ul></div>
          <div class="flex flex-wrap items-center gap-3"><button type="button" [class]="cls.btn" [disabled]="busy() || !anyOn()" (click)="preview()">{{ 'AdminCleanup.previewButton' | t }}</button><span class="text-sm text-muted">{{ 'AdminCleanup.nothingYet' | t }}</span></div>
        </section>
      }
    }

    @if (step() === 'preview' || step() === 'confirm') {
      <section [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="pv-h">
        <div><h2 id="pv-h" class="text-lg font-bold">{{ 'AdminCleanup.previewTitle' | t }}</h2><p class="text-sm text-muted">{{ 'AdminCleanup.previewIntro' | t }}</p></div>
        @if (lines().length) {
          <ul class="list-disc ps-5">@for (l of lines(); track l.key) { <li><span class="font-semibold" [class]="l.tone">{{ 'AdminCleanup.verb_' + l.verb | t }}</span> {{ 'AdminCleanup.c_' + l.key | t: { n: l.n, size: size() } }}</li> }</ul>
        } @else { <p class="rounded-lg bg-bg px-3 py-2 text-sm">{{ 'AdminCleanup.nothingMatches' | t }}</p> }
        @if (step() === 'preview') {
          <div class="flex flex-wrap gap-3"><button type="button" [class]="cls.btn2" (click)="step.set('choose')">{{ 'AdminCleanup.back' | t }}</button>
            @if (lines().length) { <button type="button" [class]="cls.btn" (click)="step.set('confirm')">{{ 'AdminCleanup.continue' | t }}</button> }</div>
        }
      </section>
    }

    @if (step() === 'confirm') {
      <form [class]="cls.card + ' flex flex-col gap-4 p-5'" aria-labelledby="cf-h" novalidate (ngSubmit)="run()">
        <h2 id="cf-h" class="text-lg font-bold">{{ 'AdminCleanup.confirmTitle' | t }}</h2>
        <p class="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{{ 'AdminCleanup.confirmWarn' | t }}</p>
        <label class="flex items-start gap-2"><input type="checkbox" name="bk" class="mt-1 h-5 w-5 shrink-0" [(ngModel)]="backup" /><span>{{ 'AdminCleanup.backupCheck' | t }}<app-req /></span></label>
        <div class="flex flex-col gap-1.5"><label for="cu-word" [class]="cls.label">{{ 'AdminHandover.typeToConfirm' | t: { word: 'DELETE' } }}<app-req /></label>
          <input id="cu-word" name="word" dir="ltr" autocomplete="off" [class]="cls.input + ' max-w-xs'" [(ngModel)]="word" /></div>
        <div class="flex flex-wrap items-center gap-3"><button type="button" [class]="cls.btn2" (click)="step.set('preview')">{{ 'AdminCleanup.back' | t }}</button>
          <button type="submit" class="min-h-11 cursor-pointer rounded-lg bg-danger px-5 font-semibold text-white disabled:opacity-60" [disabled]="busy() || !backup || word.trim().toUpperCase() !== 'DELETE'">{{ 'AdminCleanup.runButton' | t }}</button><app-req-note /></div>
      </form>
    }

    @if (step() === 'done') {
      <section [class]="cls.card + ' flex flex-col gap-3 p-5'">
        <p role="status" class="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok"><b>{{ 'AdminCleanup.doneTitle' | t }}</b> {{ 'AdminCleanup.doneText' | t }}</p>
        <ul class="list-disc ps-5">@for (l of lines(); track l.key) { <li><span class="font-semibold" [class]="l.tone">{{ 'AdminCleanup.done_' + l.verb | t }}</span> {{ 'AdminCleanup.c_' + l.key | t: { n: l.n, size: size() } }}</li> }</ul>
        <div><button type="button" [class]="cls.btn2" (click)="restart()">{{ 'AdminCleanup.again' | t }}</button></div>
      </section>
    }`,
  host: { class: 'flex flex-col gap-6' },
  changeDetection: ChangeDetectionStrategy.Default,
})
export class CleanupTab implements OnInit {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly cls = CLS;
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);
  protected readonly o = signal<Options | null>(null);
  protected readonly step = signal<'choose' | 'preview' | 'confirm' | 'done'>('choose');
  protected readonly counts = signal<Counts>({});
  protected s = blank();
  protected backup = false;
  protected word = '';
  protected readonly catalogGroups = [['types', 'types'], ['categories', 'categories'], ['subcategories', 'subcategories'], ['fields', 'fields']] as const;

  protected readonly lines = computed(() => {
    const c = this.counts();
    return LINES.filter(([k]) => (c[k] ?? 0) > 0).map(([key, verb]) => ({ key, verb, tone: TONE[verb], n: c[key] }));
  });
  protected readonly size = computed(() => {
    const b = this.counts()['fileBytes'] ?? 0;
    return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  });

  async ngOnInit(): Promise<void> { await this.load(); }
  private async load(): Promise<void> {
    try { this.o.set(await firstValueFrom(this.http.get<Options>('/api/admin/settings/cleanup'))); } catch (e) { this.fail(e); }
  }
  protected box(on: boolean): string {
    return 'flex flex-col gap-3 rounded-lg border p-4 ' + (on ? 'border-brand bg-surface ring-2 ring-brand-soft' : 'border-line bg-surface');
  }
  protected name(t: Named): string { return t.name ?? this.i18n.pick(t.nameEn ?? '', t.nameAr ?? ''); }
  protected flip(list: string[], id: string): void { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); }
  protected anyOn(): boolean { return Object.values(this.s).some((p) => (p as { on: boolean }).on); }

  protected async findTickets(): Promise<void> {
    try { this.s.tickets.hits = await firstValueFrom(this.http.get<TicketHit[]>('/api/admin/settings/cleanup/tickets', { params: { q: this.s.tickets.q } })); } catch (e) { this.fail(e); }
  }
  protected async findPeople(kind: 'customer' | 'staff'): Promise<void> {
    const part = kind === 'staff' ? this.s.staff : this.s.customers;
    try { part.hits = await firstValueFrom(this.http.get<Person[]>('/api/admin/settings/cleanup/people', { params: { kind, q: part.q } })); } catch (e) { this.fail(e); }
  }

  /** The request the API expects; switched-off parts are left out. */
  private request() {
    const s = this.s;
    const ids = (on: boolean, list: string[]) => (on && list.length ? list : null);
    return {
      tickets: s.tickets.on ? (s.tickets.mode === 'pick'
        ? { mode: 'pick', ids: s.tickets.ids }
        : { mode: 'filter', status: s.tickets.status, createdBefore: s.tickets.before || null, organizationId: s.tickets.org || null }) : null,
      customers: s.customers.on ? { allMatching: s.customers.all, status: s.customers.status, ids: s.customers.all ? null : s.customers.ids, deleteTickets: s.customers.deleteTickets } : null,
      staffIds: ids(s.staff.on, s.staff.ids),
      teams: s.teams.on && s.teams.ids.length ? { ids: s.teams.ids, moveTicketsTo: s.teams.moveTickets || null, moveCategoriesTo: s.teams.moveCats || null } : null,
      places: s.places.on ? { organizationIds: s.places.orgs, branchIds: s.places.branches, removePeople: s.places.removePeople } : null,
      catalog: s.catalog.on ? { typeIds: s.catalog.types, categoryIds: s.catalog.categories, subcategoryIds: s.catalog.subcategories, fieldIds: s.catalog.fields } : null,
      kbArticleIds: ids(s.kb.on, s.kb.articles), kbCategoryIds: ids(s.kb.on, s.kb.categories), cannedIds: ids(s.canned.on, s.canned.ids),
      calendars: s.calendars.on ? { ids: s.calendars.ids, pastHolidays: s.calendars.pastHolidays } : null,
      notificationsOlderThanDays: s.notifications.on ? Math.max(0, Number(s.notifications.days) || 0) : null,
      sessions: s.sessions.on,
    };
  }

  protected async preview(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ counts: Counts }>('/api/admin/settings/cleanup/preview', this.request()));
      this.counts.set(r.counts); this.backup = false; this.word = ''; this.step.set('preview');
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }
  protected async run(): Promise<void> {
    if (!this.backup || this.word.trim().toUpperCase() !== 'DELETE') return;
    this.busy.set(true); this.msg.set(null);
    try {
      const r = await firstValueFrom(this.http.post<{ counts: Counts }>('/api/admin/settings/cleanup/run', { request: this.request(), confirm: this.word, backupConfirmed: this.backup }));
      this.counts.set(r.counts); this.step.set('done');
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }
  protected async restart(): Promise<void> { this.s = blank(); this.counts.set({}); this.step.set('choose'); await this.load(); }
  private fail(e: unknown): void { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
}
