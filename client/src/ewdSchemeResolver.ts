/**
 * Weighted SVG page picker for EWD diagrams.
 * Scores by co-presence of circuit codes on a sheet — never hardcodes node literals.
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
export function scoreDiagramForContext(diagram: SchemeDiagramLike, ctx: SchemeContext): number {
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
