/**
 * Diagnostic: verify wiring.sqlite against the real schema (no pages.zone column).
 * Zone membership comes from wire_connections.harness_* and/or pages.system_name.
 */
import Database from "better-sqlite3";
import { resolve } from "node:path";

const dbPath = process.env.DATABASE_PATH || resolve("data/wiring.sqlite");
const db = new Database(dbPath, { readonly: true });

console.log("=== 1. COUNTS ===");
for (const table of ["components", "pages", "wire_connections", "component_diagram_pages", "manuals"]) {
  try {
    console.log(`- ${table}:`, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
  } catch (e) {
    console.log(`- ${table}: [ERR]`, e.message);
  }
}

console.log("\n=== 2. KEY COLUMNS ===");
for (const table of ["components", "pages", "wire_connections"]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  console.log(table, cols.join(", "));
}

console.log("\n=== 3. HARNESS / SUBJECT FILL ===");
try {
  console.log(
    "harness non-empty",
    db
      .prepare(
        `SELECT count(*) AS n FROM wire_connections
         WHERE TRIM(IFNULL(harness_left,'')) != '' OR TRIM(IFNULL(harness_right,'')) != ''`,
      )
      .get(),
  );
  console.log(
    "subject_code non-empty",
    db.prepare(`SELECT count(*) AS n FROM wire_connections WHERE TRIM(IFNULL(subject_code,'')) != ''`).get(),
  );
  console.log(
    "top subjects",
    db
      .prepare(
        `SELECT subject_code, count(*) AS n FROM wire_connections
         WHERE TRIM(IFNULL(subject_code,'')) != ''
         GROUP BY subject_code ORDER BY n DESC LIMIT 10`,
      )
      .all(),
  );
} catch (e) {
  console.log("[ERR]", e.message);
}

db.close();
