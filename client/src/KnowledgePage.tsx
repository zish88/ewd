import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type PlatformStatus = "full" | "partial" | "ewd_on_site";

type Platform = {
  id: string;
  label: string;
  subtitle: string;
  order: number;
  status: PlatformStatus;
  models_short?: string[];
  article_count?: number;
};

type Topic = { id: string; label: string };

type ArticleMeta = {
  slug: string;
  title: string;
  platform: string;
  topics: string[];
  summary: string;
  updated?: string;
  component_code?: string | null;
  score?: number;
  comment_count?: number;
  like_count?: number;
};

type ArticleLink = { title: string; url: string; site?: string };

type ArticleAuthor = {
  name?: string;
  profile_url?: string;
  post_url?: string;
};

type Article = ArticleMeta & {
  body_md: string;
  links: ArticleLink[];
  author?: ArticleAuthor | null;
  liked_by_me?: boolean;
};

type KbComment = {
  id: number;
  created_at: string;
  article_slug: string;
  author_name: string;
  body: string;
};

const LS_PLATFORM = "volvoKbPlatform";

/** Unified short badge — same look for every platform */
const STATUS_BADGE: Record<PlatformStatus, string> = {
  full: "полно",
  partial: "частично",
  ewd_on_site: "частично",
};

const STATUS_HINT: Record<PlatformStatus, string> = {
  full: "материалы полные",
  partial: "ограниченно — курируемые заметки",
  ewd_on_site: "схемы EWD на сайте · KB — FAQ и запчасти",
};

function readInitialPlatform(defaultId: string): string {
  const q = new URLSearchParams(window.location.search);
  const fromUrl = (q.get("platform") || "").trim().toLowerCase();
  if (fromUrl) return fromUrl;
  try {
    const saved = localStorage.getItem(LS_PLATFORM);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return defaultId;
}

function readInitialTopic(): string | null {
  const t = new URLSearchParams(window.location.search).get("topic");
  if (!t) return null;
  const id = t.trim().toLowerCase();
  if (id === "ewd_status") return null;
  return id;
}

function readInitialSlug(): string | null {
  const s = new URLSearchParams(window.location.search).get("slug");
  return s ? s.trim().toLowerCase() : null;
}

function readInitialQuery(): string {
  return (new URLSearchParams(window.location.search).get("q") || "").trim();
}

function syncUrl(platform: string, topic: string | null, slug: string | null, q: string) {
  const params = new URLSearchParams();
  params.set("platform", platform);
  if (topic) params.set("topic", topic);
  if (slug) params.set("slug", slug);
  if (q.trim()) params.set("q", q.trim());
  const next = `/knowledge?${params.toString()}`;
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState(null, "", next);
  }
}

