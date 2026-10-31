#!/usr/bin/env python3
"""
Import VIDA ServiceRep (RU) into data/servicerep.sqlite for local /service UI.

Env:
  VIDA_SERVICEREP_MDF  path to servicerep_ru-RU.MDF
                       (default E:\\vida_extract\\servicerep_ru\\servicerep_ru-RU.MDF)
  VIDA_SQL_SERVER      default (localdb)\\MSSQLLocalDB
  SERVICEREP_HTML_LIMIT  max Document rows to convert to HTML (default 8000)

Usage:
  python scripts/import_servicerep.py
  python scripts/import_servicerep.py --html-limit 2000
  python scripts/import_servicerep.py --rebuild-profiles
"""
from __future__ import annotations

import argparse
import html as html_lib
import io
import os
import re
import sqlite3
import sys
import zipfile
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

OUT = ROOT / "data" / "servicerep.sqlite"
DEFAULT_MDF = Path(
    os.environ.get(
        "VIDA_SERVICEREP_MDF",
        r"E:\vida_extract\servicerep_ru\servicerep_ru-RU.MDF",
    )
)
SERVER = os.environ.get("VIDA_SQL_SERVER", r"(localdb)\MSSQLLocalDB")
DB_NAME = "ServiceRepRU"

PHRASE_RE = re.compile(r"<phrase\b[^>]*>(.*?)</phrase>", re.I | re.S)
PTXT_RE = re.compile(r"<ptxt\b[^>]*>(.*?)</ptxt>", re.I | re.S)
TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.I | re.S)
HREF_RE = re.compile(r"<href\b[^>]*>([^<]+)</href>", re.I)
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
IMG_REF_RE = re.compile(
    r"^(?:.*[/\\])?([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$",
    re.I,
)
NAMED_IMG_RE = re.compile(
    r"^(?:.*[/\\])?((?:IMG|GR)-\d+)(?:\.(?:gif|png|jpe?g|svg|cgm))?$",
    re.I,
)

MODEL_TOKENS = ("XC70", "V70", "S80", "XC60", "S60", "V60", "XC90", "S40", "V50", "C30", "C70")
# Longer first so XC70 wins over V70 when scanning.
MODEL_TOKEN_ORDER = tuple(sorted(MODEL_TOKENS, key=len, reverse=True))
YEAR_RE = re.compile(r"(?:MY\s*)?(20(?:0[5-9]|1[0-8]))", re.I)

# Soft platform siblings: if a model has few exclusive profile hits, inherit
# profiles tagged to stronger siblings (ServiceRep titles rarely say XC60/XC70).
P3_FAMILY = frozenset({"XC60", "XC70", "V70", "S60", "S80", "V60"})
P1_FAMILY = frozenset({"S40", "V50", "C30", "C70"})
PLATFORM_FAMILIES = (P3_FAMILY, P1_FAMILY)
PLATFORM_MIN_OWN = 20


def log(msg: str) -> None:
    print(msg, flush=True)


def _model_hits(text: str) -> list[str]:
    """Word-boundary model tokens (avoids V70 inside XC70)."""
    up = (text or "").upper()
    hits: list[str] = []
    for model in MODEL_TOKEN_ORDER:
        i = 0
        while True:
            j = up.find(model, i)
            if j < 0:
                break
            before = up[j - 1] if j > 0 else " "
            after = up[j + len(model)] if j + len(model) < len(up) else " "
            if (not before.isalnum()) and (not after.isalnum()):
                hits.append(model)
                break
            i = j + 1
    return hits


def _years_in(text: str) -> list[int]:
    return [int(y) for y in YEAR_RE.findall(text or "")]


