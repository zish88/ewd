#!/usr/bin/env python3
"""
Import VIDA EPC Function Groups + Section (plates) for P3 into data/parts.sqlite.

Usage:
  python scripts/import_epc_parts.py --manual E:\\manual
  python scripts/import_epc_parts.py --mdf data/vida_tmp/epc/EPC_Data.mdf

Requires LocalDB / SQL Server with EPC_Data.mdf attachable (same as vida_extractor).
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import vida_extractor as vx  # noqa: E402

# VCC ModelCid → marketing model (P3 + a few related ids present in EPC)
# Verified via plate counts + dealer/community VIDA car-type lists.
MODEL_CID_MAP: dict[int, str] = {
    124: "S60",
    134: "S80",
    135: "V70",
    136: "XC60",
    155: "V60",
    156: "XC70",
}

# P3 model codes we keep in the sqlite (filter plates by these ModelCid)
P3_MODEL_CIDS = tuple(MODEL_CID_MAP.keys())

LANG_RU = 11
LANG_EN = 15  # en-US


def log(msg: str) -> None:
    print(msg, flush=True)


def resolve_epc_files(manual: Path | None, mdf_arg: Path | None, tmp: Path) -> tuple[Path, Path | None]:
    if mdf_arg and mdf_arg.is_file():
        ldf = mdf_arg.with_name("EPC_Log.ldf")
        if not ldf.is_file():
            ldf = mdf_arg.with_suffix(".ldf")
        return mdf_arg, ldf if ldf.is_file() else None
    if not manual:
        raise FileNotFoundError("Need --manual or --mdf")
    zip_path = manual / "EPC.zip"
    if zip_path.is_file():
        return vx.unzip_epc(zip_path, tmp)
    # Loose MDF under manual
    for cand in (
        manual / "EPC_Data.mdf",
        manual / "EPC" / "EPC_Data.mdf",
    ):
        if cand.is_file():
            ldf = cand.with_name("EPC_Log.ldf")
            return cand, ldf if ldf.is_file() else None
    raise FileNotFoundError(f"EPC.zip / EPC_Data.mdf not found under {manual}")


def init_sqlite(path: Path) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(
        """
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE models (
          model_cid INTEGER PRIMARY KEY,
          model TEXT NOT NULL
        );

        CREATE TABLE fg_nodes (
          id INTEGER PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          label TEXT,
          parent_path TEXT,
          title_ru TEXT,
          title_en TEXT,
          depth INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_fg_parent ON fg_nodes(parent_path);
        CREATE INDEX idx_fg_depth ON fg_nodes(depth);

        CREATE TABLE plates (
          id INTEGER PRIMARY KEY,
          fg_path TEXT NOT NULL,
          title_ru TEXT,
          title_en TEXT,
          graphic_url TEXT,
          graphic_mime TEXT,
          graphic_code TEXT
        );
        CREATE INDEX idx_plates_fg ON plates(fg_path);

        CREATE TABLE plate_models (
          plate_id INTEGER NOT NULL,
          model_cid INTEGER NOT NULL,
          PRIMARY KEY (plate_id, model_cid)
        );
        CREATE INDEX idx_pm_cid ON plate_models(model_cid);
        """
    )
    return conn


def parent_path_of(path: str) -> str | None:
    p = (path or "").rstrip("/")
    if not p or p == "/":
        return None
    if "/" not in p[1:]:
        return None
    return p.rsplit("/", 1)[0] or None


def depth_of(path: str) -> int:
    p = (path or "").strip("/")
    if not p:
        return 0
    return p.count("/") + 1


def import_all(sql_conn, out: sqlite3.Connection) -> dict[str, int]:
    cur = sql_conn.cursor()
    stats: dict[str, int] = {}

    for cid, model in MODEL_CID_MAP.items():
        out.execute("INSERT INTO models(model_cid, model) VALUES(?,?)", (cid, model))
    stats["models"] = len(MODEL_CID_MAP)

    # Function groups (TypeId=2)
    log("  FG nodes…")
    cur.execute(
        f"""
        SELECT
          cc.Id,
          cc.FunctionGroupPath,
          cc.FunctionGroupLabel,
          LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_RU} THEN lex.Description END))) AS title_ru,
          LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_EN} THEN lex.Description END))) AS title_en
        FROM dbo.CatalogueComponents cc
        LEFT JOIN dbo.Lexicon lex ON lex.DescriptionId = cc.DescriptionId
          AND lex.fkLanguage IN ({LANG_RU}, {LANG_EN})
        WHERE cc.TypeId = 2
          AND ISNULL(cc.FunctionGroupPath, '') <> ''
        GROUP BY cc.Id, cc.FunctionGroupPath, cc.FunctionGroupLabel
        ORDER BY cc.FunctionGroupPath
        """
    )
    fg_rows = cur.fetchall()
    for row in fg_rows:
        cid, path, label, title_ru, title_en = row
        path = str(path or "").strip()
        if not path:
            continue
        out.execute(
            """
            INSERT OR REPLACE INTO fg_nodes(id, path, label, parent_path, title_ru, title_en, depth)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                int(cid),
                path,
                str(label or "").strip() or None,
                parent_path_of(path),
                (title_ru or "").strip() or None,
                (title_en or "").strip() or None,
                depth_of(path),
            ),
        )
    stats["fg_nodes"] = len(fg_rows)
    log(f"    {stats['fg_nodes']} FG nodes")

    # Plates (TypeId=3 Section) linked via VirtualToShared, restricted to P3 ModelCid
    cid_list = ",".join(str(c) for c in P3_MODEL_CIDS)
    log("  plates (P3 ModelCid)…")
    cur.execute(
        f"""
        SELECT
          plate.Id,
          fg.FunctionGroupPath,
          LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_RU} THEN lex.Description END))) AS title_ru,
          LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_EN} THEN lex.Description END))) AS title_en,
          MAX(ad.URL) AS graphic_url,
          MAX(ad.MIME) AS graphic_mime,
          MAX(ad.Code) AS graphic_code
        FROM dbo.VirtualToShared v
        JOIN dbo.CatalogueComponents plate
          ON plate.Id = v.fkCatalogueComponent AND plate.TypeId = 3
        JOIN dbo.CatalogueComponents fg
          ON fg.Id = v.fkCatalogueComponent_Parent AND fg.TypeId = 2
        JOIN dbo.ComponentConditions cond
          ON cond.fkCatalogueComponent = plate.Id
         AND cond.ModelCid IN ({cid_list})
        LEFT JOIN dbo.Lexicon lex
          ON lex.DescriptionId = plate.DescriptionId
         AND lex.fkLanguage IN ({LANG_RU}, {LANG_EN})
        LEFT JOIN dbo.ComponentAttachments ca
          ON ca.fkCatalogueComponent = plate.Id
        LEFT JOIN dbo.AttachmentData ad
          ON ad.Id = ca.fkAttachmentData
        WHERE ISNULL(fg.FunctionGroupPath, '') <> ''
        GROUP BY plate.Id, fg.FunctionGroupPath
        ORDER BY fg.FunctionGroupPath, plate.Id
        """
    )
    plate_rows = cur.fetchall()
    plate_ids: list[int] = []
    for row in plate_rows:
        pid, fg_path, title_ru, title_en, gurl, gmime, gcode = row
        pid = int(pid)
        plate_ids.append(pid)
        out.execute(
            """
            INSERT OR REPLACE INTO plates(id, fg_path, title_ru, title_en, graphic_url, graphic_mime, graphic_code)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                pid,
                str(fg_path).strip(),
                (title_ru or "").strip() or None,
                (title_en or "").strip() or None,
                (gurl or "").strip() or None,
                (gmime or "").strip() or None,
                (gcode or "").strip() or None,
            ),
        )
    stats["plates"] = len(plate_rows)
    log(f"    {stats['plates']} plates")

    # plate ↔ model_cid (only P3, only imported plates)
    log("  plate_models…")
    if plate_ids:
        # Chunk IN lists
        chunk = 800
        n_pm = 0
        for i in range(0, len(plate_ids), chunk):
            ids = plate_ids[i : i + chunk]
            id_list = ",".join(str(x) for x in ids)
            cur.execute(
                f"""
                SELECT DISTINCT fkCatalogueComponent, ModelCid
                FROM dbo.ComponentConditions
                WHERE ModelCid IN ({cid_list})
                  AND fkCatalogueComponent IN ({id_list})
                """
            )
            for pid, mcid in cur.fetchall():
                out.execute(
                    "INSERT OR IGNORE INTO plate_models(plate_id, model_cid) VALUES(?,?)",
                    (int(pid), int(mcid)),
                )
                n_pm += 1
        stats["plate_models"] = n_pm
    else:
        stats["plate_models"] = 0
    log(f"    {stats['plate_models']} plate_models")

    out.commit()
    return stats


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Import EPC FG+plates → data/parts.sqlite")
    ap.add_argument("--manual", default=None, help="Folder with EPC.zip (default E:\\manual)")
    ap.add_argument("--mdf", default=None, help="Path to already-extracted EPC_Data.mdf")
    ap.add_argument(
        "--out",
        default=str(ROOT / "data" / "parts.sqlite"),
        help="Output sqlite path",
    )
    ap.add_argument(
        "--tmp",
        default=str(ROOT / "data" / "vida_tmp" / "epc"),
        help="Unzip destination for EPC.zip",
    )
    args = ap.parse_args()

    manual = Path(args.manual) if args.manual else Path(r"E:\manual")
    mdf_arg = Path(args.mdf) if args.mdf else None
    out_path = Path(args.out)
    tmp = Path(args.tmp)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    log("resolve EPC…")
    mdf, ldf = resolve_epc_files(manual if not mdf_arg else None, mdf_arg, tmp)
    log(f"  mdf={mdf}")

    vx.ensure_localdb_started()
    server = vx.resolve_server()
    log(f"  attach on {server}…")
    vx.attach_mdf(server, vx.DB_EPC, mdf, ldf)

    sql_conn = vx.get_odbc_connection(server, vx.DB_EPC)
    try:
        out = init_sqlite(out_path)
        try:
            stats = import_all(sql_conn, out)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            meta = {
                "built_at": now,
                "source_mdf": str(mdf),
                "p3_model_cids": ",".join(str(c) for c in P3_MODEL_CIDS),
                **{f"count_{k}": str(v) for k, v in stats.items()},
            }
            for k, v in meta.items():
                out.execute("INSERT INTO meta(key, value) VALUES(?,?)", (k, v))
            out.commit()
        finally:
            out.close()
    finally:
        sql_conn.close()

    size_mb = out_path.stat().st_size / (1024 * 1024)
    log(f"OK → {out_path} ({size_mb:.1f} MB) {stats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
