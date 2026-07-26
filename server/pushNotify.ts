import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import webpush from "web-push";

export type PushSubscriptionKeys = {
  p256dh: string;
  auth: string;
};

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
};

export type DeployNotes = {
  version?: string;
  git?: string;
  items?: string[];
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  /** Keep banner visible until user interacts (useful for admin test). */
  requireInteraction?: boolean;
};

let pushDb: Database.Database | null = null;
let pushDbOpenedPath = "";
let vapidReady = false;

function pushDbPath(): string {
  if (process.env.PUSH_DATABASE_PATH) return resolve(process.env.PUSH_DATABASE_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "push.sqlite");
}

function lastNotifiedPath(): string {
  if (process.env.PUSH_LAST_NOTIFIED_PATH) return resolve(process.env.PUSH_LAST_NOTIFIED_PATH);
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "push-last-notified.json");
}

function openPushDb(): Database.Database {
  const path = pushDbPath();
  if (pushDb && pushDbOpenedPath === path) return pushDb;
  if (pushDb) {
    try {
      pushDb.close();
    } catch {
      /* ignore */
    }
    pushDb = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  pushDb = db;
  pushDbOpenedPath = path;
  return db;
}

export function ensurePushStore(): void {
  openPushDb();
  configureVapid();
}

export function vapidPublicKey(): string | null {
  const k = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  return k || null;
}

function vapidPrivateKey(): string | null {
  const k = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  return k || null;
}

function vapidSubject(): string {
  const s = String(process.env.VAPID_SUBJECT || "").trim();
  if (s) return s;
  const mail = String(process.env.MODERATOR_EMAIL || "").trim();
  return mail ? `mailto:${mail}` : "mailto:admin@localhost";
}

export function configureVapid(): boolean {
  const pub = vapidPublicKey();
  const priv = vapidPrivateKey();
  if (!pub || !priv) {
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(vapidSubject(), pub, priv);
    vapidReady = true;
    return true;
  } catch (e) {
    console.error("[push] VAPID configure failed:", e);
    vapidReady = false;
    return false;
  }
}

export function isPushConfigured(): boolean {
  return vapidReady || configureVapid();
}

export function subscriptionCount(): number {
  const db = openPushDb();
  return Number((db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n);
}

export function saveSubscription(sub: {
  endpoint: string;
  keys: PushSubscriptionKeys;
}): { ok: true } | { ok: false; error: string } {
  const endpoint = String(sub.endpoint || "").trim();
  const p256dh = String(sub.keys?.p256dh || "").trim();
  const auth = String(sub.keys?.auth || "").trim();
  if (!endpoint.startsWith("https://") || endpoint.length > 2048) {
    return { ok: false, error: "Некорректный endpoint" };
  }
  if (!p256dh || !auth || p256dh.length > 256 || auth.length > 256) {
    return { ok: false, error: "Некорректные ключи подписки" };
  }
  const db = openPushDb();
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(endpoint, p256dh, auth);
  return { ok: true };
}

export function removeSubscription(endpoint: string): boolean {
  const ep = String(endpoint || "").trim();
  if (!ep) return false;
  const db = openPushDb();
  const r = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(ep);
  return r.changes > 0;
}

function listSubscriptions(): PushSubscriptionRow[] {
  const db = openPushDb();
  return db
    .prepare("SELECT endpoint, p256dh, auth, created_at FROM push_subscriptions")
    .all() as PushSubscriptionRow[];
}

function pruneEndpoint(endpoint: string) {
  try {
    openPushDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  } catch {
    /* ignore */
  }
}

export type PushSendError = {
  status: number;
  message: string;
  endpointHost?: string;
};

function pushErrorDetails(e: unknown): PushSendError {
  const err = e as { statusCode?: number; body?: string; message?: string };
  const status = Number(err.statusCode || 0);
  let message = String(err.message || e || "unknown");
  const body = String(err.body || "").trim();
  if (body) message = body.slice(0, 240);
  let endpointHost: string | undefined;
  try {
    // web-push sometimes embeds endpoint in message
    const m = message.match(/https:\/\/[^\s"']+/);
    if (m) endpointHost = new URL(m[0]).host;
  } catch {
    /* ignore */
  }
  return { status, message, endpointHost };
}

function shouldPrunePushStatus(status: number): boolean {
  // Gone / not found, or VAPID/auth mismatch after key rotation — drop stale row.
  return status === 404 || status === 410 || status === 401 || status === 403;
}

export function pushFailureHint(errors: PushSendError[]): string {
  const statuses = new Set(errors.map((e) => e.status).filter(Boolean));
  if (statuses.has(401) || statuses.has(403)) {
    return "Подписка не совпадает с VAPID-ключами сервера. На сайте выключите и снова включите «Уведомления», затем повторите тест.";
  }
  if (statuses.has(404) || statuses.has(410)) {
    return "Подписка протухла и удалена. Подпишитесь заново на сайте.";
  }
  if (errors.length) {
    return `Ошибка push: ${errors[0].status || "?"} ${errors[0].message}`;
  }
  return "Отправка не удалась.";
}

export async function broadcastPush(payload: PushPayload): Promise<{
  sent: number;
  failed: number;
  pruned: number;
  errors: PushSendError[];
}> {
  if (!isPushConfigured()) {
    return { sent: 0, failed: 0, pruned: 0, errors: [] };
  }
  const body = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 400),
    url: payload.url || "/",
    requireInteraction: Boolean(payload.requireInteraction),
  });
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const errors: PushSendError[] = [];
  for (const row of listSubscriptions()) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        body,
        { TTL: 60 * 60 * 12, urgency: "normal" },
      );
      sent += 1;
    } catch (e) {
      failed += 1;
      const details = pushErrorDetails(e);
      try {
        details.endpointHost = new URL(row.endpoint).host;
      } catch {
        /* ignore */
      }
      errors.push(details);
      if (shouldPrunePushStatus(details.status)) {
        pruneEndpoint(row.endpoint);
        pruned += 1;
      }
      console.warn(
        "[push] send failed:",
        details.status || details.message,
        details.endpointHost || "",
      );
    }
  }
  return { sent, failed, pruned, errors };
}

