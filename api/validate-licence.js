/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Vercel Function · Validation de Licence v1.0
   POST /api/validate-licence  { key: "XXXX-XXXX-XXXX-XXXX" }
   ─────────────────────────────────────────────────────────────
   En production : brancher sur Stripe Entitlements, LemonSqueezy,
   ou votre propre base de données de licences.
   ─────────────────────────────────────────────────────────────
   Réponse succès :
     { valid: true, plan: string, owner: string, ownedAssets: string[] }
   Réponse échec :
     { valid: false, error: string }
   ═══════════════════════════════════════════════════════════════ */

// ── Catalogue des plans ─────────────────────────────────────────
const PLANS = {
  STARTER: {
    label: 'Starter',
    ownedAssets: ['O-IMM-001', 'O-IMM-002', 'O-MKT-001'],
  },
  PRO: {
    label: 'Pro',
    ownedAssets: [
      'O-IMM-001', 'O-IMM-002', 'O-IMM-003', 'O-IMM-004',
      'O-IMM-005', 'O-IMM-006',
      'O-MKT-001', 'O-MKT-002',
      'O-ANL-001', 'O-ANL-002',
      'O-ADM-001',
      'A-IMM-001', 'A-IMM-002', 'A-IMM-003',
    ],
  },
  ENTERPRISE: {
    label: 'Enterprise',
    ownedAssets: null, // null = accès total (mode démo)
  },
};

// ── Table de licences (à remplacer par appel BDD en production) ─
// Format : 'CLE-EN-CLAIR' → { plan, owner }
const LICENCE_DB = {
  // Licences de test / démo
  'DEMO-KEYS-TONE-2026': { plan: 'PRO',        owner: 'Démonstration' },
  'PROM-ETHE-IMMO-2026': { plan: 'PRO',        owner: 'Prométhée Immobilier' },
  'STAR-TERK-EYSTONE-S': { plan: 'STARTER',    owner: 'Client Starter' },
  'ENTR-PRISE-FULL-ACC': { plan: 'ENTERPRISE', owner: 'Accès Total' },
};

export default function handler(req, res) {
  // CORS pour les appels depuis Vercel Preview
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  const { key } = req.body || {};

  // ── Validation du format ────────────────────────────────────
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

  // ── Lookup dans la base ─────────────────────────────────────
  const record = LICENCE_DB[normalized];
  if (!record) {
    return res.status(200).json({
      valid: false,
      error: 'Clé de licence non reconnue',
    });
  }

  const plan = PLANS[record.plan];

  return res.status(200).json({
    valid:       true,
    plan:        plan.label,
    owner:       record.owner,
    ownedAssets: plan.ownedAssets, // null = Enterprise (tout accessible)
  });
}
