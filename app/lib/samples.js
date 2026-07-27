/* ═══════════════════════════════════════════════════════════════
   Contenus d'exemple au premier lancement — mémoire partagée
   ───────────────────────────────────────────────────────────────
   Les trois applications gratuites (Missive, booK, Keynapse) ne
   s'ouvrent plus sur du vide : chacune pose UNE fois un contenu
   d'exemple, que l'utilisateur peut supprimer comme n'importe quel
   autre — et qui ne revient pas.

   « Qui ne revient pas » est toute la difficulté, et c'est pour ça
   que ce module existe plutôt que trois `localStorage.setItem`
   dispersés :

   · Le drapeau vit dans `ks_samples_seeded`, une clé INSCRITE dans
     PREFS_KEYS (cloud-vault.js) — donc synchronisée avec le COMPTE,
     pas avec l'appareil. Sans ça, quelqu'un qui supprime l'exemple
     sur son ordinateur le retrouverait sur son téléphone, et comme
     Keynapse et Missive rangent leurs données côté serveur, il
     reviendrait ensuite sur l'ordinateur. Même raisonnement que
     `ks_is_demo`, déjà synchronisé pour cette raison exacte.

   · Le drapeau ne suffit pas seul : le Cloud Vault réécrit le
     localStorage à chaque démarrage (`_hydrate`), et l'envoi est
     différé de ~1,5 s — un rechargement immédiat après le premier
     lancement peut donc le perdre. Chaque pad ajoute pour cette
     raison une seconde condition : ne semer que si l'endroit est
     RÉELLEMENT vide. Le pire cas devient alors « l'exemple est
     reposé », jamais « l'exemple est posé en double ».

   Un échec d'écriture n'empêche jamais l'application de s'ouvrir :
   un contenu d'exemple est un confort, pas une fonction.
   ═══════════════════════════════════════════════════════════════ */

const KEY = 'ks_samples_seeded';

function _read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(v => typeof v === 'string') : [];
  } catch (_) { return []; }
}

/** L'exemple de ce pad a-t-il déjà été posé pour ce compte ? */
export function sampleSeeded(pad) {
  return _read().includes(pad);
}

/** Marque l'exemple comme posé. Idempotent, et silencieux en cas d'échec. */
export function markSampleSeeded(pad) {
  try {
    const list = _read();
    if (list.includes(pad)) return;
    list.push(pad);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (_) { /* quota plein, mode privé : tant pis, pas bloquant */ }
}
