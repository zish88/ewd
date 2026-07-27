/**
 * Lookup for extracted VIDA/EPC part illustrations (SLICE-03).
 * Index: data/vida_part_image_index.json → files under data/vida_part_images/
 *
 * When a wiring code is given (repair card), only plates tagged for that code count —
 * a PN extracted for 10/1 must not light the "has image" indicator on 3/80.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export type PartImageFile = {
  path: string;
  w?: number | null;
  h?: number | null;
  source?: string;
  graphic_id?: string;
  hotspot_key?: string | null;
  mime?: string;
  converted_from?: string;
  wiring_code?: string | null;
};

export type PartImageRecord = {
  part_number: string;
  files: PartImageFile[];
  wiring_codes?: string[];
  roles_seen?: string[];
  title_ru?: string | null;
  title_en?: string | null;
  graphic_ids?: string[];
};

type PartImageIndex = {
  parts?: PartImageRecord[];
};

let cache: Map<string, PartImageRecord> | null | undefined;
let cacheMtimeMs = -1;
let indexPathOverride: string | null = null;

const EXT_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".cgm": "image/cgm",
};

/** Prefer browser-viewable formats. CGM is not displayable in <img>. */
const EXT_RANK: Record<string, number> = {
  ".svg": 0,
  ".png": 1,
  ".jpg": 2,
  ".jpeg": 2,
  ".gif": 3,
  ".webp": 3,
  ".cgm": 9,
};

const BROWSER_VIEWABLE = new Set([".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function resetPartImageIndexCache(path?: string | null) {
  cache = undefined;
  cacheMtimeMs = -1;
  indexPathOverride = path === undefined ? null : path;
}

function indexPath(): string {
  return indexPathOverride || join(process.cwd(), "data", "vida_part_image_index.json");
}

/** Infer wiring code from filename like 978305__3-80.svg or 978305__3-80_85e59bc8.svg */
export function wiringCodeFromPath(relPath: string): string {
  const base = String(relPath || "")
    .replace(/^.*[/\\]/, "")
    .replace(/\.[^.]+$/, "");
  const m = base.match(/__(\d+)-(\d+)(?:_|$)/);
  return m ? `${m[1]}/${m[2]}` : "";
}

export function loadPartImageIndex(): Map<string, PartImageRecord> {
  const path = indexPath();
  let mtime = -1;
  try {
    if (existsSync(path)) mtime = statSync(path).mtimeMs;
  } catch {
    mtime = -1;
  }
  if (cache !== undefined && mtime === cacheMtimeMs) return cache || new Map();

  if (!existsSync(path)) {
    cache = null;
    cacheMtimeMs = mtime;
    return new Map();
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as PartImageIndex;
    const map = new Map<string, PartImageRecord>();
    for (const rec of raw.parts || []) {
      const pn = String(rec.part_number || "").trim();
      if (pn) map.set(pn, rec);
    }
    cache = map;
    cacheMtimeMs = mtime;
    return map;
  } catch {
    cache = null;
    cacheMtimeMs = mtime;
    return new Map();
  }
}

export function normalizeWiringCode(code?: string | null): string {
  const m = String(code || "")
    .trim()
    .match(/^(\d+)\s*\/\s*(\d+)/);
  return m ? `${m[1]}/${m[2]}` : String(code || "").trim();
}

export function resolvePartImageFile(
  partNumber: string,
  wiringCode?: string | null,
): {
  absPath: string;
  relPath: string;
  mime: string;
  record: PartImageRecord;
  hotspot_key?: string | null;
  wiring_code?: string | null;
} | null {
  const pn = String(partNumber || "").trim();
  if (!pn) return null;
  const rec = loadPartImageIndex().get(pn);
  if (!rec?.files?.length) return null;
  const wantCode = normalizeWiringCode(wiringCode);

  const ranked = [...rec.files]
    .map((f) => {
      const rel = String(f.path || "").replace(/^[/\\]+/, "");
      const abs = join(process.cwd(), "data", rel);
      const ext = extname(abs).toLowerCase();
      // Indicator + popover need a browser-viewable file (CGM alone is a false positive).
      if (!BROWSER_VIEWABLE.has(ext)) {
        return null;
      }
      const fileCode =
        normalizeWiringCode(f.wiring_code) || normalizeWiringCode(wiringCodeFromPath(rel));
      // When card has a wiring code: only accept plates for that exact code.
      // Untagged / other-code plates must not show the "has image" indicator.
      if (wantCode && fileCode !== wantCode) {
        return null;
      }
      let sizeRank = 1;
      try {
        if (existsSync(abs)) {
          const sz = statSync(abs).size;
          if (sz > 400_000) sizeRank = 3;
          else if (sz > 150_000) sizeRank = 2;
          else sizeRank = 0;
        }
      } catch {
        /* ignore */
      }
      return {
        f: { ...f, wiring_code: fileCode || f.wiring_code || null },
        rel,
        abs,
        ext,
        rank: [EXT_RANK[ext] ?? 5, sizeRank] as [number, number],
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x && existsSync(x.abs)))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);

  const best = ranked[0];
  if (!best) return null;
  const mime =
    best.f.mime ||
    EXT_MIME[best.ext] ||
    (best.ext === ".svg" ? "image/svg+xml" : "application/octet-stream");
  return {
    absPath: best.abs,
    relPath: best.rel,
    mime,
    record: rec,
    hotspot_key: best.f.hotspot_key,
    wiring_code: best.f.wiring_code || null,
  };
}

export function partImageUrl(partNumber: string, wiringCode?: string | null): string | null {
  const hit = resolvePartImageFile(partNumber, wiringCode);
  if (!hit) return null;
  const pn = encodeURIComponent(String(partNumber).trim());
  const code = normalizeWiringCode(wiringCode);
  return code ? `/api/parts/image/${pn}?code=${encodeURIComponent(code)}` : `/api/parts/image/${pn}`;
}
