import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { openDatabase } from "../db/schema.js";
import { createLocationRouter, createSearchRouter } from "./search.js";

function fixture() {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );

  const connPage = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 247, "Connector 74/507 (26-pin black)", "connector").lastInsertRowid,
  );
  const ddm = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("3/126", "Выключатель/Кнопка", "", "Driver Door Module (DDM)")
      .lastInsertRowid,
  );
  const fuse = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("11/8", "Предохранитель", "Предохранитель в салонном блоке", "")
      .lastInsertRowid,
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
    "21",
    "VT-RD",
    "Фиолетово-Красный",
    "Driver Door Module (DDM), LHD",
    "3/126C1:2 — Driver Door Module (DDM), LHD",
    "11C/8:2 — Fuse CEM (LHD)",
    "3/126C1:2",
    "11C/8:2",
    "LHD",
    "74/507",
    "connector_pinout",
    1,
    0,
    100,
    ddm,
    fuse,
    null,
    "Harness front door",
    "Dashboard harness",
    null,
    42,
  );
  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connPage,
    "22",
    "—",
    "—",
    "",
    "",
    "",
    "",
    "",
    "",
    "74/507",
    "connector_pinout",
    0,
    1,
    25,
    null,
    null,
    null,
  );

  const diagramPage = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 250, "Harness rear door right", "diagram").lastInsertRowid,
  );
  const fromId = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("3/129", "Выключатель/Кнопка", "Модуль правой задней двери", "Right rear door module (RDM)")
      .lastInsertRowid,
  );
  const toId = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("6/25", "Электромотор", "", "Window motor")
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    diagramPage,
    "7",
    "GN-BK",
    "Зеленый-Черный",
    "Питание",
    "",
    "",
    "",
    "",
    "",
    "",
    "wiring_diagram",
    0,
    0,
    100,
    fromId,
    toId,
    null,
  );

  const hornPage = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 120, "Horn", "diagram").lastInsertRowid,
  );
  const hornComp = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("16/10", "Звук/Гудок", "", "Horn")
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO wire_connections(
      page_id, pin_number, wire_color_raw, wire_color_ru, function_text,
      from_detail, to_detail, from_token, to_token, steering_side, subject_code, source_kind,
      is_verified, requires_manual_review, integrity_score,
      from_component_id, to_component_id, via_component_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hornPage, "—", "—", "—", "", "", "", "", "", "", "", "wiring_diagram", 0, 1, 25, hornComp, null, null);

  const app = express();
  app.use("/api/search", createSearchRouter(db));
  app.use("/api/location", createLocationRouter(db));
  return app;
}

test("connector search: atomic cards, score DESC, verified on top", async () => {
  const response = await request(fixture()).get("/api/search?q=74/507");
  assert.equal(response.status, 200);
  const results = response.body.results;
  assert.ok(results.length >= 2);
  assert.equal(results[0].score, 100);
  assert.equal(results[0].pin_number, "21");
  assert.equal(results[0].steering_side, "LHD");
  assert.equal(results[0].is_verified, 1);
  assert.equal(results[0].from_node, "3/126");
  assert.ok(results[0].score >= results[results.length - 1].score);
});

test("code search 3/126 finds pinout row", async () => {
  const response = await request(fixture()).get("/api/search?q=3/126");
  assert.equal(response.status, 200);
  assert.ok(response.body.results.some((r: { pin_number: string }) => r.pin_number === "21"));
});

test("diagram code search returns from/to", async () => {
  const response = await request(fixture()).get("/api/search?q=3/129");
  assert.equal(response.status, 200);
  assert.ok(response.body.results.length >= 1);
  assert.equal(response.body.results[0].from_node, "3/129");
  assert.equal(response.body.results[0].to_node, "6/25");
});

test("bilingual phrase AND search finds rear right door", async () => {
  const response = await request(fixture()).get(encodeURI("/api/search?q=задняя правая дверь"));
  assert.equal(response.status, 200);
  assert.ok(response.body.results.length >= 1);
  assert.equal(response.body.results[0].from_node, "3/129");
});

test("horn preset returns 16/* on diagram pages", async () => {
  const response = await request(fixture()).get("/api/location/horn");
  assert.equal(response.status, 200);
  assert.ok(response.body.results.some((r: { component_code: string }) => r.component_code === "16/10"));
});

test("fuses type endpoint works", async () => {
  const response = await request(fixture()).get("/api/location?type=fuses");
  assert.equal(response.status, 200);
  assert.equal(response.body.page_type, "fuses");
});
