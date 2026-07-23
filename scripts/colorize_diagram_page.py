"""
Prototype: recolor wire strokes on one Volvo EWD diagram page.

Approach (Variant A — PyMuPDF):
  1. Read vector drawings via page.get_drawings()
  2. Find text markers RD / BK / GY-OG / …
  3. Associate nearby dark thin stroke segments with each marker
  4. Overlay colored lines (do not rewrite original content stream)
  5. Save a draft single-page PDF for visual QA

Usage:
  python scripts/colorize_diagram_page.py
  python scripts/colorize_diagram_page.py --page 263
  python scripts/colorize_diagram_page.py --page 150 --out tmp/diagram-color-draft.pdf
"""
from __future__ import annotations

import argparse
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "wiring.sqlite"
DEFAULT_MANUAL = Path(r"E:\manual\Электросхемы XC70.pdf")
DEFAULT_OUT = ROOT / "tmp" / "diagram-color-draft.pdf"

# Volvo glossary → RGB 0..1 (approximate EWD palette)
WIRE_RGB: dict[str, tuple[float, float, float]] = {
    "BK": (0.05, 0.05, 0.05),
    "SB": (0.05, 0.05, 0.05),
    "BN": (0.45, 0.25, 0.08),
    "BU": (0.10, 0.35, 0.85),
    "BL": (0.10, 0.35, 0.85),
    "GN": (0.10, 0.65, 0.25),
    "LGN": (0.45, 0.85, 0.35),
    "GY": (0.55, 0.55, 0.55),
    "GR": (0.55, 0.55, 0.55),
    "OG": (0.95, 0.50, 0.05),
    "OR": (0.95, 0.50, 0.05),
    "PK": (0.95, 0.45, 0.70),
    "P": (0.95, 0.45, 0.70),
    "RD": (0.90, 0.10, 0.15),
    "R": (0.90, 0.10, 0.15),
    "VT": (0.55, 0.15, 0.70),
    "VO": (0.55, 0.15, 0.70),
    "WH": (0.92, 0.92, 0.92),
    "W": (0.92, 0.92, 0.92),
    "YE": (0.95, 0.85, 0.10),
    "Y": (0.95, 0.85, 0.10),
}

COLOR_TOKEN_RE = re.compile(
    r"\b(LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|P|R|W|Y)"
    r"(?:-(LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|P|R|W|Y))?\b",
    re.I,
)

# Original wire strokes in this manual are mostly dark gray ~0.22
WIRE_STROKE_DARK = 0.45
WIRE_WIDTH_MAX = 1.2
WIRE_WIDTH_MIN = 0.15
PROXIMITY_PT = 36.0  # ~0.5 inch


def resolve_page(page: int | None) -> tuple[int, str]:
    if page is not None:
        con = sqlite3.connect(DB)
        row = con.execute(
            "SELECT system_name FROM pages WHERE manual_id = 1 AND source_page = ?",
            (page,),
        ).fetchone()
        con.close()
        title = row[0] if row else "(unknown)"
        return page, str(title)

    con = sqlite3.connect(DB)
    row = con.execute(
        """
        SELECT source_page, system_name FROM pages
        WHERE page_type = 'diagram' AND manual_id = 1
          AND source_page BETWEEN 140 AND 280
        ORDER BY
          CASE WHEN lower(system_name) LIKE '%horn%' THEN 0 ELSE 1 END,
          source_page
        LIMIT 1
        """
    ).fetchone()
    con.close()
    if not row:
        return 150, "(fallback)"
    return int(row[0]), str(row[1])


def parse_color_code(text: str) -> str | None:
    m = COLOR_TOKEN_RE.fullmatch((text or "").strip())
    if not m:
        return None
    return m.group(0).upper()


def colors_for_code(code: str) -> list[tuple[float, float, float]]:
    parts = [p for p in code.split("-") if p]
    rgb = [WIRE_RGB[p] for p in parts if p in WIRE_RGB]
    return rgb or [(0.9, 0.1, 0.15)]


def is_wire_stroke(drawing: dict) -> bool:
    if drawing.get("type") not in ("s", "fs"):
        return False
    color = drawing.get("color")
    if not color or len(color) < 3:
        return False
    # Dark / gray strokes (not the pink/red annotations already in the book)
    if max(color) > WIRE_STROKE_DARK and min(color) > 0.5:
        return False
    if color[0] > 0.6 and color[1] < 0.4:  # already reddish highlight
        return False
    width = drawing.get("width")
    if width is None:
        return False
    w = float(width)
    return WIRE_WIDTH_MIN <= w <= WIRE_WIDTH_MAX


def collect_segments(page: fitz.Page) -> list[dict]:
    segs: list[dict] = []
    for d in page.get_drawings():
        if not is_wire_stroke(d):
            continue
        width = float(d.get("width") or 0.4)
        for item in d.get("items") or []:
            if item[0] != "l":
                continue
            p1, p2 = item[1], item[2]
            segs.append(
                {
                    "p1": fitz.Point(p1),
                    "p2": fitz.Point(p2),
                    "mid": fitz.Point((p1.x + p2.x) / 2, (p1.y + p2.y) / 2),
                    "width": width,
                    "len": abs(p1 - p2),
                }
            )
    return segs


