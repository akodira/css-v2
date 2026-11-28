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

-- The admin's own statuses. Each behaves like a built-in working or waiting status: tickets.status holds that built-in status
-- (SLA timer, reminders, reports unchanged) and tickets.custom_status the admin's code. Names and colour are system messages.
IF OBJECT_ID(N'ccs.ticket_custom_statuses') IS NULL
    CREATE TABLE ccs.ticket_custom_statuses (
        code         nvarchar(20) NOT NULL CONSTRAINT PK_ticket_custom_statuses PRIMARY KEY,
        behaves_like nvarchar(20) NOT NULL CONSTRAINT CK_custom_statuses_like CHECK (behaves_like IN ('in_progress','pending_customer','pending_internal')),
        sort_order   int NOT NULL CONSTRAINT DF_custom_statuses_sort DEFAULT 0,
        created_at   datetimeoffset(7) NOT NULL CONSTRAINT DF_custom_statuses_created DEFAULT SYSUTCDATETIME()
    );
GO
IF COL_LENGTH(N'ccs.tickets', N'custom_status') IS NULL ALTER TABLE ccs.tickets ADD custom_status nvarchar(20) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_tickets_custom_status')
    ALTER TABLE ccs.tickets ADD CONSTRAINT FK_tickets_custom_status FOREIGN KEY (custom_status) REFERENCES ccs.ticket_custom_statuses(code);
GO
IF COL_LENGTH(N'ccs.ticket_status_history', N'from_custom') IS NULL ALTER TABLE ccs.ticket_status_history ADD from_custom nvarchar(20) NULL;
GO
IF COL_LENGTH(N'ccs.ticket_status_history', N'to_custom') IS NULL ALTER TABLE ccs.ticket_status_history ADD to_custom nvarchar(20) NULL;
GO
-- Moves may now use the admin's own statuses (the API checks the codes).
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_transitions_statuses')
    ALTER TABLE ccs.ticket_status_transitions DROP CONSTRAINT CK_transitions_statuses;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_transitions_not_same')
    ALTER TABLE ccs.ticket_status_transitions ADD CONSTRAINT CK_transitions_not_same CHECK (from_status <> to_status);
GO

-- Teams per place. A kind of team (Technical support, Billing…) is defined once; each organization or branch has its own
-- team of a kind (organization_id/branch_id empty = a central team for every place). A category names the kind it needs,
-- and a new ticket goes to that kind of team in the customer's own branch, then organization, then the central team.
IF OBJECT_ID(N'ccs.team_kinds') IS NULL
    CREATE TABLE ccs.team_kinds (
        id               uniqueidentifier NOT NULL CONSTRAINT PK_team_kinds PRIMARY KEY DEFAULT NEWID(),
        name_en          nvarchar(80) NOT NULL,
        name_ar          nvarchar(80) NOT NULL,
        central_fallback bit NOT NULL CONSTRAINT DF_team_kinds_central DEFAULT 1,
        sort_order       int NOT NULL CONSTRAINT DF_team_kinds_sort DEFAULT 0,
        created_at       datetimeoffset(7) NOT NULL CONSTRAINT DF_team_kinds_created DEFAULT SYSUTCDATETIME()
    );
