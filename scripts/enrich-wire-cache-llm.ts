/**
 * SLICE-02: офлайн LLM-pass поверх rules-кэша (полный корпус).
 *
 *   npm run enrich:wires
 *   npm run enrich:wires:llm -- --all
 *   npm run enrich:wires:llm -- --codes=3/362 --limit=40
 *
 * Модель: LOCAL_AI_MODEL_PATH или E:\project_v1\assets\models\model.gguf
 * Движок: node-llama-cpp из project_v1.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import {
  enrichmentCachePath,
  resetWireEnrichmentCache,
  wireEnrichmentKey,
} from "../server/wireEnrichment.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL =
  process.env.LOCAL_AI_MODEL_PATH ||
  "E:\\project_v1\\assets\\models\\model.gguf";
const LLAMA_ENTRY = join(
  process.env.LOCAL_AI_LLAMA_DIR || "E:\\project_v1\\node_modules\\node-llama-cpp",
  "dist",
  "index.js",
);
const CHECKPOINT_EVERY = 25;

function argVal(name: string, fallback: string | null = null): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const ALL = hasFlag("all");
const FORCE = hasFlag("force");
const LIMIT_RAW = argVal("limit", ALL ? "0" : "40");
const LIMIT = Math.max(0, Number(LIMIT_RAW) || 0);
const CODES = String(argVal("codes", ALL ? "" : "3/362,6/210,7/90") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function sanitizePurpose(raw: string, factsBlob: string): string | null {
  let t = String(raw || "")
    .replace(/^["'«]+|["'»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Срезаем хвост после первой строки / «Ответ:»
  t = t.split(/\n|Ответ:/i)[0]?.trim() || t;
  if (!t || /неизвестно/i.test(t)) return null;
  if (t.length > 180) t = t.slice(0, 177) + "…";
  const pns = t.match(/\b\d{6,}\b/g) || [];
  for (const pn of pns) {
    if (!factsBlob.includes(pn)) return null;
  }
  return t;
}

/** Группировка: одна фраза на одинаковый смысл без номеров пинов. */
function purposeSignature(plain: string, fromCode: string, toCode: string, fn: string): string {
  const plainNorm = String(plain || "")
    .replace(/:\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (plainNorm) return `p:${plainNorm}`;
  return `f:${fromCode}|${toCode}|${String(fn || "").toLowerCase().slice(0, 80)}`;
}

type WireRow = {
  wire_uid: string;
  from_code: string;
  to_code: string;
  pin_number: string | null;
  wire_color_raw: string | null;
  from_detail: string | null;
  to_detail: string | null;
  function_text: string | null;
  option_expression: string | null;
};

type CacheWire = {
  from_to_plain_ru?: string;
  purpose_ru?: string;
  confidence?: string;
  sources?: string[];
};

type Cache = {
  wires: Record<string, CacheWire>;
  components: Record<string, { role_ru?: string }>;
  model_pass?: string;
  generated_at?: string;
  llm?: unknown;
};

function saveCache(cachePath: string, cache: Cache) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  resetWireEnrichmentCache();
}

