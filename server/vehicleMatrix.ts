/**
 * Cascading model → year → engine → transmission matrix.
 * Derived from EWD vehicleconfig.xml option sets (AWF21=TF-80SC, M66=manual)
 * plus known P3 SPA year/engine availability for SPA/P3 cars in this package.
 */

export type TransmissionId = "TF-80SC" | "MPS6" | "M66";

export type VehicleSelection = {
  model?: string;
  year?: string;
  engine?: string;
  transmission?: string;
};

export const TRANSMISSION_LABELS: Record<TransmissionId, string> = {
  "TF-80SC": "TF-80SC (АКПП)",
  MPS6: "MPS6 (Powershift)",
  M66: "M66 (МКПП)",
};

/** Engine option codes from vehicleconfig.xml → UI labels used in the app */
const ENGINE_BY_OPTION: Record<string, string> = {
  "3.2P": "3.2 i6",
  "3.2PZEV": "3.2 i6",
  "3.0T": "3.0T T6",
  "2.5P": "2.5T",
  "2.4D": "2.4D D5",
  "2.4H": "2.4D D5",
  "2.0D": "2.0D D3/D4",
  "2.0P": "1.6T",
  "1.6P": "1.6T",
  "1.6D": "2.0D D3/D4",
};

const ENGINE_CODES: Record<string, string[]> = {
  "3.2 i6": ["B6324S5", "B6324S4"],
  "3.0T T6": ["B6304TX"],
  "2.5T": ["B5254TX"],
  "2.4D D5": ["D5244TX"],
  "2.0D D3/D4": ["D5204TX", "D4162TX"],
  "1.6T": ["B4164TX", "B5204TX"],
};

/** Model → years available in this EWD package / SPA P3 range */
const MODEL_YEARS: Record<string, string[]> = {
  XC70: ["2008", "2009", "2010", "2011", "2012", "2013", "2014+"],
  V70: ["2008", "2009", "2010", "2011", "2012", "2013", "2014+"],
  S80: ["2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014+"],
  XC60: ["2009", "2010", "2011", "2012", "2013", "2014+"],
  S60: ["2011", "2012", "2013", "2014+"],
  V60: ["2011", "2012", "2013", "2014+"],
};

/**
 * model+year → engines that were offered (intersected with EWD vehicleconfig power options).
 * Years are inclusive; "2014+" means 2014 and later in-package.
 */
