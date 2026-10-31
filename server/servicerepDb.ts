/**
 * Local-only service manual sqlite (data/servicerep.sqlite).
 * Missing file ⇒ feature off.
 */
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { rewriteServiceHtmlImages } from "./servicerepGraphics.js";
import { repairServiceTitle, repairServiceHtml } from "./serviceTitleRepair.js";
import { extractTorqueinfoFromHtml, rewriteTorqueinfoHtml, torqueinfoDisplayTitle } from "./serviceTorqueinfo.js";

/** Common Swedish href/@title fragments → RU when target doc is missing from sqlite. */
const SV_XREF_PHRASES: Array<[RegExp, string]> = [
  [/\bÅtdragningsmoment\b/gi, "Момент затяжки"],
  [/\bVäxellåda\b/gi, "Коробка передач"],
  [/\bkontroll\b/gi, "проверка"],
  [/\bbyte\b/gi, "замена"],
  [/\bDitsättning\b/gi, "Установка"],
  [/\bBorttagning\b/gi, "Снятие"],
  [/\bSpecifikationer?\b/gi, "Спецификации"],
  [/\bTÄTNINGSPLUGG\b/gi, "Заглушки"],
  [/\bBromsskiva bak till hjulnav\b/gi, "Тормозной диск задний к ступице"],
  [/\bBromsskiva fram till hjulnav\b/gi, "Тормозной диск передний к ступице"],
  [/\bBromsslang till bromsok bak\b/gi, "Тормозной шланг к суппорту задний"],
  [/\bBromsslang till bromsok fram\b/gi, "Тормозной шланг к суппорту передний"],
  [/\bGlidstång bromsok bak\b/gi, "Направляющий палец суппорта задний"],
  [/\bGlidstång bromsok fram\b/gi, "Направляющий палец суппорта передний"],
  [/\bFäste\b/gi, "Крепление"],
  [/\bBromsok\b/gi, "Суппорт тормоза"],
  [/\bBromsskiva\b/gi, "Тормозной диск"],
  [/\bBromsslang\b/gi, "Тормозной шланг"],
  [/\bGlidstång\b/gi, "Направляющий палец"],
];

function looksNonRussian(label: string): boolean {
  const s = String(label || "");
  if (!s) return false;
  if (/[ÅÄÖåäö]/.test(s)) return true;
  const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (s.match(/[A-Za-z]/g) || []).length;
  return lat >= 4 && cyr === 0;
}

/** Lower is better for RU UI: Cyrillic titles before leftover Swedish/English VIDA stubs. */
export function preferRuDocRank(title: string, html?: string | null): number {
  const t = String(title || "").trim();
  if (/[А-Яа-яЁё]/.test(t)) return 0;
  const sample = `${t}\n${String(html || "").slice(0, 1200)}`;
  if (/[ÅÄÖåäö]/.test(sample) || /\b(Förberedelser|Borttagning|Ditsättning|Ta bort|Sätt dit)\b/i.test(sample)) {
    return 3;
  }
  if (looksNonRussian(t)) return 2;
  if (!t) return 1;
  return 1;
}

function localizeSvXrefLabel(label: string): string {
  let out = String(label || "");
  for (const [re, ru] of SV_XREF_PHRASES) out = out.replace(re, ru);
  return out;
}

/** Replace Swedish/foreign sr-xref labels with RU document titles when chronicle resolves. */
export function rewriteServiceHtmlXrefLabels(
  html: string | null,
  titleByChron: Map<string, string>,
): string | null {
  if (!html || !html.includes("sr-xref")) return html;
  return html.replace(
    /<a\b([^>]*\bclass="[^"]*\bsr-xref\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi,
    (full, attrs: string, inner: string) => {
      const chronM = String(attrs).match(/\bdata-sr-chronicle="([0-9a-f]{16})"/i);
      const chron = chronM?.[1]?.toLowerCase() || "";
      const plainInner = String(inner).replace(/<[^>]+>/g, "").trim();
      let next = plainInner;
      if (chron && titleByChron.has(chron)) {
        const ru = repairServiceTitle(titleByChron.get(chron) || "").trim();
        if (ru && looksNonRussian(plainInner)) next = ru;
      } else if (looksNonRussian(plainInner)) {
        next = localizeSvXrefLabel(plainInner);
      }
      if (!next || next === plainInner) return full;
      return `<a${attrs}>${next.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</a>`;
    },
  );
}

/**
 * Mark VIDA page-wide / multi-column form tables for landscape screen+print.
 * Adds `sr-table-pgwide` when a wrap's table has ≥6 logical columns (colspan-aware).
 */
