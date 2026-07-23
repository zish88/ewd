import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { openDatabase } from "../db/schema.js";
import { createNavRouter } from "./nav.js";

function fixture() {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  const connPage = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 247, "Connector 74/507", "connector").lastInsertRowid,
  );
  const diagPage = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 276, "Central locking front doors", "diagram").lastInsertRowid,
  );
  const lock = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("3/74", "Выключатель/Кнопка", "", "Door lock")
      .lastInsertRowid,
  );
  const conn = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("74/507", "Промежуточный разъем жгута", "", "Connector")
      .lastInsertRowid,
  );
  const engineConn = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("74/301", "Промежуточный разъем жгута", "", "Engine connector")
      .lastInsertRowid,
  );

  // Owner pin on 74/507 that also mentions 3/74 (transit when querying 3/74)
  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id,
      harness_left, harness_right, diagram_page_id, diagram_source_page)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connPage,
    "13",
    "VT-RD",
    "Фиолетово-Красный",
    "",
    "3/74:1 — Door lock",
    "74/507:13 — Connector",
    "3/74:1",
    "74/507:13",
    "LHD",
    "74/507",
    "connector_pinout",
    1,
    0,
    100,
    lock,
    conn,
    null,
    "Harness front door",
    "Dashboard harness",
    diagPage,
    276,
  );

  // Extra owner-only pin (no 3/74)
  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id,
      harness_left, harness_right, diagram_page_id, diagram_source_page)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connPage,
    "1",
    "BK",
    "Черный",
    "",
    "16/1:1",
    "74/507:1",
    "16/1:1",
    "74/507:1",
    "",
    "74/507",
    "connector_pinout",
    0,
    0,
    75,
    null,
    conn,
    null,
    "Harness front door",
    "Floor harness",
    null,
    0,
  );

  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id,
      harness_left, harness_right, diagram_page_id, diagram_source_page)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connPage,
    "2",
    "YE",
    "Желтый",
    "",
    "74/301:1",
    "4/56:1",
    "74/301:1",
    "4/56:1",
    "",
    "74/301",
    "connector_pinout",
    0,
    0,
    75,
    engineConn,
    null,
    null,
    "Engine compartment harness",
    "Engine compartment harness",
    null,
    0,
  );

  db.prepare(
    `INSERT INTO component_diagram_pages(component_code, page_id, source_page, system_name)
     VALUES (?, ?, ?, ?)`,
  ).run("3/74", diagPage, 276, "Central locking front doors");

  const app = express();
  app.use("/api/nav", createNavRouter(db));
  return app;
}

test("nav zones lists front doors", async () => {
  const res = await request(fixture()).get("/api/nav/zones");
  assert.equal(res.status, 200);
  const door = res.body.zones.find((z: { id: string }) => z.id === "front_doors");
  assert.ok(door);
  assert.ok(door.count >= 1);
});

test("nav components zone filter hides engine connector", async () => {
  const res = await request(fixture()).get("/api/nav/components?zone=front_doors");
  assert.equal(res.status, 200);
  const codes = res.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(codes.includes("3/74") || codes.includes("74/507"));
  assert.ok(!codes.includes("74/301"));
});

test("nav wires 74/507 returns owner pins", async () => {
  const res = await request(fixture()).get("/api/nav/wires?code=74/507");
  assert.equal(res.status, 200);
  assert.ok(res.body.owner_wires.length >= 2);
  assert.equal(res.body.owner_wires[0].match_role, "owner");
  assert.ok(res.body.owner_wires.every((w: { subject_code: string }) => w.subject_code === "74/507"));
});

test("nav wires 3/74 returns transit + diagrams", async () => {
  const res = await request(fixture()).get("/api/nav/wires?code=3/74");
  assert.equal(res.status, 200);
  assert.equal(res.body.owner_wires.length, 0);
  assert.ok(res.body.transit_wires.length >= 1);
  assert.equal(res.body.transit_wires[0].match_role, "transit");
  assert.match(String(res.body.transit_wires[0].card_title), /3\/74/);
  assert.ok(res.body.diagrams.length >= 1);
  assert.equal(res.body.diagrams[0].page_number, 276);
});

test("nav wires zone front_doors excludes engine harness rows", async () => {
  const res = await request(fixture()).get("/api/nav/wires?code=74/301&zone=front_doors");
  assert.equal(res.status, 200);
  assert.equal(res.body.owner_wires.length, 0);
  assert.equal(res.body.transit_wires.length, 0);
});

test("nav wires zone engine keeps engine connector", async () => {
  const res = await request(fixture()).get("/api/nav/wires?code=74/301&zone=engine");
  assert.equal(res.status, 200);
  assert.ok(res.body.owner_wires.length >= 1);
  assert.ok(
    res.body.owner_wires.every(
      (w: { harness_left: string; harness_right: string }) =>
        /engine/i.test(w.harness_left) || /engine/i.test(w.harness_right),
    ),
  );
});

test("nav zones includes bumper and trunk", async () => {
  const res = await request(fixture()).get("/api/nav/zones");
  assert.equal(res.status, 200);
  const ids = res.body.zones.map((z: { id: string }) => z.id);
  assert.ok(ids.includes("front_bumper"));
  assert.ok(ids.includes("trunk"));
  assert.ok(ids.includes("engine"));
});

test("wireMatchesZone attributes engine+bumper cable to bumper not engine", async () => {
  const { wireMatchesZone } = await import("../harnessZones.js");
  const left = "Engine compartment harness";
  const right = "Harness bumper, front";
  assert.equal(wireMatchesZone(left, right, "front_bumper"), true);
  assert.equal(wireMatchesZone(left, right, "engine"), false);
  assert.equal(wireMatchesZone("Engine harness", "Engine harness", "engine"), true);
  assert.equal(wireMatchesZone("Engine harness", "Engine harness", "front_bumper"), false);
});
