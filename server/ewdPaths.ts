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

export function safeUnderDataDir(absPath: string): boolean {
  const root = resolve(ewdDataDir());
  const target = resolve(absPath);
  const rel = relative(root, target);
  return !rel.startsWith("..") && !normalize(rel).startsWith("..");
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
    const m = storedPosix.match(/ewd_source\/39363002\/1\/2\/(.+)$/i);
    if (m) rel = m[1];
  }
  if (!rel || rel === ".") {
    const parts = storedPosix.split("/").filter(Boolean);
    if (parts.length >= 2) rel = parts.slice(-2).join("/");
  }
  if (!rel || rel === ".") return existsSync(root) ? root : null;

  const candidate = resolve(root, rel);
  if (existsSync(candidate) && safeUnderDataDir(candidate)) return candidate;
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