export function markServiceWideTables(html: string | null): string | null {
  if (!html || !html.includes("sr-table-wrap")) return html;
  return html.replace(
    /<div class="(sr-table-wrap)((?:\s+[\w-]+)*)">([\s\S]*?)<\/table>\s*<\/div>/gi,
    (full, _wrap: string, extra: string, inner: string) => {
      if (/\bsr-table-pgwide\b/.test(extra)) return full;
      let maxCols = 0;
      const rows = String(inner).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
      for (const row of rows) {
        let cols = 0;
        const cells = row.match(/<(?:td|th)\b([^>]*)>/gi) || [];
        for (const cell of cells) {
          const m = /\bcolspan\s*=\s*["']?(\d+)/i.exec(cell);
          cols += m ? Number(m[1]) : 1;
        }
        if (cols > maxCols) maxCols = cols;
      }
      if (maxCols < 6) return full;
      return full.replace(
        /<div class="sr-table-wrap/,
        '<div class="sr-table-wrap sr-table-pgwide',
      );
    },
  );
}

const ROOT = resolve(process.cwd());

export type ServiceStatus = {
  available: boolean;
  path: string;
  docCount: number;
  htmlCount: number;
  treeCount: number;
};

export type ServiceTreeVariant = {
  treeItemId: number;
  docCount: number;
};

export type ServiceTreeNode = {
  id: string;
  kind: "fg" | "item" | "item-group";
  code?: string;
  title: string;
  treeItemId?: number;
  children?: ServiceTreeNode[];
  docCount?: number;
  /** Folder may have children not yet loaded (lazy tree). */
  hasChildren?: boolean;
  childCount?: number;
  /** item-group: number of same-title variants under this branch. */
  variantCount?: number;
  variants?: ServiceTreeVariant[];
};

export type ServiceFilterStatus = "none" | "applied" | "no_profiles";

export type ServiceTreeResult = {
  tree: ServiceTreeNode[];
  filterStatus: ServiceFilterStatus;
  profileCount: number;
  model: string | null;
  year: string | null;
};

export type ServiceSearchHit = {
  id: number;
  title: string;
  hasHtml: boolean;
  qualifierId: number | null;
};

export type ServiceDoc = {
  id: number;
  title: string;
  html: string | null;
  hasHtml: boolean;
  path: string | null;
  conditionType: string | null;
};

let db: Database.Database | null = null;
let dbPathOpened = "";
let dbMtimeMs = 0;

type StatusCache = { at: number; value: ServiceStatus };
let statusCache: StatusCache | null = null;
const STATUS_TTL_MS = 60_000;

export function servicerepDbPath(): string {
  return resolve(process.env.SERVICEREP_DATABASE_PATH || join(ROOT, "data", "servicerep.sqlite"));
}

export function openServicerepDb(): Database.Database | null {
  const path = servicerepDbPath();
  if (!existsSync(path)) {
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      db = null;
      dbPathOpened = "";
      dbMtimeMs = 0;
    }
    return null;
  }
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    /* ignore */
  }
  if (db && dbPathOpened === path && mtimeMs === dbMtimeMs) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  // Indexes + WAL checkpoint need a short RW open (readonly container volume is host-writable).
  ensureServicerepPerfIndexes(path);
  db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  // Low-RAM VPS (~1GB): keep cache modest; full-table scans thrash badly without indexes.
  try {
    db.pragma("cache_size = -32768"); // ~32MB
    db.pragma("temp_store = MEMORY");
    db.pragma("mmap_size = 33554432"); // 32MB
  } catch {
    /* ignore */
  }
  dbPathOpened = path;
  dbMtimeMs = mtimeMs;
  statusCache = null;
  return db;
}

let indexesEnsuredFor = "";

/** Create chronicle indexes once — without them doc/xref lookups scan 1GB HTML table. */
function ensureServicerepPerfIndexes(path: string): void {
  if (indexesEnsuredFor === path) return;
  try {
    const w = new Database(path);
    try {
      w.pragma("journal_mode = WAL");
      w.exec(`
        CREATE INDEX IF NOT EXISTS idx_doc_chronicle ON documents(chronicle_id);
        CREATE INDEX IF NOT EXISTS idx_tree_chronicle ON tree_items(chronicle_id);
        CREATE INDEX IF NOT EXISTS idx_tree_vcc ON tree_items(vcc_number);
      `);
      try {
        w.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        /* ignore */
      }
      indexesEnsuredFor = path;
    } finally {
      w.close();
    }
  } catch {
    // Readonly filesystem / locked DB — keep serving without indexes.
    indexesEnsuredFor = path;
  }
}

function metaMap(d: Database.Database): Map<string, string> {
  try {
    const rows = d.prepare(`SELECT key, value FROM meta`).all() as Array<{ key: string; value: string }>;
    return new Map(rows.map((r) => [r.key, r.value]));
  } catch {
    return new Map();
  }
}

/** Fast status for nav + Service page. Never COUNT(*) on documents (1GB HTML thrash). */
export function getServiceStatus(): ServiceStatus {
  const path = servicerepDbPath();
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS && statusCache.value.path === path) {
    return statusCache.value;
  }
  if (!existsSync(path)) {
    const miss = { available: false, path, docCount: 0, htmlCount: 0, treeCount: 0 };
    statusCache = { at: now, value: miss };
    return miss;
  }
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    size = 0;
  }
  if (size < 10_000) {
    const miss = { available: false, path, docCount: 0, htmlCount: 0, treeCount: 0 };
    statusCache = { at: now, value: miss };
    return miss;
  }

  const d = openServicerepDb();
  if (!d) {
    const miss = { available: false, path, docCount: 0, htmlCount: 0, treeCount: 0 };
    statusCache = { at: now, value: miss };
    return miss;
  }
  const meta = metaMap(d);
  const docCount = Number(meta.get("doc_count") || meta.get("html_extracted") || 0);
  const htmlCount = Number(meta.get("html_extracted") || docCount || 0);
  let treeCount = Number(meta.get("tree_count") || 0);
  if (!treeCount) {
    try {
      // tree_items rows are small; COUNT here is cheap vs documents.html
      treeCount = Number(d.prepare(`SELECT COUNT(*) AS n FROM tree_items`).get()?.n || 0);
    } catch {
      treeCount = 0;
    }
  }
  const value: ServiceStatus = {
    available: true,
    path,
    docCount: docCount || 1,
    htmlCount: htmlCount || docCount || 1,
    treeCount,
  };
  statusCache = { at: now, value };
  return value;
}

function profileIdsForModel(d: Database.Database, model: string): string[] | null {
  const m = String(model || "").trim().toUpperCase();
  if (!m) return null;
  const rows = d
    .prepare(`SELECT DISTINCT profile_id AS p FROM profile_vehicle WHERE UPPER(model)=?`)
    .all(m) as Array<{ p: string }>;
  // Empty array = model requested but uncovered (hard empty). null = no model filter.
  return rows.map((r) => r.p);
}

