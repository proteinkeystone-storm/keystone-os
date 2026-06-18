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
export async function publish({ account, accessToken, payload, prior }) {
  const cfg    = getPlatform(PLATFORM);
  const base   = cfg.api.base;
  const user   = account.external_id;            // Threads user-id (dérivé au provision)
  const images = (payload.media || []).filter(m => m.type === 'image');
  const videos = (payload.media || []).filter(m => m.type === 'video');

  // Vidéo — asynchrone : créée au 1er passage, publiée par le cron une fois le
  // traitement terminé (cf. broadcast.publishOne + social.sweepDuePosts).
  if (videos.length >= 1) {
    return publishVideoStep({ base, user, accessToken, videoUrl: videos[0].url, text: payload.text || '', prior });
  }

  // 1) Container à publier — carrousel (>1) · image · ou texte seul.
  let creationId;
  if (images.length > 1) {
    // Carrousel : 1 conteneur enfant IMAGE par photo (is_carousel_item) → 1 conteneur CAROUSEL.
    const childIds = [];
    for (const img of images) {
      const cRes = await fetch(`${base}/${user}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'IMAGE', image_url: img.url, is_carousel_item: true, access_token: accessToken }),
      });
      const c = await cRes.json().catch(() => ({}));
      if (!cRes.ok || !c.id) {
        throw new Error(`Threads item ${cRes.status} : ${c?.error?.message || JSON.stringify(c).slice(0, 200)}`);
      }
      childIds.push(c.id);
    }
    const carRes = await fetch(`${base}/${user}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'CAROUSEL', children: childIds.join(','), text: payload.text || '', access_token: accessToken }),
    });
    const car = await carRes.json().catch(() => ({}));
    if (!carRes.ok || !car.id) {
      throw new Error(`Threads carousel ${carRes.status} : ${car?.error?.message || JSON.stringify(car).slice(0, 200)}`);
    }
    creationId = car.id;
    await waitForContainer(base, creationId, accessToken);
  } else {
    // IMAGE si une photo, sinon TEXT (texte seul OK sur Threads)
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
    creationId = created.id;
    if (images.length === 1) await waitForContainer(base, creationId, accessToken);
  }

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

// ── Vidéo en 2 temps — orchestrée par le cron ─────────────────
// status (+ détail d'erreur) d'un conteneur, en 1 lecture NON bloquante (≠ waitForContainer).
async function fetchContainerStatus(base, creationId, accessToken) {
  const res  = await fetch(`${base}/${creationId}?fields=status,error_message&access_token=${encodeURIComponent(accessToken)}`);
  const data = await res.json().catch(() => ({}));
  return { code: data.status, detail: data.error_message };   // code ∈ IN_PROGRESS|FINISHED|ERROR|EXPIRED|PUBLISHED
}

// 1er appel (sans prior.creationId) : crée le conteneur VIDEO → { processing, creationId }.
// Appels suivants (le cron repasse) : poll UNE fois ; FINISHED → threads_publish ;
// encore en cours → reste 'processing' ; ERROR/EXPIRED → throw.
async function publishVideoStep({ base, user, accessToken, videoUrl, text, prior }) {
  if (!prior?.creationId) {
    const createRes = await fetch(`${base}/${user}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'VIDEO', video_url: videoUrl, text, access_token: accessToken }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !created.id) {
      throw new Error(`Threads vidéo ${createRes.status} : ${created?.error?.message || JSON.stringify(created).slice(0, 200)}`);
    }
    return { status: 'processing', creationId: created.id };
  }

  const { code, detail } = await fetchContainerStatus(base, prior.creationId, accessToken);
  if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Threads conteneur vidéo ${code}${detail ? ` : ${detail}` : ''}`);
  if (code !== 'FINISHED' && code !== 'PUBLISHED') return { status: 'processing', creationId: prior.creationId };

  const pubRes = await fetch(`${base}/${user}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: prior.creationId, access_token: accessToken }),
  });
  const published = await pubRes.json().catch(() => ({}));
  if (!pubRes.ok || !published.id) {
    throw new Error(`Threads publish vidéo ${pubRes.status} : ${published?.error?.message || JSON.stringify(published).slice(0, 200)}`);
  }
  const mediaId = published.id;
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
