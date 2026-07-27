import { startTransition, useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { InstallAppBanner } from "./InstallAppBanner.js";
import { SvgDiagramViewer } from "./SvgDiagramViewer.js";
import { SvgPanZoomHost } from "./SvgPanZoomHost.js";
import { WIRE_COLOR_HEX, WIRE_COLOR_RU, normalizeWireColorKey } from "./wireColors.js";
import {
  cardMatchesWireColorFilter,
  collectUniqueWireColors,
  filterCardsByWireColor,
  nextWireColorFilter,
  wireColorChipStyle,
} from "./wireColorFilter.js";
import {
  cardFocusContact,
  collectCodes,
  diagramContainsWireUid,
  diagramHasCode,
  diagramsForPinProbe,
  extractSchemeContext,
  peerCodeFromSchemeCard,
  pickBestDiagram,
  rankDiagramsForContext,
  resolveHighlightPin,
  sheetSideHighlightPin,
  type SchemeContext,
} from "./ewdSchemeResolver.js";
import "./styles.css";
import { AdminPage } from "./AdminPage.js";
import { MaintenancePage } from "./MaintenancePage.js";
import { loadPersistedFilters, savePersistedFilters, type PersistedFilters } from "./filterPersist.js";
import { trackVisitOnce } from "./visitBeacon.js";
import { applySiteAppearance, siteDefaultTheme } from "./appearance.js";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushUiState,
  type PushUiState,
} from "./pushSubscribe.js";
import {
  humanizeOptionExpression,
  optionApplicabilityLabel,
  optionApplicabilityStatus,
} from "./optionExpressionHumanize.js";


type RepairConfidence = "exact" | "compatible" | "unknown" | "reference";

type RepairPart = {
  part_number: string;
  role: string;
  name_en?: string;
  name_ru?: string;
  confidence: RepairConfidence;
  reason: string;
  cavity?: string;
  gauge_mm2?: string;
  note_ru?: string;
  image_url?: string | null;
};

type RepairCatalogResult = {
  code: string;
  pin?: string;
  gauge?: string;
  status: "exact" | "compatible" | "unknown";
  summary_ru: string;
  housing?: RepairPart;
  mate?: RepairPart;
  device?: RepairPart;
  terminals: RepairPart[];
  seals: RepairPart[];
  pigtails: RepairPart[];
  tools: RepairPart[];
};

type CardParts = {
  code?: string;
  device?: string;
  housing?: string;
  mate?: string;
  terminals?: Array<{ part_number: string; name_en?: string; name_ru?: string }>;
  repair?: RepairCatalogResult;
};

type Result = {
  id?: number; bookId?: number; book_id?: number; manualId?: number;
  page_number?: number; pinout_page_number?: number; diagram_page_number?: number;
  sourcePage?: number; page?: number; pin_number?: string;
  pin_uid?: string; wire_uid?: string; system_uid?: string; option_expression?: string;
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
  wire_gauge?: string;
  parts?: CardParts;
};

type CapitalPanel =
  | { kind: "faceview"; code: string; pin?: string }
  | { kind: "location"; code: string }
  | { kind: "report"; report: "fuse" | "inline" | "splice" | "grounds" }
  | { kind: "intro"; slug: string };
type SchemeConfidence = "wire-owned" | "pin-only" | "text-only" | "none";
type EwdDiagram = {
  diagramUid: string;
  title: string;
  textCodes: string[];
  designFolder: string;
  systemName?: string;
  pathCount?: number;
  groups?: Array<{ schemClass: string; uids: string[]; pathCount: number }>;
  /** All UIDs on this SVG (when provided by /api/ewd/diagrams). */
  onSheetUids?: string[];
  wireHits?: number;
  pinHits?: number;
  onSheetUidCount?: number;
  confidence?: SchemeConfidence;
};
type EwdEndpoint = { from: string; to: string; color: string; wireName: string; pinFrom?: string; pinTo?: string };
type WireEndFocus = {
  code: string;
  pin?: string;
  pinCandidates?: string[];
  uid?: string;
  role?: "from" | "to" | "selected" | "peer" | "primary";
};
type WireFocus = {
  pin?: string;
  pinCandidates?: string[];
  wireColor?: string;
  peerCode?: string;
  peerPin?: string;
  pinFrom?: string;
  pinTo?: string;
  fromCode?: string;
  toCode?: string;
  ends?: WireEndFocus[];
  /** FaceView / SQLite UIDs from the clicked card — bind paint to this net. */
  wireUid?: string;
  pinUid?: string;
  /** Токены комплектации авто (VIN/фильтры), не split option_expression карточки. */
  optionTokens?: string[];
};
type ActiveSvg = {
  diagramUid: string;
  searchCode: string;
  /** Human-readable diagram/system title from /diagrams catalog. */
  title?: string;
  systemName?: string;
  /** How strongly this sheet owns the focused wire (from pick-diagram). */
  confidence?: SchemeConfidence;
  objectIds?: string[];
  pin?: string;
  pinCandidates?: string[];
  wireColor?: string;
  peerCode?: string;
  peerPin?: string;
  zone?: string;
  /** Netlist pins from highlight match (optional, improves opposite-end scoring) */
  pinFrom?: string;
  pinTo?: string;
  fromCode?: string;
  toCode?: string;
  ends?: WireEndFocus[];
  wireUid?: string;
  pinUid?: string;
  /** Vehicle option tokens for Capital optionExpression filter */
  optionTokens?: string[];
  /** Increments on every «Показать на схеме» — forces marker re-inject + recenter (never toggle-off). */
  showSeq?: number;
};
type CardSchemeInfo = {
  status: "exact-one" | "exact-many" | "no-sheet" | "missing-identity";
  exactSheets: EwdDiagram[];
  nearestPeer?: { code: string; pin?: string };
};

function schemeConfidenceForDiagram(d: {
  wireHits?: number;
  pinHits?: number;
} | null | undefined): SchemeConfidence {
  if ((Number(d?.wireHits) || 0) > 0) return "wire-owned";
  if ((Number(d?.pinHits) || 0) > 0) return "pin-only";
  if (d) return "text-only";
  return "none";
}

function schemeConfidenceLabel(c: SchemeConfidence | undefined, wireFocus = false): string {
  if (c === "wire-owned") return wireFocus ? "провод" : "узел";
  if (c === "pin-only") return "только контакт";
  if (c === "text-only") return "текст";
  return "";
}

