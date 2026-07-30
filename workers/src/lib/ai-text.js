/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Texte d'une réponse Workers AI (source de vérité)
   ─────────────────────────────────────────────────────────────
   `env.AI.run()` ne rend PAS toujours du texte : quand le modèle répond en
   JSON PUR — c'est-à-dire quand il obéit le mieux à « Réponds UNIQUEMENT
   avec un JSON strict » — le binding rend un OBJET ou un TABLEAU déjà
   désérialisé. Quand il encadre sa réponse (```json … ```), c'est une
   chaîne. La forme dépend donc de l'humeur de rédaction du modèle, pas du
   code : le même endpoint marche un jour et casse le lendemain.

   Le motif `(res?.response ?? '').trim()` jette alors une TypeError. Selon
   l'endroit, elle est avalée par un catch (résultat vide, indistinguable
   d'un « rien trouvé » → le pire cas : un message rassurant et faux) ou
   remonte en 502.

   Mesuré en sonde sur le vrai modèle le 31/07/2026 :
     - Keynapse, liste d'éléments (recette)      → objet 3/3
     - Smart Agent, questions de couverture      → tableau 4/4
     - Brainstorming, synthèse qui tranche       → objet 3/3
     - Brainstorming, insights du débat          → objet 2/3   (intermittent !)
     - Brainstorming, idées de posts / comité    → chaîne 3/3
     - Living Layer, phrase d'accueil            → chaîne 3/3
   Les deux derniers demandent pourtant du JSON strict eux aussi : « ça
   passe aujourd'hui » ne veut pas dire « c'est sûr ». D'où un helper
   commun plutôt qu'un correctif au cas par cas.

   TOUT nouveau point d'appel à env.AI.run() doit passer par ici.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Extrait le texte d'une réponse Workers AI, quelle que soit sa forme.
 * Un objet/tableau est re-sérialisé : les parseurs JSON en aval le lisent
 * exactement comme ils lisaient la chaîne.
 * @param {any} res  réponse brute de env.AI.run()
 * @returns {string} toujours une chaîne (vide en cas d'échec)
 */
export function aiText(res) {
  const out = res?.response
    ?? res?.result?.response
    ?? res?.choices?.[0]?.message?.content
    ?? res?.output?.[0]?.content?.[0]?.text
    ?? res?.message?.content
    ?? res?.text
    ?? res?.completion
    ?? '';
  if (typeof out === 'string') return out.trim();
  if (out == null) return '';
  try { return JSON.stringify(out) || ''; } catch (_) { return ''; }
}
