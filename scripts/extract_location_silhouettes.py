"""Extract clean silhouettes from Capital TwoDviews SVGs (gray body strokes)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

SRC_DIR = Path(
    r"C:\Users\eni19\AppData\Local\Temp\Rar$EXa6948.42711.rartemp"
    r"\All\39363002\1\2\Resources\TwoDviews"
)
OUT_DIR = Path(__file__).resolve().parents[1] / "client" / "public" / "bg"

# Full-car family + smaller Location detail views for atmosphere.
JOBS = [
    ("15K867_V70-XC70-S80.svg", "bg-v70-xc70-s80-a.svg"),
    ("15K868_V70-XC70.svg", "bg-v70-xc70-b.svg"),
    ("15K868_S80.svg", "bg-s80.svg"),
    ("15K867_S60-V60.svg", "bg-s60-v60.svg"),
    ("15K867_XC60.svg", "bg-xc60-a.svg"),
    ("15K868_XC60.svg", "bg-xc60-b.svg"),
    ("15K868_S60-V60.svg", "bg-s60-v60-b.svg"),
    # Detail / component location views
    ("16-3_V70.svg", "bg-detail-speaker.svg"),
    ("6-28.svg", "bg-detail-fan.svg"),
    ("19A397_V70-XC70.svg", "bg-detail-module.svg"),
    ("7-56_V70.svg", "bg-detail-door.svg"),
    ("10-72_V70-S80.svg", "bg-detail-lamp.svg"),
    ("14335_V70-XC70-S80-S80L LHD.svg", "bg-detail-dash.svg"),
    ("17N400_V70-XC70.svg", "bg-detail-switch.svg"),
    ("14K138_V70-XC70-S80 RHD.svg", "bg-detail-connector.svg"),
    ("4-33_V70-XC60.svg", "bg-detail-ecu.svg"),
    ("9-2_V70.svg", "bg-detail-sensor.svg"),
]

BODY_STROKES = ("#939598", "#b2b2b2", "#b3b3b3", "#a6a9a9")
ELEMENT_RE = re.compile(
    r"<(?:path|line|polyline|polygon|circle|ellipse|rect)\b[^>]*?/?>",
    re.I | re.S,
)
SKIP_STROKE_RE = re.compile(
    r'stroke="#(?:000000|ffffff|d31145|e9282a|ea2627|231f20|010101)"',
    re.I,
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
    low = el.lower()
    if SKIP_STROKE_RE.search(el):
        return False
    if not any(s in low for s in BODY_STROKES):
        return False
    if re.search(r'x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="\1"[^>]*y2="\2"', el):
        return False
    return True


def restyle(el: str) -> str:
    el = re.sub(r'stroke="#[0-9A-Fa-f]{3,8}"', 'stroke="#FFFFFF"', el)
    el = re.sub(r'stroke-width="[^"]*"', 'stroke-width="0.85"', el, flags=re.I)
    if "stroke-width=" not in el:
        el = re.sub(r"^<(path|line|polyline|polygon)\b", r'<\1 stroke-width="0.85"', el, count=1)
    return el


def extract_one(src: Path, dest: Path) -> int:
    text = src.read_text(encoding="utf-8", errors="replace")
    width, height, view_box = extract_viewbox(text)
    kept = [restyle(el) for el in ELEMENT_RE.findall(text) if keep_element(el)]
    if len(kept) < 8:
        raise SystemExit(f"Too few body elements in {src.name}: {len(kept)}")
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
