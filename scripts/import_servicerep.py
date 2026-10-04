#!/usr/bin/env python3
"""
Import VIDA ServiceRep (RU) into data/servicerep.sqlite for local /service UI.

Env:
  VIDA_SERVICEREP_MDF  path to servicerep_ru-RU.MDF
                       (default E:\\vida_extract\\servicerep_ru\\servicerep_ru-RU.MDF)
  VIDA_SQL_SERVER      default (localdb)\\MSSQLLocalDB
  SERVICEREP_HTML_LIMIT  max Document rows to convert to HTML (default 8000)

Usage:
  python scripts/import_servicerep.py
  python scripts/import_servicerep.py --html-limit 2000
"""
from __future__ import annotations

import argparse
import html as html_lib
import io
import os
import re
import sqlite3
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from vida_extractor import (  # noqa: E402
    attach_mdf,
    detach_db,
    ensure_localdb_started,
    get_odbc_connection,
    resolve_sqlcmd_server,
)

OUT = ROOT / "data" / "servicerep.sqlite"
DEFAULT_MDF = Path(
    os.environ.get(
        "VIDA_SERVICEREP_MDF",
        r"E:\vida_extract\servicerep_ru\servicerep_ru-RU.MDF",
    )
)
SERVER = os.environ.get("VIDA_SQL_SERVER", r"(localdb)\MSSQLLocalDB")
DB_NAME = "ServiceRepRU"

PHRASE_RE = re.compile(r"<phrase\b[^>]*>(.*?)</phrase>", re.I | re.S)
PTXT_RE = re.compile(r"<ptxt\b[^>]*>(.*?)</ptxt>", re.I | re.S)
TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.I | re.S)
HREF_RE = re.compile(r"<href\b[^>]*>([^<]+)</href>", re.I)
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
IMG_REF_RE = re.compile(
    r"^(?:.*[/\\])?([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$",
    re.I,
)

MODEL_TOKENS = ("XC70", "V70", "S80", "XC60", "S60", "V60", "XC90", "S40", "V50", "C30", "C70")


def log(msg: str) -> None:
    print(msg, flush=True)


def strip_xml_text(fragment: str) -> str:
    t = TAG_RE.sub(" ", fragment)
    t = html_lib.unescape(t)
    return WS_RE.sub(" ", t).strip()


def unzip_xml(blob: bytes) -> tuple[str, dict[str, bytes]]:
    """Return XML text + sibling binary files from the ZIP (images)."""
    zf = zipfile.ZipFile(io.BytesIO(bytes(blob)))
    xml_name = next((n for n in zf.namelist() if n.lower().endswith(".xml")), zf.namelist()[0])
    xml = zf.read(xml_name).decode("utf-8", errors="replace")
    assets: dict[str, bytes] = {}
    for name in zf.namelist():
        low = name.lower()
        if low.endswith((".gif", ".png", ".jpg", ".jpeg", ".svg")):
            assets[Path(name).name.lower()] = zf.read(name)
    return xml, assets


def _local_tag(tag: str) -> str:
    if not tag:
        return ""
    return tag.split("}")[-1].lower()


def _elem_plain(el) -> str:
    return WS_RE.sub(" ", "".join(el.itertext())).strip()


def _graphic_id(ref: str) -> str | None:
    m = IMG_REF_RE.match((ref or "").strip())
    return m.group(1).lower() if m else None


def _img_html(ref: str, title: str = "", assets: dict[str, bytes] | None = None) -> str:
    """Figure for a VIDA graphic ref; prefer API URL, else ZIP asset / placeholder."""
    import base64

    assets = assets or {}
    ref = (ref or "").strip()
    base = Path(ref).name
    alt = html_lib.escape(title or base or ref)
    gid = _graphic_id(ref)
    if gid:
        return (
            f'<figure class="sr-fig">'
            f'<img src="/api/service/graphic/{gid}" alt="{alt}" loading="lazy"/>'
            f"</figure>"
        )
    blob = assets.get(base.lower())
    if blob:
        ext = base.rsplit(".", 1)[-1].lower() if "." in base else "gif"
        mime = {
            "gif": "image/gif",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "svg": "image/svg+xml",
        }.get(ext, "application/octet-stream")
        b64 = base64.b64encode(blob).decode("ascii")
        return (
            f'<figure class="sr-fig">'
            f'<img src="data:{mime};base64,{b64}" alt="{alt}"/>'
            f"</figure>"
        )
    if ref and ("." in ref or _graphic_id(ref)):
        return f'<p class="sr-missing-img">[{html_lib.escape(ref)}]</p>'
    return ""


