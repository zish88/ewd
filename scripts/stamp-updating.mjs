/**
 * Embed deploy-notes.json into updating.html between DEPLOY_META markers.
 * Usage: node scripts/stamp-updating.mjs
 * Sets git short SHA from `git rev-parse --short HEAD` when available.
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

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let notes;
try {
  notes = JSON.parse(readFileSync(notesPath, "utf8"));
} catch (e) {
  console.error("Failed to read deploy-notes.json:", e.message);
  process.exit(1);
}

let git = String(notes.git || "").trim();
if (!git) {
  try {
    git = execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    git = "local";
  }
}

const version = String(notes.version || "").trim() || "dev";
const items = (Array.isArray(notes.items) ? notes.items : [])
  .map((x) => String(x || "").trim())
  .filter(Boolean)
  .slice(0, 5);

const listHtml = items.length
  ? `<ul class="deploy-meta__list">${items.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>`
  : "";

const block = `${START}
      <div class="deploy-meta" id="deploy-meta" data-version="${esc(version)}" data-git="${esc(git)}">
        <p class="deploy-meta__ver">версия ${esc(version)} · ${esc(git)}</p>
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

// Keep git field in JSON for humans / next stamp (preserve Cyrillic)
notes.git = git;
writeFileSync(notesPath, `${JSON.stringify(notes, null, 2)}\n`, { encoding: "utf8" });

console.log(`stamped updating.html → version ${version} · ${git} (${items.length} items)`);
