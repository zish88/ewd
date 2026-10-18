import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useUiLang } from "./i18n/LangProvider.js";
import { loadPersistedFilters, readFiltersFromStorage, type PersistedFilters } from "./filterPersist.js";

type TreeVariant = { treeItemId: number; docCount: number };

type TreeNode = {
  id: string;
  kind: "fg" | "item" | "item-group";
  code?: string;
  title: string;
  treeItemId?: number;
  docCount?: number;
  children?: TreeNode[];
  hasChildren?: boolean;
  childCount?: number;
  variantCount?: number;
  variants?: TreeVariant[];
};

type SearchHit = { id: number; title: string; hasHtml: boolean };
type DocPayload = {
  id: number;
  title: string;
  html: string | null;
  hasHtml: boolean;
  path: string | null;
};

function looksForeignServiceBody(title: string, html: string | null | undefined): boolean {
  const sample = `${title}\n${String(html || "").slice(0, 1500)}`;
  if (/[А-Яа-яЁё]/.test(title) && !/[ÅÄÖåäö]/.test(sample)) return false;
  if (/[ÅÄÖåäö]/.test(sample)) return true;
  if (/\b(Förberedelser|Borttagning|Ditsättning|Ta bort|Sätt dit|Framhjul)\b/i.test(sample)) return true;
  const cyr = (sample.match(/[А-Яа-яЁё]/g) || []).length;
  const lat = (sample.match(/[A-Za-z]/g) || []).length;
  return lat >= 40 && cyr < 8;
}

/** Mark VIDA page-wide / multi-column forms for landscape screen+print. */
function markWideTablesInHtml(html: string): string {
  if (!html || !html.includes("sr-table")) return html;
  if (typeof DOMParser === "undefined") {
    return html;
  }
  try {
    const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html");
    const root = doc.getElementById("r");
    if (!root) return html;
    root.querySelectorAll(".sr-table-wrap").forEach((wrap) => {
      const table = wrap.querySelector("table.sr-table");
      if (!table) return;
      let maxCols = 0;
      table.querySelectorAll("tr").forEach((tr) => {
        let cols = 0;
        tr.querySelectorAll("td,th").forEach((td) => {
          cols += Number(td.getAttribute("colspan") || 1);
        });
        if (cols > maxCols) maxCols = cols;
      });
      if (maxCols >= 6 || wrap.classList.contains("sr-table-pgwide")) {
        wrap.classList.add("sr-table-pgwide");
      }
    });
    return root.innerHTML;
  } catch {
    return html;
  }
}

function markWideTablesInDom(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll(".sr-table-wrap").forEach((wrap) => {
    const table = wrap.querySelector("table.sr-table");
    if (!table) return;
    let maxCols = 0;
    table.querySelectorAll("tr").forEach((tr) => {
      let cols = 0;
      tr.querySelectorAll("td,th").forEach((td) => {
        cols += Number(td.getAttribute("colspan") || 1);
      });
      if (cols > maxCols) maxCols = cols;
    });
    if (maxCols >= 6) wrap.classList.add("sr-table-pgwide");
  });
}

type FilterStatus = "none" | "applied" | "no_profiles";

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

const SERVICE_FILTERS_KEY = "ewd.filters.v1";

