// Write the Playwright results into the test-case workbook (Result v2 (.NET) column). Node version (no Python needed).
//
// Usage:  node scripts/results_to_xlsx.mjs "C:\path\CCS_Test_Cases.xlsx" [--report a.json --report b.json ...] [--version v1|v2]
// Reads results/report.json (written by "npm test") or every --report given (later reports win for the same case),
// and never changes the original workbook: the updated copy is saved next to it as <name>_results.xlsx.
//   Passed            -> Pass
//   Failed/timed out  -> Fail, Notes = the reason from scripts/findings.json when known, else the first line of the error
//   Manual (skipped)  -> Not run, Notes = "Manual: <why>"
//   Skipped (no data) -> Not run, Notes = the skip reason
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const COL = { v1: 8, v2: 9 };            // Result v1 (H), Result v2 (I) on every area sheet
const TESTER = 10, DATE = 11, NOTES = 12, HEADER_ROWS = 4;

const args = process.argv.slice(2);
const reports = [];
let version = 'v2';
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--report') reports.push(args[++i]);
  else if (args[i] === '--version') version = args[++i];
  else rest.push(args[i]);
}
if (!reports.length) reports.push(path.join('results', 'report.json'));
const xlsx = rest[0];
if (!xlsx || !COL[version]) { console.error('Usage: node scripts/results_to_xlsx.mjs <workbook.xlsx> [--report file ...] [--version v1|v2]'); process.exit(2); }

const findingsFile = path.join(import.meta.dirname, 'findings.json');
const findings = fs.existsSync(findingsFile) ? JSON.parse(fs.readFileSync(findingsFile, 'utf8')) : {};

const found = new Map();
const clean = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const firstLine = (msg) => clean(msg).split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 250) ?? '';
function walk(suite) {
  for (const spec of suite.specs ?? []) {
    const m = /^(TC-[A-Z]{2}-\d{3})\b/.exec(spec.title ?? '');
    if (!m) continue;
    for (const t of spec.tests ?? []) {
      const last = (t.results ?? []).at(-1) ?? {};
      if (!last.status) continue;                                      // listed only, not run
      const skip = [...(last.annotations ?? []), ...(t.annotations ?? [])].find((a) => a.type === 'skip')?.description ?? '';
      const errs = (last.errors ?? []).map((e) => e.message).filter(Boolean);
      const msg = errs.find((e) => !/^Test timeout/.test(clean(e))) ?? errs[0] ?? last.error?.message ?? '';
      found.set(m[1], { status: t.status, skip, msg });
    }
  }
  for (const s of suite.suites ?? []) walk(s);
}
for (const r of reports) {
  if (!fs.existsSync(r)) { console.error(`missing report ${r}`); continue; }
  for (const s of JSON.parse(fs.readFileSync(r, 'utf8')).suites ?? []) walk(s);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsx);
const byCode = new Map();
wb.eachSheet((ws) => { if (/^[A-Z]{2} /.test(ws.name)) byCode.set(ws.name.split(' ')[0], ws); });
const tester = process.env.CCS_TESTER || '';
const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
const done = { Pass: 0, Fail: 0, 'Not run': 0 }; const missing = [];
for (const [cid, { status, skip, msg }] of found) {
  const ws = byCode.get(cid.split('-')[1]);
  let row = null;
  if (ws) for (let r = HEADER_ROWS + 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === cid) { row = r; break; }
  if (row === null) { missing.push(cid); continue; }
  const result = status === 'expected' ? 'Pass' : status === 'skipped' ? 'Not run' : 'Fail';
  const note = result === 'Fail' ? (findings[cid] ?? `Test failed: ${firstLine(msg)}`) : result === 'Not run' ? skip : '';
  if (result !== 'Not run') {
    ws.getCell(row, COL[version]).value = result;
    if (tester) ws.getCell(row, TESTER).value = tester;
    ws.getCell(row, DATE).value = today;
  }
  ws.getCell(row, NOTES).value = note || null;
  done[result]++;
}
wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };   // Summary recalculates when Excel opens the file
const out = xlsx.replace(/(\.xlsx)$/i, '_results$1');
await wb.xlsx.writeFile(out);
console.log(`Written ${out}: ${done.Pass} Pass, ${done.Fail} Fail, ${done['Not run']} Not run` + (missing.length ? `, not found in workbook: ${missing.join(', ')}` : ''));
