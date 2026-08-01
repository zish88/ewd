export type TelegramThemeParams = {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: { id?: number; first_name?: string; last_name?: string; username?: string } };
  themeParams: TelegramThemeParams;
  colorScheme?: "light" | "dark";
  viewportHeight?: number;
  viewportStableHeight?: number;
  ready: () => void;
  expand: () => void;
  onEvent: (event: "themeChanged" | "viewportChanged" | "backButtonClicked", callback: () => void) => void;
  offEvent?: (event: "themeChanged" | "viewportChanged" | "backButtonClicked", callback: () => void) => void;
  BackButton?: { show: () => void; hide: () => void };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = window.Telegram?.WebApp;
  return app && typeof app.ready === "function" ? app : null;
}

export function isTelegramMiniApp(): boolean {
  return Boolean(webApp());
}

function setColor(name: string, value: string | undefined) {
  if (!value) return;
  document.documentElement.style.setProperty(name, value);
}

function applyTelegramTheme(app: TelegramWebApp) {
  const theme = app.themeParams || {};
  const html = document.documentElement;
  html.dataset.telegram = "true";
  html.dataset.telegramScheme = app.colorScheme || "dark";
  setColor("--bg-main", theme.bg_color);
  setColor("--bg-header", theme.secondary_bg_color || theme.bg_color);
  setColor("--bg-card", theme.secondary_bg_color || theme.bg_color);
  setColor("--surface-container", theme.secondary_bg_color || theme.bg_color);
  setColor("--input-bg", theme.secondary_bg_color || theme.bg_color);
  setColor("--text-main", theme.text_color);
  setColor("--text-muted", theme.hint_color);
  setColor("--accent", theme.link_color || theme.button_color);
  setColor("--cta", theme.button_color);
  setColor("--on-cta", theme.button_text_color);
}

function applyViewport(app: TelegramWebApp) {
  const height = app.viewportStableHeight || app.viewportHeight;
  if (Number.isFinite(height) && Number(height) > 0) {
    document.documentElement.style.setProperty("--tg-viewport-height", `${height}px`);
  }
}

/** Enables Telegram-only presentation without changing ordinary browser behavior. */
export function initializeTelegramWebApp(): TelegramWebApp | null {
  const app = webApp();
  if (!app || typeof document === "undefined") return null;
  app.ready();
  app.expand();
  applyTelegramTheme(app);
  applyViewport(app);
  app.onEvent("themeChanged", () => applyTelegramTheme(app));
  app.onEvent("viewportChanged", () => applyViewport(app));
  return app;
}

/** Telegram's native back affordance follows the active in-app overlay state. */
export function setTelegramBackButton(visible: boolean, onBack?: () => void): () => void {
  const app = webApp();
  if (!app?.BackButton) return () => {};
  if (visible) app.BackButton.show();
  else app.BackButton.hide();
  if (!visible || !onBack) return () => {};
  app.onEvent("backButtonClicked", onBack);
  return () => app.offEvent?.("backButtonClicked", onBack);
}

/** Optional identity bootstrap; auth failure never blocks public reference access. */
export async function bootstrapTelegramIdentity(): Promise<void> {
  const initData = webApp()?.initData?.trim();
  if (!initData) return;
  try {
    await fetch("/api/telegram/auth", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    });
  } catch {
    // Telegram profile is optional; the public app remains usable offline / without bot config.
  }
}
