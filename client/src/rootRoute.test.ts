import assert from "node:assert/strict";
import test from "node:test";
import { rootSurfaceForPath } from "./rootRoute.js";

test("/admin always resolves to the admin surface", () => {
  assert.equal(rootSurfaceForPath("/admin"), "admin");
  assert.equal(rootSurfaceForPath("/admin/"), "admin");
});

test("/knowledge resolves to the knowledge surface", () => {
  assert.equal(rootSurfaceForPath("/knowledge"), "knowledge");
  assert.equal(rootSurfaceForPath("/knowledge/"), "knowledge");
});

test("other paths resolve to the public app", () => {
  assert.equal(rootSurfaceForPath("/"), "app");
  assert.equal(rootSurfaceForPath("/telegram"), "app");
});
