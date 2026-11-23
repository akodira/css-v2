/* =====================================================================
   CCS v2 - schema corrections for databases created by an earlier release.
   Runs on every install and update (after 02_seed.sql). Every step is idempotent.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
SET NOCOUNT ON;

/* 1. Custom field values: SQL Server's ISJSON() rejects a plain JSON string ("text"), so text, date and
      dropdown values could not be saved. Accept a quoted string as well. */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_cfv_value'
           AND definition NOT LIKE N'%LEFT(%')
BEGIN
    ALTER TABLE ccs.ticket_custom_field_values DROP CONSTRAINT CK_cfv_value;
    ALTER TABLE ccs.ticket_custom_field_values ADD CONSTRAINT CK_cfv_value
        CHECK (ISJSON(value) = 1 OR value IN ('true','false','null') OR ISNUMERIC(value) = 1
               OR (LEN(value) >= 2 AND LEFT(value, 1) = N'"' AND RIGHT(value, 1) = N'"'));
END
GO

/* Data Protection key ring in the database (Nov 2026). The keys are encrypted with the "CCS Data Protection"
   certificate, which stays outside the database; moving to a new server = restore the database + import that
   certificate (deploy\Export-KeyCertificate.cmd on the old server). */
IF OBJECT_ID(N'ccs.data_protection_keys', N'U') IS NULL
    CREATE TABLE ccs.data_protection_keys (
        id            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_data_protection_keys PRIMARY KEY,
        friendly_name nvarchar(200) NULL,
        xml           nvarchar(max) NOT NULL,
        created_at    datetime2(3) NOT NULL CONSTRAINT DF_data_protection_keys_created DEFAULT SYSUTCDATETIME()
    );
GO

/* Ticket number (Nov 2026): a short code per ticket type, used in numbers like INC-26-0073. Known types get their
   codes; any other type gets its first 3 letters when they are free. Admins can change them on the Ticket types page. */
IF COL_LENGTH(N'ccs.ticket_types', N'code') IS NULL
    ALTER TABLE ccs.ticket_types ADD code nvarchar(4) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_types_code' AND object_id = OBJECT_ID(N'ccs.ticket_types'))
BEGIN
    UPDATE t SET code = s.code
    FROM ccs.ticket_types t
    JOIN (VALUES (N'Complaint', N'CMP'), (N'Report a Problem', N'PRB'), (N'Request a Service', N'REQ'),
                 (N'Suggestion / Feedback', N'SUG'), (N'Inquiry', N'INQ')) s(name_en, code) ON t.name_en = s.name_en
    WHERE t.code IS NULL AND NOT EXISTS (SELECT 1 FROM ccs.ticket_types x WHERE x.code = s.code);

    DECLARE @id uniqueidentifier, @c nvarchar(4);
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT id, UPPER(LEFT(name_en, 3)) FROM ccs.ticket_types WHERE code IS NULL ORDER BY sort_order, name_en;
    OPEN cur; FETCH NEXT FROM cur INTO @id, @c;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF LEN(@c) = 3 AND @c NOT LIKE N'%[^A-Z]%' AND NOT EXISTS (SELECT 1 FROM ccs.ticket_types WHERE code = @c)
            UPDATE ccs.ticket_types SET code = @c WHERE id = @id;
        FETCH NEXT FROM cur INTO @id, @c;
    END
    CLOSE cur; DEALLOCATE cur;

    CREATE UNIQUE INDEX UX_ticket_types_code ON ccs.ticket_types (code) WHERE code IS NOT NULL;
END
GO

/* Sign-in codes (Nov 2026): who may use them is three check boxes (customers, staff, administrators) plus
   whether staff and administrators also need two-step verification. Carries over the old single choice. */
IF COL_LENGTH(N'ccs.signin_code_settings', N'for_customers') IS NULL
BEGIN
    ALTER TABLE ccs.signin_code_settings ADD
        for_customers bit NOT NULL CONSTRAINT DF_signin_code_for_customers DEFAULT 1,
        for_staff bit NOT NULL CONSTRAINT DF_signin_code_for_staff DEFAULT 0,
        for_admins bit NOT NULL CONSTRAINT DF_signin_code_for_admins DEFAULT 0,
        staff_need_two_factor bit NOT NULL CONSTRAINT DF_signin_code_staff_2fa DEFAULT 1;
    -- Once, when the columns are added (dynamic SQL: the new columns are not visible to this batch yet).
    EXEC (N'UPDATE ccs.signin_code_settings SET for_staff = 1, for_admins = 1 WHERE audience = N''all'';');
