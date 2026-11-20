/* ═══════════════════════════════════════════════════════════════════════════
   Last Days — Service Worker v3 (static PWA)
   Offline-first app shell, versioned caches, safe updates.

   GUARANTEES:
   • User data lives ONLY in IndexedDB — this SW never opens, deletes or
     "cleans" IndexedDB. Cache updates touch Cache Storage only.
   • Quran audio is NEVER cached, in ANY form: radio streams, recitation
     files, any non-ambient audio request — always network-only, never
     persisted, never precached, not in any backup or PWA asset.
     (Ambient sounds under /sounds/ are NOT Quran audio — they may cache.)
   • Updates: install → wait → the page offers a reload → SKIP_WAITING.
     Old caches are deleted on activate; IndexedDB is untouched.
   • Static app: no server, no web push, no /api — network-only for those
     paths stays enforced as defense in depth.
   ═══════════════════════════════════════════════════════════════════════════ */

const SW_VERSION = "4.1.0";
const STATIC_CACHE = "ld-static-v5"; // immutable build assets + icons + sounds
const PAGES_CACHE = "ld-pages-v5";   // visited app routes (offline navigation)

/* Precache: the app shell — every route's HTML + core assets.
   Quran audio is deliberately absent (online-only rule). */
const PRECACHE = [
  "/", "/home", "/tasks", "/notes", "/sprints", "/srs", "/stats", "/focus",
  "/settings", "/quran",
  "/icon.svg", "/logo.svg", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

/* ── Quran audio policy — network-only, zero persistence ──
   Sources: radiojar (radio mirrors), quranicaudio (recitation mp3s),
   and ANY audio request that is not the local ambient sounds directory. */
function isQuranAudio(url, request) {
  const h = url.hostname;
  if (/(^|\.)radiojar\.com$/.test(h)) return true;
  if (/(^|\.)quranicaudio\.com$/.test(h)) return true;
  // defense in depth: same-origin API-shaped paths stay network-only
  if (url.pathname.startsWith("/api/")) return true;
  // any <audio> playback that is not our ambient sound = Quran stream
  if (request.destination === "audio" && !url.pathname.startsWith("/sounds/")) return true;
  return false;
}

function neverCache(request, url) {
  if (request.method !== "GET") return true;
  if (url.pathname.startsWith("/api/")) return true; // network-only, never cached (defense in depth)
  if (isQuranAudio(url, request)) return true;      // Quran: never cached, never stored
  return false;
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES_CACHE);
      // each shell entry individually — one failed route must not break install
      await Promise.all(PRECACHE.map((u) =>
        cache.add(new Request(u, { credentials: "same-origin" })).catch(() => null)
      ));
    })()
  );
  // NOT auto-skipping: the page shows an update prompt and reloads on consent,
  // so an update can never yank data out from under a running tab.
});

/* Safe update: delete only caches we own (never other apps' / the browser's
   IndexedDB — unreachable from here by design). */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGES_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

/* Update consent from the page (SwUpdate banner → reload button). */
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== location.origin) {
    // cross-origin (incl. Quran hosts): pass straight to the network.
    // Quran streams must fail naturally when offline — never intercepted.
    return;
  }
  if (neverCache(req, url)) return; // API + Quran audio: network-only

  // ── ambient sounds + immutable build assets: cache-first ──
  if (url.pathname.startsWith("/sounds/") || url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
      )
    );
    return;
  }

  // ── navigations: network-first (fresh HTML), cached page offline, shell last ──
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("/"))
        )
    );
    return;
  }

  // ── other same-origin statics (icons, manifest, logo…): stale-while-revalidate ──
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});

/* No web-push handlers: the app has no server and no VAPID keys. Push
   subscriptions can never arrive — nothing to listen for. */
