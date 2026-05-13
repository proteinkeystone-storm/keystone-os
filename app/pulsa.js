/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact PULSA (A-COM-004) v1.1-builder
   Sprint Pulsa-2A : builder linéaire (sections + 10 types de champs).

   Pulsa = builder de formulaires intelligents (questionnaires,
   diagnostics, onboarding). 4 étapes :
     1. Structure   — sections & champs (CETTE V1)
     2. Apparence   — identité visuelle  (P2A.6)
     3. Livraison   — URL & destinataires (P2A.7)
     4. Publication — preview & publier   (P2A.8)

   Stratégie économe : pas de stockage binaires (uploads HD = lien
   externe), TTL 90j configurable, mail Resend = backup permanent.
   ═══════════════════════════════════════════════════════════════ */

import { icon } from './lib/ui-icons.js';
import { scheduleAutoSave } from './vault.js';
import {
  FIELD_TYPES,
  FIELD_GROUPS,
  FIELD_WIDTHS,
  newField,
  newSection,
  newForm,
} from './lib/pulsa-types.js';

// ── Métadonnées de l'artefact ─────────────────────────────────
const WORKSPACE_META = {
  id: 'A-COM-004',
  name: 'Pulsa',
  punchline: 'Le formulaire intelligent qui collecte sans friction',
};

const STEPS = [
  { id: 'structure',  label: 'Structure',   ico: 'sliders',  sub: 'Sections & champs' },
  { id: 'appearance', label: 'Apparence',   ico: 'palette',  sub: 'Identité visuelle' },
  { id: 'delivery',   label: 'Livraison',   ico: 'globe',    sub: 'URL & destinataires' },
  { id: 'publish',    label: 'Publication', ico: 'sparkles', sub: 'Preview & publier' },
];

const DRAFT_KEY = 'ks_pulsa_draft';

// ── État global ───────────────────────────────────────────────
let _state = _initState();
let _root  = null;
let _currentStepId = 'structure';
let _fieldTypeMenu = null; // { sectionId } quand ouvert
let _lastSavedAt = null;
let _saveIndicatorTimer = null;

function _initState() {
  return {
    form: newForm(),
    ui: { selected_section_id: null },
  };
}

function _currentStep() {
  return STEPS.find(s => s.id === _currentStepId) || STEPS[0];
}

function _stepIndex(stepId) {
  return STEPS.findIndex(s => s.id === stepId);
}

/**
 * Une étape est "is-done" quand ses conditions minimales sont remplies.
 * Pulsa n'est pas un wizard linéaire — toutes les étapes sont navigables
 * à tout moment, mais le rail signale visuellement la complétion.
 */
function _isStepDone(stepId) {
  const f = _state.form;
  switch (stepId) {
    case 'structure':
      return f.sections.length > 0 &&
             f.sections.some(s => s.fields.length > 0);
    case 'appearance':
      return Boolean(f.meta.title?.trim());
    case 'delivery':
      return Boolean(f.meta.slug?.trim()) &&
             f.delivery.recipients.length > 0;
    case 'publish':
      return f.output.status === 'published';
    default:
      return false;
  }
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
  _fieldTypeMenu = null;
}

