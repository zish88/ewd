import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";
import { highlightTarget, syncPinMarkerScreenSize } from "./ewdHighlight.js";
import { WIRE_COLOR_HEX, WIRE_COLOR_RU, normalizeWireColorKey } from "./wireColors.js";
import {
  cardMatchesWireColorFilter,
  collectUniqueWireColors,
  filterCardsByWireColor,
  nextWireColorFilter,
  wireColorChipStyle,
} from "./wireColorFilter.js";
import {
  extractSchemeContext,
  peerCodeFromSchemeCard,
  pickBestDiagram,
  rankDiagramsForContext,
  type SchemeContext,
} from "./ewdSchemeResolver.js";
import "./styles.css";
import { AdminPage } from "./AdminPage.js";
import { loadPersistedFilters, savePersistedFilters } from "./filterPersist.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type Result = {
  id?: number; bookId?: number; book_id?: number; manualId?: number;
  page_number?: number; pinout_page_number?: number; diagram_page_number?: number;
  sourcePage?: number; page?: number; pin_number?: string;
  wire_color?: string; wire_color_ru?: string; wire_color_label?: string;
  component_code?: string; component_type_ru?: string; from_node?: string; to_node?: string;
  via_node?: string; via_code?: string; from_detail?: string; to_detail?: string;
  from_type_ru?: string; to_type_ru?: string; via_type_ru?: string;
  system_name?: string; description?: string; subtitle?: string; search_target?: string;
  page_type?: string; kind?: string; subject_code?: string; steering_side?: string;
  is_verified?: number; requires_manual_review?: number; integrity_score?: number; score?: number;
  harness_left?: string; harness_right?: string; function_text?: string; pins?: string[];
  source_code?: string; destination_code?: string; raw_line?: string;
  match_role?: "owner" | "transit"; card_title?: string; part_number?: string;
  voltage?: string; wire_gauge?: string;
};
type EwdDiagram = {
  diagramUid: string;
  title: string;
  textCodes: string[];
  designFolder: string;
  systemName?: string;
  pathCount?: number;
  groups?: Array<{ schemClass: string; uids: string[]; pathCount: number }>;
};
type EwdEndpoint = { from: string; to: string; color: string; wireName: string; pinFrom?: string; pinTo?: string };
type WireFocus = { pin?: string; wireColor?: string; peerCode?: string };
type ActiveSvg = {
  diagramUid: string;
  searchCode: string;
  objectIds?: string[];
  pin?: string;
  wireColor?: string;
  peerCode?: string;
  zone?: string;
  /** Netlist pins from highlight match (optional, improves opposite-end scoring) */
  pinFrom?: string;
  pinTo?: string;
  /** Increments on every «Показать на схеме» — forces marker re-inject + recenter (never toggle-off). */
  showSeq?: number;
};
type ActivePdf = { bookId: number; page: number; search?: string };
type NavItem = {
  code: string;
  label: string;
  type_ru: string;
  has_pinout?: boolean;
  has_diagram?: boolean;
  has_ewd?: boolean;
};
type NavGroup = { id: string; label: string; items: NavItem[] };
type NavZone = { id: string; label: string; count: number };
const DEFAULT_MODELS = ["XC70", "V70", "S80", "XC60", "S60", "V60"];
type TransmissionOpt = { id: string; label: string };
type FilterAvailable = {
  models: string[];
  years: string[];
  engines: string[];
  transmissions: TransmissionOpt[];
};
const colors = WIRE_COLOR_HEX;
/** RD-GY → «Красный-Серый (RD-GY)» */
function decodeWireColor(colorCode: string | undefined | null): string {
  const raw = normalizeWireColorKey(colorCode);
  if (!raw || raw === "—") return "—";
  const names = raw.split("-").filter(Boolean).map((part) => WIRE_COLOR_RU[part] || part);
  return `${names.join("-")} (${raw})`;
}
function wireStyle(color: string) {
  const [a, b] = normalizeWireColorKey(color).split("-");
  return b
    ? {
        backgroundImage: `repeating-linear-gradient(135deg,${colors[a] || "#334155"} 0 14px,${colors[b] || "#fff"} 14px 20px)`,
      }
    : { backgroundColor: colors[a] || "#334155" };
}
const getColorStyle = (colorCode: string) => {
  const code = normalizeWireColorKey(colorCode);
  const map: Record<string, { bg: string; text: string }> = Object.fromEntries(
    Object.entries(colors).map(([key, bg]) => [
      key,
      { bg, text: ["WH", "W", "YE", "Y"].includes(key) ? "#0f172a" : "#f8fafc" },
    ]),
  );
  if (code.includes("-")) {
    const [a, b] = code.split("-");
    const c1 = map[a] ?? { bg: "#475569", text: "#fff" };
    const c2 = map[b] ?? { bg: "#eab308", text: "#000" };
    return {
      background: `linear-gradient(135deg,${c1.bg} 25%,${c2.bg} 25%,${c2.bg} 50%,${c1.bg} 50%,${c1.bg} 75%,${c2.bg} 75%)`,
      backgroundSize: "16px 16px",
      color: "#ffffff",
      textShadow: "0 0 2px #000, 1px 1px 1px #000",
    };
  }
  const result = map[code] ?? { bg: "#475569", text: "#fff" };
  return {
    background: result.bg,
    color: result.text,
    textShadow: result.text === "#0f172a" ? "none" : "0 0 2px #000, 1px 1px 1px #000",
  };
};

interface PDFCanvasViewerProps {
  bookId: number;
  pageNumber: number;
  searchTarget: string | null;
  zoom: number;
}

/** Normalize Volvo component labels from PDF text items (unicode slashes, spaces). */
function normalizePdfLabel(s: string): string {
  return String(s || "")
    .toUpperCase()
    .replace(/[\u2215\u2044／]/g, "/")
    .replace(/\s+/g, "")
    .trim();
}

type PdfTextBox = { x: number; y: number; w: number; h: number; text: string; midY: number; endX: number };

function findPdfHighlights(
  items: Array<{ str: string; transform: number[]; width: number; height: number }>,
  searchTarget: string,
  viewportTransform: number[],
  scale: number,
): Array<{ x: number; y: number; w: number; h: number; text: string }> {
  const target = normalizePdfLabel(searchTarget);
  if (!target) return [];
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactPattern = new RegExp(`(?:^|[^A-Z0-9/])${escaped}(?![0-9A-Z])`, "i");

  const boxes: PdfTextBox[] = [];
  for (const item of items) {
    const raw = String(item.str || "");
    if (!raw.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewportTransform, item.transform);
    const h = Math.max(item.height * scale, 4);
    const w = Math.max(item.width * scale, 2);
    boxes.push({
      x: tx[4],
      y: tx[5] - h,
      w,
      h: h * 1.3,
      text: raw,
      midY: tx[5] - h / 2,
      endX: tx[4] + w,
    });
  }
  boxes.sort((a, b) => (a.midY - b.midY) || (a.x - b.x));

  const found: Array<{ x: number; y: number; w: number; h: number; text: string }> = [];
  const pushUnique = (box: { x: number; y: number; w: number; h: number; text: string }) => {
    if (box.w < 2 || box.h < 2) return;
    const dup = found.some(
      (f) => Math.abs(f.x - box.x) < 3 && Math.abs(f.y - box.y) < 3 && Math.abs(f.w - box.w) < 6,
    );
    if (!dup) found.push(box);
  };

  const matchesTarget = (joined: string) => {
    const n = normalizePdfLabel(joined);
    return n === target || exactPattern.test(n) || exactPattern.test(joined);
  };

  // 1) Single glyph / word
  for (const b of boxes) {
    if (matchesTarget(b.text)) {
      pushUnique({ x: b.x, y: b.y, w: b.w, h: b.h, text: b.text });
    }
  }

  // 2) Horizontal stitch (split "73" "/" "5019" or "73/" "5019")
  for (let i = 0; i < boxes.length; i++) {
    let joined = boxes[i].text;
    let x0 = boxes[i].x;
    let y0 = boxes[i].y;
    let x1 = boxes[i].x + boxes[i].w;
    let y1 = boxes[i].y + boxes[i].h;
    for (let j = i + 1; j < Math.min(i + 8, boxes.length); j++) {
      const prev = boxes[j - 1];
      const cur = boxes[j];
      if (Math.abs(cur.midY - boxes[i].midY) > Math.max(10, boxes[i].h * 0.7)) break;
      if (cur.x - prev.endX > 18) break;
      joined += cur.text;
      x0 = Math.min(x0, cur.x);
      y0 = Math.min(y0, cur.y);
      x1 = Math.max(x1, cur.x + cur.w);
      y1 = Math.max(y1, cur.y + cur.h);
      if (matchesTarget(joined)) {
        pushUnique({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: joined });
        break;
      }
    }
  }

  // 3) Vertical / nearby stitch for Type/Number (esp. 73/xxx branching points)
  const parts = target.match(/^(\d+)\/(\d+)$/);
  if (parts) {
    const typePart = parts[1];
    const numPart = parts[2];
    const typeBoxes = boxes.filter((b) => {
      const n = normalizePdfLabel(b.text);
      return n === typePart || n === `${typePart}/`;
    });
    const numBoxes = boxes.filter((b) => {
      const n = normalizePdfLabel(b.text);
      return n === numPart || n === `/${numPart}`;
    });
    for (const a of typeBoxes) {
      for (const b of numBoxes) {
        const dx = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        const dy = b.y - (a.y + a.h);
        const sameLine = Math.abs(a.midY - b.midY) <= 8 && b.x - a.endX >= -2 && b.x - a.endX <= 20;
        const stacked = dx <= 36 && dy >= -6 && dy <= 28;
        if (sameLine || stacked) {
          const x0 = Math.min(a.x, b.x);
          const y0 = Math.min(a.y, b.y);
          const x1 = Math.max(a.x + a.w, b.x + b.w);
          const y1 = Math.max(a.y + a.h, b.y + b.h);
          pushUnique({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: target });
        }
      }
    }
  }

  return found;
}

