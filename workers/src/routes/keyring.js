// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Key-Ring (Sonnette) · ORDRE 3 : « Sonner » Web Push + boucle retour
// ───────────────────────────────────────────────────────────────────
// Le visiteur tape « Sonner maintenant » sur la page interphone -> POST /ring
// (PUBLIC). On resout le PROPRIETAIRE du QR via `entities` (comme le dispatcher
// /r/), on anti-spamme (empreinte appareil + cooldown + plafond/jour), on cree
// un ring, puis on FAN-OUT un Web Push CHIFFRE (lib/webpush.js, deja prod
// Keynapse) vers les appareils abonnes du proprietaire (table kr_push_subs,
// par tenant). La charge porte un `respond_token` (secret, car la charge est
// chiffree et seul le proprio la recoit) : depuis la notif, l'occupant repond
// en 1 tap -> le SW POST /respond avec le token -> la page visiteur poll
// /ring-status et affiche la reponse. Cote proprio, l'abonnement des appareils
// se fait dans l'editeur de la Sonnette (JWT).
//
// Garde-fous : tables additives (CREATE TABLE IF NOT EXISTS) ; ring/respond/
// ring-status sont PUBLICS mais ne fuient JAMAIS le coffre/tenant (ids opaques,
// 404 silencieux) ; rate-limit motif sa_public_usage ; « confort, pas securite ».
// ══════════════════════════════════════════════════════════════════

import { json, err, parseBody, generateId, getAllowedOrigin, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { sendPush } from '../lib/webpush.js';
import { sendEmail } from '../lib/email-resend.js';
import { escHtml } from './smart-templates/_shared.js';

export const KR_VERSION = 'KR-1';

// Reponses canoniques de l'occupant (boutons d'action de la notif). La cle est
// transmise par le SW ; le LIBELLE est resolu serveur (jamais de texte libre).
export const RING_RESPONSES = {
  arrive: "J'arrive",
  '5min': 'Je suis la dans 5 minutes',
  open:   "C'est ouvert, entrez",
  busy:   'Pas disponible pour le moment',
};

// Anti-spam (par appareil, par QR).
export const RING_COOLDOWN_S  = 30;   // delai mini entre 2 sonneries
export const RING_MAX_PER_DAY = 60;   // plafond/jour

// ── Helpers purs (testables sans D1) ────────────────────────────────
export function sanitizeName(v)  { return String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); }
export function sanitizeMotif(v) { return String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140); }
export function dayKey(ms)        { return new Date(ms).toISOString().slice(0, 10); }   // YYYY-MM-DD (UTC)

// Empreinte appareil anonyme = SHA-256(UA|IP) tronquee (replique qr.js _deviceHash).
async function _deviceHash(request) {
  const ua = request.headers.get('user-agent') || '?';
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '?';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ua + '|' + ip));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Schema (idempotent, additif) ────────────────────────────────────
let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  const stmts = [
    // Appareils du proprietaire abonnes aux sonneries (par tenant).
    `CREATE TABLE IF NOT EXISTS kr_push_subs (
       endpoint TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default',
       p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT,
       created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE INDEX IF NOT EXISTS idx_kr_push_subs_tenant ON kr_push_subs(tenant_id)`,
    // Chaque coup de sonnette + sa reponse. respond_token autorise la reponse.
    `CREATE TABLE IF NOT EXISTS kr_rings (
       id TEXT PRIMARY KEY, short_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
       visitor_name TEXT, motif TEXT, status TEXT NOT NULL DEFAULT 'pending',
       response TEXT, respond_token TEXT NOT NULL, device_hash TEXT,
       created_at TEXT DEFAULT (datetime('now')), answered_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_kr_rings_short ON kr_rings(short_id, created_at)`,
    // Rate-limit par appareil/jour/QR (motif sa_public_usage).
    `CREATE TABLE IF NOT EXISTS kr_ring_usage (
       short_id TEXT NOT NULL, day TEXT NOT NULL, device_hash TEXT NOT NULL,
       count INTEGER NOT NULL DEFAULT 0, last_ts INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (short_id, day, device_hash))`,
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
  _schemaReady = true;
}

// ── Auth tenant (patron keynapse.js) ────────────────────────────────
function _tenantOf(request, env, claims) {
  if (requireAdmin(request, env)) return 'default';
  if (!claims) return null;
  if (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN') return 'default';
  return claims.sub || null;
}
async function _gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims && !requireAdmin(request, env)) return { error: err('Authentification requise', 401, origin) };
  const tenant = _tenantOf(request, env, claims);
  if (!tenant) return { error: err('Authentification requise', 401, origin) };
  await _ensureSchema(env);
  return { claims, tenant };
}

