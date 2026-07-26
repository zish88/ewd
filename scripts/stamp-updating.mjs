/**
 * Auto-build deploy notes from git and embed into updating.html.
 * Usage: node scripts/stamp-updating.mjs
 *
 * - version: YYYY.MM.DD (deploy machine local date)
 * - git: always current short HEAD
 * - items: up to 4 *new* user-facing notes (random sample if more)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const LOOKBACK = 40;

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
 * @returns {{ lookback: string[], fresh: string[], window: string }}
 */
function commitSubjects(prevGit) {
  const lookbackOut = git(
    `git -c i18n.logOutputEncoding=utf-8 log -${LOOKBACK} --pretty=format:%s`,
  );
  const lookback = lookbackOut ? lookbackOut.split("\n").filter(Boolean) : [];

  let fresh = [];
  let window = `HEAD~${LOOKBACK}..HEAD`;

  if (prevGit) {
    try {
      // Quote for Windows cmd/PowerShell — bare `sha^{commit}` breaks on `^`.
      git(`git rev-parse --verify "${prevGit}"`);
      const ranged = git(
        `git -c i18n.logOutputEncoding=utf-8 log "${prevGit}..HEAD" --pretty=format:%s`,
      );
      fresh = ranged ? ranged.split("\n").filter(Boolean) : [];
      window = `${prevGit}..HEAD`;
    } catch {
      /* keep lookback-only */
    }
  }

  return { lookback, fresh, window };
}

let gitShort = "local";
try {
  gitShort = git("git rev-parse --short HEAD");
} catch {
  gitShort = "local";
}

const previous = readPreviousNotes();
const { lookback, fresh, window } = commitSubjects(previous.git);
const version = todayVersion();
const items = pickUserFacingDeployNotes(lookback, MAX_ITEMS, {
  previousItems: previous.items,
  freshSubjects: fresh,
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
