#!/usr/bin/env python3
"""Fill components.name_ru for all N/M codes from VIDA + pinout/EN fallbacks."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from vida_extractor import clean_vida_component_name  # noqa: E402

DB_PATH = os.path.join(ROOT, "data", "wiring.sqlite")
VIDA_RU = os.path.join(ROOT, "data", "vida_components_ru.json")
VIDA_PN = os.path.join(ROOT, "data", "vida_connector_parts.json")

ZONE_RU = {
    "front_doors": "передних дверей",
    "rear_doors": "задних дверей",
    "front_bumper": "переднего бампера",
    "rear_bumper": "заднего бампера",
    "trunk": "багажника",
    "engine": "моторного отсека",
    "dashboard": "панели приборов",
    "floor": "пола",
    "roof": "крыши",
    "seats": "сидений",
}

EN_PHRASES = [
    ("Engine Control Module (ECM)", "Блок управления двигателем (ECM)"),
    ("Engine Control Module", "Блок управления двигателем"),
    ("Transmission Control Module (TCM)", "Блок управления КПП (TCM)"),
    ("Central Electronic Module (CEM)", "Центральный электронный модуль (CEM)"),
    ("Driver Door Module (DDM)", "Модуль двери водителя (DDM)"),
    ("Passenger Door Module (PDM)", "Модуль двери пассажира (PDM)"),
    ("Rear Door Module (RDM)", "Модуль задней двери (RDM)"),
    ("Parking Assistance Module (PAM)", "Модуль парктроника (PAM)"),
    ("Injection valves", "Форсунки"),
    ("Front knock sensor", "Датчик детонации передний"),
    ("Door lock", "Замок двери"),
    ("Connector", "Разъём"),
    ("Ground connection", "Точка массы"),
    ("Ground", "Точка массы"),
]

COLOR_RU = {
    "black": "чёрный",
    "white": "белый",
    "grey": "серый",
    "gray": "серый",
    "brown": "коричневый",
    "blue": "синий",
    "green": "зелёный",
    "yellow": "жёлтый",
    "orange": "оранжевый",
    "red": "красный",
}


def localize_en(text: str) -> str:
    s = str(text or "").strip()
    if not s:
        return ""
    for en, ru in EN_PHRASES:
        s = re.sub(re.escape(en), ru, s, flags=re.I)
    return s


def normalize_pinout_title(text: str, code: str) -> str:
    s = str(text or "").strip()
    if not s:
        return ""
    s = re.sub(r"\bConnector\b", "Разъём", s, flags=re.I)
    s = re.sub(r"\bРазъем\b", "Разъём", s)
    # "Разъём 74/310 (16-pin black)" → RU color
    def color_sub(m: re.Match) -> str:
        n, col = m.group(1), m.group(2).lower()
        return f"({n}-pin {COLOR_RU.get(col, col)})"

    s = re.sub(r"\((\d+)-pin\s+([A-Za-z]+)\)", color_sub, s)
    if code and code not in s:
        s = f"{s}"
    return s


def fallback_name(code: str, desc_ru: str, desc_en: str, type_ru: str, home_zone: str) -> str:
    pinout = normalize_pinout_title(desc_ru, code)
    if pinout and not re.match(r"^(Connector|Разъем|Разъём)\s*$", pinout, re.I):
        # Skip bare "Разъём" / English Connector alone
        if not re.fullmatch(r"(Connector|Разъём|Разъем)", pinout, re.I):
            return pinout[:300]
    en = localize_en(desc_en)
    if en and en.lower() not in {"connector", "разъем", "разъём"}:
        return en[:300]
    zone = ZONE_RU.get(home_zone or "", "")
    base = (type_ru or "Компонент").strip() or "Компонент"
    if zone and re.search(r"разъ[её]м", base, re.I):
        return f"Разъём {code} ({zone})"[:300]
    return f"{base} {code}".strip()[:300]


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    force = "--force" in sys.argv
    if not os.path.isfile(DB_PATH):
        print("ERROR: missing wiring.sqlite", file=sys.stderr)
        return 1

    vida_ru: dict = {}
    if os.path.isfile(VIDA_RU):
        vida_ru = json.load(open(VIDA_RU, encoding="utf-8")).get("components") or {}
    vida_pn: dict = {}
    if os.path.isfile(VIDA_PN):
        vida_pn = json.load(open(VIDA_PN, encoding="utf-8")).get("connectors") or {}

    db = sqlite3.connect(DB_PATH)
    cols = {r[1] for r in db.execute("pragma table_info(components)")}
    if "name_ru" not in cols:
        db.execute("ALTER TABLE components ADD COLUMN name_ru TEXT NOT NULL DEFAULT ''")

    comps = list(
        db.execute(
            """
            SELECT component_code, IFNULL(name_ru,''), IFNULL(description_ru,''),
                   IFNULL(description_en,''), IFNULL(component_type_ru,''),
                   IFNULL(home_zone,'')
            FROM components
            """
        )
    )
    updated_vida = 0
    updated_fb = 0
    for code, name_ru, desc_ru, desc_en, type_ru, home_zone in comps:
        code = str(code or "").strip()
        if not code:
            continue
        if name_ru and not force:
            continue
        nice = ""
        if code in vida_ru:
            en_hint = ""
            rec = vida_pn.get(code)
            if isinstance(rec, dict):
                en_hint = str(rec.get("name_en") or "")
            hint = f"{en_hint} {desc_en} {desc_ru}".strip()
            nice = clean_vida_component_name(code, str(vida_ru[code]), hint) or str(vida_ru[code]).strip()
            if nice:
                updated_vida += 1
        if not nice:
            nice = fallback_name(code, desc_ru, desc_en, type_ru, home_zone)
            if nice:
                updated_fb += 1
        if not nice:
            continue
        db.execute("UPDATE components SET name_ru = ? WHERE component_code = ?", (nice[:300], code))

    db.commit()
    filled = db.execute(
        "SELECT COUNT(*) FROM components WHERE TRIM(IFNULL(name_ru,'')) != ''"
    ).fetchone()[0]
    total = db.execute("SELECT COUNT(*) FROM components").fetchone()[0]
    c74 = db.execute(
        "SELECT COUNT(*) FROM components WHERE component_code LIKE '74/%' AND TRIM(IFNULL(name_ru,'')) != ''"
    ).fetchone()[0]
    db.close()
    print(
        f"names_ru ok: vida={updated_vida} fallback={updated_fb} "
        f"filled={filled}/{total} filled_74={c74}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