function PDFCanvasViewer({ bookId, pageNumber, searchTarget, zoom }: PDFCanvasViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstHighlightRef = useRef<HTMLDivElement>(null);
  const [highlights, setHighlights] = useState<Array<{ x: number; y: number; w: number; h: number; text: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // Absolute lock: text search must NEVER change this page index
  const lockedPageRef = useRef(pageNumber);
  lockedPageRef.current = pageNumber;

  useEffect(() => {
    let isCurrent = true;
    setHighlights([]);
    setPdfError(null);
    if (canvasRef.current) {
      canvasRef.current.width = 0;
      canvasRef.current.height = 0;
    }
    if (!bookId || !Number.isInteger(pageNumber) || pageNumber < 1) {
      setPdfError("Некорректная страница схемы (нет bookId/page).");
      setLoading(false);
      return;
    }
    // Load full document; page query is ignored by server — we always call getPage(lockedPage)
    const loadingTask = pdfjsLib.getDocument({ url: `/api/pdf/view?bookId=${bookId}&page=${pageNumber}` });

    async function renderPdfPage() {
      if (!canvasRef.current) return;
      const lockedPage = lockedPageRef.current;
      setLoading(true);
      try {
        const pdf = await loadingTask.promise;
        if (!isCurrent || lockedPageRef.current !== lockedPage) return;
        if (lockedPage > pdf.numPages) {
          setPdfError(`Страница ${lockedPage} отсутствует в PDF (всего ${pdf.numPages}).`);
          return;
        }
        // Ironclad: only the card's page_number — never navigate by find-results
        const page = await pdf.getPage(lockedPage);
        if (!isCurrent || lockedPageRef.current !== lockedPage) return;
        const calculatedScale = zoom / 100 * 1.5;
        const viewport = page.getViewport({ scale: calculatedScale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        if (!isCurrent || lockedPageRef.current !== lockedPage) return;

        let foundItems: Array<{ x: number; y: number; w: number; h: number; text: string }> = [];
        try {
          // Highlight ONLY inside this locked page's text layer (with stitch for 73/xxx)
          const textContent = await page.getTextContent();
          if (searchTarget) {
            const rawItems = textContent.items
              .filter((it): it is typeof it & { str: string; transform: number[]; width: number; height: number } =>
                typeof it === "object" && it !== null && "str" in it && "transform" in it,
              )
              .map((it) => ({
                str: String(it.str || ""),
                transform: it.transform as number[],
                width: Number(it.width) || 0,
                height: Number(it.height) || 0,
              }));
            foundItems = findPdfHighlights(rawItems, searchTarget, viewport.transform, calculatedScale);
          }
        } catch (error) {
          console.warn("Текстовый слой недоступен на этой странице:", error);
        }
        if (isCurrent && lockedPageRef.current === lockedPage) setHighlights(foundItems);
      } catch (error) {
        const msg = String((error as Error)?.message || error || "");
        // Race on unmount/switch: pdf.js destroys transport mid-getPage
        if (/Worker was destroyed|Transport destroyed|Loading aborted|AbortError/i.test(msg)) return;
        if (isCurrent) {
          setPdfError(msg.includes("Invalid page") ? `Страница ${lockedPageRef.current} недоступна в этом PDF.` : "Ошибка рендеринга схемы.");
          console.error("Критическая ошибка рендеринга холста схемы:", error);
        }
      } finally {
        if (isCurrent) setLoading(false);
      }
    }

    void renderPdfPage();
    return () => {
      isCurrent = false;
      void loadingTask.destroy();
    };
  }, [bookId, pageNumber, searchTarget, zoom]);

  // Center viewport on the SVG ping marker after highlights are ready
  useEffect(() => {
    if (!highlights.length || loading) return;
    const id = window.requestAnimationFrame(() => {
      firstHighlightRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [highlights, loading, pageNumber, searchTarget, zoom]);

  return <div ref={containerRef} data-testid="pdf-viewer" className="w-full h-full bg-[var(--bg-main)] overflow-auto relative p-4 flex items-start justify-center">
    {loading && <div data-testid="pdf-loading" className="absolute inset-0 z-50 bg-[var(--bg-card)]/70 flex items-center justify-center text-xs font-mono text-emerald-700"><span className="animate-pulse">Загрузка стр. {pageNumber}…</span></div>}
    {pdfError && <div data-testid="pdf-error" className="absolute inset-0 z-40 flex items-center justify-center text-sm text-rose-600 px-4 text-center">{pdfError}</div>}
    <div className="relative inline-block mx-auto">
      <canvas data-testid="pdf-canvas" ref={canvasRef} className="shadow-lg bg-[var(--bg-card)] block rounded border border-[var(--border-color)]" />
      {highlights.map((box, index) => (
        <div
          key={`${box.text}-${index}-${box.x}-${box.y}`}
          ref={index === 0 ? firstHighlightRef : undefined}
          data-testid={index === 0 ? "pdf-highlight-primary" : "pdf-highlight"}
          className="absolute border-2 border-amber-500 bg-amber-300/30 shadow-[0_0_12px_rgba(245,158,11,0.55)] rounded pointer-events-none"
          style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }}
          title={`Найден узел: ${box.text}`}
        />
      ))}
    </div>
  </div>;
}

function normalizeCodeLabel(s: string): string {
  const m = String(s || "").trim().match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(s || "").trim();
}

function mergeEwdEndpoints(wires: Result[], endpoints: EwdEndpoint[], code: string): Result[] {
  if (!endpoints.length) return wires;
  const codeN = normalizeCodeLabel(code);
  return wires.map((w) => {
    const pin = String(w.pin_number || "").trim();
    const color = String(w.wire_color || "").toUpperCase().replace(/\//g, "-").trim();
    const match = endpoints.find((ep) => {
      const epColor = String(ep.color || "").toUpperCase().replace(/\//g, "-");
      const colorOk = !color || color === "—" || !epColor || epColor === color;
      const pinOk =
        !pin ||
        ep.pinFrom === pin ||
        ep.pinTo === pin ||
        ep.from.includes(`:${pin}`) ||
        ep.to.includes(`:${pin}`);
      const involves =
        ep.from.includes(codeN) ||
        ep.to.includes(codeN) ||
        normalizeCodeLabel(ep.from).startsWith(codeN) ||
        normalizeCodeLabel(ep.to).startsWith(codeN);
      return colorOk && pinOk && (involves || !codeN);
    });
    if (!match) return w;
    return { ...w, from_detail: match.from, to_detail: match.to };
  });
}

/** UIDs present on this sheet (from groups) ∩ device objectIds; include full matched groups. */
function diagramScopedUids(diagram: EwdDiagram, objectIds: string[]): string[] {
  const wanted = new Set(objectIds.filter(Boolean));
  if (!wanted.size) return [];
  const groups = diagram.groups || [];
  if (!groups.length) return [...wanted];
  const sheetUids = new Set(groups.flatMap((g) => g.uids || []));
  const scoped = objectIds.filter((id) => sheetUids.has(id));
  const out = new Set(scoped);
  for (const g of groups) {
    if ((g.uids || []).some((u) => wanted.has(u))) {
      for (const u of g.uids || []) out.add(u);
    }
  }
  return out.size ? [...out] : [...wanted];
}

function peerCodeFromCard(item: Result, selectedCode: string): string {
  return peerCodeFromSchemeCard(item, selectedCode);
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
}

function SvgDiagramViewer({
  diagramUid,
  searchCode,
  objectIds = [],
  pin = "",
  wireColor = "",
  peerCode = "",
  zone = "",
  pinFrom = "",
  pinTo = "",
  showSeq = 0,
  onPinMiss,
}: ActiveSvg & { onPinMiss?: (reason: string) => void }) {
  const onPinMissRef = useRef(onPinMiss);
  onPinMissRef.current = onPinMiss;
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const baseSizeRef = useRef<{ w: number; h: number } | null>(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 40, y: 40 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    dist0: number;
    scale0: number;
    midX: number;
    midY: number;
    tx0: number;
    ty0: number;
  } | null>(null);
  const lastMarkerAtRef = useRef<{ x: number; y: number } | null>(null);
  const paintedKeyRef = useRef("");
  const appliedMarkupRef = useRef("");
  const initialFitDoneRef = useRef(false);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveUids, setResolveUids] = useState<string[]>([]);
  const [netPins, setNetPins] = useState<{ pinFrom?: string; pinTo?: string }>({});

  const applyPanZoomDom = () => {
    const pan = panRef.current;
    const svg = contentRef.current?.querySelector("svg") as SVGSVGElement | null;
    const base = baseSizeRef.current;
    const t = translateRef.current;
    const s = scaleRef.current;
    // Free canvas: no contain/bounds clamp — user may drag anywhere at any zoom
    if (pan) pan.style.transform = `translate(${t.x}px, ${t.y}px)`;
    if (svg && base) {
      svg.setAttribute("width", String(Math.max(1, base.w * s)));
      svg.setAttribute("height", String(Math.max(1, base.h * s)));
      svg.style.width = `${base.w * s}px`;
      svg.style.height = `${base.h * s}px`;
      svg.style.maxWidth = "none";
      syncPinMarkerScreenSize(svg);
    }
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const prev = scaleRef.current;
    const next = Math.min(6, Math.max(0.15, prev * factor));
    const ratio = next / prev;
    const t = translateRef.current;
    scaleRef.current = next;
    translateRef.current = {
      x: mx - (mx - t.x) * ratio,
      y: my - (my - t.y) * ratio,
    };
    applyPanZoomDom();
  };

  const fitComfortToMarker = () => {
    const viewport = viewportRef.current;
    const base = baseSizeRef.current;
    const svg = contentRef.current?.querySelector("svg") as SVGSVGElement | null;
    const at = lastMarkerAtRef.current;
    if (!viewport || !base || !svg) return;
    const comfortScale = 1.1;
    scaleRef.current = comfortScale;
    if (at) {
      try {
        const vb = svg.viewBox?.baseVal;
        const vbW = vb?.width || base.w;
        const vbH = vb?.height || base.h;
        const vbX = vb?.x || 0;
        const vbY = vb?.y || 0;
        const sx = (base.w * comfortScale) / vbW;
        const sy = (base.h * comfortScale) / vbH;
        translateRef.current = {
          x: viewport.clientWidth / 2 - (at.x - vbX) * sx,
          y: viewport.clientHeight / 2 - (at.y - vbY) * sy,
        };
        initialFitDoneRef.current = true;
      } catch {
        translateRef.current = { x: 40, y: 40 };
      }
    } else {
      translateRef.current = { x: 40, y: 40 };
    }
    applyPanZoomDom();
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSvgMarkup("");
    setResolveUids([]);
    scaleRef.current = 1;
    translateRef.current = { x: 40, y: 40 };
    baseSizeRef.current = null;
    paintedKeyRef.current = "";
    initialFitDoneRef.current = false;
    fetch(`/api/ewd/svg?diagramUid=${encodeURIComponent(diagramUid)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.text();
      })
      .then((text) => {
        if (!alive) return;
        const cleaned = text
          .replace(/^\uFEFF?<\?xml[\s\S]*?\?>\s*/i, "")
          .replace(/<!DOCTYPE[\s\S]*?>\s*/i, "")
          .trim();
        setSvgMarkup(cleaned);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message || "Не удалось загрузить SVG");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [diagramUid]);

  useEffect(() => {
    let alive = true;
    if (!pin && !wireColor && !peerCode) {
      setResolveUids([]);
      setNetPins({});
      return;
    }
    const params = new URLSearchParams({ code: searchCode, diagramUid });
    if (pin) params.set("pin", pin);
    if (wireColor) params.set("color", wireColor);
    if (peerCode) params.set("peer", peerCode);
    if (zone && zone !== "all") params.set("zone", zone);
    fetch(`/api/ewd/highlight?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const matchedList = Array.isArray(data.matched)
          ? (data.matched as Array<{
              from?: string;
              to?: string;
              pinFrom?: string;
              pinTo?: string;
              fromUid?: string;
              toUid?: string;
            }>)
          : [];
        const peerN = normalizeCodeLabel(peerCode);
        const codeN = normalizeCodeLabel(searchCode);
        // Prefer the single net that involves selected code + peer + pin (avoid duplicate L/R instances)
        const preferred =
          matchedList.find((m) => {
            const blob = `${m.from || ""} ${m.to || ""}`;
            const hasCode = !codeN || blob.includes(codeN);
            const hasPeer = !peerN || blob.includes(peerN);
            const hasPin =
              !pin ||
              String(m.pinFrom || "") === String(pin) ||
              String(m.pinTo || "") === String(pin);
            return hasCode && hasPeer && hasPin;
          }) || matchedList[0] || null;
        const fromMatched = preferred
          ? ([preferred.fromUid, preferred.toUid].filter(Boolean) as string[])
          : [];
        const apiUids = Array.isArray(data.uids) ? (data.uids as string[]) : [];
        // Prefer exact net endpoints only — mixing all sheet UIDs reintroduces duplicate L/R pins
        setResolveUids(fromMatched.length ? fromMatched : apiUids.slice(0, 8));
        setNetPins({
          pinFrom: String(preferred?.pinFrom || pinFrom || "").trim() || undefined,
          pinTo: String(preferred?.pinTo || pinTo || "").trim() || undefined,
        });
      })
      .catch(() => {
        if (alive) {
          setResolveUids([]);
          setNetPins({});
        }
      });
    return () => {
      alive = false;
    };
  }, [diagramUid, searchCode, pin, wireColor, peerCode, zone, pinFrom, pinTo]);

  // Apply SVG markup once per string — never via render dangerouslySetInnerHTML
  // (React re-renders would wipe injected .pin-marker otherwise = false "toggle")
  useEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    if (!svgMarkup) {
      host.innerHTML = "";
      appliedMarkupRef.current = "";
      return;
    }
    if (appliedMarkupRef.current === svgMarkup && host.querySelector("svg")) return;
    host.innerHTML = svgMarkup;
    appliedMarkupRef.current = svgMarkup;

    const svg = host.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox?.baseVal;
    let w = Number(svg.getAttribute("width")) || vb?.width || 0;
    let h = Number(svg.getAttribute("height")) || vb?.height || 0;
    if ((!w || !h) && vb?.width && vb?.height) {
      w = vb.width;
      h = vb.height;
    }
    if (!w || !h) {
      try {
        const box = svg.getBBox();
        w = box.width || 1200;
        h = box.height || 800;
      } catch {
        w = 1200;
        h = 800;
      }
    }
    const fit = Math.min(1, 900 / w);
    baseSizeRef.current = { w: w * fit, h: h * fit };
    if (!svg.getAttribute("viewBox") && w && h) {
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    scaleRef.current = 1;
    translateRef.current = { x: 40, y: 40 };
    initialFitDoneRef.current = false;
    paintedKeyRef.current = "";
    applyPanZoomDom();
  }, [svgMarkup]);

  // Marker inject on showSeq / focus change. Strict pin: no frame/viewBox retry.
  useEffect(() => {
    if (!svgMarkup || !contentRef.current) return;
    if (!pin && !wireColor && !searchCode) return;
    const root = contentRef.current;
    const svg = root.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const focusKey = `${diagramUid}|${normalizeCodeLabel(searchCode)}|${pin}|${wireColor}|${peerCode}|${showSeq}|${netPins.pinFrom || ""}|${netPins.pinTo || ""}|${resolveUids.join(",")}`;

    const result = highlightTarget(root, svg, {
      connectorCode: searchCode,
      pinNumber: pin,
      wireColor,
      systemUid: resolveUids[0],
      diagramUid,
      peerCode,
    });
    // Soft mode only: retry once when no pin was requested
    if (!pin && !svg.querySelector("g.pin-marker")) {
      highlightTarget(root, svg, {
        connectorCode: searchCode,
        pinNumber: pin,
        wireColor,
        systemUid: resolveUids[0],
        diagramUid,
        peerCode,
      });
    }
    syncPinMarkerScreenSize(svg);

    paintedKeyRef.current = focusKey;

    if (pin && result.stage === "none") {
      onPinMissRef.current?.(result.reason || "pin-miss");
      applyPanZoomDom();
      return;
    }

    if (result.markerAt) lastMarkerAtRef.current = result.markerAt;
    if (viewportRef.current && baseSizeRef.current && result.markerAt) {
      fitComfortToMarker();
    } else {
      applyPanZoomDom();
    }
  }, [
    svgMarkup,
    searchCode,
    diagramUid,
    resolveUids,
    pin,
    wireColor,
    peerCode,
    pinFrom,
    pinTo,
    showSeq,
    netPins.pinFrom,
    netPins.pinTo,
  ]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const pointerDistance = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  };
  const pointerMidpoint = () => {
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return { x: 0, y: 0 };
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // Ignore FAB / UI controls inside viewport
    if ((e.target as Element).closest?.("[data-testid='svg-zoom-fab']")) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2) {
      dragRef.current = null;
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mid = pointerMidpoint();
      const dist = pointerDistance();
      if (dist > 0) {
        pinchRef.current = {
          dist0: dist,
          scale0: scaleRef.current,
          midX: mid.x - rect.left,
          midY: mid.y - rect.top,
          tx0: translateRef.current.x,
          ty0: translateRef.current.y,
        };
      }
      return;
    }
    pinchRef.current = null;
    const t = translateRef.current;
    dragRef.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mid = pointerMidpoint();
      const dist = pointerDistance();
      const p = pinchRef.current;
      if (!(dist > 0) || !(p.dist0 > 0)) return;
      const next = Math.min(6, Math.max(0.15, p.scale0 * (dist / p.dist0)));
      const ratio = next / p.scale0;
      const mx = mid.x - rect.left;
      const my = mid.y - rect.top;
      // Keep content under the pinch midpoint stable
      scaleRef.current = next;
      translateRef.current = {
        x: mx - (p.midX - p.tx0) * ratio,
        y: my - (p.midY - p.ty0) * ratio,
      };
      applyPanZoomDom();
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    translateRef.current = { x: d.tx + (e.clientX - d.x), y: d.ty + (e.clientY - d.y) };
    applyPanZoomDom();
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const [pt] = pointersRef.current.values();
      const t = translateRef.current;
      dragRef.current = { x: pt.x, y: pt.y, tx: t.x, ty: t.y };
    } else {
      dragRef.current = null;
    }
  };

  return (
    <div
      ref={viewportRef}
      data-testid="svg-viewer"
      className="svg-viewer w-full h-full bg-[var(--input-bg)] overflow-hidden relative cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onPointerUp(e);
      }}
    >
      {loading && (
        <div data-testid="svg-loading" className="absolute inset-0 z-50 bg-[var(--bg-card)]/70 flex items-center justify-center text-xs font-mono text-emerald-700">
          <span className="animate-pulse">Загрузка SVG…</span>
        </div>
      )}
      {error && (
        <div data-testid="svg-error" className="absolute inset-0 z-40 flex items-center justify-center text-sm text-rose-600 px-4 text-center">
          {error}
        </div>
      )}
      {/* Pan layer — transform via ref; SVG host must not re-render on drag */}
      <div ref={panRef} className="origin-top-left will-change-transform" style={{ transform: "translate(40px, 40px)" }}>
        <div ref={contentRef} data-testid="svg-canvas" className="ewd-svg-root" />
      </div>
      <div data-testid="svg-zoom-fab" className="svg-zoom-fab" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Увеличить"
          className="svg-zoom-fab__btn"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.1);
          }}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Уменьшить"
          className="svg-zoom-fab__btn"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.9);
          }}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Сброс масштаба"
          className="svg-zoom-fab__btn svg-zoom-fab__btn--reset"
          onClick={() => fitComfortToMarker()}
        >
          Сброс
        </button>
      </div>
    </div>
  );
}

