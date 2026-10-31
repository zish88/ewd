#!/usr/bin/env python3
"""Extract IMG-/GR- names from servicerep HTML and fetch missing blobs from ImageRepo."""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from servicerep_fetch_graphic import fetch_many, DEFAULT_MDF, OUT_DEFAULT, normalize_id  # noqa: E402

NAMED_RE = re.compile(r"(?:IMG|GR)-\d+", re.I)


def main() -> int:
    db = ROOT / "data" / "servicerep.sqlite"
    conn = sqlite3.connect(str(db))
    names: set[str] = set()
    for (html,) in conn.execute(
        "SELECT html FROM documents WHERE has_html=1 AND (html LIKE '%IMG-%' OR html LIKE '%GR-%' "
        "OR html LIKE '%IMG_%' OR html LIKE '%GR_%')"
    ):
        for m in NAMED_RE.findall(html or ""):
            nid = normalize_id(m)
            if nid and not re.fullmatch(r"[0-9a-f]{16}", nid):
                names.add(nid)
    conn.close()
    print(f"named refs {len(names)}")
    if not names:
        return 0
    result = fetch_many(sorted(names), OUT_DEFAULT, DEFAULT_MDF)
    print(f"fetched {len(result)} / {len(names)}")
    missing = [n for n in sorted(names) if n not in result]
    print("missing", len(missing))
    if missing[:20]:
        print(" sample miss", missing[:20])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
