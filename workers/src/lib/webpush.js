/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID)
   100 % WebCrypto → compatible Cloudflare Workers (zéro dépendance Node).
   ─────────────────────────────────────────────────────────────
   Utilisé par Keynapse (Sprint 9) pour notifier les rappels MÊME
   application fermée : le cron trouve les rappels échus et envoie une
   notification push CHIFFRÉE (le libellé est dans la charge) aux
   abonnements du propriétaire ; le service worker l'affiche directement.

   La crypto (chiffrement de charge) est VÉRIFIÉE contre le vecteur de
   test officiel de la RFC 8291 §5 (voir scripts/test-webpush.mjs) :
   encryptPayload(...) avec les entrées fixes de la RFC reproduit au bit
   près le corps chiffré attendu. Ne pas modifier sans relancer ce test.
   ═══════════════════════════════════════════════════════════════ */

const _enc = new TextEncoder();

function _b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _bytesToB64url(u) {
  let bin = '';
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _concat(...arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const o = new Uint8Array(n); let off = 0;
  for (const a of arrs) { o.set(a, off); off += a.length; }
  return o;
}

// HKDF (Extract+Expand en un appel WebCrypto).
async function _hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

// Un point public EC brut (0x04||x||y, 65 octets) → JWK {x,y}.
function _rawPubToXY(raw) {
  const x = _bytesToB64url(raw.slice(1, 33));
  const y = _bytesToB64url(raw.slice(33, 65));
  return { x, y };
}

// ── Chiffrement de la charge (RFC 8291 / contenu aes128gcm RFC 8188) ──
// plaintext : Uint8Array ; sub : { p256dh, auth } (base64url du client).
// opts (TEST uniquement) : { asPrivateD, asPublicB64, saltB64 } pour
// injecter les valeurs fixes du vecteur RFC ; en prod tout est aléatoire.
// Retourne le CORPS chiffré (Uint8Array) prêt à POSTer.
export async function encryptPayload(plaintext, sub, opts = {}) {
  const uaPublic   = _b64urlToBytes(sub.p256dh);   // 65 octets
  const authSecret = _b64urlToBytes(sub.auth);     // 16 octets

  // Paire éphémère « application server » (fixe en test, aléatoire en prod).
  let asPrivKey, asPublic;
  if (opts.asPrivateD && opts.asPublicB64) {
    asPublic = _b64urlToBytes(opts.asPublicB64);
    const xy = _rawPubToXY(asPublic);
    asPrivKey = await crypto.subtle.importKey('jwk',
      { kty: 'EC', crv: 'P-256', d: opts.asPrivateD, x: xy.x, y: xy.y, ext: true },
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivKey = kp.privateKey;
    asPublic  = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));  // 65 octets
  }

  const uaPubKey   = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asPrivKey, 256));

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info"||0x00||ua_public||as_public, 32)
  const keyInfo = _concat(_enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await _hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt  = opts.saltB64 ? _b64urlToBytes(opts.saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const cek   = await _hkdf(salt, ikm, _concat(_enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await _hkdf(salt, ikm, _concat(_enc.encode('Content-Encoding: nonce'),     new Uint8Array([0])), 12);

  // Un seul enregistrement : plaintext || 0x02 (délimiteur dernier enregistrement).
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = _concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  // En-tête RFC 8188 : salt(16) || rs(4, BE) || idlen(1) || keyid(as_public, 65).
  const rs    = new Uint8Array([0, 0, 0x10, 0]);            // 4096
  const idlen = new Uint8Array([asPublic.length]);          // 65 (0x41)
  return _concat(salt, rs, idlen, asPublic, ct);
}

// ── En-tête VAPID (RFC 8292) : JWT ES256 signé par la clé privée serveur ──
// vapidPrivateJwk : JWK EC P-256 (avec d). vapidPublicB64 : clé publique
// brute base64url (0x04||x||y). sub : "mailto:contact".
export async function vapidAuthHeader(endpoint, vapidPublicB64, vapidPrivateJwk, sub) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const head = _bytesToB64url(_enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp  = Math.floor(Date.now() / 1000) + 12 * 3600;
  const body = _bytesToB64url(_enc.encode(JSON.stringify({ aud, exp, sub })));
  const signingInput = `${head}.${body}`;
  const key = await crypto.subtle.importKey('jwk', vapidPrivateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto ECDSA renvoie déjà la signature au format IEEE P-1363 (r||s) = ce qu'attend JWT ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, _enc.encode(signingInput)));
  const jwt = `${signingInput}.${_bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${vapidPublicB64}`;
}

// ── Envoi d'une notification push à UN abonnement ─────────────────
// sub : { endpoint, p256dh, auth }. payloadObj : objet JSON (chiffré dans
// la charge). vapid : { publicKey, privateJwk, subject }.
// Retourne le code HTTP : 201 = OK ; 404/410 = abonnement périmé (à purger).
export async function sendPush(sub, payloadObj, vapid) {
  const body = await encryptPayload(_enc.encode(JSON.stringify(payloadObj)), sub);
  const auth = await vapidAuthHeader(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject || 'mailto:contact@protein-keystone.com');
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body,
  });
  return res.status;
}
