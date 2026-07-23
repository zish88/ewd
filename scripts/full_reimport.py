"""
Full ETL: wipe/create normalized Volvo EWD schema and fill from E:\\manual PDFs.
Tables: manuals, pages, components, wire_connections.
"""
from __future__ import annotations

import os
import re
import sqlite3

import pdfplumber

MANUALS_DIR = os.environ.get("MANUAL_DIR", r"C:\Users\eni19\volvo-xc70-wiring\data\ewd")
DB_PATH = os.path.join("data", "wiring.sqlite")

EN_PDF_NAME = "Электросхемы XC70.pdf"


COMPONENT_RE = re.compile(r"\b\d+/\d+\b")
NODE_CODE_RE = re.compile(r"\b\d+[A-Z]?/\d+[A-Z0-9]*\b", re.I)
# C1:1, C3:46, B:11, F3, FA3, plain 1–3 digit pins — not Type/Number block codes
PIN_TOKEN_RE = re.compile(
    r"\bC\d+:\d+\b|\b[A-Z]\d+:\d+\b|\b[A-Z]:\d+\b|\bF\d+\b|\b[A-Z]\d+\b|\b\d{1,3}\b",
    re.I,
)
EXPLICIT_PIN_RE = re.compile(
    r"(?:pin|пин|контакт|разъем|connector)\s*[#:]?\s*([A-Z]?\d*(?::\d+)?|[A-Z]:\d+)",
    re.I,
)
CONNECTOR_PIN_RE = re.compile(
    r"(?:разъем|connector|conn)\s*(C\d+)\s*[,;/\s]*(?:пин|pin)?\s*(\d+)",
    re.I,
)
# 74/301:6, 4/16C1:43, 3/126C1:2, 11C/8:2
CODE_PIN_RE = re.compile(r"(\d+[A-Z]?/\d+[A-Z0-9]*):(\d+)\b", re.I)
PINOUT_HEADER_RE = re.compile(r"^(?:no\.?|№|n[oо]|pf/№|f/№)$", re.I)
HARNESS_HINT_RE = re.compile(
    r"\bharness\b|жгут|floor\s*harness|door\s*harness|контактный\s*разъем|\bconnectors?\b",
    re.I,
)
POLE_DESC_RE = re.compile(
    r"(\d+\s*[-–]?\s*pin\b[^.\n]{0,40}|\d+\s*[-–]?\s*полюс\w*[^.\n]{0,40})",
    re.I,
)
EMPTY_CELL_RE = re.compile(r"^[\s\-–—]*$")
TOC_DOTS_RE = re.compile(r"\.{3,}|(\s\.\s){2,}|(\.\s){3,}")
CONTENTS_RE = re.compile(r"\bcontents\b|содержание", re.I)

VOLVO_COLOR_CODES = (
    "LGN", "BK", "SB", "BN", "BU", "BL", "GN", "GY", "GR",
    "OG", "OR", "PK", "RD", "VT", "VO", "WH", "YE", "P", "R", "W", "Y",
)
_COLOR_ALT = "|".join(VOLVO_COLOR_CODES)
COLOR_RE = re.compile(rf"\b({_COLOR_ALT})(?:-({_COLOR_ALT}))?\b", re.I)

COMPONENT_TYPE_RU = {
    1: "Аккумулятор",
    2: "Реле",
    3: "Выключатель/Кнопка",
    4: "Модуль управления",
    5: "Приборная панель",
    6: "Электромотор",
    7: "Датчик",
    10: "Лампа/Освещение",
    11: "Предохранитель",
    15: "Блок предохранителей/Шина",
    16: "Звук/Гудок",
    31: "Точка Массы (Ground)",
    73: "Точка разветвления (Сплайс)",
    74: "Промежуточный разъем жгута",
}

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