/** Models present in profile_vehicle (for filters UI). */
export function listServiceCoveredModels(): string[] {
  const d = openServicerepDb();
  if (!d) return [];
  try {
    return (
      d.prepare(`SELECT DISTINCT model AS m FROM profile_vehicle ORDER BY model`).all() as Array<{ m: string }>
    ).map((r) => r.m);
  } catch {
    return [];
  }
}

/** Year ranges found in profile_vehicle for a model (may be empty). */
export function listServiceProfileYears(model: string): number[] {
  const d = openServicerepDb();
  if (!d) return [];
  const m = String(model || "").trim().toUpperCase();
  if (!m) return [];
  try {
    const rows = d
      .prepare(
        `
        SELECT year_from AS yf, year_to AS yt
        FROM profile_vehicle
        WHERE UPPER(model)=? AND (year_from IS NOT NULL OR year_to IS NOT NULL)
      `,
      )
      .all(m) as Array<{ yf: number | null; yt: number | null }>;
    const set = new Set<number>();
    for (const r of rows) {
      const a = r.yf ?? r.yt;
      const b = r.yt ?? r.yf;
      if (a == null || b == null) continue;
      for (let y = a; y <= b; y++) set.add(y);
    }
    return [...set].sort((x, y) => x - y);
  } catch {
    return [];
  }
}

function resolveVehicleFilter(
  d: Database.Database,
  model: string,
  year: string,
): { profileFilter: string[] | null; filterStatus: ServiceFilterStatus; profileCount: number } {
  if (!model) {
    return { profileFilter: null, filterStatus: "none", profileCount: 0 };
  }
  let profileFilter = profileIdsForModel(d, model);
  if (!profileFilter.length) {
    return { profileFilter: [], filterStatus: "no_profiles", profileCount: 0 };
  }
  profileFilter = narrowProfilesByYear(d, profileFilter, model, year) || profileFilter;
  return {
    profileFilter,
    filterStatus: "applied",
    profileCount: profileFilter.length,
  };
}

function titleKey(title: string): string {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Drop TOC leaves whose titles clearly belong to another vehicle/era. */
function filterLeavesForVehicle(
  leaves: Array<{ id: number; title: string; doc_count: number }>,
  model: string,
  year: string,
): Array<{ id: number; title: string; doc_count: number }> {
  if (!model) return leaves;
  return leaves.filter(
    (leaf) => !titleIncompatibleWithVehicle(repairServiceTitle(leaf.title), model, year),
  );
}

/** Collapse same-title leaves into one item-group (preferred = most docs). */
function dedupeLeaves(
  leaves: Array<{ id: number; title: string; doc_count: number }>,
): ServiceTreeNode[] {
  const groups = new Map<string, Array<{ id: number; title: string; doc_count: number }>>();
  for (const leaf of leaves) {
    const title = repairServiceTitle(leaf.title);
    const key = titleKey(title);
    const normalized = { ...leaf, title };
    const list = groups.get(key);
    if (list) list.push(normalized);
    else groups.set(key, [normalized]);
  }
  const out: ServiceTreeNode[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.doc_count - a.doc_count || a.id - b.id);
    const best = list[0]!;
    if (list.length === 1) {
      out.push({
        id: `item:${best.id}`,
        kind: "item",
        treeItemId: best.id,
        title: best.title,
        docCount: best.doc_count,
      });
      continue;
    }
    out.push({
      id: `group:${best.id}`,
      kind: "item-group",
      treeItemId: best.id,
      title: best.title,
      docCount: best.doc_count,
      variantCount: list.length,
      variants: list.map((v) => ({ treeItemId: v.id, docCount: v.doc_count })),
    });
  }
  return out;
}

function yearOk(yearFrom: number | null, yearTo: number | null, year: string): boolean {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1980) return true;
  if (yearFrom != null && y < yearFrom) return false;
  if (yearTo != null && y > yearTo) return false;
  return true;
}

/** P3 / late models in the UI — drop classic 850-era stubs for these. */
const MODERN_SERVICE_MODELS = new Set(["XC60", "XC70", "V70", "S80", "S60", "V60"]);

const SERVICE_MODEL_IN_TITLE_RE = /\b(XC90|XC70|XC60|V70|V60|V50|S80|S70|S60|S40|C70|C30)\b/gi;

/**
 * True when the document title clearly belongs to another vehicle / era
 * than the selected model+year (VIDA corpus mixes generations).
 */
export function titleIncompatibleWithVehicle(title: string, model: string, year: string): boolean {
  const t = String(title || "").trim();
  const m = String(model || "").trim().toUpperCase();
  if (!t || !m) return false;
  const y = Number(year);
  const modern = (Number.isFinite(y) && y >= 2007) || MODERN_SERVICE_MODELS.has(m);
  const isRhs850 = /\bRHS\s*850\b/i.test(t);

  // Classic Volvo 850 car articles (not the RHS 850 A/C reclaim machine).
  if (modern && !isRhs850) {
    if (/,\s*850\b/.test(t)) return true;
    if (/\b850\/S70\b/.test(t)) return true;
    if (/\bVolvo\s*850\b/i.test(t)) return true;
    if (/\b850\s+модели\b/i.test(t)) return true;
    if (/\bSIPS\s*\(\s*850\s*\)/i.test(t)) return true;
    if (/\b850\b/.test(t) && /\b(199[0-9]|2000|2001|2002)\b/.test(t)) return true;
    // Bare 850 in part/engine titles: «Подрамник 850», «B5254T 850»
    if (/\b850\b/.test(t)) return true;
  }

  // Classic 940 / 960 for modern selections (titles like «960/940, 4-дверная»).
  if (modern && /\b9[46]0\b/.test(t)) return true;

  // Pre-P3 V70 / S70 generation mixed titles when a late V70/XC70/S60 is selected.
  if (modern && Number.isFinite(y) && y >= 2008 && (m === "V70" || m === "XC70" || m === "S60")) {
    if (/\bC70\/S70\/V70\b/i.test(t)) return true;
    if (/\bS70\/V70\b/i.test(t)) return true;
    if (/\bV70\s*R\b/i.test(t)) return true;
    if (/\bS70\/V70\s*R\b/i.test(t)) return true;
  }

  // S70-only titles when S70 is not the selected model.
  if (modern && m !== "S70" && /\bS70\b/i.test(t) && !new RegExp(`\\b${m}\\b`, "i").test(t)) {
    return true;
  }

  const mentioned = new Set(
    [...t.matchAll(SERVICE_MODEL_IN_TITLE_RE)].map((x) => String(x[1] || "").toUpperCase()),
  );
  if (mentioned.size > 0 && !mentioned.has(m)) return true;

  if (Number.isFinite(y) && y >= 2008) {
    const yearsInTitle = [...t.matchAll(/\b((?:19|20)\d{2})\b/g)].map((x) => Number(x[1]));
    if (
      yearsInTitle.length &&
      yearsInTitle.every((ty) => ty <= 2002) &&
      Math.min(...yearsInTitle.map((ty) => y - ty)) >= 6
    ) {
      return true;
    }
  }
  return false;
}

