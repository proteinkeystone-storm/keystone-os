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
import { isThrottled, recordUsage } from '../lib/ai-budget.js';
import { callLLM, byokRoutingEnabled } from '../lib/llm-router.js';
import { quotaForPlan } from '../lib/ghost-quota.js';

// Moteur unique Keystone : Mistral Small 3.1 (cf. lib/ai-model.js).
// Remplace Llama 3.1 8B le 2026-05-29. (Mode IA premium Claude Haiku
// BYOK conservé plus bas, inchangé.)
const LIVING_MODEL_ID = KS_AI_MODEL;
const LIVING_MAX_TOK  = 300;
const URGENT_PRIORITY = 80;

// ── Fuseau horaire — heure ET jour dérivés du MÊME instant en Europe/Paris ──
// Le worker tourne en UTC : `new Date().getHours()` renvoie l'heure UTC, ce
// qui désynchronise la PÉRIODE (matin/après-midi/soir) du JOUR de la semaine
// près de minuit à Paris → « Belle soirée de lundi » un dimanche soir
// (incident 2026-06-15). On dérive les deux du même instant, même fuseau.
function _parisNow() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', hour: '2-digit', hour12: false, timeZone: 'Europe/Paris',
  }).formatToParts(new Date());
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const hour    = (parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)) % 24;
  return { hour, weekday };
}

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
// Scans (B1) : VRAIES fenêtres (smartqr.scans7d / scans24h vs scansPrev24h),
// plus de delta de snapshot (qui gonflait sur les trous de connexion).
// Key Form : delta depuis hier conservé via snapshot (pas de fenêtre exacte ici).
// Phrases factuelles à fort intérêt, zéro invention.
async function _computeTrendCandidates(env, tenantId, current, smartqr = {}) {
  if (!tenantId) return { candidates: [] };
  await ensureMetricsSchema(env);
  const candidates = [];
  const dayMs = 86400000;
  const fmtDay = (d) => new Date(d).toISOString().slice(0, 10);
  const yesterday = fmtDay(Date.now() - dayMs);

  // Δ réponses Key Form depuis hier (snapshot)
  const snapY = await _readSnapshotNear(env, tenantId, yesterday);
  if (snapY?.metrics && Number.isFinite(snapY.metrics.pulsaResponsesTotal)) {
    const delta = (current.pulsaResponsesTotal || 0) - snapY.metrics.pulsaResponsesTotal;
    if (delta > 0) {
      candidates.push({
        text:  `${delta} nouvelle${delta > 1 ? 's' : ''} réponse${delta > 1 ? 's' : ''} Key Form depuis hier.`,
        score: 84, topic: 'pulsa',
      });
    }
  }
  // Tendance scans : vraie progression 24h vs 24h précédentes
  const d24 = (+smartqr.scans24h || 0) - (+smartqr.scansPrev24h || 0);
  if (d24 > 0) {
    candidates.push({
      text:  `${d24} scan${d24 > 1 ? 's' : ''} Smart QR de plus qu'hier sur 24 h.`,
      score: 82, topic: 'smartqr',
    });
  }
  // Volume hebdo scans : VRAIE fenêtre 7 jours glissants (qr_scans.ts)
  const w = +smartqr.scans7d || 0;
  if (w > 0) {
    candidates.push({
      text:  `${w} scan${w > 1 ? 's' : ''} Smart QR sur les 7 derniers jours.`,
      score: 68, topic: 'smartqr',
    });
  }
  return { candidates };
}

// ── Helpers sensor (côté serveur) ─────────────────────────────────

// Smart QR : scans par VRAIES fenêtres (24h, 24h précédentes, 7j) + total.
// Si tenantId (= padTenant) fourni → filtre les scans des QR appartenant à
// ce propriétaire (JOIN qr_redirects.tenant_id). Sinon (anonyme/démo) →
// agrégat global. Fenêtres exactes sur qr_scans.ts (B1) : remplacent les
// anciens deltas de snapshot (biaisés, cf. _readSnapshotNear) → tendance
// 24h vs 24h précédentes honnête, et "7 derniers jours" exact.
async function _sensorSmartQR(env, tenantId) {
  try {
    // timeClause utilise « ts » ; en mode tenant (JOIN) la colonne est s.ts.
    const count = async (timeClause) => {
      const where = timeClause
        ? (tenantId ? ' AND ' + timeClause.replace(/\bts\b/g, 's.ts') : ' WHERE ' + timeClause)
        : '';
      const sql = tenantId
        ? `SELECT COUNT(*) AS n FROM qr_scans s
             JOIN qr_redirects r ON r.short_id = s.short_id
             WHERE r.tenant_id = ?${where}`
        : `SELECT COUNT(*) AS n FROM qr_scans${where}`;
      const stmt = env.DB.prepare(sql);
      const row = await (tenantId ? stmt.bind(tenantId) : stmt).first().catch(() => null);
      return row?.n || 0;
    };
    // Série journalière 7 j (V2 sparkline) : un COUNT groupé par jour, puis on
    // reconstruit un tableau dense de 7 valeurs (du plus ancien au plus recent,
    // aujourd'hui en dernier), trous a 0. date(ts) = jour UTC, aligne sur le
    // calcul JS ci-dessous.
    const dailySql = tenantId
      ? `SELECT date(s.ts) AS d, COUNT(*) AS n FROM qr_scans s
           JOIN qr_redirects r ON r.short_id = s.short_id
           WHERE r.tenant_id = ? AND s.ts >= datetime('now','-7 day')
           GROUP BY date(s.ts)`
      : `SELECT date(ts) AS d, COUNT(*) AS n FROM qr_scans
           WHERE ts >= datetime('now','-7 day') GROUP BY date(ts)`;
    const dailyStmt = env.DB.prepare(dailySql);
    const [scans24h, scansPrev24h, scans7d, scansTotal, dailyRes] = await Promise.all([
      count(`ts >= datetime('now', '-1 day')`),
      count(`ts >= datetime('now', '-2 day') AND ts < datetime('now', '-1 day')`),
      count(`ts >= datetime('now', '-7 day')`),
      count(''),
      (tenantId ? dailyStmt.bind(tenantId) : dailyStmt).all().catch(() => null),
    ]);
    const byDay = {};
    ((dailyRes && dailyRes.results) || []).forEach(r => { byDay[r.d] = r.n || 0; });
    const daily7 = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daily7.push(byDay[day] || 0);
    }
    return { scans24h, scansPrev24h, scans7d, scansTotal, daily7 };
  } catch (e) {
    return { scans24h: 0, scansPrev24h: 0, scans7d: 0, scansTotal: 0, daily7: [] };
  }
}

