import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { ewdDataDir, resolveIndexedPath, safeUnderDataDir } from "../ewdPaths.js";
import { filterDesignUidsByZone, loadEwdSystemCatalog } from "../zoneContext.js";
import { evaluateOptionExpression } from "../optionExpression.js";

type DeviceIndex = {
  data_dir?: string;
  by_code?: Record<
    string,
    {
      code: string;
      objectIds: string[];
      systemUids: string[];
      diagramUids: string[];
      kinds: string[];
    }
  >;
};

type SvgDescIndex = {
  data_dir?: string;
  diagrams?: Record<
    string,
    {
      svg: string;
      diagramUid: string;
      designFolder: string;
      pathCount: number;
      textCodes: string[];
      groups?: Array<{ schemClass: string; uids: string[]; pathCount: number }>;
    }
  >;
  codeToDiagramUids?: Record<string, string[]>;
};

type ConnectivityIndex = {
  data_dir?: string;
  codeToConnectivityFiles?: Record<string, string[]>;
  codeToSystemFiles?: Record<string, Record<string, string[]>>;
  summaries?: Array<{ source?: string; deviceCodeCount?: number; deviceCodes?: string[] }>;
};

type PinWireEdge = {
  code?: string;
  ppin?: string;
  pin?: string;
  pinUid?: string;
  wireUid?: string;
  sharedObjectUID?: string;
  peerCode?: string;
  peerPin?: string;
  peerUid?: string;
  color?: string;
  gauge?: string;
  harness?: string;
  wireName?: string;
  optionExpression?: string;
  systemUid?: string;
  diagramUids?: string[];
  source?: string;
};

type PinWireIndex = {
  by_key?: Record<string, PinWireEdge[]>;
  by_code_pin?: Record<string, PinWireEdge[]>;
};

type GlobalSignalIndex = {
  by_uid?: Record<
    string,
    { uid: string; signalFile?: string; siblings?: string[]; diagramUids?: string[] }
  >;
};

type EwdEndpoint = {
  from: string;
  to: string;
  color: string;
  wireName: string;
  pinFrom?: string;
  pinTo?: string;
  fromUid?: string;
  toUid?: string;
  fromDesignUid?: string;
  toDesignUid?: string;
  wireUid?: string;
  sharedObjectUID?: string;
  optionExpression?: string;
  harness?: string;
  gauge?: string;
};

type PinRec = {
  device: string;
  pin: string;
  pn: string;
  ppin: string;
  connected: string;
  sourceObjectUID: string;
  sourceDesignUID: string;
};

const ROOT = resolve(process.cwd());
const EWD_DATA = resolve(process.env.EWD_DATA_DIR || process.env.EWD_DIR || join(ROOT, "data", "ewd"));

let deviceIndex: DeviceIndex | null = null;
let svgIndex: SvgDescIndex | null = null;
let connectivityIndex: ConnectivityIndex | null = null;
let pinWireIndex: PinWireIndex | null = null;
let globalSignalIndex: GlobalSignalIndex | null = null;
/** connectivity*.zip → distinct device code count (for ranking multi-device files first) */
let fileDeviceCodeCount: Map<string, number> | null = null;

