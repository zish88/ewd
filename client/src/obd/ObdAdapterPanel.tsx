import { useState } from "react";
import { enrichScanViaApi, parseScanJson } from "./enrichScan.js";
import { ObdScanResults } from "./ObdScanResults.js";
import type { ObdScanPayload } from "./types.js";

const DEFAULT_GW = "http://192.168.4.1";

type Props = {
  onUseDtcQuery?: (code: string) => void;
  onLinkedChange?: (linked: boolean) => void;
};

/** ESP SoftAP gateway panel (HTTP /scan). Used inside ObdTestModal. */
export function ObdAdapterPanel({ onUseDtcQuery, onLinkedChange }: Props) {
  const [gatewayUrl, setGatewayUrl] = useState(DEFAULT_GW);
  const [paste, setPaste] = useState("");
  const [scan, setScan] = useState<ObdScanPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clearEcu, setClearEcu] = useState("ECM");
  const [clearStep, setClearStep] = useState(0);

  async function applyScan(raw: ObdScanPayload) {
    setBusy(true);
    setNotice("");
    try {
      const enriched = await enrichScanViaApi(raw);
      setScan(enriched);
      const n = enriched.dtcs?.length ?? 0;
      const online = (enriched.ecus || []).filter((e) => e.online).length;
      setNotice(
        enriched.error
          ? enriched.error
          : `Скан: ECU online ${online}/${enriched.ecus?.length ?? 0}, DTC ${n}`,
      );
      if (!enriched.error) onLinkedChange?.(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/obd-sample-scan.json");
      const data = (await r.json()) as ObdScanPayload;
      await applyScan(data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function loadPaste() {
    try {
      await applyScan(parseScanJson(paste));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось разобрать JSON");
    }
  }

  async function triggerGatewayScan() {
    setBusy(true);
    setNotice("");
    const base = gatewayUrl.replace(/\/$/, "");
    try {
      await fetch(`${base}/scan`, { method: "POST", mode: "cors" });
      await new Promise((r) => setTimeout(r, 1200));
      const r = await fetch(`${base}/scan`, { mode: "cors" });
      if (!r.ok) throw new Error(`Шлюз HTTP ${r.status}`);
      const data = (await r.json()) as ObdScanPayload;
      await applyScan(data);
    } catch (e) {
      setNotice(
        `${e instanceof Error ? e.message : String(e)}. На HTTPS браузер блокирует http://шлюз — откройте ${base}/scan и вставьте JSON, либо демо.`,
      );
      setBusy(false);
    }
  }

  async function clearDtcOnGateway() {
    if (clearStep === 0) {
      setClearStep(1);
      setNotice(`Подтверждение 1/2: сбросить DTC на ${clearEcu}? Нажмите ещё раз для отправки.`);
      return;
    }
    setBusy(true);
    const base = gatewayUrl.replace(/\/$/, "");
    try {
      const r = await fetch(
        `${base}/clear?ecu=${encodeURIComponent(clearEcu)}&confirm=1`,
        { method: "POST", mode: "cors" },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      setClearStep(0);
      setNotice(`Запрос Clear DTC (${clearEcu}) отправлен на шлюз.`);
      await new Promise((x) => setTimeout(x, 800));
      const scanR = await fetch(`${base}/scan`, { mode: "cors" });
      if (scanR.ok) await applyScan((await scanR.json()) as ObdScanPayload);
      else setBusy(false);
    } catch (e) {
      setClearStep(0);
      setNotice(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="obd-adapter-panel">
      <div
        className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container)] px-2.5 py-2 space-y-1.5"
        data-testid="obd-esp-softap-checklist"
      >
        <p className="text-[11px] font-semibold text-[var(--text-main)]">Плата EWD N16R8 — по Wi‑Fi SoftAP</p>
        <ol className="text-[11px] text-[var(--text-muted)] leading-snug list-decimal pl-4 space-y-0.5">
          <li>
            На телефоне/ПК подключитесь к Wi‑Fi{" "}
            <span className="font-mono text-[var(--text-main)]">EWD-OBD-Gateway</span> (пароль{" "}
            <span className="font-mono text-[var(--text-main)]">volvo-obd</span>).
          </li>
          <li>
            Откройте в браузере{" "}
            <span className="font-mono text-[var(--text-main)]">http://192.168.4.1</span> — страница шлюза.
          </li>
          <li>
            Скан: кнопка ниже (если сайт открыт по HTTP/localhost) или скопируйте JSON с{" "}
            <span className="font-mono">/scan</span> и вставьте сюда.
          </li>
        </ol>
        <p className="text-[10px] text-[var(--muted)] leading-snug" data-testid="obd-esp-mixed-content-note">
          Сайт по HTTPS (ewd-volvo.ru) <strong className="font-semibold">не может</strong> сам сходить на{" "}
          <span className="font-mono">http://192.168.4.1</span> — браузер блокирует mixed content. Рабочий путь:
          страница шлюза → вставить JSON сюда, либо демо-скан.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="app-input rounded px-2 py-1.5 text-xs font-mono flex-1 min-w-[12rem]"
          value={gatewayUrl}
          onChange={(e) => setGatewayUrl(e.target.value)}
          aria-label="URL шлюза"
          data-testid="obd-gateway-url"
        />
        <button
          type="button"
          className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5"
          disabled={busy}
          data-testid="obd-scan-gateway"
          onClick={() => void triggerGatewayScan()}
        >
          Скан со шлюза
        </button>
        <button
          type="button"
          className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
          disabled={busy}
          data-testid="obd-scan-demo"
          onClick={() => void loadDemo()}
        >
          Демо-скан
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase text-[var(--muted)]">Вставить JSON с /scan</span>
        <textarea
          className="app-input w-full rounded px-2 py-1.5 text-[11px] font-mono min-h-[4rem]"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder='{"bus":"HS-CAN","ecus":[],"dtcs":[]}'
          data-testid="obd-paste-json"
        />
      </label>
      <button
        type="button"
        className="md-btn md-btn--text text-[11px] px-2 py-1"
        disabled={busy || !paste.trim()}
        onClick={() => void loadPaste()}
      >
        Применить JSON
      </button>

      {notice ? (
        <p className="text-[11px] text-[var(--muted)]" data-testid="obd-notice">
          {notice}
        </p>
      ) : null}

      <ObdScanResults scan={scan} onUseDtcQuery={onUseDtcQuery} />

      <div className="rounded border border-red-500/30 p-2 space-y-1.5">
        <p className="text-[10px] text-red-700/90">
          Сброс ошибок (UDS 0x14) — только после двух подтверждений. Security Access отсутствует.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="app-input rounded px-2 py-1 text-xs font-mono"
            value={clearEcu}
            onChange={(e) => {
              setClearEcu(e.target.value);
              setClearStep(0);
            }}
            data-testid="obd-clear-ecu"
          >
            {(scan?.ecus || [{ id: "ECM" }, { id: "TCM" }, { id: "ABS" }, { id: "CEM" }]).map((e) => (
              <option key={e.id} value={e.id}>
                {e.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="md-btn text-[11px] px-2.5 py-1.5 border border-red-500/50 text-red-700"
            disabled={busy}
            data-testid="obd-clear-dtc"
            onClick={() => void clearDtcOnGateway()}
          >
            {clearStep === 0 ? "Сбросить DTC…" : "Подтвердить сброс DTC"}
          </button>
          {clearStep > 0 ? (
            <button
              type="button"
              className="md-btn md-btn--text text-[11px]"
              onClick={() => {
                setClearStep(0);
                setNotice("");
              }}
            >
              Отмена
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
