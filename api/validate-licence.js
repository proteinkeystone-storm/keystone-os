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
// Sprint cleanup-1 (2026-05-22) : nettoyage des 12 IDs des apps abandonnées
// (O-IMM-003, O-MKT-001/002, O-ANL-001/002, O-ADM-001, A-IMM-001/002/003,
//  A-ANL-001/002, A-ADM-001). Le catalogue ne reflète plus que ce qui est
// réellement livré (Annonces, VEFA Studio, artefacts COM).
const PLANS = {
  STARTER: {
    label: 'Starter',
    ownedAssets: [
      'O-IMM-001',   // Notices VEFA (deprecated → O-IMM-010)
      'O-IMM-002',   // Annonces Immo
      'O-IMM-010',   // VEFA Studio (Notice + Contrat fusionnés)
    ],
  },
  PRO: {
    label: 'Pro',
    ownedAssets: [
      'O-IMM-001', 'O-IMM-002', 'O-IMM-009', 'O-IMM-010',
      'A-COM-001',   // Sovereign Dynamic QR
      'A-COM-002',   // Kodex
      'A-COM-003',   // Muse
      'A-COM-004',   // Pulsa
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
    // KV actif mais clé absente → vérifie les licences démo embarquées
    return record ?? _DEMO_DB[normalizedKey] ?? null;
  } catch {
    // KV non disponible (dev local sans env vars) → fallback complet
    return _DEMO_DB[normalizedKey] ?? null;
  }
}

// ── Rate-limit léger par IP (fail-open) ────────────────────────
// 30 validations / 60 s par IP : coupe le brute-force / DoS sans
// jamais gêner un usage légitime (on valide sa clé une seule fois).
// En cas d'erreur KV → on laisse passer (jamais de blocage injuste).
async function _rateLimited(req) {
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const k  = `rl:validate:${ip}`;
    const n  = await kv.incr(k);
    if (n === 1) await kv.expire(k, 60);
    return n > 30;
  } catch {
    return false; // fail-open : ne jamais bloquer sur incident KV
  }
}

// ── Handler principal ───────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  // Garde anti-abus (fail-open) — n'affecte jamais une validation unique légitime.
  if (await _rateLimited(req)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ valid: false, error: 'Trop de tentatives, réessayez dans une minute.' });
  }

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
