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

/** sRGB relative luminance 0…1 (WCAG). */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * True when insulation includes a light pigment (WH, YE, …) that vanishes on white sheets.
 * Used for UI chips and for dark understrokes on SVG highlights.
 */
export function wireNeedsContrastBorder(wireColor: string): boolean {
  const parts = wireColorParts(wireColor);
  if (!parts.length) return false;
  return parts.some((p) => relativeLuminance(wireColorHex(p, "#808080")) >= 0.72);
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
