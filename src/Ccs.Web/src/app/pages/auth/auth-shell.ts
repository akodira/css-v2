import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SiteService } from '../../core/api';
import { I18n } from '../../core/i18n';
import { AuthArt } from '../../shared/auth-art';
import { AUTH_FRAME } from '../../shared/ui';

/** The wide logo (Settings → Branding) centred above the classic sign-in cards, only when "Show above the sign-in forms" is on. */
@Component({
  selector: 'app-auth-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (site.info()?.site?.authLogo && site.wordmarkUrl(); as src) { <div class="mx-auto mb-6 flex max-w-md justify-center"><img [src]="src" [alt]="name()" class="h-12 w-auto max-w-[16rem] object-contain" /></div> }`,
})
export class AuthLogo {
  protected readonly site = inject(SiteService);
  private readonly i18n = inject(I18n);
  protected readonly name = computed(() => this.i18n.pick(this.site.info()?.site?.siteNameEn ?? '', this.site.info()?.site?.siteNameAr ?? ''));
}

/**
 * Frame of every sign-in page (sign in, code, two-step, create account, forgot / new password).
 * New look (Settings → Branding → Home and sign-in look): the picture panel with the logo and two lines on one side,
 * the card on the other; on phones the panel becomes a slim logo strip. Classic look: the earlier centred card.
 * The page's card goes inside (one ng-content, so the same markup serves both looks).
 */
@Component({
  selector: 'app-auth-shell',
  imports: [AuthArt, AuthLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  providers: [{ provide: AUTH_FRAME, useValue: true }],
  template: `
    <div [class]="nl() ? 'grid min-h-dvh lg:grid-cols-[1.05fr_1fr]' : ''">
      @if (nl()) {
        <aside class="relative hidden overflow-hidden lg:block" aria-hidden="true">
          @if (site.signinPictureUrl(); as pic) { <img [src]="pic" alt="" class="absolute inset-0 h-full w-full object-cover" /> } @else { <app-auth-art [kind]="d().picture" /> }
          <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.6)_0%,rgba(255,255,255,0)_24%)]"></div>
          <div class="absolute inset-x-8 top-7 flex items-center gap-4 text-[#0b1f4d]">
            @if (site.wordmarkUrl(); as w) { <img [src]="w" alt="" class="h-10 w-auto max-w-[12rem] object-contain" /> }
            @else if (site.logoUrl(); as l) { <img [src]="l" alt="" class="h-10 w-10 object-contain" /> }
            <div class="border-s-2 border-[#0b1f4d] ps-4 leading-tight" dir="auto"><b class="block">{{ name() }}</b><span class="text-sm text-brand-ink">{{ tag() }}</span></div>
          </div>
          @if (d().band) {
            <div class="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(11,31,77,.95),rgba(11,31,77,.6)_70%,transparent)] px-8 pb-8 pt-16 text-white" dir="auto">
              <p class="text-3xl font-bold">{{ title() }}</p><p class="mt-1 text-[#dbe6ff]">{{ sub() }}</p>
            </div>
          }
        </aside>
      }
      <div [class]="nl() ? 'flex min-w-0 flex-col bg-[linear-gradient(160deg,#f3f7fe,#e3ecfb)]' : ''">
        @if (nl()) {
          <div class="flex items-center gap-3 bg-[linear-gradient(135deg,#dfe9fc,#9dbdf2)] px-4 py-4 text-[#0b1f4d] lg:hidden">
            @if (site.wordmarkUrl(); as w) { <img [src]="w" alt="" class="h-8 w-auto max-w-[9rem] object-contain" /> }
            @else if (site.logoUrl(); as l) { <img [src]="l" alt="" class="h-8 w-8 object-contain" /> }
            <b class="min-w-0 truncate border-s-2 border-[#0b1f4d] ps-3" dir="auto">{{ name() }}</b>
          </div>
        }
        <main [class]="nl() ? 'flex flex-1 items-center justify-center px-4 py-8 sm:px-8' : 'px-4 py-12'">
          @if (!nl()) { <app-auth-logo /> }
          <div [class]="nl() ? 'w-full ' + (wide() ? 'max-w-xl' : 'max-w-md') : ''"><ng-content /></div>
        </main>
      </div>
    </div>`,
})
export class AuthShell {
  protected readonly site = inject(SiteService);
  private readonly i18n = inject(I18n);
  /** Wider card (create account: fields side by side). */
  readonly wide = input(false);
  protected readonly nl = this.site.newLook;
  protected readonly d = this.site.authDesign;
  /** The text typed for this language, else the standard wording in this language (never the other language's custom text). */
  private readonly pick = (en: string, ar: string, key: string) => ((this.i18n.locale() === 'ar' ? ar : en) || '').trim() || this.i18n.t(key);
  protected readonly name = computed(() => this.i18n.pick(this.site.info()?.site?.headerSubEn, this.site.info()?.site?.headerSubAr) || this.i18n.t('Brand.tagline'));
  protected readonly tag = computed(() => this.pick(this.d().tagEn, this.d().tagAr, 'AuthLook.tag'));
  protected readonly title = computed(() => this.pick(this.d().titleEn, this.d().titleAr, 'AuthLook.title'));
  protected readonly sub = computed(() => this.pick(this.d().subEn, this.d().subAr, 'AuthLook.sub'));
}
