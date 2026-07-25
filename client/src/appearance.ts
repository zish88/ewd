/** Site-wide appearance tokens from /api/site-status (admin «Внешний вид»). */

export type ThemeId = "charcoal" | "caspian" | "amber";
export type UiDensity = "compact" | "normal" | "comfortable";

export type AppearanceColors = {
  accent?: string;
  bgMain?: string;
  bgCard?: string;
  textMain?: string;
  textMuted?: string;
  border?: string;
  cta?: string;
};

export type SiteAppearance = {
  defaultTheme?: ThemeId;
  colors?: AppearanceColors;
  fontFamily?: string;
  fontUrl?: string;
  radiusMd?: string;
  radiusLg?: string;
  cardPadding?: string;
  cardGap?: string;
  cardTitleSize?: string;
  appBarHeight?: string;
  chipFontSize?: string;
  btnMinHeight?: string;
  uiDensity?: UiDensity;
};

const FONT_LINK_ID = "ewd-appearance-font";

const COLOR_VAR: Record<keyof AppearanceColors, string[]> = {
  accent: ["--accent"],
  bgMain: ["--bg-main", "--app-bg"],
  bgCard: ["--bg-card", "--card-bg", "--input-bg"],
  textMain: ["--text-main", "--text"],
  textMuted: ["--text-muted", "--muted"],
  border: ["--border-color", "--border", "--outline-variant"],
  cta: ["--cta"],
};

const DENSITY: Record<
  UiDensity,
  { pad: string; gap: string; title: string; radiusMd: string; radiusLg: string }
> = {
  compact: { pad: "0.5rem 0.55rem", gap: "0.3rem", title: "0.75rem", radiusMd: "10px", radiusLg: "12px" },
  normal: { pad: "0.65rem 0.7rem", gap: "0.45rem", title: "0.8125rem", radiusMd: "12px", radiusLg: "16px" },
  comfortable: { pad: "0.85rem 0.9rem", gap: "0.6rem", title: "0.9rem", radiusMd: "14px", radiusLg: "18px" },
};

const STYLE_ATTR = "data-ewd-appearance";

function setVar(el: HTMLElement, name: string, value: string | undefined) {
  if (value) el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

/** Apply appearance tokens as inline CSS variables on <html>. */
export function applySiteAppearance(appearance?: SiteAppearance | null) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute(STYLE_ATTR, "1");

  const dens = appearance?.uiDensity && DENSITY[appearance.uiDensity] ? appearance.uiDensity : "normal";
  const d = DENSITY[dens];

  const colors = appearance?.colors || {};
  for (const key of Object.keys(COLOR_VAR) as Array<keyof AppearanceColors>) {
    const val = String(colors[key] || "").trim();
    for (const cssVar of COLOR_VAR[key]) setVar(el, cssVar, val || undefined);
  }

  setVar(el, "--font-ui", String(appearance?.fontFamily || "").trim() || undefined);
  setVar(el, "--radius-md", String(appearance?.radiusMd || "").trim() || d.radiusMd);
  setVar(el, "--radius-lg", String(appearance?.radiusLg || "").trim() || d.radiusLg);
  setVar(el, "--card-pad", String(appearance?.cardPadding || "").trim() || d.pad);
  setVar(el, "--card-gap", String(appearance?.cardGap || "").trim() || d.gap);
  setVar(el, "--text-card-title", String(appearance?.cardTitleSize || "").trim() || d.title);
  setVar(el, "--app-bar-h", String(appearance?.appBarHeight || "").trim() || undefined);
  setVar(el, "--chip-font-size", String(appearance?.chipFontSize || "").trim() || undefined);
  setVar(el, "--btn-min-height", String(appearance?.btnMinHeight || "").trim() || undefined);
  el.dataset.uiDensity = dens;

  const fontUrl = String(appearance?.fontUrl || "").trim();
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (fontUrl) {
    if (!link) {
      link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== fontUrl) link.href = fontUrl;
  } else if (link) {
    link.remove();
  }
}

export function siteDefaultTheme(appearance?: SiteAppearance | null): ThemeId | null {
  const t = appearance?.defaultTheme;
  if (t === "charcoal" || t === "caspian" || t === "amber") return t;
  return null;
}
