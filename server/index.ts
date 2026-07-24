import express from "express";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import "dotenv/config";
import { openDatabase } from "./db/schema.js";
import { createLocationRouter, createOverrideRouter, createSearchRouter } from "./routes/search.js";
import { createNavRouter } from "./routes/nav.js";
import { createEwdRouter } from "./routes/ewd.js";
import { createEwdCapitalRouter } from "./routes/ewdCapital.js";
import { createAdminRouter } from "./routes/admin.js";
import { createDtcRouter } from "./routes/dtc.js";
import { dtcStats } from "./dtcDb.js";
import { isAdminRequest } from "./adminAuth.js";
import { publicSiteStatus, readSiteSettings } from "./siteSettings.js";
import { sendModeratorMail, smtpPublicStatus } from "./smtpMail.js";
import {
  checkTicketRateLimit,
  clientIp,
  issueTicketChallenge,
  markTicketAccepted,
  verifyTicketChallenge,
} from "./ticketGuard.js";
import { resolveFilters } from "./vehicleMatrix.js";
import { decodeVolvoVin } from "./vinDecoder.js";

const app = express();
const isProd = process.env.NODE_ENV === "production";
const db = openDatabase(process.env.DATABASE_PATH);
const clientDist = resolve(process.env.CLIENT_DIST ?? "client/dist");
const MODERATOR_EMAIL = process.env.MODERATOR_EMAIL || "elzidevelop@gmail.com";

app.use(express.json());

app.get("/api/site-status", (_req, res) => {
  res.json(publicSiteStatus());
});

app.use("/api/admin", createAdminRouter(db));

/** Block public API when site is closed (admins still pass). */
app.use("/api", (req, res, next) => {
  const path = req.path || "";
  if (
    path === "/health" ||
    path === "/site-status" ||
    path.startsWith("/admin")
  ) {
    next();
    return;
  }
  const settings = readSiteSettings();
  if (!settings.siteOpen && !isAdminRequest(req)) {
    res.status(503).json({ error: "Сайт временно закрыт администратором.", siteOpen: false });
    return;
  }
  // Feature flags (soft): specific endpoints
  if (!settings.features.vinSearch && path.startsWith("/vin")) {
    res.status(403).json({ error: "Поиск по VIN отключён." });
    return;
  }
  if (!settings.features.navBrowse && path.startsWith("/nav")) {
    res.status(403).json({ error: "Навигация по узлам отключена." });
    return;
  }
  if (!settings.features.ewdDiagrams && path.startsWith("/ewd")) {
    res.status(403).json({ error: "Схемы EWD отключены." });
    return;
  }
  if (!settings.features.suggestions && path === "/tickets" && req.method === "POST") {
    res.status(403).json({ error: "Предложения правок отключены." });
    return;
  }
  if (!settings.features.dtcSearch && path.startsWith("/dtc")) {
    res.status(403).json({ error: "Поиск DTC отключён." });
    return;
  }
  next();
});

