import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
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
 * New look (Settings → Branding → Home and sign-in look): the picture panel on one side, topped by a white strip with the
 * logo, name and tagline; the card on the other. On phones only the white strip shows, above the card. Classic look: the earlier centred card.
 * The page's card goes inside (one ng-content, so the same markup serves both looks).
 */
@Component({
  selector: 'app-auth-shell',
  imports: [AuthArt, AuthLogo, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  providers: [{ provide: AUTH_FRAME, useValue: true }],
  template: `
    <div [class]="nl() ? 'grid min-h-dvh lg:grid-cols-[1.05fr_1fr]' : ''">
      @if (nl()) {
        <!-- Picture side: a white strip with the brand (logo, line, name and tagline in one row), the picture below it, so nothing covers the drawing. -->
        <aside class="relative hidden flex-col overflow-hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
          <!-- The brand strip opens the home page. -->
          <a [routerLink]="home()" [attr.aria-label]="homeLabel()" class="flex h-24 flex-none items-center gap-4 border-b border-line bg-surface px-10 text-[#0b1f4d] hover:bg-bg focus-visible:outline-offset-[-4px]">
            @if (site.wordmarkUrl(); as w) { <img [src]="w" alt="" class="h-10 w-auto max-w-[12rem] flex-none object-contain" /> }
            @else if (site.logoUrl(); as l) { <img [src]="l" alt="" class="h-10 w-auto flex-none object-contain" /> }
            @if (site.wordmarkUrl() || site.logoUrl()) { <span class="h-10 w-0.5 flex-none rounded bg-[#b9cff6]"></span> }
            <span class="min-w-0 leading-tight"><b class="block truncate">{{ name() }}</b><span class="block truncate text-sm text-brand-ink">{{ tag() }}</span></span>
          </a>
          <div class="relative flex-1" aria-hidden="true">
            @if (site.signinPictureUrl(); as pic) { <img [src]="pic" alt="" class="absolute inset-0 h-full w-full object-cover" /> } @else { <app-auth-art [kind]="d().picture" /> }
          </div>
          @if (d().band) {
            <div class="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(11,31,77,.95),rgba(11,31,77,.6)_70%,transparent)] px-8 pb-8 pt-16 text-white" dir="auto" aria-hidden="true">
              <p class="text-3xl font-bold">{{ title() }}</p><p class="mt-1 text-[#dbe6ff]">{{ sub() }}</p>
            </div>
          }
        </aside>
      }
      <div [class]="nl() ? 'flex min-w-0 flex-col bg-[linear-gradient(160deg,#f3f7fe,#e3ecfb)]' : ''">
        @if (nl()) {
          <!-- Phones: the same white brand strip as on the picture side. -->
          <a [routerLink]="home()" [attr.aria-label]="homeLabel()" class="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 text-[#0b1f4d] hover:bg-bg lg:hidden">
            @if (site.wordmarkUrl(); as w) { <img [src]="w" alt="" class="h-8 w-auto max-w-[8rem] flex-none object-contain" /> }
            @else if (site.logoUrl(); as l) { <img [src]="l" alt="" class="h-8 w-auto flex-none object-contain" /> }
            @if (site.wordmarkUrl() || site.logoUrl()) { <span class="h-10 w-0.5 flex-none rounded bg-[#b9cff6]"></span> }
            <span class="min-w-0 leading-tight"><b class="block truncate">{{ name() }}</b><span class="block truncate text-sm text-brand-ink">{{ tag() }}</span></span>
          </a>
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
  /** The brand strip links to the home page in the current language. */
  protected readonly home = computed(() => '/' + this.i18n.locale());
  protected readonly homeLabel = computed(() => this.name() + ' - ' + this.i18n.t('Nav.home'));
  protected readonly tag = computed(() => this.pick(this.d().tagEn, this.d().tagAr, 'AuthLook.tag'));
  protected readonly title = computed(() => this.pick(this.d().titleEn, this.d().titleAr, 'AuthLook.title'));
  protected readonly sub = computed(() => this.pick(this.d().subEn, this.d().subAr, 'AuthLook.sub'));
}
