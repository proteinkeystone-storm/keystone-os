/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Social Broadcast (PRODUCTION) v1.2
   (Sprint Social-1 — câblage du moteur de diffusion)

   POST /api/social/provision/facebook  Admin — range le compte FB en base
   POST /api/social/publish             Admin — diffuse un post via le moteur
   GET  /api/social/accounts            Admin — liste les comptes connectés

   Auth : gate FLEXIBLE — secret KS_ADMIN_SECRET (/admin) OU JWT isAdmin
   (/app, où l'admin n'a que ks_jwt). Même pattern que asset-transfer.js.

   Logique métier extraite en fonctions réutilisables (provisionFacebook,
   publishCanonical) — utilisables aussi par le CRON et le futur Pad.
   Tokens chiffrés AES-256-GCM (lib/crypto.js).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, generateId, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT }          from '../lib/jwt.js';
import { encrypt, decrypt }    from '../lib/crypto.js';
import { ensureSocialSchema }  from '../lib/social/schema.js';
import { broadcast, fetchPostInsights } from '../lib/social/broadcast.js';
import { createCanonicalPost, validateCanonical } from '../lib/social/canonical.js';
import { getPlatform, listPlatformsPublic } from '../lib/social/registry.js';

// ── Gate admin flexible : secret (/admin) OU JWT isAdmin/plan ADMIN (/app) ──
export async function requireAdminFlexible(request, env) {
  if (requireAdmin(request, env)) return true;
  const claims = await requireJWT(request, env);
  return claims?.isAdmin === true || claims?.plan === 'ADMIN';
}

// ── Résolution du TENANT (Sprint Multi-tenant-1) ──────────────
// Source de vérité du tenant = l'IDENTITÉ AUTHENTIFIÉE, JAMAIS un paramètre
// client (sinon n'importe qui lirait/écrirait les données d'autrui via
// ?tenantId=). Même règle que le reste de Keystone (cf. routes/data.js → sub).
//   - Admin (secret /admin OU JWT isAdmin/plan ADMIN) → 'default' : tenant
//     légataire de l'owner (comptes sociaux historiques) → ZÉRO migration.
//   - Client payant (JWT non-admin) → son propre tenant = claims.sub.
//   - Pas d'auth → null (le handler renvoie 401).
// ⚠ Ouverture aux clients (gate non-admin) = APRÈS le Sprint OAuth : le
//   provisioning actuel utilise les TOKENS SYSTÈME de l'owner — l'ouvrir
//   maintenant laisserait un client provisionner les comptes de l'owner.
// Crée le tenant à la volée s'il n'existe pas. Les tables social_* ont une
// contrainte FOREIGN KEY (tenant_id) REFERENCES tenants(id) ; or un client
// non-admin a pour tenant son `sub` JWT, JAMAIS semé en base avant sa 1re
// action sociale → sinon « FOREIGN KEY constraint failed » à l'insertion (le
// trou multi-tenant que le 1er test client OAuth a exposé). INSERT OR IGNORE =
// idempotent. 'default' est déjà semé par schema.sql, donc on le saute.
async function _ensureTenant(env, id, name, plan) {
  if (!id || id === 'default') return;
  try {
    await env.DB
      .prepare("INSERT OR IGNORE INTO tenants (id, name, plan) VALUES (?, ?, ?)")
      .bind(id, name || 'Client Keystone', plan || 'STARTER')
      .run();
  } catch (_) { /* non bloquant : ne casse pas le flux social si l'écriture échoue */ }
}

export async function socialTenantOf(request, env) {
  if (requireAdmin(request, env)) return 'default';
  const claims = await requireJWT(request, env);
  if (!claims) return null;
  if (claims.isAdmin === true || claims.plan === 'ADMIN') return 'default';
  if (!claims.sub) return null;
  await _ensureTenant(env, claims.sub, claims.owner || claims.email, claims.plan);
  return claims.sub;
}

// ── Entitlement Social Manager (Sprint Multi-tenant-2) ────────
// QUI a le droit d'utiliser l'outil social ? Même modèle que le front : l'asset
// O-SOC-001 figure dans licences.owned_assets (lookup par sub = lookup_hmac).
// Admin = accès total. Le TENANT reste résolu séparément par socialTenantOf().
// Sépare bien les 2 concerns : « as-tu le droit ? » (entitlement) vs « quel
// tenant ? » (isolation). Routes client : accounts + publish + provision/telegram.
const SOCIAL_ASSET = 'O-SOC-001';
export async function socialEntitled(request, env) {
  if (requireAdmin(request, env)) return true;
  const claims = await requireJWT(request, env);
  if (!claims) return false;
  // Plan MAX = palier « tout inclus » → social accordé par le plan, comme ADMIN
  // (cohérent avec le front : MAX = accès total à toutes les apps).
  if (claims.isAdmin === true || claims.plan === 'ADMIN' || claims.plan === 'MAX') return true;
  if (!claims.sub) return false;
  const lic = await env.DB
    .prepare('SELECT owned_assets FROM licences WHERE lookup_hmac = ? LIMIT 1')
    .bind(claims.sub).first();
  if (!lic) return false;
  // owned_assets NULL/vide = accès total (convention de toute l'app : « vide =
  // TOUS les outils », cf. front getOwnedIds()===null) → inclut le Social Manager.
  // Une licence avec une liste EXPLICITE doit, elle, contenir O-SOC-001 ; une
  // liste explicitement vide ([]) = aucun outil accordé → pas d'accès social.
  if (lic.owned_assets == null || lic.owned_assets === '') return true;
  let assets;
  try { assets = JSON.parse(lic.owned_assets); } catch (_) { return false; }
  if (!Array.isArray(assets)) return false;
  return assets.includes(SOCIAL_ASSET);
}

