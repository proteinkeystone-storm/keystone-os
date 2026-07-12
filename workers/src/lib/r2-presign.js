/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — R2 presign (SigV4 query, zéro dépendance)

   URL présignées pour l'API S3 de R2 : le NAVIGATEUR parle
   directement au bucket (PUT upload / GET download), le fichier ne
   transite jamais par le Worker (brique « casier » desK, DESK_BRIEF
   §6 — posée ici une fois, réutilisable par Social Manager).

   Prérequis côté compte (sinon les routes dégradent en mode direct) :
   - un token R2 « Object Read & Write » limité au bucket
     → secrets DK_R2_ACCOUNT_ID / DK_R2_ACCESS_KEY_ID / DK_R2_SECRET_ACCESS_KEY
   - la CORS policy du bucket doit autoriser PUT/GET depuis l'app
     (AllowedOrigins = origines Keystone, AllowedMethods = GET, PUT,
      AllowedHeaders = content-type).

   ⚠ Les clés d'objet passées ici DOIVENT rester dans [A-Za-z0-9._/-]
   (déjà garanti par les routes : uuid + extension whitelistée) — on
   n'implémente pas l'encodage URI exotique du canonical path S3.
   ═══════════════════════════════════════════════════════════════ */

const enc = new TextEncoder();

async function _sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function _hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
// Encodage query façon AWS (RFC 3986 strict : ! ' ( ) * aussi encodés)
function _q(v) {
  return encodeURIComponent(v).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/* Présigne une requête R2. method 'PUT' (upload) ou 'GET' (download).
   opts.disposition : Content-Disposition renvoyé par R2 au GET
   (téléchargement avec le vrai nom de fichier). Retourne l'URL complète. */
export async function presignR2({ accountId, accessKeyId, secretAccessKey, bucket, key, method = 'GET', expires = 600, disposition = null }) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) throw new Error('Clé R2 hors charset présignable');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';   // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;

  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.max(60, Math.min(3600, expires)))],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (disposition) params.push(['response-content-disposition', disposition]);
  params.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const query = params.map(([k, v]) => `${_q(k)}=${_q(v)}`).join('&');

  const canonical = [
    method,
    `/${bucket}/${key}`,
    query,
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await _sha256Hex(canonical)].join('\n');

  let k = await _hmac(enc.encode('AWS4' + secretAccessKey), day);
  k = await _hmac(k, 'auto');
  k = await _hmac(k, 's3');
  k = await _hmac(k, 'aws4_request');
  const sig = [...await _hmac(k, toSign)].map(b => b.toString(16).padStart(2, '0')).join('');

  return `https://${host}/${bucket}/${key}?${query}&X-Amz-Signature=${sig}`;
}

// Les trois secrets + le binding sont-ils là ? (sinon : mode direct via Worker)
export function r2PresignReady(env) {
  return !!(env.DK_R2_ACCOUNT_ID && env.DK_R2_ACCESS_KEY_ID && env.DK_R2_SECRET_ACCESS_KEY);
}
