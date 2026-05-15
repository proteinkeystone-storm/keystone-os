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
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import {
  loadCatalog, getVendorsByCategory, getProductsByVendor, getStandard,
  formatDimensions, formatBleed, formatDpi, CATEGORY_LABELS,
  loadSectors, getSector, getDefaultSector, computeLegalMentions,
} from './lib/kodex-catalog.js';
import { computeScale, formatFileSize } from './lib/kodex-scale.js';
import { icon } from './lib/ui-icons.js';
import { buildCodeMaitre, validateForGeneration } from './lib/kodex-prompt.js';
import { exportBriefAsPDF } from './lib/kodex-pdf.js';
import { uploadFile, deleteAsset, assetUrl, formatSize, ALLOWED_MIMES as KODEX_ASSET_MIMES } from './lib/kodex-uploader.js';
import { ApiHandler } from './api-handler.js';
import { CF_API } from './pads-loader.js';

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
    // Sprint Kodex-3.1.5 : fichiers uploadés en backend (D1 base64)
    uploads: [],            // [{id, filename, mime, kind, size_bytes, url}]
  },
  output: {
    // Sprint Kodex-4.1 — état de la génération
    status: 'idle',       // idle | building | calling | done | error
    error: null,
    codeMaitre: null,     // le prompt envoyé (debug)
    brief: null,          // { text, model, generated_at, usage }
    briefId: null,        // id de l'entity codex_briefs si sauvegardé
  },
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
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone">
        </a>
        <div class="ws-topbar-brand-right">
          <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">
            ${icon('chevron-left', 34)}
          </button>
          <span class="ws-topbar-app-picto">${icon('kodex', 24)}</span>
        </div>
      </div>
      <div class="ws-topbar-title">
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
        <button class="ws-iconbtn" data-act="load-demo" title="Charger un exemple : Les Jardins du Mourillon (Affiche 4×3)"
                style="color:var(--gold);">
          ${icon('sparkles', 18)}
        </button>
        <button class="ws-iconbtn" data-act="history" title="Historique des briefs">
          ${icon('history', 18)}
        </button>
        <button class="ws-iconbtn" data-act="save" title="Sauvegarder le brouillon (Cmd+S)">
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
  bindRatingButton(_root, WORKSPACE_META.id);
  bindHelpButton(_root, WORKSPACE_META.id);

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
  if (act === 'history')        return _openLibrary();
  if (act === 'lib-close')      return _closeLibrary();
  if (act === 'lib-open')       return _loadBriefFromLibrary(t.dataset.id);
  if (act === 'lib-delete')     return _deleteBriefFromLibrary(t.dataset.id);
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
  // Sprint Kodex-4.1 : génération du brief
  if (act === 'generate-brief') return _generateBrief();
  if (act === 'regenerate')     return _generateBrief();
  if (act === 'view-prompt')    return _toggleViewPrompt(t);
  if (act === 'download-pdf')   return _downloadBriefPdf();
  // Sprint Kodex-3.1.5 : upload / delete fichiers binaires
  if (act === 'upload-delete')  return _handleDeleteUpload(t.dataset.id);
  // Démo Prométhée : pré-remplit le brouillon
  if (act === 'load-demo')      return _loadDemoScenario();
}

