"""Write POSID callout boxes next to each plate CGM/SVG (0–1 of the image)."""
from __future__ import annotations

import base64
import io
import json
import re
import sys
from pathlib import Path

from cgm import extract_hotspots
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GDIR = ROOT / "data" / "parts-graphics"
POS = re.compile(r"POSID_([0-9A-Z]+)", re.I)
VB = re.compile(r'viewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"', re.I)
PNG_HREF = re.compile(r'href="data:image/png;base64,([^"]+)"', re.I)


def viewbox(svg: Path) -> tuple[float, float] | None:
    if not svg.is_file():
        return None
    head = svg.read_text(encoding="utf-8", errors="replace")[:800]
    m = VB.search(head)
    if not m:
        return None
    return float(m.group(3)), float(m.group(4))


def plate_gray(svg: Path) -> Image.Image | None:
    if not svg.is_file():
        return None
    raw = svg.read_text(encoding="utf-8", errors="replace")
    m = PNG_HREF.search(raw)
    if not m:
        return None
    try:
        blob = base64.b64decode(m.group(1), validate=False)
        im = Image.open(io.BytesIO(blob)).convert("L")
    except Exception:
        return None
    im.thumbnail((480, 700))
    return im


def darkness(im: Image.Image, nx: float, ny: float) -> int:
    w, h = im.size
    x = min(w - 1, max(0, int(nx * w)))
    y = min(h - 1, max(0, int(ny * h)))
    acc = 0
    n = 0
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            xx, yy = x + dx, y + dy
            if 0 <= xx < w and 0 <= yy < h:
                acc += int(im.getpixel((xx, yy)))
                n += 1
    if n == 0:
        return 0
    return 255 - acc // n


def pos_id(tag: str | None, name: str | None) -> str | None:
    for raw in (tag, name):
        if not raw:
            continue
        m = POS.search(str(raw))
        if m:
            return m.group(1)
    digits = re.sub(r"\D+", "", (name or "").replace("\x00", ""))
    return digits or None


def extract_one(cgm: Path) -> Path | None:
    svg = cgm.with_suffix(".svg")
    out = cgm.with_suffix(".hotspots.json")
    size = viewbox(svg)
    hs = extract_hotspots(cgm)
    if not hs:
        return None
    width, height = size if size else (0.0, 0.0)
    if width <= 1 or height <= 1:
        width = max((h.x_max for h in hs), default=0) + 8
        height = max((h.y_max for h in hs), default=0) + 8
    if width <= 1 or height <= 1:
        return None

    raw_boxes: dict[str, tuple[float, float, float, float]] = {}
    areas: dict[str, float] = {}
    for h in hs:
        pid = pos_id(h.source_tag, h.name)
        if not pid:
            continue
        x0, x1 = sorted((float(h.x_min), float(h.x_max)))
        y0, y1 = sorted((float(h.y_min), float(h.y_max)))
        w = (x1 - x0) / width
        hh = (y1 - y0) / height
        if w <= 0 or hh <= 0:
            continue
        area = w * hh
        prev = areas.get(pid)
        if prev is not None and prev <= area:
            continue
        areas[pid] = area
        raw_boxes[pid] = (x0 / width, y0 / height, w, hh)

    if not raw_boxes:
        return None

    def make(flip: bool) -> dict[str, dict[str, float]]:
        out_map: dict[str, dict[str, float]] = {}
        for pid, (x, y, w, hh) in raw_boxes.items():
            yy = (1.0 - y - hh) if flip else y
            out_map[pid] = {"x": x, "y": yy, "w": w, "h": hh}
        return out_map

    flipped = make(True)
    unflipped = make(False)
    gray = plate_gray(svg)
    use_flip = True
    if gray is not None:
        s_flip = sum(darkness(gray, b["x"] + b["w"] / 2, b["y"] + b["h"] / 2) for b in flipped.values())
        s_raw = sum(darkness(gray, b["x"] + b["w"] / 2, b["y"] + b["h"] / 2) for b in unflipped.values())
        use_flip = s_flip >= s_raw

    callouts = flipped if use_flip else unflipped
    payload = {
        "width": width,
        "height": height,
        "flip": use_flip,
        "callouts": callouts,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> int:
    files = sorted(GDIR.glob("*.cgm"))
    only = sys.argv[1:]
    if only:
        files = [GDIR / f"{Path(s).stem}.cgm" for s in only]
    n = 0
    flips = 0
    for i, cgm in enumerate(files):
        if not cgm.is_file():
            continue
        try:
            written = extract_one(cgm)
            if written:
                n += 1
                if json.loads(written.read_text(encoding="utf-8")).get("flip"):
                    flips += 1
        except Exception as e:
            print("fail", cgm.name, e)
        if files and (i + 1) % 200 == 0:
            print(f"  … {i + 1}/{len(files)}")
    print("wrote", n, "of", len(files), "flip", flips, "noflip", n - flips)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
