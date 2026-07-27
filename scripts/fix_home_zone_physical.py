"""Align components.home_zone with physical placement (name-based), project-wide.

Priority:
  1. Component naming (RU/EN) -> physical zone  [authoritative]
  2. Harness majority                            [fallback for unnamed nodes]

Usage:
  python scripts/fix_home_zone_physical.py            # dry-run + report
  python scripts/fix_home_zone_physical.py --apply    # write wiring.sqlite
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from backfill_home_zone import harness_to_zone, pick_zone  # noqa: E402
from physical_zone_rules import classify_physical_traced  # noqa: E402

DB = ROOT / "data" / "wiring.sqlite"
REPORT = ROOT / "data" / "reports" / "home-zone-physical-fix.json"


def harness_votes(cur: sqlite3.Cursor) -> dict[str, Counter]:
    """Same voting model as backfill_home_zone: owner wires weigh more."""
    votes: dict[str, Counter] = {}
    for subj, hl, hr in cur.execute(
        """
        SELECT TRIM(IFNULL(subject_code,'')), IFNULL(harness_left,''), IFNULL(harness_right,'')
        FROM wire_connections
        WHERE TRIM(IFNULL(subject_code,'')) != ''
        """
    ):
        bucket = votes.setdefault(subj, Counter())
        for h in (hl, hr):
            z = harness_to_zone(h)
            if z:
                bucket[z] += 3
    for code, hl, hr in cur.execute(
        """
        SELECT c.component_code, IFNULL(w.harness_left,''), IFNULL(w.harness_right,'')
        FROM wire_connections w
        JOIN components c ON c.id IN (w.from_component_id, w.to_component_id, w.via_component_id)
        WHERE TRIM(IFNULL(w.harness_left,'')) != '' OR TRIM(IFNULL(w.harness_right,'')) != ''
        """
    ):
        bucket = votes.setdefault(code, Counter())
        for h in (hl, hr):
            z = harness_to_zone(h)
            if z:
                bucket[z] += 1
    return votes


def majority(counter: Counter) -> str:
    return pick_zone(dict(counter))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes to sqlite")
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    votes = harness_votes(cur)
    rows = cur.execute(
        """
        SELECT id, component_code, IFNULL(home_zone,'') AS home_zone,
               IFNULL(name_ru,'') AS name_ru,
               IFNULL(description_ru,'') AS description_ru,
               IFNULL(description_en,'') AS description_en,
               IFNULL(component_type_ru,'') AS type_ru
        FROM components
        ORDER BY component_code
        """
    ).fetchall()

    changes: list[dict] = []
    kept_conflicts: list[dict] = []
    before = Counter(r["home_zone"] or "(empty)" for r in rows)

    for r in rows:
        code = r["component_code"]
        home = (r["home_zone"] or "").strip()
        hit = classify_physical_traced(r["name_ru"], r["description_ru"], r["description_en"])
        physical, rule = (hit if hit else (None, ""))
        maj = majority(votes.get(code) or Counter())

        target = physical or (maj if not home else "")
        if not target or target == home:
            if physical and maj and physical != maj:
                kept_conflicts.append(
                    {
                        "code": code,
                        "home_zone": home,
                        "physical": physical,
                        "harness_majority": maj,
                        "name": (r["name_ru"] or r["description_en"])[:70],
                    }
                )
            continue

        changes.append(
            {
                "code": code,
                "from": home or "(empty)",
                "to": target,
                "reason": "physical-name" if physical else "harness-majority",
                "rule": rule,
                "harness_majority": maj,
                "name": (r["name_ru"] or r["description_en"])[:70],
            }
        )
        if args.apply:
            cur.execute("UPDATE components SET home_zone = ? WHERE id = ?", (target, r["id"]))

    if args.apply:
        con.commit()

    after = Counter(
        (row[0] or "(empty)")
        for row in cur.execute("SELECT IFNULL(home_zone,'') FROM components")
    )

    report = {
        "applied": bool(args.apply),
        "components": len(rows),
        "changes": len(changes),
        "by_reason": dict(Counter(c["reason"] for c in changes)),
        "by_target_zone": dict(Counter(c["to"] for c in changes)),
        "before_counts": dict(before),
        "after_counts": dict(after),
        "conflicts_physical_vs_harness": len(kept_conflicts),
        "changes_list": changes,
        "conflicts_list": kept_conflicts[:200],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "applied": report["applied"],
                "changes": report["changes"],
                "by_reason": report["by_reason"],
                "by_target_zone": report["by_target_zone"],
                "after_counts": report["after_counts"],
                "conflicts": report["conflicts_physical_vs_harness"],
                "report": str(REPORT),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
