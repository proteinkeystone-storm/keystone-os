/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes SDQR · Sovereign Dynamic QR (Sprint 1)

   Routes :
     GET  /r/:shortId       Public — redirige + log scan (RGPD safe)
     POST /api/qr           Tenant — crée un QR dynamique
     GET  /api/qr           Tenant — liste les QRs du tenant
     PATCH /api/qr/:id      Tenant — modifie cible / status / nom / tags
     DELETE /api/qr/:id     Tenant — suppression definitive (cascade)

   RGPD : aucune IP brute stockée. country via cf.country, device_kind
   et os_kind dérivés du User-Agent, ua_hash = sha-256(UA) tronqué.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';

// ── Helpers ────────────────────────────────────────────────────

// nanoid simplifié — 8 chars alphabet URL-safe = 218 trillion combos.
function shortId(len = 8) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// SHA-256(value) tronqué (Web Crypto API dispo sur Workers).
async function sha256Hex(value, truncate = 8) {
  const buf  = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex  = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, truncate);
}

// Parse minimal du User-Agent. Pas de lib externe (poids), regex maison.
function parseUA(ua = '') {
  const s = String(ua).toLowerCase();
  let device = 'other';
  if (/ipad|tablet/i.test(s))                  device = 'tablet';
  else if (/mobile|iphone|android.*mobile/i.test(s)) device = 'mobile';
  else if (s)                                   device = 'desktop';

  let os = 'other';
  if (/iphone|ipad|ipod|ios/i.test(s))     os = 'ios';
  else if (/android/i.test(s))              os = 'android';
  else if (/windows/i.test(s))              os = 'windows';
  else if (/mac\s*os|macintosh/i.test(s))   os = 'macos';
  else if (/linux/i.test(s))                os = 'linux';

  return { device, os };
}

// Validation simple URL (Worker n'a pas le navigateur URL global mais bien `new URL`).
function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// Pour l'instant l'auth tenant = header X-Tenant-Id (pas de JWT pour
// l'artefact). À renforcer quand on aura un système de devices ou JWT.
function getTenantId(request) {
  return (request.headers.get('X-Tenant-Id') || 'default').trim();
}

// ══════════════════════════════════════════════════════════════════
// GET /r/:shortId — redirection publique + log scan (cœur SDQR)
// ══════════════════════════════════════════════════════════════════
export async function handleQrRedirect(request, env, shortId) {
  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return new Response('Not Found', { status: 404 });
  }

  // Lookup ultra-rapide via PRIMARY KEY (qr_redirects.short_id)
  const row = await env.DB
    .prepare('SELECT target_url, status FROM qr_redirects WHERE short_id = ?')
    .bind(shortId)
    .first();

  if (!row || row.status !== 'active') {
    // QR inconnu ou archivé → 404 (on log quand même pas, c'est public)
    return new Response('QR introuvable ou archivé', { status: 404 });
  }

  // Log scan — non bloquant : on lance le INSERT sans attendre.
  // Si l'INSERT échoue, le user est quand même redirigé.
  const ua      = request.headers.get('User-Agent') || '';
  const country = request.cf?.country || null;
  const { device, os } = parseUA(ua);
  const uaHash  = await sha256Hex(ua, 8);

  // ctx.waitUntil n'est pas dispo si appelé hors handler — on tente la
  // promesse, on ignore les erreurs côté redirection.
  try {
    await env.DB
      .prepare(`INSERT INTO qr_scans (short_id, country, device_kind, os_kind, ua_hash)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(shortId, country, device, os, uaHash)
      .run();
  } catch (e) {
    console.warn('[qr-redirect] scan log failed:', e.message);
  }

  return Response.redirect(row.target_url, 302);
}

// ══════════════════════════════════════════════════════════════════
// POST /api/qr — créer un QR dynamique
// ══════════════════════════════════════════════════════════════════
export async function handleCreateQr(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);
  const body     = await parseBody(request);

  const name       = (body.name || '').toString().trim();
  const target_url = (body.target_url || '').toString().trim();
  const type       = (body.type || 'url').toString();   // url | text | vcard | wifi | ical (Sprint 2)
  const payload    = body.payload || {};                // payload typé (Sprint 2)
  const design     = body.design  || {};                // SVG design (Sprint 3)
  const tags       = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];

  if (!name) return err('Le nom est obligatoire', 400, origin);
  if (!isValidUrl(target_url)) return err('target_url invalide (http/https requis)', 400, origin);

  // Génère un short_id unique (rare collision → on retry max 3 fois)
  let short = '';
  for (let i = 0; i < 3; i++) {
    const candidate = shortId(8);
    const exists = await env.DB
      .prepare('SELECT 1 FROM qr_redirects WHERE short_id = ?')
      .bind(candidate).first();
    if (!exists) { short = candidate; break; }
  }
  if (!short) return err('Impossible de générer un identifiant unique', 500, origin);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const entityData = {
    id, tenant_id: tenantId, type: 'qr_codes',
    name, qr_type: type, payload, design, tags,
    short_id: short, status: 'active', created_at: now, updated_at: now,
  };

  // Double écriture transactionnelle simulée (D1 n'a pas de transaction
  // multi-statement actuellement) : on tente d'abord la table redirects
  // (la critique), puis l'entité (data fabric).
  try {
    await env.DB
      .prepare(`INSERT INTO qr_redirects (short_id, qr_id, tenant_id, target_url, status)
                VALUES (?, ?, ?, ?, 'active')`)
      .bind(short, id, tenantId, target_url)
      .run();

    await env.DB
      .prepare(`INSERT INTO entities (id, tenant_id, type, data) VALUES (?, ?, 'qr_codes', ?)`)
      .bind(id, tenantId, JSON.stringify(entityData))
      .run();

    return json({ qr: { ...entityData, target_url } }, 201, origin);
  } catch (e) {
    // Rollback best-effort de qr_redirects si entities échoue
    await env.DB.prepare('DELETE FROM qr_redirects WHERE short_id = ?').bind(short).run().catch(() => {});
    return err('Création échouée : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/qr — liste les QRs du tenant (avec stats sommaires)
// ══════════════════════════════════════════════════════════════════
export async function handleListQr(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);

  // QRs = entités type='qr_codes' du tenant (non supprimées)
  const { results: qrRows } = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND deleted_at IS NULL
              ORDER BY updated_at DESC`)
    .bind(tenantId)
    .all();

  const qrs = (qrRows || []).map(r => {
    try { return JSON.parse(r.data); } catch { return null; }
  }).filter(Boolean);

  if (qrs.length === 0) return json({ qrs: [] }, 200, origin);

  // Ajout des compteurs de scans + target_url courante (depuis qr_redirects)
  const shortIds = qrs.map(q => q.short_id).filter(Boolean);
  const placeholders = shortIds.map(() => '?').join(',');

  let scansMap = new Map();
  let targetsMap = new Map();
  if (shortIds.length) {
    const scans = await env.DB
      .prepare(`SELECT short_id, COUNT(*) AS total FROM qr_scans
                WHERE short_id IN (${placeholders}) GROUP BY short_id`)
      .bind(...shortIds).all();
    scans.results?.forEach(r => scansMap.set(r.short_id, r.total));

    const targets = await env.DB
      .prepare(`SELECT short_id, target_url FROM qr_redirects WHERE short_id IN (${placeholders})`)
      .bind(...shortIds).all();
    targets.results?.forEach(r => targetsMap.set(r.short_id, r.target_url));
  }

  const enriched = qrs.map(q => ({
    ...q,
    target_url   : targetsMap.get(q.short_id) || null,
    scans_total  : scansMap.get(q.short_id) || 0,
  }));

  return json({ qrs: enriched }, 200, origin);
}

