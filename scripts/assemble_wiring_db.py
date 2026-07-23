"""
Stage 3 — Assemble normalized SQLite from Stage-2 JSON + Stage-1 manifest.

Cross-verifies connector circuits against diagram pin tokens.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

# Allow `from diagram_titles` / `from vida_extractor` when run as script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diagram_titles import format_diagram_title, is_non_diagram_reference_title  # noqa: E402
from vida_extractor import clean_vida_component_name  # noqa: E402

MANUALS_DIR = os.environ.get("MANUAL_DIR", r"E:\manual")
DB_PATH = os.path.join("data", "wiring.sqlite")
MANIFEST_PATH = os.path.join("data", "book_manifest.json")
STAGE2_DIR = os.path.join("data", "stage2")
DIAGRAM_TITLES_PATH = os.path.join("data", "diagram_titles.json")

COMPONENT_TYPE_RU = {
    1: "Аккумулятор",
    2: "Реле",
    3: "Выключатель/Кнопка",
    4: "Модуль управления",
    5: "Приборная панель",
    6: "Электромотор",
    7: "Датчик",
    10: "Лампа/Освещение",
    11: "Предохранитель",
    15: "Блок предохранителей/Шина",
    16: "Звук/Гудок",
    31: "Точка Массы (Ground)",
    73: "Точка разветвления (Сплайс)",
    74: "Промежуточный разъем жгута",
}

MANIFEST_TO_DB_PAGE_TYPE = {
    "wiring_diagram": "diagram",
    "connector_pinout": "connector",
    "fuse_specification": "fuses",
    "component_location": "locations",
    "toc": "diagram",
    "reference_table": "reference",
    "index": "reference",
}

DDL = """
PRAGMA foreign_keys = ON;
DROP TABLE IF EXISTS wire_connections;
DROP TABLE IF EXISTS component_diagram_pages;
DROP TABLE IF EXISTS components;
DROP TABLE IF EXISTS pages;
DROP TABLE IF EXISTS manuals;

CREATE TABLE manuals (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK(language IN ('EN', 'RU'))
);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  manual_id INTEGER NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
  source_page INTEGER NOT NULL,
  system_name TEXT NOT NULL DEFAULT '',
  page_type TEXT NOT NULL DEFAULT 'diagram'
    CHECK(page_type IN ('diagram', 'fuses', 'locations', 'connector', 'reference')),
  UNIQUE(manual_id, source_page)
);

