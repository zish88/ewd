"""
Import Capital EWD logical connectivity from Signals/connectivity*.zip
(files are gzip-compressed XML despite .zip extension).
"""
from __future__ import annotations

import gzip
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .paths import find_package_root, package_data_dir

VOLVO_CODE_RE = re.compile(r"^(\d+)/(\d+)", re.I)


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def iter_connectivity_files(data_dir: Path) -> list[Path]:
    sig = data_dir / "Signals"
    if not sig.is_dir():
        return []
    return sorted(sig.glob("connectivity*.zip"))


def read_connectivity_xml(path: Path) -> bytes:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    # Plain XML fallback
    if raw.lstrip()[:1] == b"<":
        return raw
    # Real zip (rare)
    import zipfile
    import io

    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        name = zf.namelist()[0]
        return zf.read(name)


def parse_connectivity_bytes(data: bytes, source_name: str = "") -> dict[str, Any]:
    root = ET.fromstring(data)
    design_name = root.get("name") or ""
    design_id = root.get("id") or ""

    devices: list[dict[str, Any]] = []
    wires: list[dict[str, Any]] = []
    pin_links: list[dict[str, str]] = []

    def prop_map(elem: ET.Element) -> dict[str, str]:
        out: dict[str, str] = {}
        for p in elem:
            if _local(p.tag) == "property":
                out[p.get("name") or ""] = p.get("val") or ""
        return out

    def ingest_owner(elem: ET.Element, kind: str) -> None:
        props = prop_map(elem)
        name = (elem.get("name") or "").strip()
        pins = []
        for pin in elem:
            if _local(pin.tag) != "pin":
                continue
            pp = prop_map(pin)
            connected = pin.get("connectedpin") or ""
            pins.append(
                {
                    "id": pin.get("id") or "",
                    "name": pin.get("name") or "",
                    "connectedpin": connected,
                    "optionExpression": pin.get("optionExpression") or "",
                    "PN": pp.get("PN", ""),
                    "PPIN": pp.get("PPIN", ""),
                    "sourceObjectUID": pp.get("sourceObjectUID", ""),
                }
            )
            if connected:
                pin_links.append(
                    {
                        "fromPin": pin.get("id") or "",
                        "toPin": connected,
                        "device": name,
                    }
                )
        devices.append(
            {
                "id": elem.get("id") or "",
                "name": name,
                "kind": kind,
                "code": (
                    f"{m.group(1)}/{m.group(2)}"
                    if (m := VOLVO_CODE_RE.match(name))
                    else ""
                ),
                "optionExpression": elem.get("optionExpression") or "",
                "sourceDesignUID": props.get("sourceDesignUID", ""),
                "sourceObjectUID": props.get("sourceObjectUID", ""),
                "ServiceDescription": props.get("ServiceDescription", "")
                or (elem.get("shortdescription") or ""),
                "pinCount": len(pins),
                "pins": pins,
            }
        )

    for elem in root.iter():
        tag = _local(elem.tag)
        if tag == "device":
            ingest_owner(elem, "device")
        elif tag == "connector":
            # Inline connectors (e.g. 74/309 bumper) carry the same Volvo codes
            ingest_owner(elem, "connector")
        elif tag == "wire":
            props = prop_map(elem)
            pinrefs = [
                c.get("pinref") or ""
                for c in elem
                if _local(c.tag) == "connection" and c.get("pinref")
            ]
            start = elem.get("startpinref") or ""
            if start and start not in pinrefs:
                pinrefs = [start, *pinrefs]
            wires.append(
                {
                    "id": elem.get("id") or "",
                    "name": elem.get("name") or "",
                    "optionExpression": elem.get("optionexpression")
                    or elem.get("optionExpression")
                    or "",
                    "wirecsa": elem.get("wirecsa") or props.get("wirecsa", ""),
                    "wirecolor": elem.get("wirecolor") or "",
                    "color": elem.get("colordesc")
                    or props.get("ServiceColor")
                    or props.get("colordescription")
                    or "",
                    "harness": elem.get("harness") or "",
                    "shortdescription": elem.get("shortdescription") or "",
                    "startpinref": start,
                    "pinrefs": pinrefs,
                    "sourceObjectUID": props.get("sourceObjectUID", ""),
                    "sourceDesignUID": props.get("sourceDesignUID", ""),
                    "sharedObjectUID": props.get("sharedObjectUID", ""),
                }
            )
            if len(pinrefs) >= 2:
                pin_links.append(
                    {
                        "fromPin": pinrefs[0],
                        "toPin": pinrefs[1],
                        "wire": elem.get("name") or "",
                        "wireId": elem.get("id") or "",
                        "sourceObjectUID": props.get("sourceObjectUID", ""),
                    }
                )

    return {
        "source": source_name,
        "designId": design_id,
        "designName": design_name,
        "deviceCount": len(devices),
        "wireCount": len(wires),
        "pinLinkCount": len(pin_links),
        "devices": devices,
        "wires": wires,
        "pinLinks": pin_links,
    }


