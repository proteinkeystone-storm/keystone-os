// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Living Layer V2 · /api/livinglayer/board (2026-05-28)
// ───────────────────────────────────────────────────────────────────
// Endpoint unique de l'ordinateur de bord affiché sous "Bonjour, X"
// du dashboard. Une seule phrase à la fois, 3 modes possibles
// (Pilotable / Calculateur / IA) sélectionnés selon les signaux.
//
// Logique de priorité :
//   1. Pilotable URGENT actif (priority ≥ 80)       → affiche
//   2. Signal IA actionnable fort (sensors riches)  → affiche
//   3. Pilotable normal actif (priority < 80)       → affiche
//   4. Fallback : Calculateur (stats certifiées)    → toujours dispo
//
// JWT : optionnel. Si présent, identifie la licence (sub/plan) pour
// filtrer audience Pilotable + capteurs personnalisés.
//
// Capteurs serveur (helpers internes, pas de HTTP fan-out) :
//   - Smart QR     : qr_scans 24h + total
//   - Pulsa        : pulsa_responses 24h (par owner si JWT)
//   - Ghost Writer : ghostwriter_usage today (par lookup_hmac si JWT)
//
// Capteurs client (poussés via body.clientSensors) :
//   - Brainstorming : sessions non-conclues (Vault chiffré client)
//   - Annonces Immo : brouillons non-publiés (Vault chiffré client)
//   - Kodex         : derniers briefs (Vault chiffré client)
//
// Response : { mode, text, icon, ttl, expiresAt, debug? }
//   mode  : 'pilotable' | 'calculator' | 'ai'
//   icon  : 'megaphone' | 'bar-chart' | 'sparkles'
//   ttl   : secondes avant prochain re-fetch recommandé
// ══════════════════════════════════════════════════════════════════

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { verifyJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';

// Moteur unique Keystone : Mistral Small 3.1 (cf. lib/ai-model.js).
// Remplace Llama 3.1 8B le 2026-05-29. (Mode IA premium Claude Haiku
// BYOK conservé plus bas, inchangé.)
const LIVING_MODEL_ID = KS_AI_MODEL;
const LIVING_MAX_TOK  = 300;
const URGENT_PRIORITY = 80;

// ── Auto-migration (pattern Keystone) ─────────────────────────────
let _schemaReady = false;

async function ensureLivingSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS living_messages (
      id           TEXT PRIMARY KEY,
      text         TEXT NOT NULL,
      priority     INTEGER NOT NULL DEFAULT 50,
      start_at     TEXT NOT NULL,
      end_at       TEXT NOT NULL,
      audience     TEXT NOT NULL DEFAULT 'all',
      status       TEXT NOT NULL DEFAULT 'active',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      created_by   TEXT
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_living_messages_active ON living_messages(status, start_at, end_at, priority DESC)'
  ).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_living_messages_created ON living_messages(created_at DESC)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// ── Auto-migration mémoire des chiffres (Chantier 1, 2026-05-28) ──
let _metricsSchemaReady = false;
async function ensureMetricsSchema(env) {
  if (_metricsSchemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS living_metrics_daily (
      tenant_id   TEXT NOT NULL,
      day         TEXT NOT NULL,
      metrics     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, day)
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_living_metrics_tenant_day ON living_metrics_daily(tenant_id, day DESC)'
  ).run().catch(() => {});
  _metricsSchemaReady = true;
}

// ── Auto-migration feedback loop (Chantier 3, 2026-05-28) ─────────
// Apprend ce qui intéresse l'utilisateur : compte les impressions (phrase
// affichée) et engagements (outil ouvert après) par topic. Le scoring
// ajuste alors le mix de phrases. Pattern userReactions (Brainstorming 7.8).
let _feedbackSchemaReady = false;
async function ensureFeedbackSchema(env) {
  if (_feedbackSchemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS living_feedback (
      tenant_id   TEXT NOT NULL,
      topic       TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      engagements INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, topic)
    )
  `).run().catch(() => {});
  _feedbackSchemaReady = true;
}

// Lit les feedbacks d'un tenant → map { topic: {impressions, engagements} }.
async function _readFeedback(env, tenantId) {
  if (!tenantId) return {};
  await ensureFeedbackSchema(env);
  try {
    const { results } = await env.DB.prepare(
      `SELECT topic, impressions, engagements FROM living_feedback WHERE tenant_id = ?`
    ).bind(tenantId).all();
    const map = {};
    for (const r of (results || [])) {
      map[r.topic] = { impressions: r.impressions || 0, engagements: r.engagements || 0 };
    }
    return map;
  } catch (e) { return {}; }
}

// Multiplicateur de score appris pour un topic (borné, pattern userReactions).
// Pas assez de données (< 5 impressions) → neutre (1.0).
// Topic engagé (ratio élevé) → jusqu'à ×1.4. Topic ignoré → jusqu'à ×0.6.
function _topicMultiplier(feedback, topic) {
  const f = feedback?.[topic];
  if (!f || f.impressions < 5) return 1.0;
  const rate     = f.engagements / f.impressions;   // 0..1
  const baseline = 0.15;                             // engagement "attendu"
  const bonus    = Math.max(-0.4, Math.min(0.4, (rate - baseline) * 1.5));
  return 1 + bonus;
}

// Snapshot lazy des cumuls du jour (1 écriture/jour/tenant, idempotent).
// Capture les totaux pour pouvoir calculer des deltas dans le temps.
async function _recordDailySnapshot(env, tenantId, cumuls) {
  if (!tenantId) return;
  await ensureMetricsSchema(env);
  const today = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO living_metrics_daily (tenant_id, day, metrics) VALUES (?, ?, ?)`
    ).bind(tenantId, today, JSON.stringify(cumuls)).run();
  } catch (e) { /* best effort, jamais bloquant */ }
}

