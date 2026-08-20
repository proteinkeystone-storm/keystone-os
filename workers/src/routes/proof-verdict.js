/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — GP-5 · L'ARBITRAGE INVISIBLE

   Grammalecte souligne instantanément, comme toujours. En arrière-plan,
   un modèle juge les seuls passages douteux, et les alertes injustifiées
   s'effacent en silence. Aucun bouton, aucune attente, aucune alerte
   ajoutée.

   ── Ce que ce juge n'a PAS le droit de faire ───────────────────
   · Il ne REÇOIT jamais le document. Uniquement le mot signalé et la
     PHRASE qui le porte. Un article ne quitte pas le navigateur.
   · Il ne RÉÉCRIT rien. Il rend un verdict par alerte, point.
   · Il ne peut QU'ENLEVER du bruit. Une alerte qu'il n'a pas jugée,
     ou qu'il juge mal, reste affichée. Le pire qu'il puisse faire,
     c'est ne servir à rien — jamais faire corriger une phrase juste.
   · Il ne juge QUE l'orthographe (mots inconnus). Les accords lui sont
     interdits tant que la mesure n'a pas prouvé qu'il y est fiable —
     brief §5/GP-5, critère de mise en service.

   ── Le seul vrai danger : masquer une VRAIE faute ──────────────
   D'où le doute qui profite à l'alerte : réponse illisible, item non
   jugé, modèle muet, quota épuisé, hors ligne → l'alerte RESTE.
   Toutes les portes de sortie de ce fichier vont dans ce sens.

   ── L'économie ─────────────────────────────────────────────────
   ⚠ Précédent Living Layer : 98 % de la consommation IA du compte
   parce qu'un service s'appelait tout seul. Ici l'analyse se relance
   à chaque frappe ou presque. Donc :
   · UN SEUL appel groupé par analyse, plafonné à 25 passages ;
   · un CACHE serveur par (mot + phrase), 30 jours : la deuxième frappe
     dans le même paragraphe ne coûte rien ;
   · et surtout, GP-2 : un nom jugé légitime rejoint le dictionnaire de
     la maison et n'est plus JAMAIS envoyé. Le coût décroît à l'usage.

   ── Transparence (brief §4.4) ──────────────────────────────────
   Le correcteur promet par écrit que la détection ne quitte pas le
   navigateur. Cette promesse reste vraie : la DÉTECTION est locale.
   Seuls des fragments déjà signalés partent, et seulement si le
   réglage « arbitrage » est actif — il se coupe dans les Réglages,
   et la documentation le dit.

   Route : POST /api/ghostwriter/proof-verdict
     body  { items: [{ id, mot, phrase }] }        (25 max)
     → 200 { verdicts: { id: 'vraie'|'faux-positif' }, juges, cache, model }
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';

const MODEL_ID    = KS_AI_MODEL;
const MAX_ITEMS   = 25;          // un seul appel groupé, plafonné
const MAX_MOT     = 60;
const MAX_PHRASE  = 400;         // la phrase, pas le paragraphe
const CACHE_JOURS = 30;

let _schemaReady = false;
async function ensureSchema(env) {
  if (_schemaReady) return;
  // On ne stocke QUE l'empreinte du couple (mot, phrase) : aucun texte de
  // client ne dort dans cette table. Le cache est commun à tout le monde —
  // une empreinte ne révèle rien, et le partage fait chuter le coût.
  // ⚠ On ne lève le drapeau QUE si la création a réussi. Le marquer d'office
  // après un échec passager condamnerait le cache pour toute la vie de
  // l'isolat — et sans cache, chaque frappe rappelle le modèle. C'est
  // exactement le scénario Living Layer (98 % de la consommation IA).
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS proof_verdict_cache (
        hash       TEXT PRIMARY KEY,
        verdict    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    _schemaReady = true;
  } catch (_) { /* on retentera au prochain appel */ }
}

