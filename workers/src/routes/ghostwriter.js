/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ghost Writer (Sprint GW-1 / Phase MVP)
   Layer 2 · Service de réécriture textuelle transversal
   Backend : Cloudflare Workers AI + Gemma 4 26B A4B (MoE 4B actifs).
   ─────────────────────────────────────────────────────────────
   Pourquoi un endpoint dédié et pas le proxy LLM existant ?
   ─────────────────────────────────────────────────────────────
   - proxy-llm.js est BYOK (clé utilisateur, vendor tiers, CORS-only).
   - Ici on consomme Workers AI directement via env.AI.run() — gratuit
     dans la free tier (10 000 neurones / jour), zéro setup utilisateur.
   - La promesse Keystone "zero-friction default" passe par ce moteur.
     Les utilisateurs power continueront à passer par proxy-llm avec
     leurs propres clés via le multi-moteur (cf. BRIEF_GHOST_WRITER).

   Route exposée :
     POST /api/ghostwriter/rewrite
     Auth : JWT licence requise (pas anonyme).
     Body : { text, tone?, intent?, vouvoie?, maxOutputTokens? }
     Réponse : { variants: [{label, text}×3], model, usage }

   Pré-requis Cloudflare (à activer par Stéphane avant deploy) :
     1. Ajouter dans wrangler.toml :
          [ai]
          binding = "AI"
     2. Re-deploy : wrangler deploy
     3. Vérifier dans le dashboard Cloudflare > Workers AI que le modèle
        Mistral Small 3.1 est activé (@cf/mistralai/mistral-small-3.1-24b-instruct).
     4. Free tier 10K neurones/jour. Au-delà : 0,011 $/1000 neurones.

   Garde-fous :
     - Texte ≤ 5000 caractères
     - Texte ≥ 5 caractères significatifs
     - max_tokens cappé à 8192 (3 variantes ~600 tokens chacune + label
       + budget reasoning Gemma 4)
     - Quota serveur par licence (Phase 2, 2026-05-23). Grille :
         DEMO     →  1 appel/jour
         STARTER  →  3 appels/jour
         PRO      → 10 appels/jour
         MAX      → 50 appels/jour
         ADMIN    → illimité (tracké pour stats, jamais bloqué)
       Identifiant : claims.sub (lookup_hmac stable de la licence).
       Stockage : D1 ghostwriter_usage (lookup_hmac, day, count).
       Atomicité : pre-bump UPSERT puis revert si AI échoue. Évite
       les races entre devices d'une même licence MAX.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';

// Modèle par défaut Keystone : Mistral Small 3.1 24B (cf. lib/ai-model.js,
// source de vérité unique). Remplace Gemma 4 depuis le 2026-05-29.
const MODEL_ID = KS_AI_MODEL;

// Garde-fous
const MAX_TEXT_LENGTH    = 5000;
const MIN_TEXT_LENGTH    = 5;

// ── Quota par plan (Phase 2 — 2026-05-23) ────────────────────────
// Retourne le quota /jour pour un plan donné. null = illimité (ADMIN).
// Ces valeurs sont la source de vérité — le frontend les lit via
// GET /api/ghostwriter/quota et n'a aucune connaissance hardcodée.
function _quotaForPlan(plan) {
  const p = (plan || '').toUpperCase();
  if (p === 'DEMO')    return 1;
  if (p === 'STARTER') return 3;
  if (p === 'PRO')     return 10;
  if (p === 'MAX')     return 50;
  if (p === 'ADMIN')   return null;   // illimité
  return 0;  // plan inconnu → bloque par défaut (fail-closed)
}

// Jour UTC YYYY-MM-DD. Important : UTC côté serveur, pas locale —
// sinon un user en GMT+12 et un autre en GMT-12 voient leur quota
// reset à des heures différentes selon où le Worker s'exécute.
function _todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// ── Auto-migration schema (idempotent, pattern Keystone) ──────────
// Cf. ensureSchemaAuthV2 dans licence-v2.js pour le même pattern.
let _schemaReady = false;

async function ensureGhostwriterSchema(env) {
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
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_ghostwriter_usage_day ON ghostwriter_usage(day)'
  ).run().catch(() => {});
  _schemaReady = true;
}

