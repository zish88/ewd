"""
Stage 2 — Wiring diagram parser (verification tokens + component hits).

Collects component:pin tokens and bare component codes from wiring_diagram
pages for Stage-3 is_verified / component→diagram page index.
Does NOT emit connection/link cards.
"""
from __future__ import annotations

import os
import re

import pdfplumber

from .tokens import COMPONENT_RE, NODE_PIN_RE, normalize_component_code

# Unicode slashes often used in Volvo EWD labels
_SLASH_RE = re.compile(r"[\u2215\u2044／]")
_WORD_CODE_RE = re.compile(r"^(\d{1,3})[A-Z]?[/∕⁄／](\d{2,6})[A-Z0-9]*$", re.I)
_TYPE_ONLY_RE = re.compile(r"^(\d{1,3})[A-Z]?[/∕⁄／]?$", re.I)
_NUM_ONLY_RE = re.compile(r"^[/∕⁄／]?(\d{2,6})[A-Z0-9]*$", re.I)


def _norm_slash(s: str) -> str:
    return _SLASH_RE.sub("/", str(s or ""))


def _codes_from_word_layer(page) -> dict[str, dict]:
    """
    Recover component codes (esp. 73/xxx branching points) from word bboxes
    when labels are split across glyphs or occluded in extract_text().
    Returns UPPER -> {code, x0, y0, x1, y1}.
    """
    out: dict[str, dict] = {}
    try:
        words = page.extract_words(
            keep_blank_chars=False,
            use_text_flow=False,
            extra_attrs=["size"],
        ) or []
    except Exception:
        return out

    cleaned: list[dict] = []
    for w in words:
        t = _norm_slash(str(w.get("text") or "")).strip()
        if not t:
            continue
        cleaned.append(
            {
                "text": t,
                "x0": float(w.get("x0") or 0),
                "x1": float(w.get("x1") or 0),
                "top": float(w.get("top") or 0),
                "bottom": float(w.get("bottom") or 0),
            }
        )

    def add_code(code: str, box: dict) -> None:
        code = normalize_component_code(code)
        if not code:
            return
        key = code.upper()
        prev = out.get(key)
        if prev:
            prev["x0"] = min(prev["x0"], box["x0"])
            prev["y0"] = min(prev["y0"], box["top"])
            prev["x1"] = max(prev["x1"], box["x1"])
            prev["y1"] = max(prev["y1"], box["bottom"])
        else:
            out[key] = {
                "code": code,
                "x0": box["x0"],
                "y0": box["top"],
                "x1": box["x1"],
                "y1": box["bottom"],
            }

    # 1) Whole-word codes
    for w in cleaned:
        m = _WORD_CODE_RE.fullmatch(w["text"])
        if m:
            add_code(f"{m.group(1)}/{m.group(2)}", w)

    # 2) Horizontal stitch: "73" + "/" + "5019" or "73/" + "5019"
    for i, a in enumerate(cleaned):
        joined = a["text"]
        box = dict(a)
        for j in range(i + 1, min(i + 6, len(cleaned))):
            b = cleaned[j]
            if abs(b["top"] - a["top"]) > max(6.0, (a["bottom"] - a["top"]) * 0.8):
                break
            gap = b["x0"] - box["x1"]
            if gap > 14:
                break
            joined += b["text"]
            box["x1"] = max(box["x1"], b["x1"])
            box["bottom"] = max(box["bottom"], b["bottom"])
            m = COMPONENT_RE.search(joined)
            if m:
                add_code(m.group(1), box)

    # 3) Vertical / nearby stitch for branching points 73/xxxx
    #    Labels are often stacked: "73" above "5019" near wire junctions.
    type_words = [w for w in cleaned if _TYPE_ONLY_RE.fullmatch(w["text"])]
    num_words = [w for w in cleaned if _NUM_ONLY_RE.fullmatch(w["text"]) and "/" not in w["text"]]
    for tw in type_words:
        tm = _TYPE_ONLY_RE.fullmatch(tw["text"])
        if not tm:
            continue
        type_n = tm.group(1)
        # Prefer series 73 (branching), but allow other short type digits
        for nw in num_words:
            nm = _NUM_ONLY_RE.fullmatch(nw["text"])
            if not nm:
                continue
            num = nm.group(1)
            dx = abs((tw["x0"] + tw["x1"]) / 2 - (nw["x0"] + nw["x1"]) / 2)
            dy = nw["top"] - tw["bottom"]
            # stacked below or nearly adjacent
            if dx <= 28 and -4 <= dy <= 22:
                add_code(f"{type_n}/{num}", {
                    "x0": min(tw["x0"], nw["x0"]),
                    "x1": max(tw["x1"], nw["x1"]),
                    "top": min(tw["top"], nw["top"]),
                    "bottom": max(tw["bottom"], nw["bottom"]),
                })
            # same line: "73" then "5019"
            elif abs(tw["top"] - nw["top"]) <= 5 and 0 <= (nw["x0"] - tw["x1"]) <= 18:
                add_code(f"{type_n}/{num}", {
                    "x0": min(tw["x0"], nw["x0"]),
                    "x1": max(tw["x1"], nw["x1"]),
                    "top": min(tw["top"], nw["top"]),
                    "bottom": max(tw["bottom"], nw["bottom"]),
                })

    return out


