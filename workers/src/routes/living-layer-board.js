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

const LIVING_MODEL_ID = '@cf/meta/llama-3.1-8b-instruct';
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

// ── Helpers sensor (côté serveur) ─────────────────────────────────

// Smart QR : nombre de scans des dernières 24h + redemptions cumulées.
// Agrégat global pour le MVP single-tenant. Un futur multi-tenant
// filtrera par tenant_id via JOIN qr_redirects.
async function _sensorSmartQR(env) {
  try {
    const scans24h = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM qr_scans WHERE ts >= datetime('now', '-1 day')`
    ).first().catch(() => null);
    const scansTotal = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM qr_scans`
    ).first().catch(() => null);
    return {
      scans24h:   scans24h?.n   || 0,
      scansTotal: scansTotal?.n || 0,
    };
  } catch (e) {
    return { scans24h: 0, scansTotal: 0 };
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
    return {
      responses24h: row?.n || 0,
      publishedForms: totalForms?.n || 0,
    };
  } catch (e) {
    return { responses24h: 0, publishedForms: 0 };
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
function _buildCalculatorPhrase(sensors) {
  const { smartqr, pulsa, ghostwriter, clientSensors = {} } = sensors;
  const candidates = [];

  if (smartqr.scans24h > 0) {
    candidates.push({
      text:  `${smartqr.scans24h} scan${smartqr.scans24h > 1 ? 's' : ''} Smart QR ${smartqr.scans24h > 1 ? 'enregistrés' : 'enregistré'} ces dernières 24 h.`,
      score: 70 + Math.min(smartqr.scans24h, 20),
    });
  }
  if (pulsa.responses24h > 0) {
    candidates.push({
      text:  `${pulsa.responses24h} nouvelle${pulsa.responses24h > 1 ? 's' : ''} réponse${pulsa.responses24h > 1 ? 's' : ''} Key Form depuis hier.`,
      score: 75 + Math.min(pulsa.responses24h * 3, 20),
    });
  }
  if (ghostwriter.usedToday > 0 && ghostwriter.quotaToday != null) {
    const remaining = Math.max(0, ghostwriter.quotaToday - ghostwriter.usedToday);
    candidates.push({
      text:  `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday} aujourd'hui, ${remaining} restant${remaining > 1 ? 's' : ''}.`,
      score: 50,
    });
  }
  if (smartqr.scansTotal >= 50) {
    candidates.push({
      text:  `${smartqr.scansTotal} scans cumulés sur tous vos Smart QR.`,
      score: 40,
    });
  }
  if (pulsa.publishedForms > 0) {
    candidates.push({
      text:  `${pulsa.publishedForms} formulaire${pulsa.publishedForms > 1 ? 's' : ''} Key Form publié${pulsa.publishedForms > 1 ? 's' : ''} en ligne.`,
      score: 35,
    });
  }
  if (clientSensors.brainstormingSessions > 0) {
    candidates.push({
      text:  `${clientSensors.brainstormingSessions} session${clientSensors.brainstormingSessions > 1 ? 's' : ''} Brainstorming sauvegardée${clientSensors.brainstormingSessions > 1 ? 's' : ''}.`,
      score: 45,
    });
  }
  if (clientSensors.annoncesDrafts > 0) {
    candidates.push({
      text:  `${clientSensors.annoncesDrafts} annonce${clientSensors.annoncesDrafts > 1 ? 's' : ''} immo prête${clientSensors.annoncesDrafts > 1 ? 's' : ''} à publier.`,
      score: 55,
    });
  }
  if (clientSensors.kodexBriefs > 0) {
    candidates.push({
      text:  `${clientSensors.kodexBriefs} brief${clientSensors.kodexBriefs > 1 ? 's' : ''} Brief Prod en bibliothèque.`,
      score: 30,
    });
  }

  // Fallback ultime : phrase générique mais factuelle
  if (!candidates.length) {
    return 'Votre suite Keystone est prête — 7 outils à portée de main.';
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].text;
}

// ── Génère une phrase mode IA (Llama 3.1 8B) ──────────────────────
// Une phrase actionnable, contextuelle, basée sur les signaux les plus
// chargés. Échec → null (le caller fallback sur Calculateur).
async function _buildAiPhrase(env, sensors, firstName) {
  if (!env.AI || typeof env.AI.run !== 'function') return null;

  // Si aucun signal n'est intéressant, on ne dérange pas le LLM
  const { smartqr, pulsa, ghostwriter, clientSensors = {} } = sensors;
  const signals = [
    smartqr.scans24h        > 0 ? `Smart QR : ${smartqr.scans24h} scans dernières 24h`           : null,
    pulsa.responses24h      > 0 ? `Key Form : ${pulsa.responses24h} nouvelles réponses 24h`      : null,
    ghostwriter.usedToday   > 0 ? `Ghost Writer : ${ghostwriter.usedToday}/${ghostwriter.quotaToday ?? '∞'} utilisé aujourd'hui` : null,
    clientSensors.brainstormingDraftAgeHours > 0 ? `Brainstorming en pause depuis ${Math.round(clientSensors.brainstormingDraftAgeHours)}h` : null,
    clientSensors.annoncesDrafts > 0 ? `${clientSensors.annoncesDrafts} annonces immo brouillons` : null,
    clientSensors.kodexLastBriefAgeDays > 0 ? `Dernier brief Brief Prod il y a ${Math.round(clientSensors.kodexLastBriefAgeDays)} jours` : null,
  ].filter(Boolean);

  if (!signals.length) return null;

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
    '- Pas de "Bonjour" / "Salut" (déjà dit au-dessus)',
    '- Pas d\'emoji, pas de question vide, pas de CTA fictif',
    '- Réponse JSON STRICT : {"phrase":"..."}',
  ].join('\n');

  const userPrompt = [
    `Contexte : ${moment} de ${weekday}, prénom ${firstName}.`,
    'Signaux disponibles :',
    ...signals.map(s => `- ${s}`),
    '',
    'Choisis le signal le plus pertinent et formule une phrase courte qui fait gagner du temps à l\'utilisateur (rappel utile, observation factuelle, ou nudge léger). Pas d\'invention de chiffre.',
    'Génère le JSON {"phrase"} maintenant.',
  ].join('\n');

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

  let parsed = null;
  try {
    const cleaned = rawText
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
  // Garde-fou : si phrase vide ou trop courte, on rejette
  return phrase.length >= 8 ? phrase : null;
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
  const [smartqr, pulsa, ghostwriter, pilotable] = await Promise.all([
    _sensorSmartQR(env),
    _sensorPulsa(env, lookupHmac),
    _sensorGhostWriter(env, lookupHmac, claims?.plan),
    _fetchActivePilotable(env, plan),
  ]);

  const sensors = { smartqr, pulsa, ghostwriter, clientSensors };

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
    const aiText = await _buildAiPhrase(env, sensors, firstName);
    if (aiText) {
      return json({ mode: 'ai', text: aiText, icon: 'sparkles', ttl: 120 }, 200, origin);
    }
    // sinon fallback Calculateur
    return json({ mode: 'calculator', text: _buildCalculatorPhrase(sensors), icon: 'bar-chart', ttl: 90 }, 200, origin);
  }
  if (preferMode === 'calculator') {
    return json({ mode: 'calculator', text: _buildCalculatorPhrase(sensors), icon: 'bar-chart', ttl: 90 }, 200, origin);
  }
  if (preferMode === 'pilotable' && pilotable) {
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

  // 2. Pas de preferMode → cycle par défaut au boot
  // Premier appel : on commence par le mode IA si signaux disponibles, sinon Calculateur.
  // (Le frontend gère la rotation 8-12s en envoyant preferMode aux appels suivants.)
  const aiText = await _buildAiPhrase(env, sensors, firstName);
  if (aiText) {
    return json({ mode: 'ai', text: aiText, icon: 'sparkles', ttl: 120 }, 200, origin);
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
  return json({
    mode: 'calculator',
    text: _buildCalculatorPhrase(sensors),
    icon: 'bar-chart',
    ttl:  90,
  }, 200, origin);
}
