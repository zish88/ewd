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
  assert.ok(Array.isArray(res.body.pinOnly));
  // With pin focus, viable must be wire-owned only; pin-only is a separate list
  for (const uid of res.body.viable || []) {
    const row = (res.body.ranked || []).find(
      (r: { diagramUid: string; wireHits?: number }) => r.diagramUid === uid,
    );
    assert.ok(row, `viable ${uid} must appear in ranked`);
    assert.ok(Number(row.wireHits) > 0, `viable ${uid} must have wireHits>0`);
  }
  for (const uid of res.body.pinOnly || []) {
    assert.ok(!(res.body.viable || []).includes(uid), "pinOnly must not be in viable");
  }
  if (res.body.viable.length) {
    assert.ok(res.body.diagramUid);
    assert.ok(res.body.viable.includes(res.body.diagramUid));
    assert.equal(res.body.hard, true);
    assert.equal(res.body.confidence, "wire-owned");
    assert.ok(Number(res.body.wireHits) > 0);
  } else if (res.body.pinOnly?.length) {
    assert.equal(res.body.hard, false);
    assert.ok(["pin-only", "none", "text-only"].includes(String(res.body.confidence)));
  }
  assert.ok(typeof res.body.scoredCount === "number");
  for (const row of res.body.ranked || []) {
    assert.ok(row.confidence, "ranked row must carry confidence");
    if (Number(row.wireHits) > 0) assert.equal(row.confidence, "wire-owned");
    else if (Number(row.pinHits) > 0) assert.equal(row.confidence, "pin-only");
  }
});

test("ewd diagrams sort is stable for the same code", async () => {
  const a = await request(app()).get("/api/ewd/diagrams?code=74%2F507");
  const b = await request(app()).get("/api/ewd/diagrams?code=74%2F507");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const idsA = (a.body.diagrams || []).map((d: { diagramUid: string }) => d.diagramUid);
  const idsB = (b.body.diagrams || []).map((d: { diagramUid: string }) => d.diagramUid);
  assert.deepEqual(idsA, idsB);
  assert.equal(a.body.count, idsA.length);
});

test("ewd diagrams expose wire-owned viable separate from text-only sheets", async () => {
  const res = await request(app()).get("/api/ewd/diagrams?code=7%2F90");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.diagrams));
  assert.ok(Array.isArray(res.body.viable));
  assert.ok(Array.isArray(res.body.pinOnly));
  for (const uid of res.body.viable || []) {
    const row = (res.body.diagrams || []).find(
      (d: { diagramUid: string; wireHits?: number; confidence?: string }) => d.diagramUid === uid,
    );
    assert.ok(row, `viable ${uid} must be in diagrams`);
    assert.ok(Number(row.wireHits) > 0, `viable ${uid} must have wireHits>0`);
    assert.equal(row.confidence, "wire-owned");
  }
  for (const uid of res.body.pinOnly || []) {
    assert.ok(!(res.body.viable || []).includes(uid));
  }
  // Default node picker must not treat text-only sheets as primary chains
  if (res.body.viable?.length) {
    assert.ok(res.body.viable.length <= (res.body.diagrams || []).length);
  }
});

test("wire-context keeps exact 7/90 sheets independent from nav zone", async () => {
  const cases = [
    {
      pin: "1",
      color: "BK-WH",
      peer: "73/4049",
      wireUid: "UID46feb1-144d0be0081-7e5bcfe21ab1742afb31d5d5a30fe451",
    },
    {
      pin: "2",
      color: "BN-VT",
      peer: "74/901",
      wireUid: "UID46feb1-144d0c09952-7e5bcfe21ab1742afb31d5d5a30fe451",
    },
  ];
  for (const row of cases) {
    const qs = new URLSearchParams({
      code: "7/90",
      pin: row.pin,
      color: row.color,
      peer: row.peer,
      wireUid: row.wireUid,
      zone: "other",
    });
    const res = await request(app()).get(`/api/ewd/wire-context?${qs}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.wireUid, row.wireUid);
    assert.ok(res.body.exactSheetCount >= 1, `${row.color} must own at least one exact sheet`);
    assert.ok(["exact-one", "exact-many"].includes(res.body.status));
    assert.equal(res.body.nearestPeer?.code, row.peer);
    assert.ok(
      res.body.exactSheets.every(
        (sheet: { confidence?: string; provenance?: string }) =>
          sheet.confidence === "exact-wire" && sheet.provenance === "requested-wire-uid",
      ),
    );
  }
});

test("ewd systems default list is wire-owned designs for the code", async () => {
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=7%2F90");
  const systems = await request(app()).get("/api/ewd/systems?code=7%2F90");
  assert.equal(diagrams.status, 200);
  assert.equal(systems.status, 200);
  if (!(diagrams.body.viable || []).length) return;
  assert.ok((systems.body.systems || []).length >= 1);
  for (const s of systems.body.systems || []) {
    assert.equal(s.wireOwned, true);
    assert.equal(s.confidence, "wire-owned");
  }
  // Soft/device-only designs must not appear unless includeSoft=1
  const soft = await request(app()).get("/api/ewd/systems?code=7%2F90&includeSoft=1");
  assert.equal(soft.status, 200);
  assert.ok((soft.body.systems || []).length >= (systems.body.systems || []).length);
});

test("ewd pick-diagram with pin focus excludes soft probe sheets from viable", async () => {
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=7%2F90");
  assert.equal(diagrams.status, 200);
  const uids = (diagrams.body.diagrams || [])
    .map((d: { diagramUid?: string }) => d.diagramUid)
    .filter(Boolean);
  if (uids.length < 2) return;
  const res = await request(app()).get(
    `/api/ewd/pick-diagram?code=7%2F90&pins=2&diagramUids=${uids.map(encodeURIComponent).join(",")}`,
  );
  assert.equal(res.status, 200);
  // Pin without wireUid: viable ⊆ netOwned wire-owned; must not dump every soft face_view hit
  assert.ok(Array.isArray(res.body.viable));
  if (res.body.netOwnedCount > 0 && res.body.viable.length) {
    assert.ok(res.body.viable.length <= Math.max(res.body.netOwnedCount, 2));
    for (const uid of res.body.viable) {
      const row = (res.body.ranked || []).find(
        (r: { diagramUid: string; wireHits?: number }) => r.diagramUid === uid,
      );
      assert.ok(row && Number(row.wireHits) > 0);
    }
  }
});
