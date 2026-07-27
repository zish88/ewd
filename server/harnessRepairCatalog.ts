import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { partImageUrl } from "./partImageIndex.js";

export type RepairConfidence = "exact" | "compatible" | "unknown" | "reference";

export type RepairPart = {
  part_number: string;
  role: string;
  name_en?: string;
  name_ru?: string;
  confidence: RepairConfidence;
  reason: string;
  cavity?: string;
  gauge_mm2?: string;
  plating?: string;
  terminal_family?: string;
  gender?: string;
  source?: string;
  note_ru?: string;
  /** Present when vida_part_image_index has a file for this PN. */
  image_url?: string | null;
};

export type CardParts = {
  code: string;
  device?: string;
  housing?: string;
  mate?: string;
  /** Legacy pin-matched terminals (exact only). */
  terminals?: Array<{ part_number: string; name_en?: string; name_ru?: string }>;
  repair?: RepairCatalogResult;
};

export type RepairCatalogResult = {
  code: string;
  pin?: string;
  gauge?: string;
  status: "exact" | "compatible" | "unknown";
  summary_ru: string;
  housing?: RepairPart;
  mate?: RepairPart;
  device?: RepairPart;
  terminals: RepairPart[];
  seals: RepairPart[];
  pigtails: RepairPart[];
  tools: RepairPart[];
};

type CatalogItem = {
  part_number: string;
  role?: string;
  name_en?: string;
  name_ru?: string;
  cavity?: string | null;
  gauge_mm2?: string | null;
  plating?: string | null;
  terminal_family?: string | null;
  gender?: string | null;
  is_pigtail?: boolean;
  source?: string;
};

type CatalogConnector = {
  housing?: CatalogItem;
  mate?: CatalogItem;
  device?: CatalogItem;
  items?: CatalogItem[];
};

type HarnessRepairCatalog = {
  connectors?: Record<string, CatalogConnector>;
  tools?: Array<
    CatalogItem & {
      confidence?: RepairConfidence;
      note_ru?: string;
      name_ru?: string;
    }
  >;
};

let catalogCache: HarnessRepairCatalog | null | undefined;
let catalogPathOverride: string | null = null;

/** Test helper — reset / inject catalog path. */
export function resetHarnessRepairCatalogCache(path?: string | null) {
  catalogCache = undefined;
  catalogPathOverride = path === undefined ? null : path;
}

function catalogPath(): string {
  return catalogPathOverride || join(process.cwd(), "data", "vida_harness_repair_catalog.json");
}

export function loadHarnessRepairCatalog(): HarnessRepairCatalog {
  if (catalogCache !== undefined) return catalogCache || {};
  const path = catalogPath();
  if (!existsSync(path)) {
    catalogCache = null;
    return {};
  }
  try {
    catalogCache = JSON.parse(readFileSync(path, "utf-8")) as HarnessRepairCatalog;
  } catch {
    catalogCache = null;
  }
  return catalogCache || {};
}

/** Extract cavity digit(s) from pin labels like "1", "21", "6/28:1". */
export function pinCavityDigits(pin: string): string {
  const raw = String(pin || "").trim();
  if (!raw || raw === "—") return "";
  const colon = raw.match(/:(\d{1,3})\b/);
  if (colon) return String(Number(colon[1]));
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));
  const m = raw.match(/(\d{1,3})\s*$/);
  return m ? String(Number(m[1])) : "";
}

export function normalizeGaugeValue(raw?: string | null): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  const m = t.match(/(\d+[.,]?\d*)/);
  if (!m) return "";
  return m[1].replace(",", ".");
}

