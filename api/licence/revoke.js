/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Révocation de Licence v1.0
   POST /api/licence/revoke
   Headers : Authorization: Bearer <ADMIN_SECRET>
   Body    : { key }
   ─────────────────────────────────────────────────────────────
   Passe active → false dans Vercel KV. Non-destructif.
   Pour supprimer définitivement, utiliser DELETE /api/licence/delete.
   ═══════════════════════════════════════════════════════════════ */

import { Redis } from '@upstash/redis';
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.KS_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  // ── Auth admin ────────────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.KS_ADMIN_SECRET || token !== process.env.KS_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { key } = req.body || {};
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Champ "key" requis' });
  }

  const normalized = key.trim().toUpperCase();

  try {
    const existing = await kv.get(`licence:${normalized}`);
    if (!existing) {
      return res.status(404).json({ error: 'Licence non trouvée' });
    }

    await kv.set(`licence:${normalized}`, {
      ...existing,
      active:    false,
      revokedAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, key: normalized });
  } catch (err) {
    console.error('[KV] revoke error:', err);
    return res.status(500).json({ error: 'Erreur KV' });
  }
}
