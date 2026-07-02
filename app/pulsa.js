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
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import { burgerHTML, bindBurger }            from './lib/topbar-burger.js';
import { CF_API, isAdminUser } from './pads-loader.js';
import { deliverEntryHtml, wireDeliver } from './lib/asset-deliver.js';
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
import { KEYFORM_TEMPLATES, TEMPLATE_CATEGORIES, instantiateTemplate } from './lib/pulsa-templates.js';
import { downloadProofReceipt } from './lib/proof-receipt.js';

// ── Métadonnées de l'artefact ─────────────────────────────────
const WORKSPACE_META = {
  id: 'A-COM-004',
  name: 'Key Form',
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

// ── Aperçu live (iframe form.html?preview=1) ──────────────────
// L'aperçu = la vraie page publique form.html en mode ?preview=1, alimentée
// par postMessage. Fidélité 100 %, isolée du builder. Le formulaire en cours
// est poussé (anti-rebond 150 ms) à chaque rendu et à chaque frappe.
let _previewReady   = false;  // l'iframe a confirmé que son écouteur est prêt
let _previewPending = null;   // dernier form bufferisé tant que l'iframe n'est pas prête
let _previewTimer   = null;   // timer d'anti-rebond

function _postToPreview(form) {
  const f = _root?.querySelector('[data-slot="preview-frame"]');
  f?.contentWindow?.postMessage({ type: 'pulsa:preview', form }, location.origin);
}

function _previewVisibleForStep() {
  return _state.view === 'builder' &&
         (_currentStepId === 'structure' || _currentStepId === 'appearance');
}

function _pushPreview() {
  if (!_previewVisibleForStep() || !_state.form) return;
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => {
    const snapshot = _state.form;
    if (!_previewReady) { _previewPending = snapshot; return; }
    _postToPreview(snapshot);
  }, 150);
}

// Écouteur unique (handshake iframe → builder), posé une seule fois au chargement
// du module : pas d'accumulation à chaque open/close du workspace.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'pulsa:preview-ready') {
    _previewReady = true;
    if (_previewPending) { _postToPreview(_previewPending); _previewPending = null; }
  }
});

