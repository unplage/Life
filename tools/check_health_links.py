#!/usr/bin/env python3
"""Validate the locally curated MSD Manuals link index.

Default mode is offline and deterministic. Use --online to probe URLs,
but 403/429 responses are reported as warnings because MSD may block bots.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "health-links.json"
OFFICIAL_SEARCH = "https://www.msdmanuals.cn/home/searchresults?query="
ALLOWED_HOSTS = {"www.msdmanuals.cn", "msdmanuals.cn"}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def validate(data: dict) -> tuple[list[str], list[str], int]:
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    total = 0

    if not isinstance(data, dict):
        return ["index root must be an object"], warnings, 0
    if not data.get("version"):
        fail(errors, "missing version")
    if not data.get("source"):
        fail(errors, "missing source")
    if data.get("officialSearch") != OFFICIAL_SEARCH:
        fail(errors, f"officialSearch must be {OFFICIAL_SEARCH!r}")
    categories = data.get("categories")
    if not isinstance(categories, list) or not categories:
        return ["categories must be a non-empty array"], warnings, 0

    for i, cat in enumerate(categories):
        where = f"categories[{i}]"
        if not isinstance(cat, dict):
            fail(errors, f"{where} must be an object")
            continue
        cid = cat.get("id")
        if not isinstance(cid, str) or not cid.strip():
            fail(errors, f"{where}.id is required")
        elif cid in seen_ids:
            fail(errors, f"duplicate category id: {cid}")
        else:
            seen_ids.add(cid)
        for key in ("name", "icon"):
            if not isinstance(cat.get(key), str) or not cat[key].strip():
                fail(errors, f"{where}.{key} is required")
        stages = cat.get("stages")
        if not isinstance(stages, list) or not all(isinstance(s, str) for s in stages):
            fail(errors, f"{where}.stages must be a string array")
        links = cat.get("links")
        if not isinstance(links, list) or not links:
            fail(errors, f"{where}.links must be a non-empty array")
            continue
        for j, link in enumerate(links):
            lw = f"{where}.links[{j}]"
            if not isinstance(link, dict):
                fail(errors, f"{lw} must be an object")
                continue
            title = link.get("title")
            url = link.get("url")
            if not isinstance(title, str) or not title.strip():
                fail(errors, f"{lw}.title is required")
            if not isinstance(url, str) or not url:
                fail(errors, f"{lw}.url is required")
                continue
            parsed = urllib.parse.urlsplit(url)
            if parsed.scheme != "https":
                fail(errors, f"{lw}.url must use https: {url}")
            if parsed.hostname not in ALLOWED_HOSTS:
                fail(errors, f"{lw}.url host is not MSD: {parsed.hostname}")
            if not parsed.path.startswith(("/home/", "/professional/")):
                fail(errors, f"{lw}.url should be an MSD article path: {url}")
            if url in seen_urls:
                fail(errors, f"duplicate link URL: {url}")
            seen_urls.add(url)
            for key in ("tags", "keywords"):
                value = link.get(key, [])
                if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                    fail(errors, f"{lw}.{key} must be a string array")
            total += 1

    if total == 0:
        fail(errors, "index contains no links")
    return errors, warnings, total


def probe(urls: list[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    headers = {"User-Agent": "LifeHealthIndexChecker/1.0 (+https://unplage.github.io/Life/)"}
    for url in urls:
        req = urllib.request.Request(url, method="HEAD", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=12) as res:
                if res.status >= 400:
                    warnings.append(f"HTTP {res.status}: {url}")
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 405, 429):
                warnings.append(f"HTTP {exc.code} (bot protection): {url}")
            elif exc.code >= 400:
                errors.append(f"HTTP {exc.code}: {url}")
        except Exception as exc:  # network failures are warnings by default
            warnings.append(f"probe failed: {url} ({exc})")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true", help="probe each URL (slow; network warnings do not fail)")
    args = parser.parse_args()

    try:
        data = json.loads(INDEX.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"FAIL: cannot read {INDEX}: {exc}", file=sys.stderr)
        return 1

    errors, warnings, total = validate(data)
    urls = [link["url"] for cat in data.get("categories", []) for link in cat.get("links", []) if isinstance(link, dict) and isinstance(link.get("url"), str)]
    if args.online and not errors:
        net_errors, net_warnings = probe(urls)
        errors.extend(net_errors)
        warnings.extend(net_warnings)

    for message in warnings:
        print(f"WARN: {message}")
    for message in errors:
        print(f"FAIL: {message}", file=sys.stderr)

    if errors:
        return 1
    print(f"OK: {total} links across {len(data.get('categories', []))} categories")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
