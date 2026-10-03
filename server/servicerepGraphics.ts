/**
 * Local cache of ServiceRep illustrations from VIDA ImageRepository.
 * Files: data/servicerep-graphics/<graphicId>.{gif,png,...}
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());

export function servicerepGraphicsDir(): string {
  return resolve(process.env.SERVICEREP_GRAPHICS_DIR || join(ROOT, "data", "servicerep-graphics"));
}

const GRAPHIC_REF_RE =
  /([0-9a-f]{16})(?:_\d+_\d+)?(?:\.(?:gif|png|jpe?g|svg))?/i;

export function parseGraphicId(ref: string): string | null {
  const m = String(ref || "").trim().match(GRAPHIC_REF_RE);
  return m ? m[1].toLowerCase() : null;
}

export function findCachedGraphic(id: string): { path: string; mime: string } | null {
  const dir = servicerepGraphicsDir();
  const gid = id.toLowerCase();
  const mimeByExt: Record<string, string> = {
    ".gif": "image/gif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".bin": "application/octet-stream",
  };
  for (const [ext, mime] of Object.entries(mimeByExt)) {
    const p = join(dir, `${gid}${ext}`);
    if (existsSync(p) && statSync(p).size > 0) return { path: p, mime };
  }
  return null;
}

/** Rewrite import placeholders to img tags served by /api/service/graphic/:id */
export function rewriteServiceHtmlImages(html: string | null): string | null {
  if (!html) return html;
  return html.replace(/<p class="sr-missing-img">\[([^\]]+)\]<\/p>/gi, (_full, ref: string) => {
    const id = parseGraphicId(ref);
    if (!id) return _full;
    const alt = String(ref).replace(/"/g, "&quot;");
    return `<figure class="sr-fig"><img src="/api/service/graphic/${id}" alt="${alt}" loading="lazy"/></figure>`;
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

/** Ensure graphic is on disk (batching concurrent requests). */
export function ensureServiceGraphic(id: string): Promise<boolean> {
  const gid = id.toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(gid)) return Promise.resolve(false);
  if (findCachedGraphic(gid)) return Promise.resolve(true);
  return new Promise((resolvePromise, reject) => {
    const list = pending.get(gid) || [];
    list.push({ resolve: resolvePromise, reject });
    pending.set(gid, list);
    scheduleFlush();
  });
}

export function listCachedGraphicCount(): number {
  const dir = servicerepGraphicsDir();
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((n) => /\.(gif|png|jpe?g|svg|bin)$/i.test(n)).length;
  } catch {
    return 0;
  }
}
