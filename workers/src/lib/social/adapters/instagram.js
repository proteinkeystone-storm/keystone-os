/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Adapter Instagram v1.0
   (Sprint Social-3 — IG Content Publishing API)

   Implémente le contrat SocialAdapter (cf. ../broadcast.js) via la
   Graph API (compte IG Business/Creator lié à une Page FB). État :
     - formatPost  ✅ pur (légende + hashtags + mentions légales)
     - publish     ✅ RÉEL : flux EN 2 TEMPS
                      1) POST /{ig-user-id}/media          (container : image_url R2 + caption)
                      2) attendre status_code = FINISHED   (poll borné)
                      3) POST /{ig-user-id}/media_publish  (creation_id)

   Contraintes IG (cf. registry.js) :
     - média OBLIGATOIRE (pas de post texte seul) — garanti par validateForPlatform()
     - le média DOIT être servi sur une URL publique → R2 (déjà le cas)
     - pas de lien cliquable en légende → on n'injecte pas canonical.link
     - mono-image en v1 ; carrousel (attached media) = étape ultérieure
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform } from '../registry.js';
import { fetchGraphInsights } from '../insights.js';

const PLATFORM = 'instagram';

// ── Contrat : formatPost (PUR, aucune I/O) ────────────────────
export function formatPost(canonical, platformCfg) {
  const max = platformCfg?.text?.maxLength || 2200;
  let caption = (canonical.text || '').trim();

  if (Array.isArray(canonical.hashtags) && canonical.hashtags.length) {
    const tags = canonical.hashtags.map(t => `#${t}`).join(' ');
    caption = caption ? `${caption}\n\n${tags}` : tags;
  }
  if (canonical.legal && typeof canonical.legal === 'object') {
    const legal = Object.values(canonical.legal).filter(Boolean).join(' · ');
    if (legal) caption = caption ? `${caption}\n\n${legal}` : legal;
  }
  if (caption.length > max) caption = caption.slice(0, max - 1) + '…';

  // NB : Instagram n'affiche pas de lien cliquable en légende → canonical.link ignoré.
  return { caption, media: Array.isArray(canonical.media) ? canonical.media : [] };
}

// ── Poll borné : attend que le container soit prêt à publier ──
// status_code ∈ { IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED }
async function waitForContainer(base, creationId, accessToken, { tries = 6, delayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res  = await fetch(`${base}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`);
    const data = await res.json().catch(() => ({}));
    const code = data.status_code;
    if (code === 'FINISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`Instagram container ${code}${data?.status ? ` : ${data.status}` : ''}`);
    }
    // IN_PROGRESS → on patiente (sauf au dernier tour : on tentera quand même la publication)
    if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
}

// ── Contrat : publish (RÉEL, flux 2 temps) ────────────────────
export async function publish({ account, accessToken, payload }) {
  const cfg    = getPlatform(PLATFORM);
  const base   = cfg.api.base;
  const igUser = account.external_id;            // IG user-id (Business), dérivé au provisioning
  const images = (payload.media || []).filter(m => m.type === 'image');

  if (images.length === 0) throw new Error('Instagram exige une image.');
  if (images.length > 1)   throw new Error('Instagram : carrousel multi-images = étape ultérieure.');

  // 1) Créer le container média (image servie via URL R2 + légende)
  const createRes = await fetch(`${base}/${igUser}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: images[0].url, caption: payload.caption || '', access_token: accessToken }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !created.id) {
    throw new Error(`Instagram container ${createRes.status} : ${created?.error?.message || JSON.stringify(created).slice(0, 200)}`);
  }
  const creationId = created.id;

  // 2) Attendre que le traitement du média soit terminé
  await waitForContainer(base, creationId, accessToken);

  // 3) Publier le container
  const pubRes = await fetch(`${base}/${igUser}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
  });
  const published = await pubRes.json().catch(() => ({}));
  if (!pubRes.ok || !published.id) {
    throw new Error(`Instagram publish ${pubRes.status} : ${published?.error?.message || JSON.stringify(published).slice(0, 200)}`);
  }
  const mediaId = published.id;

  // 4) Permalink (best-effort, non bloquant)
  let url;
  try {
    const permRes = await fetch(`${base}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`);
    const perm    = await permRes.json().catch(() => ({}));
    url = perm.permalink || undefined;
  } catch (_) { /* le post est publié même si le permalink échoue */ }

  return { externalId: mediaId, url };
}

// ── Objet adapter conforme au contrat SocialAdapter ───────────
// Pas de uploadMedia : l'image est déjà servie sur une URL publique (R2),
// IG va la chercher lui-même — comme Facebook.
// fetchInsights — perf du média · scope instagram_manage_insights requis côté Meta.
export async function fetchInsights({ accessToken, externalId }) {
  const cfg = getPlatform(PLATFORM);
  return fetchGraphInsights({ base: cfg.api.base, objectId: externalId, platform: PLATFORM, accessToken, label: 'Instagram' });
}

export const adapter = { platform: PLATFORM, formatPost, publish, fetchInsights };
