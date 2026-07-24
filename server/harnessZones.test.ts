import test from "node:test";
import assert from "node:assert/strict";
import {
  harnessToZone,
  wireMatchesZone,
  extractCapitalHarnessId,
  resetHarnessLabelCache,
} from "./harnessZones.js";

test("Capital harness ids map to correct zones", () => {
  resetHarnessLabelCache();
  assert.equal(harnessToZone("14014"), "floor");
  assert.equal(harnessToZone("14240_RL"), "rear_doors");
  assert.equal(harnessToZone("14240_RR"), "rear_doors");
  assert.equal(harnessToZone("14401"), "dashboard");
  assert.equal(harnessToZone("14335"), "roof");
  assert.equal(harnessToZone("12A690"), "engine");
  assert.equal(harnessToZone("14A584"), "front_doors");
});

test("RU Capital labels classify rear door harness", () => {
  resetHarnessLabelCache();
  assert.equal(harnessToZone("Жгут задней левой двери 14240_RL"), "rear_doors");
  assert.equal(harnessToZone("Напольный жгут 14014"), "floor");
  assert.equal(extractCapitalHarnessId("Жгут задней левой двери 14240_RL"), "14240_RL");
});

test("wireMatchesZone keeps door wires out of engine", () => {
  resetHarnessLabelCache();
  assert.equal(wireMatchesZone("14240_RL", "", "rear_doors"), true);
  assert.equal(wireMatchesZone("14240_RL", "", "engine"), false);
  assert.equal(wireMatchesZone("14014", "", "floor"), true);
  assert.equal(wireMatchesZone("14014", "", "engine"), false);
  assert.equal(wireMatchesZone("floor", "", "floor"), true);
});
