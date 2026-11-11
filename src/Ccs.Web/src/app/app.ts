import { Component, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { I18n } from './core/i18n';
import { SiteService } from './core/api';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  host: { class: 'flex min-h-screen flex-1 flex-col' },
})
export class App {
  constructor() {
    const i18n = inject(I18n), site = inject(SiteService), title = inject(Title);
    // v1 tab title: "<site name> | <header subtitle>", in the page language.
    effect(() => {
      const s = site.info()?.site;
      const name = i18n.pick(s?.siteNameEn, s?.siteNameAr) || i18n.t('Brand.name');
      const sub = i18n.pick(s?.headerSubEn, s?.headerSubAr);
      title.setTitle(sub ? `${name} | ${sub}` : name);
    });
  }
}
