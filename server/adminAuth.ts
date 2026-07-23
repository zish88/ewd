import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "ewd_admin";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueAdminToken(): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const body = `admin:${exp}`;
  return `${body}.${sign(body)}`;
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token || !secret()) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expect = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const exp = Number(body.split(":")[1]);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

export function readAdminCookie(req: Request): string | undefined {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function isAdminRequest(req: Request): boolean {
  if (!adminConfigured()) return false;
  const hdr = String(req.headers["x-admin-token"] || "").trim();
  if (hdr && verifyAdminToken(hdr)) return true;
  return verifyAdminToken(readAdminCookie(req));
}

/** When ADMIN_PASSWORD is set, writes require admin. When unset, writes stay open (dev). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!adminConfigured()) {
    next();
    return;
  }
  if (isAdminRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Требуется вход администратора." });
}

export function setAdminCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`,
  );
}

export function clearAdminCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function checkAdminPassword(password: string): boolean {
  const want = process.env.ADMIN_PASSWORD || "";
  if (!want) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