function narrowProfilesByYear(
  d: Database.Database,
  profileFilter: string[] | null,
  model: string,
  year: string,
): string[] | null {
  if (!profileFilter || !year || !model) return profileFilter;
  const datedOk: string[] = [];
  const undated: string[] = [];
  for (const pid of profileFilter) {
    const row = d
      .prepare(
        `SELECT year_from AS yf, year_to AS yt FROM profile_vehicle WHERE profile_id=? AND UPPER(model)=? LIMIT 1`,
      )
      .get(pid, model.toUpperCase()) as { yf: number | null; yt: number | null } | undefined;
    if (!row) {
      undated.push(pid);
      continue;
    }
    const hasYears = row.yf != null || row.yt != null;
    if (!hasYears) {
      undated.push(pid);
      continue;
    }
    if (yearOk(row.yf, row.yt, year)) datedOk.push(pid);
  }
  // When year matches dated profiles, do not dilute with undated (main leak path).
  if (datedOk.length) return datedOk;
  return undated.length ? undated : profileFilter;
}

function treeProfileClause(
  profileFilter: string[] | null,
  alias = "ti",
): { sql: string; params: unknown[] } {
  // null → no vehicle filter; [] → force empty (model uncovered)
  if (profileFilter === null) return { sql: "", params: [] };
  if (!profileFilter.length) {
    return { sql: ` AND 1=0 `, params: [] };
  }
  const ph = profileFilter.map(() => "?").join(",");
  // All tree_items currently have profiles. IN-subquery uses idx on profile_id
  // (much cheaper than per-row EXISTS over 1M+ tip rows on low-RAM hosts).
  return {
    sql: `
      AND ${alias}.id IN (
        SELECT DISTINCT tp.tree_item_id
        FROM tree_item_profiles tp
        WHERE tp.profile_id IN (${ph})
      )
    `,
    params: [...profileFilter],
  };
}

function loadFgTitles(d: Database.Database): Map<string, string> {
  return new Map(
    (d.prepare(`SELECT code, title FROM function_groups`).all() as Array<{ code: string; title: string }>).map(
      (r) => [r.code, r.title] as const,
    ),
  );
}

function fgTitleOf(fgTitles: Map<string, string>, code: string): string {
  const last = code.includes("/") ? code.split("/").pop() || code : code;
  return repairServiceTitle(fgTitles.get(code) || fgTitles.get(last) || code);
}

const SYSTEMS_FG1 = ["2", "3", "4", "5", "6", "7", "8"] as const;

