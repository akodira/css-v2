import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TicketSummary } from '../core/api';
import { TPipe } from '../core/i18n';

/**
 * The customer's ticket counters (Home and My tickets), in the same style as the staff dashboard cards:
 * colored start border, tinted background, round icon, big number. "total" is every ticket; the rest are the lists.
 */
export const CUSTOMER_KPI = {
  total: { path: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z', box: 'border-s-brand bg-brand-soft', ink: 'text-brand-ink' },
  active: { path: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', box: 'border-s-amber-500 bg-warn-soft', ink: 'text-warn-ink' },
  waiting: { path: 'M4 4h16v16H4zM4 7l8 6 8-6', box: 'border-s-danger bg-danger-soft', ink: 'text-danger' },
  resolved: { path: 'M20 6 9 17l-5-5', box: 'border-s-ok bg-ok-soft', ink: 'text-ok' },
  closed: { path: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4', box: 'border-s-slate-400 bg-slate-100', ink: 'text-slate-700' },
} as const;
export type CustomerKpi = keyof typeof CUSTOMER_KPI;

@Component({
  selector: 'app-customer-kpis',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      @for (k of keys; track k) {
        <li>
          <button type="button" (click)="pick.emit(k)" [attr.aria-pressed]="selected() === undefined ? null : k === selected()"
            class="flex h-full w-full cursor-pointer flex-col items-center gap-2 rounded-md border border-line border-s-4 p-4 text-center hover:brightness-95"
            [class]="kpi[k].box + (k === selected() ? ' ring-2 ring-current ' + kpi[k].ink : '')">
            <span aria-hidden="true" class="flex h-12 w-12 items-center justify-center rounded-full bg-surface" [class]="kpi[k].ink">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="kpi[k].path" /></svg></span>
            <span class="text-4xl font-bold leading-none" [class]="kpi[k].ink">{{ counts() ? $any(counts())[k] ?? 0 : '…' }}</span>
            <span class="text-sm font-semibold" [class]="kpi[k].ink">{{ labels() + k | t }}</span>
          </button>
        </li>
      }
    </ul>`,
})
export class CustomerKpis {
  readonly counts = input<TicketSummary | null>(null);
  /** The list shown below (My tickets); leave unset on Home. */
  readonly selected = input<string>();
  readonly pick = output<CustomerKpi>();
  /** Where the card names come from: the customer's words, or the staff's ("Waiting for customer"). */
  readonly labels = input('Tickets.summary.');
  protected readonly kpi = CUSTOMER_KPI;
  protected readonly keys = Object.keys(CUSTOMER_KPI) as CustomerKpi[];
}
