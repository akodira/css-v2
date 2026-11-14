// Builds the README "Status" table from the spec files: per sheet, automated and manual (test.skip "Manual:") cases.
// Usage: node scripts/status-table.mjs [report.json ...]   (with reports it adds pass / fail counts; later reports win)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'specs');
const reports = process.argv.slice(2).filter((p) => fs.existsSync(p)).map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
const report = reports.length > 0;
const status = new Map();
for (const r of reports) (function walk(s) {
  for (const sp of s.specs ?? []) {
    const m = /^(TC-[A-Z]{2}-\d{3})/.exec(sp.title);
    const t = sp.tests[0];
    if (m && t?.results?.at(-1)?.status) status.set(m[1], t.status);
  }
  (s.suites ?? []).forEach(walk);
})({ suites: r.suites });

const rows = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.spec.ts')).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const sheet = /\* Sheet "([^"]+)"/.exec(src)?.[1] ?? /describe(?:\.serial)?\('([^']+)'/.exec(src)?.[1] ?? f;
  const all = [...src.matchAll(/(?:test|manual)\(\s*[`'"](TC-[A-Z]{2}-\d{3})/g)].map((m) => m[1]);
  const manual = [...src.matchAll(/manual\(\s*'(TC-[A-Z]{2}-\d{3})'/g)].map((m) => m[1]);
  const auto = [...new Set(all)].filter((x) => !manual.includes(x));
  const pass = auto.filter((x) => status.get(x) === 'expected').length;
  const fail = auto.filter((x) => ['unexpected', 'flaky'].includes(status.get(x))).length;
  const skipped = auto.filter((x) => status.get(x) === 'skipped').length;
  const short = (ids) => ids.map((x) => x.slice(-3)).join(', ');
  rows.push(`| ${sheet} | \`${f}\` | ${auto.length} of ${auto.length + manual.length} | ${report ? `${pass} / ${fail}${skipped ? ` (${skipped} skipped: no data)` : ''}` : '-'} | ${manual.length ? short(manual) : '-'} |`);
}
console.log('| Sheet | Spec | Automated | Pass / Fail | Manual |\n|---|---|---|---|---|\n' + rows.join('\n'));
