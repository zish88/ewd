"""
Build Volvo component code → objectId / systemUid / diagramUids index
from package devices.xml + per-design UID*/devices.xml (and connectors/inlines/splices).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import find_package_root, package_data_dir

COMPONENT_NAME_RE = re.compile(r"^(\d+)[A-Z]?/(\d+)", re.I)


def normalize_volvo_code(raw: str) -> str:
    m = COMPONENT_NAME_RE.match(str(raw or "").strip())
    if not m:
        return ""
    return f"{m.group(1)}/{m.group(2)}"


def _tooltip_map(obj: ET.Element) -> dict[str, str]:
    out: dict[str, str] = {}
    for tip in obj.findall("tooltip"):
        k = (tip.get("name") or "").strip()
        v = (tip.get("value") or "").strip()
        if k:
            out[k] = v
    return out


def _parse_object_catalog(path: Path, kind: str) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return []
    rows: list[dict[str, Any]] = []
    # devices/connectors use <object>; signals.xml uses <signal>
    elems = list(root.findall("object")) + list(root.findall("signal"))
    for obj in elems:
        name = (obj.get("name") or obj.get("alt_name") or "").strip()
        code = normalize_volvo_code(name)
        diagram_uids = [
            u.strip()
            for u in re.split(r"[\s,;]+", obj.get("diagramUids") or "")
            if u.strip()
        ]
        rows.append(
            {
                "name": name,
                "code": code or name,
                "objectId": (obj.get("objectId") or obj.get("id") or "").strip(),
                "systemUid": (obj.get("systemUid") or "").strip(),
                "diagramUids": diagram_uids,
                "optionExpression": (obj.get("optionExpression") or "").strip(),
                "kind": kind,
                "source": str(path.as_posix()),
                "tooltips": _tooltip_map(obj),
            }
        )
    return rows


def build_device_index(data_dir: Path) -> dict[str, Any]:
    """Merge global + per-design catalogs keyed by Volvo code."""
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_rows: list[dict[str, Any]] = []

    catalog_files = [
        (data_dir / "devices.xml", "device"),
        (data_dir / "connectors.xml", "connector"),
        (data_dir / "inlines.xml", "inline"),
        (data_dir / "splices.xml", "splice"),
        (data_dir / "grounds.xml", "ground"),
    ]
    for path, kind in catalog_files:
        for row in _parse_object_catalog(path, kind):
            all_rows.append(row)
            key = row["code"] if row["code"] else row["name"]
            by_code[key].append(row)

    design_dirs = sorted(
        p for p in data_dir.iterdir() if p.is_dir() and p.name.startswith("UID")
    )
    per_design = 0
    for ddir in design_dirs:
        for fname, kind in (
            ("devices.xml", "device"),
            ("connectors.xml", "connector"),
            ("inlines.xml", "inline"),
            ("splices.xml", "splice"),
            ("signals.xml", "signal"),
        ):
            path = ddir / fname
            rows = _parse_object_catalog(path, kind)
            if not rows:
                continue
            per_design += len(rows)
            for row in rows:
                row["designFolder"] = ddir.name
                all_rows.append(row)
                key = row["code"] if row["code"] else row["name"]
                by_code[key].append(row)

    # Compact: unique (objectId, diagramUid) per code
    compact: dict[str, dict[str, Any]] = {}
    for code, rows in sorted(by_code.items(), key=lambda kv: kv[0]):
        object_ids = sorted({r["objectId"] for r in rows if r["objectId"]})
        system_uids = sorted({r["systemUid"] for r in rows if r["systemUid"]})
        diagram_uids: set[str] = set()
        for r in rows:
            diagram_uids.update(r.get("diagramUids") or [])
        kinds = sorted({r["kind"] for r in rows})
        compact[code] = {
            "code": code,
            "objectIds": object_ids,
            "systemUids": system_uids,
            "diagramUids": sorted(diagram_uids),
            "kinds": kinds,
            "occurrenceCount": len(rows),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "design_folders_scanned": len(design_dirs),
        "raw_object_count": len(all_rows),
        "per_design_object_count": per_design,
        "unique_codes": len(compact),
        "by_code": compact,
        # Keep a few samples for smoke checks
        "samples": {
            k: compact[k]
            for k in ("3/74", "74/507", "73/5019", "15/36", "6/193")
            if k in compact
        },
    }


def run(ewd_root: Path | None = None, out_path: Path | None = None) -> Path:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    payload = build_device_index(data)
    out = out_path or Path("data") / "ewd" / "device_index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    import json

    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
