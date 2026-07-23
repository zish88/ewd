/**
 * Dynamic EWD marker-anchor — payload-driven pin placement.
 * Line/path highlighting is disabled; only a fixed screen-size pin marker is shown.
 * No hardcoded connector/pin/model literals; all values come from the card payload.
 */

import { normalizeWireColorKey, wireBorderColors } from "./wireColors.js";

export type Pt = { x: number; y: number };

/** Abstract input from the clicked card / diagram context. */
export type HighlightTargetPayload = {
  /** From selected card / SQLite only — never a hardcoded connector literal. Empty → "". */
  connectorCode?: string | null;
  pinNumber?: string | null;
  wireColor?: string | null;
  systemUid?: string;
  diagramUid?: string;
  /** Peer connector (Откуда/Куда) — used only when primary connector is absent on this SVG. */
  peerCode?: string | null;
};

export type HighlightResult = {
  painted: Element[];
  hostGroup: Element | null;
  markerAt: Pt | null;
  markerLabel: string;
  stage: "pin-color" | "marker-only" | "none";
  reason: string;
  debug: Record<string, unknown>;
};

/** @deprecated Use HighlightTargetPayload + highlightTarget */
export type HighlightFocus = {
  searchCode: string;
  pin?: string;
  wireColor?: string;
  peerCode?: string;
  pinFrom?: string;
  pinTo?: string;
  resolveUids?: string[];
};

export { normalizeWireColorKey };

/** Target on-screen marker diameter / label size (CSS px). */
export const MARKER_SCREEN_DIAMETER = 23;
export const MARKER_SCREEN_FONT = 11.5;
const MARKER_FILL = "rgba(16, 185, 129, 0.25)";
const MARKER_STROKE_WIDTH_PX = 2.5;

const SERVICE_RE =
  /grid|border|frame|margin|coordinate|coord|page[-_]?border|sheet|titleblock|cafsheet|drawing[-_]?frame|viewport/i;

const WIRE_COLOR_CODES = new Set([
  "BK",
  "BN",
  "BU",
  "GN",
  "GY",
  "OG",
  "OR",
  "RD",
  "VT",
  "WH",
  "YE",
  "PK",
  "SR",
  "GR",
  "BL",
  "VI",
  "SB",
  "LGN",
]);

export function normalizeCodeLabel(s: string | null | undefined): string {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : raw;
}

function readDesc(g: Element): string {
  try {
    const d = g.querySelector(":scope > desc")?.textContent || "";
    if (d) return d;
  } catch {
    /* ignore */
  }
  const first = g.firstElementChild;
  return first && first.tagName.toLowerCase() === "desc" ? first.textContent || "" : "";
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function textCenter(node: Element): Pt | null {
  try {
    const b = (node as SVGGraphicsElement).getBBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  } catch {
    return null;
  }
}

function viewBoxBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  }
  const w = Number(svg.getAttribute("width")) || 1000;
  const h = Number(svg.getAttribute("height")) || 1000;
  return { x: 0, y: 0, w, h };
}

/** Sheet chrome (grid / frame / margins) — never use as pin host. */
export function isServiceGraphic(el: Element, svg: SVGSVGElement): boolean {
  if (el.closest("g.pin-marker, g.ewd-ping-marker")) return true;

  let n: Element | null = el;
  while (n && n !== svg) {
    const id = n.getAttribute("id") || "";
    const cls = n.getAttribute("class") || "";
    const desc = n.tagName.toLowerCase() === "g" ? readDesc(n) : "";
    if (SERVICE_RE.test(`${id} ${cls} ${desc}`)) return true;
    n = n.parentElement;
  }

  const tag = el.tagName.toLowerCase();
  if (tag === "rect" || tag === "circle" || tag === "ellipse") return true;

  const fill = (el.getAttribute("fill") || "").trim().toLowerCase();
  if (fill && fill !== "none" && fill !== "transparent") return true;

  if (tag === "path" && /\bz\b/i.test(el.getAttribute("d") || "")) return true;

  try {
    const box = viewBoxBox(svg);
    const maxDim = Math.max(box.w, box.h);
    const margin = maxDim * 0.02;
    const b = (el as SVGGraphicsElement).getBBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const nearEdge =
      cx < box.x + margin ||
      cx > box.x + box.w - margin ||
      cy < box.y + margin ||
      cy > box.y + box.h - margin;
    if (nearEdge && Math.hypot(Math.abs(b.width), Math.abs(b.height)) < maxDim * 0.08) return true;
  } catch {
    /* ignore */
  }

  return false;
}

function isInteriorPoint(svg: SVGSVGElement, at: Pt): boolean {
  const box = viewBoxBox(svg);
  const maxDim = Math.max(box.w, box.h);
  const margin = maxDim * 0.025;
  return (
    at.x >= box.x + margin &&
    at.x <= box.x + box.w - margin &&
    at.y >= box.y + margin &&
    at.y <= box.y + box.h - margin
  );
}

type PinAnchor = { at: Pt; el: Element; score: number };

