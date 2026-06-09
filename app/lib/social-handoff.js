/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Handoff v1.0
   Normalisation d'un « relais » (handoff) vers le composer Social Manager.

   Quand un pad amont (ex. Ghost Writer, cf. chaîne de contenu) veut
   pré-remplir le composer, il fournit un payload libre. Cette fonction le
   NETTOIE et le BORNE avant qu'il touche l'état du composer :
     - text      : message (tronqué, doit être non vide)
     - imageUrl  : URL https publique (R2) — sinon ignorée
     - imageName : libellé de l'image (borné)
     - targets   : réseaux suggérés, filtrés aux ids connus
     - append    : true = ajouter au message existant ; false = remplacer

   Logique PURE (zéro DOM) → testable en node et réutilisable côté amont.
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_NETWORKS = ['facebook', 'instagram', 'linkedin', 'threads', 'telegram'];
const MAX_TEXT = 8000;        // garde-fou anti-payload ; la limite PAR réseau (Threads 500…) est gérée par le composer.
const MAX_NAME = 120;

/**
 * Nettoie/borne un payload de handoff externe.
 * @param {any} payload                    — objet libre fourni par l'appelant
 * @param {{ knownNetworks?: string[] }} [opts]
 * @returns {null | { text?: string, imageUrl?: string, imageName?: string, targets?: string[], append: boolean }}
 *          null si rien d'exploitable (ni texte, ni image, ni cible).
 */
export function normalizeComposePayload(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const known = Array.isArray(opts.knownNetworks) ? opts.knownNetworks : DEFAULT_NETWORKS;
  const out = {};

  if (typeof payload.text === 'string' && payload.text.trim()) {
    out.text = payload.text.slice(0, MAX_TEXT);
  }
  if (typeof payload.imageUrl === 'string' && /^https?:\/\//i.test(payload.imageUrl)) {
    out.imageUrl  = payload.imageUrl;
    out.imageName = (typeof payload.imageName === 'string' && payload.imageName.trim())
      ? payload.imageName.slice(0, MAX_NAME)
      : 'image';
  }
  if (Array.isArray(payload.targets)) {
    const t = [...new Set(payload.targets.filter(x => known.includes(x)))];
    if (t.length) out.targets = t;
  }
  out.append = payload.append === true;

  return (out.text || out.imageUrl || out.targets) ? out : null;
}
