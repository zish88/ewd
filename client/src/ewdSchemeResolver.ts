/**
 * Weighted SVG page picker for EWD diagrams.
 * Prefer net ownership (pin/wire/peer UIDs on sheet) when provided by the server;
 * fall back to co-presence of circuit codes — never hardcodes node literals.
 */

export type SchemeCardLike = {
  from_node?: string | null;
  to_node?: string | null;
  via_node?: string | null;
  via_code?: string | null;
  from_detail?: string | null;
  to_detail?: string | null;
  source_code?: string | null;
  destination_code?: string | null;
  search_target?: string | null;
};

export type SchemeDiagramLike = {
  diagramUid: string;
  title?: string;
  textCodes?: string[];
  designFolder?: string;
  systemName?: string;
  pathCount?: number;
  /** Optional net-ownership hints from /api/ewd/pick-diagram or pin_wire_index */
  wireHits?: number;
  pinHits?: number;
  onSheetUidCount?: number;
};

export type SchemeContext = {
  selectedCode: string;
  fromCode: string;
  toCode: string;
  viaCode: string;
  peerCode: string;
};

export type RankedDiagram<T extends SchemeDiagramLike = SchemeDiagramLike> = {
  diagram: T;
  score: number;
  hits: number;
};

const SCORE_MODULE_AND_JUNCTION = 100;
const SCORE_ACTIVE_MODULE = 50;

/** Normalize Volvo component code to FAMILY/ID (strips :pin, unicode slashes). */
export function normalizeSchemeCode(raw: string | undefined | null): string {
  const s = String(raw || "")
    .replace(/\u2044/g, "/")
    .replace(/\u2215/g, "/")
    .replace(/\s+/g, "")
    .trim();
  const m = s.match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}`.toUpperCase() : s.toUpperCase();
}

function familyPrefix(code: string): number | null {
  const m = /^(\d+)\//.exec(normalizeSchemeCode(code));
  if (!m) return null;
  return Number(m[1]);
}

/** Active control / actuator modules (Volvo families 3, 4, 20). */
export function isActiveModuleCode(code: string): boolean {
  const fam = familyPrefix(code);
  return fam === 3 || fam === 4 || fam === 20;
}

/** Splice / intermediate harness connector (families 73 and 74). */
export function isJunctionCode(code: string): boolean {
  const fam = familyPrefix(code);
  return fam === 73 || fam === 74;
}

function collectCodes(...raws: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raws) {
    const c = normalizeSchemeCode(r);
    if (!c || !c.includes("/") || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Peer on the other end of the card relative to selectedCode. */
export function peerCodeFromSchemeCard(card: SchemeCardLike, selectedCode: string): string {
  const selected = normalizeSchemeCode(selectedCode);
  const detailPeers = collectCodes(card.from_detail, card.to_detail).filter((c) => c !== selected);
  if (detailPeers.length) return detailPeers[0];
  const candidates = collectCodes(
    card.to_node,
    card.from_node,
    card.destination_code,
    card.source_code,
    card.search_target,
  ).filter((c) => c !== selected);
  return candidates[0] || "";
}

/**
 * Pin cavity belonging to `code` inside a free-text detail
 * (`3/126C1:2`, `74/507:21`, `3A/65:4` …).
 * Systemic: card.pin_number is often the junction cavity while the open sheet is a module.
 */
export function pinForCodeInText(text: string | null | undefined, code: string): string {
  const codeN = normalizeSchemeCode(code);
  const raw = String(text || "");
  if (!codeN || !raw) return "";
  const esc = codeN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^\\dA-Z/])${esc}(?:C\\d+)?\\s*:\\s*([0-9A-Z]{1,4})\\b`, "i");
  const m = raw.match(re);
  return m?.[1] ? String(m[1]).trim() : "";
}

export type ResolvedHighlightPin = {
  /** Best pin to search on the currently selected node's sheet. */
  pin: string;
  /** Ordered candidates (selected-side detail pin first, then card pin, then peer-side). */
  pinCandidates: string[];
  pinFrom: string;
  pinTo: string;
  peerCode: string;
};

