"""
Parse Capital FaceViews HTML → face_view_index.json

Each cavity cell embeds: <span id="UID…$optionExpr" data-systemUID="UID…">N</span>
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from .paths import find_package_root, package_data_dir

UID_RE = re.compile(r"^(UID[0-9a-fA-F-]+)(?:\$(.*))?$", re.I)
CODE_RE = re.compile(r"^(\d+)[A-Z]?/(\d+)", re.I)
# FaceView HTML next to FaceViews SVG often named after connector object UID;
# parent design folder = systemUid. Object→code comes from device_index merge later.


class _FaceTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[dict[str, str]]] = []
        self._row: list[dict[str, str]] | None = None
        self._cell: dict[str, str] | None = None
        self._capture = False
        self._buf = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        if tag == "tr":
            self._row = []
        elif tag == "td" and self._row is not None:
            self._cell = {"text": "", "uid": "", "option": "", "systemUid": ""}
            self._capture = True
            self._buf = ""
        elif tag == "span" and self._cell is not None:
            sid = ad.get("id") or ""
            m = UID_RE.match(sid)
            if m:
                self._cell["uid"] = m.group(1)
                self._cell["option"] = (m.group(2) or "").strip()
            self._cell["systemUid"] = ad.get("data-systemuid") or ad.get("data-systemUID") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._cell is not None and self._row is not None:
            self._cell["text"] = self._buf.strip()
            self._row.append(self._cell)
            self._cell = None
            self._capture = False
            self._buf = ""
        elif tag == "tr" and self._row is not None:
            if self._row and not all(
                (c.get("text") or "").lower()
                in ("cavity", "wire/net name", "color", "csa", "option", "multicore", "spec", "material", "v-min", "mated pin", "mated pinlist", "end 2 pin", "end 2 pin list", "overbraid", "")
                for c in self._row
            ):
                # skip pure header rows (all known headers / empty)
                headers = {"cavity", "wire/net name", "wire/net name ", "color", "csa"}
                texts = [(c.get("text") or "").strip().lower() for c in self._row]
                if not (texts and texts[0] in headers):
                    self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buf += data


def _parse_face_html(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    p = _FaceTableParser()
    try:
        p.feed(raw)
    except Exception:
        return []
    pins: list[dict[str, Any]] = []
    for row in p.rows:
        if len(row) < 4:
            continue
        cavity = (row[0].get("text") or "").strip()
        if not cavity or not re.match(r"^[0-9A-Z]{1,4}$", cavity, re.I):
            continue
        wire_name = (row[1].get("text") or "").strip() if len(row) > 1 else ""
        # Color column is typically index 3 (after Multicore)
        color = ""
        csa = ""
        option = ""
        mated_pin = ""
        mated_code = ""
        end2_pin = ""
        end2_code = ""
        for i, cell in enumerate(row):
            t = (cell.get("text") or "").strip()
            if i == 3 and re.match(r"^[A-Z]{2}(/[A-Z]{2})?$", t, re.I):
                color = t.replace("/", "-")
            if i == 5 and re.match(r"^\d+(\.\d+)?$", t):
                csa = t
            if i == 8 and t and t != "-":
                option = t
            if i == 9 and t and t != "-":
                mated_pin = t
            if i == 10 and t and t != "-":
                mated_code = t
            if i == 11 and t and t != "-":
                end2_pin = t
            if i == 12 and t and t != "-":
                end2_code = t
        # Prefer End 2 as peer when present
        peer_code = ""
        peer_pin = ""
        if CODE_RE.match(end2_code or ""):
            m = CODE_RE.match(end2_code)
            peer_code = f"{m.group(1)}/{m.group(2)}" if m else end2_code
            peer_pin = end2_pin
        elif CODE_RE.match(mated_code or ""):
            m = CODE_RE.match(mated_code)
            peer_code = f"{m.group(1)}/{m.group(2)}" if m else mated_code
            peer_pin = mated_pin

        pin_uid = row[0].get("uid") or ""
        wire_uid = row[1].get("uid") or "" if len(row) > 1 else ""
        system_uid = (
            row[0].get("systemUid")
            or (row[1].get("systemUid") if len(row) > 1 else "")
            or ""
        )
        opt = row[0].get("option") or option or ""
        pins.append(
            {
                "cavity": cavity,
                "wireName": wire_name,
                "color": color,
                "gauge": csa,
                "optionExpression": opt,
                "pinUid": pin_uid,
                "wireUid": wire_uid,
                "systemUid": system_uid,
                "peerCode": peer_code,
                "peerPin": peer_pin,
                "peerUid": (row[12].get("uid") if len(row) > 12 else "")
                or (row[11].get("uid") if len(row) > 11 else "")
                or "",
            }
        )
    return pins


def _object_code_map(data_dir: Path) -> dict[str, str]:
    """objectId → Volvo code from catalogs."""
    from .index_devices import _parse_object_catalog  # type: ignore

    out: dict[str, str] = {}
    for fname, kind in (
        ("devices.xml", "device"),
        ("connectors.xml", "connector"),
        ("inlines.xml", "inline"),
        ("splices.xml", "splice"),
        ("grounds.xml", "ground"),
    ):
        for row in _parse_object_catalog(data_dir / fname, kind):
            oid = row.get("objectId") or ""
            code = row.get("code") or ""
            if oid.startswith("UID") and "/" in code:
                out[oid] = code
    # per-design
    for ddir in data_dir.iterdir():
        if not ddir.is_dir() or not ddir.name.startswith("UID"):
            continue
        for fname, kind in (
            ("devices.xml", "device"),
            ("connectors.xml", "connector"),
            ("inlines.xml", "inline"),
        ):
            for row in _parse_object_catalog(ddir / fname, kind):
                oid = row.get("objectId") or ""
                code = row.get("code") or ""
                if oid.startswith("UID") and "/" in code:
                    out[oid] = code
    return out


def build_face_view_index(data_dir: Path) -> dict[str, Any]:
    code_map = _object_code_map(data_dir)
    by_code: dict[str, list[dict[str, Any]]] = {}
    by_key: dict[str, list[dict[str, Any]]] = {}
    files = 0
    pin_rows = 0
    for ddir in sorted(p for p in data_dir.iterdir() if p.is_dir() and p.name.startswith("UID")):
        fv = ddir / "FaceViews"
        if not fv.is_dir():
            continue
        design_uid = ddir.name
        for html in sorted(fv.glob("*.html")):
            files += 1
            object_uid = html.stem
            code = code_map.get(object_uid) or ""
            pins = _parse_face_html(html)
            svg_path = fv / f"{object_uid}.svg"
            face_rec = {
                "code": code,
                "objectUid": object_uid,
                "designUid": design_uid,
                "html": str(html.as_posix()),
                "svg": str(svg_path.as_posix()) if svg_path.is_file() else "",
                "pins": pins,
            }
            if code:
                by_code.setdefault(code, []).append(
                    {
                        "objectUid": object_uid,
                        "designUid": design_uid,
                        "html": face_rec["html"],
                        "svg": face_rec["svg"],
                        "pinCount": len(pins),
                    }
                )
            for pin in pins:
                pin_rows += 1
                sys_uid = pin.get("systemUid") or design_uid
                edge = {
                    **pin,
                    "code": code,
                    "objectUid": object_uid,
                    "designUid": design_uid,
                    "faceHtml": face_rec["html"],
                    "faceSvg": face_rec["svg"],
                }
                if code:
                    cavity = str(pin.get("cavity") or "").upper()
                    soft = f"{code}|{cavity}"
                    hard = f"{code}|{cavity}|{sys_uid}"
                    by_key.setdefault(hard, []).append(edge)
                    by_key.setdefault(soft, []).append(edge)
                    by_code.setdefault(code, [])  # ensure key
        if files and files % 50 == 0:
            print(f"  faceviews: {files} files, pins={pin_rows}…", flush=True)

    # Deduplicate by_key
    for k, rows in list(by_key.items()):
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for e in rows:
            sig = f"{e.get('pinUid')}|{e.get('wireUid')}|{e.get('cavity')}|{e.get('peerCode')}"
            if sig in seen:
                continue
            seen.add(sig)
            out.append(e)
        by_key[k] = out[:40]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "face_html_files": files,
        "pin_rows": pin_rows,
        "codes_with_faceview": len([c for c, v in by_code.items() if v]),
        "by_code": {k: v for k, v in sorted(by_code.items()) if v},
        "by_key": {k: v for k, v in sorted(by_key.items()) if "|" in k and v},
        "note": "by_key soft=code|cavity; hard=code|cavity|systemUid; pinUid/wireUid from FaceView span ids",
    }


def run(ewd_root: Path | None = None, out_path: Path | None = None) -> Path:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    out = out_path or Path("data") / "ewd" / "face_view_index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = build_face_view_index(data)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--ewd-root", default=None)
    ap.add_argument("--out", default=str(Path("data") / "ewd" / "face_view_index.json"))
    args = ap.parse_args()
    p = run(Path(args.ewd_root) if args.ewd_root else None, Path(args.out))
    print(f"Wrote {p}")
