/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Admin Panel · src/admin.js v4.0
   La Fabrique — Sprint Rectif : Preview WYSIWYG, Drag & Drop,
   Schema live, Sandbox JSON
   ═══════════════════════════════════════════════════════════════ */

import { renderArtifactResult } from './artifact-renderer.js';

// ── Engine Registry ────────────────────────────────────────────
const ENGINES = [
  { id: 'claude',     label: 'Claude',     color: '#c9a84c',
    hint: 'Structure XML. Balises <contexte>, <données_client>, <instructions>. Ton Luxe/Sobre. Excellent pour les rédactions contractuelles.' },
  { id: 'gpt4o',      label: 'GPT-4o',     color: '#74aa9c',
    hint: 'Chain-of-Thought. "Analyse d\'abord les points forts, puis rédige…" Instructions séquentielles étape par étape.' },
  { id: 'gemini',     label: 'Gemini',     color: '#4285f4',
    hint: 'Input massif multi-documents. Extraction de données brutes. Fenêtre de contexte étendue — idéal pour analyser des dossiers complets.' },
  { id: 'mistral',    label: 'Mistral',    color: '#ff7000',
    hint: 'Concision + Bullet points. Instructions courtes et directes. Éviter les longs paragraphes. Idéal pour les fiches descriptives rapides.' },
  { id: 'perplexity', label: 'Perplexity', color: '#20b2aa',
    hint: 'Requête d\'investigation sourcée. "Trouve les dernières données sur…" Citations et sources attendues en sortie.' },
  { id: 'grok',       label: 'Grok',       color: '#aaaaaa',
    hint: 'Formatage strict JSON/Tableaux. Direct et sans langue de bois. Toujours préciser le format de sortie attendu explicitement.' },
];

// ── Artifact Component Library ─────────────────────────────────
const ARTIFACT_COMPONENTS = [
  {
    id: 'gauge',
    label: 'Jauge',
    icon: '◎',
    desc: 'Score ou pourcentage animé',
    jsonType: 'number',
    example: '85',
    configFields: [
      { id: 'min',   label: 'Min',    type: 'number', default: '0' },
      { id: 'max',   label: 'Max',    type: 'number', default: '100' },
      { id: 'unit',  label: 'Unité',  type: 'text',   default: 'pts' },
      { id: 'color', label: 'Couleur',type: 'color',  default: '#c9a84c' },
    ],
  },
  {
    id: 'status_badge',
    label: 'Pastille',
    icon: '◉',
    desc: 'État discret (ex: Faible / Moyen / Élevé)',
    jsonType: 'string',
    example: '"Moyen"',
    configFields: [
      { id: 'values', label: 'Valeurs (virgules)', type: 'text', default: 'Faible, Moyen, Élevé' },
    ],
  },
  {
    id: 'rich_text',
    label: 'Texte',
    icon: '¶',
    desc: 'Bloc de texte long formaté',
    jsonType: 'string',
    example: '"Analyse approfondie du terrain..."',
    configFields: [],
  },
  {
    id: 'key_points_list',
    label: 'Points Clés',
    icon: '◆',
    desc: 'Liste de points (tableau JSON)',
    jsonType: 'array',
    example: '["Point A", "Point B"]',
    configFields: [
      { id: 'tone', label: 'Tonalité', type: 'select',
        options: ['positif', 'négatif', 'neutre'], default: 'positif' },
    ],
  },
  {
    id: 'data_card',
    label: 'Chiffre Clé',
    icon: '◈',
    desc: 'Valeur numérique avec unité',
    jsonType: 'number',
    example: '4250',
    configFields: [
      { id: 'unit',   label: 'Unité',   type: 'text', default: '€/m²' },
      { id: 'prefix', label: 'Préfixe', type: 'text', default: '' },
    ],
  },
];

const TOOL_FIELD_TYPES = ['text', 'textarea', 'select', 'number'];
const CATEGORIES       = ['IMM', 'COM', 'PRD', 'ANL', 'ADM'];

const ICON_MAP = {
  vefa: '📋', ad: '📢', mail: '✉️', social: '📱', brief: '📸',
  site: '🏗', foncier: '🌍', chat: '💬', calc: '🧮', zap: '⚡',
  table: '📊', default: '⚙️',
};

// ── API Base URL (Cloudflare Worker) ──────────────────────────
// En développement local (localhost), les appels restent relatifs.
// En production, toutes les requêtes API pointent vers le Worker CF.
const CF_WORKER_URL = 'https://keystone-os-api.keystone-os.workers.dev';
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''           // dev local → chemin relatif (proxy ou wrangler dev)
  : CF_WORKER_URL; // production → Worker Cloudflare

// ── State ──────────────────────────────────────────────────────
let adminToken   = localStorage.getItem('ks_admin_token') || '';
let catalogData  = null;
let padsCache    = {};
let editingPadId = null;
let _dragSrc     = null;

// ── DOM refs ───────────────────────────────────────────────────
const loginScreen  = document.getElementById('login-screen');
const adminScreen  = document.getElementById('admin-screen');
const loginBtn     = document.getElementById('login-btn');
const logoutBtn    = document.getElementById('logout-btn');
const secretInput  = document.getElementById('secret-input');
const loginError   = document.getElementById('login-error');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle   = document.getElementById('modal-title');
const modalBody    = document.getElementById('modal-body');
const modalFooter  = document.getElementById('modal-footer');
const modalClose   = document.getElementById('modal-close');
const toastEl      = document.getElementById('toast');

