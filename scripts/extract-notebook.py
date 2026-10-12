#!/usr/bin/env python3
"""PDF 교무수첩에서 쪽·링크·라벨을 뽑아 웹앱용 JSON을 만듭니다."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pymupdf

PDF = Path(
    "/home/ubuntu/.cursor/projects/workspace/uploads/"
    "caccdf859bbfd577bfb44c5afde9e3db55ca69dd70cb6777f02f4511718fca31_465a.pdf"
)
OUT = Path("/workspace/src/notebook/data/notebook.json")
STATS = Path("/workspace/src/notebook/data/coverage.json")

PAGE_W, PAGE_H = 1180.0, 820.0
LEFT_MAX = 50.0
RIGHT_MIN = 1130.0
TOP_MAX = 80.0
TOP_MIN_X = 700.0


def classify(n: int, first: str, title: str) -> str:
    if n == 1:
        return "cover"
    if n == 2:
        return "home"
    if n in (3, 4):
        return "prep"
    if 5 <= n <= 8:
        return "howto"
    if n == 9:
        return "tag-legend"
    if 10 <= n <= 31:
        return "tag-index"
    if n == 32:
        return "year-cal"
    if n == 33:
        return "academic"
    if 34 <= n <= 45:
        return "month"
    if n == 46:
        return "week-toc"
    if 47 <= n <= 98:
        return "week"
    if n == 99:
        return "special-toc"
    if 100 <= n <= 139:
        return "special-day"
    if n == 140:
        return "class-toc"
    if 141 <= n <= 144:
        return "timetable"
    if n == 145:
        return "class-rules"
    if n in (146, 147):
        return "roles"
    if 148 <= n <= 153:
        return "seating"
    if n == 154:
        return "roster"
    if n in (155, 156):
        return "survey"
    if n in (157, 158):
        return "health"
    if 159 <= n <= 222:
        return "student-who" if n % 2 == 0 else "student-card"
    if 223 <= n <= 230:
        return "quick-note"
    if n == 231:
        return "attend-toc"
    if 232 <= n <= 255:
        return "attend"
    if n == 256:
        return "counsel-toc"
    if 257 <= n <= 288:
        return "counsel"
    if 289 <= n <= 320:
        return "parent"
    if n in (321, 322):
        return "consult-time"
    if 323 <= n <= 334:
        return "incident"
    if n == 335:
        return "lesson-toc"
    if 336 <= n <= 347:
        return "progress"
    if n in (348, 349):
        return "eval-area"
    if 350 <= n <= 379:
        return "unit"
    if 380 <= n <= 395:
        return "checklist"
    if 396 <= n <= 403:
        return "score"
    if n == 404:
        return "work-toc"
    if 405 <= n <= 410:
        return "deadline"
    if 411 <= n <= 416:
        return "todo"
    if 417 <= n <= 457:
        return "meeting"
    if 458 <= n <= 467:
        return "notice"
    if n in (468, 469):
        return "budget-toc"
    if 470 <= n <= 483:
        return "budget-item"
    if 484 <= n <= 493:
        return "budget-misc"
    if n == 494:
        return "year-prep"
    if n == 495:
        return "ssugeok-toc"
    if 496 <= n <= 500:
        return "ssugeok"
    if 501 <= n <= 515:
        return "memo"
    if n == 516:
        return "notebook-toc"
    if 517 <= n <= 558:
        return "notebook-paper"
    if n == 559:
        return "board-toc"
    if n == 560:
        return "chalkboard"
    if n == 561:
        return "whiteboard"
    if n == 562:
        return "grid-board"
    if n == 563:
        return "sticker-toc"
    return "sticker-sheet"


def nearby_label(words, rect, pad=6):
    x0, y0, x1, y1 = rect
    hits = []
    for wx0, wy0, wx1, wy1, w in words:
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if (x0 - pad) <= cx <= (x1 + pad) and (y0 - pad) <= cy <= (y1 + pad):
            if w in ("ⓒJ쌤",) or re.fullmatch(r"p\.\d+", w):
                continue
            hits.append((wy0, wx0, w))
    hits.sort()
    if not hits:
        return ""
    # 같은 줄끼리 이어 붙임
    lines, cur_y, buf = [], None, []
    for y, x, w in hits:
        if cur_y is None or abs(y - cur_y) < 8:
            buf.append(w)
            cur_y = y if cur_y is None else cur_y
        else:
            lines.append(" ".join(buf))
            buf, cur_y = [w], y
    if buf:
        lines.append(" ".join(buf))
    label = " ".join(lines).strip()
    return label[:40]


def extra_for(n, typ, first, text):
    extra = {}
    if typ == "tag-index":
        m = re.search(r"(#\S+)", text)
        extra["tag"] = m.group(1) if m else first
    if typ == "month":
        extra["month"] = 3 + (n - 34) if n <= 43 else n - 43
        extra["year"] = 2026 if n <= 43 else 2027
    if typ == "week":
        extra["week"] = n - 46
        m = re.search(r"(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}).*?(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", text)
        if m:
            extra["range"] = f"{m.group(1)} ~ {m.group(2)}"
    if typ == "special-day":
        extra["slot"] = n - 99
    if typ == "student-card":
        extra["student"] = (n - 157) // 2
    if typ == "student-who":
        extra["student"] = (n - 158) // 2
    if typ == "attend":
        extra["attendIndex"] = n - 232
        extra["month"] = 3 + ((n - 232) // 2) if n <= 251 else ((n - 252) + 1)
        extra["half"] = "1-16" if (n - 232) % 2 == 0 else "17-32"
    if typ == "counsel":
        extra["student"] = n - 256
    if typ == "parent":
        extra["student"] = n - 288
    if typ == "ssugeok":
        extra["slot"] = n - 495
    if typ == "memo":
        extra["slot"] = n - 495
    if typ == "notebook-paper":
        extra["paper"] = first
    if typ == "progress":
        extra["slot"] = n - 335
    if typ == "unit":
        extra["slot"] = n - 349
    if typ == "checklist":
        extra["slot"] = n - 379
    if typ == "meeting":
        extra["slot"] = n - 416
    if typ == "budget-item":
        extra["slot"] = n - 469
    if typ == "deadline":
        extra["slot"] = n - 404
    if typ == "todo":
        extra["slot"] = n - 410
    return extra


def main():
    doc = pymupdf.open(PDF)
    fonts = Counter()
    for page in doc:
        for f in page.get_fonts(full=True):
            fonts[f[3].split("+")[-1]] += 1

    toc = [{"level": i[0], "title": i[1], "page": i[2]} for i in doc.get_toc()]

    chrome_left = [
        {"label": "홈", "to": 2},
        {"label": "쓰", "to": 496},
        {"label": "연간", "to": 32},
        {"label": "주간", "to": 46},
        {"label": "하루", "to": 99},
        {"label": "학급", "to": 140},
        {"label": "학생", "to": 154},
        {"label": "출결", "to": 231},
        {"label": "상담", "to": 256},
        {"label": "수업", "to": 335},
        {"label": "업무", "to": 404},
        {"label": "태그", "to": 9},
        {"label": "공책", "to": 516},
        {"label": "칠판", "to": 559},
    ]
    chrome_right = [
        {"label": "3", "to": 34},
        {"label": "4", "to": 35},
        {"label": "5", "to": 36},
        {"label": "6", "to": 37},
        {"label": "7", "to": 38},
        {"label": "8", "to": 39},
        {"label": "9", "to": 40},
        {"label": "10", "to": 41},
        {"label": "11", "to": 42},
        {"label": "12", "to": 43},
        {"label": "1", "to": 44},
        {"label": "2", "to": 45},
        {"label": "스티커", "to": 563},
    ]

    pages = []
    total_links = 0
    chrome_links = 0
    content_links = 0
    top_links = 0
    pages_with_chrome = 0

    for i, page in enumerate(doc):
        n = i + 1
        words = [(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text("words")]
        blocks = [(b[1], b[4].strip()) for b in page.get_text("blocks") if b[4].strip()]
        blocks.sort()
        first = ""
        for y, t in blocks:
            line = t.split("\n")[0]
            if line in ("ⓒJ쌤",) or re.fullmatch(r"p\.\d+", line):
                continue
            first = line
            break
        title = first
        typ = classify(n, first, title)
        text = page.get_text("text")

        top_nav = []
        links = []
        has_left = has_right = False
        for link in page.get_links():
            total_links += 1
            r = link["from"]
            dest = int(link["page"]) + 1
            rect = [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)]
            if r.x1 <= LEFT_MAX:
                chrome_links += 1
                has_left = True
                continue
            if r.x0 >= RIGHT_MIN:
                chrome_links += 1
                has_right = True
                continue
            label = nearby_label(words, rect)
            rec = {"to": dest, "rect": rect, "label": label}
            if r.y1 <= TOP_MAX and r.x0 >= TOP_MIN_X:
                top_links += 1
                top_nav.append(rec)
            else:
                content_links += 1
                links.append(rec)
        if has_left and has_right:
            pages_with_chrome += 1

        pages.append(
            {
                "n": n,
                "type": typ,
                "title": title[:80],
                "topNav": top_nav,
                "links": links,
                "extra": extra_for(n, typ, first, text),
            }
        )

    data = {
        "title": "2026학년도 교무수첩 (초등 담임) v2",
        "pageCount": doc.page_count,
        "pageW": PAGE_W,
        "pageH": PAGE_H,
        "fonts": [name for name, _ in fonts.most_common()],
        "toc": toc,
        "chrome": {"left": chrome_left, "right": chrome_right},
        "pages": pages,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    shipped = chrome_links + content_links + top_links
    stats = {
        "pdfLinks": total_links,
        "shippedLinks": shipped,
        "chromeLinks": chrome_links,
        "topNavLinks": top_links,
        "contentLinks": content_links,
        "pagesWithChrome": pages_with_chrome,
        "pageCount": doc.page_count,
        "coveragePct": round(100.0 * shipped / total_links, 3) if total_links else 0,
        "uniqueTypes": sorted({p["type"] for p in pages}),
        "fonts": [name for name, _ in fonts.most_common()],
    }
    STATS.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
