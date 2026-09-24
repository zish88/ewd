/** UI language: ru | en. Persisted in localStorage; optional ?lang= */
export type UiLang = "ru" | "en";

export const UI_LANG_KEY = "ewd_ui_lang";

export function isUiLang(v: unknown): v is UiLang {
  return v === "ru" || v === "en";
}

export function readStoredUiLang(): UiLang | null {
  try {
    const v = localStorage.getItem(UI_LANG_KEY);
    return isUiLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredUiLang(lang: UiLang): void {
  try {
    localStorage.setItem(UI_LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** Preferred browser tags, most-specific first (`navigator.languages` + `language`). */
export function browserLanguageTags(
  languages: readonly string[] | undefined,
  language: string | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(languages || []), language || ""]) {
    const tag = String(raw || "")
      .trim()
      .toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Map browser prefs → UI lang.
 * - any `ru*` → ru (home audience)
 * - any `en*` → en
 * - otherwise non-empty prefs → en (international visitors: de/sv/pl/…)
 * - empty → ru (safe default)
 */
export function detectBrowserUiLang(
  languages?: readonly string[],
  language?: string,
): UiLang {
  const tags = browserLanguageTags(languages, language);
  if (!tags.length) return "ru";
  if (tags.some((t) => t === "ru" || t.startsWith("ru-"))) return "ru";
  if (tags.some((t) => t === "en" || t.startsWith("en-"))) return "en";
  return "en";
}

export function detectInitialUiLang(opts?: {
  search?: string;
  stored?: UiLang | null;
  languages?: readonly string[];
  language?: string;
}): UiLang {
  const search =
    opts?.search ?? (typeof window !== "undefined" ? window.location.search : "");
  const q = new URLSearchParams(search).get("lang");
  if (isUiLang(q)) return q;

  const stored = opts?.stored !== undefined ? opts.stored : typeof window !== "undefined" ? readStoredUiLang() : null;
  if (stored) return stored;

  if (typeof window === "undefined" && opts?.languages === undefined && opts?.language === undefined) {
    return "ru";
  }

  return detectBrowserUiLang(
    opts?.languages ?? (typeof navigator !== "undefined" ? navigator.languages : undefined),
    opts?.language ?? (typeof navigator !== "undefined" ? navigator.language : undefined),
  );
}

export function applyDocumentLang(lang: UiLang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "en" ? "en" : "ru";
}