/**
 * Resolve which digit to hunt on the SVG for `selectedCode`.
 * Prefer the cavity next to that code in from/to details over raw card.pin_number.
 */
export function resolveHighlightPin(
  card: SchemeCardLike | null | undefined,
  selectedCode: string,
  cardPin = "",
): ResolvedHighlightPin {
  const selected = normalizeSchemeCode(selectedCode);
  const peerCode = card ? peerCodeFromSchemeCard(card, selected) : "";
  const fromDetail = String(card?.from_detail || "");
  const toDetail = String(card?.to_detail || "");
  const pinOnSelectedFrom = pinForCodeInText(fromDetail, selected);
  const pinOnSelectedTo = pinForCodeInText(toDetail, selected);
  const pinSelected = pinOnSelectedFrom || pinOnSelectedTo;
  const pinFrom =
    pinForCodeInText(fromDetail, collectCodes(fromDetail)[0] || "") || pinOnSelectedFrom;
  const pinTo = pinForCodeInText(toDetail, collectCodes(toDetail)[0] || "") || pinOnSelectedTo;
  const peerPin = peerCode
    ? pinForCodeInText(fromDetail, peerCode) || pinForCodeInText(toDetail, peerCode)
    : "";
  const fallback = String(cardPin || "").trim();
  const pinCandidates = [pinSelected, fallback, peerPin, pinFrom, pinTo]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .filter((p, i, arr) => arr.indexOf(p) === i);
  return {
    pin: pinCandidates[0] || fallback,
    pinCandidates,
    pinFrom: pinFrom || pinOnSelectedFrom || "",
    pinTo: pinTo || pinOnSelectedTo || "",
    peerCode,
  };
}

export function extractSchemeContext(
  card: SchemeCardLike | null | undefined,
  selectedCode: string,
): SchemeContext {
  const selected = normalizeSchemeCode(selectedCode);
  if (!card) {
    return { selectedCode: selected, fromCode: "", toCode: "", viaCode: "", peerCode: "" };
  }

  const fromCode =
    collectCodes(card.from_detail, card.from_node, card.source_code)[0] || "";
  const toCode =
    collectCodes(card.to_detail, card.to_node, card.destination_code)[0] || "";
  const viaCode = collectCodes(card.via_code, card.via_node)[0] || "";
  const peerCode = peerCodeFromSchemeCard(card, selected);

  return {
    selectedCode: selected,
    fromCode,
    toCode,
    viaCode,
    peerCode,
  };
}

export function diagramCodeSet(diagram: SchemeDiagramLike): Set<string> {
  const set = new Set<string>();
  for (const t of diagram.textCodes || []) {
    const c = normalizeSchemeCode(t);
    if (c) set.add(c);
  }
  return set;
}

export function diagramHasCode(diagram: SchemeDiagramLike, code: string): boolean {
  const want = normalizeSchemeCode(code);
  if (!want) return false;
  return diagramCodeSet(diagram).has(want);
}

function contextCodes(ctx: SchemeContext): string[] {
  return collectCodes(ctx.selectedCode, ctx.fromCode, ctx.toCode, ctx.viaCode, ctx.peerCode);
}

function countHits(page: Set<string>, codes: string[]): number {
  let n = 0;
  for (const c of codes) if (page.has(c)) n++;
  return n;
}

function anyOnPage(page: Set<string>, codes: string[]): boolean {
  return codes.some((c) => page.has(c));
}

/**
 * Weighted page match (abstract families only — no node literals):
 * 100 — functional module from context AND junction/connector from context
 * 50  — functional module present; target junction absent (transit)
 * 0   — junction-only / no active module from context (blacklist)
 */
/** Bonus when server reports wire/pin UIDs present on this sheet (VIDA net ownership). */
const SCORE_NET_WIRE = 200;
const SCORE_NET_PIN = 150;

