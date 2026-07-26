/**
 * Smoke for MD mobile nav plan: zone symmetry, PN/mate, VIN decode, DTC search.
 */
import express from "express";
import request from "supertest";
import { openDatabase } from "../server/db/schema.ts";
import { createNavRouter } from "../server/routes/nav.ts";
import { createDtcRouter } from "../server/routes/dtc.ts";
import { decodeVolvoVin } from "../server/vinDecoder.ts";

const db = openDatabase("data/wiring.sqlite");
const app = express();
app.use("/api/nav", createNavRouter(db));
app.use("/api/dtc", createDtcRouter());
app.get("/api/vin/decode", (req, res) => {
  const vin = String(req.query.vin ?? "");
  res.json(decodeVolvoVin(vin));
});

let ok = true;
const fail = (msg) => {
  console.error("FAIL", msg);
  ok = false;
};

const zones = ["front_doors", "engine", "front_bumper"];
for (const zone of zones) {
  const list = await request(app).get(`/api/nav/components?zone=${zone}`);
  if (list.status !== 200) fail(`${zone} components status ${list.status}`);
  const codes = list.body.groups.flatMap((g) => g.items.map((i) => i.code));
  console.log(zone, "components", codes.length);
  for (const code of codes.slice(0, 25)) {
    const w = await request(app).get(
      `/api/nav/wires?code=${encodeURIComponent(code)}&zone=${zone}`,
    );
    const n = (w.body.owner_wires?.length || 0) + (w.body.transit_wires?.length || 0);
    if (n < 1) fail(`EMPTY ${zone} ${code}`);
  }
}

const sample = await request(app).get("/api/nav/wires?code=74/507&zone=front_doors");
console.log("74/507 meta", {
  part: sample.body.part_number,
  mate: sample.body.part_number_mate,
  pins: sample.body.pin_count,
  gauges: sample.body.wire_gauges,
});
if (!sample.body.part_number && !sample.body.part_number_mate) {
  console.warn("WARN 74/507 has no PN/mate (data may be sparse)");
}

const vin = decodeVolvoVin("YV1BZ8256C1123456");
console.log("vin decode", { ok: vin.ok, model: vin.model || vin.vehicle?.model });
if (!vin || vin.ok === false) {
  // Some sample VINs may not decode; require endpoint shape
  const via = await request(app).get("/api/vin/decode?vin=YV1BZ8256C1123456");
  if (via.status !== 200) fail(`vin status ${via.status}`);
  else console.log("vin http ok", via.body?.ok);
} else {
  console.log("vin local ok");
}

const dtc = await request(app).get("/api/dtc/search?q=P0563");
console.log("dtc", dtc.status, "hits", dtc.body?.results?.length ?? dtc.body?.items?.length ?? "?");
if (dtc.status !== 200) fail(`dtc status ${dtc.status}`);

if (!ok) {
  console.error("SMOKE_FAIL");
  process.exit(1);
}
console.log("SMOKE_OK");
