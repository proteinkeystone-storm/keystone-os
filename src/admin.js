/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Admin Panel · src/admin.js v2.0
   Fabrique à Outils — Multi-Engine, Visual Editor
   ═══════════════════════════════════════════════════════════════ */

// ── Engine Registry ────────────────────────────────────────────
const ENGINES = [
  {
    id: 'claude', label: 'Claude', color: '#c9a84c',
    hint: 'Structure XML. Balises <contexte>, <données_client>, <instructions>. Excellent pour le ton Luxe/Sobre et les rédactions contractuelles.',
  },
  {
    id: 'gpt4o', label: 'GPT-4o', color: '#74aa9c',
    hint: 'Chain-of-Thought. Commencer par "Analyse d\'abord les points forts, puis rédige…" Instructions séquentielles étape par étape.',
  },
  {
    id: 'gemini', label: 'Gemini', color: '#4285f4',
    hint: 'Input massif multi-documents. Instructions basées sur l\'extraction de données brutes. Fenêtre de contexte étendue — idéal pour analyser des dossiers complets.',
  },
  {
    id: 'mistral', label: 'Mistral', color: '#ff7000',
    hint: 'Concision + Bullet points. Instructions courtes et directes. Éviter les longs paragraphes. Idéal pour les fiches descriptives rapides.',
  },
  {
    id: 'perplexity', label: 'Perplexity', color: '#20b2aa',
    hint: 'Requête d\'investigation sourcée. Formuler comme "Trouve les dernières données sur…" Citations et sources attendues en sortie.',
  },
  {
    id: 'grok', label: 'Grok', color: '#aaaaaa',
    hint: 'Formatage strict JSON/Tableaux. Très direct et sans langue de bois. Toujours préciser le format de sortie attendu explicitement.',
  },
];

const ICON_MAP = {
  vefa: '📋', ad: '📢', mail: '✉️', social: '📱', brief: '📸',
  site: '🏗', foncier: '🌍', chat: '💬', calc: '🧮', zap: '⚡',
  table: '📊', default: '⚙️',
};

const FIELD_TYPES = ['text', 'textarea', 'select', 'number'];
const CATEGORIES  = ['IMM', 'COM', 'PRD', 'ANL', 'ADM'];

