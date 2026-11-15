import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Website and social media marks (24px box), used in the site footer and the footer settings. */
const PATHS: Record<string, { d: string; fill: boolean }> = {
  web: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18', fill: false },
  linkedin: { d: 'M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h4v2c.6-1.1 2-2.3 4.2-2.3C22 8.7 22 11.4 22 14v7h-4v-6c0-1.5 0-3.3-2-3.3s-2.3 1.6-2.3 3.2V21h-4z', fill: true },
  youtube: { d: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.7 2 12 2 12s0 3.3.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.5.4-4.8.4-4.8s0-3.3-.4-4.8zM10 15V9l5.2 3z', fill: true },
  facebook: { d: 'M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z', fill: true },
  x: { d: 'M4 3h4.5l4 5.6L17.3 3H20l-6.3 7.4L21 21h-4.5l-4.4-6.1L6.8 21H4l6.8-7.9z', fill: true },
};

@Component({
  selector: 'app-social-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg aria-hidden="true" viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" [attr.fill]="p().fill ? 'currentColor' : 'none'"
    [attr.stroke]="p().fill ? 'none' : 'currentColor'" stroke-width="2" stroke-linecap="round"><path [attr.d]="p().d" /></svg>`,
})
export class SocialIcon {
  readonly kind = input.required<string>();
  readonly size = input(16);
  protected p(): { d: string; fill: boolean } { return PATHS[this.kind()] ?? PATHS['web']; }
}
