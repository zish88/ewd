import test from "node:test";
import assert from "node:assert/strict";
import {
  isInternalDeploySubject,
  pickUserFacingDeployNotes,
  toRussianDeployNote,
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
});

test("user-facing product subjects are kept", () => {
  assert.equal(isInternalDeploySubject("Center desktop filter chips in two rows and outline white wires on schematics."), false);
  assert.equal(isInternalDeploySubject("Add Web Push notifications after site updates."), false);
  assert.equal(isInternalDeploySubject("Make dual-color wire badge text readable on light stripe pigments."), false);
});

test("pickUserFacingDeployNotes skips admin and keeps product lines", () => {
  const items = pickUserFacingDeployNotes(
    [
      "Stamp updating.html deploy notes",
      "Stretch laptop filters into the app bar and keep browser UA in admin visits.",
      "Fix VAPID key parsing when web-push prints keys on the next line.",
      "Center desktop filter chips in two rows and outline white wires on schematics.",
      "Add Web Push notifications after site updates.",
      "Restore mouse-wheel zoom on schematics without breaking trackpad pan/pinch.",
    ],
    5,
  );
  assert.ok(items.some((x) => /фильтр/i.test(x)), `expected filters note, got ${JSON.stringify(items)}`);
  assert.ok(items.some((x) => /зум|уведомлен|провод|схем/i.test(x)));
  assert.ok(!items.some((x) => /админ|VAPID|\.env/i.test(x)), `admin leaked: ${JSON.stringify(items)}`);
  assert.equal(items.length <= 5, true);
});

test("toRussianDeployNote keeps Cyrillic", () => {
  assert.equal(toRussianDeployNote("Читаемые подписи на двухцветных проводах."), "Читаемые подписи на двухцветных проводах.");
});
