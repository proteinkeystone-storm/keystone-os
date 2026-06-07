/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Post canonique v1.0
   (Sprint Social-0 — Socle d'extensibilité)

   Le "post canonique" est le format NEUTRE et UNIQUE produit par le
   pad Social Manager (ou une règle d'automatisation). Chaque adapter
   de plateforme le transforme ensuite vers SON format propre.

   Conçu LARGE dès le départ (texte, médias multiples image/vidéo,
   carrousel, lien, hashtags déportables, mentions légales, meta
   extensible) — même si la v1 n'en exploite qu'un sous-ensemble.
   Objectif : ne jamais être bridé par le modèle plus tard.
   ═══════════════════════════════════════════════════════════════ */

export const CANONICAL_VERSION = 1;

/**
 * @typedef {Object} CanonicalMedia
 * @property {'image'|'video'} type
 * @property {string}  url            URL publique (R2) ou ref interne résolue avant publication
 * @property {string}  [alt]          texte alternatif (accessibilité)
 * @property {string}  [ratio]        '1:1' | '4:5' | '1.91:1' …
 * @property {number}  [width]
 * @property {number}  [height]
 * @property {number}  [durationSec]  pour les vidéos
 */

/**
 * @typedef {Object} CanonicalPost
 * @property {number}   v             version du schéma (CANONICAL_VERSION)
 * @property {string}   text          corps principal (adapté/tronqué par chaque adapter)
 * @property {CanonicalMedia[]} media 0..n médias (carrousel si >1)
 * @property {string}   [link]        URL à partager
 * @property {string[]} hashtags      SANS le '#'. Placés selon la plateforme (légende ou 1er commentaire)
 * @property {string}   [firstComment] texte du 1er commentaire (ex. hashtags déportés)
 * @property {Object}   [legal]       mentions légales à injecter (ex. { dpe, honoraires, mandat })
 * @property {Object}   meta          bac extensible spécifique source/métier (jamais lu par le Core)
 */

/**
 * Construit un post canonique normalisé à partir d'une entrée libre.
 * Applique les valeurs par défaut et nettoie les types.
 * @param {Partial<CanonicalPost>} [input]
 * @returns {CanonicalPost}
 */
export function createCanonicalPost(input = {}) {
  return {
    v: CANONICAL_VERSION,
    text: typeof input.text === 'string' ? input.text : '',
    media: normalizeMedia(input.media),
    link: input.link || undefined,
    hashtags: normalizeHashtags(input.hashtags),
    firstComment: input.firstComment || undefined,
    legal: input.legal && typeof input.legal === 'object' ? input.legal : undefined,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
  };
}

function normalizeMedia(media) {
  if (!Array.isArray(media)) return [];
  return media
    .filter(m => m && (m.type === 'image' || m.type === 'video') && typeof m.url === 'string')
    .map(m => ({
      type: m.type,
      url: m.url,
      alt: m.alt || undefined,
      ratio: m.ratio || undefined,
      width:  Number.isFinite(m.width)  ? m.width  : undefined,
      height: Number.isFinite(m.height) ? m.height : undefined,
      durationSec: Number.isFinite(m.durationSec) ? m.durationSec : undefined,
    }));
}

function normalizeHashtags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map(t => String(t).trim().replace(/^#+/, ''))   // retire un éventuel '#' de tête
    .filter(Boolean);
}

/**
 * Validation MINIMALE et agnostique (indépendante de toute plateforme).
 * Les contraintes par réseau sont gérées par registry.validateForPlatform().
 * @param {CanonicalPost} post
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCanonical(post) {
  const errors = [];
  if (!post || typeof post !== 'object') {
    return { ok: false, errors: ['Post canonique absent ou invalide.'] };
  }
  const hasText  = typeof post.text === 'string' && post.text.trim().length > 0;
  const hasMedia = Array.isArray(post.media) && post.media.length > 0;
  if (!hasText && !hasMedia) {
    errors.push('Un post doit contenir au moins du texte ou un média.');
  }
  for (const m of (post.media || [])) {
    if (!/^https?:\/\//.test(m.url || '') && !/^r2:\/\//.test(m.url || '')) {
      errors.push(`Média sans URL exploitable : ${JSON.stringify(m.url)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