// Lit le compteur du jour pour une licence. Retourne 0 si pas de ligne.
async function _readUsage(env, lookupHmac) {
  const row = await env.DB
    .prepare('SELECT count FROM ghostwriter_usage WHERE lookup_hmac = ? AND day = ?')
    .bind(lookupHmac, _todayUtc())
    .first();
  return row?.count ?? 0;
}

// Incrémente atomiquement le compteur du jour (UPSERT). Le bump est
// fait AVANT l'appel AI puis revert si l'AI échoue. Approche choisie
// pour éviter qu'un user spam ne dépasse son quota via races (un MAX
// avec 5 devices pourrait sinon faire 5 appels simultanés à 50/50).
async function _bumpUsage(env, lookupHmac) {
  await env.DB.prepare(`
    INSERT INTO ghostwriter_usage (lookup_hmac, day, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(lookup_hmac, day) DO UPDATE SET
      count = count + 1,
      updated_at = datetime('now')
  `).bind(lookupHmac, _todayUtc()).run();
}

// Revert d'un bump (en cas d'échec AI post-bump). On clamp à 0 pour
// éviter un compteur négatif si une race exotique se produit.
async function _revertUsage(env, lookupHmac) {
  await env.DB.prepare(`
    UPDATE ghostwriter_usage
       SET count = MAX(count - 1, 0),
           updated_at = datetime('now')
     WHERE lookup_hmac = ? AND day = ?
  `).bind(lookupHmac, _todayUtc()).run().catch(() => {});
}

// Construit l'objet quota exposé au frontend. Centralisé pour que
// /quota et /rewrite renvoient la même forme.
function _quotaPayload(plan, used) {
  const max = _quotaForPlan(plan);
  return {
    plan      : (plan || 'UNKNOWN').toUpperCase(),
    used,
    max,                                          // null = illimité
    remaining : max === null ? null : Math.max(0, max - used),
    unlimited : max === null,
  };
}
// Mistral Small 3.1 N'EST PAS un modèle raisonneur : il écrit directement
// le `content`, sans brûler de budget dans un champ `reasoning` (au
// contraire de Gemma 4 qui exigeait 8192). 4096 suffit donc largement pour
// 3 variantes d'un texte ≤ 5000 chars, et c'est moins de neurones consommés.
// Historique : 2048 → 4096 → 8192 (ère Gemma 4) → 4096 (passage Mistral, 2026-05-29).
const DEFAULT_MAX_TOKENS = 4096;
const MAX_MAX_TOKENS     = 16384;

