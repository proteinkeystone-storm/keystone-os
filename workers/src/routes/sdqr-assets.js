// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Assets statiques des Smart QR (auto-hébergés)
// ───────────────────────────────────────────────────────────────────
// Sert le moteur d'animation Lottie (lottie-web, MIT) + les animations
// vectorielles utilisées par les interstitiels, depuis la MÊME origine
// que l'interstitiel (le Worker). Avantages : zéro requête tierce au
// scan (respect vie privée), chemins relatifs, cache long immuable.
//
// Stockés en base64 (byte-exact, aucune dépendance de bundler) dans des
// modules dédiés, décodés à la volée. Réponses cache-ables → l'edge
// Cloudflare + le navigateur les gardent (décodage quasi jamais refait).
// ══════════════════════════════════════════════════════════════════

import { LOTTIE_PLAYER_B64 }   from './smart-templates/_lottie-player.js';
import { GIFT_BOX_LOTTIE_B64 } from './smart-templates/_gift-box-lottie.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function asset(bytes, contentType) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type':                contentType,
      'Cache-Control':               IMMUTABLE,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options':      'nosniff',
    },
  });
}

// GET /sdqr-assets/<file> — dispatch statique (liste blanche stricte).
export function handleSdqrAsset(path) {
  if (path === '/sdqr-assets/lottie.min.js') {
    return asset(b64ToBytes(LOTTIE_PLAYER_B64), 'application/javascript; charset=utf-8');
  }
  if (path === '/sdqr-assets/gift-box.json') {
    return asset(b64ToBytes(GIFT_BOX_LOTTIE_B64), 'application/json; charset=utf-8');
  }
  return new Response('Not Found', { status: 404 });
}
