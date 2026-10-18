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
  graphicAvailable: boolean;
};

type PlatePart = {
  hotspot: string | null;
  pn: string | null;
  title: string;
  qty: number | null;
  unit: string | null;
};

type MobilePane = "tree" | "art" | "table";

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

function syncUrl(model: string, year: string, fg: string, plateId: number | null) {
  const qs = new URLSearchParams();
  if (model) qs.set("model", model);
  if (year) qs.set("year", year);
  if (fg) qs.set("fg", fg);
  if (plateId) qs.set("plate", String(plateId));
  const next = qs.toString() ? `/parts?${qs}` : "/parts";
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState(null, "", next);
  }
}

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null || Number.isNaN(Number(qty))) return "—";
  const n = Number(qty);
  const s = Number.isInteger(n) ? String(n) : String(n);
  const u = (unit || "").trim();
  if (!u || u === "ST" || u === "SA") return s;
  return `${s} ${u}`;
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
  const [selectedPlateId, setSelectedPlateId] = useState<number | null>(() => {
    const raw = readParam("plate");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [plateTitle, setPlateTitle] = useState("");
  const [graphicUrl, setGraphicUrl] = useState<string | null>(null);
  const [parts, setParts] = useState<PlatePart[]>([]);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [platesLoading, setPlatesLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("tree");

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
    syncUrl(model, year, selectedFg, selectedPlateId);
  }, [model, year, selectedFg, selectedPlateId]);

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
      setSelectedPlateId(null);
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
      .then((d) => {
        const list: Plate[] = Array.isArray(d.plates)
          ? d.plates.map((p: Plate & { graphicAvailable?: boolean }) => ({
              id: p.id,
              fgPath: p.fgPath,
              title: p.title,
              graphicAvailable: Boolean(p.graphicAvailable),
            }))
          : [];
        setPlates(list);
        if (list.length === 0) {
          setSelectedPlateId(null);
          // Deep-link / stale FG with no plates for this model → climb to parent.
          const parent = selectedFg.replace(/\/[^/]+$/, "");
          if (parent && parent !== selectedFg && parent.startsWith("/")) {
            setSelectedFg(parent);
          }
          return;
        }
        setSelectedPlateId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          const withArt = list.find((p) => p.graphicAvailable);
          return withArt?.id ?? list[0]?.id ?? null;
        });
      })
      .catch(() => {
        setPlates([]);
        setSelectedPlateId(null);
      })
      .finally(() => setPlatesLoading(false));
  }, [available, selectedFg, model, year, lang]);

  useEffect(() => {
    if (!available || !selectedPlateId || !model) {
      setParts([]);
      setGraphicUrl(null);
      setPlateTitle("");
      setActiveHotspot(null);
      return;
    }
    setDetailLoading(true);
    setActiveHotspot(null);
    const qs = new URLSearchParams();
    qs.set("model", model);
    if (year) qs.set("year", year);
    if (lang === "en") qs.set("lang", "en");
    fetch(`/api/parts-catalog/plate/${selectedPlateId}?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          setParts([]);
          setGraphicUrl(null);
          setPlateTitle("");
          return;
        }
        setPlateTitle(d.plate?.title || "");
        setGraphicUrl(typeof d.graphicUrl === "string" ? d.graphicUrl : null);
        setParts(Array.isArray(d.parts) ? d.parts : []);
      })
      .catch(() => {
        setParts([]);
        setGraphicUrl(null);
        setPlateTitle("");
      })
      .finally(() => setDetailLoading(false));
  }, [available, selectedPlateId, model, year, lang]);

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
    const code = (node.label || node.path.replace(/^\//, "")).trim();
    const title = (node.title || "").trim();
    const titleIsCode =
      !title ||
      title === code ||
      title.replace(/\s+/g, "") === code.replace(/\s+/g, "");
    const count =
      node.plateCount != null && node.plateCount > 0 ? (
        <span className="text-[10px] text-[var(--text-muted)] tabular-nums ml-1">({node.plateCount})</span>
      ) : null;
    const hasLoadedKids = kids != null;
    const canExpand = !hasLoadedKids || kids.length > 0;
    return (
      <li key={node.path} className="select-none">
        <div
          className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-sm ${
            selected ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "hover:bg-[var(--input-bg)]"
          }`}
          style={{ paddingLeft: `${4 + indent * 12}px` }}
        >
          {canExpand ? (
            <button
              type="button"
              className="w-5 h-5 shrink-0 text-[var(--text-muted)] text-xs"
              aria-label={open ? "collapse" : "expand"}
              onClick={() => void toggleOpen(node)}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-5 h-5 shrink-0" />
          )}
          <button
            type="button"
            className="flex-1 text-left truncate min-w-0"
            onClick={() => {
              setSelectedFg(node.path);
              setMobilePane("art");
              if (canExpand && !open) void toggleOpen(node);
            }}
            data-testid={`parts-fg-${node.path}`}
          >
            <span className="font-mono text-[11px] text-[var(--text-muted)] mr-1">{code}</span>
            {titleIsCode ? null : title}
            {count}
          </button>
        </div>
        {open && kids && kids.length > 0 ? (
          <ul>{kids.map((c) => renderNode(c, indent + 1))}</ul>
        ) : null}
      </li>
    );
  }

  const treePane = (
    <div className="flex flex-col min-h-0 h-full border-r border-[var(--border-color)] bg-[var(--bg-card)]">
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
                setSelectedPlateId(null);
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
    </div>
  );

  const artPane = (
    <div className="flex flex-col min-h-0 h-full bg-[var(--bg-main)]" data-testid="parts-art">
      <div className="p-2 border-b border-[var(--border-color)] shrink-0 space-y-1.5">
        <div className="text-[11px] text-[var(--text-muted)] truncate">
          {selectedFg
            ? `FG ${selectedFg.replace(/^\//, "")}`
            : t("partsCatalog.pickFg")}
        </div>
        {selectedFg ? (
          <label className="block text-[11px] text-[var(--text-muted)]">
            {t("partsCatalog.plate")}
            <select
              className="mt-0.5 w-full bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1.5 text-sm"
              value={selectedPlateId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedPlateId(Number.isFinite(id) && id > 0 ? id : null);
                setMobilePane("table");
              }}
              disabled={platesLoading || plates.length === 0}
              data-testid="parts-plate-select"
            >
              {plates.length === 0 ? (
                <option value="">{t("partsCatalog.noPlates")}</option>
              ) : (
                plates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.graphicAvailable ? "" : ` · ${t("partsCatalog.noGraphicShort")}`}
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}
        {plateTitle ? <h2 className="text-sm font-semibold truncate">{plateTitle}</h2> : null}
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-white flex items-center justify-center p-2">
        {!selectedFg ? (
          <p className="text-sm text-[var(--text-muted)] px-4 text-center">{t("partsCatalog.pickFgHint")}</p>
        ) : platesLoading || detailLoading ? (
          <p className="text-xs text-[var(--text-muted)]">{t("partsCatalog.loading")}</p>
        ) : plates.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t("partsCatalog.noPlates")}</p>
        ) : graphicUrl ? (
          <img
            src={graphicUrl}
            alt={plateTitle || "plate"}
            className="max-w-full max-h-full object-contain"
            data-testid="parts-graphic"
          />
        ) : (
          <p className="text-sm text-[var(--text-muted)] px-4 text-center" data-testid="parts-no-graphic">
            {t("partsCatalog.noGraphic")}
          </p>
        )}
      </div>
    </div>
  );

  const tablePane = (
    <div
      className="flex flex-col min-h-0 h-full border-l border-[var(--border-color)] bg-[var(--bg-card)]"
      data-testid="parts-table-pane"
    >
      <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0 text-sm font-semibold">
        {t("partsCatalog.bom")}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {!selectedPlateId ? (
          <p className="text-sm text-[var(--text-muted)] p-3">{t("partsCatalog.pickPlate")}</p>
        ) : detailLoading ? (
          <p className="text-xs text-[var(--text-muted)] p-3">{t("partsCatalog.loading")}</p>
        ) : parts.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] p-3" data-testid="parts-empty-bom">
            {t("partsCatalog.noParts")}
          </p>
        ) : (
          <table className="w-full text-sm border-collapse" data-testid="parts-bom-table">
            <thead className="sticky top-0 bg-[var(--bg-card)] z-[1]">
              <tr className="text-left text-[11px] text-[var(--text-muted)] border-b border-[var(--border-color)]">
                <th className="px-2 py-1.5 w-10 font-medium">#</th>
                <th className="px-2 py-1.5 w-[7.5rem] font-medium">{t("partsCatalog.colPn")}</th>
                <th className="px-2 py-1.5 font-medium">{t("partsCatalog.colTitle")}</th>
                <th className="px-2 py-1.5 w-14 font-medium text-right">{t("partsCatalog.colQty")}</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((row, i) => {
                const hs = row.hotspot != null ? String(row.hotspot) : "";
                const active = activeHotspot != null && hs === activeHotspot;
                return (
                  <tr
                    key={`${hs}-${row.pn || ""}-${i}`}
                    className={`border-b border-[var(--border-color)]/60 cursor-pointer ${
                      active ? "bg-[var(--accent)]/15" : "hover:bg-[var(--input-bg)]"
                    }`}
                    onClick={() => setActiveHotspot(hs || null)}
                    data-testid={hs ? `parts-row-${hs}` : `parts-row-i${i}`}
                  >
                    <td className="px-2 py-1 font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                      {hs || "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-[12px] whitespace-nowrap">
                      {row.pn && row.pn !== "ns" ? row.pn : "—"}
                    </td>
                    <td className="px-2 py-1 text-[13px] leading-snug">{row.title}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-[12px] text-[var(--text-muted)]">
                      {formatQty(row.qty, row.unit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

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

      {available === false ? (
        <div className="max-w-xl mx-auto p-6 space-y-3 text-sm" data-testid="parts-unavailable">
          <p>{t("partsCatalog.unavailable")}</p>
          <pre className="rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] p-3 text-[11px] overflow-auto">
            {`python scripts/import_epc_parts.py --manual E:\\manual\n# → data/parts.sqlite`}
          </pre>
        </div>
      ) : null}

      {available ? (
        <>
          <div className="lg:hidden shrink-0 flex border-b border-[var(--border-color)] bg-[var(--bg-card)]">
            {(
              [
                ["tree", t("partsCatalog.tabTree")],
                ["art", t("partsCatalog.tabArt")],
                ["table", t("partsCatalog.tabTable")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`flex-1 py-2 text-xs font-medium ${
                  mobilePane === id
                    ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }`}
                onClick={() => setMobilePane(id)}
                data-testid={`parts-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 hidden lg:grid lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(280px,360px)]">
            {treePane}
            {artPane}
            {tablePane}
          </div>

          <div className="flex-1 min-h-0 lg:hidden">
            {mobilePane === "tree" ? treePane : null}
            {mobilePane === "art" ? artPane : null}
            {mobilePane === "table" ? tablePane : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
