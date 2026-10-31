/**
 * Local cache of ServiceRep illustrations from VIDA ImageRepository.
 * Files: data/servicerep-graphics/<graphicId>.{gif,png,...}
 * Portable DB: data/servicerep-graphics.sqlite (for VPS without LocalDB/MDF)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const ROOT = resolve(process.cwd());

export function servicerepGraphicsDir(): string {
  return resolve(process.env.SERVICEREP_GRAPHICS_DIR || join(ROOT, "data", "servicerep-graphics"));
}

export function servicerepGraphicsDbPath(): string {
  return resolve(
    process.env.SERVICEREP_GRAPHICS_DB || join(ROOT, "data", "servicerep-graphics.sqlite"),
  );
}

const HEX_GRAPHIC_RE =
  /(?:^|[\\/])([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?$/i;
const NAMED_GRAPHIC_RE =
  /(?:^|[\\/])((?:IMG|GR)-\d+)(?:\.(?:gif|png|jpe?g|svg|cgm))?$/i;

/** Hex ImageRepo id or VIDA file stem (IMG-227782 / GR-366703). */
export function parseGraphicId(ref: string): string | null {
  const s = String(ref || "").trim();
  if (!s) return null;
  const hex = s.match(HEX_GRAPHIC_RE) || s.match(/^([0-9a-f]{16})$/i);
  if (hex) return hex[1].toLowerCase();
  const named = s.match(NAMED_GRAPHIC_RE);
  if (!named) return null;
  let id = named[1].toUpperCase().replace(/_/g, "-");
  if (id.startsWith("IMG") && !id.startsWith("IMG-")) id = `IMG-${id.slice(3)}`;
  if (id.startsWith("GR") && !id.startsWith("GR-")) id = `GR-${id.slice(2)}`;
  return id;
}

function cacheKeys(id: string): string[] {
  const keys = [id];
  if (id !== id.toLowerCase()) keys.push(id.toLowerCase());
  if (id !== id.toUpperCase()) keys.push(id.toUpperCase());
  return [...new Set(keys)];
}

export type GraphicHit =
  | { kind: "file"; path: string; mime: string }
  | { kind: "buffer"; bytes: Buffer; mime: string };

let graphicsDb: Database.Database | null = null;
let graphicsDbPathOpened = "";
let graphicsDbMtimeMs = 0;

function openGraphicsDb(): Database.Database | null {
  const path = servicerepGraphicsDbPath();
  if (!existsSync(path)) {
    if (graphicsDb) {
      try {
        graphicsDb.close();
      } catch {
        /* ignore */
      }
      graphicsDb = null;
      graphicsDbPathOpened = "";
      graphicsDbMtimeMs = 0;
    }
    return null;
  }
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    /* ignore */
  }
  if (graphicsDb && graphicsDbPathOpened === path && mtimeMs === graphicsDbMtimeMs) {
    return graphicsDb;
  }
  if (graphicsDb) {
    try {
      graphicsDb.close();
    } catch {
      /* ignore */
    }
  }
  try {
    graphicsDb = new Database(path, { readonly: true, fileMustExist: true });
    graphicsDb.pragma("query_only = ON");
    graphicsDbPathOpened = path;
    graphicsDbMtimeMs = mtimeMs;
    return graphicsDb;
  } catch {
    graphicsDb = null;
    return null;
  }
}

function findFileGraphic(id: string): GraphicHit | null {
  const dir = servicerepGraphicsDir();
  const mimeByExt: Record<string, string> = {
    ".gif": "image/gif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".bin": "application/octet-stream",
  };
  for (const gid of cacheKeys(id)) {
    for (const [ext, mime] of Object.entries(mimeByExt)) {
      const p = join(dir, `${gid}${ext}`);
      if (existsSync(p) && statSync(p).size > 0) return { kind: "file", path: p, mime };
    }
  }
  return null;
}

function findDbGraphic(id: string): GraphicHit | null {
  const d = openGraphicsDb();
  if (!d) return null;
  try {
    let row: { mime: string; bytes: Buffer } | undefined;
    for (const key of cacheKeys(id)) {
      row = d
        .prepare(`SELECT mime, bytes FROM graphics WHERE id=? LIMIT 1`)
        .get(key) as { mime: string; bytes: Buffer } | undefined;
      if (row?.bytes?.length) break;
    }
    if (!row?.bytes?.length) return null;
    return { kind: "buffer", bytes: Buffer.from(row.bytes), mime: row.mime || "image/gif" };
  } catch {
    return null;
  }
}