// Suivi à l'unité (Living Layer) : stats d'UN QR epingle (short_id envoye
// par le front via clientSensors.followedQr). SECURITE : on ne renvoie les
// scans QUE si ce short_id appartient au tenant (verif via entities) — pas
// de fuite cross-tenant. Renvoie nom + scans 7j + tendance (vs 7j precedents)
// + serie journaliere 7j (sparkline). null si introuvable/pas au tenant.
async function _sensorFollowedQr(env, tenantId, shortId) {
  if (!tenantId || !shortId) return null;
  try {
    const rows = await env.DB.prepare(
      `SELECT data FROM entities WHERE tenant_id = ? AND type = 'qr_codes' AND deleted_at IS NULL`
    ).bind(tenantId).all().catch(() => null);
    let name = null;
    for (const r of ((rows && rows.results) || [])) {
      let q; try { q = JSON.parse(r.data); } catch (e) { continue; }
      if (q && q.short_id === shortId) {
        name = (q.name || '').toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || 'QR sans nom';
        break;
      }
    }
    if (name == null) return null;   // short_id pas au tenant → on n'expose rien
    const agg = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN ts >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS w,
         SUM(CASE WHEN ts >= datetime('now','-14 day') AND ts < datetime('now','-7 day') THEN 1 ELSE 0 END) AS pw
       FROM qr_scans WHERE short_id = ?`
    ).bind(shortId).first().catch(() => null);
    const dailyRes = await env.DB.prepare(
      `SELECT date(ts) AS d, COUNT(*) AS n FROM qr_scans
       WHERE short_id = ? AND ts >= datetime('now','-7 day') GROUP BY date(ts)`
    ).bind(shortId).all().catch(() => null);
    const byDay = {};
    ((dailyRes && dailyRes.results) || []).forEach(r => { byDay[r.d] = r.n || 0; });
    const daily7 = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daily7.push(byDay[day] || 0);
    }
    const w = agg?.w || 0, pw = agg?.pw || 0;
    return { name, scans7d: w, trend: w - pw, daily7 };
  } catch (e) { return null; }
}

// Suivi à l'unité d'un SITE Sentinel : état d'UN site épinglé (id envoyé
// par le front via clientSensors.followedSite). SECURITE : WHERE id ET
// tenant_id → on ne renvoie l'état que si le site appartient au tenant.
// Renvoie nom + ok (1/0/null) + latence + dernier contrôle. null si absent.
async function _sensorFollowedSite(env, tenantId, siteId) {
  if (!tenantId || !siteId) return null;
  try {
    const r = await env.DB.prepare(
      `SELECT label, url, last_ok, last_ms, last_checked_at
       FROM sentinel_sites WHERE tenant_id = ? AND id = ?`
    ).bind(tenantId, siteId).first().catch(() => null);
    if (!r) return null;   // id pas au tenant → on n'expose rien
    const name = (r.label || r.url || '').toString()
      .replace(/^https?:\/\//, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || 'Site';
    return {
      name,
      ok: (r.last_ok == null ? null : (r.last_ok ? 1 : 0)),
      lastMs: r.last_ms || null,
      lastCheckedAt: r.last_checked_at || null,
    };
  } catch (e) { return null; }
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

// Key Brand : nombre de chartes de marque en bibliothèque + combien publiées.
// kb_charts.tenant_id suit le patron _tenantOf (= padTenant : 'default' pour
// admin, sinon claims.sub) → aligné sur ce que le pad voit. Sans JWT → 0.
async function _sensorKeyBrand(env, tenantId) {
  if (!tenantId) return { charts: 0, published: 0 };
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS pub
       FROM kb_charts WHERE tenant_id = ?`
    ).bind(tenantId).first().catch(() => null);
    return { charts: row?.n || 0, published: row?.pub || 0 };
  } catch (e) {
    return { charts: 0, published: 0 };
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
    // Quota = source partagee (lib/ghost-quota.js) = MEME que l'enforcement
    // Ghost Writer → la jauge ne peut plus mentir sur le plan.
    const p = (plan || '').toUpperCase();
    const quota = quotaForPlan(plan);
    return {
      usedToday: row?.count || 0,
      quotaToday: quota,
      plan: p || null,
    };
  } catch (e) {
    return { usedToday: 0, quotaToday: null, plan: null };
  }
}