function parseParent(parent: string): { fg1: string; fg2?: string; fg3?: string } | null {
  const parts = String(parent || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  if (!SYSTEMS_FG1.includes(parts[0] as (typeof SYSTEMS_FG1)[number])) return null;
  if (parts.length === 1) return { fg1: parts[0] };
  if (parts.length === 2) return { fg1: parts[0], fg2: parts[1] };
  return { fg1: parts[0], fg2: parts[1], fg3: parts[2] };
}

function listTreeRoots(
  d: Database.Database,
  profileFilter: string[] | null,
  fgTitles: Map<string, string>,
): ServiceTreeNode[] {
  const { sql: profSql, params: profParams } = treeProfileClause(profileFilter);
  const rows = d
    .prepare(
      `
      SELECT ti.fg1 AS code, COUNT(*) AS n
      FROM tree_items ti
      WHERE IFNULL(ti.title,'') != ''
        AND ti.fg1 IN ('2','3','4','5','6','7','8')
        AND IFNULL(ti.is_servinfo,1) = 1
        ${profSql}
      GROUP BY ti.fg1
      ORDER BY ti.fg1
    `,
    )
    .all(...profParams) as Array<{ code: string; n: number }>;

  return rows.map((r) => ({
    id: `fg:${r.code}`,
    kind: "fg" as const,
    code: r.code,
    title: fgTitleOf(fgTitles, r.code),
    hasChildren: r.n > 0,
    childCount: r.n,
    children: [],
  }));
}

function listTreeChildren(
  d: Database.Database,
  parent: string,
  profileFilter: string[] | null,
  fgTitles: Map<string, string>,
  limit: number,
  model = "",
  year = "",
): ServiceTreeNode[] {
  const parsed = parseParent(parent);
  if (!parsed) return [];
  const { sql: profSql, params: profParams } = treeProfileClause(profileFilter);
  const out: ServiceTreeNode[] = [];
  const pushLeaves = (leaves: Array<{ id: number; title: string; doc_count: number }>) => {
    out.push(...dedupeLeaves(filterLeavesForVehicle(leaves, model, year)));
  };

  if (!parsed.fg2) {
    // Children of fg1: distinct fg2 folders + leaf items with no fg2
    const folders = d
      .prepare(
        `
        SELECT ti.fg2 AS code, COUNT(*) AS n
        FROM tree_items ti
        WHERE IFNULL(ti.title,'') != ''
          AND ti.fg1 = ?
          AND IFNULL(ti.fg2,'') != ''
          AND IFNULL(ti.is_servinfo,1) = 1
          ${profSql}
        GROUP BY ti.fg2
        ORDER BY ti.fg2
      `,
      )
      .all(parsed.fg1, ...profParams) as Array<{ code: string; n: number }>;

    for (const f of folders) {
      const code = `${parsed.fg1}/${f.code}`;
      out.push({
        id: `fg:${code}`,
        kind: "fg",
        code,
        title: fgTitleOf(fgTitles, code) || fgTitleOf(fgTitles, f.code),
        hasChildren: true,
        childCount: f.n,
        children: [],
      });
    }

    const leaves = d
      .prepare(
        `
        SELECT ti.id, ti.title,
          (SELECT COUNT(*) FROM tree_item_docs td WHERE td.tree_item_id=ti.id) AS doc_count
        FROM tree_items ti
        WHERE IFNULL(ti.title,'') != ''
          AND ti.fg1 = ?
          AND IFNULL(ti.fg2,'') = ''
          AND IFNULL(ti.is_servinfo,1) = 1
          ${profSql}
        ORDER BY ti.title
        LIMIT ?
      `,
      )
      .all(parsed.fg1, ...profParams, limit) as Array<{ id: number; title: string; doc_count: number }>;

    pushLeaves(leaves);
    return out;
  }

  if (!parsed.fg3) {
    const folders = d
      .prepare(
        `
        SELECT ti.fg3 AS code, COUNT(*) AS n
        FROM tree_items ti
        WHERE IFNULL(ti.title,'') != ''
          AND ti.fg1 = ? AND ti.fg2 = ?
          AND IFNULL(ti.fg3,'') != ''
          AND IFNULL(ti.is_servinfo,1) = 1
          ${profSql}
        GROUP BY ti.fg3
        ORDER BY ti.fg3
      `,
      )
      .all(parsed.fg1, parsed.fg2, ...profParams) as Array<{ code: string; n: number }>;

    for (const f of folders) {
      const code = `${parsed.fg1}/${parsed.fg2}/${f.code}`;
      out.push({
        id: `fg:${code}`,
        kind: "fg",
        code,
        title: fgTitleOf(fgTitles, code) || fgTitleOf(fgTitles, f.code),
        hasChildren: true,
        childCount: f.n,
        children: [],
      });
    }

    const leaves = d
      .prepare(
        `
        SELECT ti.id, ti.title,
          (SELECT COUNT(*) FROM tree_item_docs td WHERE td.tree_item_id=ti.id) AS doc_count
        FROM tree_items ti
        WHERE IFNULL(ti.title,'') != ''
          AND ti.fg1 = ? AND ti.fg2 = ?
          AND IFNULL(ti.fg3,'') = ''
          AND IFNULL(ti.is_servinfo,1) = 1
          ${profSql}
        ORDER BY
          CASE WHEN ti.title LIKE '%снят%' OR ti.title LIKE '%Снят%'
            OR ti.title LIKE '%замен%' OR ti.title LIKE '%Замен%'
            OR ti.title LIKE '%установ%' OR ti.title LIKE '%Установ%' THEN 0 ELSE 1 END,
          ti.title
        LIMIT ?
      `,
      )
      .all(parsed.fg1, parsed.fg2, ...profParams, limit) as Array<{
      id: number;
      title: string;
      doc_count: number;
    }>;

    pushLeaves(leaves);
    return out;
  }

  // Leaf level under fg3
  const leaves = d
    .prepare(
      `
      SELECT ti.id, ti.title,
        (SELECT COUNT(*) FROM tree_item_docs td WHERE td.tree_item_id=ti.id) AS doc_count
      FROM tree_items ti
      WHERE IFNULL(ti.title,'') != ''
        AND ti.fg1 = ? AND ti.fg2 = ? AND ti.fg3 = ?
        AND IFNULL(ti.is_servinfo,1) = 1
        ${profSql}
      ORDER BY
        CASE WHEN ti.title LIKE '%снят%' OR ti.title LIKE '%Снят%'
          OR ti.title LIKE '%замен%' OR ti.title LIKE '%Замен%'
          OR ti.title LIKE '%установ%' OR ti.title LIKE '%Установ%' THEN 0 ELSE 1 END,
        ti.title
      LIMIT ?
    `,
    )
    .all(parsed.fg1, parsed.fg2, parsed.fg3, ...profParams, limit) as Array<{
    id: number;
    title: string;
    doc_count: number;
  }>;

  return dedupeLeaves(filterLeavesForVehicle(leaves, model, year));
}

/** Vehicle filter + title dedupe. Without parent → roots; with parent → lazy children; with q → search tree. */
export function listServiceTree(opts: {
  model?: string;
  year?: string;
  q?: string;
  parent?: string;
  limit?: number;
}): ServiceTreeResult {
  const empty = (status: ServiceFilterStatus, model: string, year: string): ServiceTreeResult => ({
    tree: [],
    filterStatus: status,
    profileCount: 0,
    model: model || null,
    year: year || null,
  });

  const d = openServicerepDb();
  if (!d) return empty("none", "", "");
  const model = String(opts.model || "").trim();
  const year = String(opts.year || "").trim();
  const q = String(opts.q || "").trim();
  const parent = String(opts.parent || "").trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 2500, 1), 8000);
  const fgTitles = loadFgTitles(d);

  const resolved = resolveVehicleFilter(d, model, year);
  const { profileFilter, filterStatus, profileCount } = resolved;

  if (filterStatus === "no_profiles") {
    return empty("no_profiles", model, year);
  }

  const wrap = (tree: ServiceTreeNode[]): ServiceTreeResult => ({
    tree,
    filterStatus,
    profileCount,
    model: model || null,
    year: year || null,
  });

  if (!q && !parent) {
    return wrap(listTreeRoots(d, profileFilter, fgTitles));
  }

  if (!q && parent) {
    return wrap(listTreeChildren(d, parent, profileFilter, fgTitles, limit, model, year));
  }

  // Search mode: return nested tree of matching items (capped, balanced by fg1)
  const params: unknown[] = [];
  const { sql: profSql, params: profParams } = treeProfileClause(profileFilter);
  params.push(`%${q}%`, ...profParams);

  const rows = d
    .prepare(
      `
      SELECT id, fg1, fg2, fg3, title, toc_level, doc_count FROM (
        SELECT ti.id, ti.fg1, ti.fg2, ti.fg3, ti.title, ti.toc_level,
          (SELECT COUNT(*) FROM tree_item_docs td WHERE td.tree_item_id=ti.id) AS doc_count,
          ROW_NUMBER() OVER (
            PARTITION BY ti.fg1
            ORDER BY ti.fg2, ti.fg3, ti.title
          ) AS rn
        FROM tree_items ti
        WHERE IFNULL(ti.title,'') != ''
          AND ti.fg1 IN ('2','3','4','5','6','7','8')
          AND IFNULL(ti.is_servinfo,1) = 1
          AND ti.title LIKE ?
          ${profSql}
      ) ranked
      WHERE rn <= 200
      ORDER BY fg1, fg2, fg3, title
      LIMIT ?
    `,
    )
    .all(...params, limit) as Array<{
    id: number;
    fg1: string | null;
    fg2: string | null;
    fg3: string | null;
    title: string;
    toc_level: number;
    doc_count: number;
  }>;

  const treeRows = model
    ? rows.filter((r) => !titleIncompatibleWithVehicle(repairServiceTitle(r.title), model, year))
    : rows;

  type FgMap = Map<string, ServiceTreeNode>;
  const root: FgMap = new Map();
  const top: ServiceTreeNode[] = [];

  const ensureFg = (map: FgMap, code: string, parentChildren: ServiceTreeNode[]): ServiceTreeNode => {
    let node = map.get(code);
    if (!node) {
      node = {
        id: `fg:${code}`,
        kind: "fg",
        code,
        title: fgTitleOf(fgTitles, code),
        children: [],
        hasChildren: true,
      };
      map.set(code, node);
      parentChildren.push(node);
    }
    return node;
  };

  for (const r of treeRows) {
    const fg1 = r.fg1 || "0";
    const n1 = ensureFg(root, fg1, top);
    n1.children = n1.children || [];
    let parentNode = n1;
    if (r.fg2) {
      const map2 = (n1 as ServiceTreeNode & { _m?: FgMap })._m || new Map();
      (n1 as ServiceTreeNode & { _m?: FgMap })._m = map2;
      parentNode = ensureFg(map2, `${fg1}/${r.fg2}`, n1.children);
      parentNode.children = parentNode.children || [];
      if (r.fg3) {
        const map3 = (parentNode as ServiceTreeNode & { _m?: FgMap })._m || new Map();
        (parentNode as ServiceTreeNode & { _m?: FgMap })._m = map3;
        parentNode = ensureFg(map3, `${fg1}/${r.fg2}/${r.fg3}`, parentNode.children);
        parentNode.children = parentNode.children || [];
      }
    }
    parentNode.children!.push({
      id: `item:${r.id}`,
      kind: "item",
      treeItemId: r.id,
      title: r.title,
      docCount: r.doc_count,
    });
  }

  const dedupeNodeChildren = (nodes: ServiceTreeNode[]): ServiceTreeNode[] =>
    nodes.map((n) => {
      const { _m, ...rest } = n as ServiceTreeNode & { _m?: FgMap };
      void _m;
      const kids = rest.children?.length ? dedupeNodeChildren(rest.children) : undefined;
      if (!kids?.length) return { ...rest, children: undefined };
      const folders = kids.filter((k) => k.kind === "fg");
      const leaves = kids
        .filter((k) => k.kind === "item" || k.kind === "item-group")
        .map((k) => ({
          id: k.treeItemId || 0,
          title: k.title,
          doc_count: k.docCount || 0,
        }))
        .filter((k) => k.id);
      return { ...rest, children: [...folders, ...dedupeLeaves(leaves)] };
    });

  return wrap(dedupeNodeChildren(top));
}

