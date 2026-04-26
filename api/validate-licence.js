/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Validation de Licence v2.0
   POST /api/validate-licence  { key: "XXXX-XXXX-XXXX-XXXX" }
   ─────────────────────────────────────────────────────────────
   Stockage : Vercel KV (Redis)
   Fallback  : table en mémoire si KV non configuré (dev / démo)
   ─────────────────────────────────────────────────────────────
   Réponse succès :
     { valid: true, plan: string, owner: string, ownedAssets: string[] | null }
   Réponse échec :
     { valid: false, error: string }
   ═══════════════════════════════════════════════════════════════ */

import { Redis } from '@upstash/redis';

// Client Redis — lit KV_REST_API_URL + KV_REST_API_TOKEN (injectées par Upstash/Vercel)
const kv = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ── Catalogue des plans — IDs NOMEN-K canoniques ────────────────
const PLANS = {
  STARTER: {
    label: 'Starter',
    ownedAssets: [
      'O-IMM-001',   // Notices VEFA
      'O-IMM-002',   // Annonces Commerciales
      'O-IMM-003',   // Emails Acquéreurs
      'O-MKT-001',   // Posts Réseaux Sociaux
      'O-MKT-002',   // Brief Photo / 3D
    ],
  },
  PRO: {
    label: 'Pro',
    ownedAssets: [
      'O-IMM-001', 'O-IMM-002', 'O-IMM-003',
      'O-MKT-001', 'O-MKT-002',
      'O-ANL-001',   // CR Chantier
      'O-ANL-002',   // Analyste Foncier
      'O-ADM-001',   // Objections Acquéreurs
      'A-IMM-001', 'A-IMM-002', 'A-IMM-003',
    ],
  },
  MAX: {
    label: 'Max',
    ownedAssets: null, // null = accès total
  },
};

// ── Table fallback (développement / démo sans KV) ───────────────
const _DEMO_DB = {
  'DEMO-KEYS-TONE-2026': { plan: 'PRO',     owner: 'Démonstration',         active: true },
  'STAR-TERK-EYSTONE-S': { plan: 'STARTER', owner: 'Client Starter',        active: true },
  'MAXI-KEYS-TONE-FULL': { plan: 'MAX',     owner: 'Accès Total',           active: true },
};

// ── Helper : lecture KV avec fallback en mémoire ────────────────
async function _lookupLicence(normalizedKey) {
  try {
    const record = await kv.get(`licence:${normalizedKey}`);
    return record || null;
  } catch {
    // KV non disponible (dev local, env vars absentes) → fallback
    return _DEMO_DB[normalizedKey] || null;
  }
}

// ── Handler principal ───────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  const { key } = req.body || {};

  if (!key || typeof key !== 'string') {
    return res.status(400).json({ valid: false, error: 'Clé manquante' });
  }

  const normalized = key.trim().toUpperCase();

  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    return res.status(200).json({
      valid: false,
      error: 'Format invalide — attendu : XXXX-XXXX-XXXX-XXXX',
    });
  }

  const record = await _lookupLicence(normalized);

  if (!record) {
    return res.status(200).json({ valid: false, error: 'Clé de licence non reconnue' });
  }

  if (record.active === false) {
    return res.status(200).json({ valid: false, error: 'Licence révoquée ou expirée' });
  }

  const plan = PLANS[record.plan];
  if (!plan) {
    return res.status(200).json({ valid: false, error: 'Plan inconnu' });
  }

  // Si la licence a des ownedAssets personnalisés, ils priment sur le plan
  const ownedAssets = record.ownedAssets !== undefined
    ? record.ownedAssets
    : plan.ownedAssets;

  return res.status(200).json({
    valid:       true,
    plan:        plan.label,
    owner:       record.owner,
    ownedAssets,
  });
}