export function findCachedGraphic(id: string): GraphicHit | null {
  return findFileGraphic(id) || findDbGraphic(id);
}

/** Rewrite import placeholders to img tags served by /api/service/graphic/:id */
export function rewriteServiceHtmlImages(html: string | null): string | null {
  if (!html) return html;
  return html.replace(/<p class="sr-missing-img">\[?([^\]<]+)\]?<\/p>/gi, (_full, ref: string) => {
    const gid = parseGraphicId(ref);
    if (!gid) {
      return `<p class="sr-missing-img">иллюстрация недоступна</p>`;
    }
    const alt = String(gid).replace(/"/g, "&quot;");
    return `<figure class="sr-fig"><img src="/api/service/graphic/${gid}" alt="${alt}" loading="lazy"/></figure>`;
  });
}

type Waiter = {
  resolve: (ok: boolean) => void;
  reject: (e: Error) => void;
};

const pending = new Map<string, Waiter[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, 80);
}

async function flushPending(): Promise<void> {
  if (flushing) {
    scheduleFlush();
    return;
  }
  const ids = [...pending.keys()].filter((id) => !findCachedGraphic(id));
  if (!ids.length) {
    for (const [id, waiters] of pending) {
      const ok = Boolean(findCachedGraphic(id));
      for (const w of waiters) w.resolve(ok);
    }
    pending.clear();
    return;
  }
  flushing = true;
  try {
    await runFetchScript(ids);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    for (const id of ids) {
      const waiters = pending.get(id) || [];
      for (const w of waiters) w.reject(err);
      pending.delete(id);
    }
  } finally {
    flushing = false;
  }
  for (const id of [...pending.keys()]) {
    if (!ids.includes(id) && !findCachedGraphic(id)) continue;
    const waiters = pending.get(id) || [];
    const ok = Boolean(findCachedGraphic(id));
    for (const w of waiters) w.resolve(ok);
    pending.delete(id);
  }
  if (pending.size) scheduleFlush();
}

function runFetchScript(ids: string[]): Promise<void> {
  const script = join(ROOT, "scripts", "servicerep_fetch_graphic.py");
  const outDir = servicerepGraphicsDir();
  mkdirSync(outDir, { recursive: true });
  const py = process.env.PYTHON || "python";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(py, [script, "--ids", ids.join(","), "--out-dir", outDir], {
      cwd: ROOT,
      windowsHide: true,
    });
    let err = "";
    child.stderr.on("data", (b) => {
      err += String(b);
    });
    child.stdout.on("data", () => {
      /* progress logged by script */
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || code === 2) resolvePromise();
      else reject(new Error(err.trim() || `servicerep_fetch_graphic exit ${code}`));
    });
  });
}

/** Ensure graphic is on disk (batching concurrent requests). Skips if already in file/DB cache. */
export function ensureServiceGraphic(id: string): Promise<boolean> {
  const gid = parseGraphicId(id);
  if (!gid) return Promise.resolve(false);
  if (findCachedGraphic(gid)) return Promise.resolve(true);
  // On VPS there is usually no ImageRepository MDF — don't spawn doomed Python.
  if (!existsSync(join(ROOT, "scripts", "servicerep_fetch_graphic.py"))) {
    return Promise.resolve(false);
  }
  const mdf =
    process.env.VIDA_IMAGE_MDF ||
    (existsSync("E:\\manual\\imagerepository_Data.MDF") ? "E:\\manual\\imagerepository_Data.MDF" : "");
  if (!mdf || !existsSync(mdf)) {
    return Promise.resolve(false);
  }
  return new Promise((resolvePromise, reject) => {
    const list = pending.get(gid) || [];
    list.push({ resolve: resolvePromise, reject });
    pending.set(gid, list);
    scheduleFlush();
  });
}

export function listCachedGraphicCount(): number {
  let n = 0;
  const dir = servicerepGraphicsDir();
  if (existsSync(dir)) {
    try {
      n += readdirSync(dir).filter((name) => /\.(gif|png|jpe?g|svg|bin)$/i.test(name)).length;
    } catch {
      /* ignore */
    }
  }
  const d = openGraphicsDb();
  if (d) {
    try {
      n += Number(d.prepare(`SELECT COUNT(*) AS c FROM graphics`).get()?.c || 0);
    } catch {
      /* ignore */
    }
  }
  return n;
}
