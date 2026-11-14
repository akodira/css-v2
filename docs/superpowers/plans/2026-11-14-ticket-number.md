# Ticket Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New tickets get short, descriptive numbers like `INC-26-0073`, built from a format admins can edit.

**Architecture:** A pure domain class `TicketNumberFormat` validates a pattern and renders a number. `TicketService`
reads the four settings, picks the counter period, and asks the DB counter for the next value (skipping values whose
number already exists). Ticket types gain a `Code`. A new System settings card edits the format with a live preview.

**Tech Stack:** .NET 10 / EF Core / SQL Server scripts in `database/`; Angular 22 (signals, Tailwind v4); xUnit.

**Spec:** `docs/superpowers/specs/2026-11-14-ticket-number-design.md`

## Global Constraints

- Default parts `[type, yy, seq]`, separator `-`, prefix `CTS`, digits 4, reset `yearly` → `INC-26-0073`.
- Parts: `type prefix yy yyyy mm seq`, joined by the separator (`- / . _`), so parts are always separated.
- Type code: 2–4 letters A–Z, unique, optional. Prefix: 1–6 letters/digits. Digits: 3–8.
- `seq` exactly once, no duplicate part, not both yy and yyyy; yearly needs a year part; monthly needs a year part and `mm`; longest result ≤ 30 chars.
- Counter key: yearly = YYYY, monthly = YYYY*100+MM, never = 0 (column `ticket_counters.[year]`).
- Old tickets keep their numbers. All admin text in en.json and ar.json (formal Fusha). `<app-req />` / `<app-req-note />`.
- SQL changes are idempotent and live in `01_schema.sql` (fresh), `02_seed.sql` (fresh defaults) and `05_upgrades.sql` (existing).

## Review Focus

- Format changed mid-year to one that collides with an existing number → the next free counter value is used, no 500.
- Type with no code → prefix is used (`CTS-26-0074`).
- Lower-case or spaced pattern/code input → upper-cased and trimmed on save, rejected only if still invalid.
- Monthly reset in a new month → counter starts at 1 under key 202612; yearly 2026 counter untouched.
- Counter beyond 10^digits → number grows (`INC-26-10000`), and the 30-char rule accounts for 8 digits.

---

### Task 1: `TicketNumberFormat` domain rules

**Files:**
- Modify: `src/Ccs.Domain/Rules/Formats.cs` (replace `TicketReference` with `TicketNumberFormat`)
- Test: `tests/Ccs.Tests/Domain/RulesTests.cs` (replace `Ticket_reference_format`)

**Interfaces:**
- Produces: `record TicketNumberFormat(string[] Parts, string Separator, string Prefix, int Digits, string Reset)` with
  `static TicketNumberFormat Default`, `string? Validate()` (null or an error key: `seq`, `dup`, `year`, `month`, `part`, `separator`,
  `prefix`, `digits`, `reset`, `length`), `string Render(string? typeCode, DateTimeOffset at, int seq)`,
  `int PeriodKey(DateTimeOffset at)`, `static TicketNumberFormat Normalize(string[] parts, string separator, string prefix, int digits, string reset)` (trim + upper).

- [ ] **Step 1: Tests** — `Default.Render("INC", 2026-11-14, 73) == "INC-26-0073"`; `Render(null, …, 74) == "CTS-26-0074"`;
  `Render("REQ", …, 12345) == "REQ-26-12345"`; parts [type,yyyy,mm,seq] sep `/` digits 3 → `"INC/2026/11/073"`;
  `Validate()` errors: no SEQ → `seq`, two SEQ → `seq`, yearly without year → `year`, monthly without MM → `month`,
  unknown part → `part`, separator `+` → `separator`, pattern rendering > 30 with 8 digits → `length`; `PeriodKey` yearly 2026, monthly 202611, never 0.
- [ ] **Step 2:** `dotnet test --filter RulesTests` → FAIL (type missing).
- [ ] **Step 3:** Implement. Length check renders with a 4-letter code, prefix, and `max(Digits, 8)` digits.
- [ ] **Step 4:** `dotnet test --filter RulesTests` → PASS.

### Task 2: Database + ticket type code + number generation

