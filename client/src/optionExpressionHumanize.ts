/**
 * Humanize Capital optionExpression для карточки провода.
 * Операторы: || → «или», && → «и», ! → «без».
 * Подписи токенов — из data/ewd/option_token_labels.json (расширяемый словарь).
 */
import {
  evaluateOptionExpression,
  listOptionOperandTokens,
  normalizeOptionExpression,
  tokenizeOptionExpression,
} from "../../server/optionExpression.js";
import optionTokenLabelsRaw from "../../data/ewd/option_token_labels.json" with { type: "json" };

export type HumanizedOptionExpression = {
  raw: string;
  /** Выражение с русскими операторами, коды токенов сохранены. */
  textRu: string;
  /** То же, но известные токены заменены короткими RU-подписями. */
  textRuLabeled: string;
  tokens: string[];
};

export type OptionApplicabilityStatus = "match" | "mismatch" | "unknown";

type LabelMap = Record<string, string>;

const LABEL_MAP: LabelMap = (() => {
  const out: LabelMap = {};
  for (const [k, v] of Object.entries(optionTokenLabelsRaw as Record<string, unknown>)) {
    if (k.startsWith("_")) continue;
    if (typeof v !== "string" || !v.trim()) continue;
    out[k.toUpperCase()] = v.trim();
  }
  return out;
})();

const OPS = new Set(["&&", "||", "!", "(", ")"]);

/** Подпись токена: словарь или код + пометка Capital. */
export function labelOptionToken(token: string): { label: string; known: boolean } {
  const key = String(token || "").trim().toUpperCase();
  if (!key) return { label: "", known: false };
  const known = LABEL_MAP[key];
  if (known) return { label: known, known: true };
  return { label: `${token} (код Capital)`, known: false };
}

function joinHumanTokens(parts: string[]): string {
  // Склеиваем без лишних пробелов у скобок: "(SVH60 или Y413) и HUS_ADIM"
  let s = "";
  for (const p of parts) {
    if (!p) continue;
    if (!s) {
      s = p;
      continue;
    }
    if (p === ")" || s.endsWith("(")) s += p;
    else s += ` ${p}`;
  }
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Расшифровка option_expression → RU-текст.
 * Пустое выражение → пустые поля.
 */
export function humanizeOptionExpression(
  expr: string | null | undefined,
): HumanizedOptionExpression {
  const raw = normalizeOptionExpression(String(expr || ""));
  if (!raw) {
    return { raw: "", textRu: "", textRuLabeled: "", tokens: [] };
  }
  const lexed = tokenizeOptionExpression(raw);
  const tokens = listOptionOperandTokens(raw);
  const textParts: string[] = [];
  const labeledParts: string[] = [];

  for (const t of lexed) {
    if (t === "&&") {
      textParts.push("и");
      labeledParts.push("и");
      continue;
    }
    if (t === "||") {
      textParts.push("или");
      labeledParts.push("или");
      continue;
    }
    if (t === "!") {
      textParts.push("без");
      labeledParts.push("без");
      continue;
    }
    if (t === "(" || t === ")") {
      textParts.push(t);
      labeledParts.push(t);
      continue;
    }
    if (OPS.has(t)) continue;
    textParts.push(t);
    labeledParts.push(labelOptionToken(t).label);
  }

  return {
    raw,
    textRu: joinHumanTokens(textParts),
    textRuLabeled: joinHumanTokens(labeledParts),
    tokens,
  };
}

/**
 * Статус применимости относительно текущих vehicle optionTokens.
 * Пустые tokens → unknown.
 * Match/mismatch — только если хотя бы один операнд выражения есть среди
 * токенов авто (иначе VIN часто «не знает» HUMIDSEN/HUS_ADIM → ложный mismatch).
 */
export function optionApplicabilityStatus(
  expr: string | null | undefined,
  vehicleTokens: string[] | null | undefined,
): OptionApplicabilityStatus {
  const raw = normalizeOptionExpression(String(expr || ""));
  if (!raw) return "unknown";
  const toks = Array.isArray(vehicleTokens)
    ? vehicleTokens.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  if (!toks.length) return "unknown";

  const vehicle = new Set(toks.map((t) => t.toUpperCase()));
  const operands = listOptionOperandTokens(raw);
  const overlap = operands.some((t) => vehicle.has(t.toUpperCase()));
  // Нет пересечения с VIN/фильтрами — честно «не знаем», не «не подходит».
  if (!overlap) return "unknown";

  return evaluateOptionExpression(raw, toks) ? "match" : "mismatch";
}

/** Короткая подпись статуса для карточки (язык пользователя, не Capital). */
export function optionApplicabilityLabel(status: OptionApplicabilityStatus): string {
  if (status === "match") return "На вашем авто этот провод должен быть";
  if (status === "mismatch") return "На вашем авто этого провода, скорее всего, нет";
  return "Проверьте по комплектации — авто ещё не сопоставлено";
}
