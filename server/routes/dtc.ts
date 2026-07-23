import { Router } from "express";
import { dtcStats, getDtcByCode, searchDtcCodes } from "../dtcDb.js";

export function createDtcRouter(): Router {
  const router = Router();

  router.get("/stats", (_req, res) => {
    res.json(dtcStats());
  });

  router.get("/search", (req, res) => {
    const q = String(req.query.q ?? req.query.query ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "Укажите q — код или фрагмент описания." });
      return;
    }
    const limit = Number(req.query.limit ?? 40);
    const results = searchDtcCodes(q, limit);
    res.json({
      query: q,
      count: results.length,
      available: dtcStats().available,
      results,
    });
  });

  router.get("/code/:code", (req, res) => {
    const row = getDtcByCode(req.params.code);
    if (!row) {
      res.status(404).json({ error: "Код не найден." });
      return;
    }
    res.json(row);
  });

  return router;
}
