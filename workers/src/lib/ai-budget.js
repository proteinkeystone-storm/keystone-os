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
// Source : grille Cloudflare Workers AI, revérifiée le 22/07/2026 sur
// developers.cloudflare.com/workers-ai/platform/pricing. Le barème
// Mistral est CONFIRMÉ exact (0,351 $/M in · 0,555 $/M out).
// Les 3 autres entrées comblent l'angle mort trouvé le 22/07 : Smart
// Agent (embeddings + reranker) et Keynapse appelaient env.AI.run SANS
// jamais appeler recordUsage — leur conso était invisible au compteur.
const NEURON_RATES = {
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31876, out: 50488 },
  '@cf/baai/bge-m3'            : { in:  1075, out: 0 },   // embeddings
  '@cf/baai/bge-reranker-base' : { in:   283, out: 0 },   // reranker
};
const DEFAULT_RATE = { in: 35000, out: 50000 };

// ── Barème audio (neurones par MINUTE d'audio, pas par token) ───────
// Whisper ne se facture pas au token. L'ancien code comptait la
// TRANSCRIPTION comme des tokens de sortie au barème Mistral — un
// chiffre qui ne voulait rien dire (≈ 50 000 neurones/M au lieu de
// ~47/minute). On mesure désormais la durée réelle de l'audio.
const AUDIO_NEURON_RATES = {
  '@cf/openai/whisper-large-v3-turbo': 46.63,
  '@cf/openai/whisper'               : 41.14,
};
const DEFAULT_AUDIO_RATE = 46.63;

/** Un modèle facturé à la minute d'audio plutôt qu'au token ? */
export function isAudioModel(model) {
  return Object.prototype.hasOwnProperty.call(AUDIO_NEURON_RATES, model);
}

/**
 * Durée d'audio (secondes) déduite d'une réponse Whisper Workers AI.
 * Les variantes renvoient soit `segments[]`, soit `words[]`, avec des
 * bornes temporelles. Aucune borne exploitable → 0 : on préfère ne RIEN
 * compter plutôt qu'inventer une durée (c'est exactement l'erreur que
 * faisait l'ancien 'kora-stt', qui métrait la transcription au barème
 * texte de Mistral).
 */
export function audioSecondsFrom(res) {
  const segs = Array.isArray(res?.segments) ? res.segments : null;
  if (segs?.length) {
    const end = Number(segs[segs.length - 1]?.end);
    if (end > 0) return end;
  }
  const words = Array.isArray(res?.words) ? res.words : null;
  if (words?.length) {
    const end = Number(words[words.length - 1]?.end);
    if (end > 0) return end;
  }
  return 0;
}

// ── Tarification Workers Paid ───────────────────────────────────────
const FREE_NEURONS_PER_DAY = 10000;    // inclus / jour, puis facturé
const USD_PER_1K_NEURONS   = 0.011;    // au-delà de l'enveloppe gratuite
const USD_TO_EUR           = 0.92;     // taux indicatif (estimation €)

// ── Cycle de facturation Cloudflare ─────────────────────────────────
// CORRECTION 22/07/2026, calée sur la 1re VRAIE facture (IN 71971984,
// période 18/06 → 17/07/2026, ligne « Regular Twitch Neurons ») :
//
//   · Cloudflare facture par CYCLE D'ABONNEMENT, pas par mois
//     calendaire. Sur la facture : « Workers Paid · 18 juil. 2026 –
//     17 août 2026 » → le cycle court du 18 au 17. Agréger sur
//     `2026-07` comparait donc à la mauvaise fenêtre.
//
//   · L'enveloppe offerte se comporte comme un POT COMMUN sur la
//     période, PAS comme un plafond journalier remis à zéro. La doc
//     dit « 10 000 neurones/jour, reset 00:00 UTC » — mais la facture
//     dit autre chose, et c'est la facture qui paie :
//
//       neurones comptés  23/06 → 17/07 ....... 296 714
//       ancien calcul (clip par jour) ......... 119 819 de dépassement
//       facturé RÉELLEMENT par Cloudflare ......  38 250
//       pot commun (296 714 − 25 j × 10 000) ...  46 714  ← à 4 %
//
//     L'ancien modèle jetait l'enveloppe inutilisée des jours creux
//     (7 neurones le 13/07, 114 le 14/07) et surestimait d'un facteur
//     ~3. Le pot commun colle. On garde malgré tout un FACTEUR DE
//     CALAGE réglable (cf. setCalibration) : un seul point de mesure
//     ne fait pas une loi, et chaque nouvelle facture doit pouvoir
//     réajuster le compteur sans redéploiement.
const CF_CYCLE_ANCHOR_DAY = 18;        // le cycle démarre le 18 de chaque mois

