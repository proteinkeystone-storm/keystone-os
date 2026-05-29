/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — AI Generate (Phase 3 / 2026-05-23 soir)
   Layer 2 · Génération texte libre via Gemma 4 / Workers AI

   Pourquoi un endpoint séparé de /api/ghostwriter/rewrite ?
   ─────────────────────────────────────────────────────────────
   - /rewrite est spécialisé : reformule un texte en 3 variantes,
     format de sortie imposé { variants: [{label, text}×3] }.
   - Ici on a besoin d'une génération libre (markdown long, format
     custom) — typiquement Annonces Immo qui produit N blocs
     d'annonces structurées par portail.
   - Mêmes auth + même quota (table ghostwriter_usage partagée),
     même modèle Gemma 4, mais payload de sortie = texte brut.

   Route exposée :
     POST /api/ai/generate
     Auth : JWT licence requise (pas anonyme).
     Body : { systemPrompt, userPrompt, maxOutputTokens? }
     Réponse : { text, model, usage, quota: {used, max, remaining, plan} }

   Quota :
     Partagé avec Ghost Writer rewrite (cohérence : 1 appel IA =
     1 décrément quel que soit le type). Lit/écrit la même table
     ghostwriter_usage(lookup_hmac, day, count). Le mécanisme
     pre-bump + revert via try/finally est dupliqué ici plutôt
     que factorisé (l'extraction peut venir après la 3e route).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';

// Réutilise la grille de quota côté ghostwriter.js. Idéalement on
// importerait depuis là-bas, mais ghostwriter.js n'exporte pas ses
// internals. Dupliqué temporairement — à factoriser dans lib/quota.js
// quand on aura le 3e endpoint qui partage le quota.
// Moteur unique Keystone : Mistral Small 3.1 (cf. lib/ai-model.js), ex-Gemma 4.
const MODEL_ID = KS_AI_MODEL;
const MAX_USER_PROMPT_LENGTH   = 20000;   // budget large : pad avec system_prompt long + variables
const MAX_SYSTEM_PROMPT_LENGTH = 30000;
const DEFAULT_MAX_TOKENS = 8192;
const MAX_MAX_TOKENS     = 16384;

function _quotaForPlan(plan) {
  const p = (plan || '').toUpperCase();
  if (p === 'DEMO')    return 1;
  if (p === 'STARTER') return 3;
  if (p === 'PRO')     return 10;
  if (p === 'MAX')     return 50;
  if (p === 'ADMIN')   return null;
  return 0;
}

function _todayUtc() { return new Date().toISOString().slice(0, 10); }

let _schemaReady = false;
async function _ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ghostwriter_usage (
      lookup_hmac  TEXT NOT NULL,
      day          TEXT NOT NULL,
      count        INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (lookup_hmac, day)
    )
  `).run().catch(() => {});
  _schemaReady = true;
}

async function _readUsage(env, lookupHmac) {
  const row = await env.DB
    .prepare('SELECT count FROM ghostwriter_usage WHERE lookup_hmac = ? AND day = ?')
    .bind(lookupHmac, _todayUtc())
    .first();
  return row?.count ?? 0;
}

async function _bumpUsage(env, lookupHmac) {
  await env.DB.prepare(`
    INSERT INTO ghostwriter_usage (lookup_hmac, day, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(lookup_hmac, day) DO UPDATE SET
      count = count + 1,
      updated_at = datetime('now')
  `).bind(lookupHmac, _todayUtc()).run();
}

async function _revertUsage(env, lookupHmac) {
  await env.DB.prepare(`
    UPDATE ghostwriter_usage
       SET count = MAX(count - 1, 0),
           updated_at = datetime('now')
     WHERE lookup_hmac = ? AND day = ?
  `).bind(lookupHmac, _todayUtc()).run().catch(() => {});
}

function _quotaPayload(plan, used) {
  const max = _quotaForPlan(plan);
  return {
    plan      : (plan || 'UNKNOWN').toUpperCase(),
    used,
    max,
    remaining : max === null ? null : Math.max(0, max - used),
    unlimited : max === null,
  };
}

export async function handleAiGenerate(request, env) {
  const origin = getAllowedOrigin(env, request);

  // ── Auth obligatoire ────────────────────────────────────────
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);

  const lookupHmac = claims.sub;
  const plan       = claims.plan;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  // ── AI binding check ─────────────────────────────────────────
  if (!env.AI || typeof env.AI.run !== 'function') {
    return err(
      'Workers AI non configuré sur ce Worker. Ajouter [ai] binding = "AI" '
      + 'dans wrangler.toml puis re-deploy.',
      503, origin,
    );
  }

  // ── Quota check + pre-bump ──────────────────────────────────
  await _ensureSchema(env);
  const maxAllowed = _quotaForPlan(plan);
  if (maxAllowed === 0) {
    return err(`Plan inconnu (${plan}). Génération IA indisponible.`, 403, origin);
  }
  await _bumpUsage(env, lookupHmac);
  const usedAfterBump = await _readUsage(env, lookupHmac);
  if (maxAllowed !== null && usedAfterBump > maxAllowed) {
    await _revertUsage(env, lookupHmac);
    return json({
      error: `Quota IA atteint sur le plan ${plan} (${maxAllowed}/jour). `
           + `Passez à un plan supérieur ou réessayez demain (reset 00:00 UTC).`,
      quota: _quotaPayload(plan, maxAllowed),
    }, 429, origin);
  }

  let committed = false;
  try {
    // ── Parse + validate body ───────────────────────────────
    const body = await parseBody(request);
    if (!body || typeof body !== 'object') {
      return err('Body JSON requis', 400, origin);
    }
    const { systemPrompt, userPrompt, maxOutputTokens } = body;

    if (!systemPrompt || typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      return err('Champ "systemPrompt" requis (string non vide)', 400, origin);
    }
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
      return err(
        `systemPrompt trop long (max ${MAX_SYSTEM_PROMPT_LENGTH} caractères, reçu ${systemPrompt.length})`,
        413, origin,
      );
    }
    if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
      return err('Champ "userPrompt" requis (string non vide)', 400, origin);
    }
    if (userPrompt.length > MAX_USER_PROMPT_LENGTH) {
      return err(
        `userPrompt trop long (max ${MAX_USER_PROMPT_LENGTH} caractères, reçu ${userPrompt.length})`,
        413, origin,
      );
    }

    const cappedMaxTokens = Math.min(
      Math.max(parseInt(maxOutputTokens, 10) || DEFAULT_MAX_TOKENS, 256),
      MAX_MAX_TOKENS,
    );

    // ── Appel Gemma 4 ────────────────────────────────────────
    let aiResponse;
    try {
      aiResponse = await env.AI.run(MODEL_ID, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens: cappedMaxTokens,
      });
    } catch (e) {
      return err(`Workers AI erreur : ${e.message || 'inconnue'}`, 502, origin);
    }

    try { console.log('[ai-generate] aiResponse keys:', Object.keys(aiResponse || {})); } catch (_) {}

    // Détection budget tokens épuisé (Gemma 4 reasoning model)
    const choice0 = aiResponse?.choices?.[0];
    if (choice0?.finish_reason === 'length' && !choice0?.message?.content) {
      return err(
        `Gemma 4 a épuisé son budget tokens (max=${cappedMaxTokens}) en mode raisonnement `
        + `avant d'écrire la réponse. Augmentez maxOutputTokens dans le body.`,
        502, origin,
      );
    }

    // Extraction texte (multi-format selon variant Workers AI)
    const rawText = aiResponse?.response
      || aiResponse?.result?.response
      || aiResponse?.choices?.[0]?.message?.content
      || aiResponse?.output?.[0]?.content?.[0]?.text
      || aiResponse?.message?.content
      || aiResponse?.text
      || aiResponse?.completion
      || '';

    if (!rawText || !rawText.trim()) {
      let diag = '';
      try {
        const sample = JSON.stringify(aiResponse).slice(0, 400);
        const keys = aiResponse && typeof aiResponse === 'object'
          ? Object.keys(aiResponse).join(',')
          : 'n/a';
        diag = ` (type=${typeof aiResponse}, keys=[${keys}], sample=${sample})`;
      } catch (_) { diag = ' (aiResponse non-sérialisable)'; }
      return err(`Réponse Workers AI vide${diag}`, 502, origin);
    }

    // Succès — commit le quota et retourne le texte
    committed = true;
    return json({
      text  : rawText,
      model : MODEL_ID,
      usage : aiResponse?.usage || null,
      quota : _quotaPayload(plan, usedAfterBump),
    }, 200, origin);

  } finally {
    if (!committed) {
      await _revertUsage(env, lookupHmac).catch(() => {});
    }
  }
}
