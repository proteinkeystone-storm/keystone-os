/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes SCEAU · Pad O-SEC-001 (Sprint S1 — backend coffre)

   Transmission de secret usage-unique, scellée, chiffrée de bout en bout,
   gatée par un OPRF qui meurt au 3e essai. Le serveur est AVEUGLE.
   Spec gelée : ../../SCEAU_CRYPTO_SPEC.md (S0). Cadrage : SCEAU_BRIEF.md.

   Routes (privées, JWT) — création en 3 temps :
     POST   /api/sceau/init        crée la coquille + paire OPRF → {short_id, oprf_pub}
     POST   /api/sceau/:id/eval    eval OPRF de CRÉATION (NON comptée, status='init')
     POST   /api/sceau/:id/seal    dépose le chiffré → status='scelle'
     GET    /api/sceau             liste les secrets du tenant (zéro matériel sensible)
     DELETE /api/sceau/:id         burn manuel (détruit chiffré + clé OPRF)

   Routes (publiques) — lecture au scan de /s/<id> :
     GET    /s/:id/meta            {status, oprf_pub, attempts_left} | 410 si mort
     POST   /s/:id/eval            eval OPRF de LECTURE — COMPTÉE, tue la clé au max
     GET    /s/:id/blob            {ciphertext, iv} (no-store) | 410 si mort

   ⚠ Anti-fuite : on ne logue JAMAIS chiffré / clé / passphrase. Le serveur
   ne voit jamais le clair ni la passphrase (aveuglée avant tout envoi).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, requireDevice, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { encrypt as encAtRest, decrypt as decAtRest } from '../lib/crypto.js';
import { sendEmail } from '../lib/email-resend.js';
import {
  Oprf, VOPRFServer, EvaluationRequest, randomPrivateKey, generatePublicKey,
} from '@cloudflare/voprf-ts';

const SUITE = Oprf.Suite.P256_SHA256;

