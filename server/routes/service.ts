import { Router } from "express";
import { createReadStream } from "node:fs";
import {
  getServiceDoc,
  getServiceStatus,
  listDocsForTreeItem,
  listServiceTree,
  resolveServiceRef,
  searchServiceDocs,
} from "../servicerepDb.js";
import {
  ensureServiceGraphic,
  findCachedGraphic,
  listCachedGraphicCount,
  parseGraphicId,
} from "../servicerepGraphics.js";
import { readSiteSettings } from "../siteSettings.js";
import { listModels, yearsForModel } from "../vehicleMatrix.js";

function serviceFeatureEnabled(): boolean {
  return readSiteSettings().features.serviceBrowser !== false;
}

/**
 * ServiceRep browser. Returns available:false when sqlite missing or feature off.
 */
export function createServiceRouter(): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    const enabled = serviceFeatureEnabled();
    if (!enabled) {
      res.json({
        ok: true,
        enabled: false,
        available: false,
        path: "",
        docCount: 0,
        htmlCount: 0,
        treeCount: 0,
        graphicCacheCount: 0,
      });
      return;
    }
    res.json({
      ok: true,
      enabled: true,
      ...getServiceStatus(),
      graphicCacheCount: listCachedGraphicCount(),
    });
  });

  router.use((req, res, next) => {
    if (req.path === "/status") {
      next();
      return;
    }
    if (!serviceFeatureEnabled()) {
      res.status(403).json({ ok: false, error: "service_disabled", feature: "serviceBrowser" });
      return;
    }
    next();
  });

  router.get("/filters", (_req, res) => {
    res.json({
      ok: true,
      models: listModels(),
      yearsByModel: Object.fromEntries(listModels().map((m) => [m, yearsForModel(m)])),
    });
  });

  router.get("/tree", (req, res) => {
    const status = getServiceStatus();
    if (!status.available) {
      res.status(503).json({ ok: false, error: "servicerep_unavailable", ...status });
      return;
    }
    const model = String(req.query.model || "").trim();
    const year = String(req.query.year || "").trim();
    const q = String(req.query.q || "").trim();
    const parent = String(req.query.parent || "").trim();
    const tree = listServiceTree({ model, year, q, parent });
    res.json({
      ok: true,
      count: tree.length,
      tree,
      model: model || null,
      year: year || null,
      parent: parent || null,
    });
  });

  router.get("/search", (req, res) => {
    const status = getServiceStatus();
    if (!status.available) {
      res.status(503).json({ ok: false, error: "servicerep_unavailable", ...status });
      return;
    }
    const q = String(req.query.q || "").trim();
    const model = String(req.query.model || "").trim();
    const year = String(req.query.year || "").trim();
    const hits = searchServiceDocs({ q, model, year });
    res.json({ ok: true, q, count: hits.length, hits });
  });

  router.get("/tree-item/:id/docs", (req, res) => {
    const status = getServiceStatus();
    if (!status.available) {
      res.status(503).json({ ok: false, error: "servicerep_unavailable", ...status });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ ok: false, error: "id required" });
      return;
    }
    res.json({ ok: true, treeItemId: id, docs: listDocsForTreeItem(id) });
  });

  router.get("/doc/:id", (req, res) => {
    const status = getServiceStatus();
    if (!status.available) {
      res.status(503).json({ ok: false, error: "servicerep_unavailable", ...status });
      return;
    }
    const id = Number(req.params.id);
    const doc = getServiceDoc(id);
    if (!doc) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }
    res.json({ ok: true, doc });
  });

  /** Resolve VIDA cross-ref (ru-RU<chronicle>#anchor) to a document id. */
  router.get("/resolve", (req, res) => {
    const status = getServiceStatus();
    if (!status.available) {
      res.status(503).json({ ok: false, error: "servicerep_unavailable", ...status });
      return;
    }
    const ref = String(req.query.ref || "").trim();
    const hit = resolveServiceRef(ref);
    if (!hit) {
      res.status(404).json({ ok: false, error: "not_found", ref });
      return;
    }
    res.json({ ok: true, ref, hit });
  });

  /** Illustration from ImageRepository (cached under data/servicerep-graphics/). */
  router.get("/graphic/:id", async (req, res) => {
    const id = parseGraphicId(String(req.params.id || ""));
    if (!id) {
      res.status(400).json({ ok: false, error: "bad_id" });
      return;
    }
    try {
      let hit = findCachedGraphic(id);
      if (!hit) {
        await ensureServiceGraphic(id);
        hit = findCachedGraphic(id);
      }
      if (!hit) {
        res.status(404).json({ ok: false, error: "graphic_not_found", id });
        return;
      }
      res.setHeader("Content-Type", hit.mime);
      res.setHeader("Cache-Control", "public, max-age=86400");
      createReadStream(hit.path).pipe(res);
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return router;
}
