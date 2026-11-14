import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, Routes } from '@angular/router';
import { Auth, STAFF_ROLES, requireRole } from './core/auth';
import { I18n, isLocale } from './core/i18n';
import { PublicLayout, Shell } from './layout/layouts';
import { ForgotPage, LoginCodePage, LoginPage, MfaPage, RegisterPage, ResetPage } from './pages/auth/auth-pages';
import { MyTicketsPage, NewTicketPage, TicketDetailPage } from './pages/tickets/customer-pages';
import { ConsoleQueuePage, ConsoleTicketPage } from './pages/console/console-pages';
import { DashboardPage } from './pages/console/dashboard-page';
import { AuditPage, MyTeamPage, ReportsPage, SlaReportPage } from './pages/console/insights-pages';
import { AccountPage, HomePage, NotificationsPage } from './pages/account-pages';
import { CannedPage, KbArticlePage, KbListPage } from './pages/help-pages';
import { AdminCatalogPage, AdminPrioritiesPage, AdminSlaPage, AdminTicketTypesPage } from './pages/admin/catalog-pages';
import { AdminCustomersPage, CustomerProfilePage } from './pages/admin/admin-pages';

/** The language is the first part of every address: /en/... or /ar/... */
const localeGuard: CanActivateFn = async (route) => {
  const locale = route.paramMap.get('locale');
  if (!isLocale(locale)) return inject(Router).createUrlTree(['/en']);
  await inject(I18n).use(locale);
  return true;
};

/** Signed-in people already have a home; keep them off the sign-in pages. */
const guestOnly: CanActivateFn = () => {
  const auth = inject(Auth);
  return auth.signedIn() ? inject(Router).createUrlTree([auth.homePath()]) : true;
};

/** Home for a signed-in customer renders inside the customer frame. */
const customerSignedIn: CanMatchFn = () => { const a = inject(Auth); return a.signedIn() && !a.isStaff(); };

/**
 * The knowledge base needs a sign-in: /kb lives only in the signed-in frame, so a visitor is sent to the sign-in page
 * and comes back to the article afterwards (?next=). Staff read it in the console frame: /kb/x becomes /console/kb/x.
 */
const staffKb: CanActivateFn = (route) => {
  const a = inject(Auth);
  if (!a.isStaff()) return true;
  const slug = route.paramMap.get('slug');
  return inject(Router).createUrlTree(['/' + inject(I18n).locale() + '/console/kb' + (slug ? '/' + slug : '')], { queryParams: route.queryParams });
};

/** Staff use the console copies of Account and Notifications (v1 redirects /account to /console/account). */
const staffTo = (page: string): CanActivateFn => (route) => {
  const a = inject(Auth);
  return a.isStaff() ? inject(Router).createUrlTree(['/' + inject(I18n).locale() + '/console/' + page], { queryParams: route.queryParams }) : true;
};

