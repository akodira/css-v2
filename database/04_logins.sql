/* Least-privilege login for the API (spec 10). Run as sysadmin; replace the password
   or use a Windows (gMSA / app-pool) account instead:
   CREATE LOGIN [DOMAIN\CcsApiPool$] FROM WINDOWS; */
CREATE LOGIN ccs_api WITH PASSWORD = N'<<set a strong password>>', CHECK_POLICY = ON;
GO
CREATE USER ccs_api FOR LOGIN ccs_api;
ALTER ROLE db_datareader ADD MEMBER ccs_api;
ALTER ROLE db_datawriter ADD MEMBER ccs_api;
GRANT EXECUTE TO ccs_api;
/* Hangfire creates its own schema on first start; allow it only that: */
GRANT CREATE TABLE TO ccs_api;
IF SCHEMA_ID('HangFire') IS NULL EXEC('CREATE SCHEMA HangFire AUTHORIZATION ccs_api');
DENY ALTER ON SCHEMA::ccs TO ccs_api;
DENY ALTER ON SCHEMA::dbo TO ccs_api;
GO
