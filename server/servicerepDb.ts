/**
 * Local-only service manual sqlite (data/servicerep.sqlite).
 * Missing file ⇒ feature off.
 */
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { rewriteServiceHtmlImages } from "./servicerepGraphics.js";

const ROOT = resolve(process.cwd());

export type ServiceStatus = {
  available: boolean;
  path: string;
  docCount: number;
  htmlCount: number;
  treeCount: number;
};

export type ServiceTreeNode = {
  id: string;
  kind: "fg" | "item";
  code?: string;
  title: string;
  treeItemId?: number;
  children?: ServiceTreeNode[];
  docCount?: number;
  /** Folder may have children not yet loaded (lazy tree). */
  hasChildren?: boolean;
  childCount?: number;
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
  db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  dbPathOpened = path;
  dbMtimeMs = mtimeMs;
  return db;
}

export function getServiceStatus(): ServiceStatus {
  const path = servicerepDbPath();
  const d = openServicerepDb();
  if (!d) {
    return { available: false, path, docCount: 0, htmlCount: 0, treeCount: 0 };
  }
  const docCount = Number(d.prepare(`SELECT COUNT(*) AS n FROM documents`).get()?.n || 0);
  const htmlCount = Number(
    d.prepare(`SELECT COUNT(*) AS n FROM documents WHERE has_html=1`).get()?.n || 0,
  );
  const treeCount = Number(d.prepare(`SELECT COUNT(*) AS n FROM tree_items`).get()?.n || 0);
  return { available: true, path, docCount, htmlCount, treeCount };
}

function profileIdsForModel(d: Database.Database, model: string): string[] | null {
  const m = String(model || "").trim().toUpperCase();
  if (!m) return null;
  const rows = d
    .prepare(`SELECT DISTINCT profile_id AS p FROM profile_vehicle WHERE UPPER(model)=?`)
    .all(m) as Array<{ p: string }>;
  if (!rows.length) return null;
  return rows.map((r) => r.p);
}

function yearOk(yearFrom: number | null, yearTo: number | null, year: string): boolean {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1980) return true;
  if (yearFrom != null && y < yearFrom) return false;
  if (yearTo != null && y > yearTo) return false;
  return true;
}

function narrowProfilesByYear(
  d: Database.Database,
  profileFilter: string[] | null,
  model: string,
  year: string,
): string[] | null {
  if (!profileFilter || !year || !model) return profileFilter;
  const narrowed: string[] = [];
  for (const pid of profileFilter) {
    const row = d
      .prepare(
        `SELECT year_from AS yf, year_to AS yt FROM profile_vehicle WHERE profile_id=? AND UPPER(model)=? LIMIT 1`,
      )
      .get(pid, model.toUpperCase()) as { yf: number | null; yt: number | null } | undefined;
    if (!row || yearOk(row.yf, row.yt, year)) narrowed.push(pid);
  }
  return narrowed.length ? narrowed : profileFilter;
}

