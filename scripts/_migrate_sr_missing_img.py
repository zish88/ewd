#!/usr/bin/env python3
"""Rewrite leftover ServiceRep image placeholders in data/servicerep.sqlite.

Turns <p class="sr-missing-img">[IMG-227782.gif]</p> into
<figure class="sr-fig"><img src="/api/service/graphic/IMG-227782" …></figure>
so the API can resolve named ImageRepository illustrations without a full reimport.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MISSING_RE = re.compile(
    r'<p class="sr-missing-img">\[?([^\]<]+)\]?</p>',
    re.I,
)
HEX_RE = re.compile(
    r"(?:.*[/\\])?([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$",
    re.I,
)
NAMED_RE = re.compile(
    r"(?:.*[/\\])?((?:IMG|GR)-\d+)(?:\.(?:gif|png|jpe?g|svg|cgm))?$",
    re.I,
)


def public_id(ref: str) -> str | None:
    s = (ref or "").strip()
    m = HEX_RE.match(s)
    if m:
        return m.group(1).lower()
    m = NAMED_RE.match(s)
    if not m:
        # also search inside longer strings
        m = NAMED_RE.search(s)
        if not m:
            h = HEX_RE.search(s)
            return h.group(1).lower() if h else None
    raw = m.group(1).upper().replace("_", "-")
    if raw.startswith("IMG") and not raw.startswith("IMG-"):
        raw = "IMG-" + raw[3:]
    if raw.startswith("GR") and not raw.startswith("GR-"):
        raw = "GR-" + raw[2:]
    return raw


def rewrite_html(html: str) -> tuple[str, int]:
    n = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal n
        gid = public_id(match.group(1))
        if not gid:
            n += 1
            return '<p class="sr-missing-img">иллюстрация недоступна</p>'
        n += 1
        return (
            f'<figure class="sr-fig">'
            f'<img src="/api/service/graphic/{gid}" alt="{gid}" loading="lazy"/>'
            f"</figure>"
        )

    return MISSING_RE.sub(repl, html), n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "servicerep.sqlite")
    args = ap.parse_args()
    if not args.db.is_file():
        print(f"missing {args.db}")
        return 1
    conn = sqlite3.connect(str(args.db))
    rows = conn.execute(
        "SELECT id, html FROM documents WHERE has_html=1 AND html LIKE '%sr-missing-img%'"
    ).fetchall()
    docs = 0
    chunks = 0
    for doc_id, html in rows:
        nxt, n = rewrite_html(html or "")
        if n and nxt != html:
            conn.execute("UPDATE documents SET html=? WHERE id=?", (nxt, doc_id))
            docs += 1
            chunks += n
    conn.commit()
    left = conn.execute(
        "SELECT COUNT(*) FROM documents WHERE has_html=1 AND html LIKE '%sr-missing-img%'"
    ).fetchone()[0]
    named = conn.execute(
        "SELECT COUNT(*) FROM documents WHERE html LIKE '%/api/service/graphic/IMG%' "
        "OR html LIKE '%/api/service/graphic/GR%'"
    ).fetchone()[0]
    conn.close()
    print(f"OK docs_updated={docs} placeholders={chunks} leftover_sr-missing-img={left} docs_with_named_api={named}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
