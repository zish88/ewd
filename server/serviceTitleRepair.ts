/**
 * Repair ServiceRep titles corrupted by Unicode +0x10 on Cyrillic
 * (Двигатель → Фтшурђхыќ). Balkan letters are the tell.
 */
const BALKAN_RE = /[ђћќљњџѓѕЂЋЌЉЊЏЃЅ]/;
const NUMERO_AS_R_RE =
  /(?<=[\u0400-\u04FF])№(?=[\u0400-\u04FF])|^№(?=[\u0400-\u04FF])|(?<=[\u0400-\u04FF])№(?=\s|[,./]|$)/g;

function shiftCyrillic(text: string, delta: number): string {
  let out = "";
  for (const ch of text) {
    const o = ch.codePointAt(0)!;
    if (o >= 0x0400 && o <= 0x04ff) {
      const n = o + delta;
      out += n >= 0x0400 && n <= 0x04ff ? String.fromCodePoint(n) : ch;
    } else {
      out += ch;
    }
  }
  return out;
}

function scoreTitle(s: string): number {
  const good = (s.match(/[А-Яа-яЁё]/g) || []).length;
  const bad = (s.match(BALKAN_RE) || []).length + (s.split("№").length - 1);
  return good - 3 * bad;
}

/** Fix garbled titles in-memory (safe no-op when not corrupted). */
export function repairServiceTitle(title: string | null | undefined): string {
  const text = String(title || "");
  if (!text || !BALKAN_RE.test(text)) return text;
  if ([...text].some((ch) => {
    const o = ch.codePointAt(0)!;
    return o < 32 && ch !== "\t" && ch !== "\n" && ch !== "\r";
  })) {
    return text;
  }
  const fixed = shiftCyrillic(text, -16).replace(NUMERO_AS_R_RE, "р");
  if (fixed === text) return text;
  return scoreTitle(fixed) > scoreTitle(text) ? fixed : text;
}

/**
 * Same +0x10 Cyrillic corruption often lives in document HTML bodies while titles
 * were already repaired. Only touch Cyrillic codepoints; ASCII tags/URLs stay intact.
 */
export function repairServiceHtml(html: string | null | undefined): string | null {
  if (html == null) return null;
  const text = String(html);
  if (!text || !BALKAN_RE.test(text)) return text;
  const fixed = shiftCyrillic(text, -16).replace(NUMERO_AS_R_RE, "р");
  if (fixed === text) return text;
  return scoreTitle(fixed) > scoreTitle(text) ? fixed : text;
}