GO
IF COL_LENGTH(N'ccs.teams', N'kind_id') IS NULL ALTER TABLE ccs.teams ADD kind_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.teams', N'organization_id') IS NULL ALTER TABLE ccs.teams ADD organization_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.teams', N'branch_id') IS NULL ALTER TABLE ccs.teams ADD branch_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.teams', N'assign_method') IS NULL ALTER TABLE ccs.teams ADD assign_method nvarchar(16) NULL;
GO
IF COL_LENGTH(N'ccs.teams', N'last_auto_user_id') IS NULL ALTER TABLE ccs.teams ADD last_auto_user_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_teams_kind')
    ALTER TABLE ccs.teams ADD CONSTRAINT FK_teams_kind FOREIGN KEY (kind_id) REFERENCES ccs.team_kinds(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_teams_org')
    ALTER TABLE ccs.teams ADD CONSTRAINT FK_teams_org FOREIGN KEY (organization_id) REFERENCES ccs.organizations(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_teams_branch')
    ALTER TABLE ccs.teams ADD CONSTRAINT FK_teams_branch FOREIGN KEY (branch_id) REFERENCES ccs.branches(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_teams_assign_method')
    ALTER TABLE ccs.teams ADD CONSTRAINT CK_teams_assign_method CHECK (assign_method IS NULL OR assign_method IN ('fewest','turns','shared','leader'));
GO
-- Team names may repeat across places ("Technical support" in two branches); one team per kind per place instead.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_teams_name_en' AND object_id = OBJECT_ID(N'ccs.teams')) DROP INDEX UX_teams_name_en ON ccs.teams;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_teams_name_ar' AND object_id = OBJECT_ID(N'ccs.teams')) DROP INDEX UX_teams_name_ar ON ccs.teams;
GO
IF COL_LENGTH(N'ccs.ticket_categories', N'team_kind_id') IS NULL ALTER TABLE ccs.ticket_categories ADD team_kind_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_categories_team_kind')
    ALTER TABLE ccs.ticket_categories ADD CONSTRAINT FK_categories_team_kind FOREIGN KEY (team_kind_id) REFERENCES ccs.team_kinds(id);
GO
-- "Only these people": per category and team. A team with no rows for a category = all its staff.
IF OBJECT_ID(N'ccs.category_people') IS NULL
    CREATE TABLE ccs.category_people (
        category_id uniqueidentifier NOT NULL CONSTRAINT FK_category_people_category REFERENCES ccs.ticket_categories(id) ON DELETE CASCADE,
        team_id     uniqueidentifier NOT NULL,
        user_id     uniqueidentifier NOT NULL,
        CONSTRAINT PK_category_people PRIMARY KEY (category_id, team_id, user_id)
    );
GO
-- Existing teams become central teams, each of its own kind (same name), and categories point at their team's kind:
-- tickets are routed exactly as before until an admin adds teams for organizations or branches.
IF EXISTS (SELECT 1 FROM ccs.teams WHERE kind_id IS NULL)
BEGIN
    BEGIN TRAN;
    DECLARE @map TABLE (team_id uniqueidentifier, kind_id uniqueidentifier);
    INSERT INTO @map (team_id, kind_id) SELECT id, NEWID() FROM ccs.teams WHERE kind_id IS NULL;
    INSERT INTO ccs.team_kinds (id, name_en, name_ar, sort_order)
        SELECT m.kind_id, t.name_en, t.name_ar, ROW_NUMBER() OVER (ORDER BY t.name_en) FROM @map m JOIN ccs.teams t ON t.id = m.team_id;
    UPDATE t SET kind_id = m.kind_id FROM ccs.teams t JOIN @map m ON m.team_id = t.id;
    COMMIT;
END
GO
UPDATE c SET team_kind_id = t.kind_id FROM ccs.ticket_categories c JOIN ccs.teams t ON t.id = c.default_team_id WHERE c.team_kind_id IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_teams_kind_place' AND object_id = OBJECT_ID(N'ccs.teams'))
    CREATE UNIQUE INDEX UX_teams_kind_place ON ccs.teams (kind_id, organization_id, branch_id) WHERE kind_id IS NOT NULL;
GO
-- Account types say only what people can do. Places they carried move to the staff who had no "Works in" of their own.
IF EXISTS (SELECT 1 FROM ccs.account_type_access)
BEGIN
    BEGIN TRAN;
    INSERT INTO ccs.staff_placement (id, user_id, organization_id, branch_id)
        SELECT NEWID(), p.id, a.organization_id, a.branch_id
        FROM ccs.profiles p
        JOIN ccs.account_types ty ON ty.id = p.account_type_id AND ty.all_access = 0
        JOIN ccs.account_type_access a ON a.account_type_id = ty.id
        WHERE NOT EXISTS (SELECT 1 FROM ccs.staff_placement s WHERE s.user_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM ccs.admin_scopes s WHERE s.user_id = p.id);
    DELETE FROM ccs.account_type_access;
    UPDATE ccs.account_types SET all_access = 1 WHERE all_access = 0 AND scope_level IS NULL;
    COMMIT;
END
GO

-- Own catalog per place. Organizations and branches choose kinds of team, ticket types, categories and sub-categories from
-- the system (a branch also from its organization) or create their own. organization_id/branch_id on an item = the place
-- that made it (empty = the system's). place_catalog = what each place uses; place_type_categories = which categories each
-- type shows in that place; place_customer_view = what the place's customers see (their organization, branch, the system).
IF COL_LENGTH(N'ccs.team_kinds', N'organization_id') IS NULL ALTER TABLE ccs.team_kinds ADD organization_id uniqueidentifier NULL, branch_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.ticket_types', N'organization_id') IS NULL ALTER TABLE ccs.ticket_types ADD organization_id uniqueidentifier NULL, branch_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.ticket_categories', N'organization_id') IS NULL ALTER TABLE ccs.ticket_categories ADD organization_id uniqueidentifier NULL, branch_id uniqueidentifier NULL;
GO
IF COL_LENGTH(N'ccs.ticket_subcategories', N'organization_id') IS NULL ALTER TABLE ccs.ticket_subcategories ADD organization_id uniqueidentifier NULL, branch_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_team_kinds_org') ALTER TABLE ccs.team_kinds ADD CONSTRAINT FK_team_kinds_org FOREIGN KEY (organization_id) REFERENCES ccs.organizations(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_team_kinds_branch') ALTER TABLE ccs.team_kinds ADD CONSTRAINT FK_team_kinds_branch FOREIGN KEY (branch_id) REFERENCES ccs.branches(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ticket_types_org') ALTER TABLE ccs.ticket_types ADD CONSTRAINT FK_ticket_types_org FOREIGN KEY (organization_id) REFERENCES ccs.organizations(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ticket_types_branch') ALTER TABLE ccs.ticket_types ADD CONSTRAINT FK_ticket_types_branch FOREIGN KEY (branch_id) REFERENCES ccs.branches(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_categories_org') ALTER TABLE ccs.ticket_categories ADD CONSTRAINT FK_categories_org FOREIGN KEY (organization_id) REFERENCES ccs.organizations(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_categories_branch') ALTER TABLE ccs.ticket_categories ADD CONSTRAINT FK_categories_branch FOREIGN KEY (branch_id) REFERENCES ccs.branches(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_subcategories_org') ALTER TABLE ccs.ticket_subcategories ADD CONSTRAINT FK_subcategories_org FOREIGN KEY (organization_id) REFERENCES ccs.organizations(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_subcategories_branch') ALTER TABLE ccs.ticket_subcategories ADD CONSTRAINT FK_subcategories_branch FOREIGN KEY (branch_id) REFERENCES ccs.branches(id);
GO
-- Names are unique per owner (two organizations may both have "Installation"); the code in the ticket number stays unique.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_types_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_types')) DROP INDEX UX_ticket_types_name_en ON ccs.ticket_types;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_types_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_types')) DROP INDEX UX_ticket_types_name_ar ON ccs.ticket_types;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_categories_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_categories')) DROP INDEX UX_ticket_categories_name_en ON ccs.ticket_categories;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_categories_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_categories')) DROP INDEX UX_ticket_categories_name_ar ON ccs.ticket_categories;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_types_owner_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_types'))
    CREATE UNIQUE INDEX UX_ticket_types_owner_name_en ON ccs.ticket_types (organization_id, branch_id, name_en);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_types_owner_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_types'))
    CREATE UNIQUE INDEX UX_ticket_types_owner_name_ar ON ccs.ticket_types (organization_id, branch_id, name_ar);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_categories_owner_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_categories'))
    CREATE UNIQUE INDEX UX_ticket_categories_owner_name_en ON ccs.ticket_categories (organization_id, branch_id, name_en);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ticket_categories_owner_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_categories'))
    CREATE UNIQUE INDEX UX_ticket_categories_owner_name_ar ON ccs.ticket_categories (organization_id, branch_id, name_ar);
