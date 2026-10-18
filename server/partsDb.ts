/**
 * Local-only VIDA EPC parts catalog (data/parts.sqlite).
 * Missing file ⇒ feature off.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { listModels, yearsForModel } from "./vehicleMatrix.js";

export type PartsFgNode = {
  id: number;
  path: string;
  label: string | null;
  parentPath: string | null;
  titleRu: string | null;
  titleEn: string | null;
  depth: number;
  plateCount?: number;
};

export type PartsPlate = {
  id: number;
  fgPath: string;
  titleRu: string | null;
  titleEn: string | null;
  graphicUrl: string | null;
  graphicMime: string | null;
  graphicAvailable: boolean;
};

export type PartsPlatePart = {
  hotspot: string | null;
  pn: string | null;
  titleRu: string | null;
  titleEn: string | null;
  qty: number | null;
  unit: string | null;
  seq: number;
};

export type PartsPlateDetail = {
  plate: PartsPlate;
  parts: PartsPlatePart[];
  graphicUrl: string | null;
};

/** P3 ModelCid map (must match scripts/import_epc_parts.py). */
const MODEL_TO_CID: Record<string, number> = {
  S60: 124,
  S80: 134,
  V70: 135,
  XC60: 136,
  V60: 155,
  XC70: 156,
};

let _db: Database.Database | null = null;
let _dbPath: string | null = null;
let _dbMtimeMs = 0;

export function partsDbPath(): string {
  return resolve(process.env.PARTS_DB_PATH ?? join(process.cwd(), "data", "parts.sqlite"));
}

export function partsDataRoot(): string {
  return resolve(process.env.PARTS_DATA_ROOT ?? join(process.cwd(), "data"));
}

export function partsGraphicsDir(): string {
  return resolve(process.env.PARTS_GRAPHICS_DIR ?? join(partsDataRoot(), "parts-graphics"));
}

function graphicLooksRenderable(abs: string): boolean {
  try {
    if (!existsSync(abs) || statSync(abs).size < 32) return false;
    const head = readFileSync(abs).subarray(0, 24);
    const ext = extname(abs).toLowerCase();
    if (ext === ".svg") {
      const s = head.toString("utf8").toLowerCase();
      return s.includes("svg") || s.includes("xml");
    }
    if (ext === ".png") return head[0] === 0x89 && head[1] === 0x50;
    if (ext === ".jpg" || ext === ".jpeg") return head[0] === 0xff && head[1] === 0xd8;
    if (ext === ".gif") {
      const sig = head.toString("ascii", 0, 6);
      return sig === "GIF87a" || sig === "GIF89a";
    }
    // CGM / unknown: not browser-renderable
    return false;
  } catch {
    return false;
  }
}

/** Resolve on-disk graphic for a plate; prefer SVG over CGM/JPEG. */
export function resolvePlateGraphicPath(graphicFile: string | null | undefined): string | null {
  const raw = String(graphicFile || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  const root = partsDataRoot();
  const candidates: string[] = [];
  if (raw.includes("/")) {
    candidates.push(resolve(root, raw));
  } else {
    candidates.push(resolve(partsGraphicsDir(), raw));
  }
  const primary = candidates[0];
  if (!primary) return null;
  const ext = extname(primary).toLowerCase();
  if (ext === ".cgm" || ext === ".bin" || ext === ".gif") {
    const svg = join(partsGraphicsDir(), `${basename(primary, ext)}.svg`);
    candidates.unshift(svg);
  } else if (ext !== ".svg") {
    const svg = join(partsGraphicsDir(), `${basename(primary, ext)}.svg`);
    candidates.unshift(svg);
  }
  for (const p of candidates) {
    if (graphicLooksRenderable(p)) return p;
  }
  return null;
}

function mimeForGraphicPath(abs: string): string {
  const e = extname(abs).toLowerCase();
  if (e === ".svg") return "image/svg+xml; charset=utf-8";
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".gif") return "image/gif";
  if (e === ".cgm") return "image/cgm";
  return "application/octet-stream";
}

