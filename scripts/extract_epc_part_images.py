"""
SLICE-01: probe + extract VIDA ImageRepository / EPC part illustration blobs.

Writes:
  data/vida_part_images/{part_number|graphic_id}.{ext}
  data/vida_part_image_index.json

Does not guess part numbers — only confirmed ItemNumber joins, else graphic_id.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPTS = Path(__file__).resolve().parent
_REPO = _SCRIPTS.parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import vida_extractor as ve  # noqa: E402

OUT_IMAGES_DEFAULT = str(_REPO / "data" / "vida_part_images")
OUT_INDEX_DEFAULT = str(_REPO / "data" / "vida_part_image_index.json")
CATALOG_DEFAULT = str(_REPO / "data" / "vida_harness_repair_catalog.json")
CONNECTOR_PARTS_DEFAULT = str(_REPO / "data" / "vida_connector_parts.json")

# Sample acceptance PNs for code 10/1 (housing + terminal)
DEFAULT_SAMPLE_PNS = ("30658204", "30656635")


def sniff_ext(blob: bytes, format_hint: str | None = None) -> str:
    hint = (format_hint or "").strip().lower()
    if hint:
        if "png" in hint:
            return "png"
        if "jpg" in hint or "jpeg" in hint:
            return "jpg"
        if "gif" in hint:
            return "gif"
        if "bmp" in hint:
            return "bmp"
        if "tif" in hint:
            return "tif"
        if "svg" in hint:
            return "svg"
        if "emf" in hint:
            return "emf"
        if "wmf" in hint:
            return "wmf"
        if "cgm" in hint:
            return "cgm"
    if not blob:
        return "bin"
    if blob[:8].startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if blob[:3] == b"\xff\xd8\xff":
        return "jpg"
    if blob[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if blob[:2] == b"BM":
        return "bmp"
    if blob[:4] in (b"II*\x00", b"MM\x00*"):
        return "tif"
    head = blob[:200].lstrip().lower()
    if head.startswith(b"<?xml") or head.startswith(b"<svg"):
        return "svg"
    if blob[:4] == b"\x01\x00\x00\x00":
        return "emf"
    return "bin"


def table_columns(cur, table: str) -> list[dict[str, str]]:
    cur.execute(
        """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        """,
        table,
    )
    return [{"name": r[0], "type": r[1]} for r in cur.fetchall()]


def pick_col(cols: list[dict[str, str]], *candidates: str) -> str | None:
    names = {c["name"].lower(): c["name"] for c in cols}
    for cand in candidates:
        if cand.lower() in names:
            return names[cand.lower()]
    return None


def load_pn_meta(
    catalog_path: Path,
    connector_parts_path: Path,
) -> dict[str, dict[str, Any]]:
    """part_number → wiring_codes, roles_seen, titles from existing JSON sidecars."""
    meta: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "wiring_codes": set(),
            "roles_seen": set(),
            "title_en": None,
            "title_ru": None,
        }
    )

    if connector_parts_path.is_file():
        data = json.loads(connector_parts_path.read_text(encoding="utf-8"))
        for code, rec in (data.get("connectors") or {}).items():
            for key, role in (
                ("part_number", "housing"),
                ("part_number_mate", "mate"),
            ):
                pn = str(rec.get(key) or "").strip()
                if not pn:
                    continue
                meta[pn]["wiring_codes"].add(code)
                meta[pn]["roles_seen"].add(role)
                name = str(rec.get("name_en") or "").strip()
                if name and not meta[pn]["title_en"]:
                    meta[pn]["title_en"] = name

    if catalog_path.is_file():
        cat = json.loads(catalog_path.read_text(encoding="utf-8"))
        for code, rec in (cat.get("connectors") or {}).items():
            for key, role in (
                ("housing", "housing"),
                ("mate", "mate"),
                ("device", "device"),
            ):
                block = rec.get(key) or {}
                if isinstance(block, dict):
                    pn = str(block.get("part_number") or "").strip()
                    if pn:
                        meta[pn]["wiring_codes"].add(code)
                        meta[pn]["roles_seen"].add(role)
                        te = str(block.get("name_en") or "").strip()
                        tr = str(block.get("name_ru") or "").strip()
                        if te and not meta[pn]["title_en"]:
                            meta[pn]["title_en"] = te
                        if tr and not meta[pn]["title_ru"]:
                            meta[pn]["title_ru"] = tr
                elif isinstance(block, str) and block.strip():
                    meta[block.strip()]["wiring_codes"].add(code)
                    meta[block.strip()]["roles_seen"].add(role)
            for item in rec.get("items") or []:
                pn = str(item.get("part_number") or "").strip()
                if not pn:
                    continue
                role = str(item.get("role") or "terminal").strip() or "terminal"
                meta[pn]["wiring_codes"].add(code)
                meta[pn]["roles_seen"].add(role)
                te = str(item.get("name_en") or "").strip()
                tr = str(item.get("name_ru") or "").strip()
                if te and not meta[pn]["title_en"]:
                    meta[pn]["title_en"] = te
                if tr and not meta[pn]["title_ru"]:
                    meta[pn]["title_ru"] = tr

    return meta


def probe_image_repo(conn) -> dict[str, Any]:
    cur = conn.cursor()
    out: dict[str, Any] = {"tables": {}, "formats": [], "is_parts": {}}

    for table in ("Graphics", "LocalizedGraphics", "GraphicFormats"):
        cols = table_columns(cur, table)
        out["tables"][table] = cols
        ve.log(f"  ImageRepo.{table}: {[c['name']+':'+c['type'] for c in cols]}")

    cur.execute("SELECT id, description FROM dbo.GraphicFormats ORDER BY id")
    out["formats"] = [{"id": r[0], "description": r[1]} for r in cur.fetchall()]
    ve.log(f"  GraphicFormats ({len(out['formats'])}): {out['formats'][:12]}")

    cur.execute(
        """
        SELECT CAST(isParts AS INT) AS flag, COUNT(*) AS cnt
        FROM dbo.Graphics
        GROUP BY isParts
        """
    )
    for flag, cnt in cur.fetchall():
        out["is_parts"][str(flag)] = int(cnt)
        ve.log(f"  Graphics isParts={flag}: {cnt}")

    cur.execute(
        """
        SELECT TOP 5 g.id, g.fkGraphicFormat, g.width, g.height, lg.title, lg.path,
               DATALENGTH(lg.imageData) AS blob_len
        FROM dbo.Graphics g
        INNER JOIN dbo.LocalizedGraphics lg ON lg.fkGraphic = g.id
        WHERE g.isParts = 1 AND lg.imageData IS NOT NULL
        ORDER BY DATALENGTH(lg.imageData) DESC
        """
    )
    samples = []
    for row in cur.fetchall():
        samples.append(
            {
                "id": str(row[0]).strip(),
                "fkGraphicFormat": row[1],
                "width": row[2],
                "height": row[3],
                "title": row[4],
                "path": row[5],
                "blob_len": int(row[6] or 0),
            }
        )
    out["is_parts_samples"] = samples
    ve.log(f"  isParts samples with blob: {len(samples)}")
    for s in samples[:3]:
        ve.log(f"    id={s['id']} fmt={s['fkGraphicFormat']} {s['width']}x{s['height']} len={s['blob_len']} title={s['title']!r}")

    cur.execute(
        """
        SELECT COUNT(*) FROM dbo.LocalizedGraphics
        WHERE imageData IS NOT NULL AND DATALENGTH(imageData) > 0
        """
    )
    out["localized_with_blob"] = int(cur.fetchone()[0])
    ve.log(f"  LocalizedGraphics with imageData: {out['localized_with_blob']}")
    return out


def probe_epc(conn) -> dict[str, Any]:
    cur = conn.cursor()
    out: dict[str, Any] = {"tables": {}}

    for table in (
        "AttachmentData",
        "ComponentAttachments",
        "CatalogueComponents",
        "PartItems",
    ):
        cols = table_columns(cur, table)
        out["tables"][table] = cols
        ve.log(f"  EPC.{table}: {[c['name']+':'+c['type'] for c in cols]}")

    ad_cols = out["tables"]["AttachmentData"]
    out["attachment_blob_col"] = None  # no blob in EPC; Code → ImageRepository
    out["attachment_code_col"] = pick_col(ad_cols, "Code")
    out["attachment_mime_col"] = pick_col(ad_cols, "MIME")
    out["attachment_url_col"] = pick_col(ad_cols, "URL")
    out["attachment_id_col"] = pick_col(ad_cols, "Id", "ID")
    ve.log(
        f"  AttachmentData: id={out['attachment_id_col']} code={out['attachment_code_col']} "
        f"mime={out['attachment_mime_col']} url={out['attachment_url_col']} (no binary column)"
    )

    cur.execute("SELECT COUNT(*) FROM dbo.ComponentAttachments")
    out["component_attachments_count"] = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM dbo.AttachmentData")
    out["attachment_data_count"] = int(cur.fetchone()[0])
    ve.log(
        f"  ComponentAttachments={out['component_attachments_count']} "
        f"AttachmentData={out['attachment_data_count']}"
    )

    cur.execute(
        """
        SELECT TOP 5 Id, LTRIM(RTRIM(Code)), URL, MIME
        FROM dbo.AttachmentData
        """
    )
    out["attachment_samples"] = [
        {"id": r[0], "code": str(r[1]).strip() if r[1] else None, "url": r[2], "mime": r[3]}
        for r in cur.fetchall()
    ]
    ve.log(f"  AttachmentData samples: {out['attachment_samples']}")

    cur.execute(
        """
        SELECT
          SUM(CASE WHEN HotspotKey IS NOT NULL AND LTRIM(RTRIM(HotspotKey)) <> '' THEN 1 ELSE 0 END),
          COUNT(*)
        FROM dbo.CatalogueComponents
        """
    )
    hk_n, total = cur.fetchone()
    out["hotspot_nonempty"] = int(hk_n or 0)
    out["catalogue_components"] = int(total or 0)
    ve.log(f"  CatalogueComponents with HotspotKey: {hk_n}/{total}")

    cur.execute(
        """
        SELECT TOP 10 LTRIM(RTRIM(HotspotKey)), COUNT(*)
        FROM dbo.CatalogueComponents
        WHERE HotspotKey IS NOT NULL AND LTRIM(RTRIM(HotspotKey)) <> ''
        GROUP BY LTRIM(RTRIM(HotspotKey))
        ORDER BY COUNT(*) DESC
        """
    )
    out["hotspot_value_samples"] = [
        {"hotspot": str(r[0]).strip(), "count": int(r[1])} for r in cur.fetchall()
    ]
    ve.log(f"  HotspotKey = callout numbers on plates: {out['hotspot_value_samples'][:5]}")

    # Confirmed join: PN → parent with ComponentAttachments → AttachmentData.Code
    cur.execute(
        """
        SELECT TOP 5
          LTRIM(RTRIM(pi.ItemNumber)) AS pn,
          LTRIM(RTRIM(cc.HotspotKey)) AS hotspot,
          cc.Id AS cc_id,
          cc.ParentComponentId,
          ad.Id AS att_id,
          LTRIM(RTRIM(ad.Code)) AS graphic_code,
          ad.MIME,
          ad.URL
        FROM dbo.PartItems pi
        INNER JOIN dbo.CatalogueComponents cc ON cc.fkPartItem = pi.Id
        INNER JOIN dbo.CatalogueComponents parent ON parent.Id = cc.ParentComponentId
        INNER JOIN dbo.ComponentAttachments ca ON ca.fkCatalogueComponent = parent.Id
        INNER JOIN dbo.AttachmentData ad ON ad.Id = ca.fkAttachmentData
        WHERE pi.ItemNumber IS NOT NULL AND LTRIM(RTRIM(pi.ItemNumber)) <> ''
        """
    )
    joins = []
    for row in cur.fetchall():
        joins.append(
            {
                "part_number": str(row[0]).strip(),
                "hotspot": (str(row[1]).strip() if row[1] is not None else None),
                "cc_id": row[2],
                "parent_id": row[3],
                "attachment_id": row[4],
                "graphic_code": str(row[5]).strip() if row[5] else None,
                "mime": row[6],
                "url": row[7],
            }
        )
    out["pn_parent_attachment_samples"] = joins
    ve.log(f"  PN→parent→AttachmentData.Code samples: {len(joins)}")
    for j in joins[:5]:
        ve.log(f"    {j}")

    cur.execute(
        """
        SELECT COUNT(DISTINCT LTRIM(RTRIM(pi.ItemNumber)))
        FROM dbo.PartItems pi
        INNER JOIN dbo.CatalogueComponents cc ON cc.fkPartItem = pi.Id
        INNER JOIN dbo.ComponentAttachments ca ON ca.fkCatalogueComponent = cc.ParentComponentId
        WHERE pi.ItemNumber IS NOT NULL AND LTRIM(RTRIM(pi.ItemNumber)) <> ''
        """
    )
    out["pns_with_parent_attachment"] = int(cur.fetchone()[0])
    ve.log(f"  distinct PNs with parent ComponentAttachment: {out['pns_with_parent_attachment']}")
    return out


def _resolve_parent_graphic_codes(
    epc_cur, part_numbers: set[str]
) -> list[dict[str, Any]]:
    """PN → ancestor ComponentAttachments → AttachmentData.Code (Graphics.id)."""
    if not part_numbers:
        return []
    placeholders = ",".join("?" for _ in part_numbers)
    pn_list = list(part_numbers)
    epc_cur.execute(
        f"""
        SELECT
          LTRIM(RTRIM(pi.ItemNumber)) AS pn,
          cc.Id AS cc_id,
          cc.ParentComponentId,
          LTRIM(RTRIM(cc.HotspotKey)) AS hotspot
        FROM dbo.PartItems pi
        INNER JOIN dbo.CatalogueComponents cc ON cc.fkPartItem = pi.Id
        WHERE LTRIM(RTRIM(pi.ItemNumber)) IN ({placeholders})
        """,
        pn_list,
    )
    cc_rows = epc_cur.fetchall()
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for pn_raw, cc_id, parent_id, hotspot in cc_rows:
        pn = str(pn_raw).strip()
        # Walk up parents until an attachment is found (usually depth 1).
        pid = parent_id if parent_id is not None else cc_id
        found = False
        for _depth in range(16):
            if pid is None:
                break
            epc_cur.execute(
                """
                SELECT ad.Id, LTRIM(RTRIM(ad.Code)), ad.MIME, ad.URL, ca.AttachmentTypeId
                FROM dbo.ComponentAttachments ca
                INNER JOIN dbo.AttachmentData ad ON ad.Id = ca.fkAttachmentData
                WHERE ca.fkCatalogueComponent = ?
                """,
                pid,
            )
            atts = epc_cur.fetchall()
            if atts:
                for att_id, code, mime, url, att_type in atts:
                    code_s = str(code).strip() if code else ""
                    if not code_s or (pn, code_s) in seen:
                        continue
                    seen.add((pn, code_s))
                    results.append(
                        {
                            "part_number": pn,
                            "graphic_code": code_s,
                            "mime": mime,
                            "url": url,
                            "attachment_id": att_id,
                            "attachment_type_id": att_type,
                            "hotspot": str(hotspot).strip() if hotspot else None,
                            "cc_id": cc_id,
                            "attachment_cc_id": pid,
                        }
                    )
                found = True
                break
            epc_cur.execute(
                "SELECT ParentComponentId FROM dbo.CatalogueComponents WHERE Id = ?",
                pid,
            )
            prow = epc_cur.fetchone()
            if not prow:
                break
            pid = prow[0]
        if not found:
            ve.log(f"    no plate attachment in parent chain for PN {pn} cc={cc_id}")
    return results


def extract_pn_plate_images(
    img_conn,
    epc_conn,
    part_numbers: set[str],
    out_dir: Path,
    index_entries: dict[str, dict[str, Any]],
) -> int:
    """
    Confirmed join:
      PartItems → CatalogueComponents → (parent+) ComponentAttachments
      → AttachmentData.Code = Graphics.id → LocalizedGraphics.imageData
    HotspotKey is the callout number on that plate (stored in index, not used as graphic id).
    """
    if not part_numbers:
        return 0
    ecur = epc_conn.cursor()
    icur = img_conn.cursor()
    icur.execute("SELECT id, description FROM dbo.GraphicFormats")
    fmt_map = {int(r[0]): str(r[1] or "") for r in icur.fetchall()}

    links = _resolve_parent_graphic_codes(ecur, part_numbers)
    ve.log(f"  PN↔plate graphic links: {len(links)}")
    written = 0

    for link in links:
        pn = link["part_number"]
        gid = link["graphic_code"]
        icur.execute(
            """
            SELECT TOP 1
              g.id, g.width, g.height, g.fkGraphicFormat, g.isParts,
              lg.title, lg.path, lg.width, lg.height, lg.imageData
            FROM dbo.Graphics g
            INNER JOIN dbo.LocalizedGraphics lg ON lg.fkGraphic = g.id
            WHERE LTRIM(RTRIM(g.id)) = ?
              AND lg.imageData IS NOT NULL
              AND DATALENGTH(lg.imageData) > 0
            ORDER BY DATALENGTH(lg.imageData) DESC
            """,
            gid,
        )
        row = icur.fetchone()
        if not row:
            ve.log(f"    missing imageData for graphic {gid} (PN {pn})")
            continue
        blob = bytes(row[9]) if row[9] is not None else b""
        if not blob:
            continue
        fmt_id = row[3]
        mime_hint = link.get("mime") or fmt_map.get(int(fmt_id) if fmt_id is not None else -1)
        ext = sniff_ext(blob, str(mime_hint) if mime_hint else None)
        w = row[7] or row[1]
        h = row[8] or row[2]
        title = str(row[5] or link.get("url") or "").strip() or None

        dest = out_dir / f"{pn}.{ext}"
        if dest.exists() and dest.read_bytes() != blob:
            dest = out_dir / f"{pn}_g{re.sub(r'[^A-Za-z0-9_-]', '_', gid)}.{ext}"
        if not dest.exists() or dest.read_bytes() != blob:
            dest.write_bytes(blob)
            written += 1
            ve.log(
                f"    wrote {dest.name} ({len(blob)} B, mime={mime_hint}, "
                f"hotspot={link.get('hotspot')}, gid={gid})"
            )

        rel = f"vida_part_images/{dest.name}"
        entry = index_entries.setdefault(
            pn,
            {
                "part_number": pn,
                "files": [],
                "wiring_codes": [],
                "roles_seen": [],
                "title_ru": None,
                "title_en": None,
                "graphic_ids": [],
            },
        )
        if gid not in entry["graphic_ids"]:
            entry["graphic_ids"].append(gid)
        if title and not entry.get("title_en"):
            entry["title_en"] = title
        if not any(f.get("path") == rel for f in entry["files"]):
            entry["files"].append(
                {
                    "path": rel,
                    "w": int(w) if w is not None else None,
                    "h": int(h) if h is not None else None,
                    "source": "ImageRepository",
                    "graphic_id": gid,
                    "hotspot_key": link.get("hotspot"),
                    "attachment_id": link.get("attachment_id"),
                    "mime": link.get("mime"),
                }
            )
    return written


def merge_meta_into_index(
    index_entries: dict[str, dict[str, Any]],
    pn_meta: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pn, entry in sorted(index_entries.items()):
        m = pn_meta.get(pn) or {}
        codes = sorted(set(entry.get("wiring_codes") or []) | set(m.get("wiring_codes") or []))
        roles = sorted(set(entry.get("roles_seen") or []) | set(m.get("roles_seen") or []))
        rec = {
            "part_number": pn,
            "files": entry.get("files") or [],
            "wiring_codes": codes,
            "roles_seen": roles,
            "title_ru": entry.get("title_ru") or m.get("title_ru"),
            "title_en": entry.get("title_en") or m.get("title_en"),
        }
        if entry.get("graphic_ids"):
            rec["graphic_ids"] = entry["graphic_ids"]
        out.append(rec)
    return out


def prefer_primary_files(
    records: list[dict[str, Any]], out_dir: Path
) -> list[dict[str, Any]]:
    """
    Keep one plate per PN for UI.
    Prefer wiring-code-scoped files; otherwise prefer mid/small CGM (connector plates),
    not the largest worldwide assembly drawings (HVAC etc.).
    """
    trimmed: list[dict[str, Any]] = []
    for rec in records:
        files = list(rec.get("files") or [])
        scored: list[tuple[tuple, dict[str, Any], Path]] = []
        for f in files:
            p = _REPO / "data" / f["path"]
            if not p.is_file():
                continue
            size = p.stat().st_size
            has_code = 1 if f.get("wiring_code") else 0
            # Prefer svg; among cgm prefer ~8–120 KB (typical connector plates)
            ext = p.suffix.lower()
            ext_rank = 0 if ext == ".svg" else 1
            if has_code:
                size_penalty = 0
            elif size < 4_000:
                size_penalty = 2
            elif size <= 120_000:
                size_penalty = 0
            elif size <= 250_000:
                size_penalty = 1
            else:
                size_penalty = 3  # huge exploded views
            # lower tuple wins
            scored.append(((0 if has_code else 1, ext_rank, size_penalty, size), f, p))
        if not scored:
            continue
        scored.sort(key=lambda t: t[0])
        _score, best, best_path = scored[0]
        pn = rec["part_number"]
        code = str(best.get("wiring_code") or "").strip()
        ext = best_path.suffix.lstrip(".") or "bin"
        if code:
            slug = re.sub(r"[^\w]+", "-", code).strip("-")
            canonical = out_dir / f"{pn}__{slug}.{ext}"
        else:
            canonical = out_dir / f"{pn}.{ext}"
        if best_path.resolve() != canonical.resolve():
            if not canonical.exists() or canonical.read_bytes() != best_path.read_bytes():
                canonical.write_bytes(best_path.read_bytes())
            best = {**best, "path": f"vida_part_images/{canonical.name}"}
        else:
            best = {**best, "path": f"vida_part_images/{canonical.name}"}
        # Keep code-scoped files + one default
        keep = [best]
        for f in files:
            if f.get("wiring_code") and f.get("path") != best.get("path"):
                p = _REPO / "data" / f["path"]
                if p.is_file() and not any(k.get("path") == f["path"] for k in keep):
                    keep.append(f)
        trimmed.append({**rec, "files": keep})
    return trimmed


def _safe_code_slug(code: str) -> str:
    return re.sub(r"[^\w]+", "-", str(code).strip()).strip("-") or "x"


def resolve_plates_for_wiring_codes(
    epc_cur,
    wiring_codes: set[str],
    part_numbers: set[str] | None = None,
) -> list[dict[str, Any]]:
    """
    PN plate for a specific Volvo wiring designation (e.g. 3/80), not worldwide.

    Join: Lexicon type1 description = code → CatalogueComponents → parent AttachmentData.
    Terminals/BOM siblings on the same parent share that plate (+ their HotspotKey).
    """
    if not wiring_codes:
        return []
    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()  # pn, code, graphic

    for code in sorted(wiring_codes):
        epc_cur.execute(
            """
            SELECT DISTINCT
              LTRIM(RTRIM(pi.ItemNumber)) AS pn,
              cc.Id AS cc_id,
              cc.ParentComponentId,
              LTRIM(RTRIM(cc.HotspotKey)) AS hotspot,
              ISNULL(cc.IndentationLevel, 0) AS ind,
              cc.SequenceId
            FROM dbo.ComponentDescriptions AS code_cd
            JOIN dbo.Lexicon AS code_lex
              ON code_lex.DescriptionId = code_cd.DescriptionId
             AND code_lex.fkLanguage IN (15, 16)
            JOIN dbo.CatalogueComponents AS cc ON cc.Id = code_cd.fkCatalogueComponent
            JOIN dbo.PartItems AS pi ON pi.Id = cc.fkPartItem
            WHERE code_cd.DescriptionTypeId = 1
              AND LTRIM(RTRIM(code_lex.Description)) = ?
              AND pi.ItemNumber IS NOT NULL
              AND LTRIM(RTRIM(pi.ItemNumber)) <> N''
            """,
            code,
        )
        anchors = epc_cur.fetchall()
        if not anchors:
            ve.log(f"    wiring {code}: no catalogue anchors")
            continue

        # Collect unique parents → attachment
        parent_ids = sorted({int(a[2]) for a in anchors if a[2] is not None})
        parent_att: dict[int, tuple] = {}
        for pid in parent_ids:
            epc_cur.execute(
                """
                SELECT TOP 1 ad.Id, LTRIM(RTRIM(ad.Code)), ad.MIME, ad.URL, ca.AttachmentTypeId
                FROM dbo.ComponentAttachments ca
                INNER JOIN dbo.AttachmentData ad ON ad.Id = ca.fkAttachmentData
                WHERE ca.fkCatalogueComponent = ?
                ORDER BY ca.SequenceId
                """,
                pid,
            )
            row = epc_cur.fetchone()
            if row:
                parent_att[pid] = row

        # Sibling rows on those parents (for BOM terminals)
        siblings_by_parent: dict[int, list] = {}
        if parent_ids:
            ph = ",".join("?" for _ in parent_ids)
            epc_cur.execute(
                f"""
                SELECT
                  c.ParentComponentId,
                  c.Id,
                  c.SequenceId,
                  ISNULL(c.IndentationLevel, 0),
                  LTRIM(RTRIM(ISNULL(pi.ItemNumber, N''))),
                  LTRIM(RTRIM(c.HotspotKey))
                FROM dbo.CatalogueComponents c
                LEFT JOIN dbo.PartItems pi ON pi.Id = c.fkPartItem
                WHERE c.ParentComponentId IN ({ph})
                ORDER BY c.ParentComponentId, c.SequenceId, c.Id
                """,
                parent_ids,
            )
            for row in epc_cur.fetchall():
                siblings_by_parent.setdefault(int(row[0]), []).append(row)

        def add_link(pn: str, parent_id: int, hotspot: str | None, cc_id: int) -> None:
            att = parent_att.get(parent_id)
            if not att:
                return
            att_id, gid, mime, url, att_type = att
            gid_s = str(gid or "").strip()
            if not gid_s:
                return
            key = (pn, code, gid_s)
            if key in seen:
                return
            if part_numbers is not None and pn not in part_numbers:
                return
            seen.add(key)
            results.append(
                {
                    "part_number": pn,
                    "wiring_code": code,
                    "graphic_code": gid_s,
                    "mime": mime,
                    "url": url,
                    "attachment_id": att_id,
                    "attachment_type_id": att_type,
                    "hotspot": hotspot,
                    "cc_id": cc_id,
                    "attachment_cc_id": parent_id,
                }
            )

        for pn, cc_id, parent_id, hotspot, ind, seq in anchors:
            pn_s = str(pn).strip()
            if parent_id is None:
                continue
            add_link(pn_s, int(parent_id), str(hotspot).strip() if hotspot else None, int(cc_id))
            # BOM siblings after this anchor (deeper indentation) — terminals/seals
            sibs = siblings_by_parent.get(int(parent_id), [])
            collecting = False
            for _pid, sid, sseq, sind, spart, shot in sibs:
                if int(sid) == int(cc_id):
                    collecting = True
                    continue
                if not collecting:
                    continue
                if int(sseq) <= int(seq or 0):
                    continue
                if int(sind) <= int(ind or 0):
                    break
                sp = str(spart or "").strip()
                if not sp or sp == pn_s:
                    continue
                add_link(sp, int(parent_id), str(shot).strip() if shot else None, int(sid))

        ve.log(f"    wiring {code}: {sum(1 for r in results if r['wiring_code']==code)} plate links")

    return results


def extract_wiring_code_plate_images(
    img_conn,
    epc_conn,
    wiring_codes: set[str],
    out_dir: Path,
    index_entries: dict[str, dict[str, Any]],
    part_numbers: set[str] | None = None,
) -> int:
    """Extract plates scoped to wiring designations (correct connector context)."""
    ecur = epc_conn.cursor()
    icur = img_conn.cursor()
    icur.execute("SELECT id, description FROM dbo.GraphicFormats")
    fmt_map = {int(r[0]): str(r[1] or "") for r in icur.fetchall()}

    links = resolve_plates_for_wiring_codes(ecur, wiring_codes, part_numbers)
    ve.log(f"  wiring-scoped plate links: {len(links)}")
    written = 0

    for link in links:
        pn = link["part_number"]
        code = link["wiring_code"]
        gid = link["graphic_code"]
        icur.execute(
            """
            SELECT TOP 1
              g.id, g.width, g.height, g.fkGraphicFormat, g.isParts,
              lg.title, lg.path, lg.width, lg.height, lg.imageData
            FROM dbo.Graphics g
            INNER JOIN dbo.LocalizedGraphics lg ON lg.fkGraphic = g.id
            WHERE LTRIM(RTRIM(g.id)) = ?
              AND lg.imageData IS NOT NULL
              AND DATALENGTH(lg.imageData) > 0
            ORDER BY DATALENGTH(lg.imageData) DESC
            """,
            gid,
        )
        row = icur.fetchone()
        if not row:
            continue
        blob = bytes(row[9]) if row[9] is not None else b""
        if not blob:
            continue
        fmt_id = row[3]
        mime_hint = link.get("mime") or fmt_map.get(int(fmt_id) if fmt_id is not None else -1)
        ext = sniff_ext(blob, str(mime_hint) if mime_hint else None)
        w = row[7] or row[1]
        h = row[8] or row[2]
        title = str(row[5] or link.get("url") or "").strip() or None
        slug = _safe_code_slug(code)
        dest = out_dir / f"{pn}__{slug}.{ext}"
        if dest.exists() and dest.read_bytes() != blob:
            dest = out_dir / f"{pn}__{slug}_{gid[-8:]}.{ext}"
        if not dest.exists() or dest.read_bytes() != blob:
            dest.write_bytes(blob)
            written += 1
            ve.log(
                f"    wrote {dest.name} ({len(blob)} B, code={code}, "
                f"hotspot={link.get('hotspot')}, gid={gid})"
            )

        rel = f"vida_part_images/{dest.name}"
        entry = index_entries.setdefault(
            pn,
            {
                "part_number": pn,
                "files": [],
                "wiring_codes": [],
                "roles_seen": [],
                "title_ru": None,
                "title_en": None,
                "graphic_ids": [],
            },
        )
        if code not in entry["wiring_codes"]:
            entry["wiring_codes"].append(code)
        if gid not in entry["graphic_ids"]:
            entry["graphic_ids"].append(gid)
        if title and not entry.get("title_en"):
            entry["title_en"] = title
        if not any(f.get("path") == rel for f in entry["files"]):
            entry["files"].append(
                {
                    "path": rel,
                    "w": int(w) if w is not None else None,
                    "h": int(h) if h is not None else None,
                    "source": "ImageRepository",
                    "graphic_id": gid,
                    "hotspot_key": link.get("hotspot"),
                    "attachment_id": link.get("attachment_id"),
                    "mime": link.get("mime"),
                    "wiring_code": code,
                }
            )
    return written


def convert_cgm_files_to_svg(records: list[dict[str, Any]], out_dir: Path) -> int:
    """Convert CGM entries to SVG; prepend SVG path so API prefers it."""
    try:
        from cgm import extract_vector_svg_from_bytes
    except ImportError:
        ve.log("  WARNING: python-cgm not installed — skip SVG (`pip install python-cgm`)")
        return 0
    n = 0
    for rec in records:
        files = list(rec.get("files") or [])
        new_files: list[dict[str, Any]] = []
        for f in files:
            path = _REPO / "data" / f["path"]
            if not path.is_file() or path.suffix.lower() != ".cgm":
                new_files.append(f)
                continue
            svg_path = path.with_suffix(".svg")
            try:
                svg = extract_vector_svg_from_bytes(path.read_bytes())
                if not isinstance(svg, str) or "<svg" not in svg.lower():
                    raise RuntimeError("empty svg")
                svg_path.write_text(svg, encoding="utf-8")
                n += 1
                ve.log(f"    SVG {svg_path.name} ({svg_path.stat().st_size} B)")
                new_files.append(
                    {
                        **f,
                        "path": f"vida_part_images/{svg_path.name}",
                        "mime": "image/svg+xml",
                        "converted_from": f["path"],
                    }
                )
                new_files.append(f)
            except Exception as e:
                ve.log(f"    SVG fail {path.name}: {e}")
                new_files.append(f)
        rec["files"] = new_files
    return n


def merge_index_records(
    existing_path: Path, new_records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    by_pn: dict[str, dict[str, Any]] = {}
    if existing_path.is_file():
        try:
            old = json.loads(existing_path.read_text(encoding="utf-8"))
            for rec in old.get("parts") or []:
                pn = str(rec.get("part_number") or "").strip()
                if pn:
                    by_pn[pn] = rec
        except Exception as e:
            ve.log(f"  merge-index: could not read existing index: {e}")
    for rec in new_records:
        pn = str(rec["part_number"]).strip()
        prev = by_pn.get(pn)
        if not prev:
            by_pn[pn] = rec
            continue
        # Merge files by path; prefer wiring_code entries
        files_by_path = {f.get("path"): f for f in (prev.get("files") or []) if f.get("path")}
        for f in rec.get("files") or []:
            if f.get("path"):
                files_by_path[f["path"]] = f
        codes = sorted(set(prev.get("wiring_codes") or []) | set(rec.get("wiring_codes") or []))
        roles = sorted(set(prev.get("roles_seen") or []) | set(rec.get("roles_seen") or []))
        gids = list(dict.fromkeys([*(prev.get("graphic_ids") or []), *(rec.get("graphic_ids") or [])]))
        by_pn[pn] = {
            **prev,
            **rec,
            "files": list(files_by_path.values()),
            "wiring_codes": codes,
            "roles_seen": roles,
            "graphic_ids": gids,
            "title_en": rec.get("title_en") or prev.get("title_en"),
            "title_ru": rec.get("title_ru") or prev.get("title_ru"),
        }
    return [by_pn[k] for k in sorted(by_pn.keys())]


def find_imagerepository_mdf(manual: Path) -> Path | None:
    for name in ("imagerepository_Data.MDF", "ImageRepository_Data.MDF"):
        p = manual / name
        if p.is_file():
            return p
    hits = list(manual.rglob("*imagerepository*_Data.MDF")) + list(
        manual.rglob("*ImageRepository*_Data.MDF")
    )
    return hits[0] if hits else None


def prepare_sources(
    manual: Path, tmp: Path, *, skip_copy: bool
) -> tuple[Path, Path | None, Path, Path | None]:
    img_src = find_imagerepository_mdf(manual)
    if not img_src:
        raise FileNotFoundError(f"imagerepository_Data.MDF not found under {manual}")
    epc_zip = manual / "EPC.zip"
    if not epc_zip.is_file():
        existing = tmp / "epc" / "EPC_Data.mdf"
        if not existing.is_file():
            raise FileNotFoundError(f"EPC.zip not found at {epc_zip}")
        epc_mdf = existing
        epc_ldf_path = tmp / "epc" / "EPC_Log.ldf"
        epc_ldf = epc_ldf_path if epc_ldf_path.is_file() else None
    else:
        epc_mdf, epc_ldf = ve.unzip_epc(epc_zip, tmp / "epc")

    if skip_copy:
        img_mdf = img_src
        ldf_cand = img_src.with_name(
            img_src.name.replace("_Data", "_Log").replace(".MDF", ".ldf")
        )
        if not ldf_cand.is_file():
            ldf_cand = img_src.with_suffix(".ldf")
        img_ldf = ldf_cand if ldf_cand.is_file() else None
    else:
        img_dest = tmp / "imagerepository" / img_src.name
        img_mdf = ve.copy_if_needed(img_src, img_dest)
        img_ldf = None
    return img_mdf, img_ldf, epc_mdf, epc_ldf


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Probe/extract VIDA EPC + ImageRepository part images")
    ap.add_argument("--manual-dir", default=ve.MANUAL_DIR_DEFAULT)
    ap.add_argument("--tmp-dir", default=ve.TMP_DIR_DEFAULT)
    ap.add_argument("--out-dir", default=OUT_IMAGES_DEFAULT)
    ap.add_argument("--index-out", default=OUT_INDEX_DEFAULT)
    ap.add_argument("--catalog", default=CATALOG_DEFAULT)
    ap.add_argument("--connector-parts", default=CONNECTOR_PARTS_DEFAULT)
    ap.add_argument("--probe-only", action="store_true")
    ap.add_argument("--skip-copy", action="store_true")
    ap.add_argument(
        "--part-numbers",
        default=",".join(DEFAULT_SAMPLE_PNS),
        help="Comma-separated ItemNumbers to extract (default: 10/1 housing+terminal sample)",
    )
    ap.add_argument(
        "--all-catalog",
        action="store_true",
        help="Extract every PN found in harness repair catalog + connector parts",
    )
    ap.add_argument(
        "--primary-only",
        action="store_true",
        help="Keep best plate per PN (wiring-scoped / mid-size; not huge HVAC drawings)",
    )
    ap.add_argument(
        "--svg",
        action="store_true",
        help="Convert primary CGM → SVG (browser-viewable via python-cgm)",
    )
    ap.add_argument(
        "--wiring-codes",
        default="",
        help="Comma-separated Volvo codes (e.g. 3/80,10/1) — extract plates in that catalogue context",
    )
    ap.add_argument(
        "--merge-index",
        action="store_true",
        default=True,
        help="Merge into existing vida_part_image_index.json (default on)",
    )
    ap.add_argument(
        "--replace-index",
        action="store_true",
        help="Overwrite index instead of merging",
    )
    args = ap.parse_args()
    if args.replace_index:
        args.merge_index = False

    manual = Path(args.manual_dir)
    tmp = Path(args.tmp_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pn_meta = load_pn_meta(Path(args.catalog), Path(args.connector_parts))
    if args.all_catalog:
        part_numbers = set(pn_meta.keys())
    else:
        part_numbers = {p.strip() for p in args.part_numbers.split(",") if p.strip()}

    ve.log(f"MANUAL_DIR={manual}")
    ve.log(f"Target PNs ({len(part_numbers)}): {sorted(part_numbers)[:20]}{'…' if len(part_numbers)>20 else ''}")

    try:
        import pyodbc  # noqa: F401
    except ImportError:
        ve.log("ERROR: pyodbc required")
        return 1

    ve.ensure_localdb_started()
    server = ve.resolve_server()
    ve.log(f"SQL server={server}")

    img_mdf, img_ldf, epc_mdf, epc_ldf = prepare_sources(manual, tmp, skip_copy=args.skip_copy)
    ve.log(f"Image MDF: {img_mdf}")
    ve.log(f"EPC MDF: {epc_mdf}")

    probe: dict[str, Any] = {"generated_at": datetime.now(timezone.utc).isoformat()}
    index_entries: dict[str, dict[str, Any]] = {}
    written_total = 0

    try:
        ve.attach_mdf(server, ve.DB_IMAGE, img_mdf, img_ldf)
        ve.attach_mdf(server, ve.DB_EPC, epc_mdf, epc_ldf)

        img_conn = ve.get_odbc_connection(server, ve.DB_IMAGE)
        epc_conn = ve.get_odbc_connection(server, ve.DB_EPC)
        try:
            ve.log("=== PROBE ImageRepository ===")
            probe["image"] = probe_image_repo(img_conn)
            ve.log("=== PROBE EPC ===")
            probe["epc"] = probe_epc(epc_conn)

            probe_path = _REPO / "data" / "reports" / "epc-part-images-probe.json"
            probe_path.parent.mkdir(parents=True, exist_ok=True)
            probe_path.write_text(json.dumps(probe, ensure_ascii=False, indent=2), encoding="utf-8")
            ve.log(f"Wrote probe → {probe_path}")

            if args.probe_only:
                return 0

            wiring_codes = {c.strip() for c in str(args.wiring_codes or "").split(",") if c.strip()}
            if wiring_codes:
                ve.log(f"=== EXTRACT wiring-scoped plates: {sorted(wiring_codes)} ===")
                # When only wiring codes given, don't force default sample PNs
                pn_filter = None if args.all_catalog or not args.part_numbers else part_numbers
                if args.part_numbers == ",".join(DEFAULT_SAMPLE_PNS) and not args.all_catalog:
                    # default sample PNs ignored when --wiring-codes set without explicit PNs
                    pn_filter = None
                written_total += extract_wiring_code_plate_images(
                    img_conn,
                    epc_conn,
                    wiring_codes,
                    out_dir,
                    index_entries,
                    part_numbers=pn_filter,
                )
            else:
                ve.log("=== EXTRACT PN → parent plate → ImageRepository.imageData ===")
                written_total += extract_pn_plate_images(
                    img_conn, epc_conn, part_numbers, out_dir, index_entries
                )

            records = merge_meta_into_index(index_entries, pn_meta)
            records = [r for r in records if r.get("files")]

            if args.primary_only or wiring_codes:
                ve.log("=== PREFER best plate per PN (wiring-scoped / mid-size) ===")
                records = prefer_primary_files(records, out_dir)

            if args.svg:
                ve.log("=== CONVERT CGM → SVG ===")
                convert_cgm_files_to_svg(records, out_dir)

            index_path = Path(args.index_out)
            if args.merge_index:
                records = merge_index_records(index_path, records)

            # Validate paths exist
            missing = []
            for rec in records:
                for f in rec["files"]:
                    p = _REPO / "data" / f["path"]
                    if not p.is_file():
                        missing.append(str(p))
            if missing:
                ve.log(f"WARNING: missing files referenced in index: {missing}")

            requested = set(part_numbers)
            if wiring_codes:
                requested = {r["part_number"] for r in records} | set(part_numbers)

            payload = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "ImageRepository LocalizedGraphics.imageData + EPC AttachmentData",
                "count": len(records),
                "files_written_this_run": written_total,
                "part_numbers_requested": sorted(requested),
                "wiring_codes": sorted(wiring_codes) if wiring_codes else None,
                "parts": records,
            }
            index_path.parent.mkdir(parents=True, exist_ok=True)
            index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            ve.log(f"Wrote index → {index_path} ({len(records)} parts, {written_total} files written)")

            have = {r["part_number"] for r in records}
            if wiring_codes:
                for code in sorted(wiring_codes):
                    n = sum(1 for r in records if code in (r.get("wiring_codes") or []) or any(f.get("wiring_code")==code for f in r.get("files") or []))
                    ve.log(f"  wiring {code}: {n} PNs with plate")
                return 0 if any(have) else 2
            missing_req = sorted(part_numbers - have)
            for pn in sorted(part_numbers)[:20]:
                ve.log(f"  PN {pn}: {'OK' if pn in have else 'MISSING'}")
            if missing_req:
                ve.log(f"  missing ({len(missing_req)}): {missing_req[:12]}")
            return 0 if not missing_req else 2
        finally:
            img_conn.close()
            epc_conn.close()
    finally:
        try:
            ve.detach_db(server, ve.DB_IMAGE)
        except Exception as e:
            ve.log(f"detach image: {e}")
        try:
            ve.detach_db(server, ve.DB_EPC)
        except Exception as e:
            ve.log(f"detach epc: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
