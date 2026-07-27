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

export type EngineOption = {
  id: string;
  label: string;
  market?: string;
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
  /** Capital package 4/5 (VEA / Drive-E) */
  VEP4: "2.0T Drive-E",
  VED4: "2.0D Drive-E",
};

const ENGINE_CODES: Record<string, string[]> = {
  "3.2 i6": ["B6324S5", "B6324S4"],
  "3.0T T6": ["B6304TX"],
  "2.5T": ["B5254TX", "B5254T12"],
  "2.4D D5": ["D5244TX"],
  "2.0D D3/D4": ["D5204TX", "D4162TX"],
  "1.6T": ["B4164TX", "B5204TX"],
  "2.0T Drive-E": ["B4204TX"],
  "2.0D Drive-E": ["D4204TX"],
};

/** Model → years available in this EWD package / SPA P3 range */
const MODEL_YEARS: Record<string, string[]> = {
  XC70: ["2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016"],
  V70: ["2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016"],
  S80: ["2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016"],
  XC60: ["2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017"],
  S60: ["2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018"],
  V60: ["2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018"],
};

/**
 * model+year → engines actually offered on P3 (catalog / press), not a full EWD option dump.
 * Late P3 years are exact: the engine range changed during the Drive-E transition.
 * Lists are the union of confirmed Global/EU and North-American offerings; regional
 * engines are qualified separately in MODEL_YEAR_ENGINE_MARKETS.
 */
const MODEL_YEAR_ENGINES: Record<string, Record<string, string[]>> = {
  XC70: {
    "2008": ["3.2 i6", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
  },
  V70: {
    "2008": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
  },
  S80: {
    "2007": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2008": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2009": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
  },
  XC60: {
    "2009": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2010": ["3.2 i6", "3.0T T6", "2.4D D5"],
    "2011": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4"],
    "2012": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.2 i6", "3.0T T6", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.2 i6", "3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2017": ["2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
  },
  S60: {
    "2011": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2012": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2017": ["2.5T", "2.0T Drive-E", "2.0D Drive-E"],
    "2018": ["2.0T Drive-E", "2.0D Drive-E"],
  },
  V60: {
    "2011": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2012": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2013": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T"],
    "2014": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2015": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "1.6T", "2.0T Drive-E", "2.0D Drive-E"],
    "2016": ["3.0T T6", "2.5T", "2.4D D5", "2.0D D3/D4", "2.0T Drive-E", "2.0D Drive-E"],
    "2017": ["2.5T", "2.0T Drive-E", "2.0D Drive-E"],
    "2018": ["2.0T Drive-E", "2.0D Drive-E"],
  },
};

/** Market labels are UI qualifiers; engine ids stay stable for EWD option tokens. */
const MODEL_YEAR_ENGINE_MARKETS: Record<string, Record<string, Record<string, string>>> = {
  XC70: {
    "2014": { "3.2 i6": "Северная Америка" },
    "2015": { "3.2 i6": "Северная Америка" },
    "2016": { "2.5T": "Северная Америка" },
  },
  S80: {
    "2014": { "3.2 i6": "Северная Америка" },
    "2016": { "2.5T": "Северная Америка" },
  },
  XC60: {
    "2014": { "3.2 i6": "Северная Америка", "2.5T": "Северная Америка" },
    "2015": { "2.5T": "Северная Америка" },
    "2016": { "2.5T": "Северная Америка" },
    "2017": { "2.5T": "Северная Америка" },
  },
  S60: {
    "2014": { "2.5T": "Северная Америка" },
    "2015": { "2.5T": "Северная Америка" },
    "2016": { "2.5T": "Северная Америка" },
    "2017": { "2.5T": "Северная Америка" },
  },
  V60: {
    "2014": { "2.5T": "Северная Америка" },
    "2015": { "2.5T": "Северная Америка" },
    "2016": { "2.5T": "Северная Америка" },
    "2017": { "2.5T": "Северная Америка" },
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
  "2.0T Drive-E": ["TF-80SC", "M66"],
  "2.0D Drive-E": ["TF-80SC", "M66"],
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
  if (eng === "2.0T Drive-E") {
    tokens.add("VEP4");
    tokens.add("B4204TX");
  }
  if (eng === "2.0D Drive-E") {
    tokens.add("VED4");
    tokens.add("D4204TX");
  }
  if (
    eng.includes("D5") ||
    eng.includes("D3") ||
    eng.includes("D4") ||
    eng.startsWith("2.0D") ||
    eng.startsWith("2.4D") ||
    eng === "2.0D Drive-E"
  ) {
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

export function engineOptionsForModelYear(model: string, year: string): EngineOption[] {
  const markets = MODEL_YEAR_ENGINE_MARKETS[model]?.[year] || {};
  return enginesForModelYear(model, year).map((id) => {
    const market = markets[id];
    return {
      id,
      label: market ? `${id} · ${market}` : id,
      ...(market ? { market } : {}),
    };
  });
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
  // The old matrix collapsed late production into "2014+". Clear that stale
  // value so old URLs/localStorage cannot silently select the wrong engine.
  const legacyCollapsedYear =
    yearRaw === "2014+" && years.includes("2014") && !years.includes("2014+");
  const year = legacyCollapsedYear ? "" : yearRaw;
  let engines =
    models.includes(model) && year && years.includes(year)
      ? enginesForModelYear(model, year)
      : models.includes(model)
        ? enginesForModelYear(model, "")
        : [];
  const engineRaw = String(sel.engine || "").trim();
  // Drop stale engine when it is not offered for this model+year (do not soft-append).
  const engine = !legacyCollapsedYear && engineRaw && engines.includes(engineRaw) ? engineRaw : "";
  const engineOptions = engineOptionsForModelYear(model, year);
  let transmissions = engine ? transmissionsForEngine(engine) : [];
  if (engine && !transmissions.length) {
    transmissions = ["TF-80SC", "M66"].map((id) => ({
      id: id as TransmissionId,
      label: TRANSMISSION_LABELS[id as TransmissionId],
    }));
  }
  const trNorm = normalizeTransmission(sel.transmission || "");
  // Empty = «Все КПП»; keep specific pick even if not listed (only when engine is valid)
  let transmission = trNorm;
  if (transmission && !transmissions.some((t) => t.id === transmission)) {
    if (engine) {
      transmissions = [
        ...transmissions,
        {
          id: transmission as TransmissionId,
          label: TRANSMISSION_LABELS[transmission as TransmissionId] || transmission,
        },
      ];
    } else {
      transmission = "";
    }
  }
  return {
    models,
    years: year && !years.includes(year) ? [...years, year] : years,
    engines,
    engineOptions,
    transmissions,
    selection: { model, year, engine, transmission },
    optionTokens: optionTokensForSelection({ model, year, engine, transmission }),
    ewdPackageHint: "39363002",
  };
}
