import { useEffect, useState } from "react";
import {
  bleObdSupported,
  connectElmBle,
  disconnectElmBle,
  elmBleLinked,
  scanElmBleAt,
  subscribeElmBleLink,
} from "./elmBle.js";
import { parseElmResponse } from "./elmParse.js";
import { enrichScanViaApi } from "./enrichScan.js";
import { ObdScanResults } from "./ObdScanResults.js";
import type { ObdScanPayload } from "./types.js";

type Props = {
  onUseDtcQuery?: (code: string) => void;
};

const SAMPLE_PASTE = "43 01 33 00\n41 05 5B";

export function ObdElmPanel({ onUseDtcQuery }: Props) {
  const [channel, setChannel] = useState<"paste" | "ble">("paste");
  const [paste, setPaste] = useState("");
  const [scan, setScan] = useState<ObdScanPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [bleLinked, setBleLinked] = useState(() => elmBleLinked());
  const bleOk = bleObdSupported();

  useEffect(() => subscribeElmBleLink(setBleLinked), []);

  async function applyScan(raw: ObdScanPayload) {
    setBusy(true);
    setNotice("");
    try {
      const enriched = await enrichScanViaApi(raw);
      setScan(enriched);
      const n = enriched.dtcs?.length ?? 0;
      setNotice(
        enriched.error ||
          `ELM: DTC ${n}${enriched.live?.coolantC != null ? ` · ОЖ ${enriched.live.coolantC}°C` : ""}`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyPaste() {
    try {
      await applyScan(parseElmResponse(paste));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Ошибка разбора");
    }
  }

  async function runBleConnect() {
    setBusy(true);
    setNotice("Подключение BLE…");
    try {
      const name = await connectElmBle();
      setNotice(`BLE подключен: ${name}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBleScan() {
    setBusy(true);
    setNotice("Запрос BLE…");
    try {
      const raw = await scanElmBleAt();
      setPaste(raw);
      await applyScan(parseElmResponse(raw));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function runBleDisconnect() {
    setBusy(true);
    try {
      await disconnectElmBle();
      setNotice("BLE отключен.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5" data-testid="obd-elm-panel">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={`md-btn text-[11px] px-2.5 py-1.5 ${channel === "paste" ? "md-btn--filled" : "md-btn--tonal"}`}
          data-testid="obd-elm-tab-paste"
          onClick={() => setChannel("paste")}
        >
          Вставка ответа
        </button>
        <button
          type="button"
          className={`md-btn text-[11px] px-2.5 py-1.5 ${channel === "ble" ? "md-btn--filled" : "md-btn--tonal"}`}
          data-testid="obd-elm-tab-ble"
          onClick={() => setChannel("ble")}
        >
          Bluetooth BLE
        </button>
      </div>

      {channel === "paste" ? (
        <p className="text-[11px] text-[var(--text-muted)] leading-snug">
          Вставьте ответ ELM (<span className="font-mono">03</span>, <span className="font-mono">0105</span>) из
          терминала / приложения.{" "}
          <button
            type="button"
            className="text-[var(--accent)] underline underline-offset-2"
            data-testid="obd-elm-sample"
            onClick={() => setPaste(SAMPLE_PASTE)}
          >
            Пример P0133 · ОЖ
          </button>
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--text-muted)] leading-snug">
            Нужен BLE UART. Classic BT из браузера недоступен.
            {!bleOk ? " Web Bluetooth здесь недоступен." : ""}
            {bleLinked ? <span className="text-emerald-700"> Связь активна.</span> : null}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!bleLinked ? (
              <button
                type="button"
                className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5"
                disabled={busy || !bleOk}
                data-testid="obd-elm-ble-connect"
                onClick={() => void runBleConnect()}
              >
                {busy ? "…" : "Подключить"}
              </button>
            ) : (
              <button
                type="button"
                className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
                disabled={busy}
                data-testid="obd-elm-ble-disconnect"
                onClick={() => void runBleDisconnect()}
              >
                Отключить
              </button>
            )}
            <button
              type="button"
              className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5"
              disabled={busy || !bleOk}
              data-testid="obd-elm-ble-scan"
              onClick={() => void runBleScan()}
            >
              {busy ? "…" : "Считать 03 / 0105"}
            </button>
          </div>
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Ответ ELM</span>
        <textarea
          className="app-input w-full rounded-lg px-2.5 py-2 text-[11px] font-mono min-h-[4.5rem]"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"43 01 33 00\n41 05 5B"}
          data-testid="obd-elm-paste"
        />
      </label>

      <button
        type="button"
        className="md-btn md-btn--tonal text-[11px] px-3 py-1.5 w-full sm:w-auto"
        disabled={busy || !paste.trim()}
        data-testid="obd-elm-parse"
        onClick={() => void applyPaste()}
      >
        Разобрать ответ
      </button>

      {notice ? (
        <p className="text-[11px] text-[var(--muted)]" data-testid="obd-elm-notice">
          {notice}
        </p>
      ) : null}

      <ObdScanResults scan={scan} onUseDtcQuery={onUseDtcQuery} />
    </div>
  );
}
