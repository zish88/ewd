"""
Build wiring.sqlite from Capital package only (no PDF).

Sources:
  - devices/connectors/… catalogs
  - face_view_index.json (cavities)
  - pin_wire_index.json (fallback nets)
  - lang_ru_index.json + data/vida_*.json (names/PN)
  - harness_labels.json
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ewd.paths import find_package_root, package_data_dir  # noqa: E402
from ewd.index_devices import normalize_volvo_code  # noqa: E402

CODE_RE = re.compile(r"^(\d+)/(\d+)$")

# Mirror server/harnessZones.ts CAPITAL_HARNESS_ZONE
CAPITAL_HARNESS_ZONE: dict[str, str] = {
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
    "ACU Adapter": "dashboard",
}


def _load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _type_ru(code: str, kinds: list[str]) -> str:
    fam = code.split("/")[0] if "/" in code else ""
    if "connector" in kinds or fam in ("74", "73"):
        return "Разъём"
    if "inline" in kinds:
        return "Инлайн"
    if "splice" in kinds or fam == "63":
        return "Спайка"
    if "ground" in kinds or fam == "31":
        return "Масса"
    if fam in ("15", "11"):
        return "Предохранитель / реле"
    return "Узел"


def _zone_from_label(label: str) -> str:
    blob = (label or "").lower()
    if not blob:
        return ""
    if re.search(r"задн\w*.{0,24}двер|двер\w*.{0,16}задн|rear\s*door", blob):
        return "rear_doors"
    if re.search(r"передн\w*.{0,24}двер|двер\w*.{0,16}передн|front\s*door", blob):
        return "front_doors"
    if re.search(r"бампер.*зад|rear\s*bumper", blob):
        return "rear_bumper"
    if re.search(r"бампер|washer|омывател|front\s*pas", blob):
        return "front_bumper"
    if re.search(r"напольн|\bпол\b|tunnel|туннел", blob):
        return "floor"
    if re.search(r"потолк|крыш|roof", blob):
        return "roof"
    if re.search(r"панел|приборн|dashboard|салон", blob):
        return "dashboard"
    if re.search(r"багаж|trunk|tailgate", blob):
        return "trunk"
    if re.search(r"сиден|seat", blob):
        return "seats"
    if re.search(r"двигат|моторн|engine|аккумулятор|заземля", blob):
        return "engine"
    return ""


def _zone_guess(code: str, harness: str, harness_labels: dict[str, str]) -> str:
    hid = (harness or "").strip()
    if hid in CAPITAL_HARNESS_ZONE:
        return CAPITAL_HARNESS_ZONE[hid]
    label = harness_labels.get(hid, "")
    z = _zone_from_label(label)
    if z:
        return z
    blob = f"{label} {hid}".lower()
    if any(x in blob for x in ("14240_rl", "14240_rr", "14243")):
        return "rear_doors"
    if any(x in blob for x in ("14240_fl", "14240_fr", "14241", "14242")):
        return "front_doors"
    if "14014" in blob:
        return "floor"
    if any(x in blob for x in ("14401", "приборн", "панел")):
        return "dashboard"
    if any(x in blob for x in ("14335", "потолк", "крыш")):
        return "roof"
    fam = code.split("/")[0] if "/" in code else ""
    if fam in ("8", "2"):
        return "engine"
    return ""


def _harness_stored(harness: str, harness_labels: dict[str, str], zone: str) -> str:
    """Prefer zone id (nav short-circuit); else 'label id' for regex classification."""
    hid = (harness or "").strip()
    if zone:
        return zone
    if not hid:
        return ""
    label = (harness_labels.get(hid) or "").strip()
    if label:
        return f"{label} {hid}".strip()
    return hid


def assemble(
    out_db: Path,
    ewd_data: Path,
    *,
    ewd_root: Path | None = None,
) -> dict[str, Any]:
    package = find_package_root(ewd_root)
    data_dir = package_data_dir(package)

    device = _load(ewd_data / "device_index.json")
    face = _load(ewd_data / "face_view_index.json")
    pin_wire = _load(ewd_data / "pin_wire_index.json")
    lang = _load(ewd_data / "lang_ru_index.json")
    harness_labels = (_load(ewd_data / "harness_labels.json") or {}).get("by_id") or {}
    vida_ru = (_load(ROOT / "data" / "vida_components_ru.json") or {}).get("components") or {}
    vida_pn = (_load(ROOT / "data" / "vida_connector_parts.json") or {}).get("connectors") or {}

    by_code = device.get("by_code") or {}
    lang_by = lang.get("by_code") or {}
    face_by_key = face.get("by_key") or {}
    face_by_code = face.get("by_code") or {}
    pw_by = pin_wire.get("by_code_pin") or {}

    out_db.parent.mkdir(parents=True, exist_ok=True)
    # Write to temp then replace — avoids WinError 32 when server holds the DB open
    tmp_db = out_db.with_suffix(out_db.suffix + ".tmp")
    if tmp_db.is_file():
        try:
            tmp_db.unlink()
        except OSError:
            pass
    conn = sqlite3.connect(str(tmp_db))
    conn.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE manuals (
          id INTEGER PRIMARY KEY,
          filename TEXT NOT NULL UNIQUE,
          language TEXT NOT NULL
        );
        CREATE TABLE pages (
          id INTEGER PRIMARY KEY,
          manual_id INTEGER NOT NULL REFERENCES manuals(id),
          source_page INTEGER NOT NULL DEFAULT 0,
          system_name TEXT NOT NULL DEFAULT '',
          page_type TEXT NOT NULL DEFAULT 'connector'
        );
        CREATE TABLE components (
          id INTEGER PRIMARY KEY,
          component_code TEXT NOT NULL UNIQUE,
          component_type_ru TEXT NOT NULL DEFAULT '',
          description_ru TEXT NOT NULL DEFAULT '',
          description_en TEXT NOT NULL DEFAULT '',
          name_ru TEXT NOT NULL DEFAULT '',
          part_number TEXT NOT NULL DEFAULT '',
          part_number_mate TEXT NOT NULL DEFAULT '',
          home_zone TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE wire_connections (
          id INTEGER PRIMARY KEY,
          page_id INTEGER,
          pin_number TEXT NOT NULL DEFAULT '—',
          wire_color_raw TEXT NOT NULL DEFAULT '—',
          wire_color_ru TEXT NOT NULL DEFAULT '—',
          function_text TEXT NOT NULL DEFAULT '',
          from_detail TEXT NOT NULL DEFAULT '',
          to_detail TEXT NOT NULL DEFAULT '',
          from_token TEXT NOT NULL DEFAULT '',
          to_token TEXT NOT NULL DEFAULT '',
          steering_side TEXT NOT NULL DEFAULT '',
          subject_code TEXT NOT NULL DEFAULT '',
          source_kind TEXT NOT NULL DEFAULT 'capital',
          is_verified INTEGER NOT NULL DEFAULT 1,
          requires_manual_review INTEGER NOT NULL DEFAULT 0,
          integrity_score INTEGER NOT NULL DEFAULT 90,
          from_component_id INTEGER REFERENCES components(id),
          to_component_id INTEGER REFERENCES components(id),
          via_component_id INTEGER REFERENCES components(id),
          harness_left TEXT NOT NULL DEFAULT '',
          harness_right TEXT NOT NULL DEFAULT '',
          diagram_page_id INTEGER,
          diagram_source_page INTEGER NOT NULL DEFAULT 0,
          voltage TEXT NOT NULL DEFAULT '',
          wire_gauge TEXT NOT NULL DEFAULT '',
          pin_uid TEXT NOT NULL DEFAULT '',
          wire_uid TEXT NOT NULL DEFAULT '',
          system_uid TEXT NOT NULL DEFAULT '',
          option_expression TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE component_diagram_pages (
          component_code TEXT NOT NULL,
          page_id INTEGER NOT NULL,
          source_page INTEGER NOT NULL DEFAULT 0,
          system_name TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (component_code, page_id)
        );
        CREATE INDEX wire_subject ON wire_connections(subject_code);
        CREATE INDEX wire_pin_uid ON wire_connections(pin_uid);
        CREATE TABLE pending_tickets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          model TEXT NOT NULL, year TEXT NOT NULL, engine TEXT NOT NULL,
          location_name TEXT NOT NULL, pin_number TEXT NOT NULL, wire_color TEXT NOT NULL,
          source_block TEXT NOT NULL, source_pin TEXT, destination_block TEXT NOT NULL,
          destination_pin TEXT, description TEXT NOT NULL, comment TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
        );
        """
    )
    conn.execute(
        "INSERT INTO manuals(id, filename, language) VALUES (1, ?, 'RU')",
        ("capital-39363002",),
    )
    conn.execute(
        "INSERT INTO pages(id, manual_id, source_page, system_name, page_type) VALUES (1, 1, 0, 'Capital EWD', 'connector')"
    )

    # insert components
    comp_ids: dict[str, int] = {}
    for code, rec in sorted(by_code.items()):
        if not CODE_RE.match(code):
            continue
        kinds = list(rec.get("kinds") or [])
        lr = lang_by.get(code) or {}
        name_ru = (
            str(vida_ru.get(code) or lr.get("name_ru") or lr.get("name_en") or "").strip()
        )
        name_en = str(lr.get("name_en") or "").strip()
        pn_rec = vida_pn.get(code) or {}
        pn = str(pn_rec.get("part_number") or "").strip()
        pn_mate = str(pn_rec.get("part_number_mate") or "").strip()
        # zone from first face/pin harness later
        home = ""
        cur = conn.execute(
            """INSERT INTO components(
                 component_code, component_type_ru, description_ru, description_en,
                 name_ru, part_number, part_number_mate, home_zone)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                code,
                _type_ru(code, kinds),
                name_ru,
                name_en,
                name_ru,
                pn,
                pn_mate,
                home,
            ),
        )
        comp_ids[code] = int(cur.lastrowid)

    # Build wire rows from face_view by_key (soft keys code|cavity)
    wire_count = 0
    seen_wire: set[str] = set()
    for key, edges in face_by_key.items():
        parts = key.split("|")
        if len(parts) < 2:
            continue
        code, cavity = parts[0], parts[1]
        if len(parts) == 3:
            # hard key — skip duplicates of soft
            continue
        if code not in comp_ids:
            continue
        for e in edges:
            pin_uid = e.get("pinUid") or ""
            wire_uid = e.get("wireUid") or ""
            peer = e.get("peerCode") or ""
            peer_pin = e.get("peerPin") or ""
            color = (e.get("color") or "—").replace("/", "-") or "—"
            sig = f"{code}|{cavity}|{wire_uid}|{peer}|{color}"
            if sig in seen_wire:
                continue
            seen_wire.add(sig)
            from_id = comp_ids.get(code)
            to_id = comp_ids.get(peer) if peer in comp_ids else None
            harness = e.get("harness") or ""
            # enrich harness from pin_wire if missing
            if not harness:
                for pe in pw_by.get(f"{code}|{cavity}") or []:
                    if pe.get("harness"):
                        harness = pe["harness"]
                        break
            zone = _zone_guess(code, harness, harness_labels)
            if zone:
                conn.execute(
                    "UPDATE components SET home_zone=? WHERE component_code=? AND (home_zone='' OR home_zone IS NULL)",
                    (zone, code),
                )
            harness_left = _harness_stored(harness, harness_labels, zone)
            from_detail = f"{code}:{cavity}"
            to_detail = f"{peer}:{peer_pin}" if peer else (e.get("wireName") or "")
            conn.execute(
                """INSERT INTO wire_connections(
                     page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
                     from_detail, to_detail, subject_code, source_kind, is_verified,
                     integrity_score, from_component_id, to_component_id,
                     harness_left, wire_gauge, pin_uid, wire_uid, system_uid, option_expression)
                   VALUES (1,?,?,?,?,?,?,?,'capital',1,95,?,?,?,?,?,?,?,?)""",
                (
                    cavity,
                    color,
                    color,
                    e.get("wireName") or "",
                    from_detail,
                    to_detail,
                    code,
                    from_id,
                    to_id,
                    harness_left,
                    e.get("gauge") or "",
                    pin_uid,
                    wire_uid,
                    e.get("systemUid") or e.get("designUid") or "",
                    e.get("optionExpression") or "",
                ),
            )
            wire_count += 1

    # Fallback: pin_wire edges for codes with no faceview pins
    for key, edges in pw_by.items():
        parts = key.split("|")
        if len(parts) != 2:
            continue
        code, cavity = parts
        if code not in comp_ids:
            continue
        if any(k.startswith(f"{code}|{cavity}") for k in face_by_key):
            continue
        for e in edges[:8]:
            pin_uid = e.get("pinUid") or ""
            wire_uid = e.get("wireUid") or ""
            peer = e.get("peerCode") or ""
            color = (e.get("color") or "—").replace("/", "-") or "—"
            sig = f"{code}|{cavity}|{wire_uid}|{peer}|{color}|pw"
            if sig in seen_wire:
                continue
            seen_wire.add(sig)
            pw_harness = e.get("harness") or ""
            pw_zone = _zone_guess(code, pw_harness, harness_labels)
            if pw_zone:
                conn.execute(
                    "UPDATE components SET home_zone=? WHERE component_code=? AND (home_zone='' OR home_zone IS NULL)",
                    (pw_zone, code),
                )
            conn.execute(
                """INSERT INTO wire_connections(
                     page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
                     from_detail, to_detail, subject_code, source_kind, is_verified,
                     integrity_score, from_component_id, to_component_id,
                     harness_left, wire_gauge, pin_uid, wire_uid, system_uid, option_expression)
                   VALUES (1,?,?,?,?,?,?,?,'capital_pw',1,80,?,?,?,?,?,?,?,?)""",
                (
                    cavity,
                    color,
                    color,
                    e.get("wireName") or "",
                    f"{code}:{cavity}",
                    f"{peer}:{e.get('peerPin') or ''}" if peer else "",
                    code,
                    comp_ids.get(code),
                    comp_ids.get(peer),
                    _harness_stored(pw_harness, harness_labels, pw_zone),
                    e.get("gauge") or "",
                    pin_uid,
                    wire_uid,
                    e.get("systemUid") or "",
                    e.get("optionExpression") or "",
                ),
            )
            wire_count += 1

    # component_diagram_pages from device diagramUids (synthetic page ids unused)
    # Store system linkage via description — keep empty table OK for nav badges
    conn.commit()
    conn.close()
    try:
        if out_db.is_file():
            out_db.unlink()
        tmp_db.replace(out_db)
        final_path = out_db
    except OSError:
        # Locked: keep capital DB beside the live file
        final_path = out_db.with_name("wiring.capital.sqlite")
        if final_path.is_file():
            try:
                final_path.unlink()
            except OSError:
                pass
        tmp_db.replace(final_path)
        print(f"WARN: {out_db} locked — wrote {final_path}", flush=True)
    stats = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "package": str(package),
        "data_dir": str(data_dir),
        "components": len(comp_ids),
        "wires": wire_count,
        "face_codes": len(face_by_code),
        "db": str(final_path),
    }
    return stats


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    import argparse

    ap = argparse.ArgumentParser(description="Assemble wiring.sqlite from Capital EWD")
    ap.add_argument("--ewd-root", default=None)
    ap.add_argument("--ewd-data", default=str(ROOT / "data" / "ewd"))
    ap.add_argument("--out", default=str(ROOT / "data" / "wiring.sqlite"))
    args = ap.parse_args()
    stats = assemble(
        Path(args.out),
        Path(args.ewd_data),
        ewd_root=Path(args.ewd_root) if args.ewd_root else None,
    )
    report = ROOT / "data" / "assemble_capital_report.json"
    report.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"Wrote {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
