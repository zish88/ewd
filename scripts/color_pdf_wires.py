"""
Color near-black wire vectors via a safe SVG round-trip (no MuPDF shape overlay).

Pipeline:
  1. page.get_svg_image()  → valid SVG XML
  2. Cluster <use data-text="…"> glyphs into color markers (YE, BU-WH, …)
  3. Expand marker bbox ±35; recolor intersecting strict-black <path> strokes
  4. svglib + reportlab → clean single-page PDF

Default: page 97 of E:\\manual\\Электросхемы XC70.pdf
  → data/test_colored_traced.svg + data/test_colored_traced.pdf

Usage:
  python scripts/color_pdf_wires.py
  python scripts/color_pdf_wires.py --page 97
"""
from __future__ import annotations

import argparse
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict, deque
from pathlib import Path

import fitz
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANUAL = Path(r"E:\manual\Электросхемы XC70.pdf")
DEFAULT_SVG = ROOT / "data" / "test_colored_traced.svg"
DEFAULT_OUT = ROOT / "data" / "test_colored_traced.pdf"
DEFAULT_PAGE = 97

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)
ET.register_namespace("inkscape", "http://www.inkscape.org/namespaces/inkscape")

EXPAND_PT = 35.0
DASH_EXTRA = 15.0
JOIN_TOL = 2.5
JOIN_TOL_DASH = 15.0
DASH_LEN_MAX = 4.0
PIN_R_MAX = 5.0
ANGLE_CONTINUE_DEG = 40.0
OTHER_MARKER_STOP_PAD = 10.0

# Strict Volvo EWD engineering palette (exact HEX)
WIRE_HEX: dict[str, str] = {
    "BK": "#000000",
    "SB": "#000000",
    "BN": "#8B4513",
    "BU": "#1E90FF",
    "BL": "#1E90FF",
    "GN": "#228B22",
    "GY": "#808080",
    "GR": "#808080",
    "LGN": "#32CD32",
    "OG": "#FF8C00",
    "OR": "#FF8C00",
    "PK": "#FFC0CB",
    "P": "#FFC0CB",
    "RD": "#FF0000",
    "R": "#FF0000",
    "VT": "#8A2BE2",
    "VO": "#8A2BE2",
    "WH": "#DCDCDC",
    "W": "#DCDCDC",
    "YE": "#FFD700",
    "Y": "#FFD700",
}

# Dual parts may include 1-letter aliases; standalone markers must be 2+ letter codes
# (avoids false hits on single glyph "Y"/"R"/"W" from other words)
_COLOR_PART = "LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|P|R|W|Y"
_COLOR_STANDALONE = "LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE"
COLOR_TOKEN_RE = re.compile(
    rf"^(?:({_COLOR_STANDALONE})|({_COLOR_PART})-({_COLOR_PART}))$",
    re.I,
)

MATRIX_RE = re.compile(
    r"matrix\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*"
    r"([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)"
)
def q(tag: str) -> str:
    return f"{{{SVG_NS}}}{tag}"


def parse_color_code(text: str) -> str | None:
    raw = (text or "").strip().upper().replace("–", "-").replace("—", "-")
    m = COLOR_TOKEN_RE.fullmatch(raw)
    if not m:
        return None
    if m.group(1):
        a = m.group(1).upper()
        return a if a in WIRE_HEX else None
    a, b = m.group(2).upper(), m.group(3).upper()
    if a not in WIRE_HEX or b not in WIRE_HEX:
        return None
    return f"{a}-{b}"


def split_marker_colors(code: str) -> tuple[str, str | None]:
    """Split dual marker strictly on '-': first = solid primary, second = dash only."""
    parts = [p for p in str(code).upper().split("-") if p]
    if not parts:
        raise ValueError(f"empty color code: {code!r}")
    primary = WIRE_HEX[parts[0]]
    secondary = WIRE_HEX[parts[1]] if len(parts) > 1 and parts[1] in WIRE_HEX else None
    return primary, secondary


def primary_hex(code: str) -> str:
    return split_marker_colors(code)[0]


def secondary_hex(code: str) -> str | None:
    return split_marker_colors(code)[1]


def bbox_center(bb: tuple[float, float, float, float]) -> tuple[float, float]:
    return ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)


