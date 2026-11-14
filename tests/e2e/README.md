# CCS v2 browser tests (Playwright)

One spec file per sheet of the test workbook (`CCS_Test_Cases.xlsx`, 262 cases on 28 sheets). Each test title starts
with the workbook case ID (`TC-AU-001 ...`). Cases that need a mailbox, an authenticator app, waiting time or a change
for the whole site stay manual: they are `test.skip("Manual: ...")` so the workbook keeps "Not run" for them.
The tests run **only on the local copy**: the address guard refuses the public site.

## One-time setup (Windows, PowerShell)
```
cd tests\e2e
npm install
npx playwright install chromium
copy .env.example .env      # then put the passwords in .env (never committed)
```

Two passwords in `.env`: `CCS_TEST_PASSWORD` for the demo accounts of the "Test users" sheet, `CCS_ADMIN_PASSWORD` for `admin.demo` and `laila.hassan` (empty = same as the test password).

## Every run
1. Start the local copy: API `dotnet run --project src/Ccs.Api` and web `cd src/Ccs.Web && npm start` (local database copy, `Jobs:Enabled=false`).
2. In the LOCAL copy switch the captcha **off** (the tests cannot solve it).
3. `npm test` (all, about 40 minutes) or one sheet: `npx playwright test specs/ct-customer-tickets.spec.ts`.
4. Captcha check only: switch the captcha **on**, then `npm run test:captcha`.
5. Open the details with `npm run report`; a short list of failures: `node scripts/failures.mjs`.

Do not run two test runs at the same time (they share the local database and the rate limits).

## Put the results into the workbook
```
npm run results -- "D:\css\css-v2\CCS_Test_Cases.xlsx"
```
Saves `CCS_Test_Cases_results.xlsx` next to the original (the original is never changed). Pass/Fail goes to **Result v2 (.NET)**, with date, tester (`CCS_TESTER`) and the first line of the error in Notes. Manual cases stay **Not run**.
`node scripts/status-table.mjs results/report.json` prints the Status table below.