function deployNotesCandidates(): string[] {
  const roots = [
    resolve(process.env.CLIENT_DIST ?? "client/dist"),
    resolve("client/public"),
    resolve("client/dist"),
  ];
  return roots.map((r) => join(r, "deploy-notes.json"));
}

export function readDeployNotes(): DeployNotes | null {
  for (const p of deployNotesCandidates()) {
    if (!existsSync(p)) continue;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as DeployNotes;
    } catch {
      /* try next */
    }
  }
  return null;
}

function isPublicPushItem(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return false;
  if (/\badmin\b/i.test(t) || /админк/i.test(t)) return false;
  if (/\bvapid\b/i.test(t) || /\.env\b/i.test(t)) return false;
  if (/только в админке/i.test(t) || /скрипт на vps/i.test(t)) return false;
  return true;
}

export function buildDeployPushPayload(notes: DeployNotes | null): PushPayload {
  const items = (Array.isArray(notes?.items) ? notes!.items! : [])
    .map((x) => String(x || "").trim())
    .filter(isPublicPushItem)
    .slice(0, 3);
  const body = items.length
    ? items.map((it) => `• ${it}`).join("\n").slice(0, 400)
    : "Доступна новая версия справочника.";
  const ver = String(notes?.version || "").trim();
  const title = ver ? `Сайт обновлён · ${ver}` : "Сайт обновлён";
  return { title, body, url: "/" };
}

type LastNotified = { git: string; notifiedAt?: string; version?: string };

function readLastNotified(): LastNotified | null {
  const p = lastNotifiedPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LastNotified;
  } catch {
    return null;
  }
}

function writeLastNotified(notes: DeployNotes) {
  const p = lastNotifiedPath();
  mkdirSync(dirname(p), { recursive: true });
  const data: LastNotified = {
    git: String(notes.git || "").trim(),
    version: String(notes.version || "").trim() || undefined,
    notifiedAt: new Date().toISOString(),
  };
  writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * After container start: if deploy-notes git SHA changed vs last notify, broadcast.
 * First run (no last-notified file) only records SHA — no spam on feature enable.
 */
export async function maybeNotifyDeployUpdate(): Promise<void> {
  if (!isPushConfigured()) {
    console.info("[push] skip deploy notify: VAPID not configured");
    return;
  }
  const notes = readDeployNotes();
  const git = String(notes?.git || "").trim();
  if (!git) {
    console.info("[push] skip deploy notify: no deploy-notes git");
    return;
  }
  const prev = readLastNotified();
  if (!prev?.git) {
    writeLastNotified(notes || { git });
    console.info(`[push] bootstrap last-notified git=${git} (no broadcast)`);
    return;
  }
  if (prev.git === git) {
    console.info(`[push] deploy git unchanged (${git})`);
    return;
  }
  const n = subscriptionCount();
  if (n < 1) {
    writeLastNotified(notes || { git });
    console.info(`[push] git changed ${prev.git}→${git}, but 0 subscribers`);
    return;
  }
  const payload = buildDeployPushPayload(notes);
  const result = await broadcastPush(payload);
  writeLastNotified(notes || { git });
  console.info(
    `[push] deploy notify ${prev.git}→${git}: sent=${result.sent} failed=${result.failed} pruned=${result.pruned}`,
  );
}
