/**
 * Durable admin wire corrections (survives fixdb / git checkout of wiring.sqlite).
 * Live SAVE applies to wiring.sqlite immediately; nightly job re-applies the overlay.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type WirePatch = {
  pin_number?: string;
  wire_color_raw?: string;
  wire_color_ru?: string;
  function_text?: string;
  from_detail?: string;
  to_detail?: string;
  from_token?: string;
  to_token?: string;
  from_code?: string;
  to_code?: string;
  subject_code?: string;
  harness_left?: string;
  harness_right?: string;
};

export type CorrectionRow = {
  id: number;
  wire_id: number;
  ticket_id: number | null;
  payload: string;
  created_at: string;
  updated_at: string;
  last_applied_at: string | null;
};

let correctionsDb: Database.Database | null = null;
let correctionsDbOpenedPath = "";
let nightlyTimer: ReturnType<typeof setInterval> | null = null;

function correctionsDbPath(): string {
  if (process.env.ADMIN_CORRECTIONS_PATH) {
    return resolve(process.env.ADMIN_CORRECTIONS_PATH);
  }
  const wiring = resolve(process.env.DATABASE_PATH ?? "data/wiring.sqlite");
  return resolve(dirname(wiring), "admin-corrections.sqlite");
}

function openCorrectionsDb(): Database.Database {
  const path = correctionsDbPath();
  if (correctionsDb && correctionsDbOpenedPath === path) return correctionsDb;
  if (correctionsDb) {
    try {
      correctionsDb.close();
    } catch {
      /* ignore */
    }
    correctionsDb = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS wire_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wire_id INTEGER NOT NULL UNIQUE,
      ticket_id INTEGER,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wire_corrections_updated ON wire_corrections(updated_at);
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ran_at TEXT NOT NULL DEFAULT (datetime('now')),
      applied_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT ''
    );
  `);
  correctionsDb = db;
  correctionsDbOpenedPath = path;
  return db;
}

export function ensureAdminCorrectionsStore(): void {
  openCorrectionsDb();
}

/** Close overlay DB (tests / shutdown). */
export function closeAdminCorrectionsStore(): void {
  if (!correctionsDb) return;
  try {
    correctionsDb.close();
  } catch {
    /* ignore */
  }
  correctionsDb = null;
  correctionsDbOpenedPath = "";
}

function ensureComponent(wiring: Database.Database, code: string): number | null {
  const c = String(code || "").trim();
  if (!c) return null;
  const row = wiring.prepare(`SELECT id FROM components WHERE component_code=?`).get(c) as
    | { id?: number }
    | undefined;
  if (row?.id) return Number(row.id);
  const info = wiring
    .prepare(
      `INSERT INTO components(component_code, component_type_ru, description_ru, description_en)
       VALUES (?, '', '', '')`,
    )
    .run(c);
  return Number(info.lastInsertRowid);
}

/** Apply one patch to wiring.sqlite. Returns false if wire row missing. */
export function applyWirePatch(wiring: Database.Database, wireId: number, patch: WirePatch): boolean {
  const existing = wiring.prepare(`SELECT id FROM wire_connections WHERE id=?`).get(wireId) as
    | { id?: number }
    | undefined;
  if (!existing?.id) return false;

  const fromCode = String(patch.from_code ?? patch.from_token ?? "").trim();
  const toCode = String(patch.to_code ?? patch.to_token ?? "").trim();
  const fromId = fromCode ? ensureComponent(wiring, fromCode) : null;
  const toId = toCode ? ensureComponent(wiring, toCode) : null;

  const colorRaw = String(patch.wire_color_raw ?? "").trim();
  const colorRu = String(patch.wire_color_ru ?? colorRaw ?? "").trim();

  wiring
    .prepare(
      `UPDATE wire_connections SET
         pin_number = COALESCE(?, pin_number),
         wire_color_raw = COALESCE(?, wire_color_raw),
         wire_color_ru = COALESCE(?, wire_color_ru),
         function_text = COALESCE(?, function_text),
         from_detail = COALESCE(?, from_detail),
         to_detail = COALESCE(?, to_detail),
         from_token = COALESCE(?, from_token),
         to_token = COALESCE(?, to_token),
         subject_code = COALESCE(?, subject_code),
         harness_left = COALESCE(?, harness_left),
         harness_right = COALESCE(?, harness_right),
         from_component_id = COALESCE(?, from_component_id),
         to_component_id = COALESCE(?, to_component_id),
         source_kind = CASE WHEN source_kind='' OR source_kind IS NULL THEN 'admin' ELSE source_kind END,
         is_verified = 1
       WHERE id = ?`,
    )
    .run(
      patch.pin_number != null ? String(patch.pin_number).trim() : null,
      colorRaw || null,
      colorRu || null,
      patch.function_text != null ? String(patch.function_text) : null,
      patch.from_detail != null ? String(patch.from_detail) : null,
      patch.to_detail != null ? String(patch.to_detail) : null,
      fromCode || (patch.from_token != null ? String(patch.from_token).trim() : null),
      toCode || (patch.to_token != null ? String(patch.to_token).trim() : null),
      patch.subject_code != null ? String(patch.subject_code).trim() : null,
      patch.harness_left != null ? String(patch.harness_left) : null,
      patch.harness_right != null ? String(patch.harness_right) : null,
      fromId,
      toId,
      wireId,
    );
  return true;
}

export function upsertCorrection(opts: {
  wireId: number;
  ticketId?: number | null;
  patch: WirePatch;
}): CorrectionRow {
  const db = openCorrectionsDb();
  const payload = JSON.stringify(opts.patch);
  db.prepare(
    `INSERT INTO wire_corrections(wire_id, ticket_id, payload, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(wire_id) DO UPDATE SET
       ticket_id = COALESCE(excluded.ticket_id, wire_corrections.ticket_id),
       payload = excluded.payload,
       updated_at = datetime('now')`,
  ).run(opts.wireId, opts.ticketId ?? null, payload);

  return db
    .prepare(`SELECT * FROM wire_corrections WHERE wire_id=?`)
    .get(opts.wireId) as CorrectionRow;
}

export function markCorrectionApplied(wireId: number): void {
  openCorrectionsDb()
    .prepare(`UPDATE wire_corrections SET last_applied_at=datetime('now') WHERE wire_id=?`)
    .run(wireId);
}

export function listCorrections(limit = 100): CorrectionRow[] {
  return openCorrectionsDb()
    .prepare(`SELECT * FROM wire_corrections ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as CorrectionRow[];
}

