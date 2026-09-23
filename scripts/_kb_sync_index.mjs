import fs from "node:fs";
import path from "node:path";

const root = "data/knowledge";
const idxPath = path.join(root, "index.json");
const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
const have = new Set(idx.articles.map((a) => a.slug));
const files = fs.readdirSync(path.join(root, "articles")).filter((f) => f.endsWith(".json"));

let added = 0;
for (const f of files) {
  const slug = f.replace(/\.json$/, "");
  if (have.has(slug)) continue;
  const a = JSON.parse(fs.readFileSync(path.join(root, "articles", f), "utf8"));
  idx.articles.push({
    slug: a.slug,
    title: a.title,
    platform: a.platform,
    topics: a.topics || ["parts"],
    summary: a.summary || "",
    updated: a.updated || "2026-09-23",
  });
  have.add(slug);
  added++;
}

fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n");

const by = {};
for (const a of idx.articles) by[a.platform] = (by[a.platform] || 0) + 1;

const urlOwners = new Map();
let dups = 0;
const skipHost = /matthews|swedespeed|nhtsa/i;
for (const f of files) {
  const a = JSON.parse(fs.readFileSync(path.join(root, "articles", f), "utf8"));
  const urls = [...(a.links || []).map((l) => l.url), a.author?.post_url]
    .filter(Boolean)
    .map((u) => String(u).replace(/\/$/, "").toLowerCase())
    .filter((u) => !skipHost.test(u));
  for (const u of urls) {
    const prev = urlOwners.get(u);
    if (prev && prev !== a.slug) {
      console.log("DUP", u, prev, a.slug);
      dups++;
    } else urlOwners.set(u, a.slug);
  }
}

console.log(JSON.stringify({ total: idx.articles.length, added, by, dups, drive2Urls: urlOwners.size }, null, 2));
