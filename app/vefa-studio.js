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
// GW-integration 2026-05-24 : bouton ✦ inline Pad-Aware sur les
// champs déclarant `ghostwriter:` (pattern Annonces Immo validé 23/05).
import { openGhostwriterInline }               from './lib/ghostwriter-inline.js';
// Concierge S6 : forme « à plat » programme (source de vérité PURE,
// alignée sur vefaProgramToBlock côté Worker). Cf. lib/concierge-program.js.
import {
  blankProgram, blankLot, coerceProgram, validateProgramLight,
  LOT_STATUTS, PROGRAM_STORAGE_KEY,
  vefaDocToLot, vefaDocToProgramHeader, fillProgramHeaderIfEmpty, upsertLot,
  listConciergeQRs,
}                                                from './lib/concierge-program.js';
import { CF_API, getOwnedIds, isAdminUser, getLifetimeIds } from './pads-loader.js';
import { renderQrCustom }                        from './sdqr-render.js';

// ── Identifiants ──────────────────────────────────────────────
const APP_ID    = 'O-IMM-010';
const DRAFT_KEY = 'ks_vefa_studio_draft_v1';
const MAX_QUESTIONS = 6;
const SDQR_PAD_ID = 'A-COM-001';   // Smart Dynamic QR — Pad qui héberge le Concierge

// ══════════════════════════════════════════════════════════════
// Définition des champs
// ══════════════════════════════════════════════════════════════

// ── Bloc partagé Programme ────────────────────────────────────
const SHARED_FIELDS = [
  { id: 'nom_programme',  label: 'Nom du programme',          type: 'text',   placeholder: 'ex : Les Jardins du Midi',                   required: true, span: 'full' },
  { id: 'type_logement',  label: 'Type de logement',          type: 'select', options: ['T2','T3','T4','T5','Villa','Penthouse'],              required: true },
  { id: 'surface',        label: 'Surface habitable (m²)', type: 'number', placeholder: 'ex : 75',                             required: true },
  { id: 'etage',          label: 'Étage / Situation',    type: 'text',   placeholder: 'ex : 3ème étage, vue dégagée' },
  { id: 'orientation',    label: 'Orientation',               type: 'select', options: ['Sud','Sud-Est','Sud-Ouest','Est','Ouest','Nord-Est','Nord-Ouest','Nord'] },
  { id: 'annexes',        label: 'Annexes (libellé court)', type: 'text', placeholder: 'ex : Cave n°14 + Parking IRVE n°22', span: 'full' },
];

