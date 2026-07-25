import type { ObdDtcItem, ObdScanPayload } from "./types.js";

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

/**
 * Parse ELM327 / OBD-II text dump into ObdScanPayload.
 * Understands Mode 03/07/0A (43/47/4A) DTC lists and Mode 01 PID 05 (4105).
 */
export function parseElmResponse(raw: string): ObdScanPayload {
  const text = normalizeElmText(raw);
  const dtcs: ObdDtcItem[] = [];
  const seen = new Set<string>();
  let coolantC: number | undefined;
  let sawPositive = false;

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const chunks = lines.length ? lines : [text.replace(/\s+/g, "")];

  for (const line of chunks) {
    const bytes = hexBytes(line);
    if (bytes.length < 2) continue;

    // 41 05 XX — coolant
    for (let i = 0; i + 2 < bytes.length; i++) {
      if (bytes[i] === 0x41 && bytes[i + 1] === 0x05) {
        coolantC = bytes[i + 2] - 40;
        sawPositive = true;
      }
    }

    // 43 / 47 / 4A — DTC pairs (ISO 15031; no count byte — 00 00 is padding)
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

  if (!sawPositive && !dtcs.length && coolantC == null) {
    return {
      device: "elm327",
      bus: "OBD-II",
      readOnlyDefault: true,
      ecus: [{ id: "OBD", req: "7DF", rsp: "7E8", online: false }],
      dtcs: [],
      live: {},
      error: "Не удалось разобрать ответ ELM (ожидались кадры 43… / 4105…).",
    };
  }

  const live: { coolantC?: number } = {};
  if (coolantC != null) live.coolantC = coolantC;

  return {
    device: "elm327",
    bus: "OBD-II",
    readOnlyDefault: true,
    ecus: [{ id: "OBD", req: "7DF", rsp: "7E8", online: true }],
    dtcs,
    live,
  };
}