function labelMatchesConnector(nodes: Element[], index: number, codeN: string): boolean {
  if (!codeN) return false;
  const node = nodes[index];
  let t = normalizeCodeLabel(node.textContent || "").toUpperCase();
  if (t === codeN) return true;
  if (!t) return false;
  let joined = t;
  for (let j = index + 1; j < Math.min(index + 4, nodes.length); j++) {
    joined += normalizeCodeLabel(nodes[j].textContent || "").toUpperCase();
    if (joined === codeN) return true;
  }
  return false;
}

/**
 * True pin contact labels only — reject wire gauges (0,13), long ids (14014),
 * harness codes (K413, FOUR_C). Abstract: no hardcoded connector/pin literals.
 */
function isPinTerminalLabel(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  // Cross-section / decimal callouts
  if (/[,.]/.test(t)) return false;
  // Long numeric series (not a 1–3 digit pin)
  if (/^\d{4,}$/.test(t)) return false;
  // Alphanumeric wire/harness ids (except optional single letter pin suffix like 11A)
  if (/^[A-Z]{2,}_?[A-Z0-9]+$/i.test(t)) return false; // FOUR_C
  if (/^[A-Z]+\d+$/i.test(t) && !/^\d{1,3}[A-Z]$/i.test(t)) return false; // K413
  if (/^\d+[A-Z]{2,}$/i.test(t)) return false;
  return /^\d{1,3}[A-Z]?$/i.test(t);
}

/** Wire-callout text inside CAFConductor next to a color code — not a pin pad. */
function isConductorCalloutLabel(node: Element): boolean {
  let n: Element | null = node.parentElement;
  while (n) {
    if (n.tagName.toLowerCase() === "g" && /CAFConductor/i.test(readDesc(n))) {
      for (const sib of n.querySelectorAll("text, tspan")) {
        if (parseColorTokens(sib.textContent || "").length) return true;
      }
      return true; // any digit inside conductor group is suspect as pin
    }
    n = n.parentElement;
  }
  return false;
}

function countPinTerminalsIn(el: Element): number {
  let n = 0;
  for (const node of el.querySelectorAll("text, tspan")) {
    const t = String(node.textContent || "").trim();
    if (!isPinTerminalLabel(t)) continue;
    if (isConductorCalloutLabel(node)) continue;
    n++;
  }
  return n;
}

function countConductorGroupsIn(el: Element): number {
  let n = 0;
  for (const g of el.querySelectorAll("g")) {
    if (/CAFConductor/i.test(readDesc(g))) n++;
  }
  return n;
}

function elementArea(el: Element): number {
  try {
    const b = (el as SVGGraphicsElement).getBBox();
    return Math.max(1, Math.abs(b.width) * Math.abs(b.height));
  } catch {
    return 1e15;
  }
}

/**
 * Best non-service <g> ancestor for a connector label.
 * Prefer the TIGHTEST housing (smallest area) that still has pin pads —
 * never a sheet-level parent that also contains foreign modules.
 */
function pickConnectorScopeGroup(textNode: Element, svg: SVGSVGElement): Element {
  const chain: Element[] = [];
  let n: Element | null = textNode.parentElement;
  while (n && n !== svg) {
    if (n.tagName.toLowerCase() === "g" && !isServiceGraphic(n, svg)) chain.push(n);
    n = n.parentElement;
  }
  if (!chain.length) return textNode.parentElement || textNode;

  // Closest parents first; keep only compact housings (pins present, few conductors).
  const withPins = chain.filter((g) => {
    const pins = countPinTerminalsIn(g);
    if (pins <= 0) return false;
    const conductors = countConductorGroupsIn(g);
    // Reject wire-forest / sheet blobs that swallow many modules
    return conductors <= Math.max(8, pins * 2);
  });
  const pool = withPins.length ? withPins : chain;

  let best = pool[0];
  let bestScore = -Infinity;
  for (const g of pool) {
    const pins = countPinTerminalsIn(g);
    const conductors = countConductorGroupsIn(g);
    const area = elementArea(g);
    // Density wins: many pins in a SMALL box. Absolute pin count must NOT promote ancestors.
    const density = pins / Math.max(Math.log10(area + 10), 1);
    const score = density * 1e6 - conductors * 2e5 - Math.log10(area + 10) * 5e4;
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return best;
}

/** Volvo FAMILY/ID label centers inside a scope (abstract — no hardcoded codes). */
function collectCodeLabelAnchors(scope: Element, svg: SVGSVGElement): Array<{ code: string; at: Pt }> {
  const nodes = [...scope.querySelectorAll("text, tspan")];
  const out: Array<{ code: string; at: Pt }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isServiceGraphic(node, svg)) continue;
    let joined = normalizeCodeLabel(node.textContent || "").toUpperCase();
    const tryPush = (code: string) => {
      if (!/^\d+\/\d+$/.test(code) || seen.has(`${code}@${i}`)) return;
      const at = textCenter(node);
      if (!at) return;
      seen.add(`${code}@${i}`);
      out.push({ code, at });
    };
    tryPush(joined);
    for (let j = i + 1; j < Math.min(i + 4, nodes.length); j++) {
      joined += normalizeCodeLabel(nodes[j].textContent || "").toUpperCase();
      tryPush(joined);
    }
  }
  return out;
}

/**
 * Pin belongs to connectorCode when it is closer to that connector's label
 * than to any other FAMILY/ID label in the same scope (blocks foreign "4" on 4/xxx).
 */
