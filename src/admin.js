/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Admin Panel · src/admin.js v1.0
   Vanilla ES Module — Zero framework, zero dependency
   ═══════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────
let adminToken  = sessionStorage.getItem('ks_admin_token') || '';
let catalogData = null;
let padsCache   = {};

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

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'success') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `show ${type}`;
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 3500);
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(title, bodyHTML, footerHTML) {
  modalTitle.textContent = title;
  modalBody.innerHTML    = bodyHTML;
  modalFooter.innerHTML  = footerHTML;
  modalOverlay.classList.remove('hidden');
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── API helper ─────────────────────────────────────────────────
async function api(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type':  'application/json',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(endpoint, opts);

  if (res.status === 401) {
    logout();
    throw new Error('Session expirée');
  }

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

  loginBtn.disabled    = true;
  loginBtn.textContent = '…';
  loginError.textContent = '';

  const prev   = adminToken;
  adminToken   = secret;

  try {
    await api('/api/licence/list');
    sessionStorage.setItem('ks_admin_token', secret);
    showAdmin();
  } catch {
    adminToken             = prev;
    loginError.textContent = 'Secret invalide.';
    loginBtn.disabled      = false;
    loginBtn.textContent   = 'Connexion';
  }
}

function logout() {
  sessionStorage.removeItem('ks_admin_token');
  adminToken = '';
  adminScreen.style.display = 'none';
  loginScreen.style.display = 'flex';
  secretInput.value          = '';
  loginError.textContent     = '';
  loginBtn.disabled          = false;
  loginBtn.textContent       = 'Connexion';
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
  licences:   renderLicences,
  tools:      renderTools,
  catalog:    renderCatalog,
  monitoring: renderMonitoring,
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
    const active  = licences.filter(l => l.active).length;
    const revoked = total - active;

    const statsHtml = `
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Actives</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Révoquées</div><div class="stat-value" style="color:#e05c5c">${revoked}</div></div>
      </div>`;

    const tableHtml = total === 0
      ? `<div class="empty-state"><div class="icon">🗝</div><p>Aucune licence enregistrée</p></div>`
      : `<table class="data-table">
          <thead><tr>
            <th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Créée le</th><th>Actions</th>
          </tr></thead>
          <tbody id="licences-tbody"></tbody>
         </table>`;

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Licences <span>(${total})</span></h2>
        <button class="btn btn-primary" id="btn-new-licence">+ Nouvelle licence</button>
      </div>
      ${statsHtml}
      ${tableHtml}`;

    panel.querySelector('#btn-new-licence').addEventListener('click', () => showCreateLicenceModal(panel));

    if (total > 0) {
      const tbody = panel.querySelector('#licences-tbody');
      licences.forEach(l => {
        const tr  = document.createElement('tr');
        const planBadge = `badge-plan-${(l.plan || '').toLowerCase()}`;
        const date = l.createdAt ? new Date(l.createdAt).toLocaleDateString('fr-FR') : '—';

        tr.innerHTML = `
          <td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
          <td>${esc(l.owner || '—')}</td>
          <td><span class="badge ${planBadge}">${esc(l.plan || '—')}</span></td>
          <td><span class="badge ${l.active ? 'badge-active' : 'badge-revoked'}">${l.active ? 'Active' : 'Révoquée'}</span></td>
          <td style="color:var(--text-muted);font-size:12px">${date}</td>
          <td style="display:flex;gap:8px;align-items:center">
            ${l.active ? `<button class="btn btn-danger btn-sm" data-key="${esc(l.key)}" data-action="revoke">Révoquer</button>` : ''}
            <button class="btn btn-secondary btn-sm"
              data-key="${esc(l.key)}"
              data-owner="${esc(l.owner || '')}"
              data-plan="${esc(l.plan || '')}"
              data-action="edit">Éditer</button>
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
          <input type="text" class="form-input" id="m-key"
                 placeholder="ABCD-1234-EFGH-5678"
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
        <select class="form-select" id="m-plan">
          <option>STARTER</option><option>PRO</option><option>MAX</option>
        </select>
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
    closeModal();
    toast('Licence créée ✓');
    renderLicences(panel);
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Créer la licence';
  }
}

