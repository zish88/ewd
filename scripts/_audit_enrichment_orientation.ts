/**
 * Audit: enrichment «От…к…» / purpose совпадают с from_detail→to_detail на ВСЕХ строках.
 * Usage: npx tsx scripts/_audit_enrichment_orientation.ts
 */
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFromToPlainRu,
  buildPurposeRu,
  cardEnrichmentFromFacts,
  loadWireEnrichmentCache,
  parseEnrichmentDetail,
  resetWireEnrichmentCache,
  wireEnrichmentKey,
} from "../server/wireEnrichment.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
resetWireEnrichmentCache();
const cache = loadWireEnrichmentCache(root);

const db = new Database(join(root, "data", "wiring.sqlite"), { readonly: true });
const nameRows = db
  .prepare(
    `SELECT component_code AS code,
            COALESCE(NULLIF(TRIM(name_ru), ''), NULLIF(TRIM(description_ru), ''), '') AS name_ru
     FROM components
     WHERE TRIM(COALESCE(name_ru, '')) != '' OR TRIM(COALESCE(description_ru, '')) != ''`,
  )
  .all() as Array<{ code: string; name_ru: string }>;
const nameByCode = new Map(nameRows.map((r) => [r.code, r.name_ru]));

function enrichDetail(detail: string): string {
  const s = String(detail || "").trim();
  if (!s) return s;
  if (/[—–]/.test(s) || /\s-\s/.test(s)) return s;
  const m = s.match(/^(\d+\/\d+)\s*:\s*([0-9A-Za-z./-]+)\s*$/);
  if (!m) return s;
  const name = nameByCode.get(m[1]);
  if (!name) return s;
  return `${m[1]}:${m[2]} — ${name}`;
}

const rows = db
  .prepare(
    `SELECT w.wire_uid AS wire_uid,
            IFNULL(cf.component_code,'') AS from_code,
            IFNULL(ct.component_code,'') AS to_code,
            w.pin_number AS pin_number,
            w.wire_color_raw AS wire_color_raw,
            w.from_detail AS from_detail,
            w.to_detail AS to_detail,
            w.function_text AS function_text
     FROM wire_connections w
     LEFT JOIN components cf ON cf.id = w.from_component_id
     LEFT JOIN components ct ON ct.id = w.to_component_id
     WHERE TRIM(COALESCE(w.from_detail, '')) != ''
       AND TRIM(COALESCE(w.to_detail, '')) != ''`,
  )
  .all() as Array<{
  wire_uid: string;
  from_code: string;
  to_code: string;
  pin_number: string;
  wire_color_raw: string;
  from_detail: string;
  to_detail: string;
  function_text: string;
}>;
db.close();

type Fail = { kind: string; key: string; from: string; to: string; plain?: string; purpose?: string; note?: string };

const fails: Fail[] = [];
let checked = 0;
let withPlain = 0;
let withPurpose = 0;
let bothOrients = 0;
let bothOrientsOk = 0;

const byUid = new Map<string, typeof rows>();
for (const row of rows) {
  const list = byUid.get(row.wire_uid) || [];
  list.push(row);
  byUid.set(row.wire_uid, list);
}

