/**
 * Abstract Volvo EWD wire-color code → CSS hex.
 * Codes only (RD, BU, …) — never pin/connector/model literals.
 */

export const WIRE_COLOR_HEX: Record<string, string> = {
  RD: "#dc2626",
  R: "#dc2626",
  BK: "#111827",
  SB: "#111827",
  BN: "#854d0e",
  BU: "#2563eb",
  BL: "#2563eb",
  GN: "#16a34a",
  GY: "#6b7280",
  GR: "#6b7280",
  LGN: "#84cc16",
  OG: "#f97316",
  OR: "#f97316",
  PK: "#ec4899",
  P: "#ec4899",
  VT: "#9333ea",
  VO: "#7c3aed",
  VI: "#9333ea",
  WH: "#f8fafc",
  W: "#f8fafc",
  YE: "#eab308",
  Y: "#eab308",
  SR: "#6b7280",
};

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

export function normalizeWireColorKey(raw: string | undefined | null): string {
  return String(raw || "")
    .toUpperCase()
    // SVG / VIDA: GN/BN, GN BN, GN_BN, GN-BN
    .replace(/[/_.,\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

/** Split BU-GY → ["BU","GY"]; single RD → ["RD"]. */
export function wireColorParts(wireColor: string): string[] {
  const key = normalizeWireColorKey(wireColor);
  if (!key) return [];
  return key.split("-").filter(Boolean);
}

/**
 * True when colors describe the same insulation.
 * Dual codes match regardless of order: GN-BN === BN-GN === GN/BN.
 */
export function wireColorsMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const na = normalizeWireColorKey(a);
  const nb = normalizeWireColorKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = wireColorParts(na).slice().sort().join("-");
  const pb = wireColorParts(nb).slice().sort().join("-");
  return Boolean(pa && pb && pa === pb);
}

export function wireColorHex(code: string, fallback = "#059669"): string {
  const c = String(code || "").toUpperCase().trim();
  return WIRE_COLOR_HEX[c] || fallback;
}

/** One or two hex colors for marker border (dual insulation). */
export function wireBorderColors(wireColor: string): [string] | [string, string] {
  const parts = wireColorParts(wireColor);
  if (parts.length >= 2) {
    return [wireColorHex(parts[0]), wireColorHex(parts[1])];
  }
  if (parts.length === 1) return [wireColorHex(parts[0])];
  return ["#059669"];
}
