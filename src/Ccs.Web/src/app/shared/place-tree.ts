import { ChangeDetectionStrategy, Component, WritableSignal, computed, input, model, signal } from '@angular/core';
import { TPipe } from '../core/i18n';

export interface TreeOrg { id: string; name: string; sub?: string | null }
export interface TreeBranch { id: string; organizationId: string; name: string; sub?: string | null }
export interface TreeBadge { text: string; cls: string }
export type TreePick = { kind: 'all' | 'org' | 'br'; id: string };

export const ORG_ICON = 'M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18 M6 12H3v10h3 M18 9h3v13h-3 M10 7h4 M10 11h4 M10 15h4 M10 22v-3h4v3';
export const BRANCH_ICON = 'M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z M12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5';
export const ALL_ICON = 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0 M3 12h18 M12 3c3 3.2 3 14.8 0 18 M12 3c-3 3.2-3 14.8 0 18';

/** Icon tile for an organization (building), a branch (map pin) or "everyone" (globe). */
@Component({
  selector: 'app-place-icon',
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    [class]="kind() === 'br' ? 'size-7 shrink-0 rounded-md bg-ok-soft stroke-ok p-1' : kind() === 'all' ? 'size-8 shrink-0 rounded-lg bg-ink stroke-white p-1.5' : 'size-8 shrink-0 rounded-lg bg-brand-soft stroke-brand-ink p-1.5'">
    <path [attr.d]="kind() === 'br' ? branch : kind() === 'all' ? all : org" /></svg>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceIcon {
  readonly kind = input<'org' | 'br' | 'all'>('org');
  protected readonly org = ORG_ICON;
  protected readonly branch = BRANCH_ICON;
  protected readonly all = ALL_ICON;
}

/**
 * Organizations with their branches, for settings that apply per place (escalation, reassign tickets).
 * Click a name to select it; tick boxes to change several at once. Ticking an organization ticks all its
 * branches, and any branch can then be unticked on its own.
 */
@Component({
  selector: 'app-place-tree',
  imports: [TPipe, PlaceIcon],
  template: `
    <input type="search" dir="auto" [value]="q()" (input)="q.set($any($event.target).value)" [placeholder]="'PlaceTree.search' | t" [attr.aria-label]="'PlaceTree.search' | t"
      class="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" />
    <ul class="mt-3 flex max-h-[32rem] flex-col gap-0.5 overflow-y-auto rounded-lg border border-line bg-surface p-1.5" [attr.aria-label]="'PlaceTree.label' | t">
      @if (defaultLabel()) {
        <li>
          <button type="button" (click)="selected.set({ kind: 'all', id: 'all' })" [attr.aria-current]="isSel('all', 'all') ? 'true' : null"
            class="flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-start text-sm hover:bg-bg"
            [class]="isSel('all', 'all') ? 'bg-brand-soft outline-2 outline-brand' : ''">
            <span class="w-14 shrink-0"></span><app-place-icon kind="all" />
            <span class="min-w-0 flex-1"><b class="block">{{ defaultLabel() }}</b>@if (defaultSub()) { <span class="block text-xs text-muted">{{ defaultSub() }}</span> }</span>
            @if (badgeFn()('all', 'all'); as bd) { <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" [class]="bd.cls">{{ bd.text }}</span> }
          </button>
        </li>
      }
      @for (o of shown(); track o.id) {
        @let kids = kidsOf(o.id);
        @let isOpen = open().includes(o.id) || (needle() !== '' && kidMatch(o.id));
        <li>
          <div class="flex min-h-12 items-center gap-2 rounded-lg px-2 text-sm hover:bg-bg" [class]="isSel('org', o.id) ? 'bg-brand-soft outline-2 outline-brand' : ''">
            @if (kids.length) {
              <button type="button" class="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-muted hover:bg-line/40" [attr.aria-expanded]="isOpen"
                [attr.aria-label]="'PlaceTree.showBranches' | t: { name: o.name }" (click)="flip(open, o.id)"><span aria-hidden="true" class="rtl:-scale-x-100">{{ isOpen ? '▾' : '▸' }}</span></button>
            } @else { <span class="w-7 shrink-0"></span> }
            <input type="checkbox" class="h-5 w-5 shrink-0 cursor-pointer" [checked]="tickedOrgs().includes(o.id)" [indeterminate]="partly(o.id)"
              [attr.aria-label]="'PlaceTree.tickOrg' | t: { name: o.name }" (change)="tickOrg(o.id, $any($event.target).checked)" />
            <button type="button" (click)="selected.set({ kind: 'org', id: o.id })" [attr.aria-current]="isSel('org', o.id) ? 'true' : null"
              class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-start">
              <app-place-icon kind="org" />
              <span class="min-w-0 flex-1"><b class="block truncate" dir="auto">{{ o.name }}</b>
                <span class="block truncate text-xs text-muted">@if (o.sub) { <bdi>{{ o.sub }}</bdi> · }{{ 'PlaceTree.branchesN' | t: { n: kids.length } }}</span></span>
              @if (badgeFn()('org', o.id); as bd) { <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" [class]="bd.cls">{{ bd.text }}</span> }
            </button>
          </div>
          @if (isOpen && kids.length) {
            <ul class="ms-9 border-s border-line ps-2">
              @for (b of kids; track b.id) {
                @if (!needle() || o.name.toLowerCase().includes(needle()) || b.name.toLowerCase().includes(needle())) {
                  <li class="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-bg" [class]="isSel('br', b.id) ? 'bg-brand-soft outline-2 outline-brand' : ''">
                    <input type="checkbox" class="h-5 w-5 shrink-0 cursor-pointer" [checked]="tickedBranches().includes(b.id)"
                      [attr.aria-label]="'PlaceTree.tickBranch' | t: { name: b.name }" (change)="tickBranch(b.id, $any($event.target).checked)" />
                    <button type="button" (click)="selected.set({ kind: 'br', id: b.id })" [attr.aria-current]="isSel('br', b.id) ? 'true' : null"
                      class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-start">
                      <app-place-icon kind="br" />
                      <span class="min-w-0 flex-1"><span class="block truncate font-medium" dir="auto">{{ b.name }}</span>@if (b.sub) { <span class="block truncate text-xs text-muted" dir="auto">{{ b.sub }}</span> }</span>
                      @if (badgeFn()('br', b.id); as bd) { <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" [class]="bd.cls">{{ bd.text }}</span> }
                    </button>
                  </li>
                }
              }
            </ul>
          }
        </li>
      } @empty { <li class="p-3 text-sm text-muted">{{ 'PlaceTree.none' | t }}</li> }
    </ul>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceTree {
  readonly orgs = input<TreeOrg[]>([]);
  readonly branches = input<TreeBranch[]>([]);
  readonly badgeFn = input<(kind: 'all' | 'org' | 'br', id: string) => TreeBadge | null>(() => null);
  readonly defaultLabel = input<string | null>(null);
  readonly defaultSub = input<string | null>(null);
  readonly selected = model<TreePick | null>(null);
  readonly tickedOrgs = model<string[]>([]);
  readonly tickedBranches = model<string[]>([]);

  protected readonly q = signal('');
  protected readonly open = signal<string[]>([]);
  protected readonly needle = computed(() => this.q().trim().toLowerCase());
  protected readonly sorted = computed(() => [...this.orgs()].sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly shown = computed(() => this.sorted().filter((o) => !this.needle() || o.name.toLowerCase().includes(this.needle()) || this.kidMatch(o.id)));

  protected kidsOf(org: string): TreeBranch[] { return this.branches().filter((b) => b.organizationId === org).sort((a, b) => a.name.localeCompare(b.name)); }
  protected kidMatch(org: string): boolean { return this.kidsOf(org).some((b) => b.name.toLowerCase().includes(this.needle())); }
  protected isSel(kind: string, id: string): boolean { const s = this.selected(); return !!s && s.kind === kind && s.id === id; }
  protected flip(sig: WritableSignal<string[]>, id: string): void { sig.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  /** Ticked organization with only some of its branches ticked: a part-filled box. */
  protected partly(org: string): boolean {
    const kids = this.kidsOf(org); const n = kids.filter((b) => this.tickedBranches().includes(b.id)).length;
    return this.tickedOrgs().includes(org) && n > 0 && n < kids.length;
  }
  protected tickOrg(org: string, on: boolean): void {
    const kids = this.kidsOf(org).map((b) => b.id);
    this.tickedOrgs.update((l) => (on ? [...new Set([...l, org])] : l.filter((x) => x !== org)));
    this.tickedBranches.update((l) => (on ? [...new Set([...l, ...kids])] : l.filter((x) => !kids.includes(x))));
    if (on && kids.length && !this.open().includes(org)) this.open.update((l) => [...l, org]);
  }
  protected tickBranch(id: string, on: boolean): void { this.tickedBranches.update((l) => (on ? [...new Set([...l, id])] : l.filter((x) => x !== id))); }
}