def dist2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def point_to_segment_dist(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    lab2 = vx * vx + vy * vy
    if lab2 < 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / lab2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def marker_to_path_distance(marker: dict, path: dict) -> float:
    """Min distance from marker center to path polyline / bbox."""
    mc = bbox_center(marker["bbox"])
    pts = path.get("pts") or []
    if len(pts) >= 2:
        best = 1e18
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            best = min(best, point_to_segment_dist(mc[0], mc[1], a[0], a[1], b[0], b[1]))
        return best
    pc = bbox_center(path["bbox"])
    return math.sqrt(dist2(mc, pc))


def parse_matrix(transform: str | None) -> tuple[float, float, float, float, float, float]:
    if not transform:
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    m = MATRIX_RE.search(transform)
    if not m:
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    return tuple(float(x) for x in m.groups())  # type: ignore[return-value]


def apply_matrix(mat, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = mat
    return (a * x + c * y + e, b * x + d * y + f)


def parse_rgb_stroke(stroke: str | None) -> tuple[float, float, float] | None:
    if not stroke:
        return None
    s = stroke.strip().lower()
    if s in ("none", "transparent"):
        return None
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if len(h) != 6:
            return None
        return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)
    m = re.match(r"rgb\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)", s)
    if m:
        vals = [float(m.group(i)) for i in (1, 2, 3)]
        if "%" in s:
            return tuple(v / 100.0 for v in vals)  # type: ignore[return-value]
        if max(vals) > 1.0:
            return tuple(v / 255.0 for v in vals)  # type: ignore[return-value]
        return tuple(vals)  # type: ignore[return-value]
    return None


def is_strict_black(rgb: tuple[float, float, float] | None) -> bool:
    if rgb is None:
        return False
    r, g, b = rgb
    if max(r, g, b) - min(r, g, b) > 0.08:
        return False
    return max(r, g, b) <= 0.35


def path_points(d: str | None) -> list[tuple[float, float]]:
    if not d:
        return []
    pts: list[tuple[float, float]] = []
    tokens = re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", d)
    i = 0
    cx = cy = 0.0
    cmd = "M"
    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                continue
        try:
            if cmd in "MmLl":
                x, y = float(tokens[i]), float(tokens[i + 1])
                i += 2
                if cmd == "m":
                    x += cx
                    y += cy
                elif cmd == "l":
                    x += cx
                    y += cy
                cx, cy = x, y
                pts.append((cx, cy))
                cmd = "L" if cmd in "Mm" else cmd
            elif cmd in "Hh":
                x = float(tokens[i])
                i += 1
                cx = x if cmd == "H" else cx + x
                pts.append((cx, cy))
            elif cmd in "Vv":
                y = float(tokens[i])
                i += 1
                cy = y if cmd == "V" else cy + y
                pts.append((cx, cy))
            elif cmd in "Cc":
                nums = [float(tokens[i + k]) for k in range(6)]
                i += 6
                if cmd == "c":
                    nums = [
                        nums[0] + cx,
                        nums[1] + cy,
                        nums[2] + cx,
                        nums[3] + cy,
                        nums[4] + cx,
                        nums[5] + cy,
                    ]
                cx, cy = nums[4], nums[5]
                pts.append((cx, cy))
            elif cmd in "SsQqTt":
                # consume pairs until next command
                n = 4 if cmd in "SsQq" else 2
                nums = [float(tokens[i + k]) for k in range(n)]
                i += n
                if cmd.islower():
                    for k in range(0, n, 2):
                        nums[k] += cx
                        nums[k + 1] += cy
                cx, cy = nums[-2], nums[-1]
                pts.append((cx, cy))
            elif cmd in "Aa":
                nums = [float(tokens[i + k]) for k in range(7)]
                i += 7
                x, y = nums[5], nums[6]
                if cmd == "a":
                    x += cx
                    y += cy
                cx, cy = x, y
                pts.append((cx, cy))
            else:
                i += 1
        except (IndexError, ValueError):
            break
    return pts


def bbox_from_points(pts: list[tuple[float, float]]) -> tuple[float, float, float, float] | None:
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def expand_bbox(bb: tuple[float, float, float, float], pad: float) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = bb
    return (x0 - pad, y0 - pad, x1 + pad, y1 + pad)


def bboxes_intersect(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def cluster_glyphs(root: ET.Element) -> list[dict]:
    """Group consecutive <use data-text> glyphs into color-marker candidates."""
    glyphs: list[dict] = []
    for el in root.iter(q("use")):
        ch = el.attrib.get("data-text")
        if ch is None:
            continue
        mat = parse_matrix(el.attrib.get("transform"))
        # Glyph origin in page space; approx extent from |scale|
        scale = max(abs(mat[0]), abs(mat[3]), 4.0)
        x, y = apply_matrix(mat, 0.0, 0.0)
        glyphs.append(
            {
                "el": el,
                "ch": ch,
                "x": x,
                "y": y,
                "size": scale,
            }
        )
    if not glyphs:
        return []

    # Sort reading-ish order
    glyphs.sort(key=lambda g: (round(g["y"], 1), g["x"]))

    clusters: list[list[dict]] = []
    cur: list[dict] = [glyphs[0]]
    for g in glyphs[1:]:
        prev = cur[-1]
        same_line = abs(g["y"] - prev["y"]) <= max(prev["size"], g["size"]) * 0.65
        gap = g["x"] - prev["x"]
        # Color codes are tight (YE, BU-WH); allow slightly larger gaps for '-'
        close = gap <= max(prev["size"], g["size"]) * 1.8
        if same_line and close and gap >= -3:
            cur.append(g)
        else:
            clusters.append(cur)
            cur = [g]
    clusters.append(cur)

    # Merge adjacent same-line clusters when concatenation forms a color token (Y+E → YE)
    merged: list[list[dict]] = []
    i = 0
    while i < len(clusters):
        cl = clusters[i]
        text = "".join(g["ch"] for g in cl).strip()
        if i + 1 < len(clusters):
            nxt = clusters[i + 1]
            combo = text + "".join(g["ch"] for g in nxt).strip()
            y0 = sum(g["y"] for g in cl) / len(cl)
            y1 = sum(g["y"] for g in nxt) / len(nxt)
            x_gap = nxt[0]["x"] - cl[-1]["x"]
            size = max(g["size"] for g in cl + nxt)
            if abs(y0 - y1) <= size * 0.65 and 0 <= x_gap <= size * 2.2 and parse_color_code(combo):
                merged.append(cl + nxt)
                i += 2
                continue
            # three-part: BU + - + WH
            if i + 2 < len(clusters):
                nxt2 = clusters[i + 2]
                combo3 = combo + "".join(g["ch"] for g in nxt2).strip()
                y2 = sum(g["y"] for g in nxt2) / len(nxt2)
                x_gap2 = nxt2[0]["x"] - nxt[-1]["x"]
                if (
                    abs(y0 - y1) <= size * 0.65
                    and abs(y1 - y2) <= size * 0.65
                    and 0 <= x_gap <= size * 2.2
                    and 0 <= x_gap2 <= size * 2.2
                    and parse_color_code(combo3)
                ):
                    merged.append(cl + nxt + nxt2)
                    i += 3
                    continue
        merged.append(cl)
        i += 1

    markers: list[dict] = []
    for cl in merged:
        text = "".join(g["ch"] for g in cl).strip()
        code = parse_color_code(text)
        if not code:
            continue
        xs = [g["x"] for g in cl]
        ys = [g["y"] for g in cl]
        size = max(g["size"] for g in cl)
        bb = (min(xs) - size * 0.1, min(ys) - size * 0.85, max(xs) + size * 0.75, max(ys) + size * 0.25)
        markers.append({"code": code, "text": text, "bbox": bb, "glyphs": cl})
    return markers


def path_length(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 2:
        return 0.0
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


def is_circular_pin_path(pts: list[tuple[float, float]], bb: tuple[float, float, float, float]) -> bool:
    """Detect small pin-dot paths (near-square bbox, small size)."""
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    if w <= 0 or h <= 0:
        return False
    if max(w, h) > PIN_R_MAX * 2.2 or min(w, h) < 0.3:
        return False
    if abs(w - h) / max(w, h) > 0.35:
        return False
    # Closed-ish or arc-like: many points relative to size, or short closed loop
    if len(pts) >= 4:
        return True
    plen = path_length(pts)
    return plen <= (w + h) * 2.5 and plen > 0


def collect_insulators(root: ET.Element) -> list[dict]:
    """Pin circles and circular pin-dot paths — BFS dead-ends."""
    ins: list[dict] = []
    for el in root.iter(q("circle")):
        try:
            cx = float(el.attrib.get("cx", "0"))
            cy = float(el.attrib.get("cy", "0"))
            r = float(el.attrib.get("r", "0"))
        except ValueError:
            continue
        mat = parse_matrix(el.attrib.get("transform"))
        # Approximate scale from matrix for radius
        scale = max(abs(mat[0]), abs(mat[3]), 1.0)
        px, py = apply_matrix(mat, cx, cy)
        pr = abs(r * scale)
        if 0 < pr < PIN_R_MAX:
            ins.append({"cx": px, "cy": py, "r": pr, "el": el})
    for el in root.iter(q("path")):
        pid = el.attrib.get("id") or ""
        if pid.startswith("font_"):
            continue
        mat = parse_matrix(el.attrib.get("transform"))
        pts = [apply_matrix(mat, x, y) for x, y in path_points(el.attrib.get("d"))]
        bb = bbox_from_points(pts)
        if bb is None or not is_circular_pin_path(pts, bb):
            continue
        cx, cy = bbox_center(bb)
        r = max(bb[2] - bb[0], bb[3] - bb[1]) / 2
        if r < PIN_R_MAX:
            ins.append({"cx": cx, "cy": cy, "r": r, "el": el})
    return ins


def point_hits_insulator(x: float, y: float, insulators: list[dict], pad: float = 0.8) -> bool:
    for inn in insulators:
        if math.hypot(x - inn["cx"], y - inn["cy"]) <= inn["r"] + pad:
            return True
    return False


def split_d_subpaths(d: str | None) -> list[str]:
    """Split SVG path `d` into subpath strings starting at each M/m."""
    if not d or not d.strip():
        return []
    parts = re.split(r"(?=[Mm])", d.strip())
    return [p for p in parts if p and re.match(r"[Mm]", p.strip())]


def explode_multipart_paths(root: ET.Element) -> int:
    """
    Replace multi-subpath wire <path> elements with one <path> per subpath
    so BFS can join endpoints correctly without painting unrelated jumps.
    """
    parents = build_parent_map(root)
    exploded = 0
    # snapshot list — tree mutates
    candidates = [el for el in root.iter(q("path"))]
    for el in candidates:
        pid = el.attrib.get("id") or ""
        if pid.startswith("font_"):
            continue
        stroke = el.attrib.get("stroke")
        if not is_strict_black(parse_rgb_stroke(stroke)):
            continue
        subs = split_d_subpaths(el.attrib.get("d"))
        if len(subs) <= 1:
            continue
        parent = parents.get(el)
        if parent is None:
            continue
        kids = list(parent)
        try:
            idx = kids.index(el)
        except ValueError:
            continue
        parent.remove(el)
        for k, sub_d in enumerate(subs):
            neo = ET.Element(q("path"), dict(el.attrib))
            neo.set("d", sub_d)
            if "id" in neo.attrib:
                neo.set("id", f"{neo.attrib['id']}_s{k}")
            parent.insert(idx + k, neo)
            exploded += 1
    return exploded


def collect_black_paths(root: ET.Element, insulator_els: set) -> tuple[list[dict], int]:
    """Wire strokes only — skip non-black and pin-dot geometries."""
    paths: list[dict] = []
    ignored = 0
    for el in root.iter(q("path")):
        pid = el.attrib.get("id") or ""
        if pid.startswith("font_"):
            continue
        if el in insulator_els:
            continue
        stroke = el.attrib.get("stroke")
        if stroke is None:
            continue
        rgb = parse_rgb_stroke(stroke)
        if not is_strict_black(rgb):
            ignored += 1
            continue
        mat = parse_matrix(el.attrib.get("transform"))
        page_pts = [apply_matrix(mat, x, y) for x, y in path_points(el.attrib.get("d"))]
        bb = bbox_from_points(page_pts)
        if bb is None or len(page_pts) < 2:
            continue
        if is_circular_pin_path(page_pts, bb):
            continue
        plen = path_length(page_pts)
        dashed = bool(el.attrib.get("stroke-dasharray")) or plen < DASH_LEN_MAX
        paths.append(
            {
                "el": el,
                "bbox": bb,
                "dashed": dashed,
                "pts": page_pts,
                "p1": page_pts[0],
                "p2": page_pts[-1],
                "len": plen,
                "mid": bbox_center(bb),
            }
        )
    return paths, ignored


def join_tol_for(path: dict) -> float:
    return JOIN_TOL_DASH if path.get("dashed") or path["len"] < DASH_LEN_MAX else JOIN_TOL


def build_adjacency(paths: list[dict]) -> list[list[int]]:
    n = len(paths)
    cell = JOIN_TOL_DASH
    bucket: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)

    def key(p: tuple[float, float]) -> tuple[int, int]:
        return (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))

    ends = [(p["p1"], p["p2"]) for p in paths]
    for i, (a, b) in enumerate(ends):
        bucket[key(a)].append((i, 0))
        bucket[key(b)].append((i, 1))

    adj: list[list[int]] = [[] for _ in range(n)]

    def nearby(p: tuple[float, float]):
        kx, ky = key(p)
        out = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                out.extend(bucket.get((kx + dx, ky + dy), []))
        return out

    for i, (a, b) in enumerate(ends):
        for ep in (a, b):
            for j, which in nearby(ep):
                if j <= i:
                    continue
                oj = ends[j][which]
                d = math.hypot(ep[0] - oj[0], ep[1] - oj[1])
                tol = max(join_tol_for(paths[i]), join_tol_for(paths[j]))
                if d <= tol:
                    adj[i].append(j)
                    adj[j].append(i)
                elif d <= 5.0:
                    # Small drafting gap: only if roughly axis-aligned continuation
                    si, sj = paths[i], paths[j]
                    ui = unit_vec(si["p1"][0], si["p1"][1], si["p2"][0], si["p2"][1])
                    uj = unit_vec(sj["p1"][0], sj["p1"][1], sj["p2"][0], sj["p2"][1])
                    ug = unit_vec(ep[0], ep[1], oj[0], oj[1])
                    if ug and ((abs(ug[0]) < 0.3 or abs(ug[1]) < 0.3) or (ui and abs(ui[0] * ug[0] + ui[1] * ug[1]) > 0.85)):
                        adj[i].append(j)
                        adj[j].append(i)
    for i in range(n):
        adj[i] = list(dict.fromkeys(adj[i]))
    return adj


def add_via_pin_edges(paths: list[dict], adj: list[list[int]], insulators: list[dict]) -> int:
    """
    Link wire paths whose endpoints touch the same pin circle.
    BFS will still refuse non-collinear jumpers at those nodes.
    """
    added = 0
    for inn in insulators:
        touching: list[int] = []
        for i, p in enumerate(paths):
            for ep in (p["p1"], p["p2"]):
                if math.hypot(ep[0] - inn["cx"], ep[1] - inn["cy"]) <= inn["r"] + 1.2:
                    touching.append(i)
                    break
        touching = list(dict.fromkeys(touching))
        for a in range(len(touching)):
            for b in range(a + 1, len(touching)):
                i, j = touching[a], touching[b]
                if j not in adj[i]:
                    adj[i].append(j)
                    adj[j].append(i)
                    added += 1
    return added


def unit_vec(ax: float, ay: float, bx: float, by: float) -> tuple[float, float] | None:
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy)
    if n < 1e-9:
        return None
    return (dx / n, dy / n)


