#!/usr/bin/env python3
"""Build the local MSD Manuals link index.

The generated health-links.json contains only titles and official URLs.
No article text, images, or videos are copied.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = "https://www.msdmanuals.cn/home/women-s-health-issues"
BASE = "https://www.msdmanuals.cn"

CATEGORY_MAP = {
    "biology-of-the-female-reproductive-system": ("basics", "女性生理基础", "🧬", ["period", "puberty"]),
    "symptoms-of-gynecologic-disorders": ("symptoms", "妇科症状自查", "🔍", ["period", "general"]),
    "diagnosis-of-gynecologic-disorders": ("checkup", "妇科检查", "🩺", ["general"]),
    "breast-disorders": ("breast", "乳房健康", "💗", ["general", "postpartum"]),
    "endometriosis": ("endometriosis", "子宫内膜异位症", "🌹", ["period"]),
    "family-planning": ("contraception", "避孕与生育计划", "🛡️", ["reproductive"]),
    "fibroids": ("fibroids", "子宫肌瘤", "🩸", ["period"]),
    "infertility-and-recurrent-miscarriage": ("infertility", "备孕与不孕", "🌱", ["preconception"]),
    "menopause": ("menopause", "更年期与绝经", "🌙", ["menopause"]),
    "menstrual-disorders-and-abnormal-uterine-bleeding": ("menstrual", "月经与异常出血", "🌸", ["period"]),
    "miscellaneous-gynecologic-abnormalities": ("gyn-other", "其他妇科问题", "📋", ["general"]),
    "pelvic-organ-prolapse-pop": ("pelvic-floor", "盆底健康", "🧘", ["postpartum", "menopause"]),
    "sexual-function-and-dysfunction-in-women": ("sexual-health", "女性性健康", "💞", ["general"]),
    "vaginitis-cervicitis-and-pelvic-inflammatory-disease": ("infection", "阴道炎与盆腔炎", "🦠", ["general"]),
    "symptoms-during-pregnancy": ("pregnancy-symptoms", "孕期不适", "🤰", ["pregnancy"]),
    "complications-of-labor-and-delivery": ("delivery-complications", "分娩并发症", "🏥", ["delivery"]),
    "complications-of-pregnancy": ("pregnancy-complications", "妊娠并发症", "⚠️", ["pregnancy"]),
    "detection-of-genetic-disorders-before-and-during-pregnancy": ("prenatal-testing", "产前筛查", "🧪", ["pregnancy"]),
    "early-pregnancy-disorders": ("early-pregnancy", "早孕问题", "🌱", ["pregnancy"]),
    "medication-and-substance-use-during-pregnancy": ("medication", "孕期用药", "💊", ["pregnancy", "postpartum"]),
    "labor-and-delivery": ("delivery", "分娩", "👶", ["delivery"]),
    "normal-pregnancy": ("pregnancy", "正常孕期", "🤰", ["pregnancy"]),
    "postpartum-care": ("postpartum", "产后护理", "🌙", ["postpartum", "baby"]),
    "pregnancy-complicated-by-disease": ("pregnancy-disease", "孕期合并疾病", "🩺", ["pregnancy"]),
}

CATEGORY_ORDER = [
    "basics", "symptoms", "menstrual", "endometriosis", "fibroids", "infection",
    "breast", "checkup", "contraception", "infertility", "pregnancy", "pregnancy-symptoms",
    "pregnancy-complications", "pregnancy-disease", "prenatal-testing", "early-pregnancy",
    "medication", "delivery", "delivery-complications", "postpartum", "pelvic-floor",
    "menopause", "sexual-health", "gyn-other",
]

EXTRA_KEYWORDS = {
    "period": ["月经", "痛经", "经期", "经前", "出血", "内分泌", "多囊"],
    "preconception": ["备孕", "不孕", "排卵", "叶酸", "受孕", "流产"],
    "pregnancy": ["怀孕", "孕期", "妊娠", "产前", "胎", "预产期"],
    "delivery": ["分娩", "生产", "剖腹", "剖宫", "催产", "待产"],
    "postpartum": ["产后", "月子", "哺乳", "母乳", "恶露", "盆底"],
    "menopause": ["绝经", "更年期", "潮热"],
    "general": ["妇科", "女性", "检查", "感染", "乳房", "避孕"],
}

LINK_RE = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Life-health-index/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def clean_text(raw: str) -> str:
    return " ".join(html.unescape(TAG_RE.sub(" ", raw)).split())


def build(source_html: str) -> dict:
    seen: set[str] = set()
    categories: dict[str, dict] = {}
    for href, raw_title in LINK_RE.findall(source_html):
        href = html.unescape(href)
        if not href.startswith("/home/women-s-health-issues/"):
            continue
        if "#" in href:
            continue
        parts = href.strip("/").split("/")
        if len(parts) < 4:
            continue
        category_slug = parts[2]
        if category_slug not in CATEGORY_MAP:
            continue
        title = clean_text(raw_title)
        if not title or len(title) > 80:
            continue
        url = BASE + href
        if url in seen:
            continue
        seen.add(url)
        cat_id, cat_name, icon, stages = CATEGORY_MAP[category_slug]
        cat = categories.setdefault(cat_id, {
            "id": cat_id,
            "name": cat_name,
            "icon": icon,
            "stages": stages,
            "links": [],
        })
        keywords = []
        for stage in stages:
            keywords.extend(EXTRA_KEYWORDS.get(stage, []))
        cat["links"].append({
            "title": title,
            "url": url,
            "tags": stages,
            "keywords": sorted(set(keywords + [title])),
        })

    ordered = []
    for cat_id in CATEGORY_ORDER:
        cat = categories.get(cat_id)
        if not cat or not cat["links"]:
            continue
        # Keep the official page order, but remove exact duplicate titles.
        unique = []
        titles = set()
        for link in cat["links"]:
            if link["title"] in titles:
                continue
            titles.add(link["title"])
            unique.append(link)
        cat["links"] = unique
        ordered.append(cat)

    return {
        "version": 1,
        "source": "默沙东诊疗手册中文版（大众版）",
        "sourceUrl": SOURCE_URL,
        "officialSearch": "https://www.msdmanuals.cn/home/searchresults?query=",
        "disclaimer": "本索引仅提供官方页面链接与标题，不复制文章内容，不能替代医生诊断。默沙东诊疗手册为独立第三方网站，本应用与其无隶属或合作关系。",
        "categories": ordered,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Read a saved HTML file instead of fetching")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "health-links.json"))
    args = parser.parse_args()
    source = Path(args.input).read_text(encoding="utf-8", errors="replace") if args.input else fetch(SOURCE_URL)
    data = build(source)
    total = sum(len(c["links"]) for c in data["categories"])
    if total < 20:
        print(f"Only {total} links found; refusing to overwrite index", file=sys.stderr)
        return 1
    Path(args.output).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {total} links in {len(data['categories'])} categories to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
