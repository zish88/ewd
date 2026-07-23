import nodemailer from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

/** Strip CR from Windows-edited .env values (docker --env-file keeps \\r and breaks auth). */
function envStr(raw: string | undefined): string {
  return String(raw || "").replace(/\r/g, "").trim();
}

/** Normalize Gmail App Password: strip spaces/hyphens Google shows in the UI. */
export function normalizeSmtpPass(raw: string | undefined): string {
  return envStr(raw).replace(/[\s-]/g, "");
}

export function readSmtpConfig(): SmtpConfig | null {
  const host = envStr(process.env.SMTP_HOST);
  const port = Number(envStr(process.env.SMTP_PORT) || 0);
  const user = envStr(process.env.SMTP_USER);
  const pass = normalizeSmtpPass(process.env.SMTP_PASS);
  const from = envStr(process.env.SMTP_FROM) || user;
  const secureRaw = envStr(process.env.SMTP_SECURE || "false").toLowerCase();
  const secure = secureRaw === "true" || secureRaw === "1";
  if (!host || !port || !user || !pass || !from) return null;
  return { host, port, secure, user, pass, from };
}

export function smtpConfigured(): boolean {
  return readSmtpConfig() != null;
}

/** Public/safe status — never includes password. */
export function smtpPublicStatus() {
  const cfg = readSmtpConfig();
  return {
    configured: Boolean(cfg),
    host: cfg?.host || "",
    port: cfg?.port || 0,
    secure: cfg?.secure ?? false,
    user: cfg?.user || "",
    from: cfg?.from || "",
    moderator: process.env.MODERATOR_EMAIL || "",
  };
}

export function createSmtpTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Gmail:587 needs STARTTLS; many VPS Docker stacks also break on IPv6 → force IPv4
    requireTLS: !cfg.secure && cfg.port === 587,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 25_000,
    tls: { minVersion: "TLSv1.2" },
    family: 4,
  });
}

export function formatSmtpError(error: unknown): string {
  const err = error as {
    code?: string;
    responseCode?: number;
    command?: string;
    message?: string;
    response?: string;
  };
  const parts = [
    err?.code,
    err?.responseCode ? `http=${err.responseCode}` : "",
    err?.command ? `cmd=${err.command}` : "",
    err?.response || err?.message || String(error),
  ].filter(Boolean);
  // Never echo credentials if somehow present in the message
  return parts
    .join(" · ")
    .replace(/(pass|password|auth)=[^\s]+/gi, "$1=***")
    .slice(0, 280);
}

export async function sendModeratorMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string; missing?: boolean }> {
  const cfg = readSmtpConfig();
  if (!cfg) {
    return { ok: false, missing: true, error: "SMTP не настроен (проверьте SMTP_* в .env контейнера)." };
  }
  try {
    const transport = createSmtpTransport(cfg);
    await transport.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatSmtpError(error) };
  }
}
