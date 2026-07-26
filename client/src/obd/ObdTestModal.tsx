import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { disconnectElmBle, elmBleLinked, subscribeElmBleLink } from "./elmBle.js";
import { ObdAdapterPanel } from "./ObdAdapterPanel.js";
import { ObdElmPanel } from "./ObdElmPanel.js";

type Tab = "esp" | "elm";

export type ObdSurface = "closed" | "open" | "minimized";

type Props = {
  surface: ObdSurface;
  onSurfaceChange: (s: ObdSurface) => void;
  onUseDtcQuery?: (code: string) => void;
  /** Soft link flag from ESP gateway success (HTTP has no persistent socket). */
  espLinked?: boolean;
  onEspLinkedChange?: (linked: boolean) => void;
};

const CLOSE_WARN =
  "При закрытии соединение с OBD-адаптером будет разорвано. Закрыть окно?";

export function ObdTestModal({
  surface,
  onSurfaceChange,
  onUseDtcQuery,
  espLinked = false,
  onEspLinkedChange,
}: Props) {
  const [tab, setTab] = useState<Tab>("esp");
  const [bleLinked, setBleLinked] = useState(() => elmBleLinked());
  const [mounted, setMounted] = useState(false);
  const active = surface === "open" || surface === "minimized";
  const linked = bleLinked || espLinked;

  useEffect(() => setMounted(true), []);
  useEffect(() => subscribeElmBleLink(setBleLinked), []);

  const hardClose = useCallback(async () => {
    await disconnectElmBle();
    onEspLinkedChange?.(false);
    onSurfaceChange("closed");
  }, [onEspLinkedChange, onSurfaceChange]);

  const requestClose = useCallback(() => {
    if (linked) {
      if (!window.confirm(CLOSE_WARN)) return;
    }
    void hardClose();
  }, [linked, hardClose]);

  useEffect(() => {
    if (surface !== "open") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [surface, requestClose]);

  if (!active || !mounted) return null;

  const panelHidden = surface === "minimized";

  return createPortal(
    <>
      {surface === "minimized" ? (
        <button
          type="button"
          className={`obd-float-chip fixed z-[130] bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] md-btn md-btn--filled text-[12px] px-3 py-2${
            linked ? " obd-btn--live" : ""
          }`}
          data-testid="obd-test-restore"
          title="Развернуть OBD (соединение сохранено)"
          onClick={() => onSurfaceChange("open")}
        >
          OBD{linked ? " · online" : ""}
        </button>
      ) : null}

      <div
        className={panelHidden ? "hidden" : "obd-float-layer"}
        data-testid="obd-test-modal"
        data-obd-mode="float"
      >
        <button
          type="button"
          className="obd-float-scrim"
          aria-label="Закрыть OBD"
          data-testid="obd-test-scrim"
          onClick={requestClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="obd-test-title"
          className="obd-float-window"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="obd-float-window__head shrink-0 flex items-center gap-2 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="obd-test-title" className="text-sm font-semibold text-[var(--text-main)] leading-tight">
                  OBD
                </h2>
                <span className="obd-beta-badge obd-beta-badge--inline" data-testid="obd-beta-badge">
                  Тестирование
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                {linked ? "Связь активна · свернуть не отключает" : "Свернуть — связь сохранится"}
              </p>
            </div>
            <button
              type="button"
              className="obd-float-window__icon-btn"
              aria-label="Свернуть"
              title="Свернуть"
              data-testid="obd-test-minimize"
              onClick={() => onSurfaceChange("minimized")}
            >
              <span aria-hidden>–</span>
            </button>
            <button
              type="button"
              className="obd-float-window__icon-btn"
              aria-label="Закрыть"
              title="Закрыть — разорвёт соединение"
              data-testid="obd-test-close"
              onClick={requestClose}
            >
              <span aria-hidden>×</span>
            </button>
          </header>

          <div className="obd-float-window__tabs shrink-0 flex gap-1.5 px-3.5 pb-2.5" role="tablist" aria-label="Канал OBD">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "esp"}
              className={`md-btn text-[11px] px-2.5 py-1.5 ${tab === "esp" ? "md-btn--filled" : "md-btn--tonal"}`}
              data-testid="obd-tab-esp"
              onClick={() => setTab("esp")}
            >
              ESP шлюз
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "elm"}
              className={`md-btn text-[11px] px-2.5 py-1.5 ${tab === "elm" ? "md-btn--filled" : "md-btn--tonal"}`}
              data-testid="obd-tab-elm"
              onClick={() => setTab("elm")}
            >
              ELM327
            </button>
          </div>

          <div className="obd-float-window__body flex-1 min-h-0 overflow-y-auto px-3.5 pb-3.5 space-y-3 text-left">
            <div className={tab === "esp" ? "" : "hidden"} aria-hidden={tab !== "esp"}>
              <ObdAdapterPanel onUseDtcQuery={onUseDtcQuery} onLinkedChange={onEspLinkedChange} />
            </div>
            <div className={tab === "elm" ? "" : "hidden"} aria-hidden={tab !== "elm"}>
              <ObdElmPanel onUseDtcQuery={onUseDtcQuery} />
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
