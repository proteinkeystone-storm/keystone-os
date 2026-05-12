/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact MUSE (A-COM-003) v2.0
   Sprint Muse-Brainstorm-J1 : pivot vers outil de brainstorming
   ludique pour chargée de communication immobilière.

   Mission : remplacer la chaîne fragmentée (Muse → IA chat →
   générateur d'image) par un assistant brainstorming intégré,
   directement utilisable, gamifié. La chargée de com a 4 besoins
   récurrents : trouver un nom de programme, des punchlines, une
   direction artistique, des idées marketing — et anticiper les
   objections acquéreurs. Un mode "Mix tout" couvre les 4 en un.

   Concept UX : un plateau de jeu créatif (pas un formulaire).
   - Étape 1 TOPIC      : 8 grandes cards plein écran pour choisir
                          un mode (Naming · Positionnement · Punchline ·
                          Ambiance · Marketing · Objections · Libre ·
                          Mix-tout)
   - Étape 2 CALIBRATE  : sliders visuels + checkboxes imagées +
                          jauge "Qualité du brief" qui monte en
                          live + bouton "Surprends-moi" 🎲
   - Étape 3 BRAINSTORM : l'IA tire les idées une par une comme
                          des cartes (animation flip). L'utilisateur
                          marque favoris ⭐, demande variations 🔄,
                          rejette 🗑️. Frameworks pro (SCAMPER, 6
                          chapeaux, Worst Idea, Reverse). Modes
                          spéciaux : Crazy 8s timer, Mode chaos.

   Réutilisation : shell workspace (.ws-*), persistance localStorage
   + cloud-vault, sélecteur moteur IA, navigation, toasts. Le J1
   livre les vues 1 et 2 complètes, vue 3 en placeholder pour J2.
   ═══════════════════════════════════════════════════════════════ */

import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { icon } from './lib/ui-icons.js';
import {
  loadModes, getModes, getMode, getSliders, getTimeBudgets,
  getTargets, getInspirations, computeBriefQualityScore,
  getQualityTier, pickStimulusWord,
} from './lib/muse-modes.js';

// ── Métadonnées workspace ─────────────────────────────────────
const WORKSPACE_META = {
  id        : 'A-COM-003',
  name      : 'Muse',
  punchline : 'Le plateau de jeu créatif de votre com immobilière',
};

// ── Définition des 3 étapes ───────────────────────────────────
const STEPS = [
  { id: 'topic',      label: 'Le sujet',     icon: 'sparkles',
    sublabel: 'Que voulez-vous brainstormer ?' },
  { id: 'calibrate',  label: 'Le calibrage', icon: 'sliders',
    sublabel: 'Programme, ton, cible' },
  { id: 'brainstorm', label: 'Le jeu',       icon: 'palette',
    sublabel: 'Idées une par une, à trier' },
];

// ── État global ───────────────────────────────────────────────
let _state = _freshState();

function _freshState() {
  return {
    view: 'topic',

    topic: {
      mode: null,            // 'naming' | 'punchline' | 'ambiance' | 'marketing' | 'objections' | 'mix-all'
    },

    calibrate: {
      // Programme (importable depuis Kodex)
      program_name: '',
      program_location: '',
      program_description: '',
      program_kodex_id: null,

      // Curseurs (0-100, défaut centre = 50)
      tonality: 50,    // sobre ↔ audacieux
      tone: 50,        // chaleureux ↔ minimaliste
      format: 50,      // slogan ↔ manifeste
      boldness: 30,    // réaliste ↔ décalé

      // Cases à cocher imagées
      time_budget: '10min',
      targets: [],
      inspirations: [],

      // Champ libre
      extra: '',

      // Stimulus aléatoire (Surprends-moi)
      stimulus_word: '',
    },

    brainstorm: {
      status: 'idle',        // idle | generating | done | error
      error: null,
      ideas: [],
      rounds: 0,
      framework: null,       // 'scamper' | 'six-hats' | 'worst-idea' | 'reverse' | null
      timer_mode: null,      // 'crazy8s' | null
    },

    settings: {
      target_engine: 'Claude',
      sound_enabled: true,
    },
  };
}

let _root = null;
let _saveTimer = null;

// ═══════════════════════════════════════════════════════════════
// Persistance brouillon
// ═══════════════════════════════════════════════════════════════
const LS_DRAFT_KEY = 'ks_muse_draft_v2';
const LS_LEGACY_KEY = 'ks_muse_draft';     // ancien brouillon v1, purgé au load

function _saveDraft() {
  try {
    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(_state));
    import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
  } catch (_) {}
}

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveDraft, 350);
}

