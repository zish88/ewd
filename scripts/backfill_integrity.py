#!/usr/bin/env python3
"""Recompute wire_connections.integrity_score from pin/color/from/to fields."""
from __future__ import annotations

import os
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")


def filled(v: str) -> bool:
    s = str(v or "").strip()
    return bool(s) and s not in ("—", "-", "–", "None")


def score_row(pin: str, color: str, fd: str, td: str, fc: str, tc: str) -> int:
    # Prefer component codes when details empty
    from_ok = filled(fd) or filled(fc)
    to_ok = filled(td) or filled(tc)
    fields = [from_ok, to_ok, filled(color), filled(pin)]
    return int(round(100.0 * sum(1 for x in fields if x) / 4))


def main() -> int:
    try:
        import sys

        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if not os.path.isfile(DB_PATH):
        print("ERROR: missing wiring.sqlite")
        return 1
    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """
        SELECT w.id, w.pin_number, w.wire_color_raw, w.from_detail, w.to_detail,
               IFNULL(cf.component_code,''), IFNULL(ct.component_code,'')
        FROM wire_connections w
        LEFT JOIN components cf ON cf.id = w.from_component_id
        LEFT JOIN components ct ON ct.id = w.to_component_id
        """
    ).fetchall()
    upd = db.execute
    n = 0
    for wid, pin, color, fd, td, fc, tc in rows:
        sc = score_row(pin, color, fd, td, fc, tc)
        upd("UPDATE wire_connections SET integrity_score = ? WHERE id = ?", (sc, wid))
        n += 1
    db.commit()
    dist = db.execute(
        "SELECT integrity_score, COUNT(*) FROM wire_connections GROUP BY 1 ORDER BY 1"
    ).fetchall()
    db.close()
    print(f"integrity backfill ok: rows={n} dist={dist}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
