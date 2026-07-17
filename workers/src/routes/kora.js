/* ═══════════════════════════════════════════════════════════════
   KORA — la boucle agent (V1 : LECTURE seulement)
   ─────────────────────────────────────────────────────────────
   Un agent = un LLM + un catalogue d'actions + une boucle
   (KORA_BRIEF §2). Les actions du catalogue vivent CÔTÉ CLIENT
   (app/kora-actions.js — localStorage + endpoints existants), donc
   la boucle est orchestrée par le client en 2 phases :

     phase 'decide' : conversation + catalogue scopé → le modèle
       répond en JSON strict : {"reponse":"…"} (réponse directe)
       ou {"action":"id","args":{…},"annonce":"…"} (lecture à faire).
     phase 'answer' : le client a exécuté la lecture → on renvoie
       le résultat au modèle qui répond en STREAMING SSE
       ({type:'chunk',text}…{type:'done'}) — latence perçue basse.

   Sobriété (§10) : petit modèle (Mistral Small, KS_AI_MODEL),
   catalogue scopé envoyé compact, historique plafonné, 1 crédit
   par TOUR utilisateur (phase decide uniquement, tool 'kora' —
   outil inconnu du barème = 1 par défaut, jamais gratuit).
   Ligne rouge (§7) : le catalogue V1 est en lecture seule par
   construction — aucune écriture possible quoi que dise le modèle.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage } from '../lib/ai-budget.js';
import { isEnforceEnabled, consumeCredits, refundCredits } from '../lib/ai-credits.js';

/* ── Plafonds (historique + catalogue compacts = prompt caching ami) ── */
const MAX_MESSAGES    = 16;     // tours conservés (le client résume au-delà)
const MAX_MSG_CHARS   = 2000;
const MAX_ACTIONS     = 20;
const MAX_DESC_CHARS  = 240;
const MAX_RESULT_CHARS = 8000;  // résultat de lecture renvoyé au modèle
const MAX_TOKENS_DECIDE = 600;
const MAX_TOKENS_ANSWER = 1200;

/* ── Persona gravée (décisions du 17/07/2026, KORA_BRIEF §14) ── */
const PERSONA = `Tu es Kora, l'assistante intégrée de Keystone OS.
Féminine, complice et chaleureuse : tu TUTOIES toujours. Phrases courtes,
langage simple, zéro jargon technique, français impeccable.
Tu parles de ce que TU fais à la première personne (« je regarde… », « je lis… »).
IMPORTANT — ta limite actuelle : tu ne peux QUE LIRE les données de
l'utilisateur (ses séances, ses posts, ses brouillons, ses statistiques).
Tu ne peux encore rien créer, modifier, supprimer ni publier. Si on te le
demande, dis-le simplement (« je ne sais pas encore le faire, ça vient »)
et propose une lecture utile à la place. Jamais d'action destructive.`;

function _sysDecide(actionsBlock) {
  return `${PERSONA}

ACTIONS DE LECTURE DISPONIBLES (ton catalogue, rien d'autre n'existe) :
${actionsBlock}

Tu réponds UNIQUEMENT par un objet JSON, sans texte autour :
- Si tu peux répondre sans lire de données : {"reponse":"ta réponse"}
- S'il faut lire des données : {"action":"id.exact","args":{...},"annonce":"ce que tu t'apprêtes à lire, une phrase à la première personne"}
Règles : n'invente JAMAIS un id d'action hors catalogue ; args = uniquement
les paramètres déclarés ; si la demande est ambiguë entre 2 lectures, choisis
la plus probable au lieu de poser une question.`;
}

const SYS_ANSWER = `${PERSONA}

Tu viens d'exécuter une lecture et son résultat (JSON) t'est fourni dans la
conversation. Réponds à l'utilisateur en t'appuyant UNIQUEMENT sur ce
résultat : concis, concret, chiffres et dates reformulés simplement.
Ne montre jamais le JSON brut. Si le résultat est vide, dis-le simplement
et propose la suite logique. Ne promets aucune action que tu ne sais pas
faire (tu ne peux que lire).`;

/* ── Aides ── */
function _capMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }));
}
function _actionsBlock(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw.slice(0, MAX_ACTIONS).map(a => {
    if (!a || typeof a.id !== 'string') return null;
    const params = Array.isArray(a.params) && a.params.length
      ? ' — args : ' + a.params.map(p => `${p.name}${p.required ? ' (requis)' : ''} [${p.type}]`).join(', ')
      : '';
    return `- ${a.id} : ${String(a.desc || a.label || '').slice(0, MAX_DESC_CHARS)}${params}`;
  }).filter(Boolean);
  return list.length ? list.join('\n') : null;
}
function _extractText(res) {
  return (res?.response
    || res?.result?.response
    || res?.choices?.[0]?.message?.content
    || '').trim();
}
/* Parse défensif du JSON de décision (le modèle peut baver autour) */
function _parseDecision(raw) {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { reponse: raw.slice(0, 1200) };   // pas de JSON → texte direct
  try {
    const p = JSON.parse(m[0]);
    if (typeof p.action === 'string' && p.action.trim()) {
      return {
        action : p.action.trim(),
        args   : (p.args && typeof p.args === 'object') ? p.args : {},
        annonce: typeof p.annonce === 'string' ? p.annonce.slice(0, 300) : '',
      };
    }
    if (typeof p.reponse === 'string') return { reponse: p.reponse };
  } catch (e) { /* fallback texte */ }
  return { reponse: raw.replace(/^```json|```$/g, '').slice(0, 1200) };
}