function persistServiceVehicle(model: string, year: string) {
  try {
    const cur = readFiltersFromStorage();
    const next: PersistedFilters = {
      model: model || cur.model || "",
      year: year || cur.year || "",
      engine: cur.engine || "",
      transmission: cur.transmission || "",
      zone: cur.zone || "all",
      code: cur.code || "",
      theme: cur.theme,
    };
    localStorage.setItem(SERVICE_FILTERS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function initialServiceVehicle(): { model: string; year: string } {
  const fromUrlModel = readParam("model");
  const fromUrlYear = readParam("year");
  if (fromUrlModel || fromUrlYear) {
    return { model: fromUrlModel, year: fromUrlYear };
  }
  const saved = loadPersistedFilters();
  return { model: saved.model || "", year: saved.year || "" };
}

const TREE_STATE_PREFIX = "ewd.service.tree.v1:";

type StoredTreeState = {
  open: string[];
  selectedTreeItemId: number | null;
  visited: number[];
};

function treeStateKey(model: string, year: string): string {
  return `${TREE_STATE_PREFIX}${model || "_"}:${year || "_"}`;
}

function loadTreeState(model: string, year: string): StoredTreeState {
  try {
    const raw = localStorage.getItem(treeStateKey(model, year));
    if (!raw) return { open: [], selectedTreeItemId: null, visited: [] };
    const parsed = JSON.parse(raw) as Partial<StoredTreeState>;
    return {
      open: Array.isArray(parsed.open) ? parsed.open.map(String).filter(Boolean) : [],
      selectedTreeItemId:
        typeof parsed.selectedTreeItemId === "number" && Number.isFinite(parsed.selectedTreeItemId)
          ? parsed.selectedTreeItemId
          : null,
      visited: Array.isArray(parsed.visited)
        ? parsed.visited.map(Number).filter((n) => Number.isFinite(n))
        : [],
    };
  } catch {
    return { open: [], selectedTreeItemId: null, visited: [] };
  }
}

function saveTreeState(model: string, year: string, state: StoredTreeState) {
  try {
    localStorage.setItem(
      treeStateKey(model, year),
      JSON.stringify({
        open: state.open.slice(0, 200),
        selectedTreeItemId: state.selectedTreeItemId,
        visited: state.visited.slice(-80),
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function TreeBranch({
  node,
  depth,
  model,
  year,
  selectedTreeItemId,
  visitedTreeItemIds,
  expandedCodes,
  onToggleExpand,
  onOpenItem,
  t,
}: {
  node: TreeNode;
  depth: number;
  model: string;
  year: string;
  selectedTreeItemId: number | null;
  visitedTreeItemIds: Set<number>;
  expandedCodes: Set<string>;
  onToggleExpand: (code: string, open: boolean) => void;
  onOpenItem: (id: number) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const fgCode = node.kind === "fg" ? String(node.code || node.id || "") : "";
  const open = Boolean(fgCode && expandedCodes.has(fgCode));
  const [kids, setKids] = useState<TreeNode[] | null>(node.children?.length ? node.children : null);
  const [loadingKids, setLoadingKids] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const needsLazy = node.kind === "fg" && Boolean(node.hasChildren) && !kids?.length;
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (node.kind !== "fg" || !open || !needsLazy || !node.code) return;
    let alive = true;
    setLoadingKids(true);
    const qs = new URLSearchParams({ parent: node.code });
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    fetch(`/api/service/tree?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setKids(Array.isArray(d.tree) ? d.tree : []);
      })
      .catch(() => {
        if (alive) setKids([]);
      })
      .finally(() => {
        if (alive) setLoadingKids(false);
      });
    return () => {
      alive = false;
    };
  }, [open, needsLazy, node.code, node.kind, model, year]);

  useEffect(() => {
    if (node.kind !== "item" && node.kind !== "item-group") return;
    const tid = node.treeItemId ?? null;
    if (tid == null || tid !== selectedTreeItemId) return;
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [node.kind, node.treeItemId, selectedTreeItemId]);

  if (node.kind === "item" || node.kind === "item-group") {
    const tid = node.treeItemId ?? null;
    const isSelected = tid != null && tid === selectedTreeItemId;
    const isVisited = tid != null && !isSelected && visitedTreeItemIds.has(tid);
    const variantCount = node.variantCount || node.variants?.length || 0;
    return (
      <div style={{ paddingLeft: depth * 10 }} className="space-y-0.5">
        <div className="flex items-stretch gap-0.5">
          <button
            ref={isSelected ? selectedRef : undefined}
            type="button"
            aria-current={isSelected ? "true" : undefined}
            className={[
              "block flex-1 text-left px-2 py-1 text-[12px] rounded border-l-2",
              isSelected
                ? "border-[var(--accent)] bg-[var(--input-bg)] font-medium text-[var(--text-main)] ring-1 ring-[var(--accent)]/40"
                : isVisited
                  ? "border-[var(--border-color)] text-[var(--text-muted)]"
                  : "border-transparent hover:bg-[var(--input-bg)]",
            ].join(" ")}
            onClick={() => {
              if (tid != null) onOpenItem(tid);
            }}
            data-testid={node.kind === "item-group" ? "service-item-group" : "service-item"}
            data-tree-item-id={tid ?? undefined}
          >
            {node.title}
            {variantCount > 1 ? (
              <span className="ml-1 text-[10px] text-[var(--text-muted)] tabular-nums">
                {t("service.variants", { n: variantCount })}
              </span>
            ) : null}
          </button>
          {variantCount > 1 ? (
            <button
              type="button"
              className="shrink-0 px-1.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--input-bg)] rounded"
              title={t("service.pickVariant")}
              aria-expanded={showVariants}
              onClick={() => setShowVariants((v) => !v)}
              data-testid="service-variants-toggle"
            >
              {showVariants ? "▴" : "▾"}
            </button>
          ) : null}
        </div>
        {showVariants && node.variants?.length ? (
          <div className="ml-3 border-l border-[var(--border-color)] pl-2 space-y-0.5" data-testid="service-variants">
            {node.variants.map((v, i) => {
              const sel = v.treeItemId === selectedTreeItemId;
              return (
                <button
                  key={v.treeItemId}
                  type="button"
                  className={[
                    "block w-full text-left px-2 py-0.5 text-[11px] rounded",
                    sel ? "bg-[var(--input-bg)] font-medium" : "hover:bg-[var(--input-bg)] text-[var(--text-muted)]",
                  ].join(" ")}
                  onClick={() => onOpenItem(v.treeItemId)}
                >
                  #{i + 1}
                  {v.docCount ? ` · ${v.docCount} doc` : ""}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 10 }}>
      <button
        type="button"
        className="w-full text-left px-2 py-1 text-[12px] hover:bg-[var(--input-bg)] rounded flex items-center gap-1"
        onClick={() => {
          if (!fgCode) return;
          onToggleExpand(fgCode, !open);
        }}
        aria-expanded={open}
        data-testid="service-fg"
        data-fg-code={fgCode || undefined}
      >
        <span className="text-[10px] text-[var(--text-muted)] w-3">{open ? "▾" : "▸"}</span>
        <span className="truncate">{node.title}</span>
        {node.childCount != null ? (
          <span className="ml-auto text-[10px] text-[var(--text-muted)] tabular-nums">{node.childCount}</span>
        ) : null}
      </button>
      {open ? (
        <div>
          {loadingKids ? (
            <p className="px-2 py-1 text-[11px] text-[var(--text-muted)]">…</p>
          ) : (
            (kids || []).map((k) => (
              <TreeBranch
                key={k.id}
                node={k}
                depth={depth + 1}
                model={model}
                year={year}
                selectedTreeItemId={selectedTreeItemId}
                visitedTreeItemIds={visitedTreeItemIds}
                expandedCodes={expandedCodes}
                onToggleExpand={onToggleExpand}
                onOpenItem={onOpenItem}
                t={t}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ServicePage() {
  const { t, lang } = useUiLang();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [featureOff, setFeatureOff] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [coveredModels, setCoveredModels] = useState<string[]>([]);
  const [yearsByModel, setYearsByModel] = useState<Record<string, string[]>>({});
  const vehicle0 = useMemo(() => initialServiceVehicle(), []);
  const [model, setModel] = useState(vehicle0.model);
  const [year, setYear] = useState(vehicle0.year);
  const [vinInput, setVinInput] = useState(() => readParam("vin"));
  const [vinNote, setVinNote] = useState("");
  const [treeQ, setTreeQ] = useState("");
  const [searchQ, setSearchQ] = useState(() => readParam("q"));
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("none");
  const [profileCount, setProfileCount] = useState(0);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [itemDocs, setItemDocs] = useState<SearchHit[]>([]);
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [selectedTreeItemId, setSelectedTreeItemId] = useState<number | null>(() => {
    return loadTreeState(vehicle0.model, vehicle0.year).selectedTreeItemId;
  });
  const [visitedTreeItemIds, setVisitedTreeItemIds] = useState<Set<number>>(() => {
    return new Set(loadTreeState(vehicle0.model, vehicle0.year).visited);
  });
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(() => {
    return new Set(loadTreeState(vehicle0.model, vehicle0.year).open);
  });
  const [loading, setLoading] = useState(false);
  const [docLoading, setDocLoading] = useState(false);
  const [err, setErr] = useState("");
  const [mobilePane, setMobilePane] = useState<"tree" | "doc">("tree");
  const [isMobile, setIsMobile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [docHistory, setDocHistory] = useState<number[]>([]);
  const docScrollRef = useRef<HTMLDivElement | null>(null);
  const docHtmlRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<DocPayload | null>(null);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    if (!doc?.html || docLoading) return;
    markWideTablesInDom(docHtmlRef.current);
  }, [doc?.id, doc?.html, docLoading]);

  const years = useMemo(() => (model ? yearsByModel[model] || [] : []), [model, yearsByModel]);

  function scrollDocToTop() {
    const el = docScrollRef.current;
    if (el) el.scrollTop = 0;
  }

  function pushDocHistory(fromId: number | null | undefined) {
    if (fromId == null || !Number.isFinite(fromId)) return;
    setDocHistory((prev) => {
      if (prev[prev.length - 1] === fromId) return prev;
      return [...prev.slice(-19), fromId];
    });
  }

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/site-status")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.features?.serviceBrowser === false) {
          setFeatureOff(true);
          setAvailable(false);
        }
      })
      .catch(() => {});
    fetch("/api/service/status")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.enabled === false) {
          setFeatureOff(true);
          setAvailable(false);
          return;
        }
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
        setCoveredModels(Array.isArray(d.coveredModels) ? d.coveredModels : []);
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
        setFilterStatus((d.filterStatus as FilterStatus) || "none");
        setProfileCount(Number(d.profileCount) || 0);
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
      vin: vinInput.trim().length === 17 ? vinInput.trim().toUpperCase() : "",
      q: searchQ.trim().length >= 2 ? searchQ.trim() : "",
    });
    persistServiceVehicle(model, year);
  }, [model, year, searchQ, vinInput]);

  // Restore / switch tree UI state when vehicle filter changes
  useEffect(() => {
    const saved = loadTreeState(model, year);
    setExpandedCodes(new Set(saved.open));
    setSelectedTreeItemId(saved.selectedTreeItemId);
    setVisitedTreeItemIds(new Set(saved.visited));
  }, [model, year]);

  // Persist expanded folders + selection for current vehicle
  useEffect(() => {
    saveTreeState(model, year, {
      open: [...expandedCodes],
      selectedTreeItemId,
      visited: [...visitedTreeItemIds],
    });
  }, [model, year, expandedCodes, selectedTreeItemId, visitedTreeItemIds]);

  function toggleExpand(code: string, open: boolean) {
    const c = String(code || "").trim();
    if (!c) return;
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (open) next.add(c);
      else {
        next.delete(c);
        // also collapse nested codes under this prefix
        for (const k of [...next]) {
          if (k.startsWith(`${c}/`)) next.delete(k);
        }
      }
      return next;
    });
  }

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

  function vehicleQs(extra?: Record<string, string>): string {
    const qs = new URLSearchParams(extra || {});
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    const s = qs.toString();
    return s ? `?${s}` : "";
  }

  function openDoc(id: number, syncUrl = true, opts?: { pushHistory?: boolean }) {
    setErr("");
    setDocLoading(true);
    if (isMobile) setMobilePane("doc");
    scrollDocToTop();
    if (opts?.pushHistory) pushDocHistory(docRef.current?.id);
    fetch(`/api/service/doc/${id}${vehicleQs()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.doc) {
          setErr(t("service.docMissing"));
          return;
        }
        setDoc(d.doc);
        scrollDocToTop();
        if (syncUrl) writeParams({ doc: String(id), ref: "" });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setDocLoading(false));
  }

  function openByRef(ref: string, label = "") {
    const r = String(ref || "").trim();
    if (!r) return;
    setErr("");
    setDocLoading(true);
    if (isMobile) setMobilePane("doc");
    const qs = new URLSearchParams({ ref: r });
    if (label.trim()) qs.set("label", label.trim());
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    fetch(`/api/service/resolve?${qs}`)
      .then((res) => res.json())
      .then((d) => {
        if (!d.ok || !d.hit?.id) {
          setErr(t("service.docMissing"));
          setDocLoading(false);
          return;
        }
        openDoc(d.hit.id, true, { pushHistory: true });
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : String(e));
        setDocLoading(false);
      });
  }

  function goBackDoc() {
    setDocHistory((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const id = next.pop()!;
      // open without pushing again
      setErr("");
      setDocLoading(true);
      if (isMobile) setMobilePane("doc");
      scrollDocToTop();
      fetch(`/api/service/doc/${id}${vehicleQs()}`)
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok || !d.doc) {
            setErr(t("service.docMissing"));
            return;
          }
          setDoc(d.doc);
          scrollDocToTop();
          writeParams({ doc: String(id), ref: "" });
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setDocLoading(false));
      return next;
    });
  }

  function onDocHtmlClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    const img = target?.closest?.("img") as HTMLImageElement | null;
    if (img?.src && img.closest(".service-doc-html")) {
      e.preventDefault();
      setLightboxSrc(img.currentSrc || img.src);
      return;
    }
    const a = target?.closest?.("a.sr-xref") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const ref = a.getAttribute("data-sr-ref") || "";
    const label = (a.textContent || "").trim();
    if (ref) openByRef(ref, label);
  }

  function printArticle() {
    if (!doc) return;
    const title = doc.title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const wmText = "ewd-volvo.ru";
    const wmEsc = wmText;
    // Eager-load all images: loading=lazy inside a hidden iframe often skips most of them.
    const rawBody = doc.hasHtml && doc.html ? doc.html : `<p>${t("service.bodyNotImported")}</p>`;
    let body = rawBody
      .replace(/\sloading=(["']?)lazy\1/gi, ' loading="eager"')
      .replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="eager"');
    // Mark wide VIDA forms (pgwide / many columns) for landscape print + layout.
    body = markWideTablesInHtml(body);
    const landscape = /\bsr-table-pgwide\b/.test(body);
    const wmSvg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="300">` +
        `<text x="40" y="160" fill="rgba(0,0,0,0.085)" font-size="26" ` +
        `font-family="Segoe UI,system-ui,sans-serif" ` +
        `transform="rotate(-28 230 150)">${wmEsc}</text></svg>`,
    );
    const pageCss = landscape
      ? `@page{size:landscape;margin:4mm}@page{size:A4 landscape;margin:4mm}`
      : `@page{size:A4 portrait;margin:10mm}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  ${pageCss}
  html,body{height:auto}
  body{font:11px/1.2 system-ui,sans-serif;color:#111;background:#fff;padding:${
    landscape ? "0" : "1rem"
  };max-width:${landscape ? "none" : "800px"};width:100%;margin:0 auto;position:relative}
  h1{font-size:${landscape ? "9pt" : "1.15rem"};margin:0 0 0.2rem;page-break-after:avoid}
  .sr-print-body p,.sr-print-body .sr-para{margin:0.12rem 0;font-size:${
    landscape ? "7pt" : "12px"
  };page-break-after:avoid}
  img{max-width:100%;height:auto;display:block;margin:0.4rem 0;page-break-inside:avoid}
  figure.sr-fig{margin:0.4rem 0;page-break-inside:avoid}
  .sr-table-wrap{overflow:visible;margin:0.12rem 0}
  table.sr-table{border-collapse:collapse;width:${
    landscape ? "100%" : "max-content"
  };min-width:${landscape ? "0" : "100%"};margin:0.12rem 0;font-size:${
    landscape ? "6.8pt" : "11px"
  };table-layout:${landscape ? "fixed" : "auto"}}
  table.sr-table td,table.sr-table th{border:1px solid #666;padding:0.1rem 0.16rem;vertical-align:middle;word-break:break-word;overflow-wrap:anywhere;white-space:normal;line-height:1.2;min-width:0}
  .sr-table-pgwide{page-break-inside:avoid;break-inside:avoid}
  .sr-table-pgwide table.sr-table{width:100%;min-width:0;table-layout:fixed;font-size:6.8pt;page-break-inside:avoid;break-inside:avoid}
  .sr-table-pgwide table.sr-table td,.sr-table-pgwide table.sr-table th{padding:0.08rem 0.14rem;font-size:6.8pt}
  .sr-table-pgwide tr.sr-form-pad{page-break-before:avoid;break-before:avoid}
  .sr-table-pgwide tr.sr-form-pad td{height:7mm;min-height:7mm;max-height:8mm;padding:1mm !important;vertical-align:top}
  .sr-note{border-left:3px solid #ca8a04;padding-left:0.5rem;color:#444}
  .sr-torque-dl{display:grid;grid-template-columns:auto 1fr;gap:0.25rem 0.75rem;margin:0.75rem 0}
  .sr-torque-dl dt{font-weight:600;color:#444}
  a{color:#0b5;text-decoration:underline}
  a.sr-xref{display:block;margin:0.2rem 0}
  .sr-print-wm{position:fixed;inset:0;z-index:0;pointer-events:none;
    background-image:url("data:image/svg+xml,${wmSvg}");
    background-repeat:repeat;background-size:460px 300px;opacity:1}
  .sr-print-body{position:relative;z-index:1}
  @media print{
    body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact${
      landscape ? ";zoom:0.86" : ""
    }}
    .sr-print-wm{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sr-table-pgwide,.sr-table-pgwide table.sr-table{page-break-inside:avoid;break-inside:avoid}
    .sr-table-pgwide tr.sr-form-pad td{height:6.5mm;min-height:6.5mm}
  }
</style></head><body class="${landscape ? "sr-print-landscape" : ""}">
<div class="sr-print-wm" aria-hidden="true"></div>
<div class="sr-print-body"><h1>${title}</h1>${body}</div>
</body></html>`;

    // Hidden iframe only — avoid a second about:blank window beside the print dialog.
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "print");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = landscape ? "1123px" : "800px";
    iframe.style.height = landscape ? "794px" : "1200px";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const idoc = iframe.contentDocument || win?.document;
    if (!win || !idoc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }
    idoc.open();
    idoc.write(html);
    idoc.close();

    const cleanup = () => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
    };
    let printed = false;
    const run = () => {
      if (printed) return;
      printed = true;
      try {
        win.focus();
        win.print();
      } finally {
        window.setTimeout(cleanup, 1500);
      }
    };
    const imgs = Array.from(idoc.images || []);
    if (!imgs.length) {
      window.setTimeout(run, 50);
      return;
    }
    let pendingImgs = imgs.length;
    const doneOne = () => {
      pendingImgs -= 1;
      if (pendingImgs <= 0) run();
    };
    for (const img of imgs) {
      if (img.complete) {
        doneOne();
        continue;
      }
      img.addEventListener("load", doneOne, { once: true });
      img.addEventListener("error", doneOne, { once: true });
    }
    window.setTimeout(run, 8000);
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
    setDocHistory([]);
    if (isMobile) setMobilePane("doc");
    scrollDocToTop();
    const qs = new URLSearchParams();
    if (model) qs.set("model", model);
    if (year) qs.set("year", year);
    const q = qs.toString();
    fetch(`/api/service/tree-item/${id}/docs${q ? `?${q}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        const docs = (Array.isArray(d.docs) ? d.docs : []) as SearchHit[];
        // Server already prefers Russian titles over leftover Swedish VIDA stubs.
        setItemDocs(docs);
        const best = docs.find((x) => x.hasHtml) || docs[0];
        if (best) openDoc(best.id);
      })
      .catch(() => setItemDocs([]));
  }

  async function applyVin() {
    const vin = vinInput.trim().toUpperCase();
    if (vin.length !== 17) {
      setVinNote(lang === "en" ? "VIN must be 17 characters" : "VIN — 17 символов");
      return;
    }
    setVinNote(lang === "en" ? "Decoding…" : "Разбор…");
    try {
      const data = await fetch(`/api/vin/decode?vin=${encodeURIComponent(vin)}`).then((r) => r.json());
      if (!data.ok) {
        setVinNote(typeof data.error === "string" && data.error.trim() ? data.error : t("service.vinFail"));
        return;
      }
      const nextModel = String(data.model || "").trim();
      const nextYear = String(data.year || "").trim();
      if (nextModel) setModel(nextModel);
      if (nextYear) setYear(nextYear);
      setVinNote(`${nextModel || "—"} · ${nextYear || "—"}`);
    } catch {
      setVinNote(t("service.vinFail"));
    }
  }

  return (
    <div
      className="service-page flex flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]"
      data-testid="service-page"
    >
      <header className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 flex items-center gap-2 min-h-11">
        <a href="/" className="text-sm text-[var(--accent)] hover:underline shrink-0">
          ← EWD
        </a>
        <h1 className="text-sm sm:text-base font-semibold truncate">{t("service.title")}</h1>
        <span className="hidden sm:inline text-[11px] text-[var(--text-muted)] shrink-0">{t("service.localOnly")}</span>
        {statusNote ? (
          <span className="hidden md:inline text-[11px] text-[var(--text-muted)] ml-auto tabular-nums truncate max-w-[40%]">
            {statusNote}
          </span>
        ) : (
          <span className="ml-auto" />
        )}
      </header>
      <p className="hidden sm:block shrink-0 px-4 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-color)] bg-[var(--input-bg)]">
        {t("service.disclaimer")}
      </p>

      {featureOff ? (
        <div className="max-w-xl mx-auto p-6 space-y-3 text-sm" data-testid="service-feature-off">
          <p className="text-[var(--text-main)]">{t("service.featureOff")}</p>
          <a href="/" className="text-[var(--accent)] hover:underline text-sm">
            ← EWD
          </a>
        </div>
      ) : null}

      {!featureOff && available === false ? (
        <div className="max-w-xl mx-auto p-6 space-y-3 text-sm" data-testid="service-unavailable">
          <p className="text-[var(--text-main)]">{t("service.unavailable")}</p>
          <pre className="rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] p-3 text-[11px] overflow-auto">
            {`python scripts/import_servicerep.py\n# → data/servicerep.sqlite`}
          </pre>
        </div>
      ) : null}

      {!featureOff && available ? (
        <>
          {isMobile ? (
            <div
              className="shrink-0 flex border-b border-[var(--border-color)] bg-[var(--bg-card)]"
              role="tablist"
              data-testid="service-mobile-tabs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === "tree"}
                className={`flex-1 py-2.5 text-sm font-medium ${
                  mobilePane === "tree"
                    ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
                onClick={() => setMobilePane("tree")}
                data-testid="service-tab-tree"
              >
                {t("service.tabTree")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mobilePane === "doc"}
                className={`flex-1 py-2.5 text-sm font-medium ${
                  mobilePane === "doc"
                    ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
                onClick={() => setMobilePane("doc")}
                data-testid="service-tab-doc"
              >
                {t("service.tabDoc")}
                {doc ? " · ✓" : ""}
              </button>
            </div>
          ) : null}

          <div
            className={`flex-1 min-h-0 gap-0 ${
              isMobile ? "flex flex-col" : "grid lg:grid-cols-[minmax(280px,360px)_1fr]"
            }`}
          >
            <aside
              className={`border-r border-[var(--border-color)] bg-[var(--bg-card)] flex flex-col min-h-0 ${
                isMobile
                  ? mobilePane === "tree"
                    ? "flex-1"
                    : "hidden"
                  : ""
              }`}
            >
              <div className="p-3 space-y-2 border-b border-[var(--border-color)] shrink-0">
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="flex-1 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm font-mono tracking-wider uppercase"
                    placeholder={t("service.vinPlaceholder")}
                    maxLength={17}
                    value={vinInput}
                    onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void applyVin();
                      }
                    }}
                    data-testid="service-vin"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--input-bg)]"
                    onClick={() => void applyVin()}
                    data-testid="service-vin-apply"
                  >
                    {t("service.vinApply")}
                  </button>
                </div>
                {vinNote ? <p className="text-[10px] text-[var(--text-muted)]">{vinNote}</p> : null}
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
                          {coveredModels.length && !coveredModels.includes(m) ? " · ?" : ""}
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
                    className="flex-1 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-sm"
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
                  className="hidden sm:block w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] px-2 py-1.5 text-xs"
                  placeholder={t("service.treeFilter")}
                  value={treeQ}
                  onChange={(e) => setTreeQ(e.target.value)}
                />
                <p className="hidden sm:block text-[10px] text-[var(--text-muted)] leading-snug">{t("service.filterHint")}</p>
                {filterStatus === "no_profiles" ? (
                  <p className="text-[11px] text-amber-700 leading-snug" data-testid="service-no-profiles">
                    {t("service.noProfiles")}
                  </p>
                ) : null}
                {filterStatus === "applied" ? (
                  <p className="text-[10px] text-[var(--text-muted)] tabular-nums" data-testid="service-filter-applied">
                    {t("service.filterApplied", { n: profileCount })}
                  </p>
                ) : null}
              </div>
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 min-h-0 overscroll-y-contain pb-[max(1rem,var(--safe-bottom))]">
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
                ) : filterStatus === "no_profiles" ? (
                  <p className="p-2 text-xs text-[var(--text-muted)]" data-testid="service-tree-empty">
                    {t("service.noProfiles")}
                  </p>
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
                        expandedCodes={expandedCodes}
                        onToggleExpand={toggleExpand}
                        onOpenItem={openTreeItem}
                        t={t}
                      />
                    ))}
                  </div>
                )}
                {itemDocs.length > 1 && (!isMobile || mobilePane === "tree") ? (
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
            <main
              ref={!isMobile ? docScrollRef : undefined}
              className={`min-h-0 bg-[var(--bg-main)] ${
                isMobile
                  ? mobilePane === "doc"
                    ? "relative flex-1"
                    : "hidden"
                  : "overflow-y-auto overscroll-y-contain p-3 sm:p-4"
              }`}
              data-testid="service-doc-pane"
            >
              <div
                ref={isMobile ? docScrollRef : undefined}
                className={
                  isMobile
                    ? "absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-y-contain p-3 pb-[max(4rem,calc(2.5rem+var(--safe-bottom)))]"
                    : "contents"
                }
              >
              {isMobile ? (
                <button
                  type="button"
                  className="mb-3 text-sm text-[var(--accent)] hover:underline"
                  onClick={() => setMobilePane("tree")}
                  data-testid="service-back-tree"
                >
                  {t("service.backToTree")}
                </button>
              ) : null}
              {itemDocs.length > 1 && isMobile ? (
                <div className="mb-3 flex flex-wrap gap-1">
                  {itemDocs.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className={`rounded-md border px-2 py-1 text-[11px] ${
                        doc?.id === h.id
                          ? "border-[var(--accent)] bg-[var(--input-bg)]"
                          : "border-[var(--border-color)]"
                      }`}
                      onClick={() => openDoc(h.id)}
                    >
                      {h.title.length > 36 ? `${h.title.slice(0, 34)}…` : h.title}
                    </button>
                  ))}
                </div>
              ) : null}
              {err ? <p className="text-sm text-red-600 mb-2">{err}</p> : null}
              {docLoading && !doc ? (
                <p className="text-sm text-[var(--text-muted)]">{lang === "en" ? "Loading…" : "Загрузка…"}</p>
              ) : null}
              {!doc && !docLoading ? (
                <p className="text-sm text-[var(--text-muted)]">{t("service.pickDoc")}</p>
              ) : null}
              {doc ? (
                <article className="max-w-3xl service-article has-[:is(.sr-table-pgwide)]:max-w-none">
                  <div className="flex items-start gap-2 mb-2 flex-wrap">
                    {docHistory.length ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--input-bg)]"
                        onClick={goBackDoc}
                        data-testid="service-doc-back"
                      >
                        {t("service.backDoc")}
                      </button>
                    ) : null}
                    <h2 className="text-base sm:text-lg font-semibold flex-1 min-w-0">{doc.title}</h2>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-[var(--border-color)] px-2 py-1 text-xs hover:bg-[var(--input-bg)]"
                      onClick={printArticle}
                      data-testid="service-print"
                      title={t("service.print")}
                    >
                      {t("service.print")}
                    </button>
                  </div>
                  {docLoading ? (
                    <p className="text-xs text-[var(--text-muted)] mb-2">{lang === "en" ? "Updating…" : "Обновление…"}</p>
                  ) : null}
                  {doc.hasHtml && looksForeignServiceBody(doc.title, doc.html) ? (
                    <p
                      className="mb-3 text-xs leading-snug rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1.5 text-amber-200"
                      data-testid="service-non-ru-body"
                    >
                      {t("service.nonRuBody")}
                    </p>
                  ) : null}
                  {doc.hasHtml && doc.html ? (
                    <div
                      ref={docHtmlRef}
                      className="service-doc-html text-sm leading-relaxed space-y-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:cursor-zoom-in [&_figure]:my-2 [&_.sr-table-wrap]:my-3 [&_.sr-table-wrap]:max-w-full [&_.sr-table]:w-full [&_.sr-table]:max-w-full [&_.sr-table]:table-fixed [&_.sr-table]:border-collapse [&_.sr-table]:text-[12px] [&_.sr-table_td]:border [&_.sr-table_td]:border-[var(--border-color)] [&_.sr-table_td]:px-1.5 [&_.sr-table_td]:py-1 [&_.sr-table_td]:align-top [&_.sr-table_td]:break-words [&_.sr-table_td]:min-w-0 [&_.sr-table_th]:border [&_.sr-table_th]:border-[var(--border-color)] [&_.sr-table_th]:px-1.5 [&_.sr-table_th]:py-1 [&_.sr-table_th]:text-left [&_.sr-table_th]:bg-[var(--input-bg)] [&_.sr-table_th]:break-words [&_.sr-table_th]:min-w-0 [&_.sr-grate]:my-4 [&_.sr-grate]:rounded-md [&_.sr-grate]:border [&_.sr-grate]:border-[var(--border-color)] [&_.sr-grate]:bg-[var(--input-bg)] [&_.sr-grate]:p-3 [&_.sr-grate]:space-y-2 [&_.sr-note]:my-2 [&_.sr-note]:border-l-2 [&_.sr-note]:border-amber-500 [&_.sr-note]:pl-2 [&_.sr-note]:text-[var(--text-muted)] [&_.sr-xref]:text-[var(--accent)] [&_.sr-xref]:underline [&_.sr-xref]:underline-offset-2 [&_.sr-xref]:cursor-pointer [&_.sr-missing-img]:text-[11px] [&_.sr-missing-img]:text-[var(--text-muted)] [&_.sr-missing-img]:font-mono"
                      onClick={onDocHtmlClick}
                      dangerouslySetInnerHTML={{ __html: doc.html }}
                    />
                  ) : (
                    <p className="text-sm text-amber-700">{t("service.bodyNotImported")}</p>
                  )}
                </article>
              ) : null}
              {isMobile ? <div className="h-6" aria-hidden /> : null}
              </div>
            </main>
          </div>
          {lightboxSrc ? (
            <div
              className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-3"
              role="dialog"
              aria-modal="true"
              data-testid="service-lightbox"
              onClick={() => setLightboxSrc(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setLightboxSrc(null);
              }}
            >
              <button
                type="button"
                className="absolute top-3 right-3 text-white text-sm px-3 py-1.5 rounded-md bg-black/50"
                onClick={() => setLightboxSrc(null)}
              >
                ✕
              </button>
              <img
                src={lightboxSrc}
                alt=""
                className="max-w-full max-h-[92vh] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
