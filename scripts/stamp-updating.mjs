/**
 * Auto-build deploy notes from git and embed into updating.html.
 * Usage: node scripts/stamp-updating.mjs
 *
 * - version: YYYY.MM.DD (deploy machine local date)
 * - git: always current short HEAD
 * - items: up to 5 latest *user-facing* commit subjects (admin/infra filtered)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_ITEMS,
  pickUserFacingDeployNotes,
} from "./stamp-updating-lib.mjs";

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
  // Windows consoles often emit CP1251/CP866; force UTF-8 subject bytes into Node.
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

/** Latest commit subjects only — no range from previous stamp. */
function latestCommitSubjects() {
  try {
    const out = git(`git -c i18n.logOutputEncoding=utf-8 log -40 --pretty=format:%s`);
    if (!out) return [];
    return out.split("\n");
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
const items = pickUserFacingDeployNotes(latestCommitSubjects(), MAX_ITEMS);

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