function loadJson<T>(name: string): T | null {
  const path = join(EWD_DATA, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function ensureIndexes() {
  if (!deviceIndex) deviceIndex = loadJson<DeviceIndex>("device_index.json");
  if (!svgIndex) svgIndex = loadJson<SvgDescIndex>("svg_desc_index.json");
  if (!connectivityIndex) connectivityIndex = loadJson<ConnectivityIndex>("connectivity_index.json");
  if (!pinWireIndex) pinWireIndex = loadJson<PinWireIndex>("pin_wire_index.json");
  if (!globalSignalIndex) globalSignalIndex = loadJson<GlobalSignalIndex>("global_signal_index.json");
  if (!fileDeviceCodeCount && connectivityIndex?.summaries?.length) {
    fileDeviceCodeCount = new Map();
    for (const s of connectivityIndex.summaries) {
      const src = String(s.source || "").trim();
      if (src) fileDeviceCodeCount.set(src, Number(s.deviceCodeCount) || 0);
    }
  }
}

function parseOptionTokens(raw: unknown): string[] {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 64);
}

function normPinKey(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = /(?:^|[-;:/])([0-9A-Z]{1,4})$/i.exec(s);
  return (m?.[1] || s).toUpperCase();
}

function rankConnectivityFiles(files: string[]): string[] {
  const counts = fileDeviceCodeCount;
  if (!counts?.size) return files;
  return [...files].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
}

function isTautologyEndpoint(ep: EwdEndpoint): boolean {
  const a = normalizeCode(ep.from);
  const b = normalizeCode(ep.to);
  if (!a || !b || a !== b) return false;
  const pf = String(ep.pinFrom || "").trim();
  const pt = String(ep.pinTo || "").trim();
  // Same code + same (or missing) pin = cavity echo. Different pins on same code can be valid.
  if (!pf && !pt) return true;
  return Boolean(pf && pt && pf === pt);
}

function dataDir(): string {
  ensureIndexes();
  return ewdDataDir();
}

function normalizeCode(raw: string): string {
  const m = String(raw || "")
    .trim()
    .match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(raw || "").trim();
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  return re.exec(tag)?.[1] ?? "";
}

function formatEndpoint(pin: PinRec | undefined, fallback: string): string {
  if (!pin) return fallback;
  const label = pin.ppin || pin.pin;
  const pn = pin.pn ? ` (${pin.pn})` : "";
  return `${pin.device}${label ? `:${label}` : ""}${pn}`;
}

function normalizeWireColor(c: string): string {
  return String(c || "")
    .toUpperCase()
    .replace(/\//g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function labelMatchesPin(label: string | undefined, want: string): boolean {
  if (!label || !want) return false;
  const w = String(want).trim();
  const p = String(label).trim();
  if (p === w) return true;
  if (p.endsWith(`-${w}`) || p.endsWith(`;${w}`) || p.endsWith(`/${w}`)) return true;
  return new RegExp(`(?:^|\\D)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\D|$)`).test(p);
}

function pinMatches(pin: PinRec | undefined, want: string): boolean {
  if (!pin || !want) return false;
  return [pin.ppin, pin.pin, pin.pn].some((p) => labelMatchesPin(p, want));
}

function parseConnectivityXml(xml: string): EwdEndpoint[] {
  const pinById = new Map<string, PinRec>();
  const ownerBlocks =
    xml.match(/<(?:device|connector)\b[\s\S]*?<\/(?:device|connector)>/gi) || [];
  for (const block of ownerBlocks) {
    const open = block.match(/<(?:device|connector)\b[^>]*>/i)?.[0] || "";
    const deviceName = attr(open, "name");
    const ownerDesignUid =
      /name="sourceDesignUID"[^>]*val="(UID[^"]+)"/i.exec(block)?.[1] || "";
    const shortDesc = (
      /name="ServiceDescription"[^>]*val="([^"]*)"/i.exec(block)?.[1]
      || attr(open, "shortdescription")
      || ""
    ).trim();
    const shortUseful =
      shortDesc &&
      !/^\{?[\d]+\/[\d]+\}?$/i.test(shortDesc) &&
      shortDesc.toUpperCase() !== deviceName.toUpperCase();
    const displayName = shortUseful ? `${deviceName} — ${shortDesc}` : deviceName;
    const pinChunks = block.split(/<pin\b/i).slice(1);
    for (const chunk of pinChunks) {
      const head = "<pin " + (chunk.match(/^[^>]*>/)?.[0] || ">");
      const id = attr(head, "id");
      if (!id) continue;
      const pinName = attr(head, "name");
      const connected = attr(head, "connectedpin");
      const pn = /name="PN"[^>]*val="([^"]*)"/i.exec(chunk)?.[1] || "";
      const ppin = /name="PPIN"[^>]*val="([^"]*)"/i.exec(chunk)?.[1] || "";
      const sourceObjectUID =
        /name="sourceObjectUID"[^>]*val="(UID[^"]+)"/i.exec(chunk)?.[1] || "";
      pinById.set(id, {
        device: displayName,
        pin: pinName,
        pn,
        ppin,
        connected,
        sourceObjectUID,
        sourceDesignUID: ownerDesignUid,
      });
    }
  }

  const endpoints: EwdEndpoint[] = [];
  const seen = new Map<string, number>();
  const push = (ep: EwdEndpoint) => {
    const fromCode = normalizeCode(ep.from) || ep.from;
    const toCode = normalizeCode(ep.to) || ep.to;
    const key = `${ep.wireName}|${fromCode}:${ep.pinFrom || ""}|${toCode}:${ep.pinTo || ""}|${ep.color}`;
    const score = ep.from.length + ep.to.length + (ep.color ? 10 : 0) + (ep.wireName ? 5 : 0);
    const prev = seen.get(key);
    if (prev !== undefined) {
      if (score <= prev) return;
      const idx = endpoints.findIndex(
        (e) =>
          `${e.wireName}|${normalizeCode(e.from) || e.from}:${e.pinFrom || ""}|${normalizeCode(e.to) || e.to}:${e.pinTo || ""}|${e.color}` ===
          key,
      );
      if (idx >= 0) endpoints.splice(idx, 1);
    }
    seen.set(key, score);
    endpoints.push(ep);
  };

  const wireBlocks = xml.match(/<wire\b[\s\S]*?<\/wire>/gi) || [];
  for (const block of wireBlocks) {
    const open = block.match(/<wire\b[^>]*>/i)?.[0] || "";
    const wireName = attr(open, "name");
    const color = (attr(open, "wirecolor") || attr(open, "colordesc") || "").replace(/\//g, "-");
    const shortDesc = attr(open, "shortdescription");
    const harness = attr(open, "harness");
    const gauge = attr(open, "wirecsa");
    const optionExpression =
      attr(open, "optionExpression") ||
      attr(open, "optionexpression") ||
      /name="optionExpression"[^>]*val="([^"]*)"/i.exec(block)?.[1] ||
      "";
    const wireUid =
      /name="sourceObjectUID"[^>]*val="(UID[^"]+)"/i.exec(block)?.[1] || "";
    const sharedObjectUID =
      /name="sharedObjectUID"[^>]*val="(UID[^"]+)"/i.exec(block)?.[1] || "";
    const pinrefs = [...block.matchAll(/<connection\b[^>]*pinref="([^"]+)"/gi)].map((m) => m[1]);
    const start = attr(open, "startpinref");
    const uniq = [...new Set([...(start ? [start] : []), ...pinrefs].filter(Boolean))];
    if (uniq.length < 2) {
      const a = start ? pinById.get(start) : undefined;
      if (a?.connected) uniq.push(a.connected);
    }
    const a = uniq[0] ? pinById.get(uniq[0]) : undefined;
    const b = uniq[1] ? pinById.get(uniq[1]) : undefined;
    if (!a && !b) continue;
    const from = a
      ? formatEndpoint(a, uniq[0])
      : shortDesc || (attr(open, "isport") === "true" ? `порт ${wireName}` : uniq[0] || "—");
    const to = b
      ? formatEndpoint(b, uniq[1] || "")
      : shortDesc || (attr(open, "isport") === "true" ? `порт ${wireName}` : uniq[1] || "—");
    const ep: EwdEndpoint = {
      from,
      to,
      color,
      wireName,
      pinFrom: a?.ppin || a?.pin,
      pinTo: b?.ppin || b?.pin,
      fromUid: a?.sourceObjectUID || "",
      toUid: b?.sourceObjectUID || "",
      fromDesignUid: a?.sourceDesignUID || "",
      toDesignUid: b?.sourceDesignUID || "",
      wireUid,
      sharedObjectUID,
      optionExpression,
      harness,
      gauge,
    };
    if (isTautologyEndpoint(ep)) continue;
    push(ep);
  }
  return endpoints;
}

