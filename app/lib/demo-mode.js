/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Mode Démo Limité (Sprint Démo A+B)
   ───────────────────────────────────────────────────────────────
   Pose les règles du mode démo gratuit pour fermer le trou commercial
   (avant : démo illimitée = pas d'incitation à payer) :

     A) Durée limitée  : 7 jours à compter du 1er accès sans licence
     B) Quota d'apps   : 1 seule app activable simultanément

   Implémentation 100% côté frontend (zéro impact Worker/Pulsa/SDQR).
   Stockage : 2 clés localStorage, automatiquement sync via Cloud Vault
   (déjà en place commit 756e0dc) si l'utilisateur active un compte.

     ks_demo_started_at   ISO date du début de la démo
     ks_demo_last_switch  ISO date du dernier switch d'app (anti-contournement)

   Sécurité : pas de "trust client" pour les paiements. Le check
   définitif d'expiration sera côté Worker en S5 (Stripe + audit).
   ═══════════════════════════════════════════════════════════════ */

import { getOwnedIds, getLifetimeIds } from '../pads-loader.js';

const LS_DEMO_STARTED      = 'ks_demo_started_at';
const LS_DEMO_LAST_SWITCH  = 'ks_demo_last_switch';
const LS_USER_SELECTION    = 'ks_user_selection';

export const DEMO_DURATION_DAYS = 7;
export const DEMO_MAX_APPS      = 1;
const ONE_DAY_MS                = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// État du mode démo
// ───────────────────────────────────────────────────────────────
// Source de vérité v2 (hotfix 2026-05-21) :
//   localStorage.ks_is_demo === '1'
// → posé explicitement par l'onboarding quand l'user choisit "Démo".
//
// Fallback rétrocompat (users existants qui n'ont jamais fait l'onboarding
// ou qui sont dans un état legacy) :
//   ownedIds === null ET pas d'achat à vie ET pas d'admin token
//
// Pourquoi l'heuristique ownedIds=null ne suffit plus :
// L'onboarding pose ks_owned_assets=["1-tool"] en démo pour bloquer
// l'accès aux autres outils via le check _isOwned du dashboard. Du coup
// ownedIds!==null en démo aussi. On a besoin d'un marqueur explicite.
// ═══════════════════════════════════════════════════════════════
export function isDemoMode() {
  // 1. Source de vérité explicite (post-onboarding v2)
  if (localStorage.getItem('ks_is_demo') === '1') {
    return true;
  }
  // 2. Pas démo si licence admin posée (Stéphane sur /admin par ex)
  if (localStorage.getItem('ks_admin_token')) return false;
  // 3. Fallback legacy : user vraiment vierge (avant onboarding, ou
  //    onboarding sauté en file://). On considère démo s'il n'a aucune
  //    trace de licence.
  const owned     = getOwnedIds();
  const lifetime  = getLifetimeIds();
  const hasOwned  = Array.isArray(owned) && owned.length > 0;
  const hasLife   = Array.isArray(lifetime) && lifetime.length > 0;
  const hasJwt    = !!localStorage.getItem('ks_jwt');
  if (hasOwned || hasLife || hasJwt) return false;
  // Aucune trace de licence → démo
  return true;
}

// Pose la date de début de démo si elle n'existe pas encore.
// Idempotent : ne fait rien si la date est déjà posée.
export function ensureDemoStarted() {
  if (!isDemoMode()) return null;
  let started = localStorage.getItem(LS_DEMO_STARTED);
  if (!started) {
    started = new Date().toISOString();
    localStorage.setItem(LS_DEMO_STARTED, started);
  }
  return started;
}

// Reset le compteur démo (utile pour debug ou pour un user qui s'active).
// À ne PAS exposer côté UI utilisateur — usage interne uniquement.
export function resetDemo() {
  localStorage.removeItem(LS_DEMO_STARTED);
  localStorage.removeItem(LS_DEMO_LAST_SWITCH);
}

// Renvoie la date ISO du début de démo (ou null si pas en démo)
export function getDemoStartedAt() {
  return localStorage.getItem(LS_DEMO_STARTED);
}

// Nombre de jours écoulés depuis le début de la démo (>= 0)
export function getDemoDaysElapsed() {
  const started = getDemoStartedAt();
  if (!started) return 0;
  const ms = Date.now() - new Date(started).getTime();
  return Math.floor(ms / ONE_DAY_MS);
}

