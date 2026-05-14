/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Artefact SDQR (Sovereign Dynamic QR)
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
import { QR_TYPES, encodePayload, previewSummary } from './sdqr-types.js';
import { renderQrCustom, mergeDesign, DEFAULT_DESIGN, contrastRatio, contrastLevel } from './sdqr-render.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton } from './lib/help-overlay.js';

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';

let _qrLib       = null;       // lazy import (legacy createSvgTag fallback)
let _cachedQrs   = [];         // dernière liste reçue
let _currentView = 'studio';   // 'studio' | 'stats'
let _selectedId  = null;       // QR sélectionné dans la sidebar
let _busy        = false;      // anti-double-click

// Filtres sidebar (Sprint final)
let _filter = {
  search: '',                  // matcher nom + tags
  status: 'all',               // all | active | archived
  type  : 'all',               // all | url | text | vcard | wifi | ical
};

// État de la fenêtre de création (Sprint SDQR-2)
let _creating = {
  mode    : 'dynamic',         // 'static' | 'dynamic'
  type    : 'url',             // url | text | vcard | wifi | ical
  payload : {},                // valeurs des champs typés
  name    : '',
  tags    : '',
};

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

export function openSDQR() {
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

  _wireShell(panel);
  bindRatingButton(panel, 'A-COM-001');
  bindHelpButton(panel, 'A-COM-001');
  _refreshList(panel);
}

export function closeSDQR() {
  document.getElementById('sdqr-fullscreen')?.classList.remove('open');
  document.body.style.overflow = '';
}

function _renderShell() {
  return `
    <div class="sdqr-topbar">
      <div class="sdqr-topbar-left">
        <button class="sdqr-back-btn" id="sdqr-close-btn" title="Fermer l'artefact">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Retour
        </button>
        <div class="sdqr-title-zone">
          <div class="sdqr-eyebrow">Artefact · A-COM-001</div>
          <div class="sdqr-title">Sovereign Dynamic QR</div>
        </div>
      </div>
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

function _wireShell(panel) {
  panel.querySelector('#sdqr-close-btn')?.addEventListener('click', closeSDQR);
  panel.querySelector('#sdqr-new-btn')?.addEventListener('click', () => _openCreateForm(panel));
  panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
  panel.querySelectorAll('.sdqr-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      panel.querySelectorAll('.sdqr-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      _currentView = t.dataset.view;
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

  // Vue Studio (par défaut)
  if (!qr) {
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

// Render seul depuis _cachedQrs (appelé par les filter handlers — no fetch)
function _renderList(panel) {
  const listEl = panel.querySelector('#sdqr-list');
  if (!listEl) return;

  // Filtrage local (recherche + status)
  const filtered = _applyFilters(_cachedQrs);

  if (_cachedQrs.length === 0) {
    listEl.innerHTML = `<div class="sdqr-empty-mini">Aucun QR pour l'instant.</div>`;
    return;
  }
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="sdqr-empty-mini">Aucun résultat pour ce filtre.<br><button class="sdqr-empty-reset" id="sdqr-filter-reset">Réinitialiser</button></div>`;
    listEl.querySelector('#sdqr-filter-reset')?.addEventListener('click', () => {
      _filter = { search: '', status: 'all', type: 'all' };
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
          ${q.status === 'archived' ? '<span class="sdqr-li-status">Archivé</span>' : ''}
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
}

// ══════════════════════════════════════════════════════════════════
// Studio — formulaire création / détail QR
// ══════════════════════════════════════════════════════════════════

function _openCreateForm(panel) {
  const content = panel.querySelector('#sdqr-content');
  if (!content) return;
  _selectedId = null;
  panel.querySelectorAll('.sdqr-li.is-selected').forEach(el => el.classList.remove('is-selected'));

  // Reset l'état de création à chaque ouverture
  _creating = { mode: 'dynamic', type: 'url', payload: {}, name: '', tags: '' };

  content.innerHTML = `
    <div class="sdqr-form-wrap">
      <div class="sdqr-form-head">
        <h2 class="sdqr-form-title">Nouveau QR code</h2>
        <p class="sdqr-form-sub">Choisis le mode et le type, puis remplis les champs. Le QR sera prévisualisé après création.</p>
      </div>

      <!-- Mode toggle (Statique / Dynamique) -->
      <div class="sdqr-mode-toggle" id="sdqr-mode-toggle">
        <button class="sdqr-mode-btn" data-mode="dynamic">
          <span class="sdqr-mode-dot"></span>
          <div class="sdqr-mode-txt">
            <strong>Dynamique</strong>
            <small>URL modifiable · stats trackées · nécessite connexion</small>
          </div>
        </button>
        <button class="sdqr-mode-btn" data-mode="static">
          <span class="sdqr-mode-dot"></span>
          <div class="sdqr-mode-txt">
            <strong>Statique</strong>
            <small>Données dans les pixels · offline · non modifiable</small>
          </div>
        </button>
      </div>

      <!-- Cartes de type -->
      <div class="sdqr-type-cards" id="sdqr-type-cards"></div>

      <!-- Form contextuel selon le type -->
      <div class="sdqr-form-grid" id="sdqr-form-fields"></div>

      <!-- Méta commune (nom + tags) -->
      <div class="sdqr-form-grid" style="margin-top:14px">
        <label class="sdqr-field sdqr-field--full">
          <span class="sdqr-field-lbl">Nom interne <span class="sdqr-req">*</span></span>
          <input type="text" id="sdqr-f-name" class="sdqr-input" placeholder="ex: Bâche chantier Azur — Avancement">
        </label>
        <label class="sdqr-field sdqr-field--full">
          <span class="sdqr-field-lbl">Tags (séparés par virgule)</span>
          <input type="text" id="sdqr-f-tags" class="sdqr-input" placeholder="ex: chantier, azur, 2027">
        </label>
      </div>

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

  _renderTypeCards(content);
  _renderModeToggle(content);
  _renderFormFields(content);

  // Bindings persistants (nom + tags)
  content.querySelector('#sdqr-f-name')?.addEventListener('input', e => { _creating.name = e.target.value; });
  content.querySelector('#sdqr-f-tags')?.addEventListener('input', e => { _creating.tags = e.target.value; });

  content.querySelector('#sdqr-cancel')?.addEventListener('click', () => {
    content.innerHTML = _renderEmptyStudio();
    panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
  });
  content.querySelector('#sdqr-save')?.addEventListener('click', () => _handleCreate(panel));
}

