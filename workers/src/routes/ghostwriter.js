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
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import {
  isEnforceEnabled, consumeCredits, refundCredits,
  ensureAiCreditsSchema, readMonthUsed, readPackBalance, creditsPayload,
} from '../lib/ai-credits.js';

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
    period    : 'day',     // quota/jour legacy → message "réessayez demain"
  };
}

// Chantier B · Sprint 6 — quand l'enforcement « crédits IA » est actif sur
// la licence, Ghost Writer débite le portefeuille mensuel unifié au lieu de
// son compteur/jour. Ce mapper projette le payload du wallet vers la forme
// que le frontend GW attend déjà ({plan, used, max, remaining, unlimited}),
// pour que la pastille de quota du studio reste correcte sans rien changer
// côté client. max = quota inclus + solde de packs.
function _gwQuotaFromWallet(w) {
  if (!w) return null;
  const max = w.unlimited ? null : (w.includedQuota || 0) + (w.packBalance || 0);
  return {
    plan      : (w.plan || 'UNKNOWN').toUpperCase(),
    used      : w.used || 0,
    max,
    remaining : w.unlimited ? null : w.remaining,
    unlimited : !!w.unlimited,
    period    : 'month',   // crédits mensuels → le frontend adapte son message
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

  // ── Bridage budget IA (admin) — AVANT le pre-bump quota ──────
  // Si le bridage global est actif, on coupe ici sans toucher au quota
  // de la licence. Le frontend affiche un message clair (graceful).
  const _throttled = await budgetGuard(env, origin);
  if (_throttled) return _throttled;

  // ── Quota check pre-flight (Phase 2) ─────────────────────────
  // Pre-bump pour atomicité face aux races multi-device (plan MAX
  // notamment). Si quota dépassé après bump → revert + 429.
  // ADMIN : on track quand même les stats mais on ne bloque jamais.
  // Chantier B · Sprint 6 — aiguillage du quota selon le flag de la licence.
  // enforce_ai_credits_v1 ON → portefeuille mensuel unifié (crédits IA).
  // OFF → quota/jour legacy (inchangé). Cohabitation pilotée par licence.
  const creditsEnforced = await isEnforceEnabled(env, lookupHmac);
  let creditResult  = null;   // retour de consumeCredits (chemin enforced)
  let usedAfterBump = 0;      // compteur/jour (chemin legacy)

  if (creditsEnforced) {
    creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'ghostwriter' });
    if (!creditResult.ok && creditResult.blocked) {
      return json({
        error: `Crédits IA épuisés ce mois sur le plan ${plan}. `
             + `Ajoutez un pack de crédits ou attendez le 1er du mois (reset).`,
        code : 'AI_CREDITS_EXHAUSTED',
        quota: _gwQuotaFromWallet(creditResult.payload),
      }, 429, origin);
    }
  } else {
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
    usedAfterBump = await _readUsage(env, lookupHmac);
    if (maxAllowed !== null && usedAfterBump > maxAllowed) {
      await _revertUsage(env, lookupHmac);
      return json({
        error: `Quota Ghost Writer atteint sur le plan ${plan} (${maxAllowed}/jour). `
             + `Passez à un plan supérieur ou réessayez demain (reset 00:00 UTC).`,
        quota: _quotaPayload(plan, maxAllowed),  // reflète l'état clampé
      }, 429, origin);
    }
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

  // ── Appel Mistral via Workers AI, avec réessai si le JSON est cassé ──
  // Les LLM produisent parfois du JSON invalide (clé omise, virgule en trop,
  // préface…). Un seul appel suffisait à faire échouer toute la réécriture.
  // On réessaie UNE fois : le modèle réussit quasi toujours au 2e essai. Le
  // quota a déjà été bumpé UNE seule fois (try/finally en amont) → 1 réécriture
  // = 1 crédit, même si le modèle a fallu 2 tentatives.
  const MAX_AI_ATTEMPTS = 2;
  let aiResponse = null;
  let parsed     = null;
  let lastRawText = '';
  let lastIssue   = '';

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    try {
      aiResponse = await env.AI.run(MODEL_ID, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: `Texte source à réécrire :\n\n${text}` },
        ],
        max_tokens: cappedMaxTokens,
      });
    } catch (e) {
      // Budget Workers AI gratuit épuisé (Cloudflare 4006). PAS le quota GW de
      // la licence (ADMIN = illimité) — c'est l'allocation gratuite du COMPTE
      // (10 000 neurones/jour), partagée par tous les outils IA. Un réessai
      // n'aide pas → on sort tout de suite avec un code stable pour le front.
      const m = String(e?.message || e || '');
      if (/\b4006\b|daily free allocation|neurons|workers paid/i.test(m)) {
        return json({
          error: 'Limite IA quotidienne atteinte — ça repart à 00h00 UTC (~2h du matin).',
          code : 'AI_BUDGET_EXHAUSTED',
        }, 429, origin);
      }
      // Erreur AI transitoire (« Load failed » côté front vient souvent de là) :
      // on retente si possible, sinon on remonte l'erreur.
      lastIssue = `Workers AI erreur : ${e.message || 'inconnue'}`;
      if (attempt >= MAX_AI_ATTEMPTS) return err(lastIssue, 502, origin);
      continue;
    }

    try { console.log(`[ghostwriter] aiResponse keys (essai ${attempt}):`, Object.keys(aiResponse || {})); } catch (_) {}

    // Cas "tronqué par max_tokens" : le modèle a vidé son budget avant d'écrire
    // (finish_reason=length, content vide). Retentable.
    const choice0 = aiResponse?.choices?.[0];
    if (choice0?.finish_reason === 'length' && !choice0?.message?.content) {
      lastIssue = `budget tokens épuisé (max=${cappedMaxTokens})`;
      continue;
    }

    // Extraction de la réponse (formes variables selon le modèle Workers AI).
    const rawText = aiResponse?.response
      || aiResponse?.result?.response
      || aiResponse?.choices?.[0]?.message?.content
      || aiResponse?.output?.[0]?.content?.[0]?.text
      || aiResponse?.message?.content
      || aiResponse?.text
      || aiResponse?.completion
      || '';
    lastRawText = rawText;
    if (!rawText) { lastIssue = 'réponse vide'; continue; }

    // Parse TOLÉRANT (préface/fences enlevés, 1 à 3 variantes acceptées,
    // labels manquants complétés). null → on retente.
    const candidate = _parseVariants(rawText);
    if (candidate) { parsed = candidate; break; }
    lastIssue = `JSON inexploitable (raw: ${rawText.slice(0, 160)})`;
  }

  if (!parsed) {
    return err(
      `Le modèle (Mistral) n'a pas renvoyé de variantes exploitables après ${MAX_AI_ATTEMPTS} essais. ${lastIssue}`,
      502,
      origin,
    );
  }

  // ── Compteur budget IA (best-effort, ne casse jamais la réponse) ──
  await recordUsage(env, 'ghostwriter', {
    usage : aiResponse?.usage,
    inText: systemPrompt + text,
    outText: lastRawText,
  });

  // ── Réponse normalisée ───────────────────────────────────────
  // committed=true AVANT le return : le finally verra true et ne
  // revertra pas. Toute exception après ce point laisserait le
  // bump appliqué — c'est ce qu'on veut puisque l'AI a déjà run.
  committed = true;
  return json({
    variants: parsed.variants,
    model   : MODEL_ID,
    usage   : aiResponse?.usage || null,
    quota   : creditsEnforced ? _gwQuotaFromWallet(creditResult.payload) : _quotaPayload(plan, usedAfterBump),
  }, 200, origin);

  } finally {
    // Chantier B · Sprint 6 — réversion si on n'a pas abouti (body invalide,
    // AI down, JSON cassé…) : chemin enforced → refund exact du portefeuille
    // (crédit + packs entamés) ; chemin legacy → revert du compteur/jour.
    if (!committed) {
      if (creditsEnforced) {
        if (creditResult && creditResult.ok) {
          await refundCredits(env, {
            bucketKey: lookupHmac, tool: 'ghostwriter',
            cost: creditResult.cost, packsDrawn: creditResult.packsDrawn,
          }).catch(() => {});
        }
      } else {
        await _revertUsage(env, lookupHmac).catch(() => {});
      }
    }
  }
}

