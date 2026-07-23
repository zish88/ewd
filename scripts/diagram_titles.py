"""
Build human-readable wiring-diagram page titles from TOC + spam filtering.
Writes data/diagram_titles.json for Stage 3 / nav.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

import pdfplumber

MANUALS_DIR = os.environ.get("MANUAL_DIR", r"E:\manual")
MANIFEST_PATH = os.path.join("data", "book_manifest.json")
OUT_PATH = os.path.join("data", "diagram_titles.json")

COLOR_TOKEN_RE = re.compile(
    r"\b(?:LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|GO|TV|KB|DR|AU)"
    r"(?:-(?:LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|GO|TV|KB|DR|AU))?\b",
    re.I,
)
PIN_TOKEN_RE = re.compile(r"\b[A-Z]?\d+[A-Z]?:\d+[A-Z]?\b", re.I)
COMPONENT_RE = re.compile(r"\b\d+[A-Z]?/\d+(?:\.\d+)?[A-Z0-9]*\b", re.I)
TOC_DOTS_RE = re.compile(
    r"^(.+?)\s*\.{2,}\s*(\d{1,3})\s*$",
)
TOC_SPACES_RE = re.compile(
    r"^([A-Za-z][A-Za-z0-9 /,&'():-]{5,80}?)\s+(\d{1,3})\s*$",
)
NOISE_LINE_RE = re.compile(
    r"table of contents|volvo car corporation|copyright|©|tp\s*\d+|v70\(|xc70\(|s80\(",
    re.I,
)

# Text reference / index pages — never treat as graphical wiring diagrams
DIAGRAM_TITLE_BLACKLIST = [
    r"overview\s+designations",
    r"list\s+of\s+components",
    r"abbreviations",
    r"table\s+of\s+contents",
    r"^explanations\b",
    r"how\s+to\s+use\s+the\s+wiring",
    r"branching\s+points",
    r"^structure\s+week\b",
    r"vehicles\s+with\s+srs",
    r"control\s+modules\s+overview\s+designations",
    # Textual fuse/relay lists (not fuse-box schematics)
    r"^fuses?\b.*\blist\b",
    r"^relays?\b.*\blist\b",
    r"list\s+of\s+fuses",
    r"list\s+of\s+relays",
]
_DIAGRAM_TITLE_BLACKLIST_RE = re.compile(
    "|".join(f"(?:{p})" for p in DIAGRAM_TITLE_BLACKLIST),
    re.I,
)


def is_non_diagram_reference_title(*parts: str) -> bool:
    """True if any title/TOC/preview fragment is a non-schematic reference page."""
    blob = " ".join(re.sub(r"\s+", " ", str(p or "").strip()) for p in parts if p)
    if not blob:
        return False
    return bool(_DIAGRAM_TITLE_BLACKLIST_RE.search(blob))


def is_spam_title(title: str) -> bool:
    t = re.sub(r"\s+", " ", (title or "").strip())
    if not t or len(t) < 4:
        return True
    low = t.lower()
    if low == "wiring diagram":
        return True
    if low in ("contents", "explanations"):
        return False
    colors = COLOR_TOKEN_RE.findall(t)
    if len(colors) >= 2:
        return True
    if COLOR_TOKEN_RE.search(t) and not re.search(r"[A-Za-z]{4,}", COLOR_TOKEN_RE.sub(" ", t)):
        return True
    pins = PIN_TOKEN_RE.findall(t)
    codes = COMPONENT_RE.findall(t)
    words = re.findall(r"[A-Za-z]{3,}", t)
    meaningful = [w for w in words if w.upper() not in {"CAN", "LIN", "LHD", "RHD", "CEM", "ECM", "SRS", "ABS"}]
    if pins and len(meaningful) < 2:
        return True
    if len(codes) >= 2 and len(meaningful) <= 2:
        return True
    if codes and len(meaningful) <= 1:
        return True
    if re.fullmatch(r"[\d/\s:A-Za-z-]{1,40}", t) and len(meaningful) <= 1 and (codes or pins or colors):
        return True
    # "4/83 5 4 1" / "2 1 11D/A3" style
    if re.fullmatch(r"[\d/\sA-Za-z.-]+", t) and len(meaningful) <= 1:
        return True
    if re.fullmatch(r"[\d/\s]+", t):
        return True
    return False


def clean_candidate(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "").strip())
    t = re.sub(r"^\d+:\d+\s*", "", t)  # strip "1:2 " prefix from TOC section markers
    # Keep trailing "1:2" / "2:2" section parts — useful for Keyless vehicle 2:2
    t = re.sub(r"\.{2,}", "", t).strip(" .-")
    # TOC often glues two entries: "Foo 11 Bar" → keep first phrase
    m = re.match(
        r"^(.+?)\s+\d{1,3}\s+([A-Z][A-Za-z].+)$",
        t,
    )
    if m and len(m.group(1)) >= 8 and not is_spam_title(m.group(1)):
        t = m.group(1).strip()
    return t[:100]


def format_diagram_title(raw: str, page: int, component_code: str = "", toc_title: str = "") -> str:
    """Prefer TOC, then non-spam page title, else template."""
    for candidate in (toc_title, raw):
        c = clean_candidate(candidate)
        if c and not is_spam_title(c) and not is_non_diagram_reference_title(c):
            return f"{c} (стр. {page})"
    code = (component_code or "").strip()
    if code:
        return f"Схема: {code} (стр. {page})"
    return f"Схема (стр. {page})"


def parse_toc_text(text: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for raw_line in (text or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or NOISE_LINE_RE.search(line):
            continue
        if line.lower().startswith("group "):
            continue
        m = TOC_DOTS_RE.match(line)
        if not m:
            # dotted leaders sometimes collapsed to spaces in extract
            m2 = re.match(r"^(.+?)\s{2,}(\d{1,3})\s*$", line)
            if m2 and re.search(r"[A-Za-z]{3,}", m2.group(1)):
                m = m2
        if not m:
            continue
        title = clean_candidate(m.group(1))
        page = int(m.group(2))
        if page < 1 or page > 400:
            continue
        if is_spam_title(title) or len(title) < 5:
            continue
        # Prefer longer / more descriptive title per page
        prev = out.get(page, "")
        if len(title) > len(prev):
            out[page] = title
    return out


HEADER_RE = re.compile(
    r"(Group\s+\d+\s+[A-Za-z][A-Za-z0-9 /,&'()-]{3,60}?)(?:\s+([A-Za-z][A-Za-z0-9 /,&'():-]{3,50}?))?"
    r"(?=\s+(?:TP\s*\d+|V70|XC70|S80|LHD|RHD|30\+|CAN|LIN|\d{2,3}/\d|\d+:\d+))",
    re.I,
)
SECTION_ONLY_RE = re.compile(
    r"\b((?:Keyless vehicle|Branching points|Fuses|Relays|Ground connections|"
    r"Wiper/washer[^\n]{0,40}|Direction indicator[^\n]{0,40}|"
    r"High pressure headlight washer|Audio|Infotainment|Climate|"
    r"Engine management|Starting system|Charging system|"
    r"Central electronic module|Power seats|Power windows|"
    r"Central locking|Anti-theft|SRS|ABS|DSTC)[^\n]{0,30})",
    re.I,
)


def title_from_preview(preview: str) -> str:
    """Extract human section title from OCR page header / preview."""
    text = re.sub(r"\s+", " ", (preview or "").strip())
    if not text:
        return ""
    m = HEADER_RE.search(text)
    if m:
        group = clean_candidate(m.group(1))
        sub = clean_candidate(m.group(2) or "")
        if sub and not is_spam_title(sub) and "group" not in sub.lower():
            # Prefer short section name; keep group as fallback context
            if len(sub) >= 5:
                return sub
        if group and not is_spam_title(group):
            return group
    m2 = SECTION_ONLY_RE.search(text)
    if m2:
        t = clean_candidate(m2.group(1))
        if t and not is_spam_title(t):
            return t
    return ""


def build_from_manifest_and_pdf(manifest_path: str, manuals_dir: str) -> dict[int, str]:
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    titles: dict[int, str] = {}
    # 1) Manifest titles for diagram pages (when not spam)
    for p in manifest.get("pages") or []:
        if p.get("book") != "EN":
            continue
        if p.get("page_type") != "wiring_diagram":
            continue
        page = int(p["page"])
        t = clean_candidate(p.get("title") or "")
        if t and not is_spam_title(t):
            titles[page] = t
        # Prefer header parsed from text_preview over OCR spam titles
        preview_title = title_from_preview(p.get("text_preview") or "")
        if preview_title and (
            page not in titles or is_spam_title(titles.get(page, "")) or len(preview_title) > len(titles[page])
        ):
            titles[page] = preview_title

    # 2) TOC from PDF Contents pages
    path_by_book = {}
    for m in manifest.get("manuals") or []:
        path_by_book[m["book"]] = m.get("path") or os.path.join(manuals_dir, m["filename"])
    pdf_path = path_by_book.get("EN")
    toc_pages = [
        int(p["page"])
        for p in (manifest.get("pages") or [])
        if p.get("book") == "EN" and p.get("page_type") == "toc"
    ]
    if pdf_path and os.path.isfile(pdf_path) and toc_pages:
        with pdfplumber.open(pdf_path) as pdf:
            for pn in toc_pages:
                if pn < 1 or pn > len(pdf.pages):
                    continue
                try:
                    text = pdf.pages[pn - 1].extract_text() or ""
                except Exception:
                    text = ""
                for page, title in parse_toc_text(text).items():
                    cur = titles.get(page, "")
                    # Official TOC beats OCR spam / bare Group headers
                    if (
                        page not in titles
                        or is_spam_title(cur)
                        or is_generic_group_title(cur)
                        or len(title) > len(cur)
                    ):
                        titles[page] = title

    # 3) Fill gaps between TOC section starts (e.g. Keyless 1:2 @130 → page 131 = Keyless 2:2)
    titles = fill_section_gaps(titles, max_gap=4)
    # 4) Drop reference / index pages from diagram title map
    titles = {
        page: title
        for page, title in titles.items()
        if not is_non_diagram_reference_title(title)
    }
    return titles


def is_generic_group_title(title: str) -> bool:
    """True for bare 'Group 36 Additional electrical equipment' without a subsystem name."""
    t = re.sub(r"\s+", " ", (title or "").strip())
    return bool(re.fullmatch(r"Group\s+\d+\s+[A-Za-z][A-Za-z /,&'-]{3,60}", t, re.I))


def fill_section_gaps(titles: dict[int, str], max_gap: int = 4) -> dict[int, str]:
    """Propagate section title to following pages until next TOC entry."""
    if not titles:
        return titles
    pages = sorted(titles)
    out = dict(titles)
    for i, start in enumerate(pages):
        title = titles[start]
        if is_spam_title(title) or is_generic_group_title(title) or is_non_diagram_reference_title(title):
            continue
        end = pages[i + 1] if i + 1 < len(pages) else start + max_gap + 1
        # Don't stretch across huge gaps (new group)
        limit = min(end, start + max_gap + 1)
        for p in range(start + 1, limit):
            cur = out.get(p, "")
            if cur and not is_spam_title(cur) and not is_generic_group_title(cur) and not is_non_diagram_reference_title(cur):
                continue
            # Prefer "Title 2:2" style when previous was "... 1:2"
            base = re.sub(r"\s+\d+:\d+\s*$", "", title).strip()
            m = re.search(r"(\d+):(\d+)\s*$", title)
            if m and base:
                part = int(m.group(1)) + (p - start)
                out[p] = f"{base} {part}:{m.group(2)}"
            else:
                out[p] = title
    return out


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=MANIFEST_PATH)
    ap.add_argument("--manual-dir", default=MANUALS_DIR)
    ap.add_argument("--out", default=OUT_PATH)
    args = ap.parse_args()

    titles = build_from_manifest_and_pdf(args.manifest, args.manual_dir)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(titles),
        "titles": {str(k): v for k, v in sorted(titles.items())},
    }
    os.makedirs(os.path.dirname(args.out) or "data", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {args.out} ({len(titles)} titles)")
    for sample in (131, 276, 51, 86):
        print(f"  {sample}: {titles.get(sample, '(missing)')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
