"""Extract clean car-body silhouettes from Capital TwoDviews SVGs (#939598 strokes)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Literal path — do not interpolate via PowerShell ($…).
SRC_DIR = Path(
    r"C:\Users\eni19\AppData\Local\Temp\Rar$EXa6948.42711.rartemp"
    r"\All\39363002\1\2\Resources\TwoDviews"
)
OUT_DIR = Path(__file__).resolve().parents[1] / "client" / "public" / "bg"

# Same family as maintenance 15K867_V70-XC70-S80 + companion angles / body styles.
JOBS = [
    ("15K867_V70-XC70-S80.svg", "bg-v70-xc70-s80-a.svg"),
    ("15K868_V70-XC70.svg", "bg-v70-xc70-b.svg"),
    ("15K868_S80.svg", "bg-s80.svg"),
    ("15K867_S60-V60.svg", "bg-s60-v60.svg"),
    ("15K867_XC60.svg", "bg-xc60-a.svg"),
    ("15K868_XC60.svg", "bg-xc60-b.svg"),
    ("15K868_S60-V60.svg", "bg-s60-v60-b.svg"),
]

GRAY = "#939598"
ELEMENT_RE = re.compile(
    r"<(?:path|line|polyline|polygon|circle|ellipse|rect)\b[^>]*?/?>",
    re.I | re.S,
)


def extract_viewbox(svg: str) -> tuple[str, str, str]:
    m = re.search(
        r'<svg\b[^>]*?\bwidth="([^"]+)"[^>]*?\bheight="([^"]+)"[^>]*?\bviewBox="([^"]+)"',
        svg,
        re.I | re.S,
    )
    if m:
        return m.group(1), m.group(2), m.group(3)
    vb = re.search(r'\bviewBox="([^"]+)"', svg, re.I)
    return "500px", "360px", vb.group(1) if vb else "0 0 500 360"


def keep_element(el: str) -> bool:
    if GRAY.lower() not in el.lower():
        return False
    # Drop tiny zero-length lines
    if re.search(r'x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="\1"[^>]*y2="\2"', el):
        return False
    return True


def restyle(el: str) -> str:
    el = re.sub(r'stroke="#939598"', 'stroke="#FFFFFF"', el, flags=re.I)
    el = re.sub(r'stroke-width="[^"]*"', 'stroke-width="0.85"', el, flags=re.I)
    if "stroke-width=" not in el:
        el = el.replace("<path ", '<path stroke-width="0.85" ', 1)
        el = el.replace("<line ", '<line stroke-width="0.85" ', 1)
    return el


def extract_one(src: Path, dest: Path) -> int:
    text = src.read_text(encoding="utf-8", errors="replace")
    width, height, view_box = extract_viewbox(text)
    kept = [restyle(el) for el in ELEMENT_RE.findall(text) if keep_element(el)]
    if not kept:
        raise SystemExit(f"No gray body elements in {src.name}")
    out = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        f'<svg version="1.1" xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" viewBox="{view_box}" '
        f'xml:space="preserve">\n'
        "\t<g>\n"
        + "\n".join(f"\t\t{el}" for el in kept)
        + "\n\t</g>\n</svg>\n"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out, encoding="utf-8", newline="\n")
    return len(kept)


def main() -> int:
    if not SRC_DIR.is_dir():
        print(f"ERROR: missing source dir {SRC_DIR}", file=sys.stderr)
        return 1
    for src_name, dest_name in JOBS:
        src = SRC_DIR / src_name
        if not src.is_file():
            print(f"ERROR: missing {src}", file=sys.stderr)
            return 1
        n = extract_one(src, OUT_DIR / dest_name)
        print(f"Wrote {dest_name} ({n} elements) from {src_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
