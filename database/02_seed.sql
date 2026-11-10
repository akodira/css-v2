/* =====================================================================
   CCS v2 - reference data for a FRESH install.
   During migration (migration/README.md) these tables are overwritten
   with the live data instead, so ids and wording match production.
   Idempotent: every insert is guarded.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes and computed columns (sqlcmd defaults to OFF)
GO

SET NOCOUNT ON;

MERGE ccs.roles AS t USING (VALUES
  (1, N'customer', N'Customer'), (2, N'agent', N'Support Agent'), (3, N'team_leader', N'Team Leader'),
  (4, N'admin', N'System Administrator'), (5, N'management_viewer', N'Management Viewer')
) AS s(id, code, name) ON t.id = s.id
WHEN NOT MATCHED THEN INSERT (id, code, name) VALUES (s.id, s.code, s.name);

MERGE ccs.priorities AS t USING (VALUES
  (N'critical', N'Critical', N'حرجة', N'red', N'alert', 10),
  (N'high', N'High', N'عالية', N'amber', N'arrow_up', 20),
  (N'normal', N'Normal', N'عادية', N'grey', N'minus', 30),
  (N'low', N'Low', N'منخفضة', N'light', N'arrow_down', 40)
) AS s(code, name_en, name_ar, color, icon, sort_order) ON t.code = s.code
WHEN NOT MATCHED THEN INSERT (code, name_en, name_ar, color, icon, sort_order) VALUES (s.code, s.name_en, s.name_ar, s.color, s.icon, s.sort_order);

MERGE ccs.closure_reasons AS t USING (VALUES
  (N'resolved_confirmed', N'Resolved and confirmed', N'تم الحل وتأكيده', 1, 10),
  (N'auto_closed', N'Closed automatically after resolution', N'أُغلقت تلقائيًا بعد الحل', 1, 20),
  (N'no_response', N'No customer response', N'لا يوجد رد من العميل', 1, 30),
  (N'duplicate', N'Duplicate', N'مكررة', 0, 40),
  (N'spam', N'Spam', N'مزعجة (سبام)', 0, 50),
  (N'cancelled', N'Customer cancellation', N'إلغاء من العميل', 1, 60),
  (N'other', N'Other', N'أخرى', 1, 70)
) AS s(code, name_en, name_ar, may_reopen, sort_order) ON t.code = s.code
WHEN NOT MATCHED THEN INSERT (code, name_en, name_ar, customer_may_reopen, is_system, sort_order) VALUES (s.code, s.name_en, s.name_ar, s.may_reopen, 1, s.sort_order);

IF NOT EXISTS (SELECT 1 FROM ccs.ticket_status_transitions)
INSERT INTO ccs.ticket_status_transitions (from_status, to_status, actor, requires_reason) VALUES
  (N'closed', N'reopened', N'customer', 1),
  (N'resolved', N'closed', N'customer', 0),
  (N'resolved', N'reopened', N'customer', 1),
  (N'closed', N'reopened', N'staff', 1),
  (N'in_progress', N'open', N'staff', 0),
  (N'in_progress', N'pending_customer', N'staff', 0),
  (N'in_progress', N'pending_internal', N'staff', 0),
  (N'in_progress', N'resolved', N'staff', 0),
  (N'new', N'closed', N'staff', 1),
  (N'new', N'in_progress', N'staff', 0),
  (N'new', N'open', N'staff', 0),
  (N'new', N'pending_internal', N'staff', 0),
  (N'open', N'in_progress', N'staff', 0),
  (N'open', N'pending_customer', N'staff', 0),
  (N'open', N'pending_internal', N'staff', 0),
  (N'open', N'resolved', N'staff', 0),
  (N'pending_customer', N'closed', N'staff', 1),
  (N'pending_customer', N'in_progress', N'staff', 0),
  (N'pending_customer', N'resolved', N'staff', 0),
  (N'pending_internal', N'in_progress', N'staff', 0),
  (N'pending_internal', N'resolved', N'staff', 0),
  (N'reopened', N'in_progress', N'staff', 0),
  (N'reopened', N'pending_customer', N'staff', 0),
  (N'reopened', N'pending_internal', N'staff', 0),
  (N'reopened', N'resolved', N'staff', 0);

IF NOT EXISTS (SELECT 1 FROM ccs.business_hours)
INSERT INTO ccs.business_hours (name, timezone, weekly_schedule, is_default) VALUES
  (N'Default (Cairo)', N'Africa/Cairo',
   N'{"sun":[["09:00","17:00"]],"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[],"sat":[]}', 1);

/* SLA test defaults (spec 4: NOT approved numbers - open decision #6) */
IF NOT EXISTS (SELECT 1 FROM ccs.sla_policies)
INSERT INTO ccs.sla_policies (name, priority, first_response_minutes, resolution_minutes, business_hours_id, escalation_rules)
SELECT s.name, s.priority, s.frm, s.rm, (SELECT id FROM ccs.business_hours WHERE is_default = 1),
       N'[{"event":"warning","notify":["agent","team_leader"]},{"event":"breach","notify":["agent","team_leader","admin"]}]'
