import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PageType = "diagram" | "fuses" | "locations" | "connector" | "reference";

const LEGACY_DROP_SQL = `
  DROP TRIGGER IF EXISTS pages_ai;
  DROP TRIGGER IF EXISTS pages_ad;
  DROP TRIGGER IF EXISTS pages_au;
  DROP TABLE IF EXISTS page_search;
  DROP TABLE IF EXISTS wire_references;
  DROP TABLE IF EXISTS page_vehicle_applications;
  DROP TABLE IF EXISTS search_aliases;
  DROP TABLE IF EXISTS entities;
  DROP TABLE IF EXISTS connector_pin_routes;
  DROP TABLE IF EXISTS spatial_tokens;
  DROP TABLE IF EXISTS user_overrides;
  DROP TABLE IF EXISTS enriched_wires;
`;

const CORE_DDL = `
  CREATE TABLE IF NOT EXISTS manuals (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL CHECK(language IN ('EN', 'RU'))
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY,
    manual_id INTEGER NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
    source_page INTEGER NOT NULL,
    system_name TEXT NOT NULL DEFAULT '',
    page_type TEXT NOT NULL DEFAULT 'diagram'
      CHECK(page_type IN ('diagram', 'fuses', 'locations', 'connector', 'reference')),
    UNIQUE(manual_id, source_page)
  );

  CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY,
    component_code TEXT NOT NULL UNIQUE,
    component_type_ru TEXT NOT NULL DEFAULT '',
    description_ru TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    name_ru TEXT NOT NULL DEFAULT '',
    part_number TEXT NOT NULL DEFAULT '',
    home_zone TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS wire_connections (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    pin_number TEXT NOT NULL DEFAULT '—',
    wire_color_raw TEXT NOT NULL DEFAULT '—',
    wire_color_ru TEXT NOT NULL DEFAULT '—',
    function_text TEXT NOT NULL DEFAULT '',
    from_detail TEXT NOT NULL DEFAULT '',
    to_detail TEXT NOT NULL DEFAULT '',
    from_token TEXT NOT NULL DEFAULT '',
    to_token TEXT NOT NULL DEFAULT '',
    steering_side TEXT NOT NULL DEFAULT '',
    subject_code TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT '',
    is_verified INTEGER NOT NULL DEFAULT 0,
    requires_manual_review INTEGER NOT NULL DEFAULT 0,
    integrity_score INTEGER NOT NULL DEFAULT 0,
    from_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
    to_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
    via_component_id INTEGER REFERENCES components(id) ON DELETE SET NULL,
    harness_left TEXT NOT NULL DEFAULT '',
    harness_right TEXT NOT NULL DEFAULT '',
    diagram_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
    diagram_source_page INTEGER NOT NULL DEFAULT 0,
    voltage TEXT NOT NULL DEFAULT '',
    wire_gauge TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS component_diagram_pages (
    component_code TEXT NOT NULL,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    source_page INTEGER NOT NULL,
    system_name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (component_code, page_id)
  );
  CREATE INDEX IF NOT EXISTS component_diagram_code ON component_diagram_pages(component_code);

  CREATE INDEX IF NOT EXISTS pages_type_lookup ON pages(page_type, manual_id, source_page);
  CREATE INDEX IF NOT EXISTS wire_connections_page ON wire_connections(page_id);
  CREATE INDEX IF NOT EXISTS wire_connections_from ON wire_connections(from_component_id);
  CREATE INDEX IF NOT EXISTS wire_connections_to ON wire_connections(to_component_id);
  CREATE INDEX IF NOT EXISTS wire_connections_via ON wire_connections(via_component_id);

  CREATE TABLE IF NOT EXISTS pending_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    model TEXT NOT NULL,
    year TEXT NOT NULL,
    engine TEXT NOT NULL,
    location_name TEXT NOT NULL,
    pin_number TEXT NOT NULL,
    wire_color TEXT NOT NULL,
    source_block TEXT NOT NULL,
    source_pin TEXT,
    destination_block TEXT NOT NULL,
    destination_pin TEXT,
    description TEXT NOT NULL,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected'))
  );
`;

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
    .get(name) as { ok?: number } | undefined;
  return Boolean(row?.ok);
}

