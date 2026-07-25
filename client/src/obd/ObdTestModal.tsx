import { useEffect, useState } from "react";
import { ObdAdapterPanel } from "./ObdAdapterPanel.js";
import { ObdElmPanel } from "./ObdElmPanel.js";

type Tab = "esp" | "elm";

type Props = {
  open: boolean;
  onClose: () => void;
  onUseDtcQuery?: (code: string) => void;
};

export function ObdTestModal({ open, onClose, onUseDtcQuery }: Props) {
  const [tab, setTab] = useState<Tab>("esp");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm"
      data-testid="obd-test-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="obd-test-title"
        className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 w-full max-w-lg shadow-xl space-y-3 text-left max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="obd-test-title" className="text-base font-semibold text-[var(--text-main)]">
              OBD тест
            </h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Шлюз ESP32-S3 (EWD) или классический ELM327 — отдельная функция сайта.
            </p>
          </div>
          <button
            type="button"
            className="md-btn md-btn--text text-lg px-2 leading-none"
            aria-label="Закрыть"
            data-testid="obd-test-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[var(--border-color)] pb-2">
          <button
            type="button"
            className={`md-btn text-[11px] px-2.5 py-1.5 ${tab === "esp" ? "md-btn--filled" : "md-btn--tonal"}`}
            data-testid="obd-tab-esp"
            onClick={() => setTab("esp")}
          >
            ESP шлюз
          </button>
          <button
            type="button"
            className={`md-btn text-[11px] px-2.5 py-1.5 ${tab === "elm" ? "md-btn--filled" : "md-btn--tonal"}`}
            data-testid="obd-tab-elm"
            onClick={() => setTab("elm")}
          >
            ELM327
          </button>
        </div>

        {tab === "esp" ? (
          <ObdAdapterPanel onUseDtcQuery={onUseDtcQuery} />
        ) : (
          <ObdElmPanel onUseDtcQuery={onUseDtcQuery} />
        )}
      </div>
    </div>
  );
}
