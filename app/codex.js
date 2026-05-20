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
import { burgerHTML, bindBurger }            from './lib/topbar-burger.js';
import {
  loadCategories, getCategory, getCategoryDefaults,
  // v3 vendor-aware
  loadVendors, getVendor, getSupportsByCategory, getSupport,
  getSpec, specToStandard, getVendorsForSupport,
  // utils
  formatDimensions, formatBleed,
  // secteurs métier
  loadSectors, getSector, getDefaultSector, computeLegalMentions,
} from './lib/kodex-catalog.js';
import { computeScale, formatFileSize } from './lib/kodex-scale.js';
import { icon } from './lib/ui-icons.js';
import { buildCodeMaitre, validateForGeneration } from './lib/kodex-prompt.js';
import { exportBriefAsPDF } from './lib/kodex-pdf.js';
import { openSettingsTo } from './ui-renderer.js';
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
// Refonte vendor-aware (mai 2026 v3) : `destination` aplati.
//   - category : 'print_paper' | 'large_format' | 'digital' | 'press' | null
//   - support_id : id du support choisi (null si vide)
//   - vendor_id  : id du vendor choisi ('exaprint' | 'vistaprint' |
//                  'pixartprinting' | 'other' | null)
//   - standard : objet technique modifiable (forme historique conservée
//                pour kodex-prompt / kodex-pdf / kodex-scale).
//                On y trouve aussi `vendor_id` pour re-hydratation.
//   - vendor_url, specs_pdf : visible si vendor_id === 'other'
//   - _form_open : si true, le form détaillé est déplié (sinon récap visuel)
//   - preset_id (legacy) : conservé en miroir de support_id pour rétro-compat
//                          avec les briefs D1 existants.
let _state = {
  view: 'destination',
  destination: {
    category: null,
    support_id: null,
    vendor_id: null,
    standard: null,
    vendor_url: '',
    specs_pdf: null,
    _form_open: false,
  },
  content:     { sector: 'universal', fields: {} },
  assets: {
    // Sprint Kodex-3.2 : coffre-fort minimal
    logo_owned:   false,    // ✓ logo déjà transmis au graphiste
    charte_owned: false,    // ✓ charte graphique déjà transmise au graphiste
    fonts_owned:  false,    // ✓ polices fournies au graphiste
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

    // Migration : ancien format préhistorique (step/vendor/standardId/category=print|social|press|custom)
    // → reset propre, on ne tente pas de mapping fragile.
    const d = data.destination || {};
    const isOldFormat = (
      d.step != null ||
      typeof d.vendor === 'string' ||
      d.standardId != null ||
      ['print', 'social', 'press', 'custom'].includes(d.category)
    );
    if (isOldFormat) {
      _resetDraft();
      setTimeout(() => _toastOk('Brouillon ancien format réinitialisé'), 600);
      return false;
    }

    // Merge non destructif (préserve les défauts si la structure a évolué)
    _state = {
      ..._state,
      ...data,
      destination: { ..._state.destination, ...(data.destination || {}) },
      content:     { ..._state.content, ...(data.content || {}) },
      assets:      { ..._state.assets, ...(data.assets || {}) },
      output:      { ..._state.output, ...(data.output || {}) },
    };

    // Migration v2 → v3 vendor-aware : recopie preset_id → support_id et
    // assigne vendor_id par défaut si le draft contenait déjà un vendor.
    const dst = _state.destination;
    if (dst.preset_id && !dst.support_id) {
      dst.support_id = dst.preset_id;
    }
    if (!dst.vendor_id && dst.standard?.vendor) {
      // Tentative best-effort : on tagge le vendor_id si on retrouve un match
      const v = String(dst.standard.vendor).toLowerCase();
      if (v.includes('exa'))       dst.vendor_id = 'exaprint';
      else if (v.includes('vista')) dst.vendor_id = 'vistaprint';
      else if (v.includes('pixart')) dst.vendor_id = 'pixartprinting';
      else                            dst.vendor_id = 'other';
    }
    dst._form_open = false;       // form replié à chaque session
    delete dst._hint_shown;       // ancien flag d'animation didactique

    // Migration sector v2 → v3 universel : ancien sector immo/retail/resto
    // → universal, avec mapping des champs métier vers leurs équivalents.
    const cnt = _state.content;
    if (['immobilier', 'retail', 'restauration'].includes(cnt.sector)) {
      const f = cnt.fields || {};
      cnt.fields = {
        nom_projet:         f.nom_projet         || f.nom_programme || f.nom_enseigne || f.nom_etablissement || '',
        lieu:               f.lieu               || f.ville          || '',
        echeance:           f.echeance           || f.livraison      || '',
        argumentaire:       f.argumentaire       || f.promesse       || f.pitch        || '',
        cta:                f.cta                || '',
        infos_specifiques:  f.infos_specifiques  || _composeOldInfos(f),
        mentions_legales:   f.mentions_legales   || '',
      };
      cnt.sector = 'universal';
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Rétro-compat : compose les anciens champs immobiliers spécifiques en une
// note infos_specifiques unique (prix, typologies, labels, opération…)
function _composeOldInfos(f) {
  const parts = [];
  if (f.prix_min)     parts.push(`Prix d'appel : ${f.prix_min} €`);
  if (Array.isArray(f.typologies) && f.typologies.length)
    parts.push(`Typologies : ${f.typologies.join(', ')}`);
  if (Array.isArray(f.labels) && f.labels.length)
    parts.push(`Labels : ${f.labels.join(', ')}`);
  if (f.operation)    parts.push(`Opération : ${f.operation}`);
  if (f.univers)      parts.push(`Univers : ${f.univers}`);
  if (f.cuisine)      parts.push(`Cuisine : ${f.cuisine}`);
  if (f.evenement)    parts.push(`Événement : ${f.evenement}`);
  return parts.join('\n');
}

function _resetDraft() {
  try { localStorage.removeItem(LS_DRAFT_KEY); } catch (_) {}
  _state = {
    view: 'destination',
    destination: {
      category: null, support_id: null, vendor_id: null, standard: null,
      vendor_url: '', specs_pdf: null, _form_open: false,
    },
    content:     { sector: 'universal', fields: {} },
    assets: {
      logo_owned: false, charte_owned: false, fonts_owned: false,
      charte: { primary_hex: '', secondary_hex: '', font_title: '', font_body: '' },
      brand_book_url: '', extra_notes: '', uploads: [],
    },
    output: { status: 'idle', error: null, codeMaitre: null, brief: null, briefId: null },
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
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('kodex', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
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
  bindBurger(_root);

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
  // Étape Destination (refonte vendor-aware mai 2026 v3)
  if (act === 'dest-category')  return _pickCategory(t.dataset.cat);
  if (act === 'dest-support')   return _pickSupport(t.dataset.id);
  if (act === 'dest-vendor')    return _pickVendor(t.dataset.id);
  if (act === 'dest-reset')     return _destReset();
  if (act === 'dest-form-toggle') return _toggleDestForm();
  if (act === 'dest-specs-delete') return _deleteSpecsPdf();
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
  // Ouvre le Vault directement sur l'onglet clés API
  if (act === 'open-vault')     return _openVault();
  // Bascule sur un autre moteur AI (ks_active_engine) + re-render
  if (act === 'switch-engine')  return _switchEngine(t.dataset.engine);
  // Plan B humain : copier le Code Maître dans le presse-papier
  if (act === 'copy-prompt')    return _copyPromptToClipboard();
  // Plan B humain : toggle de la section "Mode manuel" dans le hero
  if (act === 'toggle-manual')  return _toggleManualMode();
}

// ── Construit puis copie le Code Maître dans le presse-papier ──
// Si le prompt n'existe pas encore (l'utilisateur n'a pas cliqué Générer),
// on le construit à la volée à partir de l'état courant. Ainsi le bouton
// "Copier" fonctionne aussi en amont de toute tentative de génération.
async function _copyPromptToClipboard() {
  let prompt = _state.output.codeMaitre;
  if (!prompt) {
    try {
      const sector = await getSector(_state.content.sector);
      prompt = await buildCodeMaitre(_state, sector);
      _state.output.codeMaitre = prompt;
    } catch (e) {
      _toastSoon('Impossible de construire le prompt : ' + e.message);
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(prompt);
    _toastOk('Code Maître copié dans le presse-papier');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = prompt;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); _toastOk('Code Maître copié'); }
    catch (_e) { _toastSoon('Copie impossible — copie manuelle requise'); }
    ta.remove();
  }
}

// ── Toggle de la section "Mode manuel (copier-coller)" ────────
function _toggleManualMode() {
  _state.output.show_manual = !_state.output.show_manual;
  _saveDraft();
  _renderMain();
  setTimeout(() => {
    _root?.querySelector('[data-slot="manual-mode"]')
         ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

// ── Bascule sur un autre moteur AI (depuis card erreur ou bandeau) ─
function _switchEngine(label) {
  if (!label) return;
  localStorage.setItem('ks_active_engine', label);
  // Reset l'état d'erreur pour permettre une nouvelle tentative immédiate
  _state.output.status = 'idle';
  _state.output.error = null;
  _saveDraft();
  _renderMain();
  _toastOk(`Moteur basculé sur ${label}`);
}

// ── Ouvre le Vault (Réglages → Clés API) ──────────────────────
// Ferme Kodex pour laisser l'utilisateur configurer sa clé, puis il
// rouvrira Kodex et son brouillon sera intact.
function _openVault() {
  _saveDraft();           // sauvegarde explicite avant fermeture
  closeKodex();
  setTimeout(() => openSettingsTo('acc-api'), 120);
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
    // Migration v2 → v3 si le scénario démo est encore en ancien format
    const dst = _state.destination;
    if (dst.preset_id && !dst.support_id) dst.support_id = dst.preset_id;
    if (!dst.vendor_id && dst.standard?.vendor) {
      const v = String(dst.standard.vendor).toLowerCase();
      if (v.includes('exa'))       dst.vendor_id = 'exaprint';
      else if (v.includes('vista')) dst.vendor_id = 'vistaprint';
      else if (v.includes('pixart')) dst.vendor_id = 'pixartprinting';
      else                            dst.vendor_id = 'other';
    }
    // Re-hydrate le standard depuis le couple (support × vendor) si le
    // scénario n'a pas embarqué l'objet standard complet.
    if (dst.support_id && !dst.standard) {
      const support = await getSupport(dst.support_id);
      if (support) {
        const defaults = await getCategoryDefaults(support.category);
        const vendor = dst.vendor_id ? await getVendor(dst.vendor_id) : null;
        const spec = await getSpec(dst.vendor_id, dst.support_id);
        dst.standard = specToStandard(spec, vendor, support, defaults);
      }
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

    // Restore le state Kodex à partir du brief sauvegardé.
    // 3 formats possibles selon la date du brief :
    //   a) v3 vendor-aware : support_id + vendor_id + standard_snapshot
    //   b) v2 universel : preset_id + standard_snapshot
    //   c) v1 legacy : standard_id pointant vers les anciens vendors
    const dst = _state.destination;
    const supportId = b.support_id || b.preset_id || null;

    if (supportId) {
      const support = await getSupport(supportId);
      if (support) {
        const defaults = await getCategoryDefaults(support.category);
        const vendorId = b.vendor_id
          || (b.standard_snapshot?.vendor_id)
          || (b.vendor ? _guessVendorIdFromLabel(b.vendor) : null);
        const vendor = vendorId ? await getVendor(vendorId) : null;
        const spec = await getSpec(vendorId, supportId);
        dst.category = support.category;
        dst.support_id = supportId;
        dst.preset_id  = supportId;   // miroir rétro-compat
        dst.vendor_id  = vendorId;
        dst.standard = b.standard_snapshot
          ? { ...specToStandard(spec, vendor, support, defaults), ...b.standard_snapshot }
          : specToStandard(spec, vendor, support, defaults);
      }
    } else if (b.standard_snapshot) {
      dst.category   = b.category || null;
      dst.support_id = null;
      dst.preset_id  = null;
      dst.vendor_id  = b.standard_snapshot.vendor_id || null;
      dst.standard   = b.standard_snapshot;
    } else if (b.standard_id) {
      // v1 legacy : on affiche juste les noms, pas de re-hydratation possible
      dst.category   = null;
      dst.support_id = null;
      dst.preset_id  = null;
      dst.vendor_id  = null;
      dst.standard   = {
        id: b.standard_id,
        type_support: b.product_name || '',
        product_name: b.product_name || '',
        vendor: b.vendor || '',
        format_fini: {},
        bleed_mm: null, safe_margin_mm: null, dpi: null,
        color_profile: '', export_format: '', material: '', notes: '',
      };
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
    await exportBriefAsPDF(_state, sector);
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
// Étape Destination — handlers (refonte universelle mai 2026)
// ═══════════════════════════════════════════════════════════════

// ── Changement de catégorie (tab) ─────────────────────────────
// Reset support + vendor + standard car les contraintes changent
// totalement entre catégories.
function _pickCategory(cat) {
  const d = _state.destination;
  d.category = cat;
  d.support_id = null;
  d.vendor_id = null;
  d.standard = null;
  d._form_open = false;
  _saveDraft();
  _renderMain();
}

// ── Clic sur un SUPPORT → pré-sélection vendor "Je ne sais pas"
// et seed du standard avec les defaults catégorie.
async function _pickSupport(supportId) {
  const support = await getSupport(supportId);
  if (!support) return;
  const catDefaults = await getCategoryDefaults(support.category);
  const d = _state.destination;
  d.category = support.category;
  d.support_id = supportId;
  // preset_id miroir pour rétro-compat briefs D1
  d.preset_id = supportId;
  // Si pas de vendor encore choisi, on pré-sélectionne "other" (le pill
  // "Je ne sais pas encore"). L'utilisateur peut switcher après.
  if (!d.vendor_id) d.vendor_id = 'other';
  const vendor = await getVendor(d.vendor_id);
  const spec = await getSpec(d.vendor_id, supportId);
  d.standard = specToStandard(spec, vendor, support, catDefaults);
  _saveDraft();
  _renderMain();
}

// ── Clic sur un VENDOR → re-seed du standard ──────────────────
async function _pickVendor(vendorId) {
  const d = _state.destination;
  const support = d.support_id ? await getSupport(d.support_id) : null;
  if (!support) {
    // Sélection vendor avant support : on stocke juste l'id, le standard
    // sera seedé au prochain pick support.
    d.vendor_id = vendorId;
    _saveDraft();
    _renderMain();
    return;
  }
  const catDefaults = await getCategoryDefaults(support.category);
  const vendor = await getVendor(vendorId);
  const spec = await getSpec(vendorId, support.id);
  d.vendor_id = vendorId;
  d.standard = specToStandard(spec, vendor, support, catDefaults);
  // Reset des champs "Autre imprimeur" si on passe sur un vendor connu
  if (vendorId !== 'other') {
    d.vendor_url = '';
    d.specs_pdf = null;
  }
  _saveDraft();
  _renderMain();
  // Toast info — feedback immédiat sur le changement de specs
  if (spec) {
    _toastOk(`Adapté à ${vendor.label} · fond perdu ${spec.bleed_mm} mm`);
  } else if (vendorId === 'other') {
    _toastOk('Standards génériques appliqués');
  }
}

// ── Réinitialise complètement la sélection Destination ────────
function _destReset() {
  _state.destination = {
    category: null, support_id: null, vendor_id: null, standard: null,
    vendor_url: '', specs_pdf: null, _form_open: false,
  };
  _saveDraft();
  _renderMain();
  _toastOk('Sélection annulée');
}

// ── Toggle du form détaillé replié par défaut ─────────────────
function _toggleDestForm() {
  _state.destination._form_open = !_state.destination._form_open;
  _saveDraft();
  _renderMain();
}

// ── Suppression du PDF de specs ───────────────────────────────
async function _deleteSpecsPdf() {
  const pdf = _state.destination.specs_pdf;
  if (!pdf) return;
  if (!confirm('Supprimer le PDF de spécifications joint ?')) return;
  try {
    await deleteAsset(pdf.id);
  } catch (_) {}
  _state.destination.specs_pdf = null;
  _saveDraft();
  _renderMain();
  _toastOk('PDF retiré');
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
// Vue 1 — DESTINATION (refonte vendor-aware mai 2026 v3)
// ─────────────────────────────────────────────────────────────
// Layout fluide, simple, ludique :
//   1. Tabs catégories
//   2. Grid SUPPORTS (clic = sélection)
//   3. Pills VENDORS (apparaît dès qu'un support est choisi)
//   4. Card RECAP visuel (apparaît quand support + vendor sont choisis,
//      avec icônes et données prêtes en lecture seule)
//   5. Form détaillé (replié par défaut, dépliable via bouton discret)
//   6. Zone "Autre imprimeur" (visible si vendor_id === 'other')
//   7. Calculateur d'échelle (si grandes dimensions)
// ═══════════════════════════════════════════════════════════════
function _viewDestination() {
  const shell = `
    <span class="ws-eyebrow">${icon('target', 12)} 1 sur 4 · Le support</span>
    <h1 class="ws-h1">Quel format pour votre création&nbsp;?</h1>
    <p class="ws-lead">
      Choisissez un format. Si vous savez où ce sera imprimé, précisez-le —
      Kodex adaptera fond perdu, marges et préparation aux exigences exactes
      de votre imprimeur.
    </p>

    <div data-slot="dest-tabs"     style="margin-bottom:14px;"></div>
    <div data-slot="dest-supports" style="margin-bottom:28px;"></div>
    <div data-slot="dest-vendors"  style="margin-bottom:20px;"></div>
    <div data-slot="dest-recap"    style="margin-bottom:14px;"></div>
    <div data-slot="dest-form"     style="margin-bottom:14px;"></div>
    <div data-slot="dest-other"    style="margin-bottom:14px;"></div>
    <div data-slot="dest-scale"></div>
  `;

  // Hydratation asynchrone — toutes les sous-vues
  (async () => {
    if (!_root) return;
    const categories = await loadCategories();
    _renderDestTabs(categories);
    await _renderDestSupports();
    await _renderDestVendors();
    await _renderDestRecap();
    await _renderDestForm();
    _renderDestOther();
    _renderDestScale();
  })();

  return shell;
}

// ── Zone 1a : tabs catégories ─────────────────────────────────
function _renderDestTabs(categories) {
  const slot = _root?.querySelector('[data-slot="dest-tabs"]');
  if (!slot) return;
  const active = _state.destination.category;
  slot.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--ws-text-muted);margin-right:6px;">
        Catégorie
      </span>
      ${categories.map(c => `
        <button class="ws-btn ${active === c.id ? 'ws-btn--accent' : 'ws-btn--secondary'}"
                data-act="dest-category" data-cat="${_esc(c.id)}"
                style="padding:6px 12px;font-size:12.5px;display:inline-flex;align-items:center;gap:6px;">
          ${icon(c.icon, 14)} ${_esc(c.label)}
        </button>
      `).join('')}
      ${(_state.destination.standard || _state.destination.support_id) ? `
        <button class="ws-btn ws-btn--ghost" data-act="dest-reset"
                style="padding:6px 10px;font-size:12px;color:var(--danger);margin-left:auto;">
          ${icon('x', 12)} Tout annuler
        </button>
      ` : ''}
    </div>
  `;
}

// ── Zone 1b : grid SUPPORTS de la catégorie active ────────────
async function _renderDestSupports() {
  const slot = _root?.querySelector('[data-slot="dest-supports"]');
  if (!slot) return;
  const cat = _state.destination.category;
  if (!cat) {
    slot.innerHTML = `
      <div class="ws-empty" style="margin-top:8px;">
        <div class="ws-empty-icon">${icon('target', 24)}</div>
        <p class="ws-empty-desc">Choisissez une catégorie ci-dessus pour voir les formats associés.</p>
      </div>
    `;
    return;
  }
  const supports = await getSupportsByCategory(cat);
  const currentId = _state.destination.support_id;

  slot.innerHTML = `
    <div class="ws-card-grid">
      ${supports.map(s => _renderSupportCard(s, currentId === s.id)).join('')}
    </div>
  `;
}

function _renderSupportCard(s, isActive) {
  // Description courte : dimensions si connues, sinon intention.
  let desc;
  if (s.default_format) {
    desc = formatDimensions({ format_fini: s.default_format });
    if (s.type_support) desc += ` · ${s.type_support}`;
  } else if (s.is_press_intro) {
    desc = 'Dimensions fournies par la régie';
  } else if (s.is_custom) {
    desc = s.type_support || 'Dimensions au choix';
  } else if (s.is_dim_free) {
    desc = `Dimensions au choix${s.type_support ? ` · ${s.type_support}` : ''}`;
  } else {
    desc = s.type_support || '—';
  }
  return `
    <div class="ws-card is-clickable ${isActive ? 'is-selected' : ''}"
         data-act="dest-support" data-id="${_esc(s.id)}"
         ${s.is_custom ? 'style="border-style:dashed;"' : ''}>
      <div class="ws-card-row">
        <div class="ws-card-icon">${icon(s.icon || 'printer', 22)}</div>
        <div class="ws-card-body">
          <h3 class="ws-card-title">${_esc(s.label)}</h3>
          <p class="ws-card-desc">${_esc(desc)}</p>
        </div>
      </div>
    </div>
  `;
}

// ── Zone 2 : pills VENDORS (apparaît dès qu'un support est choisi) ─
// Header explicatif court, pills horizontales colorées par niveau de
// précision. Le pill "Je ne sais pas" est toujours en dernier et reste
// sélectionnable même si l'utilisateur n'a pas d'imprimeur en tête.
async function _renderDestVendors() {
  const slot = _root?.querySelector('[data-slot="dest-vendors"]');
  if (!slot) return;
  const supportId = _state.destination.support_id;
  if (!supportId) { slot.innerHTML = ''; return; }

  const vendors = await getVendorsForSupport(supportId);
  const currentId = _state.destination.vendor_id;

  slot.innerHTML = `
    <div class="ws-card" style="padding:18px 20px;background:var(--ws-surface);border-color:var(--ws-border);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        ${icon('printer', 16)}
        <strong style="font-size:13.5px;letter-spacing:-.012em;color:var(--ws-text);">
          Vous avez un imprimeur en tête&nbsp;?
        </strong>
        <span style="font-size:11.5px;color:var(--ws-text-muted);">
          (optionnel — adapte les contraintes techniques)
        </span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${vendors.map(v => _renderVendorPill(v, currentId === v.id)).join('')}
      </div>
    </div>
  `;
}

function _renderVendorPill(v, isActive) {
  const isOther = v.id === 'other';
  const badgeText = isOther ? 'Saisie libre' : 'Specs précises';
  const badgeBg   = isOther ? 'transparent' : 'var(--ws-accent-soft)';
  const badgeFg   = isOther ? 'var(--ws-text-muted)' : 'var(--ws-accent)';
  return `
    <button class="ws-btn ${isActive ? 'ws-btn--accent' : 'ws-btn--secondary'}"
            data-act="dest-vendor" data-id="${_esc(v.id)}"
            style="padding:10px 14px;font-size:12.5px;display:inline-flex;align-items:center;gap:10px;
                   ${isOther && !isActive ? 'border-style:dashed;' : ''}">
      <span style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;line-height:1.2;">
        <span style="font-weight:700;letter-spacing:-.008em;">${_esc(v.label)}</span>
        <span style="font-size:10px;font-weight:500;letter-spacing:.02em;padding:1px 6px;border-radius:999px;background:${badgeBg};color:${badgeFg};">
          ${badgeText}
        </span>
      </span>
    </button>
  `;
}

// ── Zone 3 : CARD RECAP visuel (lecture seule, ludique) ───────
// Apparaît une fois support + vendor sélectionnés. C'est la pièce
// maîtresse de la nouvelle ergonomie : l'utilisateur voit tout ce qu'il
// faut savoir en un clin d'œil, sans formulaire en face. Le form
// détaillé est masqué dans un <details> dépliable en bas.
async function _renderDestRecap() {
  const slot = _root?.querySelector('[data-slot="dest-recap"]');
  if (!slot) return;
  const d = _state.destination;
  const std = d.standard;
  if (!std || !d.support_id) { slot.innerHTML = ''; return; }

  const vendor = d.vendor_id ? await getVendor(d.vendor_id) : null;
  const support = await getSupport(d.support_id);
  const dims = formatDimensions(std);
  const hasDims = dims && dims !== '—';

  // Rendu en lignes "label → valeur" avec icônes parlantes
  const rows = [
    { ic: 'ruler',  label: 'Format',          val: hasDims ? dims : 'À saisir ci-dessous' },
    std.bleed_mm != null ? { ic: 'square',    label: 'Fond perdu',
        val: std.bleed_mm === 0 ? 'Aucun (format fini = fichier)' : `${std.bleed_mm} mm sur chaque bord` } : null,
    std.safe_margin_mm   ? { ic: 'shield',    label: 'Zone de sécurité',
        val: `${std.safe_margin_mm} mm autour du visuel` } : null,
    std.color_profile    ? { ic: 'palette',   label: 'Couleurs', val: std.color_profile } : null,
    std.export_format    ? { ic: 'file-text', label: 'Fichier final', val: std.export_format } : null,
    std.dpi              ? { ic: 'image',     label: 'Résolution', val: `${std.dpi} DPI` } : null,
  ].filter(Boolean);

  // Préparation spécifique vendor (si niveau 1-2)
  const prepHTML = (vendor && vendor.level !== 3 && vendor.preparation_steps?.length) ? `
    <div style="margin-top:14px;padding:12px 14px;background:var(--ws-accent-soft);border-radius:var(--ws-radius-sm);border-left:3px solid var(--ws-accent);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;font-weight:700;letter-spacing:-.008em;color:var(--ws-text);">
        ${icon('check', 14)} À préparer chez ${_esc(vendor.label)}
      </div>
      <ul style="margin:0;padding-left:20px;font-size:12px;color:var(--ws-text-soft);line-height:1.6;">
        ${vendor.preparation_steps.map(p => `<li style="margin:3px 0;">${_esc(p)}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const tagline = vendor?.tagline
    ? `<div style="font-size:11.5px;color:var(--ws-text-muted);margin-top:2px;font-weight:500;">${_esc(vendor.tagline)}</div>`
    : '';

  const formOpen = d._form_open;

  slot.innerHTML = `
    <div class="ws-card" style="padding:22px 24px;border-color:var(--ws-accent);background:linear-gradient(180deg, var(--ws-surface) 0%, var(--ws-bg) 100%);">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;">
        <div style="width:48px;height:48px;border-radius:var(--ws-radius);background:var(--ws-accent-soft);display:inline-flex;align-items:center;justify-content:center;color:var(--ws-accent);flex-shrink:0;">
          ${icon(support?.icon || 'printer', 26)}
        </div>
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0;font-size:16px;font-weight:800;letter-spacing:-.014em;color:var(--ws-text);">
            ${_esc(support?.label || '')}
            ${vendor ? `<span style="font-weight:500;color:var(--ws-text-muted);"> · ${_esc(vendor.label)}</span>` : ''}
          </h3>
          ${tagline}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px 24px;">
        ${rows.map(r => `
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <span style="display:inline-flex;width:24px;height:24px;border-radius:6px;background:var(--ws-surface);color:var(--ws-text-muted);align-items:center;justify-content:center;flex-shrink:0;border:1px solid var(--ws-border);">
              ${icon(r.ic, 13)}
            </span>
            <div style="min-width:0;line-height:1.4;">
              <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--ws-text-muted);">${_esc(r.label)}</div>
              <div style="font-size:13px;font-weight:600;color:var(--ws-text);">${_esc(r.val)}</div>
            </div>
          </div>
        `).join('')}
      </div>

      ${prepHTML}

      <div style="margin-top:16px;display:flex;justify-content:flex-end;">
        <button class="ws-btn ws-btn--ghost" data-act="dest-form-toggle"
                style="padding:6px 12px;font-size:12px;color:var(--ws-text-muted);">
          ${icon(formOpen ? 'chevron-up' : 'sliders', 13)}
          ${formOpen ? 'Masquer les détails' : 'Ajuster les paramètres techniques'}
        </button>
      </div>
    </div>
  `;
}

// ── Zone "Autre imprimeur" : nom + URL + PDF specs joignable ───
// Visible UNIQUEMENT si vendor_id === 'other'. C'est le mode "saisie libre"
// où l'utilisateur peut renseigner son imprimeur perso et joindre les
// specs reçues. Si vendor_id pointe sur un vendor connu (level 1-2),
// la zone disparaît (les specs sont déjà précises).
function _renderDestOther() {
  const slot = _root?.querySelector('[data-slot="dest-other"]');
  if (!slot) return;
  const d = _state.destination;
  if (d.vendor_id !== 'other') { slot.innerHTML = ''; return; }
  if (!d.support_id) { slot.innerHTML = ''; return; }

  const specsPdf = d.specs_pdf;
  slot.innerHTML = `
    <div class="ws-card" style="padding:16px 18px;background:var(--ws-surface);border-style:dashed;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        ${icon('printer', 14)}
        <strong style="font-size:13px;letter-spacing:-.008em;color:var(--ws-text);">Votre imprimeur — optionnel</strong>
        <span style="font-size:11px;color:var(--ws-text-muted);">enrichira le brief avec ses contraintes propres</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;">
        <div class="ws-field">
          <label class="ws-label" for="kd-vendor-name">Nom de votre imprimeur</label>
          <input class="ws-input" id="kd-vendor-name" name="vendor" type="text"
                 value="${_esc(d.standard?.vendor || '')}"
                 placeholder="ex : imprimeur local, ville…">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-vendor-url">Lien fiche technique (si reçue)</label>
          <input class="ws-input" id="kd-vendor-url" name="vendor_url" type="url"
                 value="${_esc(d.vendor_url || '')}"
                 placeholder="https://…">
        </div>
        <div class="ws-field" style="grid-column:1 / -1;">
          <label class="ws-label">PDF de spécifications (optionnel)</label>
          ${specsPdf ? `
            <div class="ws-card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;">
              <div style="width:32px;height:32px;border-radius:var(--ws-radius-sm);background:var(--ws-accent-soft);display:flex;align-items:center;justify-content:center;color:var(--ws-accent);">
                ${icon('file-text', 18)}
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:var(--ws-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(specsPdf.filename)}</div>
                <a href="${_esc(specsPdf.url)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--ws-accent);text-decoration:none;">Ouvrir le PDF</a>
              </div>
              <button class="ws-iconbtn" data-act="dest-specs-delete" title="Retirer" style="color:var(--danger);">
                ${icon('x', 14)}
              </button>
            </div>
          ` : `
            <button class="ws-btn ws-btn--secondary" type="button" data-slot="dest-specs-pick"
                    style="padding:8px 14px;font-size:12.5px;width:100%;">
              ${icon('upload-cloud', 14)} Joindre le PDF de specs reçu (max 2 Mo)
            </button>
            <input type="file" data-slot="dest-specs-input" hidden accept="application/pdf">
          `}
        </div>
      </div>
    </div>
  `;

  // Wiring inputs vendor (texte libre dans le standard)
  slot.querySelector('#kd-vendor-name')?.addEventListener('input', e => {
    if (_state.destination.standard) {
      _state.destination.standard.vendor = e.target.value;
    }
    _scheduleSave();
  });
  slot.querySelector('#kd-vendor-url')?.addEventListener('input', e => {
    _state.destination.vendor_url = e.target.value;
    _scheduleSave();
  });
  // Upload PDF specs
  const pick = slot.querySelector('[data-slot="dest-specs-pick"]');
  const inp  = slot.querySelector('[data-slot="dest-specs-input"]');
  if (pick && inp) {
    pick.addEventListener('click', () => inp.click());
    inp.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const asset = await uploadFile(file, 'specs');
        _state.destination.specs_pdf = {
          id: asset.id, filename: asset.filename, mime: asset.mime,
          size_bytes: asset.size_bytes, url: asset.url,
        };
        _saveDraft();
        _renderDestOther();
        _toastOk('PDF joint');
      } catch (err) {
        _toastSoon('Upload échoué : ' + err.message);
      }
    });
  }
}

// ── Zone form universel : replié par défaut ───────────────────
// Caché tant que support pas choisi. Une fois support sélectionné, le
// récap visuel suffit pour 95% des cas. Le form n'apparaît que si
// l'utilisateur clique "Ajuster les paramètres techniques" (state
// _form_open = true) OU s'il a besoin de saisir les dimensions
// (support sans default_format : bâche, sticker custom, presse…).
async function _renderDestForm() {
  const slot = _root?.querySelector('[data-slot="dest-form"]');
  if (!slot) return;
  const d = _state.destination;
  const std = d.standard;
  const cat = d.category;
  const catObj = cat ? await getCategory(cat) : null;
  const isDigital = catObj?.defaults?.unit === 'px';

  // Pas encore de support : on n'affiche rien (la grid supports parle d'elle-même)
  if (!std || !d.support_id) { slot.innerHTML = ''; return; }

  // Détection : faut-il dérouler automatiquement le form ?
  // → oui si le support n'a pas de dimensions par défaut (custom/dim_free/press_intro)
  const support = await getSupport(d.support_id);
  const needsDims = support && (support.is_custom || support.is_dim_free || support.is_press_intro);
  const isOpen = d._form_open || needsDims;

  if (!isOpen) { slot.innerHTML = ''; return; }

  const f = std.format_fini || {};
  const width  = isDigital ? (f.width_px  ?? '') : (f.width_mm  ?? '');
  const height = isDigital ? (f.height_px ?? '') : (f.height_mm ?? '');
  const unitLabel = isDigital ? 'px' : 'mm';

  const headerHint = needsDims
    ? `<p style="font-size:12.5px;color:var(--ws-text-muted);margin:0 0 14px 0;">
         Ce format nécessite que vous saisissiez les dimensions. Tout le reste est déjà préparé selon votre choix d'imprimeur.
       </p>`
    : `<p style="font-size:12.5px;color:var(--ws-text-muted);margin:0 0 14px 0;">
         Tout est modifiable. Le brief final reprendra exactement ces valeurs.
       </p>`;

  slot.innerHTML = `
    <h2 class="ws-h2" style="margin-bottom:6px;">${needsDims ? 'Saisissez vos dimensions' : 'Ajustez les détails'}</h2>
    ${headerHint}
    <form data-slot="dest-form-inner" id="kodex-dest-form" autocomplete="off">
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:14px;">
        <div class="ws-field" style="grid-column:1 / -1;">
          <label class="ws-label" for="kd-type">Type de support</label>
          <input class="ws-input" id="kd-type" name="type_support" type="text"
                 value="${_esc(std.type_support || '')}"
                 placeholder="ex : carte de visite, bâche PVC, post Instagram…">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-width">Largeur (${unitLabel})</label>
          <input class="ws-input" id="kd-width" name="width" type="number" min="1" step="1"
                 value="${_esc(width)}"
                 placeholder="ex : ${isDigital ? '1080' : '2000'}">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-height">Hauteur (${unitLabel})</label>
          <input class="ws-input" id="kd-height" name="height" type="number" min="1" step="1"
                 value="${_esc(height)}"
                 placeholder="ex : ${isDigital ? '1080' : '800'}">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-color">Colorimétrie</label>
          <input class="ws-input" id="kd-color" name="color_profile" type="text"
                 value="${_esc(std.color_profile || '')}"
                 placeholder="ex : CMJN FOGRA39, sRGB…">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-export">Format d'export attendu</label>
          <input class="ws-input" id="kd-export" name="export_format" type="text"
                 value="${_esc(std.export_format || '')}"
                 placeholder="ex : PDF/X-1a, PNG haute qualité…">
        </div>
        ${isDigital ? '' : `
        <div class="ws-field">
          <label class="ws-label" for="kd-bleed">Fond perdu (mm)</label>
          <input class="ws-input" id="kd-bleed" name="bleed_mm" type="number" min="0" step="1"
                 value="${_esc(std.bleed_mm ?? '')}" placeholder="3">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-margin">Marges de sécurité (mm)</label>
          <input class="ws-input" id="kd-margin" name="safe_margin_mm" type="number" min="0" step="1"
                 value="${_esc(std.safe_margin_mm ?? '')}" placeholder="5">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-dpi">Résolution (DPI)</label>
          <input class="ws-input" id="kd-dpi" name="dpi" type="number" min="72" step="1"
                 value="${_esc(std.dpi ?? '')}" placeholder="300">
        </div>
        <div class="ws-field">
          <label class="ws-label" for="kd-material">Matière / finition (optionnel)</label>
          <input class="ws-input" id="kd-material" name="material" type="text"
                 value="${_esc(std.material || '')}"
                 placeholder="ex : PVC 510 g/m², papier couché 350 g…">
        </div>
        `}
        <div class="ws-field" style="grid-column:1 / -1;">
          <label class="ws-label" for="kd-notes">Notes techniques (optionnel)</label>
          <textarea class="ws-textarea" id="kd-notes" name="notes" rows="2"
                    placeholder="Précisions à transmettre au graphiste / imprimeur">${_esc(std.notes || '')}</textarea>
        </div>
      </div>
    </form>
  `;

  // Wiring : chaque change met à jour _state.destination.standard
  const form = slot.querySelector('#kodex-dest-form');
  form.addEventListener('input', _onDestFormChange);
  form.addEventListener('change', _onDestFormChange);
}

// ── Zone calculateur d'échelle (si standard saisi) ────────────
function _renderDestScale() {
  const slot = _root?.querySelector('[data-slot="dest-scale"]');
  if (!slot) return;
  const std = _state.destination.standard;
  if (!std) { slot.innerHTML = ''; return; }
  // computeScale traite digital (px) et print (mm) automatiquement.
  // Pour le print sans dimensions, on n'affiche pas la card.
  const f = std.format_fini || {};
  const hasDims = (f.width_mm && f.height_mm) || (f.width_px && f.height_px);
  if (!hasDims) { slot.innerHTML = ''; return; }
  slot.innerHTML = _renderScaleCalculator(std);
}

// ── Form universel : update _state.destination.standard ──────
function _onDestFormChange(e) {
  const el = e.target;
  if (!el.name) return;
  const std = _state.destination.standard;
  if (!std) return;
  const v = el.value;

  if (el.name === 'width' || el.name === 'height') {
    std.format_fini = std.format_fini || {};
    const cat = _state.destination.category;
    // Détection unité : présence width_px sur le preset OU absence dpi
    const isDigital = std.format_fini.width_px != null
      || (cat === 'digital');
    const numeric = v === '' ? null : Number(v);
    if (isDigital) {
      if (el.name === 'width')  std.format_fini.width_px  = numeric;
      if (el.name === 'height') std.format_fini.height_px = numeric;
    } else {
      if (el.name === 'width')  std.format_fini.width_mm  = numeric;
      if (el.name === 'height') std.format_fini.height_mm = numeric;
    }
  } else if (['bleed_mm', 'safe_margin_mm', 'dpi'].includes(el.name)) {
    std[el.name] = v === '' ? null : Number(v);
  } else {
    std[el.name] = v;
    // product_name suit type_support (utilisé par prompt/pdf)
    if (el.name === 'type_support') std.product_name = v;
  }
  _scheduleSave();

  // Re-render du calculateur d'échelle quand dimensions changent
  if (el.name === 'width' || el.name === 'height') {
    _renderDestScale();
  }
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
  // Masquage conditionnel : on n'affiche dans la charte rapide que les
  // champs qui correspondent à ce que le graphiste N'A PAS déjà.
  const needsLogo   = !a.logo_owned;
  const needsCharte = !a.charte_owned;
  const needsFonts  = !a.fonts_owned;
  const showChartBlock = needsLogo || needsCharte || needsFonts;

  // Le bloc charte rapide n'a de sens que si au moins UN élément manque
  // côté graphiste. Si tout est coché → on saute direct aux demandes
  // spéciales + dropzone.
  const chartBlockHTML = showChartBlock ? `
    <h2 class="ws-h2">Votre charte graphique rapide</h2>
    <p style="font-size:12.5px;color:var(--ws-text-muted);margin:-6px 0 14px 0;">
      Saisissez ce qui manque côté graphiste — Kodex masque automatiquement les champs déjà fournis ci-dessus.
    </p>
    <form data-slot="assets-form" id="kodex-assets-form" autocomplete="off">
      <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:14px;">
        ${needsCharte ? `
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
        ` : ''}
        ${needsFonts ? `
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
        ` : ''}
        ${needsCharte ? `
          <div class="ws-field" style="grid-column:1 / -1;">
            <label class="ws-label" for="ka-brand-book">Lien vers votre brand book complet (optionnel)</label>
            <input class="ws-input" id="ka-brand-book" name="brand_book_url" type="url"
                   value="${_esc(a.brand_book_url)}"
                   placeholder="https://drive.google.com/...">
            <div style="margin-top:4px;font-size:11.5px;color:var(--ws-text-muted);">
              Si vous avez un PDF brand book, partagez-le ici&nbsp;— votre graphiste pourra le consulter.
            </div>
          </div>
        ` : ''}
      </div>
    </form>
  ` : `
    <div class="ws-card" style="background:var(--ws-accent-soft);border-color:var(--ws-accent);padding:16px 18px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-flex;width:32px;height:32px;border-radius:50%;background:var(--ws-accent);color:#fff;align-items:center;justify-content:center;flex-shrink:0;">
          ${icon('check', 18)}
        </span>
        <div>
          <strong style="font-size:13.5px;color:var(--ws-text);">Votre graphiste a déjà toute votre identité visuelle.</strong>
          <div style="font-size:12px;color:var(--ws-text-muted);margin-top:2px;">
            Pas besoin de re-saisir votre charte. Passez directement aux demandes spéciales et fichiers supplémentaires.
          </div>
        </div>
      </div>
    </div>
  `;

  const root = `
    <span class="ws-eyebrow">${icon('package', 12)} 3 sur 4 · Les visuels</span>
    <h1 class="ws-h1">Quels éléments visuels avons-nous&nbsp;?</h1>
    <p class="ws-lead">
      Indiquez à Kodex ce que votre graphiste possède déjà&nbsp;: vous gagnerez du temps
      en évitant de re-saisir ce qu'il a déjà reçu.
    </p>

    <h2 class="ws-h2">Ce que votre graphiste possède déjà pour vous</h2>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:14px;margin-bottom:24px;">
      ${_renderOwnedToggle('logo_owned',   'Logo',          'image',    a.logo_owned)}
      ${_renderOwnedToggle('charte_owned', 'Charte graphique', 'palette', a.charte_owned)}
      ${_renderOwnedToggle('fonts_owned',  'Polices',       'type',     a.fonts_owned)}
    </div>

    ${chartBlockHTML}

    <h2 class="ws-h2">Demandes spéciales pour le graphiste</h2>
    <p style="font-size:12.5px;color:var(--ws-text-muted);margin:-6px 0 14px 0;">
      Tout ce que vous voulez qu'il sache avant de démarrer.
    </p>
    <form data-slot="assets-notes-form" id="kodex-assets-notes-form" autocomplete="off" style="margin-bottom:24px;">
      <div class="ws-field">
        <textarea class="ws-textarea" id="ka-notes" name="extra_notes" rows="3"
                  placeholder="ex : éviter le rose, garder un esprit minéral, respecter les espaces vides, inspiration Notion/Linear, ne pas reproduire la concurrence…">${_esc(a.extra_notes)}</textarea>
      </div>
    </form>

    <h2 class="ws-h2">Téléverser des fichiers</h2>
    <p style="font-size:12.5px;color:var(--ws-text-muted);margin:-6px 0 14px 0;">
      Glissez vos logos, illustrations, brand book ou gabarits ici. Stockage en
      Europe, 10 Mo max par fichier. Formats acceptés : PNG, JPG, SVG, PDF, AI, EPS.
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
              ? '<strong style="color:var(--ws-accent);">Déjà transmis.</strong> Pas besoin de renvoyer.'
              : 'Cliquez si votre graphiste l\'a déjà.'
            }
          </p>
        </div>
      </div>
    </button>
  `;
}

// ── Wiring des formulaires assets (charte + demandes spéciales) ─
function _wireAssetsForm() {
  // Form charte rapide (optionnel — n'existe que si needsLogo/Charte/Fonts)
  const form = _root?.querySelector('[data-slot="assets-form"]');
  if (form) {
    form.addEventListener('input', e => {
      const el = e.target;
      if (!el.name) return;
      if (['primary_hex', 'secondary_hex', 'font_title', 'font_body'].includes(el.name)) {
        _state.assets.charte[el.name] = el.value;
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

  // Form notes spéciales (toujours présent)
  const notesForm = _root?.querySelector('[data-slot="assets-notes-form"]');
  if (notesForm) {
    notesForm.addEventListener('input', e => {
      const el = e.target;
      if (el.name === 'extra_notes') {
        _state.assets.extra_notes = el.value;
        _scheduleSave();
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Vue 4 — OUTPUT
// ═══════════════════════════════════════════════════════════════
function _viewOutput() {
  const o = _state.output;
  const validationError = validateForGeneration(_state);
  const activeEngine = localStorage.getItem('ks_active_engine') || 'Claude';
  // Détection en amont : clé API du moteur actif présente ?
  const hasApiKey = !!_findApiKeyForEngine(activeEngine);

  let body = '';

  // ── État : déjà généré → afficher le résultat ─────────────
  if (o.status === 'done' && o.brief) {
    body = _renderBriefResult();
  }
  // ── État : en cours d'appel ─────────────────────────────
  else if (o.status === 'calling' || o.status === 'building') {
    // Pattern fallback Kodex : on indique l'engine essayé + bascule + retry
    let liveTitle = 'Kodex assemble votre brief…';
    let liveSub   = 'Construction du prompt à partir de vos saisies.';
    if (o.status === 'calling' && o.attempt_engine) {
      if (o.attempt_is_fallback) {
        liveTitle = `${_esc(o.attempt_previous)} indisponible — bascule sur ${_esc(o.attempt_engine)}…`;
        liveSub = 'Vos quotas étaient épuisés sur le premier moteur. Kodex tente automatiquement le suivant.';
      } else if (o.attempt_retry) {
        liveTitle = `${_esc(o.attempt_engine)} sature — nouvelle tentative (${o.attempt_retry}/3)…`;
        liveSub = 'Le moteur a renvoyé une erreur transitoire. On réessaie avec un court délai.';
      } else {
        liveTitle = `${_esc(o.attempt_engine)} rédige votre brief…`;
        liveSub = 'L\'IA croise vos données. Délai habituel 10 à 30 secondes selon la longueur du brief.';
      }
    }
    body = `
      <div class="ws-card" style="text-align:center;padding:48px 24px;">
        <div style="display:inline-flex;width:56px;height:56px;border-radius:50%;background:var(--gold3);align-items:center;justify-content:center;margin-bottom:16px;animation:ws-pulse 1.4s ease-in-out infinite;color:var(--gold);">
          ${icon('sparkles', 28)}
        </div>
        <h3 style="font-size:16px;font-weight:700;letter-spacing:-.018em;margin:0 0 6px 0;">${liveTitle}</h3>
        <p style="margin:0 0 14px 0;font-size:13px;color:var(--ws-text-muted);max-width:440px;margin-inline:auto;line-height:1.55;">
          ${liveSub}
        </p>
        <div data-slot="gen-progress" style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:18px;">
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ws-text-soft);font-variant-numeric:tabular-nums;">
            ${icon('refresh', 13)}
            <span data-slot="gen-timer">0 s</span>
            <span style="color:var(--ws-text-muted);">·</span>
            <span data-slot="gen-stage">${_esc(o.attempt_engine || 'préparation')}</span>
          </div>
          <div style="width:240px;height:3px;border-radius:999px;background:var(--ws-surface);overflow:hidden;">
            <div data-slot="gen-bar"
                 style="height:100%;background:var(--ws-accent);width:8%;border-radius:999px;
                        animation:gen-progress 18s ease-out forwards;"></div>
          </div>
        </div>
      </div>
      <style>
        @keyframes ws-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%       { transform: scale(1.08); opacity: .7; }
        }
        @keyframes gen-progress {
          0%   { width: 8%;  }
          30%  { width: 35%; }
          60%  { width: 70%; }
          100% { width: 92%; }
        }
      </style>
    `;
  }
  // ── État : erreur ────────────────────────────────────────
  else if (o.status === 'error') {
    // Détection des cas spécifiques d'erreur API pour adapter les boutons
    const errLow = (o.error || '').toLowerCase();
    const isExpired = /expired|expire|invalid.+key|unauthor|401|403/.test(errLow);
    const isMissing = /aucune clé|non configurée|missing.*key|api.?key.+missing/.test(errLow);
    const isApiKeyError = isExpired || isMissing || /clé api|api.?key/.test(errLow);
    const docUrl = ENGINE_DOC_URL[activeEngine];
    const otherEngines = _listAvailableEngines().filter(e => e !== activeEngine);
    body = `
      <div class="ws-card" style="border-color:var(--danger);background:var(--danger-soft);">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          ${icon('x', 22)}
          <div style="flex:1;min-width:0;">
            <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:var(--danger);">La génération a échoué</h3>
            <p style="margin:0;font-size:13px;color:var(--ws-text);line-height:1.5;">${_esc(o.error || 'Erreur inconnue.')}</p>
            ${isExpired && docUrl ? `
              <p style="margin:8px 0 0 0;font-size:12.5px;color:var(--ws-text-soft);line-height:1.5;">
                Renouvelez votre clé <strong>${_esc(activeEngine)}</strong> chez votre fournisseur :
                <a href="${_esc(docUrl)}" target="_blank" rel="noopener" style="color:var(--ws-accent);text-decoration:underline;">${_esc(docUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))} ↗</a>
              </p>
            ` : ''}
          </div>
        </div>
      </div>

      ${otherEngines.length ? `
        <div class="ws-card" style="margin-top:14px;padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            ${icon('sparkles', 14)}
            <strong style="font-size:13px;letter-spacing:-.008em;">Essayer un autre moteur AI</strong>
            <span style="font-size:11.5px;color:var(--ws-text-muted);">votre clé existante sera utilisée</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${otherEngines.map(e => `
              <button class="ws-btn ws-btn--secondary" data-act="switch-engine" data-engine="${_esc(e)}"
                      style="padding:7px 14px;font-size:12.5px;">
                ${_esc(e)}
              </button>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        ${isApiKeyError ? `
          <button class="ws-btn ws-btn--accent" data-act="open-vault">
            ${icon('lock', 16)} ${isExpired ? 'Mettre à jour' : 'Configurer'} ma clé ${_esc(activeEngine)}
          </button>
        ` : ''}
        <button class="ws-btn ${isApiKeyError ? 'ws-btn--secondary' : 'ws-btn--accent'}" data-act="regenerate">
          ${icon('refresh', 16)} Réessayer
        </button>
      </div>

      ${_renderManualModeCard({ context: 'error' })}
    `;
  }
  // ── État initial : invitation à générer ──────────────────
  else {
    const canGenerate = !validationError && hasApiKey;
    // Bandeau d'avertissement spécifique si clé API manquante
    const otherEnginesAvailable = _listAvailableEngines();
    const apiKeyMissingHTML = !hasApiKey ? `
      <div class="ws-card" style="margin-bottom:16px;border-color:var(--warn);background:var(--warn-soft, rgba(245, 158, 11, 0.08));padding:14px 16px;">
        <div style="display:flex;gap:12px;align-items:flex-start;">
          ${icon('lock', 18)}
          <div style="flex:1;">
            <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:var(--ws-text);">
              Clé API ${_esc(activeEngine)} manquante
            </h3>
            <p style="margin:0 0 10px 0;font-size:12.5px;color:var(--ws-text-soft);line-height:1.5;">
              Kodex interroge le moteur AI avec votre propre clé (BYOK), stockée chiffrée dans votre Vault.
              Configurez-la une fois, elle restera disponible pour tous les outils Keystone.
            </p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <button class="ws-btn ws-btn--accent" data-act="open-vault" style="padding:7px 14px;font-size:12.5px;">
                ${icon('lock', 14)} Configurer ma clé ${_esc(activeEngine)}
              </button>
              ${otherEnginesAvailable.length ? `
                <span style="font-size:11.5px;color:var(--ws-text-muted);">ou utilisez un moteur déjà configuré :</span>
                ${otherEnginesAvailable.map(e => `
                  <button class="ws-btn ws-btn--secondary" data-act="switch-engine" data-engine="${_esc(e)}"
                          style="padding:6px 12px;font-size:12px;">
                    ${_esc(e)}
                  </button>
                `).join('')}
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    ` : '';
    body = `
      ${apiKeyMissingHTML}
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
        <div style="margin-top:18px;border-top:1px solid var(--ws-border);padding-top:14px;">
          <button class="ws-btn ws-btn--ghost" data-act="toggle-manual"
                  style="padding:6px 14px;font-size:12px;color:var(--ws-text-muted);">
            ${icon(o.show_manual ? 'chevron-up' : 'file-text', 13)}
            ${o.show_manual ? 'Masquer le mode manuel' : 'Ou copier-coller sur une AI gratuite (plan B)'}
          </button>
        </div>
      </div>
      ${o.show_manual ? _renderManualModeCard({ context: 'default' }) : ''}
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
      ${brief.model ? `<span class="ws-badge">Modèle : ${_esc(brief.model)}${brief.used_fallback ? ' (fallback)' : ''}</span>` : ''}
      ${brief.used_fallback && Array.isArray(brief.tried_engines) && brief.tried_engines.length > 1 ? `
        <span class="ws-badge" style="color:var(--ws-text-muted);" title="Engines essayés dans l'ordre : ${_esc(brief.tried_engines.join(' → '))}">
          ${icon('refresh', 11)} ${_esc(brief.tried_engines.length)} moteurs essayés
        </span>
      ` : ''}
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

  // ── 1. Résolution de la liste d'engines à essayer (fallback) ──
  // L'engine actif est en tête, puis les autres engines avec clé API
  // configurée dans le Vault. Pattern repris de l'AI-assist Pulsa.
  const activeLabel = localStorage.getItem('ks_active_engine') || 'Claude';
  const enginesToTry = _resolveAIEnginesOrdered(activeLabel);
  if (enginesToTry.length === 0) {
    _state.output.status = 'error';
    _state.output.error  = `Aucune clé API ${activeLabel} configurée. Allez dans Réglages → Vault pour la saisir.`;
    _saveDraft();
    _renderMain();
    return;
  }

  _state.output.status = 'building';
  _renderMain();

  // ── 2. Construction du prompt ──────────────────────────────
  let prompt;
  try {
    const sector = await getSector(_state.content.sector);
    prompt = await buildCodeMaitre(_state, sector);
    _state.output.codeMaitre = prompt;
  } catch (e) {
    _state.output.status = 'error';
    _state.output.error = `Construction du prompt échouée : ${e.message}`;
    _renderMain();
    return;
  }

  // ── 3. Boucle de fallback sur les engines ──────────────────
  // Pattern : engine N essaie 3× sur 503 (transient), bascule sur N+1
  // si quota/credit/429/billing. Out direct si clé invalide / network.
  _state.output.status = 'calling';
  _state.output.attempt_engine = enginesToTry[0];
  _state.output.attempt_is_fallback = false;
  _renderMain();

  const isQuotaError = (msg) =>
    /credit|quota|insufficient|429|balance|billing|payment|exceed|too low/i.test(msg);
  const isTransient = (msg) =>
    /503|high demand|overload|unavailable|temporar/i.test(msg);
  const isAuthError = (msg) =>
    /401|403|expired|invalid.+key|unauthor|forbidden|failed to fetch|authentication/i.test(msg);
  const RETRY_DELAYS = [0, 1500, 3500];

  // Timer live : démarre dès le premier appel, mis à jour côté DOM toutes
  // les secondes pour rassurer l'utilisateur que ça travaille en arrière-plan.
  const startedAt = Date.now();
  const timerInterval = setInterval(() => {
    const timerEl = _root?.querySelector('[data-slot="gen-timer"]');
    if (timerEl) {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timerEl.textContent = s + ' s';
    }
  }, 500);

  let resultText = null;
  let usedEngine = null;
  let lastErr = null;
  let triedEngines = [];

  outer: for (let i = 0; i < enginesToTry.length; i++) {
    const engineLabel = enginesToTry[i];
    triedEngines.push(engineLabel);
    const engineKey = _findApiKeyForEngine(engineLabel);
    if (!engineKey) continue;

    // Status visuel : bascule entre engines
    const isFallback = i > 0;
    _state.output.attempt_engine = engineLabel;
    _state.output.attempt_is_fallback = isFallback;
    _state.output.attempt_previous = isFallback ? enginesToTry[i - 1] : null;
    _renderMain();
    if (isFallback) await new Promise(r => setTimeout(r, 500));

    // Retry interne sur 503
    let attemptErr = null;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        _state.output.attempt_retry = attempt + 1;
        _renderMain();
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      }
      try {
        const text = await ApiHandler.callEngine(engineLabel, prompt, engineKey);
        if (text && text.trim()) {
          resultText = text;
          usedEngine = engineLabel;
          break outer;  // succès → on sort des 2 boucles
        }
        attemptErr = new Error('Réponse vide du moteur');
      } catch (e) {
        attemptErr = e;
        const msg = e?.message || '';
        if (!isTransient(msg)) break;   // erreur non-transitoire → on sort du retry
      }
    }

    // Échec sur cet engine. On bascule UNIQUEMENT si quota épuisé.
    lastErr = attemptErr;
    const msg = attemptErr?.message || '';
    if (isAuthError(msg)) {
      // Clé invalide/expirée → on tente quand même les autres engines
      // (le user peut avoir d'autres clés valides). On continue donc la
      // boucle, mais sans message "bascule" trompeur.
      continue;
    }
    if (!isQuotaError(msg)) {
      // Erreur non-récupérable (network, format, etc.) → out
      break;
    }
    // Quota épuisé → on continue vers le moteur suivant (boucle outer)
  }
  clearInterval(timerInterval);
  delete _state.output.attempt_engine;
  delete _state.output.attempt_is_fallback;
  delete _state.output.attempt_previous;
  delete _state.output.attempt_retry;

  if (resultText) {
    _state.output.brief = {
      text: resultText,
      model: usedEngine,
      generated_at: new Date().toISOString(),
      used_fallback: usedEngine !== enginesToTry[0],
      tried_engines: triedEngines,
    };
    _state.output.status = 'done';
    _state.output.error = null;

    // Sauvegarde dans D1 entity codex_briefs (best-effort)
    _saveBriefInLibrary().catch(e => console.warn('[Kodex] save brief failed:', e.message));

    _saveDraft();
    _renderMain();
    _hydrateBriefText();
    const fallbackMark = (usedEngine !== enginesToTry[0]) ? ` (fallback)` : '';
    _toastOk(`Brief généré par ${usedEngine}${fallbackMark}`);
  } else {
    _state.output.status = 'error';
    _state.output.tried_engines = triedEngines;
    _state.output.error = _humanizeEngineError(lastErr, triedEngines);
    _saveDraft();
    _renderMain();
  }
}

// Liste ordonnée des engines à essayer : actif en tête, puis les autres
// engines avec clé API configurée dans le Vault.
function _resolveAIEnginesOrdered(activeLabel) {
  const preferred = ['Claude', 'ChatGPT', 'Gemini', 'Mistral', 'Grok', 'Perplexity', 'Llama'];
  const withKey = new Set(preferred.filter(l => _findApiKeyForEngine(l)));
  const ordered = [];
  if (withKey.has(activeLabel)) ordered.push(activeLabel);
  for (const l of preferred) {
    if (l === activeLabel) continue;
    if (withKey.has(l)) ordered.push(l);
  }
  return ordered;
}

// Traduit une erreur AI brute en message clair (FR), en mentionnant
// les engines qui ont été essayés si le fallback a eu lieu.
function _humanizeEngineError(err, triedEngines) {
  const msg = err?.message || 'Erreur inconnue';
  const tried = (triedEngines || []).join(', ');
  const triedMulti = (triedEngines || []).length > 1;
  if (/credit|quota|429|insufficient|balance|billing/i.test(msg)) {
    return tried
      ? `Quotas/crédits épuisés sur tous les moteurs essayés (${tried}). Rechargez un compte ou réessayez plus tard.`
      : msg;
  }
  if (/401|403|expired|invalid.+key|unauthor/i.test(msg)) {
    return triedMulti
      ? `Aucune clé valide parmi (${tried}). Mettez à jour vos clés API dans le Vault.`
      : `Clé API ${tried} invalide ou expirée. Mettez-la à jour dans le Vault.`;
  }
  if (/failed to fetch|network|timeout/i.test(msg)) {
    // Avec le proxy Worker Keystone, "Failed to fetch" peut aussi être
    // une clé qui n'a pas pu joindre le fournisseur. On reste ambigu.
    return triedMulti
      ? `Aucune réponse des moteurs essayés (${tried}). Vérifiez votre connexion ET la validité de vos clés API.`
      : `Pas de réponse de ${tried}. Vérifiez votre connexion ET la validité de votre clé API.`;
  }
  return msg;
}

// ── Mapping moteur → URL de gestion de la clé API (renouvellement)
const ENGINE_DOC_URL = {
  'Claude'    : 'https://console.anthropic.com/settings/keys',
  'ChatGPT'   : 'https://platform.openai.com/api-keys',
  'GPT 5'     : 'https://platform.openai.com/api-keys',
  'Gemini'    : 'https://aistudio.google.com/app/apikey',
  'Mistral'   : 'https://console.mistral.ai/api-keys/',
  'Grok'      : 'https://console.x.ai/',
  'Perplexity': 'https://www.perplexity.ai/settings/api',
  'Llama'     : 'https://api.together.xyz/settings/api-keys',
};

// ── Mapping moteur → URL de l'interface web GRATUITE (plan B humain)
// L'utilisateur copie le Code Maître, ouvre un de ces liens, colle.
// Toutes les interfaces ont une version gratuite (souvent avec compte).
const ENGINE_WEB_URL = {
  'Claude'    : { url: 'https://claude.ai/new',          host: 'claude.ai' },
  'ChatGPT'   : { url: 'https://chatgpt.com/',           host: 'chatgpt.com' },
  'GPT 5'     : { url: 'https://chatgpt.com/',           host: 'chatgpt.com' },
  'Gemini'    : { url: 'https://gemini.google.com/app',  host: 'gemini.google.com' },
  'Mistral'   : { url: 'https://chat.mistral.ai/chat',   host: 'chat.mistral.ai' },
  'Grok'      : { url: 'https://grok.com/',              host: 'grok.com' },
  'Perplexity': { url: 'https://www.perplexity.ai/',     host: 'perplexity.ai' },
  'Llama'     : { url: 'https://www.meta.ai/',           host: 'meta.ai' },
};

// Liste tous les moteurs avec une clé API configurée dans le Vault
function _listAvailableEngines() {
  const labels = ['Claude', 'ChatGPT', 'Gemini', 'Mistral', 'Grok', 'Perplexity', 'Llama'];
  return labels.filter(l => _findApiKeyForEngine(l));
}

// ── Card "Plan B humain" : copier le Code Maître + liens AI web ──
// Utilisé à 2 endroits :
//   - dans la card erreur "tous engines KO" (toujours visible)
//   - dans le hero "Le brief" via un toggle discret (pour user qui
//     préfère générer manuellement depuis le départ)
function _renderManualModeCard(opts = {}) {
  const { context = 'default' } = opts;
  // Labels affichés en pills "Ouvrir [AI]" — uniquement ceux qu'on a
  // dans ENGINE_WEB_URL (= les plus connus, version web gratuite)
  const aiPills = ['Claude', 'ChatGPT', 'Gemini', 'Mistral', 'Grok', 'Perplexity']
    .map(label => {
      const web = ENGINE_WEB_URL[label];
      if (!web) return '';
      return `
        <a href="${_esc(web.url)}" target="_blank" rel="noopener"
           class="ws-btn ws-btn--secondary"
           style="padding:8px 14px;font-size:12.5px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
          ${_esc(label)}
          <span style="font-size:10px;color:var(--ws-text-muted);">${_esc(web.host)} ↗</span>
        </a>
      `;
    }).join('');

  const introBg = context === 'error'
    ? 'var(--ws-accent-soft)'
    : 'var(--ws-surface)';
  const introHeader = context === 'error'
    ? `Plan B : utilisez n'importe quelle AI gratuite`
    : `Générer manuellement (plan B sans clé API)`;
  const introBlurb = context === 'error'
    ? `Vos clés API sont toutes en panne ? Pas de souci. Copiez le Code Maître ci-dessous et collez-le dans n'importe quelle interface web gratuite — vous obtiendrez le même brief en quelques secondes.`
    : `Vous n'avez pas envie de saisir une clé API ? Copiez le Code Maître et collez-le dans une AI web gratuite. Pratique pour tester ou en mode dépannage.`;

  return `
    <div class="ws-card" data-slot="manual-mode"
         style="padding:18px 20px;background:${introBg};border-color:var(--ws-accent);margin-top:14px;">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:14px;">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--ws-accent);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">
          ${icon('file-text', 18)}
        </div>
        <div style="flex:1;min-width:0;">
          <h3 style="margin:0 0 4px 0;font-size:14px;font-weight:700;letter-spacing:-.012em;color:var(--ws-text);">
            ${_esc(introHeader)}
          </h3>
          <p style="margin:0;font-size:12.5px;color:var(--ws-text-soft);line-height:1.55;">
            ${introBlurb}
          </p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:auto 1fr;gap:10px 16px;align-items:center;margin-bottom:14px;">
        <div style="display:inline-flex;width:24px;height:24px;border-radius:50%;background:var(--ws-accent);color:#fff;align-items:center;justify-content:center;font-size:12px;font-weight:700;">1</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="ws-btn ws-btn--accent" data-act="copy-prompt"
                  style="padding:8px 14px;font-size:13px;">
            ${icon('save', 14)} Copier le Code Maître
          </button>
          <span style="font-size:12px;color:var(--ws-text-muted);">prompt complet prêt à être collé</span>
        </div>

        <div style="display:inline-flex;width:24px;height:24px;border-radius:50%;background:var(--ws-accent);color:#fff;align-items:center;justify-content:center;font-size:12px;font-weight:700;">2</div>
        <div>
          <div style="font-size:12.5px;color:var(--ws-text);margin-bottom:8px;font-weight:600;">
            Ouvrez l'interface web de votre choix (compte gratuit suffit)
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${aiPills}
          </div>
        </div>

        <div style="display:inline-flex;width:24px;height:24px;border-radius:50%;background:var(--ws-accent);color:#fff;align-items:center;justify-content:center;font-size:12px;font-weight:700;">3</div>
        <div style="font-size:12.5px;color:var(--ws-text);">
          Collez le Code Maître (<kbd style="font-family:'SF Mono',monospace;font-size:11px;padding:1px 5px;background:var(--ws-surface);border:1px solid var(--ws-border);border-radius:4px;">Cmd</kbd>+<kbd style="font-family:'SF Mono',monospace;font-size:11px;padding:1px 5px;background:var(--ws-surface);border:1px solid var(--ws-border);border-radius:4px;">V</kbd>), envoyez, puis copiez la réponse — c'est votre brief prêt à transmettre à votre graphiste.
        </div>
      </div>
    </div>
  `;
}

// ── Devine un vendor_id à partir du label texte (fallback briefs legacy)
function _guessVendorIdFromLabel(label) {
  if (!label) return null;
  const v = String(label).toLowerCase();
  if (v.includes('exa'))    return 'exaprint';
  if (v.includes('vista'))  return 'vistaprint';
  if (v.includes('pixart')) return 'pixartprinting';
  return 'other';
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
    category: _state.destination.category,
    // v3 vendor-aware (nouveaux champs)
    support_id: _state.destination.support_id,
    vendor_id:  _state.destination.vendor_id,
    // miroir rétro-compat avec les briefs créés en v2
    preset_id: _state.destination.support_id,
    standard_snapshot: _state.destination.standard,
    vendor: _state.destination.standard?.vendor || '',
    product_name: _state.destination.standard?.product_name || '',
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
  const f    = _state.content.fields || {};
  // v3 universel : nom_projet ; rétro-compat : anciens champs métier
  const prog = f.nom_projet
            || f.nom_programme
            || f.nom_enseigne
            || f.nom_etablissement;
  const parts = [];
  if (prog) parts.push(prog);
  if (std)  {
    const supportLabel = std.product_name || std.type_support || 'Support';
    parts.push(std.vendor ? `${supportLabel} chez ${std.vendor}` : supportLabel);
  }
  return parts.join(' — ') || 'Brief sans titre';
}

// ═══════════════════════════════════════════════════════════════
// Step navigation footer (prev / next)
// ═══════════════════════════════════════════════════════════════
function _stepNav() {
  const idx = _currentStepIndex();
  const isLast = idx === STEPS.length - 1;
  const canBack = _canGoBack();

  // Libellé "Précédent" simple (plus de sous-step interne Destination)
  const backLabel = 'Précédent';

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

// ── Bouton "Précédent" en bas ─────────────────────────────────
// Refonte universelle : plus de sous-étapes dans Destination.
// Le bouton remonte simplement à l'étape précédente du flux principal.
function _back() {
  const i = _currentStepIndex();
  if (i > 0) _navigate(STEPS[i - 1].id);
}

// ── Le bouton "Précédent" doit-il être visible/actif ? ────────
function _canGoBack() {
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
