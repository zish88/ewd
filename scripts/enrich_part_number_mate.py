#!/usr/bin/env python3
"""Fill components.part_number_mate from data/vida_connector_parts.json."""
from __future__ import annotations

import json
import os
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")
JSON_PATH = os.path.join(ROOT, "data", "vida_connector_parts.json")


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print("ERROR: missing wiring.sqlite")
        return 1
    if not os.path.isfile(JSON_PATH):
        print("ERROR: missing vida_connector_parts.json")
        return 1

    raw = json.loads(open(JSON_PATH, encoding="utf-8").read())
    # Support { "connectors": { "74/507": {...} } } or flat map/list
    by_code: dict[str, dict] = {}
    if isinstance(raw, dict) and isinstance(raw.get("connectors"), dict):
        by_code = raw["connectors"]
    elif isinstance(raw, dict) and isinstance(raw.get("by_code"), dict):
        by_code = raw["by_code"]
    elif isinstance(raw, dict):
        by_code = {k: v for k, v in raw.items() if isinstance(v, dict) and "/" in k}
    elif isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            code = str(row.get("code") or row.get("component_code") or "").strip()
            if code:
                by_code[code] = row

    db = sqlite3.connect(DB_PATH)
    cols = {r[1] for r in db.execute("pragma table_info(components)")}
    if "part_number_mate" not in cols:
        db.execute("ALTER TABLE components ADD COLUMN part_number_mate TEXT NOT NULL DEFAULT ''")
        db.commit()

    updated = 0
    for code, rec in by_code.items():
        mate = str(rec.get("part_number_mate") or "").strip()
        pn = str(rec.get("part_number") or "").strip()
        if not mate and not pn:
            continue
        row = db.execute(
            "SELECT IFNULL(part_number,''), IFNULL(part_number_mate,'') FROM components WHERE component_code=?",
            (code,),
        ).fetchone()
        if not row:
            continue
        cur_pn, cur_mate = row
        new_pn = cur_pn or pn
        new_mate = cur_mate or mate
        if new_pn == cur_pn and new_mate == cur_mate:
            continue
        db.execute(
            "UPDATE components SET part_number=?, part_number_mate=? WHERE component_code=?",
            (new_pn, new_mate, code),
        )
        updated += 1
    db.commit()
    with_mate = db.execute(
        "SELECT COUNT(*) FROM components WHERE TRIM(IFNULL(part_number_mate,'')) != ''"
    ).fetchone()[0]
    with_pn = db.execute(
        "SELECT COUNT(*) FROM components WHERE TRIM(IFNULL(part_number,'')) != ''"
    ).fetchone()[0]
    db.close()
    print(f"updated={updated} with_part_number={with_pn} with_mate={with_mate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
