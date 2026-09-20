/** One public visit per browser tab session — richer context, still privacy-light. */

const SESSION_KEY = "ewd_visit_sid";

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `anon${Date.now().toString(36)}`;
  }
}

/** Fire-and-forget; ignore errors (adblock / offline). */
export function trackVisitOnce(): void {
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}`.slice(0, 200);
  if (path.startsWith("/admin")) return;

  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    /* ignore */
  }

  const body = {
    sessionId: sessionId(),
    path,
    timezone,
    lang: typeof navigator !== "undefined" ? String(navigator.language || "").slice(0, 16) : "",
    screenW: typeof screen !== "undefined" ? screen.width : undefined,
    screenH: typeof screen !== "undefined" ? screen.height : undefined,
    referrer: typeof document !== "undefined" ? String(document.referrer || "").slice(0, 300) : "",
  };

  void fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