// ── State ──────────────────────────────────────────────────────
let adminToken   = sessionStorage.getItem('ks_admin_token') || '';
let catalogData  = null;
let padsCache    = {};
let editingPadId = null;

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
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
  const res  = await fetch(endpoint, opts);
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
    sessionStorage.setItem('ks_admin_token', secret);
    showAdmin();
  } catch {
    adminToken = prev;
    loginError.textContent = 'Secret invalide.';
    loginBtn.disabled = false; loginBtn.textContent = 'Connexion';
  }
}
function logout() {
  sessionStorage.removeItem('ks_admin_token');
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
  licences: renderLicences, tools: renderTools,
  catalog: renderCatalog, monitoring: renderMonitoring,
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
    <p style="line-height:1.7">
      Révoquer la licence<br>
      <strong style="font-family:'SF Mono',monospace;color:var(--gold);font-size:15px">${esc(key)}</strong> ?<br>
      <span style="color:var(--text-muted);font-size:12px">L'utilisateur perdra immédiatement l'accès.</span>
    </p>`,
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
// TAB 2 — FABRIQUE À OUTILS
// ══════════════════════════════════════════════════════════════════

// Normalise les anciens PADs (system_prompt) vers le nouveau format (engines)
function normalizePad(pad) {
  if (!pad) return null;
  const p = JSON.parse(JSON.stringify(pad)); // deep clone

  if (!p.type) p.type = 'tool';

  if (!p.engines) {
    const legacyEngine = {
      claude: 'claude', chatgpt: 'gpt4o', 'gpt-4': 'gpt4o', gpt4: 'gpt4o',
      gemini: 'gemini', mistral: 'mistral', perplexity: 'perplexity', grok: 'grok',
    };
    const rawEngine = (p.ai_optimized || 'claude').toLowerCase().replace(/[^a-z0-9]/g, '');
    const engId = legacyEngine[rawEngine] || 'claude';
    p.engines = {
      default:   engId,
      available: [engId],
      prompts:   { [engId]: p.system_prompt || '' },
    };
  }
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
        <h2 class="section-title">Fabrique à Outils
          <span>${toolCount} outils · ${arteCount} artefacts</span>
        </h2>
        <button class="btn btn-primary" id="btn-new-pad">+ Nouveau PAD</button>
      </div>
      <div class="split-layout">
        <div class="split-left" id="pad-list"></div>
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

    // Re-select previously editing pad
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
  };
  renderEditor(panel.querySelector('#pad-editor'), pad, false);
}

// ── Editor ─────────────────────────────────────────────────────
function renderEditor(container, pad, isNew) {
  const fieldCount = (pad.fields || []).length;

  container.innerHTML = `
    <div id="card-preview"></div>

    <div class="editor-tabs-bar">
      <button class="editor-tab-btn active" data-etab="identity">Identité</button>
      <button class="editor-tab-btn" data-etab="fields">
        Champs <span class="field-count">(${fieldCount})</span>
      </button>
      <button class="editor-tab-btn" data-etab="engines">Moteurs</button>
    </div>

    <div id="etab-identity" class="editor-tab-content active"></div>
    <div id="etab-fields"   class="editor-tab-content"></div>
    <div id="etab-engines"  class="editor-tab-content"></div>

    <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <p class="form-error" id="editor-err" style="flex:1;margin:0"></p>
      <button class="btn btn-primary" id="btn-editor-save">Sauvegarder →</button>
    </div>`;

  // Editor tab switching
  container.querySelectorAll('.editor-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.editor-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.editor-tab-content').forEach(c => c.classList.toggle('active', c.id === `etab-${btn.dataset.etab}`));
    });
  });

  renderCardPreview(container.querySelector('#card-preview'), pad);
  renderIdentityTab(container.querySelector('#etab-identity'), pad, container);
  renderFieldsTab(container.querySelector('#etab-fields'), pad, container);
  renderEnginesTab(container.querySelector('#etab-engines'), pad);

  container.querySelector('#btn-editor-save').addEventListener('click', () => {
    saveFromEditor(container, pad.id, isNew);
  });
}

// ── Card Preview ───────────────────────────────────────────────
function renderCardPreview(el, pad) {
  const type      = pad.type || 'tool';
  const engId     = pad.engines?.default || 'claude';
  const engCfg    = ENGINES.find(e => e.id === engId) || ENGINES[0];

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
  const title    = container.querySelector('#id-title')?.value    || '';
  const subtitle = container.querySelector('#id-subtitle')?.value || '';
  const icon     = container.querySelector('#id-icon')?.value     || '';
  const type     = container.querySelector('[name="pad-type"]:checked')?.value || 'tool';
  const engId    = container.querySelector('#id-default-engine')?.value || 'claude';
  const engCfg   = ENGINES.find(e => e.id === engId) || ENGINES[0];

  const el = (id) => container.querySelector(`#${id}`);
  if (el('prev-title'))    el('prev-title').textContent    = title    || 'Titre du PAD';
  if (el('prev-sub'))      el('prev-sub').textContent      = subtitle || 'Description courte';
  if (el('prev-icon'))     el('prev-icon').textContent     = iconEmoji(icon);

  const typeBadge = el('prev-type-badge');
  if (typeBadge) {
    typeBadge.className   = `type-badge type-badge-${type}`;
    typeBadge.textContent = type === 'artifact' ? 'ARTEFACT' : 'OUTIL';
  }
  const engPill = el('prev-engine-pill');
  if (engPill) {
    engPill.textContent         = engCfg.label;
    engPill.style.background    = `${engCfg.color}22`;
    engPill.style.color         = engCfg.color;
    engPill.style.borderColor   = `${engCfg.color}44`;
  }
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

  // Live preview
  ['#id-title', '#id-subtitle', '#id-icon'].forEach(sel => {
    el.querySelector(sel)?.addEventListener('input', () => refreshPreview(rootContainer));
  });
  el.querySelectorAll('[name="pad-type"]').forEach(r => {
    r.addEventListener('change', () => {
      el.querySelectorAll('.type-radio').forEach(l => {
        l.classList.toggle('active', l.querySelector('input').checked);
      });
      refreshPreview(rootContainer);
    });
  });
}

