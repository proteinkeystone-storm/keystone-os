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
import { getPlatform }         from '../lib/social/registry.js';

// ── Gate admin flexible : secret (/admin) OU JWT isAdmin/plan ADMIN (/app) ──
export async function requireAdminFlexible(request, env) {
  if (requireAdmin(request, env)) return true;
  const claims = await requireJWT(request, env);
  return claims?.isAdmin === true || claims?.plan === 'ADMIN';
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
  try {
    const r = await provisionFacebook(env, { pageId: body.pageId, tenantId: body.tenantId });
    return json({ success: true, ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 502, origin);
  }
}

// POST /api/social/publish  Body : { targets:[...], text?, media?, link?, hashtags?, legal?, source?, dryRun? }
export async function handleSocialPublish(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  await ensureSocialSchema(env);
  const body = await parseBody(request);
  try {
    const r = await publishCanonical(env, body);
    return json({ success: r.status !== 'failed', ...r }, 200, origin);
  } catch (e) {
    return err(e.message, 400, origin);
  }
}

// GET /api/social/accounts  (ne renvoie jamais les tokens)
export async function handleSocialAccountsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!(await requireAdminFlexible(request, env))) return err('Non autorisé', 401, origin);
  await ensureSocialSchema(env);
  const url      = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || 'default';
  const { results } = await env.DB.prepare(`
    SELECT id, platform, target_type, external_id, display_name, scopes, status, created_at, updated_at
    FROM social_accounts WHERE tenant_id = ? ORDER BY platform
  `).bind(tenantId).all();
  return json({ accounts: results }, 200, origin);
}
