/**
 * Shared helpers for public deploy notes (updating.html + Web Push body).
 * Only user-facing changes — skip admin/infra/meta commits.
 */

/** How many bullets to show on the updating page / push body. */
export const MAX_ITEMS = 4;

/** Exact Russian lines for known English commit subjects (display only). */
export const RU_BY_SUBJECT = new Map(
  Object.entries({
    "Add admin appearance CMS, tabbed settings save, and fresher deploy notes.":
      "Админка: настройка внешнего вида, вкладки и сохранение черновика; актуальные заметки деплоя.",
    "Restore mouse-wheel zoom on schematics without breaking trackpad pan/pinch.":
      "Восстановлен зум колёсиком на схемах без поломки жестов трекпада.",
    "Mark OBD as beta with a testing badge and keep the accent pulse on prod.":
      "OBD помечен как beta с бейджем тестирования; пульс кнопки на проде сохранён.",
    "Show EPC part numbers on node banner and merge connector PN fallback.":
      "Номера деталей EPC на баннере узла и запасной PN разъёма.",
    "Add OBD test modal/ELM path, ESP firmware docs, and deploy notes on updating page.":
      "Тестовое окно OBD/ELM, документация прошивки ESP и заметки на странице обновления.",
    "Add scheme fullscreen mode and fix Mac trackpad pan/zoom and card scroll.":
      "Полноэкранный режим схем и исправления pan/zoom трекпада Mac и скролла карточек.",
    "Serve branded updating page on deploy 502 errors.":
      "Фирменная страница «сайт на обновлении» при ошибках деплоя 502.",
    "Improve admin visit tiles and collapse the card-edit panel after approve/reject.":
      "Улучшены плитки посещений в админке; панель правки сворачивается после решения по заявке.",
    "Polish updating page: edge fade, no road, brand pulse, warm status glow.":
      "Доработана страница обновления: мягкие края, пульс бренда, тёплое свечение статуса.",
    "Add soft blur to the updating-page car animation.":
      "Мягкое размытие краёв анимации авто на странице обновления.",
    "Stretch laptop filters into the app bar and keep browser UA in admin visits.":
      "Ноутбук: быстрые фильтры в шапке.",
    "Fix VAPID key parsing when web-push prints keys on the next line.":
      "Исправлено чтение VAPID-ключей, когда web-push печатает их со следующей строки.",
    "Add VPS script to generate and write VAPID keys into .env.":
      "Скрипт на VPS: генерация VAPID-ключей и запись в .env.",
    "Add Web Push notifications after site updates.":
      "Можно включить уведомления о обновлении сайта.",
    "Show Russian deploy notes on the updating page.":
      "Русские заметки на странице обновления.",
    "Refresh updating-page notes for laptop filters, push, and VAPID.":
      "Обновлены заметки на странице деплоя: фильтры ноутбука и уведомления.",
    "Center desktop filter chips in two rows and outline white wires on schematics.":
      "Ноутбук: фильтры по центру в два ряда; белые и бело-цветные провода видны на схемах.",
    "Make dual-color wire badge text readable on light stripe pigments.":
      "Читаемые подписи на двухцветных проводах (белый/жёлтый).",
    "Ship dual-wire badge contrast, user-only deploy notes, and push during updating.":
      "Читаемые подписи на двухцветных проводах; пуш при обновлении сайта.",
    "Stamp updating.html with user-facing dual-wire and push-notify notes.":
      "Читаемые подписи на двухцветных проводах; пуш при обновлении сайта.",
    "Пуш/SW баннеры, детали DTC VIDA, рефактор nav-зон и pinch-zoom схем.":
      "Пуш-баннеры работают надёжнее; детали DTC VIDA; удобнее pinch-zoom на схемах.",
    "OBD: динамический discovery PID и универсальный API сигналов ESP-шлюза.":
      "OBD: авто-поиск PID и универсальные сигналы ESP-шлюза.",
    "Move OBD testing to admin, tighten engine-zone rules, sanitize public docs":
      "Точнее зоны двигателя на схемах.",
  }).map(([en, ru]) => [en.toLowerCase(), ru]),
);

