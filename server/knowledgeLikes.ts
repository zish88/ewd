/**
 * Anonymous +1 likes for KB articles (one vote per IP hash per slug).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let db: Database.Database | null = null;
let opened = "";

function dbPath(): string {
  if (process.env.KNOWLEDGE_LIKES_PATH) return resolve(process.env.KNOWLEDGE_LIKES_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "knowledge-likes.sqlite");
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
    CREATE TABLE IF NOT EXISTS kb_like_counts (
      article_slug TEXT PRIMARY KEY,
      likes INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kb_like_votes (
      article_slug TEXT NOT NULL,
      voter_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (article_slug, voter_hash)
    );
  `);
  db = next;
  opened = path;
  return next;
}

export function ensureKnowledgeLikesStore(): void {
  openDb();
}

function normSlug(slug: string): string {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

export function hashLikeVoter(ip: string): string {
  return createHash("sha256").update(`kb-like:${ip}`).digest("hex").slice(0, 32);
}

export function getKbLikeCount(slug: string): number {
  const s = normSlug(slug);
  if (!s) return 0;
  const d = openDb();
  const row = d.prepare(`SELECT likes FROM kb_like_counts WHERE article_slug = ?`).get(s) as
    | { likes: number }
    | undefined;
  return Number(row?.likes || 0);
}

export function countKbLikesBySlugs(slugs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const clean = [
    ...new Set(
      slugs
        .map((s) => normSlug(s))
        .filter(Boolean),
    ),
  ];
  for (const s of clean) out[s] = 0;
  if (clean.length === 0) return out;
  const d = openDb();
  const ph = clean.map(() => "?").join(",");
  const rows = d
    .prepare(
      `SELECT article_slug AS slug, likes FROM kb_like_counts WHERE article_slug IN (${ph})`,
    )
    .all(...clean) as Array<{ slug: string; likes: number }>;
  for (const r of rows) out[String(r.slug)] = Number(r.likes || 0);
  return out;
}

export function hasKbLiked(slug: string, voterHash: string): boolean {
  const s = normSlug(slug);
  if (!s || !voterHash) return false;
  const d = openDb();
  const row = d
    .prepare(`SELECT 1 AS ok FROM kb_like_votes WHERE article_slug = ? AND voter_hash = ?`)
    .get(s, voterHash) as { ok: number } | undefined;
  return Boolean(row);
}

/** Returns { likes, already } — already true if duplicate vote. */
export function addKbLike(slug: string, voterHash: string): { likes: number; already: boolean } {
  const s = normSlug(slug);
  if (!s) throw new Error("Нет статьи");
  if (!voterHash) throw new Error("Не удалось учесть голос");
  const d = openDb();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO kb_like_votes (article_slug, voter_hash) VALUES (?, ?)`,
  );
  const info = insert.run(s, voterHash);
  if (info.changes === 0) {
    return { likes: getKbLikeCount(s), already: true };
  }
  d.prepare(
    `INSERT INTO kb_like_counts (article_slug, likes) VALUES (?, 1)
     ON CONFLICT(article_slug) DO UPDATE SET likes = likes + 1`,
  ).run(s);
  return { likes: getKbLikeCount(s), already: false };
}
