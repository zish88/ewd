import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseAcceptLanguage, parseUserAgent } from "./userAgent.js";

export type VisitRow = {
  id: number;
  visitedAt: string;
  path: string;
  uaLabel: string;
  lang: string;
  referrer: string;
  device: string;
  country: string;
  timezone: string;
  screen: string;
};

export type VisitStats = {
  /** Calendar day UTC (date(visited_at) = date('now')). */
  today: number;
  /** Previous calendar day UTC. */
  yesterday: number;
  week: number;
  month: number;
  total: number;
  /** Distinct sessions with a visit in the last 30 minutes. */
  online30m: number;
  /** Count in optional from/to filter (UTC calendar dates YYYY-MM-DD). */
  filtered: number | null;
  filterFrom: string | null;
  filterTo: string | null;
  recent: VisitRow[];
};

let visitsDb: Database.Database | null = null;
let visitsDbOpenedPath = "";

function visitsDbPath(): string {
  if (process.env.VISITS_DATABASE_PATH) {
    return resolve(process.env.VISITS_DATABASE_PATH);
  }
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "visits.sqlite");
}

function ensureColumn(db: Database.Database, name: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(visits)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === name)) {
    db.exec(ddl);
  }
}

function openVisitsDb(): Database.Database {
  const path = visitsDbPath();
  if (visitsDb && visitsDbOpenedPath === path) return visitsDb;
  if (visitsDb) {
    try {
      visitsDb.close();
    } catch {
      /* ignore */
    }
    visitsDb = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visited_at TEXT NOT NULL DEFAULT (datetime('now')),
      path TEXT NOT NULL DEFAULT '/',
      session_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT '',
      ua_label TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(visited_at);
    CREATE INDEX IF NOT EXISTS idx_visits_session_at ON visits(session_id, visited_at);
  `);
  ensureColumn(db, "ua_label", `ALTER TABLE visits ADD COLUMN ua_label TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "lang", `ALTER TABLE visits ADD COLUMN lang TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "referrer", `ALTER TABLE visits ADD COLUMN referrer TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "device", `ALTER TABLE visits ADD COLUMN device TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "country", `ALTER TABLE visits ADD COLUMN country TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "timezone", `ALTER TABLE visits ADD COLUMN timezone TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "screen", `ALTER TABLE visits ADD COLUMN screen TEXT NOT NULL DEFAULT ''`);
  visitsDb = db;
  visitsDbOpenedPath = path;
  return db;
}

function hashIp(ip: string): string {
  const salt = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "ewd-visits";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 16);
}

function normalizeSessionId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(s)) return null;
  return s;
}

function sanitizeReferrer(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 300);
  if (!s) return "";
  try {
    const u = new URL(s);
    // host + path only (no query — may contain PII)
    return `${u.host}${u.pathname}`.slice(0, 200);
  } catch {
    return s.replace(/[?#].*$/, "").slice(0, 200);
  }
}

function sanitizeCountry(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return "";
}

function sanitizeTimezone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(s)) return "";
  return s.slice(0, 64);
}

function sanitizeScreen(w: unknown, h: unknown): string {
  const width = Number(w);
  const height = Number(h);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return "";
  if (width < 1 || height < 1 || width > 10000 || height > 10000) return "";
  return `${Math.round(width)}x${Math.round(height)}`;
}

/** YYYY-MM-DD or null */
export function normalizeVisitDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/** Record one visit; same session within 30 minutes is ignored (no double-count). */
export function recordVisit(opts: {
  sessionId: unknown;
  path?: unknown;
  ip?: string;
  userAgent?: string | null;
  acceptLanguage?: string | null;
  referrer?: string | null;
  countryHint?: string | null;
  timezone?: unknown;
  screenW?: unknown;
  screenH?: unknown;
  langClient?: unknown;
}): { ok: true; recorded: boolean } | { ok: false; error: string } {
  const sessionId = normalizeSessionId(opts.sessionId);
  if (!sessionId) return { ok: false, error: "bad session" };

  const pathRaw = String(opts.path ?? "/").trim() || "/";
  const path = pathRaw.slice(0, 200);
  if (path.startsWith("/admin")) return { ok: true, recorded: false };

  const db = openVisitsDb();
  const recent = db
    .prepare(
      `SELECT id FROM visits
       WHERE session_id = ?
         AND visited_at >= datetime('now', '-30 minutes')
       LIMIT 1`,
    )
    .get(sessionId) as { id: number } | undefined;
  if (recent) return { ok: true, recorded: false };

  const ua = parseUserAgent(opts.userAgent);
  const lang =
    parseAcceptLanguage(String(opts.langClient || "")) ||
    parseAcceptLanguage(opts.acceptLanguage) ||
    "";
  const referrer = sanitizeReferrer(opts.referrer);
  const country = sanitizeCountry(opts.countryHint);
  const timezone = sanitizeTimezone(opts.timezone);
  const screen = sanitizeScreen(opts.screenW, opts.screenH);

  db.prepare(
    `INSERT INTO visits (path, session_id, ip_hash, ua_label, lang, referrer, device, country, timezone, screen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    path,
    sessionId,
    hashIp(opts.ip || ""),
    ua.label.slice(0, 80),
    lang.slice(0, 16),
    referrer,
    ua.device.slice(0, 16),
    country,
    timezone,
    screen.slice(0, 24),
  );
  return { ok: true, recorded: true };
}

export function getVisitStats(
  limitRecent = 40,
  filter?: { from?: string | null; to?: string | null },
): VisitStats {
  const db = openVisitsDb();
  const countSince = (modifier: string) =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE visited_at >= datetime('now', ?)`).get(modifier) as {
        n: number;
      }).n,
    );
  const countOnCalendarDay = (sqliteDateExpr: string) =>
    Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM visits
             WHERE date(visited_at) = ${sqliteDateExpr}`,
          )
          .get() as { n: number }
      ).n,
    );

  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM visits`).get() as { n: number }).n);
  const online30m = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS n FROM visits
           WHERE visited_at >= datetime('now', '-30 minutes')`,
        )
        .get() as { n: number }
    ).n,
  );

  const from = normalizeVisitDate(filter?.from);
  const to = normalizeVisitDate(filter?.to);
  let filtered: number | null = null;
  const whereParts: string[] = [];
  const whereArgs: string[] = [];
  if (from) {
    whereParts.push(`date(visited_at) >= date(?)`);
    whereArgs.push(from);
  }
  if (to) {
    whereParts.push(`date(visited_at) <= date(?)`);
    whereArgs.push(to);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  if (from || to) {
    filtered = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM visits ${whereSql}`).get(...whereArgs) as { n: number }).n,
    );
  }

  const recentRows = db
    .prepare(
      `SELECT id,
              visited_at AS visitedAt,
              path,
              ua_label AS uaLabel,
              IFNULL(lang,'') AS lang,
              IFNULL(referrer,'') AS referrer,
              IFNULL(device,'') AS device,
              IFNULL(country,'') AS country,
              IFNULL(timezone,'') AS timezone,
              IFNULL(screen,'') AS screen
       FROM visits
       ${whereSql}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...whereArgs, Math.min(200, Math.max(1, limitRecent))) as VisitRow[];

  return {
    today: countOnCalendarDay(`date('now')`),
    yesterday: countOnCalendarDay(`date('now', '-1 day')`),
    week: countSince("-7 days"),
    month: countSince("-30 days"),
    total,
    online30m,
    filtered,
    filterFrom: from,
    filterTo: to,
    recent: recentRows.map((r) => ({
      ...r,
      uaLabel: r.uaLabel || "",
      lang: r.lang || "",
      referrer: r.referrer || "",
      device: r.device || "",
      country: r.country || "",
      timezone: r.timezone || "",
      screen: r.screen || "",
    })),
  };
}

export function ensureVisitsStore(): void {
  openVisitsDb();
  if (!existsSync(visitsDbPath())) {
    /* opened above creates it */
  }
}

export function _closeVisitsDbForTests(): void {
  if (!visitsDb) return;
  try {
    visitsDb.close();
  } catch {
    /* ignore */
  }
  visitsDb = null;
  visitsDbOpenedPath = "";
}
