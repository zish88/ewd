/**
 * Apply English KB fields from data/knowledge/_en_batches/*.json
 * and update index.json topics + platforms.json subtitles.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join("data", "knowledge");
const batchDir = path.join(root, "_en_batches");

const translations = {};
if (fs.existsSync(batchDir)) {
  for (const f of fs.readdirSync(batchDir).filter((x) => x.endsWith(".json"))) {
    const chunk = JSON.parse(fs.readFileSync(path.join(batchDir, f), "utf8"));
    Object.assign(translations, chunk);
  }
}

const missing = [];
for (const [slug, en] of Object.entries(translations)) {
  const articlePath = path.join(root, "articles", `${slug}.json`);
  if (!fs.existsSync(articlePath)) {
    missing.push({ slug, reason: "no article file" });
    continue;
  }
  const article = JSON.parse(fs.readFileSync(articlePath, "utf8"));
  article.title_en = en.title_en;
  article.summary_en = en.summary_en;
  article.body_md_en = en.body_md_en;
  fs.writeFileSync(articlePath, JSON.stringify(article, null, 2) + "\n");
}

const idxPath = path.join(root, "index.json");
const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
for (const meta of idx.articles) {
  const en = translations[meta.slug];
  if (!en) continue;
  meta.title_en = en.title_en;
  meta.summary_en = en.summary_en;
}

const topicEn = {
  parts: "Parts",
  electrical: "Electrical / faults",
  links: "Useful links",
};
for (const t of idx.topics) {
  if (topicEn[t.id]) t.label_en = topicEn[t.id];
}

fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n");

const platPath = path.join(root, "platforms.json");
const plat = JSON.parse(fs.readFileSync(platPath, "utf8"));
const subEn = {
  p1: "850 · S70 · V70 · XC70 (early)",
  p2: "S60 · V70 · XC70 · S80 (2000–2007)",
  p3: "XC70 · V70 · S80 · XC60 · S60 · V60",
  cma: "XC40 · C40",
  spa: "XC90 · XC60 II · S90 · V90",
};
for (const p of plat.platforms) {
  if (subEn[p.id]) p.subtitle_en = subEn[p.id];
}
fs.writeFileSync(platPath, JSON.stringify(plat, null, 2) + "\n");

const articleFiles = fs
  .readdirSync(path.join(root, "articles"))
  .filter((f) => f.endsWith(".json"));
let titleEn = 0;
let summaryEn = 0;
let bodyEn = 0;
const noEn = [];
for (const f of articleFiles) {
  const a = JSON.parse(fs.readFileSync(path.join(root, "articles", f), "utf8"));
  const te = (a.title_en || "").trim();
  const se = (a.summary_en || "").trim();
  const be = (a.body_md_en || "").trim();
  if (te) titleEn++;
  else noEn.push(a.slug);
  if (se) summaryEn++;
  if (be) bodyEn++;
}

console.log(
  JSON.stringify(
    {
      translationKeys: Object.keys(translations).length,
      title_en: titleEn,
      summary_en: summaryEn,
      body_md_en: bodyEn,
      missingArticleFiles: missing,
      articlesWithoutEn: noEn.length,
      sampleMissing: noEn.slice(0, 10),
    },
    null,
    2,
  ),
);
