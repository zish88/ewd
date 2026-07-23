import { Router } from "express";
import type Database from "better-sqlite3";
import type { PageType } from "../db/schema.js";
import {
  SEARCH_PRESETS,
  componentTypeRu,
  wireColorRu,
} from "../volvoStandards.js";
import { localizeEngineeringText } from "../termGlossary.js";

const PAGE_TYPES = new Set<PageType>(["fuses", "locations", "diagram", "connector"]);

/** Bilingual Translation Matrix */
const wordMatrix: Record<string, string[]> = {
  задняя: ["rear", "задн"],
  передняя: ["front", "передн"],
  левая: ["left", "lh", "лев", "левой", "левая", "водитель", "driver"],
  правая: ["right", "rh", "прав", "правой", "правая", "пассажир", "passenger"],
  дверь: ["door", "двер"],
  стекло: ["window", "стекл"],
  динамик: ["speaker", "аудио", "динамик", "колонк"],
  зеркало: ["mirror", "зеркал"],
  замок: ["lock", "замк", "lock"],
  подсветка: ["light", "lamp", "courtesy", "освещен", "подсветк"],
};

function normalizeQueryToken(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/-]+/gu, "")
    .trim();
}

function resolveWordAlternatives(rawWord: string): string[] {
  const word = normalizeQueryToken(rawWord);
  if (!word) return [];
  for (const [key, alts] of Object.entries(wordMatrix)) {
    for (const candidate of [key, ...alts]) {
      const stem = candidate.toLowerCase();
      if (!stem) continue;
      const hit =
        word === stem ||
        (stem.length >= 3 && word.includes(stem)) ||
        (word.length >= 3 && stem.includes(word));
      if (hit) return [...new Set([key, ...alts].map((x) => x.toLowerCase()))];
    }
  }
  return [word];
}

function buildPhraseAndGroups(query: string): string[][] {
  const cleaned = String(query || "")
    .trim()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ");
  if (!cleaned) return [];
  const groups: string[][] = [];
  for (const token of cleaned.split(/\s+/)) {
    const alts = resolveWordAlternatives(token);
    if (alts.length) groups.push(alts);
  }
  return groups;
}

const BASE_SELECT = `
  SELECT
    w.id,
    w.pin_number,
    w.wire_color_raw,
    w.wire_color_ru,
    w.function_text,
    w.from_detail,
    w.to_detail,
    w.from_token,
    w.to_token,
    w.steering_side,
    w.subject_code,
    w.source_kind,
    w.is_verified,
    w.requires_manual_review,
    w.integrity_score,
    w.harness_left,
    w.harness_right,
    w.diagram_source_page,
    w.from_component_id,
    w.to_component_id,
    w.via_component_id,
    p.manual_id AS book_id,
    p.source_page AS pinout_page_number,
    p.system_name,
    p.page_type,
    m.language AS manual_language,
    m.filename AS manual_filename,
    cf.component_code AS from_code,
    cf.component_type_ru AS from_type_ru,
    cf.description_ru AS from_desc_ru,
    cf.description_en AS from_desc_en,
    ct.component_code AS to_code,
    ct.component_type_ru AS to_type_ru,
    ct.description_ru AS to_desc_ru,
    ct.description_en AS to_desc_en,
    cv.component_code AS via_code,
    cv.component_type_ru AS via_type_ru,
    cv.description_ru AS via_desc_ru,
    cv.description_en AS via_desc_en
  FROM wire_connections w
  JOIN pages p ON p.id = w.page_id
  JOIN manuals m ON m.id = p.manual_id
  LEFT JOIN components cf ON cf.id = w.from_component_id
  LEFT JOIN components ct ON ct.id = w.to_component_id
  LEFT JOIN components cv ON cv.id = w.via_component_id
`;

const ORDER_DIAGRAM_FIRST = `
  ORDER BY w.integrity_score DESC, w.is_verified DESC, w.requires_manual_review ASC,
           CASE p.page_type WHEN 'connector' THEN 0 WHEN 'diagram' THEN 1 WHEN 'fuses' THEN 2 ELSE 3 END,
           p.source_page ASC, w.id ASC
`;

