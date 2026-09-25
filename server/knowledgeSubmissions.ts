/**
 * User submissions to knowledge base (pending → admin approve).
 * No scraping of external posts — link + user's own short text only.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type KbSubmissionKind = "article" | "link";
export type KbSubmissionStatus = "pending" | "approved" | "rejected";

export type KbSubmission = {
  id: number;
  created_at: string;
  status: KbSubmissionStatus;
  kind: KbSubmissionKind;
  platform: string;
  topic: string;
  title: string;
  summary: string;
  body_md: string;
  source_url: string;
  author_name: string;
  admin_note: string;
  published_slug: string;
};

let db: Database.Database | null = null;
let opened = "";

function dbPath(): string {
  if (process.env.KNOWLEDGE_SUBMISSIONS_PATH) return resolve(process.env.KNOWLEDGE_SUBMISSIONS_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "knowledge-submissions.sqlite");
}

function knowledgeRoot(): string {
  return resolve(process.env.KNOWLEDGE_DIR ?? "data/knowledge");
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
    CREATE TABLE IF NOT EXISTS kb_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending',
      kind TEXT NOT NULL,
      platform TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'parts',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      published_slug TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_kb_sub_status ON kb_submissions(status);
  `);
  db = next;
  opened = path;
  return next;
}

export function ensureKnowledgeSubmissionsStore(): void {
  openDb();
}

function rowToSubmission(row: Record<string, unknown>): KbSubmission {
  return {
    id: Number(row.id),
    created_at: String(row.created_at || ""),
    status: String(row.status || "pending") as KbSubmissionStatus,
    kind: String(row.kind || "article") as KbSubmissionKind,
    platform: String(row.platform || ""),
    topic: String(row.topic || "parts"),
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    body_md: String(row.body_md || ""),
    source_url: String(row.source_url || ""),
    author_name: String(row.author_name || ""),
    admin_note: String(row.admin_note || ""),
    published_slug: String(row.published_slug || ""),
  };
}

export function createKbSubmission(input: {
  kind: KbSubmissionKind;
  platform: string;
  topic?: string;
  title: string;
  summary?: string;
  body_md?: string;
  source_url?: string;
  author_name?: string;
}): KbSubmission {
  const d = openDb();
  const kind = input.kind === "link" ? "link" : "article";
  const platform = String(input.platform || "")
    .trim()
    .toLowerCase();
  const topic = String(input.topic || "parts")
    .trim()
    .toLowerCase() || "parts";
  const title = String(input.title || "").trim().slice(0, 160);
  const summary = String(input.summary || "").trim().slice(0, 500);
  const body_md = String(input.body_md || "").trim().slice(0, 8000);
  const source_url = String(input.source_url || "").trim().slice(0, 500);
  const author_name = String(input.author_name || "").trim().slice(0, 80);

  if (!platform || !title) throw new Error("Нужны платформа и заголовок");
  if (kind === "link" && !/^https?:\/\//i.test(source_url)) {
    throw new Error("Для типа «ссылка» нужен URL http(s)");
  }
  if (kind === "link" && summary.length < 20) {
    throw new Error("Кратко опишите пост своими словами (от 20 символов)");
  }
  if (kind === "article" && body_md.length < 40 && summary.length < 40) {
    throw new Error("Текст статьи слишком короткий");
  }

  const info = d
    .prepare(
      `INSERT INTO kb_submissions(kind, platform, topic, title, summary, body_md, source_url, author_name)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(kind, platform, topic, title, summary, body_md, source_url, author_name);

  return getKbSubmission(Number(info.lastInsertRowid))!;
}

export function listKbSubmissions(status?: string | null, limit = 80): KbSubmission[] {
  const d = openDb();
  const lim = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const st = String(status || "").trim().toLowerCase();
  const rows = st
    ? (d
        .prepare(`SELECT * FROM kb_submissions WHERE status=? ORDER BY id DESC LIMIT ?`)
        .all(st, lim) as Array<Record<string, unknown>>)
    : (d
        .prepare(`SELECT * FROM kb_submissions ORDER BY id DESC LIMIT ?`)
        .all(lim) as Array<Record<string, unknown>>);
  return rows.map(rowToSubmission);
}

export function getKbSubmission(id: number): KbSubmission | null {
  const d = openDb();
  const row = d.prepare(`SELECT * FROM kb_submissions WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToSubmission(row) : null;
}

export function rejectKbSubmission(id: number, note = ""): KbSubmission | null {
  const d = openDb();
  d.prepare(
    `UPDATE kb_submissions SET status='rejected', admin_note=? WHERE id=? AND status='pending'`,
  ).run(String(note || "").slice(0, 500), id);
  return getKbSubmission(id);
}

function makeSlug(platform: string, id: number, title: string): string {
  const base = title
    .toLowerCase()
    .replace(/ё/g, "e")
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const ascii = base.replace(/[^a-z0-9-]/g, "") || "note";
  return `${platform}-user-${id}-${ascii}`.slice(0, 72);
}

/** Publish pending submission into data/knowledge/articles + index.json */
export function approveKbSubmission(id: number, note = ""): KbSubmission | null {
  const sub = getKbSubmission(id);
  if (!sub || sub.status !== "pending") return sub;

  const slug = makeSlug(sub.platform, sub.id, sub.title);
  const root = knowledgeRoot();
  const articlesDir = join(root, "articles");
  mkdirSync(articlesDir, { recursive: true });

  const summary =
    sub.summary ||
    (sub.kind === "link"
      ? `Краткая выжимка по ссылке (предложено пользователем).`
      : sub.body_md.slice(0, 220));

  let body_md = sub.body_md.trim();
  if (!body_md) {
    body_md = `## Суть\n\n${summary}\n`;
  }
  if (sub.source_url) {
    body_md += `\n\n## Источник\n\nСсылка на пост автора — в блоке ниже. Сверяйте по VIN/EPC.`;
  }

  const article = {
    slug,
    title: sub.title,
    platform: sub.platform,
    topics: [sub.topic || "parts"],
    summary,
    updated: new Date().toISOString().slice(0, 10),
    body_md,
    links: sub.source_url
      ? [
          {
            title: sub.title,
            url: sub.source_url,
            site: /drive2\.ru/i.test(sub.source_url) ? "Drive2" : "Источник",
          },
        ]
      : [],
    author: {
      ...(sub.author_name ? { name: sub.author_name } : {}),
      ...(sub.source_url ? { post_url: sub.source_url } : {}),
    },
  };

  writeFileSync(join(articlesDir, `${slug}.json`), JSON.stringify(article, null, 2) + "\n", "utf8");

  const indexPath = join(root, "index.json");
  const index = existsSync(indexPath)
    ? (JSON.parse(readFileSync(indexPath, "utf8")) as {
        topics?: unknown;
        articles: Array<Record<string, unknown>>;
      })
    : { topics: [], articles: [] };
  if (!Array.isArray(index.articles)) index.articles = [];
  if (!index.articles.some((a) => a.slug === slug)) {
    index.articles.push({
      slug,
      title: sub.title,
      platform: sub.platform,
      topics: [sub.topic || "parts"],
      summary,
      updated: article.updated,
    });
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");

  const d = openDb();
  d.prepare(
    `UPDATE kb_submissions
     SET status='approved', admin_note=?, published_slug=?
     WHERE id=?`,
  ).run(String(note || "").slice(0, 500), slug, id);

  return getKbSubmission(id);
}

/** Tag a pending submission as collector-origin (for admin UI). */
export function tagKbSubmissionCollector(id: number): void {
  const d = openDb();
  d.prepare(
    `UPDATE kb_submissions SET admin_note =
       CASE WHEN admin_note = '' OR admin_note IS NULL THEN 'collector:'
            WHEN admin_note LIKE 'collector:%' THEN admin_note
            ELSE 'collector: ' || admin_note END
     WHERE id=?`,
  ).run(id);
}
