import test from "node:test";
import assert from "node:assert/strict";
import {
  GIT_SHORT_LEN,
  MAX_ITEMS,
  collectUserFacingNotes,
  expandDeploySubject,
  deployInputsFromGitLog,
  formatGitShort,
  isInternalDeploySubject,
  isValidPublicNote,
  noteKey,
  pickUserFacingDeployNotes,
  sampleNotes,
  toRussianDeployNote,
  createRng,
} from "./stamp-updating-lib.mjs";

test("explicit Release-Note-RU trailers replace subject guessing", () => {
  const log = [
    "Correct vehicle engine availability\x1fBody\nRelease-Note-RU: Уточнены двигатели по моделям и годам.\nRelease-Note-RU: Региональные моторы получили подпись рынка.\x1e",
    "Refactor scripts\x1fRelease-Note-RU: internal\x1e",
    "Fallback subject\x1fNo trailer here\x1e",
  ].join("");
  assert.deepEqual(deployInputsFromGitLog(log), [
    "Уточнены двигатели по моделям и годам.",
    "Региональные моторы получили подпись рынка.",
    "Fallback subject",
  ]);
});

test("internal: admin / VAPID / ops subjects are hidden", () => {
  assert.equal(isInternalDeploySubject("Improve admin visit tiles"), true);
  assert.equal(isInternalDeploySubject("Fix VAPID key parsing"), true);
  assert.equal(isInternalDeploySubject("Add VPS script to generate and write VAPID keys into .env."), true);
  assert.equal(
    isInternalDeploySubject("Ноутбук: быстрые фильтры в шапке; браузер и устройство — только в админке у посещений."),
    true,
  );
  assert.equal(isInternalDeploySubject("Скрипт на VPS: генерация VAPID-ключей и запись в .env."), true);
  assert.equal(isInternalDeploySubject("Рефактор nav-зон."), true);
  assert.equal(
    isInternalDeploySubject("Move OBD testing to admin, tighten engine-zone rules, sanitize public docs"),
    true,
  );
});

test("user-facing product subjects are kept", () => {
  assert.equal(isInternalDeploySubject("Center desktop filter chips in two rows and outline white wires on schematics."), false);
  assert.equal(isInternalDeploySubject("Add Web Push notifications after site updates."), false);
  assert.equal(isInternalDeploySubject("Make dual-color wire badge text readable on light stripe pigments."), false);
  assert.equal(isInternalDeploySubject("Улучшен pinch-zoom на схемах для трекпада."), false);
});

test("expandDeploySubject splits multi-topic curated lines", () => {
  const parts = expandDeploySubject(
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.",
  );
  assert.ok(parts.length >= 2, JSON.stringify(parts));
  assert.ok(parts.some((p) => /pinch-zoom|схем/i.test(p)), JSON.stringify(parts));
  assert.ok(parts.some((p) => /DTC/i.test(p)), JSON.stringify(parts));
  assert.ok(!parts.some((p) => /рефактор/i.test(p)), `refactor leaked: ${JSON.stringify(parts)}`);
});