FROM (VALUES (N'TEST DEFAULT (critical)', N'critical', 15, 240), (N'TEST DEFAULT (high)', N'high', 60, 480),
             (N'TEST DEFAULT (normal)', N'normal', 240, 960), (N'TEST DEFAULT (low)', N'low', 480, 2400)) s(name, priority, frm, rm);

MERGE ccs.app_settings AS t USING (VALUES
  (N'customer_can_set_priority', N'false'), (N'max_attachment_bytes', N'10485760'), (N'max_attachments_per_message', N'5'),
  (N'org_shared_access_enabled', N'false'), (N'auto_close_days', N'5'), (N'email_enabled', N'true'),
  (N'reopen_window_days', N'30'), (N'min_reply_chars', N'20'), (N'pending_reminder_1_day', N'2'),
  (N'pending_reminder_2_day', N'4'), (N'pending_final_day', N'7'), (N'no_response_close_days', N'10'),
  (N'resolved_reminder_day', N'3'), (N'password_min_length', N'10'), (N'password_require_upper', N'true'),
  (N'password_require_lower', N'true'), (N'password_require_number', N'true'), (N'password_require_special', N'true'),
  (N'password_expiry_enabled', N'false'), (N'password_expiry_days', N'90'), (N'password_warn_1_days', N'7'),
  (N'password_warn_2_days', N'4'), (N'password_warn_3_days', N'1'), (N'auto_refresh_seconds', N'30')
) AS s([key], value) ON t.[key] = s.[key]
WHEN NOT MATCHED THEN INSERT ([key], value) VALUES (s.[key], s.value);

IF NOT EXISTS (SELECT 1 FROM ccs.site_settings) INSERT INTO ccs.site_settings (id) VALUES (1);
IF NOT EXISTS (SELECT 1 FROM ccs.email_settings) INSERT INTO ccs.email_settings (id) VALUES (1);
IF NOT EXISTS (SELECT 1 FROM ccs.captcha_settings) INSERT INTO ccs.captcha_settings (id) VALUES (1);
IF NOT EXISTS (SELECT 1 FROM ccs.signin_code_settings) INSERT INTO ccs.signin_code_settings (id, enabled, audience) VALUES (1, 1, N'all');

/* Identity roles mirror ccs.roles so [Authorize(Roles=...)] works */
MERGE dbo.AspNetRoles AS t USING (VALUES
  (N'customer'), (N'agent'), (N'team_leader'), (N'admin'), (N'management_viewer')
) AS s(name) ON t.NormalizedName = UPPER(s.name)
WHEN NOT MATCHED THEN INSERT (Id, Name, NormalizedName, ConcurrencyStamp) VALUES (NEWID(), s.name, UPPER(s.name), CONVERT(nvarchar(36), NEWID()));
