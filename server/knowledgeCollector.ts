/**
 * Knowledge collector: seed URLs -> fetch/cache -> pending kb_submissions.
 * Never publishes; admin approve does that.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  createKbSubmission,
  listKbSubmissions,
  tagKbSubmissionCollector,
} from "./knowledgeSubmissions.js";

export type CollectorMode = "offline" | "online" | "dry-run";

export type CollectorConfig = {
  maxPublishedArticles: number;
  maxPerPlatform: number;
  maxPendingDrafts: number;
  maxNewDraftsPerRun: number;
  maxRawCacheMb: number;
  maxHtmlBytesPerUrl: number;
  maxBodyMdChars: number;
  maxSummaryChars: number;
  /** Pause between fetches to the same host (seconds). */
  minSecondsBetweenFetchHost: number;
  fetchTimeoutMs: number;
  maxRetries: number;
  allowHosts: string[];
};

export type CollectorStatus = {
  config: CollectorConfig;
  publishedArticles: number;
  pendingDrafts: number;
  seeds: number;
  urls: { queued: number; done: number; error: number; skipped: number };
  cacheMb: number;
  lastRun: {
    id: number;
    started_at: string;
    finished_at: string;
    mode: string;
    report: Record<string, unknown>;
  } | null;
  seedsList: Array<{ id: number; url: string; platform: string; topic: string; status: string }>;
};

export type CollectorRunReport = {
  mode: CollectorMode;
  created: number;
  skipped: number;
  errors: number;
  quotaStop: string | null;
  items: Array<{ url: string; action: string; detail?: string; submissionId?: number }>;
};

const DEFAULTS: CollectorConfig = {
  maxPublishedArticles: 400,
  maxPerPlatform: 80,
  maxPendingDrafts: 40,
  maxNewDraftsPerRun: 10,
  maxRawCacheMb: 200,
  maxHtmlBytesPerUrl: 1_500_000,
  maxBodyMdChars: 4000,
  maxSummaryChars: 280,
  minSecondsBetweenFetchHost: 4,
  fetchTimeoutMs: 15_000,
  maxRetries: 3,
  allowHosts: [
    "www.drive2.ru",
    "drive2.ru",
    "www.swedespeed.com",
    "swedespeed.com",
    "www.volvoforums.org.uk",
    "volvoforums.org.uk",
    "www.volvocars.com",
    "volvocars.com",
    "www.ipdusa.com",
    "ipdusa.com",
    "www.fcpeuro.com",
    "fcpeuro.com",
  ],
};

let db: Database.Database | null = null;
let opened = "";

function collectorDbPath(): string {
  if (process.env.KNOWLEDGE_COLLECTOR_PATH) return resolve(process.env.KNOWLEDGE_COLLECTOR_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "knowledge-collector.sqlite");
}

function cacheDir(): string {
  if (process.env.KNOWLEDGE_COLLECTOR_CACHE) return resolve(process.env.KNOWLEDGE_COLLECTOR_CACHE);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "knowledge-collector-cache");
}

function knowledgeRoot(): string {
  return resolve(process.env.KNOWLEDGE_DIR ?? "data/knowledge");
}

function loadConfig(): CollectorConfig {
  const path = resolve("scripts/kb-collector/config.defaults.json");
  let fileCfg: Partial<CollectorConfig> = {};
  if (existsSync(path)) {
    try {
      fileCfg = JSON.parse(readFileSync(path, "utf8")) as Partial<CollectorConfig>;
    } catch {
      /* ignore */
    }
  }
  const fromFile = fileCfg as Partial<CollectorConfig> & { minHoursBetweenFetchHost?: number };
  let minSec = DEFAULTS.minSecondsBetweenFetchHost;
  if (typeof fromFile.minSecondsBetweenFetchHost === "number") {
    minSec = fromFile.minSecondsBetweenFetchHost;
  } else if (typeof fromFile.minHoursBetweenFetchHost === "number") {
    minSec = fromFile.minHoursBetweenFetchHost * 3600;
  }
  return {
    ...DEFAULTS,
    ...fileCfg,
    minSecondsBetweenFetchHost: minSec || DEFAULTS.minSecondsBetweenFetchHost,
    allowHosts: Array.isArray(fileCfg.allowHosts) ? fileCfg.allowHosts : DEFAULTS.allowHosts,
  };
}

