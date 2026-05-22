/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact VEFA Studio (O-IMM-010) v1.0
   Sprint VEFA-Studio-1 : Fusion Notice descriptive RE 2020 +
   Contrat de réservation VEFA (Art. L.261-15 CCH) en un seul
   workspace à onglets pill.

   UX :
     · Hero à onglets pill (Notice | Contrat)
     · Bloc « Programme » partagé saisi une seule fois
     · Section spécifique par mode (technique notice / contractuel)
     · Auto-calculs déclaratifs HT/TTC/échéancier/dépôt (Contrat)
     · Génération PDF via doc-engine (Paged.js)
     · Brouillon localStorage + migration legacy O-IMM-001/009
     · Raccourcis : 1 → Notice, 2 → Contrat, Échap → Fermer

   Architecture :
     - Aucune logique métier hardcodée — la notice juridique et les
       clauses contractuelles viennent du backend doc-engine / D1.
     - initComputedFields (mode contrat) branché sur `name=` attrs.
     - CSS injecté une seule fois, scoped .vefa-*.
   ═══════════════════════════════════════════════════════════════ */

import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { ratingButtonHTML, bindRatingButton }  from './lib/rating-widget.js';
import { burgerHTML, bindBurger }              from './lib/topbar-burger.js';
import { icon }                                from './lib/ui-icons.js';
import { docEngine }                           from './lib/doc-engine.js';
import { initComputedFields }                  from './lib/form-computed.js';

// ── Identifiants ──────────────────────────────────────────────
const APP_ID    = 'O-IMM-010';
const DRAFT_KEY = 'ks_vefa_studio_draft_v1';

// ══════════════════════════════════════════════════════════════
// Définition des champs
// ══════════════════════════════════════════════════════════════

// ── Bloc partagé Programme ────────────────────────────────────
const SHARED_FIELDS = [
  { id: 'nom_programme',  label: 'Nom du programme',          type: 'text',   placeholder: 'ex : Les Jardins du Midi',                   required: true, span: 'full' },
  { id: 'type_logement',  label: 'Type de logement',          type: 'select', options: ['T2','T3','T4','T5','Villa','Penthouse'],              required: true },
  { id: 'surface',        label: 'Surface habitable (m²)', type: 'number', placeholder: 'ex : 75',                             required: true },
  { id: 'etage',          label: 'Étage / Situation',    type: 'text',   placeholder: 'ex : 3ème étage, vue dégagée' },
  { id: 'orientation',    label: 'Orientation',               type: 'select', options: ['Sud','Sud-Est','Sud-Ouest','Est','Ouest','Nord-Est','Nord-Ouest','Nord'] },
  { id: 'annexes',        label: 'Annexes (libellé court)', type: 'text', placeholder: 'ex : Cave n°14 + Parking IRVE n°22', span: 'full' },
];

// ── Mode Notice descriptive ───────────────────────────────────
const MODE_NOTICE = {
  id:           'notice',
  label:        'Notice descriptive',
  subtitle:     'Conforme RE 2020 — 2026',
  action_label: 'Générer la notice',
  fields: [
    { id: 'sols',         label: 'Revêtements sols',    type: 'select', options: ['Carrelage grand format','Parquet chêne naturel','Béton ciré','Marbre','Travertin'] },
    { id: 'cuisine',      label: 'Cuisine',                  type: 'select', options: ['Entièrement équipée','Partiellement équipée (attentes)','Non équipée'] },
    { id: 'chauffage',    label: 'Mode de chauffage',        type: 'select', options: ['PAC collective','PAC individuelle','Réseau de chaleur urbain (CPCU)','Plancher chauffant électrique','Pompe à chaleur air/air'], required: true },
    { id: 're2020',       label: 'Conformité RE 2020', type: 'select', options: ['Seuil 2025 (IC construction ≤ 490 kgCO₂eq/m²)','Seuil 2028 (IC construction ≤ 415 kgCO₂eq/m²)','Seuil 2031 (Objectif bas carbone)'], required: true },
    { id: 'confort_ete',  label: 'Confort d\'été', type: 'select', options: ['Brise-soleil orientables (BSO)','Volets roulants motorisés','Double vitrage à contrôle solaire','BSO + Volets motorisés','Sans dispositif spécifique'] },
    { id: 'isolation',    label: 'Type d\'isolation',        type: 'select', options: ['Biosourcée (laine de bois, chanvre, ouate)','Synthétique (PSE, laine de verre)','Mixte biosourcée + synthétique','ITI béton banché renforcé'] },
    { id: 'specificites', label: 'Spécificités & équipements', type: 'textarea', placeholder: 'Terrasse, domotique, VMC double flux, loggia…', span: 'full' },
  ],
  computed_fields: [],
  templateId: 'vefa-notice-v1',
  variable_map: {
    PROGRAMME:         'nom_programme',
    TYPE_LOT:          'type_logement',
    SURFACE:           'surface',
    ETAGE:             'etage',
    ORIENTATION:       'orientation',
    ANNEXES:           'annexes',
    SOLS:              'sols',
    CUISINE:           'cuisine',
    CHAUFFAGE:         'chauffage',
    CONFORT_ETE:       'confort_ete',
    ISOLATION:         'isolation',
    SPECIFICITES_BLOC: 'specificites',
  },
};

