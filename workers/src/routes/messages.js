/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Messages v1.1
   Messages Admin → Client (DST P1) — CRUD complet
   ─────────────────────────────────────────────────────────────
   GET    /api/messages?tenantId=...&licence=...   Public — liste active
   GET    /api/admin/messages?tenantId=...          Admin  — lister tous
   POST   /api/admin/messages                       Admin  — créer
   PATCH  /api/admin/messages                       Admin  — modifier (body.id)
   DELETE /api/admin/messages                       Admin  — supprimer définitivement (body.id)
   POST   /api/admin/messages/revoke                Admin  — révoquer (soft, conserve l'historique)
   POST   /api/admin/messages/republish             Admin  — republier un message révoqué/expiré
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin, generateId } from '../lib/auth.js';

// ── GET /api/messages ─────────────────────────────────────────
// Public — appelé par le client toutes les 5 min.
// Retourne uniquement les messages actifs (non révoqués, non expirés)
// ciblés sur ce tenant + cette licence (ou 'all').
export async function handleListPublic(request, env) {
    const origin   = getAllowedOrigin(env, request);
    const url      = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId') || 'default';
    const licence  = url.searchParams.get('licence')  || '';

    // Targets autorisées pour ce client : 'all' + 'tenant:<id>' + 'licence:<key>'
    const targets = ['all', `tenant:${tenantId}`];
    if (licence) targets.push(`licence:${licence}`);
    const placeholders = targets.map(() => '?').join(',');

    const { results } = await env.DB
        .prepare(`
            SELECT id, target, title, body, level, cta_label, cta_url, expires_at, created_at
            FROM messages
            WHERE tenant_id = ?
              AND revoked = 0
              AND (expires_at IS NULL OR expires_at > datetime('now'))
              AND target IN (${placeholders})
            ORDER BY created_at DESC
            LIMIT 20
        `)
        .bind(tenantId, ...targets)
        .all();

    return json({ messages: results || [], total: results?.length || 0 }, 200, origin);
}

