// ═══════════════════════════════════════════════════════════════
// KEYSTONE OS — Storage Guard
//
// Tout ce que l'OS garde en local (bibliothèque booK dans IndexedDB
// `bk_library`, miroir + file de la Data Fabric, vault localStorage)
// vit dans le stockage du navigateur — que celui-ci peut RÉCUPÉRER
// sans prévenir et sans recours :
//   · WebKit efface le stockage écrit par script après 7 jours d'usage
//     de Safari sans visite du domaine ;
//   · tous les moteurs purgent sous pression disque ;
//   · « effacer les données du site » emporte tout d'un coup.
//
// navigator.storage.persist() demande le mode PERSISTANT, qui exempte
// l'origine de ces récupérations automatiques. C'est le seul correctif
// réel — le reste (repères d'interface, rappels) n'est qu'un filet.
// Accord silencieux sur Chromium (heuristiques d'engagement), invite
// sur Firefox ; côté WebKit le levier fiable reste l'ajout à l'écran
// d'accueil, d'où le conseil affiché par booK quand l'accord manque.
//
// Appelé une fois au boot (main.js). Idempotent et JAMAIS bloquant :
// aucune API absente ni aucun refus ne doit empêcher l'OS de démarrer.
// ═══════════════════════════════════════════════════════════════

let _state    = null;
let _inflight = null;

/**
 * Demande (une seule fois) le stockage persistant et mesure le quota.
 * @returns {Promise<{supported:boolean, persisted:boolean, usage:number, quota:number, ratio:number}>}
 */
export function ensurePersistence() {
  if (_state)    return Promise.resolve(_state);
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const st = { supported: false, persisted: false, usage: 0, quota: 0, ratio: 0 };
    try {
      if (navigator.storage && navigator.storage.persist) {
        st.supported = true;
        // persisted() d'abord : ne redemande pas si l'accord est déjà acquis
        // (sur Firefox, persist() rouvrirait une invite à chaque boot).
        st.persisted = await navigator.storage.persisted();
        if (!st.persisted) st.persisted = await navigator.storage.persist();
      }
      if (navigator.storage && navigator.storage.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        st.usage = usage;
        st.quota = quota;
        st.ratio = quota ? usage / quota : 0;
      }
    } catch (_) {
      // API absente (vieux Safari), contexte non sécurisé, ou refus :
      // on garde l'état par défaut, l'appelant décide quoi en dire.
    }
    _state    = st;
    _inflight = null;
    return st;
  })();

  return _inflight;
}

/**
 * État déjà mesuré, en lecture synchrone (null tant que le boot n'a pas
 * répondu). Permet à une interface de se rendre sans attendre — et sans
 * rien affirmer tant qu'elle ne sait pas.
 */
export function storageState() { return _state; }

/** Quota utilisé, formaté pour l'affichage (« 240 Mo sur 2,0 Go »). */
export function formatUsage(st) {
  if (!st || !st.quota) return '';
  const _u = n => n >= 1073741824
    ? (Math.round(n / 1073741824 * 10) / 10).toString().replace('.', ',') + ' Go'
    : Math.round(n / 1048576) + ' Mo';
  return `${_u(st.usage)} sur ${_u(st.quota)}`;
}