function pinOwnedByConnector(
  pinAt: Pt,
  scope: Element,
  connectorCode: string,
  svg: SVGSVGElement,
): boolean {
  const codeN = normalizeCodeLabel(connectorCode).toUpperCase();
  if (!codeN) return false;
  const labels = collectCodeLabelAnchors(scope, svg);
  const ours = labels.filter((l) => l.code === codeN);
  if (!ours.length) return false;
  const distOurs = Math.min(...ours.map((l) => dist(pinAt, l.at)));
  const foreign = labels.filter((l) => l.code !== codeN);
  if (!foreign.length) return true;
  const distForeign = Math.min(...foreign.map((l) => dist(pinAt, l.at)));
  // Strict: must be nearer (or equal) to our connector than to any foreign module/connector
  return distOurs <= distForeign * 1.05;
}

/**
 * Vector groups belonging strictly to connectorCode.
 * When connectorCode is set, systemUid MUST NOT widen scopes (prevents foreign module pins).
 */
function findConnectorScopes(
  root: Element,
  svg: SVGSVGElement,
  connectorCode: string,
  systemUid: string,
): Element[] {
  const codeN = normalizeCodeLabel(connectorCode).toUpperCase();
  const candidates: Element[] = [];
  const seen = new Set<Element>();

  const add = (el: Element | null) => {
    if (!el || seen.has(el) || isServiceGraphic(el, svg)) return;
    seen.add(el);
    candidates.push(el);
  };

  if (codeN) {
    const nodes = [...root.querySelectorAll("text, tspan")];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (isServiceGraphic(node, svg)) continue;
      if (!labelMatchesConnector(nodes, i, codeN)) continue;
      add(pickConnectorScopeGroup(node, svg));
    }
  } else if (systemUid) {
    // Soft fallback only when no connector code — never mix with connector scopes
    for (const g of root.querySelectorAll("g")) {
      const desc = readDesc(g);
      if (!desc.includes(systemUid) || isServiceGraphic(g, svg)) continue;
      add(g);
    }
  }

  if (candidates.length <= 1) return candidates;

  // Prefer compact scopes (smallest area among those with pins)
  const ranked = [...candidates].sort((a, b) => {
    const aa = elementArea(a);
    const ab = elementArea(b);
    const pa = countPinTerminalsIn(a);
    const pb = countPinTerminalsIn(b);
    const ca = countConductorGroupsIn(a);
    const cb = countConductorGroupsIn(b);
    return aa - ab || ca - cb || pb - pa;
  });

  const best = ranked[0];
  const bestArea = elementArea(best);
  // Keep only scopes not vastly larger than the tightest housing — no pin-count escape hatch
  return ranked.filter((el) => elementArea(el) <= bestArea * 3);
}

/**
 * Pin digit texts ONLY inside connector scopes, owned by connectorCode.
 * Never grab the same digit from a foreign module/connector in an oversized parent.
 */
function resolvePinDigitAnchorsInScopes(
  scopes: Element[],
  svg: SVGSVGElement,
  pinNumber: string,
  connectorCode = "",
): PinAnchor[] {
  const pinStr = String(pinNumber || "").trim();
  if (!pinStr || !isPinTerminalLabel(pinStr) || !scopes.length) return [];
  const codeN = normalizeCodeLabel(connectorCode).toUpperCase();

  const anchors: PinAnchor[] = [];
  for (const scope of scopes) {
    for (const node of scope.querySelectorAll("text, tspan")) {
      if (isServiceGraphic(node, svg)) continue;
      const t = String(node.textContent || "").trim();
      if (t !== pinStr && t !== pinStr.toUpperCase()) continue;
      if (!isPinTerminalLabel(t)) continue;
      if (isConductorCalloutLabel(node)) continue;
      const at = textCenter(node);
      if (!at || !isInteriorPoint(svg, at)) continue;
      // Ownership gate: pin must belong to the target connector, not a sibling module
      if (codeN && !pinOwnedByConnector(at, scope, codeN, svg)) continue;
      anchors.push({ at, el: node, score: 0 });
    }
  }
  // Prefer pins closer to the target connector label, then scope center
  anchors.sort((a, b) => {
    const scopeA = scopes.find((s) => s.contains(a.el)) || a.el;
    const scopeB = scopes.find((s) => s.contains(b.el)) || b.el;
    if (codeN) {
      const labelsA = collectCodeLabelAnchors(scopeA, svg).filter((l) => l.code === codeN);
      const labelsB = collectCodeLabelAnchors(scopeB, svg).filter((l) => l.code === codeN);
      if (labelsA.length && labelsB.length) {
        const da = Math.min(...labelsA.map((l) => dist(a.at, l.at)));
        const db = Math.min(...labelsB.map((l) => dist(b.at, l.at)));
        if (da !== db) return da - db;
      }
    }
    let ca = a.at;
    let cb = b.at;
    try {
      const ba = (scopeA as SVGGraphicsElement).getBBox();
      ca = { x: ba.x + ba.width / 2, y: ba.y + ba.height / 2 };
    } catch {
      /* ignore */
    }
    try {
      const bb = (scopeB as SVGGraphicsElement).getBBox();
      cb = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
    } catch {
      /* ignore */
    }
    return dist(a.at, ca) - dist(b.at, cb);
  });
  return anchors;
}

