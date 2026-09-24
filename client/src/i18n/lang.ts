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

export function detectInitialUiLang(): UiLang {
  if (typeof window === "undefined") return "ru";
  const q = new URLSearchParams(window.location.search).get("lang");
  if (isUiLang(q)) return q;
  const stored = readStoredUiLang();
  if (stored) return stored;
  const nav = String(navigator.language || "").toLowerCase();
  if (nav.startsWith("en")) return "en";
  return "ru";
}

export function applyDocumentLang(lang: UiLang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "en" ? "en" : "ru";
}