// ── Mode Notice descriptive ───────────────────────────────────
const MODE_NOTICE = {
  id:           'notice',
  label:        'Notice descriptive',
  subtitle:     'Conforme RE 2020 — 2026',
  action_label: 'Générer la notice',
  fields: [
    { id: 'sols',         label: 'Revêtements sols',    type: 'select', options: ['Carrelage grand format','Parquet chêne naturel','Béton ciré','Marbre','Travertin'] },
    { id: 'cuisine',      label: 'Cuisine',                  type: 'select', options: ['Entièrement équipée','Partiellement équipée (attentes)','Non équipée'] },
    { id: 'chauffage',    label: 'Mode de chauffage',        type: 'select', options: ['PAC collective','PAC individuelle','Réseau de chaleur urbain (CPCU)','Plancher chauffant électrique','Pompe à chaleur air/air'], required: true },
    { id: 're2020',       label: 'Conformité RE 2020', type: 'select', options: ['Seuil 2025 (IC construction ≤ 490 kgCO₂eq/m²)','Seuil 2028 (IC construction ≤ 415 kgCO₂eq/m²)','Seuil 2031 (Objectif bas carbone)'], required: true },
    { id: 'confort_ete',  label: 'Confort d\'été', type: 'select', options: ['Brise-soleil orientables (BSO)','Volets roulants motorisés','Double vitrage à contrôle solaire','BSO + Volets motorisés','Sans dispositif spécifique'] },
    { id: 'isolation',    label: 'Type d\'isolation',        type: 'select', options: ['Biosourcée (laine de bois, chanvre, ouate)','Synthétique (PSE, laine de verre)','Mixte biosourcée + synthétique','ITI béton banché renforcé'] },
    { id: 'specificites', label: 'Spécificités & équipements', type: 'textarea', placeholder: 'Terrasse, domotique, VMC double flux, loggia…', span: 'full',
      ghostwriter: {
        label         : 'Enrichir la description avec l\'IA',
        mode          : 'technique',
        audience      : 'client',
        action        : 'rewrite',
        tone          : 'descriptif premium',
        lengthTarget  : 'expand',
        context       : 'Spécificités techniques d\'un logement neuf VEFA RE 2020',
        include_fields: ['nom_programme', 'type_logement', 'surface', 'etage', 'orientation', 'annexes', 'sols', 'cuisine', 'chauffage', 're2020', 'confort_ete', 'isolation'],
      },
    },
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
    { id: 'adresse_programme',       label: 'Adresse du programme',              type: 'text',   placeholder: 'ex : 12 avenue des Lauriers, 83110 Sanary', span: 'full' },
    { id: 'lot_numero',              label: 'Numéro de lot',                type: 'text',   placeholder: 'ex : A-203', required: true },
    { id: 'surface_carrez',          label: 'Surface Loi Carrez (m²)',      type: 'number', placeholder: 'ex : 72.4', required: true },
    { id: 'cadastre',                label: 'Référence cadastrale',    type: 'text',   placeholder: 'ex : Section AB n°123' },
    { id: 'quote_parts',             label: 'Quote-parts copropriété', type: 'text',   placeholder: 'ex : 285 / 10 000' },
    { id: 'ville',                   label: 'Ville',                             type: 'text',   placeholder: 'ex : Sanary' },
    { id: 'departement',             label: 'Département',                  type: 'text',   placeholder: 'ex : Var (83)' },
    { id: 'region',                  label: 'Région',                       type: 'select', options: ["Provence-Alpes-Côte d'Azur","Occitanie","Nouvelle-Aquitaine","Île-de-France","Auvergne-Rhône-Alpes","Bretagne","Pays de la Loire","Hauts-de-France","Grand Est","Bourgogne-Franche-Comté","Normandie","Centre-Val de Loire","Corse","DOM-TOM"] },

    { id: 'vendeur_nom',             label: 'Vendeur — Raison sociale',    type: 'text',   placeholder: 'ex : SCCV Les Jardins du Midi', required: true, span: 'full' },
    { id: 'vendeur_siren',           label: 'SIREN',                             type: 'text',   placeholder: 'ex : 123 456 789' },
    { id: 'vendeur_rcs',             label: 'RCS',                               type: 'text',   placeholder: 'ex : Toulon B 123 456 789' },
    { id: 'vendeur_capital',         label: 'Capital social',                    type: 'text',   placeholder: 'ex : 1 000 €' },
    { id: 'vendeur_siege',           label: 'Siège social',                 type: 'text',   placeholder: 'ex : 5 rue Hoche, 83000 Toulon', span: 'full' },
    { id: 'vendeur_representant',    label: 'Représenté par',          type: 'text',   placeholder: 'ex : M. Jean DUPONT, gérant' },

    { id: 'acquereur_nom',           label: 'Acquéreur — Nom & prénom', type: 'text', placeholder: 'ex : Mme Sophie MARTIN', required: true, span: 'full' },
    { id: 'acquereur_civilite',      label: 'Civilité / Profession',        type: 'text',   placeholder: 'ex : Mme, cadre' },
    { id: 'acquereur_naissance',     label: 'Date de naissance',                 type: 'text',   placeholder: 'ex : 14/03/1985' },
    { id: 'acquereur_lieu_naissance',label: 'Lieu de naissance',                 type: 'text',   placeholder: 'ex : Marseille (13)' },
    { id: 'acquereur_adresse',       label: 'Adresse',                           type: 'text',   placeholder: 'ex : 22 rue de la République, 13001 Marseille', span: 'full' },
    { id: 'acquereur_regime',        label: 'Régime matrimonial',           type: 'select', options: ['Célibataire','Marié(e) — communauté légale','Marié(e) — séparation de biens','Marié(e) — participation aux acquêts','Pacsé(e) — indivision','Pacsé(e) — séparation','Divorcé(e)','Veuf / Veuve'] },

    { id: 'prix_ht',                 label: 'Prix HT (€)',                  type: 'number', placeholder: 'ex : 233 333', required: true },
    { id: 'prix_ttc',                label: 'Prix TTC (€)',                 type: 'number', placeholder: 'ex : 280 000', required: true },
    { id: 'tva_taux',                label: 'Taux de TVA',                       type: 'select', options: ['20 %','5,5 % (zone ANRU / PSLA)','10 %'] },
    { id: 'tva_montant',             label: 'Montant TVA (€)',              type: 'number', placeholder: 'ex : 46 667' },
    { id: 'repartition_foncier_bati',label: 'Répartition foncier / bâti', type: 'text', placeholder: 'ex : 25 % foncier — 75 % bâti', span: 'full' },
    { id: 'ech_fondations',          label: 'Échéance — Fondations (35 %)',  type: 'number', placeholder: 'ex : 98 000' },
    { id: 'ech_hors_eau',            label: 'Échéance — Hors d\'eau (70 %)', type: 'number', placeholder: 'ex : 196 000' },
    { id: 'ech_achevement',          label: 'Échéance — Achèvement (95 %)', type: 'number', placeholder: 'ex : 266 000' },

    { id: 'depot_montant',           label: 'Dépôt — Montant (€)',        type: 'number', placeholder: 'ex : 14 000', required: true },
    { id: 'depot_montant_lettres',   label: 'Dépôt — Montant en lettres',     type: 'text',   placeholder: 'ex : quatorze mille euros' },
    { id: 'depot_pourcentage',       label: 'Dépôt — Pourcentage',            type: 'select', options: ['5 % (livraison < 1 an)','2 % (livraison < 2 ans)','0 % (livraison > 2 ans)'], required: true },
    { id: 'depot_plafond_legal',     label: 'Plafond légal applicable',                 type: 'text',   placeholder: 'ex : Art. R.261-28 CCH — 5 % max si livraison < 1 an' },
    { id: 'depot_mode_versement',    label: 'Mode de versement',                             type: 'select', options: ['Virement bancaire','Chèque de banque'] },
    { id: 'sequestre_etablissement', label: 'Séquestre — Établissement',      type: 'text',   placeholder: 'ex : Étude Maître Dupont, Toulon' },
    { id: 'sequestre_compte',        label: 'Séquestre — Référence compte', type: 'text', placeholder: 'ex : Compte CARPA n°…' },

    { id: 'pret_montant',            label: 'Prêt — Montant sollicité (€)', type: 'number', placeholder: 'ex : 224 000' },
    { id: 'pret_taux_max',           label: 'Prêt — Taux maximum (%)',              type: 'number', placeholder: 'ex : 4.5' },
    { id: 'pret_duree_max',          label: 'Prêt — Durée maximum (ans)',      type: 'number', placeholder: 'ex : 25' },
    { id: 'pret_delai',              label: 'Prêt — Délai d\'obtention (jours)', type: 'number', placeholder: 'ex : 45' },

    { id: 'livraison',               label: 'Date de livraison prévisionnelle', type: 'text', placeholder: 'ex : T4 2027' },
    { id: 'date_acte_authentique',   label: 'Date prévue acte authentique',    type: 'text', placeholder: 'ex : 30/09/2026' },
    { id: 'penalites_retard',        label: 'Pénalités de retard',        type: 'text', placeholder: 'ex : 1/3000ème du prix par jour de retard', span: 'full' },
    { id: 'notaire',                 label: 'Notaire instrumentaire',               type: 'text', placeholder: 'ex : Étude Maître Dupont, Toulon', span: 'full' },
    { id: 'lieu_signature',          label: 'Lieu de signature',                    type: 'text', placeholder: 'ex : Toulon' },
    { id: 'date_signature',          label: 'Date de signature',                    type: 'text', placeholder: 'ex : 11/05/2026' },
    { id: 'nb_exemplaires',          label: 'Nombre d\'exemplaires',                type: 'number', placeholder: 'ex : 3' },
    {
      id:          'clauses_particulieres',
      label:       'Clauses particulières & adaptations',
      type:        'textarea',
      placeholder: 'Modifications spécifiques au cas d\'espèce, options retenues, prestations sur mesure, conditions négociées…',
      span:        'full',
      ghostwriter: {
        label         : 'Formuler les clauses avec l\'IA',
        mode          : 'juridique',
        audience      : 'notaire',
        action        : 'rewrite',
        tone          : 'juridique précis',
        lengthTarget  : 'keep',
        context       : 'Clauses particulières d\'un contrat de réservation VEFA (Art. L.261-15 CCH)',
        include_fields: ['nom_programme', 'type_logement', 'surface', 'prix_ttc', 'depot_pourcentage', 'notaire', 'lieu_signature', 'livraison'],
      },
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
let _program         = blankProgram();   // S6 — mode « concierge »
let _cleanupComputed = null;
let _stylesInjected  = false;
let _saveTimer       = null;
let _toastTimer      = null;
let _conciergePrefillNote = '';          // CG-12 — bandeau « pré-rempli » (entrée onglet Concierge)
let _vefaQrs      = [];                   // CG-13 — bibliothèque : QR Concierge déjà publiés
let _vefaQrsState = 'idle';              // 'idle' | 'loading' | 'ready' | 'error'
let _vefaQrsError = '';

// ══════════════════════════════════════════════════════════════
// Persistance — Brouillon localStorage
// ══════════════════════════════════════════════════════════════

function _saveDraft() {
  _collectFormData();                         // no-op en mode concierge (.vefa-form absent)
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode: _currentMode, data: _formData, program: _program }));
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
      _currentMode = (MODES[saved.mode] || saved.mode === 'concierge') ? saved.mode : 'notice';
      _formData    = saved.data || {};
      _program     = coerceProgram(saved.program);
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
  if (_currentMode === 'concierge') { _renderConcierge(scrollToTop); return; }
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
          <div class="vefa-actions-btns">
            <button class="vefa-btn-secondary" data-act="add-lot-to-concierge" type="button"
                    title="Reprendre ce lot dans le QR Concierge — sans le ressaisir">
              ${icon('sparkles', 16)}&nbsp;Ajouter ce lot au Concierge
            </button>
            <button class="vefa-btn-primary" data-act="generate" type="button">
              ${icon('file-text', 18)}&nbsp;${_esc(mode.action_label)}
            </button>
          </div>
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
                title="Raccourci clavier : touche 1">
          ${icon('file-text', 14)}&nbsp;Notice descriptive
        </button>
        <button class="vefa-tab${_currentMode === 'contrat' ? ' is-active' : ''}"
                data-act="switch-mode" data-mode="contrat"
                type="button" role="tab"
                aria-selected="${_currentMode === 'contrat'}"
                title="Raccourci clavier : touche 2">
          ${icon('edit', 14)}&nbsp;Contrat de réservation
        </button>
        <button class="vefa-tab${_currentMode === 'concierge' ? ' is-active' : ''}"
                data-act="switch-mode" data-mode="concierge"
                type="button" role="tab"
                aria-selected="${_currentMode === 'concierge'}"
                title="Raccourci clavier : touche 3">
          ${icon('sparkles', 14)}&nbsp;Concierge IA
        </button>
      </nav>
      <p class="vefa-hero-subtitle">${_esc(
        MODES[_currentMode] ? MODES[_currentMode].subtitle : 'Concierge IA — 1 QR, tout le programme'
      )}</p>
    </div>`;
}

function _renderField(field) {
  const span   = field.span === 'full' ? ' style="grid-column:1/-1"' : '';
  const req    = field.required ? ' <span class="vefa-req" aria-hidden="true">*</span>' : '';
  const rawVal = String(_formData[field.id] != null ? _formData[field.id] : '');
  const val    = _esc(rawVal);

  let input;
  if (field.type === 'textarea') {
    // GW-integration : id="f-..." pour que _handleGhostwriter retrouve l'élément
    input = `<textarea class="ws-input ws-textarea"
      id="f-${_esc(field.id)}"
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

  // GW-integration : bouton ✦ Ghost Writer si le champ déclare ghostwriter
  // (même structure que annonces-immo.js — réutilise la CSS .gw-assist-* globale).
  const gwBtn = field.ghostwriter ? `
    <div class="gw-assist-wrap">
      <button type="button" class="gw-assist-btn"
              data-act="ghostwriter" data-field-id="${_esc(field.id)}"
              aria-label="Réécrire avec Ghost Writer">
        <span class="gw-assist-icon">✦</span>
        <span class="gw-assist-label">${_esc(field.ghostwriter.label || 'Réécrire en 3 variantes')}</span>
      </button>
    </div>` : '';

  return `
    <div class="vefa-field"${span}>
      <label class="ws-label">${_esc(field.label)}${req}</label>
      ${input}
      ${gwBtn}
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
    if (confirm('Effacer tout votre brouillon VEFA Studio et recommencer ?')) {
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      _formData    = {};
      _program     = blankProgram();
      _currentMode = 'notice';
      _renderMain(true);
      _toast('Brouillon réinitialisé');
    }
    return;
  }
  if (act === 'switch-mode') { _switchMode(btn.dataset.mode); return; }
  if (act === 'generate')    { _generate(); return; }
  if (act === 'add-lot-to-concierge') { _addLotToConcierge(); return; }
  if (act === 'ghostwriter') { _handleGhostwriter(btn.dataset.fieldId); return; }
  // ── Mode Concierge (S6) : repeaters lots / FAQ / questions + envoi ──
  if (act === 'vp-add-lot')      { _program.lots.push(blankLot());     _scheduleSave(); _renderMain(); return; }
  if (act === 'vp-del-lot')      { _vpDelete('lots',      +btn.dataset.idx, true); return; }
  if (act === 'vp-add-faq')      { _program.faq.push({ q: '', r: '' }); _scheduleSave(); _renderMain(); return; }
  if (act === 'vp-del-faq')      { _vpDelete('faq',       +btn.dataset.idx, false); return; }
  if (act === 'vp-add-question') {
    if (_program.questions.length < MAX_QUESTIONS) { _program.questions.push(''); _scheduleSave(); _renderMain(); }
    else _toast(`Maximum ${MAX_QUESTIONS} questions suggérées.`, true);
    return;
  }
  if (act === 'vp-del-question') { _vpDelete('questions', +btn.dataset.idx, false); return; }
  if (act === 'send-concierge')  { _sendToConcierge(); return; }
  if (act === 'goto-kstore')     { _gotoKStoreSDQR(); return; }
  // ── CG-13 — bibliothèque QR Concierge ──
  if (act === 'cg-lib-reload')   { _loadConciergeLibrary(); return; }
  if (act === 'cg-lib-open')     { _openVefaQrInSdqr(btn.dataset.qrId); return; }
}

// ── Ghost Writer Pad-Aware (2026-05-24) ──────────────────────
// Cherche le champ dans SHARED_FIELDS, MODE_NOTICE.fields, MODE_CONTRAT.fields
// (VEFA Studio a 3 arrays distincts contrairement à Annonces Immo qui a un FIELDS unique).
// Construit le context Pad-Aware (autres champs déjà saisis listés dans
// include_fields) puis ouvre le panneau Ghost Writer inline.
function _handleGhostwriter(fieldId) {
  const allFields = [...SHARED_FIELDS, ...MODE_NOTICE.fields, ...MODE_CONTRAT.fields];
  const field = allFields.find(f => f.id === fieldId);
  if (!field?.ghostwriter) return;

  const targetEl = _root?.querySelector(`#f-${fieldId}`);
  if (!targetEl) return;

  // Pad-Aware : collecte les autres champs du formulaire pour donner
  // à Ghost Writer le contexte du bien (nom du programme, surface, etc.).
  let formContext = null;
  const include = field.ghostwriter.include_fields;
  if (Array.isArray(include) && include.length > 0) {
    formContext = {};
    for (const fid of include) {
      const def = allFields.find(f => f.id === fid);
      const el  = _root?.querySelector(`[name="${fid}"]`);
      const val = (el?.value || '').trim();
      if (val) formContext[fid] = { label: def?.label || fid, value: val };
    }
    if (Object.keys(formContext).length === 0) formContext = null;
  }

  openGhostwriterInline(targetEl, {
    ...field.ghostwriter,
    context: field.ghostwriter.context || field.label,
    formContext,
  });
}

