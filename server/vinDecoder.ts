/**
 * Volvo VIN decoder for P3 SPA cars covered by this EWD package.
 * Positions (1-based): 4–5 model/body, 6–7 engine, 8 emission/restraint, 10 model year.
 * NA 2010+ VINs rearrange VDS; we try both EU and NA layouts.
 */
import {
  enginesForModelYear,
  normalizeTransmission,
  resolveFilters,
  transmissionsForEngine,
  yearsForModel,
  type TransmissionId,
} from "./vehicleMatrix.js";

export type VinDecodeResult = {
  ok: boolean;
  vin: string;
  error?: string;
  model?: string;
  year?: string;
  engine?: string;
  transmission?: string;
  engineCode?: string;
  transmissionId?: TransmissionId | "";
  wmi?: string;
  vds?: string;
  yearCode?: string;
  plant?: string;
  optionTokens?: string[];
  ewdPackageHint?: string;
  notes?: string[];
};

const YEAR_CODES: Record<string, string> = {
  "7": "2007",
  "8": "2008",
  "9": "2009",
  A: "2010",
  B: "2011",
  C: "2012",
  D: "2013",
  E: "2014",
  F: "2015",
  G: "2016",
  H: "2017",
  J: "2018",
};

/** Position 4 (EU / pre-2010 style series) and common NA pairs */
const MODEL_BY_SERIES: Record<string, string> = {
  // EU / classic series letter (pos4) for P3
  B: "XC70", // also V70 in some years — disambiguate with pos5
  L: "S80",
  R: "S60",
  // Two-char body codes seen in NA / mixed VINs
  BZ: "XC70",
  BS: "V70",
  LZ: "S80",
  LS: "S80",
  RS: "S60",
  RZ: "S60",
  DZ: "XC60",
  DS: "XC60",
  TZ: "V60",
  TS: "V60",
  // Pos4+5 for many NA 2010+ after swap still often encode model in 4-5 of normalized VDS
  A9: "S60", // polestar-ish
};

/** Engine codes at positions 6–7 (P3 common) */
const ENGINE_BY_CODE: Record<string, { engine: string; preferredTrans?: TransmissionId }> = {
  "98": { engine: "3.2 i6", preferredTrans: "TF-80SC" },
  "99": { engine: "3.0T T6", preferredTrans: "TF-80SC" },
  "59": { engine: "2.5T", preferredTrans: "TF-80SC" },
  "58": { engine: "2.5T", preferredTrans: "TF-80SC" },
  "71": { engine: "2.4D D5", preferredTrans: "TF-80SC" },
  "72": { engine: "2.4D D5", preferredTrans: "TF-80SC" },
  "74": { engine: "2.4D D5", preferredTrans: "TF-80SC" },
  "69": { engine: "2.4D D5", preferredTrans: "TF-80SC" },
  "70": { engine: "2.0D D3/D4", preferredTrans: "TF-80SC" },
  "41": { engine: "2.0D D3/D4", preferredTrans: "MPS6" },
  "42": { engine: "2.0D D3/D4", preferredTrans: "MPS6" },
  "43": { engine: "1.6T", preferredTrans: "MPS6" },
  "44": { engine: "1.6T", preferredTrans: "MPS6" },
  "38": { engine: "1.6T", preferredTrans: "MPS6" },
  "39": { engine: "2.0D D3/D4", preferredTrans: "MPS6" },
  "55": { engine: "3.0T T6", preferredTrans: "TF-80SC" },
  "56": { engine: "3.2 i6", preferredTrans: "TF-80SC" },
};

/** Position 8 → emission / gearbox hint (best-effort) */
const POS8_TRANS_HINT: Record<string, TransmissionId | undefined> = {
  "1": "M66",
  "2": "TF-80SC",
  "3": "TF-80SC",
  "4": "MPS6",
  "5": "TF-80SC",
  A: "TF-80SC",
  B: "M66",
  C: "MPS6",
  D: "TF-80SC",
};