function plateHasGraphic(graphicFile: string | null): boolean {
  return resolvePlateGraphicPath(graphicFile) != null;
}

function mapPlateRow(r: {
  id: number;
  fg_path: string;
  title_ru: string | null;
  title_en: string | null;
  graphic_url: string | null;
  graphic_mime: string | null;
  graphic_file?: string | null;
}): PartsPlate {
  const graphicFile = r.graphic_file ?? null;
  return {
    id: r.id,
    fgPath: r.fg_path,
    titleRu: r.title_ru,
    titleEn: r.title_en,
    graphicUrl: r.graphic_url,
    graphicMime: r.graphic_mime,
    graphicAvailable: plateHasGraphic(graphicFile),
  };
}

export function getPartsDb(): Database.Database | null {
  const path = partsDbPath();
  if (!existsSync(path)) {
    if (_db) {
      try {
        _db.close();
      } catch {
        /* ignore */
      }
    }
    _db = null;
    _dbPath = null;
    _dbMtimeMs = 0;
    return null;
  }
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    /* ignore */
  }
  if (_db && _dbPath === path && mtimeMs === _dbMtimeMs) return _db;
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
  }
  _db = new Database(path, { readonly: true, fileMustExist: true });
  _dbPath = path;
  _dbMtimeMs = mtimeMs;
  return _db;
}

export function getPartsStatus(): {
  available: boolean;
  path: string;
  builtAt: string | null;
  fgCount: number;
  plateCount: number;
  sizeBytes: number;
} {
  const path = partsDbPath();
  if (!existsSync(path)) {
    return { available: false, path, builtAt: null, fgCount: 0, plateCount: 0, sizeBytes: 0 };
  }
  const db = getPartsDb();
  if (!db) {
    return { available: false, path, builtAt: null, fgCount: 0, plateCount: 0, sizeBytes: 0 };
  }
  const meta = (key: string) =>
    (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value ??
    null;
  const fgCount = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM fg_nodes").get() as { n: number }).n || 0,
  );
  const plateCount = Number(
    (db.prepare("SELECT COUNT(*) AS n FROM plates").get() as { n: number }).n || 0,
  );
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(path).size;
  } catch {
    /* ignore */
  }
  return {
    available: true,
    path,
    builtAt: meta("built_at"),
    fgCount,
    plateCount,
    sizeBytes,
  };
}

export function modelCidFor(model: string, _year?: string): number | null {
  const m = String(model || "")
    .trim()
    .toUpperCase();
  if (!m) return null;
  return MODEL_TO_CID[m] ?? null;
}

