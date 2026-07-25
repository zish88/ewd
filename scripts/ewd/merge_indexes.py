"""Merge a secondary Capital extract (e.g. VEA 4/5) into primary data/ewd indexes."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def merge_by_code(primary: dict, secondary: dict, key: str = "by_code") -> int:
    a = primary.setdefault(key, {})
    if not isinstance(a, dict):
        return 0
    b = secondary.get(key) or {}
    if not isinstance(b, dict):
        return 0
    n = 0
    for code, rec in b.items():
        if code not in a:
            a[code] = rec
            n += 1
            continue
        # face_view etc. may store a list per code
        if isinstance(rec, list) and isinstance(a[code], list):
            cur = list(a[code])
            for x in rec:
                if x not in cur:
                    cur.append(x)
            a[code] = cur
            n += 1
            continue
        if not isinstance(rec, dict) or not isinstance(a[code], dict):
            continue
        for field in ("diagramUids", "systemUids", "objectIds"):
            if isinstance(rec.get(field), list):
                cur = list(a[code].get(field) or [])
                for x in rec[field]:
                    if x not in cur:
                        cur.append(x)
                a[code][field] = cur
        n += 1
    return n


def merge_diagrams(primary: dict, secondary: dict) -> int:
    a = primary.setdefault("diagrams", {})
    b = secondary.get("diagrams") or {}
    n = 0
    for uid, rec in b.items():
        if uid not in a:
            a[uid] = rec
            n += 1
    return n


def merge_flat_maps(primary: dict, secondary: dict, keys: list[str]) -> int:
    n = 0
    for key in keys:
        if key not in secondary:
            continue
        if isinstance(secondary[key], dict):
            dest = primary.setdefault(key, {})
            if not isinstance(dest, dict):
                continue
            for k, v in secondary[key].items():
                if k not in dest:
                    dest[k] = v
                    n += 1
        elif key not in primary:
            primary[key] = secondary[key]
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="Merge VEA/secondary EWD JSON indexes into primary")
    ap.add_argument("--primary", default="data/ewd", help="Primary indexes dir")
    ap.add_argument("--secondary", required=True, help="Secondary extract dir (e.g. data/ewd/_vea)")
    ap.add_argument(
        "--files",
        default="device_index.json,svg_desc_index.json,connectivity_index.json,pin_wire_index.json,face_view_index.json,location_index.json,global_signal_index.json,lang_ru_index.json",
    )
    args = ap.parse_args()
    primary_dir = Path(args.primary)
    secondary_dir = Path(args.secondary)
    for name in [x.strip() for x in args.files.split(",") if x.strip()]:
        p_path = primary_dir / name
        s_path = secondary_dir / name
        if not s_path.is_file():
            print(f"skip missing secondary {name}")
            continue
        primary = load(p_path)
        secondary = load(s_path)
        added = 0
        if "by_code" in secondary or "by_code" in primary:
            added += merge_by_code(primary, secondary, "by_code")
        if "diagrams" in secondary:
            added += merge_diagrams(primary, secondary)
        added += merge_flat_maps(
            primary,
            secondary,
            [
                "codeToConnectivityFiles",
                "codeToSystemFiles",
                "by_uid",
                "by_pin",
                "uidToDiagrams",
                "codes",
            ],
        )
        # Keep primary data_dir on 1/2; record vea path for ops
        if secondary.get("data_dir"):
            primary.setdefault("secondary_data_dirs", [])
            if isinstance(primary["secondary_data_dirs"], list):
                sd = secondary["data_dir"]
                if sd not in primary["secondary_data_dirs"]:
                    primary["secondary_data_dirs"].append(sd)
        save(p_path, primary)
        print(f"merged {name}: touched~{added}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