test("pickUserFacingDeployNotes skips previous items and caps at MAX_ITEMS", () => {
  const subjects = [
    "Stamp updating.html deploy notes",
    "Fix VAPID key parsing when web-push prints keys on the next line.",
    "OBD: динамический discovery PID и универсальный API сигналов ESP-шлюза.",
    "Улучшен pinch-zoom на схемах для трекпада.",
    "Детали DTC VIDA в результатах поиска.",
    "Можно включить уведомления о обновлении сайта.",
    "Ноутбук: быстрые фильтры в шапке.",
    "Читаемые подписи на двухцветных проводах (белый/жёлтый).",
  ];
  const previousItems = [
    "Можно включить уведомления о обновлении сайта.",
    "Ноутбук: быстрые фильтры в шапке.",
    "Читаемые подписи на двухцветных проводах; пуш при обновлении сайта.",
  ];
  const items = pickUserFacingDeployNotes(subjects, MAX_ITEMS, {
    previousItems,
    freshSubjects: subjects.slice(0, 5),
    seed: "test-seed-1",
  });
  assert.ok(items.length <= MAX_ITEMS, `too many: ${items.length}`);
  assert.ok(items.length >= 1);
  assert.ok(!items.some((x) => /уведомлен/i.test(x)), `stale push note leaked: ${JSON.stringify(items)}`);
  assert.ok(!items.some((x) => /быстрые фильтры/i.test(x)), `stale laptop note leaked: ${JSON.stringify(items)}`);
  assert.ok(!items.some((x) => /админ|VAPID|\.env/i.test(x)), `admin leaked: ${JSON.stringify(items)}`);
  assert.ok(!items.some((x) => /двухцветн/i.test(x)), `stale dual-wire leaked: ${JSON.stringify(items)}`);
});

test("noteKey collapses punctuation and parentheticals", () => {
  assert.equal(
    noteKey("Читаемые подписи на двухцветных проводах."),
    noteKey("Читаемые подписи на двухцветных проводах (белый/жёлтый)!"),
  );
});

test("sampleNotes is deterministic for the same seed", () => {
  const pool = ["A.", "B.", "C.", "D.", "E.", "F."];
  const a = sampleNotes(pool, 3, createRng("same"));
  const b = sampleNotes(pool, 3, createRng("same"));
  assert.deepEqual(a, b);
  const c = sampleNotes(pool, 3, createRng("other"));
  assert.equal(c.length, 3);
});

test("collectUserFacingNotes expands and dedupes", () => {
  const notes = collectUserFacingNotes([
    "Refresh updating-page notes after batch.",
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.",
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.",
  ]);
  assert.ok(notes.length >= 2, JSON.stringify(notes));
  assert.equal(new Set(notes.map((n) => n.toLowerCase())).size, notes.length);
});

test("toRussianDeployNote keeps Cyrillic", () => {
  assert.equal(toRussianDeployNote("Читаемые подписи на двухцветных проводах."), "Читаемые подписи на двухцветных проводах.");
});

test("English Fix commits get curated RU — no EN jargon leftovers", () => {
  const wire = toRussianDeployNote(
    "Fix wire-context sheet pick and tighten conductor paint for card focus.",
  );
  assert.match(wire, /подсветк|схем|провод/i);
  assert.doesNotMatch(wire, /wire-context|conductor paint|card focus/i);

  const safari = expandDeploySubject(
    "Fix Safari Mac schematic zoom for FABs, pinch, and mouse wheel.",
  );
  assert.equal(safari.length, 1, JSON.stringify(safari));
  assert.match(safari[0], /зум|Safari|Mac/i);
  assert.doesNotMatch(safari[0], /^И mouse/i);
  assert.doesNotMatch(safari[0], /FABs,/i);
});

test("EPC repair commits receive specific public notes", () => {
  const subjects = [
    "Expand EPC illustration coverage across repair catalog.",
    "Polish repair PN card UI and Russian copy.",
    "Add EPC part illustrations and harness repair PN cards.",
  ];
  const notes = pickUserFacingDeployNotes(subjects, MAX_ITEMS, {
    freshSubjects: subjects,
    seed: "epc-repair-release",
  });

  assert.deepEqual(notes, [
    "Иллюстрации EPC добавлены для большинства ремонтных разъёмов.",
    "Карточки ремонтных номеров стали понятнее и удобнее.",
    "В карточках разъёмов появились номера деталей и иллюстрации EPC.",
  ]);
  assert.ok(notes.every((note) => !/доступна новая версия|улучшения интерфейса|новые улучшения/i.test(note)));
});

