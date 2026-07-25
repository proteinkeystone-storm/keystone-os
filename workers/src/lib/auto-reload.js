/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Recharge automatique de conversations (Sprint P3)
   ─────────────────────────────────────────────────────────────
   POURQUOI
   ─────────────────────────────────────────────────────────────
   Un Smart Agent en mode géré qui épuise son enveloppe s'ARRÊTE NET :
   les clients du client tombent sur « momentanément indisponible ». La
   recharge auto est le filet — « recharge quand il reste moins de N
   conversations, dans la limite de X €/mois ».

   Elle protège les DEUX parties, et c'est tout l'équilibre du mode
   géré (HANDOFF_PRICING_REFONTE §2) :
     · le client — un pic de trafic ne coupe pas son agent ;
     · Stéphane — le plafond mensuel est un hard-stop, donc l'IA n'est
       JAMAIS servie gratuitement au-delà de ce que le client a accepté.

   ⚠️ CE MODULE NE PARLE PAS À STRIPE. Il ne fait que DÉCIDER, en pur,
   et tenir la comptabilité. L'appel qui débite vit ailleurs, pour que
   toute la logique de garde-fou soit testable sans clé et sans risque
   de mouvement d'argent au banc. `shouldReload()` est une fonction
   pure : mêmes entrées, même verdict, aucun effet de bord.

   LES CINQ VERROUS (aucun n'est optionnel)
   ─────────────────────────────────────────────────────────────
   1. OPT-IN. `enabled = 0` par défaut. Personne n'est rechargé sans
      l'avoir demandé — un débit surprise est un litige garanti.
   2. PLAFOND MENSUEL client. Au-delà, on ne débite pas : on met en
      pause et on prévient. Le plafond est un mur, pas un ralentisseur.
   3. TRACE DE CONSENTEMENT. Date, IP, version du texte accepté. Sans
      elle, un « je n'ai jamais autorisé ça » est indéfendable devant
      un chargeback.
   4. ANTI-RAFALE. Un délai minimum entre deux recharges : sans lui,
      un bug de comptage ou deux crons concurrents pourraient enchaîner
      les débits en quelques secondes.
   5. PAUSE COLLANTE. Après un échec de paiement, on s'arrête et on
      attend une action humaine. On ne réessaie pas en boucle sur une
      carte refusée — c'est comme ça qu'on se fait signaler par sa
      banque.
   ═══════════════════════════════════════════════════════════════ */

import { PACK_LOOKUP_TO_CONVERSATIONS } from './stripe-catalog.js';

// Plafond proposé par défaut (décision P0 §9.5). Le client peut le
// baisser ; il ne peut pas le supprimer — « illimité » n'existe pas ici.
export const DEFAULT_CAP_EUR = 20;

// Prix des packs, en CENTIMES (unité de Stripe — jamais d'euros
// flottants dans un calcul d'argent : 0.1 + 0.2 !== 0.3).
export const PACK_PRICE_CENTS = { ks_pack_1000: 900, ks_pack_5000: 3900 };

// Seuil par défaut : on recharge quand il reste 50 conversations, pas 5.
// Le seuil est un TAMPON, pas une alarme incendie : le balayage tourne
// toutes les 5 minutes, il faut de quoi tenir l'intervalle même sous un
// trafic soutenu. Un seuil trop bas = un agent muet entre deux passages.
export const DEFAULT_THRESHOLD = 50;

// Anti-rafale (verrou 4) : deux recharges ne peuvent pas s'enchaîner à
// moins de 10 minutes. Volontairement supérieur au pas du cron (5 min)
// pour qu'un balayage qui déborde sur le suivant ne double pas le débit.
export const MIN_INTERVAL_MS = 10 * 60 * 1000;

export const PAUSE = {
  CAP:      'cap_reached',        // plafond mensuel atteint
  PAYMENT:  'payment_failed',     // carte refusée
  AUTH:     'authentication_required', // 3DS off-session → il faut le client
  NO_CARD:  'no_payment_method',  // consentement donné mais carte absente
};

// ── Schéma (auto-migration idempotente, pattern Keystone) ─────────
let _ready = false;
export async function ensureAutoReloadSchema(env) {
  if (_ready) return;
  const safe = async (sql) => { try { await env.DB.prepare(sql).run(); } catch (_) {} };
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_auto_reload (
      lookup_hmac       TEXT NOT NULL PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 0,
      threshold         INTEGER NOT NULL DEFAULT ${DEFAULT_THRESHOLD},
      pack_lookup       TEXT NOT NULL DEFAULT 'ks_pack_1000',
      cap_cents         INTEGER NOT NULL DEFAULT ${DEFAULT_CAP_EUR * 100},
      spent_cents       INTEGER NOT NULL DEFAULT 0,
      spent_month       TEXT,
      stripe_customer   TEXT,
      payment_method    TEXT,
      consent_at        TEXT,
      consent_ip        TEXT,
      consent_version   TEXT,
      last_reload_at    TEXT,
      paused_at         TEXT,
      paused_reason     TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Journal des débits — la preuve, et la déduplication. Un
  // payment_intent ne peut créditer qu'UNE fois (PRIMARY KEY).
  await safe(`
    CREATE TABLE IF NOT EXISTS ai_auto_reload_log (
      payment_intent  TEXT NOT NULL PRIMARY KEY,
      lookup_hmac     TEXT NOT NULL,
      pack_lookup     TEXT,
      amount_cents    INTEGER,
      conversations   INTEGER,
      status          TEXT,
      detail          TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await safe('CREATE INDEX IF NOT EXISTS idx_arl_hmac ON ai_auto_reload_log(lookup_hmac, created_at)');
  _ready = true;
}

export function currentMonthUtc() {
  return new Date().toISOString().slice(0, 7);
}

/** Combien reste-t-il à dépenser ce mois-ci, en centimes ? */
export function remainingCapCents(cfg, month = currentMonthUtc()) {
  const cap = Number(cfg?.cap_cents) || 0;
  // Un compteur d'un mois révolu ne compte plus : le plafond est MENSUEL.
  const spent = (cfg?.spent_month === month) ? (Number(cfg.spent_cents) || 0) : 0;
  return Math.max(0, cap - spent);
}

/**
 * DOIT-ON RECHARGER ? — fonction PURE, cœur de tous les garde-fous.
 *
 * @param {object}  cfg        ligne ai_auto_reload (ou null)
 * @param {?number} remaining  conversations restantes (null = illimité)
 * @param {number}  nowMs      horloge, injectée pour rendre le test déterministe
 * @param {string}  month      'YYYY-MM'
 * @returns {{ ok: boolean, reason: string, packLookup?, amountCents?, conversations? }}
 *   `reason` est TOUJOURS renseigné, y compris sur ok:true — c'est ce
 *   qu'on journalise, et sans ça un refus devient indébuggable.
 */
export function shouldReload(cfg, remaining, nowMs, month = currentMonthUtc()) {
  if (!cfg)                     return { ok: false, reason: 'not_configured' };
  if (cfg.enabled !== 1)        return { ok: false, reason: 'disabled' };          // verrou 1
  if (cfg.paused_at)            return { ok: false, reason: 'paused:' + (cfg.paused_reason || '?') }; // verrou 5
  if (!cfg.consent_at)          return { ok: false, reason: 'no_consent' };        // verrou 3
  if (!cfg.stripe_customer || !cfg.payment_method) {
    return { ok: false, reason: PAUSE.NO_CARD };
  }
  // Illimité (ADMIN/MAX legacy) : il n'y a rien à recharger.
  if (remaining === null || remaining === undefined) {
    return { ok: false, reason: 'unlimited' };
  }
  const seuil = Number(cfg.threshold) || DEFAULT_THRESHOLD;
  if (Number(remaining) > seuil) return { ok: false, reason: 'above_threshold' };

  // Verrou 4 — anti-rafale.
  if (cfg.last_reload_at) {
    const t = Date.parse(String(cfg.last_reload_at).replace(' ', 'T') + 'Z');
    if (Number.isFinite(t) && (nowMs - t) < MIN_INTERVAL_MS) {
      return { ok: false, reason: 'too_soon' };
    }
  }

  const pack = PACK_PRICE_CENTS[cfg.pack_lookup] ? cfg.pack_lookup : 'ks_pack_1000';
  const prix = PACK_PRICE_CENTS[pack];

  // Verrou 2 — le plafond. On compare au prix ENTIER du pack : débiter
  // un pack partiel n'a aucun sens, et dépasser d'un centime le plafond
  // que le client a fixé serait exactement ce qu'il a voulu empêcher.
  if (prix > remainingCapCents(cfg, month)) {
    return { ok: false, reason: PAUSE.CAP };
  }

  return {
    ok: true, reason: 'reload',
    packLookup: pack,
    amountCents: prix,
    conversations: PACK_LOOKUP_TO_CONVERSATIONS[pack] || 0,
  };
}

// ── Lecture / écriture de la config ──────────────────────────────
export async function readConfig(env, lookupHmac) {
  if (!lookupHmac) return null;
  await ensureAutoReloadSchema(env);
  try {
    return await env.DB
      .prepare('SELECT * FROM ai_auto_reload WHERE lookup_hmac = ? LIMIT 1')
      .bind(lookupHmac).first();
  } catch (_) { return null; }
}

/** Liste les licences candidates au balayage (opt-in, non en pause). */
export async function listArmed(env) {
  await ensureAutoReloadSchema(env);
  try {
    const { results = [] } = await env.DB.prepare(`
      SELECT * FROM ai_auto_reload
       WHERE enabled = 1 AND paused_at IS NULL AND consent_at IS NOT NULL
    `).all();
    return results;
  } catch (_) { return []; }
}

/**
 * Enregistre un débit RÉUSSI : incrémente le dépensé du mois, pose
 * l'horodatage anti-rafale, et journalise. Le compteur mensuel est
 * remis à zéro ICI quand le mois a changé — pas par un cron qui
 * pourrait ne pas tourner (une remise à zéro qu'on oublie de faire
 * transformerait le plafond mensuel en plafond à vie).
 */
export async function recordCharge(env, lookupHmac, { paymentIntent, packLookup, amountCents, conversations }) {
  await ensureAutoReloadSchema(env);
  const month = currentMonthUtc();
  const cfg   = await readConfig(env, lookupHmac);
  const base  = (cfg?.spent_month === month) ? (Number(cfg.spent_cents) || 0) : 0;
  await env.DB.prepare(`
    UPDATE ai_auto_reload
       SET spent_cents = ?, spent_month = ?, last_reload_at = datetime('now'),
           updated_at = datetime('now')
     WHERE lookup_hmac = ?
  `).bind(base + (Number(amountCents) || 0), month, lookupHmac).run();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO ai_auto_reload_log
      (payment_intent, lookup_hmac, pack_lookup, amount_cents, conversations, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'succeeded', datetime('now'))
  `).bind(paymentIntent, lookupHmac, packLookup, amountCents, conversations).run();
}

/** Met la recharge en PAUSE (verrou 5) et journalise la cause. */
export async function pauseReload(env, lookupHmac, reason, detail = '') {
  await ensureAutoReloadSchema(env);
  await env.DB.prepare(`
    UPDATE ai_auto_reload
       SET paused_at = datetime('now'), paused_reason = ?, updated_at = datetime('now')
     WHERE lookup_hmac = ?
  `).bind(String(reason || 'unknown'), lookupHmac).run();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO ai_auto_reload_log
      (payment_intent, lookup_hmac, status, detail, created_at)
    VALUES (?, ?, 'paused', ?, datetime('now'))
  `).bind(`pause_${lookupHmac}_${Date.now()}`, lookupHmac, `${reason} ${detail}`.trim()).run();
}

/** Le client relance après avoir corrigé (carte, plafond). */
export async function resumeReload(env, lookupHmac) {
  await ensureAutoReloadSchema(env);
  await env.DB.prepare(`
    UPDATE ai_auto_reload
       SET paused_at = NULL, paused_reason = NULL, updated_at = datetime('now')
     WHERE lookup_hmac = ?
  `).bind(lookupHmac).run();
}

/** Un payment_intent a-t-il DÉJÀ crédité ? (déduplication) */
export async function alreadyCredited(env, paymentIntent) {
  if (!paymentIntent) return false;
  await ensureAutoReloadSchema(env);
  try {
    const row = await env.DB
      .prepare("SELECT 1 AS x FROM ai_auto_reload_log WHERE payment_intent = ? AND status = 'succeeded' LIMIT 1")
      .bind(paymentIntent).first();
    return !!row;
  } catch (_) { return false; }
}
