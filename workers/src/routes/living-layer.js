// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Living Layer · POST /api/livinglayer/greeting
// ───────────────────────────────────────────────────────────────────
// Génère une phrase courte vivante affichée sous le "Bonjour, X" du
// dashboard. Contexte : prénom + heure + jour + outils récents.
//
// Cache : pas de cache D1 (latence < 600ms acceptable, et le cache
// localStorage 30 min côté client absorbe l'essentiel des appels).
// Auth   : pas d'auth (la phrase ne fuit aucune donnée privée — on
// renvoie juste le prénom au générateur). Rate limit par IP en option
// future si abus.
// ══════════════════════════════════════════════════════════════════

// Switch Llama 3.1 8B (2026-05-26 soir) — sur Smart QR le temps est
// critique : le client scanne et attend devant son écran. Gemma 4
// raisonneur prenait 5-8s avant le premier token (budget reasoning).
// Llama 3.1 8B sort direct en ~500ms-1s pour le même résultat de qualité
// suffisante (1 phrase courte). Confirmé sur Brainstorming Sprint 2.
const LIVING_MODEL_ID = '@cf/meta/llama-3.1-8b-instruct';
// Plus de budget reasoning à prévoir : 300 tokens suffisent largement
// pour 1 phrase de greeting (max 60-80 chars en pratique).
const LIVING_MAX_TOK  = 300;

function _cors(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function _json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ..._cors(origin) },
  });
}

function _err(message, status, origin) {
  return _json({ error: message }, status, origin);
}

export async function handleLivingLayerGreeting(request, env) {
  const origin = '*'; // public, pas de credentials

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: _cors(origin) });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return _err('body JSON invalide', 400, origin);
  }

  const firstName     = (body.firstName || '').toString().trim().slice(0, 40) || 'toi';
  const hour          = Number.isInteger(body.hour) ? body.hour : new Date().getHours();
  const weekday       = (body.weekday || '').toString().trim().slice(0, 20)
                        || new Date().toLocaleString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  const recentToolsArr = Array.isArray(body.recentTools)
    ? body.recentTools.filter(t => typeof t === 'string').slice(0, 5).map(s => s.slice(0, 40))
    : [];
  const recentTools   = recentToolsArr.join(', ');

  // Pré-requis : binding [ai] dans wrangler.toml
  if (!env.AI || typeof env.AI.run !== 'function') {
    return _err('Workers AI non configuré', 503, origin);
  }

  // Buckets contextuels pour le ton
  const moment = hour < 6 ? 'nuit' : hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soirée';

  const systemPrompt = [
    'Tu es Living Layer, la couche IA chaleureuse de Keystone OS.',
    'Tu écris UNE phrase courte (max 14 mots) affichée sous "Bonjour, ' + firstName + '".',
    '',
    'Règles strictes :',
    '- Une seule phrase, max 14 mots, sans point d\'exclamation excessif',
    '- Ton naturel, vivant, jamais corporate ni vendeur',
    '- Mentionne UN signal contextuel (moment de la journée, jour, outil récent)',
    '- Pas de question rhétorique vide ("Prêt à conquérir le monde ?")',
    '- Pas de "Bonjour" ni "Salut" — c\'est déjà dit au-dessus',
    '- Pas d\'emoji',
    '- Pas de CTA',
    '- Réponse en JSON STRICT : {"phrase":"..."}',
  ].join('\n');

  const userPrompt = [
    'Contexte de la connexion :',
    `- Prénom : ${firstName}`,
    `- Moment : ${moment} (${hour}h)`,
    `- Jour : ${weekday}`,
    recentTools ? `- Outils utilisés récemment : ${recentTools}` : null,
    '',
    'Génère le JSON {"phrase"} maintenant.',
  ].filter(Boolean).join('\n');

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
    return _err('Workers AI erreur : ' + e.message, 502, origin);
  }

  // Workers AI renvoie selon le modèle :
  //   - { response: "..." } pour les modèles génératifs
  //   - { choices: [...] } pour les modèles OpenAI-compatibles (Gemma 4)
  //   - { output: [{ content: [{ text: "..." }] }] } pour Llama récents
  // (pattern repris de ghostwriter.js)
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
  } catch (e) { /* fallthrough vers fallback */ }

  // Fallback safe si parse échoue
  const fallback = moment === 'nuit'        ? 'La nuit porte conseil — Keystone veille avec toi.'
                 : moment === 'matin'       ? 'Une nouvelle journée, un atelier prêt à servir.'
                 : moment === 'après-midi' ? 'L\'après-midi est à toi — bon flow.'
                 :                            'Bonne fin de journée, on continue ensemble.';

  const phrase = (parsed?.phrase || '').toString().trim().slice(0, 200) || fallback;

  return _json({ phrase, moment, generated_at: new Date().toISOString() }, 200, origin);
}