// ── Helpers base64 <-> Uint8Array ─────────────────────────────
function _b64e(u8)  { return btoa(String.fromCharCode(...u8)); }
function _b64d(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

// ── short_id URL-safe (même alphabet que SDQR, 8 chars) ───────
function _shortId(len = 8) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ── Auth & entitlement (manifeste §7/§8) ───────────────────────
// Tenant : admin → 'default', sinon claims.sub. Entitlement (beta, modèle Smart
// Agent) : la CRÉATION de secrets est réservée MAX/ADMIN/BETA (ne jamais brider
// un testeur). La LECTURE publique reste ouverte (c'est le principe du sceau).
async function _resolveAuth(request, env) {
  if (requireAdmin(request, env)) return { tenant: 'default', entitled: true };
  const claims = await requireJWT(request, env);
  if (claims?.isAdmin) return { tenant: 'default', entitled: true };
  if (claims?.sub) {
    const p = String(claims.plan || '').toUpperCase();
    return { tenant: claims.sub, entitled: p === 'MAX' || p === 'ADMIN' || p === 'BETA' };
  }
  const device = await requireDevice(request, env);
  if (device?.tenant_id) return { tenant: device.tenant_id, entitled: true }; // appareil approuvé
  return { tenant: null, entitled: false };
}
async function _secTenant(request, env) {
  return (await _resolveAuth(request, env)).tenant;
}

// ── Clé OPRF au repos : chiffrée sous KS_ENCRYPTION_KEY ────────
// Un dump D1 seul ne donne PAS la clé utilisable (cf. spec §4 breach).
async function _wrapKey(privU8, env) {
  return encAtRest(_b64e(privU8), env.KS_ENCRYPTION_KEY); // → {ciphertext, iv}
}
async function _unwrapKey(encB64, ivB64, env) {
  const b64 = await decAtRest(encB64, ivB64, env.KS_ENCRYPTION_KEY);
  return _b64d(b64);
}

function _now() { return new Date().toISOString(); }
function _expired(row) {
  return !!row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
}

// Réponse publique no-store (jamais en cache : sinon le chiffré "ressuscite").
function _publicJson(data, status, origin) {
  const r = json(data, status, origin);
  r.headers.set('Cache-Control', 'no-store');
  r.headers.set('Referrer-Policy', 'no-referrer');
  return r;
}

// ── Chiffré volumineux (audio/fichier) en R2 (S8) ──────────────
// Le texte reste inline D1 (atomique). Au-delà du seuil OU pour un kind
// non-text, le chiffré (base64, opaque) part en R2. La clé R2 = sec/<id>.
const SEC_INLINE_MAX = 90_000;     // chars b64 → ~67 Ko de clair : au-delà, R2
const SEC_SEAL_MAX   = 8_000_000;  // chars b64 → ~6 Mo : cap dur (vocal qqs min)
function _blobKey(shortId) { return `sec/${shortId}`; }
// Suppression best-effort de l'objet R2 (la sécurité repose sur la mort de la
// clé OPRF en D1 ; un objet R2 résiduel reste chiffré et illisible).
async function _destroyBlob(env, blobKey) {
  if (blobKey) { try { await env.HELP_MEDIA.delete(blobKey); } catch (_) {} }
}

// ══════════════════════════════════════════════════════════════
// CRÉATION (privée, JWT) — 3 temps
// ══════════════════════════════════════════════════════════════

// POST /api/sceau/init → coquille + paire OPRF. La clé privée ne sort JAMAIS.
export async function handleSceauInit(request, env) {
  const origin = getAllowedOrigin(env, request);
  const { tenant, entitled } = await _resolveAuth(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);
  if (!entitled) return err('Missive est réservée aux formules Max pendant la beta.', 403, origin);

  const body = await parseBody(request);
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null;

  const priv = await randomPrivateKey(SUITE);
  const pub  = generatePublicKey(SUITE, priv);
  const wrapped = await _wrapKey(priv, env);

  // short_id unique (collision quasi nulle, on retente une fois par sûreté).
  let shortId = _shortId();
  for (let i = 0; i < 2; i++) {
    const clash = await env.DB.prepare('SELECT 1 FROM sec_secrets WHERE short_id = ?').bind(shortId).first();
    if (!clash) break;
    shortId = _shortId();
  }

  await env.DB.prepare(
    `INSERT INTO sec_secrets (short_id, tenant_id, oprf_pub, oprf_key_enc, oprf_key_iv, status, label, created_at)
     VALUES (?, ?, ?, ?, ?, 'init', ?, datetime('now'))`
  ).bind(shortId, tenant, _b64e(pub), wrapped.ciphertext, wrapped.iv, label).run();

  return json({ short_id: shortId, oprf_pub: _b64e(pub) }, 201, origin);
}

// POST /api/sceau/:id/eval → eval OPRF de CRÉATION. NON comptée (status='init').
export async function handleSceauEvalCreate(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);

  const row = await env.DB.prepare(
    `SELECT tenant_id, status, oprf_key_enc, oprf_key_iv FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();
  if (!row || row.tenant_id !== tenant) return err('Introuvable', 404, origin);
  if (row.status !== 'init' || !row.oprf_key_enc) return err('Déjà scellé', 409, origin);

  const body = await parseBody(request);
  if (typeof body.blinded !== 'string' || body.blinded.length > 1024) return err('blinded invalide', 400, origin);

  let evaluationB64;
  try {
    const priv = await _unwrapKey(row.oprf_key_enc, row.oprf_key_iv, env);
    const evalReq = EvaluationRequest.deserialize(SUITE, _b64d(body.blinded));
    const server  = new VOPRFServer(SUITE, priv);
    const evalu   = await server.blindEvaluate(evalReq);
    evaluationB64 = _b64e(evalu.serialize());
  } catch {
    return err('Évaluation impossible', 400, origin); // jamais de détail crypto
  }
  return json({ evaluation: evaluationB64 }, 200, origin);
}

// POST /api/sceau/:id/seal → dépose le chiffré E2E, arme le compteur.
export async function handleSceauSeal(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);

  const row = await env.DB.prepare(
    `SELECT tenant_id, status FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();
  if (!row || row.tenant_id !== tenant) return err('Introuvable', 404, origin);
  if (row.status !== 'init') return err('Déjà scellé', 409, origin);

  const body = await parseBody(request);
  const { ciphertext, iv } = body;
  if (typeof ciphertext !== 'string' || typeof iv !== 'string') return err('ciphertext/iv requis', 400, origin);
  if (ciphertext.length > SEC_SEAL_MAX) return err('Secret trop volumineux', 413, origin);

  // kind : 'text' (défaut) | 'audio' | 'file' ; mime du contenu déchiffré.
  const kind = ['text', 'audio', 'file'].includes(body.kind) ? body.kind : 'text';
  const mime = typeof body.mime === 'string' ? body.mime.slice(0, 80) : null;

  let max = parseInt(body.max_attempts, 10);
  if (!Number.isInteger(max) || max < 1 || max > 10) max = 3;

  let expiresAt = null;
  if (body.expires_at) {
    const t = new Date(body.expires_at);
    if (!isNaN(t.getTime()) && t.getTime() > Date.now()) expiresAt = t.toISOString();
  }
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null;
  // Mode question/réponse : l'indice (question) est NON secret et affiché avant
  // déverrouillage. La réponse, elle, n'arrive jamais (aveuglée par l'OPRF).
  const question = typeof body.question === 'string' && body.question.trim()
    ? body.question.trim().slice(0, 200) : null;

  // Texte petit → inline D1 (atomique). Audio/fichier ou volumineux → R2.
  let inlineCt = ciphertext, blobKey = null;
  if (kind !== 'text' || ciphertext.length > SEC_INLINE_MAX) {
    blobKey = _blobKey(shortId);
    await env.HELP_MEDIA.put(blobKey, ciphertext, { httpMetadata: { contentType: 'text/plain' } });
    inlineCt = null;
  }

  await env.DB.prepare(
    `UPDATE sec_secrets
        SET ciphertext = ?, blob_key = ?, iv = ?, kind = ?, mime = ?, question = ?, max_attempts = ?, attempts = 0,
            expires_at = ?, label = COALESCE(?, label),
            status = 'scelle', sealed_at = datetime('now')
      WHERE short_id = ? AND status = 'init'`
  ).bind(inlineCt, blobKey, iv, kind, mime, question, max, expiresAt, label, shortId).run();

  return json({ ok: true, short_id: shortId, status: 'scelle', kind, max_attempts: max, expires_at: expiresAt }, 200, origin);
}

// GET /api/sceau → liste du tenant (AUCUN matériel sensible exposé).
export async function handleSceauList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);

  const { results } = await env.DB.prepare(
    `SELECT short_id, label, status, attempts, max_attempts,
            created_at, sealed_at, expires_at, read_at, destroyed_at
       FROM sec_secrets
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 500`
  ).bind(tenant).all();

  const items = (results || []).map(r => ({
    ...r,
    attempts_left: r.status === 'scelle' ? Math.max(0, r.max_attempts - r.attempts) : 0,
  }));
  return json({ items }, 200, origin);
}