function _onInput(e) {
  const el = e.target;
  const d  = el.dataset || {};
  // Mode Concierge : la saisie écrit directement dans _program (état vif),
  // jamais dans _formData. Routage par attribut data-vp-*.
  if (_currentMode === 'concierge') {
    if (d.vpPath     != null) { _vpSetPath(d.vpPath, el);            _scheduleSave(); return; }
    if (d.vpLot      != null) { _vpSetLot(+d.vpLot, d.vpKey, el);    _scheduleSave(); return; }
    if (d.vpFaq      != null) { _vpSetFaq(+d.vpFaq, d.vpKey, el.value); _scheduleSave(); return; }
    if (d.vpQuestion != null) { _program.questions[+d.vpQuestion] = el.value; _scheduleSave(); return; }
  }
  const fieldId = d.field || el.name;
  if (!fieldId) return;
  _formData[fieldId] = el.value;
  _scheduleSave();
}

/**
 * Raccourcis globaux (actifs uniquement hors champ de saisie).
 *   1 → Notice descriptive
 *   2 → Contrat de réservation
 *   3 → Concierge IA
 *   Échap → Fermer VEFA Studio
 */
function _handleKeyDown(e) {
  if (!_root) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') { closeVefaStudio(); return; }
  if ((e.key === '1') && !e.ctrlKey && !e.metaKey) { _switchMode('notice');    return; }
  if ((e.key === '2') && !e.ctrlKey && !e.metaKey) { _switchMode('contrat');   return; }
  if ((e.key === '3') && !e.ctrlKey && !e.metaKey) { _switchMode('concierge'); return; }
}

