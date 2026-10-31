#!/usr/bin/env python3
"""Extract unique ServiceRep graphic ids from documents HTML.

Sources:
  - /api/service/graphic/<id> (already rewritten HTML)
  - torqueRes="..." / torqueRes=&quot;...&quot; inside raw/escaped torqueinfo
  - sr-missing-img placeholders
"""
from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GID_RE = re.compile(r"/api/service/graphic/([0-9a-f]{16}|(?:IMG|GR)-\d+)", re.I)
TORQUE_RE = re.compile(r"torqueRes(?:=\"|=&quot;)([0-9a-f]{16}|(?:IMG|GR)-\d+)", re.I)
MISSING_RE = re.compile(r'class="sr-missing-img">\[?([^\]<]+)\]?<', re.I)
HEX16_RE = re.compile(r"([0-9a-f]{16})", re.I)
NAMED_RE = re.compile(r"((?:IMG|GR)-\d+)", re.I)


def collect_ids(html: str) -> set[str]:
    out: set[str] = set()
    if not html:
        return out
    for m in GID_RE.findall(html):
        out.add(m)
    for m in TORQUE_RE.findall(html):
        out.add(m)
    for raw in MISSING_RE.findall(html):
        hexm = HEX16_RE.search(raw)
        if hexm:
            out.add(hexm.group(1).lower())
            continue
        named = NAMED_RE.search(raw)
        if named:
            out.add(named.group(1))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "servicerep.sqlite")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "servicerep-graphic-ids.txt")
    ap.add_argument("--limit-docs", type=int, default=0)
    args = ap.parse_args()
    c = sqlite3.connect(str(args.db))
    sql = (
        "SELECT html FROM documents WHERE has_html=1 AND ("
        "html LIKE '%/api/service/graphic/%' OR html LIKE '%torqueRes%' OR html LIKE '%sr-missing-img%'"
        ")"
    )
    if args.limit_docs > 0:
        sql += f" LIMIT {int(args.limit_docs)}"
    ids: set[str] = set()
    n = 0
    for (html,) in c.execute(sql):
        n += 1
        ids |= collect_ids(html or "")
        if n % 5000 == 0:
            print(f"  scanned {n} docs, unique {len(ids)}", flush=True)
    args.out.write_text("\n".join(sorted(ids)) + ("\n" if ids else ""), encoding="utf-8")
    print(f"OK docs={n} unique_ids={len(ids)} -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