def angle_deg(u: tuple[float, float], v: tuple[float, float]) -> float:
    dot = max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1]))
    return math.degrees(math.acos(dot))


def path_dir_at_end(path: dict, end: tuple[float, float]) -> tuple[float, float] | None:
    """Direction along path toward the given endpoint (incoming into the junction)."""
    pts = path["pts"]
    if len(pts) < 2:
        return None
    if math.hypot(end[0] - pts[-1][0], end[1] - pts[-1][1]) <= math.hypot(
        end[0] - pts[0][0], end[1] - pts[0][1]
    ):
        # end is near p2 — direction from previous point to p2
        return unit_vec(pts[-2][0], pts[-2][1], pts[-1][0], pts[-1][1])
    return unit_vec(pts[1][0], pts[1][1], pts[0][0], pts[0][1])


def path_dir_leaving(path: dict, end: tuple[float, float]) -> tuple[float, float] | None:
    """Direction leaving the junction into this path."""
    pts = path["pts"]
    if len(pts) < 2:
        return None
    if math.hypot(end[0] - pts[0][0], end[1] - pts[0][1]) <= math.hypot(
        end[0] - pts[-1][0], end[1] - pts[-1][1]
    ):
        return unit_vec(pts[0][0], pts[0][1], pts[1][0], pts[1][1])
    return unit_vec(pts[-1][0], pts[-1][1], pts[-2][0], pts[-2][1])


