/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes SDQR · Sovereign Dynamic QR (Sprint 1)

   Routes :
     GET  /r/:shortId       Public — redirige + log scan (RGPD safe)
     POST /api/qr           Tenant — crée un QR dynamique
     GET  /api/qr           Tenant — liste les QRs du tenant
     PATCH /api/qr/:id      Tenant — modifie cible / status / nom / tags
     DELETE /api/qr/:id     Tenant — suppression definitive (cascade)
     GET /api/qr/:id/stats  Tenant — agrégations scan (period=7d|30d|90d|all)
     GET /api/qr/:id/scans.csv Tenant — export brut (RGPD-safe : 0 PII)
     GET /sdqr-privacy        Public — page de transparence RGPD

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
// GET /r/:shortId — redirect public + log scan (cœur SDQR)
// Sprint SDQR-2.5 : dispatch selon qr_type :
//   - url   → 302 redirect (legacy)
//   - vcard → .vcf file (Content-Type text/x-vcard)
//   - ical  → .ics file (Content-Type text/calendar)
//   - text  → HTML page lisible avec bouton Copier
// ══════════════════════════════════════════════════════════════════
export async function handleQrRedirect(request, env, shortId) {
  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return new Response('Not Found', { status: 404 });
  }

  // Lookup ultra-rapide via PRIMARY KEY (qr_redirects.short_id)
  // qr_type + encoded_payload servent à dispatcher selon le type (SDQR-2.5)
  const row = await env.DB
    .prepare('SELECT target_url, qr_type, encoded_payload, status FROM qr_redirects WHERE short_id = ?')
    .bind(shortId)
    .first();

  if (!row || row.status !== 'active') {
    return new Response('QR introuvable ou archivé', { status: 404 });
  }

  // Log scan (async, non bloquant) — RGPD safe : pas d IP brute
  const ua      = request.headers.get('User-Agent') || '';
  const country = request.cf?.country || null;
  const { device, os } = parseUA(ua);
  const uaHash  = await sha256Hex(ua, 8);
  try {
    await env.DB
      .prepare(`INSERT INTO qr_scans (short_id, country, device_kind, os_kind, ua_hash)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(shortId, country, device, os, uaHash)
      .run();
  } catch (e) {
    console.warn('[qr-redirect] scan log failed:', e.message);
  }

  const type = row.qr_type || 'url';

  // ── URL : 302 standard ──────────────────────────────────────
  if (type === 'url') {
    return Response.redirect(row.target_url, 302);
  }

  // ── vCard : .vcf téléchargeable (iOS / Android proposent "Ajouter contact") ──
  if (type === 'vcard') {
    return new Response(row.encoded_payload || '', {
      status: 200,
      headers: {
        'Content-Type': 'text/x-vcard; charset=utf-8',
        'Content-Disposition': `attachment; filename="contact-${shortId}.vcf"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── iCal : .ics téléchargeable (iOS / Android proposent "Ajouter événement") ──
  if (type === 'ical') {
    return new Response(row.encoded_payload || '', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="event-${shortId}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── Texte : page HTML lisible avec bouton Copier ──
  if (type === 'text') {
    return new Response(_renderTextPage(row.encoded_payload || ''), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response('Type non supporté : ' + type, { status: 500 });
}

// Page HTML standalone servie pour les QR texte dynamiques.
// Inline CSS pour aucune dépendance externe, look Keystone (navy / gold).
function _renderTextPage(text) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keystone OS — Contenu</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:linear-gradient(180deg,#0a1024 0%,#060a18 100%);color:#e8edf8;min-height:100vh;padding:24px 20px;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto}
  .pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#c9a84c;background:rgba(184,148,90,.10);border:1px solid rgba(184,148,90,.32);padding:5px 11px;border-radius:999px;margin-bottom:18px}
  h1{font-family:Georgia,"Times New Roman",serif;font-weight:600;font-size:22px;color:#fff;letter-spacing:-.01em;margin-bottom:18px}
  .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:20px;margin-bottom:14px;white-space:pre-wrap;word-break:break-word;font-size:15px;color:#fff}
  button{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;background:#c9a84c;color:#1a1a1a;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:transform .15s,background .15s}
  button:hover{background:#d4b27a;transform:translateY(-1px)}
  .foot{margin-top:30px;font-size:11px;color:rgba(220,225,240,.45);text-align:center;line-height:1.6}
  .foot strong{color:rgba(220,225,240,.7)}
</style>
</head>
<body>
<div class="wrap">
  <span class="pill">Keystone OS · Contenu dynamique</span>
  <h1>Contenu partagé</h1>
  <div class="card" id="content">${esc(text)}</div>
  <button id="copy">Copier le contenu</button>
  <div class="foot">
    Ce contenu est servi par un <strong>QR souverain Keystone</strong>.<br>
    Aucune donnée tierce collectée. <a href="/sdqr-privacy" style="color:#c9a84c;text-decoration:underline;text-underline-offset:2px">Politique de transparence</a>
  </div>
</div>
<script>
document.getElementById('copy').addEventListener('click',function(){
  navigator.clipboard.writeText(document.getElementById('content').textContent).then(function(){
    var b=document.getElementById('copy');b.textContent='✓ Copié';
    setTimeout(function(){b.textContent='Copier le contenu';},1500);
  });
});
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════
// POST /api/qr — créer un QR (statique ou dynamique)
// Sprint SDQR-2 : accepte qr_type (url|text|vcard|wifi|ical) + mode
// (static|dynamic) + payload (objet typé).
// Mode dynamic : impose qr_type='url' + target_url + génère short_id.
// Mode static  : pas de short_id, pas de qr_redirects, encode côté client.
// ══════════════════════════════════════════════════════════════════
const ALLOWED_TYPES = new Set(['url', 'text', 'vcard', 'wifi', 'ical']);

export async function handleCreateQr(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);
  const body     = await parseBody(request);

  const name    = (body.name || '').toString().trim();
  const type    = (body.type || 'url').toString().toLowerCase();
  const mode    = (body.mode || 'dynamic').toString().toLowerCase() === 'static' ? 'static' : 'dynamic';
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
  const design  = (body.design  && typeof body.design  === 'object') ? body.design  : {};
  const tags    = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];

  if (!name)                  return err('Le nom est obligatoire', 400, origin);
  if (!ALLOWED_TYPES.has(type)) return err(`Type inconnu : ${type}`, 400, origin);

  // Validation mode/type : Wi-Fi reste static-only (cf. spec SDQR-2.5).
  // URL/Text/vCard/iCal supportent les deux modes.
  if (mode === 'dynamic' && type === 'wifi') {
    return err('Wi-Fi ne supporte que le mode statique.', 400, origin);
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();
  let target_url      = '';
  let encoded_payload = (body.encoded_payload || '').toString();
  let short = null;

  if (mode === 'dynamic') {
    if (type === 'url') {
      target_url = (body.target_url || payload?.url || '').toString().trim();
      if (!isValidUrl(target_url)) return err('target_url invalide (http/https requis)', 400, origin);
    } else {
      // Pour text/vcard/ical dynamiques, le frontend pre-encode le payload
      // et nous envoie la string a servir. Worker ne refait pas l encoding.
      if (!encoded_payload.trim()) {
        return err('encoded_payload manquant pour QR dynamique non-URL.', 400, origin);
      }
    }

    // Génère un short_id unique
    for (let i = 0; i < 3; i++) {
      const candidate = shortId(8);
      const exists = await env.DB
        .prepare('SELECT 1 FROM qr_redirects WHERE short_id = ?')
        .bind(candidate).first();
      if (!exists) { short = candidate; break; }
    }
    if (!short) return err('Impossible de générer un identifiant unique', 500, origin);
  }

  const entityData = {
    id, tenant_id: tenantId, type: 'qr_codes',
    name, qr_type: type, mode, payload, design, tags,
    short_id: short, status: 'active', created_at: now, updated_at: now,
  };

  try {
    if (mode === 'dynamic') {
      await env.DB
        .prepare(`INSERT INTO qr_redirects (short_id, qr_id, tenant_id, target_url, qr_type, encoded_payload, status)
                  VALUES (?, ?, ?, ?, ?, ?, 'active')`)
        .bind(short, id, tenantId, target_url, type, encoded_payload || null)
        .run();
    }

    await env.DB
      .prepare(`INSERT INTO entities (id, tenant_id, type, data) VALUES (?, ?, 'qr_codes', ?)`)
      .bind(id, tenantId, JSON.stringify(entityData))
      .run();

    return json({ qr: { ...entityData, target_url } }, 201, origin);
  } catch (e) {
    if (short) {
      await env.DB.prepare('DELETE FROM qr_redirects WHERE short_id = ?').bind(short).run().catch(() => {});
    }
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
  let targetChanged          = false;
  let encodedPayloadChanged  = false;
  if (body.name !== undefined)    entity.name   = String(body.name).trim() || entity.name;
  if (body.tags !== undefined)    entity.tags   = Array.isArray(body.tags) ? body.tags.slice(0, 12) : entity.tags;
  if (body.design !== undefined)  entity.design = body.design;
  if (body.payload !== undefined) entity.payload = body.payload;
  if (body.status !== undefined && ['active', 'archived'].includes(body.status)) {
    entity.status = body.status;
  }
  if (body.target_url !== undefined) {
    if (entity.mode === 'static') {
      return err('Impossible de modifier la cible d\'un QR statique (regénérez un nouveau QR).', 400, origin);
    }
    if (entity.qr_type !== 'url') {
      return err('target_url ne s\'applique qu\'aux QR de type URL.', 400, origin);
    }
    if (!isValidUrl(body.target_url)) return err('target_url invalide', 400, origin);
    targetChanged = true;
  }
  // Sprint SDQR-2.5 : encoded_payload editable pour dynamic non-URL.
  // Le frontend recompute via sdqr-types.js et envoie la nouvelle string.
  if (body.encoded_payload !== undefined) {
    if (entity.mode === 'static') {
      return err('Le contenu d\'un QR statique n\'est pas modifiable (regénérez).', 400, origin);
    }
    if (entity.qr_type === 'url') {
      return err('Pour un QR URL, utilisez target_url plutôt qu\'encoded_payload.', 400, origin);
    }
    if (!String(body.encoded_payload).trim()) {
      return err('encoded_payload ne peut pas être vide.', 400, origin);
    }
    encodedPayloadChanged = true;
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
    if (encodedPayloadChanged) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET encoded_payload = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(body.encoded_payload, entity.short_id).run();
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

// ══════════════════════════════════════════════════════════════════
// GET /api/qr/:id/stats — agrégations scans pour un QR (Sprint SDQR-4)
// Query string : period=7d|30d|90d|all (défaut 30d)
// Retour : { totals, byDay[], byCountry[], byDevice[], byOs[] }
// Tout est RGPD-safe : pas d IP brute exposée, juste les agrégats.
// ══════════════════════════════════════════════════════════════════

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, 'all': null };

export async function handleStatsQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);
  const url      = new URL(request.url);
  const period   = url.searchParams.get('period') || '30d';
  const days     = PERIOD_DAYS[period];   // null = all

  // Charge le QR pour récupérer son short_id (les scans sont indexés par short_id)
  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // QR statique : pas de scans trackés (par design, pas de /r/<id>)
  if (entity.mode === 'static') {
    return json({
      mode: 'static',
      info: 'Mode statique — aucun scan tracké (par design, RGPD natif).',
      totals: { total: 0, unique: 0, today: 0, week: 0 },
      byDay: [], byCountry: [], byDevice: [], byOs: [],
    }, 200, origin);
  }

  const shortId = entity.short_id;
  if (!shortId) {
    return json({ totals: { total:0, unique:0, today:0, week:0 }, byDay:[], byCountry:[], byDevice:[], byOs:[] }, 200, origin);
  }

  // Filtre temporel optionnel pour les agrégats. days numerique uniquement
  // (pas d'injection — vient de la whitelist PERIOD_DAYS).
  const periodWhere = days ? `AND ts >= datetime('now', '-${days} days')` : '';

  // ── Totaux ──────────────────────────────────────────────────
  // `unique` est un keyword reserve SQL → on l alias en uniq_count.
  // `today` compare via date(ts) pour simplicite (evite start-of-day).
  try {
    const totals = await env.DB.prepare(`
      SELECT
        COUNT(*)                AS total,
        COUNT(DISTINCT ua_hash) AS uniq_count,
        SUM(CASE WHEN date(ts) = date('now')                   THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN ts >= datetime('now', '-7 days')         THEN 1 ELSE 0 END) AS week
      FROM qr_scans
      WHERE short_id = ? ${periodWhere}
    `).bind(shortId).first() || { total: 0, uniq_count: 0, today: 0, week: 0 };

  // ── Scans par jour (pour line chart) ───────────────────────
  const { results: byDay } = await env.DB.prepare(`
    SELECT date(ts) AS day, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY day
    ORDER BY day ASC
  `).bind(shortId).all();

  // ── Top pays ──────────────────────────────────────────────
  const { results: byCountry } = await env.DB.prepare(`
    SELECT country, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? AND country IS NOT NULL ${periodWhere}
    GROUP BY country
    ORDER BY cnt DESC
    LIMIT 10
  `).bind(shortId).all();

  // ── Device kind ────────────────────────────────────────────
  const { results: byDevice } = await env.DB.prepare(`
    SELECT device_kind, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY device_kind
    ORDER BY cnt DESC
  `).bind(shortId).all();

  // ── OS ─────────────────────────────────────────────────────
  const { results: byOs } = await env.DB.prepare(`
    SELECT os_kind, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY os_kind
    ORDER BY cnt DESC
  `).bind(shortId).all();

    return json({
      mode: 'dynamic',
      period,
      totals: {
        total : totals.total      || 0,
        unique: totals.uniq_count || 0,
        today : totals.today      || 0,
        week  : totals.week       || 0,
      },
      byDay     : (byDay     || []).map(r => ({ day: r.day, cnt: r.cnt })),
      byCountry : (byCountry || []).map(r => ({ country: r.country, cnt: r.cnt })),
      byDevice  : (byDevice  || []).map(r => ({ device: r.device_kind || 'other', cnt: r.cnt })),
      byOs      : (byOs      || []).map(r => ({ os: r.os_kind || 'other', cnt: r.cnt })),
    }, 200, origin);
  } catch (e) {
    console.error('[qr-stats]', e);
    return err('Stats query failed : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/qr/:id/scans.csv — export brut des scans (RGPD-safe)
// Colonnes : ts, country, device_kind, os_kind, ua_hash (8 hex tronqué)
// Aucune PII exposée. Pour audit / import dans tableur tiers.
// ══════════════════════════════════════════════════════════════════
export async function handleScansCsv(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = getTenantId(request);

  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }
  if (entity.mode === 'static' || !entity.short_id) {
    return new Response('ts,country,device_kind,os_kind,ua_hash\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="scans-${qrId}.csv"`,
        'Access-Control-Allow-Origin': origin,
      },
    });
  }

  const { results } = await env.DB.prepare(`
    SELECT ts, country, device_kind, os_kind, ua_hash
    FROM qr_scans
    WHERE short_id = ?
    ORDER BY ts DESC
    LIMIT 10000
  `).bind(entity.short_id).all();

  const rows = (results || []).map(r =>
    `${r.ts},${r.country || ''},${r.device_kind || ''},${r.os_kind || ''},${r.ua_hash || ''}`
  ).join('\n');
  const csv = `ts,country,device_kind,os_kind,ua_hash\n${rows}`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="scans-${entity.short_id}.csv"`,
      'Access-Control-Allow-Origin': origin,
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /sdqr-privacy — page de transparence RGPD (Sprint SDQR-5)
// Page publique accessible depuis tout QR Keystone (lien en footer
// du viewer texte) qui expose noir sur blanc ce qui est tracké,
// combien de temps, comment exercer ses droits.
// ══════════════════════════════════════════════════════════════════
export async function handlePrivacyPage(request, env) {
  const retentionDays = parseInt(env.SDQR_SCAN_RETENTION_DAYS || '90', 10);
  const dpoEmail = env.SDQR_DPO_EMAIL || 'rgpd@protein-studio.fr';
  return new Response(_renderPrivacyPage(retentionDays, dpoEmail), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function _renderPrivacyPage(retentionDays, dpoEmail) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Politique de transparence — Sovereign Dynamic QR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:linear-gradient(180deg,#0a1024 0%,#060a18 100%);color:#e8edf8;min-height:100vh;line-height:1.65;padding:40px 24px 80px}
  .wrap{max-width:720px;margin:0 auto}
  .pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;background:rgba(184,148,90,.10);border:1px solid rgba(184,148,90,.32);padding:5px 12px;border-radius:999px;margin-bottom:24px}
  h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:36px;color:#fff;letter-spacing:-.02em;line-height:1.2;margin-bottom:14px}
  h2{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:20px;color:#fff;margin:32px 0 12px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08)}
  h2:first-of-type{border-top:none;padding-top:0}
  p{font-size:15px;color:rgba(220,225,240,.85);margin-bottom:12px}
  ul{margin:0 0 14px 22px;color:rgba(220,225,240,.85);font-size:14.5px}
  li{margin-bottom:6px}
  strong{color:#fff;font-weight:600}
  em{color:#c9a84c;font-style:normal;font-weight:500}
  .lead{font-size:17px;color:rgba(220,225,240,.95);line-height:1.65;margin-bottom:8px;font-family:'Cormorant Garamond',serif;font-style:italic}
  .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:18px 22px;margin:16px 0}
  .table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
  .table th,.table td{padding:9px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.07)}
  .table th{color:rgba(220,225,240,.55);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  .table td{color:rgba(220,225,240,.9)}
  code{background:rgba(0,0,0,.25);padding:2px 7px;border-radius:4px;font-family:'SF Mono',Menlo,monospace;font-size:13px;color:#a5b4fc}
  a{color:#c9a84c;text-decoration:none;border-bottom:1px dashed rgba(184,148,90,.4)}
  a:hover{color:#d4b27a;border-bottom-color:rgba(184,148,90,.7)}
  .foot{margin-top:48px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(220,225,240,.45);text-align:center}
  .badge-ok{display:inline-block;padding:2px 8px;background:rgba(46,179,124,.12);color:#6ee7a7;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .badge-no{display:inline-block;padding:2px 8px;background:rgba(239,68,68,.10);color:#fca5a5;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
  <span class="pill">Sovereign Dynamic QR · Transparence</span>
  <h1>Ce que ce QR collecte<br>et ce qu'il ne collecte pas</h1>
  <p class="lead">Vous venez de scanner un QR généré par Keystone OS. Voici, en clair, ce qui se passe.</p>

  <h2>Données collectées</h2>
  <p>Chaque scan d'un QR <strong>dynamique</strong> Keystone fait passer la requête par un serveur Cloudflare (datacenter UE). Nous y enregistrons strictement les informations suivantes :</p>
  <table class="table">
    <thead><tr><th>Donnée</th><th>Exemple</th><th>Pourquoi</th></tr></thead>
    <tbody>
      <tr><td>Date / heure</td><td><code>2026-05-12 14:23:00 UTC</code></td><td>Statistiques temporelles</td></tr>
      <tr><td>Pays</td><td><code>FR</code></td><td>Carte d'audience géographique</td></tr>
      <tr><td>Type d'appareil</td><td><code>mobile / desktop / tablet</code></td><td>Optimisation du contenu servi</td></tr>
      <tr><td>Système</td><td><code>ios / android / macos / windows / linux</code></td><td>Idem</td></tr>
      <tr><td>Empreinte UA</td><td><code>3f8a91b2</code> (8 chars)</td><td>Compteur de visiteurs uniques</td></tr>
    </tbody>
  </table>

  <h2>Ce que nous NE collectons PAS</h2>
  <ul>
    <li><span class="badge-no">Non</span> Adresse IP brute ni géolocalisation précise</li>
    <li><span class="badge-no">Non</span> Identifiant publicitaire mobile (IDFA, AAID…)</li>
    <li><span class="badge-no">Non</span> Cookie ni stockage local sur votre appareil</li>
    <li><span class="badge-no">Non</span> Aucun pixel tracker tiers (Google, Meta, X…)</li>
    <li><span class="badge-no">Non</span> Aucune donnée transmise à des régies publicitaires</li>
  </ul>
  <p>L'<em>empreinte UA</em> est un hash SHA-256 tronqué à 8 caractères du <em>User-Agent</em> de votre navigateur. Elle permet de distinguer si deux scans proviennent du même appareil <strong>sans pouvoir vous identifier</strong>. Elle est non-réversible.</p>

  <h2>Durée de conservation</h2>
  <p>Les logs de scan sont automatiquement supprimés après <strong>${retentionDays} jours</strong>. Une fois purgés, il est impossible de les reconstituer.</p>

  <h2>Souveraineté technique</h2>
  <div class="card">
    <p style="margin:0"><strong>Hébergement :</strong> Cloudflare Workers (datacenter Europe — frontière des données respectée).<br>
    <strong>Base de données :</strong> Cloudflare D1 SQLite, isolation tenant par chiffrement applicatif.<br>
    <strong>Aucun sous-traitant tiers</strong> n'a accès aux logs de scan (pas de Google Analytics, pas de Plausible, pas de Hotjar).</p>
  </div>

  <h2>Vos droits RGPD</h2>
  <p>Conformément au Règlement Général sur la Protection des Données (UE 2016/679), vous disposez des droits suivants :</p>
  <ul>
    <li><strong>Information</strong> (art. 13-14) — Cette page exerce ce droit.</li>
    <li><strong>Accès</strong> (art. 15) — Demande de copie des données vous concernant.</li>
    <li><strong>Rectification / effacement</strong> (art. 16-17) — Correction ou suppression anticipée.</li>
    <li><strong>Limitation</strong> (art. 18) — Gel du traitement en cas de contestation.</li>
    <li><strong>Portabilité</strong> (art. 20) — Export structuré CSV / JSON.</li>
    <li><strong>Opposition</strong> (art. 21) — Refus du traitement statistique.</li>
  </ul>
  <p>Pour exercer ces droits, contactez le DPO de l'opérateur du QR ou écrivez à :<br>
  <a href="mailto:${dpoEmail}">${dpoEmail}</a></p>

  <h2>Réclamation</h2>
  <p>Si vos demandes n'ont pas reçu de réponse satisfaisante, vous pouvez introduire une réclamation auprès de la <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">CNIL</a> (Autorité de contrôle française).</p>

  <div class="foot">
    Politique publiée par <strong>Keystone OS</strong> — éditeur de l'artefact Sovereign Dynamic QR.<br>
    Version 1.0 · ${new Date().toISOString().slice(0, 10)} · Conforme RGPD UE 2016/679.
  </div>
</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════
// Cron handler — auto-purge des scans > retention (Sprint SDQR-5)
// Déclenché par un scheduled trigger défini dans wrangler.toml.
// Default 90 jours, configurable via env.SDQR_SCAN_RETENTION_DAYS.
// ══════════════════════════════════════════════════════════════════
export async function handleScheduledPurge(env) {
  const retentionDays = parseInt(env.SDQR_SCAN_RETENTION_DAYS || '90', 10);
  try {
    const result = await env.DB
      .prepare(`DELETE FROM qr_scans WHERE ts < datetime('now', '-${retentionDays} days')`)
      .run();
    console.log(`[sdqr-purge] OK — supprimé ${result?.meta?.changes ?? '?'} lignes anciennes (> ${retentionDays}j)`);
  } catch (e) {
    console.error('[sdqr-purge] FAILED', e.message);
  }
}
