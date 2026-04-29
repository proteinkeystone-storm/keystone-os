/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Service Worker KILL SWITCH (2026-04-29)
   Ce SW se désinscrit lui-même, vide tous les caches et force
   un reload des clients. Aucune mise en cache.
   À conserver tant que des navigateurs peuvent encore avoir un SW
   d'une version antérieure résident.
   ═══════════════════════════════════════════════════════════════ */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 1. Vide tous les caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));

    // 2. Désinscrit ce SW
    await self.registration.unregister();

    // 3. Force un reload sur tous les clients ouverts
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});

// Aucune interception fetch — toutes les requêtes vont au réseau
