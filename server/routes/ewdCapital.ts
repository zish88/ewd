/**
 * Capital package resource APIs: FaceViews, LocationViews, reports, intro (RU).
 */
import { Router } from "express";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { openDatabase } from "../db/schema.js";
import { ewdDataDir, resolveIndexedPath, safeUnderDataDir } from "../ewdPaths.js";

const ROOT = resolve(process.cwd());
const EWD_DATA = resolve(process.env.EWD_DATA_DIR || process.env.EWD_DIR || join(ROOT, "data", "ewd"));

type FuseRow = {
  id: string;
  altId: string;
  functionCode: string;
  functionName: string;
  via: string;
  amps: string;
  vehicleHint: string | null;
};

type RelayRow = {
  id: string;
  name: string;
  nameCode: string;
  vehicleHint: string | null;
};

type FuseReportBox = {
  code: string;
  fuses: FuseRow[];
  relays: RelayRow[];
};

type FaceIndex = {
  by_code?: Record<
    string,
    Array<{ objectUid?: string; designUid?: string; html?: string; svg?: string; pinCount?: number }>
  >;
  by_key?: Record<string, Array<Record<string, unknown>>>;
};

type LocIndex = {
  by_code?: Record<
    string,
    Array<{
      code?: string;
      svg?: string;
      svgs?: string[];
      svgRel?: string;
      systems?: Array<Record<string, string>>;
      type?: string;
    }>
  >;
};

let faceIndex: FaceIndex | null = null;
let locIndex: LocIndex | null = null;

