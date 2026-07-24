"""
Build pin↔wire↔diagram index from Capital Signals/connectivity*.zip
and svg_desc_index.json. Also build GlobalSignals reverse index.

Outputs:
  data/ewd/pin_wire_index.json
  data/ewd/global_signal_index.json
"""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .import_connectivity import (
    iter_connectivity_files,
    parse_connectivity_bytes,
    read_connectivity_xml,
)
from .paths import find_package_root, package_data_dir

VOLVO_CODE_RE = re.compile(r"^(\d+)/(\d+)", re.I)


def _norm_code(raw: str) -> str:
    m = VOLVO_CODE_RE.match(str(raw or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else str(raw or "").strip()


def _norm_pin(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # Prefer trailing cavity digit: C1-21 → 21, 74/507:21 → 21
    m = re.search(r"(?:^|[-;:/])([0-9A-Z]{1,4})$", s, re.I)
    if m:
        return m.group(1).upper()
    return s.upper()


def _pin_keys(ppin: str, pin_name: str) -> list[str]:
    out: list[str] = []
    for raw in (ppin, pin_name):
        s = str(raw or "").strip()
        if not s:
            continue
        if s not in out:
            out.append(s)
        n = _norm_pin(s)
        if n and n not in out:
            out.append(n)
    return out


def _load_uid_to_diagrams(svg_index_path: Path) -> dict[str, list[str]]:
    if not svg_index_path.is_file():
        return {}
    payload = json.loads(svg_index_path.read_text(encoding="utf-8"))
    uid_map: dict[str, list[str]] = {}
    for diagram_uid, rec in (payload.get("diagrams") or {}).items():
        for g in rec.get("groups") or []:
            for uid in g.get("uids") or []:
                if not uid:
                    continue
                bucket = uid_map.setdefault(uid, [])
                if diagram_uid not in bucket:
                    bucket.append(diagram_uid)
    return uid_map


def _diagrams_for_uids(uid_map: dict[str, list[str]], *uids: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for u in uids:
        if not u:
            continue
        for d in uid_map.get(u) or []:
            if d not in seen:
                seen.add(d)
                out.append(d)
    return out


def build_pin_wire_index(
    data_dir: Path,
    *,
    svg_index_path: Path,
    max_files: int | None = None,
) -> dict[str, Any]:
    uid_to_diagrams = _load_uid_to_diagrams(svg_index_path)
    files = iter_connectivity_files(data_dir)
    total = len(files)
    if max_files is not None:
        files = files[:max_files]

    # key: "code|pinNorm|systemUid" → list of edge dicts
    by_key: dict[str, list[dict[str, Any]]] = {}
    by_code_pin: dict[str, list[dict[str, Any]]] = {}
    errors = 0
    edge_count = 0

    for i, path in enumerate(files):
        try:
            raw = read_connectivity_xml(path)
            rec = parse_connectivity_bytes(raw, source_name=path.name)
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  WARN {path.name}: {e}", flush=True)
            continue

        pin_by_id: dict[str, dict[str, Any]] = {}
        for dev in rec.get("devices") or []:
            code = _norm_code(dev.get("code") or dev.get("name") or "")
            if not code or "/" not in code:
                continue
            for pin in dev.get("pins") or []:
                pid = pin.get("id") or ""
                if not pid:
                    continue
                pin_by_id[pid] = {
                    "code": code,
                    "ppin": pin.get("PPIN") or "",
                    "pin": pin.get("name") or "",
                    "pn": pin.get("PN") or "",
                    "pinUid": pin.get("sourceObjectUID") or "",
                    "systemUid": dev.get("sourceDesignUID") or "",
                    "deviceOption": dev.get("optionExpression") or "",
                }

        for wire in rec.get("wires") or []:
            pinrefs = [p for p in (wire.get("pinrefs") or []) if p]
            if len(pinrefs) < 2:
                continue
            a = pin_by_id.get(pinrefs[0])
            b = pin_by_id.get(pinrefs[1])
            if not a and not b:
                continue
            wire_uid = wire.get("sourceObjectUID") or ""
            shared = wire.get("sharedObjectUID") or ""
            color = (wire.get("wirecolor") or wire.get("color") or "").replace("/", "-")
            opt = wire.get("optionExpression") or ""
            harness = wire.get("harness") or ""
            gauge = wire.get("wirecsa") or ""
            wire_name = wire.get("name") or ""

            pairs = []
            if a and b:
                pairs = [(a, b), (b, a)]
            elif a:
                pairs = [(a, None)]
            elif b:
                pairs = [(b, None)]

            for self_pin, peer_pin in pairs:
                if not self_pin:
                    continue
                code = self_pin["code"]
                system = self_pin["systemUid"] or (peer_pin or {}).get("systemUid") or ""
                peer_code = (peer_pin or {}).get("code") or ""
                peer_ppin = (peer_pin or {}).get("ppin") or (peer_pin or {}).get("pin") or ""
                peer_uid = (peer_pin or {}).get("pinUid") or ""
                diagram_uids = _diagrams_for_uids(
                    uid_to_diagrams,
                    self_pin.get("pinUid") or "",
                    wire_uid,
                    peer_uid,
                    shared,
                )
                edge = {
                    "code": code,
                    "ppin": self_pin.get("ppin") or self_pin.get("pin") or "",
                    "pin": self_pin.get("pin") or "",
                    "pinUid": self_pin.get("pinUid") or "",
                    "wireUid": wire_uid,
                    "sharedObjectUID": shared,
                    "peerCode": peer_code,
                    "peerPin": peer_ppin,
                    "peerUid": peer_uid,
                    "color": color,
                    "gauge": gauge,
                    "harness": harness,
                    "wireName": wire_name,
                    "optionExpression": opt or self_pin.get("deviceOption") or "",
                    "systemUid": system,
                    "diagramUids": diagram_uids[:12],
                    "source": path.name,
                }
                for pk in _pin_keys(self_pin.get("ppin") or "", self_pin.get("pin") or ""):
                    pin_norm = _norm_pin(pk)
                    key = f"{code}|{pin_norm}|{system}"
                    soft = f"{code}|{pin_norm}"
                    by_key.setdefault(key, []).append(edge)
                    by_code_pin.setdefault(soft, []).append(edge)
                    edge_count += 1

        if (i + 1) % 200 == 0:
            print(f"  pin_wire: {i + 1}/{len(files)} files, edges≈{edge_count}…", flush=True)

    # Deduplicate edges per key (same wireUid+peer+color)
    def dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for e in rows:
            sig = "|".join(
                [
                    e.get("wireUid") or "",
                    e.get("pinUid") or "",
                    e.get("peerCode") or "",
                    e.get("peerPin") or "",
                    e.get("color") or "",
                    e.get("optionExpression") or "",
                    e.get("source") or "",
                ]
            )
            if sig in seen:
                continue
            seen.add(sig)
            out.append(e)
        return out

    by_key = {k: dedupe(v)[:40] for k, v in sorted(by_key.items())}
    by_code_pin = {k: dedupe(v)[:40] for k, v in sorted(by_code_pin.items())}

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "connectivity_files_total": total,
        "connectivity_files_scanned": len(files),
        "errors": errors,
        "key_count": len(by_key),
        "code_pin_count": len(by_code_pin),
        "by_key": by_key,
        "by_code_pin": by_code_pin,
        "note": "key = code|pinNorm|systemUid; soft lookup = code|pinNorm",
    }


def build_global_signal_index(
    data_dir: Path,
    *,
    svg_index_path: Path,
    max_files: int | None = None,
) -> dict[str, Any]:
    glob_dir = data_dir / "GlobalSignals"
    uid_to_diagrams = _load_uid_to_diagrams(svg_index_path)
    by_uid: dict[str, dict[str, Any]] = {}
    files = sorted(glob_dir.glob("globalsignal*.xml")) if glob_dir.is_dir() else []
    total = len(files)
    if max_files is not None:
        files = files[:max_files]
    scanned = 0
    for path in files:
        try:
            root = ET.fromstring(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        uids = [
            (el.get("id") or "").strip()
            for el in root.iter()
            if (el.tag.endswith("object") or el.tag == "object") and (el.get("id") or "").startswith("UID")
        ]
        uids = [u for u in uids if u]
        if len(uids) < 2:
            scanned += 1
            continue
        diagrams = _diagrams_for_uids(uid_to_diagrams, *uids)
        for uid in uids:
            siblings = [u for u in uids if u != uid]
            prev = by_uid.get(uid)
            if not prev or len(siblings) > len(prev.get("siblings") or []):
                by_uid[uid] = {
                    "uid": uid,
                    "signalFile": path.name,
                    "siblings": siblings[:64],
                    "diagramUids": diagrams[:24],
                }
        scanned += 1
        if scanned % 200 == 0:
            print(f"  global_signals: {scanned}/{len(files)}…", flush=True)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "files_total": total,
        "files_scanned": scanned,
        "uid_count": len(by_uid),
        "by_uid": by_uid,
    }


def run(
    ewd_root: Path | None = None,
    out_dir: Path | None = None,
    *,
    max_files: int | None = None,
    global_max: int | None = None,
) -> tuple[Path, Path]:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    out = out_dir or Path("data") / "ewd"
    out.mkdir(parents=True, exist_ok=True)
    svg_path = out / "svg_desc_index.json"

    print("=== pin_wire_index ===", flush=True)
    pin_payload = build_pin_wire_index(data, svg_index_path=svg_path, max_files=max_files)
    pin_path = out / "pin_wire_index.json"
    pin_path.write_text(json.dumps(pin_payload, ensure_ascii=False), encoding="utf-8")
    print(
        f"Wrote {pin_path} keys={pin_payload['key_count']} "
        f"code_pin={pin_payload['code_pin_count']} errors={pin_payload['errors']}",
        flush=True,
    )

    print("=== global_signal_index ===", flush=True)
    glob_payload = build_global_signal_index(
        data, svg_index_path=svg_path, max_files=global_max
    )
    glob_path = out / "global_signal_index.json"
    glob_path.write_text(json.dumps(glob_payload, ensure_ascii=False), encoding="utf-8")
    print(
        f"Wrote {glob_path} uids={glob_payload['uid_count']} "
        f"files={glob_payload['files_scanned']}",
        flush=True,
    )
    return pin_path, glob_path


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Build pin_wire + global_signal indexes")
    ap.add_argument("--ewd-root", default=None)
    ap.add_argument("--out-dir", default=str(Path("data") / "ewd"))
    ap.add_argument("--max-files", type=int, default=0, help="0 = all connectivity files")
    ap.add_argument("--global-max", type=int, default=0, help="0 = all globalsignal files")
    args = ap.parse_args()
    run(
        Path(args.ewd_root) if args.ewd_root else None,
        Path(args.out_dir),
        max_files=args.max_files or None,
        global_max=args.global_max or None,
    )