// Parse TOLÉRANT de la réponse du modèle pour la réécriture. Retourne
// { variants:[{label,text}] } (1 à 3) ou null si rien d'exploitable. Tolère :
// blocs de code, préface/suffixe autour du JSON, labels manquants. Ne DEVINE
// PAS un `text` absent (le réessai côté handler s'en charge).
function _parseVariants(rawText) {
  let s = String(rawText || '')
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  // Isole le 1er objet { … } si le modèle a ajouté du texte autour.
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let obj;
  try { obj = JSON.parse(s); } catch (_) { return null; }
  if (!obj || !Array.isArray(obj.variants)) return null;
  const variants = obj.variants
    .filter(v => v && typeof v.text === 'string' && v.text.trim())
    .slice(0, 3)
    .map((v, i) => ({
      label: (typeof v.label === 'string' && v.label.trim()) ? v.label.trim() : `Variante ${i + 1}`,
      text : v.text.trim(),
    }));
  return variants.length >= 1 ? { variants } : null;
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

  // Sprint 6 — si l'enforcement crédits est actif sur la licence, renvoyer
  // l'état du portefeuille mensuel (mappé au format GW) ; sinon quota/jour.
  if (await isEnforceEnabled(env, lookupHmac)) {
    await ensureAiCreditsSchema(env);
    const usedM = await readMonthUsed(env, lookupHmac);
    const bal   = await readPackBalance(env, lookupHmac);
    return json(_gwQuotaFromWallet(creditsPayload(claims.plan, usedM, bal, {})), 200, origin);
  }
  await ensureGhostwriterSchema(env);
  const used = await _readUsage(env, lookupHmac);
  return json(_quotaPayload(claims.plan, used), 200, origin);
}
