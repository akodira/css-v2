import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { Auth, STAFF_ROLES, requireRole } from './core/auth';
import { I18n, isLocale } from './core/i18n';
import { PublicLayout, Shell } from './layout/layouts';
import { ForgotPage, LoginCodePage, LoginPage, MfaPage, RegisterPage, ResetPage } from './pages/auth/auth-pages';
import { MyTicketsPage, NewTicketPage, TicketDetailPage } from './pages/tickets/customer-pages';
import { ConsoleQueuePage, ConsoleTicketPage } from './pages/console/console-pages';
import { DashboardPage } from './pages/console/dashboard-page';
import { AuditPage, MyTeamPage, ReportsPage, SlaReportPage } from './pages/console/insights-pages';
import { AccountPage, HomePage, NotificationsPage } from './pages/account-pages';
import { SettingsPage } from './pages/admin/settings-pages';
import { AdminEscalationPage, AdminKbPage, AdminStatusPage } from './pages/admin/content-pages';
import { CannedPage, KbArticlePage, KbListPage } from './pages/help-pages';
import { AdminCatalogPage, AdminPrioritiesPage, AdminSlaPage, AdminTicketTypesPage } from './pages/admin/catalog-pages';
import { AdminApprovalsPage, AdminCustomersPage, AdminOrgsPage, AdminStaffPage, CustomerProfilePage, AdminTeamsPage, AdminTypesPage } from './pages/admin/admin-pages';

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

/** Customers and staff share the frame; visitors get the public header. */
const signedIn: CanActivateFn = requireRole();

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => (navigator.language?.startsWith('ar') ? '/ar' : '/en') },
  {
    path: ':locale',
    canActivate: [localeGuard],
    children: [
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
          { path: 'kb', component: KbListPage },
          { path: 'kb/:slug', component: KbArticlePage },
        ],
      },
      {
        path: '',
        component: Shell,
        canActivate: [signedIn],
        children: [
          { path: 'tickets', canActivate: [requireRole(['customer'])], component: MyTicketsPage },
          { path: 'tickets/new', canActivate: [requireRole(['customer'])], component: NewTicketPage },
          { path: 'tickets/:id', canActivate: [requireRole(['customer'])], component: TicketDetailPage },
          { path: 'notifications', component: NotificationsPage },
          { path: 'account', component: AccountPage },
          { path: 'console', canActivate: [requireRole(STAFF_ROLES)], component: ConsoleQueuePage },
          { path: 'console/tickets/new', canActivate: [requireRole(['admin', 'team_leader', 'agent'])], component: NewTicketPage, data: { staff: true } },
          { path: 'console/tickets/:id', canActivate: [requireRole(STAFF_ROLES)], component: ConsoleTicketPage },
          { path: 'admin/users', canActivate: [requireRole(['admin'])], component: AdminStaffPage },
          { path: 'admin/customers', canActivate: [requireRole(STAFF_ROLES)], component: AdminCustomersPage },
          { path: 'admin/approvals', canActivate: [requireRole(STAFF_ROLES)], component: AdminApprovalsPage },
          { path: 'admin/permissions', canActivate: [requireRole(['admin'])], component: AdminTypesPage },
          { path: 'admin/organizations', canActivate: [requireRole(['admin'])], component: AdminOrgsPage },
          { path: 'admin/teams', canActivate: [requireRole(['admin'])], component: AdminTeamsPage },
          { path: 'admin/ticket-types', canActivate: [requireRole(STAFF_ROLES)], component: AdminTicketTypesPage },
          { path: 'admin/catalog', canActivate: [requireRole(STAFF_ROLES)], component: AdminCatalogPage },
          { path: 'admin/priorities', canActivate: [requireRole(STAFF_ROLES)], component: AdminPrioritiesPage },
          { path: 'admin/sla', canActivate: [requireRole(STAFF_ROLES)], component: AdminSlaPage },
          { path: 'admin/ticket-status', canActivate: [requireRole(STAFF_ROLES)], component: AdminStatusPage },
          { path: 'admin/escalation', canActivate: [requireRole(['admin'])], component: AdminEscalationPage },
          { path: 'admin/general/settings', canActivate: [requireRole(STAFF_ROLES)], component: SettingsPage },
          { path: 'admin/general/settings/:tab', canActivate: [requireRole(STAFF_ROLES)], component: SettingsPage },
          { path: 'admin/kb', canActivate: [requireRole(STAFF_ROLES)], component: AdminKbPage },
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
          { path: 'console/notifications', redirectTo: 'notifications' },
          { path: 'admin/ticket-status/guide', canActivate: [requireRole(STAFF_ROLES)], loadComponent: () => import('./pages/admin/status-guide-page').then((m) => m.StatusGuidePage) },
          { path: 'console/customers/:id', canActivate: [requireRole(STAFF_ROLES)], component: CustomerProfilePage },
          { path: 'console/account', redirectTo: 'account' },
          { path: 'console/kb', redirectTo: 'kb' },
          { path: 'console/kb/:slug', redirectTo: 'kb/:slug' },
          { path: 'admin/settings', redirectTo: 'admin/general/settings/system' },
          { path: 'console/approvals', redirectTo: 'admin/approvals' },
          { path: 'console/customers', redirectTo: 'admin/customers' },
        ],
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
