/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact SDQR (Dynamic QR)
   Sprint SDQR-1 : foundation backend + premier QR dynamique URL

   Workspace fullscreen indépendant (pas le modal pad classique).
   Layout : sidebar gauche "Mes QRs" + central area (tabs Studio/Stats)

   API Worker :
     POST   /api/qr          créer un QR dynamique URL
     GET    /api/qr          lister les QRs du tenant
     PATCH  /api/qr/:id      modifier cible / nom / tags / status

   Public :
     GET    /r/:shortId      redirection + log scan (côté Worker)

   QR encoder : qrcode-generator via esm.sh (UMD wrapped en ESM).
   Bundle léger, output SVG natif que l'on stylera au Sprint SDQR-3.
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from './pads-loader.js';
import { deliverEntryHtml, wireDeliver } from './lib/asset-deliver.js';
import { QR_TYPES, encodePayload, previewSummary } from './sdqr-types.js';
// Smart QR V2 — registry de templates programmables (cf. ./sdqr-templates/)
import { listTemplates, getTemplate, isKnownTemplate } from './sdqr-templates/index.js';
import { getTemplateIconSvg } from './sdqr-template-icons.js';
import { renderQrCustom, mergeDesign, DEFAULT_DESIGN, contrastRatio, contrastLevel, FRAME_OPTS, anchorPreviewSvg } from './sdqr-render.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';
import { burgerHTML, bindBurger }            from './lib/topbar-burger.js';
// Concierge VEFA (Sprint 7) — relai VEFA Studio -> SDQR + garde-fou léger.
// Module pur partagé (importable front ET Node) : SEULE source de la forme
// « à plat » du programme. L'adaptation source->bloc reste côté Worker.
import {
  PROGRAM_STORAGE_KEY, coerceProgram, validateProgramLight,
  blankKeyform, blankKeyformItem, coerceKeyform, validateKeyformLight,
} from './lib/concierge-program.js';
// Sprint C-b — gabarit « Fiche établissement » : création + PUBLICATION
// directe via l'API (sans ouvrir l'éditeur Key Form -> structure figée,
// infalsifiable, lien prêt à partager en 1 clic).
import { buildConciergeFicheGabarit, isConciergeGabarit, gabaritResponseToSubmission } from './lib/concierge-keyform-gabarit.js';
import { saveForm } from './lib/pulsa-library.js';

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';

let _qrLib       = null;       // lazy import (legacy createSvgTag fallback)
let _cachedQrs   = [];         // dernière liste reçue
let _currentView = 'studio';   // 'studio' | 'stats'
let _selectedId  = null;       // QR sélectionné dans la sidebar
let _busy        = false;      // anti-double-click

// Bibliothèque « Mes QR » (maquettes 13-14) — vue par défaut du Studio quand
// des QR existent et qu'aucun n'est sélectionné.
let _libView = 'grid';                       // 'grid' | 'table'
let _libSort = { key: 'scans', dir: 'desc' }; // tri du tableau
let _libSel  = new Set();                    // ids sélectionnés (multi-sélection tableau)
try { const v = localStorage.getItem('sdqr_lib_view'); if (v === 'grid' || v === 'table') _libView = v; } catch (e) {}

// Filtres sidebar (Sprint final)
let _filter = {
  search: '',                  // matcher nom + tags
  status: 'all',               // all | active | archived
  type  : 'all',               // all | url | text | vcard | wifi | ical
  folder: 'all',               // all | <nom de dossier> | __none__ (non classés)
};

// État de la fenêtre de création (Sprint SDQR-2)
let _creating = {
  mode    : 'dynamic',         // 'static' | 'dynamic'
  type    : 'url',             // url | text | vcard | wifi | ical
  payload : {},                // valeurs des champs typés
  name    : '',
  tags    : '',
};

// ── Concierge VEFA (S7) — relai VEFA Studio -> SDQR ────────────────
// VEFA Studio dépose { program, ts } sous PROGRAM_STORAGE_KEY puis ouvre
// SDQR. À l'ouverture, on auto-saute dans le formulaire concierge si le
// relai est FRAIS (< 3 min) et pas déjà consommé pendant cette session
// (anti re-saut à chaque réouverture de SDQR).
const VEFA_RELAY_FRESH_MS = 3 * 60 * 1000;
let _lastVefaRelayTs = 0;

// Lit + parse le relai. Retourne { program (forme garantie), ts } ou null.
function _readVefaRelay() {
  try {
    const raw = localStorage.getItem(PROGRAM_STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || !obj.program) return null;
    return { program: coerceProgram(obj.program), ts: Number(obj.ts) || 0 };
  } catch { return null; }
}

// ── Lazy import du QR encoder ──────────────────────────────────
async function _loadQrLib() {
  if (_qrLib) return _qrLib;
  const mod = await import(QR_CDN);
  _qrLib = mod.default || mod;
  return _qrLib;
}

// ── Tenant ID (à durcir avec JWT plus tard) ────────────────────
function _tenantId() {
  return localStorage.getItem('ks_tenant_id') || 'default';
}

// ── Headers d'auth pour les appels Worker ──────────────────────
// Sprint Sécu-1 C2 a imposé auth obligatoire sur /api/qr/*. On
// envoie le token disponible (admin secret en priorité, puis JWT
// licence). Le Worker accepte les deux : requireAdmin OU requireJWT.
function _headers(extra = {}) {
  const h = { 'X-Tenant-Id': _tenantId(), ...extra };
  const adminToken = localStorage.getItem('ks_admin_token');
  const jwt        = localStorage.getItem('ks_jwt');
  if (adminToken)  h['Authorization'] = 'Bearer ' + adminToken;
  else if (jwt)    h['Authorization'] = 'Bearer ' + jwt;
  return h;
}

// ══════════════════════════════════════════════════════════════════
// API client
// ══════════════════════════════════════════════════════════════════

async function _apiList() {
  const r = await fetch(`${CF_API}/api/qr`, {
    headers: _headers(),
  });
  if (!r.ok) throw new Error('API list error ' + r.status);
  const body = await r.json();
  return body.qrs || [];
}

async function _apiCreate(payload) {
  const r = await fetch(`${CF_API}/api/qr`, {
    method: 'POST',
    headers: _headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'API create error ' + r.status);
  }
  return (await r.json()).qr;
}

async function _apiUpdate(id, patch) {
  const r = await fetch(`${CF_API}/api/qr/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: _headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'API update error ' + r.status);
  }
  return (await r.json()).qr;
}

async function _apiDelete(id) {
  const r = await fetch(`${CF_API}/api/qr/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: _headers(),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'API delete error ' + r.status);
  }
  return true;
}

// Sprint SDQR-4 — analytics
async function _apiStats(id, period = '30d') {
  const r = await fetch(`${CF_API}/api/qr/${encodeURIComponent(id)}/stats?period=${period}`, {
    headers: _headers(),
  });
  if (!r.ok) throw new Error('API stats error ' + r.status);
  return r.json();
}

// Sprint SDQR-S1.3 — vue d'ensemble « tous mes QR » (lecture seule)
async function _apiOverview(period = '30d') {
  const r = await fetch(`${CF_API}/api/qr/overview?period=${period}`, { headers: _headers() });
  if (!r.ok) throw new Error('API overview error ' + r.status);
  return r.json();
}

function _apiScansCsvUrl(id) {
  // Worker accepte X-Tenant-Id en query string aussi pour download direct
  return `${CF_API}/api/qr/${encodeURIComponent(id)}/scans.csv`;
}

// ══════════════════════════════════════════════════════════════════
// QR SVG rendering (basic, sans design custom — Sprint SDQR-3)
// ══════════════════════════════════════════════════════════════════

async function _renderQrSvg(text, sizePx = 220, design = null) {
  // Sprint SDQR-3 : on délègue au moteur custom (sdqr-render.js) qui
  // gère les formes modules, ancres, couleurs, gradient, logo central.
  return renderQrCustom(text, design, sizePx);
}

// ══════════════════════════════════════════════════════════════════
// Workspace fullscreen — shell + sidebar + central
// ══════════════════════════════════════════════════════════════════

export function openSDQR(opts = {}) {
  let panel = document.getElementById('sdqr-fullscreen');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'sdqr-fullscreen';
    panel.className = 'sdqr-fullscreen';
    document.body.appendChild(panel);
  }
  panel.innerHTML = _renderShell();
  panel.classList.add('open');
  document.body.style.overflow = 'hidden';

  // SDQR S2 — le pad applique le design fixe (clair + accent or), indépendamment
  // de la préférence clair/sombre globale. On force le mode clair le temps de
  // l'ouverture (réutilise le thème clair complet déjà fiabilisé), et on restaure
  // l'état antérieur à la fermeture (cf. closeSDQR) → aucun effet de bord persistant.
  document.documentElement.dataset.sdqrPrevLight =
    document.documentElement.classList.contains('light-mode') ? '1' : '0';
  document.documentElement.classList.add('light-mode');

  _wireShell(panel);
  bindRatingButton(panel, 'A-COM-001');
  bindHelpButton(panel, 'A-COM-001');
  bindBurger(panel);
  // CG-13 — ouverture directe d'un QR existant (bibliothèque VEFA Studio).
  if (opts && opts.editId) { _openExistingQrById(panel, opts.editId); return; }
  // Charge la flotte puis affiche la bibliothèque « Mes QR » par défaut (sauf
  // si un deep-link a ouvert le formulaire de création -> classe --create posée).
  _refreshList(panel).then(() => {
    const c = panel.querySelector('#sdqr-content');
    if (!_selectedId && c && !c.classList.contains('sdqr-content--create')) _renderCurrentView(panel);
  });
  // Deep-link : ouverture directe du formulaire de création sur Concierge
  // (depuis le CTA VEFA Studio). 'immo' | 'general'.
  if (opts && opts.createConcierge) { _openCreateForm(panel, { presetConcierge: opts.createConcierge }); return; }
  // Deep-link Smart Agent (CTA « Designer le QR ») : QR dynamique pointant sur
  // l'URL publique de l'agent, prêt à styler + tracker. URL + nom pré-remplis.
  if (opts && opts.createUrl) { _openCreateForm(panel, { presetUrl: opts.createUrl, presetName: opts.presetName }); return; }
  // Concierge VEFA (S7) — si VEFA Studio vient de relayer un programme frais.
  _maybeAutoOpenVefaConcierge(panel);
}

// CG-13 — reproduit le clic sur une carte de la liste : recharge la flotte,
// sélectionne le QR ciblé puis ouvre sa vue détail (édition / export).
async function _openExistingQrById(panel, id) {
  const listEl = panel.querySelector('#sdqr-list');
  try {
    _cachedQrs = await _apiList();
  } catch (e) {
    if (listEl) listEl.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur : ${_esc(e.message)}</div>`;
    return;
  }
  _renderList(panel);
  if (!_cachedQrs.find(q => q.id === id)) return;   // QR introuvable : on reste sur la liste
  _selectedId = id;
  _renderList(panel);
  _renderCurrentView(panel);
}

// Concierge VEFA (S7) — auto-saut dans le formulaire concierge quand VEFA
// Studio a déposé un programme FRAIS (< 3 min) non encore consommé pendant
// cette session. Sinon : ouverture normale (liste). Le relai reste en
// storage (l'aperçu le relit), borné par la fenêtre de fraîcheur.
function _maybeAutoOpenVefaConcierge(panel) {
  const relay = _readVefaRelay();
  if (!relay) return;
  const fresh = relay.ts && relay.ts > (Date.now() - VEFA_RELAY_FRESH_MS);
  if (!fresh || relay.ts === _lastVefaRelayTs) return;
  _lastVefaRelayTs = relay.ts;                 // consommé : pas de re-saut
  _openCreateForm(panel, { conciergeVefa: relay });
}

export function closeSDQR() {
  document.getElementById('sdqr-fullscreen')?.classList.remove('open');
  document.body.style.overflow = '';
  // Restaure la préférence clair/sombre antérieure (cf. openSDQR).
  if (document.documentElement.dataset.sdqrPrevLight === '0') {
    document.documentElement.classList.remove('light-mode');
  }
  delete document.documentElement.dataset.sdqrPrevLight;
}

function _renderShell() {
  return `
    <div class="sdqr-topbar">
      <div class="sdqr-topbar-left">
        <div class="ws-topbar-brand">
          <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
            <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
            <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
          </a>
          <button class="ws-topbar-back" id="sdqr-close-btn" title="Retour" aria-label="Retour">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:34px;height:34px"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>
        <div class="sdqr-title-zone">
          <span class="ws-topbar-app-picto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="16" y="16" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="19" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="19" width="2" height="2" fill="currentColor" stroke="none"/></svg>
          </span>
          <div class="sdqr-title">Smart Dynamic QR</div>
        </div>
      </div>
      ${burgerHTML()}
      <div class="sdqr-topbar-right">
        ${helpButtonHTML('A-COM-001')}
        ${ratingButtonHTML('A-COM-001')}
        <a class="sdqr-pill sdqr-pill--ok sdqr-pill--link" href="${CF_API}/sdqr-privacy" target="_blank" rel="noopener noreferrer"
           title="Voir la politique de transparence RGPD (s'ouvre dans un nouvel onglet)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:-1px;margin-right:4px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Souverain · RGPD
        </a>
      </div>
    </div>

    <div class="sdqr-body">
      <aside class="sdqr-sidebar">
        <div class="sdqr-sidebar-head">
          <span class="sdqr-sidebar-title">Mes QRs</span>
          <button class="sdqr-new-btn" id="sdqr-new-btn" title="Nouveau QR">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nouveau
          </button>
        </div>
        <button class="sdqr-overview-btn" id="sdqr-overview-btn" title="Statistiques de tous tes QR" style="display:flex;align-items:center;gap:8px;margin:0 12px 10px;width:calc(100% - 24px);padding:9px 11px;border:1px solid rgba(99,102,241,.4);background:rgba(99,102,241,.12);color:#1b2a4a;border-radius:9px;font-size:12.5px;font-weight:600;cursor:pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:15px;height:15px"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="0.5"/><rect x="12" y="7" width="3" height="10" rx="0.5"/><rect x="17" y="13" width="3" height="4" rx="0.5"/></svg>
          Vue d'ensemble
        </button>
        <div class="sdqr-sidebar-filters">
          <div class="sdqr-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="sdqr-search-ico"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" id="sdqr-search" class="sdqr-search-input" placeholder="Rechercher… (⌘K)" autocomplete="off">
            <kbd class="sdqr-search-kbd">⌘K</kbd>
          </div>
          <div class="sdqr-filter-pills" id="sdqr-filter-status">
            <button class="sdqr-filter-pill is-active" data-status="all">Tous</button>
            <button class="sdqr-filter-pill" data-status="active">Actifs</button>
            <button class="sdqr-filter-pill" data-status="archived">Archivés</button>
          </div>
        </div>
        <div class="sdqr-folder-bar" id="sdqr-folders"></div>
        <div class="sdqr-sidebar-list" id="sdqr-list">
          <div class="sdqr-empty-mini">Chargement…</div>
        </div>
      </aside>

      <main class="sdqr-main">
        <div class="sdqr-tabs">
          <button class="sdqr-tab active" data-view="studio">Studio</button>
          <button class="sdqr-tab" data-view="stats">Statistiques</button>
        </div>
        <div class="sdqr-content" id="sdqr-content">
          ${_renderEmptyStudio()}
        </div>
      </main>
    </div>
  `;
}

function _renderEmptyStudio() {
  return `
    <div class="sdqr-empty-state">
      <div class="sdqr-empty-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:56px;height:56px;opacity:.45">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="16" y="16" width="2" height="2"/>
          <rect x="14" y="14" width="2" height="2"/>
          <rect x="19" y="14" width="2" height="2"/>
          <rect x="14" y="19" width="2" height="2"/>
          <rect x="19" y="19" width="2" height="2"/>
        </svg>
      </div>
      <h2 class="sdqr-empty-title">Créez votre premier QR dynamique</h2>
      <p class="sdqr-empty-text">Une URL modifiable après impression, sans regénérer le QR.<br>Chaque scan est tracké de façon souveraine (RGPD).</p>
      <button class="sdqr-cta" id="sdqr-cta-new">+ Nouveau QR dynamique</button>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════
// Bibliothèque « Mes QR » (maquettes 13-14) — vue par défaut du Studio
// quand des QR existent. Deux présentations : GRILLE (cartes) et TABLEAU
// (lignes denses, colonnes triables, multi-sélection -> actions groupées).
// Sur le puits navy (.sdqr-content--lib), panneaux blancs, or rare.
// ══════════════════════════════════════════════════════════════════
let _libMenuBound = false;

const _LIBICO = {
  grid:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  rows:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  dots:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  arch:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

// Groupe les milliers avec une espace ASCII (jamais U+202F/U+00A0).
function _fmtNum(n) { return String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

// Liste filtrée (mêmes filtres que la sidebar) puis triée (vue tableau).
function _libQrs() {
  const list = _applyFilters(_cachedQrs);
  const { key, dir } = _libSort;
  const m = dir === 'asc' ? 1 : -1;
  const val = q => {
    switch (key) {
      case 'name':   return (q.name || '').toLowerCase();
      case 'type':   return (QR_TYPES[q.qr_type]?.label || q.qr_type || '').toLowerCase();
      case 'mode':   return (q.mode || 'dynamic');
      case 'status': return (q.status || 'active');
      default:       return (q.mode || 'dynamic') === 'dynamic' ? (q.scans_total || 0) : -1;
    }
  };
  return list.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va < vb) return -1 * m;
    if (va > vb) return  1 * m;
    return 0;
  });
}

function _qrCardHtml(q) {
  const typeDef = QR_TYPES[q.qr_type] || QR_TYPES.url;
  const isDyn = (q.mode || 'dynamic') === 'dynamic';
  const isCg  = q.template_id === 'concierge';
  const isArch = q.status === 'archived';
  return `
    <div class="sdqr-qr-card" role="button" tabindex="0" data-qr-id="${_esc(q.id)}">
      <button class="sdqr-qr-menu-btn" data-menu="${_esc(q.id)}" title="Actions" aria-label="Actions">${_LIBICO.dots}</button>
      <div class="sdqr-qr-card-top">
        <span class="sdqr-qr-card-ico">${typeDef.icon}</span>
        <span class="sdqr-qr-card-name">${_esc(q.name || '(sans nom)')}</span>
      </div>
      <div class="sdqr-qr-badges">
        <span class="sdqr-qr-badge sdqr-qr-badge--type">${_esc(typeDef.label)}</span>
        <span class="sdqr-qr-badge sdqr-qr-badge--${isDyn ? 'dyn' : 'stat'}">${isDyn ? 'Dynamique' : 'Statique'}</span>
        ${isCg   ? '<span class="sdqr-qr-badge sdqr-qr-badge--cg">Concierge</span>' : ''}
        ${isArch ? '<span class="sdqr-qr-badge sdqr-qr-badge--arch">Archivé</span>' : ''}
      </div>
      <div class="sdqr-qr-card-foot">
        ${isDyn
          ? `<span class="sdqr-qr-scans">${_fmtNum(q.scans_total || 0)}<small>scans</small></span>`
          : `<span class="sdqr-qr-scans sdqr-qr-scans--stat">&#8734;<small>hors-ligne</small></span>`}
        ${q.folder ? `<span class="sdqr-qr-card-folder">${_ICO.folder}${_esc(q.folder)}</span>` : ''}
      </div>
    </div>`;
}

function _qrRowHtml(q) {
  const typeDef = QR_TYPES[q.qr_type] || QR_TYPES.url;
  const isDyn = (q.mode || 'dynamic') === 'dynamic';
  const isArch = q.status === 'archived';
  const checked = _libSel.has(q.id);
  return `
    <tr class="${checked ? 'is-checked' : ''}" data-qr-id="${_esc(q.id)}">
      <td class="sdqr-tbl-col-check"><input type="checkbox" data-check="${_esc(q.id)}" ${checked ? 'checked' : ''} aria-label="Sélectionner"></td>
      <td><span class="sdqr-tbl-name">${_esc(q.name || '(sans nom)')}</span></td>
      <td><span class="sdqr-tbl-type">${typeDef.icon}${_esc(typeDef.label)}</span></td>
      <td><span class="sdqr-tbl-mode sdqr-tbl-mode--${isDyn ? 'dyn' : 'stat'}">${isDyn ? 'Dynamique' : 'Statique'}</span></td>
      <td class="sdqr-tbl-scans">${isDyn ? _fmtNum(q.scans_total || 0) : '&#8734;'}</td>
      <td class="sdqr-tbl-col-hide"><span class="sdqr-tbl-st">${q.folder ? _esc(q.folder) : '&mdash;'}</span></td>
      <td><span class="sdqr-tbl-st">${isArch ? 'Archivé' : 'Actif'}</span></td>
      <td class="sdqr-tbl-col-act"><button class="sdqr-qr-menu-btn" data-menu="${_esc(q.id)}" title="Actions" aria-label="Actions">${_LIBICO.dots}</button></td>
    </tr>`;
}

function _libCloseMenu() { document.querySelectorAll('.sdqr-qr-pop').forEach(p => p.remove()); }

function _libToggleMenu(panel, q, btn) {
  const existing = document.querySelector('.sdqr-qr-pop');
  const wasMine = existing && existing.dataset.for === q.id;
  _libCloseMenu();
  if (wasMine) return;
  const isArch = q.status === 'archived';
  const pop = document.createElement('div');
  pop.className = 'sdqr-qr-pop';
  pop.dataset.for = q.id;
  pop.style.position = 'fixed';
  pop.innerHTML = `
    <button data-act="open">${_LIBICO.eye}Ouvrir</button>
    <button data-act="archive">${_LIBICO.arch}${isArch ? 'Réactiver' : 'Archiver'}</button>
    ${isArch ? `<button data-act="delete" class="is-danger">${_LIBICO.trash}Supprimer</button>` : ''}`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 168;
  pop.style.top  = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, r.right - w) + 'px';
  pop.querySelector('[data-act="open"]').onclick    = () => { _libCloseMenu(); _selectFromLib(panel, q.id); };
  pop.querySelector('[data-act="archive"]').onclick = () => { _libCloseMenu(); _libArchive(panel, [q.id], isArch ? 'active' : 'archived'); };
  const del = pop.querySelector('[data-act="delete"]');
  if (del) del.onclick = () => {
    _libCloseMenu();
    if (confirm(`Supprimer définitivement « ${q.name || 'ce QR'} » ? Les scans historiques sont conservés.`)) _libDelete(panel, [q.id]);
  };
}

function _selectFromLib(panel, id) {
  _selectedId = id;
  _renderList(panel);
  _renderCurrentView(panel);
}

async function _libArchive(panel, ids, status) {
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => _apiUpdate(id, { status })));
    _libSel.clear();
    await _refreshList(panel);
  } catch (e) { console.error('[sdqr-lib] archive', e); }
  _renderLibrary(panel);
}

async function _libDelete(panel, ids) {
  if (!ids.length) return;
  try {
    await Promise.all(ids.map(id => _apiDelete(id)));
    _libSel.clear();
    await _refreshList(panel);
  } catch (e) { console.error('[sdqr-lib] delete', e); }
  _renderLibrary(panel);
}

function _renderLibrary(panel) {
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;
  content.classList.remove('sdqr-content--create');
  content.classList.add('sdqr-content--lib');

  const qrs = _libQrs();
  // Purge la sélection des ids qui ne sont plus visibles (filtre/suppression).
  const visible = new Set(qrs.map(q => q.id));
  for (const id of [..._libSel]) if (!visible.has(id)) _libSel.delete(id);

  const total = _applyFilters(_cachedQrs).length;
  const head = `
    <div class="sdqr-lib-head">
      <span class="sdqr-lib-title">Mes QR</span>
      <span class="sdqr-lib-count">${total} code${total > 1 ? 's' : ''}</span>
      <div class="sdqr-lib-tools">
        <div class="sdqr-lib-toggle" id="sdqr-lib-toggle">
          <button class="sdqr-lib-seg ${_libView === 'grid'  ? 'is-active' : ''}" data-libview="grid">${_LIBICO.grid}Grille</button>
          <button class="sdqr-lib-seg ${_libView === 'table' ? 'is-active' : ''}" data-libview="table">${_LIBICO.rows}Tableau</button>
        </div>
      </div>
    </div>`;

  let body;
  if (_libView === 'table') {
    const th = (key, label) =>
      `<th data-sort="${key}" class="${_libSort.key === key ? 'is-sorted' : ''}">${label}${_libSort.key === key ? ` <span class="sdqr-th-arrow">${_libSort.dir === 'asc' ? '&#9650;' : '&#9660;'}</span>` : ''}</th>`;
    const allChecked = qrs.length > 0 && qrs.every(q => _libSel.has(q.id));
    const n = _libSel.size;
    const selQrs = qrs.filter(q => _libSel.has(q.id));
    const allArch = n > 0 && selQrs.every(q => q.status === 'archived');
    const bulk = n > 0 ? `
      <div class="sdqr-bulk">
        <span class="sdqr-bulk-count">${n} sélectionné${n > 1 ? 's' : ''}</span>
        <div class="sdqr-bulk-tools">
          <button class="sdqr-bulk-btn" data-bulk="archive">${_LIBICO.arch}Archiver</button>
          ${allArch ? `<button class="sdqr-bulk-btn sdqr-bulk-btn--danger" data-bulk="delete">${_LIBICO.trash}Supprimer</button>` : ''}
          <button class="sdqr-bulk-btn sdqr-bulk-btn--ghost" data-bulk="clear">Désélectionner</button>
        </div>
      </div>` : '';
    body = bulk + `
      <div class="sdqr-tbl-wrap">
        <table class="sdqr-tbl">
          <thead><tr>
            <th class="sdqr-tbl-col-check is-static"><input type="checkbox" id="sdqr-tbl-all" ${allChecked ? 'checked' : ''} aria-label="Tout sélectionner"></th>
            ${th('name', 'Nom')}${th('type', 'Type')}${th('mode', 'Mode')}${th('scans', 'Scans')}
            <th class="sdqr-tbl-col-hide is-static">Dossier</th>
            ${th('status', 'Statut')}
            <th class="sdqr-tbl-col-act is-static"></th>
          </tr></thead>
          <tbody>${qrs.map(_qrRowHtml).join('')}</tbody>
        </table>
      </div>`;
  } else {
    body = `<div class="sdqr-qr-grid">${qrs.map(_qrCardHtml).join('')}</div>`;
  }

  content.innerHTML = head + body;

  // — Bascule Grille / Tableau —
  content.querySelectorAll('[data-libview]').forEach(b => b.addEventListener('click', () => {
    _libView = b.dataset.libview;
    try { localStorage.setItem('sdqr_lib_view', _libView); } catch (e) {}
    _renderLibrary(panel);
  }));

  // — Menus ⋯ (grille + tableau) —
  content.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const q = _cachedQrs.find(x => x.id === btn.dataset.menu);
    if (q) _libToggleMenu(panel, q, btn);
  }));

  if (_libView === 'grid') {
    content.querySelectorAll('.sdqr-qr-card').forEach(card => {
      const go = () => _selectFromLib(panel, card.dataset.qrId);
      card.addEventListener('click', go);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  } else {
    // Tri des colonnes
    content.querySelectorAll('th[data-sort]').forEach(thEl => thEl.addEventListener('click', () => {
      const key = thEl.dataset.sort;
      if (_libSort.key === key) _libSort.dir = _libSort.dir === 'asc' ? 'desc' : 'asc';
      else _libSort = { key, dir: key === 'scans' ? 'desc' : 'asc' };
      _renderLibrary(panel);
    }));
    // Ligne cliquable -> détail (hors case + menu)
    content.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('input,button')) return;
      _selectFromLib(panel, tr.dataset.qrId);
    }));
    // Cases à cocher
    content.querySelectorAll('[data-check]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) _libSel.add(cb.dataset.check); else _libSel.delete(cb.dataset.check);
      _renderLibrary(panel);
    }));
    const all = content.querySelector('#sdqr-tbl-all');
    if (all) all.addEventListener('change', () => {
      if (all.checked) qrs.forEach(q => _libSel.add(q.id)); else _libSel.clear();
      _renderLibrary(panel);
    });
    // Actions groupées
    content.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => {
      const ids = [..._libSel];
      if (b.dataset.bulk === 'clear') { _libSel.clear(); _renderLibrary(panel); }
      else if (b.dataset.bulk === 'archive') { _libArchive(panel, ids, 'archived'); }
      else if (b.dataset.bulk === 'delete') {
        if (confirm(`Supprimer définitivement ${ids.length} QR ? Les scans historiques sont conservés.`)) _libDelete(panel, ids);
      }
    }));
  }

  // Ferme les menus ⋯ au clic extérieur (lié une seule fois).
  if (!_libMenuBound) {
    _libMenuBound = true;
    document.addEventListener('click', e => {
      if (!e.target.closest('.sdqr-qr-pop') && !e.target.closest('[data-menu]')) _libCloseMenu();
    }, true);
  }
}

// ══════════════════════════════════════════════════════════════════
// Vue d'ensemble « tous mes QR » (SDQR S1.3) — lecture seule, thème sombre
// Rend dans #sdqr-content depuis GET /api/qr/overview. Aucune écriture.
// ══════════════════════════════════════════════════════════════════
async function _openOverview(panel, period = '30d') {
  _selectedId = null;
  panel.querySelectorAll('.sdqr-tab').forEach(x => x.classList.remove('active'));
  panel.querySelector('#sdqr-overview-btn')?.classList.add('is-active');
  _renderList(panel);  // dé-sélectionne visuellement la liste
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;
  content.classList.remove('sdqr-content--create', 'sdqr-content--lib');   // vue d'ensemble = puits clair
  content.innerHTML = `<div style="padding:48px;text-align:center;color:#8a96ad;font-size:13px">Chargement de la vue d'ensemble…</div>`;
  try {
    const data = await _apiOverview(period);
    content.innerHTML = _renderOverviewHtml(data, period);
    content.querySelectorAll('[data-ovperiod]').forEach(b =>
      b.addEventListener('click', () => _openOverview(panel, b.dataset.ovperiod)));
  } catch (e) {
    console.error('[sdqr-overview]', e);
    content.innerHTML = `<div style="padding:48px;text-align:center;color:#e0667a;font-size:13px">Impossible de charger la vue d'ensemble. Réessaie dans un instant.</div>`;
  }
}

function _ovNum(n) { return Number(n || 0).toLocaleString('fr-FR'); }

function _ovChart(byDay) {
  const v = (byDay || []).map(r => r.cnt);
  if (!v.length) return `<div style="height:140px;display:flex;align-items:center;justify-content:center;color:#9aa6b8;font-size:12px">Pas encore de scans sur la période</div>`;
  const w = 600, h = 150, pad = 12, mx = Math.max(...v) || 1;
  let line = '', area = 'M0,' + h;
  v.forEach((val, i) => {
    const x = v.length > 1 ? (i / (v.length - 1) * w) : w / 2;
    const y = h - pad - (val / mx) * (h - 2 * pad);
    line += x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    area += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
  });
  area += ' L' + w + ',' + h + ' Z';
  return `<svg width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;height:140px"><defs><linearGradient id="sdqrOvG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c6cf5" stop-opacity="0.32"/><stop offset="1" stop-color="#6c6cf5" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#sdqrOvG)"/><polyline points="${line}" fill="none" stroke="#6c6cf5" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function _ovBars(items) {
  if (!items || !items.length) return `<div style="color:#9aa6b8;font-size:12px;padding:6px 0">Aucune donnée</div>`;
  const max = Math.max(...items.map(i => i.scans), 1);
  return items.map(i => `<div style="margin-bottom:11px"><div style="display:flex;justify-content:space-between;font-size:12.5px;color:#5a6b86;margin-bottom:5px"><span>${_esc(i.key)}</span><span style="color:#fff;font-weight:600">${_ovNum(i.scans)}</span></div><div style="height:7px;border-radius:4px;background:#e9ecf2"><div style="height:7px;border-radius:4px;width:${Math.round(i.scans / max * 100)}%;background:#6c6cf5"></div></div></div>`).join('');
}

function _ovLeader(lb) {
  if (!lb || !lb.length) return `<div style="color:#9aa6b8;font-size:12px;padding:6px 0">Aucun scan pour l'instant</div>`;
  const max = Math.max(...lb.map(i => i.scans), 1);
  const arrow = t => t === 'up' ? '▲' : (t === 'down' ? '▼' : '■');
  const acol  = t => t === 'up' ? '#2bbf80' : (t === 'down' ? '#e0667a' : '#8a96ad');
  return lb.map((i, idx) => `<div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-bottom:0.5px solid rgba(27,42,74,.07)"><span style="width:16px;font-size:13px;font-weight:700;color:${idx === 0 ? '#6c6cf5' : '#9aa6b8'}">${idx + 1}</span><div style="flex:1;min-width:0"><div style="font-size:12.5px;color:#1b2a4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px">${_esc(i.name)}</div><div style="height:6px;border-radius:3px;background:#e9ecf2"><div style="height:6px;border-radius:3px;width:${Math.round(i.scans / max * 100)}%;background:#6c6cf5"></div></div></div><span style="font-size:12.5px;font-weight:600;color:#fff;width:46px;text-align:right">${_ovNum(i.scans)}</span><span style="font-size:13px;color:${acol(i.trend)}">${arrow(i.trend)}</span></div>`).join('');
}

function _ovWatch(watch) {
  if (!watch || !watch.length) return `<div style="color:#9aa6b8;font-size:12px;padding:6px 0">Rien à signaler — tout va bien.</div>`;
  return watch.map(w => `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:0.5px solid rgba(27,42,74,.07)"><span style="width:8px;height:8px;border-radius:50%;margin-top:3px;background:${w.kind === 'warn' ? '#e0a23a' : '#6c6cf5'};flex:none"></span><div style="flex:1"><div style="font-size:12.5px;color:#1b2a4a">${_esc(w.name)}</div><div style="font-size:11px;color:#8a96ad;margin-top:1px">${_esc(w.note)}</div></div></div>`).join('');
}

function _renderOverviewHtml(d, period) {
  const t = d.totals || {};
  const pill = (p, lbl) => `<span data-ovperiod="${p}" style="font-size:11.5px;padding:6px 11px;cursor:pointer;border-radius:0;${p === period ? 'color:#fff;background:#6c6cf5' : 'color:#8a96ad'}">${lbl}</span>`;
  const delta = t.week_delta || 0;
  const deltaColor = delta > 0 ? '#2bbf80' : (delta < 0 ? '#e0667a' : '#8a96ad');
  const deltaTxt = (delta > 0 ? '+' : '') + delta + ' %';
  const kpi = (label, val, sub, extra = '') => `<div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.10);border-radius:12px;padding:14px 16px"><div style="font-size:10.5px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:7px">${label}</div><div style="display:flex;align-items:baseline;gap:8px"><div style="font-size:27px;font-weight:800;color:#1b2a4a;line-height:1">${val}</div>${extra}</div><div style="font-size:11px;color:#8a96ad;margin-top:5px">${sub}</div></div>`;
  return `
  <div style="background:#f5f7fa;border-radius:14px;padding:18px;font-family:inherit">
    <div style="display:flex;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
      <div>
        <div style="font-size:19px;font-weight:700;color:#1b2a4a;letter-spacing:-0.01em">Vue d'ensemble</div>
        <div style="font-size:12.5px;color:#8a96ad;margin-top:2px">Tous tes QR · données souveraines, aucune donnée tierce</div>
      </div>
      <div style="margin-left:auto;display:flex;background:#ffffff;border:0.5px solid rgba(27,42,74,.12);border-radius:9px;overflow:hidden">
        ${pill('7d', '7j')}${pill('30d', '30j')}${pill('90d', '90j')}${pill('all', 'Tout')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px;margin-bottom:13px">
      ${kpi('SCANS TOTAUX', _ovNum(t.scans_total), 'sur la période')}
      ${kpi('VISITEURS UNIQUES', _ovNum(t.unique), 'empreintes anonymes')}
      ${kpi('QR ACTIFS', _ovNum(t.qr_active) + `<span style="font-size:15px;color:#8a96ad;font-weight:600"> / ${_ovNum(t.qr_total)}</span>`, 'au total')}
      ${kpi('CETTE SEMAINE', _ovNum(t.week), 'vs semaine précédente', `<span style="font-size:11.5px;font-weight:700;color:${deltaColor}">${deltaTxt}</span>`)}
    </div>
    <div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.08);border-radius:14px;padding:15px 16px;margin-bottom:13px">
      <div style="font-size:11px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:10px">ÉVOLUTION DES SCANS · TOUS QR</div>
      ${_ovChart(d.byDay)}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:13px;margin-bottom:13px">
      <div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.08);border-radius:14px;padding:15px 16px">
        <div style="font-size:11px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:6px">CLASSEMENT DES QR</div>
        ${_ovLeader(d.leaderboard)}
      </div>
      <div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.08);border-radius:14px;padding:15px 16px">
        <div style="font-size:11px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:12px">SCANS PAR DOSSIER</div>
        ${_ovBars(d.byFolder)}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:13px">
      <div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.08);border-radius:14px;padding:15px 16px">
        <div style="font-size:11px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:12px">PAR TYPE</div>
        ${_ovBars((d.byType || []).map(x => ({ key: x.key, scans: x.scans })))}
      </div>
      <div style="background:#ffffff;border:0.5px solid rgba(27,42,74,.08);border-radius:14px;padding:15px 16px">
        <div style="font-size:11px;letter-spacing:0.06em;color:#8a96ad;margin-bottom:6px">À SURVEILLER</div>
        ${_ovWatch(d.watch)}
      </div>
    </div>
  </div>`;
}

function _wireShell(panel) {
  panel.querySelector('#sdqr-close-btn')?.addEventListener('click', closeSDQR);
  panel.querySelector('#sdqr-new-btn')?.addEventListener('click', () => _openCreateForm(panel));
  panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
  panel.querySelector('#sdqr-overview-btn')?.addEventListener('click', () => _openOverview(panel));
  panel.querySelectorAll('.sdqr-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      panel.querySelectorAll('.sdqr-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      _currentView = t.dataset.view;
      // Studio = accueil « Mes QR » : un clic sur l'onglet revient à la
      // bibliothèque (désélection du QR courant).
      if (_currentView === 'studio' && _selectedId) { _selectedId = null; _renderList(panel); }
      _renderCurrentView(panel);
    });
  });

  // Recherche : filtre live au keystroke (pas de debounce, la liste
  // est petite et le filter est O(n) trivial)
  const searchInput = panel.querySelector('#sdqr-search');
  searchInput?.addEventListener('input', e => {
    _filter.search = e.target.value.trim().toLowerCase();
    _renderList(panel);
  });

  // Pills filter status (Tous / Actifs / Archivés)
  panel.querySelectorAll('#sdqr-filter-status .sdqr-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter.status = btn.dataset.status;
      panel.querySelectorAll('#sdqr-filter-status .sdqr-filter-pill').forEach(b => b.classList.toggle('is-active', b === btn));
      _renderList(panel);
    });
  });

  // Cmd+K (ou Ctrl+K) → focus recherche, raccourci Apple-like
  if (!window._sdqrKeyboardBound) {
    window._sdqrKeyboardBound = true;
    window.addEventListener('keydown', e => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (!isCmdK) return;
      const fullscreen = document.getElementById('sdqr-fullscreen');
      if (!fullscreen?.classList.contains('open')) return;
      e.preventDefault();
      fullscreen.querySelector('#sdqr-search')?.focus();
    });
  }
}