def parse_diagram_page_pdf(pdf_path: str, page_num: int, meta: dict) -> list[dict]:
    book = meta.get("book", "")
    filename = meta.get("filename", "")
    title = meta.get("title") or "Wiring diagram"

    records: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        if page_num < 1 or page_num > len(pdf.pages):
            return []
        page = pdf.pages[page_num - 1]
        try:
            text = _norm_slash(page.extract_text() or "")
        except Exception:
            text = ""

        seen_tokens: set[str] = set()
        component_codes: dict[str, str] = {}  # UPPER -> display code
        word_hits = _codes_from_word_layer(page)

        for m in NODE_PIN_RE.finditer(text):
            token = m.group(0)
            key = token.upper()
            if key in seen_tokens:
                continue
            seen_tokens.add(key)
            code = normalize_component_code(m.group(1))
            records.append(
                {
                    "source_kind": "wiring_diagram",
                    "record_kind": "pin_token",
                    "book": book,
                    "filename": filename,
                    "page": page_num,
                    "system_name": title,
                    "token": token,
                    "component_code": code,
                    "pin_suffix": m.group(2),
                }
            )
            if code:
                component_codes.setdefault(code.upper(), code)

        for m in COMPONENT_RE.finditer(text):
            code = normalize_component_code(m.group(1))
            if code:
                component_codes.setdefault(code.upper(), code)

        # Word-layer recovery (critical for 73/xxx near dense wiring graphics)
        for key, hit in word_hits.items():
            component_codes.setdefault(key, hit["code"])

        for code in component_codes.values():
            key = code.upper()
            hit = word_hits.get(key)
            rec: dict = {
                "source_kind": "wiring_diagram",
                "record_kind": "component_hit",
                "book": book,
                "filename": filename,
                "page": page_num,
                "system_name": title,
                "token": code,
                "component_code": code,
                "pin_suffix": "",
            }
            if hit:
                rec["bbox"] = {
                    "x0": round(hit["x0"], 2),
                    "y0": round(hit["y0"], 2),
                    "x1": round(hit["x1"], 2),
                    "y1": round(hit["y1"], 2),
                }
            records.append(rec)

    return records


def parse_diagram_pages(manifest: dict, manuals_dir: str) -> list[dict]:
    path_by_book = {}
    for m in manifest.get("manuals") or []:
        path_by_book[m["book"]] = m.get("path") or os.path.join(manuals_dir, m["filename"])

    out: list[dict] = []
    pages = [p for p in manifest.get("pages") or [] if p.get("page_type") == "wiring_diagram"]
    for i, meta in enumerate(pages):
        book = meta["book"]
        pdf_path = path_by_book.get(book)
        if not pdf_path or not os.path.isfile(pdf_path):
            continue
        recs = parse_diagram_page_pdf(pdf_path, int(meta["page"]), meta)
        out.extend(recs)
        if (i + 1) % 50 == 0 or i + 1 == len(pages):
            print(f"  diagram_parser: {i + 1}/{len(pages)} pages → {len(out)} records")
    return out