app.use("/api/search", createSearchRouter(db));
app.use("/api/nav", createNavRouter(db));
app.use("/api/ewd", createEwdRouter());
app.use("/api/ewd", createEwdCapitalRouter());
app.use("/api/dtc", createDtcRouter());
app.use("/api/location", createLocationRouter(db));
app.use("/api/overrides", createOverrideRouter(db));
app.get("/api/health", (_req, res) => {
  const dbPath = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  const ewdData = resolve(process.env.EWD_DATA_DIR ?? "data/ewd");
  const ewdSource = resolve(
    process.env.EWD_SOURCE_DIR ?? resolve(ewdData, "ewd_source", "39363002", "1", "2"),
  );
  let components = 0;
  let wires = 0;
  let pages = 0;
  let error: string | undefined;
  try {
    components = Number((db.prepare("SELECT COUNT(*) AS n FROM components").get() as { n: number }).n);
    wires = Number((db.prepare("SELECT COUNT(*) AS n FROM wire_connections").get() as { n: number }).n);
    pages = Number((db.prepare("SELECT COUNT(*) AS n FROM pages").get() as { n: number }).n);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ewdOk =
    existsSync(join(ewdSource, "index.xml")) &&
    existsSync(join(ewdSource, "Signals")) &&
    existsSync(join(ewdData, "face_view_index.json"));
  const hints: string[] = [];
  if (components === 0 || wires === 0) {
    hints.push("Empty SQLite. Restore data/wiring.sqlite from git (DEPLOY.md).");
  }
  if (!ewdOk) {
    hints.push(
      "Capital EWD missing. Need data/ewd/ewd_source/39363002/1/2 (index.xml, Signals) and face_view_index.json.",
    );
  }
  const dtc = dtcStats();
  if (!dtc.available) {
    hints.push("DTC dictionary missing. Restore data/dtc.sqlite from git.");
  }
  res.json({
    ok: !error && components > 0 && wires > 0 && ewdOk,
    dbPath,
    dbExists: existsSync(dbPath),
    counts: { components, wires, pages },
    dtc,
    ewdSourceDir: ewdSource,
    ewdSourceExists: ewdOk,
    faceViewIndex: existsSync(join(ewdData, "face_view_index.json")),
    capitalOnly: true,
    error,
    hint: hints.length ? hints.join(" ") : undefined,
  });
});

app.get("/api/filters", (req, res) => {
  const model = String(req.query.model ?? "");
  const year = String(req.query.year ?? "");
  const engine = String(req.query.engine ?? "");
  const transmission = String(req.query.transmission ?? req.query.kpp ?? "");
  const resolved = resolveFilters({ model, year, engine, transmission });
  const manuals = db.prepare("SELECT id, filename, language FROM manuals ORDER BY language ASC").all() as Array<{
    id: number;
    filename: string;
    language: string;
  }>;
  res.json({
    models: resolved.models,
    years: resolved.years,
    engines: resolved.engines,
    transmissions: resolved.transmissions,
    selection: resolved.selection,
    optionTokens: resolved.optionTokens,
    ewdPackageHint: resolved.ewdPackageHint,
    manuals,
  });
});

app.get("/api/vin/decode", (req, res) => {
  const vin = String(req.query.vin ?? req.query.q ?? "");
  const result = decodeVolvoVin(vin);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/api/vin/decode", (req, res) => {
  const vin = String((req.body as { vin?: string })?.vin ?? "");
  const result = decodeVolvoVin(vin);
  res.status(result.ok ? 200 : 400).json(result);
});

app.get("/api/tickets/challenge", (_req, res) => {
  res.json(issueTicketChallenge());
});

app.post("/api/tickets", async (req, res) => {
  const b = req.body as Record<string, string>;
  // Honeypot: bots fill hidden field
  if (String(b.website || b.company || "").trim()) {
    return res.status(201).json({ success: true, ticketId: 0, emailSent: false, ignored: true });
  }
  const required = ["model", "year", "engine", "location_name", "pin_number", "wire_color", "source_block", "destination_block", "description"];
  if (required.some((key) => !b[key]?.trim())) return res.status(400).json({ error: "Заполните обязательные поля заявки." });
  const challengeErr = verifyTicketChallenge(String(b.challenge || ""), String(b.challenge_answer || ""));
  if (challengeErr) return res.status(400).json({ error: challengeErr });
  const cardUrl = String(b.card_url || "").trim();
  const wireId = String(b.wire_id || b.card_id || "").trim();
  const subjectCode = String(b.subject_code || "").trim();
  const zone = String(b.zone || "").trim();
  const ip = clientIp(req);
  const payloadHash = createHash("sha256")
    .update(
      [wireId, subjectCode, b.pin_number, b.wire_color, b.source_block, b.destination_block, b.description, b.comment || ""].join("|"),
    )
    .digest("hex");
  const rateErr = checkTicketRateLimit(ip, wireId, payloadHash);
  if (rateErr) return res.status(429).json({ error: rateErr });

  const meta = [
    wireId ? `wire_id=${wireId}` : "",
    subjectCode ? `subject=${subjectCode}` : "",
    zone ? `zone=${zone}` : "",
    cardUrl ? `url=${cardUrl}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const commentWithMeta = [b.comment?.trim() || "", meta ? `[CARD] ${meta}` : ""].filter(Boolean).join("\n");
  const ticket = db
    .prepare(
      `INSERT INTO pending_tickets(model,year,engine,location_name,pin_number,wire_color,source_block,source_pin,destination_block,destination_pin,description,comment)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    )
    .get(
      b.model,
      b.year,
      b.engine,
      b.location_name,
      b.pin_number,
      b.wire_color,
      b.source_block,
      b.source_pin ?? "",
      b.destination_block,
      b.destination_pin ?? "",
      b.description,
      commentWithMeta || null,
    ) as { id: number };

  markTicketAccepted(ip, wireId, payloadHash);

  let emailSent = false;
  let emailWarning: string | undefined;
  const mail = await sendModeratorMail({
    to: MODERATOR_EMAIL,
    subject: `[Volvo Wiring] Заявка #${ticket.id}${subjectCode ? ` · ${subjectCode}` : ""}${wireId ? ` · wire#${wireId}` : ""}`,
    text: [
      `Номер заявки: #${ticket.id}`,
      `Автомобиль: ${b.model}, ${b.year}, ${b.engine}`,
      `Зона: ${zone || "—"}`,
      `Узел (subject): ${subjectCode || b.location_name}`,
      `ID карточки/провода: ${wireId || "—"}`,
      `Пин: ${b.pin_number} · цвет: ${b.wire_color}`,
      `Откуда: ${b.source_block}:${b.source_pin ?? ""}`,
      `Куда: ${b.destination_block}:${b.destination_pin ?? ""}`,
      `Описание: ${b.description}`,
      `Комментарий: ${b.comment?.trim() || "Не указан"}`,
      "",
      "Ссылка на карточку (откройте в браузере):",
      cardUrl || "(не передана)",
    ].join("\n"),
  });
  if (mail.ok) {
    emailSent = true;
  } else {
    console.error(`Ticket #${ticket.id} email delivery failed:`, mail.error);
    emailWarning = mail.missing
      ? "SMTP не настроен на сервере — заявка сохранена в БД, письмо не отправлено."
      : `Заявка сохранена, но письмо модератору не удалось отправить. (${mail.error})`;
  }
  // Always 201 once ticket is stored — client must close modal (no spam via OK retry)
  res.status(201).json({
    success: true,
    ticketId: ticket.id,
    emailSent,
    warning: emailWarning,
    smtp: smtpPublicStatus(),
  });
});

// PDF pinout removed — Capital FaceViews / reports replace manuals.

// Production: serve Vite build + SPA fallback (API routes registered above)
if (isProd || existsSync(resolve(clientDist, "index.html"))) {
  app.use(express.static(clientDist, { index: false, maxAge: isProd ? "1h" : 0 }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    const indexHtml = resolve(clientDist, "index.html");
    if (!existsSync(indexHtml)) {
      return res.status(503).type("text").send("Client build missing. Run npm run build.");
    }
    return res.sendFile(indexHtml);
  });
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`XC70 wiring guide: http://localhost:${port}`);
  console.log(`  NODE_ENV=${process.env.NODE_ENV ?? "development"}`);
  console.log(`  DATABASE_PATH=${process.env.DATABASE_PATH ?? "data/wiring.sqlite"}`);
  console.log(`  EWD_DATA_DIR=${process.env.EWD_DATA_DIR ?? "data/ewd"}`);
  console.log(`  CLIENT_DIST=${clientDist}`);
});