// ══════════════════════════════════════════════════════════════
// Actions métier
// ══════════════════════════════════════════════════════════════

function _switchMode(mode) {
  if (mode === _currentMode) return;
  if (mode !== 'concierge' && !MODES[mode]) return;
  // En mode concierge, _program est tenu à jour en continu par _onInput :
  // rien à figer. Sinon on snapshote le formulaire notice/contrat.
  if (_currentMode !== 'concierge') _collectFormData();          // snapshot avant destroy
  if (_cleanupComputed) { _cleanupComputed(); _cleanupComputed = null; }
  _currentMode = mode;
  if (mode === 'concierge') _prefillConciergeHeader();           // CG-12 — zéro re-saisie
  _renderMain(true);                                             // scroll to top
}

// CG-12 — À l'entrée de l'onglet Concierge, reprend l'identité du programme
// déjà saisie en Notice/Contrat (non destructif : ne touche que les champs vides).
function _prefillConciergeHeader() {
  _conciergePrefillNote = '';
  const header = vefaDocToProgramHeader(_formData);
  const KEYS   = ['nom', 'promoteur', 'ville', 'livraison_prevue'];
  const wasEmpty = {};
  KEYS.forEach((k) => { wasEmpty[k] = !String(_program[k] || '').trim(); });
  _program = fillProgramHeaderIfEmpty(_program, header);
  const filled = KEYS.filter((k) => wasEmpty[k] && String(_program[k] || '').trim()).length;
  if (filled) {
    const s = filled > 1 ? 's' : '';
    _conciergePrefillNote = `Identité reprise de la Notice / du Contrat — ${filled} champ${s} pré-rempli${s}, modifiable.`;
    _scheduleSave();
  }
}

// ══════════════════════════════════════════════════════════════
// Mode Concierge (S6) — fenêtre Programme multi-lots
// ───────────────────────────────────────────────────────────────
// VEFA Studio saisit la « forme à plat » programme (lib/concierge-program.js)
// puis l'envoie au Pad Smart Dynamic QR, où le QR Concierge est réellement
// créé et géré (vue source 2 du moteur, cf. vefaProgramToBlock côté Worker).
// L'état _program est tenu à jour en continu par _onInput ; les boutons
// add/del re-rendent la fenêtre depuis _program.
// ══════════════════════════════════════════════════════════════

const STATUT_LABELS = { disponible: 'Disponible', optionne: 'Optionné', vendu: 'Vendu' };

// Possède-t-on le Pad Smart Dynamic QR ? (mêmes règles que ui-renderer :
// ADMIN ou owned===null => tout ; sinon présence de l'ID dans owned/lifetime).
// En cas de doute on n'empêche pas l'accès (renvoie true) — l'upsell K-Store
// est réservé aux cas clairement « non possédé ».
function _ownsSDQR() {
  try {
    if (isAdminUser()) return true;
    const owned = getOwnedIds();
    if (owned === null) return true;
    if (Array.isArray(owned) && owned.includes(SDQR_PAD_ID)) return true;
    return getLifetimeIds().includes(SDQR_PAD_ID);
  } catch (_) { return true; }
}