/**
 * Cycle de facturation Cloudflare COURANT (en UTC, comme la facture).
 * @returns {{start:string, end:string, days_total:number, days_elapsed:number}}
 */
function _cfCycle(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  // Avant le 18 → on est encore dans le cycle ouvert le 18 du mois précédent.
  const start = (d >= CF_CYCLE_ANCHOR_DAY)
    ? new Date(Date.UTC(y, m, CF_CYCLE_ANCHOR_DAY))
    : new Date(Date.UTC(y, m - 1, CF_CYCLE_ANCHOR_DAY));
  // Fin = veille du 18 suivant.
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, CF_CYCLE_ANCHOR_DAY - 1));
  const DAY = 86400000;
  const todayUtc = new Date(Date.UTC(y, m, d));
  return {
    start       : start.toISOString().slice(0, 10),
    end         : end.toISOString().slice(0, 10),
    days_total  : Math.round((end - start) / DAY) + 1,
    days_elapsed: Math.round((todayUtc - start) / DAY) + 1,
  };
}

// ── Utilitaires ─────────────────────────────────────────────────────
// ⚠️ Le « jour » du compteur est un jour UTC — c'est le seul qui compte
// pour Cloudflare (les quotas Workers AI se remettent à zéro à 00:00
// UTC). Mais Stéphane vit à Paris : en été (UTC+2) le compteur ne
// bascule qu'à 02 h du matin. D'où le retour « l'enveloppe du jour ne
// se remet pas à jour » à 00 h 51 heure de Paris — le compteur avait
// raison, c'est l'étiquette « Aujourd'hui » qui mentait. On expose
// désormais le décalage explicitement (cf. getBudgetState.today.tz).
function _utcDay()   { return new Date().toISOString().slice(0, 10); }       // YYYY-MM-DD
function _utcMonth() { return new Date().toISOString().slice(0, 7); }        // YYYY-MM

/** Heure de reset du jour UTC, exprimée dans le fuseau de l'utilisateur. */
function _resetLabelParis(now = new Date()) {
  // Décalage Paris ↔ UTC au moment T (gère été/hiver sans table en dur).
  const parisHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hour12: false,
  }).format(now));
  const utcHour   = now.getUTCHours();
  let offset = parisHour - utcHour;
  if (offset < -12) offset += 24;
  if (offset >  12) offset -= 24;
  return { offset_h: offset, reset_local: `${String((24 + offset) % 24).padStart(2, '0')}:00` };
}

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
  // Calage sur facture réelle (ajouté 22/07/2026) — ALTER idempotent :
  // sur une base déjà créée, CREATE TABLE IF NOT EXISTS ne rajoute
  // pas les colonnes. On tente, on ignore le « duplicate column ».
  for (const col of [
    'calib_factor REAL NOT NULL DEFAULT 1',
    'invoice_neurons REAL',
    'invoice_start TEXT',
    'invoice_end TEXT',
    'invoice_at TEXT',
  ]) {
    await env.DB.prepare(`ALTER TABLE ai_budget_control ADD COLUMN ${col}`).run().catch(() => {});
  }
  _schemaReady = true;
}

