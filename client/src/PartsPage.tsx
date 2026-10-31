import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { EmptyStateHero } from "./EmptyStateHero.js";
import {
  initialSharedVehicle,
  vehicleHref,
  writeFiltersToStorage,
} from "./filterPersist.js";
import { useUiLang } from "./i18n/LangProvider.js";
import { TreeChevronIcon } from "./TreeChevron.js";

type FgNode = {
  id: number;
  path: string;
  label: string | null;
  parentPath: string | null;
  depth: number;
  title: string;
  plateCount: number | null;
  hasChildren?: boolean;
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
  note: string | null;
  qty: number | null;
  unit: string | null;
};

type CalloutBox = { x: number; y: number; w: number; h: number };

type MobilePane = "tree" | "art" | "table";

function containedImageRect(img: HTMLImageElement): { left: number; top: number; width: number; height: number } {
  const r = img.getBoundingClientRect();
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (nw < 2 || nh < 2 || r.width < 2 || r.height < 2) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const ir = nw / nh;
  const er = r.width / r.height;
  if (er > ir) {
    const width = r.height * ir;
    return { left: r.left + (r.width - width) / 2, top: r.top, width, height: r.height };
  }
  const height = r.width / ir;
  return { left: r.left, top: r.top + (r.height - height) / 2, width: r.width, height };
}

function readParam(key: string): string {
  try {
    return new URLSearchParams(window.location.search).get(key) || "";
  } catch {
    return "";
  }
}