// ═══════════════════════════════════════════════════════════════
// Shell
// ═══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app pulsa-app';
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
        <span class="pulsa-save-indicator" data-slot="save-indicator" aria-live="polite">
          ${icon('check', 12)}<span data-slot="save-label">Enregistré</span>
        </span>
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
      <aside class="ws-aside pulsa-aside" data-slot="aside"></aside>
    </div>

    <div class="pulsa-modal" data-slot="modal" hidden></div>
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

  if (act === 'close')           return closePulsa();
  if (act === 'goto')            return _navigate(t.dataset.step);
  if (act === 'next-step')       return _navigateRelative(+1);
  if (act === 'prev-step')       return _navigateRelative(-1);
  if (act === 'publish-form')    return _publishForm();
  if (act === 'save')            { _saveDraft({ explicit: true }); return; }

  // Structure — sections
  if (act === 'add-section')     return _addSection();
  if (act === 'delete-section')  return _deleteSection(t.dataset.id);

  // Structure — champs
  if (act === 'open-field-menu')  return _openFieldTypeMenu(t.dataset.section);
  if (act === 'close-modal')      return _closeModal();
  if (act === 'pick-field-type')  return _addField(_fieldTypeMenu?.sectionId, t.dataset.type);
  if (act === 'delete-field')     return _deleteField(t.dataset.section, t.dataset.field);
  if (act === 'toggle-required')  return _toggleRequired(t.dataset.section, t.dataset.field);
  if (act === 'cycle-field-width') return _cycleFieldWidth(t.dataset.section, t.dataset.field);
}

function _onInput(e) {
  const t = e.target.closest('[data-bind]');
  if (t) {
    _applyBinding(t);
  }
  _saveDraft();
}

function _onKeydown(e) {
  if (e.key === 'Escape') {
    if (_fieldTypeMenu) return _closeModal();
    return closePulsa();
  }
}

/**
 * Met à jour le state à partir d'un input avec data-bind.
 * Format : "form.meta.title" | "section.<id>.title" | "field.<sectionId>.<fieldId>.label"
 */
function _applyBinding(input) {
  const path = input.dataset.bind;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  const parts = path.split('.');

  if (parts[0] === 'form') {
    let ref = _state.form;
    for (let i = 1; i < parts.length - 1; i++) ref = ref[parts[i]];
    ref[parts[parts.length - 1]] = value;
    return;
  }
  if (parts[0] === 'section') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    if (sec) sec[parts[2]] = value;
    return;
  }
  if (parts[0] === 'field') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    if (!sec) return;
    const fld = sec.fields.find(f => f.id === parts[2]);
    if (fld) fld[parts[3]] = value;
  }
}

// ═══════════════════════════════════════════════════════════════
// Navigation entre étapes
// ═══════════════════════════════════════════════════════════════
function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  _currentStepId = stepId;
  const crumb = _root?.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  _renderMain();
}

function _navigateRelative(delta) {
  const i = _stepIndex(_currentStepId);
  const next = STEPS[i + delta];
  if (next) _navigate(next.id);
}

function _publishForm() {
  alert('Publication du formulaire : disponible à partir de la Phase 3 (route publique /f/{slug} + Worker collecte + mail Resend).');
}

// ═══════════════════════════════════════════════════════════════
// Actions Structure
// ═══════════════════════════════════════════════════════════════
function _addSection() {
  const sec = newSection(`Section ${_state.form.sections.length + 1}`);
  _state.form.sections.push(sec);
  _state.ui.selected_section_id = sec.id;
  _renderMain();
  _saveDraft();
}

function _deleteSection(sectionId) {
  if (!confirm('Supprimer cette section et tous ses champs ?')) return;
  _state.form.sections = _state.form.sections.filter(s => s.id !== sectionId);
  _renderMain();
  _saveDraft();
}

function _openFieldTypeMenu(sectionId) {
  _fieldTypeMenu = { sectionId };
  _renderFieldTypeMenu();
}

function _closeModal() {
  _fieldTypeMenu = null;
  const m = _root?.querySelector('[data-slot="modal"]');
  if (m) { m.hidden = true; m.innerHTML = ''; }
}

function _addField(sectionId, type) {
  if (!sectionId || !type) return _closeModal();
  const sec = _state.form.sections.find(s => s.id === sectionId);
  if (!sec) return _closeModal();
  sec.fields.push(newField(type));
  _closeModal();
  _renderMain();
  _saveDraft();
}

function _deleteField(sectionId, fieldId) {
  const sec = _state.form.sections.find(s => s.id === sectionId);
  if (!sec) return;
  sec.fields = sec.fields.filter(f => f.id !== fieldId);
  _renderMain();
  _saveDraft();
}