// Affiche la vue Studio ou Stats selon _currentView, scopé au QR
// sélectionné dans la sidebar. Si aucun QR sélectionné, empty state.
function _renderCurrentView(panel) {
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;
  content.classList.remove('sdqr-content--create', 'sdqr-content--lib');   // quitte création / bibliothèque
  const qr = _selectedId ? _cachedQrs.find(q => q.id === _selectedId) : null;

  if (_currentView === 'stats') {
    if (!qr) {
      content.innerHTML = `
        <div class="sdqr-empty-state">
          <div class="sdqr-empty-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:56px;height:56px;opacity:.45"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <h2 class="sdqr-empty-title">Statistiques souveraines</h2>
          <p class="sdqr-empty-text">Sélectionne un QR dans la barre latérale pour voir ses scans, sa géographie, ses appareils.<br>Aucune donnée tierce — tout est aggrégé chez toi (RGPD natif).</p>
        </div>
      `;
      return;
    }
    _openQrStats(panel, qr);
    return;
  }

  // Vue Studio (par défaut) : bibliothèque « Mes QR » si des QR existent,
  // sinon écran d'accueil (onboarding du premier QR).
  if (!qr) {
    if (_cachedQrs.length > 0) { _renderLibrary(panel); return; }
    content.innerHTML = _renderEmptyStudio();
    panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
    return;
  }
  _openQrDetail(panel, qr);
}

// ══════════════════════════════════════════════════════════════════
// Sidebar — liste des QRs
// ══════════════════════════════════════════════════════════════════

// Filtre la liste en mémoire selon _filter (recherche + status + type).
// Recherche : insensible casse, matche nom + tags.
function _applyFilters(qrs) {
  return qrs.filter(q => {
    if (_filter.status !== 'all' && q.status !== _filter.status) return false;
    if (_filter.type   !== 'all' && q.qr_type !== _filter.type)  return false;
    if (_filter.folder !== 'all') {
      const fld = (q.folder || '').trim();
      if (_filter.folder === '__none__') { if (fld) return false; }
      else if (fld !== _filter.folder)   return false;
    }
    if (_filter.search) {
      const haystack = [
        q.name || '',
        ...(q.tags || []),
        q.qr_type || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(_filter.search)) return false;
    }
    return true;
  });
}