// Lit le snapshot le plus proche d'une date cible (≤ targetDay), pour
// absorber les jours sans connexion (pas de snapshot ce jour précis).
async function _readSnapshotNear(env, tenantId, targetDay) {
  try {
    const row = await env.DB.prepare(
      `SELECT metrics, day FROM living_metrics_daily
       WHERE tenant_id = ? AND day <= ?
       ORDER BY day DESC LIMIT 1`
    ).bind(tenantId, targetDay).first().catch(() => null);
    if (!row) return null;
    return { metrics: JSON.parse(row.metrics), day: row.day };
  } catch (e) { return null; }
}

// Calcule des candidats "tendance" à partir de l'historique.
// Compare les cumuls d'aujourd'hui avec hier (J-1) et la semaine passée (J-7).
// Retourne des phrases factuelles à fort intérêt (deltas réels, zéro invention).
async function _computeTrendCandidates(env, tenantId, current) {
  if (!tenantId) return [];
  await ensureMetricsSchema(env);
  const candidates = [];
  const dayMs = 86400000;
  const fmtDay = (d) => new Date(d).toISOString().slice(0, 10);
  const yesterday = fmtDay(Date.now() - dayMs);
  const weekAgo   = fmtDay(Date.now() - 7 * dayMs);

  const [snapY, snapW] = await Promise.all([
    _readSnapshotNear(env, tenantId, yesterday),
    _readSnapshotNear(env, tenantId, weekAgo),
  ]);

  // Δ scans depuis hier (cumul total scans)
  if (snapY?.metrics && Number.isFinite(snapY.metrics.scansTotal)) {
    const delta = (current.scansTotal || 0) - snapY.metrics.scansTotal;
    if (delta > 0) {
      candidates.push({
        text:  `${delta} nouveau${delta > 1 ? 'x' : ''} scan${delta > 1 ? 's' : ''} Smart QR depuis hier.`,
        score: 82, topic: 'smartqr',
      });
    }
  }
  // Δ réponses Key Form depuis hier
  if (snapY?.metrics && Number.isFinite(snapY.metrics.pulsaResponsesTotal)) {
    const delta = (current.pulsaResponsesTotal || 0) - snapY.metrics.pulsaResponsesTotal;
    if (delta > 0) {
      candidates.push({
        text:  `${delta} nouvelle${delta > 1 ? 's' : ''} réponse${delta > 1 ? 's' : ''} Key Form depuis hier.`,
        score: 84, topic: 'pulsa',
      });
    }
  }
  // Tendance hebdo scans (semaine glissante)
  if (snapW?.metrics && Number.isFinite(snapW.metrics.scansTotal)) {
    const weekDelta = (current.scansTotal || 0) - snapW.metrics.scansTotal;
    if (weekDelta > 0) {
      candidates.push({
        text:  `${weekDelta} scan${weekDelta > 1 ? 's' : ''} Smart QR sur les 7 derniers jours.`,
        score: 68, topic: 'smartqr',
      });
    }
  }
  return candidates;
}