function _toggleRequired(sectionId, fieldId) {
  const sec = _state.form.sections.find(s => s.id === sectionId);
  const fld = sec?.fields.find(f => f.id === fieldId);
  if (!fld) return;
  fld.required = !fld.required;
  _renderMain();
  _saveDraft();
}

function _cycleFieldWidth(sectionId, fieldId) {
  const sec = _state.form.sections.find(s => s.id === sectionId);
  const fld = sec?.fields.find(f => f.id === fieldId);
  if (!fld) return;
  const current = FIELD_WIDTHS.indexOf(fld.width || 'full');
  fld.width = FIELD_WIDTHS[(current + 1) % FIELD_WIDTHS.length];
  _renderMain();
  _saveDraft();
}

// ═══════════════════════════════════════════════════════════════
// Rendu
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root?.querySelector('[data-slot="rail"]');
  if (!rail) return;
  rail.innerHTML = `
    <div class="ws-rail-section">Étapes</div>
    ${STEPS.map((s, i) => {
      const isActive = s.id === _currentStepId;
      const isDone   = !isActive && _isStepDone(s.id);
      const status   = isActive ? 'is-active' : (isDone ? 'is-done' : '');
      const numContent = isDone ? icon('check', 12) : (i + 1);
      return `
        <button class="ws-step ${status}" data-act="goto" data-step="${s.id}">
          <span class="ws-step-num">${numContent}</span>
          <span class="ws-step-icon" style="width:18px;height:18px;">${icon(s.ico, 18)}</span>
          <span class="ws-step-label">${s.label}</span>
        </button>
      `;
    }).join('')}
  `;
}

function _renderMain() {
  const main = _root?.querySelector('[data-slot="main"]');
  if (!main) return;
  switch (_currentStepId) {
    case 'structure':  _renderStructure(main); break;
    case 'appearance': _renderPlaceholder(main, 'Apparence', 'Couleurs, logo, intro (P2A.6)'); break;
    case 'delivery':   _renderPlaceholder(main, 'Livraison', 'URL, destinataires direction, TTL (P2A.7)'); break;
    case 'publish':    _renderPlaceholder(main, 'Publication', 'Preview final & publier (P2A.8)'); break;
  }
  main.insertAdjacentHTML('beforeend', _renderStepFooter());
}

function _renderStepFooter() {
  const i = _stepIndex(_currentStepId);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  const isLast = i === STEPS.length - 1;
  return `
    <footer class="pulsa-step-footer">
      <div class="pulsa-step-footer-left">
        ${prev ? `
          <button class="pulsa-btn pulsa-btn-ghost" data-act="prev-step">
            ${icon('arrow-left', 14)}<span>Étape précédente : ${prev.label}</span>
          </button>
        ` : ''}
      </div>
      <div class="pulsa-step-footer-right">
        ${isLast ? `
          <button class="pulsa-btn pulsa-btn-primary pulsa-btn-publish" data-act="publish-form">
            ${icon('sparkles', 16)}<span>Publier le formulaire</span>
          </button>
        ` : `
          <button class="pulsa-btn pulsa-btn-primary" data-act="next-step">
            <span>Continuer : ${next.label}</span>${icon('arrow-right', 14)}
          </button>
        `}
      </div>
    </footer>
  `;
}

