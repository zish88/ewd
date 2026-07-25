import type { ObdDtcItem, ObdScanPayload } from "./types.js";

export async function enrichScanViaApi(scan: ObdScanPayload): Promise<ObdScanPayload> {
  const dtcs = Array.isArray(scan.dtcs) ? scan.dtcs : [];
  if (!dtcs.length) return scan;
  const r = await fetch("/api/obd/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dtcs }),
  });
  if (!r.ok) return scan;
  const data = (await r.json()) as { dtcs?: ObdDtcItem[] };
  return { ...scan, dtcs: Array.isArray(data.dtcs) ? data.dtcs : dtcs };
}

export function parseScanJson(text: string): ObdScanPayload {
  const data = JSON.parse(text) as ObdScanPayload;
  if (!data || typeof data !== "object") throw new Error("Неверный JSON скана");
  return data;
}
