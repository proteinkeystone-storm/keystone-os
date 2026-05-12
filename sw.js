/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Service Worker (Sprint 1.1 · offline-graceful)
   Layer 1 · Cache PWA + fallback offline pour les requêtes API.

   Stratégie :
   ─────────────────────────────────────────────────────────────
   - Assets statiques (script, style, image, font) : cache-first.
     Si le cache contient, on sert direct. Sinon réseau + mise en cache.
   - HTML : network-first, fallback cache (sinon /app.html shell).
   - Requêtes API (Worker Cloudflare) : network-first avec mise en
     cache des GET pour permettre une lecture seule offline. POST,
     PATCH, DELETE passent au réseau et NE SONT JAMAIS cachées —
     les mutations offline sont gérées par dataFabric (IndexedDB).

   Versionnage :
   ─────────────────────────────────────────────────────────────
   Le SW est versionné via VERSION ; bump cette constante pour
   forcer la purge des anciens caches au prochain activate.

   Histoire :
   ─────────────────────────────────────────────────────────────
   Remplace le kill-switch d'avril 2026. Les clients qui avaient
   l'ancien SW se sont désinscrits automatiquement, ils chargeront
   celui-ci proprement au prochain refresh.
   ═══════════════════════════════════════════════════════════════ */

const VERSION       = 'ks-os-v2.9.0-sdqr-3-studio-design';
const STATIC_CACHE  = `${VERSION}-static`;
const API_CACHE     = `${VERSION}-api`;

// URL de l'API Worker (cross-origin → on doit la détecter par hostname).
const API_HOSTS = new Set([
  'keystone-os-api.keystone-os.workers.dev',
]);

// Pré-cache minimal : le shell de l'app pour démarrage offline.
const PRECACHE = [
  '/',
  '/app.html',
  '/manifest.json',
];

// ── Install : pré-cache le shell ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // .catch() car certains assets peuvent renvoyer 404 selon l'env ;
    // ne pas bloquer l'install pour autant.
    await cache.addAll(PRECACHE).catch(err => {
      console.warn('[sw] precache partiel', err);
    });
    self.skipWaiting();
  })());
});

// ── Activate : purge les caches d'anciennes versions ──────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => !k.startsWith(VERSION))
        .map(k => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// ── Helpers ────────────────────────────────────────────────────
async function _cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function _networkFirst(req, cacheName, { cacheable = true } = {}) {
  try {
    const res = await fetch(req);
    if (cacheable && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    // Si rien en cache : on renvoie une réponse JSON 503 lisible
    // côté client pour qu'il bascule sur IndexedDB via dataFabric.
    return new Response(
      JSON.stringify({ error: 'offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ── Fetch : aiguillage par type de requête ────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Mutations : jamais cachées, passent au réseau direct.
  // dataFabric gère l'offline via sa propre syncQueue IndexedDB.
  if (req.method !== 'GET') return;

  // ── API Worker (cross-origin) ───────────────────────────────
  if (API_HOSTS.has(url.hostname) || url.pathname.startsWith('/api/')) {
    event.respondWith(_networkFirst(req, API_CACHE));
    return;
  }

  // ── Assets statiques : cache-first ──────────────────────────
  if (
    req.destination === 'script' ||
    req.destination === 'style'  ||
    req.destination === 'image'  ||
    req.destination === 'font'
  ) {
    event.respondWith(_cacheFirst(req, STATIC_CACHE));
    return;
  }

  // ── HTML / navigation : network-first, fallback shell ───────
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return (
          (await caches.match(req)) ||
          (await caches.match('/app.html')) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // ── Fallback générique : network-first sans cache ───────────
  event.respondWith(_networkFirst(req, STATIC_CACHE, { cacheable: false }));
});
