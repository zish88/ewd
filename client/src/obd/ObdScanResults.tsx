import type { ObdScanPayload, ObdSignal } from "./types.js";

type Props = {
  scan: ObdScanPayload | null;
  onUseDtcQuery?: (code: string) => void;
};

function legacyLiveToSignals(live: Record<string, number | string> | undefined): ObdSignal[] {
  if (!live) return [];
  const out: ObdSignal[] = [];
  for (const [key, value] of Object.entries(live)) {
    if (value == null || value === "") continue;
    out.push({
      id: key,
      pid: "?",
      name: key,
      value,
      unit: typeof value === "number" && /temp|coolant|C$/i.test(key) ? "°C" : undefined,
    });
  }
  return out;
}

function formatSignalValue(s: ObdSignal): string {
  if (typeof s.value === "number" && Number.isFinite(s.value)) {
    const n = Math.abs(s.value) >= 100 ? s.value.toFixed(0) : s.value.toFixed(2);
    return s.unit ? `${n} ${s.unit}` : n;
  }
  return s.unit ? `${s.value} ${s.unit}` : String(s.value);
}

export function ObdScanResults({ scan, onUseDtcQuery }: Props) {
  if (!scan) return null;
  const signals =
    scan.signals && scan.signals.length > 0 ? scan.signals : legacyLiveToSignals(scan.live);
  const bus = scan.busStatus;

  return (
    <div className="space-y-2" data-testid="obd-scan-results">
      {bus ? (
        <p className="text-[10px] text-[var(--muted)] font-mono" data-testid="obd-bus-status">
          Bus {bus.state || (bus.ok ? "OK" : "?")}
          {bus.txErr != null ? ` · txErr ${bus.txErr}` : ""}
          {bus.rxErr != null ? ` · rxErr ${bus.rxErr}` : ""}
          {bus.supportedPidCount != null ? ` · PIDs ${bus.supportedPidCount}` : ""}
          {typeof bus.lastScanAgeMs === "number" && bus.lastScanAgeMs >= 0
            ? ` · scan ${Math.round(bus.lastScanAgeMs / 1000)}s ago`
            : ""}
        </p>
      ) : null}

      {scan.supportedPids?.length ? (
        <p className="text-[10px] text-[var(--muted)]" data-testid="obd-supported-pids">
          Supported Mode 01:{" "}
          <span className="font-mono">{scan.supportedPids.slice(0, 24).join(" ")}</span>
          {scan.supportedPids.length > 24 ? ` +${scan.supportedPids.length - 24}` : ""}
        </p>
      ) : null}

      {signals.length ? (
        <div className="space-y-1">
          <h3 className="text-[10px] uppercase text-[var(--muted)]">Signals</h3>
          <ul className="space-y-0.5 text-[11px]" data-testid="obd-signals-list">
            {signals.map((s) => (
              <li
                key={`${s.id}-${s.pid}`}
                className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--border-color)]/40 pb-0.5"
              >
                <span className="font-mono text-[var(--text-muted)] w-8 shrink-0">{s.pid}</span>
                <span className="text-[var(--text-main)] flex-1 min-w-[8rem]">{s.name}</span>
                <span className="font-mono font-semibold">{formatSignalValue(s)}</span>
              </li>
            ))}
          </ul>
        </div>
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
