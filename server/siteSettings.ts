import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type SiteFeatures = {
  /** Users can suggest card corrections (email tickets). */
  suggestions: boolean;
  /** EWD SVG diagrams / «Показать на схеме». */
  ewdDiagrams: boolean;
  /** PDF pinout tables. */
  pdfTables: boolean;
  /** VIN decode. */
  vinSearch: boolean;
  /** Zone / component navigation. */
  navBrowse: boolean;
  /** DTC / OBD fault-code dictionary search. */
  dtcSearch: boolean;
};

export type SiteSettings = {
  /** Master switch: false → public site shows maintenance. */
  siteOpen: boolean;
  features: SiteFeatures;
  updatedAt?: string;
};

const DEFAULTS: SiteSettings = {
  siteOpen: true,
  features: {
    suggestions: true,
    ewdDiagrams: true,
    pdfTables: true,
    vinSearch: true,
    navBrowse: true,
    dtcSearch: true,
  },
};

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
  };
}