def shared_endpoint(a: dict, b: dict) -> tuple[float, float] | None:
    best = None
    best_d = 1e9
    for pa in (a["p1"], a["p2"]):
        for pb in (b["p1"], b["p2"]):
            d = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            if d < best_d:
                best_d = d
                best = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    tol = max(join_tol_for(a), join_tol_for(b))
    return best if best_d <= tol else None


def closest_marker(pt: tuple[float, float], markers: list[dict]) -> dict | None:
    best = None
    best_d = 1e18
    for m in markers:
        c = bbox_center(m["bbox"])
        d = math.hypot(pt[0] - c[0], pt[1] - c[1])
        if d < best_d:
            best_d = d
            best = m
    return best


def find_seed(marker: dict, paths: list[dict], claimed: set[int]) -> tuple[int | None, float]:
    """Prefer a substantial nearby wire (not a micro-tick) inside the expand zone."""
    best_i = None
    best_score = -1e18
    best_d = 1e18
    for i, p in enumerate(paths):
        if i in claimed:
            continue
        d = marker_to_path_distance(marker, p)
        if d > EXPAND_PT + 20:
            continue
        # Higher score = closer + longer
        score = -d + min(p["len"], 50.0) * 0.15
        if score > best_score:
            best_score = score
            best_i = i
            best_d = d
    return best_i, best_d


