import { useState } from "react";
import { bleObdSupported, scanElmBleAt } from "./elmBle.js";
import { parseElmResponse } from "./elmParse.js";
import { enrichScanViaApi } from "./enrichScan.js";
import { ObdScanResults } from "./ObdScanResults.js";
import type { ObdScanPayload } from "./types.js";

type Props = {
  onUseDtcQuery?: (code: string) => void;
};

export function ObdElmPanel({ onUseDtcQuery }: Props) {
  const [channel, setChannel] = useState<"wifi" | "ble">("wifi");
  const [paste, setPaste] = useState("");
  const [wifiHint] = useState("192.168.0.10:35000");
  const [scan, setScan] = useState<ObdScanPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const bleOk = bleObdSupported();

  async function applyScan(raw: ObdScanPayload) {
    setBusy(true);
    setNotice("");
    try {
      const enriched = await enrichScanViaApi(raw);
      setScan(enriched);
      const n = enriched.dtcs?.length ?? 0;
      setNotice(enriched.error || `ELM: DTC ${n}${enriched.live?.coolantC != null ? ` · ОЖ ${enriched.live.coolantC}°C` : ""}`);
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

  async function runBle() {
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

  return (
    <div className="space-y-3" data-testid="obd-elm-panel">
      <p className="text-[11px] text-[var(--text-muted)]">
        Классический ELM327: браузер не открывает TCP Wi‑Fi и Bluetooth Classic (SPP). Вставьте ответ AT / Mode 03
        или подключите <strong>BLE</strong>-адаптер (Android Chrome).
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`md-btn text-[11px] px-2.5 py-1.5 ${channel === "wifi" ? "md-btn--filled" : "md-btn--tonal"}`}
          data-testid="obd-elm-tab-wifi"
          onClick={() => setChannel("wifi")}
        >
          Wi‑Fi ELM
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

      {channel === "wifi" ? (
        <div className="rounded border border-[var(--border-color)] p-2 space-y-1 text-[11px] text-[var(--text-muted)]">
          <p>
            Типичный SoftAP адаптера: <span className="font-mono text-[var(--text-main)]">{wifiHint}</span> (TCP AT).
            Прямой connect из сайта невозможен — используйте терминал/приложение и вставьте вывод ниже, либо будущий
            локальный мост.
          </p>
        </div>
      ) : (
        <div className="rounded border border-[var(--border-color)] p-2 space-y-2 text-[11px]">
          <p className="text-[var(--text-muted)]">
            Classic BT (большинство дешёвых ELM) Web Bluetooth не поддерживает. Нужен BLE UART OBD.
            {!bleOk ? " В этом браузере Web Bluetooth недоступен." : ""}
          </p>
          <button
            type="button"
            className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5"
            disabled={busy || !bleOk}
            data-testid="obd-elm-ble-connect"
            onClick={() => void runBle()}
          >
            {busy ? "…" : "Подключить BLE и считать 03 / 0105"}
          </button>
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-[10px] uppercase text-[var(--muted)]">Ответ ELM (AT / hex)</span>
        <textarea
          className="app-input w-full rounded px-2 py-1.5 text-[11px] font-mono min-h-[5rem]"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"Вставьте ответ ELM (hex), например:\n43 01 33 00\n41 05 5B"}
          data-testid="obd-elm-paste"
        />
      </label>
      <p className="text-[10px] text-[var(--text-muted)]">
        Подсказка (не подставляется сама): <span className="font-mono">43 01 33 00</span> → P0133,{" "}
        <span className="font-mono">41 05 5B</span> → ОЖ.
      </p>
      <button
        type="button"
        className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
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
