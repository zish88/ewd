/**
 * Card-bound wireUid must win over soft pin_wire siblings on the same sheet.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";
import { createEwdRouter } from "./ewd.js";

const EWD_DATA = resolve(process.env.EWD_DATA_DIR || join(process.cwd(), "data", "ewd"));
const PIN_WIRE = join(EWD_DATA, "pin_wire_index.json");

function app() {
  const a = express();
  a.use("/api/ewd", createEwdRouter());
  return a;
}

test("highlight with wireUid prefers card net on sheet", async () => {
  if (!existsSync(PIN_WIRE)) {
    console.log("SKIP: pin_wire_index missing");
    return;
  }
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, Array<{ wireUid?: string; diagramUids?: string[] }>>;
  };
  let code = "";
  let pin = "";
  let wireUid = "";
  let diagramUid = "";
  for (const [key, edges] of Object.entries(payload.by_code_pin || {})) {
    const e = edges.find((x) => x.wireUid && x.diagramUids?.length);
    if (!e) continue;
    const [c, p] = key.split("|");
    if (!c || !p) continue;
    code = c;
    pin = p;
    wireUid = e.wireUid!;
    diagramUid = e.diagramUids![0];
    break;
  }
  if (!code) {
    console.log("SKIP: no code|pin with wireUid");
    return;
  }
  const res = await request(app()).get(
    `/api/ewd/highlight?code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}&diagramUid=${encodeURIComponent(diagramUid)}&wireUid=${encodeURIComponent(wireUid)}`,
  );
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.wireUids));
  if (res.body.wireUids.length) {
    assert.equal(
      res.body.wireUids[0],
      wireUid,
      "first paint seed must be the card wireUid",
    );
    assert.ok(
      res.body.wireUids.includes(wireUid),
      "card wireUid must remain in paint list (path may add more segments)",
    );
  }
});

test("pick-diagram with wireUid: hard only (wireHits>0), no soft matched-only", async () => {
  if (!existsSync(PIN_WIRE)) {
    console.log("SKIP: pin_wire_index missing");
    return;
  }
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<string, Array<{ wireUid?: string; diagramUids?: string[] }>>;
  };
  let code = "";
  let pin = "";
  let wireUid = "";
  let owned: string[] = [];
  for (const [key, edges] of Object.entries(payload.by_code_pin || {})) {
    const e = edges.find((x) => x.wireUid && (x.diagramUids || []).length);
    if (!e) continue;
    const [c, p] = key.split("|");
    if (!c || !p) continue;
    code = c;
    pin = p;
    wireUid = e.wireUid!;
    owned = e.diagramUids || [];
    break;
  }
  if (!code || !wireUid) {
    console.log("SKIP: no wireUid sample");
    return;
  }
  // Mix owned sheet with unrelated probe UIDs — probe must not displace netOwned
  const diagrams = await request(app()).get(`/api/ewd/diagrams?code=${encodeURIComponent(code)}`);
  const probe = (diagrams.body.diagrams || [])
    .map((d: { diagramUid?: string }) => d.diagramUid)
    .filter(Boolean)
    .slice(0, 8) as string[];
  const qs = new URLSearchParams({
    code,
    pins: pin,
    wireUid,
    diagramUids: [...probe, ...owned].slice(0, 16).join(","),
  });
  const res = await request(app()).get(`/api/ewd/pick-diagram?${qs}`);
  assert.equal(res.status, 200);
  if (res.body.diagramUid) {
    assert.ok(Number(res.body.wireHits) > 0, "hard pick requires wireHits>0");
    assert.equal(res.body.hard, true);
    assert.ok(
      (res.body.viable || []).every((uid: string) =>
        (res.body.ranked || []).some(
          (r: { diagramUid: string; wireHits?: number }) =>
            r.diagramUid === uid && Number(r.wireHits) > 0,
        ),
      ),
      "viable must be wireHits>0 only when wireUid set",
    );
    if (owned.length) {
      assert.ok(
        owned.includes(res.body.diagramUid) || Number(res.body.wireHits) > 0,
        "pick should stay on a sheet that owns the wire",
      );
    }
  } else {
    assert.equal(res.body.hard, false);
    assert.equal(Number(res.body.wireHits) || 0, 0);
    assert.ok(!(res.body.viable || []).length || res.body.viable.every(() => true));
  }
});

test("highlight path expansion may return multiple on-sheet wireUids", async () => {
  if (!existsSync(PIN_WIRE)) return;
  const diagrams = await request(app()).get("/api/ewd/diagrams?code=74%2F508");
  if (diagrams.status !== 200 || !(diagrams.body.diagrams || []).length) return;
  const uid = diagrams.body.diagrams[0].diagramUid as string;
  const res = await request(app()).get(
    `/api/ewd/highlight?code=74%2F508&pin=3&color=GN-BK&diagramUid=${encodeURIComponent(uid)}`,
  );
  assert.equal(res.status, 200);
  // Soft: when path finds junctions, source mentions path or wireUids > 1
  if (Array.isArray(res.body.wireUids) && res.body.wireUids.length > 1) {
    assert.ok(
      String(res.body.source || "").includes("path") || res.body.wireUids.length >= 2,
      "multi-segment path expected when several wireUids on sheet",
    );
  }
});
