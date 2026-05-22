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
     3. Vérifier dans le dashboard Cloudflare > Workers AI que Gemma 4
        est activé (modèle @cf/google/gemma-4-26b-a4b-it).
     4. Free tier 10K neurones/jour. Au-delà : 0,011 $/1000 neurones.

   Garde-fous V1 :
     - Texte ≤ 5000 caractères
     - Texte ≥ 5 caractères significatifs
     - max_tokens cappé à 2048 (3 variantes ~600 tokens chacune + label)
     - Pas de quota côté server (hard-limit 10/jour côté frontend en V1).
       Migration KV pour quota cross-request prévue en Phase 2.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

// Modèle Gemma 4 sur Workers AI (April 2026 — MoE 26B / 4B actifs)
const MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';

// Garde-fous
const MAX_TEXT_LENGTH    = 5000;
const MIN_TEXT_LENGTH    = 5;
const DEFAULT_MAX_TOKENS = 2048;
const MAX_MAX_TOKENS     = 4096;

export async function handleGhostwriterRewrite(request, env) {
  const origin = getAllowedOrigin(env, request);

  // ── Auth obligatoire (JWT licence) ──────────────────────────
  // Pas anonyme : le Worker free tier est limité, on évite que ça
  // serve de relais public à n'importe qui. Comme proxy-llm.
  const claims = await requireJWT(request, env);
  if (!claims) {
    return err('Authentification requise (JWT licence)', 401, origin);
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
    return err(`Workers AI erreur : ${e.message || 'inconnue'}`, 502, origin);
  }

  // ── Extraction de la réponse ─────────────────────────────────
  // Workers AI renvoie selon le modèle :
  //   - { response: "..." } pour les modèles génératifs
  //   - { result: { response: "..." } } pour certains wrapper variants
  const rawText = aiResponse?.response
    || aiResponse?.result?.response
    || aiResponse?.choices?.[0]?.message?.content
    || '';

  if (!rawText) {
    return err('Réponse Workers AI vide', 502, origin);
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
  return json({
    variants: parsed.variants,
    model   : MODEL_ID,
    usage   : aiResponse?.usage || null,
  }, 200, origin);
}