function persistVehicle(model: string, year: string) {
  writeFiltersToStorage({ model, year });
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

function splitPartNotes(note: string): { lines: string[]; tags: string[] } {
  const chunks = note
    .split(/\s*[·|;]\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];
  const tags: string[] = [];
  for (const chunk of chunks) {
    const vc = chunk.match(/^variant code\s*:\s*(.+)$/i);
    if (vc) {
      tags.push(vc[1].trim());
      continue;
    }
    if (/^CH\b/i.test(chunk) || /^\([A-Z]{2}(?:\s*,\s*[A-Z]{2})*\)\s*$/.test(chunk)) {
      tags.push(chunk);
      continue;
    }
    lines.push(chunk);
  }
  return { lines, tags };
}

function CopyPnIcon({ copied }: { copied?: boolean }) {
  if (copied) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 12.5 9.5 17 19 7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15V5a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PartsPage() {
  const { t, lang } = useUiLang();
  const vehicle0 = useMemo(() => initialSharedVehicle(), []);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [vinInput, setVinInput] = useState(() => readParam("vin").toUpperCase());
  const [vinNote, setVinNote] = useState("");
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
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [callouts, setCallouts] = useState<Record<string, CalloutBox>>({});
  const [markTick, setMarkTick] = useState(0);
  const [markStyle, setMarkStyle] = useState<CSSProperties | null>(null);
  const [layerBox, setLayerBox] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const [copiedKey, setCopiedKey] = useState("");
  const [copiedPn, setCopiedPn] = useState("");
  const copyTimer = useRef(0);
  const graphicImgRef = useRef<HTMLImageElement | null>(null);
  const graphicPaneRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
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
    if (!year || !years.length) return;
    if (!years.includes(year)) setYear(years[0] || "");
  }, [years, year]);

  async function applyVin() {
    const vin = vinInput.trim().toUpperCase();
    if (vin.length !== 17) {
      setVinNote(t("service.vinNeed17"));
      return;
    }
    setVinNote(t("service.vinDecoding"));
    try {
      const data = await fetch(`/api/vin/decode?vin=${encodeURIComponent(vin)}`).then((r) => r.json());
      if (!data.ok) {
        setVinNote(
          typeof data.error === "string" && data.error.trim() ? data.error : t("service.vinFail"),
        );
        return;
      }
      const nextModel = String(data.model || "").trim();
      const nextYear = String(data.year || "").trim();
      if (!nextModel && !nextYear) {
        setVinNote(t("service.vinFail"));
        return;
      }
      if (nextModel) setModel(nextModel);
      if (nextYear) setYear(nextYear);
      writeFiltersToStorage({
        model: nextModel || model,
        year: nextYear || year,
        engine: String(data.engine || "").trim() || undefined,
        transmission: String(data.transmission || "").trim() || undefined,
      });
      setVinNote(`${nextModel || "—"} · ${nextYear || "—"}`);
    } catch {
      setVinNote(t("service.vinFail"));
    }
  }

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
      setSelectedIdx(null);
      setCallouts({});
      return;
    }
    setDetailLoading(true);
    setActiveHotspot(null);
    setSelectedIdx(null);
    setCallouts({});
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
        setParts(
          Array.isArray(d.parts)
            ? d.parts.map((p: PlatePart) => ({
                ...p,
                note: typeof p.note === "string" && p.note.trim() ? p.note.trim() : null,
              }))
            : [],
        );
        const nextCallouts: Record<string, CalloutBox> = {};
        if (d.callouts && typeof d.callouts === "object") {
          for (const [id, box] of Object.entries(d.callouts as Record<string, CalloutBox>)) {
            const x = Number(box?.x);
            const y = Number(box?.y);
            const w = Number(box?.w);
            const h = Number(box?.h);
            if ([x, y, w, h].every((n) => Number.isFinite(n))) nextCallouts[String(id).trim()] = { x, y, w, h };
          }
        }
        setCallouts(nextCallouts);
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

  function renderNode(node: FgNode) {
    const kids = childrenByParent[node.path];
    const open = openPaths.has(node.path);
    const selected = selectedFg === node.path;
    const code = (node.label || node.path.replace(/^\//, "")).trim();
    const title = (node.title || "").trim();
    const titleIsCode =
      !title ||
      title === code ||
      title.replace(/\s+/g, "") === code.replace(/\s+/g, "");
    const hasLoadedKids = kids != null;
    const canExpand = Boolean(node.hasChildren) || (hasLoadedKids && kids.length > 0);
    return (
      <li key={node.path} className="select-none">
        <div
          className={`parts-fg-tree__row ${selected ? "is-selected" : ""} ${open ? "is-open" : ""}`}
        >
          {canExpand ? (
            <button
              type="button"
              className={`nav-tree-chevron ${open ? "is-open" : ""}`}
              aria-label={open ? "collapse" : "expand"}
              onClick={() => void toggleOpen(node)}
            >
              <TreeChevronIcon />
            </button>
          ) : (
            <span className="nav-tree-chevron is-leaf" />
          )}
          <button
            type="button"
            className="parts-fg-tree__label"
            onClick={() => {
              setSelectedFg(node.path);
              setMobilePane("art");
              if (canExpand && !open) void toggleOpen(node);
            }}
            data-testid={`parts-fg-${node.path}`}
          >
            <span className="parts-fg-tree__code">{code}</span>
            {titleIsCode ? null : <span className="parts-fg-tree__title">{title}</span>}
            {node.plateCount != null && node.plateCount > 0 ? (
              <span className="parts-fg-tree__count">{node.plateCount}</span>
            ) : null}
          </button>
        </div>
        {open && kids && kids.length > 0 ? (
          <ul>{kids.map((c) => renderNode(c))}</ul>
        ) : null}
      </li>
    );
  }

  async function copyPn(key: string, pn: string, ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const text = pn.trim();
    if (!text || text === "ns") return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setCopiedPn(text);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        setCopiedKey("");
        setCopiedPn("");
      }, 1600);
    } catch {
      setCopiedKey("");
      setCopiedPn("");
    }
  }

  function selectPart(index: number, hotspot: string) {
    setSelectedIdx(index);
    setActiveHotspot(hotspot ? String(hotspot).trim() : null);
    setMarkTick((n) => n + 1);
  }

  function calloutFor(id: string | null): CalloutBox | null {
    if (!id) return null;
    const key = String(id).trim();
    if (callouts[key]) return callouts[key];
    const n = Number(key);
    if (Number.isFinite(n) && callouts[String(n)]) return callouts[String(n)];
    return null;
  }

  function onGraphicClick(ev: MouseEvent<HTMLDivElement>) {
    const img = graphicImgRef.current;
    if (!img) return;
    const rect = containedImageRect(img);
    if (rect.width < 2 || rect.height < 2) return;
    const nx = (ev.clientX - rect.left) / rect.width;
    const ny = (ev.clientY - rect.top) / rect.height;
    const pad = 0.014;
    let hit: string | null = null;
    let best = 9;
    for (const [id, box] of Object.entries(callouts)) {
      if (
        nx >= box.x - pad &&
        nx <= box.x + box.w + pad &&
        ny >= box.y - pad &&
        ny <= box.y + box.h + pad
      ) {
        const d =
          (nx - (box.x + box.w / 2)) ** 2 + (ny - (box.y + box.h / 2)) ** 2;
        if (d < best) {
          best = d;
          hit = id;
        }
      }
    }
    if (hit) {
      const idx = parts.findIndex((p) => String(p.hotspot || "").trim() === hit);
      selectPart(idx >= 0 ? idx : 0, hit);
    }
  }

  function measureLayer() {
    const img = graphicImgRef.current;
    const pane = graphicPaneRef.current;
    if (!img || !pane) {
      setLayerBox(null);
      return;
    }
    const ir = containedImageRect(img);
    const pr = pane.getBoundingClientRect();
    if (ir.width < 2 || ir.height < 2) {
      setLayerBox(null);
      return;
    }
    setLayerBox({
      left: ir.left - pr.left,
      top: ir.top - pr.top,
      width: ir.width,
      height: ir.height,
    });
  }

  useLayoutEffect(() => {
    measureLayer();
    const box = calloutFor(activeHotspot);
    const img = graphicImgRef.current;
    const pane = graphicPaneRef.current;
    if (!box || !img || !pane) {
      setMarkStyle(null);
      return;
    }
    const ir = containedImageRect(img);
    if (ir.width < 2 || ir.height < 2) {
      setMarkStyle(null);
      return;
    }
    const w = Math.min(40, Math.max(22, box.w * ir.width * 1.7));
    const h = Math.min(40, Math.max(22, box.h * ir.height * 1.7));
    setMarkStyle({
      left: `${(box.x + box.w / 2) * 100}%`,
      top: `${(box.y + box.h / 2) * 100}%`,
      width: w,
      height: h,
    });
  }, [activeHotspot, callouts, markTick, graphicUrl]);

  useEffect(() => {
    const pane = graphicPaneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    const bump = () => setMarkTick((n) => n + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(pane);
    window.addEventListener("resize", bump);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, [graphicUrl]);

  const treePane = (
    <div className="flex flex-col min-h-0 h-full border-r border-[var(--border-color)] bg-[var(--bg-card)]">
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
            data-testid="parts-vin"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="shrink-0 rounded-md border border-[var(--border-color)] px-2 text-xs hover:bg-[var(--input-bg)]"
            onClick={() => void applyVin()}
            data-testid="parts-vin-apply"
          >
            {t("service.vinApply")}
          </button>
        </div>
        {vinNote ? <p className="text-[10px] text-[var(--text-muted)]">{vinNote}</p> : null}
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
              <option value="">{t("partsCatalog.pickModel")}</option>
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
              disabled={!model}
            >
              <option value="">{t("partsCatalog.pickYear")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-1.5" data-testid="parts-tree">
        {treeLoading ? (
          <p className="text-xs text-[var(--text-muted)] px-2">{t("partsCatalog.loading")}</p>
        ) : (
          <ul className="parts-fg-tree">{roots.map((n) => renderNode(n))}</ul>
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
      <div
        ref={graphicPaneRef}
        className={`flex-1 min-h-0 overflow-auto flex items-center justify-center p-2 relative ${
          selectedFg && graphicUrl ? "bg-white" : "bg-[var(--bg-main)]"
        }`}
        data-testid="parts-graphic-frame"
        onClick={onGraphicClick}
      >
        {!selectedFg ? (
          <EmptyStateHero
            selectedModel={model}
            wordmark={t("partsCatalog.title")}
            greetingKey="partsCatalog.pickFg"
            introKey="partsCatalog.pickFgHint"
            showDetails={false}
          />
        ) : platesLoading || detailLoading ? (
          <p className="text-xs text-[var(--text-muted)]">{t("partsCatalog.loading")}</p>
        ) : plates.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{t("partsCatalog.noPlates")}</p>
        ) : graphicUrl ? (
          <>
            <img
              ref={graphicImgRef}
              src={graphicUrl}
              alt={plateTitle || "plate"}
              className="max-w-full max-h-full object-contain relative z-0"
              data-testid="parts-graphic"
              onLoad={() => setMarkTick((n) => n + 1)}
            />
            {layerBox ? (
              <div
                ref={overlayRef}
                className="parts-callout-layer"
                style={{
                  left: layerBox.left,
                  top: layerBox.top,
                  width: layerBox.width,
                  height: layerBox.height,
                }}
              >
                {markStyle ? <span className="parts-callout" style={markStyle} /> : null}
              </div>
            ) : null}
          </>
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
      <div className="px-3 py-2 border-b border-[var(--border-color)] shrink-0">
        <div className="text-sm font-semibold">{t("partsCatalog.bom")}</div>
        {copiedPn ? (
          <p className="parts-bom-copied" data-testid="parts-copied">
            {t("partsCatalog.copied", { n: copiedPn })}
          </p>
        ) : null}
        {activeHotspot && parts.filter((p) => String(p.hotspot || "") === activeHotspot).length > 1 ? (
          <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">
            {t("partsCatalog.calloutGroup", {
              n: activeHotspot,
              k: parts.filter((p) => String(p.hotspot || "") === activeHotspot).length,
            })}
          </p>
        ) : null}
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
                <th className="px-2 py-1.5 w-[9rem] font-medium">{t("partsCatalog.colPn")}</th>
                <th className="px-2 py-1.5 font-medium">{t("partsCatalog.colTitle")}</th>
                <th className="px-2 py-1.5 w-14 font-medium text-right">{t("partsCatalog.colQty")}</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((row, i) => {
                const hs = row.hotspot != null ? String(row.hotspot) : "";
                const selected = selectedIdx === i;
                const sibling = !selected && activeHotspot != null && hs !== "" && hs === activeHotspot;
                const bits = row.note ? splitPartNotes(row.note) : null;
                return (
                  <tr
                    key={`${hs}-${row.pn || ""}-${i}`}
                    className={`border-b border-[var(--border-color)]/60 cursor-pointer ${
                      selected
                        ? "bg-[var(--accent)]/20"
                        : sibling
                          ? "bg-[var(--accent)]/8"
                          : "hover:bg-[var(--input-bg)]"
                    }`}
                    onClick={() => selectPart(i, hs)}
                    data-testid={hs ? `parts-row-${hs}` : `parts-row-i${i}`}
                  >
                    <td className="px-2 py-1 font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                      {hs || "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-[12px] whitespace-nowrap">
                      {row.pn && row.pn !== "ns" ? (
                        <span className="parts-bom-pn">
                          <span>{row.pn}</span>
                          <button
                            type="button"
                            className={`parts-bom-copy ${copiedKey === `${i}-${row.pn}` ? "is-copied" : ""}`}
                            title={t("partsCatalog.copyPn")}
                            aria-label={`${t("partsCatalog.copyPn")} ${row.pn}`}
                            data-testid={`parts-copy-${row.pn}`}
                            onClick={(e) => void copyPn(`${i}-${row.pn}`, row.pn || "", e)}
                          >
                            <CopyPnIcon copied={copiedKey === `${i}-${row.pn}`} />
                          </button>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="parts-bom-title">{row.title}</div>
                      {bits
                        ? bits.lines.map((line) => (
                            <div key={line} className="parts-bom-note">
                              {line}
                            </div>
                          ))
                        : null}
                      {bits && bits.tags.length > 0 ? (
                        <div className="parts-bom-tags">
                          {bits.tags.map((tag) => (
                            <span key={tag} className="parts-bom-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!row.note && sibling ? (
                        <div className="parts-bom-note parts-bom-note--muted">
                          {t("partsCatalog.sameCalloutHint")}
                        </div>
                      ) : null}
                    </td>
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
        <a
          href={vehicleHref("/", model, year, { vin: vinInput.length === 17 ? vinInput : "" })}
          className="text-sm text-[var(--accent)] hover:underline shrink-0"
        >
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
        <a
          href={vehicleHref("/service", model, year, { vin: vinInput.length === 17 ? vinInput : "" })}
          className="hidden sm:inline text-xs text-[var(--text-muted)] hover:underline shrink-0"
          data-testid="parts-nav-service"
        >
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