function _renderPlaceholder(main, label, subline) {
  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">${label}</h1>
      <p class="ws-step-sub">${subline}</p>
    </div>
    <div class="pulsa-placeholder">
      ${icon('sparkles', 32)}
      <h2>Étape en cours de construction</h2>
      <p>Disponible dans la prochaine itération du builder.</p>
    </div>
  `;
}

function _renderStructure(main) {
  const sections = _state.form.sections;

  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">Structure du formulaire</h1>
      <p class="ws-step-sub">Composez vos sections et leurs champs. La logique conditionnelle arrive en Phase 2B.</p>
    </div>

    <div class="pulsa-form-meta">
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Titre du formulaire</span>
        <input class="pulsa-input" type="text" placeholder="Ex : Diagnostic opérationnel Prométhée"
               data-bind="form.meta.title" value="${_escape(_state.form.meta.title)}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Intro courte (affichée en tête du formulaire)</span>
        <textarea class="pulsa-input" rows="2" placeholder="Quelques mots pour expliquer le contexte aux répondants"
                  data-bind="form.meta.intro">${_escape(_state.form.meta.intro)}</textarea>
      </label>
    </div>

    <div class="pulsa-sections">
      ${sections.length === 0 ? `
        <div class="pulsa-empty">
          <p>Aucune section pour le moment.</p>
          <button class="pulsa-btn pulsa-btn-primary" data-act="add-section">
            ${icon('plus', 16)}<span>Créer la première section</span>
          </button>
        </div>
      ` : sections.map((s, idx) => _renderSection(s, idx)).join('')}
    </div>

    ${sections.length > 0 ? `
      <div class="pulsa-section-add">
        <button class="pulsa-btn pulsa-btn-ghost" data-act="add-section">
          ${icon('plus', 16)}<span>Ajouter une section</span>
        </button>
      </div>
    ` : ''}
  `;

  _renderAside();
}

function _renderSection(section, index) {
  return `
    <section class="pulsa-section" data-section-id="${section.id}">
      <header class="pulsa-section-head">
        <span class="pulsa-section-num">${index + 1}</span>
        <div class="pulsa-section-inputs">
          <input class="pulsa-input pulsa-section-title"
                 type="text" placeholder="Titre de la section"
                 data-bind="section.${section.id}.title"
                 value="${_escape(section.title)}">
          <input class="pulsa-input pulsa-section-sub"
                 type="text" placeholder="Sous-titre (optionnel)"
                 data-bind="section.${section.id}.subtitle"
                 value="${_escape(section.subtitle)}">
        </div>
        <button class="pulsa-icon-btn pulsa-icon-btn-danger"
                data-act="delete-section" data-id="${section.id}"
                title="Supprimer la section">
          ${icon('x', 16)}
        </button>
      </header>

      <div class="pulsa-fields">
        ${section.fields.length === 0 ? `
          <p class="pulsa-fields-empty">Aucun champ dans cette section.</p>
        ` : section.fields.map(f => _renderField(section.id, f)).join('')}
      </div>

      <button class="pulsa-btn pulsa-btn-ghost pulsa-btn-add-field"
              data-act="open-field-menu" data-section="${section.id}">
        ${icon('plus', 16)}<span>Ajouter un champ</span>
      </button>
    </section>
  `;
}

function _renderField(sectionId, field) {
  const def = FIELD_TYPES[field.type] || { label: field.type, ico: 'help-circle' };
  const width = field.width || 'full';
  const widthLabel = width === 'full' ? 'Pleine' : width;
  return `
    <div class="pulsa-field" data-field-id="${field.id}" data-width="${width}">
      <div class="pulsa-field-head">
        <span class="pulsa-field-type">
          ${icon(def.ico, 14)}
          <span>${def.label}</span>
        </span>
        <div class="pulsa-field-actions">
          <button class="pulsa-chip"
                  data-act="cycle-field-width"
                  data-section="${sectionId}" data-field="${field.id}"
                  title="Largeur du champ — cliquer pour cycler">
            ${icon('sliders', 12)}
            <span>${widthLabel}</span>
          </button>
          <button class="pulsa-chip ${field.required ? 'is-on' : ''}"
                  data-act="toggle-required"
                  data-section="${sectionId}" data-field="${field.id}"
                  title="Champ obligatoire">
            ${field.required ? icon('check', 12) : icon('plus', 12)}
            <span>Requis</span>
          </button>
          <button class="pulsa-icon-btn pulsa-icon-btn-danger"
                  data-act="delete-field"
                  data-section="${sectionId}" data-field="${field.id}"
                  title="Supprimer le champ">
            ${icon('x', 14)}
          </button>
        </div>
      </div>
      <input class="pulsa-input pulsa-field-label"
             type="text" placeholder="Question posée au répondant"
             data-bind="field.${sectionId}.${field.id}.label"
             value="${_escape(field.label)}">
    </div>
  `;
}