// ─── Démo Prométhée : pré-remplit le brouillon avec un scénario ─
async function _loadDemoScenario() {
  if (!confirm('Charger l\'exemple "Les Jardins du Mourillon" ? Votre brouillon actuel sera remplacé.')) return;
  try {
    const res = await fetch('/K_STORE_ASSETS/CATALOG/kodex-demo-promethee.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Scénario démo introuvable');
    const demo = await res.json();
    // Restore le state à partir du scénario
    _state = {
      ..._state,
      ...demo.state,
      destination: { ..._state.destination, ...(demo.state.destination || {}) },
      content:     { ..._state.content,     ...(demo.state.content     || {}) },
      assets:      { ..._state.assets,      ...(demo.state.assets      || {}) },
      output:      { status: 'idle', error: null, codeMaitre: null, brief: null, briefId: null },
    };
    // Re-hydrate l'objet standard à partir de l'id
    if (_state.destination.standardId) {
      _state.destination.standard = await getStandard(_state.destination.standardId);
    }
    _saveDraft();
    _renderMain();
    _toastOk('Scénario démo chargé');
  } catch (e) {
    _toastSoon('Chargement impossible : ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-4.3 — Bibliothèque des briefs sauvegardés
// ═══════════════════════════════════════════════════════════════
async function _openLibrary() {
  // Construit l'overlay s'il n'existe pas
  let overlay = _root?.querySelector('[data-slot="kodex-library"]');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.dataset.slot = 'kodex-library';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: 10000,
      background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '8vh',
    });
    overlay.innerHTML = `
      <div class="ws-card" style="width:90%;max-width:780px;max-height:80vh;display:flex;flex-direction:column;padding:24px 28px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ws-text-muted);">Bibliothèque</div>
            <h2 style="margin:4px 0 0 0;font-size:22px;font-weight:800;letter-spacing:-.022em;">Mes briefs Kodex</h2>
          </div>
          <button class="ws-iconbtn" data-act="lib-close" title="Fermer">${icon('x', 18)}</button>
        </div>
        <div data-slot="lib-list" style="overflow-y:auto;flex:1;margin:-4px -4px;padding:4px;">
          <div class="ws-empty">
            <div class="ws-empty-icon">${icon('history', 24)}</div>
            <p class="ws-empty-desc">Chargement…</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    // Click hors de la card → ferme
    overlay.addEventListener('click', e => {
      if (e.target === overlay) _closeLibrary();
    });
  }

  // Hydratation asynchrone
  const list = overlay.querySelector('[data-slot="lib-list"]');
  try {
    const briefs = await _fetchBriefs();
    if (!briefs.length) {
      list.innerHTML = `
        <div class="ws-empty">
          <div class="ws-empty-icon">${icon('history', 24)}</div>
          <h3 class="ws-empty-title">Pas encore de brief sauvegardé</h3>
          <p class="ws-empty-desc">Votre prochain brief généré apparaîtra ici, prêt à être ré-ouvert ou dupliqué.</p>
        </div>
      `;
      return;
    }
    list.innerHTML = briefs.map(b => _renderBriefCard(b)).join('');
  } catch (e) {
    list.innerHTML = `
      <div class="ws-empty">
        <div class="ws-empty-icon" style="color:var(--danger);">${icon('x', 24)}</div>
        <h3 class="ws-empty-title">Chargement impossible</h3>
        <p class="ws-empty-desc">${_esc(e.message)}</p>
      </div>
    `;
  }
}

function _closeLibrary() {
  _root?.querySelector('[data-slot="kodex-library"]')?.remove();
  // Si on l'a ajouté au body (cas overlay) :
  document.querySelector('[data-slot="kodex-library"]')?.remove();
}

async function _fetchBriefs() {
  const jwt = localStorage.getItem('ks_jwt');
  if (!jwt) throw new Error('Connexion requise. Activez votre licence pour synchroniser les briefs.');
  const res = await fetch(`${CF_API}/api/data/codex_briefs?limit=50`, {
    headers: { 'Authorization': 'Bearer ' + jwt },
  });
  if (!res.ok) throw new Error('Erreur ' + res.status);
  const data = await res.json();
  return (data.items || []).sort((a, b) =>
    (b._updatedAt || '').localeCompare(a._updatedAt || '')
  );
}

function _renderBriefCard(b) {
  const date = b._updatedAt
    ? new Date(b._updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
  return `
    <div class="ws-card" style="margin-bottom:10px;padding:14px 16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;letter-spacing:-.012em;">${_esc(b.title || 'Sans titre')}</h3>
          <p style="margin:0;font-size:12px;color:var(--ws-text-muted);">
            ${b.vendor ? _esc(b.vendor) + ' · ' : ''}${_esc(b.product_name || '')}
            <span style="margin:0 6px;">·</span>
            ${_esc(date)}
            ${b.brief_model ? `<span style="margin:0 6px;">·</span><span>${_esc(b.brief_model)}</span>` : ''}
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="ws-btn ws-btn--secondary" data-act="lib-open" data-id="${_esc(b.id)}" style="padding:6px 12px;font-size:12px;">
            ${icon('arrow-right', 14)} Ouvrir
          </button>
          <button class="ws-iconbtn" data-act="lib-delete" data-id="${_esc(b.id)}" title="Supprimer" style="color:var(--danger);">
            ${icon('x', 16)}
          </button>
        </div>
      </div>
    </div>
  `;
}

async function _loadBriefFromLibrary(id) {
  const jwt = localStorage.getItem('ks_jwt');
  if (!jwt) return;
  try {
    const res = await fetch(`${CF_API}/api/data/codex_briefs/${id}`, {
      headers: { 'Authorization': 'Bearer ' + jwt },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const b = await res.json();

    // Restore le state Kodex à partir du brief sauvegardé
    if (b.standard_id) {
      _state.destination.standardId = b.standard_id;
      _state.destination.standard = await getStandard(b.standard_id);
      _state.destination.vendor   = b.vendor || null;
      _state.destination.step     = 'done';
    }
    if (b.sector) _state.content.sector = b.sector;
    if (b.fields) _state.content.fields = b.fields;
    if (b.assets_snapshot) _state.assets = { ..._state.assets, ...b.assets_snapshot };

    _state.output = {
      status: 'done',
      error: null,
      codeMaitre: b.code_maitre || null,
      brief: b.brief_text ? {
        text: b.brief_text,
        model: b.brief_model || '—',
        generated_at: b.generated_at || b._updatedAt,
      } : null,
      briefId: id,
    };
    _state.view = 'output';

    _saveDraft();
    _closeLibrary();
    _renderMain();
    _hydrateBriefText();
    _toastOk('Brief chargé');
  } catch (e) {
    _toastSoon('Ouverture impossible : ' + e.message);
  }
}

async function _deleteBriefFromLibrary(id) {
  if (!confirm('Supprimer définitivement ce brief de votre bibliothèque ?')) return;
  const jwt = localStorage.getItem('ks_jwt');
  if (!jwt) return;
  try {
    const res = await fetch(`${CF_API}/api/data/codex_briefs/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + jwt },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _toastOk('Brief supprimé');
    _openLibrary();   // refresh
  } catch (e) {
    _toastSoon('Suppression impossible : ' + e.message);
  }
}

