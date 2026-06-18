/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Registre des plateformes v1.0
   (Sprint Social-0 — Socle d'extensibilité)

   Source de vérité DÉCLARATIVE des réseaux sociaux supportés.
   Le moteur de diffusion ET l'UI (pad Social Manager) LISENT ce
   registre — ils ne codent JAMAIS un réseau en dur.

   ┌─ AJOUTER UN RÉSEAU (TikTok, X, Threads, Bluesky, …) ──────────┐
   │ 1. Ajouter une fiche de capacités ci-dessous (PLATFORMS).     │
   │ 2. Créer ./adapters/<reseau>.js conforme au contrat           │
   │    (cf. ./broadcast.js → SocialAdapter) et l'enregistrer dans  │
   │    la table ADAPTERS de ./broadcast.js.                       │
   │ Aucune autre modification : routes, UI et moteur s'adaptent.  │
   └───────────────────────────────────────────────────────────────┘

   ⚠ Les limites chiffrées (longueurs, nb de médias, versions d'API)
   sont des valeurs de référence à la rédaction — à confirmer au
   branchement de chaque API. Étant déclaratives, elles s'ajustent
   ICI sans toucher au moteur.
   ═══════════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} PlatformCaps
 * @property {string}   id
 * @property {string}   label
 * @property {boolean}  enabled       false = défini mais pas encore branché
 * @property {string[]} targets       'profile' | 'page' | 'organization' | 'business'
 * @property {Object}   text          { maxLength, supportsHashtags, … }
 * @property {Object}   media         capacités média
 * @property {Object}   link          { supported, preview }
 * @property {boolean}  firstComment  1er commentaire programmable via API ?
 * @property {Object}   auth          config OAuth générique
 * @property {Object}   api           endpoint + versioning de publication
 * @property {Object}   access        faisabilité d'accès par cible (info)
 */

export const PLATFORMS = {

  // ── LinkedIn ────────────────────────────────────────────────
  // Profil perso = "Share on LinkedIn" (w_member_social), self-service.
  // Page = "Community Management API" (w_organization_social), review requise.
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    enabled: true,
    targets: ['profile', 'organization'],
    text: { maxLength: 3000, supportsHashtags: true, supportsMentions: true },
    media: {
      enabled: false,             // ⚠ publication média PAS encore implémentée (adapter) → texte seul. Garde-fou registre ↔ UI ↔ moteur.
      image: { max: 9, mimes: ['image/jpeg', 'image/png', 'image/gif'], aspectRatios: ['1:1', '1.91:1', '4:5'] },
      video: { max: 1, mimes: ['video/mp4'], maxDurationSec: 600 },
      carousel: false,            // ⚠ multi-image PAS câblé (adapter throw >1 image) → garde-fou registre. Repasser true quand le multi-image natif sera codé.
      required: false,            // un post texte seul est valide
      hostedUrlRequired: false,   // upload binaire natif (register upload)
    },
    link: { supported: true, preview: true },
    firstComment: false,
    auth: {
      type: 'oauth2',
      authUrl:  'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scopes: {
        profile:      ['openid', 'profile', 'w_member_social'],
        organization: ['openid', 'profile', 'w_organization_social', 'r_organization_social'],
      },
      tokenTtlDays: 60,
      refreshable: true,
    },
    api: {
      base: 'https://api.linkedin.com/rest',
      publishPath: '/posts',
      versionHeader: 'LinkedIn-Version',
      version: '202506',          // format AAAAMM — à bumper périodiquement
    },
    access: { profile: 'self-serve', organization: 'review-required' },
  },

  // ── Facebook Page ───────────────────────────────────────────
  // Sprint Social-1. Graph API : /{page-id}/feed | /photos | /videos.
  facebook: {
    id: 'facebook',
    label: 'Facebook Page',
    enabled: true,
    targets: ['page'],
    text: { maxLength: 63206, supportsHashtags: true, supportsMentions: false },
    media: {
      enabled: true,
      image: { max: 10, mimes: ['image/jpeg', 'image/png'], aspectRatios: ['1:1', '1.91:1', '4:5'] },
      video: { max: 1, mimes: ['video/mp4'], maxDurationSec: 7200 },
      carousel: true,             // Phase 2 (juin 2026) — multi-image via attached_media (photos non publiées → feed).
      required: false,
      hostedUrlRequired: false,
    },
    link: { supported: true, preview: true },
    firstComment: true,
    auth: {
      type: 'oauth2',
      authUrl:  'https://www.facebook.com/v20.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v20.0/oauth/access_token',
      scopes: { page: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'] },
      tokenTtlDays: 60,           // long-lived ; un page token peut être non-expirant
      refreshable: true,
    },
    api: {
      base: 'https://graph.facebook.com/v20.0',
      publishPath: '/{page-id}/feed',
      versionHeader: null,        // version portée par l'URL
      version: 'v20.0',
    },
    access: { page: 'dev-mode-self' },   // utilisable sans App Review pour ses propres pages
  },

  // ── Instagram (compte Business/Creator lié à une Page FB) ───
  // Sprint Social-1. Content Publishing API en 2 temps (container → publish).
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    enabled: true,
    targets: ['business'],
    text: { maxLength: 2200, supportsHashtags: true, maxHashtags: 30, supportsMentions: true },
    media: {
      enabled: true,
      image: { max: 10, mimes: ['image/jpeg'], aspectRatios: ['1:1', '4:5', '1.91:1'] },
      video: { max: 1, mimes: ['video/mp4'], maxDurationSec: 90 },   // Reels
      carousel: true,             // Phase 2 (juin 2026) — carrousel via conteneurs is_carousel_item → CAROUSEL.
      required: true,             // ⚠ IG n'accepte PAS de post texte seul
      hostedUrlRequired: true,    // ⚠ le média DOIT être servi sur une URL publique (→ R2)
    },
    link: { supported: false, preview: false },  // pas de lien cliquable en légende
    firstComment: true,
    auth: {
      type: 'oauth2',
      authUrl:  'https://www.facebook.com/v20.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v20.0/oauth/access_token',
      scopes: { business: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'] },
      tokenTtlDays: 60,
      refreshable: true,
    },
    api: {
      base: 'https://graph.facebook.com/v20.0',
      publishPath: '/{ig-user-id}/media',
      versionHeader: null,
      version: 'v20.0',
      dailyPublishLimit: 25,      // ~25 publications / 24h
    },
    access: { business: 'dev-mode-self' },
  },

  // ── Threads (compte Threads, lié au compte Instagram/Meta) ──
  // Sprint Social-4. API Threads (graph.threads.net) : container → publish.
  // ⚠ Token PROPRE (OAuth Threads, longue durée 60 j refreshable) — PAS le
  //   token système FB/IG. Provision via flux connect/callback (one-time).
  threads: {
    id: 'threads',
    label: 'Threads',
    enabled: true,
    targets: ['profile'],
    text: { maxLength: 500, supportsHashtags: true, supportsMentions: true },
    media: {
      enabled: true,
      image: { max: 10, mimes: ['image/jpeg', 'image/png'], aspectRatios: ['1:1', '4:5', '1.91:1'] },
      video: { max: 1, mimes: ['video/mp4'], maxDurationSec: 300 },
      carousel: true,             // Phase 2 (juin 2026) — carrousel via conteneurs is_carousel_item → CAROUSEL.
      required: false,            // Threads accepte le TEXTE SEUL (retour aux sources 😉)
      hostedUrlRequired: true,    // image servie sur URL publique (→ R2), comme IG
    },
    link: { supported: true, preview: true },
    firstComment: false,
    auth: {
      type: 'oauth2',
      authUrl:  'https://threads.net/oauth/authorize',
      tokenUrl: 'https://graph.threads.net/oauth/access_token',
      scopes: { profile: ['threads_basic', 'threads_content_publish'] },
      tokenTtlDays: 60,
      refreshable: true,
    },
    api: {
      base: 'https://graph.threads.net/v1.0',
      publishPath: '/{threads-user-id}/threads',
      versionHeader: null,
      version: 'v1.0',
    },
    access: { profile: 'oauth-self' },
  },

  // ── Telegram (Bot API → canal) ──────────────────────────────
  // Bot @BotFather admin du canal. Dans un CANAL, le message apparaît au nom
  // DU CANAL (le bot reste invisible). PAS d'OAuth/review : token bot rangé en
  // secret (KS_TELEGRAM_BOT_TOKEN). La photo est servie via URL publique (R2).
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    enabled: true,
    targets: ['channel'],
    text: { maxLength: 4096, supportsHashtags: true, supportsMentions: true },
    media: {
      enabled: true,
      image: { max: 10, mimes: ['image/jpeg', 'image/png'], aspectRatios: ['1:1', '1.91:1', '4:5'] },
      video: { max: 1, mimes: ['video/mp4'], maxDurationSec: 3600 },
      carousel: true,            // Phase 2 (juin 2026) — album multi-image via sendMediaGroup.
      required: false,           // Telegram accepte le texte seul
      hostedUrlRequired: true,   // photo passée par URL publique (R2), pas d'upload binaire
      captionMaxLength: 1024,    // ⚠ avec photo, la légende est limitée à 1024 (vs 4096 en texte seul)
    },
    link: { supported: true, preview: true },
    firstComment: false,
    auth: {
      type: 'bot-token',         // PAS d'OAuth : token @BotFather en secret KS_TELEGRAM_BOT_TOKEN
      tokenTtlDays: null,        // un token bot n'expire pas
      refreshable: false,
    },
    api: {
      base: 'https://api.telegram.org',
      publishPath: '/bot{token}/sendMessage',
      versionHeader: null,
      version: 'bot',
    },
    access: { channel: 'bot-admin' },   // le bot doit être admin du canal (droit de publication)
  },

};

