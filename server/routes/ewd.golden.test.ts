/**
 * Golden tests: FaceView cavity → pin_wire UIDs → highlight on-sheet
 * for reference Volvo codes (Capital/VIDA-style net ownership).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";
import { createEwdRouter } from "./ewd.js";
import { createEwdCapitalRouter } from "./ewdCapital.js";

const EWD_DATA = resolve(process.env.EWD_DATA_DIR || join(process.cwd(), "data", "ewd"));
const PIN_WIRE = join(EWD_DATA, "pin_wire_index.json");
const FACE_VIEW = join(EWD_DATA, "face_view_index.json");

function app() {
  const a = express();
  a.use("/api/ewd", createEwdRouter());
  a.use("/api/ewd", createEwdCapitalRouter());
  return a;
}

type PinWireEdge = {
  pinUid?: string;
  wireUid?: string;
  peerCode?: string;
  color?: string;
  diagramUids?: string[];
};

test("pin_wire_index exists after ETL (skip if not built)", () => {
  if (!existsSync(PIN_WIRE)) {
    console.log("SKIP: pin_wire_index.json missing — run ewd_extract --step pin_wire");
    return;
  }
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, PinWireEdge[]>;
    code_pin_count?: number;
  };
  assert.ok((payload.code_pin_count || 0) > 100);
  assert.ok(payload.by_code_pin);
});

test("golden: 4/147 pin C1-1 has wireUid + peer from pin_wire_index", () => {
  if (!existsSync(PIN_WIRE)) return;
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, PinWireEdge[]>;
  };
  const edges =
    payload.by_code_pin?.["4/147|C1-1"] ||
    payload.by_code_pin?.["4/147|1"] ||
    [];
  if (!edges.length) {
    console.log("SKIP: 4/147 not in pin_wire_index soft keys");
    return;
  }
  const hit = edges.find((e) => e.wireUid && e.pinUid);
  assert.ok(hit, "expected pinUid+wireUid edge");
  assert.match(String(hit!.wireUid), /^UID/i);
  assert.match(String(hit!.pinUid), /^UID/i);
});

test("golden: highlight returns wireUids for indexed code+pin", async () => {
  if (!existsSync(PIN_WIRE)) return;
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, PinWireEdge[]>;
  };
  // Pick first code|pin with a wireUid and a diagram
  let code = "";
  let pin = "";
  let diagramUid = "";
  let expectedWire = "";
  for (const [key, edges] of Object.entries(payload.by_code_pin || {})) {
    const e = edges.find((x) => x.wireUid && x.diagramUids?.length);
    if (!e) continue;
    const [c, p] = key.split("|");
    if (!c || !p) continue;
    code = c;
    pin = p;
    diagramUid = e.diagramUids![0];
    expectedWire = e.wireUid!;
    break;
  }
  if (!code) {
    console.log("SKIP: no code|pin with diagramUids in pin_wire_index");
    return;
  }
  const res = await request(app()).get(
    `/api/ewd/highlight?code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}&diagramUid=${encodeURIComponent(diagramUid)}`,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.wireUids));
  assert.ok(
    res.body.wireUids.includes(expectedWire) || res.body.matchedCount > 0,
    `expected wireUid ${expectedWire} or matched endpoints for ${code}:${pin}`,
  );
  assert.ok(Array.isArray(res.body.pinUids));
});

test("golden: pick-diagram prefers wireHits / on-sheet UIDs", async () => {
  if (!existsSync(PIN_WIRE)) return;
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=74%2F507");
  if (diagrams.status !== 200 || !(diagrams.body.diagrams || []).length) return;
  const uids = (diagrams.body.diagrams as Array<{ diagramUid: string }>)
    .map((d) => d.diagramUid)
    .slice(0, 10);
  const res = await request(app()).get(
    `/api/ewd/pick-diagram?code=74%2F507&pins=21&diagramUids=${uids.map(encodeURIComponent).join(",")}`,
  );
  assert.equal(res.status, 200);
  if (res.body.viable?.length) {
    assert.ok(res.body.diagramUid);
    assert.ok(
      Number(res.body.wireHits) > 0 ||
        Number(res.body.onSheetUidCount) > 0 ||
        Number(res.body.matchedCount) > 0,
    );
  }
});

test("systems tree returns LogicDesign rows for a code", async () => {
  const res = await request(app()).get("/api/ewd/systems?code=74%2F507");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.systems));
  // Soft: index may be empty in CI without EWD source
  if (res.body.count > 0) {
    assert.ok(res.body.systems[0].systemUid?.startsWith("UID"));
    assert.ok(typeof res.body.systems[0].name === "string");
  }
});

test("trace endpoint accepts uid from global_signal_index when present", async () => {
  const globPath = join(EWD_DATA, "global_signal_index.json");
  if (!existsSync(globPath)) return;
  const payload = JSON.parse(readFileSync(globPath, "utf-8")) as {
    by_uid?: Record<string, { siblings?: string[] }>;
  };
  const uid = Object.keys(payload.by_uid || {})[0];
  if (!uid) return;
  const res = await request(app()).get(`/api/ewd/trace?uid=${encodeURIComponent(uid)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.uid, uid);
  assert.ok(Array.isArray(res.body.siblings));
  assert.ok(Array.isArray(res.body.diagrams));
});

const FACE_GOLDENS: Array<{ code: string; pin: string }> = [
  { code: "74/507", pin: "21" },
  { code: "4/83", pin: "1" },
];

test("golden FaceView: cavity rows expose pinUid/wireUid for 74/507 and 4/83", () => {
  if (!existsSync(FACE_VIEW)) {
    console.log("SKIP: face_view_index.json missing — run ewd_extract --step faceviews");
    return;
  }
  const payload = JSON.parse(readFileSync(FACE_VIEW, "utf-8")) as {
    by_key?: Record<string, Array<{ pinUid?: string; wireUid?: string; cavity?: string }>>;
  };
  for (const { code, pin } of FACE_GOLDENS) {
    const rows = payload.by_key?.[`${code}|${pin}`] || [];
    assert.ok(rows.length, `FaceView rows for ${code}|${pin}`);
    const hit = rows.find((r) => r.pinUid && r.wireUid);
    assert.ok(hit, `pinUid+wireUid for ${code}:${pin}`);
    assert.match(String(hit!.pinUid), /^UID/i);
    assert.match(String(hit!.wireUid), /^UID/i);
  }
});

test("golden FaceView→highlight: on-sheet wireUid for 74/507:21 and 4/83:1", async () => {
  if (!existsSync(FACE_VIEW) || !existsSync(PIN_WIRE)) return;
  const face = JSON.parse(readFileSync(FACE_VIEW, "utf-8")) as {
    by_key?: Record<string, Array<{ color?: string; peerCode?: string }>>;
  };
  const pinWire = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, PinWireEdge[]>;
  };

  for (const { code, pin } of FACE_GOLDENS) {
    const faceRow = (face.by_key?.[`${code}|${pin}`] || [])[0];
    assert.ok(faceRow, `FaceView ${code}|${pin}`);
    const edges = pinWire.by_code_pin?.[`${code}|${pin}`] || [];
    const edge =
      edges.find((e) => e.wireUid && e.diagramUids?.length) ||
      edges.find((e) => e.wireUid);
    if (!edge?.diagramUids?.length) {
      console.log(`SKIP: no pin_wire diagram for ${code}|${pin}`);
      continue;
    }
    const diagramUid = edge.diagramUids![0];
    const qs = new URLSearchParams({
      code,
      pin,
      diagramUid,
    });
    if (faceRow.color) qs.set("color", String(faceRow.color));
    if (faceRow.peerCode) qs.set("peer", String(faceRow.peerCode));
    const res = await request(app()).get(`/api/ewd/highlight?${qs}`);
    assert.equal(res.status, 200, `${code}:${pin} highlight status`);
    assert.ok(
      String(res.body.source || "").includes("face_view") ||
        String(res.body.source || "").includes("pin_wire"),
      `${code}:${pin} source=${res.body.source}`,
    );
    assert.ok(Array.isArray(res.body.wireUids) && res.body.wireUids.length, `${code}:${pin} wireUids`);
    assert.ok(
      res.body.wireUids.includes(edge.wireUid) || Number(res.body.matchedCount) > 0,
      `${code}:${pin} expected wire ${edge.wireUid}`,
    );
    // On-sheet: at least one paint UID returned
    assert.ok(Array.isArray(res.body.uids) && res.body.uids.length > 0, `${code}:${pin} on-sheet uids`);
  }
});

test("capital faceview + location APIs for golden codes", async () => {
  if (!existsSync(FACE_VIEW)) return;
  for (const { code } of FACE_GOLDENS) {
    const face = await request(app()).get(`/api/ewd/faceview?code=${encodeURIComponent(code)}`);
    assert.equal(face.status, 200);
    assert.ok((face.body.count || 0) > 0 || (face.body.faces || []).length > 0, `faceview ${code}`);
    const loc = await request(app()).get(`/api/ewd/location?code=${encodeURIComponent(code)}`);
    assert.equal(loc.status, 200);
  }
});