function openDb(): Database.Database {
  const path = collectorDbPath();
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
  mkdirSync(cacheDir(), { recursive: true });
  const next = new Database(path);
  next.pragma("journal_mode = WAL");
  next.exec(`
    CREATE TABLE IF NOT EXISTS seeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      url TEXT NOT NULL,
      platform TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'parts',
      UNIQUE(url, platform)
    );
    CREATE TABLE IF NOT EXISTS url_jobs (
      url TEXT NOT NULL,
      platform TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'parts',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (url, platform)
    );
    CREATE TABLE IF NOT EXISTS host_fetch (
      host TEXT PRIMARY KEY,
      last_fetch_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      report_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  migrateCollectorSchema(next);
  db = next;
  opened = path;
  return next;
}

function migrateCollectorSchema(next: Database.Database): void {
  const seedsSql = String(
    (next.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='seeds'`).get() as { sql?: string } | undefined)
      ?.sql || "",
  );
  if (/url TEXT NOT NULL UNIQUE/i.test(seedsSql)) {
    next.exec(`
      ALTER TABLE seeds RENAME TO seeds_legacy_v1;
      CREATE TABLE seeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        url TEXT NOT NULL,
        platform TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT 'parts',
        UNIQUE(url, platform)
      );
      INSERT OR IGNORE INTO seeds(id, created_at, url, platform, topic)
        SELECT id, created_at, url, platform, topic FROM seeds_legacy_v1;
      DROP TABLE seeds_legacy_v1;
    `);
  }
  const jobsSql = String(
    (next.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='url_jobs'`).get() as { sql?: string } | undefined)
      ?.sql || "",
  );
  if (/url TEXT PRIMARY KEY/i.test(jobsSql)) {
    next.exec(`
      ALTER TABLE url_jobs RENAME TO url_jobs_legacy_v1;
      CREATE TABLE url_jobs (
        url TEXT NOT NULL,
        platform TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT 'parts',
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (url, platform)
      );
      INSERT OR IGNORE INTO url_jobs(url, platform, topic, status, attempts, last_error, updated_at)
        SELECT url, platform, topic, status, attempts, last_error, updated_at FROM url_jobs_legacy_v1;
      DROP TABLE url_jobs_legacy_v1;
    `);
  }
}

export function ensureKnowledgeCollectorStore(): void {
  openDb();
}

export function normalizeCollectorUrl(raw: string): string {
  const u = String(raw || "").trim();
  if (!u) return "";
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedHost(url: string, cfg: CollectorConfig): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return cfg.allowHosts.some((a) => {
    const x = a.toLowerCase();
    return h === x || h.endsWith(`.${x}`);
  });
}

function cacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

function cachePathFor(url: string): string {
  return join(cacheDir(), `${cacheKey(url)}.html`);
}

function dirSizeMb(dir: string): number {
  if (!existsSync(dir)) return 0;
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    try {
      bytes += statSync(join(dir, f)).size;
    } catch {
      /* ignore */
    }
  }
  return bytes / (1024 * 1024);
}

function vacuumCache(cfg: CollectorConfig): void {
  const dir = cacheDir();
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .map((name) => {
      const p = join(dir, name);
      try {
        const st = statSync(p);
        return { p, mtime: st.mtimeMs, size: st.size };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ p: string; mtime: number; size: number }>;
  files.sort((a, b) => a.mtime - b.mtime);
  let mb = files.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
  while (mb > cfg.maxRawCacheMb && files.length) {
    const f = files.shift()!;
    try {
      unlinkSync(f.p);
      mb -= f.size / (1024 * 1024);
    } catch {
      /* ignore */
    }
  }
}

function countPublishedArticles(): {
  total: number;
  byPlatform: Record<string, number>;
  urls: Set<string>;
} {
  const root = knowledgeRoot();
  const indexPath = join(root, "index.json");
  const byPlatform: Record<string, number> = {};
  const urls = new Set<string>();
  let total = 0;
  if (existsSync(indexPath)) {
    try {
      const idx = JSON.parse(readFileSync(indexPath, "utf8")) as {
        articles?: Array<{ platform?: string }>;
      };
      for (const a of idx.articles || []) {
        total++;
        const p = String(a.platform || "");
        byPlatform[p] = (byPlatform[p] || 0) + 1;
      }
    } catch {
      /* ignore */
    }
  }
  const articlesDir = join(root, "articles");
  if (existsSync(articlesDir)) {
    for (const f of readdirSync(articlesDir).filter((x) => x.endsWith(".json"))) {
      try {
        const a = JSON.parse(readFileSync(join(articlesDir, f), "utf8")) as {
          links?: Array<{ url?: string }>;
          author?: { post_url?: string };
        };
        for (const l of a.links || []) {
          const n = normalizeCollectorUrl(String(l.url || ""));
          if (n) urls.add(n);
        }
        const post = normalizeCollectorUrl(String(a.author?.post_url || ""));
        if (post) urls.add(post);
      } catch {
        /* ignore */
      }
    }
  }
  return { total, byPlatform, urls };
}

function pendingSourceUrls(): Set<string> {
  const set = new Set<string>();
  for (const s of listKbSubmissions("pending", 200)) {
    const n = normalizeCollectorUrl(s.source_url);
    if (n) set.add(n);
  }
  return set;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function extractHintsFromHtml(
  html: string,
  cfg: CollectorConfig,
): { title: string; summary: string; excerpt: string } {
  const raw = String(html || "");
  let title = "";
  const ogTitle =
    raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogTitle) title = ogTitle[1];
  if (!title) {
    const t = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t) title = t[1];
  }
  title = decodeEntities(title).replace(/\s+/g, " ").trim().slice(0, 160);

  let desc = "";
  const ogDesc =
    raw.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (ogDesc) desc = ogDesc[1];
  if (!desc) {
    const md =
      raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (md) desc = md[1];
  }
  desc = decodeEntities(desc).replace(/\s+/g, " ").trim();

  const stripped = decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
  const excerpt = stripped.slice(0, 1500);
  const summary = (desc || excerpt).slice(0, cfg.maxSummaryChars);
  if (!title) title = summary.slice(0, 80) || "Материал без заголовка";
  return { title, summary, excerpt };
}

function buildDraftBody(opts: {
  title: string;
  summary: string;
  excerpt: string;
  url: string;
  platform: string;
  cfg: CollectorConfig;
}): string {
  return [
    "## Суть",
    "",
    opts.summary || opts.title,
    "",
    "## Выжимка (черновик сборщика)",
    "",
    (opts.excerpt || opts.summary).slice(0, 900),
    "",
    "## Источник",
    "",
    `Оригинал: ${opts.url}`,
    "",
    "## Важно",
    "",
    `Черновик для платформы **${opts.platform.toUpperCase()}**. Перед публикацией проверьте факты и партномера по VIN/EPC.`,
  ]
    .join("\n")
    .slice(0, opts.cfg.maxBodyMdChars);
}

async function fetchHtml(
  url: string,
  cfg: CollectorConfig,
): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  const host = hostOf(url);
  const d = openDb();
  const last = d.prepare(`SELECT last_fetch_at FROM host_fetch WHERE host=?`).get(host) as
    | { last_fetch_at: string }
    | undefined;
  if (last?.last_fetch_at) {
    const ts = Date.parse(String(last.last_fetch_at).replace(" ", "T") + "Z");
    const sec = Number.isFinite(ts) ? (Date.now() - ts) / 1000 : 9999;
    const need = Math.max(0, Number(cfg.minSecondsBetweenFetchHost) || 4);
    if (sec < need) {
      const waitMs = Math.ceil((need - sec) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "VolvoEWD-KBCollector/1.0 (+admin; summary drafts only)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cfg.maxHtmlBytesPerUrl) {
      return { ok: false, error: `HTML too large ${buf.length}` };
    }
    const html = buf.toString("utf8");
    d.prepare(
      `INSERT INTO host_fetch(host, last_fetch_at) VALUES(?, datetime('now'))
       ON CONFLICT(host) DO UPDATE SET last_fetch_at=excluded.last_fetch_at`,
    ).run(host);
    return { ok: true, html };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

function readCache(url: string): string | null {
  const p = cachePathFor(url);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function writeCache(url: string, html: string, cfg: CollectorConfig): void {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(cachePathFor(url), html, "utf8");
  vacuumCache(cfg);
}

/** Put fixture HTML into cache for a URL (tests / offline smoke). */
export function warmCollectorCache(url: string, html: string): void {
  const cfg = loadConfig();
  const n = normalizeCollectorUrl(url);
  if (!n) throw new Error("bad url");
  writeCache(n, html, cfg);
}

export function addCollectorSeed(input: {
  url: string;
  platform: string;
  topic?: string;
}):
  | { ok: true; seed: { id: number; url: string; platform: string; topic: string } }
  | { ok: false; error: string } {
  const cfg = loadConfig();
  const url = normalizeCollectorUrl(input.url);
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "Нужен http(s) URL" };
  if (!isAllowedHost(url, cfg)) return { ok: false, error: `Домен не в allowlist: ${hostOf(url) || "?"}` };
  let platform = String(input.platform || "")
    .trim()
    .toLowerCase();
  if (platform === "all") platform = "";
  if (!platform) return { ok: false, error: "Укажите платформу (p1/p2/p3/cma/spa)" };
  if (!["p1", "p2", "p3", "cma", "spa"].includes(platform)) {
    return { ok: false, error: "Платформа: p1, p2, p3, cma или spa" };
  }
  const topic =
    String(input.topic || "parts")
      .trim()
      .toLowerCase() || "parts";
  const d = openDb();
  try {
    const info = d.prepare(`INSERT INTO seeds(url, platform, topic) VALUES(?,?,?)`).run(url, platform, topic);
    d.prepare(
      `INSERT INTO url_jobs(url, platform, topic, status) VALUES(?,?,?,'queued')
       ON CONFLICT(url, platform) DO UPDATE SET topic=excluded.topic,
         status=CASE WHEN url_jobs.status='done' THEN url_jobs.status ELSE 'queued' END,
         last_error='',
         updated_at=datetime('now')`,
    ).run(url, platform, topic);
    return {
      ok: true,
      seed: { id: Number(info.lastInsertRowid), url, platform, topic },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (/UNIQUE/i.test(msg)) {
      // already seeded — re-queue job
      d.prepare(
        `INSERT INTO url_jobs(url, platform, topic, status) VALUES(?,?,?,'queued')
         ON CONFLICT(url, platform) DO UPDATE SET status='queued', last_error='', updated_at=datetime('now')`,
      ).run(url, platform, topic);
      const row = d.prepare(`SELECT id FROM seeds WHERE url=? AND platform=?`).get(url, platform) as
        | { id: number }
        | undefined;
      return {
        ok: true,
        seed: { id: Number(row?.id || 0), url, platform, topic },
      };
    }
    return { ok: false, error: msg };
  }
}

const PLATFORMS = ["p1", "p2", "p3", "cma", "spa"] as const;

/** Parse multi-line paste: URL per line; optional `p3 https://…` or `p3|https://…`. */
export function parseCollectorSeedText(
  text: string,
  defaultPlatform: string,
  defaultTopic = "parts",
): Array<{ url: string; platform: string; topic: string }> {
  const out: Array<{ url: string; platform: string; topic: string }> = [];
  const seen = new Set<string>();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let platform = defaultPlatform;
    let topic = defaultTopic;
    const pipe = line.match(/^(p1|p2|p3|cma|spa)\s*[|:\s]\s*(https?:\/\/\S+)/i);
    const spaced = line.match(/^(p1|p2|p3|cma|spa)\s+(https?:\/\/\S+)/i);
    if (pipe) {
      platform = pipe[1].toLowerCase();
      line = pipe[2];
    } else if (spaced) {
      platform = spaced[1].toLowerCase();
      line = spaced[2];
    } else {
      const urls = line.match(/https?:\/\/[^\s<>"']+/gi) || [];
      for (const u of urls) {
        const n = normalizeCollectorUrl(u.replace(/[),.]+$/, ""));
        if (!n) continue;
        const key = `${platform}|${n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: n, platform, topic });
      }
      continue;
    }
    const n = normalizeCollectorUrl(line.replace(/[),.]+$/, ""));
    if (!n) continue;
    const key = `${platform}|${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: n, platform, topic });
  }
  return out;
}

export function addCollectorSeedsBatch(input: {
  text?: string;
  urls?: string[];
  platform: string;
  topic?: string;
}): {
  ok: true;
  added: number;
  failed: Array<{ url: string; error: string }>;
  seeds: Array<{ id: number; url: string; platform: string; topic: string }>;
} {
  const topic = input.topic || "parts";
  const platformRaw = String(input.platform || "p3").trim().toLowerCase();
  const platforms =
    platformRaw === "all" ? [...PLATFORMS] : [platformRaw || "p3"];

  let entries: Array<{ url: string; platform: string; topic: string }> = [];
  if (input.text && String(input.text).trim()) {
    for (const p of platforms) {
      entries.push(...parseCollectorSeedText(input.text, p, topic));
    }
    // dedupe
    const seen = new Set<string>();
    entries = entries.filter((e) => {
      const k = `${e.platform}|${e.url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } else {
    for (const u of input.urls || []) {
      for (const p of platforms) {
        entries.push({ url: u, platform: p, topic });
      }
    }
  }

  const seeds: Array<{ id: number; url: string; platform: string; topic: string }> = [];
  const failed: Array<{ url: string; error: string }> = [];
  for (const e of entries.slice(0, 80)) {
    const r = addCollectorSeed(e);
    if (r.ok) seeds.push(r.seed);
    else failed.push({ url: e.url, error: r.error });
  }
  return { ok: true, added: seeds.length, failed, seeds };
}

export function listCollectorSeeds(limit = 100): Array<{
  id: number;
  url: string;
  platform: string;
  topic: string;
  status: string;
}> {
  const d = openDb();
  const rows = d
    .prepare(
      `SELECT s.id, s.url, s.platform, s.topic, COALESCE(j.status, 'queued') AS status
       FROM seeds s
       LEFT JOIN url_jobs j ON j.url = s.url AND j.platform = s.platform
       ORDER BY s.id DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 300)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    url: String(r.url),
    platform: String(r.platform),
    topic: String(r.topic),
    status: String(r.status),
  }));
}

export function getCollectorStatus(): CollectorStatus {
  const cfg = loadConfig();
  const d = openDb();
  const published = countPublishedArticles();
  const pending = listKbSubmissions("pending", 500).length;
  const seeds = Number((d.prepare(`SELECT COUNT(*) AS n FROM seeds`).get() as { n: number }).n || 0);
  const urls = { queued: 0, done: 0, error: 0, skipped: 0 };
  for (const row of d.prepare(`SELECT status, COUNT(*) AS n FROM url_jobs GROUP BY status`).all() as Array<{
    status: string;
    n: number;
  }>) {
    const k = row.status as keyof typeof urls;
    if (k in urls) urls[k] = Number(row.n || 0);
  }
  const last = d.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get() as
    | Record<string, unknown>
    | undefined;
  let lastRun: CollectorStatus["lastRun"] = null;
  if (last) {
    let report: Record<string, unknown> = {};
    try {
      report = JSON.parse(String(last.report_json || "{}")) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    lastRun = {
      id: Number(last.id),
      started_at: String(last.started_at || ""),
      finished_at: String(last.finished_at || ""),
      mode: String(last.mode || ""),
      report,
    };
  }
  return {
    config: cfg,
    publishedArticles: published.total,
    pendingDrafts: pending,
    seeds,
    urls,
    cacheMb: Math.round(dirSizeMb(cacheDir()) * 10) / 10,
    lastRun,
    seedsList: listCollectorSeeds(50),
  };
}

export function vacuumCollectorCache(): { ok: true; cacheMb: number } {
  const cfg = loadConfig();
  vacuumCache(cfg);
  return { ok: true, cacheMb: Math.round(dirSizeMb(cacheDir()) * 10) / 10 };
}

function setJobStatus(url: string, platform: string, status: string, error = ""): void {
  openDb()
    .prepare(
      `UPDATE url_jobs SET status=?, last_error=?, attempts=attempts+1, updated_at=datetime('now')
       WHERE url=? AND platform=?`,
    )
    .run(status, error.slice(0, 400), url, platform);
}

export async function runKnowledgeCollector(opts: {
  mode?: CollectorMode;
  maxNew?: number;
}): Promise<CollectorRunReport> {
  const cfg = loadConfig();
  const mode: CollectorMode = opts.mode === "online" || opts.mode === "dry-run" ? opts.mode : "offline";
  const maxNew = Math.min(Math.max(Number(opts.maxNew) || cfg.maxNewDraftsPerRun, 1), cfg.maxNewDraftsPerRun);
  const d = openDb();
  const started = new Date().toISOString();
  const runInfo = d.prepare(`INSERT INTO runs(started_at, mode) VALUES(?,?)`).run(started, mode);
  const runId = Number(runInfo.lastInsertRowid);

  const report: CollectorRunReport = {
    mode,
    created: 0,
    skipped: 0,
    errors: 0,
    quotaStop: null,
    items: [],
  };

  const published = countPublishedArticles();
  const pendingUrls = pendingSourceUrls();

  if (published.total >= cfg.maxPublishedArticles) {
    report.quotaStop = "published_full";
  }

  let pendingCount = listKbSubmissions("pending", 500).length;
  if (pendingCount >= cfg.maxPendingDrafts) {
    report.quotaStop = report.quotaStop || "pending_full";
  }

  const jobs = d
    .prepare(
      `SELECT url, platform, topic FROM url_jobs
       WHERE status IN ('queued','error')
       ORDER BY updated_at ASC LIMIT ?`,
    )
    .all(Math.max(maxNew * 3, 20)) as Array<{ url: string; platform: string; topic: string }>;

  for (const job of jobs) {
    if (report.quotaStop) break;
    if (report.created >= maxNew) break;

    const url = normalizeCollectorUrl(job.url);
    if (!url || !isAllowedHost(url, cfg)) {
      setJobStatus(job.url, job.platform, "skipped", "allowlist");
      report.skipped++;
      report.items.push({ url: job.url, action: "skipped", detail: "allowlist" });
      continue;
    }

    if (published.urls.has(url) || pendingUrls.has(url)) {
      setJobStatus(url, job.platform, "skipped", "dup");
      report.skipped++;
      report.items.push({ url, action: "skipped", detail: "already published or pending" });
      continue;
    }

    const platCount = published.byPlatform[job.platform] || 0;
    if (platCount >= cfg.maxPerPlatform) {
      setJobStatus(url, job.platform, "skipped", "platform_full");
      report.skipped++;
      report.items.push({ url, action: "skipped", detail: "platform quota" });
      continue;
    }

    if (pendingCount >= cfg.maxPendingDrafts) {
      report.quotaStop = "pending_full";
      break;
    }

    let html = readCache(url);
    if (!html && mode === "offline") {
      setJobStatus(url, job.platform, "error", "no cache (offline)");
      report.errors++;
      report.items.push({ url, action: "error", detail: "no cache offline" });
      continue;
    }

    if (!html && mode === "online") {
      const fetched = await fetchHtml(url, cfg);
      if (!fetched.ok) {
        setJobStatus(url, job.platform, "error", fetched.error);
        report.errors++;
        report.items.push({ url, action: "error", detail: fetched.error });
        continue;
      }
      html = fetched.html;
      writeCache(url, html, cfg);
    }

    if (!html) {
      setJobStatus(url, job.platform, "error", "no html");
      report.errors++;
      continue;
    }

    const hints = extractHintsFromHtml(html, cfg);
    const body_md = buildDraftBody({
      title: hints.title,
      summary: hints.summary,
      excerpt: hints.excerpt,
      url,
      platform: job.platform,
      cfg,
    });

    if (mode === "dry-run") {
      report.items.push({ url, action: "dry-run", detail: hints.title });
      report.skipped++;
      continue;
    }

    try {
      const sub = createKbSubmission({
        kind: "article",
        platform: job.platform,
        topic: job.topic || "parts",
        title: hints.title.slice(0, 160),
        summary: hints.summary,
        body_md,
        source_url: url,
        author_name: "collector",
      });
      tagKbSubmissionCollector(sub.id);
      setJobStatus(url, job.platform, "done");
      pendingUrls.add(url);
      pendingCount++;
      report.created++;
      report.items.push({ url, action: "draft", submissionId: sub.id, detail: hints.title });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "create failed";
      setJobStatus(url, job.platform, "error", msg);
      report.errors++;
      report.items.push({ url, action: "error", detail: msg });
    }
  }

  const finished = new Date().toISOString();
  d.prepare(`UPDATE runs SET finished_at=?, report_json=? WHERE id=?`).run(finished, JSON.stringify(report), runId);

  try {
    const reportsDir = resolve("data/reports");
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(
      join(reportsDir, "kb-collector-last.json"),
      JSON.stringify({ runId, ...report }, null, 2) + "\n",
    );
  } catch {
    /* ignore */
  }

  return report;
}
