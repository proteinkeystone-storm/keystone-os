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

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';

let _qrLib       = null;       // lazy import
let _cachedQrs   = [];         // dernière liste reçue
let _currentView = 'studio';   // 'studio' | 'stats'
let _selectedId  = null;       // QR sélectionné dans la sidebar
let _busy        = false;      // anti-double-click

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

// ══════════════════════════════════════════════════════════════════
// API client
// ══════════════════════════════════════════════════════════════════

async function _apiList() {
  const r = await fetch(`${CF_API}/api/qr`, {
    headers: { 'X-Tenant-Id': _tenantId() },
  });
  if (!r.ok) throw new Error('API list error ' + r.status);
  const body = await r.json();
  return body.qrs || [];
}

async function _apiCreate(payload) {
  const r = await fetch(`${CF_API}/api/qr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': _tenantId() },
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
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': _tenantId() },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'API update error ' + r.status);
  }
  return (await r.json()).qr;
}

// ══════════════════════════════════════════════════════════════════
// QR SVG rendering (basic, sans design custom — Sprint SDQR-3)
// ══════════════════════════════════════════════════════════════════

async function _renderQrSvg(text, sizePx = 220) {
  const qrcode = await _loadQrLib();
  // typeNumber:0 = auto, errorCorrectionLevel:'M' = robuste sans pénalité
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const cellSize = Math.floor(sizePx / qr.getModuleCount());
  const margin   = cellSize * 2;
  return qr.createSvgTag({ cellSize, margin, scalable: true });
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
        <span class="sdqr-pill" title="Sprint actuel">Sprint 1 — Foundation</span>
        <span class="sdqr-pill sdqr-pill--ok" title="Souveraineté : aucune donnée tierce">Souverain · RGPD</span>
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
        <div class="sdqr-sidebar-list" id="sdqr-list">
          <div class="sdqr-empty-mini">Chargement…</div>
        </div>
      </aside>

      <main class="sdqr-main">
        <div class="sdqr-tabs">
          <button class="sdqr-tab active" data-view="studio">Studio</button>
          <button class="sdqr-tab sdqr-tab--soon" data-view="stats" disabled title="Disponible Sprint SDQR-4">Statistiques · à venir</button>
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
      // Sprint SDQR-4 : router vers _renderStats
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// Sidebar — liste des QRs
// ══════════════════════════════════════════════════════════════════

async function _refreshList(panel) {
  const listEl = panel.querySelector('#sdqr-list');
  if (!listEl) return;
  try {
    _cachedQrs = await _apiList();
  } catch (e) {
    listEl.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur : ${_esc(e.message)}</div>`;
    return;
  }
  if (_cachedQrs.length === 0) {
    listEl.innerHTML = `<div class="sdqr-empty-mini">Aucun QR pour l'instant.</div>`;
    return;
  }
  listEl.innerHTML = _cachedQrs.map(q => {
    const tags = (q.tags || []).slice(0, 3).map(t => `<span class="sdqr-li-tag">${_esc(t)}</span>`).join('');
    const isSel = q.id === _selectedId;
    return `
      <button class="sdqr-li ${isSel ? 'is-selected' : ''}" data-qr-id="${_esc(q.id)}">
        <div class="sdqr-li-hd">
          <span class="sdqr-li-name">${_esc(q.name || '(sans nom)')}</span>
          <span class="sdqr-li-scans" title="Scans totaux">${q.scans_total || 0}</span>
        </div>
        <div class="sdqr-li-meta">
          <span class="sdqr-li-type">${_esc(q.qr_type || 'url')}</span>
          ${q.status === 'archived' ? '<span class="sdqr-li-status">Archivé</span>' : ''}
        </div>
        ${tags ? `<div class="sdqr-li-tags">${tags}</div>` : ''}
      </button>
    `;
  }).join('');
  listEl.querySelectorAll('[data-qr-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      _selectedId = btn.dataset.qrId;
      _refreshList(panel);
      _openQrDetail(panel, _cachedQrs.find(q => q.id === _selectedId));
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
  content.innerHTML = `
    <div class="sdqr-form-wrap">
      <div class="sdqr-form-head">
        <h2 class="sdqr-form-title">Nouveau QR dynamique</h2>
        <p class="sdqr-form-sub">URL modifiable après création. Sprint 1 → seul le type "URL" est dispo. Plus de types au Sprint 2 (VCard, Wi-Fi, iCal…).</p>
      </div>
      <div class="sdqr-form-grid">
        <label class="sdqr-field">
          <span class="sdqr-field-lbl">Nom interne <span class="sdqr-req">*</span></span>
          <input type="text" id="sdqr-f-name" class="sdqr-input" placeholder="ex: Bâche chantier Azur — Avancement">
        </label>
        <label class="sdqr-field">
          <span class="sdqr-field-lbl">URL de destination <span class="sdqr-req">*</span></span>
          <input type="url" id="sdqr-f-url" class="sdqr-input" placeholder="https://…">
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
  content.querySelector('#sdqr-cancel')?.addEventListener('click', () => {
    content.innerHTML = _renderEmptyStudio();
    panel.querySelector('#sdqr-cta-new')?.addEventListener('click', () => _openCreateForm(panel));
  });
  content.querySelector('#sdqr-save')?.addEventListener('click', () => _handleCreate(panel));
}

async function _handleCreate(panel) {
  if (_busy) return;
  const name = panel.querySelector('#sdqr-f-name')?.value.trim();
  const url  = panel.querySelector('#sdqr-f-url')?.value.trim();
  const tags = (panel.querySelector('#sdqr-f-tags')?.value || '')
                  .split(',').map(s => s.trim()).filter(Boolean);
  const msg  = panel.querySelector('#sdqr-msg');

  if (!name || !url) {
    if (msg) { msg.hidden = false; msg.textContent = 'Nom et URL obligatoires.'; msg.className = 'sdqr-form-msg sdqr-form-msg--err'; }
    return;
  }

  _busy = true;
  const btn = panel.querySelector('#sdqr-save');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création…'; }

  try {
    const qr = await _apiCreate({
      name, target_url: url, tags, type: 'url',
    });
    _selectedId = qr.id;
    await _refreshList(panel);
    _openQrDetail(panel, { ...qr, target_url: url, scans_total: 0 });
  } catch (e) {
    if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-form-msg sdqr-form-msg--err'; }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg> Créer le QR'; }
  } finally {
    _busy = false;
  }
}

async function _openQrDetail(panel, qr) {
  const content = panel.querySelector('#sdqr-content');
  if (!content || !qr) return;

  const redirectUrl = `${CF_API}/r/${qr.short_id}`;

  content.innerHTML = `
    <div class="sdqr-detail">
      <div class="sdqr-detail-left">
        <div class="sdqr-detail-card">
          <div class="sdqr-detail-svg" id="sdqr-svg-wrap">
            <div class="sdqr-empty-mini">Génération…</div>
          </div>
          <div class="sdqr-detail-shortid">
            <span class="sdqr-detail-shortid-lbl">URL de redirection</span>
            <code class="sdqr-detail-shortid-val">${_esc(redirectUrl)}</code>
            <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-copy-url">Copier</button>
          </div>
        </div>
      </div>
      <div class="sdqr-detail-right">
        <div class="sdqr-detail-name">${_esc(qr.name || '(sans nom)')}</div>
        <div class="sdqr-detail-meta">
          <span class="sdqr-detail-pill">${_esc(qr.qr_type || 'url')}</span>
          <span class="sdqr-detail-pill ${qr.status === 'archived' ? 'sdqr-detail-pill--off' : ''}">${qr.status === 'archived' ? 'Archivé' : 'Actif'}</span>
          <span class="sdqr-detail-stat">${qr.scans_total || 0} scan(s)</span>
        </div>

        <label class="sdqr-field sdqr-field--inline">
          <span class="sdqr-field-lbl">URL de destination</span>
          <input type="url" id="sdqr-edit-url" class="sdqr-input" value="${_esc(qr.target_url || '')}">
          <button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-save-url" title="Modifier la cible sans regénérer le QR">Mettre à jour</button>
        </label>

        <div class="sdqr-detail-notice">
          <strong>Édition dynamique :</strong> tu peux changer la cible à tout moment. Le QR imprimé reste valable, la redirection bascule instantanément.
        </div>

        <div class="sdqr-detail-actions">
          <button class="sdqr-btn sdqr-btn--ghost" id="sdqr-archive">${qr.status === 'archived' ? 'Réactiver' : 'Archiver'}</button>
          <a class="sdqr-btn sdqr-btn--ghost" href="${_esc(redirectUrl)}" target="_blank" rel="noopener noreferrer">Tester le scan ↗</a>
        </div>

        <div class="sdqr-detail-msg" id="sdqr-detail-msg" hidden></div>
      </div>
    </div>
  `;

  // Render le QR SVG (async — qrcode-generator CDN)
  try {
    const svg = await _renderQrSvg(redirectUrl, 280);
    const wrap = content.querySelector('#sdqr-svg-wrap');
    if (wrap) wrap.innerHTML = svg;
  } catch (e) {
    const wrap = content.querySelector('#sdqr-svg-wrap');
    if (wrap) wrap.innerHTML = `<div class="sdqr-empty-mini sdqr-empty-mini--err">Erreur rendu QR : ${_esc(e.message)}</div>`;
  }

  // Bindings actions
  content.querySelector('#sdqr-copy-url')?.addEventListener('click', () => {
    navigator.clipboard.writeText(redirectUrl).then(() => {
      const b = content.querySelector('#sdqr-copy-url');
      if (b) { b.textContent = '✓ Copié'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); }
    });
  });

  content.querySelector('#sdqr-save-url')?.addEventListener('click', async () => {
    const newUrl = content.querySelector('#sdqr-edit-url')?.value.trim();
    const msg = content.querySelector('#sdqr-detail-msg');
    if (!newUrl) return;
    try {
      await _apiUpdate(qr.id, { target_url: newUrl });
      if (msg) { msg.hidden = false; msg.textContent = '✓ Cible mise à jour'; msg.className = 'sdqr-detail-msg sdqr-detail-msg--ok'; }
      qr.target_url = newUrl;
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });

  content.querySelector('#sdqr-archive')?.addEventListener('click', async () => {
    const next = qr.status === 'archived' ? 'active' : 'archived';
    try {
      await _apiUpdate(qr.id, { status: next });
      await _refreshList(panel);
      _openQrDetail(panel, { ...qr, status: next });
    } catch (e) {
      const msg = content.querySelector('#sdqr-detail-msg');
      if (msg) { msg.hidden = false; msg.textContent = e.message; msg.className = 'sdqr-detail-msg sdqr-detail-msg--err'; }
    }
  });
}

// ── Utilitaire HTML escape (XSS-safe) ──────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