export function listPartsCoveredModels(): string[] {
  const db = getPartsDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT m.model AS model
       FROM models m
       JOIN plate_models pm ON pm.model_cid = m.model_cid
       ORDER BY m.model`,
    )
    .all() as Array<{ model: string }>;
  return rows.map((r) => r.model);
}

export function listPartsFilters(): {
  models: string[];
  coveredModels: string[];
  yearsByModel: Record<string, string[]>;
} {
  const models = listModels();
  const covered = new Set(listPartsCoveredModels().map((m) => m.toUpperCase()));
  return {
    models,
    coveredModels: models.filter((m) => covered.has(m.toUpperCase())),
    yearsByModel: Object.fromEntries(models.map((m) => [m, yearsForModel(m)])),
  };
}

function displayTitle(ru: string | null, en: string | null, fallback: string): string {
  const a = (ru || "").trim();
  if (a) return a;
  const b = (en || "").trim();
  if (b) return b;
  return fallback;
}

/**
 * FG tree roots (depth=1) or children of `parent` path.
 * When model set, annotate plateCount for that ModelCid (direct plates under node path prefix).
 */
export function listPartsTree(opts: {
  model?: string;
  year?: string;
  parent?: string;
}): PartsFgNode[] {
  const db = getPartsDb();
  if (!db) return [];
  const parent = String(opts.parent || "").trim();
  const cid = modelCidFor(opts.model || "", opts.year);

  let rows: Array<{
    id: number;
    path: string;
    label: string | null;
    parent_path: string | null;
    title_ru: string | null;
    title_en: string | null;
    depth: number;
  }>;

  if (!parent) {
    rows = db
      .prepare(
        `SELECT id, path, label, parent_path, title_ru, title_en, depth
         FROM fg_nodes WHERE depth = 1 ORDER BY path`,
      )
      .all() as typeof rows;
  } else {
    rows = db
      .prepare(
        `SELECT id, path, label, parent_path, title_ru, title_en, depth
         FROM fg_nodes WHERE parent_path = ? ORDER BY path`,
      )
      .all(parent) as typeof rows;
  }

  const nodes = rows.map((r) => {
    const node: PartsFgNode = {
      id: r.id,
      path: r.path,
      label: r.label,
      parentPath: r.parent_path,
      titleRu: r.title_ru,
      titleEn: r.title_en,
      depth: r.depth,
    };
    if (cid != null) {
      const n = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT p.id) AS n
             FROM plates p
             JOIN plate_models pm ON pm.plate_id = p.id AND pm.model_cid = ?
             WHERE p.fg_path = ? OR p.fg_path LIKE ?`,
          )
          .get(cid, r.path, `${r.path}/%`) as { n: number }
      ).n;
      node.plateCount = Number(n || 0);
    }
    return node;
  });
  // Hide FG branches with no plates for the selected model (VIDA-like).
  if (cid != null) {
    return nodes.filter((n) => (n.plateCount ?? 0) > 0);
  }
  return nodes;
}

function normalizeFgPath(raw: string): string {
  let fg = String(raw || "").trim();
  if (!fg) return "";
  if (!fg.startsWith("/")) fg = `/${fg}`;
  return fg.replace(/\/+$/, "") || "/";
}

