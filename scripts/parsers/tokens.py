"""Shared token extraction for Stage-2 parsers."""
from __future__ import annotations

import re

# 3/126C2:3, 74/301:6, 16/4.2:1, 11C/8:2, 4/16C1:43
NODE_PIN_RE = re.compile(r"\b(\d+[A-Z]?/\d+(?:\.\d+)?[A-Z0-9]*):(\d+)\b", re.I)
COMPONENT_RE = re.compile(r"\b(\d+[A-Z]?/\d+(?:\.\d+)?[A-Z0-9]*)\b", re.I)

VOLVO_COLOR_CODES = (
    "LGN", "BK", "SB", "BN", "BU", "BL", "GN", "GY", "GR",
    "OG", "OR", "PK", "RD", "VT", "VO", "WH", "YE", "P", "R", "W", "Y",
)
_COLOR_ALT = "|".join(VOLVO_COLOR_CODES)
COLOR_RE = re.compile(rf"\b({_COLOR_ALT})(?:-({_COLOR_ALT}))?\b", re.I)
# Prefer color token at end of harness cell
COLOR_AT_END_RE = re.compile(
    rf"\b({_COLOR_ALT})(?:-({_COLOR_ALT}))?\s*$",
    re.I,
)

WIRE_COLOR_RU = {
    "BK": "Черный", "SB": "Черный",
    "BN": "Коричневый",
    "BU": "Синий", "BL": "Синий",
    "GN": "Зеленый",
    "GY": "Серый", "GR": "Серый",
    "LGN": "Светло-зеленый",
    "OG": "Оранжевый", "OR": "Оранжевый",
    "PK": "Розовый", "P": "Розовый",
    "RD": "Красный", "R": "Красный",
    "VT": "Фиолетовый", "VO": "Фиолетовый",
    "WH": "Белый", "W": "Белый",
    "YE": "Желтый", "Y": "Желтый",
}

STEERING_RE = re.compile(r"\b(LHD|RHD)\b", re.I)
EMPTY_RE = re.compile(r"^[\s\-–—]*$")


def normalize_component_code(raw: str) -> str:
    """Canonical Type/Number — digits before optional decimal/letter suffix."""
    m = re.match(r"^(\d+)[A-Z]?/(\d+)", str(raw or "").strip(), re.I)
    if not m:
        return ""
    return f"{m.group(1)}/{m.group(2)}"


_VALID_COLOR_RE = re.compile(
    rf"^(?:{_COLOR_ALT})(?:-(?:{_COLOR_ALT}))?$",
    re.I,
)


def normalize_wire_color(color: str) -> str:
    """Keep only Volvo XX / XX-YY codes; drop em-dash, U+FFFD, and other garbage."""
    raw = str(color or "").strip().upper().replace("\ufffd", "")
    if not raw or raw in {"—", "-", "–", "−"}:
        return ""
    if not _VALID_COLOR_RE.fullmatch(raw):
        return ""
    parts = raw.split("-")
    return "-".join(parts)


def extract_color(text: str) -> str:
    m = COLOR_RE.search(text or "")
    if not m:
        return ""
    primary = m.group(1).upper()
    secondary = m.group(2).upper() if m.group(2) else None
    return normalize_wire_color(f"{primary}-{secondary}" if secondary else primary)


def extract_color_at_end(text: str) -> tuple[str, str]:
    """Return (color_code, text_without_trailing_color)."""
    raw = str(text or "").rstrip()
    m = COLOR_AT_END_RE.search(raw)
    if not m:
        return "", raw
    primary = m.group(1).upper()
    secondary = m.group(2).upper() if m.group(2) else None
    color = normalize_wire_color(f"{primary}-{secondary}" if secondary else primary)
    cleaned = raw[: m.start()].rstrip()
    return color, cleaned


