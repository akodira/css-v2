# CCS v2: Customer Care System on Angular, ASP.NET Core and SQL Server

This is a new build, not a conversion. The current Next.js and Supabase app (`akodira/cts-app`) and the live
`cts` database are the specification. This is **delivery 1 of the full build**: build stages 1 and 2 are complete, and
stages 3 to 7 are partly done (see the status table).

| Area | Technology |
|---|---|
| Frontend | Angular 22 (standalone components, signals, zoneless), Tailwind CSS 4 with the current design tokens, English and Arabic (RTL) |
| Backend | ASP.NET Core Web API on **.NET 10 LTS**, split into Api, Application, Domain and Infrastructure projects |
| Sign-in | ASP.NET Core Identity: JWT access token in memory plus a rotating refresh token in an HttpOnly cookie |
| Database | SQL Server 2019+ (2022 recommended), schema `ccs` |
| Jobs | Hangfire with SQL Server storage (SLA every minute, lifecycle every 15 minutes, email every minute) |
| Hosting | Windows Server and IIS: one site for Angular, one site for the API, HTTPS everywhere |

## Folder layout

```
database/          01_schema.sql (61 tables), 02_seed.sql, 03_fulltext.sql, 04_logins.sql
src/Ccs.Domain     Entities and pure rules: status flow, business calendar, SLA clock, access rules, phone, password
src/Ccs.Application Services: Access, Ticket, Sla, Lifecycle, Notification, Audit, Settings, queries
src/Ccs.Infrastructure EF Core, Identity (bcrypt-compatible hasher), JWT, SMTP (MailKit), email renderer, files, Defender scan, Hangfire jobs
src/Ccs.Api        Thin controllers, auth policies, rate limiting, account gate, problem responses, Swagger, web.config
src/Ccs.Web        Angular app (public/web.config = IIS rewrite + /api proxy)
tests/Ccs.Tests    xUnit: one test per access rule, status table, calendar/SLA, rules, list-vs-detail access parity
migration/         migrate.mjs (Supabase -> SQL Server, repeatable, verifies counts), copy-files.ps1 (attachments)
```

## Status by build stage (spec section 10)

| # | Stage | Status in this delivery |
|---|---|---|
| 1 | Export schema, create SQL Server database | **Done.** Taken from the live `cts` database: 50 tables, every CHECK, FK, unique and filtered index, plus Identity, refresh tokens, codes and rate counters |
| 2 | Identity, sign-in, two-step, password rules, access service and tests | **Done.** Email or Egyptian phone sign-in, email sign-in codes, TOTP (enforced on every request), reset by code, password policy from settings, suspension checked on every request, AccessService with tests |
| 3 | Organizations, users, account types, teams, approvals | Partly done: approval on sign-up (pending_approval, approvers notified: branch admin, then org admin, then system admins). **Admin screens not started** |
| 4 | Catalogue and ticket service with status flow | Ticket service done (create, status, reply/note, assign, claim, auto-assign, priority). Not done yet: cancellation, links, duplicate/spam, feedback, escalation, category change, uploads |
| 5 | Customer screens, then console | Customer: my tickets, new ticket, ticket detail, notifications, account (password, two-step). Console: queue and ticket workspace. All in EN/AR with the current design |
| 6 | SLA, calendars, timers job | **Done** (service side): business-time maths, pause and resume, reopen cycles, warning and breach events once per cycle, reminders, auto-close, password expiry. Admin screens not done yet |
| 7 | Notifications, templates, email design, SMTP | Engine done: 23 events with the same rules as the triggers, dedupe, queued sending with lease and retry, HTML and text email frame, safe Markdown. Admin editors not done yet |
| 8 | Admin settings, reports, KB, audit | Not started (audit rows are already written) |
| 9 | Migration rehearsal, security review, load test, cutover | Migration tool ready. Rehearsal needs your SQL Server |

## Before the first build

The .NET code has **not been compiled yet**. The cloud workspace it was written in cannot download the .NET SDK or
NuGet packages (network policy). The Angular app was built and checked in a browser against a mock API (EN and AR,
desktop and phone). On a PC with the .NET 10 SDK:

```powershell
dotnet build Ccs.slnx
dotnet test  Ccs.slnx
```

Send me any compiler or test errors and I will fix them.

## Run locally

1. Create the database: run `database/01_schema.sql`, then `02_seed.sql`, then `03_fulltext.sql`, on a local SQL Server (`CCS_Dev`).
2. Set the API secrets (never in appsettings.json):
   ```powershell
   cd src/Ccs.Api
   dotnet user-secrets set "Jwt:SigningKey" ([Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 })))
   dotnet run
   ```
3. Run the web app: `cd src/Ccs.Web; npm ci; npm start`, then open http://localhost:4200. `/api` is proxied to https://localhost:7180.

## Deploy on Windows Server and IIS