def bfs_trace(
    seed: int,
    marker: dict,
    markers: list[dict],
    paths: list[dict],
    adj: list[list[int]],
    insulators: list[dict],
    claimed: set[int],
) -> tuple[list[int], dict[str, int]]:
    """
    BFS along wire paths. Stops at pin circles, prefers collinear continuation
    at T-junctions, halts toward foreign color markers.
    """
    stops = {"pin": 0, "other_marker": 0, "angle": 0}
    chain: list[int] = []
    q: deque[int] = deque([seed])
    seen = {seed}

    while q:
        i = q.popleft()
        if i in claimed and i != seed:
            continue
        chain.append(i)
        path = paths[i]

        # Gather candidate neighbors at either endpoint
        candidates: list[tuple[int, tuple[float, float], float, bool]] = []
        # (j, junction, angle, at_pin)
        for ep in (path["p1"], path["p2"]):
            at_pin = point_hits_insulator(ep[0], ep[1], insulators)
            incoming = path_dir_at_end(path, ep)
            for j in adj[i]:
                if j in seen or j in claimed:
                    continue
                other = paths[j]
                junc = shared_endpoint(path, other)
                if junc is None:
                    # Via-pin join: both ends land on the same insulator
                    junc = None
                    for inn in insulators:
                        if math.hypot(ep[0] - inn["cx"], ep[1] - inn["cy"]) > inn["r"] + 1.2:
                            continue
                        for oep in (other["p1"], other["p2"]):
                            if math.hypot(oep[0] - inn["cx"], oep[1] - inn["cy"]) <= inn["r"] + 1.2:
                                junc = (inn["cx"], inn["cy"])
                                at_pin = True
                                break
                        if junc is not None:
                            break
                if junc is None:
                    continue
                if math.hypot(junc[0] - ep[0], junc[1] - ep[1]) > max(
                    join_tol_for(path), join_tol_for(other), 2.5
                ):
                    # Allow slightly larger when junction is a pin center
                    if not at_pin:
                        continue
                    if math.hypot(junc[0] - ep[0], junc[1] - ep[1]) > 6.0:
                        continue

                # Same-label ownership: refuse neighbors closer to another color marker
                mid = other["mid"]
                owner = closest_marker(mid, markers)
                if owner is not None and owner["code"] != marker["code"]:
                    oc = bbox_center(owner["bbox"])
                    mc = bbox_center(marker["bbox"])
                    d_them = math.hypot(mid[0] - oc[0], mid[1] - oc[1])
                    d_ours = math.hypot(mid[0] - mc[0], mid[1] - mc[1])
                    if d_them + 6.0 < d_ours:
                        stops["other_marker"] += 1
                        continue

                leaving = path_dir_leaving(other, junc)
                ang = 90.0
                if incoming and leaving:
                    cont = (-incoming[0], -incoming[1])
                    ang = angle_deg(cont, leaving)
                candidates.append((j, junc, ang, at_pin))

        if not candidates:
            continue

        # At pin circles: only collinear same-net continuation (no sideways jumpers)
        pin_cands = [c for c in candidates if c[3]]
        free_cands = [c for c in candidates if not c[3]]
        chosen: list[tuple[int, tuple[float, float], float, bool]] = []

        if pin_cands:
            stops["pin"] += len(pin_cands)
            pin_col = [c for c in pin_cands if c[2] <= ANGLE_CONTINUE_DEG]
            # Through-pin: only straight continuations belonging to this label
            chosen.extend(pin_col)
            if not pin_col:
                # No collinear path through pin → dead-end (do not take 90° jumpers)
                pass

        if free_cands:
            collinear = [c for c in free_cands if c[2] <= ANGLE_CONTINUE_DEG]
            if len(free_cands) >= 2 and collinear:
                chosen.extend(collinear)
                stops["angle"] += len(free_cands) - len(collinear)
            else:
                mild = [c for c in free_cands if c[2] <= 50.0]
                pick = mild if mild else free_cands[:1]
                chosen.extend(pick)
                if len(pick) < len(free_cands):
                    stops["angle"] += len(free_cands) - len(pick)

        for j, _junc, _ang, _pin in chosen:
            if j not in seen:
                seen.add(j)
                q.append(j)

    return chain, stops


