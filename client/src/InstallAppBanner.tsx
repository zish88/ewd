import { useEffect, useState } from "react";
import { isTelegramMiniApp } from "./telegram.js";

const DISMISS_KEY = "ewd_install_banner_dismissed_v1";

type PlatformHint = "ios" | "mac-safari" | "android-chrome" | "other";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
}

function detectPlatform(): PlatformHint {
  const ua = navigator.userAgent || "";
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) return "ios";
  const isMac = /Macintosh|Mac OS X/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/i.test(ua);
  if (isMac && isSafari) return "mac-safari";
  if (/Android/i.test(ua) && /Chrome|CriOS/i.test(ua)) return "android-chrome";
  return "other";
}

function hintText(platform: PlatformHint): { title: string; body: string } {
  if (platform === "ios") {
    return {
      title: "На экран «Домой»",
      body: "В Safari нажмите «Поделиться» (□↑), затем «На экран „Домой“» — как приложение на Android.",
    };
  }
  if (platform === "mac-safari") {
    return {
      title: "Добавить в Dock",
      body: "Safari → меню «Файл» → «Добавить в Dock…» (или Поделиться → Добавить в Dock). Откроется отдельным окном без вкладок.",
    };
  }
  if (platform === "android-chrome") {
    return {
      title: "Установить приложение",
      body: "Можно добавить на главный экран — работает офлайн-оболочка и полноэкранный режим.",
    };
  }
  return {
    title: "Установить приложение",
    body: "В меню браузера выберите «Установить приложение» / «Добавить на главный экран».",
  };
}

export function InstallAppBanner() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<PlatformHint>("other");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isTelegramMiniApp()) return;
    if (isStandaloneDisplay()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    const p = detectPlatform();
    setPlatform(p);
    // iOS / Mac Safari: always show hint (no beforeinstallprompt)
    if (p === "ios" || p === "mac-safari") {
      setVisible(true);
      return;
    }
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    // Android/desktop Chrome without event yet — light hint after delay
    const t = window.setTimeout(() => {
      if (p === "android-chrome") setVisible(true);
    }, 2500);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.clearTimeout(t);
    };
  }, []);

  if (!visible) return null;
  const copy = hintText(platform);

  async function installNative() {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    dismiss();
  }

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="install-app-banner" data-testid="install-app-banner" role="dialog" aria-label={copy.title}>
      <div className="install-app-banner__text">
        <strong className="install-app-banner__title">{copy.title}</strong>
        <p className="install-app-banner__body">{copy.body}</p>
      </div>
      <div className="install-app-banner__actions">
        {deferred ? (
          <button type="button" className="md-btn md-btn--filled install-app-banner__cta" onClick={() => void installNative()}>
            Установить
          </button>
        ) : null}
        <button type="button" className="md-btn md-btn--text install-app-banner__dismiss" onClick={dismiss} aria-label="Скрыть">
          Понятно
        </button>
      </div>
    </aside>
  );
}
