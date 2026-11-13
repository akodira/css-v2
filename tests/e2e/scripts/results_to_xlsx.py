"""Write the Playwright results into the test-case workbook (Result v2 (.NET) column).

Usage:  python scripts/results_to_xlsx.py "C:\\path\\CCS_Test_Cases.xlsx"
Reads  results/report.json  (written by "npm test"), never changes the original workbook:
the updated copy is saved next to it as <name>_results.xlsx.
Passed -> Pass, failed or timed out -> Fail (first line of the error goes to Notes).
Skipped cases (manual ones) are left exactly as they are.
"""
import argparse, datetime, json, os, re, sys
from openpyxl import load_workbook

COL = {"v1": 8, "v2": 9}              # Result v1 (H), Result v2 (I) on every area sheet
TESTER, DATE, NOTES, HEADER_ROWS = 10, 11, 12, 4

def walk(suite, out):
    for spec in suite.get("specs", []):
        m = re.match(r"(TC-[A-Z]{2}-\d{3})\b", spec.get("title", ""))
        if not m: continue
        for t in spec.get("tests", []):
            res = t.get("results", [])
            last = res[-1] if res else {}
            out[m.group(1)] = (t.get("status", ""), last.get("status", ""), (last.get("error") or {}).get("message", ""))
    for s in suite.get("suites", []): walk(s, out)

def first_line(msg):
    msg = re.sub(r"\x1b\[[0-9;]*m", "", msg or "")
    for ln in msg.splitlines():
        if ln.strip(): return ln.strip()[:250]
    return ""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx"); ap.add_argument("--report", default=os.path.join("results", "report.json"))
    ap.add_argument("--version", choices=["v1", "v2"], default="v2")
    a = ap.parse_args()
    data = json.load(open(a.report, encoding="utf-8"))
    found = {}
    for s in data.get("suites", []): walk(s, found)
    wb = load_workbook(a.xlsx)
    by_code = {ws.title.split(" ", 1)[0]: ws for ws in wb.worksheets if re.match(r"^[A-Z]{2} ", ws.title)}
    tester = os.environ.get("CCS_TESTER", "")
    today = datetime.date.today().strftime("%d-%b-%Y")
    done = {"Pass": 0, "Fail": 0}; missing = []
    for cid, (status, last, msg) in found.items():
        if status == "skipped": continue
        ws = by_code.get(cid.split("-")[1])
        row = next((r for r in range(HEADER_ROWS + 1, ws.max_row + 1) if ws.cell(r, 1).value == cid), None) if ws else None
        if row is None: missing.append(cid); continue
        result = "Pass" if status == "expected" else "Fail"
        ws.cell(row, COL[a.version]).value = result
        if tester: ws.cell(row, TESTER).value = tester
        ws.cell(row, DATE).value = today
        if result == "Fail": ws.cell(row, NOTES).value = first_line(msg)
        done[result] += 1
    wb.calculation.fullCalcOnLoad = True          # Summary recalculates when Excel opens the file
    base, ext = os.path.splitext(a.xlsx)
    out = f"{base}_results{ext}"
    wb.save(out)
    print(f"Written {out}: {done['Pass']} Pass, {done['Fail']} Fail" + (f", not found in workbook: {', '.join(missing)}" if missing else ""))

if __name__ == "__main__":
    sys.exit(main())
