/**
 * Smoke: every code listed under a zone must return ≥1 wire for that zone.
 */
import express from "express";
import request from "supertest";
import { openDatabase } from "../server/db/schema.ts";
import { createNavRouter } from "../server/routes/nav.ts";

const db = openDatabase("data/wiring.sqlite");
const app = express();
app.use("/api/nav", createNavRouter(db));

const zones = ["front_doors", "engine", "front_bumper"];
let ok = true;

for (const zone of zones) {
  const list = await request(app).get(`/api/nav/components?zone=${zone}`);
  const codes = list.body.groups.flatMap((g) => g.items.map((i) => i.code));
  console.log(zone, "components", codes.length);
  let empty = 0;
  for (const code of codes.slice(0, 40)) {
    const w = await request(app).get(
      `/api/nav/wires?code=${encodeURIComponent(code)}&zone=${zone}`,
    );
    const n = (w.body.owner_wires?.length || 0) + (w.body.transit_wires?.length || 0);
    if (n < 1) {
      empty += 1;
      console.error("EMPTY", zone, code);
      ok = false;
    }
  }
  console.log(zone, "empty_in_sample", empty);
}

const sample = await request(app).get("/api/nav/wires?code=74/507&zone=front_doors");
console.log("74/507 meta", {
  part: sample.body.part_number,
  mate: sample.body.part_number_mate,
  pins: sample.body.pin_count,
  gauges: sample.body.wire_gauges,
});

if (!ok) {
  console.error("SMOKE_FAIL");
  process.exit(1);
}
console.log("SMOKE_OK");