function treeProfileClause(
  profileFilter: string[] | null,
  alias = "ti",
): { sql: string; params: unknown[] } {
  if (!profileFilter?.length) return { sql: "", params: [] };
  const ph = profileFilter.map(() => "?").join(",");
  return {
    sql: `
      AND (
        NOT EXISTS (SELECT 1 FROM tree_item_profiles tp WHERE tp.tree_item_id=${alias}.id)
        OR EXISTS (
          SELECT 1 FROM tree_item_profiles tp
          WHERE tp.tree_item_id=${alias}.id AND tp.profile_id IN (${ph})
        )
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
  return fgTitles.get(code) || fgTitles.get(last) || code;
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
): ServiceTreeNode[] {
  const parsed = parseParent(parent);
  if (!parsed) return [];
  const { sql: profSql, params: profParams } = treeProfileClause(profileFilter);
  const out: ServiceTreeNode[] = [];

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

    for (const r of leaves) {
      out.push({
        id: `item:${r.id}`,
        kind: "item",
        treeItemId: r.id,
        title: r.title,
        docCount: r.doc_count,
      });
    }
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

    for (const r of leaves) {
      out.push({
        id: `item:${r.id}`,
        kind: "item",
        treeItemId: r.id,
        title: r.title,
        docCount: r.doc_count,
      });
    }
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

  return leaves.map((r) => ({
    id: `item:${r.id}`,
    kind: "item" as const,
    treeItemId: r.id,
    title: r.title,
    docCount: r.doc_count,
  }));
}

/** Soft vehicle filter. Without parent → roots only; with parent → lazy children; with q → flat search tree. */
export function listServiceTree(opts: {
  model?: string;
  year?: string;
  q?: string;
  parent?: string;
  limit?: number;
}): ServiceTreeNode[] {
  const d = openServicerepDb();
  if (!d) return [];
  const model = String(opts.model || "").trim();
  const year = String(opts.year || "").trim();
  const q = String(opts.q || "").trim();
  const parent = String(opts.parent || "").trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 2500, 1), 8000);
  const fgTitles = loadFgTitles(d);

  let profileFilter = profileIdsForModel(d, model);
  profileFilter = narrowProfilesByYear(d, profileFilter, model, year);

  if (!q && !parent) {
    return listTreeRoots(d, profileFilter, fgTitles);
  }

  if (!q && parent) {
    return listTreeChildren(d, parent, profileFilter, fgTitles, limit);
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

  for (const r of rows) {
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

  const strip = (nodes: ServiceTreeNode[]): ServiceTreeNode[] =>
    nodes.map((n) => {
      const { _m, ...rest } = n as ServiceTreeNode & { _m?: FgMap };
      void _m;
      return {
        ...rest,
        children: rest.children?.length ? strip(rest.children) : undefined,
      };
    });

  return strip(top);
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
  let profileFilter = profileIdsForModel(d, model);
  profileFilter = narrowProfilesByYear(d, profileFilter, model, year);

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
    const bareStmt = d.prepare(
      `SELECT 1 AS ok FROM documents d WHERE d.id=? AND NOT EXISTS (SELECT 1 FROM document_profiles dp WHERE dp.document_id=d.id) LIMIT 1`,
    );
    rows = rows.filter((r) => {
      if (allowStmt.get(r.id, ...profileFilter!)) return true;
      if (bareStmt.get(r.id)) return true;
      return false;
    });
  }

  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    hasHtml: Boolean(r.has_html),
    qualifierId: r.qualifier_id,
  }));
}

export function getServiceDoc(id: number): ServiceDoc | null {
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
  return {
    id: row.id,
    title: row.title,
    html: rewriteServiceHtmlImages(row.html),
    hasHtml: Boolean(row.hasHtml),
    path: row.path,
    conditionType: row.conditionType,
  };
}

export function listDocsForTreeItem(treeItemId: number): ServiceSearchHit[] {
  const d = openServicerepDb();
  if (!d) return [];
  return (
    d
      .prepare(
        `
      SELECT d.id, d.title, d.has_html AS hasHtml, d.qualifier_id AS qualifierId
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
    }>
  ).map((r) => ({
    id: r.id,
    title: r.title,
    hasHtml: Boolean(r.hasHtml),
    qualifierId: r.qualifierId,
  }));
}

/** Resolve VIDA cross-ref like ru-RU0900c8af8085f972#KC07142606 → document. */
export function resolveServiceRef(ref: string): ServiceSearchHit | null {
  const d = openServicerepDb();
  if (!d) return null;
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const body = raw.split("#", 1)[0];
  const m = body.match(/^(?:[a-z]{2}-[A-Z]{2})?([0-9a-f]{16})$/i);
  const chron = (m?.[1] || body).toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(chron)) return null;
  const row = d
    .prepare(
      `
      SELECT id, title, has_html AS hasHtml, qualifier_id AS qualifierId
      FROM documents WHERE lower(chronicle_id)=? LIMIT 1
    `,
    )
    .get(chron) as
    | { id: number; title: string; hasHtml: number; qualifierId: number | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    hasHtml: Boolean(row.hasHtml),
    qualifierId: row.qualifierId,
  };
}