// ═══ Logique métier réutilisable (HTTP, CRON, automatisation) ═══

/**
 * Range le compte Facebook dans social_accounts (token chiffré).
 * Lit le token système (env.KS_FB_PAGE_TOKEN) et en dérive le Page token.
 * @returns {Promise<{platform,pageId,displayName}>}
 */
export async function provisionFacebook(env, { pageId = '1191029397423869', tenantId = 'default' } = {}) {
  const sysToken = env.KS_FB_PAGE_TOKEN;
  if (!sysToken)              throw new Error('KS_FB_PAGE_TOKEN non configuré');
  if (!env.KS_ENCRYPTION_KEY) throw new Error('KS_ENCRYPTION_KEY non configurée');

  const cfg  = getPlatform('facebook');
  const res  = await fetch(`${cfg.api.base}/${pageId}?fields=access_token,name&access_token=${encodeURIComponent(sysToken)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Récupération du Page token KO : ${JSON.stringify(data).slice(0, 200)}`);
  }

  const displayName = data.name || 'Facebook Page';
  const scopes = 'pages_show_list,pages_read_engagement,pages_manage_posts';
  const acc = await encrypt(data.access_token, env.KS_ENCRYPTION_KEY);  // access = Page token
  const ref = await encrypt(sysToken,          env.KS_ENCRYPTION_KEY);  // refresh = token système

  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenantId, 'facebook', pageId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, refresh_ciphertext=?, refresh_iv=?,
          display_name=?, scopes=?, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, ref.ciphertext, ref.iv, displayName, scopes, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name,
         access_ciphertext, access_iv, refresh_ciphertext, refresh_iv, scopes, status)
      VALUES (?, ?, 'facebook', 'page', ?, ?, ?, ?, ?, ?, ?, 'connected')
    `).bind(generateId(), tenantId, pageId, displayName, acc.ciphertext, acc.iv, ref.ciphertext, ref.iv, scopes).run();
  }

  return { platform: 'facebook', pageId, displayName };
}

/**
 * Range le compte Instagram dans social_accounts (token chiffré).
 * Une seule requête Graph dérive, depuis la Page : le Page token (qui porte
 * les permissions IG) ET l'IG user-id du compte Business lié à la Page.
 * @returns {Promise<{platform,igUserId,displayName}>}
 */
export async function provisionInstagram(env, { pageId = '1191029397423869', tenantId = 'default' } = {}) {
  const sysToken = env.KS_FB_PAGE_TOKEN;
  if (!sysToken)              throw new Error('KS_FB_PAGE_TOKEN non configuré');
  if (!env.KS_ENCRYPTION_KEY) throw new Error('KS_ENCRYPTION_KEY non configurée');

  const cfg  = getPlatform('instagram');
  const res  = await fetch(`${cfg.api.base}/${pageId}?fields=access_token,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(sysToken)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Récupération du Page token KO : ${JSON.stringify(data).slice(0, 200)}`);
  }
  const ig = data.instagram_business_account;
  if (!ig || !ig.id) {
    throw new Error("Aucun compte Instagram Business lié à cette Page. Passe ton compte IG en Business/Creator et lie-le à la Page dans Meta Business Suite, puis réessaie.");
  }

  const igUserId    = ig.id;
  const displayName = ig.username ? `@${ig.username}` : (ig.name || 'Instagram');
  const scopes = 'instagram_basic,instagram_content_publish,pages_show_list';
  const acc = await encrypt(data.access_token, env.KS_ENCRYPTION_KEY);  // access = Page token (porte les perms IG)
  const ref = await encrypt(sysToken,          env.KS_ENCRYPTION_KEY);  // refresh = token système

  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenantId, 'instagram', igUserId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, refresh_ciphertext=?, refresh_iv=?,
          display_name=?, scopes=?, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, ref.ciphertext, ref.iv, displayName, scopes, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name,
         access_ciphertext, access_iv, refresh_ciphertext, refresh_iv, scopes, status)
      VALUES (?, ?, 'instagram', 'business', ?, ?, ?, ?, ?, ?, ?, 'connected')
    `).bind(generateId(), tenantId, igUserId, displayName, acc.ciphertext, acc.iv, ref.ciphertext, ref.iv, scopes).run();
  }

  return { platform: 'instagram', igUserId, displayName };
}

/**
 * Range le compte Threads dans social_accounts (token chiffré).
 * Lit le token longue durée généré côté app Meta (env.KS_THREADS_TOKEN,
 * via le « Générateur de token » du cas d'usage Threads) et en dérive
 * l'id + username via /me. Threads n'a PAS de token système comme FB/IG ;
 * pour le self-service multi-tenant, voir le flux OAuth dans social-threads.js.
 * @returns {Promise<{platform,userId,displayName}>}
 */
