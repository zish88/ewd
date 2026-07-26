/** Web Push opt-in for deploy update notifications. */

export type PushUiState = "unsupported" | "unavailable" | "off" | "on" | "pending";

const LS_KEY = "ewd_push_opt";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushFeatureSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const r = await fetch("/api/push/vapid-public-key");
    if (!r.ok) return null;
    const d = (await r.json()) as { publicKey?: string };
    return String(d.publicKey || "").trim() || null;
  } catch {
    return null;
  }
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } else if (existing.active) {
    // Ask waiting/updated worker to take over so push handler is current.
    existing.update().catch(() => {});
  }
  return navigator.serviceWorker.ready;
}

export async function getPushUiState(): Promise<PushUiState> {
  if (!pushFeatureSupported()) return "unsupported";
  const key = await fetchVapidPublicKey();
  if (!key) return "unavailable";
  if (Notification.permission === "denied") return "unavailable";
  try {
    const reg = await ensureServiceWorker();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try {
        localStorage.setItem(LS_KEY, "1");
      } catch {
        /* ignore */
      }
      return "on";
    }
  } catch {
    /* fall through */
  }
  return "off";
}

export async function enablePushNotifications(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushFeatureSupported()) {
    return { ok: false, error: "Браузер не поддерживает уведомления" };
  }
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    return { ok: false, error: "Уведомления ещё не настроены на сервере" };
  }
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return { ok: false, error: "Разрешение на уведомления отклонено" };
  }
  const reg = await ensureServiceWorker();
  // Always resubscribe with the current server VAPID public key.
  // Reusing an old PushSubscription after VAPID rotation → FCM 403 on send.
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      /* ignore */
    }
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, error: "Браузер не вернул ключи подписки" };
  }
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: d.error || "Не удалось сохранить подписку" };
  }
  try {
    localStorage.setItem(LS_KEY, "1");
  } catch {
    /* ignore */
  }
  // Local smoke: OS must allow banners (Windows «Фокусировка» часто глушит тосты).
  try {
    await reg.showNotification("Volvo EWD", {
      body: "Уведомления включены. Если это видно — пуш работает.",
      tag: "ewd-push-opt-in",
      icon: "/icons/icon-192.png",
    });
  } catch {
    /* permission edge cases */
  }
  return { ok: true };
}

export async function disablePushNotifications(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushFeatureSupported()) return { ok: true };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  return { ok: true };
}
