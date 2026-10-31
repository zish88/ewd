import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGraphicId, rewriteServiceHtmlImages } from "./servicerepGraphics.js";

test("parseGraphicId accepts hex and IMG-/GR- names", () => {
  assert.equal(parseGraphicId("0900c8af80059b21_0_0.gif"), "0900c8af80059b21");
  assert.equal(parseGraphicId("IMG-227782.gif"), "IMG-227782");
  assert.equal(parseGraphicId("IMG-227782"), "IMG-227782");
  assert.equal(parseGraphicId("GR-366703"), "GR-366703");
  assert.equal(parseGraphicId("not-an-image"), null);
});

test("rewriteServiceHtmlImages turns filename chips into img tags", () => {
  const html = '<p class="sr-missing-img">[IMG-227782.gif]</p>';
  const out = rewriteServiceHtmlImages(html);
  assert.match(String(out), /\/api\/service\/graphic\/IMG-227782/);
  assert.doesNotMatch(String(out), /sr-missing-img/);
});
