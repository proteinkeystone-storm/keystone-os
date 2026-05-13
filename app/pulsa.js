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
import {
  newFormId,
  listForms,
  getForm,
  saveForm,
  deleteForm,
  duplicateForm,
  migrateLegacyDraft,
  getCurrentFormId,
  setCurrentFormId,
} from './lib/pulsa-library.js';

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

// ── État global ───────────────────────────────────────────────
let _state = _initState();
let _root  = null;
let _currentStepId = 'structure';
let _fieldTypeMenu = null; // { sectionId } quand ouvert
let _lastSavedAt = null;
let _saveIndicatorTimer = null;

function _initState() {
  return {
    // Mode d'affichage : 'library' (liste des formulaires) ou 'builder'
    view: 'library',
    // Formulaire actuellement en édition (null en mode library)
    form: null,
    ui: {
      selected_section_id: null,
      // { sectionId, fieldId } quand un champ est en cours d'édition → aside contextuel
      selected_field: null,
    },
  };
}

function _selectedField() {
  const sel = _state.ui.selected_field;
  if (!sel) return null;
  const sec = _state.form.sections.find(s => s.id === sel.sectionId);
  const fld = sec?.fields.find(f => f.id === sel.fieldId);
  if (!sec || !fld) return null;
  return { section: sec, field: fld };
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
  _initFromStorage();
  _buildShell();
  _renderMain();
  _renderRail();
}

export function closePulsa() {
  if (!_root) return;
  if (_state.view === 'builder') _saveDraft();
  _root.remove();
  _root = null;
  _fieldTypeMenu = null;
}

/**
 * Initialise l'état au démarrage :
 *   1. Migre un éventuel ancien brouillon `ks_pulsa_draft` vers la library
 *   2. Charge le dernier formulaire édité s'il existe → mode builder
 *   3. Sinon → mode library (liste)
 */
function _initFromStorage() {
  _state = _initState();

  // 1. Migration ancien draft (format { form, ui } sans library)
  const migratedId = migrateLegacyDraft();

  // 2. Reprise du dernier formulaire édité
  const lastId = migratedId || getCurrentFormId();
  if (lastId) {
    const form = getForm(lastId);
    if (form) {
      _state.view = 'builder';
      _state.form = form;
      return;
    }
  }

  // 3. Par défaut : vue library
  _state.view = 'library';
  _state.form = null;
}

