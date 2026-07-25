import { Router } from "express";
import type Database from "better-sqlite3";
import {
  adminConfigured,
  checkAdminPassword,
  clearAdminCookie,
  issueAdminToken,
  isAdminRequest,
  requireAdmin,
  setAdminCookie,
} from "../adminAuth.js";
import { readSiteSettings, writeSiteSettings, type SiteSettings } from "../siteSettings.js";
import { sendModeratorMail, smtpPublicStatus } from "../smtpMail.js";
import { getVisitStats } from "../visits.js";
import {
  applyAllCorrections,
  applyWirePatch,
  correctionsTodayCount,
  lastSyncRun,
  listCorrections,
  markCorrectionApplied,
  upsertCorrection,
  type WirePatch,
} from "../adminCorrections.js";

type TicketRow = {
  id: number;
  created_at: string;
  model: string;
  year: string;
  engine: string;
  location_name: string;
  pin_number: string;
  wire_color: string;
  source_block: string;
  source_pin: string | null;
  destination_block: string;
  destination_pin: string | null;
  description: string;
  comment: string | null;
  status: string;
  wire_id?: number | null;
  subject_code?: string | null;
  zone?: string | null;
  card_url?: string | null;
  resolved_at?: string | null;
  admin_note?: string | null;
};

function parseCardMeta(comment: string | null | undefined): {
  wire_id: number | null;
  subject_code: string;
  zone: string;
  card_url: string;
} {
  const text = String(comment || "");
  const wireMatch = text.match(/wire_id=(\d+)/i);
  const subjectMatch = text.match(/subject=([^;\n]+)/i);
  const zoneMatch = text.match(/zone=([^;\n]+)/i);
  const urlMatch = text.match(/url=(\S+)/i);
  return {
    wire_id: wireMatch ? Number(wireMatch[1]) : null,
    subject_code: subjectMatch ? subjectMatch[1].trim() : "",
    zone: zoneMatch ? zoneMatch[1].trim() : "",
    card_url: urlMatch ? urlMatch[1].trim() : "",
  };
}

function enrichTicket(row: TicketRow) {
  const meta = parseCardMeta(row.comment);
  const wire_id = Number(row.wire_id) || meta.wire_id;
  return {
    ...row,
    wire_id,
    subject_code: String(row.subject_code || meta.subject_code || row.location_name || "").trim(),
    zone: String(row.zone || meta.zone || "").trim(),
    card_url: String(row.card_url || meta.card_url || "").trim(),
    user_comment: String(row.comment || "")
      .replace(/\[CARD\][^\n]*/g, "")
      .trim(),
  };
}

function loadWire(db: Database.Database, wireId: number) {
  return db
    .prepare(
      `SELECT
         w.id, w.page_id, w.pin_number, w.wire_color_raw, w.wire_color_ru,
         w.function_text, w.from_detail, w.to_detail, w.from_token, w.to_token,
         w.subject_code, w.harness_left, w.harness_right, w.source_kind, w.is_verified,
         fc.component_code AS from_code,
         tc.component_code AS to_code
       FROM wire_connections w
       LEFT JOIN components fc ON fc.id = w.from_component_id
       LEFT JOIN components tc ON tc.id = w.to_component_id
       WHERE w.id = ?`,
    )
    .get(wireId) as Record<string, unknown> | undefined;
}

function patchFromBody(b: Record<string, unknown>): WirePatch {
  const str = (k: string) => (b[k] != null ? String(b[k]) : undefined);
  return {
    pin_number: str("pin_number"),
    wire_color_raw: str("wire_color_raw") ?? str("wire_color"),
    wire_color_ru: str("wire_color_ru"),
    function_text: str("function_text") ?? str("description"),
    from_detail: str("from_detail") ?? str("source_block"),
    to_detail: str("to_detail") ?? str("destination_block"),
    from_token: str("from_token") ?? str("from_code"),
    to_token: str("to_token") ?? str("to_code"),
    from_code: str("from_code"),
    to_code: str("to_code"),
    subject_code: str("subject_code"),
    harness_left: str("harness_left"),
    harness_right: str("harness_right"),
  };
}

