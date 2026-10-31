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
NAMED_RE = re.compile(r"^(?:.*[/\\])?((?:IMG|GR)-\d+)(?:\.(?:gif|png|jpe?g|svg|cgm))?$", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_named(raw: str) -> str | None:
    m = NAMED_RE.match((raw or "").strip())
    if not m:
        return None
    s = m.group(1).upper().replace("_", "-")
    if s.startswith("IMG") and not s.startswith("IMG-"):
        s = "IMG-" + s[3:]
    if s.startswith("GR") and not s.startswith("GR-"):
        s = "GR-" + s[2:]
    return s


def normalize_id(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    # 0900c8af80059b21_0_0.gif → guid
    m = re.match(r"^([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$", s, re.I)
    if m:
        return m.group(1).lower()
    if ID_RE.match(s.lower()):
        return s.lower()
    return normalize_named(s)


def _existing_file(out_dir: Path, gid: str) -> str | None:
    for ext in (".gif", ".png", ".jpg", ".jpeg", ".svg", ".bin"):
        p = out_dir / f"{gid}{ext}"
        if p.is_file() and p.stat().st_size > 0:
            return p.name
        p2 = out_dir / f"{gid.lower()}{ext}"
        if p2.is_file() and p2.stat().st_size > 0:
            return p2.name
    return None


def _write_blob(out_dir: Path, gid: str, blob: bytes, path_name: str) -> str:
    ext = Path(path_name).suffix.lower() or ".gif"
    if ext not in (".gif", ".png", ".jpg", ".jpeg", ".svg"):
        ext = ".gif"
    dest = out_dir / f"{gid}{ext}"
    dest.write_bytes(blob)
    return dest.name


def fetch_by_hex(cur, gid: str) -> tuple[str, bytes] | None:
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
        return None
    return str(row[0] or f"{gid}.gif"), bytes(row[1])


def fetch_by_name(cur, name: str) -> tuple[str, bytes] | None:
    """IMG-227782 / GR-366703 live in LocalizedGraphics.path (and sometimes title)."""
    stem = name.split(".")[0]
    like = f"%{stem}%"
    cur.execute(
        """
        SELECT TOP 1 path, imageData
        FROM dbo.LocalizedGraphics
        WHERE imageData IS NOT NULL
          AND (
            path LIKE ?
            OR title LIKE ?
          )
        ORDER BY DATALENGTH(imageData) DESC
        """,
        (like, like),
    )
    row = cur.fetchone()
    if not row or row[1] is None:
        return None
    return str(row[0] or f"{stem}.gif"), bytes(row[1])


def fetch_many(ids: list[str], out_dir: Path, mdf: Path) -> dict[str, str]:
    """Return map id → relative filename written (or existing). Keys are hex or IMG-/GR-."""
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted: list[str] = []
    result: dict[str, str] = {}
    for raw in ids:
        gid = normalize_id(raw)
        if not gid:
            continue
        existing = _existing_file(out_dir, gid)
        if existing:
            result[gid] = existing
        else:
            wanted.append(gid)

    if not wanted:
        return result

    if not mdf.is_file():
        raise FileNotFoundError(f"ImageRepository MDF not found: {mdf}")

    ensure_localdb_started()
    resolve_sqlcmd_server(SERVER)
    # Reuse attach if already present; attach_mdf detaches first.
    attach_mdf(SERVER, DB_NAME, mdf, None)
    conn = get_odbc_connection(SERVER, DB_NAME)
    cur = conn.cursor()
    try:
        for gid in wanted:
            hit = fetch_by_hex(cur, gid) if ID_RE.match(gid) else fetch_by_name(cur, gid)
            if not hit:
                log(f"  miss {gid}")
                continue
            path_name, blob = hit
            result[gid] = _write_blob(out_dir, gid, blob, path_name)
            dest = out_dir / result[gid]
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
