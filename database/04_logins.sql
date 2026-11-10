/* Least-privilege login for the API (spec 10). Run as sysadmin, in database CCS.

   Default (decided 10 Nov 2026): SQL Server runs on the same server as IIS, so the API connects with
   the Windows identity of its application pool, IIS APPPOOL\CcsApi. No password exists anywhere.
   Connection string: Server=localhost;Database=CCS;Integrated Security=True;Encrypt=True;TrustServerCertificate=True

   Other layouts: replace the CREATE LOGIN line with
     - SQL Server on another domain server: CREATE LOGIN [CORP\gmsa-ccs$] FROM WINDOWS;  (gMSA = app pool identity)
     - no domain: CREATE LOGIN ccs_api WITH PASSWORD = N'<long random>', CHECK_POLICY = ON;
   and use that name in the four places marked <<login>> below. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'IIS APPPOOL\CcsApi')
    CREATE LOGIN [IIS APPPOOL\CcsApi] FROM WINDOWS;          -- <<login>>
GO
USE CCS;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ccs_api')
    CREATE USER ccs_api FOR LOGIN [IIS APPPOOL\CcsApi];      -- <<login>>
ELSE
    ALTER USER ccs_api WITH LOGIN = [IIS APPPOOL\CcsApi];    -- <<login>>  re-link after restoring a backup on another server
GO
ALTER ROLE db_datareader ADD MEMBER ccs_api;
ALTER ROLE db_datawriter ADD MEMBER ccs_api;
GRANT EXECUTE TO ccs_api;
/* Hangfire creates its own tables on first start, only inside the HangFire schema it owns: */
GRANT CREATE TABLE TO ccs_api;
IF SCHEMA_ID('HangFire') IS NULL EXEC('CREATE SCHEMA HangFire AUTHORIZATION ccs_api');
DENY ALTER ON SCHEMA::ccs TO ccs_api;
DENY ALTER ON SCHEMA::dbo TO ccs_api;
GO
