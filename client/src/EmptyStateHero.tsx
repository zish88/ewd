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

const GREETING = "Добро пожаловать";

const INTRO =
  "Электросхемы EWD, поиск узлов и DTC — плюс база знаний по платформам Volvo: типовые отказы, запчасти и выжимки с форумов.";

const HINT = "Выберите авто, зону и узел выше — или откройте «База знаний» в меню.";


/** Five Capital TwoDviews — clean stroke silhouettes (no callout diagrams). */
const SILHOUETTES: readonly string[] = [
  "/bg/bg-v70-xc70-b.svg",
  "/bg/bg-xc60-b.svg",
  "/bg/bg-s80.svg",
  "/bg/bg-s60-v60.svg",
  "/bg/bg-v70-xc70-s80-a.svg",
];

const CROSSFADE_MS = 2800;
const HOLD_MS = 4800;

function startIndexForModel(model: string): number {
  const m = model.trim().toUpperCase();
  if (/XC70|V70/.test(m)) return 0;
  if (/XC60/.test(m)) return 1;
  if (/S80/.test(m)) return 2;
  if (/S60|V60/.test(m)) return 3;
  return 0;
}

export function EmptyStateHero({ selectedModel }: EmptyStateHeroProps) {
  const [activeIndex, setActiveIndex] = useState(() => startIndexForModel(selectedModel));
  const [activeDetail, setActiveDetail] = useState<DetailId | null>(null);
  const tapClearRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveIndex(startIndexForModel(selectedModel));
  }, [selectedModel]);

  useEffect(() => {
    if (activeDetail) return;
    const id = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % SILHOUETTES.length);
    }, HOLD_MS + CROSSFADE_MS);
    return () => window.clearInterval(id);
  }, [activeDetail]);

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
    }, 1600);
  };

  return (
    <div
      className="empty-state-hero"
      data-testid="empty-state-hero"
      data-active-detail={activeDetail ?? undefined}
    >
      <div className="empty-state-hero__halo" aria-hidden="true" />

      <div className="empty-state-hero__stage" aria-hidden="true">
        {SILHOUETTES.map((src, i) => (
          <div
            key={src}
            className={`empty-state-hero__car${i === activeIndex ? " is-active" : ""}`}
            data-testid={i === activeIndex ? "empty-state-silhouette" : undefined}
            style={{ ["--esh-sil" as string]: `url("${src}")` }}
          />
        ))}
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
        <p className="empty-state-hero__greeting" data-testid="empty-state-greeting">
          {GREETING}
        </p>
        <p className="empty-state-hero__intro" data-testid="empty-state-intro">
          {INTRO}
        </p>
        <p className="empty-state-hero__instruction" data-testid="empty-state-instruction">
          {HINT}
        </p>
      </div>
    </div>
  );
}
