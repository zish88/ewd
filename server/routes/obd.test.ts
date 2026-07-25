import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { createObdRouter } from "./obd.js";

describe("POST /api/obd/enrich", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/obd", createObdRouter());

  it("returns enriched list shape even when dictionary miss", async () => {
    const res = await request(app)
      .post("/api/obd/enrich")
      .send({
        dtcs: [{ ecu: "ECM", code: "P0420", status: "confirmed", raw: "042000:01" }],
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.dtcs[0].code, "P0420");
    assert.equal(res.body.dtcs[0].ecu, "ECM");
  });

  it("rejects oversized payloads", async () => {
    const dtcs = Array.from({ length: 201 }, (_, i) => ({ code: `P0${i}`, ecu: "ECM" }));
    const res = await request(app).post("/api/obd/enrich").send({ dtcs });
    assert.equal(res.status, 400);
  });
});
