/**
 * Build data/vida_harness_repair_catalog.json from existing VIDA sidecars.
 * Does not require EPC MDF — uses vida_connector_parts / bom / device_parts.
 *
 * Usage: node scripts/build-harness-repair-catalog.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dataDir = join(root, "data");

function loadJson(name) {
  const p = join(dataDir, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function normalizeGauge(text) {
  const t = String(text || "");
  // 0,75 mm2 / 0.75 mm² / 2.5 mm%2 / 0,75mm2
  const m = t.match(/(\d+[.,]?\d*)\s*mm\s*%?\s*2/i) || t.match(/(\d+[.,]?\d*)\s*mm²/i);
  if (!m) return null;
  return m[1].replace(",", ".");
}

function parseItemAttrs(nameEn, roleHint) {
  const name = String(nameEn || "").trim();
  const blob = name.toLowerCase();
  const gauge_mm2 = normalizeGauge(name);
  let plating = null;
  if (/\b(tin|sn)\b/i.test(name) || /tin\s*\(sn\)/i.test(name)) plating = "tin";
  else if (/\bgold\b|\bau\b/i.test(name)) plating = "gold";

  let terminal_family = null;
  const typeM = name.match(/\btype\s*([abc])\b/i);
  if (typeM) terminal_family = `type_${typeM[1].toLowerCase()}`;
  const sizeM = name.match(/\b(0\.?\d+)\s*mm\b/i);
  if (!terminal_family && sizeM && !gauge_mm2) terminal_family = `${sizeM[1]}mm`;

  let gender = null;
  if (/\bfemale\b|розетк|гнезд/i.test(name)) gender = "female";
  else if (/\bmale\b|вилк|штыр/i.test(name)) gender = "male";

  const cavityM =
    name.match(/(?:^|[^0-9])(?:pin|cavity|контакт|клемма|pos(?:ition)?)\s*[#:.]?\s*0*(\d{1,3})(?:[^0-9]|$)/i) ||
    name.match(/:(\d{1,3})(?:\b|$)/);
  const cavity = cavityM ? String(Number(cavityM[1])) : null;

  const is_pigtail =
    /\b(pigtail|repair\s*kit|harness\s*repair|with\s*plug|кабель.*рем|пигтейл)\b/i.test(name) ||
    (blob === "kit" && roleHint !== "seal");

  let role = roleHint || "other";
  if (is_pigtail) role = "pigtail";
  else if (role === "other" && /\b(seal|gasket|grommet|уплотн)\b/i.test(name)) role = "seal";
  else if (role === "other" && /\b(terminal|contact|socket|контакт)\b/i.test(name)) role = "terminal";

  return { name_en: name || undefined, cavity, gauge_mm2, plating, terminal_family, gender, is_pigtail, role };
}

const parts = loadJson("vida_connector_parts.json");
const bom = loadJson("vida_connector_bom.json");
const devices = loadJson("vida_device_parts.json");

if (!parts?.connectors && !bom?.connectors) {
  console.error("Missing vida_connector_parts.json / vida_connector_bom.json");
  process.exit(1);
}

const connectors = {};
const codes = new Set([
  ...Object.keys(parts?.connectors || {}),
  ...Object.keys(bom?.connectors || {}),
  ...Object.keys(devices?.devices || {}),
]);

for (const code of [...codes].sort()) {
  const rec = parts?.connectors?.[code] || {};
  const deviceRec = devices?.devices?.[code] || {};
  const itemsRaw = Array.isArray(bom?.connectors?.[code]) ? bom.connectors[code] : [];
  const housingPn = String(rec.part_number || "").trim();
  const matePn = String(rec.part_number_mate || "").trim();
  const devicePn = String(deviceRec.device_part_number || "").trim();
  const skip = new Set([housingPn, matePn, devicePn].filter(Boolean));

  const items = [];
  const seen = new Set();
  for (const row of itemsRaw) {
    const pn = String(row?.part_number || "").trim();
    if (!pn || skip.has(pn) || seen.has(pn)) continue;
    seen.add(pn);
    const attrs = parseItemAttrs(row?.name_en || row?.name_ru || "", row?.role || "other");
    items.push({
      part_number: pn,
      role: attrs.role,
      name_en: attrs.name_en || row?.name_en || "",
      name_ru: row?.name_ru ? String(row.name_ru) : undefined,
      cavity: attrs.cavity,
      gauge_mm2: attrs.gauge_mm2,
      plating: attrs.plating,
      terminal_family: attrs.terminal_family,
      gender: attrs.gender,
      is_pigtail: attrs.is_pigtail,
      source: "vida_connector_bom",
    });
  }

  const entry = { items };
  if (housingPn) {
    entry.housing = {
      part_number: housingPn,
      name_en: rec.name_en || "",
      name_ru: rec.name_ru || undefined,
      role: "housing",
      source: "vida_connector_parts",
    };
  }
  if (matePn) {
    entry.mate = {
      part_number: matePn,
      name_en: rec.name_en || "",
      role: "mate",
      source: "vida_connector_parts",
    };
  }
  if (devicePn) {
    entry.device = {
      part_number: devicePn,
      name_en: deviceRec.name_en || "",
      name_ru: deviceRec.name_ru || undefined,
      role: "device",
      source: "vida_device_parts",
    };
  }
  if (entry.housing || entry.mate || entry.device || items.length) {
    connectors[code] = entry;
  }
}

const catalog = {
  semantics:
    "Normalized harness repair catalog keyed by Capital/EWD wiring designation. " +
    "housing/mate = connector shells; items = EPC indented terminals/seals/pigtails. " +
    "cavity/gauge only when explicitly present in EPC titles — never guessed. " +
    "tools.9512669 is a workshop Terminal Wiring Repair Kit (reference), not a connector PN.",
  generated_at: new Date().toISOString(),
  source: "normalized from vida_connector_parts.json + vida_connector_bom.json + vida_device_parts.json",
  count: Object.keys(connectors).length,
  tools: [
    {
      part_number: "9512669",
      role: "tool_kit",
      name_en: "Terminal Wiring Repair Kit",
      name_ru: "Сервисный комплект для ремонта клемм (инструмент/расходники)",
      confidence: "reference",
      note_ru:
        "Официальный Volvo special tool (STB 95). Не является партномером конкретной клеммы или корпуса — сверяйте OEM PN по разъёму.",
      source: "Volvo Special Tools Bulletin",
    },
    {
      part_number: "9512852",
      role: "tool",
      name_en: "Terminal Removal Tool",
      name_ru: "Съёмник клемм",
      confidence: "reference",
      source: "Volvo Special Tools Bulletin 132",
    },
    {
      part_number: "9512853",
      role: "tool",
      name_en: "Terminal Removal Tool",
      name_ru: "Съёмник клемм",
      confidence: "reference",
      source: "Volvo Special Tools Bulletin 132",
    },
  ],
  connectors,
};

const outPath = join(dataDir, "vida_harness_repair_catalog.json");
writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf-8");
console.log(
  `Wrote ${outPath}: ${catalog.count} connectors, tools=${catalog.tools.length}, ` +
    `items=${Object.values(connectors).reduce((n, c) => n + (c.items?.length || 0), 0)}`,
);
