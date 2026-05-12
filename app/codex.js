/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact KODEX (A-COM-002) v1.0
   Sprint Kodex-1 : skeleton workspace fullscreen

   Mission : transformer une intention client (print/digital/presse)
   en cahier des charges technique infaillible, prêt à être traité
   par un graphiste ou par un moteur AI.

   Architecture des 4 étapes :
   ─────────────────────────────────────────────────────────────
     1. DESTINATION   — Acteur (imprimeur/réseau/presse) + Produit
     2. CONTENU       — Saisies métier sectorisées + données injectées
     3. ASSETS        — Coffre-fort : pièces détenues vs à fournir
     4. GÉNÉRATION    — Code Maître → IA → brief PDF téléchargeable

   Killer feature (Sprint Kodex-3) :
     CALCULATEUR D'ÉCHELLE pour les grands formats (bâche, 4×3).
     L'outil verrouille l'échelle 1/10e + le DPI selon distance
     de vue, et alerte si une pièce fournie est sous-résolue.

   Réutilisabilité :
     Le système de workspace (CSS `.ws-*` + structure `openKodex`)
     est conçu pour servir de gabarit à de futurs artefacts.
     Cloner ce fichier en `<nouvel-outil>.js`, garder la mécanique,
     remplacer les 4 vues et l'objet WORKSPACE_META.
   ═══════════════════════════════════════════════════════════════ */

import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import {
  loadCatalog, getVendorsByCategory, getProductsByVendor, getStandard,
  formatDimensions, formatBleed, formatDpi, CATEGORY_LABELS,
  loadSectors, getSector, getDefaultSector, computeLegalMentions,
} from './lib/kodex-catalog.js';
import { computeScale } from './lib/kodex-scale.js';
import { icon } from './lib/ui-icons.js';

// ── Métadonnées workspace (override par artefact) ──────────────
const WORKSPACE_META = {
  id        : 'A-COM-002',
  name      : 'Kodex',
  punchline : 'Le brief print/digital infaillible',
};

// ── Définition des étapes (ordre + icône + label) ──────────────
const STEPS = [
  { id: 'destination', label: 'Le support',   icon: 'target',
    sublabel: 'Où ça va être publié' },
  { id: 'content',     label: 'Le message',   icon: 'edit',
    sublabel: 'Ce que vous voulez dire' },
  { id: 'assets',      label: 'Les visuels',  icon: 'package',
    sublabel: 'Logos, charte et photos' },
  { id: 'output',      label: 'Le brief',     icon: 'sparkles',
    sublabel: 'Le PDF prêt à envoyer' },
];

// ── État global (in-memory, persistance en Sprint Kodex-3+) ───
// Sprint Kodex-2 : `destination.step` ajoute une sous-navigation
//   'category' → 'vendor' → 'product' → 'done'
let _state = {
  view: 'destination',
  destination: {
    step: 'category',      // category | vendor | product | done
    category: null,        // print | social | press | custom
    vendor: null,          // 'Exaprint', 'Meta · Instagram', etc.
    standardId: null,      // id de la fiche sélectionnée
    standard: null,        // objet standard complet (cache)
  },
  content:     { sector: 'immobilier', fields: {} },
  assets: {
    // Sprint Kodex-3.2 : coffre-fort minimal
    logo_owned:   false,    // ✓ logo déjà chez Protein Studio
    charte_owned: false,    // ✓ charte graphique déjà transmise
    fonts_owned:  false,    // ✓ polices fournies à Protein
    charte: {
      primary_hex:   '',    // couleur principale ex: #1B2A4A
      secondary_hex: '',    // couleur secondaire
      font_title:    '',    // ex: 'Cormorant Garamond'
      font_body:     '',    // ex: 'Source Sans 3'
    },
    brand_book_url: '',     // lien externe vers le brand book (Drive, Dropbox)
    extra_notes:    '',     // demandes spéciales pour le graphiste
  },
  output: { codeMaitre: null, llmResponse: null, briefRef: null },
};

let _root = null;   // élément racine du workspace, null = fermé

// Bibliothèque d'icônes : déplacée dans app/lib/ui-icons.js (Sprint
// Phase E1) pour être partagée avec les autres outils Keystone.
// L'import en haut du fichier expose `icon(name, size)`.

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-3.3 — Persistance brouillon
// ═══════════════════════════════════════════════════════════════
const LS_DRAFT_KEY = 'ks_kodex_draft';

function _saveDraft() {
  try {
    // On ne stocke pas l'objet standard complet (re-récupérable via id)
    const lean = {
      ..._state,
      destination: {
        ..._state.destination,
        standard: null,   // on garde standardId, le standard sera re-fetch au load
      },
    };
    localStorage.setItem(LS_DRAFT_KEY, JSON.stringify(lean));
    // Sync cross-device via cloud-vault (debounce 1.5s)
    import('./vault.js').then(m => m.scheduleAutoSave?.()).catch(() => {});
  } catch (_) {}
}

