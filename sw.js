/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Service Worker (Sprint 1.1 · offline-graceful)
   Layer 1 · Cache PWA + fallback offline pour les requêtes API.

   Stratégie :
   ─────────────────────────────────────────────────────────────
   - Assets statiques (script, style, image, font) : cache-first.
     Si le cache contient, on sert direct. Sinon réseau + mise en cache.
   - HTML : network-first, fallback cache (sinon /app.html shell).
   - Requêtes API (Worker Cloudflare) : RÉSEAU PUR. Aucune réponse
     d'API n'est jamais mise en cache (ni lue, ni écrite) : elles sont
     authentifiées (JWT) et propres à UN compte — les cacher risquait de
     resservir les données d'un AUTRE compte au changement de session
     (incident 2026-06-14, fausse panne). L'offline des entités qui en
     ont besoin est géré par dataFabric (IndexedDB), pas par le SW.

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

const VERSION       = 'ks-os-v5.28.29-sdqr-bg-transparent';
const STATIC_CACHE  = `${VERSION}-static`;
// Plus de cache API : les réponses /api/* ne sont JAMAIS stockées (cf. fetch).

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
    // PAS de skipWaiting() ici : le nouveau SW ATTEND. La page affiche un
    // bandeau « Nouvelle version — Actualiser » et c'est le CLIC utilisateur
    // qui envoie SKIP_WAITING → activation propre. Évite tout takeover surprise
    // (rechargement intempestif) et tout mélange ancien JS / nouveau module
    // lazy-loadé pendant la session (cf. incident 2026-06-14).
  })());
});

// ── Activate : purge les caches d'anciennes versions ──────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        // Purge toute version ≠ courante ET tout cache d'API résiduel
        // (les anciennes versions stockaient les GET /api/* — on s'assure
        // qu'aucun reliquat authentifié ne survit à la mise à jour).
        .filter(k => !k.startsWith(VERSION) || k.endsWith('-api'))
        .map(k => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

// ── Message : la page peut demander la version du SW actif ────
// Sert au footer Réglages à afficher la vraie version de build (vérif déploiement).
self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION') {
    event.ports[0]?.postMessage(VERSION);
  }
  // Déclenché par le clic « Actualiser » du bandeau de mise à jour : on
  // active immédiatement ce SW en attente (→ activate → clients.claim →
  // controllerchange → la page se recharge avec les nouveaux assets).
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

// Réseau PUR : ni lecture ni écriture de cache. Pour les /api/* (réponses
// authentifiées, propres à un compte). Sur coupure réseau → sentinelle 503
// JSON lisible par le client (dataFabric bascule sur IndexedDB).
async function _networkOnly(req) {
  try {
    return await fetch(req);
  } catch {
    return new Response(
      JSON.stringify({ error: 'offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
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

  // ── API Worker (cross-origin OU /api/) : RÉSEAU PUR ─────────
  // JAMAIS de cache : ni lecture, ni écriture. Réponses authentifiées
  // (JWT), propres à un compte → les cacher resservait les données d'un
  // AUTRE compte au changement de session (incident 2026-06-14).
  if (API_HOSTS.has(url.hostname) || url.pathname.startsWith('/api/')) {
    event.respondWith(_networkOnly(req));
    return;
  }

  // ── Cross-origin (hors API) : NE PAS intercepter ────────────
  // Les CDN externes (esm.sh, jsdelivr, HuggingFace…) répondent souvent
  // par une REDIRECTION (302). En cache-first, cache.put() rejette une
  // réponse redirigée → l'import de module / le fetch de modèle échoue
  // (« Load failed »). On laisse le navigateur gérer nativement (il a son
  // propre cache HTTP) : ça débloque les libs TTS/WASM et tout CDN tiers.
  if (url.origin !== location.origin) return;

  // ── Assets vendor (Grammalecte, PDF.js) : cache-first ───────
  // Gros dictionnaires .json + workers chargés par XHR/import. On les
  // fige par version de SW (l'activate purge les anciens caches) →
  // hors-ligne OK + pas de re-téléchargement du dico ~9 Mo à chaque
  // session. Pense à bump le SW si on met à jour un fichier vendor.
  if (url.pathname.startsWith('/app/vendor/')) {
    event.respondWith(_cacheFirst(req, STATIC_CACHE));
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

// ── Push reçu (Keynapse Sprint 9) — notification de rappel MÊME app fermée.
// Le worker chiffre la charge (libellé + bulle) ; on ne traite QUE nos pushes.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  if (data.kind === 'keynapse-reminder') {
    event.waitUntil(self.registration.showNotification(data.title || 'Rappel — Keynapse', {
      body: data.body || 'Vous avez un rappel.',
      tag:  'kn-rem-' + (data.bubbleId || ''),
      data: { kind: 'keynapse-reminder', bubbleId: data.bubbleId },
    }));
    return;
  }
  // Sentinel (Pad O-GEO-001) — alerte de disponibilité (site hors ligne / rétabli).
  if (data.kind === 'sentinel-alert') {
    event.waitUntil(self.registration.showNotification(data.title || 'Sentinel', {
      body: data.body || '',
      tag:  'snt-' + (data.siteId || ''),
      data: { kind: 'sentinel-alert', url: data.url || './app' },
    }));
    return;
  }
});

// ── Clic sur une notification de rappel Keynapse (Sprint 7) ────
// Notifications LOCALES uniquement (pas de push serveur) : on ne traite QUE
// les nôtres (data.kind). Focalise/ouvre l'app, puis signale au front la bulle
// à ouvrir (le pad Keynapse écoute les messages SW quand il est ouvert).
self.addEventListener('notificationclick', (event) => {
  const data = (event.notification && event.notification.data) || {};
  if (data.kind === 'keynapse-reminder') {
    event.notification.close();
    event.waitUntil((async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      let client = wins.find((c) => c.url.includes('/app')) || wins[0] || null;
      if (client) { try { await client.focus(); } catch (_) {} }
      else { try { client = await self.clients.openWindow('./app'); } catch (_) {} }
      if (client && data.bubbleId) { try { client.postMessage({ type: 'keynapse-open-bubble', bubbleId: data.bubbleId }); } catch (_) {} }
    })());
    return;
  }
  // Sentinel — clic sur une alerte : focalise/ouvre le dashboard.
  if (data.kind === 'sentinel-alert') {
    event.notification.close();
    event.waitUntil((async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = wins.find((c) => c.url.includes('/app')) || wins[0] || null;
      if (client) { try { await client.focus(); } catch (_) {} }
      else { try { await self.clients.openWindow(data.url || './app'); } catch (_) {} }
    })());
    return;
  }
});