def wire_color_ru(color_code: str) -> str:
    raw = str(color_code or "").upper().strip()
    if not raw:
        return ""
    parts = [WIRE_COLOR_RU.get(p, p) for p in raw.split("-") if p]
    if len(parts) == 1:
        return parts[0]
    first = parts[0]
    if first.endswith("ый"):
        first = first[:-2] + "о"
    elif first.endswith("ий"):
        first = first[:-2] + "е"
    return f"{first}-{parts[1]}"


def detect_steering(text: str) -> str:
    m = STEERING_RE.search(text or "")
    if not m:
        return ""
    return m.group(1).upper()


def strip_color_and_flags(text: str) -> str:
    t = COLOR_RE.sub(" ", text or "")
    t = STEERING_RE.sub(" ", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—|,;")
    return t


def parse_endpoint(cell_text: str) -> dict:
    """
    Parse harness cell into token / description / color.

    Guaranteed for: ``16/4.2:1 Left-hand front door speaker GN-BK``
      token=16/4.2:1, description=Left-hand front door speaker, color=GN-BK
    """
    raw = re.sub(r"\s+", " ", str(cell_text or "")).strip()
    empty = {
        "token": "",
        "component_code": "",
        "pin_suffix": "",
        "color": "",
        "steering_side": "",
        "detail": "",
        "clean_label": "",
        "description": "",
    }
    if not raw or EMPTY_RE.match(raw):
        return empty

    # 1) Trailing color (GN-BK at end)
    color, body = extract_color_at_end(raw)
    if not color:
        color = extract_color(body)
        if color:
            body = COLOR_RE.sub(" ", body, count=1)
            body = re.sub(r"\s{2,}", " ", body).strip()
    color = normalize_wire_color(color)

    steering = detect_steering(body)
    body = STEERING_RE.sub(" ", body)
    body = re.sub(r"\s{2,}", " ", body).strip()

    # 2) Component:pin at start, else first match in body
    token = ""
    component_code = ""
    pin_suffix = ""
    desc = body

    start = re.match(
        r"^(\d+[A-Z]?/\d+(?:\.\d+)?[A-Z0-9]*:\d+)\b\s*(.*)$",
        body,
        re.I,
    )
    if start:
        token = start.group(1)
        desc = start.group(2).strip()
        npm = NODE_PIN_RE.fullmatch(token)
        if npm:
            component_code = normalize_component_code(npm.group(1))
            pin_suffix = npm.group(2)
    else:
        npm = NODE_PIN_RE.search(body)
        if npm:
            token = npm.group(0)
            component_code = normalize_component_code(npm.group(1))
            pin_suffix = npm.group(2)
            desc = (body[: npm.start()] + " " + body[npm.end() :]).strip()
        else:
            cm = COMPONENT_RE.search(body)
            if cm:
                token = cm.group(1)
                component_code = normalize_component_code(token)
                desc = (body[: cm.start()] + " " + body[cm.end() :]).strip()

    desc = strip_color_and_flags(desc)
    if re.fullmatch(
        r"(?:harness|жгут|wire\s*code|контактный\s*разъем|connector)[\w\s,./-]{0,40}",
        desc,
        re.I,
    ):
        desc = ""

    if token and desc:
        detail = f"{token} — {desc}"
        clean_label = token
    elif token:
        detail = token
        clean_label = token
    else:
        detail = desc
        clean_label = desc

    return {
        "token": token,
        "component_code": component_code,
        "pin_suffix": pin_suffix,
        "color": color,
        "steering_side": steering,
        "detail": detail[:240],
        "clean_label": clean_label[:120],
        "description": desc[:200],
    }


def split_subrows(cell: str) -> list[str]:
    """Split a table cell on newlines into independent sub-rows."""
    if cell is None:
        return []
    parts = []
    for part in str(cell).split("\n"):
        p = part.strip()
        if p and not EMPTY_RE.match(p):
            parts.append(p)
    return parts or ([] if not str(cell).strip() else [str(cell).strip()])
