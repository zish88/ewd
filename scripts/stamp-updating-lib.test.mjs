import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ITEMS,
  collectUserFacingNotes,
  expandDeploySubject,
  isInternalDeploySubject,
  noteKey,
  pickUserFacingDeployNotes,
  sampleNotes,
  toRussianDeployNote,
  createRng,
} from "./stamp-updating-lib.mjs";

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

test("MAX_ITEMS is 4", () => {
  assert.equal(MAX_ITEMS, 4);
});