// ── Helpers sensor (côté serveur) ─────────────────────────────────

// Smart QR : nombre de scans des dernières 24h + total cumulé.
// Si tenantId (= claims.sub) fourni → filtre les scans des QR appartenant
// à ce propriétaire (JOIN qr_redirects.tenant_id). Sinon (anonyme/démo) →
// agrégat global. Garantit l'EXACTITUDE : on ne compte que TES scans.
async function _sensorSmartQR(env, tenantId) {
  try {
    let scans24h, scansTotal;
    if (tenantId) {
      scans24h = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM qr_scans s
         JOIN qr_redirects r ON r.short_id = s.short_id
         WHERE r.tenant_id = ? AND s.ts >= datetime('now', '-1 day')`
      ).bind(tenantId).first().catch(() => null);
      scansTotal = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM qr_scans s
         JOIN qr_redirects r ON r.short_id = s.short_id
         WHERE r.tenant_id = ?`
      ).bind(tenantId).first().catch(() => null);
    } else {
      scans24h = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM qr_scans WHERE ts >= datetime('now', '-1 day')`
      ).first().catch(() => null);
      scansTotal = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM qr_scans`
      ).first().catch(() => null);
    }
    return {
      scans24h:   scans24h?.n   || 0,
      scansTotal: scansTotal?.n || 0,
    };
  } catch (e) {
    return { scans24h: 0, scansTotal: 0 };
  }
}

// Kodex (Brief Prod) : nombre de briefs en bibliothèque + âge du dernier.
// La biblio Kodex vit côté SERVEUR (data fabric entities type=codex_briefs,
// tenant_id = claims.sub) — surtout PAS en localStorage. Capteur serveur
// obligatoire pour un chiffre exact. Sans JWT → 0 (rien à dire).
async function _sensorKodex(env, tenantId) {
  if (!tenantId) return { briefs: 0 };
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n, MAX(updated_at) AS last_at
       FROM entities
       WHERE tenant_id = ? AND type = 'codex_briefs' AND deleted_at IS NULL`
    ).bind(tenantId).first().catch(() => null);
    const result = { briefs: row?.n || 0 };
    if (row?.last_at) {
      const ageDays = (Date.now() - new Date(row.last_at.replace(' ', 'T') + 'Z').getTime()) / 86400000;
      if (Number.isFinite(ageDays) && ageDays >= 0) result.lastBriefAgeDays = ageDays;
    }
    return result;
  } catch (e) {
    return { briefs: 0 };
  }
}

// Pulsa : nombre de réponses des dernières 24h pour cet owner (si JWT)
// sinon agrégat global.
async function _sensorPulsa(env, ownerSub) {
  try {
    let row;
    if (ownerSub) {
      row = await env.DB.prepare(`
        SELECT COUNT(*) AS n
        FROM pulsa_responses r
        JOIN pulsa_forms f ON f.id = r.form_id
        WHERE f.owner_sub = ? AND r.created_at >= datetime('now', '-1 day')
      `).bind(ownerSub).first().catch(() => null);
    } else {
      row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM pulsa_responses WHERE created_at >= datetime('now', '-1 day')`
      ).first().catch(() => null);
    }
    const totalForms = await env.DB.prepare(
      ownerSub
        ? `SELECT COUNT(*) AS n FROM pulsa_forms WHERE owner_sub = ? AND status = 'published'`
        : `SELECT COUNT(*) AS n FROM pulsa_forms WHERE status = 'published'`
    ).bind(...(ownerSub ? [ownerSub] : [])).first().catch(() => null);
    // Total cumulé (pour la mémoire des chiffres / tendances)
    const totalResp = await env.DB.prepare(
      ownerSub
        ? `SELECT COUNT(*) AS n FROM pulsa_responses r JOIN pulsa_forms f ON f.id = r.form_id WHERE f.owner_sub = ?`
        : `SELECT COUNT(*) AS n FROM pulsa_responses`
    ).bind(...(ownerSub ? [ownerSub] : [])).first().catch(() => null);
    return {
      responses24h: row?.n || 0,
      responsesTotal: totalResp?.n || 0,
      publishedForms: totalForms?.n || 0,
    };
  } catch (e) {
    return { responses24h: 0, responsesTotal: 0, publishedForms: 0 };
  }
}

