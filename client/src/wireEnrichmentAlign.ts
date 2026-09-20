/**
 * Client-side plain/purpose from card ends (same rules as server/wireEnrichment).
 * Used after mergeEwdEndpoints so enrichment stays aligned with Откуда/Куда.
 */

const DETAIL_RE =
  /^(\d+\/\d+)\s*:\s*([0-9A-Za-z./-]+)\s*(?:[—–\-]\s*(.+))?$/u;

type Parsed = { code: string; pin: string; name: string };

function parseDetail(detail: string | null | undefined): Parsed | null {
  const s = String(detail || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  const m = s.match(DETAIL_RE);
  if (!m) return null;
  return { code: m[1], pin: m[2], name: String(m[3] || "").trim() };
}

function softDecap(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  if (/^[A-ZА-Я]{2,}/u.test(t) || /^\d/.test(t)) return t;
  return t.charAt(0).toLocaleLowerCase("ru") + t.slice(1);
}

function sideLabel(p: Parsed): string {
  if (p.name) return `${p.name} (${p.code}:${p.pin})`;
  return `${p.code}:${p.pin}`;
}

export function buildLiveEnrichmentPlain(
  fromDetail: string | null | undefined,
  toDetail: string | null | undefined,
  functionText?: string | null,
): { from_to_plain_ru?: string; purpose_ru?: string } {
  const from = parseDetail(fromDetail);
  const to = parseDetail(toDetail);
  const out: { from_to_plain_ru?: string; purpose_ru?: string } = {};

  if (from && to && (from.name || to.name)) {
    out.from_to_plain_ru = `От ${sideLabel(from)} к ${sideLabel(to)}`;
  }

  const ft = String(functionText || "")
    .replace(/\s+/g, " ")
    .trim();
  if (ft.length >= 8 && /[а-яё]/i.test(ft) && !/^[A-Z0-9_./\-]+$/.test(ft)) {
    out.purpose_ru = ft.length > 160 ? `${ft.slice(0, 157)}…` : ft;
  } else if (from?.name && to?.name) {
    const text = `Соединяет ${softDecap(from.name)} с ${softDecap(to.name)}`;
    out.purpose_ru = text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }

  return out;
}

/** Re-align enrichment to current from/to (keeps role_ru etc.). */
export function realignCardEnrichment<
  T extends {
    from_detail?: string;
    to_detail?: string;
    function_text?: string;
    enrichment?: {
      role_ru?: string;
      from_to_plain_ru?: string;
      purpose_ru?: string;
      confidence?: string;
      sources?: string[];
    };
  },
>(card: T): T {
  const live = buildLiveEnrichmentPlain(card.from_detail, card.to_detail, card.function_text);
  if (!live.from_to_plain_ru && !live.purpose_ru) return card;
  const prev = card.enrichment || {};
  return {
    ...card,
    enrichment: {
      ...prev,
      ...(live.from_to_plain_ru ? { from_to_plain_ru: live.from_to_plain_ru } : {}),
      ...(live.purpose_ru ? { purpose_ru: live.purpose_ru } : {}),
      sources: [...new Set([...(prev.sources || []), "live-card-ends"])],
    },
  };
}