// ═══════════════════════════════════════════════════════════════
// Shell
// ═══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app pulsa-app';
  _root.innerHTML = `
    <header class="ws-topbar" data-slot="topbar">
      <button class="ws-topbar-back" data-slot="back-btn" data-act="close">
        ${icon('arrow-left', 16)}
        <span data-slot="back-label">Retour</span>
      </button>
      <div class="ws-topbar-title">
        <span class="name">${WORKSPACE_META.name}</span>
        <span class="sep" data-slot="topbar-sep">·</span>
        <span class="crumb" data-slot="crumb"></span>
      </div>
      <div class="ws-topbar-actions">
        <span class="pulsa-save-indicator" data-slot="save-indicator" aria-live="polite">
          ${icon('check', 12)}<span data-slot="save-label">Enregistré</span>
        </span>
        <button class="ws-iconbtn" data-slot="save-btn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="close" title="Fermer Pulsa">
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
  _refreshTopbar();
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

  if (act === 'close')             return closePulsa();
  if (act === 'goto')              return _navigate(t.dataset.step);
  if (act === 'next-step')         return _navigateRelative(+1);
  if (act === 'prev-step')         return _navigateRelative(-1);
  if (act === 'publish-form')      return _publishForm();
  if (act === 'save')              { _saveDraft({ explicit: true }); return; }

  // Vue Bibliothèque
  if (act === 'new-form')          return _newForm();
  if (act === 'open-form')         return _openForm(t.dataset.id);
  if (act === 'duplicate-form')    return _duplicateForm(t.dataset.id);
  if (act === 'delete-form')       return _deleteForm(t.dataset.id);
  if (act === 'back-to-library')   return _backToLibrary();

  // Structure — sections
  if (act === 'add-section')     return _addSection();
  if (act === 'delete-section')  return _deleteSection(t.dataset.id);

  // Structure — champs
  if (act === 'open-field-menu')  return _openFieldTypeMenu(t.dataset.section);
  if (act === 'close-modal')      return _closeModal();
  if (act === 'pick-field-type')  return _addField(_fieldTypeMenu?.sectionId, t.dataset.type);
  if (act === 'select-field')     return _selectField(t.dataset.section, t.dataset.field);
  if (act === 'deselect-field')   return _deselectField();
  if (act === 'delete-field')     return _deleteField(t.dataset.section, t.dataset.field);
  if (act === 'toggle-required')  return _toggleRequired(t.dataset.section, t.dataset.field);
  if (act === 'cycle-field-width') return _cycleFieldWidth(t.dataset.section, t.dataset.field);

  // Édition des options spécifiques d'un champ sélectionné
  if (act === 'add-choice')       return _addChoice(t.dataset.field);
  if (act === 'delete-choice')    return _deleteChoice(t.dataset.field, t.dataset.choice);
  if (act === 'preset-max-chars') return _setMaxChars(t.dataset.field, parseInt(t.dataset.value, 10));
  if (act === 'set-currency')     return _setCurrency(t.dataset.field, t.dataset.value);
  if (act === 'toggle-network')   return _toggleNetwork(t.dataset.field, t.dataset.network);

  // Étapes Apparence / Livraison
  if (act === 'set-brand-preset') return _setBrandPreset(t.dataset.color, t.dataset.accent);
  if (act === 'set-ttl')          return _setTTL(parseInt(t.dataset.value, 10));
  if (act === 'add-recipient')    return _addRecipient();
  if (act === 'delete-recipient') return _deleteRecipient(t.dataset.email);
  if (act === 'auto-slug')        return _autoSlug();
  if (act === 'remove-logo')      return _removeLogo();
}

function _onInput(e) {
  // Cas spécial : upload de fichier pour le logo
  if (e.target.type === 'file' && e.target.dataset?.slot === 'logo-upload') {
    const file = e.target.files?.[0];
    if (file) _uploadLogo(file);
    return;
  }
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
 * Format générique avec chemins profonds :
 *   form.meta.title
 *   form.delivery.notification_subject
 *   section.<id>.title
 *   field.<sectionId>.<fieldId>.label
 *   field.<sectionId>.<fieldId>.options.placeholder
 *   field.<sectionId>.<fieldId>.options.max_chars
 *   choice.<sectionId>.<fieldId>.<choiceId>.label
 *   network.<sectionId>.<fieldId>.<networkId>.placeholder
 */
function _applyBinding(input) {
  const path = input.dataset.bind;
  const raw = input.type === 'checkbox' ? input.checked : input.value;
  const value = input.type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
  const parts = path.split('.');

  if (parts[0] === 'form') {
    return _setDeep(_state.form, parts.slice(1), value);
  }
  if (parts[0] === 'section') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    if (sec) _setDeep(sec, parts.slice(2), value);
    return;
  }
  if (parts[0] === 'field') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    const fld = sec?.fields.find(f => f.id === parts[2]);
    if (fld) _setDeep(fld, parts.slice(3), value);
    return;
  }
  if (parts[0] === 'choice') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    const fld = sec?.fields.find(f => f.id === parts[2]);
    const ch  = fld?.options?.choices?.find(c => c.id === parts[3]);
    if (ch) _setDeep(ch, parts.slice(4), value);
    return;
  }
  if (parts[0] === 'network') {
    const sec = _state.form.sections.find(s => s.id === parts[1]);
    const fld = sec?.fields.find(f => f.id === parts[2]);
    const net = fld?.options?.networks?.find(n => n.id === parts[3]);
    if (net) _setDeep(net, parts.slice(4), value);
  }
}

function _setDeep(obj, parts, value) {
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
}

// ═══════════════════════════════════════════════════════════════
// Topbar contextuelle (library / builder)
// ═══════════════════════════════════════════════════════════════
function _refreshTopbar() {
  if (!_root) return;
  const back = _root.querySelector('[data-slot="back-btn"]');
  const backLbl = _root.querySelector('[data-slot="back-label"]');
  const sep = _root.querySelector('[data-slot="topbar-sep"]');
  const crumb = _root.querySelector('[data-slot="crumb"]');
  const saveBtn = _root.querySelector('[data-slot="save-btn"]');
  const saveInd = _root.querySelector('[data-slot="save-indicator"]');

  if (_state.view === 'library') {
    if (back) back.dataset.act = 'close';
    if (backLbl) backLbl.textContent = 'Retour';
    if (sep) sep.style.display = 'none';
    if (crumb) crumb.textContent = 'Mes formulaires';
    if (saveBtn) saveBtn.style.display = 'none';
    if (saveInd) saveInd.style.display = 'none';
  } else {
    if (back) back.dataset.act = 'back-to-library';
    if (backLbl) backLbl.textContent = 'Mes formulaires';
    if (sep) sep.style.display = '';
    if (crumb) crumb.textContent = _currentStep().label;
    if (saveBtn) saveBtn.style.display = '';
    if (saveInd) saveInd.style.display = '';
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue Bibliothèque — actions
// ═══════════════════════════════════════════════════════════════
function _newForm() {
  const form = saveForm({ ...newForm(), id: newFormId() });
  setCurrentFormId(form.id);
  _state.view = 'builder';
  _state.form = form;
  _state.ui.selected_field = null;
  _currentStepId = 'structure';
  _refreshTopbar();
  _renderMain();
  _renderRail();
}

function _openForm(id) {
  const form = getForm(id);
  if (!form) return;
  setCurrentFormId(id);
  _state.view = 'builder';
  _state.form = form;
  _state.ui.selected_field = null;
  _currentStepId = 'structure';
  _refreshTopbar();
  _renderMain();
  _renderRail();
}

function _duplicateForm(id) {
  const copy = duplicateForm(id);
  if (!copy) return;
  _openForm(copy.id);
}

function _deleteForm(id) {
  const form = getForm(id);
  if (!form) return;
  const title = form.meta?.title?.trim() || 'ce formulaire';
  if (!confirm(`Supprimer définitivement « ${title} » ? Cette action est irréversible.`)) return;
  deleteForm(id);
  if (getCurrentFormId() === id) setCurrentFormId(null);
  _renderMain();
}

function _backToLibrary() {
  if (_state.form) _saveDraft();
  setCurrentFormId(null);
  _state.view = 'library';
  _state.form = null;
  _state.ui.selected_field = null;
  _refreshTopbar();
  _renderMain();
  _renderRail();
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
  const f = _state.form;
  const fieldCount = f.sections.reduce((acc, s) => acc + s.fields.length, 0);
  const missing = [];
  if (!f.meta.title?.trim())            missing.push('titre');
  if (!f.meta.slug?.trim())             missing.push('slug');
  if ((f.delivery.recipients || []).length === 0) missing.push('destinataire mail');
  if (fieldCount === 0)                 missing.push('au moins un champ');
  if (missing.length > 0) {
    alert(`Avant de publier, complétez : ${missing.join(', ')}.`);
    return;
  }
  alert(`Formulaire prêt à être publié à keystone.app/f/${f.meta.slug}.\n\nLa publication réelle (route Worker + collecte D1 + mail Resend) sera activée en Phase 3.`);
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

// ── Sélection d'un champ pour édition contextuelle dans l'aside ─
function _selectField(sectionId, fieldId) {
  // Idempotence : si déjà sélectionné, ne pas re-render (préserve focus input)
  const cur = _state.ui.selected_field;
  if (cur?.sectionId === sectionId && cur?.fieldId === fieldId) return;
  _state.ui.selected_field = { sectionId, fieldId };
  _renderMain();
  _renderAside();
}

function _deselectField() {
  _state.ui.selected_field = null;
  _renderMain();
  _renderAside();
}

// ── Édition options : choices (chips, cards) ─────────────────
function _addChoice(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const { field } = found;
  if (!field.options.choices) field.options.choices = [];
  const idx = field.options.choices.length + 1;
  const baseChoice = field.type === 'cards'
    ? { id: 'c' + idx, label: 'Choix ' + idx, ico: 'sparkles', desc: '' }
    : { id: 'c' + idx, label: 'Option ' + idx };
  // Garantir un id unique simple
  while (field.options.choices.some(c => c.id === baseChoice.id)) {
    baseChoice.id += '_' + Math.random().toString(36).slice(2, 4);
  }
  field.options.choices.push(baseChoice);
  _renderAside();
  _saveDraft();
}

function _deleteChoice(fieldId, choiceId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  found.field.options.choices = (found.field.options.choices || []).filter(c => c.id !== choiceId);
  _renderAside();
  _saveDraft();
}

// ── Édition options : presets max_chars (text-long) ──────────
function _setMaxChars(fieldId, value) {
  const found = _findFieldById(fieldId);
  if (!found || isNaN(value)) return;
  found.field.options.max_chars = value;
  _renderAside();
  _saveDraft();
}

// ── Édition options : currency (amount) ──────────────────────
function _setCurrency(fieldId, currency) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  found.field.options.currency = currency;
  _renderAside();
  _saveDraft();
}

// ── Édition options : toggle réseau actif (social-links) ─────
function _toggleNetwork(fieldId, networkId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const net = (found.field.options.networks || []).find(n => n.id === networkId);
  if (net) net.enabled = !net.enabled;
  _renderAside();
  _saveDraft();
}

function _findFieldById(fieldId) {
  for (const sec of _state.form.sections) {
    const fld = sec.fields.find(f => f.id === fieldId);
    if (fld) return { section: sec, field: fld };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Actions Apparence / Livraison
// ═══════════════════════════════════════════════════════════════
function _setBrandPreset(color, accent) {
  _state.form.meta.brand_color = color;
  _state.form.meta.brand_accent = accent;
  _renderMain();
  _saveDraft();
}

function _setTTL(days) {
  if (!days || isNaN(days)) return;
  _state.form.meta.ttl_days = days;
  _renderMain();
  _saveDraft();
}

function _autoSlug() {
  const title = _state.form.meta.title?.trim();
  if (!title) return;
  _state.form.meta.slug = _slugify(title);
  _renderMain();
  _saveDraft();
}

function _slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retirer accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function _addRecipient() {
  const input = _root?.querySelector('[data-slot="new-recipient"]');
  if (!input) return;
  const email = input.value.trim();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('Adresse email invalide.');
    return;
  }
  const list = _state.form.delivery.recipients ||= [];
  if (list.includes(email)) {
    alert('Ce destinataire est déjà dans la liste.');
    return;
  }
  if (list.length >= 3) {
    alert('Maximum 3 destinataires direction par formulaire (Phase 1). La V2 permettra des listes plus longues.');
    return;
  }
  list.push(email);
  input.value = '';
  _renderMain();
  _saveDraft();
}

function _deleteRecipient(email) {
  _state.form.delivery.recipients = (_state.form.delivery.recipients || []).filter(e => e !== email);
  _renderMain();
  _saveDraft();
}

// ── Upload de logo (base64 inline) ──────────────────────────
const LOGO_MAX_BYTES = 500 * 1024; // 500 ko
const LOGO_MIME_WHITELIST = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];

function _uploadLogo(file) {
  if (!LOGO_MIME_WHITELIST.includes(file.type)) {
    alert('Format non supporté. Utilisez PNG, JPG, SVG, WebP ou GIF.');
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    const kb = Math.round(file.size / 1024);
    alert(`Logo trop volumineux (${kb} ko). Maximum 500 ko. Redimensionnez votre image avant de la téléverser.`);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _state.form.meta.logo_data_url = reader.result; // data URI complète
    _renderMain();
    _saveDraft({ explicit: true });
  };
  reader.onerror = () => alert('Échec de la lecture du fichier. Réessayez.');
  reader.readAsDataURL(file);
}

function _removeLogo() {
  _state.form.meta.logo_data_url = null;
  _renderMain();
  _saveDraft();
}

// ═══════════════════════════════════════════════════════════════
// Rendu
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root?.querySelector('[data-slot="rail"]');
  if (!rail) return;
  // En mode library, le rail est masqué via CSS — on peut le vider
  if (_state.view !== 'builder') {
    rail.innerHTML = '';
    return;
  }
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

  // Vue Bibliothèque : on rend la liste et on stop là (rail + aside masqués via CSS)
  if (_state.view === 'library') {
    _root.classList.add('is-library');
    _renderLibrary(main);
    _renderAside(); // aside vide
    return;
  }

  _root.classList.remove('is-library');
  switch (_currentStepId) {
    case 'structure':  _renderStructure(main); break;
    case 'appearance': _renderAppearance(main); break;
    case 'delivery':   _renderDelivery(main); break;
    case 'publish':    _renderPublish(main); break;
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

// ═══════════════════════════════════════════════════════════════
// Vue Bibliothèque — rendu
// ═══════════════════════════════════════════════════════════════
function _renderLibrary(main) {
  const forms = listForms();

  if (forms.length === 0) {
    main.innerHTML = `
      <div class="pulsa-lib-empty">
        ${icon('sparkles', 48)}
        <h1>Bienvenue dans Pulsa</h1>
        <p>Créez vos formulaires intelligents : diagnostics, questionnaires, onboarding, candidatures. Partage par URL, notification mail, RGPD natif.</p>
        <button class="pulsa-btn pulsa-btn-primary pulsa-btn-publish" data-act="new-form">
          ${icon('plus', 16)}<span>Créer mon premier formulaire</span>
        </button>
      </div>
    `;
    return;
  }

  main.innerHTML = `
    <div class="pulsa-lib-head">
      <div>
        <h1 class="ws-step-title">Vos formulaires</h1>
        <p class="ws-step-sub">${forms.length} ${forms.length > 1 ? 'formulaires sauvegardés' : 'formulaire sauvegardé'} — auto-sauvegarde continue.</p>
      </div>
      <button class="pulsa-btn pulsa-btn-primary" data-act="new-form">
        ${icon('plus', 16)}<span>Nouveau formulaire</span>
      </button>
    </div>
    <div class="pulsa-lib-grid">
      ${forms.map(f => _renderLibraryCard(f)).join('')}
    </div>
  `;
}

function _renderLibraryCard(form) {
  const meta = form.meta || {};
  const sections = form.sections || [];
  const delivery = form.delivery || {};
  const fieldCount = sections.reduce((acc, s) => acc + (s.fields?.length || 0), 0);
  const recipients = (delivery.recipients || []).length;
  const status = form.output?.status === 'published' ? 'Publié' : 'Brouillon';
  const isPublished = form.output?.status === 'published';
  const updated = _formatUpdatedAt(form.updated_at);
  const logo = meta.logo_data_url || meta.logo_url || null;
  const title = meta.title?.trim() || 'Formulaire sans titre';

  return `
    <article class="pulsa-lib-card" data-act="open-form" data-id="${form.id}">
      <header class="pulsa-lib-card-head">
        <div class="pulsa-lib-card-logo">
          ${logo
            ? `<img src="${_escape(logo)}" alt="" onerror="this.parentElement.classList.add('is-fallback');this.style.display='none'">`
            : ''}
          <span class="pulsa-lib-card-logo-fallback">${icon('check-square', 22)}</span>
        </div>
        <span class="pulsa-lib-status ${isPublished ? 'is-published' : ''}">${status}</span>
      </header>
      <h3 class="pulsa-lib-card-title">${_escape(title)}</h3>
      ${meta.slug ? `<p class="pulsa-lib-card-slug">keystone.app/f/${_escape(meta.slug)}</p>` : '<p class="pulsa-lib-card-slug pulsa-lib-card-slug-empty">URL non définie</p>'}
      <div class="pulsa-lib-card-meta">
        <span title="Sections">${icon('sliders', 12)} ${sections.length}</span>
        <span title="Champs">${icon('edit', 12)} ${fieldCount}</span>
        <span title="Destinataires">${icon('check', 12)} ${recipients}</span>
        <span title="TTL">${icon('history', 12)} ${meta.ttl_days ?? 90}j</span>
      </div>
      <footer class="pulsa-lib-card-footer">
        <span class="pulsa-lib-card-date">${updated}</span>
        <div class="pulsa-lib-card-actions" data-stop-propagation>
          <button class="pulsa-icon-btn" data-act="duplicate-form" data-id="${form.id}" title="Dupliquer">
            ${icon('copy', 14)}
          </button>
          <button class="pulsa-icon-btn pulsa-icon-btn-danger" data-act="delete-form" data-id="${form.id}" title="Supprimer">
            ${icon('x', 14)}
          </button>
        </div>
      </footer>
    </article>
  `;
}

function _formatUpdatedAt(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
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

// ═══════════════════════════════════════════════════════════════
// Étape Apparence
// ═══════════════════════════════════════════════════════════════
function _renderAppearance(main) {
  const m = _state.form.meta;
  const presets = [
    { name: 'Navy & Or',     color: '#0a2741', accent: '#c9b48a' },
    { name: 'Indigo Pulsa',  color: '#131826', accent: '#6366f1' },
    { name: 'Forêt',         color: '#0f3a2d', accent: '#86c6a4' },
    { name: 'Bordeaux',      color: '#3a0f1f', accent: '#e0a8b6' },
    { name: 'Graphite & Or', color: '#1a1a1a', accent: '#d4a574' },
    { name: 'Blanc & Noir',  color: '#1a1a1a', accent: '#ffffff' },
  ];

  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">Apparence du formulaire</h1>
      <p class="ws-step-sub">Personnalisez l'identité visuelle perçue par les répondants.</p>
    </div>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">Identité</h3>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Titre du formulaire</span>
        <input class="pulsa-input" type="text"
               placeholder="Ex : Diagnostic opérationnel Prométhée"
               data-bind="form.meta.title"
               value="${_escape(m.title)}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte d'introduction (affiché en tête)</span>
        <textarea class="pulsa-input" rows="3"
                  placeholder="Quelques mots pour expliquer le contexte aux répondants"
                  data-bind="form.meta.intro">${_escape(m.intro)}</textarea>
      </label>
      <div class="pulsa-logo-block">
        <span class="pulsa-fld-label">Logo du formulaire</span>
        ${m.logo_data_url ? `
          <div class="pulsa-logo-preview">
            <img src="${_escape(m.logo_data_url)}" alt="Logo téléversé">
            <button class="pulsa-icon-btn pulsa-icon-btn-danger pulsa-logo-remove"
                    data-act="remove-logo" title="Retirer ce logo">
              ${icon('x', 14)}
            </button>
          </div>
        ` : (m.logo_url ? `
          <div class="pulsa-logo-preview pulsa-logo-preview-url">
            <img src="${_escape(m.logo_url)}" alt="Logo (URL externe)"
                 onerror="this.style.display='none'">
            <span class="pulsa-logo-url-hint">URL externe — ${_escape(m.logo_url)}</span>
          </div>
        ` : '')}
        <div class="pulsa-logo-actions">
          <label class="pulsa-btn pulsa-btn-ghost pulsa-logo-upload">
            ${icon('upload-cloud', 14)}<span>${m.logo_data_url ? 'Remplacer le logo' : 'Téléverser un logo'}</span>
            <input type="file" data-slot="logo-upload"
                   accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                   hidden>
          </label>
          <span class="pulsa-logo-or">ou</span>
          <input class="pulsa-input pulsa-logo-url-input" type="url"
                 placeholder="https://votre-site.com/logo.png"
                 data-bind="form.meta.logo_url"
                 value="${_escape(m.logo_url || '')}">
        </div>
        <p class="pulsa-logo-meta">PNG · JPG · SVG · WebP · GIF — max 500 ko. Le logo apparaît en tête du formulaire public.</p>
      </div>
      <label class="pulsa-toggle">
        <input type="checkbox"
               data-bind="form.meta.anonymous"
               ${m.anonymous ? 'checked' : ''}>
        <span class="pulsa-toggle-track"></span>
        <span class="pulsa-toggle-body">
          <span class="pulsa-toggle-label">Réponses anonymes</span>
          <span class="pulsa-toggle-sub">Si désactivé, les répondants devront indiquer leur identité au début</span>
        </span>
      </label>
    </section>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">Palette</h3>
      <p class="pulsa-block-hint">Sélectionnez une palette prédéfinie ou affinez à la main.</p>
      <div class="pulsa-palette-grid">
        ${presets.map(p => {
          const active = m.brand_color === p.color && m.brand_accent === p.accent;
          return `
            <button class="pulsa-palette-card ${active ? 'is-on' : ''}"
                    data-act="set-brand-preset"
                    data-color="${p.color}" data-accent="${p.accent}"
                    title="${p.name}">
              <span class="pulsa-palette-swatches">
                <span style="background:${p.color}"></span>
                <span style="background:${p.accent}"></span>
              </span>
              <span class="pulsa-palette-name">${p.name}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="pulsa-color-grid">
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Couleur principale (fond / header)</span>
          <span class="pulsa-color-row">
            <input type="color"
                   data-bind="form.meta.brand_color"
                   value="${_escape(m.brand_color)}">
            <input class="pulsa-input" type="text"
                   data-bind="form.meta.brand_color"
                   value="${_escape(m.brand_color)}">
          </span>
        </label>
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Couleur d'accent (boutons / liens)</span>
          <span class="pulsa-color-row">
            <input type="color"
                   data-bind="form.meta.brand_accent"
                   value="${_escape(m.brand_accent)}">
            <input class="pulsa-input" type="text"
                   data-bind="form.meta.brand_accent"
                   value="${_escape(m.brand_accent)}">
          </span>
        </label>
      </div>
    </section>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Étape Livraison
