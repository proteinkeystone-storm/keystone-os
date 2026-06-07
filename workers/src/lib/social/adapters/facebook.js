/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Adapter Facebook Page v1.0
   (Sprint Social-0 / Plan B — spike Meta avant LinkedIn)

   Implémente le contrat SocialAdapter (cf. ../broadcast.js) via la
   Graph API. État :
     - formatPost  ✅ pur (texte + hashtags + mentions légales)
     - publish     ✅ RÉEL : texte (/feed) + 1 image via URL R2 (/photos)
     - OAuth       ✅ buildAuthUrl / exchangeCodeForToken / listPages

   Note médias : Facebook va chercher l'image à son URL publique — donc
   R2 suffit, pas d'upload binaire (pas de uploadMedia nécessaire).
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform } from '../registry.js';

const PLATFORM = 'facebook';

// ── Contrat : formatPost (PUR, aucune I/O) ────────────────────
export function formatPost(canonical, platformCfg) {
  const max = platformCfg?.text?.maxLength || 63206;
  let message = (canonical.text || '').trim();

  if (Array.isArray(canonical.hashtags) && canonical.hashtags.length) {
    const tags = canonical.hashtags.map(t => `#${t}`).join(' ');
    message = message ? `${message}\n\n${tags}` : tags;
  }
  if (canonical.legal && typeof canonical.legal === 'object') {
    const legal = Object.values(canonical.legal).filter(Boolean).join(' · ');
    if (legal) message = message ? `${message}\n\n${legal}` : legal;
  }
  if (message.length > max) message = message.slice(0, max - 1) + '…';

  return { message, media: Array.isArray(canonical.media) ? canonical.media : [] };
}

// ── Contrat : publish ─────────────────────────────────────────
// Texte → /{page-id}/feed · 1 image → /{page-id}/photos (URL R2).
// Multi-images → Sprint Social-1 (attached_media).
export async function publish({ account, accessToken, payload }) {
  const cfg    = getPlatform(PLATFORM);
  const pageId = account.external_id;
  const images = (payload.media || []).filter(m => m.type === 'image');

  if (images.length > 1) {
    throw new Error('Facebook : multi-images = Sprint Social-1.');
  }

  let endpoint, body;
  if (images.length === 1) {
    endpoint = `${cfg.api.base}/${pageId}/photos`;
    body = { url: images[0].url, caption: payload.message, access_token: accessToken };
  } else {
    endpoint = `${cfg.api.base}/${pageId}/feed`;
    body = { message: payload.message, access_token: accessToken };
  }

  const res  = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Facebook publish ${res.status} : ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }

  // /feed → { id: "PAGEID_POSTID" } · /photos → { id, post_id }
  const externalId = data.post_id || data.id || null;
  const url = externalId ? `https://www.facebook.com/${externalId}` : undefined;
  return { externalId, url };
}

// ── OAuth — utilisés par la future route /api/social/facebook/* ──
export function buildAuthUrl({ clientId, redirectUri, state }) {
  const cfg    = getPlatform(PLATFORM);
  const scopes = cfg.auth.scopes.page.join(',');
  const u = new URL(cfg.auth.authUrl);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', scopes);
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

// code → user token court → user token longue durée (≈60 j)
export async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const cfg = getPlatform(PLATFORM);

  // 1) code → short-lived user token
  const shortRes = await fetch(`${cfg.auth.tokenUrl}?` + new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code,
  }));
  const short = await shortRes.json();
  if (!shortRes.ok) throw new Error(`Facebook token ${shortRes.status} : ${short?.error?.message || ''}`);

  // 2) short → long-lived user token
  const longRes = await fetch(`${cfg.auth.tokenUrl}?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret,
    fb_exchange_token: short.access_token,
  }));
  const long = await longRes.json();

  return {
    userToken:    long.access_token || short.access_token,
    expiresInSec: long.expires_in || short.expires_in || null,
  };
}

// Liste les Pages administrées + leur Page token (non-expirant si user token longue durée).
// La route /connect présentera ces pages ; on stocke {external_id: page.id, access: pageToken}.
export async function listPages({ userToken }) {
  const cfg = getPlatform(PLATFORM);
  const res = await fetch(`${cfg.api.base}/me/accounts?` + new URLSearchParams({
    fields: 'id,name,access_token', access_token: userToken,
  }));
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook /me/accounts ${res.status} : ${data?.error?.message || ''}`);
  return (data.data || []).map(p => ({ id: p.id, name: p.name, pageToken: p.access_token }));
}

// ── Objet adapter conforme au contrat SocialAdapter ───────────
export const adapter = { platform: PLATFORM, formatPost, publish };