const MODEL_YEAR_ENGINES: Record<string, Record<string, string[]>> = {
  XC70: {
    "2008": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
  V70: {
    "2008": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
  S80: {
    "2007": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2008": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
  XC60: {
    "2009": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
  S60: {
    "2011": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2012": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
  V60: {
    "2011": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2012": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014+": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
  },
};

/** From vehicleconfig: which gearboxes aggregate with which engine family */
const ENGINE_TRANSMISSIONS: Record<string, TransmissionId[]> = {
  "3.2 i6": ["TF-80SC", "M66"],
  "3.0T T6": ["TF-80SC"],
  "2.5T": ["TF-80SC", "M66"],
  "2.4D D5": ["TF-80SC", "M66"],
  "2.0D D3/D4": ["TF-80SC", "MPS6", "M66"],
  "1.6T": ["MPS6", "M66", "TF-80SC"],
};

/** EWD optionExpression tokens for the selected powertrain */
export function optionTokensForSelection(sel: VehicleSelection): string[] {
  const tokens = new Set<string>();
  const model = sel.model || "";
  if (model === "XC70" || model === "V70") tokens.add("Y285");
  if (model === "S80") tokens.add("Y286");
  if (model === "S60") tokens.add("Y283");
  if (model === "V60") tokens.add("Y352");
  if (model === "XC60") {
    tokens.add("Y413");
    tokens.add("K413");
  }
  const eng = sel.engine || "";
  for (const [opt, label] of Object.entries(ENGINE_BY_OPTION)) {
    if (label === eng) tokens.add(opt);
  }
  for (const code of ENGINE_CODES[eng] || []) tokens.add(code);
  if (eng.includes("D5") || eng.includes("D3") || eng.includes("D4") || eng.startsWith("2.0D") || eng.startsWith("2.4D")) {
    tokens.add("DIESEL");
  } else if (eng) {
    tokens.add("PETROL");
  }
  const tr = normalizeTransmission(sel.transmission || "");
  if (tr === "TF-80SC") {
    tokens.add("AUTO");
    tokens.add("AWF21");
  } else if (tr === "M66") {
    tokens.add("M66");
    tokens.add("MAN");
  } else if (tr === "MPS6") {
    tokens.add("AUTO");
    tokens.add("MPS6");
  }
  return [...tokens];
}

export function normalizeTransmission(raw: string): TransmissionId | "" {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/TF-?80|AWF21|АКПП|AKPP/i.test(s) && !/MPS6|Powershift/i.test(s)) return "TF-80SC";
  if (/MPS6|Powershift|DCT/i.test(s)) return "MPS6";
  if (/M66|МКПП|MKPP|manual/i.test(s)) return "M66";
  if (s === "TF-80SC" || s === "MPS6" || s === "M66") return s;
  return "";
}

export function listModels(): string[] {
  return Object.keys(MODEL_YEARS);
}

export function yearsForModel(model: string): string[] {
  return MODEL_YEARS[model] || [];
}

export function enginesForModelYear(model: string, year: string): string[] {
  const byYear = MODEL_YEAR_ENGINES[model];
  if (!byYear) return [];
  if (year && byYear[year]) return [...byYear[year]];
  // union of all years if year empty
  const all = new Set<string>();
  for (const list of Object.values(byYear)) for (const e of list) all.add(e);
  return [...all];
}

export function transmissionsForEngine(engine: string): Array<{ id: TransmissionId; label: string }> {
  const ids = ENGINE_TRANSMISSIONS[engine] || ["TF-80SC", "M66"];
  return ids.map((id) => ({ id, label: TRANSMISSION_LABELS[id] }));
}

export function resolveFilters(sel: VehicleSelection) {
  const models = listModels();
  const modelRaw = String(sel.model || "").trim();
  const model = models.includes(modelRaw) ? modelRaw : modelRaw;
  const years = models.includes(model) ? yearsForModel(model) : [...new Set(Object.values(MODEL_YEARS).flat())];
  const yearRaw = String(sel.year || "").trim();
  // Soft: keep user year even if not in matrix row
  const year = yearRaw;
  let engines =
    models.includes(model) && year && years.includes(year)
      ? enginesForModelYear(model, year)
      : models.includes(model)
        ? enginesForModelYear(model, "")
        : [];
  const engineRaw = String(sel.engine || "").trim();
  const engine = engineRaw;
  if (engine && !engines.includes(engine)) engines = [...engines, engine];
  let transmissions = engine ? transmissionsForEngine(engine) : [];
  if (engine && !transmissions.length) {
    transmissions = ["TF-80SC", "M66"].map((id) => ({
      id: id as TransmissionId,
      label: TRANSMISSION_LABELS[id as TransmissionId],
    }));
  }
  const trNorm = normalizeTransmission(sel.transmission || "");
  // Empty = «Все КПП»; keep specific pick even if not listed
  const transmission = trNorm;
  if (transmission && !transmissions.some((t) => t.id === transmission)) {
    transmissions = [
      ...transmissions,
      {
        id: transmission as TransmissionId,
        label: TRANSMISSION_LABELS[transmission as TransmissionId] || transmission,
      },
    ];
  }
  return {
    models,
    years: year && !years.includes(year) ? [...years, year] : years,
    engines,
    transmissions,
    selection: { model, year, engine, transmission },
    optionTokens: optionTokensForSelection({ model, year, engine, transmission }),
    ewdPackageHint: "39363002",
  };
}
