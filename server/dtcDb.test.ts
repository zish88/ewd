import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { before, describe, it } from "node:test";
import Database from "better-sqlite3";
import express from "express";
import request from "supertest";
import { getDtcByCode, getDtcDetails } from "./dtcDb.js";
import { createDtcRouter } from "./routes/dtc.js";
import { createObdRouter } from "./routes/obd.js";

describe("DTC exact OBD lookup", () => {
  const tmp = mkdtempSync(join(tmpdir(), "volvo-dtc-"));
  const dbPath = join(tmp, "dtc.sqlite");

  before(() => {
    process.env.DTC_DATABASE_PATH = dbPath;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE dtc_codes (
        code TEXT PRIMARY KEY,
        ecu TEXT NOT NULL DEFAULT '',
        obd_code TEXT NOT NULL DEFAULT '',
        title_ru TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        variants INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE dtc_entries (
        id INTEGER PRIMARY KEY,
        ie_id TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL,
        ecu TEXT NOT NULL DEFAULT '',
        obd_code TEXT NOT NULL DEFAULT '',
        title_ru TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'vida_diagswdl'
      );
    `);
    db.prepare(
      `
      INSERT INTO dtc_codes (code, ecu, obd_code, title_ru, title_en, variants)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "ECM-P042000",
      "ECM",
      "P0420",
      "Эффективность катализатора ниже порога",
      "Catalyst system efficiency below threshold",
      2,
    );
    db.prepare(
      `
      INSERT INTO dtc_entries (ie_id, code, ecu, obd_code, title_ru, title_en, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "ie-1",
      "ECM-P042000",
      "ECM",
      "P0420",
      "Эффективность катализатора ниже порога, прерывистая неисправность",
      "Catalyst efficiency below threshold, intermittent fault",
      "vida_diagswdl",
    );
    db.prepare(
      `
      INSERT INTO dtc_entries (ie_id, code, ecu, obd_code, title_ru, title_en, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "ie-2",
      "ECM-P042000",
      "ECM",
      "P0420",
      "Эффективность катализатора ниже порога, постоянная неисправность",
      "Catalyst efficiency below threshold, permanent fault",
      "vida_diagswdl",
    );
    db.close();
  });

  it("falls back to obd_code for plain exact lookup", () => {
    const row = getDtcByCode("P0420");
    assert.ok(row);
    assert.equal(row.code, "ECM-P042000");
    assert.equal(row.obd_code, "P0420");
    assert.equal(row.variants, 2);
  });

  it("returns detail metadata and matched_by=obd_code", async () => {
    const app = express();
    app.use("/api/dtc", createDtcRouter());

    const res = await request(app).get("/api/dtc/code/P0420/details");
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.code, "ECM-P042000");
    assert.equal(res.body.matched_by, "obd_code");
    assert.equal(res.body.entries.length, 2);
    assert.ok(res.body.entries.some((entry: { fault_state?: string }) => entry.fault_state === "intermittent"));
    assert.ok(res.body.entries.some((entry: { fault_state?: string }) => entry.fault_state === "permanent"));
  });

  it("enriches plain OBD codes through the adapter route", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/obd", createObdRouter());

    const res = await request(app)
      .post("/api/obd/enrich")
      .send({ dtcs: [{ ecu: "ECM", code: "P0420", status: "confirmed" }] });

    assert.equal(res.status, 200);
    assert.equal(res.body.dtcs[0].code, "P0420");
    assert.equal(res.body.dtcs[0].obd_code, "P0420");
    assert.equal(res.body.dtcs[0].dict_ecu, "ECM");
    assert.match(res.body.dtcs[0].title_ru, /катализатора/i);
  });

  it("still exposes matched_by=obd_code from the direct helper", () => {
    const details = getDtcDetails("P0420");
    assert.ok(details);
    assert.equal(details.matched_by, "obd_code");
    assert.equal(details.entries.length, 2);
  });
});