function _renderConcierge(scrollToTop) {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const prevScroll = scrollToTop ? 0 : main.scrollTop;
  const owns    = _ownsSDQR();
  const carried = _program.lots.filter((l) => String(l.reference).trim()).length;

  main.innerHTML = `
    <div class="ws-main-inner vefa-wrap">
      ${_renderHero()}
      <div class="vefa-concierge">

        <div class="vefa-section">
          <div class="vefa-section-header">
            <div class="vefa-section-title">Mes QR Concierge</div>
            <div class="vefa-section-subtitle">Vos programmes déjà publiés — ouvrez-en un pour l'éditer ou le re-télécharger</div>
          </div>
          <div id="vefa-cg-library-slot">${_conciergeLibraryHTML()}</div>
        </div>

        <div class="vefa-section vefa-cg-gateway">
          <div class="vefa-section-header">
            <div class="vefa-section-title">Créer un QR Concierge</div>
            <div class="vefa-section-subtitle">${owns
              ? 'Le QR Concierge se crée et se gère dans Smart Dynamic QR (modèles, FAQ, couleurs, bannière).'
              : 'Le QR Concierge fait partie de l\'outil Smart Dynamic QR.'}</div>
          </div>
          ${owns && carried
            ? `<p class="vefa-prefill-note">${icon('sparkles', 13)}&nbsp;${carried} lot${carried > 1 ? 's' : ''} repris de vos documents (Notice / Contrat), prêt${carried > 1 ? 's' : ''} à reprendre dans Smart Dynamic QR.</p>`
            : ''}
          <button class="vefa-btn-primary vefa-cg-gateway-cta" data-act="${owns ? 'send-concierge' : 'goto-kstore'}" type="button">
            ${owns
              ? `${icon('arrow-right', 18)}&nbsp;${carried ? 'Reprendre dans Smart Dynamic QR' : 'Ouvrir Smart Dynamic QR'}`
              : `${icon('plus', 18)}&nbsp;Obtenir Smart Dynamic QR`}
          </button>
          ${owns ? '' : `<p class="vefa-cg-gateway-hint">Smart Dynamic QR n'est pas encore dans vos outils — cliquez pour le découvrir dans le K-Store.</p>`}
        </div>

      </div>
    </div>
  `;

  main.scrollTop = prevScroll;

  // CG-13 — bibliothèque : chargement paresseux au 1er affichage, puis
  // (re-)rendu des vignettes QR à chaque re-render de l'onglet Concierge.
  if (_vefaQrsState === 'idle')        _loadConciergeLibrary();
  else if (_vefaQrsState === 'ready')  _renderConciergeThumbs();
}

// ══════════════════════════════════════════════════════════════
// CG-13 — Bibliothèque des QR Concierge déjà publiés
// ──────────────────────────────────────────────────────────────
// Lecture seule depuis GET /api/qr (filtrée template_id='concierge' par
// listConciergeQRs). Chaque carte : vignette QR réelle + nom + « Ouvrir »
// qui rebascule dans Smart Dynamic QR sur ce QR précis (édition / export).
// ══════════════════════════════════════════════════════════════

function _qrAuthHeaders() {
  const h = { 'X-Tenant-Id': localStorage.getItem('ks_tenant_id') || 'default' };
  const adminToken = localStorage.getItem('ks_admin_token');
  const jwt        = localStorage.getItem('ks_jwt');
  if (adminToken)  h['Authorization'] = 'Bearer ' + adminToken;
  else if (jwt)    h['Authorization'] = 'Bearer ' + jwt;
  return h;
}

async function _loadConciergeLibrary() {
  if (_vefaQrsState === 'loading') return;
  _vefaQrsState = 'loading';
  _renderConciergeLibrary();
  try {
    const r = await fetch(`${CF_API}/api/qr`, { headers: _qrAuthHeaders() });
    if (!r.ok) throw new Error('Erreur ' + r.status);
    const body = await r.json();
    _vefaQrs      = listConciergeQRs(body.qrs || []);
    _vefaQrsState = 'ready';
  } catch (e) {
    _vefaQrsError = (e && e.message) || 'Chargement impossible';
    _vefaQrsState = 'error';
  }
  _renderConciergeLibrary();
  if (_vefaQrsState === 'ready') _renderConciergeThumbs();
}

// Met à jour le seul bloc bibliothèque (sans détruire le formulaire en cours).
function _renderConciergeLibrary() {
  const slot = _root && _root.querySelector('#vefa-cg-library-slot');
  if (slot) slot.innerHTML = _conciergeLibraryHTML();
}

function _conciergeLibraryHTML() {
  if (_vefaQrsState === 'loading') {
    return `<p class="vefa-vp-empty">Chargement de vos QR Concierge…</p>`;
  }
  if (_vefaQrsState === 'error') {
    return `<p class="vefa-cg-lib-msg vefa-cg-lib-msg--err">${_esc(_vefaQrsError)} — `
      + `<button type="button" class="vefa-cg-lib-link" data-act="cg-lib-reload">Réessayer</button></p>`;
  }
  if (_vefaQrsState === 'ready' && _vefaQrs.length === 0) {
    return `<p class="vefa-vp-empty">Aucun QR Concierge enregistré pour l'instant. `
      + `Construisez votre programme ci-dessous puis « Envoyer vers Smart Dynamic QR ».</p>`;
  }
  if (_vefaQrsState !== 'ready') {
    return `<p class="vefa-vp-empty">`
      + `<button type="button" class="vefa-cg-lib-link" data-act="cg-lib-reload">Charger mes QR Concierge</button></p>`;
  }
  return `<div class="vefa-cg-lib">${_vefaQrs.map(_conciergeLibCardHTML).join('')}</div>`;
}

function _conciergeLibCardHTML(q) {
  const id    = _esc(String(q.id || ''));
  const name  = _esc(String(q.name || '').trim() || '(sans nom)');
  const scans = Number(q.scans_total || 0);
  const host  = CF_API.replace(/^https?:\/\//, '');
  const link  = q.short_id ? _esc(`${host}/r/${q.short_id}`) : '';
  const meta  = `${scans} scan${scans > 1 ? 's' : ''}${link ? ` · ${link}` : ''}`;
  return `
    <div class="vefa-cg-card">
      <div class="vefa-cg-thumb" data-qr-thumb="${id}">${icon('qr-code', 22)}</div>
      <div class="vefa-cg-card-body">
        <div class="vefa-cg-card-name">${name}</div>
        <div class="vefa-cg-card-meta">${meta}</div>
      </div>
      <button type="button" class="vefa-cg-card-open" data-act="cg-lib-open" data-qr-id="${id}"
              title="Ouvrir ce QR dans Smart Dynamic QR pour l'éditer ou le re-télécharger">
        ${icon('arrow-right', 16)}&nbsp;Ouvrir
      </button>
    </div>`;
}

async function _renderConciergeThumbs() {
  for (const q of _vefaQrs) {
    if (!q || !q.short_id || !q.id) continue;
    const slot = _root && _root.querySelector(`[data-qr-thumb="${_cssEsc(String(q.id))}"]`);
    if (!slot || slot.dataset.rendered === '1') continue;
    try {
      const svg = await renderQrCustom(`${CF_API}/r/${q.short_id}`, q.design, 88);
      slot.innerHTML = svg;
      slot.dataset.rendered = '1';
    } catch (_) { /* on garde l'icône de repli */ }
  }
}

function _cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, '\\$&');
}