// Ghost Writer : usage du jour pour cette licence + quota total.
async function _sensorGhostWriter(env, lookupHmac, plan) {
  if (!lookupHmac) return { usedToday: 0, quotaToday: null, plan: null };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const row = await env.DB.prepare(
      `SELECT count FROM ghostwriter_usage WHERE lookup_hmac = ? AND day = ?`
    ).bind(lookupHmac, today).first().catch(() => null);
    const quotaTable = { DEMO: 1, STARTER: 3, PRO: 10, MAX: 50 };
    const p = (plan || '').toUpperCase();
    const quota = p === 'ADMIN' ? null : (quotaTable[p] ?? 0);
    return {
      usedToday: row?.count || 0,
      quotaToday: quota,
      plan: p || null,
    };
  } catch (e) {
    return { usedToday: 0, quotaToday: null, plan: null };
  }
}

// ── Récupération du Pilotable actif le plus prioritaire ───────────
async function _fetchActivePilotable(env, audience) {
  await ensureLivingSchema(env);
  // 'all' couvre tous les plans. Sinon filtre exact ou 'all'.
  const audClause = audience === 'all'
    ? `audience = 'all'`
    : `audience IN ('all', ?)`;
  const sql = `
    SELECT id, text, priority, start_at, end_at, audience
    FROM living_messages
    WHERE status = 'active'
      AND start_at <= datetime('now')
      AND end_at   >  datetime('now')
      AND ${audClause}
    ORDER BY priority DESC, created_at DESC
    LIMIT 1
  `;
  try {
    const stmt = audience === 'all'
      ? env.DB.prepare(sql)
      : env.DB.prepare(sql).bind(audience.toLowerCase());
    const row = await stmt.first();
    return row || null;
  } catch (e) {
    return null;
  }
}

// ── Génère une phrase mode Calculateur depuis les sensors ─────────
// Toujours une phrase utile. Pas de LLM, zéro risque qualité.
// variantIndex : permet la ROTATION entre les candidats (pas toujours
// le top-score). On trie par pertinence puis on pioche le N-ième.
function _buildCalculatorPhrase(sensors, variantIndex = 0, extraCandidates = [], feedback = {}) {
  const { smartqr, pulsa, ghostwriter, kodex = {}, clientSensors = {} } = sensors;
  // Les candidats "tendance" (mémoire des chiffres) sont injectés en tête
  // avec un score élevé : un delta réel est plus parlant qu'un total brut.
  const candidates = Array.isArray(extraCandidates) ? [...extraCandidates] : [];

  // ── Candidats basés sur signaux forts (chiffres réels) ──────────
  if (smartqr.scans24h > 0) {
    candidates.push({
      text:  `${smartqr.scans24h} scan${smartqr.scans24h > 1 ? 's' : ''} Smart QR ${smartqr.scans24h > 1 ? 'enregistrés' : 'enregistré'} ces dernières 24 h.`,
      score: 70 + Math.min(smartqr.scans24h, 20), topic: 'smartqr',
    });
  }
  if (pulsa.responses24h > 0) {
    candidates.push({
      text:  `${pulsa.responses24h} nouvelle${pulsa.responses24h > 1 ? 's' : ''} réponse${pulsa.responses24h > 1 ? 's' : ''} Key Form depuis hier.`,
      score: 75 + Math.min(pulsa.responses24h * 3, 20), topic: 'pulsa',
    });
  }
  // Annonces : la "bibliothèque" = annonces générées sauvegardées localement.
  // PAS de notion de "brouillon à publier" → on dit "en bibliothèque" (exact).
  if (clientSensors.annoncesLibrary > 0) {
    candidates.push({
      text:  `${clientSensors.annoncesLibrary} annonce${clientSensors.annoncesLibrary > 1 ? 's' : ''} immo dans votre bibliothèque.`,
      score: 58, topic: 'annonces',
    });
  }
  if (ghostwriter.usedToday > 0 && ghostwriter.quotaToday != null) {
    const remaining = Math.max(0, ghostwriter.quotaToday - ghostwriter.usedToday);
    candidates.push({
      text:  `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday} aujourd'hui, ${remaining} restant${remaining > 1 ? 's' : ''}.`,
      score: 52, topic: 'ghostwriter',
    });
  }
  if (clientSensors.brainstormingSessions > 0) {
    candidates.push({
      text:  `${clientSensors.brainstormingSessions} session${clientSensors.brainstormingSessions > 1 ? 's' : ''} Brainstorming dans votre bibliothèque.`,
      score: 48, topic: 'brainstorming',
    });
  }
  if (pulsa.publishedForms > 0) {
    candidates.push({
      text:  `${pulsa.publishedForms} formulaire${pulsa.publishedForms > 1 ? 's' : ''} Key Form publié${pulsa.publishedForms > 1 ? 's' : ''} en ligne.`,
      score: 42, topic: 'pulsa',
    });
  }
  if (smartqr.scansTotal >= 50) {
    candidates.push({
      text:  `${smartqr.scansTotal} scans cumulés sur vos Smart QR.`,
      score: 40, topic: 'smartqr',
    });
  }
  // Kodex : chiffre serveur exact (data fabric codex_briefs).
  if (kodex.briefs > 0) {
    candidates.push({
      text:  `${kodex.briefs} brief${kodex.briefs > 1 ? 's' : ''} Brief Prod dans votre bibliothèque.`,
      score: 38, topic: 'kodex',
    });
  }

  // ── Candidats d'ambiance (toujours présents → garantit la VARIÉTÉ
  //    même quand un seul signal fort domine, ex: que des scans QR) ──
  const toolsCount = Number.isFinite(+clientSensors.toolsCount) && +clientSensors.toolsCount > 0
    ? +clientSensors.toolsCount : 7;
  const hour    = new Date().getHours();
  const weekday = new Date().toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  const moment  = hour < 6 ? 'nuit' : hour < 12 ? 'matinée' : hour < 18 ? 'après-midi' : 'soirée';

  candidates.push({
    text:  `${toolsCount} assistants IA prêts à travailler sur vos projets.`,
    score: 25, topic: 'ambiance',
  });
  candidates.push({
    text:  `Belle ${moment} de ${weekday} — votre suite Keystone est à jour.`,
    score: 20, topic: 'ambiance',
  });
  candidates.push({
    text:  `Votre poste de commande Keystone est opérationnel.`,
    score: 15, topic: 'ambiance',
  });

  // Pondération apprise : ajuste le score de chaque candidat selon
  // l'engagement passé sur son topic (apprend ce qui t'intéresse).
  for (const c of candidates) {
    c.score = c.score * _topicMultiplier(feedback, c.topic || 'ambiance');
  }

  // Tri par pertinence (apprise) décroissante puis ROTATION sur l'index.
  candidates.sort((a, b) => b.score - a.score);
  const idx = ((variantIndex % candidates.length) + candidates.length) % candidates.length;
  const chosen = candidates[idx];
  return { text: chosen.text, topic: chosen.topic || 'ambiance' };
}