// Smart Agent : « trous » (questions restées sans réponse) — le signal le
// PLUS actionnable (combler un trou améliore l'agent). tenant_id = claims.sub.
async function _sensorSmartAgentGaps(env, tenantId) {
  if (!tenantId) return { open: 0, recent24h: 0, topHits: 0, topQuestion: '' };
  try {
    const agg = await env.DB.prepare(
      `SELECT COUNT(*) AS open,
              SUM(CASE WHEN first_asked_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS recent
       FROM sa_gaps WHERE tenant_id = ? AND status = 'open'`
    ).bind(tenantId).first().catch(() => null);
    const top = await env.DB.prepare(
      `SELECT question, hits FROM sa_gaps
       WHERE tenant_id = ? AND status = 'open'
       ORDER BY hits DESC, last_asked_at DESC LIMIT 1`
    ).bind(tenantId).first().catch(() => null);
    // État permanent (B2) : fiches de savoir VALIDÉES (ce dont l'agent
    // répond réellement). Affiché quand il n'y a pas de trou à combler.
    const know = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM kortex_units WHERE tenant_id = ? AND status = 'validated'`
    ).bind(tenantId).first().catch(() => null);
    return {
      open: agg?.open || 0,
      recent24h: agg?.recent || 0,
      topHits: top?.hits || 0,
      topQuestion: (top?.question || '').toString().slice(0, 80),
      knowledge: know?.n || 0,
    };
  } catch (e) { return { open: 0, recent24h: 0, topHits: 0, topQuestion: '', knowledge: 0 }; }
}

// Keynapse : rappel imminent (< 2 h, non encore notifié) + nombre du jour.
// `at` est stocké en ISO (ex 2026-06-28T15:00:00.000Z) → on compare en ISO.
async function _sensorKeynapse(env, tenantId) {
  if (!tenantId) return { soonLabel: '', soonAt: '', todayCount: 0 };
  try {
    const nowIso   = new Date().toISOString();
    const soonIso  = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const dayStart = nowIso.slice(0, 10) + 'T00:00:00.000Z';
    const dayEnd   = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const soon = await env.DB.prepare(
      `SELECT label, at FROM kn_reminders
       WHERE tenant_id = ? AND notified_at IS NULL AND at >= ? AND at <= ?
       ORDER BY at LIMIT 1`
    ).bind(tenantId, nowIso, soonIso).first().catch(() => null);
    const today = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM kn_reminders WHERE tenant_id = ? AND at >= ? AND at < ?`
    ).bind(tenantId, dayStart, dayEnd).first().catch(() => null);
    // État permanent (B2) : nombre de bulles/notes. Affiché quand aucun
    // rappel n'est dû aujourd'hui.
    const notes = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM kn_bubbles WHERE tenant_id = ?`
    ).bind(tenantId).first().catch(() => null);
    return {
      soonLabel: (soon?.label || '').toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 60),
      soonAt: soon?.at || '',
      todayCount: today?.n || 0,
      notesCount: notes?.n || 0,
    };
  } catch (e) { return { soonLabel: '', soonAt: '', todayCount: 0, notesCount: 0 }; }
}

// networK : anniversaires d'un contact aujourd'hui + le prochain sous 7 jours.
// Rappel ANNUEL → on compare le mois+jour (substr 'MM-DD'), pas l'année. Jours
// calculés côté Europe/Paris pour rester aligné sur la journée locale du user.
async function _sensorNetworkBirthdays(env, tenantId) {
  if (!tenantId) return { today: [], todayCount: 0, soon: null, soonCount: 0 };
  try {
    const fmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
    const base = Date.now();
    const window = [];   // [{ md:'MM-DD', offset:0..7 }]
    for (let i = 0; i <= 7; i++) window.push({ md: fmt.format(new Date(base + i * 86400000)).slice(5), offset: i });
    const keys = window.map(w => w.md);
    const rows = (await env.DB.prepare(
      `SELECT name, substr(birthday, 6, 5) AS md FROM nk_contacts
       WHERE tenant_id = ? AND birthday IS NOT NULL AND birthday != ''
         AND substr(birthday, 6, 5) IN (${keys.map(() => '?').join(',')})`
    ).bind(tenantId, ...keys).all().catch(() => null))?.results || [];
    const offOf = md => (window.find(w => w.md === md) || {}).offset;
    const today = [], soonList = [];
    for (const r of rows) {
      const nm = (r.name || '').toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
      if (!nm) continue;
      const off = offOf(r.md);
      if (off === 0) today.push(nm);
      else if (off != null) soonList.push({ name: nm, days: off });
    }
    soonList.sort((a, b) => a.days - b.days);
    return { today, todayCount: today.length, soon: soonList[0] || null, soonCount: soonList.length };
  } catch (e) { return { today: [], todayCount: 0, soon: null, soonCount: 0 }; }
}

// Sentinel : sites surveillés + combien hors ligne (last_ok = 0).
async function _sensorSentinel(env, tenantId) {
  if (!tenantId) return { total: 0, down: 0, downLabel: '' };
  try {
    const agg = await env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN last_ok = 0 THEN 1 ELSE 0 END) AS down
       FROM sentinel_sites WHERE tenant_id = ?`
    ).bind(tenantId).first().catch(() => null);
    let downLabel = '';
    if (agg && agg.down > 0) {
      const d = await env.DB.prepare(
        `SELECT label, url FROM sentinel_sites
         WHERE tenant_id = ? AND last_ok = 0 ORDER BY consecutive_fails DESC LIMIT 1`
      ).bind(tenantId).first().catch(() => null);
      downLabel = (d?.label || d?.url || '').toString().replace(/^https?:\/\//, '').slice(0, 50);
    }
    return { total: agg?.total || 0, down: agg?.down || 0, downLabel };
  } catch (e) { return { total: 0, down: 0, downLabel: '' }; }
}

// Social Manager : publications échouées/partielles vs réussies (24 h).
async function _sensorSocial(env, tenantId) {
  if (!tenantId) return { failed24h: 0, published24h: 0 };
  try {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status IN ('failed','partial') THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
       FROM social_posts WHERE tenant_id = ? AND updated_at >= datetime('now','-1 day')`
    ).bind(tenantId).first().catch(() => null);
    // État permanent (B2) : réseaux connectés. Affiché quand aucune publi
    // n'est en échec.
    const acc = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM social_accounts WHERE tenant_id = ? AND status = 'connected'`
    ).bind(tenantId).first().catch(() => null);
    return { failed24h: row?.failed || 0, published24h: row?.published || 0, connected: acc?.n || 0 };
  } catch (e) { return { failed24h: 0, published24h: 0, connected: 0 }; }
}

