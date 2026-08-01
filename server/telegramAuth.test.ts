import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  issueTelegramSession,
  resetTelegramAuthStore,
  telegramConfigured,
  validateTelegramInitData,
} from "./telegramAuth.js";

const saved = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  secret: process.env.TELEGRAM_SESSION_SECRET,
  path: process.env.TELEGRAM_AUTH_PATH,
};

function signedInitData(now: number, extra: Record<string, string> = {}) {
  const pairs = {
    auth_date: String(now),
    query_id: "AAH-test-query",
    user: JSON.stringify({ id: 123456, first_name: "Иван", username: "ivan" }),
    ...extra,
  };
  const dataCheckString = Object.entries(pairs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update("bot-token-test").digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...pairs, hash }).toString();
}

test("Telegram initData validates HMAC and expiry", () => {
  process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
  process.env.TELEGRAM_SESSION_SECRET = "session-secret-test";
  const now = 1_700_000_000;
  const raw = signedInitData(now);
  const ok = validateTelegramInitData(raw, now + 30);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.profile.firstName, "Иван");

  assert.equal(validateTelegramInitData(`${raw}x`, now + 30).ok, false);
  assert.equal(validateTelegramInitData(raw, now + 60 * 60 * 25).ok, false);
});

test("Telegram initData is one-time when creating a session", () => {
  const dir = mkdtempSync(join(tmpdir(), "telegram-auth-"));
  const now = Math.floor(Date.now() / 1000);
  process.env.TELEGRAM_BOT_TOKEN = "bot-token-test";
  process.env.TELEGRAM_SESSION_SECRET = "session-secret-test";
  process.env.TELEGRAM_AUTH_PATH = join(dir, "telegram.sqlite");
  resetTelegramAuthStore();

  const checked = validateTelegramInitData(signedInitData(now), now + 10);
  assert.equal(checked.ok, true);
  if (checked.ok) {
    assert.ok(issueTelegramSession(checked.profile, checked.initHash, checked.expiresAt));
    assert.equal(issueTelegramSession(checked.profile, checked.initHash, checked.expiresAt), null);
  }

  resetTelegramAuthStore();
  rmSync(dir, { recursive: true, force: true });
});

test("Telegram auth is disabled without both server secrets", () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_SESSION_SECRET;
  assert.equal(telegramConfigured(), false);
  process.env.TELEGRAM_BOT_TOKEN = saved.token;
  process.env.TELEGRAM_SESSION_SECRET = saved.secret;
  if (saved.path === undefined) delete process.env.TELEGRAM_AUTH_PATH;
  else process.env.TELEGRAM_AUTH_PATH = saved.path;
});
