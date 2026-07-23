import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let dtcDb: Database.Database | null = null;
let dtcPathTried = "";

export function resolveDtcDbPath(): string {
  return resolve(process.env.DTC_DATABASE_PATH ?? "data/dtc.sqlite");
}

/** Open read-only DTC dictionary (separate from wiring.sqlite). */
export function openDtcDatabase(): Database.Database | null {
  const path = resolveDtcDbPath();
  if (dtcDb && dtcPathTried === path) return dtcDb;
  dtcPathTried = path;
  if (!existsSync(path)) {
    dtcDb = null;
    return null;
  }
  try {
    dtcDb = new Database(path, { readonly: true, fileMustExist: true });
    dtcDb.pragma("query_only = ON");
    return dtcDb;
  } catch (e) {
    console.warn("[dtc] failed to open", path, e);
    dtcDb = null;
    return null;
  }
}

export type DtcCodeRow = {
  code: string;
  ecu: string;
  obd_code: string;
  title_ru: string;
  title_en: string;
  variants: number;
};

function sanitizeFtsQuery(raw: string): string {
  const tokens = String(raw || "")
    .trim()
    .replace(/["']/g, " ")
    .split(/[\s,;]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}/.\-_]+/gu, ""))
    .filter((t) => t.length >= 2);
  if (!tokens.length) return "";
  // Prefix match each token
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}

export function searchDtcCodes(query: string, limit = 40): DtcCodeRow[] {
  const db = openDtcDatabase();
  if (!db) return [];
  const q = String(query || "").trim();
  if (!q) return [];
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const fts = sanitizeFtsQuery(q);
  try {
    if (fts) {
      const rows = db
        .prepare(
          `
          SELECT c.code, c.ecu, c.obd_code, c.title_ru, c.title_en, c.variants
          FROM dtc_fts
          JOIN dtc_codes c ON c.rowid = dtc_fts.rowid
          WHERE dtc_fts MATCH ?
          ORDER BY bm25(dtc_fts)
          LIMIT ?
          `,
        )
        .all(fts, lim) as DtcCodeRow[];
      if (rows.length) return rows;
    }
  } catch {
    /* fall through to LIKE */
  }
  const like = `%${q.replace(/%/g, "")}%`;
  return db
    .prepare(
      `
      SELECT code, ecu, obd_code, title_ru, title_en, variants
      FROM dtc_codes
      WHERE code LIKE ? COLLATE NOCASE
         OR obd_code LIKE ? COLLATE NOCASE
         OR title_ru LIKE ?
         OR title_en LIKE ? COLLATE NOCASE
         OR ecu LIKE ? COLLATE NOCASE
      ORDER BY
        CASE
          WHEN code = ? COLLATE NOCASE THEN 0
          WHEN code LIKE ? COLLATE NOCASE THEN 1
          WHEN obd_code LIKE ? COLLATE NOCASE THEN 2
          ELSE 3
        END,
        code
      LIMIT ?
      `,
    )
    .all(like, like, like, like, like, q, `${q}%`, `${q}%`, lim) as DtcCodeRow[];
}

export function getDtcByCode(code: string): DtcCodeRow | null {
  const db = openDtcDatabase();
  if (!db) return null;
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return (
    (db
      .prepare(
        `SELECT code, ecu, obd_code, title_ru, title_en, variants FROM dtc_codes WHERE code = ? COLLATE NOCASE`,
      )
      .get(c) as DtcCodeRow | undefined) ?? null
  );
}

export function dtcStats(): { available: boolean; codes: number; withObd: number; path: string } {
  const path = resolveDtcDbPath();
  const db = openDtcDatabase();
  if (!db) return { available: false, codes: 0, withObd: 0, path };
  try {
    const codes = Number((db.prepare("SELECT COUNT(*) AS n FROM dtc_codes").get() as { n: number }).n);
    const withObd = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM dtc_codes WHERE obd_code != ''").get() as { n: number }).n,
    );
    return { available: true, codes, withObd, path };
  } catch {
    return { available: false, codes: 0, withObd: 0, path };
  }
}
