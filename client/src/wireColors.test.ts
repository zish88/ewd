import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWireColorKey, wireColorsMatch } from "./wireColors.js";

test("normalizeWireColorKey unifies slash space underscore", () => {
  assert.equal(normalizeWireColorKey("GN/BN"), "GN-BN");
  assert.equal(normalizeWireColorKey("gn bn"), "GN-BN");
  assert.equal(normalizeWireColorKey("GN_BN"), "GN-BN");
});

test("wireColorsMatch is order-independent for dual insulation", () => {
  assert.equal(wireColorsMatch("GN-BN", "BN-GN"), true);
  assert.equal(wireColorsMatch("GN/BN", "BN-GN"), true);
  assert.equal(wireColorsMatch("YE", "YE"), true);
  assert.equal(wireColorsMatch("GN-BN", "BK-GN"), false);
  assert.equal(wireColorsMatch("GN-BN", "BN-RD"), false);
});
