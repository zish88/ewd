/**
 * One-off: build data/knowledge/_en_batches/*.json from scripts/kb-en/slug-en.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { enBySlug } from "./kb-en/slug-en.mjs";

const outDir = path.join("data", "knowledge", "_en_batches");
fs.mkdirSync(outDir, { recursive: true });

const slugs = Object.keys(enBySlug).sort();
const chunkSize = 45;
let batch = 0;
for (let i = 0; i < slugs.length; i += chunkSize) {
  const slice = slugs.slice(i, i + chunkSize);
  const obj = {};
  for (const s of slice) obj[s] = enBySlug[s];
  const name = `${String(batch + 1).padStart(2, "0")}.json`;
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2) + "\n");
  batch++;
}

const ru = JSON.parse(fs.readFileSync(path.join("data", "knowledge", "_ru_export.json"), "utf8"));
const missing = ru.filter((r) => !enBySlug[r.slug]).map((r) => r.slug);
const extra = Object.keys(enBySlug).filter((s) => !ru.find((r) => r.slug === s));

console.log(
  JSON.stringify(
    { totalEn: slugs.length, ruCount: ru.length, missing, extra, batches: batch },
    null,
    2,
  ),
);
