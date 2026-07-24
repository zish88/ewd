import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type VisitStats = {
  day: number;
  week: number;
  month: number;
  total: number;
  recent: Array<{ id: number; visitedAt: string; path: string }>;
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
      ip_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(visited_at);
    CREATE INDEX IF NOT EXISTS idx_visits_session_at ON visits(session_id, visited_at);
  `);
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

/** Record one visit; same session within 30 minutes is ignored (no double-count). */
export function recordVisit(opts: {
  sessionId: unknown;
  path?: unknown;
  ip?: string;
}): { ok: true; recorded: boolean } | { ok: false; error: string } {
  const sessionId = normalizeSessionId(opts.sessionId);
  if (!sessionId) return { ok: false, error: "bad session" };

  const pathRaw = String(opts.path ?? "/").trim() || "/";
  const path = pathRaw.slice(0, 200);
  // Never count admin itself as a public visit
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

  db.prepare(
    `INSERT INTO visits (path, session_id, ip_hash) VALUES (?, ?, ?)`,
  ).run(path, sessionId, hashIp(opts.ip || ""));
  return { ok: true, recorded: true };
}

export function getVisitStats(limitRecent = 40): VisitStats {
  const db = openVisitsDb();
  const countSince = (modifier: string) =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM visits WHERE visited_at >= datetime('now', ?)`).get(modifier) as {
        n: number;
      }).n,
    );

  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM visits`).get() as { n: number }).n);
  const recentRows = db
    .prepare(
      `SELECT id, visited_at AS visitedAt, path
       FROM visits
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(Math.min(200, Math.max(1, limitRecent))) as Array<{ id: number; visitedAt: string; path: string }>;

  return {
    day: countSince("-1 day"),
    week: countSince("-7 days"),
    month: countSince("-30 days"),
    total,
    recent: recentRows,
  };
}

/** Ensure DB file exists (for health / first boot). */
export function ensureVisitsStore(): void {
  openVisitsDb();
  if (!existsSync(visitsDbPath())) {
    /* opened above creates it */
  }
}

/** Test helper — close WAL handles before deleting temp dir. */
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
