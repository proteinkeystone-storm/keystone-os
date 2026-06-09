/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Content Chain (lib partagée)
   ─────────────────────────────────────────────────────────────
   Le « tissu connectif » de la chaîne de contenu :
     ① Idées (Brainstorming) → ② Rédaction (Ghost Writer) → ③ Publication (Social Manager)

   Deux rôles, un seul module :

   1. ÉTAT PORTÉ — un petit objet { network, origin, step } qui voyage
      d'un pad à l'autre. Le réseau choisi en ① doit se retrouver coché
      en ③ : c'est ici qu'il vit. Survit à un reload via sessionStorage.
      C'est la mémoire de la chaîne — ce que l'utilisateur « transporte ».

   2. RAIL — un composant visuel commun (la colonne vertébrale) monté en
      tête des 3 surfaces : montre les 3 étapes, allume l'étape courante,
      affiche le réseau porté, offre un « ‹ » retour. Rendu IDENTIQUE
      partout (CSS injecté une fois, tokens du DS → clair/sombre auto).

   Doctrine « Contenant / Contenu » : lib PURE, AUCUN import des pads
   (les pads importent ceci, jamais l'inverse → zéro cycle). Toute
   l'orchestration (« ouvre tel pad ») vit chez l'appelant ; ici on ne
   gère que l'état porté + le rendu du rail.
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './ui-icons.js';

// ── Étapes de la chaîne ───────────────────────────────────────────
export const CHAIN_STEPS = ['ideas', 'write', 'publish'];

const STEP_META = {
  ideas:   { label: 'Idées',       ico: 'sparkles' },
  write:   { label: 'Rédaction',   ico: 'edit' },
  publish: { label: 'Publication', ico: 'send' },
};

// Libellés d'affichage des réseaux (badge « Pour … » du rail).
const NETWORK_LABELS = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn',
  threads:  'Threads',  telegram:  'Telegram',
};

// Durée de vie de l'état porté. Borne la « traîne » : un parcours
// abandonné ne doit pas faire resurgir un rail fantôme des heures plus
// tard. 6 h = couvre une session de travail, sans persister à l'infini.
const CHAIN_TTL_MS = 6 * 60 * 60 * 1000;
const SS_KEY = 'ks_content_chain';

// ── Helpers PURS (testables sans DOM) ─────────────────────────────

/**
 * Statut de chaque étape relativement à l'étape courante.
 * @param {'ideas'|'write'|'publish'} currentStep
 * @returns {Array<{step:string, state:'done'|'active'|'todo'}>}
 */
export function stepStates(currentStep) {
  const cur = CHAIN_STEPS.indexOf(currentStep);
  return CHAIN_STEPS.map((step, i) => ({
    step,
    state: cur < 0 ? 'todo' : i < cur ? 'done' : i === cur ? 'active' : 'todo',
  }));
}

/** Libellé d'affichage d'un réseau, ou '' si inconnu/absent. */
export function networkLabel(net) {
  return NETWORK_LABELS[String(net || '').toLowerCase()] || '';
}

// ── État porté (navigateur ; rehydraté depuis sessionStorage) ─────
// _state : undefined = pas encore hydraté · null = pas de chaîne · objet = chaîne active.
let _state;
let _hydrated = false;

function _hydrate() {
  if (_hydrated) return;
  _hydrated = true;
  _state = null;
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.ts === 'number') _state = obj;
  } catch (_) { _state = null; }
}

function _persist() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (_state) sessionStorage.setItem(SS_KEY, JSON.stringify(_state));
    else sessionStorage.removeItem(SS_KEY);
  } catch (_) { /* quota/private mode : l'état mémoire reste la source */ }
}

/** L'état porté courant, ou null si absent/expiré (TTL). */
export function getChain() {
  _hydrate();
  if (!_state) return null;
  if (typeof _state.ts === 'number' && Date.now() - _state.ts > CHAIN_TTL_MS) {
    _state = null; _persist(); return null;
  }
  return _state;
}

/** Fusionne `partial` dans l'état porté (le crée au besoin) + bump du ts. */
export function setChain(partial) {
  _hydrate();
  const base = _state || { network: null, origin: null, step: null };
  _state = { ...base, ...(partial || {}), ts: Date.now() };
  _persist();
  return _state;
}