const _corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

/* ═══ POST /api/kora/chat ═══ */
export async function handleKoraChat(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: _corsHeaders(origin) });
  }

  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);
  const lookupHmac = claims.sub;
  const plan       = claims.plan;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Workers AI non configuré sur ce Worker.', 503, origin);
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') return err('Body JSON requis', 400, origin);

  const phase    = body.phase === 'answer' ? 'answer' : 'decide';
  const messages = _capMessages(body.messages);
  if (!messages.length) return err('messages requis', 400, origin);

  /* Bridage budget opérateur — les deux phases consomment des neurones */
  const throttled = await budgetGuard(env, origin);
  if (throttled) return throttled;

  /* ══ PHASE DECIDE — 1 crédit par tour utilisateur ══ */
  if (phase === 'decide') {
    const actionsBlock = _actionsBlock(body.actions);
    if (!actionsBlock) return err('actions (catalogue scopé) requis', 400, origin);

    let creditsEnforced = false, creditResult = null, committed = false;
    creditsEnforced = await isEnforceEnabled(env, lookupHmac);
    if (creditsEnforced) {
      creditResult = await consumeCredits(env, { bucketKey: lookupHmac, plan, tool: 'kora' });
      if (!creditResult.ok && creditResult.blocked) {
        return json({
          error: `Crédits IA épuisés ce mois sur le plan ${plan}.`,
          code : 'AI_CREDITS_EXHAUSTED',
        }, 429, origin);
      }
    }

    try {
      const sys = _sysDecide(actionsBlock);
      const res = await env.AI.run(KS_AI_MODEL, {
        messages  : [{ role: 'system', content: sys }, ...messages],
        max_tokens: MAX_TOKENS_DECIDE,
        stream    : false,
      });
      const raw = _extractText(res);
      await recordUsage(env, 'kora', {
        usage: res?.usage, inText: sys + JSON.stringify(messages), outText: raw,
      }).catch(() => {});
      const decision = _parseDecision(raw);
      if (!decision) throw new Error('réponse modèle vide');
      committed = true;
      return json(
        decision.action
          ? { type: 'action', id: decision.action, args: decision.args, annonce: decision.annonce }
          : { type: 'reponse', text: decision.reponse || '…' },
        200, origin,
      );
    } catch (e) {
      return err(`Kora indisponible (${e?.message || 'erreur modèle'})`, 502, origin);
    } finally {
      if (!committed && creditsEnforced && creditResult && creditResult.ok) {
        await refundCredits(env, {
          bucketKey: lookupHmac, tool: 'kora',
          cost: creditResult.cost, packsDrawn: creditResult.packsDrawn,
        }).catch(() => {});
      }
    }
  }

  /* ══ PHASE ANSWER — streaming SSE (même tour, pas de nouveau crédit) ══ */
  const actionId = typeof body.action_id === 'string' ? body.action_id.slice(0, 60) : 'lecture';
  let resultStr = '';
  try { resultStr = JSON.stringify(body.action_result ?? null); } catch (e) { resultStr = 'null'; }
  if (resultStr.length > MAX_RESULT_CHARS) resultStr = resultStr.slice(0, MAX_RESULT_CHARS) + '…(tronqué)';

  const convo = [
    { role: 'system', content: SYS_ANSWER },
    ...messages,
    { role: 'user', content: `RÉSULTAT de la lecture ${actionId} (JSON) :\n${resultStr}\n\nRéponds-moi maintenant.` },
  ];

  let aiStream;
  try {
    aiStream = await env.AI.run(KS_AI_MODEL, {
      messages: convo, max_tokens: MAX_TOKENS_ANSWER, stream: true,
    });
  } catch (e) {
    return err(`Kora indisponible (${e?.message || 'erreur modèle'})`, 502, origin);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch (e) { /* stream fermé */ }
      };
      let outText = '', buffer = '';
      try {
        const reader = aiStream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const j = JSON.parse(payload);
              const chunk = j.response ?? j.choices?.[0]?.delta?.content ?? '';
              if (chunk) { outText += chunk; send({ type: 'chunk', text: chunk }); }
            } catch (e) { /* fragment non-JSON, on attend la suite */ }
          }
        }
      } catch (e) {
        send({ type: 'error', message: 'flux interrompu' });
      }
      await recordUsage(env, 'kora', {
        inText: SYS_ANSWER + resultStr, outText,
      }).catch(() => {});
      send({ type: 'done' });
      try { controller.close(); } catch (e) { /* déjà fermé */ }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ..._corsHeaders(origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