// Fetch + render (appelé après les mutations create/update/delete)
async function _refreshList(panel) {
  const listEl = panel.querySelector('#sdqr-list');
  if (!listEl) return;
  try {
    _cachedQrs = await _apiList();
  } catch (e) {
    listEl.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur : ${_esc(e.message)}</div>`;
    return;
  }
  _renderList(panel);
}

// Dérive et rend la barre de dossiers depuis _cachedQrs. Phase 1 (plats) :
// un dossier "existe" tant qu'au moins 1 QR le référence — pas de registre.
// "Tous" + un chip par dossier (compteur + ✎ renommer) + "Non classés".
// Pictogrammes dossiers — SVG outline monochrome (charte Keystone, style
// Lucide : fill:none + stroke:currentColor). Jamais d'emoji dans le studio.
const _ICO = {
  all:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
  none:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
};

function _renderFolders(panel) {
  const bar = panel.querySelector('#sdqr-folders');
  if (!bar) return;
  const counts = new Map();
  let unfiled = 0;
  for (const q of _cachedQrs) {
    const f = (q.folder || '').trim();
    if (f) counts.set(f, (counts.get(f) || 0) + 1);
    else unfiled++;
  }
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  if (names.length === 0) { bar.innerHTML = ''; return; }   // aucun dossier → barre masquée (:empty)

  const chip = (key, icon, label, count, extra = '') =>
    `<button class="sdqr-folder-chip ${_filter.folder === key ? 'is-active' : ''}" data-folder="${_esc(key)}">
       <span class="sdqr-folder-ico">${icon}</span>
       <span class="sdqr-folder-chip-lbl">${label}</span>
       <span class="sdqr-folder-chip-n">${count}</span>${extra}
     </button>`;

  let html = `<div class="sdqr-folder-bar-head">Dossiers</div><div class="sdqr-folder-chips">`;
  html += chip('all', _ICO.all, 'Tous', _cachedQrs.length);
  for (const n of names) {
    html += chip(n, _ICO.folder, _esc(n), counts.get(n),
      `<span class="sdqr-folder-rename" data-rename="${_esc(n)}" title="Renommer ce dossier">${_ICO.pencil}</span>`);
  }
  if (unfiled) html += chip('__none__', _ICO.none, 'Non classés', unfiled);
  bar.innerHTML = html + `</div>`;

  bar.querySelectorAll('.sdqr-folder-chip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.sdqr-folder-rename')) return;   // ✎ géré séparément
      _filter.folder = btn.dataset.folder;
      _renderList(panel);
    });
  });
  bar.querySelectorAll('.sdqr-folder-rename').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const oldName = el.dataset.rename;
      const next = (window.prompt(`Renommer le dossier « ${oldName} » en :`, oldName) || '').trim().slice(0, 80);
      if (!next || next === oldName) return;
      const targets = _cachedQrs.filter(q => (q.folder || '').trim() === oldName);
      try {
        for (const q of targets) { await _apiUpdate(q.id, { folder: next }); q.folder = next; }
        if (_filter.folder === oldName) _filter.folder = next;
        _renderList(panel);
      } catch (err) { window.alert('Renommage échoué : ' + err.message); }
    });
  });
}

// Render seul depuis _cachedQrs (appelé par les filter handlers — no fetch)
function _renderList(panel) {
  const listEl = panel.querySelector('#sdqr-list');
  if (!listEl) return;
  _renderFolders(panel);

  // Filtrage local (recherche + status)
  const filtered = _applyFilters(_cachedQrs);

  if (_cachedQrs.length === 0) {
    listEl.innerHTML = `<div class="sdqr-empty-mini">Aucun QR pour l'instant.</div>`;
    return;
  }
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="sdqr-empty-mini">Aucun résultat pour ce filtre.<br><button class="sdqr-empty-reset" id="sdqr-filter-reset">Réinitialiser</button></div>`;
    listEl.querySelector('#sdqr-filter-reset')?.addEventListener('click', () => {
      _filter = { search: '', status: 'all', type: 'all', folder: 'all' };
      const searchInput = panel.querySelector('#sdqr-search');
      if (searchInput) searchInput.value = '';
      panel.querySelectorAll('#sdqr-filter-status .sdqr-filter-pill').forEach(b => {
        b.classList.toggle('is-active', b.dataset.status === 'all');
      });
      _renderList(panel);
    });
    return;
  }
  listEl.innerHTML = filtered.map(q => {
    const tags = (q.tags || []).slice(0, 3).map(t => `<span class="sdqr-li-tag">${_esc(t)}</span>`).join('');
    const isSel = q.id === _selectedId;
    const isDyn = (q.mode || 'dynamic') === 'dynamic';
    const typeDef = QR_TYPES[q.qr_type] || QR_TYPES.url;
    return `
      <button class="sdqr-li ${isSel ? 'is-selected' : ''}" data-qr-id="${_esc(q.id)}">
        <div class="sdqr-li-hd">
          <span class="sdqr-li-name">${_esc(q.name || '(sans nom)')}</span>
          ${isDyn ? `<span class="sdqr-li-scans" title="Scans totaux">${q.scans_total || 0}</span>` : `<span class="sdqr-li-scans sdqr-li-scans--stat" title="QR statique — pas de tracking">∞</span>`}
        </div>
        <div class="sdqr-li-meta">
          <span class="sdqr-li-type">${typeDef.icon} ${_esc(typeDef.label)}</span>
          <span class="sdqr-li-mode ${isDyn ? 'sdqr-li-mode--dyn' : 'sdqr-li-mode--stat'}">${isDyn ? 'Dynamique' : 'Statique'}</span>
          ${q.template_id === 'concierge' ? '<span class="sdqr-li-concierge" title="QR Concierge VEFA">Concierge</span>' : ''}
          ${q.status === 'archived' ? '<span class="sdqr-li-status">Archivé</span>' : ''}
          ${q.folder ? `<span class="sdqr-li-folder">${_ICO.folder}${_esc(q.folder)}</span>` : ''}
        </div>
        ${tags ? `<div class="sdqr-li-tags">${tags}</div>` : ''}
      </button>
    `;
  }).join('');
  listEl.querySelectorAll('[data-qr-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedId = btn.dataset.qrId;
      _renderList(panel);   // re-render seul, no refetch
      // Dispatch selon la vue courante (Studio ou Stats)
      _renderCurrentView(panel);
    });
  });

  // Si la bibliothèque « Mes QR » est la vue active, la re-filtrer en miroir
  // de la sidebar (recherche / statut / dossier). _renderLibrary n'appelle PAS
  // _renderList -> pas de récursion.
  const _c = panel.querySelector('#sdqr-content');
  if (_c && _c.classList.contains('sdqr-content--lib') && !_selectedId) _renderLibrary(panel);
}

// ══════════════════════════════════════════════════════════════════
// Studio — formulaire création / détail QR
// ══════════════════════════════════════════════════════════════════

function _openCreateForm(panel, opts = {}) {
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;
  _selectedId = null;
  panel.querySelectorAll('.sdqr-li.is-selected').forEach(el => el.classList.remove('is-selected'));

  // Reset l'état de création à chaque ouverture
  // SDQR Smart : titre + message statiques saisis en direct (mode 'smart', plus d'IA)
  // SDQR Smart V2 2026-05-24 : template_id + template_data (registry programmable)
  _creating = {
    mode: 'dynamic', type: 'url', payload: {},
    name: '', tags: '', smart_title: '', smart_message: '',
    template_id: 'storytelling-brand', template_data: {},
    // Concierge VEFA (S7) — source du bloc (inline | vefa) + programme « à
    // plat » relayé par VEFA Studio (le Worker l'adapte au save).
    concierge_source: 'inline', concierge_payload: null,
    // Sprint C-b — sous-mode de la verticale générale (concierge_source ===
    // 'keyform') : 'direct' (je remplis le gabarit ici) | 'import' (depuis une
    // Fiche Key Form publiée). cg_import = { formId, title } une fois importé.
    cg_kf_mode: 'direct', cg_import: null,
    // Sprint B (cartes phares) — false = sélecteur de modèles ouvert (toutes
    // les cartes visibles) ; true = un modèle choisi (carte active seule +
    // lien « Changer de modèle »). Remis à false à chaque ouverture du form.
    _templatePicked: false,
  };

  // Concierge VEFA (S7) — auto-ouverture depuis le relai VEFA Studio :
  // bascule directement en concierge/smart, source « vefa », programme chargé,
  // nom interne pré-rempli. _renderModeToggle ci-dessous rendra l'aperçu.
  if (opts && opts.conciergeVefa && opts.conciergeVefa.program) {
    const prog = opts.conciergeVefa.program;
    _creating.mode              = 'smart';
    _creating.template_id       = 'concierge';
    _creating.concierge_source  = 'vefa';
    _creating.concierge_payload = prog;
    if (prog.nom) _creating.name = prog.nom;
    _creating._templatePicked   = true;   // arrive via CTA VEFA -> modèle déjà choisi
  } else if (opts && opts.presetConcierge) {
    // Deep-link depuis VEFA Studio (sans programme relayé) : ouverture directe
    // du formulaire sur Smart + Concierge, à la bonne verticale.
    _creating.mode             = 'smart';
    _creating.template_id      = 'concierge';
    _creating.concierge_source = opts.presetConcierge === 'general' ? 'keyform' : 'inline';
    _creating._templatePicked  = true;    // deep-link -> modèle déjà choisi
  } else if (opts && opts.presetUrl) {
    // Deep-link depuis le Smart Agent : QR dynamique vers l'URL publique de
    // l'agent. Mode dynamique + type URL = déjà les défauts ; on pose juste le
    // payload (lu par _renderFormFields -> _renderField) et le nom interne.
    _creating.mode    = 'dynamic';
    _creating.type    = 'url';
    _creating.payload = { url: opts.presetUrl };
    if (opts.presetName) _creating.name = opts.presetName;
  }

  content.innerHTML = `
    <div class="sdqr-form-wrap">
      <div class="sdqr-form-head">
        <h2 class="sdqr-form-title">Créer un QR code</h2>
        <p class="sdqr-form-sub">Choisissez ce qu'il doit faire — on s'occupe du reste.</p>
      </div>

      <!-- ÉTAPE 1 — Contenu (panneau blanc, cadre navy autour) -->
      <section class="sdqr-step">
      <header class="sdqr-step-hd">
        <span class="sdqr-step-num">1</span>
        <span class="sdqr-step-title">Contenu</span>
      </header>

      <!-- Mode toggle (Statique / Dynamique / Smart) -->
      <div class="sdqr-mode-toggle" id="sdqr-mode-toggle">
        <button class="sdqr-mode-btn" data-mode="static">
          <span class="sdqr-mode-dot"></span>
          <div class="sdqr-mode-txt">
            <strong>Standard</strong>
            <small>Données dans les pixels · offline · non modifiable</small>
          </div>
        </button>
        <button class="sdqr-mode-btn" data-mode="dynamic">
          <span class="sdqr-mode-dot"></span>
          <div class="sdqr-mode-txt">
            <strong>Dynamique</strong>
            <small>URL modifiable · stats trackées · nécessite connexion</small>
          </div>
        </button>
        <button class="sdqr-mode-btn" data-mode="smart">
          <span class="sdqr-mode-dot"></span>
          <div class="sdqr-mode-txt">
            <strong>Smart ✦</strong>
            <small>Interstitiel personnalisé · titre + message · dynamique +</small>
          </div>
        </button>
      </div>

      <!-- Sélecteur de template (visible uniquement si mode === 'smart') V2
           Volontairement PAS dans un <label> : les <button> à l'intérieur d'un
           label voient leur click parasité par le re-focus du label sur certains
           navigateurs (bug observé 24/05). Le titre est juste un <div> stylé. -->
      <div id="sdqr-smart-template-wrap" hidden style="margin:14px 0 0">
        <div class="sdqr-field sdqr-field--full">
          <div class="sdqr-field-lbl">Template d'interstitiel <small style="opacity:.7">— choisis le scénario d'expérience qui s'affiche au scan</small></div>
          <div class="sdqr-template-cards" id="sdqr-template-cards"></div>
        </div>
      </div>

      <!-- Titre + message statiques (visibles uniquement si mode === 'smart') -->
      <div id="sdqr-smart-text-wrap" hidden style="margin:14px 0 0">
        <label class="sdqr-field sdqr-field--full">
          <span class="sdqr-field-lbl">Titre <small style="opacity:.7">— le titre affiché sur la page d'attente au scan</small></span>
          <input id="sdqr-f-smart-title" class="sdqr-input" type="text" maxlength="80"
            placeholder="Ex : Bienvenue chez nous !" />
        </label>
        <label class="sdqr-field sdqr-field--full" style="margin-top:10px">
          <span class="sdqr-field-lbl">Message <small style="opacity:.7">— le texte affiché sous le titre</small></span>
          <textarea id="sdqr-f-smart-message" class="sdqr-input" rows="3" maxlength="400"
            placeholder="Ex : Merci de votre visite. Un instant, on vous redirige vers notre site."
            style="min-height:80px;font-family:inherit"></textarea>
        </label>
      </div>

      <!-- Champs spécifiques au template (rendus par master-renderer.renderField) V2 -->
      <div id="sdqr-smart-template-fields-wrap" hidden style="margin:14px 0 0">
        <div class="sdqr-form-grid" id="sdqr-smart-template-fields"></div>
      </div>

      <!-- Cartes de type — titre clarificateur (texte selon le mode, posé par
           _toggleSmartBriefVisibility). En smart, ces cartes = la destination
           APRÈS l'interstitiel (confusion levée le 2026-06-03). -->
      <div class="sdqr-type-heading" id="sdqr-type-heading"
           style="font-size:13px;font-weight:600;color:var(--text-secondary,#9aa4b2);margin:8px 0 8px"></div>
      <div class="sdqr-type-cards" id="sdqr-type-cards"></div>

      <!-- Form contextuel selon le type -->
      <div class="sdqr-form-grid" id="sdqr-form-fields"></div>
      </section>

      <!-- ÉTAPE 2 — Détails (panneau blanc) -->
      <section class="sdqr-step">
        <header class="sdqr-step-hd">
          <span class="sdqr-step-num">2</span>
          <span class="sdqr-step-title">Détails</span>
          <span class="sdqr-step-opt">repérage interne</span>
        </header>
        <div class="sdqr-form-grid">
          <label class="sdqr-field sdqr-field--full">
            <span class="sdqr-field-lbl">Nom interne <span class="sdqr-req">*</span></span>
            <input type="text" id="sdqr-f-name" class="sdqr-input" placeholder="ex: Bâche chantier Azur — Avancement">
          </label>
          <label class="sdqr-field sdqr-field--full">
            <span class="sdqr-field-lbl">Tags (séparés par virgule)</span>
            <input type="text" id="sdqr-f-tags" class="sdqr-input" placeholder="ex: chantier, azur, 2027">
          </label>
        </div>
      </section>

      <div class="sdqr-form-actions">
        <button class="sdqr-btn sdqr-btn--ghost" id="sdqr-cancel">Annuler</button>
        <button class="sdqr-btn sdqr-btn--primary" id="sdqr-save">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Créer le QR
        </button>
      </div>
      <div class="sdqr-form-msg" id="sdqr-msg" hidden></div>
    </div>
  `;

  // Puits NAVY + panneaux blancs (réalignement maquettes) — uniquement sur
  // l'écran de création ; retiré dès qu'on revient aux autres vues.
  content.classList.add('sdqr-content--create');

  _renderTypeCards(content);
  _renderModeToggle(content);
  _renderFormFields(content);

  // Bindings persistants (nom + tags + titre/message Smart)
  content.querySelector('#sdqr-f-name')?.addEventListener('input', e => { _creating.name = e.target.value; });
  content.querySelector('#sdqr-f-tags')?.addEventListener('input', e => { _creating.tags = e.target.value; });
  content.querySelector('#sdqr-f-smart-title')?.addEventListener('input', e => { _creating.smart_title = e.target.value; });
  content.querySelector('#sdqr-f-smart-message')?.addEventListener('input', e => { _creating.smart_message = e.target.value; });

  // Reflète un nom interne pré-rempli (auto-ouverture VEFA) dans le champ.
  const _nameEl = content.querySelector('#sdqr-f-name');
  if (_nameEl && _creating.name) _nameEl.value = _creating.name;

  content.querySelector('#sdqr-cancel')?.addEventListener('click', () => {
    // Annuler -> retour à la bibliothèque « Mes QR » (ou accueil si aucun QR).
    // _renderCurrentView purge la classe --create et choisit la bonne vue.
    _renderCurrentView(panel);
  });
  content.querySelector('#sdqr-save')?.addEventListener('click', () => _handleCreate(panel));
}

// SDQR S2 — types groupés en FAMILLES (accordéon) : un seul chapitre déplié.
// On ne montre que les familles ayant au moins un type présent dans QR_TYPES.
const _TYPE_FAMILIES = [
  { id: 'liens',    label: 'Liens',    types: ['url', 'text'],
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' },
  { id: 'contact',  label: 'Contact',  types: ['vcard', 'email', 'sms', 'whatsapp', 'tel'],
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
  { id: 'pratique', label: 'Pratique', types: ['wifi', 'geo', 'ical'],
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>' },
];
function _familyOfType(typeId) {
  const f = _TYPE_FAMILIES.find(fam => fam.types.includes(typeId));
  return f ? f.id : _TYPE_FAMILIES[0].id;
}

// Rend l'accordéon de familles + les cartes de type du chapitre actif.
// La carte active reflète _creating.type ; un type static-only force le mode static.
function _renderTypeCards(root) {
  const wrap = root.querySelector('#sdqr-type-cards');
  if (!wrap) return;
  if (!_creating.family) _creating.family = _familyOfType(_creating.type);
  const fams = _TYPE_FAMILIES.filter(f => f.types.some(t => QR_TYPES[t]));
  const active = fams.find(f => f.id === _creating.family) || fams[0];

  const pills = fams.map(f =>
    `<button class="sdqr-fam-pill ${f.id === active.id ? 'is-active' : ''}" data-fam="${f.id}"><span class="sdqr-fam-ico">${f.ico}</span>${f.label}</button>`
  ).join('');
  const cards = active.types.filter(t => QR_TYPES[t]).map(id => {
    const def = QR_TYPES[id];
    const isActive   = _creating.type === id;
    const staticOnly = !def.supports.dynamic;
    return `
      <button class="sdqr-type-card ${isActive ? 'is-active' : ''}" data-type="${id}">
        <span class="sdqr-type-ico">${def.icon}</span>
        <span class="sdqr-type-label">${def.label}</span>
        <span class="sdqr-type-desc">${def.desc}</span>
        ${staticOnly ? '<span class="sdqr-type-badge">Statique only</span>' : ''}
      </button>
    `;
  }).join('');
  wrap.innerHTML = `<div class="sdqr-fam-row">${pills}</div><div class="sdqr-type-cards-grid">${cards}</div>`;

  wrap.querySelectorAll('.sdqr-fam-pill').forEach(p => {
    p.addEventListener('click', () => { _creating.family = p.dataset.fam; _renderTypeCards(root); });
  });
  wrap.querySelectorAll('.sdqr-type-card').forEach(card => {
    card.addEventListener('click', () => {
      const newType = card.dataset.type;
      _creating.type = newType;
      _creating.payload = {};                       // reset payload (champs ≠)
      const def = QR_TYPES[newType];
      // Smart partage les contraintes de Dynamic → auto-bascule en static
      // si on choisit un type static-only (Wi-Fi).
      if (!def.supports.dynamic && (_creating.mode === 'dynamic' || _creating.mode === 'smart')) {
        _creating.mode = 'static';                  // auto-bascule
      }
      _renderTypeCards(root);
      _renderModeToggle(root);
      _renderFormFields(root);
    });
  });
}

function _renderModeToggle(root) {
  const wrap = root.querySelector('#sdqr-mode-toggle');
  if (!wrap) return;
  const def = QR_TYPES[_creating.type];
  // Smart partage les contraintes de Dynamic (besoin de short_id, donc
  // pas pour Wi-Fi qui est static-only).
  const dynDisabled = !def?.supports?.dynamic;
  wrap.querySelectorAll('.sdqr-mode-btn').forEach(btn => {
    const mode = btn.dataset.mode;
    btn.classList.toggle('is-active', _creating.mode === mode);
    if (mode === 'dynamic' || mode === 'smart') {
      btn.disabled = dynDisabled;
      btn.title    = dynDisabled ? `Le type ${def?.label} n'existe qu'en mode statique.` : '';
    }
    btn.onclick = () => {
      if (btn.disabled) return;
      _creating.mode = mode;
      _renderModeToggle(root);
      _toggleSmartBriefVisibility(root);
    };
  });
  // Premier render : aligne la visibilité des champs Smart avec le mode courant
  _toggleSmartBriefVisibility(root);
}

// SDQR Smart — Affiche les champs "Titre + Message" + V2 le sélecteur
// de template + ses fields uniquement en mode 'smart'.
function _toggleSmartBriefVisibility(root) {
  const isSmart = _creating.mode === 'smart';

  const textWrap     = root.querySelector('#sdqr-smart-text-wrap');
  const templateWrap = root.querySelector('#sdqr-smart-template-wrap');
  const fieldsWrap   = root.querySelector('#sdqr-smart-template-fields-wrap');

  if (textWrap)     textWrap.hidden     = !isSmart;
  if (templateWrap) templateWrap.hidden = !isSmart;
  if (fieldsWrap)   fieldsWrap.hidden   = !isSmart;

  // NB (2026-06-03) : on NE masque PAS les cartes de type (#sdqr-type-cards)
  // ni le formulaire statique (#sdqr-form-fields) en mode Smart : elles
  // définissent la DESTINATION du QR Smart (target_url / encoded_payload),
  // qui est REQUISE côté Worker (qr.js handleCreateQr). Les cacher casse la
  // création de QR Smart. (Un masquage tenté puis reverté ce jour.)

  // À la place : un titre clarificateur au-dessus des cartes, adapté au mode —
  // lève l'ambiguïté « ces cartes servent à quoi ? » sans rien cacher.
  const typeHeading = root.querySelector('#sdqr-type-heading');
  if (typeHeading) {
    typeHeading.textContent =
        isSmart                      ? "Destination après l'interstitiel — où le visiteur est envoyé après l'écran d'attente"
      : _creating.mode === 'dynamic' ? "Destination du QR — l'URL/le contenu vers lequel il pointe (modifiable)"
      :                                "Type de QR — le contenu encodé directement dans les pixels";
  }

  if (isSmart) {
    _renderTemplateCards(root);
    _renderTemplateFields(root);
  }
}

// SDQR Smart V2 — Rend les cards des templates disponibles (sélecteur).
// V4.1-design (2026-05-26) : cards enrichies — badge tier (Pro/Max),
// hierarchy visuelle Apple Premium, et mini-preview animée révélée
// uniquement quand la card est active (chaque template frontend peut
// déclarer une méthode `previewMini()` optionnelle qui retourne un
// fragment HTML auto-animé via CSS).
function _renderTemplateCards(root) {
  const wrap = root.querySelector('#sdqr-template-cards');
  if (!wrap) return;

  const tierLabels = { starter: 'Starter', pro: 'Pro', max: 'Max', admin: 'Admin' };
  const cgIcon     = getTemplateIconSvg('concierge') || '🛎️';
  const cgTier     = getTemplate('concierge').tier_required || 'pro';

  // Sprint B — 2 cartes phares Concierge SYNTHÉTIQUES (pleine largeur) en
  // tête : « général » (verticale generic, source keyform) PUIS « VEFA »
  // (verticale immo, source inline/vefa). Les deux partagent template_id
  // 'concierge' ; on les distingue par data-cg-vertical + concierge_source.
  // Suivent les autres templates (hors concierge) en grille normale.
  const cgGeneralActive = _creating.template_id === 'concierge' && _creating.concierge_source === 'keyform';
  const cgImmoActive    = _creating.template_id === 'concierge' && _creating.concierge_source !== 'keyform';

  const descriptors = [
    {
      templateId: 'concierge', cgVertical: 'general', featured: true,
      label: 'Concierge (général)',
      description: 'Tous métiers — accueil, offres, FAQ et chat qui répond depuis vos infos validées. 1 QR = 1 mini-site de réponses.',
      tier: cgTier, icon: cgIcon, isActive: cgGeneralActive, previewMini: null,
    },
    {
      templateId: 'concierge', cgVertical: 'immo', featured: true,
      label: 'Concierge immobilier (VEFA)',
      description: 'Promotion immobilière — programme, lots et configurations, FAQ et chat qui répond depuis un bloc validé. 1 QR = 1 programme complet.',
      tier: cgTier, icon: cgIcon, isActive: cgImmoActive, previewMini: null,
    },
    ...listTemplates().filter(t => t.id !== 'concierge').map(t => ({
      templateId: t.id, cgVertical: null, featured: false,
      label: t.label, description: t.description || '',
      tier: t.tier_required || 'starter',
      icon: getTemplateIconSvg(t.id) || t.icon || '✦',
      isActive: _creating.template_id === t.id,
      previewMini: typeof t.previewMini === 'function' ? t.previewMini : null,
    })),
  ];

  const cardHtml = (d) => {
    const tierLbl = tierLabels[d.tier] || 'Starter';
    const preview = (d.isActive && d.previewMini)
      ? `<div class="sdqr-template-preview" aria-hidden="true">${d.previewMini()}</div>`
      : '';
    const featCls = d.featured ? ' sdqr-template-card--featured' : '';
    const cgAttr  = d.cgVertical ? ` data-cg-vertical="${d.cgVertical}"` : '';
    return `
      <button type="button" class="sdqr-template-card${featCls} ${d.isActive ? 'is-active' : ''}" data-template-id="${_esc(d.templateId)}"${cgAttr}>
        <div class="sdqr-template-card-head">
          <span class="sdqr-template-ico">${d.icon}</span>
          <span class="sdqr-template-tier sdqr-template-tier--${d.tier}">${tierLbl}</span>
        </div>
        <span class="sdqr-template-label">${_esc(d.label)}</span>
        <span class="sdqr-template-desc">${_esc(d.description)}</span>
        ${preview}
      </button>
    `;
  };

  if (_creating._templatePicked) {
    // Modèle choisi : on épure l'écran — carte active SEULE (forcée pleine
    // largeur) + un lien « Changer de modèle » pour rouvrir le choix complet.
    const active = descriptors.find(d => d.isActive) || descriptors[0];
    wrap.innerHTML =
      '<button type="button" class="sdqr-template-change" data-template-change="1">&larr; Changer de modèle</button>'
      + cardHtml({ ...active, featured: true });
  } else {
    wrap.innerHTML = descriptors.map(cardHtml).join('');
  }

  wrap.querySelectorAll('.sdqr-template-card').forEach(card => {
    card.addEventListener('click', () => {
      const newId = card.dataset.templateId;
      if (!isKnownTemplate(newId)) return;
      const cgVertical = card.dataset.cgVertical || null;

      // Source concierge cible : général -> keyform ; immo -> inline, sauf si
      // on tient déjà un relai VEFA Studio (vefa) qu'on ne veut pas perdre.
      let nextSource = _creating.concierge_source;
      if (newId === 'concierge') {
        if (cgVertical === 'general') nextSource = 'keyform';
        else if (_creating.concierge_source === 'keyform') nextSource = 'inline';
      }

      // Carte déjà active (même template + même verticale) : on se contente de
      // replier le sélecteur, SANS réinitialiser les données déjà saisies.
      const sameTemplate = _creating.template_id === newId;
      const sameVertical = newId !== 'concierge' || nextSource === _creating.concierge_source;
      if (!(sameTemplate && sameVertical)) {
        _creating.template_id      = newId;
        _creating.template_data    = {};          // reset au vrai changement
        _creating.concierge_source = nextSource;
        _creating.cg_kf_mode       = 'direct';    // sous-mode général repart à neuf
        _creating.cg_import        = null;
      }
      _creating._templatePicked = true;
      _renderTemplateCards(root);
      _renderTemplateFields(root);
    });
  });

  const changeBtn = wrap.querySelector('[data-template-change]');
  if (changeBtn) changeBtn.addEventListener('click', () => {
    _creating._templatePicked = false;
    _renderTemplateCards(root);
    _renderTemplateFields(root);
  });
}

// SDQR Smart V2 — Rend les fields déclaratifs du template sélectionné.
// Utilise _renderField (le même que pour les champs de type QR) pour la
// cohérence visuelle. Le contrat fields[] est identique à QR_TYPES.fields.
// (Master Renderer plus avancé pourra être câblé en Phase 3.)
function _renderTemplateFields(root) {
  const wrap = root.querySelector('#sdqr-smart-template-fields');
  if (!wrap) return;
  // Sprint B — tant qu'aucun modèle n'est choisi (sélecteur ouvert), on
  // n'affiche pas l'éditeur : l'écran de choix reste épuré.
  if (!_creating._templatePicked) { wrap.innerHTML = ''; return; }
  // Concierge VEFA (Sprint 4) — bloc de connaissance NESTÉ (programme +
  // configurations répéteur + branding + faq…). Ne se mappe pas sur le
  // master-renderer plat : éditeur dédié. On court-circuite AVANT le
  // early-return fields.length===0 qui viderait le wrap.
  if (_creating.template_id === 'concierge') { _renderConciergeEditor(wrap); return; }
  const tpl = getTemplate(_creating.template_id);
  if (!tpl || !Array.isArray(tpl.fields) || tpl.fields.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  // V4.3 (2026-05-26) — Pré-remplir template_data avec les defaults des
  // fields qui n'ont pas encore de valeur. Sans ça, un checkbox avec
  // default:true reste à `undefined` côté backend tant que l'utilisateur
  // ne le clique pas — ce qui désactive silencieusement l'anti-rejouage
  // (vu 26/05 sur un_jeu_par_appareil des templates jeux).
  for (const f of tpl.fields) {
    if (_creating.template_data[f.id] === undefined && f.default !== undefined) {
      _creating.template_data[f.id] = f.default;
    }
  }
  wrap.innerHTML = tpl.fields.map(f => _renderField(f, _creating.template_data)).join('');
  // Bind change listeners (write to template_data, pas payload).
  // Exclut les hidden inputs des widgets image : leur valeur est écrite
  // directement par _bindImageWidgets après compression/clear/URL ; un
  // listener input/change sur du hidden ne se déclencherait pas et un
  // double-binding causerait des écrasements de data URI.
  wrap.querySelectorAll('[data-payload-key]:not(.sdqr-image-widget input[type="hidden"])').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.payloadKey;
      _creating.template_data[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    el.addEventListener('change', () => {
      const k = el.dataset.payloadKey;
      _creating.template_data[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
  });
  _bindImageWidgets(wrap, _creating.template_data);
  _bindColorWidgets(wrap);
  _bindLotsWidgets(wrap, _creating.template_data);
  _bindIconPickers(wrap);
}

// ══════════════════════════════════════════════════════════════════
// CONCIERGE VEFA — Éditeur nesté (Sprint 4)
// ───────────────────────────────────────────────────────────────────
// Le template concierge a fields:[] : son bloc de connaissance ne se
// mappe pas sur le master-renderer plat (programme{} + configurations[]
// + branding{} + faq[] + contact{}…). On construit ici un éditeur dédié
// qui écrit DIRECTEMENT dans _creating.template_data. La validation et
// l'envoi passent par le chemin standard (_handleCreate appelle déjà
// tpl.validate(template_data) + envoie body.template_data en mode smart).
//
// Scalaires : data-cg-path="programme.nom" + listener délégué _cgOnScalar.
// Répéteurs : configurations / questions / faq via binders dédiés (même
// modèle que _bindLotsWidgets). Couleurs : _bindColorWidgets (le hex
// porte data-cg-path). Logo : _bindImageWidgets (hidden data-payload-key
// "logo_url", store = branding).
// ══════════════════════════════════════════════════════════════════

function _cgSetPath(obj, path, val) {
  const keys = String(path).split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}

// Listener scalaire délégué (posé une seule fois sur le wrap). N'agit
// que sur les éléments porteurs de data-cg-path ; ignore tout le reste
// (notamment les inputs des répéteurs, gérés par leurs propres binders).
// SOURCE-AWARE (S7.5) : inline écrit dans le bloc canonique (template_data) ;
// le gabarit générique écrit dans la submission à plat (concierge_payload),
// que le Worker passe à keyformToBlock au save.
function _cgOnScalar(e) {
  const t = e.target;
  const path = t && t.dataset ? t.dataset.cgPath : '';
  if (!path) return;
  // 'vefa' édite l'habillage (agence.*) directement sur le programme relayé :
  // il écrit donc aussi dans concierge_payload (comme 'keyform').
  const store = (_creating.concierge_source === 'keyform' || _creating.concierge_source === 'vefa')
    ? _creating.concierge_payload
    : _creating.template_data;
  if (!store) return;
  _cgSetPath(store, path, t.type === 'checkbox' ? t.checked : t.value);
}

// Pose le listener scalaire délégué une seule fois sur le wrap (idempotent
// via le flag _cgScalarBound). Partagé par l'éditeur inline ET le gabarit
// générique — le wrap est le même nœud DOM à travers les switchs de source
// (seul innerHTML change), donc le flag persiste et on n'empile pas.
function _cgBindScalarListener(wrap) {
  if (wrap._cgScalarBound) return;
  wrap.addEventListener('input',  _cgOnScalar);
  wrap.addEventListener('change', _cgOnScalar);
  wrap._cgScalarBound = true;
}

// Seed le squelette de données la 1re fois (template_data est remis à {}
// à chaque sélection de template / ouverture du form). Valeurs sensées
// par défaut pour branding/persona/disclaimer ; programme + agence +
// contact restent vides (à remplir par l'utilisateur).
function _cgEnsureData() {
  const d = _creating.template_data;
  if (!d.programme || typeof d.programme !== 'object') d.programme = {};
  if (!d.branding  || typeof d.branding  !== 'object') {
    d.branding = { couleur_primaire: '#2563EB', couleur_secondaire: '#C9A96E', fond: 'clair' };
  }
  if (!Array.isArray(d.configurations) || d.configurations.length === 0) {
    d.configurations = [_cgBlankConfig()];
  }
  if (!Array.isArray(d.questions_suggerees)) {
    d.questions_suggerees = ['Quels modèles sont disponibles ?', 'Quelle date de livraison ?'];
  }
  if (!Array.isArray(d.faq_validee)) d.faq_validee = [];
  if (!d.contact_humain || typeof d.contact_humain !== 'object') d.contact_humain = {};
  if (d.disclaimer === undefined) {
    d.disclaimer = 'Pour toute information contractuelle, référez-vous à la notice descriptive et à votre conseiller.';
  }
  if (!d.persona || typeof d.persona !== 'object') {
    d.persona = { ton: 'professionnel et chaleureux', langue_par_defaut: 'fr' };
  }
}

function _cgBlankConfig() {
  return { reference: '', type: '', statut: 'disponible', surfaces_annexes: { garage: false }, prestations: [] };
}

// ── Petits constructeurs de champs scalaires (data-cg-path) ──────────
function _cgText(path, label, ph, value, opts) {
  opts = opts || {};
  const req  = opts.req ? ' <span class="sdqr-req">*</span>' : '';
  const ml   = opts.maxlength ? ` maxlength="${opts.maxlength}"` : '';
  const type = opts.type || 'text';
  return `<label class="sdqr-field sdqr-field--full">
    <span class="sdqr-field-lbl">${label}${req}</span>
    <input type="${type}" data-cg-path="${path}" class="sdqr-input" placeholder="${_esc(ph || '')}"${ml} value="${_esc(value ?? '')}">
  </label>`;
}
function _cgTextarea(path, label, ph, value, rows) {
  return `<label class="sdqr-field sdqr-field--full">
    <span class="sdqr-field-lbl">${label}</span>
    <textarea data-cg-path="${path}" class="sdqr-input sdqr-input--textarea" rows="${rows || 2}" placeholder="${_esc(ph || '')}">${_esc(value ?? '')}</textarea>
  </label>`;
}
function _cgColor(path, label, value, fallback) {
  const raw = value || fallback || '#000000';
  const initHex = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw) ? raw : (fallback || '#000000');
  return `<div class="sdqr-field sdqr-field--full">
    <span class="sdqr-field-lbl">${label}</span>
    <div class="sdqr-color-widget">
      <input type="color" class="sdqr-color-swatch" value="${_esc(_hex6(initHex))}" aria-label="Sélecteur visuel de couleur" tabindex="-1">
      <input type="text" data-cg-path="${path}" class="sdqr-input sdqr-color-hex" value="${_esc(value || '')}" placeholder="#RRGGBB" maxlength="7" spellcheck="false" autocapitalize="none" autocomplete="off">
    </div>
  </div>`;
}
function _cgLogoWidget(key, label, opts) {
  key   = key   || 'logo_url';
  label = label || "Logo de l'agence";
  opts  = opts  || {};
  const maxBytes = opts.maxBytes || 12000;
  const maxDim   = opts.maxDim   || 800;
  const kb       = Math.round(maxBytes / 1024);
  return `<div class="sdqr-field sdqr-field--full">
    <span class="sdqr-field-lbl">${label}</span>
    <div class="sdqr-image-widget" data-maxbytes="${maxBytes}" data-maxdim="${maxDim}">
      <input type="hidden" data-payload-key="${key}" value="">
      <div class="sdqr-image-preview${opts.wide ? ' sdqr-image-preview--wide' : ''}"><span class="sdqr-image-placeholder">Aucune image</span></div>
      <div class="sdqr-image-actions">
        <label class="sdqr-image-btn"><input type="file" accept="image/*" hidden class="sdqr-image-file"><span class="sdqr-image-btn-lbl">Choisir une image…</span></label>
        <button type="button" class="sdqr-image-btn sdqr-image-btn--ghost sdqr-image-clear" hidden>Effacer</button>
      </div>
      <details class="sdqr-image-url-fallback"><summary>ou utiliser une URL externe</summary><input type="url" class="sdqr-input sdqr-image-url" placeholder="https://…" value=""></details>
      <p class="sdqr-image-help">Compressée auto à ${kb} Ko (PNG/JPEG redimensionnés à ${maxDim}px max). SVG/GIF/WebP gardés tels quels s'ils sont assez légers.</p>
      <p class="sdqr-image-err" hidden></p>
    </div>
  </div>`;
}

const _CG_DEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ── Répéteur Configurations ──────────────────────────────────────────
function _cgConfigRowHtml(c) {
  c = c || {};
  const ann   = c.surfaces_annexes || {};
  const v     = (x) => _esc(x ?? '');
  const num   = (x) => (x === undefined || x === null || x === '') ? '' : _esc(x);
  const statut = ['disponible', 'optionne', 'vendu'].includes(c.statut) ? c.statut : 'disponible';
  const opt   = (val, lbl) => `<option value="${val}" ${statut === val ? 'selected' : ''}>${lbl}</option>`;
  const garage = (ann.garage === true || ann.garage === 'true') ? 'checked' : '';
  const prest = Array.isArray(c.prestations) ? c.prestations.join('\n') : '';
  return `<div class="sdqr-cg-config">
    <div class="sdqr-cg-config-h">
      <span class="sdqr-cg-config-n">Configuration</span>
      <button type="button" class="sdqr-cg-del sdqr-cg-config-del" title="Retirer cette configuration" aria-label="Retirer cette configuration">${_CG_DEL_SVG}</button>
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input cg-c-ref" maxlength="60" placeholder="Référence * (ex : Maison A)" value="${v(c.reference)}">
      <input type="text" class="sdqr-input cg-c-type" maxlength="24" placeholder="Type (ex : T3)" value="${v(c.type)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="number" class="sdqr-input cg-c-chambres" min="0" step="1" placeholder="Chambres" value="${num(c.nb_chambres)}">
      <select class="sdqr-input cg-c-statut">${opt('disponible', 'Disponible')}${opt('optionne', 'Optionné')}${opt('vendu', 'Vendu')}</select>
    </div>
    <div class="sdqr-cg-line">
      <input type="number" class="sdqr-input cg-c-surface" min="0" step="1" placeholder="Surface habitable (m²)" value="${num(c.surface_habitable_m2)}">
      <input type="number" class="sdqr-input cg-c-prix" min="0" step="1000" placeholder="Prix TTC (€)" value="${num(c.prix_ttc)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input cg-c-expo" maxlength="40" placeholder="Exposition (ex : Sud)" value="${v(c.exposition)}">
      <input type="number" class="sdqr-input cg-c-jardin" min="0" step="1" placeholder="Jardin (m²)" value="${num(ann.jardin_m2)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input cg-c-stationnement" maxlength="80" placeholder="Stationnement (ex : 1 garage + 1 place)" value="${v(c.stationnement)}">
      <label class="sdqr-checkbox-lbl"><input type="checkbox" class="cg-c-garage" ${garage}><span>Garage</span></label>
    </div>
    <textarea class="sdqr-input sdqr-input--textarea cg-c-prestations" rows="2" placeholder="Prestations (une par ligne)">${_esc(prest)}</textarea>
  </div>`;
}

function _cgReadConfig(row) {
  const q    = (sel) => row.querySelector(sel);
  const txt  = (sel) => (q(sel)?.value || '').trim();
  const numv = (sel) => { const x = (q(sel)?.value || '').trim(); return x === '' ? undefined : Number(x); };
  const prest = (q('.cg-c-prestations')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  return {
    reference:            txt('.cg-c-ref'),
    type:                 txt('.cg-c-type'),
    nb_chambres:          numv('.cg-c-chambres'),
    statut:               q('.cg-c-statut')?.value || 'disponible',
    surface_habitable_m2: numv('.cg-c-surface'),
    prix_ttc:             numv('.cg-c-prix'),
    exposition:           txt('.cg-c-expo'),
    stationnement:        txt('.cg-c-stationnement'),
    surfaces_annexes:     { jardin_m2: numv('.cg-c-jardin'), garage: !!q('.cg-c-garage')?.checked },
    prestations:          prest,
  };
}

function _cgUpdateConfigLabels(rowsEl) {
  [...rowsEl.querySelectorAll('.sdqr-cg-config')].forEach((row, i) => {
    const ref = (row.querySelector('.cg-c-ref')?.value || '').trim();
    const n   = row.querySelector('.sdqr-cg-config-n');
    if (n) n.textContent = 'Configuration ' + (i + 1) + (ref ? ' — ' + ref : '');
  });
}

function _cgBindConfigs(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-configs');
  const addBtn = wrap.querySelector('.sdqr-cg-add-config');
  if (!rowsEl) return;
  const sync = () => {
    _creating.template_data.configurations =
      [...rowsEl.querySelectorAll('.sdqr-cg-config')].map(_cgReadConfig);
    _cgUpdateConfigLabels(rowsEl);
  };
  rowsEl.addEventListener('input',  sync);
  rowsEl.addEventListener('change', sync);
  addBtn?.addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', _cgConfigRowHtml(_cgBlankConfig()));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.sdqr-cg-config-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-config');
    if (rows.length <= 1) {
      const row = del.closest('.sdqr-cg-config');
      row.querySelectorAll('input').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
      row.querySelectorAll('textarea').forEach(t => { t.value = ''; });
      row.querySelectorAll('select').forEach(s => { s.value = 'disponible'; });
    } else {
      del.closest('.sdqr-cg-config').remove();
    }
    sync();
  });
  sync();
}

// ── Répéteur Questions suggérées (cap 6) ─────────────────────────────
function _cgQuestionRowHtml(q) {
  return `<div class="sdqr-cg-line sdqr-cg-q">
    <input type="text" class="sdqr-input cg-q-text" maxlength="120" placeholder="Question suggérée (ex : Quels modèles sont disponibles ?)" value="${_esc(q || '')}">
    <button type="button" class="sdqr-cg-del sdqr-cg-q-del" title="Retirer cette question" aria-label="Retirer cette question">${_CG_DEL_SVG}</button>
  </div>`;
}
function _cgBindQuestions(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-questions');
  const addBtn = wrap.querySelector('.sdqr-cg-add-question');
  if (!rowsEl) return;
  const CAP = 6;
  const sync = () => {
    _creating.template_data.questions_suggerees =
      [...rowsEl.querySelectorAll('.cg-q-text')].map(i => i.value.trim()).filter(Boolean).slice(0, CAP);
    if (addBtn) addBtn.style.display = rowsEl.querySelectorAll('.sdqr-cg-q').length >= CAP ? 'none' : '';
  };
  rowsEl.addEventListener('input', sync);
  addBtn?.addEventListener('click', () => {
    if (rowsEl.querySelectorAll('.sdqr-cg-q').length >= CAP) return;
    rowsEl.insertAdjacentHTML('beforeend', _cgQuestionRowHtml(''));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.sdqr-cg-q-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-q');
    if (rows.length <= 1) del.closest('.sdqr-cg-q').querySelector('input').value = '';
    else del.closest('.sdqr-cg-q').remove();
    sync();
  });
  sync();
}

// ── Répéteur FAQ validée ({q, r}) ────────────────────────────────────
function _cgFaqRowHtml(item) {
  item = item || {};
  return `<div class="sdqr-cg-faq">
    <input type="text" class="sdqr-input cg-faq-q" maxlength="160" placeholder="Question (ex : Quels sont les frais de notaire ?)" value="${_esc(item.q || '')}">
    <textarea class="sdqr-input sdqr-input--textarea cg-faq-r" rows="2" placeholder="Réponse validée">${_esc(item.r || '')}</textarea>
    <button type="button" class="sdqr-cg-del sdqr-cg-faq-del cg-faq-del" title="Retirer" aria-label="Retirer cette question/réponse">${_CG_DEL_SVG}</button>
  </div>`;
}
function _cgBindFaq(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-faqs');
  const addBtn = wrap.querySelector('.sdqr-cg-add-faq');
  if (!rowsEl) return;
  const sync = () => {
    _creating.template_data.faq_validee =
      [...rowsEl.querySelectorAll('.sdqr-cg-faq')].map(row => ({
        q: (row.querySelector('.cg-faq-q')?.value || '').trim(),
        r: (row.querySelector('.cg-faq-r')?.value || '').trim(),
      })).filter(x => x.q);
  };
  rowsEl.addEventListener('input', sync);
  addBtn?.addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', _cgFaqRowHtml({}));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.cg-faq-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-faq');
    if (rows.length <= 1) del.closest('.sdqr-cg-faq').querySelectorAll('input, textarea').forEach(i => { i.value = ''; });
    else del.closest('.sdqr-cg-faq').remove();
    sync();
  });
  sync();
}

function _renderConciergeEditor(wrap) {
  // Sélecteur de source CONTEXTUEL (Sprint C-a) : la verticale est fixée par
  // la carte phare choisie au Sprint B (général -> keyform ; immo -> inline /
  // vefa). On ne propose donc QUE les sources de la verticale courante, et on
  // masque le picker s'il n'y a qu'une seule source (aucun choix utile).
  //   - immo    : Saisie directe (inline) + Depuis VEFA Studio (vefa)
  //   - général : Saisie directe générique (keyform) [+ Key Form publié au C-b]
  const src      = _creating.concierge_source;
  const source   = (src === 'vefa' || src === 'keyform') ? src : 'inline';
  const vertical = source === 'keyform' ? 'general' : 'immo';

  // Sélecteur de source COMPACT (polish 2026-05-31) : un toggle segmenté (et
  // non 2 grosses cartes -> moins « effrayant ») + une ligne d'aide pour
  // l'option active. Seul le contenu de l'option choisie s'affiche (dispatch
  // plus bas). Les data-attrs (data-cg-source / data-cg-kfmode) sont inchangés
  // -> binders existants (_cgBindSourcePicker / _cgBindKfModePicker) intacts.
  const segPicker = (opts, active, attr) => {
    const tabs = opts.map(o =>
      `<button type="button" class="sdqr-cg-seg-btn ${o.val === active ? 'is-active' : ''}" ${attr}="${o.val}">${_esc(o.strong)}</button>`
    ).join('');
    const cur = opts.find(o => o.val === active);
    return `
    <div class="sdqr-cg-srcwrap">
      <div class="sdqr-cg-seg" role="tablist" aria-label="Source des données du concierge">${tabs}</div>
      ${cur && cur.small ? `<p class="sdqr-cg-seg-hint">${_esc(cur.small)}</p>` : ''}
    </div>`;
  };

  let picker = '';
  if (vertical === 'immo') {
    picker = segPicker([
      { val: 'inline', strong: 'Saisie directe',    small: 'Programme immobilier, saisi ici.' },
      { val: 'vefa',   strong: 'Depuis VEFA Studio', small: "J'importe le programme préparé dans VEFA Studio." },
    ], source, 'data-cg-source');
  } else {
    const kfMode = _creating.cg_kf_mode === 'import' ? 'import' : 'direct';
    picker = segPicker([
      { val: 'direct', strong: 'Saisie directe',  small: 'Je remplis le gabarit générique ici.' },
      { val: 'import', strong: 'Key Form publié', small: "J'importe une Fiche établissement déjà remplie." },
    ], kfMode, 'data-cg-kfmode');
  }

  // Source « vefa » : aperçu en lecture seule du programme relayé. Le bloc
  // canonique est dérivé côté Worker (vefaProgramToBlock) à la publication ;
  // pour modifier les chiffres, on repasse par VEFA Studio.
  if (source === 'vefa') {
    // Garantit l'objet agence pour recevoir l'habillage édité.
    const pay = _creating.concierge_payload;
    if (pay && typeof pay === 'object' && !Array.isArray(pay)
        && (!pay.agence || typeof pay.agence !== 'object')) {
      pay.agence = {};
    }
    wrap.innerHTML = picker + _cgVefaPreviewHtml();
    _cgBindSourcePicker(wrap);
    // CG — habillage éditable directement sur le programme relayé : les lots
    // restent figés, mais logo/bannière/couleurs/nom sont modifiables ici.
    // Scalaires (nom + couleurs) → _cgOnScalar (concierge_payload) ; images →
    // _bindImageWidgets sur concierge_payload.agence (store plat key→valeur).
    if (pay && pay.agence) {
      _cgBindScalarListener(wrap);
      _bindColorWidgets(wrap);
      _bindImageWidgets(wrap, pay.agence);
    }
    return;
  }

  // Source « keyform » : verticale générale. Sous-mode « import » sans Fiche
  // encore chargée -> panneau de sélection d'une Fiche Key Form publiée.
  // Sinon (saisie directe, OU après import = pré-rempli) -> éditeur générique.
  // La submission à plat (concierge_payload, keyée KEYFORM_GABARIT_FIELDS) est
  // dérivée en bloc générique côté Worker (keyformToBlock) à la publication.
  if (source === 'keyform') {
    const kfMode = _creating.cg_kf_mode === 'import' ? 'import' : 'direct';
    if (kfMode === 'import' && !_creating.cg_import) {
      wrap.innerHTML = picker + _cgImportPanelHtml();
      _cgBindKfModePicker(wrap);
      _cgBindImportPanel(wrap);
      return;
    }
    _cgEnsureKeyform();
    const banner = _creating.cg_import
      ? `<div class="sdqr-cg-import-banner">Importé depuis « ${_esc(_creating.cg_import.title)} ». <button type="button" class="sdqr-cg-linklike" data-cg-reimport>Choisir un autre formulaire</button></div>`
      : '';
    wrap.innerHTML = picker + banner + _cgKeyformEditorHtml();
    _cgBindKfModePicker(wrap);
    _cgBindKeyform(wrap);
    _cgBindReimport(wrap);
    return;
  }

  _cgEnsureData();
  const d       = _creating.template_data;
  const prog    = d.programme;
  const b       = d.branding;
  const contact = d.contact_humain;
  const persona = d.persona;
  const cfgRows = (d.configurations.length ? d.configurations : [_cgBlankConfig()]).map(_cgConfigRowHtml).join('');
  const qRows   = (d.questions_suggerees.length ? d.questions_suggerees : ['']).map(_cgQuestionRowHtml).join('');
  const faqRows = (d.faq_validee.length ? d.faq_validee : [{}]).map(_cgFaqRowHtml).join('');

  wrap.innerHTML = picker + `
    <div class="sdqr-cg-editor">
      <p class="sdqr-cg-hint">Concierge VEFA — 1 QR = 1 programme complet. Les chiffres saisis ici sont la SEULE source de vérité : l'IA répond uniquement à partir de ce bloc, sans rien inventer.</p>

      <section class="sdqr-cg-section">
        <h4 class="sdqr-cg-section-h">Programme</h4>
        ${_cgText('programme.nom', 'Nom du programme', "Ex : Les Terrasses d'Ollioules", prog.nom, { req: true, maxlength: 120 })}
        ${_cgText('programme.promoteur', 'Promoteur', 'Ex : Sud Habitat', prog.promoteur, { maxlength: 120 })}
        ${_cgText('programme.ville', 'Ville', 'Ex : Ollioules', prog.ville, { maxlength: 80 })}
        ${_cgText('programme.livraison_prevue', 'Livraison prévue', 'Ex : 4e trimestre 2026', prog.livraison_prevue, { maxlength: 80 })}
      </section>

      <section class="sdqr-cg-section sdqr-cg-brand">
        <h4 class="sdqr-cg-section-h">Agence <small>— c'est l'agence qui signe la page (logo + couleurs)</small></h4>
        ${_cgText('branding.nom_agence', "Nom de l'agence", 'Ex : Agence Horizon', b.nom_agence, { req: true, maxlength: 80 })}
        ${_cgLogoWidget()}
        ${_cgLogoWidget('banner_url', 'Bannière — grand visuel en haut de page (façon couverture)', { maxBytes: 40000, maxDim: 1000, wide: true })}
        ${_cgColor('branding.couleur_primaire', 'Couleur principale', b.couleur_primaire, '#2563EB')}
        ${_cgColor('branding.couleur_secondaire', 'Couleur secondaire', b.couleur_secondaire, '#C9A96E')}
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-configs">
        <h4 class="sdqr-cg-section-h">Configurations <small>— les modèles du programme (au moins un)</small></h4>
        <div class="sdqr-cg-configs">${cfgRows}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-config">+ Ajouter une configuration</button>
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-questions">
        <h4 class="sdqr-cg-section-h">Questions suggérées <small>— les puces proposées au visiteur (max 6)</small></h4>
        <div class="sdqr-cg-questions">${qRows}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-question">+ Ajouter une question</button>
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-faq">
        <h4 class="sdqr-cg-section-h">FAQ validée <small>— réponses pré-approuvées que l'IA peut citer</small></h4>
        <div class="sdqr-cg-faqs">${faqRows}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-faq">+ Ajouter une question/réponse</button>
      </section>

      <section class="sdqr-cg-section">
        <h4 class="sdqr-cg-section-h">Conseiller <small>— vers qui renvoyer le visiteur</small></h4>
        ${_cgText('contact_humain.nom', 'Nom du conseiller', 'Ex : Camille Martin', contact.nom, { maxlength: 80 })}
        ${_cgText('contact_humain.tel', 'Téléphone', 'Ex : 04 94 00 00 00', contact.tel, { maxlength: 40, type: 'tel' })}
        ${_cgText('contact_humain.email', 'Email', 'Ex : contact@agence.fr', contact.email, { maxlength: 120, type: 'email' })}
      </section>

      <section class="sdqr-cg-section">
        <h4 class="sdqr-cg-section-h">Mention légale & ton</h4>
        ${_cgTextarea('disclaimer', 'Disclaimer permanent', 'Affiché en bas de page, toujours visible.', d.disclaimer, 2)}
        ${_cgText('persona.ton', "Ton de l'IA", 'Ex : professionnel et chaleureux', persona.ton, { maxlength: 80 })}
        ${_cgText('persona.langue_par_defaut', 'Langue par défaut', 'Ex : fr', persona.langue_par_defaut, { maxlength: 8 })}
      </section>
    </div>`;

  _cgBindSourcePicker(wrap);
  // Scalaires : un seul listener délégué sur le wrap (idempotent + lit
  // _creating.template_data en direct), posé une fois pour ne pas
  // s'empiler si on re-rend l'éditeur (switch de template puis retour).
  _cgBindScalarListener(wrap);
  _bindColorWidgets(wrap);
  _bindImageWidgets(wrap.querySelector('.sdqr-cg-brand') || wrap, b);
  _cgBindConfigs(wrap);
  _cgBindQuestions(wrap);
  _cgBindFaq(wrap);
}

// Aperçu lecture seule du programme relayé par VEFA Studio (source « vefa »).
// Vide => guide vers VEFA Studio. Les boutons du picker restent au-dessus.
function _cgVefaPreviewHtml() {
  const prog = _creating.concierge_payload;
  if (!prog || typeof prog !== 'object') {
    return `
      <div class="sdqr-cg-vefa-empty">
        <p class="sdqr-cg-vefa-empty-h">Aucun programme reçu de VEFA Studio</p>
        <p class="sdqr-cg-vefa-empty-p">Ouvrez VEFA Studio, remplissez l'onglet « Concierge IA » (programme, lots, agence), puis cliquez « Envoyer vers Concierge ». Le programme s'affichera ici, prêt à publier.</p>
      </div>`;
  }
  const lots    = Array.isArray(prog.lots) ? prog.lots : [];
  const withRef = lots.filter(l => l && String(l.reference || '').trim());
  const statuts = withRef.reduce((m, l) => {
    const s = l.statut || 'disponible'; m[s] = (m[s] || 0) + 1; return m;
  }, {});
  const statutChips = Object.entries(statuts)
    .map(([s, n]) => `<span class="sdqr-cg-vefa-chip">${n}&nbsp;${_esc(s)}</span>`).join('');
  const sampleRefs = withRef.slice(0, 6)
    .map(l => `<span class="sdqr-cg-vefa-ref">${_esc(l.reference)}</span>`).join('');
  const more = withRef.length > 6
    ? `<span class="sdqr-cg-vefa-ref sdqr-cg-vefa-ref--more">+${withRef.length - 6}</span>` : '';
  const row = (k, v) => `<div class="sdqr-cg-vefa-row"><span class="sdqr-cg-vefa-k">${k}</span><span class="sdqr-cg-vefa-v">${v}</span></div>`;
  const ag = (prog.agence && typeof prog.agence === 'object') ? prog.agence : {};
  return `
    <div class="sdqr-cg-vefa-card">
      ${row('Programme', _esc(prog.nom || '—'))}
      ${prog.promoteur ? row('Promoteur', _esc(prog.promoteur)) : ''}
      ${prog.ville ? row('Ville', _esc(prog.ville)) : ''}
      ${prog.livraison_prevue ? row('Livraison', _esc(prog.livraison_prevue)) : ''}
      ${row('Lots', `${withRef.length} avec référence${statutChips ? ' · ' + statutChips : ''}`)}
      ${sampleRefs ? `<div class="sdqr-cg-vefa-refs">${sampleRefs}${more}</div>` : ''}
      <p class="sdqr-cg-vefa-note">Lots et chiffres figés (source de vérité — pour les modifier, repassez par VEFA Studio). L'habillage ci-dessous est éditable ici.</p>
    </div>
    <section class="sdqr-cg-section sdqr-cg-brand">
      <h4 class="sdqr-cg-section-h">Habillage <small>— logo, bannière et couleurs (modifiable ici, sans repasser par VEFA Studio)</small></h4>
      ${_cgText('agence.nom', "Nom de l'agence", 'Ex : Prométhée Promotion', ag.nom, { maxlength: 80 })}
      ${_cgLogoWidget('logo_url', "Logo de l'agence")}
      ${_cgLogoWidget('banner_url', 'Bannière — grand visuel en haut de page (Hero)', { maxBytes: 40000, maxDim: 1000, wide: true })}
      ${_cgColor('agence.couleur_primaire', 'Couleur principale', ag.couleur_primaire, '#2563EB')}
      ${_cgColor('agence.couleur_secondaire', 'Couleur secondaire', ag.couleur_secondaire, '#C9A96E')}
    </section>`;
}

// ══════════════════════════════════════════════════════════════════
// S7.5 — Éditeur GABARIT GÉNÉRIQUE (source « keyform »)
// ───────────────────────────────────────────────────────────────────
// Saisie DIRECTE dans le studio SDQR (décision Option B 2026-05-30) — pas
// le builder Key Form, pas le formulaire Biennale live. On assemble une
// SUBMISSION à plat keyée par les ids FIGÉS de KEYFORM_GABARIT_FIELDS
// (cf. concierge-program.js : blankKeyform/coerceKeyform), stockée dans
// _creating.concierge_payload. Le Worker la passe à keyformToBlock au save.
// Scalaires : data-cg-path = clé plate (cg_nom_enseigne…) + listener délégué
// _cgOnScalar (source-aware). Répéteurs : items/faq/questions via binders
// dédiés. Logo : _bindImageWidgets (hidden data-payload-key "cg_logo",
// store = concierge_payload). Couleurs : _bindColorWidgets.
// ══════════════════════════════════════════════════════════════════

// Seed la submission générique la 1re fois qu'on bascule sur cette source
// (concierge_payload pouvait être null ou un programme VEFA). Non destructif
// si c'est déjà un gabarit (présence de cg_items) -> garde le brouillon.
function _cgEnsureKeyform() {
  const p = _creating.concierge_payload;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !('cg_items' in p)) {
    _creating.concierge_payload = blankKeyform();
  }
}

// ── Répéteur Offres (items) — 3 attributs libres label/valeur + prix + desc
function _cgKfItemRowHtml(it) {
  it = it || {};
  const v = (x) => _esc(x ?? '');
  return `<div class="sdqr-cg-config sdqr-cg-kfitem">
    <div class="sdqr-cg-config-h">
      <span class="sdqr-cg-config-n">Offre</span>
      <button type="button" class="sdqr-cg-del sdqr-cg-kfitem-del" title="Retirer cette offre" aria-label="Retirer cette offre">${_CG_DEL_SVG}</button>
    </div>
    <input type="text" class="sdqr-input kf-i-nom" maxlength="80" placeholder="Intitulé * (ex : Formule Découverte)" value="${v(it.item_nom)}">
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input kf-i-a1l" maxlength="40" placeholder="Attribut 1 — libellé (ex : Durée)" value="${v(it.item_attr1_label)}">
      <input type="text" class="sdqr-input kf-i-a1v" maxlength="60" placeholder="Valeur (ex : 1 h)" value="${v(it.item_attr1_value)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input kf-i-a2l" maxlength="40" placeholder="Attribut 2 — libellé" value="${v(it.item_attr2_label)}">
      <input type="text" class="sdqr-input kf-i-a2v" maxlength="60" placeholder="Valeur" value="${v(it.item_attr2_value)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input kf-i-a3l" maxlength="40" placeholder="Attribut 3 — libellé" value="${v(it.item_attr3_label)}">
      <input type="text" class="sdqr-input kf-i-a3v" maxlength="60" placeholder="Valeur" value="${v(it.item_attr3_value)}">
    </div>
    <div class="sdqr-cg-line">
      <input type="text" class="sdqr-input kf-i-prix" maxlength="60" placeholder="Prix / tarif — texte libre (ex : 6 € la partie) — vide = sur demande" value="${v(it.item_prix)}">
    </div>
    <textarea class="sdqr-input sdqr-input--textarea kf-i-desc" rows="2" placeholder="Description courte (optionnel)">${v(it.item_desc)}</textarea>
  </div>`;
}

function _cgReadKfItem(row) {
  const txt = (sel) => (row.querySelector(sel)?.value || '').trim();
  return {
    item_nom:         txt('.kf-i-nom'),
    item_attr1_label: txt('.kf-i-a1l'), item_attr1_value: txt('.kf-i-a1v'),
    item_attr2_label: txt('.kf-i-a2l'), item_attr2_value: txt('.kf-i-a2v'),
    item_attr3_label: txt('.kf-i-a3l'), item_attr3_value: txt('.kf-i-a3v'),
    item_prix:        txt('.kf-i-prix'),
    item_desc:        txt('.kf-i-desc'),
  };
}

function _cgUpdateKfItemLabels(rowsEl) {
  [...rowsEl.querySelectorAll('.sdqr-cg-kfitem')].forEach((row, i) => {
    const nom = (row.querySelector('.kf-i-nom')?.value || '').trim();
    const n   = row.querySelector('.sdqr-cg-config-n');
    if (n) n.textContent = 'Offre ' + (i + 1) + (nom ? ' — ' + nom : '');
  });
}

function _cgBindKfItems(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-kfitems');
  const addBtn = wrap.querySelector('.sdqr-cg-add-kfitem');
  if (!rowsEl) return;
  const sync = () => {
    _creating.concierge_payload.cg_items =
      [...rowsEl.querySelectorAll('.sdqr-cg-kfitem')].map(_cgReadKfItem);
    _cgUpdateKfItemLabels(rowsEl);
  };
  rowsEl.addEventListener('input',  sync);
  rowsEl.addEventListener('change', sync);
  addBtn?.addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', _cgKfItemRowHtml(blankKeyformItem()));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.sdqr-cg-kfitem-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-kfitem');
    if (rows.length <= 1) {
      const row = del.closest('.sdqr-cg-kfitem');
      row.querySelectorAll('input').forEach(i => { i.value = ''; });
      row.querySelectorAll('textarea').forEach(t => { t.value = ''; });
    } else {
      del.closest('.sdqr-cg-kfitem').remove();
    }
    sync();
  });
  sync();
}

// ── Répéteur Questions suggérées (cap 6) — strings cg_questions ──────
function _cgKfQuestionRowHtml(q) {
  return `<div class="sdqr-cg-line sdqr-cg-kfq">
    <input type="text" class="sdqr-input kf-q-text" maxlength="120" placeholder="Question suggérée (ex : Quelles sont vos offres ?)" value="${_esc(q || '')}">
    <button type="button" class="sdqr-cg-del sdqr-cg-kfq-del" title="Retirer cette question" aria-label="Retirer cette question">${_CG_DEL_SVG}</button>
  </div>`;
}
function _cgBindKfQuestions(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-kfquestions');
  const addBtn = wrap.querySelector('.sdqr-cg-add-kfquestion');
  if (!rowsEl) return;
  const CAP = 6;
  const sync = () => {
    _creating.concierge_payload.cg_questions =
      [...rowsEl.querySelectorAll('.kf-q-text')].map(i => i.value.trim()).filter(Boolean).slice(0, CAP);
    if (addBtn) addBtn.style.display = rowsEl.querySelectorAll('.sdqr-cg-kfq').length >= CAP ? 'none' : '';
  };
  rowsEl.addEventListener('input', sync);
  addBtn?.addEventListener('click', () => {
    if (rowsEl.querySelectorAll('.sdqr-cg-kfq').length >= CAP) return;
    rowsEl.insertAdjacentHTML('beforeend', _cgKfQuestionRowHtml(''));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.sdqr-cg-kfq-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-kfq');
    if (rows.length <= 1) del.closest('.sdqr-cg-kfq').querySelector('input').value = '';
    else del.closest('.sdqr-cg-kfq').remove();
    sync();
  });
  sync();
}

// ── Répéteur FAQ validée ({faq_q, faq_r}) ───────────────────────────
function _cgKfFaqRowHtml(item) {
  item = item || {};
  return `<div class="sdqr-cg-faq sdqr-cg-kffaq">
    <input type="text" class="sdqr-input kf-faq-q" maxlength="160" placeholder="Question (ex : Quels sont vos horaires ?)" value="${_esc(item.faq_q || '')}">
    <textarea class="sdqr-input sdqr-input--textarea kf-faq-r" rows="2" placeholder="Réponse validée">${_esc(item.faq_r || '')}</textarea>
    <button type="button" class="sdqr-cg-del sdqr-cg-faq-del sdqr-cg-kffaq-del" title="Retirer" aria-label="Retirer cette question/réponse">${_CG_DEL_SVG}</button>
  </div>`;
}
function _cgBindKfFaq(wrap) {
  const rowsEl = wrap.querySelector('.sdqr-cg-kffaqs');
  const addBtn = wrap.querySelector('.sdqr-cg-add-kffaq');
  if (!rowsEl) return;
  const sync = () => {
    _creating.concierge_payload.cg_faq =
      [...rowsEl.querySelectorAll('.sdqr-cg-kffaq')].map(row => ({
        faq_q: (row.querySelector('.kf-faq-q')?.value || '').trim(),
        faq_r: (row.querySelector('.kf-faq-r')?.value || '').trim(),
      })).filter(x => x.faq_q || x.faq_r);
  };
  rowsEl.addEventListener('input', sync);
  addBtn?.addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', _cgKfFaqRowHtml({}));
    sync();
  });
  rowsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.sdqr-cg-kffaq-del');
    if (!del) return;
    const rows = rowsEl.querySelectorAll('.sdqr-cg-kffaq');
    if (rows.length <= 1) del.closest('.sdqr-cg-kffaq').querySelectorAll('input, textarea').forEach(i => { i.value = ''; });
    else del.closest('.sdqr-cg-kffaq').remove();
    sync();
  });
  sync();
}

function _cgKeyformEditorHtml() {
  const s     = _creating.concierge_payload;
  const items = (Array.isArray(s.cg_items)     && s.cg_items.length     ? s.cg_items     : [blankKeyformItem()]).map(_cgKfItemRowHtml).join('');
  const faqs  = (Array.isArray(s.cg_faq)       && s.cg_faq.length       ? s.cg_faq       : [{}]).map(_cgKfFaqRowHtml).join('');
  const qs    = (Array.isArray(s.cg_questions) && s.cg_questions.length ? s.cg_questions : ['']).map(_cgKfQuestionRowHtml).join('');
  return `
    <div class="sdqr-cg-editor">
      <p class="sdqr-cg-hint">Gabarit générique — tous métiers. Les infos saisies ici sont la SEULE source de vérité : l'IA répond uniquement à partir de ce bloc, sans rien inventer.</p>

      <section class="sdqr-cg-section sdqr-cg-brand">
        <h4 class="sdqr-cg-section-h">Enseigne <small>— c'est elle qui signe la page (logo + couleurs)</small></h4>
        ${_cgText('cg_nom_enseigne', "Nom de l'enseigne", 'Ex : Studio Pilates Bandol', s.cg_nom_enseigne, { req: true, maxlength: 80 })}
        ${_cgText('cg_titre_offre', "Titre de l'offre", 'Ex : Nos abonnements', s.cg_titre_offre, { maxlength: 120 })}
        ${_cgText('cg_ville', 'Ville', 'Ex : Bandol', s.cg_ville, { maxlength: 80 })}
        ${_cgText('cg_adresse', 'Adresse', 'Ex : 12 avenue du Port, 83150 Bandol', s.cg_adresse, { maxlength: 160 })}
        ${_cgLogoWidget('cg_logo', "Logo de l'enseigne")}
        ${_cgLogoWidget('cg_banner', 'Bannière — grand visuel en haut de page (façon couverture)', { maxBytes: 40000, maxDim: 1000, wide: true })}
        ${_cgColor('cg_couleur_primaire', 'Couleur principale', s.cg_couleur_primaire, '#2563EB')}
        ${_cgColor('cg_couleur_secondaire', 'Couleur secondaire', s.cg_couleur_secondaire, '#C9A96E')}
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-configs">
        <h4 class="sdqr-cg-section-h">Offres <small>— vos prestations/produits (au moins une)</small></h4>
        <div class="sdqr-cg-kfitems">${items}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-kfitem">+ Ajouter une offre</button>
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-questions">
        <h4 class="sdqr-cg-section-h">Questions suggérées <small>— les puces proposées au visiteur (max 6)</small></h4>
        <div class="sdqr-cg-kfquestions">${qs}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-kfquestion">+ Ajouter une question</button>
      </section>

      <section class="sdqr-cg-section sdqr-cg-sec-faq">
        <h4 class="sdqr-cg-section-h">FAQ validée <small>— réponses pré-approuvées que l'IA peut citer</small></h4>
        <div class="sdqr-cg-kffaqs">${faqs}</div>
        <button type="button" class="sdqr-cg-add sdqr-cg-add-kffaq">+ Ajouter une question/réponse</button>
      </section>

      <section class="sdqr-cg-section">
        <h4 class="sdqr-cg-section-h">Contact <small>— vers qui renvoyer le visiteur</small></h4>
        ${_cgText('cg_contact_nom', 'Nom du contact', 'Ex : Camille Martin', s.cg_contact_nom, { maxlength: 80 })}
        ${_cgText('cg_contact_tel', 'Téléphone', 'Ex : 04 94 00 00 00', s.cg_contact_tel, { maxlength: 40, type: 'tel' })}
        ${_cgText('cg_contact_email', 'Email', 'Ex : contact@enseigne.fr', s.cg_contact_email, { maxlength: 120, type: 'email' })}
      </section>

      <section class="sdqr-cg-section">
        <h4 class="sdqr-cg-section-h">Mention légale</h4>
        ${_cgTextarea('cg_disclaimer', 'Disclaimer permanent', 'Affiché en bas de page, toujours visible.', s.cg_disclaimer, 2)}
      </section>
    </div>`;
}

function _cgBindKeyform(wrap) {
  _cgBindScalarListener(wrap);
  _bindColorWidgets(wrap);
  _bindImageWidgets(wrap.querySelector('.sdqr-cg-brand') || wrap, _creating.concierge_payload);
  _cgBindKfItems(wrap);
  _cgBindKfQuestions(wrap);
  _cgBindKfFaq(wrap);
}

// Branche les boutons du sélecteur de source. Switch vers « vefa » => relit
// le relai en direct (storage) dans _creating.concierge_payload + pré-remplit
// le nom interne si vide. Switch vers « keyform » => seed une submission
// générique vierge si besoin. Re-rend l'éditeur (innerHTML) ; le listener
// scalaire délégué persiste sur le wrap.
function _cgBindSourcePicker(wrap) {
  wrap.querySelectorAll('[data-cg-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      const raw = btn.dataset.cgSource;
      const src = (raw === 'vefa' || raw === 'keyform') ? raw : 'inline';
      if (src === _creating.concierge_source) return;
      _creating.concierge_source = src;
      if (src === 'vefa') {
        const relay = _readVefaRelay();
        _creating.concierge_payload = relay ? relay.program : null;
        const prog = _creating.concierge_payload;
        if (prog && prog.nom && !(_creating.name || '').trim()) {
          _creating.name = prog.nom;
          const nameEl = document.getElementById('sdqr-f-name');
          if (nameEl) nameEl.value = prog.nom;
        }
      } else if (src === 'keyform') {
        _cgEnsureKeyform();
      }
      _renderConciergeEditor(wrap);
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// Sprint C-b — Import « Key Form publié » -> Concierge generic.
// Le gabarit « Fiche établissement » (app/lib/concierge-keyform-gabarit.js)
// porte des ids de champ == KEYFORM_GABARIT_FIELDS : une RÉPONSE au form EST
// déjà une submission keyform. L'import récupère la dernière réponse d'une
// Fiche PUBLIÉE et pré-remplit l'éditeur générique (concierge_source reste
// 'keyform'). Lecture seule des endpoints pulsa -> aucun risque Biennale.
// ══════════════════════════════════════════════════════════════════

// Vrai si le form (objet brut de /api/pulsa/forms) est publié.
function _cgFormIsPublished(f) {
  return !!((f && f.output && f.output.status === 'published') || (f && f.published_at));
}

// Bouton du picker général -> bascule de sous-mode (direct | import).
function _cgBindKfModePicker(wrap) {
  wrap.querySelectorAll('[data-cg-kfmode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.cgKfmode === 'import' ? 'import' : 'direct';
      if (mode === (_creating.cg_kf_mode || 'direct')) return;
      _creating.cg_kf_mode = mode;
      if (mode === 'direct') _cgEnsureKeyform();   // garde le payload courant
      _renderConciergeEditor(wrap);
    });
  });
}

// Lien « Choisir un autre formulaire » du bandeau après import.
function _cgBindReimport(wrap) {
  wrap.querySelector('[data-cg-reimport]')?.addEventListener('click', () => {
    _creating.cg_import = null;                    // repasse au panneau de sélection
    _renderConciergeEditor(wrap);
  });
}

function _cgImportPanelHtml() {
  return `
    <div class="sdqr-cg-import">
      <p class="sdqr-cg-hint">Crée une « Fiche établissement » en 1 clic : tu obtiens un lien prêt à envoyer à ton client (ou à remplir toi-même). Déjà publiée, rien à configurer. Une fois remplie, elle apparaît ci-dessous et son contenu remplit le Concierge automatiquement.</p>
      <button type="button" class="sdqr-cg-add sdqr-cg-add--inline" data-cg-create-fiche>+ Créer ma Fiche établissement</button>
      <div class="sdqr-cg-fiche-link" data-cg-fiche-link hidden></div>
      <div class="sdqr-cg-import-list" data-cg-import-list>
        <p class="sdqr-cg-import-msg">Chargement de tes Fiches...</p>
      </div>
    </div>`;
}

function _cgBindImportPanel(wrap) {
  wrap.querySelector('[data-cg-create-fiche]')?.addEventListener('click', () => _cgCreateFicheGabarit(wrap));
  _cgLoadGabaritForms(wrap);
}

// Charge les Fiches publiées (gabarits Concierge) de l'utilisateur et les rend
// sélectionnables. Auth via le helper SDQR (_headers) déjà utilisé pour /api/qr.
async function _cgLoadGabaritForms(wrap) {
  const listEl = wrap.querySelector('[data-cg-import-list]');
  if (!listEl) return;
  try {
    const r = await fetch(`${CF_API}/api/pulsa/forms`, { headers: _headers() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body  = await r.json();
    const forms = Array.isArray(body.forms) ? body.forms : [];
    const gabarits = forms.filter(f => isConciergeGabarit(f) && _cgFormIsPublished(f));
    if (!gabarits.length) {
      listEl.innerHTML = `<p class="sdqr-cg-import-msg">Pas encore de Fiche remplie. Clique « Créer ma Fiche établissement » ci-dessus, partage le lien obtenu, fais-la remplir, puis reviens ici.</p>`;
      return;
    }
    listEl.innerHTML = gabarits.map(f => {
      const title = _esc((f.meta && f.meta.title) || 'Fiche établissement');
      const slug  = (f.meta && f.meta.slug) ? '/f/' + _esc(f.meta.slug) : 'publiée';
      return `<div class="sdqr-cg-import-row">
        <button type="button" class="sdqr-cg-import-item" data-cg-pick-form="${_esc(f.id)}">
          <strong>${title}</strong>
          <small>${slug}</small>
        </button>
        <button type="button" class="sdqr-cg-import-del" data-cg-del-form="${_esc(f.id)}" title="Supprimer cette Fiche" aria-label="Supprimer cette Fiche">&times;</button>
      </div>`;
    }).join('');
    listEl.querySelectorAll('[data-cg-pick-form]').forEach(btn => {
      const f = gabarits.find(g => g.id === btn.dataset.cgPickForm);
      btn.addEventListener('click', () => _cgImportFromForm(wrap, f));
    });
    listEl.querySelectorAll('[data-cg-del-form]').forEach(btn => {
      const f = gabarits.find(g => g.id === btn.dataset.cgDelForm);
      btn.addEventListener('click', () => _cgDeleteFiche(wrap, f));
    });
  } catch (e) {
    listEl.innerHTML = `<p class="sdqr-cg-import-msg">Impossible de charger tes formulaires (${_esc(e.message)}). Vérifie ta connexion et réessaie.</p>`;
  }
}

// Supprime une Fiche (DELETE /api/pulsa/forms/:id, auth _headers) — sert à
// repartir propre (effacer une vieille Fiche cassée/de test). Le lien public
// cesse de fonctionner. Confirmation obligatoire.
async function _cgDeleteFiche(wrap, form) {
  if (!form) return;
  const title = (form.meta && form.meta.title) || 'cette Fiche';
  if (!confirm(`Supprimer « ${title} » ? Son lien public ne fonctionnera plus.`)) return;
  try {
    const r = await fetch(`${CF_API}/api/pulsa/forms/${encodeURIComponent(form.id)}`, {
      method: 'DELETE', headers: _headers(),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || ('HTTP ' + r.status)); }
    // Efface la boîte « lien » (elle pointait peut-être sur la Fiche supprimée)
    // et, si on avait importé depuis elle, on annule l'import en cours.
    const box = wrap.querySelector('[data-cg-fiche-link]');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (_creating.cg_import && _creating.cg_import.formId === form.id) _creating.cg_import = null;
    _cgLoadGabaritForms(wrap);
  } catch (e) {
    alert('Suppression impossible : ' + e.message);
  }
}

// Récupère la DERNIÈRE réponse d'une Fiche -> coerce en submission keyform ->
// pré-remplit l'éditeur générique. La réponse est déjà keyée par cg_* (ids des
// champs du gabarit), donc coerceKeyform suffit (zéro mapping).
async function _cgImportFromForm(wrap, form) {
  if (!form) return;
  const listEl = wrap.querySelector('[data-cg-import-list]');
  const back = () => {
    if (!listEl) return;
    listEl.querySelector('[data-cg-back]')?.addEventListener('click', () => _cgLoadGabaritForms(wrap));
  };
  if (listEl) listEl.innerHTML = `<p class="sdqr-cg-import-msg">Import en cours...</p>`;
  try {
    const r = await fetch(`${CF_API}/api/pulsa/responses?form_id=${encodeURIComponent(form.id)}`, { headers: _headers() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body = await r.json();
    const responses = Array.isArray(body.responses) ? body.responses : [];
    if (!responses.length) {
      if (listEl) {
        listEl.innerHTML = `<p class="sdqr-cg-import-msg">Cette Fiche n'a pas encore de réponse. Partage son lien, fais-la remplir, puis reviens. <button type="button" class="sdqr-cg-linklike" data-cg-back>Retour à la liste</button></p>`;
        back();
      }
      return;
    }
    const latest = responses.reduce((a, b) => ((a && (a.created_at || '') >= (b.created_at || '')) ? a : b), responses[0]);
    let values = latest.responses;
    if (!values && typeof latest.response_json === 'string') { try { values = JSON.parse(latest.response_json); } catch { values = null; } }
    // Réponse PLATE du gabarit (cg_offre1_nom...) -> submission keyform
    // (cg_items[]...) -> forme éditeur. Assemblage déterministe, zéro mapping UI.
    _creating.concierge_payload = coerceKeyform(gabaritResponseToSubmission(values || {}));
    _creating.cg_import = { formId: form.id, title: (form.meta && form.meta.title) || 'Fiche établissement' };
    // Confort : pré-remplit le nom interne du QR si vide.
    const nom = _creating.concierge_payload.cg_nom_enseigne;
    if (nom && !(_creating.name || '').trim()) {
      _creating.name = nom;
      const el = document.getElementById('sdqr-f-name');
      if (el) el.value = nom;
    }
    _renderConciergeEditor(wrap);
  } catch (e) {
    if (listEl) {
      listEl.innerHTML = `<p class="sdqr-cg-import-msg">Import impossible (${_esc(e.message)}). <button type="button" class="sdqr-cg-linklike" data-cg-back>Retour à la liste</button></p>`;
      back();
    }
  }
}

