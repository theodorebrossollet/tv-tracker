// Service worker: caches the static app shell and nothing else.
//
// The narrow scope is deliberate, not unfinished. Every page in this app is
// `dynamic = "force-dynamic"` because it renders live watch state; a worker
// that cached those responses would serve someone yesterday's progress, or —
// now that there are accounts — a page rendered for whoever was signed in when
// it was cached. An honest "you're offline" is the better failure.
//
// So: only same-origin GETs for build output and icons are cached, and only
// when the response is a clean 200. Anything else goes to the network and is
// not stored.

const CACHE = "tv-tracker-shell-v1";

// Cached on demand rather than pre-listed: Next's chunk filenames are
// content-hashed and change every build, so an install-time list would be
// stale before it was useful.
const CACHEABLE = [/^\/_next\/static\//, /^\/icon-.*\.png$/, /^\/apple-touch-icon\.png$/];

self.addEventListener("install", (event) => {
  // Take over without waiting for existing tabs to close, so a fixed worker
  // ships on the next visit rather than the next cold start.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this file.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLE.some((pattern) => pattern.test(url.pathname))) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);

      // Only clean, complete, same-origin 200s. A 401, a redirect to /login, or
      // an opaque cross-origin response cached here would be served to every
      // later visitor of that URL — including one who is signed in.
      if (response.ok && response.status === 200 && response.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }

      return response;
    })(),
  );
});
