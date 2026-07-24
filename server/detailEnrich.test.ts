import test from "node:test";
import assert from "node:assert/strict";
import { enrichDetailWithName, isBareCodePinDetail } from "./detailEnrich.js";

test("isBareCodePinDetail detects CODE:PIN without name", () => {
  assert.equal(isBareCodePinDetail("74/508:2"), true);
  assert.equal(isBareCodePinDetail("74/508:2 — Разъём"), false);
  assert.equal(isBareCodePinDetail("3/74:1 - Door lock"), false);
  assert.equal(isBareCodePinDetail(""), false);
});

test("enrichDetailWithName appends name_ru for bare details", () => {
  const names = new Map([
    ["74/508", "Разъём жгута двери"],
    ["3/74", "Выключатель замка"],
  ]);
  assert.equal(
    enrichDetailWithName("74/508:2", names),
    "74/508:2 — Разъём жгута двери",
  );
  assert.equal(
    enrichDetailWithName("74/508:2 — Уже есть", names),
    "74/508:2 — Уже есть",
  );
  assert.equal(enrichDetailWithName("74/999:1", names), "74/999:1");
});
