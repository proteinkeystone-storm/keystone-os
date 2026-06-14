/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Session Guard v1.0
   Déconnexion propre & garde-fou anti-session-coincée.
   ─────────────────────────────────────────────────────────────
   Né de l'incident 2026-06-14 (fausse panne « tout est vide » après
   déploiement) : un vieux jeton d'un AUTRE compte restait dans
   localStorage + IndexedDB et survivait au re-login → dashboard vide
   en boucle. La seule sortie était une purge manuelle des données de
   site. Ce module la rend disponible en un appel/clic.

   API :
     ksCleanLogout(opts?)  → efface TOUT l'état client puis redirige
     ksDecodeJwt(token?)   → payload décodé du JWT (ou null)
     ksWhoami()            → { sub, owner, email, plan, isDemo, expSec } | null
   Exposés sur window pour les boutons inline + la console de debug.
   ═══════════════════════════════════════════════════════════════ */

const DB_NAME = 'keystone-data-fabric';

// ── Décodage local (UX only — la vérité reste côté Worker) ──────
export function ksDecodeJwt(token) {
  try {
    const t = token || localStorage.getItem('ks_jwt') || '';
    const part = t.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (_) {
    return null;
  }
}

// Identité du compte actuellement connecté (pour affichage / diagnostic).
export function ksWhoami() {
  const p = ksDecodeJwt();
  if (!p) return null;
  return {
    sub:    p.sub || null,
    owner:  p.owner || null,
    email:  p.email || null,
    plan:   p.plan || null,
    isDemo: !!p.isDemo,
    expSec: typeof p.exp === 'number' ? p.exp - Math.floor(Date.now() / 1000) : null,
  };
}

// ── Suppression d'une base IndexedDB, sans jamais bloquer ───────
function _deleteIDB(name) {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve();
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
      // Filet : si aucun event ne vient (onglet concurrent qui tient la base
      // ouverte), on ne fige pas le logout pour autant.
      setTimeout(resolve, 1500);
    } catch (_) {
      resolve();
    }
  });
}

/**
 * Déconnexion PROPRE : efface tout ce qui peut épingler une session
 * périmée côté client, exactement comme une purge manuelle des données
 * de site, puis redirige vers la landing.
 *
 *  1. localStorage ks_*      (jeton, prefs, sélection, owned assets…)
 *  2. sessionStorage ks_*    (marqueurs éphémères)
 *  3. IndexedDB keystone-data-fabric  ← oublié par l'ancien ?ks_reset=1
 *  4. CacheStorage           (tous les caches du SW)
 *  5. Désinscription du/des Service Worker(s)
 *  6. Redirection propre (le prochain load réenregistre un SW neuf)
 *
 * @param {{redirect?:string, reason?:string}} opts
 */
export async function ksCleanLogout({ redirect = '/?logout=1', reason = '' } = {}) {
  try { console.warn('[session-guard] clean logout —', reason || '(manuel)'); } catch (_) {}

  // 1 + 2. Storages (clés Keystone uniquement)
  for (const store of [
    (() => { try { return localStorage; }   catch (_) { return null; } })(),
    (() => { try { return sessionStorage; } catch (_) { return null; } })(),
  ]) {
    if (!store) continue;
    try {
      Object.keys(store)
        .filter(k => k.startsWith('ks_'))
        .forEach(k => { try { store.removeItem(k); } catch (_) {} });
    } catch (_) {}
  }

  // 3. IndexedDB — le coffre data-fabric (vecteur de l'incident)
  await _deleteIDB(DB_NAME);

  // 4. CacheStorage — tous les caches (ils sont tous à nous, même origine)
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
  } catch (_) {}

  // 5. Service Workers — désinscription complète
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    }
  } catch (_) {}

  // 6. Redirection propre
  try { location.replace(redirect); }
  catch (_) { try { location.href = redirect; } catch (__) {} }
}

// ── Exposition globale (boutons inline / console) ───────────────
if (typeof window !== 'undefined') {
  window.ksCleanLogout = ksCleanLogout;
  window.ksWhoami      = ksWhoami;
}