// ── Helpers de lecture ────────────────────────────────────────

/** Renvoie la fiche d'une plateforme, ou null. */
export function getPlatform(id) {
  return PLATFORMS[id] || null;
}

/**
 * Liste les plateformes.
 * @param {{ enabledOnly?: boolean }} [opts]
 * @returns {PlatformCaps[]}
 */
export function listPlatforms({ enabledOnly = false } = {}) {
  return Object.values(PLATFORMS).filter(p => !enabledOnly || p.enabled);
}

/** Ids des plateformes effectivement branchées (enabled). */
export function enabledPlatformIds() {
  return listPlatforms({ enabledOnly: true }).map(p => p.id);
}

/**
 * Projection UI-safe du registre pour le front (pad Social Manager).
 * Expose UNIQUEMENT les capacités utiles au composer — jamais `auth`/`api`
 * (URLs, scopes, versions). Le front lit ceci au lieu de coder un réseau en dur.
 * @returns {Array<Object>}
 */
export function listPlatformsPublic() {
  return listPlatforms().map(p => ({
    id: p.id,
    label: p.label,
    enabled: p.enabled,
    targets: p.targets || [],
    text: {
      maxLength: p.text?.maxLength ?? null,
      supportsHashtags: !!p.text?.supportsHashtags,
      maxHashtags: p.text?.maxHashtags ?? null,
    },
    media: {
      enabled: p.media?.enabled !== false,   // défaut: supporté (seul LinkedIn = false aujourd'hui)
      required: !!p.media?.required,
      imageMax: p.media?.image?.max ?? 0,
      carousel: !!p.media?.carousel,
      hostedUrlRequired: !!p.media?.hostedUrlRequired,
      captionMaxLength: p.media?.captionMaxLength ?? null,
    },
    link: { supported: !!p.link?.supported },
    firstComment: !!p.firstComment,
  }));
}

