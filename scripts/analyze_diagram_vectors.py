"""Inspect vector drawings + color text markers on a Volvo EWD diagram page."""
from __future__ import annotations

import re
import sqlite3
from collections import Counter
from pathlib import Path

import fitz

MANUAL = Path(r"E:\manual\Электросхемы XC70.pdf")
DB = Path(__file__).resolve().parents[1] / "data" / "wiring.sqlite"
COLOR_RE = re.compile(r"^[A-Z]{1,3}(?:-[A-Z]{1,3})?$")


def pick_page() -> tuple[int, str]:
    con = sqlite3.connect(DB)
    row = con.execute(
        """
        SELECT source_page, system_name FROM pages
        WHERE page_type = 'diagram' AND manual_id = 1
          AND (system_name LIKE '%Horn%' OR system_name LIKE '%гуд%')
        ORDER BY source_page LIMIT 1
        """
    ).fetchone()
    if not row:
        row = con.execute(
            """
            SELECT source_page, system_name FROM pages
            WHERE page_type = 'diagram' AND manual_id = 1
            ORDER BY source_page LIMIT 1 OFFSET 100
            """
        ).fetchone()
    con.close()
    return int(row[0]), str(row[1])


def main() -> None:
    page_num, title = pick_page()
    doc = fitz.open(MANUAL)
    page = doc[page_num - 1]
    print(f"file={MANUAL.name} page={page_num} title={title!r}")
    print(f"mediabox={page.rect} rotation={page.rotation}")

    paths = page.get_drawings()
    print(f"drawings={len(paths)}")

    kinds: Counter = Counter()
    stroke_colors: Counter = Counter()
    fills: Counter = Counter()
    widths: Counter = Counter()
    line_items = 0
    curve_items = 0
    for d in paths:
        kinds[d.get("type") or "?"] += 1
        c = d.get("color")
        stroke_colors[tuple(round(x, 3) for x in c) if c else None] += 1
        f = d.get("fill")
        fills[tuple(round(x, 3) for x in f) if f else None] += 1
        w = d.get("width")
        if w is not None:
            widths[round(float(w), 3)] += 1
        for item in d.get("items") or []:
            if item[0] == "l":
                line_items += 1
            elif item[0] in ("c", "qu"):
                curve_items += 1

    print("drawing types:", kinds.most_common())
    print("stroke colors:", stroke_colors.most_common(12))
    print("fills:", fills.most_common(8))
    print("widths:", widths.most_common(12))
    print(f"line_items={line_items} curve_items={curve_items}")

    words = page.get_text("words")
    color_words = [w for w in words if COLOR_RE.fullmatch((w[4] or "").upper())]
    # Filter out very short / likely pin noise later; show codes we care about
    interesting = [
        w
        for w in color_words
        if (w[4] or "").upper()
        in {
            "RD",
            "BK",
            "SB",
            "BN",
            "BU",
            "BL",
            "GN",
            "GY",
            "GR",
            "OG",
            "OR",
            "PK",
            "VT",
            "WH",
            "YE",
            "LGN",
        }
        or "-" in (w[4] or "")
    ]
    print(f"color-like words={len(color_words)} interesting={len(interesting)}")
    print("sample colors:", [(w[4], round(w[0], 1), round(w[1], 1)) for w in interesting[:25]])

    # Proximity: for first few color markers, find nearby stroke segments
    for w in interesting[:5]:
        code = (w[4] or "").upper()
        wx, wy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        near = []
        for d in paths:
            color = d.get("color")
            width = d.get("width")
            for item in d.get("items") or []:
                if item[0] != "l":
                    continue
                p1, p2 = item[1], item[2]
                mx, my = (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
                dist = ((mx - wx) ** 2 + (my - wy) ** 2) ** 0.5
                if dist < 50:
                    near.append(
                        (
                            round(dist, 1),
                            None if not color else tuple(round(x, 3) for x in color),
                            None if width is None else round(float(width), 3),
                            (round(p1.x, 1), round(p1.y, 1), round(p2.x, 1), round(p2.y, 1)),
                        )
                    )
        near.sort(key=lambda x: x[0])
        print(f"near '{code}' @({wx:.0f},{wy:.0f}): {near[:6]}")

    # Also dump raw content stream type hint
    xref = page.get_contents()
    print("content xrefs:", xref)
    doc.close()


if __name__ == "__main__":
    main()