// Claude Haiku 4.5 — modèle BYOK pour le mode IA (Chantier 2, 2026-05-28).
// Bien plus fin que Llama 3.1 8B pour le français court, rapide et peu cher.
// Pattern repris du Brainstorming Synthesizer (Sprint 7.9).
const LIVING_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Construit les prompts système + user à partir des signaux (partagé
// Llama/Claude). Retourne null si aucun signal exploitable.
function _buildAiPrompts(sensors, firstName, variantIndex) {
  const { smartqr, pulsa, ghostwriter, kodex = {}, clientSensors = {} } = sensors;
  let signals = [
    smartqr.scans24h        > 0 ? { t: `Smart QR : ${smartqr.scans24h} scans dernières 24h`, topic: 'smartqr' }           : null,
    pulsa.responses24h      > 0 ? { t: `Key Form : ${pulsa.responses24h} nouvelles réponses 24h`, topic: 'pulsa' }         : null,
    ghostwriter.usedToday   > 0 ? { t: `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday ?? '∞'} utilisé aujourd'hui`, topic: 'ghostwriter' } : null,
    clientSensors.brainstormingSessions > 0 ? { t: `${clientSensors.brainstormingSessions} sessions Brainstorming en bibliothèque`, topic: 'brainstorming' } : null,
    clientSensors.annoncesLibrary > 0 ? { t: `${clientSensors.annoncesLibrary} annonces immo en bibliothèque`, topic: 'annonces' } : null,
    kodex.briefs > 0 ? { t: `${kodex.briefs} briefs Brief Prod en bibliothèque`, topic: 'kodex' } : null,
    kodex.lastBriefAgeDays > 7 ? { t: `Dernier brief Brief Prod il y a ${Math.round(kodex.lastBriefAgeDays)} jours`, topic: 'kodex' } : null,
  ].filter(Boolean);

  if (!signals.length) return null;

  // Permutation selon variantIndex : le LLM privilégie le 1er signal, donc
  // changer le 1er à chaque rotation évite de répéter le même sujet.
  if (signals.length > 1) {
    const shift = ((variantIndex % signals.length) + signals.length) % signals.length;
    signals = [...signals.slice(shift), ...signals.slice(0, shift)];
  }
  // Le topic dominant = celui du signal n°1 (que le LLM doit privilégier).
  const topic = signals[0].topic;

  const hour    = new Date().getHours();
  const moment  = hour < 6 ? 'nuit' : hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soirée';
  const weekday = new Date().toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

  const systemPrompt = [
    'Tu es Living Layer, l\'ordinateur de bord de Keystone OS.',
    'Tu écris UNE phrase courte (max 16 mots) affichée sous "Bonjour, ' + firstName + '" du dashboard.',
    '',
    'Règles strictes :',
    '- Une seule phrase, max 16 mots, point final',
    '- Ton naturel, opérationnel, jamais corporate ni décoratif',
    '- DOIS exploiter UN signal concret de la liste fournie (chiffre ou état)',
    '- Ne JAMAIS inventer ni déformer un chiffre, ni ajouter d\'interprétation hasardeuse',
    '- Pas de "Bonjour" / "Salut" (déjà dit au-dessus)',
    '- Pas d\'emoji, pas de question vide, pas de CTA fictif',
    '- Réponse JSON STRICT : {"phrase":"..."}',
  ].join('\n');

  const userPrompt = [
    `Contexte : ${moment} de ${weekday}, prénom ${firstName}.`,
    'Signaux disponibles (par ordre de priorité) :',
    ...signals.map((s, i) => `${i + 1}. ${s.t}`),
    '',
    'Formule une phrase courte basée EN PRIORITÉ sur le signal n°1, qui fait gagner du temps à l\'utilisateur (rappel utile, observation factuelle, ou nudge léger). Pas d\'invention de chiffre.',
    'Génère le JSON {"phrase"} maintenant.',
  ].join('\n');

  return { systemPrompt, userPrompt, topic };
}

// Parsing commun : extrait {"phrase":"..."} d'une sortie LLM (tolérant
// aux ```json, préambules, etc.). Retourne la phrase ou null.
function _parseAiPhrase(rawText) {
  let parsed = null;
  try {
    const cleaned = (rawText || '')
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd   = cleaned.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    }
  } catch (e) { /* fallthrough */ }
  const phrase = (parsed?.phrase || '').toString().trim().slice(0, 200);
  return phrase.length >= 8 ? phrase : null;
}

