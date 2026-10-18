#!/usr/bin/env python3
"""
Import VIDA EPC Function Groups + plates + BOM + graphics (P3) into data/parts.sqlite.

Usage:
  python scripts/import_epc_parts.py --manual E:\\manual
  python scripts/import_epc_parts.py --mdf data/vida_tmp/epc/EPC_Data.mdf --skip-graphics

Requires LocalDB with EPC (+ ImageRepository for graphics).
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import vida_extractor as vx  # noqa: E402

try:
    from extract_epc_part_images import sniff_ext  # type: ignore
except Exception:  # pragma: no cover

    def sniff_ext(blob: bytes, format_hint: str | None = None) -> str:
        hint = (format_hint or "").lower()
        if "cgm" in hint:
            return "cgm"
        if "svg" in hint:
            return "svg"
        if "png" in hint:
            return "png"
        if "jpg" in hint or "jpeg" in hint:
            return "jpg"
        if blob[:8].startswith(b"\x89PNG\r\n\x1a\n"):
            return "png"
        if blob[:3] == b"\xff\xd8\xff":
            return "jpg"
        return "bin"


MODEL_CID_MAP: dict[int, str] = {
    124: "S60",
    134: "S80",
    135: "V70",
    136: "XC60",
    155: "V60",
    156: "XC70",
}
P3_MODEL_CIDS = tuple(MODEL_CID_MAP.keys())
LANG_RU = 11
LANG_EN = 15


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
    for cand in (manual / "EPC_Data.mdf", manual / "EPC" / "EPC_Data.mdf"):
        if cand.is_file():
            ldf = cand.with_name("EPC_Log.ldf")
            return cand, ldf if ldf.is_file() else None
    raise FileNotFoundError(f"EPC.zip / EPC_Data.mdf not found under {manual}")


def resolve_image_mdf(manual: Path, _tmp: Path | None = None) -> Path | None:
    # Attach in place from E:\manual — do not copy 3+ GB ImageRepo.
    for cand in (
        manual / "imagerepository_Data.MDF",
        manual / "imagerepository_Data.mdf",
        manual / "ImageRepository_Data.MDF",
    ):
        if cand.is_file():
            return cand
    return None


def init_sqlite(path: Path) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    for suffix in ("-wal", "-shm"):
        p = Path(str(path) + suffix)
        if p.exists():
            p.unlink()
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
          graphic_code TEXT,
          graphic_file TEXT
        );
        CREATE INDEX idx_plates_fg ON plates(fg_path);

        CREATE TABLE plate_models (
          plate_id INTEGER NOT NULL,
          model_cid INTEGER NOT NULL,
          PRIMARY KEY (plate_id, model_cid)
        );
        CREATE INDEX idx_pm_cid ON plate_models(model_cid);

        CREATE TABLE plate_parts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plate_id INTEGER NOT NULL,
          hotspot TEXT,
          pn TEXT,
          title_ru TEXT,
          title_en TEXT,
          qty REAL,
          unit TEXT,
          seq INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_pp_plate ON plate_parts(plate_id);
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


def safe_code(code: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", (code or "").strip())[:80] or "unknown"


def import_all(sql_conn, out: sqlite3.Connection) -> dict[str, int]:
    cur = sql_conn.cursor()
    stats: dict[str, int] = {}

    for cid, model in MODEL_CID_MAP.items():
        out.execute("INSERT INTO models(model_cid, model) VALUES(?,?)", (cid, model))
    stats["models"] = len(MODEL_CID_MAP)

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
            INSERT OR REPLACE INTO plates(
              id, fg_path, title_ru, title_en, graphic_url, graphic_mime, graphic_code, graphic_file
            ) VALUES (?,?,?,?,?,?,?,NULL)
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

    log("  plate_models…")
    n_pm = 0
    if plate_ids:
        chunk = 800
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
    log(f"    {stats['plate_models']} plate_models")

    log("  plate_parts (BOM)…")
    n_parts = 0
    if plate_ids:
        chunk = 400
        for i in range(0, len(plate_ids), chunk):
            ids = plate_ids[i : i + chunk]
            id_list = ",".join(str(x) for x in ids)
            cur.execute(
                f"""
                SELECT
                  c.ParentComponentId,
                  c.HotspotKey,
                  pi.ItemNumber,
                  LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_RU} THEN lex.Description END))) AS title_ru,
                  LTRIM(RTRIM(MAX(CASE WHEN lex.fkLanguage = {LANG_EN} THEN lex.Description END))) AS title_en,
                  c.Quantity,
                  pi.UnitType,
                  MIN(ISNULL(c.SequenceId, 0)) AS seq
                FROM dbo.CatalogueComponents c
                LEFT JOIN dbo.PartItems pi ON pi.Id = c.fkPartItem
                LEFT JOIN dbo.Lexicon lex
                  ON lex.DescriptionId = ISNULL(
                       NULLIF(c.DescriptionId, 0),
                       pi.DescriptionId
                     )
                 AND lex.fkLanguage IN ({LANG_RU}, {LANG_EN})
                WHERE c.ParentComponentId IN ({id_list})
                  AND c.TypeId IN (4, 5)
                GROUP BY
                  c.ParentComponentId, c.HotspotKey, pi.ItemNumber,
                  c.Quantity, pi.UnitType
                """
            )
            batch = []
            for row in cur.fetchall():
                parent_id, hotspot, pn, title_ru, title_en, qty, unit, seq = row
                batch.append(
                    (
                        int(parent_id),
                        str(hotspot).strip() if hotspot is not None else None,
                        str(pn).strip() if pn else None,
                        (title_ru or "").strip() or None,
                        (title_en or "").strip() or None,
                        float(qty) if qty is not None else None,
                        str(unit).strip() if unit else None,
                        int(seq or 0),
                    )
                )
            out.executemany(
                """
                INSERT INTO plate_parts(plate_id, hotspot, pn, title_ru, title_en, qty, unit, seq)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                batch,
            )
            n_parts += len(batch)
            if (i // chunk) % 5 == 0:
                log(f"    … {n_parts} parts ({i + len(ids)}/{len(plate_ids)} plates)")
                out.commit()
    stats["plate_parts"] = n_parts
    log(f"    {stats['plate_parts']} plate_parts")
    out.commit()
    return stats


def extract_plate_graphics(
    server: str,
    image_mdf: Path,
    out: sqlite3.Connection,
    graphics_dir: Path,
) -> dict[str, int]:
    graphics_dir.mkdir(parents=True, exist_ok=True)
    log(f"  attach ImageRepo {image_mdf}…")
    vx.attach_mdf(server, vx.DB_IMAGE, image_mdf, None)
    img = vx.get_odbc_connection(server, vx.DB_IMAGE)
    icur = img.cursor()
    try:
        icur.execute("SELECT id, description FROM dbo.GraphicFormats")
        fmt_map = {int(r[0]): str(r[1] or "") for r in icur.fetchall()}
    except Exception:
        fmt_map = {}

    rows = out.execute(
        """
        SELECT DISTINCT graphic_code, graphic_mime
        FROM plates
        WHERE graphic_code IS NOT NULL AND TRIM(graphic_code) <> ''
        """
    ).fetchall()
    log(f"  unique graphic codes: {len(rows)}")
    written = 0
    converted = 0
    missing = 0
    code_to_file: dict[str, str] = {}

    for code, mime in rows:
        code = str(code).strip()
        if not code:
            continue
        icur.execute(
            """
            SELECT TOP 1
              g.id, g.fkGraphicFormat, lg.imageData
            FROM dbo.Graphics g
            INNER JOIN dbo.LocalizedGraphics lg ON lg.fkGraphic = g.id
            WHERE LTRIM(RTRIM(g.id)) = ?
              AND lg.imageData IS NOT NULL
              AND DATALENGTH(lg.imageData) > 0
            ORDER BY DATALENGTH(lg.imageData) DESC
            """,
            code,
        )
        row = icur.fetchone()
        if not row:
            missing += 1
            continue
        blob = bytes(row[2]) if row[2] is not None else b""
        if not blob:
            missing += 1
            continue
        fmt_id = row[1]
        mime_hint = mime or fmt_map.get(int(fmt_id) if fmt_id is not None else -1)
        ext = sniff_ext(blob, str(mime_hint) if mime_hint else None)
        base = safe_code(code)
        dest = graphics_dir / f"{base}.{ext}"
        if not dest.exists() or dest.stat().st_size != len(blob):
            dest.write_bytes(blob)
            written += 1
        rel = f"parts-graphics/{dest.name}"
        code_to_file[code] = rel

        if ext == "cgm":
            svg_path = dest.with_suffix(".svg")
            if not svg_path.exists() or svg_path.stat().st_size < 32:
                try:
                    from cgm import extract_vector_svg_from_bytes

                    svg = extract_vector_svg_from_bytes(blob)
                    if isinstance(svg, str) and "<svg" in svg.lower():
                        svg_path.write_text(svg, encoding="utf-8")
                        converted += 1
                        code_to_file[code] = f"parts-graphics/{svg_path.name}"
                        # Prefer SVG on disk; drop bulky CGM after successful convert.
                        try:
                            dest.unlink(missing_ok=True)
                        except OSError:
                            pass
                except Exception as e:
                    log(f"    SVG fail {base}: {e}")
            elif svg_path.exists():
                code_to_file[code] = f"parts-graphics/{svg_path.name}"
                try:
                    dest.unlink(missing_ok=True)
                except OSError:
                    pass

        if written % 200 == 0 and written:
            log(f"    … wrote {written}, converted {converted}, missing {missing}")

    for code, rel in code_to_file.items():
        out.execute(
            "UPDATE plates SET graphic_file = ? WHERE graphic_code = ?",
            (rel, code),
        )
    out.commit()
    img.close()
    return {"graphics_written": written, "graphics_svg": converted, "graphics_missing": missing}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Import EPC FG+plates+BOM+graphics → parts.sqlite")
    ap.add_argument("--manual", default=None, help="Folder with EPC.zip / ImageRepo (default E:\\manual)")
    ap.add_argument("--mdf", default=None, help="Path to EPC_Data.mdf")
    ap.add_argument("--out", default=str(ROOT / "data" / "parts.sqlite"))
    ap.add_argument("--tmp", default=str(ROOT / "data" / "vida_tmp" / "epc"))
    ap.add_argument(
        "--graphics-dir",
        default=str(ROOT / "data" / "parts-graphics"),
        help="Output dir for plate CGM/SVG files",
    )
    ap.add_argument("--skip-graphics", action="store_true", help="Skip ImageRepository extract")
    args = ap.parse_args()

    manual = Path(args.manual) if args.manual else Path(r"E:\manual")
    mdf_arg = Path(args.mdf) if args.mdf else None
    out_path = Path(args.out)
    tmp = Path(args.tmp)
    graphics_dir = Path(args.graphics_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    log("resolve EPC…")
    mdf, ldf = resolve_epc_files(manual if not mdf_arg else None, mdf_arg, tmp)
    log(f"  mdf={mdf}")

    vx.ensure_localdb_started()
    server = vx.resolve_server()
    log(f"  attach EPC on {server}…")
    vx.attach_mdf(server, vx.DB_EPC, mdf, ldf)

    sql_conn = vx.get_odbc_connection(server, vx.DB_EPC)
    stats: dict[str, int] = {}
    try:
        out = init_sqlite(out_path)
        try:
            stats = import_all(sql_conn, out)
            if not args.skip_graphics:
                image_mdf = resolve_image_mdf(manual)
                if image_mdf:
                    gstats = extract_plate_graphics(server, image_mdf, out, graphics_dir)
                    stats.update(gstats)
                else:
                    log("  WARN: imagerepository_Data.MDF not found — skip graphics")
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            meta = {
                "built_at": now,
                "source_mdf": str(mdf),
                "p3_model_cids": ",".join(str(c) for c in P3_MODEL_CIDS),
                "slice": "02",
                **{f"count_{k}": str(v) for k, v in stats.items()},
            }
            for k, v in meta.items():
                out.execute("INSERT OR REPLACE INTO meta(key, value) VALUES(?,?)", (k, v))
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
