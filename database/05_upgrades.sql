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
