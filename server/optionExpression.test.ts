import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOptionExpression, normalizeOptionExpression } from "./optionExpression.js";

test("empty expression and empty tokens are always true", () => {
  assert.equal(evaluateOptionExpression("", ["Y285"]), true);
  assert.equal(evaluateOptionExpression("Y285 && AUTO", []), true);
  assert.equal(evaluateOptionExpression(null, null), true);
});

test("normalizes HTML entities", () => {
  assert.equal(normalizeOptionExpression("Y285 &amp;&amp; AUTO"), "Y285 && AUTO");
});

test("AND / OR evaluation", () => {
  assert.equal(evaluateOptionExpression("Y285 && AUTO", ["Y285", "AUTO"]), true);
  assert.equal(evaluateOptionExpression("Y285 && AUTO", ["Y285"]), false);
  assert.equal(evaluateOptionExpression("Y285 || Y286", ["Y286"]), true);
  assert.equal(evaluateOptionExpression("Y285 || Y286", ["Y413"]), false);
});

test("parentheses and NOT", () => {
  assert.equal(
    evaluateOptionExpression("(Y285 || Y286) && AUTO", ["Y285", "AUTO"]),
    true,
  );
  assert.equal(evaluateOptionExpression("!RHD", ["LHD"]), true);
  assert.equal(evaluateOptionExpression("!RHD", ["RHD"]), false);
});

test("EXEC-style single token", () => {
  assert.equal(evaluateOptionExpression("EXEC", ["EXEC", "Y285"]), true);
  assert.equal(evaluateOptionExpression("EXEC", ["Y285"]), false);
});
