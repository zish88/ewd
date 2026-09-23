import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLATFORM_ID,
  getPlatform,
  listPlatforms,
  normalizePlatformId,
  platformsCatalogPayload,
} from "./platforms.js";

test("only p3 platform is registered", () => {
  assert.equal(listPlatforms().length, 1);
  assert.equal(getPlatform(undefined).id, DEFAULT_PLATFORM_ID);
  assert.equal(getPlatform("spa").id, "p3");
  assert.equal(normalizePlatformId("spa"), "p3");
});

test("catalog payload is p3-only", () => {
  const cat = platformsCatalogPayload();
  assert.equal(cat.default_id, "p3");
  assert.deepEqual(
    cat.platforms.map((p) => p.id),
    ["p3"],
  );
});