def build_parent_map(root: ET.Element) -> dict[ET.Element, ET.Element]:
    return {child: parent for parent in root.iter() for child in list(parent)}


def insert_dual_clones(root: ET.Element, dual_clones: list[tuple[ET.Element, ET.Element, str]]) -> int:
    parents = build_parent_map(root)
    inserted = 0
    for original, clone, _code in dual_clones:
        parent = parents.get(original)
        if parent is None:
            continue
        kids = list(parent)
        try:
            idx = kids.index(original)
        except ValueError:
            parent.append(clone)
            inserted += 1
            continue
        parent.insert(idx + 1, clone)
        inserted += 1
    return inserted


def recolor_svg(root: ET.Element) -> dict:
    """
    Seed at each color marker → BFS along black wires with pin-circle insulators,
    angle preference at T-junctions, and halt near foreign color labels.
    """
    markers = cluster_glyphs(root)
    exploded = explode_multipart_paths(root)
    insulators = collect_insulators(root)
    insulator_els = {inn["el"] for inn in insulators}
    paths, ignored = collect_black_paths(root, insulator_els)
    adj = build_adjacency(paths)
    via_pin_edges = add_via_pin_edges(paths, adj, insulators)

    by_code: dict[str, int] = defaultdict(int)
    dual_clones: list[tuple[ET.Element, ET.Element, str]] = []
    audit: list[dict] = []
    claimed: set[int] = set()
    stop_totals = {"pin": 0, "other_marker": 0, "angle": 0}
    chain_lens: list[int] = []
    seeds_found = 0
    seeds_missed = 0

    # Process markers with closer seeds first
    scored: list[tuple[float, int]] = []
    for mi, m in enumerate(markers):
        seed, d = find_seed(m, paths, set())
        scored.append((d if seed is not None else 1e9, mi))
    scored.sort()

    for _, mi in scored:
        m = markers[mi]
        seed, seed_dist = find_seed(m, paths, claimed)
        if seed is None:
            seeds_missed += 1
            continue
        seeds_found += 1
        chain, stops = bfs_trace(seed, m, markers, paths, adj, insulators, claimed)
        for k, v in stops.items():
            stop_totals[k] += v
        chain_lens.append(len(chain))
        code = m["code"]
        primary, secondary = split_marker_colors(code)
        for idx in chain:
            if idx in claimed:
                continue
            claimed.add(idx)
            p = paths[idx]
            p["el"].set("stroke", primary)
            p["el"].set("stroke-opacity", "0.85")
            # Do not bump stroke-width — preserve pin/geometry fidelity
            by_code[code] += 1
            if secondary:
                clone = ET.Element(q("path"), dict(p["el"].attrib))
                clone.set("stroke", secondary)
                clone.set("stroke-dasharray", "2.5 2")
                clone.set("stroke-opacity", "0.9")
                dual_clones.append((p["el"], clone, code))
        if len(audit) < 12:
            audit.append(
                {
                    "path_bbox": tuple(round(x, 1) for x in paths[seed]["bbox"]),
                    "marker": code,
                    "primary": primary,
                    "secondary": secondary,
                    "dist": round(seed_dist, 2),
                    "chain_len": len(chain),
                }
            )

    dual_n = insert_dual_clones(root, dual_clones)
    avg_chain = (sum(chain_lens) / len(chain_lens)) if chain_lens else 0.0
    return {
        "markers": len(markers),
        "marker_codes": Counter(m["code"] for m in markers),
        "black_paths": len(paths),
        "ignored_nonblack_paths": ignored,
        "exploded_subpaths": exploded,
        "insulators": len(insulators),
        "via_pin_edges": via_pin_edges,
        "seeds_found": seeds_found,
        "seeds_missed": seeds_missed,
        "paths_recolored": len(claimed),
        "by_code": dict(sorted(by_code.items())),
        "dual_clones": dual_n,
        "audit": audit,
        "stop_hits": stop_totals,
        "avg_chain_len": round(avg_chain, 1),
        "max_chain_len": max(chain_lens) if chain_lens else 0,
    }