## How the tests work
- **Accounts** (`support/accounts.ts`): admin `admin.demo`, viewer `laila.hassan`, organization admins `cairo.orgadmin` / `hcww.admin`, branch admin `nasrcity.branchadmin`, team leader `tamer.leader`, agent `agent.banha` and customer `sara.banha` (Agent Banha works in Technical support, the team of Sara's tickets).
- **Test data** (`support/data.ts`): tickets of the test customer are created by the admin for her (customers may create only 15 tickets per hour), in the "Technical issue" category. Subjects start with `E2E`. Accounts, teams, types, categories and articles made by a test are named `E2E ...` / `e2e.*@demo.cts.test` and deleted again; people who got history (tickets) are left suspended.
- **Sign-in rate limit** (`support/fixtures.ts`): the API allows 20 `/api/auth` calls per 5 minutes per client address. Each role keeps ONE signed-in page for the whole run (`asRole`) and moves inside the app without reloading (`go`). On the local copy each role uses its own test address (`X-Forwarded-For: 10.77.0.x`, trusted from loopback), so the roles do not share one allowance; the sign-in and rate-limit cases use the real address. Every auth call is counted in `results/.auth-calls.json` and the tests wait instead of going over the limit.
- Texts are read from `src/Ccs.Web/public/i18n/en.json` (`t('Tickets.newTicket')`), so a changed label does not break the tests.

## Safety
- Passwords come from `CCS_TEST_PASSWORD` / `CCS_ADMIN_PASSWORD` (environment or `.env`), never from a file in the repo. Temporary passwords of throw-away accounts are generated in memory and never printed or saved. Tokens and cookies are kept in memory only.
- `.env`, `*.xlsx` and `results/` are git-ignored.
- Any address other than localhost is refused unless `CCS_ALLOW_REMOTE=yes` (staging only, never production).

## Deliberate v2 behaviour (not failures)
- Management viewers see audit field names but not the values.
- Uploads must match the file's content and are refused if the virus scan fails.
- Changing the priority needs the `change_category` permission.
- Turning off two-step verification needs a current code; reset codes are limited to 5 per day per account.
- The knowledge base needs sign-in: visitors go to `/login?next=...`; staff read it at `/console/kb`.
- Registration asks for the 11-digit `01...` mobile number only (no `+20` form).
- Staff may close a ticket only from New or Pending customer (status flow of this copy); a resolved ticket is closed by the customer or by auto-close.

## Status
| Sheet | Spec | Automated | Pass / Fail | Manual |
|---|---|---|---|---|
| AC My account | `ac-my-account.spec.ts` | 8 of 8 | 6 / 2 | - |
| AD Audit log | `ad-audit-log.spec.ts` | 3 of 3 | 2 / 0 (1 skipped: no data) | - |
| AP Account approvals | `ap-account-approvals.spec.ts` | 4 of 6 | 4 / 0 | 002, 003 |
| AU Sign in and session | `au-sign-in.spec.ts` | 11 of 22 | 9 / 0 (2 skipped: no data) | 005, 008, 009, 010, 011, 012, 013, 014, 016, 017, 020 |
| CA Catalog | `ca-catalog.spec.ts` | 6 of 6 | 6 / 0 | - |
| CM Customers | `cm-customers.spec.ts` | 9 of 10 | 8 / 1 | 005 |
| CT Customer tickets | `ct-customer-tickets.spec.ts` | 20 of 21 | 20 / 0 | 016 |
| DB Dashboard | `db-dashboard.spec.ts` | 5 of 5 | 5 / 0 | - |
| EM Settings email | `em-settings-email.spec.ts` | 2 of 8 | 2 / 0 | 002, 003, 005, 006, 007, 008 |
| HC Help Center | `hc-help-center.spec.ts` | 8 of 8 | 8 / 0 | - |
| KB Knowledge base | `kb-knowledge-base.spec.ts` | 6 of 6 | 6 / 0 | - |
| NT Notifications | `nt-notifications.spec.ts` | 4 of 5 | 4 / 0 | 004 |
| OP Operations, jobs | `op-operations.spec.ts` | 3 of 7 | 3 / 0 | 001, 002, 003, 006 |
| OR Organizations, branches | `or-organizations.spec.ts` | 7 of 8 | 6 / 1 | 008 |
| PM Permissions, account types | `pm-permissions.spec.ts` | 8 of 9 | 8 / 0 | 004 |
| PR Priorities, statuses | `pr-priorities-statuses.spec.ts` | 7 of 7 | 7 / 0 | - |
| PS Scoped admins | `ps-scoped-admins.spec.ts` | 9 of 11 | 9 / 0 | 010, 013 |
| RG Registration | `rg-registration.spec.ts` | 7 of 11 | 5 / 2 | 002, 004, 005, 010 |
| RP Reports | `rp-reports.spec.ts` | 6 of 6 | 5 / 1 | - |
| SC Saved replies | `sc-saved-replies.spec.ts` | 4 of 4 | 4 / 0 | - |
| SE Security, access | `se-security-access.spec.ts` | 9 of 12 | 8 / 1 | 008, 011, 012 |
| SL SLA | `sl-sla.spec.ts` | 2 of 5 | 2 / 0 | 002, 003, 004 |
| SM Settings site, menus | `sm-settings-site-menus.spec.ts` | 4 of 6 | 4 / 0 | 003, 005 |
| ST Staff tickets | `st-staff-tickets.spec.ts` | 24 of 27 | 21 / 0 (3 skipped: no data) | 004, 023, 024 |
| SY Settings system | `sy-settings-system.spec.ts` | 5 of 12 | 5 / 0 | 002, 003, 004, 005, 006, 010, 011 |
| TM Teams | `tm-teams.spec.ts` | 7 of 7 | 6 / 1 | - |
| US Staff users | `us-staff-users.spec.ts` | 10 of 10 | 9 / 1 | - |
| UX Language, layout, quality | `ux-language-layout.spec.ts` | 10 of 10 | 10 / 0 | - |

Last full run: 14 Nov 2026 on the local copy (main 0446521): **194 Pass, 10 Fail, 58 Not run** (49 manual, 9 skipped for lack of data such as a ticket of another organization). `CCS_Test_Cases_results.xlsx` carries the result and the reason for each case.

### Failing cases
| Case | Kind | What happens |
|---|---|---|
| TC-AC-005 | v2 gap | My account has no email notification choices (v1 had them). |
| TC-AC-006 | v2 bug | The header language switch is not saved as the preferred language, so emails keep the old one. |
| TC-CM-009 | v2 gap | No Export on the Customers page although the leader type has "Export data". |
| TC-US-009 | v2 gap | After an admin sets a temporary password the person is not asked to change it. |
| TC-OR-006 | v2 gap | No parent-organization field on the Organizations page. |
| TC-RP-004 | v2 gap | The report CSV has no rating columns. |
| TC-SE-007 | v2 bug | Signed-in API answers have no `Cache-Control: no-store`. |
| TC-TM-006 | data / UI | The test leader leads no team; My team stays empty instead of "You do not lead any team yet". |
| TC-RG-001, TC-RG-006 | local copy | Registration cannot send its email locally (503 emailFailed); the form only says "Something went wrong". |

Also seen outside the workbook: the customer and console ticket pages keep showing the first ticket when you move to another ticket inside the app (the id is read once); My account accepts only the `+20...` phone form while registration accepts only `01...`.
