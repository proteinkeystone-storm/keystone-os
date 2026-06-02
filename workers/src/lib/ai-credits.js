/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Crédits IA unifiés (Chantier B · Sprint 1)
   Layer 2 · Compteur de consommation IA par licence, mensuel.
   ─────────────────────────────────────────────────────────────
   POURQUOI cette lib
   ─────────────────────────────────────────────────────────────
   Avant : seul Ghost Writer avait un cap (par JOUR, cf ghostwriter.js).
   Brainstorming, Concierge public, Living Layer = aucun cap.
   Ici : une SEULE monnaie « crédits IA » (jamais « neurones » côté
   client), un SEUL portefeuille fongible par licence, consommé par
   tous les outils IA selon un barème (COST). Quota mensuel inclus
   par plan + solde de packs achetés (Stripe, Sprint 5).

   MODÈLE — portefeuille unique, double seau
   ─────────────────────────────────────────────────────────────
   - ai_usage(bucket_key, month, tool, used) : consommation du MOIS,
     ventilée par outil (→ double jauge d'affichage gratuite :
     « dont X par le Concierge »). Reset implicite par changement de
     clé `month` (YYYY-MM). PK (bucket_key, month, tool).
   - ai_credit_balance(bucket_key, balance) : solde de PACKS, PERSISTANT
     (ne se reset jamais — le client l'a payé). Rechargé par le webhook
     Stripe en Sprint 5.

   Règle de consommation (consumeCredits) :
     plafond du mois = quota inclus (du plan) + solde de packs.
     On pioche d'abord dans l'inclus ; au-delà, on entame les packs
     (et on décrémente leur solde). Plafond dépassé → blocage (429),
     l'UI invite à acheter un pack ou attendre le 1er du mois.

   CLÉ DU PORTEFEUILLE (bucket_key)
   ─────────────────────────────────────────────────────────────
   - Outils internes (GW, Brainstorming) : claims.sub du JWT
     (= lookup_hmac de la licence de l'utilisateur connecté).
   - Concierge PUBLIC (visiteur anonyme, pas de JWT) : tenant_id du QR
     (= lookup_hmac de la licence PROPRIÉTAIRE du QR), résolu côté
     serveur depuis l'entité. Voir resolvePlanByHmac().
   bucket_key est donc toujours un lookup_hmac, peu importe la source.

   FLAG DORMANT — enforce_ai_credits_v1 (par licence, défaut 0)
   ─────────────────────────────────────────────────────────────
   Tant que le flag n'est pas posé à 1 sur une licence, AUCUN
   enforcement : les routes appellent isEnforceEnabled() et retombent
   sur le comportement legacy (illimité). Zéro régression sur le test
   pricing live et les licences actives. À activer licence par licence
   pour tester (ex : la licence MAX de Prométhée), via l'admin S5.

   Atomicité : pre-bump UPSERT du compteur `used` PUIS revert si refus
   (même pattern que ghostwriter_usage). Le décrément du solde de packs
   est best-effort (le coût en crédits est minime — anti-abus, pas un
   coffre-fort financier).
   ═══════════════════════════════════════════════════════════════ */

// ── Grille des quotas INCLUS par plan, PAR MOIS ──────────────────
// Source de vérité unique (le frontend la lit via /api/ai-credits/quota,
// rien de hardcodé côté client). null = illimité (ADMIN).
// Volontairement GÉNÉREUX : le coût IA réel = des centimes (cf
// pricing_keystone.md). Le quota est un anti-abus + signal d'upsell de
// PLAN, pas un centre de coût. « Quotas généreux, zéro anxiété client. »
//   Démo 20 · Start 200 · Pro 1 000 · Max 5 000 · Admin ∞
function quotaForPlan(plan) {
  const p = (plan || '').toUpperCase();
  if (p === 'DEMO')    return 20;
  if (p === 'STARTER') return 200;
  if (p === 'PRO')     return 1000;
  if (p === 'MAX')     return 5000;
  if (p === 'ADMIN')   return null;   // illimité
  return 0;  // plan inconnu → 0 inclus (fail-mostly-closed ; les packs
             // éventuels restent honorés via le solde persistant).
}

// ── Barème : combien de crédits coûte une action de chaque outil ─
// GW = 1 (1 réécriture = 3 variantes). Brainstorming = 1 PAR APPEL
// (décision Stéphane 2026-06-02 « au compteur, par round ») : chaque
// tour de table (/agent-respond, même en mode auto multi-agents) +
// chaque synthèse = 1 crédit → une session ≈ 4-6 crédits, proportionnel
// à la longueur du débat. Concierge = 1 par question visiteur.
// Living Layer & Smart QR = 0 (ambiant / IA retirée le 30/05).
// Outil inconnu → 1 par défaut (jamais gratuit par accident).
const COST = {
  ghostwriter:   1,
  brainstorming: 1,
  concierge:     1,
  livinglayer:   0,
};
function costFor(tool) {
  const c = COST[String(tool || '').toLowerCase()];
  return Number.isInteger(c) ? c : 1;
}

// Mois UTC « YYYY-MM ». UTC côté serveur (comme _todayUtc de
// ghostwriter) : sinon le reset mensuel tomberait à des heures
// différentes selon le fuseau d'exécution du Worker.
function currentMonthUtc() {
  return new Date().toISOString().slice(0, 7);
}

// ── Auto-migration idempotente (pattern Keystone, cf ghostwriter.js
//    et vault-user.js). Tables + flag dormant sur licences. ────────
let _schemaReady = false;
async function ensureAiCreditsSchema(env) {
  if (_schemaReady) return;
  const safe = async (sql) => {
    try { await env.DB.prepare(sql).run(); } catch (_) { /* déjà créé : OK */ }
  };
  // Consommation mensuelle, ventilée par outil.
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      bucket_key  TEXT NOT NULL,
      month       TEXT NOT NULL,
      tool        TEXT NOT NULL,
      used        INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (bucket_key, month, tool)
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_ai_usage_bucket_month ON ai_usage(bucket_key, month)');
  // Solde de packs persistant (rechargé par Stripe en Sprint 5).
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_credit_balance (
      bucket_key  TEXT NOT NULL PRIMARY KEY,
      balance     INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Flag dormant par licence (SQLite n'a pas ADD COLUMN IF NOT EXISTS).
  await safe('ALTER TABLE licences ADD COLUMN enforce_ai_credits_v1 INTEGER DEFAULT 0');
  _schemaReady = true;
}

// ── Lectures ─────────────────────────────────────────────────────
// Total consommé ce mois (somme tous outils).
async function readMonthUsed(env, bucketKey) {
  const row = await env.DB
    .prepare('SELECT COALESCE(SUM(used), 0) AS total FROM ai_usage WHERE bucket_key = ? AND month = ?')
    .bind(bucketKey, currentMonthUtc())
    .first();
  return row?.total ?? 0;
}
// Ventilation par outil ce mois → { concierge: 1600, brainstorming: 9, ... }
async function readMonthBreakdown(env, bucketKey) {
  const out = {};
  const res = await env.DB
    .prepare('SELECT tool, used FROM ai_usage WHERE bucket_key = ? AND month = ?')
    .bind(bucketKey, currentMonthUtc())
    .all();
  for (const r of (res?.results || [])) out[r.tool] = r.used;
  return out;
}
// Solde de packs persistant (0 si pas de ligne).
async function readPackBalance(env, bucketKey) {
  const row = await env.DB
    .prepare('SELECT balance FROM ai_credit_balance WHERE bucket_key = ?')
    .bind(bucketKey)
    .first();
  return row?.balance ?? 0;
}

// ── Flag dormant : l'enforcement est-il actif pour cette licence ? ─
// Lookup par lookup_hmac (= bucket_key). Tout échec / absence de ligne
// (ex : QR du tenant 'default' sans licence) → false = legacy/illimité.
async function isEnforceEnabled(env, lookupHmac) {
  if (!lookupHmac) return false;
  try {
    const row = await env.DB
      .prepare('SELECT enforce_ai_credits_v1 AS flag FROM licences WHERE lookup_hmac = ? LIMIT 1')
      .bind(lookupHmac)
      .first();
    return !!(row && row.flag === 1);
  } catch (_) {
    return false;
  }
}

// ── Résolution du plan d'une licence par son lookup_hmac ──────────
// Utilisé par le Concierge public : le visiteur n'a pas de JWT, on
// résout le plan du PROPRIÉTAIRE du QR (tenant_id = lookup_hmac).
// Retourne le plan (string) ou null si licence introuvable/inactive.
async function resolvePlanByHmac(env, lookupHmac) {
  if (!lookupHmac) return null;
  try {
    const row = await env.DB
      .prepare('SELECT plan, is_active FROM licences WHERE lookup_hmac = ? LIMIT 1')
      .bind(lookupHmac)
      .first();
    if (!row) return null;
    return row.plan || null;
  } catch (_) {
    return null;
  }
}

// ── Bump / revert atomiques du compteur mensuel (par outil) ───────
async function _bump(env, bucketKey, tool, n) {
  await env.DB.prepare(`
    INSERT INTO ai_usage (bucket_key, month, tool, used, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(bucket_key, month, tool) DO UPDATE SET
      used = used + ?,
      updated_at = datetime('now')
  `).bind(bucketKey, currentMonthUtc(), tool, n, n).run();
}
async function _revert(env, bucketKey, tool, n) {
  await env.DB.prepare(`
    UPDATE ai_usage
       SET used = MAX(used - ?, 0), updated_at = datetime('now')
     WHERE bucket_key = ? AND month = ? AND tool = ?
  `).bind(n, bucketKey, currentMonthUtc(), tool).run().catch(() => {});
}
// Décrément best-effort du solde de packs (jamais négatif).
async function _drawPacks(env, bucketKey, n) {
  if (n <= 0) return;
  await env.DB.prepare(`
    UPDATE ai_credit_balance
       SET balance = MAX(balance - ?, 0), updated_at = datetime('now')
     WHERE bucket_key = ?
  `).bind(n, bucketKey).run().catch(() => {});
}

// ── Payload exposé au frontend (forme unique pour /quota et /consume)
function creditsPayload(plan, monthUsed, packBalance, breakdown) {
  const quota = quotaForPlan(plan);            // null = illimité
  const includedRemaining = quota === null ? null : Math.max(0, quota - monthUsed);
  return {
    plan:        (plan || 'UNKNOWN').toUpperCase(),
    month:       currentMonthUtc(),
    unit:        'crédits',                     // jamais « neurones »
    includedQuota: quota,                       // null = illimité
    used:        monthUsed,                     // consommé ce mois (tous outils)
    packBalance: packBalance || 0,              // crédits de packs restants
    remaining:   quota === null ? null : (includedRemaining + (packBalance || 0)),
    unlimited:   quota === null,
    breakdown:   breakdown || {},               // { tool: used } → double jauge
  };
}

// ═══════════════════════════════════════════════════════════════
// CŒUR — consumeCredits()
// ─────────────────────────────────────────────────────────────
// Débite `tool` (coût = COST[tool]) du portefeuille `bucketKey`,
// plan `plan`. Pre-bump atomique du mois, puis arbitrage inclus/packs.
//
// Retour :
//   { ok:true,  cost, payload }                → autorisé (déjà débité)
//   { ok:false, blocked:true, cost, payload }  → quota épuisé (rien dû ;
//                                                 le bump a été reverté)
//   { ok:true,  free:true, cost:0, payload }   → action gratuite (coût 0)
//
// ADMIN (quota null) : jamais bloqué ; on bump quand même pour les stats.
// IMPORTANT : ne fait AUCUN check de flag — c'est au caller de décider
// d'appeler (isEnforceEnabled) ou de retomber en legacy.
// ═══════════════════════════════════════════════════════════════
async function consumeCredits(env, { bucketKey, plan, tool }) {
  await ensureAiCreditsSchema(env);
  const cost = costFor(tool);
  const t    = String(tool || 'unknown').toLowerCase();

  // Action gratuite (Living Layer, Smart QR) → rien à débiter.
  if (cost === 0) {
    const used = await readMonthUsed(env, bucketKey);
    const bal  = await readPackBalance(env, bucketKey);
    const brk  = await readMonthBreakdown(env, bucketKey);
    return { ok: true, free: true, cost: 0, payload: creditsPayload(plan, used, bal, brk) };
  }

  const quota = quotaForPlan(plan);            // null = ADMIN illimité
  const packBalance = await readPackBalance(env, bucketKey);

  // Pre-bump atomique AVANT toute décision (anti-race multi-device /
  // multi-visiteur sur le Concierge public).
  await _bump(env, bucketKey, t, cost);
  const usedAfter = await readMonthUsed(env, bucketKey);

  // ADMIN : illimité. On a tracké, on ne bloque jamais.
  if (quota === null) {
    const brk = await readMonthBreakdown(env, bucketKey);
    return { ok: true, cost, payload: creditsPayload(plan, usedAfter, packBalance, brk) };
  }

  // Plafond du mois = inclus + packs. Dépassé → refus + revert.
  const ceiling = quota + packBalance;
  if (usedAfter > ceiling) {
    await _revert(env, bucketKey, t, cost);
    const brk = await readMonthBreakdown(env, bucketKey);
    // payload reflète l'état clampé (used ramené sous le plafond)
    return {
      ok: false, blocked: true, cost,
      payload: creditsPayload(plan, Math.min(usedAfter - cost, ceiling), packBalance, brk),
    };
  }

  // Autorisé. Part qui a entamé les packs sur CETTE conso = ce qui
  // dépasse le quota inclus. On décrémente le solde persistant d'autant.
  const packsConsumed = Math.max(0, Math.min(cost, usedAfter - quota));
  if (packsConsumed > 0) await _drawPacks(env, bucketKey, packsConsumed);

  const brk = await readMonthBreakdown(env, bucketKey);
  return {
    ok: true, cost,
    payload: creditsPayload(plan, usedAfter, Math.max(0, packBalance - packsConsumed), brk),
  };
}

// ── Recharge de packs (appelée par le webhook Stripe, Sprint 5) ───
// UPSERT additif sur le solde persistant. Idempotence = responsabilité
// du caller (déduplication par event Stripe, cf stripe_events).
async function addPackCredits(env, bucketKey, amount) {
  await ensureAiCreditsSchema(env);
  const n = parseInt(amount, 10);
  if (!bucketKey || !Number.isInteger(n) || n <= 0) return false;
  await env.DB.prepare(`
    INSERT INTO ai_credit_balance (bucket_key, balance, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(bucket_key) DO UPDATE SET
      balance = balance + ?,
      updated_at = datetime('now')
  `).bind(bucketKey, n, n).run();
  return true;
}

export {
  quotaForPlan,
  costFor,
  COST,
  currentMonthUtc,
  ensureAiCreditsSchema,
  readMonthUsed,
  readMonthBreakdown,
  readPackBalance,
  isEnforceEnabled,
  resolvePlanByHmac,
  consumeCredits,
  addPackCredits,
  creditsPayload,
};
