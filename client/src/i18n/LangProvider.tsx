import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyDocumentLang,
  detectInitialUiLang,
  writeStoredUiLang,
  type UiLang,
} from "./lang.js";
import { translate } from "./ui.js";

type LangCtx = {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(() => detectInitialUiLang());

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const setLang = useCallback((next: UiLang) => {
    setLangState(next);
    writeStoredUiLang(next);
    applyDocumentLang(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return createElement(Ctx.Provider, { value }, children);
}

export function useUiLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe fallback when outside provider (tests)
    return {
      lang: "ru",
      setLang: () => {},
      t: (key, vars) => translate("ru", key, vars),
    };
  }
  return ctx;
}

/** Compact RU | EN control — same visual language as theme-inline. */
export function LangInlineControl() {
  const { lang, setLang, t } = useUiLang();
  return createElement(
    "div",
    { className: "app-bar__lang-inline", role: "group", "aria-label": t("lang.aria") },
    (["ru", "en"] as UiLang[]).map((id) =>
      createElement(
        "button",
        {
          key: id,
          type: "button",
          "data-testid": `lang-inline-${id}`,
          className: lang === id ? "app-bar__theme-inline-btn is-active" : "app-bar__theme-inline-btn",
          "aria-pressed": lang === id,
          onClick: () => setLang(id),
        },
        id.toUpperCase(),
      ),
    ),
  );
}