function showEditLicenceModal(key, owner, plan, panel) {
  openModal('Éditer la licence', `
    <div class="form-grid">
      <div class="form-group form-full">
        <label class="form-label">Clé</label>
        <input type="text" class="form-input" value="${esc(key)}" disabled
               style="font-family:'SF Mono',monospace">
      </div>
      <div class="form-group">
        <label class="form-label">Propriétaire</label>
        <input type="text" class="form-input" id="e-owner" value="${esc(owner)}">
      </div>
      <div class="form-group">
        <label class="form-label">Plan</label>
        <select class="form-select" id="e-plan">
          ${['STARTER','PRO','MAX'].map(p => `<option ${plan === p ? 'selected' : ''}>${p}</option>`).join('')}
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
      closeModal();
      toast('Licence mise à jour ✓');
      renderLicences(panel);
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Mettre à jour';
    }
  });
}

function confirmRevoke(key, panel) {
  openModal('Confirmer la révocation', `
    <p style="line-height:1.6">
      Révoquer la licence<br>
      <strong style="font-family:'SF Mono',monospace;color:var(--gold);font-size:15px">${esc(key)}</strong>
      ?<br>
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
      closeModal();
      toast('Licence révoquée', 'error');
      renderLicences(panel);
    } catch (err) {
      toast(err.message, 'error');
      closeModal();
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 2 — OUTILS (PADs)
// ══════════════════════════════════════════════════════════════════

async function renderTools(panel) {
  try {
    const manifest = await fetchJSON('/K_STORE_ASSETS/PADS/manifest.json');
    const padIds   = manifest.pads || [];

    padsCache = {};
    await Promise.all(padIds.map(async id => {
      try { padsCache[id] = await fetchJSON(`/K_STORE_ASSETS/PADS/${id}.json`); }
      catch { padsCache[id] = null; }
    }));

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Outils <span>(${padIds.length} PADs)</span></h2>
        <button class="btn btn-primary" id="btn-new-pad">+ Nouveau PAD</button>
      </div>
      <div class="split-layout">
        <div class="split-left"  id="pad-list"></div>
        <div class="split-right" id="pad-editor">
          <div class="empty-state"><div class="icon">📋</div><p>Sélectionnez un PAD</p></div>
        </div>
      </div>`;

    const padList = panel.querySelector('#pad-list');
    padIds.forEach(id => {
      const item = document.createElement('div');
      item.className    = 'pad-item';
      item.dataset.id   = id;
      const pad         = padsCache[id];
      item.innerHTML    = `<div class="pad-item-id">${esc(id)}</div><div class="pad-item-title">${esc(pad?.title || '(introuvable)')}</div>`;
      item.addEventListener('click', () => openPadEditor(id, panel));
      padList.appendChild(item);
    });

    panel.querySelector('#btn-new-pad').addEventListener('click', () => showNewPadModal(panel));

  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function openPadEditor(id, panel) {
  panel.querySelectorAll('.pad-item').forEach(i => i.classList.toggle('active', i.dataset.id === id));

  const editor = panel.querySelector('#pad-editor');
  const pad    = padsCache[id];
  const json   = JSON.stringify(pad ?? {}, null, 2);

  editor.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:700;color:var(--gold)">${esc(id)}.json</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="btn-fmt">Formater</button>
        <button class="btn btn-primary   btn-sm" id="btn-save-pad">Sauvegarder</button>
      </div>
    </div>
    <textarea class="form-textarea" id="pad-json" style="min-height:calc(100vh - 360px)">${esc(json)}</textarea>
    <p class="form-error" id="pad-err"></p>`;

  const ta = editor.querySelector('#pad-json');

  editor.querySelector('#btn-fmt').addEventListener('click', () => {
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
    } catch {
      editor.querySelector('#pad-err').textContent = 'JSON invalide';
    }
  });

  editor.querySelector('#btn-save-pad').addEventListener('click', () => savePad(id, ta.value, editor));
}

async function savePad(id, jsonStr, editor) {
  const errEl = editor.querySelector('#pad-err');
  const btn   = editor.querySelector('#btn-save-pad');
  errEl.textContent = '';

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch { errEl.textContent = 'JSON invalide — corrigez la syntaxe.'; return; }

  btn.disabled = true; btn.textContent = '…';
  try {
    await api('/api/admin/file-write', 'POST', {
      path:    `K_STORE_ASSETS/PADS/${id}.json`,
      content: JSON.stringify(parsed, null, 2),
      message: `Admin: update ${id}.json`,
    });
    padsCache[id] = parsed;
    toast(`${id}.json sauvegardé ✓`);
  } catch (err) {
    errEl.textContent = err.message;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Sauvegarder';
  }
}

function showNewPadModal(panel) {
  const template = {
    id: 'O-NEW-001',
    padKey: 'B1',
    title: 'Nouveau Outil',
    subtitle: 'Description courte',
    ai_optimized: 'Claude',
    icon: 'default',
    notice: "Instructions pour l'utilisateur.",
    fields: [
      { id: 'champ_1', label: 'Champ 1', type: 'text', placeholder: 'Exemple', required: true, span: 'full' },
    ],
    system_prompt: 'Votre prompt système avec {{champ_1}}',
  };

  openModal('Nouveau PAD', `
    <p style="color:var(--text-muted);font-size:12px">Éditez le template puis sauvegardez. L'ID doit suivre le format NOMEN-K (ex: O-MKT-003).</p>
    <textarea class="form-textarea" id="np-json" style="min-height:420px">${esc(JSON.stringify(template, null, 2))}</textarea>
    <p class="form-error" id="np-err"></p>`,
  `<button class="btn btn-secondary" id="np-cancel">Annuler</button>
   <button class="btn btn-primary"   id="np-save">Créer le PAD</button>`);

  document.getElementById('np-cancel').addEventListener('click', closeModal);
  document.getElementById('np-save').addEventListener('click', () => submitNewPad(panel));
}

async function submitNewPad(panel) {
  const jsonStr = document.getElementById('np-json').value;
  const errEl   = document.getElementById('np-err');
  const btn     = document.getElementById('np-save');
  errEl.textContent = '';

  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch { errEl.textContent = 'JSON invalide'; return; }

  if (!parsed.id) { errEl.textContent = 'Le champ "id" est requis.'; return; }

  btn.disabled = true; btn.textContent = '…';
  try {
    await api('/api/admin/file-write', 'POST', {
      path:    `K_STORE_ASSETS/PADS/${parsed.id}.json`,
      content: JSON.stringify(parsed, null, 2),
      message: `Admin: create ${parsed.id}.json`,
    });

    const manifest = await fetchJSON('/K_STORE_ASSETS/PADS/manifest.json');
    if (!manifest.pads.includes(parsed.id)) {
      manifest.pads.push(parsed.id);
      await api('/api/admin/file-write', 'POST', {
        path:    'K_STORE_ASSETS/PADS/manifest.json',
        content: JSON.stringify(manifest, null, 2),
        message: `Admin: add ${parsed.id} to manifest`,
      });
    }

    closeModal();
    toast(`${parsed.id}.json créé ✓`);
    renderTools(panel);
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Créer le PAD';
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB 3 — CATALOGUE
// ══════════════════════════════════════════════════════════════════

async function renderCatalog(panel) {
  try {
    catalogData    = await fetchJSON('/K_STORE_ASSETS/catalog.json');
    const items    = catalogData.tools || [];

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
          <input data-idx="${idx}" data-field="title" type="text"
                 class="form-input" value="${esc(item.title || '')}"
                 style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:200px"
                 onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">
        </td>
        <td>
          <select data-idx="${idx}" data-field="plan" class="form-select"
                  style="padding:4px 8px;font-size:12px;width:auto">
            ${['STARTER','PRO','MAX'].map(p => `<option ${item.plan===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </td>
        <td>
          <input data-idx="${idx}" data-field="price" type="number"
                 class="form-input" value="${item.price ?? ''}"
                 style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:70px"
                 onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">
        </td>
        <td>
          <input data-idx="${idx}" data-field="lifetimePrice" type="number"
                 class="form-input" value="${item.lifetimePrice ?? ''}"
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
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const idx   = +el.dataset.idx;
        const field = el.dataset.field;
        catalogData.tools[idx][field] = el.type === 'checkbox'
          ? el.checked
          : el.type === 'number'
            ? (el.value === '' ? undefined : +el.value)
            : el.value;
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
      path:    'K_STORE_ASSETS/catalog.json',
      content: JSON.stringify(catalogData, null, 2),
      message: 'Admin: update catalog.json',
    });
    toast('catalog.json sauvegardé ✓');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Sauvegarder';
  }
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
    errEl.textContent = '';

    try { catalogData = JSON.parse(jsonStr); }
    catch { errEl.textContent = 'JSON invalide'; return; }

    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/api/admin/file-write', 'POST', {
        path:    'K_STORE_ASSETS/catalog.json',
        content: JSON.stringify(catalogData, null, 2),
        message: 'Admin: update catalog.json (raw)',
      });
      closeModal();
      toast('catalog.json sauvegardé ✓');
      renderCatalog(panel);
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Sauvegarder';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB 4 — MONITORING
// ══════════════════════════════════════════════════════════════════

async function renderMonitoring(panel) {
  try {
    const { licences = [], total = 0 } = await api('/api/licence/list');

    const active   = licences.filter(l => l.active).length;
    const byPlan   = { STARTER: 0, PRO: 0, MAX: 0 };
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
      <h3 style="font-size:14px;font-weight:700;letter-spacing:-0.02em;margin-bottom:14px">
        Dernières activations
      </h3>
      ${recent.length === 0
        ? '<div class="empty-state"><p>Aucune donnée</p></div>'
        : `<table class="data-table">
            <thead><tr><th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Date</th></tr></thead>
            <tbody>
              ${recent.map(l => {
                const planBadge = `badge-plan-${(l.plan||'').toLowerCase()}`;
                const date = l.createdAt ? new Date(l.createdAt).toLocaleString('fr-FR') : '—';
                return `<tr>
                  <td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
                  <td>${esc(l.owner||'—')}</td>
                  <td><span class="badge ${planBadge}">${esc(l.plan||'—')}</span></td>
                  <td><span class="badge ${l.active?'badge-active':'badge-revoked'}">${l.active?'Active':'Révoquée'}</span></td>
                  <td style="color:var(--text-muted);font-size:12px">${date}</td>
                </tr>`;
              }).join('')}
            </tbody>
           </table>`}`;

    panel.querySelector('#btn-refresh').addEventListener('click', () => renderMonitoring(panel));

  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
// INIT — auto-login si token en session
// ══════════════════════════════════════════════════════════════════
if (adminToken) {
  api('/api/licence/list')
    .then(() => showAdmin())
    .catch(() => logout());
}