export async function provisionThreads(env, { tenantId = 'default' } = {}) {
  const token = env.KS_THREADS_TOKEN;
  if (!token)                 throw new Error('KS_THREADS_TOKEN non configuré');
  if (!env.KS_ENCRYPTION_KEY) throw new Error('KS_ENCRYPTION_KEY non configurée');

  const res  = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads /me KO : ${JSON.stringify(data).slice(0, 200)}`);
  }

  const userId      = String(data.id);
  const displayName = data.username ? `@${data.username}` : 'Threads';
  const scopes      = 'threads_basic,threads_content_publish';
  const acc         = await encrypt(token, env.KS_ENCRYPTION_KEY);

  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenantId, 'threads', userId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, display_name=?, scopes=?, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, displayName, scopes, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext, access_iv, scopes, status)
      VALUES (?, ?, 'threads', 'profile', ?, ?, ?, ?, ?, 'connected')
    `).bind(generateId(), tenantId, userId, displayName, acc.ciphertext, acc.iv, scopes).run();
  }

  return { platform: 'threads', userId, displayName };
}

/**
 * Range le compte Telegram (canal) dans social_accounts.
 * Lit le token bot (env.KS_TELEGRAM_BOT_TOKEN, créé via @BotFather), vérifie le
 * bot (/getMe) et le canal (/getChat — le bot doit y être admin), puis stocke le
 * token chiffré + le chat (external_id = @username public, sinon id numérique).
 * @returns {Promise<{platform,chatId,displayName,bot}>}
 */