// ── Champs Tab ─────────────────────────────────────────────────
function renderFieldsTab(el, pad, rootContainer) {
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
  (pad.fields || []).forEach(f => fc.appendChild(createFieldRow(f, rootContainer)));

  el.querySelector('#btn-add-field').addEventListener('click', () => {
    const row = createFieldRow({ id: '', label: '', type: 'text', placeholder: '', required: false }, rootContainer);
    fc.appendChild(row);
    updateFieldCount(rootContainer);
    row.querySelector('.field-label-input')?.focus();
  });
}

function createFieldRow(field, rootContainer) {
  const div = document.createElement('div');
  div.className = 'field-row';
  div.innerHTML = `
    <div class="field-row-grid">
      <div class="form-group">
        <label class="form-label">Label</label>
        <input type="text" class="form-input field-label-input"
               value="${esc(field.label || '')}" placeholder="Nom du programme">
      </div>
      <div class="form-group">
        <label class="form-label">ID</label>
        <input type="text" class="form-input field-id-input"
               value="${esc(field.id || '')}" placeholder="nom_programme"
               style="font-family:'SF Mono',monospace;font-size:12px">
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="form-select field-type-select">
          ${FIELD_TYPES.map(t => `<option ${field.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label field-ph-label">Placeholder</label>
        <input type="text" class="form-input field-placeholder-input"
               value="${esc(field.placeholder || (field.options ? field.options.join(', ') : ''))}"
               placeholder="ex: Les Jardins du Midi">
      </div>
    </div>
    <div style="display:flex;gap:20px;align-items:center;margin-top:10px">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none">
        <input type="checkbox" class="field-required-cb" ${field.required ? 'checked' : ''}>
        Requis
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none">
        <input type="checkbox" class="field-span-cb" ${field.span === 'full' ? 'checked' : ''}>
        Pleine largeur
      </label>
      <button class="btn btn-danger btn-sm field-delete-btn" style="margin-left:auto">✕ Supprimer</button>
    </div>`;

  // Auto-generate ID from label (unless manually edited)
  const labelInput = div.querySelector('.field-label-input');
  const idInput    = div.querySelector('.field-id-input');
  labelInput.addEventListener('input', () => {
    if (!idInput.dataset.manual) idInput.value = slugify(labelInput.value);
  });
  idInput.addEventListener('input', () => { idInput.dataset.manual = '1'; });

  // Adapt placeholder label when type = select
  const typeSelect = div.querySelector('.field-type-select');
  const phLabel    = div.querySelector('.field-ph-label');
  const phInput    = div.querySelector('.field-placeholder-input');
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'select') {
      phLabel.textContent  = 'Options (virgules)';
      phInput.placeholder  = 'Option A, Option B, Option C';
    } else {
      phLabel.textContent  = 'Placeholder';
      phInput.placeholder  = 'ex: valeur attendue';
    }
  });

  div.querySelector('.field-delete-btn').addEventListener('click', () => {
    div.remove();
    if (rootContainer) updateFieldCount(rootContainer);
  });

  return div;
}

function collectFields(editorContainer) {
  return Array.from(editorContainer.querySelectorAll('.field-row')).map(row => {
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

function updateFieldCount(editorContainer) {
  if (!editorContainer) return;
  const count = editorContainer.querySelectorAll('.field-row').length;
  const el    = editorContainer.querySelector('.field-count');
  if (el) el.textContent = `(${count})`;
}

// ── Moteurs Tab ────────────────────────────────────────────────
function renderEnginesTab(el, pad) {
  const prompts    = pad.engines?.prompts || {};
  const defaultEng = pad.engines?.default || 'claude';
  const fieldTokens = (pad.fields || []).map(f => `{{${f.id}}}`).join('  ');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <label class="form-label" style="white-space:nowrap;margin:0">Moteur par défaut :</label>
      <select class="form-select" id="id-default-engine" style="width:auto">
        ${ENGINES.map(e => `<option value="${e.id}" ${defaultEng === e.id ? 'selected' : ''}>${e.label}</option>`).join('')}
      </select>
      <span style="color:var(--text-muted);font-size:11px">
        (définit <code style="color:var(--gold)">ai_optimized</code> et le prompt de copie par défaut)
      </span>
    </div>

    <div class="engine-tabs-bar" id="engine-tabs-bar">
      ${ENGINES.map(e => {
        const hasPrompt = !!(prompts[e.id]);
        const isDefault = e.id === defaultEng;
        return `<button class="engine-tab-btn ${isDefault ? 'active' : ''}"
                        data-engine="${e.id}"
                        style="--eng-color:${e.color}">
          ${e.label}${hasPrompt ? ' ●' : ''}${isDefault ? ' ★' : ''}
        </button>`;
      }).join('')}
    </div>

    <div id="engine-panels">
      ${ENGINES.map(e => `
        <div class="engine-panel ${e.id === defaultEng ? 'active' : ''}" data-engine-panel="${e.id}">
          <div class="engine-hint">${esc(e.hint)}</div>
          ${fieldTokens
            ? `<div class="engine-tokens">Variables disponibles : <span style="color:var(--gold);font-family:'SF Mono',monospace;font-size:11px">${esc(fieldTokens)}</span></div>`
            : `<div class="engine-tokens" style="color:var(--text-muted);font-size:11px">💡 Définissez des champs dans l'onglet "Champs" pour voir les variables disponibles.</div>`}
          <textarea class="form-textarea engine-prompt" data-engine="${e.id}"
                    style="min-height:240px" placeholder="Prompt Keystone pour ${e.label}…">${esc(prompts[e.id] || '')}</textarea>
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

  // Update default engine pill in preview when dropdown changes
  el.querySelector('#id-default-engine').addEventListener('change', e => {
    const root = document.getElementById('tab-tools')?.querySelector('#pad-editor');
    if (root) refreshPreview(root);

    // Update star markers on tabs
    const newDefault = e.target.value;
    el.querySelectorAll('.engine-tab-btn').forEach(btn => {
      const eng   = btn.dataset.engine;
      const label = ENGINES.find(x => x.id === eng)?.label || eng;
      const hasPr = !!(el.querySelector(`.engine-prompt[data-engine="${eng}"]`)?.value.trim());
      btn.textContent = `${label}${hasPr ? ' ●' : ''}${eng === newDefault ? ' ★' : ''}`;
    });
  });

  // Dot markers when user types
  el.querySelectorAll('.engine-prompt').forEach(ta => {
    ta.addEventListener('input', () => {
      const btn = el.querySelector(`.engine-tab-btn[data-engine="${ta.dataset.engine}"]`);
      if (!btn) return;
      const label      = ENGINES.find(x => x.id === ta.dataset.engine)?.label || ta.dataset.engine;
      const isDefault  = el.querySelector('#id-default-engine')?.value === ta.dataset.engine;
      btn.textContent  = `${label}${ta.value.trim() ? ' ●' : ''}${isDefault ? ' ★' : ''}`;
    });
  });
}

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
function collectEditorState(editorContainer) {
  const id       = editorContainer.querySelector('#id-nomenk')?.value.trim()  || '';
  const type     = editorContainer.querySelector('[name="pad-type"]:checked')?.value || 'tool';
  const fields   = collectFields(editorContainer);
  const engines  = collectEngines(editorContainer);
  const engLabel = ENGINES.find(e => e.id === engines.default)?.label || engines.default;

  return {
    id,
    type,
    padKey:       editorContainer.querySelector('#id-padkey')?.value.trim() || null,
    title:        editorContainer.querySelector('#id-title')?.value.trim()   || '',
    subtitle:     editorContainer.querySelector('#id-subtitle')?.value.trim() || '',
    ai_optimized: engLabel,
    icon:         editorContainer.querySelector('#id-icon')?.value.trim()     || '',
    category:     editorContainer.querySelector('#id-category')?.value        || 'IMM',
    notice:       editorContainer.querySelector('#id-notice')?.value.trim()   || '',
    fields,
    engines,
    // Backward compat — renderer lit system_prompt si engines absent
    system_prompt: engines.prompts[engines.default] || '',
  };
}

async function saveFromEditor(editorContainer, originalId, isNew) {
  const errEl = document.getElementById('editor-err');
  const btn   = editorContainer.querySelector('#btn-editor-save');
  errEl.textContent = '';

  const pad = collectEditorState(editorContainer);
  if (!pad.id)    { errEl.textContent = 'L\'ID NOMEN-K est requis (ex: O-IMM-001).'; return; }
  if (!pad.title) { errEl.textContent = 'Le titre est requis.'; return; }

  btn.disabled = true; btn.textContent = '…';
  try {
    await api('/api/admin/file-write', 'POST', {
      path:    `K_STORE_ASSETS/PADS/${pad.id}.json`,
      content: JSON.stringify(pad, null, 2),
      message: `Admin: ${isNew ? 'create' : 'update'} ${pad.id}.json`,
    });

    // Mise à jour du manifest si nouveau PAD ou ID changé
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

    // Refresh list + re-select
    const panel = document.getElementById('tab-tools');
    await renderTools(panel);

  } catch (err) {
    errEl.textContent = err.message;
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Sauvegarder →';
  }
}

// ── New PAD — Type chooser ─────────────────────────────────────
function showNewPadTypeModal(panel) {
  openModal('Nouveau PAD — Choisir le type', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <button class="type-choice-btn" data-type="tool">
        <div style="font-size:36px;margin-bottom:12px">🔧</div>
        <div style="font-size:14px;font-weight:900;color:var(--gold);letter-spacing:-0.02em;margin-bottom:8px">OUTIL</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          Générateur de prompt multi-moteur.<br>
          L'utilisateur remplit des champs,<br>
          Keystone envoie à l'IA cible.
        </div>
      </button>
      <button class="type-choice-btn" data-type="artifact">
        <div style="font-size:36px;margin-bottom:12px">🔷</div>
        <div style="font-size:14px;font-weight:900;color:#6496ff;letter-spacing:-0.02em;margin-bottom:8px">ARTEFACT</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          Shell de données JSON.<br>
          Définit le schéma de retour<br>
          pour injection graphique.
        </div>
      </button>
    </div>`);

  document.querySelectorAll('.type-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal();
      editingPadId = null;
      const newPad = {
        id: '', type: btn.dataset.type, padKey: '', title: '', subtitle: '',
        ai_optimized: 'Claude', icon: '', category: 'IMM', notice: '',
        fields: [], engines: { default: 'claude', available: ['claude'], prompts: {} },
        system_prompt: '',
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
    catalogData  = await fetchJSON('/K_STORE_ASSETS/catalog.json');
    const items  = catalogData.tools || [];

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Catalogue <span>(${items.length} entrées)</span></h2>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" id="btn-raw-catalog">JSON brut</button>
          <button class="btn btn-primary"   id="btn-save-catalog">Sauvegarder</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>ID</th><th>Titre</th><th>Plan</th><th>Prix</th><th>Lifetime</th><th>Publié</th><th>Nouveau</th>
        </tr></thead>
        <tbody id="catalog-tbody"></tbody>
      </table>`;

    const tbody = panel.querySelector('#catalog-tbody');
    items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:11px;color:var(--gold)">${esc(item.id)}</code></td>
        <td>
          <input data-idx="${idx}" data-field="title" type="text" class="form-input"
                 value="${esc(item.title || '')}"
                 style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:200px"
                 onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">
        </td>
        <td>
          <select data-idx="${idx}" data-field="plan" class="form-select"
                  style="padding:4px 8px;font-size:12px;width:auto">
            ${['STARTER','PRO','MAX'].map(p => `<option ${item.plan === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </td>
        <td>
          <input data-idx="${idx}" data-field="price" type="number" class="form-input"
                 value="${item.price ?? ''}"
                 style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:70px"
                 onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">
        </td>
        <td>
          <input data-idx="${idx}" data-field="lifetimePrice" type="number" class="form-input"
                 value="${item.lifetimePrice ?? ''}"
                 style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:70px"
                 onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">
        </td>
        <td>
          <label class="toggle-switch">
            <input data-idx="${idx}" data-field="published" type="checkbox" ${item.published ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>
          <label class="toggle-switch">
            <input data-idx="${idx}" data-field="isNew" type="checkbox" ${item.isNew ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </td>`;
      tbody.appendChild(tr);
    });

    panel.querySelectorAll('[data-idx][data-field]').forEach(el => {
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const idx   = +el.dataset.idx;
        const field = el.dataset.field;
        catalogData.tools[idx][field] = el.type === 'checkbox'
          ? el.checked
          : el.type === 'number' ? (el.value === '' ? undefined : +el.value) : el.value;
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
  catalogData.updatedAt = new Date().toISOString().slice(0, 10);
  try {
    await api('/api/admin/file-write', 'POST', {
      path: 'K_STORE_ASSETS/catalog.json', content: JSON.stringify(catalogData, null, 2),
      message: 'Admin: update catalog.json',
    });
    toast('catalog.json sauvegardé ✓');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Sauvegarder'; }
}

function showRawCatalogEditor(panel) {
  openModal('catalog.json — Éditeur brut', `
    <textarea class="form-textarea" id="cr-json" style="min-height:500px">${esc(JSON.stringify(catalogData, null, 2))}</textarea>
    <p class="form-error" id="cr-err"></p>`,
  `<button class="btn btn-secondary" id="cr-cancel">Annuler</button>
   <button class="btn btn-primary"   id="cr-save">Sauvegarder</button>`);

  document.getElementById('cr-cancel').addEventListener('click', closeModal);
  document.getElementById('cr-save').addEventListener('click', async () => {
    const jsonStr = document.getElementById('cr-json').value;
    const errEl   = document.getElementById('cr-err');
    const btn     = document.getElementById('cr-save');
    try { catalogData = JSON.parse(jsonStr); } catch { errEl.textContent = 'JSON invalide'; return; }
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/api/admin/file-write', 'POST', {
        path: 'K_STORE_ASSETS/catalog.json', content: JSON.stringify(catalogData, null, 2),
        message: 'Admin: update catalog.json (raw)',
      });
      closeModal(); toast('catalog.json sauvegardé ✓'); renderCatalog(panel);
    } catch (err) { errEl.textContent = err.message; btn.disabled = false; btn.textContent = 'Sauvegarder'; }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 4 — MONITORING
// ══════════════════════════════════════════════════════════════════
async function renderMonitoring(panel) {
  try {
    const { licences = [], total = 0 } = await api('/api/licence/list');
    const active = licences.filter(l => l.active).length;
    const byPlan = { STARTER: 0, PRO: 0, MAX: 0 };
    licences.forEach(l => { if (l.active && l.plan in byPlan) byPlan[l.plan]++; });
    const recent = [...licences]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

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
      ${recent.length === 0
        ? '<div class="empty-state"><p>Aucune donnée</p></div>'
        : `<table class="data-table">
            <thead><tr><th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Date</th></tr></thead>
            <tbody>${recent.map(l => {
              const pb   = `badge-plan-${(l.plan || '').toLowerCase()}`;
              const date = l.createdAt ? new Date(l.createdAt).toLocaleString('fr-FR') : '—';
              return `<tr>
                <td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
                <td>${esc(l.owner || '—')}</td>
                <td><span class="badge ${pb}">${esc(l.plan || '—')}</span></td>
                <td><span class="badge ${l.active ? 'badge-active' : 'badge-revoked'}">${l.active ? 'Active' : 'Révoquée'}</span></td>
                <td style="color:var(--text-muted);font-size:12px">${date}</td>
              </tr>`;
            }).join('')}</tbody>
           </table>`}`;

    panel.querySelector('#btn-refresh').addEventListener('click', () => renderMonitoring(panel));

  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
if (adminToken) {
  api('/api/licence/list').then(() => showAdmin()).catch(() => logout());
}
