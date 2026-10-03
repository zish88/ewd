#!/usr/bin/env python3
"""
Fetch ServiceRep illustration blobs from VIDA ImageRepository into a local cache.

Env:
  VIDA_IMAGE_MDF   default E:\\manual\\imagerepository_Data.MDF
  VIDA_SQL_SERVER  default (localdb)\\MSSQLLocalDB

Usage:
  python scripts/servicerep_fetch_graphic.py --id 0900c8af80059b21
  python scripts/servicerep_fetch_graphic.py --ids 0900c8af80059b21,0900c8af80059b23
"""
from __future__ import annotations

import argparse
import os
import re
import sys
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

DB_NAME = "VidaImageRepo"
DEFAULT_MDF = Path(
    os.environ.get("VIDA_IMAGE_MDF", r"E:\manual\imagerepository_Data.MDF")
)
SERVER = os.environ.get("VIDA_SQL_SERVER", r"(localdb)\MSSQLLocalDB")
OUT_DEFAULT = ROOT / "data" / "servicerep-graphics"
ID_RE = re.compile(r"^[0-9a-f]{16}$", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_id(raw: str) -> str | None:
    s = (raw or "").strip().lower()
    if not s:
        return None
    # 0900c8af80059b21_0_0.gif → guid
    m = re.match(r"^([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$", s, re.I)
    if m:
        return m.group(1).lower()
    if ID_RE.match(s):
        return s.lower()
    return None


def fetch_many(ids: list[str], out_dir: Path, mdf: Path) -> dict[str, str]:
    """Return map id → relative filename written (or existing)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = []
    result: dict[str, str] = {}
    for raw in ids:
        gid = normalize_id(raw)
        if not gid:
            continue
        existing = None
        for ext in (".gif", ".png", ".jpg", ".jpeg", ".svg", ".bin"):
            p = out_dir / f"{gid}{ext}"
            if p.is_file() and p.stat().st_size > 0:
                existing = p.name
                break
        if existing:
            result[gid] = existing
        else:
            wanted.append(gid)

    if not wanted:
        return result

    if not mdf.is_file():
        raise FileNotFoundError(f"ImageRepository MDF not found: {mdf}")

    ensure_localdb_started()
    server = resolve_sqlcmd_server(SERVER)
    # Reuse attach if already present; attach_mdf detaches first.
    attach_mdf(SERVER, DB_NAME, mdf, None)
    conn = get_odbc_connection(SERVER, DB_NAME)
    cur = conn.cursor()
    try:
        for gid in wanted:
            cur.execute(
                """
                SELECT TOP 1 path, imageData
                FROM dbo.LocalizedGraphics
                WHERE fkGraphic = ? AND imageData IS NOT NULL
                ORDER BY languageId
                """,
                (gid,),
            )
            row = cur.fetchone()
            if not row or row[1] is None:
                log(f"  miss {gid}")
                continue
            path_name = str(row[0] or f"{gid}.gif")
            ext = Path(path_name).suffix.lower() or ".gif"
            if ext not in (".gif", ".png", ".jpg", ".jpeg", ".svg"):
                ext = ".gif"
            dest = out_dir / f"{gid}{ext}"
            dest.write_bytes(bytes(row[1]))
            result[gid] = dest.name
            log(f"  wrote {dest.name} ({dest.stat().st_size} bytes)")
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            detach_db(SERVER, DB_NAME)
        except Exception as e:
            log(f"  detach: {e}")

    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Cache ServiceRep graphics from ImageRepository")
    ap.add_argument("--id", action="append", default=[], help="Graphic id (repeatable)")
    ap.add_argument("--ids", default="", help="Comma-separated graphic ids")
    ap.add_argument("--out-dir", type=Path, default=OUT_DEFAULT)
    ap.add_argument("--mdf", type=Path, default=DEFAULT_MDF)
    args = ap.parse_args()

    ids: list[str] = list(args.id)
    if args.ids.strip():
        ids.extend(x.strip() for x in args.ids.split(",") if x.strip())
    ids = [x for x in ids if x]
    if not ids:
        log("ERROR: pass --id or --ids")
        return 1

    try:
        result = fetch_many(ids, args.out_dir, args.mdf)
    except Exception as e:
        log(f"ERROR: {e}")
        return 1

    for gid, name in result.items():
        print(f"OK {gid} -> {name}", flush=True)
    missing = [normalize_id(i) for i in ids]
    missing = [m for m in missing if m and m not in result]
    for m in missing:
        print(f"MISS {m}", flush=True)
    return 0 if result else 2


if __name__ == "__main__":
    raise SystemExit(main())