export function normalizeSubject(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Stable key for dedupe / "already shown" checks. */
export function noteKey(raw) {
  return normalizeSubject(raw)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[«»"'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasCyrillic(s) {
  return /[а-яё]/i.test(s);
}

/** Meta / stamp-only commits — never show. */
export function isNoiseSubject(s) {
  if (!s) return true;
  if (/^merge\b/i.test(s)) return true;
  if (/updating\.html stamp/i.test(s)) return true;
  if (/^Refresh updating-page notes\b/i.test(s)) return true;
  if (/^Sync updating\.html\b/i.test(s)) return true;
  if (/^Stamp updating\.html\b/i.test(s)) return true;
  if (/^Skip stamp-only\b/i.test(s)) return true;
  if (/\bmeta deploy-note\b/i.test(s)) return true;
  if (/\bdeploy note\b/i.test(s)) return true;
  if (/заметк/i.test(s) && /страниц/i.test(s) && /обновл/i.test(s)) return true;
  if (/force utf-8 git log/i.test(s)) return true;
  return false;
}

/**
 * Admin / ops / infra — hide from public updating page and push body.
 * Keep product changes users can see or use.
 */
export function isInternalDeploySubject(s) {
  const t = normalizeSubject(s);
  if (!t) return true;
  if (isNoiseSubject(t)) return true;

  if (/\badmin\b/i.test(t)) return true;
  if (/админк/i.test(t)) return true;
  if (/\/admin\b/i.test(t)) return true;

  if (/\binternal\b/i.test(t)) return true;
  if (/\bpublic repo\b/i.test(t)) return true;
  if (/\bportal\b/i.test(t)) return true;
  if (/sanitize public docs/i.test(t)) return true;
  if (/public docs/i.test(t) && /sanitize|remove|internal/i.test(t)) return true;

  if (/\bvapid\b/i.test(t)) return true;
  if (/\.env\b/i.test(t)) return true;
  if (/\bdeploy\.sh\b/i.test(t)) return true;
  if (/\bvps-deploy\b/i.test(t)) return true;
  if (/\bdockerfile\b/i.test(t)) return true;
  if (/\bnginx\b/i.test(t) && /snippet|install|config/i.test(t)) return true;
  if (/скрипт на vps/i.test(t)) return true;
  if (/setup-vapid/i.test(t)) return true;
  if (/\bua_label\b/i.test(t)) return true;
  if (/\buser-?agent\b/i.test(t) && /admin|visit|посещ/i.test(t)) return true;
  if (/браузер и устройство/i.test(t) && /админ/i.test(t)) return true;
  if (/только в админке/i.test(t)) return true;
  if (/плитки посещений/i.test(t)) return true;
  if (/visit tiles/i.test(t)) return true;
  if (/smtp/i.test(t) && /admin|тест|test|настро/i.test(t)) return true;
  if (/модератор/i.test(t)) return true;
  if (/\bCMS\b/.test(t) && /admin|appearance|внешн/i.test(t)) return true;
  if (/push-stats/i.test(t)) return true;
  if (/repo-hygiene/i.test(t)) return true;
  if (/DEPLOY\.md/i.test(t)) return true;

  // Pure refactor noise for visitors (\b is ASCII-only — avoid for Cyrillic)
  if (/^рефактор(инг)?(\s|$|:|и\b)/i.test(t)) return true;
  if (/^refactor(\s|$|:)/i.test(t)) return true;
  if (/\bрефактор(инг)?\b/i.test(t) && /nav/i.test(t)) return true;

  return false;
}

/** Russian line for the updating page (keeps Cyrillic subjects as-is). */
export function toRussianDeployNote(subject) {
  const s = normalizeSubject(subject);
  if (!s) return s;
  if (hasCyrillic(s)) {
    const exactRu = RU_BY_SUBJECT.get(s.toLowerCase());
    if (exactRu) return exactRu;
    return s;
  }

  const exact = RU_BY_SUBJECT.get(s.toLowerCase());
  if (exact) return exact;

  let t = s.replace(/\.$/, "");
  const verb = [
    [/^Add\b/i, "Добавлено:"],
    [/^Fix(ed)?\b/i, "Исправлено:"],
    [/^Restore\b/i, "Восстановлено:"],
    [/^Show\b/i, "Показано:"],
    [/^Mark\b/i, "Помечено:"],
    [/^Improve\b/i, "Улучшено:"],
    [/^Polish\b/i, "Доработано:"],
    [/^Update\b/i, "Обновлено:"],
    [/^Serve\b/i, "Добавлено:"],
    [/^Remove\b/i, "Удалено:"],
    [/^Refactor\b/i, "Рефакторинг:"],
    [/^Make\b/i, "Сделано:"],
    [/^Ship\b/i, "Сделано:"],
    [/^Tighten\b/i, "Уточнены:"],
  ];
  for (const [re, ru] of verb) {
    if (re.test(t)) {
      t = t.replace(re, ru);
      break;
    }
  }

  t = t
    .replace(/\badmin(istration)?\b/gi, "админка")
    .replace(/\bappearance\b/gi, "внешний вид")
    .replace(/\bsettings?\b/gi, "настройки")
    .replace(/\bschematics?\b/gi, "схемы")
    .replace(/\bschemes?\b/gi, "схемы")
    .replace(/\bdeploy notes\b/gi, "заметки деплоя")
    .replace(/\bupdating page\b/gi, "страница обновления")
    .replace(/\bmouse-wheel zoom\b/gi, "зум колёсиком")
    .replace(/\btrackpad\b/gi, "трекпад")
    .replace(/\bfullscreen\b/gi, "полноэкранный режим")
    .replace(/\bpart numbers?\b/gi, "номера деталей")
    .replace(/\bengine-zone rules\b/gi, "правила зон двигателя")
    .replace(/\bwithout breaking\b/gi, "без поломки")
    .replace(/\band\b/gi, "и")
    .replace(/\bwith\b/gi, "с")
    .replace(/\bon\b/gi, "на")
    .replace(/\s+/g, " ")
    .trim();

  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function finishNote(s) {
  let t = normalizeSubject(s);
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

/**
 * Expand a multi-topic subject into several short bullets.
 * Prefer curated RU map (may already join topics); else split on ; · |
 * Avoid comma-splitting English sentences (too noisy).
 */
export function expandDeploySubject(subject) {
  const ru = toRussianDeployNote(subject);
  if (!ru) return [];

  // Curated multi-topic lines use ; — split those
  const semi = ru
    .replace(/\.$/, "")
    .split(/\s*[;·|]\s*/)
    .map((x) => normalizeSubject(x))
    .filter((x) => x.length >= 8);

  if (semi.length >= 2) {
    return semi.map(finishNote).filter((n) => n && !isInternalDeploySubject(n));
  }

  // Cyrillic subjects often use commas between topics
  if (hasCyrillic(ru)) {
    const parts = ru
      .replace(/\.$/, "")
      .split(/\s*,\s+/)
      .map((x) => normalizeSubject(x))
      .filter((x) => x.length >= 8);
    if (parts.length >= 2) {
      return parts.map(finishNote).filter((n) => n && !isInternalDeploySubject(n));
    }
  }

  const one = finishNote(ru);
  if (!one || isInternalDeploySubject(one)) return [];
  return [one];
}

/**
 * Collect notes from subjects (newest first).
 * If the whole commit is internal — skip entirely (no fragment leaks).
 */
export function collectUserFacingNotes(subjects) {
  const seen = new Set();
  const items = [];
  for (const line of subjects) {
    const s = normalizeSubject(line);
    if (!s || isNoiseSubject(s)) continue;
    if (isInternalDeploySubject(s)) continue;
    for (const note of expandDeploySubject(s)) {
      const key = noteKey(note);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(note);
    }
  }
  return items;
}

/** Deterministic PRNG (Mulberry32) for stable sampling per deploy SHA. */
export function createRng(seedText) {
  let h = 2166136261;
  const s = String(seedText || "seed");
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleNotes(items, max, rng) {
  const n = Math.max(0, Math.min(max, items.length));
  if (n === 0) return [];
  if (items.length <= n) return items.slice();
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}

function filterAgainstPrevious(notes, previousItems) {
  const prevKeys = new Set(
    previousItems.map((x) => noteKey(x)).filter(Boolean),
  );
  if (!prevKeys.size) return notes.slice();
  return notes.filter((x) => {
    const k = noteKey(x);
    if (prevKeys.has(k)) return false;
    // substring overlap: "читаемые подписи..." vs longer variant
    for (const pk of prevKeys) {
      if (k.includes(pk) || pk.includes(k)) return false;
    }
    return true;
  });
}

/**
 * Pick deploy notes for this stamp:
 * - prefer notes from `freshSubjects` (commits since previous stamp)
 * - never recycle previous items while fresh candidates exist
 * - cap at max (default 4); random sample if more
 */
export function pickUserFacingDeployNotes(subjects, max = MAX_ITEMS, options = {}) {
  const previousItems = Array.isArray(options.previousItems) ? options.previousItems : [];
  const freshSubjects = Array.isArray(options.freshSubjects) ? options.freshSubjects : null;
  const seed = options.seed != null ? String(options.seed) : subjects.slice(0, 3).join("|");
  const fallback =
    typeof options.fallback === "string" && options.fallback.trim()
      ? options.fallback.trim()
      : "Доступна новая версия справочника.";

  const fromFreshWindow = freshSubjects
    ? collectUserFacingNotes(freshSubjects)
    : collectUserFacingNotes(subjects);
  const fromLookback = collectUserFacingNotes(subjects);

  const freshNew = filterAgainstPrevious(fromFreshWindow, previousItems);
  const lookbackNew = filterAgainstPrevious(fromLookback, previousItems);

  let pool = freshNew;
  if (pool.length < Math.min(3, max)) {
    // Not enough brand-new bullets in the deploy window — fill from lookback,
    // still avoiding previously shown lines.
    const seen = new Set(pool.map(noteKey));
    for (const n of lookbackNew) {
      const k = noteKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push(n);
    }
  }

  // Last resort: allow lookback including previously shown (better than empty),
  // but only if we truly have nothing else.
  if (!pool.length) {
    pool = fromFreshWindow.length ? fromFreshWindow : fromLookback;
  }

  if (!pool.length) return [finishNote(fallback)];

  const rng = typeof options.rng === "function" ? options.rng : createRng(seed);
  return sampleNotes(pool, max, rng);
}
