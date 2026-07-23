/** Official Volvo EWD component-type / wire-color standards (manual reference pages). */

/** First number before slash = device class */
export const COMPONENT_TYPE_RU: Record<number, string> = {
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
  16: "Звуковая система / Звуковой сигнал",
  31: "Точка Массы (Ground)",
  73: "Точка разветвления (Сплайс)",
  74: "Промежуточный разъем жгута",
};

/** Volvo wire color abbreviations → Russian name */
export const WIRE_COLOR_RU: Record<string, string> = {
  BK: "Черный",
  SB: "Черный",
  BN: "Коричневый",
  BU: "Синий",
  BL: "Синий",
  GN: "Зеленый",
  GY: "Серый",
  GR: "Серый",
  LGN: "Светло-зеленый",
  OG: "Оранжевый",
  OR: "Оранжевый",
  PK: "Розовый",
  P: "Розовый",
  RD: "Красный",
  R: "Красный",
  VT: "Фиолетовый",
  VO: "Фиолетовый",
  WH: "Белый",
  W: "Белый",
  YE: "Желтый",
  Y: "Желтый",
};

export const COMPONENT_CODE_RE = /\b(\d+)\/(\d+)\b/;
export const COMPONENT_CODE_GLOBAL_RE = /\b\d+\/\d+\b/g;
export const WIRE_COLOR_TOKEN_RE =
  /\b(LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|P|R|W|Y)(?:-(LGN|BK|SB|BN|BU|BL|GN|GY|GR|OG|OR|PK|RD|VT|VO|WH|YE|P|R|W|Y))?\b/i;

export function componentTypeRu(code: string | null | undefined): string {
  if (!code || code === "—") return "";
  const match = String(code).match(COMPONENT_CODE_RE);
  if (!match) return "";
  const typeId = Number(match[1]);
  return COMPONENT_TYPE_RU[typeId] || `Тип ${typeId}`;
}

/** RD-BK → "Красный-Черный" (engineer dictionary, no code suffix) */
export function wireColorRu(colorCode: string | null | undefined): string {
  const raw = String(colorCode || "").toUpperCase().trim();
  if (!raw || raw === "—") return "—";
  const parts = raw.split("-").filter(Boolean).map((part) => WIRE_COLOR_RU[part] || part);
  if (parts.length === 1) return parts[0];
  // GN-BK → Зелено-Черный
  let first = parts[0];
  if (first.endsWith("ый")) first = `${first.slice(0, -2)}о`;
  else if (first.endsWith("ий")) first = `${first.slice(0, -2)}е`;
  return `${first}-${parts[1]}`;
}

/** RD-GY → "Красный-Серый (RD-GY)" */
export function decodeWireColor(colorCode: string | null | undefined): string {
  const raw = String(colorCode || "").toUpperCase().trim();
  if (!raw || raw === "—") return "—";
  const names = wireColorRu(raw);
  return names === "—" ? "—" : `${names} (${raw})`;
}

export function extractComponentCode(text: string): string {
  const match = text.match(COMPONENT_CODE_RE);
  return match ? match[0] : "—";
}

export function extractWireColorCode(text: string): string {
  const match = text.match(WIRE_COLOR_TOKEN_RE);
  return match ? match[0].toUpperCase() : "—";
}

/** Deterministic presets mapped to official Volvo codes / module names */
export const SEARCH_PRESETS: Record<
  string,
  {
    label: string;
    /** Exact codes e.g. 2/17 */
    codes?: string[];
    /** Prefixes e.g. 16/ matches 16/1, 16/10 */
    prefixes?: string[];
    /** Literal tokens with word boundaries: DDM, Left door */
    tokens?: string[];
    /** Restrict to page_type values */
    pageTypes?: Array<"fuses" | "locations" | "diagram">;
  }
> = {
  horn: {
    label: "Гудок / звук (16/*, 2/17)",
    codes: ["2/17"],
    prefixes: ["16/"],
    pageTypes: ["diagram"],
  },
  "front-left-door": {
    label: "Левая передняя дверь (DDM)",
    codes: ["3/176", "3/126"],
    tokens: ["DDM", "Left door", "Driver Door Module"],
  },
  "front-right-door": {
    label: "Правая передняя дверь (PDM)",
    codes: ["3/177", "3/127"],
    tokens: ["PDM", "Right door", "Passenger Door Module"],
  },
  fuses: {
    label: "Предохранители (11/*, 15/*)",
    prefixes: ["11/", "15/"],
  },
  engine: {
    label: "Моторный отсек",
    prefixes: ["15/", "74/"],
    tokens: ["ECM", "Engine"],
    pageTypes: ["diagram", "locations"],
  },
  cabin: {
    label: "Салон / CEM",
    prefixes: ["4/"],
    tokens: ["CEM", "Central Electronic Module"],
  },
  trunk: {
    label: "Багажник",
    prefixes: ["74/"],
    tokens: ["Rear", "Trunk", "Tailgate"],
  },
};
