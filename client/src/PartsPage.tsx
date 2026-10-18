import { useEffect, useMemo, useState } from "react";
import { useUiLang } from "./i18n/LangProvider.js";

type FgNode = {
  id: number;
  path: string;
  label: string | null;
  parentPath: string | null;
  depth: number;
  title: string;
  plateCount: number | null;
};

type Plate = {
  id: number;
  fgPath: string;
  title: string;
  graphicUrl: string | null;
  graphicMime: string | null;
};

function readParam(key: string): string {
  try {
    return new URLSearchParams(window.location.search).get(key) || "";
  } catch {
    return "";
  }
}

function persistVehicle(model: string, year: string) {
  try {
    localStorage.setItem("ewd.parts.vehicle", JSON.stringify({ model, year }));
  } catch {
    /* ignore */
  }
}

function initialVehicle(): { model: string; year: string } {
  const fromUrlModel = readParam("model");
  const fromUrlYear = readParam("year");
  if (fromUrlModel || fromUrlYear) return { model: fromUrlModel, year: fromUrlYear };
  try {
    const raw = localStorage.getItem("ewd.parts.vehicle");
    if (raw) {
      const j = JSON.parse(raw) as { model?: string; year?: string };
      return { model: j.model || "", year: j.year || "" };
    }
  } catch {
    /* ignore */
  }
  return { model: "V70", year: "2014" };
}

function syncUrl(model: string, year: string, fg: string) {
  const qs = new URLSearchParams();
  if (model) qs.set("model", model);
  if (year) qs.set("year", year);
  if (fg) qs.set("fg", fg);
  const next = qs.toString() ? `/parts?${qs}` : "/parts";
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState(null, "", next);
  }
}