/**
 * Valide un post canonique CONTRE les capacités d'une plateforme.
 * Ne publie rien — sert au composer (preview live) et au moteur (garde-fou).
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateForPlatform(canonical, platformId) {
  const p = getPlatform(platformId);
  const errors = [];
  const warnings = [];
  if (!p) return { ok: false, errors: [`Plateforme inconnue : ${platformId}`], warnings };
  if (!p.enabled) warnings.push(`${p.label} n'est pas encore branchée (enabled=false).`);

  const text  = (canonical?.text || '').trim();
  const media = Array.isArray(canonical?.media) ? canonical.media : [];

  // Limite effective : avec un média, certains réseaux imposent une légende plus
  // courte (ex. Telegram 1024 vs 4096 en texte seul) → on retient captionMaxLength.
  const effMax = (media.length > 0 && p.media?.captionMaxLength) ? p.media.captionMaxLength : p.text?.maxLength;
  if (effMax && text.length > effMax) {
    const suffix = (media.length > 0 && p.media?.captionMaxLength) ? ' (légende avec média)' : '';
    errors.push(`Texte trop long pour ${p.label} : ${text.length}/${effMax} caractères${suffix}.`);
  }
  if (p.media?.required && media.length === 0) {
    errors.push(`${p.label} exige au moins un média.`);
  }
  if (media.length > 0 && p.media && p.media.enabled === false) {
    errors.push(`${p.label} n'accepte pas encore les photos (publication texte seul pour l'instant).`);
  }
  const images = media.filter(m => m.type === 'image');
  // Garde-fou multi-image : le carrousel n'est pas câblé (les adapters throw dès la 2ᵉ image).
  // On refuse ICI (aperçu rouge, front ET moteur via broadcast.js) au lieu de laisser planter
  // à l'envoi (aperçu vert → crash). Repasser registry media.carousel à true le lèvera.
  if (images.length > 1 && p.media && p.media.carousel === false) {
    errors.push(`${p.label} ne gère qu'une seule image pour l'instant (carrousel multi-images à venir).`);
  }
  if (p.media?.image?.max && images.length > p.media.image.max) {
    errors.push(`Trop d'images pour ${p.label} : ${images.length}/${p.media.image.max}.`);
  }
  if (p.media?.hostedUrlRequired && media.some(m => !/^https?:\/\//.test(m.url || ''))) {
    errors.push(`${p.label} exige une URL média publique (https).`);
  }
  if (p.text?.maxHashtags && Array.isArray(canonical?.hashtags) && canonical.hashtags.length > p.text.maxHashtags) {
    warnings.push(`${canonical.hashtags.length} hashtags : ${p.label} en recommande ${p.text.maxHashtags} max.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