// « Créer ma Fiche établissement » : crée + PUBLIE directement le gabarit figé
// via l'API (status='published', sans ouvrir l'éditeur Key Form -> la structure
// ne peut pas être cassée) et rend un lien public prêt à partager. Réutilise
// une Fiche déjà publiée si elle existe (évite les doublons). Auth = _headers.
async function _cgCreateFicheGabarit(wrap) {
  const btn  = wrap.querySelector('[data-cg-create-fiche]');
  const prev = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Création...'; }
  try {
    // 1) Réutilise une Fiche publiée existante (pas de doublon).
    let slug = null, reused = false;
    try {
      const lr = await fetch(`${CF_API}/api/pulsa/forms`, { headers: _headers() });
      if (lr.ok) {
        const lb = await lr.json();
        const ex = (Array.isArray(lb.forms) ? lb.forms : [])
          .find(f => isConciergeGabarit(f) && _cgFormIsPublished(f) && f.meta && f.meta.slug);
        if (ex) { slug = ex.meta.slug; reused = true; }
      }
    } catch { /* hors-ligne : on tentera la création */ }

    // 2) Sinon : crée + publie un nouveau gabarit figé (slug unique).
    if (!slug) {
      const form = buildConciergeFicheGabarit();
      form.meta.slug = 'fiche-etablissement-' + Math.random().toString(36).slice(2, 8);
      form.output = { status: 'published', published_url: null, last_response_at: null };
      const stored = saveForm(form);   // copie locale (visible dans Key Form)
      const res = await fetch(`${CF_API}/api/pulsa/forms`, {
        method: 'POST',
        headers: _headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ form: { ...stored, output: { status: 'published' } } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      slug = (data.form && data.form.slug) || form.meta.slug;
    }

    _cgShowFicheLink(wrap, `${location.origin}/f/${encodeURIComponent(slug)}`, reused);
    _cgLoadGabaritForms(wrap);   // la Fiche apparaît dans la liste
  } catch (e) {
    console.error('[sdqr] create fiche', e);
    alert('Création de la Fiche impossible : ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = prev; }
  }
}

// Boîte succès : lien public de la Fiche + Copier + Ouvrir.
function _cgShowFicheLink(wrap, url, reused) {
  const box = wrap.querySelector('[data-cg-fiche-link]');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <div class="sdqr-cg-fiche-link-head">${reused ? 'Tu as déjà une Fiche publiée' : 'Fiche créée et publiée'} — partage ce lien :</div>
    <div class="sdqr-cg-fiche-link-row">
      <input type="text" class="sdqr-input" readonly value="${_esc(url)}" data-cg-fiche-url>
      <button type="button" class="sdqr-cg-add" data-cg-copy-fiche>Copier</button>
      <a class="sdqr-cg-add sdqr-cg-fiche-open" href="${_esc(url)}" target="_blank" rel="noopener">Ouvrir</a>
    </div>
    <div class="sdqr-cg-import-msg">Envoie ce lien a ton client (ou ouvre-le pour le remplir toi-meme). Une fois rempli, clique ta Fiche dans la liste ci-dessous pour importer ses infos.</div>`;
  box.querySelector('[data-cg-copy-fiche]')?.addEventListener('click', () => {
    const inp = box.querySelector('[data-cg-fiche-url]');
    const txt = inp ? inp.value : url;
    const done = () => { const b = box.querySelector('[data-cg-copy-fiche]'); if (b) { b.textContent = 'Copié !'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => {});
    else if (inp) { inp.select(); try { document.execCommand('copy'); done(); } catch {} }
  });
}

// Rend les champs du form en fonction du type sélectionné.
// L'URL en mode dynamique = champ "URL de destination" (target_url).
// L'URL en mode statique = champ "URL" (encodée direct).
function _renderFormFields(root) {
  const wrap = root.querySelector('#sdqr-form-fields');
  if (!wrap) return;
  const def = QR_TYPES[_creating.type];
  if (!def) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = def.fields.map(f => _renderField(f)).join('');
  // Bind change listeners — exclut les hidden des widgets image (idem
  // raisonnement que _renderTemplateFields).
  wrap.querySelectorAll('[data-payload-key]:not(.sdqr-image-widget input[type="hidden"])').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.payloadKey;
      _creating.payload[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    el.addEventListener('change', () => {
      const k = el.dataset.payloadKey;
      _creating.payload[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
  });
  _bindImageWidgets(wrap, _creating.payload);
  _bindColorWidgets(wrap);
  _bindIconPickers(wrap);
  // Toggle password visibility (œil)
  wrap.querySelectorAll('.sdqr-pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.sdqr-pw-wrap')?.querySelector('input');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

// V4.1 (2026-05-26) — Compresse une image (File) en data URI base64 sous
// la limite maxBytes. PNG/JPEG redimensionnés via canvas + qualité dégradée
// itérativement. SVG/GIF/WebP retournés tels quels si déjà sous la limite.
// Lance une exception explicite si impossible.
async function _compressImageToDataUri(file, maxBytes = 12000, maxDimStart = 800) {
  const initial = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsDataURL(file);
  });
  const limitKb = Math.round(maxBytes / 1024);

  // SVG, GIF, WebP : non recompressibles (perdrait l'anim / le vectoriel).
  // On accepte si déjà sous la limite, sinon on refuse explicitement.
  if (/^data:image\/(svg\+xml|gif|webp)/i.test(initial)) {
    if (initial.length <= maxBytes) return initial;
    const kb = Math.round(initial.length / 1024);
    throw new Error(`Image trop lourde (${kb} Ko, max ${limitKb} Ko). Convertis-la en PNG/JPEG (compression auto) ou utilise une URL externe.`);
  }

  // PNG, JPEG : compression itérative via canvas
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload  = () => resolve(i);
    i.onerror = () => reject(new Error('Image illisible.'));
    i.src = initial;
  });

  let maxDim  = maxDimStart;
  let quality = 0.88;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width  * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= maxBytes) return out;
    maxDim  = Math.round(maxDim * 0.8);
    quality = Math.max(0.45, quality - 0.1);
  }
  throw new Error(`Image impossible à compresser sous ${limitKb} Ko. Essaie une image plus simple ou utilise une URL externe.`);
}

// V4.1 (2026-05-26) — Binde tous les widgets image présents dans `wrap`
// au store fourni (_creating.template_data ou _creating.payload). Doit
// être appelé après chaque render qui peut contenir des widgets image.
function _bindImageWidgets(wrap, store) {
  if (!wrap || !store) return;
  wrap.querySelectorAll('.sdqr-image-widget').forEach(widget => {
    const hidden  = widget.querySelector('input[type="hidden"][data-payload-key]');
    const fileIn  = widget.querySelector('.sdqr-image-file');
    const clearBt = widget.querySelector('.sdqr-image-clear');
    const urlIn   = widget.querySelector('.sdqr-image-url');
    const errP    = widget.querySelector('.sdqr-image-err');
    if (!hidden) return;
    const key = hidden.dataset.payloadKey;

    function setError(msg) {
      if (!errP) return;
      errP.textContent = msg || '';
      errP.hidden = !msg;
    }

    function setValue(newVal) {
      const v = newVal || '';
      hidden.value = v;
      store[key] = v;
      _updateImageWidgetPreview(widget, v);
    }

    fileIn?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setError('');
      try {
        if (!/^image\//.test(f.type)) {
          throw new Error('Le fichier sélectionné n\'est pas une image.');
        }
        const maxB = parseInt(widget.dataset.maxbytes, 10) || 12000;
        const maxD = parseInt(widget.dataset.maxdim, 10)   || 800;
        const compressed = await _compressImageToDataUri(f, maxB, maxD);
        setValue(compressed);
        // Reset URL field pour ne pas garder une URL périmée
        if (urlIn) urlIn.value = '';
      } catch (err) {
        setError(err.message || 'Erreur inattendue.');
      } finally {
        // Permet de re-sélectionner le même fichier après une erreur
        e.target.value = '';
      }
    });

    clearBt?.addEventListener('click', () => {
      setValue('');
      if (urlIn) urlIn.value = '';
      setError('');
    });

    urlIn?.addEventListener('input', () => {
      const u = urlIn.value.trim();
      if (u && !/^https?:\/\//i.test(u)) {
        setError('L\'URL doit commencer par http:// ou https://.');
        return;
      }
      setError('');
      setValue(u);
    });

    // Seed initial (edition d'un QR existant) : si le store porte deja une
    // image, on l'affiche dans l'apercu ; on remplit l'URL si c'est un lien.
    if (store[key] && !hidden.value) {
      setValue(store[key]);
      if (urlIn && /^https?:\/\//i.test(store[key])) urlIn.value = store[key];
    }
  });
}

// V4.1 — Met à jour le rendu visuel d'un widget image (preview + label
// bouton + visibilité bouton effacer) en fonction de la nouvelle valeur.
function _updateImageWidgetPreview(widget, val) {
  const preview = widget.querySelector('.sdqr-image-preview');
  const lblSpan = widget.querySelector('.sdqr-image-btn-lbl');
  const clearBt = widget.querySelector('.sdqr-image-clear');
  if (val) {
    if (preview) {
      preview.classList.add('has-image');
      const safeSrc = String(val).replace(/"/g, '&quot;');
      preview.innerHTML = `<img alt="" src="${safeSrc}">`;
    }
    if (lblSpan) lblSpan.textContent = 'Remplacer';
    if (clearBt) clearBt.hidden = false;
  } else {
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="sdqr-image-placeholder">Aucune image</span>';
    }
    if (lblSpan) lblSpan.textContent = 'Choisir une image…';
    if (clearBt) clearBt.hidden = true;
  }
}

// V4.6 — Étend un hex court (#rgb) ou sans dièse en #RRGGBB canonique.
function _hex6(v) {
  const s = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) return '#' + s.split('').map(c => c + c).join('');
  if (/^[0-9a-fA-F]{6}$/.test(s)) return '#' + s;
  return '#000000';
}

// V4.6 — Binde les widgets couleur : la pastille (picker natif) et le champ
// texte hexadécimal restent synchronisés. Le champ texte porte
// data-payload-key (source de vérité, lu par le listener générique). Au
// blur, la valeur est figée en #RRGGBB canonique pour que safeColor()
// l'accepte (sinon une saisie "c9a96e" sans dièse partirait en fallback).
function _bindColorWidgets(wrap) {
  if (!wrap) return;
  const HEX_RE = /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
  wrap.querySelectorAll('.sdqr-color-widget').forEach(widget => {
    const swatch = widget.querySelector('.sdqr-color-swatch');
    const hex    = widget.querySelector('.sdqr-color-hex');
    if (!swatch || !hex) return;

    swatch.addEventListener('input', () => {
      hex.value = swatch.value.toUpperCase();
      widget.classList.remove('is-invalid');
      hex.dispatchEvent(new Event('input', { bubbles: true }));
    });

    hex.addEventListener('input', () => {
      const v = hex.value.trim().replace(/^#/, '');
      if (HEX_RE.test(v)) {
        swatch.value = _hex6(v);
        widget.classList.remove('is-invalid');
      } else {
        widget.classList.toggle('is-invalid', !!hex.value.trim());
      }
    });

    hex.addEventListener('change', () => {
      const v = hex.value.trim().replace(/^#/, '');
      if (!HEX_RE.test(v)) return;
      hex.value    = _hex6(v).toUpperCase();
      swatch.value = _hex6(v);
      widget.classList.remove('is-invalid');
      hex.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

// V4.7 — Répéteur de lots (carte à gratter multi-lots). Une ligne = un lot
// { label, proba %, max gagnants }. Picto X outline (charte).
function _lotRowHtml(lot = {}) {
  const label = _esc(lot.label || '');
  const proba = (lot.proba === undefined || lot.proba === null || lot.proba === '' || Number(lot.proba) === 0) ? '' : _esc(lot.proba);
  const max   = (lot.max === undefined || lot.max === null || lot.max === '' || Number(lot.max) === 0) ? '' : _esc(lot.max);
  return `<div class="sdqr-lot-row">
    <input type="text" class="sdqr-input sdqr-lot-label" placeholder="Nom du lot (ex : Une partie offerte)" value="${label}">
    <div class="sdqr-lot-nums">
      <label class="sdqr-lot-num"><span>% de chance</span><input type="number" class="sdqr-input sdqr-lot-proba" min="1" max="100" step="1" placeholder="5" value="${proba}"></label>
      <label class="sdqr-lot-num"><span>max gagnants</span><input type="number" class="sdqr-input sdqr-lot-max" min="0" step="1" placeholder="∞" value="${max}"></label>
      <button type="button" class="sdqr-lot-del" title="Retirer ce lot" aria-label="Retirer ce lot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  </div>`;
}

function _bindLotsWidgets(wrap, store) {
  if (!wrap || !store) return;
  wrap.querySelectorAll('[data-lots-key]').forEach(field => {
    const key    = field.getAttribute('data-lots-key');
    const rowsEl = field.querySelector('.sdqr-lots-rows');
    const addBtn = field.querySelector('.sdqr-lots-add');
    const errP   = field.querySelector('.sdqr-lots-err');
    if (!rowsEl) return;

    const read = () => [...rowsEl.querySelectorAll('.sdqr-lot-row')].map(r => ({
      label: r.querySelector('.sdqr-lot-label')?.value.trim() || '',
      proba: Number(r.querySelector('.sdqr-lot-proba')?.value) || 0,
      max:   Number(r.querySelector('.sdqr-lot-max')?.value)   || 0,
    })).filter(l => l.label);

    const sync = () => {
      const arr = read();
      store[key] = arr;
      const sum = arr.reduce((s, l) => s + (Number(l.proba) || 0), 0);
      if (errP) {
        if (sum > 100) { errP.textContent = `Somme des % = ${sum} % (au-delà de 100). Réduis les chances.`; errP.hidden = false; }
        else errP.hidden = true;
      }
      if (addBtn) addBtn.style.display = rowsEl.querySelectorAll('.sdqr-lot-row').length >= 3 ? 'none' : '';
    };

    rowsEl.addEventListener('input', sync);
    addBtn?.addEventListener('click', () => {
      if (rowsEl.querySelectorAll('.sdqr-lot-row').length >= 3) return;
      rowsEl.insertAdjacentHTML('beforeend', _lotRowHtml({}));
      sync();
    });
    rowsEl.addEventListener('click', (e) => {
      const del = e.target.closest('.sdqr-lot-del');
      if (!del) return;
      const rows = rowsEl.querySelectorAll('.sdqr-lot-row');
      if (rows.length <= 1) {
        del.closest('.sdqr-lot-row').querySelectorAll('input').forEach(i => { i.value = ''; });
      } else {
        del.closest('.sdqr-lot-row').remove();
      }
      sync();
    });
    sync();   // initialise store[key] + état du bouton
  });
}

function _renderField(f, store) {
  // V2 : un 2e param `store` (object) permet de lire la valeur depuis un
  // autre bucket que _creating.payload (ex: _creating.template_data).
  // Rétrocompat : si absent, garde le comportement historique.
  const src  = store || _creating.payload;
  const span = f.span === 'full' ? ' sdqr-field--full' : '';
  const req  = f.required ? ' <span class="sdqr-req">*</span>' : '';
  const rawVal = src[f.id] ?? f.default ?? '';
  const val  = _esc(rawVal);
  const ph   = _esc(f.placeholder || '');

  let input = '';
  if (f.type === 'textarea') {
    input = `<textarea data-payload-key="${f.id}" class="sdqr-input sdqr-input--textarea" placeholder="${ph}">${val}</textarea>`;
  } else if (f.type === 'image') {
    // V4.1 (2026-05-26) — Widget upload local : convertit en data URI
    // base64 avec compression auto (12 KB max). Stocké dans un hidden
    // input avec data-payload-key qui marche pareil que les autres
    // fields. Bind interactif via _bindImageWidgets(wrap, store).
    const hasVal   = !!rawVal;
    const urlVal   = (typeof rawVal === 'string' && rawVal.startsWith('http')) ? val : '';
    const previewSrc = hasVal ? val : '';
    input = `<div class="sdqr-image-widget">
      <input type="hidden" data-payload-key="${f.id}" value="${previewSrc}">
      <div class="sdqr-image-preview${hasVal ? ' has-image' : ''}">
        ${hasVal ? `<img alt="" src="${previewSrc}">` : `<span class="sdqr-image-placeholder">Aucune image</span>`}
      </div>
      <div class="sdqr-image-actions">
        <label class="sdqr-image-btn">
          <input type="file" accept="image/*" hidden class="sdqr-image-file">
          <span class="sdqr-image-btn-lbl">${hasVal ? 'Remplacer' : 'Choisir une image…'}</span>
        </label>
        <button type="button" class="sdqr-image-btn sdqr-image-btn--ghost sdqr-image-clear" ${hasVal ? '' : 'hidden'}>Effacer</button>
      </div>
      <details class="sdqr-image-url-fallback">
        <summary>ou utiliser une URL externe</summary>
        <input type="url" class="sdqr-input sdqr-image-url" placeholder="https://…" value="${urlVal}">
      </details>
      <p class="sdqr-image-help">Compressée auto à 12 Ko (PNG/JPEG redimensionnés à 800px max). SVG/GIF/WebP gardés tels quels s'ils sont assez légers.</p>
      <p class="sdqr-image-err" hidden></p>
    </div>`;
    return `<div class="sdqr-field${span}">
      <span class="sdqr-field-lbl">${_esc(f.label)}${req}</span>
      ${input}
    </div>`;
  } else if (f.type === 'select') {
    // V4.4 (2026-05-26) : on supporte 2 formats d'options pour les select :
    //   - strings simples : ['Élégant', 'Dynamique'] (legacy storytelling-brand)
    //   - objets {value, label} : [{value:'encre', label:'Tampon encré ✓'}] (V4.4+)
    // Le label affiché reste descriptif tandis que la value reste machine.
    const opts = (f.options || []).map(o => {
      const value = (typeof o === 'object' && o) ? o.value : o;
      const label = (typeof o === 'object' && o) ? (o.label ?? o.value) : o;
      return `<option value="${_esc(value)}" ${value === val ? 'selected' : ''}>${_esc(label)}</option>`;
    }).join('');
    input = `<select data-payload-key="${f.id}" class="sdqr-input">${opts}</select>`;
  } else if (f.type === 'checkbox') {
    input = `<label class="sdqr-checkbox-lbl">
      <input type="checkbox" data-payload-key="${f.id}" ${val ? 'checked' : ''}>
      <span>${_esc(f.label)}</span>
    </label>`;
    return `<div class="sdqr-field${span}">${input}</div>`;
  } else if (f.type === 'password') {
    input = `<div class="sdqr-pw-wrap">
      <input type="password" data-payload-key="${f.id}" class="sdqr-input" placeholder="${ph}" value="${val}">
      <button type="button" class="sdqr-pw-toggle" aria-label="Afficher / masquer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>`;
  } else if (f.type === 'lots') {
    // V4.7 — Répéteur de lots (valeur = tableau) ; bind dédié _bindLotsWidgets.
    const arr  = (Array.isArray(rawVal) && rawVal.length) ? rawVal : [{}];
    const rows = arr.slice(0, 3).map(_lotRowHtml).join('');
    return `<div class="sdqr-field${span}" data-lots-key="${f.id}">
      <span class="sdqr-field-lbl">${_esc(f.label)}${req}</span>
      <div class="sdqr-lots">
        <div class="sdqr-lots-rows">${rows}</div>
        <button type="button" class="sdqr-lots-add">+ Ajouter un lot</button>
        <p class="sdqr-lots-hint">Chaque lot a son % de chance ; la somme = chance totale de gagner, le reste = perdu. « max gagnants » vide = illimité.</p>
        <p class="sdqr-lots-err" hidden></p>
      </div>
    </div>`;
  } else if (f.type === 'color') {
    // V4.6 — Widget couleur : pastille picker + saisie hexadécimale
    // (#RRGGBB) synchronisées. On retourne directement (comme le widget
    // image) pour ne pas envelopper deux inputs dans un <label>.
    const initHex = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(rawVal)
      ? String(rawVal) : (f.default || '#000000');
    return `<div class="sdqr-field${span}">
      <span class="sdqr-field-lbl">${_esc(f.label)}${req}</span>
      <div class="sdqr-color-widget">
        <input type="color" class="sdqr-color-swatch" value="${_esc(_hex6(initHex))}" aria-label="Sélecteur visuel de couleur" tabindex="-1">
        <input type="text" data-payload-key="${f.id}" class="sdqr-input sdqr-color-hex" value="${val}" placeholder="#RRGGBB" maxlength="7" spellcheck="false" autocapitalize="none" autocomplete="off">
      </div>
    </div>`;
  } else {
    input = `<input type="${f.type}" data-payload-key="${f.id}" class="sdqr-input" placeholder="${ph}" value="${val}">`;
  }

  // V4.5 (2026-05-26) — Bouton "Choisir un picto" qui ouvre la bibliothèque
  // d'emojis curés. Activable via field.allowIcons = true. L'emoji choisi
  // est inséré à la position du curseur (input/textarea). Le binding du
  // click est fait par _bindIconPickers(wrap) après _renderField.
  const pickerBtn = f.allowIcons
    ? `<button type="button" class="sdqr-icon-picker-btn"
              data-icon-picker-target="${f.id}"
              aria-label="Choisir un picto">🎨 Picto</button>`
    : '';

  return `
    <label class="sdqr-field${span}">
      <span class="sdqr-field-lbl">${_esc(f.label)}${req}</span>
      ${pickerBtn ? `<div class="sdqr-input-with-picker">${input}${pickerBtn}</div>` : input}
    </label>
  `;
}

// V4.5 — Bind les boutons "Choisir un picto" dans une zone donnée.
// Pour chaque bouton, click → ouvre la modale, l'emoji choisi est inséré
// au curseur du champ cible (data-icon-picker-target = id du field).
async function _bindIconPickers(wrap) {
  const btns = wrap?.querySelectorAll('.sdqr-icon-picker-btn[data-icon-picker-target]');
  if (!btns || !btns.length) return;
  const mod = await import('./sdqr-icon-picker.js');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-icon-picker-target');
      const target = wrap.querySelector(`[data-payload-key="${targetId}"]`);
      if (!target) return;
      mod.openIconPicker({
        onPick: (icon) => mod.insertIconAtCaret(target, icon),
        anchorLabel: 'Choisir un picto',
      });
    });
  });
}

