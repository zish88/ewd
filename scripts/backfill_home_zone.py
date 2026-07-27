#!/usr/bin/env python3
"""Derive components.home_zone from harness_* majority (+ subject owner bias).

Mirrors server/harnessZones.ts Capital ids + tightened zone rules.
"""
from __future__ import annotations

import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from physical_zone_rules import classify_physical  # noqa: E402
DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")

# Mirror server/harnessZones.ts CAPITAL_HARNESS_ZONE
CAPITAL_HARNESS_ZONE = {
    "14014": "floor",
    "14240_RL": "rear_doors",
    "14240_RR": "rear_doors",
    "14240_FL": "front_doors",
    "14240_FR": "front_doors",
    "14241": "front_doors",
    "14242": "front_doors",
    "14243": "rear_doors",
    "14297": "front_bumper",
    "14301": "engine",
    "14324": "engine",
    "14335": "roof",
    "14401": "dashboard",
    "483_AMB": "dashboard",
    "12A690": "engine",
    "14K733": "engine",
    "14A584": "front_doors",
    "14K138": "front_doors",
    "17N400": "trunk",
    "15K857": "dashboard",
    "15K868": "dashboard",
    "15K867": "dashboard",
    "15A871": "dashboard",
    "14A280": "dashboard",
    "14B079": "dashboard",
    "14B310": "seats",
    "14B245_HV": "engine",
    "10B705": "engine",
    "10K699": "engine",
    "2C054": "engine",
    "2C055": "engine",
    "19A397": "rear_bumper",
    "PDCF_4C": "front_bumper",
    "AFBT": "front_bumper",
    "CONTROLPANEL": "dashboard",
    "TRAILER-4P": "trunk",
    "TRAILER-13P": "trunk",
    "TRAILER-7/4P": "trunk",
    "ACU Adapter": "dashboard",
    # Resolved from dominant subject codes in the netlist (see reports/home-zone-physical-fix.json)
    "INSEAT": "seats",
    "AGM-ADAPTER": "engine",
    "PSTAR2": "engine",
    "PSTAR3": "engine",
    "10C307": "engine",
    "9K499": "engine",
    "15K602": "dashboard",
    "18D274": "dashboard",
    "7A786": "floor",
    "ERAD_GROUND": "floor",
    "SPOILER_ANT": "trunk",
    "GPS HARNESS": "roof",
}

ZONE_RULES = [
    ("front_bumper", re.compile(
        r"bumper,?\s*front|front\s*bumper|бампер.*перед|передн\w*\s*бампер|washer\s*nozzle|"
        r"forward-?aimed\s*radar|\bFLC\b|\bfront\s*pas\b|front\s*parking\s*assistance|"
        r"помощ\w*\s*при\s*парковк\w*.{0,40}передн|передн.{0,40}помощ\w*\s*при\s*парковк|"
        r"parking\s*sensor\s*side",
        re.I,
    )),
    ("rear_bumper", re.compile(
        r"bumper,?\s*rear|rear\s*bumper|бампер.*зад|задн\w*\s*бампер|\brear\s*pas\b|"
        r"park\s*assist(?:ance)?\s*system\s*rear|rear\s*parking\s*assistance|"
        r"помощ\w*\s*при\s*парковк\w*.{0,40}задн|задн.{0,40}помощ\w*\s*при\s*парковк",
        re.I,
    )),
    ("trunk", re.compile(r"trunk\s*lid|tailgate|tail\s*gate|cargo|багажн|пята\w*\s*двер|fifth\s*door", re.I)),
    ("front_doors", re.compile(r"front\s*door|передн\w*.{0,24}двер|двер\w*.{0,16}передн", re.I)),
    ("rear_doors", re.compile(r"rear\s*door|задн\w*.{0,24}двер|двер\w*.{0,16}задн", re.I)),
    # Narrow engine: no bare «двигател/капот/аккумулятор»
    ("engine", re.compile(
        r"engine\s*(compartment\s*)?harness|\bengine\s*compartment\b|моторн[а-яё]*\s*отсек|"
        r"starter\s*motor|форсун|inject(?:or|ion)?|\bECM\b|alternator|generator\s*harness|"
        r"grounding\s*(?:point\s*)?engine|заземляющ[а-яё]*.{0,20}двигател",
        re.I,
    )),
    ("dashboard", re.compile(
        r"dashboard|instrument(\s*panel)?|heater\s*harness|\bheater\b|cabin|"
        r"infotainment(\s*harness)?|center\s*console|climate|салон|панел|торпед|приборн",
        re.I,
    )),
    ("floor", re.compile(r"floor|tunnel|напольн|\bпол\b|туннел|rear\s*axle|axle\s*harness", re.I)),
    ("roof", re.compile(r"\broof\b|потолк|крыш|windshield\s*module", re.I)),
    ("seats", re.compile(r"\bseat\b|сиден", re.I)),
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


ZONE_IDS = {
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
}

# Variant suffixes on Capital ids (14301B → 14301) carry the same zone.
VARIANT_SUFFIX = re.compile(r"^(\d[0-9A-Z]{2,8})[A-Z]$")


def extract_capital_id(text: str) -> str | None:
    s = (text or "").strip()
    if not s:
        return None
    if s in CAPITAL_HARNESS_ZONE:
        return s
    for hid in CAPITAL_HARNESS_ZONE:
        if re.search(rf"(?:^|[\s,;/]){re.escape(hid)}(?:$|[\s,;/])", s, re.I):
            return hid
    m = VARIANT_SUFFIX.match(s.upper())
    if m and m.group(1) in CAPITAL_HARNESS_ZONE:
        return m.group(1)
    return None


def harness_to_zone(text: str) -> str | None:
    s = (text or "").strip()
    if not s:
        return None
    # Mirror server/harnessZones.ts: a bare zone id is already the answer.
    if s in ZONE_IDS:
        return s
    cid = extract_capital_id(s)
    if cid and cid in CAPITAL_HARNESS_ZONE:
        return CAPITAL_HARNESS_ZONE[cid]
    for zid, rx in ZONE_RULES:
        if rx.search(s):
            return zid
    # Oriented door fallback only (never bare «door» → front_doors)
    if re.search(r"\bdoor|двер", s, re.I):
        return "rear_doors" if re.search(r"rear|задн", s, re.I) else "front_doors"
    return None


def pick_zone(votes: dict[str, int]) -> str:
    if not votes:
        return ""
    total = sum(votes.values())
    if total <= 0:
        return ""
    # Prefer body zones over engine when both present (boundary cables)
    body = {k: v for k, v in votes.items() if k in BODY_BIAS}
    pool = body if body else votes
    ranked = sorted(pool.items(), key=lambda kv: (-kv[1], kv[0]))
    best, best_n = ranked[0]
    # Strict majority of *all* harness votes so one boundary cable cannot win.
    if best_n * 2 <= total:
        return ""
    return best


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

    # Physical placement from the component name wins over harness majority:
    # a trunk lamp routed through the floor harness still lives in the trunk.
    physical: dict[str, str] = {}
    for code, name_ru, desc_ru, desc_en in db.execute(
        """
        SELECT component_code, IFNULL(name_ru,''), IFNULL(description_ru,''), IFNULL(description_en,'')
        FROM components
        """
    ):
        z = classify_physical(name_ru, desc_ru, desc_en)
        if z:
            physical[code] = z

    updated = 0
    for code in set(votes) | set(physical):
        zone = physical.get(code) or pick_zone(votes.get(code, {}))
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
