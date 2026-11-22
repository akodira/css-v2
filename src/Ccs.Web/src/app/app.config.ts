import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { NavigationError, provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler } from '@angular/router';
import { routes } from './app.routes';
import { Auth, authInterceptor } from './core/auth';
import { SiteService } from './core/api';
import { apiBaseInterceptor, loadApiBase } from './core/api-base';

/**
 * After a new release, a browser that still runs the previous version asks for page files that were removed
 * (their names change with every build), so menu links would do nothing. Load the new version at that address instead.
 * At most once a minute, so a real outage cannot cause a reload loop.
 */
function reloadOnMissingPageFile(e: NavigationError): void {
  const msg = String((e.error as { message?: string } | undefined)?.message ?? e.error ?? '');
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk/i.test(msg)) return;
  try {
    const last = Number(sessionStorage.getItem('ccs-file-reload') || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem('ccs-file-reload', String(Date.now()));
  } catch { /* storage blocked: reload anyway */ }
  location.assign(e.url);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, apiBaseInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' }), withNavigationErrorHandler(reloadOnMissingPageFile)),
    // Before the first screen: site settings (branding, rules) and the session from the refresh cookie.
    provideAppInitializer(() => {
      const site = inject(SiteService), auth = inject(Auth);
      return loadApiBase().then(() => Promise.all([site.load(), auth.restore()])).then(() => undefined);
    }),
  ],
};
