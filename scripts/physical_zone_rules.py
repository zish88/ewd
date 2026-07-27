"""Physical placement rules: component name (RU/EN) -> zone id.

Zone = where the part physically sits on the car, not which harness carries it.
Order matters: first match wins, so specific patterns come before generic ones.
"""
from __future__ import annotations

import re

ZONE_IDS = (
    "front_doors",
    "rear_doors",
    "front_bumper",
    "rear_bumper",
    "trunk",
    "engine",
    "dashboard",
    "floor",
    "roof",
    "seats",
    "other",
)

# (zone, rule name, regex) — evaluated in order, first match wins.
PHYSICAL_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    # --- headliner electronics: must beat "сиденье"/"дверь" wording ----------
    (
        "roof",
        "microphone",
        re.compile(r"микрофон|\bmicrophone\b", re.I),
    ),
    # --- trunk / tailgate / tow bar -----------------------------------------
    # Above roof: «потолочная лампа багажного отсека» belongs to the trunk.
    (
        "trunk",
        "trunk-parts",
        re.compile(
            r"багажн|крышк\w*\s*багаж|пят\w*\s*двер|хвостов\w*\s*двер|"
            r"буксирн\w*\s*(крюк|прицеп)|прицеп|фаркоп|спойлер|"
            r"tailgate|trunk\s*lid|cargo\s*compartment|tow\s*hitch|trailer|"
            r"номерн\w*\s*знак|license\s*plate|"
            r"задн\w*\s*стеклоочист|rear\s*window\s*wiper|"
            r"подогрев\s*задн\w*\s*стекл|heated\s*rear\s*window|"
            r"камер\w*\s*задн|rear\s*view\s*camera|park\s*assist\s*camera",
            re.I,
        ),
    ),
    (
        "roof",
        "roof-parts",
        re.compile(
            r"люк\w*\s*крыш|панорамн|солнцезащитн\w*\s*штор|потолочн|"
            r"плафон\w*\s*салон|консол\w*\s*крыш|точечн\w*\s*свет|reading\s*lamp|"
            r"\broof\b|sunroof|moonroof|headliner|"
            r"датчик\w*\s*дожд|rain\s*sensor|"
            r"внутренн\w*\s*зеркал|interior\s*rear\s*view\s*mirror|"
            r"антенн\w*\s*(крыш|gps)|roof\s*antenna|\bgps\s*antenna",
            re.I,
        ),
    ),
    # --- bumpers -------------------------------------------------------------
    (
        "front_bumper",
        "front-bumper",
        re.compile(
            r"передн\w*\s*бампер|бампер\w*\s*спереди|front\s*bumper|bumper,?\s*front|"
            r"противотуман\w*\s*(фар|свет)\w*\s*передн|front\s*fog|"
            r"омыват\w*\s*фар|headlamp\s*wash|"
            r"радар\w*\s*(передн|направленн\w*\s*вперед)|forward-?aimed\s*radar|\bFLR\b|\bFLC\b|"
            r"направленн\w*\s*вперед\s*радар|"
            r"парктроник\w*\s*передн|park\s*assist\w*\s*front|\bfront\s*pas\b|"
            r"front\s*parking\s*assistance|"
            r"(помощ\w*\s*при\s*парковк|parking\s*assistance).{0,40}передн|"
            r"передн.{0,40}(помощ\w*\s*при\s*парковк|parking\s*assistance)|"
            r"parking\s*sensor\s*side|боков\w*\s*датчик\w*.{0,24}парков|"
            r"датчик\w*.{0,24}парковк\w*.{0,24}боков",
            re.I,
        ),
    ),
    (
        "rear_bumper",
        "rear-bumper",
        re.compile(
            r"задн\w*\s*бампер|бампер\w*\s*сзади|rear\s*bumper|bumper,?\s*rear|"
            r"переходник\w*\s*задн\w*\s*бампер|"
            r"парктроник\w*\s*задн|park\s*assist\w*\s*rear|\brear\s*pas\b|"
            r"rear\s*parking\s*assistance|"
            r"(помощ\w*\s*при\s*парковк|parking\s*assistance).{0,40}задн|"
            r"задн.{0,40}(помощ\w*\s*при\s*парковк|parking\s*assistance)|"
            r"противотуман\w*\s*(фонар|свет)\w*\s*задн|rear\s*fog",
            re.I,
        ),
    ),
    # --- pedals / steering column: keep out of the engine bucket -------------
    (
        "dashboard",
        "pedals-column",
        re.compile(
            r"педал|\bpedal\b|"
            r"рулев\w*\s*(колон|колес)|steering\s*(wheel|column)|"
            r"замок\s*зажиган|ignition\s*switch|"
            r"сирен\w*|\bsiren\b",
            re.I,
        ),
    ),
    # HV charger sits under the rear floor, not in the engine bay.
    (
        "floor",
        "hv-charger",
        re.compile(r"зарядн\w*\s*устройств|battery\s*charger|\bOBC\b", re.I),
    ),
    # --- doors (oriented) ----------------------------------------------------
    (
        "rear_doors",
        "rear-door",
        re.compile(
            r"задн\w*\s*(лев\w*|прав\w*)?\s*двер|двер\w*[,\s]+задн|"
            r"(лев|прав)\w*\s*задн\w*\s*двер|"
            r"rear\s*door|door,?\s*rear|"
            r"стеклоподъ[её]мник\w*\s*задн|задн\w*\s*стеклоподъ[её]мник",
            re.I,
        ),
    ),
    (
        "front_doors",
        "front-door",
        re.compile(
            r"передн\w*\s*(лев\w*|прав\w*)?\s*двер|двер\w*[,\s]+передн|"
            r"(лев|прав)\w*\s*передн\w*\s*двер|"
            r"front\s*door|door,?\s*front|"
            r"наружн\w*\s*зеркал|exterior\s*mirror|door\s*mirror|зеркал\w*\s*(лев|прав)\w*\s*двер|"
            r"стеклоподъ[её]мник\w*\s*передн|передн\w*\s*стеклоподъ[её]мник",
            re.I,
        ),
    ),
    # --- seats ---------------------------------------------------------------
    (
        "seats",
        "seats",
        re.compile(
            r"сиден|подушк\w*\s*сиден|подогрев\w*\s*сиден|вентиляц\w*\s*сиден|"
            r"подъемник\w*\s*сиден|опор\w*\s*поясниц|поясничн|массаж|"
            r"\bseat\b|seat\s*(heater|module|belt|cushion)",
            re.I,
        ),
    ),
    # --- engine bay -----------------------------------------------------------
    (
        "engine",
        "engine-parts",
        re.compile(
            r"моторн\w*\s*отсек|engine\s*compartment|блок\w*\s*цилиндр|cylinder\s*block|"
            r"(?<!омыват)(?<!стекл)форсунк\w*\s*(топлив|двигат)|топливн\w*\s*форсун|fuel\s*inject|"
            r"катушк\w*\s*зажиган|ignition\s*coil|свеч\w*\s*зажиган|spark\s*plug|"
            r"генератор|alternator|(?<!блокиратор\w)\bстартер\b|starter\s*motor|"
            r"дроссел|throttle|лямбда|lambda|oxygen\s*sensor|"
            r"радиатор|radiator|вентилятор\w*\s*охлажд|cooling\s*fan|"
            r"компрессор\w*\s*кондиц|\bA/?C\s*compressor|давлени\w*\s*(климат|кондиц)|refrigerant\s*pressure|"
            r"магнитн\w*\s*сцеплен|magnetic\s*clutch|запорн\w*\s*клапан|shut-?off\s*valve|"
            r"турбо|turbo|интеркул|intercooler|"
            r"коленвал|распредвал|camshaft|crankshaft|"
            r"аккумулятор|\bbattery\b|предпуск\w*\s*подогрев|дополнительн\w*\s*(нагревател|отопител)|"
            r"\bECM\b|\bTCM\b|engine\s*control\s*module|модуль\s*управления\s*генератор",
            re.I,
        ),
    ),
    # --- dashboard / cabin front -----------------------------------------------
    (
        "dashboard",
        "dashboard-parts",
        re.compile(
            r"приборн\w*\s*(панел|щит)|instrument\s*(panel|cluster)|"
            r"панел\w*\s*приборов|торпед|"
            r"центральн\w*\s*консол|center\s*console|"
            r"климатическ\w*\s*установк\w*(?!.*давлен)|отопител\w*\s*салон|печк|\bHVAC\b|"
            r"магнитол|радиоприемник|infotainment|аудиосистем|информационно-развлекательн|\bIHU\b|\bICM\b|"
            r"блок\w*\s*предохранител\w*\s*(салон|панел)|"
            r"диагностическ\w*\s*разъ[её]м|\bOBD\b|"
            r"бардач|перчаточн|glove",
            re.I,
        ),
    ),
    # --- floor / tunnel ---------------------------------------------------------
    (
        "floor",
        "floor-parts",
        re.compile(
            r"туннел|напольн|донн\w*\s*порог|\bпорог\b|"
            r"\btunnel\b|\bfloor\b|"
            r"топливн\w*\s*(насос|бак)|fuel\s*(pump|tank)|"
            r"задн\w*\s*ось|rear\s*axle|\bERAD\b|\bDEM\b|"
            r"(электронн\w*\s*)?модул\w*\s*дифференциал|rear\s*differential|задн\w*\s*редуктор|"
            r"ручн\w*\s*тормоз|parking\s*brake",
            re.I,
        ),
    ),
]


def classify_physical_traced(*texts: str | None) -> tuple[str, str] | None:
    """Return (zone, rule name) from component naming, or None when no signal."""
    blob = " ".join(str(t or "") for t in texts).strip()
    if not blob:
        return None
    for zone, name, rx in PHYSICAL_RULES:
        if rx.search(blob):
            return zone, name
    return None


def classify_physical(*texts: str | None) -> str | None:
    hit = classify_physical_traced(*texts)
    return hit[0] if hit else None
