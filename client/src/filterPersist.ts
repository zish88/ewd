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

export function savePersistedFilters(f: PersistedFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* ignore quota */
  }
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
  // Keep wireId if present (deep link to card)
  window.history.replaceState(null, "", u.pathname + u.search + u.hash);
}