/** Efface l'état porté (fin de parcours réussie, ou entrée standalone). */
export function clearChain() {
  _hydrate();
  _state = null;
  _persist();
}

/** Vrai s'il existe une chaîne active (non expirée). */
export function isChainActive() {
  return getChain() !== null;
}

// ── Rail (composant visuel commun) ────────────────────────────────

const CSS_FLAG = '__ks_chain_css_injected__';

function _injectCSS() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window[CSS_FLAG]) return;
  window[CSS_FLAG] = true;

  const css = `
.ks-chain {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
}
.ks-chain-back {
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 0; color: var(--tx2, rgba(255,255,255,.55));
  cursor: pointer; padding: 3px; border-radius: 7px;
  transition: color .15s ease, background .15s ease;
}
.ks-chain-back:hover { color: var(--text, #fff); background: rgba(127,127,127,.14); }
.ks-chain-steps { display: flex; align-items: center; gap: 9px; list-style: none; margin: 0; padding: 0; }
.ks-chain-step {
  display: flex; align-items: center; gap: 6px;
  color: var(--tx3, rgba(255,255,255,.3));
  font-size: 12.5px; font-weight: 600; letter-spacing: -.01em;
  white-space: nowrap; transition: color .2s ease;
}
.ks-chain-step .ks-chain-ico { display: inline-flex; opacity: .6; transition: opacity .2s ease; }
.ks-chain-step.is-done { color: var(--tx2, rgba(255,255,255,.55)); }
.ks-chain-step.is-done .ks-chain-ico { opacity: .9; color: var(--green, #22c55e); }
.ks-chain-step.is-active { color: var(--gold2, #818cf8); }
.ks-chain-step.is-active .ks-chain-ico { opacity: 1; }
.ks-chain-sep { width: 16px; height: 1.5px; border-radius: 2px; background: var(--bd, rgba(255,255,255,.12)); flex: 0 0 auto; }
.ks-chain-net {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 11px; border-radius: 100px;
  background: var(--gold3, rgba(99,102,241,.12)); color: var(--gold2, #818cf8);
  font-size: 11px; font-weight: 600; letter-spacing: .005em; white-space: nowrap;
}
`;
  const style = document.createElement('style');
  style.id = 'ks-chain-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

/**
 * HTML du rail pour une surface donnée. Retourne '' si AUCUNE chaîne
 * active — la surface n'affiche alors rien (montage standalone, hors chaîne).
 * @param {'ideas'|'write'|'publish'} currentStep
 * @param {{back?:boolean}} [opts] back=false masque le « ‹ » retour.
 * @returns {string}
 */
export function renderChainRail(currentStep, opts = {}) {
  const chain = getChain();
  if (!chain) return '';
  _injectCSS();

  const net = networkLabel(chain.network);
  const showBack = opts.back !== false && currentStep !== 'ideas';

  const steps = stepStates(currentStep).map(({ step, state }) => {
    const m = STEP_META[step];
    const glyph = state === 'done' ? icon('check', 14) : icon(m.ico, 14);
    return `<li class="ks-chain-step is-${state}">`
         + `<span class="ks-chain-ico">${glyph}</span>`
         + `<span class="ks-chain-lab">${m.label}</span>`
         + `</li>`;
  }).join('<li class="ks-chain-sep" aria-hidden="true"></li>');

  const back = showBack
    ? `<button type="button" class="ks-chain-back" data-chain-back aria-label="Revenir à l'étape précédente">${icon('arrow-left', 16)}</button>`
    : '';
  const badge = net
    ? `<span class="ks-chain-net">${icon(chain.network, 13)}<span>Pour ${net}</span></span>`
    : '';

  return `<nav class="ks-chain" data-step="${currentStep}" aria-label="Chaîne de contenu">`
       + back
       + `<ol class="ks-chain-steps">${steps}</ol>`
       + badge
       + `</nav>`;
}

/**
 * Câble le « ‹ » retour d'un rail déjà inséré dans le DOM.
 * @param {Element} root  conteneur où le rail a été monté
 * @param {{onBack?:Function}} [handlers]
 */
export function bindChainRail(root, { onBack } = {}) {
  if (!root || typeof root.querySelector !== 'function') return;
  const back = root.querySelector('[data-chain-back]');
  if (back && typeof onBack === 'function') {
    back.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    });
  }
}