async function main() {
  if (!existsSync(MODEL)) {
    console.error(`Модель не найдена: ${MODEL}`);
    process.exit(1);
  }
  if (!existsSync(LLAMA_ENTRY)) {
    console.error(`node-llama-cpp не найден: ${LLAMA_ENTRY}`);
    process.exit(1);
  }

  const cachePath = enrichmentCachePath(root);
  if (!existsSync(cachePath)) {
    console.error("Сначала: npm run enrich:wires");
    process.exit(1);
  }

  const cache = JSON.parse(readFileSync(cachePath, "utf8")) as Cache;
  cache.wires = cache.wires || {};
  cache.components = cache.components || {};

  const db = new Database(join(root, "data", "wiring.sqlite"), { readonly: true });

  let rows: WireRow[];
  if (ALL || CODES.length === 0) {
    const limSql = LIMIT > 0 ? ` LIMIT ${LIMIT}` : "";
    rows = db
      .prepare(
        `SELECT w.wire_uid AS wire_uid,
                IFNULL(cf.component_code,'') AS from_code,
                IFNULL(ct.component_code,'') AS to_code,
                w.pin_number AS pin_number,
                w.wire_color_raw AS wire_color_raw,
                w.from_detail AS from_detail,
                w.to_detail AS to_detail,
                w.function_text AS function_text,
                w.option_expression AS option_expression
         FROM wire_connections w
         LEFT JOIN components cf ON cf.id = w.from_component_id
         LEFT JOIN components ct ON ct.id = w.to_component_id
         WHERE TRIM(COALESCE(w.from_detail,'')) != ''
            OR TRIM(COALESCE(w.to_detail,'')) != ''
         ORDER BY w.wire_uid${limSql}`,
      )
      .all() as WireRow[];
  } else {
    const placeholders = CODES.map(() => "?").join(",");
    const lim = LIMIT > 0 ? LIMIT : 40;
    rows = db
      .prepare(
        `SELECT w.wire_uid AS wire_uid,
                IFNULL(cf.component_code,'') AS from_code,
                IFNULL(ct.component_code,'') AS to_code,
                w.pin_number AS pin_number,
                w.wire_color_raw AS wire_color_raw,
                w.from_detail AS from_detail,
                w.to_detail AS to_detail,
                w.function_text AS function_text,
                w.option_expression AS option_expression
         FROM wire_connections w
         LEFT JOIN components cf ON cf.id = w.from_component_id
         LEFT JOIN components ct ON ct.id = w.to_component_id
         WHERE (cf.component_code IN (${placeholders})
             OR ct.component_code IN (${placeholders})
             OR w.subject_code IN (${placeholders}))
           AND TRIM(COALESCE(w.from_detail,'')) != ''
         LIMIT ?`,
      )
      .all(...CODES, ...CODES, ...CODES, lim) as WireRow[];
  }
  db.close();

  type Group = { sig: string; keys: string[]; sample: WireRow; plain: string };
  const groups = new Map<string, Group>();

  for (const row of rows) {
    const key = wireEnrichmentKey({
      wire_uid: row.wire_uid,
      from_node: row.from_code,
      to_node: row.to_code,
      pin_number: row.pin_number || undefined,
      wire_color: row.wire_color_raw || undefined,
    });
    const prev = cache.wires[key];
    if (!FORCE && prev?.purpose_ru) continue;

    const plain = prev?.from_to_plain_ru || "";
    const sig = purposeSignature(plain, row.from_code, row.to_code, row.function_text || "");
    let g = groups.get(sig);
    if (!g) {
      g = { sig, keys: [], sample: row, plain };
      groups.set(sig, g);
    }
    g.keys.push(key);
    if (!g.plain && plain) g.plain = plain;
  }

  const work = [...groups.values()];
  console.log(`LLM enrich: model=${MODEL}`);
  console.log(
    `mode=${ALL ? "all" : "codes"} rows=${rows.length} groups=${work.length} force=${FORCE}`,
  );
  if (work.length === 0) {
    console.log("Нечего обновлять (все purpose_ru уже есть).");
    return;
  }

  console.log("Loading node-llama-cpp…");
  const { getLlama, LlamaChatSession } = await import(pathToFileURL(LLAMA_ENTRY).href);
  console.log("Loading GGUF…");
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: MODEL });
  const context = await model.createContext({ contextSize: 2048 });
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });

  let updatedGroups = 0;
  let updatedWires = 0;
  let skipped = 0;
  const started = Date.now();

  for (let i = 0; i < work.length; i++) {
    const g = work[i];
    const row = g.sample;
    const prev = cache.wires[g.keys[0]] || {
      from_to_plain_ru: g.plain,
      confidence: "medium",
      sources: ["rules-from-to"],
    };

    const fromName = cache.components[row.from_code]?.role_ru || "";
    const toName = cache.components[row.to_code]?.role_ru || "";
    const facts = [
      `от: ${row.from_detail || `${row.from_code}:${row.pin_number}`}${fromName ? ` (${fromName})` : ""}`,
      `к: ${row.to_detail || row.to_code}${toName ? ` (${toName})` : ""}`,
      `цвет: ${row.wire_color_raw || "—"}`,
      `цепь: ${row.function_text || "—"}`,
      `опция: ${row.option_expression || "—"}`,
      g.plain || prev.from_to_plain_ru ? `уже: ${g.plain || prev.from_to_plain_ru}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt =
      `Ты помощник по электросхемам Volvo P3. По ФАКТАМ ниже напиши ОДНУ короткую фразу на русском (макс 120 символов):\n` +
      `зачем этот провод / какую функцию соединяет.\n` +
      `Не меняй и не выдумывай коды, пины, цвета и партномера.\n` +
      `Если данных мало — ответь ровно: НЕИЗВЕСТНО\n\n` +
      `ФАКТЫ:\n${facts}\n\nОтвет:`;

    const eta =
      i > 0
        ? ` ~${Math.round(((Date.now() - started) / i) * (work.length - i) / 60000)}м`
        : "";
    process.stdout.write(
      `[${i + 1}/${work.length}] ${row.from_code}→${row.to_code} ×${g.keys.length}${eta}… `,
    );

    let reply = "";
    try {
      try {
        session.resetChatHistory();
      } catch {
        /* ignore */
      }
      reply = await session.prompt(prompt, { maxTokens: 80 });
    } catch (e) {
      console.log(`err ${(e as Error).message || e}`);
      skipped += 1;
      continue;
    }

    const purpose = sanitizePurpose(reply, facts);
    if (!purpose) {
      console.log("skip");
      skipped += 1;
      continue;
    }

    for (const key of g.keys) {
      const cur = cache.wires[key] || {
        from_to_plain_ru: g.plain,
        confidence: "medium",
        sources: ["rules-from-to"],
      };
      cache.wires[key] = {
        ...cur,
        purpose_ru: purpose,
        confidence: cur.from_to_plain_ru ? "high" : cur.confidence || "medium",
        sources: [...new Set([...(cur.sources || []), "gguf-local-purpose"])],
      };
      updatedWires += 1;
    }
    updatedGroups += 1;
    console.log(purpose);

    if ((i + 1) % CHECKPOINT_EVERY === 0) {
      cache.model_pass = "rules-v1+gguf-purpose";
      cache.generated_at = new Date().toISOString();
      cache.llm = {
        model_path: MODEL,
        mode: ALL ? "all" : "codes",
        codes: CODES,
        groups_total: work.length,
        groups_done: i + 1,
        updated_groups: updatedGroups,
        updated_wires: updatedWires,
        skipped,
        checkpoint: true,
      };
      saveCache(cachePath, cache);
      console.log(`  checkpoint @ ${i + 1}/${work.length}`);
    }
  }

  cache.model_pass = "rules-v1+gguf-purpose";
  cache.generated_at = new Date().toISOString();
  cache.llm = {
    model_path: MODEL,
    mode: ALL ? "all" : "codes",
    codes: CODES,
    groups_total: work.length,
    updated_groups: updatedGroups,
    updated_wires: updatedWires,
    skipped,
    elapsed_ms: Date.now() - started,
  };
  saveCache(cachePath, cache);

  console.log(
    `\nГотово: groups=${updatedGroups} wires=${updatedWires} skipped=${skipped} ` +
      `(${Math.round((Date.now() - started) / 60000)} мин)\n→ ${cachePath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
