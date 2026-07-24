import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createEwdRouter } from "./ewd.js";

function app() {
  const a = express();
  a.use("/api/ewd", createEwdRouter());
  return a;
}

test("ewd endpoints 74/309 + front_bumper has no ECM/injection peers", async () => {
  const res = await request(app()).get(
    "/api/ewd/endpoints?code=74%2F309&zone=front_bumper",
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.endpoints));
  const blob = JSON.stringify(res.body.endpoints);
  assert.equal(/8\/6|ECM|inject/i.test(blob), false);
  if (res.body.count > 0) {
    assert.ok(/74\/519|7\/204|PARKING|PAS/i.test(blob));
  }
});

test("ewd endpoints with diagramUid do not return all systems for multi-system code", async () => {
  // 8/6 has multiple systemUids — scoping by one diagram must narrow vs unscoped
  const unscoped = await request(app()).get("/api/ewd/endpoints?code=8%2F6");
  assert.equal(unscoped.status, 200);
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=8%2F6&zone=engine");
  assert.equal(diagrams.status, 200);
  const first = diagrams.body.diagrams?.[0];
  if (!first?.diagramUid) {
    // Index may be missing in CI — skip soft
    return;
  }
  const res = await request(app()).get(
    `/api/ewd/endpoints?code=8%2F6&zone=engine&diagramUid=${encodeURIComponent(first.diagramUid)}`,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.systemUids));
  const allCount = Array.isArray(unscoped.body.systemUids) ? unscoped.body.systemUids.length : 0;
  // Scoped list must be non-empty when endpoints exist, and not wider than unscoped
  if (allCount > 0) {
    assert.ok(res.body.systemUids.length <= allCount);
  }
  if (res.body.count > 0) {
    assert.ok(res.body.systemUids.length >= 1);
    assert.ok(res.body.systemUids.length <= Math.max(3, Math.ceil(allCount / 2) || 3));
  }
});

test("ewd pick-diagram returns ranked viable sheets for code+pin", async () => {
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=74%2F507");
  assert.equal(diagrams.status, 200);
  const uids = (diagrams.body.diagrams || [])
    .map((d: { diagramUid?: string }) => d.diagramUid)
    .filter(Boolean)
    .slice(0, 12);
  if (uids.length < 2) return;
  const res = await request(app()).get(
    `/api/ewd/pick-diagram?code=74%2F507&pins=21&diagramUids=${uids.map(encodeURIComponent).join(",")}`,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.ranked));
  assert.ok(Array.isArray(res.body.viable));
  // If any sheet has connectivity for the pin, pick must be among viable
  if (res.body.viable.length) {
    assert.ok(res.body.diagramUid);
    assert.ok(res.body.viable.includes(res.body.diagramUid));
    assert.ok(Number(res.body.matchedCount) > 0);
  }
});
