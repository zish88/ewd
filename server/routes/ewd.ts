import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { ewdDataDir, resolveIndexedPath, safeUnderDataDir } from "../ewdPaths.js";
import { filterDesignUidsByZone, loadEwdSystemCatalog } from "../zoneContext.js";
import { evaluateOptionExpression } from "../optionExpression.js";
import { lookupFacePins } from "./ewdCapital.js";

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
    .replace(/[/_.,\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

/** GN-BN === BN-GN === GN/BN — order-independent dual insulation match. */
function wireColorsMatch(a: string, b: string): boolean {
  const na = normalizeWireColor(a);
  const nb = normalizeWireColor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split("-").filter(Boolean).sort().join("-");
  const pb = nb.split("-").filter(Boolean).sort().join("-");
  return Boolean(pa && pb && pa === pb);
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

/** Intermediate harness points — walk through these toward the final module/button. */
function isPathJunctionCode(code: string): boolean {
  const c = normalizeCode(code);
  return /^(63|73|74|15)\//.test(c);
}

/** Final load / control units — stop BFS after collecting their pin (do not enter internals). */
function isPathTerminalCode(code: string): boolean {
  const c = normalizeCode(code);
  return /^(3|4|6|8|9|10|16|17|20)\//.test(c);
}

/**
 * Rank pin_wire edges for path BFS: same sharedUID first, then on-sheet same-color.
 * sharedUID must NOT exclude other same-color segments (14K138 → 14014 at junctions).
 */
export function rankPathEdgesForExpand(
  edges: PinWireEdge[],
  opts: { seedSharedUid?: string; sheetUids: Set<string>; wantColor: string },
): PinWireEdge[] {
  const shared = String(opts.seedSharedUid || "").trim();
  const scored = edges.map((e, i) => {
    const onSheet = Boolean(e.wireUid && opts.sheetUids.has(e.wireUid));
    const sameShared = shared && e.sharedObjectUID === shared ? 1 : 0;
    const colorOk =
      !opts.wantColor || !e.color || wireColorsMatch(String(e.color), opts.wantColor);
    return { e, i, onSheet, sameShared, colorOk };
  });
  // Keep all color-ok edges; prefer shared+onSheet when sorting only
  return scored
    .filter((x) => x.colorOk)
    .sort(
      (a, b) =>
        b.sameShared - a.sameShared ||
        Number(b.onSheet) - Number(a.onSheet) ||
        a.i - b.i,
    )
    .map((x) => x.e);
}

/**
 * Expand one-hop card wire into all on-sheet conductor UIDs along the path
 * through junctions by same wire color (harness / sharedObjectUID may change).
 * Does NOT use GlobalSignals (would paint entire CAN/LIN buses).
 */
function expandWirePathOnSheet(opts: {
  seedWireUid: string;
  seedSharedUid?: string;
  code: string;
  pin: string;
  color: string;
  peer?: string;
  peerPin?: string;
  diagramUid: string;
  zone?: string;
  optionTokens?: string[];
  sheetUids: Set<string>;
}): { wireUids: string[]; pinUids: string[]; hops: number } {
  const wantColor = normalizeWireColor(opts.color);
  const sheet = opts.sheetUids;
  const wireOut = new Set<string>();
  const pinOut = new Set<string>();
  const visitedJunctions = new Set<string>(); // code|pin at 73/74/…
  if (opts.seedWireUid && sheet.has(opts.seedWireUid)) wireOut.add(opts.seedWireUid);
  else if (opts.seedWireUid) wireOut.add(opts.seedWireUid); // keep seed even if not yet filtered

  type Q = { code: string; pin: string; depth: number };
  const queue: Q[] = [];
  const visited = new Set<string>();
  const enqueue = (code: string, pin: string, depth: number) => {
    const c = normalizeCode(code);
    const p = normPinKey(pin);
    if (!c || !p) return;
    const key = `${c}|${p}`;
    if (visited.has(key)) return;
    queue.push({ code: c, pin: p, depth });
  };
  enqueue(opts.code, opts.pin, 0);
  if (opts.peer) enqueue(opts.peer, opts.peerPin || opts.pin, 0);

  const MAX_HOPS = 8;
  const MAX_WIRES = 24;
  let hops = 0;

  while (queue.length && wireOut.size < MAX_WIRES) {
    const cur = queue.shift()!;
    const vkey = `${cur.code}|${normPinKey(cur.pin)}`;
    if (visited.has(vkey)) continue;
    visited.add(vkey);
    if (cur.depth > MAX_HOPS) continue;
    hops = Math.max(hops, cur.depth);
    if (isPathJunctionCode(cur.code)) visitedJunctions.add(vkey);

    const rawEdges = lookupPinWireEdges(cur.code, cur.pin, {
      diagramUid: opts.diagramUid || undefined,
      zone: opts.zone,
      optionTokens: opts.optionTokens,
    });
    // All same-color edges (sharedUID only ranks — never exclusive)
    const edges = rankPathEdgesForExpand(rawEdges, {
      seedSharedUid: opts.seedSharedUid,
      sheetUids: sheet,
      wantColor,
    });

    for (const e of edges) {
      if (e.wireUid && sheet.has(e.wireUid)) wireOut.add(e.wireUid);
      if (e.pinUid && sheet.has(e.pinUid)) pinOut.add(e.pinUid);
      if (e.peerUid && sheet.has(e.peerUid)) pinOut.add(e.peerUid);

      const peerCode = normalizeCode(e.peerCode || "");
      const peerPin = String(e.peerPin || "").trim();
      if (!peerCode || !peerPin) continue;
      if (/^31\//.test(peerCode)) continue; // grounds — do not flood

      if (isPathTerminalCode(peerCode)) {
        // Collect terminal pin on sheet; do not walk into module internals
        continue;
      }
      // Always walk junctions (incl. card peer when it is 73/74) and depth-0 peers
      if (isPathJunctionCode(peerCode) || isPathJunctionCode(cur.code) || cur.depth === 0) {
        enqueue(peerCode, peerPin, cur.depth + 1);
      }
    }
  }

  // Fan-out A: same sharedObjectUID on sheet (original harness instance)
  if (opts.seedSharedUid && pinWireIndex?.by_code_pin && wireOut.size < MAX_WIRES) {
    for (const list of Object.values(pinWireIndex.by_code_pin)) {
      for (const e of list) {
        if (e.sharedObjectUID !== opts.seedSharedUid) continue;
        if (wantColor && e.color && !wireColorsMatch(String(e.color), wantColor)) continue;
        if (e.wireUid && sheet.has(e.wireUid)) {
          wireOut.add(e.wireUid);
          if (wireOut.size >= MAX_WIRES) break;
        }
      }
      if (wireOut.size >= MAX_WIRES) break;
    }
  }

  // Fan-out B: same color on visited junction cavities — picks up 14014 after 14K138
  if (wantColor && pinWireIndex?.by_code_pin && wireOut.size < MAX_WIRES) {
    for (const jkey of visitedJunctions) {
      const [jCode, jPin] = jkey.split("|");
      if (!jCode || !jPin) continue;
      const jedges = lookupPinWireEdges(jCode, jPin, {
        diagramUid: opts.diagramUid || undefined,
        zone: opts.zone,
        optionTokens: opts.optionTokens,
      });
      for (const e of jedges) {
        if (e.color && !wireColorsMatch(String(e.color), wantColor)) continue;
        if (e.wireUid && sheet.has(e.wireUid)) {
          wireOut.add(e.wireUid);
          if (wireOut.size >= MAX_WIRES) break;
        }
        const peerCode = normalizeCode(e.peerCode || "");
        const peerPin = String(e.peerPin || "").trim();
        if (
          peerCode &&
          peerPin &&
          !/^31\//.test(peerCode) &&
          !isPathTerminalCode(peerCode) &&
          isPathJunctionCode(peerCode)
        ) {
          enqueue(peerCode, peerPin, hops + 1);
        }
      }
      if (wireOut.size >= MAX_WIRES) break;
    }
    // Drain any junction peers discovered in fan-out B (bounded)
    while (queue.length && wireOut.size < MAX_WIRES) {
      const cur = queue.shift()!;
      const vkey = `${cur.code}|${normPinKey(cur.pin)}`;
      if (visited.has(vkey)) continue;
      visited.add(vkey);
      if (cur.depth > MAX_HOPS) continue;
      const edges = rankPathEdgesForExpand(
        lookupPinWireEdges(cur.code, cur.pin, {
          diagramUid: opts.diagramUid || undefined,
          zone: opts.zone,
          optionTokens: opts.optionTokens,
        }),
        { seedSharedUid: opts.seedSharedUid, sheetUids: sheet, wantColor },
      );
      for (const e of edges) {
        if (e.wireUid && sheet.has(e.wireUid)) wireOut.add(e.wireUid);
        const peerCode = normalizeCode(e.peerCode || "");
        const peerPin = String(e.peerPin || "").trim();
        if (!peerCode || !peerPin || /^31\//.test(peerCode)) continue;
        if (isPathTerminalCode(peerCode)) continue;
        if (isPathJunctionCode(peerCode) || isPathJunctionCode(cur.code)) {
          enqueue(peerCode, peerPin, cur.depth + 1);
        }
      }
    }
  }

  // Seed first in list
  const wires = [...wireOut];
  if (opts.seedWireUid && sheet.has(opts.seedWireUid)) {
    wires.sort((a, b) => (a === opts.seedWireUid ? -1 : b === opts.seedWireUid ? 1 : 0));
  }
  return { wireUids: wires.filter((u) => sheet.has(u)).slice(0, MAX_WIRES), pinUids: [...pinOut].slice(0, 16), hops };
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
  /** FaceView / SQLite anchors from the selected card — preferred paint seeds. */
  preferWireUid?: string;
  preferPinUid?: string;
}): HighlightResolve {
  const {
    code,
    pin,
    color,
    peer,
    diagramUid,
    zone,
    optionTokens = [],
    preferWireUid = "",
    preferPinUid = "",
  } = opts;
  const wantColor = normalizeWireColor(color);
  const preferWire = String(preferWireUid || "").trim();
  const preferPin = String(preferPinUid || "").trim();

  // 1) FaceView = cavity truth (color/peer/option). Paint UIDs must exist on the
  //    schematic SVG — FaceView span ids are often FaceView-local, so prefer
  //    pin_wire / connectivity UIDs for diagramUid highlight.
  let matched: EwdEndpoint[] = [];
  let source = "connectivity";
  let faceColor = wantColor;
  let facePeer = peer;
  let faceEdges: Array<Record<string, unknown>> = [];
  if (pin) {
    const design = diagramUid ? svgIndex?.diagrams?.[diagramUid]?.designFolder : "";
    faceEdges = lookupFacePins(code, pin, design).filter((e) => {
      const colorOk =
        !wantColor || !e.color || wireColorsMatch(String(e.color || ""), wantColor);
      const peerOk =
        !peer ||
        normalizeCode(String(e.peerCode || "")) === peer ||
        String(e.peerCode || "").includes(peer);
      return colorOk && peerOk;
    });
    if (faceEdges.length) {
      if (!faceColor && faceEdges[0].color) {
        faceColor = normalizeWireColor(String(faceEdges[0].color));
      }
      if (!facePeer && faceEdges[0].peerCode) {
        facePeer = normalizeCode(String(faceEdges[0].peerCode));
      }
    }
  }
  if (pin && pinWireIndex?.by_code_pin) {
    const edges = lookupPinWireEdges(code, pin, {
      diagramUid,
      zone,
      optionTokens,
    }).filter((e) => {
      const colorOk =
        !faceColor || !e.color || wireColorsMatch(String(e.color), faceColor);
      const peerOk =
        !facePeer ||
        normalizeCode(e.peerCode || "") === facePeer ||
        String(e.peerCode || "").includes(facePeer);
      return colorOk && peerOk;
    });
    if (edges.length) {
      matched = edges.map(edgeToEndpoint);
      source = faceEdges.length ? "face_view+pin_wire" : "pin_wire_index";
    }
  }
  if (!matched.length && faceEdges.length) {
    const faceMatched = faceEdges.map((e) =>
      edgeToEndpoint({
        code,
        ppin: String(e.cavity || pin),
        pin: String(e.cavity || pin),
        pinUid: String(e.pinUid || ""),
        wireUid: String(e.wireUid || ""),
        peerCode: String(e.peerCode || ""),
        peerPin: String(e.peerPin || ""),
        peerUid: String(e.peerUid || ""),
        color: String(e.color || ""),
        gauge: String(e.gauge || ""),
        wireName: String(e.wireName || ""),
        optionExpression: String(e.optionExpression || ""),
        systemUid: String(e.systemUid || e.designUid || ""),
      }),
    );
    if (diagramUid) {
      const sheetUids = new Set(
        (svgIndex?.diagrams?.[diagramUid]?.groups || []).flatMap((g) => g.uids || []),
      );
      const onSheet = faceMatched.some(
        (ep) =>
          (ep.fromUid && sheetUids.has(ep.fromUid)) ||
          (ep.toUid && sheetUids.has(ep.toUid)) ||
          (ep.wireUid && sheetUids.has(ep.wireUid)),
      );
      if (onSheet) {
        matched = faceMatched;
        source = "face_view";
      }
    } else {
      matched = faceMatched;
      source = "face_view";
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
      const colorOk = !faceColor || !ep.color || wireColorsMatch(ep.color, faceColor);
      const pinOnFrom = labelMatchesPin(ep.pinFrom, pin);
      const pinOnTo = labelMatchesPin(ep.pinTo, pin);
      const pinOnSelected =
        (normalizeCode(ep.from).startsWith(code) && pinOnFrom) ||
        (normalizeCode(ep.to).startsWith(code) && pinOnTo);
      const pinOnCode = !pin || pinOnSelected || pinOnFrom || pinOnTo;
      const peerOk =
        !facePeer ||
        ep.from.includes(facePeer) ||
        ep.to.includes(facePeer) ||
        normalizeCode(ep.from).startsWith(facePeer) ||
        normalizeCode(ep.to).startsWith(facePeer);
      return colorOk && pinOnCode && peerOk;
    });
    if (matched.length && faceEdges.length) source = "face_view+connectivity";
  }

  const pinUids = new Set<string>();
  const wireUids = new Set<string>();
  // Card-bound UIDs win when present — do not merge every soft pin_wire edge.
  if (preferWire) wireUids.add(preferWire);
  if (preferPin) pinUids.add(preferPin);
  for (const ep of matched) {
    const pinOnFrom = labelMatchesPin(ep.pinFrom, pin);
    const pinOnTo = labelMatchesPin(ep.pinTo, pin);
    const fromIsCode = normalizeCode(ep.from).startsWith(code);
    const toIsCode = normalizeCode(ep.to).startsWith(code);
    const colorOk =
      !wantColor || !ep.color || wireColorsMatch(ep.color, wantColor || faceColor);
    // When card fixed a wireUid, ignore other nets entirely
    if (preferWire && ep.wireUid && ep.wireUid !== preferWire) continue;
    if (pin) {
      if (pinOnFrom && ep.fromUid) pinUids.add(ep.fromUid);
      if (pinOnTo && ep.toUid) pinUids.add(ep.toUid);
      if (!pinUids.size) {
        if (fromIsCode && ep.fromUid) pinUids.add(ep.fromUid);
        if (toIsCode && ep.toUid) pinUids.add(ep.toUid);
      }
      // Opposite end only when color matches the card
      if (colorOk) {
        if (pinOnFrom && ep.toUid) pinUids.add(ep.toUid);
        if (pinOnTo && ep.fromUid) pinUids.add(ep.fromUid);
      }
    } else if (colorOk) {
      if (ep.fromUid) pinUids.add(ep.fromUid);
      if (ep.toUid) pinUids.add(ep.toUid);
    }
    // Never paint sharedObjectUID — it is a cross-system instance id, not SVG geometry
    if (!preferWire && colorOk && ep.wireUid) wireUids.add(ep.wireUid);
  }

  const rec = diagramUid ? svgIndex?.diagrams?.[diagramUid] : undefined;
  const groups = rec?.groups || [];
  const sheetUids = new Set(groups.flatMap((g) => g.uids || []));
  // Seed: card wireUid if on sheet, else matched wire UIDs on sheet
  let wireOnSheet = [...wireUids].filter((u) => sheetUids.has(u));
  if (preferWire && sheetUids.has(preferWire)) {
    wireOnSheet = [preferWire, ...wireOnSheet.filter((u) => u !== preferWire)];
    source = source.startsWith("face_view") ? source : "card-wire-uid";
  }
  let pinOnSheet = [...pinUids].filter((u) => sheetUids.has(u));
  if (preferPin && sheetUids.has(preferPin)) {
    pinOnSheet = [preferPin, ...pinOnSheet.filter((u) => u !== preferPin)];
  }

  // Path expansion: seed segment → junctions → final module/button (on this sheet only)
  const seedWire =
    (preferWire && sheetUids.has(preferWire) ? preferWire : "") ||
    wireOnSheet[0] ||
    "";
  const seedEdge =
    matched.find((ep) => ep.wireUid && ep.wireUid === seedWire) ||
    matched.find((ep) => ep.wireUid && sheetUids.has(ep.wireUid)) ||
    matched[0];
  const seedShared = String(seedEdge?.sharedObjectUID || "").trim();
  const pathPeer = facePeer || peer || normalizeCode(String(seedEdge?.to || "").split(":")[0] || "");
  const pathPeerPin = String(seedEdge?.pinTo || "").trim();
  if (seedWire && diagramUid && (pin || preferWire)) {
    const path = expandWirePathOnSheet({
      seedWireUid: seedWire,
      seedSharedUid: seedShared,
      code,
      pin: pin || String(seedEdge?.pinFrom || ""),
      color: wantColor || faceColor || String(seedEdge?.color || ""),
      peer: pathPeer,
      peerPin: pathPeerPin,
      diagramUid,
      zone,
      optionTokens,
      sheetUids,
    });
    if (path.wireUids.length > wireOnSheet.length) {
      wireOnSheet = path.wireUids;
      source = source.includes("path") ? source : `${source}+path`;
    } else if (path.wireUids.length) {
      // Merge any extra on-sheet segments
      const merged = new Set([...wireOnSheet, ...path.wireUids]);
      wireOnSheet = [
        seedWire,
        ...[...merged].filter((u) => u !== seedWire),
      ];
      if (path.wireUids.length > 1) source = source.includes("path") ? source : `${source}+path`;
    }
    for (const u of path.pinUids) {
      if (!pinOnSheet.includes(u)) pinOnSheet.push(u);
    }
  }

  /** Keep only seed UIDs that live in the preferred schem class — never sibling conductors. */
  const expandExact = (seed: string[], preferClass: string) => {
    const seedSet = new Set(seed);
    const out = new Set<string>();
    for (const g of groups) {
      if (preferClass && g.schemClass !== preferClass) continue;
      for (const u of g.uids || []) {
        if (seedSet.has(u)) out.add(u);
      }
    }
    return [...out];
  };

  let uids: string[] = [];
  const keepFace = source.startsWith("face_view");
  if (wireOnSheet.length) {
    uids = expandExact(wireOnSheet, "CAFConductor");
    if (!uids.length) uids = wireOnSheet;
    if (source === "pin_wire_index") source = "pin_wire_wire";
    else if (!keepFace && !source.includes("card-wire") && !source.includes("path")) source = "wire-uid";
  } else if (pinOnSheet.length) {
    // Pin UIDs are for markers — do not expand into every CAFConductor on the pin list
    uids = pinOnSheet;
    if (source === "pin_wire_index") source = "pin_wire_pin";
    else if (!keepFace) source = "pin-uid";
  } else if (matched.length) {
    uids = [...wireUids, ...pinUids].filter(Boolean);
    if (!keepFace) source = "connectivity-uid";
  } else if (diagramUid) {
    const deviceIds = deviceIndex?.by_code?.[code]?.objectIds || [];
    uids = deviceIds.filter((u) => sheetUids.has(u));
    source = "device-object";
  }

  let matchedFiltered = matched;
  if (preferWire) {
    // Keep seed net + path peers (same color), not every soft edge
    matchedFiltered = matched.filter(
      (ep) =>
        !ep.wireUid ||
        ep.wireUid === preferWire ||
        wireOnSheet.includes(ep.wireUid) ||
        (!!wantColor && !!ep.color && wireColorsMatch(ep.color, wantColor)),
    );
  } else if (wantColor) {
    matchedFiltered = matched.filter(
      (ep) => !ep.color || wireColorsMatch(ep.color, wantColor),
    );
  }
  const nonGround = matchedFiltered.filter(
    (ep) => !/^31\//.test(normalizeCode(ep.from)) && !/^31\//.test(normalizeCode(ep.to)),
  );
  const matchedOut = (nonGround.length ? nonGround : matchedFiltered).slice(0, 8);
  return {
    uids: uids.slice(0, 24),
    pinUids: [...new Set([...pinOnSheet, ...pinUids])].filter(Boolean).slice(0, 16),
    // Full on-sheet path (seed first), not exclusive single segment
    wireUids: wireOnSheet.length
      ? wireOnSheet.slice(0, 16)
      : [...wireUids].filter(Boolean).slice(0, 16),
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
    const preferWireUid = String(req.query.wireUid || req.query.wire_uid || "").trim();
    const preferPinUid = String(req.query.pinUid || req.query.pin_uid || "").trim();
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
      preferWireUid,
      preferPinUid,
    });
    res.json({
      code,
      pin,
      color,
      peer,
      diagramUid,
      zone: zone || "all",
      optionTokens,
      preferWireUid: preferWireUid || null,
      preferPinUid: preferPinUid || null,
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
    const preferWireUid = String(req.query.wireUid || req.query.wire_uid || "").trim();
    const preferPinUid = String(req.query.pinUid || req.query.pin_uid || "").trim();
    const optionTokens = parseOptionTokens(req.query.optionTokens || req.query.options);
    const requested = String(req.query.diagramUids || "")
      .split(/[,;]+/)
      .map((u) => u.trim())
      .filter((u) => /^UID[0-9a-fA-F-]+$/i.test(u))
      .slice(0, 24);

    // Diagrams owned by this net (pin_wire) — never dropped when client sends a probe list
    const netOwned: string[] = [];
    const pushOwned = (d: string) => {
      if (d && !netOwned.includes(d)) netOwned.push(d);
    };
    if (pins.length && pinWireIndex?.by_code_pin) {
      for (const pin of pins) {
        for (const e of lookupPinWireEdges(code, pin, { zone: zone || undefined, optionTokens })) {
          if (preferWireUid && e.wireUid && e.wireUid !== preferWireUid) continue;
          if (color && e.color && !wireColorsMatch(String(e.color), color)) continue;
          for (const d of e.diagramUids || []) pushOwned(d);
        }
      }
    }
    // Also find sheets by card wireUid alone (even if pin soft-key missed)
    if (preferWireUid && pinWireIndex?.by_code_pin) {
      for (const edges of Object.values(pinWireIndex.by_code_pin)) {
        for (const e of edges) {
          if (e.wireUid !== preferWireUid) continue;
          for (const d of e.diagramUids || []) pushOwned(d);
        }
      }
    }

    const fallbackUids = [
      ...new Set([
        ...netOwned,
        ...(deviceIndex?.by_code?.[code]?.diagramUids || []),
        ...(svgIndex?.codeToDiagramUids?.[code] || []),
      ]),
    ].slice(0, 40);
    // requested (client probe) ADDS to netOwned — does not replace it
    const diagramUids = [
      ...new Set([...netOwned, ...requested, ...(requested.length ? [] : fallbackUids)]),
    ].slice(0, 40);
    const pinList = pins.length ? pins : [""];
    const requireWireHit = Boolean(preferWireUid);

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
          preferWireUid,
          preferPinUid,
        });
        const own = scoreDiagramNetOwnership(diagramUid, result.pinUids, result.wireUids);
        // With card wireUid: only count hits if that UID is on the sheet
        let wireHits = own.wireHits;
        if (preferWireUid) {
          const sheet = new Set(
            (svgIndex?.diagrams?.[diagramUid]?.groups || []).flatMap((g) => g.uids || []),
          );
          wireHits = sheet.has(preferWireUid) ? Math.max(own.wireHits, 1) : 0;
        }
        const row: RankRow = {
          diagramUid,
          matchedCount: result.matched.length,
          uidCount: result.uids.length,
          onSheetUidCount: own.onSheet,
          wireHits,
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
        if (best.wireHits > 0) break;
      }
      ranked.push(best);
    }

    ranked.sort(
      (a, b) =>
        b.wireHits - a.wireHits ||
        b.onSheetUidCount - a.onSheetUidCount ||
        b.pinHits - a.pinHits ||
        b.matchedCount - a.matchedCount ||
        b.uidCount - a.uidCount,
    );

    // hard = wire on sheet; with card wireUid never fall back to soft (matched-only)
    const hard = ranked.find((r) => r.wireHits > 0);
    const soft = ranked.find((r) => r.matchedCount > 0 && (r.wireHits > 0 || r.pinHits > 0));
    const pick = hard || (requireWireHit ? null : soft) || null;
    const viableRows = ranked.filter((r) => r.wireHits > 0 || (!requireWireHit && r.pinHits > 0));

    res.json({
      code,
      pins: pinList.filter(Boolean),
      color,
      peer,
      zone: zone || "all",
      optionTokens,
      preferWireUid: preferWireUid || null,
      preferPinUid: preferPinUid || null,
      diagramUid: pick?.diagramUid || null,
      pin: pick?.pin || pins[0] || "",
      matchedCount: pick?.matchedCount || 0,
      uidCount: pick?.uidCount || 0,
      onSheetUidCount: pick?.onSheetUidCount || 0,
      wireHits: pick?.wireHits || 0,
      pinHits: pick?.pinHits || 0,
      source: pick?.source || "",
      netOwnedCount: netOwned.length,
      hard: Boolean(hard),
      viable: viableRows.map((r) => r.diagramUid).slice(0, 12),
      ranked: viableRows.slice(0, 12),
    });
  });

  return router;
}
