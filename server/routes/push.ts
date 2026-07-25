import { Router } from "express";
import {
  isPushConfigured,
  removeSubscription,
  saveSubscription,
  vapidPublicKey,
} from "../pushNotify.js";

export function createPushRouter() {
  const router = Router();

  router.get("/vapid-public-key", (_req, res) => {
    if (!isPushConfigured()) {
      res.status(503).json({ error: "Push не настроен (нет VAPID ключей)." });
      return;
    }
    const publicKey = vapidPublicKey();
    if (!publicKey) {
      res.status(503).json({ error: "Push не настроен." });
      return;
    }
    res.json({ publicKey });
  });

  router.post("/subscribe", (req, res) => {
    if (!isPushConfigured()) {
      res.status(503).json({ error: "Push не настроен." });
      return;
    }
    const body = (req.body || {}) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const result = saveSubscription({
      endpoint: String(body.endpoint || ""),
      keys: {
        p256dh: String(body.keys?.p256dh || ""),
        auth: String(body.keys?.auth || ""),
      },
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.delete("/subscribe", (req, res) => {
    const body = (req.body || {}) as { endpoint?: string };
    const endpoint = String(body.endpoint || req.query.endpoint || "").trim();
    if (!endpoint) {
      res.status(400).json({ error: "Нужен endpoint" });
      return;
    }
    removeSubscription(endpoint);
    res.json({ ok: true });
  });

  return router;
}
