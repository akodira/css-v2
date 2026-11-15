import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TPipe } from '../core/i18n';
import { SocialIcon } from './social-icons';
import { FooterConfig, SOCIAL_KINDS, SocialLinks } from '../core/api';

/** Everything the footer shows, already in the visitor's language. Empty or missing parts are not shown. */
export interface FooterModel {
  logo: string | null; logoAlt: string; about: string; socials: { kind: string; url: string }[];
  linksTitle: string; links: { id: string; label: string; href: string; newTab: boolean }[];
  contactTitle: string; email: string; phone: string; hours: string;
  copyright: string; extra: string;
}

/** Builds what the footer shows from the saved (or, in the preview, the unsaved) settings. Links are already filtered. */
export function footerModel(p: {
  cfg: FooterConfig; social: SocialLinks; logo: string | null; ar: boolean; siteName: string; standardCopyright: (name: string) => string;
  email: string; phone: string; hoursEn: string; hoursAr: string; extraEn: string; extraAr: string;
  links: { id: string; labelEn: string; labelAr: string; href: string | null; newTab: boolean; sortOrder: number; isVisible?: boolean }[];
}): FooterModel {
  const c = p.cfg, pick = (en?: string, ar?: string) => ((p.ar ? ar : en) || (p.ar ? en : ar) || '').trim();
  const own = pick(c.copyrightEn, c.copyrightAr);
  return {
    logo: c.logo ? p.logo : null, logoAlt: p.siteName,
    about: c.about ? pick(c.aboutEn, c.aboutAr) : '',
    socials: c.social ? SOCIAL_KINDS.filter((k) => p.social[k]?.on && p.social[k]?.url?.startsWith('https://')).map((k) => ({ kind: k, url: p.social[k].url })) : [],
    linksTitle: pick(c.linksTitleEn, c.linksTitleAr),
    links: c.links ? [...p.links].filter((l) => l.isVisible !== false && !!l.href).sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({ id: l.id, label: pick(l.labelEn, l.labelAr), href: l.href!, newTab: l.newTab })) : [],
    contactTitle: pick(c.contactTitleEn, c.contactTitleAr),
    email: c.contact && c.email ? p.email : '', phone: c.contact && c.phone ? p.phone : '', hours: c.contact && c.hours ? pick(p.hoursEn, p.hoursAr) : '',
    copyright: !c.copyright ? '' : own ? own.replaceAll('{year}', String(new Date().getFullYear())).replaceAll('{name}', p.siteName) : p.standardCopyright(p.siteName),
    extra: c.extra ? pick(p.extraEn, p.extraAr) : '',
  };
}

/**
 * The footer markup, used by the site footer and by the live preview under Settings → Branding → Footer,
 * so the preview always looks exactly like the real thing. <code>phone</code> forces the one-column phone layout.
 */
@Component({
  selector: 'app-footer-view',
  imports: [TPipe, RouterLink, SocialIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let m = model();
    @if (any()) {
    <footer class="border-t border-line bg-surface text-sm text-muted">
      @if (cols() > 0) {
        <div class="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-6 px-4 py-7" [class]="phone() ? '' : gridCls()">
          @if (brand()) {
            <div class="flex flex-col gap-2.5">
              @if (m.logo) { <img [src]="m.logo" [alt]="m.logoAlt" class="h-8 w-auto max-w-[14rem] self-start object-contain" /> }
              @if (m.about) { <p class="max-w-[38ch]" dir="auto">{{ m.about }}</p> }
              @if (m.socials.length) {
                <ul class="flex flex-wrap gap-2" [attr.aria-label]="'Footer.social' | t">
                  @for (s of m.socials; track s.kind) {
                    <li><a [href]="s.url" target="_blank" rel="noopener" [attr.aria-label]="'Footer.s_' + s.kind | t"
                      class="grid size-9 place-items-center rounded-full border border-line text-brand-ink hover:bg-brand-soft"><app-social-icon [kind]="s.kind" /></a></li>
                  }
                </ul>
              }
            </div>
          }
          @if (m.links.length) {
            <nav [attr.aria-label]="m.linksTitle || ('Footer.links' | t)" class="flex flex-col gap-1.5">
              @if (m.linksTitle) { <p class="font-bold text-ink" dir="auto">{{ m.linksTitle }}</p> }
              @for (l of m.links; track l.id) {
                @if (l.href.startsWith('/')) { <a [routerLink]="'/' + i18n.locale() + (l.href === '/' ? '' : l.href)" class="self-start font-semibold text-brand-ink hover:underline" dir="auto">{{ l.label }}</a> }
                @else { <a [href]="l.href" [attr.target]="l.newTab ? '_blank' : null" rel="noopener" class="self-start font-semibold text-brand-ink hover:underline" dir="auto">{{ l.label }}</a> }
              }
            </nav>
          }
          @if (contact()) {
            <div class="flex flex-col gap-1.5">
              @if (m.contactTitle) { <p class="font-bold text-ink" dir="auto">{{ m.contactTitle }}</p> }
              <ul class="flex flex-col gap-1" [attr.aria-label]="m.contactTitle || ('Footer.contact' | t)">
                @if (m.email) { <li><a [href]="'mailto:' + m.email" dir="ltr" class="inline-block font-semibold text-brand-ink hover:underline">{{ m.email }}</a></li> }
                @if (m.phone) { <li><a [href]="'tel:' + tel()" dir="ltr" class="inline-block font-semibold text-brand-ink hover:underline">{{ m.phone }}</a></li> }
                @if (m.hours) { <li dir="auto">{{ m.hours }}</li> }
              </ul>
            </div>
          }
        </div>
      }
      @if (m.copyright || m.extra) {
        <div class="mx-auto flex max-w-6xl flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-4 text-[0.82rem]" [class.border-t]="cols() > 0" [class.border-line]="cols() > 0">
          @if (m.copyright) { <p dir="auto">{{ m.copyright }}</p> }
          @if (m.extra) { <p dir="auto">{{ m.extra }}</p> }
        </div>
      }
    </footer>
    }`,
})
export class FooterView {
  protected readonly i18n = inject(I18n);
  readonly model = input.required<FooterModel>();
  readonly phone = input(false);
  protected readonly brand = computed(() => { const m = this.model(); return !!m.logo || !!m.about || m.socials.length > 0; });
  protected readonly contact = computed(() => { const m = this.model(); return !!(m.email || m.phone || m.hours); });
  protected readonly cols = computed(() => [this.brand(), this.model().links.length > 0, this.contact()].filter(Boolean).length);
  protected readonly gridCls = computed(() => (this.cols() === 3 ? 'md:grid-cols-[1.6fr_1fr_1fr]' : this.cols() === 2 ? 'md:grid-cols-[1.4fr_1fr]' : ''));
  protected readonly tel = computed(() => this.model().phone.replace(/[^+0-9]/g, ''));
  /** False when every part is off or empty: then there is no footer at all. */
  readonly any = computed(() => this.cols() > 0 || !!this.model().copyright || !!this.model().extra);
}
