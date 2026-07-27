/**
 * SLICE-04: batch wiring-scoped extract for all repair-catalog connectors.
 *
 * Usage:
 *   node scripts/build-all-part-images.mjs
 *   node scripts/build-all-part-images.mjs --batch-size 40
 *   node scripts/build-all-part-images.mjs --dry-run
 *   node scripts/build-all-part-images.mjs --codes 3/80,10/1
 *   node scripts/build-all-part-images.mjs --start 0 --limit 2   # first 2 batches only
 *
 * Each batch: python extract_epc_part_images.py --all-catalog --wiring-codes … --primary-only --svg --merge-index
 * Then: tsx scripts/audit-repair-image-coverage.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const catalogPath = join(root, "data", "vida_harness_repair_catalog.json");

function parseArgs(argv) {
  const out = {
    batchSize: 50,
    dryRun: false,
    codes: null,
    start: 0,
    limit: null,
    skipCopyAfterFirst: true,
    python: process.env.PYTHON || "python",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--batch-size") out.batchSize = Math.max(1, Number(argv[++i]) || 50);
    else if (a === "--codes") out.codes = String(argv[++i] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    else if (a === "--start") out.start = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--python") out.python = String(argv[++i] || "python");
    else if (a === "--no-skip-copy") out.skipCopyAfterFirst = false;
  }
  return out;
}

function loadCodes(explicit) {
  if (explicit?.length) return explicit;
  if (!existsSync(catalogPath)) {
    console.error(`Missing catalog: ${catalogPath}`);
    process.exit(1);
  }
  const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
  return Object.keys(cat.connectors || {}).sort((a, b) => {
    const ah = Number(String(a).split("/")[0]);
    const bh = Number(String(b).split("/")[0]);
    if (Number.isFinite(ah) && Number.isFinite(bh) && ah !== bh) return ah - bh;
    return String(a).localeCompare(String(b));
  });
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  if (opts.dryRun) return 0;
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.error) {
    console.error(r.error);
    return 1;
  }
  return r.status ?? 1;
}

const args = parseArgs(process.argv.slice(2));
const codes = loadCodes(args.codes);
const batches = [];
for (let i = 0; i < codes.length; i += args.batchSize) {
  batches.push(codes.slice(i, i + args.batchSize));
}

const start = Math.min(args.start, batches.length);
const end = args.limit == null ? batches.length : Math.min(batches.length, start + args.limit);
const slice = batches.slice(start, end);

console.log(
  `SLICE-04 bulk part images: ${codes.length} codes → ${batches.length} batches (size ${args.batchSize}); running ${slice.length} batches [${start}..${end - 1}]`,
);

let failed = 0;
for (let i = 0; i < slice.length; i++) {
  const batchIndex = start + i;
  const chunk = slice[i];
  const extractArgs = [
    "scripts/extract_epc_part_images.py",
    "--all-catalog",
    "--wiring-codes",
    chunk.join(","),
    "--primary-only",
    "--svg",
    "--merge-index",
    "--skip-probe",
  ];
  if (args.skipCopyAfterFirst && batchIndex > 0) {
    extractArgs.push("--skip-copy");
  }
  console.log(`\n=== Batch ${batchIndex + 1}/${batches.length} (${chunk.length} codes: ${chunk[0]} … ${chunk[chunk.length - 1]}) ===`);
  const code = run(args.python, extractArgs, { dryRun: args.dryRun });
  if (code !== 0) {
    console.error(`Batch ${batchIndex} failed with exit ${code}`);
    failed += 1;
    break;
  }
}

if (!args.dryRun && failed === 0) {
  console.log("\n=== Coverage audit ===");
  const audit = run("npx", ["tsx", "scripts/audit-repair-image-coverage.ts"], { dryRun: false });
  if (audit !== 0) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