function itemExplicitCavity(item: CatalogItem): string {
  const c = item.cavity != null && String(item.cavity).trim() !== "" ? String(item.cavity).trim() : "";
  if (c) return String(Number(c));
  const blob = `${item.name_en || ""} ${item.name_ru || ""}`;
  const re =
    /(?:^|[^0-9])(?:pin|cavity|контакт|клемма|pos(?:ition)?)\s*[#:.]?\s*0*(\d{1,3})(?:[^0-9]|$)/i;
  const m = blob.match(re) || blob.match(/:(\d{1,3})(?:\b|$)/);
  return m ? String(Number(m[1])) : "";
}

function asShellPart(
  item: CatalogItem | undefined,
  role: string,
  reason: string,
): RepairPart | undefined {
  if (!item?.part_number) return undefined;
  return {
    part_number: String(item.part_number).trim(),
    role,
    name_en: item.name_en || undefined,
    name_ru: item.name_ru || undefined,
    confidence: "exact",
    reason,
    source: item.source,
  };
}

function scoreTerminal(
  item: CatalogItem,
  cavity: string,
  gauge: string,
): { confidence: RepairConfidence; reason: string } | null {
  const role = String(item.role || "other");
  if (role === "housing" || role === "mate" || role === "device") return null;

  const itemCavity = itemExplicitCavity(item);
  const itemGauge = normalizeGaugeValue(item.gauge_mm2 || item.name_en || "");

  if (cavity && itemCavity) {
    if (itemCavity === cavity) {
      if (gauge && itemGauge && itemGauge !== gauge) {
        return {
          confidence: "compatible",
          reason: `Контакт ${cavity} в названии EPC, но сечение ${itemGauge} ≠ ${gauge} — сверьте`,
        };
      }
      return {
        confidence: "exact",
        reason: `Явная привязка к контакту ${cavity} в данных EPC`,
      };
    }
    // Different explicit cavity — not a candidate for this pin
    return null;
  }

  if (gauge && itemGauge) {
    if (itemGauge === gauge) {
      return {
        confidence: "compatible",
        reason: `Совпадает сечение ${gauge} мм²; точный контакт в EPC не указан — сверьте по корпусу`,
      };
    }
    return null;
  }

  return {
    confidence: "compatible",
    reason: cavity
      ? `Кандидат для корпуса; привязка к контакту ${cavity} в EPC не подтверждена`
      : "Кандидат для данного корпуса; точный контакт в EPC не указан",
  };
}

function toRepairPart(
  item: CatalogItem,
  confidence: RepairConfidence,
  reason: string,
  roleOverride?: string,
): RepairPart {
  const cavity = itemExplicitCavity(item) || undefined;
  const gauge = normalizeGaugeValue(item.gauge_mm2 || "") || undefined;
  return {
    part_number: String(item.part_number).trim(),
    role: roleOverride || String(item.role || "other"),
    name_en: item.name_en || undefined,
    name_ru: item.name_ru || undefined,
    confidence,
    reason,
    cavity,
    gauge_mm2: gauge,
    plating: item.plating || undefined,
    terminal_family: item.terminal_family || undefined,
    gender: item.gender || undefined,
    source: item.source,
  };
}

function toolsFromCatalog(cat: HarnessRepairCatalog): RepairPart[] {
  const tools = Array.isArray(cat.tools) ? cat.tools : [];
  return tools
    .filter((t) => t?.part_number)
    .map((t) => ({
      part_number: String(t.part_number).trim(),
      role: String(t.role || "tool"),
      name_en: t.name_en || undefined,
      name_ru: t.name_ru || undefined,
      confidence: (t.confidence as RepairConfidence) || "reference",
      reason: t.note_ru || "Сервисный инструмент Volvo, не PN конкретной клеммы",
      source: t.source,
      note_ru: t.note_ru,
    }));
}

export type MatchRepairOpts = {
  code: string;
  pin?: string;
  gauge?: string;
  /** Optional SQLite / sidecar housing override when catalog missing shell. */
  housingPn?: string;
  matePn?: string;
  devicePn?: string;
};

/**
 * Safe matcher: never invents an exact terminal without explicit EPC evidence.
 */
export function matchHarnessRepair(opts: MatchRepairOpts): RepairCatalogResult {
  const code = String(opts.code || "").trim();
  const pin = String(opts.pin || "").trim() || undefined;
  const gauge = normalizeGaugeValue(opts.gauge) || undefined;
  const cavity = pin ? pinCavityDigits(pin) : "";
  const cat = loadHarnessRepairCatalog();
  const tools = toolsFromCatalog(cat);

  const empty = (summary_ru: string, status: RepairCatalogResult["status"] = "unknown"): RepairCatalogResult => ({
    code,
    pin,
    gauge,
    status,
    summary_ru,
    terminals: [],
    seals: [],
    pigtails: [],
    tools,
  });

  if (!code) return empty("Код разъёма не указан");

  const entry = cat.connectors?.[code];
  const housing =
    asShellPart(entry?.housing, "housing", "Корпус разъёма по EPC (wiring code)") ||
    (opts.housingPn
      ? {
          part_number: opts.housingPn,
          role: "housing",
          confidence: "exact" as const,
          reason: "Корпус из карты компонентов / EPC",
        }
      : undefined);
  const mate =
    asShellPart(entry?.mate, "mate", "Ответная часть корпуса по EPC") ||
    (opts.matePn
      ? {
          part_number: opts.matePn,
          role: "mate",
          confidence: "exact" as const,
          reason: "Ответная часть из карты компонентов / EPC",
        }
      : undefined);
  const device =
    asShellPart(entry?.device, "device", "Сборочный номер устройства (если EPC отличает от корпуса)") ||
    (opts.devicePn
      ? {
          part_number: opts.devicePn,
          role: "device",
          confidence: "exact" as const,
          reason: "Деталь/сборка из EPC",
        }
      : undefined);

  if (!entry && !housing && !mate && !device) {
    return {
      ...empty("В каталоге ремонта нет данных по этому коду"),
      housing,
      mate,
      device,
    };
  }

  const skipPn = new Set(
    [housing?.part_number, mate?.part_number, device?.part_number].filter(Boolean) as string[],
  );
  const items = (entry?.items || []).filter((i) => i?.part_number && !skipPn.has(String(i.part_number)));

  const terminals: RepairPart[] = [];
  const seals: RepairPart[] = [];
  const pigtails: RepairPart[] = [];

  for (const item of items) {
    const roleRaw = String(item.role || "other");
    const isPigtail = Boolean(item.is_pigtail) || roleRaw === "pigtail";
    const isSeal = roleRaw === "seal";

    if (isSeal) {
      seals.push(
        toRepairPart(
          item,
          "compatible",
          "Уплотнение из BOM корпуса — сверьте применимость по разъёму",
          "seal",
        ),
      );
      continue;
    }
    if (isPigtail) {
      pigtails.push(
        toRepairPart(
          item,
          "compatible",
          "Ремонтный пигтейл / kit из EPC — сверьте по корпусу и сечению",
          "pigtail",
        ),
      );
      continue;
    }

    // terminal or other → treat as terminal candidate
    const scored = scoreTerminal(item, cavity, gauge || "");
    if (!scored) continue;
    terminals.push(toRepairPart(item, scored.confidence, scored.reason, "terminal"));
  }

  // If any exact cavity match exists, drop non-exact terminals to avoid noise
  const exactTerms = terminals.filter((t) => t.confidence === "exact");
  let finalTerminals = terminals;
  if (exactTerms.length > 0) {
    finalTerminals = exactTerms;
  } else if (gauge) {
    const gaugeHits = terminals.filter((t) => t.gauge_mm2 && t.gauge_mm2 === gauge);
    // Single gauge-matched terminal with no cavity conflicts → promote to exact
    if (gaugeHits.length === 1 && !gaugeHits[0].cavity) {
      finalTerminals = [
        {
          ...gaugeHits[0],
          confidence: "exact",
          reason: `Единственная клемма с сечением ${gauge} мм² в BOM этого корпуса`,
        },
      ];
    } else if (gaugeHits.length > 1) {
      finalTerminals = gaugeHits.map((t) => ({
        ...t,
        confidence: "compatible" as const,
        reason: `Несколько клемм с сечением ${gauge} мм² — сверьте тип контакта`,
      }));
    }
  }

  // Cap list size for UI
  finalTerminals = finalTerminals.slice(0, 12);
  const sealsOut = seals.slice(0, 8);
  const pigtailsOut = pigtails.slice(0, 6);

  let status: RepairCatalogResult["status"] = "unknown";
  if (finalTerminals.some((t) => t.confidence === "exact")) status = "exact";
  else if (finalTerminals.length || sealsOut.length || pigtailsOut.length || housing || mate)
    status = finalTerminals.length || sealsOut.length || pigtailsOut.length ? "compatible" : "exact";

  let summary_ru: string;
  if (status === "exact" && finalTerminals.some((t) => t.confidence === "exact")) {
    summary_ru = cavity
      ? `Найдена точная клемма для контакта ${cavity}`
      : "Найдена точная ремонтная позиция";
  } else if (finalTerminals.length || sealsOut.length || pigtailsOut.length) {
    summary_ru =
      "Есть кандидаты по корпусу — сверьте контакт/сечение (EPC не указал точный контакт)";
  } else if (housing || mate || device) {
    summary_ru = "Известны корпус/ответная часть; клеммы в BOM не найдены";
    status = "exact";
  } else {
    summary_ru = "Данных для ремонта нет";
  }

  return attachRepairImages({
    code,
    pin,
    gauge,
    status,
    summary_ru,
    housing,
    mate,
    device,
    terminals: finalTerminals,
    seals: sealsOut,
    pigtails: pigtailsOut,
    tools,
  });
}

function withImageUrl(part: RepairPart | undefined, code: string): RepairPart | undefined {
  if (!part) return undefined;
  return { ...part, image_url: partImageUrl(part.part_number, code) };
}

function attachRepairImages(repair: RepairCatalogResult): RepairCatalogResult {
  const code = repair.code;
  return {
    ...repair,
    housing: withImageUrl(repair.housing, code),
    mate: withImageUrl(repair.mate, code),
    device: withImageUrl(repair.device, code),
    terminals: (repair.terminals || []).map((t) => withImageUrl(t, code)!),
    seals: (repair.seals || []).map((t) => withImageUrl(t, code)!),
    pigtails: (repair.pigtails || []).map((t) => withImageUrl(t, code)!),
    tools: (repair.tools || []).map((t) => withImageUrl(t, code)!),
  };
}

/** Build legacy CardParts + repair block for nav wire cards. */
export function cardPartsFromRepair(repair: RepairCatalogResult): CardParts | null {
  const exactTerms = repair.terminals.filter((t) => t.confidence === "exact");
  const out: CardParts = { code: repair.code, repair };
  if (repair.device) out.device = repair.device.part_number;
  if (repair.housing) out.housing = repair.housing.part_number;
  if (repair.mate) out.mate = repair.mate.part_number;
  if (exactTerms.length) {
    out.terminals = exactTerms.map((t) => ({
      part_number: t.part_number,
      name_en: t.name_en,
      name_ru: t.name_ru,
    }));
  }
  if (!out.device && !out.housing && !out.mate && !out.terminals?.length && !repair.terminals.length && !repair.seals.length && !repair.pigtails.length) {
    // Still useful if only tools — skip empty cards
    if (!repair.housing && !repair.mate && !repair.device) return null;
  }
  return out;
}

export function partsForCode(
  code: string,
  partByCode: Map<string, string>,
  mateByCode: Map<string, string>,
  pin?: string,
  gauge?: string,
  devicePn?: string,
): CardParts | null {
  const c = String(code || "").trim();
  if (!c) return null;
  const repair = matchHarnessRepair({
    code: c,
    pin,
    gauge,
    housingPn: partByCode.get(c) || "",
    matePn: mateByCode.get(c) || "",
    devicePn: devicePn || "",
  });
  return cardPartsFromRepair(repair);
}