// ── Mode Contrat de réservation ───────────────────────────────
const MODE_CONTRAT = {
  id:           'contrat',
  label:        'Contrat de réservation',
  subtitle:     'Art. L.261-15 CCH',
  action_label: 'Générer le contrat',
  fields: [
    { id: 'adresse_programme',       label: 'Adresse du programme',              type: 'text',   placeholder: 'ex : 12 avenue des Lauriers, 83110 Sanary', span: 'full' },
    { id: 'lot_numero',              label: 'Numéro de lot',                type: 'text',   placeholder: 'ex : A-203', required: true },
    { id: 'surface_carrez',          label: 'Surface Loi Carrez (m²)',      type: 'number', placeholder: 'ex : 72.4', required: true },
    { id: 'cadastre',                label: 'Référence cadastrale',    type: 'text',   placeholder: 'ex : Section AB n°123' },
    { id: 'quote_parts',             label: 'Quote-parts copropriété', type: 'text',   placeholder: 'ex : 285 / 10 000' },
    { id: 'ville',                   label: 'Ville',                             type: 'text',   placeholder: 'ex : Sanary' },
    { id: 'departement',             label: 'Département',                  type: 'text',   placeholder: 'ex : Var (83)' },
    { id: 'region',                  label: 'Région',                       type: 'select', options: ["Provence-Alpes-Côte d'Azur","Occitanie","Nouvelle-Aquitaine","Île-de-France","Auvergne-Rhône-Alpes","Bretagne","Pays de la Loire","Hauts-de-France","Grand Est","Bourgogne-Franche-Comté","Normandie","Centre-Val de Loire","Corse","DOM-TOM"] },

    { id: 'vendeur_nom',             label: 'Vendeur — Raison sociale',    type: 'text',   placeholder: 'ex : SCCV Les Jardins du Midi', required: true, span: 'full' },
    { id: 'vendeur_siren',           label: 'SIREN',                             type: 'text',   placeholder: 'ex : 123 456 789' },
    { id: 'vendeur_rcs',             label: 'RCS',                               type: 'text',   placeholder: 'ex : Toulon B 123 456 789' },
    { id: 'vendeur_capital',         label: 'Capital social',                    type: 'text',   placeholder: 'ex : 1 000 €' },
    { id: 'vendeur_siege',           label: 'Siège social',                 type: 'text',   placeholder: 'ex : 5 rue Hoche, 83000 Toulon', span: 'full' },
    { id: 'vendeur_representant',    label: 'Représenté par',          type: 'text',   placeholder: 'ex : M. Jean DUPONT, gérant' },

    { id: 'acquereur_nom',           label: 'Acquéreur — Nom & prénom', type: 'text', placeholder: 'ex : Mme Sophie MARTIN', required: true, span: 'full' },
    { id: 'acquereur_civilite',      label: 'Civilité / Profession',        type: 'text',   placeholder: 'ex : Mme, cadre' },
    { id: 'acquereur_naissance',     label: 'Date de naissance',                 type: 'text',   placeholder: 'ex : 14/03/1985' },
    { id: 'acquereur_lieu_naissance',label: 'Lieu de naissance',                 type: 'text',   placeholder: 'ex : Marseille (13)' },
    { id: 'acquereur_adresse',       label: 'Adresse',                           type: 'text',   placeholder: 'ex : 22 rue de la République, 13001 Marseille', span: 'full' },
    { id: 'acquereur_regime',        label: 'Régime matrimonial',           type: 'select', options: ['Célibataire','Marié(e) — communauté légale','Marié(e) — séparation de biens','Marié(e) — participation aux acquêts','Pacsé(e) — indivision','Pacsé(e) — séparation','Divorcé(e)','Veuf / Veuve'] },

    { id: 'prix_ht',                 label: 'Prix HT (€)',                  type: 'number', placeholder: 'ex : 233 333', required: true },
    { id: 'prix_ttc',                label: 'Prix TTC (€)',                 type: 'number', placeholder: 'ex : 280 000', required: true },
    { id: 'tva_taux',                label: 'Taux de TVA',                       type: 'select', options: ['20 %','5,5 % (zone ANRU / PSLA)','10 %'] },
    { id: 'tva_montant',             label: 'Montant TVA (€)',              type: 'number', placeholder: 'ex : 46 667' },
    { id: 'repartition_foncier_bati',label: 'Répartition foncier / bâti', type: 'text', placeholder: 'ex : 25 % foncier — 75 % bâti', span: 'full' },
    { id: 'ech_fondations',          label: 'Échéance — Fondations (35 %)',  type: 'number', placeholder: 'ex : 98 000' },
    { id: 'ech_hors_eau',            label: 'Échéance — Hors d\'eau (70 %)', type: 'number', placeholder: 'ex : 196 000' },
    { id: 'ech_achevement',          label: 'Échéance — Achèvement (95 %)', type: 'number', placeholder: 'ex : 266 000' },

    { id: 'depot_montant',           label: 'Dépôt — Montant (€)',        type: 'number', placeholder: 'ex : 14 000', required: true },
    { id: 'depot_montant_lettres',   label: 'Dépôt — Montant en lettres',     type: 'text',   placeholder: 'ex : quatorze mille euros' },
    { id: 'depot_pourcentage',       label: 'Dépôt — Pourcentage',            type: 'select', options: ['5 % (livraison < 1 an)','2 % (livraison < 2 ans)','0 % (livraison > 2 ans)'], required: true },
    { id: 'depot_plafond_legal',     label: 'Plafond légal applicable',                 type: 'text',   placeholder: 'ex : Art. R.261-28 CCH — 5 % max si livraison < 1 an' },
    { id: 'depot_mode_versement',    label: 'Mode de versement',                             type: 'select', options: ['Virement bancaire','Chèque de banque'] },
    { id: 'sequestre_etablissement', label: 'Séquestre — Établissement',      type: 'text',   placeholder: 'ex : Étude Maître Dupont, Toulon' },
    { id: 'sequestre_compte',        label: 'Séquestre — Référence compte', type: 'text', placeholder: 'ex : Compte CARPA n°…' },

    { id: 'pret_montant',            label: 'Prêt — Montant sollicité (€)', type: 'number', placeholder: 'ex : 224 000' },
    { id: 'pret_taux_max',           label: 'Prêt — Taux maximum (%)',              type: 'number', placeholder: 'ex : 4.5' },
    { id: 'pret_duree_max',          label: 'Prêt — Durée maximum (ans)',      type: 'number', placeholder: 'ex : 25' },
    { id: 'pret_delai',              label: 'Prêt — Délai d\'obtention (jours)', type: 'number', placeholder: 'ex : 45' },

    { id: 'livraison',               label: 'Date de livraison prévisionnelle', type: 'text', placeholder: 'ex : T4 2027' },
    { id: 'date_acte_authentique',   label: 'Date prévue acte authentique',    type: 'text', placeholder: 'ex : 30/09/2026' },
    { id: 'penalites_retard',        label: 'Pénalités de retard',        type: 'text', placeholder: 'ex : 1/3000ème du prix par jour de retard', span: 'full' },
    { id: 'notaire',                 label: 'Notaire instrumentaire',               type: 'text', placeholder: 'ex : Étude Maître Dupont, Toulon', span: 'full' },
    { id: 'lieu_signature',          label: 'Lieu de signature',                    type: 'text', placeholder: 'ex : Toulon' },
    { id: 'date_signature',          label: 'Date de signature',                    type: 'text', placeholder: 'ex : 11/05/2026' },
    { id: 'nb_exemplaires',          label: 'Nombre d\'exemplaires',                type: 'number', placeholder: 'ex : 3' },
    {
      id:          'clauses_particulieres',
      label:       'Clauses particulières & adaptations',
      type:        'textarea',
      placeholder: 'Modifications spécifiques au cas d\'espèce, options retenues, prestations sur mesure, conditions négociées…',
      span:        'full',
    },
  ],
  computed_fields: [
    { to: 'prix_ttc',              recipe: 'tva-multiply',              from: ['prix_ht',   'tva_taux'] },
    { to: 'prix_ht',               recipe: 'tva-divide',                from: ['prix_ttc',  'tva_taux'] },
    { to: 'tva_montant',           recipe: 'tva-amount',                from: ['prix_ht',   'tva_taux'] },
    { to: 'ech_fondations',        recipe: 'percent',                   from: ['prix_ttc'], factor: 0.35 },
    { to: 'ech_hors_eau',          recipe: 'percent',                   from: ['prix_ttc'], factor: 0.70 },
    { to: 'ech_achevement',        recipe: 'percent',                   from: ['prix_ttc'], factor: 0.95 },
    { to: 'depot_montant',         recipe: 'percent-from-select',       from: ['prix_ttc',  'depot_pourcentage'] },
    { to: 'depot_montant_lettres', recipe: 'number-to-french-words-eur',from: ['depot_montant'] },
  ],
  templateId: 'vefa-contrat-v1',
  variable_map: {
    PROGRAMME:               'nom_programme',
    ADRESSE_PROGRAMME:       'adresse_programme',
    LOT_NUMERO:              'lot_numero',
    TYPE_LOT:                'type_logement',
    SURFACE:                 'surface',
    SURFACE_CARREZ:          'surface_carrez',
    ETAGE:                   'etage',
    ORIENTATION:             'orientation',
    ANNEXES:                 'annexes',
    CADASTRE:                'cadastre',
    QUOTE_PARTS:             'quote_parts',
    DEPARTEMENT:             'departement',
    REGION:                  'region',
    NOTAIRE:                 'notaire',
    LIVRAISON:               'livraison',
    DATE_ACTE_AUTHENTIQUE:   'date_acte_authentique',
    VENDEUR_NOM:             'vendeur_nom',
    VENDEUR_SIREN:           'vendeur_siren',
    VENDEUR_RCS:             'vendeur_rcs',
    VENDEUR_CAPITAL:         'vendeur_capital',
    VENDEUR_SIEGE:           'vendeur_siege',
    VENDEUR_REPRESENTANT:    'vendeur_representant',
    ACQUEREUR_NOM:           'acquereur_nom',
    ACQUEREUR_CIVILITE:      'acquereur_civilite',
    ACQUEREUR_NAISSANCE:     'acquereur_naissance',
    ACQUEREUR_LIEU_NAISSANCE:'acquereur_lieu_naissance',
    ACQUEREUR_ADRESSE:       'acquereur_adresse',
    ACQUEREUR_REGIME:        'acquereur_regime',
    PRIX_HT:                 'prix_ht',
    PRIX_TTC:                'prix_ttc',
    TVA_TAUX:                'tva_taux',
    TVA_MONTANT:             'tva_montant',
    REPARTITION_FONCIER_BATI:'repartition_foncier_bati',
    ECH_FONDATIONS:          'ech_fondations',
    ECH_HORS_EAU:            'ech_hors_eau',
    ECH_ACHEVEMENT:          'ech_achevement',
    DEPOT_MONTANT:           'depot_montant',
    DEPOT_MONTANT_LETTRES:   'depot_montant_lettres',
    DEPOT_POURCENTAGE:       'depot_pourcentage',
    DEPOT_PLAFOND_LEGAL:     'depot_plafond_legal',
    DEPOT_MODE_VERSEMENT:    'depot_mode_versement',
    SEQUESTRE_ETABLISSEMENT: 'sequestre_etablissement',
    SEQUESTRE_COMPTE:        'sequestre_compte',
    PRET_MONTANT:            'pret_montant',
    PRET_TAUX_MAX:           'pret_taux_max',
    PRET_DUREE_MAX:          'pret_duree_max',
    PRET_DELAI:              'pret_delai',
    PENALITES_RETARD:        'penalites_retard',
    LIEU_SIGNATURE:          'lieu_signature',
    DATE_SIGNATURE:          'date_signature',
    NB_EXEMPLAIRES:          'nb_exemplaires',
    CLAUSES_PARTICULIERES_BLOC: 'clauses_particulieres',
  },
};