export async function handleGhostwriterRewrite(request, env) {
  const origin = getAllowedOrigin(env, request);

  // ── Auth obligatoire (JWT licence) ──────────────────────────
  // Pas anonyme : le Worker free tier est limité, on évite que ça
  // serve de relais public à n'importe qui. Comme proxy-llm.
  const claims = await requireJWT(request, env);
  if (!claims) {
    return err('Authentification requise (JWT licence)', 401, origin);
  }

  // claims.sub = lookup_hmac (cf. licence-public.js handleActivateV2).
  // Identifiant stable, opaque, non-révélateur de la clé. C'est notre
  // bucket de quota.
  const lookupHmac = claims.sub;
  const plan       = claims.plan;
  if (!lookupHmac) {
    return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);
  }

  // ── AI binding check ─────────────────────────────────────────
  // Si binding pas configuré dans wrangler.toml, on renvoie 503 clair.
  // Évite un crash silencieux côté frontend, message d'erreur lisible.
  if (!env.AI || typeof env.AI.run !== 'function') {
    return err(
      'Workers AI non configuré sur ce Worker. Ajouter [ai] binding = "AI" '
      + 'dans wrangler.toml puis re-deploy.',
      503,
      origin,
    );
  }

  // ── Quota check pre-flight (Phase 2) ─────────────────────────
  // Pre-bump pour atomicité face aux races multi-device (plan MAX
  // notamment). Si quota dépassé après bump → revert + 429.
  // ADMIN : on track quand même les stats mais on ne bloque jamais.
  await ensureGhostwriterSchema(env);
  const maxAllowed = _quotaForPlan(plan);
  if (maxAllowed === 0) {
    return err(
      `Plan inconnu (${plan}). Ghost Writer indisponible pour cette licence.`,
      403,
      origin,
    );
  }
  await _bumpUsage(env, lookupHmac);
  const usedAfterBump = await _readUsage(env, lookupHmac);
  if (maxAllowed !== null && usedAfterBump > maxAllowed) {
    await _revertUsage(env, lookupHmac);
    return json({
      error: `Quota Ghost Writer atteint sur le plan ${plan} (${maxAllowed}/jour). `
           + `Passez à un plan supérieur ou réessayez demain (reset 00:00 UTC).`,
      quota: _quotaPayload(plan, maxAllowed),  // reflète l'état clampé
    }, 429, origin);
  }

  // ── À partir d'ici le quota a été pre-bumpé. Le try/finally
  //    garantit qu'on revert le bump si on retourne avant le succès
  //    (body invalide, texte mal formé, AI down, JSON Gemma cassé...).
  //    Sinon un attaquant pourrait vider le quota d'une licence en
  //    envoyant 50 requêtes avec body={} (chacune retournerait 400
  //    mais consommerait 1 appel). committed=true juste avant le
  //    return de succès neutralise le revert.
  let committed = false;
  try {

  // ── Parse body ───────────────────────────────────────────────
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }

  const {
    text,
    tone,
    intent,
    vouvoie,
    maxOutputTokens,
    // Sprint GW-2 — extensions workspace (artefact A-COM-005)
    mode,         // 'email' | 'internal' | 'marketing' | 'long'  (optionnel)
    audience,     // 'client' | 'superior' | 'peer' | 'unknown' | 'partner'  (optionnel)
    action,       // 'improve' (fluidifier sans dénaturer) | 'rewrite' (réécrire complètement)
    lengthTarget, // 'shorter-50' | 'keep' | 'longer'  (optionnel)
  } = body;

  // Validation texte
  if (!text || typeof text !== 'string') {
    return err('Champ "text" requis (string non vide)', 400, origin);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return err(
      `Texte trop long (max ${MAX_TEXT_LENGTH} caractères, reçu ${text.length})`,
      413,
      origin,
    );
  }
  if (text.trim().length < MIN_TEXT_LENGTH) {
    return err(`Texte trop court (min ${MIN_TEXT_LENGTH} caractères significatifs)`, 400, origin);
  }

  // Cappe max_tokens
  const cappedMaxTokens = Math.min(
    Math.max(parseInt(maxOutputTokens, 10) || DEFAULT_MAX_TOKENS, 256),
    MAX_MAX_TOKENS,
  );

  // ── Construction du prompt système ───────────────────────────
  const formalAddress = vouvoie === true
    ? 'vouvoiement strict'
    : vouvoie === false
      ? 'tutoiement strict'
      : 'à adapter automatiquement selon le contexte du texte';

  const toneDirective = tone
    ? `Ton imposé : ${tone}. Les 3 variantes adaptent ce ton avec des nuances différentes.`
    : 'Variantes diversifiées en ton : formel/professionnel, chaleureux/empathique, concis/direct.';

  const intentDirective = intent
    ? `Objectif de communication : ${intent}. Optimise les variantes pour cet objectif.`
    : '';

  // Sprint GW-2 — directives additionnelles depuis le workspace artefact.
  // Restent silencieuses si le client ne les envoie pas → 100% rétro-compat.
  const MODE_DIRECTIVES = {
    email:     'Contexte : email professionnel. Structure attendue : ouverture brève, corps clair, clôture polie.',
    internal:  'Contexte : communication interne d\'équipe. Ton direct, sans formules de politesse excessives, droit au but.',
    marketing: 'Contexte : copywriting marketing court. Punchy, mémorable, orienté action. Privilégier verbes forts et bénéfices clients.',
    long:      'Contexte : texte long (article, post LinkedIn, newsletter). Structuration claire, transitions soignées, ton engageant.',
  };
  const modeDirective = MODE_DIRECTIVES[mode] || '';

  const AUDIENCE_DIRECTIVES = {
    client:   'Audience : client externe. Registre courtois, vouvoiement par défaut sauf indication contraire.',
    superior: 'Audience : supérieur hiérarchique. Registre soutenu, factuel, sans familiarité.',
    peer:     'Audience : pair / collègue. Registre collaboratif, peut être direct sans froideur.',
    unknown:  'Audience : destinataire inconnu. Neutralité professionnelle par défaut.',
    partner:  'Audience : partenaire externe (fournisseur, prestataire). Cordial et clair sur les attentes.',
  };
  const audienceDirective = AUDIENCE_DIRECTIVES[audience] || '';

  const ACTION_DIRECTIVES = {
    improve: 'Action : améliorer et fluidifier le texte EXISTANT en préservant le maximum de tournures. Pas de réécriture en profondeur — juste corrections, fluidité, clarté.',
    rewrite: 'Action : réécrire complètement le message. Préserver le sens et les faits, mais reformuler librement.',
  };
  const actionDirective = ACTION_DIRECTIVES[action] || ACTION_DIRECTIVES.rewrite;

  const LENGTH_DIRECTIVES = {
    'shorter-50': 'Longueur cible : raccourcir d\'environ 50%. Garder l\'essentiel, supprimer le superflu.',
    'keep':       'Longueur cible : conserver à peu près la longueur originale (± 20%).',
    'longer':     'Longueur cible : développer le texte (étoffer arguments, ajouter détails utiles), sans bavardage.',
  };
  const lengthDirective = LENGTH_DIRECTIVES[lengthTarget] || '';

  const systemPrompt = [
    'Tu es un assistant de réécriture textuelle expert. Tu reformules le texte donné en exactement 3 variantes distinctes, sans le dénaturer.',
    '',
    'Règles strictes :',
    '- Exactement 3 variantes, différentes en ton et formulation',
    `- Forme d'adresse : ${formalAddress}`,
    `- ${toneDirective}`,
    intentDirective,
    modeDirective,
    audienceDirective,
    actionDirective,
    lengthDirective,
    '- Préserver le sens original (faits, dates, montants, noms propres)',
    '- Pas de commentaire, pas de préface, pas d\'explication',
    '- Aucun markdown (pas de **, *, _, #, etc.)',
    '',
    'Sortie : JSON strict avec exactement cette structure (rien d\'autre, pas de bloc ```) :',
    '{',
    '  "variants": [',
    '    { "label": "Description courte du ton (3-4 mots)", "text": "Texte réécrit ici" },',
    '    { "label": "Description courte du ton (3-4 mots)", "text": "Texte réécrit ici" },',
    '    { "label": "Description courte du ton (3-4 mots)", "text": "Texte réécrit ici" }',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');

  // ── Appel Gemma 4 via Workers AI ─────────────────────────────
  let aiResponse;
  try {
    aiResponse = await env.AI.run(MODEL_ID, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Texte source à réécrire :\n\n${text}` },
      ],
      max_tokens: cappedMaxTokens,
    });
  } catch (e) {
    // Cas spécifique : budget Workers AI gratuit épuisé (Cloudflare code
    // 4006). Ce n'est PAS le quota Ghost Writer de la licence (ADMIN =
    // illimité) — c'est l'allocation gratuite quotidienne du COMPTE
    // Cloudflare (10 000 neurones/jour), partagée par TOUS les outils IA
    // (Ghost Writer, Brainstorming, Living Layer, Smart QR). Vu en prod le
    // 2026-05-29 : Brainstorming (9 agents streaming) avait vidé le pot.
    // On renvoie un code stable que le frontend traduit en message clair,
    // au lieu d'exposer l'erreur anglaise brute « 4006: ... neurons ».
    const m = String(e?.message || e || '');
    if (/\b4006\b|daily free allocation|neurons|workers paid/i.test(m)) {
      return json({
        error: 'Limite IA quotidienne atteinte — ça repart à 00h00 UTC (~2h du matin).',
        code : 'AI_BUDGET_EXHAUSTED',
      }, 429, origin);
    }
    return err(`Workers AI erreur : ${e.message || 'inconnue'}`, 502, origin);
  }

  // Log brut pour wrangler tail (utile en cas de bug de format de réponse)
  try { console.log('[ghostwriter] aiResponse keys:', Object.keys(aiResponse || {})); } catch (_) {}

  // ── Détection du cas "tronqué par max_tokens" ────────────────
  // Spécifique aux modèles raisonneurs (Gemma 4 sur Workers AI) qui
  // consomment leur budget dans `reasoning` avant `content`. Vu en
  // prod le 2026-05-23 avec max_tokens=2048 → finish_reason="length"
  // et content=null. Solution : DEFAULT_MAX_TOKENS bumpé à 4096.
  const choice0 = aiResponse?.choices?.[0];
  if (choice0?.finish_reason === 'length' && !choice0?.message?.content) {
    return err(
      `Gemma 4 a épuisé son budget tokens (max=${cappedMaxTokens}) en mode raisonnement `
      + `avant d'écrire la réponse. Réessaie ou augmente maxOutputTokens dans le body.`,
      502,
      origin,
    );
  }

  // ── Extraction de la réponse ─────────────────────────────────
  // Workers AI renvoie selon le modèle :
  //   - { response: "..." } pour les modèles génératifs
  //   - { result: { response: "..." } } pour certains wrapper variants
  //   - { choices: [...] } pour les modèles OpenAI-compatibles (Gemma 4)
  //   - { output: [{ content: [{ text: "..." }] }] } pour certains modèles Llama récents
  const rawText = aiResponse?.response
    || aiResponse?.result?.response
    || aiResponse?.choices?.[0]?.message?.content
    || aiResponse?.output?.[0]?.content?.[0]?.text
    || aiResponse?.message?.content
    || aiResponse?.text
    || aiResponse?.completion
    || '';

  if (!rawText) {
    // Diagnostic enrichi pour identifier la forme exacte de la réponse.
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

  // Strip code fences si Gemma a entouré le JSON (pratique fréquente
  // malgré l'instruction "pas de ```").
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return err(
      `Réponse Gemma 4 mal formée (JSON invalide) : ${e.message}. Raw: ${cleaned.slice(0, 200)}`,
      502,
      origin,
    );
  }

  // Validation structure
  if (!parsed || !Array.isArray(parsed.variants)) {
    return err('Réponse Gemma 4 ne contient pas le champ "variants" (array)', 502, origin);
  }
  if (parsed.variants.length !== 3) {
    return err(
      `Réponse Gemma 4 contient ${parsed.variants.length} variants au lieu de 3`,
      502,
      origin,
    );
  }

  // Sanity check sur chaque variant
  for (let i = 0; i < parsed.variants.length; i++) {
    const v = parsed.variants[i];
    if (!v || typeof v.text !== 'string' || !v.text.trim()) {
      return err(`Variant #${i + 1} mal formé (text manquant ou vide)`, 502, origin);
    }
    if (typeof v.label !== 'string' || !v.label.trim()) {
      v.label = `Variante ${i + 1}`;  // fallback silencieux
    }
  }

  // ── Réponse normalisée ───────────────────────────────────────
  // committed=true AVANT le return : le finally verra true et ne
  // revertra pas. Toute exception après ce point laisserait le
  // bump appliqué — c'est ce qu'on veut puisque l'AI a déjà run.
  committed = true;
  return json({
    variants: parsed.variants,
    model   : MODEL_ID,
    usage   : aiResponse?.usage || null,
    quota   : _quotaPayload(plan, usedAfterBump),
  }, 200, origin);

  } finally {
    if (!committed) {
      await _revertUsage(env, lookupHmac).catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/ghostwriter/quota — Phase 2
// ─────────────────────────────────────────────────────────────
// Retourne l'état du quota pour la licence du JWT. Lecture seule,
// pas de bump. Le frontend appelle ce endpoint au modal open pour
// afficher "X/Y appels restants aujourd'hui" sans deviner le plan.
//
// Réponse 200 : { plan, used, max, remaining, unlimited }
//   max=null & unlimited=true → plan ADMIN
//   max=0                     → plan inconnu (fail-closed)
// ═══════════════════════════════════════════════════════════════
export async function handleGhostwriterQuota(request, env) {
  const origin = getAllowedOrigin(env, request);

  const claims = await requireJWT(request, env);
  if (!claims) {
    return err('Authentification requise (JWT licence)', 401, origin);
  }
  const lookupHmac = claims.sub;
  if (!lookupHmac) {
    return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);
  }

  await ensureGhostwriterSchema(env);
  const used = await _readUsage(env, lookupHmac);
  return json(_quotaPayload(claims.plan, used), 200, origin);
}
