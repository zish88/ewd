import test from "node:test";
import assert from "node:assert/strict";
import {
  humanizeOptionExpression,
  labelOptionToken,
  optionApplicabilityLabel,
  optionApplicabilityStatus,
} from "./optionExpressionHumanize.js";

test("humanizeOptionExpression: || → или, && → и", () => {
  const h = humanizeOptionExpression("(SVH60 || SVL80 || Y413) && HUS_ADIM");
  assert.equal(h.raw, "(SVH60 || SVL80 || Y413) && HUS_ADIM");
  assert.match(h.textRu, /или/);
  assert.match(h.textRu, /и/);
  assert.ok(h.tokens.includes("SVH60"));
  assert.ok(h.tokens.includes("HUS_ADIM"));
  assert.doesNotMatch(h.textRu, /\|\||&&/);
});

test("humanizeOptionExpression: словарь подставляет RU, неизвестное — код Capital", () => {
  const h = humanizeOptionExpression("Y413 && HUS_ADIM");
  assert.match(h.textRuLabeled, /кузов Y413/i);
  assert.match(h.textRuLabeled, /autodim|влажн/i);
  const unknown = labelOptionToken("ZZZ_UNKNOWN_TOKEN");
  assert.equal(unknown.known, false);
  assert.match(unknown.label, /код Capital/);
});

test("humanizeOptionExpression: пустое → пустые поля", () => {
  const h = humanizeOptionExpression("");
  assert.equal(h.textRu, "");
  assert.deepEqual(h.tokens, []);
});

test("optionApplicabilityStatus: без токенов → unknown", () => {
  assert.equal(optionApplicabilityStatus("Y413 && HUS_ADIM", []), "unknown");
  assert.equal(optionApplicabilityStatus("Y413 && HUS_ADIM", null), "unknown");
  assert.match(optionApplicabilityLabel("unknown"), /не сопоставлено|комплектации/i);
});

test("optionApplicabilityStatus: Y413+HUS_ADIM → match; Y413 без HUS → mismatch", () => {
  const expr = "(SVH60 || SVL80 || Y413) && HUS_ADIM";
  assert.equal(optionApplicabilityStatus(expr, ["Y413", "HUS_ADIM"]), "match");
  assert.equal(optionApplicabilityStatus(expr, ["Y413"]), "mismatch");
});

test("optionApplicabilityStatus: HUMIDSEN без пересечения с VIN → unknown, не mismatch", () => {
  assert.equal(optionApplicabilityStatus("HUMIDSEN", ["Y413", "DIESEL", "AUTO"]), "unknown");
  assert.equal(optionApplicabilityStatus("Y285", ["Y413"]), "unknown");
});

test("humanize: ! → без", () => {
  const h = humanizeOptionExpression("!RHD");
  assert.match(h.textRu, /^без\s+RHD$/i);
});
