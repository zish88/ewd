/**
 * Curated knowledge base by Volvo platform (file-backed, no scrapers).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type KnowledgePlatformStatus = "full" | "partial" | "ewd_on_site";

export type KnowledgeLang = "ru" | "en";

export type KnowledgePlatform = {
  id: string;
  label: string;
  subtitle: string;
  subtitle_en?: string;
  order: number;
  status: KnowledgePlatformStatus;
  silhouette?: string;
  models_short?: string[];
};

export type KnowledgeTopic = {
  id: string;
  label: string;
  label_en?: string;
};

export type KnowledgeLink = {
  title: string;
  url: string;
  site?: string;
};

export type KnowledgeAuthor = {
  name?: string;
  profile_url?: string;
  post_url?: string;
};

export type KnowledgeArticleMeta = {
  slug: string;
  title: string;
  title_en?: string;
  platform: string;
  topics: string[];
  summary: string;
  summary_en?: string;
  updated?: string;
  component_code?: string | null;
};

export type KnowledgeArticle = KnowledgeArticleMeta & {
  body_md: string;
  body_md_en?: string;
  links: KnowledgeLink[];
  author?: KnowledgeAuthor | null;
  /** Effective language of title/summary/body after localize. */
  content_lang?: KnowledgeLang;
  /** True when lang=en but body_md_en is missing — UI shows RU body + notice. */
  needs_en_body?: boolean;
};

export function parseKnowledgeLang(raw: unknown): KnowledgeLang {
  return String(raw || "")
    .trim()
    .toLowerCase() === "en"
    ? "en"
    : "ru";
}

type PlatformsFile = {
  default_id: string;
  platforms: KnowledgePlatform[];
};

type IndexFile = {
  topics: KnowledgeTopic[];
  articles: KnowledgeArticleMeta[];
};

const ROOT = resolve(process.env.KNOWLEDGE_DIR ?? "data/knowledge");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadPlatformsFile(): PlatformsFile {
  return readJson<PlatformsFile>(join(ROOT, "platforms.json"));
}

function loadIndexFile(): IndexFile {
  return readJson<IndexFile>(join(ROOT, "index.json"));
}

export function knowledgeRoot(): string {
  return ROOT;
}

export function listKnowledgePlatforms(lang: KnowledgeLang = "ru"): {
  default_id: string;
  platforms: Array<KnowledgePlatform & { article_count: number }>;
  topics: KnowledgeTopic[];
  article_counts: Record<string, number>;
} {
  const platforms = loadPlatformsFile();
  const index = loadIndexFile();
  const sorted = [...platforms.platforms].sort((a, b) => a.order - b.order);
  const article_counts: Record<string, number> = {};
  for (const a of index.articles) {
    const id = String(a.platform || "").toLowerCase();
    if (!id) continue;
    article_counts[id] = (article_counts[id] || 0) + 1;
  }
  const topics = (Array.isArray(index.topics) ? index.topics : []).filter((t) => t.id !== "ewd_status");
  return {
    default_id: platforms.default_id || "p3",
    platforms: sorted.map((p) => {
      const subtitle =
        lang === "en" && p.subtitle_en?.trim() ? p.subtitle_en.trim() : p.subtitle;
      return {
        ...p,
        subtitle,
        article_count: article_counts[p.id] || 0,
      };
    }),
    topics: topics.map((t) => ({
      ...t,
      label: lang === "en" && t.label_en?.trim() ? t.label_en.trim() : t.label,
    })),
    article_counts,
  };
}

export function normalizeKnowledgePlatformId(raw: unknown, defaultId = "p3"): string {
  const id = String(raw || "")
    .trim()
    .toLowerCase();
  const { platforms } = listKnowledgePlatforms();
  if (platforms.some((p) => p.id === id)) return id;
  return defaultId;
}

function metaFromIndex(a: KnowledgeArticleMeta): KnowledgeArticleMeta {
  return {
    slug: a.slug,
    title: a.title,
    title_en: a.title_en || undefined,
    platform: a.platform,
    topics: [...(a.topics || [])],
    summary: a.summary || "",
    summary_en: a.summary_en || undefined,
    updated: a.updated,
    component_code: a.component_code ?? null,
  };
}

export function localizeArticleMeta(
  meta: KnowledgeArticleMeta,
  lang: KnowledgeLang,
): KnowledgeArticleMeta & { content_lang: KnowledgeLang } {
  if (lang !== "en") {
    return { ...meta, content_lang: "ru" };
  }
  const titleEn = String(meta.title_en || "").trim();
  const summaryEn = String(meta.summary_en || "").trim();
  return {
    ...meta,
    title: titleEn || meta.title,
    summary: summaryEn || meta.summary || "",
    content_lang: "en",
  };
}

export function localizeArticle(article: KnowledgeArticle, lang: KnowledgeLang): KnowledgeArticle {
  if (lang !== "en") {
    return { ...article, content_lang: "ru", needs_en_body: false };
  }
  const titleEn = String(article.title_en || "").trim();
  const summaryEn = String(article.summary_en || "").trim();
  const bodyEn = String(article.body_md_en || "").trim();
  return {
    ...article,
    title: titleEn || article.title,
    summary: summaryEn || article.summary || "",
    body_md: bodyEn || article.body_md || "",
    content_lang: "en",
    needs_en_body: !bodyEn,
  };
}

