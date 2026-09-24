import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import request from "supertest";
import {
  getKnowledgeArticle,
  getKnowledgeArticleLocalized,
  listKnowledgeArticles,
  listKnowledgePlatforms,
  normalizeKnowledgePlatformId,
  searchKnowledgeArticles,
} from "../knowledge.js";
import { createKnowledgeRouter } from "./knowledge.js";

describe("knowledge data", () => {
  it("lists platforms with statuses and default p3", () => {
    const cat = listKnowledgePlatforms();
    assert.equal(cat.default_id, "p3");
    assert.ok(cat.platforms.length >= 5);
    const spa = cat.platforms.find((p) => p.id === "spa");
    assert.ok(spa);
    assert.equal(spa.status, "partial");
    const p3 = cat.platforms.find((p) => p.id === "p3");
    assert.equal(p3?.status, "ewd_on_site");
  });

  it("filters articles by platform only", () => {
    const p2 = listKnowledgeArticles({ platform: "p2" });
    assert.ok(p2.length >= 1);
    assert.ok(p2.every((a) => a.platform === "p2"));
    const spa = listKnowledgeArticles({ platform: "spa" });
    assert.ok(spa.every((a) => a.platform === "spa"));
    assert.ok(!p2.some((a) => spa.some((s) => s.slug === a.slug)));
  });

  it("localizes article fields when lang=en", () => {
    const en = getKnowledgeArticleLocalized("p2-washer-pump", "en");
    const ru = getKnowledgeArticleLocalized("p2-washer-pump", "ru");
    assert.ok(en);
    assert.ok(ru);
    assert.notEqual(en!.title, ru!.title);
    assert.equal(en!.needs_en_body, false);
    assert.match(en!.body_md, /Summary|P2/i);
    const list = listKnowledgeArticles({ platform: "p2", lang: "en" });
    assert.ok(list.some((a) => a.slug === "p2-washer-pump" && /washer|pump/i.test(a.title)));
    const plat = listKnowledgePlatforms("en");
    assert.ok(plat.topics.some((t) => t.id === "parts" && /parts/i.test(t.label)));
  });

  it("SLICE-04: each platform has ≥2 parts articles + Drive2 author link", () => {
    for (const id of ["p1", "p2", "p3", "cma", "spa"] as const) {
      const parts = listKnowledgeArticles({ platform: id, topic: "parts" });
      assert.ok(parts.length >= 2, `${id} parts count=${parts.length}`);
    }
    const sample = getKnowledgeArticle("p3-thermostat-d5-pn");
    assert.ok(sample?.author?.post_url?.includes("drive2.ru"));
    assert.ok(sample?.links?.some((l) => l.site === "Drive2" && l.url.includes("drive2.ru")));
  });

  it("search finds thermostat articles on p3", () => {
    const hits = searchKnowledgeArticles({ q: "термостат", platform: "p3" });
    assert.ok(hits.length >= 1);
    assert.ok(hits.every((h) => h.platform === "p3"));
    assert.ok(hits.some((h) => /термостат/i.test(h.title) || /термостат/i.test(h.summary)));
  });

  it("platforms expose article_count", () => {
    const cat = listKnowledgePlatforms();
    for (const p of cat.platforms) {
      assert.ok(typeof p.article_count === "number", `${p.id} missing article_count`);
      assert.ok(p.article_count >= 0);
    }
    assert.ok(!cat.topics.some((t) => t.id === "ewd_status"));
  });

  it("platforms expose silhouette for UI", () => {
    const cat = listKnowledgePlatforms();
    for (const p of cat.platforms) {
      assert.ok(p.silhouette, `${p.id} missing silhouette`);
    }
  });

  it("normalizes unknown platform to default", () => {
    assert.equal(normalizeKnowledgePlatformId("nope"), "p3");
    assert.equal(normalizeKnowledgePlatformId("P2"), "p2");
  });
});

describe("GET /api/knowledge", () => {
  const app = express();
  app.use("/api/knowledge", createKnowledgeRouter());

  it("returns platforms", async () => {
    const res = await request(app).get("/api/knowledge/platforms");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.platforms));
    assert.ok(res.body.platforms.some((p: { id: string }) => p.id === "spa"));
  });

  it("returns only p2 articles for platform=p2", async () => {
    const res = await request(app).get("/api/knowledge/articles?platform=p2");
    assert.equal(res.status, 200);
    assert.equal(res.body.platform, "p2");
    assert.ok(res.body.count >= 1);
    assert.ok(res.body.articles.every((a: { platform: string }) => a.platform === "p2"));
  });

  it("returns article by slug with author for Drive2 pack", async () => {
    const res = await request(app).get("/api/knowledge/articles/spa-cabin-filter-xc60ii");
    assert.equal(res.status, 200);
    assert.equal(res.body.article.slug, "spa-cabin-filter-xc60ii");
    assert.ok(Array.isArray(res.body.article.links));
    assert.ok(res.body.article.author?.post_url?.includes("drive2.ru"));
  });

  it("GET /search finds articles by problem text", async () => {
    const res = await request(app).get("/api/knowledge/search?q=фильтр&platform=spa");
    assert.equal(res.status, 200);
    assert.ok(res.body.count >= 1);
    assert.ok(res.body.articles.every((a: { platform: string }) => a.platform === "spa"));
  });
});
