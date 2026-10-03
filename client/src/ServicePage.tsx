import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useUiLang } from "./i18n/LangProvider.js";

type TreeNode = {
  id: string;
  kind: "fg" | "item";
  code?: string;
  title: string;
  treeItemId?: number;
  docCount?: number;
  children?: TreeNode[];
  hasChildren?: boolean;
  childCount?: number;
};

type SearchHit = { id: number; title: string; hasHtml: boolean };
type DocPayload = {
  id: number;
  title: string;
  html: string | null;
  hasHtml: boolean;
  path: string | null;
};

function readParam(key: string): string {
  try {
    return new URLSearchParams(window.location.search).get(key) || "";
  } catch {
    return "";
  }
}

function writeParams(patch: Record<string, string>) {
  try {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.searchParams.set(k, v);
      else u.searchParams.delete(k);
    }
    window.history.replaceState({}, "", u.pathname + u.search);
  } catch {
    /* ignore */
  }
}

function TreeBranch({
  node,
  depth,
  model,
  year,
  selectedTreeItemId,
  visitedTreeItemIds,
  onOpenItem,
}: {
  node: TreeNode;
  depth: number;
  model: string;
  year: string;
  selectedTreeItemId: number | null;
  visitedTreeItemIds: Set<number>;
  onOpenItem: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<TreeNode[] | null>(node.children?.length ? node.children : null);
  const [loadingKids, setLoadingKids] = useState(false);
  const needsLazy = node.kind === "fg" && Boolean(node.hasChildren) && !kids?.length;

  async function toggle() {
    if (node.kind === "item") return;
    const next = !open;
    setOpen(next);
    if (next && needsLazy && node.code) {
      setLoadingKids(true);
      try {
        const qs = new URLSearchParams({ parent: node.code });
        if (model) qs.set("model", model);
        if (year) qs.set("year", year);
        const r = await fetch(`/api/service/tree?${qs}`);
        const d = await r.json();
        setKids(Array.isArray(d.tree) ? d.tree : []);
      } catch {
        setKids([]);
      } finally {
        setLoadingKids(false);
      }
    }
  }

  if (node.kind === "item") {
    const tid = node.treeItemId ?? null;
    const isSelected = tid != null && tid === selectedTreeItemId;
    const isVisited = tid != null && !isSelected && visitedTreeItemIds.has(tid);
    return (
      <button
        type="button"
        aria-current={isSelected ? "true" : undefined}
        className={[
          "block w-full text-left px-2 py-1 text-[12px] rounded border-l-2",
          isSelected
            ? "border-[var(--accent)] bg-[var(--input-bg)] font-medium text-[var(--text-main)] ring-1 ring-[var(--accent)]/40"
            : isVisited
              ? "border-transparent text-[var(--text-muted)] bg-[var(--bg-main)]/60 hover:bg-[var(--input-bg)]"
              : "border-transparent hover:bg-[var(--input-bg)] text-[var(--text-main)]",
        ].join(" ")}
        style={{ paddingLeft: 8 + depth * 10 }}
        onClick={() => tid != null && onOpenItem(tid)}
      >
        <span>{node.title}</span>
        {node.docCount ? (
          <span className="ml-1 text-[10px] text-[var(--text-muted)]">({node.docCount})</span>
        ) : null}
      </button>
    );
  }

  const showKids = open && (kids?.length || loadingKids);
  const marker = needsLazy || (kids && kids.length) ? (open ? "▾" : "▸") : "·";

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--input-bg)] rounded"
        style={{ paddingLeft: 8 + depth * 10 }}
        onClick={() => void toggle()}
      >
        <span className="w-3 shrink-0 text-[var(--text-muted)]">{marker}</span>
        <span className="truncate">{node.title}</span>
        {node.childCount ? (
          <span className="ml-auto shrink-0 text-[10px] font-normal text-[var(--text-muted)] tabular-nums">
            {node.childCount}
          </span>
        ) : null}
      </button>
      {showKids
        ? loadingKids
          ? (
              <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]" style={{ paddingLeft: 18 + depth * 10 }}>
                …
              </p>
            )
          : kids!.map((ch) => (
              <TreeBranch
                key={ch.id}
                node={ch}
                depth={depth + 1}
                model={model}
                year={year}
                selectedTreeItemId={selectedTreeItemId}
                visitedTreeItemIds={visitedTreeItemIds}
                onOpenItem={onOpenItem}
              />
            ))
        : null}
    </div>
  );
}

