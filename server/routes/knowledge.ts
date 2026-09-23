import { Router } from "express";
import { createHash } from "node:crypto";
import {
  getKnowledgeArticle,
  listKnowledgeArticles,
  listKnowledgePlatforms,
  normalizeKnowledgePlatformId,
  searchKnowledgeArticles,
} from "../knowledge.js";
import {
  countKbCommentsBySlugs,
  createKbComment,
  listKbComments,
} from "../knowledgeComments.js";
import {
  addKbLike,
  countKbLikesBySlugs,
  getKbLikeCount,
  hasKbLiked,
  hashLikeVoter,
} from "../knowledgeLikes.js";
import { createKbSubmission } from "../knowledgeSubmissions.js";
import { readSiteSettings } from "../siteSettings.js";
import {
  checkTicketRateLimit,
  clientIp,
  issueTicketChallenge,
  markTicketAccepted,
  verifyTicketChallenge,
} from "../ticketGuard.js";

function withEngagement<T extends { slug: string }>(
  articles: T[],
): Array<T & { comment_count: number; like_count: number }> {
  const slugs = articles.map((a) => a.slug);
  const commentsOn = readSiteSettings().features.kbComments !== false;
  const comments = commentsOn ? countKbCommentsBySlugs(slugs) : {};
  const likes = countKbLikesBySlugs(slugs);
  return articles.map((a) => ({
    ...a,
    comment_count: commentsOn ? comments[a.slug] || 0 : 0,
    like_count: likes[a.slug] || 0,
  }));
}

/**
 * Curated KB API.
 */