DDL = """
PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS pages_ai;
DROP TRIGGER IF EXISTS pages_ad;
DROP TRIGGER IF EXISTS pages_au;
DROP TABLE IF EXISTS page_search;
DROP TABLE IF EXISTS wire_references;
DROP TABLE IF EXISTS page_vehicle_applications;
DROP TABLE IF EXISTS search_aliases;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS connector_pin_routes;
DROP TABLE IF EXISTS spatial_tokens;
DROP TABLE IF EXISTS user_overrides;
DROP TABLE IF EXISTS enriched_wires;
DROP TABLE IF EXISTS wire_connections;
DROP TABLE IF EXISTS components;
DROP TABLE IF EXISTS pages;
DROP TABLE IF EXISTS manuals;

CREATE TABLE manuals (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL CHECK(language IN ('EN', 'RU'))
);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY,
  manual_id INTEGER NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
  source_page INTEGER NOT NULL,
  system_name TEXT NOT NULL DEFAULT '',
  page_type TEXT NOT NULL DEFAULT 'diagram'
    CHECK(page_type IN ('diagram', 'fuses', 'locations', 'connector')),
  UNIQUE(manual_id, source_page)
);

CREATE TABLE components (
  id INTEGER PRIMARY KEY,
  component_code TEXT NOT NULL UNIQUE,
  component_type_ru TEXT NOT NULL DEFAULT '',
  description_ru TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT ''
);

CREATE TABLE wire_connections (
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  pin_number TEXT NOT NULL DEFAULT '—',
  wire_color_raw TEXT NOT NULL DEFAULT '—',
  wire_color_ru TEXT NOT NULL DEFAULT '—',
  function_text TEXT NOT NULL DEFAULT '',
  from_detail TEXT NOT NULL DEFAULT '',
  to_detail TEXT NOT NULL DEFAULT '',
  from_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
  to_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
  via_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL
);

CREATE INDEX pages_type_lookup ON pages(page_type, manual_id, source_page);
CREATE INDEX wire_connections_page ON wire_connections(page_id);
CREATE INDEX wire_connections_from ON wire_connections(from_component_id);
CREATE INDEX wire_connections_to ON wire_connections(to_component_id);
CREATE INDEX wire_connections_via ON wire_connections(via_component_id);

CREATE TABLE IF NOT EXISTS pending_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model TEXT NOT NULL,
  year TEXT NOT NULL,
  engine TEXT NOT NULL,
  location_name TEXT NOT NULL,
  pin_number TEXT NOT NULL,
  wire_color TEXT NOT NULL,
  source_block TEXT NOT NULL,
  source_pin TEXT,
  destination_block TEXT NOT NULL,
  destination_pin TEXT,
  description TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected'))
);
"""


def component_type_ru(code: str) -> str:
    m = COMPONENT_RE.fullmatch(str(code or "").strip())
    if not m:
        # Allow 1A/1 style — take digits before slash
        m2 = re.match(r"^(\d+)[A-Z]?/\d+", str(code or "").strip(), re.I)
        if not m2:
            return ""
        type_id = int(m2.group(1))
    else:
        type_id = int(code.split("/", 1)[0])
    return COMPONENT_TYPE_RU.get(type_id, f"Тип {type_id}")


def wire_color_ru(color_code: str) -> str:
    raw = str(color_code or "").upper().strip()
    if not raw or raw == "—":
        return "—"
    return "-".join(WIRE_COLOR_RU.get(p, p) for p in raw.split("-") if p)


def extract_color(line_text: str) -> str:
    match = COLOR_RE.search(line_text or "")
    if not match:
        return "—"
    primary = match.group(1).upper()
    secondary = match.group(2).upper() if match.group(2) else None
    return f"{primary}-{secondary}" if secondary else primary


def clean_volvo_boilerplate(text: str) -> str:
    s = str(text or "")
    if not s:
        return ""
    s = re.sub(r"TP[\s\-]*\d+[A-Z]?", " ", s, flags=re.I)
    s = re.sub(r"\bTP\d{4,}\b", " ", s, flags=re.I)
    s = re.sub(r"\bV70\s*\(\s*08\s*-\s*\)", " ", s, flags=re.I)
    s = re.sub(r"\bXC70\s*\(\s*08\s*-\s*\)", " ", s, flags=re.I)
    s = re.sub(r"\bS80\s*\(\s*07\s*-\s*\)", " ", s, flags=re.I)
    s = re.sub(r"\b(?:V70|XC70|S80|XC60|S60|V60)\s*\([^)]*\)", " ", s, flags=re.I)
    s = re.sub(r"©\s*Volvo\s*Car\s*Corporation", " ", s, flags=re.I)
    s = re.sub(r"\bVolvo\s*Car\s*Corporation\b", " ", s, flags=re.I)
    s = re.sub(r"All\s+rights\s+reserved\.?", " ", s, flags=re.I)
    s = re.sub(r"Все\s+права\s+защищены\.?", " ", s, flags=re.I)
    s = re.sub(r"\b(?:19|20)\d{2}\b", " ", s)
    s = re.sub(r"(?:Unit\s+Designation\s*)+", " ", s, flags=re.I)
    s = re.sub(r"(?:Блок\s+Название\s*)+", " ", s, flags=re.I)
    s = re.sub(r"[,;&|]+", " ", s)
    s = re.sub(r"\s{2,}", " ", s).strip()
    s = re.sub(r"^\d{1,3}\s+", "", s)
    if len(s) > 80:
        soft = s[:80]
        sp = soft.rfind(" ")
        s = (soft[:sp] if sp > 24 else soft).strip()
    return s


