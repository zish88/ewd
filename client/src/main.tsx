import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  diagramHasCode,
  diagramsForPinProbe,
  extractSchemeContext,
  peerCodeFromSchemeCard,
  pickBestDiagram,
  rankDiagramsForContext,
  resolveHighlightPin,
  type SchemeContext,
} from "./ewdSchemeResolver.js";
import "./styles.css";
import { AdminPage } from "./AdminPage.js";
import { loadPersistedFilters, savePersistedFilters, type PersistedFilters } from "./filterPersist.js";

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
  voltage?: string; wire_gauge?: string;
};

type CapitalPanel =
  | { kind: "faceview"; code: string; pin?: string }
  | { kind: "location"; code: string }
  | { kind: "report"; report: "fuse" | "inline" | "splice" | "grounds" }
  | { kind: "intro"; slug: string };
type EwdDiagram = {
  diagramUid: string;
  title: string;
  textCodes: string[];
  designFolder: string;
  systemName?: string;
  pathCount?: number;
  groups?: Array<{ schemClass: string; uids: string[]; pathCount: number }>;
  wireHits?: number;
  pinHits?: number;
  onSheetUidCount?: number;
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
};
type ActiveSvg = {
  diagramUid: string;
  searchCode: string;
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
function CapitalPanelViewer({ panel, onClose }: { panel: CapitalPanel; onClose: () => void }) {
  const [html, setHtml] = useState("");
  const [svg, setSvg] = useState("");
  const [pins, setPins] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
        <button type="button" className="text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={onClose}>
          Закрыть
        </button>
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
          <SvgPanZoomHost
            testId="location-svg-viewer"
            markup={svg}
            loading={loading}
            error={err}
            className="ewd-location-svg"
          />
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
type FilterAvailable = {
  models: string[];
  years: string[];
  engines: string[];
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
    const sqliteRich =
      detailLooksRich(String(w.from_detail || "")) && detailLooksRich(String(w.to_detail || ""));
    const match = usable.find((ep) => {
      const epColor = String(ep.color || "").toUpperCase().replace(/\//g, "-");
      const colorOk = !color || color === "—" || !epColor || epColor === color;
      const pinOk =
        !pin ||
        pinLabelMatches(ep.pinFrom, pin) ||
        pinLabelMatches(ep.pinTo, pin) ||
        ep.from.includes(`:${pin}`) ||
        ep.to.includes(`:${pin}`);
      const involves =
        ep.from.includes(codeN) ||
        ep.to.includes(codeN) ||
        normalizeCodeLabel(ep.from).startsWith(codeN) ||
        normalizeCodeLabel(ep.to).startsWith(codeN);
      // Prefer pin on the selected code's side when both ends have pins
      const pinOnSelected =
        !pin ||
        (normalizeCodeLabel(ep.from).startsWith(codeN) && pinLabelMatches(ep.pinFrom, pin)) ||
        (normalizeCodeLabel(ep.to).startsWith(codeN) && pinLabelMatches(ep.pinTo, pin)) ||
        pinOk;
      return colorOk && pinOnSelected && (involves || !codeN);
    });
    if (!match) return w;
    // Never overwrite good pinout details with weaker EWD
    if (sqliteRich) return w;
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

function renderWireCard(
  item: Result,
  index: number,
  hasEwdDiagram: boolean,
  selectedCode: string,
  setSelectedPinState: (v: { id: string | number; code: string; color: string; pin: string } | null) => void,
  selectedPinState: { id: string | number; code: string; color: string; pin: string } | null,
  onOpenDiagram: (searchCode: string, preferredUid?: string, wire?: WireFocus, card?: Result) => void,
  setCapitalPanel: (v: CapitalPanel | null) => void,
  setActiveSvg: (v: ActiveSvg | null) => void,
  setNotice: (v: string) => void,
  setEditingItem: (v: any) => void,
  suggestionsEnabled = true,
  cardContext?: { zone: string; code: string; model: string; year: string; engine: string },
) {
  const itemId = item.id || `search-${index}`;
  const isThis = selectedPinState?.id === itemId;
  const wireRu = item.wire_color_ru || decodeWireColor(item.wire_color).replace(/\s*\([^)]*\)\s*$/, "") || "—";
  const wireCode = item.wire_color && item.wire_color !== "—" ? item.wire_color : "—";
  const openDiagram = () => {
    if (!hasEwdDiagram) {
      setNotice("Графическая схема EWD для этого узла не найдена. Откройте «Разъём» (FaceView).");
      return;
    }
    const code = String(selectedCode || item.search_target || item.from_node || "").trim();
    // Card.pin_number is often the junction cavity (74/xxx:21) while the open sheet is a module
    // (3/126C1:2). Resolve the digit that belongs to the selected code on this SVG.
    let cardPin = String(item.pin_number || "").trim();
    if (!cardPin && Array.isArray(item.pins) && item.pins.length) {
      cardPin = String(item.pins[0] ?? "").trim();
    }
    if (!cardPin) {
      const blob = `${item.card_title || ""} ${item.from_detail || ""} ${item.to_detail || ""} ${item.raw_line || ""}`;
      const m = blob.match(/контакт\s*[№#:]?\s*(\d{1,3})/i) || blob.match(/:(\d{1,3})\b/);
      if (m?.[1]) cardPin = String(m[1]);
    }
    const resolved = resolveHighlightPin(item, code, cardPin);
    // Primary marker = Откуда (from_detail), never Куда
    const focus = cardFocusContact(item, code);
    const focusCode = normalizeCodeLabel(focus.code || resolved.fromCode || code);
    const focusPin = String(focus.pin || resolved.pinFrom || cardPin || "").trim();
    const fromCode = normalizeCodeLabel(resolved.fromCode || focusCode);
    const toCode = normalizeCodeLabel(resolved.toCode || "");
    const pinFrom = String(resolved.pinFrom || focusPin || "").trim();
    const pinTo = String(resolved.pinTo || "").trim();
    const cardPinUid = String(item.pin_uid || "").trim();
    const wireEnds: WireEndFocus[] = [];
    wireEnds.push({
      code: fromCode || focusCode,
      pin: pinFrom || focusPin || undefined,
      pinCandidates: (pinFrom || focusPin) ? [pinFrom || focusPin] : undefined,
      uid: cardPinUid || undefined,
      role: "selected",
    });
    if (toCode && toCode !== (fromCode || focusCode)) {
      wireEnds.push({
        code: toCode,
        pin: pinTo || undefined,
        pinCandidates: pinTo ? [pinTo] : undefined,
        role: "to",
      });
    }
    // Persist selection strictly on click — never tied to hover/mouseleave
    setSelectedPinState({
      id: itemId,
      code: fromCode || focusCode || code,
      color: wireCode !== "—" ? wireCode : "",
      pin: pinFrom || focusPin,
    });
    // pinCandidates = Откуда only (do not put Куда pin at head)
    const pinCandidates = [
      ...new Set(
        [pinFrom, focusPin, cardPin]
          .map((p) => String(p || "").trim())
          .filter(Boolean),
      ),
    ];
    const peerForPick =
      toCode && toCode !== (fromCode || focusCode)
        ? toCode
        : resolved.peerCode || peerCodeFromCard(item, code) || undefined;
    onOpenDiagram(
      code,
      undefined,
      {
        pin: pinFrom || focusPin || undefined,
        pinCandidates: pinCandidates.length ? pinCandidates : undefined,
        pinFrom: pinFrom || undefined,
        pinTo: pinTo || undefined,
        fromCode: fromCode || undefined,
        toCode: toCode || undefined,
        peerCode: peerForPick,
        peerPin: pinTo || resolved.peerPin || undefined,
        wireColor: wireCode !== "—" ? wireCode : undefined,
        ends: wireEnds.length ? wireEnds : undefined,
        wireUid: String(item.wire_uid || "").trim() || undefined,
        pinUid: cardPinUid || undefined,
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
        {item.wire_gauge ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[var(--text-muted)] font-sans">
            <span>Сечение: <span className="ewd-data font-mono text-[var(--text-main)]">{item.wire_gauge} мм²</span></span>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 mt-0.5">
        {hasEwdDiagram ? (
          <button type="button" data-testid="show-on-diagram" onClick={openDiagram} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1.5 rounded font-medium">
            Показать на схеме
          </button>
        ) : null}
        <button type="button" data-testid="show-faceview" onClick={openFaceView} className={`${hasEwdDiagram ? "px-2" : "flex-1"} bg-[var(--bg-card)] hover:bg-[var(--input-bg)] text-[var(--text-main)] text-xs py-1.5 rounded font-medium border border-[var(--border-color)]`}>
          Разъём
        </button>
        <button type="button" data-testid="show-location" onClick={openLocation} className="px-2 bg-[var(--bg-card)] hover:bg-[var(--input-bg)] text-[var(--text-main)] text-xs py-1.5 rounded font-medium border border-[var(--border-color)]">
          Расположение
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
  const [dtcQuery, setDtcQuery] = useState("");
  const [dtcResults, setDtcResults] = useState<DtcHit[]>([]);
  const [dtcLoading, setDtcLoading] = useState(false);
  const [dtcNotice, setDtcNotice] = useState("");
  type NodeInfo = {
    code: string;
    name_ru: string;
    part_number: string;
    part_number_mate: string;
    pin_count: { owner: number; transit: number; total: number };
    wire_gauges: string[];
    zoneEmptyFallback?: boolean;
  };
  const [nodeInfo, setNodeInfo] = useState<NodeInfo | null>(null);
  const [ownerWires, setOwnerWires] = useState<Result[]>([]);
  const [transitWires, setTransitWires] = useState<Result[]>([]);
  const [ewdDiagrams, setEwdDiagrams] = useState<EwdDiagram[]>([]);
  const [ewdObjectIds, setEwdObjectIds] = useState<string[]>([]);
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
  const showSeqRef = useRef(0);
  /** Diagram UIDs already tried after pin-miss for the current card focus (prevents loops). */
  const pinMissTriedRef = useRef<Set<string>>(new Set());
  /** Connectivity-viable sheets for this pin (from /api/ewd/pick-diagram) — retry only inside this list. */
  const pinViableUidsRef = useRef<string[]>([]);
  /** Auto pin-miss retries left (card open only; manual picker = 0). */
  const pinMissBudgetRef = useRef(0);
  /** Last card wire focus — systems tree / picker re-use anchors. */
  const lastWireFocusRef = useRef<WireFocus | null>(null);
  const [zoom, setZoom] = useState(80);
  const [selectedPinState, setSelectedPinState] = useState<{
    id: string | number;
    code: string;
    color: string;
    pin: string;
  } | null>(null);
  const [zones, setZones] = useState<NavZone[]>([]);
  const [navGroups, setNavGroups] = useState<NavGroup[]>([]);
  const [selectedZone, setSelectedZone] = useState(() => persisted0.zone || "all");
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteOpen, setSiteOpen] = useState(true);
  const [features, setFeatures] = useState({
    suggestions: true,
    ewdDiagrams: true,
    vinSearch: true,
    navBrowse: true,
    dtcSearch: true,
  });
  const [filtersCollapsed, setFiltersCollapsed] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)").matches : false,
  );
  const [vehicleConfigured, setVehicleConfigured] = useState(
    () => Boolean(persisted0.model && persisted0.year),
  );
  const headerRef = useRef<HTMLElement | null>(null);
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
  const vehicle = {
    model: selectedModel,
    year: selectedYear,
    engine: selectedEngine,
    transmission: selectedTransmission,
  };
  const rightOpen = Boolean(activeSvg || capitalPanel);
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

  // Capital FaceView / Location / report → scheme tab on phones
  useEffect(() => {
    if (capitalPanel && !activeSvg && isMobileViewport()) setMobileView("scheme");
  }, [capitalPanel, activeSvg]);

  const rankedDiagrams = useMemo(() => {
    const ctx = schemeContext || extractSchemeContext(null, selectedCode);
    const pool =
      !showAllNodeDiagrams && cardViableDiagrams.length
        ? cardViableDiagrams
        : ewdDiagrams;
    return rankDiagramsForContext(pool, ctx);
  }, [ewdDiagrams, cardViableDiagrams, showAllNodeDiagrams, schemeContext, selectedCode]);
  const bestDiagramUid =
    pickBestUid ||
    (rankedDiagrams[0] &&
    ((Number(rankedDiagrams[0].diagram.wireHits) || 0) > 0 || rankedDiagrams[0].score >= 50)
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
        const nextTrans: TransmissionOpt[] = Array.isArray(data.transmissions) ? data.transmissions : [];
        const nextModels: string[] = Array.isArray(data.models) && data.models.length ? data.models : DEFAULT_MODELS;
        setAvailable({
          models: nextModels,
          years: nextYears,
          engines: nextEngines,
          transmissions: nextTrans,
        });
        if (Array.isArray(data.optionTokens)) {
          setOptionTokens(data.optionTokens.map(String).filter(Boolean));
        }
        // Keep restored/user picks; never clear from stale parent closures
        setSelectedYear((current: string) => {
          if (!current) return "";
          if (!nextYears.length || nextYears.includes(current)) return current;
          return current;
        });
        setSelectedEngine((current: string) => {
          if (!current) return "";
          if (!nextEngines.length || nextEngines.includes(current)) return current;
          return current;
        });
        setSelectedTransmission((current: string) => {
          if (!current) return ""; // «Все КПП»
          return current;
        });
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
      })
      .catch(() => undefined);
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
    setCapitalPanel(null);
    setActiveSvg(null);
    setNodeInfo(null);
    setDtcResults([]);
    setDtcNotice("");
  };

  function clearDtc() {
    setDtcQuery("");
    setDtcResults([]);
    setDtcNotice("");
    if (mode === "dtc") setMode(null);
  }

  function clearVin() {
    setVinInput("");
    setVinLocked(false);
    setVinNotice("");
  }

  async function searchDtc() {
    const q = dtcQuery.trim();
    if (q.length < 2) {
      setDtcNotice("Введите код (ABS-0010, P0563) или фрагмент описания.");
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
      setDtcNotice(results.length ? `Найдено: ${results.length}` : "Ничего не найдено.");
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

  async function openEwdDiagram(
    searchCode: string,
    preferredUid?: string,
    wire?: WireFocus,
    card?: Result,
    opts?: { fromPinMissRetry?: boolean; manualPick?: boolean },
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

    const resolved = card
      ? resolveHighlightPin(card, code, wire?.pin || "")
      : null;
    const cardFrom = card ? cardFocusContact(card, code) : null;
    const fromCode =
      wire?.fromCode ||
      resolved?.fromCode ||
      cardFrom?.code ||
      "";
    const toCode = wire?.toCode || resolved?.toCode || "";
    const pinFrom =
      wire?.pinFrom ||
      resolved?.pinFrom ||
      cardFrom?.pin ||
      wire?.pin ||
      "";
    const pinTo = wire?.pinTo || resolved?.pinTo || "";
    const peerPin = wire?.peerPin || pinTo || resolved?.peerPin || "";
    // Откуда pins only for pick/marker focus — never lead with Куда
    const pinCandidates = [
      ...new Set(
        [
          ...(wire?.pinCandidates || []),
          pinFrom,
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
            ...(fromCode
              ? [
                  {
                    code: fromCode,
                    pin: pinFrom || undefined,
                    pinCandidates: pinFrom ? [pinFrom] : undefined,
                    role: "selected" as const,
                  },
                ]
              : []),
            ...(toCode && toCode !== fromCode
              ? [
                  {
                    code: toCode,
                    pin: pinTo || undefined,
                    pinCandidates: pinTo ? [pinTo] : undefined,
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
        pin: pinFrom || wire?.pin || pinCandidates[0],
        pinFrom: pinFrom || wire?.pinFrom,
        pinTo: pinTo || wire?.pinTo,
        fromCode: fromCode || wire?.fromCode,
        toCode: toCode || wire?.toCode,
        pinCandidates,
        wireColor: wire?.wireColor,
        peerCode: toCode || wire?.peerCode || resolved?.peerCode || ctx.peerCode,
        peerPin: peerPin || pinTo || undefined,
        ends: wireEnds.length ? wireEnds : wire?.ends,
      };
    }

    // Fresh card click resets pin-miss state; retries / manual keep their own budget.
    if (!preferredUid && !opts?.fromPinMissRetry) {
      pinMissTriedRef.current = new Set();
      pinViableUidsRef.current = [];
      pinMissBudgetRef.current = hasPinFocus ? 2 : 0;
      setShowAllNodeDiagrams(false);
    }
    if (opts?.manualPick) {
      pinMissBudgetRef.current = 0;
    }

    // Explicit list UID = manual / pin-miss retry; otherwise pick by card wireUid on sheet.
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

    const applyPickRanked = (pickRes: {
      diagramUid?: string;
      viable?: string[];
      ranked?: Array<{
        diagramUid: string;
        wireHits?: number;
        pinHits?: number;
        onSheetUidCount?: number;
      }>;
      hard?: boolean;
      wireHits?: number;
    }): { pickUid: string; viableDiags: EwdDiagram[] } => {
      const viable = Array.isArray(pickRes.viable)
        ? (pickRes.viable as string[]).filter(Boolean)
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
      const viableDiags: EwdDiagram[] = viable.map((uid) => {
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
      });
      setCardViableDiagrams(viableDiags);
      const pickUid = String(pickRes.diagramUid || "");
      setPickBestUid(pickUid);
      return { pickUid, viableDiags };
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
        const fromPins = [pinFrom, ...pinCandidates].filter(Boolean);
        if (fromPins.length) qs.set("pins", [...new Set(fromPins)].join(","));
        if (wire?.wireColor) qs.set("color", wire.wireColor);
        const peer =
          toCode ||
          wire?.peerCode ||
          resolved?.peerCode ||
          ctx.peerCode ||
          "";
        if (peer) qs.set("peer", peer);
        if (boundWireUid) qs.set("wireUid", boundWireUid);
        if (boundPinUid) qs.set("pinUid", boundPinUid);
        if (selectedZone && selectedZone !== "all") qs.set("zone", selectedZone);
        if (optionTokens.length) qs.set("optionTokens", optionTokens.join(","));
        // Probe is additive on server (netOwned ∪ requested) — never replaces netOwned
        if (probe.length) {
          qs.set("diagramUids", probe.map((r) => r.diagram.diagramUid).join(","));
        }
        const pickRes = await fetch(`/api/ewd/pick-diagram?${qs}`).then((r) => r.json());
        const { pickUid, viableDiags } = applyPickRanked(pickRes);
        const preferFromSheet = (d: EwdDiagram | null): EwdDiagram | null => {
          if (!d || !fromCodeN || fromCodeN === code) return d;
          if (diagramHasCode(d, fromCodeN)) return d;
          const better =
            viableDiags.find(
              (v) =>
                diagramHasCode(v, fromCodeN) && (Number(v.wireHits) || 0) > 0,
            ) ||
            viableDiags.find((v) => diagramHasCode(v, fromCodeN));
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
        // Hard only when card has wireUid
        if (boundWireUid) {
          if (pickRes.hard && Number(pickRes.wireHits) > 0 && pickUid) {
            preferred = preferFromSheet(resolveUid(pickUid));
          } else {
            setNotice(
              "Нет схемы, где этот провод есть на листе. Откройте «Разъём» или выберите лист вручную из списка цепи.",
            );
            return;
          }
        } else {
          preferred = preferFromSheet(
            (Number(pickRes.wireHits) > 0 ? resolveUid(pickUid) : null) ||
              resolveUid(String(pickRes.viable?.[0] || "")) ||
              null,
          );
        }
      } catch {
        if (boundWireUid) {
          setNotice("Не удалось подобрать схему для этого провода.");
          return;
        }
      }
    }

    // Without card wireUid: score-based only; never ewdDiagrams[0] blind.
    if (!preferred && !boundWireUid) {
      const picked = pickBestDiagram(ewdDiagrams, ctx);
      preferred = picked.diagram;
      if (!preferred) {
        const ranked = rankDiagramsForContext(ewdDiagrams, ctx);
        preferred =
          ranked.find((r) => r.score > 0 && diagramHasCode(r.diagram, code))?.diagram ||
          ranked.find((r) => r.score > 0)?.diagram ||
          null;
      }
      if (!preferred && hasPinFocus) {
        setNotice(
          "Нет схемы с этим контактом/цветом на листе. Выберите схему вручную или откройте «Разъём».",
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
    setPickBestUid(preferred.diagramUid);
    setCapitalPanel(null);
    // Always-on marker: bump showSeq on every click so repeat clicks re-inject + recenter
    showSeqRef.current += 1;
    // Focus pin = Откуда — never let server/Куда override
    const focusPin = pinFrom || wire?.pin || pinCandidates[0] || undefined;
    const peerTo =
      toCode ||
      wire?.peerCode ||
      resolved?.peerCode ||
      ctx.peerCode ||
      undefined;
    setActiveSvg({
      diagramUid: preferred.diagramUid,
      searchCode: code,
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
      zone: selectedZone && selectedZone !== "all" ? selectedZone : undefined,
      optionTokens,
      showSeq: showSeqRef.current,
    });
    // Signal tracer: resolve GlobalSignals siblings for Откуда pin
    const pinForTrace = focusPin || pinCandidates[0] || "";
    if (pinForTrace) {
      const tqs = new URLSearchParams({ code, pin: pinForTrace });
      if (optionTokens.length) tqs.set("optionTokens", optionTokens.join(","));
      fetch(`/api/ewd/trace?${tqs}`)
        .then((r) => r.json())
        .then((data) => {
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
        .catch(() => setTraceInfo(null));
    } else {
      setTraceInfo(null);
    }
    setNotice("");
    if (isMobileViewport()) setMobileView("scheme");
  }

  async function loadWires(code: string, zone = selectedZone, opts?: { ignoreZone?: boolean }) {
    if (!code) return;
    if (!requireVehicleMin()) return;
    const useZone = opts?.ignoreZone ? "all" : zone;
    setMode("search");
    setOwnerWires([]);
    setTransitWires([]);
    setEwdDiagrams([]);
    setEwdObjectIds([]);
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
      const ewdQs = new URLSearchParams({ code });
      if (useZone && useZone !== "all") ewdQs.set("zone", useZone);
      const sysQs = new URLSearchParams({ code });
      if (useZone && useZone !== "all") sysQs.set("zone", useZone);
      const [data, ewdData, sysData] = await Promise.all([
        fetch(`/api/nav/wires?${params}`).then((r) => r.json()),
        fetch(`/api/ewd/diagrams?${ewdQs}`).then((r) => r.json()).catch(() => ({ diagrams: [], objectIds: [] })),
        fetch(`/api/ewd/systems?${sysQs}`).then((r) => r.json()).catch(() => ({ systems: [] })),
      ]);
      setEwdSystems(Array.isArray(sysData.systems) ? (sysData.systems as EwdSystemRow[]) : []);
      let ownerRaw = Array.isArray(data.owner_wires) ? data.owner_wires : [];
      let transitRaw = Array.isArray(data.transit_wires) ? data.transit_wires : [];
      let zoneEmptyFallback = false;
      let infoSource = data;
      // Zone filter emptied results — offer / auto-check unscoped wires
      if (!ownerRaw.length && !transitRaw.length && useZone && useZone !== "all" && !opts?.ignoreZone) {
        const unscoped = await fetch(`/api/nav/wires?code=${encodeURIComponent(code)}`).then((r) => r.json());
        const uOwner = Array.isArray(unscoped.owner_wires) ? unscoped.owner_wires : [];
        const uTransit = Array.isArray(unscoped.transit_wires) ? unscoped.transit_wires : [];
        if (uOwner.length || uTransit.length) {
          zoneEmptyFallback = true;
          infoSource = unscoped;
        }
      }
      const ewdDiags = Array.isArray(ewdData.diagrams) ? (ewdData.diagrams as EwdDiagram[]) : [];
      const objectIds = Array.isArray(ewdData.objectIds) ? (ewdData.objectIds as string[]) : [];
      const codeCtx = extractSchemeContext(null, code);
      const preferredDiagram = pickBestDiagram(ewdDiags, codeCtx).diagram;
      const epQs = new URLSearchParams({ code });
      if (useZone && useZone !== "all") epQs.set("zone", useZone);
      if (preferredDiagram?.diagramUid) epQs.set("diagramUid", preferredDiagram.diagramUid);
      if (optionTokens.length) epQs.set("optionTokens", optionTokens.join(","));
      const epData = await fetch(`/api/ewd/endpoints?${epQs}`)
        .then((r) => r.json())
        .catch(() => ({ endpoints: [] }));
      const endpoints = Array.isArray(epData.endpoints) ? (epData.endpoints as EwdEndpoint[]) : [];
      setOwnerWires(mergeEwdEndpoints(ownerRaw, endpoints, code));
      setTransitWires(mergeEwdEndpoints(transitRaw, endpoints, code));
      setEwdDiagrams(ewdDiags);
      setEwdObjectIds(objectIds);
      setCardViableDiagrams([]);
      setPickBestUid("");
      setShowAllNodeDiagrams(false);
      lastWireFocusRef.current = null;
      const pinCount = infoSource.pin_count || {
        owner: ownerRaw.length,
        transit: transitRaw.length,
        total: ownerRaw.length + transitRaw.length,
      };
      setNodeInfo({
        code,
        name_ru: String(infoSource.name_ru || ""),
        part_number: String(infoSource.part_number || ""),
        part_number_mate: String(infoSource.part_number_mate || ""),
        pin_count: {
          owner: Number(pinCount.owner) || ownerRaw.length,
          transit: Number(pinCount.transit) || transitRaw.length,
          total: Number(pinCount.total) || ownerRaw.length + transitRaw.length,
        },
        wire_gauges: Array.isArray(infoSource.wire_gauges)
          ? infoSource.wire_gauges.map(String)
          : [],
        zoneEmptyFallback,
      });
      const n = ownerRaw.length + transitRaw.length;
      if (zoneEmptyFallback) {
        setNotice(
          `Нет контактов в выбранной зоне для ${code}. Есть данные вне зоны — нажмите «Показать во всех зонах».`,
        );
      } else {
        setNotice(
          n || ewdDiags.length
            ? `${code}: ${ewdDiags.length} схем EWD · ${ownerRaw.length} своих · ${transitRaw.length} транзитных`
            : `Для ${code} ничего не найдено`,
        );
      }
    } catch {
      setOwnerWires([]);
      setTransitWires([]);
      setEwdDiagrams([]);
      setEwdObjectIds([]);
      setNodeInfo(null);
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
      className={`app-panel app-bar shrink-0 border-b px-3 py-2${filtersCollapsed ? " is-filters-collapsed" : ""}`}
    >
      <div className="app-bar__chrome mx-auto max-w-7xl flex items-center gap-2 min-h-[48px]">
        <span className="font-semibold text-[var(--accent)] tracking-wide shrink-0">Volvo EWD</span>
        <button
          type="button"
          className="mobile-filters-toggle md-btn md-btn--tonal ml-auto"
          aria-expanded={!filtersCollapsed}
          aria-label={filtersCollapsed ? "Показать фильтры" : "Скрыть фильтры"}
          onClick={() => setFiltersCollapsed((v) => !v)}
        >
          <span className="mobile-filters-toggle__label">
            {filtersCollapsed ? "Фильтры" : "Скрыть"}
          </span>
        </button>
      </div>
      <div className="app-panel__filters mx-auto max-w-7xl flex flex-col gap-2 mt-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-[var(--accent)] mr-1 hidden">Volvo EWD</span>
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
          </label>
          <button
            type="button"
            data-testid="vin-decode-btn"
            className="md-btn md-btn--tonal text-[11px] px-2 py-1"
            onClick={() => void applyVin()}
          >
            По VIN
          </button>
          {(vinInput || vinLocked) ? (
            <button
              type="button"
              data-testid="vin-clear-btn"
              className="md-btn md-btn--text text-[11px] px-2 py-1"
              onClick={clearVin}
            >
              Сброс VIN
            </button>
          ) : null}
            </>
          ) : null}
          {vinLocked ? (
            <span className="md-chip" data-testid="vin-chip">из VIN</span>
          ) : null}
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
                Пометки: [схема]=графика EWD · [контакты]=FaceView / полость
              </span>
            </label>
          </div>
        </section>
        ) : null}
        {features.dtcSearch ? (
        <section className="app-card rounded-lg border p-2.5 space-y-2 shadow-sm" data-testid="dtc-search">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Коды ошибок DTC / OBD</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="dtc-query"
              className="app-input rounded px-2 py-1.5 text-xs font-mono flex-1 min-w-[12rem]"
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
              className="md-btn md-btn--filled text-[11px] px-2.5 py-1.5"
              onClick={() => void searchDtc()}
              disabled={dtcLoading}
            >
              {dtcLoading ? "…" : "Найти"}
            </button>
            <button
              type="button"
              data-testid="dtc-clear-btn"
              className="md-btn md-btn--text text-[11px] px-2.5 py-1.5"
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
        ) : null}
      </div>
    </header>
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
            </article>
          ))}
          {!dtcLoading && !dtcResults.length ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">Нет совпадений.</p>
          ) : null}
        </div>
      </section>
    ) : mode ? <section data-testid="results-panel" className="h-full mx-auto max-w-7xl px-3 py-2 flex flex-col min-h-0">
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
        className={`mobile-pane mobile-pane--cards cards-column ${rightOpen ? "lg:col-span-5" : "max-w-3xl mx-auto w-full"} flex flex-col min-h-0 overflow-hidden pr-1${
          mobileView === "scheme" && rightOpen ? " is-mobile-hidden" : ""
        }`}
      >
      <div data-testid="cards-column-sticky" className="cards-column__sticky shrink-0 space-y-2">
      {nodeInfo ? (
        <aside data-testid="node-info-banner" className="md-info-banner app-card border rounded-xl px-3 py-2.5 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono font-semibold text-[var(--accent)] text-sm">{nodeInfo.code}</span>
            {nodeInfo.name_ru ? (
              <span className="text-xs text-[var(--text-main)]">{nodeInfo.name_ru}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
            {nodeInfo.part_number ? (
              <span>Корпус: <span className="font-mono text-[var(--text-main)]">{nodeInfo.part_number}</span></span>
            ) : null}
            {nodeInfo.part_number_mate ? (
              <span>Ответная часть: <span className="font-mono text-[var(--text-main)]">{nodeInfo.part_number_mate}</span></span>
            ) : null}
            <span>
              Контакты: <span className="text-[var(--text-main)]">{nodeInfo.pin_count.owner}</span>
              {nodeInfo.pin_count.transit ? (
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Спецификация контактов и цепей
          </h2>
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
                            if (selectedZone && selectedZone !== "all") qs.set("zone", selectedZone);
                            const pickRes = await fetch(`/api/ewd/pick-diagram?${qs}`).then((r) =>
                              r.json(),
                            );
                            const pickUid = String(pickRes.diagramUid || "");
                            if (pickUid && (Number(pickRes.wireHits) > 0 || !focus?.wireUid)) {
                              void openEwdDiagram(
                                selectedCode,
                                pickUid,
                                focus || undefined,
                                undefined,
                                { manualPick: true },
                              );
                            } else {
                              setNotice(
                                `Система «${s.name}»: нет листа с этим проводом. Сначала откройте карточку цепи.`,
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
                🗺️ Выбрать схему (
                {cardViableDiagrams.length > 0 && !showAllNodeDiagrams
                  ? cardViableDiagrams.length
                  : ewdDiagrams.length}
                )
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
                  {rankedDiagrams.map(({ diagram: d, score }) => {
                    const label = String(d.title || d.systemName || d.designFolder || "").trim();
                    const isOpen = activeSvg?.diagramUid === d.diagramUid;
                    const bestUid = pickBestUid || bestDiagramUid;
                    const isBest =
                      !!bestUid &&
                      d.diagramUid === bestUid &&
                      (cardViableDiagrams.length > 0 || score >= 50);
                    const focus = lastWireFocusRef.current;
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
      </div>
      </div>
      <div data-testid="cards-column-scroll" className="cards-column__scroll flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
        {filteredOwnerWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Свои контакты разъёма</p>
        ) : null}
        {filteredOwnerWires.map((item, index) => renderWireCard(item, index, hasEwdDiagram && features.ewdDiagrams, selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setCapitalPanel, setActiveSvg, setNotice, setEditingItem, features.suggestions, cardCtx))}
        {filteredTransitWires.length > 0 ? (
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-2">Транзитные связи</p>
        ) : null}
        {filteredTransitWires.map((item, index) => renderWireCard(item, index + 10000, hasEwdDiagram && features.ewdDiagrams, selectedCode, setSelectedPinState, selectedPinState, openEwdDiagram, setCapitalPanel, setActiveSvg, setNotice, setEditingItem, features.suggestions, cardCtx))}
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
          <div className="ewd-scheme-header bg-[var(--input-bg)] px-3 py-1.5 border-b border-[var(--border-color)] flex justify-between items-center text-xs shrink-0 gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <span data-testid="svg-diagram-label" className="ewd-data font-semibold font-mono truncate max-w-[280px]">{activeSvg.searchCode}</span>
              <span className="ewd-data font-mono truncate max-w-[200px]">{activeSvg.diagramUid.slice(0, 18)}…</span>
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
              key={activeSvg.diagramUid}
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
          className={`mobile-pane mobile-pane--scheme lg:col-span-7 min-h-0 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm flex flex-col${
            mobileView === "cards" ? " is-mobile-hidden" : ""
          }`}
        >
          <CapitalPanelViewer
            panel={capitalPanel}
            onClose={() => {
              setCapitalPanel(null);
              setMobileView("cards");
            }}
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
