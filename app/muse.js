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
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import { icon } from './lib/ui-icons.js';
import {
  loadModes, getModes, getMode, getSliders, getTimeBudgets,
  getTargets, getInspirations, getBrandTones, getCoreValues,
  getChannels, getStages, computeBriefQualityScore, getQualityTier,
  getEncouragementMessage, pickStimulusWord,
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

      // ADN du programme (utilisé par les modes génériques)
      brand_tones: [],         // multi-select chips (ton de marque)
      core_value: '',          // single-select chip (valeur centrale)
      keywords_in: [],         // tags input (mots associés à explorer)
      keywords_out: [],        // tags input (mots à éviter)

      // Curseurs génériques (0-100, défaut centre = 50)
      tonality: 50,    // sobre ↔ audacieux
      tone: 50,        // chaleureux ↔ minimaliste
      format: 50,      // slogan ↔ manifeste
      boldness: 30,    // réaliste ↔ décalé

      // Cibles et univers (utilisés par plusieurs modes)
      time_budget: '10min',
      targets: [],
      inspirations: [],

      // Contraintes génériques
      main_channel: '',
      stage: '',
      competitors: '',
      extra: '',
      stimulus_word: '',

      // ── Champs spécifiques MODE NAMING ──
      loved_names: [],         // tags : noms aimés par la chargée de com
      hated_names: [],         // tags : noms détestés (apprentissage négatif)
      sound_palette: '',       // 'soft' | 'firm' | 'airy' | 'any'
      syllables_pref: '',      // '1' | '2' | '3' | '4' | 'any'
      phone_test: '',          // 'crucial' | 'preferred' | 'whatever'

      // ── Champs spécifiques MODE AMBIANCE VISUELLE ──
      daytime_hour: 60,        // 0-100, slider visuel lever → nuit
      season: '',              // 'spring' | 'summer' | 'autumn' | 'winter'
      cinema_ref: '',          // 'editorial' | 'cinematic' | 'documentary' | 'aspirational'
      calm_energy: 50,         // 0-100, slider calme ↔ énergie
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
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('muse', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer">
          ${icon('refresh', 18)}
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
  _root.addEventListener('keydown', _onKeydown);
  bindRatingButton(_root, WORKSPACE_META.id);
  bindHelpButton(_root, WORKSPACE_META.id);
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
  if (act === 'toggle-brand-tone') return _toggleCheckbox('brand_tones', t.dataset.id);
  if (act === 'pick-core-value')   return _pickSingle('core_value', t.dataset.id);
  if (act === 'pick-channel')      return _pickSingle('main_channel', t.dataset.id);
  if (act === 'pick-stage')        return _pickSingle('stage', t.dataset.id);
  if (act === 'pick-time-budget')  return _pickTimeBudget(t.dataset.id);
  // Spécifiques NAMING
  if (act === 'pick-sound')        return _pickSingle('sound_palette', t.dataset.id);
  if (act === 'pick-syllables')    return _pickSingle('syllables_pref', t.dataset.id);
  if (act === 'pick-phone-test')   return _pickSingle('phone_test', t.dataset.id);
  // Spécifiques AMBIANCE
  if (act === 'pick-season')       return _pickSingle('season', t.dataset.id);
  if (act === 'pick-cinema-ref')   return _pickSingle('cinema_ref', t.dataset.id);
  if (act === 'remove-tag')        return _removeTag(t.dataset.group, t.dataset.value);
  if (act === 'surprise-me')       return _surpriseMe();
  if (act === 'reset-stimulus')    return _resetStimulus();
}

function _onInput(e) {
  const el = e.target;
  if (!el.name) return;
  const group = el.dataset.group;
  if (!group) return;
  // Les tags inputs ne synchronisent leur valeur qu'au keydown Enter/virgule
  if (el.dataset.tagsInput) return;
  let value = el.value;
  if (el.type === 'range' || el.type === 'number') {
    value = value === '' ? null : Number(value);
  }
  if (_state[group]) {
    _state[group][el.name] = value;
    _scheduleSave();
    if (group === 'calibrate') _updateQualityGauge();
  }
}

// Capture Enter et virgule sur les tags inputs (keywords_in / keywords_out)
// pour valider un tag à la volée sans bouton Ajouter.
function _onKeydown(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.tagsInput) return;
  if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
    const value = el.value;
    if (!value || !value.trim()) return;
    e.preventDefault();
    _addTag(el.dataset.tagsInput, value);
    el.value = '';
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

// Single-select : clic sur le chip déjà choisi → désélectionne
function _pickSingle(field, id) {
  _state.calibrate[field] = _state.calibrate[field] === id ? '' : id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

function _pickTimeBudget(id) {
  _state.calibrate.time_budget = id;
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

// Retire un tag (keywords_in / keywords_out) cliqué via sa croix
function _removeTag(group, value) {
  const list = _state.calibrate[group] || [];
  _state.calibrate[group] = list.filter(x => x !== value);
  _scheduleSave();
  _renderMain({ preserveScroll: true });
}

// Ajoute un tag suite à validation Enter / virgule dans un tags input
function _addTag(group, value) {
  const v = (value || '').trim().replace(/^,+|,+$/g, '');
  if (!v) return;
  const list = _state.calibrate[group] || [];
  if (!list.includes(v)) {
    _state.calibrate[group] = [...list, v];
    _scheduleSave();
    _renderMain({ preserveScroll: true });
  }
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

  // Le crumb d'étape a été retiré du hero — le rail gauche reste la
  // source de vérité de l'étape courante.
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
// Vue 2 — CALIBRATE · DISPATCHER PAR MODE
// ═══════════════════════════════════════════════════════════════
// Chaque mode a sa propre série de questions ludiques adaptées.
// Sortir du "même formulaire pour tout" = différencier l'UX :
//   · Naming   → préférences sonores, syllabes, test du téléphone
//   · Ambiance → heure du jour, saison, référence cinéma
//   · ... (autres modes : version générique pour l'instant, à
//          refondre selon validation utilisateur)
// La jauge sticky reste commune à tous les modes.
function _viewCalibrate() {
  const sticky = _renderStickyGauge();
  const mode = _state.topic.mode;
  let body = '';
  if (mode === 'naming')        body = _viewCalibrateNaming();
  else if (mode === 'ambiance') body = _viewCalibrateAmbiance();
  else                          body = _viewCalibrateGeneric();
  return sticky + body;
}

// ═══════════════════════════════════════════════════════════════
// Vue Calibrate · MODE NAMING (pilote ludique)
// ═══════════════════════════════════════════════════════════════
function _viewCalibrateNaming() {
  const c = _state.calibrate;

  const SOUNDS = [
    { id: 'soft',  label: 'Doux & mouillé',  hint: 'Lila · Mélilo · Velléa',  emoji: '🍃' },
    { id: 'firm',  label: 'Affirmé & dur',   hint: 'Carrare · Sokar · Hertz', emoji: '🪨' },
    { id: 'airy',  label: 'Aspiré & aérien', hint: 'Halia · Helia · Aerhom',  emoji: '🌬️' },
    { id: 'any',   label: 'Peu importe',     hint: 'Laissez Muse explorer',   emoji: '🎲' },
  ];
  const SYLLABLES = [
    { id: '1',   label: '1',  hint: 'Coupé' },
    { id: '2',   label: '2',  hint: 'Coupole' },
    { id: '3',   label: '3',  hint: 'Cinq Mers' },
    { id: '4',   label: '4+', hint: 'Les Hauts de…' },
    { id: 'any', label: '?',  hint: 'Peu importe' },
  ];
  const PHONE = [
    { id: 'crucial',   label: 'Crucial',       hint: 'commerciaux sur le terrain',  emoji: '🎯' },
    { id: 'preferred', label: 'Souhaitable',   hint: 'utile mais pas bloquant',     emoji: '🤝' },
    { id: 'whatever',  label: 'Pas important', hint: 'le nom restera surtout écrit',emoji: '🤷' },
  ];

  return `
    <span class="ws-eyebrow" style="color:#6366f1;">${icon('edit', 12)} 2 sur 3 · Calibrage Naming</span>
    <h1 class="ws-h1">Trouvons le bon nom à votre programme</h1>
    <p class="ws-lead">
      Quelques préférences pour orienter Muse vers le nom juste.
      <strong style="color:var(--gold);">Vos goûts personnels comptent</strong> —
      donnez-lui des noms que vous aimez et que vous n'aimez pas, il apprendra
      votre sensibilité.
    </p>

    <!-- ── PROGRAMME (compact) ── -->
    <div class="ws-card" style="padding:18px 22px;margin-top:18px;">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px 18px;">
        <div class="ws-field">
          <label class="ws-label">Nom du programme (de travail)</label>
          <input class="ws-input" type="text" name="program_name" data-group="calibrate"
                 value="${_esc(c.program_name || '')}" placeholder="ex. Les Hauts de Bandol — en projet">
        </div>
        <div class="ws-field">
          <label class="ws-label">Localisation</label>
          <input class="ws-input" type="text" name="program_location" data-group="calibrate"
                 value="${_esc(c.program_location || '')}" placeholder="ex. Bandol (Var)">
        </div>
        <div class="ws-field" style="grid-column:1/-1;">
          <label class="ws-label">Description en 2 lignes (le coeur du programme)</label>
          <textarea class="ws-textarea" name="program_description" data-group="calibrate" rows="2"
                    placeholder="ex. 24 lots T2-T4 duplex avec terrasses cascadées sur la mer, façades pierre claire & bois, cible CSP+ méditerranéens.">${_esc(c.program_description || '')}</textarea>
        </div>
      </div>
    </div>

    <!-- ═══ JEU 1 — VOS GOÛTS NAMING ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('sparkles', 14)} Vos goûts naming
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">Muse apprend votre sensibilité</span>
    </h3>
    <p style="font-size:13px;color:var(--ws-text-muted);margin:6px 0 12px 0;">
      Donnez 2-3 noms (de programmes réels ou imaginaires) que vous trouvez beaux,
      et 2-3 que vous trouvez ratés. Muse les utilisera comme références positives/négatives.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div>
        <div style="font-size:12.5px;font-weight:700;color:#10b981;margin-bottom:6px;letter-spacing:-.005em;">
          ${icon('check', 13)} J'aime
        </div>
        ${_renderTagsInput('loved_names', c.loved_names, 'ex. Le Cinq, Coupole, Villa Marius', '#10b981')}
      </div>
      <div>
        <div style="font-size:12.5px;font-weight:700;color:#ef4444;margin-bottom:6px;letter-spacing:-.005em;">
          ${icon('x', 13)} Je n'aime pas
        </div>
        ${_renderTagsInput('hated_names', c.hated_names, 'ex. Le Domaine du, Les Jardins de', '#ef4444')}
      </div>
    </div>

    <!-- ═══ JEU 2 — SONS À PRIVILÉGIER ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('palette', 14)} Sons à privilégier
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">la musicalité du nom</span>
    </h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
      ${SOUNDS.map(s => _bigChip(s, c.sound_palette === s.id, 'pick-sound', '#6366f1')).join('')}
    </div>

    <!-- ═══ JEU 3 — LONGUEUR IDÉALE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('ruler', 14)} Longueur idéale
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">nombre de syllabes du nom principal</span>
    </h3>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${SYLLABLES.map(s => `
        <button data-act="pick-syllables" data-id="${_esc(s.id)}"
                style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:72px;padding:14px 18px;border-radius:14px;border:1px solid ${c.syllables_pref === s.id ? '#6366f1' : 'var(--ws-border)'};background:${c.syllables_pref === s.id ? 'var(--ws-accent-soft)' : 'transparent'};transition:all 140ms ease;">
          <span style="font-size:24px;font-weight:900;letter-spacing:-.022em;color:${c.syllables_pref === s.id ? '#6366f1' : 'var(--ws-text)'};font-variant-numeric:tabular-nums;">${_esc(s.label)}</span>
          <span style="font-size:11px;color:var(--ws-text-muted);margin-top:4px;">${_esc(s.hint)}</span>
        </button>
      `).join('')}
    </div>

    <!-- ═══ JEU 4 — TEST DU TÉLÉPHONE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('help-circle', 14)} Test du téléphone
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">se dire en un souffle, sans répéter ?</span>
    </h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;">
      ${PHONE.map(p => _bigChip(p, c.phone_test === p.id, 'pick-phone-test', '#6366f1')).join('')}
    </div>

    <!-- ═══ UNIVERS D'INSPIRATION (commun) ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('globe', 14)} Univers d'inspiration
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">l'ambiance qui colle au programme</span>
    </h3>
    <div data-slot="inspirations" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ═══ MOTS À ÉVITER ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('shield-check', 14)} Mots interdits
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">cassez les clichés</span>
    </h3>
    ${_renderTagsInput('keywords_out', c.keywords_out, 'ex. résidence, domaine, élégance, prestige', '#ef4444')}

    <!-- ═══ ALLER PLUS LOIN (dépliable) ═══ -->
    <details style="margin-top:28px;">
      <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--ws-text);letter-spacing:-.005em;list-style:none;padding:10px 0;border-top:1px solid var(--ws-border);outline:none;">
        ${icon('chevron-down', 14)} Aller plus loin (optionnel)
      </summary>
      <div class="ws-card" style="padding:22px 26px;margin-top:8px;">
        <div class="ws-field">
          <label class="ws-label">Programmes voisins ou concurrents</label>
          <input class="ws-input" type="text" name="competitors" data-group="calibrate"
                 value="${_esc(c.competitors || '')}" placeholder="ex. Les Terrasses du Soleil (Sanary)">
        </div>
        <div class="ws-field" style="margin-top:14px;">
          <label class="ws-label">Consignes spéciales libres</label>
          <textarea class="ws-textarea" name="extra" data-group="calibrate" rows="3"
                    placeholder="ex. Le promoteur préfère un nom court. Cible locale (Var). Éviter le ton cosmopolite.">${_esc(c.extra || '')}</textarea>
        </div>
      </div>
    </details>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue Calibrate · MODE AMBIANCE VISUELLE (pilote ludique)
// ═══════════════════════════════════════════════════════════════
function _viewCalibrateAmbiance() {
  const c = _state.calibrate;

  const SEASONS = [
    { id: 'spring', label: 'Printemps',   hint: 'verdure tendre, lumière claire', emoji: '🌸',
      bg: 'linear-gradient(135deg, #86efac 0%, #fde68a 100%)' },
    { id: 'summer', label: 'Été',         hint: 'soleil franc, ciel azur',        emoji: '☀️',
      bg: 'linear-gradient(135deg, #fcd34d 0%, #f97316 100%)' },
    { id: 'autumn', label: 'Automne',     hint: 'lumière dorée, palette chaude',  emoji: '🍂',
      bg: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' },
    { id: 'winter', label: 'Hiver',       hint: 'lumière froide, atmosphère épurée', emoji: '❄️',
      bg: 'linear-gradient(135deg, #93c5fd 0%, #e0e7ff 100%)' },
  ];
  const CINEMA = [
    { id: 'editorial',     label: 'Éditorial sobre',       hint: 'Dezeen, AD · sans pose, composition rigoureuse', emoji: '📐' },
    { id: 'cinematic',     label: 'Cinématique chaud',     hint: 'anamorphique, golden hour, profondeur de champ',  emoji: '🎥' },
    { id: 'documentary',   label: 'Documentaire',          hint: 'lumière naturelle, instants saisis, sans artifice', emoji: '📸' },
    { id: 'aspirational',  label: 'Aspirational glossy',   hint: 'haute saturation, mode magazine luxe',            emoji: '✨' },
  ];

  const dayHourLabel = c.daytime_hour < 20 ? 'Lever du soleil'
                    : c.daytime_hour < 40 ? 'Matinée claire'
                    : c.daytime_hour < 60 ? 'Plein midi'
                    : c.daytime_hour < 80 ? 'Golden hour'
                    : c.daytime_hour < 95 ? 'Crépuscule'
                    :                       'Nuit signature';

  return `
    <span class="ws-eyebrow" style="color:#10b981;">${icon('palette', 12)} 2 sur 3 · Calibrage Ambiance</span>
    <h1 class="ws-h1">Dessinons l'univers visuel cible</h1>
    <p class="ws-lead">
      Quelques choix pour cadrer la direction artistique. Ces réponses seront
      transmises à Muse pour générer des propositions cohérentes que vous
      passerez à votre studio 3D — <strong style="color:var(--gold);">vraies
      références, pas le projet lui-même</strong>.
    </p>

    <!-- ── PROGRAMME (compact) ── -->
    <div class="ws-card" style="padding:18px 22px;margin-top:18px;">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px 18px;">
        <div class="ws-field">
          <label class="ws-label">Nom du programme</label>
          <input class="ws-input" type="text" name="program_name" data-group="calibrate"
                 value="${_esc(c.program_name || '')}" placeholder="ex. Les Hauts de Bandol">
        </div>
        <div class="ws-field">
          <label class="ws-label">Localisation</label>
          <input class="ws-input" type="text" name="program_location" data-group="calibrate"
                 value="${_esc(c.program_location || '')}" placeholder="ex. Bandol (Var)">
        </div>
        <div class="ws-field" style="grid-column:1/-1;">
          <label class="ws-label">Description visuelle en 2 lignes (volumes, matériaux, paysage)</label>
          <textarea class="ws-textarea" name="program_description" data-group="calibrate" rows="2"
                    placeholder="ex. Terrasses cascadées avec vue sur la baie, façades pierre claire & bois, jardin paysagé méditerranéen.">${_esc(c.program_description || '')}</textarea>
        </div>
      </div>
    </div>

    <!-- ═══ JEU 1 — HEURE DE LA JOURNÉE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('eye', 14)} Heure de la journée idéale
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">la lumière qui sert le mieux le programme</span>
    </h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ws-text-muted);">Position</span>
        <span style="font-size:15px;font-weight:800;letter-spacing:-.018em;color:#10b981;">${_esc(dayHourLabel)}</span>
      </div>
      <div style="position:relative;height:46px;border-radius:14px;overflow:hidden;background:linear-gradient(90deg, #fde68a 0%, #fbbf24 18%, #ffffff 38%, #fcd34d 60%, #f97316 78%, #312e81 92%, #0f172a 100%);">
        <input type="range" min="0" max="100" step="1" value="${c.daytime_hour ?? 60}"
               name="daytime_hour" data-group="calibrate"
               style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;">
        <div style="position:absolute;top:0;bottom:0;left:${c.daytime_hour ?? 60}%;transform:translateX(-50%);width:4px;background:#fff;border-radius:2px;box-shadow:0 0 0 2px rgba(0,0,0,.2), 0 2px 6px rgba(0,0,0,.3);pointer-events:none;"></div>
        <div style="position:absolute;left:6px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;opacity:.85;">🌅</div>
        <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;pointer-events:none;opacity:.85;">☀️</div>
        <div style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;opacity:.85;">🌙</div>
      </div>
    </div>

    <!-- ═══ JEU 2 — SAISON PRINCIPALE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('package', 14)} Saison principale
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">l'atmosphère climatique cible</span>
    </h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;">
      ${SEASONS.map(s => {
        const selected = c.season === s.id;
        return `
          <button data-act="pick-season" data-id="${_esc(s.id)}"
                  style="all:unset;cursor:pointer;display:block;padding:0;border-radius:14px;overflow:hidden;border:2px solid ${selected ? '#10b981' : 'transparent'};box-shadow:${selected ? '0 8px 24px rgba(16,185,129,.25)' : '0 2px 6px rgba(0,0,0,.08)'};transition:all 180ms ease;">
            <div style="background:${s.bg};padding:24px 18px;text-align:center;">
              <div style="font-size:32px;line-height:1;margin-bottom:6px;">${s.emoji}</div>
              <div style="font-size:14px;font-weight:800;letter-spacing:-.012em;color:#0f172a;">${_esc(s.label)}</div>
            </div>
            <div style="background:var(--ws-surface);padding:10px 14px;font-size:11.5px;color:var(--ws-text-muted);text-align:center;border-top:1px solid var(--ws-border);">
              ${_esc(s.hint)}
            </div>
          </button>
        `;
      }).join('')}
    </div>

    <!-- ═══ JEU 3 — RÉFÉRENCE CINÉMATOGRAPHIQUE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('image', 14)} Référence visuelle
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">le style à imiter</span>
    </h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px;">
      ${CINEMA.map(r => _bigChip(r, c.cinema_ref === r.id, 'pick-cinema-ref', '#10b981')).join('')}
    </div>

    <!-- ═══ JEU 4 — ÉMOTION DOMINANTE ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('sparkles', 14)} Émotion dominante
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">ce que doit ressentir l'acheteur en voyant l'image</span>
    </h3>
    <div class="ws-card" style="padding:22px 26px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:22px;">🧘</span>
        <input type="range" min="0" max="100" step="1" value="${c.calm_energy ?? 50}"
               name="calm_energy" data-group="calibrate"
               style="flex:1;accent-color:#10b981;height:6px;cursor:pointer;">
        <span style="font-size:22px;">⚡</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ws-text-muted);margin-top:6px;">
        <span>Calme · contemplatif</span>
        <span>${c.calm_energy ?? 50} / 100</span>
        <span>Énergie · vibrant</span>
      </div>
    </div>

    <!-- ═══ CIBLES (commun) ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('check-square', 14)} Cible humaine présente dans la scène
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">silhouette abstraite, jamais le projet réel</span>
    </h3>
    <div data-slot="targets" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ═══ MOTS À ÉVITER ═══ -->
    <h3 class="ws-h3" style="margin-top:32px;">
      ${icon('shield-check', 14)} Codes visuels à éviter
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">vocabulaire visuel banni</span>
    </h3>
    ${_renderTagsInput('keywords_out', c.keywords_out, 'ex. piscine flashy, mobilier rococo, palmiers tropicaux', '#ef4444')}

    <!-- ═══ ALLER PLUS LOIN ═══ -->
    <details style="margin-top:28px;">
      <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--ws-text);letter-spacing:-.005em;list-style:none;padding:10px 0;border-top:1px solid var(--ws-border);outline:none;">
        ${icon('chevron-down', 14)} Aller plus loin (optionnel)
      </summary>
      <div class="ws-card" style="padding:22px 26px;margin-top:8px;">
        <div class="ws-field">
          <label class="ws-label">Consignes spéciales libres</label>
          <textarea class="ws-textarea" name="extra" data-group="calibrate" rows="3"
                    placeholder="ex. Vue mer obligatoire dans toutes les références. Le studio aime les palettes minérales. Éviter tout cliché 'côte d'azur années 80'.">${_esc(c.extra || '')}</textarea>
        </div>
      </div>
    </details>
  `;
}

// ── Mini-composant : big chip (avec emoji + hint) ─────────────
function _bigChip(opt, selected, act, accent) {
  return `
    <button data-act="${act}" data-id="${_esc(opt.id)}"
            style="all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:14px 16px;border-radius:12px;background:${selected ? accent + '14' : 'var(--ws-surface)'};border:1px solid ${selected ? accent : 'var(--ws-border)'};transition:all 160ms ease;${selected ? `box-shadow: 0 0 0 1px ${accent} inset;` : ''}">
      <div style="display:flex;align-items:center;gap:8px;">
        ${opt.emoji ? `<span style="font-size:18px;">${opt.emoji}</span>` : ''}
        <span style="font-size:13.5px;font-weight:700;letter-spacing:-.005em;color:${selected ? accent : 'var(--ws-text)'};">${_esc(opt.label)}</span>
        ${selected ? `<span style="margin-left:auto;color:${accent};">${icon('check', 13)}</span>` : ''}
      </div>
      ${opt.hint ? `<span style="font-size:11.5px;color:var(--ws-text-muted);line-height:1.4;">${_esc(opt.hint)}</span>` : ''}
    </button>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue Calibrate · GÉNÉRIQUE (fallback pour les 6 autres modes)
