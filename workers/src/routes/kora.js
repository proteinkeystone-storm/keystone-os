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
langage simple, zéro jargon technique, français impeccable, jamais d'emoji.
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

FORMAT DE SORTIE — règles absolues :
- Tu réponds par UN SEUL objet JSON. Jamais deux. Aucun texte autour,
  aucune balise \`\`\`.
- Tu ne traites que la DERNIÈRE question de l'utilisateur (l'historique
  n'est là que pour le contexte).
- Lecture du catalogue : {"action":"id.exact","args":{...},"annonce":"une phrase à la première personne sur ce que tu vas lire"}
- Réponse directe (salutation, explication, demande hors catalogue) : {"reponse":"ta réponse"}

QUAND CHOISIR QUOI :
- La demande correspond à une action du catalogue → TOUJOURS "action".
  Lire ces données, tu SAIS le faire : ne dis jamais « je ne sais pas
  encore » pour une lecture du catalogue.
- La demande porte sur des données que le catalogue ne couvre pas
  (ex. scans de QR codes) → {"reponse":"je ne sais pas encore lire ça — je peux te lire : tes séances de brainstorming, tes posts, tes réseaux…"}
- La demande est de créer/modifier/supprimer/publier → {"reponse":"je ne peux pas encore le faire, ça vient. En attendant je peux te lire …"}
- Ambiguïté entre 2 lectures → choisis la plus probable, ne pose pas de question.
- N'invente JAMAIS un id hors catalogue ; args = uniquement les paramètres déclarés.

EXEMPLES :
Utilisateur : « qu'est-ce qui part cette semaine ? »
Toi : {"action":"sm.upcoming_posts","args":{"days":7},"annonce":"Je regarde ce qui est programmé sur tes réseaux cette semaine."}
Utilisateur : « salut, tu fais quoi ? »
Toi : {"reponse":"Salut ! Je peux te lire tes séances de brainstorming, tes posts, l'état de tes réseaux… Demande-moi."}`;
}

const SYS_ANSWER = `${PERSONA}

Tu viens d'exécuter une lecture et son résultat (JSON) t'est fourni dans la
conversation. Réponds à l'utilisateur en t'appuyant UNIQUEMENT sur ce
résultat : concis, concret, chiffres et dates reformulés simplement.
RÈGLE ABSOLUE — zéro invention : chaque chiffre, nom ou date que tu cites
doit exister TEL QUEL dans le résultat JSON. Si une valeur est null ou
absente, dis « pas d'information » ; si "illimite" est true, dis que c'est
illimité — n'invente jamais un plafond. Les quotas sont des CRÉDITS (pas
des caractères) ; reprends les unités du résultat, jamais d'autres.
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
  /* Piège attrapé au wrangler tail (17/07, « .trim is not a function ») :
     quand le modèle répond un JSON pur, Workers AI le PARSE lui-même et
     `response` arrive en OBJET — le 502 frappait donc quand le modèle
     obéissait le mieux. Objet → re-stringifié, _parseDecision s'en charge. */
  const v = res?.response ?? res?.result?.response ?? res?.choices?.[0]?.message?.content ?? '';
  if (typeof v === 'string') return v.trim();
  try { return JSON.stringify(v) || ''; } catch (e) { return ''; }
}
/* Parse défensif de la décision. Leçon du 1er contact réel (17/07) :
   le modèle peut émettre PLUSIEURS objets JSON (il « rattrape » la
   question précédente), des balises \`\`\`, ou du texte autour. On
   extrait TOUS les objets équilibrés, on garde la DERNIÈRE décision
   valide (= la dernière question), et on ne renvoie JAMAIS du JSON
   brut comme texte à l'utilisateur. */
function _jsonCandidates(raw) {
  const out = [];
  let depth = 0, start = -1, inStr = false, escp = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (escp) escp = false;
      else if (c === '\\') escp = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (!depth) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (!depth && start >= 0) { out.push(raw.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
function _parseDecision(raw) {
  if (!raw) return null;
  const decisions = [];
  for (const cand of _jsonCandidates(raw)) {
    try {
      const p = JSON.parse(cand);
      if (typeof p.action === 'string' && p.action.trim()) {
        decisions.push({
          action : p.action.trim(),
          args   : (p.args && typeof p.args === 'object') ? p.args : {},
          annonce: typeof p.annonce === 'string' ? p.annonce.slice(0, 300) : '',
        });
      } else if (typeof p.reponse === 'string' && p.reponse.trim()) {
        decisions.push({ reponse: p.reponse });
      }
    } catch (e) { /* candidat invalide, on continue */ }
  }
  if (decisions.length) return decisions[decisions.length - 1];
  /* aucun JSON exploitable : texte direct, SAUF si ça ressemble à du
     JSON/fence cassé → message sobre plutôt que du brut à l'écran */
  const txt = raw.replace(/```[a-z]*\n?/g, '').trim();
  if (!txt || txt.startsWith('{') || txt.includes('"action"') || txt.includes('"reponse"')) {
    return { reponse: 'Je me suis emmêlée — reformule ta demande, je réessaie.' };
  }
  return { reponse: txt.slice(0, 1200) };
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
      /* température basse = choix d'action déterministe (leçon audit
         retrieval Smart Agent) ; 1 réessai — le 1er contact réel a
         montré des erreurs transitoires du modèle (« décision 502 ») */
      let res = null, lastErr = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await env.AI.run(KS_AI_MODEL, {
            messages   : [{ role: 'system', content: sys }, ...messages],
            max_tokens : MAX_TOKENS_DECIDE,
            temperature: 0.15,
            stream     : false,
          });
        } catch (e) {
          lastErr = e;
          console.error('[kora] decide AI.run tentative', attempt + 1, ':', e?.message || e);
        }
      }
      if (!res) throw (lastErr || new Error('modèle indisponible'));
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
      /* la cause réelle part dans les logs (wrangler tail) ; l'utilisateur
         reçoit une phrase sobre 200 — le crédit est remboursé (finally) */
      console.error('[kora] decide échec final :', e?.message || e);
      return json({
        type: 'reponse',
        text: 'Je n’ai pas réussi à réfléchir sur ce coup-là — repose-moi la question dans un instant.',
      }, 200, origin);
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

  /* Restitution en contexte MINIMAL : la dernière question + le résultat,
     RIEN d'autre. Leçon du test réel (capture 3, 17/07) : avec l'historique
     complet, le modèle recopiait ses propres hallucinations passées (mêmes
     chiffres inventés répétés mot pour mot) et brodait de faux posts sur
     les thèmes des tours précédents. Ce qu'il ne voit pas, il ne peut pas
     le recopier. */
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const convo = [
    { role: 'system', content: SYS_ANSWER },
    ...(lastUser ? [{ role: 'user', content: lastUser.content }] : []),
    { role: 'user', content: `RÉSULTAT de la lecture ${actionId} (JSON) :\n${resultStr}\n\nRéponds-moi maintenant. Si ce résultat est vide (total 0, listes vides), dis-le honnêtement — n'invente rien.` },
  ];

  let aiStream;
  try {
    aiStream = await env.AI.run(KS_AI_MODEL, {
      messages: convo, max_tokens: MAX_TOKENS_ANSWER, temperature: 0.3, stream: true,
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
              /* PAS de `if (chunk)` : le token "0" est falsy en JS — c'est
                 lui qui transformait « 2026 » en « 226 » (bug des zéros). */
              if (typeof chunk === 'string' && chunk.length) { outText += chunk; send({ type: 'chunk', text: chunk }); }
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