def is_toc_line(text: str) -> bool:
    return bool(text and TOC_DOTS_RE.search(text))


def is_toc_page(page_num: int, page_text: str) -> bool:
    if page_num >= 25:
        return False
    if CONTENTS_RE.search(page_text or ""):
        return True
    # Dense leader dots = contents index
    dots = TOC_DOTS_RE.findall(page_text or "")
    return len(dots) >= 3


def classify_page_type(system_name: str, text: str) -> str:
    title = (system_name or "").lower()
    hay = f"{system_name or ''}\n{text or ''}".lower()
    if re.match(r"^разъем\s+\d+/", (system_name or "").strip(), re.I):
        return "connector"
    if re.search(r"(?:\bno\.?\b|№)", hay) and HARNESS_HINT_RE.search(hay):
        if not re.search(r"\bfuses\b|предохранител", title):
            return "connector"
    # Title-first locations — before fuse regex (bare «реле» matches almost every RU page)
    if re.search(
        r"overview\s*locations|обзор\s*размещен|component\s*illustrations|"
        r"ground\s*connections|узловые\s*соединения|"
        r"component\s*locations?|locations?\s*of\s*components?|components?\s*location|"
        r"расположение\s*компонент|карта\s*расположен",
        title,
    ):
        return "locations"
    if re.search(r"\bfuses\b|\brelays\b|distribution\s*box|предохранител|\bреле\b|токораспред", hay):
        return "fuses"
    if re.search(
        r"component\s*locations?|locations?\s*of\s*components?|components?\s*location|"
        r"расположение\s*компонент|карта\s*расположен|overview\s*locations|обзор\s*размещен",
        hay,
    ):
        return "locations"
    if re.search(r"\bindex\b", hay) and re.search(r"component|location|расположен|кузов|\bbody\b", hay) and not re.search(
        r"\bfuses?\b|\brelays?\b", hay
    ):
        return "locations"
    return "diagram"


def is_block_code_fragment(token: str, line_text: str) -> bool:
    """Reject pins that are really part of a Type/Number like 3/26 or 74/504."""
    t = str(token or "").strip()
    if not t:
        return True
    if COMPONENT_RE.fullmatch(t) or NODE_CODE_RE.fullmatch(t):
        return True
    # Digit-only token that sits before/after slash in a component code
    if re.fullmatch(r"\d{1,3}", t):
        if re.search(rf"\b{re.escape(t)}/\d+", line_text) or re.search(rf"\b\d+[A-Z]?/{re.escape(t)}\b", line_text, re.I):
            return True
    return False


def normalize_pin_candidate(raw: str) -> str:
    pin = str(raw or "").strip().upper().rstrip(".,;")
    if not pin or pin in ("—", "-", "NONE", "NULL"):
        return ""
    if is_toc_line(pin):
        return ""
    # Accept F13, C1:30, A:4, FA3, 12 — reject long words
    if not PIN_TOKEN_RE.fullmatch(pin) and not re.fullmatch(r"[A-Z]{1,2}\d+(?::\d+)?", pin, re.I):
        return ""
    return pin