**Files:**
- Modify: `database/01_schema.sql` (ticket_types `code nvarchar(4) NULL` + filtered unique index `UX_ticket_types_code WHERE code IS NOT NULL`)
- Modify: `database/02_seed.sql` (app_settings defaults: `ticket_number_parts` `["type","yy","seq"]`, `ticket_number_separator` `"-"`, `ticket_number_prefix` `"CTS"`, `ticket_number_digits` `4`, `ticket_number_reset` `"yearly"`; codes for seeded types)
- Modify: `database/05_upgrades.sql` (add column + index if missing; fill codes CMP/PRB/REQ/SUG/INQ by `name_en`, else first 3 letters when free)
- Modify: `src/Ccs.Domain/Entities/Catalog.cs` (`TicketType.Code string?`)
- Modify: `src/Ccs.Application/Settings/SettingsService.cs` (`GetStringAsync`, `GetTicketNumberFormatAsync()`)
- Modify: `src/Ccs.Application/Tickets/TicketService.cs:127-134`, `Interfaces.cs:72`, `CcsDbContext.cs:154` (rename param to `periodKey`)

**Interfaces:**
- Consumes: Task 1 `TicketNumberFormat`.
- Produces: `SettingsService.GetTicketNumberFormatAsync(ct) : Task<TicketNumberFormat>` (falls back to `Default` when keys are missing or invalid).

- [ ] **Step 1:** Run the upgrade script on the local copy; confirm `SELECT name_en, code FROM ccs.ticket_types` shows the 5 codes.
- [ ] **Step 2:** In `TicketService`, load the type code, then loop (max 50): `seq = NextTicketNumberAsync(fmt.PeriodKey(now))`, `reference = fmt.Render(code, now, seq)`, stop when no ticket has that reference.
- [ ] **Step 3:** `dotnet build Ccs.slnx` → success; create a ticket through the test API → reference `REQ-26-0266`-style.

### Task 3: Admin API

**Files:**
- Modify: `src/Ccs.Api/Controllers/CatalogAdminController.cs` (`TypeBody.Code`, catalog output `t.Code`, `ApplyTypeAsync`: upper/trim, empty → null, `^[A-Z]{2,4}$` else `Err("code","code")`, taken → `Err("codeTaken","code",409)`)
- Modify: `src/Ccs.Api/Controllers/SettingsController.cs` (`GET settings/ticket-number` → `{ parts, separator, prefix, digits, reset, types:[{nameEn,nameAr,code}], counter }`; `PUT settings/ticket-number` body `{ parts, separator, prefix, digits, reset }` → `Normalize`, `Validate` → `Err(key,"parts")`, save 4 keys, audit `settings.ticket_number`). Email preview sample reference → `REQ-26-0123`.

- [ ] **Step 1:** `dotnet build` → success; `dotnet test` → all pass.

### Task 4: Web — settings card, type code field, examples

**Files:**
- Modify: `src/Ccs.Web/src/app/pages/admin/settings-pages.ts` (SystemTab: new form card "Ticket number" — ordered part chips with move left/right and remove, an add-part menu, separator choice, prefix, digits, reset radios, preview list of the next number per type computed client-side with the same render rules, `saveNumber()` → `put('ticket-number', …)`)
- Modify: `src/Ccs.Web/src/app/pages/admin/catalog-pages.ts` (TypeRow/blankType `code`, input `maxlength=4` uppercase, code chip next to the type name)
- Modify: examples `CTS-2026-000123` → `REQ-26-0123` in `lifecycle.ts`, `email-editor.ts`, `help-pages.ts`, `help/content-tickets.ts`, i18n `searchPlaceholder` and help text; e2e regexes in `cm-customers.spec.ts` and `ct-customer-tickets.spec.ts` accept both formats.
- Modify: `public/i18n/en.json`, `ar.json` (`AdminSettings.tn*`, `AdminTicketTypes.code*`, errors `code`, `codeTaken`, `seq`, `year`, `month`, `chars`, `prefix`, `digits`, `reset`, `length`).

- [ ] **Step 1:** `npx ng build --configuration production` → no errors, initial bundle under 950 kB.
- [ ] **Step 2:** On the test copy: remove the counter part → error beside Save; save default → "Saved."; set a type code → chip shows; create a ticket → new style number.

### Task 5: Release

- [ ] **Step 1:** `dotnet build Ccs.slnx`, `dotnet test`, production `ng build` all pass.
- [ ] **Step 2:** Refresh `prebuilt/ccs-web`, update `prebuilt/BUILD.txt`, commit (spec + plan + code). Ask before pushing.
