// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Budget IA · compteur + bridage (2026-05-29)
// ───────────────────────────────────────────────────────────────────
// POURQUOI ce module ?
//   Cloudflare Workers Paid (5 $/mois) facture l'IA au "neurone" :
//   10 000 neurones/jour inclus, puis 0,011 $ / 1 000 neurones. Il n'y a
//   AUCUN plafond de dépense automatique côté Cloudflare (juste des
//   alertes). Pour que Stéphane sache en temps réel ce qu'il consomme et
//   puisse couper la dépense quand il veut, on compte NOUS-MÊMES chaque
//   appel IA (les tableaux Cloudflare ont plusieurs heures de retard).
//
//   ⚠️ Le chiffre en NEURONES est solide (notre propre comptage à chaque
//   appel). Le chiffre en € est une ESTIMATION à caler sur la 1re vraie
//   facture Cloudflare (barème + taux $→€ susceptibles d'ajustement).
//
//   Ce module ne tracke QUE les appels Workers AI (Mistral). Les appels
//   BYOK (Claude/Gemini/… via clé perso) sont facturés ailleurs par leur
//   fournisseur → hors neurones Cloudflare, donc hors compteur.
//
// CE QU'IL EXPOSE
//   recordUsage(env, tool, {usage|inTokens/outTokens|inText/outText})
//       → incrémente le grand livre D1 après un appel IA réussi.
//   budgetGuard(env, origin)
//       → renvoie une Response 429 si le bridage est actif, sinon null.
//         À appeler À L'ENTRÉE de chaque route IA.
//   getBudgetState(env)
//       → état complet pour le compteur admin (jour/mois/€/seuil/bridage).
//   setManualThrottle(env, on) / setBudgetControl(env, {auto_on, threshold_eur})
//       → pilotage admin du bridage manuel + auto.
//
// TABLES D1 (auto-migrées, idempotent)
//   ai_neuron_ledger(day, tool)  → neurones + appels + tokens, par jour/outil
//   ai_budget_control(id=1)      → état du bridage (1 seule ligne)
// ══════════════════════════════════════════════════════════════════

import { json } from './auth.js';
import { KS_AI_MODEL } from './ai-model.js';

// ── Barème neurones (neurones pour 1 000 000 tokens) ────────────────
// Source : grille Cloudflare Workers AI mai 2026. Keystone ne tourne que
// sur Mistral Small 3.1 ; on garde un fallback prudent au cas où le
// modèle changerait sans mise à jour de cette table.
const NEURON_RATES = {
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31876, out: 50488 },
};
const DEFAULT_RATE = { in: 35000, out: 50000 };

// ── Tarification Workers Paid ───────────────────────────────────────
const FREE_NEURONS_PER_DAY = 10000;    // inclus / jour, puis facturé
const USD_PER_1K_NEURONS   = 0.011;    // au-delà de l'enveloppe gratuite
const USD_TO_EUR           = 0.92;     // taux indicatif (estimation €)

// ── Utilitaires ─────────────────────────────────────────────────────
function _utcDay()   { return new Date().toISOString().slice(0, 10); }       // YYYY-MM-DD
function _utcMonth() { return new Date().toISOString().slice(0, 7); }        // YYYY-MM

/** Estimation grossière tokens depuis une chaîne (~4 chars/token). */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/** Neurones consommés pour un appel (in/out tokens) sur un modèle donné. */
export function neuronsFor(model, inTokens, outTokens) {
  const r = NEURON_RATES[model] || DEFAULT_RATE;
  return ((inTokens || 0) * r.in + (outTokens || 0) * r.out) / 1e6;
}

/** Neurones de dépassement → € estimés. */
function _neuronsToEur(overageNeurons) {
  const usd = (Math.max(0, overageNeurons) / 1000) * USD_PER_1K_NEURONS;
  return Math.round(usd * USD_TO_EUR * 100) / 100; // 2 décimales
}

