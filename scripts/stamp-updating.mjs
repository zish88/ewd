/**
 * Auto-build deploy notes from git and embed into updating.html.
 * Usage: node scripts/stamp-updating.mjs
 *
 * - version: YYYY.MM.DD (deploy machine local date)
 * - git: always current short HEAD
 * - items: up to 5 latest commit subjects (Merge filtered), shown in Russian
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notesPath = join(root, "client/public/deploy-notes.json");
const htmlPath = join(root, "client/public/updating.html");

const START = "<!-- DEPLOY_META_START -->";
const END = "<!-- DEPLOY_META_END -->";
const MAX_ITEMS = 5;

/** Exact Russian lines for known English commit subjects (display only). */
const RU_BY_SUBJECT = new Map(
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
  }).map(([en, ru]) => [en.toLowerCase(), ru]),
);

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

function todayVersion() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function normalizeSubject(raw) {
  return String(raw || "")
    .replace(/\r/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function isNoiseSubject(s) {
  if (!s) return true;
  if (/^merge\b/i.test(s)) return true;
  return false;
}

function hasCyrillic(s) {
  return /[а-яё]/i.test(s);
}

/** Russian line for the updating page (keeps Cyrillic subjects as-is). */
function toRussianDeployNote(subject) {
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

/** Latest commit subjects only — no range from previous stamp. */
function latestCommitSubjects() {
  try {
    const out = git(`git log -20 --pretty=format:%s`);
    if (!out) return [];
    const seen = new Set();
    const items = [];
    for (const line of out.split("\n")) {
      const s = normalizeSubject(line);
      if (isNoiseSubject(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(toRussianDeployNote(s));
      if (items.length >= MAX_ITEMS) break;
    }
    return items;
  } catch {
    return [];
  }
}

let gitShort = "local";
try {
  gitShort = git("git rev-parse --short HEAD");
} catch {
  gitShort = "local";
}

const version = todayVersion();
const items = latestCommitSubjects();

const listHtml = items.length
  ? `<ul class="deploy-meta__list">${items.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>`
  : "";

const block = `${START}
      <div class="deploy-meta" id="deploy-meta" data-version="${esc(version)}" data-git="${esc(gitShort)}">
        <p class="deploy-meta__ver">версия ${esc(version)} · ${esc(gitShort)}</p>
        ${listHtml}
      </div>
${END}`;

let html = readFileSync(htmlPath, "utf8");
if (!html.includes(START) || !html.includes(END)) {
  console.error("updating.html missing DEPLOY_META markers");
  process.exit(1);
}

const re = new RegExp(
  `${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  "m",
);
html = html.replace(re, block);
writeFileSync(htmlPath, html, { encoding: "utf8" });

const notes = {
  version,
  git: gitShort,
  items,
  stamped_at: new Date().toISOString(),
};
writeFileSync(notesPath, `${JSON.stringify(notes, null, 2)}\n`, { encoding: "utf8" });

console.log(`stamped updating.html → version ${version} · ${gitShort} (${items.length} items)`);
for (const it of items) console.log(`  • ${it}`);
