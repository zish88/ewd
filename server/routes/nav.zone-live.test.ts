/**
 * Soft live checks against Capital wiring.sqlite + EWD indexes (skip if missing).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";
import { openDatabase } from "../db/schema.js";
import { createNavRouter } from "./nav.js";
import { createEwdRouter } from "./ewd.js";

const DB = resolve(process.env.WIRING_DB || join(process.cwd(), "data", "wiring.sqlite"));
const PIN_WIRE = resolve(
  process.env.EWD_DATA_DIR || join(process.cwd(), "data", "ewd"),
  "pin_wire_index.json",
);

const ZONES = ["rear_doors", "floor", "front_bumper", "engine"] as const;

test("live: capital zones return non-empty component lists", async () => {
  if (!existsSync(DB)) {
    console.log("SKIP: wiring.sqlite missing");
    return;
  }
  const db = openDatabase(DB);
  const app = express();
  app.use("/api/nav", createNavRouter(db));
  for (const zone of ZONES) {
    const res = await request(app).get(`/api/nav/components?zone=${zone}`);
    assert.equal(res.status, 200, zone);
    const codes = (res.body.groups || []).flatMap((g: { items: Array<{ code: string }> }) =>
      g.items.map((i) => i.code),
    );
    assert.ok(codes.length > 0, `${zone} must list ≥1 component`);
  }
  db.close();
});

test("live: pick-diagram for code+pin returns wireHits>0 when viable", async () => {
  if (!existsSync(PIN_WIRE) || !existsSync(DB)) {
    console.log("SKIP: pin_wire or wiring.sqlite missing");
    return;
  }
  const app = express();
  app.use("/api/ewd", createEwdRouter());
  const diagrams = await request(app).get("/api/ewd/diagrams?code=74%2F507");
  if (diagrams.status !== 200 || !(diagrams.body.diagrams || []).length) {
    console.log("SKIP: no diagrams for 74/507");
    return;
  }
  const uids = (diagrams.body.diagrams as Array<{ diagramUid: string }>)
    .map((d) => d.diagramUid)
    .slice(0, 12);
  const res = await request(app).get(
    `/api/ewd/pick-diagram?code=74%2F507&pins=21&diagramUids=${uids.map(encodeURIComponent).join(",")}`,
  );
  assert.equal(res.status, 200);
  if (Array.isArray(res.body.viable) && res.body.viable.length) {
    assert.ok(res.body.diagramUid, "pick must return diagramUid");
    assert.ok(
      Number(res.body.wireHits) > 0 ||
        Number(res.body.onSheetUidCount) > 0 ||
        Number(res.body.matchedCount) > 0,
      "лучшая sheet must have net match or on-sheet UIDs",
    );
    assert.equal(
      res.body.diagramUid,
      res.body.viable[0],
      "open≡лучшая: first viable must match pick diagramUid",
    );
    const ranked = Array.isArray(res.body.ranked) ? res.body.ranked : [];
    if (ranked.length && Number(ranked[0].wireHits) > 0) {
      assert.equal(
        res.body.diagramUid,
        ranked[0].diagramUid,
        "when wireHits exist, pick must be top ranked sheet",
      );
    }
  }
});
