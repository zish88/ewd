/**
 * Собирает заметки деплоя из git и вшивает их в updating.html + deploy-notes.json.
 * Запуск: node scripts/stamp-updating.mjs  (или npm run stamp:updating)
 *
 * - version: YYYY.MM.DD (дата на машине, где крутится stamp)
 * - git: short HEAD ровно 8 hex (без скачков 7↔8)
 * - items: до 4 пользовательских буллетов из окна prevStamp..HEAD
 *   (старый lookback не «досыпаем» — иначе снова чужие заметки)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GIT_SHORT_LEN,
  MAX_ITEMS,
  formatGitShort,
  pickUserFacingDeployNotes,
} from "./stamp-updating-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notesPath = join(root, "client/public/deploy-notes.json");
const htmlPath = join(root, "client/public/updating.html");

const START = "<!-- DEPLOY_META_START -->";
const END = "<!-- DEPLOY_META_END -->";
const LOOKBACK = 40;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** git с UTF-8 логом — иначе subject'ы на Windows/VPS приедут кракозябрами. */
function git(cmd) {
  return execSync(cmd, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      GIT_UTF8: "1",
    },
  }).trim();
}

function todayVersion() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function readPreviousNotes() {
  if (!existsSync(notesPath)) return { git: "", items: [] };
  try {
    const raw = JSON.parse(readFileSync(notesPath, "utf8"));
    return {
      git: String(raw.git || "").trim(),
      items: Array.isArray(raw.items) ? raw.items.map((x) => String(x || "").trim()).filter(Boolean) : [],
    };
  } catch {
    return { git: "", items: [] };
  }
}

/**
 * lookback — запас на первый stamp / тесты;
 * fresh — коммиты с прошлого stamp (только их показываем на деплое);
 * hasFreshWindow — true, если prevGit нашёлся в репо (даже если fresh пуст).
 *
 * @returns {{ lookback: string[], fresh: string[], window: string, hasFreshWindow: boolean }}
 */
function commitSubjects(prevGit) {
  const lookbackOut = git(
    `git -c i18n.logOutputEncoding=utf-8 log -${LOOKBACK} --pretty=format:%s`,
  );
  const lookback = lookbackOut ? lookbackOut.split("\n").filter(Boolean) : [];

  let fresh = [];
  let window = `HEAD~${LOOKBACK}..HEAD`;
  let hasFreshWindow = false;

  if (prevGit) {
    try {
      // Кавычки обязательны: на Windows голый sha^{commit} ломается на `^`.
      git(`git rev-parse --verify "${prevGit}"`);
      const ranged = git(
        `git -c i18n.logOutputEncoding=utf-8 log "${prevGit}..HEAD" --pretty=format:%s`,
      );
      fresh = ranged ? ranged.split("\n").filter(Boolean) : [];
      window = `${prevGit}..HEAD`;
      hasFreshWindow = true;
    } catch {
      // prevGit битый/не в репо → откат на lookback, без «пустого» fresh-окна
    }
  }

  return { lookback, fresh, window, hasFreshWindow };
}

let gitShort = "local";
try {
  gitShort = formatGitShort(git(`git rev-parse --short=${GIT_SHORT_LEN} HEAD`));
} catch {
  gitShort = "local";
}

const previous = readPreviousNotes();
const { lookback, fresh, window, hasFreshWindow } = commitSubjects(previous.git);
const version = todayVersion();
const items = pickUserFacingDeployNotes(lookback, MAX_ITEMS, {
  previousItems: previous.items,
  // Только когда есть baseline прошлого stamp — иначе lookback (первый stamp).
  freshSubjects: hasFreshWindow ? fresh : null,
  seed: `${gitShort}:${version}:${fresh.length}:${lookback.length}`,
});

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
  window,
};
writeFileSync(notesPath, `${JSON.stringify(notes, null, 2)}\n`, { encoding: "utf8" });

console.log(
  `stamped updating.html → version ${version} · ${gitShort} (${items.length}/${MAX_ITEMS} items, window ${notes.window})`,
);
for (const it of items) console.log(`  • ${it}`);
