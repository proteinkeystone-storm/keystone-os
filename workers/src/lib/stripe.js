/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Stripe webhook signature verifier (Sprint 5)
   ─────────────────────────────────────────────────────────────
   Implémentation pure WebCrypto (pas de SDK Node) :
   - Header : Stripe-Signature: t=TS,v1=SIG[,v1=SIG2]
   - Vérif  : HMAC-SHA256(secret, `${TS}.${rawBody}`) == SIG
   - Tolérance temporelle : 5 min (anti-replay)
   ═══════════════════════════════════════════════════════════════ */

const TOLERANCE_SEC = 5 * 60;

function _bufToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function _safeEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Vérifie la signature Stripe et parse l'event JSON.
 * @returns {object|null} l'event Stripe parsé, ou null si invalide.
 */
export async function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return null;

  // Parse `t=...,v1=...,v1=...`
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const timestamp = parts.t;
  const v1Sigs    = signatureHeader
    .split(',')
    .filter(kv => kv.startsWith('v1='))
    .map(kv => kv.slice(3));
  if (!timestamp || v1Sigs.length === 0) return null;

  // Anti-replay
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > TOLERANCE_SEC) return null;

  // HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = _bufToHex(sig);

  // Constant-time compare contre toutes les v1=
  const ok = v1Sigs.some(s => _safeEq(s, expected));
  if (!ok) return null;

  try { return JSON.parse(rawBody); } catch (_) { return null; }
}
