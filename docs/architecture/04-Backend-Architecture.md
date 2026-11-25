# 04 — Backend Architecture

## 1. Entry point: `src/Ccs.Api/Program.cs`

`Program.cs` does three things:

1. **Command mode.** `create-admin` and `import-supabase` run `AdminSetup.RunAsync` / `SupabaseImport.RunAsync`
   and exit without starting the web server (lines 17–23). The installer uses `create-admin`.
2. **Service registration** (lines 25–95):
   - Serilog, and `AddCcsInfrastructure` (which calls `AddCcsApplication`);
   - `HttpCurrentUser`, `CaptchaVerifier`, `AppExceptionHandler`, ProblemDetails;
   - controllers with camelCase JSON;
   - JWT bearer, authorization policies, rate limiter;
   - optional CORS, a SQL health check, Swagger, HSTS.
   - Start-up fails if `Jwt:SigningKey` is shorter than 32 bytes (lines 41–43).
3. **Pipeline** (lines 99–146) and a one-time `KeyRingMigration.RunAsync` (moves old file-based keys into SQL).

### Request pipeline (order as written)

| # | Step | Purpose |
|---|---|---|
| 1 | Inline middleware | IIS gives `PathBase=/api` when the API is the `/api` application; it is moved back into `Path` so routes stay `api/...` |
| 2 | `UseRouting` | Explicitly after the path fix |
| 3 | `UseForwardedHeaders` | `X-Forwarded-For`, `X-Forwarded-Proto` |
| 4 | `UseSerilogRequestLogging` | 5xx and exceptions → Error, everything else → Information |
| 5 | `UseExceptionHandler` | `AppExceptionHandler` (RFC 7807) |
| 6 | `UseHsts` (non-development), `UseHttpsRedirection` | |
| 7 | Inline headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` |
| 8 | `UseCors` | Only when `Cors:WebOrigin` is set (separate API site) |
| 9 | `UseAuthentication` | JWT bearer |
| 10 | `UseRateLimiter` | Policies `auth`, `writes`, `uploads` |
| 11 | `AccountGateMiddleware` | Session alive, account active, MFA level, required MFA setup (`Middleware/Web.cs`) |
| 12 | `UseAuthorization` | Default policy: signed in **and** not an MFA step token |
| 13 | Endpoints | Controllers, `/api/health`, `/api/jobs` (Hangfire, loopback only) |

## 2. Controllers

27 files (some are `partial` classes split by topic), 247 HTTP actions. Grouped by route prefix:

| Prefix | Controllers | Pattern |
|---|---|---|
| `api/auth` | `AuthController` | Thin; calls `AuthService`; sets or clears the `ccs_rt` cookie |
| `api/me`, `api/site` | `MeController`, `SiteController` (both in `SiteController.cs`) | Profile, own sessions; public site data and images |
| `api/tickets` | `TicketsController`, `TicketLifecycleController`, `TicketStaffController`, `AttachmentsController`, `CreatableCustomersController` | Ticket writes go through `TicketService` / `TicketLifecycleService`; attachments and staff lists use `CcsDbContext` directly |
| `api/console` | `ConsoleController`, `PeopleController` (people, branches), `CustomerProfileController`, `ReportsController` (`my-team`) | Mostly direct EF Core queries filtered by `AccessService` |
| `api/admin` | `AdminController`, `CatalogAdminController` (+`.Places`, `.Calendars`), `ContentAdminController` (+`.Flows`, `.CustomStatuses`), `PeopleController` (+`.Teams`, `.Setup`), `SettingsController` (+`.Security`, `.SecurityExtras`), `ReportsController` (`audit`) | Logic and data access inside the controller |
| `api/kb`, `api/canned` | `KbController`, `CannedController` (in `ContentAdminController.cs`) | Direct EF Core |
| `api/notifications` | `NotificationsController` | Direct EF Core |
| `api/reports` | `ReportsController` | Direct EF Core; Excel export via `SimpleXlsx.cs` |

Common controller helpers: a private `Need(permission)` helper (for example `AdminController` lines 52–57) calls
`access.RequireSignedInAsync`, then allows admins or holders of the named permission, and otherwise throws
`ForbiddenException`. Scope checks use `AccessRules.InScope` / `Covers(...)`.

## 3. Application services (`src/Ccs.Application`)

Registered in `Application/DependencyInjection.cs` (all scoped, `IClock` singleton):

| Service | File | Responsibility |
|---|---|---|
| `AccessService` | `Access/AccessService.cs` | Builds `AccessContext` (roles, permissions, teams, scope, MFA state); `VisibleTickets()` list filter; `RequireTicketAsync()`; `RequireAdminAsync()` |
| `TicketService` | `Tickets/TicketService.cs` | Create, status change, messages, assign, routing (`RouteAsync`), auto-assign (`AutoAssignAsync`), priority |
| `TicketLifecycleService` | `Tickets/TicketLifecycleService.cs` | Category change, escalation, duplicate, spam, staff fields, edit/delete message, cancellation requests, feedback, follow-up link |
| `TicketQueries`, `CatalogQueries` | `Tickets/*.cs` | Read models for lists, detail, new-ticket options |
| `PlaceCatalog` | `Tickets/PlaceCatalog.cs` | What a place uses and what a customer may pick (types, categories, sub-categories, links) |
| `CustomFieldValidator`, `FlowLookup` | `Tickets/*.cs` | Custom field values; which status flow applies |
| `SlaService` | `Sla/SlaService.cs` | Start, pause, resume, first response, complete, reopen cycle, priority change, `TickAsync` |
| `LifecycleService` | `Sla/LifecycleService.cs` | Reminders, auto-close, no-response close, pending-internal reminders, password expiry |
| `NotificationService` | `Notifications/NotificationService.cs` | Event → recipients → `ccs.notifications` rows (in-app and email) |
| `AuditService` | `Common/AuditService.cs` | Writes `ccs.audit_logs` |
| `SettingsService` | `Settings/SettingsService.cs` | Typed reads of `ccs.app_settings`, cached for one request |
| `CalendarProvider` | `Sla/SlaService.cs` | Business calendars for SLA maths |

## 4. Domain (`src/Ccs.Domain`)

- `Entities/People.cs`, `Catalog.cs`, `Tickets.cs`, `System.cs`: plain classes mapped by EF Core, with **no navigation
  properties** (comment in `TicketService.CreateAsync`: "No navigation properties: save the ticket first …").
- `Codes.cs`: `TicketStatus`, `RoleCode`, `AccountStatus`, `MessageKind`, `Permission`, `ClosureReasonCode`,
  `SlaState`, `NotificationEvent`.
- `Rules/*.cs`: pure functions with unit tests. Examples:
  - `StatusFlow.Evaluate`, the whole status-change check;
  - `AccessRules.EffectivePermissions` / `CanAccessTicket` / `InScope`;
  - `BusinessCalendar` and `SlaClock`, business-time maths;
  - `LockoutRules`;
  - `TeamRouting`;
  - `TicketTimers`;
  - `FileSignature`, which checks magic bytes of uploads;
  - `FlowRules`, `CustomStatuses`, `AccountKinds`, `SecurityExtras`, `Formats`, `AuditFields`.

## 5. Infrastructure (`src/Ccs.Infrastructure`)

| Area | Classes | Notes |
|---|---|---|
| Persistence | `CcsDbContext` | EF Core SQL Server, command timeout 60 s, **no retry strategy** (explicit transactions); `NextTicketNumberAsync` (raw `MERGE … HOLDLOCK`) |
| Identity | `AppUser`, `BcryptCompatiblePasswordHasher`, `SettingsPasswordValidator`, `MfaStatus` (`IdentityParts.cs`) | Identity Core with roles, EF stores, default token providers |
| Auth | `AuthService`, `TokenService`, `LockoutService`, `AccountSecurity`, `AccountApprovers` | See [06](06-Security-Architecture.md) |
| Email | `TemplateMailer`, `EmailDispatcher`, `SmtpEmailSender` (`Mail.cs`), `EmailRenderer`, `EmailAssets`, `SocialLinks` | Default templates in `email-defaults.json` |
| Files | `LocalFileStore`, `DefenderFileScanner` (`Files/LocalFileStore.cs`) | Path traversal guard; scanning by `MpCmdRun.exe` |
| Jobs | `CcsJobs` | Hangfire recurring jobs; 2 workers |
| Security | `KeyRing` | ASP.NET Data Protection keys in `ccs.data_protection_keys`, encrypted with a certificate |

## 6. Error handling

- Business errors derive from `AppException(message, status, code)` (`Application/Common/Errors.cs`):

  | Exception | Status |
  |---|---|
  | `NotAuthenticatedException` | 401 |
  | `ForbiddenException` | 403 |
  | `NotFoundException` | 404 |
  | `ValidationFailedException` | 400, with a `field` |
  | `ConflictException` | 409 |
  | `RateLimitedException` | 429 |

  `AuthError` (Identity flows) carries its own status and field.
- `AppExceptionHandler` (`Middleware/Web.cs` line 93):
  - maps those exceptions, and FluentValidation's `ValidationException`, to ProblemDetails with `code` and `field`;
  - turns any other exception into a 500 with no internal detail, logged as an error.
- `AccountGateMiddleware` writes its own ProblemDetails (`sessionEnded`, `pendingApproval`, `suspended`,
  `mfaRequired`, `mfaSetupRequired`).

## 7. Transactions and concurrency

- 26 explicit `BeginTransactionAsync` calls, for example in each `TicketService` write and in
  `TicketLifecycleService`.
- `ccs.tickets.row_version` is a `rowversion`. A concurrent edit ends in `DbUpdateConcurrencyException` and then a
  409 ("the ticket was changed by someone else", `TicketService` line 529).
- Counters and queues use SQL locking hints, not application locks:
  - ticket numbers: `MERGE … HOLDLOCK`;
  - email claim: `UPDLOCK, READPAST`;
  - SLA events: a unique index removes duplicates (`SlaService` comment: "the unique index did its job").

## 8. Tests

| Suite | Location | Focus |
|---|---|---|
| Domain | `tests/Ccs.Tests/Domain/*` (11 files) | Access rules, status flow, calendar and SLA, lockout, routing, timers, uploads and audit |
| Application | `tests/Ccs.Tests/Application/AccessParityTests.cs` | LINQ filter equals the in-memory rule |
| Infrastructure | `tests/Ccs.Tests/Infrastructure/*` | Approver selection, email renderer |
| End to end | `tests/e2e/specs/*.spec.ts` (28 specs, Playwright) | Customer and staff ticket flows, scoped admins and others |

There are **no tests that run controllers against a real database** in `tests/Ccs.Tests`. The CI job "Deploy to IIS +
SQL Server 2022 and test" runs smoke tests against a real installation (see [09](09-Deployment-Architecture.md)).

## 9. Observations

| Observation | Where |
|---|---|
| Admin and configuration logic sits in controllers next to EF Core queries | 16 of 27 controller files inject `CcsDbContext`; `SettingsController.cs` 993 lines, `AdminController.cs` 934 |
| Application layer depends on EF Core types | `ICcsDbContext` exposes `DbSet<T>` |
| `AccessContext` costs several queries per request | `AccessService.BuildContextAsync`: profile, roles, account type, permissions, teams, placements, scopes, and sometimes the org tree and shared access |
| Import tool ships inside the production API | `SupabaseImport.cs` and the `Npgsql` package in `Ccs.Api.csproj` |
| Floating package versions | `10.0.*`, `9.*`, `1.8.*` in the `.csproj` files; no NuGet lock file |