async function _loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Merge non destructif (préserve les défauts si la structure a évolué)
    _state = {
      ..._state,
      ...data,
      destination: { ..._state.destination, ...(data.destination || {}) },
      content:     { ..._state.content, ...(data.content || {}) },
      assets:      { ..._state.assets, ...(data.assets || {}) },
      output:      { ..._state.output, ...(data.output || {}) },
    };
    // Re-hydrate standard si on a un id
    if (_state.destination.standardId) {
      _state.destination.standard = await getStandard(_state.destination.standardId);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function _resetDraft() {
  try { localStorage.removeItem(LS_DRAFT_KEY); } catch (_) {}
  _state = {
    view: 'destination',
    destination: { step: 'category', category: null, vendor: null, standardId: null, standard: null },
    content:     { sector: 'immobilier', fields: {} },
    assets: {
      logo_owned: false, charte_owned: false, fonts_owned: false,
      charte: { primary_hex: '', secondary_hex: '', font_title: '', font_body: '' },
      brand_book_url: '', extra_notes: '',
    },
    output: { codeMaitre: null, llmResponse: null, briefRef: null },
  };
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════
export async function openKodex() {
  if (_root) return;     // déjà ouvert
  await _loadDraft();    // restaure le brouillon si présent
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
}

export function closeKodex() {
  if (!_root) return;
  _saveDraft();          // dernière sauvegarde avant fermeture
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════════
// Construction du shell (top bar + rail + main + aside)
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
        <button class="ws-iconbtn" data-act="history" title="Historique des briefs">
          ${icon('history', 18)}
        </button>
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon (Cmd+S)">
          ${icon('save', 18)}
        </button>
        <button class="ws-iconbtn" data-act="reset" title="Effacer et recommencer">
          ${icon('refresh', 18)}
        </button>
        <button class="ws-iconbtn" data-act="help" title="Aide">
          ${icon('help-circle', 18)}
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
  bindRatingButton(_root, WORKSPACE_META.id);

  _renderRail();
  _renderAside();
}

function _onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'close')          return closeKodex();
  if (act === 'goto')           return _navigate(t.dataset.step);
  if (act === 'next')           return _advance();
  if (act === 'prev')           return _back();
  if (act === 'history')        return _toastSoon('Historique des briefs');
  if (act === 'save')           { _saveDraft(); _toastOk('Brouillon sauvegardé'); return; }
  if (act === 'help')           return _toastSoon('Guide pas-à-pas');
  if (act === 'reset')          {
    if (confirm('Effacer toutes vos saisies et recommencer le brief ?')) {
      _resetDraft();
      _renderMain();
      _toastOk('Brouillon réinitialisé');
    }
    return;
  }
  // Sprint Kodex-2 : navigation interne à la vue Destination
  if (act === 'dest-category')  return _pickCategory(t.dataset.cat);
  if (act === 'dest-vendor')    return _pickVendor(t.dataset.vendor);
  if (act === 'dest-standard')  return _pickStandard(t.dataset.id);
  if (act === 'dest-back')      return _destBack();
  if (act === 'dest-reset')     return _destReset();
  // Sprint Kodex-2 : changement de secteur (profil métier)
  if (act === 'sector-pick')    return _pickSector(t.dataset.sector);
  // Sprint Kodex-3.2 : toggle "asset déjà chez Protein"
  if (act === 'assets-toggle')  return _toggleAsset(t.dataset.key);
}