function renderWireCard(
  item: Result,
  index: number,
  hasEwdDiagram: boolean,
  selectedCode: string,
  setSelectedPinState: (v: { id: string | number; code: string; color: string; pin: string } | null) => void,
  selectedPinState: { id: string | number; code: string; color: string; pin: string } | null,
  onOpenDiagram: (searchCode: string, preferredUid?: string, wire?: WireFocus, card?: Result) => void,
  setActivePdf: (v: ActivePdf | null) => void,
  setActiveSvg: (v: ActiveSvg | null) => void,
  setNotice: (v: string) => void,
  setEditingItem: (v: any) => void,
  suggestionsEnabled = true,
  pdfTablesEnabled = true,
  cardContext?: { zone: string; code: string; model: string; year: string; engine: string },
) {
  const itemId = item.id || `search-${index}`;
  const isThis = selectedPinState?.id === itemId;
  const wireRu = item.wire_color_ru || decodeWireColor(item.wire_color).replace(/\s*\([^)]*\)\s*$/, "") || "—";
  const wireCode = item.wire_color && item.wire_color !== "—" ? item.wire_color : "—";
  const pinoutPage = Number(item.pinout_page_number) || 0;
  const bookId = Number(item.book_id || item.bookId || item.manualId) || 0;
  const openDiagram = () => {
    if (!hasEwdDiagram) {
      setNotice("Графическая схема EWD для этого узла не найдена. Используйте «Таблица».");
      return;
    }
    const code = String(selectedCode || item.search_target || item.from_node || "").trim();
    // Recover pin from multiple card fields — empty pin broke highlight on 74/507 / 3/65
    let pin = String(item.pin_number || "").trim();
    if (!pin && Array.isArray(item.pins) && item.pins.length) {
      pin = String(item.pins[0] ?? "").trim();
    }
    if (!pin) {
      const blob = `${item.card_title || ""} ${item.from_detail || ""} ${item.to_detail || ""} ${item.raw_line || ""}`;
      const m = blob.match(/контакт\s*[№#:]?\s*(\d{1,3})/i) || blob.match(/:(\d{1,3})\b/);
      if (m?.[1]) pin = String(m[1]);
    }
    // Persist selection strictly on click — never tied to hover/mouseleave
    setSelectedPinState({
      id: itemId,
      code,
      color: wireCode !== "—" ? wireCode : "",
      pin,
    });
    onOpenDiagram(
      code,
      undefined,
      {
        pin: pin || undefined,
        wireColor: wireCode !== "—" ? wireCode : undefined,
        peerCode: peerCodeFromCard(item, code) || undefined,
      },
      item,
    );
  };
  const openPinout = () => {
    if (!bookId || pinoutPage < 1) {
      setNotice("Нет страницы таблицы разъёма.");
      return;
    }
    setActiveSvg(null);
    setActivePdf({
      bookId,
      page: pinoutPage,
      search: String(item.subject_code || selectedCode || "").trim() || undefined,
    });
  };
  const connectorTitle = item.card_title || item.system_name || "Контакт";
  const steering = item.steering_side === "LHD" || item.steering_side === "RHD" ? item.steering_side : "";
  const fromLabel =
    (item.from_detail && String(item.from_detail).trim()) ||
    (item.from_node && item.from_node !== "—" ? `${item.from_node}${item.from_type_ru ? ` — ${item.from_type_ru}` : ""}` : "—");
  const toLabel =
    (item.to_detail && String(item.to_detail).trim()) ||
    (item.to_node && item.to_node !== "—" ? `${item.to_node}${item.to_type_ru ? ` — ${item.to_type_ru}` : ""}` : "—");
  const score = typeof item.integrity_score === "number" ? item.integrity_score : (typeof item.score === "number" ? item.score : null);
  return (
    <div
      key={itemId}
      data-testid="result-card"
      className={`bg-[var(--bg-card)] border rounded-lg p-4 mb-2 flex flex-col gap-2.5 text-left transition-all shadow-sm ${isThis ? "border-emerald-500 shadow-md ring-1 ring-emerald-400/40" : "border-[var(--border-color)]"} ${selectedPinState && !isThis ? "border-dashed opacity-100" : "opacity-100"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <h3 className="ewd-data text-sm font-semibold text-[var(--text-main)] leading-snug">{connectorTitle}</h3>
          {item.part_number ? (
            <span
              data-testid="part-number-badge"
              className="ewd-light-badge inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-300 shrink-0"
              title="Парт-номер корпуса разъёма (не контакта)"
            >
              <span className="text-[10px] font-sans">Корпус разъёма:</span>
              <span className="text-xs font-mono font-bold tracking-wide">{item.part_number}</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {steering ? (
            <span className="ewd-light-badge text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-sky-50 border-sky-300">{steering}</span>
          ) : null}
          {item.is_verified ? (
            <span className="ewd-light-badge text-[10px] font-mono px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-300">verified</span>
          ) : null}
          {score !== null ? (
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                score >= 100
                  ? "ewd-light-badge bg-emerald-50 border-emerald-300"
                  : score >= 50
                    ? "ewd-light-badge bg-amber-50 border-amber-300"
                    : "text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--border-color)]"
              }`}
            >
              {score}%
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-xs font-mono text-[var(--text-main)] bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md p-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[var(--text-muted)] font-sans">Откуда</span>
          <span className="ewd-data font-bold whitespace-pre-wrap break-words text-[var(--text-main)]">{fromLabel}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[var(--text-muted)] font-sans">Куда</span>
          <span className="ewd-data font-bold whitespace-pre-wrap break-words text-[var(--text-main)]">{toLabel}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[var(--text-muted)] font-sans">Провод</span>
          <span
            className="ewd-wire-badge px-1.5 py-0.5 rounded border border-[var(--border-color)] font-bold font-sans"
            style={wireCode !== "—" ? getColorStyle(wireCode) : undefined}
          >
            {wireRu}{wireCode !== "—" ? ` (${wireCode})` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[var(--text-muted)] font-sans">
          <span>Сечение: <span className="ewd-data font-mono text-[var(--text-main)]">{item.wire_gauge ? `${item.wire_gauge} мм²` : "—"}</span></span>
          <span>Напряжение: <span className="ewd-data font-mono text-[var(--text-main)]">{item.voltage?.trim() || "—"}</span></span>
        </div>
      </div>
      <div className="flex gap-2 mt-0.5">
        {hasEwdDiagram ? (
          <button type="button" data-testid="show-on-diagram" onClick={openDiagram} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1.5 rounded font-medium">
            Показать на схеме
          </button>
        ) : null}
        {pinoutPage > 0 && pdfTablesEnabled ? (
          <button type="button" data-testid="show-pinout" onClick={openPinout} className={`${hasEwdDiagram ? "px-2" : "flex-1"} bg-[var(--bg-card)] hover:bg-[var(--input-bg)] text-[var(--text-main)] text-xs py-1.5 rounded font-medium border border-[var(--border-color)]`}>
            Таблица
          </button>
        ) : null}
        {suggestionsEnabled ? (
          <button
            type="button"
            data-testid="suggest-edit"
            title="Предложить исправление"
            aria-label="Предложить исправление"
            onClick={() =>
              setEditingItem({
                ...item,
                _card_ctx: cardContext,
                _card_url: buildCardDeepLink({
                  zone: cardContext?.zone || "all",
                  code: cardContext?.code || String(item.subject_code || selectedCode || ""),
                  wireId: item.id,
                  model: cardContext?.model || "",
                  year: cardContext?.year || "",
                  engine: cardContext?.engine || "",
                }),
              })
            }
            className="suggest-edit-btn"
          >
            ✎
          </button>
        ) : null}
      </div>
    </div>
  );
}

function buildCardDeepLink(opts: {
  zone: string;
  code: string;
  wireId?: string | number;
  model: string;
  year: string;
  engine: string;
}): string {
  const u = new URL(typeof window !== "undefined" ? window.location.origin + "/" : "http://localhost/");
  if (opts.model) u.searchParams.set("model", opts.model);
  if (opts.year) u.searchParams.set("year", opts.year);
  if (opts.engine) u.searchParams.set("engine", opts.engine);
  if (opts.zone && opts.zone !== "all") u.searchParams.set("zone", opts.zone);
  if (opts.code) u.searchParams.set("code", opts.code);
  if (opts.wireId != null && opts.wireId !== "") u.searchParams.set("wireId", String(opts.wireId));
  return u.toString();
}

const THEMES = [
  { id: "charcoal", label: "Charcoal" },
  { id: "caspian", label: "Caspian" },
  { id: "amber", label: "Amber" },
] as const;
type ThemeId = (typeof THEMES)[number]["id"];

function migrateThemeId(raw: string | null): ThemeId {
  if (raw === "charcoal" || raw === "caspian" || raw === "amber") return raw;
  if (raw === "volvo-charcoal") return "charcoal";
  if (raw === "volvo-silver" || raw === "volvo-ocean") return "caspian";
  return "caspian";
}

function App() {
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedEngine, setSelectedEngine] = useState("");
  const [selectedTransmission, setSelectedTransmission] = useState("");
  const [vinInput, setVinInput] = useState("");
  const [vinLocked, setVinLocked] = useState(false);
  const [vinNotice, setVinNotice] = useState("");
  const [available, setAvailable] = useState<FilterAvailable>({
    models: DEFAULT_MODELS,
    years: [],
    engines: [],
    transmissions: [],
  });
  const [mode, setMode] = useState<"search" | null>(null);
  const [ownerWires, setOwnerWires] = useState<Result[]>([]);
  const [transitWires, setTransitWires] = useState<Result[]>([]);
  const [ewdDiagrams, setEwdDiagrams] = useState<EwdDiagram[]>([]);
  const [ewdObjectIds, setEwdObjectIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [activePdf, setActivePdf] = useState<ActivePdf | null>(null);
  const [activeSvg, setActiveSvg] = useState<ActiveSvg | null>(null);
  const showSeqRef = useRef(0);
  const [zoom, setZoom] = useState(80);
  const [selectedPinState, setSelectedPinState] = useState<{
    id: string | number;
    code: string;
    color: string;
    pin: string;
  } | null>(null);
  const [zones, setZones] = useState<NavZone[]>([]);
  const [navGroups, setNavGroups] = useState<NavGroup[]>([]);
  const [selectedZone, setSelectedZone] = useState("all");
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteOpen, setSiteOpen] = useState(true);
  const [features, setFeatures] = useState({
    suggestions: true,
    ewdDiagrams: true,
    pdfTables: true,
    vinSearch: true,
    navBrowse: true,
  });
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [vehicleConfigured, setVehicleConfigured] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const deepWireIdRef = useRef<string>("");
  const filtersHydratedRef = useRef(false);
  const [selectedCode, setSelectedCode] = useState("");
  /** null = all colors; otherwise normalized wireColor from current node cards */
  const [wireColorFilter, setWireColorFilter] = useState<string | null>(null);
  /** Last card circuit context for weighted diagram ranking */
  const [schemeContext, setSchemeContext] = useState<SchemeContext | null>(null);
  /** Mobile (<768px) tab: cards list vs scheme canvas */
  const [mobileView, setMobileView] = useState<"cards" | "scheme">("cards");
  const [diagramPickerOpen, setDiagramPickerOpen] = useState(false);
  const diagramPickerRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeId>(() => {
    try {
      return migrateThemeId(localStorage.getItem("volvoTheme"));
    } catch {
      /* ignore */
    }
    return "caspian";
  });
  const vehicle = {
    model: selectedModel,
    year: selectedYear,
    engine: selectedEngine,
    transmission: selectedTransmission,
  };
  const rightOpen = Boolean(activeSvg || activePdf);
  const hasEwdDiagram = ewdDiagrams.length > 0;

  const availableWireColors = useMemo(
    () => collectUniqueWireColors([...ownerWires, ...transitWires]),
    [ownerWires, transitWires],
  );
  const filteredOwnerWires = useMemo(
    () => filterCardsByWireColor(ownerWires, wireColorFilter),
    [ownerWires, wireColorFilter],
  );
  const filteredTransitWires = useMemo(
    () => filterCardsByWireColor(transitWires, wireColorFilter),
    [transitWires, wireColorFilter],
  );

  // Drop selection / marker when the active card is hidden by the color filter
  useEffect(() => {
    if (!wireColorFilter || !selectedPinState) return;
    const stillVisible =
      cardMatchesWireColorFilter(
        { wire_color: selectedPinState.color },
        wireColorFilter,
      );
    if (stillVisible) return;
    setSelectedPinState(null);
    setActiveSvg((prev) => {
      if (!prev) return prev;
      showSeqRef.current += 1;
      return {
        ...prev,
        pin: undefined,
        wireColor: undefined,
        peerCode: undefined,
        showSeq: showSeqRef.current,
      };
    });
  }, [wireColorFilter, selectedPinState]);

  const applyWireColorFilter = (clicked: string | null) => {
    setWireColorFilter((cur) => nextWireColorFilter(cur, clicked));
  };

  // Pinout PDF open → scheme tab on phones (SVG path uses openEwdDiagram)
  useEffect(() => {
    if (activePdf && !activeSvg && isMobileViewport()) setMobileView("scheme");
  }, [activePdf, activeSvg]);

  const rankedDiagrams = useMemo(() => {
    const ctx = schemeContext || extractSchemeContext(null, selectedCode);
    return rankDiagramsForContext(ewdDiagrams, ctx);
  }, [ewdDiagrams, schemeContext, selectedCode]);
  const bestDiagramUid =
    rankedDiagrams[0] && rankedDiagrams[0].score >= 50
      ? rankedDiagrams[0].diagram.diagramUid
      : "";

  useEffect(() => {
    if (!diagramPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const root = diagramPickerRef.current;
      if (root && !root.contains(e.target as Node)) setDiagramPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiagramPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [diagramPickerOpen]);

  useEffect(() => {
    setDiagramPickerOpen(false);
  }, [selectedCode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("volvoTheme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Cascading filters: model → years → engines → transmissions (EWD option matrix)
  useEffect(() => {
    const qs = new URLSearchParams();
    if (selectedModel) qs.set("model", selectedModel);
    if (selectedYear) qs.set("year", selectedYear);
    if (selectedEngine) qs.set("engine", selectedEngine);
    if (selectedTransmission) qs.set("transmission", selectedTransmission);
    fetch(`/api/filters?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        const nextYears: string[] = Array.isArray(data.years) ? data.years : [];
        const nextEngines: string[] = Array.isArray(data.engines) ? data.engines : [];
        const nextTrans: TransmissionOpt[] = Array.isArray(data.transmissions) ? data.transmissions : [];
        const nextModels: string[] = Array.isArray(data.models) && data.models.length ? data.models : DEFAULT_MODELS;
        setAvailable({
          models: nextModels,
          years: nextYears,
          engines: nextEngines,
          transmissions: nextTrans,
        });
        // Soft cascade: keep user picks; only clear when parent context emptied upstream
        setSelectedYear((current) => {
          if (!current) return "";
          if (!nextYears.length || nextYears.includes(current)) return current;
          return current; // keep rare year outside matrix
        });
        setSelectedEngine((current) => {
          if (!current) return "";
          if (!selectedYear) return "";
          if (!nextEngines.length || nextEngines.includes(current)) return current;
          return current;
        });
        setSelectedTransmission((current) => {
          if (!current) return ""; // «Все КПП»
          if (!selectedEngine) return "";
          return current;
        });
      })
      .catch(() => {
        /* keep previous */
      });
  }, [selectedModel, selectedYear, selectedEngine]);

  useEffect(() => {
    fetch("/api/nav/zones").then(r => r.json()).then(data => setZones(Array.isArray(data.zones) ? data.zones : [])).catch(() => setZones([]));
  }, []);

  useEffect(() => {
    const q = selectedZone && selectedZone !== "all" ? `?zone=${encodeURIComponent(selectedZone)}` : "";
    fetch(`/api/nav/components${q}`)
      .then(r => r.json())
      .then(data => setNavGroups(Array.isArray(data.groups) ? data.groups : []))
      .catch(() => setNavGroups([]));
  }, [selectedZone]);

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setIsAdmin(Boolean(d.admin)))
      .catch(() => setIsAdmin(false));
    fetch("/api/site-status")
      .then((r) => r.json())
      .then((d) => {
        setSiteOpen(d.siteOpen !== false);
        if (d.features) setFeatures((f) => ({ ...f, ...d.features }));
      })
      .catch(() => undefined);
  }, []);

  // Restore filters: URL query > localStorage (survives F5)
  useEffect(() => {
    const saved = loadPersistedFilters();
    const q = new URLSearchParams(window.location.search);
    const wireId = q.get("wireId") || "";
    if (saved.model) setSelectedModel(saved.model);
    if (saved.year) setSelectedYear(saved.year);
    if (saved.engine) setSelectedEngine(saved.engine);
    if (saved.transmission) setSelectedTransmission(saved.transmission);
    if (saved.zone) setSelectedZone(saved.zone);
    if (saved.code) setSelectedCode(saved.code);
    if (wireId) deepWireIdRef.current = wireId;
    if (saved.model && saved.year) setVehicleConfigured(true);
    filtersHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (selectedModel && selectedYear && selectedEngine) setVehicleConfigured(true);
  }, [selectedModel, selectedYear, selectedEngine]);

  useEffect(() => {
    if (!filtersHydratedRef.current) return;
    savePersistedFilters({
      model: selectedModel,
      year: selectedYear,
      engine: selectedEngine,
      transmission: selectedTransmission,
      zone: selectedZone,
      code: selectedCode,
    });
  }, [selectedModel, selectedYear, selectedEngine, selectedTransmission, selectedZone, selectedCode]);

  useEffect(() => {
    if (selectedCode && selectedModel && selectedYear) void loadWires(selectedCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync list when code/vehicle/zone change
  }, [selectedCode, selectedModel, selectedYear, selectedZone]);

  useEffect(() => {
    const wid = deepWireIdRef.current;
    if (!wid) return;
    const all = [...ownerWires, ...transitWires];
    const hit = all.find((w) => String(w.id) === wid);
    if (!hit) return;
    deepWireIdRef.current = "";
    setSelectedPinState({
      id: hit.id || wid,
      code: selectedCode,
      color: String(hit.wire_color || ""),
      pin: String(hit.pin_number || ""),
    });
  }, [ownerWires, transitWires, selectedCode]);

  // Mobile-only: collapse sticky filters after vehicle is set and user scrolls cards
  useEffect(() => {
    if (!vehicleConfigured) return;
    const mq = window.matchMedia("(max-width: 768px)");
    const el = document.querySelector<HTMLElement>("[data-mobile-scroll]");
    if (!el) return;
    const onScroll = () => {
      if (mq.matches && el.scrollTop > 16) setFiltersCollapsed(true);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [vehicleConfigured, selectedCode, mode]);

  const clear = () => {
    setMode(null);
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
    setNotice("");
    setLoading(false);
    setSelectedCode("");
    setWireColorFilter(null);
    setSchemeContext(null);
    setMobileView("cards");
    setSelectedPinState(null);
    setActivePdf(null);
    setActiveSvg(null);
  };

  /** Minimum unlock: Model + Year. Engine / KPP are optional refinements. */
  function requireVehicleMin(): boolean {
    if (!selectedModel || !selectedYear) {
      alert("Сначала выберите Модель и Год (двигатель и КПП — по желанию, или заполните по VIN).");
      return false;
    }
    return true;
  }

  async function applyVin() {
    const vin = vinInput.trim().toUpperCase();
    if (vin.length !== 17) {
      setVinNotice("VIN должен быть 17 символов.");
      return;
    }
    setVinNotice("Декодируем VIN…");
    try {
      const data = await fetch(`/api/vin/decode?vin=${encodeURIComponent(vin)}`).then((r) => r.json());
      if (!data.ok) {
        setVinNotice(data.error || "Не удалось разобрать VIN.");
        setVinLocked(false);
        return;
      }
      setSelectedModel(data.model || "");
      setSelectedYear(data.year || "");
      setSelectedEngine(data.engine || "");
      setSelectedTransmission(data.transmission || "");
      setVinLocked(true);
      const notes = Array.isArray(data.notes) && data.notes.length ? ` (${data.notes[0]})` : "";
      setVinNotice(
        `VIN → ${data.model} · ${data.year} · ${data.engine} · ${data.transmission}${notes}`,
      );
      setNotice(`Конфигурация по VIN зафиксирована. Пакет EWD: ${data.ewdPackageHint || "39363002"}`);
    } catch {
      setVinNotice("Ошибка запроса декодера VIN.");
      setVinLocked(false);
    }
  }

  function openEwdDiagram(
    searchCode: string,
    preferredUid?: string,
    wire?: WireFocus,
    card?: Result,
  ) {
    const code = normalizeCodeLabel(searchCode || selectedCode);
    if (!ewdDiagrams.length) {
      setNotice("Графическая схема EWD для этого узла не найдена.");
      return;
    }
    const ctx = card
      ? extractSchemeContext(card, code)
      : schemeContext || extractSchemeContext(null, code);
    if (card) setSchemeContext(ctx);

    // Explicit list UID = manual override; otherwise top-ranked (highest score)
    let preferred =
      (preferredUid && ewdDiagrams.find((d) => d.diagramUid === preferredUid)) || null;
    if (!preferred) {
      const picked = pickBestDiagram(ewdDiagrams, ctx);
      preferred = picked.diagram;
      // Always open a sheet when diagrams exist: fall back to rank #1 even if score is 0
      if (!preferred) {
        const ranked = rankDiagramsForContext(ewdDiagrams, ctx);
        preferred = ranked[0]?.diagram || ewdDiagrams[0] || null;
      }
    }
    if (!preferred) {
      setNotice("Графическая схема EWD для этого узла не найдена.");
      return;
    }
    setActivePdf(null);
    // Always-on marker: bump showSeq on every click so repeat clicks re-inject + recenter
    showSeqRef.current += 1;
    setActiveSvg({
      diagramUid: preferred.diagramUid,
      searchCode: code,
      objectIds: diagramScopedUids(preferred, ewdObjectIds),
      pin: wire?.pin,
      wireColor: wire?.wireColor,
      peerCode: wire?.peerCode || ctx.peerCode || undefined,
      zone: selectedZone && selectedZone !== "all" ? selectedZone : undefined,
      showSeq: showSeqRef.current,
    });
    if (isMobileViewport()) setMobileView("scheme");
  }

  async function loadWires(code: string, zone = selectedZone) {
    if (!code) return;
    if (!requireVehicleMin()) return;
    setMode("search");
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
    setWireColorFilter(null);
    setSchemeContext(null);
    setMobileView("cards");
    setActivePdf(null);
    setActiveSvg(null);
    setSelectedPinState(null);
    setLoading(true);
    setNotice(`Загружаем ${code}…`);
    try {
      const params = new URLSearchParams({ code });
      if (zone && zone !== "all") params.set("zone", zone);
      const ewdQs = new URLSearchParams({ code });
      if (zone && zone !== "all") ewdQs.set("zone", zone);
      const [data, ewdData] = await Promise.all([
        fetch(`/api/nav/wires?${params}`).then((r) => r.json()),
        fetch(`/api/ewd/diagrams?${ewdQs}`).then((r) => r.json()).catch(() => ({ diagrams: [], objectIds: [] })),
      ]);
      const ownerRaw = Array.isArray(data.owner_wires) ? data.owner_wires : [];
      const transitRaw = Array.isArray(data.transit_wires) ? data.transit_wires : [];
      const ewdDiags = Array.isArray(ewdData.diagrams) ? (ewdData.diagrams as EwdDiagram[]) : [];
      const objectIds = Array.isArray(ewdData.objectIds) ? (ewdData.objectIds as string[]) : [];
      // Weighted pick for endpoints scope (code-only context until a card is chosen).
      // Do not fall back to an arbitrary dense sheet when score is 0.
      const codeCtx = extractSchemeContext(null, code);
      const preferredDiagram = pickBestDiagram(ewdDiags, codeCtx).diagram;
      const epQs = new URLSearchParams({ code });
      if (zone && zone !== "all") epQs.set("zone", zone);
      if (preferredDiagram?.diagramUid) epQs.set("diagramUid", preferredDiagram.diagramUid);
      const epData = await fetch(`/api/ewd/endpoints?${epQs}`)
        .then((r) => r.json())
        .catch(() => ({ endpoints: [] }));
      const endpoints = Array.isArray(epData.endpoints) ? (epData.endpoints as EwdEndpoint[]) : [];
      // Empty scoped EWD → keep SQLite details (no cross-system overlay)
      setOwnerWires(mergeEwdEndpoints(ownerRaw, endpoints, code));
      setTransitWires(mergeEwdEndpoints(transitRaw, endpoints, code));
      setEwdDiagrams(ewdDiags);
      setEwdObjectIds(objectIds);
      const n = ownerRaw.length + transitRaw.length;
      setNotice(
        n || ewdDiags.length
          ? `${code}: ${ewdDiags.length} схем EWD · ${ownerRaw.length} своих контактов · ${transitRaw.length} транзитных`
          : `Для ${code} ничего не найдено`,
      );
    } catch {
      setOwnerWires([]);
      setTransitWires([]);
      setEwdDiagrams([]);
      setEwdObjectIds([]);
      setNotice("Ошибка загрузки контактов");
    } finally {
      setLoading(false);
    }
  }

  if (!siteOpen && !isAdmin) {
    return (
      <main className="min-h-screen grid place-items-center bg-[var(--bg-main)] text-[var(--text-main)] px-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold text-[var(--accent)]">Volvo EWD</h1>
          <p className="text-sm text-[var(--text-muted)]">Сайт временно закрыт администратором. Зайдите позже.</p>
          <a href="/admin" className="text-xs underline text-[var(--text-muted)]">Вход для администратора</a>
        </div>
      </main>
    );
  }

  const cardCtx = {
    zone: selectedZone,
    code: selectedCode,
    model: selectedModel,
    year: selectedYear,
    engine: selectedEngine,
  };

  return <main className="app-shell h-screen overflow-hidden flex flex-col">
    <header
      ref={headerRef}
      className={`app-panel sticky top-0 z-50 shrink-0 backdrop-blur border-b px-3 py-2 shadow-sm${filtersCollapsed ? " is-filters-collapsed" : ""}`}
    >
      <button
        type="button"
        className="mobile-filters-toggle"
        aria-expanded={!filtersCollapsed}
        aria-label={filtersCollapsed ? "Показать фильтры" : "Скрыть фильтры"}
        onClick={() => setFiltersCollapsed((v) => !v)}
      >
        <span className="mobile-filters-toggle__chevron" aria-hidden>{filtersCollapsed ? "▼" : "▲"}</span>
        <span className="mobile-filters-toggle__label">
          {filtersCollapsed
            ? [selectedModel, selectedYear, selectedEngine].filter(Boolean).join(" · ") || "Фильтры"
            : "Свернуть меню"}
        </span>
      </button>
      <div className="app-panel__filters mx-auto max-w-7xl flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-[var(--accent)] mr-1 hidden sm:inline">Volvo EWD</span>
          <div className="theme-toggle" role="group" aria-label="Тема">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`theme-${t.id}`}
                className={theme === t.id ? "theme-toggle__btn is-active" : "theme-toggle__btn"}
                onClick={() => setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[var(--muted)]">Модель
            <select
              data-testid="vehicle-model"
              className="app-input rounded px-1.5 py-1"
              value={selectedModel}
              disabled={vinLocked}
              onChange={(e) => {
                setVinLocked(false);
                setSelectedModel(e.target.value);
                setSelectedYear("");
                setSelectedEngine("");
                setSelectedTransmission("");
              }}
            >
              <option value="">—</option>
              {available.models.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[var(--muted)]">Год
            <select
              data-testid="vehicle-year"
              className="app-input rounded px-1.5 py-1"
              value={selectedYear}
              disabled={vinLocked || !selectedModel}
              onChange={(e) => {
                setVinLocked(false);
                setSelectedYear(e.target.value);
                setSelectedEngine("");
                setSelectedTransmission("");
              }}
            >
              <option value="">—</option>
              {available.years.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[var(--muted)]">Двигатель
            <select
              data-testid="vehicle-engine"
              className="app-input rounded px-1.5 py-1"
              value={selectedEngine}
              disabled={vinLocked || !selectedYear}
              onChange={(e) => {
                setVinLocked(false);
                setSelectedEngine(e.target.value);
                setSelectedTransmission("");
              }}
            >
              <option value="">—</option>
              {available.engines.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[var(--muted)]">КПП
            <select
              data-testid="vehicle-transmission"
              className="app-input rounded px-1.5 py-1"
              value={selectedTransmission}
              disabled={vinLocked || !selectedYear}
              onChange={(e) => {
                setVinLocked(false);
                setSelectedTransmission(e.target.value);
              }}
            >
              <option value="">Все КПП / Не важно</option>
              {available.transmissions.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          {features.vinSearch ? (
            <>
          <label className="flex items-center gap-1 text-[var(--muted)]">
            VIN
            <input
              data-testid="vehicle-vin"
              className="app-input rounded px-1.5 py-1 font-mono w-[11.5rem] tracking-wider"
              maxLength={17}
              placeholder="17 символов"
              value={vinInput}
              onChange={(e) => {
                setVinInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17));
                setVinNotice("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void applyVin();
              }}
            />
          </label>
          <button
            type="button"
            data-testid="vin-decode-btn"
            className="text-[11px] px-2 py-1"
            onClick={() => void applyVin()}
          >
            По VIN
          </button>
            </>
          ) : null}
          {vinLocked && (
            <button
              type="button"
              data-testid="vin-unlock-btn"
              className="text-[11px] px-2 py-1 bg-transparent text-[var(--muted)] border border-[var(--border)]"
              onClick={() => {
                setVinLocked(false);
                setVinNotice("Селекторы разблокированы.");
              }}
            >
              Изменить
            </button>
          )}
          {selectedModel && selectedYear && (
            <span className="text-[var(--accent)] text-[11px] ml-auto">
              {selectedModel} · {selectedYear}
              {selectedEngine ? ` · ${selectedEngine}` : ""}
              {selectedTransmission ? ` · ${selectedTransmission}` : " · Все КПП"}
              {vinLocked ? " · VIN" : ""}
            </span>
          )}
        </div>
        {vinNotice ? (
          <p data-testid="vin-notice" className="text-[11px] text-[var(--muted)] -mt-1">{vinNotice}</p>
        ) : null}
        {features.navBrowse ? (
        <section className="app-card rounded-lg border p-2.5 space-y-2 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Навигация по узлам</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
              Зона / жгут
              <select
                data-testid="nav-zone"
                className="bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]"
                value={selectedZone}
                onChange={(e) => {
                  setSelectedZone(e.target.value);
                  setSelectedCode("");
                  setOwnerWires([]);
                  setTransitWires([]);
                  setEwdDiagrams([]);
                  setMode(null);
                  setActivePdf(null);
                  setActiveSvg(null);
                  setSelectedPinState(null);
                }}
              >
                <option value="all">Все зоны</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.label}{z.count ? ` (${z.count})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
              Компонент / разъём
              <select
                data-testid="nav-component"
                className="bg-[var(--input-bg)] border border-[var(--border-color)] rounded px-2 py-1.5 text-xs text-[var(--text-main)]"
                value={selectedCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setSelectedCode(code);
                }}
              >
                <option value="">Выберите узел…</option>
                {navGroups.map((g) =>
                  g.items.length ? (
                    <optgroup key={g.id} label={g.label}>
                      {g.items.map((it) => (
                        <option key={it.code} value={it.code}>{it.label}</option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
              <span className="text-[10px] text-[var(--text-muted)] leading-tight">
                Пометки: [схема]=графика EWD (SVG на диске) · [табл]=таблица контактов · [PDF-схема]=диаграмма в PDF
              </span>
            </label>
          </div>
        </section>
        ) : null}
      </div>
    </header>
    <div className="flex-1 min-h-0 overflow-hidden">
    {mode ? <section data-testid="results-panel" className="h-full mx-auto max-w-7xl px-3 py-2 flex flex-col min-h-0">
      <div className="mb-1 flex justify-between shrink-0 text-xs">
        <p data-testid="results-notice" className="text-[var(--text-muted)]">{loading ? notice || "Загрузка…" : notice}</p>
        <button type="button" data-testid="clear-results" className="text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={clear}>Очистить</button>
      </div>
      <div
        data-testid="mobile-view-tabs"
        className="mobile-view-tabs"
        role="tablist"
        aria-label="Вид на телефоне"
      >
        <button
          type="button"
          role="tab"
          data-testid="mobile-tab-cards"
          aria-selected={mobileView === "cards"}
          className={`mobile-view-tabs__btn${mobileView === "cards" ? " is-active" : ""}`}
          onClick={() => setMobileView("cards")}
        >
          Карточки
        </button>
        <button
          type="button"
          role="tab"
          data-testid="mobile-tab-scheme"
          aria-selected={mobileView === "scheme"}
          className={`mobile-view-tabs__btn${mobileView === "scheme" ? " is-active" : ""}`}
          disabled={!rightOpen}
          onClick={() => {
            if (!rightOpen) {
              setNotice("Сначала откройте схему кнопкой «Показать на схеме».");
              return;
            }
            setMobileView("scheme");
          }}
        >
          Схема EWD
        </button>
      </div>
      <div className={`flex-1 min-h-0 grid gap-3 ${rightOpen ? "grid-cols-1 lg:grid-cols-12" : ""}`}>
      <div
        data-testid="cards-column"
        data-mobile-scroll
        className={`mobile-pane mobile-pane--cards ${rightOpen ? "lg:col-span-5" : "max-w-3xl mx-auto w-full"} space-y-3 overflow-y-auto min-h-0 pr-1${
          mobileView === "scheme" && rightOpen ? " is-mobile-hidden" : ""
        }`}
      >
      <div data-testid="wires-block" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Спецификация контактов и цепей
          </h2>
          {ewdDiagrams.length > 0 ? (
            <div ref={diagramPickerRef} className="diagram-picker relative">
              <button
                type="button"
                data-testid="diagram-picker-btn"
                className="diagram-picker__btn"
                aria-haspopup="listbox"
                aria-expanded={diagramPickerOpen}
                onClick={() => setDiagramPickerOpen((v) => !v)}
              >
                🗺️ Выбрать схему ({ewdDiagrams.length})
              </button>
              {diagramPickerOpen ? (
                <div
                  data-testid="diagram-picker-menu"
                  className="diagram-picker__menu"
                  role="listbox"
                  aria-label="Доступные схемы EWD"
                >
                  {rankedDiagrams.map(({ diagram: d, score }) => {
                    const label = String(d.title || d.systemName || d.designFolder || "").trim();
                    const isOpen = activeSvg?.diagramUid === d.diagramUid;
                    const isBest = !!bestDiagramUid && d.diagramUid === bestDiagramUid && score >= 50;
                    return (
                      <button
                        key={d.diagramUid}
                        type="button"
                        role="option"
                        aria-selected={isOpen}
                        data-testid="diagram-picker-item"
                        className={`diagram-picker__item${isOpen ? " is-active" : ""}`}
                        onClick={() => {
                          setDiagramPickerOpen(false);
                          openEwdDiagram(selectedCode, d.diagramUid);
                        }}
                      >
                        <span className="diagram-picker__title">{label || d.diagramUid}</span>
                        {isBest ? (
                          <span className="diagram-picker__badge">лучшая</span>
                        ) : isOpen ? (
                          <span className="diagram-picker__badge">открыта</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {availableWireColors.length > 0 ? (
          <div
            data-testid="wire-color-filter"
            className="wire-color-filter"
            role="toolbar"
            aria-label="Фильтр по цвету провода"
          >
            <button
              type="button"
              data-testid="wire-color-filter-all"
              className={`wire-color-chip wire-color-chip--all${!wireColorFilter ? " is-active" : ""}`}
              aria-pressed={!wireColorFilter}
              onClick={() => applyWireColorFilter(null)}
            >
              Все цвета
            </button>
            {availableWireColors.map((code) => {
              const active = normalizeWireColorKey(wireColorFilter || "") === code;
              return (
                <button
                  key={code}
                  type="button"
                  data-testid="wire-color-chip"
                  data-wire-color={code}
                  className={`wire-color-chip ewd-wire-badge${active ? " is-active" : ""}`}
                  style={wireColorChipStyle(code)}
                  aria-pressed={active}
                  title={code}
                  onClick={() => applyWireColorFilter(code)}
                >
                  <span className="wire-color-chip__label">{code}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {filteredOwnerWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Свои контакты разъёма</p>
        ) : null}
        {filteredOwnerWires.map((item, index) => renderWireCard(item, index, hasEwdDiagram && features.ewdDiagrams, selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setActivePdf, setActiveSvg, setNotice, setEditingItem, features.suggestions, features.pdfTables, cardCtx))}
        {filteredTransitWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-2">Транзитные связи</p>
        ) : null}
        {filteredTransitWires.map((item, index) => renderWireCard(item, index + 10000, hasEwdDiagram && features.ewdDiagrams, selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setActivePdf, setActiveSvg, setNotice, setEditingItem, features.suggestions, features.pdfTables, cardCtx))}
        {!ownerWires.length && !transitWires.length ? (
          <p className="text-xs text-[var(--text-muted)]">Контактных строк для этого узла нет.</p>
        ) : null}
        {(ownerWires.length > 0 || transitWires.length > 0) &&
        !filteredOwnerWires.length &&
        !filteredTransitWires.length ? (
          <p className="text-xs text-[var(--text-muted)]">Нет цепей цвета {wireColorFilter}.</p>
        ) : null}
      </div>
      </div>
      {activeSvg && (
        <div
          data-testid="svg-panel"
          className={`mobile-pane mobile-pane--scheme lg:col-span-7 min-h-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm flex flex-col${
            mobileView === "cards" ? " is-mobile-hidden" : ""
          }`}
        >
          <div className="ewd-scheme-header bg-[var(--input-bg)] px-3 py-1.5 border-b border-[var(--border-color)] flex justify-between items-center text-xs shrink-0">
            <div className="flex items-center gap-3">
              <span data-testid="svg-diagram-label" className="ewd-data font-semibold font-mono truncate max-w-[280px]">{activeSvg.searchCode}</span>
              <span className="ewd-data font-mono truncate max-w-[200px]">{activeSvg.diagramUid.slice(0, 18)}…</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveSvg(null);
                setSelectedPinState(null);
                setMobileView("cards");
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] font-bold px-2"
            >
              ✕
            </button>
          </div>
          {selectedPinState && (
            <div className="ewd-scheme-status shrink-0 bg-[var(--input-bg)] border-b border-[var(--border-color)] px-3 py-1 text-xs text-center text-[var(--text-main)]">
              Контакт <strong className="ewd-data font-mono">{selectedPinState.pin || "—"}</strong>
              {" · "}
              <strong className="ewd-data font-mono">{selectedPinState.code}</strong>
              {selectedPinState.color ? (
                <>
                  {" · "}
                  <span className="ewd-data font-mono">{selectedPinState.color}</span>
                </>
              ) : null}
            </div>
          )}
          <div className="flex-1 min-h-0 relative">
            <SvgDiagramViewer
              key={activeSvg.diagramUid}
              diagramUid={activeSvg.diagramUid}
              searchCode={activeSvg.searchCode}
              objectIds={activeSvg.objectIds}
              pin={activeSvg.pin}
              wireColor={activeSvg.wireColor}
              peerCode={activeSvg.peerCode}
              zone={activeSvg.zone}
              showSeq={activeSvg.showSeq}
              onPinMiss={(reason) => {
                setNotice(
                  `Контакт не найден на этой схеме (${reason}). Выберите релевантную схему с меткой «лучшая».`,
                );
                if (bestDiagramUid && bestDiagramUid !== activeSvg.diagramUid) {
                  openEwdDiagram(activeSvg.searchCode, bestDiagramUid, {
                    pin: activeSvg.pin,
                    wireColor: activeSvg.wireColor,
                    peerCode: activeSvg.peerCode,
                  });
                }
              }}
            />
          </div>
        </div>
      )}
      {activePdf && !activeSvg && (
        <div
          data-testid="pdf-panel"
          className={`mobile-pane mobile-pane--scheme lg:col-span-7 min-h-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm flex flex-col${
            mobileView === "cards" ? " is-mobile-hidden" : ""
          }`}
        >
          <div className="bg-[var(--input-bg)] px-3 py-1.5 border-b border-[var(--border-color)] flex justify-between items-center text-xs shrink-0">
            <div className="flex items-center gap-3 text-[var(--text-muted)]">
              <span data-testid="pdf-page-label" className="font-semibold text-emerald-700 font-mono">табл. стр. {activePdf.page}</span>
              <div className="flex items-center gap-1 bg-[var(--bg-card)] rounded border border-[var(--border-color)] px-1 font-mono">
                <button type="button" onClick={() => setZoom((value) => Math.max(50, value - 10))} className="px-1.5 py-0.5 hover:text-[var(--text-main)]">−</button>
                <span className="min-w-[35px] text-center">{zoom}%</span>
                <button type="button" onClick={() => setZoom((value) => Math.min(300, value + 10))} className="px-1.5 py-0.5 hover:text-[var(--text-main)]">+</button>
                <button type="button" onClick={() => setZoom(80)} className="px-1.5 py-0.5 hover:text-[var(--text-main)]">80%</button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActivePdf(null);
                setMobileView("cards");
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] font-bold px-2"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-main)] relative">
            <PDFCanvasViewer key={`pdf-lock-${activePdf.bookId}-p${activePdf.page}`} bookId={activePdf.bookId} pageNumber={Number(activePdf.page)} searchTarget={activePdf.search || null} zoom={zoom} />
          </div>
        </div>
      )}
      </div></section> : (
      <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm px-4 text-center">Выберите авто, зону и узел в выпадающем списке — контакты появятся здесь.</div>
    )}
    </div>
    {editingItem && (
      <SuggestEditModal
        item={editingItem}
        vehicle={vehicle}
        zone={selectedZone}
        code={selectedCode}
        onClose={() => setEditingItem(null)}
      />
    )}
  </main>;
}

function SuggestEditModal({
  item,
  vehicle,
  zone,
  code,
  onClose,
}: {
  item: any;
  vehicle: { model: string; year: string; engine: string; transmission: string };
  zone: string;
  code: string;
  onClose: () => void;
}) {
  const wireId = item.id != null ? String(item.id) : "";
  const subject = String(item.subject_code || code || "").trim();
  const cardUrl =
    item._card_url ||
    buildCardDeepLink({
      zone,
      code: subject || code,
      wireId,
      model: vehicle.model,
      year: vehicle.year,
      engine: vehicle.engine,
    });
  const fromLabel = String(item.from_detail || item.from_node || "").trim();
  const toLabel = String(item.to_detail || item.to_node || "").trim();
  const [pin, setPin] = useState(String(item.pin_number || ""));
  const [color, setColor] = useState(String(item.wire_color || ""));
  const [src, setSrc] = useState(fromLabel);
  const [dst, setDst] = useState(toLabel);
  const [description, setDescription] = useState(String(item.function_text || item.card_title || ""));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [done, setDone] = useState<{ ticketId: number; warning?: string } | null>(null);
  const [challenge, setChallenge] = useState<{ a: number; b: number; challenge: string } | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/tickets/challenge");
        const data = await r.json();
        if (!cancelled && data?.challenge) setChallenge({ a: data.a, b: data.b, challenge: data.challenge });
      } catch {
        /* ignore — submit will ask to refresh */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (done) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 max-w-md w-full shadow-xl space-y-3 text-left">
          <h3 className="text-base font-semibold text-emerald-700">Заявка принята</h3>
          <p className="text-sm text-[var(--text-main)]">Номер тикета: <strong>#{done.ticketId}</strong></p>
          {done.warning ? (
            <p className="text-xs text-amber-700">{done.warning}</p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">Уведомление отправлено на elzidevelo@gmail.com.</p>
          )}
          <button type="button" className="w-full bg-emerald-600 text-white rounded-xl py-2 text-sm font-medium" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl p-5 max-w-md w-full shadow-xl space-y-3 text-left max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-amber-700">Предложить исправление</h3>
        <div className="text-[11px] font-mono bg-[var(--input-bg)] border border-[var(--border-color)] rounded p-2 space-y-1 text-[var(--text-muted)] break-all">
          <div>Карточка ID: <strong className="text-[var(--text-main)]">{wireId || "—"}</strong></div>
          <div>Узел: <strong className="text-[var(--text-main)]">{subject || "—"}</strong> · зона: {zone || "all"}</div>
          <div>Ссылка: <a className="text-emerald-700 underline" href={cardUrl} target="_blank" rel="noreferrer">{cardUrl}</a></div>
        </div>
        <form
          className="space-y-2 text-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setFormError("");
            try {
              const response = await fetch("/api/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...vehicle,
                  location_name: subject || code || "unknown",
                  pin_number: pin,
                  wire_color: color || "—",
                  source_block: src || "—",
                  destination_block: dst || "—",
                  description: description || "Предложение правки",
                  comment,
                  wire_id: wireId,
                  subject_code: subject,
                  zone,
                  card_url: cardUrl,
                  website: honeypot,
                  challenge: challenge?.challenge || "",
                  challenge_answer: challengeAnswer,
                }),
              });
              const data = await response.json();
              if (response.status === 429) {
                setFormError(data.error || "Слишком часто. Подождите.");
                return;
              }
              if (!response.ok && !data.ticketId) {
                setFormError(data.error || "Ошибка отправки");
                // refresh challenge after failed check
                try {
                  const r = await fetch("/api/tickets/challenge");
                  const c = await r.json();
                  if (c?.challenge) {
                    setChallenge({ a: c.a, b: c.b, challenge: c.challenge });
                    setChallengeAnswer("");
                  }
                } catch {
                  /* ignore */
                }
                return;
              }
              // Ticket stored (even if SMTP missing) — stop retries / spam
              setDone({
                ticketId: Number(data.ticketId) || 0,
                warning: data.warning || (!data.emailSent ? "Письмо может быть не отправлено (SMTP)." : undefined),
              });
            } catch {
              setFormError("Сеть недоступна. Попробуйте позже.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {/* honeypot — hidden from users */}
          <label className="absolute -left-[9999px] opacity-0 h-0 w-0 overflow-hidden" aria-hidden>
            Компания
            <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Пин
            <input className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 font-mono" value={pin} onChange={(e) => setPin(e.target.value)} required />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Цвет
            <input className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 font-mono" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Откуда
            <input className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 font-mono" value={src} onChange={(e) => setSrc(e.target.value)} required />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Куда
            <input className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 font-mono" value={dst} onChange={(e) => setDst(e.target.value)} required />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Что не так / как должно быть
            <textarea className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 h-20" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">Комментарий
            <textarea className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <label className="block text-xs text-[var(--text-muted)]">
            Проверка: сколько будет {challenge ? `${challenge.a} + ${challenge.b}` : "…"}?
            <input
              className="mt-0.5 w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded px-3 py-1.5 font-mono"
              inputMode="numeric"
              value={challengeAnswer}
              onChange={(e) => setChallengeAnswer(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <p className="text-[11px] text-[var(--text-muted)]">Уйдёт модератору elzidevelo@gmail.com вместе со ссылкой на эту карточку. Повтор по той же карточке — не чаще чем раз в 2 минуты.</p>
          {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs border border-[var(--border-color)]">Отмена</button>
            <button type="submit" disabled={busy} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-[#1c1917] rounded-xl text-xs font-semibold disabled:opacity-50">{busy ? "Отправка…" : "Отправить"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Root() {
  const path = typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") || "/" : "/";
  if (path === "/admin") return <AdminPage />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
