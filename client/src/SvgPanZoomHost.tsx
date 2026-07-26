import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { syncPinMarkerScreenSize } from "./ewdHighlight.js";

/** On-screen FAB zoom step (wheel stays finer at ×1.1 / ×0.9). */
const BUTTON_ZOOM_IN = 1.25;
const BUTTON_ZOOM_OUT = 0.8;

type Pt = { x: number; y: number };

/** True for a physical mouse wheel notch; false for trackpad two-finger pixel scroll. */
function isDiscreteMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE || e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return true;
  }
  if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;
  const ax = Math.abs(e.deltaX);
  const ay = Math.abs(e.deltaY);
  // Trackpad pans often include a horizontal component or small continuous steps.
  if (ax > 1 || ay < 40) return false;
  // Chrome/Edge Windows mouse: typically 100/120 per notch (sometimes multiples).
  const notches = [90, 96, 100, 108, 120, 150];
  if (notches.includes(ay)) return true;
  return ay >= 100 && (ay % 100 === 0 || ay % 120 === 0);
}

type SvgPanZoomHostProps = {
  /** Inner SVG/HTML markup (applied via DOM, not React dangerouslySetInnerHTML). */
  markup: string;
  loading?: boolean;
  error?: string | null;
  className?: string;
  testId?: string;
  /** Optional point in SVG user units to keep centered on reset/fit. */
  markerAt?: Pt | null;
  /** Bump to re-run comfort fit to markerAt. */
  fitToken?: string | number;
  /**
   * When no marker: fit the whole SVG into the viewport and center it
   * (Location views). Schematics keep top-left padding unless a marker is set.
   */
  fitMode?: "marker" | "contain";
  /** Called after markup is written into the canvas. */
  onMarkupApplied?: (root: HTMLDivElement, svg: SVGSVGElement) => void;
  /** Extra overlays inside the viewport (e.g. headers). */
  children?: ReactNode;
};

/**
 * Shared wheel / pinch / drag pan-zoom host for EWD schematics and Location SVGs.
 * FABs are always visible (desktop + mobile).
 */