GO
IF OBJECT_ID(N'ccs.place_catalog') IS NULL
    CREATE TABLE ccs.place_catalog (
        id              uniqueidentifier NOT NULL CONSTRAINT PK_place_catalog PRIMARY KEY DEFAULT NEWID(),
        organization_id uniqueidentifier NOT NULL CONSTRAINT FK_place_catalog_org REFERENCES ccs.organizations(id),
        branch_id       uniqueidentifier NULL CONSTRAINT FK_place_catalog_branch REFERENCES ccs.branches(id),
        item_kind       varchar(8) NOT NULL CONSTRAINT CK_place_catalog_kind CHECK (item_kind IN ('kind','type','cat','sub')),
        item_id         uniqueidentifier NOT NULL
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_place_catalog' AND object_id = OBJECT_ID(N'ccs.place_catalog'))
    CREATE UNIQUE INDEX UX_place_catalog ON ccs.place_catalog (organization_id, branch_id, item_kind, item_id);
GO
IF OBJECT_ID(N'ccs.place_type_categories') IS NULL
    CREATE TABLE ccs.place_type_categories (
        id              uniqueidentifier NOT NULL CONSTRAINT PK_place_type_categories PRIMARY KEY DEFAULT NEWID(),
        organization_id uniqueidentifier NOT NULL CONSTRAINT FK_ptc_org REFERENCES ccs.organizations(id),
        branch_id       uniqueidentifier NULL CONSTRAINT FK_ptc_branch REFERENCES ccs.branches(id),
        type_id         uniqueidentifier NOT NULL CONSTRAINT FK_ptc_type REFERENCES ccs.ticket_types(id) ON DELETE CASCADE,
        category_id     uniqueidentifier NOT NULL CONSTRAINT FK_ptc_category REFERENCES ccs.ticket_categories(id) ON DELETE CASCADE
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_place_type_categories' AND object_id = OBJECT_ID(N'ccs.place_type_categories'))
    CREATE UNIQUE INDEX UX_place_type_categories ON ccs.place_type_categories (organization_id, branch_id, type_id, category_id);
GO
-- No row = the customers see all three (the system list they saw before this change, plus anything their places add).
IF OBJECT_ID(N'ccs.place_customer_view') IS NULL
    CREATE TABLE ccs.place_customer_view (
        id                uniqueidentifier NOT NULL CONSTRAINT PK_place_customer_view PRIMARY KEY DEFAULT NEWID(),
        organization_id   uniqueidentifier NOT NULL CONSTRAINT FK_pcv_org REFERENCES ccs.organizations(id),
        branch_id         uniqueidentifier NULL CONSTRAINT FK_pcv_branch REFERENCES ccs.branches(id),
        show_organization bit NOT NULL CONSTRAINT DF_pcv_org DEFAULT 1,
        show_branch       bit NOT NULL CONSTRAINT DF_pcv_branch DEFAULT 1,
        show_system       bit NOT NULL CONSTRAINT DF_pcv_system DEFAULT 1
    );
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_place_customer_view' AND object_id = OBJECT_ID(N'ccs.place_customer_view'))
    CREATE UNIQUE INDEX UX_place_customer_view ON ccs.place_customer_view (organization_id, branch_id);
GO
-- Sub-category names: unique per category and owner (two branches may add the same name under a system category).
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_subcategories_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_subcategories')) DROP INDEX UX_subcategories_name_en ON ccs.ticket_subcategories;
GO
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_subcategories_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_subcategories')) DROP INDEX UX_subcategories_name_ar ON ccs.ticket_subcategories;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_subcategories_owner_name_en' AND object_id = OBJECT_ID(N'ccs.ticket_subcategories'))
    CREATE UNIQUE INDEX UX_subcategories_owner_name_en ON ccs.ticket_subcategories (category_id, organization_id, branch_id, name_en);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_subcategories_owner_name_ar' AND object_id = OBJECT_ID(N'ccs.ticket_subcategories'))
    CREATE UNIQUE INDEX UX_subcategories_owner_name_ar ON ccs.ticket_subcategories (category_id, organization_id, branch_id, name_ar);
GO
-- SLA "Getting close" level per priority (% of the time used; below the warning %), and the stored state 'close'.
IF COL_LENGTH(N'ccs.sla_policies', N'close_threshold_pct') IS NULL
    ALTER TABLE ccs.sla_policies ADD close_threshold_pct int NOT NULL CONSTRAINT DF_sla_close DEFAULT 50
        CONSTRAINT CK_sla_close CHECK (close_threshold_pct BETWEEN 1 AND 98);
GO
-- A warning % at or below 50 would put "Getting close" after it: keep the order (close < warning).
UPDATE ccs.sla_policies SET close_threshold_pct = CASE WHEN warning_threshold_pct > 1 THEN warning_threshold_pct - 1 ELSE 1 END
WHERE close_threshold_pct >= warning_threshold_pct;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_sla_records_state' AND definition LIKE N'%''close''%')
BEGIN
    ALTER TABLE ccs.ticket_sla_records DROP CONSTRAINT CK_sla_records_state;
    ALTER TABLE ccs.ticket_sla_records ADD CONSTRAINT CK_sla_records_state CHECK (state IN ('on_track','close','due_soon','breached','paused','completed'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_sla_cycles_state' AND definition LIKE N'%''close''%')
BEGIN
    ALTER TABLE ccs.ticket_sla_cycles DROP CONSTRAINT CK_sla_cycles_state;
    ALTER TABLE ccs.ticket_sla_cycles ADD CONSTRAINT CK_sla_cycles_state CHECK (state IN ('on_track','close','due_soon','breached','paused','completed'));
END
GO
-- Each ticket keeps the customer's place at creation (organization and branch): visibility, reports and
-- escalation follow it, so moving a customer no longer moves their old tickets. Existing tickets are
-- filled in once from the customer's current place.
IF COL_LENGTH(N'ccs.tickets', N'organization_id') IS NULL
    ALTER TABLE ccs.tickets ADD organization_id uniqueidentifier NULL CONSTRAINT FK_tickets_org REFERENCES ccs.organizations(id),
                                branch_id uniqueidentifier NULL CONSTRAINT FK_tickets_branch REFERENCES ccs.branches(id);
GO
IF NOT EXISTS (SELECT 1 FROM ccs.app_settings WHERE [key] = N'ticket_place_backfilled')
BEGIN
    UPDATE t SET organization_id = p.organization_id, branch_id = p.branch_id
    FROM ccs.tickets t JOIN ccs.profiles p ON p.id = t.requester_id
    WHERE t.organization_id IS NULL AND t.branch_id IS NULL;
    INSERT ccs.app_settings ([key], value) VALUES (N'ticket_place_backfilled', N'true');
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tickets_place' AND object_id = OBJECT_ID(N'ccs.tickets'))
    CREATE INDEX IX_tickets_place ON ccs.tickets (organization_id, branch_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tickets_branch' AND object_id = OBJECT_ID(N'ccs.tickets'))
    CREATE INDEX IX_tickets_branch ON ccs.tickets (branch_id) WHERE branch_id IS NOT NULL;
GO
-- Escalation "Specific leaders" (escalation_picks: the chain steps an agent may choose) and the per-place
-- Reassign tickets rule (reassign_rule; NULL uses the level above, then the default in app_settings).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_org_escalation' AND definition LIKE N'%''specific''%')
BEGIN
    ALTER TABLE ccs.organizations DROP CONSTRAINT CK_org_escalation;
    ALTER TABLE ccs.organizations ADD CONSTRAINT CK_org_escalation CHECK (escalation_mode IN ('off','next','any','specific'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_branches_escalation' AND definition LIKE N'%''specific''%')
BEGIN
    ALTER TABLE ccs.branches DROP CONSTRAINT CK_branches_escalation;
    ALTER TABLE ccs.branches ADD CONSTRAINT CK_branches_escalation CHECK (escalation_mode IN ('off','next','any','specific'));
END
GO
IF COL_LENGTH(N'ccs.organizations', N'escalation_picks') IS NULL
    ALTER TABLE ccs.organizations ADD escalation_picks nvarchar(max) NULL CONSTRAINT CK_org_escalation_picks CHECK (escalation_picks IS NULL OR ISJSON(escalation_picks) = 1),
                                      reassign_rule nvarchar(400) NULL CONSTRAINT CK_org_reassign CHECK (reassign_rule IS NULL OR ISJSON(reassign_rule) = 1);
GO
IF COL_LENGTH(N'ccs.branches', N'escalation_picks') IS NULL
    ALTER TABLE ccs.branches ADD escalation_picks nvarchar(max) NULL CONSTRAINT CK_branches_escalation_picks CHECK (escalation_picks IS NULL OR ISJSON(escalation_picks) = 1),
                                 reassign_rule nvarchar(400) NULL CONSTRAINT CK_branches_reassign CHECK (reassign_rule IS NULL OR ISJSON(reassign_rule) = 1);
GO
-- Default account types (Administrator, Agent, Team leader, ...): default_key marks them. The API makes the
-- missing ones at start-up, so this only adds the column.
IF COL_LENGTH(N'ccs.account_types', N'default_key') IS NULL
    ALTER TABLE ccs.account_types ADD default_key nvarchar(30) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_account_types_default_key' AND object_id = OBJECT_ID(N'ccs.account_types'))
    CREATE UNIQUE INDEX UX_account_types_default_key ON ccs.account_types (default_key) WHERE default_key IS NOT NULL;
GO
-- Rejected account requests: who rejected, when and why (shown to the customer and on the Rejected tab).
IF COL_LENGTH(N'ccs.profiles', N'rejected_at') IS NULL
    ALTER TABLE ccs.profiles ADD rejected_at datetimeoffset(7) NULL, rejected_by uniqueidentifier NULL, rejection_reason nvarchar(500) NULL;
GO
-- Earlier rejections were kept only in the activity log: copy the latest one onto each account still suspended.
UPDATE p SET rejected_at = l.created_at, rejected_by = l.actor_id,
       rejection_reason = NULLIF(LTRIM(RTRIM(COALESCE(JSON_VALUE(l.[after], '$.reason'), JSON_VALUE(l.[after], '$.Reason')))), N'')
  FROM ccs.profiles p
 CROSS APPLY (SELECT TOP (1) a.created_at, a.actor_id, a.[after] FROM ccs.audit_logs a
               WHERE a.action = N'user.reject' AND a.entity_id = p.id ORDER BY a.created_at DESC) l
 WHERE p.account_status = N'suspended' AND p.rejected_at IS NULL;
GO
-- When the sign-up code was entered: approval reminders count working days from it.
IF COL_LENGTH(N'ccs.profiles', N'email_verified_at') IS NULL
    ALTER TABLE ccs.profiles ADD email_verified_at datetimeoffset(7) NULL;
GO
-- Requests already waiting: count from their last change.
UPDATE ccs.profiles SET email_verified_at = updated_at
 WHERE account_status = N'pending_approval' AND email_verified_at IS NULL;
GO