// ── Lecture de l'état de contrôle (avec cache court) ────────────────
let _ctlCache = { at: 0, row: null };
async function _readControl(env) {
  const now = Date.now();
  if (_ctlCache.row && now - _ctlCache.at < 20000) return _ctlCache.row;
  const row = await env.DB
    .prepare(`SELECT throttle_on, auto_on, threshold_eur, throttle_reason, throttled_at,
                     calib_factor, invoice_neurons, invoice_start, invoice_end, invoice_at
                FROM ai_budget_control WHERE id = 1`)
    .first()
    .catch(() => null);
  const safe = row || { throttle_on: 0, auto_on: 1, threshold_eur: 10, throttle_reason: null, throttled_at: null };
  if (!(Number(safe.calib_factor) > 0)) safe.calib_factor = 1;
  _ctlCache = { at: now, row: safe };
  return safe;
}
function _invalidateCtlCache() { _ctlCache = { at: 0, row: null }; }

// ── Neurones consommés sur une fenêtre [start, end] (jours UTC) ──────
async function _neuronsOver(env, start, end) {
  const row = await env.DB.prepare(
    'SELECT SUM(neurons) AS neurons, SUM(calls) AS calls FROM ai_neuron_ledger WHERE day >= ? AND day <= ?'
  ).bind(start, end).first().catch(() => null);
  return { neurons: row?.neurons || 0, calls: row?.calls || 0 };
}

/**
 * Dépassement facturable estimé sur le cycle Cloudflare en cours.
 * Modèle POT COMMUN (cf. bloc « Cycle de facturation » plus haut) :
 * l'enveloppe offerte est mutualisée sur les jours écoulés du cycle,
 * pas remise à zéro chaque nuit.
 */
async function _cycleOverage(env, ctl) {
  const cycle = _cfCycle();
  const { neurons, calls } = await _neuronsOver(env, cycle.start, _utcDay());
  const freePool = cycle.days_elapsed * FREE_NEURONS_PER_DAY;
  const raw      = Math.max(0, neurons - freePool);
  const calib    = Number(ctl?.calib_factor) > 0 ? Number(ctl.calib_factor) : 1;
  const overage  = raw * calib;
  return { cycle, neurons, calls, freePool, raw, calib, overage, eur: _neuronsToEur(overage) };
}

