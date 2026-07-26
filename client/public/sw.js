/* Shell-only service worker: caches app shell, never /api/* or EWD SVG assets. */
const CACHE = "volvo-ewd-shell-v4";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/apple-touch-icon-167.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Don't fail install if one icon 404s — otherwise push handler never activates.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isBypass(url) {
  const p = url.pathname;
  if (p.startsWith("/api/")) return true;
  if (p.includes("/ewd/") || p.endsWith(".svg")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isBypass(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/") || caches.match("/index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (
          res.ok &&
          (url.pathname.startsWith("/assets/") ||
            url.pathname.startsWith("/icons/") ||
            url.pathname === "/manifest.webmanifest")
        ) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {
        title: "Volvo EWD",
        body: "Сайт обновлён",
        url: "/",
        requireInteraction: false,
      };
      try {
        if (event.data) {
          const parsed = event.data.json();
          data = {
            title: String(parsed.title || data.title),
            body: String(parsed.body || data.body),
            url: String(parsed.url || "/"),
            requireInteraction: Boolean(parsed.requireInteraction),
          };
        }
      } catch {
        try {
          const text = event.data && event.data.text();
          if (text) data.body = text;
        } catch {
          /* keep defaults */
        }
      }

      const opts = {
        body: data.body,
        data: { url: data.url },
        tag: "ewd-deploy",
        renotify: true,
        silent: false,
        requireInteraction: data.requireInteraction,
      };

      try {
        await self.registration.showNotification(data.title, {
          ...opts,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
        });
      } catch {
        // Icon / platform quirks — still show a bare banner.
        await self.registration.showNotification(data.title, opts);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  let target = "/";
  try {
    target = new URL(raw, self.location.origin).pathname + new URL(raw, self.location.origin).search;
  } catch {
    target = "/";
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client && client.url !== target) {
            try {
              client.navigate(target);
            } catch {
              /* ignore */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});