function loadJson<T>(name: string): T | null {
  const path = join(EWD_DATA, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function ensure() {
  if (!faceIndex) faceIndex = loadJson<FaceIndex>("face_view_index.json");
  if (!locIndex) locIndex = loadJson<LocIndex>("location_index.json");
}

function normalizeCode(raw: string): string {
  const m = String(raw || "")
    .trim()
    .match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(raw || "").trim();
}

function resourcesRoot(): string {
  return join(ewdDataDir(), "Resources");
}

function introDir(): string {
  return join(resourcesRoot(), "Introduction");
}

const REPORT_FILES: Record<string, string> = {
  fuse: "{FuseReport}.html",
  inline: "{inlineReport}.html",
  splice: "{splicereport}.html",
  grounds: join("..", "Harness", "Grounds.html"),
};

const FUSE_BOX_NAMES_RU: Record<string, string> = {
  "15/31": "Токораспределительный узел · моторный отсек",
  "15/32": "Токораспределительный узел · багажник",
  "15/32B": "Токораспределительный узел · багажник (B)",
  "15/33": "Токораспределительный узел · PHEV",
  "15/36": "Токораспределительный узел · салон",
  "15/37": "Токораспределительный узел · 15/37",
  "15/46": "Токораспределительный узел · 15/46",
};

const FUSE_BOX_NAMES_EN: Record<string, string> = {
  "15/31": "Power distribution · engine bay",
  "15/32": "Power distribution · trunk",
  "15/32B": "Power distribution · trunk (B)",
  "15/33": "Power distribution · PHEV",
  "15/36": "Power distribution · cabin",
  "15/37": "Power distribution · 15/37",
  "15/46": "Power distribution · 15/46",
};

function twodDir(): string {
  return join(resourcesRoot(), "TwoDviews");
}

function parseFuseTwodFile(file: string): { code: string; label: string } | null {
  const base = file.replace(/\.(svg|jpg|png|gif)$/i, "");
  const m = base.match(/^(\d+)-(\d+[A-Z]?)(?:\s+|_|$)(.*)$/i);
  if (!m) return null;
  const code = `${m[1]}/${m[2]}`;
  const rest = String(m[3] || "")
    .replace(/_thumb$/i, "")
    .replace(/_/g, " ")
    .trim();
  return { code, label: rest || code };
}

function modelScore(file: string, model: string): number {
  const m = String(model || "").toUpperCase();
  const f = file.toUpperCase();
  if (!m) return /_(S60|V60|XC60|V70|S80|PHEV)/i.test(file) ? 0 : 2;
  if (m.includes("XC60") && f.includes("XC60")) return 20;
  if (m.includes("XC70") && (f.includes("V70") || f.includes("S80") || f.includes("XC70"))) return 18;
  if (m.includes("V70") && (f.includes("V70") || f.includes("S80"))) return 18;
  if (m.includes("S80") && (f.includes("S80") || f.includes("V70"))) return 16;
  if ((m.includes("S60") || m.includes("V60")) && (f.includes("S60") || f.includes("V60"))) return 18;
  if (m.includes("PHEV") && f.includes("PHEV")) return 20;
  if (!/_(S60|V60|XC60|V70|S80|PHEV)/i.test(file)) return 5;
  return 0;
}

const VEHICLE_TOKENS = ["XC60", "XC70", "V70", "S80L", "S80", "S60L", "S60", "V60", "PHEV"] as const;

let componentNameMap: Map<string, { ru: string; en: string }> | null = null;
let fuseReportCache: Partial<Record<"ru" | "en", FuseReportBox[]>> = {};

function stripHtml(raw: string): string {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(s: string): string {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function loadLangDictionaryNames(): Map<string, { ru: string; en: string }> {
  const map = new Map<string, { ru: string; en: string }>();
  const dictPath = join(ewdDataDir(), "langdictionary.xml");
  if (!existsSync(dictPath)) return map;
  try {
    const xml = readFileSync(dictPath, "utf-8");
    const langMatch = xml.match(/<Lang>([\s\S]*?)<\/Lang>/i);
    const langs = langMatch
      ? [...langMatch[1].matchAll(/<D>([^<]*)<\/D>/gi)].map((m) => m[1].trim().toUpperCase())
      : ["EN", "CN", "DE", "ES", "FI", "FR", "IT", "JA", "KO", "NL", "PT", "RU", "SE", "TCN", "TH"];
    const enI = Math.max(0, langs.indexOf("EN"));
    const ruI = langs.includes("RU") ? langs.indexOf("RU") : 11;
    for (const m of xml.matchAll(/<E>([\s\S]*?)<\/E>/gi)) {
      const cells = [...m[1].matchAll(/<D>([\s\S]*?)<\/D>/gi)].map((c) => decodeXmlEntities(c[1]));
      if (cells.length < 2) continue;
      const key = cells[0];
      if (!key) continue;
      const translations = cells.slice(1);
      const en = translations[enI] || translations[0] || "";
      const ru = translations[ruI] || "";
      if (!en && !ru) continue;
      map.set(key, { en: en || ru, ru: ru || en });
    }
  } catch {
    /* optional lexicon */
  }
  return map;
}

function loadComponentNameMap(): Map<string, { ru: string; en: string }> {
  if (componentNameMap) return componentNameMap;
  const map = new Map<string, { ru: string; en: string }>();

  // 1) Official Capital langdictionary (full keys incl. 15/36_R3) — highest priority
  for (const [code, names] of loadLangDictionaryNames()) {
    map.set(code, names);
  }

  // 2) Prebuilt RU index (may miss relay keys; fill gaps only)
  const idxPath = join(EWD_DATA, "lang_ru_index.json");
  if (existsSync(idxPath)) {
    try {
      const idx = JSON.parse(readFileSync(idxPath, "utf-8")) as {
        by_code?: Record<string, { name_ru?: string; name_en?: string }>;
      };
      for (const [code, row] of Object.entries(idx.by_code || {})) {
        if (map.has(code)) continue;
        const ru = String(row.name_ru || "").trim();
        const en = String(row.name_en || "").trim();
        if (ru || en) map.set(code, { ru: ru || en, en: en || ru });
      }
    } catch {
      /* ignore */
    }
  }

  // 3) VIDA lexicon — fill gaps
  const vidaPath = join(ROOT, "data", "vida_components_ru.json");
  if (existsSync(vidaPath)) {
    try {
      const raw = JSON.parse(readFileSync(vidaPath, "utf-8")) as Record<string, unknown>;
      const src = (raw.components && typeof raw.components === "object" ? raw.components : raw) as Record<
        string,
        string
      >;
      for (const [code, name] of Object.entries(src)) {
        if (map.has(code)) continue;
        if (typeof name === "string" && name.trim()) {
          map.set(code, { ru: name.trim(), en: name.trim() });
        }
      }
    } catch {
      /* ignore broken lexicon */
    }
  }

  // 4) wiring.sqlite components — fill gaps only (do not override dictionary)
  try {
    const db = openDatabase(process.env.DATABASE_PATH);
    const rows = db
      .prepare(
        `SELECT component_code AS code, IFNULL(name_ru,'') AS ru, IFNULL(description_en,'') AS en
         FROM components`,
      )
      .all() as Array<{ code: string; ru: string; en: string }>;
    for (const row of rows) {
      if (map.has(row.code)) continue;
      const ru = row.ru.trim();
      const en = row.en.trim();
      if (ru || en) map.set(row.code, { ru: ru || en, en: en || ru });
    }
  } catch {
    /* DB optional for capital package alone */
  }

  componentNameMap = map;
  return map;
}

function resolveComponentName(code: string, lang: "ru" | "en"): string {
  const key = String(code || "").trim();
  if (!key) return "";
  const hit = loadComponentNameMap().get(key);
  if (hit) {
    if (lang === "en") return hit.en || hit.ru || key;
    return hit.ru || hit.en || key;
  }
  const relay = key.match(/^(\d+\/[\w]+)_((?:RA|RB|R)\d+)$/i);
  if (relay) {
    return lang === "en" ? `Relay ${relay[2].toUpperCase()}` : `Реле ${relay[2].toUpperCase()}`;
  }
  return key;
}

function extractVehicleHint(tail: string): string | null {
  const t = String(tail || "").replace(/^[,;\s]+/, "").trim();
  if (!t) return null;
  if (!VEHICLE_TOKENS.some((tok) => t.toUpperCase().includes(tok))) return null;
  return t;
}

function rowMatchesModel(hint: string | null, model: string): boolean {
  if (!hint || !model) return true;
  const m = model.toUpperCase();
  const h = hint.toUpperCase();
  const hinted = VEHICLE_TOKENS.filter((tok) => h.includes(tok));
  if (!hinted.length) return true;
  return hinted.some((tok) => {
    if (m.includes(tok)) return true;
    if (tok === "V70" && (m.includes("XC70") || m.includes("S80"))) return true;
    if (tok === "S80" && (m.includes("XC70") || m.includes("V70"))) return true;
    if (tok === "XC70" && (m.includes("V70") || m.includes("S80"))) return true;
    if (tok === "S60" && m.includes("V60")) return true;
    if (tok === "V60" && m.includes("S60")) return true;
    return false;
  });
}

function parsePlaceholderCell(text: string): { code: string; hint: string | null; extra: string } {
  const raw = stripHtml(text);
  const m = raw.match(/\{([^}]+)\}/);
  const code = m ? m[1].trim() : "";
  const rest = raw.replace(/\{[^}]+\}/, "").trim();
  const hint = extractVehicleHint(rest);
  const extra = hint ? rest : rest.replace(/^[,;\s]+/, "").trim();
  return { code, hint, extra };
}

function parseFuseRows(tableInner: string, lang: "ru" | "en"): FuseRow[] {
  const trs = [...tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const out: FuseRow[] = [];
  let lastId = "";
  let lastAlt = "";
  let lastAmps = "";
  for (let i = 0; i < trs.length; i++) {
    const cells = [...trs[i][1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length < 4) continue;
    if (/\{no\}|\{fusefunction\}|^no$/i.test(cells[0]) || /\{fusefunction\}/i.test(cells[2] || "")) continue;
    let id = cells[0] || "";
    let altId = cells[1] || "";
    let amps = (cells[5] || cells[cells.length - 1] || "").trim();
    if (id === '"' || id === "”" || id === "") id = lastId;
    if (altId === '"' || altId === "”" || altId === "") altId = lastAlt;
    if (amps === '"' || amps === "”" || amps === "") amps = lastAmps;
    if (id) lastId = id;
    if (altId) lastAlt = altId;
    if (amps) lastAmps = amps;
    const nameCell = cells[3] || "";
    const codeCell = cells[2] || "";
    const parsed = parsePlaceholderCell(nameCell);
    let functionCode = parsed.code;
    if (!functionCode) {
      const fromCode = codeCell.match(/(\d+[A-Z]?\/[\w]+)/i);
      functionCode = fromCode ? fromCode[1] : "";
    }
    const via = cells[4] === "-" || cells[4] === "—" ? "" : cells[4] || "";
    let functionName = resolveComponentName(functionCode, lang);
    if (parsed.extra && !parsed.hint) {
      functionName = functionName ? `${functionName} (${parsed.extra})` : parsed.extra;
    }
    if (!functionName) functionName = functionCode || codeCell || "—";
    if (!id && !functionCode) continue;
    if (functionName === "-" && !functionCode) continue;
    out.push({
      id,
      altId,
      functionCode,
      functionName,
      via,
      amps: /^\d+$/.test(amps) ? amps : amps.replace(/[^\d]/g, "") || amps,
      vehicleHint: parsed.hint,
    });
  }
  return out;
}

function parseRelayRows(tableInner: string, lang: "ru" | "en"): RelayRow[] {
  const trs = [...tableInner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const out: RelayRow[] = [];
  for (const tr of trs) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]));
    if (cells.length < 2) continue;
    if (/\{no\}|\{RelayName\}/i.test(cells[0]) || /\{RelayName\}/i.test(cells[1])) continue;
    const id = cells[0] || "";
    if (!id || id === '"' || id === "”") continue;
    const parsed = parsePlaceholderCell(cells[1] || "");
    const nameCode = parsed.code || cells[1] || "";
    let name = resolveComponentName(nameCode, lang);
    if (parsed.extra && !parsed.hint) name = name ? `${name} (${parsed.extra})` : parsed.extra;
    if (!name || name === nameCode) {
      name = lang === "en" ? `Relay ${id}` : `Реле ${id}`;
    }
    out.push({ id, name, nameCode, vehicleHint: parsed.hint });
  }
  return out;
}

function parseFuseReport(lang: "ru" | "en"): FuseReportBox[] {
  if (fuseReportCache[lang]) return fuseReportCache[lang]!;
  const path = join(resourcesRoot(), REPORT_FILES.fuse);
  if (!existsSync(path)) return [];
  const html = readFileSync(path, "utf-8");
  const sections = html.split(/<div class=['"]fusetableheader['"]>/i).slice(1);
  const boxes: FuseReportBox[] = [];
  for (const section of sections) {
    const codeMatch = section.match(/>(\d+\/[\w]+)\s*</);
    const code = codeMatch ? codeMatch[1].trim() : "";
    if (!code) continue;
    const fuseTable = section.match(
      /<table class=['"]reportTableStyle Fuses['"][^>]*>([\s\S]*?)<\/table>/i,
    );
    const relayTable = section.match(
      /<table class=['"]reportTableStyle Relays['"][^>]*>([\s\S]*?)<\/table>/i,
    );
    boxes.push({
      code,
      fuses: fuseTable ? parseFuseRows(fuseTable[1], lang) : [],
      relays: relayTable ? parseRelayRows(relayTable[1], lang) : [],
    });
  }
  fuseReportCache[lang] = boxes;
  return boxes;
}

function filterRowsByModel<T extends { vehicleHint: string | null }>(rows: T[], model: string): T[] {
  if (!model) return rows;
  const matched = rows.filter((r) => rowMatchesModel(r.vehicleHint, model));
  // If filtering wiped a fuse id group entirely, keep unhinted siblings only — already handled.
  // Prefer hinted matches for a given id when both exist.
  const byId = new Map<string, T[]>();
  for (const row of matched) {
    const key = "id" in row ? String((row as { id?: string }).id || "") : "";
    const list = byId.get(key) || [];
    list.push(row);
    byId.set(key, list);
  }
  const out: T[] = [];
  for (const [, list] of byId) {
    const hinted = list.filter((r) => r.vehicleHint);
    const unhinted = list.filter((r) => !r.vehicleHint);
    if (hinted.length) out.push(...hinted, ...unhinted);
    else out.push(...list);
  }
  return out.length ? out : rows.filter((r) => !r.vehicleHint);
}

function listFuseBoxes(model = "", lang: "ru" | "en" = "ru") {
  const dir = twodDir();
  const names = lang === "en" ? FUSE_BOX_NAMES_EN : FUSE_BOX_NAMES_RU;
  const reportBoxes = parseFuseReport(lang);
  const reportByCode = new Map(reportBoxes.map((b) => [b.code, b]));

  const byCode = new Map<
    string,
    Array<{ file: string; label: string; score: number; kind: "svg" | "img" }>
  >();
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => /^15-/i.test(f) && !/_thumb\./i.test(f));
    for (const file of files) {
      const parsed = parseFuseTwodFile(file);
      if (!parsed) continue;
      const score = modelScore(file, model);
      const kind = /\.svg$/i.test(file) ? "svg" : "img";
      const list = byCode.get(parsed.code) || [];
      list.push({ file, label: parsed.label || file, score, kind });
      byCode.set(parsed.code, list);
    }
  }

  const codes = new Set<string>([...byCode.keys(), ...reportByCode.keys()]);
  return [...codes]
    .map((code) => {
      const layouts = byCode.get(code) || [];
      const sorted = layouts
        .slice()
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
      const bestScore = sorted[0]?.score ?? 0;
      const preferred = sorted.filter((l) => l.score === bestScore && l.kind === "svg");
      const use = preferred.length ? preferred : sorted.filter((l) => l.kind === "svg");
      const finalLayouts = (use.length ? use : sorted).slice(0, 8);
      const thumb = `${finalLayouts[0]?.file.replace(/\.svg$/i, "_thumb.jpg") || ""}`;
      const thumbExists = Boolean(thumb && existsSync(join(dir, thumb)));
      const report = reportByCode.get(code);
      const fuses = filterRowsByModel(report?.fuses || [], model);
      const relays = filterRowsByModel(report?.relays || [], model);
      const boxNameFromReport =
        lang === "en"
          ? resolveComponentName(code, "en")
          : resolveComponentName(code, "ru");
      return {
        code,
        name: names[code] || (boxNameFromReport !== code ? boxNameFromReport : code),
        layouts: finalLayouts.map((l) => ({
          file: l.file,
          label: l.label,
          url: `/api/ewd/twod?file=${encodeURIComponent(l.file)}`,
        })),
        thumbUrl: thumbExists ? `/api/ewd/twod?file=${encodeURIComponent(thumb)}` : null,
        hasLocation: Boolean(locIndex?.by_code?.[normalizeCode(code)]?.length),
        fuses,
        relays,
      };
    })
    .filter((b) => b.layouts.length > 0 || b.fuses.length > 0 || b.relays.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

const INTRO_SLUGS: Record<string, RegExp> = {
  intro: /^1\s*-/i,
  publication: /^2\s*-/i,
  guide: /^3\s*-/i,
  abbreviations: /^4\s*-/i,
  faq: /^5\s*-/i,
};

function findIntroFile(slug: string): string | null {
  const dir = introDir();
  if (!existsSync(dir)) return null;
  const re = INTRO_SLUGS[slug] || INTRO_SLUGS.guide;
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  const ru = files.find((f) => re.test(f) && /_RU\.html$/i.test(f));
  if (ru) return join(dir, ru);
  const any = files.find((f) => re.test(f));
  return any ? join(dir, any) : null;
}

function remapStoredPath(stored: string): string | null {
  if (!stored) return null;
  const viaIndex = resolveIndexedPath(stored);
  if (viaIndex) return viaIndex;
  const posix = stored.replace(/\\/g, "/");
  const data = ewdDataDir();
  if (posix.includes("FaceViews/")) {
    const m = posix.match(/\/(UID[^/]+\/FaceViews\/[^/]+\.(?:html|svg))$/i);
    if (m) {
      const cand = join(data, m[1].replace(/\//g, "\\") === m[1] ? m[1] : m[1]);
      const p = join(data, ...m[1].split("/"));
      if (existsSync(p) && safeUnderDataDir(p)) return p;
      void cand;
    }
  }
  if (posix.includes("TwoDviews/")) {
    const base = basename(posix);
    const p = join(data, "Resources", "TwoDviews", base);
    if (existsSync(p)) return p;
  }
  const direct = resolve(posix);
  if (existsSync(direct) && safeUnderDataDir(direct)) return direct;
  return null;
}

export function createEwdCapitalRouter() {
  const router = Router();

  router.get("/faceview", (req, res) => {
    ensure();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    const systemUid = String(req.query.systemUid || "").trim();
    const faces = faceIndex?.by_code?.[code] || [];
    if (!faces.length) {
      res.json({ code, count: 0, faces: [], pins: [] });
      return;
    }
    let picked = faces[0];
    if (systemUid) {
      picked = faces.find((f) => f.designUid === systemUid || f.objectUid === systemUid) || picked;
    }
    const htmlPath = remapStoredPath(String(picked.html || ""));
    const svgPath = remapStoredPath(String(picked.svg || ""));
    const pinKey = String(req.query.pin || "").trim().toUpperCase();
    let pins =
      faceIndex?.by_key?.[`${code}|${pinKey}`] ||
      Object.entries(faceIndex?.by_key || {})
        .filter(([k]) => k.startsWith(`${code}|`) && k.split("|").length === 2)
        .flatMap(([, v]) => v);
    if (systemUid) {
      const scoped = pins.filter((p) => String(p.systemUid || p.designUid || "") === systemUid);
      if (scoped.length) pins = scoped;
    }
    let html = "";
    if (htmlPath && existsSync(htmlPath)) {
      html = readFileSync(htmlPath, "utf-8");
    }
    res.json({
      code,
      objectUid: picked.objectUid,
      designUid: picked.designUid,
      htmlPath: htmlPath || null,
      svgPath: svgPath || null,
      svgAvailable: Boolean(svgPath),
      html,
      pins: pins.slice(0, 120),
      faces: faces.map((f) => ({
        objectUid: f.objectUid,
        designUid: f.designUid,
        pinCount: f.pinCount,
        hasHtml: Boolean(remapStoredPath(String(f.html || ""))),
      })),
      count: faces.length,
    });
  });

  router.get("/location", (req, res) => {
    ensure();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required" });
      return;
    }
    const views = locIndex?.by_code?.[code] || [];
    const primary = views[0];
    const svgPath = primary ? remapStoredPath(String(primary.svg || "")) : null;
    let svg = "";
    if (svgPath && existsSync(svgPath)) {
      svg = readFileSync(svgPath, "utf-8");
    }
    res.json({
      code,
      count: views.length,
      svgPath: svgPath || null,
      svgAvailable: Boolean(svgPath),
      svg,
      systems: primary?.systems || [],
      views: views.slice(0, 12).map((v) => ({
        svg: remapStoredPath(String(v.svg || "")),
        svgRel: v.svgRel,
        type: v.type,
        systemCount: (v.systems || []).length,
      })),
    });
  });

  router.get("/fuses", (req, res) => {
    ensure();
    const model = String(req.query.model || "").trim();
    const lang = String(req.query.lang || "ru").toLowerCase() === "en" ? "en" : "ru";
    const boxFilter = String(req.query.box || "").trim();
    let boxes = listFuseBoxes(model, lang);
    if (boxFilter) {
      boxes = boxes.filter((b) => b.code.toLowerCase() === boxFilter.toLowerCase());
    }
    res.json({
      count: boxes.length,
      model: model || null,
      boxes,
      tableReport: existsSync(join(resourcesRoot(), REPORT_FILES.fuse)),
    });
  });

  router.get("/twod", (req, res) => {
    const file = basename(String(req.query.file || "").replace(/\\/g, "/"));
    if (!file || !/^[\w .&()-]+\.(svg|jpg|jpeg|png|gif)$/i.test(file)) {
      res.status(400).type("text").send("file required");
      return;
    }
    const path = join(twodDir(), file);
    if (!existsSync(path) || !safeUnderDataDir(path)) {
      res.status(404).type("text").send("not found");
      return;
    }
    const lower = file.toLowerCase();
    const type = lower.endsWith(".svg")
      ? "image/svg+xml; charset=utf-8"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    res.send(readFileSync(path));
  });

  router.get("/report/:kind", (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    const file = REPORT_FILES[kind];
    if (!file) {
      res.status(400).type("text").send("kind must be fuse|inline|splice|grounds");
      return;
    }
    const path =
      kind === "grounds"
        ? join(ewdDataDir(), "Harness", "Grounds.html")
        : join(resourcesRoot(), file);
    if (!existsSync(path) || !safeUnderDataDir(path)) {
      res.status(404).type("text").send("Report not found");
      return;
    }
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(readFileSync(path, "utf-8"));
  });

  router.get("/intro/:slug", (req, res) => {
    const slug = String(req.params.slug || "guide").toLowerCase();
    const path = findIntroFile(slug);
    if (!path || !existsSync(path)) {
      res.status(404).type("text").send("Intro page not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(readFileSync(path, "utf-8"));
  });

  router.get("/intro", (_req, res) => {
    const dir = introDir();
    if (!existsSync(dir)) {
      res.json({ pages: [] });
      return;
    }
    const pages = readdirSync(dir)
      .filter((f) => /_RU\.html$/i.test(f))
      .map((f) => {
        let slug = "guide";
        if (f.startsWith("1")) slug = "intro";
        else if (f.startsWith("2")) slug = "publication";
        else if (f.startsWith("3")) slug = "guide";
        else if (f.startsWith("4")) slug = "abbreviations";
        else if (f.startsWith("5")) slug = "faq";
        return { slug, file: f, title: f.replace(/_RU\.html$/i, "") };
      });
    res.json({ pages });
  });

  return router;
}

/** Lookup FaceView edges for highlight (shared with ewd.ts). */
export function lookupFacePins(
  code: string,
  pin: string,
  systemUid?: string,
): Array<Record<string, unknown>> {
  ensure();
  const pinKey = String(pin || "")
    .trim()
    .toUpperCase();
  if (!code || !pinKey || !faceIndex?.by_key) return [];
  let rows = faceIndex.by_key[`${code}|${pinKey}`] || [];
  if (systemUid) {
    const scoped = rows.filter(
      (r) => String(r.systemUid || r.designUid || "") === systemUid,
    );
    if (scoped.length) rows = scoped;
  }
  return rows;
}