// ═══════════════════════════════════════════════════════════════
function _renderDelivery(main) {
  const m = _state.form.meta;
  const d = _state.form.delivery;
  const ttlPresets = [30, 90, 180, 365];
  const currentTtl = m.ttl_days ?? 90;

  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">Livraison du formulaire</h1>
      <p class="ws-step-sub">URL publique, destinataires direction et durée de conservation des réponses.</p>
    </div>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">URL publique</h3>
      <p class="pulsa-block-hint">L'URL que vous partagerez avec vos répondants.</p>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Identifiant court (slug)</span>
        <div class="pulsa-slug-row">
          <span class="pulsa-slug-prefix">keystone.app/f/</span>
          <input class="pulsa-input pulsa-slug-input" type="text"
                 placeholder="biennale-art-2026"
                 data-bind="form.meta.slug"
                 value="${_escape(m.slug || '')}">
          <button class="pulsa-btn pulsa-btn-ghost pulsa-slug-auto"
                  data-act="auto-slug"
                  title="Générer depuis le titre du formulaire">
            ${icon('sparkles', 14)}<span>Auto</span>
          </button>
        </div>
      </label>
    </section>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">Notification mail</h3>
      <p class="pulsa-block-hint">Chaque nouvelle réponse est envoyée à ces adresses. Le mail = votre backup permanent même si la TTL purge la donnée serveur.</p>
      <div class="pulsa-recipients">
        ${(d.recipients || []).length === 0 ? `
          <p class="pulsa-recipients-empty">Aucun destinataire pour l'instant.</p>
        ` : d.recipients.map(email => `
          <div class="pulsa-recipient">
            <span class="pulsa-recipient-email">${icon('edit', 12)} ${_escape(email)}</span>
            <button class="pulsa-icon-btn pulsa-icon-btn-danger"
                    data-act="delete-recipient" data-email="${_escape(email)}"
                    title="Retirer">
              ${icon('x', 12)}
            </button>
          </div>
        `).join('')}
      </div>
      <div class="pulsa-recipient-add">
        <input class="pulsa-input" type="email"
               placeholder="prenom.nom@entreprise.fr"
               data-slot="new-recipient">
        <button class="pulsa-btn pulsa-btn-ghost" data-act="add-recipient">
          ${icon('plus', 14)}<span>Ajouter ce destinataire</span>
        </button>
      </div>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Objet du mail de notification</span>
        <input class="pulsa-input" type="text"
               placeholder="Nouvelle réponse — ${_escape(m.title || 'Pulsa')}"
               data-bind="form.delivery.notification_subject"
               value="${_escape(d.notification_subject || '')}">
      </label>
    </section>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">Durée de conservation (TTL)</h3>
      <p class="pulsa-block-hint">Les réponses stockées sont automatiquement supprimées au bout de ce délai. Conformité RGPD Art. 5 (minimisation) par design. Le mail de notification reste, lui, indéfiniment dans la boîte du destinataire.</p>
      <div class="pulsa-ttl-row">
        ${ttlPresets.map(d => `
          <button class="pulsa-chip ${currentTtl === d ? 'is-on' : ''}"
                  data-act="set-ttl" data-value="${d}">
            ${d} jours
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Étape Publication
// ═══════════════════════════════════════════════════════════════
function _renderPublish(main) {
  const f = _state.form;
  const sections = f.sections;
  const fieldCount = sections.reduce((acc, s) => acc + s.fields.length, 0);
  const warnings = [];
  if (!f.meta.title?.trim())               warnings.push('Le formulaire n\'a pas de titre (étape Apparence).');
  if (!f.meta.slug?.trim())                warnings.push('Aucun slug défini pour l\'URL publique (étape Livraison).');
  if ((f.delivery.recipients || []).length === 0) warnings.push('Aucun destinataire de notification mail (étape Livraison).');
  if (sections.length === 0)               warnings.push('Aucune section dans le formulaire (étape Structure).');
  if (fieldCount === 0)                    warnings.push('Aucun champ dans le formulaire (étape Structure).');
  const ready = warnings.length === 0;

  main.innerHTML = `
    <div class="ws-step-header">
      <h1 class="ws-step-title">Prêt à publier ?</h1>
      <p class="ws-step-sub">Vérifiez le récapitulatif et publiez votre formulaire.</p>
    </div>

    <section class="pulsa-recap">
      <h3 class="pulsa-block-title">Récapitulatif</h3>
      <div class="pulsa-recap-grid">
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">Titre</span>
          <span class="pulsa-recap-value">${_escape(f.meta.title) || '<em>non défini</em>'}</span>
        </div>
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">URL publique</span>
          <span class="pulsa-recap-value">${f.meta.slug ? `keystone.app/f/${_escape(f.meta.slug)}` : '<em>slug manquant</em>'}</span>
        </div>
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">Sections</span>
          <span class="pulsa-recap-value">${sections.length}</span>
        </div>
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">Champs</span>
          <span class="pulsa-recap-value">${fieldCount}</span>
        </div>
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">Destinataires</span>
          <span class="pulsa-recap-value">${(f.delivery.recipients || []).length}</span>
        </div>
        <div class="pulsa-recap-cell">
          <span class="pulsa-recap-label">TTL</span>
          <span class="pulsa-recap-value">${f.meta.ttl_days ?? 90} jours</span>
        </div>
      </div>
    </section>

    ${warnings.length > 0 ? `
      <section class="pulsa-block pulsa-warnings">
        <h3 class="pulsa-block-title">${warnings.length} ${warnings.length > 1 ? 'éléments manquants' : 'élément manquant'} avant publication</h3>
        <ul class="pulsa-warning-list">
          ${warnings.map(w => `<li>${_escape(w)}</li>`).join('')}
        </ul>
      </section>
    ` : `
      <section class="pulsa-block pulsa-ready">
        <h3 class="pulsa-block-title">${icon('check', 16)} Tout est en place</h3>
        <p>Votre formulaire est prêt à être publié à l'URL <strong>keystone.app/f/${_escape(f.meta.slug)}</strong>. Une fois publié, vous pourrez le partager avec vos répondants et recevoir les réponses par mail.</p>
      </section>
    `}

    <div class="pulsa-publish-cta">
      <button class="pulsa-btn pulsa-btn-primary pulsa-btn-publish ${ready ? '' : 'is-disabled'}"
              data-act="publish-form"
              ${ready ? '' : 'aria-disabled="true"'}>
        ${icon('sparkles', 16)}<span>Publier le formulaire</span>
      </button>
      <p class="pulsa-publish-note">La publication réelle (route Worker + collecte D1 + mail Resend) sera activée en Phase 3.</p>
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
  const isSelected = _state.ui.selected_field?.fieldId === field.id;
  return `
    <div class="pulsa-field ${isSelected ? 'is-selected' : ''}"
         data-field-id="${field.id}" data-width="${width}"
         data-act="select-field"
         data-section="${sectionId}" data-field="${field.id}">
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
      ${isSelected ? '<div class="pulsa-field-hint">Édition des options dans le panneau de droite →</div>' : ''}
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
  if (_state.view !== 'builder' || !_state.form) {
    aside.innerHTML = '';
    return;
  }
  const selected = _selectedField();
  if (selected) {
    aside.innerHTML = _renderFieldEditor(selected.section, selected.field);
    return;
  }
  // Sinon : stats globales du formulaire
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
      <p class="pulsa-stats-hint">Cliquez sur un champ pour éditer ses options spécifiques.</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Éditeur contextuel d'un champ sélectionné (aside)
// ═══════════════════════════════════════════════════════════════
function _renderFieldEditor(section, field) {
  const def = FIELD_TYPES[field.type] || { label: field.type, ico: 'help-circle' };
  const fid = field.id;
  const sid = section.id;

  return `
    <div class="pulsa-editor">
      <header class="pulsa-editor-head">
        <button class="pulsa-icon-btn" data-act="deselect-field" title="Retour aux stats">
          ${icon('arrow-left', 14)}
        </button>
        <div class="pulsa-editor-title">
          <span class="pulsa-editor-type">${icon(def.ico, 14)} ${def.label}</span>
          <h3>Options du champ</h3>
        </div>
      </header>

      <div class="pulsa-editor-body">
        ${_editorCommonBlock(sid, field)}
        ${_editorOptionsBlock(sid, field)}
      </div>
    </div>
  `;
}

/**
 * Bloc commun à tous les types : label (visible aussi dans le main),
 * texte d'aide, requis, largeur.
 */
function _editorCommonBlock(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Général</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Libellé de la question</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.label"
               value="${_escape(field.label)}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte d'aide (optionnel)</span>
        <input class="pulsa-input" type="text"
               placeholder="Information complémentaire affichée sous la question"
               data-bind="field.${sid}.${field.id}.help"
               value="${_escape(field.help || '')}">
      </label>
    </section>
  `;
}

/**
 * Dispatcher : retourne le bloc d'options spécifiques au type.
 */
function _editorOptionsBlock(sid, field) {
  switch (field.type) {
    case 'text-short':   return _editorTextShort(sid, field);
    case 'text-long':    return _editorTextLong(sid, field);
    case 'email':        return _editorPlaceholder(sid, field, 'prenom.nom@exemple.fr');
    case 'website':      return _editorPlaceholder(sid, field, 'https://votre-site.com');
    case 'url-external': return _editorUrlExternal(sid, field);
    case 'chips':        return _editorChoices(sid, field, 'chips');
    case 'cards':        return _editorChoices(sid, field, 'cards');
    case 'yes-no':       return _editorYesNo(sid, field);
    case 'rank-top3':    return _editorRank(sid, field);
    case 'date':         return _editorDate(sid, field);
    case 'amount':       return _editorAmount(sid, field);
    case 'social-links': return _editorSocialLinks(sid, field);
    default:             return '';
  }
}

function _editorTextShort(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte de remplacement (placeholder)</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.placeholder"
               value="${_escape(field.options?.placeholder || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Nombre max de caractères</span>
        <input class="pulsa-input" type="number" min="1" max="2000"
               data-bind="field.${sid}.${field.id}.options.max_chars"
               value="${field.options?.max_chars ?? ''}">
      </label>
    </section>
  `;
}

function _editorTextLong(sid, field) {
  const presets = [300, 500, 1500];
  const max = field.options?.max_chars ?? 500;
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte de remplacement</span>
        <textarea class="pulsa-input" rows="2"
                  data-bind="field.${sid}.${field.id}.options.placeholder">${_escape(field.options?.placeholder || '')}</textarea>
      </label>
      <div class="pulsa-fld">
        <span class="pulsa-fld-label">Limite stricte de signes</span>
        <div class="pulsa-preset-row">
          ${presets.map(p => `
            <button class="pulsa-chip ${max === p ? 'is-on' : ''}"
                    data-act="preset-max-chars"
                    data-field="${field.id}" data-value="${p}">
              ${p}
            </button>
          `).join('')}
          <input class="pulsa-input pulsa-preset-custom" type="number" min="50" max="5000"
                 placeholder="Autre…"
                 data-bind="field.${sid}.${field.id}.options.max_chars"
                 value="${presets.includes(max) ? '' : max}">
        </div>
      </div>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Lignes affichées</span>
        <input class="pulsa-input" type="number" min="1" max="20"
               data-bind="field.${sid}.${field.id}.options.rows"
               value="${field.options?.rows ?? 4}">
      </label>
    </section>
  `;
}

function _editorPlaceholder(sid, field, defaultHint) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte de remplacement</span>
        <input class="pulsa-input" type="text"
               placeholder="${_escape(defaultHint)}"
               data-bind="field.${sid}.${field.id}.options.placeholder"
               value="${_escape(field.options?.placeholder || '')}">
      </label>
    </section>
  `;
}

function _editorUrlExternal(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte de remplacement</span>
        <input class="pulsa-input" type="text"
               placeholder="https://wetransfer.com/…"
               data-bind="field.${sid}.${field.id}.options.placeholder"
               value="${_escape(field.options?.placeholder || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Astuce fournisseurs (affichée sous le champ)</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.providers_hint"
               value="${_escape(field.options?.providers_hint || '')}">
      </label>
    </section>
  `;
}

function _editorChoices(sid, field, kind) {
  const choices = field.options?.choices || [];
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Choix proposés</h4>
      <div class="pulsa-choices">
        ${choices.map(c => `
          <div class="pulsa-choice">
            <input class="pulsa-input" type="text"
                   placeholder="Libellé du choix"
                   data-bind="choice.${sid}.${field.id}.${c.id}.label"
                   value="${_escape(c.label)}">
            ${kind === 'cards' ? `
              <input class="pulsa-input pulsa-choice-desc" type="text"
                     placeholder="Description courte (optionnelle)"
                     data-bind="choice.${sid}.${field.id}.${c.id}.desc"
                     value="${_escape(c.desc || '')}">
            ` : ''}
            <button class="pulsa-icon-btn pulsa-icon-btn-danger"
                    data-act="delete-choice"
                    data-field="${field.id}" data-choice="${c.id}"
                    title="Supprimer">
              ${icon('x', 12)}
            </button>
          </div>
        `).join('')}
      </div>
      <button class="pulsa-btn pulsa-btn-ghost pulsa-choice-add"
              data-act="add-choice" data-field="${field.id}">
        ${icon('plus', 14)}<span>Ajouter un choix</span>
      </button>
    </section>
  `;
}

function _editorYesNo(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Libellés</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Bouton « Oui »</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.yes_label"
               value="${_escape(field.options?.yes_label || 'Oui')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Bouton « Non »</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.no_label"
               value="${_escape(field.options?.no_label || 'Non')}">
      </label>
    </section>
  `;
}

function _editorRank(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Nombre de places à classer</span>
        <input class="pulsa-input" type="number" min="2" max="10"
               data-bind="field.${sid}.${field.id}.options.slots"
               value="${field.options?.slots ?? 3}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Étiquette de chaque place</span>
        <input class="pulsa-input" type="text"
               placeholder="Priorité"
               data-bind="field.${sid}.${field.id}.options.placeholder"
               value="${_escape(field.options?.placeholder || '')}">
      </label>
    </section>
  `;
}

function _editorDate(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Bornes (optionnelles)</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Date minimale</span>
        <input class="pulsa-input" type="date"
               data-bind="field.${sid}.${field.id}.options.min"
               value="${_escape(field.options?.min || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Date maximale</span>
        <input class="pulsa-input" type="date"
               data-bind="field.${sid}.${field.id}.options.max"
               value="${_escape(field.options?.max || '')}">
      </label>
    </section>
  `;
}

function _editorAmount(sid, field) {
  const currencies = ['EUR', 'USD', 'CHF', 'GBP'];
  const cur = field.options?.currency || 'EUR';
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <div class="pulsa-fld">
        <span class="pulsa-fld-label">Devise</span>
        <div class="pulsa-preset-row">
          ${currencies.map(c => `
            <button class="pulsa-chip ${cur === c ? 'is-on' : ''}"
                    data-act="set-currency"
                    data-field="${field.id}" data-value="${c}">
              ${c}
            </button>
          `).join('')}
        </div>
      </div>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Décimales (0 à 4)</span>
        <input class="pulsa-input" type="number" min="0" max="4"
               data-bind="field.${sid}.${field.id}.options.decimals"
               value="${field.options?.decimals ?? 2}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Minimum</span>
        <input class="pulsa-input" type="number"
               data-bind="field.${sid}.${field.id}.options.min"
               value="${field.options?.min ?? ''}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Maximum (optionnel)</span>
        <input class="pulsa-input" type="number"
               data-bind="field.${sid}.${field.id}.options.max"
               value="${field.options?.max ?? ''}">
      </label>
    </section>
  `;
}

function _editorSocialLinks(sid, field) {
  const networks = field.options?.networks || [];
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Réseaux proposés au répondant</h4>
      <p class="pulsa-editor-hint">Activez les réseaux pertinents pour votre formulaire. Le répondant ne verra que ceux que vous activez.</p>
      <div class="pulsa-networks">
        ${networks.map(n => `
          <div class="pulsa-network ${n.enabled ? 'is-on' : ''}">
            <button class="pulsa-network-toggle"
                    data-act="toggle-network"
                    data-field="${field.id}" data-network="${n.id}"
                    title="${n.enabled ? 'Désactiver' : 'Activer'}">
              ${n.enabled ? icon('check', 12) : icon('plus', 12)}
              <span>${n.label}</span>
            </button>
            ${n.enabled ? `
              <input class="pulsa-input pulsa-network-placeholder" type="text"
                     placeholder="Placeholder affiché au répondant"
                     data-bind="network.${sid}.${field.id}.${n.id}.placeholder"
                     value="${_escape(n.placeholder)}">
            ` : ''}
          </div>
        `).join('')}
      </div>
    </section>
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
  // Si on n'est pas dans le builder ou pas de formulaire chargé, rien à sauver
  if (_state.view !== 'builder' || !_state.form) return;
  try {
    const stored = saveForm(_state.form);
    _state.form = stored; // récupère updated_at + id si nouveau
    setCurrentFormId(stored.id);
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

// _loadDraft a été remplacé par _initFromStorage + la library