async function _handleCreate(panel) {
  if (_busy) return;
  const msg = panel.querySelector('#sdqr-msg');
  const def = QR_TYPES[_creating.type];
  if (!def) return;

  // Validation : nom + tous les champs required du type sélectionné
  if (!_creating.name?.trim()) {
    return _showMsg(msg, 'Le nom interne est obligatoire.', 'err');
  }
  for (const f of def.fields) {
    if (f.required && !(_creating.payload[f.id] || '').toString().trim()) {
      return _showMsg(msg, `Champ obligatoire : ${f.label}`, 'err');
    }
  }

  // V2 — Validation des fields du template Smart (en plus du type QR)
  if (_creating.mode === 'smart') {
    // Concierge VEFA — source « vefa » : template_data est vide (le bloc est
    // dérivé côté Worker depuis le programme à plat). On valide donc le
    // PROGRAMME relayé (garde-fou léger ; validateBlock complet reste moteur)
    // et on saute la validation du bloc canonique inline (tpl.validate).
    if (_creating.template_id === 'concierge' && _creating.concierge_source === 'vefa') {
      const errs = validateProgramLight(_creating.concierge_payload);
      if (errs.length) return _showMsg(msg, errs[0], 'err');
    } else if (_creating.template_id === 'concierge' && _creating.concierge_source === 'keyform') {
      // Gabarit générique (S7.5) : template_data vide, le bloc générique est
      // dérivé côté Worker (keyformToBlock). On valide la submission à plat
      // (garde-fou léger ; validateBlock generic complet reste moteur).
      const errs = validateKeyformLight(_creating.concierge_payload);
      if (errs.length) return _showMsg(msg, errs[0], 'err');
    } else {
      const tpl = getTemplate(_creating.template_id);
      if (tpl?.fields?.length) {
        for (const f of tpl.fields) {
          if (f.required && !(_creating.template_data[f.id] || '').toString().trim()) {
            return _showMsg(msg, `Champ obligatoire (template) : ${f.label}`, 'err');
          }
        }
      }
      // Validation custom du template (peut renvoyer plusieurs erreurs)
      if (typeof tpl?.validate === 'function') {
        const errors = tpl.validate(_creating.template_data || {});
        if (Array.isArray(errors) && errors.length) {
          return _showMsg(msg, errors[0], 'err');
        }
      }
    }
  }

  const tags = (_creating.tags || '').split(',').map(s => s.trim()).filter(Boolean);

  _busy = true;
  const btn = panel.querySelector('#sdqr-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création…'; }

  try {
    const body = {
      name    : _creating.name.trim(),
      tags,
      type    : _creating.type,
      mode    : _creating.mode,
      payload : _creating.payload,
    };
    // SDQR Smart : titre + message statiques envoyés uniquement en mode smart
    if (_creating.mode === 'smart') {
      if (_creating.smart_title?.trim())   body.smart_title   = _creating.smart_title.trim();
      if (_creating.smart_message?.trim()) body.smart_message = _creating.smart_message.trim();
    }
    // SDQR Smart V2 : template_id + template_data envoyés en mode smart.
    // Fallback côté Worker = 'storytelling-brand' si absents.
    if (_creating.mode === 'smart') {
      body.template_id = _creating.template_id || 'storytelling-brand';
      // Concierge VEFA — source « vefa » : on n'envoie PAS template_data ;
      // le Worker dérive le bloc canonique depuis concierge_payload
      // (vefaProgramToBlock + validateBlock). Inline => bloc verbatim.
      if (_creating.template_id === 'concierge' && _creating.concierge_source === 'vefa') {
        body.concierge_source  = 'vefa';
        body.concierge_payload = _creating.concierge_payload || null;
      } else if (_creating.template_id === 'concierge' && _creating.concierge_source === 'keyform') {
        // Gabarit générique (S7.5) : on envoie la submission à plat ; le Worker
        // dérive le bloc générique (keyformToBlock + validateBlock). Pas de
        // template_data inline.
        body.concierge_source  = 'keyform';
        body.concierge_payload = _creating.concierge_payload || null;
      } else {
        body.template_data = _creating.template_data || {};
        if (_creating.template_id === 'concierge') body.concierge_source = 'inline';
      }
    }
    // Mode dynamique OU smart URL : target_url = la valeur du champ url
    // (smart utilise la même mécanique short_id que dynamic côté backend)
    const needsRedirect = (_creating.mode === 'dynamic' || _creating.mode === 'smart');
    if (needsRedirect && _creating.type === 'url') {
      body.target_url = _creating.payload.url || '';
    }
    // Mode dynamic/smart non-URL : pre-encode côté client (le Worker stocke
    // dans qr_redirects.encoded_payload pour servir le bon contenu au scan).
    if (needsRedirect && _creating.type !== 'url') {
      body.encoded_payload = encodePayload(_creating.type, _creating.payload);
    }
    const qr = await _apiCreate(body);
    _selectedId = qr.id;
    await _refreshList(panel);
    _openQrDetail(panel, qr);
  } catch (e) {
    _showMsg(msg, e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg> Créer le QR'; }
  } finally {
    _busy = false;
  }
}

// Variante de _renderField qui prend la valeur explicite (utilisée
// dans le detail editable, indépendamment de l état _creating).
function _renderEditPayloadField(f, currentValue) {
  const span = f.span === 'full' ? ' sdqr-field--full' : '';
  const req  = f.required ? ' <span class="sdqr-req">*</span>' : '';
  const val  = _esc(currentValue ?? f.default ?? '');
  const ph   = _esc(f.placeholder || '');

  let input = '';
  if (f.type === 'textarea') {
    input = `<textarea data-payload-key="${f.id}" class="sdqr-input sdqr-input--textarea" placeholder="${ph}">${val}</textarea>`;
  } else if (f.type === 'select') {
    // V4.4 (2026-05-26) : 2 formats d'options supportés — strings simples
    // (legacy) ou objets {value, label} (V4.4+ avec libellés descriptifs).
    const selVal = currentValue ?? f.default;
    const opts = (f.options || []).map(o => {
      const value = (typeof o === 'object' && o) ? o.value : o;
      const label = (typeof o === 'object' && o) ? (o.label ?? o.value) : o;
      return `<option value="${_esc(value)}" ${value === selVal ? 'selected' : ''}>${_esc(label)}</option>`;
    }).join('');
    input = `<select data-payload-key="${f.id}" class="sdqr-input">${opts}</select>`;
  } else if (f.type === 'checkbox') {
    return `<div class="sdqr-field${span}">
      <label class="sdqr-checkbox-lbl">
        <input type="checkbox" data-payload-key="${f.id}" ${currentValue ? 'checked' : ''}>
        <span>${_esc(f.label)}</span>
      </label>
    </div>`;
  } else if (f.type === 'password') {
    input = `<div class="sdqr-pw-wrap">
      <input type="password" data-payload-key="${f.id}" class="sdqr-input" placeholder="${ph}" value="${val}">
      <button type="button" class="sdqr-pw-toggle" aria-label="Afficher / masquer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>`;
  } else {
    input = `<input type="${f.type}" data-payload-key="${f.id}" class="sdqr-input" placeholder="${ph}" value="${val}">`;
  }

  return `
    <label class="sdqr-field${span}">
      <span class="sdqr-field-lbl">${_esc(f.label)}${req}</span>
      ${input}
    </label>
  `;
}

function _showMsg(msgEl, text, kind = 'ok') {
  if (!msgEl) return;
  msgEl.hidden = false;
  msgEl.textContent = text;
  msgEl.className = `sdqr-form-msg sdqr-form-msg--${kind}`;
}

async function _openQrDetail(panel, qr) {
  const content = panel.querySelector('#sdqr-content');
  if (!content || !qr) return;
  // Le détail vit sur le puits CLAIR : retire les classes de puits navy
  // (création / bibliothèque), quel que soit l'appelant (_handleCreate y
  // arrive sans passer par _renderCurrentView).
  content.classList.remove('sdqr-content--create', 'sdqr-content--lib');

  // Reset l'etat d edition du design quand on switche de QR.
  // _wireDesignPanel le ré-initialisera depuis qr.design lors du premier
  // wire ; les refresh DOM ultérieurs (upload logo) le preserveront.
  _editingDesign = null;

  const isDynamic    = (qr.mode || 'dynamic') === 'dynamic';
  const isSmart      = qr.mode === 'smart';
  const isRedirected = isDynamic || isSmart; // les 2 modes passent par /r/SHORTID
  const typeDef      = QR_TYPES[qr.qr_type] || QR_TYPES.url;
  const redirectUrl  = qr.short_id ? `${CF_API}/r/${qr.short_id}` : '';
  // Ce qui est encodé dans les pixels :
  //   - dynamic/smart URL → l'URL de redirect (le Worker dispatch ensuite)
  //   - static *          → le payload encodé (vcard, wifi, ical, text, url direct)
  const encodedForQr = isRedirected && qr.qr_type === 'url'
    ? redirectUrl
    : encodePayload(qr.qr_type, qr.payload || {});

  const summary = previewSummary(qr.qr_type, qr.payload || {});

  content.innerHTML = `
    <div class="sdqr-detail">
      <div class="sdqr-detail-left">
        <div class="sdqr-detail-card">
          <div class="sdqr-detail-svg" id="sdqr-svg-wrap">
            <div class="sdqr-empty-mini">Génération…</div>
          </div>
          <div class="sdqr-detail-shortid">
            <span class="sdqr-detail-shortid-lbl">${isRedirected ? 'URL de redirection' : 'Contenu encodé'}</span>
            <code class="sdqr-detail-shortid-val">${_esc(isRedirected ? redirectUrl : (encodedForQr.length > 200 ? encodedForQr.slice(0, 200) + '…' : encodedForQr))}</code>
            <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-copy-payload">Copier</button>
          </div>
          <!-- SDQR-3 : Export PNG / SVG haute résolution pour impression -->
          <div class="sdqr-export-row">
            <span class="sdqr-detail-shortid-lbl">Télécharger</span>
            <div class="sdqr-export-btns">
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="png-1024" title="Web, document A4">PNG 1024px</button>
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="png-2048" title="Impression standard, bâche moyenne">PNG 2048px</button>
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="svg" title="Vectoriel illimité — impression haut de gamme, bâche grand format">SVG</button>
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="pdf" title="PDF prêt à imprimer — A4, QR centré + légende">PDF</button>
            </div>
            <span class="sdqr-svg-hint" data-svg-hint hidden>SVG verrouillé — logo non vectoriel</span>
          </div>
          <div class="sdqr-detail-actions sdqr-detail-actions--incard">
            <button class="sdqr-btn sdqr-btn--ghost" id="sdqr-archive">${qr.status === 'archived' ? 'Réactiver' : 'Archiver'}</button>
            ${isRedirected ? `<a class="sdqr-btn sdqr-btn--ghost" href="${_esc(redirectUrl)}" target="_blank" rel="noopener noreferrer">Tester le scan ↗</a>` : ''}
            ${qr.status === 'archived' ? `<button class="sdqr-btn sdqr-btn--danger" id="sdqr-delete" title="Suppression définitive (les scans historiques sont conservés)">Supprimer définitivement</button>` : ''}
          </div>
        </div>
      </div>
      <div class="sdqr-detail-right">
        <label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">Nom interne</span>
          <input type="text" id="sdqr-edit-name" class="sdqr-input sdqr-input--title" value="${_esc(qr.name || '')}" placeholder="Nom interne…">
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-save-name" title="Renommer ce QR">Renommer</button>
        </label>

        ${(() => {
          const all = [...new Set(_cachedQrs.map(q => (q.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
          const cur = (qr.folder || '').trim();
          const opts = ['<option value="">— Aucun dossier —</option>']
            .concat(all.map(f => `<option value="${_esc(f)}" ${f === cur ? 'selected' : ''}>${_esc(f)}</option>`))
            .concat([`<option value="__new__">+ Nouveau dossier…</option>`])
            .join('');
          return `<label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">Dossier</span>
          <select id="sdqr-edit-folder" class="sdqr-input">${opts}</select>
        </label>`;
        })()}

        <div class="sdqr-detail-meta">
          <span class="sdqr-detail-pill">${typeDef.icon} ${_esc(typeDef.label)}</span>
          <span class="sdqr-detail-pill ${isSmart ? 'sdqr-detail-pill--smart' : (isDynamic ? 'sdqr-detail-pill--dyn' : 'sdqr-detail-pill--stat')}">${isSmart ? 'Smart ✦' : (isDynamic ? 'Dynamique' : 'Statique')}</span>
          <span class="sdqr-detail-pill ${qr.status === 'archived' ? 'sdqr-detail-pill--off' : ''}">${qr.status === 'archived' ? 'Archivé' : 'Actif'}</span>
          ${isRedirected ? `<span class="sdqr-detail-stat">${qr.scans_total || 0} scan(s)</span>` : ''}
        </div>

        ${summary ? `<div class="sdqr-detail-summary">${_esc(summary)}</div>` : ''}

        ${isSmart && (qr.template_id === 'machine-a-sous' || qr.template_id === 'carte-a-gratter') ? `
        <div class="sdqr-verify-block">
          <div class="sdqr-verify-block-head">🔒 Vérification client en caisse</div>
          <p class="sdqr-verify-block-desc">
            Donne cette URL à ton équipe en caisse. Quand un client présente un bon WIN-XXXX-XXXX,
            elle ouvre cette page, tape le code, et voit en 2 secondes si le code est authentique.
            Bookmark recommandé sur le téléphone du commerce.
          </p>
          <div class="sdqr-verify-url-row">
            <code class="sdqr-verify-url" id="sdqr-verify-url">${location.origin}/verify-win.html</code>
            <a class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-open-verify-url" href="${location.origin}/verify-win.html" target="_blank" rel="noopener" title="Ouvrir la page de vérification dans un nouvel onglet">↗ Ouvrir</a>
            <button type="button" class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-copy-verify-url" title="Copier l'URL dans le presse-papiers">📋 Copier</button>
          </div>
        </div>
        ` : ''}

        ${isRedirected && qr.qr_type === 'url' ? `
        <label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">URL de destination</span>
          <input type="url" id="sdqr-edit-url" class="sdqr-input" value="${_esc(qr.target_url || '')}">
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-save-url" title="Modifier la cible sans regénérer le QR">Mettre à jour</button>
        </label>
        <div class="sdqr-detail-notice">
          <strong>${isSmart ? 'Mode Smart ✦' : 'Édition dynamique'} :</strong> ${isSmart ? 'le QR affiche d\'abord une page d\'accueil personnalisée avant la redirection. Tu peux changer la cible à tout moment.' : 'tu peux changer la cible à tout moment. Le QR imprimé reste valable, la redirection bascule instantanément.'}
        </div>
        <div class="sdqr-convert-row">
          ${isSmart ? `
            <button type="button" class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-convert-dynamic">Transformer en redirection simple</button>
            <span class="sdqr-convert-hint">Coupe l'accueil${qr.template_id === 'concierge' ? ' du Concierge' : ' Smart'} : les visiteurs sont redirigés directement vers l'URL ci-dessus. Le QR imprimé reste valable — réversible à tout moment.</span>
          ` : (qr.template_id ? `
            <button type="button" class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-convert-smart">${qr.template_id === 'concierge' ? 'Repasser en Concierge' : `Réactiver l'accueil Smart`}</button>
            <span class="sdqr-convert-hint">Réaffiche la page d'accueil avant la redirection. Nécessite une licence active incluant ce mode.</span>
          ` : '')}
        </div>
        ` : isDynamic ? `
        <!-- Sprint SDQR-2.5 — édition du payload pour dynamic non-URL -->
        <div class="sdqr-edit-payload" id="sdqr-edit-payload-wrap">
          <div class="sdqr-edit-payload-head">
            <span class="sdqr-field-lbl">Contenu du QR (modifiable)</span>
            <button class="sdqr-btn sdqr-btn--primary sdqr-btn--xs" id="sdqr-save-payload">Mettre à jour le contenu</button>
          </div>
          <div class="sdqr-form-grid" id="sdqr-edit-payload-fields"></div>
        </div>
        <div class="sdqr-detail-notice">
          <strong>Édition dynamique :</strong> modifie le contenu à tout moment.
          Le QR imprimé reste valable — tous les scans serviront immédiatement la nouvelle version (${typeDef.label}).
        </div>
        ` : `
        <div class="sdqr-detail-notice sdqr-detail-notice--stat">
          <strong>Mode statique :</strong> les données sont encodées directement dans les pixels du QR.
          <span style="opacity:.7">Pas de tracking, pas de connexion requise, mais le contenu n'est plus modifiable après création.</span>
        </div>
        `}

        ${_renderDesignPanel(qr)}

        ${deliverEntryHtml()}

        <div class="sdqr-detail-msg" id="sdqr-detail-msg" hidden></div>
      </div>
    </div>
  `;

  // Render le QR SVG depuis le contenu encodé + le design custom (Sprint SDQR-3)
  try {
    const svg = await _renderQrSvg(encodedForQr, 280, qr.design);
    const wrap = content.querySelector('#sdqr-svg-wrap');
    if (wrap) wrap.innerHTML = svg;
  } catch (e) {
    const wrap = content.querySelector('#sdqr-svg-wrap');
    if (wrap) wrap.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur rendu QR : ${_esc(e.message)}</div>`;
  }

  // Wire le panneau Design (Sprint SDQR-3 — collapsible, live preview)
  _wireDesignPanel(content, qr, encodedForQr);

  // « Livrer à un client » (admin only — bouton totalement absent sinon).
  // Le transfert réassigne le tenant ; après succès, le QR quitte la liste.
  const _deliverRoot = content.querySelector('[data-deliver-root]');
  if (_deliverRoot) {
    wireDeliver(_deliverRoot, {
      type: 'qr',
      assetId: qr.id,
      assetName: qr.name || qr.short_id || qr.id,
      onDelivered: () => { _refreshList(panel); },
    });
  }

  // État initial du bouton « Export SVG » selon la nature du logo
  // (raster → désactivé). Sera ré-évalué à chaque _liveRerender.
  _updateSvgExportState(content, _editingDesign || qr.design);

  // Wire les boutons d'export (PNG 1024 / PNG 2048 / SVG vectoriel)
  content.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.export;
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳';
      try {
        // Utilise le design en cours d'édition s'il existe (preview live),
        // sinon le design sauvegardé. Permet d'exporter avant de Sauvegarder.
        const design = _editingDesign || qr.design;
        if (kind === 'svg') {
          await _exportQrSvg(qr, encodedForQr, design);
        } else if (kind === 'png-1024') {
          await _exportQrPng(qr, encodedForQr, design, 1024);
        } else if (kind === 'png-2048') {
          await _exportQrPng(qr, encodedForQr, design, 2048);
        } else if (kind === 'pdf') {
          await _exportQrPdf(qr, encodedForQr, design);
        }
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1200);
      } catch (e) {
        console.error('[sdqr-export]', e);
        btn.textContent = '✗';
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
      }
    });
  });

  // Copier (URL redirect OU payload encodé selon mode)
  content.querySelector('#sdqr-copy-payload')?.addEventListener('click', () => {
    navigator.clipboard.writeText(isRedirected ? redirectUrl : encodedForQr).then(() => {
      const b = content.querySelector('#sdqr-copy-payload');
      if (b) { b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); }
    });
  });

  // V4.3 UX (2026-05-26) — Copier l'URL de vérification caisse (templates
  // jeux uniquement, bouton conditionnellement rendu plus haut).
  content.querySelector('#sdqr-copy-verify-url')?.addEventListener('click', () => {
    const url = content.querySelector('#sdqr-verify-url')?.textContent || '';
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      const b = content.querySelector('#sdqr-copy-verify-url');
      if (b) { b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = '📋 Copier l\'URL'; }, 1800); }
    });
  });

  content.querySelector('#sdqr-save-url')?.addEventListener('click', async () => {
    const newUrl = content.querySelector('#sdqr-edit-url')?.value.trim();
    const msg = content.querySelector('#sdqr-detail-msg');
    if (!newUrl) return;
    try {
      // Sprint SDQR-3 fix : preserve le design en cours d'édition s'il
      // a ete modifie mais non sauvegarde. Sinon un update de target_url
      // re-render le detail et reset _editingDesign vers qr.design (stale).
      const patch = { target_url: newUrl };
      if (_designHasUnsavedChanges(_editingDesign, qr.design)) {
        patch.design = _editingDesign;
        qr.design = { ..._editingDesign };
      }
      await _apiUpdate(qr.id, patch);
      if (msg) { msg.hidden = false; msg.textContent = '✓ Cible mise à jour'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      qr.target_url = newUrl;
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Conversion Concierge/Smart → redirection simple (smart → dynamic).
  // Garde-fou : on confirme EXPLICITEMENT la destination (champ pré-rempli,
  // éditable) — jamais de réutilisation silencieuse d'une URL interne. Le QR
  // imprimé ne change pas (même short_id) ; les stats sont préservées.
  content.querySelector('#sdqr-convert-dynamic')?.addEventListener('click', async () => {
    const msg  = content.querySelector('#sdqr-detail-msg');
    const dest = (content.querySelector('#sdqr-edit-url')?.value || '').trim();
    if (!/^https?:\/\//i.test(dest)) {
      if (msg) { msg.hidden = false; msg.textContent = 'Renseigne d\'abord une URL de destination valide (http/https) dans le champ ci-dessus.'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
      return;
    }
    const accueil = qr.template_id === 'concierge' ? 'le Concierge' : 'l\'accueil Smart';
    if (!confirm(`Transformer ce QR en redirection simple ?\n\n• Les visiteurs seront redirigés directement vers :\n  ${dest}\n• ${accueil[0].toUpperCase() + accueil.slice(1)} ne s'affichera plus.\n• Le QR imprimé reste valable — aucune réimpression.\n• Réversible à tout moment.`)) return;
    try {
      await _apiUpdate(qr.id, { mode: 'dynamic', target_url: dest });
      await _refreshList(panel);
      const fresh = _cachedQrs.find(q => q.id === qr.id) || { ...qr, mode: 'dynamic', target_url: dest };
      _openQrDetail(panel, fresh);
      setTimeout(() => {
        const m = document.getElementById('sdqr-detail-msg');
        if (m) { m.hidden = false; m.textContent = '✓ QR transformé en redirection simple — le support imprimé reste valable'; m.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      }, 30);
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Retour redirection → Concierge/Smart (dynamic → smart). Le droit est
  // arbitré côté Worker (403 si la licence ne l'autorise pas) ; on relaie le
  // message tel quel. Visible uniquement si un template est préservé.
  content.querySelector('#sdqr-convert-smart')?.addEventListener('click', async () => {
    const msg   = content.querySelector('#sdqr-detail-msg');
    const label = qr.template_id === 'concierge' ? 'le Concierge' : 'l\'accueil Smart';
    if (!confirm(`Réactiver ${label} sur ce QR ?\n\n• Les visiteurs reverront la page d'accueil avant la redirection.\n• Le QR imprimé reste valable.\n• Réversible à tout moment.`)) return;
    try {
      await _apiUpdate(qr.id, { mode: 'smart' });
      await _refreshList(panel);
      const fresh = _cachedQrs.find(q => q.id === qr.id) || { ...qr, mode: 'smart' };
      _openQrDetail(panel, fresh);
      setTimeout(() => {
        const m = document.getElementById('sdqr-detail-msg');
        if (m) { m.hidden = false; m.textContent = qr.template_id === 'concierge' ? '✓ Concierge réactivé' : '✓ Accueil Smart réactivé'; m.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      }, 30);
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Sprint SDQR-2.5 — édition du payload pour QR dynamique non-URL.
  // Render les fields contextuels avec valeurs courantes + bind sur un
  // objet editingPayload local. Bouton "Mettre à jour" PATCH payload +
  // encoded_payload (recomputé client-side via sdqr-types.js).
  if (isDynamic && qr.qr_type !== 'url') {
    const fieldsWrap = content.querySelector('#sdqr-edit-payload-fields');
    if (fieldsWrap) {
      const editingPayload = { ...(qr.payload || {}) };
      fieldsWrap.innerHTML = typeDef.fields.map(f => _renderEditPayloadField(f, editingPayload[f.id])).join('');
      fieldsWrap.querySelectorAll('[data-payload-key]').forEach(el => {
        const handler = () => {
          const k = el.dataset.payloadKey;
          editingPayload[k] = el.type === 'checkbox' ? el.checked : el.value;
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      });
      fieldsWrap.querySelectorAll('.sdqr-pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = btn.closest('.sdqr-pw-wrap')?.querySelector('input');
          if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });
      });

      content.querySelector('#sdqr-save-payload')?.addEventListener('click', async () => {
        const msg = content.querySelector('#sdqr-detail-msg');
        const newEncoded = encodePayload(qr.qr_type, editingPayload);
        if (!newEncoded.trim()) {
          if (msg) { msg.hidden = false; msg.textContent = 'Le contenu est vide.'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
          return;
        }
        try {
          // Sprint SDQR-3 fix : preserve le design en cours d'edition
          // (sinon le re-render qui suit reset _editingDesign et l'user
          // perd ses choix forme/couleur/logo en cours).
          const patch = { payload: editingPayload, encoded_payload: newEncoded };
          if (_designHasUnsavedChanges(_editingDesign, qr.design)) {
            patch.design = _editingDesign;
            qr.design = { ..._editingDesign };
          }
          await _apiUpdate(qr.id, patch);
          qr.payload = { ...editingPayload };
          await _refreshList(panel);
          // Re-render le detail pour refresh le summary + le contenu encodé affiché
          _openQrDetail(panel, qr);
          // Toast inline post-rerender
          setTimeout(() => {
            const m = document.getElementById('sdqr-detail-msg');
            if (m) { m.hidden = false; m.textContent = '✓ Contenu mis à jour — tous les scans serviront la nouvelle version'; m.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
          }, 30);
        } catch (e) {
          if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
        }
      });
    }
  }

  content.querySelector('#sdqr-archive')?.addEventListener('click', async () => {
    const next = qr.status === 'archived' ? 'active' : 'archived';
    try {
      const patch = { status: next };
      if (_designHasUnsavedChanges(_editingDesign, qr.design)) {
        patch.design = _editingDesign;
        qr.design = { ..._editingDesign };
      }
      await _apiUpdate(qr.id, patch);
      await _refreshList(panel);
      _openQrDetail(panel, { ...qr, status: next });
    } catch (e) {
      const msg = content.querySelector('#sdqr-detail-msg');
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Renommer inline
  content.querySelector('#sdqr-save-name')?.addEventListener('click', async () => {
    const newName = content.querySelector('#sdqr-edit-name')?.value.trim();
    const msg = content.querySelector('#sdqr-detail-msg');
    if (!newName) {
      if (msg) { msg.hidden = false; msg.textContent = 'Le nom ne peut pas être vide.'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
      return;
    }
    try {
      const patch = { name: newName };
      if (_designHasUnsavedChanges(_editingDesign, qr.design)) {
        patch.design = _editingDesign;
        qr.design = { ..._editingDesign };
      }
      await _apiUpdate(qr.id, patch);
      qr.name = newName;
      if (msg) { msg.hidden = false; msg.textContent = '✓ Nom mis à jour'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      await _refreshList(panel);   // reflète le nouveau nom dans la sidebar
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Déplacer vers un dossier (auto-save au change). "+ Nouveau…" → prompt.
  content.querySelector('#sdqr-edit-folder')?.addEventListener('change', async (e) => {
    const sel = e.target;
    const msg = content.querySelector('#sdqr-detail-msg');
    const prev = (qr.folder || '');
    let folder = sel.value;
    if (folder === '__new__') {
      folder = (window.prompt('Nom du nouveau dossier :', '') || '').trim().slice(0, 80);
      if (!folder) { sel.value = prev; return; }
    }
    try {
      await _apiUpdate(qr.id, { folder: folder || null });
      qr.folder = folder;
      if (folder && !Array.from(sel.options).some(o => o.value === folder)) {
        const o = document.createElement('option'); o.value = folder; o.textContent = folder;
        sel.insertBefore(o, sel.querySelector('option[value="__new__"]'));
      }
      sel.value = folder || '';
      if (msg) { msg.hidden = false; msg.textContent = folder ? `✓ Rangé dans « ${folder} »` : '✓ Retiré du dossier'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      await _refreshList(panel);
    } catch (err) {
      sel.value = prev;
      if (msg) { msg.hidden = false; msg.textContent = err.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  // Supprimer définitivement (uniquement si archivé — verrou côté API aussi)
  content.querySelector('#sdqr-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement "${qr.name}" ?\n\n• Le QR ne pourra plus rediriger.\n• Les statistiques historiques (scans) sont conservées pour audit.\n• Cette action est irréversible.`)) return;
    const msg = content.querySelector('#sdqr-detail-msg');
    try {
      await _apiDelete(qr.id);
      _selectedId = null;
      await _refreshList(panel);
      // Retour à la bibliothèque « Mes QR » (ou accueil si plus aucun QR).
      _renderCurrentView(panel);
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// SPRINT SDQR-4 — Dashboard Stats (analytics souveraines)
// ══════════════════════════════════════════════════════════════════
// Charts custom SVG (pas de Chart.js → cohérence Keystone, 0 dep).
// Layout : KPI cards en haut, line chart période, bars geo/device/os.

let _statsPeriod = '30d';   // 7d | 30d | 90d | all
const PERIOD_LABELS = { '7d': '7 jours', '30d': '30 jours', '90d': '90 jours', 'all': 'Tout' };

async function _openQrStats(panel, qr) {
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;

  // Coquille initiale (loader)
  content.innerHTML = `
    <div class="sdqr-stats-wrap">
      <div class="sdqr-stats-head">
        <div class="sdqr-stats-head-left">
          <h2 class="sdqr-stats-title">${_esc(qr.name || '(sans nom)')}</h2>
          <div class="sdqr-stats-subtitle">Statistiques souveraines — aucune donnée tierce</div>
        </div>
        <div class="sdqr-stats-head-right">
          <div class="sdqr-period-pills" id="sdqr-period-pills">
            ${Object.entries(PERIOD_LABELS).map(([k, lbl]) => `
              <button class="sdqr-period-pill ${_statsPeriod === k ? 'is-active' : ''}" data-period="${k}">${lbl}</button>
            `).join('')}
          </div>
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-export-csv" title="Export brut des scans (RGPD-safe)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
        </div>
      </div>
      <div class="sdqr-stats-body" id="sdqr-stats-body">
        <div class="sdqr-empty-mini">Chargement des statistiques…</div>
      </div>
    </div>
  `;

  // Wire period pills
  content.querySelectorAll('.sdqr-period-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _statsPeriod = btn.dataset.period;
      content.querySelectorAll('.sdqr-period-pill').forEach(b => b.classList.toggle('is-active', b === btn));
      _loadStats(content, qr);
    });
  });

  // Wire CSV export
  content.querySelector('#sdqr-export-csv')?.addEventListener('click', () => _exportScansCsv(qr));

  await _loadStats(content, qr);
}

async function _loadStats(content, qr) {
  const body = content.querySelector('#sdqr-stats-body');
  if (!body) return;
  body.innerHTML = `<div class="sdqr-empty-mini">Chargement…</div>`;
  try {
    const data = await _apiStats(qr.id, _statsPeriod);
    body.innerHTML = _renderStatsBody(data, qr);
  } catch (e) {
    body.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur : ${_esc(e.message)}</div>`;
  }
}

function _renderStatsBody(data, qr) {
  // QR statique → empty state explicite
  if (data.mode === 'static') {
    return `
      <div class="sdqr-stats-static">
        <div class="sdqr-empty-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:48px;height:48px;opacity:.45"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h3 class="sdqr-stats-static-title">QR statique — aucun tracking</h3>
        <p class="sdqr-stats-static-text">Par design, les QR statiques encodent les données directement dans les pixels.<br>Aucun scan n'est tracké, aucune donnée n'est collectée.</p>
        <p class="sdqr-stats-static-text" style="margin-top:14px;font-size:11px;opacity:.5">${_esc(data.info || '')}</p>
      </div>
    `;
  }

  const t = data.totals || { total: 0, unique: 0, today: 0, week: 0 };
  const hasData = t.total > 0;

  return `
    <!-- KPI cards -->
    <div class="sdqr-kpi-grid">
      ${_kpiCard('Scans totaux', t.total, 'Sur la période sélectionnée')}
      ${_kpiCard('Visiteurs uniques', t.unique, 'Empreintes UA distinctes')}
      ${_kpiCard("Aujourd'hui", t.today, 'Depuis minuit')}
      ${_kpiCard('7 derniers jours', t.week, 'Glissants')}
    </div>

    ${hasData ? `
      <!-- Line chart : scans par jour -->
      <div class="sdqr-chart-card">
        <div class="sdqr-chart-title">Évolution des scans</div>
        ${_renderLineChart(data.byDay)}
      </div>

      <div class="sdqr-chart-grid">
        <div class="sdqr-chart-card">
          <div class="sdqr-chart-title">Pays (top 10)</div>
          ${_renderBarChart(data.byCountry.map(r => ({ label: r.country || '—', value: r.cnt })))}
        </div>
        <div class="sdqr-chart-card">
          <div class="sdqr-chart-title">Appareils</div>
          ${_renderBarChart(data.byDevice.map(r => ({ label: _deviceLabel(r.device), value: r.cnt })))}
        </div>
        <div class="sdqr-chart-card">
          <div class="sdqr-chart-title">Systèmes</div>
          ${_renderBarChart(data.byOs.map(r => ({ label: _osLabel(r.os), value: r.cnt })))}
        </div>
      </div>
    ` : `
      <div class="sdqr-stats-empty">
        <div class="sdqr-empty-mini">Aucun scan pour cette période. Le QR n'a peut-être pas encore été scanné, ou tu peux élargir la période en haut à droite.</div>
      </div>
    `}
  `;
}

function _kpiCard(label, value, hint) {
  return `
    <div class="sdqr-kpi-card">
      <div class="sdqr-kpi-label">${_esc(label)}</div>
      <div class="sdqr-kpi-value">${value.toLocaleString('fr-FR')}</div>
      <div class="sdqr-kpi-hint">${_esc(hint)}</div>
    </div>
  `;
}

// Line chart custom SVG. Points = byDay [{day:'2026-05-12', cnt:7}, ...]
function _renderLineChart(byDay) {
  if (!byDay?.length) {
    return `<div class="sdqr-empty-mini">Pas de scans sur la période.</div>`;
  }
  const W = 720, H = 180;
  const padL = 36, padR = 16, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxV = Math.max(...byDay.map(p => p.cnt), 1);
  const stepX = byDay.length === 1 ? 0 : innerW / (byDay.length - 1);

  const points = byDay.map((p, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - (p.cnt / maxV) * innerH;
    return { x, y, day: p.day, cnt: p.cnt };
  });

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L ${points[points.length-1].x.toFixed(1)},${(padT+innerH).toFixed(1)} L ${points[0].x.toFixed(1)},${(padT+innerH).toFixed(1)} Z`;

  // Y axis ticks (0, max/2, max)
  const yTicks = [0, Math.ceil(maxV/2), maxV];
  const yTickLines = yTicks.map(v => {
    const y = padT + innerH - (v / maxV) * innerH;
    return `<line x1="${padL}" y1="${y}" x2="${padL+innerW}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
            <text x="${padL-6}" y="${y+3}" text-anchor="end" fill="rgba(220,225,240,.4)" font-size="9">${v}</text>`;
  }).join('');

  // X axis labels (first, middle, last)
  const xIdx = byDay.length === 1 ? [0] : [0, Math.floor(byDay.length/2), byDay.length-1];
  const xLabels = xIdx.map(i => {
    const p = points[i];
    const dateLabel = byDay[i].day.slice(5);   // MM-DD
    return `<text x="${p.x}" y="${H-8}" text-anchor="middle" fill="rgba(220,225,240,.4)" font-size="9">${dateLabel}</text>`;
  }).join('');

  // Hover dots
  const dots = points.map(p => `
    <circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--gold, #6366f1)">
      <title>${p.day} : ${p.cnt} scan(s)</title>
    </circle>
  `).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="sdqr-line-chart">
      ${yTickLines}
      <path d="${area}" fill="rgba(99,102,241,.10)" stroke="none"/>
      <path d="${path}" fill="none" stroke="var(--gold, #6366f1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
    </svg>
  `;
}

// Horizontal bar chart custom SVG. items = [{label, value}, ...]
function _renderBarChart(items) {
  if (!items?.length) {
    return `<div class="sdqr-empty-mini">Aucune donnée.</div>`;
  }
  const maxV = Math.max(...items.map(i => i.value), 1);
  return `
    <ul class="sdqr-bar-list">
      ${items.map(it => `
        <li class="sdqr-bar-row">
          <span class="sdqr-bar-label">${_esc(it.label)}</span>
          <span class="sdqr-bar-track">
            <span class="sdqr-bar-fill" style="width:${(it.value/maxV*100).toFixed(1)}%"></span>
          </span>
          <span class="sdqr-bar-value">${it.value.toLocaleString('fr-FR')}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

const _DEVICE_LABELS = { mobile: 'Mobile', desktop: 'Desktop', tablet: 'Tablette', other: 'Autre' };
const _OS_LABELS = { ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', other: 'Autre' };
function _deviceLabel(k) { return _DEVICE_LABELS[k] || k || 'Autre'; }
function _osLabel(k)     { return _OS_LABELS[k]     || k || 'Autre'; }

async function _exportScansCsv(qr) {
  try {
    const r = await fetch(_apiScansCsvUrl(qr.id), {
      headers: _headers(),
    });
    if (!r.ok) throw new Error('Export error ' + r.status);
    const blob = await r.blob();
    _triggerDownload(blob, `scans-${_slug(qr.name)}-${qr.short_id || qr.id.slice(0,8)}.csv`);
  } catch (e) {
    alert('Erreur export CSV : ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// SPRINT SDQR-3 — Export PNG / SVG haute résolution
// ══════════════════════════════════════════════════════════════════
// Tout est généré côté client (pas d'aller-retour Worker) :
//   - SVG : on télécharge directement la string générée par renderQrCustom
//   - PNG : on rasterize le SVG via <img> → <canvas> → toBlob('image/png')
// Le filename est slugifié depuis le nom du QR ("Bâche Azur" → bache-azur).

function _slug(s) {
  return String(s || 'qr-keystone')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'qr-keystone';
}

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function _exportQrSvg(qr, encodedForQr, design) {
  // Rendu à 1024px pour avoir un viewBox propre — le SVG est vectoriel
  // donc la taille est juste indicative, c'est scalable à l'infini.
  let svg = await renderQrCustom(encodedForQr, design, 1024);
  // Ajoute la déclaration XML standard pour conformité fichier .svg
  if (!svg.trim().startsWith('<?xml')) {
    svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + svg;
  }
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  _triggerDownload(blob, `${_slug(qr.name)}-${qr.short_id || qr.id.slice(0, 8)}.svg`);
}

// ── Détection logo raster + lockdown du bouton Export SVG ─────────
// Un SVG qui contient un <image href="data:image/png;base64,..."> n'est
// PLUS vraiment vectoriel : beaucoup de visualiseurs SVG (Illustrator,
// Inkscape, certains services d'impression grand format) ignorent l'image
// embarquée → trou vide au centre du QR. On bloque l'export SVG dans ce cas.
function _logoIsRaster(design) {
  const url = design?.logo?.dataUrl || '';
  if (!url) return false;
  return /^data:image\/(png|jpeg|jpg|webp|gif)/i.test(url);
}

function _updateSvgExportState(root, design) {
  const btn  = root?.querySelector('[data-export="svg"]');
  const hint = root?.querySelector('[data-svg-hint]');
  if (!btn) return;
  if (_logoIsRaster(design)) {
    btn.disabled = true;
    btn.classList.add('is-locked');
    btn.title = 'Export SVG indisponible : ton logo n\'est pas vectoriel (PNG/JPEG). '
              + 'Le SVG résultant aurait un trou au centre dans la plupart des visualiseurs et services d\'impression. '
              + 'Utilise un logo .svg pour l\'export vectoriel, ou passe par PNG 1024/2048.';
    if (hint) hint.hidden = false;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-locked');
    btn.title = 'Vectoriel illimité — impression haut de gamme, bâche grand format';
    if (hint) hint.hidden = true;
  }
}

async function _exportQrPng(qr, encodedForQr, design, sizePx = 1024) {
  const svg = await renderQrCustom(encodedForQr, design, sizePx);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl  = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload  = () => res(i);
      i.onerror = (e) => rej(new Error('Image load failed'));
      i.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width  = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    // Fond blanc explicite si le design demande transparent — beaucoup
    // d'imprimeurs n'acceptent pas le transparent en PNG.
    if (!design?.bg || design.bg === 'transparent') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sizePx, sizePx);
    }
    ctx.drawImage(img, 0, 0, sizePx, sizePx);

    // Le <image> du logo imbriqué dans le SVG ne se rasterise PAS quand le SVG
    // est chargé comme <img> (mode statique restreint du navigateur) → le PNG
    // sortait avec un trou au centre. On dessine donc le logo nous-mêmes sur le
    // canvas (le masque/cercle de fond, lui, est vectoriel → déjà rasterisé).
    const logoUrl = design?.logo?.dataUrl;
    if (logoUrl) {
      try {
        const logoImg = await new Promise((res, rej) => {
          const li = new Image();
          li.onload  = () => res(li);
          li.onerror = () => rej(new Error('logo load failed'));
          li.src = logoUrl;
        });
        const ratio = Math.min(0.30, Math.max(0.10, design.logo.size || 0.20));
        const box   = sizePx * ratio;
        const fit   = Math.min(box / logoImg.width, box / logoImg.height) || 0;
        const w = logoImg.width * fit, h = logoImg.height * fit;
        ctx.drawImage(logoImg, (sizePx - w) / 2, (sizePx - h) / 2, w, h);
      } catch (e) {
        console.warn('[sdqr] logo non composé sur le PNG :', e.message);
        // On garde le QR (quitte à avoir le trou) plutôt que d'échouer l'export.
      }
    }

    const pngBlob = await new Promise((res, rej) => {
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png');
    });
    _triggerDownload(pngBlob, `${_slug(qr.name)}-${qr.short_id || qr.id.slice(0, 8)}-${sizePx}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

// ── PDF prêt à imprimer (SDQR S1) ─────────────────────────────────
// QR haute résolution centré sur une page A4 + légende (nom + URL courte).
// Auto-suffisant : ne touche pas _exportQrPng. jsPDF importé à la demande
// (pas de coût au chargement du pad ; échec géré par le dispatcher → '✗').
async function _exportQrPdf(qr, encodedForQr, design, sizePx = 2048) {
  const svg = await renderQrCustom(encodedForQr, design, sizePx);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  let dataUrl;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Image load failed'));
      i.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = sizePx; canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // PDF imprimé = toujours fond blanc
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.drawImage(img, 0, 0, sizePx, sizePx);
    const logoUrl = design?.logo?.dataUrl;            // logo recomposé (comme le PNG)
    if (logoUrl) {
      try {
        const li = await new Promise((res, rej) => {
          const x = new Image();
          x.onload = () => res(x);
          x.onerror = () => rej(new Error('logo load failed'));
          x.src = logoUrl;
        });
        const ratio = Math.min(0.30, Math.max(0.10, design.logo.size || 0.20));
        const box = sizePx * ratio;
        const fit = Math.min(box / li.width, box / li.height) || 0;
        const w = li.width * fit, h = li.height * fit;
        ctx.drawImage(li, (sizePx - w) / 2, (sizePx - h) / 2, w, h);
      } catch (e) {
        console.warn('[sdqr] logo non composé sur le PDF :', e.message);
      }
    }
    dataUrl = canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  const { jsPDF } = await import('https://esm.sh/jspdf@2.5.2');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210, qrMM = 120, x = (pageW - qrMM) / 2, y = 48;
  pdf.addImage(dataUrl, 'PNG', x, y, qrMM, qrMM);
  pdf.setTextColor('#1B2A4A');
  pdf.setFontSize(20);
  pdf.text(String(qr.name || 'QR Keystone'), pageW / 2, y + qrMM + 20, { align: 'center' });
  if (qr.short_id) {
    pdf.setTextColor('#8a8f99');
    pdf.setFontSize(11);
    pdf.text(`${CF_API.replace(/^https?:\/\//, '')}/r/${qr.short_id}`, pageW / 2, y + qrMM + 29, { align: 'center' });
  }
  pdf.save(`${_slug(qr.name)}-${qr.short_id || qr.id.slice(0, 8)}.pdf`);
}

// ══════════════════════════════════════════════════════════════════
// SPRINT SDQR-3 — Studio Design (panneau collapsible sous le QR)
// ══════════════════════════════════════════════════════════════════
// Contrôles : forme modules, forme ancres, couleur foreground + bg,
// dégradé linéaire 2 stops + angle, logo central (upload + taille),
// contrast checker temps réel. Live preview à chaque changement.
//
// Persistance : bouton "Sauvegarder le design" → PATCH /api/qr/:id
// { design: {...} }. Le détail est ensuite re-rendu pour refresh
// la liste sidebar (les vignettes pourraient utiliser le design plus tard).

// Mini-aperçus SVG des formes — bien plus ludique que des labels texte.
// On affiche la forme à 22x22, currentColor, dans la pill.
// SDQR-3.2 — 7 formes de modules, toutes prouvées scannables (jsQR, banc
// _design-lab/sdqr/scan-test.html : 10/10 PASS à 300px ET 170px).
const SHAPE_OPTS = [
  { id: 'square',  label: 'Carré',   svg: `<rect x="4" y="4" width="14" height="14"/>` },
  { id: 'dot',     label: 'Point',   svg: `<circle cx="11" cy="11" r="7"/>` },
  { id: 'rounded', label: 'Arrondi', svg: `<rect x="4" y="4" width="14" height="14" rx="4" ry="4"/>` },
  { id: 'circle',  label: 'Plein',   svg: `<circle cx="11" cy="11" r="8.5"/>` },
  { id: 'diamond', label: 'Losange', svg: `<path d="M11 3 L19 11 L11 19 L3 11 Z"/>` },
  { id: 'cross',   label: 'Croix',   svg: `<rect x="8" y="3" width="6" height="16"/><rect x="3" y="8" width="16" height="6"/>` },
  { id: 'classy',  label: 'Feuille', svg: `<path d="M8 4 H18 V14 A4 4 0 0 1 14 18 H4 V8 A4 4 0 0 1 8 4 Z"/>` },
];

// Mini-aperçus dédiés pour les ancres (anneau + centre composés)
const ANCHOR_OUTER_OPTS = [
  { id: 'square',  label: 'Carré',
    svg: `<rect x="3" y="3" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"/>` },
  { id: 'dot',     label: 'Point',
    svg: `<circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/>` },
  { id: 'rounded', label: 'Arrondi',
    svg: `<rect x="3" y="3" width="16" height="16" rx="4" ry="4" fill="none" stroke="currentColor" stroke-width="2.4"/>` },
];

const ANCHOR_INNER_OPTS = [
  { id: 'square',  label: 'Carré',   svg: `<rect x="7" y="7" width="8" height="8"/>` },
  { id: 'dot',     label: 'Point',   svg: `<circle cx="11" cy="11" r="4"/>` },
  { id: 'rounded', label: 'Arrondi', svg: `<rect x="7" y="7" width="8" height="8" rx="2.5" ry="2.5"/>` },
];

// SDQR-3.6 — YEUX nommés (combos anneau/centre), maquette « Yeux ». 10 styles
// TOUS prouvés scannables au jsQR (banc scan-test.html, PASS aux 2 tailles).
// Étoile / Pointillé / Cible = R&D scannabilité (finder patterns trop déviants
// pour la détection) → à venir.
const EYE_PRESETS = [
  { id: 'carre',      label: 'Carré',         outer: 'square',   inner: 'square'  },
  { id: 'arrondi',    label: 'Arrondi',       outer: 'rounded',  inner: 'rounded' },
  { id: 'arrondi-pt', label: 'Arrondi · point', outer: 'rounded',inner: 'dot'     },
  { id: 'arrondi-ca', label: 'Arrondi · carré', outer: 'rounded',inner: 'square'  },
  { id: 'doux',       label: 'Doux',          outer: 'squircle', inner: 'rounded' },
  { id: 'doux-plein', label: 'Doux plein',    outer: 'squircle', inner: 'square'  },
  { id: 'cercle',     label: 'Cercle',        outer: 'dot',      inner: 'dot'     },
  { id: 'cercle-ca',  label: 'Cercle · carré', outer: 'dot',     inner: 'square'  },
  { id: 'feuille',    label: 'Feuille',       outer: 'leaf',     inner: 'square'  },
  { id: 'losange',    label: 'Losange',       outer: 'dot',      inner: 'diamond' },
];

function _eyePresetActive(p, d) {
  return d.anchor.outer.shape === p.outer && d.anchor.inner.shape === p.inner;
}

// Palette de couleurs prédéfinies (swatches cliquables en un coup)
const COLOR_PRESETS = [
  { id: 'mono',      label: 'Sobre',     fg: '#000000', bg: '#ffffff', gradient: null },
  { id: 'keystone',  label: 'Keystone',  fg: '#1B2A4A', bg: '#ffffff', gradient: { from: '#1B2A4A', to: '#c9a84c', angle: 45 } },
  { id: 'apple',     label: 'Apple',     fg: '#1d1d1f', bg: '#f5f5f7', gradient: null },
  { id: 'indigo',    label: 'Indigo',    fg: '#4338ca', bg: '#ffffff', gradient: null },
  { id: 'gold',      label: 'Or royal',  fg: '#c9a84c', bg: '#1a1a1a', gradient: null },
  { id: 'emerald',   label: 'Émeraude',  fg: '#047857', bg: '#ffffff', gradient: null },
  { id: 'rose',      label: 'Rose',      fg: '#be123c', bg: '#fff1f2', gradient: null },
  { id: 'synthwave', label: 'Synthwave', fg: '#a855f7', bg: '#0f172a', gradient: { from: '#a855f7', to: '#06b6d4', angle: 135 } },
];

// Thèmes complets prêts à l'emploi (combo forme + couleur en 1 clic)
const THEME_PRESETS = [
  { id: 'sobre',     label: 'Sobre',
    module: 'square',  outer: 'square',  inner: 'square',  color: 'mono' },
  { id: 'keystone',  label: 'Keystone',
    module: 'dot',     outer: 'rounded', inner: 'dot',     color: 'keystone' },
  { id: 'apple',     label: 'Apple',
    module: 'dot',     outer: 'rounded', inner: 'rounded', color: 'apple' },
  { id: 'pop',       label: 'Pop',
    module: 'rounded', outer: 'dot',     inner: 'dot',     color: 'indigo' },
  { id: 'synthwave', label: 'Synthwave',
    module: 'dot',     outer: 'dot',     inner: 'dot',     color: 'synthwave' },
];

// SDQR-3.4 — Palettes PAR AMBIANCE (maquette « Couleurs »). Chaque palette =
// dégradé (modules) + accent (yeux distincts) + fond. Couleurs CALÉES sur la
// scannabilité : toutes décodent aux 2 tailles via jsQR (banc scan-test.html).
// 2 candidates bleu/teal (Malibu, Profondeur) écartées — artefact jsQR au
// raster élevé. La signature Keystone = Navy & Or (modules navy + yeux or).
const COLOR_AMBIANCES = [
  { group: 'Sobres', items: [
    { id: 'navy-or',      label: 'Navy & Or',         from: '#0a2741', to: '#22406e', angle: 45, accent: '#b08d2e', bg: '#ffffff' },
    { id: 'indigo-pulsa', label: 'Indigo Pulsa',      from: '#312e81', to: '#4f46e5', angle: 45, accent: '#7c3aed', bg: '#ffffff' },
    { id: 'aurore',       label: 'Aurore',            from: '#4c1d95', to: '#7c3aed', angle: 45, accent: '#b08d2e', bg: '#ffffff' },
  ]},
  { group: 'Chaleureux', items: [
    { id: 'sunset',       label: 'Coucher de soleil', from: '#7c2d12', to: '#c2410c', angle: 45, accent: '#5b1e0a', bg: '#ffffff' },
    { id: 'orange',       label: "Jus d'orange",      from: '#7c2d12', to: '#b45309', angle: 45, accent: '#1e293b', bg: '#ffffff' },
  ]},
  { group: 'Frais', items: [
    { id: 'pousse',       label: 'Jeune pousse',      from: '#166534', to: '#15803d', angle: 45, accent: '#7f1d1d', bg: '#ffffff' },
  ]},
  { group: 'Bold', items: [
    { id: 'violet',       label: 'Violet pop',        from: '#6b21a8', to: '#9333ea', angle: 45, accent: '#0e7490', bg: '#ffffff' },
  ]},
  { group: 'Néon', items: [
    { id: 'miracle',      label: 'Miracle',           from: '#0e7490', to: '#a21caf', angle: 45, accent: '#a16207', bg: '#ffffff' },
  ]},
];

function _applyAmbiance(pal) {
  _editingDesign.gradient = { enabled: true, from: pal.from, to: pal.to, angle: pal.angle ?? 45 };
  _editingDesign.bg = pal.bg || '#ffffff';
  if (!_editingDesign.eye) _editingDesign.eye = {};
  _editingDesign.eye.distinct = true;
  _editingDesign.eye.color = pal.accent;
}

function _ambianceActive(pal, d) {
  const lc = v => String(v || '').toLowerCase();
  return !!(d.gradient && d.gradient.enabled)
    && lc(d.gradient.from) === lc(pal.from) && lc(d.gradient.to) === lc(pal.to)
    && lc(d.bg) === lc(pal.bg)
    && !!d.eye?.distinct && lc(d.eye.color) === lc(pal.accent);
}

// Une carte de palette couleur est active si le design courant lui correspond.
function _colorPresetActive(p, d) {
  const lc = v => String(v || '').toLowerCase();
  const gOn = !!(d.gradient && d.gradient.enabled);
  if (p.gradient) {
    return gOn && lc(d.gradient.from) === lc(p.gradient.from) && lc(d.gradient.to) === lc(p.gradient.to) && lc(d.bg) === lc(p.bg);
  }
  return !gOn && lc(d.fg) === lc(p.fg) && lc(d.bg) === lc(p.bg);
}

// Champ couleur façon KeyForm : color-picker natif + saisie hexadécimale.
function _colorField(label, id, value) {
  return `
    <label class="sdqr-color-field">
      <span class="sdqr-design-lbl-sm">${label}</span>
      <span class="sdqr-color-row">
        <input type="color" id="${id}" value="${_esc(value)}">
        <input type="text" class="sdqr-hex" id="${id}-hex" value="${_esc(value)}" maxlength="7" spellcheck="false" autocomplete="off">
      </span>
    </label>`;
}

function _renderDesignPanel(qr) {
  const d = mergeDesign(qr.design);
  return `
    <details class="sdqr-design-panel" id="sdqr-design-panel" open>
      <summary class="sdqr-design-summary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2a10 10 0 1 0 10 10c0-2.74-2.84-3.18-5-3.5"/></svg>
        Personnaliser le design
        <span class="sdqr-design-arrow">▾</span>
      </summary>
      <div class="sdqr-design-body">

        <!-- Onglets (maquette : Modules / Yeux / Logo / Couleurs / Cadre / Modèles) -->
        <div class="sdqr-dtabs" id="sdqr-dtabs">
          <button class="sdqr-dtab is-active" data-dtab="modules">Modules</button>
          <button class="sdqr-dtab" data-dtab="yeux">Yeux</button>
          <button class="sdqr-dtab" data-dtab="logo">Logo</button>
          <button class="sdqr-dtab" data-dtab="couleurs">Couleurs</button>
          <button class="sdqr-dtab" data-dtab="cadre">Cadre</button>
          <button class="sdqr-dtab" data-dtab="modeles">Modèles</button>
        </div>

        <!-- MODÈLES (thèmes prêts à l'emploi + Surprise) -->
        <div class="sdqr-dtab-panel" data-dtab-panel="modeles">
          <div class="sdqr-design-section-head">
            <span class="sdqr-design-section-title">Thèmes prêts à l'emploi</span>
            <button class="sdqr-surprise-btn" data-action="surprise" title="Génère un design aléatoire">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M5 3v4"/><path d="M3 5h4"/><path d="M6 17v4"/><path d="M4 19h4"/><path d="M13 3l1.5 4.5L19 9l-4.5 1.5L13 15l-1.5-4.5L7 9l4.5-1.5L13 3z"/></svg>
              Surprends-moi
            </button>
          </div>
          <div class="sdqr-theme-cards">
            ${THEME_PRESETS.map(t => _renderThemeCard(t, d)).join('')}
          </div>
        </div>

        <!-- MODULES (motif du corps) — panneau actif par défaut -->
        <div class="sdqr-dtab-panel is-active" data-dtab-panel="modules">
          <div class="sdqr-shape-pills" data-shape-target="module">
            ${SHAPE_OPTS.map(s => _renderShapePill(s, d.module.shape === s.id)).join('')}
          </div>
          <div class="sdqr-design-hint">Le motif du corps du QR. Un motif trop clairsemé fragilise le scan — le garde-fou veille.</div>
        </div>

        <!-- YEUX (styles nommés = combos anneau/centre, jsQR-vérifiés) -->
        <div class="sdqr-dtab-panel" data-dtab-panel="yeux">
          <div class="sdqr-eye-grid">
            ${EYE_PRESETS.map(p => `
              <button class="sdqr-eye-card ${_eyePresetActive(p, d) ? 'is-on' : ''}" data-eye-preset="${p.id}" title="${_esc(p.label)}">
                <span class="sdqr-eye-prev">${anchorPreviewSvg(p.outer, p.inner, 40)}</span>
                <span class="sdqr-eye-name">${_esc(p.label)}</span>
              </button>`).join('')}
          </div>
          <div class="sdqr-design-hint">Les yeux = ce que la caméra verrouille en premier. Leur couleur se règle dans l'onglet Couleurs.</div>
        </div>

        <!-- COULEURS : palettes par ambiance + custom -->
        <div class="sdqr-dtab-panel" data-dtab-panel="couleurs">
          <div class="sdqr-design-hint">Le dégradé colore les modules &middot; la pastille d'accent colore les yeux.</div>
          <div class="sdqr-amb-groups">
            ${COLOR_AMBIANCES.map(g => `
              <div class="sdqr-amb-group">
                <div class="sdqr-amb-label">${_esc(g.group)}</div>
                <div class="sdqr-amb-row">
                  ${g.items.map(pal => `
                    <button class="sdqr-amb-card ${_ambianceActive(pal, d) ? 'is-on' : ''}" data-ambiance="${pal.id}" title="${_esc(pal.label)}">
                      <span class="sdqr-amb-top">
                        <span class="sdqr-amb-bar" style="background:linear-gradient(90deg, ${pal.from}, ${pal.to})"></span>
                        <span class="sdqr-amb-accent" style="background:${pal.accent}" title="Couleur des yeux"></span>
                      </span>
                      <span class="sdqr-amb-name">${_esc(pal.label)}</span>
                    </button>`).join('')}
                </div>
              </div>`).join('')}
          </div>

          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Mode</span>
            <div class="sdqr-shape-pills" data-color-mode>
              <button class="sdqr-shape-pill ${!d.gradient.enabled ? 'is-active' : ''}" data-mode="solid">Unie</button>
              <button class="sdqr-shape-pill ${d.gradient.enabled ? 'is-active' : ''}" data-mode="gradient">Dégradé</button>
            </div>
          </div>

          <div class="sdqr-color-grid" data-when-solid ${d.gradient.enabled ? 'hidden' : ''}>
            ${_colorField('Couleur', 'sdqr-color-fg', d.fg)}
            ${_colorField('Fond', 'sdqr-color-bg', d.bg)}
          </div>

          <div class="sdqr-color-grid" data-when-gradient ${d.gradient.enabled ? '' : 'hidden'}>
            ${_colorField('Départ', 'sdqr-grad-from', d.gradient.from)}
            ${_colorField('Fin', 'sdqr-grad-to', d.gradient.to)}
            ${_colorField('Fond', 'sdqr-color-bg-grad', d.bg)}
          </div>

          <div class="sdqr-design-row" data-when-gradient ${d.gradient.enabled ? '' : 'hidden'}>
            <span class="sdqr-design-lbl">Angle</span>
            <div class="sdqr-slider-wrap">
              <input type="range" id="sdqr-grad-angle" min="0" max="360" step="5" value="${d.gradient.angle}">
              <span class="sdqr-slider-val" id="sdqr-grad-angle-val">${d.gradient.angle}°</span>
            </div>
          </div>

          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Yeux</span>
            <div class="sdqr-shape-pills" data-eye-mode>
              <button class="sdqr-shape-pill ${!d.eye.distinct ? 'is-active' : ''}" data-eye="inherit">Comme modules</button>
              <button class="sdqr-shape-pill ${d.eye.distinct ? 'is-active' : ''}" data-eye="distinct">Distincte</button>
            </div>
          </div>
          <div class="sdqr-color-grid" data-when-eye ${d.eye.distinct ? '' : 'hidden'}>
            ${_colorField('Couleur des yeux', 'sdqr-eye-color', d.eye.color)}
          </div>
        </div>

        <!-- LOGO central avec zone drop visible -->
        <div class="sdqr-dtab-panel" data-dtab-panel="logo">
          <div class="sdqr-design-section-title">Logo central</div>
          <div class="sdqr-logo-zone ${d.logo.dataUrl ? 'has-logo' : ''}" id="sdqr-logo-zone">
            ${d.logo.dataUrl ? `
              <div class="sdqr-logo-zone-preview"><img src="${_esc(d.logo.dataUrl)}" alt=""></div>
              <div class="sdqr-logo-zone-actions">
                <label class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" style="cursor:pointer">
                  Remplacer
                  <input type="file" id="sdqr-logo-input" accept="image/png,image/jpeg,image/svg+xml" hidden>
                </label>
                <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-logo-remove">Retirer</button>
              </div>
            ` : `
              <label class="sdqr-logo-zone-empty" for="sdqr-logo-input">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;opacity:.55"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span class="sdqr-logo-zone-text"><strong>Glisse une image ici</strong> ou clique<br><small>PNG · JPEG · <strong>SVG</strong> recommandé pour export vectoriel · max 500 Ko</small></span>
                <input type="file" id="sdqr-logo-input" accept="image/png,image/jpeg,image/svg+xml" hidden>
              </label>
            `}
          </div>

          ${d.logo.dataUrl ? `
            <div class="sdqr-design-row">
              <span class="sdqr-design-lbl">Taille</span>
              <div class="sdqr-slider-wrap">
                <input type="range" id="sdqr-logo-size" min="10" max="30" step="1" value="${Math.round(d.logo.size * 100)}">
                <span class="sdqr-slider-val" id="sdqr-logo-size-val">${Math.round(d.logo.size * 100)}%</span>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- CADRE + accroche (autour du QR — scannabilité préservée) -->
        <div class="sdqr-dtab-panel" data-dtab-panel="cadre">
          <div class="sdqr-design-hint">Un cadre + une accroche autour du QR — le code reste intact, donc scannable.</div>
          <div class="sdqr-shape-pills" data-frame-style>
            ${FRAME_OPTS.map(f => `<button class="sdqr-shape-pill ${d.frame.style === f.id ? 'is-active' : ''}" data-frame="${f.id}">${_esc(f.label)}</button>`).join('')}
          </div>
          <div data-when-frame ${d.frame.style === 'none' ? 'hidden' : ''}>
            <label class="sdqr-field sdqr-field--full" style="margin-top:12px">
              <span class="sdqr-field-lbl">Accroche</span>
              <input type="text" id="sdqr-frame-text" class="sdqr-input" maxlength="28" value="${_esc(d.frame.text)}" placeholder="Scannez-moi">
            </label>
            <div class="sdqr-color-grid" style="margin-top:10px">
              ${_colorField('Couleur du cadre', 'sdqr-frame-color', d.frame.color)}
            </div>
          </div>
        </div>

        <!-- Contrast checker + actions -->
        <div class="sdqr-design-foot">
          <div class="sdqr-contrast" id="sdqr-contrast"></div>
          <button class="sdqr-btn sdqr-btn--primary sdqr-btn--xs" id="sdqr-save-design">Sauvegarder le design</button>
        </div>
      </div>
    </details>
  `;
}

// Mini-preview SVG rendu directement pour les thèmes : un QR ultra-simplifié
// 5x5 qui montre les formes module + ancres + couleurs.
// Trame QR stylisée PARTAGÉE (mire pictogramme cohérente sur toutes les
// cartes) — recolorée par thème. `fillRef` = couleur unie (#hex) ou
// url(#id) si dégradé ; `defs` = bloc <defs> du dégradé. Toutes les cartes
// affichent la même trame : seul varie la couleur/dégradé (look Palette).
function _qrTrameSvg(fillRef, defs = '') {
  const eye = (x, y) =>
    `<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="none" stroke="${fillRef}" stroke-width="2.4"/>` +
    `<rect x="${x + 4}" y="${y + 4}" width="4" height="4" rx="1.2" fill="${fillRef}" stroke="none"/>`;
  const dots = [
    [19,19],[26,20],[33,19],[20,26],[27,27],[34,26],
    [19,33],[26,34],[33,33],[39,30],[24,40],[39,39],
  ].map(([x, y]) => `<rect x="${x}" y="${y}" width="3.4" height="3.4" rx="1" fill="${fillRef}" stroke="none"/>`).join('');
  return `<svg viewBox="0 0 44 44" class="sdqr-theme-svg" aria-hidden="true">${defs}${eye(2,2)}${eye(30,2)}${eye(2,30)}${dots}</svg>`;
}

// Une carte de thème est "active" si le design courant correspond exactement
// à sa combinaison formes + couleurs (pour la bordure de sélection).
function _themeIsActive(theme, d) {
  const c = COLOR_PRESETS.find(x => x.id === theme.color);
  if (!c) return false;
  const lc = v => String(v || '').toLowerCase();
  if (d.module.shape !== theme.module) return false;
  if (d.anchor.outer.shape !== theme.outer) return false;
  if (d.anchor.inner.shape !== theme.inner) return false;
  if (lc(d.fg) !== lc(c.fg) || lc(d.bg) !== lc(c.bg)) return false;
  const gradOn = !!(d.gradient && d.gradient.enabled);
  if (gradOn !== !!c.gradient) return false;
  if (c.gradient && (lc(d.gradient.from) !== lc(c.gradient.from) || lc(d.gradient.to) !== lc(c.gradient.to))) return false;
  return true;
}

function _renderThemeCard(theme, d) {
  const color = COLOR_PRESETS.find(c => c.id === theme.color);
  const gid   = `qrtrame-${theme.id}`;
  const fill  = color.gradient ? `url(#${gid})` : color.fg;
  const defs  = color.gradient
    ? `<defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${color.gradient.from}"/><stop offset="100%" stop-color="${color.gradient.to}"/></linearGradient></defs>`
    : '';
  const active = d ? _themeIsActive(theme, d) : false;
  return `
    <button class="sdqr-theme-card ${active ? 'is-on' : ''}" data-theme="${theme.id}" title="${_esc(theme.label)}">
      <span class="sdqr-theme-preview" style="background:${color.bg}">
        ${_qrTrameSvg(fill, defs)}
      </span>
      <span class="sdqr-theme-label">${_esc(theme.label)}</span>
    </button>
  `;
}

// Pill avec mini-aperçu SVG de la forme (au lieu d'un label texte sec)
function _renderShapePill(opt, isActive) {
  return `
    <button class="sdqr-shape-pill sdqr-shape-pill--visual ${isActive ? 'is-active' : ''}" data-shape="${opt.id}" title="${_esc(opt.label)}">
      <svg viewBox="0 0 22 22" class="sdqr-shape-pill-svg">${opt.svg}</svg>
      <span class="sdqr-shape-pill-lbl">${_esc(opt.label)}</span>
    </button>
  `;
}

// État live du design pendant l'édition (avant save). Reset à chaque
// ouverture de panel.
let _editingDesign = null;

// Détecte si _editingDesign contient des modifs non sauvegardées par
// rapport au design persisté. Utilisé par les save handlers (rename,
// archive, target_url, payload) pour PRESERVER le design en cours
// quand on update autre chose — sinon le re-render qui suit reset
// _editingDesign et l'utilisateur perd ses choix forme/couleur/logo.
function _designHasUnsavedChanges(editing, saved) {
  if (!editing) return false;
  return JSON.stringify(editing) !== JSON.stringify(mergeDesign(saved));
}

function _wireDesignPanel(root, qr, encodedForQr) {
  const panel = root.querySelector('#sdqr-design-panel');
  if (!panel) return;

  // Onglets du panneau Design (Modules/Yeux/Logo/Couleurs/Cadre/Modèles).
  // Tous les panneaux restent dans le DOM (le câblage querySelectorAll les
  // trouve même masqués) ; on ne fait qu'afficher l'onglet actif.
  panel.querySelectorAll('#sdqr-dtabs .sdqr-dtab').forEach(tab => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.dtab;
      panel.querySelectorAll('#sdqr-dtabs .sdqr-dtab').forEach(b => b.classList.toggle('is-active', b === tab));
      panel.querySelectorAll('[data-dtab-panel]').forEach(p => p.classList.toggle('is-active', p.dataset.dtabPanel === t));
    });
  });
  // Si _editingDesign existe deja (cas refresh DOM apres upload/retrait
  // logo), on le PRESERVE. Sinon (1ere ouverture du detail), on init.
  // Le reset a null est fait par _openQrDetail au switch de QR.
  if (!_editingDesign) {
    _editingDesign = mergeDesign(qr.design);
  }

  const _liveRerender = async () => {
    try {
      const svg = await renderQrCustom(encodedForQr, _editingDesign, 280);
      const wrap = root.querySelector('#sdqr-svg-wrap');
      if (wrap) wrap.innerHTML = svg;
    } catch (e) { console.error('[sdqr-design] render', e); }
    _updateContrastBadge(root);
    _updateSvgExportState(root, _editingDesign);
  };

  // Pills formes (modules / anchor-outer / anchor-inner)
  panel.querySelectorAll('[data-shape-target]').forEach(group => {
    const target = group.dataset.shapeTarget;
    group.querySelectorAll('.sdqr-shape-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        if (target === 'module') {
          _editingDesign.module.shape = btn.dataset.shape;
        } else if (target === 'anchor-outer') {
          _editingDesign.anchor.outer.shape = btn.dataset.shape;
        } else if (target === 'anchor-inner') {
          _editingDesign.anchor.inner.shape = btn.dataset.shape;
        }
        group.querySelectorAll('.sdqr-shape-pill').forEach(b => b.classList.toggle('is-active', b === btn));
        _liveRerender();
      });
    });
  });

  // Yeux : styles nommés (combos anneau/centre prouvés scannables)
  panel.querySelectorAll('[data-eye-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = EYE_PRESETS.find(x => x.id === btn.dataset.eyePreset);
      if (!p) return;
      _editingDesign.anchor.outer.shape = p.outer;
      _editingDesign.anchor.inner.shape = p.inner;
      panel.querySelectorAll('[data-eye-preset]').forEach(b => b.classList.toggle('is-on', b === btn));
      _liveRerender();
    });
  });

  // Thèmes prêts à l'emploi (1-clic applique formes + couleurs + gradient)
  panel.querySelectorAll('[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = THEME_PRESETS.find(t => t.id === btn.dataset.theme);
      if (!theme) return;
      _applyTheme(theme);
      _refreshDesignPanelDom(root, qr, encodedForQr);
    });
  });

  // "Surprends-moi" : tirage aleatoire forme + couleur
  panel.querySelector('[data-action="surprise"]')?.addEventListener('click', () => {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    _applyTheme({
      module: pick(SHAPE_OPTS).id,
      outer : pick(ANCHOR_OUTER_OPTS).id,
      inner : pick(ANCHOR_INNER_OPTS).id,
      color : pick(COLOR_PRESETS).id,
    });
    _refreshDesignPanelDom(root, qr, encodedForQr);
  });

  // Palette de couleurs prédéfinies
  panel.querySelectorAll('[data-color-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = COLOR_PRESETS.find(p => p.id === btn.dataset.colorPreset);
      if (!preset) return;
      _applyColorPreset(preset);
      _refreshDesignPanelDom(root, qr, encodedForQr);
    });
  });

  // Drag & drop logo sur la zone visible
  const logoZone = panel.querySelector('#sdqr-logo-zone');
  if (logoZone) {
    ['dragenter', 'dragover'].forEach(ev => {
      logoZone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        logoZone.classList.add('is-dragging');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      logoZone.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
        logoZone.classList.remove('is-dragging');
      });
    });
    logoZone.addEventListener('drop', async e => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      await _handleLogoFile(file, root, qr, encodedForQr);
    });
  }

  // Mode couleur (solid / gradient)
  panel.querySelectorAll('[data-color-mode] .sdqr-shape-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingDesign.gradient.enabled = btn.dataset.mode === 'gradient';
      panel.querySelectorAll('[data-color-mode] .sdqr-shape-pill').forEach(b => b.classList.toggle('is-active', b === btn));
      panel.querySelectorAll('[data-when-solid]').forEach(el => el.hidden = _editingDesign.gradient.enabled);
      panel.querySelectorAll('[data-when-gradient]').forEach(el => el.hidden = !_editingDesign.gradient.enabled);
      _liveRerender();
    });
  });

  // Couleurs (color-picker + saisie hex synchronisés) — unie + dégradé
  const _bindColor = (id, apply) => {
    const c = panel.querySelector('#' + id);
    const h = panel.querySelector('#' + id + '-hex');
    if (!c) return;
    c.addEventListener('input', e => { apply(e.target.value); if (h) h.value = e.target.value; _liveRerender(); });
    if (h) h.addEventListener('input', e => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { apply(v); c.value = v; _liveRerender(); }
    });
  };
  _bindColor('sdqr-color-fg',      v => { _editingDesign.fg = v; });
  _bindColor('sdqr-color-bg',      v => { _editingDesign.bg = v; });
  _bindColor('sdqr-grad-from',     v => { _editingDesign.gradient.from = v; });
  _bindColor('sdqr-grad-to',       v => { _editingDesign.gradient.to = v; });
  _bindColor('sdqr-color-bg-grad', v => { _editingDesign.bg = v; });

  // Angle dégradé
  panel.querySelector('#sdqr-grad-angle')?.addEventListener('input', e => {
    _editingDesign.gradient.angle = parseInt(e.target.value, 10);
    const valEl = panel.querySelector('#sdqr-grad-angle-val');
    if (valEl) valEl.textContent = _editingDesign.gradient.angle + '°';
    _liveRerender();
  });

  // Cadre & accroche (dessiné AUTOUR du QR → n'affecte pas la scannabilité)
  if (!_editingDesign.frame) _editingDesign.frame = { ...DEFAULT_DESIGN.frame };
  panel.querySelectorAll('[data-frame-style] .sdqr-shape-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingDesign.frame.style = btn.dataset.frame;
      panel.querySelectorAll('[data-frame-style] .sdqr-shape-pill').forEach(b => b.classList.toggle('is-active', b === btn));
      panel.querySelectorAll('[data-when-frame]').forEach(el => el.hidden = btn.dataset.frame === 'none');
      _liveRerender();
    });
  });
  panel.querySelector('#sdqr-frame-text')?.addEventListener('input', e => {
    _editingDesign.frame.text = e.target.value;
    _liveRerender();
  });
  _bindColor('sdqr-frame-color', v => { _editingDesign.frame.color = v; });

  // Palettes PAR AMBIANCE (dégradé modules + accent yeux, en 1 clic)
  panel.querySelectorAll('[data-ambiance]').forEach(btn => {
    btn.addEventListener('click', () => {
      let pal = null;
      for (const g of COLOR_AMBIANCES) { const f = g.items.find(p => p.id === btn.dataset.ambiance); if (f) { pal = f; break; } }
      if (!pal) return;
      _applyAmbiance(pal);
      _refreshDesignPanelDom(root, qr, encodedForQr);
    });
  });

  // Couleur des YEUX : héritée (comme modules) / distincte (accent)
  if (!_editingDesign.eye) _editingDesign.eye = { distinct: false, color: '#b08d2e' };
  panel.querySelectorAll('[data-eye-mode] .sdqr-shape-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _editingDesign.eye.distinct = btn.dataset.eye === 'distinct';
      panel.querySelectorAll('[data-eye-mode] .sdqr-shape-pill').forEach(b => b.classList.toggle('is-active', b === btn));
      panel.querySelectorAll('[data-when-eye]').forEach(el => el.hidden = !_editingDesign.eye.distinct);
      _updateContrastBadge(root);
      _liveRerender();
    });
  });
  _bindColor('sdqr-eye-color', v => { _editingDesign.eye.color = v; });

  // Logo upload (via input file click)
  panel.querySelector('#sdqr-logo-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    await _handleLogoFile(file, root, qr, encodedForQr);
  });

  // Retirer logo
  panel.querySelector('#sdqr-logo-remove')?.addEventListener('click', () => {
    _editingDesign.logo = { dataUrl: '', size: 0.20 };
    _liveRerender();
    _refreshDesignPanelDom(root, qr, encodedForQr);
  });

  // Taille logo
  panel.querySelector('#sdqr-logo-size')?.addEventListener('input', e => {
    _editingDesign.logo.size = parseInt(e.target.value, 10) / 100;
    const valEl = panel.querySelector('#sdqr-logo-size-val');
    if (valEl) valEl.textContent = e.target.value + '%';
    _liveRerender();
  });

  // Sauvegarder le design
  panel.querySelector('#sdqr-save-design')?.addEventListener('click', async () => {
    const btn = panel.querySelector('#sdqr-save-design');
    if (!btn) return;
    // Garde-fou contraste à l'enregistrement : en dégradé, on évalue la
    // PIRE borne (from/to). Sous 3:1, on prévient avant de figer un design
    // que les lecteurs pourront refuser de scanner.
    const c = _designContrast(_editingDesign);
    if (c && c.level !== 'ok' && !confirm(
      `⚠️ Contraste ${c.level === 'bad' ? 'insuffisant' : 'limite'} (${c.ratio.toFixed(1)}:1).\n\n` +
      `La couleur la plus claire du QR passe sous le seuil de 3:1 recommandé : ` +
      `certains lecteurs peineront à le scanner.\n\nEnregistrer quand même ?`
    )) return;
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ …';
    try {
      await _apiUpdate(qr.id, { design: _editingDesign });
      // Fix 2026-05-26 — Bug : le design persistait en DB mais quand
      // l'utilisateur rouvrait le QR depuis la sidebar, c'était l'ancienne
      // version en cache (_cachedQrs) qui s'affichait → symptôme
      // "il faut recommencer pour que ça soit pris en compte".
      // Solution : deep-clone le design dans qr.design ET dans _cachedQrs
      // (les autres save handlers passent par _refreshList, mais ici un
      // refresh API serait excessif pour juste une modif design).
      const designSnapshot = JSON.parse(JSON.stringify(_editingDesign));
      qr.design = designSnapshot;
      const cached = _cachedQrs.find(x => x.id === qr.id);
      if (cached) cached.design = JSON.parse(JSON.stringify(designSnapshot));
      btn.textContent = '✓ Design sauvegardé';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800);
    } catch (e) {
      btn.textContent = '✗ ' + e.message;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    }
  });

  // Initial contrast badge
  _updateContrastBadge(root);

  // Sync initial du QR avec l'état _editingDesign courant. Crucial après
  // un _refreshDesignPanelDom (theme / palette / surprise) : sinon les
  // controles affichent le nouveau preset mais le QR reste sur l'ancien
  // design tant que l'utilisateur ne touche pas un autre pill.
  _liveRerender();
}