async function _openVefaQrInSdqr(id) {
  if (!id) return;
  try {
    const m = await import('./sdqr.js');
    closeVefaStudio();
    m.openSDQR?.({ editId: id });
  } catch (err) {
    console.error('[VefaStudio] openSDQR editId', err);
    _toast('Ouvrez Smart Dynamic QR pour éditer ce QR.', true);
  }
}

// ── Builders de lignes (repeaters) ────────────────────────────
function _vpScalar(label, path, value, opts = {}) {
  const span = opts.span ? ' style="grid-column:1/-1"' : '';
  const req  = opts.required ? ' <span class="vefa-req" aria-hidden="true">*</span>' : '';
  const val  = _esc(String(value != null ? value : ''));
  const ph   = _esc(opts.placeholder || '');
  let input;
  if (opts.type === 'textarea') {
    input = `<textarea class="ws-input ws-textarea" rows="2" data-vp-path="${path}" placeholder="${ph}">${val}</textarea>`;
  } else {
    const t = opts.type === 'number' ? 'number' : 'text';
    input = `<input class="ws-input" type="${t}" data-vp-path="${path}" value="${val}" placeholder="${ph}"${opts.type === 'number' ? ' min="0" step="any"' : ''}>`;
  }
  return `<div class="vefa-field"${span}><label class="ws-label">${_esc(label)}${req}</label>${input}</div>`;
}

function _vpColor(label, path, value) {
  const v = _esc(value || '');
  return `
    <div class="vefa-field">
      <label class="ws-label">${_esc(label)}</label>
      <div class="vefa-vp-color">
        <input type="color" class="vefa-vp-swatch" data-vp-path="${path}" value="${v}">
        <input type="text" class="ws-input vefa-vp-hex" data-vp-path="${path}" value="${v}" maxlength="7" placeholder="#2563eb">
      </div>
    </div>`;
}

function _vpLotRow(lot, i, total) {
  const v = (k) => _esc(String(lot[k] != null ? lot[k] : ''));
  const stOpts = LOT_STATUTS.map((s) =>
    `<option value="${s}"${lot.statut === s ? ' selected' : ''}>${_esc(STATUT_LABELS[s] || s)}</option>`
  ).join('');
  const prest = Array.isArray(lot.prestations) ? lot.prestations.join('\n') : '';
  return `
    <div class="vefa-vp-row">
      <div class="vefa-vp-row-head">
        <span class="vefa-vp-row-title">Lot ${i + 1}</span>
        <button type="button" class="vefa-vp-del" data-act="vp-del-lot" data-idx="${i}"${total <= 1 ? ' disabled' : ''} aria-label="Supprimer ce lot">
          ${icon('minus', 14)}
        </button>
      </div>
      <div class="vefa-fields">
        <div class="vefa-field" style="grid-column:1/-1">
          <label class="ws-label">Référence / Modèle <span class="vefa-req" aria-hidden="true">*</span></label>
          <input class="ws-input" type="text" data-vp-lot="${i}" data-vp-key="reference" value="${v('reference')}" placeholder="ex : Maison A">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Type</label>
          <input class="ws-input" type="text" data-vp-lot="${i}" data-vp-key="type" value="${v('type')}" placeholder="ex : T4 / Villa">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Statut</label>
          <select class="ws-input ws-select" data-vp-lot="${i}" data-vp-key="statut">${stOpts}</select>
        </div>
        <div class="vefa-field">
          <label class="ws-label">Chambres</label>
          <input class="ws-input" type="number" min="0" step="any" data-vp-lot="${i}" data-vp-key="nb_chambres" value="${v('nb_chambres')}" placeholder="ex : 3">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Surface habitable (m²)</label>
          <input class="ws-input" type="number" min="0" step="any" data-vp-lot="${i}" data-vp-key="surface_habitable_m2" value="${v('surface_habitable_m2')}" placeholder="ex : 92">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Jardin (m²)</label>
          <input class="ws-input" type="number" min="0" step="any" data-vp-lot="${i}" data-vp-key="jardin_m2" value="${v('jardin_m2')}" placeholder="ex : 250">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Exposition</label>
          <input class="ws-input" type="text" data-vp-lot="${i}" data-vp-key="exposition" value="${v('exposition')}" placeholder="ex : Sud">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Prix TTC (€)</label>
          <input class="ws-input" type="number" min="0" step="any" data-vp-lot="${i}" data-vp-key="prix_ttc" value="${v('prix_ttc')}" placeholder="ex : 389000">
        </div>
        <div class="vefa-field">
          <label class="ws-label">Stationnement</label>
          <input class="ws-input" type="text" data-vp-lot="${i}" data-vp-key="stationnement" value="${v('stationnement')}" placeholder="ex : 2 places">
        </div>
        <div class="vefa-field vefa-vp-check">
          <label class="ws-label">
            <input type="checkbox" data-vp-lot="${i}" data-vp-key="garage"${lot.garage ? ' checked' : ''}>
            Garage
          </label>
        </div>
        <div class="vefa-field" style="grid-column:1/-1">
          <label class="ws-label">Prestations (une par ligne)</label>
          <textarea class="ws-input ws-textarea" rows="2" data-vp-lot="${i}" data-vp-key="prestations" placeholder="Cuisine équipée&#10;Volets roulants motorisés">${_esc(prest)}</textarea>
        </div>
      </div>
    </div>`;
}

function _vpFaqRow(faq, i) {
  return `
    <div class="vefa-vp-row vefa-vp-row--compact">
      <div class="vefa-vp-row-head">
        <span class="vefa-vp-row-title">Q/R ${i + 1}</span>
        <button type="button" class="vefa-vp-del" data-act="vp-del-faq" data-idx="${i}" aria-label="Supprimer cette Q/R">
          ${icon('minus', 14)}
        </button>
      </div>
      <div class="vefa-fields">
        <div class="vefa-field" style="grid-column:1/-1">
          <label class="ws-label">Question</label>
          <input class="ws-input" type="text" data-vp-faq="${i}" data-vp-key="q" value="${_esc(faq.q || '')}" placeholder="ex : Frais de notaire réduits ?">
        </div>
        <div class="vefa-field" style="grid-column:1/-1">
          <label class="ws-label">Réponse (servie telle quelle)</label>
          <textarea class="ws-input ws-textarea" rows="2" data-vp-faq="${i}" data-vp-key="r" placeholder="Réponse validée par l'agence…">${_esc(faq.r || '')}</textarea>
        </div>
      </div>
    </div>`;
}