function edgeToEndpoint(edge: PinWireEdge): EwdEndpoint {
  const from = `${edge.code || ""}${edge.ppin || edge.pin ? `:${edge.ppin || edge.pin}` : ""}`;
  const to = edge.peerCode
    ? `${edge.peerCode}${edge.peerPin ? `:${edge.peerPin}` : ""}`
    : "—";
  return {
    from,
    to,
    color: String(edge.color || "").replace(/\//g, "-"),
    wireName: edge.wireName || "",
    pinFrom: edge.ppin || edge.pin,
    pinTo: edge.peerPin,
    fromUid: edge.pinUid || "",
    toUid: edge.peerUid || "",
    fromDesignUid: edge.systemUid || "",
    toDesignUid: edge.systemUid || "",
    wireUid: edge.wireUid || "",
    sharedObjectUID: edge.sharedObjectUID || "",
    optionExpression: edge.optionExpression || "",
    harness: edge.harness || "",
    gauge: edge.gauge || "",
  };
}

/** Prefer prebuilt pin_wire_index; fall back to live connectivity parse. */
function lookupPinWireEdges(
  code: string,
  pin: string,
  opts: ScopeOpts & { optionTokens?: string[] } = {},
): PinWireEdge[] {
  ensureIndexes();
  const pinKey = normPinKey(pin);
  if (!pinKey || !pinWireIndex) return [];
  const systems = allowedSystemUids(code, opts);
  const soft = pinWireIndex.by_code_pin?.[`${code}|${pinKey}`] || [];
  let rows = soft;
  if (systems.length) {
    const scoped: PinWireEdge[] = [];
    for (const sdu of systems) {
      for (const e of pinWireIndex.by_key?.[`${code}|${pinKey}|${sdu}`] || []) scoped.push(e);
    }
    if (scoped.length) rows = scoped;
    else rows = soft.filter((e) => !e.systemUid || systems.includes(e.systemUid));
  }
  const diagramUid = String(opts.diagramUid || "").trim();
  if (diagramUid) {
    rows = rows.filter(
      (e) =>
        !e.diagramUids?.length ||
        e.diagramUids.includes(diagramUid) ||
        e.systemUid === svgIndex?.diagrams?.[diagramUid]?.designFolder,
    );
  }
  const tokens = opts.optionTokens || [];
  if (tokens.length) {
    rows = rows.filter((e) => evaluateOptionExpression(e.optionExpression, tokens));
  }
  return rows;
}

type ScopeOpts = { diagramUid?: string; zone?: string; systemUids?: string[] };

/** Connectivity zip names that mention a given design UID for any code. */
function filesTouchingDesign(designUid: string): Set<string> {
  const out = new Set<string>();
  const map = connectivityIndex?.codeToSystemFiles || {};
  for (const sysMap of Object.values(map)) {
    for (const f of sysMap[designUid] || []) out.add(f);
  }
  return out;
}

/**
 * Resolve allowed EWD design UIDs for a code under optional diagram/zone scope.
 * Never returns "all systems for code" when diagramUid or zone is set and no match exists.
 */
function allowedSystemUids(code: string, opts: ScopeOpts = {}): string[] {
  const rec = deviceIndex?.by_code?.[code];
  if (!rec) return [];
  let systems = [...(rec.systemUids || [])];
  const zone = String(opts.zone || "").trim();
  const diagramUid = String(opts.diagramUid || "").trim();

  if (zone && zone !== "all") {
    const zoned = filterDesignUidsByZone(systems, zone, dataDir());
    // Also keep systems whose catalog zone matches even if not in device list intersection
    if (zoned.length) systems = zoned;
    else {
      // Code may live on a sibling design in the same netlist sheet — keep systems that
      // share connectivity files with zone-matched designs on this code's file list.
      const cat = loadEwdSystemCatalog(dataDir());
      const zoneDesigns = [...cat.values()].filter((r) => r.zone === zone).map((r) => r.designUid);
      const zoneFiles = new Set<string>();
      for (const d of zoneDesigns) {
        for (const f of filesTouchingDesign(d)) zoneFiles.add(f);
      }
      const bySys = connectivityIndex?.codeToSystemFiles?.[code] || {};
      systems = systems.filter((sdu) => (bySys[sdu] || []).some((f) => zoneFiles.has(f)));
    }
  }

  if (diagramUid) {
    const design = svgIndex?.diagrams?.[diagramUid]?.designFolder;
    if (design) {
      if (systems.includes(design)) return [design];
      const designFiles = filesTouchingDesign(design);
      const bySys = connectivityIndex?.codeToSystemFiles?.[code] || {};
      const pool = systems.length ? systems : [...(rec.systemUids || [])];
      const matched = pool.filter((sdu) => (bySys[sdu] || []).some((f) => designFiles.has(f)));
      if (matched.length) return matched;
      // Diagram selected but no overlapping system for this code → empty (no cross-system leak)
      return [];
    }
  }

  // Explicit systemUids from caller
  if (opts.systemUids?.length) {
    const allow = new Set(opts.systemUids);
    return systems.filter((s) => allow.has(s));
  }

  return systems;
}

function filesForCode(
  code: string,
  systemUids: string[],
  diagramUid?: string,
  zone?: string,
): string[] {
  const bySys = connectivityIndex?.codeToSystemFiles?.[code];
  let out: string[] = [];
  if (systemUids.length && bySys) {
    for (const sdu of systemUids) {
      for (const f of bySys[sdu] || []) out.push(f);
    }
    out = [...new Set(out)];
  }
  // Do NOT fall back to unscoped codeToConnectivityFiles when a scope was requested
  if (!out.length) {
    if (systemUids.length) return [];
    out = [...(connectivityIndex?.codeToConnectivityFiles?.[code] || [])];
  }
  if (diagramUid) {
    const design = svgIndex?.diagrams?.[diagramUid]?.designFolder;
    if (design) {
      const designFiles = filesTouchingDesign(design);
      const narrowed = out.filter((f) => designFiles.has(f));
      if (narrowed.length) out = narrowed;
      else if (systemUids.length) return [];
    }
  }
  const z = String(zone || "").trim();
  if (z && z !== "all") {
    const cat = loadEwdSystemCatalog(dataDir());
    const zoneFiles = new Set<string>();
    for (const rec of cat.values()) {
      if (rec.zone === z) {
        for (const f of filesTouchingDesign(rec.designUid)) zoneFiles.add(f);
      }
    }
    if (zoneFiles.size) {
      const narrowed = out.filter((f) => zoneFiles.has(f));
      if (narrowed.length) out = narrowed;
      else return [];
    }
  }
  // Prefer multi-device netlists over single-device cavity files
  return rankConnectivityFiles(out);
}

function endpointOnAllowedSystem(ep: EwdEndpoint, code: string, systemUids: Set<string>): boolean {
  // Empty allow-set means scope rejected everything — drop all endpoints
  if (!systemUids.size) return false;
  const fromIsCode = normalizeCode(ep.from).startsWith(code);
  const toIsCode = normalizeCode(ep.to).startsWith(code);
  if (fromIsCode && ep.fromDesignUid && systemUids.has(ep.fromDesignUid)) return true;
  if (toIsCode && ep.toDesignUid && systemUids.has(ep.toDesignUid)) return true;
  if (fromIsCode || toIsCode) {
    const design = fromIsCode ? ep.fromDesignUid : ep.toDesignUid;
    if (design && !systemUids.has(design)) return false;
  }
  // Ambiguous peers without design UID are only kept if both ends lack design (rare)
  return !ep.fromDesignUid && !ep.toDesignUid;
}

function collectEndpointsForCode(
  code: string,
  opts: ScopeOpts & { limit?: number; optionTokens?: string[] } = {},
): EwdEndpoint[] {
  const limit = opts.limit ?? 20;
  const systems = opts.systemUids?.length
    ? opts.systemUids
    : allowedSystemUids(code, opts);
  const systemSet = new Set(systems);
  // No systems under active scope → return nothing (never unscoped dump)
  if (!systems.length && (opts.diagramUid || (opts.zone && opts.zone !== "all"))) {
    return [];
  }
  const files = filesForCode(code, systems, opts.diagramUid, opts.zone).slice(0, limit);
  const primary: EwdEndpoint[] = [];
  const seen = new Set<string>();
  const tokens = opts.optionTokens || [];
  for (const file of files) {
    const xml = readConnectivityFile(file);
    if (!xml) continue;
    for (const ep of parseConnectivityXml(xml)) {
      const involvesCode =
        ep.from.includes(code) ||
        ep.to.includes(code) ||
        normalizeCode(ep.from).startsWith(code) ||
        normalizeCode(ep.to).startsWith(code);
      if (!involvesCode) continue;
      if (!endpointOnAllowedSystem(ep, code, systemSet)) continue;
      if (tokens.length && !evaluateOptionExpression(ep.optionExpression, tokens)) continue;
      const key = `${ep.wireName}|${ep.from}|${ep.to}|${ep.color}|${ep.wireUid || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      primary.push(ep);
      if (primary.length >= 80) break;
    }
    if (primary.length >= 80) break;
  }
  return primary.slice(0, 80);
}

type HighlightResolve = {
  uids: string[];
  pinUids: string[];
  wireUids: string[];
  matched: EwdEndpoint[];
  source: string;
};

function resolveHighlightUids(opts: {
  code: string;
  pin: string;
  color: string;
  peer: string;
  diagramUid: string;
  zone?: string;
  optionTokens?: string[];
}): HighlightResolve {
  const { code, pin, color, peer, diagramUid, zone, optionTokens = [] } = opts;
  const wantColor = normalizeWireColor(color);

  // 1) Prefer O(1) pin_wire_index when pin is known
  let matched: EwdEndpoint[] = [];
  let source = "connectivity";
  if (pin && pinWireIndex?.by_code_pin) {
    const edges = lookupPinWireEdges(code, pin, {
      diagramUid,
      zone,
      optionTokens,
    }).filter((e) => {
      const colorOk =
        !wantColor || !e.color || normalizeWireColor(String(e.color)) === wantColor;
      const peerOk =
        !peer ||
        normalizeCode(e.peerCode || "") === peer ||
        String(e.peerCode || "").includes(peer);
      return colorOk && peerOk;
    });
    if (edges.length) {
      matched = edges.map(edgeToEndpoint);
      source = "pin_wire_index";
    }
  }
  if (!matched.length) {
    const endpoints = collectEndpointsForCode(code, {
      diagramUid,
      zone,
      limit: 24,
      optionTokens,
    });
    matched = endpoints.filter((ep) => {
      const colorOk =
        !wantColor || !ep.color || normalizeWireColor(ep.color) === wantColor;
      const pinOnFrom = labelMatchesPin(ep.pinFrom, pin);
      const pinOnTo = labelMatchesPin(ep.pinTo, pin);
      const pinOnSelected =
        (normalizeCode(ep.from).startsWith(code) && pinOnFrom) ||
        (normalizeCode(ep.to).startsWith(code) && pinOnTo);
      const pinOnCode = !pin || pinOnSelected || pinOnFrom || pinOnTo;
      const peerOk =
        !peer ||
        ep.from.includes(peer) ||
        ep.to.includes(peer) ||
        normalizeCode(ep.from).startsWith(peer) ||
        normalizeCode(ep.to).startsWith(peer);
      return colorOk && pinOnCode && peerOk;
    });
  }

  const pinUids = new Set<string>();
  const wireUids = new Set<string>();
  for (const ep of matched) {
    const pinOnFrom = labelMatchesPin(ep.pinFrom, pin);
    const pinOnTo = labelMatchesPin(ep.pinTo, pin);
    const fromIsCode = normalizeCode(ep.from).startsWith(code);
    const toIsCode = normalizeCode(ep.to).startsWith(code);
    if (pin) {
      if (pinOnFrom && ep.fromUid) pinUids.add(ep.fromUid);
      if (pinOnTo && ep.toUid) pinUids.add(ep.toUid);
      if (!pinUids.size) {
        if (fromIsCode && ep.fromUid) pinUids.add(ep.fromUid);
        if (toIsCode && ep.toUid) pinUids.add(ep.toUid);
      }
      // Keep opposite end for dual-pin geometry
      if (ep.fromUid) pinUids.add(ep.fromUid);
      if (ep.toUid) pinUids.add(ep.toUid);
    } else {
      if (ep.fromUid) pinUids.add(ep.fromUid);
      if (ep.toUid) pinUids.add(ep.toUid);
    }
    if (ep.wireUid) wireUids.add(ep.wireUid);
    if (ep.sharedObjectUID) wireUids.add(ep.sharedObjectUID);
  }

  const rec = diagramUid ? svgIndex?.diagrams?.[diagramUid] : undefined;
  const groups = rec?.groups || [];
  const sheetUids = new Set(groups.flatMap((g) => g.uids || []));
  const wireOnSheet = [...wireUids].filter((u) => sheetUids.has(u));
  const pinOnSheet = [...pinUids].filter((u) => sheetUids.has(u));

  /** Exact conductor UID first (VIDA-style); expand CAFConductor only for those UIDs. */
  const expandExact = (seed: string[], preferClass: string) => {
    const seedSet = new Set(seed);
    const out = new Set<string>();
    for (const g of groups) {
      if (preferClass && g.schemClass !== preferClass) continue;
      if ((g.uids || []).some((u) => seedSet.has(u))) {
        for (const u of g.uids || []) {
          if (seedSet.has(u) || preferClass === "CAFConductor") out.add(u);
        }
      }
    }
    return [...out];
  };

  let uids: string[] = [];
  if (wireOnSheet.length) {
    uids = expandExact(wireOnSheet, "CAFConductor");
    if (!uids.length) uids = wireOnSheet;
    source = source === "pin_wire_index" ? "pin_wire_wire" : "wire-uid";
  } else if (pinOnSheet.length) {
    uids = expandExact(pinOnSheet, "CAFConductor");
    if (!uids.length) uids = expandExact(pinOnSheet, "CAFPinList");
    if (!uids.length) uids = pinOnSheet;
    source = source === "pin_wire_index" ? "pin_wire_pin" : "pin-uid";
  } else if (matched.length) {
    uids = [...wireUids, ...pinUids].filter(Boolean);
    source = "connectivity-uid";
  } else if (diagramUid) {
    const deviceIds = deviceIndex?.by_code?.[code]?.objectIds || [];
    uids = deviceIds.filter((u) => sheetUids.has(u));
    source = "device-object";
  }

  const nonGround = matched.filter(
    (ep) => !/^31\//.test(normalizeCode(ep.from)) && !/^31\//.test(normalizeCode(ep.to)),
  );
  const matchedOut = (nonGround.length ? nonGround : matched).slice(0, 8);
  return {
    uids: uids.slice(0, 24),
    pinUids: [...pinUids].filter(Boolean).slice(0, 16),
    wireUids: [...wireUids].filter(Boolean).slice(0, 16),
    matched: matchedOut,
    source,
  };
}

/** Score how many net UIDs land on a diagram sheet (owner of the net). */
function scoreDiagramNetOwnership(
  diagramUid: string,
  pinUids: string[],
  wireUids: string[],
): { onSheet: number; wireHits: number; pinHits: number } {
  const rec = svgIndex?.diagrams?.[diagramUid];
  const sheetUids = new Set((rec?.groups || []).flatMap((g) => g.uids || []));
  let wireHits = 0;
  let pinHits = 0;
  for (const u of wireUids) if (sheetUids.has(u)) wireHits++;
  for (const u of pinUids) if (sheetUids.has(u)) pinHits++;
  return { onSheet: wireHits + pinHits, wireHits, pinHits };
}

function readConnectivityFile(fileName: string): string | null {
  const path = join(dataDir(), "Signals", fileName);
  if (!existsSync(path) || !safeUnderDataDir(path)) return null;
  const buf = readFileSync(path);
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      return gunzipSync(buf).toString("utf-8");
    }
    return buf.toString("utf-8");
  } catch {
    return null;
  }
}

export function createEwdRouter() {
  const router = Router();

  router.get("/diagrams", (req, res) => {
    ensureIndexes();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required", diagrams: [] });
      return;
    }
    const zone = String(req.query.zone || "").trim();
    const allowedSystems = new Set(allowedSystemUids(code, { zone: zone || undefined }));
    const fromDevice = deviceIndex?.by_code?.[code]?.diagramUids || [];
    const fromSvg = svgIndex?.codeToDiagramUids?.[code] || [];
    const codeObjectIds = new Set(deviceIndex?.by_code?.[code]?.objectIds || []);
    const uids = [...new Set([...fromDevice, ...fromSvg])];
    const cat = loadEwdSystemCatalog(dataDir());
    const diagrams = uids
      .map((diagramUid) => {
        const rec = svgIndex?.diagrams?.[diagramUid];
        if (!rec) return null;
        if (zone && zone !== "all") {
          const design = rec.designFolder;
          const sysRec = cat.get(design);
          if (sysRec?.zone && sysRec.zone !== zone) {
            const designFiles = filesTouchingDesign(design);
            const overlapsAllowed = [...allowedSystems].some((s) =>
              (connectivityIndex?.codeToSystemFiles?.[code]?.[s] || []).some((f) => designFiles.has(f)),
            );
            if (!overlapsAllowed) return null;
          } else if (allowedSystems.size && !allowedSystems.has(design)) {
            const designFiles = filesTouchingDesign(design);
            const overlapsAllowed = [...allowedSystems].some((s) =>
              (connectivityIndex?.codeToSystemFiles?.[code]?.[s] || []).some((f) => designFiles.has(f)),
            );
            if (!overlapsAllowed && sysRec?.zone !== zone) return null;
          }
        }
        const title =
          rec.textCodes?.includes(code) || rec.textCodes?.some((t) => normalizeCode(t) === code)
            ? `${code} · ${rec.designFolder.slice(0, 24)}`
            : rec.designFolder || diagramUid;
        const allGroups = rec.groups || [];
        const relevant = allGroups.filter((g) => (g.uids || []).some((u) => codeObjectIds.has(u)));
        const groups = (relevant.length ? relevant : allGroups).slice(0, 200);
        // Only expose diagrams whose SVG file actually exists on disk
        if (!resolveIndexedPath(rec.svg)) return null;
        const sysRec = cat.get(rec.designFolder);
        return {
          diagramUid,
          title: sysRec?.name ||
            (rec.textCodes?.length
              ? `${rec.textCodes.slice(0, 3).join(", ")}${rec.textCodes.length > 3 ? "…" : ""}`
              : title),
          designFolder: rec.designFolder,
          systemName: sysRec?.name || "",
          textCodes: rec.textCodes || [],
          pathCount: rec.pathCount || 0,
          groups,
          svgAvailable: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aHit = a!.textCodes.some((t) => normalizeCode(t) === code) ? 0 : 1;
        const bHit = b!.textCodes.some((t) => normalizeCode(t) === code) ? 0 : 1;
        return aHit - bHit || (b!.pathCount || 0) - (a!.pathCount || 0);
      });

    res.json({
      code,
      zone: zone || "all",
      systemUids: [...allowedSystems],
      count: diagrams.length,
      diagrams,
      objectIds: deviceIndex?.by_code?.[code]?.objectIds || [],
    });
  });

  router.get("/svg", (req, res) => {
    ensureIndexes();
    const diagramUid = String(req.query.diagramUid || "").trim();
    if (!diagramUid || !/^UID[0-9a-fA-F-]+$/i.test(diagramUid)) {
      res.status(400).type("text").send("Invalid diagramUid");
      return;
    }
    const rec = svgIndex?.diagrams?.[diagramUid];
    if (!rec?.svg) {
      res.status(404).type("text").send("Diagram not found");
      return;
    }
    const abs = resolveIndexedPath(rec.svg);
    if (!abs) {
      res.status(404).type("text").send("SVG file missing");
      return;
    }
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(abs);
  });

  router.get("/endpoints", (req, res) => {
    ensureIndexes();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required", endpoints: [] });
      return;
    }
    const limit = Math.min(Number(req.query.limit) || 20, 40);
    const diagramUid = String(req.query.diagramUid || "").trim();
    const zone = String(req.query.zone || "").trim();
    const optionTokens = parseOptionTokens(req.query.optionTokens || req.query.options);
    const scope = { diagramUid: diagramUid || undefined, zone: zone || undefined };
    const systems = allowedSystemUids(code, scope);
    const files = filesForCode(code, systems, diagramUid || undefined, zone || undefined);
    const endpoints = collectEndpointsForCode(code, { limit, ...scope, optionTokens });
    res.json({
      code,
      zone: zone || "all",
      diagramUid: diagramUid || null,
      systemUids: systems,
      optionTokens,
      count: endpoints.length,
      filesUsed: files.slice(0, limit),
      endpoints,
    });
  });

  /** Resolve SVG desc UIDs for a specific pin/wire on a diagram. */
  router.get("/highlight", (req, res) => {
    ensureIndexes();
    const code = normalizeCode(String(req.query.code || ""));
    const pin = String(req.query.pin || "").trim();
    const color = normalizeWireColor(String(req.query.color || ""));
    const peer = normalizeCode(String(req.query.peer || ""));
    const diagramUid = String(req.query.diagramUid || "").trim();
    const zone = String(req.query.zone || "").trim();
    const optionTokens = parseOptionTokens(req.query.optionTokens || req.query.options);
    if (!code) {
      res.status(400).json({ error: "code required", uids: [] });
      return;
    }
    const result = resolveHighlightUids({
      code,
      pin,
      color,
      peer,
      diagramUid,
      zone: zone || undefined,
      optionTokens,
    });
    res.json({
      code,
      pin,
      color,
      peer,
      diagramUid,
      zone: zone || "all",
      optionTokens,
      uids: result.uids,
      pinUids: result.pinUids,
      wireUids: result.wireUids,
      source: result.source,
      matchedCount: result.matched.length,
      matched: result.matched.slice(0, 3),
    });
  });

  /** LogicDesign systems tree (VIDA left-nav style), optionally filtered by code/zone. */
  router.get("/systems", (req, res) => {
    ensureIndexes();
    const code = normalizeCode(String(req.query.code || ""));
    const zone = String(req.query.zone || "").trim();
    const cat = loadEwdSystemCatalog(dataDir());
    let systems = [...cat.values()];
    if (code) {
      const allowed = new Set(allowedSystemUids(code, { zone: zone || undefined }));
      if (allowed.size) systems = systems.filter((s) => allowed.has(s.designUid));
      else {
        const rec = deviceIndex?.by_code?.[code];
        const set = new Set(rec?.systemUids || []);
        systems = systems.filter((s) => set.has(s.designUid));
      }
    } else if (zone && zone !== "all") {
      systems = systems.filter((s) => s.zone === zone);
    }
    systems.sort((a, b) => a.name.localeCompare(b.name) || a.designUid.localeCompare(b.designUid));
    res.json({
      code: code || null,
      zone: zone || "all",
      count: systems.length,
      systems: systems.slice(0, 400).map((s) => ({
        systemUid: s.designUid,
        name: s.name,
        folders: s.folders,
        zone: s.zone,
        diagramUids: s.diagramUids.slice(0, 40),
        diagramCount: s.diagramUids.length,
      })),
    });
  });

  /**
   * GlobalSignals tracer: given object UID (or code+pin → pinUid), return sibling UIDs
   * and diagrams that share the same globalsignal*.xml bundle.
   */
  router.get("/trace", (req, res) => {
    ensureIndexes();
    let uid = String(req.query.uid || "").trim();
    const code = normalizeCode(String(req.query.code || ""));
    const pin = String(req.query.pin || "").trim();
    const zone = String(req.query.zone || "").trim();
    const optionTokens = parseOptionTokens(req.query.optionTokens || req.query.options);
    if (!uid && code && pin) {
      const edges = lookupPinWireEdges(code, pin, { zone: zone || undefined, optionTokens });
      uid = edges[0]?.pinUid || edges[0]?.wireUid || edges[0]?.sharedObjectUID || "";
    }
    if (!uid || !/^UID[0-9a-fA-F-]+$/i.test(uid)) {
      res.status(400).json({ error: "uid or code+pin required", siblings: [], diagrams: [] });
      return;
    }
    const rec = globalSignalIndex?.by_uid?.[uid];
    const siblings = rec?.siblings || [];
    const allUids = [uid, ...siblings];
    const diagramSet = new Set<string>(rec?.diagramUids || []);
    // Fill missing sheets from svg_desc only when index omitted them (bounded scan)
    if (diagramSet.size < 2 && svgIndex?.diagrams) {
      const want = new Set(allUids.slice(0, 24));
      for (const [duid, drec] of Object.entries(svgIndex.diagrams)) {
        if ((drec.groups || []).some((g) => (g.uids || []).some((u) => want.has(u)))) {
          diagramSet.add(duid);
        }
        if (diagramSet.size >= 40) break;
      }
    }
    const cat = loadEwdSystemCatalog(dataDir());
    const diagrams = [...diagramSet]
      .map((diagramUid) => {
        const d = svgIndex?.diagrams?.[diagramUid];
        if (!d) return null;
        const sys = cat.get(d.designFolder);
        return {
          diagramUid,
          designFolder: d.designFolder,
          systemName: sys?.name || "",
          zone: sys?.zone || null,
          textCodes: (d.textCodes || []).slice(0, 12),
        };
      })
      .filter(Boolean)
      .slice(0, 40);
    res.json({
      uid,
      code: code || null,
      pin: pin || null,
      signalFile: rec?.signalFile || null,
      siblingCount: siblings.length,
      siblings: siblings.slice(0, 64),
      uids: allUids.slice(0, 80),
      diagrams,
      indexAvailable: Boolean(globalSignalIndex?.by_uid),
    });
  });

  /**
   * Pick the best diagramUid among candidates where connectivity has code+pin
   * (and preferably UIDs that also exist on that SVG sheet). Stops blind page-flipping.
   */
  router.get("/pick-diagram", (req, res) => {
    ensureIndexes();
    const code = normalizeCode(String(req.query.code || ""));
    if (!code) {
      res.status(400).json({ error: "code required", diagramUid: null, ranked: [] });
      return;
    }
    const pins = String(req.query.pins || req.query.pin || "")
      .split(/[,|;]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 6);
    const color = normalizeWireColor(String(req.query.color || ""));
    const peer = normalizeCode(String(req.query.peer || ""));
    const zone = String(req.query.zone || "").trim();
    const optionTokens = parseOptionTokens(req.query.optionTokens || req.query.options);
    const requested = String(req.query.diagramUids || "")
      .split(/[,;]+/)
      .map((u) => u.trim())
      .filter((u) => /^UID[0-9a-fA-F-]+$/i.test(u))
      .slice(0, 24);

    // Prefer diagrams owned by the net (from pin_wire_index.diagramUids)
    const netOwned: string[] = [];
    if (pins.length && pinWireIndex?.by_code_pin) {
      for (const pin of pins) {
        for (const e of lookupPinWireEdges(code, pin, { zone: zone || undefined, optionTokens })) {
          for (const d of e.diagramUids || []) {
            if (!netOwned.includes(d)) netOwned.push(d);
          }
        }
      }
    }

    const fallbackUids = [
      ...new Set([
        ...netOwned,
        ...(deviceIndex?.by_code?.[code]?.diagramUids || []),
        ...(svgIndex?.codeToDiagramUids?.[code] || []),
      ]),
    ].slice(0, 32);
    const diagramUids = requested.length ? requested : fallbackUids;
    const pinList = pins.length ? pins : [""];

    type RankRow = {
      diagramUid: string;
      matchedCount: number;
      uidCount: number;
      onSheetUidCount: number;
      wireHits: number;
      pinHits: number;
      pin: string;
      source: string;
    };
    const ranked: RankRow[] = [];
    for (const diagramUid of diagramUids) {
      let best: RankRow = {
        diagramUid,
        matchedCount: 0,
        uidCount: 0,
        onSheetUidCount: 0,
        wireHits: 0,
        pinHits: 0,
        pin: pinList[0] || "",
        source: "",
      };
      for (const pin of pinList) {
        const result = resolveHighlightUids({
          code,
          pin,
          color,
          peer,
          diagramUid,
          zone: zone || undefined,
          optionTokens,
        });
        const own = scoreDiagramNetOwnership(diagramUid, result.pinUids, result.wireUids);
        const row: RankRow = {
          diagramUid,
          matchedCount: result.matched.length,
          uidCount: result.uids.length,
          onSheetUidCount: own.onSheet,
          wireHits: own.wireHits,
          pinHits: own.pinHits,
          pin,
          source: result.source,
        };
        const better =
          row.wireHits > best.wireHits ||
          (row.wireHits === best.wireHits && row.onSheetUidCount > best.onSheetUidCount) ||
          (row.wireHits === best.wireHits &&
            row.onSheetUidCount === best.onSheetUidCount &&
            row.matchedCount > best.matchedCount) ||
          (row.wireHits === best.wireHits &&
            row.onSheetUidCount === best.onSheetUidCount &&
            row.matchedCount === best.matchedCount &&
            row.uidCount > best.uidCount);
        if (better) best = row;
        if (best.matchedCount > 0 && best.wireHits > 0) break;
      }
      ranked.push(best);
    }

    ranked.sort(
      (a, b) =>
        b.wireHits - a.wireHits ||
        Number(b.matchedCount > 0 && b.onSheetUidCount > 0) -
          Number(a.matchedCount > 0 && a.onSheetUidCount > 0) ||
        Number(b.matchedCount > 0) - Number(a.matchedCount > 0) ||
        b.onSheetUidCount - a.onSheetUidCount ||
        b.matchedCount - a.matchedCount ||
        b.uidCount - a.uidCount,
    );

    const hard = ranked.find((r) => r.matchedCount > 0 && (r.wireHits > 0 || r.onSheetUidCount > 0));
    const soft = ranked.find((r) => r.matchedCount > 0);
    const pick = hard || soft || null;

    res.json({
      code,
      pins: pinList.filter(Boolean),
      color,
      peer,
      zone: zone || "all",
      optionTokens,
      diagramUid: pick?.diagramUid || null,
      pin: pick?.pin || pins[0] || "",
      matchedCount: pick?.matchedCount || 0,
      uidCount: pick?.uidCount || 0,
      onSheetUidCount: pick?.onSheetUidCount || 0,
      wireHits: pick?.wireHits || 0,
      pinHits: pick?.pinHits || 0,
      source: pick?.source || "",
      netOwnedCount: netOwned.length,
      viable: ranked
        .filter((r) => r.matchedCount > 0)
        .map((r) => r.diagramUid)
        .slice(0, 8),
      ranked: ranked.slice(0, 12),
    });
  });

  return router;
}
