import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  matchHarnessRepair,
  pinCavityDigits,
  normalizeGaugeValue,
  resetHarnessRepairCatalogCache,
  cardPartsFromRepair,
} from "./harnessRepairCatalog.js";

function withCatalog(payload: unknown, fn: () => void) {
  const dir = mkdtempSync(join(tmpdir(), "hrc-"));
  const path = join(dir, "vida_harness_repair_catalog.json");
  writeFileSync(path, JSON.stringify(payload), "utf-8");
  resetHarnessRepairCatalogCache(path);
  try {
    fn();
  } finally {
    resetHarnessRepairCatalogCache(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("pinCavityDigits extracts cavity", () => {
  assert.equal(pinCavityDigits("13"), "13");
  assert.equal(pinCavityDigits("74/507:10"), "10");
  assert.equal(pinCavityDigits("—"), "");
});

test("normalizeGaugeValue", () => {
  assert.equal(normalizeGaugeValue("0,5"), "0.5");
  assert.equal(normalizeGaugeValue("0.75 mm2"), "0.75");
});

test("exact terminal when cavity explicit in EPC", () => {
  withCatalog(
    {
      connectors: {
        "74/1": {
          housing: { part_number: "111", role: "housing", source: "t" },
          items: [
            {
              part_number: "222",
              role: "terminal",
              name_en: "Repair terminal pin 5",
              cavity: "5",
              source: "t",
            },
            {
              part_number: "333",
              role: "terminal",
              name_en: "Repair terminal pin 7",
              cavity: "7",
              source: "t",
            },
          ],
        },
      },
      tools: [{ part_number: "9512669", role: "tool_kit", confidence: "reference" }],
    },
    () => {
      const r = matchHarnessRepair({ code: "74/1", pin: "5" });
      assert.equal(r.status, "exact");
      assert.equal(r.terminals.length, 1);
      assert.equal(r.terminals[0].part_number, "222");
      assert.equal(r.terminals[0].confidence, "exact");
      assert.ok(r.tools.some((t) => t.part_number === "9512669"));
    },
  );
});

test("multi-candidate without pin metadata is compatible not exact", () => {
  withCatalog(
    {
      connectors: {
        "10/1": {
          housing: { part_number: "H1", role: "housing" },
          items: [
            { part_number: "T1", role: "terminal", name_en: "" },
            { part_number: "T2", role: "terminal", name_en: "" },
          ],
        },
      },
      tools: [],
    },
    () => {
      const r = matchHarnessRepair({ code: "10/1", pin: "3" });
      assert.equal(r.status, "compatible");
      assert.ok(r.terminals.length >= 2);
      assert.ok(r.terminals.every((t) => t.confidence === "compatible"));
    },
  );
});

test("gauge mismatch drops candidate when item has gauge", () => {
  withCatalog(
    {
      connectors: {
        "10/2": {
          housing: { part_number: "H2", role: "housing" },
          items: [
            {
              part_number: "G1",
              role: "terminal",
              name_en: "0,5 mm2 tin",
              gauge_mm2: "0.5",
            },
            {
              part_number: "G2",
              role: "terminal",
              name_en: "1,5 mm2 tin",
              gauge_mm2: "1.5",
            },
          ],
        },
      },
      tools: [],
    },
    () => {
      const r = matchHarnessRepair({ code: "10/2", pin: "1", gauge: "0.5" });
      assert.equal(r.terminals.length, 1);
      assert.equal(r.terminals[0].part_number, "G1");
      // single gauge match without cavity → exact promotion
      assert.equal(r.terminals[0].confidence, "exact");
    },
  );
});

test("unknown code without overrides", () => {
  withCatalog({ connectors: {}, tools: [] }, () => {
    const r = matchHarnessRepair({ code: "99/999" });
    assert.equal(r.status, "unknown");
    assert.equal(r.terminals.length, 0);
  });
});

test("housing-only without BOM is exact shell status", () => {
  withCatalog(
    {
      connectors: {
        "16/1": {
          housing: { part_number: "H16", role: "housing" },
          mate: { part_number: "M16", role: "mate" },
          items: [],
        },
      },
      tools: [],
    },
    () => {
      const r = matchHarnessRepair({ code: "16/1" });
      assert.equal(r.housing?.part_number, "H16");
      assert.equal(r.mate?.part_number, "M16");
      assert.equal(r.terminals.length, 0);
      assert.equal(r.status, "exact");
      const card = cardPartsFromRepair(r);
      assert.ok(card);
      assert.equal(card!.housing, "H16");
      assert.ok(card!.repair);
    },
  );
});

test("missing catalog file yields unknown", () => {
  resetHarnessRepairCatalogCache(join(tmpdir(), "no-such-hrc-catalog.json"));
  try {
    const r = matchHarnessRepair({ code: "10/1" });
    assert.equal(r.status, "unknown");
  } finally {
    resetHarnessRepairCatalogCache(null);
  }
});
