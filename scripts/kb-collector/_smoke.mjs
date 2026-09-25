import { readFileSync, rmSync } from "node:fs";
import {
  addCollectorSeed,
  ensureKnowledgeCollectorStore,
  getCollectorStatus,
  runKnowledgeCollector,
  warmCollectorCache,
} from "../../server/knowledgeCollector.ts";

process.env.KNOWLEDGE_COLLECTOR_PATH = "data/_test-collector.sqlite";
process.env.KNOWLEDGE_COLLECTOR_CACHE = "data/_test-collector-cache";
process.env.KNOWLEDGE_SUBMISSIONS_PATH = "data/_test-kb-submissions.sqlite";

for (const f of [
  "data/_test-collector.sqlite",
  "data/_test-collector.sqlite-wal",
  "data/_test-collector.sqlite-shm",
  "data/_test-kb-submissions.sqlite",
  "data/_test-kb-submissions.sqlite-wal",
  "data/_test-kb-submissions.sqlite-shm",
]) {
  try {
    rmSync(f, { force: true });
  } catch {
    /* ignore */
  }
}

ensureKnowledgeCollectorStore();
const url = "https://www.drive2.ru/l/fixture-cabin-filter-demo";
warmCollectorCache(url, readFileSync("scripts/kb-collector/fixtures/sample-drive2.html", "utf8"));
console.log("seed", addCollectorSeed({ url, platform: "p3", topic: "parts" }));
const r1 = await runKnowledgeCollector({ mode: "offline", maxNew: 5 });
console.log("run1", { created: r1.created, skipped: r1.skipped, errors: r1.errors, items: r1.items });
const r2 = await runKnowledgeCollector({ mode: "offline", maxNew: 5 });
console.log("run2", { created: r2.created, skipped: r2.skipped, errors: r2.errors });
console.log("pending", getCollectorStatus().pendingDrafts);