export function SvgPanZoomHost({
  markup,
  loading = false,
  error = null,
  className = "",
  testId = "svg-viewer",
  markerAt = null,
  fitToken = 0,
  fitMode = "marker",
  onMarkupApplied,
  children,
}: SvgPanZoomHostProps) {
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
  const appliedMarkupRef = useRef("");
  const markerRef = useRef<Pt | null>(null);
  markerRef.current = markerAt;
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const onMarkupAppliedRef = useRef(onMarkupApplied);
  onMarkupAppliedRef.current = onMarkupApplied;

  const applyPanZoomDom = () => {
    const pan = panRef.current;
    const svg = contentRef.current?.querySelector("svg") as SVGSVGElement | null;
    const base = baseSizeRef.current;
    const t = translateRef.current;
    const s = scaleRef.current;
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

  const fitContainCenter = () => {
    const viewport = viewportRef.current;
    const base = baseSizeRef.current;
    if (!viewport || !base || !base.w || !base.h) return;
    const pad = 24;
    const availW = Math.max(40, viewport.clientWidth - pad * 2);
    const availH = Math.max(40, viewport.clientHeight - pad * 2);
    const s = Math.min(availW / base.w, availH / base.h, 2.5);
    scaleRef.current = Math.max(0.12, s);
    translateRef.current = {
      x: (viewport.clientWidth - base.w * scaleRef.current) / 2,
      y: (viewport.clientHeight - base.h * scaleRef.current) / 2,
    };
    applyPanZoomDom();
  };

  const fitComfortToMarker = () => {
    const viewport = viewportRef.current;
    const base = baseSizeRef.current;
    const svg = contentRef.current?.querySelector("svg") as SVGSVGElement | null;
    const at = markerRef.current;
    if (!viewport || !base || !svg) return;
    if (!at && fitModeRef.current === "contain") {
      fitContainCenter();
      return;
    }
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
      } catch {
        translateRef.current = { x: 40, y: 40 };
      }
    } else {
      translateRef.current = { x: 40, y: 40 };
    }
    applyPanZoomDom();
  };

  useEffect(() => {
    const host = contentRef.current;
    if (!host) return;
    if (!markup) {
      host.innerHTML = "";
      appliedMarkupRef.current = "";
      baseSizeRef.current = null;
      return;
    }
    if (appliedMarkupRef.current === markup && host.querySelector("svg")) return;
    host.innerHTML = markup;
    appliedMarkupRef.current = markup;

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
    applyPanZoomDom();
    onMarkupAppliedRef.current?.(host, svg as SVGSVGElement);
    if (fitModeRef.current === "contain" && !markerRef.current) {
      // Center after layout so viewport has real size
      requestAnimationFrame(() => fitContainCenter());
    }
  }, [markup]);

  useEffect(() => {
    if (!markup) return;
    if (fitMode === "contain" && !markerAt) {
      fitContainCenter();
      return;
    }
    if (!fitToken) return;
    fitComfortToMarker();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit on token/marker/mode only
  }, [fitToken, markerAt, markup, fitMode]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let prevW = 0;
    let prevH = 0;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      if (prevW > 0 && (Math.abs(w - prevW) > 80 || Math.abs(h - prevH) > 80)) {
        requestAnimationFrame(() => {
          if (fitModeRef.current === "contain" && !markerRef.current) fitContainCenter();
          else if (markerRef.current) fitComfortToMarker();
        });
      }
      prevW = w;
      prevH = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewport resize only
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    /** Safari trackpad pinch reports absolute scale relative to gesturestart. */
    let safariGestureScale0 = 1;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Chrome Mac: pinch → wheel + ctrlKey.
      // Option/Alt + two-finger scroll → intentional zoom (Mac habit).
      // Cmd alone is left for browser chrome; still accept meta+wheel if browser sends it.
      const pinchZoom = e.ctrlKey || e.metaKey || e.altKey;
      // Mouse wheel zoom: LINE/PAGE (Firefox) or discrete PIXEL notches (Chrome/Edge).
      // Continuous PIXEL without modifier (trackpad two-finger) stays pan.
      const mouseWheel = !pinchZoom && isDiscreteMouseWheel(e);
      if (pinchZoom || mouseWheel) {
        const sensitivity = e.altKey && !e.ctrlKey ? 0.0025 : 0.01;
        const factor = pinchZoom
          ? Math.min(1.28, Math.max(0.78, Math.exp(-e.deltaY * sensitivity)))
          : e.deltaY > 0
            ? 0.9
            : 1.1;
        zoomAt(e.clientX, e.clientY, factor);
        return;
      }
      translateRef.current = {
        x: translateRef.current.x - e.deltaX,
        y: translateRef.current.y - e.deltaY,
      };
      applyPanZoomDom();
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      safariGestureScale0 = scaleRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const gScale = Number(ge.scale);
      if (!Number.isFinite(gScale) || gScale <= 0) return;
      const rect = el.getBoundingClientRect();
      const cx = typeof ge.clientX === "number" ? ge.clientX : rect.left + rect.width / 2;
      const cy = typeof ge.clientY === "number" ? ge.clientY : rect.top + rect.height / 2;
      const prev = scaleRef.current;
      if (!(prev > 0)) return;
      const next = Math.min(6, Math.max(0.15, safariGestureScale0 * gScale));
      zoomAt(cx, cy, next / prev);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    // WebKit / Safari Mac trackpad pinch (not exposed as standard wheel+ctrl).
    el.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    el.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
      el.removeEventListener("gestureend", onGestureEnd as EventListener);
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
      data-testid={testId}
      className={`svg-viewer w-full h-full bg-[var(--input-bg)] overflow-hidden relative cursor-grab active:cursor-grabbing ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onPointerUp(e);
      }}
    >
      {loading ? (
        <div
          data-testid="svg-loading"
          className="absolute inset-0 z-50 bg-[var(--bg-card)]/70 flex items-center justify-center text-xs font-mono text-emerald-700"
        >
          <span className="animate-pulse">Загрузка SVG…</span>
        </div>
      ) : null}
      {error ? (
        <div
          data-testid="svg-error"
          className="absolute inset-0 z-40 flex items-center justify-center text-sm text-rose-600 px-4 text-center"
        >
          {error}
        </div>
      ) : null}
      <div
        ref={panRef}
        className="origin-top-left will-change-transform"
        style={{ transform: "translate(40px, 40px)" }}
      >
        <div ref={contentRef} data-testid="svg-canvas" className="ewd-svg-root" />
      </div>
      {children}
      <div
        data-testid="svg-zoom-fab"
        className="svg-zoom-fab"
        title="Щипок / ⌥+скролл / кнопки — зум · два пальца — сдвиг"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Увеличить"
          title="Увеличить"
          className="svg-zoom-fab__btn"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, BUTTON_ZOOM_IN);
          }}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Уменьшить"
          title="Уменьшить"
          className="svg-zoom-fab__btn"
          onClick={() => {
            const el = viewportRef.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            zoomAt(r.left + r.width / 2, r.top + r.height / 2, BUTTON_ZOOM_OUT);
          }}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Сброс масштаба"
          title="Сброс масштаба"
          className="svg-zoom-fab__btn svg-zoom-fab__btn--reset"
          onClick={() => fitComfortToMarker()}
        >
          Сброс
        </button>
      </div>
    </div>
  );
}
