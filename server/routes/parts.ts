import { Router } from "express";
import { createReadStream } from "node:fs";
import { matchHarnessRepair, type RepairPart } from "../harnessRepairCatalog.js";
import { partImageUrl, resolvePartImageFile } from "../partImageIndex.js";

/**
 * Standalone harness repair catalog API.
 * GET /api/parts/repair?code=10/1&pin=3&gauge=0.5
 * GET /api/parts/image/:partNumber
 * GET /api/parts/card?code=&pin=&pn=
 */
export function createPartsRouter(): Router {
  const router = Router();

  router.get("/repair", (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) {
      res.status(400).json({ error: "Параметр code обязателен (например 74/507)" });
      return;
    }
    const pin = String(req.query.pin || "").trim() || undefined;
    const gauge = String(req.query.gauge || req.query.wire_gauge || "").trim() || undefined;
    const repair = matchHarnessRepair({ code, pin, gauge });
    res.json({
      ok: true,
      ...repair,
      note_ru:
        "Клеммы с меткой «кандидат» требуют сверки по корпусу/сечению. " +
        "9512669 — сервисный комплект инструмента, не партномер контакта.",
    });
  });

  router.get("/image/:partNumber", (req, res) => {
    const pn = String(req.params.partNumber || "").trim();
    const code = String(req.query.code || "").trim() || undefined;
    const hit = resolvePartImageFile(pn, code);
    if (!hit) {
      res.status(404).json({ ok: false, error: "Нет изображения в каталоге", part_number: pn, code: code || null });
      return;
    }
    res.setHeader("Content-Type", hit.mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (hit.hotspot_key) res.setHeader("X-Part-Hotspot", String(hit.hotspot_key));
    if (hit.wiring_code) res.setHeader("X-Part-Wiring-Code", String(hit.wiring_code));
    createReadStream(hit.absPath).pipe(res);
  });

  router.get("/card", (req, res) => {
    const code = String(req.query.code || "").trim();
    const pn = String(req.query.pn || req.query.part_number || "").trim();
    if (!code || !pn) {
      res.status(400).json({ error: "Нужны параметры code и pn" });
      return;
    }
    const pin = String(req.query.pin || "").trim() || undefined;
    const gauge = String(req.query.gauge || "").trim() || undefined;
    const repair = matchHarnessRepair({ code, pin, gauge });
    const pool = [
      repair.housing,
      repair.mate,
      repair.device,
      ...repair.terminals,
      ...repair.seals,
      ...repair.pigtails,
      ...repair.tools,
    ].filter(Boolean) as RepairPart[];
    const selected =
      pool.find((p) => p.part_number === pn) ||
      ({
        part_number: pn,
        role: "part",
        confidence: "unknown" as const,
        reason: "Партномер выбран вручную",
        image_url: partImageUrl(pn, code),
      } satisfies RepairPart);

    res.json({
      ok: true,
      code,
      pin: pin || null,
      selected,
      housing: repair.housing || null,
      mate: repair.mate || null,
      terminals: repair.terminals || [],
      image_url: partImageUrl(pn, code),
    });
  });

  return router;
}