function schemeConfidenceForFocusedWire(
  d: EwdDiagram | null | undefined,
  focusedWireUid?: string,
): SchemeConfidence {
  if (focusedWireUid) {
    if (diagramContainsWireUid(d, focusedWireUid)) return "wire-owned";
    if ((Number(d?.pinHits) || 0) > 0) return "pin-only";
    if (d) return "text-only";
    return "none";
  }
  return schemeConfidenceForDiagram(d);
}
function CapitalPanelViewer({
  panel,
  onClose,
  fullscreen = false,
  onEnterFullscreen,
}: {
  panel: CapitalPanel;
  onClose: () => void;
  fullscreen?: boolean;
  onEnterFullscreen?: () => void;
}) {
  const [html, setHtml] = useState("");
  const [svg, setSvg] = useState("");
  const [pins, setPins] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layoutFitToken, setLayoutFitToken] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setHtml("");
    setSvg("");
    setPins([]);
    const run = async () => {
      try {
        if (panel.kind === "faceview") {
          const qs = new URLSearchParams({ code: panel.code });
          if (panel.pin) qs.set("pin", panel.pin);
          const data = await fetch(`/api/ewd/faceview?${qs}`).then((r) => r.json());
          if (!alive) return;
          setHtml(String(data.html || ""));
          setPins(Array.isArray(data.pins) ? data.pins : []);
        } else if (panel.kind === "location") {
          const data = await fetch(`/api/ewd/location?code=${encodeURIComponent(panel.code)}`).then((r) =>
            r.json(),
          );
          if (!alive) return;
          setSvg(String(data.svg || ""));
          if (!data.svg) setErr("Нет Location View для этого кода");
        } else if (panel.kind === "report") {
          const text = await fetch(`/api/ewd/report/${panel.report}`).then((r) => r.text());
          if (!alive) return;
          setHtml(text);
        } else if (panel.kind === "intro") {
          const text = await fetch(`/api/ewd/intro/${panel.slug}`).then((r) => r.text());
          if (!alive) return;
          setHtml(text);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [panel]);
  useEffect(() => {
    setLayoutFitToken((n) => n + 1);
  }, [fullscreen]);

  const title =
    panel.kind === "faceview"
      ? `Разъём ${panel.code}`
      : panel.kind === "location"
        ? `Расположение ${panel.code}`
        : panel.kind === "report"
          ? `Отчёт: ${panel.report}`
          : "Справка";
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="capital-panel">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--input-bg)] text-xs shrink-0">
        <span className="font-semibold truncate">{title}</span>
        <div className="scheme-panel__header-actions">
          {!fullscreen && onEnterFullscreen ? (
            <button
              type="button"
              data-testid="scheme-fullscreen"
              className="scheme-panel__fs-btn"
              title="На весь экран"
              aria-label="На весь экран"
              onClick={onEnterFullscreen}
            >
              ⛶
            </button>
          ) : null}
          <button
            type="button"
            data-testid="scheme-close"
            className="scheme-panel__fs-btn"
            title={fullscreen ? "Выйти из полноэкранного режима" : "Закрыть"}
            aria-label={fullscreen ? "Выйти из полноэкранного режима" : "Закрыть"}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div
        className={`flex-1 min-h-0 bg-[var(--bg-card)] ${
          panel.kind === "location" ? "overflow-hidden p-0" : "overflow-auto p-2"
        }`}
      >
        {panel.kind !== "location" && loading ? (
          <p className="text-xs text-[var(--text-muted)] p-2">Загрузка…</p>
        ) : null}
        {panel.kind !== "location" && err ? <p className="text-xs text-red-600 p-2">{err}</p> : null}
        {pins.length > 0 ? (
          <div className="mb-3 overflow-auto p-2">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="text-left text-[var(--text-muted)]">
                  <th className="p-1 border-b">Pin</th>
                  <th className="p-1 border-b">Color</th>
                  <th className="p-1 border-b">Wire</th>
                  <th className="p-1 border-b">Peer</th>
                </tr>
              </thead>
              <tbody>
                {pins.slice(0, 80).map((row, i) => (
                  <tr key={i} className="border-b border-[var(--border-color)]/40">
                    <td className="p-1">{String(row.cavity || "")}</td>
                    <td className="p-1">{String(row.color || "")}</td>
                    <td className="p-1 truncate max-w-[120px]">{String(row.wireName || "")}</td>
                    <td className="p-1">
                      {String(row.peerCode || "")}
                      {row.peerPin ? `:${String(row.peerPin)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {panel.kind === "location" ? (
          <div className="flex h-full min-h-0 flex-col">
            <p
              className="shrink-0 border-b border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-1.5 text-[11px] leading-snug text-[var(--text-muted)]"
              data-testid="location-provenance-note"
            >
              Карта показывает только место разъёма на кузове. Цвета проводов относятся к списку
              контактов слева и не рисуются на этой карте.
            </p>
            <div className="min-h-0 flex-1">
              <SvgPanZoomHost
                testId="location-svg-viewer"
                markup={svg}
                loading={loading}
                error={err}
                className="ewd-location-svg"
                fitMode="contain"
                fitToken={layoutFitToken || 1}
              />
            </div>
          </div>
        ) : null}
        {html && !pins.length ? (
          <iframe title={title} className="w-full min-h-[70vh] border-0 bg-white" srcDoc={html} />
        ) : null}
        {html && pins.length ? (
          <details className="mt-2 px-2">
            <summary className="text-[11px] cursor-pointer text-[var(--text-muted)]">Исходный FaceView HTML</summary>
            <iframe title={title} className="w-full min-h-[40vh] border-0 bg-white mt-1" srcDoc={html} />
          </details>
        ) : null}
      </div>
    </div>
  );
}

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
type EngineOpt = { id: string; label: string; market?: string };
type FilterAvailable = {
  models: string[];
  years: string[];
  engines: string[];
  engineOptions: EngineOpt[];
  transmissions: TransmissionOpt[];
};
const colors = WIRE_COLOR_HEX;
/** RD-GY ??? ????????????????-?????????? (RD-GY)?? */
function decodeWireColor(colorCode: string | undefined | null): string {
  const raw = normalizeWireColorKey(colorCode);
  if (!raw || raw === "???") return "???";
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
/** Card / chip wire badge — same contrast rules as filter chips (dual WH readable). */
const getColorStyle = (colorCode: string) => wireColorChipStyle(colorCode);


function normalizeCodeLabel(s: string): string {
  const m = String(s || "").trim().match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(s || "").trim();
}

function detailLooksRich(s: string): boolean {
  const t = String(s || "").trim();
  if (!t || t === "—") return false;
  // "8/6:1 — Injection…" or long descriptive text — keep over cavity tautology
  return t.includes("—") || t.includes(" - ") || t.length > 18;
}

function endpointIsTautology(ep: EwdEndpoint, codeN: string): boolean {
  const a = normalizeCodeLabel(ep.from);
  const b = normalizeCodeLabel(ep.to);
  if (!a || !b) return false;
  const pf = String(ep.pinFrom || "").trim();
  const pt = String(ep.pinTo || "").trim();
  const samePin = Boolean(pf && pt && pf === pt);
  if (a === b) return !pf && !pt ? true : samePin;
  // Same selected connector both ends only when cavity digits match
  if (codeN && a.startsWith(codeN) && b.startsWith(codeN)) return samePin;
  return false;
}

function pinLabelMatches(label: string | undefined, want: string): boolean {
  if (!label || !want) return false;
  const w = String(want).trim();
  const p = String(label).trim();
  if (p === w) return true;
  if (p.endsWith(`:${w}`) || p.endsWith(`-${w}`) || p.endsWith(`/${w}`)) return true;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\D)${esc}(?:\\D|$)`).test(p);
}

function mergeEwdEndpoints(wires: Result[], endpoints: EwdEndpoint[], code: string): Result[] {
  if (!endpoints.length) return wires;
  const codeN = normalizeCodeLabel(code);
  const usable = endpoints.filter((ep) => !endpointIsTautology(ep, codeN));
  if (!usable.length) return wires;
  return wires.map((w) => {
    const pin = String(w.pin_number || "").trim();
    const color = String(w.wire_color || "").toUpperCase().replace(/\//g, "-").trim();
    const fromDetail = String(w.from_detail || "");
    const toDetail = String(w.to_detail || "");
    const sqliteRich = detailLooksRich(fromDetail) && detailLooksRich(toDetail);
    // Keep SQLite pinout when it already anchors the selected module to a numeric peer (e.g. 7/90 → 73/4049).
    const sqlitePeerCodes = collectCodes(fromDetail, toDetail).filter((c) => c !== codeN);
    const sqliteAnchored =
      fromDetail.includes(codeN) && sqlitePeerCodes.some((c) => /^\d+\/\d+/.test(c));
    if (sqliteRich || sqliteAnchored) return w;
    const candidates = usable.filter((ep) => {
      const epColor = String(ep.color || "").toUpperCase().replace(/\//g, "-");
      const colorOk = !color || color === "—" || !epColor || epColor === color;
      const involves =
        ep.from.includes(codeN) ||
        ep.to.includes(codeN) ||
        normalizeCodeLabel(ep.from).startsWith(codeN) ||
        normalizeCodeLabel(ep.to).startsWith(codeN);
      const pinOk =
        !pin ||
        pinLabelMatches(ep.pinFrom, pin) ||
        pinLabelMatches(ep.pinTo, pin) ||
        ep.from.includes(`:${pin}`) ||
        ep.to.includes(`:${pin}`);
      const pinOnSelected =
        !pin ||
        (normalizeCodeLabel(ep.from).startsWith(codeN) && pinLabelMatches(ep.pinFrom, pin)) ||
        (normalizeCodeLabel(ep.to).startsWith(codeN) && pinLabelMatches(ep.pinTo, pin)) ||
        pinOk;
      return colorOk && pinOnSelected && (involves || !codeN);
    });
    const scoreEndpoint = (ep: EwdEndpoint): number => {
      let s = 0;
      if (normalizeCodeLabel(ep.from).startsWith(codeN) && pinLabelMatches(ep.pinFrom, pin)) s += 100;
      if (normalizeCodeLabel(ep.to).startsWith(codeN) && pinLabelMatches(ep.pinTo, pin)) s += 40;
      const peerCodes = collectCodes(ep.from, ep.to).filter((c) => c !== codeN);
      if (peerCodes.some((c) => /^\d+\/\d+/.test(c))) s += 30;
      if (/^GROUND/i.test(ep.from) || /^GROUND/i.test(ep.to)) s -= 50;
      return s;
    };
    const match = candidates.sort((a, b) => scoreEndpoint(b) - scoreEndpoint(a))[0];
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

function cardSchemeInfo(item: Result, selectedCode: string, diagrams: EwdDiagram[]): CardSchemeInfo {
  const wireUid = String(item.wire_uid || "").trim();
  // Точные листы = те, где wireUid реально есть в разметке (не «все схемы зоны»).
  const exactSheets = wireUid
    ? diagrams.filter((diagram) => diagramContainsWireUid(diagram, wireUid))
    : [];
  const resolved = resolveHighlightPin(item, selectedCode, String(item.pin_number || ""));
  const peerCode = peerCodeFromCard(item, selectedCode) || resolved.peerCode || "";
  const peerPin = String(resolved.peerPin || resolved.pinTo || "").trim();
  return {
    status: !wireUid
      ? "missing-identity"
      : exactSheets.length === 1
        ? "exact-one"
        : exactSheets.length > 1
          ? "exact-many"
          : "no-sheet",
    exactSheets,
    nearestPeer: peerCode ? { code: peerCode, pin: peerPin || undefined } : undefined,
  };
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
}

async function probeHighlightMatch(args: {
  code: string;
  diagramUid: string;
  pin?: string;
  wireColor?: string;
  wireUid?: string;
  pinUid?: string;
  peer?: string;
  zone?: string;
  optionTokens?: string[];
}): Promise<number> {
  // Лёгкий preflight перед открытием: есть ли провод/пин на кандидате листа.
  const qs = new URLSearchParams({ code: args.code, diagramUid: args.diagramUid });
  if (args.pin) qs.set("pin", args.pin);
  if (args.wireColor) qs.set("color", args.wireColor);
  if (args.wireUid) qs.set("wireUid", args.wireUid);
  if (args.pinUid) qs.set("pinUid", args.pinUid);
  if (args.peer) qs.set("peer", args.peer);
  if (args.zone && args.zone !== "all") qs.set("zone", args.zone);
  if (args.optionTokens?.length) qs.set("optionTokens", args.optionTokens.join(","));
  try {
    const data = await fetch(`/api/ewd/highlight?${qs}`).then((r) => r.json());
    const matched = Number(data.matchedCount) || 0;
    if (matched > 0) return matched;
    // Провод уже на листе (wireUid в ответе) — считаем успехом, даже если цифра
    // кавити не совпала (типично транзит: pin «Откуда» чужой, а линия своя).
    const wu = String(args.wireUid || "").trim();
    if (wu && Array.isArray(data.wireUids) && data.wireUids.includes(wu)) return 1;
    return 0;
  } catch {
    return 0;
  }
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

async function copyPartNumber(pn: string, setNotice: (v: string) => void) {
  const text = String(pn || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setNotice(`Скопировано: ${text}`);
  } catch {
    setNotice("Не удалось скопировать партномер");
  }
}

function hasLegacyCardParts(parts?: CardParts | null): boolean {
  return Boolean(parts && (parts.device || parts.housing || parts.mate || parts.terminals?.length));
}

function hasRepairCatalog(repair?: RepairCatalogResult | null): boolean {
  if (!repair) return false;
  return Boolean(
    repair.housing ||
      repair.mate ||
      repair.device ||
      repair.terminals?.length ||
      repair.seals?.length ||
      repair.pigtails?.length ||
      repair.tools?.length,
  );
}

function hasCardParts(parts?: CardParts | null): boolean {
  return hasLegacyCardParts(parts) || hasRepairCatalog(parts?.repair);
}

function confidenceBadge(c: RepairConfidence): { label: string; className: string } {
  if (c === "exact") return { label: "точно", className: "repair-badge repair-badge--exact" };
  if (c === "compatible")
    return { label: "кандидат — сверить", className: "repair-badge repair-badge--compatible" };
  if (c === "reference")
    return { label: "справочно", className: "repair-badge repair-badge--reference" };
  return { label: "данных нет", className: "repair-badge repair-badge--unknown" };
}

function RepairPartRow({
  part,
  roleLabel,
  setNotice,
  onOpenPart,
}: {
  part: RepairPart;
  roleLabel: string;
  setNotice: (v: string) => void;
  onOpenPart: (part: RepairPart, roleLabel: string) => void;
}) {
  const badge = confidenceBadge(part.confidence);
  return (
    <li className="repair-part-row">
      <div className="repair-part-row__top">
        <span className="repair-part-row__role">{roleLabel}</span>
        <span className={badge.className}>{badge.label}</span>
        <button
          type="button"
          className="repair-part-row__pn font-mono"
          title="Показать иллюстрацию EPC"
          onClick={() => onOpenPart(part, roleLabel)}
        >
          {part.part_number}
          {part.image_url ? <span className="repair-part-row__has-img" title="Есть иллюстрация" /> : null}
        </button>
        <button
          type="button"
          className="parts-catalog__copy"
          title="Скопировать"
          aria-label={`Скопировать ${part.part_number}`}
          onClick={() => void copyPartNumber(part.part_number, setNotice)}
        >
          <CopyIcon />
        </button>
      </div>
      {part.reason ? <p className="repair-part-row__reason">{part.reason}</p> : null}
    </li>
  );
}

function PartNumberPopover({
  part,
  roleLabel,
  related,
  wiringCode,
  onClose,
  setNotice,
}: {
  part: RepairPart;
  roleLabel: string;
  related: { housing?: RepairPart; mate?: RepairPart; terminals: RepairPart[] };
  wiringCode?: string;
  onClose: () => void;
  setNotice: (v: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(0.5, z - 0.25));
      if (e.key === "0") {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const badge = confidenceBadge(part.confidence);
  const img =
    part.image_url ||
    (wiringCode
      ? `/api/parts/image/${encodeURIComponent(part.part_number)}?code=${encodeURIComponent(wiringCode)}`
      : null);

  return (
    <div className="part-popover-backdrop" role="presentation" onClick={onClose}>
      <div
        className="part-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`${roleLabel} ${part.part_number}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="part-popover__head">
          <div className="part-popover__title">
            <span className="part-popover__role">{roleLabel}</span>
            <span className="part-popover__pn font-mono">{part.part_number}</span>
            <span className={badge.className}>{badge.label}</span>
          </div>
          {wiringCode ? <span className="part-popover__code font-mono">{wiringCode}</span> : null}
        </div>
        <div className="part-popover__zoombar">
          <button type="button" className="part-popover__zbtn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Уменьшить">
            −
          </button>
          <span className="part-popover__zlabel">{Math.round(zoom * 100)}%</span>
          <button type="button" className="part-popover__zbtn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Увеличить">
            +
          </button>
          <button
            type="button"
            className="part-popover__zbtn"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
          >
            Сброс
          </button>
        </div>
        <div
          className="part-popover__image-wrap"
          onWheel={(e) => {
            e.preventDefault();
            setZoom((z) => Math.min(4, Math.max(0.5, z + (e.deltaY < 0 ? 0.15 : -0.15))));
          }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
        >
          {img ? (
            <img
              className="part-popover__image"
              src={img}
              alt={`Иллюстрация ${part.part_number}`}
              draggable={false}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            />
          ) : (
            <p className="part-popover__placeholder">Нет изображения в каталоге</p>
          )}
        </div>
        <p className="part-popover__hint">Колёсико / +− — масштаб, перетаскивание — сдвиг. Callout на чертеже EPC.</p>
        {part.reason ? <p className="part-popover__reason">{part.reason}</p> : null}
        {(related.housing || related.mate || related.terminals.length > 0) && (
          <div className="part-popover__related">
            {related.housing && related.housing.part_number !== part.part_number ? (
              <div className="part-popover__rel-row">
                Корпус <span className="font-mono">{related.housing.part_number}</span>
              </div>
            ) : null}
            {related.mate && related.mate.part_number !== part.part_number ? (
              <div className="part-popover__rel-row">
                Ответная <span className="font-mono">{related.mate.part_number}</span>
              </div>
            ) : null}
            {related.terminals
              .filter((t) => t.part_number !== part.part_number)
              .slice(0, 4)
              .map((t) => (
                <div key={t.part_number} className="part-popover__rel-row">
                  Клемма <span className="font-mono">{t.part_number}</span>
                </div>
              ))}
          </div>
        )}
        <div className="part-popover__actions">
          <button
            type="button"
            className="part-popover__btn"
            onClick={() => void copyPartNumber(part.part_number, setNotice)}
          >
            Скопировать
          </button>
          <button type="button" className="part-popover__btn part-popover__btn--primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function RepairCatalogBlock({
  repair,
  testId,
  setNotice,
}: {
  repair?: RepairCatalogResult | null;
  testId: string;
  setNotice: (v: string) => void;
}) {
  const [openPart, setOpenPart] = useState<{ part: RepairPart; roleLabel: string } | null>(null);
  if (!hasRepairCatalog(repair)) return null;
  const r = repair!;
  const statusBadge = confidenceBadge(
    r.status === "exact" ? "exact" : r.status === "compatible" ? "compatible" : "unknown",
  );
  return (
    <>
      <details className="repair-catalog" data-testid={testId}>
        <summary className="repair-catalog__summary">
          Ремонт разъёма
          <span className={statusBadge.className}>{statusBadge.label}</span>
        </summary>
        <p className="repair-catalog__summary-text">{r.summary_ru}</p>
        <ul className="parts-catalog parts-catalog--repair">
          {r.housing ? (
            <RepairPartRow
              part={r.housing}
              roleLabel="Корпус"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ) : null}
          {r.mate ? (
            <RepairPartRow
              part={r.mate}
              roleLabel="Ответная"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ) : null}
          {r.device ? (
            <RepairPartRow
              part={r.device}
              roleLabel="Деталь"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ) : null}
          {(r.terminals || []).map((t) => (
            <RepairPartRow
              key={`t-${t.part_number}-${t.confidence}`}
              part={t}
              roleLabel="Клемма"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ))}
          {(r.seals || []).map((t) => (
            <RepairPartRow
              key={`s-${t.part_number}`}
              part={t}
              roleLabel="Уплотнение"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ))}
          {(r.pigtails || []).map((t) => (
            <RepairPartRow
              key={`p-${t.part_number}`}
              part={t}
              roleLabel="Пигтейл"
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ))}
          {(r.tools || []).map((t) => (
            <RepairPartRow
              key={`tool-${t.part_number}`}
              part={t}
              roleLabel={t.role === "tool_kit" ? "Комплект" : "Инструмент"}
              setNotice={setNotice}
              onOpenPart={(part, roleLabel) => setOpenPart({ part, roleLabel })}
            />
          ))}
        </ul>
        <p className="repair-catalog__hint">
          Нажмите партномер — чертёж EPC для этого кода. Увеличивайте в окне (+/− / колёсико).
        </p>
      </details>
      {openPart ? (
        <PartNumberPopover
          part={openPart.part}
          roleLabel={openPart.roleLabel}
          related={{ housing: r.housing, mate: r.mate, terminals: r.terminals || [] }}
          wiringCode={r.code}
          onClose={() => setOpenPart(null)}
          setNotice={setNotice}
        />
      ) : null}
    </>
  );
}

function PartsCatalogList({
  parts,
  testId,
  setNotice,
  className = "parts-catalog parts-catalog--card",
  compact = false,
}: {
  parts: CardParts;
  testId: string;
  setNotice: (v: string) => void;
  className?: string;
  /** Card mode: collapsed PN badge + expand (full list on node banner). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  if (!hasLegacyCardParts(parts)) return null;
  const primary = parts.housing || parts.mate || parts.device || "";
  const count =
    [parts.device, parts.housing, parts.mate].filter(Boolean).length + (parts.terminals?.length || 0);

  if (compact && !open) {
    return (
      <div className="parts-catalog parts-catalog--compact" data-testid={testId}>
        <button
          type="button"
          className="parts-catalog__toggle"
          data-testid={`${testId}-toggle`}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          PN
          {primary ? <span className="parts-catalog__toggle-count font-mono">{primary}</span> : null}
          {count > 1 ? <span className="parts-catalog__toggle-count">+{count - 1}</span> : null}
          <span className="parts-catalog__chevron" aria-hidden>
            ▾
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? "parts-catalog parts-catalog--compact-open" : undefined}>
      {compact ? (
        <button
          type="button"
          className="parts-catalog__toggle"
          data-testid={`${testId}-toggle`}
          aria-expanded={true}
          onClick={() => setOpen(false)}
        >
          PN
          <span className="parts-catalog__chevron" aria-hidden>
            ▴
          </span>
        </button>
      ) : null}
      <ul className={className} data-testid={testId}>
        {parts.device ? (
          <li className="parts-catalog__chip">
            <span className="parts-catalog__role">Деталь</span>
            <span className="parts-catalog__pn-row">
              <span className="parts-catalog__pn font-mono">{parts.device}</span>
              <button
                type="button"
                className="parts-catalog__copy"
                title="Скопировать"
                aria-label={`Скопировать ${parts.device}`}
                onClick={() => void copyPartNumber(parts.device!, setNotice)}
              >
                <CopyIcon />
              </button>
            </span>
          </li>
        ) : null}
        {parts.housing ? (
          <li className="parts-catalog__chip">
            <span className="parts-catalog__role">Корпус</span>
            <span className="parts-catalog__pn-row">
              <span className="parts-catalog__pn font-mono">{parts.housing}</span>
              <button
                type="button"
                className="parts-catalog__copy"
                title="Скопировать"
                aria-label={`Скопировать ${parts.housing}`}
                onClick={() => void copyPartNumber(parts.housing!, setNotice)}
              >
                <CopyIcon />
              </button>
            </span>
          </li>
        ) : null}
        {parts.mate ? (
          <li className="parts-catalog__chip">
            <span className="parts-catalog__role">Ответная</span>
            <span className="parts-catalog__pn-row">
              <span className="parts-catalog__pn font-mono">{parts.mate}</span>
              <button
                type="button"
                className="parts-catalog__copy"
                title="Скопировать"
                aria-label={`Скопировать ${parts.mate}`}
                onClick={() => void copyPartNumber(parts.mate!, setNotice)}
              >
                <CopyIcon />
              </button>
            </span>
          </li>
        ) : null}
        {(parts.terminals || []).map((t) => (
          <li key={t.part_number} className="parts-catalog__chip">
            <span className="parts-catalog__role">Клемма</span>
            <span className="parts-catalog__pn-row">
              <span className="parts-catalog__pn font-mono">{t.part_number}</span>
              <button
                type="button"
                className="parts-catalog__copy"
                title="Скопировать"
                aria-label={`Скопировать ${t.part_number}`}
                onClick={() => void copyPartNumber(t.part_number, setNotice)}
              >
                <CopyIcon />
              </button>
            </span>
            {t.name_ru ? <span className="parts-catalog__name">{t.name_ru}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Свёрнутый блок комплектации: humanize только после первого раскрытия. */
function WireApplicabilityDetails({
  expr,
  optionTokens,
}: {
  expr: string;
  optionTokens?: string[];
}) {
  const [opened, setOpened] = useState(false);
  const human = opened ? humanizeOptionExpression(expr) : null;
  const status = opened ? optionApplicabilityStatus(expr, optionTokens) : "unknown";
  const statusClass =
    status === "match"
      ? "wire-applicability__status--match"
      : status === "mismatch"
        ? "wire-applicability__status--mismatch"
        : "wire-applicability__status--unknown";
  const conditionText = human
    ? human.textRuLabeled || human.textRu || expr
    : "";
  return (
    <details
      className="wire-applicability"
      data-testid="wire-applicability"
      data-status={opened ? status : undefined}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="wire-applicability__summary">
        Не на всех комплектациях данного авто
      </summary>
      {opened && human ? (
        <div className="wire-applicability__body">
          <p className="wire-applicability__why">
            Этот провод ставят только при такой комплектации — иначе его в жгуте может не быть.
          </p>
          <div className="wire-applicability__line">
            <span className="text-[var(--text-muted)]">Условие:</span>{" "}
            <span>{conditionText}</span>
          </div>
          <div className={`wire-applicability__status ${statusClass}`}>
            {optionApplicabilityLabel(status)}
          </div>
          <details className="wire-applicability__raw">
            <summary>Коды с схемы</summary>
            <code>{human.textRu || expr}</code>
            {human.raw && human.raw !== human.textRu ? (
              <code className="wire-applicability__raw-capital">{human.raw}</code>
            ) : null}
          </details>
          <p className="wire-applicability__gap-note">
            На схеме линия может «прерываться» текстом условий — это не обрыв провода в машине.
          </p>
        </div>
      ) : null}
    </details>
  );
}

function renderWireCard(
  item: Result,
  index: number,
  canShowOnDiagram: boolean,
  schemeInfo: CardSchemeInfo,
  selectedCode: string,
  setSelectedPinState: (v: { id: string | number; code: string; color: string; pin: string; wireUid?: string } | null) => void,
  selectedPinState: { id: string | number; code: string; color: string; pin: string; wireUid?: string } | null,
  onOpenDiagram: (searchCode: string, preferredUid?: string, wire?: WireFocus, card?: Result) => void,
  setCapitalPanel: (v: CapitalPanel | null) => void,
  setActiveSvg: (v: ActiveSvg | null) => void,
  setNotice: (v: string) => void,
  setEditingItem: (v: any) => void,
  suggestionsEnabled = true,
  cardContext?: {
    zone: string;
    code: string;
    model: string;
    year: string;
    engine: string;
    /** Vehicle optionTokens (VIN/фильтры) — для статуса применимости. */
    optionTokens?: string[];
  },
) {
  const itemId = item.id || `search-${index}`;
  const isThis = selectedPinState?.id === itemId;
  const wireRu = item.wire_color_ru || decodeWireColor(item.wire_color).replace(/\s*\([^)]*\)\s*$/, "") || "—";
  const wireCode = item.wire_color && item.wire_color !== "—" ? item.wire_color : "—";
  const openDiagram = () => {
    if (!canShowOnDiagram) {
      setNotice("Графическая схема EWD для этого провода недоступна. Откройте «Разъём» (FaceView).");
      return;
    }
    const code = String(selectedCode || item.search_target || item.from_node || "").trim();
    // pin_number часто — кавити стыка (74/xxx:21), а открытый лист — модуль (3/126:2).
    // Дальше sheetSideHighlightPin выберет цифру, которая реально есть на SVG выбранного узла.
    let cardPin = String(item.pin_number || "").trim();
    if (!cardPin && Array.isArray(item.pins) && item.pins.length) {
      cardPin = String(item.pins[0] ?? "").trim();
    }
    if (!cardPin) {
      // Фоллбек: вытащить «контакт N» / :N из текста карточки.
      const blob = `${item.card_title || ""} ${item.from_detail || ""} ${item.to_detail || ""} ${item.raw_line || ""}`;
      const m = blob.match(/контакт\s*[№#:]?\s*(\d{1,3})/i) || blob.match(/:(\d{1,3})\b/);
      if (m?.[1]) cardPin = String(m[1]);
    }
    const sheet = sheetSideHighlightPin(item, code, cardPin);
    const resolved = resolveHighlightPin(item, code, cardPin);
    // Текст карточки («Откуда») не трогаем; для highlight по листам узла — только sheetPin.
    const focus = cardFocusContact(item, code);
    const selectedN = normalizeCodeLabel(code);
    const fromCode = normalizeCodeLabel(sheet.fromCode || resolved.fromCode || focus.code || code);
    const toCode = normalizeCodeLabel(sheet.toCode || resolved.toCode || "");
    const pinFrom = String(sheet.pinFrom || resolved.pinFrom || "").trim();
    const pinTo = String(sheet.pinTo || resolved.pinTo || "").trim();
    const sheetPin = String(sheet.pin || "").trim();
    const cardPinUid = String(item.pin_uid || "").trim();
    // Первичный маркер = кавити выбранного узла (role: selected).
    // Транзит: «Откуда» 74/901:11 — это вторичный конец (role: to), не pin для 7/90.
    const wireEnds: WireEndFocus[] = [];
    if (fromCode && fromCode === selectedN) {
      // Выбранный узел на стороне «Откуда» карточки.
      wireEnds.push({
        code: fromCode,
        pin: pinFrom || sheetPin || undefined,
        pinCandidates: (pinFrom || sheetPin) ? [pinFrom || sheetPin] : undefined,
        uid: cardPinUid || undefined,
        role: "selected",
      });
      if (toCode && toCode !== fromCode) {
        wireEnds.push({
          code: toCode,
          pin: pinTo || undefined,
          pinCandidates: pinTo ? [pinTo] : undefined,
          role: "to",
        });
      }
    } else if (toCode && toCode === selectedN) {
      // Транзит / разворот: выбранный узел на стороне «Куда» — он всё равно primary.
      wireEnds.push({
        code: toCode,
        pin: pinTo || sheetPin || undefined,
        pinCandidates: (pinTo || sheetPin) ? [pinTo || sheetPin] : undefined,
        uid: cardPinUid || undefined,
        role: "selected",
      });
      if (fromCode && fromCode !== toCode) {
        wireEnds.push({
          code: fromCode,
          pin: pinFrom || undefined,
          pinCandidates: pinFrom ? [pinFrom] : undefined,
          role: "to",
        });
      }
    } else {
      // Ни from, ни to не совпали с узлом — ставим selected на from/код поиска.
      wireEnds.push({
        code: fromCode || selectedN,
        pin: pinFrom || sheetPin || undefined,
        pinCandidates: (pinFrom || sheetPin) ? [pinFrom || sheetPin] : undefined,
        uid: cardPinUid || undefined,
        role: "selected",
      });
      if (toCode && toCode !== (fromCode || selectedN)) {
        wireEnds.push({
          code: toCode,
          pin: pinTo || undefined,
          pinCandidates: pinTo ? [pinTo] : undefined,
          role: "to",
        });
      }
    }
    // Выделение карточки только по клику — не от hover/mouseleave.
    setSelectedPinState({
      id: itemId,
      code: selectedN,
      color: wireCode !== "—" ? wireCode : "",
      pin: sheetPin || pinFrom || pinTo,
      wireUid: String(item.wire_uid || "").trim() || undefined,
    });
    // Кандидаты для API: сначала sheet-side, потом остальные (чужой pin в хвосте).
    const pinCandidates = [
      ...new Set(
        [sheetPin, pinFrom, pinTo, cardPin]
          .map((p) => String(p || "").trim())
          .filter(Boolean),
      ),
    ];
    // Peer для pick-diagram — противоположный конец относительно выбранного узла.
    const peerForPick =
      fromCode && fromCode !== selectedN
        ? fromCode
        : toCode && toCode !== selectedN
          ? toCode
          : sheet.peerCode || resolved.peerCode || peerCodeFromCard(item, code) || undefined;
    onOpenDiagram(
      code,
      undefined,
      {
        pin: sheetPin || undefined,
        pinCandidates: pinCandidates.length ? pinCandidates : undefined,
        pinFrom: pinFrom || undefined,
        pinTo: pinTo || undefined,
        fromCode: fromCode || undefined,
        toCode: toCode || undefined,
        peerCode: peerForPick,
        peerPin:
          (peerForPick === fromCode ? pinFrom : peerForPick === toCode ? pinTo : "") ||
          sheet.peerPin ||
          resolved.peerPin ||
          undefined,
        wireColor: wireCode !== "—" ? wireCode : undefined,
        ends: wireEnds.length ? wireEnds : undefined,
        wireUid: String(item.wire_uid || "").trim() || undefined,
        pinUid: cardPinUid || undefined,
        // Не сплиттим option_expression в «токены» — это ломает &&/||.
        // Фильтр схем идёт через vehicle optionTokens из App (VIN/модель).
      },
      item,
    );
  };
  const faceCode = String(item.subject_code || selectedCode || item.from_node || "").trim();
  const openFaceView = () => {
    if (!faceCode) {
      setNotice("Нет кода разъёма для FaceView.");
      return;
    }
    setActiveSvg(null);
    setCapitalPanel({
      kind: "faceview",
      code: faceCode,
      pin: String(item.pin_number || "").trim() || undefined,
    });
  };
  const openLocation = () => {
    if (!faceCode) {
      setNotice("Нет кода для Location View.");
      return;
    }
    setActiveSvg(null);
    setCapitalPanel({ kind: "location", code: faceCode });
  };
  const titleFocus = cardFocusContact(item, selectedCode);
  const ownerTitle =
    String(item.match_role || "") === "owner" && titleFocus.pin
      ? `${titleFocus.code}:${titleFocus.pin}`
      : "";
  const connectorTitle =
    ownerTitle ||
    item.card_title ||
    item.system_name ||
    (titleFocus.pin ? `${titleFocus.code}:${titleFocus.pin}` : "Контакт");
  const steering = item.steering_side === "LHD" || item.steering_side === "RHD" ? item.steering_side : "";
  const fromLabel =
    (item.from_detail && String(item.from_detail).trim()) ||
    (item.from_node && item.from_node !== "—" ? `${item.from_node}${item.from_type_ru ? ` — ${item.from_type_ru}` : ""}` : "—");
  const toLabel =
    (item.to_detail && String(item.to_detail).trim()) ||
    (item.to_node && item.to_node !== "—" ? `${item.to_node}${item.to_type_ru ? ` — ${item.to_type_ru}` : ""}` : "—");
  const score = (() => {
    const integ = typeof item.integrity_score === "number" ? item.integrity_score : null;
    const calc = typeof item.score === "number" ? item.score : null;
    if (integ != null && integ > 0) return integ;
    if (calc != null) return calc;
    if (integ === 0 && calc != null) return calc;
    return integ ?? calc;
  })();
  const schemeExact = schemeInfo.status === "exact-one" || schemeInfo.status === "exact-many";
  const schemeWarning =
    schemeInfo.status === "no-sheet" || schemeInfo.status === "missing-identity";
  const hasDetails =
    schemeExact ||
    Boolean(String(item.option_expression || "").trim()) ||
    Boolean(item.function_text) ||
    hasLegacyCardParts(item.parts) ||
    Boolean(item.card_title && item.card_title !== connectorTitle);
  return (
    <div
      key={itemId}
      data-testid="result-card"
      className={`result-card bg-[var(--bg-card)] border rounded-lg p-4 mb-2 flex flex-col gap-2.5 text-left transition-all shadow-sm ${isThis ? "border-emerald-500 shadow-md ring-1 ring-emerald-400/40" : "border-[var(--border-color)]"} ${selectedPinState && !isThis ? "border-dashed opacity-100" : "opacity-100"}`}
    >
      <div className="result-card__head flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <h3 className="ewd-data text-sm font-semibold text-[var(--text-main)] leading-snug">{connectorTitle}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {schemeExact ? (
            <span className="wire-scheme-badge" title="Провод подтверждён на схеме">
              ● на схеме
            </span>
          ) : null}
          {steering ? (
            <span className="ewd-light-badge text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border bg-sky-50 border-sky-300">{steering}</span>
          ) : null}
          {import.meta.env.DEV && item.is_verified ? (
            <span className="ewd-light-badge text-[10px] font-mono px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-300">verified</span>
          ) : null}
          {import.meta.env.DEV && score !== null ? (
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
      <div className="result-card__body grid grid-cols-1 gap-1.5 text-xs font-mono text-[var(--text-main)] bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md p-2.5">
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
          {item.wire_gauge ? (
            <span className="wire-gauge-inline ewd-data font-mono">
              {item.wire_gauge} мм²
            </span>
          ) : null}
        </div>
      </div>
      {schemeWarning ? (
        <div
          className="wire-context-notice wire-context-notice--warning"
          role={schemeInfo.status === "no-sheet" ? "alert" : "status"}
          data-testid="wire-context-notice"
        >
          {schemeInfo.status === "no-sheet" ? (
            <span>Точная схема этого провода не подтверждена. Листы узла могут не содержать провод.</span>
          ) : (
            <span>Нет идентификатора провода: схема будет подобрана по контакту и цвету.</span>
          )}
          {schemeInfo.nearestPeer ? (
            <span className="wire-context-notice__peer">
              Ближайшая связь: <strong>{schemeInfo.nearestPeer.code}</strong>
              {schemeInfo.nearestPeer.pin ? ` · контакт ${schemeInfo.nearestPeer.pin}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      <RepairCatalogBlock
        repair={item.parts?.repair}
        testId="card-repair"
        setNotice={setNotice}
      />
      {hasDetails ? (
        <details className="wire-card-details">
          <summary className="wire-card-details__summary">Подробнее</summary>
          <div className="wire-card-details__body">
            {item.card_title && item.card_title !== connectorTitle ? (
              <p className="wire-card-details__title">{item.card_title}</p>
            ) : null}
            {item.function_text ? (
              <div className="wire-card-details__row">
                <span>Цепь</span>
                <strong className="ewd-data font-mono">{item.function_text}</strong>
              </div>
            ) : null}
            {String(item.option_expression || "").trim() ? (
              <WireApplicabilityDetails
                expr={String(item.option_expression || "").trim()}
                optionTokens={cardContext?.optionTokens}
              />
            ) : null}
            {schemeExact ? (
              <div
                className="wire-context-notice wire-context-notice--info"
                role="status"
                data-testid="wire-context-notice"
              >
                {schemeInfo.status === "exact-one" ? (
                  <span>
                    Провод подтверждён на схеме:{" "}
                    <strong>{schemeInfo.exactSheets[0]?.systemName || schemeInfo.exactSheets[0]?.title}</strong>.
                  </span>
                ) : (
                  <span>
                    Провод подтверждён на {schemeInfo.exactSheets.length} схемах — будет выбрана наиболее точная.
                  </span>
                )}
                {schemeInfo.nearestPeer ? (
                  <span className="wire-context-notice__peer">
                    Ближайшая связь: <strong>{schemeInfo.nearestPeer.code}</strong>
                    {schemeInfo.nearestPeer.pin ? ` · контакт ${schemeInfo.nearestPeer.pin}` : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
            {hasLegacyCardParts(item.parts) ? (
              <PartsCatalogList
                parts={item.parts!}
                testId="card-parts"
                setNotice={setNotice}
                className="parts-catalog parts-catalog--card"
              />
            ) : null}
          </div>
        </details>
      ) : null}
      <div className="card-actions flex gap-2 mt-0.5">
        {canShowOnDiagram ? (
          <button
            type="button"
            data-testid="show-on-diagram"
            onClick={openDiagram}
            className="md-btn md-btn--filled card-actions__btn card-actions__btn--primary flex-1 text-xs"
          >
            <span className="card-actions__label-full">Показать на схеме</span>
            <span className="card-actions__label-short">Схема</span>
          </button>
        ) : null}
        <button
          type="button"
          data-testid="show-faceview"
          onClick={openFaceView}
          className={`md-btn md-btn--tonal card-actions__btn text-xs ${canShowOnDiagram ? "" : "flex-1"}`}
        >
          Разъём
        </button>
        <button
          type="button"
          data-testid="show-location"
          onClick={openLocation}
          className="md-btn md-btn--tonal card-actions__btn text-xs"
        >
          <span className="card-actions__label-full">Расположение</span>
          <span className="card-actions__label-short">Место</span>
        </button>
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
            className="md-btn md-btn--text suggest-edit-btn card-actions__btn card-actions__btn--icon"
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

const DTC_FAULT_STATE_LABELS: Record<string, string> = {
  intermittent: "прерывистая",
  permanent: "постоянная",
  signal_low: "сигнал низкий",
  signal_high: "сигнал высокий",
  signal_missing: "сигнал отсутствует",
  internal_fault: "внутренняя неисправность",
  faulty_signal: "неверный сигнал",
};

function faultStateLabel(value?: string): string {
  if (!value) return "";
  return DTC_FAULT_STATE_LABELS[value] ?? value.replace(/_/g, " ");
}

function describeDtcVariants(count: number): string {
  if (count > 1) {
    return `В VIDA под этим кодом ${count} отдельных записей. Это не языки RU/EN, а разные IE-варианты с отличающимися формулировками или состоянием неисправности.`;
  }
  return "В VIDA для этого кода найдена одна запись. RU/EN ниже - это только локализации одной и той же записи.";
}

function migrateThemeId(raw: string | null): ThemeId {
  if (raw === "charcoal" || raw === "caspian" || raw === "amber") return raw;
  if (raw === "volvo-charcoal") return "charcoal";
  if (raw === "volvo-silver" || raw === "volvo-ocean") return "caspian";
  return "caspian";
}

function App() {
  const persisted0: PersistedFilters =
    typeof window !== "undefined"
      ? loadPersistedFilters()
      : { model: "", year: "", engine: "", transmission: "", zone: "all", code: "" };
  const [selectedModel, setSelectedModel] = useState(() => persisted0.model || "");
  const [selectedYear, setSelectedYear] = useState(() => persisted0.year || "");
  const [selectedEngine, setSelectedEngine] = useState(() => persisted0.engine || "");
  const [selectedTransmission, setSelectedTransmission] = useState(() => persisted0.transmission || "");
  const [vinInput, setVinInput] = useState("");
  const [vinLocked, setVinLocked] = useState(false);
  const [vinNotice, setVinNotice] = useState("");
  const [available, setAvailable] = useState<FilterAvailable>({
    models: DEFAULT_MODELS,
    years: [],
    engines: [],
    engineOptions: [],
    transmissions: [],
  });
  const [optionTokens, setOptionTokens] = useState<string[]>([]);
  type EwdSystemRow = {
    systemUid: string;
    name: string;
    folders?: string;
    zone?: string | null;
    diagramUids?: string[];
    diagramCount?: number;
    wireOwned?: boolean;
    confidence?: SchemeConfidence;
  };
  const [ewdSystems, setEwdSystems] = useState<EwdSystemRow[]>([]);
  const [systemsOpen, setSystemsOpen] = useState(false);
  const [traceInfo, setTraceInfo] = useState<{
    uid: string;
    signalFile?: string | null;
    siblingCount: number;
    diagrams: Array<{ diagramUid: string; systemName?: string }>;
  } | null>(null);
  const [mode, setMode] = useState<"search" | "dtc" | null>(null);
  type DtcHit = {
    code: string;
    ecu: string;
    obd_code: string;
    title_ru: string;
    title_en: string;
    variants: number;
  };
  type DtcVariant = {
    ie_id: string;
    code: string;
    ecu: string;
    obd_code: string;
    title_ru: string;
    title_en: string;
    source: string;
    fault_state?: string;
  };
  type DtcDetails = {
    summary: DtcHit;
    matched_by: "code" | "obd_code";
    entries: DtcVariant[];
  };
  const [dtcQuery, setDtcQuery] = useState("");
  const [dtcResults, setDtcResults] = useState<DtcHit[]>([]);
  const [dtcLoading, setDtcLoading] = useState(false);
  const [dtcNotice, setDtcNotice] = useState("");
  const [dtcOpenCode, setDtcOpenCode] = useState("");
  const [dtcDetailsByCode, setDtcDetailsByCode] = useState<Record<string, DtcDetails | null>>({});
  const [dtcDetailsLoadingCode, setDtcDetailsLoadingCode] = useState("");
  type NodeInfo = {
    code: string;
    name_ru: string;
    pin_count: { owner: number; transit: number; total: number };
    wire_gauges: string[];
    zoneEmptyFallback?: boolean;
    parts?: CardParts;
  };
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [ownerWires, setOwnerWires] = useState<Result[]>([]);
  const [transitWires, setTransitWires] = useState<Result[]>([]);
  const [ewdDiagrams, setEwdDiagrams] = useState<EwdDiagram[]>([]);
  const [ewdObjectIds, setEwdObjectIds] = useState<string[]>([]);
  /** UIDs present on available SVG sheets for the current node (from /diagrams). */
  const [ewdSheetUids, setEwdSheetUids] = useState<Set<string>>(() => new Set());
  /** Sheets with wireHits>0 for the last card pick — picker default list. */
  const [cardViableDiagrams, setCardViableDiagrams] = useState<EwdDiagram[]>([]);
  const [pickBestUid, setPickBestUid] = useState("");
  const [showAllNodeDiagrams, setShowAllNodeDiagrams] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [capitalPanel, setCapitalPanel] = useState<CapitalPanel | null>(null);
  const [activeSvg, setActiveSvg] = useState<ActiveSvg | null>(null);
  const [schemeFullscreen, setSchemeFullscreen] = useState(false);
  const showSeqRef = useRef(0);
  /** Invalidates stale load/open responses when the user changes node or wire quickly. */
  const ewdAttemptRef = useRef(0);
  /** Уже пробовали после pin-miss для текущего фокуса карточки (антизацикливание). */
  const pinMissTriedRef = useRef<Set<string>>(new Set());
  /** Connectivity-viable sheets for this pin (from /api/ewd/pick-diagram) — retry only inside this list. */
  const pinViableUidsRef = useRef<string[]>([]);
  /** Сколько авто-повторов после pin-miss осталось (только клик карточки; ручной picker = 0). */
  const pinMissBudgetRef = useRef(0);
  /** Last card wire focus — systems tree / picker re-use anchors. */
  const lastWireFocusRef = useRef<WireFocus | null>(null);
  const [zoom, setZoom] = useState(80);
  const [selectedPinState, setSelectedPinState] = useState<{
    id: string | number;
    code: string;
    color: string;
    pin: string;
    wireUid?: string;
  } | null>(null);
  const [zones, setZones] = useState<NavZone[]>([]);
  const [navGroups, setNavGroups] = useState<NavGroup[]>([]);
  const [selectedZone, setSelectedZone] = useState(() => persisted0.zone || "all");
  const [isAdmin, setIsAdmin] = useState(false);
  /** null = status not loaded yet (do not render the full app for visitors). */
  const [siteOpen, setSiteOpen] = useState<boolean | null>(null);
  const [features, setFeatures] = useState({
    suggestions: true,
    ewdDiagrams: true,
    vinSearch: true,
    navBrowse: true,
    dtcSearch: true,
    obdAdapter: true,
  });
  /** Mobile bottom-sheet for filters; desktop ignores (filters always inline). */
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  /** Desktop/laptop: filters popover under «Фильтры» (not a full-width plank). */
  const [filtersPopoverOpen, setFiltersPopoverOpen] = useState(false);
  /** Desktop: manually collapse the two-row quick-filter plank. */
  const [desktopFiltersCollapsed, setDesktopFiltersCollapsed] = useState(() => {
    try {
      return localStorage.getItem("ewd-desktop-filters-collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ewd-desktop-filters-collapsed", desktopFiltersCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [desktopFiltersCollapsed]);
  const [filtersPopoverPos, setFiltersPopoverPos] = useState<{ top: number; left: number }>({
    top: 64,
    left: 12,
  });
  /** Mobile: node colors / systems / diagrams sheet (keeps card list full-height). */
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  const [isMobileUi, setIsMobileUi] = useState(false);
  const desktopFiltersBtnRef = useRef<HTMLButtonElement | null>(null);

  function placeDesktopFiltersPopover() {
    const btn = desktopFiltersBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(40 * 16, window.innerWidth - 24);
    let left = r.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    if (left < 12) left = 12;
    setFiltersPopoverPos({ top: r.bottom + 8, left });
  }

  function openDesktopFiltersPopover() {
    placeDesktopFiltersPopover();
    setFiltersPopoverOpen(true);
  }
  const [vehicleConfigured, setVehicleConfigured] = useState(
    () => Boolean(persisted0.model && persisted0.year),
  );
  const headerRef = useRef<HTMLElement | null>(null);
  const filtersSheetRef = useRef<HTMLDivElement | null>(null);
  const filtersSheetBodyRef = useRef<HTMLDivElement | null>(null);
  const sheetSwipeRef = useRef<{ y: number } | null>(null);
  const pullGuardRef = useRef<{ y: number } | null>(null);
  const filtersToggleRef = useRef<HTMLButtonElement | null>(null);
  const deepWireIdRef = useRef<string>("");
  const filtersHydratedRef = useRef(Boolean(persisted0.model || persisted0.year || persisted0.engine));
  const [filtersHydrated, setFiltersHydrated] = useState(() =>
    Boolean(persisted0.model || persisted0.year || persisted0.engine || persisted0.zone || persisted0.code),
  );
  const [selectedCode, setSelectedCode] = useState(() => persisted0.code || "");
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
  const [pushState, setPushState] = useState<PushUiState>("unavailable");
  const [pushBusy, setPushBusy] = useState(false);
  const vehicle = {
    model: selectedModel,
    year: selectedYear,
    engine: selectedEngine,
    transmission: selectedTransmission,
  };
  const rightOpen = Boolean(activeSvg || capitalPanel);
  const hasEwdDiagram = ewdDiagrams.length > 0;
  const cardCanShowOnDiagram = (item: Result): boolean => {
    if (!features.ewdDiagrams || !hasEwdDiagram) return false;
    const wu = String(item.wire_uid || "").trim();
    // Known wire UID must exist on an available (on-disk) sheet — else hide the button.
    if (wu) return ewdSheetUids.has(wu);
    // No UID: allow soft pick among node sheets
    return true;
  };

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
  // schemeInfo один раз на набор карточек/листов — не пересчитывать на каждый клик выделения.
  const schemeInfoByCardKey = useMemo(() => {
    const map = new Map<string, CardSchemeInfo>();
    const add = (item: Result, index: number) => {
      const key = String(item.id || `idx-${index}`);
      map.set(key, cardSchemeInfo(item, selectedCode, ewdDiagrams));
    };
    filteredOwnerWires.forEach((item, i) => add(item, i));
    filteredTransitWires.forEach((item, i) => add(item, i + 10000));
    return map;
  }, [filteredOwnerWires, filteredTransitWires, selectedCode, ewdDiagrams]);

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
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      setToolsSheetOpen(false);
    }
  };

  // Capital FaceView / Location / report → scheme tab on phones
  useEffect(() => {
    if (capitalPanel && !activeSvg && isMobileViewport()) setMobileView("scheme");
  }, [capitalPanel, activeSvg]);

  const focusedWireUid =
    String(activeSvg?.wireUid || selectedPinState?.wireUid || lastWireFocusRef.current?.wireUid || "").trim() ||
    undefined;

  const rankedDiagrams = useMemo(() => {
    const ctx = schemeContext || extractSchemeContext(null, selectedCode);
    let pool =
      !showAllNodeDiagrams && cardViableDiagrams.length
        ? cardViableDiagrams
        : ewdDiagrams;
    if (focusedWireUid && !showAllNodeDiagrams) {
      const wireOwned = pool.filter((d) => diagramContainsWireUid(d, focusedWireUid));
      if (wireOwned.length) pool = wireOwned;
    }
    return rankDiagramsForContext(pool, ctx);
  }, [
    ewdDiagrams,
    cardViableDiagrams,
    showAllNodeDiagrams,
    schemeContext,
    selectedCode,
    focusedWireUid,
  ]);
  const bestDiagramUid =
    pickBestUid ||
    (rankedDiagrams[0] &&
    (focusedWireUid
      ? diagramContainsWireUid(rankedDiagrams[0].diagram, focusedWireUid)
      : (Number(rankedDiagrams[0].diagram.wireHits) || 0) > 0 || rankedDiagrams[0].score >= 50)
      ? rankedDiagrams[0].diagram.diagramUid
      : "");

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
    if (!activeSvg && !capitalPanel) setSchemeFullscreen(false);
  }, [activeSvg, capitalPanel]);

  useEffect(() => {
    if (!schemeFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSchemeFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [schemeFullscreen]);

  useEffect(() => {
    if (!schemeFullscreen) return;
    // Refit marker after layout expands to fullscreen (keeps highlight; does not clear filters).
    showSeqRef.current += 1;
    setActiveSvg((prev) => (prev ? { ...prev, showSeq: showSeqRef.current } : prev));
  }, [schemeFullscreen]);

  function enterSchemeFullscreen() {
    setSchemeFullscreen(true);
  }

  function exitSchemeFullscreen() {
    setSchemeFullscreen(false);
  }

  function closeActiveScheme() {
    setSchemeFullscreen(false);
    setActiveSvg(null);
    setSelectedPinState(null);
    setMobileView("cards");
  }

  function closeCapitalPanel() {
    if (schemeFullscreen) {
      exitSchemeFullscreen();
      return;
    }
    setSchemeFullscreen(false);
    setCapitalPanel(null);
    setMobileView("cards");
  }

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
    if (!filtersHydrated) return;
    const qs = new URLSearchParams();
    if (selectedModel) qs.set("model", selectedModel);
    if (selectedYear) qs.set("year", selectedYear);
    if (selectedEngine) qs.set("engine", selectedEngine);
    if (selectedTransmission) qs.set("transmission", selectedTransmission);
    const ac = new AbortController();
    fetch(`/api/filters?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => {
        const nextYears: string[] = Array.isArray(data.years) ? data.years : [];
        const nextEngines: string[] = Array.isArray(data.engines) ? data.engines : [];
        const nextEngineOptions: EngineOpt[] = Array.isArray(data.engineOptions)
          ? data.engineOptions
              .filter((x: unknown): x is EngineOpt => Boolean(
                x && typeof x === "object" && "id" in x && "label" in x,
              ))
              .map((x: EngineOpt) => ({
                id: String(x.id),
                label: String(x.label),
                ...(x.market ? { market: String(x.market) } : {}),
              }))
          : nextEngines.map((id) => ({ id, label: id }));
        const nextTrans: TransmissionOpt[] = Array.isArray(data.transmissions) ? data.transmissions : [];
        const nextModels: string[] = Array.isArray(data.models) && data.models.length ? data.models : DEFAULT_MODELS;
        setAvailable({
          models: nextModels,
          years: nextYears,
          engines: nextEngines,
          engineOptions: nextEngineOptions,
          transmissions: nextTrans,
        });
        if (Array.isArray(data.optionTokens)) {
          setOptionTokens(data.optionTokens.map(String).filter(Boolean));
        }
        // The server owns cascade normalization. Applying its selection clears
        // stale URL/localStorage values after model/year changes.
        if (data.selection && typeof data.selection === "object") {
          setSelectedYear(String(data.selection.year || ""));
          setSelectedEngine(String(data.selection.engine || ""));
          setSelectedTransmission(String(data.selection.transmission || ""));
        }
      })
      .catch((err: { name?: string }) => {
        if (err?.name === "AbortError") return;
        /* keep previous */
      });
    return () => ac.abort();
  }, [filtersHydrated, selectedModel, selectedYear, selectedEngine, selectedTransmission]);

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
        if (d.appearance) {
          applySiteAppearance(d.appearance);
          const siteTheme = siteDefaultTheme(d.appearance);
          if (siteTheme) {
            try {
              if (!localStorage.getItem("volvoTheme")) setTheme(siteTheme);
            } catch {
              setTheme(siteTheme);
            }
          }
        }
      })
      .catch(() => setSiteOpen(false));
    trackVisitOnce();
    void getPushUiState().then(setPushState);
  }, []);

  // Restore filters: URL query > localStorage (survives F5). Lazy-init already applied state;
  // this pass re-applies URL priority and deep wireId.
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
    setFiltersHydrated(true);
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

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => {
      const mobile = mq.matches;
      setIsMobileUi(mobile);
      if (mobile) setFiltersPopoverOpen(false);
      else setFiltersSheetOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Desktop filters popover: Escape, scroll-lock, reposition on resize
  useEffect(() => {
    if (!filtersPopoverOpen || isMobileUi) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersPopoverOpen(false);
    };
    const onResize = () => placeDesktopFiltersPopover();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [filtersPopoverOpen, isMobileUi]);

  // Mac Chrome: overflow-x strips / nested sticky chrome swallow vertical trackpad wheel
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // leave trackpad pinch to the diagram viewer
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".svg-viewer, .scheme-panel--fullscreen")) return;
      if (t.closest(".filters-host.is-sheet-open, .mobile-node-tools[open]")) return;
      const trap = t.closest(".wire-color-filter, .cards-column__sticky");
      if (!trap) return;
      const sticky =
        trap instanceof HTMLElement && trap.classList.contains("cards-column__sticky")
          ? trap
          : (trap.closest(".cards-column__sticky") as HTMLElement | null);
      if (sticky && sticky.scrollHeight > sticky.clientHeight + 1) {
        const atTop = sticky.scrollTop <= 0;
        const atBottom = sticky.scrollTop + sticky.clientHeight >= sticky.scrollHeight - 1;
        if (e.deltaY < 0 && !atTop) return;
        if (e.deltaY > 0 && !atBottom) return;
      }
      const scroller =
        (trap.closest(".cards-column__scroll") as HTMLElement | null) ||
        document.querySelector<HTMLElement>('[data-testid="cards-column-scroll"]');
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;
      scroller.scrollTop += e.deltaY;
      e.preventDefault();
    };
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", onWheel, true);
  }, []);

  // Mobile sheets: scroll-lock, Escape, pull-to-refresh guard, focus
  const anySheetOpen = filtersSheetOpen || (isMobileUi && toolsSheetOpen);
  useEffect(() => {
    if (!anySheetOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("is-filters-sheet-open");
    document.body.classList.add("is-filters-sheet-open");

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (toolsSheetOpen) setToolsSheetOpen(false);
      else setFiltersSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      pullGuardRef.current = { y: t.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      const start = pullGuardRef.current;
      if (!t || !start) return;
      const dy = t.clientY - start.y;
      const body = filtersSheetBodyRef.current;
      const atTop = !body || body.scrollTop <= 0;
      // Block browser pull-to-refresh while sheet is open and user pulls down at top
      if (atTop && dy > 0) {
        e.preventDefault();
      }
    };
    const onTouchEnd = () => {
      pullGuardRef.current = null;
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    const root = filtersSheetRef.current;
    const focusable = root?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    if (filtersSheetOpen) focusable?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.documentElement.classList.remove("is-filters-sheet-open");
      document.body.classList.remove("is-filters-sheet-open");
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      if (filtersSheetOpen) filtersToggleRef.current?.focus();
    };
  }, [anySheetOpen, filtersSheetOpen, toolsSheetOpen]);

  const onSheetSwipeStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    sheetSwipeRef.current = { y: t.clientY };
  };
  const onSheetSwipeEnd = (e: ReactTouchEvent) => {
    const start = sheetSwipeRef.current;
    sheetSwipeRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dy = t.clientY - start.y;
    const body = filtersSheetBodyRef.current;
    const atTop = !body || body.scrollTop <= 0;
    if (atTop && dy > 64) setFiltersSheetOpen(false);
  };

  const clear = () => {
    setMode(null);
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
    setEwdSheetUids(new Set());
    setNotice("");
    setLoading(false);
    setSelectedCode("");
    setWireColorFilter(null);
    setSchemeContext(null);
    setMobileView("cards");
    setToolsSheetOpen(false);
    setSelectedPinState(null);
    setCapitalPanel(null);
    setActiveSvg(null);
    setNodeInfo(null);
    setDtcResults([]);
    setDtcNotice("");
    setDtcOpenCode("");
    setDtcDetailsByCode({});
    setDtcDetailsLoadingCode("");
  };

  function clearDtc() {
    setDtcQuery("");
    setDtcResults([]);
    setDtcNotice("");
    setDtcOpenCode("");
    setDtcDetailsByCode({});
    setDtcDetailsLoadingCode("");
    if (mode === "dtc") setMode(null);
  }

  async function toggleDtcDetails(code: string) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return;
    if (dtcOpenCode === normalized) {
      setDtcOpenCode("");
      return;
    }
    setDtcOpenCode(normalized);
    if (Object.prototype.hasOwnProperty.call(dtcDetailsByCode, normalized)) return;
    setDtcDetailsLoadingCode(normalized);
    try {
      const data = await fetch(`/api/dtc/code/${encodeURIComponent(normalized)}/details`).then((r) => r.json());
      setDtcDetailsByCode((cur) => ({ ...cur, [normalized]: data && !data.error ? (data as DtcDetails) : null }));
    } catch {
      setDtcDetailsByCode((cur) => ({ ...cur, [normalized]: null }));
    } finally {
      setDtcDetailsLoadingCode((cur) => (cur === normalized ? "" : cur));
    }
  }

  function clearVin() {
    setVinInput("");
    setVinLocked(false);
    setVinNotice("");
  }

  async function searchDtc() {
    const q = dtcQuery.trim();
    setFiltersSheetOpen(false);
    setFiltersPopoverOpen(false);
    if (q.length < 2) {
      setMode("dtc");
      setDtcResults([]);
      setDtcNotice("Результатов нет");
      return;
    }
    setDtcLoading(true);
    setDtcNotice("Ищем…");
    setMode("dtc");
    setOwnerWires([]);
    setTransitWires([]);
    setCapitalPanel(null);
    setActiveSvg(null);
    setSelectedPinState(null);
    try {
      const data = await fetch(`/api/dtc/search?q=${encodeURIComponent(q)}&limit=50`).then((r) => r.json());
      if (!data.available) {
        setDtcResults([]);
        setDtcNotice("Словарь DTC недоступен на сервере.");
        return;
      }
      const results = Array.isArray(data.results) ? (data.results as DtcHit[]) : [];
      setDtcResults(results);
      setDtcOpenCode("");
      setDtcDetailsByCode({});
      setDtcDetailsLoadingCode("");
      setDtcNotice(results.length ? `Найдено: ${results.length}` : "Результатов нет");
    } catch {
      setDtcResults([]);
      setDtcNotice("Ошибка запроса DTC.");
    } finally {
      setDtcLoading(false);
    }
  }

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
    const closeFilters = () => {
      setFiltersSheetOpen(false);
      setFiltersPopoverOpen(false);
    };
    if (vin.length !== 17) {
      setVinNotice("VIN должен быть 17 символов.");
      closeFilters();
      return;
    }
    setVinNotice("Декодируем VIN…");
    try {
      const data = await fetch(`/api/vin/decode?vin=${encodeURIComponent(vin)}`).then((r) => r.json());
      closeFilters();
      if (!data.ok) {
        const detail = typeof data.error === "string" && data.error.trim() ? ` ${data.error.trim()}` : "";
        setVinNotice(`Результатов нет.${detail}`);
        setVinLocked(false);
        return;
      }
      const model = String(data.model || "").trim();
      const year = String(data.year || "").trim();
      if (!model || !year) {
        setVinNotice("Результатов нет");
        setVinLocked(false);
        return;
      }
      setSelectedModel(model);
      setSelectedYear(year);
      setSelectedEngine(data.engine || "");
      setSelectedTransmission(data.transmission || "");
      setVinLocked(true);
      const notes = Array.isArray(data.notes) && data.notes.length ? ` (${data.notes[0]})` : "";
      setVinNotice(
        `VIN → ${model} · ${year} · ${data.engine || "—"} · ${data.transmission || "—"}${notes}`,
      );
      setNotice(`Конфигурация по VIN зафиксирована. Пакет EWD: ${data.ewdPackageHint || "39363002"}`);
    } catch {
      closeFilters();
      setVinNotice("Результатов нет. Ошибка запроса декодера VIN.");
      setVinLocked(false);
    }
  }

  async function openEwdDiagram(
    searchCode: string,
    preferredUid?: string,
    wire?: WireFocus,
    card?: Result,
    opts?: { fromPinMissRetry?: boolean; manualPick?: boolean },
  ) {
    const code = normalizeCodeLabel(searchCode || selectedCode);
    const attemptId = ++ewdAttemptRef.current;
    const isCurrentAttempt = () => ewdAttemptRef.current === attemptId;
    if (!ewdDiagrams.length) {
      setNotice("Графическая схема EWD для этого узла не найдена.");
      return;
    }
    const ctx = card
      ? extractSchemeContext(card, code)
      : schemeContext || extractSchemeContext(null, code);
    if (card) setSchemeContext(ctx);

    const resolved = card
      ? resolveHighlightPin(card, code, wire?.pin || "")
      : null;
    const sheetSide = card ? sheetSideHighlightPin(card, code, wire?.pin || "") : null;
    const cardFrom = card ? cardFocusContact(card, code) : null;
    const fromCode =
      wire?.fromCode ||
      sheetSide?.fromCode ||
      resolved?.fromCode ||
      cardFrom?.code ||
      "";
    const toCode = wire?.toCode || sheetSide?.toCode || resolved?.toCode || "";
    const pinFrom =
      wire?.pinFrom ||
      sheetSide?.pinFrom ||
      resolved?.pinFrom ||
      "";
    const pinTo = wire?.pinTo || sheetSide?.pinTo || resolved?.pinTo || "";
    const peerPin = wire?.peerPin || pinTo || sheetSide?.peerPin || resolved?.peerPin || "";
    // Для highlight по листам searchCode нужна кавити ЭТОГО узла, не «Откуда» транзита (74/901:11).
    const sheetPin =
      wire?.pin ||
      sheetSide?.pin ||
      resolved?.pin ||
      (normalizeCodeLabel(fromCode) === code ? pinFrom : "") ||
      (normalizeCodeLabel(toCode) === code ? pinTo : "") ||
      "";
    // В focus/pick ведём с кавити выбранного узла; «Куда» только в хвосте кандидатов.
    const pinCandidates = [
      ...new Set(
        [
          sheetPin,
          ...(wire?.pinCandidates || []),
          pinFrom,
          pinTo,
          wire?.pin,
          cardFrom?.pin,
        ]
          .map((p) => String(p || "").trim())
          .filter(Boolean),
      ),
    ];
    const wireEnds: WireEndFocus[] =
      wire?.ends?.length
        ? wire.ends
        : [
            ...(fromCode && normalizeCodeLabel(fromCode) === code
              ? [
                  {
                    code: fromCode,
                    pin: pinFrom || sheetPin || undefined,
                    pinCandidates: (pinFrom || sheetPin) ? [pinFrom || sheetPin] : undefined,
                    role: "selected" as const,
                  },
                ]
              : toCode && normalizeCodeLabel(toCode) === code
                ? [
                    {
                      code: toCode,
                      pin: pinTo || sheetPin || undefined,
                      pinCandidates: (pinTo || sheetPin) ? [pinTo || sheetPin] : undefined,
                      role: "selected" as const,
                    },
                  ]
                : fromCode
                  ? [
                      {
                        code: fromCode,
                        pin: pinFrom || sheetPin || undefined,
                        pinCandidates: (pinFrom || sheetPin) ? [pinFrom || sheetPin] : undefined,
                        role: "selected" as const,
                      },
                    ]
                  : []),
            ...(toCode &&
            toCode !== fromCode &&
            !(normalizeCodeLabel(toCode) === code && normalizeCodeLabel(fromCode) !== code)
              ? [
                  {
                    code: toCode,
                    pin: pinTo || undefined,
                    pinCandidates: pinTo ? [pinTo] : undefined,
                    role: "to" as const,
                  },
                ]
              : fromCode &&
                  normalizeCodeLabel(toCode) === code &&
                  normalizeCodeLabel(fromCode) !== code
                ? [
                    {
                      code: fromCode,
                      pin: pinFrom || undefined,
                      pinCandidates: pinFrom ? [pinFrom] : undefined,
                      role: "to" as const,
                    },
                  ]
                : []),
          ];
    const hasPinFocus = pinCandidates.length > 0 || !!wire?.pin || wireEnds.some((e) => e.pin);

    const boundWireUid =
      wire?.wireUid || String(card?.wire_uid || "").trim() || undefined;
    const boundPinUid =
      wire?.pinUid || String(card?.pin_uid || "").trim() || undefined;
    if (wire || boundWireUid || boundPinUid) {
      lastWireFocusRef.current = {
        ...(wire || {}),
        wireUid: boundWireUid,
        pinUid: boundPinUid,
        pin: sheetPin || pinFrom || wire?.pin || pinCandidates[0],
        pinFrom: pinFrom || wire?.pinFrom,
        pinTo: pinTo || wire?.pinTo,
        fromCode: fromCode || wire?.fromCode,
        toCode: toCode || wire?.toCode,
        pinCandidates,
        wireColor: wire?.wireColor,
        peerCode: toCode || wire?.peerCode || resolved?.peerCode || ctx.peerCode,
        peerPin: peerPin || pinTo || undefined,
        ends: wireEnds.length ? wireEnds : wire?.ends,
        optionTokens: wire?.optionTokens,
      };
    }

    // Новый клик карточки: сброс pin-miss. Retry / ручной picker — свой бюджет.
    if (!preferredUid && !opts?.fromPinMissRetry) {
      pinMissTriedRef.current = new Set();
      pinViableUidsRef.current = [];
      pinMissBudgetRef.current = hasPinFocus ? 2 : 0;
      setShowAllNodeDiagrams(false);
    }
    if (opts?.manualPick) {
      pinMissBudgetRef.current = 0;
    }

    // Явный UID из списка = ручной выбор / retry после pin-miss; иначе — лист по wireUid карточки.
    let preferred: EwdDiagram | null =
      (preferredUid && ewdDiagrams.find((d) => d.diagramUid === preferredUid)) ||
      (preferredUid
        ? {
            diagramUid: preferredUid,
            title: preferredUid,
            textCodes: [code],
            designFolder: "",
            pathCount: 0,
          }
        : null);
    let lastViableDiags: EwdDiagram[] = [];

    if (!preferred && boundWireUid && !opts?.manualPick) {
      // Локальный exact по уже загруженным diagrams — без ожидания /wire-context.
      // При смене карточки это основной путь (данные узла уже в памяти).
      const localExact = ewdDiagrams.filter((d) => diagramContainsWireUid(d, boundWireUid));
      if (localExact.length) {
        const picked = localExact.length === 1
          ? localExact[0]
          : pickBestDiagram(localExact, ctx).diagram || localExact[0];
        preferred = picked;
        lastViableDiags = localExact;
        pinViableUidsRef.current = localExact.map((d) => d.diagramUid);
        setCardViableDiagrams(localExact);
        setPickBestUid(preferred.diagramUid);
      } else {
        try {
          const contextQs = new URLSearchParams({
            code,
            wireUid: boundWireUid,
            pin: sheetPin || pinFrom || wire?.pin || "",
          });
          if (boundPinUid) contextQs.set("pinUid", boundPinUid);
          if (wire?.wireColor) contextQs.set("color", wire.wireColor);
          const contextPeer = toCode || wire?.peerCode || resolved?.peerCode || ctx.peerCode || "";
          if (contextPeer) contextQs.set("peer", contextPeer);
          if (selectedZone && selectedZone !== "all") contextQs.set("navZone", selectedZone);
          const contextRes = await fetch(`/api/ewd/wire-context?${contextQs}`).then((r) => r.json());
          if (!isCurrentAttempt()) return;
          const exactUids = Array.isArray(contextRes.exactSheets)
            ? contextRes.exactSheets
                .map((sheet: { diagramUid?: string }) => String(sheet.diagramUid || ""))
                .filter(Boolean)
            : [];
          const exactDiagrams = exactUids
            .map((uid: string) => ewdDiagrams.find((diagram) => diagram.diagramUid === uid))
            .filter(Boolean) as EwdDiagram[];
          if (exactDiagrams.length) {
            preferred = exactDiagrams[0];
            lastViableDiags = exactDiagrams;
            pinViableUidsRef.current = exactUids;
            setCardViableDiagrams(exactDiagrams);
            setPickBestUid(preferred.diagramUid);
          } else if (contextRes.status === "no-sheet") {
            setCardViableDiagrams([]);
            setNotice(
              "Точная схема этого провода не подтверждена. «Схемы узла» доступны только как общий контекст.",
            );
            return;
          }
        } catch {
          // Fall back to the existing connectivity picker if provenance is unavailable.
        }
      }
    }

    const applyPickRanked = (pickRes: {
      diagramUid?: string;
      viable?: string[];
      pinOnly?: string[];
      ranked?: Array<{
        diagramUid: string;
        wireHits?: number;
        pinHits?: number;
        onSheetUidCount?: number;
      }>;
      hard?: boolean;
      wireHits?: number;
      confidence?: string;
    }): { pickUid: string; viableDiags: EwdDiagram[]; pinOnlyDiags: EwdDiagram[] } => {
      const viable = Array.isArray(pickRes.viable)
        ? (pickRes.viable as string[]).filter(Boolean)
        : [];
      const pinOnly = Array.isArray(pickRes.pinOnly)
        ? (pickRes.pinOnly as string[]).filter(Boolean)
        : [];
      pinViableUidsRef.current = viable;
      const rankedRows = Array.isArray(pickRes.ranked) ? pickRes.ranked : [];
      const byUid = new Map(rankedRows.map((r) => [r.diagramUid, r]));
      setEwdDiagrams((prev) =>
        prev.map((d) => {
          const r = byUid.get(d.diagramUid);
          if (!r) return { ...d, wireHits: d.wireHits, pinHits: d.pinHits };
          return {
            ...d,
            wireHits: Number(r.wireHits) || 0,
            pinHits: Number(r.pinHits) || 0,
            onSheetUidCount: Number(r.onSheetUidCount) || 0,
          };
        }),
      );
      const toDiag = (uid: string): EwdDiagram => {
        const hit = ewdDiagrams.find((d) => d.diagramUid === uid);
        const r = byUid.get(uid);
        return {
          ...(hit || {
            diagramUid: uid,
            title: uid,
            textCodes: [code],
            designFolder: "",
            pathCount: 0,
          }),
          wireHits: Number(r?.wireHits) || 0,
          pinHits: Number(r?.pinHits) || 0,
          onSheetUidCount: Number(r?.onSheetUidCount) || 0,
        };
      };
      const viableDiags = viable.map(toDiag).filter((d) => {
        if (!boundWireUid) return true;
        return diagramContainsWireUid(d, boundWireUid);
      });
      const pinOnlyDiags = pinOnly.map(toDiag);
      // Default picker list = wire-owned only; pin-only stays available via “Все листы”.
      setCardViableDiagrams(viableDiags);
      lastViableDiags = viableDiags;
      const pickUid =
        Number(pickRes.wireHits) > 0 || pickRes.hard || pickRes.confidence === "wire-owned"
          ? String(pickRes.diagramUid || "")
          : "";
      setPickBestUid(
        pickUid && (!boundWireUid || viableDiags.some((d) => d.diagramUid === pickUid)) ? pickUid : viableDiags[0]?.diagramUid || pickUid,
      );
      return { pickUid, viableDiags, pinOnlyDiags };
    };

    if (!preferred && hasPinFocus && !opts?.manualPick) {
      setNotice("Подбираем схему с этим проводом…");
      const fromCodeN = normalizeCodeLabel(fromCode);
      const probeRaw = diagramsForPinProbe(ewdDiagrams, ctx, 18).filter(
        (r) => !pinMissTriedRef.current.has(r.diagram.diagramUid),
      );
      // Prefer sheets that mention Откуда code (not only Куда module)
      const probe = [...probeRaw].sort((a, b) => {
        if (!fromCodeN || fromCodeN === code) return 0;
        const aHas = diagramHasCode(a.diagram, fromCodeN) ? 1 : 0;
        const bHas = diagramHasCode(b.diagram, fromCodeN) ? 1 : 0;
        return bHas - aHas;
      });
      try {
        const qs = new URLSearchParams({ code });
        // Pick by Откуда pin; peer = Куда (not the other way around)
        const fromPins = [sheetPin, pinFrom, ...pinCandidates].filter(Boolean);
        if (fromPins.length) qs.set("pins", [...new Set(fromPins)].join(","));
        if (wire?.wireColor) qs.set("color", wire.wireColor);
        const peer =
          (fromCode && normalizeCodeLabel(fromCode) !== code
            ? fromCode
            : toCode && normalizeCodeLabel(toCode) !== code
              ? toCode
              : "") ||
          wire?.peerCode ||
          resolved?.peerCode ||
          ctx.peerCode ||
          "";
        if (peer) qs.set("peer", peer);
        if (boundWireUid) qs.set("wireUid", boundWireUid);
        if (boundPinUid) qs.set("pinUid", boundPinUid);
        // Card-level Capital options (e.g. HUMIDSEN) narrow variant sheets for this net.
        const cardOpts = [
          ...new Set([...(wire?.optionTokens || []), ...optionTokens].filter(Boolean)),
        ].slice(0, 12);
        if (cardOpts.length) qs.set("optionTokens", cardOpts.join(","));
        // Probe is additive on server (netOwned ∪ requested) — never replaces netOwned
        if (probe.length) {
          qs.set("diagramUids", probe.map((r) => r.diagram.diagramUid).join(","));
        }
        const pickRes = await fetch(`/api/ewd/pick-diagram?${qs}`).then((r) => r.json());
        if (!isCurrentAttempt()) return;
        const { pickUid, viableDiags } = applyPickRanked(pickRes);
        const preferFromSheet = (d: EwdDiagram | null): EwdDiagram | null => {
          if (boundWireUid || !d || !fromCodeN || fromCodeN === code) return d;
          if (diagramHasCode(d, fromCodeN)) return d;
          const better =
            viableDiags.find(
              (v) =>
                diagramHasCode(v, fromCodeN) && (Number(v.wireHits) || 0) > 0,
            ) || null;
          return better || d;
        };
        const resolveUid = (uid: string): EwdDiagram | null => {
          if (!uid) return null;
          return (
            viableDiags.find((d) => d.diagramUid === uid) ||
            ewdDiagrams.find((d) => d.diagramUid === uid) || {
              diagramUid: uid,
              title: uid,
              textCodes: [code],
              designFolder: "",
              pathCount: 0,
              wireHits: Number(pickRes.wireHits) || 0,
            }
          );
        };
        // Auto-open only wire-owned sheets. Pin-only must not become a contact marker sheet.
        if (pickRes.hard && Number(pickRes.wireHits) > 0 && pickUid) {
          preferred = preferFromSheet(resolveUid(pickUid));
        } else if (boundWireUid || hasPinFocus) {
          setNotice(
            Array.isArray(pickRes.pinOnly) && pickRes.pinOnly.length
              ? "Есть листы, где виден контакт, но провод на схеме не подтверждён. Откройте «Разъём» или выберите лист вручную из полного списка."
              : "Нет схемы, где этот провод есть на листе. Откройте «Разъём» или выберите лист вручную из списка цепи.",
          );
          return;
        }
      } catch {
        if (boundWireUid || hasPinFocus) {
          setNotice("Не удалось подобрать схему для этого провода.");
          return;
        }
      }
    }

    // Без wireUid карточки — только score, никогда слепой ewdDiagrams[0].
    // При фокусе на pin нужен wireHits, чтобы не открыть лист «только с цифрой».
    if (!preferred && !boundWireUid) {
      const picked = pickBestDiagram(ewdDiagrams, ctx);
      preferred =
        picked.diagram && (!hasPinFocus || (Number(picked.diagram.wireHits) || 0) > 0)
          ? picked.diagram
          : null;
      if (!preferred) {
        const ranked = rankDiagramsForContext(ewdDiagrams, ctx);
        preferred =
          ranked.find(
            (r) =>
              r.score > 0 &&
              diagramHasCode(r.diagram, code) &&
              (!hasPinFocus || (Number(r.diagram.wireHits) || 0) > 0),
          )?.diagram ||
          (!hasPinFocus
            ? ranked.find((r) => r.score > 0)?.diagram
            : ranked.find((r) => (Number(r.diagram.wireHits) || 0) > 0)?.diagram) ||
          null;
      }
      if (!preferred && hasPinFocus) {
        setNotice(
          "Нет схемы с этим проводом на листе. Выберите схему вручную из полного списка или откройте «Разъём».",
        );
        return;
      }
    }
    if (!preferred) {
      setNotice(
        boundWireUid
          ? "Нет схемы с этим проводом на листе. Откройте «Разъём» или выберите лист из списка цепи."
          : "Графическая схема EWD для этого узла не найдена.",
      );
      return;
    }
    if (boundWireUid && !diagramContainsWireUid(preferred, boundWireUid)) {
      setNotice(
        "Этот лист не содержит выбранный провод. Выберите «лучшая» или откройте другую карточку цепи.",
      );
      return;
    }
    setPickBestUid(preferred.diagramUid);
    setCapitalPanel(null);
    // Always-on marker: bump showSeq on every click so repeat clicks re-inject + recenter
    showSeqRef.current += 1;
    // Пин фокуса на листах этого узла = sheet-side кавити (не чужой «Откуда» транзита).
    const focusPin = sheetPin || wire?.pin || pinCandidates[0] || undefined;
    const peerTo =
      (fromCode && normalizeCodeLabel(fromCode) !== code
        ? fromCode
        : toCode && normalizeCodeLabel(toCode) !== code
          ? toCode
          : "") ||
      wire?.peerCode ||
      resolved?.peerCode ||
      ctx.peerCode ||
      undefined;
    const hlOpts = [
      ...new Set([...(wire?.optionTokens || []), ...optionTokens].filter(Boolean)),
    ].slice(0, 12);

    // Preflight highlight: только если лист ещё не подтверждён по wireUid.
    // Иначе при смене карточек гоняли N последовательных /highlight — секунды ожидания.
    if (boundWireUid || focusPin) {
      const preferredHasWire =
        !!boundWireUid && diagramContainsWireUid(preferred, boundWireUid);
      if (preferredHasWire) {
        // wire-context / pick уже дали точный лист — открываем сразу.
      } else {
        const tryUids: string[] = [];
        const pushUid = (uid?: string) => {
          const u = String(uid || "").trim();
          if (u && !tryUids.includes(u)) tryUids.push(u);
        };
        pushUid(preferred.diagramUid);
        for (const uid of pinViableUidsRef.current) pushUid(uid);
        for (const d of lastViableDiags) pushUid(d.diagramUid);
        // Не больше 3 кандидатов; preferred первым.
        const capped = tryUids.slice(0, 3).filter((uid) => {
          if (!boundWireUid) return true;
          const meta = ewdDiagrams.find((d) => d.diagramUid === uid);
          return !meta || diagramContainsWireUid(meta, boundWireUid);
        });

        let resolvedSheet: EwdDiagram | null = null;
        // Параллельный probe — раньше ждали каждый /highlight по очереди.
        const probeResults = await Promise.all(
          capped.map(async (uid) => {
            const matched = await probeHighlightMatch({
              code,
              diagramUid: uid,
              pin: focusPin,
              wireColor: wire?.wireColor,
              wireUid: boundWireUid,
              pinUid: boundPinUid,
              peer: peerTo,
              zone: undefined,
              optionTokens: hlOpts,
            });
            return { uid, matched };
          }),
        );
        if (!isCurrentAttempt()) return;
        const hit = probeResults.find((r) => r.matched > 0);
        if (hit) {
          resolvedSheet =
            ewdDiagrams.find((d) => d.diagramUid === hit.uid) || preferred;
        }

        if (resolvedSheet && resolvedSheet.diagramUid !== preferred.diagramUid) {
          preferred = resolvedSheet;
          setPickBestUid(preferred.diagramUid);
        } else if (!resolvedSheet && boundWireUid) {
          // Провод уже на preferred — открываем, даже если probe по цифре кавити провалился.
          if (preferred && diagramContainsWireUid(preferred, boundWireUid)) {
            resolvedSheet = preferred;
          } else {
            setNotice(
              "Провод не найден на подходящем листе для подсветки. Откройте «Разъём» или выберите «лучшая» в списке схем.",
            );
            return;
          }
        }
      }
    }

    if (!isCurrentAttempt()) return;
    const openMeta =
      ewdDiagrams.find((d) => d.diagramUid === preferred.diagramUid) || preferred;
    const openConfidence = schemeConfidenceForDiagram(openMeta);
    // startTransition: клик по карточке остаётся отзывчивым, пока парсится тяжёлый SVG.
    startTransition(() => {
      setActiveSvg({
        diagramUid: preferred.diagramUid,
        searchCode: code,
        title: String(openMeta.title || "").trim() || undefined,
        systemName: String(openMeta.systemName || "").trim() || undefined,
        confidence: openConfidence,
        objectIds: diagramScopedUids(preferred, ewdObjectIds),
        pin: focusPin,
        pinCandidates: focusPin
          ? [focusPin, ...pinCandidates.filter((p) => p !== focusPin)]
          : pinCandidates,
        pinFrom: pinFrom || wire?.pinFrom || resolved?.pinFrom,
        pinTo: pinTo || wire?.pinTo || resolved?.pinTo,
        fromCode: fromCode || undefined,
        toCode: toCode || undefined,
        ends: wireEnds.length ? wireEnds : undefined,
        wireColor: wire?.wireColor,
        wireUid: boundWireUid,
        pinUid: boundPinUid,
        peerCode: peerTo,
        peerPin: peerPin || pinTo || undefined,
        zone: undefined,
        optionTokens,
        showSeq: showSeqRef.current,
      });
    });
    // Signal tracer: соседние GlobalSignals для кавити выбранного узла (sheetPin).
    const pinForTrace = focusPin || pinCandidates[0] || "";
    if (pinForTrace) {
      const tqs = new URLSearchParams({ code, pin: pinForTrace });
      if (optionTokens.length) tqs.set("optionTokens", optionTokens.join(","));
      fetch(`/api/ewd/trace?${tqs}`)
        .then((r) => r.json())
        .then((data) => {
          if (!isCurrentAttempt()) return;
          if (!data?.uid) {
            setTraceInfo(null);
            return;
          }
          setTraceInfo({
            uid: String(data.uid),
            signalFile: data.signalFile || null,
            siblingCount: Number(data.siblingCount) || 0,
            diagrams: Array.isArray(data.diagrams) ? data.diagrams : [],
          });
        })
        .catch(() => {
          if (isCurrentAttempt()) setTraceInfo(null);
        });
    } else {
      setTraceInfo(null);
    }
    setNotice("");
    if (isMobileViewport()) setMobileView("scheme");
  }

  async function loadWires(code: string, zone = selectedZone, opts?: { ignoreZone?: boolean }) {
    if (!code) return;
    if (!requireVehicleMin()) return;
    const attemptId = ++ewdAttemptRef.current;
    const isCurrentAttempt = () => ewdAttemptRef.current === attemptId;
    const useZone = opts?.ignoreZone ? "all" : zone;
    setMode("search");
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
    setEwdSheetUids(new Set());
    setEwdSystems([]);
    setTraceInfo(null);
    setSystemsOpen(false);
    setWireColorFilter(null);
    setSchemeContext(null);
    setNodeInfo(null);
    setMobileView("cards");
    setCapitalPanel(null);
    setActiveSvg(null);
    setSelectedPinState(null);
    setLoading(true);
    setNotice(`Загружаем ${code}…`);
    try {
      const params = new URLSearchParams({ code });
      if (useZone && useZone !== "all") params.set("zone", useZone);
      // Physical nav zone scopes cards only. EWD sheet ownership is global for the wire.
      const ewdQs = new URLSearchParams({ code });
      const sysQs = new URLSearchParams({ code });
      const [data, ewdData, sysData] = await Promise.all([
        fetch(`/api/nav/wires?${params}`).then((r) => r.json()),
        fetch(`/api/ewd/diagrams?${ewdQs}`).then((r) => r.json()).catch(() => ({ diagrams: [], objectIds: [], sheetUids: [] })),
        fetch(`/api/ewd/systems?${sysQs}`).then((r) => r.json()).catch(() => ({ systems: [] })),
      ]);
      if (!isCurrentAttempt()) return;
      let ownerRaw = Array.isArray(data.owner_wires) ? data.owner_wires : [];
      let transitRaw = Array.isArray(data.transit_wires) ? data.transit_wires : [];
      let zoneEmptyFallback = false;
      let infoSource = data;
      // Zone filter emptied results — offer / auto-check unscoped wires
      if (!ownerRaw.length && !transitRaw.length && useZone && useZone !== "all" && !opts?.ignoreZone) {
        const unscoped = await fetch(`/api/nav/wires?code=${encodeURIComponent(code)}`).then((r) => r.json());
        if (!isCurrentAttempt()) return;
        const uOwner = Array.isArray(unscoped.owner_wires) ? unscoped.owner_wires : [];
        const uTransit = Array.isArray(unscoped.transit_wires) ? unscoped.transit_wires : [];
        if (uOwner.length || uTransit.length) {
          zoneEmptyFallback = true;
          infoSource = unscoped;
        }
      }
      const ewdDiags = Array.isArray(ewdData.diagrams) ? (ewdData.diagrams as EwdDiagram[]) : [];
      const objectIds = Array.isArray(ewdData.objectIds) ? (ewdData.objectIds as string[]) : [];
      const sheetFromApi = Array.isArray(ewdData.sheetUids) ? (ewdData.sheetUids as string[]) : [];
      const sheetSet = new Set<string>(sheetFromApi.filter(Boolean));
      if (!sheetSet.size) {
        for (const d of ewdDiags) {
          for (const u of d.onSheetUids || []) if (u) sheetSet.add(u);
          for (const g of d.groups || []) for (const u of g.uids || []) if (u) sheetSet.add(u);
        }
      }
      setEwdSheetUids(sheetSet);
      const codeCtx = extractSchemeContext(null, code);
      const preferredDiagram = pickBestDiagram(ewdDiags, codeCtx).diagram;
      const epQs = new URLSearchParams({ code });
      if (preferredDiagram?.diagramUid) epQs.set("diagramUid", preferredDiagram.diagramUid);
      if (optionTokens.length) epQs.set("optionTokens", optionTokens.join(","));
      const epData = await fetch(`/api/ewd/endpoints?${epQs}`)
        .then((r) => r.json())
        .catch(() => ({ endpoints: [] }));
      if (!isCurrentAttempt()) return;
      const endpoints = Array.isArray(epData.endpoints) ? (epData.endpoints as EwdEndpoint[]) : [];
      const mergedOwner = mergeEwdEndpoints(ownerRaw, endpoints, code);
      const mergedTransit = mergeEwdEndpoints(transitRaw, endpoints, code);
      setOwnerWires(mergedOwner);
      setTransitWires(mergedTransit);
      // Nav/SQLite card wire_uids may be absent from pin_wire_index — score sheets by onSheetUids too.
      const cardWireUids = [
        ...new Set(
          [...mergedOwner, ...mergedTransit]
            .map((w) => String(w.wire_uid || "").trim())
            .filter(Boolean),
        ),
      ];
      const scoredDiags = ewdDiags.map((d) => {
        const sheet = new Set<string>([
          ...(d.onSheetUids || []),
          ...((d.groups || []).flatMap((g) => g.uids || [])),
        ]);
        const cardUidHits = cardWireUids.filter((u) => sheet.has(u)).length;
        const wireHits = Number(d.wireHits) || 0;
        const pinHits = Number(d.pinHits) || 0;
        return {
          ...d,
          wireHits,
          pinHits,
          onSheetUidCount: Math.max(Number(d.onSheetUidCount) || 0, cardUidHits),
          confidence: schemeConfidenceForDiagram({ wireHits, pinHits }),
        };
      });
      setEwdDiagrams(scoredDiags);
      setEwdObjectIds(objectIds);
      // Per-wire picker list fills only after a card click (pick-diagram). Until then show all node sheets.
      setCardViableDiagrams([]);
      setPickBestUid("");
      setShowAllNodeDiagrams(false);
      lastWireFocusRef.current = null;
      // Systems: keep API wire-owned, plus designs of sheets that hold card wires.
      const apiViableUids = new Set<string>(
        Array.isArray(ewdData.viable) ? (ewdData.viable as string[]) : [],
      );
      const nodeViableDiags = scoredDiags.filter((d) => apiViableUids.has(d.diagramUid));
      const sysRows = Array.isArray(sysData.systems) ? (sysData.systems as EwdSystemRow[]) : [];
      const cardDesigns = new Set(
        nodeViableDiags.map((d) => d.designFolder).filter(Boolean),
      );
      const systemsMerged = sysRows.map((s) => ({
        ...s,
        wireOwned: Boolean(s.wireOwned) || cardDesigns.has(s.systemUid),
        confidence: (Boolean(s.wireOwned) || cardDesigns.has(s.systemUid)
          ? "wire-owned"
          : s.confidence || "text-only") as SchemeConfidence,
      }));
      // If API omitted a design that holds a card wire, synthesize a row from diagrams.
      for (const d of nodeViableDiags) {
        if (!d.designFolder || systemsMerged.some((s) => s.systemUid === d.designFolder)) continue;
        systemsMerged.push({
          systemUid: d.designFolder,
          name: d.systemName || d.title || d.designFolder,
          diagramUids: [d.diagramUid],
          diagramCount: 1,
          wireOwned: true,
          confidence: "wire-owned",
        });
      }
      setEwdSystems(
        systemsMerged
          .filter((s) => s.wireOwned)
          .sort((a, b) => a.name.localeCompare(b.name) || a.systemUid.localeCompare(b.systemUid)),
      );
      const pinCount = infoSource.pin_count || {
        owner: ownerRaw.length,
        transit: transitRaw.length,
        total: ownerRaw.length + transitRaw.length,
      };
      const nodeParts: CardParts = {
        code,
        device: String(infoSource.device_part_number || "").trim() || undefined,
        housing: String(infoSource.part_number || "").trim() || undefined,
        mate: String(infoSource.part_number_mate || "").trim() || undefined,
        repair: infoSource.repair && typeof infoSource.repair === "object"
          ? (infoSource.repair as RepairCatalogResult)
          : undefined,
      };
      setNodeInfo({
        code,
        name_ru: String(infoSource.name_ru || ""),
        pin_count: {
          owner: Number(pinCount.owner) || ownerRaw.length,
          transit: Number(pinCount.transit) || transitRaw.length,
          total: Number(pinCount.total) || ownerRaw.length + transitRaw.length,
        },
        wire_gauges: Array.isArray(infoSource.wire_gauges)
          ? infoSource.wire_gauges.map(String)
          : [],
        zoneEmptyFallback,
        parts: hasCardParts(nodeParts) ? nodeParts : undefined,
      });
      const n = ownerRaw.length + transitRaw.length;
      const nameRu = String(infoSource.name_ru || "").trim();
      const codeLabel = nameRu ? `${code} — ${nameRu}` : code;
      if (zoneEmptyFallback) {
        setNotice(
          `Нет контактов в выбранной зоне для ${codeLabel}. Есть данные вне зоны — нажмите «Показать во всех зонах».`,
        );
      } else {
        setNotice(
          n || ewdDiags.length
            ? `${codeLabel}: ${nodeViableDiags.length || ewdDiags.length} схем с проводом · ${ewdDiags.length} листов · ${ownerRaw.length} своих · ${transitRaw.length} транзитных`
            : `Для ${codeLabel} ничего не найдено`,
        );
      }
    } catch {
      if (!isCurrentAttempt()) return;
      setOwnerWires([]);
      setTransitWires([]);
      setEwdDiagrams([]);
      setEwdObjectIds([]);
      setEwdSheetUids(new Set());
      setNodeInfo(null);
      setNotice("Ошибка загрузки контактов");
    } finally {
      if (isCurrentAttempt()) setLoading(false);
    }
  }

  // Closed site: maintenance for everyone on the main app (including admins).
  // Admin panel stays at /admin; API still allows admin session there.
  if (siteOpen !== true) {
    return <MaintenancePage pending={siteOpen === null} />;
  }

  const cardCtx = {
    zone: selectedZone,
    code: selectedCode,
    model: selectedModel,
    year: selectedYear,
    engine: selectedEngine,
    optionTokens,
  };

  const zoneSummaryLabel =
    selectedZone && selectedZone !== "all"
      ? zones.find((z) => z.id === selectedZone)?.label || selectedZone
      : "";
  const filterActiveCount = [
    selectedModel,
    selectedYear,
    selectedEngine,
    selectedTransmission,
    selectedZone && selectedZone !== "all" ? selectedZone : "",
    selectedCode,
    vinInput || vinLocked ? "vin" : "",
  ].filter(Boolean).length;

  const closeFiltersSheet = () => setFiltersSheetOpen(false);
  const closeToolsSheet = () => setToolsSheetOpen(false);
  const resetFiltersSheet = () => {
    setVinLocked(false);
    setVinInput("");
    setVinNotice("");
    setSelectedModel("");
    setSelectedYear("");
    setSelectedEngine("");
    setSelectedTransmission("");
    setSelectedZone("all");
    setSelectedCode("");
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
    setEwdSheetUids(new Set());
    setNodeInfo(null);
    setMode(null);
    setCapitalPanel(null);
    setActiveSvg(null);
    setSelectedPinState(null);
    setSchemeContext(null);
    setNotice("");
    setVehicleConfigured(false);
  };

  const vehicleQuickFields = (
    <>
      <label className="app-bar__quick-field">
        <span>Модель</span>
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
      <label className="app-bar__quick-field">
        <span>Год</span>
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
      <label className="app-bar__quick-field">
        <span>Двиг.</span>
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
          {available.engineOptions.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
      </label>
      <label className="app-bar__quick-field">
        <span>КПП</span>
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
          <option value="">Все</option>
          {available.transmissions.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </label>
    </>
  );

  const navQuickFields = features.navBrowse ? (
    <>
      <label className="app-bar__quick-field app-bar__quick-field--grow">
        <span>Зона</span>
        <select
          data-testid="nav-zone"
          className="app-input rounded px-1.5 py-1"
          value={selectedZone}
          onChange={(e) => {
            setSelectedZone(e.target.value);
            setSelectedCode("");
            setOwnerWires([]);
            setTransitWires([]);
            setEwdDiagrams([]);
            setNodeInfo(null);
            setMode(null);
            setCapitalPanel(null);
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
      <label className="app-bar__quick-field app-bar__quick-field--wide">
        <span>Узел</span>
        <select
          data-testid="nav-component"
          className="app-input rounded px-1.5 py-1"
          value={selectedCode}
          onChange={(e) => {
            setSelectedCode(e.target.value);
          }}
        >
          <option value="">Узел…</option>
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
      </label>
    </>
  ) : null;

  /** Compact theme switch, styled like the brand wordmark and shared by mobile and desktop headers. */
  const themeInlineControl = (
    <div className="app-bar__theme-inline" role="group" aria-label="Тема">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          data-testid={`theme-inline-${t.id}`}
          className={theme === t.id ? "app-bar__theme-inline-btn is-active" : "app-bar__theme-inline-btn"}
          title={`Тема: ${t.label}`}
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const pushControls = (
    <>
      {pushState === "unsupported" || pushState === "unavailable" ? null : (
        <button
          type="button"
          data-testid="push-opt-in"
          disabled={pushBusy || pushState === "pending"}
          className={`md-chip ${pushState === "on" ? "md-chip--accent" : ""}`}
          title={
            pushState === "on"
              ? "Отключить уведомления об обновлениях сайта"
              : "Получать пуш, когда сайт обновится"
          }
          onClick={() => {
            void (async () => {
              setPushBusy(true);
              setPushState("pending");
              try {
                if (pushState === "on") {
                  const r = await disablePushNotifications();
                  setPushState("off");
                  setNotice(r.ok ? "Уведомления об обновлениях выключены" : r.error);
                } else {
                  const r = await enablePushNotifications();
                  if (r.ok) {
                    setPushState("on");
                    setNotice("Будем сообщать об обновлениях");
                  } else {
                    setPushState(await getPushUiState());
                    setNotice(r.error);
                  }
                }
              } finally {
                setPushBusy(false);
              }
            })();
          }}
        >
          {pushState === "on" ? "Уведомления · вкл" : pushBusy || pushState === "pending" ? "…" : "Уведомления"}
        </button>
      )}
    </>
  );

  const vinControls = features.vinSearch ? (
    <div className="vin-controls flex flex-col gap-1 min-w-0 w-full basis-full" data-testid="vin-controls">
      <div className="flex flex-nowrap items-center gap-2 min-w-0 w-full">
        <span className="text-[var(--muted)] shrink-0">VIN</span>
        <input
          data-testid="vehicle-vin"
          className="app-input rounded px-1.5 py-1 font-mono tracking-wider flex-1 min-w-0"
          maxLength={17}
          placeholder="17 символов"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          name="ewd-vin"
          value={vinInput}
          onChange={(e) => {
            setVinInput(e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17));
            setVinNotice("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void applyVin();
          }}
        />
        <button
          type="button"
          data-testid="vin-decode-btn"
          className="md-btn md-btn--tonal text-[11px] px-2 py-1 shrink-0"
          onClick={() => void applyVin()}
        >
          По VIN
        </button>
      </div>
      {(vinInput || vinLocked) ? (
        <div className="flex flex-nowrap items-center gap-2">
          <button
            type="button"
            data-testid="vin-clear-btn"
            className="md-btn md-btn--text text-[11px] px-2 py-1 shrink-0"
            onClick={clearVin}
          >
            Сброс VIN
          </button>
          {vinLocked ? <span className="md-chip shrink-0" data-testid="vin-chip">из VIN</span> : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const dtcControls = features.dtcSearch ? (
    <section className="app-card rounded-lg border p-2.5 space-y-2 shadow-sm" data-testid="dtc-search">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Коды ошибок DTC / OBD</h2>
      <div className="flex flex-nowrap items-center gap-2 min-w-0">
        <input
          data-testid="dtc-query"
          className="app-input rounded px-2 py-1.5 text-xs font-mono flex-1 min-w-0"
          placeholder="ABS-0010, CEM-1A05, P0563, датчик колеса…"
          value={dtcQuery}
          onChange={(e) => setDtcQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void searchDtc();
          }}
        />
        <button
          type="button"
          data-testid="dtc-search-btn"
          className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5 shrink-0"
          onClick={() => void searchDtc()}
          disabled={dtcLoading}
        >
          {dtcLoading ? "…" : "Найти"}
        </button>
        <button
          type="button"
          data-testid="dtc-clear-btn"
          className="md-btn md-btn--text text-[11px] px-2.5 py-1.5 shrink-0"
          onClick={clearDtc}
          disabled={!dtcQuery && !dtcResults.length && mode !== "dtc"}
        >
          Сброс
        </button>
      </div>
      {dtcNotice ? (
        <p data-testid="dtc-notice" className="text-[11px] text-[var(--muted)]">{dtcNotice}</p>
      ) : null}
    </section>
  ) : null;

  /** Desktop popover / extras: push, VIN, DTC (vehicle+nav live in the app-bar strip; theme lives next to the brand). */
  const filterPopoverControls = (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pushControls}
        {vinControls}
      </div>
      {vinNotice ? (
        <p data-testid="vin-notice" className="text-[11px] text-[var(--muted)] -mt-1">{vinNotice}</p>
      ) : null}
      {dtcControls}
    </>
  );

  /** Mobile sheet: full set. */
  const filterControls = (
    <>
      <div
        className="mobile-vehicle-filters"
        data-testid="mobile-vehicle-filters"
        aria-label="Параметры автомобиля"
      >
        {vehicleQuickFields}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pushControls}
        {vinControls}
        {selectedModel && selectedYear && (
          <span className="md-chip md-chip--accent ml-auto" data-testid="vehicle-chip">
            {selectedModel} · {selectedYear}
            {selectedEngine ? ` · ${selectedEngine}` : ""}
            {selectedTransmission ? ` · ${selectedTransmission}` : ""}
          </span>
        )}
      </div>
      {vinNotice ? (
        <p data-testid="vin-notice" className="text-[11px] text-[var(--muted)] -mt-1">{vinNotice}</p>
      ) : null}
      {features.navBrowse ? (
        <section className="app-card rounded-lg border p-2.5 space-y-2 shadow-sm">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Навигация по узлам</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 app-bar__quick-filters--stacked">
            {navQuickFields}
          </div>
          <p className="text-[10px] text-[var(--text-muted)] leading-tight">
            Пометки: [схема]=графика EWD · [контакты]=FaceView / полость
          </p>
        </section>
      ) : null}
      {dtcControls}
    </>
  );

  /* OBD test surface (button + floating panel) temporarily moved to the admin
     page (tab "OBD") while it's being tuned — see AdminPage.tsx. Restore here
     once it's ready for public use again. */

  return <main className={`app-shell app-shell--viewport overflow-hidden flex flex-col${anySheetOpen ? " is-filters-sheet-open" : ""}`}>
    <InstallAppBanner />
    <div className="desktop-bg-art" aria-hidden="true">
      <div className="desktop-bg-art__piece desktop-bg-art__piece--a" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--b" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--c" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--e" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--f" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--g" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--h" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--i" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--j" />
      <div className="desktop-bg-art__piece desktop-bg-art__piece--k" />
    </div>
    <header
      ref={headerRef}
      className={`app-panel app-bar shrink-0 border-b px-3 py-2${
        !isMobileUi && desktopFiltersCollapsed ? " is-filters-collapsed" : ""
      }`}
    >
      <div
        className={`app-bar__chrome mx-auto max-w-7xl flex items-center gap-2${
          isMobileUi ? "" : " app-bar__chrome--desktop min-h-[48px]"
        }`}
      >
        <button
          ref={filtersToggleRef}
          type="button"
          className="mobile-filters-toggle md-btn md-btn--tonal"
          data-testid="mobile-filters-toggle"
          aria-expanded={filtersSheetOpen}
          aria-controls="filters-sheet"
          aria-haspopup="dialog"
          aria-label={filtersSheetOpen ? "Закрыть меню" : "Открыть меню фильтров"}
          onClick={() => {
            setToolsSheetOpen(false);
            setFiltersSheetOpen((v) => !v);
          }}
        >
          <span className="mobile-filters-toggle__icon" aria-hidden="true">☰</span>
          <span className="mobile-filters-toggle__label">Меню</span>
          {filterActiveCount > 0 ? (
            <span className="mobile-filters-toggle__badge" data-testid="filters-active-count">
              {filterActiveCount}
            </span>
          ) : null}
        </button>
        <div className="app-bar__brand-group shrink-0">
          <span className="font-semibold text-[var(--accent)] tracking-wide app-bar__brand">Volvo EWD</span>
          {themeInlineControl}
        </div>
        {!isMobileUi ? (
          <div
            id="desktop-quick-filters"
            className="app-bar__desktop-cluster"
            data-testid="desktop-quick-filters"
            aria-label="Быстрые фильтры"
          >
            <div className="app-bar__quick-grid">
              <div className="app-bar__quick-grid-row">
                <div className="desktop-filters-popover">
                  <button
                    ref={desktopFiltersBtnRef}
                    type="button"
                    className="desktop-filters-collapse md-btn md-btn--tonal text-[11px] px-2.5 py-1.5"
                    data-testid="filters-collapse"
                    aria-expanded={filtersPopoverOpen}
                    aria-controls="desktop-filters-popover-panel"
                    aria-haspopup="dialog"
                    title={filtersPopoverOpen ? "Закрыть" : "VIN, DTC, уведомления"}
                    onClick={() => {
                      if (filtersPopoverOpen) setFiltersPopoverOpen(false);
                      else openDesktopFiltersPopover();
                    }}
                  >
                    Доп. {filtersPopoverOpen ? "▴" : "▾"}
                  </button>
                </div>
                {!desktopFiltersCollapsed ? vehicleQuickFields : null}
                <button
                  type="button"
                  className={`app-bar__plank-collapse md-btn md-btn--tonal${
                    desktopFiltersCollapsed ? " obd-btn--live" : ""
                  }`}
                  data-testid="desktop-plank-collapse"
                  aria-expanded={!desktopFiltersCollapsed}
                  aria-controls="desktop-quick-filters"
                  title={desktopFiltersCollapsed ? "Развернуть фильтры" : "Свернуть фильтры"}
                  aria-label={desktopFiltersCollapsed ? "Развернуть фильтры" : "Свернуть фильтры"}
                  onClick={() => setDesktopFiltersCollapsed((v) => !v)}
                >
                  {desktopFiltersCollapsed ? (
                    <>
                      Фильтры <span aria-hidden="true">▾</span>
                      {filterActiveCount > 0 ? (
                        <span className="desktop-filters-collapse__badge" aria-hidden>
                          {filterActiveCount}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span aria-hidden="true">▴</span>
                  )}
                </button>
              </div>
              {!desktopFiltersCollapsed ? (
                <div className="app-bar__quick-grid-row app-bar__quick-grid-row--fill">{navQuickFields}</div>
              ) : null}
            </div>
          </div>
        ) : null}
        {selectedCode ? (
          <button
            type="button"
            className="app-bar__code-chip md-chip md-chip--accent font-mono"
            data-testid="app-bar-code-chip"
            title="Параметры узла"
            onClick={() => {
              setFiltersSheetOpen(false);
              setFiltersPopoverOpen(false);
              setToolsSheetOpen(true);
            }}
          >
            {selectedCode}
          </button>
        ) : null}
      </div>
      {isMobileUi && (selectedModel || zoneSummaryLabel) && !selectedCode ? (
        <div
          className="app-bar__summary mx-auto max-w-7xl"
          data-testid="filters-summary-chips"
          aria-label="Активные фильтры"
        >
          {selectedModel && selectedYear ? (
            <span className="md-chip md-chip--accent">
              {selectedModel} · {selectedYear}
              {selectedEngine ? ` · ${selectedEngine}` : ""}
              {selectedTransmission ? ` · ${selectedTransmission}` : ""}
            </span>
          ) : selectedModel ? (
            <span className="md-chip md-chip--accent">{selectedModel}</span>
          ) : null}
          {zoneSummaryLabel ? <span className="md-chip">{zoneSummaryLabel}</span> : null}
        </div>
      ) : null}
    </header>

    {/*
      Mobile filter mount only (bottom sheet).
      Desktop: popover under «Фильтры» in the app bar.
    */}
    <div
      className={`filters-host${filtersSheetOpen ? " is-sheet-open" : ""}`}
      data-testid="filters-host"
      aria-hidden={!isMobileUi ? true : undefined}
    >
      <div className="filters-bg-art" aria-hidden="true">
        <div className="filters-bg-art__piece filters-bg-art__piece--a" />
        <div className="filters-bg-art__piece filters-bg-art__piece--b" />
        <div className="filters-bg-art__piece filters-bg-art__piece--c" />
        <div className="filters-bg-art__piece filters-bg-art__piece--d" />
      </div>
      <button
        type="button"
        className="filters-sheet__backdrop"
        aria-label="Закрыть фильтры"
        tabIndex={filtersSheetOpen ? 0 : -1}
        onClick={closeFiltersSheet}
      />
      <div
        ref={filtersSheetRef}
        id="filters-sheet"
        className="filters-sheet"
        role={filtersSheetOpen ? "dialog" : undefined}
        aria-modal={filtersSheetOpen ? true : undefined}
        aria-labelledby="filters-sheet-title"
        data-testid="filters-sheet"
      >
        <div
          className="filters-sheet__handle"
          aria-hidden="true"
          data-testid="filters-sheet-handle"
          onTouchStart={onSheetSwipeStart}
          onTouchEnd={onSheetSwipeEnd}
        />
        <div
          className="filters-sheet__header"
          onTouchStart={onSheetSwipeStart}
          onTouchEnd={onSheetSwipeEnd}
        >
          <h2 id="filters-sheet-title" className="filters-sheet__title">Параметры поиска</h2>
          <button
            type="button"
            className="md-btn md-btn--text filters-sheet__close"
            data-testid="filters-sheet-close"
            aria-label="Закрыть"
            onClick={closeFiltersSheet}
          >
            ✕
          </button>
        </div>
        <div
          ref={filtersSheetBodyRef}
          className="filters-sheet__body app-panel__filters flex flex-col gap-2"
        >
          {isMobileUi ? filterControls : null}
        </div>
        <div className="filters-sheet__footer">
          <button
            type="button"
            className="md-btn md-btn--text"
            data-testid="filters-sheet-reset"
            onClick={resetFiltersSheet}
          >
            Сбросить
          </button>
          <button
            type="button"
            className="md-btn md-btn--filled filters-sheet__apply"
            data-testid="filters-sheet-apply"
            onClick={closeFiltersSheet}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-hidden">
    {mode === "dtc" ? (
      <section data-testid="dtc-results-panel" className="h-full mx-auto max-w-7xl px-3 py-2 flex flex-col min-h-0">
        <div className="mb-1 flex justify-between shrink-0 text-xs">
          <p className="text-[var(--text-muted)]">{dtcLoading ? "Ищем…" : dtcNotice}</p>
          <button type="button" className="md-btn md-btn--text text-[var(--text-muted)]" onClick={clearDtc}>Очистить</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-4" data-mobile-scroll>
          {dtcResults.map((row) => (
            <article
              key={`${row.code}-${row.title_ru.slice(0, 24)}`}
              className="app-card rounded-lg border px-3 py-2.5 shadow-sm"
              data-testid="dtc-result"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono font-semibold text-[var(--accent)] text-sm">{row.code}</span>
                {row.obd_code ? (
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">OBD {row.obd_code}</span>
                ) : null}
                {row.ecu ? (
                  <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{row.ecu}</span>
                ) : null}
                {row.variants > 1 ? (
                  <span className="text-[10px] text-[var(--text-muted)]">вариантов: {row.variants}</span>
                ) : null}
              </div>
              <p className="text-sm text-[var(--text-main)] mt-1 leading-snug">
                {row.title_ru || row.title_en || "—"}
              </p>
              {row.title_ru && row.title_en ? (
                <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-snug">{row.title_en}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="md-btn md-btn--text text-[11px] text-[var(--accent)]"
                  onClick={() => void toggleDtcDetails(row.code)}
                >
                  {dtcOpenCode === row.code ? "Скрыть детали" : "Подробнее"}
                </button>
                {dtcDetailsLoadingCode === row.code ? (
                  <span className="text-[11px] text-[var(--text-muted)]">Загружаем варианты…</span>
                ) : null}
              </div>
              {dtcOpenCode === row.code ? (
                <div className="mt-2 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] p-2 text-[11px]">
                  <p className="mb-2 text-[var(--text-muted)]">
                    {describeDtcVariants(row.variants)}
                  </p>
                  {dtcDetailsByCode[row.code]?.matched_by === "obd_code" ? (
                    <p className="text-[var(--text-muted)] mb-2">
                      Точное совпадение найдено по OBD-алиасу, не по Volvo-коду.
                    </p>
                  ) : null}
                  <dl className="mb-2 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Основной RU title</dt>
                      <dd className="text-[var(--text-main)]">{row.title_ru || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">EN title</dt>
                      <dd className="text-[var(--text-main)]">{row.title_en || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">ECU</dt>
                      <dd className="text-[var(--text-main)]">{row.ecu || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">OBD alias</dt>
                      <dd className="text-[var(--text-main)]">{row.obd_code || "—"}</dd>
                    </div>
                  </dl>
                  {dtcDetailsByCode[row.code]?.entries?.length ? (
                    <div className="space-y-2">
                      {dtcDetailsByCode[row.code]!.entries.map((entry, index) => (
                        <div key={`${entry.ie_id}-${index}`} className="rounded border border-[var(--border-color)] bg-[var(--bg-card)] px-2 py-1.5">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-medium text-[var(--text-main)]">Вариант {index + 1}</span>
                            {entry.fault_state ? (
                              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                {faultStateLabel(entry.fault_state)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[var(--text-main)]">{entry.title_ru || entry.title_en || "—"}</p>
                          {entry.title_ru && entry.title_en ? (
                            <p className="mt-1 text-[var(--text-muted)]">{entry.title_en}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : dtcDetailsLoadingCode === row.code ? null : (
                    <p className="text-[var(--text-muted)]">Детали вариантов недоступны.</p>
                  )}
                </div>
              ) : null}
            </article>
          ))}
          {!dtcLoading && !dtcResults.length ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">Результатов нет</p>
          ) : null}
        </div>
      </section>
    ) : mode ? <section data-testid="results-panel" className="h-full mx-auto max-w-7xl px-3 py-2 flex flex-col min-h-0">
      <div className="results-notice-row mb-1 flex justify-between shrink-0 text-xs">
        <p data-testid="results-notice" className="text-[var(--text-muted)] truncate">{loading ? notice || "Загрузка…" : notice}</p>
        <button type="button" data-testid="clear-results" className="text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0" onClick={clear}>Очистить</button>
      </div>
      <div className="mobile-browse-bar" data-testid="mobile-browse-bar">
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
            Схема
          </button>
        </div>
        <button
          type="button"
          className={`mobile-tools-btn md-btn md-btn--tonal${wireColorFilter ? " is-active" : ""}`}
          data-testid="mobile-tools-btn"
          aria-expanded={toolsSheetOpen}
          aria-controls="cards-column-sticky"
          onClick={() => {
            setFiltersSheetOpen(false);
            setToolsSheetOpen((v) => !v);
          }}
        >
          {wireColorFilter ? `Цвет ${wireColorFilter}` : "Узел"}
        </button>
        <button
          type="button"
          className="mobile-tools-btn md-btn md-btn--text"
          data-testid="mobile-clear-results"
          aria-label="Очистить"
          onClick={clear}
        >
          ✕
        </button>
      </div>
      <div
        className={`results-split flex-1 min-h-0 grid grid-rows-1 gap-3 ${
          rightOpen ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1"
        }`}
      >
      <div
        data-testid="cards-column"
        data-mobile-scroll
        className={`mobile-pane mobile-pane--cards cards-column ${rightOpen ? "lg:col-span-5" : "max-w-3xl mx-auto w-full"} flex flex-col min-h-0 min-w-0 h-full overflow-hidden pr-1${
          mobileView === "scheme" && rightOpen ? " is-mobile-hidden" : ""
        }`}
      >
      {/* Outside scrollport: mobile bottom-sheet uses position:fixed; fixed inside overflow
          creates a containing block and cards scroll through the sheet (overlap). */}
      <details
        data-testid="cards-column-sticky"
        className="cards-column__sticky cards-column__chrome mobile-node-tools shrink-0"
        open={isMobileUi ? toolsSheetOpen : true}
        onToggle={(e) => {
          if (!isMobileUi) return;
          const next = (e.currentTarget as HTMLDetailsElement).open;
          if (next !== toolsSheetOpen) setToolsSheetOpen(next);
        }}
      >
        <summary className="mobile-node-tools__summary">
          <span className="mobile-node-tools__summary-title">
            {selectedCode ? `${selectedCode} · цвета и схемы` : "Параметры узла"}
          </span>
          <button
            type="button"
            className="mobile-node-tools__summary-close"
            aria-label="Закрыть"
            onClick={(e) => {
              e.preventDefault();
              setToolsSheetOpen(false);
            }}
          >
            ✕
          </button>
        </summary>
        <button
          type="button"
          className="mobile-node-tools__backdrop"
          aria-label="Закрыть параметры узла"
          tabIndex={toolsSheetOpen ? 0 : -1}
          onClick={() => setToolsSheetOpen(false)}
        />
        <div className="mobile-node-tools__panel space-y-2">
      {nodeInfo ? (
        <aside data-testid="node-info-banner" className="md-info-banner app-card border rounded-xl px-3 py-2.5 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono font-semibold text-[var(--accent)] text-sm">{nodeInfo.code}</span>
            {nodeInfo.name_ru ? (
              <span className="text-xs text-[var(--text-main)]">{nodeInfo.name_ru}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
            <span>
              Контакты: <span className="text-[var(--text-main)]">{nodeInfo.pin_count.owner}</span>
              {import.meta.env.DEV && nodeInfo.pin_count.transit ? (
                <> · транзит: <span className="text-[var(--text-main)]">{nodeInfo.pin_count.transit}</span></>
              ) : null}
            </span>
            {nodeInfo.wire_gauges.length ? (
              <span>
                Сечения:{" "}
                <span className="font-mono text-[var(--text-main)]">
                  {nodeInfo.wire_gauges.map((g) => `${g} мм²`).join(", ")}
                </span>
              </span>
            ) : null}
          </div>
          {nodeInfo.parts ? (
            <>
              <RepairCatalogBlock
                repair={nodeInfo.parts.repair}
                testId="node-repair"
                setNotice={setNotice}
              />
              <PartsCatalogList
                parts={nodeInfo.parts}
                testId="node-parts"
                setNotice={setNotice}
                className="parts-catalog parts-catalog--card parts-catalog--node"
              />
            </>
          ) : null}
          {nodeInfo.zoneEmptyFallback ? (
            <button
              type="button"
              data-testid="show-all-zones-btn"
              className="md-btn md-btn--tonal text-[11px] px-2.5 py-1.5 mt-1"
              onClick={() => void loadWires(nodeInfo.code, selectedZone, { ignoreZone: true })}
            >
              Показать во всех зонах
            </button>
          ) : null}
        </aside>
      ) : null}
      <div data-testid="wires-block" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 cards-chrome__actions">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] cards-chrome__heading">
            Спецификация контактов и цепей
          </h2>
          <div className="cards-chrome__controls">
          {ewdSystems.length > 0 ? (
            <div className="diagram-picker relative">
              <button
                type="button"
                data-testid="systems-tree-btn"
                className="diagram-picker__btn"
                aria-expanded={systemsOpen}
                onClick={() => setSystemsOpen((v) => !v)}
              >
                Системы ({ewdSystems.length})
              </button>
              {systemsOpen ? (
                <div
                  data-testid="systems-tree-menu"
                  className="diagram-picker__menu"
                  role="listbox"
                  aria-label="Системы EWD (LogicDesign)"
                >
                  {ewdSystems.slice(0, 40).map((s) => (
                    <button
                      key={s.systemUid}
                      type="button"
                      role="option"
                      data-testid="systems-tree-item"
                      data-wire-owned={s.wireOwned ? "1" : "0"}
                      data-confidence={s.confidence || (s.wireOwned ? "wire-owned" : "text-only")}
                      className="diagram-picker__item"
                      onClick={() => {
                        const uids = (s.diagramUids || []).filter(Boolean);
                        setSystemsOpen(false);
                        if (!uids.length) {
                          setNotice(`Система «${s.name}» без доступных листов SVG.`);
                          return;
                        }
                        const focus = lastWireFocusRef.current;
                        const viableHit = [...cardViableDiagrams]
                          .filter((d) => uids.includes(d.diagramUid))
                          .sort(
                            (a, b) =>
                              (Number(b.wireHits) || 0) - (Number(a.wireHits) || 0) ||
                              (Number(b.onSheetUidCount) || 0) - (Number(a.onSheetUidCount) || 0),
                          )[0];
                        if (viableHit) {
                          void openEwdDiagram(selectedCode, viableHit.diagramUid, focus || undefined, undefined, {
                            manualPick: true,
                          });
                          return;
                        }
                        void (async () => {
                          try {
                            const qs = new URLSearchParams({
                              code: selectedCode,
                              diagramUids: uids.join(","),
                            });
                            if (focus?.pin) qs.set("pins", focus.pin);
                            if (focus?.wireColor) qs.set("color", focus.wireColor);
                            if (focus?.peerCode) qs.set("peer", focus.peerCode);
                            if (focus?.wireUid) qs.set("wireUid", focus.wireUid);
                            if (focus?.pinUid) qs.set("pinUid", focus.pinUid);
                            if (focus?.optionTokens?.length) {
                              qs.set("optionTokens", focus.optionTokens.join(","));
                            } else if (optionTokens.length) {
                              qs.set("optionTokens", optionTokens.join(","));
                            }
                            if (selectedZone && selectedZone !== "all") qs.set("zone", selectedZone);
                            const pickRes = await fetch(`/api/ewd/pick-diagram?${qs}`).then((r) =>
                              r.json(),
                            );
                            const pickUid = String(pickRes.diagramUid || "");
                            if (pickUid && Number(pickRes.wireHits) > 0) {
                              void openEwdDiagram(
                                selectedCode,
                                pickUid,
                                focus || undefined,
                                undefined,
                                { manualPick: true },
                              );
                            } else {
                              setNotice(
                                `Система «${s.name}»: нет листа с этим проводом. Сначала откройте карточку цепи или полный список схем.`,
                              );
                            }
                          } catch {
                            setNotice(`Система «${s.name}»: не удалось подобрать лист.`);
                          }
                        })();
                      }}
                    >
                      <span className="diagram-picker__item-title">{s.name || s.systemUid}</span>
                      <span className="diagram-picker__item-meta">
                        {s.zone || "—"} · листов {s.diagramCount ?? (s.diagramUids || []).length}
                        {s.wireOwned ? " · провод" : " · текст"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {ewdDiagrams.length > 0 || cardViableDiagrams.length > 0 ? (
            <div ref={diagramPickerRef} className="diagram-picker relative">
              <button
                type="button"
                data-testid="diagram-picker-btn"
                className="diagram-picker__btn"
                aria-haspopup="listbox"
                aria-expanded={diagramPickerOpen}
                onClick={() => setDiagramPickerOpen((v) => !v)}
              >
                {cardViableDiagrams.length > 0 && !showAllNodeDiagrams
                  ? `🗺️ Схемы провода (${cardViableDiagrams.length})`
                  : focusedWireUid && ewdDiagrams.some((d) => diagramContainsWireUid(d, focusedWireUid))
                    ? `🗺️ Схемы провода (${ewdDiagrams.filter((d) => diagramContainsWireUid(d, focusedWireUid)).length})`
                    : `🗺️ Схемы узла (${ewdDiagrams.length})`}
              </button>
              {diagramPickerOpen ? (
                <div
                  data-testid="diagram-picker-menu"
                  className="diagram-picker__menu"
                  role="listbox"
                  aria-label="Доступные схемы EWD"
                >
                  {cardViableDiagrams.length > 0 ? (
                    <button
                      type="button"
                      className="diagram-picker__item diagram-picker__item--toggle"
                      data-testid="diagram-picker-toggle-all"
                      onClick={() => setShowAllNodeDiagrams((v) => !v)}
                    >
                      <span className="diagram-picker__title">
                        {showAllNodeDiagrams
                          ? `Только по этой цепи (${cardViableDiagrams.length})`
                          : `Все листы узла (${ewdDiagrams.length})`}
                      </span>
                    </button>
                  ) : null}
                  <p className="diagram-picker__section-label">
                    {showAllNodeDiagrams ? "Все схемы узла" : "Схемы выбранного провода"}
                  </p>
                  {rankedDiagrams.map(({ diagram: d, score }) => {
                    const systemLabel = String(d.systemName || "").trim();
                    const titleLabel = String(d.title || d.designFolder || "").trim();
                    const label =
                      systemLabel && titleLabel && systemLabel !== titleLabel
                        ? `${systemLabel} — ${titleLabel}`
                        : systemLabel || titleLabel;
                    const isOpen = activeSvg?.diagramUid === d.diagramUid;
                    const bestUid = pickBestUid || bestDiagramUid;
                    const confidence = schemeConfidenceForFocusedWire(d, focusedWireUid);
                    const wireOwned = confidence === "wire-owned";
                    const pinOnly = confidence === "pin-only";
                    const confLabel =
                      showAllNodeDiagrams && focusedWireUid && confidence !== "wire-owned"
                        ? "не этот провод"
                        : schemeConfidenceLabel(confidence, Boolean(focusedWireUid));
                    const isBest =
                      !!bestUid &&
                      d.diagramUid === bestUid &&
                      wireOwned &&
                      (cardViableDiagrams.length > 0 || score >= 50 || Boolean(focusedWireUid));
                    const focus = lastWireFocusRef.current;
                    return (
                      <button
                        key={d.diagramUid}
                        type="button"
                        role="option"
                        aria-selected={isOpen}
                        data-testid="diagram-picker-item"
                        data-wire-owned={wireOwned ? "1" : "0"}
                        data-pin-only={pinOnly ? "1" : "0"}
                        data-confidence={confidence}
                        className={`diagram-picker__item${isOpen ? " is-active" : ""}`}
                        onClick={() => {
                          setDiagramPickerOpen(false);
                          void openEwdDiagram(
                            selectedCode,
                            d.diagramUid,
                            focus || {
                              pin: activeSvg?.pin || selectedPinState?.pin,
                              pinCandidates: activeSvg?.pinCandidates,
                              pinFrom: activeSvg?.pinFrom,
                              pinTo: activeSvg?.pinTo,
                              fromCode: activeSvg?.fromCode,
                              toCode: activeSvg?.toCode,
                              ends: activeSvg?.ends,
                              wireColor: activeSvg?.wireColor || selectedPinState?.color,
                              wireUid: activeSvg?.wireUid,
                              pinUid: activeSvg?.pinUid,
                              peerCode: activeSvg?.peerCode,
                              peerPin: activeSvg?.peerPin,
                            },
                            undefined,
                            { manualPick: true },
                          );
                        }}
                      >
                        <span className="diagram-picker__title">{label || d.diagramUid}</span>
                        {isBest ? (
                          <span className="diagram-picker__badge">лучшая</span>
                        ) : confLabel ? (
                          <span className="diagram-picker__badge">{confLabel}</span>
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
          {!focusedWireUid || showAllNodeDiagrams ? (
            <p className="diagram-picker__helper cards-chrome__helper" role="status">
              Схемы узла — общий контекст. Наличие выбранного провода подтверждает только раздел «Схемы провода».
            </p>
          ) : null}
        </div>
        {availableWireColors.length > 0 ? (
          <div
            data-testid="wire-color-filter"
            className="wire-color-filter"
            role="toolbar"
            aria-label="Фильтр карточек по цвету провода из списка контактов"
          >
            <p
              className="w-full basis-full text-[10px] leading-snug text-[var(--text-muted)] mb-1"
              data-testid="wire-color-provenance-note"
            >
              {capitalPanel?.kind === "location"
                ? "Цвета из карточек контактов — не из карты расположения. Это фильтр списка слева, не провода на схеме."
                : activeSvg
                  ? "Цвета фильтруют список контактов слева (не легенда открытой схемы)."
                  : "Цвета = фильтр карточек контактов. Схема ещё не открыта — это не провода текущего листа."}
            </p>
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
      </div>
        </div>
      </details>
      <div
        data-testid="cards-column-scroll"
        className="cards-column__scroll flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain space-y-2 pr-0.5 pb-[max(0.5rem,var(--safe-bottom))]"
      >
        {filteredOwnerWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Свои контакты разъёма</p>
        ) : null}
        {filteredOwnerWires.map((item, index) => {
          const key = String(item.id || `idx-${index}`);
          return renderWireCard(item, index, cardCanShowOnDiagram(item), schemeInfoByCardKey.get(key) || cardSchemeInfo(item, selectedCode, ewdDiagrams), selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setCapitalPanel, setActiveSvg, setNotice, setEditingItem, features.suggestions, cardCtx);
        })}
        {filteredTransitWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-2">Транзитные связи</p>
        ) : null}
        {filteredTransitWires.map((item, index) => {
          const key = String(item.id || `idx-${index + 10000}`);
          return renderWireCard(item, index + 10000, cardCanShowOnDiagram(item), schemeInfoByCardKey.get(key) || cardSchemeInfo(item, selectedCode, ewdDiagrams), selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setCapitalPanel, setActiveSvg, setNotice, setEditingItem, features.suggestions, cardCtx);
        })}
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
          className={`mobile-pane mobile-pane--scheme lg:col-span-7 min-h-0 min-w-0 h-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm flex flex-col${
            mobileView === "cards" && !schemeFullscreen ? " is-mobile-hidden" : ""
          }${schemeFullscreen ? " scheme-panel--fullscreen" : ""}`}
        >
          <div className="ewd-scheme-header bg-[var(--input-bg)] px-3 py-1.5 border-b border-[var(--border-color)] flex justify-between items-center text-xs shrink-0 gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <span data-testid="svg-diagram-label" className="ewd-data font-semibold font-mono truncate max-w-[120px]">{activeSvg.searchCode}</span>
              <span
                data-testid="svg-diagram-title"
                className="truncate max-w-[220px] text-[var(--text-main)]"
                title={activeSvg.systemName || activeSvg.title || activeSvg.diagramUid}
              >
                {activeSvg.systemName || activeSvg.title || `${activeSvg.diagramUid.slice(0, 18)}…`}
              </span>
              {schemeConfidenceLabel(activeSvg.confidence) ? (
                <span
                  data-testid="svg-diagram-confidence"
                  className="diagram-picker__badge shrink-0"
                  title={
                    activeSvg.confidence === "wire-owned"
                      ? "Провод подтверждён на этом листе"
                      : activeSvg.confidence === "pin-only"
                        ? "На листе есть контакт, но провод не подтверждён"
                        : "Лист найден по тексту/системе, без wireHits"
                  }
                >
                  {schemeConfidenceLabel(activeSvg.confidence)}
                </span>
              ) : null}
              {traceInfo && traceInfo.siblingCount > 0 ? (
                <details data-testid="signal-tracer" className="relative">
                  <summary className="cursor-pointer text-[var(--accent)] whitespace-nowrap">
                    Signal tracer ({traceInfo.siblingCount})
                  </summary>
                  <div className="absolute left-0 top-full z-20 mt-1 w-72 max-h-56 overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-2 shadow-lg">
                    <p className="text-[10px] text-[var(--text-muted)] mb-1 font-mono truncate">
                      {traceInfo.signalFile || traceInfo.uid}
                    </p>
                    {(traceInfo.diagrams || []).slice(0, 12).map((d) => (
                      <button
                        key={d.diagramUid}
                        type="button"
                        className="block w-full text-left text-[11px] px-1.5 py-1 rounded hover:bg-[var(--input-bg)]"
                        onClick={() =>
                          void openEwdDiagram(activeSvg.searchCode, d.diagramUid, {
                            pin: activeSvg.pin,
                            pinCandidates: activeSvg.pinCandidates,
                            wireColor: activeSvg.wireColor,
                            peerCode: activeSvg.peerCode,
                            peerPin: activeSvg.peerPin,
                            pinFrom: activeSvg.pinFrom,
                            pinTo: activeSvg.pinTo,
                            fromCode: activeSvg.fromCode,
                            toCode: activeSvg.toCode,
                            ends: activeSvg.ends,
                          }, undefined, { manualPick: true })
                        }
                      >
                        {d.systemName || d.diagramUid.slice(0, 22)}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
            <div className="scheme-panel__header-actions">
              {!schemeFullscreen ? (
                <button
                  type="button"
                  data-testid="scheme-fullscreen"
                  className="scheme-panel__fs-btn"
                  title="На весь экран"
                  aria-label="На весь экран"
                  onClick={enterSchemeFullscreen}
                >
                  ⛶
                </button>
              ) : null}
              <button
                type="button"
                data-testid="scheme-close"
                className="scheme-panel__fs-btn"
                title={schemeFullscreen ? "Выйти из полноэкранного режима" : "Закрыть схему"}
                aria-label={schemeFullscreen ? "Выйти из полноэкранного режима" : "Закрыть схему"}
                onClick={() => {
                  if (schemeFullscreen) exitSchemeFullscreen();
                  else closeActiveScheme();
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {selectedPinState && (
            <div
              data-testid="ewd-selected-contact"
              className="ewd-scheme-status shrink-0 bg-[var(--input-bg)] border-b border-[var(--border-color)] px-3 py-1 text-xs text-center text-[var(--text-main)]"
            >
              Контакт{" "}
              <strong className="ewd-data font-mono">
                {selectedPinState.code}
                {selectedPinState.pin ? `:${selectedPinState.pin}` : ""}
              </strong>
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
              diagramUid={activeSvg.diagramUid}
              searchCode={activeSvg.searchCode}
              objectIds={activeSvg.objectIds}
              pin={activeSvg.pin}
              pinCandidates={activeSvg.pinCandidates}
              pinFrom={activeSvg.pinFrom}
              pinTo={activeSvg.pinTo}
              fromCode={activeSvg.fromCode}
              toCode={activeSvg.toCode}
              ends={activeSvg.ends}
              wireColor={activeSvg.wireColor}
              wireUid={activeSvg.wireUid}
              pinUid={activeSvg.pinUid}
              peerCode={activeSvg.peerCode}
              peerPin={activeSvg.peerPin}
              zone={activeSvg.zone}
              optionTokens={activeSvg.optionTokens || optionTokens}
              showSeq={activeSvg.showSeq}
              onPinMiss={(reason) => {
                pinMissTriedRef.current.add(activeSvg.diagramUid);
                // Never flip through 20+ sheets — only connectivity-viable UIDs, small budget.
                if (pinMissBudgetRef.current <= 0) {
                  setNotice(
                    `Контакт не найден на этой схеме (${reason}). Выберите схему вручную или откройте «Разъём».`,
                  );
                  return;
                }
                const viable = pinViableUidsRef.current.filter(
                  (uid) => !pinMissTriedRef.current.has(uid),
                );
                const nextUid = viable[0];
                if (!nextUid) {
                  pinMissBudgetRef.current = 0;
                  setNotice(
                    `Контакт не найден на подходящих схемах (${reason}). Выберите схему вручную или откройте «Разъём».`,
                  );
                  return;
                }
                pinMissBudgetRef.current -= 1;
                setNotice("Контакт не найден на этой схеме — пробуем следующий подходящий лист…");
                void openEwdDiagram(
                  activeSvg.searchCode,
                  nextUid,
                  {
                    pin: activeSvg.pin,
                    pinCandidates: activeSvg.pinCandidates,
                    pinFrom: activeSvg.pinFrom,
                    pinTo: activeSvg.pinTo,
                    fromCode: activeSvg.fromCode,
                    toCode: activeSvg.toCode,
                    ends: activeSvg.ends,
                    wireColor: activeSvg.wireColor,
                    wireUid: activeSvg.wireUid,
                    pinUid: activeSvg.pinUid,
                    peerCode: activeSvg.peerCode,
                    peerPin: activeSvg.peerPin,
                  },
                  undefined,
                  { fromPinMissRetry: true },
                );
              }}
            />
          </div>
        </div>
      )}
      {capitalPanel && !activeSvg && (
        <div
          data-testid="capital-panel-host"
          className={`mobile-pane mobile-pane--scheme lg:col-span-7 min-h-0 min-w-0 h-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm flex flex-col${
            mobileView === "cards" && !schemeFullscreen ? " is-mobile-hidden" : ""
          }${schemeFullscreen ? " scheme-panel--fullscreen" : ""}`}
        >
          <CapitalPanelViewer
            panel={capitalPanel}
            fullscreen={schemeFullscreen}
            onEnterFullscreen={enterSchemeFullscreen}
            onClose={closeCapitalPanel}
          />
        </div>
      )}
      </div></section> : (
      <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm px-4 text-center">
        Выберите авто, зону и узел — или найдите код ошибки DTC / OBD выше.
      </div>
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
    {filtersPopoverOpen && !isMobileUi
      ? createPortal(
          <div className="desktop-filters-layer" data-testid="desktop-filters-layer">
            <button
              type="button"
              className="desktop-filters-scrim"
              aria-label="Закрыть фильтры"
              data-testid="desktop-filters-scrim"
              onClick={() => setFiltersPopoverOpen(false)}
            />
            <div
              id="desktop-filters-popover-panel"
              className="desktop-filters-window"
              role="dialog"
              aria-modal="true"
              aria-label="Параметры поиска"
              data-testid="desktop-filters-popover"
              style={{ top: filtersPopoverPos.top, left: filtersPopoverPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="desktop-filters-window__header">
                <span className="desktop-filters-window__title">VIN · DTC</span>
                <button
                  type="button"
                  className="md-btn md-btn--text text-[12px] px-2 py-1"
                  data-testid="desktop-filters-close"
                  onClick={() => setFiltersPopoverOpen(false)}
                >
                  Закрыть
                </button>
              </div>
              <div className="desktop-filters-window__body app-panel__filters flex flex-col gap-2">
                {filterPopoverControls}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null}
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
            <p className="text-xs text-[var(--text-muted)]">Уведомление отправлено на elzidevelop@gmail.com.</p>
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
          <p className="text-[11px] text-[var(--text-muted)]">Уйдёт модератору elzidevelop@gmail.com вместе со ссылкой на эту карточку. Повтор по той же карточке — не чаще чем раз в 2 минуты.</p>
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

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // iOS 16.4+ / Mac Safari standalone + Android Chrome
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
