/**
 * Dynamic wire-color filter for the current node’s contact cards.
 * Chip list is built only from payload wire_color values — never a static palette.
 */
import {
  normalizeWireColorKey,
  wireColorHex,
  wireColorParts,
} from "./wireColors.js";

export type WireColorCard = {
  wire_color?: string | null;
  wire_color_label?: string | null;
};

/** Normalized wire color key from a card, or "" if absent / placeholder. */
export function cardWireColorKey(card: WireColorCard): string {
  const raw = card.wire_color ?? card.wire_color_label ?? "";
  const key = normalizeWireColorKey(raw);
  if (!key || key === "—" || key === "-") return "";
  return key;
}

/** Unique wire colors present on the current node, sorted for stable chip order. */
export function collectUniqueWireColors(cards: WireColorCard[]): string[] {
  const seen = new Set<string>();
  for (const card of cards) {
    const key = cardWireColorKey(card);
    if (key) seen.add(key);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Keep cards matching selected color; empty/null selected → all cards. */
export function filterCardsByWireColor<T extends WireColorCard>(
  cards: T[],
  selectedColor: string | null | undefined,
): T[] {
  const want = normalizeWireColorKey(selectedColor || "");
  if (!want) return cards;
  return cards.filter((c) => cardWireColorKey(c) === want);
}

/** True when a card’s wire color matches the active filter (or filter is off). */
export function cardMatchesWireColorFilter(
  card: WireColorCard,
  selectedColor: string | null | undefined,
): boolean {
  const want = normalizeWireColorKey(selectedColor || "");
  if (!want) return true;
  return cardWireColorKey(card) === want;
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** Light / white-ish wires need a visible outline on light UI (e.g. WH). */
export function wireNeedsContrastBorder(wireColor: string): boolean {
  const parts = wireColorParts(wireColor);
  if (!parts.length) return false;
  return parts.some((p) => relativeLuminance(wireColorHex(p, "#808080")) >= 0.72);
}

export type WireChipStyle = {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  color: string;
  textShadow: string;
  border: string;
  boxShadow?: string;
};

/** Visual style for a filter chip — dual stripe + contrast border for light colors. */
export function wireColorChipStyle(wireColor: string): WireChipStyle {
  const parts = wireColorParts(wireColor);
  const light = wireNeedsContrastBorder(wireColor);
  const border = light ? "1px solid var(--border-color)" : "1px solid transparent";
  const darkText = light;
  const color = darkText ? "#0f172a" : "#f8fafc";
  const textShadow = darkText
    ? "none"
    : "0 0 2px #000, 1px 1px 1px #000";

  if (parts.length >= 2) {
    const c1 = wireColorHex(parts[0]);
    const c2 = wireColorHex(parts[1]);
    return {
      background: `linear-gradient(135deg,${c1} 25%,${c2} 25%,${c2} 50%,${c1} 50%,${c1} 75%,${c2} 75%)`,
      backgroundSize: "16px 16px",
      color: "#ffffff",
      textShadow: "0 0 2px #000, 1px 1px 1px #000",
      border: light ? "1px solid var(--border-color)" : "1px solid rgba(0,0,0,0.25)",
      boxShadow: light ? "inset 0 0 0 1px rgba(15,23,42,0.12)" : undefined,
    };
  }

  if (parts.length === 1) {
    return {
      background: wireColorHex(parts[0]),
      color,
      textShadow,
      border,
      boxShadow: light ? "inset 0 0 0 1px rgba(15,23,42,0.15)" : undefined,
    };
  }

  return {
    background: "var(--input-bg)",
    color: "var(--text-main)",
    textShadow: "none",
    border: "1px solid var(--border-color)",
  };
}

/**
 * Toggle semantics: pick a color, or clear when clicking the active chip / "all".
 * Returns null when filter is off (“Все цвета”).
 */
export function nextWireColorFilter(
  current: string | null,
  clicked: string | null,
): string | null {
  if (!clicked) return null;
  const key = normalizeWireColorKey(clicked);
  if (!key) return null;
  if (normalizeWireColorKey(current || "") === key) return null;
  return key;
}
