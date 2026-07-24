"""Parse langdictionary.xml → lang_ru_index.json (code → RU/EN name)."""
from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import find_package_root, package_data_dir

CODE_RE = re.compile(r"^(\d+)[A-Z]?/(\d+)", re.I)

# Lang column order from package docs:
# EN CN DE ES FI FR IT JA KO NL PT RU SE TCN TH
LANG_ORDER = [
    "EN",
    "CN",
    "DE",
    "ES",
    "FI",
    "FR",
    "IT",
    "JA",
    "KO",
    "NL",
    "PT",
    "RU",
    "SE",
    "TCN",
    "TH",
]


def build_lang_index(data_dir: Path) -> dict[str, Any]:
    path = data_dir / "langdictionary.xml"
    by_code: dict[str, dict[str, str]] = {}
    if not path.is_file():
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "error": f"missing {path}",
            "by_code": {},
        }
    # Detect column order from <Lang> if present
    langs = list(LANG_ORDER)
    try:
        # peek header
        head = path.read_text(encoding="utf-8", errors="replace")[:8000]
        m = re.search(r"<Lang[^>]*>([\s\S]*?)</Lang>", head, re.I)
        if m:
            cols = re.findall(r"<D>([^<]*)</D>", m.group(1))
            if cols:
                langs = [c.strip().upper() for c in cols if c.strip()]
    except Exception:
        pass
    ru_i = langs.index("RU") if "RU" in langs else 11
    en_i = langs.index("EN") if "EN" in langs else 0

    for _event, elem in ET.iterparse(path, events=("end",)):
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag != "E":
            continue
        ds = [
            (d.text or "").strip()
            for d in elem
            if (d.tag.split("}")[-1] if "}" in d.tag else d.tag) == "D"
        ]
        if not ds:
            elem.clear()
            continue
        code_raw = ds[0]
        m = CODE_RE.match(code_raw)
        if not m:
            elem.clear()
            continue
        code = f"{m.group(1)}/{m.group(2)}"
        # Remaining D cells are translations aligned to langs (after code)
        # Structure: first D = code, then one D per language
        translations = ds[1:]
        name_ru = translations[ru_i] if ru_i < len(translations) else ""
        name_en = translations[en_i] if en_i < len(translations) else ""
        # Sometimes first translation column is EN and code is separate — handle mismatch
        if not name_en and translations:
            name_en = translations[0]
        if not name_ru and len(translations) > 11:
            name_ru = translations[11]
        by_code[code] = {
            "code": code,
            "name_en": name_en,
            "name_ru": name_ru,
        }
        elem.clear()

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_dir": str(data_dir),
        "lang_columns": langs,
        "unique_codes": len(by_code),
        "by_code": by_code,
    }


def parse_harness_labels_ru(data_dir: Path) -> dict[str, str]:
    """Parse Introduction/4 - Сокращения_RU.html harness id → RU label."""
    intro = data_dir / "Resources" / "Introduction"
    if not intro.is_dir():
        return {}
    target = None
    for p in intro.glob("*.html"):
        if "Сокращения" in p.name or "sokraschen" in p.name.lower() or p.name.startswith("4 "):
            if "_RU" in p.name or "RU" in p.name:
                target = p
                break
    if not target:
        for p in intro.glob("*RU*.html"):
            if "4" in p.name:
                target = p
                break
    if not target or not target.is_file():
        return {}
    html = target.read_text(encoding="utf-8", errors="replace")
    # rows: <td>14014</td><td>Напольный жгут</td>
    pairs = re.findall(
        r"<td[^>]*>\s*([0-9]{3,6}(?:_[A-Z]{1,4})?)\s*</td>\s*<td[^>]*>\s*([^<]+?)\s*</td>",
        html,
        re.I,
    )
    out: dict[str, str] = {}
    for hid, label in pairs:
        label = re.sub(r"\s+", " ", label).strip()
        if label:
            out[hid.strip()] = label
    return out


def run(
    ewd_root: Path | None = None,
    out_lang: Path | None = None,
    out_harness: Path | None = None,
) -> tuple[Path, Path]:
    package = find_package_root(ewd_root)
    data = package_data_dir(package)
    out_l = out_lang or Path("data") / "ewd" / "lang_ru_index.json"
    out_h = out_harness or Path("data") / "ewd" / "harness_labels.json"
    out_l.parent.mkdir(parents=True, exist_ok=True)
    lang = build_lang_index(data)
    out_l.write_text(json.dumps(lang, ensure_ascii=False), encoding="utf-8")
    harness = parse_harness_labels_ru(data)
    out_h.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "count": len(harness),
                "by_id": harness,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return out_l, out_h


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--ewd-root", default=None)
    args = ap.parse_args()
    a, b = run(Path(args.ewd_root) if args.ewd_root else None)
    print(f"Wrote {a}")
    print(f"Wrote {b}")
