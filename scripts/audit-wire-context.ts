import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type WireRow = {
  subject_code: string;
  pin_number: string;
  wire_color: string;
  wire_uid: string;
  pin_uid: string;
  from_detail: string;
  to_detail: string;
};

type ContextResult = {
  status?: string;
  exactSheetCount?: number;
  nearestPeer?: { code?: string; pin?: string | null } | null;
  exactSheets?: Array<{ diagramUid?: string; title?: string; zoneMismatch?: boolean }>;
  warnings?: string[];
  error?: string;
};

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((value) => value.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

function normalizeCode(raw: string): string {
  const match = String(raw || "").match(/\b(\d+[A-Z]?\/\d+)\b/i);
  if (!match) return "";
  return match[1].replace(/^(\d+)[A-Z]\//i, "$1/").toUpperCase();
}

function peerFromRow(row: WireRow): string {
  const selected = normalizeCode(row.subject_code);
  const candidates = `${row.from_detail} ${row.to_detail}`
    .match(/\b\d+[A-Z]?\/\d+\b/gi)
    ?.map(normalizeCode) || [];
  return candidates.find((code) => code && code !== selected) || "";
}

async function main() {
  const dbPath = resolve(arg("--db", process.env.DATABASE_PATH || "data/wiring.sqlite"));
  const baseUrl = arg("--base-url", "http://localhost:3000").replace(/\/+$/, "");
  const outputPath = arg("--out");
  const limit = Math.max(0, Number(arg("--limit", "0")) || 0);
  if (!existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const raw = db
    .prepare(
      `SELECT
         TRIM(IFNULL(subject_code,'')) AS subject_code,
         TRIM(IFNULL(pin_number,'')) AS pin_number,
         TRIM(IFNULL(wire_color_raw,'')) AS wire_color,
         TRIM(IFNULL(wire_uid,'')) AS wire_uid,
         TRIM(IFNULL(pin_uid,'')) AS pin_uid,
         IFNULL(from_detail,'') AS from_detail,
         IFNULL(to_detail,'') AS to_detail
       FROM wire_connections
       WHERE TRIM(IFNULL(subject_code,'')) != ''
       ORDER BY subject_code, pin_number, id`,
    )
    .all() as WireRow[];
  db.close();

  const unique = new Map<string, WireRow>();
  for (const row of raw) {
    const code = normalizeCode(row.subject_code);
    if (!code) continue;
    const key = [code, row.pin_number, row.wire_color, row.wire_uid, row.pin_uid, peerFromRow(row)].join("|");
    if (!unique.has(key)) unique.set(key, { ...row, subject_code: code });
  }
  const rows = [...unique.values()].slice(0, limit || undefined);
  const results: Array<{ row: WireRow; peer: string; context: ContextResult }> = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      const row = rows[index];
      const peer = peerFromRow(row);
      const qs = new URLSearchParams({ code: row.subject_code });
      if (row.pin_number && row.pin_number !== "—") qs.set("pin", row.pin_number);
      if (row.wire_color && row.wire_color !== "—") qs.set("color", row.wire_color);
      if (row.wire_uid) qs.set("wireUid", row.wire_uid);
      if (row.pin_uid) qs.set("pinUid", row.pin_uid);
      if (peer) qs.set("peer", peer);
      let context: ContextResult;
      try {
        const response = await fetch(`${baseUrl}/api/ewd/wire-context?${qs}`);
        context = response.ok
          ? ((await response.json()) as ContextResult)
          : { error: `${response.status} ${response.statusText}` };
      } catch (error) {
        context = { error: error instanceof Error ? error.message : String(error) };
      }
      results[index] = { row, peer, context };
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, Math.max(1, rows.length)) }, worker));

  const counts: Record<string, number> = {};
  let nearestPeerCount = 0;
  let zoneMismatchCount = 0;
  let failed = 0;
  const samples: Record<string, unknown[]> = {};
  for (const result of results) {
    const status = result.context.error ? "request-error" : result.context.status || "unknown";
    counts[status] = (counts[status] || 0) + 1;
    if (result.context.nearestPeer?.code) nearestPeerCount++;
    if (result.context.exactSheets?.some((sheet) => sheet.zoneMismatch)) zoneMismatchCount++;
    if (result.context.error) failed++;
    const bucket = (samples[status] ||= []);
    if (bucket.length < 12) {
      bucket.push({
        code: result.row.subject_code,
        pin: result.row.pin_number || null,
        color: result.row.wire_color || null,
        wireUid: result.row.wire_uid || null,
        peer: result.context.nearestPeer || result.peer || null,
        exactSheetCount: result.context.exactSheetCount || 0,
        error: result.context.error || null,
      });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    database: dbPath,
    baseUrl,
    totalDatabaseRows: raw.length,
    uniqueCardsAudited: rows.length,
    failedRequests: failed,
    coverage: {
      statusCounts: counts,
      exactSheetCards: (counts["exact-one"] || 0) + (counts["exact-many"] || 0),
      nearestPeerCards: nearestPeerCount,
      nearestPeerPercent: rows.length ? Number(((nearestPeerCount / rows.length) * 100).toFixed(2)) : 0,
      zoneMismatchCards: zoneMismatchCount,
    },
    samples,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, json, "utf8");
    console.log(`Wire context audit written to ${absolute}`);
  } else {
    process.stdout.write(json);
  }
  if (failed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