const MODES = { notice: MODE_NOTICE, contrat: MODE_CONTRAT };

// ══════════════════════════════════════════════════════════════
// État global
// ══════════════════════════════════════════════════════════════
let _root            = null;
let _currentMode     = 'notice';
let _formData        = {};
let _cleanupComputed = null;
let _stylesInjected  = false;
let _saveTimer       = null;
let _toastTimer      = null;

// ══════════════════════════════════════════════════════════════
// Persistance — Brouillon localStorage
// ══════════════════════════════════════════════════════════════

function _saveDraft() {
  _collectFormData();
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: _currentMode, data: _formData }));
    import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
  } catch (_) {}
}

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveDraft, 600);
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      _currentMode = MODES[saved.mode] ? saved.mode : 'notice';
      _formData    = saved.data || {};
      return true;
    }
  } catch (_) {}
  // Aucun brouillon propre → tenter la migration depuis O-IMM-001/009
  const legacy = _readLegacyDrafts();
  if (legacy) {
    _formData = legacy;
    return true;
  }
  return false;
}

/**
 * Récupère et fusionne les saisies des anciens pads Notice (O-IMM-001)
 * et Contrat (O-IMM-009) pour pré-remplir VEFA Studio au premier
 * lancement (migration transparente, aucune donnée détruite).
 */