def build_profile_vehicle(db: sqlite3.Connection) -> int:
    """
    Rebuild profile_vehicle from tree + document titles.

    ServiceRep MDF has TreeItemProfile / DocumentProfile IDs only — no CarConfig
    model/year tables. Heuristic + soft platform expand is the offline fallback.
    """
    from collections import defaultdict

    log("Building profile_vehicle (tree+docs + years + platform expand)…")
    scores: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    profile_years: dict[str, list[int]] = defaultdict(list)

    for pid, title in db.execute(
        """
        SELECT tip.profile_id, ti.title
        FROM tree_item_profiles tip
        JOIN tree_items ti ON ti.id = tip.tree_item_id
        WHERE IFNULL(ti.title,'') != ''
        """
    ):
        for y in _years_in(title or ""):
            profile_years[pid].append(y)
        for model in _model_hits(title or ""):
            scores[pid][model] += 1

    for pid, title in db.execute(
        """
        SELECT dp.profile_id, d.title
        FROM document_profiles dp
        JOIN documents d ON d.id = dp.document_id
        WHERE IFNULL(d.title,'') != ''
        """
    ):
        for y in _years_in(title or ""):
            profile_years[pid].append(y)
        for model in _model_hits(title or ""):
            scores[pid][model] += 2

    own: dict[str, set[str]] = defaultdict(set)
    for pid, models in scores.items():
        for model, cnt in models.items():
            if cnt >= 1:
                own[model].add(pid)

    year_span: dict[str, tuple[int | None, int | None]] = {}
    for pid, ys in profile_years.items():
        if ys:
            year_span[pid] = (min(ys), max(ys))

    expanded: dict[str, set[str]] = {m: set(own[m]) for m in MODEL_TOKENS}
    for family in PLATFORM_FAMILIES:
        strong = [m for m in family if len(own[m]) >= PLATFORM_MIN_OWN]
        weak = [m for m in family if len(own[m]) < PLATFORM_MIN_OWN]
        if not strong or not weak:
            continue
        donor: set[str] = set()
        for m in strong:
            donor |= own[m]
        for m in weak:
            before = len(expanded[m])
            expanded[m] |= donor
            log(f"  platform expand {m}: {before} -> {len(expanded[m])} (from {', '.join(sorted(strong))})")

    rows: list[tuple[str, str, int | None, int | None]] = []
    for model in MODEL_TOKENS:
        for pid in expanded[model]:
            yf, yt = year_span.get(pid, (None, None))
            rows.append((pid, model, yf, yt))

    db.execute("DELETE FROM profile_vehicle")
    db.executemany(
        "INSERT OR IGNORE INTO profile_vehicle(profile_id, model, year_from, year_to) VALUES (?,?,?,?)",
        rows,
    )
    by_model = {m: len(expanded[m]) for m in MODEL_TOKENS}
    with_years = sum(1 for _, _, yf, yt in rows if yf is not None or yt is not None)
    log(f"  profile_vehicle rows {len(rows)} (with years {with_years})")
    log(f"  by model: {by_model}")
    db.execute(
        "INSERT OR REPLACE INTO meta(key,value) VALUES ('profile_vehicle_built',?)",
        ("tree+docs+platform",),
    )
    return len(rows)


def strip_xml_text(fragment: str) -> str:
    t = TAG_RE.sub(" ", fragment)
    t = html_lib.unescape(t)
    return WS_RE.sub(" ", t).strip()


def unzip_xml(blob: bytes) -> tuple[str, dict[str, bytes]]:
    """Return XML text + sibling binary files from the ZIP (images)."""
    zf = zipfile.ZipFile(io.BytesIO(bytes(blob)))
    xml_name = next((n for n in zf.namelist() if n.lower().endswith(".xml")), zf.namelist()[0])
    xml = zf.read(xml_name).decode("utf-8", errors="replace")
    assets: dict[str, bytes] = {}
    for name in zf.namelist():
        low = name.lower()
        if low.endswith((".gif", ".png", ".jpg", ".jpeg", ".svg")):
            assets[Path(name).name.lower()] = zf.read(name)
    return xml, assets


def _local_tag(tag: str) -> str:
    if not tag:
        return ""
    return tag.split("}")[-1].lower()


def _elem_plain(el) -> str:
    return WS_RE.sub(" ", "".join(el.itertext())).strip()


def _named_graphic_id(ref: str) -> str | None:
    m = NAMED_IMG_RE.match((ref or "").strip())
    if not m:
        return None
    raw = m.group(1).upper().replace("_", "-")
    if not raw.startswith(("IMG-", "GR-")):
        raw = raw.replace("IMG", "IMG-", 1) if raw.startswith("IMG") else raw.replace("GR", "GR-", 1)
    return raw


def _graphic_id(ref: str) -> str | None:
    s = (ref or "").strip()
    m = IMG_REF_RE.match(s)
    if m:
        return m.group(1).lower()
    return _named_graphic_id(s)


def _img_html(ref: str, title: str = "", assets: dict[str, bytes] | None = None) -> str:
    """Figure for a VIDA graphic ref; prefer API URL, else ZIP asset / placeholder."""
    import base64

    assets = assets or {}
    ref = (ref or "").strip()
    base = Path(ref).name
    alt = html_lib.escape(title or base or ref)
    gid = _graphic_id(ref)
    if gid:
        return (
            f'<figure class="sr-fig">'
            f'<img src="/api/service/graphic/{gid}" alt="{alt}" loading="lazy"/>'
            f"</figure>"
        )
    blob = assets.get(base.lower())
    if blob:
        ext = base.rsplit(".", 1)[-1].lower() if "." in base else "gif"
        mime = {
            "gif": "image/gif",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "svg": "image/svg+xml",
        }.get(ext, "application/octet-stream")
        b64 = base64.b64encode(blob).decode("ascii")
        return (
            f'<figure class="sr-fig">'
            f'<img src="data:{mime};base64,{b64}" alt="{alt}"/>'
            f"</figure>"
        )
    named = _named_graphic_id(ref)
    if named:
        return (
            f'<figure class="sr-fig">'
            f'<img src="/api/service/graphic/{html_lib.escape(named)}" alt="{alt}" loading="lazy"/>'
            f"</figure>"
        )
    if ref and ("." in ref or _graphic_id(ref)):
        return f'<p class="sr-missing-img">{html_lib.escape("иллюстрация недоступна")}</p>'
    return ""


def _chronicle_from_ref(ref: str) -> str | None:
    """ru-RU0900c8af8085f972#KC07142606 → 0900c8af8085f972"""
    s = (ref or "").strip()
    if not s:
        return None
    body = s.split("#", 1)[0]
    m = re.match(r"^(?:[a-z]{2}-[A-Z]{2})?([0-9a-f]{16})$", body, re.I)
    return m.group(1).lower() if m else None


