/**
 * Evaluate Capital EWD optionExpression against vehicle option tokens.
 *
 * Expressions use tokens like Y285, AUTO, EXEC with && || ! and parentheses.
 * HTML entities (&amp;&amp;) are normalized. Empty expression → true.
 * Empty token set → true (do not hide branches without vehicle context).
 */

export function normalizeOptionExpression(raw: string): string {
  return String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\u00a0/g, " ")
    .trim();
}

function tokenize(expr: string): string[] {
  const s = normalizeOptionExpression(expr);
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (s.startsWith("&&", i) || s.startsWith("||", i)) {
      tokens.push(s.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === "&" || ch === "|") {
      tokens.push(ch === "&" ? "&&" : "||");
      i++;
      continue;
    }
    if (ch === "!") {
      tokens.push("!");
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && /[A-Za-z0-9_./+-]/.test(s[j])) j++;
    if (j === i) {
      i++;
      continue;
    }
    tokens.push(s.slice(i, j));
    i = j;
  }
  return tokens;
}

/** OR level (lowest precedence). */
function parseOr(
  tokens: string[],
  pos: { i: number },
  hasToken: (t: string) => boolean,
): boolean {
  let value = parseAnd(tokens, pos, hasToken);
  while (pos.i < tokens.length && tokens[pos.i] === "||") {
    pos.i++;
    value = value || parseAnd(tokens, pos, hasToken);
  }
  return value;
}

function parseAnd(
  tokens: string[],
  pos: { i: number },
  hasToken: (t: string) => boolean,
): boolean {
  let value = parseUnary(tokens, pos, hasToken);
  while (pos.i < tokens.length && tokens[pos.i] === "&&") {
    pos.i++;
    value = value && parseUnary(tokens, pos, hasToken);
  }
  return value;
}

function parseUnary(
  tokens: string[],
  pos: { i: number },
  hasToken: (t: string) => boolean,
): boolean {
  if (pos.i >= tokens.length) return true;
  if (tokens[pos.i] === "!") {
    pos.i++;
    return !parseUnary(tokens, pos, hasToken);
  }
  if (tokens[pos.i] === "(") {
    pos.i++;
    const inner = parseOr(tokens, pos, hasToken);
    if (tokens[pos.i] === ")") pos.i++;
    return inner;
  }
  const tok = tokens[pos.i++];
  if (!tok || tok === "||" || tok === "&&" || tok === ")") return true;
  return hasToken(tok);
}

/**
 * @param expression Capital optionExpression (may include HTML entities)
 * @param optionTokens Vehicle tokens (Y285, AUTO, 3.2P, …). Empty → always true.
 */
export function evaluateOptionExpression(
  expression: string | null | undefined,
  optionTokens: string[] | Set<string> | null | undefined,
): boolean {
  const expr = normalizeOptionExpression(String(expression || ""));
  if (!expr) return true;
  const tokensArr = optionTokens
    ? Array.isArray(optionTokens)
      ? optionTokens
      : [...optionTokens]
    : [];
  if (!tokensArr.length) return true;

  const upper = new Set(tokensArr.map((t) => String(t).trim().toUpperCase()).filter(Boolean));
  const hasToken = (t: string) => upper.has(String(t).trim().toUpperCase());

  try {
    const toks = tokenize(expr);
    if (!toks.length) return true;
    return parseOr(toks, { i: 0 }, hasToken);
  } catch {
    // Fail open: do not hide a wire when expression is malformed
    return true;
  }
}