// Mode IA via Claude Haiku 4.5 (Anthropic API directe, BYOK). Retourne
// la phrase, ou null en cas d'échec (clé invalide, réseau, quota…) →
// le caller fallback alors sur Llama.
async function _buildAiPhraseClaude(apiKey, systemPrompt, userPrompt) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key'        : apiKey,
        'anthropic-version': '2023-06-01',
        'content-type'     : 'application/json',
      },
      body: JSON.stringify({
        model:      LIVING_CLAUDE_MODEL,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
        max_tokens: 200,
      }),
    });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch (e) { return null; }
  // Anthropic Messages API : { content: [{ type:'text', text:'...' }] }
  const raw = (data?.content?.[0]?.text || '').trim();
  return _parseAiPhrase(raw);
}

// Mode IA via Llama 3.1 8B (Cloudflare Workers AI, gratuit). Fallback par
// défaut quand pas de clé BYOK.
async function _buildAiPhraseLlama(env, systemPrompt, userPrompt) {
  if (!env.AI || typeof env.AI.run !== 'function') return null;
  let aiResponse;
  try {
    aiResponse = await env.AI.run(LIVING_MODEL_ID, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: LIVING_MAX_TOK,
    });
  } catch (e) {
    return null;
  }
  const rawText = aiResponse?.response
    || aiResponse?.result?.response
    || aiResponse?.choices?.[0]?.message?.content
    || aiResponse?.output?.[0]?.content?.[0]?.text
    || aiResponse?.message?.content
    || aiResponse?.text
    || aiResponse?.completion
    || '';
  return _parseAiPhrase(rawText);
}

