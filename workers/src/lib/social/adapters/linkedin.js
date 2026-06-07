/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Adapter LinkedIn v1.0
   (Sprint Social-0 — Socle d'extensibilité)

   Implémente le contrat SocialAdapter (cf. ../broadcast.js).
   État Sprint-0 :
     - formatPost  ✅ pur (texte + hashtags + mentions légales)
     - publish     ✅ RÉEL pour un post TEXTE seul (REST Posts API)
     - uploadMedia ⏳ Sprint Social-1 (register-upload images)
     - OAuth       ✅ buildAuthUrl / exchangeCodeForToken / refreshToken
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform } from '../registry.js';

const PLATFORM = 'linkedin';

// ── Contrat : formatPost (PUR, aucune I/O) ────────────────────
export function formatPost(canonical, platformCfg) {
  const max = platformCfg?.text?.maxLength || 3000;
  let commentary = (canonical.text || '').trim();

  // LinkedIn n'a pas de 1er commentaire via API → hashtags en fin de légende.
  if (Array.isArray(canonical.hashtags) && canonical.hashtags.length) {
    const tags = canonical.hashtags.map(t => `#${t}`).join(' ');
    commentary = commentary ? `${commentary}\n\n${tags}` : tags;
  }
  // Mentions légales immo éventuelles (DPE, honoraires…) en pied de post.
  if (canonical.legal && typeof canonical.legal === 'object') {
    const legal = Object.values(canonical.legal).filter(Boolean).join(' · ');
    if (legal) commentary = commentary ? `${commentary}\n\n${legal}` : legal;
  }
  if (commentary.length > max) commentary = commentary.slice(0, max - 1) + '…';

  return {
    commentary,
    media: Array.isArray(canonical.media) ? canonical.media : [],
    visibility: 'PUBLIC',
  };
}

// ── Contrat : uploadMedia (Sprint Social-1) ───────────────────
export async function uploadMedia(/* { account, accessToken, media, env } */) {
  // LinkedIn : POST /rest/images?action=initializeUpload → PUT binaire → URN image.
  // Le spike Sprint-0 cible le texte seul ; les médias arrivent au Sprint Social-1.
  throw new Error('LinkedIn uploadMedia : non implémenté (Sprint Social-1 — médias).');
}

// ── Contrat : publish ─────────────────────────────────────────
// RÉEL pour un post TEXTE seul. Médias → Sprint Social-1.
export async function publish({ account, accessToken, payload }) {
  if (payload.media && payload.media.length > 0) {
    throw new Error('LinkedIn : publication avec média = Sprint Social-1.');
  }
  const cfg    = getPlatform(PLATFORM);
  const author = authorUrn(account);

  const res = await fetch(`${cfg.api.base}${cfg.api.publishPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      [cfg.api.versionHeader]: cfg.api.version,
    },
    body: JSON.stringify({
      author,
      commentary: payload.commentary,
      visibility: payload.visibility || 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LinkedIn publish ${res.status} : ${body.slice(0, 300)}`);
  }
  // L'id du post créé est renvoyé en en-tête.
  const externalId = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || null;
  const url = externalId ? `https://www.linkedin.com/feed/update/${externalId}/` : undefined;
  return { externalId, url };
}

// ── OAuth — utilisés par la future route /api/social/linkedin/* ──
export function buildAuthUrl({ clientId, redirectUri, state, target = 'profile' }) {
  const cfg    = getPlatform(PLATFORM);
  const scopes = (cfg.auth.scopes[target] || cfg.auth.scopes.profile).join(' ');
  const u = new URL(cfg.auth.authUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('scope', scopes);
  return u.toString();
}

export async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const cfg = getPlatform(PLATFORM);
  const res = await fetch(cfg.auth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn token ${res.status} : ${await res.text().catch(() => '')}`);
  const tok = await res.json();

  // Identité du membre via OpenID userinfo → URN auteur (urn:li:person:<sub>).
  let externalId = null, displayName = null;
  try {
    const ui = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tok.access_token}` },
    });
    if (ui.ok) {
      const info = await ui.json();
      if (info.sub) externalId = `urn:li:person:${info.sub}`;
      displayName = info.name || null;
    }
  } catch (_) { /* non bloquant : l'URN pourra être complété ensuite */ }

  return {
    accessToken:  tok.access_token,
    refreshToken: tok.refresh_token || null,
    expiresInSec: tok.expires_in || null,
    externalId,
    displayName,
  };
}

export async function refreshToken({ refreshToken: rt, clientId, clientSecret }) {
  const cfg = getPlatform(PLATFORM);
  const res = await fetch(cfg.auth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: rt, client_id: clientId, client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn refresh ${res.status}`);
  const tok = await res.json();
  return {
    accessToken:  tok.access_token,
    refreshToken: tok.refresh_token || rt,
    expiresInSec: tok.expires_in || null,
  };
}

function authorUrn(account) {
  // external_id stocke déjà l'URN complet (urn:li:person:… ou urn:li:organization:…)
  if (account?.external_id?.startsWith('urn:')) return account.external_id;
  const id = account?.external_id || '';
  return account?.target_type === 'organization'
    ? `urn:li:organization:${id}`
    : `urn:li:person:${id}`;
}

// ── Objet adapter conforme au contrat SocialAdapter ───────────
export const adapter = { platform: PLATFORM, formatPost, uploadMedia, publish, refreshToken };
