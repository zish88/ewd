import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFromToPlainRu,
  buildPurposeRu,
  parseEnrichmentDetail,
  cardEnrichmentFromFacts,
} from "./wireEnrichment.js";

test("parseEnrichmentDetail: bare and named", () => {
  assert.deepEqual(parseEnrichmentDetail("3/362:1"), {
    code: "3/362",
    pin: "1",
    name: "",
  });
  const named = parseEnrichmentDetail("3/362:1 — Переключатель опоры поясницы, левый");
  assert.equal(named?.code, "3/362");
  assert.equal(named?.pin, "1");
  assert.match(named?.name || "", /поясниц/i);
});

test("buildFromToPlainRu: both named → high and contains both codes", () => {
  const plain = buildFromToPlainRu(
    "3/362:1 — Переключатель опоры поясницы, левый",
    "6/210:1 — Электродвигатель для массажа поясницы, левый",
  );
  assert.ok(plain);
  assert.equal(plain!.confidence, "high");
  assert.match(plain!.text, /3\/362:1/);
  assert.match(plain!.text, /6\/210:1/);
  assert.match(plain!.text, /^От /);
  assert.match(plain!.text, / к /);
});

test("buildFromToPlainRu: no names → null", () => {
  assert.equal(buildFromToPlainRu("3/362:1", "6/210:1"), null);
});

test("buildPurposeRu: from named ends, no invented codes", () => {
  const p = buildPurposeRu({
    fromDetail: "3/362:1 — Переключатель опоры поясницы, левый",
    toDetail: "6/210:1 — Электродвигатель для массажа поясницы, левый",
  });
  assert.ok(p);
  assert.equal(p!.confidence, "high");
  assert.match(p!.text, /^Соединяет /);
  assert.match(p!.text, /поясниц/i);
  assert.doesNotMatch(p!.text, /\b\d{6,}\b/);
});

test("buildPurposeRu: prefers function_text", () => {
  const p = buildPurposeRu({
    fromDetail: "3/362:1 — Переключатель",
    toDetail: "6/210:1 — Мотор",
    functionText: "Сигнал управления мотором поясницы",
  });
  assert.equal(p!.text, "Сигнал управления мотором поясницы");
  assert.deepEqual(p!.sources, ["function_text"]);
});

test("cardEnrichmentFromFacts: on-the-fly without file cache", () => {
  const e = cardEnrichmentFromFacts(
    {
      component_code: "3/362",
      from_detail: "3/362:1 — Переключатель опоры поясницы, левый",
      to_detail: "6/210:1 — Мотор поясницы",
    },
    new Map([["3/362", "Переключатель опоры поясницы, левый"]]),
    null,
  );
  assert.ok(e);
  assert.equal(e!.role_ru, "Переключатель опоры поясницы, левый");
  assert.match(e!.from_to_plain_ru || "", /3\/362:1/);
  assert.match(e!.from_to_plain_ru || "", /6\/210:1/);
});