// ── Génère une phrase mode IA ─────────────────────────────────────
// Dispatch : Claude Haiku si clé BYOK présente (qualité premium), sinon
// Llama 3.1 8B. Si Claude échoue → fallback transparent Llama. Échec
// total → null (le caller bascule sur le Calculateur).
async function _buildAiPhrase(env, sensors, firstName, variantIndex = 0, apiKey = null) {
  const prompts = _buildAiPrompts(sensors, firstName, variantIndex);
  if (!prompts) return null;  // aucun signal exploitable

  let text = null;
  // BYOK Claude prioritaire si clé valide fournie
  if (typeof apiKey === 'string' && apiKey.length > 10) {
    text = await _buildAiPhraseClaude(apiKey, prompts.systemPrompt, prompts.userPrompt);
    // Claude KO → fallback transparent Llama
  }
  if (!text) {
    text = await _buildAiPhraseLlama(env, prompts.systemPrompt, prompts.userPrompt);
  }
  return text ? { text, topic: prompts.topic } : null;
}

// ── Endpoint principal ────────────────────────────────────────────
export async function handleLivingBoard(request, env) {
  const origin = getAllowedOrigin(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin'  : origin,
        'Access-Control-Allow-Methods' : 'POST, OPTIONS',
        'Access-Control-Allow-Headers' : 'Content-Type, Authorization',
      },
    });
  }

  const body = await parseBody(request);
  const firstName     = (body.firstName || '').toString().trim().slice(0, 40) || 'toi';
  const clientSensors = (body.clientSensors && typeof body.clientSensors === 'object') ? body.clientSensors : {};
  const preferMode    = ['pilotable', 'calculator', 'ai'].includes(body.preferMode) ? body.preferMode : null;
  // variantIndex : compteur de rotation côté client → fait varier le
  // candidat Calculateur ET le focus du mode IA (évite de répéter le
  // même sujet, ex: ne parler que des scans QR).
  const variantIndex  = Number.isFinite(+body.variantIndex) ? Math.abs(Math.trunc(+body.variantIndex)) : 0;
  // Clé Anthropic BYOK (optionnelle) → mode IA via Claude Haiku au lieu de
  // Llama. Envoyée par le frontend depuis le Vault (localStorage ks_api_anthropic).
  const apiKey        = (typeof body.apiKey === 'string' && body.apiKey.length > 10) ? body.apiKey : null;

  // JWT optionnel — si présent, on identifie la licence (audience + sensors personnels)
  let claims = null;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      claims = await verifyJWT(authHeader.slice(7), env);
    }
  } catch (e) { /* token invalide → on continue en mode anonyme */ }

  const lookupHmac = claims?.sub  || null;
  const plan       = (claims?.plan || '').toLowerCase() || 'all';

  // ── Collecte capteurs serveur en parallèle ──────────────────────
  // tenantId = lookupHmac (claims.sub) → filtre les chiffres sur TES données.
  const [smartqr, pulsa, ghostwriter, kodex, pilotable] = await Promise.all([
    _sensorSmartQR(env, lookupHmac),
    _sensorPulsa(env, lookupHmac),
    _sensorGhostWriter(env, lookupHmac, claims?.plan),
    _sensorKodex(env, lookupHmac),
    _fetchActivePilotable(env, plan),
  ]);

  const sensors = { smartqr, pulsa, ghostwriter, kodex, clientSensors };

  // ── Mémoire des chiffres (Chantier 1) ───────────────────────────
  // Cumuls du jour pour l'historique + calcul des tendances (deltas).
  // tenantId requis (pas d'historique en mode démo anonyme).
  const cumuls = {
    scansTotal:          smartqr.scansTotal      || 0,
    pulsaResponsesTotal: pulsa.responsesTotal     || 0,
    codexBriefs:         kodex.briefs             || 0,
  };
  let trendCandidates = [];
  let feedback = {};
  if (lookupHmac) {
    // Snapshot + tendances + feedback en parallèle.
    const [, trends, fb] = await Promise.all([
      _recordDailySnapshot(env, lookupHmac, cumuls),
      _computeTrendCandidates(env, lookupHmac, cumuls),
      _readFeedback(env, lookupHmac),
    ]);
    trendCandidates = trends || [];
    feedback = fb || {};
  }

  // Helper réponse Calculateur (factorisé — renvoie aussi le topic appris)
  const calcResponse = () => {
    const c = _buildCalculatorPhrase(sensors, variantIndex, trendCandidates, feedback);
    return json({ mode: 'calculator', text: c.text, topic: c.topic, icon: 'bar-chart', ttl: 90 }, 200, origin);
  };

  // ── Sélection du mode ───────────────────────────────────────────
  // 1. Pilotable URGENT actif → prend la main
  if (pilotable && pilotable.priority >= URGENT_PRIORITY && preferMode !== 'calculator' && preferMode !== 'ai') {
    return json({
      mode: 'pilotable',
      text: pilotable.text,
      icon: 'megaphone',
      ttl:  60,
      messageId: pilotable.id,
      priority: pilotable.priority,
      expiresAt: pilotable.end_at,
    }, 200, origin);
  }

  // Si preferMode demande explicitement un mode, on tente celui-là
  if (preferMode === 'ai') {
    const ai = await _buildAiPhrase(env, sensors, firstName, variantIndex, apiKey);
    if (ai) {
      return json({ mode: 'ai', text: ai.text, topic: ai.topic, icon: 'sparkles', ttl: 120 }, 200, origin);
    }
    // sinon fallback Calculateur
    return calcResponse();
  }
  if (preferMode === 'calculator') {
    return calcResponse();
  }
  if (preferMode === 'pilotable') {
    if (pilotable) {
      return json({
        mode: 'pilotable',
        text: pilotable.text,
        icon: 'megaphone',
        ttl:  60,
        messageId: pilotable.id,
        priority: pilotable.priority,
        expiresAt: pilotable.end_at,
      }, 200, origin);
    }
    // Pas de Pilotable actif → fallback Calculateur (variété + économie LLM)
    return calcResponse();
  }

  // 2. Pas de preferMode → cycle par défaut au boot
  // Premier appel : on commence par le mode IA si signaux disponibles, sinon Calculateur.
  // (Le frontend gère la rotation 8-12s en envoyant preferMode aux appels suivants.)
  const ai = await _buildAiPhrase(env, sensors, firstName, variantIndex, apiKey);
  if (ai) {
    return json({ mode: 'ai', text: ai.text, topic: ai.topic, icon: 'sparkles', ttl: 120 }, 200, origin);
  }

  // 3. Pilotable normal actif
  if (pilotable) {
    return json({
      mode: 'pilotable',
      text: pilotable.text,
      icon: 'megaphone',
      ttl:  60,
      messageId: pilotable.id,
      priority: pilotable.priority,
      expiresAt: pilotable.end_at,
    }, 200, origin);
  }

  // 4. Fallback : Calculateur
  return calcResponse();
}

