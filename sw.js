/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Service Worker v1.0
   Stratégie : Network-First pour les assets dynamiques,
               Cache-First pour les fonts/logos offline.
   ─────────────────────────────────────────────────────────────
   Architecture hybride PWA :
   · Shell statique mis en cache (offline-ready)
   · Assets K_STORE_ASSETS/PADS/*.json → network-first (contenu frais)
   · Clés API et prefs → localStorage client (jamais en cache SW)
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'keystone-v3';
const SHELL_VERSION = '20260428-2';

// ── Assets du Shell — mis en cache à l'installation ─────────────
// Note : '/' n'est PAS pré-caché — Vercel sert index.html (landing)
// directement comme fichier racine, les navigations vont au réseau.
const SHELL_ASSETS = [
  '/app.html',
  '/src/main.js',
  '/src/ui-renderer.js',
  '/src/vault.js',
  '/src/pads-loader.js',
  '/src/pads-data.js',
  '/src/grid-engine.js',
  '/src/dst.js',
  '/src/lockscreen.js',
  '/src/onboarding.js',
  '/src/api-handler.js',
  '/src/style.css',
  '/manifest.json',
  '/LOGOS/Logo KEYSTONE dark-gold.svg',
  '/LOGOS/Logo KEYSTONE fond clair.svg',
  '/LOGOS/Logo puce fond bleu.svg',
];

// ── Patterns réseau-seulement (jamais mis en cache) ─────────────
const NETWORK_ONLY = [
  '/api/',
  'anthropic.com',
  'openai.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'api.perplexity.ai',
  'api.mistral.ai',
];

// ═══════════════════════════════════════════════════════════════
// INSTALL — mise en cache du Shell
// ═══════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_ASSETS).catch(err => {
        // Si un asset manque (dev), on continue sans bloquer
        console.warn('[Keystone SW] Certains assets shell absents :', err.message);
      });
    }).then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — nettoyage des anciens caches
// ═══════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH — stratégie de récupération
// ═══════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Jamais intercepter les requêtes API externes ──────────
  if (NETWORK_ONLY.some(p => request.url.includes(p))) return;

  // ── 2. Catalogue distant (GitHub raw) → Network-First ───────
  if (request.url.includes('raw.githubusercontent.com')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── 3. Catalogue local + Pads JSON → Network-First ───────────
  //    Contenu mis à jour fréquemment : priorité réseau, fallback cache
  if (url.pathname.includes('/K_STORE_ASSETS/')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // ── 4. Navigations HTML → Network-First ─────────────────────
  //    Vercel sert / → index.html (landing) et /app → app.html (dashboard)
  //    Pas de cache sur les documents HTML pour éviter le stale routing.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/app.html'))
    );
    return;
  }

  // ── 5. Assets statiques → Cache-First avec fallback réseau ───
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        // Ne mettre en cache que les réponses valides
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE — communication avec le client (ex: force refresh)
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
    });
  }
});
