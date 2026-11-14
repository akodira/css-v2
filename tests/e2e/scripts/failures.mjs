// Prints a short list of failed tests from results/report.json.
// Usage: node scripts/failures.mjs [lines]   (lines > 0 also prints that many lines of the role page snapshot)
import fs from 'node:fs';
const SNAP = Number(process.argv[2] || 0);
const r = JSON.parse(fs.readFileSync('results/report.json', 'utf8'));
const out = []; let pass = 0, skip = 0;
const clean = (s) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
(function walk(s) {
  for (const sp of s.specs ?? []) for (const t of sp.tests) {
    const x = t.results.at(-1) ?? {};
    if (t.status === 'skipped') { skip++; continue; }
    if (t.status === 'expected') { pass++; continue; }
    let line = `${sp.title}\n   ${clean(x.error?.message).split('\n').filter(Boolean).slice(0, 8).join('\n   ')}`;
    const snap = (x.attachments ?? []).find((a) => a.name === 'role-page.txt');
    const text = snap?.body ? Buffer.from(snap.body, 'base64').toString('utf8') : snap?.path && fs.existsSync(snap.path) ? fs.readFileSync(snap.path, 'utf8') : '';
    if (SNAP && text) line += '\n   --- ' + text.split('\n').slice(0, SNAP).join('\n      ');
    out.push(line);
  }
  (s.suites ?? []).forEach(walk);
})({ suites: r.suites });
console.log(`passed ${pass}, failed ${out.length}, skipped ${skip}\n` + out.join('\n'));
