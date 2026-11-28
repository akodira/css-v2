import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { adminError } from '../core/admin-api';
import { I18n, TPipe } from '../core/i18n';
import { Alert } from './ui';

/**
 * "Ask everyone for a new password": everyone on the Staff or Customers list (never the person doing it) is signed out
 * and must set a new password at the next sign-in, using a code sent by email. Nobody sees anyone's password.
 */
@Component({
  selector: 'app-bulk-password-reset',
  imports: [TPipe, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-end gap-3">
      @if (!asking()) {
        <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-bg disabled:opacity-60"
          [disabled]="busy()" (click)="asking.set(true); result.set(null)">{{ 'BulkPw.button' | t }}</button>
      } @else {
        <div role="alertdialog" [attr.aria-label]="'BulkPw.q.' + kind() | t" class="flex w-full flex-col gap-3 rounded-md border border-danger bg-danger-soft p-4">
          <p class="font-semibold text-danger">{{ 'BulkPw.q.' + kind() | t }}</p>
          <p class="text-sm">{{ 'BulkPw.hint' | t }}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-danger bg-surface px-4 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60"
              [disabled]="busy()" (click)="run()">{{ 'BulkPw.yes' | t }}</button>
            <button type="button" class="min-h-11 cursor-pointer rounded-lg border border-line bg-surface px-4 font-semibold hover:bg-bg" [disabled]="busy()" (click)="asking.set(false)">{{ 'AdminCommon.cancel' | t }}</button>
          </div>
        </div>
      }
      @if (result(); as r) { <div class="w-full"><app-alert [tone]="r.tone">{{ r.text }}</app-alert></div> }
    </div>`,
})
export class BulkPasswordReset {
  private readonly http = inject(HttpClient);
  private readonly i18n = inject(I18n);
  readonly kind = input.required<'staff' | 'customers'>();
  /** Scoped admins use the People address (only the staff they manage). */
  readonly url = input('/api/admin/users/bulk-password-reset');
  protected readonly asking = signal(false);
  protected readonly busy = signal(false);
  protected readonly result = signal<{ tone: 'success' | 'error'; text: string } | null>(null);

  protected async run(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.post<{ count: number }>(this.url(), { kind: this.kind() }));
      this.result.set({ tone: 'success', text: this.i18n.t('BulkPw.done', { n: r.count }) });
      this.asking.set(false);
    } catch (e) {
      this.result.set({ tone: 'error', text: adminError(this.i18n, e) });
    } finally {
      this.busy.set(false);
    }
  }
}
