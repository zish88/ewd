import { Router } from "express";
import {
  fgDisplayTitle,
  getPartsStatus,
  listPartsFilters,
  listPartsPlates,
  listPartsTree,
  plateDisplayTitle,
} from "../partsDb.js";

/**
 * VIDA EPC parts catalog (FG tree + plates). Separate from /api/parts (wiring PN).
 */
export function createPartsCatalogRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json({ ok: true, ...getPartsStatus() });
  });

  router.get("/filters", (_req, res) => {
    if (!getPartsStatus().available) {
      res.status(503).json({ ok: false, error: "parts_db_missing" });
      return;
    }
    res.json({ ok: true, ...listPartsFilters() });
  });

  router.get("/tree", (req, res) => {
    if (!getPartsStatus().available) {
      res.status(503).json({ ok: false, error: "parts_db_missing" });
      return;
    }
    const model = typeof req.query.model === "string" ? req.query.model : "";
    const year = typeof req.query.year === "string" ? req.query.year : "";
    let parent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";
    if (parent && !parent.startsWith("/")) parent = `/${parent}`;
    const lang = req.query.lang === "en" ? "en" : "ru";
    const nodes = listPartsTree({ model, year, parent });
    res.json({
      ok: true,
      parent: parent || null,
      nodes: nodes.map((n) => ({
        id: n.id,
        path: n.path,
        label: n.label,
        parentPath: n.parentPath,
        depth: n.depth,
        title: fgDisplayTitle(n, lang),
        titleRu: n.titleRu,
        titleEn: n.titleEn,
        plateCount: n.plateCount ?? null,
      })),
    });
  });

  router.get("/plates", (req, res) => {
    if (!getPartsStatus().available) {
      res.status(503).json({ ok: false, error: "parts_db_missing" });
      return;
    }
    const fg = typeof req.query.fg === "string" ? req.query.fg : "";
    if (!fg) {
      res.status(400).json({ ok: false, error: "fg_required" });
      return;
    }
    const model = typeof req.query.model === "string" ? req.query.model : "";
    const year = typeof req.query.year === "string" ? req.query.year : "";
    const lang = req.query.lang === "en" ? "en" : "ru";
    const plates = listPartsPlates({ fg, model, year });
    res.json({
      ok: true,
      fg,
      plates: plates.map((p) => ({
        id: p.id,
        fgPath: p.fgPath,
        title: plateDisplayTitle(p, lang),
        titleRu: p.titleRu,
        titleEn: p.titleEn,
        graphicUrl: p.graphicUrl,
        graphicMime: p.graphicMime,
      })),
    });
  });

  return router;
}