// ── POST /api/livinglayer/feedback (Chantier 3) ───────────────────
// Enregistre une impression (phrase affichée) ou un engagement (outil
// ouvert après la phrase). Requiert JWT (tenant). Sans JWT → no-op.
// Body : { topic, type: 'impression' | 'engagement' }
const _VALID_TOPICS = ['smartqr', 'pulsa', 'annonces', 'kodex', 'brainstorming', 'ghostwriter', 'ambiance'];

export async function handleLivingFeedback(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin'  : origin,
        'Access-Control-Allow-Methods' : 'POST, OPTIONS',
        'Access-Control-Allow-Headers' : 'Content-Type, Authorization',
      },
    });
  }

  // JWT requis pour identifier le tenant (sinon rien à apprendre)
  let claims = null;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) claims = await verifyJWT(authHeader.slice(7), env);
  } catch (e) { /* ignore */ }
  const tenantId = claims?.sub || null;
  if (!tenantId) return json({ ok: true, skipped: 'no-tenant' }, 200, origin);

  const body  = await parseBody(request);
  const topic = (body.topic || '').toString().toLowerCase();
  const type  = body.type === 'engagement' ? 'engagement' : 'impression';
  if (!_VALID_TOPICS.includes(topic)) return json({ ok: true, skipped: 'invalid-topic' }, 200, origin);

  await ensureFeedbackSchema(env);
  const col = type === 'engagement' ? 'engagements' : 'impressions';
  try {
    // UPSERT : crée la ligne (topic vu pour la 1ère fois) ou incrémente.
    await env.DB.prepare(
      `INSERT INTO living_feedback (tenant_id, topic, ${col}, updated_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(tenant_id, topic) DO UPDATE SET
         ${col} = ${col} + 1,
         updated_at = datetime('now')`
    ).bind(tenantId, topic).run();
  } catch (e) {
    return json({ ok: false, error: e.message }, 200, origin);
  }
  return json({ ok: true, topic, type }, 200, origin);
}
