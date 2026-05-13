/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact PULSA (A-COM-004) v1.0-skeleton
   Sprint Pulsa-1 : scaffold workspace fullscreen.

   Pulsa = builder de formulaires intelligents (questionnaires,
   diagnostics, onboarding). 4 étapes :
     1. Structure   — sections & champs
     2. Apparence   — identité visuelle
     3. Livraison   — URL & destinataires direction
     4. Publication — preview & publier à /f/{slug}

   Cette V1 est un squelette navigable. La logique builder, la
   route publique et la collecte des réponses arrivent en Phase 2/3.
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './lib/ui-icons.js';
import { scheduleAutoSave } from './vault.js';

// ── Métadonnées de l'artefact ─────────────────────────────────
const WORKSPACE_META = {
  id: 'A-COM-004',
  name: 'Pulsa',
  punchline: 'Le formulaire intelligent qui collecte sans friction',
};

const STEPS = [
  { id: 'structure',  label: 'Structure',   ico: 'sliders',      sub: 'Sections & champs' },
  { id: 'appearance', label: 'Apparence',   ico: 'palette',      sub: 'Identité visuelle' },
  { id: 'delivery',   label: 'Livraison',   ico: 'globe',        sub: 'URL & destinataires' },
  { id: 'publish',    label: 'Publication', ico: 'sparkles',     sub: 'Preview & publier' },
];

const DRAFT_KEY = 'ks_pulsa_draft';

// ── État local de l'artefact ──────────────────────────────────
let _state = _defaultState();
let _root  = null;
let _currentStepId = 'structure';

function _defaultState() {
  return {
    meta: {
      title: '',
      slug: '',
      logo_url: null,
      brand_color: '#0a2741',
      brand_accent: '#c9b48a',
      anonymous: true,
      intro: '',
    },
    sections: [],
    delivery: { recipients: [], notification_subject: '' },
    output:   { status: 'draft', published_url: null, last_response_at: null },
  };
}

function _currentStep() {
  return STEPS.find(s => s.id === _currentStepId) || STEPS[0];
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════
export function openPulsa() {
  if (_root) return;
  _loadDraft();
  _buildShell();
  _renderRail();
  _renderMain();
}

export function closePulsa() {
  if (!_root) return;
  _saveDraft();
  _root.remove();
  _root = null;
}

// ═══════════════════════════════════════════════════════════════
// Shell
// ═══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <button class="ws-topbar-back" data-act="close">
        ${icon('arrow-left', 16)}
        <span>Retour</span>
      </button>
      <div class="ws-topbar-title">
        <span class="name">${WORKSPACE_META.name}</span>
        <span class="sep">·</span>
        <span class="crumb" data-slot="crumb">${_currentStep().label}</span>
      </div>
      <div class="ws-topbar-actions">
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="close" title="Fermer">
          ${icon('x', 18)}
        </button>
      </div>
    </header>

    <div class="ws-body">
      <nav class="ws-rail" data-slot="rail"></nav>
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onInput);
  _root.addEventListener('keydown', _onKeydown);
}

// ═══════════════════════════════════════════════════════════════
// Délégation événements
// ═══════════════════════════════════════════════════════════════
function _onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close') return closePulsa();
  if (act === 'goto')  return _navigate(t.dataset.step);
  if (act === 'save')  { _saveDraft(); return; }
}

function _onInput() {
  _saveDraft();
}

function _onKeydown(e) {
  if (e.key === 'Escape') closePulsa();
}

function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  _currentStepId = stepId;
  const crumb = _root?.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Rendu
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root?.querySelector('[data-slot="rail"]');
  if (!rail) return;
  rail.innerHTML = STEPS.map((s, i) => `
    <button class="ws-rail-item ${s.id === _currentStepId ? 'is-active' : ''}"
            data-act="goto" data-step="${s.id}">
      <span class="ws-rail-num">${i + 1}</span>
      <span class="ws-rail-icon">${icon(s.ico, 18)}</span>
      <span class="ws-rail-label">
        <span class="ws-rail-title">${s.label}</span>
        <span class="ws-rail-sub">${s.sub}</span>
      </span>
    </button>
  `).join('');
}

function _renderMain() {
  const main = _root?.querySelector('[data-slot="main"]');
  if (!main) return;
  const step = _currentStep();
  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">${step.label}</h1>
      <p class="ws-step-sub">${step.sub}</p>
    </div>
    <div class="ws-step-body">
      <div class="pulsa-placeholder">
        ${icon('sparkles', 32)}
        <h2>Pulsa · Squelette MVP en construction</h2>
        <p>Cette étape <strong>« ${step.label} »</strong> sera fonctionnelle en Phase 2.</p>
        <p class="pulsa-placeholder-meta">Identifiant artefact : <code>A-COM-004</code> · Brouillon auto-sauvegardé</p>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Persistance brouillon (localStorage + vault sync)
// ═══════════════════════════════════════════════════════════════
function _saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(_state));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  } catch {}
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _state = { ..._defaultState(), ...parsed };
    }
  } catch {}
}
