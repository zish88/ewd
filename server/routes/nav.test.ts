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

test("nav components in zone list have wires under same zone", async () => {
  const app = fixture();
  const list = await request(app).get("/api/nav/components?zone=front_doors");
  assert.equal(list.status, 200);
  const codes = list.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(codes.length >= 1);
  for (const code of codes) {
    const wires = await request(app).get(
      `/api/nav/wires?code=${encodeURIComponent(code)}&zone=front_doors`,
    );
    assert.equal(wires.status, 200);
    const n = (wires.body.owner_wires?.length || 0) + (wires.body.transit_wires?.length || 0);
    assert.ok(n >= 1, `${code} listed in front_doors but wires empty`);
  }
});

test("nav components omit home_zone native without zone wires", async () => {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)",
  ).run(enId, 1, "Connector 74/9", "connector");
  db.prepare(
    "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
  ).run("74/9", "Разъем", "Orphan door native", "front_doors");
  const app = express();
  app.use("/api/nav", createNavRouter(db));
  const res = await request(app).get("/api/nav/components?zone=front_doors");
  assert.equal(res.status, 200);
  const codes = res.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(!codes.includes("74/9"), "home_zone-only without wires must not list");
});

test("nav components prefer home_zone natives and hide foreign home_zone", async () => {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  const page = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 10, "Connector 74/1", "connector").lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
  ).run("74/1", "Разъем", "Door", "front_doors");
  db.prepare(
    "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
  ).run("74/2", "Разъем", "Engine", "engine");
  const doorId = Number(
    (db.prepare("SELECT id FROM components WHERE component_code='74/1'").get() as { id: number }).id,
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
    page,
    "1",
    "BK",
    "Черный",
    "",
    "74/1:1",
    "74/2:1",
    "74/1:1",
    "74/2:1",
    "",
    "74/1",
    "connector_pinout",
    0,
    0,
    50,
    doorId,
    null,
    null,
    "Harness front door",
    "Dashboard harness",
    null,
    0,
  );
  const app = express();
  app.use("/api/nav", createNavRouter(db));
  const res = await request(app).get("/api/nav/components?zone=front_doors");
  assert.equal(res.status, 200);
  const codes = res.body.groups.flatMap((g: { items: Array<{ code: string; home_zone?: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(codes.includes("74/1"));
  assert.ok(!codes.includes("74/2"), `engine home_zone must stay out: ${codes.join(",")}`);
});

test("nav components front_bumper does not list steering peer SCL", async () => {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  const page = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 100, "Connector 74/411", "connector").lastInsertRowid,
  );
  const pam = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("4/86", "Блок", "", "Parking Assistance Module (PAM)")
      .lastInsertRowid,
  );
  const scl = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("4/102", "Блок", "", "Steering Column Lock Module (SCL)")
      .lastInsertRowid,
  );
  const conn = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("74/411", "Промежуточный разъем жгута", "", "Connector")
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
    page,
    "1",
    "BN",
    "Коричневый",
    "",
    "4/102:1 — Steering Column Lock Module (SCL)",
    "4/86:1 — Parking Assistance Module (PAM)",
    "4/102:1",
    "4/86:1",
    "",
    "74/411",
    "connector_pinout",
    0,
    0,
    50,
    scl,
    pam,
    null,
    "Harness bumper, front",
    "Dashboard harness",
    null,
    0,
  );
  // silence unused if tree-shaken — conn is the subject owner via subject_code
  void conn;

  const app = express();
  app.use("/api/nav", createNavRouter(db));
  const res = await request(app).get("/api/nav/components?zone=front_bumper");
  assert.equal(res.status, 200);
  const codes = res.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(codes.includes("74/411"), `expected owner connector, got ${codes.join(",")}`);
  assert.ok(codes.includes("4/86"), `PAM detail belongs to bumper, got ${codes.join(",")}`);
  assert.ok(!codes.includes("4/102"), `SCL must not appear in bumper list, got ${codes.join(",")}`);
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

