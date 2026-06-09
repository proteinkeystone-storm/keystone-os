/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Adapter Threads v1.0
   (Sprint Social-4 — Threads API)

   Implémente le contrat SocialAdapter (cf. ../broadcast.js) via l'API
   Threads (graph.threads.net). Flux EN 2 TEMPS, comme Instagram :
     1) POST /{user-id}/threads          (container : media_type TEXT|IMAGE)
     2) (image) attendre status=FINISHED (poll borné ~30 s recommandés)
     3) POST /{user-id}/threads_publish  (creation_id)

   Specs : https://developers.facebook.com/docs/threads/posts
   Différences avec IG :
     - host graph.threads.net/v1.0 (pas graph.facebook.com)
     - paramètre `text` (et non `caption`)
     - TEXTE SEUL supporté (media_type=TEXT) → média NON obligatoire
     - token propre (OAuth Threads, 60 j) — géré par le provision, pas ici
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform } from '../registry.js';
import { fetchGraphInsights } from '../insights.js';

const PLATFORM = 'threads';

// ── Contrat : formatPost (PUR, aucune I/O) ────────────────────
export function formatPost(canonical, platformCfg) {
  const max = platformCfg?.text?.maxLength || 500;
  let text = (canonical.text || '').trim();

  if (Array.isArray(canonical.hashtags) && canonical.hashtags.length) {
    const tags = canonical.hashtags.map(t => `#${t}`).join(' ');
    text = text ? `${text}\n\n${tags}` : tags;
  }
  if (canonical.legal && typeof canonical.legal === 'object') {
    const legal = Object.values(canonical.legal).filter(Boolean).join(' · ');
    if (legal) text = text ? `${text}\n\n${legal}` : legal;
  }
  if (text.length > max) text = text.slice(0, max - 1) + '…';

  return { text, media: Array.isArray(canonical.media) ? canonical.media : [] };
}

// ── Poll borné : attend que le container image soit prêt ──────
// status ∈ { IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED }
async function waitForContainer(base, creationId, accessToken, { tries = 10, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res  = await fetch(`${base}/${creationId}?fields=status&access_token=${encodeURIComponent(accessToken)}`);
    const data = await res.json().catch(() => ({}));
    const code = data.status;
    if (code === 'FINISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Threads container ${code}`);
    if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
}

// ── Contrat : publish (RÉEL, flux 2 temps) ────────────────────
export async function publish({ account, accessToken, payload }) {
  const cfg    = getPlatform(PLATFORM);
  const base   = cfg.api.base;
  const user   = account.external_id;            // Threads user-id (dérivé au provision)
  const images = (payload.media || []).filter(m => m.type === 'image');

  if (images.length > 1) throw new Error('Threads : carrousel multi-images = étape ultérieure.');

  // 1) Container — IMAGE si une photo, sinon TEXT (texte seul OK sur Threads)
  const body = images.length === 1
    ? { media_type: 'IMAGE', image_url: images[0].url, text: payload.text || '', access_token: accessToken }
    : { media_type: 'TEXT',  text: payload.text || '', access_token: accessToken };

  const createRes = await fetch(`${base}/${user}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.id) {
    throw new Error(`Threads container ${createRes.status} : ${created?.error?.message || JSON.stringify(created).slice(0, 200)}`);
  }
  const creationId = created.id;

  // 2) Attendre le traitement (surtout pour l'image ; texte ≈ instantané)
  if (images.length === 1) await waitForContainer(base, creationId, accessToken);

  // 3) Publier le container
  const pubRes = await fetch(`${base}/${user}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const published = await pubRes.json().catch(() => ({}));
  if (!pubRes.ok || !published.id) {
    throw new Error(`Threads publish ${pubRes.status} : ${published?.error?.message || JSON.stringify(published).slice(0, 200)}`);
  }
  const mediaId = published.id;

  // 4) Permalink (best-effort, non bloquant)
  let url;
  try {
    const permRes = await fetch(`${base}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`);
    const perm    = await permRes.json().catch(() => ({}));
    url = perm.permalink || undefined;
  } catch (_) { /* publié même si le permalink échoue */ }

  return { externalId: mediaId, url };
}

// ── Objet adapter conforme au contrat SocialAdapter ───────────
// fetchInsights — perf du thread · scope threads_manage_insights requis côté Meta.
export async function fetchInsights({ accessToken, externalId }) {
  const cfg = getPlatform(PLATFORM);
  return fetchGraphInsights({ base: cfg.api.base, objectId: externalId, platform: PLATFORM, accessToken, label: 'Threads' });
}

export const adapter = { platform: PLATFORM, formatPost, publish, fetchInsights };
