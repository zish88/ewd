/**
 * Fill empty components.name_ru from data/vida_components_ru.json (EPC lexicon).
 * Does not overwrite existing non-empty name_ru.
 */
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const lexPath = join(root, "data", "vida_components_ru.json");
const raw = JSON.parse(readFileSync(lexPath, "utf8")) as {
  components?: Record<string, string>;
};
const lex = raw.components || {};

function titleRu(s: string): string {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  // Keep leading digits/codes; soft-capitalize Cyrillic start
  if (/^[а-яё]/u.test(t)) return t.charAt(0).toLocaleUpperCase("ru") + t.slice(1);
  return t;
}

const db = new Database(join(root, "data", "wiring.sqlite"));
const rows = db
  .prepare(
    `SELECT id, component_code AS code FROM components
     WHERE trim(coalesce(name_ru,'')) = ''`,
  )
  .all() as Array<{ id: number; code: string }>;

const upd = db.prepare(`UPDATE components SET name_ru = ? WHERE id = ?`);
let updated = 0;
let missed = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    const name = titleRu(lex[r.code] || "");
    if (!name) {
      missed += 1;
      continue;
    }
    upd.run(name, r.id);
    updated += 1;
  }
});
tx();
db.close();

const report = {
  empty_before: rows.length,
  updated_from_lexicon: updated,
  still_empty: missed,
  lexicon_size: Object.keys(lex).length,
};
writeFileSync(join(root, "data", "reports", "p3-vida-name-fill.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