def collect_markers(page: fitz.Page) -> list[dict]:
    markers: list[dict] = []
    for w in page.get_text("words"):
        code = parse_color_code(w[4] or "")
        if not code:
            continue
        rect = fitz.Rect(w[0], w[1], w[2], w[3])
        markers.append({"code": code, "rect": rect, "center": rect.tl + (rect.br - rect.tl) * 0.5})
    return markers


def assign_segments(markers: list[dict], segs: list[dict]) -> dict[str, list[dict]]:
    """Greedy: each segment → nearest color marker within PROXIMITY_PT."""
    by_code: dict[str, list[dict]] = defaultdict(list)
    used: set[int] = set()
    # Prefer longer segments first so short ticks/junctions don't steal
    order = sorted(range(len(segs)), key=lambda i: segs[i]["len"], reverse=True)
    for i in order:
        seg = segs[i]
        best_j = -1
        best_d = PROXIMITY_PT
        for j, m in enumerate(markers):
            d = abs(seg["mid"] - m["center"])
            # Also score distance to nearest endpoint (labels sit beside wires)
            d = min(d, abs(seg["p1"] - m["center"]), abs(seg["p2"] - m["center"]))
            if d < best_d:
                best_d = d
                best_j = j
        if best_j < 0:
            continue
        code = markers[best_j]["code"]
        by_code[code].append(seg)
        used.add(i)
    return by_code


def draw_colored_overlay(page: fitz.Page, by_code: dict[str, list[dict]]) -> int:
    drawn = 0
    shape = page.new_shape()
    for code, segs in by_code.items():
        palette = colors_for_code(code)
        for seg in segs:
            if len(palette) == 1:
                shape.draw_line(seg["p1"], seg["p2"])
                shape.finish(
                    color=palette[0],
                    width=max(seg["width"] * 2.2, 1.0),
                    stroke_opacity=0.92,
                    closePath=False,
                )
                drawn += 1
            else:
                # Dual-color: two slightly offset parallel strokes
                dx = seg["p2"].x - seg["p1"].x
                dy = seg["p2"].y - seg["p1"].y
                length = (dx * dx + dy * dy) ** 0.5 or 1.0
                ox, oy = (-dy / length) * 0.7, (dx / length) * 0.7
                for idx, rgb in enumerate(palette[:2]):
                    sign = -1 if idx == 0 else 1
                    a = fitz.Point(seg["p1"].x + sign * ox, seg["p1"].y + sign * oy)
                    b = fitz.Point(seg["p2"].x + sign * ox, seg["p2"].y + sign * oy)
                    shape.draw_line(a, b)
                    shape.finish(
                        color=rgb,
                        width=max(seg["width"] * 1.6, 0.8),
                        stroke_opacity=0.95,
                        closePath=False,
                    )
                    drawn += 1
    shape.commit(overlay=True)
    return drawn


def add_legend(page: fitz.Page, by_code: dict[str, list[dict]]) -> None:
    if not by_code:
        return
    y = 18.0
    x = 12.0
    page.draw_rect(fitz.Rect(8, 8, 220, 14 + 12 * (len(by_code) + 1)), color=(1, 1, 1), fill=(1, 1, 1), width=0)
    page.insert_text(fitz.Point(x, y), "Wire color overlay (draft)", fontsize=8, color=(0.1, 0.1, 0.1))
    y += 12
    for code in sorted(by_code.keys()):
        rgb = colors_for_code(code)[0]
        page.draw_line(fitz.Point(x, y - 2), fitz.Point(x + 18, y - 2), color=rgb, width=2.5)
        page.insert_text(
            fitz.Point(x + 22, y),
            f"{code} ×{len(by_code[code])}",
            fontsize=7,
            color=(0.15, 0.15, 0.15),
        )
        y += 11


def main() -> None:
    ap = argparse.ArgumentParser(description="Colorize one Volvo diagram page (draft)")
    ap.add_argument("--manual", type=Path, default=DEFAULT_MANUAL)
    ap.add_argument("--page", type=int, default=None, help="1-based source page")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--no-legend", action="store_true")
    args = ap.parse_args()

    page_num, title = resolve_page(args.page)
    if not args.manual.exists():
        raise SystemExit(f"Manual not found: {args.manual}")

    src = fitz.open(args.manual)
    page = src[page_num - 1]
    markers = collect_markers(page)
    segs = collect_segments(page)
    by_code = assign_segments(markers, segs)
    drawn = draw_colored_overlay(page, by_code)
    if not args.no_legend:
        add_legend(page, by_code)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out_doc = fitz.open()
    out_doc.insert_pdf(src, from_page=page_num - 1, to_page=page_num - 1)
    out_doc.save(args.out, garbage=3, deflate=True)
    out_doc.close()
    src.close()

    print(f"page={page_num} title={title!r}")
    print(f"markers={len(markers)} wire_segments={len(segs)} colored_codes={len(by_code)} strokes_drawn={drawn}")
    print("codes:", {k: len(v) for k, v in sorted(by_code.items())})
    print(f"saved: {args.out}")


if __name__ == "__main__":
    main()