function _toggleAsset(key) {
  _state.assets[key] = !_state.assets[key];
  _saveDraft();
  _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-2 : changement de profil métier
// ═══════════════════════════════════════════════════════════════
function _pickSector(sectorId) {
  _state.content.sector = sectorId;
  _state.content.fields = {};
  _saveDraft();
  _renderMain();
}

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-2 : navigation interne Destination
// ═══════════════════════════════════════════════════════════════
function _pickCategory(cat) {
  _state.destination.category = cat;
  _state.destination.vendor = null;
  _state.destination.standardId = null;
  _state.destination.standard = null;
  if (cat === 'custom') {
    _state.destination.step = 'product';   // saisie libre (à implémenter)
  } else {
    _state.destination.step = 'vendor';
  }
  _saveDraft();
  _renderMain();
}
function _pickVendor(vendor) {
  _state.destination.vendor = vendor;
  _state.destination.step = 'product';
  _saveDraft();
  _renderMain();
}
async function _pickStandard(id) {
  const std = await getStandard(id);
  _state.destination.standardId = id;
  _state.destination.standard = std;
  _state.destination.step = 'done';
  _saveDraft();
  _renderMain();
}
function _destBack() {
  const d = _state.destination;
  if (d.step === 'done')         { d.step = 'product'; }
  else if (d.step === 'product') { d.step = 'vendor'; d.vendor = null; d.standardId = null; d.standard = null; }
  else if (d.step === 'vendor')  { d.step = 'category'; d.category = null; d.vendor = null; d.standardId = null; d.standard = null; }
  _saveDraft();
  _renderMain();
}

// ── Réinitialise complètement la sélection Destination ────────
function _destReset() {
  _state.destination = {
    step: 'category', category: null, vendor: null,
    standardId: null, standard: null,
  };
  _saveDraft();
  _renderMain();
  _toastOk('Sélection annulée');
}

// ═══════════════════════════════════════════════════════════════
// Rail latéral — liste des étapes
// ═══════════════════════════════════════════════════════════════
function _renderRail() {
  const rail = _root.querySelector('[data-slot="rail"]');
  const idx = _currentStepIndex();
  rail.innerHTML = `
    <div class="ws-rail-section">Étapes</div>
    ${STEPS.map((s, i) => {
      const status = i < idx ? 'is-done' : (i === idx ? 'is-active' : '');
      const numContent = i < idx ? icon('check', 12) : (i + 1);
      return `
        <button class="ws-step ${status}" data-act="goto" data-step="${s.id}">
          <span class="ws-step-num">${numContent}</span>
          <span class="ws-step-icon" style="width:18px;height:18px;">${icon(s.icon, 18)}</span>
          <span class="ws-step-label">${s.label}</span>
        </button>
      `;
    }).join('')}

    <div class="ws-rail-section">Workspace</div>
    <button class="ws-step" data-act="history">
      <span class="ws-step-icon" style="width:18px;height:18px;margin-left:32px;">${icon('history', 18)}</span>
      <span class="ws-step-label">Mes briefs</span>
    </button>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Aside (panel droit) — assistance contextuelle
// ═══════════════════════════════════════════════════════════════
function _renderAside() {
  const aside = _root.querySelector('[data-slot="aside"]');
  aside.innerHTML = `
    <div class="ws-aside-section">
      <div class="ws-aside-title">À quoi ça sert</div>
      <div class="ws-aside-card">
        Kodex vous évite les erreurs d'impression qui coûtent cher&nbsp;:
        résolution insuffisante, marges oubliées, format pas adapté à
        votre imprimeur. Vous repartez avec un brief PDF prêt à envoyer,
        que votre graphiste pourra suivre les yeux fermés.
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Votre progression</div>
      <div class="ws-aside-card" data-slot="progress">
        <span class="ws-badge">Étape ${_currentStepIndex() + 1} sur ${STEPS.length}</span>
      </div>
    </div>

    <div class="ws-aside-section">
      <div class="ws-aside-title">Notre force</div>
      <div class="ws-aside-card">
        <strong style="color: var(--ws-text); display:block; margin-bottom:6px;">
          ${icon('ruler', 14)} Calculateur d'échelle automatique
        </strong>
        Pour les grands formats (bâches, panneaux 4×3), nous calculons
        automatiquement la bonne résolution selon la distance à laquelle
        votre affiche sera vue. Plus de surprise désagréable à la livraison.
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Main panel — dispatch par vue
// ═══════════════════════════════════════════════════════════════
function _renderMain() {
  const main = _root.querySelector('[data-slot="main"]');
  const view = _state.view;
  let html = '';
  if (view === 'destination') html = _viewDestination();
  else if (view === 'content') html = _viewContent();
  else if (view === 'assets')  html = _viewAssets();
  else if (view === 'output')  html = _viewOutput();
  main.innerHTML = `<div class="ws-main-inner">${html}${_stepNav()}</div>`;
  main.scrollTop = 0;

  // Met à jour breadcrumb et rail
  const crumb = _root.querySelector('[data-slot="crumb"]');
  if (crumb) crumb.textContent = _currentStep().label;
  _renderRail();
  const progress = _root.querySelector('[data-slot="progress"]');
  if (progress) {
    progress.innerHTML = `<span class="ws-badge">Étape ${_currentStepIndex() + 1} / ${STEPS.length}</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue 1 — DESTINATION
// ═══════════════════════════════════════════════════════════════
function _viewDestination() {
  const step = _state.destination.step;
  if (step === 'category') return _destStepCategory();
  if (step === 'vendor')   return _destStepVendor();
  if (step === 'product')  return _destStepProduct();
  if (step === 'done')     return _destStepDone();
  return _destStepCategory();
}

// ── Étape 1/3 : Choix de la catégorie ─────────────────────────
function _destStepCategory() {
  const categories = [
    { id: 'print', label: 'Une impression', icon: 'printer',
      desc: 'Flyer, affiche, bâche, carte de visite, brochure&nbsp;— chez Exaprint, Pixartprinting, Vistaprint ou votre imprimeur habituel.' },
    { id: 'social', label: 'Les réseaux sociaux', icon: 'globe',
      desc: 'Instagram, Facebook, LinkedIn, Google Business&nbsp;— post, story, reel ou bannière.' },
    { id: 'press', label: 'Un magazine', icon: 'book-open',
      desc: 'Propriétés Le Figaro, Logic-Immo, Côte Magazine, La Provence&nbsp;— et les autres parutions immo.' },
    { id: 'custom', label: 'Un format à moi', icon: 'custom',
      desc: 'Dimensions libres&nbsp;— vous pouvez aussi joindre le PDF de spécifications de votre prestataire.' },
  ];

  return `
    <span class="ws-eyebrow">${icon('target', 12)} 1 sur 4 · Le support</span>
    <h1 class="ws-h1">Où voulez-vous que votre création apparaisse&nbsp;?</h1>
    <p class="ws-lead">
      Choisissez le support. Nous nous occupons ensuite des contraintes techniques —
      format exact, marges, résolution, colorimétrie. Plus besoin d'aller chercher
      les spécifications du prestataire&nbsp;: on connaît déjà.
    </p>

    <div class="ws-card-grid">
      ${categories.map(c => `
        <div class="ws-card is-clickable"
             data-act="dest-category" data-cat="${c.id}">
          <div class="ws-card-row">
            <div class="ws-card-icon">${icon(c.icon, 22)}</div>
            <div class="ws-card-body">
              <h3 class="ws-card-title">${c.label}</h3>
              <p class="ws-card-desc">${c.desc}</p>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Étape 2/3 : Choix du vendor dans la catégorie ─────────────
function _destStepVendor() {
  const cat = _state.destination.category;
  const catLabel = CATEGORY_LABELS[cat]?.label || cat;
  const root = `<span class="ws-eyebrow">${icon('target', 12)} 1 sur 4 · Le support</span>
    <h1 class="ws-h1">${_esc(catLabel)}&nbsp;— quel prestataire&nbsp;?</h1>
    <p class="ws-lead">
      Sélectionnez votre prestataire pour accéder à ses formats officiels.
      <button class="ws-btn ws-btn--ghost" data-act="dest-back" style="padding:2px 8px;font-size:12px;">
        ${icon('chevron-left', 12)} Changer de catégorie
      </button>
    </p>
    <div class="ws-card-grid" data-slot="vendor-list">
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('package', 24)}</div>
        <p class="ws-empty-desc">Chargement du catalogue…</p>
      </div>
    </div>`;

  // Hydratation asynchrone
  getVendorsByCategory(cat).then(vendors => {
    const slot = _root?.querySelector('[data-slot="vendor-list"]');
    if (!slot) return;
    if (!vendors.length) {
      slot.innerHTML = `<div class="ws-empty">
        <div class="ws-empty-icon">${icon('package', 24)}</div>
        <h3 class="ws-empty-title">Aucun prestataire pour cette catégorie</h3>
        <p class="ws-empty-desc">Le catalogue n'est pas encore peuplé pour ce support.</p>
      </div>`;
      return;
    }
    slot.innerHTML = vendors.map(v => `
      <div class="ws-card is-clickable" data-act="dest-vendor" data-vendor="${_esc(v.vendor)}">
        <div class="ws-card-row">
          <div class="ws-card-icon">${icon(CATEGORY_LABELS[cat]?.icon || 'package', 22)}</div>
          <div class="ws-card-body">
            <h3 class="ws-card-title">${_esc(v.vendor)}</h3>
            <p class="ws-card-desc">${v.count} format${v.count > 1 ? 's' : ''} disponible${v.count > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>
    `).join('');
  });

  return root;
}

// ── Étape 3/3 : Choix du produit chez le vendor ───────────────
function _destStepProduct() {
  const { category, vendor } = _state.destination;

  if (category === 'custom') {
    return `
      <span class="ws-eyebrow">${icon('target', 12)} 1 sur 4 · Le support</span>
      <h1 class="ws-h1">Format personnalisé</h1>
      <p class="ws-lead">
        <button class="ws-btn ws-btn--ghost" data-act="dest-back" style="padding:2px 8px;font-size:12px;">
          ${icon('chevron-left', 12)} Retour
        </button>
      </p>
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('custom', 24)}</div>
        <h3 class="ws-empty-title">Format libre arrivant</h3>
        <p class="ws-empty-desc">Saisie libre des dimensions + upload du PDF de spécifications du prestataire. Sprint Kodex-3.</p>
      </div>
    `;
  }

  const root = `<span class="ws-eyebrow">${icon('target', 12)} 1 sur 4 · Le support</span>
    <h1 class="ws-h1">${_esc(vendor)}&nbsp;— quel format&nbsp;?</h1>
    <p class="ws-lead">
      <button class="ws-btn ws-btn--ghost" data-act="dest-back" style="padding:2px 8px;font-size:12px;">
        ${icon('chevron-left', 12)} Changer de prestataire
      </button>
    </p>
    <div class="ws-card-grid" data-slot="product-list">
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('package', 24)}</div>
        <p class="ws-empty-desc">Chargement…</p>
      </div>
    </div>`;

  getProductsByVendor(category, vendor).then(products => {
    const slot = _root?.querySelector('[data-slot="product-list"]');
    if (!slot) return;
    slot.innerHTML = products.map(p => `
      <div class="ws-card is-clickable" data-act="dest-standard" data-id="${_esc(p.id)}">
        <div class="ws-card-row">
          <div class="ws-card-icon">${icon(CATEGORY_LABELS[category]?.icon || 'package', 22)}</div>
          <div class="ws-card-body">
            <h3 class="ws-card-title">${_esc(p.product_name)}</h3>
            <p class="ws-card-desc">${_esc(formatDimensions(p))} · ${_esc(formatDpi(p) || '')} ${p.color_profile ? '· ' + _esc(p.color_profile) : ''}</p>
          </div>
        </div>
      </div>
    `).join('');
  });

  return root;
}

// ── Récap : standard sélectionné, prêt à passer à l'étape 2 ──
function _destStepDone() {
  const s = _state.destination.standard;
  if (!s) return _destStepCategory();

  const rows = [
    ['Format fini',      formatDimensions(s)],
    ['Format de travail', s.format_travail ? formatDimensions({ format_fini: s.format_travail }) : null],
    ['Fond perdu',       formatBleed(s)],
    ['Marge sécurité',   s.safe_margin_mm ? `${s.safe_margin_mm} mm` : null],
    ['Résolution',       formatDpi(s)],
    ['Échelle de travail', s.scale],
    ['Colorimétrie',     s.color_profile],
    ['Export attendu',   s.export_format],
  ].filter(r => r[1]);

  return `
    <span class="ws-eyebrow">${icon('check', 12)} Support sélectionné</span>
    <h1 class="ws-h1">${_esc(s.vendor)} · ${_esc(s.product_name)}</h1>
    <p class="ws-lead" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span>Voilà les contraintes techniques verrouillées pour votre création.
        Le brief final reprendra ces informations pour votre graphiste.</span>
      <span style="display:inline-flex;gap:8px;">
        <button class="ws-btn ws-btn--ghost" data-act="dest-back" style="padding:4px 10px;font-size:12px;">
          ${icon('chevron-left', 12)} Changer de format
        </button>
        <button class="ws-btn ws-btn--ghost" data-act="dest-reset" style="padding:4px 10px;font-size:12px;color:var(--danger);">
          ${icon('x', 12)} Tout annuler
        </button>
      </span>
    </p>

    <div class="ws-card" style="margin-top:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
        <tbody>
          ${rows.map(([k, v]) => `
            <tr>
              <td style="padding:9px 0;color:var(--ws-text-muted);font-weight:600;width:42%;border-bottom:1px solid var(--ws-border);">${_esc(k)}</td>
              <td style="padding:9px 0;color:var(--ws-text);border-bottom:1px solid var(--ws-border);">${_esc(v)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${s.notes ? `<div style="margin-top:14px;padding:10px 12px;background:var(--ws-accent-soft);border-radius:var(--ws-radius-sm);font-size:12.5px;color:var(--ws-text-soft);">
        <strong style="color:var(--ws-accent);">À noter&nbsp;:</strong> ${_esc(s.notes)}
      </div>` : ''}
    </div>

    ${_renderScaleCalculator(s)}
  `;
}

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-3.1 — Killer feature : calculateur d'échelle
// ═══════════════════════════════════════════════════════════════
function _renderScaleCalculator(std) {
  const calc = computeScale(std);
  if (!calc) return '';

  if (calc.digital) {
    return `
      <div class="ws-card" style="margin-top:14px;background:var(--ws-accent-soft);border-color:transparent;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${icon('sparkles', 18)}
          <strong style="font-size:14px;letter-spacing:-.012em;color:var(--ws-text);">Format numérique</strong>
        </div>
        <p style="margin:8px 0 0 0;font-size:13px;color:var(--ws-text-soft);line-height:1.55;">
          ${_esc(calc.message)}
        </p>
      </div>
    `;
  }

  const rows = [
    ['Distance de vue', `${calc.viewing_distance} (${calc.viewing_context.toLowerCase()})`],
    ['Travail sur maquette', calc.work_format
      ? `${calc.work_format.width_mm} × ${calc.work_format.height_mm} mm — ${calc.factor_label}`
      : calc.factor_label],
    ['Texte titre minimum', `${calc.min_text_mm} mm de hauteur capitale`],
    ['Logo bitmap (PNG/JPG)', calc.min_logo_px ? `${calc.min_logo_px} px de large minimum` : '—'],
  ];

  const isLarge = calc.is_large_format;

  return `
    <div class="ws-card" style="margin-top:14px;border-color:var(--ws-accent);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        ${icon('ruler', 18)}
        <strong style="font-size:14px;letter-spacing:-.012em;color:var(--ws-text);">
          Calculateur d'échelle automatique
        </strong>
        ${isLarge ? `<span class="ws-badge ws-badge--accent" style="margin-left:auto;">Grand format</span>` : ''}
      </div>
      <p style="margin:0 0 12px 0;font-size:12.5px;color:var(--ws-text-muted);line-height:1.55;">
        Voici comment travailler ce format sans erreur de fabrication.
        ${isLarge ? 'À cette taille, votre graphiste doit travailler à l\'échelle réduite.' : ''}
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>
          ${rows.map(([k, v]) => `
            <tr>
              <td style="padding:7px 0;color:var(--ws-text-muted);font-weight:500;width:42%;">${_esc(k)}</td>
              <td style="padding:7px 0;color:var(--ws-text);font-weight:500;">${_esc(v)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${calc.warning ? `
        <div style="margin-top:12px;padding:10px 12px;background:var(--danger-soft);border-radius:var(--ws-radius-sm);font-size:12.5px;color:var(--ws-text);border-left:3px solid var(--danger);">
          <strong style="color:var(--danger);">Attention&nbsp;:</strong> ${_esc(calc.warning)}
        </div>
      ` : ''}

      ${isLarge ? `
        <div style="margin-top:12px;padding:10px 12px;background:var(--info-soft);border-radius:var(--ws-radius-sm);font-size:12.5px;color:var(--ws-text-soft);border-left:3px solid var(--info);line-height:1.55;">
          <strong style="color:var(--info);">Pourquoi ${calc.factor_label.toLowerCase()}&nbsp;?</strong>
          À l'échelle réelle, le fichier final ferait plusieurs gigaoctets — impossible à manipuler.
          On travaille en réduit, et l'imprimeur agrandit pour la sortie.
          La résolution effective reste équivalente à ${calc.target_dpi}&nbsp;DPI à l'impression finale.
        </div>
      ` : ''}
    </div>
  `;
}

// ── Helper d'échappement HTML ─────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ═══════════════════════════════════════════════════════════════
// Vue 2 — CONTENU
// ═══════════════════════════════════════════════════════════════
function _viewContent() {
  const root = `
    <span class="ws-eyebrow">${icon('edit', 12)} 2 sur 4 · Le message</span>
    <h1 class="ws-h1">Que voulez-vous dire&nbsp;?</h1>
    <p class="ws-lead">
      Quelques informations sur votre projet. Les mentions légales obligatoires
      seront ajoutées automatiquement selon les dispositifs que vous cochez.
    </p>

    <div data-slot="sector-picker"></div>
    <form data-slot="sector-form" id="kodex-content-form" autocomplete="off"></form>
    <div data-slot="legal-mentions"></div>
  `;

  // Hydratation asynchrone : charger le sector courant + générer le form
  (async () => {
    const all = await loadSectors();
    const currentId = _state.content.sector || (await getDefaultSector())?.id;
    const sector = await getSector(currentId);
    if (!sector || !_root) return;

    _renderSectorPicker(_root.querySelector('[data-slot="sector-picker"]'), all.sectors, currentId);
    _renderSectorForm(_root.querySelector('[data-slot="sector-form"]'), sector);
    _renderLegalMentions(_root.querySelector('[data-slot="legal-mentions"]'), sector);
  })();

  return root;
}

// ── Sélecteur de profil métier (pills) ────────────────────────
function _renderSectorPicker(slot, sectors, currentId) {
  if (!slot) return;
  if (sectors.length <= 1) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px;align-items:center;">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--ws-text-muted);margin-right:6px;">
        Votre univers
      </span>
      ${sectors.map(s => `
        <button class="ws-btn ${currentId === s.id ? 'ws-btn--accent' : 'ws-btn--secondary'}"
                data-act="sector-pick" data-sector="${_esc(s.id)}"
                style="padding:6px 12px;font-size:12.5px;">
          ${_esc(s.label)}${s._status === 'placeholder' ? ' <span style="font-size:10px;opacity:.6;">(bientôt)</span>' : ''}
        </button>
      `).join('')}
    </div>
  `;
}

// ── Génère le formulaire à partir du sector ───────────────────
function _renderSectorForm(form, sector) {
  if (!form) return;
  const values = _state.content.fields || {};

  // Avis si placeholder
  if (sector._status === 'placeholder') {
    form.innerHTML = `
      <div class="ws-empty">
        <div class="ws-empty-icon">${icon('edit', 24)}</div>
        <h3 class="ws-empty-title">Profil « ${_esc(sector.label)} » bientôt disponible</h3>
        <p class="ws-empty-desc">Ce secteur est en préparation. Pour l'instant, utilisez le profil Immobilier.</p>
      </div>
    `;
    return;
  }

  form.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:14px;margin-bottom:20px;">
      ${sector.fields.map(f => _renderField(f, values[f.name])).join('')}
    </div>
  `;

  // Écouter les changements pour sauvegarder en state + recalculer mentions
  form.addEventListener('input', _onContentChange);
  form.addEventListener('change', _onContentChange);
}

function _renderField(f, value) {
  const id = `kf-${f.name}`;
  const span = f.span === 'full' ? 'grid-column:1 / -1;' : '';
  const req = f.required ? '<span style="color:var(--danger);">*</span>' : '';
  let input = '';

  if (f.type === 'text' || f.type === 'number') {
    input = `<input class="ws-input" id="${id}" name="${f.name}" type="${f.type}"
             value="${value ? _esc(value) : ''}"
             placeholder="${_esc(f.placeholder || '')}"
             ${f.required ? 'required' : ''}>`;
  } else if (f.type === 'textarea') {
    input = `<textarea class="ws-textarea" id="${id}" name="${f.name}"
             rows="${f.rows || 3}"
             placeholder="${_esc(f.placeholder || '')}">${value ? _esc(value) : ''}</textarea>`;
  } else if (f.type === 'select') {
    input = `<select class="ws-select" id="${id}" name="${f.name}">
      <option value="">— Choisir —</option>
      ${(f.options || []).map(o => `<option value="${_esc(o)}" ${value === o ? 'selected' : ''}>${_esc(o)}</option>`).join('')}
    </select>`;
  } else if (f.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    input = `<select class="ws-select" id="${id}" name="${f.name}" multiple style="min-height:96px;">
      ${(f.options || []).map(o => `<option value="${_esc(o)}" ${selected.includes(o) ? 'selected' : ''}>${_esc(o)}</option>`).join('')}
    </select>`;
  }

  return `
    <div class="ws-field" style="${span}">
      <label class="ws-label" for="${id}">${_esc(f.label)} ${req}</label>
      ${input}
      ${f.hint ? `<div style="margin-top:4px;font-size:11.5px;color:var(--ws-text-muted);">${_esc(f.hint)}</div>` : ''}
    </div>
  `;
}

// ── On input/change : récupère toutes les valeurs et persiste ─
function _onContentChange(e) {
  const form = e.currentTarget;
  const values = {};
  for (const el of form.querySelectorAll('input, select, textarea')) {
    if (el.name) {
      if (el.tagName === 'SELECT' && el.multiple) {
        values[el.name] = Array.from(el.selectedOptions).map(o => o.value);
      } else {
        values[el.name] = el.value;
      }
    }
  }
  _state.content.fields = values;
  _scheduleSave();

  // Recalcul des mentions légales si les labels ont changé
  if (e.target?.name === 'labels') {
    getSector(_state.content.sector).then(sector => {
      if (sector && _root) {
        _renderLegalMentions(_root.querySelector('[data-slot="legal-mentions"]'), sector);
      }
    });
  }
}

// Auto-save throttled (toutes les ~600 ms en frappe rapide)
let _saveTimer = null;
function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveDraft, 600);
}

// ── Affiche les mentions légales applicables ──────────────────
function _renderLegalMentions(slot, sector) {
  if (!slot) return;
  const mentions = computeLegalMentions(sector, _state.content.fields);
  if (!mentions.length) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="ws-card" style="margin-top:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        ${icon('shield-check', 18)}
        <strong style="font-size:13px;letter-spacing:-.012em;">Mentions légales qui seront ajoutées au brief</strong>
      </div>
      <ul style="margin:0;padding-left:20px;color:var(--ws-text-soft);font-size:13px;line-height:1.6;">
        ${mentions.map(m => `<li style="margin-bottom:5px;">${_esc(m)}</li>`).join('')}
      </ul>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Vue 3 — ASSETS
// ═══════════════════════════════════════════════════════════════
function _viewAssets() {
  const a = _state.assets;
  const root = `
    <span class="ws-eyebrow">${icon('package', 12)} 3 sur 4 · Les visuels</span>
    <h1 class="ws-h1">Quels éléments visuels avons-nous&nbsp;?</h1>
    <p class="ws-lead">
      Renseignez votre charte graphique en quelques secondes. Si Protein Studio
      a déjà vos logos ou polices, cochez la case correspondante&nbsp;: vous n'aurez
      plus jamais à les renvoyer.
    </p>

    <h2 class="ws-h2">Ce que Protein Studio possède déjà pour vous</h2>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:14px;margin-bottom:24px;">
      ${_renderOwnedToggle('logo_owned',   'Logo',          'image',    a.logo_owned)}
      ${_renderOwnedToggle('charte_owned', 'Charte graphique', 'palette', a.charte_owned)}
      ${_renderOwnedToggle('fonts_owned',  'Polices',       'type',     a.fonts_owned)}
    </div>

    <h2 class="ws-h2">Votre charte graphique rapide</h2>
    <p style="font-size:12.5px;color:var(--ws-text-muted);margin:-6px 0 14px 0;">
      Optionnel mais recommandé&nbsp;: ces informations seront reprises dans le brief final.
    </p>
    <form data-slot="assets-form" id="kodex-assets-form" autocomplete="off">
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:14px;">
        <div class="ws-field">
          <label class="ws-label" for="ka-primary">Couleur principale</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="ws-input" id="ka-primary" name="primary_hex" type="text"
                   value="${_esc(a.charte.primary_hex)}"
                   placeholder="#1B2A4A" maxlength="7" pattern="^#[0-9a-fA-F]{6}$"
                   style="font-family:'SF Mono','Menlo',monospace;">
            <div style="width:42px;height:38px;border-radius:var(--ws-radius-sm);border:1px solid var(--ws-border);background:${a.charte.primary_hex || 'transparent'};flex-shrink:0;" data-slot="preview-primary"></div>
          </div>
        </div>
        <div class="ws-field">
          <label class="ws-label" for="ka-secondary">Couleur secondaire</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="ws-input" id="ka-secondary" name="secondary_hex" type="text"
                   value="${_esc(a.charte.secondary_hex)}"
                   placeholder="#c9a96e" maxlength="7" pattern="^#[0-9a-fA-F]{6}$"
                   style="font-family:'SF Mono','Menlo',monospace;">
            <div style="width:42px;height:38px;border-radius:var(--ws-radius-sm);border:1px solid var(--ws-border);background:${a.charte.secondary_hex || 'transparent'};flex-shrink:0;" data-slot="preview-secondary"></div>
          </div>
        </div>
        <div class="ws-field">
          <label class="ws-label" for="ka-font-title">Police des titres</label>
          <input class="ws-input" id="ka-font-title" name="font_title" type="text"
                 value="${_esc(a.charte.font_title)}"
                 placeholder="ex : Cormorant Garamond, Inter Bold">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="ka-font-body">Police du corps de texte</label>
          <input class="ws-input" id="ka-font-body" name="font_body" type="text"
                 value="${_esc(a.charte.font_body)}"
                 placeholder="ex : Source Sans 3, Inter Regular">
        </div>
        <div class="ws-field" style="grid-column:1 / -1;">
          <label class="ws-label" for="ka-brand-book">Lien vers votre brand book complet (optionnel)</label>
          <input class="ws-input" id="ka-brand-book" name="brand_book_url" type="url"
                 value="${_esc(a.brand_book_url)}"
                 placeholder="https://drive.google.com/...">
          <div style="margin-top:4px;font-size:11.5px;color:var(--ws-text-muted);">
            Si vous avez un PDF brand book, partagez-le ici&nbsp;— le graphiste pourra le consulter.
          </div>
        </div>
        <div class="ws-field" style="grid-column:1 / -1;">
          <label class="ws-label" for="ka-notes">Demandes spéciales pour le graphiste (optionnel)</label>
          <textarea class="ws-textarea" id="ka-notes" name="extra_notes" rows="3"
                    placeholder="ex : éviter le rose, garder un esprit minéral, respecter les espaces vides…">${_esc(a.extra_notes)}</textarea>
        </div>
      </div>
    </form>

    <h2 class="ws-h2">Téléverser des fichiers</h2>
    <div class="ws-empty">
      <div class="ws-empty-icon">${icon('upload-cloud', 24)}</div>
      <h3 class="ws-empty-title">L'espace de dépôt arrive au Sprint suivant</h3>
      <p class="ws-empty-desc">
        Pour l'instant, partagez vos fichiers via le lien brand book ci-dessus.
        L'upload direct (logos, photos, brand book PDF) sera disponible prochainement.
      </p>
    </div>
  `;

  // Wiring asynchrone après injection DOM
  setTimeout(() => _wireAssetsForm(), 0);

  return root;
}

// ── Card cliquable pour toggle "déjà chez Protein" ────────────
function _renderOwnedToggle(key, label, iconName, isOn) {
  return `
    <button class="ws-card is-clickable ${isOn ? 'is-selected' : ''}"
            data-act="assets-toggle" data-key="${key}"
            style="text-align:left;cursor:pointer;background:${isOn ? 'var(--ws-accent-soft)' : 'var(--ws-surface)'};border-color:${isOn ? 'var(--ws-accent)' : 'var(--ws-border)'};">
      <div class="ws-card-row">
        <div class="ws-card-icon" style="background:${isOn ? 'var(--ws-accent)' : 'var(--ws-accent-soft)'};color:${isOn ? '#fff' : 'var(--ws-accent)'};">
          ${icon(isOn ? 'check' : iconName, 22)}
        </div>
        <div class="ws-card-body">
          <h3 class="ws-card-title">${_esc(label)}</h3>
          <p class="ws-card-desc">
            ${isOn
              ? '<strong style="color:var(--ws-accent);">Déjà chez Protein.</strong> Pas besoin de renvoyer.'
              : 'Cliquez si vous l\'avez déjà transmis.'
            }
          </p>
        </div>
      </div>
    </button>
  `;
}

// ── Wiring du formulaire assets ───────────────────────────────
function _wireAssetsForm() {
  const form = _root?.querySelector('[data-slot="assets-form"]');
  if (!form) return;
  form.addEventListener('input', e => {
    const el = e.target;
    if (!el.name) return;
    if (['primary_hex', 'secondary_hex', 'font_title', 'font_body'].includes(el.name)) {
      _state.assets.charte[el.name] = el.value;
      // Live preview des swatches
      if (el.name === 'primary_hex') {
        const sw = _root.querySelector('[data-slot="preview-primary"]');
        if (sw && /^#[0-9a-fA-F]{6}$/.test(el.value)) sw.style.background = el.value;
      }
      if (el.name === 'secondary_hex') {
        const sw = _root.querySelector('[data-slot="preview-secondary"]');
        if (sw && /^#[0-9a-fA-F]{6}$/.test(el.value)) sw.style.background = el.value;
      }
    } else {
      _state.assets[el.name] = el.value;
    }
    _scheduleSave();
  });
}

// ═══════════════════════════════════════════════════════════════
// Vue 4 — OUTPUT
// ═══════════════════════════════════════════════════════════════
function _viewOutput() {
  return `
    <span class="ws-eyebrow">${icon('sparkles', 12)} 4 sur 4 · Le brief</span>
    <h1 class="ws-h1">C'est le moment&nbsp;!</h1>
    <p class="ws-lead">
      Nous assemblons toutes vos informations en un brief technique infaillible,
      prêt à être téléchargé en PDF et envoyé à votre graphiste. En bonus,
      vous recevrez 5 punchlines marketing pour inspirer votre équipe.
    </p>

    <div class="ws-empty">
      <div class="ws-empty-icon">${icon('sparkles', 24)}</div>
      <h3 class="ws-empty-title">Le générateur arrive bientôt</h3>
      <p class="ws-empty-desc">
        En un clic, votre brief PDF sera prêt&nbsp;: contraintes techniques pour
        votre maquettiste, idées d'accroches pour votre communication.
      </p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Step navigation footer (prev / next)
// ═══════════════════════════════════════════════════════════════
function _stepNav() {
  const idx = _currentStepIndex();
  const isLast = idx === STEPS.length - 1;
  const canBack = _canGoBack();

  // Libellé "Précédent" adapté au contexte
  let backLabel = 'Précédent';
  if (_state.view === 'destination') {
    const sub = _state.destination.step;
    if (sub === 'vendor')  backLabel = 'Changer de support';
    if (sub === 'product') backLabel = 'Changer de prestataire';
    if (sub === 'done')    backLabel = 'Changer de format';
  }

  return `
    <div class="ws-step-nav">
      <button class="ws-btn ws-btn--ghost" data-act="prev" ${canBack ? '' : 'disabled style="visibility:hidden;"'}>
        ${icon('chevron-left', 16)} ${_esc(backLabel)}
      </button>
      ${isLast
        ? `<button class="ws-btn ws-btn--accent" data-act="next" disabled>
             ${icon('sparkles', 16)} Générer le brief
           </button>`
        : `<button class="ws-btn ws-btn--primary" data-act="next">
             Étape suivante ${icon('chevron-right', 16)}
           </button>`
      }
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// Navigation entre étapes
// ═══════════════════════════════════════════════════════════════
function _navigate(stepId) {
  if (!STEPS.find(s => s.id === stepId)) return;
  _state.view = stepId;
  _renderMain();
}

function _advance() {
  const i = _currentStepIndex();
  if (i < STEPS.length - 1) _navigate(STEPS[i + 1].id);
}

// ── Bouton "Précédent" en bas — navigation intelligente ───────
// Sprint Kodex-3.4 : si on est dans Destination et qu'on a déjà
// progressé dans son sub-step (vendor / product / done), reculer
// d'un sub-step. Sinon, reculer à la grande étape précédente.
function _back() {
  if (_state.view === 'destination') {
    const sub = _state.destination.step;
    if (sub !== 'category') {
      _destBack();
      return;
    }
    // À 'category' on est tout au début → rien à faire (bouton masqué)
    return;
  }
  // Vues Contenu / Assets / Output : recule à l'étape précédente
  const i = _currentStepIndex();
  if (i > 0) _navigate(STEPS[i - 1].id);
}

// ── Le bouton "Précédent" doit-il être visible/actif ? ────────
function _canGoBack() {
  if (_state.view === 'destination') {
    return _state.destination.step !== 'category';
  }
  return _currentStepIndex() > 0;
}

function _currentStep() { return STEPS.find(s => s.id === _state.view) || STEPS[0]; }
function _currentStepIndex() { return STEPS.findIndex(s => s.id === _state.view); }

// ═══════════════════════════════════════════════════════════════
// Toast minimal pour les actions pas encore branchées
// ═══════════════════════════════════════════════════════════════
function _toastSoon(label) {
  _toast(`${label} — arrivant dans un prochain sprint`);
}
function _toastOk(label) {
  _toast(label, true);
}
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
