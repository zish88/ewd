import express from "express";
import { openDatabase } from "../server/db/schema.ts";
import { createNavRouter } from "../server/routes/nav.ts";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";

const src = "data/wiring.sqlite";
const tmp = "data/_wiring_nav_smoke.sqlite";
if (!existsSync(src)) throw new Error("NO_DB");
try {
  unlinkSync(tmp);
} catch {
  /* */
}
copyFileSync(src, tmp);

const db = openDatabase(tmp);
const app = express();
app.use("/api/nav", createNavRouter(db));

const base = await new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server));
});
const port = base.address().port;

async function get(path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  return r.json();
}

const zones = await get("/api/nav/zones");
const all = await get("/api/nav/components?zone=all");
const engine = await get("/api/nav/components?zone=engine");
const doors = await get("/api/nav/components?zone=rear_doors");

const countItems = (data) =>
  (data.groups || []).reduce((n, g) => n + (g.items?.length || 0), 0);

console.log(
  JSON.stringify(
    {
      zoneCounts: (zones.zones || []).filter((z) => z.count > 0).slice(0, 8),
      all: countItems(all),
      engine: countItems(engine),
      rear_doors: countItems(doors),
      sampleEngine: (engine.groups || []).flatMap((g) => g.items).slice(0, 5),
      sampleDoors: (doors.groups || []).flatMap((g) => g.items).slice(0, 5),
    },
    null,
    2,
  ),
);

base.close();
db.close();

if (countItems(all) < 10) {
  console.error("SMOKE_FAIL: zone=all should list components");
  process.exit(1);
}
if (countItems(engine) < 1 && countItems(doors) < 1) {
  console.error("SMOKE_FAIL: zone filters still empty");
  process.exit(1);
}
console.log("SMOKE_OK");
