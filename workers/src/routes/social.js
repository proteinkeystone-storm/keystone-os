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
import { encrypt }             from '../lib/crypto.js';
import { ensureSocialSchema }  from '../lib/social/schema.js';
import { broadcast }           from '../lib/social/broadcast.js';
import { createCanonicalPost } from '../lib/social/canonical.js';
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
export async function socialTenantOf(request, env) {
  if (requireAdmin(request, env)) return 'default';
  const claims = await requireJWT(request, env);
  if (!claims) return null;
  if (claims.isAdmin === true || claims.plan === 'ADMIN') return 'default';
  return claims.sub || null;
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
 * Diffuse un post via le moteur : charge les comptes connectés depuis
 * social_accounts, appelle broadcast(), persiste dans social_posts.
 * @returns {Promise<{postId,status,results}>}
 */
export async function publishCanonical(env, opts = {}) {
  const tenantId = opts.tenantId || 'default';
  const dryRun   = !!opts.dryRun;
  const targets  = Array.isArray(opts.targets) ? opts.targets.filter(Boolean) : [];
  if (!targets.length) throw new Error('Champ "targets" requis (ex : ["facebook"])');

  const canonical = createCanonicalPost({
    text: opts.text, media: opts.media, link: opts.link,
    hashtags: opts.hashtags, firstComment: opts.firstComment, legal: opts.legal, meta: opts.meta,
  });

  const placeholders = targets.map(() => '?').join(',');
  const { results: rows } = await env.DB
    .prepare(`SELECT * FROM social_accounts WHERE tenant_id = ? AND status = 'connected' AND platform IN (${placeholders})`)
    .bind(tenantId, ...targets).all();
  const accounts = {};
  for (const r of rows) accounts[r.platform] = r;   // broadcast() déchiffre lui-même

  const results = await broadcast({ canonical, targets, accounts, env, dryRun });
  const status  = computeStatus(results, dryRun);

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO social_posts (id, tenant_id, source, canonical, targets, status, results)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, tenantId, opts.source || 'manual',
    JSON.stringify(canonical), JSON.stringify(targets), status, JSON.stringify(results),
  ).run();

  return { postId: id, status, results };
}

function computeStatus(results, dryRun) {
  if (dryRun) return 'draft';
  const published = results.filter(r => r.status === 'published').length;
  const failed    = results.filter(r => r.status === 'failed').length;
  if (published && failed) return 'partial';
  if (published)           return 'published';
  return 'failed';
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

// POST /api/social/publish  Body : { targets:[...], text?, media?, link?, hashtags?, legal?, source?, dryRun? }
export async function handleSocialPublish(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await socialEntitled(request, env))) return err('Accès Social Manager non autorisé', 403, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  const tenantId = await socialTenantOf(request, env);
  if (!tenantId) return err('Authentification requise', 401, origin);
  try {
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
    SELECT id, platform, target_type, external_id, display_name, scopes, status, created_at, updated_at
    FROM social_accounts WHERE tenant_id = ? ORDER BY platform
  `).bind(tenantId).all();
  return json({ accounts: results }, 200, origin);
}
