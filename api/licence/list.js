/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Liste des Licences v1.0
   GET /api/licence/list[?active=true|false]
   Headers : Authorization: Bearer <ADMIN_SECRET>
   ─────────────────────────────────────────────────────────────
   Retourne toutes les licences enregistrées dans Vercel KV.
   Utilisé exclusivement par le panneau Admin.
   ═══════════════════════════════════════════════════════════════ */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.KS_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Méthode non autorisée' });

  // ── Auth admin ────────────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!process.env.KS_ADMIN_SECRET || token !== process.env.KS_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  // Filtre optionnel : ?active=true|false
  const activeFilter = req.query?.active;

  try {
    // Récupère toutes les clés du namespace licences
    const keys = await kv.keys('licence:*');

    if (keys.length === 0) {
      return res.status(200).json({ total: 0, licences: [] });
    }

    // Batch read (pipeline Redis)
    const values = await kv.mget(...keys);

    const licences = keys.map((k, i) => ({
      key:    k.replace('licence:', ''),
      ...values[i],
    }));

    // Filtrage par statut actif si demandé
    const filtered = activeFilter !== undefined
      ? licences.filter(l => String(l.active) === activeFilter)
      : licences;

    // Tri par date de création décroissante
    filtered.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt) : 0;
      const db = b.createdAt ? new Date(b.createdAt) : 0;
      return db - da;
    });

    return res.status(200).json({ total: filtered.length, licences: filtered });
  } catch (err) {
    console.error('[KV] list error:', err);
    return res.status(500).json({ error: 'Erreur KV' });
  }
}
