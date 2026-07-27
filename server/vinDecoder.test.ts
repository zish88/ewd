import test from "node:test";
import assert from "node:assert/strict";
import { decodeVolvoVin } from "./vinDecoder.js";
import { resolveFilters } from "./vehicleMatrix.js";

test("filters cascade: XC70 2008 has 3.2/D5 only — no 2.5T, T6, or 1.6T", () => {
  const r = resolveFilters({ model: "XC70", year: "2008" });
  assert.ok(r.engines.includes("3.2 i6"));
  assert.ok(r.engines.includes("2.4D D5"));
  assert.ok(!r.engines.includes("2.5T"));
  assert.ok(!r.engines.includes("3.0T T6"));
  assert.ok(!r.engines.includes("1.6T"));
});

test("filters cascade: XC70 2009 adds T6, still no 2.5T", () => {
  const r = resolveFilters({ model: "XC70", year: "2009" });
  assert.ok(r.engines.includes("3.0T T6"));
  assert.ok(!r.engines.includes("2.5T"));
});

test("filters cascade: V70 2008 keeps 2.5T; XC60 2009 has none", () => {
  assert.ok(resolveFilters({ model: "V70", year: "2008" }).engines.includes("2.5T"));
  assert.ok(!resolveFilters({ model: "XC60", year: "2009" }).engines.includes("2.5T"));
});

test("filters cascade: XC60 2014 offers regional 2.5T (B5254T12 T5 AWD)", () => {
  const xc60 = resolveFilters({ model: "XC60", year: "2014", engine: "2.5T" });
  assert.ok(xc60.engines.includes("2.5T"));
  assert.equal(xc60.selection.engine, "2.5T");
  assert.ok(xc60.transmissions.some((t) => t.id === "TF-80SC"));
  assert.ok(xc60.transmissions.some((t) => t.id === "M66"));
  assert.ok(xc60.optionTokens.includes("B5254T12"));
});

test("filters cascade: XC70 late years and regional engine labels are exact", () => {
  const my2014 = resolveFilters({ model: "XC70", year: "2014", engine: "3.2 i6" });
  assert.equal(my2014.selection.engine, "3.2 i6");
  assert.equal(
    my2014.engineOptions.find((x) => x.id === "3.2 i6")?.label,
    "3.2 i6 · Северная Америка",
  );

  const my2016 = resolveFilters({ model: "XC70", year: "2016", engine: "2.5T" });
  assert.equal(my2016.selection.engine, "2.5T");
  assert.ok(!my2016.engines.includes("3.2 i6"));
  assert.ok(!my2016.engines.includes("3.0T T6"));
  assert.ok(!my2016.engines.includes("1.6T"));
  assert.equal(
    my2016.engineOptions.find((x) => x.id === "2.5T")?.label,
    "2.5T · Северная Америка",
  );
});

test("filters cascade: stale XC70 2014+ bucket is cleared", () => {
  const r = resolveFilters({ model: "XC70", year: "2014+", engine: "3.2 i6" });
  assert.equal(r.selection.year, "");
  assert.equal(r.selection.engine, "");
  assert.ok(r.years.includes("2014"));
  assert.ok(r.years.includes("2015"));
  assert.ok(r.years.includes("2016"));
  assert.ok(!r.years.includes("2014+"));
});

test("filters cascade: late Drive-E engines map to Capital 4/5 VEA tokens", () => {
  const petrol = resolveFilters({ model: "S60", year: "2014", engine: "2.0T Drive-E" });
  assert.ok(petrol.engines.includes("2.0T Drive-E"));
  assert.ok(petrol.optionTokens.includes("VEP4"));
  assert.ok(petrol.optionTokens.includes("B4204TX"));
  const diesel = resolveFilters({ model: "V60", year: "2014", engine: "2.0D Drive-E" });
  assert.ok(diesel.engines.includes("2.0D Drive-E"));
  assert.ok(diesel.optionTokens.includes("VED4"));
  assert.ok(diesel.optionTokens.includes("D4204TX"));
  assert.ok(diesel.optionTokens.includes("DIESEL"));
});

test("filters cascade: audited late years are model-specific", () => {
  const v70 = resolveFilters({ model: "V70", year: "2014" });
  assert.ok(v70.engines.includes("1.6T"));
  assert.ok(v70.engines.includes("2.0T Drive-E"));
  assert.ok(!v70.engines.includes("3.2 i6"));
  assert.ok(!v70.engines.includes("2.5T"));

  const s80 = resolveFilters({ model: "S80", year: "2016", engine: "2.5T" });
  assert.equal(s80.selection.engine, "2.5T");
  assert.equal(
    s80.engineOptions.find((x) => x.id === "2.5T")?.label,
    "2.5T · Северная Америка",
  );
  assert.ok(!s80.engines.includes("3.2 i6"));
  assert.ok(!s80.engines.includes("3.0T T6"));
  assert.ok(!s80.engines.includes("1.6T"));

  const xc60 = resolveFilters({ model: "XC60", year: "2017" });
  assert.ok(!xc60.engines.includes("3.2 i6"));
  assert.ok(!xc60.engines.includes("3.0T T6"));
  assert.ok(!xc60.engines.includes("1.6T"));

  for (const model of ["S60", "V60"]) {
    const last = resolveFilters({ model, year: "2018" });
    assert.deepEqual(last.engines, ["2.0T Drive-E", "2.0D Drive-E"]);
  }
});

test("filters cascade: old 2014+ URLs are cleared for every audited model", () => {
  for (const model of ["XC70", "V70", "S80", "XC60", "S60", "V60"]) {
    const r = resolveFilters({ model, year: "2014+", engine: "3.0T T6" });
    assert.equal(r.selection.year, "", model);
    assert.equal(r.selection.engine, "", model);
    assert.ok(!r.years.includes("2014+"), model);
  }
});

test("filters cascade: stale engine cleared when not offered for year", () => {
  const r = resolveFilters({ model: "XC70", year: "2008", engine: "2.5T" });
  assert.equal(r.selection.engine, "");
  assert.ok(!r.engines.includes("2.5T"));
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

test("VIN decode rejects XC70 3.2 as a valid MY2016 combination", () => {
  const r = decodeVolvoVin("YV1BZ9820G1234567");
  assert.equal(r.ok, true);
  assert.equal(r.model, "XC70");
  assert.equal(r.year, "2016");
  assert.notEqual(r.engine, "3.2 i6");
  assert.ok(r.notes?.some((x) => /не в матрице/i.test(x)) ?? false);
});
