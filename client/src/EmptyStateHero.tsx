import { useEffect, useRef, useState } from "react";

type EmptyStateHeroProps = {
  selectedModel: string;
};

type DetailId = "connector" | "door" | "lamp" | "ecu";

type Detail = {
  id: DetailId;
  label: string;
  shortLabel: string;
};

const DETAILS: Detail[] = [
  { id: "connector", label: "Разъёмы", shortLabel: "Разъёмы" },
  { id: "door", label: "Двери", shortLabel: "Двери" },
  { id: "lamp", label: "Свет", shortLabel: "Свет" },
  { id: "ecu", label: "ECU", shortLabel: "ECU" },
];

const INSTRUCTION =
  "Выберите авто, зону и узел — или найдите код ошибки DTC / OBD выше.";

function silhouetteForModel(model: string): string {
  const m = model.trim().toUpperCase();
  if (m === "XC70" || m === "V70") return "/bg/bg-v70-xc70-s80-a.svg";
  if (m === "XC60") return "/bg/bg-xc60-a.svg";
  if (m === "S80") return "/bg/bg-s80.svg";
  if (m === "S60" || m === "V60") return "/bg/bg-s60-v60.svg";
  return "/maintenance-volvo.svg";
}

export function EmptyStateHero({ selectedModel }: EmptyStateHeroProps) {
  const maskUrl = silhouetteForModel(selectedModel);
  const [activeDetail, setActiveDetail] = useState<DetailId | null>(null);
  const [carVisible, setCarVisible] = useState(true);
  const [displayMask, setDisplayMask] = useState(maskUrl);
  const tapClearRef = useRef<number | null>(null);

  useEffect(() => {
    if (maskUrl === displayMask) return;
    setCarVisible(false);
    const t = window.setTimeout(() => {
      setDisplayMask(maskUrl);
      setCarVisible(true);
    }, 180);
    return () => window.clearTimeout(t);
  }, [maskUrl, displayMask]);

  useEffect(
    () => () => {
      if (tapClearRef.current != null) window.clearTimeout(tapClearRef.current);
    },
    [],
  );

  const clearTapTimer = () => {
    if (tapClearRef.current != null) {
      window.clearTimeout(tapClearRef.current);
      tapClearRef.current = null;
    }
  };

  const activateSticky = (id: DetailId) => {
    clearTapTimer();
    setActiveDetail(id);
    tapClearRef.current = window.setTimeout(() => {
      setActiveDetail(null);
      tapClearRef.current = null;
    }, 1500);
  };

  return (
    <div
      className="empty-state-hero"
      data-testid="empty-state-hero"
      data-active-detail={activeDetail ?? undefined}
    >
      <div className="empty-state-hero__halo" aria-hidden="true" />

      <div className="empty-state-hero__stage" aria-hidden="true">
        <div
          className={`empty-state-hero__car${carVisible ? " is-visible" : ""}`}
          data-testid="empty-state-silhouette"
          style={{
            WebkitMaskImage: `url("${displayMask}"), radial-gradient(ellipse 78% 72% at 50% 50%, #000 48%, transparent 88%)`,
            maskImage: `url("${displayMask}"), radial-gradient(ellipse 78% 72% at 50% 50%, #000 48%, transparent 88%)`,
          }}
        />

        <svg
          className="empty-state-hero__circuit"
          data-testid="empty-state-circuit"
          viewBox="0 0 480 320"
          fill="none"
        >
          <path
            className="empty-state-hero__route empty-state-hero__route--a"
            d="M72 168 H168 C196 168 210 142 240 142 H312 C338 142 352 118 378 118 H420"
          />
          <path
            className="empty-state-hero__route empty-state-hero__route--b"
            d="M96 214 H188 C220 214 236 188 268 188 H348 C372 188 386 210 410 210"
          />
          <path
            className="empty-state-hero__route empty-state-hero__route--c"
            d="M128 96 V148 C128 172 148 186 172 186 H248"
          />
          <path
            className="empty-state-hero__route empty-state-hero__route--d"
            d="M248 186 H304 C336 186 352 230 384 230 H428"
          />
          <path
            className="empty-state-hero__pulse"
            d="M72 168 H168 C196 168 210 142 240 142 H312 C338 142 352 118 378 118 H420"
          />
          <circle className="empty-state-hero__node empty-state-hero__node--connector" cx="168" cy="168" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--door" cx="240" cy="142" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--lamp" cx="248" cy="186" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--ecu" cx="378" cy="118" r="4.5" />
        </svg>
      </div>

      <div className="empty-state-hero__orbit">
        {DETAILS.map((detail) => (
          <button
            key={detail.id}
            type="button"
            className={`empty-state-hero__detail empty-state-hero__detail--${detail.id}${
              activeDetail === detail.id ? " is-active" : ""
            }`}
            data-testid={`empty-state-detail-${detail.id}`}
            aria-label={detail.label}
            onMouseEnter={() => {
              clearTapTimer();
              setActiveDetail(detail.id);
            }}
            onMouseLeave={() => {
              clearTapTimer();
              setActiveDetail(null);
            }}
            onFocus={() => {
              clearTapTimer();
              setActiveDetail(detail.id);
            }}
            onBlur={() => {
              clearTapTimer();
              setActiveDetail(null);
            }}
            onClick={() => activateSticky(detail.id)}
          >
            <span
              className={`empty-state-hero__detail-icon empty-state-hero__detail-icon--${detail.id}`}
              aria-hidden="true"
            />
            <span className="empty-state-hero__detail-label">{detail.shortLabel}</span>
          </button>
        ))}
      </div>

      <div className="empty-state-hero__copy">
        <p className="empty-state-hero__wordmark">VOLVO EWD</p>
        <p className="empty-state-hero__instruction" data-testid="empty-state-instruction">
          {INSTRUCTION}
        </p>
      </div>
    </div>
  );
}
