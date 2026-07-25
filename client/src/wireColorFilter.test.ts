import test from "node:test";
import assert from "node:assert/strict";
import { wireColorChipStyle } from "./wireColorFilter.js";

test("dual WH badge uses dark text for readability on white stripes", () => {
  const s = wireColorChipStyle("BU-WH");
  assert.equal(s.color, "#0f172a");
  assert.match(String(s.textShadow), /#fff/i);
  assert.ok(s.backgroundImage || s.background);
});

test("dual without light pigment keeps light text + dark outline", () => {
  const s = wireColorChipStyle("RD-BU");
  assert.equal(s.color, "#f8fafc");
  assert.match(String(s.textShadow), /#000/i);
});

test("solid WH uses dark text", () => {
  const s = wireColorChipStyle("WH");
  assert.equal(s.color, "#0f172a");
});
