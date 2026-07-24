import { useEffect, useRef, useState } from "react";
import {
  alignPrimaryUidForFrom,
  clearPinMarkers,
  highlightTarget,
} from "./ewdHighlight.js";
import { SvgPanZoomHost } from "./SvgPanZoomHost.js";

export type WireEndFocus = {
  code: string;
  pin?: string;
  pinCandidates?: string[];
  uid?: string;
  role?: "from" | "to" | "selected" | "peer" | "primary";
};

export type ActiveSvgView = {
  diagramUid: string;
  searchCode: string;
  objectIds?: string[];
  pin?: string;
  pinCandidates?: string[];
  wireColor?: string;
  wireUid?: string;
  pinUid?: string;
  peerCode?: string;
  peerPin?: string;
  zone?: string;
  pinFrom?: string;
  pinTo?: string;
  fromCode?: string;
  toCode?: string;
  ends?: WireEndFocus[];
  optionTokens?: string[];
  showSeq?: number;
};

function normalizeCodeLabel(s: string): string {
  const m = String(s || "").trim().match(/^(\d+)[A-Z]?\/(\d+)/i);
  return m ? `${m[1]}/${m[2]}` : String(s || "").trim();
}

export function SvgDiagramViewer({
  diagramUid,
  searchCode,
  objectIds = [],
  pin = "",
  pinCandidates = [],
  wireColor = "",
  wireUid = "",
  pinUid = "",
  peerCode = "",
  peerPin = "",
  zone = "",
  pinFrom = "",
  pinTo = "",
  fromCode = "",
  toCode = "",
  ends = [],
  optionTokens = [],
  showSeq = 0,
  onPinMiss,
}: ActiveSvgView & { onPinMiss?: (reason: string) => void }) {
  const onPinMissRef = useRef(onPinMiss);
  onPinMissRef.current = onPinMiss;
  const [highlightReady, setHighlightReady] = useState(false);
  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const paintedKeyRef = useRef("");
  const [svgMarkup, setSvgMarkup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveUids, setResolveUids] = useState<string[]>([]);
  const [wireUids, setWireUids] = useState<string[]>([]);
  const [pinUids, setPinUids] = useState<string[]>([]);
  const [netPins, setNetPins] = useState<{
    pinFrom?: string;
    pinTo?: string;
    fromUid?: string;
    toUid?: string;
    primaryUid?: string;
    secondaryUid?: string;
  }>({});
  const [markerAt, setMarkerAt] = useState<{ x: number; y: number } | null>(null);
  const [fitToken, setFitToken] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSvgMarkup("");
    setResolveUids([]);
    setWireUids([]);
    setPinUids([]);
    setMarkerAt(null);
    paintedKeyRef.current = "";
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
    setHighlightReady(false);
    if (!pin && !pinCandidates.length && !wireColor && !peerCode) {
      setResolveUids([]);
      setWireUids([]);
      setPinUids([]);
      setNetPins({});
      setHighlightReady(true);
      return;
    }
    const params = new URLSearchParams({ code: searchCode, diagramUid });
    const pinForApi = pin || pinCandidates[0] || "";
    if (pinForApi) params.set("pin", pinForApi);
    if (wireColor) params.set("color", wireColor);
    if (peerCode) params.set("peer", peerCode);
    if (wireUid) params.set("wireUid", wireUid);
    if (pinUid) params.set("pinUid", pinUid);
    if (zone && zone !== "all") params.set("zone", zone);
    if (optionTokens.length) params.set("optionTokens", optionTokens.join(","));
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
              wireUid?: string;
            }>)
          : [];
        const peerN = normalizeCodeLabel(peerCode);
        const fromN = normalizeCodeLabel(fromCode || searchCode);
        const fromPinWant = String(pinFrom || pin || pinCandidates[0] || "").trim();
        const preferred =
          matchedList.find((m) => {
            if (wireUid && m.wireUid && m.wireUid !== wireUid) return false;
            const epFrom = normalizeCodeLabel(m.from || "");
            const epTo = normalizeCodeLabel(m.to || "");
            const onFrom =
              (epFrom === fromN || epTo === fromN) &&
              (!peerN || epFrom === peerN || epTo === peerN || !peerN);
            const pinHit =
              !fromPinWant ||
              String(m.pinFrom || "").trim() === fromPinWant ||
              String(m.pinTo || "").trim() === fromPinWant;
            return onFrom && pinHit;
          }) ||
          matchedList.find((m) => {
            if (wireUid && m.wireUid && m.wireUid !== wireUid) return false;
            const blob = `${m.from || ""} ${m.to || ""}`;
            return fromN && blob.includes(fromN);
          }) ||
          matchedList[0] ||
          null;
        const aligned = alignPrimaryUidForFrom({
          fromCode: fromN,
          fromPin: fromPinWant,
          matched: preferred,
          cardPinUid: pinUid,
        });
        const apiWireUids = Array.isArray(data.wireUids) ? (data.wireUids as string[]) : [];
        // Card wireUid is preferred seed; API may expand the full on-sheet path to the terminal
        const paintWires = [
          ...(wireUid ? [wireUid] : []),
          ...(preferred?.wireUid && preferred.wireUid !== wireUid ? [preferred.wireUid] : []),
          ...apiWireUids,
        ];
        // Marker UIDs: Откуда side only — never merge toUid into primary resolve pool
        const markerPins = [aligned.primaryUid].filter(Boolean);
        setResolveUids(markerPins.slice(0, 8));
        setWireUids([...new Set(paintWires.filter(Boolean))].slice(0, 8));
        setPinUids(markerPins.slice(0, 16));
        setNetPins({
          pinFrom: String(pinFrom || preferred?.pinFrom || "").trim() || undefined,
          pinTo: String(pinTo || preferred?.pinTo || "").trim() || undefined,
          fromUid: String(preferred?.fromUid || "").trim() || undefined,
          toUid: String(preferred?.toUid || "").trim() || undefined,
          primaryUid: aligned.primaryUid || undefined,
          secondaryUid: aligned.secondaryUid || undefined,
        });
        setHighlightReady(true);
      })
      .catch(() => {
        if (alive) {
          const aligned = alignPrimaryUidForFrom({
            fromCode: fromCode || searchCode,
            fromPin: pinFrom || pin || "",
            matched: null,
            cardPinUid: pinUid,
          });
          setResolveUids(aligned.primaryUid ? [aligned.primaryUid] : []);
          setWireUids(wireUid ? [wireUid] : []);
          setPinUids(aligned.primaryUid ? [aligned.primaryUid] : []);
          setNetPins({ primaryUid: aligned.primaryUid || undefined });
          setHighlightReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [
    diagramUid,
    searchCode,
    pin,
    pinCandidates,
    wireColor,
    wireUid,
    pinUid,
    peerCode,
    zone,
    pinFrom,
    pinTo,
    fromCode,
    toCode,
    ends,
    objectIds,
    optionTokens,
  ]);

  useEffect(() => {
    if (!svgMarkup || !contentRootRef.current) return;
    if (!pin && !pinCandidates.length && !wireColor && !searchCode) return;
    if (!highlightReady) return;
    const root = contentRootRef.current;
    const svg = root.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const selectedPins = [
      ...new Set([pin, ...pinCandidates].map((p) => String(p || "").trim()).filter(Boolean)),
    ];
    const endFromCode = normalizeCodeLabel(fromCode || searchCode);
    const endToCode = normalizeCodeLabel(toCode || peerCode);
    const primaryUid = netPins.primaryUid || "";
    const secondaryUid = netPins.secondaryUid || "";
    const wireEnds: WireEndFocus[] =
      Array.isArray(ends) && ends.length
        ? ends.map((e) => ({ ...e }))
        : [
            ...(endFromCode
              ? [
                  {
                    code: endFromCode,
                    pin: String(pinFrom || selectedPins[0] || "").trim(),
                    pinCandidates: [pinFrom || selectedPins[0] || ""].filter(Boolean),
                    uid: primaryUid || undefined,
                    role: "selected" as const,
                  },
                ]
              : []),
            ...(endToCode && endToCode !== endFromCode
              ? [
                  {
                    code: endToCode,
                    pin: String(pinTo || peerPin || "").trim(),
                    pinCandidates: [pinTo || peerPin || ""].filter(Boolean),
                    uid: secondaryUid || undefined,
                    role: "to" as const,
                  },
                ]
              : []),
          ];
    if (!wireEnds.length) {
      wireEnds.push({
        code: endFromCode || normalizeCodeLabel(searchCode),
        pin: selectedPins[0] || "",
        pinCandidates: selectedPins,
        uid: primaryUid || undefined,
        role: "selected",
      });
    }
    // Bind aligned Откуда UID only — never toUid / blind card pinUid on wrong side
    const primary =
      wireEnds.find(
        (e) => e.role === "selected" || e.role === "primary" || e.role === "from",
      ) || wireEnds[0];
    if (primary) {
      primary.uid = primaryUid || primary.uid || undefined;
      if (!primary.code) primary.code = endFromCode;
      if (!primary.pin && selectedPins[0]) primary.pin = selectedPins[0];
    }
    const toEnd = wireEnds.find((e) => e.role === "to" || e.role === "peer");
    if (toEnd && secondaryUid) toEnd.uid = secondaryUid;
    const primaryEnd = primary || null;
    const focusKey = `${diagramUid}|${endFromCode}|${wireEnds.map((e) => `${e.code}:${e.pin || ""}:${e.uid || ""}`).join("/")}|${wireColor}|${primaryUid}|${showSeq}|${wireUids.join(",")}`;

    const result = highlightTarget(root, svg, {
      connectorCode: primaryEnd?.code || endFromCode || searchCode,
      pinNumber: primaryEnd?.pin || selectedPins[0] || pin,
      pinCandidates: primaryEnd?.pin
        ? [primaryEnd.pin, ...selectedPins.filter((p) => p !== primaryEnd.pin)]
        : selectedPins,
      wireColor,
      systemUid: primaryUid || resolveUids[0],
      resolveUids: primaryUid ? [primaryUid] : resolveUids,
      wireUids,
      pinUids: primaryUid ? [primaryUid] : pinUids,
      diagramUid,
      peerCode: endToCode || peerCode,
      peerPin: peerPin || pinTo || netPins.pinTo,
      ends: wireEnds,
    });

    paintedKeyRef.current = focusKey;

    if (selectedPins.length && result.stage === "none") {
      // Strip leftover circles before retry — never leave Куда marker (keep wire paint)
      try {
        clearPinMarkers(svg);
      } catch {
        /* ignore */
      }
      setMarkerAt(null);
      onPinMissRef.current?.(result.reason || "pin-miss");
      return;
    }

    if (result.markerAt) {
      setMarkerAt(result.markerAt);
      setFitToken((n) => n + 1);
    }
  }, [
    svgMarkup,
    searchCode,
    diagramUid,
    resolveUids,
    wireUids,
    pinUids,
    pin,
    pinCandidates,
    wireColor,
    wireUid,
    pinUid,
    peerCode,
    peerPin,
    pinFrom,
    pinTo,
    fromCode,
    toCode,
    ends,
    showSeq,
    netPins.pinFrom,
    netPins.pinTo,
    netPins.fromUid,
    netPins.toUid,
    highlightReady,
  ]);

  return (
    <SvgPanZoomHost
      markup={svgMarkup}
      loading={loading}
      error={error}
      markerAt={markerAt}
      fitToken={fitToken}
      onMarkupApplied={(root) => {
        contentRootRef.current = root;
      }}
    />
  );
}
