import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, WritableSignal, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Lookups, adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert } from '../../shared/ui';

type Msg = { tone: 'success' | 'error'; text: string } | null;
interface Where { scopeLevel: string | null; placements: { organizationId: string; branchId: string | null }[]; scopes: { organizationId: string; branchId: string | null }[] }

/**
 * Main Administrator, on a staff member (same as v1 PlacementEditor / ScopeEditor):
 * a scoped admin gets "Organizations / Branches this person manages"; anyone else gets "Works in".
 */
@Component({
  selector: 'app-where-editor',
  imports: [TPipe, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (w(); as w) {
      <div class="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        @if (w.scopeLevel) {
          <p class="text-sm font-semibold">{{ (w.scopeLevel === 'organization' ? 'Promote.scopeOrgs' : 'Promote.scopeBranches') | t }}</p>
          <p class="text-sm text-muted">{{ (picked().length === 0 ? 'Promote.scopeNone' : 'Promote.scopeHint') | t }}</p>
          <ul class="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            @for (r of scopeRows(); track r.id) {
              <li><label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" [checked]="picked().includes(r.id)" (change)="flip(picked, r.id)" /><span dir="auto">{{ r.label }}</span></label></li>
            }
          </ul>
          @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
          <div><button type="button" [class]="btn" [disabled]="busy()" (click)="saveScope()">{{ 'Promote.scopeSave' | t }}</button></div>
        } @else {
          <p class="text-sm font-semibold">{{ 'Promote.placementTitle' | t }}</p>
          <p class="text-sm text-muted">{{ (os().length ? 'Promote.placementHint' : 'Promote.placementNone') | t }}</p>
          <div class="flex flex-wrap items-center gap-3">
            <input type="search" dir="auto" [placeholder]="'Promote.placementSearch' | t" [attr.aria-label]="'Promote.placementSearch' | t"
              class="min-h-11 w-full max-w-xs rounded-lg border border-line bg-surface px-3 text-base" [value]="q()" (input)="q.set($any($event.target).value)" />
            <span class="text-sm text-muted">{{ 'Promote.placementCount' | t: { n: os().length } }}</span>
            @if (os().length) { <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line px-3 text-sm font-semibold hover:bg-bg" (click)="os.set([]); bs.set([])">{{ 'Promote.placementClear' | t }}</button> }
          </div>
          <ul class="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
            @for (o of shownOrgs(); track o.id) {
              <li>
                <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold hover:bg-bg">
                  <input type="checkbox" class="h-5 w-5" [checked]="os().includes(o.id)" (change)="flipOrg(o.id)" /><span dir="auto">{{ o.name }}</span>
                </label>
                @if (os().includes(o.id) && branchesOf(o.id).length) {
                  <div class="ms-7 mb-1 border-s-2 border-line ps-3">
                    <p class="text-xs text-muted">{{ (hasBranchIn(o.id) ? 'Promote.placementBranchesSome' : 'Promote.placementBranchesAll') | t }}</p>
                    <ul class="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      @for (b of branchesOf(o.id); track b.id) {
                        <li><label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" class="h-5 w-5" [checked]="bs().includes(b.id)" (change)="flip(bs, b.id)" /><span dir="auto">{{ b.name }}</span></label></li>
                      }
                    </ul>
                  </div>
                }
              </li>
            }
          </ul>
          @if (msg(); as m) { <app-alert [tone]="m.tone">{{ m.text }}</app-alert> }
          <div><button type="button" [class]="btn" [disabled]="busy()" (click)="savePlacement()">{{ 'Promote.placementSave' | t }}</button></div>
        }
      </div>
    }`,
})
export class WhereEditor implements OnInit {
  private readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  readonly userId = input.required<string>();
  readonly lk = input<Lookups | null>(null);
  protected readonly btn = 'min-h-11 cursor-pointer rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-ink disabled:cursor-wait disabled:opacity-60';
  protected readonly w = signal<Where | null>(null);
  protected readonly os = signal<string[]>([]);
  protected readonly bs = signal<string[]>([]);
  protected readonly picked = signal<string[]>([]);
  protected readonly q = signal('');
  protected readonly busy = signal(false);
  protected readonly msg = signal<Msg>(null);

  protected readonly shownOrgs = computed(() => (this.lk()?.orgs ?? []).filter((o) => o.name.toLowerCase().includes(this.q().trim().toLowerCase())));
  protected readonly scopeRows = computed(() => {
    const orgs = this.lk()?.orgs ?? [];
    if (this.w()?.scopeLevel === 'organization') return orgs.map((o) => ({ id: o.id, label: o.name }));
    const name = new Map(orgs.map((o) => [o.id, o.name]));
    return (this.lk()?.branches ?? []).map((b) => ({ id: b.id, label: `${name.get(b.organizationId) ?? '?'} · ${b.name}` }));
  });

  async ngOnInit(): Promise<void> {
    const w = await firstValueFrom(this.http.get<Where>(`/api/admin/users/${this.userId()}/where`));
    this.os.set([...new Set(w.placements.map((p) => p.organizationId))]);
    this.bs.set(w.placements.filter((p) => p.branchId).map((p) => p.branchId!));
    this.picked.set(w.scopeLevel === 'organization' ? w.scopes.filter((s) => !s.branchId).map((s) => s.organizationId) : w.scopes.filter((s) => s.branchId).map((s) => s.branchId!));
    this.w.set(w);
  }
  protected branchesOf(org: string) { return (this.lk()?.branches ?? []).filter((b) => b.organizationId === org); }
  protected hasBranchIn(org: string): boolean { return this.branchesOf(org).some((b) => this.bs().includes(b.id)); }
  protected flip(s: WritableSignal<string[]>, id: string): void { s.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); }
  protected flipOrg(id: string): void {
    if (this.os().includes(id)) { const mine = this.branchesOf(id).map((b) => b.id); this.bs.update((l) => l.filter((x) => !mine.includes(x))); }
    this.flip(this.os, id);
  }
  private async run(url: string, body: unknown): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try { await firstValueFrom(this.http.put(url, body)); this.msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') }); }
    catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
  protected savePlacement(): void { void this.run(`/api/admin/users/${this.userId()}/placements`, { orgs: this.os(), branches: this.bs() }); }
  protected saveScope(): void {
    const level = this.w()?.scopeLevel;
    void this.run(`/api/admin/users/${this.userId()}/scope`, level === 'organization' ? { orgs: this.picked(), branches: [] } : { orgs: [], branches: this.picked() });
  }
}
