/** Shared EWD path resolution — SVG existence checks for badges and /diagrams. */

import { existsSync, readFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const EWD_DATA = resolve(process.env.EWD_DATA_DIR || process.env.EWD_DIR || join(ROOT, "data", "ewd"));

type SvgDescIndex = {
  data_dir?: string;
  diagrams?: Record<string, { svg?: string }>;
};

type DeviceIndex = {
  data_dir?: string;
  by_code?: Record<string, { diagramUids?: string[] }>;
};

let cachedSvgIndex: SvgDescIndex | null | undefined;
let cachedDeviceIndex: DeviceIndex | null | undefined;
let cachedEwdCodes: Set<string> | null = null;

function toPosix(p: string): string {
  return String(p || "").replace(/\\/g, "/");
}

function loadJson<T>(name: string): T | null {
  const path = join(EWD_DATA, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function ensureIndexes() {
  if (cachedDeviceIndex === undefined) cachedDeviceIndex = loadJson<DeviceIndex>("device_index.json");
  if (cachedSvgIndex === undefined) cachedSvgIndex = loadJson<SvgDescIndex>("svg_desc_index.json");
}

function indexDataDirRaw(): string {
  ensureIndexes();
  return toPosix(cachedSvgIndex?.data_dir || cachedDeviceIndex?.data_dir || "").replace(/\/$/, "");
}

export function ewdDataDir(): string {
  ensureIndexes();
  if (process.env.EWD_SOURCE_DIR) return resolve(process.env.EWD_SOURCE_DIR);

  const fromIndex = indexDataDirRaw();
  if (fromIndex) {
    const asIs = resolve(normalize(fromIndex));
    if (existsSync(asIs)) return asIs;
  }

  // Prefer in-repo mirror of E:\manual (data/ewd/ewd_source), then MANUAL_DIR / legacy E:\manual
  const candidates = [
    resolve(EWD_DATA, "ewd_source", "39363002", "1", "2"),
    resolve(EWD_DATA, "ewd_source"),
    resolve(ROOT, "manual", "ewd_source", "39363002", "1", "2"),
    resolve(process.env.MANUAL_DIR ?? join(ROOT, "data", "ewd"), "ewd_source", "39363002", "1", "2"),
    resolve("E:\\manual", "ewd_source", "39363002", "1", "2"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/** Secondary Capital data roots (VEA 4/5, …) — SVG may live outside primary 1/2. */
export function ewdSecondaryDataDirs(): string[] {
  const roots = [
    resolve(EWD_DATA, "ewd_source", "39363002", "4", "5"),
    resolve("E:\\manual", "ewd_source", "39363002", "4", "5"),
  ];
  return roots.filter((p) => existsSync(p));
}

function underAnyEwdRoot(absPath: string): boolean {
  const target = resolve(absPath);
  const roots = [resolve(ewdDataDir()), ...ewdSecondaryDataDirs().map((p) => resolve(p))];
  // Also allow package root (sibling 1/2 ↔ 4/5)
  for (const root of roots) {
    const rel = relative(root, target);
    if (!rel.startsWith("..") && !normalize(rel).startsWith("..")) return true;
    const pkg = resolve(root, "..", "..");
    const relPkg = relative(pkg, target);
    if (!relPkg.startsWith("..") && !normalize(relPkg).startsWith("..")) return true;
  }
  return false;
}

export function safeUnderDataDir(absPath: string): boolean {
  return underAnyEwdRoot(absPath);
}

/** Remap absolute Windows paths from JSON indexes onto the live Linux/Windows data dir. */
export function resolveIndexedPath(stored: string): string | null {
  const storedPosix = toPosix(stored);
  if (!storedPosix) return null;

  const direct = resolve(normalize(storedPosix));
  if (existsSync(direct) && safeUnderDataDir(direct)) return direct;

  const root = ewdDataDir();
  const indexRoot = indexDataDirRaw();
  let rel = "";
  if (indexRoot) {
    const a = storedPosix.toLowerCase();
    const b = indexRoot.toLowerCase();
    if (a === b) rel = ".";
    else if (a.startsWith(`${b}/`)) rel = storedPosix.slice(indexRoot.length).replace(/^\/+/, "");
  }
  if (!rel || rel === ".") {
    const m12 = storedPosix.match(/ewd_source\/39363002\/1\/2\/(.+)$/i);
    if (m12) rel = m12[1];
  }
  if (!rel || rel === ".") {
    const m45 = storedPosix.match(/ewd_source\/39363002\/4\/5\/(.+)$/i);
    if (m45) {
      for (const sec of ewdSecondaryDataDirs()) {
        const candidate = resolve(sec, m45[1]);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  if (!rel || rel === ".") {
    const parts = storedPosix.split("/").filter(Boolean);
    if (parts.length >= 2) rel = parts.slice(-2).join("/");
  }
  if (!rel || rel === ".") return existsSync(root) ? root : null;

  const candidate = resolve(root, rel);
  if (existsSync(candidate) && safeUnderDataDir(candidate)) return candidate;
  for (const sec of ewdSecondaryDataDirs()) {
    const alt = resolve(sec, rel);
    if (existsSync(alt)) return alt;
  }
  return null;
}

export function svgPathExists(stored: string | undefined | null): boolean {
  if (!stored) return false;
  return Boolean(resolveIndexedPath(stored));
}

/** Codes with at least one SVG file that exists on disk (not merely indexed). */
export function loadEwdCodeSet(): Set<string> {
  if (cachedEwdCodes) return cachedEwdCodes;
  ensureIndexes();
  cachedEwdCodes = new Set();
  const device = cachedDeviceIndex;
  const svgIdx = cachedSvgIndex;
  if (!device?.by_code || !svgIdx?.diagrams) return cachedEwdCodes;
  for (const [code, rec] of Object.entries(device.by_code)) {
    const uids = rec.diagramUids || [];
    if (uids.some((uid) => svgPathExists(svgIdx.diagrams?.[uid]?.svg))) {
      cachedEwdCodes.add(code);
    }
  }
  return cachedEwdCodes;
}

/** Test / hot-reload helper */
export function resetEwdPathCache() {
  cachedSvgIndex = undefined;
  cachedDeviceIndex = undefined;
  cachedEwdCodes = null;
}