for (const row of rows) {
  const from_detail = enrichDetail(row.from_detail);
  const to_detail = enrichDetail(row.to_detail);
  const from = parseEnrichmentDetail(from_detail);
  const to = parseEnrichmentDetail(to_detail);
  if (!from || !to) continue;
  // Только именованные концы — как в UI plain
  if (!from.name && !to.name) continue;

  checked += 1;
  const e = cardEnrichmentFromFacts(
    {
      component_code: row.from_code || row.to_code,
      from_node: row.from_code,
      to_node: row.to_code,
      from_detail,
      to_detail,
      wire_uid: row.wire_uid,
      pin_number: row.pin_number,
      wire_color: row.wire_color_raw,
      function_text: row.function_text,
    },
    nameByCode,
    cache,
  );

  const key = wireEnrichmentKey({
    wire_uid: row.wire_uid,
    from_node: row.from_code,
    to_node: row.to_code,
    pin_number: row.pin_number,
    wire_color: row.wire_color_raw,
  });

  const expectedPlain = buildFromToPlainRu(from_detail, to_detail);
  const expectedPurpose = buildPurposeRu({
    fromDetail: from_detail,
    toDetail: to_detail,
    functionText: row.function_text,
  });

  if (!e?.from_to_plain_ru) {
    if (expectedPlain) {
      fails.push({
        kind: "missing-plain",
        key,
        from: from_detail,
        to: to_detail,
      });
    }
    continue;
  }
  withPlain += 1;

  const plain = e.from_to_plain_ru;
  const fromTok = `${from.code}:${from.pin}`;
  const toTok = `${to.code}:${to.pin}`;
  const iFrom = plain.indexOf(fromTok);
  const iTo = plain.indexOf(toTok);
  if (iFrom < 0 || iTo < 0 || iFrom > iTo) {
    fails.push({
      kind: "plain-order",
      key,
      from: from_detail,
      to: to_detail,
      plain,
      note: `expected ${fromTok} before ${toTok}`,
    });
  }
  if (expectedPlain && plain !== expectedPlain.text) {
    fails.push({
      kind: "plain-mismatch",
      key,
      from: from_detail,
      to: to_detail,
      plain,
      note: `expected: ${expectedPlain.text}`,
    });
  }

  if (e.purpose_ru) {
    withPurpose += 1;
    if (expectedPurpose && e.purpose_ru !== expectedPurpose.text) {
      fails.push({
        kind: "purpose-mismatch",
        key,
        from: from_detail,
        to: to_detail,
        purpose: e.purpose_ru,
        note: `expected: ${expectedPurpose.text}`,
      });
    }
    // Для именованных: from-name должен идти раньше to-name в «Соединяет … с …»
    if (from.name && to.name && /^Соединяет /i.test(e.purpose_ru)) {
      const a = from.name.toLocaleLowerCase("ru");
      const b = to.name.toLocaleLowerCase("ru");
      const p = e.purpose_ru.toLocaleLowerCase("ru");
      const ia = p.indexOf(a.slice(0, Math.min(12, a.length)));
      const ib = p.indexOf(b.slice(0, Math.min(12, b.length)));
      if (ia >= 0 && ib >= 0 && ia > ib) {
        fails.push({
          kind: "purpose-order",
          key,
          from: from_detail,
          to: to_detail,
          purpose: e.purpose_ru,
        });
      }
    }
  } else if (expectedPurpose) {
    fails.push({
      kind: "missing-purpose",
      key,
      from: from_detail,
      to: to_detail,
    });
  }
}

// Пары A→B / B→A с одним uid: plains должны быть зеркальными
for (const [uid, list] of byUid) {
  if (list.length < 2) continue;
  const enriched = list
    .map((row) => {
      const from_detail = enrichDetail(row.from_detail);
      const to_detail = enrichDetail(row.to_detail);
      const from = parseEnrichmentDetail(from_detail);
      const to = parseEnrichmentDetail(to_detail);
      if (!from || !to) return null;
      if (!from.name && !to.name) return null;
      const e = cardEnrichmentFromFacts(
        {
          from_node: row.from_code,
          to_node: row.to_code,
          from_detail,
          to_detail,
          wire_uid: row.wire_uid,
          pin_number: row.pin_number,
          wire_color: row.wire_color_raw,
          function_text: row.function_text,
        },
        nameByCode,
        cache,
      );
      return { row, from, to, plain: e?.from_to_plain_ru || "" };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i];
      const b = enriched[j];
      if (a.from.code === b.to.code && a.to.code === b.from.code && a.from.pin === b.to.pin && a.to.pin === b.from.pin) {
        bothOrients += 1;
        const aFrom = `${a.from.code}:${a.from.pin}`;
        const aTo = `${a.to.code}:${a.to.pin}`;
        const okA = a.plain.indexOf(aFrom) < a.plain.indexOf(aTo) && a.plain.includes(aFrom) && a.plain.includes(aTo);
        const okB =
          b.plain.indexOf(`${b.from.code}:${b.from.pin}`) < b.plain.indexOf(`${b.to.code}:${b.to.pin}`) &&
          b.plain.includes(`${b.from.code}:${b.from.pin}`);
        if (okA && okB && a.plain !== b.plain) bothOrientsOk += 1;
        else {
          fails.push({
            kind: "bidirectional",
            key: uid,
            from: a.row.from_detail,
            to: a.row.to_detail,
            plain: `A=${a.plain} || B=${b.plain}`,
          });
        }
      }
    }
  }
}

const byKind = new Map<string, number>();
for (const f of fails) byKind.set(f.kind, (byKind.get(f.kind) || 0) + 1);

console.log(
  JSON.stringify(
    {
      checked,
      withPlain,
      withPurpose,
      bothOrients,
      bothOrientsOk,
      failCount: fails.length,
      byKind: Object.fromEntries(byKind),
      samples: fails.slice(0, 12),
    },
    null,
    2,
  ),
);

if (fails.length) process.exit(1);
