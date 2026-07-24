/**
 * Enrich Capital bare endpoint labels (CODE:PIN) with Russian component names.
 */

const BARE_DETAIL_RE = /^(\d+\/\d+)\s*:\s*([0-9A-Za-z./-]+)\s*$/;

/** True when detail is bare `74/508:2` (no em-dash name suffix). */
export function isBareCodePinDetail(detail: string | null | undefined): boolean {
  const s = String(detail || "").trim();
  if (!s || s.includes("—") || s.includes(" – ") || s.includes(" - ")) return false;
  return BARE_DETAIL_RE.test(s);
}

/**
 * `74/508:2` + name map → `74/508:2 — Разъём …`
 * Leaves already-rich or non-matching strings unchanged.
 */
export function enrichDetailWithName(
  detail: string | null | undefined,
  nameByCode?: Map<string, string> | null,
): string {
  const s = String(detail || "").trim();
  if (!s || !nameByCode?.size) return s;
  if (!isBareCodePinDetail(s)) return s;
  const m = s.match(BARE_DETAIL_RE);
  if (!m) return s;
  const code = m[1];
  const name = String(nameByCode.get(code) || "").trim();
  if (!name) return s;
  return `${code}:${m[2]} — ${name}`;
}

/** Extract Volvo code from bare or rich detail. */
export function codeFromDetail(detail: string | null | undefined): string {
  const s = String(detail || "").trim();
  const m = s.match(/(\d+\/\d+)/);
  return m ? m[1] : "";
}