function _readLegacyDrafts() {
  const merged = {};
  try {
    const allDrafts = JSON.parse(localStorage.getItem('ks_pads_drafts') || 'null');
    if (allDrafts?.['O-IMM-001']) Object.assign(merged, allDrafts['O-IMM-001']);
    if (allDrafts?.['O-IMM-009']) Object.assign(merged, allDrafts['O-IMM-009']);
    const d1 = JSON.parse(localStorage.getItem('ks_pad_draft_O-IMM-001') || 'null');
    if (d1) Object.assign(merged, d1);
    const d9 = JSON.parse(localStorage.getItem('ks_pad_draft_O-IMM-009') || 'null');
    if (d9) Object.assign(merged, d9);
  } catch (_) {}
  return Object.keys(merged).length > 0 ? merged : null;
}

// ══════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════

export function openVefaStudio() {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeVefaStudio() {
  if (!_root) return;
  _saveDraft();
  if (_cleanupComputed) { _cleanupComputed(); _cleanupComputed = null; }
  document.removeEventListener('keydown', _handleKeyDown);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════
// Shell
// ══════════════════════════════════════════════════════════════

function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('vefa', 24)}</span>
        <span class="name">VEFA Studio</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer">
          ${icon('refresh', 18)}
        </button>
      </div>
    </header>

    <div class="ws-body">
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);

  _root.addEventListener('click',  _onClick);
  _root.addEventListener('input',  _onInput);
  _root.addEventListener('change', _onInput);
  document.addEventListener('keydown', _handleKeyDown);

  bindRatingButton(_root, APP_ID);
  bindHelpButton(_root, APP_ID);
  bindBurger(_root);
}

