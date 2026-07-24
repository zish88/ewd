"""Parse LocationViews.xml → location_index.json (code → TwoDviews SVG)."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import find_package_root, package_data_dir

CODE_RE = re.compile(r"^(\d+)[A-Z]?/(\d+)", re.I)


def _norm_code(raw: str) -> str:
    m = CODE_RE.match(str(raw or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else ""


def build_location_index(data_dir: Path) -> dict[str, Any]:
    path = data_dir / "LocationViews.xml"
    by_code: dict[str, list[dict[str, Any]]] = {}
    total = 0
    if not path.is_file():
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_dir": str(data_dir),
            "error": f"missing {path}",
            "by_code": {},
        }
    # File is large (~5MB) — iterparse
    for _event, elem in ET.iterparse(path, events=("end",)):
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag != "LocationView":
            continue
        name = (elem.get("name") or "").strip()
        code = _norm_code(name)
        if not code:
            elem.clear()
            continue
        view_type = (elem.get("type") or "").strip()
        svg_rels: list[str] = []
        systems: list[dict[str, str]] = []
        for child in elem:
            ctag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            if ctag == "path":
                t = (child.text or "").strip()
                if t:
                    svg_rels.append(t)
            elif ctag == "systemPath":
                systems.append(
                    {
                        "objectConnId": child.get("objectConnId") or "",
                        "objectSchemId": child.get("objectSchemId") or "",
                        "sharedUID": child.get("sharedUID") or "",
                        "optionExpression": child.get("optionExpression")
                        or child.get("objectOptionxpression")
                        or "",
                        "systemUid": child.get("id") or "",
                        "diagramName": child.get("diagramName") or "",
                        "folder": child.get("folder") or "",
                    }
                )

        def resolve_svg(svg_rel: str) -> str:
            if not svg_rel:
                return ""
            norm = svg_rel.replace("\\", "/")
            if "Resources/" in norm:
                cand = data_dir / "Resources" / norm.split("Resources/", 1)[1]
            elif "/TwoDviews/" in norm:
                cand = data_dir / "Resources" / "TwoDviews" / Path(norm).name
            else:
                cand = data_dir / Path(norm)
            if cand.is_file():
                return str(cand.as_posix())
            alt = data_dir / "Resources" / "TwoDviews" / Path(norm).name
            return str(alt.as_posix()) if alt.is_file() else ""

        # Prefer non-PF composite path last; keep first existing
        abs_svgs = [resolve_svg(r) for r in svg_rels]
        abs_svgs = [p for p in abs_svgs if p]
        abs_svg = abs_svgs[-1] if abs_svgs else ""
        rec = {
            "code": code,
            "name": name,
            "type": view_type,
            "svg": abs_svg,
            "svgs": abs_svgs[:6],
            "svgRel": (svg_rels[-1].replace("\\", "/") if svg_rels else ""),
            "systems": systems[:12],
        }
        by_code.setdefault(code, []).append(rec)
        total += 1
        elem.clear()
        if total % 400 == 0:
            print(f"  locations: {total}…", flush=True)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "location_count": total,
        "unique_codes": len(by_code),
        "by_code": {k: v for k, v in sorted(by_code.items())},
    }


def run(ewd_root: Path | None = None, out_path: Path | None = None) -> Path:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    out = out_path or Path("data") / "ewd" / "location_index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = build_location_index(data)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--ewd-root", default=None)
    ap.add_argument("--out", default=str(Path("data") / "ewd" / "location_index.json"))
    args = ap.parse_args()
    print(f"Wrote {run(Path(args.ewd_root) if args.ewd_root else None, Path(args.out))}")