// ── POST /api/admin/messages ──────────────────────────────────
// Admin — crée un nouveau message.
// Body : { tenantId, target, title?, body, level?, ctaLabel?, ctaUrl?, expiresAt?, createdBy? }
export async function handleCreate(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const b = await parseBody(request);
    if (!b.body || typeof b.body !== 'string' || !b.body.trim()) {
        return err('Champ "body" requis', 400, origin);
    }
    if (b.body.length > 500) {
        return err('Message trop long (max 500 caractères)', 400, origin);
    }
    if (b.ctaLabel && !b.ctaUrl) return err('CTA : "ctaUrl" requis si "ctaLabel" fourni', 400, origin);

    const id        = generateId();
    const tenantId  = b.tenantId || 'default';
    const target    = b.target   || 'all';
    const level     = ['info', 'promo', 'urgent'].includes(b.level) ? b.level : 'info';
    const expiresAt = b.expiresAt || null; // ISO datetime ou null
    const createdBy = (b.createdBy || '').slice(0, 100);

    await env.DB.prepare(`
        INSERT INTO messages (id, tenant_id, target, title, body, level, cta_label, cta_url, expires_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, tenantId, target,
        b.title    || null,
        b.body.trim(),
        level,
        b.ctaLabel || null,
        b.ctaUrl   || null,
        expiresAt,
        createdBy  || null
    ).run();

    return json({ success: true, id }, 200, origin);
}

// ── GET /api/admin/messages ───────────────────────────────────
// Admin — liste tous les messages (actifs + expirés + révoqués) pour le panel.
export async function handleListAdmin(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const url      = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId') || 'default';

    const { results } = await env.DB
        .prepare(`
            SELECT id, tenant_id, target, title, body, level, cta_label, cta_url,
                   expires_at, revoked, created_at, created_by
            FROM messages
            WHERE tenant_id = ?
            ORDER BY created_at DESC
            LIMIT 200
        `)
        .bind(tenantId)
        .all();

    // Calcul du statut : active | expired | revoked
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const messages = (results || []).map(m => {
        let status = 'active';
        if (m.revoked)                              status = 'revoked';
        else if (m.expires_at && m.expires_at < now) status = 'expired';
        return { ...m, status };
    });

    return json({ messages, total: messages.length }, 200, origin);
}

// ── PATCH /api/admin/messages ─────────────────────────────────
// Admin — modifie un message existant. Tous les champs sont optionnels
// sauf "id". Seuls les champs fournis sont mis à jour.
export async function handleUpdate(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const b = await parseBody(request);
    if (!b.id) return err('Champ "id" requis', 400, origin);

    if (b.body !== undefined) {
        if (typeof b.body !== 'string' || !b.body.trim()) {
            return err('Champ "body" invalide', 400, origin);
        }
        if (b.body.length > 500) return err('Message trop long (max 500 caractères)', 400, origin);
    }
    if (b.ctaLabel && !b.ctaUrl) return err('CTA : "ctaUrl" requis si "ctaLabel" fourni', 400, origin);

    const updates = [];
    const values  = [];

    if (b.target   !== undefined) { updates.push('target = ?');     values.push(b.target); }
    if (b.title    !== undefined) { updates.push('title = ?');      values.push(b.title    || null); }
    if (b.body     !== undefined) { updates.push('body = ?');       values.push(b.body.trim()); }
    if (b.level    !== undefined && ['info', 'promo', 'urgent'].includes(b.level)) {
                                    updates.push('level = ?');      values.push(b.level); }
    if (b.ctaLabel !== undefined) { updates.push('cta_label = ?');  values.push(b.ctaLabel || null); }
    if (b.ctaUrl   !== undefined) { updates.push('cta_url = ?');    values.push(b.ctaUrl   || null); }
    if (b.expiresAt!== undefined) { updates.push('expires_at = ?'); values.push(b.expiresAt|| null); }

    if (updates.length === 0) return err('Aucun champ à modifier', 400, origin);

    values.push(b.id);
    const result = await env.DB
        .prepare(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();

    if (!result.meta.changes) return err('Message introuvable', 404, origin);
    return json({ success: true, id: b.id }, 200, origin);
}

// ── DELETE /api/admin/messages ────────────────────────────────
// Admin — suppression DÉFINITIVE en base (hard delete).
export async function handleDelete(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const { id } = await parseBody(request);
    if (!id) return err('Champ "id" requis', 400, origin);

    const result = await env.DB
        .prepare('DELETE FROM messages WHERE id = ?')
        .bind(id)
        .run();

    if (!result.meta.changes) return err('Message introuvable', 404, origin);
    return json({ success: true, id, deleted: true }, 200, origin);
}

// ── POST /api/admin/messages/revoke ───────────────────────────
// Admin — soft delete : marque le message comme révoqué (status=revoked).
// Le message reste en base et peut être republié.
export async function handleRevoke(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const { id } = await parseBody(request);
    if (!id) return err('Champ "id" requis', 400, origin);

    const result = await env.DB
        .prepare('UPDATE messages SET revoked = 1 WHERE id = ?')
        .bind(id)
        .run();

    if (!result.meta.changes) return err('Message introuvable', 404, origin);
    return json({ success: true, id, revoked: true }, 200, origin);
}

// ── POST /api/admin/messages/republish ────────────────────────
// Admin — remet un message révoqué/expiré en service.
// Body : { id, expiresAt? }  expiresAt accepté (sinon clear → permanent).
export async function handleRepublish(request, env) {
    const origin = getAllowedOrigin(env, request);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const { id, expiresAt } = await parseBody(request);
    if (!id) return err('Champ "id" requis', 400, origin);

    // Republier = revoked=0 + nouvelle expiration (ou null = permanent)
    const newExpires = expiresAt || null;
    const result = await env.DB
        .prepare('UPDATE messages SET revoked = 0, expires_at = ? WHERE id = ?')
        .bind(newExpires, id)
        .run();

    if (!result.meta.changes) return err('Message introuvable', 404, origin);
    return json({ success: true, id, republished: true }, 200, origin);
}