function _initState() {
  return {
    // Mode d'affichage : 'library' | 'builder' | 'responses'
    view: 'library',
    // Formulaire actuellement en édition (null en mode library ou responses)
    form: null,
    // Vue Responses : { form_id, list, loading, error }
    responses: { form_id: null, list: [], loading: false, error: null },
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
/**
 * Ouvre le workspace Pulsa.
 * @param {object} [opts]
 * @param {boolean} [opts.viewResponses] Si vrai et qu'un formulaire est
 *   chargé depuis setCurrentFormId, bascule directement sur la vue
 *   « Responses » au lieu du builder. Utilisé par Kodex pour ouvrir le
 *   dashboard des consultations d'un brief partagé en un seul clic.
 */
export function openPulsa(opts = {}) {
  if (_root) return;
  _initFromStorage();
  _buildShell();
  // Petit écran : aperçu replié pour laisser la place à l'éditeur (le bouton
  // « œil » de la barre du haut le rouvre en surcouche). Suivi AU RESIZE
  // aussi : sans ça, ouvrir en grand puis rétrécir la fenêtre laissait la
  // surcouche fixe (media ≤1280px) ouverte PAR-DESSUS l'éditeur.
  if (_previewMq.matches) _root.classList.add('pulsa-preview-collapsed');
  _previewMq.addEventListener('change', _syncPreviewToViewport);
  _renderMain();
  _renderRail();
  // V1.5 — tire les Key Form livrés au client (réception transparente).
  // Non-bloquant : la biblio locale s'affiche tout de suite, les formulaires
  // serveur apparaissent dès que le pull répond.
  _hydrateFromServer();
  // Si demandé, on déclenche le mode responses après le rendu initial.
  // _viewResponses re-rend le main → pas de flash visuel parce que les
  // 2 renders sont synchrones dans la même tâche.
  if (opts.viewResponses && _state.form?.id) {
    _viewResponses(_state.form.id);
  }
}

export function closePulsa() {
  if (!_root) return;
  if (_state.view === 'builder') _saveDraft();
  clearTimeout(_previewTimer);
  _previewReady = false;     // la nouvelle iframe re-fera le handshake à la réouverture
  _previewPending = null;
  _previewMq.removeEventListener('change', _syncPreviewToViewport);
  _root.remove();
  _root = null;
  _fieldTypeMenu = null;
}

// Aperçu ↔ viewport : replié sous 1281px (surcouche), déplié au-dessus
// (colonne). Même seuil que le @media de pulsa.css (pulsa-preview-col fixed).
const _previewMq = window.matchMedia('(max-width: 1280px)');
function _syncPreviewToViewport(e) {
  if (!_root) return;
  _root.classList.toggle('pulsa-preview-collapsed', e.matches);
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
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-slot="back-btn" data-act="close"
                title="Retour" aria-label="Retour">
          ${icon('chevron-left', 34)}
          <span data-slot="back-label" hidden></span>
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('pulsa', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
        <span class="crumb" data-slot="crumb"></span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <span class="pulsa-save-indicator" data-slot="save-indicator" aria-live="polite">
          ${icon('check', 12)}<span data-slot="save-label">Enregistré</span>
        </span>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
        <button class="ws-iconbtn pulsa-preview-toggle" data-act="toggle-preview"
                title="Afficher / masquer l'aperçu en direct" aria-label="Afficher ou masquer l'aperçu">
          ${icon('eye', 18)}
        </button>
        <button class="ws-iconbtn" data-slot="save-btn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
      </div>
    </header>

    <div class="ws-body">
      <nav class="ws-rail" data-slot="rail"></nav>
      <main class="ws-main" data-slot="main"></main>
      <section class="pulsa-preview-col" data-slot="preview">
        <header class="pulsa-preview-head">
          <span class="pulsa-preview-title">${icon('eye', 14)} Aperçu en direct</span>
          <button class="ws-iconbtn pulsa-preview-collapse" data-act="toggle-preview"
                  title="Masquer l'aperçu" aria-label="Masquer l'aperçu">${icon('chevron-right', 16)}</button>
        </header>
        <div class="pulsa-preview-stage">
          <iframe class="pulsa-preview-frame" data-slot="preview-frame"
                  src="/form.html?preview=1" title="Aperçu en direct du formulaire"
                  sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
      </section>
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
  bindRatingButton(_root, WORKSPACE_META.id);
  bindHelpButton(_root, WORKSPACE_META.id);
  bindBurger(_root);
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

  // Aperçu live — masquer/afficher la colonne (bouton barre du haut + chevron en-tête)
  if (act === 'toggle-preview') { _root.classList.toggle('pulsa-preview-collapsed'); return; }

  // Vue Bibliothèque
  if (act === 'new-form')          return _newForm();
  if (act === 'open-templates')    return _openTemplatesGallery();
  if (act === 'use-template')      return _useTemplate(t.dataset.id);
  if (act === 'recover-published') return _recoverPublishedForm();
  if (act === 'open-form')         return _openForm(t.dataset.id);
  if (act === 'duplicate-form')    return _duplicateForm(t.dataset.id);
  if (act === 'delete-form')       return _deleteForm(t.dataset.id);
  if (act === 'back-to-library')   return _backToLibrary();

  // Vue Responses
  if (act === 'view-responses')    return _viewResponses(t.dataset.id);
  if (act === 'export-csv')        return _exportCsv(t.dataset.id);
  if (act === 'download-proof')    return _downloadProof(t.dataset.id);

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

  // Bloc répétable — édition des sous-champs
  if (act === 'rep-add-sub')      return _repeaterAddSub(t.dataset.field);
  if (act === 'rep-del-sub')      return _repeaterDelSub(t.dataset.field, t.dataset.idx);
  if (act === 'rep-move-sub')     return _repeaterMoveSub(t.dataset.field, t.dataset.idx, t.dataset.dir);

  // Logique conditionnelle (P2B.1/.2)
  if (act === 'enable-visible-if')   return _enableVisibleIf(t.dataset.field);
  if (act === 'disable-visible-if')  return _disableVisibleIf(t.dataset.field);
  if (act === 'enable-required-if')  return _enableRequiredIf(t.dataset.field);
  if (act === 'disable-required-if') return _disableRequiredIf(t.dataset.field);
  if (act === 'toggle-compute-source') return _toggleComputeSource(t.dataset.field, t.dataset.source);
  if (act === 'toggle-compute')      return _toggleCompute(t.dataset.field);
  if (act === 'copy-field-id')       return _copyFieldId(t.dataset.field);

  // Étapes Apparence / Livraison
  if (act === 'set-brand-preset') return _setBrandPreset(t.dataset.gradient, t.dataset.color, t.dataset.accent);
  if (act === 'clear-gradient')   return _clearGradient();
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
  _pushPreview();        // maj de l'aperçu pendant la frappe (anti-rebond interne)
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
  } else if (_state.view === 'responses') {
    if (back) back.dataset.act = 'back-to-library';
    if (backLbl) backLbl.textContent = 'Mes formulaires';
    if (sep) sep.style.display = '';
    if (crumb) {
      const form = getForm(_state.responses.form_id);
      crumb.textContent = (form?.meta?.title?.trim() || 'Formulaire') + ' · Réponses';
    }
    if (saveBtn) saveBtn.style.display = 'none';
    if (saveInd) saveInd.style.display = 'none';
  } else {
    if (back) back.dataset.act = 'back-to-library';
    if (backLbl) backLbl.textContent = 'Mes formulaires';
    if (sep) sep.style.display = '';
    // Pas de label d'étape dans le hero : le rail gauche est déjà la
    // source de vérité de l'étape courante (« 1 · Structure »).
    if (crumb) crumb.textContent = '';
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

// ═══════════════════════════════════════════════════════════════
// Galerie de Modèles (remplace l'ancien exemple VEFA / immobilier)
// ═══════════════════════════════════════════════════════════════
function _openTemplatesGallery() {
  _renderTemplatesGallery();
}

function _renderTemplatesGallery() {
  const m = _root?.querySelector('[data-slot="modal"]');
  if (!m) return;
  const groups = TEMPLATE_CATEGORIES.map(cat => {
    const items = KEYFORM_TEMPLATES.filter(t => t.category === cat.id);
    if (!items.length) return '';
    return `
      <div class="pulsa-type-group">
        <h3 class="pulsa-type-group-title">${cat.label}</h3>
        <div class="pulsa-tpl-grid">
          ${items.map(t => `
            <button class="pulsa-tpl-card" data-act="use-template" data-id="${t.id}" title="Utiliser ce modèle">
              <span class="pulsa-tpl-card-ico">${icon(t.ico, 20)}</span>
              <span class="pulsa-tpl-card-body">
                <span class="pulsa-tpl-card-name">${_escape(t.name)}</span>
                <span class="pulsa-tpl-card-desc">${_escape(t.description)}</span>
              </span>
              <span class="pulsa-tpl-card-cta">${icon('plus', 13)}<span>Utiliser</span></span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  m.innerHTML = `
    <div class="pulsa-modal-backdrop" data-act="close-modal"></div>
    <div class="pulsa-modal-card pulsa-modal-card-lg">
      <header class="pulsa-modal-head">
        <div class="pulsa-modal-head-text">
          <h2>Modèles</h2>
          <p class="pulsa-modal-sub">Un formulaire complet en 1 clic — puis 100 % modulable (champs, textes, branding).</p>
        </div>
        <button class="pulsa-icon-btn" data-act="close-modal" title="Fermer">${icon('x', 16)}</button>
      </header>
      <div class="pulsa-modal-body">
        ${groups}
      </div>
    </div>
  `;
  m.hidden = false;
}

function _useTemplate(templateId) {
  const structure = instantiateTemplate(templateId);
  if (!structure) return _closeModal();
  const form = saveForm({ ...structure, id: newFormId() });
  setCurrentFormId(form.id);
  _state.view = 'builder';
  _state.form = form;
  _state.ui.selected_field = null;
  _currentStepId = 'structure';
  _closeModal();
  _refreshTopbar();
  _renderMain();
  _renderRail();
}

// ─── Récupération d'un formulaire publié depuis le Worker D1 ──
// Cas d'usage : la library locale a été vidée (changement d'appareil,
// reset, mode démo, etc.) mais le formulaire reste publié côté serveur.
// On le re-télécharge via l'endpoint public et on le réinjecte dans
// la library locale. Zéro accès admin requis (route publique).
async function _recoverPublishedForm() {
  // Prompt natif pour le slug — on accepte aussi une URL complète et on
  // extrait le slug automatiquement pour réduire la friction.
  let input = window.prompt(
    'Slug ou URL du formulaire publié à récupérer\n\n' +
    'Exemples acceptés :\n' +
    '  biennale-revest-2026\n' +
    '  https://protein-keystone.com/f/biennale-revest-2026'
  );
  if (!input) return;
  input = input.trim();
  // Extrait le slug si une URL est collée
  const match = input.match(/\/f\/([^/?#]+)/);
  const slug = (match ? match[1] : input).toLowerCase().trim();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    alert('Slug invalide — utilisez uniquement lettres minuscules, chiffres et tirets.');
    return;
  }
  try {
    const res = await fetch(`${CF_API}/api/pulsa/public/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      alert(res.status === 404
        ? `Formulaire "${slug}" introuvable.\nVérifiez le slug ou contactez l'administrateur.`
        : `Erreur ${res.status} lors de la récupération.`);
      return;
    }
    const data = await res.json();
    const publicForm = data.form || data;
    if (!publicForm?.meta || !Array.isArray(publicForm.sections)) {
      alert('Réponse serveur invalide.');
      return;
    }
    // L'endpoint public /api/pulsa/public/:slug retourne un format
    // simplifié (id, slug, title, meta, sections) sans delivery ni
    // output (stripping de sécurité côté Worker, cf. _toPublicConfig).
    // Pour que le builder fonctionne, on merge avec un newForm() qui
    // fournit toutes les clés requises (delivery, output, etc.).
    const baseline = newForm();
    // IMPÉRATIF : aligner l'id local sur l'id retourné par le Worker.
    // Sans ça, les routes par form_id (/api/pulsa/responses, exports,
    // PATCH publish…) renvoient 404 puisque le row DB est introuvable.
    const dbId = publicForm.id;
    if (!dbId) {
      alert('Réponse serveur invalide (id manquant).');
      return;
    }
    // Si un brouillon local existe pour ce slug avec un id différent
    // (ancien clic du bouton qui avait généré un id local divergent),
    // on supprime ce doublon pour réaligner sur l'id DB. On préserve
    // d'abord delivery/output pour les ré-injecter ci-dessous.
    const existing = listForms().find(f => f?.meta?.slug === slug);
    if (existing && existing.id !== dbId) {
      deleteForm(existing.id);
    }
    const form = {
      ...baseline,
      ...publicForm,
      id: dbId,
      meta: {
        ...baseline.meta,
        ...(publicForm.meta || {}),
        slug,
      },
      sections: publicForm.sections,
      delivery: {
        ...baseline.delivery,
        ...(existing?.delivery || {}),
      },
      output: {
        ...baseline.output,
        ...(existing?.output || {}),
        status: 'published',
        published_url: `${location.origin}/f/${slug}`,
        last_response_at: existing?.output?.last_response_at || null,
      },
    };
    const stored = saveForm(form);
    setCurrentFormId(stored.id);
    // Bascule directement sur le builder du form récupéré.
    _state.view = 'builder';
    _state.form = stored;
    _state.ui.selected_field = null;
    _currentStepId = 'structure';
    _refreshTopbar();
    _renderMain();
    _renderRail();
  } catch (e) {
    alert('Erreur réseau : ' + (e.message || e));
  }
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
  _state.responses = { form_id: null, list: [], loading: false, error: null };
  _state.ui.selected_field = null;
  _refreshTopbar();
  _renderMain();
  _renderRail();
}

// ── Vue Responses : chargement et navigation ──────────────────
async function _viewResponses(formId) {
  if (!formId) return;
  _state.view = 'responses';
  _state.responses = { form_id: formId, list: [], loading: true, error: null };
  _refreshTopbar();
  _renderMain();
  _renderRail();

  try {
    const res = await fetch(CF_API + '/api/pulsa/responses?form_id=' + encodeURIComponent(formId), {
      headers: _authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      _state.responses.error = data?.error || data?.message || `Erreur HTTP ${res.status}`;
    } else {
      _state.responses.list = data?.responses || [];
    }
  } catch (e) {
    _state.responses.error = 'Erreur réseau : ' + (e.message || e);
  }
  _state.responses.loading = false;
  _renderMain();
}

async function _exportCsv(formId) {
  if (!formId) return;
  try {
    const res = await fetch(CF_API + '/api/pulsa/responses.csv?form_id=' + encodeURIComponent(formId), {
      headers: _authHeaders(),
    });
    if (!res.ok) {
      alert('Export impossible : HTTP ' + res.status);
      return;
    }
    const blob = await res.blob();
    const form = getForm(formId);
    const slug = form?.meta?.slug || 'pulsa';
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulsa-${slug}-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
  } catch (e) {
    alert('Erreur réseau : ' + (e.message || e));
  }
}

// Télécharge le « Certificat de preuve » d'une réponse (horodatage serveur,
// empreinte SHA-256, IP/navigateur si non anonyme) → impression PDF.
function _downloadProof(responseId) {
  const resp = (_state.responses.list || []).find(r => r.id === responseId);
  if (!resp) return;
  const form = getForm(_state.responses.form_id) || _state.form;
  if (!form) { alert('Formulaire introuvable.'); return; }
  downloadProofReceipt(form, resp);
}

// ═══════════════════════════════════════════════════════════════
// Navigation entre étapes
// ═══════════════════════════════════════════════════════════════
function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  _currentStepId = stepId;
  // Pas de label d'étape dans le hero — le rail gauche fait foi.
  _renderRail();
  _renderMain();
}

function _navigateRelative(delta) {
  const i = _stepIndex(_currentStepId);
  const next = STEPS[i + delta];
  if (next) _navigate(next.id);
}

// ── Headers d'authentification pour l'API Worker (admin ou JWT) ─
function _authHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  const adminToken = localStorage.getItem('ks_admin_token');
  const jwt        = localStorage.getItem('ks_jwt');
  if (adminToken)  h['Authorization'] = 'Bearer ' + adminToken;
  else if (jwt)    h['Authorization'] = 'Bearer ' + jwt;
  return h;
}

// ── V1.5 — Réception transparente des Key Form livrés ───────────
// La bibliothèque Pulsa est local-first. Un formulaire « livré » (sprint
// Livrer V1) voit juste son owner_sub flippé côté serveur → sans ce pull,
// il n'apparaîtrait pas dans le builder du client. On tire donc les
// formulaires que le client possède sur le serveur et on fusionne dans
// la bibliothèque locale ceux qui n'y sont PAS encore (local-first : on
// n'écrase jamais une édition locale en cours).
//
// Admin EXCLU : son endpoint /api/pulsa/forms renvoie TOUS les forms (il
// verrait ceux de tous les clients). Lui crée/livre depuis sa biblio locale.
// Silencieux si non connecté / offline (best-effort).
async function _hydrateFromServer() {
  if (isAdminUser()) return;                          // admin = local-only
  if (!localStorage.getItem('ks_jwt')) return;        // pas connecté → rien
  let serverForms = [];
  try {
    const res = await fetch(CF_API + '/api/pulsa/forms', { headers: _authHeaders() });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    serverForms = Array.isArray(data?.forms) ? data.forms : [];
  } catch (_) { return; }
  if (!serverForms.length) return;

  const localIds = new Set(listForms().map(f => f.id));
  let added = 0;
  for (const sf of serverForms) {
    if (!sf?.id || localIds.has(sf.id)) continue;     // ne pas écraser le local
    try {
      // sf (issu de _rowToForm) porte déjà meta/sections/delivery/output ;
      // on le pose sur newForm() pour garantir toutes les clés du builder.
      saveForm({ ...newForm(), ...sf, id: sf.id });
      added++;
    } catch (_) { /* form malformé : on saute */ }
  }
  // Rafraîchir la bibliothèque si on y est (sinon visible au prochain retour).
  if (added > 0 && _root && _state.view === 'library') {
    _renderMain();
  }
}

// ── Publication réelle via Worker (POST /api/pulsa/forms) ───────
async function _publishForm() {
  const f = _state.form;
  if (!f) return;
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

  // Marque le formulaire comme à publier (status='published') côté payload
  const payload = {
    form: {
      ...f,
      output: { ...(f.output || {}), status: 'published' },
    },
  };

  try {
    const res = await fetch(CF_API + '/api/pulsa/forms', {
      method: 'POST',
      headers: _authHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // 409 = slug pris ; 400 = validation ; 401 = pas d'auth ; 403 = pas owner
      const msg = data?.error || data?.message || `Erreur HTTP ${res.status}`;
      alert(`Publication impossible :\n\n${msg}`);
      return;
    }

    // Succès : on récupère la version serveur (output.status, published_at, etc.)
    const slug = data?.form?.slug || _state.form.meta.slug;
    // URL propre /f/{slug} si le rewrite Vercel fonctionne, sinon
    // form.html lit aussi /form?s={slug} en fallback.
    const publicUrl = `${location.origin}/f/${encodeURIComponent(slug)}`;
    if (data?.form) {
      _state.form = {
        ..._state.form,
        ...data.form,
        output: {
          ...(_state.form.output || {}),
          ...(data.form.output || {}),
          status: 'published',
          published_url: publicUrl,
          last_response_at: null,
        },
      };
      _saveDraft({ explicit: true });
    }

    const url = publicUrl;
    alert(`Formulaire publié avec succès !\n\nURL à partager :\n${url}\n\nLes répondants pourront le remplir en ligne. Les réponses arriveront aux destinataires configurés.`);
    _renderMain();
    _renderRail();
  } catch (e) {
    console.error('[pulsa] publish error', e);
    alert(`Erreur réseau lors de la publication : ${e.message || e}`);
  }
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
  let baseChoice;
  if (field.type === 'cards') {
    baseChoice = { id: 'c' + idx, label: 'Choix ' + idx, ico: 'sparkles', desc: '' };
  } else if (field.type === 'image-picker') {
    baseChoice = { id: 'img' + idx, label: 'Option ' + idx, image_url: '' };
  } else {
    baseChoice = { id: 'c' + idx, label: 'Option ' + idx };
  }
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

// ── Édition des sous-champs d'un bloc répétable (repeater) ───
function _repeaterAddSub(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const f = found.field;
  if (!f.options) f.options = {};
  if (!Array.isArray(f.options.fields)) f.options.fields = [];
  let n = f.options.fields.length + 1;
  let id = 'sub' + n;
  while (f.options.fields.some(x => x.id === id)) { n++; id = 'sub' + n; }
  f.options.fields.push({
    id, type: 'text-short', label: 'Nouveau champ', help: '',
    required: false, width: 'full',
    options: { placeholder: '', max_chars: 160 },
  });
  _renderAside();
  _saveDraft();
}

function _repeaterDelSub(fieldId, idx) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const arr = found.field.options?.fields;
  if (Array.isArray(arr)) arr.splice(Number(idx), 1);
  _renderAside();
  _saveDraft();
}

function _repeaterMoveSub(fieldId, idx, dir) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const arr = found.field.options?.fields;
  if (!Array.isArray(arr)) return;
  const i = Number(idx);
  const j = i + (dir === 'up' ? -1 : 1);
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
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

// ── Logique conditionnelle ───────────────────────────────────
function _enableVisibleIf(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  // Source par défaut : 1er autre champ disponible
  const others = _otherFields(fieldId);
  found.field.visible_if = {
    field: others[0]?.id || '',
    op: 'eq',
    value: '',
  };
  _renderAside();
  _saveDraft();
}

function _disableVisibleIf(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  found.field.visible_if = null;
  _renderAside();
  _saveDraft();
}

function _copyFieldId(fieldId) {
  try {
    navigator.clipboard.writeText(fieldId);
  } catch {}
}

/**
 * Retourne tous les champs du formulaire sauf le champ courant.
 * Utilisé comme liste de sources possibles pour visible_if.
 */
function _otherFields(fieldId) {
  const out = [];
  for (const sec of _state.form.sections) {
    for (const f of sec.fields) {
      if (f.id !== fieldId) out.push(f);
    }
  }
  return out;
}

/**
 * Tous les autres champs amount (sources possibles d'un compute_from).
 */
function _otherAmountFields(fieldId) {
  return _otherFields(fieldId).filter(f => f.type === 'amount' && !f.compute_from);
}

// ── required_if (P2B.2) ──────────────────────────────────────
function _enableRequiredIf(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  const others = _otherFields(fieldId);
  found.field.required_if = {
    field: others[0]?.id || '',
    op: 'eq',
    value: '',
  };
  _renderAside();
  _saveDraft();
}

function _disableRequiredIf(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found) return;
  found.field.required_if = null;
  _renderAside();
  _saveDraft();
}

// ── compute_from (P2B.2) — uniquement pour amount ────────────
function _toggleCompute(fieldId) {
  const found = _findFieldById(fieldId);
  if (!found || found.field.type !== 'amount') return;
  if (found.field.compute_from) {
    found.field.compute_from = null;
  } else {
    found.field.compute_from = { fields: [], op: 'sum' };
  }
  _renderAside();
  _saveDraft();
}

function _toggleComputeSource(fieldId, sourceId) {
  const found = _findFieldById(fieldId);
  if (!found || !found.field.compute_from) return;
  const list = found.field.compute_from.fields || [];
  const idx = list.indexOf(sourceId);
  if (idx === -1) list.push(sourceId);
  else list.splice(idx, 1);
  found.field.compute_from.fields = list;
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
function _setBrandPreset(gradient, color, accent) {
  _state.form.meta.brand_gradient = gradient || null;
  _state.form.meta.brand_color = color;
  _state.form.meta.brand_accent = accent;
  _renderMain();
  _saveDraft();
}

function _clearGradient() {
  _state.form.meta.brand_gradient = null;
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

  // Pilote l'affichage de la colonne aperçu (CSS) : visible en builder sur les
  // étapes Structure/Apparence ; chaîne vide en library/responses → masquée.
  _root.dataset.step = _state.view === 'builder' ? _currentStepId : '';

  // Vue Bibliothèque : on rend la liste et on stop là (rail + aside masqués via CSS)
  if (_state.view === 'library') {
    _root.classList.add('is-library');
    _root.classList.remove('is-responses');
    _renderLibrary(main);
    _renderAside();
    return;
  }
  if (_state.view === 'responses') {
    _root.classList.add('is-responses');
    _root.classList.remove('is-library');
    _renderResponses(main);
    _renderAside();
    return;
  }

  _root.classList.remove('is-library', 'is-responses');
  switch (_currentStepId) {
    case 'structure':  _renderStructure(main); break;
    case 'appearance': _renderAppearance(main); break;
    case 'delivery':   _renderDelivery(main); break;
    case 'publish':    _renderPublish(main); break;
  }
  main.insertAdjacentHTML('beforeend', _renderStepFooter());
  _pushPreview();
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
        <div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin:8px auto 0;">
          <button class="pulsa-btn pulsa-btn-primary pulsa-btn-publish" data-act="new-form">
            ${icon('plus', 16)}<span>Créer mon premier formulaire</span>
          </button>
          <button class="pulsa-btn pulsa-btn-ghost" data-act="open-templates" title="Partir d'un modèle prêt à l'emploi">
            ${icon('package', 14)}<span>Partir d'un modèle</span>
          </button>
          <button class="pulsa-btn pulsa-btn-ghost" data-act="recover-published" title="Re-télécharger un formulaire déjà publié depuis son URL">
            ${icon('refresh', 14)}<span>Récupérer un formulaire publié</span>
          </button>
        </div>
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
      <div style="display:flex;gap:8px;align-items:center">
        <button class="pulsa-btn pulsa-btn-ghost" data-act="recover-published" title="Re-télécharger un formulaire déjà publié depuis son URL">
          ${icon('refresh', 14)}<span>Récupérer un publié</span>
        </button>
        <button class="pulsa-btn pulsa-btn-ghost" data-act="open-templates" title="Partir d'un modèle prêt à l'emploi">
          ${icon('package', 14)}<span>Modèles</span>
        </button>
        <button class="pulsa-btn pulsa-btn-primary" data-act="new-form">
          ${icon('plus', 16)}<span>Nouveau formulaire</span>
        </button>
      </div>
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
      ${(() => {
        // Pour les brouillons, on ne montre PAS le slug nu : le user serait
        // tenté de le copier-coller dans son navigateur et tomberait sur une
        // 404 (le formulaire n'existe pas encore côté Worker). On annonce
        // explicitement que l'URL sera activée à la publication.
        if (!meta.slug) {
          return '<p class="pulsa-lib-card-slug pulsa-lib-card-slug-empty">URL non définie</p>';
        }
        if (!isPublished) {
          return `<p class="pulsa-lib-card-slug pulsa-lib-card-slug-empty">URL active après publication · /f/${_escape(meta.slug)}</p>`;
        }
        return `<p class="pulsa-lib-card-slug">keystone.app/f/${_escape(meta.slug)}</p>`;
      })()}
      <div class="pulsa-lib-card-meta">
        <span title="Sections">${icon('sliders', 12)} ${sections.length}</span>
        <span title="Champs">${icon('edit', 12)} ${fieldCount}</span>
        <span title="Destinataires">${icon('check', 12)} ${recipients}</span>
        <span title="TTL">${icon('history', 12)} ${meta.ttl_days ?? 90}j</span>
      </div>
      <footer class="pulsa-lib-card-footer">
        <span class="pulsa-lib-card-date">${updated}</span>
        <div class="pulsa-lib-card-actions" data-stop-propagation>
          ${isPublished ? `
            <button class="pulsa-icon-btn" data-act="view-responses" data-id="${form.id}" title="Voir les réponses">
              ${icon('eye', 14)}
            </button>
          ` : ''}
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

// ═══════════════════════════════════════════════════════════════
// Vue Responses — rendu
// ═══════════════════════════════════════════════════════════════
function _renderResponses(main) {
  const formId = _state.responses.form_id;
  const form = getForm(formId);
  if (!form) {
    main.innerHTML = `
      <div class="pulsa-lib-empty">
        <h1>Formulaire introuvable</h1>
        <p>Ce formulaire n'existe plus dans votre bibliothèque.</p>
      </div>
    `;
    return;
  }

  const { list, loading, error } = _state.responses;
  const total = list.length;
  const last7d = list.filter(r => {
    const t = r.created_at ? new Date(r.created_at + 'Z').getTime() : 0;
    return Date.now() - t < 7 * 86400000;
  }).length;

  main.innerHTML = `
    <div class="pulsa-resp-head">
      <div>
        <h1 class="ws-step-title">Réponses reçues</h1>
        <p class="ws-step-sub">${_escape(form.meta?.title || 'Formulaire')} · TTL ${form.meta?.ttl_days ?? 90} jours</p>
      </div>
      <button class="pulsa-btn pulsa-btn-primary" data-act="export-csv" data-id="${form.id}" ${total === 0 ? 'disabled' : ''}>
        ${icon('download', 14)}<span>Exporter CSV</span>
      </button>
    </div>

    <div class="pulsa-resp-stats">
      <div class="pulsa-resp-stat">
        <span class="pulsa-resp-stat-num">${total}</span>
        <span class="pulsa-resp-stat-label">${total > 1 ? 'réponses au total' : 'réponse au total'}</span>
      </div>
      <div class="pulsa-resp-stat">
        <span class="pulsa-resp-stat-num">${last7d}</span>
        <span class="pulsa-resp-stat-label">${last7d > 1 ? 'sur 7 derniers jours' : 'sur 7 derniers jours'}</span>
      </div>
    </div>

    ${form.meta?.slug ? deliverEntryHtml() : ''}

    ${loading ? `
      <div class="pulsa-lib-empty"><p>Chargement des réponses…</p></div>
    ` : error ? `
      <div class="pulsa-lib-empty">
        <h1>Erreur de chargement</h1>
        <p>${_escape(error)}</p>
      </div>
    ` : total === 0 ? `
      <div class="pulsa-lib-empty">
        <p>Aucune réponse reçue pour l'instant.</p>
        ${form.meta?.slug ? `<p style="font-size:12px;opacity:.6;margin-top:8px;">URL : ${location.host}/form?s=${_escape(form.meta.slug)}</p>` : ''}
      </div>
    ` : `
      <div class="pulsa-resp-list">
        ${list.map((r, i) => _renderResponseCard(form, r, list.length - i)).join('')}
      </div>
    `}
  `;

  // « Livrer à un client » (admin only — absent sinon). Key Form est
  // local-first : après le flip serveur (owner_sub), le client devra
  // « Récupérer un formulaire publié » via l'URL pour le voir dans SON
  // builder. On retire la copie locale de l'admin après livraison.
  const _delRoot = main.querySelector('[data-deliver-root]');
  if (_delRoot) {
    const slug = form.meta?.slug || '';
    wireDeliver(_delRoot, {
      type: 'keyform',
      assetId: form.id,
      assetName: form.meta?.title || 'Formulaire',
      onExportResponses: () => _exportCsv(form.id),
      deliveredNote: slug
        ? `Il apparaîtra tout seul dans le Key Form du client à sa prochaine ouverture (une fois connecté à son compte). URL publique du formulaire : ${location.host}/f/${slug}`
        : '',
      onDelivered: () => {
        // Retrait LOCAL uniquement (la ligne serveur appartient au client).
        try { deleteForm(form.id); } catch (_) {}
        if (getCurrentFormId() === form.id) setCurrentFormId(null);
        _state.form = null;   // évite un re-save au retour bibliothèque
      },
    });
  }
}

function _renderResponseCard(form, response, ordinal) {
  const sections = form.sections || [];
  const values = response.responses || {};
  const created = _formatResponseDate(response.created_at);

  const previews = [];
  for (const sec of sections) {
    for (const f of (sec.fields || [])) {
      if (previews.length >= 3) break;
      const v = values[f.id];
      const formatted = _formatValueForUI(f, v);
      if (formatted) previews.push({ label: f.label, value: formatted });
    }
    if (previews.length >= 3) break;
  }

  return `
    <article class="pulsa-resp-card">
      <header class="pulsa-resp-card-head">
        <span class="pulsa-resp-card-num">#${ordinal}</span>
        <span class="pulsa-resp-card-date">${_escape(created)}</span>
        <button class="pulsa-icon-btn" data-act="download-proof" data-id="${_escape(response.id)}"
                title="Télécharger le certificat de preuve (PDF)"
                style="margin-left:auto;width:auto;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font-size:11.5px;font-weight:600">
          ${icon('file-text', 13)}<span>Certificat de preuve</span>
        </button>
      </header>
      <div class="pulsa-resp-card-body">
        ${previews.length === 0 ? `
          <p class="pulsa-resp-card-empty">Réponse vide.</p>
        ` : previews.map(p => `
          <div class="pulsa-resp-row">
            <span class="pulsa-resp-row-label">${_escape(p.label || '')}</span>
            <span class="pulsa-resp-row-value">${p.value}</span>
          </div>
        `).join('')}
      </div>
      <details class="pulsa-resp-card-expand">
        <summary>Voir toutes les réponses</summary>
        <div class="pulsa-resp-full">
          ${sections.map(sec => _renderResponseSection(sec, values)).join('')}
        </div>
      </details>
    </article>
  `;
}

function _renderResponseSection(section, values) {
  const fields = section.fields || [];
  if (fields.length === 0) return '';
  return `
    <div class="pulsa-resp-section">
      <h4 class="pulsa-resp-section-title">${_escape(section.title || 'Section')}</h4>
      ${fields.map(f => {
        const formatted = _formatValueForUI(f, values[f.id]);
        return `
          <div class="pulsa-resp-row">
            <span class="pulsa-resp-row-label">${_escape(f.label || '')}</span>
            <span class="pulsa-resp-row-value">${formatted || '<em style="opacity:.4">(vide)</em>'}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function _formatResponseDate(ts) {
  if (!ts) return '';
  const d = new Date(ts + 'Z');
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function _formatValueForUI(field, raw) {
  if (raw == null || raw === '') return '';
  const opts = field.options || {};
  switch (field.type) {
    case 'text-short':
    case 'text-long':
      return _escape(raw).replace(/\n/g, '<br>');
    case 'email':
      return `<a href="mailto:${_escape(raw)}">${_escape(raw)}</a>`;
    case 'website':
    case 'url-external':
      return `<a href="${_escape(raw)}" target="_blank" rel="noopener">${_escape(raw)}</a>`;
    case 'chips': {
      const c = (opts.choices || []).find(c => c.id === raw);
      return _escape(c?.label || raw);
    }
    case 'cards': {
      const ids = Array.isArray(raw) ? raw : [];
      return ids.map(id => {
        const c = (opts.choices || []).find(c => c.id === id);
        return _escape(c?.label || id);
      }).join(' · ');
    }
    case 'yes-no':
      if (raw === 'yes') return _escape(opts.yes_label || 'Oui');
      if (raw === 'no')  return _escape(opts.no_label || 'Non');
      return _escape(raw);
    case 'rank-top3': {
      const arr = Array.isArray(raw) ? raw : [];
      const items = arr.filter(Boolean);
      if (items.length === 0) return '';
      return items.map((v, i) => `${i + 1}. ${_escape(v)}`).join(' · ');
    }
    case 'date':
      try {
        return new Date(raw).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      } catch { return _escape(raw); }
    case 'amount': {
      const cur = opts.currency || 'EUR';
      try {
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(Number(raw));
      } catch { return _escape(raw) + ' ' + _escape(cur); }
    }
    case 'social-links': {
      const networks = (opts.networks || []).filter(n => n.enabled);
      const obj = (raw && typeof raw === 'object') ? raw : {};
      const lines = networks
        .map(n => obj[n.id] ? `<strong>${_escape(n.label)}</strong> ${_escape(obj[n.id])}` : null)
        .filter(Boolean);
      return lines.join(' · ');
    }
    case 'signature':
      return `<img src="${_escape(raw)}" alt="Signature" style="max-width:200px;background:#fff;border-radius:4px;padding:4px;border:1px solid rgba(255,255,255,.1)">`;
    case 'nps': {
      const n = Number(raw);
      if (isNaN(n)) return _escape(raw);
      const tier = n <= 6 ? 'Détracteur' : (n <= 8 ? 'Passif' : 'Promoteur');
      return `<strong>${n}/10</strong> <em style="opacity:.7">${_escape(tier)}</em>`;
    }
    case 'slider': {
      const unit = opts.unit ? ' ' + opts.unit : '';
      return `<strong>${_escape(raw)}${_escape(unit)}</strong>`;
    }
    case 'likert': {
      const level = (opts.choices || []).find(c => c.id === raw);
      return _escape(level?.label || raw);
    }
    case 'image-picker': {
      const c = (opts.choices || []).find(c => c.id === raw);
      if (!c) return _escape(raw);
      if (c.image_url) {
        return `<span style="display:inline-flex;align-items:center;gap:6px"><img src="${_escape(c.image_url)}" alt="" style="width:36px;height:27px;object-fit:cover;border-radius:3px;border:1px solid rgba(255,255,255,.1)"><span>${_escape(c.label || raw)}</span></span>`;
      }
      return _escape(c.label || raw);
    }
    case 'repeater': {
      // raw = tableau d'objets { subId: valeur }. On rend chaque item
      // comme un mini-bloc avec ses sous-champs formatés.
      const items = Array.isArray(raw) ? raw : [];
      if (items.length === 0) return '<em style="opacity:.5">aucun élément</em>';
      const subFields = opts.fields || [];
      const itemLabel = opts.item_label || 'Élément';
      return items.map((item, i) => {
        const rows = subFields.map(sf => {
          const v = item?.[sf.id];
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return '';
          return `<div style="margin:2px 0"><span style="color:var(--tx3)">${_escape(sf.label || sf.id)} :</span> ${_formatValueForUI(sf, v)}</div>`;
        }).filter(Boolean).join('');
        return `<div style="margin:6px 0;padding:8px 10px;background:rgba(255,255,255,.03);border-left:2px solid var(--gold,#6366f1);border-radius:4px">
          <div style="font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--gold,#6366f1);margin-bottom:4px">${_escape(itemLabel)} ${i + 1}</div>
          ${rows || '<em style="opacity:.5">vide</em>'}
        </div>`;
      }).join('');
    }
    default:
      return _escape(typeof raw === 'object' ? JSON.stringify(raw) : raw);
  }
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
  // 10 palettes prédéfinies inspirées webgradients.com, réparties en
  // 5 familles (Sobres / Chaleureux / Frais / Bold / Néon). Chaque
  // accent a été choisi pour TRANCHER avec son dégradé, pas pour
  // l'accompagner — on évite ainsi les variations de or sur tous
  // les fonds sombres.
  const presets = [
    // ── Sobres premium (texte blanc lisible) ──────────────
    { family: 'Sobres', name: 'Navy & Or',          gradient: 'linear-gradient(135deg, #0a2741 0%, #1c4870 100%)', color: '#0a2741', accent: '#c9b48a' },
    { family: 'Sobres', name: 'Indigo Pulsa',       gradient: 'linear-gradient(135deg, #131826 0%, #2b3252 100%)', color: '#131826', accent: '#a5b4fc' },
    { family: 'Sobres', name: 'Aurore',             gradient: 'linear-gradient(135deg, #141e30 0%, #5b347a 100%)', color: '#1f1c3d', accent: '#fbbf24' },

    // ── Chaleureux (pour atmosphères estivales / lifestyle) ─
    { family: 'Chaleureux', name: 'Coucher de soleil', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', color: '#fa709a', accent: '#7c2d12' },
    { family: 'Chaleureux', name: "Jus d'orange",      gradient: 'linear-gradient(135deg, #fc6076 0%, #ff9a44 100%)', color: '#fc6076', accent: '#1e1b4b' },

    // ── Frais (turquoise, cyan, vert eau) ─────────────────
    { family: 'Frais', name: 'Malibu',                 gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: '#4facfe', accent: '#9d174d' },
    { family: 'Frais', name: 'Jeune pousse',           gradient: 'linear-gradient(135deg, #9be15d 0%, #00e3ae 100%)', color: '#10b981', accent: '#831843' },

    // ── Bold (saturé, énergie) ───────────────────────────
    { family: 'Bold', name: 'Profondeur',              gradient: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)', color: '#4f46e5', accent: '#fde047' },
    { family: 'Bold', name: 'Violet pop',              gradient: 'linear-gradient(135deg, #b224ef 0%, #7579ff 100%)', color: '#7c3aed', accent: '#22d3ee' },

    // ── Néon (vibrant, événementiel) ─────────────────────
    { family: 'Néon', name: 'Miracle',                 gradient: 'linear-gradient(135deg, #00dbde 0%, #fc00ff 100%)', color: '#a855f7', accent: '#fde047' },
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
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Code d'accès (optionnel)</span>
        <input class="pulsa-input" type="text"
               placeholder="Laissez vide pour un formulaire ouvert"
               data-bind="form.meta.access_code"
               value="${_escape(m.access_code || '')}">
        <span class="pulsa-fld-help-inline">Si défini, les répondants devront saisir ce code avant d'accéder au formulaire. Idéal pour les diagnostics internes ou les questionnaires confidentiels.</span>
      </label>
    </section>

    <section class="pulsa-block">
      <h3 class="pulsa-block-title">Palette</h3>
      <p class="pulsa-block-hint">10 dégradés prêts à l'emploi, regroupés par ambiance. Chaque couleur d'accent a été choisie pour trancher avec son dégradé.</p>
      ${(() => {
        // Regroupement par famille pour une lecture plus claire
        const families = [];
        const byFamily = {};
        for (const p of presets) {
          if (!byFamily[p.family]) {
            byFamily[p.family] = [];
            families.push(p.family);
          }
          byFamily[p.family].push(p);
        }
        return families.map(fam => `
          <div class="pulsa-palette-family">
            <span class="pulsa-palette-family-label">${_escape(fam)}</span>
            <div class="pulsa-palette-grid">
              ${byFamily[fam].map(p => {
                const active = (m.brand_gradient === p.gradient) ||
                  (!m.brand_gradient && m.brand_color === p.color && m.brand_accent === p.accent);
                return `
                  <button class="pulsa-palette-card ${active ? 'is-on' : ''}"
                          data-act="set-brand-preset"
                          data-gradient="${_escape(p.gradient)}"
                          data-color="${p.color}" data-accent="${p.accent}"
                          title="${_escape(p.name)} — accent ${p.accent}">
                    <span class="pulsa-palette-swatches pulsa-palette-swatches-gradient">
                      <span class="pulsa-palette-gradient" style="background:${p.gradient}"></span>
                      <span class="pulsa-palette-accent" style="background:${p.accent}"></span>
                    </span>
                    <span class="pulsa-palette-name">${_escape(p.name)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `).join('');
      })()}

      ${m.brand_gradient ? `
        <div class="pulsa-gradient-active">
          <span class="pulsa-gradient-preview" style="background:${_escape(m.brand_gradient)}"></span>
          <div class="pulsa-gradient-info">
            <span class="pulsa-fld-label">Dégradé actif</span>
            <code class="pulsa-gradient-code">${_escape(m.brand_gradient)}</code>
          </div>
          <button class="pulsa-icon-btn pulsa-icon-btn-danger" data-act="clear-gradient" title="Retirer le dégradé (revenir à une couleur unie)">
            ${icon('x', 14)}
          </button>
        </div>
      ` : ''}

      <div class="pulsa-color-grid">
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">${m.brand_gradient ? 'Couleur de secours (mail, theme iOS)' : 'Couleur principale (fond / header)'}</span>
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
          <span class="pulsa-slug-prefix">/f/</span>
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
               placeholder="Nouvelle réponse — ${_escape(m.title || 'Key Form')}"
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
          <span class="pulsa-recap-label">${f.output?.status === 'published' ? 'URL publique' : 'URL future'}</span>
          <span class="pulsa-recap-value">${f.meta.slug
            ? `${location.host}/f/${_escape(f.meta.slug)}${f.output?.status !== 'published' ? ' <em style="color:var(--pulsa-text-muted, #94a3b8);font-style:normal;font-size:11.5px;">(active après publication)</em>' : ''}`
            : '<em>slug manquant</em>'}</span>
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
        <p>Votre formulaire est prêt à être publié à l'URL <strong>${location.host}/f/${_escape(f.meta.slug)}</strong>. Une fois publié, vous pourrez le partager avec vos répondants et recevoir les réponses par mail.</p>
      </section>
    `}

    <div class="pulsa-publish-cta">
      <button class="pulsa-btn pulsa-btn-primary pulsa-btn-publish ${ready ? '' : 'is-disabled'}"
              data-act="publish-form"
              ${ready ? '' : 'aria-disabled="true"'}>
        ${icon('sparkles', 16)}<span>Publier le formulaire</span>
      </button>
      <p class="pulsa-publish-note">Tant que vous n'avez pas publié, l'URL retourne 404 — c'est normal. Cliquez sur « Publier le formulaire » pour activer la page partageable.</p>
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
 * texte d'aide, requis, largeur, ID technique pour URL params.
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
      <div class="pulsa-fld pulsa-fld-id">
        <span class="pulsa-fld-label">ID technique (pré-remplissage URL)</span>
        <div class="pulsa-fld-id-row">
          <code class="pulsa-fld-id-code">${_escape(field.id)}</code>
          <button class="pulsa-icon-btn" data-act="copy-field-id" data-field="${field.id}" title="Copier l'ID">
            ${icon('copy', 12)}
          </button>
        </div>
        <span class="pulsa-fld-help-inline">Permet de pré-remplir ce champ via l'URL :
          <code>?${_escape(field.id)}=valeur</code></span>
      </div>
    </section>

    ${_editorVisibleIfBlock(sid, field)}
    ${_editorRequiredIfBlock(sid, field)}
  `;
}

/**
 * Bloc "Obligatoire conditionnel" : pattern miroir de visible_if.
 * Le champ devient requis si la condition est satisfaite.
 */
function _editorRequiredIfBlock(sid, field) {
  const rif = field.required_if;
  const others = _otherFields(field.id);

  if (others.length === 0) return '';

  if (!rif) {
    return `
      <section class="pulsa-editor-section">
        <h4 class="pulsa-editor-section-title">Obligatoire conditionnel</h4>
        <p class="pulsa-editor-hint">Rendre ce champ obligatoire uniquement si la réponse à un autre champ correspond à un critère.</p>
        <button class="pulsa-btn pulsa-btn-ghost" data-act="enable-required-if" data-field="${field.id}">
          ${icon('plus', 14)}<span>Ajouter une exigence conditionnelle</span>
        </button>
      </section>
    `;
  }

  const sourceField = others.find(f => f.id === rif.field) || others[0];
  const showValue = !['truthy', 'falsy'].includes(rif.op);
  let valueControl = '';
  if (showValue) {
    if (sourceField?.type === 'chips' || sourceField?.type === 'yes-no') {
      const choices = sourceField.type === 'yes-no'
        ? [{ id: 'yes', label: sourceField.options?.yes_label || 'Oui' },
           { id: 'no',  label: sourceField.options?.no_label  || 'Non' }]
        : (sourceField.options?.choices || []);
      valueControl = `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Valeur attendue</span>
          <select class="pulsa-input" data-bind="field.${sid}.${field.id}.required_if.value">
            <option value="">— Choisir —</option>
            ${choices.map(c => `
              <option value="${_escape(c.id)}" ${String(rif.value) === String(c.id) ? 'selected' : ''}>
                ${_escape(c.label || c.id)}
              </option>
            `).join('')}
          </select>
        </label>
      `;
    } else {
      valueControl = `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Valeur attendue</span>
          <input class="pulsa-input" type="text"
                 placeholder="La valeur exacte à comparer"
                 data-bind="field.${sid}.${field.id}.required_if.value"
                 value="${_escape(rif.value ?? '')}">
        </label>
      `;
    }
  }

  return `
    <section class="pulsa-editor-section pulsa-reqif">
      <h4 class="pulsa-editor-section-title">Obligatoire conditionnel</h4>
      <p class="pulsa-editor-hint">Devient obligatoire si :</p>

      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Champ source</span>
        <select class="pulsa-input" data-bind="field.${sid}.${field.id}.required_if.field">
          ${others.map(f => `
            <option value="${_escape(f.id)}" ${rif.field === f.id ? 'selected' : ''}>
              ${_escape(f.label || f.id)} (${_escape(FIELD_TYPES[f.type]?.label || f.type)})
            </option>
          `).join('')}
        </select>
      </label>

      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Opérateur</span>
        <select class="pulsa-input" data-bind="field.${sid}.${field.id}.required_if.op">
          <option value="eq"     ${rif.op === 'eq'     ? 'selected' : ''}>est égal à</option>
          <option value="neq"    ${rif.op === 'neq'    ? 'selected' : ''}>n'est pas égal à</option>
          <option value="truthy" ${rif.op === 'truthy' ? 'selected' : ''}>est rempli</option>
          <option value="falsy"  ${rif.op === 'falsy'  ? 'selected' : ''}>est vide</option>
        </select>
      </label>

      ${valueControl}

      <button class="pulsa-btn pulsa-btn-ghost pulsa-btn-danger-ghost"
              data-act="disable-required-if" data-field="${field.id}">
        ${icon('x', 14)}<span>Retirer l'exigence conditionnelle</span>
      </button>
    </section>
  `;
}

/**
 * Bloc "Visibilité conditionnelle" : si la condition est définie,
 * affiche les 3 selects (champ source / opérateur / valeur) ;
 * sinon, propose un bouton pour ajouter la condition.
 */
function _editorVisibleIfBlock(sid, field) {
  const vif = field.visible_if;
  const others = _otherFields(field.id);

  if (others.length === 0) {
    return `
      <section class="pulsa-editor-section">
        <h4 class="pulsa-editor-section-title">Visibilité conditionnelle</h4>
        <p class="pulsa-editor-hint">Ajoutez d'abord d'autres champs au formulaire pour pouvoir y conditionner l'affichage de celui-ci.</p>
      </section>
    `;
  }

  if (!vif) {
    return `
      <section class="pulsa-editor-section">
        <h4 class="pulsa-editor-section-title">Visibilité conditionnelle</h4>
        <p class="pulsa-editor-hint">Afficher ce champ uniquement si la réponse à un autre champ correspond à un critère.</p>
        <button class="pulsa-btn pulsa-btn-ghost" data-act="enable-visible-if" data-field="${field.id}">
          ${icon('plus', 14)}<span>Ajouter une condition</span>
        </button>
      </section>
    `;
  }

  const sourceField = others.find(f => f.id === vif.field) || others[0];
  const sourceDef = FIELD_TYPES[sourceField?.type];
  const showValue = !['truthy', 'falsy'].includes(vif.op);

  // Si la source est un chips avec des choix, on offre un select pour la valeur
  // (sinon on garde un input texte libre).
  let valueControl = '';
  if (showValue) {
    if (sourceField?.type === 'chips' || sourceField?.type === 'yes-no') {
      const choices = sourceField.type === 'yes-no'
        ? [{ id: 'yes', label: sourceField.options?.yes_label || 'Oui' },
           { id: 'no',  label: sourceField.options?.no_label  || 'Non' }]
        : (sourceField.options?.choices || []);
      valueControl = `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Valeur attendue</span>
          <select class="pulsa-input" data-bind="field.${sid}.${field.id}.visible_if.value">
            <option value="">— Choisir —</option>
            ${choices.map(c => `
              <option value="${_escape(c.id)}" ${String(vif.value) === String(c.id) ? 'selected' : ''}>
                ${_escape(c.label || c.id)}
              </option>
            `).join('')}
          </select>
        </label>
      `;
    } else {
      valueControl = `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Valeur attendue</span>
          <input class="pulsa-input" type="text"
                 placeholder="La valeur exacte à comparer"
                 data-bind="field.${sid}.${field.id}.visible_if.value"
                 value="${_escape(vif.value ?? '')}">
        </label>
      `;
    }
  }

  return `
    <section class="pulsa-editor-section pulsa-visif">
      <h4 class="pulsa-editor-section-title">Visibilité conditionnelle</h4>
      <p class="pulsa-editor-hint">Ce champ apparaît au répondant uniquement si :</p>

      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Champ source</span>
        <select class="pulsa-input" data-bind="field.${sid}.${field.id}.visible_if.field">
          ${others.map(f => `
            <option value="${_escape(f.id)}" ${vif.field === f.id ? 'selected' : ''}>
              ${_escape(f.label || f.id)} (${_escape(FIELD_TYPES[f.type]?.label || f.type)})
            </option>
          `).join('')}
        </select>
      </label>

      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Opérateur</span>
        <select class="pulsa-input" data-bind="field.${sid}.${field.id}.visible_if.op">
          <option value="eq"     ${vif.op === 'eq'     ? 'selected' : ''}>est égal à</option>
          <option value="neq"    ${vif.op === 'neq'    ? 'selected' : ''}>n'est pas égal à</option>
          <option value="truthy" ${vif.op === 'truthy' ? 'selected' : ''}>est rempli</option>
          <option value="falsy"  ${vif.op === 'falsy'  ? 'selected' : ''}>est vide</option>
        </select>
      </label>

      ${valueControl}

      <button class="pulsa-btn pulsa-btn-ghost pulsa-btn-danger-ghost"
              data-act="disable-visible-if" data-field="${field.id}">
        ${icon('x', 14)}<span>Retirer la condition</span>
      </button>
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
    case 'image-picker': return _editorImagePicker(sid, field);
    case 'yes-no':       return _editorYesNo(sid, field);
    case 'rank-top3':    return _editorRank(sid, field);
    case 'date':         return _editorDate(sid, field);
    case 'amount':       return _editorAmount(sid, field);
    case 'social-links': return _editorSocialLinks(sid, field);
    case 'signature':    return _editorSignature(sid, field);
    case 'nps':          return _editorNps(sid, field);
    case 'slider':       return _editorSlider(sid, field);
    case 'likert':       return _editorLikert(sid, field);
    case 'repeater':     return _editorRepeater(sid, field);
    case 'brief-readonly': return _editorBriefReadonly(sid, field);
    default:             return '';
  }
}

// ── Éditeur : bloc « brief » lecture seule (auto-injecté par Kodex) ──
// Le champ apparaît dans des forms créés depuis Kodex. Le user peut
// ajuster le titre et le texte avant de publier. Bouton d'aide qui
// rappelle l'origine du champ pour ne pas perdre le user qui ne se
// souviendrait pas de l'avoir créé.
function _editorBriefReadonly(sid, field) {
  const o = field.options || {};
  const fid = field.id;
  return `
    <section class="pulsa-editor-section">
      <div class="pulsa-editor-hint" style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;background:var(--ws-accent-soft, rgba(99,102,241,.08));border-radius:8px;font-size:12px;color:var(--ws-text-soft, #64748b);line-height:1.5;margin-bottom:14px;">
        ${icon('sparkles', 13)}
        <span>Ce bloc a été injecté par Kodex à la création du formulaire. Vous pouvez ajuster le titre et le texte avant publication — ou supprimer le bloc.</span>
      </div>

      <label class="pulsa-editor-label">Titre du bloc</label>
      <input class="pulsa-input"
             type="text"
             data-bind="field.${sid}.${fid}.options.heading"
             value="${_escape(o.heading || '')}"
             placeholder="Brief créatif">

      <label class="pulsa-editor-label" style="margin-top:14px;">Contenu du brief</label>
      <textarea class="pulsa-textarea"
                rows="10"
                data-bind="field.${sid}.${fid}.options.brief_text"
                placeholder="Présentation du projet, contraintes techniques, échéance…">${_escape(o.brief_text || '')}</textarea>
    </section>
  `;
}

// ── Éditeur : bloc répétable (repeater) ──────────────────────
function _editorRepeater(sid, field) {
  const o = field.options || {};
  const subs = Array.isArray(o.fields) ? o.fields : [];
  const fid = field.id;
  // Types autorisés comme sous-champs : ceux éditables sans sous-éditeur
  // dédié (les choix/échelles nécessiteraient une UI imbriquée — V2).
  const SUB_TYPES = ['text-short', 'text-long', 'email', 'website', 'url-external', 'amount', 'yes-no', 'date'];
  const typeOpts = SUB_TYPES
    .filter(k => FIELD_TYPES[k])
    .map(k => ({ k, label: FIELD_TYPES[k].label }));

  const subRow = (sf, i) => {
    const base = `field.${sid}.${fid}.options.fields.${i}`;
    const t = sf.type || 'text-short';
    const so = sf.options || {};
    let extra = '';
    if (['text-short', 'text-long', 'email', 'website', 'url-external'].includes(t)) {
      extra += `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Texte d'exemple</span>
          <input class="pulsa-input" type="text" data-bind="${base}.options.placeholder"
                 value="${_escape(so.placeholder || '')}">
        </label>`;
    }
    if (t === 'text-short' || t === 'text-long') {
      extra += `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Signes max</span>
          <input class="pulsa-input" type="number" min="1"
                 data-bind="${base}.options.max_chars"
                 value="${so.max_chars ?? (t === 'text-long' ? 500 : 160)}">
        </label>`;
    }
    if (t === 'amount') {
      extra += `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Devise</span>
          <input class="pulsa-input" type="text" data-bind="${base}.options.currency"
                 value="${_escape(so.currency || 'EUR')}">
        </label>`;
    }
    if (t === 'yes-no') {
      extra += `
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Bouton « Oui »</span>
          <input class="pulsa-input" type="text" data-bind="${base}.options.yes_label"
                 value="${_escape(so.yes_label || 'Oui')}">
        </label>
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Bouton « Non »</span>
          <input class="pulsa-input" type="text" data-bind="${base}.options.no_label"
                 value="${_escape(so.no_label || 'Non')}">
        </label>`;
    }
    return `
      <div class="pulsa-rep-sub">
        <div class="pulsa-rep-sub-head">
          <span class="pulsa-rep-sub-num">${i + 1}</span>
          <input class="pulsa-input" type="text" placeholder="Libellé du sous-champ"
                 data-bind="${base}.label" value="${_escape(sf.label || '')}">
          <button class="pulsa-icon-btn" data-act="rep-move-sub" data-field="${fid}" data-idx="${i}" data-dir="up" title="Monter">↑</button>
          <button class="pulsa-icon-btn" data-act="rep-move-sub" data-field="${fid}" data-idx="${i}" data-dir="down" title="Descendre">↓</button>
          <button class="pulsa-icon-btn pulsa-icon-btn-danger" data-act="rep-del-sub" data-field="${fid}" data-idx="${i}" title="Supprimer">${icon('x', 12)}</button>
        </div>
        <div class="pulsa-rep-sub-body">
          <label class="pulsa-fld">
            <span class="pulsa-fld-label">Type</span>
            <select class="pulsa-input" data-bind="${base}.type">
              ${typeOpts.map(to => `<option value="${to.k}" ${to.k === t ? 'selected' : ''}>${_escape(to.label)}</option>`).join('')}
            </select>
          </label>
          <label class="pulsa-fld">
            <span class="pulsa-fld-label">Largeur</span>
            <select class="pulsa-input" data-bind="${base}.width">
              <option value="full" ${(sf.width || 'full') === 'full' ? 'selected' : ''}>Pleine largeur</option>
              <option value="1/2" ${sf.width === '1/2' ? 'selected' : ''}>Moitié</option>
            </select>
          </label>
          <label class="pulsa-rep-check">
            <input type="checkbox" data-bind="${base}.required" ${sf.required ? 'checked' : ''}>
            <span>Champ obligatoire</span>
          </label>
          <label class="pulsa-fld">
            <span class="pulsa-fld-label">Aide</span>
            <input class="pulsa-input" type="text" data-bind="${base}.help"
                   value="${_escape(sf.help || '')}">
          </label>
          ${extra}
        </div>
      </div>`;
  };

  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Bloc répétable</h4>
      <p class="pulsa-editor-hint">Le répondant duplique ce bloc autant de fois qu'il le souhaite.</p>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Nom d'un élément</span>
        <input class="pulsa-input" type="text" data-bind="field.${sid}.${fid}.options.item_label"
               value="${_escape(o.item_label || 'Élément')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte du bouton d'ajout</span>
        <input class="pulsa-input" type="text" data-bind="field.${sid}.${fid}.options.add_label"
               value="${_escape(o.add_label || 'Ajouter')}">
      </label>
      <div class="pulsa-rep-minmax">
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Minimum</span>
          <input class="pulsa-input" type="number" min="1"
                 data-bind="field.${sid}.${fid}.options.min" value="${o.min ?? 1}">
        </label>
        <label class="pulsa-fld">
          <span class="pulsa-fld-label">Maximum (0 = illimité)</span>
          <input class="pulsa-input" type="number" min="0"
                 data-bind="field.${sid}.${fid}.options.max" value="${o.max ?? 0}">
        </label>
      </div>
    </section>
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Sous-champs (${subs.length})</h4>
      <div class="pulsa-rep-subs">
        ${subs.map(subRow).join('') || '<p class="pulsa-editor-hint">Aucun sous-champ défini.</p>'}
      </div>
      <button class="pulsa-btn pulsa-btn-ghost pulsa-choice-add"
              data-act="rep-add-sub" data-field="${fid}">
        ${icon('plus', 14)}<span>Ajouter un sous-champ</span>
      </button>
    </section>
  `;
}

function _editorSignature(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Options</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Consigne affichée au répondant</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.hint"
               value="${_escape(field.options?.hint || '')}">
      </label>
      <p class="pulsa-editor-hint">La signature est capturée au doigt (mobile/tablette) ou à la souris (desktop) et stockée en SVG inline — pas de fichier serveur.</p>
      <div class="pulsa-editor-hint" style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;background:var(--ws-accent-soft, rgba(99,102,241,.08));border-radius:8px;font-size:12px;line-height:1.5;margin-top:12px;">
        ${icon('file-text', 14)}
        <span><strong>Niveau de certification :</strong> signature électronique <strong>simple</strong>, horodatée, avec empreinte d'intégrité (règlement eIDAS — niveau « simple », non qualifiée). Recevable comme preuve pour la plupart des usages courants. Pour une signature <strong>qualifiée</strong> (équivalent légal du manuscrit), un service certifié dédié serait nécessaire.</span>
      </div>
    </section>
  `;
}

function _editorNps(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Libellés des extrémités</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte sous le « 0 »</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.low_label"
               value="${_escape(field.options?.low_label || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Texte sous le « 10 »</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.high_label"
               value="${_escape(field.options?.high_label || '')}">
      </label>
      <p class="pulsa-editor-hint">11 boutons (0 à 10) gradués rouge → orange → vert. Standard Net Promoter Score.</p>
    </section>
  `;
}

function _editorSlider(sid, field) {
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Bornes du slider</h4>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Valeur minimale</span>
        <input class="pulsa-input" type="number"
               data-bind="field.${sid}.${field.id}.options.min"
               value="${field.options?.min ?? 0}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Valeur maximale</span>
        <input class="pulsa-input" type="number"
               data-bind="field.${sid}.${field.id}.options.max"
               value="${field.options?.max ?? 100}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Pas (incrément)</span>
        <input class="pulsa-input" type="number" min="0.001" step="any"
               data-bind="field.${sid}.${field.id}.options.step"
               value="${field.options?.step ?? 1}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Unité (optionnel : %, m², kg…)</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.unit"
               value="${_escape(field.options?.unit || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Étiquette extrémité gauche</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.low_label"
               value="${_escape(field.options?.low_label || '')}">
      </label>
      <label class="pulsa-fld">
        <span class="pulsa-fld-label">Étiquette extrémité droite</span>
        <input class="pulsa-input" type="text"
               data-bind="field.${sid}.${field.id}.options.high_label"
               value="${_escape(field.options?.high_label || '')}">
      </label>
    </section>
  `;
}

function _editorLikert(sid, field) {
  const levels = field.options?.choices || [];
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Niveaux de l'échelle</h4>
      <p class="pulsa-editor-hint">Modifiez le libellé de chaque niveau (l'ordre est respecté de gauche à droite).</p>
      <div class="pulsa-choices">
        ${levels.map(l => `
          <div class="pulsa-choice">
            <input class="pulsa-input" type="text"
                   data-bind="choice.${sid}.${field.id}.${l.id}.label"
                   value="${_escape(l.label)}">
          </div>
        `).join('')}
      </div>
    </section>
  `;
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

function _editorImagePicker(sid, field) {
  const choices = field.options?.choices || [];
  return `
    <section class="pulsa-editor-section">
      <h4 class="pulsa-editor-section-title">Images proposées</h4>
      <p class="pulsa-editor-hint">Le répondant choisit une image. Collez l'URL d'une image hébergée publiquement (Unsplash, votre CDN, etc.) — pas d'upload serveur.</p>
      <div class="pulsa-choices">
        ${choices.map(c => `
          <div class="pulsa-choice pulsa-choice-img">
            ${c.image_url ? `
              <div class="pulsa-choice-img-preview">
                <img src="${_escape(c.image_url)}" alt=""
                     onerror="this.style.display='none'">
              </div>
            ` : ''}
            <input class="pulsa-input" type="text"
                   placeholder="Libellé sous l'image"
                   data-bind="choice.${sid}.${field.id}.${c.id}.label"
                   value="${_escape(c.label)}">
            <input class="pulsa-input" type="url"
                   placeholder="https://… (URL publique de l'image)"
                   data-bind="choice.${sid}.${field.id}.${c.id}.image_url"
                   value="${_escape(c.image_url || '')}">
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
        ${icon('plus', 14)}<span>Ajouter une image</span>
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
    ${_editorComputeFromBlock(field)}
  `;
}

/**
 * Bloc "Calcul automatique" — uniquement pour les champs amount.
 * Liste les autres champs amount du formulaire et permet de cocher
 * lesquels sont à sommer pour calculer ce champ.
 */
function _editorComputeFromBlock(field) {
  const sources = _otherAmountFields(field.id);
  const isActive = !!field.compute_from;
  const selectedIds = (field.compute_from?.fields || []);

  if (sources.length === 0) {
    return `
      <section class="pulsa-editor-section">
        <h4 class="pulsa-editor-section-title">Calcul automatique</h4>
        <p class="pulsa-editor-hint">Pour activer la somme automatique, créez d'abord d'autres champs Montant dans le formulaire.</p>
      </section>
    `;
  }

  return `
    <section class="pulsa-editor-section ${isActive ? 'pulsa-compute-active' : ''}">
      <h4 class="pulsa-editor-section-title">Calcul automatique</h4>
      <p class="pulsa-editor-hint">Quand activé, ce champ devient en lecture seule et sa valeur est la somme des montants cochés. Idéal pour un "Total" automatique.</p>
      <button class="pulsa-chip ${isActive ? 'is-on' : ''}"
              data-act="toggle-compute" data-field="${field.id}">
        ${isActive ? icon('check', 12) : icon('plus', 12)}
        <span>${isActive ? 'Désactiver le calcul' : 'Activer la somme automatique'}</span>
      </button>
      ${isActive ? `
        <div class="pulsa-compute-sources">
          <p class="pulsa-editor-hint" style="margin-top:8px">Cochez les champs à inclure dans la somme :</p>
          ${sources.map(s => {
            const on = selectedIds.includes(s.id);
            const currency = s.options?.currency || 'EUR';
            return `
              <button class="pulsa-network-toggle ${on ? 'is-on-toggle' : ''}"
                      data-act="toggle-compute-source"
                      data-field="${field.id}" data-source="${s.id}">
                ${on ? icon('check', 12) : icon('plus', 12)}
                <span>${_escape(s.label || s.id)} <em style="opacity:.6;font-style:normal">(${_escape(currency)})</em></span>
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}
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
