import type { ObdDtcItem, ObdScanPayload, ObdSignal } from "./types.js";

const DTC_LETTERS = ["P", "C", "B", "U"] as const;

/** Decode 2-byte SAE DTC from classic OBD Mode 03/07/0A payload. */
export function decodeObdDtcWord(hi: number, lo: number): string {
  const letter = DTC_LETTERS[(hi >> 6) & 0x03];
  const d1 = (hi >> 4) & 0x03;
  const d2 = hi & 0x0f;
  const d3 = (lo >> 4) & 0x0f;
  const d4 = lo & 0x0f;
  return `${letter}${d1.toString(16).toUpperCase()}${d2.toString(16).toUpperCase()}${d3.toString(16).toUpperCase()}${d4.toString(16).toUpperCase()}`;
}

/** Strip ELM noise, keep hex digits / spaces for frame parsing. */
export function normalizeElmText(raw: string): string {
  return String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/SEARCHING\.*/gi, "")
    .replace(/\bNO DATA\b/gi, "")
    .replace(/\bUNABLE TO CONNECT\b/gi, "")
    .replace(/\bSTOPPED\b/gi, "")
    .replace(/>/g, " ")
    .trim();
}

function hexBytes(line: string): number[] {
  const cleaned = line.replace(/[^0-9A-Fa-f]/g, "");
  if (cleaned.length < 2 || cleaned.length % 2 !== 0) return [];
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return out;
}

function pidHex(pid: number): string {
  return pid.toString(16).toUpperCase().padStart(2, "0");
}

/** Decode a Mode 01 PID payload (A,B,…) into a universal signal. */
export function decodeMode01Pid(pid: number, data: number[]): ObdSignal | null {
  if (!data.length) return null;
  const a = data[0] ?? 0;
  const b = data[1] ?? 0;
  const hex = pidHex(pid);
  const base = { pid: hex };
  switch (pid) {
    case 0x04:
      return { ...base, id: "engine_load", name: "Engine load", value: (a * 100) / 255, unit: "%" };
    case 0x05:
      return { ...base, id: "coolant_temp", name: "Coolant temperature", value: a - 40, unit: "°C" };
    case 0x0b:
      return { ...base, id: "map", name: "Intake manifold pressure", value: a, unit: "kPa" };
    case 0x0c:
      return { ...base, id: "engine_rpm", name: "Engine RPM", value: (a * 256 + b) / 4, unit: "rpm" };
    case 0x0d:
      return { ...base, id: "vehicle_speed", name: "Vehicle speed", value: a, unit: "km/h" };
    case 0x0f:
      return { ...base, id: "intake_temp", name: "Intake air temperature", value: a - 40, unit: "°C" };
    case 0x10:
      return { ...base, id: "maf", name: "MAF air flow", value: (a * 256 + b) / 100, unit: "g/s" };
    case 0x11:
      return { ...base, id: "throttle", name: "Throttle position", value: (a * 100) / 255, unit: "%" };
    case 0x42:
      return {
        ...base,
        id: "ecu_voltage",
        name: "Control module voltage",
        value: (a * 256 + b) / 1000,
        unit: "V",
      };
    default:
      return { ...base, id: `pid_${hex}`, name: `PID ${hex}`, value: a, unit: "raw" };
  }
}

/**
 * Parse ELM327 / OBD-II text dump into ObdScanPayload.
 * Mode 03/07/0A DTC lists + any Mode 01 (41 XX …) → `signals[]`.
 */
export function parseElmResponse(raw: string): ObdScanPayload {
  const text = normalizeElmText(raw);
  const dtcs: ObdDtcItem[] = [];
  const signals: ObdSignal[] = [];
  const signalIds = new Set<string>();
  const seen = new Set<string>();
  let sawPositive = false;

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const chunks = lines.length ? lines : [text.replace(/\s+/g, "")];

  for (const line of chunks) {
    const bytes = hexBytes(line);
    if (bytes.length < 2) continue;

    // 41 <pid> <data…> — Mode 01 positive response(s)
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] !== 0x41) continue;
      const pid = bytes[i + 1];
      if (pid === 0x00 || (pid & 0x1f) === 0) continue; // skip support bitmasks
      const data = bytes.slice(i + 2, i + 6);
      const sig = decodeMode01Pid(pid, data);
      if (!sig) continue;
      sawPositive = true;
      if (!signalIds.has(sig.id)) {
        signalIds.add(sig.id);
        signals.push(sig);
      }
    }

    // 43 / 47 / 4A — DTC pairs
    for (let i = 0; i < bytes.length; i++) {
      const sid = bytes[i];
      if (sid !== 0x43 && sid !== 0x47 && sid !== 0x4a) continue;
      sawPositive = true;
      let j = i + 1;
      while (j + 1 < bytes.length) {
        const hi = bytes[j];
        const lo = bytes[j + 1];
        j += 2;
        if (hi === 0 && lo === 0) continue;
        if (hi === 0x41 || hi === 0x43 || hi === 0x47 || hi === 0x4a) {
          j -= 2;
          break;
        }
        const code = decodeObdDtcWord(hi, lo);
        if (seen.has(code)) continue;
        seen.add(code);
        const status = sid === 0x47 ? "pending" : sid === 0x4a ? "permanent" : "confirmed";
        dtcs.push({
          ecu: "OBD",
          code,
          status,
          raw: `${hi.toString(16).padStart(2, "0")}${lo.toString(16).padStart(2, "0")}`.toUpperCase(),
        });
      }
      break;
    }
  }

  if (!sawPositive && !dtcs.length && !signals.length) {
    return {
      device: "elm327",
      bus: "OBD-II",
      readOnlyDefault: true,
      ecus: [{ id: "OBD", req: "7DF", rsp: "7E8", online: false }],
      dtcs: [],
      signals: [],
      error: "Не удалось разобрать ответ ELM (ожидались кадры 43… / 41…).",
    };
  }

  return {
    device: "elm327",
    bus: "OBD-II",
    readOnlyDefault: true,
    ecus: [{ id: "OBD", req: "7DF", rsp: "7E8", online: true }],
    dtcs,
    signals,
  };
}
