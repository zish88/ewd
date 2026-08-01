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

/** Exact stroke paths from `maintenance-volvo.svg` — circuit follows the drawing. */
const CIRCUIT_ROUTES: { cls: string; d: string }[] = [
  {
    cls: "a",
    d: "M16.323,171.828l-1.09-6.188c-1.772-9.736-2.664-19.609-2.664-29.503c0-3.266,0.097-6.526,0.289-9.781c-0.038-0.833-0.056-1.664-0.056-2.495c0-9.053,2.245-17.957,6.537-25.925c0,0,7.067-27.532,21.024-40.415C50.159,41.688,64.592,28.397,77.937,17.4C82.686,13.486,90.16,7.453,98.615,0.71",
  },
  {
    cls: "b",
    d: "M255.283,0.125l29.244,19.365c22.07,12.669,58.033,31.993,81.519,41.386l15.566,6.307c10.332,3.893,45.772,13.997,70.063,9.435",
  },
  {
    cls: "c",
    d: "M468.64,73.389c-8.854,3.166-20.79,5.37-28.015,5.72c-1.043,0.049-1.253,0.625-1.323,0.833c0,0-0.289-0.589-2.036-0.579c-7.649,0.03-25.666-1.108-55.957-10.065c-30.295-8.957-70.753-27.575-91.385-38.948c-13.611-7.503-31.563-18.118-47.548-29.328",
  },
  {
    cls: "d",
    d: "M226.911,297.042c-0.576,0.04-1.151,0.06-1.731,0.06c-0.687,0-1.376-0.031-2.06-0.086c-6.693-0.257-13.375-0.699-20.042-1.328c-15.258-1.627-30.42-4.063-45.419-7.309c-1.047-0.297-2.062-0.709-3.019-1.227l-1.366-0.779c0,0-4.434-2.246-8.217-3.984c-3.781-1.736-25.521-11.604-51.488-26.701c-25.965-15.094-47.503-30.635-50.925-32.75c0,0-2.716-1.769-4.228-2.674c-1.554-0.937-2.543-1.762-3.32-2.82c-1.107-1.509-7.449-13.183-9.151-17.738",
  },
  {
    cls: "e",
    d: "M51.107,247.643l25.555,17.228c22.674,14.39,46.479,26.912,71.182,37.436c1.981,0.929,3.919,1.961,5.8,3.086c4.751,3.618,10.391,5.896,16.326,6.582c24.876,4.176,49.984,6.823,75.186,7.933c6.223,0.585,14.26,0.297,20.513,0.297c21.399,0,40.366-2.83,60.694-9.518c1.722-0.472,3.223-1.54,4.226-3.017c0.94-1.847,1.79-3.729,2.55-5.656l3.372-8.619c-0.146-0.823-0.219-1.653-0.219-2.484c0-1.206,0.154-2.41,0.454-3.577c4.816-22.07,13.941-42.97,26.86-61.501c0.188-0.144,0.293-0.37,0.293-0.604l-0.203-0.503l1.005-0.601c0,0,16.355-22.728,36.501-35.094c19.457-11.942,30.466-15.47,41.599-14.355c9.395,0.936,13.956,6.438,15.703,8.317",
  },
  {
    cls: "f",
    d: "M201.278,218.684c0,0,0.181,0.608,1.696,0.124c1.518-0.484,8.492-2.004,14.193-2.063c5.698-0.062,33.472,0,42.81-0.304c9.34-0.304,25.772-2.063,31.108-3.153c5.337-1.091,6.187-1.881,10.128-4.488s90.192-60.833,104.419-69.958c14.221-9.125,22.675-13.017,25.629-27.106c2.952-14.09,2.685-15.567,3.623-18.922c0.94-3.354,3.756-12.749,3.756-12.749s0.038-0.056,0.036-0.139",
  },
  {
    cls: "g",
    d: "M339.542,67.789c-27.377,16.705-142.913,85.344-173.107,110.101",
  },
  {
    cls: "h",
    d: "M192.199,209.09c36.233-16.909,208.331-96.616,238.322-112.116",
  },
  {
    cls: "i",
    d: "M426.208,118.139c-25.51,12.02-172.224,72.264-192.342,80.888",
  },
  {
    cls: "j",
    d: "M332.625,305.379c18.877,12.879,35.029,19.062,35.029,19.062c24.247,7.6,55.679-12.519,74.474-47.32c20.048-37.129,16.86-74.314-2.082-88.819c0,0-6.273-4.473-12.58-8.098",
  },
  {
    cls: "k",
    d: "M40.363,124.483C59.535,79.485,89.574,30.525,116.486,0.844",
  },
  {
    cls: "l",
    d: "M20.951,188.59l2.545,9.567c2.16,8.113,5.417,15.889,9.681,23.111c3.932,6.668,9.039,12.567,15.075,17.413c3.389,2.892,6.966,5.452,10.634,7.979c26.576,18.282,54.95,33.937,84.322,47.271",
  },
];

const PULSE_ROUTES: { cls: string; d: string }[] = [
  { cls: "1", d: CIRCUIT_ROUTES[0].d },
  { cls: "2", d: CIRCUIT_ROUTES[2].d },
  { cls: "3", d: CIRCUIT_ROUTES[5].d },
  { cls: "4", d: CIRCUIT_ROUTES[4].d },
  { cls: "5", d: CIRCUIT_ROUTES[9].d },
];

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
          viewBox="0 0 475.469 344.941"
          fill="none"
        >
          {CIRCUIT_ROUTES.map((route) => (
            <path
              key={route.cls}
              className={`empty-state-hero__route empty-state-hero__route--${route.cls}`}
              pathLength="1000"
              d={route.d}
            />
          ))}
          {PULSE_ROUTES.map((pulse) => (
            <path
              key={pulse.cls}
              className={`empty-state-hero__pulse empty-state-hero__pulse--${pulse.cls}`}
              pathLength="1000"
              d={pulse.d}
            />
          ))}
          <circle className="empty-state-hero__node empty-state-hero__node--lamp" cx="98.6" cy="8" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--connector" cx="16.3" cy="172" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--door" cx="201.3" cy="218.7" r="4.5" />
          <circle className="empty-state-hero__node empty-state-hero__node--ecu" cx="430.5" cy="96.9" r="4.5" />
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
