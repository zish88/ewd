/**
 * Shared helpers for public deploy notes (updating.html + Web Push body).
 * Only user-facing changes — skip admin/infra/meta commits.
 */

export const MAX_ITEMS = 5;

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
  }).map(([en, ru]) => [en.toLowerCase(), ru]),
);

export function normalizeSubject(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+/g, " ");
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

  // Explicit admin surface
  if (/\badmin\b/i.test(t)) return true;
  if (/админк/i.test(t)) return true;
  if (/\/admin\b/i.test(t)) return true;

  // Repo hygiene / internal housekeeping — nothing a site visitor should see
  if (/\binternal\b/i.test(t)) return true;
  if (/\bpublic repo\b/i.test(t)) return true;
  if (/\bportal\b/i.test(t)) return true;

  // Ops / keys / deploy tooling (not end-user product)
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

  return false;
}

/** Russian line for the updating page (keeps Cyrillic subjects as-is). */
export function toRussianDeployNote(subject) {
  const s = normalizeSubject(subject);
  if (!s) return s;
  if (hasCyrillic(s)) return s;

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
    .replace(/\bwithout breaking\b/gi, "без поломки")
    .replace(/\band\b/gi, "и")
    .replace(/\bwith\b/gi, "с")
    .replace(/\bon\b/gi, "на")
    .replace(/\s+/g, " ")
    .trim();

  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

/** Pick up to MAX_ITEMS user-facing Russian notes from commit subjects (newest first). */
export function pickUserFacingDeployNotes(subjects, max = MAX_ITEMS) {
  const seen = new Set();
  const items = [];
  for (const line of subjects) {
    const s = normalizeSubject(line);
    // Translate first: mixed commits (product + admin) can map to a user-only RU line.
    if (isNoiseSubject(s)) continue;
    const ru = toRussianDeployNote(s);
    if (isInternalDeploySubject(ru)) continue;
    const key = ru.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(ru);
    if (items.length >= max) break;
  }
  return items;
}