// Re-render uniquement la zone .sdqr-design-body après upload/retrait logo
// (préserve l'état ouvert <details> et le _editingDesign).
function _refreshDesignPanelDom(root, qr, encodedForQr) {
  const panel = root.querySelector('#sdqr-design-panel');
  if (!panel) return;
  const wasOpen = panel.open;
  // On stocke le design en cours sur l'entité temporairement, puis re-render
  const merged = { ..._editingDesign };
  panel.outerHTML = _renderDesignPanel({ ...qr, design: merged });
  _wireDesignPanel(root, qr, encodedForQr);
  const newPanel = root.querySelector('#sdqr-design-panel');
  if (newPanel && wasOpen) newPanel.open = true;
}

// Évalue le contraste réel d'un design. CLÉ : en dégradé, les DEUX bornes
// (from ET to) peignent des modules → on retient la PIRE (ratio minimal).
// Sinon une borne claire (ex. l'or Keystone #c9a84c ~2.3:1 sur blanc)
// passait le garde-fou alors que la moitié dorée des modules tombe sous le
// seuil pratique de 3:1 et casse la scannabilité. Renvoie { fg, bg, ratio,
// level } de la pire borne, ou null si non évaluable (pas de fg / fond
// transparent).
function _designContrast(design) {
  if (!design) return null;
  const bg = design.bg;
  if (!bg || bg === 'transparent') return null;
  const fgs = design.gradient?.enabled
    ? [design.gradient.from, design.gradient.to]
    : [design.fg];
  // Les YEUX (couleur d'accent distincte) sont des finder patterns critiques :
  // un accent trop clair (ex: or vif sur blanc) casse la détection. On l'inclut
  // dans le pire-cas du contraste pour que le garde-fou le signale.
  if (design.eye?.distinct && design.eye.color) fgs.push(design.eye.color);
  if (fgs.some(c => !c)) return null;
  let worst = null;
  for (const fg of fgs) {
    const ratio = contrastRatio(fg, bg);
    if (!worst || ratio < worst.ratio) worst = { fg, bg, ratio, level: contrastLevel(fg, bg) };
  }
  return worst;
}

