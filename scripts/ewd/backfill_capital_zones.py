"""Backfill Capital harness ids → zone ids in wiring.sqlite (no full reassemble)."""
from __future__ import annotations

import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ewd.assemble_capital_db import CAPITAL_HARNESS_ZONE  # noqa: E402


def main() -> int:
    db_path = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data" / "wiring.sqlite")
    conn = sqlite3.connect(str(db_path))
    updated = 0
    for hid, zone in CAPITAL_HARNESS_ZONE.items():
        cur = conn.execute(
            "UPDATE wire_connections SET harness_left=? WHERE TRIM(harness_left)=?",
            (zone, hid),
        )
        updated += cur.rowcount
    # Recompute home_zone from majority zone among wires for each subject_code
    rows = conn.execute(
        """SELECT subject_code, harness_left, COUNT(*) AS n
           FROM wire_connections
           WHERE TRIM(IFNULL(subject_code,'')) != ''
             AND TRIM(IFNULL(harness_left,'')) != ''
           GROUP BY subject_code, harness_left"""
    ).fetchall()
    by_code: dict[str, Counter[str]] = {}
    for code, harness, n in rows:
        by_code.setdefault(str(code), Counter())[str(harness)] += int(n)
    home_updated = 0
    for code, ctr in by_code.items():
        # Prefer known zone ids over leftover Capital ids / other
        best = ""
        best_n = -1
        for z, n in ctr.most_common():
            if z in {
                "front_doors",
                "rear_doors",
                "front_bumper",
                "rear_bumper",
                "trunk",
                "engine",
                "dashboard",
                "floor",
                "roof",
                "seats",
            }:
                if n > best_n:
                    best, best_n = z, n
        if not best:
            continue
        cur = conn.execute(
            "UPDATE components SET home_zone=? WHERE component_code=?",
            (best, code),
        )
        home_updated += cur.rowcount
    conn.commit()
    comps = conn.execute(
        "SELECT home_zone, COUNT(*) FROM components WHERE TRIM(IFNULL(home_zone,''))!='' GROUP BY home_zone"
    ).fetchall()
    print(f"wires harness_left updated: {updated}")
    print(f"components home_zone updated: {home_updated}")
    print("home_zone counts:", comps)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
