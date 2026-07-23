"""
One-shot patch: refresh page_id / diagram_* / harness_* / component_diagram_pages
from Stage-2 JSON without re-parsing PDFs.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys

DB_PATH = os.path.join("data", "wiring.sqlite")
STAGE2_DIR = os.path.join("data", "stage2")

# Reuse assemble helpers when available
sys.path.insert(0, os.path.dirname(__file__))
try:
    from assemble_wiring_db import resolve_diagram_page, token_component
except ImportError:
    def token_component(tok: str) -> str:
        m = re.match(r"^(\d+)/(\d+)", str(tok or "").strip(), re.I)
        return f"{m.group(1)}/{m.group(2)}" if m else ""

    def resolve_diagram_page(from_token, to_token, from_node, to_node, diagram_tokens, diagram_components, page_ids):
        a = diagram_tokens.get(from_token.upper(), set()) if from_token else set()
        b = diagram_tokens.get(to_token.upper(), set()) if to_token else set()
        for group in (a & b, a | b):
            for book, page in sorted(group):
                if page:
                    pid = page_ids.get((book, page)) or page_ids.get(("EN", page))
                    if pid:
                        return pid, page
        for raw in (from_node, to_node, token_component(from_token), token_component(to_token)):
            m = re.match(r"^(\d+)/(\d+)", str(raw or "").strip(), re.I)
            if not m:
                continue
            code = f"{m.group(1)}/{m.group(2)}".upper()
            for book, page in sorted(diagram_components.get(code, set())):
                pid = page_ids.get((book, page)) or page_ids.get(("EN", page))
                if pid:
                    return pid, page
        return None, 0


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--stage2", default=STAGE2_DIR)
    args = ap.parse_args()

    conn_path = os.path.join(args.stage2, "connector_circuits.json")
    diag_path = os.path.join(args.stage2, "diagram_records.json")
    if not os.path.isfile(args.db) or not os.path.isfile(conn_path):
        print("ERROR: need wiring.sqlite + connector_circuits.json", file=sys.stderr)
        return 1

    with open(conn_path, encoding="utf-8") as f:
        circuits = json.load(f).get("circuits") or []
    diagrams = []
    if os.path.isfile(diag_path):
        with open(diag_path, encoding="utf-8") as f:
            diagrams = json.load(f).get("records") or []

    diagram_tokens: dict[str, set[tuple[str, int]]] = {}
    diagram_components: dict[str, set[tuple[str, int]]] = {}
    for r in diagrams:
        book = r.get("book", "")
        page = int(r.get("page") or 0)
        loc = (book, page)
        tok = str(r.get("token") or "")
        if ":" in tok:
            diagram_tokens.setdefault(tok.upper(), set()).add(loc)
        code = str(r.get("component_code") or token_component(tok)).strip()
        if code:
            diagram_components.setdefault(code.upper(), set()).add(loc)

    db = sqlite3.connect(args.db)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS component_diagram_pages (
          component_code TEXT NOT NULL,
          page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
          source_page INTEGER NOT NULL,
          system_name TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (component_code, page_id)
        )
        """
    )
    cols = {r[1] for r in db.execute("PRAGMA table_info(wire_connections)")}
    for col, ddl in [
        ("harness_left", "ALTER TABLE wire_connections ADD COLUMN harness_left TEXT NOT NULL DEFAULT ''"),
        ("harness_right", "ALTER TABLE wire_connections ADD COLUMN harness_right TEXT NOT NULL DEFAULT ''"),
        ("diagram_page_id", "ALTER TABLE wire_connections ADD COLUMN diagram_page_id INTEGER"),
        ("diagram_source_page", "ALTER TABLE wire_connections ADD COLUMN diagram_source_page INTEGER NOT NULL DEFAULT 0"),
    ]:
        if col not in cols:
            db.execute(ddl)

    page_ids: dict[tuple[str, int], int] = {}
    page_titles: dict[int, str] = {}
    for lang, sp, pid, title in db.execute(
        "SELECT m.language, p.source_page, p.id, p.system_name FROM pages p JOIN manuals m ON m.id = p.manual_id"
    ):
        page_ids[(lang, int(sp))] = int(pid)
        page_ids[("EN", int(sp))] = int(pid)
        page_titles[int(pid)] = title or ""

    db.execute("DELETE FROM component_diagram_pages")
    cdp = 0
    for code_u, locs in diagram_components.items():
        m = re.match(r"^(\d+)/(\d+)", code_u, re.I)
        display = f"{m.group(1)}/{m.group(2)}" if m else code_u
        for book, page in locs:
            pid = page_ids.get((book, page)) or page_ids.get(("EN", page))
            if not pid:
                continue
            try:
                db.execute(
                    "INSERT INTO component_diagram_pages(component_code, page_id, source_page, system_name) VALUES (?,?,?,?)",
                    (display, pid, page, page_titles.get(pid, "")[:120]),
                )
                cdp += 1
            except sqlite3.IntegrityError:
                pass

    wires = list(db.execute("SELECT id, from_token, to_token, pin_number, subject_code FROM wire_connections"))
    by_key: dict[tuple[str, str, str, str], list[int]] = {}
    for wid, ft, tt, pin, subj in wires:
        by_key.setdefault((str(ft or ""), str(tt or ""), str(pin or ""), str(subj or "")), []).append(int(wid))

    updated = 0
    for c in circuits:
        book = c.get("book", "EN")
        page = int(c.get("page") or 0)
        page_id = page_ids.get((book, page)) or page_ids.get(("EN", page))
        if not page_id:
            continue
        from_token = c.get("from_token") or ""
        to_token = c.get("to_token") or ""
        from_node = c.get("from_node") or ""
        to_node = c.get("to_node") or ""
        pin = str(c.get("pin_number") or "")
        owner = c.get("owner_connector") or ""
        ids = by_key.get((from_token, to_token, pin, owner)) or []
        if not ids:
            continue
        diag_pid, diag_page = resolve_diagram_page(
            from_token, to_token, from_node, to_node, diagram_tokens, diagram_components, page_ids
        )
        hl = str(c.get("harness_left") or "").strip()
        hr = str(c.get("harness_right") or "").strip()
        for wid in ids:
            db.execute(
                """
                UPDATE wire_connections
                SET page_id = ?,
                    harness_left = CASE WHEN ? != '' THEN ? ELSE harness_left END,
                    harness_right = CASE WHEN ? != '' THEN ? ELSE harness_right END,
                    diagram_page_id = ?,
                    diagram_source_page = ?,
                    is_verified = CASE WHEN ? > 0 THEN 1 ELSE is_verified END
                WHERE id = ?
                """,
                (page_id, hl, hl, hr, hr, diag_pid, diag_page, diag_page, wid),
            )
            updated += 1

    db.commit()
    db.close()
    print(f"Patched {updated} wires; component_diagram_pages={cdp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
