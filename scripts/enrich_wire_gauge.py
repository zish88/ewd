#!/usr/bin/env python3
"""Fill wire_connections.wire_gauge from EWD connectivity wirecsa (mm²)."""
from __future__ import annotations

import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from ewd.import_connectivity import (  # noqa: E402
    iter_connectivity_files,
    parse_connectivity_bytes,
    read_connectivity_xml,
)

DB_PATH = ROOT / "data" / "wiring.sqlite"
EWD_ROOT = Path(os.environ.get("EWD_SOURCE_DIR") or ROOT / "data" / "ewd" / "ewd_source" / "39363002" / "1" / "2")

CODE_RE = re.compile(r"^(\d+)/(\d+)", re.I)


def norm_code(raw: str) -> str:
    m = CODE_RE.match(str(raw or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else ""


def norm_color(raw: str) -> str:
    return str(raw or "").upper().replace("/", "-").replace(" ", "").strip()


def pin_tail(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.search(r"(\d+)\s*$", s)
    return m.group(1) if m else s


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if not DB_PATH.is_file():
        print("ERROR: missing wiring.sqlite", file=sys.stderr)
        return 1
    if not EWD_ROOT.is_dir():
        print(f"ERROR: EWD root missing: {EWD_ROOT}", file=sys.stderr)
        return 1

    files = iter_connectivity_files(EWD_ROOT)
    if not files:
        print("ERROR: no connectivity*.zip under Signals/", file=sys.stderr)
        return 1

    # (code, pin, color) -> wirecsa
    gauge_map: dict[tuple[str, str, str], str] = {}
    # weaker: (code, pin) -> wirecsa
    gauge_pin: dict[tuple[str, str], str] = {}

    scanned = 0
    for path in files:
        scanned += 1
        try:
            rec = parse_connectivity_bytes(read_connectivity_xml(path), path.name)
        except Exception:
            continue
        pin_by_id = {}
        for d in rec.get("devices") or []:
            code = norm_code(d.get("code") or d.get("name") or "")
            for p in d.get("pins") or []:
                pin_by_id[p.get("id") or ""] = (code, pin_tail(p.get("PPIN") or p.get("name") or ""))
        for w in rec.get("wires") or []:
            csa = str(w.get("wirecsa") or "").strip()
            if not csa:
                continue
            color = norm_color(w.get("wirecolor") or "")
            refs = list(w.get("pinrefs") or [])
            start = w.get("startpinref") or ""
            if start and start not in refs:
                refs = [start, *refs]
            for ref in refs:
                code, pin = pin_by_id.get(ref, ("", ""))
                if not code or not pin:
                    continue
                if color:
                    gauge_map[(code, pin, color)] = csa
                gauge_pin[(code, pin)] = csa
        if scanned % 500 == 0:
            print(f"… scanned {scanned}/{len(files)} files, keys={len(gauge_map)}")

    db = sqlite3.connect(str(DB_PATH))
    wcols = {r[1] for r in db.execute("pragma table_info(wire_connections)")}
    if "wire_gauge" not in wcols:
        db.execute("ALTER TABLE wire_connections ADD COLUMN wire_gauge TEXT NOT NULL DEFAULT ''")
    if "voltage" not in wcols:
        db.execute("ALTER TABLE wire_connections ADD COLUMN voltage TEXT NOT NULL DEFAULT ''")

    updated = 0
    for wid, subj, pin, color in db.execute(
        """
        SELECT id, TRIM(IFNULL(subject_code,'')), TRIM(IFNULL(pin_number,'')),
               UPPER(REPLACE(REPLACE(IFNULL(wire_color_raw,''),'/', '-'), ' ', ''))
        FROM wire_connections
        WHERE TRIM(IFNULL(wire_gauge,'')) = ''
        """
    ):
        pin_n = pin_tail(pin)
        if not subj or not pin_n:
            continue
        csa = gauge_map.get((subj, pin_n, color)) or gauge_pin.get((subj, pin_n))
        if not csa:
            continue
        db.execute("UPDATE wire_connections SET wire_gauge = ? WHERE id = ?", (csa, wid))
        updated += 1

    db.commit()
    filled = db.execute(
        "SELECT COUNT(*) FROM wire_connections WHERE TRIM(IFNULL(wire_gauge,'')) != ''"
    ).fetchone()[0]
    db.close()
    print(
        f"wire_gauge ok: scanned_files={scanned} map_keys={len(gauge_map)} "
        f"updated={updated} filled={filled}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