// ══════════════════════════════════════════════════════════════════
// PATCH /api/qr/:id — modifie cible / nom / tags / status
// ══════════════════════════════════════════════════════════════════
export async function handleUpdateQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);
  const body     = await parseBody(request);

  // Charge l'entité existante
  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // Mise à jour des champs autorisés
  let targetChanged = false;
  if (body.name !== undefined)    entity.name   = String(body.name).trim() || entity.name;
  if (body.tags !== undefined)    entity.tags   = Array.isArray(body.tags) ? body.tags.slice(0, 12) : entity.tags;
  if (body.design !== undefined)  entity.design = body.design;
  if (body.payload !== undefined) entity.payload = body.payload;
  if (body.status !== undefined && ['active', 'archived'].includes(body.status)) {
    entity.status = body.status;
  }
  if (body.target_url !== undefined) {
    if (!isValidUrl(body.target_url)) return err('target_url invalide', 400, origin);
    targetChanged = true;
  }
  entity.updated_at = new Date().toISOString();

  try {
    await env.DB
      .prepare(`UPDATE entities SET data = ?, updated_at = datetime('now')
                WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?`)
      .bind(JSON.stringify(entity), tenantId, qrId).run();

    if (targetChanged) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET target_url = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(body.target_url, entity.short_id).run();
    }
    if (body.status !== undefined) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET status = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(entity.status, entity.short_id).run();
    }

    return json({ qr: { ...entity, target_url: body.target_url || null } }, 200, origin);
  } catch (e) {
    return err('Mise à jour échouée : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/qr/:id — suppression définitive (cascade)
// Pré-requis : le QR doit etre en status='archived' (double securite
// contre suppression accidentelle d un QR encore imprime/diffuse).
// Cascade : entities soft-delete + qr_redirects hard-delete +
// qr_scans conserves (audit historique, purge via cron policy a part).
// ══════════════════════════════════════════════════════════════════
export async function handleDeleteQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);

  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // Double securite : on n autorise la suppression definitive QUE pour
  // les QR deja archives. Force un archivage explicite d abord.
  if (entity.status !== 'archived') {
    return err('Archivez le QR avant de le supprimer définitivement.', 409, origin);
  }

  try {
    // 1. Soft-delete entity (preserve l audit / data fabric history)
    await env.DB
      .prepare(`UPDATE entities SET deleted_at = datetime('now'), updated_at = datetime('now')
                WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?`)
      .bind(tenantId, qrId).run();

    // 2. Hard-delete redirect (libere le short_id, plus de redirection possible)
    await env.DB
      .prepare(`DELETE FROM qr_redirects WHERE short_id = ?`)
      .bind(entity.short_id).run();

    // 3. qr_scans conservés intentionnellement (audit/stats historiques).
    //    Une purge auto sera ajoutee en SDQR-5 (retention policy par tenant).

    return json({ deleted: true, id: qrId }, 200, origin);
  } catch (e) {
    return err('Suppression échouée : ' + e.message, 500, origin);
  }
}