function _vpQuestionRow(q, i) {
  return `
    <div class="vefa-vp-inline">
      <input class="ws-input" type="text" data-vp-question="${i}" value="${_esc(q || '')}" placeholder="ex : Quels lots sont encore disponibles ?">
      <button type="button" class="vefa-vp-del" data-act="vp-del-question" data-idx="${i}" aria-label="Supprimer cette question">
        ${icon('minus', 14)}
      </button>
    </div>`;
}

// ── Handlers d'état _program ──────────────────────────────────
function _vpSetPath(path, el) {
  const parts = path.split('.');
  let obj = _program;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = el.value;
  // Sync des widgets partageant le même chemin (swatch couleur ↔ champ hex).
  if (_root) {
    _root.querySelectorAll(`[data-vp-path="${path}"]`).forEach((o) => {
      if (o !== el && o.value !== el.value) o.value = el.value;
    });
  }
}

function _vpSetLot(idx, key, el) {
  const lot = _program.lots[idx];
  if (!lot) return;
  if (key === 'garage')           lot.garage = !!el.checked;
  else if (key === 'prestations') lot.prestations = String(el.value).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  else                            lot[key] = el.value;
}

function _vpSetFaq(idx, key, val) {
  const f = _program.faq[idx];
  if (f) f[key] = val;
}

function _vpDelete(arrName, idx, keepMin) {
  const arr = _program[arrName];
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;
  arr.splice(idx, 1);
  if (keepMin && arr.length === 0) arr.push(blankLot());
  _scheduleSave();
  _renderMain();
}

// ── Pont document → Concierge : reprend le lot saisi en Notice/Contrat (CG-11) ──
function _addLotToConcierge() {
  _collectFormData();
  const lot    = vefaDocToLot(_formData);
  const header = vefaDocToProgramHeader(_formData);
  if (!String(lot.reference).trim()) lot.reference = String(_formData.type_logement || '').trim();
  if (!String(lot.reference).trim()) {
    _toast('Renseigne d\'abord un numéro de lot (Contrat) ou un type (Programme).', true);
    return;
  }
  const res = upsertLot(_program, lot);
  _program  = fillProgramHeaderIfEmpty(res.program, header);
  _saveDraft();
  const count = _program.lots.filter((l) => String(l.reference).trim()).length;
  const head  = res.action === 'updated' ? 'Lot mis à jour' : 'Lot ajouté';
  _toast(`${head} dans le Concierge : ${lot.reference} (${count} au total).`);
}

// ── Ouverture de Smart Dynamic QR (le Concierge s'y crée et s'y gère) ──
// Si des lots ont été repris des documents (Notice/Contrat via le pont), on
// relaie le programme pour pré-remplir l'éditeur Concierge de Smart Dynamic QR.
// Sinon, ouverture simple : l'éditeur complet est dans Smart Dynamic QR.
async function _sendToConcierge() {
  const hasProgram = validateProgramLight(_program).length === 0;
  if (hasProgram) {
    try {
      localStorage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ program: _program, ts: Date.now() }));
    } catch (_) {}
    _saveDraft();
  }
  try {
    const m = await import('./sdqr.js');
    closeVefaStudio();
    // Avec programme repris : le relai ouvre le Concierge pré-rempli.
    // Sans : on ouvre QUAND MÊME directement le formulaire Concierge (VEFA),
    // jamais la simple liste (deep-link demandé par Stéphane).
    if (hasProgram) m.openSDQR?.();
    else            m.openSDQR?.({ createConcierge: 'immo' });
  } catch (err) {
    console.error('[VefaStudio] openSDQR', err);
    _toast('Ouvrez Smart Dynamic QR pour créer le QR Concierge.', true);
  }
}

// ── Pas le Pad : on renvoie vers la fiche Smart Dynamic QR du K-Store ──
async function _gotoKStoreSDQR() {
  try {
    const m = await import('./ui-renderer.js');
    closeVefaStudio();
    m.openKStoreAppDetail?.(SDQR_PAD_ID);
  } catch (err) {
    console.error('[VefaStudio] openKStoreAppDetail', err);
    _toast('Ouvrez le K-Store pour obtenir Smart Dynamic QR.', true);
  }
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
    _toast(`Champs requis manquants : ${labels}`, true);
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
    _toast('Erreur de génération : ' + ((err && err.message) || 'inconnue'), true);
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

.vefa-actions-btns {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.vefa-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 11px 20px;
  border-radius: var(--ws-radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--ws-accent);
  border: 1.5px solid var(--ws-accent);
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: -.015em;
  transition: background 160ms ease, transform 120ms ease;
}
.vefa-btn-secondary:hover {
  background: color-mix(in srgb, var(--ws-accent) 12%, transparent);
  transform: translateY(-1px);
}
.vefa-btn-secondary:active { transform: translateY(0); }

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

/* ── Concierge : repeaters (lots / FAQ / questions) ── */
.vefa-vp-row {
  background: var(--ws-bg, rgba(255, 255, 255, .02));
  border: 1px solid var(--ws-border);
  border-radius: 12px;
  padding: 18px 20px 8px;
  margin-bottom: 14px;
}
.vefa-vp-row--compact { padding-bottom: 18px; }
.vefa-vp-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.vefa-vp-row-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .02em;
  text-transform: uppercase;
  color: var(--ws-text-muted);
}
.vefa-vp-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--ws-border);
  background: transparent;
  color: var(--ws-text-muted);
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}
.vefa-vp-del:hover:not([disabled]) {
  color: var(--ws-danger, #f85149);
  border-color: var(--ws-danger, #f85149);
  background: rgba(248, 81, 73, .08);
}
.vefa-vp-del[disabled] { opacity: .35; cursor: not-allowed; }
.vefa-vp-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 9px 16px;
  border-radius: var(--ws-radius-pill);
  border: 1px dashed var(--ws-border);
  background: transparent;
  color: var(--ws-accent);
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: -.01em;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}
.vefa-vp-add:hover {
  border-color: var(--ws-accent);
  background: rgba(99, 102, 241, .08);
}
.vefa-vp-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.vefa-vp-inline .ws-input { flex: 1 1 auto; }
.vefa-vp-empty {
  margin: 0 0 14px;
  font-size: 13px;
  font-style: italic;
  color: var(--ws-text-muted);
}
.vefa-prefill-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 16px;
  padding: 9px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ws-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--ws-accent) 28%, transparent);
  color: var(--ws-accent);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -.01em;
  line-height: 1.4;
}