export function searchServiceDocs(opts: {
  q: string;
  model?: string;
  year?: string;
  limit?: number;
}): ServiceSearchHit[] {
  const d = openServicerepDb();
  if (!d) return [];
  const q = String(opts.q || "").trim();
  if (q.length < 2) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 100);
  const model = String(opts.model || "").trim();
  const year = String(opts.year || "").trim();
  const { profileFilter, filterStatus } = resolveVehicleFilter(d, model, year);
  if (filterStatus === "no_profiles") return [];

  let rows: Array<{ id: number; title: string; has_html: number; qualifier_id: number | null }> = [];
  try {
    const ftsQ = q
      .replace(/["']/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t}"*`)
      .join(" ");
    rows = d
      .prepare(
        `
        SELECT d.id, d.title, d.has_html, d.qualifier_id
        FROM documents_fts f
        JOIN documents d ON d.id = f.rowid
        WHERE documents_fts MATCH ?
        ORDER BY d.has_html DESC, d.title
        LIMIT ?
      `,
      )
      .all(ftsQ, limit * 4) as typeof rows;
  } catch {
    rows = d
      .prepare(
        `
        SELECT id, title, has_html, qualifier_id FROM documents
        WHERE title LIKE ? OR plain_text LIKE ?
        ORDER BY has_html DESC, title
        LIMIT ?
      `,
      )
      .all(`%${q}%`, `%${q}%`, limit * 4) as typeof rows;
  }

  if (profileFilter && profileFilter.length) {
    const ph = profileFilter.map(() => "?").join(",");
    const allowStmt = d.prepare(
      `SELECT 1 AS ok FROM document_profiles WHERE document_id=? AND profile_id IN (${ph}) LIMIT 1`,
    );
    rows = rows.filter((r) => {
      if (!allowStmt.get(r.id, ...profileFilter!)) return false;
      if (titleIncompatibleWithVehicle(repairServiceTitle(r.title), model, year)) return false;
      return true;
    });
  } else if (model) {
    rows = rows.filter(
      (r) => !titleIncompatibleWithVehicle(repairServiceTitle(r.title), model, year),
    );
  }

  return rows
    .map((r) => ({
      id: r.id,
      title: repairServiceTitle(r.title),
      hasHtml: Boolean(r.has_html),
      qualifierId: r.qualifier_id,
      _rank: preferRuDocRank(repairServiceTitle(r.title)),
    }))
    .sort((a, b) => {
      if (Number(b.hasHtml) !== Number(a.hasHtml)) return Number(b.hasHtml) - Number(a.hasHtml);
      if (a._rank !== b._rank) return a._rank - b._rank;
      return a.title.localeCompare(b.title, "ru");
    })
    .slice(0, limit)
    .map(({ _rank: _r, ...hit }) => hit);
}

function documentAllowedForVehicle(
  d: Database.Database,
  documentId: number,
  title: string,
  model: string,
  year: string,
): boolean {
  if (!model) return true;
  if (titleIncompatibleWithVehicle(title, model, year)) return false;
  const { profileFilter, filterStatus } = resolveVehicleFilter(d, model, year);
  if (filterStatus === "no_profiles") return false;
  if (!profileFilter || !profileFilter.length) return true;
  const ph = profileFilter.map(() => "?").join(",");
  const ok = d
    .prepare(
      `SELECT 1 AS ok FROM document_profiles WHERE document_id=? AND profile_id IN (${ph}) LIMIT 1`,
    )
    .get(documentId, ...profileFilter);
  return Boolean(ok);
}

export function getServiceDoc(
  id: number,
  opts?: { model?: string; year?: string },
): ServiceDoc | null {
  const d = openServicerepDb();
  if (!d || !Number.isFinite(id)) return null;
  const row = d
    .prepare(
      `
      SELECT id, title, html, has_html AS hasHtml, path, condition_type AS conditionType
      FROM documents WHERE id=?
    `,
    )
    .get(id) as
    | {
        id: number;
        title: string;
        html: string | null;
        hasHtml: number;
        path: string | null;
        conditionType: string | null;
      }
    | undefined;
  if (!row) return null;
  let rawHtml = rewriteServiceHtmlImages(repairServiceHtml(row.html));
  let title = repairServiceTitle(row.title);
  const model = String(opts?.model || "").trim();
  const year = String(opts?.year || "").trim();
  const torqueRewrite = rewriteTorqueinfoHtml(rawHtml, "ru");
  if (torqueRewrite.html && torqueRewrite.html !== rawHtml) {
    rawHtml = torqueRewrite.html;
    if ((!title || !title.trim()) && torqueRewrite.title) title = torqueRewrite.title;
  } else {
    const tip = extractTorqueinfoFromHtml(row.html);
    if (tip && (!title || !title.trim())) title = torqueinfoDisplayTitle(tip);
  }
  if (model && !documentAllowedForVehicle(d, row.id, title || repairServiceTitle(row.title), model, year)) {
    return null;
  }
  const chronIds = [
    ...new Set(
      [...(rawHtml || "").matchAll(/\bdata-sr-chronicle="([0-9a-f]{16})"/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ];
  const titleByChron = new Map<string, string>();
  if (chronIds.length) {
    const placeholders = chronIds.map(() => "?").join(",");
    const rows = d
      .prepare(
        `SELECT chronicle_id AS chron, title, html FROM documents WHERE chronicle_id IN (${placeholders})`,
      )
      .all(...chronIds) as Array<{ chron: string; title: string; html: string | null }>;
    for (const r of rows) {
      if (!r.chron) continue;
      let t = repairServiceTitle(r.title).trim();
      if (!t) {
        const tip = extractTorqueinfoFromHtml(r.html);
        if (tip) t = torqueinfoDisplayTitle(tip);
      }
      if (t) titleByChron.set(String(r.chron).toLowerCase(), t);
    }
  }
  return {
    id: row.id,
    title: title || repairServiceTitle(row.title),
    html: markServiceWideTables(rewriteServiceHtmlXrefLabels(rawHtml, titleByChron)),
    hasHtml: Boolean(row.hasHtml),
    path: row.path,
    conditionType: row.conditionType,
  };
}

export function listDocsForTreeItem(
  treeItemId: number,
  opts?: { model?: string; year?: string },
): ServiceSearchHit[] {
  const d = openServicerepDb();
  if (!d) return [];
  const model = String(opts?.model || "").trim();
  const year = String(opts?.year || "").trim();
  const { profileFilter } = resolveVehicleFilter(d, model, year);
  const rows = d
    .prepare(
      `
      SELECT d.id, d.title, d.has_html AS hasHtml, d.qualifier_id AS qualifierId, d.html
      FROM tree_item_docs td
      JOIN documents d ON d.project_document_id = td.project_document_id
      WHERE td.tree_item_id = ?
      ORDER BY d.has_html DESC, d.title
      LIMIT 80
    `,
    )
    .all(treeItemId) as Array<{
    id: number;
    title: string;
    hasHtml: number;
    qualifierId: number | null;
    html: string | null;
  }>;

  let allowStmt: Database.Statement | null = null;
  if (profileFilter && profileFilter.length) {
    const ph = profileFilter.map(() => "?").join(",");
    allowStmt = d.prepare(
      `SELECT 1 AS ok FROM document_profiles WHERE document_id=? AND profile_id IN (${ph}) LIMIT 1`,
    );
  }

  return rows
    .map((r) => {
      let title = repairServiceTitle(r.title).trim();
      if (!title) {
        const tip = extractTorqueinfoFromHtml(r.html);
        if (tip) title = torqueinfoDisplayTitle(tip);
      }
      const finalTitle = title || repairServiceTitle(r.title);
      return {
        id: r.id,
        title: finalTitle,
        hasHtml: Boolean(r.hasHtml),
        qualifierId: r.qualifierId,
        _rank: preferRuDocRank(finalTitle, r.html),
        _html: r.html,
      };
    })
    .filter((r) => {
      if (model && titleIncompatibleWithVehicle(r.title, model, year)) return false;
      if (allowStmt && profileFilter?.length) {
        if (!allowStmt.get(r.id, ...profileFilter)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (Number(b.hasHtml) !== Number(a.hasHtml)) return Number(b.hasHtml) - Number(a.hasHtml);
      if (a._rank !== b._rank) return a._rank - b._rank;
      return a.title.localeCompare(b.title, "ru");
    })
    .map(({ _rank: _r, _html: _h, ...hit }) => hit);
}

/** Resolve VIDA cross-ref like ru-RU0900c8af8085f972#KC07142606 → document. */
export function resolveServiceRef(ref: string, labelHint = ""): ServiceSearchHit | null {
  const d = openServicerepDb();
  if (!d) return null;
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const body = raw.split("#", 1)[0];
  const m = body.match(/^(?:[a-z]{2}-[A-Z]{2})?([0-9a-f]{16})$/i);
  const chron = (m?.[1] || body).toLowerCase();
  if (/^[0-9a-f]{16}$/.test(chron)) {
    const row = d
      .prepare(
        `
        SELECT id, title, has_html AS hasHtml, qualifier_id AS qualifierId
        FROM documents WHERE chronicle_id=? LIMIT 1
      `,
      )
      .get(chron) as
      | { id: number; title: string; hasHtml: number; qualifierId: number | null }
      | undefined;
    if (row) {
      let title = repairServiceTitle(row.title).trim();
      if (!title) {
        const htmlRow = d.prepare(`SELECT html FROM documents WHERE id=?`).get(row.id) as
          | { html: string | null }
          | undefined;
        const tip = extractTorqueinfoFromHtml(htmlRow?.html);
        if (tip) title = torqueinfoDisplayTitle(tip);
      }
      return {
        id: row.id,
        title: title || repairServiceTitle(row.title) || labelHint,
        hasHtml: Boolean(row.hasHtml),
        qualifierId: row.qualifierId,
      };
    }
    // Tree may know chronicle → project_document_id even when documents.chronicle_id differs
    const viaTree = d
      .prepare(
        `
        SELECT d.id, d.title, d.has_html AS hasHtml, d.qualifier_id AS qualifierId
        FROM tree_items t
        JOIN documents d ON d.project_document_id = t.project_document_id
        WHERE t.chronicle_id=?
        ORDER BY d.has_html DESC
        LIMIT 1
      `,
      )
      .get(chron) as
      | { id: number; title: string; hasHtml: number; qualifierId: number | null }
      | undefined;
    if (viaTree) {
      let title = repairServiceTitle(viaTree.title).trim();
      if (!title) {
        const htmlRow = d.prepare(`SELECT html FROM documents WHERE id=?`).get(viaTree.id) as
          | { html: string | null }
          | undefined;
        const tip = extractTorqueinfoFromHtml(htmlRow?.html);
        if (tip) title = torqueinfoDisplayTitle(tip);
      }
      return {
        id: viaTree.id,
        title: title || repairServiceTitle(viaTree.title) || labelHint,
        hasHtml: Boolean(viaTree.hasHtml),
        qualifierId: viaTree.qualifierId,
      };
    }
  }

  // Fallback: VCC-######-# from label or ref text
  const hint = `${labelHint} ${raw}`;
  const vcc = hint.match(/\b(VCC-\d+(?:-\d+)?)\b/i)?.[1];
  if (vcc) {
    const byVcc = d
      .prepare(
        `
        SELECT id, title, has_html AS hasHtml, qualifier_id AS qualifierId
        FROM documents
        WHERE title LIKE ? OR title LIKE ?
        ORDER BY has_html DESC, length(title) ASC
        LIMIT 1
      `,
      )
      .get(`%${vcc}%`, `%${vcc.replace(/^VCC-/i, "")}%`) as
      | { id: number; title: string; hasHtml: number; qualifierId: number | null }
      | undefined;
    if (byVcc) {
      return {
        id: byVcc.id,
        title: repairServiceTitle(byVcc.title),
        hasHtml: Boolean(byVcc.hasHtml),
        qualifierId: byVcc.qualifierId,
      };
    }
    const treeVcc = d
      .prepare(
        `
        SELECT d.id, d.title, d.has_html AS hasHtml, d.qualifier_id AS qualifierId
        FROM tree_items t
        JOIN documents d ON d.project_document_id = t.project_document_id
        WHERE IFNULL(t.vcc_number,'') LIKE ? OR t.title LIKE ?
        ORDER BY d.has_html DESC
        LIMIT 1
      `,
      )
      .get(`%${vcc}%`, `%${vcc}%`) as
      | { id: number; title: string; hasHtml: number; qualifierId: number | null }
      | undefined;
    if (treeVcc) {
      return {
        id: treeVcc.id,
        title: repairServiceTitle(treeVcc.title),
        hasHtml: Boolean(treeVcc.hasHtml),
        qualifierId: treeVcc.qualifierId,
      };
    }
  }
  return null;
}
