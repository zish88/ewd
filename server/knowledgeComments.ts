/**
 * Anonymous KB article comments (math captcha on POST).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type KbComment = {
  id: number;
  created_at: string;
  article_slug: string;
  author_name: string;
  body: string;
};

let db: Database.Database | null = null;
let opened = "";

function dbPath(): string {
  if (process.env.KNOWLEDGE_COMMENTS_PATH) return resolve(process.env.KNOWLEDGE_COMMENTS_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "knowledge-comments.sqlite");
}

function openDb(): Database.Database {
  const path = dbPath();
  if (db && opened === path) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const next = new Database(path);
  next.pragma("journal_mode = WAL");
  next.exec(`
    CREATE TABLE IF NOT EXISTS kb_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      article_slug TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_kb_comments_slug ON kb_comments(article_slug, created_at DESC);
  `);
  db = next;
  opened = path;
  return next;
}

export function ensureKnowledgeCommentsStore(): void {
  openDb();
}

function rowToComment(row: Record<string, unknown>): KbComment {
  return {
    id: Number(row.id),
    created_at: String(row.created_at || ""),
    article_slug: String(row.article_slug || ""),
    author_name: String(row.author_name || ""),
    body: String(row.body || ""),
  };
}

export function hashCommentIp(ip: string): string {
  return createHash("sha256").update(`kb-c:${ip}`).digest("hex").slice(0, 24);
}

export function listKbComments(slug: string, limit = 100): KbComment[] {
  const d = openDb();
  const s = String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  if (!s) return [];
  const rows = d
    .prepare(
      `SELECT id, created_at, article_slug, author_name, body
       FROM kb_comments WHERE article_slug = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(s, Math.min(Math.max(limit, 1), 200)) as Record<string, unknown>[];
  return rows.map(rowToComment);
}

export function countKbComments(slug: string): number {
  const d = openDb();
  const s = String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  if (!s) return 0;
  const row = d.prepare(`SELECT COUNT(*) AS n FROM kb_comments WHERE article_slug = ?`).get(s) as
    | { n: number }
    | undefined;
  return Number(row?.n || 0);
}

/** Batch counts for list/search cards. Missing slugs → 0. */
export function countKbCommentsBySlugs(slugs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const clean = [
    ...new Set(
      slugs
        .map((s) =>
          String(s || "")
            .trim()
            .toLowerCase()
            .slice(0, 120),
        )
        .filter(Boolean),
    ),
  ];
  for (const s of clean) out[s] = 0;
  if (clean.length === 0) return out;
  const d = openDb();
  const ph = clean.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT article_slug AS slug, COUNT(*) AS n FROM kb_comments
       WHERE article_slug IN (${ph}) GROUP BY article_slug`,
    )
    .all(...clean) as Array<{ slug: string; n: number }>;
  for (const r of rows) out[String(r.slug)] = Number(r.n || 0);
  return out;
}

export function createKbComment(input: {
  article_slug: string;
  author_name?: string;
  body: string;
  ip?: string;
}): KbComment {
  const d = openDb();
  const article_slug = String(input.article_slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  if (!article_slug) throw new Error("Нет статьи");
  const author_name = String(input.author_name || "")
    .trim()
    .slice(0, 40);
  const body = String(input.body || "")
    .trim()
    .slice(0, 1000);
  if (body.length < 2) throw new Error("Напишите комментарий (минимум 2 символа)");
  const ip_hash = input.ip ? hashCommentIp(input.ip) : "";
  const info = d
    .prepare(
      `INSERT INTO kb_comments (article_slug, author_name, body, ip_hash)
       VALUES (?, ?, ?, ?)`,
    )
    .run(article_slug, author_name, body, ip_hash);
  const row = d.prepare(`SELECT * FROM kb_comments WHERE id = ?`).get(Number(info.lastInsertRowid)) as Record<
    string,
    unknown
  >;
  return rowToComment(row);
}

export function listKbCommentsAdmin(opts: { slug?: string | null; limit?: number } = {}): KbComment[] {
  const d = openDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const slug = String(opts.slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  if (slug) {
    return listKbComments(slug, limit);
  }
  const rows = d
    .prepare(
      `SELECT id, created_at, article_slug, author_name, body
       FROM kb_comments ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToComment);
}

export function deleteKbComment(id: number): boolean {
  const d = openDb();
  if (!Number.isFinite(id) || id < 1) return false;
  const info = d.prepare(`DELETE FROM kb_comments WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Test helper */
export function _closeKnowledgeCommentsForTests(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  db = null;
  opened = "";
}

export function knowledgeCommentsDbExists(): boolean {
  return existsSync(dbPath());
}