def _chronicle_from_ref(ref: str) -> str | None:
    """ru-RU0900c8af8085f972#KC07142606 → 0900c8af8085f972"""
    s = (ref or "").strip()
    if not s:
        return None
    body = s.split("#", 1)[0]
    m = re.match(r"^(?:[a-z]{2}-[A-Z]{2})?([0-9a-f]{16})$", body, re.I)
    return m.group(1).lower() if m else None


def _inline_flow(
    el,
    title_by_chron: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Render mixed ptxt content; VIDA <href title="…">id</href> → titled link."""
    title_by_chron = title_by_chron or {}
    html_parts: list[str] = []
    plain_parts: list[str] = []

    def add_text(s: str | None) -> None:
        if not s:
            return
        t = s.replace("\n", " ")
        html_parts.append(html_lib.escape(t))
        plain_parts.append(t)

    def walk_inline(node) -> None:
        add_text(node.text)
        for child in list(node):
            ctag = _local_tag(child.tag)
            if ctag == "href":
                title = (child.get("title") or "").strip()
                ref = (child.text or "").strip()
                # Image hrefs belong under <graphic>, not inline prose.
                if ref and _graphic_id(ref) and re.search(r"\.(gif|png|jpe?g|svg)$", ref, re.I):
                    add_text(child.tail)
                    continue
                chron = _chronicle_from_ref(ref)
                label = title or (chron and title_by_chron.get(chron)) or ref
                if chron:
                    html_parts.append(
                        f'<a class="sr-xref" href="/service?ref={html_lib.escape(ref)}" '
                        f'data-sr-ref="{html_lib.escape(ref)}" '
                        f'data-sr-chronicle="{html_lib.escape(chron)}">'
                        f"{html_lib.escape(label)}</a>"
                    )
                else:
                    html_parts.append(html_lib.escape(label))
                plain_parts.append(label)
                add_text(child.tail)
                continue
            if ctag in ("xref", "ref"):
                walk_inline(child)
                add_text(child.tail)
                continue
            walk_inline(child)
            add_text(child.tail)

    walk_inline(el)
    plain = WS_RE.sub(" ", "".join(plain_parts)).strip()
    return "".join(html_parts), plain


def xml_to_html(
    xml: str,
    assets: dict[str, bytes] | None = None,
    title_by_chron: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Document-order HTML (grate = image + steps together) + plain text for FTS."""
    import xml.etree.ElementTree as ET

    assets = assets or {}
    title_by_chron = title_by_chron or {}
    parts: list[str] = []
    plain_bits: list[str] = []
    title_level = 0

    def walk(el) -> None:
        nonlocal title_level
        tag = _local_tag(el.tag)

        if tag == "title":
            t = _elem_plain(el)
            if t:
                title_level += 1
                lvl = 2 if title_level <= 2 else 3
                parts.append(f"<h{lvl}>{html_lib.escape(t)}</h{lvl}>")
                plain_bits.append(t)
            return

        if tag == "graphic":
            for c in list(el):
                if _local_tag(c.tag) == "href":
                    chunk = _img_html((c.text or "").strip(), c.get("title") or "", assets)
                    if chunk:
                        parts.append(chunk)
            return

        if tag == "ptxt":
            html_inline, plain = _inline_flow(el, title_by_chron)
            if html_inline.strip():
                parts.append(f"<p>{html_inline}</p>")
                if plain:
                    plain_bits.append(plain)
            return

        if tag == "phrase":
            html_inline, plain = _inline_flow(el, title_by_chron)
            if plain and len(plain) > 1:
                parts.append(f"<p>{html_inline}</p>")
                plain_bits.append(plain)
            return

        if tag == "note":
            parts.append('<aside class="sr-note">')
            for c in list(el):
                walk(c)
            parts.append("</aside>")
            return

        if tag == "grate":
            # VIDA: illustration + its step text stay in one block, document order.
            parts.append('<section class="sr-grate">')
            for c in list(el):
                walk(c)
            parts.append("</section>")
            return

        if tag in ("list1", "para", "procstep", "stepgrp", "procedure", "item"):
            open_cls = {
                "list1": "sr-list",
                "para": "sr-para",
                "procstep": "sr-step",
                "note": "sr-note",
            }.get(tag)
            if open_cls:
                parts.append(f'<div class="{open_cls}">')
            for c in list(el):
                walk(c)
            if open_cls:
                parts.append("</div>")
            return

        # Cross-ref wrappers: handled inside ptxt via _inline_flow
        if tag in ("xref", "ref", "href"):
            return

        for c in list(el):
            walk(c)

    try:
        root = ET.fromstring(xml)
        walk(root)
    except ET.ParseError:
        for m in TITLE_RE.finditer(xml):
            t = strip_xml_text(m.group(1))
            if t:
                parts.append(f"<h2>{html_lib.escape(t)}</h2>")
                plain_bits.append(t)
        for m in PTXT_RE.finditer(xml):
            t = strip_xml_text(m.group(1))
            if t:
                parts.append(f"<p>{html_lib.escape(t)}</p>")
                plain_bits.append(t)
        if not parts:
            for m in PHRASE_RE.finditer(xml):
                t = strip_xml_text(m.group(1))
                if t and len(t) > 1:
                    parts.append(f"<p>{html_lib.escape(t)}</p>")
                    plain_bits.append(t)
        for m in HREF_RE.finditer(xml):
            ref = m.group(1).strip()
            chunk = _img_html(ref, "", assets)
            if chunk:
                parts.append(chunk)

    html = "\n".join(parts) if parts else f"<pre>{html_lib.escape(xml[:4000])}</pre>"
    plain = "\n".join(plain_bits)
    return html, plain


def init_sqlite(path: Path) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path))
    db.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE qualifier_groups (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER
        );
        CREATE TABLE qualifiers (
          id INTEGER PRIMARY KEY,
          code TEXT,
          group_id INTEGER,
          title TEXT,
          visible INTEGER
        );
        CREATE TABLE function_groups (
          code TEXT PRIMARY KEY,
          title TEXT NOT NULL
        );
        CREATE TABLE tree_items (
          id INTEGER PRIMARY KEY,
          fg1 TEXT, fg2 TEXT, fg3 TEXT,
          toc_level INTEGER,
          is_servinfo INTEGER,
          qualifier_id INTEGER,
          title TEXT,
          vcc_number TEXT,
          chronicle_id TEXT,
          project_document_id TEXT
        );
        CREATE TABLE tree_item_docs (
          tree_item_id INTEGER NOT NULL,
          project_document_id TEXT NOT NULL,
          PRIMARY KEY (tree_item_id, project_document_id)
        );
        CREATE TABLE tree_item_profiles (
          tree_item_id INTEGER NOT NULL,
          profile_id TEXT NOT NULL,
          PRIMARY KEY (tree_item_id, profile_id)
        );
        CREATE TABLE documents (
          id INTEGER PRIMARY KEY,
          title TEXT,
          qualifier_id INTEGER,
          project_document_id TEXT,
          chronicle_id TEXT,
          condition_type TEXT,
          path TEXT,
          html TEXT,
          plain_text TEXT,
          has_html INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE document_profiles (
          document_id INTEGER NOT NULL,
          profile_id TEXT NOT NULL,
          PRIMARY KEY (document_id, profile_id)
        );
        CREATE TABLE profile_vehicle (
          profile_id TEXT NOT NULL,
          model TEXT NOT NULL,
          year_from INTEGER,
          year_to INTEGER,
          PRIMARY KEY (profile_id, model)
        );
        CREATE VIRTUAL TABLE documents_fts USING fts5(
          title, plain_text, content='documents', content_rowid='id'
        );
        CREATE INDEX idx_tree_fg ON tree_items(fg1, fg2, fg3);
        CREATE INDEX idx_tree_title ON tree_items(title);
        CREATE INDEX idx_tree_serv_fg ON tree_items(is_servinfo, fg1, fg2, fg3);
        CREATE INDEX idx_tip_profile ON tree_item_profiles(profile_id);
        CREATE INDEX idx_pv_model ON profile_vehicle(model);
        CREATE INDEX idx_doc_pdid ON documents(project_document_id);
        CREATE INDEX idx_doc_title ON documents(title);
        """
    )
    return db


def prioritized_doc_ids(db: sqlite3.Connection) -> list[int]:
    """Repair/demount first, then title keywords, then other Repair, then rest."""
    q23 = [
        r[0]
        for r in db.execute(
            "SELECT id FROM documents WHERE qualifier_id=23 ORDER BY id"
        )
    ]
    kw = [
        r[0]
        for r in db.execute(
            """
            SELECT id FROM documents
            WHERE has_html=0 AND (
              title LIKE '%замен%' OR title LIKE '%Замен%'
              OR title LIKE '%снят%' OR title LIKE '%Снят%'
              OR title LIKE '%установ%' OR title LIKE '%Установ%'
              OR title LIKE '%демонт%' OR title LIKE '%Демонт%'
              OR title LIKE '%replace%' OR title LIKE '%Remove%' OR title LIKE '%Install%'
            )
            ORDER BY id
            """
        )
    ]
    repair_ids = {
        r[0]
        for r in db.execute(
            "SELECT id FROM qualifiers WHERE group_id = (SELECT id FROM qualifier_groups WHERE name='Repair' LIMIT 1)"
        )
    }
    repair_rest = []
    if repair_ids:
        ph = ",".join(str(i) for i in repair_ids)
        repair_rest = [
            r[0]
            for r in db.execute(
                f"SELECT id FROM documents WHERE qualifier_id IN ({ph}) ORDER BY id"
            )
        ]
    all_ids = [r[0] for r in db.execute("SELECT id FROM documents ORDER BY abs(id)")]
    seen: set[int] = set()
    ordered: list[int] = []
    for bucket in (q23, kw, repair_rest, all_ids):
        for i in bucket:
            if i not in seen:
                seen.add(i)
                ordered.append(i)
    return ordered


def extract_html_priority(cur, db: sqlite3.Connection, html_limit: int, only_missing: bool = True) -> int:
    ordered = prioritized_doc_ids(db)
    if only_missing:
        missing = {
            r[0]
            for r in db.execute("SELECT id FROM documents WHERE IFNULL(has_html,0)=0")
        }
        ordered = [i for i in ordered if i in missing]
    to_extract = ordered[: max(0, html_limit)]
    mode = "missing-only" if only_missing else "rebuild document-order"
    log(f"Extracting HTML for {len(to_extract)} documents ({mode})…")
    title_by_chron = {
        str(r[0]).lower(): str(r[1] or "").strip()
        for r in db.execute(
            "SELECT chronicle_id, title FROM documents WHERE IFNULL(chronicle_id,'') != ''"
        )
        if r[0]
    }
    done = 0
    for doc_id in to_extract:
        cur.execute("SELECT XmlContent FROM dbo.Document WHERE id=?", doc_id)
        row = cur.fetchone()
        if not row or row[0] is None:
            continue
        try:
            xml, assets = unzip_xml(bytes(row[0]))
            html_body, plain = xml_to_html(xml, assets, title_by_chron=title_by_chron)
            db.execute(
                "UPDATE documents SET html=?, plain_text=?, has_html=1 WHERE id=?",
                (html_body, plain, doc_id),
            )
            done += 1
            if done % 200 == 0:
                db.commit()
                log(f"  html {done}/{len(to_extract)}")
        except Exception as e:
            if done < 5:
                log(f"  html fail id={doc_id}: {e}")
    db.commit()
    log(f"  html extracted {done}")
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="Import ServiceRep -> servicerep.sqlite")
    ap.add_argument("--mdf", type=Path, default=DEFAULT_MDF)
    ap.add_argument(
        "--html-limit",
        type=int,
        default=int(os.environ.get("SERVICEREP_HTML_LIMIT", "12000")),
        help="Max documents to unzip/convert to HTML",
    )
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument(
        "--html-only",
        action="store_true",
        help="Keep existing sqlite; fill missing HTML with repair-first priority",
    )
    ap.add_argument(
        "--rehtml",
        action="store_true",
        help="Rebuild HTML for existing docs (document-order images, like VIDA)",
    )
    args = ap.parse_args()

    if not args.mdf.is_file():
        log(f"ERROR: MDF not found: {args.mdf}")
        log("Set VIDA_SERVICEREP_MDF to servicerep_ru-RU.MDF")
        return 1

    ensure_localdb_started()
    server = resolve_sqlcmd_server(SERVER)
    log(f"SQL: {server}")
    log(f"MDF: {args.mdf} ({args.mdf.stat().st_size // (1024*1024)} MB)")

    ldf = None
    for p in list(args.mdf.parent.glob("*.ldf")) + list(args.mdf.parent.glob("*.LDF")):
        ldf = p
        break

    attach_mdf(SERVER, DB_NAME, args.mdf, ldf)
    conn = get_odbc_connection(SERVER, DB_NAME)
    cur = conn.cursor()

    if args.html_only or args.rehtml:
        if not args.out.is_file():
            log(f"ERROR: --html-only/--rehtml needs existing {args.out}")
            try:
                detach_db(SERVER, DB_NAME)
            except Exception:
                pass
            return 1
        db = sqlite3.connect(str(args.out))
        try:
            limit = max(0, int(args.html_limit))
            if args.rehtml and limit < 90000:
                # Rebuild all unless user capped explicitly via env/flag below default rebuild.
                limit = max(limit, 90000)
            done = extract_html_priority(
                cur,
                db,
                limit,
                only_missing=not args.rehtml,
            )
            total_html = db.execute("SELECT COUNT(*) FROM documents WHERE has_html=1").fetchone()[0]
            db.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES ('html_extracted',?)",
                (str(total_html),),
            )
            try:
                db.execute("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
            except Exception as e:
                log(f"  fts rebuild: {e}")
            db.commit()
            mode = "rehtml" if args.rehtml else "html-only"
            log(f"OK {mode} +{done} total_html={total_html} -> {args.out}")
            return 0
        finally:
            try:
                conn.close()
            except Exception:
                pass
            try:
                db.close()
            except Exception:
                pass
            try:
                detach_db(SERVER, DB_NAME)
            except Exception as e:
                log(f"detach: {e}")

    db = init_sqlite(args.out)

    try:
        # Qualifier groups
        cur.execute("SELECT id, name, displayOrder FROM dbo.QualifierGroup")
        db.executemany(
            "INSERT INTO qualifier_groups(id,name,display_order) VALUES (?,?,?)",
            [(int(r[0]), str(r[1] or ""), int(r[2] or 0)) for r in cur.fetchall()],
        )

        cur.execute(
            "SELECT id, qualifierCode, fkQualifierGroup, title, visible FROM dbo.Qualifier"
        )
        db.executemany(
            "INSERT INTO qualifiers(id,code,group_id,title,visible) VALUES (?,?,?,?,?)",
            [
                (
                    int(r[0]),
                    str(r[1] or "").strip(),
                    int(r[2]) if r[2] is not None else None,
                    str(r[3] or "").strip(),
                    1 if r[4] else 0,
                )
                for r in cur.fetchall()
            ],
        )

        cur.execute("SELECT functionGroup, title FROM dbo.FunctionGroupText")
        db.executemany(
            "INSERT INTO function_groups(code,title) VALUES (?,?)",
            [(str(r[0] or "").strip(), str(r[1] or "").strip()) for r in cur.fetchall()],
        )

        log("Importing TreeItem…")
        cur.execute(
            """
            SELECT id, functionGroup1, functionGroup2, functionGroup3, tocLevel,
                   isServInfo, fkQualifier, title, vccNumber, chronicleId
            FROM dbo.TreeItem
            """
        )
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(2000)
            if not rows:
                break
            for r in rows:
                batch.append(
                    (
                        int(r[0]),
                        str(r[1] or "").strip() or None,
                        str(r[2] or "").strip() or None,
                        str(r[3] or "").strip() or None,
                        int(r[4] or 0),
                        1 if r[5] else 0,
                        int(r[6]) if r[6] is not None else None,
                        str(r[7] or "").strip(),
                        str(r[8] or "").strip() or None,
                        str(r[9] or "").strip() or None,
                    )
                )
            db.executemany(
                """INSERT INTO tree_items(
                     id,fg1,fg2,fg3,toc_level,is_servinfo,qualifier_id,title,vcc_number,chronicle_id
                   ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                batch,
            )
            n += len(batch)
            batch = []
            if n % 10000 == 0:
                log(f"  tree_items {n}")
        log(f"  tree_items total {n}")

        log("Importing TreeItemDocument…")
        cur.execute("SELECT fkTreeItem, projectDocumentTo FROM dbo.TreeItemDocument")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(5000)
            if not rows:
                break
            for r in rows:
                batch.append((int(r[0]), str(r[1] or "").strip()))
            db.executemany(
                "INSERT OR IGNORE INTO tree_item_docs(tree_item_id, project_document_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  tree_item_docs {n}")

        log("Importing TreeItemProfile…")
        cur.execute("SELECT fkTreeItem, profileId FROM dbo.TreeItemProfile")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(8000)
            if not rows:
                break
            for r in rows:
                pid = str(r[1] or "").strip()
                if pid:
                    batch.append((int(r[0]), pid))
            db.executemany(
                "INSERT OR IGNORE INTO tree_item_profiles(tree_item_id, profile_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  tree_item_profiles {n}")

        log("Importing Document metadata…")
        cur.execute(
            """
            SELECT id, title, fkQualifier, projectDocumentId, chronicleId,
                   conditionType, path
            FROM dbo.Document
            """
        )
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(2000)
            if not rows:
                break
            for r in rows:
                batch.append(
                    (
                        int(r[0]),
                        str(r[1] or "").strip(),
                        int(r[2]) if r[2] is not None else None,
                        str(r[3] or "").strip() or None,
                        str(r[4] or "").strip() or None,
                        str(r[5] or "").strip() or None,
                        str(r[6] or "").strip() or None,
                    )
                )
            db.executemany(
                """INSERT INTO documents(
                     id,title,qualifier_id,project_document_id,chronicle_id,condition_type,path
                   ) VALUES (?,?,?,?,?,?,?)""",
                batch,
            )
            n += len(batch)
            batch = []
            if n % 20000 == 0:
                log(f"  documents {n}")
        log(f"  documents total {n}")

        log("Importing DocumentProfile…")
        cur.execute("SELECT fkDocument, profileId FROM dbo.DocumentProfile")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(8000)
            if not rows:
                break
            for r in rows:
                pid = str(r[1] or "").strip()
                if pid:
                    batch.append((int(r[0]), pid))
            db.executemany(
                "INSERT OR IGNORE INTO document_profiles(document_id, profile_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  document_profiles {n}")

        done = extract_html_priority(cur, db, max(0, int(args.html_limit)), only_missing=False)
        all_ids = [r[0] for r in db.execute("SELECT id FROM documents")]

        # FTS
        log("Building FTS…")
        db.execute(
            """
            INSERT INTO documents_fts(rowid, title, plain_text)
            SELECT id, IFNULL(title,''), IFNULL(plain_text,'') FROM documents
            """
        )

        # Coarse profile → vehicle from tree item titles sharing a profile
        log("Building coarse profile_vehicle map…")
        rows = db.execute(
            """
            SELECT tip.profile_id, ti.title
            FROM tree_item_profiles tip
            JOIN tree_items ti ON ti.id = tip.tree_item_id
            WHERE ti.title IS NOT NULL AND ti.title != ''
            """
        ).fetchall()
        # profile -> model counts from titles that mention model
        from collections import defaultdict

        scores: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for pid, title in rows:
            up = (title or "").upper()
            for model in MODEL_TOKENS:
                if model in up:
                    scores[pid][model] += 1
        pv = []
        for pid, models in scores.items():
            # keep models that appear at least twice for this profile
            for model, cnt in models.items():
                if cnt >= 2:
                    pv.append((pid, model, None, None))
        db.executemany(
            "INSERT OR IGNORE INTO profile_vehicle(profile_id, model, year_from, year_to) VALUES (?,?,?,?)",
            pv,
        )
        log(f"  profile_vehicle rows {len(pv)}")

        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("source_mdf", str(args.mdf)),
        )
        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("html_extracted", str(done)),
        )
        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("doc_count", str(len(all_ids))),
        )
        db.commit()
        log(f"OK -> {args.out} ({args.out.stat().st_size // (1024*1024)} MB)")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            db.close()
        except Exception:
            pass
        try:
            detach_db(SERVER, DB_NAME)
        except Exception as e:
            log(f"detach: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
