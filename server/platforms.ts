/**
 * Volvo P3 catalog (single active platform).
 * Paths: env overrides or legacy data/wiring.sqlite + data/ewd.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type PlatformStatus = "active";

export type PlatformDef = {
  id: string;
  label: string;
  subtitle: string;
  models: string[];
  status: PlatformStatus;
  wiringDbRel: string;
  dtcDbRel: string;
  ewdDataRel: string;
};

export const DEFAULT_PLATFORM_ID = "p3";

export const PLATFORMS: PlatformDef[] = [
  {
    id: "p3",
    label: "P3",
    subtitle: "XC70 · V70 · S80 · XC60 · S60 · V60",
    models: ["XC70", "V70", "S80", "XC60", "S60", "V60"],
    status: "active",
    wiringDbRel: "data/wiring.sqlite",
    dtcDbRel: "data/dtc.sqlite",
    ewdDataRel: "data/ewd",
  },
];

const byId = new Map(PLATFORMS.map((p) => [p.id, p]));

export function listPlatforms(): PlatformDef[] {
  return PLATFORMS.map((p) => ({ ...p }));
}

export function getPlatform(id: string | null | undefined): PlatformDef {
  const key = String(id || "").trim().toLowerCase();
  return byId.get(key) || byId.get(DEFAULT_PLATFORM_ID)!;
}

export function normalizePlatformId(_raw: unknown): string {
  return DEFAULT_PLATFORM_ID;
}

export function platformPaths(_platformId?: string | null): {
  platform: PlatformDef;
  wiringDb: string;
  dtcDb: string;
  ewdDataDir: string;
  ready: boolean;
} {
  const platform = getPlatform(DEFAULT_PLATFORM_ID);
  const wiringDb = resolve(process.env.DATABASE_PATH ?? platform.wiringDbRel);
  const dtcDb = resolve(process.env.DTC_DATABASE_PATH ?? platform.dtcDbRel);
  const ewdDataDir = resolve(process.env.EWD_DATA_DIR ?? platform.ewdDataRel);
  return {
    platform,
    wiringDb,
    dtcDb,
    ewdDataDir,
    ready: existsSync(wiringDb),
  };
}

export function platformPublicDto(p: PlatformDef = getPlatform(DEFAULT_PLATFORM_ID)) {
  const paths = platformPaths(p.id);
  return {
    id: p.id,
    label: p.label,
    subtitle: p.subtitle,
    models: p.models,
    status: p.status,
    ready: paths.ready,
  };
}

export function platformsCatalogPayload() {
  return {
    default_id: DEFAULT_PLATFORM_ID,
    brand: "Volvo EWD",
    tagline: "Электросхемы Volvo",
    platforms: PLATFORMS.map((p) => platformPublicDto(p)),
  };
}