/** Customers and staff share the frame; visitors get the public header. */
const signedIn: CanActivateFn = requireRole();

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => (navigator.language?.startsWith('ar') ? '/ar' : '/en') },
  {
    path: ':locale',
    canActivate: [localeGuard],
    children: [
      {
        // Signed-in customers see Home inside their frame (menu, bell), as in v1.
        path: '',
        pathMatch: 'full',
        component: Shell,
        canMatch: [customerSignedIn],
        children: [{ path: '', component: HomePage }],
      },
      {
        path: '',
        component: PublicLayout,
        children: [
          { path: '', pathMatch: 'full', component: HomePage },
          { path: 'login', canActivate: [guestOnly], component: LoginPage },
          { path: 'login/code', canActivate: [guestOnly], component: LoginCodePage },
          { path: 'mfa', component: MfaPage },
          { path: 'register', canActivate: [guestOnly], component: RegisterPage },
          { path: 'forgot-password', component: ForgotPage },
          { path: 'reset-password', component: ResetPage },
        ],
      },
      {
        path: '',
        component: Shell,
        canActivate: [signedIn],
        children: [
          { path: 'kb', canActivate: [staffKb], component: KbListPage },
          { path: 'kb/:slug', canActivate: [staffKb], component: KbArticlePage },
          { path: 'tickets', canActivate: [requireRole(['customer'])], component: MyTicketsPage },
          { path: 'tickets/new', canActivate: [requireRole(['customer'])], component: NewTicketPage },
          { path: 'tickets/:id', canActivate: [requireRole(['customer'])], component: TicketDetailPage },
          { path: 'notifications', canActivate: [staffTo('notifications')], component: NotificationsPage },
          { path: 'account', canActivate: [staffTo('account')], component: AccountPage },
          { path: 'console/notifications', canActivate: [requireRole(STAFF_ROLES)], component: NotificationsPage },
          { path: 'console/account', canActivate: [requireRole(STAFF_ROLES)], component: AccountPage },
          { path: 'console/customers', canActivate: [requireRole(STAFF_ROLES)], component: AdminCustomersPage },
          { path: 'console/approvals', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/people-pages').then((m) => m.AdminApprovalsPage) },
          { path: 'console', canActivate: [requireRole(STAFF_ROLES)], component: ConsoleQueuePage },
          { path: 'console/tickets/new', canActivate: [requireRole(['admin', 'team_leader', 'agent'])], component: NewTicketPage, data: { staff: true } },
          { path: 'console/tickets/:id', canActivate: [requireRole(STAFF_ROLES)], component: ConsoleTicketPage },
          { path: 'admin/users', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/people-pages').then((m) => m.AdminStaffPage) },
          { path: 'admin/customers', redirectTo: 'console/customers' },
          { path: 'admin/approvals', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/people-pages').then((m) => m.AdminApprovalsPage) },
          { path: 'admin/permissions', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/perm-pages').then((m) => m.AdminPermissionsPage) },
          { path: 'admin/permissions/types/:id', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/perm-pages').then((m) => m.AdminTypePage) },
          { path: 'admin/organizations', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/people-pages').then((m) => m.AdminOrgsPage) },
          { path: 'admin/teams', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/people-pages').then((m) => m.AdminTeamsPage) },
          { path: 'admin/ticket-types', canActivate: [requireRole(STAFF_ROLES)], component: AdminTicketTypesPage },
          { path: 'admin/catalog', canActivate: [requireRole(STAFF_ROLES)], component: AdminCatalogPage },
          { path: 'admin/priorities', canActivate: [requireRole(STAFF_ROLES)], component: AdminPrioritiesPage },
          { path: 'admin/sla', canActivate: [requireRole(STAFF_ROLES)], component: AdminSlaPage },
          { path: 'admin/ticket-status', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/content-pages').then((m) => m.AdminStatusPage) },
          { path: 'admin/escalation', canActivate: [requireRole(['admin'])], loadComponent: () => import('./pages/admin/content-pages').then((m) => m.AdminEscalationPage) },
          { path: 'admin/general/settings', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/settings-pages').then((m) => m.SettingsPage) },
          { path: 'admin/general/settings/:tab', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/settings-pages').then((m) => m.SettingsPage) },
          { path: 'admin/kb', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/content-pages').then((m) => m.AdminKbPage) },
          { path: 'console/canned', canActivate: [requireRole(['agent', 'team_leader', 'admin'])], component: CannedPage },
          { path: 'console/reports', canActivate: [requireRole(STAFF_ROLES)], component: ReportsPage },
          { path: 'console/sla', canActivate: [requireRole(STAFF_ROLES)], component: SlaReportPage },
          { path: 'console/team', canActivate: [requireRole(['admin', 'team_leader'])], component: MyTeamPage },
          { path: 'admin/audit', canActivate: [requireRole(['admin', 'management_viewer'])], component: AuditPage },
          { path: 'console/dashboard', canActivate: [requireRole(STAFF_ROLES)], component: DashboardPage },
          { path: 'help', loadComponent: () => import('./pages/help-center-page').then((m) => m.HelpCenterPage) },
          { path: 'console/help', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/help-center-page').then((m) => m.HelpCenterPage) },
          { path: 'admin/general/help', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/help-center-page').then((m) => m.HelpCenterPage) },
          { path: 'console/people', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/console/people-page').then((m) => m.PeoplePage) },
          { path: 'admin/ticket-status/guide', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/status-guide-page').then((m) => m.StatusGuidePage) },
          { path: 'console/customers/:id', canActivate: [requireRole(STAFF_ROLES)], component: CustomerProfilePage },
          { path: 'console/kb', canActivate: [requireRole(STAFF_ROLES)], component: KbListPage },
          { path: 'console/kb/:slug', canActivate: [requireRole(STAFF_ROLES)], component: KbArticlePage },
          { path: 'admin/settings', redirectTo: 'admin/general/settings/system' },
        ],
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
