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
  // 8/6 has multiple systemUids — scoping by one diagram must narrow systemUids
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
  assert.ok(res.body.systemUids.length <= 2);
});