// Resout short_id -> { tenant_id, td } (proprietaire + template_data) via
// `entities` (meme source que le dispatcher /r/). null si inconnu / pas key-ring.
async function _resolveKeyring(env, shortId) {
  const row = await env.DB.prepare(
    `SELECT tenant_id, data FROM entities
     WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
     AND deleted_at IS NULL LIMIT 1`
  ).bind(String(shortId || '')).first();
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data); } catch (_) { return null; }
  if (data.template_id !== 'key-ring') return null;
  return { tenant_id: row.tenant_id, td: data.template_data || {} };
}

function _vapid(env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return null;
  try {
    return { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK),
             subject: 'mailto:' + (env.SDQR_DPO_EMAIL || 'contact@protein-keystone.com') };
  } catch (_) { return null; }
}

// ════════════════════════════════════════════════════════════════════
// PUBLIC — le visiteur SONNE
// POST /api/keyring/ring { short_id, name?, motif? }
// ════════════════════════════════════════════════════════════════════
export async function handleKeyringRing(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);
  const b = await parseBody(request);
  const shortId = String(b.short_id || '').trim().slice(0, 64);
  if (!shortId) return err('Requete invalide', 400, origin);

  const target = await _resolveKeyring(env, shortId);
  if (!target) return err('Sonnette introuvable', 404, origin);   // 404 silencieux

  // Anti-spam : cooldown + plafond/jour par appareil/QR.
  const dh  = await _deviceHash(request);
  const now = Date.now();
  const nowS = Math.floor(now / 1000);
  const day = dayKey(now);
  const u = await env.DB.prepare(
    'SELECT count, last_ts FROM kr_ring_usage WHERE short_id = ? AND day = ? AND device_hash = ?'
  ).bind(shortId, day, dh).first();
  if (u) {
    if (nowS - u.last_ts < RING_COOLDOWN_S) {
      return json({ ok: false, error: 'cooldown', retry_after: RING_COOLDOWN_S - (nowS - u.last_ts) }, 429, origin);
    }
    if (u.count >= RING_MAX_PER_DAY) {
      return json({ ok: false, error: 'limit' }, 429, origin);
    }
  }
  await env.DB.prepare(
    `INSERT INTO kr_ring_usage (short_id, day, device_hash, count, last_ts) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(short_id, day, device_hash) DO UPDATE SET count = count + 1, last_ts = excluded.last_ts`
  ).bind(shortId, day, dh, nowS).run();

  const name  = sanitizeName(b.name);
  const motif = sanitizeMotif(b.motif);
  const ringId = generateId();
  const token  = generateId();
  await env.DB.prepare(
    `INSERT INTO kr_rings (id, short_id, tenant_id, visitor_name, motif, status, respond_token, device_hash)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(ringId, shortId, target.tenant_id, name || null, motif || null, token, dh).run();

  // Fan-out Web Push vers les appareils du proprietaire.
  let sent = 0;
  const vapid = _vapid(env);
  if (vapid) {
    const subs = (await env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM kr_push_subs WHERE tenant_id = ?'
    ).bind(target.tenant_id).all()).results || [];
    const apiBase = new URL(request.url).origin;
    const place = String(target.td.place_name || 'Sonnette').slice(0, 60);
    const payload = { kind: 'keyring-ring', ring_id: ringId, token, place, name, motif, api: apiBase };
    for (const s of subs) {
      let st = 0;
      try { st = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload, vapid); }
      catch (_) { st = 0; }
      if (st === 201 || st === 200) sent++;
      else if (st === 404 || st === 410) {
        try { await env.DB.prepare('DELETE FROM kr_push_subs WHERE endpoint = ?').bind(s.endpoint).run(); } catch (_) {}
      }
    }
  }

  // Repli e-mail (EN PLUS du push) — fiabilite (push iPhone fragile). Best-effort,
  // ne bloque jamais la reponse au visiteur. Envoye si alert_email est renseigne.
  const ae = String(target.td.alert_email || '').trim();
  const alertEmail = (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ae) && !/[<>"'\\]/.test(ae)) ? ae : '';
  if (alertEmail && env.KS_RESEND_KEY) {
    const place = String(target.td.place_name || 'Sonnette').slice(0, 60);
    const who   = name || 'Quelqu\'un';
    const line  = motif ? (who + ' : ' + motif) : (who + ' est a votre porte.');
    const html  = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">`
      + `<div style="font-size:12px;letter-spacing:1.5px;color:#7c8af9;text-transform:uppercase">Sonnette</div>`
      + `<h1 style="font-size:22px;margin:6px 0 14px;color:#111">${escHtml(place)}</h1>`
      + `<p style="font-size:16px;color:#222;line-height:1.5">${escHtml(line)}</p>`
      + `<p style="font-size:12.5px;color:#888;margin-top:22px;line-height:1.5">Sonnette de confort Keystone &mdash; ouvrez l'application pour repondre. Ce n'est pas un dispositif de securite ni de secours.</p>`
      + `</div>`;
    try { await sendEmail(env, { to: alertEmail, subject: 'Sonnette — ' + place, html }); } catch (_) {}
  }

  return json({ ok: true, ring_id: ringId, sent }, 200, origin);
}

