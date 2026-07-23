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

export function createAdminRouter(db: Database.Database) {
  const router = Router();

  router.get("/me", (req, res) => {
    const configured = adminConfigured();
    res.json({
      configured,
      admin: configured ? isAdminRequest(req) : true,
      // When password not set, everyone is treated as admin (local/dev).
    });
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
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  return router;
}
