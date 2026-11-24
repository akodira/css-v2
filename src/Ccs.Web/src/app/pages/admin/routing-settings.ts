import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../../core/admin-api';
import { I18n, TPipe } from '../../core/i18n';
import { Alert } from '../../shared/ui';
import { CLS, Msg } from './admin-pages';

interface Routing { useOrganization: boolean; useCentral: boolean; notify: 'org' | 'sys'; method: string; multiPlace: boolean }

/** Settings → System → Ticket routing: where a ticket goes when a place has no team, and how teams give out tickets. */
@Component({
  selector: 'app-routing-settings',
  imports: [FormsModule, TPipe, Alert, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (m(); as r) {
    <form [class]="cls.card + ' flex flex-col gap-4 p-5'" (ngSubmit)="save()">
      <div><h3 class="text-lg font-bold">{{ 'Routing.title' | t }}</h3><p class="text-sm text-muted">{{ 'Routing.help' | t }}
        <a [routerLink]="'/' + i18n.locale() + '/admin/teams'" class="font-semibold text-brand-ink underline">{{ 'TeamPlace.teamsLink' | t }}</a></p></div>

      <fieldset class="flex flex-col gap-2"><legend class="mb-1 font-semibold">{{ 'Routing.noTeamTitle' | t }}</legend>
        <label class="flex items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" name="org" class="mt-1 h-5 w-5" [ngModel]="r.useOrganization" (ngModelChange)="set({ useOrganization: $event })" />
          <span><b>{{ 'Routing.useOrg' | t }}</b><span class="block text-sm text-muted">{{ 'Routing.useOrgHelp' | t }}</span></span></label>
        <label class="flex items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" name="central" class="mt-1 h-5 w-5" [ngModel]="r.useCentral" (ngModelChange)="set({ useCentral: $event })" />
          <span><b>{{ 'Routing.useCentral' | t }}</b><span class="block text-sm text-muted">{{ 'Routing.useCentralHelp' | t }}</span></span></label>
        <div class="rounded-lg border border-line p-3"><b>{{ 'Routing.notify' | t }}</b>
          <div class="mt-1 flex flex-wrap gap-x-6">
            <label class="flex min-h-10 items-center gap-2"><input type="radio" name="notify" value="org" class="h-5 w-5" [ngModel]="r.notify" (ngModelChange)="set({ notify: $event })" />{{ 'Routing.notifyOrg' | t }}</label>
            <label class="flex min-h-10 items-center gap-2"><input type="radio" name="notify" value="sys" class="h-5 w-5" [ngModel]="r.notify" (ngModelChange)="set({ notify: $event })" />{{ 'Routing.notifySys' | t }}</label>
          </div></div>
      </fieldset>

      <fieldset class="flex flex-col gap-2"><legend class="mb-1 font-semibold">{{ 'Routing.methodTitle' | t }}</legend>
        <p class="text-sm text-muted">{{ 'Routing.methodHelp' | t }}</p>
        @for (k of methods; track k) {
          <label class="flex items-start gap-3 rounded-lg border p-3" [class]="r.method === k ? 'border-brand bg-brand-soft' : 'border-line'">
            <input type="radio" name="method" class="mt-1 h-5 w-5" [value]="k" [ngModel]="r.method" (ngModelChange)="set({ method: $event })" />
            <span><b>{{ 'TeamPlace.method_' + k | t }}</b><span class="block text-sm text-muted">{{ 'TeamPlace.methodHelp_' + k | t }}</span></span></label>
        }
      </fieldset>

      <label class="flex items-start gap-3 rounded-lg border border-line p-3"><input type="checkbox" name="multi" class="mt-1 h-5 w-5" [ngModel]="r.multiPlace" (ngModelChange)="set({ multiPlace: $event })" />
        <span><b>{{ 'Routing.multi' | t }}</b><span class="block text-sm text-muted">{{ 'Routing.multiHelp' | t }}</span></span></label>

      @if (msg(); as x) { <app-alert [tone]="x.tone">{{ x.text }}</app-alert> }
      <div><button type="submit" [class]="cls.btn" [disabled]="busy()">{{ 'AdminCommon.save' | t }}</button></div>
    </form>
    }`,
})
export class RoutingSettings implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly i18n = inject(I18n);
  protected readonly cls = CLS;
  protected readonly methods = ['fewest', 'turns', 'shared', 'leader'];
  protected readonly m = signal<Routing | null>(null);
  protected readonly msg = signal<Msg>(null);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> { this.m.set(await firstValueFrom(this.http.get<Routing>('/api/admin/settings/routing'))); }
  protected set(p: Partial<Routing>): void { this.m.update((r) => (r ? { ...r, ...p } : r)); }
  protected async save(): Promise<void> {
    this.busy.set(true); this.msg.set(null);
    try { await firstValueFrom(this.http.put('/api/admin/settings/routing', this.m())); this.msg.set({ tone: 'success', text: this.i18n.t('AdminCommon.saved') }); }
    catch (e) { this.msg.set({ tone: 'error', text: adminError(this.i18n, e) }); }
    finally { this.busy.set(false); }
  }
}
