import { existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const manualDir =
  process.env.MANUAL_DIR ??
  (existsSync(join(repoRoot, "data", "ewd"))
    ? join(repoRoot, "data", "ewd")
    : "E:\\manual");
const dbPath = join("data", "wiring.sqlite");

function run(step, total, message, command, args, shell) {
  console.log(`\n[${step}/${total}] ${message}`);
  console.log("--------------------------------------------------");
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(executable, args, { stdio: "inherit", shell, windowsHide: false });
  if (result.error || result.status !== 0) {
    console.error(`✗ Шаг ${step} завершился с ошибкой.`);
    console.error(`Команда: ${executable} ${args.join(" ")}`);
    if (result.error) {
      console.error(`Причина запуска: ${result.error.name}: ${result.error.message}`);
    }
    process.exit(result.status ?? 1);
  }
  console.log("✓ Успешно обработано!");
}

const enPdf = join(manualDir, "Электросхемы XC70.pdf");
const ruPdf = join(manualDir, "Электросхемы XC70 rus.pdf");
if (!existsSync(enPdf) || !existsSync(ruPdf)) {
  console.error("✗ PDF мануалы не найдены в", manualDir);
  process.exit(1);
}

const totalSteps = 3;
let step = 1;

run(step++, totalSteps, "🔍 npm install...", "npm", ["install"], true);

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${dbPath}${suffix}`;
  if (existsSync(file)) {
    unlinkSync(file);
    console.log(`🗑️ Удалена старая БД: ${file}`);
  }
}

run(
  step++,
  totalSteps,
  "🐍 ETL: manuals / pages / components / wire_connections...",
  "python",
  ["scripts/full_reimport.py"],
  true,
);

console.log("\n==================================================");
console.log("🚀 Нормализованная БД XC70 готова (EN + RU).");
console.log("🖥️ Запускаю сервер...");
console.log("==================================================");

run(step++, totalSteps, "🖥️ Запуск dev-сервера...", "npm", ["run", "dev"], true);