// ═══════════════════════════════════════════════════════════════
function _viewCalibrateGeneric() {
  const c = _state.calibrate;
  const stimulus = c.stimulus_word;

  return `
    <span class="ws-eyebrow">${icon('sliders', 12)} 2 sur 3 · Le calibrage</span>
    <h1 class="ws-h1">Posez votre brief, débloquez vos idées</h1>
    <p class="ws-lead">
      Chaque champ rempli aide Muse à produire des idées plus précises.
      La jauge en haut vous indique en temps réel la qualité du brief.
      <strong style="color:var(--gold);">Vous n'êtes pas obligé·e de tout remplir</strong>&nbsp;—
      cliquez aussi sur 🎲 <em>Surprends-moi</em> pour débloquer la créativité.
    </p>

    <div class="ws-card" style="margin-top:18px;padding:14px 18px;background:rgba(99,102,241,.06);border-color:rgba(99,102,241,.3);">
      <p style="margin:0;font-size:12.5px;color:var(--ws-text-soft);line-height:1.55;">
        ${icon('sparkles', 13)}
        <strong style="color:var(--ws-text);">Mode pilote</strong> · Les modes
        <strong>Naming</strong> et <strong>Ambiance visuelle</strong> ont déjà
        leur calibrage ludique dédié (mini-jeux, questions spécifiques). Les autres
        modes (Positionnement, Punchlines, Marketing, Objections, Libre, Mix-tout)
        utilisent encore ce formulaire générique — refonte ludique au prochain sprint.
      </p>
    </div>

    <!-- ═══ SECTION 1 — LE PROGRAMME ══════════════════════════ -->
    <h3 class="ws-h3" style="margin-top:28px;">
      ${icon('building', 14)} Le programme
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">35 pts</span>
    </h3>
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

    <!-- ═══ SECTION 2 — L'ADN DU PROGRAMME ═══════════════════ -->
    <h3 class="ws-h3" style="margin-top:28px;">
      ${icon('sparkles', 14)} L'ADN du programme
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">25 pts · le cœur du brief</span>
    </h3>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:14px 0 8px 0;letter-spacing:-.005em;">
      Ton de marque · que doit-on ressentir&nbsp;?
      <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">multi-choix</span>
    </div>
    <div data-slot="brand-tones" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Valeur centrale · qu'est-ce qui rend ce programme désirable AVANT TOUT&nbsp;?
      <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">un seul choix</span>
    </div>
    <div data-slot="core-values" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Mots associés à explorer · que vous vient-il en pensant à ce programme&nbsp;?
      <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">tapez puis Entrée — ou virgule</span>
    </div>
    ${_renderTagsInput('keywords_in', c.keywords_in, 'ex. silence, horizon, pierre, calme, dehors', '#10b981')}

    <!-- ═══ SECTION 3 — LES CADRANS CRÉATIFS ════════════════ -->
    <h3 class="ws-h3" style="margin-top:28px;">
      ${icon('sliders', 14)} Les cadrans créatifs
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">5 pts si déplacés</span>
    </h3>
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

    <!-- ═══ SECTION 4 — CIBLES ET UNIVERS ═══════════════════ -->
    <h3 class="ws-h3" style="margin-top:28px;">
      ${icon('check-square', 14)} Cibles & univers
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">15 pts</span>
    </h3>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:14px 0 8px 0;letter-spacing:-.005em;">
      Cibles acheteurs · qui sont les acquéreurs visés&nbsp;? <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">multi-choix</span>
    </div>
    <div data-slot="targets" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Univers d'inspiration · l'ambiance qui colle au programme <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">multi-choix</span>
    </div>
    <div data-slot="inspirations" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Temps disponible · pour cette session de brainstorm
    </div>
    <div data-slot="time-budget" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ═══ SECTION 5 — CONTRAINTES & RAFFINEMENTS ══════════ -->
    <h3 class="ws-h3" style="margin-top:28px;">
      ${icon('shield-check', 14)} Contraintes & raffinements
      <span style="font-size:11px;color:var(--ws-text-muted);font-weight:500;margin-left:6px;">15 pts</span>
    </h3>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:14px 0 8px 0;letter-spacing:-.005em;">
      Mots à éviter · vocabulaire interdit dans les propositions
      <span style="font-weight:500;color:var(--ws-text-muted);font-size:12px;">tapez puis Entrée — utile pour casser les clichés</span>
    </div>
    ${_renderTagsInput('keywords_out', c.keywords_out, 'ex. résidence, domaine, élégance, prestige', '#ef4444')}

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Canal principal · où seront diffusées les idées en priorité&nbsp;?
    </div>
    <div data-slot="channels" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <div style="font-size:13px;font-weight:700;color:var(--ws-text);margin:18px 0 8px 0;letter-spacing:-.005em;">
      Stade de commercialisation · à quel moment de la vie du programme&nbsp;?
    </div>
    <div data-slot="stages" style="display:flex;flex-wrap:wrap;gap:8px;">
      <span style="font-size:12px;color:var(--ws-text-muted);">Chargement…</span>
    </div>

    <!-- ═══ SECTION 6 — ALLER PLUS LOIN (optionnel) ═════════ -->
    <details style="margin-top:28px;">
      <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--ws-text);letter-spacing:-.005em;list-style:none;padding:10px 0;border-top:1px solid var(--ws-border);outline:none;">
        ${icon('chevron-down', 14)} Aller plus loin (optionnel)
      </summary>
      <div class="ws-card" style="padding:22px 26px;margin-top:8px;">
        <div class="ws-field">
          <label class="ws-label">Programmes voisins ou concurrents</label>
          <input class="ws-input" type="text" name="competitors" data-group="calibrate"
                 value="${_esc(c.competitors || '')}"
                 placeholder="ex. Les Terrasses du Soleil (Sanary), Villa Marius (Cassis)">
        </div>
        <div class="ws-field" style="margin-top:14px;">
          <label class="ws-label">Quelque chose de plus à dire&nbsp;? (consignes spéciales, contraintes diverses)</label>
          <textarea class="ws-textarea" name="extra" data-group="calibrate" rows="3"
                    placeholder="ex. Le promoteur préfère un nom court et facile à prononcer au téléphone. La cible est plutôt locale (Var, Bouches-du-Rhône). Éviter le ton 'cosmopolite'.">${_esc(c.extra || '')}</textarea>
        </div>
      </div>
    </details>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Jauge sticky en haut + message d'encouragement
// ═══════════════════════════════════════════════════════════════
function _renderStickyGauge() {
  const score = computeBriefQualityScore(_state);
  const tier = getQualityTier(score);
  const msg = getEncouragementMessage(_state);
  const msgColor = msg.type === 'ready'  ? 'var(--green)'
                 : msg.type === 'almost' ? 'var(--gold)'
                 :                          'var(--ws-text-soft)';
  return `
    <div data-slot="quality-gauge"
         style="position:sticky;top:0;z-index:5;margin:-24px -24px 18px -24px;padding:14px 28px;background:linear-gradient(180deg, var(--ws-bg-elev, var(--ws-surface)) 0%, var(--ws-bg-elev, var(--ws-surface)) 90%, transparent 100%);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid ${tier.color}33;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div style="display:flex;align-items:baseline;gap:8px;">
            <span style="font-size:24px;font-weight:900;letter-spacing:-.022em;color:${tier.color};font-variant-numeric:tabular-nums;">${score}</span>
            <span style="font-size:13px;color:var(--ws-text-muted);font-variant-numeric:tabular-nums;">/ 100</span>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-text-muted);">
              Qualité du brief
            </div>
            <div style="font-size:14px;font-weight:700;color:${tier.color};">
              ${tier.label}
            </div>
          </div>
        </div>
        <div style="flex:1;min-width:200px;max-width:380px;height:10px;background:var(--ws-border);border-radius:999px;overflow:hidden;position:relative;">
          <div style="position:absolute;inset:0 auto 0 0;width:${score}%;background:linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%);border-radius:999px;transition:width 280ms cubic-bezier(.4,0,.2,1);"></div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:12.5px;line-height:1.5;color:${msgColor};">
        ${msg.type === 'ready' ? icon('check', 13) : icon('sparkles', 13)}
        <span style="margin-left:4px;">${_esc(msg.text)}</span>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Tags input mini-composant (keywords_in / keywords_out)