// ─── Sprint Kodex-4.2 — Export du brief en PDF ────────────────
async function _downloadBriefPdf() {
  try {
    const sector = await getSector(_state.content.sector);
    exportBriefAsPDF(_state, sector);
    _toastOk('Boîte d\'impression ouverte');
  } catch (e) {
    console.error('[Kodex] PDF export failed:', e);
    _toastSoon('Export PDF échoué');
  }
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

  // Rail mis à jour (le crumb d'étape a été retiré du hero, le rail
  // gauche reste la source de vérité de l'étape courante).
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
    slot.innerHTML = products.map(p => {
      // Description : on assemble les parties disponibles (dimensions,
      // résolution, colorimétrie) en ignorant les valeurs absentes —
      // les formats numériques n'ont pas de DPI.
      const desc = [formatDimensions(p), formatDpi(p), p.color_profile]
        .filter(Boolean).map(_esc).join(' · ');
      return `
      <div class="ws-card is-clickable" data-act="dest-standard" data-id="${_esc(p.id)}">
        <div class="ws-card-row">
          <div class="ws-card-icon">${icon(CATEGORY_LABELS[category]?.icon || 'package', 22)}</div>
          <div class="ws-card-body">
            <h3 class="ws-card-title">${_esc(p.product_name)}</h3>
            <p class="ws-card-desc">${desc}</p>
          </div>
        </div>
      </div>
    `;
    }).join('');
  });

  return root;
}