// Rend les cartes de type cliquables. La carte active reflète _creating.type.
// Si on bascule sur un type static-only, force _creating.mode = 'static'.
function _renderTypeCards(root) {
  const wrap = root.querySelector('#sdqr-type-cards');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(QR_TYPES).map(([id, def]) => {
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
  wrap.querySelectorAll('.sdqr-type-card').forEach(card => {
    card.addEventListener('click', () => {
      const newType = card.dataset.type;
      _creating.type = newType;
      _creating.payload = {};                       // reset payload (champs ≠)
      const def = QR_TYPES[newType];
      if (!def.supports.dynamic && _creating.mode === 'dynamic') {
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
  const dynDisabled = !def?.supports?.dynamic;
  wrap.querySelectorAll('.sdqr-mode-btn').forEach(btn => {
    const mode = btn.dataset.mode;
    btn.classList.toggle('is-active', _creating.mode === mode);
    if (mode === 'dynamic') {
      btn.disabled = dynDisabled;
      btn.title    = dynDisabled ? `Le type ${def?.label} n'existe qu'en mode statique.` : '';
    }
    btn.onclick = () => {
      if (btn.disabled) return;
      _creating.mode = mode;
      _renderModeToggle(root);
    };
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
  // Bind change listeners
  wrap.querySelectorAll('[data-payload-key]').forEach(el => {
    el.addEventListener('input', () => {
      const k = el.dataset.payloadKey;
      _creating.payload[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
    el.addEventListener('change', () => {
      const k = el.dataset.payloadKey;
      _creating.payload[k] = el.type === 'checkbox' ? el.checked : el.value;
    });
  });
  // Toggle password visibility (œil)
  wrap.querySelectorAll('.sdqr-pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.sdqr-pw-wrap')?.querySelector('input');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

function _renderField(f) {
  const span = f.span === 'full' ? ' sdqr-field--full' : '';
  const req  = f.required ? ' <span class="sdqr-req">*</span>' : '';
  const val  = _esc(_creating.payload[f.id] ?? f.default ?? '');
  const ph   = _esc(f.placeholder || '');

  let input = '';
  if (f.type === 'textarea') {
    input = `<textarea data-payload-key="${f.id}" class="sdqr-input sdqr-input--textarea" placeholder="${ph}">${val}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(o =>
      `<option value="${_esc(o)}" ${o === val ? 'selected' : ''}>${_esc(o)}</option>`
    ).join('');
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
    // Mode dynamique URL : target_url = la valeur du champ url
    if (_creating.mode === 'dynamic' && _creating.type === 'url') {
      body.target_url = _creating.payload.url || '';
    }
    // Mode dynamique non-URL : on pre-encode cote client et on envoie
    // la string finale (le Worker stocke dans qr_redirects.encoded_payload
    // pour servir le bon contenu au scan).
    if (_creating.mode === 'dynamic' && _creating.type !== 'url') {
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
    const opts = (f.options || []).map(o =>
      `<option value="${_esc(o)}" ${o === (currentValue ?? f.default) ? 'selected' : ''}>${_esc(o)}</option>`
    ).join('');
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

  // Reset l'etat d edition du design quand on switche de QR.
  // _wireDesignPanel le ré-initialisera depuis qr.design lors du premier
  // wire ; les refresh DOM ultérieurs (upload logo) le preserveront.
  _editingDesign = null;

  const isDynamic   = (qr.mode || 'dynamic') === 'dynamic';
  const typeDef     = QR_TYPES[qr.qr_type] || QR_TYPES.url;
  const redirectUrl = qr.short_id ? `${CF_API}/r/${qr.short_id}` : '';
  // Ce qui est encodé dans les pixels :
  //   - dynamic URL → l'URL de redirect
  //   - static *    → le payload encodé (vcard, wifi, ical, text, url direct)
  const encodedForQr = isDynamic && qr.qr_type === 'url'
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
            <span class="sdqr-detail-shortid-lbl">${isDynamic ? 'URL de redirection' : 'Contenu encodé'}</span>
            <code class="sdqr-detail-shortid-val">${_esc(isDynamic ? redirectUrl : (encodedForQr.length > 200 ? encodedForQr.slice(0, 200) + '…' : encodedForQr))}</code>
            <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-copy-payload">Copier</button>
          </div>
          <!-- SDQR-3 : Export PNG / SVG haute résolution pour impression -->
          <div class="sdqr-export-row">
            <span class="sdqr-detail-shortid-lbl">Télécharger</span>
            <div class="sdqr-export-btns">
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="png-1024" title="Web, document A4">PNG 1024px</button>
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="png-2048" title="Impression standard, bâche moyenne">PNG 2048px</button>
              <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" data-export="svg" title="Vectoriel illimité — impression haut de gamme, bâche grand format">SVG</button>
            </div>
          </div>
        </div>
        ${_renderDesignPanel(qr)}
      </div>
      <div class="sdqr-detail-right">
        <label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">Nom interne</span>
          <input type="text" id="sdqr-edit-name" class="sdqr-input sdqr-input--title" value="${_esc(qr.name || '')}" placeholder="Nom interne…">
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-save-name" title="Renommer ce QR">Renommer</button>
        </label>

        <div class="sdqr-detail-meta">
          <span class="sdqr-detail-pill">${typeDef.icon} ${_esc(typeDef.label)}</span>
          <span class="sdqr-detail-pill ${isDynamic ? 'sdqr-detail-pill--dyn' : 'sdqr-detail-pill--stat'}">${isDynamic ? 'Dynamique' : 'Statique'}</span>
          <span class="sdqr-detail-pill ${qr.status === 'archived' ? 'sdqr-detail-pill--off' : ''}">${qr.status === 'archived' ? 'Archivé' : 'Actif'}</span>
          ${isDynamic ? `<span class="sdqr-detail-stat">${qr.scans_total || 0} scan(s)</span>` : ''}
        </div>

        ${summary ? `<div class="sdqr-detail-summary">${_esc(summary)}</div>` : ''}

        ${isDynamic && qr.qr_type === 'url' ? `
        <label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">URL de destination</span>
          <input type="url" id="sdqr-edit-url" class="sdqr-input" value="${_esc(qr.target_url || '')}">
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-save-url" title="Modifier la cible sans regénérer le QR">Mettre à jour</button>
        </label>
        <div class="sdqr-detail-notice">
          <strong>Édition dynamique :</strong> tu peux changer la cible à tout moment. Le QR imprimé reste valable, la redirection bascule instantanément.
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

        <div class="sdqr-detail-actions">
          <button class="sdqr-btn sdqr-btn--ghost" id="sdqr-archive">${qr.status === 'archived' ? 'Réactiver' : 'Archiver'}</button>
          ${isDynamic ? `<a class="sdqr-btn sdqr-btn--ghost" href="${_esc(redirectUrl)}" target="_blank" rel="noopener noreferrer">Tester le scan ↗</a>` : ''}
          ${qr.status === 'archived' ? `<button class="sdqr-btn sdqr-btn--danger" id="sdqr-delete" title="Suppression définitive (les scans historiques sont conservés)">Supprimer définitivement</button>` : ''}
        </div>

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
    navigator.clipboard.writeText(isDynamic ? redirectUrl : encodedForQr).then(() => {
      const b = content.querySelector('#sdqr-copy-payload');
      if (b) { b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); }
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

  // Supprimer définitivement (uniquement si archivé — verrou côté API aussi)
  content.querySelector('#sdqr-delete')?.addEventListener('click', async () => {
    if (!confirm(`Supprimer définitivement "${qr.name}" ?\n\n• Le QR ne pourra plus rediriger.\n• Les statistiques historiques (scans) sont conservées pour audit.\n• Cette action est irréversible.`)) return;
    const msg = content.querySelector('#sdqr-detail-msg');
    try {
      await _apiDelete(qr.id);
      _selectedId = null;
      await _refreshList(panel);
      panel.querySelector('#sdqr-content').innerHTML = _renderEmptyStudio();
      panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
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

    const pngBlob = await new Promise((res, rej) => {
      canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png');
    });
    _triggerDownload(pngBlob, `${_slug(qr.name)}-${qr.short_id || qr.id.slice(0, 8)}-${sizePx}.png`);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
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
const SHAPE_OPTS = [
  { id: 'square',  label: 'Carré',   svg: `<rect x="4" y="4" width="14" height="14"/>` },
  { id: 'dot',     label: 'Point',   svg: `<circle cx="11" cy="11" r="7"/>` },
  { id: 'rounded', label: 'Arrondi', svg: `<rect x="4" y="4" width="14" height="14" rx="4" ry="4"/>` },
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

function _renderDesignPanel(qr) {
  const d = mergeDesign(qr.design);
  return `
    <details class="sdqr-design-panel" id="sdqr-design-panel">
      <summary class="sdqr-design-summary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2a10 10 0 1 0 10 10c0-2.74-2.84-3.18-5-3.5"/></svg>
        Personnaliser le design
        <span class="sdqr-design-arrow">▾</span>
      </summary>
      <div class="sdqr-design-body">

        <!-- THÈMES prêts à l'emploi (1-clic) + Surprise -->
        <div class="sdqr-design-section">
          <div class="sdqr-design-section-head">
            <span class="sdqr-design-section-title">Thèmes prêts à l'emploi</span>
            <button class="sdqr-surprise-btn" data-action="surprise" title="Génère un design aléatoire">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M5 3v4"/><path d="M3 5h4"/><path d="M6 17v4"/><path d="M4 19h4"/><path d="M13 3l1.5 4.5L19 9l-4.5 1.5L13 15l-1.5-4.5L7 9l4.5-1.5L13 3z"/></svg>
              Surprends-moi
            </button>
          </div>
          <div class="sdqr-theme-cards">
            ${THEME_PRESETS.map(t => _renderThemeCard(t)).join('')}
          </div>
        </div>

        <!-- FORMES (modules + ancres) avec mini-aperçus visuels -->
        <div class="sdqr-design-section">
          <div class="sdqr-design-section-title">Formes</div>
          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Modules</span>
            <div class="sdqr-shape-pills" data-shape-target="module">
              ${SHAPE_OPTS.map(s => _renderShapePill(s, d.module.shape === s.id)).join('')}
            </div>
          </div>
          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Ancres · anneau</span>
            <div class="sdqr-shape-pills" data-shape-target="anchor-outer">
              ${ANCHOR_OUTER_OPTS.map(s => _renderShapePill(s, d.anchor.outer.shape === s.id)).join('')}
            </div>
          </div>
          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Ancres · centre</span>
            <div class="sdqr-shape-pills" data-shape-target="anchor-inner">
              ${ANCHOR_INNER_OPTS.map(s => _renderShapePill(s, d.anchor.inner.shape === s.id)).join('')}
            </div>
          </div>
        </div>

        <!-- COULEURS : palettes + custom -->
        <div class="sdqr-design-section">
          <div class="sdqr-design-section-title">Couleurs</div>
          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Palettes</span>
            <div class="sdqr-color-swatches">
              ${COLOR_PRESETS.map(p => `
                <button class="sdqr-color-swatch" data-color-preset="${p.id}" title="${_esc(p.label)}">
                  <span class="sdqr-color-swatch-preview" style="background:${p.gradient
                    ? `linear-gradient(${p.gradient.angle}deg, ${p.gradient.from}, ${p.gradient.to})`
                    : p.fg}; border: 2px solid ${p.bg};"></span>
                  <span class="sdqr-color-swatch-lbl">${_esc(p.label)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="sdqr-design-row">
            <span class="sdqr-design-lbl">Mode</span>
            <div class="sdqr-shape-pills" data-color-mode>
              <button class="sdqr-shape-pill ${!d.gradient.enabled ? 'is-active' : ''}" data-mode="solid">Unie</button>
              <button class="sdqr-shape-pill ${d.gradient.enabled ? 'is-active' : ''}" data-mode="gradient">Dégradé</button>
            </div>
          </div>

          <div class="sdqr-design-row sdqr-design-row--colors" data-when-solid hidden="${d.gradient.enabled ? 'hidden' : ''}">
            <label class="sdqr-color-field">
              <span class="sdqr-design-lbl-sm">Couleur</span>
              <input type="color" id="sdqr-color-fg" value="${_esc(d.fg)}">
            </label>
            <label class="sdqr-color-field">
              <span class="sdqr-design-lbl-sm">Fond</span>
              <input type="color" id="sdqr-color-bg" value="${_esc(d.bg)}">
            </label>
          </div>

          <div class="sdqr-design-row sdqr-design-row--colors" data-when-gradient hidden="${d.gradient.enabled ? '' : 'hidden'}">
            <label class="sdqr-color-field">
              <span class="sdqr-design-lbl-sm">Départ</span>
              <input type="color" id="sdqr-grad-from" value="${_esc(d.gradient.from)}">
            </label>
            <label class="sdqr-color-field">
              <span class="sdqr-design-lbl-sm">Fin</span>
              <input type="color" id="sdqr-grad-to" value="${_esc(d.gradient.to)}">
            </label>
            <label class="sdqr-color-field">
              <span class="sdqr-design-lbl-sm">Fond</span>
              <input type="color" id="sdqr-color-bg-grad" value="${_esc(d.bg)}">
            </label>
          </div>

          <div class="sdqr-design-row" data-when-gradient hidden="${d.gradient.enabled ? '' : 'hidden'}">
            <span class="sdqr-design-lbl">Angle</span>
            <div class="sdqr-slider-wrap">
              <input type="range" id="sdqr-grad-angle" min="0" max="360" step="5" value="${d.gradient.angle}">
              <span class="sdqr-slider-val" id="sdqr-grad-angle-val">${d.gradient.angle}°</span>
            </div>
          </div>
        </div>

        <!-- LOGO central avec zone drop visible -->
        <div class="sdqr-design-section">
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
                <span class="sdqr-logo-zone-text"><strong>Glisse une image ici</strong> ou clique<br><small>PNG · JPEG · SVG · max 500 Ko</small></span>
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
function _renderThemeCard(theme) {
  const color = COLOR_PRESETS.find(c => c.id === theme.color);
  const fill = color.gradient
    ? `url(#g-${theme.id})`
    : color.fg;
  const grad = color.gradient
    ? `<defs><linearGradient id="g-${theme.id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${color.gradient.from}"/><stop offset="100%" stop-color="${color.gradient.to}"/></linearGradient></defs>`
    : '';

  // Modules : 3 points centraux selon la forme
  const moduleShape = SHAPE_OPTS.find(s => s.id === theme.module).svg;
  const outerShape  = ANCHOR_OUTER_OPTS.find(s => s.id === theme.outer).svg;
  const innerShape  = ANCHOR_INNER_OPTS.find(s => s.id === theme.inner).svg;

  return `
    <button class="sdqr-theme-card" data-theme="${theme.id}">
      <div class="sdqr-theme-preview" style="background:${color.bg}">
        <svg viewBox="0 0 60 60" class="sdqr-theme-svg">
          ${grad}
          <g fill="${fill}" stroke="${fill}">
            <!-- Ancre TL (top-left) miniaturisée -->
            <g transform="translate(2,2) scale(0.55)">${outerShape}${innerShape}</g>
            <!-- Ancre TR -->
            <g transform="translate(38,2) scale(0.55)">${outerShape}${innerShape}</g>
            <!-- Ancre BL -->
            <g transform="translate(2,38) scale(0.55)">${outerShape}${innerShape}</g>
            <!-- 3 modules au centre -->
            <g transform="translate(26,26) scale(0.4)">${moduleShape}</g>
            <g transform="translate(35,32) scale(0.4)">${moduleShape}</g>
            <g transform="translate(28,40) scale(0.4)">${moduleShape}</g>
            <g transform="translate(40,42) scale(0.4)">${moduleShape}</g>
            <g transform="translate(22,34) scale(0.4)">${moduleShape}</g>
          </g>
        </svg>
      </div>
      <div class="sdqr-theme-label">${_esc(theme.label)}</div>
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

  // Couleurs unies
  panel.querySelector('#sdqr-color-fg')?.addEventListener('input', e => { _editingDesign.fg = e.target.value; _liveRerender(); });
  panel.querySelector('#sdqr-color-bg')?.addEventListener('input', e => { _editingDesign.bg = e.target.value; _liveRerender(); });

  // Couleurs gradient
  panel.querySelector('#sdqr-grad-from')?.addEventListener('input', e => { _editingDesign.gradient.from = e.target.value; _liveRerender(); });
  panel.querySelector('#sdqr-grad-to')?.addEventListener('input', e => { _editingDesign.gradient.to = e.target.value; _liveRerender(); });
  panel.querySelector('#sdqr-color-bg-grad')?.addEventListener('input', e => { _editingDesign.bg = e.target.value; _liveRerender(); });

  // Angle dégradé
  panel.querySelector('#sdqr-grad-angle')?.addEventListener('input', e => {
    _editingDesign.gradient.angle = parseInt(e.target.value, 10);
    const valEl = panel.querySelector('#sdqr-grad-angle-val');
    if (valEl) valEl.textContent = _editingDesign.gradient.angle + '°';
    _liveRerender();
  });

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
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ …';
    try {
      await _apiUpdate(qr.id, { design: _editingDesign });
      qr.design = { ..._editingDesign };
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

function _updateContrastBadge(root) {
  const el = root.querySelector('#sdqr-contrast');
  if (!el || !_editingDesign) return;
  const fg = _editingDesign.gradient.enabled ? _editingDesign.gradient.from : _editingDesign.fg;
  const bg = _editingDesign.bg;
  if (!fg || !bg || bg === 'transparent') { el.innerHTML = ''; return; }
  const ratio = contrastRatio(fg, bg);
  const level = contrastLevel(fg, bg);
  const labels = {
    ok  : `Contraste excellent (${ratio.toFixed(1)}:1) — scannabilité optimale`,
    warn: `Contraste limite (${ratio.toFixed(1)}:1) — certains scanners pourront peiner`,
    bad : `Contraste insuffisant (${ratio.toFixed(1)}:1) — le QR risque d'être illisible`,
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
