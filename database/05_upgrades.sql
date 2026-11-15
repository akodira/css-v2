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