// ── Utils ──────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function slugify(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
async function fetchJSON(url) {
  const res = await fetch(`${url}?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
  return res.json();
}
function iconEmoji(name) { return ICON_MAP[name] || ICON_MAP.default; }

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `show ${type}`;
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3500);
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(title, bodyHTML, footerHTML = '') {
  modalTitle.textContent = title;
  modalBody.innerHTML    = bodyHTML;
  modalFooter.innerHTML  = footerHTML;
  modalOverlay.classList.remove('hidden');
}
function closeModal() { modalOverlay.classList.add('hidden'); }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── API helper ─────────────────────────────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res  = await fetch(`${API_BASE}${endpoint}`, opts);
  if (res.status === 401) { logout(); throw new Error('Session expirée'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════
async function tryLogin() {
  const secret = secretInput.value.trim();
  if (!secret) return;
  loginBtn.disabled = true; loginBtn.textContent = '…';
  loginError.textContent = '';
  const prev = adminToken; adminToken = secret;
  try {
    await api('/api/licence/list');
    localStorage.setItem('ks_admin_token', secret);
    showAdmin();
  } catch {
    adminToken = prev;
    loginError.textContent = 'Secret invalide.';
    loginBtn.disabled = false; loginBtn.textContent = 'Connexion';
  }
}
function logout() {
  localStorage.removeItem('ks_admin_token');
  adminToken = '';
  adminScreen.style.display = 'none';
  loginScreen.style.display = 'flex';
  secretInput.value = ''; loginError.textContent = '';
  loginBtn.disabled = false; loginBtn.textContent = 'Connexion';
}
function showAdmin() {
  loginScreen.style.display = 'none';
  adminScreen.style.display = 'flex';
  switchTab('licences');
}
loginBtn.addEventListener('click', tryLogin);
secretInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
logoutBtn.addEventListener('click', logout);

// ── Tab routing ────────────────────────────────────────────────
const TAB_RENDERERS = {
  licences:  renderLicences,
  tools:     renderTools,
  catalog:   renderCatalog,
  monitoring: renderMonitoring,
  settings:  renderSettings,
};
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  const panel = document.getElementById(`tab-${tab}`);
  panel.innerHTML = '<div class="loading">Chargement…</div>';
  TAB_RENDERERS[tab]?.(panel);
}

// ══════════════════════════════════════════════════════════════════
// TAB 1 — LICENCES
// ══════════════════════════════════════════════════════════════════
async function renderLicences(panel) {
  try {
    const { licences = [], total = 0 } = await api('/api/licence/list');
    const active = licences.filter(l => l.active).length;
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Licences <span>(${total})</span></h2>
        <button class="btn btn-primary" id="btn-new-licence">+ Nouvelle licence</button>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Actives</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Révoquées</div><div class="stat-value" style="color:#e05c5c">${total - active}</div></div>
      </div>
      ${total === 0
        ? '<div class="empty-state"><div class="icon">🗝</div><p>Aucune licence enregistrée</p></div>'
        : `<table class="data-table"><thead><tr>
             <th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Créée le</th><th>Actions</th>
           </tr></thead><tbody id="licences-tbody"></tbody></table>`}`;

    panel.querySelector('#btn-new-licence').addEventListener('click', () => showCreateLicenceModal(panel));
    if (total > 0) {
      const tbody = panel.querySelector('#licences-tbody');
      licences.forEach(l => {
        const tr = document.createElement('tr');
        const pb = `badge-plan-${(l.plan || '').toLowerCase()}`;
        const date = l.createdAt ? new Date(l.createdAt).toLocaleDateString('fr-FR') : '—';
        tr.innerHTML = `
          <td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
          <td>${esc(l.owner || '—')}</td>
          <td><span class="badge ${pb}">${esc(l.plan || '—')}</span></td>
          <td><span class="badge ${l.active ? 'badge-active' : 'badge-revoked'}">${l.active ? 'Active' : 'Révoquée'}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${date}</td>
          <td style="display:flex;gap:8px;align-items:center">
            ${l.active ? `<button class="btn btn-danger btn-sm" data-key="${esc(l.key)}" data-action="revoke">Révoquer</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-key="${esc(l.key)}" data-owner="${esc(l.owner||'')}" data-plan="${esc(l.plan||'')}" data-action="edit">Éditer</button>
          </td>`;
        tbody.appendChild(tr);
      });
      tbody.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'revoke') confirmRevoke(btn.dataset.key, panel);
        if (btn.dataset.action === 'edit')   showEditLicenceModal(btn.dataset.key, btn.dataset.owner, btn.dataset.plan, panel);
      });
    }
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function showCreateLicenceModal(panel) {
  openModal('Nouvelle Licence', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">Clé <span style="font-weight:400;text-transform:none">(XXXX-XXXX-XXXX-XXXX)</span></label>
        <div style="display:flex;gap:8px">
          <input type="text" class="form-input" id="m-key" placeholder="ABCD-1234-EFGH-5678"
                 style="font-family:'SF Mono',monospace;text-transform:uppercase;flex:1">
          <button class="btn btn-secondary" id="btn-gen-key" style="white-space:nowrap;flex-shrink:0">Générer</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Propriétaire</label>
        <input type="text" class="form-input" id="m-owner" placeholder="Nom ou email">
      </div>
      <div class="form-group">
        <label class="form-label">Plan</label>
        <select class="form-select" id="m-plan"><option>STARTER</option><option>PRO</option><option>MAX</option></select>
      </div>
      <div class="form-group form-full">
        <label class="form-label">Assets autorisés <span style="font-weight:400;text-transform:none">(optionnel — virgules)</span></label>
        <input type="text" class="form-input" id="m-assets" placeholder="O-IMM-001, O-MKT-001, …">
      </div>
      <div class="form-group">
        <label class="form-label">Expiration <span style="font-weight:400;text-transform:none">(optionnel)</span></label>
        <input type="date" class="form-input" id="m-expires">
      </div>
    </div>
    <p class="form-error" id="m-error"></p>`,
  `<button class="btn btn-secondary" id="m-cancel">Annuler</button>
   <button class="btn btn-primary"   id="m-confirm">Créer la licence</button>`);

  document.getElementById('btn-gen-key').addEventListener('click', () => {
    document.getElementById('m-key').value = generateKey();
  });
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-confirm').addEventListener('click', () => submitCreateLicence(panel));
}

async function submitCreateLicence(panel) {
  const key      = document.getElementById('m-key').value.trim().toUpperCase();
  const owner    = document.getElementById('m-owner').value.trim();
  const plan     = document.getElementById('m-plan').value;
  const rawAssets = document.getElementById('m-assets').value.trim();
  const expires  = document.getElementById('m-expires').value || undefined;
  const errEl    = document.getElementById('m-error');
  const btn      = document.getElementById('m-confirm');
  errEl.textContent = '';
  if (!key || !owner) { errEl.textContent = 'Clé et propriétaire requis.'; return; }
  const body = { key, plan, owner };
  if (rawAssets) body.ownedAssets = rawAssets.split(',').map(s => s.trim()).filter(Boolean);
  if (expires)   body.expiresAt   = expires;
  btn.disabled = true; btn.textContent = '…';
  try {
    await api('/api/licence/activate', 'POST', body);
    closeModal(); toast('Licence créée ✓'); renderLicences(panel);
  } catch (err) {
    errEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Créer la licence';
  }
}

function showEditLicenceModal(key, owner, plan, panel) {
  openModal('Éditer la licence', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">Clé</label>
        <input type="text" class="form-input" value="${esc(key)}" disabled style="font-family:'SF Mono',monospace">
      </div>
      <div class="form-group">
        <label class="form-label">Propriétaire</label>
        <input type="text" class="form-input" id="e-owner" value="${esc(owner)}">
      </div>
      <div class="form-group">
        <label class="form-label">Plan</label>
        <select class="form-select" id="e-plan">
          ${['STARTER','PRO','MAX'].map(p => `<option ${plan===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="form-error" id="e-error"></p>`,
  `<button class="btn btn-secondary" id="e-cancel">Annuler</button>
   <button class="btn btn-primary"   id="e-confirm">Mettre à jour</button>`);
  document.getElementById('e-cancel').addEventListener('click', closeModal);
  document.getElementById('e-confirm').addEventListener('click', async () => {
    const newOwner = document.getElementById('e-owner').value.trim();
    const newPlan  = document.getElementById('e-plan').value;
    const errEl    = document.getElementById('e-error');
    const btn      = document.getElementById('e-confirm');
    if (!newOwner) { errEl.textContent = 'Propriétaire requis.'; return; }
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/api/licence/activate', 'POST', { key, plan: newPlan, owner: newOwner });
      closeModal(); toast('Licence mise à jour ✓'); renderLicences(panel);
    } catch (err) {
      errEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Mettre à jour';
    }
  });
}

function confirmRevoke(key, panel) {
  openModal('Confirmer la révocation', `
    <p style="line-height:1.7">Révoquer la licence<br>
    <strong style="font-family:'SF Mono',monospace;color:var(--gold);font-size:15px">${esc(key)}</strong> ?<br>
    <span style="color:var(--text-muted);font-size:12px">L'utilisateur perdra immédiatement l'accès.</span></p>`,
  `<button class="btn btn-secondary" id="r-cancel">Annuler</button>
   <button class="btn btn-danger"    id="r-confirm" style="padding:9px 18px">Révoquer</button>`);
  document.getElementById('r-cancel').addEventListener('click', closeModal);
  document.getElementById('r-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('r-confirm');
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/api/licence/revoke', 'POST', { key });
      closeModal(); toast('Licence révoquée', 'error'); renderLicences(panel);
    } catch (err) { toast(err.message, 'error'); closeModal(); }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 2 — LA FABRIQUE
// ══════════════════════════════════════════════════════════════════

function normalizePad(pad) {
  if (!pad) return null;
  const p = JSON.parse(JSON.stringify(pad));
  if (!p.type) p.type = 'tool';
  if (!p.engines) {
    const legacyMap = { claude:'claude', chatgpt:'gpt4o', 'gpt-4':'gpt4o', gpt4:'gpt4o', gemini:'gemini', mistral:'mistral' };
    const raw = (p.ai_optimized || 'claude').toLowerCase().replace(/[^a-z0-9]/g,'');
    const eng = legacyMap[raw] || 'claude';
    p.engines = { default: eng, available: [eng], prompts: { [eng]: p.system_prompt || '' } };
  }
  if (!p.artifact_config) p.artifact_config = { output_schema: {}, json_preamble: '' };
  return p;
}

async function renderTools(panel) {
  try {
    const manifest = await fetchJSON('/K_STORE_ASSETS/PADS/manifest.json');
    const padIds   = manifest.pads || [];
    padsCache = {};
    await Promise.all(padIds.map(async id => {
      try { padsCache[id] = await fetchJSON(`/K_STORE_ASSETS/PADS/${id}.json`); }
      catch { padsCache[id] = null; }
    }));

    const toolCount = padIds.filter(id => (padsCache[id]?.type || 'tool') === 'tool').length;
    const arteCount = padIds.length - toolCount;

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">La Fabrique
          <span>${toolCount} outils · ${arteCount} artefacts</span>
        </h2>
        <button class="btn btn-primary" id="btn-new-pad">+ Nouveau PAD</button>
      </div>
      <div class="split-layout">
        <div class="split-left"  id="pad-list"></div>
        <div class="split-right" id="pad-editor">
          <div class="empty-state">
            <div class="icon">🔧</div>
            <p>Sélectionnez un PAD pour l'éditer</p>
          </div>
        </div>
      </div>`;

    const padList = panel.querySelector('#pad-list');
    padIds.forEach(id => {
      const pad  = padsCache[id];
      const type = pad?.type || 'tool';
      const item = document.createElement('div');
      item.className  = 'pad-item';
      item.dataset.id = id;
      item.innerHTML  = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span class="pad-item-id">${esc(id)}</span>
          <span class="type-badge type-badge-${type}">${type === 'artifact' ? 'ARTEFACT' : 'OUTIL'}</span>
        </div>
        <div class="pad-item-title">${esc(pad?.title || '(introuvable)')}</div>`;
      item.addEventListener('click', () => {
        panel.querySelectorAll('.pad-item').forEach(i => i.classList.toggle('active', i.dataset.id === id));
        openPadEditor(id, panel);
      });
      padList.appendChild(item);
    });

    panel.querySelector('#btn-new-pad').addEventListener('click', () => showNewPadTypeModal(panel));

    if (editingPadId && padsCache[editingPadId]) {
      panel.querySelector(`.pad-item[data-id="${editingPadId}"]`)?.classList.add('active');
      openPadEditor(editingPadId, panel);
    }
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function openPadEditor(id, panel) {
  editingPadId = id;
  const pad = normalizePad(padsCache[id]) || {
    id, type: 'tool', padKey: '', title: '', subtitle: '',
    ai_optimized: 'Claude', icon: '', category: 'IMM', notice: '',
    fields: [], engines: { default: 'claude', available: ['claude'], prompts: {} },
    artifact_config: { output_schema: {}, json_preamble: '' },
  };
  renderEditor(panel.querySelector('#pad-editor'), pad, false);
}

// ── Editor shell ───────────────────────────────────────────────
function renderEditor(container, pad, isNew) {
  const fieldCount = (pad.fields || []).length;
  const isArtifact = pad.type === 'artifact';
  container.innerHTML = `
    <div id="card-preview"></div>
    <div class="editor-tabs-bar">
      <button class="editor-tab-btn active" data-etab="identity">Identité</button>
      <button class="editor-tab-btn" data-etab="fields">
        ${isArtifact ? 'Composants' : 'Champs'}
        <span class="field-count">(${fieldCount})</span>
      </button>
      <button class="editor-tab-btn" data-etab="engines">Moteurs</button>
      ${isArtifact ? '<button class="editor-tab-btn" data-etab="preview" style="color:#6496ff">◉ Aperçu</button>' : ''}
    </div>
    <div id="etab-identity" class="editor-tab-content active"></div>
    <div id="etab-fields"   class="editor-tab-content"></div>
    <div id="etab-engines"  class="editor-tab-content"></div>
    ${isArtifact ? '<div id="etab-preview" class="editor-tab-content"></div>' : ''}
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <p class="form-error" id="editor-err" style="flex:1;margin:0"></p>
      <button class="btn btn-primary" id="btn-editor-save">Sauvegarder →</button>
    </div>`;

  container.querySelectorAll('.editor-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.editor-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.editor-tab-content').forEach(c => c.classList.toggle('active', c.id === `etab-${btn.dataset.etab}`));
      if (btn.dataset.etab === 'engines' && isArtifact) {
        refreshArtifactSchema(container);
      }
      if (btn.dataset.etab === 'preview' && isArtifact) {
        renderPreviewTab(container.querySelector('#etab-preview'), container);
      }
    });
  });

  renderCardPreview(container.querySelector('#card-preview'), pad);
  renderIdentityTab(container.querySelector('#etab-identity'), pad, container);

  if (pad.type === 'artifact') {
    renderArtifactFieldsTab(container.querySelector('#etab-fields'), pad, container);
  } else {
    renderToolFieldsTab(container.querySelector('#etab-fields'), pad, container);
  }

  renderEnginesTab(container.querySelector('#etab-engines'), pad, container);
  container.querySelector('#btn-editor-save').addEventListener('click', () => saveFromEditor(container, pad.id, isNew, pad.type));
}

// ── Card Preview ───────────────────────────────────────────────
function renderCardPreview(el, pad) {
  const type   = pad.type || 'tool';
  const engId  = pad.engines?.default || 'claude';
  const engCfg = ENGINES.find(e => e.id === engId) || ENGINES[0];
  el.innerHTML = `
    <div class="pad-card-preview">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <span class="preview-icon" id="prev-icon">${iconEmoji(pad.icon)}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="type-badge type-badge-${type}" id="prev-type-badge">
            ${type === 'artifact' ? 'ARTEFACT' : 'OUTIL'}
          </span>
          <span class="engine-pill" id="prev-engine-pill"
                style="background:${engCfg.color}22;color:${engCfg.color};border-color:${engCfg.color}44">
            ${engCfg.label}
          </span>
        </div>
      </div>
      <div class="preview-title"    id="prev-title">${esc(pad.title    || 'Titre du PAD')}</div>
      <div class="preview-subtitle" id="prev-sub"  >${esc(pad.subtitle || 'Description courte')}</div>
    </div>`;
}

function refreshPreview(container) {
  const title   = container.querySelector('#id-title')?.value    || '';
  const subtitle = container.querySelector('#id-subtitle')?.value || '';
  const icon    = container.querySelector('#id-icon')?.value     || '';
  const type    = container.querySelector('[name="pad-type"]:checked')?.value || 'tool';
  const engId   = container.querySelector('#id-default-engine')?.value || 'claude';
  const engCfg  = ENGINES.find(e => e.id === engId) || ENGINES[0];

  const q = id => container.querySelector(`#${id}`);
  if (q('prev-title'))    q('prev-title').textContent    = title    || 'Titre du PAD';
  if (q('prev-sub'))      q('prev-sub').textContent      = subtitle || 'Description courte';
  if (q('prev-icon'))     q('prev-icon').textContent     = iconEmoji(icon);
  const tb = q('prev-type-badge');
  if (tb) { tb.className = `type-badge type-badge-${type}`; tb.textContent = type === 'artifact' ? 'ARTEFACT' : 'OUTIL'; }
  const ep = q('prev-engine-pill');
  if (ep) { ep.textContent = engCfg.label; ep.style.background = `${engCfg.color}22`; ep.style.color = engCfg.color; ep.style.borderColor = `${engCfg.color}44`; }
}

// ── Identité Tab ───────────────────────────────────────────────
function renderIdentityTab(el, pad, rootContainer) {
  const type = pad.type || 'tool';
  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:18px">
      <label class="type-radio ${type !== 'artifact' ? 'active' : ''}">
        <input type="radio" name="pad-type" value="tool" ${type !== 'artifact' ? 'checked' : ''} hidden>
        <span class="type-badge type-badge-tool" style="padding:7px 14px;font-size:10px">OUTIL</span>
        <small>Générateur de prompt multi-moteur</small>
      </label>
      <label class="type-radio ${type === 'artifact' ? 'active' : ''}">
        <input type="radio" name="pad-type" value="artifact" ${type === 'artifact' ? 'checked' : ''} hidden>
        <span class="type-badge type-badge-artifact" style="padding:7px 14px;font-size:10px">ARTEFACT</span>
        <small>Shell de données JSON structuré</small>
      </label>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">ID NOMEN-K</label>
        <input type="text" class="form-input" id="id-nomenk"
               value="${esc(pad.id || '')}" placeholder="O-IMM-001"
               style="font-family:'SF Mono',monospace">
      </div>
      <div class="form-group">
        <label class="form-label">Pad Key</label>
        <input type="text" class="form-input" id="id-padkey"
               value="${esc(pad.padKey || '')}" placeholder="A1">
      </div>
      <div class="form-group">
        <label class="form-label">Titre</label>
        <input type="text" class="form-input" id="id-title"
               value="${esc(pad.title || '')}" placeholder="Notices VEFA">
      </div>
      <div class="form-group">
        <label class="form-label">Sous-titre</label>
        <input type="text" class="form-input" id="id-subtitle"
               value="${esc(pad.subtitle || '')}" placeholder="Description courte">
      </div>
      <div class="form-group">
        <label class="form-label">Icône</label>
        <input type="text" class="form-input" id="id-icon"
               value="${esc(pad.icon || '')}" placeholder="vefa · mail · social · chat…">
      </div>
      <div class="form-group">
        <label class="form-label">Catégorie</label>
        <select class="form-select" id="id-category">
          ${CATEGORIES.map(c => `<option ${pad.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group form-full">
        <label class="form-label">Notice utilisateur</label>
        <textarea class="form-textarea" id="id-notice"
                  style="min-height:80px;font-family:inherit;font-size:13px;resize:vertical">${esc(pad.notice || '')}</textarea>
      </div>
    </div>`;

  ['#id-title','#id-subtitle','#id-icon'].forEach(sel => {
    el.querySelector(sel)?.addEventListener('input', () => refreshPreview(rootContainer));
  });
  el.querySelectorAll('[name="pad-type"]').forEach(r => {
    r.addEventListener('change', () => {
      el.querySelectorAll('.type-radio').forEach(l => l.classList.toggle('active', l.querySelector('input').checked));
      refreshPreview(rootContainer);
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// CHAMPS — MODE OUTIL (Input fields)
// ══════════════════════════════════════════════════════════════════

function renderToolFieldsTab(el, pad, rootContainer) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <p style="color:var(--text-muted);font-size:12px">
        Référencez les champs dans les prompts avec
        <code style="color:var(--gold);font-size:11px">{{id_du_champ}}</code>
      </p>
      <button class="btn btn-secondary btn-sm" id="btn-add-field">+ Ajouter un champ</button>
    </div>
    <div id="fields-container"></div>`;

  const fc = el.querySelector('#fields-container');
  (pad.fields || []).forEach(f => fc.appendChild(createToolFieldRow(f, rootContainer)));
  el.querySelector('#btn-add-field').addEventListener('click', () => {
    const row = createToolFieldRow({ id:'', label:'', type:'text', placeholder:'', required:false }, rootContainer);
    fc.appendChild(row);
    updateFieldCount(rootContainer);
    row.querySelector('.field-label-input')?.focus();
  });
}

function createToolFieldRow(field, rootContainer) {
  const div = document.createElement('div');
  div.className = 'field-row';
  div.innerHTML = `
    <div class="field-row-grid">
      <div class="form-group">
        <label class="form-label">Label</label>
        <input type="text" class="form-input field-label-input" value="${esc(field.label||'')}" placeholder="Nom du programme">
      </div>
      <div class="form-group">
        <label class="form-label">ID <span style="color:var(--gold)">*</span></label>
        <input type="text" class="form-input field-id-input" value="${esc(field.id||'')}" placeholder="nom_programme" style="font-family:'SF Mono',monospace;font-size:12px">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select field-type-select">
          ${TOOL_FIELD_TYPES.map(t => `<option ${field.type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label field-ph-label">Placeholder</label>
        <input type="text" class="form-input field-placeholder-input"
               value="${esc(field.placeholder||(field.options?field.options.join(', '):''))}"
               placeholder="ex: Les Jardins du Midi">
      </div>
    </div>
    <div style="display:flex;gap:20px;align-items:center;margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" class="field-required-cb" ${field.required?'checked':''}>Requis
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
        <input type="checkbox" class="field-span-cb" ${field.span==='full'?'checked':''}>Pleine largeur
      </label>
      <button class="btn btn-danger btn-sm field-delete-btn" style="margin-left:auto">✕ Supprimer</button>
    </div>`;

  const labelInput = div.querySelector('.field-label-input');
  const idInput    = div.querySelector('.field-id-input');
  labelInput.addEventListener('input', () => { if (!idInput.dataset.manual) idInput.value = slugify(labelInput.value); });
  idInput.addEventListener('input', () => { idInput.dataset.manual = '1'; });

  const typeSelect = div.querySelector('.field-type-select');
  const phLabel    = div.querySelector('.field-ph-label');
  const phInput    = div.querySelector('.field-placeholder-input');
  typeSelect.addEventListener('change', () => {
    phLabel.textContent = typeSelect.value === 'select' ? 'Options (virgules)' : 'Placeholder';
    phInput.placeholder = typeSelect.value === 'select' ? 'Option A, Option B' : 'ex: valeur';
  });

  div.querySelector('.field-delete-btn').addEventListener('click', () => {
    div.remove();
    updateFieldCount(rootContainer);
  });
  return div;
}

function collectToolFields(editorContainer) {
  return Array.from(editorContainer.querySelectorAll('#fields-container .field-row')).map(row => {
    const type = row.querySelector('.field-type-select').value;
    const ph   = row.querySelector('.field-placeholder-input').value.trim();
    const f    = {
      id:       row.querySelector('.field-id-input').value.trim() || slugify(row.querySelector('.field-label-input').value),
      label:    row.querySelector('.field-label-input').value.trim(),
      type,
      required: row.querySelector('.field-required-cb').checked,
    };
    if (row.querySelector('.field-span-cb').checked) f.span = 'full';
    if (type === 'select') { f.options = ph.split(',').map(s => s.trim()).filter(Boolean); }
    else if (ph)           { f.placeholder = ph; }
    return f;
  }).filter(f => f.label);
}

// ══════════════════════════════════════════════════════════════════
// COMPOSANTS — MODE ARTEFACT (Output components)
// ══════════════════════════════════════════════════════════════════

function renderArtifactFieldsTab(el, pad, rootContainer) {
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <p style="color:var(--text-muted);font-size:12px">
        Chaque composant reçoit une valeur depuis le JSON retourné par l'IA.
        L'ID est le <strong style="color:#6496ff">port de données</strong>.
      </p>
      <button class="btn btn-secondary btn-sm" id="btn-add-component">+ Ajouter un composant</button>
    </div>
    <div id="fields-container"></div>`;

  const fc = el.querySelector('#fields-container');
  (pad.fields || []).forEach(f => fc.appendChild(createArtifactFieldRow(f, rootContainer)));
  el.querySelector('#btn-add-component').addEventListener('click', () => {
    const row = createArtifactFieldRow({ id:'', label:'', component:'gauge', config:{} }, rootContainer);
    fc.appendChild(row);
    updateFieldCount(rootContainer);
    _triggerDynamicRefresh(rootContainer);
    row.querySelector('.field-label-input')?.focus();
  });
}

function createArtifactFieldRow(field, rootContainer) {
  const activeComp = field.component || 'gauge';
  const div = document.createElement('div');
  div.className  = 'artifact-field-row';
  div.draggable  = true;

  const compBtns = ARTIFACT_COMPONENTS.map(c => `
    <button class="comp-btn ${c.id === activeComp ? 'active' : ''}" data-comp="${c.id}" type="button">
      <span class="comp-icon">${c.icon}</span>
      ${c.label}
    </button>`).join('');

  div.innerHTML = `
    <div class="artifact-drag-handle" title="Glisser pour réorganiser">⠿</div>
    <div style="margin-bottom:10px">
      <div class="form-label" style="margin-bottom:8px">Composant de rendu</div>
      <div class="component-selector">${compBtns}</div>
    </div>
    <div class="artifact-field-base">
      <div class="form-group">
        <label class="form-label">Label affiché</label>
        <input type="text" class="form-input field-label-input" value="${esc(field.label||'')}" placeholder="Score de potentiel">
      </div>
      <div class="form-group">
        <label class="form-label">ID — Port de données <span style="color:#6496ff">*</span></label>
        <input type="text" class="form-input field-id-input" value="${esc(field.id||'')}" placeholder="score_potentiel"
               style="font-family:'SF Mono',monospace;font-size:12px;border-color:rgba(100,150,255,0.3)">
      </div>
    </div>
    <div id="comp-configs">
      ${ARTIFACT_COMPONENTS.map(c => renderComponentConfig(c, field.config || {}, c.id === activeComp)).join('')}
    </div>
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-danger btn-sm field-delete-btn">✕ Supprimer</button>
    </div>`;

  // ── Auto-ID depuis le label ───────────────────────────────
  const labelInput = div.querySelector('.field-label-input');
  const idInput    = div.querySelector('.field-id-input');
  labelInput.addEventListener('input', () => {
    if (!idInput.dataset.manual) idInput.value = slugify(labelInput.value);
    _triggerDynamicRefresh(rootContainer);
  });
  idInput.addEventListener('input', () => { idInput.dataset.manual = '1'; });

  // ── Sélection du composant ────────────────────────────────
  div.querySelector('.component-selector').addEventListener('click', e => {
    const btn = e.target.closest('.comp-btn');
    if (!btn) return;
    div.querySelectorAll('.comp-btn').forEach(b => b.classList.toggle('active', b === btn));
    div.querySelectorAll('.comp-config-panel').forEach(p => p.classList.toggle('active', p.dataset.forComp === btn.dataset.comp));
    _triggerDynamicRefresh(rootContainer);
  });

  // ── Config inputs → refresh live ─────────────────────────
  div.querySelector('#comp-configs').addEventListener('input', () => _triggerDynamicRefresh(rootContainer));
  div.querySelector('#comp-configs').addEventListener('change', () => _triggerDynamicRefresh(rootContainer));

  // ── Supprimer ─────────────────────────────────────────────
  div.querySelector('.field-delete-btn').addEventListener('click', () => {
    div.remove();
    updateFieldCount(rootContainer);
    _triggerDynamicRefresh(rootContainer);
  });

  // ── Drag & Drop ───────────────────────────────────────────
  div.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    _dragSrc = div;
    setTimeout(() => div.classList.add('dragging'), 0);
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    div.closest('#fields-container')?.querySelectorAll('.artifact-field-row')
      .forEach(r => r.classList.remove('drag-over'));
    _dragSrc = null;
    updateFieldCount(rootContainer);
    _triggerDynamicRefresh(rootContainer);
  });
  div.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (div !== _dragSrc) div.classList.add('drag-over');
  });
  div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
  div.addEventListener('drop', e => {
    e.preventDefault();
    div.classList.remove('drag-over');
    if (!_dragSrc || _dragSrc === div) return;
    const parent  = div.parentNode;
    const rows    = [...parent.querySelectorAll('.artifact-field-row')];
    const srcIdx  = rows.indexOf(_dragSrc);
    const dstIdx  = rows.indexOf(div);
    parent.insertBefore(_dragSrc, srcIdx < dstIdx ? div.nextSibling : div);
    _triggerDynamicRefresh(rootContainer);
  });

  return div;
}

function renderComponentConfig(compDef, savedConfig, isActive) {
  if (compDef.configFields.length === 0) {
    return `<div class="comp-config-panel ${isActive ? 'active' : ''}" data-for-comp="${compDef.id}">
      <span style="color:var(--text-muted);font-size:12px">Aucune configuration requise — l'IA retourne directement le texte.</span>
    </div>`;
  }

  const inputs = compDef.configFields.map(cf => {
    const val = savedConfig[cf.id] !== undefined ? savedConfig[cf.id] : cf.default;
    if (cf.type === 'select') {
      return `<div class="form-group">
        <label class="form-label">${esc(cf.label)}</label>
        <select class="form-select comp-config-input" data-config-key="${cf.id}" style="font-size:12px;padding:6px 10px">
          ${(cf.options||[]).map(o => `<option ${val===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>`;
    }
    if (cf.type === 'color') {
      return `<div class="form-group">
        <label class="form-label">${esc(cf.label)}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="color" class="comp-config-input" data-config-key="${cf.id}" value="${esc(val)}"
                 style="width:40px;height:36px;border-radius:6px;border:1px solid var(--border);background:none;cursor:pointer;padding:2px">
          <input type="text" class="form-input comp-config-color-text" value="${esc(val)}"
                 style="font-family:monospace;font-size:12px;width:90px;padding:6px 10px" maxlength="7">
        </div>
      </div>`;
    }
    return `<div class="form-group">
      <label class="form-label">${esc(cf.label)}</label>
      <input type="${cf.type}" class="form-input comp-config-input" data-config-key="${cf.id}"
             value="${esc(val)}" style="font-size:12px;padding:6px 10px">
    </div>`;
  }).join('');

  return `<div class="comp-config-panel ${isActive ? 'active' : ''}" data-for-comp="${compDef.id}">
    <div class="comp-config-grid">${inputs}</div>
  </div>`;
}

function collectArtifactFields(editorContainer) {
  return Array.from(editorContainer.querySelectorAll('#fields-container .artifact-field-row')).map(row => {
    const activeComp = row.querySelector('.comp-btn.active')?.dataset.comp || 'gauge';
    const configPanel = row.querySelector(`.comp-config-panel[data-for-comp="${activeComp}"]`);
    const config = {};
    configPanel?.querySelectorAll('.comp-config-input').forEach(inp => {
      const key = inp.dataset.configKey;
      config[key] = inp.type === 'number' ? +inp.value : inp.value;
    });
    // Color text sync
    configPanel?.querySelectorAll('.comp-config-color-text').forEach((txt, i) => {
      const colorInput = configPanel.querySelectorAll('input[type="color"]')[i];
      if (colorInput && txt.value) { colorInput.value = txt.value; config['color'] = txt.value; }
    });

    return {
      id:        row.querySelector('.field-id-input').value.trim() || slugify(row.querySelector('.field-label-input').value),
      label:     row.querySelector('.field-label-input').value.trim(),
      component: activeComp,
      config,
    };
  }).filter(f => f.label);
}

function updateFieldCount(editorContainer) {
  if (!editorContainer) return;
  const count = editorContainer.querySelectorAll('#fields-container .field-row, #fields-container .artifact-field-row').length;
  const el    = editorContainer.querySelector('.field-count');
  if (el) el.textContent = `(${count})`;
}

// ══════════════════════════════════════════════════════════════════
// MOTEURS TAB
// ══════════════════════════════════════════════════════════════════

function renderEnginesTab(el, pad, rootContainer) {
  const prompts    = pad.engines?.prompts || {};
  const defaultEng = pad.engines?.default || 'claude';
  const isArtifact = pad.type === 'artifact';

  // Field tokens for tool mode
  const fieldTokens = (pad.fields || [])
    .filter(f => f.id)
    .map(f => `{{${f.id}}}`)
    .join('  ');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <label class="form-label" style="white-space:nowrap;margin:0">Moteur par défaut :</label>
      <select class="form-select" id="id-default-engine" style="width:auto">
        ${ENGINES.map(e => `<option value="${e.id}" ${defaultEng===e.id?'selected':''}>${e.label}</option>`).join('')}
      </select>
    </div>

    ${isArtifact ? `
    <div class="schema-panel" id="schema-panel">
      <div class="schema-panel-header">
        <span class="schema-label">⬡ Schéma JSON auto-généré</span>
        <span class="preamble-badge">OUTPUT FORCÉ</span>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
        Ce bloc est automatiquement prépendé au prompt de chaque moteur. L'IA doit obligatoirement retourner ce JSON.
      </p>
      <div class="schema-code" id="schema-code">Définissez des composants dans l'onglet "Composants" pour générer le schéma.</div>
    </div>` : ''}

    <div class="engine-tabs-bar" id="engine-tabs-bar">
      ${ENGINES.map(e => {
        const hasPrompt = !!(prompts[e.id]);
        const isDefault = e.id === defaultEng;
        return `<button class="engine-tab-btn ${isDefault ? 'active' : ''}"
                        data-engine="${e.id}" style="--eng-color:${e.color}">
          ${e.label}${hasPrompt?' ●':''}${isDefault?' ★':''}
        </button>`;
      }).join('')}
    </div>

    <div id="engine-panels">
      ${ENGINES.map(e => `
        <div class="engine-panel ${e.id===defaultEng?'active':''}" data-engine-panel="${e.id}">
          <div class="engine-hint">${esc(e.hint)}</div>
          ${!isArtifact && fieldTokens
            ? `<div class="engine-tokens">Variables : <span style="color:var(--gold);font-family:'SF Mono',monospace;font-size:11px">${esc(fieldTokens)}</span></div>`
            : isArtifact
              ? `<div class="engine-tokens" style="color:var(--text-muted);font-size:11px">💡 Rédigez ici les instructions métier. Le schéma JSON ci-dessus est injecté automatiquement en préambule.</div>`
              : `<div class="engine-tokens" style="color:var(--text-muted);font-size:11px">💡 Définissez des champs dans l'onglet "Champs" pour voir les variables disponibles.</div>`}
          <textarea class="form-textarea engine-prompt" data-engine="${e.id}"
                    style="min-height:${isArtifact ? '180px' : '240px'}"
                    placeholder="${isArtifact ? `Instructions métier pour ${e.label} (le schéma JSON est géré automatiquement)` : `Prompt Keystone pour ${e.label}…`}"
                    >${esc(prompts[e.id]||'')}</textarea>
        </div>`).join('')}
    </div>`;

  // Engine tab switching
  el.querySelector('#engine-tabs-bar').addEventListener('click', e => {
    const btn = e.target.closest('.engine-tab-btn');
    if (!btn) return;
    const eng = btn.dataset.engine;
    el.querySelectorAll('.engine-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.engine === eng));
    el.querySelectorAll('.engine-panel').forEach(p => p.classList.toggle('active', p.dataset.enginePanel === eng));
  });

  // Default engine changes
  el.querySelector('#id-default-engine').addEventListener('change', e => {
    refreshPreview(rootContainer);
    const newDefault = e.target.value;
    el.querySelectorAll('.engine-tab-btn').forEach(btn => {
      const eng   = btn.dataset.engine;
      const label = ENGINES.find(x => x.id === eng)?.label || eng;
      const hasPr = !!(el.querySelector(`.engine-prompt[data-engine="${eng}"]`)?.value.trim());
      btn.textContent = `${label}${hasPr?' ●':''}${eng===newDefault?' ★':''}`;
    });
  });

  // Dot markers on input
  el.querySelectorAll('.engine-prompt').forEach(ta => {
    ta.addEventListener('input', () => {
      const btn = el.querySelector(`.engine-tab-btn[data-engine="${ta.dataset.engine}"]`);
      if (!btn) return;
      const label     = ENGINES.find(x => x.id === ta.dataset.engine)?.label || ta.dataset.engine;
      const isDefault = el.querySelector('#id-default-engine')?.value === ta.dataset.engine;
      btn.textContent = `${label}${ta.value.trim()?' ●':''}${isDefault?' ★':''}`;
    });
  });

  // Initial schema render for artifacts
  if (isArtifact) refreshArtifactSchema(rootContainer);
}

// ── Auto-Schema Generator ──────────────────────────────────────
function generateJsonSchema(fields) {
  if (!fields || fields.length === 0) return null;

  const lines = fields.map(f => {
    const comp = ARTIFACT_COMPONENTS.find(c => c.id === f.component);
    if (!comp) return null;

    let typeHint;
    switch (f.component) {
      case 'gauge':
        const min = f.config?.min ?? 0;
        const max = f.config?.max ?? 100;
        typeHint = `<number entre ${min} et ${max}>`;
        break;
      case 'status_badge':
        const vals = (f.config?.values || 'Faible, Moyen, Élevé').split(',').map(s => s.trim());
        typeHint = `"<${vals.join('|')}>"`;
        break;
      case 'rich_text':
        typeHint = '"<string — texte long>"';
        break;
      case 'key_points_list':
        typeHint = '["<string>", "<string>", "..."]';
        break;
      case 'data_card':
        typeHint = `<number>  // ${f.config?.unit || ''}`;
        break;
      default:
        typeHint = '<valeur>';
    }
    return `  "${f.id}": ${typeHint}`;
  }).filter(Boolean);

  if (lines.length === 0) return null;

  const schema = `{\n${lines.join(',\n')}\n}`;

  const preamble =
    `INSTRUCTION SYSTÈME — NE PAS MODIFIER\n` +
    `Réponds EXCLUSIVEMENT avec un objet JSON valide.\n` +
    `Aucun texte avant ou après. Aucun markdown. Aucun code block.\n` +
    `Toutes les clés ci-dessous sont OBLIGATOIRES :\n\n` +
    schema +
    `\n\n---\nINSTRUCTIONS MÉTIER :`;

  return { schema, preamble };
}

function refreshArtifactSchema(rootContainer) {
  const schemaEl = rootContainer?.querySelector('#schema-code');
  if (!schemaEl) return;

  const fields = collectArtifactFields(rootContainer);
  const result = generateJsonSchema(fields);

  if (!result) {
    schemaEl.textContent = 'Définissez des composants dans l\'onglet "Composants" pour générer le schéma.';
    return;
  }

  schemaEl.textContent = result.preamble;
}

// ══════════════════════════════════════════════════════════════════
// APERÇU WYSIWYG — Sprint Rectif
// ══════════════════════════════════════════════════════════════════

function _triggerDynamicRefresh(rootContainer) {
  if (!rootContainer) return;
  refreshArtifactSchema(rootContainer);
  const previewTab = rootContainer.querySelector('#etab-preview');
  if (previewTab?.classList.contains('active')) {
    _refreshPreviewRender(previewTab, rootContainer);
  }
}

function renderPreviewTab(el, rootContainer) {
  if (!el) return;
  const fields     = collectArtifactFields(rootContainer);
  const sampleJson = generateSampleJson(fields);
  const sampleStr  = JSON.stringify(sampleJson, null, 2);

  el.innerHTML = `
    <div class="preview-split">
      <div class="preview-sandbox">
        <div class="form-label" style="font-size:10px;letter-spacing:.05em;color:var(--text-muted)">
          JSON de test
          <span style="font-weight:400;text-transform:none;font-size:11px"> — simulez une réponse IA</span>
        </div>
        <textarea id="sandbox-json" class="form-textarea sandbox-input" spellcheck="false">${esc(sampleStr)}</textarea>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-secondary btn-sm" id="btn-sample-reset">↺ Régénérer l'exemple</button>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
          Modifiez les valeurs pour tester vos composants en temps réel.<br>
          Le rendu se met à jour instantanément.
        </p>
      </div>
      <div class="preview-render-panel">
        <div class="preview-render-label">⬡ Aperçu de l'artefact</div>
        <div id="preview-container"></div>
      </div>
    </div>`;

  _refreshPreviewRender(el, rootContainer);

  let debTimer;
  el.querySelector('#sandbox-json').addEventListener('input', () => {
    clearTimeout(debTimer);
    debTimer = setTimeout(() => _refreshPreviewRender(el, rootContainer), 200);
  });

  el.querySelector('#btn-sample-reset').addEventListener('click', () => {
    const freshFields = collectArtifactFields(rootContainer);
    const newSample   = generateSampleJson(freshFields);
    el.querySelector('#sandbox-json').value = JSON.stringify(newSample, null, 2);
    _refreshPreviewRender(el, rootContainer);
  });
}

function _refreshPreviewRender(previewTabEl, rootContainer) {
  const container = previewTabEl?.querySelector('#preview-container');
  if (!container) return;

  const jsonStr = previewTabEl.querySelector('#sandbox-json')?.value || '{}';
  const fields  = collectArtifactFields(rootContainer);

  if (fields.length === 0) {
    container.innerHTML = '<div class="preview-empty">Ajoutez des composants dans l\'onglet<br><strong>"Composants"</strong> pour voir l\'aperçu ici.</div>';
    return;
  }

  const outputSchema = {};
  fields.forEach(f => {
    if (!f.id) return;
    const comp = ARTIFACT_COMPONENTS.find(c => c.id === f.component);
    if (!comp) return;
    outputSchema[f.id] = {
      component: f.component,
      label:     f.label,
      type:      comp.jsonType || 'string',
      config:    f.config || {},
    };
  });

  renderArtifactResult(container, jsonStr, outputSchema);
}

function generateSampleJson(fields) {
  const obj = {};
  fields.forEach(f => {
    if (!f.id) return;
    switch (f.component) {
      case 'gauge': {
        const min = parseFloat(f.config?.min ?? 0);
        const max = parseFloat(f.config?.max ?? 100);
        obj[f.id] = Math.round(min + (max - min) * 0.72);
        break;
      }
      case 'status_badge': {
        const vals = (f.config?.values || 'Faible,Moyen,Élevé').split(',').map(s => s.trim());
        obj[f.id] = vals[Math.floor(vals.length / 2)] || vals[0];
        break;
      }
      case 'rich_text':
        obj[f.id] = `Analyse détaillée pour "${f.label}". Ce texte illustre le rendu d'un composant de contenu long avec les informations contextuelles pertinentes générées par l'IA.`;
        break;
      case 'key_points_list':
        obj[f.id] = [`${f.label} — point fort #1`, `${f.label} — point fort #2`, `${f.label} — point fort #3`];
        break;
      case 'data_card':
        obj[f.id] = f.config?.unit?.includes('€') ? 4250 : f.config?.unit?.includes('%') ? 87 : 1250;
        break;
      default:
        obj[f.id] = 'valeur';
    }
  });
  return obj;
}

// ── Collect engines ─────────────────────────────────────────────
function collectEngines(editorContainer) {
  const defaultEng = editorContainer.querySelector('#id-default-engine')?.value || 'claude';
  const prompts    = {};
  editorContainer.querySelectorAll('.engine-prompt').forEach(ta => {
    if (ta.value.trim()) prompts[ta.dataset.engine] = ta.value.trim();
  });
  const available = Object.keys(prompts).length ? Object.keys(prompts) : [defaultEng];
  return { default: defaultEng, available, prompts };
}

// ── Collect & Save ─────────────────────────────────────────────
function collectEditorState(editorContainer, type) {
  const engines    = collectEngines(editorContainer);
  const engLabel   = ENGINES.find(e => e.id === engines.default)?.label || engines.default;
  const isArtifact = type === 'artifact';

  const fields = isArtifact
    ? collectArtifactFields(editorContainer)
    : collectToolFields(editorContainer);

  // Build artifact_config
  let artifact_config;
  if (isArtifact) {
    const output_schema = {};
    fields.forEach(f => {
      const comp = ARTIFACT_COMPONENTS.find(c => c.id === f.component);
      output_schema[f.id] = {
        component: f.component,
        label:     f.label,
        type:      comp?.jsonType || 'string',
        ...(f.config && Object.keys(f.config).length ? { config: f.config } : {}),
      };
    });
    const schemaResult = generateJsonSchema(fields);
    artifact_config = {
      output_schema,
      json_preamble: schemaResult?.preamble || '',
    };
  }

  return {
    id:           editorContainer.querySelector('#id-nomenk')?.value.trim()   || '',
    type,
    padKey:       editorContainer.querySelector('#id-padkey')?.value.trim()   || null,
    title:        editorContainer.querySelector('#id-title')?.value.trim()    || '',
    subtitle:     editorContainer.querySelector('#id-subtitle')?.value.trim() || '',
    ai_optimized: engLabel,
    icon:         editorContainer.querySelector('#id-icon')?.value.trim()     || '',
    category:     editorContainer.querySelector('#id-category')?.value        || 'IMM',
    notice:       editorContainer.querySelector('#id-notice')?.value.trim()   || '',
    fields,
    engines,
    system_prompt: engines.prompts[engines.default] || '',
    ...(isArtifact ? { artifact_config } : {}),
  };
}

async function saveFromEditor(editorContainer, originalId, isNew, padType) {
  const errEl = document.getElementById('editor-err');
  const btn   = editorContainer.querySelector('#btn-editor-save');
  errEl.textContent = '';

  const type = editorContainer.querySelector('[name="pad-type"]:checked')?.value || padType || 'tool';
  const pad  = collectEditorState(editorContainer, type);

  if (!pad.id)    { errEl.textContent = 'L\'ID NOMEN-K est requis (ex: O-IMM-001).'; return; }
  if (!pad.title) { errEl.textContent = 'Le titre est requis.'; return; }

  btn.disabled = true; btn.textContent = '…';
  try {
    await api('/api/admin/file-write', 'POST', {
      path:    `K_STORE_ASSETS/PADS/${pad.id}.json`,
      content: JSON.stringify(pad, null, 2),
      message: `Admin: ${isNew ? 'create' : 'update'} ${pad.id}.json`,
    });

    if (isNew || pad.id !== originalId) {
      const manifest = await fetchJSON('/K_STORE_ASSETS/PADS/manifest.json');
      if (!manifest.pads.includes(pad.id)) {
        manifest.pads.push(pad.id);
        await api('/api/admin/file-write', 'POST', {
          path:    'K_STORE_ASSETS/PADS/manifest.json',
          content: JSON.stringify(manifest, null, 2),
          message: `Admin: add ${pad.id} to manifest`,
        });
      }
    }

    padsCache[pad.id] = pad;
    editingPadId      = pad.id;
    toast(`${pad.id}.json sauvegardé ✓`);

    const panel = document.getElementById('tab-tools');
    await renderTools(panel);
  } catch (err) {
    errEl.textContent = err.message;
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Sauvegarder →';
  }
}

// ── New PAD type chooser ───────────────────────────────────────
function showNewPadTypeModal(panel) {
  openModal('Nouveau PAD — Choisir le type', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <button class="type-choice-btn" data-type="tool">
        <div style="font-size:36px;margin-bottom:12px">🔧</div>
        <div style="font-size:14px;font-weight:900;color:var(--gold);letter-spacing:-0.02em;margin-bottom:8px">OUTIL</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          Générateur de prompt multi-moteur.<br>Champs → Prompt → IA → Texte.
        </div>
      </button>
      <button class="type-choice-btn" data-type="artifact">
        <div style="font-size:36px;margin-bottom:12px">🔷</div>
        <div style="font-size:14px;font-weight:900;color:#6496ff;letter-spacing:-0.02em;margin-bottom:8px">ARTEFACT</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          Shell de données JSON.<br>IA → JSON → Composants visuels.
        </div>
      </button>
    </div>`);

  document.querySelectorAll('.type-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal();
      editingPadId = null;
      const newPad = {
        id:'', type: btn.dataset.type, padKey:'', title:'', subtitle:'',
        ai_optimized:'Claude', icon:'', category:'IMM', notice:'',
        fields:[], engines:{ default:'claude', available:['claude'], prompts:{} },
        system_prompt:'',
        artifact_config: { output_schema:{}, json_preamble:'' },
      };
      panel.querySelectorAll('.pad-item').forEach(i => i.classList.remove('active'));
      renderEditor(panel.querySelector('#pad-editor'), newPad, true);
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 3 — CATALOGUE
// ══════════════════════════════════════════════════════════════════
async function renderCatalog(panel) {
  try {
    catalogData = await fetchJSON('/K_STORE_ASSETS/catalog.json');
    const items = catalogData.tools || [];
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Catalogue <span>(${items.length} entrées)</span></h2>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" id="btn-raw-catalog">JSON brut</button>
          <button class="btn btn-primary"   id="btn-save-catalog">Sauvegarder</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>ID</th><th>Titre</th><th>Plan</th><th>Prix</th><th>Lifetime</th><th>Publié</th><th>Nouveau</th></tr></thead>
        <tbody id="catalog-tbody"></tbody>
      </table>`;
    const tbody = panel.querySelector('#catalog-tbody');
    items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:11px;color:var(--gold)">${esc(item.id)}</code></td>
        <td><input data-idx="${idx}" data-field="title" type="text" class="form-input" value="${esc(item.title||'')}"
                   style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:200px"
                   onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'"></td>
        <td><select data-idx="${idx}" data-field="plan" class="form-select" style="padding:4px 8px;font-size:12px;width:auto">
          ${['STARTER','PRO','MAX'].map(p=>`<option ${item.plan===p?'selected':''}>${p}</option>`).join('')}
        </select></td>
        <td><input data-idx="${idx}" data-field="price" type="number" class="form-input" value="${item.price??''}"
                   style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:70px"
                   onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'"></td>
        <td><input data-idx="${idx}" data-field="lifetimePrice" type="number" class="form-input" value="${item.lifetimePrice??''}"
                   style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:70px"
                   onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'"></td>
        <td><label class="toggle-switch"><input data-idx="${idx}" data-field="published" type="checkbox" ${item.published?'checked':''}>
          <span class="toggle-slider"></span></label></td>
        <td><label class="toggle-switch"><input data-idx="${idx}" data-field="isNew" type="checkbox" ${item.isNew?'checked':''}>
          <span class="toggle-slider"></span></label></td>`;
      tbody.appendChild(tr);
    });
    panel.querySelectorAll('[data-idx][data-field]').forEach(el => {
      el.addEventListener(el.type==='checkbox'?'change':'input', () => {
        const idx=+el.dataset.idx; const field=el.dataset.field;
        catalogData.tools[idx][field] = el.type==='checkbox' ? el.checked : el.type==='number' ? (el.value===''?undefined:+el.value) : el.value;
      });
    });
    panel.querySelector('#btn-save-catalog').addEventListener('click', () => saveCatalog(panel));
    panel.querySelector('#btn-raw-catalog').addEventListener('click', () => showRawCatalogEditor(panel));
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}
async function saveCatalog(panel) {
  const btn = panel.querySelector('#btn-save-catalog');
  btn.disabled = true; btn.textContent = '…';
  catalogData.updatedAt = new Date().toISOString().slice(0,10);
  try {
    await api('/api/admin/file-write','POST',{ path:'K_STORE_ASSETS/catalog.json', content:JSON.stringify(catalogData,null,2), message:'Admin: update catalog.json' });
    toast('catalog.json sauvegardé ✓');
  } catch(err) { toast(err.message,'error'); }
  finally { btn.disabled=false; btn.textContent='Sauvegarder'; }
}
function showRawCatalogEditor(panel) {
  openModal('catalog.json — Éditeur brut',
    `<textarea class="form-textarea" id="cr-json" style="min-height:500px">${esc(JSON.stringify(catalogData,null,2))}</textarea><p class="form-error" id="cr-err"></p>`,
    `<button class="btn btn-secondary" id="cr-cancel">Annuler</button><button class="btn btn-primary" id="cr-save">Sauvegarder</button>`);
  document.getElementById('cr-cancel').addEventListener('click', closeModal);
  document.getElementById('cr-save').addEventListener('click', async () => {
    const jsonStr=document.getElementById('cr-json').value; const errEl=document.getElementById('cr-err'); const btn=document.getElementById('cr-save');
    try { catalogData=JSON.parse(jsonStr); } catch { errEl.textContent='JSON invalide'; return; }
    btn.disabled=true; btn.textContent='…';
    try {
      await api('/api/admin/file-write','POST',{ path:'K_STORE_ASSETS/catalog.json', content:JSON.stringify(catalogData,null,2), message:'Admin: update catalog.json (raw)' });
      closeModal(); toast('catalog.json sauvegardé ✓'); renderCatalog(panel);
    } catch(err) { errEl.textContent=err.message; btn.disabled=false; btn.textContent='Sauvegarder'; }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 4 — MONITORING
// ══════════════════════════════════════════════════════════════════
async function renderMonitoring(panel) {
  try {
    const { licences=[], total=0 } = await api('/api/licence/list');
    const active = licences.filter(l=>l.active).length;
    const byPlan = {STARTER:0,PRO:0,MAX:0};
    licences.forEach(l => { if(l.active && l.plan in byPlan) byPlan[l.plan]++; });
    const recent = [...licences].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,10);
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Monitoring</h2>
        <button class="btn btn-secondary" id="btn-refresh" style="font-size:12px">↻ Rafraîchir</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Total licences</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Actives</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Plan PRO</div><div class="stat-value" style="color:var(--gold);font-size:26px">${byPlan.PRO}</div></div>
        <div class="stat-card"><div class="stat-label">Plan MAX</div><div class="stat-value" style="color:#b464ff;font-size:26px">${byPlan.MAX}</div></div>
      </div>
      <h3 style="font-size:14px;font-weight:700;letter-spacing:-0.02em;margin-bottom:14px">Dernières activations</h3>
      ${recent.length===0 ? '<div class="empty-state"><p>Aucune donnée</p></div>' : `
      <table class="data-table"><thead><tr><th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Date</th></tr></thead>
      <tbody>${recent.map(l=>{
        const pb=`badge-plan-${(l.plan||'').toLowerCase()}`;
        const d=l.createdAt?new Date(l.createdAt).toLocaleString('fr-FR'):'—';
        return `<tr><td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
          <td>${esc(l.owner||'—')}</td><td><span class="badge ${pb}">${esc(l.plan||'—')}</span></td>
          <td><span class="badge ${l.active?'badge-active':'badge-revoked'}">${l.active?'Active':'Révoquée'}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${d}</td></tr>`;
      }).join('')}</tbody></table>`}`;
    panel.querySelector('#btn-refresh').addEventListener('click', () => renderMonitoring(panel));
  } catch(err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB 5 — RÉGLAGES · RGPD
// ══════════════════════════════════════════════════════════════════
async function renderSettings(panel) {
  panel.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Réglages <span>· Confidentialité & RGPD</span></h2>
    </div>

    <!-- ── Politique de confidentialité ── -->
    <div class="rgpd-section">
      <div class="rgpd-section-title">
        🔒 Données traitées par Keystone OS
        <span class="rgpd-chip">RGPD Art. 13</span>
      </div>
      <table class="rgpd-table">
        <tr>
          <td>Responsable</td>
          <td>Protein Studio / Stéphane Benedetti</td>
        </tr>
        <tr>
          <td>Base légale</td>
          <td>Exécution d'un contrat (Art. 6.1.b RGPD)</td>
        </tr>
        <tr>
          <td>Données stockées</td>
          <td>Clé de licence, nom propriétaire, adresse e-mail collaborateur, token d'appareil, horodatages</td>
        </tr>
        <tr>
          <td>Données IA</td>
          <td>Les prompts envoyés aux moteurs IA (Claude, GPT-4o, etc.) sont traités par les API tierces selon leurs propres politiques. Aucune donnée IA n'est conservée côté Keystone OS.</td>
        </tr>
        <tr>
          <td>Hébergement</td>
          <td>Cloudflare D1 — Région EU-West (WEUR). Aucun stockage hors UE.</td>
        </tr>
        <tr>
          <td>Durée de conservation</td>
          <td>Durée de la relation commerciale + 3 ans (obligations légales)</td>
        </tr>
        <tr>
          <td>Droits RGPD</td>
          <td>Accès, rectification, effacement, portabilité — exercer via ce panneau ou par e-mail à l'administrateur.</td>
        </tr>
      </table>
      <div class="rgpd-notice">
        Les clés API des moteurs IA sont chiffrées en AES-256-GCM avant stockage.<br>
        L'accès admin est protégé par un secret Bearer Token (non transmis en clair).<br>
        Toutes les communications transitent via HTTPS/TLS 1.3.
      </div>
    </div>

    <!-- ── Export ── -->
    <div class="rgpd-section">
      <div class="rgpd-section-title">📦 Portabilité des données</div>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.65;margin-bottom:16px">
        Téléchargez l'intégralité des données stockées (licences + appareils) au format JSON.
        Ce fichier peut être remis à un utilisateur sur demande (droit de portabilité, Art. 20 RGPD).
      </p>
      <button class="btn btn-secondary" id="btn-export-data">
        ↓ Exporter toutes les données (JSON)
      </button>
      <p id="export-status" style="font-size:12px;margin-top:10px;min-height:16px"></p>
    </div>

    <!-- ── Devices en attente ── -->
    <div class="rgpd-section">
      <div class="rgpd-section-title">📱 Appareils en attente d'approbation</div>
      <div id="devices-pending-container">
        <div class="loading" style="padding:24px 0">Chargement…</div>
      </div>
    </div>

    <!-- ── Zone de suppression ── -->
    <div class="rgpd-danger-zone">
      <div class="rgpd-danger-title">⚠ Zone de suppression — Effacement sur demande (Art. 17 RGPD)</div>
      <p style="font-size:12px;color:var(--text-muted);line-height:1.65;margin-bottom:16px">
        Supprimez toutes les données d'un tenant (appareils + révocation de licences).
        Cette action est <strong style="color:#e05c5c">irréversible</strong>.
      </p>
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="form-group" style="flex:1">
          <label class="form-label">Tenant ID</label>
          <input type="text" class="form-input" id="purge-tenant-id"
                 placeholder="default" style="font-family:'SF Mono',monospace">
        </div>
        <button class="btn btn-danger" id="btn-purge-tenant" style="flex-shrink:0">
          Supprimer les données
        </button>
      </div>
      <p id="purge-status" style="font-size:12px;margin-top:10px;min-height:16px"></p>
    </div>`;

  // ── Export handler ────────────────────────────────────────────
  panel.querySelector('#btn-export-data').addEventListener('click', async () => {
    const btn    = panel.querySelector('#btn-export-data');
    const status = panel.querySelector('#export-status');
    btn.disabled = true; btn.textContent = '…';
    status.textContent = '';
    try {
      const [licencesData, devicesData] = await Promise.all([
        api('/api/licence/list'),
        api('/api/admin/devices'),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        exporter:   'Keystone OS Admin Panel',
        licences:   licencesData.licences || [],
        devices:    devicesData.devices   || [],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `keystone-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      status.style.color = 'var(--success)';
      status.textContent = `✓ Export réussi — ${payload.licences.length} licences, ${payload.devices.length} appareils.`;
    } catch (err) {
      status.style.color = 'var(--danger)';
      status.textContent = `Erreur : ${err.message}`;
    } finally {
      btn.disabled = false; btn.textContent = '↓ Exporter toutes les données (JSON)';
    }
  });

  // ── Devices en attente ────────────────────────────────────────
  try {
    const { devices = [], pending = 0 } = await api('/api/admin/devices?approved=false');
    const container = panel.querySelector('#devices-pending-container');
    if (pending === 0) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Aucun appareil en attente d\'approbation.</p>';
    } else {
      container.innerHTML = `
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
          ${pending} appareil(s) en attente d\'approbation admin.
        </p>
        <table class="data-table">
          <thead><tr>
            <th>Label</th><th>Email</th><th>Type</th><th>Demandé le</th><th>Action</th>
          </tr></thead>
          <tbody id="pending-devices-tbody"></tbody>
        </table>`;
      const tbody = container.querySelector('#pending-devices-tbody');
      devices.forEach(d => {
        const tr = document.createElement('tr');
        const date = d.createdAt ? new Date(d.createdAt).toLocaleDateString('fr-FR') : '—';
        tr.innerHTML = `
          <td>${esc(d.label||'—')}</td>
          <td style="font-size:12px;color:var(--text-muted)">${esc(d.email||'—')}</td>
          <td><span class="badge badge-plan-starter">${esc(d.type||'tablet')}</span></td>
          <td style="font-size:12px;color:var(--text-muted)">${date}</td>
          <td>
            <button class="btn btn-primary btn-sm" data-device-id="${esc(d.id)}" data-action="approve">
              Approuver
            </button>
          </td>`;
        tbody.appendChild(tr);
      });
      tbody.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action="approve"]');
        if (!btn) return;
        btn.disabled = true; btn.textContent = '…';
        try {
          const result = await api('/api/device/approve', 'POST', {
            deviceId: btn.dataset.deviceId, approvedBy: 'admin',
          });
          toast(`✓ Approuvé. Token : ${result.token}`, 'success');
          // Rafraîchir la section
          renderSettings(panel);
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.textContent = 'Approuver';
        }
      });
    }
  } catch (err) {
    panel.querySelector('#devices-pending-container').innerHTML =
      `<p style="font-size:12px;color:var(--danger)">${esc(err.message)}</p>`;
  }

  // ── Purge handler ─────────────────────────────────────────────
  panel.querySelector('#btn-purge-tenant').addEventListener('click', async () => {
    const tenantId = panel.querySelector('#purge-tenant-id').value.trim();
    const btn      = panel.querySelector('#btn-purge-tenant');
    const status   = panel.querySelector('#purge-status');
    if (!tenantId) { status.style.color='var(--danger)'; status.textContent='Tenant ID requis.'; return; }

    const confirmed = confirm(
      `Supprimer TOUTES les données du tenant "${tenantId}" ?\n\n` +
      `• Tous les appareils seront supprimés\n` +
      `• Toutes les licences seront révoquées\n\n` +
      `Cette action est IRRÉVERSIBLE.`
    );
    if (!confirmed) return;

    btn.disabled = true; btn.textContent = '…';
    status.textContent = '';
    try {
      await api('/api/admin/purge-tenant', 'POST', { tenantId });
      status.style.color = 'var(--success)';
      status.textContent = `✓ Données du tenant "${tenantId}" supprimées.`;
      toast(`Tenant "${tenantId}" purgé`, 'error');
    } catch (err) {
      status.style.color = 'var(--danger)';
      status.textContent = `Erreur : ${err.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Supprimer les données';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
// Auto-login si le token est mémorisé (localStorage persiste entre sessions)
if (adminToken) {
  api('/api/licence/list').then(() => showAdmin()).catch(() => logout());
}
