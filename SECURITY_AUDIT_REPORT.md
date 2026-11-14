# CCS v2 — Security Audit and Technical Review

| | |
|---|---|
| **System** | AZKA Customer Care System (CCS v2): Angular 22 front end, ASP.NET Core (.NET 10) API, SQL Server, IIS |
| **Scope** | Whole repository at commit `ed4c10c` (`src/`, `database/`, `deploy/`, `.github/`, configuration) |
| **Date** | 2026-11-14 |
| **Type** | Audit only. No source code, schema, configuration, packages or data were changed. |
| **Method** | Full manual review of every API endpoint and the authorization layer, existing unit tests, dependency scans, read-only metadata queries on the local database copy, safe unauthenticated probes against the local API (`https://localhost:7180`), and **signed-in tests (72 checks) on an isolated throwaway database** (`CCS_AuditTest`, created from the project's own schema scripts, served by a separate API instance on `https://localhost:7190`, invented test users only — no real customer data was touched). |

---

## A. Executive summary

### Overall security assessment: **One critical vulnerability — not safe to run as is**

The signed-in tests found a **critical access-control bug (C-01) that the code review alone had missed**.

**Every customer account receives 18 staff permissions**, including `customers_manage` and
`manage_settings`. On the isolated test database, a plain customer could:
- **reset another customer's password, sign in as them and open their tickets**;
- change system settings (registration mode, the outgoing mail server, email templates);
- create accounts;
- read and manage the catalog and the knowledge base.

Pointing outgoing mail at another server would hand that customer the password-reset codes of *any* user,
administrators included. In the local copy of production, **all 21 active customers are affected**.

Ticket screens themselves are well isolated: changing ticket, message or attachment IDs never exposed
another customer's data (all 21 direct cross-customer tests passed). The breach comes through the
*account administration* endpoints, which trust the wrongly granted permissions.

There are two further high-risk problems:

1. **Scoped staff can take over any customer account in any organisation (H-01).** Staff with the
   `customers_manage` permission (Branch Admin, Organization Admin and two scoped Team Leader types in the
   current configuration) can reset the password, change the email address, suspend, delete or re-place
   **any** customer, not only customers in their scope. Confirmed by test: a Branch Admin of branch X1
   took over a customer of another organisation. The customer *list* is filtered by scope; the *actions* are not.
2. **No administrator uses MFA, and MFA cannot be made mandatory (H-02).** In the local copy of the
   production data, 0 of 47 accounts (including both administrators) have two-step verification.

### Overall code quality assessment: **Good**

Clear layering (Domain / Application / Infrastructure / API), consistent error handling (RFC 7807), strong
concurrency control (row versions, `MERGE … HOLDLOCK`, filtered unique indexes, `READPAST` queue claims),
safe file storage, encrypted secrets and good audit coverage. The main weaknesses are:

- authorization is written by hand in each action, so a missing scope check is easy to miss (H-01 is an example);
- there are no API-level authorization tests, and no front-end tests at all;
- some queries load whole tables into memory, which will slow down as data grows.

### Production readiness: **Not ready**

**C-01 is fixed in commit `8e48c05` and verified, but not yet deployed: deploy it immediately.** If this version is already in production, every customer can do the
above today. H-01 is also fixed and pushed. H-02 (optional MFA) is a risk accepted by the owner. The
Medium items should be fixed before or shortly after go-live. See section D.

### Findings at a glance

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | C-01 |
| High | 2 | H-01, H-02 |
| Medium | 7 | M-01 … M-07 |
| Low | 9 | L-01 … L-09 |
| Informational | 6 | I-01 … I-06 |

---

## B. Security findings

Status legend: **Confirmed** = proven by code and/or a live check; **Potential** = a real weakness whose
impact depends on configuration or deployment; **Needs verification** = a check that could not be run here.

### C-01 — Every customer gets 18 staff permissions (customer → any customer account, settings, mail server)

| | |
|---|---|
| **Severity** | **Critical** |
| **Status** | **FIXED in commit `8e48c05` (pushed to main; not yet deployed).** Was confirmed dynamically (isolated test database) and in the code; all 21 active customers in the local production copy were affected. **Re-test after the fix: all 15 C-01 checks return 403; customer `/api/me` permissions = []; the customer-to-customer takeover fails (403); staff flows unchanged. Audit log of the production copy: no settings or account action by any customer (only 2 edits/deletes of their own comments).** |
| **OWASP** | A01 Broken Access Control · API5 Broken Function Level Authorization · API1 BOLA · ASVS V4.1.3 (least privilege), V4.2.1 |
| **Location** | `src/Ccs.Domain/Rules/AccessRules.cs` L98–107 (`EffectivePermissions`); `src/Ccs.Domain/Codes.cs` L84–90 (`NoTypeDefault`); called from `AccessService.BuildContextAsync` L53. Masked by `tests/Ccs.Tests/Domain/AccessRulesTests.cs` L154–155 |

**Root cause.**

```csharp
public static IReadOnlySet<string> EffectivePermissions(bool active, bool admin, bool internalUser, bool hasAccountType, ...)
{
    if (!active) return new HashSet<string>();
    if (admin) return new HashSet<string>(Permission.AdminAll);
    var set = hasAccountType ? new HashSet<string>(typePermissions) : new HashSet<string>(Permission.NoTypeDefault);   // <-- customers land here
    ...
}
```

`NoTypeDefault` is meant for a *staff member* with no account type (the legacy "full staff" set). The
function receives `internalUser` but never uses it to stop customers. Customers never have an account type
(both `AdminController.CreateUser` and self-registration leave `AccountTypeId` null), so **every active
customer gets the full legacy staff set**. The unit test meant to prove that customers get nothing builds
its customer *with* an account type (`hasAccountType: true`), so it passes while the real case is broken.

A second effect is in `BuildContextAsync` L91: `AllScope = admin || (!placed && !scoped && (type is null || type.AllAccess))`
is also **true for customers** (no type), so scope checks such as `!c.AllScope && !InScope(...)` let them through.

**Evidence (signed-in, test database, test accounts only).**

| Check | Call made by a plain customer (role `customer`) | Result |
|---|---|---|
| C1 | `GET /api/me` | `staff=false`, `admin=false`, **permissions = all_teams, assign_others, assign_self, change_category, close, customers_manage, customers_view, export, manage_canned, manage_catalog, manage_kb, manage_settings, reply, reports_all, reports_own, resolve, view_others, view_unassigned** |
| T-14 / X1 | `POST /api/admin/users/{customerB}/password` | **204**: Customer B's password replaced |
| X2–X3 | sign in as Customer B, `GET /api/tickets/{B's ticket}` | **200 / 200**: full access to B's ticket |
| X4 / T-14 | `GET /api/console/customers/{customerB}` | **200**: B's name, email, phone, organisation and ticket subjects |
| C2 / C3 | `GET` / `PUT /api/admin/settings/system`, `PUT …/registration` | **200 / 204**: switched self-registration to "open, auto-approved" |
| C11 | `PUT /api/admin/settings/email` (host → another server) | **204**: outgoing mail redirected |
| C9 | `GET /api/admin/settings/templates` | **200**: email templates readable (and editable) |
| C5 | `POST /api/admin/users` (role customer) | **200**: account created |
| C6 / C7 | `GET /api/admin/catalog`, `GET /api/admin/kb` | **200 / 200** |
| C10 | `GET /api/admin/lookups` | **200**: all organisations, branches, teams, account types, and team leaders' names and emails |
| C8 | `GET /api/admin/users?kind=staff` | 403 (admin-only, not permission-based) |
| — | ticket lists, ticket by ID, reports, console, audit log | correctly refused or filtered (these check the *role*, not the permission set) |

**Attack paths.**
1. **Customer → another customer.** Reset the victim's password or change their email (`/api/admin/users/{id}/password`, `/details`), then sign in as them. Tested end to end. Needs the victim's ID, which is exposed wherever a customer sees colleagues' tickets (organisation shared access) or a requester ID.
2. **Customer → any account, administrators included (not executed).** Point the mail server at a host the attacker controls (C11), then use "Forgot password" or "Email me a code" for any email address. The code is delivered to the attacker. This needs no victim ID.
3. **Customer → whole service.** Change registration, captcha, sign-in-code, upload and SLA settings; edit email templates (phishing from the real sender); change the catalog and the knowledge base.

**Business impact.** Complete loss of customer confidentiality and of the integrity of the system. Any
registered customer, including a newly self-registered one if registration is open, can take over other
customers and, through the mail server, administrators.

**Recommended remediation (urgent).**
1. In `EffectivePermissions`, return an empty set when `!internalUser` (customers), before applying `NoTypeDefault`.
2. In `BuildContextAsync`, set `AllScope` only for internal users.
3. Fix the unit test to model a real customer (`hasAccountType: false`), and add the API tests from section 9.E (C1, T-14, X1–X4, C2–C11) to CI.
4. Defence in depth: give every admin and settings controller a role check (`c.Internal` / `c.Staff`) in addition to the permission.
5. After deploying: review `audit_logs` for `settings.*`, `user.password_reset`, `user.update`, `user.create` and `user.status` entries whose actor is a customer. Review the current SMTP host and templates. Rotate any secrets that could have been read.

---

### H-01 — Scoped staff can take over any customer account (missing scope check on customer actions)

| | |
|---|---|
| **Severity** | **High** |
| **Status** | **FIXED in commit `16414bf` (pushed to main; not yet deployed).** Was confirmed dynamically (T-19c–f, T-20) and in the code. **Re-test after the fix:** out-of-scope edit, email change, password reset, suspend and delete now return 404; moving, creating or approving into another organisation returns 403 `outOfScope`; approving or rejecting a sign-up placed elsewhere returns 404; the approved list is scoped. 14 checks pass, and 6 control checks (in-scope work, admin actions) are unchanged. |
| **OWASP** | A01 Broken Access Control · API1 BOLA · API5 Broken Function Level Authorization · ASVS V4.2.1 |
| **Location** | `src/Ccs.Api/Controllers/AdminController.cs`: `TargetAsync` (L834–840), used by `UpdateUser` (L177), `Status` (L231), `Password` (L243), `DeleteUser` (L260), `SetDetails` (L763). Also `CreateUser` (L142, L153), `UpdateUser` placement (L202–204), `Approve` (L297–312), `CheckPlacementAsync` (L878–883) |

**Technical explanation.** `TargetAsync` decides who may act on a person:

```csharp
var role = await RoleOfAsync(id, ct);
var c = await Need(role == RoleCode.Customer ? Permission.CustomersManage : null, ct);   // permission only
```

For a customer target it checks only that the caller *has* `customers_manage`. It never checks that the
customer is inside the caller's organisation or branch scope. The list endpoint for the same screen does
check scope (`Users`, L98–102: `access.CustomersInScope(...)`), and the console *People* screen checks
scope for every action (`PeopleController.TargetAsync` → `PeopleAsync` → `Me.Covers`). The admin
customer actions are the only path without it.

The same gap lets the caller place customers anywhere:
- `UpdateUser` and `CreateUser` accept any `OrganizationId` / `BranchId`, and `CheckPlacementAsync` checks only that the organisation exists.
- `Approve` (`approve_customers`) approves any pending account into any organisation or branch.

**Who can do this today** (read-only query of `ccs.account_types` in the local copy of production):

| Account type | Scope | Holds `customers_manage` | Holds `approve_customers` | Users |
|---|---|---|---|---|
| Branch Admin | branch | yes | yes | 2 |
| Organization Admin | organization | yes | yes | 4 |
| Team Leader – Delta | limited | yes | — | 1 |
| Team Leader – Nile and Sahara | limited | yes | — | 1 |

**Attack scenario.** A Branch Admin of branch X calls `PUT /api/admin/users/{victimId}/details` with their
own email address for a customer of a different organisation, then `POST /api/admin/users/{victimId}/password`
(or uses "Forgot password"). They now sign in as that customer and see all of that customer's tickets,
attachments and history. Customer IDs are visible to staff in many places (ticket lists, reports, the
customer screen). Variants:
- Move a customer (or approve a self-registered account) into an organisation that has *organisation shared access* switched on. That account then sees **every ticket of that organisation**.
- Suspend or delete customers outside the caller's scope (denial of service).

**Business impact.** Cross-organisation customer data exposure and account takeover by an internal user
with a deliberately limited role. This breaks the confidentiality promise between client organisations.
Every change is written to the audit log, which limits concealment but does not prevent the harm.

**Recommended remediation.**
1. In `TargetAsync`, for non-admin callers, require the target customer to be in `access.CustomersInScope(...)`. Return 404 otherwise, as the ticket checks do.
2. In `CreateUser`, `UpdateUser` and `Approve`, require the target `OrganizationId` / `BranchId` to be inside the caller's scope (reuse `AccessRules.InScope`).
3. Consider allowing password and email changes of customers only to administrators, or requiring the customer to confirm a new email address.
4. Add API tests: a scoped admin must get 403/404 on every customer action for an out-of-scope customer (see section E, A-01).

**Evidence.** On the test database, a Branch Admin scoped to branch X1 could not open Customer B's
profile (Org Y, 404), did not see B in the customer list, and was refused by the console People screen
(403). The admin API, however, accepted every change:
- changed B's email: 204;
- reset B's password: 204, after which the Branch Admin signed in as B and opened B's ticket (200);
- suspended B: 204;
- moved their own customer A2 into Org Y: 204.

Editing an in-scope customer (control test) correctly returned 204. The account-type query was read-only
and touched configuration metadata only.

---

### H-02 — Administrators have no MFA, and MFA cannot be enforced by role

| | |
|---|---|
| **Severity** | **High** (production configuration) |
| **Status** | **Risk accepted by the system owner (2026-11-14), after review of the impact:** two-step verification stays optional for every role, including administrators. No code change. The local copy of production shows no account uses it today. |
| **OWASP** | A07 Identification and Authentication Failures · ASVS V2.2.3 / V4.3.1 (MFA for administrative interfaces) |
| **Location** | `src/Ccs.Infrastructure/Identity/AuthService.cs` (MFA is opt-in per user); no setting or policy requires it |

**Explanation.** Two-step verification (TOTP) is well implemented. It is enforced on every request once
enrolled (`AccountGateMiddleware`, `RefreshAsync` L104). But it is optional. A read-only count in the
local copy found **0 of 47 accounts with MFA, including both administrators**. Administrators can change
every setting, every account and every ticket. A single phished or reused admin password exposes all
customers.

**Owner decision (accepted risk).** MFA remains optional for all users. Residual risk: an administrator protected only by a password. Mitigations within that decision: administrators turn MFA on voluntarily, use unique long passwords, and M-01 is fixed so that MFA, once on, cannot be removed with only a session token.

**Original recommendation (not adopted).** Add a rule, at least for administrators and ideally for all staff, that blocks
sign-in until an authenticator is enrolled. Enroll the current admins before go-live. Keep the
"reset MFA" admin action and document the recovery procedure.

**Evidence.** `SELECT COUNT(*) … WHERE TwoFactorEnabled = 1` returned 0. Admins without MFA: 2. Counts only; no personal data was read.

---

### M-01 — Second factor can be replaced or switched off with only a session token

| | |
|---|---|
| **Severity** | Medium |
| **Status** | **FIXED (this batch; not yet deployed).** Was confirmed dynamically. **Re-test after the fix (MFA-verified session):** re-enrolling while MFA is on → 409; turning it off without a code → 400; with a wrong code → 400 `mfaWrong` and MFA stays on; with the right current code → 204. Wrong codes count toward the account lockout. |
| **OWASP** | A07 · ASVS V2.8.x, V3.7.1 (re-authentication for sensitive changes) |
| **Location** | `AuthController.cs` L118–141; `AuthService.cs` L316–345 (`BeginMfaEnrollmentAsync`, `ResetMfaAsync(self: true)`); `Middleware/Web.cs` L34 |

**Explanation.**
- `POST /api/auth/mfa/disable` turns MFA off without asking for a current TOTP code or the password.
- `POST /api/auth/mfa/enroll` calls `ResetAuthenticatorKeyAsync` **even when MFA is already on**. This immediately invalidates the user's real authenticator and returns a new secret to the caller.
- All `/api/auth/*` paths skip `AccountGateMiddleware` (L34), so these actions also work for a suspended account with a still-valid access token (up to 15 minutes).

**Impact.** Anyone who obtains a valid access token (another device, a shared PC, a future XSS) can take
over or remove the user's second factor and lock the real user out. This defeats the purpose of MFA for
exactly the accounts that use it.

**Remediation.** Require the current TOTP code (or password) to disable or re-enroll. Refuse `mfa/enroll`
while MFA is enabled, and use an explicit "replace authenticator" flow that verifies the old factor. Apply
the account-status check to authenticated `/api/auth/*` actions. Notify the user by email when MFA changes.

---

### M-02 — Password-reset code can be brute-forced over time

| | |
|---|---|
| **Severity** | Medium |
| **Status** | **FIXED (this batch; not yet deployed).** At most 5 reset codes per account in 24 hours (also for the expired-password path); after 10 wrong codes in 24 hours every reset attempt returns 429. **Re-test:** 6th code within 24 hours → 429; codes older than 24 hours do not count; 10th wrong code → 400, then 429; unknown email still gets the same 202. |
| **OWASP** | A07 · ASVS V2.5.x, V2.2.1 |
| **Location** | `AuthService.cs` L37 (`ResetCodeLength = 6, ResetCodeMinutes = 60, ResetCodeAttempts = 5`), L270–290, L388–398; `AuthController.cs` L94–107 |

**Explanation.** A reset code has 6 digits, is valid for 60 minutes and allows 5 attempts. A new code can
be requested every 60 seconds, with **no daily cap**. Sign-in codes do have a daily cap. The only other
limit is the per-IP rate limiter (20 calls / 5 min across all `/api/auth`). An attacker with many IPs can
make about 7,200 guesses a day against one account, so a 1-in-1,000,000 code becomes guessable in weeks.
The victim's mailbox also receives up to 1,440 emails a day (harassment and cost). Captcha would limit
this, but it is optional, and on a configuration fault it is silently skipped (L-08).

**Remediation.**
- Add a daily cap per account for recovery codes, like the sign-in codes.
- Lock password reset for the account after N failed codes per day.
- Consider 8-digit codes or longer, single-use links.
- Keep captcha switched on in production.

---

### M-03 — Customer-controlled text becomes clickable links in system emails

| | |
|---|---|
| **Severity** | Medium |
| **Status** | **FIXED (this batch; not yet deployed).** Values filled into the body, greeting and footer are neutralised: `](` gets a zero-width space and `*` becomes `∗`, so no link, bold or italic can form from them. Links written in the template by administrators still work. 5 new unit tests (`EmailRendererTests`). |
| **OWASP** | A03 Injection (content/markdown injection) · phishing |
| **Location** | `src/Ccs.Infrastructure/Email/EmailRenderer.cs` L29–36 (`Fill` before `MarkdownToHtml`), L95–104; `src/Ccs.Domain/Rules/Formats.cs` L61 (`SafeLink` allows any `https://`) |

**Explanation.** Template values such as `{subject}`, `{name}` and `{reason}` are inserted into the
Markdown body **before** it is converted. HTML is correctly encoded afterwards, so HTML or script
injection is not possible. Markdown is not encoded, though. A customer who sets their name or a ticket
subject to `[Reset your password](https://evil.example/login)` produces a real, branded link in emails
the system sends to staff, from the organisation's own address.

**Impact.** Credible phishing of staff, administrators included, using the trusted sender. This is made
worse by H-02.

**Remediation.** Escape Markdown control characters (`[ ] ( ) * _ \`) in values before `Fill`, or fill
values only after the Markdown has been converted (into encoded text nodes).

---

### M-04 — Sessions: idle timeout only in the browser, 14-day sliding refresh tokens

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Confirmed (code) |
| **OWASP** | A07 · ASVS V3.3.2 / V3.3.4 |
| **Location** | `src/Ccs.Web/src/app/core/auth.ts` L47–108 (idle check in `localStorage`); `TokenService.cs` L59–90; `appsettings.json` `Jwt:RefreshDays = 14` |

**Explanation.** The "sign out after inactivity" setting is enforced only by the Angular app. The server
never checks it. Each refresh issues a new 14-day token, so a session can live forever and has no
absolute lifetime. A copied refresh cookie (shared computer, malware, backup of a browser profile) stays
usable for 14 days even if the user "timed out". Positive points: the cookie is `HttpOnly`, `Secure`,
`SameSite=Strict`, limited to `Path=/api/auth`, stored hashed, rotated on every use, with reuse detection.

**Remediation.** Store `last_used_at` on the refresh token and refuse refresh after the configured idle
time on the server. Add an absolute session lifetime (for example 12 hours for staff, 7 days for customers).

---

### M-05 — File uploads: extension-only check, fail-open virus scan, no quota

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Confirmed (code); Defender availability on the server **needs verification** |
| **OWASP** | A04 Insecure Design · A08 · ASVS V12.1–V12.4 |
| **Location** | `AttachmentsController.cs` L73–90; `LocalFileStore.cs` L57–74 (`DefenderFileScanner`) |

**Explanation.**
- The type is decided by the file extension only; the content (magic bytes) is not checked. For example, a `.docx` can be any file.
- The scanner returns `"skipped"` when Defender is missing **or returns any unexpected exit code**, and the file is then accepted and offered to staff.
- The scan process has no timeout.
- There is no per-user, per-ticket or total storage quota. The rate limit allows 60 uploads × 50 MB per 10 minutes per user.

The good parts: files are stored outside the web root, the path-traversal guard is correct, file names are
sanitised, downloads are always `application/octet-stream` + `attachment` + `nosniff`, and access is checked
against the ticket on every download.

**Impact.** Malware delivered to staff through Office or PDF attachments when the scanner is not working.
Disk exhaustion by a single malicious account.

**Remediation.**
- Treat `skipped` as a failure in production (or quarantine the file and alert).
- Add a scan timeout.
- Validate content signatures for the allowed types.
- Add per-account and per-ticket quotas, plus monitoring of free disk space.

---

### M-06 — Rate limiting is per IP for anonymous calls and token refresh (availability risk)

| | |
|---|---|
| **Severity** | Medium |
| **Status** | Potential — **needs load verification** |
| **Location** | `Program.cs` L70–80 (`Key(h)` = user id, else remote IP); `AuthController` `[EnableRateLimiting("auth")]` on every action including `refresh` |

**Explanation.** All `/api/auth/*` calls share one budget of **20 per 5 minutes**, keyed by user ID when the
caller has a valid token, otherwise by IP. Sign-in, and refresh after the access token has expired, have no
valid token, so they are keyed by IP. Organisations whose staff share one public IP (office NAT) share
those 20 calls. Many users refreshing every 15 minutes, plus morning sign-ins, can hit the limit. Those
users then get 429 on refresh and are signed out. The live check confirmed the limit is enforced (requests
19–22 returned 429). If the API is ever placed behind a proxy or load balancer, all users would share one
bucket, because `UseForwardedHeaders` trusts only loopback proxies.

**Remediation.**
- Give `refresh` its own, higher limit keyed by the refresh-token hash.
- Key the sign-in limit by identifier + IP.
- Configure `KnownProxies` if a proxy is added.
- Load-test with the expected number of users per site.

---

### M-07 — Audit log fully readable by management viewers and not tamper-proof

| | |
|---|---|
| **Severity** | Medium |
| **Status** | **Confirmed dynamically** (T-24: management viewer → 200 with all entries and before/after data) |
| **OWASP** | A01 / A09 · ASVS V7.3.x |
| **Location** | `ReportsController.Audit` L309–330; `database/04_logins.sql` (`db_datawriter` on `ccs.audit_logs`) |

**Explanation.**
- `GET /api/admin/audit` is open to every management viewer, with full `before`/`after` JSON (names, emails, phone numbers, ticket changes) for **all organisations**, ignoring the viewer's scope.
- The application's database identity can `UPDATE` and `DELETE` audit rows. No trigger, permission or ledger table prevents changes, so a compromised application or SQL login could erase its traces.

Secrets are correctly kept out of the audit log: SMTP and captcha changes record only `passwordChanged` / `secretChanged`.

**Remediation.**
- Restrict the audit log to administrators, or filter it by scope.
- `DENY UPDATE, DELETE ON ccs.audit_logs TO ccs_api`, or use a SQL Server ledger table.
- Ship logs to a separate store.

---

### L-01 — Authenticated `/api/auth/*` actions skip the account gate

`Middleware/Web.cs` L34 excludes every `/api/auth` path from the suspension and MFA checks. A suspended
user, or an MFA user holding an older level-1 token, can still use `change-password` and the `mfa/*`
actions for the remaining access-token lifetime (≤ 15 min). **Fix:** exclude only the anonymous auth
endpoints, or repeat the status check in those four actions. *Status: **Confirmed dynamically**. A suspended
customer's token got 403 on `/api/tickets` but 200 (new MFA secret) on `/api/auth/mfa/enroll` (T-31).* **FIXED (this batch):** `change-password` and the three `mfa/*` actions now pass the account gate; re-test T-31b → 403.

### L-02 — MFA step does not honour account lockout

`AuthService.VerifyMfaAsync` L83–87 counts failed codes (`AccessFailedAsync`) but never checks
`IsLockedOutAsync` before verifying. TOTP guessing is then limited only by the rate limiter. **Fix:** check
lockout first, as `SignInAsync` does. *Status: Confirmed (code).* **FIXED (this batch):** lockout checked first, count reset on success. Re-test: right code after 10 wrong ones → 429.

### L-03 — Account enumeration

`register` answers `emailTaken` / `phoneTaken`. `sign-in` answers `rateLimited` (429) only for existing
locked accounts, and returns faster for unknown identifiers (no password hash is computed). **Fix:**
- registration: always answer "check your email" and send "you already have an account" to the owner;
- sign-in: compute a dummy hash for unknown users.

*Status: Confirmed (code).*

### L-04 — Some ticket writes are not tied to a permission

- `SetPriorityAsync` (`TicketService.cs` L381–384) lets any staff member who can see a ticket change its priority. No permission is required, and priority drives the SLA targets.
- `AttachmentsController.Upload` (L57) lets anyone who can *see* a ticket add files. That includes management viewers (read-only) and organisation colleagues with shared access.

**Fix:** require a write permission (for example `reply`) for both, and decide whether shared-access colleagues may upload. *Status: **Confirmed dynamically**: the management viewer uploaded a file (200), and an agent changed priority (204).*

### L-05 — Assignment does not check the target agent's status or scope

`TicketService.AssignAsync` L299–307 checks only that the agent is in the team with an agent or leader
role. It does not check that the agent is active, or allowed to serve the requester's organisation
(`UserInScopeAsync`, which auto-assignment does use). Assigning a ticket grants the agent full access to it
(`AssignedAgentId == uid` in `CanAccessTicket`). **Fix:** apply the same checks as auto-assign. *Status: Confirmed (code).*

### L-06 — Customer profile shows subjects of tickets the staff member cannot open

`CustomerProfileController.Get` L35–37 returns the latest 50 ticket subjects of an in-scope customer
without applying `VisibleTickets` (team and permission rules). **Fix:** filter with `access.VisibleTickets`. *Status: Confirmed (code).*

### L-07 — Public endpoints return more than they need

`GET /api/site` serialises the `SiteSettings` entity directly (it exposes `UpdatedBy`, an admin's user ID).
Any column added later becomes public. `GET /api/site/signup-options` lists every active organisation and
branch to anonymous visitors in the "pick" registration modes. That is by design, but it discloses the
client list. **Fix:** return a dedicated DTO, and consider showing organisations only after an email
domain match. *Status: Confirmed (code + live).*

### L-08 — Captcha fails open on a configuration fault

`CaptchaVerifier` (documented design) hides the widget and skips the check when the secret cannot be read.
On the local copy the API logs "captcha secret cannot be opened", so the check is currently silently off
there. **Fix:** alert administrators prominently and monitor this state in production. *Status: Confirmed (local); verify on production.*

### L-09 — Parallel refresh from two tabs can sign the user out everywhere

`auth.ts` L111–116 prevents parallel refreshes only within one tab. Two tabs refreshing at the same time
send the same cookie. The second request finds a revoked token and `TokenService.ConsumeAsync` L81–85
**revokes all sessions** (theft response). **Fix:**
- allow a short grace period (for example 30 s) for the immediately previous token;
- or coordinate tabs with `BroadcastChannel` / Web Locks.

*Status: Potential (reliability).*

### I-01 — Development-only exposure

Swagger is enabled only in Development or with `Swagger:Enabled=true` (live: 200 locally, off by default in
production). The `Server: Kestrel` header appears locally; IIS removes the server header in production.
Keep `Swagger:Enabled=false` in production.

### I-02 — Model-binding errors echo parser details

Malformed JSON returns the System.Text.Json message (position and expected token). Harmless, but a uniform
`invalid` response is cleaner.

### I-03 — Admin-configurable SMTP host (SSRF by administrators only)

Administrators can point SMTP at any host and port and trigger test emails. This is acceptable for the
role. Document it, and restrict outbound traffic on the server firewall.

### I-04 — `AllowedHosts: "*"`

Email links use `App:PublicUrl`, so Host-header injection was not found to be exploitable. Set the real
host name anyway.

### I-05 — Headers

API: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS (production), `Cache-Control: no-store` on
data. Web: a strong CSP (`script-src 'self' https://challenges.cloudflare.com`, no `unsafe-eval`), HSTS,
XFO, nosniff. Optional additions: `Permissions-Policy` and `frame-ancestors 'none'` in the CSP.

### I-06 — Data at rest

The SMTP password and captcha secret are encrypted with ASP.NET Data Protection. Keys are kept in SQL
Server and protected by a certificate outside the database (DPAPI fallback). The SQL connection uses
Windows authentication (no stored password). Passwords use ASP.NET Identity PBKDF2. 40 of 47 accounts still
have migrated bcrypt hashes, which are re-hashed on the user's next sign-in. All good practice. Keep the
key certificate backed up separately from the database.

---

## 9. Critical focus — customer data isolation and access control

### 9.A–D Summary of what was verified

| Control | Result | Evidence |
|---|---|---|
| Customer sees only own tickets | **Pass** | `AccessRules.CanAccessTicket` (L52–66): a customer passes only if `RequesterId == me`, or if organisation shared access is on (global switch **and** org switch) for the same organisation. `VisibleTickets` (L107–132) is the SQL twin, and `AccessParityTests` keeps the two in step. |
| Ownership checked on the backend for single tickets | **Pass** | Every ticket action calls `RequireTicketAsync` (returns 404, so it does not reveal that the ticket exists): `TicketQueries.GetAsync`, `ChangeStatusAsync`, `AddMessageAsync`, `AssignAsync`, `SetPriorityAsync`, all 14 lifecycle actions, both attachment actions, `TicketStaffController`. |
| Lists filtered on the backend | **Pass** | `ListAsync`, `SummaryAsync`, console counts and badges, dashboard, reports and the SLA report all start from `access.VisibleTickets`. |
| Attachments inherit ticket access | **Pass** | `AttachmentsController` L57/L101: ticket check first, then `x.TicketId == ticketId` in the query (an attachment ID from another ticket gives 404); internal-note files hidden from non-staff (L104–108); infected files never served. |
| Messages / internal notes | **Pass** | Internal notes filtered on the server (`TicketQueries` L200–202). Customers cannot post them (`TicketService` L252–255). Only the author can edit or delete their own messages, within a time window (`TicketLifecycleService` L293–296). |
| History / timeline | **Pass** | Customer view hides reasons and staff names and masks `pending_internal` (`TicketQueries` L223–229). |
| Cancel / reopen / feedback / follow-up | **Pass** | Cancel and feedback: requester only (`facts.RequesterId != c.UserId` → 404). Reopen goes through the `StatusFlow` rules with actor = customer only for the requester. Follow-up requires both tickets to be the caller's. Withdraw only for the person who requested it. |
| Organisation colleagues (shared access) | **Pass (by design)** | They can view, but cannot change status, reply, cancel or rate (actor resolves to none → 403/404). They can upload files (L-04). |
| ID enumeration | **Pass** | Ticket, attachment and user IDs are random GUIDs. Ticket references (`CTS-YYYY-NNNNNN`) are sequential but accepted only by staff actions that check access (`MarkDuplicateAsync` L240–241). |
| Notifications | **Pass** | Read and mark-read are filtered by `UserId == me`. |
| Customer personal data in other endpoints | **FAIL (C-01, H-01)** | Customers hold `customers_manage` / `customers_view` and `AllScope` (C-01), so they can read any customer's profile and reset or change any customer account. Scoped staff can do the same outside their scope (H-01). |
| Deny by default | **FAIL (C-01)** | Every controller except `Auth`, `Site` and `Kb` has `[Authorize]`, and the default policy rejects the MFA step token. But permissions are *granted by default* to customers: a missing account type means "full staff" (C-01). `AccountGateMiddleware` blocks suspended and pending accounts on every request (except L-01). |
| Status-dependent operations | **Pass** | Transitions come from the editable `ticket_status_transitions` table plus `StatusFlow.Evaluate` (resolve/close permissions, required reasons, reopen window, closure reasons that forbid reopening). No posting to closed tickets. No cancelling of resolved or closed tickets. |
| Security-sensitive actions logged without secrets | **Pass** | `audit.Write` on sign-in, password and MFA changes, user changes, ticket changes and settings; secrets recorded only as "changed". |

### 9.E Security test matrix (executed)

**How it was run.**
- **Database:** a new database `CCS_AuditTest` built from `database/01, 02, 05, 03_*.sql` on the local SQL Server.
- **API:** a second API instance (`https://localhost:7190`) pointed only at that database, with jobs and email off and files in a scratch folder.
- **Test data, seeded through the API by a test administrator:**
  - Org X (branch X1) and Org Y;
  - Customer A and Customer A2 (Org X / X1), Customer B (Org Y);
  - a Branch Admin scoped to X1, Agent X (scope Org X), Agent Y (scope Org Y), a management viewer;
  - one ticket each for A and B, with files, a reply and an internal note with a file.
- **Real data:** none was used. Passwords were generated randomly and never printed.

**Dynamic** = executed with signed-in test users. **Unauth** = executed without a token against the local API.

| ID | Scenario | Expected | Actual | Result | Remediation |
|---|---|---|---|---|---|
| T-01 | Customer A opens Customer B's ticket by ID | 404 | 404 | **Pass** | — |
| T-02 | Customer A lists all tickets (`view=all`) and searches for B's subject | only A's | B's ticket absent | **Pass** | — |
| T-03 | Customer A replies on B's ticket | 404 | 404 | **Pass** | — |
| T-04 | Customer A closes / reopens B's ticket | 404 | 404 / 404 | **Pass** | — |
| T-05 | Customer A cancels B's ticket | 404 | 404 | **Pass** | — |
| T-06 | Customer A deletes B's ticket | 404/405 | 405 (no such endpoint) | **Pass** | — |
| T-07 | Customer A edits or deletes B's message (B's ticket ID, own ticket ID) | 404 | 404 / 404 / 404 | **Pass** | — |
| T-08 | Customer A downloads B's file via own ticket ID | 404 | 404 | **Pass** | — |
| T-09 | Customer A downloads B's file via B's ticket ID | 404 | 404 | **Pass** | — |
| T-10 | Customer A uploads a file to B's ticket | 404 | 404 | **Pass** | — |
| T-11 | Customer A reads B's lifecycle/history; reads the staff panel; links B's ticket as follow-up; rates B's ticket | 404/403 | 404 / 403 / 404 / 404 | **Pass** | — |
| T-12 | Customer B opens own ticket: internal note hidden | absent | absent | **Pass** | — |
| T-13 | Customer A marks B's notification as read | unchanged | unchanged | **Pass** | — |
| T-15 | Customer A creates a ticket in B's name | 403 | 403 | **Pass** | — |
| T-16 | Customer A posts an internal note | 403 | 403 | **Pass** | — |
| **T-14a** | **Customer calls the admin customer list** | 403 | **200** (empty list) | **FAIL** | C-01 |
| **T-14b** | **Customer reads system settings** | 403 | **200** | **FAIL** | C-01 |
| **T-14c** | **Customer reads Customer B's profile** | 403 | **200** (name, email, phone, ticket subjects) | **FAIL** | C-01 |
| **T-14d** | **Customer resets Customer B's password** | 403 | **204** | **FAIL** | C-01 |
| **X1–X3** | **Customer A2 resets B's password, signs in as B, opens B's ticket** | impossible | **204 → 200 → 200** | **FAIL** | C-01 |
| **C3** | **Customer switches registration to open / auto-approve** | 403 | **204** | **FAIL** | C-01 |
| **C11** | **Customer redirects the outgoing mail server** | 403 | **204** | **FAIL** | C-01 |
| **C5, C6, C7, C9, C10** | **Customer creates an account; reads catalog, KB admin, email templates, lookups** | 403 | **200** each | **FAIL** | C-01 |
| T-14e | Customer reads audit log, reports, console customers, account types, staff list | 403 | 403 each | **Pass** | — |
| T-22 | Agent X opens an Org X ticket; Agent X / Agent Y open the other organisation's ticket; Agent X downloads an Org Y file | 200 / 404 / 404 / 404 | 200 / 404 / 404 / 404 | **Pass** | — |
| T-17 | Agent changes system settings, creates a team, reads account types | 403 | 403 each | **Pass** | — |
| T-18 | Agent makes themselves admin; promotes a customer | 403 | 403 / 403 | **Pass** | — |
| T-23 | Management viewer replies; changes status | 403 | 403 / 403 | **Pass** | — |
| **T-24** | **Management viewer reads the full audit log** | scoped or 403 | **200**, all entries with before/after | **FAIL** | M-07 |
| **L-04a** | **Management viewer (read-only) uploads a file** | 403 | **200** | **FAIL** | L-04 |
| **L-04b** | **Agent changes priority without a dedicated permission** | 403 | **204** | **FAIL** | L-04 |
| T-19a | Branch Admin (X1) opens Customer B's profile (Org Y) | 404 | 404 | **Pass** | — |
| T-19b | Branch Admin (X1) customer list excludes B | absent | absent | **Pass** | — |
| T-21 | Branch Admin edits B via the console People screen | 403 | 403 | **Pass** | — |
| **T-19c** | **Branch Admin (X1) changes B's email (admin API)** | 403/404 | **204** | **FAIL** | H-01 |
| **T-19d/e** | **Branch Admin (X1) resets B's password, signs in as B, opens B's ticket** | 403/404 | **204 → 200** | **FAIL** | H-01 |
| **T-19f** | **Branch Admin (X1) suspends B** | 403/404 | **204** | **FAIL** | H-01 |
| **T-20** | **Branch Admin (X1) moves own customer A2 into Org Y** | 403 | **204** | **FAIL** | H-01 |
| ctrl | Branch Admin (X1) edits in-scope Customer A (control) | 204 | 204 | **Pass** | — |
| T-31a | Suspended customer's token on `/api/tickets` | 403 | 403 | **Pass** | — |
| **T-31b** | **Suspended customer's token on `/api/auth/mfa/enroll`** | 403 | **200** (secret returned) | **FAIL** | L-01 |
| M-01a | After MFA enrolment, old level-1 token on normal APIs | 401 | 401 | **Pass** | — |
| **M-01b** | **Level-1 token replaces the enrolled authenticator** | 401/403 | **200** (new secret) | **FAIL** | M-01 |
| **T-32** | **Session token switches MFA off without a code** | 401/403 | **204** | **FAIL** | M-01 |
| T-25 | 12 protected endpoints without a token | 401 | 401 each | **Pass** (unauth) | — |
| T-26 | Forged JWT with `alg: none` | 401 | 401 | **Pass** (unauth) | — |
| T-27 | Unauthenticated `POST /api/tickets` | 401 | 401 | **Pass** (unauth) | — |
| T-28 | Background-jobs dashboard from the network | refused | 404 (jobs off); loopback-only filter in code | **Pass** (unauth) | — |
| T-29 | CORS preflight from a foreign origin | no allow headers | none | **Pass** (unauth) | — |
| T-30 | Sign-in brute force | throttled | 429 after 20 calls / 5 min | **Pass** (unauth) | see M-06 |

**Totals:** 57 checks in the main run plus 15 follow-up checks (C1–C11, X1–X4) and 6 unauthenticated
probes; **all 21 direct customer-to-customer ticket, message, attachment and history checks passed**.
The failures are C-01, H-01, M-01, M-07, L-01 and L-04.

**Acceptance criterion: NOT MET.** A customer *can* access and manipulate another customer's information,
not through ticket IDs, but through the account-administration API that wrongly trusts customers (C-01).
Scoped staff can do the same outside their scope (H-01). Per the audit rules, the application is **not
production-ready** while C-01 and H-01 remain.

## C. Architecture and code-quality findings

| ID | Weakness | Impact | Recommendation |
|---|---|---|---|
| A-01 | **No API-level authorization tests, and one unit test that hides a critical bug.** 73 tests cover domain rules and the parity between `CanAccessTicket` and `VisibleTickets`. The test meant to prove customers get no permissions builds its customer *with* an account type, so it passed while C-01 was live. Nothing exercises controllers; the front end has 0 tests; CI only checks that an anonymous `/api/tickets` returns 401. | C-01 and H-01 went unnoticed. | Add `WebApplicationFactory` integration tests against a disposable SQL Server (CI already installs one), with seeded customers A/B, scoped admins, agents and viewers. Encode section 9.E as tests and add a test that fails when an endpoint has no access check. |
| A-02 | **Authorization is imperative and per action** (`Need(...)`, `RequireSignedInAsync`, hand-written scope checks). The default policy only checks authentication. | Easy to forget the scope part, as H-01 shows. Two code paths edit people (`AdminController` vs `PeopleController`) with different rules. | Move to resource-based authorization (`IAuthorizationService` + handlers for "customer", "ticket", "organisation"), and route all person edits through one Application service. |
| A-03 | **Fat controllers with business logic and direct `DbContext` use**: `AdminController` 925 lines, `SettingsController` 725, `CatalogAdminController` 701, `ContentAdminController` 522. | Harder to test and review; rules are duplicated. | Move logic into Application services, as `TicketService` / `TicketLifecycleService` already do. |
| A-04 | **Queries that load whole tables into memory.** `TicketQueries.EscalatedIdsAsync` reads and parses every `ticket.escalated` audit row on each queue/count request. `KbController.Suggest` loads all article bodies. `CreatableCustomersController` loads all active customers. `PeopleController.PeopleAsync` loads all profiles, roles and placements. Reports load the full period into memory. | Response times grow linearly with data, and the console counts run often (auto-refresh every 30 s). | Store escalation as a column or table; use full-text search for the KB (already installed); filter and page in SQL; cache the organisation tree. |
| A-05 | **Per-request overhead.** `AccountGateMiddleware` (1 query) plus `BuildContextAsync` (≈ 7–9 queries; organisation tree for scoped staff) on every API call. | Database load scales with every page refresh. | Cache the access context for the access-token lifetime, invalidated on role or scope changes. |
| A-06 | **Entities returned directly** (`/api/site`). | Accidental data exposure when the model grows (L-07). | Use DTOs everywhere. |
| A-07 | **Logging and monitoring.** Serilog to local rolling files, request logging, failed sign-ins logged with the user ID. No central log store, no alerting on lockouts, 429 storms, "captcha off", scan "skipped" or disk space. | Incidents are noticed late. | Ship logs (for example Seq/ELK/Azure Monitor), add alerts for those events, and keep the audit log append-only (M-07). |
| A-08 | **Background jobs run inside the web process** (Hangfire, 2 workers, `Jobs:Enabled`). | Acceptable on one server; a web farm needs exactly one job host (the code comments say so). | Document it in the runbook; consider a Windows service for jobs. |
| A-09 | **Consistency of limits.** Ticket and message rate limits (15/h, 20/min) are hard-coded constants, while other limits are editable settings. | Minor. | Make them settings or document them. |

**Strengths worth keeping:**
- A single source of truth for ticket access, with a parity test.
- Consistent 404 responses on access denial, so object existence isn't revealed.
- RFC 7807 error handling that hides exceptions behind a 500 with a trace ID.
- Row-version optimistic concurrency on tickets.
- Atomic ticket numbering.
- `READPAST` email queue with leases.
- Filtered unique indexes for business invariants.
- Secrets encrypted at rest.
- Least-privilege SQL login (`DENY ALTER` on schemas).
- Path-safe file store.
- A strict front-end CSP.
- A tested, editable status-flow table.
- Thorough audit trail.
- Zero known-vulnerable dependencies.

---

## D. Production readiness checklist

| # | Item | Status |
|---|---|---|
| 0 | **Fix C-01** (customers must get no staff permissions and no `AllScope`), fix its unit test, review the audit log for actions by customers, and check the SMTP settings and templates | ☑ Fixed (`8e48c05`) and re-tested; production copy audit log clean. ☐ **Deploy**, then repeat the audit-log query and check the SMTP settings on production |
| 1 | Fix H-01 (scope checks on admin customer actions, placement and approval) and add tests | ☑ Fixed (`16414bf`) and re-tested. ☐ Push and deploy; ☐ add the checks to CI (A-01) |
| 2 | MFA for administrators (H-02) | ☑ **Risk accepted by the owner** (2026-11-14): MFA stays optional for all roles. Recommended: admins enable it voluntarily; fix M-01 |
| 3 | Require re-authentication for MFA disable/replace; block `mfa/enroll` when enabled (M-01) | ☐ Strongly recommended |
| 4 | Daily cap and lockout for password-reset codes; captcha on in production (M-02, L-08) | ☐ Strongly recommended |
| 5 | Escape Markdown in email placeholder values (M-03) | ☐ Strongly recommended |
| 6 | Server-side idle and absolute session lifetime (M-04) | ☐ Recommended |
| 7 | Defender present on the server; treat "skipped" as failure; scan timeout; quotas (M-05) | ☐ Recommended (verify Defender on the server) |
| 8 | Load-test sign-in and refresh with the expected users per site; tune rate limits (M-06) | ☐ Recommended |
| 9 | Restrict the audit log to admins; make `audit_logs` append-only (M-07) | ☐ Recommended |
| 10 | `ASPNETCORE_ENVIRONMENT=Production` (set in `web.config`) | ☑ Done |
| 11 | `Swagger:Enabled=false`, `Jobs:Enabled` on exactly one host, `Cors:WebOrigin` empty (same site) | ☑ Defaults correct — verify on the server |
| 12 | `Jwt:SigningKey` (≥ 32 random bytes) and the connection string set on the app pool, not in files | ☑ Enforced at start-up; verify on the server |
| 13 | "CCS Data Protection" certificate installed and backed up separately from the database | ☐ Verify |
| 14 | `AllowedHosts` set to the real host name (I-04) | ☐ Recommended |
| 15 | HTTPS certificate valid; HSTS active (web + API) | ☑ Configured — verify the certificate |
| 16 | Backups of the database **and** `D:\CcsData\attachments`, with a tested restore | ☐ Verify |
| 17 | Central log shipping and alerts (A-07) | ☐ Recommended |
| 18 | Authorization integration tests in CI (A-01) | ☐ Recommended before go-live |
| 19 | Dependencies: `npm audit` 0, NuGet vulnerable 0 (incl. transitive); Angular 22.2.5 → 22.2.6 patch available | ☑ Clean — apply the patch on the next release |

---

## E. Prioritized remediation plan

### Priority 1 — Critical security vulnerabilities (fix now)
0. **C-01**:
   - Return no permissions for non-internal users in `EffectivePermissions`, and set `AllScope` only for internal users. This is a two-line fix.
   - Correct the unit test.
   - Add the C-01 API checks to CI.
   - Then review `audit_logs` for settings and user actions performed by customers, and verify the SMTP host and email templates on production.

### Priority 2 — High-risk vulnerabilities (fix before go-live)
1. **H-01**:
   - Add a scope check to `AdminController.TargetAsync`.
   - Add scope checks on the placement in `CreateUser`, `UpdateUser` and `Approve`.
   - Add tests T-19/T-20.
   - Estimated effort: small (reuse `CustomersInScope` / `AccessRules.InScope`).
2. **H-02**: Risk accepted by the owner (MFA optional for all roles). No change; fix M-01 so MFA, once on, cannot be removed without a code.

### Priority 3 — Medium-risk issues
3. **M-01**: Re-authentication for MFA changes; refuse re-enrollment while enabled; status gate on authenticated auth actions (fixes L-01 too).
4. **M-02**: Daily cap and lockout for recovery codes; lockout check in the MFA step (fixes L-02 too).
5. **M-03**: Escape Markdown in email values.
6. **M-04**: Server-side idle timeout and absolute session lifetime; refresh grace period (fixes L-09 too).
7. **M-05**: Fail-closed scanning, scan timeout, content signature check, quotas.
8. **M-06**: Separate refresh limiter; identifier-based sign-in limiter; load test.
9. **M-07**: Admin-only (or scoped) audit log; append-only audit table.

### Priority 4 — Code quality, low-risk items and performance
10. **A-01 / A-02**: Integration test suite for authorization; move to resource-based authorization; one service for person edits.
11. **L-03 … L-07**: Enumeration hardening, permission checks for priority and uploads, assignment checks, filtered customer ticket list, DTOs for public endpoints.
12. **A-04 / A-05**:
    - Remove the in-memory scans: escalations, KB suggest, creatable customers, people.
    - Cache the access context.
13. **A-03 / A-07 / A-09**:
    - Slim the controllers.
    - Central logging and alerts.
    - Make the remaining hard-coded limits settings.
14. Apply the Angular 22.2.6 patch release.

---

## Limitations and checks not performed

- **Signed-in tests were run on an isolated throwaway database** (`CCS_AuditTest`), not on the production copy. The
  production copy was only *counted* (21 active customers, all without an account type) to show that C-01
  affects real accounts. The database is kept so the same script can be re-run after the fixes. It can be
  dropped at any time; it contains only invented test data. The attack through the mail server (C-01, path 2)
  was proven only up to the accepted settings change: no mail server was set up, so no email was captured.
- **Production configuration** (server environment variables, IIS bindings, certificate, Defender,
  firewall, backups, real `AllowedHosts`, captcha state) could not be inspected. Items marked "verify" in
  section D depend on it.
- **Load and race testing** (M-06, L-09) was reasoned from the code, not measured.
- **No penetration testing** against external or production systems was performed, as instructed. Live
  checks were limited to unauthenticated, read-only requests to the local API. The rate-limit check used a
  made-up `.invalid` identifier that matches no account.
- **Third-party service security** (Cloudflare Turnstile, the SMTP provider) was not assessed.
- **The migration tool** (`migration/`, `SupabaseImport.cs`) is an offline, one-time importer run from the
  server console. It was reviewed only for SQL injection (table names are constants) and secrets (none
  stored).

## Evidence log (commands run)

| Check | Result |
|---|---|
| `dotnet test` | 73 passed, 0 failed |
| `dotnet list Ccs.slnx package --vulnerable --include-transitive` | No vulnerable packages in any project |
| `npm audit --omit=dev` / `npm audit` (src/Ccs.Web) | 0 vulnerabilities / 0 vulnerabilities |
| `npm outdated --omit=dev` | Angular 22.2.5 → 22.2.6, postcss 8.5.32 → 8.5.33 (patch releases) |
| Secret scan of tracked files (excluding `prebuilt/`) | Only Cloudflare's public Turnstile **test** keys in `.github/workflows/ci.yml`; no real secrets. `appsettings.json` has an empty `SigningKey`; the SQL login uses Windows authentication. |
| Raw SQL review | 2 interpolated `SqlQuery` calls (parameterised by EF Core); parameterised `SqlCommand` in the key ring; importer uses constant table names. No injection path. |
| Unauthenticated probes (local API) | 12 protected endpoints → 401; `alg:none` token → 401; foreign-origin CORS → no allow headers; `/api/health` → "Healthy" only; sign-in throttled after 20 calls / 5 min |
| Read-only DB metadata queries (local copy) | Account types and their permissions; counts of lockout, hash type and MFA. **No personal data was read or written.** |
| Signed-in test run (isolated DB `CCS_AuditTest`, API on :7190) | 57 checks: 42 passed, 15 failed; 15 follow-up checks confirming C-01 (C1–C11, X1–X4). Script and raw results kept in the session scratch folder (`authz-tests.mjs`, `results.json`); passwords stored there only, never printed |
| Count on the production copy | 21 active customers, 21 without an account type (count only) |
