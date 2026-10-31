#!/usr/bin/env python3
"""
Dump ServiceRep graphics referenced by servicerep.sqlite into a portable
sqlite cache (no LocalDB needed on VPS).

Reads ids from data/servicerep-graphic-ids.txt (or extracts), fetches from
ImageRepository MDF, writes data/servicerep-graphics.sqlite + optional files.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from servicerep_fetch_graphic import (  # noqa: E402
    DEFAULT_MDF,
    SERVER,
    DB_NAME,
    ID_RE,
    fetch_by_hex,
    fetch_by_name,
    normalize_id,
)
from vida_extractor import (  # noqa: E402
    attach_mdf,
    detach_db,
    ensure_localdb_started,
    get_odbc_connection,
    resolve_sqlcmd_server,
)


def log(msg: str) -> None:
    print(msg, flush=True)


def load_ids(path: Path) -> list[str]:
    ids: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        gid = normalize_id(line.strip())
        if gid:
            ids.append(gid)
    # preserve order, unique
    seen: set[str] = set()
    out: list[str] = []
    for g in ids:
        if g not in seen:
            seen.add(g)
            out.append(g)
    return out


def open_cache(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path))
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS graphics (
          id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          ext TEXT NOT NULL,
          bytes BLOB NOT NULL,
          path_name TEXT
        )
        """
    )
    db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return db


def mime_for_ext(ext: str) -> str:
    return {
        ".gif": "image/gif",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
    }.get(ext.lower(), "application/octet-stream")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids-file", type=Path, default=ROOT / "data" / "servicerep-graphic-ids.txt")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "servicerep-graphics.sqlite")
    ap.add_argument("--mdf", type=Path, default=DEFAULT_MDF)
    ap.add_argument("--limit", type=int, default=0, help="Max new ids to fetch (0=all)")
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    if not args.ids_file.is_file():
        log(f"ERROR: missing {args.ids_file} — run _extract_servicerep_graphic_ids.py first")
        return 1
    if not args.mdf.is_file():
        log(f"ERROR: ImageRepository MDF not found: {args.mdf}")
        return 1

    all_ids = load_ids(args.ids_file)
    db = open_cache(args.out)
    have = {r[0] for r in db.execute("SELECT id FROM graphics")}
    todo = [g for g in all_ids if g not in have]
    if args.limit > 0:
        todo = todo[: args.limit]
    log(f"have={len(have)} todo={len(todo)} total_ids={len(all_ids)}")

    if not todo:
        log("nothing to fetch")
        db.close()
        return 0

    ensure_localdb_started()
    resolve_sqlcmd_server(SERVER)
    attach_mdf(SERVER, DB_NAME, args.mdf, None)
    conn = get_odbc_connection(SERVER, DB_NAME)
    cur = conn.cursor()
    t0 = time.time()
    ok = 0
    miss = 0
    try:
        for i in range(0, len(todo), max(1, args.batch)):
            chunk = todo[i : i + args.batch]
            for gid in chunk:
                hit = fetch_by_hex(cur, gid) if ID_RE.match(gid) else fetch_by_name(cur, gid)
                if not hit:
                    miss += 1
                    continue
                path_name, blob = hit
                ext = Path(path_name).suffix.lower() or ".gif"
                if ext not in (".gif", ".png", ".jpg", ".jpeg", ".svg"):
                    ext = ".gif"
                db.execute(
                    "INSERT OR REPLACE INTO graphics(id, mime, ext, bytes, path_name) VALUES (?,?,?,?,?)",
                    (gid, mime_for_ext(ext), ext, blob, path_name),
                )
                ok += 1
            db.commit()
            elapsed = time.time() - t0
            log(
                f"  +{ok} miss={miss} ({i + len(chunk)}/{len(todo)}) "
                f"{elapsed:.0f}s size={args.out.stat().st_size // (1024*1024)}MB"
            )
        db.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES ('built',?)",
            (time.strftime("%Y-%m-%dT%H:%M:%S"),),
        )
        db.commit()
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            detach_db(SERVER, DB_NAME)
        except Exception as e:
            log(f"detach: {e}")
        db.close()

    log(f"OK wrote={ok} miss={miss} -> {args.out} ({args.out.stat().st_size // (1024*1024)} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
