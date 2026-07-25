import type { ObdScanPayload } from "./types.js";

type Props = {
  scan: ObdScanPayload | null;
  onUseDtcQuery?: (code: string) => void;
};

export function ObdScanResults({ scan, onUseDtcQuery }: Props) {
  if (!scan) return null;
  return (
    <div className="space-y-2" data-testid="obd-scan-results">
      {scan.live?.coolantC != null ? (
        <p className="text-xs">
          ОЖ (PID 05): <strong className="font-mono">{scan.live.coolantC} °C</strong>
        </p>
      ) : null}

      {scan.ecus?.length ? (
        <div className="space-y-1">
          <h3 className="text-[10px] uppercase text-[var(--muted)]">ECU</h3>
          <ul className="flex flex-wrap gap-1.5 text-[11px] font-mono" data-testid="obd-ecu-list">
            {scan.ecus.map((e) => (
              <li
                key={e.id}
                className={`rounded border px-1.5 py-0.5 ${
                  e.online
                    ? "border-emerald-600/50 text-emerald-800 dark:text-emerald-200"
                    : "border-[var(--border-color)] text-[var(--text-muted)]"
                }`}
              >
                {e.id}
                {e.online ? "" : " · off"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scan.dtcs?.length ? (
        <div className="space-y-1">
          <h3 className="text-[10px] uppercase text-[var(--muted)]">DTC</h3>
          <ul className="space-y-1 text-xs" data-testid="obd-dtc-list">
            {scan.dtcs.map((d, i) => (
              <li
                key={`${d.ecu}-${d.code}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--border-color)]/50 pb-1"
              >
                <button
                  type="button"
                  className="font-mono text-emerald-700 underline"
                  onClick={() => onUseDtcQuery?.(d.code)}
                >
                  {d.code}
                </button>
                <span className="text-[var(--text-muted)]">{d.ecu}</span>
                <span className="text-[10px] uppercase text-[var(--muted)]">{d.status}</span>
                {d.title_ru || d.title_en ? (
                  <span className="w-full text-[var(--text-main)]">{d.title_ru || d.title_en}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
