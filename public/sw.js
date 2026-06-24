const DATA_CACHE = "mo-data-v1";
const ICON_CACHE = "mo-icons-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Decisions are member-gated and rate-limited — never serve or store a cached copy.
  if (url.pathname.startsWith("/api/decision/")) return;

  if (url.pathname.startsWith("/data/")) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(request, ICON_CACHE));
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