export function correctionsTodayCount(): number {
  const row = openCorrectionsDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM wire_corrections
       WHERE date(updated_at)=date('now')`,
    )
    .get() as { n: number };
  return Number(row.n) || 0;
}

export function lastSyncRun(): {
  ran_at: string;
  applied_count: number;
  skipped_count: number;
  note: string;
} | null {
  const row = openCorrectionsDb()
    .prepare(`SELECT ran_at, applied_count, skipped_count, note FROM sync_runs ORDER BY id DESC LIMIT 1`)
    .get() as
    | { ran_at: string; applied_count: number; skipped_count: number; note: string }
    | undefined;
  return row ?? null;
}

export function applyAllCorrections(
  wiring: Database.Database,
  note = "manual",
): { applied: number; skipped: number } {
  const rows = openCorrectionsDb()
    .prepare(`SELECT wire_id, payload FROM wire_corrections ORDER BY id ASC`)
    .all() as Array<{ wire_id: number; payload: string }>;

  let applied = 0;
  let skipped = 0;
  const tx = wiring.transaction(() => {
    for (const row of rows) {
      let patch: WirePatch;
      try {
        patch = JSON.parse(row.payload) as WirePatch;
      } catch {
        skipped += 1;
        continue;
      }
      if (applyWirePatch(wiring, Number(row.wire_id), patch)) {
        markCorrectionApplied(Number(row.wire_id));
        applied += 1;
      } else {
        skipped += 1;
      }
    }
  });
  tx();

  openCorrectionsDb()
    .prepare(
      `INSERT INTO sync_runs(ran_at, applied_count, skipped_count, note)
       VALUES (datetime('now'), ?, ?, ?)`,
    )
    .run(applied, skipped, note);

  return { applied, skipped };
}

/** Moscow wall-clock hour 0–23. */
export function moscowHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function moscowDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True if now is in the 03:00–04:59 Moscow window. */
export function isNightlySyncWindow(now = new Date()): boolean {
  const h = moscowHour(now);
  return h >= 3 && h < 5;
}

function alreadySyncedMoscowDay(now = new Date()): boolean {
  const last = lastSyncRun();
  if (!last || !String(last.note).startsWith("nightly")) return false;
  // ran_at is UTC sqlite datetime — compare Moscow calendar days via Date
  const ran = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(last.ran_at) ? last.ran_at : `${last.ran_at.replace(" ", "T")}Z`);
  if (Number.isNaN(ran.getTime())) return false;
  return moscowDateKey(ran) === moscowDateKey(now);
}

export function maybeRunNightlySync(wiring: Database.Database, now = new Date()): {
  ran: boolean;
  applied?: number;
  skipped?: number;
} {
  if (!isNightlySyncWindow(now)) return { ran: false };
  if (alreadySyncedMoscowDay(now)) return { ran: false };
  const result = applyAllCorrections(wiring, `nightly ${moscowDateKey(now)}`);
  console.info(
    `[admin-corrections] nightly sync ${moscowDateKey(now)}: applied=${result.applied} skipped=${result.skipped}`,
  );
  return { ran: true, ...result };
}

export function startNightlyCorrectionsScheduler(wiring: Database.Database): void {
  if (nightlyTimer) return;
  // Check every 10 minutes
  nightlyTimer = setInterval(() => {
    try {
      maybeRunNightlySync(wiring);
    } catch (e) {
      console.error("[admin-corrections] nightly sync failed:", e);
    }
  }, 10 * 60 * 1000);
  if (typeof nightlyTimer.unref === "function") nightlyTimer.unref();
  // Also try once shortly after boot (covers restart inside the window)
  setTimeout(() => {
    try {
      maybeRunNightlySync(wiring);
    } catch {
      /* ignore */
    }
  }, 15_000).unref?.();
}

export function correctionsStorePath(): string {
  return correctionsDbPath();
}

export function correctionsStoreExists(): boolean {
  return existsSync(correctionsDbPath());
}