export function createKnowledgeRouter(): Router {
  const router = Router();

  router.get("/platforms", (_req, res) => {
    const data = listKnowledgePlatforms();
    res.json({ ok: true, ...data });
  });

  router.get("/challenge", (_req, res) => {
    res.json(issueTicketChallenge());
  });

  router.post("/submissions", (req, res) => {
    const b = (req.body || {}) as Record<string, string>;
    if (String(b.website || b.company || "").trim()) {
      res.status(201).json({ ok: true, id: 0, ignored: true });
      return;
    }
    const challengeErr = verifyTicketChallenge(String(b.challenge || ""), String(b.challenge_answer || ""));
    if (challengeErr) {
      res.status(400).json({ ok: false, error: challengeErr });
      return;
    }
    const ip = clientIp(req);
    const payloadHash = createHash("sha256")
      .update([b.kind, b.platform, b.title, b.source_url, b.summary, b.body_md].join("|"))
      .digest("hex");
    const rateErr = checkTicketRateLimit(ip, `kb:${b.platform || ""}`, payloadHash);
    if (rateErr) {
      res.status(429).json({ ok: false, error: rateErr });
      return;
    }
    try {
      const catalog = listKnowledgePlatforms();
      const platform = normalizeKnowledgePlatformId(b.platform, catalog.default_id);
      const sub = createKbSubmission({
        kind: b.kind === "link" ? "link" : "article",
        platform,
        topic: b.topic,
        title: b.title,
        summary: b.summary,
        body_md: b.body_md,
        source_url: b.source_url,
        author_name: b.author_name,
      });
      markTicketAccepted(ip, `kb:${platform}`, payloadHash);
      res.status(201).json({
        ok: true,
        id: sub.id,
        status: sub.status,
        message: "Спасибо! Запись уйдёт в базу после проверки модератором.",
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Ошибка" });
    }
  });

  router.get("/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      res.status(400).json({ ok: false, error: "Укажите q (минимум 2 символа)" });
      return;
    }
    const platformRaw = String(req.query.platform || "").trim();
    const platform = platformRaw ? normalizeKnowledgePlatformId(platformRaw) : null;
    const articles = withEngagement(searchKnowledgeArticles({ q, platform, limit: 40 }));
    res.json({
      ok: true,
      q,
      platform,
      count: articles.length,
      articles,
    });
  });

  router.get("/articles", (req, res) => {
    const catalog = listKnowledgePlatforms();
    const platform = normalizeKnowledgePlatformId(req.query.platform, catalog.default_id);
    const topic = String(req.query.topic || "").trim() || null;
    const articles = withEngagement(listKnowledgeArticles({ platform, topic }));
    res.json({
      ok: true,
      platform,
      topic,
      count: articles.length,
      articles,
    });
  });

  router.get("/articles/:slug", (req, res) => {
    const article = getKnowledgeArticle(req.params.slug);
    if (!article) {
      res.status(404).json({ ok: false, error: "Статья не найдена" });
      return;
    }
    const ip = clientIp(req);
    const commentsOn = readSiteSettings().features.kbComments !== false;
    res.json({
      ok: true,
      article: {
        ...article,
        comment_count: commentsOn ? countKbCommentsBySlugs([article.slug])[article.slug] || 0 : 0,
        like_count: getKbLikeCount(article.slug),
        liked_by_me: hasKbLiked(article.slug, hashLikeVoter(ip)),
      },
      comments_enabled: commentsOn,
    });
  });

  router.get("/articles/:slug/comments", (req, res) => {
    if (readSiteSettings().features.kbComments === false) {
      res.json({ ok: true, comments: [], enabled: false });
      return;
    }
    const article = getKnowledgeArticle(req.params.slug);
    if (!article) {
      res.status(404).json({ ok: false, error: "Статья не найдена" });
      return;
    }
    res.json({
      ok: true,
      enabled: true,
      comments: listKbComments(article.slug),
    });
  });

  router.post("/articles/:slug/comments", (req, res) => {
    if (readSiteSettings().features.kbComments === false) {
      res.status(403).json({ ok: false, error: "Комментарии отключены" });
      return;
    }
    const article = getKnowledgeArticle(req.params.slug);
    if (!article) {
      res.status(404).json({ ok: false, error: "Статья не найдена" });
      return;
    }
    const b = (req.body || {}) as Record<string, string>;
    if (String(b.website || b.company || "").trim()) {
      res.status(201).json({ ok: true, ignored: true });
      return;
    }
    const challengeErr = verifyTicketChallenge(String(b.challenge || ""), String(b.challenge_answer || ""));
    if (challengeErr) {
      res.status(400).json({ ok: false, error: challengeErr });
      return;
    }
    const ip = clientIp(req);
    const payloadHash = createHash("sha256")
      .update([article.slug, b.author_name, b.body].join("|"))
      .digest("hex");
    const rateErr = checkTicketRateLimit(ip, `kb-c:${article.slug}`, payloadHash);
    if (rateErr) {
      res.status(429).json({ ok: false, error: rateErr });
      return;
    }
    try {
      const comment = createKbComment({
        article_slug: article.slug,
        author_name: b.author_name,
        body: b.body,
        ip,
      });
      markTicketAccepted(ip, `kb-c:${article.slug}`, payloadHash);
      res.status(201).json({ ok: true, comment });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Ошибка" });
    }
  });

  router.post("/articles/:slug/like", (req, res) => {
    const slug = String(req.params.slug || "")
      .trim()
      .toLowerCase();
    const article = getKnowledgeArticle(slug);
    if (!article) {
      res.status(404).json({ ok: false, error: "Статья не найдена" });
      return;
    }
    const ip = clientIp(req);
    const rateErr = checkTicketRateLimit(ip, `kb-like:${slug}`, `like:${slug}:${ip}`);
    if (rateErr) {
      res.status(429).json({ ok: false, error: rateErr });
      return;
    }
    try {
      const result = addKbLike(slug, hashLikeVoter(ip));
      if (!result.already) markTicketAccepted(ip, `kb-like:${slug}`, `like:${slug}:${ip}`);
      res.status(result.already ? 200 : 201).json({
        ok: true,
        likes: result.likes,
        already: result.already,
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : "Ошибка" });
    }
  });

  return router;
}
