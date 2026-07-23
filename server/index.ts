import express from "express";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import "dotenv/config";
import nodemailer from "nodemailer";
import { openDatabase } from "./db/schema.js";
import { createLocationRouter, createOverrideRouter, createSearchRouter } from "./routes/search.js";
import { createNavRouter } from "./routes/nav.js";
import { createEwdRouter } from "./routes/ewd.js";
import { resolveFilters } from "./vehicleMatrix.js";
import { decodeVolvoVin } from "./vinDecoder.js";

const app = express();
const isProd = process.env.NODE_ENV === "production";
const db = openDatabase(process.env.DATABASE_PATH);
const manualRoot = resolve(process.env.MANUAL_DIR ?? "E:\\manual");
const clientDist = resolve(process.env.CLIENT_DIST ?? "client/dist");

app.use(express.json());
app.use("/api/search", createSearchRouter(db));
app.use("/api/nav", createNavRouter(db));
app.use("/api/ewd", createEwdRouter());
app.use("/api/location", createLocationRouter(db));
app.use("/api/overrides", createOverrideRouter(db));
app.get("/api/health", (_req, res) => {
  const dbPath = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  const ewdData = resolve(process.env.EWD_DATA_DIR ?? "data/ewd");
  const ewdSource = resolve(
    process.env.EWD_SOURCE_DIR ?? resolve(ewdData, "ewd_source", "39363002", "1", "2"),
  );
  const pdfPath = resolve(manualRoot, "Электросхемы XC70.pdf");
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
  const ewdOk = existsSync(ewdSource);
  const pdfOk = existsSync(pdfPath);
  const hints: string[] = [];
  if (components === 0 || wires === 0) {
    hints.push("Empty SQLite. Restore data/wiring.sqlite from git (DEPLOY.md).");
  }
  if (!ewdOk) {
    hints.push("SVG source missing. Upload data/ewd/ewd_source to the server (DEPLOY.md §3).");
  }
  if (!pdfOk) {
    hints.push("PDF manual missing. Upload Электросхемы XC70.pdf into MANUAL_DIR (./manual).");
  }
  res.json({
    ok: !error && components > 0 && wires > 0,
    dbPath,
    dbExists: existsSync(dbPath),
    counts: { components, wires, pages },
    ewdSourceDir: ewdSource,
    ewdSourceExists: ewdOk,
    manualDir: manualRoot,
    pdfExists: pdfOk,
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

app.post("/api/tickets", async (req, res) => {
  const b = req.body as Record<string, string>;
  const required = ["model", "year", "engine", "location_name", "pin_number", "wire_color", "source_block", "destination_block", "description"];
  if (required.some((key) => !b[key]?.trim())) return res.status(400).json({ error: "Заполните обязательные поля заявки." });
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
      b.comment ?? null,
    ) as { id: number };
  const smtp = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  };
  if (Object.values(smtp).some((value) => !value)) {
    return res.status(500).json({
      error: "Заявка сохранена, но SMTP не настроен: заполните SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS и SMTP_FROM.",
      ticketId: ticket.id,
    });
  }
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port),
      secure: smtp.secure === "true",
      auth: { user: smtp.user, pass: smtp.pass },
    });
    await transport.sendMail({
      from: smtp.from,
      to: "elzidevelo@gmail.com",
      subject: `[Volvo Wiring] Новая заявка #${ticket.id}`,
      text: `Номер: #${ticket.id}\nАвтомобиль: ${b.model}, ${b.year}, ${b.engine}\nЛокация/пин: ${b.location_name} / ${b.pin_number}\n${b.source_block}:${b.source_pin ?? ""} -> ${b.destination_block}:${b.destination_pin ?? ""}\nФункция: ${b.description}\n\n📝 КОММЕНТАРИЙ ПОЛЬЗОВАТЕЛЯ: ${b.comment?.trim() || "Не указан"}`,
    });
  } catch (error) {
    console.error(`Ticket #${ticket.id} email delivery failed`, error);
    return res.status(502).json({ error: "Заявка сохранена, но письмо модератору не отправлено. Проверьте SMTP-настройки.", ticketId: ticket.id });
  }
  res.status(201).json({ success: true, ticketId: ticket.id });
});

app.get("/api/manual", (_req, res) => {
  const manual = (db.prepare("SELECT filename FROM manuals WHERE language = 'RU' LIMIT 1").get()
    || db.prepare("SELECT filename FROM manuals LIMIT 1").get()) as { filename?: string } | undefined;
  if (!manual?.filename) {
    return res.status(404).json({ error: "Руководство ещё не импортировано." });
  }
  const file = resolve(manualRoot, manual.filename);
  if (!existsSync(file)) {
    return res.status(404).json({ error: "Исходный PDF недоступен." });
  }
  return res.sendFile(file);
});

app.get("/api/pdf/view", (req, res) => {
  const bookId = Number(req.query.bookId);
  const page = Number(req.query.page);
  if (!Number.isInteger(bookId) || bookId < 1 || !Number.isInteger(page) || page < 1) {
    return res.status(400).json({ error: "bookId и page должны быть положительными числами." });
  }
  const manual = db.prepare("SELECT filename FROM manuals WHERE id = ?").get(bookId) as { filename?: string } | undefined;
  if (!manual?.filename) return res.status(404).json({ error: "Книга не найдена." });
  const file = resolve(manualRoot, manual.filename);
  if (relative(manualRoot, file).startsWith("..") || !existsSync(file)) {
    return res.status(404).json({ error: "PDF книги недоступен." });
  }
  return res.sendFile(file);
});

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
