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

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';

let _qrLib       = null;       // lazy import (legacy createSvgTag fallback)
let _cachedQrs   = [];         // dernière liste reçue
let _currentView = 'studio';   // 'studio' | 'stats'
let _selectedId  = null;       // QR sélectionné dans la sidebar
let _busy        = false;      // anti-double-click

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

async function _apiDelete(id) {
  const r = await fetch(`${CF_API}/api/qr/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Tenant-Id': _tenantId() },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'API delete error ' + r.status);
  }
  return true;
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
      await _apiUpdate(qr.id, { target_url: newUrl });
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
          await _apiUpdate(qr.id, { payload: editingPayload, encoded_payload: newEncoded });
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
      await _apiUpdate(qr.id, { status: next });
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
      await _apiUpdate(qr.id, { name: newName });
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
// SPRINT SDQR-3 — Studio Design (panneau collapsible sous le QR)
// ══════════════════════════════════════════════════════════════════
// Contrôles : forme modules, forme ancres, couleur foreground + bg,
// dégradé linéaire 2 stops + angle, logo central (upload + taille),
// contrast checker temps réel. Live preview à chaque changement.
//
// Persistance : bouton "Sauvegarder le design" → PATCH /api/qr/:id
// { design: {...} }. Le détail est ensuite re-rendu pour refresh
// la liste sidebar (les vignettes pourraient utiliser le design plus tard).

const SHAPE_OPTS = [
  { id: 'square',  label: 'Carré' },
  { id: 'dot',     label: 'Point' },
  { id: 'rounded', label: 'Arrondi' },
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

        <!-- Formes -->
        <div class="sdqr-design-row">
          <span class="sdqr-design-lbl">Modules</span>
          <div class="sdqr-shape-pills" data-shape-target="module">
            ${SHAPE_OPTS.map(s => `<button class="sdqr-shape-pill ${d.module.shape === s.id ? 'is-active' : ''}" data-shape="${s.id}">${s.label}</button>`).join('')}
          </div>
        </div>
        <div class="sdqr-design-row">
          <span class="sdqr-design-lbl">Ancres</span>
          <div class="sdqr-shape-pills" data-shape-target="anchor">
            ${SHAPE_OPTS.map(s => `<button class="sdqr-shape-pill ${d.anchor.shape === s.id ? 'is-active' : ''}" data-shape="${s.id}">${s.label}</button>`).join('')}
          </div>
        </div>

        <!-- Couleurs -->
        <div class="sdqr-design-row">
          <span class="sdqr-design-lbl">Mode couleur</span>
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

        <!-- Logo -->
        <div class="sdqr-design-row">
          <span class="sdqr-design-lbl">Logo central</span>
          <div class="sdqr-logo-controls">
            ${d.logo.dataUrl ? `<div class="sdqr-logo-thumb"><img src="${_esc(d.logo.dataUrl)}" alt=""></div>` : ''}
            <label class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" style="cursor:pointer">
              ${d.logo.dataUrl ? 'Remplacer' : '+ Ajouter une image'}
              <input type="file" id="sdqr-logo-input" accept="image/png,image/jpeg,image/svg+xml" hidden>
            </label>
            ${d.logo.dataUrl ? `<button class="sdqr-btn sdqr-btn--ghost sdqr-btn--xs" id="sdqr-logo-remove">Retirer</button>` : ''}
          </div>
        </div>

        ${d.logo.dataUrl ? `
        <div class="sdqr-design-row">
          <span class="sdqr-design-lbl">Taille logo</span>
          <div class="sdqr-slider-wrap">
            <input type="range" id="sdqr-logo-size" min="10" max="30" step="1" value="${Math.round(d.logo.size * 100)}">
            <span class="sdqr-slider-val" id="sdqr-logo-size-val">${Math.round(d.logo.size * 100)}%</span>
          </div>
        </div>
        ` : ''}

        <!-- Contrast checker + actions -->
        <div class="sdqr-design-foot">
          <div class="sdqr-contrast" id="sdqr-contrast"></div>
          <button class="sdqr-btn sdqr-btn--primary sdqr-btn--xs" id="sdqr-save-design">Sauvegarder le design</button>
        </div>
      </div>
    </details>
  `;
}

// État live du design pendant l'édition (avant save). Reset à chaque
// ouverture de panel.
let _editingDesign = null;

function _wireDesignPanel(root, qr, encodedForQr) {
  const panel = root.querySelector('#sdqr-design-panel');
  if (!panel) return;
  _editingDesign = mergeDesign(qr.design);

  const _liveRerender = async () => {
    try {
      const svg = await renderQrCustom(encodedForQr, _editingDesign, 280);
      const wrap = root.querySelector('#sdqr-svg-wrap');
      if (wrap) wrap.innerHTML = svg;
    } catch (e) { console.error('[sdqr-design] render', e); }
    _updateContrastBadge(root);
  };

  // Pills formes (modules / ancres)
  panel.querySelectorAll('[data-shape-target]').forEach(group => {
    const target = group.dataset.shapeTarget;
    group.querySelectorAll('.sdqr-shape-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        _editingDesign[target].shape = btn.dataset.shape;
        group.querySelectorAll('.sdqr-shape-pill').forEach(b => b.classList.toggle('is-active', b === btn));
        _liveRerender();
      });
    });
  });

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

  // Logo upload
  panel.querySelector('#sdqr-logo-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert('Image trop lourde — max 500 Ko. Optimise via TinyPNG/Squoosh.');
      return;
    }
    const dataUrl = await _fileToDataUrl(file);
    _editingDesign.logo.dataUrl = dataUrl;
    if (!_editingDesign.logo.size) _editingDesign.logo.size = 0.20;
    _liveRerender();
    // Re-render le panel pour afficher le thumb + le slider taille
    _refreshDesignPanelDom(root, qr, encodedForQr);
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
