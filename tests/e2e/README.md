# CCS v2 browser tests (Playwright)

One spec file per sheet of the test workbook. Each test title starts with the workbook case ID (`TC-AU-001 ...`).
They run **only on the local copy**: the address guard refuses the public site.

## One-time setup (Windows, PowerShell)
```
cd tests\e2e
npm install
npx playwright install chromium
copy .env.example .env      # then put the test password in .env (never committed)
pip install openpyxl        # only for the workbook script
```

## Every run
1. Start the local copy: API `dotnet run --project src/Ccs.Api` and web `cd src/Ccs.Web && npm start` (local database copy, `Jobs:Enabled=false`).
2. In the LOCAL copy switch the captcha **off** (the tests cannot solve it).
3. `npm test` (all) or `npx playwright test specs/au-sign-in.spec.ts`.
4. Captcha check only: switch the captcha **on**, then `npm run test:captcha`.
5. Open the details with `npm run report`.

## Put the results into the workbook
```
python scripts\results_to_xlsx.py "C:\path\CCS_Test_Cases.xlsx"
```
Saves `CCS_Test_Cases_results.xlsx` next to the original (the original is never changed). Pass/Fail goes to **Result v2 (.NET)**, with date, tester (`CCS_TESTER`) and the first line of the error in Notes. Manual cases stay **Not run**.

## Safety
- The password comes from `CCS_TEST_PASSWORD` (environment or `.env`), never from a file in the repo.
- `.env`, `*.xlsx` and `results/` are git-ignored.
- Any address other than localhost is refused unless `CCS_ALLOW_REMOTE=yes` (staging only, never production).

## Status
| Sheet | Spec | Automated | Manual |
|---|---|---|---|
| AU Sign in and session | `au-sign-in.spec.ts` | 12 of 22 (TC-AU-002 needs `CCS_CUSTOMER_PHONE`, TC-AU-021 needs captcha mode) | 005, 008 to 014, 016, 017, 020 (mailbox, authenticator, waiting time or changed data) |