test("nav wires owner kept under zone when harness empty (connector title)", async () => {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  const page = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 247, "Разъем 74/507 (12-конт., серый)", "connector").lastInsertRowid,
  );
  const conn = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_ru, description_en) VALUES (?, ?, ?, ?)",
      )
      .run("74/507", "Промежуточный разъем жгута", "", "Connector")
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
    page,
    "13",
    "VT-RD",
    "Фиолетово-Красный",
    "",
    "",
    "",
    "",
    "",
    "",
    "74/507",
    "connector_pinout",
    1,
    0,
    100,
    null,
    conn,
    null,
    "",
    "",
    null,
    0,
  );
  const app = express();
  app.use("/api/nav", createNavRouter(db));
  const res = await request(app).get("/api/nav/wires?code=74/507&zone=front_doors");
  assert.equal(res.status, 200);
  assert.ok(res.body.owner_wires.length >= 1, "owner pins must survive empty-harness zone filter");
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

/** Capital harness ids (14240_RL / 14014) must populate zone dropdowns — not collapse to empty. */
test("nav components Capital harness ids: rear_doors non-empty, no engine ECM peer", async () => {
  const db = openDatabase(":memory:");
  const enId = Number(
    db.prepare("INSERT INTO manuals(filename, language) VALUES (?, ?)").run("en.pdf", "EN").lastInsertRowid,
  );
  const page = Number(
    db
      .prepare("INSERT INTO pages(manual_id, source_page, system_name, page_type) VALUES (?, ?, ?, ?)")
      .run(enId, 1, "Door module", "connector").lastInsertRowid,
  );
  const door = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
      )
      .run("3/128", "Модуль", "RL door", "rear_doors")
      .lastInsertRowid,
  );
  const ecm = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
      )
      .run("4/46", "Блок", "ECM", "engine")
      .lastInsertRowid,
  );
  const floorMod = Number(
    db
      .prepare(
        "INSERT INTO components(component_code, component_type_ru, description_en, home_zone) VALUES (?, ?, ?, ?)",
      )
      .run("4/9", "Блок", "Floor CEM", "floor")
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
    page,
    "1",
    "BN",
    "Коричневый",
    "",
    "3/128:1",
    "74/509:1",
    "",
    "",
    "",
    "3/128",
    "capital",
    1,
    0,
    95,
    door,
    null,
    null,
    "14240_RL",
    "",
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
    page,
    "2",
    "RD",
    "Красный",
    "",
    "4/46:1",
    "15/31:1",
    "",
    "",
    "",
    "4/46",
    "capital",
    1,
    0,
    95,
    ecm,
    null,
    null,
    "12A690",
    "",
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
    page,
    "3",
    "BK",
    "Черный",
    "",
    "4/9:1",
    "31/10:1",
    "",
    "",
    "",
    "4/9",
    "capital",
    1,
    0,
    95,
    floorMod,
    null,
    null,
    "14014",
    "",
    null,
    0,
  );
  const app = express();
  app.use("/api/nav", createNavRouter(db));

  const rear = await request(app).get("/api/nav/components?zone=rear_doors");
  assert.equal(rear.status, 200);
  const rearCodes = rear.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(rearCodes.includes("3/128"), `rear_doors empty or missing 3/128: ${rearCodes}`);
  assert.ok(!rearCodes.includes("4/46"), "ECM must not appear in rear_doors");
  assert.ok(!rearCodes.includes("4/9"), "floor module must not appear in rear_doors");

  const wires = await request(app).get("/api/nav/wires?code=3%2F128&zone=rear_doors");
  assert.ok((wires.body.owner_wires?.length || 0) >= 1);

  const floor = await request(app).get("/api/nav/components?zone=floor");
  const floorCodes = floor.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(floorCodes.includes("4/9"), `floor empty or missing 4/9: ${floorCodes}`);
  assert.ok(!floorCodes.includes("3/128"));

  const eng = await request(app).get("/api/nav/components?zone=engine");
  const engCodes = eng.body.groups.flatMap((g: { items: Array<{ code: string }> }) =>
    g.items.map((i) => i.code),
  );
  assert.ok(engCodes.includes("4/46"), `engine empty or missing 4/46: ${engCodes}`);
  assert.ok(!engCodes.includes("3/128"));
});