/* ── CG-13 — Bibliothèque QR Concierge ── */
.vefa-cg-lib {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.vefa-cg-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--ws-border);
  border-radius: 14px;
  background: var(--ws-surface, rgba(255, 255, 255, .02));
}
.vefa-cg-thumb {
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #fff;
  color: #94a3b8;
  overflow: hidden;
}
.vefa-cg-thumb svg { width: 100%; height: 100%; display: block; }
.vefa-cg-card-body { flex: 1 1 auto; min-width: 0; }
.vefa-cg-card-name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -.01em;
  color: var(--ws-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vefa-cg-card-meta {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ws-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vefa-cg-card-open {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: var(--ws-radius-pill);
  cursor: pointer;
  background: transparent;
  color: var(--ws-accent);
  border: 1.5px solid var(--ws-accent);
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: -.01em;
  transition: background 160ms ease;
}
.vefa-cg-card-open:hover { background: color-mix(in srgb, var(--ws-accent) 12%, transparent); }
.vefa-cg-lib-msg { margin: 0 0 6px; font-size: 13px; color: var(--ws-text-muted); }
.vefa-cg-lib-msg--err { color: var(--ws-danger, #f85149); }
.vefa-cg-lib-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--ws-accent);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
}
/* Passerelle « Créer un QR Concierge » (remplace l'ancien formulaire) */
.vefa-cg-gateway .vefa-cg-gateway-cta { margin-top: 4px; align-self: flex-start; }
.vefa-cg-gateway-hint { margin: 10px 0 0; font-size: 12px; color: var(--ws-text-muted); line-height: 1.5; }
.vefa-vp-check { justify-content: flex-end; }
.vefa-vp-check .ws-label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding-bottom: 9px;
}
.vefa-vp-check input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--ws-accent);
  cursor: pointer;
}
.vefa-vp-color {
  display: flex;
  align-items: center;
  gap: 10px;
}
.vefa-vp-swatch {
  flex: 0 0 auto;
  width: 44px;
  height: 38px;
  padding: 2px;
  border: 1px solid var(--ws-border);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.vefa-vp-hex {
  flex: 1 1 auto;
  font-variant-numeric: tabular-nums;
  text-transform: lowercase;
}

/* ── Responsive (≤ 640 px) ── */
@media (max-width: 640px) {
  .vefa-wrap { padding: 0 16px 80px; }
  .vefa-fields { grid-template-columns: 1fr; }
  .vefa-field[style*="grid-column"] { grid-column: auto !important; }
  .vefa-tab { padding: 7px 14px; font-size: 12.5px; }
  .vefa-actions { flex-direction: column; align-items: stretch; }
  .vefa-actions-hint { max-width: 100%; }
  .vefa-actions-btns { width: 100%; flex-direction: column; align-items: stretch; }
  .vefa-btn-primary { justify-content: center; }
  .vefa-btn-secondary { justify-content: center; }
  .vefa-section { padding: 18px 16px; }
  .vefa-vp-row { padding: 14px 14px 6px; }
  .vefa-vp-check { justify-content: flex-start; }
}

/* ───────────────────────────────────────────────────────────────
   ── MODE CLAIR ──  (html.light-mode uniquement — n'altère JAMAIS le
   mode sombre). Le workspace est déjà tokenisé en var(--ws-*) qui
   basculent seuls ; ce bloc fiabilise le contraste sur fond clair :
   cartes blanches franches, panneaux imbriqués distincts, séparateurs
   visibles, textes secondaires lisibles, champs nets.
   On ne touche ni .ws- ni .gw- (gérés ailleurs), ni les boutons à
   accent vif (ils gardent leur fond coloré + texte blanc), ni le toast
   (snackbar volontairement sombre, déjà lisible).
   ─────────────────────────────────────────────────────────────── */

/* Hero / eyebrow / sous-titres */
html.light-mode .vefa-hero { border-bottom-color: rgba(0,0,0,.1); }
html.light-mode .vefa-hero-eyebrow { color: #64748b; }
html.light-mode .vefa-hero-subtitle { color: #475569; }

/* Onglets pill — piste claire, bordure franche, hover sobre */
html.light-mode .vefa-tabs {
  background: #f1f5f9;
  border-color: rgba(0,0,0,.1);
}
html.light-mode .vefa-tab { color: #475569; }
/* La pill active a un fond accent → texte blanc (sinon la règle .vefa-tab ci-dessus,
   plus spécifique que le base .vefa-tab.is-active, écrasait son #fff). */
html.light-mode .vefa-tab.is-active { color: #fff; }
html.light-mode .vefa-tab:not(.is-active):hover {
  background: rgba(0,0,0,.04);
  color: #0f172a;
}

/* Sections = cartes blanches franches sur la page claire */
html.light-mode .vefa-section {
  background: #fff;
  border-color: rgba(0,0,0,.1);
  box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
html.light-mode .vefa-section-title { color: #0f172a; }
html.light-mode .vefa-section-subtitle { color: #64748b; }

/* Footer actions — séparateur + texte indicatif */
html.light-mode .vefa-actions { border-top-color: rgba(0,0,0,.1); }
html.light-mode .vefa-actions-hint { color: #64748b; }

/* Bouton secondaire (outline accent) : fond blanc explicite */
html.light-mode .vefa-btn-secondary { background: #fff; }

/* Repeaters Concierge — panneau imbriqué distinct de la carte blanche */
html.light-mode .vefa-vp-row {
  background: #fafafb;
  border-color: rgba(0,0,0,.1);
}
html.light-mode .vefa-vp-row-title { color: #64748b; }
html.light-mode .vefa-vp-del {
  border-color: rgba(0,0,0,.14);
  color: #64748b;
}
html.light-mode .vefa-vp-add { border-color: rgba(0,0,0,.18); }
html.light-mode .vefa-vp-empty { color: #64748b; }

/* Bibliothèque QR Concierge — cartes blanches + textes lisibles */
html.light-mode .vefa-cg-card {
  background: #fff;
  border-color: rgba(0,0,0,.1);
}
html.light-mode .vefa-cg-card-name { color: #0f172a; }
html.light-mode .vefa-cg-card-meta { color: #64748b; }
html.light-mode .vefa-cg-lib-msg { color: #64748b; }
html.light-mode .vefa-cg-gateway-hint,
html.light-mode .vefa-cg-gateway .vefa-cg-gateway-hint { color: #64748b; }

/* Widget couleur — pourtour visible du swatch sur fond blanc */
html.light-mode .vefa-vp-swatch { border-color: rgba(0,0,0,.14); }
`;
  document.head.appendChild(style);
}
