#!/usr/bin/env python3
"""Extract Volvo DTC code→description from VIDA DiagSWDLRepository into SQLite/JSON.

Requires LocalDB with DiagSwdlRepository attached as DiagSWDL (see attach helpers).

Usage:
  python scripts/extract_vida_dtc.py
  python scripts/extract_vida_dtc.py --attach-only
  python scripts/extract_vida_dtc.py --mdf E:\\vida_extract\\diagswdl\\DiagSwdlRepository_Data.MDF
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vida_extractor import attach_mdf, get_odbc_connection, localdb_named_pipe  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MDF = Path(r"E:\vida_extract\diagswdl\DiagSwdlRepository_Data.MDF")
DEFAULT_LDF = Path(r"E:\vida_extract\diagswdl\DiagSwdlRepository_log.LDF")
OUT_SQLITE = ROOT / "data" / "dtc.sqlite"
OUT_JSON = ROOT / "data" / "dtc_codes.json"

# InformationQualifier 20 = "Diagnostic Trouble Codes and Associated Procedures"
IQ_DTC = 20
LANG_RU = 11
LANG_EN = 15

# ABS-0010 | CEM-1A05 | TCM-P056300 | DDM/PDM-XXXX | BECM-B123456
CODE_RE = re.compile(
    r"^\s*(?P<code>(?P<ecu>[A-Z]{2,6}(?:/[A-Z]{2,6})?)-"
    r"(?P<body>(?:[PCBU][0-9A-F]{4,6})|(?:[0-9A-F]{3,4}[A-Z]?)))\b",
    re.I,
)
OBD_IN_BODY = re.compile(r"^([PCBU])([0-9A-F]{4,6})$", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def parse_code(title: str) -> tuple[str, str, str] | None:
    m = CODE_RE.match(title or "")
    if not m:
        return None
    code = m.group("code").upper()
    ecu = m.group("ecu").upper()
    body = m.group("body").upper()
    obd = ""
    om = OBD_IN_BODY.match(body)
    if om:
        # Prefer canonical 5-char SAE when length is 5 (P0563); keep full Volvo body otherwise
        digits = om.group(2)
        obd = f"{om.group(1)}{digits}"
        if len(digits) > 4:
            # also store short form in search via FTS; keep full in obd_code
            pass
    return code, ecu, obd


def description_of(title: str, code: str) -> str:
    rest = (title or "").strip()
    if rest.upper().startswith(code.upper()):
        rest = rest[len(code) :].lstrip(" .-–—:\t")
    return re.sub(r"\s+", " ", rest).strip()


def ensure_attached(server: str, mdf: Path, ldf: Path | None) -> None:
    if not mdf.is_file():
        raise FileNotFoundError(f"MDF not found: {mdf}")
    attach_mdf(server, "DiagSWDL", mdf, ldf if ldf and ldf.is_file() else None)


def fetch_titles(server: str) -> dict[str, dict[str, str]]:
    """Return ie_id -> {ru, en, code, ecu, obd}."""
    conn = get_odbc_connection(server, "DiagSWDL")
    cur = conn.cursor()
    cur.execute(
        """
        SELECT ie.Id, t.fkLanguage, t.DisplayText
        FROM dbo.IE ie
        JOIN dbo.IETitle t ON t.fkIE = ie.Id
        WHERE ie.fkInformationQualifier = ?
          AND t.fkLanguage IN (?, ?)
          AND LEN(LTRIM(RTRIM(t.DisplayText))) > 0
        """,
        IQ_DTC,
        LANG_RU,
        LANG_EN,
    )
    by_ie: dict[str, dict[str, str]] = {}
    skipped = 0
    for ie_id, lang, text in cur.fetchall():
        parsed = parse_code(text)
        if not parsed:
            skipped += 1
            continue
        code, ecu, obd = parsed
        rec = by_ie.setdefault(
            str(ie_id),
            {"code": code, "ecu": ecu, "obd_code": obd, "title_ru": "", "title_en": ""},
        )
        # Prefer first non-empty; keep longest description for same lang
        desc = description_of(text, code)
        if lang == LANG_RU:
            if len(desc) >= len(rec["title_ru"]):
                rec["title_ru"] = desc
                rec["code"] = code
                rec["ecu"] = ecu
                if obd:
                    rec["obd_code"] = obd
        elif lang == LANG_EN:
            if len(desc) >= len(rec["title_en"]):
                rec["title_en"] = desc
                if not rec["code"]:
                    rec["code"] = code
                    rec["ecu"] = ecu
                if obd and not rec["obd_code"]:
                    rec["obd_code"] = obd
    conn.close()
    log(f"  IE with parseable DTC titles: {len(by_ie)} (skipped non-code titles: {skipped})")
    return by_ie


def write_sqlite(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    db = sqlite3.connect(path)
    db.executescript(
        """
        PRAGMA journal_mode = WAL;
        CREATE TABLE dtc_entries (
          id INTEGER PRIMARY KEY,
          ie_id TEXT NOT NULL UNIQUE,
          code TEXT NOT NULL,
          ecu TEXT NOT NULL DEFAULT '',
          obd_code TEXT NOT NULL DEFAULT '',
          title_ru TEXT NOT NULL DEFAULT '',
          title_en TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'vida_diagswdl'
        );
        CREATE INDEX dtc_entries_code ON dtc_entries(code);
        CREATE INDEX dtc_entries_ecu ON dtc_entries(ecu);
        CREATE INDEX dtc_entries_obd ON dtc_entries(obd_code);

        CREATE TABLE dtc_codes (
          code TEXT PRIMARY KEY,
          ecu TEXT NOT NULL DEFAULT '',
          obd_code TEXT NOT NULL DEFAULT '',
          title_ru TEXT NOT NULL DEFAULT '',
          title_en TEXT NOT NULL DEFAULT '',
          variants INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX dtc_codes_ecu ON dtc_codes(ecu);
        CREATE INDEX dtc_codes_obd ON dtc_codes(obd_code);

        CREATE VIRTUAL TABLE dtc_fts USING fts5(
          code, ecu, obd_code, title_ru, title_en,
          content='dtc_codes',
          content_rowid='rowid'
        );
        """
    )
    ins_e = db.execute
    # batch insert entries
    db.executemany(
        """
        INSERT INTO dtc_entries (ie_id, code, ecu, obd_code, title_ru, title_en)
        VALUES (:ie_id, :code, :ecu, :obd_code, :title_ru, :title_en)
        """,
        rows,
    )
    # aggregate unique codes: prefer longest RU, then EN
    agg: dict[str, dict] = {}
    for r in rows:
        cur = agg.get(r["code"])
        if not cur:
            agg[r["code"]] = {
                "code": r["code"],
                "ecu": r["ecu"],
                "obd_code": r["obd_code"],
                "title_ru": r["title_ru"],
                "title_en": r["title_en"],
                "variants": 1,
            }
            continue
        cur["variants"] += 1
        if len(r["title_ru"]) > len(cur["title_ru"]):
            cur["title_ru"] = r["title_ru"]
        if len(r["title_en"]) > len(cur["title_en"]):
            cur["title_en"] = r["title_en"]
        if r["obd_code"] and not cur["obd_code"]:
            cur["obd_code"] = r["obd_code"]
    codes = list(agg.values())
    db.executemany(
        """
        INSERT INTO dtc_codes (code, ecu, obd_code, title_ru, title_en, variants)
        VALUES (:code, :ecu, :obd_code, :title_ru, :title_en, :variants)
        """,
        codes,
    )
    db.execute(
        """
        INSERT INTO dtc_fts (rowid, code, ecu, obd_code, title_ru, title_en)
        SELECT rowid, code, ecu, obd_code, title_ru, title_en FROM dtc_codes
        """
    )
    db.commit()
    n_e = db.execute("SELECT COUNT(*) FROM dtc_entries").fetchone()[0]
    n_c = db.execute("SELECT COUNT(*) FROM dtc_codes").fetchone()[0]
    n_obd = db.execute("SELECT COUNT(*) FROM dtc_codes WHERE obd_code != ''").fetchone()[0]
    db.close()
    log(f"  wrote {path} entries={n_e} unique_codes={n_c} with_obd={n_obd}")


def write_json(path: Path, codes_sqlite: Path) -> None:
    db = sqlite3.connect(codes_sqlite)
    db.row_factory = sqlite3.Row
    rows = [
        dict(r)
        for r in db.execute(
            "SELECT code, ecu, obd_code, title_ru, title_en, variants FROM dtc_codes ORDER BY code"
        )
    ]
    db.close()
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=None), encoding="utf-8")
    log(f"  wrote {path} ({len(rows)} codes, {path.stat().st_size // 1024} KB)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default=r"(localdb)\MSSQLLocalDB")
    ap.add_argument("--mdf", type=Path, default=DEFAULT_MDF)
    ap.add_argument("--ldf", type=Path, default=DEFAULT_LDF)
    ap.add_argument("--skip-attach", action="store_true")
    ap.add_argument("--attach-only", action="store_true")
    ap.add_argument("--out-sqlite", type=Path, default=OUT_SQLITE)
    ap.add_argument("--out-json", type=Path, default=OUT_JSON)
    ap.add_argument("--no-json", action="store_true")
    args = ap.parse_args()

    pipe = localdb_named_pipe("MSSQLLocalDB")
    log(f"LocalDB pipe: {pipe}")

    if not args.skip_attach:
        log(f"Attaching {args.mdf}…")
        ensure_attached(args.server, args.mdf, args.ldf)
    if args.attach_only:
        return 0

    log("Fetching DTC titles (IQ=20, ru+en)…")
    by_ie = fetch_titles(args.server)
    rows = []
    for ie_id, rec in by_ie.items():
        if not rec.get("code"):
            continue
        rows.append(
            {
                "ie_id": ie_id,
                "code": rec["code"],
                "ecu": rec["ecu"],
                "obd_code": rec.get("obd_code") or "",
                "title_ru": rec.get("title_ru") or "",
                "title_en": rec.get("title_en") or "",
            }
        )
    log(f"Rows to write: {len(rows)}")
    write_sqlite(rows, args.out_sqlite)
    if not args.no_json:
        write_json(args.out_json, args.out_sqlite)

    # quick sanity
    db = sqlite3.connect(args.out_sqlite)
    for q in ("ABS-0010", "CEM-1A05", "P0563"):
        n = db.execute(
            "SELECT COUNT(*) FROM dtc_codes WHERE code LIKE ? OR obd_code LIKE ?",
            (f"%{q}%", f"%{q}%"),
        ).fetchone()[0]
        sample = db.execute(
            "SELECT code, substr(title_ru,1,80) FROM dtc_codes WHERE code LIKE ? OR obd_code LIKE ? LIMIT 2",
            (f"%{q}%", f"%{q}%"),
        ).fetchall()
        log(f"  probe {q}: {n} -> {sample}")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