// DELETE /api/sceau/:id → burn manuel (détruit chiffré + clé OPRF).
export async function handleSceauDelete(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);

  const pre = await env.DB.prepare('SELECT status, blob_key FROM sec_secrets WHERE short_id = ? AND tenant_id = ?').bind(shortId, tenant).first();
  if (!pre) return err('Introuvable', 404, origin);

  // Déjà morte (lu/détruite/expirée) → « Retirer » : on supprime la ligne (résidu).
  // Vivante → burn : on détruit le matériel et on garde la trace (accusé) jusqu'au sweep 24 h.
  if (['lu', 'detruit', 'expire'].includes(pre.status)) {
    await env.DB.prepare('DELETE FROM sec_secrets WHERE short_id = ? AND tenant_id = ?').bind(shortId, tenant).run();
    await _destroyBlob(env, pre.blob_key);
    return json({ ok: true, removed: true }, 200, origin);
  }
  await env.DB.prepare(
    `UPDATE sec_secrets
        SET ciphertext = NULL, blob_key = NULL, oprf_key_enc = NULL, oprf_key_iv = NULL,
            status = 'detruit', destroyed_at = datetime('now')
      WHERE short_id = ? AND tenant_id = ?`
  ).bind(shortId, tenant).run();
  await _destroyBlob(env, pre.blob_key);
  return json({ ok: true, status: 'detruit' }, 200, origin);
}