export function listPartsPlates(opts: {
  fg: string;
  model?: string;
  year?: string;
}): PartsPlate[] {
  const db = getPartsDb();
  if (!db) return [];
  const fg = normalizeFgPath(opts.fg);
  if (!fg) return [];
  const cid = modelCidFor(opts.model || "", opts.year);

  type PlateRow = {
    id: number;
    fg_path: string;
    title_ru: string | null;
    title_en: string | null;
    graphic_url: string | null;
    graphic_mime: string | null;
    graphic_file: string | null;
  };

  if (cid == null) {
    const rows = db
      .prepare(
        `SELECT id, fg_path, title_ru, title_en, graphic_url, graphic_mime, graphic_file
         FROM plates
         WHERE fg_path = ? OR fg_path LIKE ?
         ORDER BY title_ru, title_en, id`,
      )
      .all(fg, `${fg}/%`) as PlateRow[];
    return rows.map((r) => mapPlateRow(r));
  }

  const rows = db
    .prepare(
      `SELECT p.id, p.fg_path, p.title_ru, p.title_en, p.graphic_url, p.graphic_mime, p.graphic_file
       FROM plates p
       JOIN plate_models pm ON pm.plate_id = p.id AND pm.model_cid = ?
       WHERE p.fg_path = ? OR p.fg_path LIKE ?
       ORDER BY p.title_ru, p.title_en, p.id`,
    )
    .all(cid, fg, `${fg}/%`) as PlateRow[];

  // Dedupe by title+graphic (same illustration often repeated per profile)
  const seen = new Set<string>();
  const out: PartsPlate[] = [];
  for (const r of rows) {
    const key = `${(r.title_ru || r.title_en || "").toLowerCase()}|${r.graphic_url || r.graphic_file || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapPlateRow(r));
  }
  return out;
}

function plateAllowedForModel(db: Database.Database, plateId: number, cid: number | null): boolean {
  if (cid == null) return true;
  const row = db
    .prepare(`SELECT 1 AS ok FROM plate_models WHERE plate_id = ? AND model_cid = ? LIMIT 1`)
    .get(plateId, cid) as { ok: number } | undefined;
  return Boolean(row);
}

export function getPlateDetail(opts: {
  plateId: number;
  model?: string;
  year?: string;
  lang?: "ru" | "en";
}): PartsPlateDetail | null {
  const db = getPartsDb();
  if (!db) return null;
  const plateId = Number(opts.plateId);
  if (!Number.isFinite(plateId) || plateId <= 0) return null;
  const cid = modelCidFor(opts.model || "", opts.year);
  if (!plateAllowedForModel(db, plateId, cid)) return null;

  const row = db
    .prepare(
      `SELECT id, fg_path, title_ru, title_en, graphic_url, graphic_mime, graphic_file
       FROM plates WHERE id = ?`,
    )
    .get(plateId) as
    | {
        id: number;
        fg_path: string;
        title_ru: string | null;
        title_en: string | null;
        graphic_url: string | null;
        graphic_mime: string | null;
        graphic_file: string | null;
      }
    | undefined;
  if (!row) return null;

  const plate = mapPlateRow(row);
  const partRows = db
    .prepare(
      `SELECT hotspot, pn, title_ru, title_en, qty, unit, seq
       FROM plate_parts
       WHERE plate_id = ?
       ORDER BY
         CASE WHEN hotspot GLOB '[0-9]*' THEN CAST(hotspot AS INTEGER) ELSE 999999 END,
         seq, id`,
    )
    .all(plateId) as Array<{
    hotspot: string | null;
    pn: string | null;
    title_ru: string | null;
    title_en: string | null;
    qty: number | null;
    unit: string | null;
    seq: number;
  }>;

  const parts: PartsPlatePart[] = partRows.map((p) => ({
    hotspot: p.hotspot,
    pn: p.pn,
    titleRu: p.title_ru,
    titleEn: p.title_en,
    qty: p.qty,
    unit: p.unit,
    seq: Number(p.seq || 0),
  }));

  const graphicUrl = plate.graphicAvailable ? `/api/parts-catalog/graphic/${plate.id}` : null;
  return { plate, parts, graphicUrl };
}

export function getPlateGraphicFile(plateId: number): { path: string; mime: string } | null {
  const db = getPartsDb();
  if (!db) return null;
  const id = Number(plateId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = db
    .prepare(`SELECT graphic_file FROM plates WHERE id = ?`)
    .get(id) as { graphic_file: string | null } | undefined;
  if (!row) return null;
  const abs = resolvePlateGraphicPath(row.graphic_file);
  if (!abs) return null;
  return { path: abs, mime: mimeForGraphicPath(abs) };
}

export function partDisplayTitle(
  p: Pick<PartsPlatePart, "titleRu" | "titleEn" | "pn" | "hotspot">,
  lang: "ru" | "en" = "ru",
): string {
  const fallback = p.pn || (p.hotspot ? `#${p.hotspot}` : "—");
  if (lang === "en") return displayTitle(p.titleEn, p.titleRu, fallback);
  return displayTitle(p.titleRu, p.titleEn, fallback);
}

export function plateDisplayTitle(p: PartsPlate, lang: "ru" | "en" = "ru"): string {
  if (lang === "en") return displayTitle(p.titleEn, p.titleRu, `#${p.id}`);
  return displayTitle(p.titleRu, p.titleEn, `#${p.id}`);
}

export function fgDisplayTitle(n: PartsFgNode, lang: "ru" | "en" = "ru"): string {
  const label = n.label ? String(n.label) : n.path.replace(/^\//, "");
  if (lang === "en") return displayTitle(n.titleEn, n.titleRu, label);
  return displayTitle(n.titleRu, n.titleEn, label);
}