END
GO

/* Sign-in codes: with or without two-step verification is chosen per group (customers, staff, administrators).
   Administrators start with the staff choice; customers start without. */
IF COL_LENGTH(N'ccs.signin_code_settings', N'admins_need_two_factor') IS NULL
BEGIN
    ALTER TABLE ccs.signin_code_settings ADD
        customers_need_two_factor bit NOT NULL CONSTRAINT DF_signin_code_customers_2fa DEFAULT 0,
        admins_need_two_factor bit NOT NULL CONSTRAINT DF_signin_code_admins_2fa DEFAULT 1;
    EXEC (N'UPDATE ccs.signin_code_settings SET admins_need_two_factor = staff_need_two_factor;');
END
GO

/* Branding (Nov 2026): a wide logo with a white version for dark backgrounds, an editable footer and social links. */
IF COL_LENGTH(N'ccs.site_settings', N'wordmark_path') IS NULL
    ALTER TABLE ccs.site_settings ADD
        wordmark_path nvarchar(200) NULL,
        wordmark_dark_path nvarchar(200) NULL,
        footer_config nvarchar(max) NOT NULL CONSTRAINT DF_site_footer_config DEFAULT N'{}',
        social_links nvarchar(max) NOT NULL CONSTRAINT DF_site_social_links DEFAULT N'{}';
GO

/* Footer logo (Nov 2026): optional logo for the site and email footers; empty = the wide logo. */
IF COL_LENGTH(N'ccs.site_settings', N'footer_logo_path') IS NULL
    ALTER TABLE ccs.site_settings ADD footer_logo_path nvarchar(200) NULL;
GO

-- The customer "header" menu is the customers' side menu; staff never see it. Remove the staff-only Console link
-- (copied from v1) that nobody could see.
DELETE FROM ccs.menu_items WHERE area = N'header' AND system_key IS NULL AND audience = N'staff' AND href = N'/console/dashboard';
GO

-- Show the wide logo above the sign-in forms: a Branding switch, off by default.
IF COL_LENGTH(N'ccs.site_settings', N'auth_logo') IS NULL
    ALTER TABLE ccs.site_settings ADD auth_logo bit NOT NULL CONSTRAINT DF_site_settings_auth_logo DEFAULT 0;
GO

-- Notifications becomes a built-in item of the customer side menu, so Settings -> Menus lists it (move or hide it there).
-- Only where that menu has items (an empty menu shows the standard list, which already includes Notifications).
IF EXISTS (SELECT 1 FROM ccs.menu_items WHERE area = N'header')
   AND NOT EXISTS (SELECT 1 FROM ccs.menu_items WHERE area = N'header' AND (system_key = N'notifications' OR href = N'/notifications'))
    INSERT INTO ccs.menu_items (area, kind, label_en, label_ar, href, audience, sort_order, system_key)
    SELECT N'header', N'link', N'Notifications', N'الإشعارات', N'/notifications', N'signed_in',
           ISNULL(MAX(sort_order), 0) + 10, N'notifications'
    FROM ccs.menu_items WHERE area = N'header' AND parent_id IS NULL;
GO
-- An existing /notifications link becomes the built-in one.
UPDATE ccs.menu_items SET system_key = N'notifications'
WHERE area = N'header' AND href = N'/notifications' AND system_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM ccs.menu_items WHERE area = N'header' AND system_key = N'notifications');
GO

-- Home and sign-in pages: New / Classic look, the sign-in picture (built-in drawing or an upload) and its texts.
IF COL_LENGTH(N'ccs.site_settings', N'auth_design') IS NULL
    ALTER TABLE ccs.site_settings ADD auth_design nvarchar(max) NOT NULL CONSTRAINT DF_site_auth_design DEFAULT N'{}';
GO
IF COL_LENGTH(N'ccs.site_settings', N'signin_picture_path') IS NULL
    ALTER TABLE ccs.site_settings ADD signin_picture_path nvarchar(200) NULL;
GO