// POST /api/sceau/:id/email → MODE « SERVEUR DE CONFIANCE » (étiqueté faible).
// Le code est généré sur l'appareil du créateur (chiffrement E2E inchangé) ;
// ici le serveur RELAIE le code au destinataire par email. Il le VOIT donc le
// temps de l'envoi → perte de l'aveuglement serveur, assumée et étiquetée.
// Le code N'EST JAMAIS stocké ni logué.
export async function handleSceauEmail(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);

  const row = await env.DB.prepare(
    `SELECT tenant_id, status FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();
  if (!row || row.tenant_id !== tenant) return err('Introuvable', 404, origin);
  if (row.status !== 'scelle') return err('Missive non scellée', 409, origin);

  const body = await parseBody(request);
  const to = typeof body.to === 'string' ? body.to.trim().slice(0, 200) : '';
  const code = typeof body.code === 'string' ? body.code.slice(0, 200) : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return err('Email invalide', 400, origin);
  if (!code) return err('Code requis', 400, origin);
  if (!env.KS_RESEND_KEY) return err('Service email non configuré', 503, origin);

  // Le lien est reconstruit côté serveur (origine du Worker) — on ne fait pas
  // confiance à un lien fourni par le client. Jeton ou secret direct.
  const link = typeof body.token_id === 'string' && /^[A-Za-z0-9]{4,32}$/.test(body.token_id)
    ? `${new URL(request.url).origin}/s/t/${body.token_id}`
    : `${new URL(request.url).origin}/s/${shortId}`;

  try {
    await sendEmail(env, {
      to,
      subject: 'Vous avez reçu une missive sécurisée',
      html: _emailHtml(link, code),
    });
  } catch (e) {
    return err('Envoi email impossible', 502, origin);
  }
  return json({ ok: true }, 200, origin);
}

function _emailHtml(link, code) {
  const L = _escHtml(link), C = _escHtml(code);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#0b0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0e14;padding:40px 16px">
      <tr><td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#121826;border:1px solid #222b3d;border-radius:16px;overflow:hidden">
          <tr><td style="padding:32px 32px 8px;text-align:center">
            <div style="font:900 22px -apple-system,sans-serif;color:#eef2f8;letter-spacing:-0.02em">Missive sécurisée</div>
            <p style="color:#8a94a6;font-size:14.5px;line-height:1.6;margin:14px 0 0">Une personne vous a transmis un message chiffré, à lire <strong style="color:#eef2f8">une seule fois</strong>. Ouvrez-le avec le code ci-dessous.</p>
          </td></tr>
          <tr><td style="padding:20px 32px">
            <div style="background:#0d1320;border:1px solid #222b3d;border-radius:12px;padding:18px;text-align:center">
              <div style="color:#8a94a6;font-size:12px;margin-bottom:8px">Votre code</div>
              <div style="font:700 24px ui-monospace,Menlo,monospace;color:#fff;letter-spacing:2px">${C}</div>
            </div>
          </td></tr>
          <tr><td style="padding:8px 32px 32px;text-align:center">
            <a href="${L}" style="display:inline-block;background:#6c6cf5;color:#fff;text-decoration:none;font:700 16px -apple-system,sans-serif;padding:14px 28px;border-radius:12px">Ouvrir la missive</a>
            <p style="color:#5a6478;font-size:12px;line-height:1.5;margin:18px 0 0">Au-delà des essais autorisés, la missive s'autodétruit définitivement. Si vous n'attendiez pas ce message, ignorez-le.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}
function _escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ══════════════════════════════════════════════════════════════
// LECTURE PUBLIQUE — au scan de /s/<id>
// ══════════════════════════════════════════════════════════════

// GET /s/:id/meta → de quoi blinder côté client, ou 410 si mort.
export async function handleSceauMeta(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const row = await env.DB.prepare(
    `SELECT status, oprf_pub, attempts, max_attempts, oprf_key_enc, ciphertext, blob_key, kind, mime, question, expires_at
       FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();

  if (!row) return _publicJson({ error: 'Introuvable' }, 404, origin);
  if (row.status === 'init') return _publicJson({ status: 'absent' }, 404, origin);

  const hasBlob = row.ciphertext || row.blob_key;
  const dead = row.status !== 'scelle' || !row.oprf_key_enc || !hasBlob || _expired(row);
  if (dead) return _publicJson({ status: 'detruit' }, 410, origin);

  return _publicJson({
    status: 'scelle',
    oprf_pub: row.oprf_pub,
    kind: row.kind || 'text',
    mime: row.mime || null,
    question: row.question || null,
    attempts_left: Math.max(0, row.max_attempts - row.attempts),
  }, 200, origin);
}

