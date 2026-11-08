const CACHE_VERSION = "v81";
const APP_CACHE = "nadwa-app-" + CACHE_VERSION;
const FIREBASE_CACHE = "nadwa-firebase-" + CACHE_VERSION;
const APP_SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg"];

// Keep the essential application files available after the first successful visit.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // Keep Firebase's version-pinned module caches across app releases.
          // A new app cache version must never erase the only offline copy of auth modules.
          .filter(key => /^nadwa-(offline|app)-/.test(key) && key !== APP_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache Firebase's version-pinned browser modules after a successful online load.
  // This allows the app shell and already-loaded Firebase modules to reopen offline.
  if (url.origin !== self.location.origin) {
    if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/10.8.0/")) {
      event.respondWith(
        caches.open(FIREBASE_CACHE).then(async cache => {
          const cached = await cache.match(request);
          if (cached) return cached;
          // Fall back to a Firebase module saved by an earlier app-cache version.
          const cacheNames = await caches.keys();
          for (const cacheName of cacheNames) {
            if (!cacheName.startsWith("nadwa-firebase-") || cacheName === FIREBASE_CACHE) continue;
            const previousCache = await caches.open(cacheName);
            const previousResponse = await previousCache.match(request);
            if (previousResponse) {
              await cache.put(request, previousResponse.clone());
              return previousResponse;
            }
          }
          try {
            const response = await fetch(request);
            if (response && response.ok) await cache.put(request, response.clone());
            return response;
          } catch (error) {
            return new Response("Firebase module unavailable offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
          }
        })
      );
    }
    return;
  }

  // Exchange rates must be network-first so the five-hour JSON update is never stuck in cache.
  if (url.pathname.endsWith("/rates.json")) {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        return cached || new Response("أسعار الصرف غير متاحة دون اتصال.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }

  const isNavigation = request.mode === "navigate" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith("/");

  if (isNavigation) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(async response => {
          if (response && response.ok) {
            const cache = await caches.open(APP_CACHE);
            await cache.put(request, response.clone());
            // Keep the canonical entry point available for offline navigation.
            if (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) {
              await cache.put("./index.html", response.clone());
            }
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("./index.html") ||
            new Response("التطبيق غير متاح حالياً دون اتصال.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        })
    );
    return;
  }

  // Same-origin static resources use cache-first; do not return index.html for a missing image.
  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(APP_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return new Response("", { status: 503, statusText: "Offline" });
      }
    })
  );
});