test("unmapped EPC repair commit gets a specific fallback", () => {
  assert.equal(
    toRussianDeployNote("Improve EPC repair part illustrations for connector catalog."),
    "Иллюстрации EPC для ремонтных разъёмов и деталей.",
  );
});

test("Document OBD vehicle-agnostic is hidden from public notes", () => {
  assert.equal(
    isInternalDeploySubject(
      "Document OBD gateway as vehicle-agnostic probe, not a fixed XC70 profile.",
    ),
    true,
  );
  const notes = collectUserFacingNotes([
    "Document OBD gateway as vehicle-agnostic probe, not a fixed XC70 profile.",
    "Fix wire-context sheet pick and tighten conductor paint for card focus.",
  ]);
  assert.ok(notes.every((n) => !/vehicle-agnostic|Document OBD/i.test(n)));
  assert.ok(notes.some((n) => /подсветк|схем|провод/i.test(n)));
});

test("MAX_ITEMS is 4", () => {
  assert.equal(MAX_ITEMS, 4);
});

test("formatGitShort always yields 8 hex or local", () => {
  assert.equal(GIT_SHORT_LEN, 8);
  assert.equal(formatGitShort("5ea95915abc"), "5ea95915");
  assert.equal(formatGitShort("5ea9591"), "5ea9591");
  assert.equal(formatGitShort("local"), "local");
  assert.equal(formatGitShort(""), "local");
});

test("isValidPublicNote rejects English jargon leftovers", () => {
  assert.equal(isValidPublicNote("Схемы снова чёткие при увеличении в обычных браузерах."), true);
  assert.equal(isValidPublicNote("Fix wire-context sheet pick and tighten conductor paint."), false);
  assert.equal(isValidPublicNote("Исправлено: wire-context sheet pick."), false);
  assert.equal(isValidPublicNote("Available update."), false);
});

test("fresh window keeps sharp-zoom even when previous Safari zoom overlaps by words", () => {
  const previousItems = [
    "Удобнее зум схем на Mac/Safari: кнопки, pinch и колёсико мыши.",
    "Точнее выбор схемы по проводу и аккуратная подсветка линии на карточке.",
  ];
  const lookback = [
    "Restore sharp schematic zoom outside Safari.",
    "Fix Safari Mac schematic zoom for FABs, pinch, and mouse wheel.",
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.",
    "Add Web Push notifications after site updates.",
  ];
  const fresh = ["Restore sharp schematic zoom outside Safari."];
  const items = pickUserFacingDeployNotes(lookback, MAX_ITEMS, {
    previousItems,
    freshSubjects: fresh,
    seed: "sharp-vs-safari",
  });
  assert.ok(items.some((x) => /чётк/i.test(x)), `sharp zoom missing: ${JSON.stringify(items)}`);
  assert.ok(!items.some((x) => /пуш-баннер|уведомлен/i.test(x)), `stale lookback leaked: ${JSON.stringify(items)}`);
});

test("fresh window with only infra commits → fallback, not lookback recycle", () => {
  const lookback = [
    "Add Web Push notifications after site updates.",
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.",
    "Улучшен pinch-zoom на схемах для трекпада.",
  ];
  const items = pickUserFacingDeployNotes(lookback, MAX_ITEMS, {
    previousItems: ["Старая заметка про pinch."],
    freshSubjects: [
      "Document OBD gateway as vehicle-agnostic probe, not a fixed XC70 profile.",
      "Stamp updating.html deploy notes",
    ],
    seed: "infra-only",
  });
  assert.deepEqual(items, ["Доступна новая версия справочника."]);
});

test("empty fresh window keeps previous valid bullets", () => {
  const prev = ["Схемы снова чёткие при увеличении в обычных браузерах."];
  const items = pickUserFacingDeployNotes(
    ["Add Web Push notifications after site updates."],
    MAX_ITEMS,
    { previousItems: prev, freshSubjects: [], seed: "empty-fresh" },
  );
  assert.deepEqual(items, prev);
});