function searchHaystack(row: any): string {
  return [
    row.system_name,
    row.from_code,
    row.to_code,
    row.via_code,
    row.subject_code,
    row.from_token,
    row.to_token,
    row.from_type_ru,
    row.to_type_ru,
    row.via_type_ru,
    row.from_desc_ru,
    row.from_desc_en,
    row.to_desc_ru,
    row.to_desc_en,
    row.via_desc_ru,
    row.via_desc_en,
    row.from_detail,
    row.to_detail,
    row.pin_number,
    row.wire_color_raw,
    row.wire_color_ru,
    row.function_text,
    row.steering_side,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rowMatchesAndGroups(row: any, groups: string[][]): boolean {
  const hay = searchHaystack(row);
  if (!hay) return false;
  return groups.every((alts) => alts.some((alt) => hay.includes(alt.toLowerCase())));
}

function hasCodeBoundaryMatch(haystack: string, term: string): boolean {
  if (!haystack || !term) return false;
  const escaped = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z/])${escaped}(?![0-9A-Za-z])`, "i").test(haystack);
}

function cleanTitle(text: string): string {
  let s = String(text || "");
  s = s.replace(/TP[\s\-]*\d+[A-Z]?/gi, " ");
  s = s.replace(/\bTP\d{4,}\b/gi, " ");
  s = s.replace(/\b(?:V70|XC70|S80|XC60|S60|V60)\s*\([^)]*\)/gi, " ");
  s = s.replace(/©\s*Volvo\s*Car\s*Corporation/gi, " ");
  s = s.replace(/\bVolvo\s*Car\s*Corporation\b/gi, " ");
  s = s.replace(/All\s+rights\s+reserved\.?/gi, " ");
  s = s.replace(/Все\s+права\s+защищены\.?/gi, " ");
  s = s.replace(/\b(?:19|20)\d{2}\b/g, " ");
  s = s.replace(/(?:Unit\s+Designation\s*|Блок\s+Название\s*)+/gi, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (s.length > 70) {
    const soft = s.slice(0, 70);
    const sp = soft.lastIndexOf(" ");
    s = (sp > 20 ? soft.slice(0, sp) : soft).trim();
  }
  return s || "Электрическая схема";
}

function pickDescription(row: any): string {
  const fn = String(row.function_text || "").trim();
  if (fn) return cleanTitle(fn);
  const parts = [
    row.from_desc_ru,
    row.from_desc_en,
    row.to_desc_ru,
    row.to_desc_en,
  ].filter((x: string) => x && String(x).trim());
  if (parts.length) return cleanTitle(parts[0]);
  if (row.from_code && row.to_code) return `${row.from_code} → ${row.to_code}`;
  if (row.from_code) return String(row.from_code);
  return "Линия электрической цепи";
}

function normalizePin(raw: unknown): string {
  const pin = String(raw || "").trim();
  if (!pin || pin === "-" || pin === "—" || /^не\s*указан/i.test(pin)) return "";
  return pin;
}

function normalizeColor(raw: unknown): string {
  const color = String(raw || "").trim().toUpperCase();
  if (!color || color === "-" || color === "—") return "";
  return color;
}

function isFilledField(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s === "-" || s === "—" || s === "–") return false;
  if (/^не\s*указан/i.test(s)) return false;
  return true;
}

/**
 * Integrity score = (populated_required / total_required) * 100.
 * Required: from_node, to_node, wire_color, pin_number.
 */
export function calculateDataScore(card: {
  from_node?: unknown;
  to_node?: unknown;
  wire_color?: unknown;
  wire_color_raw?: unknown;
  pin_number?: unknown;
  integrity_score?: unknown;
}): number {
  const required = [
    card.from_node,
    card.to_node,
    isFilledField(card.wire_color) ? card.wire_color : card.wire_color_raw,
    card.pin_number,
  ];
  const filled = required.filter((v) => isFilledField(v)).length;
  const computed = Math.round((filled / required.length) * 100);
  // Stored 0 means "never scored" on older DBs — recompute from fields
  if (typeof card.integrity_score === "number" && Number.isFinite(card.integrity_score) && card.integrity_score > 0) {
    return Math.max(0, Math.min(100, Math.round(card.integrity_score)));
  }
  return computed;
}

function extractSubjectCode(systemName: string): string {
  const m = String(systemName || "").match(/\b(\d+\/\d+)\b/);
  return m ? m[1] : "";
}

/**
 * One atomic card per wire row (EN-only DB). Sorted by integrity score DESC.
 */
function rowsToCards(rows: any[]) {
  const cards = rows.map((row) => {
    const from_node = row.from_code || "—";
    const to_node = row.to_code || "—";
    const via_node = row.via_code || "—";
    const pin = normalizePin(row.pin_number) || "—";
    const color = normalizeColor(row.wire_color_raw) || "—";
    const colorRu = color !== "—" ? wireColorRu(color) : "—";
    const page_type = row.page_type || "diagram";
    const system_name = cleanTitle(row.system_name);
    const subject =
      String(row.subject_code || "").trim() || extractSubjectCode(system_name);
    const primary_node =
      page_type === "connector" && subject
        ? subject
        : from_node !== "—"
          ? from_node
          : to_node !== "—"
            ? to_node
            : via_node !== "—"
              ? via_node
              : "—";
    const steering_side = String(row.steering_side || "").toUpperCase();
    const from_type_ru = row.from_type_ru || (from_node !== "—" ? componentTypeRu(from_node) : "") || "";
    const to_type_ru = row.to_type_ru || (to_node !== "—" ? componentTypeRu(to_node) : "") || "";
    const via_type_ru =
      row.via_type_ru ||
      (via_node !== "—" ? componentTypeRu(via_node) || "Промежуточный разъем жгута" : "") ||
      "";
    const component_type_ru =
      (page_type === "connector" && subject ? componentTypeRu(subject) : "") ||
      from_type_ru ||
      to_type_ru ||
      componentTypeRu(primary_node) ||
      "";

    const description = localizeEngineeringText(pickDescription(row));
    const function_text = localizeEngineeringText(String(row.function_text || "").trim() || description);
    const from_detail = localizeEngineeringText(String(row.from_detail || "").trim());
    const to_detail = localizeEngineeringText(String(row.to_detail || "").trim());
    const pinout_page_number = Number(row.pinout_page_number) || 0;
    const diagram_page_number = Number(row.diagram_source_page) || 0;
    const page_number = diagram_page_number > 0 ? diagram_page_number : pinout_page_number;

    const out = {
      id: row.id,
      page_number,
      pinout_page_number,
      diagram_page_number,
      book_id: row.book_id,
      pin_number: pin,
      pins: pin !== "—" ? [pin] : [],
      wire_color: color,
      wire_color_ru: colorRu,
      wire_color_label:
        colorRu && colorRu !== "—" && color !== "—" ? `${colorRu} (${color})` : colorRu,
      color,
      component_code: primary_node,
      component_type_ru,
      from_node,
      to_node,
      via_node,
      via_code: via_node !== "—" ? via_node : "",
      from_type_ru,
      to_type_ru,
      via_type_ru,
      from_detail,
      to_detail,
      from_token: String(row.from_token || "").trim(),
      to_token: String(row.to_token || "").trim(),
      steering_side,
      subject_code: subject,
      is_verified: Number(row.is_verified) === 1 ? 1 : 0,
      requires_manual_review: Number(row.requires_manual_review) === 1 ? 1 : 0,
      description,
      function_text,
      subtitle: "",
      system_name: localizeEngineeringText(system_name),
      page_type,
      search_target: primary_node !== "—" ? primary_node : subject || "",
      integrity_score: Number(row.integrity_score) || 0,
      harness_left: String(row.harness_left || "").trim(),
      harness_right: String(row.harness_right || "").trim(),
      score: 0,
    };
    out.score = calculateDataScore(out);
    return out;
  });

  cards.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.is_verified || 0) !== (a.is_verified || 0)) return (b.is_verified || 0) - (a.is_verified || 0);
    if ((a.requires_manual_review || 0) !== (b.requires_manual_review || 0)) {
      return (a.requires_manual_review || 0) - (b.requires_manual_review || 0);
    }
    const pageDiff = Number(a.page_number) - Number(b.page_number);
    if (pageDiff !== 0) return pageDiff;
    return Number(a.id) - Number(b.id);
  });
  return cards;
}

type SearchSpec = {
  codes?: string[];
  prefixes?: string[];
  tokens?: string[];
  pageTypes?: PageType[];
  forceColor?: string;
};

function executeVolvoSearch(db: Database.Database, spec: SearchSpec) {
  const codes = spec.codes || [];
  const prefixes = spec.prefixes || [];
  const tokens = spec.tokens || [];
  if (!codes.length && !prefixes.length && !tokens.length) return [];

  const clauses: string[] = [];
  const params: string[] = [];

  for (const code of codes) {
    clauses.push(
      `(cf.component_code = ? OR ct.component_code = ? OR cv.component_code = ?
        OR IFNULL(w.subject_code,'') = ?
        OR p.system_name LIKE '%' || ? || '%'
        OR IFNULL(w.from_detail,'') LIKE '%' || ? || '%'
        OR IFNULL(w.to_detail,'') LIKE '%' || ? || '%'
        OR IFNULL(w.from_token,'') LIKE '%' || ? || '%'
        OR IFNULL(w.to_token,'') LIKE '%' || ? || '%')`,
    );
    params.push(code, code, code, code, code, code, code, code, code);
  }
  for (const prefix of prefixes) {
    clauses.push(
      `(cf.component_code LIKE ? OR ct.component_code LIKE ? OR cv.component_code LIKE ?
        OR p.system_name LIKE ?)`,
    );
    params.push(`${prefix}%`, `${prefix}%`, `${prefix}%`, `%${prefix}%`);
  }
  for (const token of tokens) {
    clauses.push(
      `(cf.description_en LIKE '%' || ? || '%' OR cf.description_ru LIKE '%' || ? || '%'
        OR ct.description_en LIKE '%' || ? || '%' OR ct.description_ru LIKE '%' || ? || '%'
        OR IFNULL(cv.description_en,'') LIKE '%' || ? || '%' OR IFNULL(cv.description_ru,'') LIKE '%' || ? || '%'
        OR p.system_name LIKE '%' || ? || '%'
        OR IFNULL(w.function_text,'') LIKE '%' || ? || '%'
        OR IFNULL(w.from_detail,'') LIKE '%' || ? || '%'
        OR IFNULL(w.to_detail,'') LIKE '%' || ? || '%'
        OR cf.component_code LIKE '%' || ? || '%' OR ct.component_code LIKE '%' || ? || '%'
        OR cv.component_code LIKE '%' || ? || '%')`,
    );
    params.push(
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
      token,
    );
  }

  let sql = `${BASE_SELECT} WHERE (${clauses.join(" OR ")})`;
  if (spec.pageTypes?.length) {
    sql += ` AND p.page_type IN (${spec.pageTypes.map(() => "?").join(",")})`;
    params.push(...spec.pageTypes);
  }
  sql += ORDER_DIAGRAM_FIRST;

  let rows = db.prepare(sql).all(...params) as any[];

  rows = rows.filter((row) => {
    const hay = searchHaystack(row);
    const codeOk =
      !codes.length ||
      codes.some(
        (code) =>
          row.from_code === code ||
          row.to_code === code ||
          row.via_code === code ||
          hasCodeBoundaryMatch(hay, code) ||
          String(row.system_name || "").includes(code) ||
          String(row.from_detail || "").includes(code) ||
          String(row.to_detail || "").includes(code),
      );
    const prefixOk =
      !prefixes.length ||
      prefixes.some(
        (prefix) =>
          String(row.from_code || "").startsWith(prefix) ||
          String(row.to_code || "").startsWith(prefix) ||
          String(row.via_code || "").startsWith(prefix),
      );
    const tokenOk =
      !tokens.length ||
      tokens.some((token) => hay.includes(String(token).toLowerCase()));
    const parts: boolean[] = [];
    if (codes.length) parts.push(codeOk);
    if (prefixes.length) parts.push(prefixOk);
    if (tokens.length) parts.push(tokenOk);
    return parts.some(Boolean);
  });

  const force = spec.forceColor?.toUpperCase();
  if (force && force !== "—") {
    rows = rows.filter((row) => String(row.wire_color_raw || "").toUpperCase() === force);
  }

  return rowsToCards(rows);
}

function executePhraseAndSearch(db: Database.Database, query: string, forceColor?: string) {
  const groups = buildPhraseAndGroups(query);
  if (!groups.length) return [];

  const andClauses: string[] = [];
  const params: string[] = [];

  for (const alts of groups) {
    const orParts: string[] = [];
    for (const alt of alts) {
      orParts.push(
        `(p.system_name LIKE '%' || ? || '%'
          OR IFNULL(cf.description_ru,'') LIKE '%' || ? || '%'
          OR IFNULL(cf.description_en,'') LIKE '%' || ? || '%'
          OR IFNULL(ct.description_ru,'') LIKE '%' || ? || '%'
          OR IFNULL(ct.description_en,'') LIKE '%' || ? || '%'
          OR IFNULL(cv.description_ru,'') LIKE '%' || ? || '%'
          OR IFNULL(cv.description_en,'') LIKE '%' || ? || '%'
          OR IFNULL(w.function_text,'') LIKE '%' || ? || '%'
          OR IFNULL(w.from_detail,'') LIKE '%' || ? || '%'
          OR IFNULL(w.to_detail,'') LIKE '%' || ? || '%'
          OR IFNULL(cf.component_code,'') LIKE '%' || ? || '%'
          OR IFNULL(ct.component_code,'') LIKE '%' || ? || '%'
          OR IFNULL(cv.component_code,'') LIKE '%' || ? || '%'
          OR IFNULL(cf.component_type_ru,'') LIKE '%' || ? || '%'
          OR IFNULL(ct.component_type_ru,'') LIKE '%' || ? || '%')`,
      );
      params.push(alt, alt, alt, alt, alt, alt, alt, alt, alt, alt, alt, alt, alt, alt, alt);
    }
    andClauses.push(`(${orParts.join(" OR ")})`);
  }

  const sql = `${BASE_SELECT} WHERE ${andClauses.join(" AND ")}${ORDER_DIAGRAM_FIRST}`;
  let rows = (db.prepare(sql).all(...params) as any[]).filter((row) => rowMatchesAndGroups(row, groups));

  const force = forceColor?.toUpperCase();
  if (force && force !== "—") {
    rows = rows.filter((row) => String(row.wire_color_raw || "").toUpperCase() === force);
  }

  return rowsToCards(rows);
}

function executeUniversalSearch(db: Database.Database, query: string, forceColor?: string) {
  const q = String(query || "").trim();
  if (!q) return [];

  const preset = SEARCH_PRESETS[q.toLowerCase()];
  if (preset) {
    return executeVolvoSearch(db, { ...preset, forceColor });
  }

  if (/^\d+\/\d+$/.test(q)) {
    return executeVolvoSearch(db, { codes: [q], forceColor });
  }
  if (/^\d+\/$/.test(q) || /^\d+$/.test(q)) {
    const prefix = q.endsWith("/") ? q : `${q}/`;
    return executeVolvoSearch(db, { prefixes: [prefix], forceColor });
  }
  if (/^[A-Za-z]{2,6}$/.test(q)) {
    return executeVolvoSearch(db, { tokens: [q], forceColor });
  }
  // Color-only query (RD-GY, VT-WH)
  if (/^[A-Z]{1,3}(?:-[A-Z]{1,3})?$/i.test(q) && !q.includes("/")) {
    const color = q.toUpperCase();
    const rows = db
      .prepare(`${BASE_SELECT} WHERE UPPER(w.wire_color_raw) = ? ${ORDER_DIAGRAM_FIRST}`)
      .all(color) as any[];
    return rowsToCards(rows);
  }

  return executePhraseAndSearch(db, q, forceColor);
}

function listPagesByType(db: Database.Database, pageType: PageType) {
  const rows = db
    .prepare(
      `
    SELECT p.id, p.manual_id AS book_id, p.source_page AS page_number,
           p.system_name, p.page_type, m.language
    FROM pages p
    JOIN manuals m ON m.id = p.manual_id
    WHERE p.page_type = ?
    ORDER BY p.source_page ASC, p.manual_id ASC
  `,
    )
    .all(pageType) as any[];

  const byPage: Record<string, any> = {};
  for (const row of rows) {
    const key = String(row.page_number);
    const isRu = String(row.language || "").toUpperCase() === "RU";
    if (!byPage[key] || isRu) {
      const title = cleanTitle(row.system_name) || `Страница ${row.page_number}`;
      byPage[key] = {
        id: row.id,
        book_id: row.book_id,
        page_number: row.page_number,
        system_name: title,
        page_type: row.page_type,
        description: title,
        subtitle: "",
        component_code: "—",
        component_type_ru: "",
        from_node: "—",
        to_node: "—",
        pin_number: "—",
        wire_color: "—",
        wire_color_ru: "—",
        search_target: "",
        kind: "page",
      };
    }
  }
  return Object.values(byPage);
}

function listFuseStandardPages(db: Database.Database) {
  const byType = listPagesByType(db, "fuses");
  const fromCodes = executeVolvoSearch(db, { prefixes: ["11/", "15/"] });
  const pageMap: Record<string, any> = {};
  for (const page of byType) pageMap[String(page.page_number)] = page;
  for (const card of fromCodes) {
    const key = String(card.page_number);
    if (!pageMap[key]) {
      pageMap[key] = {
        id: card.id,
        book_id: card.book_id,
        page_number: card.page_number,
        system_name: card.system_name || `Предохранители · стр. ${card.page_number}`,
        page_type: "fuses",
        description: `${card.component_type_ru || "Предохранитель"} ${card.component_code}`.trim(),
        component_code: card.component_code,
        component_type_ru: card.component_type_ru,
        from_node: card.from_node,
        to_node: card.to_node,
        pin_number: "—",
        wire_color: "—",
        wire_color_ru: "—",
        search_target: card.search_target,
        kind: "page",
      };
    }
  }
  return Object.values(pageMap).sort((a: any, b: any) => a.page_number - b.page_number);
}

export function createSearchRouter(db: Database.Database) {
  const router = Router();
  router.get("/", (req, res) => {
    const preset = String(req.query.preset || "").toLowerCase();
    if (preset && SEARCH_PRESETS[preset]) {
      return res.json({
        results: executeVolvoSearch(db, { ...SEARCH_PRESETS[preset] }),
        preset,
      });
    }
    res.json({ results: executeUniversalSearch(db, String(req.query.q ?? "")) });
  });
  return router;
}

export function createLocationRouter(db: Database.Database) {
  const router = Router();

  router.get("/", (req, res) => {
    let pageType = String(req.query.type || "").toLowerCase();
    if (pageType === "diagrams") pageType = "diagram";
    if (pageType === "fuses") {
      return res.json({ results: listFuseStandardPages(db), page_type: "fuses" });
    }
    if (!PAGE_TYPES.has(pageType as PageType)) {
      return res.status(400).json({ error: "Укажите type=fuses|locations|diagram" });
    }
    return res.json({ results: listPagesByType(db, pageType as PageType), page_type: pageType });
  });

  router.get("/identify", (req, res) => {
    const harness = String(req.query.harness ?? "").toLowerCase();
    const color = String(req.query.color ?? "");
    const harnessToPreset: Record<string, string> = {
      engine: "engine",
      "front-door": "front-left-door",
      "front-left-door": "front-left-door",
      "front-right-door": "front-right-door",
      cabin: "cabin",
      trunk: "trunk",
    };
    const presetKey = harnessToPreset[harness] || harness;
    const preset = SEARCH_PRESETS[presetKey];
    if (preset) {
      return res.json({
        results: executeVolvoSearch(db, { ...preset, forceColor: color }),
        preset: presetKey,
      });
    }
    res.json({ results: executeUniversalSearch(db, harness, color) });
  });

  router.get("/:name", (req, res) => {
    const name = String(req.params.name || "").toLowerCase();
    const preset = SEARCH_PRESETS[name];
    if (preset) {
      return res.json({
        results: executeVolvoSearch(db, { ...preset }),
        preset: name,
      });
    }
    res.json({ results: executeUniversalSearch(db, req.params.name) });
  });

  return router;
}

export function createOverrideRouter(_db?: Database.Database) {
  return Router();
}