def summarize_file(path: Path) -> dict[str, Any]:
    """Lightweight summary without storing full pin lists."""
    try:
        data = read_connectivity_xml(path)
        rec = parse_connectivity_bytes(data, source_name=path.name)
    except Exception as e:
        return {
            "source": path.name,
            "error": str(e),
            "deviceCount": 0,
            "wireCount": 0,
        }
    device_codes = sorted(
        {d["code"] for d in rec["devices"] if d.get("code")}
    )
    # code -> sourceDesignUIDs present in this file (for system-scoped lookup)
    code_designs: dict[str, list[str]] = {}
    for d in rec["devices"]:
        code = d.get("code") or ""
        sdu = d.get("sourceDesignUID") or ""
        if code and sdu:
            code_designs.setdefault(code, [])
            if sdu not in code_designs[code]:
                code_designs[code].append(sdu)
    return {
        "source": path.name,
        "designId": rec["designId"],
        "designName": rec["designName"],
        "deviceCount": rec["deviceCount"],
        "wireCount": rec["wireCount"],
        "pinLinkCount": rec["pinLinkCount"],
        # Do not truncate codes — connectors like 74/309 must remain in the index map
        "deviceCodes": device_codes,
        "deviceCodeCount": len(device_codes),
        "codeDesignUIDs": {k: v for k, v in sorted(code_designs.items())},
        "sourceDesignUIDs": sorted(
            {
                d["sourceDesignUID"]
                for d in rec["devices"]
                if d.get("sourceDesignUID")
            }
        ),
    }


def build_connectivity_index(
    data_dir: Path,
    *,
    max_files: int | None = None,
    full_parse_limit: int = 3,
    write_full_dir: Path | None = None,
) -> dict[str, Any]:
    files = iter_connectivity_files(data_dir)
    total = len(files)
    if max_files is not None:
        files = files[:max_files]

    summaries: list[dict[str, Any]] = []
    code_to_files: dict[str, list[str]] = {}
    code_to_system_files: dict[str, dict[str, list[str]]] = {}
    errors = 0

    for i, path in enumerate(files):
        summary = summarize_file(path)
        if summary.get("error"):
            errors += 1
        else:
            for code in summary.get("deviceCodes") or []:
                code_to_files.setdefault(code, []).append(path.name)
            for code, designs in (summary.get("codeDesignUIDs") or {}).items():
                bucket = code_to_system_files.setdefault(code, {})
                for sdu in designs:
                    bucket.setdefault(sdu, []).append(path.name)
        summaries.append(summary)
        if (i + 1) % 200 == 0:
            print(f"  connectivity: {i + 1}/{len(files)}…", flush=True)

    # Full parse of first N files for netlist prototyping
    full_samples: list[dict[str, Any]] = []
    if write_full_dir is not None:
        write_full_dir.mkdir(parents=True, exist_ok=True)
    for path in files[:full_parse_limit]:
        try:
            data = read_connectivity_xml(path)
            rec = parse_connectivity_bytes(data, source_name=path.name)
            # Drop bulky pin detail in index sample; write full beside
            if write_full_dir is not None:
                out_full = write_full_dir / f"{path.stem}.json"
                out_full.write_text(
                    json.dumps(rec, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            full_samples.append(
                {
                    "source": rec["source"],
                    "designName": rec["designName"],
                    "deviceCount": rec["deviceCount"],
                    "wireCount": rec["wireCount"],
                    "pinLinkCount": rec["pinLinkCount"],
                    "sampleDevices": rec["devices"][:5],
                    "sampleWires": rec["wires"][:5],
                    "samplePinLinks": rec["pinLinks"][:10],
                }
            )
        except Exception as e:
            full_samples.append({"source": path.name, "error": str(e)})

    # Keep ALL codes (connectors like 74/309 were previously truncated at 500)
    code_map = {
        k: sorted(set(v))[:40]
        for k, v in sorted(code_to_files.items(), key=lambda kv: kv[0])
    }
    system_map: dict[str, dict[str, list[str]]] = {}
    for code, by_sys in sorted(code_to_system_files.items(), key=lambda kv: kv[0]):
        system_map[code] = {
            sdu: sorted(set(flist))[:40]
            for sdu, flist in sorted(by_sys.items(), key=lambda kv: kv[0])
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "connectivity_files_total": total,
        "connectivity_files_scanned": len(files),
        "errors": errors,
        "summaries": summaries,
        "codeToConnectivityFiles": code_map,
        "codeToSystemFiles": system_map,
        "fullSamples": full_samples,
        "note": "connectivity*.zip are gzip XML; devices+connectors indexed; codeToSystemFiles scopes by sourceDesignUID",
    }


def run(
    ewd_root: Path | None = None,
    out_path: Path | None = None,
    *,
    max_files: int | None = 50,
    full_parse_limit: int = 3,
) -> Path:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    out = out_path or Path("data") / "ewd" / "connectivity_index.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    full_dir = out.parent / "connectivity_samples"
    payload = build_connectivity_index(
        data,
        max_files=max_files,
        full_parse_limit=full_parse_limit,
        write_full_dir=full_dir,
    )
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
