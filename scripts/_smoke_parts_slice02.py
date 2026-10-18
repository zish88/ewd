#!/usr/bin/env python3
"""Local smoke for SLICE-02 parts catalog (API + sqlite)."""
from __future__ import annotations

import json
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "parts.sqlite"
BASE = "http://127.0.0.1:3000"
MODELS = ["V70", "XC70", "S60", "S80", "XC60", "V60"]
CID = {"S60": 124, "S80": 134, "V70": 135, "XC60": 136, "V60": 155, "XC70": 156}


def get(url: str) -> dict | bytes:
    with urllib.request.urlopen(url, timeout=30) as r:
        ctype = r.headers.get("Content-Type", "")
        data = r.read()
        if "json" in ctype or url.endswith("/status") or "/plate/" in url or "/plates" in url or "/tree" in url:
            return json.loads(data.decode("utf-8"))
        return data


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not DB.is_file():
        print("FAIL: missing", DB)
        return 1
    conn = sqlite3.connect(str(DB))
    n_parts = conn.execute("SELECT COUNT(*) FROM plate_parts").fetchone()[0]
    n_gfx = conn.execute(
        "SELECT COUNT(*) FROM plates WHERE graphic_file IS NOT NULL AND graphic_file <> ''"
    ).fetchone()[0]
    print(f"sqlite: plate_parts={n_parts} plates_with_graphic_file={n_gfx}")

    # Find V70 front brake plate under FG /5
    row = conn.execute(
        """
        SELECT p.id, p.title_ru, p.fg_path, p.graphic_file,
               (SELECT COUNT(*) FROM plate_parts pp WHERE pp.plate_id = p.id) AS n
        FROM plates p
        JOIN plate_models pm ON pm.plate_id = p.id AND pm.model_cid = 135
        WHERE (p.fg_path = '/5' OR p.fg_path LIKE '/5/%')
          AND (
            p.title_ru LIKE '%Тормоз переднего%'
            OR p.title_ru LIKE '%тормоз переднего%'
            OR p.title_en LIKE '%Front wheel brake%'
            OR p.title_en LIKE '%front brake%'
          )
        ORDER BY n DESC
        LIMIT 5
        """
    ).fetchall()
    print("V70 FG5 brake candidates:", row)
    if not row:
        row = conn.execute(
            """
            SELECT p.id, p.title_ru, p.fg_path, p.graphic_file,
                   (SELECT COUNT(*) FROM plate_parts pp WHERE pp.plate_id = p.id) AS n
            FROM plates p
            JOIN plate_models pm ON pm.plate_id = p.id AND pm.model_cid = 135
            WHERE p.fg_path LIKE '/5%'
              AND p.title_ru LIKE '%тормоз%'
            ORDER BY n DESC
            LIMIT 5
            """
        ).fetchall()
        print("V70 FG5 any brake:", row)
    conn.close()
    if not row:
        print("FAIL: no brake plate for V70")
        return 1
    plate_id, title, fg, gfile, n = row[0]
    print(f"pick plate id={plate_id} title={title!r} fg={fg} parts={n} file={gfile}")

    try:
        st = get(f"{BASE}/api/parts-catalog/status")
        print("status", st)
        if not st.get("available"):
            print("FAIL: API status unavailable")
            return 1
    except urllib.error.URLError as e:
        print("FAIL: server not reachable", e)
        return 1

    detail = get(f"{BASE}/api/parts-catalog/plate/{plate_id}?model=V70&year=2014")
    assert isinstance(detail, dict)
    print(
        "detail ok=",
        detail.get("ok"),
        "parts=",
        len(detail.get("parts") or []),
        "graphicUrl=",
        detail.get("graphicUrl"),
        "title=",
        (detail.get("plate") or {}).get("title"),
    )
    if not detail.get("ok") or not detail.get("parts"):
        print("FAIL: empty plate detail")
        return 1
    hotspots = {str(p.get("hotspot")) for p in detail["parts"] if p.get("hotspot")}
    print("hotspots sample", sorted(hotspots, key=lambda x: int(x) if x.isdigit() else 999)[:12])

    if detail.get("graphicUrl"):
        blob = get(f"{BASE}{detail['graphicUrl']}")
        assert isinstance(blob, (bytes, bytearray))
        head = bytes(blob[:200]).decode("utf-8", errors="replace").lower()
        print(f"graphic bytes={len(blob)} svg={'<svg' in head}")
        if b"<svg" not in bytes(blob[:500]).lower() and not blob.startswith(b"\x89PNG"):
            print("WARN: graphic not svg/png")

    for model in MODELS:
        plates = get(f"{BASE}/api/parts-catalog/plates?fg=/5&model={model}&year=2014")
        assert isinstance(plates, dict)
        plist = plates.get("plates") or []
        if not plist:
            print(f"FAIL: {model} FG5 no plates")
            return 1
        pid = plist[0]["id"]
        d = get(f"{BASE}/api/parts-catalog/plate/{pid}?model={model}&year=2014")
        assert isinstance(d, dict)
        nparts = len(d.get("parts") or [])
        print(
            f"  {model}: plates_in_fg5={len(plist)} first={plist[0].get('title')!r} "
            f"parts={nparts} gfx={bool(d.get('graphicUrl'))}"
        )
        if nparts == 0:
            print(f"FAIL: {model} empty BOM on first FG5 plate")
            return 1

    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