// ══════════════════════════════════════════════════════════════
// Rendu principal
// ══════════════════════════════════════════════════════════════

function _renderMain(scrollToTop) {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const prevScroll = scrollToTop ? 0 : main.scrollTop;
  const mode = MODES[_currentMode];

  main.innerHTML = `
    <div class="ws-main-inner vefa-wrap">
      ${_renderHero()}
      <form class="vefa-form" autocomplete="off" novalidate>

        <div class="vefa-section">
          <div class="vefa-section-header">
            <div class="vefa-section-title">Programme</div>
            <div class="vefa-section-subtitle">Saisi une seule fois — alimente les deux documents</div>
          </div>
          <div class="vefa-fields">
            ${SHARED_FIELDS.map(_renderField).join('')}
          </div>
        </div>

        <div class="vefa-section">
          <div class="vefa-section-header">
            <div class="vefa-section-title">${_esc(_currentMode === 'notice' ? 'Caractéristiques techniques' : 'Lot, Vendeur, Acquéreur, Prix')}</div>
            <div class="vefa-section-subtitle">${_esc(mode.subtitle)}</div>
          </div>
          <div class="vefa-fields">
            ${mode.fields.map(_renderField).join('')}
          </div>
        </div>

        <div class="vefa-actions">
          <p class="vefa-actions-hint">
            ${icon('sparkles', 13)}&nbsp;Document indicatif —
            ${_currentMode === 'contrat'
              ? 'validation notariale impérative avant signature.'
              : 'compléter selon les spécificités du programme.'}
          </p>
          <button class="vefa-btn-primary" data-act="generate" type="button">
            ${icon('file-text', 18)}&nbsp;${_esc(mode.action_label)}
          </button>
        </div>

      </form>
    </div>
  `;

  main.scrollTop = prevScroll;
  _restoreFormData();
  _wireForm();
}

