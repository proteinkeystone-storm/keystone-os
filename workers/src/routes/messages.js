/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes Messages v1.0
   Messages Admin → Client (DST P1)
   ─────────────────────────────────────────────────────────────
   GET    /api/messages?tenantId=...&licence=...   Public — liste active
   POST   /api/admin/messages                       Admin  — créer
   GET    /api/admin/messages?tenantId=...          Admin  — lister tous
   DELETE /api/admin/messages                       Admin  — révoquer (body.id)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin, generateId } from '../lib/auth.js';

// ── GET /api/messages ─────────────────────────────────────────
// Public — appelé par le client toutes les 5 min.
// Retourne uniquement les messages actifs (non révoqués, non expirés)
// ciblés sur ce tenant + cette licence (ou 'all').
export async function handleListPublic(request, env) {
    const origin   = getAllowedOrigin(env);
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
    const origin = getAllowedOrigin(env);
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
    const origin = getAllowedOrigin(env);
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

// ── DELETE /api/admin/messages ────────────────────────────────
// Admin — révoque un message (soft delete, preserve l'historique).
// Body : { id }
export async function handleRevoke(request, env) {
    const origin = getAllowedOrigin(env);
    if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);

    const { id } = await parseBody(request);
    if (!id) return err('Champ "id" requis', 400, origin);

    const result = await env.DB
        .prepare('UPDATE messages SET revoked = 1 WHERE id = ?')
        .bind(id)
        .run();

    if (!result.meta.changes) return err('Message introuvable', 404, origin);
    return json({ success: true, id }, 200, origin);
}
