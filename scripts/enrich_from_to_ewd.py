#!/usr/bin/env python3
"""Fill empty from_detail/to_detail from multi-device EWD connectivity (skip tautologies)."""
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
EWD_ROOT = Path(
    os.environ.get("EWD_SOURCE_DIR") or ROOT / "data" / "ewd" / "ewd_source" / "39363002" / "1" / "2"
)
CODE_RE = re.compile(r"^(\d+)/(\d+)", re.I)


def norm_code(raw: str) -> str:
    m = CODE_RE.match(str(raw or "").strip())
    return f"{m.group(1)}/{m.group(2)}" if m else ""


def pin_tail(raw: str) -> str:
    s = str(raw or "").strip()
    m = re.search(r"(\d+)\s*$", s)
    return m.group(1) if m else s


def norm_color(raw: str) -> str:
    return str(raw or "").upper().replace("/", "-").replace(" ", "").strip()


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if not DB_PATH.is_file() or not EWD_ROOT.is_dir():
        print("ERROR: need wiring.sqlite and EWD Signals tree", file=sys.stderr)
        return 1

    db = sqlite3.connect(str(DB_PATH))
    need_codes = {
        r[0]
        for r in db.execute(
            """
            SELECT DISTINCT TRIM(subject_code)
            FROM wire_connections
            WHERE TRIM(IFNULL(subject_code,'')) != ''
              AND (TRIM(IFNULL(from_detail,'')) = '' OR TRIM(IFNULL(to_detail,'')) = '')
            """
        )
        if r[0]
    }
    print(f"codes needing details: {len(need_codes)}")

    # (code, pin, color) -> (from_detail, to_detail)
    peer_map: dict[tuple[str, str, str], tuple[str, str]] = {}
    peer_pin: dict[tuple[str, str], tuple[str, str]] = {}

    files = iter_connectivity_files(EWD_ROOT)
    scanned = 0
    used = 0
    for path in files:
        scanned += 1
        try:
            rec = parse_connectivity_bytes(read_connectivity_xml(path), path.name)
        except Exception:
            continue
        devices = rec.get("devices") or []
        codes_in_file = {norm_code(d.get("code") or d.get("name") or "") for d in devices}
        codes_in_file.discard("")
        # Skip cavity-only single-device files
        if len(codes_in_file) < 2:
            continue
        if not (codes_in_file & need_codes):
            continue
        used += 1
        pin_by_id: dict[str, tuple[str, str, str]] = {}
        for d in devices:
            code = norm_code(d.get("code") or d.get("name") or "")
            label = str(d.get("ServiceDescription") or d.get("name") or code).strip()
            # Prefer "code — name" when ServiceDescription is useful
            short = str(d.get("ServiceDescription") or "").strip()
            if short and not re.fullmatch(r"\{?\d+/\d+\}?", short):
                display = f"{code} — {short}" if code else short
            else:
                display = code
            for p in d.get("pins") or []:
                pid = p.get("id") or ""
                pin = pin_tail(p.get("PPIN") or p.get("name") or "")
                if pid:
                    pin_by_id[pid] = (code, pin, display)
        for w in rec.get("wires") or []:
            color = norm_color(w.get("wirecolor") or "")
            refs = list(w.get("pinrefs") or [])
            start = w.get("startpinref") or ""
            if start and start not in refs:
                refs = [start, *refs]
            if len(refs) < 2:
                continue
            a = pin_by_id.get(refs[0])
            b = pin_by_id.get(refs[1])
            if not a or not b:
                continue
            ca, pa, da = a
            cb, pb, db_ = b
            if not ca or not cb or ca == cb:
                continue
            from_d = f"{ca}:{pa}" if pa else ca
            to_d = f"{cb}:{pb}" if pb else cb
            # Prefer display with description
            if "—" in da:
                from_d = f"{ca}:{pa} — {da.split('—', 1)[-1].strip()}" if pa else da
            if "—" in db_:
                to_d = f"{cb}:{pb} — {db_.split('—', 1)[-1].strip()}" if pb else db_
            for code, pin in ((ca, pa), (cb, pb)):
                if code not in need_codes or not pin:
                    continue
                # Orient detail: subject side first
                if code == ca:
                    pair = (from_d, to_d)
                else:
                    pair = (to_d, from_d)
                if color:
                    peer_map.setdefault((code, pin, color), pair)
                peer_pin.setdefault((code, pin), pair)
        if scanned % 500 == 0:
            print(f"… scanned {scanned}/{len(files)} used_multi={used} keys={len(peer_map)}")

    updated = 0
    for wid, subj, pin, color, fd, td in db.execute(
        """
        SELECT id, TRIM(IFNULL(subject_code,'')), TRIM(IFNULL(pin_number,'')),
               UPPER(REPLACE(REPLACE(IFNULL(wire_color_raw,''),'/', '-'), ' ', '')),
               IFNULL(from_detail,''), IFNULL(to_detail,'')
        FROM wire_connections
        WHERE TRIM(IFNULL(subject_code,'')) != ''
          AND (TRIM(IFNULL(from_detail,'')) = '' OR TRIM(IFNULL(to_detail,'')) = '')
        """
    ):
        pin_n = pin_tail(pin)
        if not subj or not pin_n:
            continue
        pair = peer_map.get((subj, pin_n, color)) or peer_pin.get((subj, pin_n))
        if not pair:
            continue
        sets = []
        args: list = []
        if not str(fd or "").strip():
            sets.append("from_detail = ?")
            args.append(pair[0][:400])
        if not str(td or "").strip():
            sets.append("to_detail = ?")
            args.append(pair[1][:400])
        if not sets:
            continue
        args.append(wid)
        db.execute(f"UPDATE wire_connections SET {', '.join(sets)} WHERE id = ?", args)
        updated += 1

    db.commit()
    empty = db.execute(
        """
        SELECT COUNT(*) FROM wire_connections
        WHERE TRIM(IFNULL(from_detail,'')) = '' OR TRIM(IFNULL(to_detail,'')) = ''
        """
    ).fetchone()[0]
    db.close()
    print(
        f"from_to_ewd ok: scanned={scanned} multi_used={used} map={len(peer_map)} "
        f"updated={updated} still_empty_detail_rows={empty}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
