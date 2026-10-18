/**
 * Local-only VIDA EPC parts catalog (data/parts.sqlite).
 * Missing file ⇒ feature off.
 */
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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

export function partsDbPath(): string {
  return resolve(process.env.PARTS_DB_PATH ?? join(process.cwd(), "data", "parts.sqlite"));
}

export function getPartsDb(): Database.Database | null {
  const path = partsDbPath();
  if (!existsSync(path)) {
    _db = null;
    _dbPath = null;
    return null;
  }
  if (_db && _dbPath === path) return _db;
  _db = new Database(path, { readonly: true, fileMustExist: true });
  _dbPath = path;
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

  return rows.map((r) => {
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

  if (cid == null) {
    const rows = db
      .prepare(
        `SELECT id, fg_path, title_ru, title_en, graphic_url, graphic_mime
         FROM plates
         WHERE fg_path = ? OR fg_path LIKE ?
         ORDER BY title_ru, title_en, id`,
      )
      .all(fg, `${fg}/%`) as Array<{
      id: number;
      fg_path: string;
      title_ru: string | null;
      title_en: string | null;
      graphic_url: string | null;
      graphic_mime: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      fgPath: r.fg_path,
      titleRu: r.title_ru,
      titleEn: r.title_en,
      graphicUrl: r.graphic_url,
      graphicMime: r.graphic_mime,
    }));
  }

  const rows = db
    .prepare(
      `SELECT p.id, p.fg_path, p.title_ru, p.title_en, p.graphic_url, p.graphic_mime
       FROM plates p
       JOIN plate_models pm ON pm.plate_id = p.id AND pm.model_cid = ?
       WHERE p.fg_path = ? OR p.fg_path LIKE ?
       ORDER BY p.title_ru, p.title_en, p.id`,
    )
    .all(cid, fg, `${fg}/%`) as Array<{
    id: number;
    fg_path: string;
    title_ru: string | null;
    title_en: string | null;
    graphic_url: string | null;
    graphic_mime: string | null;
  }>;

  // Dedupe by title+graphic (same illustration often repeated per profile)
  const seen = new Set<string>();
  const out: PartsPlate[] = [];
  for (const r of rows) {
    const key = `${(r.title_ru || r.title_en || "").toLowerCase()}|${r.graphic_url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: r.id,
      fgPath: r.fg_path,
      titleRu: r.title_ru,
      titleEn: r.title_en,
      graphicUrl: r.graphic_url,
      graphicMime: r.graphic_mime,
    });
  }
  return out;
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