def extract_pin(line_text: str, table_pin=None) -> str:
    line = str(line_text or "")

    if table_pin is not None:
        candidate = normalize_pin_candidate(str(table_pin))
        if candidate and not is_block_code_fragment(candidate, line):
            return candidate

    # «Разъем C3, пин 46» → C3:46
    for match in CONNECTOR_PIN_RE.finditer(line):
        candidate = normalize_pin_candidate(f"{match.group(1)}:{match.group(2)}")
        if candidate:
            return candidate

    # Prefer explicit «Пин F13» / «pin C1:30»
    for match in EXPLICIT_PIN_RE.finditer(line):
        candidate = normalize_pin_candidate(match.group(1))
        if candidate and not is_block_code_fragment(candidate, line):
            return candidate

    # Strip component codes so their digits are not mistaken for pins
    clean = NODE_CODE_RE.sub(" ", line)
    clean = COMPONENT_RE.sub(" ", clean)
    # Prefer connector:pin forms first (C3:46, B:11), then F3, then bare digits
    preferred: list[str] = []
    fallback: list[str] = []
    for match in PIN_TOKEN_RE.finditer(clean):
        candidate = normalize_pin_candidate(match.group(0))
        if not candidate or is_block_code_fragment(candidate, line):
            continue
        if ":" in candidate or re.fullmatch(r"F\d+", candidate, re.I):
            preferred.append(candidate)
        else:
            fallback.append(candidate)
    if preferred:
        return preferred[0]
    if fallback:
        return fallback[0]
    return "—"


