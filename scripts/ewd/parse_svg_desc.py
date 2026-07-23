"""
Parse EWD schematic SVGs: link <desc> CHS UIDs to nearby <path> geometry
and collect Volvo text codes drawn on the sheet.
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import find_package_root, package_data_dir

DESC_UID_RE = re.compile(r"\bUID[0-9a-fA-F-]+\b")
DESC_CLASS_RE = re.compile(r"chs\.cof\.logical\.schem\.(\w+)")
VOLVO_CODE_RE = re.compile(r"\b(\d{1,3}[A-Z]?/\d{2,6}[A-Z0-9]*)\b", re.I)
PATH_D_RE = re.compile(r"\bd=['\"]([^'\"]+)['\"]", re.I)


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _iter_svg_files(data_dir: Path) -> list[Path]:
    out: list[Path] = []
    for ddir in sorted(data_dir.iterdir()):
        if ddir.is_dir() and ddir.name.startswith("UID"):
            out.extend(sorted(ddir.glob("*.svg")))
    return out


def parse_schematic_svg(svg_path: Path) -> dict[str, Any]:
    """
    Walk SVG in document order. When we see <desc>…UID…</desc>, associate
    following sibling geometry (<path>/<polyline>/<line>/<rect>/<circle>)
    until the next <desc> or structural break.
    """
    text = svg_path.read_text(encoding="utf-8", errors="ignore")
    # Fast path stats even if XML parse fails
    text_codes = sorted({normalize_loose(m.group(1)) for m in VOLVO_CODE_RE.finditer(text) if m})
    path_count = len(PATH_D_RE.findall(text))
    desc_blobs = re.findall(r"<desc[^>]*>(.*?)</desc>", text, flags=re.I | re.S)

    groups: list[dict[str, Any]] = []
    try:
        # Strip default ns for easier parsing
        cleaned = re.sub(r'\sxmlns="[^"]+"', "", text, count=1)
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        # Fallback: desc-only index from regex
        for blob in desc_blobs:
            uids = DESC_UID_RE.findall(blob)
            cls = DESC_CLASS_RE.search(blob)
            if uids:
                groups.append(
                    {
                        "schemClass": cls.group(1) if cls else "",
                        "uids": uids,
                        "pathCount": 0,
                        "pathSamples": [],
                    }
                )
        return {
            "svg": str(svg_path.as_posix()),
            "diagramUid": svg_path.stem,
            "designFolder": svg_path.parent.name,
            "pathCount": path_count,
            "textCodes": text_codes,
            "descGroupCount": len(groups),
            "groups": groups,
            "parseMode": "regex-fallback",
        }

    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if current and (current.get("uids") or current.get("pathCount")):
            groups.append(current)
        current = None

    def walk(elem: ET.Element) -> None:
        nonlocal current
        tag = _local(elem.tag)
        if tag == "desc":
            flush()
            blob = "".join(elem.itertext())
            uids = DESC_UID_RE.findall(blob)
            cls = DESC_CLASS_RE.search(blob)
            current = {
                "schemClass": cls.group(1) if cls else "",
                "uids": uids,
                "pathCount": 0,
                "pathSamples": [],
            }
            return
        if tag in {"path", "polyline", "line", "rect", "circle"} and current is not None:
            current["pathCount"] = int(current["pathCount"]) + 1
            d = elem.get("d") or elem.get("points") or ""
            if d and len(current["pathSamples"]) < 3:
                current["pathSamples"].append(
                    {
                        "tag": tag,
                        "class": elem.get("class") or "",
                        "d": d[:160],
                    }
                )
            return
        for child in list(elem):
            walk(child)

    walk(root)
    flush()

    # UID → group index for reverse lookup
    uid_index: dict[str, list[int]] = {}
    for i, g in enumerate(groups):
        for u in g.get("uids") or []:
            uid_index.setdefault(u, []).append(i)

    return {
        "svg": str(svg_path.as_posix()),
        "diagramUid": svg_path.stem,
        "designFolder": svg_path.parent.name,
        "pathCount": path_count,
        "textCodes": text_codes,
        "descGroupCount": len(groups),
        "groups": groups,
        "uidToGroup": uid_index,
        "parseMode": "elementtree",
    }


def normalize_loose(raw: str) -> str:
    m = re.match(r"^(\d+)/(\d+)", str(raw or "").strip(), re.I)
    return f"{m.group(1)}/{m.group(2)}" if m else str(raw or "").strip()


def build_svg_desc_index(data_dir: Path, limit: int | None = None) -> dict[str, Any]:
    svgs = _iter_svg_files(data_dir)
    if limit is not None:
        svgs = svgs[:limit]
    diagrams: dict[str, Any] = {}
    code_to_diagrams: dict[str, list[str]] = {}
    total_groups = 0
    for svg in svgs:
        rec = parse_schematic_svg(svg)
        diagrams[rec["diagramUid"]] = rec
        total_groups += int(rec.get("descGroupCount") or 0)
        for code in rec.get("textCodes") or []:
            code_to_diagrams.setdefault(code, []).append(rec["diagramUid"])

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "svg_count": len(diagrams),
        "desc_group_total": total_groups,
        "diagrams": diagrams,
        "codeToDiagramUids": {
            k: sorted(set(v)) for k, v in sorted(code_to_diagrams.items(), key=lambda kv: kv[0])
        },
        "samples": {
            k: diagrams[k]
            for k in list(diagrams)[:2]
        },
    }


def run(ewd_root: Path | None = None, out_path: Path | None = None, limit: int | None = None) -> Path:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    payload = build_svg_desc_index(data, limit=limit)
    out = out_path or Path("data") / "ewd" / "svg_desc_index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
