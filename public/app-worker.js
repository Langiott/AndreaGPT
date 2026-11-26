const cacheName = "andreagpt-connection-v1";
const offlinePage = "/app-connection.html";
const offlineIcon = "/andreagpt-app-192.png";

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window" });
    if (windows.length) await windows[0].focus();
    else await self.clients.openWindow("/?home=1");
  })());
});

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([offlinePage, offlineIcon]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("andreagpt-connection-") && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;

  if (url.pathname === offlineIcon) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(offlineIcon)) ?? fetch(request)));
    return;
  }
  if (request.mode !== "navigate" || (url.pathname !== "/" && url.pathname !== "/index.html")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (![502, 503, 504].includes(response.status)) return response;
      const fallback = await caches.match(offlinePage, { cacheName });
      return fallback ?? response;
    } catch {
      return (await caches.match(offlinePage, { cacheName })) ?? Response.error();
    }
  })());
});