-- Account lockout (Settings -> Security): the three dates next to Identity's failed count and "locked until".
IF COL_LENGTH(N'dbo.AspNetUsers', N'FailedWindowStart') IS NULL ALTER TABLE dbo.AspNetUsers ADD FailedWindowStart datetimeoffset(7) NULL;
GO
IF COL_LENGTH(N'dbo.AspNetUsers', N'LastFailedAt') IS NULL ALTER TABLE dbo.AspNetUsers ADD LastFailedAt datetimeoffset(7) NULL;
GO
IF COL_LENGTH(N'dbo.AspNetUsers', N'LockedAt') IS NULL ALTER TABLE dbo.AspNetUsers ADD LockedAt datetimeoffset(7) NULL;
GO
-- Locks made by the old fixed rule (10 tries, 15 minutes) keep their end time; give them a start so the admin page can show them.
UPDATE dbo.AspNetUsers SET LockedAt = DATEADD(minute, -15, LockoutEnd) WHERE LockoutEnd > SYSUTCDATETIME() AND LockedAt IS NULL;
GO

-- Security extras: one sign-in (session) across refresh-token rotations, and password history (one-way hashes only).
IF COL_LENGTH(N'ccs.refresh_tokens', N'session_id') IS NULL ALTER TABLE ccs.refresh_tokens ADD session_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.refresh_tokens', N'session_started_at') IS NULL ALTER TABLE ccs.refresh_tokens ADD session_started_at datetimeoffset(7) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_refresh_tokens_session' AND object_id = OBJECT_ID(N'ccs.refresh_tokens'))
    CREATE INDEX IX_refresh_tokens_session ON ccs.refresh_tokens (session_id) INCLUDE (revoked_at, expires_at);