/**
 * True only for incompatible pre-core schemas that cannot be ALTER-migrated.
 * Missing nav columns (harness_*, subject_code, …) must NOT trigger a wipe —
 * production wiring.sqlite often has thousands of wire rows without those columns.
 */
function needsLegacyMigration(db: Database.Database): boolean {
  if (tableExists(db, "connector_pin_routes") || tableExists(db, "entities") || tableExists(db, "page_search")) {
    return true;
  }
  if (!tableExists(db, "manuals")) return false;
  const cols = db.prepare("PRAGMA table_info(manuals)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (names.has("source_path") || !names.has("filename")) return true;
  if (!tableExists(db, "components") || !tableExists(db, "wire_connections")) return true;
  if (tableExists(db, "pages")) {
    const pageCols = db.prepare("PRAGMA table_info(pages)").all() as Array<{ name: string }>;
    if (pageCols.some((c) => c.name === "text")) return true;
    const pageSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pages'").get() as
        | { sql?: string }
        | undefined
    )?.sql;
    if (pageSql && !pageSql.includes("'connector'")) return true;
  }
  // Partial core schema: keep data and add missing columns in ensureNavColumns
  return false;
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
  existing: Set<string>,
) {
  if (existing.has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  existing.add(column);
}

/** Additive migration: align older wiring.sqlite files to current nav/EWD columns. */
function ensureNavColumns(db: Database.Database) {
  if (tableExists(db, "wire_connections")) {
    const wireCols = db.prepare("PRAGMA table_info(wire_connections)").all() as Array<{ name: string }>;
    const wnames = new Set(wireCols.map((c) => c.name));
    addColumnIfMissing(db, "wire_connections", "from_token", `from_token TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "to_token", `to_token TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "steering_side", `steering_side TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "subject_code", `subject_code TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "source_kind", `source_kind TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "is_verified", `is_verified INTEGER NOT NULL DEFAULT 0`, wnames);
    addColumnIfMissing(
      db,
      "wire_connections",
      "requires_manual_review",
      `requires_manual_review INTEGER NOT NULL DEFAULT 0`,
      wnames,
    );
    addColumnIfMissing(db, "wire_connections", "integrity_score", `integrity_score INTEGER NOT NULL DEFAULT 0`, wnames);
    addColumnIfMissing(db, "wire_connections", "harness_left", `harness_left TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "harness_right", `harness_right TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(
      db,
      "wire_connections",
      "diagram_page_id",
      `diagram_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL`,
      wnames,
    );
    addColumnIfMissing(
      db,
      "wire_connections",
      "diagram_source_page",
      `diagram_source_page INTEGER NOT NULL DEFAULT 0`,
      wnames,
    );
    addColumnIfMissing(db, "wire_connections", "voltage", `voltage TEXT NOT NULL DEFAULT ''`, wnames);
    addColumnIfMissing(db, "wire_connections", "wire_gauge", `wire_gauge TEXT NOT NULL DEFAULT ''`, wnames);

    // Backfill subject_code from connector page titles when empty (e.g. "Connector 74/507")
    try {
      db.exec(`
        UPDATE wire_connections
        SET subject_code = (
          SELECT TRIM(
            CASE
              WHEN p.system_name LIKE 'Connector %' THEN substr(p.system_name, 11)
              WHEN p.system_name LIKE 'Разъем %' THEN substr(p.system_name, 8)
              ELSE ''
            END
          )
          FROM pages p
          WHERE p.id = wire_connections.page_id
        )
        WHERE TRIM(IFNULL(subject_code,'')) = ''
          AND EXISTS (
            SELECT 1 FROM pages p2
            WHERE p2.id = wire_connections.page_id
              AND (
                p2.system_name LIKE 'Connector %/%'
                OR p2.system_name LIKE 'Разъем %/%'
              )
          )
      `);
      // Normalize "74/507" / "74/507 …" → first code token
      db.exec(`
        UPDATE wire_connections
        SET subject_code = TRIM(CASE
          WHEN instr(subject_code, ' ') > 0 THEN substr(subject_code, 1, instr(subject_code, ' ') - 1)
          ELSE subject_code
        END)
        WHERE TRIM(IFNULL(subject_code,'')) != ''
          AND subject_code GLOB '[0-9]*/[0-9]*'
      `);
    } catch {
      /* best-effort backfill */
    }
  }

  if (tableExists(db, "components")) {
    const compCols = db.prepare("PRAGMA table_info(components)").all() as Array<{ name: string }>;
    const cnames = new Set(compCols.map((c) => c.name));
    addColumnIfMissing(db, "components", "name_ru", `name_ru TEXT NOT NULL DEFAULT ''`, cnames);
    addColumnIfMissing(db, "components", "part_number", `part_number TEXT NOT NULL DEFAULT ''`, cnames);
    addColumnIfMissing(db, "components", "home_zone", `home_zone TEXT NOT NULL DEFAULT ''`, cnames);
  }
}

function wipeLegacyCore(db: Database.Database) {
  db.exec(LEGACY_DROP_SQL);
  db.exec(`
    DROP TABLE IF EXISTS wire_connections;
    DROP TABLE IF EXISTS component_diagram_pages;
    DROP TABLE IF EXISTS components;
    DROP TABLE IF EXISTS pages;
    DROP TABLE IF EXISTS manuals;
  `);
}

function countRows(db: Database.Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  } catch {
    return 0;
  }
}

export function openDatabase(filename = process.env.DATABASE_PATH ?? "data/wiring.sqlite") {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (needsLegacyMigration(db)) {
    const rows = countRows(db, "components") + countRows(db, "wire_connections") + countRows(db, "pages");
    // Never destroy a populated production DB over a false-positive legacy check.
    if (rows === 0) {
      wipeLegacyCore(db);
    } else {
      console.warn(
        `[db] Skipping legacy wipe: detected ${rows} rows in core tables (path=${filename}). Using additive migration only.`,
      );
    }
  }

  db.exec(CORE_DDL);
  ensureNavColumns(db);
  return db;
}

/** Universal page classifier — connector / fuses / locations / diagram */
export function classifyPageType(systemName: string | null | undefined, text: string | null | undefined): PageType {
  const title = String(systemName || "").toLowerCase();
  const hay = `${systemName || ""}\n${text || ""}`.toLowerCase();

  if (
    /^разъем\s+\d+\//i.test(String(systemName || "").trim()) ||
    /^connector\s+\d+\//i.test(String(systemName || "").trim())
  ) {
    return "connector";
  }
  if (
    /(?:\bno\.?\b|№)/i.test(hay) &&
    (/\bharness\b|жгут|контактный\s*разъем|\bconnectors?\b|\d+-pin|\d+-полюс/i.test(hay) ||
      /\d+\/\d+/.test(hay))
  ) {
    if (!/\bfuses\b|предохранител/i.test(title) || /разъем\s+\d+\//i.test(String(systemName || ""))) {
      if (
        /(?:\bno\.?\b|№)/i.test(hay) &&
        (/\bharness\b|жгут|контактный\s*разъем|\bconnectors?\b|разъем\s+\d+\//i.test(hay) ||
          /\d+-pin|\d+-полюс/i.test(hay))
      ) {
        return "connector";
      }
    }
  }

  if (
    /overview\s*locations|обзор\s*размещен|component\s*illustrations|ground\s*connections|узловые\s*соединения|component\s*locations?|locations?\s*of\s*components?|components?\s*location|расположение\s*компонент|карта\s*расположен/.test(
      title,
    )
  ) {
    return "locations";
  }
  if (/\bfuses\b|\brelays\b|distribution\s*box|предохранител|\bреле\b|токораспред/.test(hay)) return "fuses";
  if (
    /component\s*locations?|locations?\s*of\s*components?|components?\s*location|расположение\s*компонент|карта\s*расположен|overview\s*locations|обзор\s*размещен/.test(
      hay,
    )
  ) {
    return "locations";
  }
  if (/\bindex\b/.test(hay) && /component|location|расположен|кузов|\bbody\b/.test(hay) && !/\bfuses?\b|\brelays?\b/.test(hay)) {
    return "locations";
  }
  if (
    /overview\s+designations|list\s+of\s+components|\babbreviations\b|table\s+of\s+contents|^explanations\b|how\s+to\s+use\s+the\s+wiring|branching\s+points|^structure\s+week\b|vehicles\s+with\s+srs|control\s+modules\s+overview\s+designations|list\s+of\s+fuses|list\s+of\s+relays/i.test(
      hay,
    )
  ) {
    return "reference";
  }
  return "diagram";
}
