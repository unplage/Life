#!/usr/bin/env python3
"""Regenerate the WHO 2006 LMS reference tables embedded in index.html.

Sources: official WHO Child Growth Standards z-score tables (L/M/S).
Run with --check to verify the embedded data still matches those tables.
Requires openpyxl (pip install openpyxl).
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import urllib.request
from pathlib import Path

BASE = "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators"
ROOT = Path(__file__).resolve().parents[1]

SOURCES = {
    ("weeks", "boy", "weight"): f"{BASE}/weight-for-age/wfa_boys_0-to-13-weeks_zscores.xlsx",
    ("weeks", "girl", "weight"): f"{BASE}/weight-for-age/wfa_girls_0-to-13-weeks_zscores.xlsx",
    ("weeks", "boy", "height"): f"{BASE}/length-height-for-age/lhfa_boys_0-to-13-weeks_zscores.xlsx",
    ("weeks", "girl", "height"): f"{BASE}/length-height-for-age/lhfa_girls_0-to-13-weeks_zscores.xlsx",
    ("weeks", "boy", "head"): f"{BASE}/head-circumference-for-age/hcfa-boys-0-13-zscores.xlsx",
    ("weeks", "girl", "head"): f"{BASE}/head-circumference-for-age/hcfa-girls-0-13-zscores.xlsx",
    ("months", "boy", "weight"): f"{BASE}/weight-for-age/wfa_boys_0-to-5-years_zscores.xlsx",
    ("months", "girl", "weight"): f"{BASE}/weight-for-age/wfa_girls_0-to-5-years_zscores.xlsx",
    ("months", "boy", "height"): f"{BASE}/length-height-for-age/lhfa_boys_0-to-2-years_zscores.xlsx",
    ("months", "girl", "height"): f"{BASE}/length-height-for-age/lhfa_girls_0-to-2-years_zscores.xlsx",
    ("months", "boy", "head"): f"{BASE}/head-circumference-for-age/hcfa-boys-0-5-zscores.xlsx",
    ("months", "girl", "head"): f"{BASE}/head-circumference-for-age/hcfa-girls-0-5-zscores.xlsx",
}
EXTRA = {
    ("months", "boy", "height"): f"{BASE}/length-height-for-age/lhfa_boys_2-to-5-years_zscores.xlsx",
    ("months", "girl", "height"): f"{BASE}/length-height-for-age/lhfa_girls_2-to-5-years_zscores.xlsx",
}


def fmt(value: object) -> str:
    text = f"{float(value):.6f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def read_rows(url: str, cache_dir: str | None = None) -> list[tuple[float, float, float, float]]:
    from openpyxl import load_workbook
    cached = Path(cache_dir) / url.rsplit("/", 1)[-1] if cache_dir else None
    if cached and cached.exists():
        book = load_workbook(cached, data_only=True)
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Life-PWA data build)"})
        with urllib.request.urlopen(request, timeout=120) as response:
            book = load_workbook(io.BytesIO(response.read()), data_only=True)
    sheet = book.active
    rows = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        age, l, m, s = row[0], row[1], row[2], row[3]
        if age is None or l is None or m is None or s is None:
            continue
        rows.append((float(str(age)), float(str(l)), float(str(m)), float(str(s))))
    return sorted(rows)


def build(cache_dir: str | None = None) -> str:
    tables = {kind: {"boy": {}, "girl": {}} for kind in ("weeks", "months")}
    for key, url in SOURCES.items():
        rows = read_rows(url, cache_dir)
        if key in EXTRA:
            seen = {r[0] for r in rows}
            rows += [r for r in read_rows(EXTRA[key], cache_dir) if r[0] not in seen]
            rows.sort()
        expected = 14 if key[0] == "weeks" else 61
        if len(rows) != expected:
            raise RuntimeError(f"{key}: expected {expected} rows, got {len(rows)}")
        tables[key[0]][key[1]][key[2]] = rows
    out = ["const WHO_LMS = {"]
    for kind in ("weeks", "months"):
        out.append(f"  {kind}: {{")
        for sex in ("boy", "girl"):
            out.append(f"    {sex}: {{")
            for metric in ("weight", "height", "head"):
                body = ",".join(
                    "[%s,%s,%s,%s]" % (fmt(age), fmt(l), fmt(m), fmt(s))
                    for age, l, m, s in tables[kind][sex][metric]
                )
                out.append(f"      {metric}: [{body}],")
            out.append("    },")
        out.append("  },")
    out.append("};")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", metavar="FILE", help="compare generated data with block in FILE")
    parser.add_argument("--embed", metavar="FILE", help="replace WHO data block in FILE")
    parser.add_argument("--cache", metavar="DIR", help="directory with previously downloaded xlsx files")
    args = parser.parse_args()
    try:
        generated = build(args.cache)
    except ImportError:
        print("openpyxl is required: pip install openpyxl", file=sys.stderr)
        return 2
    if args.check:
        html = Path(args.check).read_text(encoding="utf-8")
        match = re.search(r"const WHO_LMS = \{.*?\n\s*\};", html, re.S)
        if not match:
            print("WHO_LMS block not found", file=sys.stderr)
            return 1
        if match.group(0) != generated:
            print("WHO_LMS does not match official WHO tables", file=sys.stderr)
            return 1
        print("OK: WHO_LMS matches official WHO tables")
        return 0
    if args.embed:
        target = Path(args.embed)
        html = target.read_text(encoding="utf-8")
        pattern = r"const (WHO_LMS|WHO_REFS) = \{.*?\n\s*\};"
        match = re.search(pattern, html, re.S)
        if not match:
            print("WHO data block not found", file=sys.stderr)
            return 1
        target.write_text(html[:match.start()] + generated + html[match.end():], encoding="utf-8")
        print(f"Embedded {len(generated)} bytes of WHO LMS data into {target}")
        return 0
    print(generated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