GO
IF OBJECT_ID(N'ccs.password_history') IS NULL
BEGIN
    CREATE TABLE ccs.password_history (
        id            bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_password_history PRIMARY KEY,
        user_id       uniqueidentifier NOT NULL CONSTRAINT FK_password_history_user REFERENCES dbo.AspNetUsers(Id) ON DELETE CASCADE,
        password_hash nvarchar(max) NOT NULL,
        created_at    datetimeoffset(7) NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_password_history_user ON ccs.password_history (user_id, created_at DESC);
END
GO

-- Saved replies shared with one team (the owner's team): any member can use them; only the owner changes them.
IF COL_LENGTH(N'ccs.canned_responses', N'team_id') IS NULL ALTER TABLE ccs.canned_responses ADD team_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_canned_team')
    ALTER TABLE ccs.canned_responses ADD CONSTRAINT FK_canned_team FOREIGN KEY (team_id) REFERENCES ccs.teams(id) ON DELETE SET NULL;
GO

-- Staff and Permissions, Plan B: an account type says WHAT a person can do; each person's Works in says WHERE.
-- Once: people who got their places only from their account type keep them as their own Works in,
-- then those types stop limiting places. Types with no places at all are left as they are (their people keep no access).
IF EXISTS (SELECT 1 FROM ccs.account_types t WHERE t.all_access = 0 AND t.is_builtin = 0 AND t.scope_level IS NULL
           AND EXISTS (SELECT 1 FROM ccs.account_type_access a WHERE a.account_type_id = t.id))
BEGIN
    BEGIN TRAN;
    INSERT INTO ccs.staff_placement (id, user_id, organization_id, branch_id)
    SELECT NEWID(), p.id, a.organization_id, a.branch_id
    FROM ccs.profiles p
    JOIN ccs.account_types t ON t.id = p.account_type_id
    JOIN ccs.account_type_access a ON a.account_type_id = t.id
    WHERE t.all_access = 0 AND t.is_builtin = 0 AND t.scope_level IS NULL
      AND NOT EXISTS (SELECT 1 FROM ccs.staff_placement s WHERE s.user_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM ccs.admin_scopes s WHERE s.user_id = p.id);
    UPDATE t SET all_access = 1
    FROM ccs.account_types t
    WHERE t.all_access = 0 AND t.is_builtin = 0 AND t.scope_level IS NULL
      AND EXISTS (SELECT 1 FROM ccs.account_type_access a WHERE a.account_type_id = t.id);
    COMMIT;
END
GO

-- (Arabic text in this block is written as UTF-16 bytes so it reads the same whatever code page sqlcmd uses.)
-- Ticket flows: several named flows. The old single table becomes the "Standard flow"; every move belongs to a flow;
-- each ticket keeps the flow it started with; a ticket type or a category (Settings: flow_choice) picks the flow of new tickets.
IF OBJECT_ID(N'ccs.ticket_flows') IS NULL
BEGIN
    CREATE TABLE ccs.ticket_flows (
        id          uniqueidentifier NOT NULL CONSTRAINT PK_ticket_flows PRIMARY KEY,
        name_en     nvarchar(80) NOT NULL,
        name_ar     nvarchar(80) NOT NULL,
        description nvarchar(300) NOT NULL CONSTRAINT DF_ticket_flows_desc DEFAULT N'',
        is_default  bit NOT NULL CONSTRAINT DF_ticket_flows_default DEFAULT 0,
        statuses    nvarchar(300) NOT NULL,
        created_at  datetimeoffset(7) NOT NULL CONSTRAINT DF_ticket_flows_created DEFAULT SYSUTCDATETIME(),
        updated_at  datetimeoffset(7) NOT NULL CONSTRAINT DF_ticket_flows_updated DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_ticket_flows_name_en ON ccs.ticket_flows (name_en);
END
GO
IF NOT EXISTS (SELECT 1 FROM ccs.ticket_flows WHERE id = 'f1000000-0000-4000-8000-000000000001')
    INSERT INTO ccs.ticket_flows (id, name_en, name_ar, description, is_default, statuses)
    VALUES ('f1000000-0000-4000-8000-000000000001', N'Standard flow', CAST(0x27064406450633062706310620002706440642064A06270633064A06 AS nvarchar(80)),
            N'New, Open, In progress, Resolved, Closed, with waiting and reopen.', 1,
            N'new,open,in_progress,pending_customer,pending_internal,resolved,closed,reopened');
GO
-- Every move belongs to a flow; existing moves (and any the seed adds) go to the Standard flow.
IF COL_LENGTH(N'ccs.ticket_status_transitions', N'flow_id') IS NULL
    ALTER TABLE ccs.ticket_status_transitions ADD flow_id uniqueidentifier NOT NULL
        CONSTRAINT DF_transitions_flow DEFAULT 'f1000000-0000-4000-8000-000000000001';
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'PK_ticket_status_transitions'
           AND NOT EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                           WHERE ic.object_id = OBJECT_ID(N'ccs.ticket_status_transitions') AND ic.index_id = sys.key_constraints.unique_index_id AND c.name = N'flow_id'))
BEGIN
    ALTER TABLE ccs.ticket_status_transitions DROP CONSTRAINT PK_ticket_status_transitions;
    ALTER TABLE ccs.ticket_status_transitions ADD CONSTRAINT PK_ticket_status_transitions PRIMARY KEY (flow_id, from_status, to_status, actor);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_transitions_flow')
    ALTER TABLE ccs.ticket_status_transitions ADD CONSTRAINT FK_transitions_flow FOREIGN KEY (flow_id) REFERENCES ccs.ticket_flows(id) ON DELETE CASCADE;
GO
IF COL_LENGTH(N'ccs.tickets', N'flow_id') IS NULL ALTER TABLE ccs.tickets ADD flow_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.ticket_types', N'flow_id') IS NULL ALTER TABLE ccs.ticket_types ADD flow_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.ticket_categories', N'flow_id') IS NULL ALTER TABLE ccs.ticket_categories ADD flow_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_tickets_flow')
    ALTER TABLE ccs.tickets ADD CONSTRAINT FK_tickets_flow FOREIGN KEY (flow_id) REFERENCES ccs.ticket_flows(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ticket_types_flow')
    ALTER TABLE ccs.ticket_types ADD CONSTRAINT FK_ticket_types_flow FOREIGN KEY (flow_id) REFERENCES ccs.ticket_flows(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ticket_categories_flow')
    ALTER TABLE ccs.ticket_categories ADD CONSTRAINT FK_ticket_categories_flow FOREIGN KEY (flow_id) REFERENCES ccs.ticket_flows(id);
GO
-- Tickets that are still open keep working exactly as before: they follow the Standard flow.
UPDATE ccs.tickets SET flow_id = 'f1000000-0000-4000-8000-000000000001' WHERE flow_id IS NULL AND status <> N'closed';
GO
