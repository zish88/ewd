/**
 * Offline rules-first enrichment cache (no LLM).
 * Usage: npm run enrich:wires
 */
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFromToPlainRu,
  buildPurposeRu,
  enrichmentCachePath,
  resetWireEnrichmentCache,
  wireEnrichmentKey,
  type ComponentEnrichment,
  type WireEnrichment,
  type WireEnrichmentCache,
} from "../server/wireEnrichment.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = join(root, "data", "wiring.sqlite");

const db = new Database(dbPath, { readonly: true });

const nameRows = db
  .prepare(
    `SELECT component_code AS code,
            COALESCE(NULLIF(TRIM(name_ru), ''), NULLIF(TRIM(description_ru), ''), '') AS name_ru
     FROM components
     WHERE TRIM(COALESCE(name_ru, '')) != '' OR TRIM(COALESCE(description_ru, '')) != ''`,
  )
  .all() as Array<{ code: string; name_ru: string }>;

const components: Record<string, ComponentEnrichment> = {};
for (const row of nameRows) {
  const code = String(row.code || "").trim();
  const role = String(row.name_ru || "").trim();
  if (!code || !role) continue;
  components[code] = {
    role_ru: role,
    confidence: "high",
    sources: ["components.name_ru"],
  };
}

const wireRows = db
  .prepare(
    `SELECT w.wire_uid AS wire_uid,
            IFNULL(cf.component_code,'') AS from_code,
            IFNULL(ct.component_code,'') AS to_code,
            w.pin_number AS pin_number,
            w.wire_color_raw AS wire_color_raw,
            w.from_detail AS from_detail,
            w.to_detail AS to_detail,
            w.function_text AS function_text
     FROM wire_connections w
     LEFT JOIN components cf ON cf.id = w.from_component_id
     LEFT JOIN components ct ON ct.id = w.to_component_id
     WHERE TRIM(COALESCE(w.from_detail, '')) != '' AND TRIM(COALESCE(w.to_detail, '')) != ''
     LIMIT 50000`,
  )
  .all() as Array<{
  wire_uid: string;
  from_code: string;
  to_code: string;
  pin_number: string;
  wire_color_raw: string;
  from_detail: string;
  to_detail: string;
  function_text: string;
}>;

function enrichDetail(detail: string): string {
  const s = String(detail || "").trim();
  if (!s) return s;
  if (/[—–]/.test(s) || /\s-\s/.test(s)) return s;
  const m = s.match(/^(\d+\/\d+)\s*:\s*([0-9A-Za-z./-]+)\s*$/);
  if (!m) return s;
  const name = components[m[1]]?.role_ru;
  if (!name) return s;
  return `${m[1]}:${m[2]} — ${name}`;
}

const wires: Record<string, WireEnrichment> = {};
let plainCount = 0;
for (const row of wireRows) {
  const from_detail = enrichDetail(row.from_detail);
  const to_detail = enrichDetail(row.to_detail);
  const plain = buildFromToPlainRu(from_detail, to_detail);
  if (!plain) continue;
  const key = wireEnrichmentKey({
    wire_uid: row.wire_uid,
    from_node: row.from_code,
    to_node: row.to_code,
    pin_number: row.pin_number,
    wire_color: row.wire_color_raw,
  });
  const entry: WireEnrichment = {
    from_to_plain_ru: plain.text,
    confidence: plain.confidence,
    sources: [...plain.sources],
  };
  const purpose = buildPurposeRu({
    fromDetail: from_detail,
    toDetail: to_detail,
    functionText: row.function_text,
  });
  if (purpose) {
    entry.purpose_ru = purpose.text;
    entry.confidence =
      plain.confidence === "high" && purpose.confidence === "high" ? "high" : purpose.confidence;
    entry.sources = [...new Set([...entry.sources, ...purpose.sources])];
  }
  wires[key] = entry;
  plainCount += 1;
}

const cache: WireEnrichmentCache = {
  version: 1,
  model_pass: "rules-v1+purpose",
  generated_at: new Date().toISOString(),
  components,
  wires,
};

const outPath = enrichmentCachePath(root);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
resetWireEnrichmentCache();

console.log(
  `enrich:wires → ${outPath}\n  components=${Object.keys(components).length} wires_plain=${plainCount}`,
);
db.close();
