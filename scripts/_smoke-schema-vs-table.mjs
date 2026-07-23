/**
 * Smoke: [схема] badges only for codes with real SVG; pinout-only codes keep [табл].
 */
import express from "express";
import { openDatabase } from "../server/db/schema.ts";
import { createNavRouter } from "../server/routes/nav.ts";
import { createEwdRouter } from "../server/routes/ewd.ts";
import { loadEwdCodeSet } from "../server/ewdPaths.ts";

const db = openDatabase(process.env.DATABASE_PATH || "data/wiring.sqlite");
const app = express();
app.use("/api/nav", createNavRouter(db));
app.use("/api/ewd", createEwdRouter());

const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const port = server.address().port;
const get = async (path, { json = true } = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!json) return { status: r.status, text: await r.text() };
  return { status: r.status, json: await r.json() };
};

const all = await get("/api/nav/components?zone=all");
const items = (all.json.groups || []).flatMap((g) => g.items || []);
const withSchema = items.filter((i) => i.has_ewd);
const withTableOnly = items.filter((i) => i.has_pinout && !i.has_ewd);

const ewdSet = loadEwdCodeSet();
let badBadge = 0;
for (const it of withSchema.slice(0, 40)) {
  if (!ewdSet.has(it.code)) badBadge += 1;
  const diags = await get(`/api/ewd/diagrams?code=${encodeURIComponent(it.code)}`);
  const list = diags.json?.diagrams || [];
  if (!Array.isArray(list) || list.length < 1) {
    console.error("FAIL: has_ewd but /diagrams empty", it.code);
    process.exit(1);
  }
  const uid = list[0].diagramUid;
  const svg = await get(`/api/ewd/svg?diagramUid=${encodeURIComponent(uid)}`, { json: false });
  if (svg.status !== 200 || !String(svg.text || "").includes("<svg")) {
    console.error("FAIL: has_ewd but /svg not usable", it.code, svg.status);
    process.exit(1);
  }
}

let tableOk = 0;
for (const it of withTableOnly.slice(0, 10)) {
  const wires = await get(`/api/nav/wires?code=${encodeURIComponent(it.code)}`);
  const owner = wires.json.owner_wires || [];
  const pinout = owner.some((w) => Number(w.pinout_page_number) > 0);
  if (pinout) tableOk += 1;
}

console.log(
  JSON.stringify(
    {
      totalItems: items.length,
      withSchema: withSchema.length,
      withTableOnly: withTableOnly.length,
      badBadge,
      tableOkSample: tableOk,
      sampleSchema: withSchema.slice(0, 3).map((i) => i.code),
      sampleTable: withTableOnly.slice(0, 3).map((i) => i.code),
    },
    null,
    2,
  ),
);

server.close();
db.close();

if (badBadge > 0) {
  console.error("SMOKE_FAIL: has_ewd outside loadEwdCodeSet");
  process.exit(1);
}
if (withSchema.length === 0 && ewdSet.size > 0) {
  console.error("SMOKE_FAIL: EWD SVGs exist but no [схема] badges");
  process.exit(1);
}
console.log("SMOKE_OK schema-vs-table");