function _renderFieldTypeMenu() {
  const m = _root?.querySelector('[data-slot="modal"]');
  if (!m) return;
  const groups = FIELD_GROUPS.map(g => {
    const types = Object.entries(FIELD_TYPES).filter(([, def]) => def.group === g.id);
    if (types.length === 0) return '';
    return `
      <div class="pulsa-type-group">
        <h3 class="pulsa-type-group-title">${g.label}</h3>
        <div class="pulsa-type-grid">
          ${types.map(([type, def]) => `
            <button class="pulsa-type-card" data-act="pick-field-type" data-type="${type}">
              <span class="pulsa-type-card-ico">${icon(def.ico, 20)}</span>
              <span class="pulsa-type-card-body">
                <span class="pulsa-type-card-label">${def.label}</span>
                <span class="pulsa-type-card-sub">${def.sub}</span>
              </span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  m.innerHTML = `
    <div class="pulsa-modal-backdrop" data-act="close-modal"></div>
    <div class="pulsa-modal-card">
      <header class="pulsa-modal-head">
        <h2>Ajouter un champ</h2>
        <button class="pulsa-icon-btn" data-act="close-modal" title="Fermer">
          ${icon('x', 16)}
        </button>
      </header>
      <div class="pulsa-modal-body">
        ${groups}
      </div>
    </div>
  `;
  m.hidden = false;
}

function _renderAside() {
  const aside = _root?.querySelector('[data-slot="aside"]');
  if (!aside) return;
  const sections = _state.form.sections;
  const fieldCount = sections.reduce((acc, s) => acc + s.fields.length, 0);
  aside.innerHTML = `
    <div class="pulsa-stats">
      <h3>Aperçu</h3>
      <div class="pulsa-stat">
        <span class="pulsa-stat-num">${sections.length}</span>
        <span class="pulsa-stat-label">${sections.length > 1 ? 'sections' : 'section'}</span>
      </div>
      <div class="pulsa-stat">
        <span class="pulsa-stat-num">${fieldCount}</span>
        <span class="pulsa-stat-label">${fieldCount > 1 ? 'champs' : 'champ'}</span>
      </div>
      <p class="pulsa-stats-hint">La preview live mobile sera disponible dans la prochaine étape (P2A.5).</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Utilitaires
// ═══════════════════════════════════════════════════════════════
function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ═══════════════════════════════════════════════════════════════
// Persistance brouillon (localStorage + vault sync)
// ═══════════════════════════════════════════════════════════════
function _saveDraft({ explicit = false } = {}) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(_state));
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    _lastSavedAt = Date.now();
    _refreshSaveIndicator(explicit);
    // Le rail peut changer (is-done sur étape Structure/Apparence...) à chaque save
    _renderRail();
  } catch {}
}

function _refreshSaveIndicator(pulse = false) {
  const ind = _root?.querySelector('[data-slot="save-indicator"]');
  const lbl = _root?.querySelector('[data-slot="save-label"]');
  if (!ind || !lbl || !_lastSavedAt) return;
  lbl.textContent = pulse ? 'Enregistré' : _saveAgo(_lastSavedAt);
  ind.classList.add('is-visible');
  if (pulse) {
    ind.classList.add('is-pulse');
    setTimeout(() => ind.classList.remove('is-pulse'), 600);
  }
  clearTimeout(_saveIndicatorTimer);
  _saveIndicatorTimer = setTimeout(() => _refreshSaveIndicator(false), 5000);
}

function _saveAgo(ts) {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `Enregistré il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `Enregistré il y a ${min} min`;
  return 'Enregistré';
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.form && parsed?.ui) _state = parsed;
    }
  } catch {}
}