function _loadDraft() {
  // Purge l'ancien brouillon v1 (incompatible avec la nouvelle struct)
  try { localStorage.removeItem(LS_LEGACY_KEY); } catch (_) {}

  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    const fresh = _freshState();
    _state = {
      ...fresh,
      ...data,
      topic:      { ...fresh.topic,      ...(data.topic      || {}) },
      calibrate:  { ...fresh.calibrate,  ...(data.calibrate  || {}) },
      brainstorm: { ...fresh.brainstorm, ...(data.brainstorm || {}) },
      settings:   { ...fresh.settings,   ...(data.settings   || {}) },
    };
    return true;
  } catch (_) {
    return false;
  }
}

function _resetDraft() {
  try { localStorage.removeItem(LS_DRAFT_KEY); } catch (_) {}
  _state = _freshState();
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════
export function openMuse() {
  if (_root) return;
  _loadDraft();
  // Précharge le catalogue des modes pendant la construction du shell
  loadModes().catch(() => {});
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeMuse() {
  if (!_root) return;
  _saveDraft();
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
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
        ${ratingButtonHTML(WORKSPACE_META.id)}
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer">
          ${icon('refresh', 18)}
        </button>
        <button class="ws-iconbtn" data-act="close" title="Fermer">
          ${icon('x', 18)}
        </button>
      </div>
    </header>

    <div class="ws-body">
      <nav class="ws-rail" data-slot="rail"></nav>
      <main class="ws-main" data-slot="main"></main>
      <aside class="ws-aside" data-slot="aside"></aside>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('change', _onInput);
  bindRatingButton(_root, WORKSPACE_META.id);
  _renderRail();
  _renderAside();
}

// ═══════════════════════════════════════════════════════════════
// Délégation des évènements
// ═══════════════════════════════════════════════════════════════
function _onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close')           return closeMuse();
  if (act === 'goto')            return _navigate(t.dataset.step);
  if (act === 'next')            return _advance();
  if (act === 'prev')            return _back();
  if (act === 'save')            { _saveDraft(); _toastOk('Brouillon sauvegardé'); return; }
  if (act === 'reset') {
    if (confirm('Effacer tout votre brouillon Muse et recommencer ?')) {
      _resetDraft();
      _renderMain();
      _toastOk('Brouillon réinitialisé');
    }
    return;
  }
  if (act === 'pick-mode')         return _pickMode(t.dataset.id);
  if (act === 'toggle-target')     return _toggleCheckbox('targets', t.dataset.id);
  if (act === 'toggle-inspiration') return _toggleCheckbox('inspirations', t.dataset.id);
  if (act === 'pick-time-budget')  return _pickTimeBudget(t.dataset.id);
  if (act === 'surprise-me')       return _surpriseMe();
  if (act === 'reset-stimulus')    return _resetStimulus();
}

function _onInput(e) {
  const el = e.target;
  if (!el.name) return;
  const group = el.dataset.group;
  if (!group) return;
  let value = el.value;
  if (el.type === 'range' || el.type === 'number') {
    value = value === '' ? null : Number(value);
  }
  if (_state[group]) {
    _state[group][el.name] = value;
    _scheduleSave();
    // Update live de la jauge si on est sur Calibrate
    if (group === 'calibrate') _updateQualityGauge();
  }
}

// ── Pickers ───────────────────────────────────────────────────
function _pickMode(id) {
  _state.topic.mode = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
  // Animation : auto-advance après 600ms si l'utilisateur a cliqué sur un mode
  setTimeout(() => {
    if (_state.view === 'topic' && _state.topic.mode === id) {
      _advance();
    }
  }, 650);
}

function _toggleCheckbox(group, id) {
  const list = _state.calibrate[group] || [];
  _state.calibrate[group] = list.includes(id)
    ? list.filter(x => x !== id)
    : [...list, id];
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickTimeBudget(id) {
  _state.calibrate.time_budget = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _surpriseMe() {
  // Randomise tous les curseurs + ajoute un mot stimulus
  _state.calibrate.tonality = Math.floor(Math.random() * 100);
  _state.calibrate.tone     = Math.floor(Math.random() * 100);
  _state.calibrate.format   = Math.floor(Math.random() * 100);
  _state.calibrate.boldness = Math.floor(Math.random() * 100);
  _state.calibrate.stimulus_word = pickStimulusWord();
  _scheduleSave();
  _renderMain({ preserveScroll: true });
  _toastOk(`Mot stimulus : "${_state.calibrate.stimulus_word}"`);
}

function _resetStimulus() {
  _state.calibrate.stimulus_word = '';
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

// ═══════════════════════════════════════════════════════════════
// Rail (3 étapes)
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root.querySelector('[data-slot="rail"]');
  const idx = _currentStepIndex();
  rail.innerHTML = `
    <div class="ws-rail-section">Étapes</div>
    ${STEPS.map((s, i) => {
      const status = i < idx ? 'is-done' : (i === idx ? 'is-active' : '');
      const numContent = i < idx ? icon('check', 12) : (i + 1);
      const enabled = i === 0 || _canAccessStep(i);
      return `
        <button class="ws-step ${status}" data-act="goto" data-step="${s.id}"
                ${enabled ? '' : 'disabled style="opacity:.4;cursor:not-allowed;"'}>
          <span class="ws-step-num">${numContent}</span>
          <span class="ws-step-icon" style="width:18px;height:18px;">${icon(s.icon, 18)}</span>
          <span class="ws-step-label">${s.label}</span>
        </button>
      `;
    }).join('')}
  `;
}

// Empêche l'utilisateur d'aller à l'étape 3 sans mode choisi etc.
function _canAccessStep(idx) {
  if (idx === 0) return true;
  if (idx >= 1 && !_state.topic.mode) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Aside
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
  const aside = _root.querySelector('[data-slot="aside"]');
  aside.innerHTML = `
    <div class="ws-aside-section">
      <div class="ws-aside-title">À quoi ça sert</div>
      <div class="ws-aside-card">
        Muse est votre <strong style="color:var(--gold);">plateau de jeu créatif</strong>
        de communication immobilière. Vous lui dites sur quoi brainstormer
        (nom de programme, punchlines, ambiance visuelle, idées marketing, objections
        acquéreurs ou tout d'un coup), vous calibrez en quelques curseurs, et Muse
        tire les idées une par une. Vous gardez vos favorites, exportez en PDF.
        Pensé pour les <strong>chargé·es de communication</strong> qui ont besoin
        d'aller vite sans sacrifier la qualité.
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Votre progression</div>
      <div class="ws-aside-card" data-slot="progress">
        <span class="ws-badge">Étape ${_currentStepIndex() + 1} sur ${STEPS.length}</span>
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Astuce</div>
      <div class="ws-aside-card" style="background:var(--gold3);border-color:var(--gold);">
        <strong style="color:var(--gold);display:block;margin-bottom:4px;">
          ${icon('sparkles', 14)} Mode "Mix tout"
        </strong>
        Hésitez entre brainstormer un nom, des accroches ou des idées marketing ?
        Choisissez <strong>Mix tout</strong> en étape 1. Muse produit
        nom + punchlines + direction artistique + actions marketing
        en une seule session, le tout cohérent entre eux.
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Main panel — dispatch par vue
// ═══════════════════════════════════════════════════════════════
function _renderMain(opts = {}) {
  const main = _root.querySelector('[data-slot="main"]');
  const prevScroll = main.scrollTop;
  const view = _state.view;
  let html = '';
  if (view === 'topic')           html = _viewTopic();
  else if (view === 'calibrate')  html = _viewCalibrate();
  else if (view === 'brainstorm') html = _viewBrainstorm();
  main.innerHTML = `<div class="ws-main-inner">${html}${_stepNav()}</div>`;
  main.scrollTop = opts.preserveScroll ? prevScroll : 0;

  const crumb = _root.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  const progress = _root.querySelector('[data-slot="progress"]');
  if (progress) {
    progress.innerHTML = `<span class="ws-badge">Étape ${_currentStepIndex() + 1} / ${STEPS.length}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue 1 — TOPIC (mode picker, 6 cards plein écran)
// ═══════════════════════════════════════════════════════════════
function _viewTopic() {
  const root = `
    <span class="ws-eyebrow">${icon('sparkles', 12)} 1 sur 3 · Le sujet</span>
    <h1 class="ws-h1">Sur quoi voulez-vous brainstormer&nbsp;?</h1>
    <p class="ws-lead">
      Choisissez un sujet pour démarrer. Si vous hésitez ou si vous voulez
      tout couvrir d'un coup, prenez <strong style="color:var(--gold);">Mix tout</strong>
      en bas à droite — Muse produira nom + punchlines + ambiance + idées marketing
      en une seule session.
    </p>

    <div data-slot="mode-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(230px, 1fr));gap:14px;margin-top:24px;">
      <div class="ws-empty" style="grid-column:1/-1;">
        <div class="ws-empty-icon">${icon('sparkles', 24)}</div>
        <p class="ws-empty-desc">Chargement des modes…</p>
      </div>
    </div>
  `;

  getModes().then(modes => {
    const slot = _root?.querySelector('[data-slot="mode-grid"]');
    if (!slot) return;
    slot.innerHTML = modes.map(m => {
      const selected = _state.topic.mode === m.id;
      const isMix = m.is_mix;
      const accent = m.color_hex || 'var(--ws-accent)';
      return `
        <button class="ws-card is-clickable ${selected ? 'is-selected' : ''}"
                data-act="pick-mode" data-id="${_esc(m.id)}"
                style="all:unset;cursor:pointer;display:block;padding:28px 24px;border-radius:14px;background:var(--ws-surface);border:1px solid ${selected ? accent : 'var(--ws-border)'};${selected ? `box-shadow: 0 0 0 1px ${accent} inset, 0 8px 24px ${accent}33;` : ''}${isMix ? `background:linear-gradient(135deg, var(--ws-surface) 0%, ${accent}14 100%);` : ''}transition:all 220ms ease;text-align:left;min-height:170px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
            <div style="width:48px;height:48px;border-radius:12px;background:${accent}22;color:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${icon(m.icon || 'sparkles', 24)}
            </div>
            ${selected ? `<span style="color:${accent};font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:4px;">${icon('check', 14)} Choisi</span>` : ''}
            ${isMix && !selected ? `<span class="ws-badge" style="background:${accent}22;color:${accent};font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Tout-en-un</span>` : ''}
          </div>
          <h3 style="font-size:17px;font-weight:800;letter-spacing:-.018em;margin:0 0 6px 0;color:var(--ws-text);">
            ${_esc(m.label)}
          </h3>
          <p style="margin:0;font-size:13.5px;color:var(--ws-text-soft);line-height:1.55;">
            ${_esc(m.tagline)}
          </p>
          <div style="margin-top:14px;font-size:11.5px;color:var(--ws-text-muted);letter-spacing:0;">
            ${m.ideas_count} idées · ${(m.clusters || []).length} cluster${(m.clusters || []).length > 1 ? 's' : ''}
          </div>
        </button>
      `;
    }).join('');
  });

  return root;
}

// ═══════════════════════════════════════════════════════════════
// Vue 2 — CALIBRATE (sliders + checkboxes + jauge live + dé)
// ═══════════════════════════════════════════════════════════════
function _viewCalibrate() {
  const c = _state.calibrate;
  const score = computeBriefQualityScore(_state);
  const tier = getQualityTier(score);
  const stimulus = c.stimulus_word;

  return `
    <span class="ws-eyebrow">${icon('sliders', 12)} 2 sur 3 · Le calibrage</span>
    <h1 class="ws-h1">Posez votre brief comme une partie d'échecs</h1>
    <p class="ws-lead">
      Plus vous précisez, plus Muse produit des idées justes.
      <strong style="color:var(--gold);">Pas obligé de tout remplir</strong>&nbsp;—
      vous pouvez aussi cliquer sur 🎲 <em>Surprends-moi</em> pour partir d'une
      configuration aléatoire avec un mot stimulus.
    </p>

    <!-- ── PROGRAMME ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Le programme</h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px 18px;">
        <div class="ws-field">
          <label class="ws-label">Nom du programme (ou de travail)</label>
          <input class="ws-input" type="text" name="program_name" data-group="calibrate"
                 value="${_esc(c.program_name || '')}"
                 placeholder="ex. Les Hauts de Bandol — résidence en projet">
        </div>
        <div class="ws-field">
          <label class="ws-label">Localisation</label>
          <input class="ws-input" type="text" name="program_location" data-group="calibrate"
                 value="${_esc(c.program_location || '')}"
                 placeholder="ex. Bandol (Var)">
        </div>
        <div class="ws-field" style="grid-column:1/-1;">
          <label class="ws-label">Description en 2-3 lignes</label>
          <textarea class="ws-textarea" name="program_description" data-group="calibrate" rows="3"
                    placeholder="ex. 24 lots T2-T4 duplex avec terrasses cascadées sur la mer, façades minérales claires et bois clair, parking souterrain, livraison T4 2027.">${_esc(c.program_description || '')}</textarea>
        </div>
      </div>
    </div>

    <!-- ── JAUGE QUALITÉ DU BRIEF ── -->
    <div class="ws-card" data-slot="quality-gauge" style="margin-top:16px;padding:18px 24px;background:linear-gradient(90deg, var(--ws-surface) 0%, ${tier.color}11 100%);border-color:${tier.color}44;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-text-muted);margin-bottom:4px;">
            Qualité du brief
          </div>
          <div style="font-size:18px;font-weight:800;letter-spacing:-.018em;color:${tier.color};">
            ${tier.label} <span style="font-size:13px;font-weight:600;color:var(--ws-text-muted);margin-left:6px;">${score} / 100</span>
          </div>
        </div>
        <div style="flex:1;min-width:200px;max-width:380px;height:10px;background:var(--ws-border);border-radius:999px;overflow:hidden;position:relative;">
          <div style="position:absolute;inset:0 auto 0 0;width:${score}%;background:linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%);border-radius:999px;transition:width 260ms cubic-bezier(.4,0,.2,1);"></div>
        </div>
      </div>
    </div>

    <!-- ── CURSEURS ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Les cadrans créatifs</h3>
    <div class="ws-card" style="padding:24px 28px;">
      ${_renderSlider('tonality', 'Tonalité',  'Sobre',      'Audacieux',   c.tonality)}
      ${_renderSlider('tone',     'Ton',       'Chaleureux', 'Minimaliste', c.tone)}
      ${_renderSlider('format',   'Format',    'Slogan',     'Manifeste',   c.format)}
      ${_renderSlider('boldness', 'Niveau',    'Réaliste',   'Décalé',      c.boldness)}

      <div style="display:flex;align-items:center;gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid var(--ws-border);flex-wrap:wrap;">
        <button class="ws-btn ws-btn--secondary" data-act="surprise-me"
                style="padding:9px 16px;font-size:13px;">
          ${icon('sparkles', 14)} Surprends-moi
        </button>
        ${stimulus ? `
          <span style="font-size:12.5px;color:var(--ws-text-soft);display:inline-flex;align-items:center;gap:8px;">
            Mot stimulus injecté : <strong style="color:var(--gold);font-style:italic;">"${_esc(stimulus)}"</strong>
            <button class="ws-iconbtn" data-act="reset-stimulus" title="Retirer le stimulus" style="padding:4px;">
              ${icon('x', 14)}
            </button>
          </span>
        ` : `
          <span style="font-size:12.5px;color:var(--ws-text-muted);">
            Tire un mot aléatoire (style Oblique Strategies) pour débloquer la créativité.
          </span>
        `}
      </div>
    </div>

    <!-- ── CIBLES ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Cibles acheteurs</h3>
    <p style="font-size:13px;color:var(--ws-text-muted);margin:0 0 10px 0;">
      Sélectionnez celles que vise ce programme (multi-choix possible).
    </p>
    <div data-slot="targets" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ── INSPIRATIONS ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Univers d'inspiration</h3>
    <p style="font-size:13px;color:var(--ws-text-muted);margin:0 0 10px 0;">
      Choisissez les univers qui collent au programme — Muse en tiendra compte
      pour ne pas vous proposer des idées hors sujet.
    </p>
    <div data-slot="inspirations" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ── TIME BUDGET ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Combien de temps avez-vous&nbsp;?</h3>
    <div data-slot="time-budget" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ── CHAMP LIBRE ── -->
    <h3 class="ws-h3" style="margin-top:28px;">Quelque chose de plus à dire&nbsp;?</h3>
    <div class="ws-card" style="padding:22px 26px;">
      <textarea class="ws-textarea" name="extra" data-group="calibrate" rows="3"
                placeholder="ex. Le promoteur préfère un nom court et facile à prononcer au téléphone. La cible est plutôt locale (Var, Bouches-du-Rhône). Éviter le mot 'résidence'.">${_esc(c.extra || '')}</textarea>
    </div>
  `;
}

// ── Slider visuel custom ──────────────────────────────────────
function _renderSlider(name, label, leftLabel, rightLabel, value) {
  const v = value ?? 50;
  return `
    <div style="margin-bottom:18px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ws-text-muted);">${_esc(label)}</span>
        <span style="font-size:11px;color:var(--ws-text-muted);">${v} / 100</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:12.5px;color:var(--ws-text-soft);min-width:80px;text-align:right;">${_esc(leftLabel)}</span>
        <input type="range" min="0" max="100" step="1" value="${v}"
               name="${name}" data-group="calibrate"
               style="flex:1;accent-color:var(--ws-accent);height:6px;cursor:pointer;">
        <span style="font-size:12.5px;color:var(--ws-text-soft);min-width:80px;">${_esc(rightLabel)}</span>
      </div>
    </div>
  `;
}

// ── Hydrate targets/inspirations/time-budget (chips) ──────────
function _hydrateCalibrateAsides() {
  const c = _state.calibrate;

  // Targets
  getTargets().then(items => {
    const slot = _root?.querySelector('[data-slot="targets"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, c.targets.includes(o.id), 'toggle-target')).join('');
  });

  // Inspirations
  getInspirations().then(items => {
    const slot = _root?.querySelector('[data-slot="inspirations"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, c.inspirations.includes(o.id), 'toggle-inspiration')).join('');
  });

  // Time budget (single select)
  getTimeBudgets().then(items => {
    const slot = _root?.querySelector('[data-slot="time-budget"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => {
      const selected = (c.time_budget || '10min') === o.id;
      return `
        <button class="ws-chip ${selected ? 'is-selected' : ''}"
                data-act="pick-time-budget" data-id="${_esc(o.id)}"
                style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:-.005em;border:1px solid ${selected ? 'var(--ws-accent)' : 'var(--ws-border)'};background:${selected ? 'var(--ws-accent-soft)' : 'transparent'};color:${selected ? 'var(--ws-accent)' : 'var(--ws-text)'};transition:all 140ms ease;">
          ${selected ? icon('check', 13) : ''}
          ${_esc(o.label)}
        </button>
      `;
    }).join('');
  });
}

function _chipHTML(o, selected, act) {
  return `
    <button class="ws-chip ${selected ? 'is-selected' : ''}"
            data-act="${act}" data-id="${_esc(o.id)}"
            style="all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;letter-spacing:-.005em;border:1px solid ${selected ? 'var(--ws-accent)' : 'var(--ws-border)'};background:${selected ? 'var(--ws-accent-soft)' : 'transparent'};color:${selected ? 'var(--ws-accent)' : 'var(--ws-text)'};transition:all 140ms ease;">
      ${selected ? icon('check', 13) : ''}
      ${_esc(o.label)}
    </button>
  `;
}

// ── Update live de la jauge "Qualité du brief" ────────────────
function _updateQualityGauge() {
  const slot = _root?.querySelector('[data-slot="quality-gauge"]');
  if (!slot) return;
  const score = computeBriefQualityScore(_state);
  const tier = getQualityTier(score);
  slot.style.background = `linear-gradient(90deg, var(--ws-surface) 0%, ${tier.color}11 100%)`;
  slot.style.borderColor = `${tier.color}44`;
  slot.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-text-muted);margin-bottom:4px;">
          Qualité du brief
        </div>
        <div style="font-size:18px;font-weight:800;letter-spacing:-.018em;color:${tier.color};">
          ${tier.label} <span style="font-size:13px;font-weight:600;color:var(--ws-text-muted);margin-left:6px;">${score} / 100</span>
        </div>
      </div>
      <div style="flex:1;min-width:200px;max-width:380px;height:10px;background:var(--ws-border);border-radius:999px;overflow:hidden;position:relative;">
        <div style="position:absolute;inset:0 auto 0 0;width:${score}%;background:linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%);border-radius:999px;transition:width 260ms cubic-bezier(.4,0,.2,1);"></div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 3 — BRAINSTORM (placeholder pour J2)
// ═══════════════════════════════════════════════════════════════
function _viewBrainstorm() {
  return `
    <span class="ws-eyebrow">${icon('palette', 12)} 3 sur 3 · Le jeu</span>
    <h1 class="ws-h1">Le brainstorm IA arrive bientôt</h1>
    <p class="ws-lead">
      L'étape 3 (le tirage de cartes IA, le tri par favoris, les frameworks pro
      SCAMPER / 6 chapeaux / Worst Idea, le mode Crazy 8s avec timer, et l'export
      PDF) est livrée au prochain sprint <strong>Muse-Brainstorm-J2</strong>.
    </p>

    <div class="ws-card" style="padding:32px 28px;text-align:center;border-color:var(--gold);background:var(--gold3);">
      <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold);color:#fff;align-items:center;justify-content:center;margin-bottom:16px;">
        ${icon('sparkles', 28)}
      </div>
      <h3 style="font-size:18px;font-weight:800;letter-spacing:-.018em;margin:0 0 10px 0;">Votre brief est prêt à être joué</h3>
      <p style="margin:0 auto;font-size:13.5px;color:var(--ws-text-soft);max-width:480px;line-height:1.6;">
        Pour l'instant, vous pouvez revenir aux étapes précédentes pour ajuster
        votre brief. Au prochain sprint, ce bouton lancera l'IA, qui va tirer
        les idées une par une comme des cartes.
      </p>
      <div style="margin-top:20px;font-size:12.5px;color:var(--ws-text-muted);">
        Sujet&nbsp;: <strong style="color:var(--gold);">${_esc(_state.topic.mode || '—')}</strong>
        · Qualité brief&nbsp;: <strong style="color:var(--gold);">${computeBriefQualityScore(_state)} / 100</strong>
      </div>
    </div>

    <div class="ws-card" style="margin-top:18px;padding:18px 22px;">
      <h3 class="ws-h3" style="margin-top:0;">Ce qui sera livré au prochain sprint</h3>
      <ul style="margin:8px 0 0 0;padding-left:22px;color:var(--ws-text-soft);font-size:13.5px;line-height:1.7;">
        <li>Appel direct au moteur IA (Claude / Gemini / GPT) en BYOK</li>
        <li>Tirage de cartes une par une avec animation flip</li>
        <li>⭐ Favoris / 🔄 Variation / 🗑️ Rejet par carte</li>
        <li>Frameworks pro 1-clic : SCAMPER · 6 chapeaux · Worst Idea · Reverse</li>
        <li>Mode <strong>Crazy 8s</strong> avec timer 8 minutes</li>
        <li>Mode <strong>Chaos</strong> avec mots stimulus aléatoires</li>
        <li>Pour Naming : check domaine .fr disponible + lien INPI</li>
        <li>Export PDF des favoris · sauvegarde bibliothèque D1</li>
      </ul>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Step navigation footer
// ═══════════════════════════════════════════════════════════════
function _stepNav() {
  const idx = _currentStepIndex();
  const isLast = idx === STEPS.length - 1;
  const canBack = idx > 0;
  const canNext = _canAccessStep(idx + 1) && idx < STEPS.length - 1;

  let nextLabel = 'Étape suivante';
  if (_state.view === 'topic' && !_state.topic.mode) {
    nextLabel = 'Choisissez un sujet';
  }

  return `
    <div class="ws-step-nav">
      <button class="ws-btn ws-btn--ghost" data-act="prev" ${canBack ? '' : 'disabled style="visibility:hidden;"'}>
        ${icon('chevron-left', 16)} Précédent
      </button>
      ${isLast
        ? `<span style="font-size:13px;color:var(--ws-text-muted);font-style:italic;">Brainstorm IA arrive au prochain sprint</span>`
        : `<button class="ws-btn ws-btn--primary" data-act="next" ${canNext ? '' : 'disabled'}>
             ${_esc(nextLabel)} ${icon('chevron-right', 16)}
           </button>`
      }
    </div>
  `;
}

function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  const idx = STEPS.findIndex(s => s.id === stepId);
  if (!_canAccessStep(idx)) {
    _toastSoon('Choisissez d\'abord un sujet à l\'étape 1');
    return;
  }
  _state.view = stepId;
  _renderMain();
  // Hydrate les chips quand on arrive sur Calibrate
  if (stepId === 'calibrate') {
    requestAnimationFrame(() => _hydrateCalibrateAsides());
  }
}

function _advance() {
  const i = _currentStepIndex();
  if (i < STEPS.length - 1) _navigate(STEPS[i + 1].id);
}

function _back() {
  const i = _currentStepIndex();
  if (i > 0) _navigate(STEPS[i - 1].id);
}

function _currentStep() { return STEPS.find(s => s.id === _state.view) || STEPS[0]; }
function _currentStepIndex() { return STEPS.findIndex(s => s.id === _state.view); }

// ═══════════════════════════════════════════════════════════════
// Toasts
// ═══════════════════════════════════════════════════════════════
function _toastSoon(label) { _toast(label, false); }
function _toastOk(label)   { _toast(label, true); }

function _toast(message, isSuccess = false) {
  const t = document.createElement('div');
  if (isSuccess) {
    t.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ${message}
    </span>`;
  } else {
    t.textContent = message;
  }
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    background: isSuccess ? 'var(--green)' : '#1a1a1a',
    color: '#fff',
    padding: '10px 18px', borderRadius: '999px',
    fontSize: '13px', fontWeight: '600', letterSpacing: '-0.005em',
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
    zIndex: 10000, opacity: '0',
    transition: 'all 220ms ease',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => t.remove(), 250);
  }, 1800);
}

// ═══════════════════════════════════════════════════════════════
// HTML escape
// ═══════════════════════════════════════════════════════════════
function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
