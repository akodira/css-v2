# CCS v2 (AZKA Customer Care System)

Angular 22 front end (`src/Ccs.Web`) + ASP.NET Core .NET 10 API (`src/Ccs.Api`, `Ccs.Application`, `Ccs.Infrastructure`, `Ccs.Domain`) + SQL Server. Production runs on IIS.

## Run locally
- API: `dotnet run --project src/Ccs.Api` (https://localhost:7180). Settings: `src/Ccs.Api/appsettings.Development.json` (database, `Jobs:Enabled=false` so no real emails or reminders are sent).
- Web: `cd src/Ccs.Web && npm install && npm start` (http://localhost:4200, proxies /api to the API).
- Local database is a COPY of production: never run destructive SQL on anything but the local copy, and never put a production connection string in any file.

## Check before committing
- `dotnet build Ccs.slnx` and `dotnet test`
- `cd src/Ccs.Web && npx ng build --configuration production`

## Release
CI (windows) builds the artifact `ccs-v2-release-<full sha>`. After a front-end change refresh the prebuilt copy:
`rm -rf prebuilt/ccs-web && cp -r src/Ccs.Web/dist/Ccs.Web/browser prebuilt/ccs-web`, update the timestamp in `prebuilt/BUILD.txt` (yyyyMMdd-HHmm, UTC), commit, push to `main`. Install on the server with `deploy/Install-Ccs.cmd`.

## How we work
- Take changes in batches (3 to 5), test locally, commit and push once. Do not leave finished work uncommitted.
- Do not compare against v1 or re-check screens in a browser unless asked.
- Short, plain answers. Admin text is in English and Arabic: update both `src/Ccs.Web/public/i18n/en.json` and `ar.json` (Arabic in formal Fusha).
- Required fields: use `<app-req />` after the label text and `<app-req-note />` after the submit button.
- Never type or store passwords, tokens or the production connection string.
