/* eslint-disable no-restricted-globals */
const PRECACHE_NAME = "skillconnect-precache-v1";
const RUNTIME_NAME = "skillconnect-runtime-v1";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/favicon.png",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png"
];

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;
  await cache.delete(keys[0]);
  return trimCache(cacheName, maxItems);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== PRECACHE_NAME && n !== RUNTIME_NAME)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // App shell: navigation requests should work offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(PRECACHE_NAME);
          cache.put("/index.html", networkResponse.clone());
          return networkResponse;
        } catch {
          const cached = await caches.match("/index.html", { ignoreSearch: true });
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Skip cross-origin runtime caching to avoid surprising behavior.
  if (!isSameOrigin) return;

  const destination = request.destination;

  // Static assets: stale-while-revalidate.
  if (destination === "style" || destination === "script" || destination === "font") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);
        return cached || (await fetchPromise) || Response.error();
      })()
    );
    return;
  }

  // Images: cache-first (with a soft cap).
  if (destination === "image") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put(request, response.clone());
            trimCache(RUNTIME_NAME, 60);
          }
          return response;
        } catch {
          return Response.error();
        }
      })()
    );
    return;
  }
});

