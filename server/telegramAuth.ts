import Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";

const COOKIE = "ewd_telegram";
const SESSION_TTL_SEC = 60 * 60 * 12;
const DEFAULT_INIT_MAX_AGE_SEC = 60 * 60 * 24;
let store: Database.Database | null = null;

export type TelegramProfile = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
};

function env(name: "TELEGRAM_BOT_TOKEN" | "TELEGRAM_SESSION_SECRET"): string {
  return String(process.env[name] || "").trim().replace(/^(['"])(.*)\1$/, "$2").trim();
}

function maxInitAgeSec(): number {
  const configured = Number(process.env.TELEGRAM_INIT_MAX_AGE_SEC);
  return Number.isFinite(configured) && configured >= 60 && configured <= 7 * 24 * 60 * 60
    ? configured
    : DEFAULT_INIT_MAX_AGE_SEC;
}

export function telegramConfigured(): boolean {
  return Boolean(env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_SESSION_SECRET"));
}

function storePath() {
  return resolve(process.env.TELEGRAM_AUTH_PATH || "data/telegram.sqlite");
}

function authStore(): Database.Database {
  if (store) return store;
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  store = new Database(path);
  store.pragma("journal_mode = WAL");
  store.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      telegram_id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL DEFAULT '',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_init_uses (
      init_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_sessions (
      token_hash TEXT PRIMARY KEY,
      telegram_id INTEGER NOT NULL REFERENCES telegram_users(telegram_id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS telegram_sessions_expiry ON telegram_sessions(expires_at);
  `);
  return store;
}

export function resetTelegramAuthStore() {
  store?.close();
  store = null;
}

function constantTimeEqual(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function parseUser(raw: string | null): TelegramProfile | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const id = Number(value.id);
    const firstName = String(value.first_name || "").trim().slice(0, 128);
    const lastName = String(value.last_name || "").trim().slice(0, 128);
    const username = String(value.username || "").trim().replace(/^@/, "").slice(0, 64);
    if (!Number.isSafeInteger(id) || id < 1 || !firstName) return null;
    return { id, firstName, lastName: lastName || undefined, username: username || undefined };
  } catch {
    return null;
  }
}

export function validateTelegramInitData(initData: unknown, nowSec = Math.floor(Date.now() / 1000)):
  | { ok: true; profile: TelegramProfile; initHash: string; expiresAt: number }
  | { ok: false; error: string } {
  if (!telegramConfigured()) return { ok: false, error: "Telegram Mini App не настроен на сервере." };
  const raw = String(initData || "").trim();
  if (!raw || raw.length > 8192) return { ok: false, error: "Некорректные данные Telegram." };
  const params = new URLSearchParams(raw);
  const hash = String(params.get("hash") || "").toLowerCase();
  const authDate = Number(params.get("auth_date"));
  const profile = parseUser(params.get("user"));
  if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isSafeInteger(authDate) || !profile) {
    return { ok: false, error: "Некорректные данные Telegram." };
  }
  if (authDate > nowSec + 60 || nowSec - authDate > maxInitAgeSec()) {
    return { ok: false, error: "Данные Telegram устарели. Откройте приложение заново." };
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(env("TELEGRAM_BOT_TOKEN")).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!constantTimeEqual(hash, expected)) return { ok: false, error: "Подпись Telegram не прошла проверку." };

  return {
    ok: true,
    profile,
    initHash: createHash("sha256").update(raw).digest("hex"),
    expiresAt: authDate + maxInitAgeSec(),
  };
}

function readCookie(req: Request): string {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === COOKIE) return decodeURIComponent(value.join("="));
  }
  return "";
}

function tokenHash(token: string): string {
  return createHmac("sha256", env("TELEGRAM_SESSION_SECRET")).update(token).digest("hex");
}

function publicProfile(row: Record<string, unknown>): TelegramProfile {
  return {
    id: Number(row.telegram_id),
    firstName: String(row.first_name || ""),
    lastName: String(row.last_name || "") || undefined,
    username: String(row.username || "") || undefined,
  };
}

export function issueTelegramSession(profile: TelegramProfile, initHash: string, initExpiresAt: number): string | null {
  const now = Math.floor(Date.now() / 1000);
  if (!telegramConfigured() || initExpiresAt <= now) return null;
  const db = authStore();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_SEC;
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM telegram_init_uses WHERE expires_at <= ?").run(now);
      db.prepare("DELETE FROM telegram_sessions WHERE expires_at <= ?").run(now);
      // A signed initData payload can establish exactly one new session.
      db.prepare("INSERT INTO telegram_init_uses (init_hash, expires_at) VALUES (?, ?)").run(initHash, initExpiresAt);
      db.prepare(
        `INSERT INTO telegram_users (telegram_id, first_name, last_name, username, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(telegram_id) DO UPDATE SET
           first_name = excluded.first_name, last_name = excluded.last_name,
           username = excluded.username, last_seen_at = excluded.last_seen_at`,
      ).run(profile.id, profile.firstName, profile.lastName || "", profile.username || "", now, now);
      db.prepare("INSERT INTO telegram_sessions (token_hash, telegram_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .run(tokenHash(token), profile.id, expiresAt, now);
    })();
    return token;
  } catch {
    return null;
  }
}

export function telegramProfileForRequest(req: Request): TelegramProfile | null {
  const token = readCookie(req);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = authStore()
    .prepare(
      `SELECT u.telegram_id, u.first_name, u.last_name, u.username
       FROM telegram_sessions s JOIN telegram_users u ON u.telegram_id = s.telegram_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(tokenHash(token), now) as Record<string, unknown> | undefined;
  return row ? publicProfile(row) : null;
}

export function setTelegramSessionCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`,
  );
}

export function clearTelegramSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  const value = attempts.get(key);
  if (!value || value.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
    next();
    return;
  }
  value.count += 1;
  if (value.count > 12) {
    res.status(429).json({ error: "Слишком много попыток Telegram-входа. Повторите позже." });
    return;
  }
  next();
}

export function createTelegramAuthRouter() {
  const router = Router();
  router.get("/status", (_req, res) => res.json({ configured: telegramConfigured() }));
  router.post("/auth", rateLimit, (req, res) => {
    const checked = validateTelegramInitData(req.body?.initData);
    if (!checked.ok) {
      res.status(telegramConfigured() ? 401 : 503).json({ error: checked.error });
      return;
    }
    const token = issueTelegramSession(checked.profile, checked.initHash, checked.expiresAt);
    if (!token) {
      res.status(409).json({ error: "Данные Telegram уже использованы. Откройте приложение заново." });
      return;
    }
    setTelegramSessionCookie(res, token);
    res.json({ ok: true, profile: checked.profile });
  });
  router.get("/me", (req, res) => {
    const profile = telegramProfileForRequest(req);
    res.json({ authenticated: Boolean(profile), profile });
  });
  router.post("/logout", (req, res) => {
    const token = readCookie(req);
    if (token) authStore().prepare("DELETE FROM telegram_sessions WHERE token_hash = ?").run(tokenHash(token));
    clearTelegramSessionCookie(res);
    res.json({ ok: true });
  });
  return router;
}
