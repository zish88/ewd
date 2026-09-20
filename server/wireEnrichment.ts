/**
 * Rules-first обогащение карточек (не LLM).
 * Offline-кэш + те же шаблоны можно применить на лету в nav.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EnrichmentConfidence = "high" | "medium" | "low";

export type ComponentEnrichment = {
  role_ru: string;
  confidence: EnrichmentConfidence;
  sources: string[];
};

export type WireEnrichment = {
  from_to_plain_ru: string;
  purpose_ru?: string;
  confidence: EnrichmentConfidence;
  sources: string[];
};

export type CardEnrichment = {
  role_ru?: string;
  from_to_plain_ru?: string;
  purpose_ru?: string;
  confidence?: EnrichmentConfidence;
  sources?: string[];
};

export type WireEnrichmentCache = {
  version: number;
  model_pass: string;
  generated_at: string;
  components: Record<string, ComponentEnrichment>;
  wires: Record<string, WireEnrichment>;
};

const DETAIL_RE =
  /^(\d+\/\d+)\s*:\s*([0-9A-Za-z./-]+)\s*(?:[—–\-]\s*(.+))?$/u;

export type ParsedDetail = {
  code: string;
  pin: string;
  name: string;
};

/** Разбор `3/362:1 — Переключатель…` или голого `3/362:1`. */
export function parseEnrichmentDetail(detail: string | null | undefined): ParsedDetail | null {
  const s = String(detail || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const m = s.match(DETAIL_RE);
  if (!m) return null;
  return {
    code: m[1],
    pin: m[2],
    name: String(m[3] || "").trim(),
  };
}

function sideLabel(p: ParsedDetail): string {
  if (p.name) return `${p.name} (${p.code}:${p.pin})`;
  return `${p.code}:${p.pin}`;
}

/**
 * Человеческое «от … к …» только из фактов карточки.
 * high — оба конца с именем; medium — хотя бы один с именем; иначе null.
 */
export function buildFromToPlainRu(
  fromDetail: string | null | undefined,
  toDetail: string | null | undefined,
): { text: string; confidence: EnrichmentConfidence; sources: string[] } | null {
  const from = parseEnrichmentDetail(fromDetail);
  const to = parseEnrichmentDetail(toDetail);
  if (!from || !to) return null;
  const named = (from.name ? 1 : 0) + (to.name ? 1 : 0);
  if (named === 0) return null;
  const confidence: EnrichmentConfidence = named === 2 ? "high" : "medium";
  return {
    text: `От ${sideLabel(from)} к ${sideLabel(to)}`,
    confidence,
    sources: ["from_detail", "to_detail", "rules-from-to"],
  };
}

function softDecap(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  // Не трогаем аббревиатуры / коды в начале
  if (/^[A-ZА-Я]{2,}/u.test(t) || /^\d/.test(t)) return t;
  return t.charAt(0).toLocaleLowerCase("ru") + t.slice(1);
}

/**
 * Короткая фраза «зачем провод» строго из фактов (без LLM).
 * Приоритет: function_text (RU) → оба имени → одно имя + код второй стороны.
 */
export function buildPurposeRu(parts: {
  fromDetail?: string | null;
  toDetail?: string | null;
  functionText?: string | null;
}): { text: string; confidence: EnrichmentConfidence; sources: string[] } | null {
  const ft = String(parts.functionText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (ft.length >= 8 && /[а-яё]/i.test(ft) && !/^[A-Z0-9_./\-]+$/.test(ft)) {
    const text = ft.length > 160 ? `${ft.slice(0, 157)}…` : ft;
    return { text, confidence: "high", sources: ["function_text"] };
  }

  const from = parseEnrichmentDetail(parts.fromDetail);
  const to = parseEnrichmentDetail(parts.toDetail);
  if (!from || !to) return null;

  if (from.name && to.name) {
    const text = `Соединяет ${softDecap(from.name)} с ${softDecap(to.name)}`;
    return {
      text: text.length > 180 ? `${text.slice(0, 177)}…` : text,
      confidence: "high",
      sources: ["from_detail", "to_detail", "rules-purpose"],
    };
  }
  if (from.name) {
    return {
      text: `Связь от ${softDecap(from.name)} к ${to.code}:${to.pin}`,
      confidence: "medium",
      sources: ["from_detail", "rules-purpose"],
    };
  }
  if (to.name) {
    return {
      text: `Связь от ${from.code}:${from.pin} к ${softDecap(to.name)}`,
      confidence: "medium",
      sources: ["to_detail", "rules-purpose"],
    };
  }
  return null;
}

export function wireEnrichmentKey(parts: {
  wire_uid?: string;
  from_node?: string;
  to_node?: string;
  pin_number?: string;
  wire_color?: string;
}): string {
  const wu = String(parts.wire_uid || "").trim();
  const from = String(parts.from_node || "").trim();
  const to = String(parts.to_node || "").trim();
  // Один wire_uid бывает в двух ориентациях (A→B и B→A) — ключ обязан их различать.
  if (wu && from && to) return `uid:${wu}|${from}>${to}`;
  if (wu) return `uid:${wu}`;
  return [
    "ft",
    from,
    to,
    String(parts.pin_number || "").trim(),
    String(parts.wire_color || "").trim(),
  ].join("|");
}

let cached: WireEnrichmentCache | null | undefined;

export function enrichmentCachePath(root = process.cwd()): string {
  return join(root, "data", "enrichment", "wire-enrichment.json");
}

/** Сброс кэша в памяти (тесты / после rebuild). */
export function resetWireEnrichmentCache(): void {
  cached = undefined;
}

export function loadWireEnrichmentCache(root = process.cwd()): WireEnrichmentCache | null {
  if (cached !== undefined) return cached;
  const path = enrichmentCachePath(root);
  if (!existsSync(path)) {
    cached = null;
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as WireEnrichmentCache;
    if (!raw || typeof raw !== "object") {
      cached = null;
      return null;
    }
    cached = {
      version: Number(raw.version) || 1,
      model_pass: String(raw.model_pass || "rules-v1"),
      generated_at: String(raw.generated_at || ""),
      components: raw.components && typeof raw.components === "object" ? raw.components : {},
      wires: raw.wires && typeof raw.wires === "object" ? raw.wires : {},
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Собрать enrichment для карточки: факты карточки (Откуда/Куда) — источник истины.
 * Кэш только fallback / role_ru. Не меняет цвет/пин/expr.
 */
export function cardEnrichmentFromFacts(
  card: {
    component_code?: string;
    subject_code?: string;
    from_node?: string;
    to_node?: string;
    from_detail?: string;
    to_detail?: string;
    wire_uid?: string;
    pin_number?: string;
    wire_color?: string;
    function_text?: string;
  },
  nameByCode?: Map<string, string> | null,
  fileCache?: WireEnrichmentCache | null,
): CardEnrichment | null {
  const cache = fileCache === undefined ? loadWireEnrichmentCache() : fileCache;
  const out: CardEnrichment = { sources: [] };

  const code =
    String(card.component_code || card.subject_code || card.from_node || "").trim() ||
    "";
  if (code && cache?.components?.[code]?.role_ru) {
    out.role_ru = cache.components[code].role_ru;
    out.confidence = cache.components[code].confidence;
    out.sources = [...(out.sources || []), ...(cache.components[code].sources || [])];
  } else if (code && nameByCode?.get(code)) {
    out.role_ru = String(nameByCode.get(code)).trim();
    out.confidence = "high";
    out.sources = [...(out.sources || []), "components.name_ru"];
  }

  const wKey = wireEnrichmentKey(card);
  const cachedWire = cache?.wires?.[wKey];

  // Plain всегда из текущих from/to карточки — совпадает с «Откуда/Куда» в UI.
  const livePlain = buildFromToPlainRu(card.from_detail, card.to_detail);
  if (livePlain) {
    out.from_to_plain_ru = livePlain.text;
    out.confidence = livePlain.confidence;
    out.sources = [...(out.sources || []), ...livePlain.sources];
  } else if (cachedWire?.from_to_plain_ru) {
    out.from_to_plain_ru = cachedWire.from_to_plain_ru;
    out.confidence = cachedWire.confidence || out.confidence;
    out.sources = [...(out.sources || []), ...(cachedWire.sources || [])];
  }

  const livePurpose = buildPurposeRu({
    fromDetail: card.from_detail,
    toDetail: card.to_detail,
    functionText: card.function_text,
  });
  if (livePurpose) {
    out.purpose_ru = livePurpose.text;
    out.sources = [...(out.sources || []), ...livePurpose.sources];
    if (!out.confidence) out.confidence = livePurpose.confidence;
  } else if (cachedWire?.purpose_ru) {
    out.purpose_ru = cachedWire.purpose_ru;
    out.sources = [...(out.sources || []), ...(cachedWire.sources || [])];
  }

  if (!out.role_ru && !out.from_to_plain_ru && !out.purpose_ru) return null;
  return out;
}
