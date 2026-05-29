// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Admin · Budget IA (compteur + bridage) · 2026-05-29
// ───────────────────────────────────────────────────────────────────
// Routes admin (Bearer KS_ADMIN_SECRET) qui exposent le compteur de
// neurones Workers AI et le pilotage du bridage. La logique vit dans
// lib/ai-budget.js ; ici on ne fait que l'auth + le câblage HTTP.
//
//   GET  /api/admin/ai-budget            → état complet (jour/mois/€/seuil)
//   POST /api/admin/ai-budget/throttle   → { on:bool } bridage manuel
//   POST /api/admin/ai-budget/threshold  → { eur?, auto? } seuil + auto-bridage
// ══════════════════════════════════════════════════════════════════

import { requireAdmin, err, json, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { getBudgetState, setManualThrottle, setBudgetControl } from '../lib/ai-budget.js';

/** GET — état complet du compteur (lecture seule). */
export async function handleAiBudgetGet(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  try {
    const state = await getBudgetState(env);
    return json(state, 200, origin);
  } catch (e) {
    return err('Erreur lecture budget IA : ' + e.message, 500, origin);
  }
}

/** POST — bascule le bridage manuel. Body : { on: boolean }. */
export async function handleAiBudgetThrottle(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  try {
    const body = await parseBody(request);
    const on   = !!body.on;
    const state = await setManualThrottle(env, on);
    return json(state, 200, origin);
  } catch (e) {
    return err('Erreur bridage IA : ' + e.message, 500, origin);
  }
}

/** POST — règle le seuil € + active/désactive l'auto-bridage.
 *  Body : { eur?: number, auto?: boolean }. */
export async function handleAiBudgetThreshold(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  try {
    const body = await parseBody(request);
    const patch = {};
    if (body.eur  !== undefined) patch.threshold_eur = body.eur;
    if (body.auto !== undefined) patch.auto_on       = !!body.auto;
    const state = await setBudgetControl(env, patch);
    return json(state, 200, origin);
  } catch (e) {
    return err('Erreur seuil budget IA : ' + e.message, 500, origin);
  }
}
