"""
STAGE 1 — Global Document Segmentation & Context Mapping.

Scans the English wiring manual only (single source of truth) and writes
data/book_manifest.json. Does NOT write to SQLite.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

import pdfplumber

MANUALS_DIR = os.environ.get("MANUAL_DIR", r"E:\manual")
DEFAULT_OUT = os.path.join("data", "book_manifest.json")

# Single source of truth — Russian PDF excluded (duplicates / mixed text).
BOOKS = [
    ("Электросхемы XC70.pdf", "EN"),
]

PAGE_TYPES = (
    "wiring_diagram",
    "connector_pinout",
    "fuse_specification",
    "component_location",
    "toc",
)

COMPONENT_RE = re.compile(r"\b\d+[A-Z]?/\d+[A-Z0-9]*\b", re.I)
CONNECTOR_SUBJECT_RE = re.compile(r"\b(74/\d+[A-Z]?)\b", re.I)
CODE_PIN_RE = re.compile(r"\b\d+/\d+(?:[A-Z]\d+)?:\d+\b", re.I)
TOC_DOTS_RE = re.compile(r"\.{3,}|(\s\.\s){2,}")
CONTENTS_RE = re.compile(r"\bcontents\b|содержание", re.I)

FUSE_HINT_RE = re.compile(
    r"\bfuses?\b|\brelays?\b|distribution\s*box|предохранител|\bреле\b|"
    r"токораспред|f/\s*№|pf/\s*№|\bf/\d|\bpf/",
    re.I,
)
FUSE_HEADER_RE = re.compile(r"^(?:f/№|pf/№|f/\s*no|fuse\s*no)", re.I)

CONNECTOR_HINT_RE = re.compile(
    r"\bconnectors?\b|контактный\s*разъем|разъем\s+74/|"
    r"\bharness\b|жгут|floor\s*harness|door\s*harness|wire\s*code",
    re.I,
)
NO_HEADER_RE = re.compile(r"^(?:no\.?|№|n[oо])$", re.I)
HARNESS_COL_RE = re.compile(r"harness|жгут|wire\s*code|провод", re.I)

LOCATION_HINT_RE = re.compile(
    r"overview\s*locations|обзор\s*размещен|component\s*illustrations|"
    r"ground\s*connections|узловые\s*соединения|"
    r"component\s*locations?|locations?\s*of\s*components?|"
    r"расположение\s*компонент|карта\s*расположен",
    re.I,
)

POLE_RE = re.compile(
    r"(\d+\s*[-–]?\s*pin\b[^.\n]{0,36}|\d+\s*[-–]?\s*полюс\w*[^.\n]{0,36})",
    re.I,
)


def _cell(v: Any) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def is_toc_page(page_num: int, text: str) -> bool:
    if page_num >= 25:
        return False
    if CONTENTS_RE.search(text or ""):
        return True
    return len(TOC_DOTS_RE.findall(text or "")) >= 3


def header_zone_text(page_text: str, max_lines: int = 18) -> str:
    lines = [ln.strip() for ln in (page_text or "").splitlines() if ln.strip()]
    return "\n".join(lines[:max_lines])


def extract_connector_owner(page_text: str) -> tuple[str, str, list[str]]:
    """Return (title, primary_code, subject_codes) from header zone."""
    head = header_zone_text(page_text)
    codes: list[str] = []
    for m in CONNECTOR_SUBJECT_RE.finditer(head):
        c = m.group(1).upper()
        base = re.match(r"(74/\d+)", c, re.I)
        canon = base.group(1) if base else c
        if canon not in codes:
            codes.append(canon)
    primary = codes[0] if codes else ""
    pole = ""
    if primary:
        idx = head.upper().find(primary.upper())
        window = head[max(0, idx) : idx + 160] if idx >= 0 else head
        pm = POLE_RE.search(window)
        if pm:
            pole = re.sub(r"\s{2,}", " ", pm.group(1)).strip(" ,;")
    if primary and pole:
        title = f"Connector {primary} ({pole})"
    elif primary:
        title = f"Connector {primary}"
    else:
        m74 = CONNECTOR_SUBJECT_RE.search(page_text or "")
        if m74:
            primary = re.match(r"(74/\d+)", m74.group(1), re.I).group(1)
            codes = [primary]
            title = f"Connector {primary}"
        else:
            title = "Connector (unidentified)"
    return title, primary, codes


def analyze_tables(tables: list) -> tuple[list[dict], dict]:
    table_infos: list[dict] = []
    has_no = False
    harness_headers: list[str] = []
    max_cols = 0
    fuse_header = False

    for table in tables or []:
        if not table:
            continue
        header_row: list[str] = []
        header_idx = -1
        for ri, row in enumerate(table[:5]):
            if not row:
                continue
            cells = [_cell(c) for c in row]
            first = cells[0] if cells else ""
            joined = " ".join(cells)
            if NO_HEADER_RE.match(first) or (
                re.search(r"^(?:no\.?|№)\b", joined, re.I) and HARNESS_COL_RE.search(joined)
            ):
                header_row = cells
                header_idx = ri
                has_no = True
                break
            if FUSE_HEADER_RE.match(first) or re.search(r"\bf/\s*№|pf/\s*№", joined, re.I):
                header_row = cells
                header_idx = ri
                fuse_header = True
                break

        if not header_row and table[0]:
            header_row = [_cell(c) for c in table[0]]
            header_idx = 0

        cols = max((len(r) for r in table if r), default=0)
        max_cols = max(max_cols, cols)

        for h in header_row:
            if HARNESS_COL_RE.search(h) and h not in harness_headers:
                harness_headers.append(h)

        data_rows = 0
        sample: list[str] = []
        for ri, row in enumerate(table):
            if ri <= header_idx:
                continue
            if not row:
                continue
            cells = [_cell(c) for c in row]
            pin = cells[0] if cells else ""
            if re.fullmatch(r"\d{1,3}", pin):
                data_rows += 1
                if not sample:
                    sample = cells[:8]
            elif any(CODE_PIN_RE.search(c) or COMPONENT_RE.search(c) for c in cells):
                data_rows += 1
                if not sample:
                    sample = cells[:8]

        table_infos.append(
            {
                "header_row": header_row,
                "column_count": cols,
                "data_row_estimate": data_rows,
                "sample_first_data_row": sample,
            }
        )

    signals = {
        "has_no_column": has_no,
        "harness_headers": harness_headers,
        "fuse_table_header": fuse_header,
        "table_count": len(tables or []),
        "max_columns": max_cols,
    }
    return table_infos, signals


def classify_page(
    page_num: int,
    page_text: str,
    table_signals: dict,
    table_infos: list[dict],
) -> tuple[str, float, str]:
    """Return (page_type, confidence, title_hint)."""
    text = page_text or ""
    head = header_zone_text(text)

    if is_toc_page(page_num, text):
        return "toc", 0.95, "Contents"

    fuse_hits = len(FUSE_HINT_RE.findall(text))
    loc_hits = len(LOCATION_HINT_RE.findall(text))
    conn_hits = len(CONNECTOR_HINT_RE.findall(text))
    code_pin_hits = len(CODE_PIN_RE.findall(text))

    # 1) fuse_specification
    if table_signals.get("fuse_table_header") or (
        fuse_hits >= 2 and (re.search(r"\bfuses?\b|предохранител", head, re.I) or fuse_hits >= 4)
    ):
        if not (table_signals.get("has_no_column") and table_signals.get("harness_headers") and code_pin_hits >= 3):
            title = "Fuses"
            m = re.search(
                r"(Fuses?[^\n]{0,40}|Предохранител[^\n]{0,40}|Distribution box[^\n]{0,40})",
                head,
                re.I,
            )
            if m:
                title = re.sub(r"\s+", " ", m.group(1)).strip()[:80]
            return "fuse_specification", 0.9, title

    # 2) connector_pinout
    is_conn = False
    conf = 0.0
    if table_signals.get("has_no_column") and (
        table_signals.get("harness_headers") or code_pin_hits >= 2
    ):
        is_conn = True
        conf = 0.92
    elif re.search(r"\bconnectors?\b|контактный\s*разъем", head, re.I) and CONNECTOR_SUBJECT_RE.search(head):
        is_conn = True
        conf = 0.85
    elif table_signals.get("has_no_column") and CONNECTOR_SUBJECT_RE.search(head) and code_pin_hits >= 1:
        is_conn = True
        conf = 0.8
    elif conn_hits >= 2 and table_signals.get("has_no_column"):
        is_conn = True
        conf = 0.75
    # RU/text fallback: № + жгут + CODE:PIN even when pdfplumber tables are empty
    elif (
        re.search(r"(?:\bno\.?\b|№)", text, re.I)
        and re.search(r"жгут|harness", text, re.I)
        and code_pin_hits >= 2
        and CONNECTOR_SUBJECT_RE.search(head + "\n" + text[:400])
    ):
        is_conn = True
        conf = 0.78

    if is_conn and not (fuse_hits >= 3 and not table_signals.get("harness_headers")):
        title, _primary, _codes = extract_connector_owner(text)
        return "connector_pinout", conf, title

    # 3) component_location
    if LOCATION_HINT_RE.search(head) or (
        loc_hits >= 1 and not table_signals.get("has_no_column")
    ):
        title = "Component locations"
        for line in head.splitlines():
            if LOCATION_HINT_RE.search(line):
                title = line[:80]
                break
        return "component_location", 0.85 if LOCATION_HINT_RE.search(head) else 0.65, title

    # 4) wiring_diagram
    title = "Wiring diagram"
    for line in head.splitlines():
        clean = re.sub(r"TP\s*\d+", " ", line, flags=re.I)
        clean = re.sub(r"\b(?:V70|XC70|S80)\s*\([^)]*\)", " ", clean, flags=re.I)
        clean = re.sub(r"\s+", " ", clean).strip()
        if len(clean) < 8 or len(clean) > 70:
            continue
        if COMPONENT_RE.fullmatch(clean):
            continue
        if re.search(r"volvo|copyright|©|\d{4}", clean, re.I):
            continue
        title = clean
        break
    code_hits = len(COMPONENT_RE.findall(text))
    conf = 0.7 if code_hits >= 3 else 0.55
    return "wiring_diagram", conf, title


def audit_page(page, page_num: int, book: str, filename: str) -> dict:
    try:
        page_text = page.extract_text() or ""
    except Exception:
        page_text = ""

    try:
        tables = page.extract_tables() or []
    except Exception:
        tables = []

    table_infos, table_signals = analyze_tables(tables)
    page_type, confidence, title_hint = classify_page(
        page_num, page_text, table_signals, table_infos
    )

    subject_codes: list[str] = []
    title = title_hint
    if page_type == "connector_pinout":
        title, primary, subject_codes = extract_connector_owner(page_text)
        if not subject_codes and primary:
            subject_codes = [primary]

    component_hits = len(COMPONENT_RE.findall(page_text))
    fuse_hits = len(FUSE_HINT_RE.findall(page_text))
    code_pin_hits = len(CODE_PIN_RE.findall(page_text))

    preview = re.sub(r"\s+", " ", page_text).strip()[:200]

    return {
        "book": book,
        "filename": filename,
        "page": page_num,
        "page_type": page_type,
        "confidence": round(confidence, 3),
        "title": title,
        "subject_codes": subject_codes,
        "signals": {
            **table_signals,
            "component_code_hits": component_hits,
            "code_pin_hits": code_pin_hits,
            "fuse_hits": fuse_hits,
        },
        "tables": table_infos,
        "text_preview": preview,
    }


def build_stats(pages: list[dict]) -> dict:
    by_type: Counter = Counter()
    by_book: dict[str, Counter] = defaultdict(Counter)
    connector_owners: Counter = Counter()
    for p in pages:
        by_type[p["page_type"]] += 1
        by_book[p["book"]][p["page_type"]] += 1
        if p["page_type"] == "connector_pinout":
            for c in p.get("subject_codes") or []:
                connector_owners[c] += 1
    return {
        "total_pages": len(pages),
        "by_type": dict(by_type),
        "by_book": {b: dict(c) for b, c in by_book.items()},
        "top_connector_owners": connector_owners.most_common(20),
    }


def print_stats(stats: dict, pages: list[dict]) -> None:
    print("\n========== BOOK MANIFEST STATISTICS ==========")
    print(f"Total pages: {stats['total_pages']}")
    print("\nBy type:")
    for t in PAGE_TYPES:
        n = stats["by_type"].get(t, 0)
        print(f"  {t:22} {n:5}")
    print("\nBy book:")
    for book, counts in stats["by_book"].items():
        print(f"  [{book}]")
        for t in PAGE_TYPES:
            if counts.get(t):
                print(f"    {t:20} {counts[t]:5}")
    print("\nTop connector owners:")
    for code, n in stats.get("top_connector_owners") or []:
        print(f"  {code:12} pages={n}")

    def pick(ptype: str, n: int = 2) -> list[dict]:
        return [p for p in pages if p["page_type"] == ptype][:n]

    print("\n========== SAMPLE PAGES ==========")
    samples: list[dict] = []
    for p in pages:
        if p["page_type"] == "connector_pinout" and "74/507" in (p.get("subject_codes") or []):
            samples.append(p)
            break
    for ptype in (
        "connector_pinout",
        "fuse_specification",
        "component_location",
        "wiring_diagram",
        "toc",
    ):
        samples.extend(pick(ptype, 2))
    seen: set[tuple] = set()
    shown = 0
    for p in samples:
        key = (p["book"], p["page"])
        if key in seen:
            continue
        seen.add(key)
        shown += 1
        print(
            f"  {p['book']} p.{p['page']:4}  {p['page_type']:20}  "
            f"conf={p['confidence']}  title={p['title'][:60]!r}  "
            f"subjects={p.get('subject_codes')}  "
            f"cols={p['signals'].get('max_columns')}  "
            f"harness={p['signals'].get('harness_headers')}"
        )
        if shown >= 10:
            break
    print("==============================================\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 1: build book_manifest.json (no DB)")
    parser.add_argument("--out", default=DEFAULT_OUT, help="Output JSON path")
    parser.add_argument("--limit", type=int, default=0, help="Max pages per book (0=all)")
    parser.add_argument("--manual-dir", default=MANUALS_DIR)
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if not os.path.isdir(args.manual_dir):
        print(f"ERROR: MANUAL_DIR not found: {args.manual_dir}", file=sys.stderr)
        return 1

    manuals_meta = []
    pages: list[dict] = []

    for filename, book in BOOKS:
        path = os.path.join(args.manual_dir, filename)
        if not os.path.isfile(path):
            print(f"ERROR: PDF not found: {path}", file=sys.stderr)
            return 1
        manuals_meta.append({"filename": filename, "book": book, "path": path})
        print(f"Scanning [{book}] {filename} …")
        with pdfplumber.open(path) as pdf:
            total = len(pdf.pages)
            limit = total if args.limit <= 0 else min(args.limit, total)
            for idx in range(limit):
                page_num = idx + 1
                rec = audit_page(pdf.pages[idx], page_num, book, filename)
                pages.append(rec)
                if page_num % 50 == 0 or page_num == limit:
                    print(f"  … {book} {page_num}/{limit}")

    stats = build_stats(pages)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stage": 1,
        "note": "Structural map only. No SQLite writes. Await verification before Stage 2/3.",
        "manuals": manuals_meta,
        "page_type_enum": list(PAGE_TYPES),
        "pages": pages,
        "stats": stats,
    }

    os.makedirs(os.path.dirname(args.out) or "data", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    summary_path = os.path.join(os.path.dirname(args.out) or "data", "book_manifest_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": manifest["generated_at"],
                "stats": stats,
                "out": args.out,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print_stats(stats, pages)
    print(f"Wrote: {args.out}")
    print(f"Wrote: {summary_path}")
    print("HALT: Stage 1 complete. No database writes. Verify manifest before Stage 2.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
