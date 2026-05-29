/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Modèle IA par défaut (source de vérité unique)
   ─────────────────────────────────────────────────────────────
   Décision 2026-05-29 : consolidation de TOUT l'écosystème sur un
   seul moteur Workers AI, en remplacement du mix Llama 3.1 8B +
   Gemma 4 (jugés trop moyens, et Gemma 4 = piège « reasoning » qui
   brûle son budget tokens avant d'écrire).

   Choix : Mistral Small 3.1 24B.
     - Société française → français natif (produit + clients FR, RGPD/EU).
     - Streaming PROPRE, sans préambule de raisonnement → indispensable
       pour le débat live multi-agents de Brainstorming.
     - Pas de mode « thinking » incontrôlable (contrairement à Qwen3
       sur Workers AI, où enable_thinking n'est pas exposé).

   Pour changer de modèle dans TOUT Keystone : modifier UNIQUEMENT
   cette constante puis `wrangler deploy`. Tous les endpoints IA
   (Ghost Writer, Brainstorming, Living Layer, Smart QR, ai-generate)
   l'importent.

   NB : les couches PREMIUM Claude (BYOK, clé utilisateur) sont gérées
   séparément dans chaque route et NE passent PAS par cette constante —
   elles restent disponibles en option (synthèse premium, Devil's
   Advocate, mode IA Living Layer).
   ═══════════════════════════════════════════════════════════════ */

export const KS_AI_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