export async function provisionTelegram(env, { chatId, tenantId = 'default' } = {}) {
  const token = env.KS_TELEGRAM_BOT_TOKEN;
  if (!token)                 throw new Error('KS_TELEGRAM_BOT_TOKEN non configuré');
  if (!env.KS_ENCRYPTION_KEY) throw new Error('KS_ENCRYPTION_KEY non configurée');
  if (!chatId)                throw new Error('Champ "chatId" requis (ex : "@mon_canal")');

  const base = 'https://api.telegram.org';

  // 1) Le bot répond ?
  const meRes = await fetch(`${base}/bot${token}/getMe`);
  const me    = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.ok) throw new Error(`Telegram getMe KO : ${me?.description || 'token bot invalide ?'}`);

  // 2) Le canal existe et le bot y a accès (admin) ?
  const chatRes = await fetch(`${base}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
  const chat    = await chatRes.json().catch(() => ({}));
  if (!chatRes.ok || !chat.ok) {
    throw new Error(`Telegram getChat KO : ${chat?.description || "le bot est-il admin du canal et le chatId correct ?"}`);
  }

  const c           = chat.result || {};
  const externalId  = c.username ? `@${c.username}` : String(c.id);
  const displayName = c.title || (c.username ? `@${c.username}` : 'Telegram');
  const acc         = await encrypt(token, env.KS_ENCRYPTION_KEY);

  const existing = await env.DB
    .prepare('SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND external_id = ?')
    .bind(tenantId, 'telegram', externalId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE social_accounts
      SET access_ciphertext=?, access_iv=?, display_name=?, scopes=?, status='connected', updated_at=datetime('now')
      WHERE id=?
    `).bind(acc.ciphertext, acc.iv, displayName, 'channel_post', existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO social_accounts
        (id, tenant_id, platform, target_type, external_id, display_name, access_ciphertext, access_iv, scopes, status)
      VALUES (?, ?, 'telegram', 'channel', ?, ?, ?, ?, ?, 'connected')
    `).bind(generateId(), tenantId, externalId, displayName, acc.ciphertext, acc.iv, 'channel_post').run();
  }

  return { platform: 'telegram', chatId: externalId, displayName, bot: me.result?.username ? `@${me.result.username}` : null };
}

/**
 * Noyau de diffusion RÉUTILISABLE (sans persistance) : charge les comptes
 * connectés du tenant, appelle broadcast(), calcule le statut. Les appelants
 * décident d'INSÉRER (publication immédiate) ou d'UPDATER (post programmé).
 * @returns {Promise<{results:Array, status:string}>}
 */
async function _runBroadcast(env, { canonical, targets, priors = {}, tenantId, dryRun = false }) {
  const tgts = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const accounts = {};
  if (tgts.length) {
    const placeholders = tgts.map(() => '?').join(',');
    const { results: rows } = await env.DB
      .prepare(`SELECT * FROM social_accounts WHERE tenant_id = ? AND status = 'connected' AND platform IN (${placeholders})`)
      .bind(tenantId, ...tgts).all();
    for (const r of rows) accounts[r.platform] = r;   // broadcast() déchiffre lui-même
  }
  const results = await broadcast({ canonical, targets: tgts, accounts, priors, env, dryRun });
  return { results, status: computeStatus(results, dryRun) };
}

/** Construit le post canonique à partir des options libres (publish ou schedule). */
function _canonicalFromOpts(opts) {
  return createCanonicalPost({
    text: opts.text, media: opts.media, link: opts.link,
    hashtags: opts.hashtags, firstComment: opts.firstComment, legal: opts.legal, meta: opts.meta,
  });
}

/**
 * Diffuse un post IMMÉDIATEMENT : noyau de diffusion + INSERT dans social_posts.
 * Comportement historique inchangé (publication synchrone).
 * @returns {Promise<{postId,status,results}>}
 */
export async function publishCanonical(env, opts = {}) {
  const tenantId = opts.tenantId || 'default';
  const dryRun   = !!opts.dryRun;
  const targets  = Array.isArray(opts.targets) ? opts.targets.filter(Boolean) : [];
  if (!targets.length) throw new Error('Champ "targets" requis (ex : ["facebook"])');

  const canonical = _canonicalFromOpts(opts);
  const { results } = await _runBroadcast(env, { canonical, targets, tenantId, dryRun });

  // 1er passage. Réseau raté → 'retrying' (le cron reprend, backoff borné) ; vidéo
  // IG/Threads → 'processing' (le cron poll puis publie). _settle tranche + compte l'essai.
  const { status, nextAttemptAt, attempts } = dryRun
    ? { status: 'draft', nextAttemptAt: null, attempts: 1 }
    : _settle(results, 0);

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO social_posts (id, tenant_id, source, canonical, targets, status, results, attempts, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenantId, opts.source || 'manual',
    JSON.stringify(canonical), JSON.stringify(targets), status, JSON.stringify(results), attempts, nextAttemptAt,
  ).run();

  return { postId: id, status, results };
}

export function computeStatus(results, dryRun) {
  if (dryRun) return 'draft';
  if (results.some(r => r.status === 'processing')) return 'processing';
  const published = results.filter(r => r.status === 'published').length;
  const failed    = results.filter(r => r.status === 'failed').length;
  if (published && failed) return 'partial';
  if (published)           return 'published';
  return 'failed';
}

// ═══ Durabilité : réessais automatiques (Sprint Social-4.2) ════
// Un envoi qui échoue (réseau down 2 s, 429, timeout…) ne doit pas rester mort.
// On retente — UNIQUEMENT les réseaux ratés, jamais ceux déjà publiés (sinon
// double-post) — via le cron */5 déjà en place, avec un backoff borné. L'état
// vit en base (attempts, next_attempt_at) → durable sans Queues ni Workflows.
const MAX_ATTEMPTS = 4;                              // 1 envoi initial + 3 réessais
const RETRY_DELAY_MIN = { 1: 5, 2: 15, 3: 60 };      // après l'essai n°k → attendre N min
const PROCESSING_POLL_MS = 45 * 1000;                // vidéo IG/Threads « en traitement » → cadence de re-poll du cron

// Décide de la suite après un essai : terminé, ou à reprogrammer ('retrying').
export function _retryDecision(results, attempts) {
  const failed    = results.filter(r => r.status === 'failed').length;
  const published = results.filter(r => r.status === 'published').length;
  if (!failed) return { status: published ? 'published' : 'failed', nextAttemptAt: null };
  if (attempts < MAX_ATTEMPTS && RETRY_DELAY_MIN[attempts]) {
    return { status: 'retrying', nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MIN[attempts] * 60_000).toISOString() };
  }
  return { status: published ? 'partial' : 'failed', nextAttemptAt: null };   // réessais épuisés → terminal
}

// Décide statut + échéance + compteur d'essais après un passage de diffusion.
// Vidéo IG/Threads « en traitement » → repasse vite SANS consommer d'essai (un poll
// n'est pas un échec) ; sinon décision de réessai normale (qui, elle, incrémente).
export function _settle(results, priorAttempts) {
  if (results.some(r => r.status === 'processing')) {
    return {
      status: 'processing',
      nextAttemptAt: new Date(Date.now() + PROCESSING_POLL_MS).toISOString(),
      attempts: priorAttempts,
    };
  }
  const attempts = priorAttempts + 1;
  const { status, nextAttemptAt } = _retryDecision(results, attempts);
  return { status, nextAttemptAt, attempts };
}

// Fusionne les résultats : garde les réseaux DÉJÀ publiés, remplace le reste par
// le nouvel essai. Garantit une entrée par cible.
function _mergeResults(allTargets, prev, fresh) {
  const byPlat = {};
  for (const r of (prev  || [])) if (r && r.platform) byPlat[r.platform] = r;
  for (const r of (fresh || [])) if (r && r.platform) byPlat[r.platform] = r;
  return allTargets.map(p => byPlat[p] || { platform: p, status: 'failed', error: 'non tenté' });
}

// ═══ Programmation (Sprint Social-4.1) ═════════════════════════
// Un post programmé est RANGÉ (status='scheduled', scheduled_at=ISO) SANS
// diffusion. Le cron de balayage (sweepDuePosts, appelé par scheduled() dans
// index.js au rythme */5) le réclame à l'échéance et le publie via le MÊME
// noyau _runBroadcast. Découplage strict saisie ↔ envoi.

/** Parse un scheduledAt en Date, ou null si absent/invalide. */
function _parseScheduledAt(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Range un post à publier plus tard. Valide le contenu À LA SAISIE (un post
 * vide programmé échouerait silencieusement à l'échéance) et exige une date
 * FUTURE. N'effectue AUCUN appel réseau.
 * @returns {Promise<{postId,status:'scheduled',scheduledAt:string}>}
 */
export async function schedulePost(env, opts = {}) {
  const tenantId = opts.tenantId || 'default';
  const targets  = Array.isArray(opts.targets) ? opts.targets.filter(Boolean) : [];
  if (!targets.length) throw new Error('Champ "targets" requis (ex : ["facebook"])');

  const when = _parseScheduledAt(opts.scheduledAt);
  if (!when) throw new Error('Champ "scheduledAt" invalide (date ISO attendue, ex : 2026-06-10T09:00:00Z).');
  // Marge de 30 s : tolère l'aller-retour réseau, refuse une date déjà passée
  // (souvent le symptôme d'un bug de fuseau côté front).
  if (when.getTime() <= Date.now() + 30_000) {
    throw new Error('La date de programmation doit être dans le futur.');
  }

  const canonical = _canonicalFromOpts(opts);
  const check = validateCanonical(canonical);
  if (!check.ok) throw new Error(check.errors.join(' '));

  const id = generateId();
  const scheduledIso = when.toISOString();
  await env.DB.prepare(`
    INSERT INTO social_posts (id, tenant_id, source, canonical, targets, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
  `).bind(
    id, tenantId, opts.source || 'manual',
    JSON.stringify(canonical), JSON.stringify(targets), scheduledIso,
  ).run();

  return { postId: id, status: 'scheduled', scheduledAt: scheduledIso };
}

/**
 * Publie un post DÉJÀ rangé (ligne social_posts) : diffuse via _runBroadcast
 * puis UPDATE le statut + results. Utilisé par le balayage du cron.
 * @returns {Promise<{postId,status,results}>}
 */
async function publishScheduledRow(env, row, { dryRun = false, from = null } = {}) {
  let canonical, allTargets, prev;
  try {
    canonical  = JSON.parse(row.canonical);
    allTargets = JSON.parse(row.targets);
    prev       = row.results ? JSON.parse(row.results) : [];
  } catch (e) {
    const results = [{ platform: '*', status: 'failed', error: `Post illisible : ${e.message}` }];
    await env.DB.prepare(`UPDATE social_posts SET status='failed', results=?, next_attempt_at=NULL, updated_at=datetime('now') WHERE id=?`)
      .bind(JSON.stringify(results), row.id).run();
    return { postId: row.id, status: 'failed', results };
  }

  // On ne (re)tente JAMAIS un réseau déjà publié → pas de double-post.
  const publishedSet  = new Set((prev || []).filter(r => r.status === 'published').map(r => r.platform));
  // Passage de POLL vidéo (on vient de 'processing') → on ne re-sollicite QUE les
  // réseaux encore en traitement ; les ratés repartiront en 'retrying' une fois le
  // traitement résolu (sinon leur budget d'essais brûlerait au rythme du poll).
  const processingSet = new Set((prev || []).filter(r => r.status === 'processing').map(r => r.platform));
  const toTry = (from === 'processing')
    ? allTargets.filter(p => processingSet.has(p))
    : allTargets.filter(p => !publishedSet.has(p));

  // priors : transmet l'état antérieur (creationId, since) aux réseaux re-sollicités
  // → la vidéo poll son conteneur au lieu d'en recréer un (pas de double-post).
  const priors = {};
  for (const r of (prev || [])) if (r && r.platform) priors[r.platform] = r;

  const { results: fresh } = await _runBroadcast(env, { canonical, targets: toTry, priors, tenantId: row.tenant_id, dryRun });
  const merged = _mergeResults(allTargets, prev, fresh);
  const { status, nextAttemptAt, attempts } = dryRun
    ? { status: 'draft', nextAttemptAt: null, attempts: row.attempts || 0 }
    : _settle(merged, row.attempts || 0);

  await env.DB.prepare(`
    UPDATE social_posts SET status=?, results=?, attempts=?, next_attempt_at=?, updated_at=datetime('now') WHERE id=?
  `).bind(status, JSON.stringify(merged), attempts, nextAttemptAt, row.id).run();
  return { postId: row.id, status, results: merged };
}

/**
 * Balaye les posts programmés arrivés à échéance et les publie. Idempotent :
 * chaque ligne est RÉCLAMÉE atomiquement (status 'scheduled'→'publishing' via
 * UPDATE conditionnel, on vérifie meta.changes) AVANT tout envoi → deux ticks
 * qui se chevauchent ne publient jamais 2×. Cap par tick (anti-débordement
 * CPU/sous-requêtes), surplus loggé (jamais de troncature silencieuse).
 *
 * ⚠ Dates : scheduled_at est de l'ISO (…T..Z), datetime('now') rend
 * 'YYYY-MM-DD HH:MM:SS' → on normalise les DEUX via datetime() sinon la
 * comparaison de chaînes brute est fausse.
 * @returns {Promise<{swept,published,partial,failed,skipped,overflow}>}
 */
export async function sweepDuePosts(env, { dryRun = false, limit = 10 } = {}) {
  await ensureSocialSchema(env);
  // Dus = programmés à l'heure, OU réessais arrivés à échéance, OU publications
  // « coincées » (worker mort en plein envoi → 'publishing' figé > 10 min = filet).
  const { results: due } = await env.DB.prepare(
    `SELECT id, status FROM social_posts
       WHERE (status = 'scheduled'  AND scheduled_at    IS NOT NULL AND datetime(scheduled_at)    <= datetime('now'))
          OR (status = 'retrying'   AND next_attempt_at IS NOT NULL AND datetime(next_attempt_at) <= datetime('now') AND attempts < ?)
          OR (status = 'processing' AND next_attempt_at IS NOT NULL AND datetime(next_attempt_at) <= datetime('now'))
          OR (status = 'publishing' AND datetime(updated_at) <= datetime('now','-10 minutes'))
       ORDER BY COALESCE(scheduled_at, next_attempt_at, updated_at) ASC LIMIT ?`
  ).bind(MAX_ATTEMPTS, limit + 1).all();   // +1 : détecte un débordement au-delà du cap

  const overflow = due.length > limit;
  const batch = due.slice(0, limit);
  let published = 0, partial = 0, failed = 0, retrying = 0, processing = 0, skipped = 0;

  for (const { id, status: from } of batch) {
    // Réclamation atomique sur le statut ATTENDU → 'publishing'. Si un autre tick
    // l'a déjà pris (changes=0), on saute → jamais de double-envoi.
    const claim = await env.DB.prepare(
      `UPDATE social_posts SET status='publishing', updated_at=datetime('now') WHERE id = ? AND status = ?`
    ).bind(id, from).run();
    if ((claim.meta?.changes || 0) !== 1) { skipped++; continue; }

    const row = await env.DB.prepare(`SELECT * FROM social_posts WHERE id = ?`).bind(id).first();
    // `from` indique au row s'il s'agit d'un poll vidéo ('processing') ou d'un passage normal.
    const r = await publishScheduledRow(env, row, { dryRun, from });
    if      (r.status === 'published')  published++;
    else if (r.status === 'partial')   partial++;
    else if (r.status === 'retrying')  retrying++;
    else if (r.status === 'processing') processing++;
    else                               failed++;
  }

  const summary = { swept: batch.length, published, partial, failed, retrying, processing, skipped, overflow };
  if (overflow) console.warn('[social-sweep] cap atteint, posts dus restants pour le prochain tick', summary);
  return summary;
}

// ═══ Handlers HTTP (admin flexible) ════════════════════════════

// POST /api/social/provision/facebook  Body : { pageId?, tenantId? }
export async function handleSocialProvisionFacebook(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
    const r = await provisionFacebook(env, { pageId: body.pageId, tenantId });
    return json({ success: true, ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 502, origin);
  }
}

// POST /api/social/provision/instagram  Body : { pageId?, tenantId? }
export async function handleSocialProvisionInstagram(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
    const r = await provisionInstagram(env, { pageId: body.pageId, tenantId });
    return json({ success: true, ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 502, origin);
  }
}

// POST /api/social/provision/threads  Body : { tenantId? }
export async function handleSocialProvisionThreads(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
    const r = await provisionThreads(env, { tenantId });
    return json({ success: true, ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 502, origin);
  }
}

// POST /api/social/provision/telegram  Body : { chatId, tenantId? }
export async function handleSocialProvisionTelegram(request, env) {
  const origin = getAllowedOrigin(env, request);
  // Telegram = self-serve client : pas d'OAuth/review (le bot Keystone partagé
  // est admin du canal du client). Ouvert aux clients entitled, scopé au tenant.
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
    const r = await provisionTelegram(env, { chatId: body.chatId, tenantId });
    return json({ success: true, ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 502, origin);
  }
}

// POST /api/social/publish  Body : { targets:[...], text?, media?, link?, hashtags?, legal?, source?, scheduledAt?, dryRun? }
// scheduledAt (ISO) présent → on PROGRAMME (status 'scheduled', le cron publiera) ; absent → publication immédiate.
export async function handleSocialPublish(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
    if (body.scheduledAt) {
      const r = await schedulePost(env, { ...body, tenantId });
      return json({ success: true, ...r }, 200, origin);
    }
    const r = await publishCanonical(env, { ...body, tenantId });
    return json({ success: r.status !== 'failed', ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 400, origin);
  }
}

// GET /api/social/registry  (capacités déclaratives par réseau — public, aucun secret)
// Le composer lit ceci pour ses garde-fous (longueur, médias, hashtags…) au
// lieu de coder un réseau en dur. Pas d'auth : ce sont des specs d'API publiques.
export function handleSocialRegistry(request, env) {
  const origin = getAllowedOrigin(env, request);
  return json({ platforms: listPlatformsPublic() }, 200, origin);
}

// GET /api/social/accounts  (ne renvoie jamais les tokens)
export async function handleSocialAccountsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  const { results } = await env.DB.prepare(`
    SELECT id, platform, target_type, external_id, display_name, scopes, status, expires_at, created_at, updated_at
    FROM social_accounts WHERE tenant_id = ? ORDER BY platform
  `).bind(tenantId).all();
  return json({ accounts: results }, 200, origin);
}

// POST /api/social/accounts/disconnect  Body : { id }
// Retire un compte connecté (DELETE), scopé tenant. L'utilisateur pourra le
// reconnecter via le wizard (OAuth FB/Threads, deep-link Telegram).
export async function handleSocialAccountDisconnect(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  if (!body.id) return err('Champ "id" requis', 400, origin);
  const r = await env.DB.prepare(`DELETE FROM social_accounts WHERE id = ? AND tenant_id = ?`).bind(body.id, tenantId).run();
  if ((r.meta?.changes || 0) !== 1) return err('Compte introuvable.', 404, origin);
  return json({ success: true, id: body.id }, 200, origin);
}

// ═══ Santé des connexions : refresh des tokens (Sprint Social-4.3) ══
// Seul Threads a un token à durée limitée (~60 j) avec refresh self-service (FB =
// Page token longue durée non suivi ; Telegram/IG = token système/bot). Lancé par
// le cron QUOTIDIEN (index.js). Rafraîchit les tokens qui expirent dans < 7 j ; si
// le refresh échoue ET que le token est DÉJÀ mort → 'expired' (le front montre un
// badge « reconnecter »). Fail-safe : ne casse jamais le cron.
//
// Options :
//   dryRun  — déchiffre & compte, sans appeler l'API (test à blanc).
//   force   — IGNORE la fenêtre < 7 j : balaie TOUS les Threads connectés. Sert au
//             déclencheur admin « tester le renouvellement maintenant » (preuve que
//             th_refresh_token marche sans attendre l'expiration). ⚠ ré-écrit de
//             vrais tokens (prolonge de +60 j ; sans dommage). Un token sain dont le
//             refresh échoue reste 'connected' (jamais marqué 'expired' à tort).
//   report  — renvoie le détail PAR COMPTE (outcome + before/after) en plus du
//             résumé, pour lecture humaine côté admin.
export async function refreshSocialTokens(env, { dryRun = false, force = false, report = false } = {}) {
  await ensureSocialSchema(env);
  if (!env.KS_ENCRYPTION_KEY) return { skipped: 'no-key' };
  // Cron : seulement les tokens proches de l'échéance. force : tous les connectés.
  const windowClause = force
    ? ''
    : ` AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now','+7 days')`;
  const { results: accts } = await env.DB.prepare(
    `SELECT id, display_name, access_ciphertext, access_iv, expires_at FROM social_accounts
       WHERE platform = 'threads' AND status = 'connected'${windowClause}
       LIMIT 50`
  ).all();

  let refreshed = 0, expired = 0, failed = 0;
  const details = [];
  for (const a of accts) {
    const rec = { id: a.id, account: a.display_name || a.id, before: a.expires_at };
    let token;
    try { token = await decrypt(a.access_ciphertext, a.access_iv, env.KS_ENCRYPTION_KEY); }
    catch (_) { failed++; rec.outcome = 'failed'; rec.error = 'déchiffrement impossible'; details.push(rec); continue; }
    if (dryRun) { refreshed++; rec.outcome = 'dry-run'; details.push(rec); continue; }
    try {
      // Threads : refresh d'un token longue durée (≥ 24 h, non expiré) → +60 j. Pas
      // de client_secret (≠ l'échange initial th_exchange_token).
      const res = await fetch('https://graph.threads.net/refresh_access_token?' + new URLSearchParams({
        grant_type: 'th_refresh_token', access_token: token,
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const enc    = await encrypt(data.access_token, env.KS_ENCRYPTION_KEY);
      const newExp = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
      await env.DB.prepare(
        `UPDATE social_accounts SET access_ciphertext=?, access_iv=?, expires_at=?, status='connected', updated_at=datetime('now') WHERE id=?`
      ).bind(enc.ciphertext, enc.iv, newExp, a.id).run();
      refreshed++;
      rec.outcome = 'refreshed'; rec.after = newExp;
    } catch (e) {
      // Token déjà mort → 'expired' (badge reconnecter). Sinon on retentera demain
      // (évite un faux « expiré » sur un raté réseau passager / endpoint à valider).
      if (a.expires_at && new Date(a.expires_at).getTime() <= Date.now()) {
        await env.DB.prepare(`UPDATE social_accounts SET status='expired', updated_at=datetime('now') WHERE id=?`).bind(a.id).run();
        expired++; rec.outcome = 'expired';
      } else { failed++; rec.outcome = 'failed'; }
      rec.error = e?.message || String(e);
      console.warn('[social-token-refresh] threads', a.id, e?.message || e);
    }
    details.push(rec);
  }
  const summary = { checked: accts.length, refreshed, expired, failed };
  return report ? { ...summary, forced: force, details } : summary;
}

// POST /api/social/tokens/refresh-now — déclencheur ADMIN de validation du refresh.
// Force le renouvellement Threads HORS fenêtre < 7 j (≠ cron) et renvoie le détail par
// compte → on prouve que th_refresh_token fonctionne sans attendre l'échéance réelle.
// ⚠ Portée globale (tous tenants) : c'est un outil de maintenance owner, pas client.
export async function handleSocialTokenRefreshNow(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  const out = await refreshSocialTokens(env, { force: true, report: true });
  return json(out, 200, origin);
}

// GET /api/social/posts?status=…  (file de publication — scopé tenant, sans tokens)
// Renvoie un EXTRAIT du contenu (pas le canonique brut entier) + statut, date de
// programmation et résultats par réseau. Alimente la liste/historique du composer
// (programmés / publiés / échoués / annulés).
export async function handleSocialPostsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);

  const statusFilter = new URL(request.url).searchParams.get('status');
  let sql = `SELECT id, source, canonical, targets, status, scheduled_at, results, created_at, updated_at
             FROM social_posts WHERE tenant_id = ?`;
  const binds = [tenantId];
  if (statusFilter) { sql += ` AND status = ?`; binds.push(statusFilter); }
  sql += ` ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT 100`;

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  const posts = results.map(r => {
    let excerpt = '', mediaCount = 0, targets = [], res = null;
    try { const c = JSON.parse(r.canonical); excerpt = (c.text || '').slice(0, 180); mediaCount = (c.media || []).length; } catch (_) {}
    try { targets = JSON.parse(r.targets); } catch (_) {}
    try { res = r.results ? JSON.parse(r.results) : null; } catch (_) {}
    return {
      id: r.id, source: r.source, status: r.status,
      scheduledAt: r.scheduled_at, createdAt: r.created_at, updatedAt: r.updated_at,
      targets, excerpt, mediaCount, results: res,
    };
  });
  return json({ posts }, 200, origin);
}

// GET /api/social/posts/insights?id=… — perf d'un post publié (analytique, pull à
// la demande). Pour chaque réseau PUBLIÉ (externalId connu), interroge l'API insights
// via le token du compte. Telegram = aveugle → { unsupported } ; scope insights manquant
// côté Meta → { error } (l'UI affiche « indisponible », jamais de crash). Scopé tenant.
export async function handleSocialPostInsights(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('Paramètre "id" requis', 400, origin);

  const { results: rows } = await env.DB.prepare(
    `SELECT id, results FROM social_posts WHERE id = ? AND tenant_id = ? LIMIT 1`
  ).bind(id, tenantId).all();
  const row = rows && rows[0];
  if (!row) return err('Post introuvable.', 404, origin);

  let results = [];
  try { results = JSON.parse(row.results) || []; } catch (_) {}
  const published = results.filter(r => r && r.status === 'published');
  if (!published.length) return json({ id, insights: [] }, 200, origin);

  // Comptes du tenant (platform → row) pour le token chiffré.
  const { results: accts } = await env.DB.prepare(
    `SELECT platform, external_id, access_ciphertext, access_iv FROM social_accounts WHERE tenant_id = ?`
  ).bind(tenantId).all();
  const byPlat = {};
  for (const a of (accts || [])) byPlat[a.platform] = a;

  const insights = [];
  for (const r of published) {
    insights.push(await fetchPostInsights({ platform: r.platform, externalId: r.externalId, account: byPlat[r.platform], env }));
  }
  return json({ id, insights }, 200, origin);
}

// POST /api/social/posts/cancel  Body : { id }
// Annule un post ENCORE programmé (status 'scheduled'→'canceled'). Scopé tenant
// (jamais le post d'autrui) ; le garde WHERE status='scheduled' empêche d'annuler
// un post déjà réclamé par le cron (en cours/publié) → anti-course.
export async function handleSocialPostCancel(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  if (!body.id) return err('Champ "id" requis', 400, origin);

  const r = await env.DB.prepare(
    `UPDATE social_posts SET status='canceled', updated_at=datetime('now')
       WHERE id = ? AND tenant_id = ? AND status = 'scheduled'`
  ).bind(body.id, tenantId).run();
  if ((r.meta?.changes || 0) !== 1) {
    return err('Post introuvable, déjà publié ou en cours — annulation impossible.', 409, origin);
  }
  return json({ success: true, id: body.id, status: 'canceled' }, 200, origin);
}

// POST /api/social/posts/delete  Body : { id } | { all:true }
// Supprime DÉFINITIVEMENT de l'historique (DELETE). Scopé tenant. Ne touche
// JAMAIS un post en attente d'envoi (scheduled/publishing) — pour ceux-là c'est
// « Annuler ». { all:true } = vide tout l'historique terminé du tenant.
export async function handleSocialPostsDelete(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);

  const KEEP = "status NOT IN ('scheduled','publishing','retrying')";   // jamais un post en attente / en cours / en réessai
  let r;
  if (body.all === true) {
    r = await env.DB.prepare(`DELETE FROM social_posts WHERE tenant_id = ? AND ${KEEP}`).bind(tenantId).run();
  } else if (body.id) {
    r = await env.DB.prepare(`DELETE FROM social_posts WHERE id = ? AND tenant_id = ? AND ${KEEP}`).bind(body.id, tenantId).run();
  } else {
    return err('Champ "id" ou "all" requis', 400, origin);
  }
  return json({ success: true, deleted: r.meta?.changes || 0 }, 200, origin);
}

// POST /api/social/posts/retry  Body : { id }
// Renvoie MAINTENANT les réseaux ratés d'un post (échec/partiel/en réessai), sans
// attendre le prochain passage du cron. Scopé tenant. Réutilise publishScheduledRow
// (ne renvoie QUE les réseaux non publiés → jamais de double-post).
export async function handleSocialPostRetry(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  if (!body.id) return err('Champ "id" requis', 400, origin);

  // Réclamation atomique : seul un post terminé en échec/partiel ou en attente de
  // réessai est renvoyable (et pas un déjà réclamé par le cron) → anti-double-envoi.
  const claim = await env.DB.prepare(
    `UPDATE social_posts SET status='publishing', updated_at=datetime('now')
       WHERE id = ? AND tenant_id = ? AND status IN ('failed','partial','retrying')`
  ).bind(body.id, tenantId).run();
  if ((claim.meta?.changes || 0) !== 1) {
    return err('Rien à renvoyer (post introuvable, déjà publié, ou déjà en cours).', 409, origin);
  }
  const row = await env.DB.prepare(`SELECT * FROM social_posts WHERE id = ?`).bind(body.id).first();
  const r = await publishScheduledRow(env, row, { dryRun: false });
  return json({ success: r.status !== 'failed', ...r }, 200, origin);
}