function wireEndpoints(el: Element): Pt[] {
  try {
    const geom = el as SVGPathElement;
    if (typeof geom.getTotalLength === "function" && typeof geom.getPointAtLength === "function") {
      const total = geom.getTotalLength();
      if (!(total > 0)) return [];
      const p0 = geom.getPointAtLength(0);
      const p1 = geom.getPointAtLength(total);
      return [
        { x: p0.x, y: p0.y },
        { x: p1.x, y: p1.y },
      ];
    }
    const b = (el as SVGGraphicsElement).getBBox();
    return [
      { x: b.x, y: b.y + b.height / 2 },
      { x: b.x + b.width, y: b.y + b.height / 2 },
    ];
  } catch {
    return [];
  }
}

function strokeLength(el: Element): number {
  try {
    const geom = el as SVGPathElement;
    if (typeof geom.getTotalLength === "function") {
      const len = geom.getTotalLength();
      if (len > 0) return len;
    }
    const b = (el as SVGGraphicsElement).getBBox();
    return Math.hypot(Math.abs(b.width), Math.abs(b.height));
  } catch {
    return 0;
  }
}

function inConductorGroup(el: Element): boolean {
  let n: Element | null = el.parentElement;
  while (n) {
    if (n.tagName.toLowerCase() === "g" && /CAFConductor/i.test(readDesc(n))) return true;
    n = n.parentElement;
  }
  return false;
}

function isLikelyWireStroke(el: Element, svg: SVGSVGElement, maxDim: number): boolean {
  if (el.closest("g.pin-marker, g.ewd-ping-marker")) return false;
  const tag = el.tagName.toLowerCase();
  if (tag !== "path" && tag !== "polyline" && tag !== "line") return false;
  const fill = (el.getAttribute("fill") || "").trim().toLowerCase();
  if (fill && fill !== "none" && fill !== "transparent") return false;
  if (tag === "path" && /\bz\b/i.test(el.getAttribute("d") || "")) return false;
  const inConductor = inConductorGroup(el);
  try {
    const b = (el as SVGGraphicsElement).getBBox();
    const w = Math.abs(b.width);
    const h = Math.abs(b.height);
    const mn = Math.min(w, h);
    const mx = Math.max(w, h);
    const len = strokeLength(el);
    if (len < Math.max(40, maxDim * 0.002) && mx < Math.max(40, maxDim * 0.002)) return false;
    if (!inConductor && mn > maxDim * 0.002 && mx / (mn + 0.01) < 6) return false;
    return true;
  } catch {
    return inConductor;
  }
}