/** € de dépassement du cycle en cours (garde-fou auto-bridage). */
async function _cycleOverageEur(env) {
  const ctl = await _readControl(env);
  return (await _cycleOverage(env, ctl)).eur;
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
    const eur = await _cycleOverageEur(env);
    if (eur >= (ctl.threshold_eur || 0)) await setThrottle(env, true, 'auto');
    return;
  }
  if (ctl.throttle_reason !== 'auto') return;   // coupure manuelle : jamais auto-levée
  const eur = await _cycleOverageEur(env);
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

    // Audio (Whisper) : facturé à la minute, jamais au token. On ignore
    // les tokens estimés depuis la transcription, ils n'ont aucun sens ici.
    let neurons;
    if (isAudioModel(model)) {
      const secs = Number(opts.audioSeconds) || 0;
      if (secs <= 0) return;                 // durée inconnue → on ne devine pas
      inTok = 0; outTok = 0;
      neurons = (secs / 60) * (AUDIO_NEURON_RATES[model] || DEFAULT_AUDIO_RATE);
    } else {
      neurons = neuronsFor(model, inTok, outTok);
    }
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
  const ctl        = await _readControl(env);

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

  // ── Référence de facturation : le CYCLE Cloudflare (18 → 17) ──────
  const cyc = await _cycleOverage(env, ctl);
  const cycleRows = (await env.DB.prepare(
    'SELECT tool, SUM(neurons) AS neurons, SUM(calls) AS calls FROM ai_neuron_ledger WHERE day >= ? AND day <= ? GROUP BY tool ORDER BY neurons DESC'
  ).bind(cyc.cycle.start, today).all().catch(() => ({ results: [] }))).results || [];

  const pct = (ctl.threshold_eur > 0) ? (cyc.eur / ctl.threshold_eur) : 0;
  const tz  = _resetLabelParis();

  return {
    // Le jour UTC reste exposé (utile pour le détail par outil), mais il
    // n'est plus la référence de facturation. `tz` dit franchement à
    // quelle heure locale il bascule — sans ça l'écran ment entre
    // minuit et 02 h heure de Paris.
    today: {
      day            : today,
      is_utc         : true,
      tz             : { offset_h: tz.offset_h, reset_local: tz.reset_local },
      neurons        : Math.round(todayNeurons),
      calls          : todayCalls,
      free_per_day   : FREE_NEURONS_PER_DAY,
      by_tool        : todayRows.map(r => ({ tool: r.tool, neurons: Math.round(r.neurons || 0), calls: r.calls || 0 })),
    },
    // ★ Bloc de référence : c'est CE que Cloudflare facture.
    cycle: {
      start          : cyc.cycle.start,
      end            : cyc.cycle.end,
      days_total     : cyc.cycle.days_total,
      days_elapsed   : cyc.cycle.days_elapsed,
      neurons        : Math.round(cyc.neurons),
      calls          : cyc.calls,
      free_pool      : cyc.freePool,
      free_used_pct  : Math.min(100, Math.round((cyc.neurons / Math.max(1, cyc.freePool)) * 100)),
      overage_neurons: Math.round(cyc.overage),
      overage_raw    : Math.round(cyc.raw),
      eur_est        : cyc.eur,
      by_tool        : cycleRows.map(r => ({ tool: r.tool, neurons: Math.round(r.neurons || 0), calls: r.calls || 0 })),
    },
    // Conservé pour l'historique, explicitement marqué « hors facturation ».
    month: {
      prefix         : _utcMonth(),
      neurons        : Math.round(monthNeurons),
      calls          : monthCalls,
      billing_ref    : false,
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
    // Calage sur la dernière facture réelle saisie par l'admin.
    calibration: {
      factor         : cyc.calib,
      invoice_neurons: ctl.invoice_neurons ?? null,
      invoice_start  : ctl.invoice_start   || null,
      invoice_end    : ctl.invoice_end     || null,
      invoice_at     : ctl.invoice_at      || null,
    },
    pricing: {
      free_neurons_per_day: FREE_NEURONS_PER_DAY,
      usd_per_1k_neurons  : USD_PER_1K_NEURONS,
      usd_to_eur          : USD_TO_EUR,
      model               : KS_AI_MODEL,
      cycle_anchor_day    : CF_CYCLE_ANCHOR_DAY,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * Cale le compteur sur une VRAIE facture Cloudflare.
 * L'admin saisit la période et le nombre de neurones réellement
 * facturés (ligne « Regular Twitch Neurons ») ; on recalcule ce que le
 * compteur AURAIT annoncé sur cette même fenêtre et on en déduit le
 * facteur correctif. Un seul point de mesure ne fait pas une loi —
 * mais chaque facture suivante réaffine sans redéploiement.
 * @returns {object} état complet + le détail du calage
 */
export async function setCalibration(env, { start, end, neurons } = {}) {
  await ensureBudgetSchema(env);
  const s = String(start || '').slice(0, 10);
  const e = String(end   || '').slice(0, 10);
  const realNeurons = Number(neurons);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || !(realNeurons >= 0)) {
    throw new Error('Période (start/end au format AAAA-MM-JJ) et neurones facturés requis.');
  }

  const { neurons: counted } = await _neuronsOver(env, s, e);
  const days     = Math.round((Date.parse(e + 'T00:00:00Z') - Date.parse(s + 'T00:00:00Z')) / 86400000) + 1;
  const estimate = Math.max(0, counted - days * FREE_NEURONS_PER_DAY);
  // Estimation nulle → aucun facteur déductible : on retombe à 1 plutôt
  // que de diviser par zéro et de figer un compteur aberrant.
  const factor   = estimate > 0 ? Math.max(0.05, Math.min(20, realNeurons / estimate)) : 1;

  await env.DB.prepare(`
    UPDATE ai_budget_control
       SET calib_factor = ?, invoice_neurons = ?, invoice_start = ?, invoice_end = ?,
           invoice_at = ?, updated_at = datetime('now')
     WHERE id = 1
  `).bind(factor, realNeurons, s, e, new Date().toISOString()).run().catch(() => {});
  _invalidateCtlCache();

  const state = await getBudgetState(env);
  return {
    ...state,
    calibration_result: {
      period_days     : days,
      counted_neurons : Math.round(counted),
      estimate_before : Math.round(estimate),
      invoiced        : realNeurons,
      factor          : Math.round(factor * 1000) / 1000,
    },
  };
}
