/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Broadcast · Adapter Telegram (Bot API) v1.0
   (Sprint Social-6 — brique Telegram)

   Implémente le contrat SocialAdapter (cf. ../broadcast.js) via la
   Bot API (api.telegram.org). Cible : un CANAL dont le bot est admin
   → le message apparaît au nom DU CANAL (le bot reste invisible).

   - formatPost  ✅ pur (texte + hashtags + mentions légales)
   - publish     ✅ texte (/sendMessage) + 1 image via URL R2 (/sendPhoto)
   - PAS d'OAuth ni d'uploadMedia : le token bot vient d'un secret et
     Telegram va chercher l'image à son URL publique (R2), comme Facebook.

   ⚠ Limites Telegram : 4096 car. en texte seul, mais 1024 en LÉGENDE
     quand il y a une photo (tronquée ici par sécurité ; le garde-fou
     côté registre/UI prévient l'utilisateur en amont).
   ═══════════════════════════════════════════════════════════════ */

import { getPlatform } from '../registry.js';

const PLATFORM = 'telegram';

// ── Contrat : formatPost (PUR, aucune I/O) ────────────────────
export function formatPost(canonical /* , platformCfg */) {
  let text = (canonical.text || '').trim();

  if (Array.isArray(canonical.hashtags) && canonical.hashtags.length) {
    const tags = canonical.hashtags.map(t => `#${t}`).join(' ');
    text = text ? `${text}\n\n${tags}` : tags;
  }
  if (canonical.legal && typeof canonical.legal === 'object') {
    const legal = Object.values(canonical.legal).filter(Boolean).join(' · ');
    if (legal) text = text ? `${text}\n\n${legal}` : legal;
  }

  return { text, media: Array.isArray(canonical.media) ? canonical.media : [] };
}

// ── Contrat : publish ─────────────────────────────────────────
// Texte → /sendMessage · 1 image → /sendPhoto (photo = URL R2).
// Album multi-images → sendMediaGroup (étape ultérieure).
export async function publish({ account, accessToken, payload }) {
  const cfg    = getPlatform(PLATFORM);
  const chatId = account.external_id;                 // @canal (public) ou id numérique
  const images = (payload.media || []).filter(m => m.type === 'image');

  if (images.length > 1) {
    throw new Error('Telegram : album multi-images = étape ultérieure (sendMediaGroup).');
  }

  let method, body;
  if (images.length === 1) {
    method = 'sendPhoto';
    body = { chat_id: chatId, photo: images[0].url, caption: (payload.text || '').slice(0, 1024) };
  } else {
    method = 'sendMessage';
    body = { chat_id: chatId, text: (payload.text || '').slice(0, 4096) };
  }

  const res  = await fetch(`${cfg.api.base}/bot${accessToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} ${res.status} : ${data?.description || JSON.stringify(data).slice(0, 200)}`);
  }

  const msg       = data.result || {};
  const messageId = msg.message_id;
  // URL t.me/<username>/<id> seulement si le canal a un @username public.
  const uname = (msg.chat && msg.chat.username)
    || (typeof chatId === 'string' && chatId.startsWith('@') ? chatId.slice(1) : null);
  const url = (uname && messageId) ? `https://t.me/${uname}/${messageId}` : undefined;

  return { externalId: messageId != null ? String(messageId) : null, url };
}

// PAS de refreshToken : un token bot @BotFather n'expire pas.
// PAS de uploadMedia : la photo est servie via URL publique (R2).

// ── Objet adapter conforme au contrat SocialAdapter ───────────
export const adapter = { platform: PLATFORM, formatPost, publish };