// POST /s/:id/eval → eval OPRF de LECTURE. COMPTÉE. Tue la clé au max.
export async function handleSceauEval(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const body = await parseBody(request);
  if (typeof body.blinded !== 'string' || body.blinded.length > 1024) return _publicJson({ error: 'blinded invalide' }, 400, origin);

  // Expiration paresseuse : un secret échu est traité comme mort.
  const pre = await env.DB.prepare('SELECT status, expires_at, blob_key FROM sec_secrets WHERE short_id = ?').bind(shortId).first();
  if (!pre) return _publicJson({ error: 'Introuvable' }, 404, origin);
  if (pre.status === 'init') return _publicJson({ status: 'absent' }, 404, origin);
  if (pre.status === 'scelle' && _expired({ expires_at: pre.expires_at })) {
    await env.DB.prepare(
      `UPDATE sec_secrets SET status='expire', ciphertext=NULL, blob_key=NULL, oprf_key_enc=NULL, oprf_key_iv=NULL, destroyed_at=datetime('now')
        WHERE short_id = ? AND status='scelle'`
    ).bind(shortId).run();
    await _destroyBlob(env, pre.blob_key);
    return _publicJson({ status: 'detruit' }, 410, origin);
  }

  // Incrément ATOMIQUE et conditionnel : seul un secret vivant non épuisé passe.
  // Évite la TOCTOU sur le compteur (deux scans simultanés ne doublent pas un essai).
  const inc = await env.DB.prepare(
    `UPDATE sec_secrets SET attempts = attempts + 1
      WHERE short_id = ? AND status = 'scelle' AND oprf_key_enc IS NOT NULL AND attempts < max_attempts`
  ).bind(shortId).run();
  if (!inc.meta?.changes) return _publicJson({ status: 'detruit' }, 410, origin);

  // Relit l'état post-incrément (clé + compteur consolidés).
  const row = await env.DB.prepare(
    `SELECT oprf_key_enc, oprf_key_iv, attempts, max_attempts, blob_key FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();

  let evaluationB64;
  try {
    const priv = await _unwrapKey(row.oprf_key_enc, row.oprf_key_iv, env);
    const evalReq = EvaluationRequest.deserialize(SUITE, _b64d(body.blinded));
    const server  = new VOPRFServer(SUITE, priv);
    const evalu   = await server.blindEvaluate(evalReq);
    evaluationB64 = _b64e(evalu.serialize());
  } catch {
    // Eval impossible (entrée malformée) : l'essai reste compté (pas de bypass du quota).
    evaluationB64 = null;
  }

  // Au max-ème essai consommé → MORT CRYPTOGRAPHIQUE : on détruit la clé OPRF.
  // (Cet essai-ci est tout de même servi : le bon code peut tomber au dernier essai.)
  const reachedMax = row.attempts >= row.max_attempts;
  if (reachedMax) {
    await env.DB.prepare(
      `UPDATE sec_secrets SET oprf_key_enc = NULL, oprf_key_iv = NULL, ciphertext = NULL, blob_key = NULL, status = 'detruit', destroyed_at = datetime('now')
        WHERE short_id = ?`
    ).bind(shortId).run();
    await _destroyBlob(env, row.blob_key);
  }

  if (!evaluationB64) return _publicJson({ error: 'Évaluation impossible', attempts_left: Math.max(0, row.max_attempts - row.attempts) }, 400, origin);
  return _publicJson({
    evaluation: evaluationB64,
    attempts_left: Math.max(0, row.max_attempts - row.attempts),
  }, 200, origin);
}

// GET /s/:id/blob → le chiffré (opaque, inexploitable sans l'eval). no-store.
export async function handleSceauBlob(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const row = await env.DB.prepare(
    `SELECT status, ciphertext, blob_key, iv, kind, mime, oprf_key_enc, expires_at FROM sec_secrets WHERE short_id = ?`
  ).bind(shortId).first();

  if (!row) return _publicJson({ error: 'Introuvable' }, 404, origin);
  const hasBlob = row.ciphertext || row.blob_key;
  const dead = row.status !== 'scelle' || !hasBlob || !row.oprf_key_enc || _expired(row);
  if (dead) return _publicJson({ status: 'detruit' }, 410, origin);

  // Chiffré : inline D1, ou récupéré de R2 (audio/fichier).
  let ct = row.ciphertext;
  if (!ct && row.blob_key) {
    const obj = await env.HELP_MEDIA.get(row.blob_key);
    if (!obj) return _publicJson({ status: 'detruit' }, 410, origin);
    ct = await obj.text();
  }
  return _publicJson({ ciphertext: ct, iv: row.iv, kind: row.kind || 'text', mime: row.mime || null }, 200, origin);
}

// POST /s/:id/opened — accusé de lecture (S5). Émis par la page APRÈS un
// déchiffrement client réussi (« esprit Snap »). Sert aussi de burn happy-path :
// un secret lu une fois est consommé (status 'lu' + matériel effacé). read_at est
// posé même si déjà 'detruit' (lu au dernier essai) → distingue lecture vs interception.
// RGPD : aucune PII, juste un horodatage. Best-effort (un attaquant ne l'émet pas).
export async function handleSceauOpened(request, env, shortId) {
  const origin = getAllowedOrigin(env, request);
  const pre = await env.DB.prepare('SELECT blob_key FROM sec_secrets WHERE short_id = ?').bind(shortId).first();
  await env.DB.prepare(
    `UPDATE sec_secrets
        SET read_at = COALESCE(read_at, datetime('now')),
            status = CASE WHEN status = 'scelle' THEN 'lu' ELSE status END,
            ciphertext = NULL, blob_key = NULL, oprf_key_enc = NULL, oprf_key_iv = NULL,
            destroyed_at = COALESCE(destroyed_at, datetime('now'))
      WHERE short_id = ? AND status IN ('scelle','detruit')`
  ).bind(shortId).run();
  if (pre) await _destroyBlob(env, pre.blob_key);
  return _publicJson({ ok: true }, 200, origin);
}

// ══════════════════════════════════════════════════════════════
// JETONS RÉUTILISABLES (S4) — pointeur stable /s/t/<token_id>
// L'objet (NFC/QR) est écrit UNE fois ; on recharge le secret côté serveur.
// ══════════════════════════════════════════════════════════════

// POST /api/sceau/token — crée un jeton (pointeur stable, vide au départ).
export async function handleTokenCreate(request, env) {
  const origin = getAllowedOrigin(env, request);
  const { tenant, entitled } = await _resolveAuth(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);
  if (!entitled) return err('Missive est réservée aux formules Max pendant la beta.', 403, origin);
  const body = await parseBody(request);
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null;

  let tid = _shortId();
  for (let i = 0; i < 2; i++) {
    const clash = await env.DB.prepare('SELECT 1 FROM sec_tokens WHERE token_id = ?').bind(tid).first();
    if (!clash) break;
    tid = _shortId();
  }
  await env.DB.prepare(
    `INSERT INTO sec_tokens (token_id, tenant_id, label, created_at) VALUES (?, ?, ?, datetime('now'))`
  ).bind(tid, tenant, label).run();
  return json({ token_id: tid }, 201, origin);
}

// GET /api/sceau/token — liste des jetons + statut du secret courant.
export async function handleTokenList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);
  const { results } = await env.DB.prepare(
    `SELECT t.token_id, t.label, t.created_at, t.updated_at, t.current_short_id,
            s.status AS secret_status, s.attempts AS att, s.max_attempts AS maxa
       FROM sec_tokens t
       LEFT JOIN sec_secrets s ON s.short_id = t.current_short_id
      WHERE t.tenant_id = ?
      ORDER BY t.created_at DESC LIMIT 500`
  ).bind(tenant).all();
  const items = (results || []).map(r => {
    const active = r.secret_status === 'scelle';
    return {
      token_id: r.token_id, label: r.label, created_at: r.created_at, updated_at: r.updated_at,
      state: active ? 'actif' : 'vide',
      attempts_left: active ? Math.max(0, r.maxa - r.att) : 0,
    };
  });
  return json({ items }, 200, origin);
}

// POST /api/sceau/token/:tid/point — pointe le jeton vers un secret scellé (rechargement).
export async function handleTokenPoint(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);
  const body = await parseBody(request);
  const shortId = typeof body.short_id === 'string' ? body.short_id : '';
  if (!shortId) return err('short_id requis', 400, origin);

  const tok = await env.DB.prepare('SELECT tenant_id FROM sec_tokens WHERE token_id = ?').bind(tid).first();
  if (!tok || tok.tenant_id !== tenant) return err('Jeton introuvable', 404, origin);
  const sec = await env.DB.prepare('SELECT tenant_id, status FROM sec_secrets WHERE short_id = ?').bind(shortId).first();
  if (!sec || sec.tenant_id !== tenant) return err('Secret introuvable', 404, origin);
  if (sec.status !== 'scelle') return err('Le secret n’est pas scellé', 409, origin);

  await env.DB.prepare(
    `UPDATE sec_tokens SET current_short_id = ?, updated_at = datetime('now') WHERE token_id = ? AND tenant_id = ?`
  ).bind(shortId, tid, tenant).run();
  return json({ ok: true, token_id: tid, current_short_id: shortId }, 200, origin);
}

// DELETE /api/sceau/token/:tid — supprime le jeton + détruit le secret courant.
export async function handleTokenDelete(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const tenant = await _secTenant(request, env);
  if (!tenant) return err('Non autorisé', 401, origin);
  const tok = await env.DB.prepare('SELECT current_short_id FROM sec_tokens WHERE token_id = ? AND tenant_id = ?').bind(tid, tenant).first();
  if (!tok) return err('Jeton introuvable', 404, origin);
  if (tok.current_short_id) {
    const cur = await env.DB.prepare('SELECT blob_key FROM sec_secrets WHERE short_id = ? AND tenant_id = ?').bind(tok.current_short_id, tenant).first();
    await env.DB.prepare(
      `UPDATE sec_secrets SET ciphertext = NULL, blob_key = NULL, oprf_key_enc = NULL, oprf_key_iv = NULL,
              status = 'detruit', destroyed_at = datetime('now')
        WHERE short_id = ? AND tenant_id = ? AND status != 'detruit'`
    ).bind(tok.current_short_id, tenant).run();
    if (cur) await _destroyBlob(env, cur.blob_key);
  }
  await env.DB.prepare('DELETE FROM sec_tokens WHERE token_id = ? AND tenant_id = ?').bind(tid, tenant).run();
  return json({ ok: true }, 200, origin);
}

// ── Résolution publique : /s/t/:tid/* → secret courant ─────────
async function _resolveTokenSid(env, tid) {
  const row = await env.DB.prepare('SELECT current_short_id FROM sec_tokens WHERE token_id = ?').bind(tid).first();
  return row ? (row.current_short_id || null) : undefined; // undefined = jeton inexistant ; null = jeton vide
}
export async function handleTokenMeta(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const sid = await _resolveTokenSid(env, tid);
  if (sid === undefined) return _publicJson({ error: 'Introuvable' }, 404, origin);
  if (sid === null) return _publicJson({ status: 'vide' }, 404, origin);
  return handleSceauMeta(request, env, sid);
}
export async function handleTokenEval(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const sid = await _resolveTokenSid(env, tid);
  if (!sid) return _publicJson({ status: 'vide' }, 404, origin);
  return handleSceauEval(request, env, sid);
}
export async function handleTokenBlob(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const sid = await _resolveTokenSid(env, tid);
  if (!sid) return _publicJson({ status: 'vide' }, 404, origin);
  return handleSceauBlob(request, env, sid);
}
export async function handleTokenOpened(request, env, tid) {
  const origin = getAllowedOrigin(env, request);
  const sid = await _resolveTokenSid(env, tid);
  if (!sid) return _publicJson({ ok: true }, 200, origin);
  return handleSceauOpened(request, env, sid);
}

// ── Cron : purge des secrets expirés (branché sur le daily 0 3 * * *) ──
// ⚠ expires_at est stocké en ISO 8601 UTC (…T…Z). On NE compare PAS à
// datetime('now') de SQLite (format espacé) : lexicalement 'T' > ' ' fausserait
// le test. On binde un ISO « maintenant » → comparaison ISO↔ISO correcte.
export async function sweepExpiredSecrets(env) {
  const now = _now();
  // Objets R2 à supprimer (expirés + purgés) — récupérés AVANT les mutations.
  const toFree = await env.DB.prepare(
    `SELECT blob_key FROM sec_secrets WHERE blob_key IS NOT NULL AND (
        (status IN ('init','scelle') AND expires_at IS NOT NULL AND expires_at < ?)
        OR (status IN ('lu','detruit','expire') AND COALESCE(destroyed_at, sealed_at, created_at) < datetime('now','-1 day'))
     )`
  ).bind(now).all();
  const res = await env.DB.prepare(
    `UPDATE sec_secrets
        SET status = 'expire', ciphertext = NULL, blob_key = NULL, oprf_key_enc = NULL, oprf_key_iv = NULL,
            destroyed_at = datetime('now')
      WHERE status IN ('init','scelle') AND expires_at IS NOT NULL AND expires_at < ?`
  ).bind(now).run();
  // RGPD : purge des lignes mortes (lu/détruit/expiré) > 90 j — ne garde aucune
  // métadonnée résiduelle au-delà de la fenêtre. Le matériel sensible est déjà NULL.
  // Trace courte : un secret mort (lu/détruit/expiré) sert d'accusé de réception
  // ~24 h puis disparaît (liste propre + minimisation RGPD).
  const purge = await env.DB.prepare(
    `DELETE FROM sec_secrets
      WHERE status IN ('lu','detruit','expire')
        AND COALESCE(destroyed_at, sealed_at, created_at) < datetime('now','-1 day')`
  ).run();
  for (const r of (toFree.results || [])) await _destroyBlob(env, r.blob_key);
  return { expired: res.meta?.changes || 0, purged: purge.meta?.changes || 0, freed: (toFree.results || []).length };
}
