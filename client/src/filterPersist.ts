export type PersistedFilters = {
  model: string;
  year: string;
  engine: string;
  transmission: string;
  zone: string;
  code: string;
  theme?: string;
};

const STORAGE_KEY = "ewd.filters.v1";

export function readFiltersFromUrl(search = typeof window !== "undefined" ? window.location.search : ""): Partial<PersistedFilters> {
  const q = new URLSearchParams(search);
  const out: Partial<PersistedFilters> = {};
  for (const key of ["model", "year", "engine", "transmission", "zone", "code"] as const) {
    const v = q.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function readFiltersFromStorage(): Partial<PersistedFilters> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedFilters>;
  } catch {
    return {};
  }
}

/** URL wins over localStorage. */
export function loadPersistedFilters(): PersistedFilters {
  const fromUrl = readFiltersFromUrl();
  const fromStore = readFiltersFromStorage();
  return {
    model: fromUrl.model || fromStore.model || "",
    year: fromUrl.year || fromStore.year || "",
    engine: fromUrl.engine || fromStore.engine || "",
    transmission: fromUrl.transmission || fromStore.transmission || "",
    zone: fromUrl.zone || fromStore.zone || "all",
    code: fromUrl.code || fromStore.code || "",
    theme: fromStore.theme,
  };
}

/** Shared vehicle only — does not rewrite the current page URL. */
export function writeFiltersToStorage(patch: Partial<PersistedFilters>) {
  const cur = readFiltersFromStorage();
  const next: PersistedFilters = {
    model: patch.model !== undefined ? patch.model : cur.model || "",
    year: patch.year !== undefined ? patch.year : cur.year || "",
    engine: patch.engine !== undefined ? patch.engine : cur.engine || "",
    transmission: patch.transmission !== undefined ? patch.transmission : cur.transmission || "",
    zone: patch.zone !== undefined ? patch.zone : cur.zone || "all",
    code: patch.code !== undefined ? patch.code : cur.code || "",
    theme: patch.theme !== undefined ? patch.theme : cur.theme,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function savePersistedFilters(f: PersistedFilters) {
  writeFiltersToStorage(f);
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  const setOrDel = (k: string, v: string) => {
    if (v && !(k === "zone" && v === "all")) u.searchParams.set(k, v);
    else u.searchParams.delete(k);
  };
  setOrDel("model", f.model);
  setOrDel("year", f.year);
  setOrDel("engine", f.engine);
  setOrDel("transmission", f.transmission);
  setOrDel("zone", f.zone);
  setOrDel("code", f.code);
  window.history.replaceState(null, "", u.pathname + u.search + u.hash);
}

/** Query for cross-section links. Extra keys (vin, fg) only if non-empty. */
export function vehicleSearchParams(
  model: string,
  year: string,
  extra?: Record<string, string | undefined | null>,
): string {
  const qs = new URLSearchParams();
  const m = String(model || "").trim();
  const y = String(year || "").trim();
  if (m) qs.set("model", m);
  if (y) qs.set("year", y);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      const s = String(v || "").trim();
      if (s) qs.set(k, s);
    }
  }
  return qs.toString();
}

export function vehicleHref(
  path: string,
  model: string,
  year: string,
  extra?: Record<string, string | undefined | null>,
): string {
  const q = vehicleSearchParams(model, year, extra);
  const base = path.startsWith("/") ? path : `/${path}`;
  return q ? `${base}?${q}` : base;
}

/** URL query wins; otherwise shared store. No hardcoded model/year. */
export function initialSharedVehicle(): { model: string; year: string } {
  const fromUrl = readFiltersFromUrl();
  if (fromUrl.model || fromUrl.year) {
    return { model: fromUrl.model || "", year: fromUrl.year || "" };
  }
  const saved = readFiltersFromStorage();
  return { model: saved.model || "", year: saved.year || "" };
}
