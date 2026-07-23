/** In-memory anti-spam for suggestion tickets + math challenge. */

import { createHmac, timingSafeEqual } from "node:crypto";

type Hit = { at: number; count: number };

const byIp = new Map<string, Hit>();
const byWire = new Map<string, number>(); // last submit timestamp
const recentHashes = new Map<string, number>();
const usedChallenges = new Map<string, number>();

const WINDOW_MS = 60_000;
const MAX_PER_IP_PER_MIN = 5;
const WIRE_COOLDOWN_MS = 120_000; // 2 min per card
const DUP_WINDOW_MS = 300_000; // 5 min identical payload
const CHALLENGE_TTL_MS = 10 * 60_000;

function challengeSecret(): string {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || process.env.SMTP_PASS || "ewd-ticket-dev";
}

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.socket?.remoteAddress || "unknown";
}

export function issueTicketChallenge(): { a: number; b: number; challenge: string } {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const body = `${a}.${b}.${exp}`;
  const sig = createHmac("sha256", challengeSecret()).update(`${body}:${a + b}`).digest("base64url");
  return { a, b, challenge: `${body}.${sig}` };
}

export function verifyTicketChallenge(challenge: string, answerRaw: string): string | null {
  const answer = Number(String(answerRaw || "").trim());
  if (!Number.isFinite(answer)) return "Решите пример для отправки заявки.";
  const parts = String(challenge || "").split(".");
  if (parts.length !== 4) return "Обновите форму и решите пример заново.";
  const [aS, bS, expS, sig] = parts;
  const a = Number(aS);
  const b = Number(bS);
  const exp = Number(expS);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(exp)) {
    return "Обновите форму и решите пример заново.";
  }
  if (Date.now() > exp) return "Время на проверку истекло. Обновите пример.";
  const body = `${a}.${b}.${exp}`;
  const expect = createHmac("sha256", challengeSecret()).update(`${body}:${a + b}`).digest("base64url");
  try {
    const x = Buffer.from(sig);
    const y = Buffer.from(expect);
    if (x.length !== y.length || !timingSafeEqual(x, y)) return "Неверный ответ на проверку.";
  } catch {
    return "Неверный ответ на проверку.";
  }
  if (answer !== a + b) return "Неверный ответ на проверку.";
  const usedAt = usedChallenges.get(challenge) || 0;
  if (usedAt) return "Этот код проверки уже использован. Обновите пример.";
  usedChallenges.set(challenge, Date.now());
  if (usedChallenges.size > 5000) usedChallenges.clear();
  return null;
}

export function checkTicketRateLimit(ip: string, wireId: string, payloadHash: string): string | null {
  const now = Date.now();

  // Cleanup occasionally
  if (byIp.size > 5000) byIp.clear();
  if (byWire.size > 5000) byWire.clear();
  if (recentHashes.size > 5000) recentHashes.clear();

  const hit = byIp.get(ip);
  if (!hit || now - hit.at > WINDOW_MS) {
    byIp.set(ip, { at: now, count: 1 });
  } else {
    hit.count += 1;
    if (hit.count > MAX_PER_IP_PER_MIN) {
      return "Слишком много заявок. Подождите минуту и попробуйте снова.";
    }
  }

  if (wireId) {
    const last = byWire.get(wireId) || 0;
    if (now - last < WIRE_COOLDOWN_MS) {
      const sec = Math.ceil((WIRE_COOLDOWN_MS - (now - last)) / 1000);
      return `По этой карточке уже есть недавняя заявка. Повтор через ${sec} с.`;
    }
  }

  const dupAt = recentHashes.get(payloadHash) || 0;
  if (now - dupAt < DUP_WINDOW_MS) {
    return "Такая же заявка уже отправлена недавно. Измените текст или подождите.";
  }

  return null;
}

export function markTicketAccepted(ip: string, wireId: string, payloadHash: string) {
  const now = Date.now();
  if (wireId) byWire.set(wireId, now);
  recentHashes.set(payloadHash, now);
  void ip;
}

/** Test helper */
export function _resetTicketGuardForTests() {
  byIp.clear();
  byWire.clear();
  recentHashes.clear();
  usedChallenges.clear();
}
