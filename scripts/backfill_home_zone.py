#!/usr/bin/env python3
"""Derive components.home_zone from harness_* majority (+ subject owner bias)."""
from __future__ import annotations

import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")

ZONE_RULES = [
    ("front_bumper", re.compile(r"bumper,?\s*front|front\s*bumper|front\s*pas|parking\s*assistance|FLC", re.I)),
    ("rear_bumper", re.compile(r"bumper,?\s*rear|rear\s*bumper|rear\s*pas", re.I)),
    ("trunk", re.compile(r"trunk\s*lid|tailgate|cargo", re.I)),
    ("front_doors", re.compile(r"front\s*door", re.I)),
    ("rear_doors", re.compile(r"rear\s*door", re.I)),
    ("engine", re.compile(r"engine(\s*compartment)?(\s*harness)?|\bcompartment\b", re.I)),
    ("dashboard", re.compile(r"dashboard|instrument|heater|cabin|climate|infotainment", re.I)),
    ("floor", re.compile(r"floor|tunnel|axle", re.I)),
    ("roof", re.compile(r"\broof\b|windshield", re.I)),
    ("seats", re.compile(r"\bseat\b", re.I)),
]

BODY_BIAS = {
    "front_bumper",
    "rear_bumper",
    "trunk",
    "front_doors",
    "rear_doors",
    "roof",
    "seats",
}


def harness_to_zone(text: str) -> str | None:
    s = (text or "").strip()
    if not s:
        return None
    for zid, rx in ZONE_RULES:
        if rx.search(s):
            return zid
    if re.search(r"\bdoor\b", s, re.I):
        return "front_doors"
    return None


def pick_zone(votes: dict[str, int]) -> str:
    if not votes:
        return ""
    # Prefer body zones over engine when both present (boundary cables)
    body = {k: v for k, v in votes.items() if k in BODY_BIAS}
    pool = body if body else votes
    return sorted(pool.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


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
    cols = {r[1] for r in db.execute("pragma table_info(components)")}
    if "home_zone" not in cols:
        db.execute("ALTER TABLE components ADD COLUMN home_zone TEXT NOT NULL DEFAULT ''")
        db.commit()

    # Votes per component_code from subject-owner wires (strong) and endpoint mentions (weak)
    votes: dict[str, dict[str, int]] = {}

    for subj, hl, hr in db.execute(
        """
        SELECT TRIM(IFNULL(subject_code,'')), IFNULL(harness_left,''), IFNULL(harness_right,'')
        FROM wire_connections
        WHERE TRIM(IFNULL(subject_code,'')) != ''
        """
    ):
        if not subj:
            continue
        bucket = votes.setdefault(subj, {})
        for h in (hl, hr):
            z = harness_to_zone(h)
            if z:
                bucket[z] = bucket.get(z, 0) + 3  # owner bias

    for code, hl, hr in db.execute(
        """
        SELECT c.component_code, IFNULL(w.harness_left,''), IFNULL(w.harness_right,'')
        FROM wire_connections w
        JOIN components c ON c.id IN (w.from_component_id, w.to_component_id, w.via_component_id)
        WHERE TRIM(IFNULL(w.harness_left,'')) != '' OR TRIM(IFNULL(w.harness_right,'')) != ''
        """
    ):
        bucket = votes.setdefault(code, {})
        for h in (hl, hr):
            z = harness_to_zone(h)
            if z:
                bucket[z] = bucket.get(z, 0) + 1

    updated = 0
    for code, bucket in votes.items():
        zone = pick_zone(bucket)
        if not zone:
            continue
        cur = db.execute(
            "UPDATE components SET home_zone = ? WHERE component_code = ? AND (TRIM(IFNULL(home_zone,'')) = '' OR home_zone != ?)",
            (zone, code, zone),
        )
        updated += cur.rowcount

    db.commit()
    filled = db.execute(
        "SELECT COUNT(*) FROM components WHERE TRIM(IFNULL(home_zone,'')) != ''"
    ).fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM components").fetchone()[0]
    db.close()
    print(f"home_zone ok: updated={updated} filled={filled}/{total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