export function scoreDiagramForContext(diagram: SchemeDiagramLike, ctx: SchemeContext): number {
  const wireHits = Number(diagram.wireHits) || 0;
  const pinHits = Number(diagram.pinHits) || 0;
  const onSheet = Number(diagram.onSheetUidCount) || wireHits + pinHits;
  if (wireHits > 0) return SCORE_NET_WIRE + Math.min(wireHits, 9);
  if (pinHits > 0 || onSheet > 0) return SCORE_NET_PIN + Math.min(onSheet, 9);

  const page = diagramCodeSet(diagram);
  if (!page.size) return 0;

  const codes = contextCodes(ctx);
  const functionalCodes = codes.filter(isActiveModuleCode);
  const junctionCodes = codes.filter(isJunctionCode);

  const hasFunctional = anyOnPage(page, functionalCodes);
  const hasJunction = anyOnPage(page, junctionCodes);

  // Never award top score without a functional module from the card context.
  if (hasFunctional && hasJunction) return SCORE_MODULE_AND_JUNCTION;
  if (hasFunctional) return SCORE_ACTIVE_MODULE;

  // Junction-only (or any overlap without active modules) → strict zero.
  return 0;
}

function compareRanked<T extends SchemeDiagramLike>(a: RankedDiagram<T>, b: RankedDiagram<T>): number {
  return (
    b.score - a.score ||
    (Number(b.diagram.wireHits) || 0) - (Number(a.diagram.wireHits) || 0) ||
    (Number(b.diagram.onSheetUidCount) || 0) - (Number(a.diagram.onSheetUidCount) || 0) ||
    b.hits - a.hits ||
    (b.diagram.pathCount || 0) - (a.diagram.pathCount || 0) ||
    String(a.diagram.diagramUid).localeCompare(String(b.diagram.diagramUid))
  );
}

export function rankDiagramsForContext<T extends SchemeDiagramLike>(
  diagrams: T[],
  ctx: SchemeContext,
): RankedDiagram<T>[] {
  const codes = contextCodes(ctx);
  const ranked = diagrams.map((diagram) => ({
    diagram,
    score: scoreDiagramForContext(diagram, ctx),
    hits: countHits(diagramCodeSet(diagram), codes),
  }));
  ranked.sort(compareRanked);
  return ranked;
}

export function pickBestDiagram<T extends SchemeDiagramLike>(
  diagrams: T[],
  ctx: SchemeContext,
): { diagram: T | null; score: number; ranked: RankedDiagram<T>[] } {
  if (!diagrams.length) return { diagram: null, score: 0, ranked: [] };
  const ranked = rankDiagramsForContext(diagrams, ctx);
  const best = ranked[0];
  if (best && best.score > 0) {
    return { diagram: best.diagram, score: best.score, ranked };
  }
  // No score>0 match — do not promote junction-only / unrelated dense sheets.
  return { diagram: null, score: 0, ranked };
}

/**
 * Candidate sheets to probe for a pin marker.
 * Includes score-0 pages that still draw `selectedCode` (junction pinouts) —
 * those are blacklisted by pickBestDiagram but often have the cavity digits.
 */
export function diagramsForPinProbe<T extends SchemeDiagramLike>(
  diagrams: T[],
  ctx: SchemeContext,
  limit = 18,
): RankedDiagram<T>[] {
  const ranked = rankDiagramsForContext(diagrams, ctx);
  const selected = normalizeSchemeCode(ctx.selectedCode);
  const withCode = ranked.filter((r) => diagramHasCode(r.diagram, selected));
  // Prefer scored circuit pages, then selected-code-only sheets (lower pathCount first).
  const scored = withCode.filter((r) => r.score > 0);
  const codeOnly = withCode
    .filter((r) => r.score <= 0)
    .sort(
      (a, b) =>
        (a.diagram.pathCount || 0) - (b.diagram.pathCount || 0) ||
        String(a.diagram.diagramUid).localeCompare(String(b.diagram.diagramUid)),
    );
  return [...scored, ...codeOnly].slice(0, Math.max(1, limit));
}