export function PartsPage() {
  const { t, lang } = useUiLang();
  const vehicle0 = useMemo(() => initialVehicle(), []);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [yearsByModel, setYearsByModel] = useState<Record<string, string[]>>({});
  const [model, setModel] = useState(vehicle0.model);
  const [year, setYear] = useState(vehicle0.year);
  const [roots, setRoots] = useState<FgNode[]>([]);
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => new Set());
  const [childrenByParent, setChildrenByParent] = useState<Record<string, FgNode[]>>({});
  const [selectedFg, setSelectedFg] = useState(() => readParam("fg") || "");
  const [plates, setPlates] = useState<Plate[]>([]);
  const [platesLoading, setPlatesLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);

  const years = useMemo(() => (model ? yearsByModel[model] || [] : []), [model, yearsByModel]);

  useEffect(() => {
    fetch("/api/parts-catalog/status")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available));
        if (d.available) {
          const mb = d.sizeBytes ? ` · ${(Number(d.sizeBytes) / (1024 * 1024)).toFixed(1)} MB` : "";
          setStatusNote(`${d.fgCount || 0} FG · ${d.plateCount || 0} plates${mb}`);
        }
      })
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (!available) return;
    fetch("/api/parts-catalog/filters")
      .then((r) => r.json())
      .then((d) => {
        setModels(Array.isArray(d.models) ? d.models : []);
        setYearsByModel(d.yearsByModel && typeof d.yearsByModel === "object" ? d.yearsByModel : {});
      })
      .catch(() => {});
  }, [available]);

  useEffect(() => {
    persistVehicle(model, year);
    syncUrl(model, year, selectedFg);
  }, [model, year, selectedFg]);

  useEffect(() => {
    if (!available || !model) {
      setRoots([]);
      return;
    }
    setTreeLoading(true);
    const qs = new URLSearchParams();
    qs.set("model", model);
    if (year) qs.set("year", year);
    if (lang === "en") qs.set("lang", "en");
    fetch(`/api/parts-catalog/tree?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setRoots(Array.isArray(d.nodes) ? d.nodes : []);
        setChildrenByParent({});
        setOpenPaths(new Set());
      })
      .catch(() => setRoots([]))
      .finally(() => setTreeLoading(false));
  }, [available, model, year, lang]);

  useEffect(() => {
    if (!available || !selectedFg || !model) {
      setPlates([]);
      return;
    }
    setPlatesLoading(true);
    const qs = new URLSearchParams();
    qs.set("fg", selectedFg);
    qs.set("model", model);
    if (year) qs.set("year", year);
    if (lang === "en") qs.set("lang", "en");
    fetch(`/api/parts-catalog/plates?${qs}`)
      .then((r) => r.json())
      .then((d) => setPlates(Array.isArray(d.plates) ? d.plates : []))
      .catch(() => setPlates([]))
      .finally(() => setPlatesLoading(false));
  }, [available, selectedFg, model, year, lang]);

  async function toggleOpen(node: FgNode) {
    const path = node.path;
    setOpenPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (childrenByParent[path]) return;
    const qs = new URLSearchParams();
    qs.set("model", model);
    if (year) qs.set("year", year);
    qs.set("parent", path);
    if (lang === "en") qs.set("lang", "en");
    try {
      const d = await fetch(`/api/parts-catalog/tree?${qs}`).then((r) => r.json());
      setChildrenByParent((prev) => ({ ...prev, [path]: Array.isArray(d.nodes) ? d.nodes : [] }));
    } catch {
      setChildrenByParent((prev) => ({ ...prev, [path]: [] }));
    }
  }

  function renderNode(node: FgNode, indent: number) {
    const kids = childrenByParent[node.path];
    const open = openPaths.has(node.path);
    const selected = selectedFg === node.path;
    const count =
      node.plateCount != null && node.plateCount > 0 ? (
        <span className="text-[10px] text-[var(--text-muted)] tabular-nums ml-1">({node.plateCount})</span>
      ) : null;
    return (
      <li key={node.path} className="select-none">
        <div
          className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-sm ${
            selected ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "hover:bg-[var(--input-bg)]"
          }`}
          style={{ paddingLeft: `${4 + indent * 12}px` }}
        >
          <button
            type="button"
            className="w-5 h-5 shrink-0 text-[var(--text-muted)] text-xs"
            aria-label={open ? "collapse" : "expand"}
            onClick={() => void toggleOpen(node)}
          >
            {open ? "▾" : "▸"}
          </button>
          <button
            type="button"
            className="flex-1 text-left truncate min-w-0"
            onClick={() => {
              setSelectedFg(node.path);
              if (!open) void toggleOpen(node);
            }}
            data-testid={`parts-fg-${node.path}`}
          >
            <span className="font-mono text-[11px] text-[var(--text-muted)] mr-1">
              {node.label || node.path.replace(/^\//, "")}
            </span>
            {node.title}
            {count}
          </button>
        </div>
        {open && kids && kids.length > 0 ? (
          <ul>{kids.map((c) => renderNode(c, indent + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div
      className="parts-page flex flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]"
      data-testid="parts-page"
      style={{ minHeight: "100dvh", height: "100dvh" }}
    >
      <header className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 flex items-center gap-2 min-h-11">
        <a href="/" className="text-sm text-[var(--accent)] hover:underline shrink-0">
          ← EWD
        </a>
        <h1 className="text-sm sm:text-base font-semibold truncate">{t("partsCatalog.title")}</h1>
        <span className="hidden sm:inline text-[11px] text-[var(--text-muted)] shrink-0">
          {t("partsCatalog.localOnly")}
        </span>
        {statusNote ? (
          <span className="hidden md:inline text-[11px] text-[var(--text-muted)] ml-auto tabular-nums truncate max-w-[40%]">
            {statusNote}
          </span>
        ) : (
          <span className="ml-auto" />
        )}
        <a href="/service" className="hidden sm:inline text-xs text-[var(--text-muted)] hover:underline shrink-0">
          {t("nav.service")}
        </a>
      </header>
      <p className="hidden sm:block shrink-0 px-4 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-color)] bg-[var(--input-bg)]">
        {t("partsCatalog.disclaimer")}
      </p>

      {available === false ? (
        <div className="max-w-xl mx-auto p-6 space-y-3 text-sm" data-testid="parts-unavailable">
          <p>{t("partsCatalog.unavailable")}</p>
          <pre className="rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] p-3 text-[11px] overflow-auto">
            {`python scripts/import_epc_parts.py --manual E:\\manual\n# → data/parts.sqlite`}
          </pre>
        </div>
      ) : null}

      {available ? (
        <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(280px,360px)_1fr]">
          <aside className="border-r border-[var(--border-color)] bg-[var(--bg-card)] flex flex-col min-h-0">
            <div className="p-3 space-y-2 border-b border-[var(--border-color)] shrink-0">
              <div className="flex gap-2">
                <label className="flex-1 text-[11px] text-[var(--text-muted)]">
                  {t("partsCatalog.model")}
                  <select
                    className="mt-0.5 w-full bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setSelectedFg("");
                      setPlates([]);
                    }}
                    data-testid="parts-model"
                  >
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-24 text-[11px] text-[var(--text-muted)]">
                  {t("partsCatalog.year")}
                  <select
                    className="mt-0.5 w-full bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    data-testid="parts-year"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2" data-testid="parts-tree">
              {treeLoading ? (
                <p className="text-xs text-[var(--text-muted)] px-2">{t("partsCatalog.loading")}</p>
              ) : (
                <ul>{roots.map((n) => renderNode(n, 0))}</ul>
              )}
            </div>
          </aside>

          <main className="flex flex-col min-h-0 bg-[var(--bg-main)]">
            <div className="p-3 border-b border-[var(--border-color)] shrink-0">
              <h2 className="text-sm font-semibold truncate">
                {selectedFg
                  ? `${t("partsCatalog.plates")} · FG ${selectedFg.replace(/^\//, "")}`
                  : t("partsCatalog.pickFg")}
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-3" data-testid="parts-plate-list">
              {!selectedFg ? (
                <p className="text-sm text-[var(--text-muted)]">{t("partsCatalog.pickFgHint")}</p>
              ) : platesLoading ? (
                <p className="text-xs text-[var(--text-muted)]">{t("partsCatalog.loading")}</p>
              ) : plates.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">{t("partsCatalog.noPlates")}</p>
              ) : (
                <ul className="space-y-1">
                  {plates.map((p) => (
                    <li
                      key={p.id}
                      className="rounded border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                      data-testid={`parts-plate-${p.id}`}
                    >
                      <div className="font-medium">{p.title}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-mono">{p.fgPath}</span>
                        {p.graphicUrl ? <span className="font-mono">{p.graphicUrl}</span> : null}
                        {p.graphicMime ? <span>{p.graphicMime}</span> : null}
                        <span className="opacity-60">#{p.id}</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 italic">
                        {t("partsCatalog.viewerLater")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </main>
        </div>
      ) : null}
    </div>
  );
}
