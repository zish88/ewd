#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result;
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} требует значение`);
  return value;
}

function valuesAfter(flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== flag) continue;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) fail(`${flag} требует значение`);
    values.push(value);
  }
  return values;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Безопасный commit + push для Volvo EWD.

Использование:
  npm run git:save -- --message "Описание изменений"

Параметры:
  --message, -m TEXT       сообщение коммита (обязательно)
  --path PATH              добавить только путь; можно повторять
  --all                    включить новые безопасные файлы
  --skip-check             не запускать npm run build
  --no-push                создать только локальный коммит
  --remote NAME            remote, по умолчанию origin
  --allow-protected        разрешить push из main/master
  --include-staged         включить уже staged изменения

По умолчанию добавляются только изменённые tracked-файлы. Базы SQLite,
.env, client/dist, node_modules и data/reports автоматически исключены.
`);
  process.exit(0);
}

const message =
  valueAfter("--message") ||
  valueAfter("-m");
if (!message.trim()) fail("укажите --message \"Описание изменений\"");

const remote = valueAfter("--remote") || "origin";
const paths = valuesAfter("--path");
const includeAll = args.includes("--all");
const skipCheck = args.includes("--skip-check");
const noPush = args.includes("--no-push");
const allowProtected = args.includes("--allow-protected");
const includeStaged = args.includes("--include-staged");

run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });
const branch = run("git", ["branch", "--show-current"], { capture: true }).stdout.trim();
if (!branch) fail("detached HEAD: сначала переключитесь на ветку");
if (!noPush && /^(main|master)$/i.test(branch) && !allowProtected) {
  fail(`ветка ${branch} защищена; повторите с --allow-protected после проверки diff`);
}

const hadStaged = run("git", ["diff", "--cached", "--quiet"], {
  capture: true,
  allowFailure: true,
}).status !== 0;
if (hadStaged && !includeStaged) {
  fail("уже есть staged изменения; закоммитьте их отдельно или добавьте --include-staged");
}

if (!skipCheck) {
  console.log("==> npm run build");
  run(npmCommand, ["run", "build"]);
}

const exclusions = [
  ":(exclude).env",
  ":(exclude).env.*",
  ":(exclude)data/*.sqlite",
  ":(exclude)data/*.sqlite-*",
  ":(exclude)data/reports/**",
  ":(exclude)client/dist/**",
  ":(exclude)node_modules/**",
  ":(exclude)*.log",
];

console.log("==> staging");
if (paths.length) {
  run("git", ["add", "--", ...paths]);
} else {
  run("git", ["add", includeAll ? "-A" : "-u", "--", ".", ...exclusions]);
}

const staged = run("git", ["diff", "--cached", "--name-only"], { capture: true })
  .stdout.trim();
if (!staged) fail("нет изменений для коммита");

const forbidden = staged
  .split(/\r?\n/)
  .filter((path) =>
    /(^|\/)\.env(?:\.|$)|data\/.*\.sqlite(?:-|$)|^data\/reports\/|^client\/dist\/|^node_modules\//i.test(path),
  );
if (forbidden.length) {
  run("git", ["restore", "--staged", "--", ...forbidden], { allowFailure: true });
  fail(`в staged найдены запрещённые файлы:\n${forbidden.join("\n")}`);
}

console.log("==> staged files");
console.log(staged);
run("git", ["diff", "--cached", "--stat"]);

console.log("==> commit");
run("git", ["commit", "-m", message.trim()]);

if (noPush) {
  console.log(`Готово: локальный коммит в ${branch}; push пропущен.`);
  process.exit(0);
}

console.log(`==> push ${remote} HEAD (${branch})`);
run("git", ["push", "-u", remote, "HEAD"]);
console.log(`Готово: commit + push в ${remote}/${branch}.`);