// ── Récap : standard sélectionné, prêt à passer à l'étape 2 ──
function _destStepDone() {
  const s = _state.destination.standard;
  if (!s) return _destStepCategory();

  // Résolution : toujours 300 DPI dans le modèle Kodex (cf. kodex-scale.js).
  // L'échelle de travail et le format de travail réel sont gérés par le
  // calculateur d'échelle juste en dessous — on ne les duplique pas ici
  // pour éviter toute contradiction (échelle réelle vs échelle réduite).
  const _scale = computeScale(s);
  const rows = [
    ['Format fini',    formatDimensions(s)],
    ['Fond perdu',     formatBleed(s)],
    ['Marge sécurité', s.safe_margin_mm ? `${s.safe_margin_mm} mm` : null],
    ['Résolution',     _scale ? `${_scale.output_dpi} DPI` : formatDpi(s)],
    ['Colorimétrie',   s.color_profile],
    ['Export attendu', s.export_format],
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

  const wf = calc.work_format;
  const rows = [
    ['Résolution de sortie', `${calc.output_dpi} DPI — fixe, jamais dégradée`],
    ['Distance de vue', `${calc.viewing_distance} (${calc.viewing_context.toLowerCase()})`],
    ['Travail sur maquette', wf
      ? `${wf.width_mm} × ${wf.height_mm} mm — ${calc.factor_label}`
      : calc.factor_label],
    ['Fichier à produire', wf
      ? `${wf.width_px} × ${wf.height_px} px (~${formatFileSize(wf.file_bytes_work)})`
      : '—'],
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

      ${isLarge && wf ? `
        <div style="margin-top:12px;padding:10px 12px;background:var(--info-soft);border-radius:var(--ws-radius-sm);font-size:12.5px;color:var(--ws-text-soft);border-left:3px solid var(--info);line-height:1.55;">
          <strong style="color:var(--info);">Pourquoi ${calc.factor_label.toLowerCase()}&nbsp;?</strong>
          On garde les ${calc.output_dpi}&nbsp;DPI — c'est la <em>taille du fichier</em> qu'on réduit, pas la résolution.
          À l'échelle réelle, le fichier pèserait ~${formatFileSize(wf.file_bytes_full)} : impossible à manipuler.
          À ${calc.factor_label.toLowerCase()}, il tombe à ~${formatFileSize(wf.file_bytes_work)} tout en restant à ${calc.output_dpi}&nbsp;DPI.
          L'imprimeur agrandit ensuite pour la sortie.
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
    const selected = Array.isArray(value) ? value : (value ? [value] : []);
    const check = '<svg class="ws-chip-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>';
    input = `<div class="ws-chips" id="${id}" data-multiselect="${f.name}">
      ${(f.options || []).map(o => {
        const on = selected.includes(o);
        return `<label class="ws-chip${on ? ' selected' : ''}">
          <input type="checkbox" name="${f.name}" value="${_esc(o)}" ${on ? 'checked' : ''} hidden>
          ${check}<span>${_esc(o)}</span>
        </label>`;
      }).join('')}
    </div>`;
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
    if (!el.name) continue;
    if (el.tagName === 'SELECT' && el.multiple) {
      values[el.name] = Array.from(el.selectedOptions).map(o => o.value);
    } else if (el.type === 'checkbox') {
      // Chips multi-sélection : on agrège toutes les cases cochées d'un même name
      if (!Array.isArray(values[el.name])) values[el.name] = [];
      if (el.checked) values[el.name].push(el.value);
    } else {
      values[el.name] = el.value;
    }
  }
  // Reflète l'état visuel des chips (classe .selected sur le <label>)
  if (e.target?.type === 'checkbox') {
    e.target.closest('.ws-chip')?.classList.toggle('selected', e.target.checked);
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
    <p style="font-size:12.5px;color:var(--ws-text-muted);margin:-6px 0 14px 0;">
      Glissez vos logos, illustrations, brand book ou gabarits ici. Stockage en
      Europe, 2 Mo max par fichier. Formats acceptés : PNG, JPG, SVG, PDF, AI, EPS.
    </p>

    <div class="kodex-dropzone" data-slot="dropzone"
         style="border:1.5px dashed var(--ws-border-strong);border-radius:var(--ws-radius-lg);
                padding:32px 24px;text-align:center;transition:all 180ms ease;
                background:rgba(255,255,255,.015);cursor:pointer;">
      <div style="display:inline-flex;width:48px;height:48px;border-radius:var(--ws-radius);
                  background:var(--ws-surface);color:var(--ws-text-muted);
                  align-items:center;justify-content:center;margin-bottom:10px;
                  border:1px solid var(--ws-border);">
        ${icon('upload-cloud', 24)}
      </div>
      <p style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:var(--ws-text);">
        Glissez vos fichiers ici
      </p>
      <p style="margin:0 0 12px 0;font-size:12.5px;color:var(--ws-text-muted);">
        ou
      </p>
      <button class="ws-btn ws-btn--secondary" type="button" data-act="upload-pick" style="padding:7px 16px;font-size:13px;">
        Sélectionner depuis votre ordinateur
      </button>
      <input type="file" data-slot="file-input" hidden
             accept="${KODEX_ASSET_MIMES.join(',')}" multiple>
    </div>

    <div data-slot="upload-list" style="margin-top:16px;"></div>
  `;

  // Wiring asynchrone après injection DOM
  setTimeout(() => { _wireAssetsForm(); _wireUploader(); _renderUploadList(); }, 0);

  return root;
}

// ── Wiring de la dropzone d'upload ────────────────────────────
function _wireUploader() {
  const drop = _root?.querySelector('[data-slot="dropzone"]');
  const inp  = _root?.querySelector('[data-slot="file-input"]');
  if (!drop || !inp) return;

  // Click sur la zone OU sur le bouton "Sélectionner"
  drop.addEventListener('click', e => {
    if (e.target.closest('button[data-act]') == null && e.target.tagName !== 'INPUT') {
      inp.click();
    }
  });
  const pickBtn = drop.querySelector('[data-act="upload-pick"]');
  if (pickBtn) pickBtn.addEventListener('click', e => { e.stopPropagation(); inp.click(); });

  inp.addEventListener('change', e => {
    [...e.target.files].forEach(_handleUploadFile);
    inp.value = '';
  });

  // Drag-drop
  ['dragenter', 'dragover'].forEach(ev => {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.style.borderColor = 'var(--ws-accent)';
      drop.style.background = 'var(--ws-accent-soft)';
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.style.borderColor = 'var(--ws-border-strong)';
      drop.style.background = 'rgba(255,255,255,.015)';
    });
  });
  drop.addEventListener('drop', e => {
    [...(e.dataTransfer?.files || [])].forEach(_handleUploadFile);
  });
}

// ── Détecte le kind selon le filename + lance l'upload ────────
async function _handleUploadFile(file) {
  // Heuristique simple sur le nom
  let kind = 'autre';
  const n = (file.name || '').toLowerCase();
  if (/logo/.test(n))                                       kind = 'logo';
  else if (/charte|brand[ _-]?book|guideline/.test(n))      kind = 'brand_book';
  else if (/gabarit|template|spec/.test(n))                 kind = 'gabarit';
  else if (file.type.startsWith('image/'))                  kind = 'illustration';

  _addPendingUploadCard(file);
  try {
    const asset = await uploadFile(file, kind);
    _state.assets.uploads.push({
      id: asset.id, filename: asset.filename, mime: asset.mime,
      kind: asset.kind, size_bytes: asset.size_bytes, url: asset.url,
    });
    _saveDraft();
    _renderUploadList();
    _toastOk(`${file.name} envoyé`);
  } catch (e) {
    _renderUploadList();
    _toastSoon('Échec : ' + e.message);
  }
}

// Card temporaire "en cours d'upload"
function _addPendingUploadCard(file) {
  const list = _root?.querySelector('[data-slot="upload-list"]');
  if (!list) return;
  const card = document.createElement('div');
  card.className = 'ws-card';
  card.style.cssText = 'margin-bottom:8px;padding:12px 14px;opacity:.6;';
  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:36px;height:36px;border-radius:var(--ws-radius-sm);background:var(--ws-accent-soft);display:flex;align-items:center;justify-content:center;color:var(--ws-accent);">
        ${icon('upload-cloud', 18)}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:var(--ws-text);">${_esc(file.name)}</div>
        <div style="font-size:11px;color:var(--ws-text-muted);">Envoi en cours…</div>
      </div>
    </div>
  `;
  list.appendChild(card);
}

// ── Liste des assets uploadés ─────────────────────────────────
function _renderUploadList() {
  const list = _root?.querySelector('[data-slot="upload-list"]');
  if (!list) return;
  const uploads = _state.assets.uploads || [];
  if (!uploads.length) { list.innerHTML = ''; return; }
  list.innerHTML = uploads.map(u => {
    const isImg = (u.mime || '').startsWith('image/');
    const thumb = isImg
      ? `<img src="${_esc(assetUrl(u.id))}" alt="" style="width:44px;height:44px;border-radius:var(--ws-radius-sm);object-fit:cover;flex-shrink:0;background:var(--ws-surface);" loading="lazy">`
      : `<div style="width:44px;height:44px;border-radius:var(--ws-radius-sm);background:var(--ws-accent-soft);display:flex;align-items:center;justify-content:center;color:var(--ws-accent);flex-shrink:0;">${icon('file-text', 22)}</div>`;
    return `
      <div class="ws-card" style="margin-bottom:8px;padding:12px 14px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${thumb}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--ws-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(u.filename)}</div>
            <div style="font-size:11px;color:var(--ws-text-muted);">
              <span class="ws-badge" style="text-transform:uppercase;font-size:9px;letter-spacing:.04em;">${_esc(u.kind)}</span>
              <span style="margin:0 6px;">·</span>
              ${_esc(formatSize(u.size_bytes))}
            </div>
          </div>
          <button class="ws-iconbtn" data-act="upload-delete" data-id="${_esc(u.id)}"
                  title="Supprimer ce fichier" style="color:var(--danger);">
            ${icon('x', 16)}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Handler suppression ───────────────────────────────────────
async function _handleDeleteUpload(id) {
  if (!confirm('Supprimer ce fichier de votre coffre-fort ?')) return;
  try {
    await deleteAsset(id);
    _state.assets.uploads = (_state.assets.uploads || []).filter(u => u.id !== id);
    _saveDraft();
    _renderUploadList();
    _toastOk('Fichier supprimé');
  } catch (e) {
    _toastSoon('Suppression impossible : ' + e.message);
  }
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
  const o = _state.output;
  const validationError = validateForGeneration(_state);
  const activeEngine = localStorage.getItem('ks_active_engine') || 'Claude';

  let body = '';

  // ── État : déjà généré → afficher le résultat ─────────────
  if (o.status === 'done' && o.brief) {
    body = _renderBriefResult();
  }
  // ── État : en cours d'appel ─────────────────────────────
  else if (o.status === 'calling' || o.status === 'building') {
    body = `
      <div class="ws-card" style="text-align:center;padding:48px 24px;">
        <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold3);align-items:center;justify-content:center;margin-bottom:16px;animation:ws-pulse 1.4s ease-in-out infinite;">
          ${icon('sparkles', 28)}
        </div>
        <h3 style="font-size:16px;font-weight:700;letter-spacing:-.018em;margin:0 0 6px 0;">Kodex assemble votre brief…</h3>
        <p style="margin:0;font-size:13px;color:var(--ws-text-muted);max-width:380px;margin-inline:auto;line-height:1.55;">
          Nous croisons les contraintes techniques avec vos données projet et la charte. L'IA produit la synthèse — généralement 10 à 20 secondes.
        </p>
      </div>
      <style>
        @keyframes ws-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.08); opacity: .7; }
        }
      </style>
    `;
  }
  // ── État : erreur ────────────────────────────────────────
  else if (o.status === 'error') {
    body = `
      <div class="ws-card" style="border-color:var(--danger);background:var(--danger-soft);">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          ${icon('x', 22)}
          <div>
            <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:var(--danger);">La génération a échoué</h3>
            <p style="margin:0;font-size:13px;color:var(--ws-text);line-height:1.5;">${_esc(o.error || 'Erreur inconnue.')}</p>
          </div>
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="ws-btn ws-btn--accent" data-act="regenerate">
          ${icon('refresh', 16)} Réessayer
        </button>
      </div>
    `;
  }
  // ── État initial : invitation à générer ──────────────────
  else {
    const canGenerate = !validationError;
    body = `
      <div class="ws-card" style="text-align:center;padding:48px 24px;${canGenerate ? '' : 'opacity:.7;'}">
        <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold3);align-items:center;justify-content:center;margin-bottom:16px;color:var(--gold);">
          ${icon('sparkles', 28)}
        </div>
        <h3 style="font-size:18px;font-weight:800;letter-spacing:-.018em;margin:0 0 8px 0;">Tout est prêt pour générer votre brief</h3>
        <p style="margin:0 0 20px 0;font-size:13.5px;color:var(--ws-text-soft);max-width:440px;margin-inline:auto;line-height:1.6;">
          Kodex va interroger le moteur <strong style="color:var(--ws-text);">${_esc(activeEngine)}</strong> avec
          votre clé API personnelle (BYOK). Aucune donnée projet ne transite par nos serveurs au-delà du proxy technique.
        </p>
        <button class="ws-btn ws-btn--accent" data-act="generate-brief" ${canGenerate ? '' : 'disabled'} style="padding:12px 22px;font-size:14px;">
          ${icon('sparkles', 16)} Générer le brief
        </button>
        ${validationError ? `
          <div style="margin-top:14px;font-size:12.5px;color:var(--warn);display:inline-flex;align-items:center;gap:6px;">
            ${icon('x', 14)} ${_esc(validationError)}
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <span class="ws-eyebrow">${icon('sparkles', 12)} 4 sur 4 · Le brief</span>
    <h1 class="ws-h1">${o.status === 'done' ? 'Votre brief est prêt' : 'C\'est le moment&nbsp;!'}</h1>
    <p class="ws-lead">
      ${o.status === 'done'
        ? 'Voici le cahier des charges technique infaillible à envoyer à votre graphiste. Vous pouvez le réviser, le régénérer ou le télécharger.'
        : 'Nous assemblons toutes vos informations en un brief technique infaillible, prêt à envoyer à votre graphiste. En bonus, 5 punchlines marketing pour inspirer votre équipe.'
      }
    </p>
    ${body}
  `;
}

// ── Affichage du résultat IA + actions ────────────────────────
function _renderBriefResult() {
  const o = _state.output;
  const brief = o.brief;
  const generatedAt = brief?.generated_at ? new Date(brief.generated_at).toLocaleString('fr-FR') : '—';

  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">
      <span class="ws-badge ws-badge--success">${icon('check', 12)} Généré le ${_esc(generatedAt)}</span>
      ${brief.model ? `<span class="ws-badge">Modèle : ${_esc(brief.model)}</span>` : ''}
      ${o.briefId ? `<span class="ws-badge">Sauvegardé en bibliothèque</span>` : `<span class="ws-badge" style="color:var(--warn);">Brouillon non sauvegardé</span>`}
    </div>

    <div class="ws-card" style="padding:24px 28px;">
      <div data-slot="brief-text" style="font-size:14px;line-height:1.7;color:var(--ws-text);"></div>
    </div>

    <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
      <button class="ws-btn ws-btn--accent" data-act="download-pdf">
        ${icon('download', 16)} Télécharger en PDF
      </button>
      <button class="ws-btn ws-btn--secondary" data-act="regenerate">
        ${icon('refresh', 16)} Régénérer
      </button>
      <button class="ws-btn ws-btn--ghost" data-act="view-prompt">
        ${icon('file-text', 16)} Voir le Code Maître envoyé
      </button>
    </div>

    <details data-slot="prompt-details" style="margin-top:14px;display:none;">
      <summary style="font-size:12.5px;color:var(--ws-text-muted);cursor:pointer;">Détail du prompt</summary>
      <pre style="margin-top:10px;padding:12px;background:var(--navy3);border-radius:var(--ws-radius);font-size:11px;line-height:1.5;color:var(--ws-text-soft);overflow:auto;max-height:300px;white-space:pre-wrap;">${_esc(o.codeMaitre || '')}</pre>
    </details>
  `;
}

// ── Affichage markdown très light dans la card brief ──────────
function _hydrateBriefText() {
  const slot = _root?.querySelector('[data-slot="brief-text"]');
  if (!slot || !_state.output.brief?.text) return;
  slot.innerHTML = _mdLite(_state.output.brief.text);
}

function _toggleViewPrompt(btn) {
  const det = _root?.querySelector('[data-slot="prompt-details"]');
  if (!det) return;
  det.style.display = det.style.display === 'block' ? 'none' : 'block';
}

// Conversion markdown → HTML ultra-minimaliste (titres, gras, listes)
function _mdLite(text) {
  let html = _esc(text);
  // Titres
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--ws-text-muted);margin:18px 0 8px 0;">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm,  '<h2 style="font-size:16px;font-weight:700;letter-spacing:-.012em;margin:24px 0 10px 0;color:var(--ws-text);">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm,   '<h1 style="font-size:18px;font-weight:800;letter-spacing:-.018em;margin:24px 0 12px 0;color:var(--ws-text);">$1</h1>');
  // Gras
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ws-text);font-weight:700;">$1</strong>');
  // Listes : on regroupe les lignes "- " consécutives
  html = html.replace(/((?:^- .+(?:\n|$))+)/gm, m => {
    const items = m.trim().split('\n').map(l => '<li style="margin:5px 0;">' + l.replace(/^- /, '') + '</li>').join('');
    return `<ul style="margin:10px 0;padding-left:22px;">${items}</ul>`;
  });
  // Paragraphes (les blocs séparés par double newline qui ne sont pas déjà du HTML)
  html = html.split(/\n\n+/).map(block => {
    if (/^<(h\d|ul|li|strong)/.test(block.trim())) return block;
    return `<p style="margin:8px 0;">${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

// ═══════════════════════════════════════════════════════════════
// Sprint Kodex-4.1 — Génération du brief via PromptEngine
// ═══════════════════════════════════════════════════════════════
async function _generateBrief() {
  const err = validateForGeneration(_state);
  if (err) { _toastSoon(err); return; }

  // Récupère le moteur actif + la clé API du vault user (localStorage)
  const engineLabel = localStorage.getItem('ks_active_engine') || 'Claude';
  const engineKey   = _findApiKeyForEngine(engineLabel);
  if (!engineKey) {
    _state.output.status = 'error';
    _state.output.error  = `Aucune clé API ${engineLabel} configurée. Allez dans Réglages → Vault pour la saisir.`;
    _saveDraft();
    _renderMain();
    return;
  }

  _state.output.status = 'building';
  _renderMain();

  // Construit le prompt
  let prompt;
  try {
    const sector = await getSector(_state.content.sector);
    prompt = buildCodeMaitre(_state, sector);
    _state.output.codeMaitre = prompt;
  } catch (e) {
    _state.output.status = 'error';
    _state.output.error = `Construction du prompt échouée : ${e.message}`;
    _renderMain();
    return;
  }

  // Appelle le moteur via PromptEngine (BYOK proxy Worker)
  _state.output.status = 'calling';
  _renderMain();

  try {
    const text = await ApiHandler.callEngine(engineLabel, prompt, engineKey);
    _state.output.brief = {
      text,
      model: engineLabel,
      generated_at: new Date().toISOString(),
    };
    _state.output.status = 'done';
    _state.output.error = null;

    // Sauvegarde dans D1 entity codex_briefs (best-effort)
    _saveBriefInLibrary().catch(e => console.warn('[Kodex] save brief failed:', e.message));

    _saveDraft();
    _renderMain();
    _hydrateBriefText();
    _toastOk('Brief généré');
  } catch (e) {
    _state.output.status = 'error';
    _state.output.error = e.message || 'Erreur lors de l\'appel au moteur AI.';
    _saveDraft();
    _renderMain();
  }
}

// ── Trouve la clé API du vault correspondant au moteur ────────
function _findApiKeyForEngine(label) {
  const map = {
    'Claude'    : 'anthropic',
    'ChatGPT'   : 'openai',
    'GPT 5'     : 'openai',
    'Gemini'    : 'gemini',
    'Mistral'   : 'mistral',
    'Grok'      : 'xai',
    'Perplexity': 'perplexity',
    'Llama'     : 'meta',
  };
  const id = map[label] || label.toLowerCase();
  return localStorage.getItem('ks_api_' + id) || null;
}

// ── Sauvegarde du brief en bibliothèque (D1 entity codex_briefs) ──
async function _saveBriefInLibrary() {
  const jwt = localStorage.getItem('ks_jwt');
  if (!jwt) return;       // pas de licence → pas de cloud (offline OK)

  const payload = {
    title: _briefTitle(),
    standard_id: _state.destination.standardId,
    vendor: _state.destination.standard?.vendor,
    product_name: _state.destination.standard?.product_name,
    sector: _state.content.sector,
    fields: _state.content.fields,
    assets_snapshot: _state.assets,
    code_maitre: _state.output.codeMaitre,
    brief_text: _state.output.brief.text,
    brief_model: _state.output.brief.model,
    generated_at: _state.output.brief.generated_at,
  };

  const res = await fetch(`${CF_API}/api/data/codex_briefs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    const data = await res.json();
    _state.output.briefId = data.id;
  }
}

// ── Titre lisible pour un brief sauvegardé ────────────────────
function _briefTitle() {
  const std  = _state.destination.standard;
  const prog = _state.content.fields?.nom_programme;
  const parts = [];
  if (prog) parts.push(prog);
  if (std)  parts.push(`${std.product_name} ${std.vendor}`);
  return parts.join(' — ') || 'Brief sans titre';
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
