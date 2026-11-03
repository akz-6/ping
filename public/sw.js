// Service Worker do Ping (PWA - Fase 5)
// Garante shell offline rápido sem interferir em conexões WebSockets, PeerJS ou WebRTC.

const CACHE_NAME = "ping-shell-v1";
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/icon.svg",
  "/manifest.webmanifest",
  "/theme-init.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ping-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nunca intercepta WebRTC, WebSockets, PeerJS ou chamadas para APIs externas/Supabase
  if (
    req.method !== "GET" ||
    url.protocol.startsWith("ws") ||
    url.pathname.includes("/peerjs") ||
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("metered.ca")
  ) {
    return;
  }

  // Requisições de navegação: Network-first com fallback para cache
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match("/");
      }),
    );
    return;
  }

  // Ativos estáticos com hash no nome (Vite dist assets) ou fontes: Cache-first
  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".woff2") || url.pathname.endsWith(".svg")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Demais requisições: Network com fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
