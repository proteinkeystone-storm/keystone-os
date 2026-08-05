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
import { callLLM, byokRoutingEnabled } from '../lib/llm-router.js';
import { quotaForPlan } from '../lib/ghost-quota.js';
import {
  isEnforceEnabled, consumeCredits, refundCredits,
  ensureAiCreditsSchema, readMonthUsed, readPackBalance, creditsPayload,
  resolveQuota, resolveLicenceByHmac,
} from '../lib/ai-credits.js';

// Modèle par défaut Keystone : Mistral Small 3.1 24B (cf. lib/ai-model.js,
// source de vérité unique). Remplace Gemma 4 depuis le 2026-05-29.
const MODEL_ID = KS_AI_MODEL;

// Garde-fous
const MAX_TEXT_LENGTH    = 5000;
const MIN_TEXT_LENGTH    = 5;

// ── Quota par plan (Phase 2 — 2026-05-23) ────────────────────────
// Source de vérité = lib/ghost-quota.js (partagée avec la jauge Living Layer
// pour éviter toute dérive). Le frontend les lit via GET /api/ghostwriter/quota.
function _quotaForPlan(plan) {
  return quotaForPlan(plan);
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
    // Les deux composantes, SÉPARÉES. `max` les additionne, ce qui suffit
    // pour un plafond mais induit en erreur si on l'affiche tel quel : les
    // conversations INCLUSES repartent le 1er du mois, les PACKS jamais.
    // Un « 1300 ce mois » laisse croire qu'on perdra ses packs au
    // changement de mois. Le front a besoin du détail pour le dire juste.
    included  : w.unlimited ? null : (w.includedQuota || 0),
    packs     : w.packBalance || 0,
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

  // ── Parse body TÔT : détection BYOK avant tout métrage ──────
  // (request.json() ne se lit qu'une fois → on parse ici, plus de re-parse
  //  dans le try ci-dessous.)
  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return err('Body JSON requis', 400, origin);
  }
  const {
    text, tone, intent, vouvoie, maxOutputTokens,
    mode, audience, action, lengthTarget,   // Sprint GW-2 (optionnels)
    variants,                               // 1 = relecture (desK) ; défaut 3
    engine, apiKey,                          // BYOK
    source,                                  // Chaîne de contenu — { text, ref } source fournie par l'utilisateur
  } = body;

  // BYOK (D1/D3) : flag + moteur + clé → vendor à SES frais, HORS compteur
  // Keystone (ni budget admin, ni crédits/quota). Sinon → Mistral métré.
  const useByok = byokRoutingEnabled(env) && !!engine && !!apiKey;

  let creditsEnforced = false;   // chemin enforced (portefeuille mensuel)
  let creditResult    = null;    // retour de consumeCredits
  let usedAfterBump   = 0;       // compteur/jour (chemin legacy)

  if (!useByok) {
    // ── Bridage budget IA (admin) — AVANT le pre-bump quota ──────
    const _throttled = await budgetGuard(env, origin);
    if (_throttled) return _throttled;

    // ── Quota / crédits (Chantier B · Sprint 6) — pre-bump atomique ──
    creditsEnforced = await isEnforceEnabled(env, lookupHmac);
    if (creditsEnforced) {
      creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'ghostwriter' });
      if (!creditResult.ok && creditResult.blocked) {
        return json({
          error: `Conversations épuisées ce mois. `
               + `Ajoutez un pack de conversations ou attendez le 1er du mois (reset).`,
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

  // body + champs (text, tone, …, engine, apiKey) déjà parsés/destructurés
  // plus haut (avant le bloc métrage, pour la détection BYOK).

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

  // Chaîne de contenu — DOSSIER SOURCE : matière apportée par l'utilisateur
  // (lien web extrait, texte collé, fichier .md/.txt/.csv ; portée depuis
  // Brainstorming via le rail, ou saisie directement ici). Ancre la rédaction
  // sur des faits. Absente ⇒ message inchangé (100 % rétro-compat).
  const _srcBlock = (source && typeof source.text === 'string' && source.text.trim())
    ? `\n\nDOSSIER SOURCE (matière fournie par l'utilisateur — appuie-toi dessus pour des faits précis ; ne le recopie pas mot pour mot) :\n"""\n${source.text.trim().slice(0, 4000)}\n"""`
    : '';

  // ── Mode « composer un post » (chaîne de contenu → Social Manager) ──
  // UN SEUL post développé (économie de crédits), ton calé sur le RÉSEAU porté,
  // écriture humaine. Distinct du rewrite (3 variantes tonales). Même machinerie
  // quota (1 crédit). Sortie TEXTE BRUT (pas de JSON → rien à casser : la réponse
  // EST le post). N'EXISTE que pour la chaîne ; le Studio garde le rewrite.
  if (body.composePost === true) {
    const sysCompose = _composePostPrompt(typeof body.network === 'string' ? body.network : '');
    // ── BYOK : moteur du client via callLLM (HORS compteur) ───
    if (useByok) {
      let out;
      try {
        out = await callLLM(env, {
          engine, apiKey, system: sysCompose,
          messages  : [{ role: 'user', content: `Angle / idée à développer en post :\n\n${text}${_srcBlock}` }],
          max_tokens: cappedMaxTokens, fallbackOnError: false,
        });
      } catch (e) { return err(e?.message || 'Erreur moteur', e?.httpStatus || 502, origin); }
      const postText = _cleanPost(out.text);
      if (!postText) return err('Le modèle n\'a pas pu composer le post.', 502, origin);
      committed = true;
      return json({
        variants: [{ label: _composeLabel(body.network), text: postText }],
        model: out.model, usage: out.usage, viaBYOK: true, composed: true, quota: null,
      }, 200, origin);
    }
    let aiResp = null, postText = '', issue = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        aiResp = await env.AI.run(MODEL_ID, {
          messages: [
            { role: 'system', content: sysCompose },
            { role: 'user',   content: `Angle / idée à développer en post :\n\n${text}${_srcBlock}` },
          ],
          max_tokens: cappedMaxTokens,
        });
      } catch (e) {
        const m = String(e?.message || e || '');
        if (/\b4006\b|daily free allocation|neurons|workers paid/i.test(m)) {
          return json({ error: 'Limite IA quotidienne atteinte — ça repart à 00h00 UTC (~2h du matin).', code: 'AI_BUDGET_EXHAUSTED' }, 429, origin);
        }
        issue = `Workers AI erreur : ${e.message || 'inconnue'}`;
        if (attempt >= 2) return err(issue, 502, origin);
        continue;
      }
      const c0 = aiResp?.choices?.[0];
      if (c0?.finish_reason === 'length' && !c0?.message?.content) { issue = `budget tokens épuisé (max=${cappedMaxTokens})`; continue; }
      postText = _cleanPost(_aiText(aiResp));
      if (postText) break;
      issue = 'réponse vide';
    }
    if (!postText) return err(`Le modèle n'a pas pu composer le post. ${issue}`, 502, origin);

    await recordUsage(env, 'ghostwriter', { usage: aiResp?.usage, inText: sysCompose + text, outText: postText });
    committed = true;
    return json({
      variants: [{ label: _composeLabel(body.network), text: postText }],
      model   : MODEL_ID,
      usage   : aiResp?.usage || null,
      quota   : creditsEnforced ? _gwQuotaFromWallet(creditResult.payload) : _quotaPayload(plan, usedAfterBump),
      composed: true,
    }, 200, origin);
  }

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
  // GW-Symboles (2026-07) — palette de symboles TEXTE autorisée par contexte :
  // l'IA peut structurer avec des caractères Unicode sobres (jamais d'emoji),
  // calibrés sur le registre du contexte. « Quand c'est utile », pas un tic.
  const MODE_DIRECTIVES = {
    email:     'Contexte : email professionnel. Structure attendue : ouverture brève, corps clair, clôture polie. Pour une énumération, tu peux utiliser sobrement « • » ou « – » ; aucun autre symbole, jamais d\'emoji.',
    internal:  'Contexte : communication interne d\'équipe. Ton direct, sans formules de politesse excessives, droit au but. Tu peux structurer avec « • », « → » et « ✓ » quand c\'est utile ; jamais d\'emoji.',
    marketing: 'Contexte : copywriting marketing court. Punchy, mémorable, orienté action. Privilégier verbes forts et bénéfices clients. Tu peux ponctuer avec des symboles texte sobres (→ ✓ ▸ •) quand ils renforcent le message — sans en abuser ; jamais d\'emoji.',
    long:      'Contexte : texte long (article, post LinkedIn, newsletter). Structuration claire, transitions soignées, ton engageant. Tu peux structurer listes et étapes avec des symboles texte sobres : • – → ✓ ① ② ③ — avec parcimonie ; jamais d\'emoji.',
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

  // RELECTURE (variants:1) — on rend UNE copie corrigée, pas un choix de
  // formulations : demander « 3 variantes tonales » n'a aucun sens quand on
  // relit le texte d'un auteur. Défaut inchangé (3) pour tous les autres pads.
  const nVar = Math.min(3, Math.max(1, parseInt(variants, 10) || 3));
  const solo = nVar === 1;
  /* ── DK-9 · la consigne de RELECTURE ────────────────────────────
     Resserrée le 2026-08-05 après MESURE sur de vrais textes de
     contributeurs (`scripts/mesure-relecture.mjs`). La version d'avant
     tenait sur les textes de démonstration et lâchait sur les vrais.
     Trois dérives constatées, chacune adressée nommément ci-dessous :
     · les SIGLES développés — « SLT » → « lieutenant », « DA » →
       « division d'application » (4 fois dans un seul papier). Dans une
       revue de corps, l'abréviation EST le vocabulaire : la développer,
       c'est traduire l'auteur pour un lecteur qui n'existe pas.
     · les PARAGRAPHES recoupés — 6 → 8 sur un texte, 8 → 12 sur un
       autre. Le modèle « aère » l'article. C'est une réécriture de la
       forme, et elle est INVISIBLE dans le comparatif du modal, qui
       neutralise les blancs.
     · les SYNONYMES — « plus faible » → « moindre ». C'est la licence
       « améliorer la fluidité » de l'ancienne consigne qui l'autorisait.
       Elle est retirée : le modal ne promet qu'orthographe, grammaire et
       typographie, la consigne dit maintenant la même chose. */
  const systemPrompt = solo ? [
    'Tu es un correcteur-relecteur professionnel. Tu CORRIGES un texte, tu ne le réécris pas.',
    'Objectif : que l\'auteur relise ta version et y reconnaisse SON texte, mot pour mot, en mieux orthographié.',
    '',
    'CE QUE TU CORRIGES :',
    '- orthographe, grammaire, accords, conjugaison',
    '- ponctuation et typographie française : espaces insécables, guillemets « », apostrophes typographiques, traits d\'union, ligatures (œ, æ)',
    '',
    'CE QUE TU NE TOUCHES JAMAIS — même si tu penses faire mieux :',
    '- les ABRÉVIATIONS, SIGLES et ACRONYMES : tu les recopies EXACTEMENT tels quels. Tu ne les développes JAMAIS, tu n\'ajoutes jamais leur signification entre parenthèses. Le lecteur de cette revue les connaît mieux que toi.',
    '- la DÉCOUPE EN PARAGRAPHES : tu rends EXACTEMENT le même nombre de paragraphes, coupés aux mêmes endroits. Tu ne scindes pas un paragraphe long, tu ne fusionnes pas deux paragraphes courts, tu n\'en ajoutes aucun.',
    '- le CHOIX DES MOTS : aucun synonyme, aucune tournure « plus fluide ». Une phrase grammaticalement correcte se recopie telle quelle, même si tu l\'aurais écrite autrement.',
    '- les CHIFFRES et NOMBRES dans la forme où l\'auteur les a écrits (en chiffres ou en toutes lettres, comme lui).',
    '- les noms propres, les dates, les montants, les faits.',
    '- Ne RIEN ajouter, ne RIEN retirer : ni mot de liaison, ni idée, ni exemple, ni transition.',
    `- Forme d'adresse : ${formalAddress}`,
    '',
    'Pas de commentaire, pas de préface, pas d\'explication. Aucun markdown (pas de **, *, _, #).',
    '',
    'FORMAT DE SORTIE — réponds en TEXTE BRUT, PAS en JSON :',
    '- 1re ligne : exactement « Relecture »',
    '- Lignes suivantes : le texte corrigé, avec une ligne vide entre les paragraphes, aux MÊMES endroits que dans le texte reçu. Rien d\'autre.',
  ].filter(Boolean).join('\n') : [
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
    'FORMAT DE SORTIE — réponds en TEXTE BRUT, PAS en JSON :',
    '- Donne EXACTEMENT 3 variantes.',
    '- Sépare chaque variante par une ligne contenant UNIQUEMENT trois tirets : ---',
    '- Pour chaque variante : la 1re ligne donne le ton en 3-4 mots, les lignes suivantes donnent le texte réécrit.',
    '- N\'écris RIEN d\'autre (pas de JSON, pas d\'accolades, pas de guillemets autour, pas de numéro, pas de markdown).',
    '',
    'Exemple EXACT de structure attendue :',
    'Ton formel et professionnel',
    'Le texte réécrit de la première variante.',
    '---',
    'Ton chaleureux et empathique',
    'Le texte réécrit de la deuxième variante.',
    '---',
    'Ton concis et direct',
    'Le texte réécrit de la troisième variante.',
  ].filter(Boolean).join('\n');

  // ── BYOK : moteur du client via callLLM (HORS compteur) ──────
  if (useByok) {
    let out;
    try {
      out = await callLLM(env, {
        engine, apiKey, system: systemPrompt,
        messages  : [{ role: 'user', content: `${solo ? 'Texte à relire' : 'Texte source à réécrire'} :\n\n${text}${_srcBlock}` }],
        max_tokens: cappedMaxTokens, fallbackOnError: false,
      });
    } catch (e) { return err(e?.message || 'Erreur moteur', e?.httpStatus || 502, origin); }
    const parsedByok = _parseVariants(out.text, solo);
    if (!parsedByok) return err('Le modèle n\'a pas renvoyé de variantes exploitables.', 502, origin);
    // DK-9 : en relecture, l'article ressort avec la découpe de son auteur.
    if (solo && parsedByok.variants[0]) parsedByok.variants[0].text = _recollerParagraphes(text, parsedByok.variants[0].text);
    committed = true;
    return json({ variants: parsedByok.variants, model: out.model, usage: out.usage, viaBYOK: true, quota: null }, 200, origin);
  }

  // ── Appel Mistral via Workers AI : extraction string-safe + réessai ──
  // ⚠️ BUG RACINE (depuis le switch Gemma→Mistral du 2026-05-29) : Mistral
  // (format OpenAI) met le texte dans choices[0].message.content, mais expose
  // AUSSI un champ `response` qui n'est PAS une string → l'ancien extracteur
  // (hérité de Gemma) le prenait en 1er → rawText = OBJET → `.slice`/`.replace`
  // throw → exception worker → « Load failed » côté front, sur CHAQUE réécriture.
  // `_aiText` ne renvoie QUE des strings. + réessai 1× si le JSON du modèle est
  // cassé (le quota a été bumpé 1 seule fois → 1 réécriture = 1 crédit).
  const MAX_AI_ATTEMPTS = 2;
  let aiResponse  = null;
  let parsed      = null;
  let lastRawText = '';
  let lastIssue   = '';

  for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt++) {
    try {
      aiResponse = await env.AI.run(MODEL_ID, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: `${solo ? 'Texte à relire' : 'Texte source à réécrire'} :\n\n${text}${_srcBlock}` },
        ],
        max_tokens: cappedMaxTokens,
      });
    } catch (e) {
      // Budget Workers AI gratuit épuisé (Cloudflare 4006). PAS le quota GW de la
      // licence (ADMIN illimité) — allocation gratuite du COMPTE, partagée par
      // tous les outils IA. Un réessai n'aide pas → sortie immédiate, code stable.
      const m = String(e?.message || e || '');
      if (/\b4006\b|daily free allocation|neurons|workers paid/i.test(m)) {
        return json({
          error: 'Limite IA quotidienne atteinte — ça repart à 00h00 UTC (~2h du matin).',
          code : 'AI_BUDGET_EXHAUSTED',
        }, 429, origin);
      }
      lastIssue = `Workers AI erreur : ${e.message || 'inconnue'}`;
      if (attempt >= MAX_AI_ATTEMPTS) return err(lastIssue, 502, origin);
      continue;
    }

    try { console.log(`[ghostwriter] aiResponse keys (essai ${attempt}):`, Object.keys(aiResponse || {})); } catch (_) {}

    // Tronqué par max_tokens (modèle qui vide son budget avant d'écrire).
    const choice0 = aiResponse?.choices?.[0];
    if (choice0?.finish_reason === 'length' && !choice0?.message?.content) {
      lastIssue = `budget tokens épuisé (max=${cappedMaxTokens})`;
      continue;
    }

    const rawText = _aiText(aiResponse);   // 1re STRING parmi les champs connus
    lastRawText = rawText;
    if (!rawText) { lastIssue = 'réponse vide ou non-textuelle'; continue; }

    const candidate = _parseVariants(rawText, solo);   // tolérant (fences/préface, 1-3, labels)
    if (candidate) { parsed = candidate; break; }
    lastIssue = `JSON inexploitable (raw: ${String(rawText).slice(0, 160)})`;
  }

  if (!parsed) {
    return err(
      `Le modèle (Mistral) n'a pas renvoyé de variantes exploitables après ${MAX_AI_ATTEMPTS} essais. ${lastIssue}`,
      502, origin,
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
  // DK-9 : en relecture, l'article ressort avec la découpe de son auteur.
  if (solo && parsed.variants[0]) parsed.variants[0].text = _recollerParagraphes(text, parsed.variants[0].text);
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
    if (!committed && !useByok) {
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

// Guides de ton/longueur par réseau pour le mode « composer un post ».
const _NET_GUIDE = {
  linkedin : 'Réseau : LinkedIn. Ton professionnel mais incarné (leadership d\'opinion). Longueur DÉVELOPPÉE (800-1300 caractères). Accroche forte sur 1-2 lignes, corps qui développe une idée avec du concret, chute ou ouverture. Aère avec des sauts de ligne.',
  facebook : 'Réseau : Facebook. Ton chaleureux et accessible, conversationnel. Longueur moyenne (400-700 caractères). Accroche qui crée la curiosité, corps clair, invitation implicite à réagir.',
  instagram: 'Réseau : Instagram. Ton inspirant et proche. Longueur moyenne. Accroche qui arrête le scroll, corps rythmé ; éventuellement 2-3 hashtags pertinents tout à la fin.',
  threads  : 'Réseau : Threads. Ton spontané et direct. COURT (max 480 caractères). Une idée forte, punchy, qui donne envie de répondre.',
  telegram : 'Réseau : Telegram (canal). Ton informatif, clair et direct. Longueur moyenne. Va à l\'essentiel, structure lisible.',
};

// Prompt système du mode « composer un post » : UN post développé, ton calé sur
// le réseau, écriture humaine (anti-tics d'IA). Sortie = texte brut prêt à publier.
function _composePostPrompt(network) {
  const guide = _NET_GUIDE[String(network || '').toLowerCase()]
    || 'Post social engageant, ton naturel, longueur moyenne à développée selon le sujet.';
  return [
    'Tu es un excellent rédacteur de contenu pour les réseaux sociaux, en français.',
    'À partir de l\'ANGLE/IDÉE fourni, écris UN SEUL post complet, original et intéressant —',
    'un vrai contenu publiable qui APPORTE de la valeur, PAS une reformulation de l\'angle.',
    '',
    guide,
    '',
    'Écriture (important) :',
    '- Développe avec du concret : un exemple, un bénéfice clair, un point de vue assumé.',
    '- Écris comme un HUMAIN : phrases de longueurs variées, rythme naturel, zéro remplissage.',
    '- ÉVITE les tics d\'IA : « dans un monde où », « il est important de », « plongeons »,',
    '  « en somme », « n\'hésitez pas à », superlatifs creux, tirets cadratins à répétition,',
    '  listes à puces génériques, conclusions moralisatrices.',
    '- Pas de méta-commentaire, pas de titre « Post : », pas de guillemets autour, pas de markdown.',
    '',
    'Sortie : UNIQUEMENT le texte du post, prêt à publier. Rien d\'autre.',
  ].join('\n');
}

// Nettoie le post : enlève fences/guillemets enveloppants/préfixe « Post : ».
function _cleanPost(s) {
  let t = String(s || '').trim();
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
  t = t.replace(/^["'«»“”]\s*/, '').replace(/\s*["'«»“”]$/, '').trim();
  t = t.replace(/^(post|texte)\s*:\s*/i, '').trim();
  return t;
}

// Libellé de la variante composée (1 seule), selon le réseau.
function _composeLabel(network) {
  const L = { linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', telegram: 'Telegram' };
  const l = L[String(network || '').toLowerCase()];
  return l ? `Post ${l}` : 'Post';
}

// Extrait la 1re STRING non vide parmi les formes de réponse Workers AI connues.
// Mistral (OpenAI-compat) met le texte dans choices[0].message.content ; son
// champ `response` peut être un OBJET → on FILTRE sur le type pour ne JAMAIS
// renvoyer autre chose qu'une string (sinon .slice/.replace en aval throw →
// exception worker → « Load failed »). Priorité au champ canonique OpenAI.
function _aiText(aiResponse) {
  const candidates = [
    aiResponse?.choices?.[0]?.message?.content,
    aiResponse?.response,
    aiResponse?.result?.response,
    aiResponse?.output?.[0]?.content?.[0]?.text,
    aiResponse?.message?.content,
    aiResponse?.text,
    aiResponse?.completion,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return '';
}

// Parse la réponse du modèle → { variants:[{label,text}] } (1 à 3) ou null.
// FORMAT PRINCIPAL = texte délimité (variantes séparées par « --- ») : robuste,
// le modèle ne peut pas « oublier une clé » puisqu'il n'y en a pas (c'était LE
// bug Mistral). Repli JSON (rétro-compat / si le modèle insiste).
function _parseVariants(rawText, solo) {
  const s = String(rawText || '').trim();
  if (!s) return null;
  const looksJson = s.startsWith('{') || /^```/.test(s);
  // RELECTURE (solo) : la réponse attendue est UN bloc — donc SANS ligne « --- ».
  // Exiger le séparateur ici rejetait une réponse pourtant parfaite. _parseDelimited
  // sait déjà lire un bloc unique (1re ligne = label si courte, reste = texte).
  if (solo) {
    const r = _parseJsonVariants(s) || _parseDelimited(s);
    if (!r || !r.variants.length) return null;
    return { variants: r.variants.slice(0, 1) };   // une seule, même si le modèle en a donné plus
  }
  if (looksJson) {
    return _parseJsonVariants(s) || (_hasDelim(s) ? _parseDelimited(s) : null);
  }
  return (_hasDelim(s) ? _parseDelimited(s) : null) || _parseJsonVariants(s);
}

function _hasDelim(s) {
  return /(^|\n)\s*-{3,}\s*(\n|$)/.test(String(s || ''));
}

// Variantes séparées par une ligne « --- ». 1re ligne du bloc = ton (label),
// reste = texte. Tolérant : enlève guillemets / préfixes « Ton: » parasites.
function _parseDelimited(s) {
  const blocks = String(s || '').split(/(?:^|\n)\s*-{3,}\s*(?:\n|$)/).map(b => b.trim()).filter(Boolean);
  const variants = [];
  for (const block of blocks) {
    /* ⚠ DK-9 — les LIGNES VIDES sont du contenu, pas du bruit.
       Ce parseur les filtrait (`.filter(Boolean)`), ce qui rendait toujours
       un pavé d'un seul tenant. Sur trois variantes courtes ça ne se voyait
       pas ; sur la RELECTURE d'un article de six paragraphes, ça écrasait
       toute la mise en paragraphes — et en silence, car le comparatif mot à
       mot du modal neutralise les blancs (`_diffMots` → `neutraliseBlancs`)
       et ne pouvait donc RIEN montrer. La rédactrice cliquait « Reprendre ce
       texte » et récupérait son article en un seul bloc.
       Mesuré le 2026-08-05 : 5 lignes vides sur 5 perdues, sur trois textes
       sur trois. Gardé par scripts/test-ghostwriter-parse.mjs. */
    const lines = block.split('\n').map(l => l.trim());
    const pleines = lines.filter(Boolean);
    if (!pleines.length) continue;
    const i0 = lines.findIndex(Boolean);
    let label = '', text = '';
    if (pleines.length >= 2 && pleines[0].length <= 70) {
      label = pleines[0].replace(/^(ton|variante)\b\s*[:\-–—]?\s*/i, '').replace(/^["'«»\s]+|["'«»:\-–—\s]+$/g, '').trim();
      text  = lines.slice(i0 + 1).join('\n');
    } else {
      text = lines.slice(i0).join('\n');
    }
    // Un paragraphe se sépare par UNE ligne vide : au-delà, c'est du vide.
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    /* Le modèle enrobe parfois toute sa réponse de guillemets. On ne retire
       la paire QUE si elle enveloppe vraiment le texte entier. Un article qui
       se TERMINE sur une citation — « … » en dernier — est un cas courant en
       rédaction ; raboter son guillemet fermant reviendrait à retirer quelque
       chose à l'auteur, ce que la relecture promet de ne jamais faire. */
    for (const [ouvre, ferme] of [['«', '»'], ['"', '"'], ["'", "'"]]) {
      if (text.startsWith(ouvre) && text.endsWith(ferme) && text.length > 2
          && text.slice(ouvre.length, -ferme.length).includes(ferme) === false) {
        text = text.slice(ouvre.length, -ferme.length).trim();
        break;
      }
    }
    if (text) variants.push({ label: label || `Variante ${variants.length + 1}`, text });
    if (variants.length >= 3) break;
  }
  return variants.length >= 1 ? { variants } : null;
}

// Repli JSON tolérant (fences/préface enlevés, 1-3 variantes, labels complétés).
function _parseJsonVariants(rawText) {
  let s = String(rawText || '').replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
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
    // ⚠️ Le quota DOIT être résolu comme il l'est au débit (consumeCredits
    // → resolveQuota), sinon la jauge annonce un plafond que le mur ne
    // respecte pas. Sous PRICING_V2, une licence dont le plan technique
    // est PRO mais qui ne possède qu'une app Essentiel a 300 conversations,
    // pas les 1 000 de l'ancien palier PRO. Le JWT ne porte pas le sac
    // d'apps → on relit la licence (comme /api/ai-credits/quota).
    const { ownedAssets } = await resolveLicenceByHmac(env, lookupHmac);
    const quota = resolveQuota(env, claims.plan, ownedAssets);
    return json(_gwQuotaFromWallet(creditsPayload(claims.plan, usedM, bal, {}, quota)), 200, origin);
  }
  await ensureGhostwriterSchema(env);
  const used = await _readUsage(env, lookupHmac);
  return json(_quotaPayload(claims.plan, used), 200, origin);
}

/* Exposé pour le banc (scripts/test-ghostwriter-parse.mjs) : le parseur est
   la pièce qui a lâché le 5 août quand la relecture a commencé à rendre UN
   bloc sans séparateur « --- ». Le tester à sec évite d'avoir à faire tourner
   le modèle pour vérifier une règle de lecture. */
export { _parseVariants as gwParseVariants };
export { _recollerParagraphes as gwRecollerParagraphes };

/* ═══════ DK-9 · rendre à l'article SA découpe en paragraphes ═══════
   Mesuré le 2026-08-05 sur trois vrais papiers de L'Épaulette : le
   modèle « aère » le texte qu'on lui donne à relire — 6 paragraphes
   rendus en 8, 8 rendus en 12. Il coupe les longs, jamais il ne
   fusionne. C'est une réécriture de la FORME, et elle est invisible
   dans le comparatif du modal (qui neutralise les blancs) : la
   rédactrice reprend le texte et découvre l'article recomposé.

   Resserrer la consigne système n'y a rien fait (essayé, mesuré : les
   sigles ont cessé d'être développés, la découpe non). On la remet donc
   d'aplomb par le calcul, ce qui a l'avantage d'être déterministe et
   testable sans brûler un neurone.

   Principe : le modèle n'ajoute que des coupures. On recolle donc ses
   blocs pour retrouver le compte de l'auteur, en se calant sur la
   longueur de CHAQUE paragraphe d'origine. Aucun mot n'est touché.

   Garde-fous — on renonce et on rend la copie du modèle telle quelle si
   le texte a trop changé de volume (≥ 8 % de mots d'écart) ou s'il a
   FUSIONNÉ au lieu de couper : dans ces cas-là on ne recolle pas un
   découpage, on masquerait une vraie réécriture. */
function _recollerParagraphes(source, corrige) {
  const decoupe = s => String(s || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const nMots = s => String(s || '').split(/\s+/).filter(Boolean).length;
  const src = decoupe(source), out = decoupe(corrige);
  if (src.length < 2 || out.length <= src.length) return corrige;
  const totalSrc = nMots(source);
  if (!totalSrc || Math.abs(nMots(corrige) - totalSrc) > Math.max(10, totalSrc * 0.08)) return corrige;
  const cibles = src.map(nMots);
  const res = [];
  let i = 0;
  for (let p = 0; p < cibles.length && i < out.length; p++) {
    let bloc = out[i++], n = nMots(bloc);
    const restants = cibles.length - p - 1;   // paragraphes encore à servir
    // On agrège tant que ça RAPPROCHE de la longueur du paragraphe d'origine,
    // sans jamais consommer les blocs dont les paragraphes suivants ont besoin.
    while (i < out.length && (out.length - i) > restants
           && Math.abs(n + nMots(out[i]) - cibles[p]) < Math.abs(n - cibles[p])) {
      bloc += ' ' + out[i]; n += nMots(out[i]); i++;
    }
    res.push(bloc);
  }
  while (i < out.length) res[res.length - 1] += ' ' + out[i++];   // reliquat éventuel
  return res.join('\n\n');
}
