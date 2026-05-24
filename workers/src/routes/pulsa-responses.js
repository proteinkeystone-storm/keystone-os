/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pulsa Responses (collecte + notif mail)
   Sprint Pulsa-3.3

   Route PUBLIQUE (pas d'auth) appelée par form.html quand le
   répondant soumet ses réponses. Pipeline :

     1. Résolution du formulaire par slug (status='published')
     2. Validation basique du payload `responses`
     3. INSERT D1 dans pulsa_responses avec expires_at = now + ttl_days
     4. Envoi mail Resend aux destinataires direction du formulaire
        (best-effort : si Resend échoue, la réponse reste stockée)
     5. Retour { ok: true, response_id } au client

   Stratégie économe : pas de stockage de PII répondant (IP, UA,
   cookies). La donnée serveur est purgée automatiquement au bout
   de form.ttl_days via le cron quotidien.

   Route :
     POST /api/pulsa/responses/:slug
   ═══════════════════════════════════════════════════════════════ */

import {
  json, err, parseBody, getAllowedOrigin, generateId,
  requireDevice, requireAdmin,
} from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { sendEmail } from '../lib/email-resend.js';

// ── Auth resolver (mêmes 3 tiers que pulsa-forms) ─────────────
async function _resolveOwner(request, env) {
  if (requireAdmin(request, env)) {
    return { sub: 'admin', tenant: 'default', isAdmin: true };
  }
  const claims = await requireJWT(request, env);
  if (claims?.sub) {
    // Hotfix 2026-05-24 : honorer claims.isAdmin du JWT (sinon admin
    // loggé en landing/magic-link reçoit 403 Forbidden quand il consulte
    // les réponses d'un form créé via /admin — cf. cas Biennale 24/05).
    return { sub: claims.sub, tenant: claims.sub, isAdmin: !!claims.isAdmin };
  }
  const device = await requireDevice(request, env);
  if (device?.tenant_id) {
    return { sub: 'device:' + device.id, tenant: device.tenant_id, isAdmin: false };
  }
  return null;
}

// ── Vérifie que l'owner a le droit d'accéder à un formulaire ──
async function _assertOwnsForm(env, formId, owner) {
  const form = await env.DB.prepare(
    'SELECT id, owner_sub FROM pulsa_forms WHERE id = ?'
  ).bind(formId).first();
  if (!form) return { ok: false, status: 404, msg: 'Formulaire introuvable' };
  if (!owner.isAdmin && form.owner_sub !== owner.sub) {
    return { ok: false, status: 403, msg: 'Accès refusé' };
  }
  return { ok: true, form };
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS pulsa_responses (
      id            TEXT PRIMARY KEY,
      form_id       TEXT NOT NULL,
      slug          TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at    TEXT NOT NULL
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_responses_form ON pulsa_responses(form_id, created_at DESC)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_pulsa_responses_expires ON pulsa_responses(expires_at)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/pulsa/responses/:slug
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaSubmit(request, env, slug) {
  const origin = getAllowedOrigin(env, request);

  if (!slug || !SLUG_RE.test(slug)) {
    return err('Slug invalide', 400, origin);
  }
  await _ensureSchema(env);

  // 1. Résolution du formulaire publié
  const formRow = await env.DB.prepare(
    'SELECT * FROM pulsa_forms WHERE slug = ? AND status = ? LIMIT 1'
  ).bind(slug, 'published').first();
  if (!formRow) return err('Formulaire introuvable ou non publié', 404, origin);

  let config = {};
  try { config = JSON.parse(formRow.config_json || '{}'); } catch {}
  let recipients = [];
  try { recipients = JSON.parse(formRow.recipients_json || '[]'); } catch {}
  const ttlDays = formRow.ttl_days || 90;

  // Vérification du code d'accès si le formulaire est protégé.
  // Le code arrive en query param (?code=XXXX) — même flow que GET public.
  const expectedCode = config.meta?.access_code?.trim();
  if (expectedCode) {
    const url = new URL(request.url);
    const providedCode = url.searchParams.get('code')?.trim() || '';
    if (providedCode !== expectedCode) {
      return err('Code d\'accès incorrect', 401, origin);
    }
  }

  // 2. Validation du payload
  const body = await parseBody(request);
  const responses = body?.responses;
  if (!responses || typeof responses !== 'object') {
    return err('Champ "responses" requis (objet fieldId → valeur)', 400, origin);
  }

  // 3. INSERT D1 (le response_json est l'objet brut, le rendu humain
  // est fait par le mail template — pas besoin de doubler le stockage)
  const responseId = generateId();
  const expiresAt = _isoDaysFromNow(ttlDays);
  await env.DB.prepare(`
    INSERT INTO pulsa_responses (id, form_id, slug, response_json, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(responseId, formRow.id, slug, JSON.stringify(responses), expiresAt).run();

  // 4. Envoi mail (best-effort)
  let mailStatus = 'skipped';
  if (recipients.length > 0 && env.KS_RESEND_KEY) {
    try {
      const subject = `Nouvelle réponse — ${formRow.title || 'Pulsa'}`;
      const html = _renderResponseEmail({
        form: { ...config, slug, ttl_days: ttlDays },
        responses,
        responseId,
        receivedAt: new Date(),
      });
      await sendEmail(env, { to: recipients, subject, html });
      mailStatus = 'sent';
    } catch (e) {
      console.warn('[pulsa-responses] mail send failed', e?.message || e);
      mailStatus = 'failed';
    }
  }

  return json({
    ok: true,
    response_id: responseId,
    mail: mailStatus,
    expires_at: expiresAt,
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/responses?form_id=X   — liste owner
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaResponsesList(request, env, url) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const formId = url.searchParams.get('form_id');
  if (!formId) return err('Paramètre form_id requis', 400, origin);

  const ownership = await _assertOwnsForm(env, formId, owner);
  if (!ownership.ok) return err(ownership.msg, ownership.status, origin);

  const { results = [] } = await env.DB.prepare(`
    SELECT id, form_id, slug, response_json, created_at, expires_at
    FROM pulsa_responses
    WHERE form_id = ?
    ORDER BY created_at DESC
    LIMIT 500
  `).bind(formId).all();

  const responses = results.map(r => ({
    id: r.id,
    form_id: r.form_id,
    slug: r.slug,
    responses: _safeJson(r.response_json),
    created_at: r.created_at,
    expires_at: r.expires_at,
  }));

  return json({ ok: true, responses, count: responses.length }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/responses-by-slug/:slug   — liste owner par slug
//
// Variante de handlePulsaResponsesList : résout le form_id depuis le
// slug (lookup pulsa_forms) puis renvoie le même payload. Permet aux
// consommateurs externes (proxies Pages Functions) de référencer un
// formulaire par son slug stable plutôt que par son UUID opaque.
// Auth + ownership : identique à la route principale.
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaResponsesListBySlug(request, env, slug) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  if (!slug || !SLUG_RE.test(slug)) {
    return err('Slug invalide', 400, origin);
  }

  await _ensureSchema(env);

  const formRow = await env.DB.prepare(
    'SELECT id, owner_sub FROM pulsa_forms WHERE slug = ? LIMIT 1'
  ).bind(slug).first();
  if (!formRow) return err('Formulaire introuvable', 404, origin);

  if (!owner.isAdmin && formRow.owner_sub !== owner.sub) {
    return err('Accès refusé', 403, origin);
  }

  const { results = [] } = await env.DB.prepare(`
    SELECT id, form_id, slug, response_json, created_at, expires_at
    FROM pulsa_responses
    WHERE form_id = ?
    ORDER BY created_at DESC
    LIMIT 500
  `).bind(formRow.id).all();

  const responses = results.map(r => ({
    id: r.id,
    form_id: r.form_id,
    slug: r.slug,
    responses: _safeJson(r.response_json),
    created_at: r.created_at,
    expires_at: r.expires_at,
  }));

  return json({ ok: true, responses, count: responses.length, form_id: formRow.id }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/responses/:id   — détail (auth + owner)
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaResponseGet(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const row = await env.DB.prepare(
    'SELECT * FROM pulsa_responses WHERE id = ?'
  ).bind(id).first();
  if (!row) return err('Réponse introuvable', 404, origin);

  const ownership = await _assertOwnsForm(env, row.form_id, owner);
  if (!ownership.ok) return err(ownership.msg, ownership.status, origin);

  return json({
    ok: true,
    response: {
      id: row.id,
      form_id: row.form_id,
      slug: row.slug,
      responses: _safeJson(row.response_json),
      created_at: row.created_at,
      expires_at: row.expires_at,
    },
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pulsa/responses.csv?form_id=X   — export CSV
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaResponsesCsv(request, env, url) {
  const origin = getAllowedOrigin(env, request);
  const owner = await _resolveOwner(request, env);
  if (!owner) return err('Authentification requise', 401, origin);

  await _ensureSchema(env);

  const formId = url.searchParams.get('form_id');
  if (!formId) return err('Paramètre form_id requis', 400, origin);

  const ownership = await _assertOwnsForm(env, formId, owner);
  if (!ownership.ok) return err(ownership.msg, ownership.status, origin);

  const formConfig = _safeJson(ownership.form?.config_json) || {};
  // On récupère la config complète pour formater les valeurs (chips → label, etc.)
  const fullForm = await env.DB.prepare(
    'SELECT config_json FROM pulsa_forms WHERE id = ?'
  ).bind(formId).first();
  const cfg = _safeJson(fullForm?.config_json) || {};

  const { results = [] } = await env.DB.prepare(`
    SELECT id, response_json, created_at
    FROM pulsa_responses
    WHERE form_id = ?
    ORDER BY created_at ASC
  `).bind(formId).all();

  // Calcule l'ordre des colonnes depuis la config (parcours sections → fields)
  const fields = [];
  for (const sec of (cfg.sections || [])) {
    for (const f of (sec.fields || [])) {
      fields.push({ id: f.id, label: f.label || f.id, type: f.type, options: f.options || {} });
    }
  }

  const headers = ['Date', 'ID réponse', ...fields.map(f => f.label)];
  const rows = [headers.map(_csvEscape).join(',')];

  for (const r of results) {
    const values = _safeJson(r.response_json) || {};
    const line = [
      r.created_at,
      r.id,
      ...fields.map(f => _csvFormatValue(f, values[f.id])),
    ];
    rows.push(line.map(_csvEscape).join(','));
  }

  const csv = '﻿' + rows.join('\n'); // BOM pour Excel UTF-8
  const filename = `pulsa-${formId}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': origin,
      'Cache-Control': 'no-store',
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// PATCH /api/pulsa/responses/:id   — édition partielle admin
//
// Mise à jour ciblée et fortement whitelistée d'une réponse Pulsa.
// Cas d'usage : Trait d'union — l'admin biennale édite bio/démarche et
// uploade des images d'œuvres depuis /admin?token=…&tab=artists.
//
// Body attendu : { fields: { ... } } où fields ne peut contenir QUE :
//   - fld_bio_courte    : string                         → remplacement simple
//   - fld_bio_longue    : string                         → remplacement simple
//   - fld_oeuvres       : { __op: 'set_image',
//                           index: number,
//                           oeuvre_slug?: string,
//                           image_url: string }          → patch ciblé sur 1 œuvre
//
// Sécurité — TOUS les autres champs sont rejetés (400). Aucun upsert
// d'op libre, aucun remplacement complet de fld_oeuvres (qui contient
// les autres métadonnées titre/année/etc. saisies via le form public).
//
// Auth : requireAdmin uniquement (pas de JWT/device — c'est une opération
// hors flux owner classique). On audit côté console (suffisant pour la
// biennale ; si besoin d'audit durable, ajouter table _admin_logs).
// ═══════════════════════════════════════════════════════════════
const ALLOWED_PATCH_FIELDS = new Set(['fld_bio_courte', 'fld_bio_longue', 'fld_oeuvres']);
const MAX_TEXT_LEN = 8_000;

export async function handlePulsaResponsePatch(request, env, id) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) {
    return err('Non autorisé', 401, origin);
  }

  await _ensureSchema(env);

  const row = await env.DB.prepare(
    'SELECT id, form_id, slug, response_json FROM pulsa_responses WHERE id = ?'
  ).bind(id).first();
  if (!row) return err('Réponse introuvable', 404, origin);

  const body = await parseBody(request);
  const fields = body?.fields;
  if (!fields || typeof fields !== 'object') {
    return err('Champ "fields" requis (objet partiel)', 400, origin);
  }

  // Whitelist stricte : on REJETTE toute clé non autorisée (vs ignorance
  // silencieuse) pour faire remonter les bugs côté appelant.
  for (const k of Object.keys(fields)) {
    if (!ALLOWED_PATCH_FIELDS.has(k)) {
      return err(`Champ non autorisé en PATCH : ${k}`, 400, origin);
    }
  }

  let current;
  try {
    current = JSON.parse(row.response_json || '{}');
  } catch {
    current = {};
  }
  if (!current || typeof current !== 'object') current = {};

  const updated = { ...current };

  // ── Textes : remplacement simple, longueur bornée ────────────
  if ('fld_bio_courte' in fields) {
    if (typeof fields.fld_bio_courte !== 'string') {
      return err('fld_bio_courte doit être une string', 400, origin);
    }
    updated.fld_bio_courte = fields.fld_bio_courte.slice(0, MAX_TEXT_LEN);
  }
  if ('fld_bio_longue' in fields) {
    if (typeof fields.fld_bio_longue !== 'string') {
      return err('fld_bio_longue doit être une string', 400, origin);
    }
    updated.fld_bio_longue = fields.fld_bio_longue.slice(0, MAX_TEXT_LEN);
  }

  // ── fld_oeuvres : op `set_image` uniquement ──────────────────
  if ('fld_oeuvres' in fields) {
    const op = fields.fld_oeuvres;
    if (!op || typeof op !== 'object' || op.__op !== 'set_image') {
      return err('fld_oeuvres : seule l\'op { __op: "set_image" } est autorisée', 400, origin);
    }
    const idx = Number(op.index);
    const imageUrl = typeof op.image_url === 'string' ? op.image_url : '';
    const oeuvreSlug = typeof op.oeuvre_slug === 'string' ? op.oeuvre_slug : '';
    if (!Number.isFinite(idx) || idx < 0) {
      return err('set_image : index doit être un entier ≥ 0', 400, origin);
    }
    if (!imageUrl || imageUrl.length > 2048) {
      return err('set_image : image_url requise (max 2048 chars)', 400, origin);
    }
    // Validation URL minimale — on accepte uniquement HTTPS pour la fiche publique.
    if (!/^https:\/\//i.test(imageUrl)) {
      return err('set_image : image_url doit être en HTTPS', 400, origin);
    }
    const oeuvres = Array.isArray(updated.fld_oeuvres) ? updated.fld_oeuvres.slice() : [];
    if (idx >= oeuvres.length) {
      return err(`set_image : index ${idx} hors borne (${oeuvres.length} œuvres)`, 400, origin);
    }
    // Vérification de cohérence du slug si fourni — protège contre un upload
    // mal référencé après réordonnancement côté Pulsa. Heuristique : on compare
    // au titre slugifié.
    if (oeuvreSlug) {
      const expected = _slugifyTitle((oeuvres[idx] || {}).titre || '');
      if (expected && expected !== oeuvreSlug && !oeuvreSlug.startsWith(expected)) {
        // On log mais on ne bloque pas — la disambiguation slug-2/slug-3 fait
        // que ça peut diverger légitimement (cf. /api/artists côté Pages).
        console.warn('[pulsa-patch] slug mismatch', { id, idx, expected, got: oeuvreSlug });
      }
    }
    const target = (oeuvres[idx] && typeof oeuvres[idx] === 'object') ? { ...oeuvres[idx] } : {};
    target.image_url = imageUrl;
    oeuvres[idx] = target;
    updated.fld_oeuvres = oeuvres;
  }

  // ── Persistance D1 ────────────────────────────────────────────
  await env.DB.prepare(
    'UPDATE pulsa_responses SET response_json = ? WHERE id = ?'
  ).bind(JSON.stringify(updated), id).run();

  // Audit minimal — visible via `wrangler tail`. Pas de PII côté requête
  // (on log le rowId et les clés touchées, pas le contenu).
  console.log('[pulsa-patch]', JSON.stringify({
    rowId: id,
    fields: Object.keys(fields),
    at: new Date().toISOString(),
    ua: (request.headers.get('user-agent') || '').slice(0, 80),
  }));

  return json({
    ok: true,
    row: {
      id: row.id,
      form_id: row.form_id,
      slug: row.slug,
      responses: updated,
    },
  }, 200, origin);
}

function _slugifyTitle(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ═══════════════════════════════════════════════════════════════
// Purge TTL (appelée par le cron quotidien)
// ═══════════════════════════════════════════════════════════════
export async function handlePulsaPurge(env) {
  await _ensureSchema(env);
  const res = await env.DB.prepare(
    `DELETE FROM pulsa_responses WHERE expires_at < datetime('now')`
  ).run();
  return { deleted: res?.meta?.changes ?? 0 };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function _isoDaysFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function _safeJson(s) {
  try { return JSON.parse(s || 'null'); } catch { return null; }
}

// ── CSV helpers ─────────────────────────────────────────────
function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

function _csvFormatValue(field, raw) {
  if (raw == null || raw === '') return '';
  const opts = field.options || {};
  switch (field.type) {
    case 'chips': {
      const c = (opts.choices || []).find(c => c.id === raw);
      return c?.label || raw;
    }
    case 'cards': {
      const ids = Array.isArray(raw) ? raw : [];
      return ids.map(id => {
        const c = (opts.choices || []).find(c => c.id === id);
        return c?.label || id;
      }).join(' | ');
    }
    case 'yes-no':
      if (raw === 'yes') return opts.yes_label || 'Oui';
      if (raw === 'no')  return opts.no_label || 'Non';
      return raw;
    case 'rank-top3': {
      const arr = Array.isArray(raw) ? raw : [];
      return arr.filter(Boolean).map((v, i) => `${i + 1}. ${v}`).join(' | ');
    }
    case 'social-links': {
      const networks = (opts.networks || []).filter(n => n.enabled);
      const obj = (raw && typeof raw === 'object') ? raw : {};
      return networks
        .map(n => obj[n.id] ? `${n.label}: ${obj[n.id]}` : null)
        .filter(Boolean)
        .join(' | ');
    }
    case 'amount': {
      const cur = opts.currency || 'EUR';
      return `${raw} ${cur}`;
    }
    case 'signature':
      // Signature en data URI : valeur trop volumineuse pour le CSV
      return raw ? '[signature]' : '';
    case 'nps': {
      const n = Number(raw);
      if (isNaN(n)) return String(raw);
      const tier = n <= 6 ? 'Détracteur' : (n <= 8 ? 'Passif' : 'Promoteur');
      return `${n}/10 (${tier})`;
    }
    case 'slider': {
      const unit = opts.unit ? ' ' + opts.unit : '';
      return `${raw}${unit}`;
    }
    case 'likert': {
      const level = (opts.choices || []).find(c => c.id === raw);
      return level?.label || String(raw);
    }
    case 'image-picker': {
      const c = (opts.choices || []).find(c => c.id === raw);
      return c?.label || String(raw);
    }
    case 'repeater': {
      // Tableau d'objets : aplati en une cellule lisible.
      // « Élément 1 — Titre: X · Année: Y ‖ Élément 2 — … »
      const items = Array.isArray(raw) ? raw : [];
      if (items.length === 0) return '';
      const subFields = opts.fields || [];
      const itemLabel = opts.item_label || 'Élément';
      return items.map((item, i) => {
        const parts = subFields.map(sf => {
          const v = item?.[sf.id];
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
          return `${sf.label || sf.id}: ${_csvFormatValue(sf, v)}`;
        }).filter(Boolean).join(' · ');
        return `${itemLabel} ${i + 1} — ${parts}`;
      }).join('  ‖  ');
    }
    default:
      return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
}

function _escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

/**
 * Convertit la valeur brute d'un champ en HTML humain lisible
 * dans l'email de notification.
 */
function _formatValue(field, raw) {
  if (raw == null || raw === '') return '<em style="color:#64748b">(vide)</em>';
  const opts = field.options || {};
  switch (field.type) {
    case 'text-short':
    case 'text-long':
      return _escapeHtml(raw).replace(/\n/g, '<br>');
    case 'email':
      return `<a href="mailto:${_escapeHtml(raw)}" style="color:#c9a96e">${_escapeHtml(raw)}</a>`;
    case 'website':
    case 'url-external':
      return `<a href="${_escapeHtml(raw)}" target="_blank" rel="noopener" style="color:#c9a96e;word-break:break-all">${_escapeHtml(raw)}</a>`;
    case 'chips': {
      const choice = (opts.choices || []).find(c => c.id === raw);
      return _escapeHtml(choice?.label || raw);
    }
    case 'cards': {
      const ids = Array.isArray(raw) ? raw : [];
      if (ids.length === 0) return '<em style="color:#64748b">(aucun)</em>';
      const labels = ids.map(id => {
        const c = (opts.choices || []).find(c => c.id === id);
        return _escapeHtml(c?.label || id);
      });
      return labels.join(' · ');
    }
    case 'yes-no':
      if (raw === 'yes') return _escapeHtml(opts.yes_label || 'Oui');
      if (raw === 'no')  return _escapeHtml(opts.no_label || 'Non');
      return _escapeHtml(raw);
    case 'rank-top3': {
      const arr = Array.isArray(raw) ? raw : [];
      const items = arr.map((v, i) => v ? `<li>${_escapeHtml(v)}</li>` : '').filter(Boolean);
      return items.length ? `<ol style="margin:0;padding-left:18px">${items.join('')}</ol>` : '<em style="color:#64748b">(vide)</em>';
    }
    case 'date': {
      try {
        return new Date(raw).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch { return _escapeHtml(raw); }
    }
    case 'amount': {
      const cur = opts.currency || 'EUR';
      try {
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: opts.decimals ?? 2 }).format(Number(raw));
      } catch { return _escapeHtml(raw) + ' ' + _escapeHtml(cur); }
    }
    case 'social-links': {
      const networks = (opts.networks || []).filter(n => n.enabled);
      const obj = (raw && typeof raw === 'object') ? raw : {};
      const lines = networks
        .map(n => {
          const v = obj[n.id];
          if (!v) return null;
          return `<div style="margin-bottom:4px"><strong style="color:#c9a96e;font-size:11px;letter-spacing:.06em;text-transform:uppercase">${_escapeHtml(n.label)}</strong> &nbsp; ${_escapeHtml(v)}</div>`;
        })
        .filter(Boolean);
      return lines.length ? lines.join('') : '<em style="color:#64748b">(aucun)</em>';
    }
    case 'signature': {
      // raw = data URI base64 SVG. On l'affiche inline dans le mail.
      return `<img src="${_escapeHtml(raw)}" alt="Signature" style="max-width:280px;background:#fff;border:1px solid #1f2a37;border-radius:6px;padding:6px"/>`;
    }
    case 'nps': {
      const n = Number(raw);
      if (isNaN(n)) return _escapeHtml(raw);
      const tier = n <= 6 ? 'Détracteur' : (n <= 8 ? 'Passif' : 'Promoteur');
      const color = n <= 6 ? '#e05c5c' : (n <= 8 ? '#f59e0b' : '#22c55e');
      return `<strong style="color:${color};font-size:18px">${n}/10</strong> <span style="color:#94a3b8;font-size:12px">· ${tier}</span>`;
    }
    case 'slider': {
      const unit = opts.unit ? ' ' + opts.unit : '';
      return `<strong>${_escapeHtml(raw)}${_escapeHtml(unit)}</strong>`;
    }
    case 'likert': {
      const level = (opts.choices || []).find(c => c.id === raw);
      return _escapeHtml(level?.label || raw);
    }
    case 'image-picker': {
      const c = (opts.choices || []).find(c => c.id === raw);
      if (!c) return _escapeHtml(raw);
      const label = _escapeHtml(c.label || raw);
      if (c.image_url) {
        return `<div style="display:flex;gap:10px;align-items:center"><img src="${_escapeHtml(c.image_url)}" alt="" style="width:60px;height:45px;object-fit:cover;border-radius:4px;border:1px solid #1f2a37"/><span>${label}</span></div>`;
      }
      return label;
    }
    default:
      return _escapeHtml(typeof raw === 'object' ? JSON.stringify(raw) : raw);
  }
}

/**
 * Template HTML du mail de notification.
 * Charte sobre dark/navy/or, lisible sur Outlook, Apple Mail, Gmail.
 */
function _renderResponseEmail({ form, responses, responseId, receivedAt }) {
  const meta = form.meta || {};
  const sections = form.sections || [];
  const totalAnswered = Object.keys(responses).length;
  const receivedStr = receivedAt.toLocaleString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const sectionsHtml = sections.map(sec => {
    const fieldsHtml = (sec.fields || []).map(f => {
      const value = responses[f.id];
      const labelHtml = _escapeHtml(f.label || '(sans libellé)');
      const valueHtml = _formatValue(f, value);
      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #1f2a37;vertical-align:top">
            <div style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">
              ${labelHtml}
            </div>
            <div style="color:#f1f5f9;font-size:14px;line-height:1.55">
              ${valueHtml}
            </div>
          </td>
        </tr>
      `;
    }).join('');
    return `
      <tr><td style="padding:20px 0 8px 0">
        <div style="color:#c9a96e;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">
          ${_escapeHtml(sec.title || 'Section')}
        </div>
      </td></tr>
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fieldsHtml}</table>
      </td></tr>
    `;
  }).join('');

  return `
  <!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#0a0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e14;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#111720;border:1px solid #1f2a37;border-radius:12px;overflow:hidden">
          <tr><td style="padding:32px 36px 8px 36px">
            <div style="font-size:11px;letter-spacing:.18em;color:#c9a96e;text-transform:uppercase;font-weight:700;margin-bottom:8px">Keystone OS · Pulsa</div>
            <h1 style="margin:0 0 8px 0;color:#f1f5f9;font-size:22px;font-weight:700;letter-spacing:-.02em">
              Nouvelle réponse${meta.title ? ' — ' + _escapeHtml(meta.title) : ''}
            </h1>
            <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.5">
              Reçue le ${_escapeHtml(receivedStr)} · ${totalAnswered} champ${totalAnswered > 1 ? 's' : ''} renseigné${totalAnswered > 1 ? 's' : ''}
            </p>
          </td></tr>

          <tr><td style="padding:8px 36px 24px 36px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sectionsHtml}</table>
          </td></tr>

          <tr><td style="padding:0 36px 32px 36px">
            <div style="background:#0a0e14;border:1px solid #1f2a37;border-radius:8px;padding:16px 18px;font-size:12px;color:#64748b;line-height:1.6">
              <strong style="color:#94a3b8">Conservation</strong> &nbsp; Cette réponse est stockée pendant ${form.ttl_days || 90} jours, puis supprimée automatiquement (RGPD Art. 5).
              <br><strong style="color:#94a3b8">Identifiant</strong> &nbsp; <code style="color:#c9a96e">${_escapeHtml(responseId)}</code>
              <br><strong style="color:#94a3b8">URL du formulaire</strong> &nbsp; <code style="color:#c9a96e">/form?s=${_escapeHtml(form.slug || '')}</code>
            </div>
          </td></tr>
        </table>
        <div style="margin-top:20px;color:#475569;font-size:11px">
          Notification automatique · Protein Studio · Keystone OS · Pulsa
        </div>
      </td></tr>
    </table>
  </body></html>`;
}
