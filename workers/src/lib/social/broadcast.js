/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Moteur de diffusion v1.0
   (Sprint Social-0 — Socle d'extensibilité)

   Le dispatcher est GÉNÉRIQUE : il ne connaît aucun réseau en dur.
   Il résout l'adapter via la table ADAPTERS et orchestre, par cible :
   formatPost → (uploadMedia) → publish. Chaque cible est isolée — une
   erreur sur l'une n'empêche pas les autres (statut global 'partial'
   possible). broadcast() ne throw JAMAIS globalement.
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform, validateForPlatform } from './registry.js';
import { validateCanonical } from './canonical.js';
import { decrypt } from '../crypto.js';
import { adapter as linkedinAdapter } from './adapters/linkedin.js';
import { adapter as facebookAdapter } from './adapters/facebook.js';
import { adapter as instagramAdapter } from './adapters/instagram.js';
import { adapter as threadsAdapter } from './adapters/threads.js';
import { adapter as telegramAdapter } from './adapters/telegram.js';

/**
 * LE CONTRAT que chaque adapter de réseau doit respecter.
 * @typedef {Object} SocialAdapter
 * @property {string} platform
 * @property {(canonical, platformCfg) => Object} formatPost
 *           Transforme le post canonique → payload spécifique réseau.
 *           PUR (aucune I/O) → utilisable en preview / dry-run.
 * @property {(args:{account,accessToken,payload,env}) => Promise<{externalId:string,url?:string}>} publish
 *           Publie réellement et renvoie l'id/url du post créé.
 * @property {(args:{account,accessToken,media,env}) => Promise<any[]>} [uploadMedia]
 *           (Optionnel) Téléverse les médias si le réseau l'exige. Certains
 *           réseaux publient via URL directe (Facebook) et n'en ont pas besoin.
 * @property {Function} [refreshToken]
 *           Rafraîchit l'access token. Orchestré par la couche comptes/OAuth
 *           (Sprint Social-1), pas par broadcast(). Signature finalisée au câblage.
 */

// ── Table des adapters — 1 ligne par réseau branché ───────────
// AJOUTER UN RÉSEAU = importer son adapter et l'ajouter ici (+ fiche registry).
const ADAPTERS = {
  linkedin: linkedinAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  threads: threadsAdapter,
  telegram: telegramAdapter,
};

/** Renvoie l'adapter d'une plateforme, ou null. */
export function getAdapter(platformId) {
  return ADAPTERS[platformId] || null;
}

// Vidéo asynchrone (IG/Threads, Phase 3.2) : fenêtre max pendant laquelle le cron
// poll un conteneur « en traitement » avant de l'abandonner (réseau marqué en échec).
const MAX_PROCESSING_MS = 30 * 60 * 1000;   // 30 min

/**
 * Diffuse un post canonique vers plusieurs plateformes.
 * @param {Object}  args
 * @param {import('./canonical.js').CanonicalPost} args.canonical
 * @param {string[]} args.targets                ids de plateformes ciblées
 * @param {Record<string,Object>} [args.accounts] map platformId → row social_accounts
 * @param {Object}  args.env
 * @param {boolean} [args.dryRun]                true = tout sauf l'appel réseau
 * @returns {Promise<Array<{platform:string,status:string,externalId?:string,url?:string,payload?:Object,error?:string}>>}
 */
export async function broadcast({ canonical, targets, accounts = {}, priors = {}, env, dryRun = false }) {
  const base = validateCanonical(canonical);
  if (!base.ok) {
    return (targets || []).map(p => ({ platform: p, status: 'failed', error: base.errors.join(' ') }));
  }

  const results = [];
  for (const platformId of (targets || [])) {
    results.push(await publishOne(platformId, canonical, accounts[platformId], priors[platformId], env, dryRun));
  }
  return results;
}

async function publishOne(platformId, canonical, account, prior, env, dryRun) {
  try {
    const platform = getPlatform(platformId);
    const adapter  = getAdapter(platformId);
    if (!platform || !adapter) {
      return { platform: platformId, status: 'failed', error: 'Plateforme non branchée.' };
    }

    // Garde-fou capacités (longueur, médias requis, URL publique…)
    const check = validateForPlatform(canonical, platformId);
    if (!check.ok) {
      return { platform: platformId, status: 'failed', error: check.errors.join(' ') };
    }

    const payload = adapter.formatPost(canonical, platform);

    // Dry-run : on s'arrête avant tout appel réseau (testable sans credentials).
    if (dryRun) {
      return { platform: platformId, status: 'dry-run', payload, warnings: check.warnings };
    }

    if (!account) {
      return { platform: platformId, status: 'failed', error: 'Aucun compte connecté.' };
    }

    // Vidéo asynchrone (IG/Threads) : un conteneur « en traitement » depuis trop
    // longtemps est abandonné — sinon le cron le poll indéfiniment.
    if (prior?.status === 'processing' && prior.since) {
      const elapsed = Date.now() - Date.parse(prior.since);
      if (Number.isFinite(elapsed) && elapsed > MAX_PROCESSING_MS) {
        return { platform: platformId, status: 'failed', error: 'Traitement vidéo trop long (délai dépassé).' };
      }
    }

    const accessToken = await decrypt(account.access_ciphertext, account.access_iv, env.KS_ENCRYPTION_KEY);

    // Médias : téléversement préalable si nécessaire et supporté par l'adapter.
    let finalPayload = payload;
    if (Array.isArray(canonical.media) && canonical.media.length > 0 && adapter.uploadMedia) {
      const uploaded = await adapter.uploadMedia({ account, accessToken, media: canonical.media, env });
      finalPayload = { ...payload, media: uploaded };
    }

    // L'adapter reçoit l'état antérieur (`prior`) → vidéo en 2 temps : 1er appel crée
    // le conteneur et renvoie { status:'processing', creationId } ; appels suivants
    // (via le cron) poll 1 fois et publient quand prêt. Réseaux synchrones = ignorent `prior`.
    const ret = await adapter.publish({ account, accessToken, payload: finalPayload, env, prior });
    if (ret && ret.status === 'processing') {
      return { platform: platformId, status: 'processing', creationId: ret.creationId, since: prior?.since || new Date().toISOString() };
    }
    return { platform: platformId, status: 'published', externalId: ret?.externalId, url: ret?.url };

  } catch (e) {
    return { platform: platformId, status: 'failed', error: e?.message || String(e) };
  }
}

/**
 * Récupère les insights d'UN post déjà publié sur UNE plateforme. Symétrique de
 * publishOne : résout l'adapter, déchiffre le token, délègue à adapter.fetchInsights.
 * Ne throw JAMAIS → { platform, metrics } | { platform, unsupported } | { platform, error }.
 */
export async function fetchPostInsights({ platform, externalId, account, env }) {
  const adapter = getAdapter(platform);
  if (!adapter || typeof adapter.fetchInsights !== 'function') return { platform, unsupported: true };
  if (!externalId) return { platform, error: 'identifiant de post manquant' };
  if (!account)    return { platform, error: 'compte non connecté' };
  try {
    const accessToken = await decrypt(account.access_ciphertext, account.access_iv, env.KS_ENCRYPTION_KEY);
    const { metrics } = await adapter.fetchInsights({ account, accessToken, externalId, env });
    return { platform, metrics: metrics || [] };
  } catch (e) {
    return { platform, error: e?.message || String(e) };
  }
}
