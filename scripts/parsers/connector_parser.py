"""
Stage 2 — Connector pinout matrix parser.

Consumes connector_pinout pages from book_manifest.json.
One sequence No. → one or more sub-row circuit records (never merge across No.).
"""
from __future__ import annotations

import os
import re
from typing import Any

import pdfplumber

from .tokens import (
    COLOR_RE,
    EMPTY_RE,
    NODE_PIN_RE,
    COMPONENT_RE,
    detect_steering,
    extract_color,
    normalize_wire_color,
    parse_endpoint,
    wire_color_ru,
)

NO_HEADER_RE = re.compile(r"^(?:no\.?|№|n[oо])$", re.I)
HARNESS_HINT_RE = re.compile(r"harness|жгут|compartment|door|dashboard|floor|tunnel|heater|engine", re.I)
HEADER_SKIP_RE = re.compile(r"^(?:no\.?|№|n[oо]|color|colour|wire|wires?|pin)$", re.I)
# New pinout endpoint line (not PDF word-wrap continuation)
_ENDPOINT_LINE_RE = re.compile(
    r"^(?:\d+[A-Z]?/\d+(?:\.\d+)?[A-Z0-9]*(?::\S+)?|-)\b",
    re.I,
)


def _cell(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _is_header_row(cells: list[str]) -> bool:
    if not cells:
        return False
    first = cells[0].strip()
    if NO_HEADER_RE.match(first):
        return True
    joined = " ".join(cells)
    return bool(re.search(r"^(?:no\.?|№)\b", joined, re.I) and re.search(r"harness|жгут|wire", joined, re.I))


def _clean_harness_name(text: str) -> str:
    t = re.sub(r"\s+", " ", (text or "").replace("\n", " ")).strip()
    return t


def _split_sides(cells_after_pin: list[str]) -> tuple[str, str]:
    cells = [_cell(c) for c in cells_after_pin]
    joined = " ".join(c for c in cells if c)
    if not joined or EMPTY_RE.match(joined.replace(" ", "")):
        return "", ""
    matches = list(NODE_PIN_RE.finditer(joined))
    if len(matches) >= 2:
        mid = matches[1].start()
        return joined[:mid].strip(), joined[mid:].strip()
    nonempty = [c for c in cells if c and not EMPTY_RE.match(c)]
    if len(cells) >= 4:
        mid = len(cells) // 2
        return " ".join(cells[:mid]).strip(), " ".join(cells[mid:]).strip()
    if len(nonempty) >= 2:
        return nonempty[0], nonempty[1]
    return joined, ""


def _is_color_cell(text: str) -> bool:
    t = (text or "").strip()
    if not t or EMPTY_RE.match(t):
        return True
    return bool(normalize_wire_color(t) or COLOR_RE.fullmatch(t))


def _parse_harness_headers(cells: list[str]) -> tuple[str, str]:
    """Extract left/right harness names from a pinout header row."""
    cells = [_clean_harness_name(_cell(c)) for c in cells]
    after = cells[1:] if cells and NO_HEADER_RE.match(cells[0]) else cells
    candidates: list[str] = []
    for c in after:
        if not c or HEADER_SKIP_RE.match(c) or _is_color_cell(c):
            continue
        if HARNESS_HINT_RE.search(c) or (len(c) >= 4 and not COLOR_RE.fullmatch(c)):
            candidates.append(c)
    preferred = [c for c in candidates if re.search(r"harness|жгут", c, re.I)]
    use = preferred if len(preferred) >= 1 else candidates
    if len(use) >= 2:
        return use[0], use[1]
    if len(use) == 1:
        return use[0], ""
    return "", ""


def _split_endpoint_lines(text: str) -> list[str]:
    """Split on newlines only when a line starts a new endpoint (not word-wrap)."""
    raw = (text or "").strip()
    if not raw:
        return []
    if "\n" not in raw:
        return [re.sub(r"\s+", " ", raw).strip()]
    parts: list[str] = []
    buf = ""
    for line in raw.split("\n"):
        p = line.strip()
        if not p or EMPTY_RE.match(p):
            continue
        if _ENDPOINT_LINE_RE.match(p) and buf:
            parts.append(re.sub(r"\s+", " ", buf).strip())
            buf = p
        else:
            buf = f"{buf} {p}".strip() if buf else p
    if buf:
        parts.append(re.sub(r"\s+", " ", buf).strip())
    return parts or [re.sub(r"\s+", " ", raw).strip()]


def _side_blobs(cols: list[str]) -> list[str]:
    """Build one blob per real endpoint; keep color column attached to every sub-row."""
    if not cols:
        return [""]
    cols = [_cell(c) for c in cols]
    color = ""
    text_cols = cols
    # Last cell is color when it looks like a color/dash and earlier cells are text.
    if (
        len(cols) >= 2
        and _is_color_cell(cols[-1])
        and any(c and not _is_color_cell(c) for c in cols[:-1])
    ):
        color = normalize_wire_color(cols[-1])
        text_cols = cols[:-1]

    # Split endpoint lines from the primary text column; append other text cols.
    primary = text_cols[0] if text_cols else ""
    extra = " ".join(
        re.sub(r"\s+", " ", c).strip()
        for c in text_cols[1:]
        if c and not EMPTY_RE.match(c)
    ).strip()
    lines = _split_endpoint_lines(primary)
    if not lines:
        lines = [extra] if extra else [""]
    elif extra:
        lines = [f"{ln} {extra}".strip() for ln in lines]

    if color:
        return [f"{ln} {color}".strip() for ln in lines]
    return lines


def _partition_side_cols(after: list[str]) -> tuple[list[str], list[str]]:
    """
    Partition cells after pin into left/right column groups.

    Common pdfplumber shapes:
      4-col: code+desc | color | code+desc | color
      6-col: code | desc | color | code | desc | color
    """
    cells = [_cell(c) for c in after]
    if len(cells) >= 6:
        # Prefer explicit 6-col pinout when positions 2 and 5 look like colors.
        if _is_color_cell(cells[2]) and _is_color_cell(cells[5]):
            return cells[:3], cells[3:6]
        mid = len(cells) // 2
        return cells[:mid], cells[mid:]
    if len(cells) == 5:
        # Occasional empty spacer column
        nonempty_idx = [i for i, c in enumerate(cells) if c]
        if len(nonempty_idx) == 4:
            trimmed = [cells[i] for i in nonempty_idx]
            return _partition_side_cols(trimmed)
        mid = len(cells) // 2
        return cells[:mid], cells[mid:]
    if len(cells) >= 4:
        # 4-col: [Ltext, Lcolor, Rtext, Rcolor]
        if _is_color_cell(cells[1]) and _is_color_cell(cells[3]):
            return cells[:2], cells[2:4]
        mid = len(cells) // 2
        return cells[:mid], cells[mid:]
    if len(cells) >= 2:
        return [cells[0]], cells[1:]
    return cells, []


def _row_side_pairs(after: list[str]) -> list[tuple[str, str]]:
    """Split a pinout data row into left/right endpoint blobs (one pair per sub-row)."""
    left_cols, right_cols = _partition_side_cols(after)
    lefts = _side_blobs(left_cols)
    rights = _side_blobs(right_cols)

    if len(lefts) == 1 and len(rights) > 1:
        lefts = lefts * len(rights)
    elif len(rights) == 1 and len(lefts) > 1:
        rights = rights * len(lefts)

    n = max(len(lefts), len(rights)) or 1
    pairs = [
        (lefts[i] if i < len(lefts) else "", rights[i] if i < len(rights) else "")
        for i in range(n)
    ]
    if len(pairs) == 1 and not pairs[0][0] and not pairs[0][1]:
        left_blob, right_blob = _split_sides(after)
        return [(left_blob, right_blob)]
    return pairs


def _emit_circuit(
    *,
    book: str,
    filename: str,
    page: int,
    owner: str,
    title: str,
    pin_no: str,
    left: str,
    right: str,
    sub_index: int,
    harness_left: str = "",
    harness_right: str = "",
) -> dict | None:
    left_p = parse_endpoint(left)
    right_p = parse_endpoint(right)
    if not left_p["component_code"] and not right_p["component_code"] and not left_p["token"] and not right_p["token"]:
        # empty / dash row
        if not NODE_PIN_RE.search(f"{left} {right}") and not extract_color(f"{left} {right}"):
            return None

    color = normalize_wire_color(
        left_p["color"] or right_p["color"] or extract_color(f"{left} {right}")
    )
    # Color-only phantom rows (legacy bug from joining color cols with newlines)
    if (
        color
        and not left_p["component_code"]
        and not right_p["component_code"]
        and not left_p["token"]
        and not right_p["token"]
        and not COMPONENT_RE.search(f"{left} {right}")
    ):
        return None

    steering = left_p["steering_side"] or right_p["steering_side"] or detect_steering(f"{left} {right}")

    return {
        "source_kind": "connector_pinout",
        "book": book,
        "filename": filename,
        "page": page,
        "owner_connector": owner,
        "system_name": title or (f"Connector {owner}" if owner else "Connector"),
        "pin_number": str(pin_no),
        "sub_index": sub_index,
        "from_token": left_p["token"],
        "to_token": right_p["token"],
        "from_node": left_p["component_code"] or "",
        "to_node": right_p["component_code"] or "",
        "from_detail": left_p["detail"],
        "to_detail": right_p["detail"],
        "from_label": left_p["clean_label"],
        "to_label": right_p["clean_label"],
        "from_description": left_p["description"],
        "to_description": right_p["description"],
        "wire_color": color,
        "wire_color_ru": wire_color_ru(color) if color else "",
        "steering_side": steering,
        "function_text": left_p["description"] or right_p["description"] or "",
        "harness_left": harness_left or "",
        "harness_right": harness_right or "",
    }


def parse_connector_page_pdf(pdf_path: str, page_num: int, meta: dict) -> list[dict]:
    """Parse one PDF page (1-based) into circuit records."""
    book = meta.get("book", "")
    filename = meta.get("filename", "")
    owner = (meta.get("subject_codes") or [""])[0] if meta.get("subject_codes") else ""
    # Prefer first subject as owner; title from manifest
    title = meta.get("title") or ""
    if meta.get("subject_codes"):
        owner = meta["subject_codes"][0]

    # Seed harness from Stage-1 manifest signals when present
    harness_left, harness_right = "", ""
    signals = meta.get("signals") or {}
    hh = signals.get("harness_headers") or []
    if isinstance(hh, list) and hh:
        cleaned = [_clean_harness_name(str(x)) for x in hh if str(x).strip()]
        if len(cleaned) >= 2:
            harness_left, harness_right = cleaned[0], cleaned[1]
        elif len(cleaned) == 1:
            harness_left = cleaned[0]
    for tbl in meta.get("tables") or []:
        header_row = tbl.get("header_row") or []
        if header_row:
            hl, hr = _parse_harness_headers([_cell(c) for c in header_row])
            if hl or hr:
                harness_left, harness_right = hl or harness_left, hr or harness_right
                break

    circuits: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        if page_num < 1 or page_num > len(pdf.pages):
            return []
        page = pdf.pages[page_num - 1]
        try:
            tables = page.extract_tables() or []
        except Exception:
            tables = []
        try:
            page_text = page.extract_text() or ""
        except Exception:
            page_text = ""

        for table in tables:
            seen_header = False
            for row in table or []:
                if not row:
                    continue
                cells = [_cell(c) for c in row]
                if _is_header_row(cells):
                    seen_header = True
                    hl, hr = _parse_harness_headers(cells)
                    if hl or hr:
                        harness_left, harness_right = hl or harness_left, hr or harness_right
                    continue
                pin = cells[0] if cells else ""
                if not re.fullmatch(r"\d{1,3}", pin):
                    continue
                if not seen_header and not any(NODE_PIN_RE.search(c) for c in cells[1:]):
                    continue

                pairs = _row_side_pairs(cells[1:])

                for sub_i, (left, right) in enumerate(pairs):
                    rec = _emit_circuit(
                        book=book,
                        filename=filename,
                        page=page_num,
                        owner=owner,
                        title=title,
                        pin_no=pin,
                        left=left,
                        right=right,
                        sub_index=sub_i,
                        harness_left=harness_left,
                        harness_right=harness_right,
                    )
                    if rec:
                        circuits.append(rec)

        # Text fallback when tables empty/incomplete
        if not circuits and page_text:
            for line in page_text.splitlines():
                line = line.strip()
                m = re.match(r"^(\d{1,3})\s+(.+)$", line)
                if not m:
                    continue
                pin, rest = m.group(1), m.group(2)
                if not NODE_PIN_RE.search(rest) and not COLOR_RE.search(rest):
                    continue
                left, right = _split_sides([rest])
                rec = _emit_circuit(
                    book=book,
                    filename=filename,
                    page=page_num,
                    owner=owner,
                    title=title,
                    pin_no=pin,
                    left=left,
                    right=right,
                    sub_index=0,
                    harness_left=harness_left,
                    harness_right=harness_right,
                )
                if rec:
                    circuits.append(rec)

    return circuits


def parse_connector_pages(manifest: dict, manuals_dir: str) -> list[dict]:
    """Parse all connector_pinout pages listed in the Stage-1 manifest."""
    path_by_book = {}
    for m in manifest.get("manuals") or []:
        path_by_book[m["book"]] = m.get("path") or os.path.join(manuals_dir, m["filename"])

    out: list[dict] = []
    pages = [p for p in manifest.get("pages") or [] if p.get("page_type") == "connector_pinout"]
    for i, meta in enumerate(pages):
        book = meta["book"]
        pdf_path = path_by_book.get(book)
        if not pdf_path or not os.path.isfile(pdf_path):
            continue
        page_num = int(meta["page"])
        recs = parse_connector_page_pdf(pdf_path, page_num, meta)
        out.extend(recs)
        if (i + 1) % 10 == 0 or i + 1 == len(pages):
            print(f"  connector_parser: {i + 1}/{len(pages)} pages → {len(out)} circuits")
    return out
