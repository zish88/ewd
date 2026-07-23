#!/usr/bin/env python3
"""Enrich wiring.sqlite from stage2 connector_circuits.json + page titles.

Fills harness_*, subject_code, from/to details when missing; rebuilds
component_diagram_pages via patch_wire_page_links when possible.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")
CIRCUITS = os.path.join(ROOT, "data", "stage2", "connector_circuits.json")

SUBJECT_RE = re.compile(
    r"(?:Connector|Разъем|Разъём)\s+(\d+\s*/\s*\d+[A-Za-z]?)",
    re.I,
)


def norm_code(raw: str) -> str:
    m = re.match(r"(\d+)\s*/\s*(\d+)([A-Za-z]?)", str(raw or "").strip())
    if not m:
        return str(raw or "").strip()
    return f"{m.group(1)}/{m.group(2)}{m.group(3).upper()}"


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if not os.path.isfile(DB_PATH) or not os.path.isfile(CIRCUITS):
        print("ERROR: need data/wiring.sqlite and data/stage2/connector_circuits.json", file=sys.stderr)
        return 1

    with open(CIRCUITS, encoding="utf-8") as f:
        circuits = json.load(f).get("circuits") or []

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # Map (owner, pin) -> best circuit (prefer ones with harness)
    by_owner_pin: dict[tuple[str, str], dict] = {}
    by_page_pin: dict[tuple[int, str], dict] = {}
    for c in circuits:
        owner = norm_code(c.get("owner_connector") or "")
        pin = str(c.get("pin_number") or "").strip()
        page = int(c.get("page") or 0)
        if not owner or not pin:
            continue
        key = (owner, pin)
        prev = by_owner_pin.get(key)
        if not prev:
            by_owner_pin[key] = c
        else:
            prev_h = bool(str(prev.get("harness_left") or "").strip() or str(prev.get("harness_right") or "").strip())
            cur_h = bool(str(c.get("harness_left") or "").strip() or str(c.get("harness_right") or "").strip())
            if cur_h and not prev_h:
                by_owner_pin[key] = c
        if page > 0:
            by_page_pin[(page, pin)] = c

    wires = list(
        db.execute(
            """
            SELECT w.id, IFNULL(w.subject_code,'') AS subject_code, IFNULL(w.pin_number,'') AS pin_number,
                   IFNULL(w.harness_left,'') AS harness_left, IFNULL(w.harness_right,'') AS harness_right,
                   IFNULL(w.from_detail,'') AS from_detail, IFNULL(w.to_detail,'') AS to_detail,
                   IFNULL(w.from_token,'') AS from_token, IFNULL(w.to_token,'') AS to_token,
                   p.system_name, p.page_type, p.source_page
            FROM wire_connections w
            JOIN pages p ON p.id = w.page_id
            """
        )
    )

    updated_h = 0
    updated_subj = 0
    updated_det = 0

    for w in wires:
        wid = int(w["id"])
        subj = norm_code(w["subject_code"])
        pin = str(w["pin_number"] or "").strip()
        page = int(w["source_page"] or 0)

        # Backfill subject from connector page title
        if not subj:
            m = SUBJECT_RE.search(str(w["system_name"] or ""))
            if m:
                subj = norm_code(m.group(1))
                db.execute("UPDATE wire_connections SET subject_code = ? WHERE id = ?", (subj, wid))
                updated_subj += 1

        c = by_owner_pin.get((subj, pin)) if subj and pin else None
        if not c and page and pin:
            c = by_page_pin.get((page, pin))
        if not c:
            continue

        hl = str(c.get("harness_left") or "").strip()
        hr = str(c.get("harness_right") or "").strip()
        fd = str(c.get("from_detail") or "").strip()
        td = str(c.get("to_detail") or "").strip()
        ft = str(c.get("from_token") or "").strip()
        tt = str(c.get("to_token") or "").strip()

        sets = []
        args: list = []
        if hl and not str(w["harness_left"] or "").strip():
            sets.append("harness_left = ?")
            args.append(hl)
        if hr and not str(w["harness_right"] or "").strip():
            sets.append("harness_right = ?")
            args.append(hr)
        if sets:
            updated_h += 1
        if fd and not str(w["from_detail"] or "").strip():
            sets.append("from_detail = ?")
            args.append(fd)
            updated_det += 1
        if td and not str(w["to_detail"] or "").strip():
            sets.append("to_detail = ?")
            args.append(td)
        if ft and not str(w["from_token"] or "").strip():
            sets.append("from_token = ?")
            args.append(ft)
        if tt and not str(w["to_token"] or "").strip():
            sets.append("to_token = ?")
            args.append(tt)
        if not str(w["subject_code"] or "").strip() and subj:
            sets.append("subject_code = ?")
            args.append(subj)
        if sets:
            args.append(wid)
            db.execute(f"UPDATE wire_connections SET {', '.join(sets)} WHERE id = ?", args)

    # Infer harness for remaining empty wires from page/system text keywords
    ZONE_HARNESS = [
        (re.compile(r"front\s*door|передн\w*\s*двер", re.I), "Harness front door", "Dashboard harness"),
        (re.compile(r"rear\s*door|задн\w*\s*двер", re.I), "Harness rear door", "Floor harness"),
        (re.compile(r"bumper,?\s*front|front\s*bumper|передн\w*\s*бампер|parking\s*assistance", re.I), "Harness bumper, front", "Engine compartment harness"),
        (re.compile(r"bumper,?\s*rear|rear\s*bumper|задн\w*\s*бампер", re.I), "Harness bumper, rear", "Floor harness"),
        (re.compile(r"trunk|tailgate|багаж", re.I), "Trunk lid harness", "Floor harness"),
        (re.compile(r"\broof\b|крыш", re.I), "Roof harness", "Dashboard harness"),
        (re.compile(r"\bseat\b|сиден", re.I), "Seat harness", "Floor harness"),
        (re.compile(r"engine|мотор|compartment", re.I), "Engine compartment harness", "Engine compartment harness"),
        (re.compile(r"dashboard|instrument|салон|панел", re.I), "Dashboard harness", "Floor harness"),
        (re.compile(r"floor|tunnel|пол|туннел", re.I), "Floor harness", "Floor harness"),
    ]

    inferred = 0
    for w in db.execute(
        """
        SELECT w.id, p.system_name, IFNULL(w.function_text,'') AS function_text,
               IFNULL(w.from_detail,'') AS from_detail, IFNULL(w.to_detail,'') AS to_detail
        FROM wire_connections w
        JOIN pages p ON p.id = w.page_id
        WHERE TRIM(IFNULL(w.harness_left,'')) = '' AND TRIM(IFNULL(w.harness_right,'')) = ''
        """
    ):
        blob = f"{w['system_name']} {w['function_text']} {w['from_detail']} {w['to_detail']}"
        for rx, hl, hr in ZONE_HARNESS:
            if rx.search(blob):
                db.execute(
                    "UPDATE wire_connections SET harness_left = ?, harness_right = ? WHERE id = ?",
                    (hl, hr, int(w["id"])),
                )
                inferred += 1
                break

    db.commit()

    harness_n = db.execute(
        "SELECT COUNT(*) FROM wire_connections WHERE TRIM(IFNULL(harness_left,''))!='' OR TRIM(IFNULL(harness_right,''))!=''"
    ).fetchone()[0]
    subj_n = db.execute(
        "SELECT COUNT(*) FROM wire_connections WHERE TRIM(IFNULL(subject_code,''))!=''"
    ).fetchone()[0]
    cdp_n = db.execute("SELECT COUNT(*) FROM component_diagram_pages").fetchone()[0]
    db.close()

    print(
        f"enrich ok: harness_from_stage2={updated_h} subject_backfill={updated_subj} "
        f"details={updated_det} harness_inferred={inferred} "
        f"totals harness={harness_n} subject={subj_n} cdp={cdp_n}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