1. Install the **ASP.NET Core 10 Hosting Bundle**, **URL Rewrite** and **Application Request Routing** (enable proxy at server level).
2. SQL Server: run the 4 scripts in `database/` on the production instance. `04_logins.sql` creates a least-privilege login. Prefer the app pool's Windows identity (gMSA).
3. API site: `dotnet publish src/Ccs.Api -c Release -o C:\inetpub\ccs-api`. Create an IIS site on `https://localhost:8443` (or its own host name) with its own app pool, set to *No Managed Code*. Set these environment variables on the pool:
   `ConnectionStrings__Ccs`, `Jwt__SigningKey`, `App__PublicUrl`. Create `D:\CcsData\{attachments,logs}` outside the web root, give the pool identity write access, and include it in the nightly backup.
4. Web site: `cd src/Ccs.Web; npm ci; npx ng build`, then copy `dist/Ccs.Web/browser/*` to `C:\inetpub\ccs-web`. Create the public HTTPS site. Its `web.config` serves the SPA and proxies `/api` to the API site.
5. Check `https://<site>/api/health` (database check) and sign in. The Hangfire dashboard is at `https://localhost:8443/api/jobs`, from the server itself only.
6. Backups: nightly SQL backup plus `D:\CcsData\attachments`, with a restore you have actually tested.

### Encryption keys and moving to another server

The keys that protect the saved SMTP password and captcha secret are stored **in the database** (`ccs.data_protection_keys`), encrypted with the certificate **CN=CCS Data Protection** (LocalMachine\My), which the installer creates. The certificate is not in the database, so a database backup alone cannot open the secrets.

- Backup: run `Export-KeyCertificate.cmd` once (it writes `C:\CcsData\backup\ccs-key-certificate.pfx` with a password you choose). Keep the file and password with the backups, but not in the same place.
- Move: restore the database on the new server, copy `C:\CcsData\attachments`, put `ccs-key-certificate.pfx` in `C:\CcsData`, run `Install-Ccs.cmd` and enter the certificate password. Nothing has to be re-entered.
- Lost certificate: the app keeps running; Settings shows "enter it again" for the SMTP password and captcha secret.
- Releases before Nov 2026 kept the keys in `C:\CcsData\keys`. The first start after updating moves the saved secrets into the new key ring; the old folder can then be deleted.

## Migrate the data

```powershell
cd migration; npm install
$env:PG_URL = "postgresql://postgres.<ref>:<db-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
$env:MSSQL  = "Server=SQL01;Database=CCS_Test;Trusted_Connection=yes;Encrypt=true;TrustServerCertificate=true"
node migrate.mjs --dry-run            # counts only
node migrate.mjs --real-only          # empties CCS_Test, copies, then prints counts per table/status/priority/org
.\copy-files.ps1 -SupabaseUrl https://rqlibtzbdrltayykfcly.supabase.co -ServiceKey <key> -Root D:\CcsData\attachments -SqlServer SQL01 -Database CCS_Test
```

Adding a few accounts later, to a system that is already in use (nothing is emptied):

```powershell
node migrate.mjs --add-users cairo.orgadmin@demo.cts.test,nasrcity.branchadmin@demo.cts.test
```

Each account keeps its old password, role, admin scope, placement and teams. An email that already exists is skipped. If the organization or branch it belongs to is missing in the new system, the script stops before adding anything and says which one.

* Passwords: the Supabase bcrypt hashes (`$2a$`) move as they are. The first successful sign-in re-hashes them with Identity, so nobody resets a password.
* Two-step: TOTP secrets move into Identity when present. **Today no one has a verified factor, so no one needs to enrol again.**
* Secrets are re-entered in Admin, not copied: SMTP password and Turnstile secret.

## What I found in the live system that differs from the spec

These need your decision. Each one is marked in the code.

1. **Most data is demo data: 43 of 45 users** end in `@demo.cts.test`. With `--real-only` only 2 users and their tickets move (open decision #1).
2. **SLA targets differ.** Live: normal is 4 h / **16 h** and low is 8 h / **40 h**. The spec says 24 h and 48 h. There is also a 5th priority, **urgent** (30 min / 2 h). The seed copies the live values; the migration copies whatever is live.
3. **Organization shared access** is described in the spec, but the live access function never applies it. v2 implements it behind the global `org_shared_access_enabled` setting, which is `false` today, so behaviour is unchanged until you switch it on.
4. **Permissions:** the live table allows 19, not 16 (`manage_kb`, `manage_catalog` and `manage_settings` are extra). v2 keeps all 19.
5. **Sign-up confirmation:** today the email has a link. v2 sends a **6-digit code**, the same way as reset and sign-in codes, so there are no callback URLs to host. The new EN/AR wording is in `public/i18n/*.json` under `V2`.
6. **Priority change, known issue fixed:** the deadline is now re-counted in business hours from the cycle start, not shifted on the wall clock.
7. **Staff replying to a closed ticket** is blocked in the API, as the spec says. The live function only blocked customers.
8. **Cascades:** SQL Server rejects several of PostgreSQL's ON DELETE rules (multiple paths and cycles between profiles, organizations and branches). Those rules move into the services; see `docs/DB-NOTES.md`.

## Next delivery (proposed order)

Stage 3 admin screens (users, account types, organizations and branches, teams, approvals), then the rest of stage 4
(uploads with Defender scan, cancellation, links, duplicate/spam, feedback, escalation, custom-field admin). After that,
stages 6 and 7 admin screens, then stage 8.
