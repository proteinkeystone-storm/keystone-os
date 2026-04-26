/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Activation de Licence v1.0
   POST /api/licence/activate
   Headers : Authorization: Bearer <ADMIN_SECRET>
   Body    : { key, plan, owner, ownedAssets?, expiresAt? }
   ─────────────────────────────────────────────────────────────
   Crée ou met à jour une licence dans Vercel KV.
   Protégé par secret admin (variable d'environnement KS_ADMIN_SECRET).
   ═══════════════════════════════════════════════════════════════ */

import { kv } from '@vercel/kv';

const VALID_PLANS = ['STARTER', 'PRO', 'MAX'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.KS_ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  // ── Auth admin ────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!process.env.KS_ADMIN_SECRET || token !== process.env.KS_ADMIN_SECRET) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const { key, plan, owner, ownedAssets, expiresAt } = req.body || {};

  // ── Validation ────────────────────────────────────────────────
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Champ "key" requis' });
  }
  if (!plan || !VALID_PLANS.includes(plan.toUpperCase())) {
    return res.status(400).json({ error: `Plan invalide. Valeurs : ${VALID_PLANS.join(', ')}` });
  }
  if (!owner || typeof owner !== 'string') {
    return res.status(400).json({ error: 'Champ "owner" requis' });
  }

  const normalized = key.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    return res.status(400).json({ error: 'Format de clé invalide — attendu : XXXX-XXXX-XXXX-XXXX' });
  }

  // ── Écriture en KV ────────────────────────────────────────────
  const record = {
    plan:      plan.toUpperCase(),
    owner:     owner.trim(),
    active:    true,
    createdAt: new Date().toISOString(),
    ...(ownedAssets !== undefined && { ownedAssets }),
    ...(expiresAt   !== undefined && { expiresAt }),
  };

  try {
    await kv.set(`licence:${normalized}`, record);
    return res.status(200).json({
      success: true,
      key:     normalized,
      record,
    });
  } catch (err) {
    console.error('[KV] activate error:', err);
    return res.status(500).json({ error: 'Erreur KV — vérifiez la configuration' });
  }
}
