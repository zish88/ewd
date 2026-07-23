import test from "node:test";
import assert from "node:assert/strict";
import { decodeVolvoVin } from "./vinDecoder.js";
import { resolveFilters } from "./vehicleMatrix.js";

test("filters cascade: XC70 2008 has no 1.6T", () => {
  const r = resolveFilters({ model: "XC70", year: "2008" });
  assert.ok(r.engines.includes("3.2 i6"));
  assert.ok(!r.engines.includes("1.6T"));
});

test("filters cascade: 3.0T T6 only TF-80SC", () => {
  const r = resolveFilters({ model: "XC70", year: "2010", engine: "3.0T T6" });
  assert.deepEqual(
    r.transmissions.map((t) => t.id),
    ["TF-80SC"],
  );
});

test("filters cascade: 3.2 i6 offers M66 and TF-80SC", () => {
  const r = resolveFilters({ model: "XC70", year: "2011", engine: "3.2 i6" });
  assert.ok(r.transmissions.some((t) => t.id === "TF-80SC"));
  assert.ok(r.transmissions.some((t) => t.id === "M66"));
});

test("filters soft: empty transmission kept as all-KPP", () => {
  const r = resolveFilters({ model: "XC70", year: "2011", engine: "3.2 i6", transmission: "" });
  assert.equal(r.selection.transmission, "");
});

test("filters cascade: 2.0D offers MPS6", () => {
  const r = resolveFilters({ model: "XC70", year: "2012", engine: "2.0D D3/D4" });
  assert.ok(r.transmissions.some((t) => t.id === "MPS6"));
});

test("VIN decode rejects short input", () => {
  const r = decodeVolvoVin("YV1");
  assert.equal(r.ok, false);
});

test("VIN decode XC70-ish sample fills selectors", () => {
  // Synthetic but charset-valid: YV1 + B(Z XC70) + 98 (3.2) + 2 + check + 8 (2008) + plant + serial
  const vin = "YV1BZ982081234567";
  const r = decodeVolvoVin(vin);
  assert.equal(r.ok, true);
  assert.equal(r.model, "XC70");
  assert.equal(r.year, "2008");
  assert.equal(r.engine, "3.2 i6");
  assert.equal(r.transmission, "TF-80SC");
});
