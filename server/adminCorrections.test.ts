import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  applyAllCorrections,
  applyWirePatch,
  closeAdminCorrectionsStore,
  isNightlySyncWindow,
  moscowHour,
  upsertCorrection,
} from "./adminCorrections.js";

const dirs: string[] = [];

afterEach(() => {
  closeAdminCorrectionsStore();
  while (dirs.length) {
    const d = dirs.pop();
    if (!d) continue;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* Windows may keep WAL briefly */
    }
  }
  delete process.env.ADMIN_CORRECTIONS_PATH;
  delete process.env.DATABASE_PATH;
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ewd-corr-"));
  dirs.push(dir);
  process.env.ADMIN_CORRECTIONS_PATH = join(dir, "admin-corrections.sqlite");
  process.env.DATABASE_PATH = join(dir, "wiring.sqlite");

  const wiring = new Database(process.env.DATABASE_PATH);
  wiring.exec(`
    CREATE TABLE components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_code TEXT NOT NULL UNIQUE,
      component_type_ru TEXT NOT NULL DEFAULT '',
      description_ru TEXT NOT NULL DEFAULT '',
      description_en TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE pages (id INTEGER PRIMARY KEY);
    INSERT INTO pages(id) VALUES (1);
    CREATE TABLE wire_connections (
      id INTEGER PRIMARY KEY,
      page_id INTEGER NOT NULL,
      pin_number TEXT NOT NULL DEFAULT '—',
      wire_color_raw TEXT NOT NULL DEFAULT '—',
      wire_color_ru TEXT NOT NULL DEFAULT '—',
      function_text TEXT NOT NULL DEFAULT '',
      from_detail TEXT NOT NULL DEFAULT '',
      to_detail TEXT NOT NULL DEFAULT '',
      from_token TEXT NOT NULL DEFAULT '',
      to_token TEXT NOT NULL DEFAULT '',
      subject_code TEXT NOT NULL DEFAULT '',
      source_kind TEXT NOT NULL DEFAULT '',
      is_verified INTEGER NOT NULL DEFAULT 0,
      from_component_id INTEGER,
      to_component_id INTEGER,
      harness_left TEXT NOT NULL DEFAULT '',
      harness_right TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO wire_connections(id, page_id, pin_number, wire_color_raw, function_text, subject_code)
    VALUES (10, 1, '1', 'BN', 'old', '74/100');
  `);
  return wiring;
}

describe("adminCorrections", () => {
  it("applies patch and survives re-apply after wiring wipe", () => {
    const wiring = setup();
    assert.equal(
      applyWirePatch(wiring, 10, {
        pin_number: "5",
        wire_color_raw: "GN-YE",
        function_text: "fixed",
        from_code: "3/1",
        to_code: "4/2",
        from_detail: "от 3/1",
        to_detail: "к 4/2",
      }),
      true,
    );
    upsertCorrection({
      wireId: 10,
      ticketId: 7,
      patch: {
        pin_number: "5",
        wire_color_raw: "GN-YE",
        function_text: "fixed",
        from_code: "3/1",
        to_code: "4/2",
        from_detail: "от 3/1",
        to_detail: "к 4/2",
      },
    });

    const row = wiring.prepare(`SELECT pin_number, wire_color_raw, function_text FROM wire_connections WHERE id=10`).get() as {
      pin_number: string;
      wire_color_raw: string;
      function_text: string;
    };
    assert.equal(row.pin_number, "5");
    assert.equal(row.wire_color_raw, "GN-YE");
    assert.equal(row.function_text, "fixed");

    // Simulate fixdb: restore stock row
    wiring.prepare(`UPDATE wire_connections SET pin_number='1', wire_color_raw='BN', function_text='old' WHERE id=10`).run();
    const sync = applyAllCorrections(wiring, "test-reapply");
    assert.equal(sync.applied, 1);
    const again = wiring.prepare(`SELECT pin_number, function_text FROM wire_connections WHERE id=10`).get() as {
      pin_number: string;
      function_text: string;
    };
    assert.equal(again.pin_number, "5");
    assert.equal(again.function_text, "fixed");
    wiring.close();
  });

  it("nightly window is 03–04 Moscow hours", () => {
    // 2026-07-24 00:30 UTC = 03:30 Moscow (MSD/MSK +3)
    const inWindow = new Date("2026-07-24T00:30:00.000Z");
    assert.equal(moscowHour(inWindow), 3);
    assert.equal(isNightlySyncWindow(inWindow), true);
    const outside = new Date("2026-07-24T10:00:00.000Z");
    assert.equal(isNightlySyncWindow(outside), false);
  });
});