function normalizeVin(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

function isValidVinCharset(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function yearFromCode(code: string): string {
  const y = YEAR_CODES[code];
  if (!y) return "";
  // Map 2014–2016 into UI bucket 2014+
  const n = Number(y);
  if (n >= 2014) return "2014+";
  return y;
}

function resolveModel(pos4: string, pos5: string, yearNum: number): string {
  const pair = `${pos4}${pos5}`;
  if (MODEL_BY_SERIES[pair]) return MODEL_BY_SERIES[pair];
  if (pos4 === "B") {
    // B + body: Z/N often XC70 AWD, S/W V70
    if (/[ZN]/i.test(pos5)) return "XC70";
    if (/[SW]/i.test(pos5)) return "V70";
    return yearNum >= 2008 ? "XC70" : "V70";
  }
  if (pos4 === "D" || pos4 === "C") return "XC60";
  if (pos4 === "L" || pos4 === "T") return pos4 === "T" && /[ZJ]/i.test(pos5) ? "V60" : "S80";
  if (pos4 === "R" || pos4 === "A") return "S60";
  if (MODEL_BY_SERIES[pos4]) return MODEL_BY_SERIES[pos4];
  return "";
}

/**
 * For NA MY2010+, NHTSA swap: characters 4-8 rearranged.
 * Try decoding as-is first; if model/engine unknown, try unswapped EU order.
 */
function vdsCandidates(vin: string): Array<{ pos4: string; pos5: string; eng: string; pos8: string; layout: string }> {
  const d4 = vin[3];
  const d5 = vin[4];
  const d6 = vin[5];
  const d7 = vin[6];
  const d8 = vin[7];
  const yearCode = vin[9];
  const yearNum = Number(YEAR_CODES[yearCode] || 0);
  const out = [
    { pos4: d4, pos5: d5, eng: `${d6}${d7}`, pos8: d8, layout: "as-is" },
  ];
  // Unswap heuristic for NA 2010+: 12378456 ←→ restore 12345678 style
  if (yearNum >= 2010) {
    // reverse of "4-5 ↔ 7-8 and 6-8 ↔ 4-6" is ambiguous; try common restore:
    // treated as positions: 4,5,6,7,8 → try 7,8,4,5,6 and 6,7,8,4,5
    out.push({ pos4: d7, pos5: d8, eng: `${d4}${d5}`, pos8: d6, layout: "na-alt-a" });
    out.push({ pos4: d6, pos5: d7, eng: `${d8}${d4}`, pos8: d5, layout: "na-alt-b" });
  }
  return out;
}

export function decodeVolvoVin(raw: string): VinDecodeResult {
  const vin = normalizeVin(raw);
  const notes: string[] = [];
  if (vin.length !== 17) {
    return { ok: false, vin, error: "VIN должен содержать ровно 17 символов." };
  }
  if (!isValidVinCharset(vin)) {
    return { ok: false, vin, error: "Недопустимые символы в VIN (I, O, Q запрещены)." };
  }
  if (!/^YV[14]/.test(vin) && !/^YV1/.test(vin)) {
    notes.push("WMI не похож на Volvo (ожидается YV1/YV4) — декодирование best-effort.");
  }

  const yearCode = vin[9];
  const year = yearFromCode(yearCode);
  if (!year) {
    return { ok: false, vin, error: `Неизвестный код модельного года «${yearCode}».`, yearCode };
  }

  let model = "";
  let engine = "";
  let engineCode = "";
  let preferredTrans: TransmissionId | undefined;
  let layoutUsed = "";

  for (const cand of vdsCandidates(vin)) {
    const m = resolveModel(cand.pos4, cand.pos5, Number(YEAR_CODES[yearCode]));
    const engRec = ENGINE_BY_CODE[cand.eng];
    if (m && engRec) {
      model = m;
      engine = engRec.engine;
      engineCode = cand.eng;
      preferredTrans = engRec.preferredTrans;
      layoutUsed = cand.layout;
      break;
    }
    if (!model && m) {
      model = m;
      layoutUsed = cand.layout;
    }
    if (!engine && engRec) {
      engine = engRec.engine;
      engineCode = cand.eng;
      preferredTrans = engRec.preferredTrans;
      layoutUsed = cand.layout;
    }
  }

  if (!model) {
    return {
      ok: false,
      vin,
      error: "Не удалось определить модель по позициям 4–5 VIN.",
      year,
      yearCode,
      notes,
    };
  }

  // Clamp to matrix
  const years = yearsForModel(model);
  const yearOk = years.includes(year) ? year : years.find((y) => y === "2014+") || years[years.length - 1] || year;
  let engines = enginesForModelYear(model, yearOk);
  if (engine && !engines.includes(engine)) {
    notes.push(`Двигатель ${engine} по VIN не в матрице ${model} ${yearOk} — выбран ближайший доступный.`);
    engine = engines[0] || engine;
  }
  if (!engine) {
    engine = engines[0] || "";
    notes.push("Код двигателя не распознан — подставлен первый доступный для модели/года.");
  }

  const pos8 = vin[7];
  let transmission: TransmissionId | "" =
    preferredTrans || POS8_TRANS_HINT[pos8] || "TF-80SC";
  const allowed = transmissionsForEngine(engine).map((t) => t.id);
  if (!allowed.includes(transmission as TransmissionId)) {
    transmission = allowed[0] || "";
    notes.push("КПП скорректирована под допустимые агрегаты двигателя.");
  }

  const filters = resolveFilters({ model, year: yearOk, engine, transmission });
  if (layoutUsed && layoutUsed !== "as-is") {
    notes.push(`Использована раскладка VDS: ${layoutUsed}.`);
  }

  return {
    ok: true,
    vin,
    model: filters.selection.model,
    year: filters.selection.year,
    engine: filters.selection.engine,
    transmission: filters.selection.transmission,
    transmissionId: normalizeTransmission(filters.selection.transmission),
    engineCode,
    wmi: vin.slice(0, 3),
    vds: vin.slice(3, 8),
    yearCode,
    plant: vin[10],
    optionTokens: filters.optionTokens,
    ewdPackageHint: filters.ewdPackageHint,
    notes,
  };
}