def svg_to_pdf(svg_path: Path, pdf_path: Path) -> Path:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    drawing = svg2rlg(str(svg_path))
    if drawing is None:
        raise SystemExit(f"svglib failed to parse {svg_path}")
    tmp = pdf_path.with_name(pdf_path.stem + ".__tmp__" + pdf_path.suffix)
    renderPDF.drawToFile(drawing, str(tmp))
    try:
        tmp.replace(pdf_path)
        return pdf_path
    except OSError:
        alt = pdf_path.with_name(pdf_path.stem + "_new" + pdf_path.suffix)
        try:
            if alt.exists():
                alt.unlink()
        except OSError:
            pass
        tmp.replace(alt)
        print(f"WARN: {pdf_path} is locked; wrote {alt}")
        return alt


def main() -> None:
    ap = argparse.ArgumentParser(description="Color Volvo EWD wires via SVG round-trip")
    ap.add_argument("--manual", type=Path, default=DEFAULT_MANUAL)
    ap.add_argument("--page", type=int, default=DEFAULT_PAGE)
    ap.add_argument("--svg", type=Path, default=DEFAULT_SVG)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.manual.exists():
        raise SystemExit(f"Manual not found: {args.manual}")

    doc = fitz.open(args.manual)
    if args.page < 1 or args.page > doc.page_count:
        n = doc.page_count
        doc.close()
        raise SystemExit(f"Page {args.page} out of range (1..{n})")

    page = doc[args.page - 1]
    svg_text = page.get_svg_image()
    doc.close()

    # Parse & recolor
    root = ET.fromstring(svg_text)
    report = recolor_svg(root)

    args.svg.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(root)
    tree.write(args.svg, encoding="utf-8", xml_declaration=True)

    saved_pdf = svg_to_pdf(args.svg, args.out)

    highlight = {
        k: v
        for k, v in report["by_code"].items()
        if not k.startswith("RD") or "-" in k  # show duals with RD; still list YE/BU/…
    }
    # Explicit non-red focus keys
    non_rd = {
        k: v
        for k, v in report["by_code"].items()
        if k.split("-")[0] not in ("RD", "R")
    }

    print("=== color_pdf_wires report (BFS + pin insulators) ===")
    print(f"manual: {args.manual}")
    print(f"page:   {args.page} (index {args.page - 1})")
    print(f"color markers found:       {report['markers']}")
    print(f"exploded_subpaths:         {report.get('exploded_subpaths', 0)}")
    print(f"black wire paths:          {report['black_paths']}")
    print(f"pin/circle insulators:     {report.get('insulators', 0)}")
    print(f"via_pin_edges:             {report.get('via_pin_edges', 0)}")
    print(f"ignored_nonblack_paths:    {report['ignored_nonblack_paths']}")
    print(f"seeds_found:               {report['seeds_found']}")
    print(f"seeds_missed:              {report['seeds_missed']}")
    print(f"paths_recolored:           {report['paths_recolored']}")
    print(f"avg/max chain len:         {report.get('avg_chain_len')}/{report.get('max_chain_len')}")
    print(f"stop_hits:                 {report.get('stop_hits')}")
    print(f"dual_clones_inserted:      {report['dual_clones']}")
    print("markers by code:", dict(sorted(report["marker_codes"].items())))
    print("recolored paths by code:", report["by_code"])
    print("non-RD highlight codes:", non_rd)
    print("audit (seed → marker → chain):")
    for row in report.get("audit") or []:
        sec = f" / dash {row['secondary']}" if row.get("secondary") else ""
        print(
            f"  {row['marker']} stroke={row['primary']}{sec} "
            f"seed_dist={row['dist']} chain={row.get('chain_len', '?')}"
        )
    print(f"saved svg: {args.svg.resolve()}")
    print(f"saved pdf: {saved_pdf.resolve()}")


if __name__ == "__main__":
    main()