/** Minimal safe markdown → React */
function SimpleMarkdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const nodes: ReactNode[] = [];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi].trim();
    if (!block) continue;

    if (/^##\s+/.test(block)) {
      nodes.push(
        <h2 key={bi} className="kb-md__h2">
          {inlineMd(block.replace(/^##\s+/, ""))}
        </h2>,
      );
      continue;
    }
    if (/^#\s+/.test(block)) {
      nodes.push(
        <h1 key={bi} className="kb-md__h1">
          {inlineMd(block.replace(/^#\s+/, ""))}
        </h1>,
      );
      continue;
    }

    const lines = block.split("\n");
    if (lines.every((l) => /^\d+\.\s+/.test(l.trim()) || /^[-*]\s+/.test(l.trim()))) {
      const ordered = lines.every((l) => /^\d+\.\s+/.test(l.trim()));
      const Tag = ordered ? "ol" : "ul";
      nodes.push(
        <Tag key={bi} className="kb-md__list">
          {lines.map((l, i) => (
            <li key={i}>{inlineMd(l.trim().replace(/^\d+\.\s+/, "").replace(/^[-*]\s+/, ""))}</li>
          ))}
        </Tag>,
      );
      continue;
    }

    nodes.push(
      <p key={bi} className="kb-md__p">
        {lines.map((l, i) => (
          <span key={i}>
            {i > 0 ? <br /> : null}
            {inlineMd(l)}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="kb-md">{nodes}</div>;
}

function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[([^\]]+)\]\((https?:[^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <a key={key++} href={m[3]} target="_blank" rel="noopener noreferrer external">
          {m[2]}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function KnowledgePage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [platform, setPlatform] = useState(() => readInitialPlatform("p3"));
  const [topic, setTopic] = useState<string | null>(() => readInitialTopic());
  const [articles, setArticles] = useState<ArticleMeta[]>([]);
  const [slug, setSlug] = useState<string | null>(() => readInitialSlug());
  const [article, setArticle] = useState<Article | null>(null);
  const [queryDraft, setQueryDraft] = useState(() => readInitialQuery());
  const [query, setQuery] = useState(() => readInitialQuery());
  const [searchHits, setSearchHits] = useState<ArticleMeta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandingSlug, setExpandingSlug] = useState<string | null>(null);
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  const currentPlatform = useMemo(
    () => platforms.find((p) => p.id === platform) || null,
    [platforms, platform],
  );

  const searching = query.trim().length >= 2;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-status")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.features && typeof d.features.kbComments === "boolean") {
          setCommentsEnabled(d.features.kbComments);
        }
      })
      .catch(() => {
        /* keep default on */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge/platforms")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: Platform[] = Array.isArray(d.platforms) ? d.platforms : [];
        setPlatforms(list);
        setTopics((Array.isArray(d.topics) ? d.topics : []).filter((t: Topic) => t.id !== "ewd_status"));
        const def = String(d.default_id || "p3");
        const ids = new Set(list.map((p) => p.id));
        setPlatform((prev) => (ids.has(prev) ? prev : def));
        setTopic((prev) => (prev === "ewd_status" ? null : prev));
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить платформы");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!platform) return;
    try {
      localStorage.setItem(LS_PLATFORM, platform);
    } catch {
      /* ignore */
    }
    syncUrl(platform, topic, slug, query);
  }, [platform, topic, slug, query]);

  useEffect(() => {
    if (!platform || searching) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSearchHits(null);
    const qs = new URLSearchParams({ platform });
    if (topic) qs.set("topic", topic);
    fetch(`/api/knowledge/articles?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: ArticleMeta[] = Array.isArray(d.articles) ? d.articles : [];
        setArticles(list);
        setLoading(false);
        if (slug && !list.some((a) => a.slug === slug)) {
          setSlug(null);
          setArticle(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Не удалось загрузить статьи");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [platform, topic, searching]);

  useEffect(() => {
    if (!searching) {
      setSearchHits(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ q: query.trim(), platform });
    fetch(`/api/knowledge/search?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: ArticleMeta[] = Array.isArray(d.articles) ? d.articles : [];
        setSearchHits(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Поиск не удался");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, platform, searching]);

  useEffect(() => {
    if (!slug) {
      setArticle(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/knowledge/articles/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok && d.article) {
          setArticle(d.article as Article);
          if (typeof d.comments_enabled === "boolean") setCommentsEnabled(d.comments_enabled);
        } else {
          setArticle(null);
          setSlug(null);
        }
      })
      .catch(() => {
        if (!cancelled) setArticle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function selectPlatform(id: string) {
    setPlatform(id);
    setSlug(null);
    setArticle(null);
  }

  function selectTopic(id: string | null) {
    setTopic(id);
    setSlug(null);
    setArticle(null);
  }

  function runSearch(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const next = queryDraft.trim();
    setQuery(next);
    setSlug(null);
    setArticle(null);
  }

  function clearSearch() {
    setQueryDraft("");
    setQuery("");
    setSearchHits(null);
  }

  const openArticle = (nextSlug: string) => {
    if (expandingSlug) return;
    setExpandingSlug(nextSlug);
    window.setTimeout(() => {
      setSlug(nextSlug);
      setExpandingSlug(null);
    }, 240);
  };

  const list = searching ? searchHits || [] : articles;

  return (
    <main className="kb-page" data-testid="knowledge-page">
      <div className="kb-page__inner">
        <header className="kb-page__header" id="kb-top">
          <div>
            <h1 className="kb-page__title">База знаний</h1>
            <p className="kb-page__lead">
              Платформа → тема или поиск по симптомам. Материалы разных поколений не смешиваются.
            </p>
          </div>
          <a className="kb-page__back" href="/">
            ← К схемам P3
          </a>
        </header>

        <KbContributeForm
          platform={platform}
          platforms={platforms}
          topics={topics}
          defaultTopic={topic || "parts"}
        />

        <form className="kb-search" onSubmit={runSearch} role="search">
          <label className="kb-page__section-label" htmlFor="kb-search-input">
            Поиск по проблеме
          </label>
          <div className="kb-search__row">
            <input
              id="kb-search-input"
              data-testid="kb-search-input"
              className="kb-search__input"
              type="search"
              placeholder="Например: термостат, салонный фильтр, омыватель…"
              value={queryDraft}
              onChange={(e) => setQueryDraft(e.target.value)}
            />
            <button type="submit" className="kb-search__btn">
              Найти
            </button>
            {searching ? (
              <button type="button" className="kb-search__clear" onClick={clearSearch}>
                Сброс
              </button>
            ) : null}
          </div>
          {searching ? (
            <p className="kb-page__hint">
              Поиск в полке <strong>{platform.toUpperCase()}</strong>
              {searchHits ? ` · найдено ${searchHits.length}` : ""}
            </p>
          ) : null}
        </form>

        <section className="kb-page__section" aria-label="Платформа">
          <div className="kb-page__section-label">Платформа</div>
          <div className="kb-platform-picker" role="tablist" aria-label="Выбор платформы">
            {platforms.map((p) => {
              const active = p.id === platform;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`kb-platform-${p.id}`}
                  className={`kb-platform-btn${active ? " is-active" : ""}`}
                  onClick={() => selectPlatform(p.id)}
                >
                  <span className="kb-platform-btn__label">{p.label}</span>
                  <span className="kb-platform-btn__count" data-testid={`kb-platform-count-${p.id}`}>
                    {typeof p.article_count === "number" ? p.article_count : "—"}
                  </span>
                  <span className="kb-badge">{STATUS_BADGE[p.status] || "частично"}</span>
                </button>
              );
            })}
          </div>
          {currentPlatform ? (
            <p className="kb-page__hint">
              {currentPlatform.subtitle}
              {" · "}
              {STATUS_HINT[currentPlatform.status]}
              {currentPlatform.models_short?.length
                ? ` · типичные кузова: ${currentPlatform.models_short.join(", ")}`
                : null}
            </p>
          ) : null}
        </section>

        {!searching ? (
          <section className="kb-page__section" aria-label="Тема">
            <div className="kb-page__section-label">Раздел</div>
            <div className="kb-topic-chips">
              <button
                type="button"
                className={`kb-chip${!topic ? " is-active" : ""}`}
                onClick={() => selectTopic(null)}
              >
                Все
              </button>
              {topics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`kb-topic-${t.id}`}
                  className={`kb-chip${topic === t.id ? " is-active" : ""}`}
                  onClick={() => selectTopic(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {error ? <p className="kb-page__error">{error}</p> : null}

        {article ? (
          <article className="kb-article" data-testid="kb-article">
            <button type="button" className="kb-article__back" onClick={() => setSlug(null)}>
              ← К списку
            </button>
            <h2 className="kb-article__title">{article.title}</h2>
            <p className="kb-article__meta">
              {article.platform.toUpperCase()}
              {article.updated ? ` · ${article.updated}` : ""}
            </p>
            <SimpleMarkdown source={article.body_md || article.summary} />
            {article.component_code ? (
              <p className="kb-article__deep">
                <a href={`/?code=${encodeURIComponent(article.component_code)}`}>
                  Открыть узел {article.component_code} в EWD →
                </a>
              </p>
            ) : null}
            {article.author?.post_url || article.author?.profile_url || article.author?.name ? (
              <div className="kb-author" data-testid="kb-author">
                <h3 className="kb-author__title">Источник / автор</h3>
                <p className="kb-author__body">
                  {article.author.name ? <span>{article.author.name} · </span> : null}
                  {article.author.post_url ? (
                    <a href={article.author.post_url} target="_blank" rel="noopener noreferrer external">
                      Пост на Drive2
                    </a>
                  ) : article.author.profile_url ? (
                    <a href={article.author.profile_url} target="_blank" rel="noopener noreferrer external">
                      Профиль автора
                    </a>
                  ) : (
                    <span>Материал по мотивам бортжурнала</span>
                  )}
                </p>
              </div>
            ) : null}
            {article.links?.length ? (
              <div className="kb-sources">
                <h3 className="kb-sources__title">Источники</h3>
                <ul>
                  {article.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer external">
                        {l.title}
                      </a>
                      {l.site ? <span className="kb-sources__site"> — {l.site}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <KbArticleLike
              slug={article.slug}
              initialCount={article.like_count || 0}
              initiallyLiked={Boolean(article.liked_by_me)}
            />
            {commentsEnabled ? <KbCommentsBlock slug={article.slug} /> : null}
          </article>
        ) : (
          <section className="kb-list" aria-label="Статьи" data-testid="kb-article-list">
            {loading ? (
              <p className="kb-page__hint">Загрузка…</p>
            ) : list.length === 0 ? (
              <p className="kb-empty" data-testid="kb-empty">
                {searching
                  ? "Ничего не найдено по запросу на этой платформе. Смените полку или уточните слова."
                  : `Пока мало материалов по этой платформе${topic ? " и теме" : ""}.`}
              </p>
            ) : (
              <div className="kb-list__cards">
                {list.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className={`kb-card${expandingSlug === a.slug ? " is-expanding" : ""}`}
                    data-testid={`kb-card-${a.slug}`}
                    onClick={() => openArticle(a.slug)}
                  >
                    <span className="kb-card__title">{a.title}</span>
                    <span className="kb-card__summary">{a.summary}</span>
                    <span className="kb-card__tags">
                      <span className="kb-card__tag">{a.platform.toUpperCase()}</span>
                      {a.topics.map((t) => (
                        <span key={t} className="kb-card__tag">
                          {t}
                        </span>
                      ))}
                      {(a.like_count || 0) > 0 ? (
                        <span className="kb-card__tag kb-card__tag--eng">+{a.like_count}</span>
                      ) : null}
                      {commentsEnabled && (a.comment_count || 0) > 0 ? (
                        <span className="kb-card__tag kb-card__tag--eng">
                          комм. {a.comment_count}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {!article && list.length >= 3 ? (
          <button
            type="button"
            className="kb-to-top"
            data-testid="kb-to-top"
            aria-label="Наверх"
            onClick={() => {
              const el = document.getElementById("kb-top");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              else window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            ↑ Наверх
          </button>
        ) : null}
      </div>
    </main>
  );
}

type Challenge = { a: number; b: number; challenge: string };

function KbContributeForm({
  platform,
  platforms,
  topics,
  defaultTopic,
}: {
  platform: string;
  platforms: Platform[];
  topics: Topic[];
  defaultTopic: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"link" | "article">("link");
  const [formPlatform, setFormPlatform] = useState(platform);
  const [formTopic, setFormTopic] = useState(defaultTopic || "parts");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [doneId, setDoneId] = useState<number | null>(null);

  useEffect(() => {
    setFormPlatform(platform);
  }, [platform]);

  useEffect(() => {
    if (defaultTopic) setFormTopic(defaultTopic);
  }, [defaultTopic]);

  async function loadChallenge() {
    try {
      const r = await fetch("/api/knowledge/challenge");
      const d = await r.json();
      if (d?.challenge) {
        setChallenge({ a: d.a, b: d.b, challenge: d.challenge });
        setChallengeAnswer("");
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadChallenge();
  }, [open]);

  async function onSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/knowledge/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          platform: formPlatform,
          topic: formTopic,
          title,
          summary,
          body_md: bodyMd,
          source_url: sourceUrl,
          author_name: authorName,
          website: honeypot,
          challenge: challenge?.challenge || "",
          challenge_answer: challengeAnswer,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        setFormError(data.error || "Ошибка отправки");
        await loadChallenge();
        return;
      }
      setDoneId(Number(data.id) || 0);
      setTitle("");
      setSourceUrl("");
      setSummary("");
      setBodyMd("");
      setAuthorName("");
      setChallengeAnswer("");
    } catch {
      setFormError("Сеть недоступна. Попробуйте позже.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="kb-contribute" id="kb-contribute" data-testid="kb-contribute">
      <div className="kb-contribute__head">
        <div className="kb-contribute__intro">
          <h2 className="kb-contribute__title">Предложить материал</h2>
          {!open ? (
            <p className="kb-contribute__hint">Своя выжимка + ссылка · после модерации</p>
          ) : null}
        </div>
        <button
          type="button"
          className="kb-contribute__toggle"
          data-testid="kb-contribute-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setDoneId(null);
            setFormError("");
          }}
        >
          {open ? "Свернуть" : "Форма"}
        </button>
      </div>

      {open ? (
        doneId !== null ? (
          <div className="kb-contribute__done" data-testid="kb-contribute-done">
            <p>
              Спасибо! Заявка <strong>#{doneId || "—"}</strong> принята и ждёт модерации.
            </p>
            <button
              type="button"
              className="kb-search__btn"
              onClick={() => {
                setDoneId(null);
                void loadChallenge();
              }}
            >
              Ещё
            </button>
          </div>
        ) : (
          <form className="kb-contribute__form" onSubmit={onSubmit} data-testid="kb-contribute-form">
            <p className="kb-contribute__hint kb-contribute__hint--form">
              Без копипаста чужих текстов. Своими словами + ссылка на автора.
            </p>
            <label className="kb-contribute__hp" aria-hidden>
              Компания
              <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </label>

            <div className="kb-contribute__kinds" role="group" aria-label="Тип">
              <button
                type="button"
                className={`kb-chip${kind === "link" ? " is-active" : ""}`}
                onClick={() => setKind("link")}
              >
                Ссылка
              </button>
              <button
                type="button"
                className={`kb-chip${kind === "article" ? " is-active" : ""}`}
                onClick={() => setKind("article")}
              >
                Статья
              </button>
            </div>

            <div className="kb-contribute__row">
              <label className="kb-contribute__field">
                Платформа
                <select
                  value={formPlatform}
                  onChange={(e) => setFormPlatform(e.target.value)}
                  required
                  data-testid="kb-contribute-platform"
                >
                  {platforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kb-contribute__field">
                Раздел
                <select value={formTopic} onChange={(e) => setFormTopic(e.target.value)}>
                  {(topics.length ? topics : [{ id: "parts", label: "Запчасти" }]).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="kb-contribute__field">
              Заголовок
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={160}
                placeholder="Кратко: что за материал"
                data-testid="kb-contribute-title"
              />
            </label>

            <label className="kb-contribute__field">
              Ссылка {kind === "link" ? "(обязательно)" : ""}
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                required={kind === "link"}
                placeholder="https://www.drive2.ru/l/…"
                data-testid="kb-contribute-url"
              />
            </label>

            <label className="kb-contribute__field">
              Кратко своими словами
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Суть / PN — без копипаста"
                required={kind === "link"}
                data-testid="kb-contribute-summary"
              />
            </label>

            {kind === "article" ? (
              <label className="kb-contribute__field">
                Текст (markdown)
                <textarea
                  value={bodyMd}
                  onChange={(e) => setBodyMd(e.target.value)}
                  rows={4}
                  maxLength={8000}
                  placeholder={"## Суть\n\n…"}
                  data-testid="kb-contribute-body"
                />
              </label>
            ) : null}

            <label className="kb-contribute__field">
              Имя / ник (необяз.)
              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                maxLength={80}
                placeholder="Как подписать"
              />
            </label>

            <label className="kb-contribute__field">
              {challenge ? `${challenge.a} + ${challenge.b} = ?` : "Проверка…"}
              <input
                inputMode="numeric"
                autoComplete="off"
                value={challengeAnswer}
                onChange={(e) => setChallengeAnswer(e.target.value)}
                required
                data-testid="kb-contribute-challenge"
              />
            </label>

            {formError ? <p className="kb-page__error">{formError}</p> : null}

            <button type="submit" className="kb-contribute__submit" disabled={busy} data-testid="kb-contribute-submit">
              {busy ? "…" : "Отправить"}
            </button>
          </form>
        )
      ) : null}
    </section>
  );
}

function KbArticleLike({
  slug,
  initialCount,
  initiallyLiked,
}: {
  slug: string;
  initialCount: number;
  initiallyLiked: boolean;
}) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(initiallyLiked);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCount(initialCount);
    setLiked(initiallyLiked);
  }, [slug, initialCount, initiallyLiked]);

  async function onLike() {
    if (liked || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/knowledge/articles/${encodeURIComponent(slug)}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const d = await r.json();
      if (d?.ok) {
        setCount(Number(d.likes) || count + 1);
        setLiked(true);
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kb-like" data-testid="kb-like">
      <button
        type="button"
        className={`kb-like__btn${liked ? " is-liked" : ""}`}
        data-testid="kb-like-btn"
        disabled={liked || busy}
        onClick={() => void onLike()}
      >
        {liked ? "Оценено" : "Полезно +"}
      </button>
      <span className="kb-like__count" data-testid="kb-like-count">
        {count}
      </span>
    </div>
  );
}

function KbCommentsBlock({ slug }: { slug: string }) {
  const [comments, setComments] = useState<KbComment[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  async function loadChallenge() {
    try {
      const r = await fetch("/api/knowledge/challenge");
      const d = await r.json();
      if (d?.challenge) {
        setChallenge({ a: d.a, b: d.b, challenge: d.challenge });
        setChallengeAnswer("");
      }
    } catch {
      /* ignore */
    }
  }

  async function loadComments() {
    try {
      const r = await fetch(`/api/knowledge/articles/${encodeURIComponent(slug)}/comments`);
      const d = await r.json();
      if (d?.ok && Array.isArray(d.comments)) setComments(d.comments);
    } catch {
      /* ignore */
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    setComments([]);
    setLoaded(false);
    setOpen(false);
    setBody("");
    setError("");
    setChallenge(null);
    void loadComments();
  }, [slug]);

  useEffect(() => {
    if (open && !challenge) void loadChallenge();
  }, [open, challenge]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await fetch(`/api/knowledge/articles/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author_name: authorName,
          body,
          website: honeypot,
          challenge: challenge?.challenge || "",
          challenge_answer: challengeAnswer,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(String(d?.error || "Не удалось отправить"));
        void loadChallenge();
        return;
      }
      setBody("");
      setAuthorName("");
      if (d.comment) setComments((prev) => [d.comment as KbComment, ...prev]);
      else void loadComments();
      void loadChallenge();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  const countLabel = loaded ? ` · ${comments.length}` : "";

  return (
    <section
      className={`kb-comments${open ? " is-open" : ""}`}
      data-testid="kb-comments"
      aria-label="Комментарии"
    >
      <button
        type="button"
        className="kb-comments__toggle"
        data-testid="kb-comments-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="kb-comments__title">
          Комментарии{countLabel}
        </span>
        <span className="kb-comments__chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="kb-comments__panel">
          <form className="kb-comments__form" onSubmit={(e) => void onSubmit(e)} data-testid="kb-comments-form">
            <label className="kb-contribute__hp" aria-hidden>
              <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </label>
            <label className="kb-contribute__field">
              Имя (необяз.)
              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                maxLength={40}
                placeholder="Аноним"
                data-testid="kb-comment-name"
              />
            </label>
            <label className="kb-contribute__field">
              Комментарий
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={1000}
                required
                minLength={2}
                placeholder="Коротко по делу…"
                data-testid="kb-comment-body"
              />
            </label>
            <label className="kb-contribute__field">
              {challenge ? `${challenge.a} + ${challenge.b} = ?` : "Проверка…"}
              <input
                inputMode="numeric"
                autoComplete="off"
                value={challengeAnswer}
                onChange={(e) => setChallengeAnswer(e.target.value)}
                required
                data-testid="kb-comment-challenge"
              />
            </label>
            {error ? <p className="kb-page__error">{error}</p> : null}
            <button type="submit" className="kb-comments__submit" disabled={busy} data-testid="kb-comment-submit">
              {busy ? "…" : "Отправить"}
            </button>
          </form>

          <ul className="kb-comments__list">
            {comments.map((c) => (
              <li key={c.id} className="kb-comments__item" data-testid={`kb-comment-${c.id}`}>
                <div className="kb-comments__meta">
                  <strong>{c.author_name.trim() || "Аноним"}</strong>
                  <span>{c.created_at}</span>
                </div>
                <p className="kb-comments__body">{c.body}</p>
              </li>
            ))}
          </ul>
          {loaded && comments.length === 0 ? (
            <p className="kb-page__hint">Пока нет комментариев — будьте первым.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