def extract_function_text(line_text: str) -> str:
    """Short circuit description from the line (codes/colors/pins stripped)."""
    t = NODE_CODE_RE.sub(" ", line_text or "")
    t = COMPONENT_RE.sub(" ", t)
    t = COLOR_RE.sub(" ", t)
    t = CONNECTOR_PIN_RE.sub(" ", t)
    t = EXPLICIT_PIN_RE.sub(" ", t)
    t = PIN_TOKEN_RE.sub(" ", t)
    t = clean_volvo_boilerplate(t)
    t = re.sub(r"\b(?:pin|пин|контакт|разъем|connector|wire|провод)\b", " ", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—:;")
    return t[:160] if t else ""


def normalize_component_code(raw: str) -> str:
    """Canonical Type/Number for components table (digits only form preferred)."""
    m = re.match(r"^(\d+)[A-Z]?/(\d+)", str(raw or "").strip(), re.I)
    if not m:
        return ""
    return f"{m.group(1)}/{m.group(2)}"


def is_via_code(code: str) -> bool:
    return str(code or "").startswith("74/")


def ordered_unique_component_codes(line_text: str) -> list[str]:
    """Left-to-right unique Type/Number codes (all classes, including 74/)."""
    seen: list[str] = []
    for raw in NODE_CODE_RE.findall(line_text or ""):
        canon = normalize_component_code(raw)
        if canon and canon not in seen:
            seen.append(canon)
    return seen


def split_endpoints_and_via(codes: list[str]) -> tuple[str | None, str | None, str | None]:
    """
    endpoints = non-74 codes L→R; via = first 74/ code.
    from = first endpoint, to = second endpoint.
    If fewer than 2 endpoints and a via exists with no counterpart endpoint,
    via stays via (not promoted to to/from) unless there are zero endpoints —
    then via becomes from (lone harness connector row).
    """
    endpoints = [c for c in codes if not is_via_code(c)]
    vias = [c for c in codes if is_via_code(c)]
    via_code = vias[0] if vias else None

    if not endpoints:
        if via_code:
            return via_code, (vias[1] if len(vias) > 1 else None), None
        return None, None, None

    from_code = endpoints[0]
    to_code = endpoints[1] if len(endpoints) > 1 else None
    return from_code, to_code, via_code


def split_segments(text: str) -> list[str]:
    if not text:
        return []
    out = []
    for part in str(text).split("\n"):
        line = part.strip()
        if not line or is_toc_line(line):
            continue
        out.append(line)
    return out


def guess_system_name(page_text: str, first_lines: list[str]) -> str:
    sample = " ".join(first_lines[:5]) if first_lines else (page_text or "")[:400]
    cleaned = clean_volvo_boilerplate(sample)
    # Prefer a short titled phrase
    m = re.search(
        r"\b(?:Starting system|Fuses|Distribution box|Harness[\w\s-]{0,40}|Power windows?|"
        r"Door [Mm]odule|Central electronic module|Lighting|Cooling system|"
        r"Предохранител[\w\s]{0,30}|Модуль[\w\s]{0,40})\b.{0,40}",
        cleaned,
        re.I,
    )
    if m:
        return clean_volvo_boilerplate(m.group(0))[:80]
    return cleaned[:80] or "Электрическая схема"


def is_pinout_header_row(row) -> bool:
    if not row:
        return False
    first = str(row[0] or "").strip()
    if PINOUT_HEADER_RE.match(first):
        return True
    joined = " ".join(str(c or "") for c in row)
    return bool(re.search(r"^(?:no\.?|№)\b", joined.strip(), re.I) and HARNESS_HINT_RE.search(joined))


def table_has_pinout_header(tables) -> bool:
    for table in tables or []:
        for row in table or []:
            if is_pinout_header_row(row):
                return True
    return False


def is_connector_pinout_page(page_text: str, tables) -> bool:
    hay = page_text or ""
    if table_has_pinout_header(tables):
        return True
    if re.search(r"(?:\bno\.?\b|№)", hay, re.I) and HARNESS_HINT_RE.search(hay):
        if CODE_PIN_RE.search(hay) or re.search(r"\b74/\d+", hay):
            return True
    if re.search(r"\bconnectors?\b|контактный\s*разъем", hay, re.I) and re.search(
        r"(?:\bno\.?\b|№)", hay, re.I
    ):
        return True
    return False


def extract_subject_connector(page_text: str) -> tuple[str, str]:
    """Return (canonical 74/N, system_name like 'Разъем 74/504 (57-полюсный…)')."""
    text = page_text or ""
    # Prefer 74/ near top of page (before table noise)
    head = "\n".join(text.splitlines()[:25])
    m = re.search(r"\b(74/\d+[A-Z]?)\b", head, re.I)
    if not m:
        m = re.search(r"\b(74/\d+[A-Z]?)\b", text, re.I)
    if not m:
        return "", ""
    raw = m.group(1)
    canon = normalize_component_code(raw) or raw.upper().split(":")[0]
    # Pole / color description on nearby lines
    pole = ""
    pole_m = POLE_DESC_RE.search(text[m.start() : m.start() + 200])
    if not pole_m:
        pole_m = POLE_DESC_RE.search(head)
    if pole_m:
        pole = clean_volvo_boilerplate(pole_m.group(1))
        pole = re.sub(r"\s{2,}", " ", pole).strip(" ,;")
    # Also catch "black" / "естественный" after pole line
    if not pole:
        after = text[m.end() : m.end() + 80]
        color_word = re.search(
            r"\b(black|white|grey|gray|natural|естественн\w*|чёрн\w*|черн\w*|бел\w*)\b",
            after,
            re.I,
        )
        pin_word = re.search(r"(\d+\s*[-–]?\s*(?:pin|полюс\w*))", after, re.I)
        bits = []
        if pin_word:
            bits.append(pin_word.group(1).strip())
        if color_word:
            bits.append(color_word.group(1).strip())
        pole = ", ".join(bits)
    if pole:
        title = f"Разъем {canon} ({pole})"
    else:
        title = f"Разъем {canon}"
    return canon, title[:100]


def parse_harness_cell(cell_text: str) -> dict:
    """Extract component code, color, and display detail from one harness side."""
    raw = re.sub(r"\s+", " ", str(cell_text or "")).strip()
    if not raw or EMPTY_CELL_RE.match(raw) or raw in ("-", "—"):
        return {"code": "", "raw_token": "", "color": "—", "detail": "", "desc": ""}

    color = extract_color(raw)
    code_m = CODE_PIN_RE.search(raw)
    raw_token = ""
    code = ""
    if code_m:
        raw_token = code_m.group(0)
        code = normalize_component_code(code_m.group(1))
    else:
        node_m = NODE_CODE_RE.search(raw)
        if node_m:
            raw_token = node_m.group(0)
            code = normalize_component_code(raw_token)

    desc = raw
    if raw_token:
        desc = desc.replace(raw_token, " ", 1)
    if color != "—":
        desc = COLOR_RE.sub(" ", desc, count=1)
    desc = clean_volvo_boilerplate(desc)
    desc = re.sub(r"\s{2,}", " ", desc).strip(" -–—|,;")
    # Drop column-header junk leaked into cells
    if re.fullmatch(r"(?:harness|жгут)[\w\s,.-]{0,40}", desc, re.I):
        desc = ""

    if raw_token and desc:
        detail = f"{raw_token} — {desc}"
    elif raw_token:
        detail = raw_token
    else:
        detail = desc

    return {
        "code": code,
        "raw_token": raw_token,
        "color": color,
        "detail": detail[:240],
        "desc": desc[:200],
    }


def split_pinout_sides(cells_after_pin: list[str]) -> tuple[str, str]:
    """Split remaining table cells into left/right harness text."""
    cells = [c for c in cells_after_pin if c is not None]
    cells = [str(c).strip() for c in cells]
    # Drop pure empties but keep structure if mixed
    joined = " ".join(c for c in cells if c)
    if not joined or EMPTY_CELL_RE.match(joined.replace(" ", "")):
        return "", ""

    matches = list(CODE_PIN_RE.finditer(joined))
    if len(matches) >= 2:
        mid = matches[1].start()
        return joined[:mid].strip(), joined[mid:].strip()

    # Two big column blobs
    nonempty = [c for c in cells if c and not EMPTY_CELL_RE.match(c)]
    if len(nonempty) >= 2:
        # Prefer even split of all cells after pin
        if len(cells) >= 4:
            mid = len(cells) // 2
            left = " ".join(c for c in cells[:mid] if c)
            right = " ".join(c for c in cells[mid:] if c)
            return left.strip(), right.strip()
        return nonempty[0], nonempty[1]

    if len(matches) == 1:
        # One code only — put on left
        return joined, ""
    return joined, ""


def is_empty_pinout_data(left: str, right: str) -> bool:
    blob = f"{left} {right}".strip()
    if not blob or EMPTY_CELL_RE.match(blob.replace(" ", "")):
        return True
    if not CODE_PIN_RE.search(blob) and not NODE_CODE_RE.search(blob):
        return True
    return False


def process_pinout_row(cursor, cache: ComponentCache, page_id: int, pin: str, left: str, right: str, counters):
    if not pin or not re.fullmatch(r"\d{1,3}", str(pin).strip()):
        return
    if is_empty_pinout_data(left, right):
        return

    left_p = parse_harness_cell(left)
    right_p = parse_harness_cell(right)
    color = left_p["color"] if left_p["color"] != "—" else right_p["color"]

    from_id = cache.upsert(left_p["code"], left_p["desc"] or left) if left_p["code"] else None
    to_id = cache.upsert(right_p["code"], right_p["desc"] or right) if right_p["code"] else None
    if from_id is None and to_id is None and color == "—":
        return

    function_text = left_p["desc"] or right_p["desc"] or ""
    insert_connection(
        cursor,
        page_id,
        str(pin).strip(),
        color,
        from_id,
        to_id,
        None,  # no via on pinout pages
        function_text,
        counters,
        from_detail=left_p["detail"],
        to_detail=right_p["detail"],
    )


def ingest_connector_pinout_tables(cursor, cache, page_id, tables, counters) -> int:
    """Row-by-row extraction; returns number of wires inserted from tables."""
    before = counters["wires"]
    for table in tables or []:
        seen_header = False
        for row in table or []:
            if not row:
                continue
            cells = [str(c or "").strip() if c is not None else "" for c in row]
            if is_pinout_header_row(cells):
                seen_header = True
                continue
            # Allow data rows before explicit header if col0 is a pin number
            pin = cells[0] if cells else ""
            if not re.fullmatch(r"\d{1,3}", pin):
                continue
            if not seen_header and not any(CODE_PIN_RE.search(c) for c in cells[1:]):
                continue
            left, right = split_pinout_sides(cells[1:])
            process_pinout_row(cursor, cache, page_id, pin, left, right, counters)
    return counters["wires"] - before


def ingest_connector_pinout_text(cursor, cache, page_id, page_text, counters) -> int:
    """Fallback: parse text lines '21  3/126C1:2  …  VT-RD  11C/8:2  …'."""
    before = counters["wires"]
    for line in (page_text or "").splitlines():
        line = line.strip()
        if not line or is_toc_line(line):
            continue
        m = re.match(r"^(\d{1,3})\s+(.+)$", line)
        if not m:
            continue
        pin, rest = m.group(1), m.group(2)
        if not CODE_PIN_RE.search(rest) and not NODE_CODE_RE.search(rest):
            continue
        # Skip header-like leftovers
        if HARNESS_HINT_RE.search(rest) and not CODE_PIN_RE.search(rest):
            continue
        left, right = split_pinout_sides([rest])
        # If split failed on single string with 2 codes, split_pinout_sides handles it
        process_pinout_row(cursor, cache, page_id, pin, left, right, counters)
    return counters["wires"] - before


class ComponentCache:
    def __init__(self, cursor: sqlite3.Cursor):
        self.cursor = cursor
        self.ids: dict[str, int] = {}
        for row in cursor.execute("SELECT id, component_code FROM components"):
            self.ids[row[1]] = row[0]

    def upsert(self, code: str, description: str) -> int | None:
        canon = normalize_component_code(code)
        if not canon:
            return None
        is_ru = bool(re.search(r"[а-яА-Я]", description or ""))
        desc = clean_volvo_boilerplate(description or "")
        # Strip leading code from description
        desc = re.sub(rf"^{re.escape(canon)}(?::\d+)?\s*", "", desc, flags=re.I).strip()
        type_ru = component_type_ru(canon)

        if canon in self.ids:
            cid = self.ids[canon]
            if desc:
                if is_ru:
                    self.cursor.execute(
                        "UPDATE components SET description_ru = CASE WHEN description_ru = '' THEN ? ELSE description_ru END, "
                        "component_type_ru = ? WHERE id = ?",
                        (desc[:200], type_ru, cid),
                    )
                else:
                    self.cursor.execute(
                        "UPDATE components SET description_en = CASE WHEN description_en = '' THEN ? ELSE description_en END, "
                        "component_type_ru = ? WHERE id = ?",
                        (desc[:200], type_ru, cid),
                    )
            return cid

        self.cursor.execute(
            """
            INSERT INTO components(component_code, component_type_ru, description_ru, description_en)
            VALUES (?, ?, ?, ?)
            """,
            (canon, type_ru, desc[:200] if is_ru else "", desc[:200] if not is_ru else ""),
        )
        cid = int(self.cursor.lastrowid)
        self.ids[canon] = cid
        return cid


def insert_connection(
    cursor,
    page_id,
    pin,
    color_raw,
    from_id,
    to_id,
    via_id,
    function_text,
    counters,
    from_detail="",
    to_detail="",
):
    cursor.execute(
        """
        INSERT INTO wire_connections
          (page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
           from_detail, to_detail,
           from_component_id, to_component_id, via_component_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            page_id,
            pin,
            color_raw,
            wire_color_ru(color_raw),
            function_text or "",
            from_detail or "",
            to_detail or "",
            from_id,
            to_id,
            via_id,
        ),
    )
    counters["wires"] += 1


def process_line(cursor, cache: ComponentCache, page_id: int, line: str, counters, table_pin=None):
    if not line or is_toc_line(line):
        counters["skipped_toc"] += 1
        return

    color = extract_color(line)
    pin = extract_pin(line, table_pin=table_pin)
    function_text = extract_function_text(line)
    canon_codes = ordered_unique_component_codes(line)
    from_code, to_code, via_code = split_endpoints_and_via(canon_codes)

    if not from_code and not to_code and not via_code and color == "—" and pin == "—":
        return

    from_id = cache.upsert(from_code, line) if from_code else None
    to_id = cache.upsert(to_code, line) if to_code else None
    via_id = cache.upsert(via_code, line) if via_code else None
    if from_id is None and to_id is None and via_id is None and color == "—" and pin == "—":
        return
    insert_connection(
        cursor, page_id, pin, color, from_id, to_id, via_id, function_text, counters
    )


def reset_schema(conn: sqlite3.Connection):
    conn.executescript(DDL)
    conn.commit()


def main():
    os.makedirs("data", exist_ok=True)
    if not os.path.isdir(MANUALS_DIR):
        print(f"❌ Директория {MANUALS_DIR} не найдена!")
        return

    books = [
        (EN_PDF_NAME, "EN"),

    ]
    for name, _lang in books:
        path = os.path.join(MANUALS_DIR, name)
        if not os.path.isfile(path):
            print(f"❌ Не найден PDF: {path}")
            return

    # Remove old DB files for clean rebuild
    for suffix in ("", "-wal", "-shm"):
        path = f"{DB_PATH}{suffix}"
        if os.path.exists(path):
            os.remove(path)
            print(f"🗑️ Удалено: {path}")

    conn = sqlite3.connect(DB_PATH)
    reset_schema(conn)
    cursor = conn.cursor()
    cache = ComponentCache(cursor)

    counters = {"manuals": 0, "pages": 0, "wires": 0, "skipped_toc": 0, "toc_pages": 0}

    for filename, language in books:
        pdf_path = os.path.join(MANUALS_DIR, filename)
        cursor.execute(
            "INSERT INTO manuals(filename, language) VALUES (?, ?)",
            (filename, language),
        )
        manual_id = int(cursor.lastrowid)
        counters["manuals"] += 1
        print(f"🚀 {language}: {filename} (manual_id={manual_id})")

        with pdfplumber.open(pdf_path) as pdf:
            for idx, page in enumerate(pdf.pages):
                page_num = idx + 1
                if page_num == 88:
                    print(f"⚠️ Пропуск проблемной страницы {page_num}...", flush=True)
                    continue
                try:
                    page_text = page.extract_text() or ""
                except Exception:
                    page_text = ""

                if is_toc_page(page_num, page_text):
                    counters["toc_pages"] += 1
                    continue

                # Collect candidate lines for system name + connections
                line_buffer: list[str] = []
                tables = page.extract_tables() or []
                connector_page = is_connector_pinout_page(page_text, tables)

                if tables and not connector_page:
                    for table in tables:
                        for row in table:
                            if not row:
                                continue
                            table_pin = str(row[0]).strip() if row[0] else None
                            if table_pin and is_toc_line(table_pin):
                                counters["skipped_toc"] += 1
                                continue
                            for col_idx in range(1, len(row)):
                                for segment in split_segments(row[col_idx] or ""):
                                    line_buffer.append(segment)
                elif not connector_page:
                    words = page.extract_words() or []
                    words.sort(key=lambda w: (round(w["top"], 1), w["x0"]))
                    current: list = []

                    def flush():
                        nonlocal current
                        if not current:
                            return
                        text = " ".join(t["text"] for t in current).strip()
                        current = []
                        if text and not is_toc_line(text):
                            if COMPONENT_RE.search(text) or COLOR_RE.search(text):
                                line_buffer.append(text)

                    for w in words:
                        if not current:
                            current = [w]
                            continue
                        prev = current[-1]
                        if abs(w["top"] - prev["top"]) < 4 and (w["x0"] - prev["x1"]) < 40:
                            current.append(w)
                        else:
                            flush()
                            current = [w]
                    flush()

                if connector_page:
                    subject_code, system_name = extract_subject_connector(page_text)
                    if not system_name:
                        system_name = "Разъем (распиновка)"
                    page_type = "connector"
                    if subject_code:
                        cache.upsert(subject_code, system_name)
                else:
                    system_name = guess_system_name(page_text, line_buffer)
                    page_type = classify_page_type(system_name, page_text)

                cursor.execute(
                    """
                    INSERT INTO pages(manual_id, source_page, system_name, page_type)
                    VALUES (?, ?, ?, ?)
                    """,
                    (manual_id, page_num, system_name, page_type),
                )
                page_id = int(cursor.lastrowid)
                counters["pages"] += 1

                if connector_page:
                    n = ingest_connector_pinout_tables(cursor, cache, page_id, tables, counters)
                    # Text fallback when pdfplumber tables are incomplete
                    if n == 0:
                        ingest_connector_pinout_text(cursor, cache, page_id, page_text, counters)
                elif tables:
                    for table in tables:
                        for row in table:
                            if not row or len(row) < 2:
                                continue
                            table_pin = str(row[0]).strip() if row[0] else None
                            if table_pin and is_toc_line(table_pin):
                                continue
                            cell_texts: list[str] = []
                            for col_idx in range(1, len(row)):
                                cell_texts.extend(split_segments(row[col_idx] or ""))
                            if not cell_texts and row[1]:
                                cell_texts = split_segments(row[1])
                            for segment in cell_texts:
                                process_line(cursor, cache, page_id, segment, counters, table_pin=table_pin)
                else:
                    for segment in line_buffer:
                        process_line(cursor, cache, page_id, segment, counters)

        conn.commit()

    conn.close()
    print(
        f"\nETL complete.\n"
        f"  manuals={counters['manuals']} pages={counters['pages']} "
        f"wires={counters['wires']} toc_pages_skipped={counters['toc_pages']} "
        f"toc_lines_skipped={counters['skipped_toc']}"
    )


if __name__ == "__main__":
    main()
