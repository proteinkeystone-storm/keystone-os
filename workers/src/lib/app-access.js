/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Contrôle de possession, côté SERVEUR
   Layer 2 · « cette licence a-t-elle le droit d'ouvrir cette app ? »
   ─────────────────────────────────────────────────────────────
   POURQUOI ce module
   ─────────────────────────────────────────────────────────────
   Jusqu'ici, la possession n'était vérifiée que DANS LE NAVIGATEUR :
   `getOwnedIds()` lit un tableau de localStorage. Trois trous
   successifs l'ont montré en test réel (sac jeté à l'activation, liste
   locale qui s'accumule, gratuites effacées) — mais surtout, n'importe
   qui pouvait éditer ce tableau et tout ouvrir. Une grille tarifaire
   que le serveur n'applique pas n'est pas une grille : c'est une
   suggestion.

   Ici : une porte unique, franchie AVANT d'atteindre la route d'une
   application.

   CE QU'IL NE FAUT SURTOUT PAS CASSER
   ─────────────────────────────────────────────────────────────
   1. Les SURFACES PUBLIQUES. Un QR scanné, l'agent public, un
      formulaire Key Form rempli par un visiteur : ce sont les clients
      DU client. Ils n'ont pas de licence et ne doivent jamais en
      avoir besoin. Ces requêtes n'ont pas de JWT → on ne les juge
      pas, la route décide elle-même (401 ou service public).
   2. Les LICENCES HISTORIQUES. `owned_assets = null` veut dire
      « accès total » (cf. P1). On ne retire jamais un accès en place.
   3. Les APPLICATIONS GRATUITES. Toujours ouvertes, personne n'a à
      les acheter — même une licence résiliée les garde.

   PHILOSOPHIE : on ne ferme QUE sur une certitude. Base indisponible,
   licence introuvable, sac illisible → on laisse passer. Un incident
   d'infrastructure ne doit pas couper l'accès de clients qui paient ;
   le risque inverse (laisser filer une app sur une panne) est
   infiniment moins grave que bloquer tout le monde.
   ═══════════════════════════════════════════════════════════════ */

import { APP_TIER, TIER, OS_ENTITLEMENT } from './pricing-grid.js';

// ── Quelle application sert ce chemin ? ─────────────────────────
// Seules les routes PROPRES à une application figurent ici. Tout ce
// qui est transverse (licence, vault, clés, crédits, Kora, Living
// Layer, proxy IA, admin, catalogue…) est volontairement absent : ce
// n'est pas vendu à l'unité, donc rien à vérifier.
// booK (O-BOK-001) n'y est pas non plus : il n'a AUCUNE route serveur.
export const PREFIX_TO_APP = {
  'brainstorming': 'A-COM-003',   // Brainstorming
  'ghostwriter'  : 'A-COM-005',   // Ghost Writer
  'keybrand'     : 'O-BRD-001',   // Key Brand
  'keynapse'     : 'O-Keyn-001',  // Keynapse   (gratuite)
  'kodex'        : 'A-COM-002',   // Brief Prod
  'network'      : 'O-NET-001',   // networK
  'pulsa'        : 'A-COM-004',   // Key Form
  'qr'           : 'A-COM-001',   // Smart Dynamic QR
  'smartqr'      : 'A-COM-001',   // idem (second préfixe)
  'sceau'        : 'O-SEC-001',   // Missive    (gratuite)
  'sentinel'     : 'O-GEO-001',   // Sentinel
  'smart-agent'  : 'O-AGT-001',   // Smart Agent
  'social'       : 'O-SOC-001',   // Social Manager
  'desk'         : 'O-DSK-001',   // desK
};

/** '/api/keynapse/bubbles/42' → 'O-Keyn-001' · null si route transverse. */
export function appForPath(path) {
  const m = String(path || '').match(/^\/api\/([a-z0-9-]+)/i);
  if (!m) return null;
  return PREFIX_TO_APP[m[1].toLowerCase()] || null;
}

function isFree(appId) {
  return APP_TIER[appId] === TIER.FREE;
}

/**
 * Le sac autorise-t-il cette application ?
 * @param {?Array}  ownedAssets  sac de la licence (null = accès total legacy)
 * @param {string}  plan         plan technique (ADMIN / MAX = tout)
 * @param {string}  appId        application visée
 */
export function bagAllows({ ownedAssets, plan, appId }) {
  const p = String(plan || '').toUpperCase();
  if (p === 'ADMIN' || p === 'MAX') return true;      // accès total
  if (isFree(appId)) return true;                     // gratuit = gratuit
  if (ownedAssets === null || ownedAssets === undefined) return true;  // legacy
  if (!Array.isArray(ownedAssets)) return true;       // illisible → on n'invente pas
  if (ownedAssets.includes(OS_ENTITLEMENT)) return true;
  return ownedAssets.includes(appId);
}

/**
 * Vérifie l'accès pour une requête AUTHENTIFIÉE.
 *
 * @returns {Promise<{allowed: boolean, appId: ?string}>}
 *   allowed=false UNIQUEMENT si la licence existe, est lisible, et
 *   n'inclut pas l'application. Tout le reste passe.
 */
export async function checkAppAccess(env, { path, claims }) {
  const appId = appForPath(path);
  if (!appId) return { allowed: true, appId: null };       // route transverse
  if (!claims || !claims.sub) return { allowed: true, appId };  // public : la route décide
  if (claims.isAdmin) return { allowed: true, appId };
  if (isFree(appId)) return { allowed: true, appId };

  let row;
  try {
    row = await env.DB
      .prepare('SELECT plan, owned_assets FROM licences WHERE lookup_hmac = ? LIMIT 1')
      .bind(claims.sub).first();
  } catch (_) {
    return { allowed: true, appId };      // base muette → on ne coupe personne
  }
  if (!row) return { allowed: true, appId };   // licence inconnue → la route jugera

  let bag = null;
  if (row.owned_assets) {
    try {
      const parsed = JSON.parse(row.owned_assets);
      bag = Array.isArray(parsed) ? parsed : null;
    } catch (_) { bag = null; }
  }

  return {
    allowed: bagAllows({ ownedAssets: bag, plan: row.plan || claims.plan, appId }),
    appId,
  };
}
