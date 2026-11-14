# Ticket number: shorter, descriptive, editable (approved 2026-11-14)

## Why
`CTS-2026-000073` (15 characters) is long and says nothing about the ticket. Agents and customers read and type it
on the phone and in email. The number should be shorter, show the kind of ticket, and be changeable by an admin.

## Decided
- Default format (option A, with separators): parts Type code, Year (2 digits), Counter joined by `-` → `INC-26-0073` (11 characters).
- One shared counter for all ticket types, so every number is unique on its own. The current yearly counter
  continues (2026 is at 265, so the next ticket is e.g. `REQ26-0266`).
- Old tickets keep their numbers. Search, duplicate lookup and emails work with both formats.

## Approaches considered
- A Type-Year-Counter (picked, with separators after review: `INC-26-0073`): shortest that still tells the type.
- B `{TYPE}-{YY}{MM}-{SEQ}`: adds the month, 12 characters.
- C `{PREFIX}{YY}-{SEQ}`: short but says only the year.
- Counter per type (rejected): smaller numbers, but "ticket 73" alone becomes ambiguous.

## Design
- **Ticket type code**: new column `ticket_types.code` (2–4 letters A–Z, unique, optional), edited on the
  Ticket types page. The upgrade script fills codes for the known types: Complaint `CMP`, Report a Problem `PRB`,
  Request a Service `REQ`, Suggestion / Feedback `SUG`, Inquiry `INQ`; other types get their first 3 letters when
  free. A type without a code uses the prefix.
- **Settings** (app_settings, new card "Ticket number" on Settings → System):
  - `ticket_number_parts`: ordered list from `type`, `prefix`, `yy`, `yyyy`, `mm`, `seq` (default `["type","yy","seq"]`). Admins add, remove and reorder parts.
  - `ticket_number_separator`: one of `-` `/` `.` `_` (default `-`). Every two parts are always separated by it.
  - `ticket_number_prefix` (default `CTS`, 1–6 letters/digits).
  - `ticket_number_digits` (default 4, 3–8): minimum counter width; it grows when needed.
  - `ticket_number_reset`: `yearly` (default), `monthly`, `never`.
  - Live preview of the next number, for each ticket type.
- **Rules** (checked on save): the counter exactly once; no part twice; not both year parts; yearly reset needs a year block; monthly needs a year and
  the month; the longest possible result must fit in 30 characters.
- **Counter**: `ticket_counters.[year]` becomes the counter period key: yearly = 2026, monthly = 202611,
  never = 0. If a generated number already exists (e.g. after a format change), the next counter value is taken.
- Example numbers in help text, email token help and placeholders change to the new style.

## Non-goals
- Renumbering old tickets. Per-type counters. Organization codes in the number.
