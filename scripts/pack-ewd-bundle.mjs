/**
 * Pack minimal EWD runtime assets for VPS (SVGs + connectivity + Signals + PDF).
 * Output: dist-upload/ewd-runtime.zip
 */
import { createWriteStream, existsSync, mkdirSync, statSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const SRC = join(ROOT, "data", "ewd", "ewd_source", "39363002", "1", "2");
const OUT_DIR = join(ROOT, "dist-upload");
const STAGE = join(OUT_DIR, "stage");
const LIVE = join(STAGE, "ewd_source", "39363002", "1", "2");

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function copyOne(absFrom, absTo) {
  ensureDir(dirname(absTo));
  copyFileSync(absFrom, absTo);
  return statSync(absFrom).size;
}

function resolveStored(stored) {
  const posix = String(stored || "").replace(/\\/g, "/");
  const m = posix.match(/ewd_source\/39363002\/1\/2\/(.+)$/i);
  const rel = m ? m[1] : posix.split("/").slice(-2).join("/");
  const cand = join(SRC, rel);
  if (existsSync(cand)) return { abs: cand, rel };
  return null;
}

ensureDir(LIVE);
let bytes = 0;
let files = 0;
const seen = new Set();

function take(abs, rel) {
  const key = rel.replace(/\\/g, "/");
  if (seen.has(key)) return;
  if (!existsSync(abs)) return;
  seen.add(key);
  bytes += copyOne(abs, join(LIVE, key));
  files++;
}

const svgIdx = JSON.parse(readFileSync(join(ROOT, "data/ewd/svg_desc_index.json"), "utf8"));
for (const d of Object.values(svgIdx.diagrams || {})) {
  const hit = resolveStored(d.svg);
  if (hit) take(hit.abs, hit.rel);
}

const connIdx = JSON.parse(readFileSync(join(ROOT, "data/ewd/connectivity_index.json"), "utf8"));
const fileLists = [];
for (const bySys of Object.values(connIdx.codeToSystemFiles || {})) {
  for (const arr of Object.values(bySys || {})) fileLists.push(...(arr || []));
}
for (const arr of Object.values(connIdx.codeToConnectivityFiles || {})) fileLists.push(...(arr || []));

for (const name of new Set(fileLists.filter(Boolean))) {
  // filenames only — live under dataDir
  const abs = join(SRC, name);
  if (existsSync(abs)) take(abs, name);
  else {
    // sometimes nested
    const hit = resolveStored(name);
    if (hit) take(hit.abs, hit.rel);
  }
}

// Signals folder (highlight / wire names)
const signals = join(SRC, "Signals");
if (existsSync(signals)) {
  execSync(`powershell -NoProfile -Command "Copy-Item -Recurse -Force '${signals}' '${join(LIVE, "Signals")}'"`, {
    stdio: "inherit",
  });
}

// PDF for tables
const pdfCandidates = [
  join(ROOT, "data", "ewd", "Электросхемы XC70.pdf"),
  "E:/manual/Электросхемы XC70.pdf",
];
ensureDir(join(STAGE, "manual"));
for (const p of pdfCandidates) {
  if (existsSync(p)) {
    copyFileSync(p, join(STAGE, "manual", "Электросхемы XC70.pdf"));
    bytes += statSync(p).size;
    files++;
    break;
  }
}

console.log({ files: seen.size, copiedTracked: files, mb: Math.round(bytes / 1024 / 1024), stage: STAGE });

const zipPath = join(OUT_DIR, "ewd-runtime.zip");
if (existsSync(zipPath)) {
  try {
    execSync(`del /f "${zipPath}"`, { shell: "cmd.exe" });
  } catch {}
}
// Use tar.exe (Windows 10+) to make a zip-compatible archive, or Compress-Archive
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${join(STAGE, "*")}' -DestinationPath '${zipPath}' -Force"`,
  { stdio: "inherit" },
);
console.log("ZIP", zipPath, Math.round(statSync(zipPath).size / 1024 / 1024), "MB");
