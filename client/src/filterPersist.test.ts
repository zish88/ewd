import assert from "node:assert/strict";
import test from "node:test";
import { vehicleHref, vehicleSearchParams } from "./filterPersist.js";

test("vehicleSearchParams omits empty model/year", () => {
  assert.equal(vehicleSearchParams("", ""), "");
  assert.equal(vehicleSearchParams("XC70", "2008"), "model=XC70&year=2008");
});

test("vehicleHref keeps path without query when vehicle empty", () => {
  assert.equal(vehicleHref("/parts", "", ""), "/parts");
  assert.equal(vehicleHref("/service", "V70", "2014"), "/service?model=V70&year=2014");
});

test("vehicleHref adds vin only when 17-ish extra is set", () => {
  assert.equal(
    vehicleHref("/parts", "XC70", "2008", { vin: "YV1BZ982081234567" }),
    "/parts?model=XC70&year=2008&vin=YV1BZ982081234567",
  );
  assert.equal(vehicleHref("/parts", "XC70", "2008", { vin: "" }), "/parts?model=XC70&year=2008");
});
