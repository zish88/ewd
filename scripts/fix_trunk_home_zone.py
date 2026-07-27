"""Reassign home_zone to trunk for physically trunk/tailgate components.

1) Name/description says багажник/tailgate/cargo/tow hitch/rear plate/camera
2) Generic connectors whose harness majority is trunk
"""
from __future__ import annotations

import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "wiring.sqlite"

TRUNK_NAME = re.compile(
    r"багажн|хвостов|буксирн|tow\s*hitch|trailer|tailgate|trunk\s*lid|cargo\s*compartment|"
    r"пята\w*\s*двер|rear\s*window\s*wiper|задн\w*\s*стеклоочист|"
    r"license\s*plate|номерн\w*\s*знак|heated\s*rear\s*window|подогрев\s*задн\w*\s*стекл|"
    r"\bcamera\b|камер",
    re.I,
)

# Wrongly pulled into trunk by earlier overly broad «подогрев задн…» / seat names.
SEAT_FALSE_TRUNK = re.compile(r"сиден|seat\b", re.I)

GENERIC_CONNECTOR = re.compile(r"^(контактный\s*разъ[её]м|connector)\b", re.I)

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


def main() -> None:
    con = sqlite3.connect(DB)
    cur = con.cursor()

    votes: dict[str, Counter[str]] = {}
    for subj, hl, hr in cur.execute(
        """
        SELECT IFNULL(subject_code,''), IFNULL(harness_left,''), IFNULL(harness_right,'')
        FROM wire_connections
        WHERE TRIM(IFNULL(subject_code,'')) != ''
        """
    ):
        bucket = votes.setdefault(subj, Counter())
        for h in (hl, hr):
            s = (h or "").strip()
            if not s:
                continue
            if s in ZONE_IDS:
                bucket[s] += 1
            elif s in ("TRAILER-13P", "TRAILER-7/4P", "TRAILER-4P", "17N400"):
                bucket["trunk"] += 1

    rows = cur.execute(
        """
        SELECT id, component_code, IFNULL(home_zone,''), IFNULL(name_ru,''),
               IFNULL(description_en,''), IFNULL(description_ru,'')
        FROM components
        """
    ).fetchall()

    updates: list[tuple[str, str, str, str]] = []
    for cid, code, home, name_ru, en, ru in rows:
        blob = f"{name_ru} {en} {ru}"
        # Undo false trunk for seats
        if home == "trunk" and SEAT_FALSE_TRUNK.search(blob) and not re.search(r"багажн|tailgate|trunk|cargo", blob, re.I):
            cur.execute("UPDATE components SET home_zone = 'seats' WHERE id = ?", (cid,))
            updates.append((code, "trunk", "revert-seats", name_ru or en))
            continue
        if home == "trunk":
            continue
        reason = ""
        if TRUNK_NAME.search(blob) and not SEAT_FALSE_TRUNK.search(blob):
            reason = "name"
        else:
            v = votes.get(code) or Counter()
            total = sum(v.values())
            trunk_n = v.get("trunk", 0)
            title = (name_ru or en or "").strip()
            if total > 0 and trunk_n * 2 > total and GENERIC_CONNECTOR.search(title):
                reason = "harness-majority-connector"
            elif total > 0 and trunk_n * 2 > total and not home:
                reason = "harness-majority-empty"
        if not reason:
            continue
        updates.append((code, home or "(empty)", reason, name_ru or en))
        cur.execute("UPDATE components SET home_zone = 'trunk' WHERE id = ?", (cid,))

    con.commit()
    print(f"updated {len(updates)}")
    for u in updates:
        print(f"  {u[0]}: {u[1]} -> trunk [{u[2]}] | {u[3][:70]}")
    counts = cur.execute(
        "SELECT home_zone, COUNT(*) FROM components GROUP BY home_zone ORDER BY COUNT(*) DESC"
    ).fetchall()
    print("by home_zone:", counts)
    con.close()


if __name__ == "__main__":
    main()