// ── Schéma (idempotent) ─────────────────────────────────────────────
let _schemaReady = false;
async function ensureBudgetSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ai_neuron_ledger (
      day        TEXT    NOT NULL,
      tool       TEXT    NOT NULL,
      neurons    REAL    NOT NULL DEFAULT 0,
      calls      INTEGER NOT NULL DEFAULT 0,
      in_tokens  INTEGER NOT NULL DEFAULT 0,
      out_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (day, tool)
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_ai_ledger_day ON ai_neuron_ledger(day)'
  ).run().catch(() => {});
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ai_budget_control (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      throttle_on     INTEGER NOT NULL DEFAULT 0,
      auto_on         INTEGER NOT NULL DEFAULT 1,
      threshold_eur   REAL    NOT NULL DEFAULT 10,
      throttle_reason TEXT,
      throttled_at    TEXT,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'INSERT OR IGNORE INTO ai_budget_control (id, throttle_on, auto_on, threshold_eur) VALUES (1, 0, 1, 10)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ── Lecture de l'état de contrôle (avec cache court) ────────────────
let _ctlCache = { at: 0, row: null };
async function _readControl(env) {
  const now = Date.now();
  if (_ctlCache.row && now - _ctlCache.at < 20000) return _ctlCache.row;
  const row = await env.DB
    .prepare('SELECT throttle_on, auto_on, threshold_eur, throttle_reason, throttled_at FROM ai_budget_control WHERE id = 1')
    .first()
    .catch(() => null);
  const safe = row || { throttle_on: 0, auto_on: 1, threshold_eur: 10, throttle_reason: null, throttled_at: null };
  _ctlCache = { at: now, row: safe };
  return safe;
}
function _invalidateCtlCache() { _ctlCache = { at: 0, row: null }; }

// ── € de dépassement du mois en cours ───────────────────────────────
async function _monthOverageEur(env) {
  const rows = (await env.DB.prepare(
    'SELECT day, SUM(neurons) AS neurons FROM ai_neuron_ledger WHERE day LIKE ? GROUP BY day'
  ).bind(_utcMonth() + '%').all().catch(() => ({ results: [] }))).results || [];
  const overage = rows.reduce((s, r) => s + Math.max(0, (r.neurons || 0) - FREE_NEURONS_PER_DAY), 0);
  return _neuronsToEur(overage);
}

// ── Auto-bridage : ARME et LIBÈRE (débounce mémoire : au plus 1×/min
//    par isolat). ─────────────────────────────────────────────────
// BUG corrigé (19/07/2026, retour Stéphane « ça fait plusieurs jours
// que ce quota ne se remet pas à jour ») : cette fonction n'ARMAIT
// QUE le bridage, jamais ne le levait — un verrou à SENS UNIQUE. Pire,
// elle n'était appelée qu'en fin de recordUsage() (= après un appel IA
// RÉUSSI) : une fois le bridage actif, budgetGuard rejette tout AVANT
// l'appel IA → recordUsage n'est plus jamais invoqué → la fonction qui
// aurait pu lever le bridage ne tournait plus JAMAIS. Le bridage
// restait donc figé pour toujours, y compris après le passage au mois
// suivant (l'overage retombe à 0 mais le flag, lui, ne bougeait pas)
// — seul un geste manuel dans l'admin (« Interrupteur IA ») le levait.
// Fix : appelée aussi depuis budgetGuard (donc même IA coupée) ; ARME
// si auto_on et dépassement ≥ seuil, LIBÈRE si le bridage est de raison
// 'auto' (jamais une coupure MANUELLE — celle-là reste la décision de
// Stéphane) ET que l'overage du mois est repassé sous le seuil.
let _autoCheckAt = 0;
async function _maybeAutoThrottle(env) {
  const now = Date.now();
  if (now - _autoCheckAt < 60000) return;
  _autoCheckAt = now;
  const ctl = await _readControl(env);
  if (!ctl.throttle_on) {
    if (!ctl.auto_on) return;
    const eur = await _monthOverageEur(env);
    if (eur >= (ctl.threshold_eur || 0)) await setThrottle(env, true, 'auto');
    return;
  }
  if (ctl.throttle_reason !== 'auto') return;   // coupure manuelle : jamais auto-levée
  const eur = await _monthOverageEur(env);
  if (eur < (ctl.threshold_eur || 0)) await setThrottle(env, false, null);
}

// ══════════════════════════════════════════════════════════════════
// API PUBLIQUE
// ══════════════════════════════════════════════════════════════════

/**
 * Enregistre la conso d'un appel IA réussi. Best-effort : ne casse JAMAIS
 * la réponse IA si l'écriture D1 échoue.
 * @param {string} tool   identifiant outil ('ghostwriter', 'brainstorming', …)
 * @param {object} opts    { model?, usage?, inTokens?, outTokens?, inText?, outText? }
 */
export async function recordUsage(env, tool, opts = {}) {
  try {
    if (!env?.DB) return;
    await ensureBudgetSchema(env);
    const model = opts.model || KS_AI_MODEL;

    let inTok  = Number(opts.inTokens)  || 0;
    let outTok = Number(opts.outTokens) || 0;

    const u = opts.usage;
    if (u && typeof u === 'object') {
      if (!inTok)  inTok  = Number(u.prompt_tokens     ?? u.input_tokens  ?? u.promptTokens     ?? 0) || 0;
      if (!outTok) outTok = Number(u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0) || 0;
      // Seulement un total fourni → on l'impute en sortie (prudent côté coût)
      if (!inTok && !outTok) outTok = Number(u.total_tokens ?? u.total ?? 0) || 0;
    }
    if (!inTok  && opts.inText)  inTok  = estimateTokens(opts.inText);
    if (!outTok && opts.outText) outTok = estimateTokens(opts.outText);

    const neurons = neuronsFor(model, inTok, outTok);
    if (neurons <= 0) return;

    await env.DB.prepare(`
      INSERT INTO ai_neuron_ledger (day, tool, neurons, calls, in_tokens, out_tokens, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
      ON CONFLICT(day, tool) DO UPDATE SET
        neurons    = neurons + excluded.neurons,
        calls      = calls + 1,
        in_tokens  = in_tokens + excluded.in_tokens,
        out_tokens = out_tokens + excluded.out_tokens,
        updated_at = datetime('now')
    `).bind(_utcDay(), String(tool || 'unknown').slice(0, 40), neurons, inTok, outTok).run();

    _maybeAutoThrottle(env).catch(() => {});
  } catch (_) { /* never break the AI response */ }
}

/**
 * Bridage actif ? (booléen). Pour les endpoints cosmétiques (Living Layer)
 * qui préfèrent retomber sur leur phrase de secours plutôt que renvoyer
 * une erreur visible sous "Bonjour, X".
 */
export async function isThrottled(env) {
  try {
    if (!env?.DB) return false;
    await ensureBudgetSchema(env);
    const ctl = await _readControl(env);
    return !!ctl.throttle_on;
  } catch (_) { return false; }
}

/**
 * Garde-fou à appeler à l'entrée de chaque route IA. Renvoie une Response
 * 429 si le bridage est actif, sinon null (laisse passer).
 */
export async function budgetGuard(env, origin) {
  try {
    if (!env?.DB) return null;
    await ensureBudgetSchema(env);
    /* appelé ICI (pas seulement depuis recordUsage) : sinon un bridage
       actif s'auto-entretient — aucun appel IA ne réussit plus, donc
       plus rien ne réévalue s'il faut le lever (cf. commentaire
       _maybeAutoThrottle). Débounce 60s : coût négligeable. */
    await _maybeAutoThrottle(env).catch(() => {});
    const ctl = await _readControl(env);
    if (!ctl.throttle_on) return null;
    const auto = ctl.throttle_reason === 'auto';
    return json({
      error: auto
        ? 'Plafond budget IA atteint — les fonctions IA sont en pause. Réactivation depuis l’espace admin.'
        : 'Fonctions IA en pause (bridage activé depuis l’admin).',
      code: 'AI_BUDGET_THROTTLED',
    }, 429, origin);
  } catch (_) {
    return null; // jamais bloquer sur une erreur du garde-fou
  }
}

/** Bascule le bridage (interne + endpoints admin). */
export async function setThrottle(env, on, reason = null) {
  await ensureBudgetSchema(env);
  await env.DB.prepare(`
    UPDATE ai_budget_control
       SET throttle_on = ?, throttle_reason = ?, throttled_at = ?, updated_at = datetime('now')
     WHERE id = 1
  `).bind(on ? 1 : 0, on ? (reason || 'manual') : null, on ? new Date().toISOString() : null).run().catch(() => {});
  _invalidateCtlCache();
}

/**
 * Bridage manuel piloté par l'admin.
 * on=false coupe AUSSI l'auto-bridage (snooze) pour éviter qu'il se
 * redéclenche immédiatement si on est déjà au-dessus du seuil. L'admin
 * réactive l'auto via setBudgetControl({auto_on:true}).
 */
export async function setManualThrottle(env, on) {
  await ensureBudgetSchema(env);
  if (on) {
    await setThrottle(env, true, 'manual');
  } else {
    await env.DB.prepare(`
      UPDATE ai_budget_control
         SET throttle_on = 0, throttle_reason = NULL, throttled_at = NULL,
             auto_on = 0, updated_at = datetime('now')
       WHERE id = 1
    `).run().catch(() => {});
    _invalidateCtlCache();
  }
  return getBudgetState(env);
}

/** Met à jour seuil + activation de l'auto-bridage. Réactive l'auto. */
export async function setBudgetControl(env, { auto_on, threshold_eur } = {}) {
  await ensureBudgetSchema(env);
  const sets = [];
  const vals = [];
  if (auto_on !== undefined) { sets.push('auto_on = ?');       vals.push(auto_on ? 1 : 0); }
  if (threshold_eur !== undefined) {
    const eur = Math.max(0, Math.min(10000, Number(threshold_eur) || 0));
    sets.push('threshold_eur = ?'); vals.push(eur);
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE ai_budget_control SET ${sets.join(', ')} WHERE id = 1`)
      .bind(...vals).run().catch(() => {});
    _invalidateCtlCache();
  }
  return getBudgetState(env);
}

/** État complet pour le compteur admin. */
export async function getBudgetState(env) {
  await ensureBudgetSchema(env);
  const today      = _utcDay();
  const monthLike  = _utcMonth() + '%';

  const todayRows = (await env.DB.prepare(
    'SELECT tool, neurons, calls FROM ai_neuron_ledger WHERE day = ? ORDER BY neurons DESC'
  ).bind(today).all().catch(() => ({ results: [] }))).results || [];

  const monthRows = (await env.DB.prepare(
    'SELECT day, SUM(neurons) AS neurons, SUM(calls) AS calls FROM ai_neuron_ledger WHERE day LIKE ? GROUP BY day'
  ).bind(monthLike).all().catch(() => ({ results: [] }))).results || [];

  const todayNeurons = todayRows.reduce((s, r) => s + (r.neurons || 0), 0);
  const todayCalls   = todayRows.reduce((s, r) => s + (r.calls   || 0), 0);
  const monthNeurons = monthRows.reduce((s, r) => s + (r.neurons || 0), 0);
  const monthCalls   = monthRows.reduce((s, r) => s + (r.calls   || 0), 0);

  const todayOverage = Math.max(0, todayNeurons - FREE_NEURONS_PER_DAY);
  const monthOverage = monthRows.reduce((s, r) => s + Math.max(0, (r.neurons || 0) - FREE_NEURONS_PER_DAY), 0);
  const monthEur     = _neuronsToEur(monthOverage);
  const todayEur     = _neuronsToEur(todayOverage);

  const ctl = await _readControl(env);
  const pct = (ctl.threshold_eur > 0) ? (monthEur / ctl.threshold_eur) : 0;

  return {
    today: {
      day            : today,
      neurons        : Math.round(todayNeurons),
      calls          : todayCalls,
      free_per_day   : FREE_NEURONS_PER_DAY,
      free_used_pct  : Math.min(100, Math.round((todayNeurons / FREE_NEURONS_PER_DAY) * 100)),
      overage_neurons: Math.round(todayOverage),
      eur_est        : todayEur,
      by_tool        : todayRows.map(r => ({ tool: r.tool, neurons: Math.round(r.neurons || 0), calls: r.calls || 0 })),
    },
    month: {
      prefix         : _utcMonth(),
      neurons        : Math.round(monthNeurons),
      calls          : monthCalls,
      overage_neurons: Math.round(monthOverage),
      eur_est        : monthEur,
    },
    control: {
      throttle_on   : !!ctl.throttle_on,
      auto_on       : !!ctl.auto_on,
      threshold_eur : ctl.threshold_eur,
      reason        : ctl.throttle_reason || null,
      throttled_at  : ctl.throttled_at || null,
      pct           : Math.round(pct * 100),
      near_threshold: pct >= 0.8 && !ctl.throttle_on,
    },
    pricing: {
      free_neurons_per_day: FREE_NEURONS_PER_DAY,
      usd_per_1k_neurons  : USD_PER_1K_NEURONS,
      usd_to_eur          : USD_TO_EUR,
      model               : KS_AI_MODEL,
    },
    generated_at: new Date().toISOString(),
  };
}
