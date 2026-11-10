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