export function createAdminRouter(db: Database.Database) {
  const router = Router();

  router.get("/visits", requireAdmin, (_req, res) => {
    res.json(getVisitStats(50));
  });

  router.get("/me", (req, res) => {
    const configured = adminConfigured();
    res.json({
      configured,
      admin: configured ? isAdminRequest(req) : true,
      // When password not set, everyone is treated as admin (local/dev).
    });
  });

  /** Safe SMTP probe (no password). Sends a short test mail to MODERATOR_EMAIL. */
  router.get("/smtp-status", requireAdmin, (_req, res) => {
    res.json(smtpPublicStatus());
  });

  router.post("/smtp-test", requireAdmin, async (_req, res) => {
    const to = process.env.MODERATOR_EMAIL || smtpPublicStatus().from;
    if (!to) {
      res.status(400).json({ ok: false, error: "MODERATOR_EMAIL не задан." });
      return;
    }
    const mail = await sendModeratorMail({
      to,
      subject: "[Volvo Wiring] SMTP test",
      text: `Тест SMTP с VPS · ${new Date().toISOString()}\nСтатус: ${JSON.stringify(smtpPublicStatus())}`,
    });
    if (!mail.ok) {
      res.status(502).json({ ok: false, error: mail.error, smtp: smtpPublicStatus() });
      return;
    }
    res.json({ ok: true, to, smtp: smtpPublicStatus() });
  });

  router.get("/settings", requireAdmin, (_req, res) => {
    res.json(readSiteSettings());
  });

  router.put("/settings", requireAdmin, (req, res) => {
    const body = req.body as Partial<SiteSettings>;
    const cur = readSiteSettings();
    const next = writeSiteSettings({
      siteOpen: body.siteOpen ?? cur.siteOpen,
      features: { ...cur.features, ...(body.features || {}) },
      appearance: body.appearance
        ? { ...cur.appearance, ...body.appearance, colors: { ...cur.appearance.colors, ...(body.appearance.colors || {}) } }
        : cur.appearance,
    });
    res.json(next);
  });

  router.post("/login", (req, res) => {
    if (!adminConfigured()) {
      res.status(400).json({ error: "ADMIN_PASSWORD не задан на сервере." });
      return;
    }
    const password = String((req.body as { password?: string })?.password || "");
    if (!checkAdminPassword(password)) {
      res.status(401).json({ error: "Неверный пароль." });
      return;
    }
    const token = issueAdminToken();
    setAdminCookie(res, token);
    res.json({ ok: true, token });
  });

  router.post("/logout", (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  router.get("/tickets", requireAdmin, (req, res) => {
    const status = String(req.query.status || "pending").trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows =
      status === "all"
        ? (db
            .prepare(`SELECT * FROM pending_tickets ORDER BY id DESC LIMIT ?`)
            .all(limit) as TicketRow[])
        : (db
            .prepare(`SELECT * FROM pending_tickets WHERE status=? ORDER BY id DESC LIMIT ?`)
            .all(status, limit) as TicketRow[]);
    const counts = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM pending_tickets GROUP BY status`,
      )
      .all() as Array<{ status: string; n: number }>;
    res.json({
      tickets: rows.map(enrichTicket),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  });

  router.get("/tickets/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const row = db.prepare(`SELECT * FROM pending_tickets WHERE id=?`).get(id) as TicketRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Заявка не найдена" });
      return;
    }
    const ticket = enrichTicket(row);
    const wire = ticket.wire_id ? loadWire(db, ticket.wire_id) : null;
    res.json({ ticket, wire: wire || null });
  });

  router.patch("/tickets/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const b = (req.body || {}) as { status?: string; admin_note?: string };
    const status = String(b.status || "").trim();
    if (!["pending", "approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "status: pending | approved | rejected" });
      return;
    }
    const note = String(b.admin_note ?? "");
    const info = db
      .prepare(
        `UPDATE pending_tickets
         SET status=?,
             admin_note=?,
             resolved_at=CASE WHEN ? IN ('approved','rejected') THEN datetime('now') ELSE NULL END
         WHERE id=?`,
      )
      .run(status, note, status, id);
    if (!info.changes) {
      res.status(404).json({ error: "Заявка не найдена" });
      return;
    }
    const row = db.prepare(`SELECT * FROM pending_tickets WHERE id=?`).get(id) as TicketRow;
    res.json({ ok: true, ticket: enrichTicket(row) });
  });

  router.get("/wires/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const wire = loadWire(db, id);
    if (!wire) {
      res.status(404).json({ error: "Провод не найден" });
      return;
    }
    res.json({ wire });
  });

  /** Update existing wire card; persist durable overlay; optionally close ticket. */
  router.put("/wires/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const b = (req.body || {}) as Record<string, unknown>;
    const patch = patchFromBody(b);
    if (!applyWirePatch(db, id, patch)) {
      res.status(404).json({ error: "Провод не найден" });
      return;
    }
    const ticketId = Number(b.ticket_id) || null;
    upsertCorrection({ wireId: id, ticketId, patch });
    markCorrectionApplied(id);

    if (ticketId) {
      db.prepare(
        `UPDATE pending_tickets
         SET status='approved',
             resolved_at=datetime('now'),
             admin_note=COALESCE(NULLIF(?, ''), admin_note),
             wire_id=COALESCE(wire_id, ?)
         WHERE id=?`,
      ).run(String(b.admin_note || ""), id, ticketId);
    }

    res.json({ ok: true, wire: loadWire(db, id), ticket_id: ticketId });
  });

  router.get("/corrections", requireAdmin, (_req, res) => {
    res.json({
      today: correctionsTodayCount(),
      lastSync: lastSyncRun(),
      items: listCorrections(50).map((c) => ({
        ...c,
        patch: (() => {
          try {
            return JSON.parse(c.payload);
          } catch {
            return null;
          }
        })(),
      })),
    });
  });

  router.post("/corrections/sync", requireAdmin, (_req, res) => {
    const result = applyAllCorrections(db, "manual-admin");
    res.json({ ok: true, ...result, lastSync: lastSyncRun() });
  });

  router.post("/components", requireAdmin, (req, res) => {
    const b = req.body as {
      component_code?: string;
      component_type_ru?: string;
      description_ru?: string;
      description_en?: string;
      name_ru?: string;
      part_number?: string;
    };
    const code = String(b.component_code || "").trim();
    if (!/^\d+\/\d+[A-Z]?$/i.test(code)) {
      res.status(400).json({ error: "component_code вида 3/129 или 74/507" });
      return;
    }
    try {
      const info = db
        .prepare(
          `INSERT INTO components(component_code, component_type_ru, description_ru, description_en, name_ru, part_number)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(component_code) DO UPDATE SET
             component_type_ru=excluded.component_type_ru,
             description_ru=excluded.description_ru,
             description_en=excluded.description_en,
             name_ru=excluded.name_ru,
             part_number=excluded.part_number`,
        )
        .run(
          code,
          String(b.component_type_ru || ""),
          String(b.description_ru || ""),
          String(b.description_en || ""),
          String(b.name_ru || ""),
          String(b.part_number || ""),
        );
      res.json({ ok: true, id: Number(info.lastInsertRowid), code });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.post("/wires", requireAdmin, (req, res) => {
    const b = req.body as Record<string, string | number | null | undefined>;
    const subject = String(b.subject_code || "").trim();
    const pin = String(b.pin_number || "").trim();
    if (!subject || !pin) {
      res.status(400).json({ error: "Нужны subject_code и pin_number" });
      return;
    }
    const pageId = Number(b.page_id) || 0;
    let usePageId = pageId;
    if (!usePageId) {
      const page = db
        .prepare(
          `SELECT id FROM pages WHERE page_type='connector' AND (
             system_name LIKE ? OR system_name LIKE ?
           ) ORDER BY id LIMIT 1`,
        )
        .get(`%${subject}%`, `Connector ${subject}%`) as { id?: number } | undefined;
      usePageId = Number(page?.id) || 0;
    }
    if (!usePageId) {
      const anyPage = db.prepare(`SELECT id FROM pages ORDER BY id LIMIT 1`).get() as { id?: number } | undefined;
      usePageId = Number(anyPage?.id) || 0;
    }
    if (!usePageId) {
      res.status(400).json({ error: "Нет страниц в БД — сначала восстановите wiring.sqlite" });
      return;
    }

    const ensureComp = (code: string) => {
      const c = String(code || "").trim();
      if (!c) return null;
      const row = db.prepare(`SELECT id FROM components WHERE component_code=?`).get(c) as { id?: number } | undefined;
      if (row?.id) return row.id;
      const info = db
        .prepare(
          `INSERT INTO components(component_code, component_type_ru, description_ru, description_en)
           VALUES (?, '', '', '')`,
        )
        .run(c);
      return Number(info.lastInsertRowid);
    };

    const fromCode = String(b.from_code || "").trim();
    const toCode = String(b.to_code || "").trim();
    const fromId = ensureComp(fromCode);
    const toId = ensureComp(toCode);

    const info = db
      .prepare(
        `INSERT INTO wire_connections(
          page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
          from_detail, to_detail, from_token, to_token, subject_code, source_kind,
          from_component_id, to_component_id,
          harness_left, harness_right, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, 1)`,
      )
      .run(
        usePageId,
        pin,
        String(b.wire_color_raw || "—"),
        String(b.wire_color_ru || "—"),
        String(b.function_text || ""),
        String(b.from_detail || (fromCode ? `${fromCode}` : "")),
        String(b.to_detail || (toCode ? `${toCode}` : "")),
        String(b.from_token || fromCode),
        String(b.to_token || toCode),
        subject,
        fromId,
        toId,
        String(b.harness_left || ""),
        String(b.harness_right || ""),
      );
    const newId = Number(info.lastInsertRowid);
    const patch = patchFromBody(b as Record<string, unknown>);
    upsertCorrection({ wireId: newId, patch: { ...patch, subject_code: subject, pin_number: pin } });
    markCorrectionApplied(newId);
    res.json({ ok: true, id: newId });
  });

  return router;
}