async function empreinte(mot, phrase) {
  const data = new TextEncoder().encode(String(mot) + ' | ' + String(phrase));
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ── Le texte rendu par Workers AI ───────────────────────────────
// ⚠ Le binding rend TANTÔT un objet, TANTÔT une chaîne. Un `.trim()`
// direct sur l'objet a déjà coûté un TypeError avalé par un catch.
function texteIA(rep) {
  if (typeof rep === 'string') return rep;
  const pistes = [
    rep?.choices?.[0]?.message?.content,
    rep?.response, rep?.result?.response,
    rep?.output?.[0]?.content?.[0]?.text,
    rep?.message?.content, rep?.text, rep?.completion,
  ];
  for (const p of pistes) if (typeof p === 'string' && p.trim()) return p;
  return '';
}

const SYSTEME = [
  'Tu es juge, pas correcteur. Tu ne réécris RIEN.',
  "On te donne des mots qu'un correcteur automatique a signalés comme inconnus,",
  'chacun avec la phrase où il apparaît. Pour chacun, dis si l\'alerte est justifiée.',
  '',
  'faux-positif = le mot est CORRECT dans cette phrase : nom propre (personne, lieu,',
  '  unité, organisation, marque), mot étranger, terme de métier, sigle, mot rare',
  '  mais bien orthographié.',
  'vraie = le mot est mal orthographié.',
  '',
  'En cas de DOUTE, réponds "vraie" : laisser une alerte de trop est sans gravité,',
  "effacer une vraie faute ne l'est pas.",
  '',
  'Réponds UNIQUEMENT par un objet JSON { "identifiant": "vraie"|"faux-positif" },',
  'une clé par identifiant reçu, sans commentaire ni texte autour.',
].join('\n');

// Lecture défensive : on n'accepte que les identifiants ENVOYÉS, et que les
// deux verdicts prévus. Tout le reste est ignoré — le modèle ne peut pas
// inventer une alerte, ni en ressusciter une.
function lireVerdicts(brut, idsAttendus) {
  const out = {};
  if (!brut) return out;
  let obj = null;
  try {
    const m = String(brut).match(/\{[\s\S]*\}/);   // le JSON, même noyé dans du bavardage
    if (m) obj = JSON.parse(m[0]);
  } catch (_) { return out; }
  if (!obj || typeof obj !== 'object') return out;
  for (const id of idsAttendus) {
    const v = obj[id];
    if (v === 'vraie' || v === 'faux-positif') out[id] = v;
  }
  return out;
}

export async function handleProofVerdict(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);
  const lookupHmac = claims.sub;
  const plan       = claims.plan;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  const body = await parseBody(request);
  const brut = Array.isArray(body && body.items) ? body.items : [];
  // Nettoyage : on ne garde que ce qui est jugeable, et on borne tout.
  const items = [];
  for (const it of brut.slice(0, MAX_ITEMS)) {
    const id     = String(it && it.id != null ? it.id : '').slice(0, 40);
    const mot    = String((it && it.mot) || '').trim().slice(0, MAX_MOT);
    const phrase = String((it && it.phrase) || '').trim().slice(0, MAX_PHRASE);
    if (id && mot && phrase) items.push({ id, mot, phrase });
  }
  if (!items.length) return json({ verdicts: {}, juges: 0, cache: 0, model: null }, 200, origin);

  await ensureSchema(env);

  // ── 1 · le cache : ce qui a déjà été jugé ne repart pas ────────
  const verdicts = {};
  const aJuger   = [];
  let vusEnCache = 0;
  for (const it of items) {
    it.hash = await empreinte(it.mot, it.phrase);
    const row = await env.DB
      .prepare('SELECT verdict FROM proof_verdict_cache WHERE hash = ? AND created_at > datetime(\'now\', ?)')
      .bind(it.hash, '-' + CACHE_JOURS + ' days').first().catch(() => null);
    if (row && (row.verdict === 'vraie' || row.verdict === 'faux-positif')) {
      verdicts[it.id] = row.verdict; vusEnCache++;
    } else {
      aJuger.push(it);
    }
  }
  if (!aJuger.length) {
    return json({ verdicts, juges: 0, cache: vusEnCache, model: null }, 200, origin);
  }

  // ── 2 · métrage — même patron que la réécriture ────────────────
  const bride = await budgetGuard(env, origin);
  if (bride) return bride;                      // enveloppe admin épuisée

  let enforced = false, credit = null, abouti = false;
  try {
    enforced = await isEnforceEnabled(env, lookupHmac);
    if (enforced) {
      credit = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'ghostwriter' });
      // ⚠ FAIL-OPEN : quota épuisé → on ne bloque RIEN. L'arbitrage est un
      // confort invisible ; l'utilisateur garde Grammalecte tel quel et ne
      // doit jamais voir un mur pour un service qu'il n'a pas demandé.
      if (!credit.ok && credit.blocked) {
        return json({ verdicts, juges: 0, cache: vusEnCache, model: null, raison: 'quota' }, 200, origin);
      }
    }

    if (!env.AI || typeof env.AI.run !== 'function') {
      return json({ verdicts, juges: 0, cache: vusEnCache, model: null, raison: 'ai-absent' }, 200, origin);
    }

    // ── 3 · UN SEUL appel, groupé ───────────────────────────────
    const liste = aJuger.map((it) => it.id + ' | ' + it.mot + ' | ' + it.phrase).join('\n');
    let rep = null;
    try {
      rep = await env.AI.run(MODEL_ID, {
        messages: [
          { role: 'system', content: SYSTEME },
          { role: 'user',   content: 'identifiant | mot signalé | phrase\n' + liste },
        ],
        max_tokens: 600,
      });
    } catch (_) {
      // Modèle indisponible, budget Cloudflare épuisé… : on rend ce qu'on a.
      return json({ verdicts, juges: 0, cache: vusEnCache, model: null, raison: 'ai-erreur' }, 200, origin);
    }

    const rendus = lireVerdicts(texteIA(rep), aJuger.map((it) => it.id));
    // Un item non jugé garde son alerte : on ne l'inscrit simplement pas.
    let ecrits = 0;
    const lots = [];
    for (const it of aJuger) {
      const v = rendus[it.id];
      if (!v) continue;
      verdicts[it.id] = v; ecrits++;
      lots.push(env.DB.prepare(
        'INSERT INTO proof_verdict_cache (hash, verdict) VALUES (?, ?) '
        + 'ON CONFLICT(hash) DO UPDATE SET verdict = excluded.verdict, created_at = datetime(\'now\')',
      ).bind(it.hash, v));
    }
    if (lots.length) await env.DB.batch(lots).catch(() => {});

    abouti = ecrits > 0;
    if (abouti) {
      await recordUsage(env, 'ghostwriter', {
        usage: rep && rep.usage, inText: SYSTEME + liste, outText: texteIA(rep),
      }).catch(() => {});
    }
    return json({ verdicts, juges: ecrits, cache: vusEnCache, model: MODEL_ID }, 200, origin);
  } finally {
    // Rien jugé → rien facturé.
    if (!abouti && enforced && credit && credit.ok) {
      await refundCredits(env, {
        bucketKey: lookupHmac, tool: 'ghostwriter',
        cost: credit.cost, packsDrawn: credit.packsDrawn,
      }).catch(() => {});
    }
  }
}

/* Exposés pour le banc (workers/test/test-proof-verdict.mjs) : la lecture de
   la réponse du modèle est la pièce qui décide ce qu'on efface à l'écran. */
export { lireVerdicts as _lireVerdicts, texteIA as _texteIA, MAX_ITEMS, SYSTEME as _SYSTEME };