export function listKnowledgeArticles(opts: {
  platform: string;
  topic?: string | null;
  lang?: KnowledgeLang;
}): Array<KnowledgeArticleMeta & { content_lang: KnowledgeLang }> {
  const platform = normalizeKnowledgePlatformId(opts.platform);
  const topic = String(opts.topic || "")
    .trim()
    .toLowerCase();
  const lang = opts.lang || "ru";
  const index = loadIndexFile();
  return index.articles
    .filter((a) => a.platform === platform)
    .filter((a) => !topic || (Array.isArray(a.topics) && a.topics.includes(topic)))
    .map((a) => localizeArticleMeta(metaFromIndex(a), lang));
}

function normQuery(q: string): string[] {
  return String(q || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Search curated articles by problem text (title/summary/body/topics). Optional platform filter. */
export function searchKnowledgeArticles(opts: {
  q: string;
  platform?: string | null;
  limit?: number;
  lang?: KnowledgeLang;
}): Array<KnowledgeArticleMeta & { score: number; content_lang: KnowledgeLang }> {
  const tokens = normQuery(opts.q);
  if (!tokens.length) return [];
  const platformFilter = opts.platform
    ? normalizeKnowledgePlatformId(opts.platform)
    : null;
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 50);
  const lang = opts.lang || "ru";
  const index = loadIndexFile();
  const scored: Array<KnowledgeArticleMeta & { score: number }> = [];

  for (const meta of index.articles) {
    if (platformFilter && meta.platform !== platformFilter) continue;
    const full = getKnowledgeArticle(meta.slug);
    const hayTitle = `${meta.title} ${meta.title_en || ""}`.toLowerCase();
    const haySummary = `${meta.summary || ""} ${meta.summary_en || ""}`.toLowerCase();
    const hayTopics = (meta.topics || []).join(" ").toLowerCase();
    const hayBody = `${full?.body_md || ""} ${full?.body_md_en || ""}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hayTitle.includes(t)) score += 8;
      if (haySummary.includes(t)) score += 4;
      if (hayTopics.includes(t)) score += 3;
      if (hayBody.includes(t)) score += 2;
    }
    if (score <= 0) continue;
    scored.push({
      ...metaFromIndex(meta),
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"));
  return scored.slice(0, limit).map((a) => {
    const { score, ...meta } = a;
    return { ...localizeArticleMeta(meta, lang), score };
  });
}

export function getKnowledgeArticle(slugRaw: string): KnowledgeArticle | null {
  const slug = String(slugRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!slug) return null;

  const index = loadIndexFile();
  const meta = index.articles.find((a) => a.slug === slug);
  if (!meta) return null;

  const articlePath = join(ROOT, "articles", `${slug}.json`);
  if (!existsSync(articlePath)) {
    return {
      ...metaFromIndex(meta),
      body_md: meta.summary || "",
      links: [],
      author: null,
    };
  }

  const full = readJson<Partial<KnowledgeArticle> & { slug?: string }>(articlePath);
  const authorRaw = full.author;
  let author: KnowledgeAuthor | null = null;
  if (authorRaw && typeof authorRaw === "object") {
    const post_url = authorRaw.post_url ? String(authorRaw.post_url).trim() : "";
    const profile_url = authorRaw.profile_url ? String(authorRaw.profile_url).trim() : "";
    const name = authorRaw.name ? String(authorRaw.name).trim() : "";
    if (post_url.startsWith("http") || profile_url.startsWith("http") || name) {
      author = {
        ...(name ? { name } : {}),
        ...(post_url.startsWith("http") ? { post_url } : {}),
        ...(profile_url.startsWith("http") ? { profile_url } : {}),
      };
    }
  }

  return {
    slug: meta.slug,
    title: String(full.title || meta.title),
    title_en: String(full.title_en || meta.title_en || "").trim() || undefined,
    platform: String(full.platform || meta.platform),
    topics: Array.isArray(full.topics) ? full.topics.map(String) : [...(meta.topics || [])],
    summary: String(full.summary || meta.summary || ""),
    summary_en: String(full.summary_en || meta.summary_en || "").trim() || undefined,
    updated: full.updated || meta.updated,
    component_code:
      full.component_code !== undefined ? full.component_code || null : meta.component_code ?? null,
    body_md: String(full.body_md || meta.summary || ""),
    body_md_en: String(full.body_md_en || "").trim() || undefined,
    links: Array.isArray(full.links)
      ? full.links
          .map((l) => ({
            title: String(l.title || l.url || "").trim(),
            url: String(l.url || "").trim(),
            site: l.site ? String(l.site) : undefined,
          }))
          .filter((l) => l.url.startsWith("http"))
      : [],
    author,
  };
}

export function getKnowledgeArticleLocalized(
  slugRaw: string,
  lang: KnowledgeLang,
): KnowledgeArticle | null {
  const article = getKnowledgeArticle(slugRaw);
  if (!article) return null;
  return localizeArticle(article, lang);
}
