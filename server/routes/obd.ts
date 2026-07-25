import { Router } from "express";
import { getDtcByCode } from "../dtcDb.js";

type InDtc = { ecu?: string; code?: string; status?: string; raw?: string };

/**
 * Enrich gateway scan DTCs with dictionary titles (no live car access).
 * Clear/Security never handled here — only on the ESP with confirm gates.
 */
export function createObdRouter(): Router {
  const router = Router();

  router.post("/enrich", (req, res) => {
    const list = Array.isArray(req.body?.dtcs) ? (req.body.dtcs as InDtc[]) : [];
    if (list.length > 200) {
      res.status(400).json({ error: "Слишком много DTC (макс. 200)." });
      return;
    }
    const dtcs = list.map((item) => {
      const code = String(item.code || "").trim();
      const row = code ? getDtcByCode(code) : null;
      return {
        ecu: String(item.ecu || ""),
        code,
        status: String(item.status || ""),
        raw: item.raw != null ? String(item.raw) : undefined,
        title_ru: row?.title_ru || undefined,
        title_en: row?.title_en || undefined,
        obd_code: row?.obd_code || undefined,
        dict_ecu: row?.ecu || undefined,
      };
    });
    res.json({ count: dtcs.length, dtcs });
  });

  return router;
}