// Sceau (S5) : accusé de lecture + alerte interception. RGPD : comptes seuls,
// aucune PII (le secret est chiffré/aveugle, on ne lit que des horodatages/statuts).
//   - opened7d      : sceaux ouverts (read_at) sur 7 j → signal positif (calculateur).
//   - intercepted24h: sceaux morts par essais épuisés SANS lecture (read_at NULL)
//                     sur 24 h → ALERTE collante (« possible interception »).
//   - active        : sceaux scellés en attente (état permanent informatif).
async function _sensorSceau(env, tenantId) {
  if (!tenantId) return { opened7d: 0, intercepted24h: 0, active: 0 };
  try {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN read_at >= datetime('now','-7 day') THEN 1 ELSE 0 END) AS opened7d,
         SUM(CASE WHEN status = 'detruit' AND read_at IS NULL AND attempts >= max_attempts
                       AND destroyed_at >= datetime('now','-1 day') THEN 1 ELSE 0 END) AS intercepted24h,
         SUM(CASE WHEN status = 'scelle' THEN 1 ELSE 0 END) AS active
       FROM sec_secrets WHERE tenant_id = ?`
    ).bind(tenantId).first().catch(() => null);
    return { opened7d: row?.opened7d || 0, intercepted24h: row?.intercepted24h || 0, active: row?.active || 0 };
  } catch (e) { return { opened7d: 0, intercepted24h: 0, active: 0 }; }
}

// Smart QR : suivi du TOP 5 des QR par activité (7 j) + tendance vs semaine
// précédente. Les noms vivent dans entities.data (JSON) → on les résout en JS.
// Reproduit la logique du leaderboard du pad (handleQrOverview), version légère.
async function _sensorQrTop(env, tenantId, limit = 5) {
  if (!tenantId) return { top: [] };
  try {
    const { results: rows } = await env.DB.prepare(
      `SELECT data FROM entities WHERE tenant_id = ? AND type = 'qr_codes' AND deleted_at IS NULL`
    ).bind(tenantId).all();
    const qrs = (rows || []).map(r => { try { return JSON.parse(r.data); } catch { return null; } })
      .filter(q => q && q.short_id);
    if (!qrs.length) return { top: [] };
    const ids = qrs.map(q => q.short_id);
    const ph  = ids.map(() => '?').join(',');
    const { results: meta } = await env.DB.prepare(
      `SELECT short_id,
              SUM(CASE WHEN ts >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS w,
              SUM(CASE WHEN ts >= datetime('now','-14 days') AND ts < datetime('now','-7 days') THEN 1 ELSE 0 END) AS pw
       FROM qr_scans WHERE short_id IN (${ph}) GROUP BY short_id`
    ).bind(...ids).all();
    const m = new Map((meta || []).map(r => [r.short_id, r]));
    const top = qrs.map(q => {
      const x = m.get(q.short_id) || { w: 0, pw: 0 };
      return {
        name: (q.name || '').toString().replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || 'QR sans nom',
        scans7d: x.w || 0,
        trend: x.w > x.pw ? 'up' : (x.w < x.pw ? 'down' : 'flat'),
      };
    }).filter(t => t.scans7d > 0)
      .sort((a, b) => b.scans7d - a.scans7d)
      .slice(0, limit);
    return { top };
  } catch (e) { return { top: [] }; }
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
function _buildCalculatorPhrase(sensors, variantIndex = 0, extraCandidates = [], feedback = {}, preferTopic = null) {
  const { smartqr, qrtop = {}, pulsa, ghostwriter, smartagent = {}, keynapse = {}, sentinel = {}, social = {}, sceau = {}, keybrand = {}, network = {}, clientSensors = {} } = sensors;
  // Les candidats "tendance" (mémoire des chiffres) sont injectés en tête
  // avec un score élevé : un delta réel est plus parlant qu'un total brut.
  const candidates = Array.isArray(extraCandidates) ? [...extraCandidates] : [];

  // ════ TIER 1 — À AGIR (rare, important, actionnable) : scores hauts ════
  // Sentinel : un site hors ligne = priorité absolue.
  if (sentinel.down > 0) {
    candidates.push({
      text: (sentinel.down === 1 && sentinel.downLabel)
        ? `${sentinel.downLabel} est hors ligne — Sentinel surveille.`
        : `${sentinel.down} site${sentinel.down > 1 ? 's' : ''} hors ligne — Sentinel surveille.`,
      score: 95, topic: 'sentinel',
    });
  }
  // Smart Agent : une question restée sans réponse = un trou à combler.
  if (smartagent.recent24h > 0) {
    candidates.push({
      text: `Smart Agent : ${smartagent.recent24h} question${smartagent.recent24h > 1 ? 's' : ''} restée${smartagent.recent24h > 1 ? 's' : ''} sans réponse — un trou à combler.`,
      score: 93, topic: 'smartagent',
    });
  } else if (smartagent.topHits >= 3) {
    candidates.push({
      text: `Une question revient (×${smartagent.topHits}) sans réponse dans Smart Agent.`,
      score: 90, topic: 'smartagent',
    });
  }
  // Keynapse : rappel imminent (< 2 h).
  if (keynapse.soonLabel) {
    candidates.push({
      text: `Rappel bientôt : ${keynapse.soonLabel}.`,
      score: 91, topic: 'keynapse',
    });
  }
  // networK : anniversaire d'un contact aujourd'hui (chaleureux, à ne pas manquer).
  if (network.todayCount === 1) {
    candidates.push({ text: `Aujourd'hui, c'est l'anniversaire de ${network.today[0]}.`, score: 85, topic: 'network' });
  } else if (network.todayCount > 1) {
    candidates.push({ text: `${network.todayCount} anniversaires aujourd'hui, dont ${network.today[0]}.`, score: 85, topic: 'network' });
  }
  // networK : prochain anniversaire sous 7 jours (anticipation).
  if (network.soon) {
    const d = network.soon.days;
    candidates.push({
      text: `Anniversaire de ${network.soon.name} ${d === 1 ? 'demain' : 'dans ' + d + ' jours'} — de quoi préparer un mot.`,
      score: 58, topic: 'network',
    });
  }
  // Social Manager : publication non aboutie.
  if (social.failed24h > 0) {
    candidates.push({
      text: `${social.failed24h} publication${social.failed24h > 1 ? 's' : ''} non aboutie${social.failed24h > 1 ? 's' : ''} — à reprendre dans Social Manager.`,
      score: 87, topic: 'social',
    });
  }

  // Sceau (S5) : accusé de lecture — un secret a été ouvert (esprit Snap).
  if (sceau.opened7d > 0) {
    candidates.push({
      text:  `${sceau.opened7d} missive${sceau.opened7d > 1 ? 's' : ''} ouverte${sceau.opened7d > 1 ? 's' : ''} cette semaine.`,
      score: 72, topic: 'sceau',
    });
  } else if (sceau.active > 0) {
    candidates.push({
      text:  `${sceau.active} missive${sceau.active > 1 ? 's' : ''} en attente d'ouverture.`,
      score: 44, topic: 'sceau',
    });
  }

  // ════ Signaux forts du jour (chiffres réels) ════
  if (pulsa.responses24h > 0) {
    candidates.push({
      text:  `${pulsa.responses24h} nouvelle${pulsa.responses24h > 1 ? 's' : ''} réponse${pulsa.responses24h > 1 ? 's' : ''} Key Form depuis hier.`,
      score: 78 + Math.min(pulsa.responses24h * 3, 18), topic: 'pulsa',
    });
  }
  // Suivi du TOP 5 des QR : chaque QR performant devient une phrase nommée
  // (rotation via variantIndex). Plus parlant qu'un « 14 scans » anonyme.
  const _qrTrend = { up: ' — en hausse', down: ' — en repli', flat: '' };
  (Array.isArray(qrtop.top) ? qrtop.top : []).slice(0, 5).forEach((q, i) => {
    candidates.push({
      text:  `${q.name} : ${q.scans7d} scan${q.scans7d > 1 ? 's' : ''} cette semaine${_qrTrend[q.trend] || ''}.`,
      score: 74 - i * 2, topic: 'smartqr',
    });
  });
  // Total 24 h générique : secondaire (les QR nommés passent devant).
  if (smartqr.scans24h > 0) {
    candidates.push({
      text:  `${smartqr.scans24h} scan${smartqr.scans24h > 1 ? 's' : ''} Smart QR ${smartqr.scans24h > 1 ? 'enregistrés' : 'enregistré'} au total ces dernières 24 h.`,
      score: 54, topic: 'smartqr',
    });
  }

  // ════ TIER 2 — POULS (volume, ambiant, agrégé) ════
  if (smartagent.open > 0 && smartagent.recent24h === 0) {
    candidates.push({
      text: `${smartagent.open} question${smartagent.open > 1 ? 's' : ''} à combler dans Smart Agent.`,
      score: 56, topic: 'smartagent',
    });
  }
  if (keynapse.todayCount > 0 && !keynapse.soonLabel) {
    candidates.push({
      text: `${keynapse.todayCount} rappel${keynapse.todayCount > 1 ? 's' : ''} Keynapse aujourd'hui.`,
      score: 52, topic: 'keynapse',
    });
  }
  if (social.published24h > 0) {
    candidates.push({
      text: `${social.published24h} publication${social.published24h > 1 ? 's' : ''} partie${social.published24h > 1 ? 's' : ''} aujourd'hui via Social Manager.`,
      score: 50, topic: 'social',
    });
  }
  if (sentinel.total > 0 && sentinel.down === 0) {
    candidates.push({
      text: `${sentinel.total} site${sentinel.total > 1 ? 's' : ''} surveillé${sentinel.total > 1 ? 's' : ''} par Sentinel — tous en ligne.`,
      score: 47, topic: 'sentinel',
    });
  }
  // Key Brand : inventaire des chartes de marque (état permanent, informatif).
  if (keybrand.charts > 0) {
    const base = `${keybrand.charts} charte${keybrand.charts > 1 ? 's' : ''} de marque dans Key Brand`;
    candidates.push({
      text:  keybrand.published > 0 ? `${base}, dont ${keybrand.published} en ligne.` : `${base}.`,
      score: 45, topic: 'keybrand',
    });
  }
  if (ghostwriter.usedToday > 0 && ghostwriter.quotaToday != null) {
    const remaining = Math.max(0, ghostwriter.quotaToday - ghostwriter.usedToday);
    candidates.push({
      text:  `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday} aujourd'hui, ${remaining} restant${remaining > 1 ? 's' : ''}.`,
      score: 40, topic: 'ghostwriter',
    });
  }

  // ── Ambiance : PLANCHER seulement (n'apparaît que si rien de réel à dire) ──
  const toolsCount = Number.isFinite(+clientSensors.toolsCount) && +clientSensors.toolsCount > 0
    ? +clientSensors.toolsCount : 7;
  const { hour, weekday } = _parisNow();
  const moment  = hour < 6 ? 'nuit' : hour < 12 ? 'matinée' : hour < 18 ? 'après-midi' : 'soirée';
  candidates.push({
    text:  `${toolsCount} assistants IA prêts à travailler sur vos projets.`,
    score: 22, topic: 'ambiance',
  });
  candidates.push({
    text:  `Belle ${moment} de ${weekday} — votre suite Keystone est à jour.`,
    score: 18, topic: 'ambiance',
  });

  // Pondération apprise : ajuste le score de chaque candidat selon
  // l'engagement passé sur son topic (apprend ce qui t'intéresse).
  for (const c of candidates) {
    c.score = c.score * _topicMultiplier(feedback, c.topic || 'ambiance');
  }

  // Tri par pertinence (apprise) décroissante puis ROTATION sur l'index.
  candidates.sort((a, b) => b.score - a.score);
  // preferTopic (déclencheur ciblé, ex: focus) → on force ce sujet s'il existe.
  if (preferTopic) {
    const pref = candidates.find(c => (c.topic || 'ambiance') === preferTopic);
    if (pref) return { text: pref.text, topic: pref.topic || 'ambiance' };
  }
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
  const { smartqr, qrtop = {}, pulsa, ghostwriter, smartagent = {}, keynapse = {}, sentinel = {}, social = {}, sceau = {}, keybrand = {}, network = {}, clientSensors = {} } = sensors;
  const focus = (clientSensors && clientSensors.focus) || {};
  const _topQr = (Array.isArray(qrtop.top) && qrtop.top[0]) ? qrtop.top[0] : null;
  let signals = [
    sentinel.down > 0 ? { t: `Sentinel : ${sentinel.down} site(s) hors ligne${sentinel.downLabel ? ' (' + sentinel.downLabel + ')' : ''}`, topic: 'sentinel' } : null,
    smartagent.recent24h > 0 ? { t: `Smart Agent : ${smartagent.recent24h} question(s) restée(s) sans réponse, un trou à combler`, topic: 'smartagent' } : null,
    keynapse.soonLabel ? { t: `Rappel imminent : ${keynapse.soonLabel}`, topic: 'keynapse' } : null,
    social.failed24h > 0 ? { t: `Social Manager : ${social.failed24h} publication(s) non abouties à reprendre`, topic: 'social' } : null,
    pulsa.responses24h > 0 ? { t: `Key Form : ${pulsa.responses24h} nouvelles réponses 24h`, topic: 'pulsa' } : null,
    _topQr ? { t: `Smart QR top : ${_topQr.name}, ${_topQr.scans7d} scans sur 7j (${_topQr.trend === 'up' ? 'en hausse' : _topQr.trend === 'down' ? 'en repli' : 'stable'})`, topic: 'smartqr' } : null,
    smartqr.scans24h   > 0 ? { t: `Smart QR : ${smartqr.scans24h} scans dernières 24h au total`, topic: 'smartqr' } : null,
    smartagent.open > 0 ? { t: `Smart Agent : ${smartagent.open} question(s) à combler`, topic: 'smartagent' } : null,
    (sentinel.total > 0 && sentinel.down === 0) ? { t: `Sentinel : ${sentinel.total} site(s) surveillé(s), tous en ligne`, topic: 'sentinel' } : null,
    keybrand.charts > 0 ? { t: `Key Brand : ${keybrand.charts} charte(s) de marque${keybrand.published > 0 ? `, ${keybrand.published} en ligne` : ''}`, topic: 'keybrand' } : null,
    ghostwriter.usedToday > 0 ? { t: `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday ?? '∞'} utilisé aujourd'hui`, topic: 'ghostwriter' } : null,
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

  const { hour, weekday } = _parisNow();
  const moment  = hour < 6 ? 'nuit' : hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soirée';

  const systemPrompt = [
    'Tu es l\'analyseur de télémétrie du Living Layer, l\'ordinateur de bord de Keystone OS.',
    'Tu restitues UN insight factuel, affiché sous "Bonjour, ' + firstName + '" du dashboard.',
    'Tu ne fais que REFORMULER les signaux fournis — tu ne calcules ni n\'estimes jamais un chiffre toi-même.',
    '',
    'CONTRAINTES DE STYLE ABSOLUES :',
    '- Une seule phrase, 15 mots maximum, terminée par un point.',
    '- Ton neutre, sec, précis, analytique — style relevé d\'instrument, jamais "coach de vie".',
    '- Interdiction formelle des points d\'exclamation et des emojis.',
    '- Interdiction de féliciter (pas de "Bravo", "Super", "Génial", "Champion", "Bien joué").',
    '- Interdiction des conseils moralisateurs ou pseudo-philosophiques (ni "pense à faire une pause", ni "prends soin de toi").',
    '- DOIS s\'appuyer sur UN signal concret de la liste (chiffre ou état réel).',
    '- Ne JAMAIS inventer, arrondir ni déformer un chiffre.',
    '- Pas de "Bonjour" / "Salut" (déjà affiché au-dessus).',
    '- Ne commence pas par le prénom ni par une virgule ; entre directement dans le constat.',
    '- Réponse en JSON STRICT : {"phrase":"..."}',
  ].join('\n');

  // Mémoire glissante (#4) : 3 derniers moments de la session → continuité.
  const _recent = Array.isArray(focus.recentEvents) ? focus.recentEvents.slice(-3) : [];
  const _recentStr = _recent.length
    ? _recent.map(e => {
        const lbl = e && e.label ? String(e.label).replace(/[\r\n]+/g, ' ').slice(0, 30) : '';
        const ago = e && Number.isFinite(+e.agoMin) ? +e.agoMin : '?';
        return `${e && e.kind ? e.kind : '?'}${lbl ? ' ' + lbl : ''} (il y a ${ago} min)`;
      }).join(', ')
    : '';

  const userPrompt = [
    `Contexte : ${moment} de ${weekday}, prénom ${firstName}.`,
    _recentStr ? `Derniers moments de la session : ${_recentStr}.` : null,
    'Signaux disponibles (par ordre de priorité) :',
    ...signals.map((s, i) => `${i + 1}. ${s.t}`),
    '',
    'Formule une phrase courte basée EN PRIORITÉ sur le signal n°1, factuelle, qui fait gagner du temps (rappel utile, observation, ou nudge léger). Tu peux refléter une continuité avec les derniers moments. Pas d\'invention de chiffre.',
    'Génère le JSON {"phrase"} maintenant.',
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt, topic };
}

// ── Garde-fous de sortie (§5, 2026-06-06) ─────────────────────────
// Le mode IA est le SEUL non-déterministe du board. On intercepte toute
// phrase qui enfreint le cahier des charges de style (exclamation, emoji,
// félicitation, ton "coach de vie", sur-longueur) AVANT affichage. Phrase
// rejetée → null → le caller bascule sur le Calculateur (relevé certifié,
// zéro risque qualité). Volontairement CONSERVATEUR : on ne bloque que des
// violations NETTES, pour ne pas vider le mode IA de sa substance.
const _LIVING_BANNED = [
  /[!¡]/,                                                                              // exclamations
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u, // emojis / pictos / flèches
  /\bbravo\b/i, /\bf[ée]licitations?\b/i, /\bchampions?\b/i,
  /\bg[ée]nial\b/i, /\bsuper\s+(?:travail|boulot|job)\b/i, /\bbien\s+jou[ée]\b/i,
  /\bchapeau\b/i, /\bfi[èe]r[e]?\s+de\s+(?:toi|vous)\b/i, /\bcontinue[zr]?\s+comme\s+[çc]a\b/i,
  /\bprene?z?\s+une\s+pause\b/i, /\bnuit\s+à\s+(?:ta|votre)\s+sant[ée]\b/i,
  /\bpense[zr]?\s+à\s+(?:vous|toi)\b/i, /\bprend(?:re|s)?\s+soin\b/i, /\bd[ée]tende[zr]?-?vous\b/i,
  /\breste[zr]?\s+concentr[ée]/i, /\bne\s+(?:vous|te)\s+laisse[zr]?\s+pas\s+distraire/i,
  /\brespire[zr]?\b/i,
];

// Retourne la phrase si elle passe tous les garde-fous, sinon null.
function _validateLivingPhrase(phrase) {
  const p = (phrase || '').toString().trim();
  if (p.length < 8) return null;                                   // vide / trop court
  const words = p.split(/\s+/).filter(Boolean).length;
  if (words > 18 || p.length > 140) return null;                   // sur-longueur nette
  for (const rx of _LIVING_BANNED) {
    if (rx.test(p)) return null;                                   // style interdit → fallback
  }
  return p;
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
  return _validateLivingPhrase(phrase);
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
  // Bridage budget IA (admin) : on saute le mode IA Workers AI → le caller
  // retombe sur le Calculateur (stats certifiées, 0 neurone). Le Claude
  // BYOK n'est PAS concerné (facturé ailleurs, hors neurones Cloudflare).
  if (await isThrottled(env)) return null;
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
  // Compteur budget IA (best-effort)
  await recordUsage(env, 'living-layer', {
    usage : aiResponse?.usage,
    inText: systemPrompt + userPrompt,
    outText: rawText,
  });
  return _parseAiPhrase(rawText);
}

// ── Génère une phrase mode IA ─────────────────────────────────────
// Dispatch : Claude Haiku si clé BYOK présente (qualité premium), sinon
// Llama 3.1 8B. Si Claude échoue → fallback transparent Llama. Échec
// total → null (le caller bascule sur le Calculateur).
async function _buildAiPhrase(env, sensors, firstName, variantIndex = 0, apiKey = null, engine = null) {
  const prompts = _buildAiPrompts(sensors, firstName, variantIndex);
  if (!prompts) return null;  // aucun signal exploitable

  let text = null;
  // BYOK généralisé (flag ON) : n'importe quel moteur du client via callLLM.
  if (byokRoutingEnabled(env) && engine && typeof apiKey === 'string' && apiKey.length > 10) {
    text = await _buildAiPhraseVendor(env, engine, apiKey, prompts.systemPrompt, prompts.userPrompt);
    // Vendor KO → fallback transparent Llama (ci-dessous)
  } else if (typeof apiKey === 'string' && apiKey.length > 10) {
    // Flag OFF : chemin Claude existant INCHANGÉ (clé Anthropic supposée).
    text = await _buildAiPhraseClaude(apiKey, prompts.systemPrompt, prompts.userPrompt);
  }
  if (!text) {
    text = await _buildAiPhraseLlama(env, prompts.systemPrompt, prompts.userPrompt);
  }
  return text ? { text, topic: prompts.topic } : null;
}

// BYOK généralisé (Phase 2) : phrase IA sur le moteur du client via callLLM.
// Retourne la phrase, ou null en cas d'échec (→ fallback Llama). HORS compteur.
async function _buildAiPhraseVendor(env, engine, apiKey, systemPrompt, userPrompt) {
  let out;
  try {
    out = await callLLM(env, {
      engine, apiKey, system: systemPrompt,
      messages  : [{ role: 'user', content: userPrompt }],
      max_tokens: 200, fallbackOnError: false,
    });
  } catch (e) { return null; }
  return _parseAiPhrase(out.text || '');
}

// ── V1.1 « Alerte collante » ──────────────────────────────────────
// Un incident CASSÉ (site hors ligne, publication non aboutie) reste ÉPINGLÉ
// tant qu'il n'est pas résolu : il court-circuite la rotation (renvoyé quel
// que soit le preferMode) et se libère SEUL quand la condition disparaît
// (site rétabli, échec purgé). Ne couvre QUE les états « à réparer » — les
// trous/rappels/scans restent en rotation normale (ce ne sont pas des pannes).
function _buildAlert(sensors) {
  const { sentinel = {}, social = {}, sceau = {} } = sensors;
  // Sécurité d'abord : un sceau mort par essais épuisés sans lecture = signal fort.
  if (sceau.intercepted24h > 0) {
    return {
      key: `sceau-intercept:${sceau.intercepted24h}`,
      text: `${sceau.intercepted24h} missive${sceau.intercepted24h > 1 ? 's' : ''} détruite${sceau.intercepted24h > 1 ? 's' : ''} après plusieurs essais ratés — possible interception.`,
    };
  }
  if (sentinel.down > 0) {
    return {
      key: `sentinel-down:${sentinel.down}`,
      text: (sentinel.down === 1 && sentinel.downLabel)
        ? `${sentinel.downLabel} est hors ligne — à vérifier.`
        : `${sentinel.down} site${sentinel.down > 1 ? 's' : ''} hors ligne — à vérifier.`,
    };
  }
  if (social.failed24h > 0) {
    return {
      key: `social-failed:${social.failed24h}`,
      text: `${social.failed24h} publication${social.failed24h > 1 ? 's' : ''} non aboutie${social.failed24h > 1 ? 's' : ''} — à reprendre dans Social Manager.`,
    };
  }
  return null;
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
  // preferTopic (déclencheur ciblé, ex: 'focus') → force ce sujet dans le Calculateur.
  const preferTopic   = (typeof body.preferTopic === 'string' && body.preferTopic) ? body.preferTopic.slice(0, 20) : null;
  // variantIndex : compteur de rotation côté client → fait varier le
  // candidat Calculateur ET le focus du mode IA (évite de répéter le
  // même sujet, ex: ne parler que des scans QR).
  const variantIndex  = Number.isFinite(+body.variantIndex) ? Math.abs(Math.trunc(+body.variantIndex)) : 0;
  // Clé Anthropic BYOK (optionnelle) → mode IA via Claude Haiku au lieu de
  // Llama. Envoyée par le frontend depuis le Vault (localStorage ks_api_anthropic).
  const apiKey        = (typeof body.apiKey === 'string' && body.apiKey.length > 10) ? body.apiKey : null;
  // Moteur actif (BYOK généralisé Phase 2) — envoyé par le front (engines.js).
  // Flag OFF ⇒ ignoré (le dispatch retombe sur Claude-si-clé / Llama).
  const engine        = (typeof body.engine === 'string' && body.engine) ? body.engine : null;

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
  // Résolution tenant alignée sur les PADS : un compte ADMIN range ses données
  // sous 'default' (PAS sous claims.sub) côté QR/Sentinel/Smart Agent/Keynapse/
  // Social. On reproduit cette règle pour que la barre voie EXACTEMENT ce que
  // les pads voient (sinon 0 partout pour l'admin). Pulsa fait exception : il
  // classe par owner_sub = sub → on garde lookupHmac. Anonyme → null (global).
  const isAdminClaim = !!(claims && (claims.isAdmin === true || String(claims.plan || '').toUpperCase() === 'ADMIN'));
  const padTenant    = isAdminClaim ? 'default' : lookupHmac;

  // Suivi à l'unité : identifiants des entités épinglées (envoyés par le front).
  const followedQrId = (clientSensors && typeof clientSensors.followedQr === 'string')
    ? clientSensors.followedQr.slice(0, 64) : null;
  const followedSiteId = (clientSensors && typeof clientSensors.followedSite === 'string')
    ? clientSensors.followedSite.slice(0, 64) : null;

  // ── Collecte capteurs serveur en parallèle ──────────────────────
  const [smartqr, qrtop, pulsa, ghostwriter, kodex, smartagent, keynapse, sentinel, social, sceau, keybrand, network, pilotable, followedQr, followedSite] = await Promise.all([
    _sensorSmartQR(env, padTenant),
    _sensorQrTop(env, padTenant),
    _sensorPulsa(env, lookupHmac),
    _sensorGhostWriter(env, lookupHmac, claims?.plan),
    _sensorKodex(env, lookupHmac),
    _sensorSmartAgentGaps(env, padTenant),
    _sensorKeynapse(env, padTenant),
    _sensorSentinel(env, padTenant),
    _sensorSocial(env, padTenant),
    _sensorSceau(env, padTenant),
    _sensorKeyBrand(env, padTenant),
    _sensorNetworkBirthdays(env, padTenant),
    _fetchActivePilotable(env, plan),
    _sensorFollowedQr(env, padTenant, followedQrId),
    _sensorFollowedSite(env, padTenant, followedSiteId),
  ]);

  const sensors = { smartqr, qrtop, pulsa, ghostwriter, kodex, smartagent, keynapse, sentinel, social, sceau, keybrand, network, clientSensors };

  // Chiffres bruts pour la ligne de jauges (Niveau 2, #6). Le focus vient
  // du client (mesuré dans l'onglet). ghostQuota peut être null (anonyme/admin).
  const metrics = {
    scans24h:       smartqr.scans24h      || 0,
    scansPrev24h:   smartqr.scansPrev24h  || 0,   // B1 : tendance 24h vs 24h
    scans7d:        smartqr.scans7d       || 0,   // B1 : vraie fenêtre 7 jours
    scansDaily7:    smartqr.daily7        || [],  // V2 : serie 7j pour sparkline
    scansTotal:     smartqr.scansTotal    || 0,
    keyform24h:     pulsa.responses24h    || 0,
    formsPublished: pulsa.publishedForms  || 0,
    ghostUsed:      ghostwriter.usedToday || 0,
    ghostQuota:     (ghostwriter.quotaToday ?? null),
    gapsOpen:       smartagent.open       || 0,
    remindersToday: keynapse.todayCount   || 0,
    sitesDown:      sentinel.down         || 0,
    sitesTotal:     sentinel.total        || 0,
    // Reportés sur les pads (readout) : publications Social non abouties
    // (incident à reprendre) + briefs en bibliothèque Kodex (informatif).
    socialFailed24h: social.failed24h     || 0,
    codexBriefs:     kodex.briefs         || 0,
    // États permanents (B2) : affichés sur le pad quand pas de signal d'action.
    agentKnowledge:  smartagent.knowledge || 0,   // fiches de savoir validées
    keynapseNotes:   keynapse.notesCount  || 0,   // bulles/notes
    socialConnected: social.connected     || 0,   // réseaux connectés
    keybrandCharts:    keybrand.charts    || 0,    // Key Brand : chartes en biblio
    keybrandPublished: keybrand.published || 0,    // dont publiées (lien en ligne)
    // Suivi à l'unité : stats du QR / état du site épinglés (null si aucun
    // ou si l'entité n'appartient pas au tenant).
    followedQr:      followedQr || null,
    followedSite:    followedSite || null,
    // Sceau (S5) : accusés de lecture + sceaux en attente.
    sceauOpened7d:   sceau.opened7d  || 0,
    sceauActive:     sceau.active    || 0,
  };

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
      _computeTrendCandidates(env, lookupHmac, cumuls, smartqr),
      _readFeedback(env, lookupHmac),
    ]);
    trendCandidates = (trends && trends.candidates) || [];
    feedback = fb || {};
  }

  // Helper réponse Calculateur (factorisé — renvoie aussi le topic appris)
  const calcResponse = () => {
    const c = _buildCalculatorPhrase(sensors, variantIndex, trendCandidates, feedback, preferTopic);
    return json({ mode: 'calculator', text: c.text, topic: c.topic, icon: 'bar-chart', ttl: 90, metrics }, 200, origin);
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
      metrics,
    }, 200, origin);
  }

  // 1.b ALERTE COLLANTE (V1.1) : un incident « à réparer » (site hors ligne,
  //     publication non aboutie) reste ÉPINGLÉ jusqu'à résolution. Court-circuite
  //     la rotation (renvoyé quel que soit le preferMode) ; ne cède qu'au
  //     Pilotable URGENT admin (≥80, traité juste au-dessus). Se libère seul
  //     quand la condition disparaît (le capteur repasse à 0).
  const alert = _buildAlert(sensors);
  if (alert) {
    return json({
      mode: 'alert', text: alert.text, icon: 'alert-triangle',
      alertKey: alert.key, sticky: true, ttl: 45, metrics,
    }, 200, origin);
  }

  // Si preferMode demande explicitement un mode, on tente celui-là
  if (preferMode === 'ai') {
    const ai = await _buildAiPhrase(env, sensors, firstName, variantIndex, apiKey, engine);
    if (ai) {
      return json({ mode: 'ai', text: ai.text, topic: ai.topic, icon: 'sparkles', ttl: 120, metrics }, 200, origin);
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
      metrics,
      }, 200, origin);
    }
    // Pas de Pilotable actif → fallback Calculateur (variété + économie LLM)
    return calcResponse();
  }

  // 2. Pas de preferMode → cycle par défaut au boot
  // Premier appel : on commence par le mode IA si signaux disponibles, sinon Calculateur.
  // (Le frontend gère la rotation 8-12s en envoyant preferMode aux appels suivants.)
  const ai = await _buildAiPhrase(env, sensors, firstName, variantIndex, apiKey, engine);
  if (ai) {
    return json({ mode: 'ai', text: ai.text, topic: ai.topic, icon: 'sparkles', ttl: 120, metrics }, 200, origin);
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
      metrics,
    }, 200, origin);
  }

  // 4. Fallback : Calculateur
  return calcResponse();
}

// ── POST /api/livinglayer/feedback (Chantier 3) ───────────────────
// Enregistre une impression (phrase affichée) ou un engagement (outil
// ouvert après la phrase). Requiert JWT (tenant). Sans JWT → no-op.
// Body : { topic, type: 'impression' | 'engagement' }
const _VALID_TOPICS = ['smartqr', 'pulsa', 'annonces', 'kodex', 'brainstorming', 'ghostwriter', 'ambiance', 'focus', 'smartagent', 'keynapse', 'sentinel', 'social', 'keybrand'];

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
