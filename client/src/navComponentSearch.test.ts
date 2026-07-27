import test from "node:test";
import assert from "node:assert/strict";
import {
  expandNavSearchTokenGroups,
  filterNavGroupsByQuery,
  normalizeNavSearchQuery,
} from "./navComponentSearch.ts";
import { buildSearchAndGroups } from "../../shared/searchLexicon.ts";

const groups = [
  {
    id: "modules",
    label: "Блоки",
    items: [
      {
        code: "4/46",
        label: "4/46 — Модуль управления двигателем",
        search_text: "4/46 Модуль управления двигателем 30656635 engine Моторный отсек",
        type_ru: "Блок",
        home_zone: "engine",
      },
    ],
  },
  {
    id: "connectors",
    label: "Разъёмы",
    items: [
      {
        code: "10/1",
        label: "10/1 — Фара, водитель слева",
        search_text: "10/1 Фара, водитель слева 30658204 8688207 front_bumper Передний бампер",
        type_ru: "Разъём",
        home_zone: "front_bumper",
      },
      {
        code: "74/507",
        label: "74/507 — Разъём двери",
        search_text: "74/507 Разъём двери 31288394 front_doors Передние двери проводка двери",
        type_ru: "Разъём",
        home_zone: "front_doors",
      },
    ],
  },
];

const catalog = [
  {
    id: "other",
    label: "Прочее",
    items: [
      {
        code: "10/173",
        label: "10/173 — Освещение отсека багажника",
        search_text: "10/173 Освещение отсека багажника trunk Багажник проводка багажника",
        home_zone: "trunk",
      },
      {
        code: "3/128",
        label: "3/128 — Модуль левой задней двери (LDM)",
        search_text: "3/128 Модуль левой задней двери rear_doors Задние двери проводка задней двери",
        home_zone: "rear_doors",
      },
      {
        code: "4/147",
        label: "4/147 — Модуль управления заднего сиденья",
        search_text: "4/147 Модуль управления заднего сиденья seats Сиденья seat harness",
        home_zone: "seats",
      },
      {
        code: "10/288",
        label: "10/288 — Подсветка потолочной консоли",
        search_text: "10/288 Подсветка потолочной консоли roof Крыша headliner",
        home_zone: "roof",
      },
      {
        code: "74/309",
        label: "74/309 — Передний бампер",
        search_text: "74/309 Передний бампер front_bumper парктроник передний",
        home_zone: "front_bumper",
      },
      {
        code: "74/301",
        label: "74/301 — Переходной разъем жгута моторного отсека",
        search_text: "74/301 моторного отсека engine Моторный отсек проводка моторного отсека",
        home_zone: "engine",
      },
      {
        code: "6/36",
        label: "6/36 — мотор замка, центральный замок передней правой двери",
        search_text: "6/36 мотор замка центральный замок front_doors Передние двери lock",
        home_zone: "front_doors",
      },
    ],
  },
];

test("normalize collapses spaces", () => {
  assert.equal(normalizeNavSearchQuery("  Фара   306  "), "фара 306");
});

test("search by node name", () => {
  const out = filterNavGroupsByQuery(groups, "фара");
  assert.deepEqual(
    out.flatMap((g) => g.items.map((i) => i.code)),
    ["10/1"],
  );
});

test("search by part number PN", () => {
  const out = filterNavGroupsByQuery(groups, "30658204");
  assert.equal(out.length, 1);
  assert.equal(out[0].items[0].code, "10/1");
});

test("search by code", () => {
  const out = filterNavGroupsByQuery(groups, "74/507");
  assert.equal(out.flatMap((g) => g.items.map((i) => i.code)).join(), "74/507");
});

test("multi-token AND", () => {
  const out = filterNavGroupsByQuery(groups, "модуль двигателем");
  assert.equal(out.flatMap((g) => g.items.map((i) => i.code)).join(), "4/46");
});

test("keeps selected code even if query misses", () => {
  const out = filterNavGroupsByQuery(groups, "фара", "4/46");
  const codes = out.flatMap((g) => g.items.map((i) => i.code)).sort();
  assert.deepEqual(codes, ["10/1", "4/46"]);
});

test("empty query returns all", () => {
  assert.equal(filterNavGroupsByQuery(groups, "").flatMap((g) => g.items).length, 3);
});

test("stopwords drop wiring fillers across zones", () => {
  const door = filterNavGroupsByQuery(catalog, "проводка двери");
  assert.ok(door.flatMap((g) => g.items.map((i) => i.code)).includes("6/36"));

  const engine = filterNavGroupsByQuery(catalog, "жгут моторного отсека");
  assert.ok(engine.flatMap((g) => g.items.map((i) => i.code)).includes("74/301"));

  const seats = filterNavGroupsByQuery(catalog, "проводка сидений");
  assert.ok(seats.flatMap((g) => g.items.map((i) => i.code)).includes("4/147"));

  const roof = filterNavGroupsByQuery(catalog, "подсветка крыши");
  assert.ok(roof.flatMap((g) => g.items.map((i) => i.code)).includes("10/288"));

  const bumper = filterNavGroupsByQuery(catalog, "передний бампер");
  assert.ok(bumper.flatMap((g) => g.items.map((i) => i.code)).includes("74/309"));
});

test("bilingual synonyms map EN↔RU for common parts", () => {
  const speaker = filterNavGroupsByQuery(
    [
      {
        id: "x",
        label: "x",
        items: [
          {
            code: "16/3",
            label: "16/3 — Динамик, передняя правая дверь",
            search_text: "16/3 Динамик front_doors",
          },
        ],
      },
    ],
    "speaker",
  );
  assert.equal(speaker.flatMap((g) => g.items)[0]?.code, "16/3");

  const sensor = filterNavGroupsByQuery(
    [
      {
        id: "x",
        label: "x",
        items: [
          {
            code: "7/208",
            label: "7/208 — Датчик бокового столкновения",
            search_text: "7/208 Датчик side impact sensor",
          },
        ],
      },
    ],
    "sensor",
  );
  assert.equal(sensor.flatMap((g) => g.items)[0]?.code, "7/208");
});

test("shared lexicon builds AND groups without fillers", () => {
  const groupsOut = buildSearchAndGroups("проводка задней двери");
  assert.ok(groupsOut.length >= 1);
  const flat = groupsOut.flat().join(" ");
  assert.ok(!flat.includes("проводка"), flat);
  assert.ok(flat.includes("двер") || flat.includes("door"), flat);
});

test("token groups expand orientation synonyms", () => {
  const g = expandNavSearchTokenGroups("задняя правая дверь");
  assert.ok(g.length >= 2);
  assert.ok(g.some((alts) => alts.some((a) => a.includes("rear") || a.includes("задн"))));
  assert.ok(g.some((alts) => alts.some((a) => a.includes("door") || a.includes("двер"))));
});

test("phrase search finds zone-local nodes without exclusive keyword bias", () => {
  const trunk = filterNavGroupsByQuery(catalog, "проводка багажника");
  assert.ok(trunk.flatMap((g) => g.items.map((i) => i.code)).includes("10/173"));

  const rearDoor = filterNavGroupsByQuery(catalog, "задняя дверь");
  assert.ok(rearDoor.flatMap((g) => g.items.map((i) => i.code)).includes("3/128"));
  assert.ok(!rearDoor.flatMap((g) => g.items.map((i) => i.code)).includes("74/301"));
});
