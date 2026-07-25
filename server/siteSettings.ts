import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type SiteFeatures = {
  /** Users can suggest card corrections (email tickets). */
  suggestions: boolean;
  /** EWD SVG diagrams / «Показать на схеме». */
  ewdDiagrams: boolean;
  /** @deprecated Capital FaceViews replace PDF tables — kept for old admin JSON. */
  pdfTables?: boolean;
  /** VIN decode. */
  vinSearch: boolean;
  /** Zone / component navigation. */
  navBrowse: boolean;
  /** DTC / OBD fault-code dictionary search. */
  dtcSearch: boolean;
  /** Live ESP32 OBD gateway scan panel (enrich + UI). */
  obdAdapter: boolean;
};

export type ThemeId = "charcoal" | "caspian" | "amber";
export type UiDensity = "compact" | "normal" | "comfortable";

export type AppearanceColors = {
  accent?: string;
  bgMain?: string;
  bgCard?: string;
  textMain?: string;
  textMuted?: string;
  border?: string;
  cta?: string;
};

/** Design tokens editable from admin «Внешний вид». Empty strings = use theme preset. */
export type SiteAppearance = {
  defaultTheme: ThemeId;
  colors: AppearanceColors;
  fontFamily: string;
  /** Optional Google Fonts CSS URL (fonts.googleapis.com only). */
  fontUrl: string;
  radiusMd: string;
  radiusLg: string;
  cardPadding: string;
  cardGap: string;
  cardTitleSize: string;
  appBarHeight: string;
  chipFontSize: string;
  btnMinHeight: string;
  uiDensity: UiDensity;
};

export type SiteSettings = {
  /** Master switch: false → public site shows maintenance. */
  siteOpen: boolean;
  features: SiteFeatures;
  appearance: SiteAppearance;
  updatedAt?: string;
};

const DEFAULT_APPEARANCE: SiteAppearance = {
  defaultTheme: "caspian",
  colors: {},
  fontFamily: "",
  fontUrl: "",
  radiusMd: "",
  radiusLg: "",
  cardPadding: "",
  cardGap: "",
  cardTitleSize: "",
  appBarHeight: "",
  chipFontSize: "",
  btnMinHeight: "",
  uiDensity: "normal",
};

const DEFAULTS: SiteSettings = {
  siteOpen: true,
  features: {
    suggestions: true,
    ewdDiagrams: true,
    pdfTables: false,
    vinSearch: true,
    navBrowse: true,
    dtcSearch: true,
    obdAdapter: true,
  },
  appearance: structuredClone(DEFAULT_APPEARANCE),
};

const THEME_IDS = new Set<ThemeId>(["charcoal", "caspian", "amber"]);
const DENSITIES = new Set<UiDensity>(["compact", "normal", "comfortable"]);

function sanitizeColor(v: unknown): string | undefined {
  const s = String(v || "").trim();
  if (!s) return undefined;
  // Allow #rgb #rrggbb #rrggbbaa and simple rgb()/hsl()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(rgb|hsl)a?\([^)]+\)$/i.test(s)) return s;
  return undefined;
}

function sanitizeCssSize(v: unknown): string {
  const s = String(v || "").trim();
  if (!s) return "";
  // One or two lengths: 12px | 0.65rem 0.7rem
  if (/^\d+(\.\d+)?(px|rem|em|%)(\s+\d+(\.\d+)?(px|rem|em|%))?$/i.test(s)) return s;
  return "";
}

function sanitizeFont(v: unknown): string {
  const s = String(v || "").trim();
  if (!s) return "";
  // Block CSS injection
  if (/[;{}]|url\s*\(/i.test(s)) return "";
  return s.slice(0, 160);
}

function sanitizeFontUrl(v: unknown): string {
  const s = String(v || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    if (u.hostname !== "fonts.googleapis.com" && u.hostname !== "fonts.gstatic.com") return "";
    return u.toString().slice(0, 500);
  } catch {
    return "";
  }
}

export function normalizeAppearance(raw?: Partial<SiteAppearance> | null): SiteAppearance {
  const base = structuredClone(DEFAULT_APPEARANCE);
  if (!raw || typeof raw !== "object") return base;
  const theme = String(raw.defaultTheme || "").trim() as ThemeId;
  base.defaultTheme = THEME_IDS.has(theme) ? theme : base.defaultTheme;
  const dens = String(raw.uiDensity || "").trim() as UiDensity;
  base.uiDensity = DENSITIES.has(dens) ? dens : base.uiDensity;
  base.fontFamily = sanitizeFont(raw.fontFamily);
  base.fontUrl = sanitizeFontUrl((raw as { fontUrl?: unknown }).fontUrl);
  base.radiusMd = sanitizeCssSize(raw.radiusMd);
  base.radiusLg = sanitizeCssSize(raw.radiusLg);
  base.cardPadding = sanitizeCssSize(raw.cardPadding);
  base.cardGap = sanitizeCssSize(raw.cardGap);
  base.cardTitleSize = sanitizeCssSize(raw.cardTitleSize);
  base.appBarHeight = sanitizeCssSize((raw as { appBarHeight?: unknown }).appBarHeight);
  base.chipFontSize = sanitizeCssSize((raw as { chipFontSize?: unknown }).chipFontSize);
  base.btnMinHeight = sanitizeCssSize((raw as { btnMinHeight?: unknown }).btnMinHeight);
  const c = raw.colors && typeof raw.colors === "object" ? raw.colors : {};
  base.colors = {
    accent: sanitizeColor(c.accent),
    bgMain: sanitizeColor(c.bgMain),
    bgCard: sanitizeColor(c.bgCard),
    textMain: sanitizeColor(c.textMain),
    textMuted: sanitizeColor(c.textMuted),
    border: sanitizeColor(c.border),
    cta: sanitizeColor(c.cta),
  };
  // Drop undefined keys for cleaner JSON
  for (const k of Object.keys(base.colors) as Array<keyof AppearanceColors>) {
    if (!base.colors[k]) delete base.colors[k];
  }
  return base;
}

function settingsPath(): string {
  const dbPath = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(dbPath), "site-settings.json");
}

export function readSiteSettings(): SiteSettings {
  const path = settingsPath();
  if (!existsSync(path)) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<SiteSettings>;
    return {
      siteOpen: raw.siteOpen !== false,
      features: { ...DEFAULTS.features, ...(raw.features || {}) },
      appearance: normalizeAppearance(raw.appearance),
      updatedAt: raw.updatedAt,
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function writeSiteSettings(next: SiteSettings): SiteSettings {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const saved: SiteSettings = {
    siteOpen: Boolean(next.siteOpen),
    features: { ...DEFAULTS.features, ...(next.features || {}) },
    appearance: normalizeAppearance(next.appearance),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(saved, null, 2), "utf-8");
  return saved;
}

export function publicSiteStatus() {
  const s = readSiteSettings();
  return {
    siteOpen: s.siteOpen,
    features: s.features,
    appearance: s.appearance,
  };
}

export { DEFAULT_APPEARANCE };
