import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TPipe } from '../core/i18n';

/**
 * Eye button for a password box: shows or hides what was typed. Put the input (type="password", class "pe-11")
 * and this button in a "relative" wrapper: <input #pw type="password" ...><app-pw-eye [target]="pw" />
 */
@Component({
  selector: 'app-pw-eye',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-y-0 end-0 flex' },
  template: `
    <button type="button" (click)="toggle()" [attr.aria-pressed]="shown()" [attr.aria-label]="(shown() ? 'Auth.password.hide' : 'Auth.password.show') | t"
      [title]="(shown() ? 'Auth.password.hide' : 'Auth.password.show') | t"
      class="flex w-11 cursor-pointer items-center justify-center rounded-lg text-ink hover:text-brand">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />@if (shown()) { <path d="M3 3l18 18" /> }
      </svg>
    </button>`,
})
export class PwEye {
  readonly target = input.required<HTMLInputElement>();
  protected readonly shown = signal(false);
  protected toggle(): void { this.shown.update((v) => !v); this.target().type = this.shown() ? 'text' : 'password'; }
}