CREATE TABLE components (
  id INTEGER PRIMARY KEY,
  component_code TEXT NOT NULL UNIQUE,
  component_type_ru TEXT NOT NULL DEFAULT '',
  description_ru TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  name_ru TEXT NOT NULL DEFAULT '',
  part_number TEXT NOT NULL DEFAULT '',
  home_zone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE wire_connections (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
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
  source_kind TEXT NOT NULL DEFAULT '',
  is_verified INTEGER NOT NULL DEFAULT 0,
  requires_manual_review INTEGER NOT NULL DEFAULT 0,
  integrity_score INTEGER NOT NULL DEFAULT 0,
  from_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
  to_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
  via_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
  harness_left TEXT NOT NULL DEFAULT '',
  harness_right TEXT NOT NULL DEFAULT '',
  diagram_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  diagram_source_page INTEGER NOT NULL DEFAULT 0,
  voltage TEXT NOT NULL DEFAULT '',
  wire_gauge TEXT NOT NULL DEFAULT ''
);

CREATE TABLE component_diagram_pages (
  component_code TEXT NOT NULL,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  source_page INTEGER NOT NULL,
  system_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (component_code, page_id)
);
CREATE INDEX component_diagram_code ON component_diagram_pages(component_code);

CREATE INDEX pages_type_lookup ON pages(page_type, manual_id, source_page);
CREATE INDEX wire_connections_page ON wire_connections(page_id);
CREATE INDEX wire_connections_from ON wire_connections(from_component_id);
CREATE INDEX wire_connections_to ON wire_connections(to_component_id);
CREATE INDEX wire_connections_tokens ON wire_connections(from_token, to_token);
CREATE INDEX wire_connections_verified ON wire_connections(is_verified, integrity_score);

CREATE TABLE IF NOT EXISTS pending_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model TEXT NOT NULL,
  year TEXT NOT NULL,
  engine TEXT NOT NULL,
  location_name TEXT NOT NULL,
  pin_number TEXT NOT NULL,
  wire_color TEXT NOT NULL,
  source_block TEXT NOT NULL,
  source_pin TEXT,
  destination_block TEXT NOT NULL,
  destination_pin TEXT,
  description TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected'))
);
"""


def component_type_ru(code: str) -> str:
    m = re.match(r"^(\d+)/", str(code or ""))
    if not m:
        return ""
    return COMPONENT_TYPE_RU.get(int(m.group(1)), f"Тип {m.group(1)}")


def integrity_score(row: dict) -> int:
    required = ["from_node", "to_node", "wire_color", "pin_number"]
    filled = 0
    for k in required:
        v = str(row.get(k) or "").strip()
        if v and v not in ("—", "-", "–"):
            filled += 1
    return int(round(100.0 * filled / len(required)))


def token_component(tok: str) -> str:
    m = re.match(r"^(\d+)/(\d+)", str(tok or "").strip(), re.I)
    return f"{m.group(1)}/{m.group(2)}" if m else ""


def _first_page(
    candidates: set[tuple[str, int]],
    page_ids: dict[tuple[str, int], int],
    diagram_page_ids: set[int] | None = None,
) -> tuple[int | None, int]:
    """Pick first candidate page; if diagram_page_ids set, only real schematic pages."""
    for book, page in sorted(candidates, key=lambda x: (x[0], x[1])):
        if not page:
            continue
        pid = page_ids.get((book, page)) or page_ids.get(("EN", page))
        if not pid:
            continue
        if diagram_page_ids is not None and pid not in diagram_page_ids:
            continue
        return pid, page
    return None, 0


def resolve_diagram_page(
    from_token: str,
    to_token: str,
    from_node: str,
    to_node: str,
    diagram_tokens: dict[str, set[tuple[str, int]]],
    diagram_components: dict[str, set[tuple[str, int]]],
    page_ids: dict[tuple[str, int], int],
    diagram_page_ids: set[int] | None = None,
) -> tuple[int | None, int]:
    """Prefer co-occurring pin tokens; else either token; else component code pages.
    Never returns reference/index pages when diagram_page_ids is provided.
    """
    a = diagram_tokens.get(from_token.upper(), set()) if from_token else set()
    b = diagram_tokens.get(to_token.upper(), set()) if to_token else set()
    both = a & b
    if both:
        pid, page = _first_page(both, page_ids, diagram_page_ids)
        if pid:
            return pid, page
    either = a | b
    if either:
        pid, page = _first_page(either, page_ids, diagram_page_ids)
        if pid:
            return pid, page

    codes: list[str] = []
    for raw in (from_node, to_node, token_component(from_token), token_component(to_token)):
        c = token_component(raw) if "/" in str(raw) else ""
        if not c and raw:
            c = token_component(str(raw))
        # from_node may already be canonical 3/74
        if not c:
            m = re.match(r"^(\d+)/(\d+)", str(raw or "").strip(), re.I)
            c = f"{m.group(1)}/{m.group(2)}" if m else ""
        if c and c.upper() not in {x.upper() for x in codes}:
            codes.append(c)
    for code in codes:
        pages = diagram_components.get(code.upper(), set())
        pid, page = _first_page(pages, page_ids, diagram_page_ids)
        if pid:
            return pid, page
    return None, 0


def upsert_component(cur, cache: dict, code: str, description: str, lang: str) -> int | None:
    code = str(code or "").strip()
    if not code:
        return None
    if code in cache:
        return cache[code]
    is_ru = lang == "RU" or bool(re.search(r"[а-яА-Я]", description or ""))
    type_ru = component_type_ru(code)
    desc = (description or "")[:200]
    cur.execute(
        """
        INSERT INTO components(component_code, component_type_ru, description_ru, description_en)
        VALUES (?, ?, ?, ?)
        """,
        (code, type_ru, desc if is_ru else "", desc if not is_ru else ""),
    )
    cid = int(cur.lastrowid)
    cache[code] = cid
    return cid


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=MANIFEST_PATH)
    ap.add_argument("--stage2", default=STAGE2_DIR)
    ap.add_argument("--db", default=DB_PATH)
    args = ap.parse_args()

    conn_path = os.path.join(args.stage2, "connector_circuits.json")
    diag_path = os.path.join(args.stage2, "diagram_records.json")
    if not os.path.isfile(args.manifest) or not os.path.isfile(conn_path):
        print("ERROR: run Stage 1 + Stage 2 first", file=sys.stderr)
        return 1

    manifest = load_json(args.manifest)
    connectors = load_json(conn_path).get("circuits") or []
    diagrams = load_json(diag_path).get("records") or [] if os.path.isfile(diag_path) else []

    toc_titles: dict[int, str] = {}
    if os.path.isfile(DIAGRAM_TITLES_PATH):
        try:
            raw_titles = load_json(DIAGRAM_TITLES_PATH).get("titles") or {}
            toc_titles = {int(k): str(v) for k, v in raw_titles.items() if str(v).strip()}
            print(f"Loaded diagram titles: {len(toc_titles)}")
        except Exception as e:
            print(f"WARN: diagram_titles.json: {e}")

    # Diagram indexes: full pin TOKEN -> pages; COMPONENT CODE -> pages
    diagram_tokens: dict[str, set[tuple[str, int]]] = {}
    diagram_components: dict[str, set[tuple[str, int]]] = {}
    for r in diagrams:
        book = r.get("book", "")
        page = int(r.get("page") or 0)
        loc = (book, page)
        kind = r.get("record_kind") or ""
        if kind == "pin_token" or (r.get("token") and ":" in str(r.get("token") or "")):
            tok = str(r.get("token") or "").upper()
            if tok:
                diagram_tokens.setdefault(tok, set()).add(loc)
        code = str(r.get("component_code") or token_component(r.get("token") or "")).strip()
        if code:
            diagram_components.setdefault(code.upper(), set()).add(loc)
        if kind == "component_hit":
            tok = str(r.get("token") or code).strip()
            if tok:
                diagram_components.setdefault(tok.upper(), set()).add(loc)

    # Wipe DB files
    for suffix in ("", "-wal", "-shm"):
        p = f"{args.db}{suffix}"
        if os.path.exists(p):
            try:
                os.remove(p)
            except PermissionError:
                print(f"ERROR: cannot remove {p} — stop the server and retry", file=sys.stderr)
                return 1

    os.makedirs(os.path.dirname(args.db) or "data", exist_ok=True)
    db = sqlite3.connect(args.db)
    db.executescript(DDL)
    cur = db.cursor()
    cache: dict[str, int] = {}

    # Manuals + pages from manifest
    manual_ids: dict[str, int] = {}
    page_ids: dict[tuple[str, int], int] = {}
    reference_pages = 0

    for m in manifest.get("manuals") or []:
        book = m["book"]
        cur.execute(
            "INSERT INTO manuals(filename, language) VALUES (?, ?)",
            (m["filename"], book),
        )
        manual_ids[book] = int(cur.lastrowid)

    for p in manifest.get("pages") or []:
        book = p["book"]
        if book != "EN":
            continue  # EN-only pipeline
        mid = manual_ids.get(book)
        if mid is None:
            continue
        # Skip TOC noise; keep location/fuse/diagram/connector pages for navigation
        if p.get("page_type") == "toc":
            continue
        page_type = MANIFEST_TO_DB_PAGE_TYPE.get(p.get("page_type", ""), "diagram")
        page_num = int(p["page"])
        title = p.get("title") or ""
        preview = p.get("text_preview") or ""
        if page_type == "connector" and p.get("subject_codes"):
            title = p.get("title") or f"Connector {p['subject_codes'][0]}"
        toc = toc_titles.get(page_num, "")
        # Reclassify text indexes / lists away from graphical diagrams
        if is_non_diagram_reference_title(title, toc, preview):
            page_type = "reference"
            reference_pages += 1
        if page_type == "diagram":
            title = format_diagram_title(title, page_num, "", toc)
            # Store without trailing " (стр. N)" in pages — page number is separate
            title = re.sub(r"\s*\(стр\.\s*\d+\)\s*$", "", title).strip() or toc or title
        elif page_type == "reference":
            title = (toc or title or "Reference").strip()
            title = re.sub(r"\s*\(стр\.\s*\d+\)\s*$", "", title).strip() or title
        cur.execute(
            """
            INSERT INTO pages(manual_id, source_page, system_name, page_type)
            VALUES (?, ?, ?, ?)
            """,
            (mid, page_num, title[:120], page_type),
        )
        page_ids[(book, page_num)] = int(cur.lastrowid)

    # Persist component → diagram page index (human titles, deduped per code+page)
    cdp_inserted = 0
    cdp_skipped_reference = 0
    for code_u, locs in diagram_components.items():
        # Prefer canonical display from first record
        display = code_u
        m = re.match(r"^(\d+)/(\d+)", code_u, re.I)
        if m:
            display = f"{m.group(1)}/{m.group(2)}"
        seen_pages: set[int] = set()
        for book, page in sorted(locs, key=lambda x: (x[0], x[1] or 0)):
            if not page or page in seen_pages:
                continue
            pid = page_ids.get((book, page)) or page_ids.get(("EN", page))
            if not pid:
                continue
            row = cur.execute(
                "SELECT system_name, page_type FROM pages WHERE id = ?", (pid,)
            ).fetchone()
            raw_title = (row[0] or "") if row else ""
            page_type = (row[1] or "") if row else ""
            if page_type != "diagram" or is_non_diagram_reference_title(
                raw_title, toc_titles.get(page, "")
            ):
                cdp_skipped_reference += 1
                continue
            title = format_diagram_title(
                raw_title, page, display, toc_titles.get(page, "")
            )
            try:
                cur.execute(
                    """
                    INSERT INTO component_diagram_pages(component_code, page_id, source_page, system_name)
                    VALUES (?, ?, ?, ?)
                    """,
                    (display, pid, page, title[:120]),
                )
                cdp_inserted += 1
                seen_pages.add(page)
            except sqlite3.IntegrityError:
                pass

    # Only real schematic pages may be linked from wire cards
    diagram_page_ids = {
        int(r[0])
        for r in cur.execute("SELECT id FROM pages WHERE page_type = 'diagram'").fetchall()
    }

    verified = 0
    review = 0
    inserted = 0

    for c in connectors:
        book = c.get("book", "")
        page = int(c.get("page") or 0)
        page_id = page_ids.get((book, page))
        if not page_id:
            continue

        from_node = c.get("from_node") or ""
        to_node = c.get("to_node") or ""
        from_token = c.get("from_token") or ""
        to_token = c.get("to_token") or ""
        color = c.get("wire_color") or ""
        pin = c.get("pin_number") or "—"
        score = integrity_score(
            {
                "from_node": from_node,
                "to_node": to_node,
                "wire_color": color,
                "pin_number": pin,
            }
        )

        diagram_page_id, diagram_source_page = resolve_diagram_page(
            from_token,
            to_token,
            from_node,
            to_node,
            diagram_tokens,
            diagram_components,
            page_ids,
            diagram_page_ids,
        )
        is_ver = 1 if diagram_source_page else 0
        if not is_ver:
            for node in (from_node, to_node, token_component(from_token), token_component(to_token)):
                m = re.match(r"^(\d+)/(\d+)", str(node or "").strip(), re.I)
                if m and f"{m.group(1)}/{m.group(2)}".upper() in diagram_components:
                    is_ver = 1
                    break
        needs_review = 0
        # Contradiction heuristic: both tokens present on diagrams but never co-mentioned on same page
        if from_token and to_token:
            a = diagram_tokens.get(from_token.upper(), set())
            b = diagram_tokens.get(to_token.upper(), set())
            if a and b and not (a & b) and is_ver and not color:
                needs_review = 1
        if score < 50:
            needs_review = 1

        lang = book
        from_id = upsert_component(cur, cache, from_node, c.get("from_description") or "", lang)
        to_id = upsert_component(cur, cache, to_node, c.get("to_description") or "", lang)
        owner = c.get("owner_connector") or ""
        if owner:
            upsert_component(cur, cache, owner, c.get("system_name") or "", lang)

        harness_left = str(c.get("harness_left") or "").strip()
        harness_right = str(c.get("harness_right") or "").strip()

        cur.execute(
            """
            INSERT INTO wire_connections(
              page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
              from_detail, to_detail, from_token, to_token, steering_side,
              subject_code, source_kind, is_verified, requires_manual_review, integrity_score,
              from_component_id, to_component_id, via_component_id,
              harness_left, harness_right, diagram_page_id, diagram_source_page
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
            """,
            (
                page_id,
                pin,
                color or "",
                (c.get("wire_color_ru") or "") if color else "",
                c.get("function_text") or "",
                c.get("from_detail") or "",
                c.get("to_detail") or "",
                from_token,
                to_token,
                c.get("steering_side") or "",
                owner,
                "connector_pinout",
                is_ver,
                needs_review,
                score,
                from_id,
                to_id,
                harness_left,
                harness_right,
                diagram_page_id,
                diagram_source_page,
            ),
        )
        inserted += 1
        verified += is_ver
        review += needs_review

    diag_token_count = sum(1 for r in diagrams if r.get("record_kind") == "pin_token")
    diag_hit_count = sum(1 for r in diagrams if r.get("record_kind") == "component_hit")

    # Harness hints for VIDA name cleaner (door / engine bay context from circuits)
    harness_hints: dict[str, str] = {}
    for c in connectors:
        blob = " ".join(
            str(c.get(k) or "")
            for k in ("harness_left", "harness_right", "from_detail", "to_detail", "function_text")
        )
        for key in ("from_node", "to_node", "subject_code", "via_node"):
            code = str(c.get(key) or "").strip()
            m = re.match(r"^(\d+)/(\d+)", code, re.I)
            if not m:
                continue
            canon = f"{m.group(1)}/{m.group(2)}"
            prev = harness_hints.get(canon, "")
            if len(blob) > len(prev):
                harness_hints[canon] = blob

    # Optional VIDA enrichment (name_ru + part_number), with dealer-style cleaning
    vida_name_ru_updated = 0
    vida_part_number_updated = 0
    vida_ru_path = os.path.join("data", "vida_components_ru.json")
    vida_pn_path = os.path.join("data", "vida_connector_parts.json")
    vida_pn: dict = {}
    if os.path.isfile(vida_pn_path):
        try:
            vida_pn = load_json(vida_pn_path).get("connectors") or {}
            upd = db.cursor()
            for code, rec in vida_pn.items():
                if not isinstance(rec, dict):
                    continue
                pn = str(rec.get("part_number") or "").strip()
                if not code or not pn:
                    continue
                upd.execute(
                    "UPDATE components SET part_number = ? WHERE component_code = ? AND (part_number = '' OR part_number IS NULL)",
                    (pn[:80], str(code).strip()),
                )
                vida_part_number_updated += upd.rowcount
        except Exception as e:
            print(f"WARN: vida_connector_parts.json: {e}")
    if os.path.isfile(vida_ru_path):
        try:
            vida_ru = load_json(vida_ru_path).get("components") or {}
            upd = db.cursor()
            for code, name in vida_ru.items():
                name = str(name or "").strip()
                if not code or not name:
                    continue
                code_s = str(code).strip()
                en_hint = ""
                rec = vida_pn.get(code_s)
                if isinstance(rec, dict):
                    en_hint = str(rec.get("name_en") or "")
                hint = f"{en_hint} {harness_hints.get(code_s, '')}".strip()
                nice = clean_vida_component_name(code_s, name, hint) or name
                upd.execute(
                    "UPDATE components SET name_ru = ? WHERE component_code = ? AND (name_ru = '' OR name_ru IS NULL)",
                    (nice[:300], code_s),
                )
                vida_name_ru_updated += upd.rowcount
        except Exception as e:
            print(f"WARN: vida_components_ru.json: {e}")

    db.commit()
    db.close()

    meta_path = os.path.join("data", "assemble_report.json")
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "db": args.db,
        "source": "EN_only",
        "connector_circuits_inserted": inserted,
        "diagram_links_inserted": 0,
        "diagram_tokens_indexed": diag_token_count,
        "diagram_component_hits": diag_hit_count,
        "component_diagram_pages": cdp_inserted,
        "reference_pages": reference_pages,
        "cdp_skipped_reference": cdp_skipped_reference,
        "verified_count": verified,
        "requires_manual_review_count": review,
        "components": len(cache),
        "vida_name_ru_updated": vida_name_ru_updated,
        "vida_part_number_updated": vida_part_number_updated,
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("\n========== ASSEMBLE REPORT ==========")
    for k, v in report.items():
        print(f"  {k}: {v}")
    print(f"Wrote {args.db}")
    print(f"Wrote {meta_path}")
    print("Stage 3 complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