function _updateContrastBadge(root) {
  const el = root.querySelector('#sdqr-contrast');
  if (!el || !_editingDesign) return;
  const c = _designContrast(_editingDesign);
  if (!c) { el.innerHTML = ''; return; }
  const { ratio, level } = c;
  // En dégradé, c'est la borne la plus claire qui pèche → on le précise
  // pour que l'utilisateur comprenne pourquoi un QR « navy » est signalé.
  const grad = (_editingDesign.gradient?.enabled && level !== 'ok')
    ? ' (borne claire du dégradé)' : '';
  const labels = {
    ok  : `Contraste excellent (${ratio.toFixed(1)}:1) — scannabilité optimale`,
    warn: `Contraste limite (${ratio.toFixed(1)}:1)${grad} — certains scanners pourront peiner`,
    bad : `Contraste insuffisant (${ratio.toFixed(1)}:1)${grad} — le QR risque d'être illisible`,
  };
  el.className = `sdqr-contrast sdqr-contrast--${level}`;
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/>${level === 'ok' ? '<polyline points="9 12 11 14 15 9"/>' : '<line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}</svg>
    ${labels[level]}
  `;
}

// Applique un thème complet à _editingDesign (formes + couleurs).
function _applyTheme(theme) {
  _editingDesign.module.shape       = theme.module;
  _editingDesign.anchor.outer.shape = theme.outer;
  _editingDesign.anchor.inner.shape = theme.inner;
  const color = COLOR_PRESETS.find(c => c.id === theme.color);
  if (color) _applyColorPreset(color);
}

// Applique un preset couleur (unie ou gradient) à _editingDesign.
function _applyColorPreset(preset) {
  _editingDesign.fg = preset.fg;
  _editingDesign.bg = preset.bg;
  if (preset.gradient) {
    _editingDesign.gradient = { enabled: true, ...preset.gradient };
  } else {
    _editingDesign.gradient = { ..._editingDesign.gradient, enabled: false };
  }
}

// Pipeline upload logo : validation + dataUrl + state + re-render
async function _handleLogoFile(file, root, qr, encodedForQr) {
  if (!file) return;
  if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
    alert('Format non supporté. Utilise PNG, JPEG ou SVG.');
    return;
  }
  if (file.size > 500 * 1024) {
    alert('Image trop lourde — max 500 Ko. Optimise via TinyPNG / Squoosh.');
    return;
  }
  const dataUrl = await _fileToDataUrl(file);
  _editingDesign.logo.dataUrl = dataUrl;
  if (!_editingDesign.logo.size) _editingDesign.logo.size = 0.20;
  _refreshDesignPanelDom(root, qr, encodedForQr);
}

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ── Utilitaire HTML escape (XSS-safe) ──────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
