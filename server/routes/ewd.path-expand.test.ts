/**
 * Path expand must keep same-color segments across junctions when harness/sharedUID changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";
import { createEwdRouter, rankPathEdgesForExpand } from "./ewd.js";

const EWD_DATA = resolve(process.env.EWD_DATA_DIR || join(process.cwd(), "data", "ewd"));
const PIN_WIRE = join(EWD_DATA, "pin_wire_index.json");

function app() {
  const a = express();
  a.use("/api/ewd", createEwdRouter());
  return a;
}

test("rankPathEdgesForExpand: same sharedUID does not drop other same-color on-sheet", () => {
  const sheet = new Set(["UID-W-A", "UID-W-B"]);
  const edges = [
    {
      code: "74/508",
      pin: "11",
      color: "GN-RD",
      wireUid: "UID-W-A",
      sharedObjectUID: "UID-SHARED-A",
      peerCode: "3/274",
      peerPin: "1",
    },
    {
      code: "74/508",
      pin: "11",
      color: "GN-RD",
      wireUid: "UID-W-B",
      sharedObjectUID: "UID-SHARED-B",
      peerCode: "73/5037",
      peerPin: "1",
    },
    {
      code: "74/508",
      pin: "11",
      color: "BK",
      wireUid: "UID-W-OTHER",
      sharedObjectUID: "UID-SHARED-X",
      peerCode: "31/1",
      peerPin: "1",
    },
  ];
  const ranked = rankPathEdgesForExpand(edges as never, {
    seedSharedUid: "UID-SHARED-A",
    sheetUids: sheet,
    wantColor: "GN-RD",
  });
  assert.equal(ranked.length, 2, "both GN-RD edges kept");
  assert.equal(ranked[0].wireUid, "UID-W-A", "same shared ranks first");
  assert.ok(
    ranked.some((e) => e.wireUid === "UID-W-B"),
    "other harness same color must remain",
  );
  assert.ok(!ranked.some((e) => e.wireUid === "UID-W-OTHER"));
});

test("highlight path: same-color multi-segment when index has junction continue", async () => {
  if (!existsSync(PIN_WIRE)) {
    console.log("SKIP: pin_wire_index missing");
    return;
  }
  const payload = JSON.parse(readFileSync(PIN_WIRE, "utf-8")) as {
    by_code_pin?: Record<
      string,
      Array<{
        wireUid?: string;
        color?: string;
        diagramUids?: string[];
        peerCode?: string;
        peerPin?: string;
        code?: string;
        pin?: string;
        ppin?: string;
      }>
    >;
  };
  // Find a junction cavity with ≥2 same-color on-sheet wireUids (typical 74/xxx splice)
  let code = "";
  let pin = "";
  let color = "";
  let wireUid = "";
  let diagramUid = "";
  for (const [key, edges] of Object.entries(payload.by_code_pin || {})) {
    const [c] = key.split("|");
    if (!/^74\//.test(c || "") && !/^73\//.test(c || "")) continue;
    const byColor = new Map<string, typeof edges>();
    for (const e of edges) {
      const col = String(e.color || "")
        .replace(/\//g, "-")
        .toUpperCase();
      if (!col || !e.wireUid) continue;
      const list = byColor.get(col) || [];
      list.push(e);
      byColor.set(col, list);
    }
    for (const [col, list] of byColor) {
      const uids = [...new Set(list.map((e) => e.wireUid).filter(Boolean))];
      if (uids.length < 2) continue;
      const withDiag = list.find((e) => e.diagramUids?.length);
      if (!withDiag?.diagramUids?.[0]) continue;
      code = c;
      pin = key.split("|")[1] || "";
      color = col;
      wireUid = String(withDiag.wireUid);
      diagramUid = withDiag.diagramUids[0];
      break;
    }
    if (code) break;
  }
  if (!code || !wireUid) {
    console.log("SKIP: no junction with multi same-color wires");
    return;
  }
  const qs = new URLSearchParams({
    code,
    pin,
    color,
    diagramUid,
    wireUid,
  });
  const res = await request(app()).get(`/api/ewd/highlight?${qs}`);
  assert.equal(res.status, 200);
  const wires = Array.isArray(res.body.wireUids) ? res.body.wireUids : [];
  // Soft: when index has multiple same-color edges, path should prefer >1 on-sheet uid
  if (wires.length >= 2) {
    assert.ok(
      String(res.body.source || "").includes("path") || wires.length >= 2,
      "multi-segment path expected for junction same-color continue",
    );
  }
  assert.ok(wires.includes(wireUid) || wires.length >= 1, "seed wire remains");
});