function scopeBBoxes(scopes: Element[]): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const s of scopes) {
    try {
      const b = (s as SVGGraphicsElement).getBBox();
      if (b.width > 0 && b.height > 0) out.push({ x: b.x, y: b.y, w: b.width, h: b.height });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function nearAnyScope(at: Pt, boxes: Array<{ x: number; y: number; w: number; h: number }>, pad: number): boolean {
  if (!boxes.length) return true;
  for (const b of boxes) {
    if (
      at.x >= b.x - pad &&
      at.x <= b.x + b.w + pad &&
      at.y >= b.y - pad &&
      at.y <= b.y + b.h + pad
    ) {
      return true;
    }
  }
  return false;
}

function parseColorTokens(text: string): string[] {
  const raw = String(text || "").toUpperCase();
  if (!raw.trim()) return [];
  const out: string[] = [];
  const pairRe = /\b([A-Z]{2,3})[/-]([A-Z]{2,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(raw))) {
    if (!WIRE_COLOR_CODES.has(m[1]) || !WIRE_COLOR_CODES.has(m[2])) continue;
    out.push(normalizeWireColorKey(`${m[1]}-${m[2]}`));
  }
  if (out.length) return [...new Set(out)];
  const singleRe = /\b([A-Z]{2,3})\b/g;
  while ((m = singleRe.exec(raw))) {
    if (!WIRE_COLOR_CODES.has(m[1])) continue;
    out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Nearest Volvo color label along a stroke (payload-driven, no hardcoded pins). */
function nearestColorOnStroke(
  root: Element,
  svg: SVGSVGElement,
  el: Element,
  maxDim: number,
): string | null {
  // Strong signal: color text inside the same CAFConductor <g> as the stroke
  let n: Element | null = el.parentElement;
  while (n && n !== root && n !== svg) {
    if (n.tagName.toLowerCase() === "g" && /CAFConductor/i.test(readDesc(n))) {
      const groupCols: string[] = [];
      for (const node of n.querySelectorAll("text, tspan")) {
        groupCols.push(...parseColorTokens(node.textContent || ""));
      }
      const uniq = [...new Set(groupCols)];
      if (uniq.length === 1) return uniq[0];
      if (uniq.length > 1) {
        // Prefer dual codes (BN-BU) over single (BK) when both present
        const dual = uniq.find((c) => c.includes("-"));
        if (dual) return dual;
        return uniq[0];
      }
      break;
    }
    n = n.parentElement;
  }

  const radius = Math.max(180, maxDim * 0.008);
  type Hit = { color: string; d: number };
  const hits: Hit[] = [];
  const samples: Pt[] = [...wireEndpoints(el)];
  try {
    const geom = el as SVGPathElement;
    if (typeof geom.getTotalLength === "function" && typeof geom.getPointAtLength === "function") {
      const total = geom.getTotalLength();
      if (total > 0) {
        for (const t of [0.15, 0.35, 0.5, 0.65, 0.85]) {
          const p = geom.getPointAtLength(total * t);
          samples.push({ x: p.x, y: p.y });
        }
      }
    } else {
      const b = (el as SVGGraphicsElement).getBBox();
      samples.push(
        { x: b.x + b.width * 0.25, y: b.y + b.height / 2 },
        { x: b.x + b.width * 0.5, y: b.y + b.height / 2 },
        { x: b.x + b.width * 0.75, y: b.y + b.height / 2 },
      );
    }
  } catch {
    /* ignore */
  }

  for (const node of root.querySelectorAll("text, tspan")) {
    const colors = parseColorTokens(node.textContent || "");
    if (!colors.length) continue;
    const c = textCenter(node);
    if (!c) continue;
    let best = Infinity;
    for (const s of samples) best = Math.min(best, dist(s, c));
    if (best <= radius) {
      for (const color of colors) hits.push({ color, d: best });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.d - b.d);
  return hits[0].color;
}

/**
 * Nearest wire endpoint to pin digit within connector scope.
 * When wireColor is set: prefer strokes whose SVG color label matches (BN-BU ≠ BK).
 * If no color-matched wire exists, return null so caller falls back to pin digit.
 */
function nearestWireEndpointNear(
  root: Element,
  svg: SVGSVGElement,
  pinAt: Pt,
  maxDim: number,
  scopes: Element[],
  wireColor = "",
): Pt | null {
  const threshold = Math.max(280, maxDim * 0.022);
  const boxes = scopeBBoxes(scopes);
  const pad = Math.max(400, maxDim * 0.03);
  const want = normalizeWireColorKey(wireColor);

  type Cand = { at: Pt; d: number; colorOk: boolean };
  const cands: Cand[] = [];

  for (const el of root.querySelectorAll("path, polyline, line")) {
    if (!isLikelyWireStroke(el, svg, maxDim)) continue;
    const strokeColor = want ? nearestColorOnStroke(root, svg, el, maxDim) : null;
    const colorOk = !want || strokeColor === want;
    // Reject proven wrong colors (e.g. BK when card is BN-BU)
    if (want && strokeColor && strokeColor !== want) continue;

    for (const end of wireEndpoints(el)) {
      if (!nearAnyScope(end, boxes, pad) && !nearAnyScope(pinAt, boxes, pad)) continue;
      const d = dist(end, pinAt);
      if (d <= threshold) cands.push({ at: end, d, colorOk });
    }
  }

  if (!cands.length) return null;
  // Prefer color-proven matches, then closest endpoint
  const proven = cands.filter((c) => c.colorOk && want);
  const pool = proven.length ? proven : want ? [] : cands;
  if (!pool.length) return null; // have wireColor but no matching branch — use pin digit
  pool.sort((a, b) => a.d - b.d);
  return pool[0].at;
}

/**
 * Connector housing frame / center — only real pin-terminal labels or scope bbox.
 * Never snaps to mid-sheet wire endpoints when pin digit is missing.
 */
function resolvePinFrameInScopes(
  _root: Element,
  svg: SVGSVGElement,
  scopes: Element[],
  targetPinAt: Pt | null,
  _maxDim: number,
): Pt | null {
  if (!scopes.length) return null;
  const digitPts: Pt[] = [];

  for (const scope of scopes) {
    for (const node of scope.querySelectorAll("text, tspan")) {
      if (isServiceGraphic(node, svg)) continue;
      const t = String(node.textContent || "").trim();
      if (!isPinTerminalLabel(t)) continue;
      if (isConductorCalloutLabel(node)) continue;
      const at = textCenter(node);
      if (!at || !isInteriorPoint(svg, at)) continue;
      digitPts.push(at);
    }
  }

  if (digitPts.length >= 1 || targetPinAt) {
    const pts = targetPinAt ? [...digitPts, targetPinAt] : digitPts;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return targetPinAt || { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  // No pin terminals in scope — geometric center of tightest connector bbox
  let best: Pt | null = null;
  let bestArea = Infinity;
  for (const scope of scopes) {
    try {
      const b = (scope as SVGGraphicsElement).getBBox();
      const area = Math.max(1, Math.abs(b.width) * Math.abs(b.height));
      const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (!isInteriorPoint(svg, at)) continue;
      if (area < bestArea) {
        bestArea = area;
        best = at;
      }
    } catch {
      /* ignore */
    }
  }
  return best;
}

function viewBoxCenter(svg: SVGSVGElement): Pt {
  const box = viewBoxBox(svg);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

type AnchorMode =
  | "pin-terminal"
  | "wire-entry"
  | "pin-frame"
  | "peer-terminal"
  | "peer-frame"
  | "viewbox-center";

type ResolveMeta = {
  at: Pt;
  mode: AnchorMode;
  hostGroup: Element | null;
  anchors: PinAnchor[];
  scopeCount: number;
  connectorScoped: boolean;
};

function resolveInsideScopes(
  root: Element,
  svg: SVGSVGElement,
  pinNumber: string,
  scopes: Element[],
  maxDim: number,
  modePin: AnchorMode,
  modeWire: AnchorMode,
  modeFrame: AnchorMode,
  wireColor = "",
  /** When true and pinNumber set: never fall back to connector frame center. */
  strictPin = false,
  /** Target connector — pins must be owned by this code, not foreign modules. */
  connectorCode = "",
): ResolveMeta | null {
  if (!scopes.length) return null;
  const anchors = resolvePinDigitAnchorsInScopes(scopes, svg, pinNumber, connectorCode);
  const pinDigit = anchors[0] || null;

  if (pinDigit) {
    // Wire-entry ONLY after a proven pin-terminal label in tight scope
    const wireEnd = nearestWireEndpointNear(
      root,
      svg,
      pinDigit.at,
      maxDim,
      scopes,
      wireColor,
    );
    if (wireEnd) {
      return {
        at: wireEnd,
        mode: modeWire,
        hostGroup: pinDigit.el.parentElement || null,
        anchors,
        scopeCount: scopes.length,
        connectorScoped: true,
      };
    }
    return {
      at: pinDigit.at,
      mode: modePin,
      hostGroup: pinDigit.el.parentElement || null,
      anchors,
      scopeCount: scopes.length,
      connectorScoped: true,
    };
  }

  // Strict pin: digit missing on this SVG — do not use frame/label center
  if (strictPin && pinNumber) return null;

  // Soft mode (no pin in card): connector bbox / pin-frame center
  const frameAt = resolvePinFrameInScopes(root, svg, scopes, null, maxDim);
  if (frameAt) {
    return {
      at: frameAt,
      mode: modeFrame,
      hostGroup: scopes[0] || null,
      anchors,
      scopeCount: scopes.length,
      connectorScoped: true,
    };
  }
  return null;
}

/**
 * Connector-Aware Pin Anchor Math:
 * [connectorCode] → scope group → pinNumber inside that group only.
 * With pinNumber set: only pin-terminal / wire-entry (never frame / viewBox).
 * Peer fallback if primary connector absent. Never grab foreign same-number pins.
 */
function resolveMarkerAnchor(
  root: Element,
  svg: SVGSVGElement,
  pinNumber: string,
  connectorCode: string,
  systemUid: string,
  peerCode: string,
  wireColor = "",
): ResolveMeta | null {
  const box = viewBoxBox(svg);
  const maxDim = Math.max(box.w, box.h, 1000);
  const strictPin = !!pinNumber;

  // Scoped search: localize connectorCode first; pin digits only inside that housing.
  const primaryScopes = findConnectorScopes(root, svg, connectorCode, systemUid);
  const primary = resolveInsideScopes(
    root,
    svg,
    pinNumber,
    primaryScopes,
    maxDim,
    "pin-terminal",
    "wire-entry",
    "pin-frame",
    wireColor,
    strictPin,
    connectorCode,
  );
  if (primary) return primary;

  const peerN = normalizeCodeLabel(peerCode);
  if (peerN && peerN.toUpperCase() !== normalizeCodeLabel(connectorCode).toUpperCase()) {
    const peerScopes = findConnectorScopes(root, svg, peerN, "");
    const peer = resolveInsideScopes(
      root,
      svg,
      pinNumber,
      peerScopes,
      maxDim,
      "peer-terminal",
      "peer-terminal",
      "peer-frame",
      wireColor,
      strictPin,
      peerN,
    );
    if (peer) return peer;
    // Soft mode only: peer frame without matching pin number
    if (!strictPin) {
      const peerFrame = resolvePinFrameInScopes(root, svg, peerScopes, null, maxDim);
      if (peerFrame) {
        return {
          at: peerFrame,
          mode: "peer-frame",
          hostGroup: null,
          anchors: [],
          scopeCount: peerScopes.length,
          connectorScoped: true,
        };
      }
    }
  }

  if (strictPin) return null;

  return {
    at: viewBoxCenter(svg),
    mode: "viewbox-center",
    hostGroup: null,
    anchors: [],
    scopeCount: primaryScopes.length,
    connectorScoped: false,
  };
}

function clearHighlights(root: Element, svg: SVGSVGElement): void {
  root.querySelectorAll(".ewd-highlight").forEach((el) => {
    el.classList.remove("ewd-highlight");
    const s = (el as SVGElement).style;
    s.removeProperty("stroke");
    s.removeProperty("fill");
    s.removeProperty("stroke-width");
    s.removeProperty("stroke-opacity");
    s.removeProperty("opacity");
    s.removeProperty("vector-effect");
  });
  svg.querySelectorAll("g.pin-marker, g.ewd-ping-marker").forEach((el) => el.remove());
}

/**
 * Keep pin markers at a fixed on-screen diameter (~23px) regardless of SVG zoom/viewBox.
 */
export function syncPinMarkerScreenSize(svg: SVGSVGElement): void {
  const markers = svg.querySelectorAll("g.pin-marker");
  for (const g of markers) {
    try {
      const ctm = (g as SVGGraphicsElement).getScreenCTM();
      const sx = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
      const scale = Math.max(sx, 1e-6);
      const rUser = MARKER_SCREEN_DIAMETER / 2 / scale;
      const fontUser = MARKER_SCREEN_FONT / scale;
      const halo = g.querySelector("circle.pin-marker-halo");
      const rings = g.querySelectorAll("circle.pin-marker-ring");
      // Halo slightly outside wire rings so white/light strokes stay readable
      if (halo) halo.setAttribute("r", String(rUser * 1.12));
      rings.forEach((circle) => circle.setAttribute("r", String(rUser)));
      const text = g.querySelector("text");
      if (text) text.setAttribute("font-size", String(fontUser));
    } catch {
      /* ignore */
    }
  }
}

function makeRing(
  NS: string,
  opts: {
    cls: string;
    r: string;
    fill: string;
    stroke: string;
    strokeWidth: string;
    dasharray?: string;
    dashoffset?: string;
  },
): SVGCircleElement {
  const circle = document.createElementNS(NS, "circle") as SVGCircleElement;
  circle.setAttribute("class", opts.cls);
  circle.setAttribute("r", opts.r);
  circle.setAttribute("fill", opts.fill);
  circle.setAttribute("stroke", opts.stroke);
  circle.setAttribute("stroke-width", opts.strokeWidth);
  circle.setAttribute("vector-effect", "non-scaling-stroke");
  if (opts.dasharray) circle.setAttribute("stroke-dasharray", opts.dasharray);
  if (opts.dashoffset) circle.setAttribute("stroke-dashoffset", opts.dashoffset);
  return circle;
}

/**
 * Inject one pin marker at SVG pin coordinates.
 * Fill: translucent brand green.
 * Stroke: wireColor from card — dual colors use striped dasharray (card-like).
 * Dark halo always present so WH / light strokes contrast on white SVG sheets.
 */
export function injectPinMarker(
  host: Element,
  at: Pt,
  label: string,
  wireColor = "",
  svg?: SVGSVGElement,
): Element {
  const NS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "pin-marker");
  g.setAttribute("data-testid", "ewd-pin-marker");
  g.setAttribute("data-wire-color", normalizeWireColorKey(wireColor) || "");
  g.setAttribute("transform", `translate(${at.x},${at.y})`);

  const border = wireBorderColors(wireColor);
  const ownerSvg =
    svg ||
    (host instanceof SVGSVGElement
      ? host
      : ((host as SVGElement).ownerSVGElement as SVGSVGElement | null));

  // Dark outer halo — keeps WH / YE / light dual stripes visible on white sheets
  g.appendChild(
    makeRing(NS, {
      cls: "pin-marker-halo",
      r: "13",
      fill: "none",
      stroke: "rgba(15, 23, 42, 0.85)",
      strokeWidth: "1.5",
    }),
  );

  if (border.length === 2) {
    // Striped dual border: solid base + dashed overlay (card badge stripe pattern)
    const dash = "4 4";
    g.appendChild(
      makeRing(NS, {
        cls: "pin-marker-ring",
        r: "11",
        fill: MARKER_FILL,
        stroke: border[0],
        strokeWidth: String(MARKER_STROKE_WIDTH_PX),
      }),
    );
    g.appendChild(
      makeRing(NS, {
        cls: "pin-marker-ring",
        r: "11",
        fill: "none",
        stroke: border[1],
        strokeWidth: String(MARKER_STROKE_WIDTH_PX),
        dasharray: dash,
        dashoffset: "0",
      }),
    );
  } else {
    g.appendChild(
      makeRing(NS, {
        cls: "pin-marker-ring",
        r: "11",
        fill: MARKER_FILL,
        stroke: border[0],
        strokeWidth: String(MARKER_STROKE_WIDTH_PX),
      }),
    );
  }

  const text = document.createElementNS(NS, "text");
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  text.setAttribute("dy", "0.35em");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "#0f172a");
  text.setAttribute("stroke", "none");
  text.setAttribute("font-size", String(MARKER_SCREEN_FONT));
  text.setAttribute("font-weight", "700");
  text.setAttribute("font-family", "ui-monospace, monospace");
  text.textContent = label;
  g.appendChild(text);

  host.appendChild(g);

  if (ownerSvg) syncPinMarkerScreenSize(ownerSvg);
  return g;
}

/**
 * Marker-anchor only.
 * With pinNumber: strict pin-terminal / wire-entry — never frame or viewBox center.
 * Without pinNumber: soft cascade including frame / viewBox.
 */
export function highlightTarget(
  root: Element,
  svg: SVGSVGElement,
  payload: HighlightTargetPayload,
): HighlightResult {
  // Safe empty: missing connector/pin/color → "" / undefined — never invent a connector number.
  const connectorCode = normalizeCodeLabel(payload.connectorCode ?? "");
  const pinNumber = String(payload.pinNumber ?? "").trim();
  const wireColor = normalizeWireColorKey(payload.wireColor ?? "");
  const systemUid = String(payload.systemUid || "").trim();
  const diagramUid = String(payload.diagramUid || "").trim();
  const peerCode = normalizeCodeLabel(payload.peerCode ?? "");
  const markerLabel = pinNumber || connectorCode || "?";
  const strictPin = !!pinNumber;

  let painted: Element[] = [];
  let hostGroup: Element | null = null;
  let markerAt: Pt | null = null;
  let stage: HighlightResult["stage"] = "marker-only";
  let reason = "";
  let anchors: PinAnchor[] = [];
  let anchorMode: AnchorMode = "viewbox-center";
  let scopeCount = 0;
  let connectorScoped = false;
  let errorMsg: string | undefined;
  let guaranteedMarker = false;

  const forceInject = (at: Pt, mode: AnchorMode): boolean => {
    markerAt = at;
    anchorMode = mode;
    try {
      svg.querySelectorAll("g.pin-marker, g.ewd-ping-marker").forEach((el) => el.remove());
    } catch {
      /* ignore */
    }
    try {
      injectPinMarker(svg, at, markerLabel, wireColor, svg);
      guaranteedMarker = svg.querySelectorAll("g.pin-marker").length > 0;
      return guaranteedMarker;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      return false;
    }
  };

  try {
    try {
      clearHighlights(root, svg);
    } catch {
      /* ignore */
    }

    const resolved = resolveMarkerAnchor(
      root,
      svg,
      pinNumber,
      connectorCode,
      systemUid,
      peerCode,
      wireColor,
    );

    if (!resolved) {
      reason = `pin-miss pin=${pinNumber || "—"} code=${connectorCode || "—"} — no terminal on this SVG`;
      stage = "none";
      anchorMode = "viewbox-center";
      connectorScoped = false;
    } else {
      anchors = resolved.anchors;
      hostGroup = resolved.hostGroup;
      scopeCount = resolved.scopeCount;
      connectorScoped = resolved.connectorScoped;
      reason = `Marker-anchor mode=${resolved.mode} pin=${pinNumber || "—"} code=${connectorCode || "—"} scopes=${scopeCount}`;

      const softModes: AnchorMode[] = ["pin-frame", "peer-frame", "viewbox-center"];
      if (strictPin && softModes.includes(resolved.mode)) {
        reason = `pin-miss mode=${resolved.mode} rejected under strict pin`;
        stage = "none";
        markerAt = null;
        guaranteedMarker = false;
      } else if (!forceInject(resolved.at, resolved.mode)) {
        if (strictPin) {
          reason += " | pin-miss inject failed";
          stage = "none";
          markerAt = null;
        } else {
          reason += " | retry viewbox-center";
          forceInject(viewBoxCenter(svg), "viewbox-center");
          connectorScoped = false;
          stage = guaranteedMarker ? "marker-only" : "none";
        }
      } else {
        stage = guaranteedMarker ? "marker-only" : "none";
      }
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    reason = `error: ${errorMsg}`;
    painted = [];
    try {
      clearHighlights(root, svg);
    } catch {
      /* ignore */
    }
    if (!strictPin) {
      try {
        const resolved = resolveMarkerAnchor(
          root,
          svg,
          pinNumber,
          connectorCode,
          systemUid,
          peerCode,
          wireColor,
        );
        if (resolved && forceInject(resolved.at, resolved.mode)) {
          anchors = resolved.anchors;
          scopeCount = resolved.scopeCount;
          connectorScoped = resolved.connectorScoped;
          reason += ` | fail-safe mode=${anchorMode}`;
        } else if (forceInject(viewBoxCenter(svg), "viewbox-center")) {
          connectorScoped = false;
          reason += " | fail-safe viewbox-center";
        }
      } catch {
        /* ignore */
      }
    } else {
      reason += " | pin-miss (strict, no fail-safe)";
      markerAt = null;
      guaranteedMarker = false;
    }
    stage = guaranteedMarker ? "marker-only" : "none";
  }

  console.log("[EWD Dynamic Trace]", {
    targetPin: payload.pinNumber,
    targetColor: payload.wireColor,
    connectorCode: payload.connectorCode,
    peerCode: peerCode || undefined,
    matchedSegmentsCount: 0,
    stage,
    reason,
    anchorMode,
    scopeCount,
    connectorScoped,
    guaranteedMarker,
    lineHighlight: false,
    colorGate: "marker-border",
    painted: false,
    error: errorMsg,
    diagramUid: diagramUid || undefined,
    systemUid: systemUid || undefined,
  });

  return {
    painted,
    hostGroup,
    markerAt: guaranteedMarker ? markerAt : null,
    markerLabel,
    stage,
    reason,
    debug: {
      connectorCode,
      pinNumber,
      wireColor,
      peerCode: peerCode || undefined,
      matchedSegmentsCount: 0,
      stage,
      reason,
      anchors: anchors.length,
      anchorMode,
      scopeCount,
      connectorScoped,
      guaranteedMarker,
      lineHighlight: false,
      colorGate: "marker-border",
      painted: false,
      error: errorMsg,
    },
  };
}

/**
 * @deprecated Thin adapter — prefer highlightTarget with HighlightTargetPayload.
 */
export function applyStrictWireHighlight(
  root: Element,
  svg: SVGSVGElement,
  focus: HighlightFocus,
): HighlightResult {
  return highlightTarget(root, svg, {
    connectorCode: focus.searchCode || "",
    pinNumber: focus.pin || "",
    wireColor: focus.wireColor || "",
    systemUid: focus.resolveUids?.[0],
    peerCode: focus.peerCode || "",
  });
}