// ═══════════════════════════════════════════════════════════════
function _renderTagsInput(field, values, placeholder, accent) {
  const tags = Array.isArray(values) ? values : [];
  return `
    <div class="ws-card" style="padding:14px 18px;margin-bottom:10px;">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        ${tags.map(v => `
          <span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px 5px 12px;border-radius:999px;background:${accent}1a;color:${accent};font-size:12.5px;font-weight:600;border:1px solid ${accent}33;">
            ${_esc(v)}
            <button data-act="remove-tag" data-group="${field}" data-value="${_esc(v)}"
                    style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;color:${accent};opacity:.7;transition:opacity 140ms ease;"
                    onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.7'"
                    title="Retirer">
              ${icon('x', 12)}
            </button>
          </span>
        `).join('')}
        <input type="text"
               data-tags-input="${field}"
               data-group="calibrate"
               name="_tag_${field}"
               placeholder="${_esc(placeholder)}"
               style="flex:1;min-width:180px;all:unset;padding:6px 8px;font-size:13px;color:var(--ws-text);background:transparent;font-family:inherit;">
      </div>
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

// ── Hydrate tous les slots de chips (multi + single select) ──
function _hydrateCalibrateAsides() {
  const c = _state.calibrate;

  // Multi-select : Brand tones / Targets / Inspirations
  getBrandTones().then(items => {
    const slot = _root?.querySelector('[data-slot="brand-tones"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, (c.brand_tones || []).includes(o.id), 'toggle-brand-tone')).join('');
  });
  getTargets().then(items => {
    const slot = _root?.querySelector('[data-slot="targets"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, (c.targets || []).includes(o.id), 'toggle-target')).join('');
  });
  getInspirations().then(items => {
    const slot = _root?.querySelector('[data-slot="inspirations"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, (c.inspirations || []).includes(o.id), 'toggle-inspiration')).join('');
  });

  // Single-select : Core values / Channels / Stages / Time budget
  getCoreValues().then(items => {
    const slot = _root?.querySelector('[data-slot="core-values"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, c.core_value === o.id, 'pick-core-value')).join('');
  });
  getChannels().then(items => {
    const slot = _root?.querySelector('[data-slot="channels"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, c.main_channel === o.id, 'pick-channel')).join('');
  });
  getStages().then(items => {
    const slot = _root?.querySelector('[data-slot="stages"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, c.stage === o.id, 'pick-stage')).join('');
  });
  getTimeBudgets().then(items => {
    const slot = _root?.querySelector('[data-slot="time-budget"]');
    if (!slot) return;
    slot.innerHTML = items.map(o => _chipHTML(o, (c.time_budget || '10min') === o.id, 'pick-time-budget')).join('');
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

// ── Update live de la jauge sticky "Qualité du brief" ─────────
function _updateQualityGauge() {
  const slot = _root?.querySelector('[data-slot="quality-gauge"]');
  if (!slot) return;
  const score = computeBriefQualityScore(_state);
  const tier = getQualityTier(score);
  const msg = getEncouragementMessage(_state);
  const msgColor = msg.type === 'ready'  ? 'var(--green)'
                 : msg.type === 'almost' ? 'var(--gold)'
                 :                          'var(--ws-text-soft)';
  slot.style.borderBottomColor = `${tier.color}33`;
  slot.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div style="display:flex;align-items:baseline;gap:8px;">
          <span style="font-size:24px;font-weight:900;letter-spacing:-.022em;color:${tier.color};font-variant-numeric:tabular-nums;">${score}</span>
          <span style="font-size:13px;color:var(--ws-text-muted);font-variant-numeric:tabular-nums;">/ 100</span>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-text-muted);">
            Qualité du brief
          </div>
          <div style="font-size:14px;font-weight:700;color:${tier.color};">
            ${tier.label}
          </div>
        </div>
      </div>
      <div style="flex:1;min-width:200px;max-width:380px;height:10px;background:var(--ws-border);border-radius:999px;overflow:hidden;position:relative;">
        <div style="position:absolute;inset:0 auto 0 0;width:${score}%;background:linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%);border-radius:999px;transition:width 280ms cubic-bezier(.4,0,.2,1);"></div>
      </div>
    </div>
    <div style="margin-top:8px;font-size:12.5px;line-height:1.5;color:${msgColor};">
      ${msg.type === 'ready' ? icon('check', 13) : icon('sparkles', 13)}
      <span style="margin-left:4px;">${_esc(msg.text)}</span>
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
