import assert from "node:assert/strict";
import test from "node:test";
import { rootSurfaceForPath } from "./rootRoute.js";

test("/admin always resolves to the admin surface", () => {
  assert.equal(rootSurfaceForPath("/admin"), "admin");
  assert.equal(rootSurfaceForPath("/admin/"), "admin");
});

test("/knowledge is retired and falls through to the app", () => {
  assert.equal(rootSurfaceForPath("/knowledge"), "app");
  assert.equal(rootSurfaceForPath("/knowledge/"), "app");
});

test("/service resolves to the service surface", () => {
  assert.equal(rootSurfaceForPath("/service"), "service");
  assert.equal(rootSurfaceForPath("/service/"), "service");
});

test("/parts resolves to the parts surface", () => {
  assert.equal(rootSurfaceForPath("/parts"), "parts");
  assert.equal(rootSurfaceForPath("/parts/"), "parts");
});

test("other paths resolve to the public app", () => {
  assert.equal(rootSurfaceForPath("/"), "app");
  assert.equal(rootSurfaceForPath("/telegram"), "app");
});