function _renderHero() {
  return `
    <div class="vefa-hero">
      <div class="vefa-hero-eyebrow">
        ${icon('vefa', 13)}&nbsp;Notice + Contrat — un seul lot, deux livrables
      </div>
      <nav class="vefa-tabs" aria-label="Mode de document" role="tablist">
        <button class="vefa-tab${_currentMode === 'notice'  ? ' is-active' : ''}"
                data-act="switch-mode" data-mode="notice"
                type="button" role="tab"
                aria-selected="${_currentMode === 'notice'}"
                title="Raccourci clavier : touche 1">
          ${icon('file-text', 14)}&nbsp;Notice descriptive
        </button>
        <button class="vefa-tab${_currentMode === 'contrat' ? ' is-active' : ''}"
                data-act="switch-mode" data-mode="contrat"
                type="button" role="tab"
                aria-selected="${_currentMode === 'contrat'}"
                title="Raccourci clavier : touche 2">
          ${icon('edit', 14)}&nbsp;Contrat de réservation
        </button>
      </nav>
      <p class="vefa-hero-subtitle">${_esc(MODES[_currentMode].subtitle)}</p>
    </div>`;
}

function _renderField(field) {
  const span   = field.span === 'full' ? ' style="grid-column:1/-1"' : '';
  const req    = field.required ? ' <span class="vefa-req" aria-hidden="true">*</span>' : '';
  const rawVal = String(_formData[field.id] != null ? _formData[field.id] : '');
  const val    = _esc(rawVal);

  let input;
  if (field.type === 'textarea') {
    input = `<textarea class="ws-input ws-textarea"
      name="${_esc(field.id)}" data-field="${_esc(field.id)}"
      placeholder="${_esc(field.placeholder || '')}"
      rows="3">${val}</textarea>`;

  } else if (field.type === 'select') {
    const opts = (field.options || []).map(o => {
      const ov = _esc(o);
      return `<option value="${ov}"${rawVal === o ? ' selected' : ''}>${ov}</option>`;
    }).join('');
    input = `<select class="ws-input ws-select" name="${_esc(field.id)}" data-field="${_esc(field.id)}">
      <option value="">— choisir —</option>
      ${opts}
    </select>`;

  } else {
    const typeAttr = field.type === 'number' ? 'number' : 'text';
    input = `<input class="ws-input"
      type="${typeAttr}"
      name="${_esc(field.id)}" data-field="${_esc(field.id)}"
      placeholder="${_esc(field.placeholder || '')}"
      value="${val}"${field.type === 'number' ? ' step="any" min="0"' : ''}>`;
  }

  return `
    <div class="vefa-field"${span}>
      <label class="ws-label">${_esc(field.label)}${req}</label>
      ${input}
    </div>`;
}

// ── Restauration et câblage ───────────────────────────────────

function _restoreFormData() {
  const form = _root && _root.querySelector('.vefa-form');
  if (!form) return;
  for (const [key, val] of Object.entries(_formData)) {
    if (val == null || val === '') continue;
    const el = form.querySelector(`[name="${key}"]`);
    if (el) el.value = String(val);
  }
}

function _collectFormData() {
  const form = _root && _root.querySelector('.vefa-form');
  if (!form) return;
  form.querySelectorAll('[name]').forEach(el => {
    if (el.name) _formData[el.name] = el.value;
  });
}

/**
 * (Re)branche initComputedFields sur le formulaire courant.
 * Appelé après chaque _renderMain. Actif uniquement en mode Contrat
 * car les auto-calculs (HT/TTC, échéancier, dépôt en lettres) ne
 * concernent que la partie contractuelle.
 */
function _wireForm() {
  if (_cleanupComputed) { _cleanupComputed(); _cleanupComputed = null; }
  if (_currentMode !== 'contrat') return;
  const form = _root && _root.querySelector('.vefa-form');
  if (!form) return;
  // MODE_CONTRAT.computed_fields est lu par initComputedFields via pad.computed_fields.
  _cleanupComputed = initComputedFields(form, MODE_CONTRAT);
}

