/**
 * Вшивает версию/git в updating.html + deploy-notes.json.
 * Список «что нового» больше не генерируем — детали на Drive2.
 * Запуск: node scripts/stamp-updating.mjs  (или npm run stamp:updating)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_SHORT_LEN, formatGitShort } from "./stamp-updating-lib.mjs";

/** Бортжурнал: что нового пишете вы вручную. */
export const DRIVE2_CHANGELOG_URL =
  "https://www.drive2.ru/r/volvo/xc70/645101615031802914/";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notesPath = join(root, "client/public/deploy-notes.json");
const htmlPath = join(root, "client/public/updating.html");

const START = "<!-- DEPLOY_META_START -->";
const END = "<!-- DEPLOY_META_END -->";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function readPreviousGit() {
  if (!existsSync(notesPath)) return "";
  try {
    const raw = JSON.parse(readFileSync(notesPath, "utf8"));
    return String(raw.git || "").trim();
  } catch {
    return "";
  }
}

let gitShort = "local";
try {
  gitShort = formatGitShort(git(`git rev-parse --short=${GIT_SHORT_LEN} HEAD`));
} catch {
  gitShort = "local";
}

const previousGit = readPreviousGit();
const version = todayVersion();
const drive2 = DRIVE2_CHANGELOG_URL;

const block = `${START}
      <div class="deploy-meta" id="deploy-meta" data-version="${esc(version)}" data-git="${esc(gitShort)}">
        <p class="deploy-meta__ver">версия ${esc(version)} · ${esc(gitShort)}</p>
        <p class="deploy-meta__drive2">
          <a class="deploy-meta__link" href="${esc(drive2)}" target="_blank" rel="noopener noreferrer">Что нового — на Drive2</a>
        </p>
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
  items: [],
  drive2_url: drive2,
  stamped_at: new Date().toISOString(),
  window: previousGit ? `${previousGit}..HEAD` : "HEAD",
};
writeFileSync(notesPath, `${JSON.stringify(notes, null, 2)}\n`, { encoding: "utf8" });

console.log(`stamped updating.html → version ${version} · ${gitShort} (Drive2 changelog link)`);
