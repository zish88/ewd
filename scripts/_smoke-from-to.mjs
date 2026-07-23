/**
 * Smoke: owner cards must not show identical from/to after EWD merge rules.
 */
import express from "express";
import { openDatabase } from "../server/db/schema.ts";
import { createNavRouter } from "../server/routes/nav.ts";
import { createEwdRouter } from "../server/routes/ewd.ts";

function normalizeCode(s) {
  const m = String(s || "").trim().match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(s || "").trim();
}

function isTautology(from, to, code) {
  const a = normalizeCode(from);
  const b = normalizeCode(to);
  if (!a || !b) return false;
  if (a === b) return true;
  if (code && a.startsWith(code) && b.startsWith(code)) return true;
  return false;
}

const db = openDatabase(process.env.DATABASE_PATH || "data/wiring.sqlite");
const app = express();
app.use("/api/nav", createNavRouter(db));
app.use("/api/ewd", createEwdRouter());
const server = await new Promise((r) => {
  const s = app.listen(0, () => r(s));
});
const port = server.address().port;
const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();

const sample = [
  "74/310",
  "74/507",
  "74/301",
  "74/411",
  "3/74",
];
let bad = 0;
let checked = 0;
for (const code of sample) {
  const wires = await get(`/api/nav/wires?code=${encodeURIComponent(code)}`);
  const eps = await get(`/api/ewd/endpoints?code=${encodeURIComponent(code)}&limit=40`);
  const endpoints = eps.endpoints || [];
  const tautEps = endpoints.filter((e) => isTautology(e.from, e.to, code));
  if (tautEps.length) {
    console.error("FAIL endpoints tautology", code, tautEps.slice(0, 2));
    bad += 1;
  }
  for (const w of wires.owner_wires || []) {
    checked += 1;
    const from = String(w.from_detail || "");
    const to = String(w.to_detail || "");
    if (from && to && isTautology(from, to, code) && from === to) {
      console.error("FAIL card identical from/to", code, w.pin_number, from);
      bad += 1;
    }
  }
}

console.log(JSON.stringify({ checked, bad, sample }, null, 2));
server.close();
db.close();
if (bad) process.exit(1);
console.log("SMOKE_OK from-to");