// ══════════════════════════════════════════════════════════════
// Délégation d'événements
// ══════════════════════════════════════════════════════════════

function _onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'close') { closeVefaStudio(); return; }
  if (act === 'save')  { _saveDraft(); _toast('Brouillon sauvegardé'); return; }
  if (act === 'reset') {
    if (confirm('Effacer tout votre brouillon VEFA Studio et recommencer ?')) {
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      _formData    = {};
      _currentMode = 'notice';
      _renderMain(true);
      _toast('Brouillon réinitialisé');
    }
    return;
  }
  if (act === 'switch-mode') { _switchMode(btn.dataset.mode); return; }
  if (act === 'generate')    { _generate(); return; }
}

function _onInput(e) {
  const el = e.target;
  const fieldId = (el.dataset && el.dataset.field) || el.name;
  if (!fieldId) return;
  _formData[fieldId] = el.value;
  _scheduleSave();
}

/**
 * Raccourcis globaux (actifs uniquement hors champ de saisie).
 *   1 → Notice descriptive
 *   2 → Contrat de réservation
 *   Échap → Fermer VEFA Studio
 */
function _handleKeyDown(e) {
  if (!_root) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') { closeVefaStudio(); return; }
  if ((e.key === '1') && !e.ctrlKey && !e.metaKey) { _switchMode('notice');  return; }
  if ((e.key === '2') && !e.ctrlKey && !e.metaKey) { _switchMode('contrat'); return; }
}

// ══════════════════════════════════════════════════════════════
// Actions métier
// ══════════════════════════════════════════════════════════════

function _switchMode(mode) {
  if (!MODES[mode] || mode === _currentMode) return;
  _collectFormData();                                            // snapshot avant destroy
  if (_cleanupComputed) { _cleanupComputed(); _cleanupComputed = null; }
  _currentMode = mode;
  _renderMain(true);                                             // scroll to top
}