def _inline_flow(
    el,
    title_by_chron: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Render mixed ptxt content; VIDA <href title="…">id</href> → titled link."""
    title_by_chron = title_by_chron or {}
    html_parts: list[str] = []
    plain_parts: list[str] = []

    def add_text(s: str | None) -> None:
        if not s:
            return
        t = s.replace("\n", " ")
        html_parts.append(html_lib.escape(t))
        plain_parts.append(t)

    def walk_inline(node) -> None:
        add_text(node.text)
        for child in list(node):
            ctag = _local_tag(child.tag)
            if ctag == "href":
                title = (child.get("title") or "").strip()
                ref = (child.text or "").strip()
                # Image hrefs belong under <graphic>, not inline prose.
                if ref and _graphic_id(ref) and re.search(r"\.(gif|png|jpe?g|svg)$", ref, re.I):
                    add_text(child.tail)
                    continue
                chron = _chronicle_from_ref(ref)
                # Prefer RU title from our documents table: VIDA href/@title is often Swedish
                # even inside ru-RU body text.
                label = (chron and title_by_chron.get(chron)) or title or ref
                if chron:
                    html_parts.append(
                        f'<a class="sr-xref" href="/service?ref={html_lib.escape(ref)}" '
                        f'data-sr-ref="{html_lib.escape(ref)}" '
                        f'data-sr-chronicle="{html_lib.escape(chron)}">'
                        f"{html_lib.escape(label)}</a>"
                    )
                else:
                    html_parts.append(html_lib.escape(label))
                plain_parts.append(label)
                add_text(child.tail)
                continue
            if ctag in ("xref", "ref"):
                walk_inline(child)
                add_text(child.tail)
                continue
            walk_inline(child)
            add_text(child.tail)

    walk_inline(el)
    plain = WS_RE.sub(" ", "".join(plain_parts)).strip()
    return "".join(html_parts), plain


def _cell_flow(
    el,
    title_by_chron: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Table cell: inline/ptxt without wrapping every fragment in <p>."""
    title_by_chron = title_by_chron or {}
    chunks: list[str] = []
    plains: list[str] = []
    tag = _local_tag(el.tag)
    if tag in ("ptxt", "phrase", "emph"):
        html_inline, plain = _inline_flow(el, title_by_chron)
        if html_inline.strip():
            chunks.append(html_inline)
        if plain:
            plains.append(plain)
    else:
        if el.text and el.text.strip():
            t = el.text.replace("\n", " ")
            chunks.append(html_lib.escape(t))
            plains.append(t)
        for child in list(el):
            h, p = _cell_flow(child, title_by_chron)
            if h:
                chunks.append(h)
            if p:
                plains.append(p)
            if child.tail and child.tail.strip():
                t = child.tail.replace("\n", " ")
                chunks.append(html_lib.escape(t))
                plains.append(t)
    return "".join(chunks), WS_RE.sub(" ", " ".join(plains)).strip()


def _colspec_names(tgroup) -> list[str]:
    names: list[str] = []
    for c in list(tgroup):
        if _local_tag(c.tag) != "colspec":
            continue
        name = (c.get("colname") or "").strip()
        if not name:
            name = f"col{len(names) + 1}"
        names.append(name)
    return names


def _col_index(colnames: list[str], name: str | None) -> int | None:
    if not name or not colnames:
        return None
    try:
        return colnames.index(name)
    except ValueError:
        m = re.match(r"^col(\d+)$", name, re.I)
        if m:
            i = int(m.group(1)) - 1
            if 0 <= i < len(colnames):
                return i
        return None


def _entry_placement(entry, colnames: list[str]) -> tuple[int | None, int, int]:
    """Return (start_col_or_None, colspan, rowspan) from CALS attrs."""
    namest = (entry.get("namest") or "").strip() or None
    nameend = (entry.get("nameend") or "").strip() or None
    colname = (entry.get("colname") or "").strip() or None
    morerows_raw = (entry.get("morerows") or "").strip()
    rowspan = 1
    if morerows_raw.isdigit():
        rowspan = max(1, int(morerows_raw) + 1)

    if namest and nameend and colnames:
        i0 = _col_index(colnames, namest)
        i1 = _col_index(colnames, nameend)
        if i0 is not None and i1 is not None and i1 >= i0:
            return i0, i1 - i0 + 1, rowspan
    if colname and colnames:
        i0 = _col_index(colnames, colname)
        if i0 is not None:
            return i0, 1, rowspan
    if namest and nameend:
        # No colspec list — try numeric colN
        i0 = _col_index([f"col{i}" for i in range(1, 33)], namest)
        i1 = _col_index([f"col{i}" for i in range(1, 33)], nameend)
        if i0 is not None and i1 is not None and i1 >= i0:
            return i0, i1 - i0 + 1, rowspan
    return None, 1, rowspan


def _render_cals_row(
    row,
    colnames: list[str],
    title_by_chron: dict[str, str],
    plain_bits: list[str],
    *,
    header: bool,
    pending: list[int] | None = None,
) -> str:
    """Emit one <tr> with colspan/rowspan; skip cells covered by prior morerows.

    Full-width morerows (VIDA form notes) expand into a label row + empty grid
    rows so the writable area stays at the bottom with column lines — not as
    extra columns on the right.
    """
    entries = [e for e in list(row) if _local_tag(e.tag) == "entry"]
    cell_tag = "th" if header else "td"
    n = len(colnames)
    if n <= 0:
        max_end = 0
        cursor = 0
        for e in entries:
            start, span, _rs = _entry_placement(e, [f"col{i}" for i in range(1, 33)])
            if start is None:
                start = cursor
            max_end = max(max_end, start + span)
            cursor = start + span
        n = max(max_end, len(entries), 1)
        colnames = [f"col{i}" for i in range(1, n + 1)]

    if pending is None:
        pending = [0] * n
    while len(pending) < n:
        pending.append(0)

    # slots[i] = None | "occ" | "span" | (html, colspan, rowspan)
    slots: list = [None] * n
    for i in range(n):
        if pending[i] > 0:
            slots[i] = "occ"

    cursor = 0
    expand_grid_rows = 0
    for entry in entries:
        cell_html, cell_plain = _cell_flow(entry, title_by_chron)
        start, span, rowspan = _entry_placement(entry, colnames)
        if start is None:
            while cursor < n and slots[cursor] is not None:
                cursor += 1
            if cursor >= n:
                continue
            start = cursor
        if all(slots[j] is not None for j in range(start, min(n, start + max(1, span)))):
            continue
        while start < n and slots[start] is not None:
            start += 1
        if start >= n:
            continue
        span = max(1, min(span, n - start))
        for j in range(start, start + span):
            if slots[j] is not None:
                span = j - start
                break
        if span < 1:
            continue
        if cell_plain:
            plain_bits.append(cell_plain)

        # Full-width notes/form block: label + one writable pad row (VIDA-like).
        # Do not expand into many empty grid rows — they bloat print onto page 2.
        if rowspan > 1 and start == 0 and span >= n:
            slots[start] = (cell_html, span, 1)
            for j in range(start, start + span):
                slots[j] = "span" if j > start else slots[j]
                pending[j] = max(pending[j], rowspan)
            expand_grid_rows = max(expand_grid_rows, 1)
            cursor = start + span
            continue

        slots[start] = (cell_html, span, rowspan)
        for j in range(start + 1, start + span):
            slots[j] = "span"
        if rowspan > 1:
            for j in range(start, start + span):
                pending[j] = max(pending[j], rowspan)
        cursor = start + span

    out: list[str] = ["<tr>"]
    i = 0
    emitted = False
    while i < n:
        cell = slots[i]
        if cell in ("span", "occ"):
            i += 1
            continue
        if cell is None:
            out.append(f"<{cell_tag}></{cell_tag}>")
            emitted = True
            i += 1
            continue
        html, span, rowspan = cell
        attrs = ""
        if span > 1:
            attrs += f' colspan="{span}"'
        if rowspan > 1:
            attrs += f' rowspan="{rowspan}"'
        out.append(f"<{cell_tag}{attrs}>{html}</{cell_tag}>")
        emitted = True
        i += span
    out.append("</tr>")

    extras = ""
    if expand_grid_rows > 0:
        # One full-width writable strip (not N×cols empty cells that stretch print).
        extras = (
            f'<tr class="sr-form-pad">'
            f'<{cell_tag} colspan="{n}">&nbsp;</{cell_tag}>'
            f"</tr>"
        )

    # Consume one row of pending coverage.
    for j in range(n):
        if pending[j] > 0:
            pending[j] -= 1

    # CALS stub rows under rowspan/expand: emit nothing (grid already expanded).
    if not emitted:
        return ""
    return "".join(out) + extras


def xml_to_html(
    xml: str,
    assets: dict[str, bytes] | None = None,
    title_by_chron: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Document-order HTML (grate = image + steps together) + plain text for FTS."""
    import xml.etree.ElementTree as ET

    assets = assets or {}
    title_by_chron = title_by_chron or {}
    parts: list[str] = []
    plain_bits: list[str] = []
    title_level = 0

    def walk(el) -> None:
        nonlocal title_level
        tag = _local_tag(el.tag)

        if tag == "title":
            t = _elem_plain(el)
            if t:
                title_level += 1
                lvl = 2 if title_level <= 2 else 3
                parts.append(f"<h{lvl}>{html_lib.escape(t)}</h{lvl}>")
                plain_bits.append(t)
            return

        if tag == "graphic":
            for c in list(el):
                if _local_tag(c.tag) == "href":
                    chunk = _img_html((c.text or "").strip(), c.get("title") or "", assets)
                    if chunk:
                        parts.append(chunk)
            return

        if tag == "ptxt":
            html_inline, plain = _inline_flow(el, title_by_chron)
            if html_inline.strip():
                parts.append(f"<p>{html_inline}</p>")
                if plain:
                    plain_bits.append(plain)
            return

        if tag == "phrase":
            html_inline, plain = _inline_flow(el, title_by_chron)
            if plain and len(plain) > 1:
                parts.append(f"<p>{html_inline}</p>")
                plain_bits.append(plain)
            return

        if tag == "note":
            parts.append('<aside class="sr-note">')
            for c in list(el):
                walk(c)
            parts.append("</aside>")
            return

        if tag == "grate":
            # VIDA: illustration + its step text stay in one block, document order.
            parts.append('<section class="sr-grate">')
            for c in list(el):
                walk(c)
            parts.append("</section>")
            return

        if tag == "torqueinfo":
            # Compact torque specs: component + Nm + optional illustration.
            docno = (el.get("docno") or "").strip()
            torque_res = (el.get("torqueRes") or "").strip()
            chron = _chronicle_from_ref(el.get("IE-ID") or "")
            heading = (chron and title_by_chron.get(chron)) or docno
            component = ""
            value = ""
            unit = ""
            for c in list(el):
                ct = _local_tag(c.tag)
                if ct == "component":
                    component = _elem_plain(c)
                elif ct == "value":
                    value = _elem_plain(c)
                    unit = (c.get("unit") or "").strip()
            if not heading:
                bits = [docno, component]
                if value:
                    bits.append(f"{value} {unit}".strip())
                heading = " · ".join(b for b in bits if b)
            if heading:
                parts.append(f"<h2>{html_lib.escape(heading)}</h2>")
                plain_bits.append(heading)
            parts.append('<article class="sr-torque">')
            if docno:
                parts.append(f'<p class="sr-torque-docno"><code>{html_lib.escape(docno)}</code></p>')
            if torque_res:
                chunk = _img_html(torque_res, docno or torque_res, assets)
                if chunk:
                    parts.append(chunk)
                else:
                    parts.append(f'<p class="sr-missing-img">[{html_lib.escape(torque_res)}]</p>')
            parts.append('<dl class="sr-torque-dl">')
            if component:
                parts.append(f"<dt>Компонент / крепёж</dt><dd>{html_lib.escape(component)}</dd>")
                plain_bits.append(component)
            if value:
                vv = f"{value} {unit}".strip()
                parts.append(f"<dt>Момент затяжки</dt><dd><strong>{html_lib.escape(vv)}</strong></dd>")
                plain_bits.append(vv)
            parts.append("</dl></article>")
            return

        if tag == "table":
            # CALS-like VIDA tables: table > tgroup > tbody/thead > row > entry
            # Respect namest/nameend → colspan and colname placement.
            # pgwide="1" = VIDA page-wide / landscape form tables.
            pgwide = (el.get("pgwide") or "").strip() == "1"
            wrap_cls = "sr-table-wrap sr-table-pgwide" if pgwide else "sr-table-wrap"
            parts.append(f'<div class="{wrap_cls}"><table class="sr-table">')
            for tg in list(el):
                if _local_tag(tg.tag) != "tgroup":
                    walk(tg)
                    continue
                colnames = _colspec_names(tg)
                for body in list(tg):
                    bt = _local_tag(body.tag)
                    if bt == "colspec":
                        continue
                    pending_rows = [0] * max(len(colnames), 1)
                    if bt not in ("thead", "tbody"):
                        if bt == "row":
                            parts.append(
                                _render_cals_row(
                                    body,
                                    colnames,
                                    title_by_chron,
                                    plain_bits,
                                    header=False,
                                    pending=pending_rows,
                                )
                            )
                        continue
                    parts.append(f"<{bt}>")
                    for row in list(body):
                        if _local_tag(row.tag) != "row":
                            continue
                        parts.append(
                            _render_cals_row(
                                row,
                                colnames,
                                title_by_chron,
                                plain_bits,
                                header=(bt == "thead"),
                                pending=pending_rows,
                            )
                        )
                    parts.append(f"</{bt}>")
            parts.append("</table></div>")
            return

        # Do not flatten table internals outside table handler
        if tag in ("tgroup", "colspec", "tbody", "thead", "row", "entry"):
            return

        if tag in ("list1", "para", "procstep", "stepgrp", "procedure", "item"):
            open_cls = {
                "list1": "sr-list",
                "para": "sr-para",
                "procstep": "sr-step",
                "note": "sr-note",
            }.get(tag)
            if open_cls:
                parts.append(f'<div class="{open_cls}">')
            for c in list(el):
                walk(c)
            if open_cls:
                parts.append("</div>")
            return

        # Cross-ref wrappers: handled inside ptxt via _inline_flow
        if tag in ("xref", "ref", "href"):
            return

        for c in list(el):
            walk(c)

    try:
        root = ET.fromstring(xml)
        walk(root)
    except ET.ParseError:
        for m in TITLE_RE.finditer(xml):
            t = strip_xml_text(m.group(1))
            if t:
                parts.append(f"<h2>{html_lib.escape(t)}</h2>")
                plain_bits.append(t)
        for m in PTXT_RE.finditer(xml):
            t = strip_xml_text(m.group(1))
            if t:
                parts.append(f"<p>{html_lib.escape(t)}</p>")
                plain_bits.append(t)
        if not parts:
            for m in PHRASE_RE.finditer(xml):
                t = strip_xml_text(m.group(1))
                if t and len(t) > 1:
                    parts.append(f"<p>{html_lib.escape(t)}</p>")
                    plain_bits.append(t)
        for m in HREF_RE.finditer(xml):
            ref = m.group(1).strip()
            chunk = _img_html(ref, "", assets)
            if chunk:
                parts.append(chunk)

    html = "\n".join(parts) if parts else f"<pre>{html_lib.escape(xml[:4000])}</pre>"
    plain = "\n".join(plain_bits)
    return html, plain


def init_sqlite(path: Path) -> sqlite3.Connection:
    if path.exists():
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path))
    db.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE qualifier_groups (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, display_order INTEGER
        );
        CREATE TABLE qualifiers (
          id INTEGER PRIMARY KEY,
          code TEXT,
          group_id INTEGER,
          title TEXT,
          visible INTEGER
        );
        CREATE TABLE function_groups (
          code TEXT PRIMARY KEY,
          title TEXT NOT NULL
        );
        CREATE TABLE tree_items (
          id INTEGER PRIMARY KEY,
          fg1 TEXT, fg2 TEXT, fg3 TEXT,
          toc_level INTEGER,
          is_servinfo INTEGER,
          qualifier_id INTEGER,
          title TEXT,
          vcc_number TEXT,
          chronicle_id TEXT,
          project_document_id TEXT
        );
        CREATE TABLE tree_item_docs (
          tree_item_id INTEGER NOT NULL,
          project_document_id TEXT NOT NULL,
          PRIMARY KEY (tree_item_id, project_document_id)
        );
        CREATE TABLE tree_item_profiles (
          tree_item_id INTEGER NOT NULL,
          profile_id TEXT NOT NULL,
          PRIMARY KEY (tree_item_id, profile_id)
        );
        CREATE TABLE documents (
          id INTEGER PRIMARY KEY,
          title TEXT,
          qualifier_id INTEGER,
          project_document_id TEXT,
          chronicle_id TEXT,
          condition_type TEXT,
          path TEXT,
          html TEXT,
          plain_text TEXT,
          has_html INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE document_profiles (
          document_id INTEGER NOT NULL,
          profile_id TEXT NOT NULL,
          PRIMARY KEY (document_id, profile_id)
        );
        CREATE TABLE profile_vehicle (
          profile_id TEXT NOT NULL,
          model TEXT NOT NULL,
          year_from INTEGER,
          year_to INTEGER,
          PRIMARY KEY (profile_id, model)
        );
        CREATE VIRTUAL TABLE documents_fts USING fts5(
          title, plain_text, content='documents', content_rowid='id'
        );
        CREATE INDEX idx_tree_fg ON tree_items(fg1, fg2, fg3);
        CREATE INDEX idx_tree_title ON tree_items(title);
        CREATE INDEX idx_tree_serv_fg ON tree_items(is_servinfo, fg1, fg2, fg3);
        CREATE INDEX idx_tip_profile ON tree_item_profiles(profile_id);
        CREATE INDEX idx_pv_model ON profile_vehicle(model);
        CREATE INDEX idx_doc_pdid ON documents(project_document_id);
        CREATE INDEX idx_doc_title ON documents(title);
        CREATE INDEX idx_doc_chronicle ON documents(chronicle_id);
        CREATE INDEX idx_tree_chronicle ON tree_items(chronicle_id);
        CREATE INDEX idx_tree_vcc ON tree_items(vcc_number);
        """
    )
    return db


def prioritized_doc_ids(db: sqlite3.Connection) -> list[int]:
    """Repair/demount first, then title keywords, then other Repair, then rest."""
    q23 = [
        r[0]
        for r in db.execute(
            "SELECT id FROM documents WHERE qualifier_id=23 ORDER BY id"
        )
    ]
    kw = [
        r[0]
        for r in db.execute(
            """
            SELECT id FROM documents
            WHERE has_html=0 AND (
              title LIKE '%замен%' OR title LIKE '%Замен%'
              OR title LIKE '%снят%' OR title LIKE '%Снят%'
              OR title LIKE '%установ%' OR title LIKE '%Установ%'
              OR title LIKE '%демонт%' OR title LIKE '%Демонт%'
              OR title LIKE '%replace%' OR title LIKE '%Remove%' OR title LIKE '%Install%'
            )
            ORDER BY id
            """
        )
    ]
    repair_ids = {
        r[0]
        for r in db.execute(
            "SELECT id FROM qualifiers WHERE group_id = (SELECT id FROM qualifier_groups WHERE name='Repair' LIMIT 1)"
        )
    }
    repair_rest = []
    if repair_ids:
        ph = ",".join(str(i) for i in repair_ids)
        repair_rest = [
            r[0]
            for r in db.execute(
                f"SELECT id FROM documents WHERE qualifier_id IN ({ph}) ORDER BY id"
            )
        ]
    all_ids = [r[0] for r in db.execute("SELECT id FROM documents ORDER BY abs(id)")]
    seen: set[int] = set()
    ordered: list[int] = []
    for bucket in (q23, kw, repair_rest, all_ids):
        for i in bucket:
            if i not in seen:
                seen.add(i)
                ordered.append(i)
    return ordered


def extract_html_priority(cur, db: sqlite3.Connection, html_limit: int, only_missing: bool = True) -> int:
    ordered = prioritized_doc_ids(db)
    if only_missing:
        missing = {
            r[0]
            for r in db.execute("SELECT id FROM documents WHERE IFNULL(has_html,0)=0")
        }
        ordered = [i for i in ordered if i in missing]
    to_extract = ordered[: max(0, html_limit)]
    mode = "missing-only" if only_missing else "rebuild document-order"
    log(f"Extracting HTML for {len(to_extract)} documents ({mode})…")
    title_by_chron = {
        str(r[0]).lower(): str(r[1] or "").strip()
        for r in db.execute(
            "SELECT chronicle_id, title FROM documents WHERE IFNULL(chronicle_id,'') != ''"
        )
        if r[0]
    }
    done = 0
    for doc_id in to_extract:
        cur.execute("SELECT XmlContent FROM dbo.Document WHERE id=?", doc_id)
        row = cur.fetchone()
        if not row or row[0] is None:
            continue
        try:
            xml, assets = unzip_xml(bytes(row[0]))
            html_body, plain = xml_to_html(xml, assets, title_by_chron=title_by_chron)
            db.execute(
                "UPDATE documents SET html=?, plain_text=?, has_html=1 WHERE id=?",
                (html_body, plain, doc_id),
            )
            done += 1
            if done % 200 == 0:
                db.commit()
                log(f"  html {done}/{len(to_extract)}")
        except Exception as e:
            if done < 5:
                log(f"  html fail id={doc_id}: {e}")
    db.commit()
    log(f"  html extracted {done}")
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description="Import ServiceRep -> servicerep.sqlite")
    ap.add_argument("--mdf", type=Path, default=DEFAULT_MDF)
    ap.add_argument(
        "--html-limit",
        type=int,
        default=int(os.environ.get("SERVICEREP_HTML_LIMIT", "12000")),
        help="Max documents to unzip/convert to HTML",
    )
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument(
        "--html-only",
        action="store_true",
        help="Keep existing sqlite; fill missing HTML with repair-first priority",
    )
    ap.add_argument(
        "--rehtml",
        action="store_true",
        help="Rebuild HTML for existing docs (document-order images, like VIDA)",
    )
    ap.add_argument(
        "--rebuild-profiles",
        action="store_true",
        help="Rebuild profile_vehicle from existing sqlite (no MDF attach)",
    )
    args = ap.parse_args()

    if args.rebuild_profiles:
        if not args.out.is_file():
            log(f"ERROR: --rebuild-profiles needs existing {args.out}")
            return 1
        db = sqlite3.connect(str(args.out))
        try:
            n = build_profile_vehicle(db)
            db.commit()
            log(f"OK rebuild-profiles rows={n} -> {args.out}")
            return 0
        finally:
            db.close()

    if not args.mdf.is_file():
        log(f"ERROR: MDF not found: {args.mdf}")
        log("Set VIDA_SERVICEREP_MDF to servicerep_ru-RU.MDF")
        return 1

    ensure_localdb_started()
    server = resolve_sqlcmd_server(SERVER)
    log(f"SQL: {server}")
    log(f"MDF: {args.mdf} ({args.mdf.stat().st_size // (1024*1024)} MB)")

    ldf = None
    for p in list(args.mdf.parent.glob("*.ldf")) + list(args.mdf.parent.glob("*.LDF")):
        ldf = p
        break

    attach_mdf(SERVER, DB_NAME, args.mdf, ldf)
    conn = get_odbc_connection(SERVER, DB_NAME)
    cur = conn.cursor()

    if args.html_only or args.rehtml:
        if not args.out.is_file():
            log(f"ERROR: --html-only/--rehtml needs existing {args.out}")
            try:
                detach_db(SERVER, DB_NAME)
            except Exception:
                pass
            return 1
        db = sqlite3.connect(str(args.out))
        try:
            limit = max(0, int(args.html_limit))
            if args.rehtml and limit < 90000:
                # Rebuild all unless user capped explicitly via env/flag below default rebuild.
                limit = max(limit, 90000)
            done = extract_html_priority(
                cur,
                db,
                limit,
                only_missing=not args.rehtml,
            )
            total_html = db.execute("SELECT COUNT(*) FROM documents WHERE has_html=1").fetchone()[0]
            db.execute(
                "INSERT OR REPLACE INTO meta(key,value) VALUES ('html_extracted',?)",
                (str(total_html),),
            )
            try:
                db.execute("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')")
            except Exception as e:
                log(f"  fts rebuild: {e}")
            db.commit()
            mode = "rehtml" if args.rehtml else "html-only"
            log(f"OK {mode} +{done} total_html={total_html} -> {args.out}")
            return 0
        finally:
            try:
                conn.close()
            except Exception:
                pass
            try:
                db.close()
            except Exception:
                pass
            try:
                detach_db(SERVER, DB_NAME)
            except Exception as e:
                log(f"detach: {e}")

    db = init_sqlite(args.out)

    try:
        # Qualifier groups
        cur.execute("SELECT id, name, displayOrder FROM dbo.QualifierGroup")
        db.executemany(
            "INSERT INTO qualifier_groups(id,name,display_order) VALUES (?,?,?)",
            [(int(r[0]), str(r[1] or ""), int(r[2] or 0)) for r in cur.fetchall()],
        )

        cur.execute(
            "SELECT id, qualifierCode, fkQualifierGroup, title, visible FROM dbo.Qualifier"
        )
        db.executemany(
            "INSERT INTO qualifiers(id,code,group_id,title,visible) VALUES (?,?,?,?,?)",
            [
                (
                    int(r[0]),
                    str(r[1] or "").strip(),
                    int(r[2]) if r[2] is not None else None,
                    str(r[3] or "").strip(),
                    1 if r[4] else 0,
                )
                for r in cur.fetchall()
            ],
        )

        cur.execute("SELECT functionGroup, title FROM dbo.FunctionGroupText")
        db.executemany(
            "INSERT INTO function_groups(code,title) VALUES (?,?)",
            [(str(r[0] or "").strip(), str(r[1] or "").strip()) for r in cur.fetchall()],
        )

        log("Importing TreeItem…")
        cur.execute(
            """
            SELECT id, functionGroup1, functionGroup2, functionGroup3, tocLevel,
                   isServInfo, fkQualifier, title, vccNumber, chronicleId
            FROM dbo.TreeItem
            """
        )
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(2000)
            if not rows:
                break
            for r in rows:
                batch.append(
                    (
                        int(r[0]),
                        str(r[1] or "").strip() or None,
                        str(r[2] or "").strip() or None,
                        str(r[3] or "").strip() or None,
                        int(r[4] or 0),
                        1 if r[5] else 0,
                        int(r[6]) if r[6] is not None else None,
                        str(r[7] or "").strip(),
                        str(r[8] or "").strip() or None,
                        str(r[9] or "").strip() or None,
                    )
                )
            db.executemany(
                """INSERT INTO tree_items(
                     id,fg1,fg2,fg3,toc_level,is_servinfo,qualifier_id,title,vcc_number,chronicle_id
                   ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                batch,
            )
            n += len(batch)
            batch = []
            if n % 10000 == 0:
                log(f"  tree_items {n}")
        log(f"  tree_items total {n}")

        log("Importing TreeItemDocument…")
        cur.execute("SELECT fkTreeItem, projectDocumentTo FROM dbo.TreeItemDocument")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(5000)
            if not rows:
                break
            for r in rows:
                batch.append((int(r[0]), str(r[1] or "").strip()))
            db.executemany(
                "INSERT OR IGNORE INTO tree_item_docs(tree_item_id, project_document_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  tree_item_docs {n}")

        log("Importing TreeItemProfile…")
        cur.execute("SELECT fkTreeItem, profileId FROM dbo.TreeItemProfile")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(8000)
            if not rows:
                break
            for r in rows:
                pid = str(r[1] or "").strip()
                if pid:
                    batch.append((int(r[0]), pid))
            db.executemany(
                "INSERT OR IGNORE INTO tree_item_profiles(tree_item_id, profile_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  tree_item_profiles {n}")

        log("Importing Document metadata…")
        cur.execute(
            """
            SELECT id, title, fkQualifier, projectDocumentId, chronicleId,
                   conditionType, path
            FROM dbo.Document
            """
        )
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(2000)
            if not rows:
                break
            for r in rows:
                batch.append(
                    (
                        int(r[0]),
                        str(r[1] or "").strip(),
                        int(r[2]) if r[2] is not None else None,
                        str(r[3] or "").strip() or None,
                        str(r[4] or "").strip() or None,
                        str(r[5] or "").strip() or None,
                        str(r[6] or "").strip() or None,
                    )
                )
            db.executemany(
                """INSERT INTO documents(
                     id,title,qualifier_id,project_document_id,chronicle_id,condition_type,path
                   ) VALUES (?,?,?,?,?,?,?)""",
                batch,
            )
            n += len(batch)
            batch = []
            if n % 20000 == 0:
                log(f"  documents {n}")
        log(f"  documents total {n}")

        log("Importing DocumentProfile…")
        cur.execute("SELECT fkDocument, profileId FROM dbo.DocumentProfile")
        batch = []
        n = 0
        while True:
            rows = cur.fetchmany(8000)
            if not rows:
                break
            for r in rows:
                pid = str(r[1] or "").strip()
                if pid:
                    batch.append((int(r[0]), pid))
            db.executemany(
                "INSERT OR IGNORE INTO document_profiles(document_id, profile_id) VALUES (?,?)",
                batch,
            )
            n += len(batch)
            batch = []
        log(f"  document_profiles {n}")

        done = extract_html_priority(cur, db, max(0, int(args.html_limit)), only_missing=False)
        all_ids = [r[0] for r in db.execute("SELECT id FROM documents")]

        # FTS
        log("Building FTS…")
        db.execute(
            """
            INSERT INTO documents_fts(rowid, title, plain_text)
            SELECT id, IFNULL(title,''), IFNULL(plain_text,'') FROM documents
            """
        )

        build_profile_vehicle(db)

        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("source_mdf", str(args.mdf)),
        )
        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("html_extracted", str(done)),
        )
        db.execute(
            "INSERT INTO meta(key,value) VALUES (?,?)",
            ("doc_count", str(len(all_ids))),
        )
        db.commit()
        log(f"OK -> {args.out} ({args.out.stat().st_size // (1024*1024)} MB)")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass
        try:
            db.close()
        except Exception:
            pass
        try:
            detach_db(SERVER, DB_NAME)
        except Exception as e:
            log(f"detach: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