// Nombre de jours restants avant expiration (>= 0)
// Calcule en jours pleins, arrondi au supérieur pour favoriser le user
// (s'il commence sa démo à 23h59, il a quand même presque 7 jours)
export function getDemoDaysLeft() {
  const started = getDemoStartedAt();
  if (!started) return DEMO_DURATION_DAYS;
  const elapsedMs  = Date.now() - new Date(started).getTime();
  const remainingMs = DEMO_DURATION_DAYS * ONE_DAY_MS - elapsedMs;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / ONE_DAY_MS);
}

// La démo est-elle expirée ?
export function isDemoExpired() {
  if (!isDemoMode()) return false;
  return getDemoDaysLeft() <= 0;
}

// ═══════════════════════════════════════════════════════════════
// Quota d'apps (limite B)
// ═══════════════════════════════════════════════════════════════

// Renvoie la liste des apps actuellement sélectionnées par l'user
// (ks_user_selection peut être null = aucune sélection encore).
function _getCurrentSelection() {
  try {
    const raw = localStorage.getItem(LS_USER_SELECTION);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice() : [];
  } catch {
    return [];
  }
}

// En mode démo, retourne l'ID de l'app de démo actuellement active
// (= la 1re et unique app sélectionnée). null si pas encore choisie.
export function getDemoSelectedAppId() {
  if (!isDemoMode()) return null;
  const sel = _getCurrentSelection();
  return sel.length > 0 ? sel[0] : null;
}

// Peut-on ajouter une nouvelle app à la sélection en mode démo ?
//   - true si l'utilisateur n'a pas encore choisi d'app (1re activation)
//   - true si l'app à ajouter est déjà la sélection démo (no-op)
//   - false sinon (quota atteint)
export function canAddAppInDemo(appId) {
  if (!isDemoMode()) return true; // Pas en démo → pas de limite côté front
  const sel = _getCurrentSelection();
  if (sel.length === 0) return true;            // Première activation
  if (sel.includes(appId)) return true;         // Déjà sélectionnée
  if (sel.length < DEMO_MAX_APPS) return true;  // Encore de la place (cas DEMO_MAX_APPS > 1)
  return false;
}

// Renvoie l'app qui bloque l'ajout (pour message UX : "Tu testes [Pulsa]").
// null si pas en démo ou pas de blocage.
export function getBlockingDemoApp() {
  if (!isDemoMode()) return null;
  const sel = _getCurrentSelection();
  return sel.length > 0 ? sel[0] : null;
}

// ═══════════════════════════════════════════════════════════════
// Switch d'app démo (1 fois par 24h pour éviter le contournement)
// ───────────────────────────────────────────────────────────────
// L'utilisateur peut changer d'app testée, mais pas en boucle.
// Garde-fou : 1 switch maximum par 24h glissantes.
// ═══════════════════════════════════════════════════════════════

export function canSwitchDemoApp() {
  if (!isDemoMode()) return true;
  const last = localStorage.getItem(LS_DEMO_LAST_SWITCH);
  if (!last) return true;
  const elapsed = Date.now() - new Date(last).getTime();
  return elapsed >= ONE_DAY_MS;
}

export function getDemoSwitchCooldownLeft() {
  const last = localStorage.getItem(LS_DEMO_LAST_SWITCH);
  if (!last) return 0;
  const elapsed = Date.now() - new Date(last).getTime();
  const remainingMs = ONE_DAY_MS - elapsed;
  return Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000))); // en heures
}

// Effectue le switch : remplace l'app de démo active par newAppId.
// Renvoie true si OK, false si cooldown actif.
export function switchDemoApp(newAppId) {
  if (!isDemoMode())  return false;
  if (!canSwitchDemoApp()) return false;

  // Remplace la sélection (1 seule entrée en démo)
  localStorage.setItem(LS_USER_SELECTION, JSON.stringify([newAppId]));
  localStorage.setItem(LS_DEMO_LAST_SWITCH, new Date().toISOString());
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Snapshot complet pour l'UI (chronomètre, modales, …)
// ═══════════════════════════════════════════════════════════════
export function getDemoState() {
  return {
    isDemo:           isDemoMode(),
    startedAt:        getDemoStartedAt(),
    daysElapsed:      getDemoDaysElapsed(),
    daysLeft:         getDemoDaysLeft(),
    durationDays:     DEMO_DURATION_DAYS,
    expired:          isDemoExpired(),
    maxApps:          DEMO_MAX_APPS,
    selectedAppId:    getDemoSelectedAppId(),
    canSwitch:        canSwitchDemoApp(),
    switchCooldownH:  getDemoSwitchCooldownLeft(),
  };
}