async function _generate() {
  _collectFormData();
  const mode = MODES[_currentMode];

  // ── Validation des champs requis ──
  const allRequired = [
    ...SHARED_FIELDS.filter(f => f.required),
    ...mode.fields.filter(f => f.required),
  ];
  const missing = allRequired.filter(f => {
    const v = _formData[f.id];
    return v == null || String(v).trim() === '';
  });

  if (missing.length > 0) {
    const labels = missing.map(f => f.label).join(', ');
    _toast(`Champs requis manquants : ${labels}`, true);
    // Highlight visuel temporaire
    const form = _root && _root.querySelector('.vefa-form');
    if (form) {
      missing.forEach(f => {
        const el = form.querySelector(`[name="${f.id}"]`);
        if (el) el.classList.add('vefa-input-error');
      });
      setTimeout(() => {
        if (form) form.querySelectorAll('.vefa-input-error').forEach(el => el.classList.remove('vefa-input-error'));
      }, 3000);
    }
    return;
  }

  // ── Construction des variables pour le template ──
  const variables = {};
  for (const [varKey, fieldId] of Object.entries(mode.variable_map)) {
    variables[varKey] = String(_formData[fieldId] != null ? _formData[fieldId] : '');
  }
  // Variables auto-injectées (référence, date, version)
  variables.DATE_EDITION = new Date().toLocaleDateString('fr-FR');
  variables.REF_DOCUMENT = 'VS-' + Date.now().toString(36).toUpperCase();
  variables.VERSION_DOC  = '1.0';

  _saveDraft();
  _toast('Génération en cours…');

  try {
    await docEngine.render({ templateId: mode.templateId, variables, mode: 'preview' });
  } catch (err) {
    console.error('[VefaStudio] docEngine.render', err);
    _toast('Erreur de génération : ' + ((err && err.message) || 'inconnue'), true);
  }
}

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function _toast(msg, isError) {
  if (!_root) return;
  let toast = _root.querySelector('.vefa-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'vefa-toast';
    _root.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'vefa-toast' + (isError ? ' vefa-toast--error' : '') + ' is-visible';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (toast) toast.classList.remove('is-visible'); }, 3200);
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════
// CSS — injection idempotente, scoped .vefa-*
// ══════════════════════════════════════════════════════════════

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'vefa-studio-styles';
  style.textContent = `
/* ── VEFA Studio — styles privés (ne pas modifier workspace.css) ── */

/* Conteneur centré */
.vefa-wrap {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 24px 100px;
  box-sizing: border-box;
}

/* ── Hero / Onglets pill ── */
.vefa-hero {
  padding: 32px 0 24px;
  border-bottom: 1px solid var(--ws-border);
  margin-bottom: 28px;
}
.vefa-hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: .045em;
  text-transform: uppercase;
  color: var(--ws-text-muted);
  margin-bottom: 14px;
}
.vefa-tabs {
  display: inline-flex;
  gap: 3px;
  background: var(--ws-surface);
  padding: 4px;
  border-radius: var(--ws-radius-pill);
  border: 1px solid var(--ws-border);
}
.vefa-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--ws-radius-pill);
  border: none;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -.012em;
  font-family: inherit;
  background: transparent;
  color: var(--ws-text-muted);
  transition: background 180ms ease, color 180ms ease, box-shadow 180ms ease;
  white-space: nowrap;
}
.vefa-tab.is-active {
  background: var(--ws-accent);
  color: #fff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, .4);
}
.vefa-tab:not(.is-active):hover {
  background: var(--ws-surface-soft, rgba(255,255,255,.04));
  color: var(--ws-text);
}
.vefa-hero-subtitle {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--ws-text-muted);
  letter-spacing: -.005em;
}

/* ── Sections ── */
.vefa-section {
  background: var(--ws-surface);
  border: 1px solid var(--ws-border);
  border-radius: 14px;
  padding: 24px 28px;
  margin-bottom: 20px;
}
.vefa-section-header { margin-bottom: 18px; }
.vefa-section-title {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -.02em;
  color: var(--ws-text);
}
.vefa-section-subtitle {
  font-size: 12px;
  color: var(--ws-text-muted);
  margin-top: 3px;
  letter-spacing: -.005em;
}

/* ── Grille de champs ── */
.vefa-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 20px;
}
.vefa-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.vefa-req {
  color: var(--ws-danger, #f85149);
  margin-left: 2px;
}

/* Feedback d'erreur sur les champs requis manquants */
.ws-input.vefa-input-error,
.ws-select.vefa-input-error {
  border-color: var(--ws-danger, #f85149) !important;
  box-shadow: 0 0 0 3px rgba(248, 81, 73, .15) !important;
}

/* ── Footer actions ── */
.vefa-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 0 0;
  margin-top: 4px;
  border-top: 1px solid var(--ws-border);
}
.vefa-actions-hint {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  margin: 0;
  font-size: 12px;
  color: var(--ws-text-muted);
  line-height: 1.5;
  max-width: 55%;
  flex-shrink: 1;
}
.vefa-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 12px 28px;
  border-radius: var(--ws-radius-pill);
  border: none;
  cursor: pointer;
  background: var(--ws-accent);
  color: #fff;
  font-size: 14.5px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: -.015em;
  box-shadow: 0 2px 14px rgba(99, 102, 241, .4);
  transition: box-shadow 180ms ease, transform 120ms ease;
}
.vefa-btn-primary:hover {
  box-shadow: 0 4px 22px rgba(99, 102, 241, .55);
  transform: translateY(-1px);
}
.vefa-btn-primary:active { transform: translateY(0); }

/* ── Toast de feedback ── */
.vefa-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: #1e293b;
  color: #f1f5f9;
  padding: 10px 24px;
  border-radius: var(--ws-radius-pill);
  font-size: 13.5px;
  font-weight: 500;
  letter-spacing: -.005em;
  box-shadow: 0 4px 20px rgba(0, 0, 0, .3);
  opacity: 0;
  transition: opacity 220ms ease, transform 220ms ease;
  pointer-events: none;
  z-index: 9999;
  white-space: nowrap;
}
.vefa-toast.is-visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.vefa-toast--error { background: #b91c1c; color: #fff; }

/* ── Responsive (≤ 640 px) ── */
@media (max-width: 640px) {
  .vefa-wrap { padding: 0 16px 80px; }
  .vefa-fields { grid-template-columns: 1fr; }
  .vefa-field[style*="grid-column"] { grid-column: auto !important; }
  .vefa-tab { padding: 7px 14px; font-size: 12.5px; }
  .vefa-actions { flex-direction: column; align-items: stretch; }
  .vefa-actions-hint { max-width: 100%; }
  .vefa-btn-primary { justify-content: center; }
  .vefa-section { padding: 18px 16px; }
}
`;
  document.head.appendChild(style);
}