// PUBLIC — le visiteur poll l'etat de SA sonnerie.
// GET /api/keyring/ring-status?id=<ring_id>
export async function handleKeyringRingStatus(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);
  const id = String(new URL(request.url).searchParams.get('id') || '').trim();
  if (!id) return err('Requete invalide', 400, origin);
  const r = await env.DB.prepare('SELECT status, response FROM kr_rings WHERE id = ?').bind(id).first();
  if (!r) return err('Introuvable', 404, origin);
  return json({ ok: true, status: r.status, response: r.response || null }, 200, origin);
}

// L'occupant REPOND depuis la notif (via le SW). Autorise par respond_token
// (present dans la charge chiffree -> seul le proprio le connait), pas de JWT.
// POST /api/keyring/respond { ring_id, response, token }
export async function handleKeyringRespond(request, env) {
  const origin = getAllowedOrigin(env, request);
  await _ensureSchema(env);
  const b = await parseBody(request);
  const ringId = String(b.ring_id || '').trim();
  const key    = String(b.response || '').trim();
  const token  = String(b.token || '').trim();
  if (!ringId || !token || !RING_RESPONSES[key]) return err('Requete invalide', 400, origin);
  const r = await env.DB.prepare('SELECT respond_token FROM kr_rings WHERE id = ?').bind(ringId).first();
  if (!r) return err('Introuvable', 404, origin);
  if (r.respond_token !== token) return err('Non autorise', 403, origin);
  await env.DB.prepare(
    "UPDATE kr_rings SET response = ?, status = 'answered', answered_at = datetime('now') WHERE id = ?"
  ).bind(RING_RESPONSES[key], ringId).run();
  return json({ ok: true }, 200, origin);
}

// ════════════════════════════════════════════════════════════════════
// PROPRIETAIRE (JWT) — abonnement des appareils aux sonneries
// ════════════════════════════════════════════════════════════════════
export async function handleKeyringPushSubscribe(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const b = await parseBody(request);
  const endpoint = String(b.endpoint || '').trim();
  const p256dh = String(b.p256dh || '').trim();
  const auth = String(b.auth || '').trim();
  const label = String(b.label || '').trim().slice(0, 60) || null;
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1024 || !p256dh || !auth) return err('Abonnement invalide', 400, origin);
  await env.DB.prepare(
    `INSERT INTO kr_push_subs (endpoint, tenant_id, p256dh, auth, label) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET tenant_id = excluded.tenant_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label`
  ).bind(endpoint, gate.tenant, p256dh, auth, label).run();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM kr_push_subs WHERE tenant_id = ?').bind(gate.tenant).first())?.n || 0;
  return json({ ok: true, count: n }, 200, origin);
}

export async function handleKeyringPushUnsubscribe(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const b = await parseBody(request);
  const endpoint = String(b.endpoint || '').trim();
  if (endpoint) await env.DB.prepare('DELETE FROM kr_push_subs WHERE endpoint = ? AND tenant_id = ?').bind(endpoint, gate.tenant).run();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM kr_push_subs WHERE tenant_id = ?').bind(gate.tenant).first())?.n || 0;
  return json({ ok: true, count: n }, 200, origin);
}

// GET /api/keyring/push/status?endpoint=<...> -> { subscribed, count }
export async function handleKeyringPushStatus(request, env) {
  const origin = getAllowedOrigin(env, request);
  const gate = await _gate(request, env, origin); if (gate.error) return gate.error;
  const endpoint = String(new URL(request.url).searchParams.get('endpoint') || '').trim();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM kr_push_subs WHERE tenant_id = ?').bind(gate.tenant).first())?.n || 0;
  let subscribed = false;
  if (endpoint) {
    const row = await env.DB.prepare('SELECT 1 AS x FROM kr_push_subs WHERE endpoint = ? AND tenant_id = ?').bind(endpoint, gate.tenant).first();
    subscribed = !!row;
  }
  return json({ ok: true, subscribed, count: n }, 200, origin);
}