export function ServicePage() {
  const { t, lang } = useUiLang();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [yearsByModel, setYearsByModel] = useState<Record<string, string[]>>({});
  const [model, setModel] = useState(() => readParam("model"));
  const [year, setYear] = useState(() => readParam("year"));
  const [treeQ, setTreeQ] = useState("");
  const [searchQ, setSearchQ] = useState(() => readParam("q"));
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [itemDocs, setItemDocs] = useState<SearchHit[]>([]);
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState<number | null>(null);
  const [visitedTreeItemIds, setVisitedTreeItemIds] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const years = useMemo(() => (model ? yearsByModel[model] || [] : []), [model, yearsByModel]);

  useEffect(() => {
    let alive = true;
    fetch("/api/service/status")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setAvailable(Boolean(d.available));
        setStatusNote(
          d.available
            ? `${d.docCount || 0} docs · ${d.htmlCount || 0} with text` +
                (d.graphicCacheCount != null ? ` · ${d.graphicCacheCount} imgs` : "")
            : "",
        );
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    fetch("/api/service/filters")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setModels(Array.isArray(d.models) ? d.models : []);
        setYearsByModel(d.yearsByModel && typeof d.yearsByModel === "object" ? d.yearsByModel : {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Deep-link: ?doc= or ?ref=
  useEffect(() => {
    if (!available) return;
    const ref = readParam("ref");
    if (ref) {
      openByRef(ref);
      return;
    }
    const id = Number(readParam("doc"));
    if (!Number.isFinite(id) || !id) return;
    openDoc(id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams();
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    if (treeQ.trim().length >= 2) qs.set("q", treeQ.trim());
    fetch(`/api/service/tree?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setTree(Array.isArray(d.tree) ? d.tree : []);
        setErr("");
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [available, model, year, treeQ]);

  useEffect(() => {
    writeParams({
      model,
      year,
      q: searchQ.trim().length >= 2 ? searchQ.trim() : "",
    });
  }, [model, year, searchQ]);

  useEffect(() => {
    if (!available) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let alive = true;
    const qs = new URLSearchParams({ q });
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    const tmr = window.setTimeout(() => {
      fetch(`/api/service/search?${qs}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setHits(Array.isArray(d.hits) ? d.hits : []);
        })
        .catch(() => {
          if (alive) setHits([]);
        });
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(tmr);
    };
  }, [available, searchQ, model, year]);

  function openDoc(id: number, syncUrl = true) {
    setErr("");
    fetch(`/api/service/doc/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.doc) {
          setErr(t("service.docMissing"));
          return;
        }
        setDoc(d.doc);
        if (syncUrl) writeParams({ doc: String(id), ref: "" });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }

  function openByRef(ref: string) {
    const r = String(ref || "").trim();
    if (!r) return;
    setErr("");
    fetch(`/api/service/resolve?ref=${encodeURIComponent(r)}`)
      .then((res) => res.json())
      .then((d) => {
        if (!d.ok || !d.hit?.id) {
          setErr(t("service.docMissing"));
          return;
        }
        openDoc(d.hit.id);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }

  function onDocHtmlClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement | null)?.closest?.("a.sr-xref") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const ref = a.getAttribute("data-sr-ref") || "";
    if (ref) openByRef(ref);
  }

  function openTreeItem(id: number) {
    setSelectedTreeItemId(id);
    setVisitedTreeItemIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setItemDocs([]);
    fetch(`/api/service/tree-item/${id}/docs`)
      .then((r) => r.json())
      .then((d) => {
        const docs = (Array.isArray(d.docs) ? d.docs : []) as SearchHit[];
        docs.sort((a, b) => Number(b.hasHtml) - Number(a.hasHtml));
        setItemDocs(docs);
        const best = docs.find((x) => x.hasHtml) || docs[0];
        if (best) openDoc(best.id);
      })
      .catch(() => setItemDocs([]));
  }

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]" data-testid="service-page">
      <header className="border-b border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-3 flex flex-wrap items-center gap-3">
        <a href="/" className="text-sm text-[var(--accent)] hover:underline">
          ← EWD
        </a>
        <h1 className="text-base font-semibold">{t("service.title")}</h1>
        <span className="text-[11px] text-[var(--text-muted)]">{t("service.localOnly")}</span>
        {statusNote ? (
          <span className="text-[11px] text-[var(--text-muted)] ml-auto tabular-nums">{statusNote}</span>
        ) : null}
        <a href="/knowledge" className="text-xs text-[var(--text-muted)] hover:underline">
          {t("nav.knowledge")}
        </a>
      </header>
      <p className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-color)] bg-[var(--input-bg)]">
        {t("service.disclaimer")}
      </p>

      {available === false ? (
        <div className="max-w-xl mx-auto p-6 space-y-3 text-sm" data-testid="service-unavailable">
          <p className="text-[var(--text-main)]">{t("service.unavailable")}</p>
          <pre className="rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] p-3 text-[11px] overflow-auto">
            {`python scripts/import_servicerep.py\n# → data/servicerep.sqlite`}
          </pre>
        </div>
      ) : null}

      {available ? (
        <div className="grid lg:grid-cols-[minmax(280px,360px)_1fr] gap-0 min-h-[calc(100vh-3.5rem)]">
          <aside className="border-r border-[var(--border-color)] bg-[var(--bg-card)] flex flex-col min-h-0">
            <div className="p-3 space-y-2 border-b border-[var(--border-color)] shrink-0">
              <div className="flex gap-2">
                <label className="flex-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {t("filter.model")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setYear("");
                    }}
                    data-testid="service-model"
                  >
                    <option value="">{t("filter.all")}</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-24 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {t("filter.year")}
                  <select
                    className="mt-0.5 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm"
                    value={year}
                    disabled={!model}
                    onChange={(e) => setYear(e.target.value)}
                    data-testid="service-year"
                  >
                    <option value="">{t("filter.all")}</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-1">
                <input
                  type="search"
                  className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm"
                  placeholder={t("service.searchPlaceholder")}
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  data-testid="service-search"
                />
                {searchQ.trim().length >= 2 ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-[var(--border-color)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--input-bg)]"
                    onClick={() => setSearchQ("")}
                    title={lang === "en" ? "Clear search" : "Сбросить поиск"}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              <input
                type="search"
                className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-xs"
                placeholder={t("service.treeFilter")}
                value={treeQ}
                onChange={(e) => setTreeQ(e.target.value)}
              />
              <p className="text-[10px] text-[var(--text-muted)] leading-snug">{t("service.filterHint")}</p>
            </div>
            <div className="flex-1 overflow-auto p-1 min-h-0">
              {hits ? (
                <div className="space-y-0.5" data-testid="service-search-hits">
                  <div className="px-2 py-1 text-[10px] uppercase text-[var(--muted)]">
                    {t("service.searchResults")} ({hits.length})
                  </div>
                  {hits.length === 0 ? (
                    <p className="px-2 text-xs text-[var(--text-muted)]">{t("filter.searchEmpty")}</p>
                  ) : (
                    hits.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className={`block w-full text-left px-2 py-1.5 text-[12px] hover:bg-[var(--input-bg)] rounded ${
                          doc?.id === h.id ? "bg-[var(--input-bg)]" : ""
                        }`}
                        onClick={() => openDoc(h.id)}
                      >
                        {h.title}
                        {!h.hasHtml ? (
                          <span className="ml-1 text-[10px] text-amber-600">{t("service.noBody")}</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              ) : loading ? (
                <p className="p-2 text-xs text-[var(--text-muted)]">{lang === "en" ? "Loading…" : "Загрузка…"}</p>
              ) : (
                <div data-testid="service-tree">
                  {tree.map((n) => (
                    <TreeBranch
                      key={n.id}
                      node={n}
                      depth={0}
                      model={model}
                      year={year}
                      selectedTreeItemId={selectedTreeItemId}
                      visitedTreeItemIds={visitedTreeItemIds}
                      onOpenItem={openTreeItem}
                    />
                  ))}
                </div>
              )}
              {itemDocs.length > 1 ? (
                <div className="mt-2 border-t border-[var(--border-color)] pt-2">
                  <div className="px-2 text-[10px] uppercase text-[var(--muted)]">{t("service.linkedDocs")}</div>
                  {itemDocs.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className={`block w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--input-bg)] ${
                        doc?.id === h.id ? "bg-[var(--input-bg)]" : ""
                      }`}
                      onClick={() => openDoc(h.id)}
                    >
                      {h.title}
                      {!h.hasHtml ? (
                        <span className="ml-1 text-[10px] text-amber-600">{t("service.noBody")}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
          <main className="min-h-0 overflow-auto p-4 bg-[var(--bg-main)]" data-testid="service-doc-pane">
            {err ? <p className="text-sm text-red-600 mb-2">{err}</p> : null}
            {!doc ? (
              <p className="text-sm text-[var(--text-muted)]">{t("service.pickDoc")}</p>
            ) : (
              <article className="max-w-3xl">
                <h2 className="text-lg font-semibold mb-2">{doc.title}</h2>
                {doc.path ? (
                  <p className="text-[10px] font-mono text-[var(--text-muted)] mb-3 break-all">{doc.path}</p>
                ) : null}
                {doc.hasHtml && doc.html ? (
                  <div
                    className="service-doc-html text-sm leading-relaxed space-y-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_img]:max-w-full [&_img]:h-auto [&_figure]:my-2 [&_.sr-grate]:my-4 [&_.sr-grate]:rounded-md [&_.sr-grate]:border [&_.sr-grate]:border-[var(--border-color)] [&_.sr-grate]:bg-[var(--input-bg)] [&_.sr-grate]:p-3 [&_.sr-grate]:space-y-2 [&_.sr-note]:my-2 [&_.sr-note]:border-l-2 [&_.sr-note]:border-amber-500 [&_.sr-note]:pl-2 [&_.sr-note]:text-[var(--text-muted)] [&_.sr-xref]:text-[var(--accent)] [&_.sr-xref]:underline [&_.sr-xref]:underline-offset-2 [&_.sr-xref]:cursor-pointer [&_.sr-missing-img]:text-[11px] [&_.sr-missing-img]:text-[var(--text-muted)] [&_.sr-missing-img]:font-mono"
                    onClick={onDocHtmlClick}
                    dangerouslySetInnerHTML={{ __html: doc.html }}
                  />
                ) : (
                  <p className="text-sm text-amber-700">{t("service.bodyNotImported")}</p>
                )}
              </article>
            )}
          </main>
        </div>
      ) : null}
    </div>
  );
}
