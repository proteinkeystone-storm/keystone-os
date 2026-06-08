/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Admin Panel · src/admin.js v4.0
   La Fabrique — Sprint Rectif : Preview WYSIWYG, Drag & Drop,
   Schema live, Sandbox JSON
   ═══════════════════════════════════════════════════════════════ */

import { renderArtifactResult } from './artifact-renderer.js';
import { KSTORE_CATEGORIES, KSTORE_PROMOS } from './kstore-mock-catalog.js';
import { VEFA_CLAUSES_V1 }      from './lib/doc-templates/vefa-clauses-seed.js';
import { VEFA_CLAUSES_V2 }      from './lib/doc-templates/vefa-clauses-seed-v2.js';
import { VEFA_CONTRAT_CLAUSES_V1 } from './lib/doc-templates/vefa-contrat-clauses-seed.js';

// ── Moteurs IA disponibles (fiches Key-Store) ──────────────────
// Sert au select "Optimisé pour" + checkboxes "Moteurs compatibles".
const KSTORE_AI_ENGINES = [
  'Claude', 'GPT-5', 'Gemini', 'Mistral',
  'Perplexity', 'Grok', 'Meta AI', 'Llama',
];

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
// Toutes les requêtes API pointent vers le Worker Cloudflare, y compris
// en local (le preview statique n'a pas de backend, donc inutile de proxy
// vers `''`). Pour utiliser un Worker local (`wrangler dev` sur :8787),
// pose `?api=local` dans l'URL ou définis ks_admin_api_base en localStorage.
const CF_WORKER_URL = 'https://keystone-os-api.keystone-os.workers.dev';
const _override     = new URLSearchParams(location.search).get('api');
const _customBase   = localStorage.getItem('ks_admin_api_base');
const API_BASE      = _customBase
                    ? _customBase
                    : _override === 'local'
                      ? 'http://localhost:8787'
                      : CF_WORKER_URL;

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

// ── Compression d'image avant upload ──────────────────────────────
// POURQUOI : les images partaient brutes en base64 (jusqu'à ~4 Mo) vers D1,
// qui plafonne la taille d'une ligne — et Safari échoue en « Load failed »
// sur ces gros POST cross-origin. On redimensionne + ré-encode côté navigateur
// (canvas) pour rester largement sous un budget d'octets.
//   - format 'jpeg' (photos : cover, captures, bandeau) → léger.
//   - format 'png'  (icône/logo) → conserve la transparence.
//   - GIF animé déjà sous budget → laissé tel quel (le canvas l'aplatirait).
// Retourne { base64, mime } (base64 = payload brut, sans préfixe "data:...,").
function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lecture du fichier échouée'));
    r.readAsDataURL(file);
  });
}
function _loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible (format non supporté ?)'));
    img.src = src;
  });
}
async function compressImageForUpload(file, { maxDim = 1600, budgetBytes = 700 * 1024, format = 'jpeg' } = {}) {
  const dataUrl     = await _readFileAsDataURL(file);
  const stripPrefix = (u) => u.slice(u.indexOf(',') + 1);

  // GIF : ne pas recompresser s'il tient déjà dans le budget (préserve l'anim).
  if (file.type === 'image/gif') {
    const b64 = stripPrefix(dataUrl);
    if (b64.length <= budgetBytes) return { base64: b64, mime: 'image/gif' };
    format = 'jpeg';  // trop lourd → on l'aplatit (perd l'anim, mais upload OK)
  }

  const img     = await _loadImageEl(dataUrl);
  const outMime = format === 'png' ? 'image/png' : 'image/jpeg';
  let dim       = maxDim;
  let quality   = 0.85;

  // Itère : baisse d'abord la qualité JPEG, puis la dimension, jusqu'au budget.
  for (let i = 0; i < 12; i++) {
    const scale = Math.min(1, dim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width  * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const out = outMime === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', quality);
    const b64 = stripPrefix(out);
    if (b64.length <= budgetBytes) return { base64: b64, mime: outMime };
    if (outMime === 'image/jpeg' && quality > 0.5) quality -= 0.1;
    else dim = Math.round(dim * 0.82);
  }
  throw new Error('Image impossible à compresser sous la limite. Essaie une image plus légère.');
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

// Upload multipart (fichier binaire). NE PAS poser Content-Type : le
// navigateur calcule lui-même la frontière multipart/form-data.
async function apiUpload(endpoint, formData) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` },
    body: formData,
  });
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

    // S5.6 — Pose AUSSI un ks_jwt user lié à la licence ADMIN active,
    // pour que le Cloud Vault sync puisse fonctionner cross-device.
    // Sans ce JWT, le Mac restait silencieusement "muet" côté serveur
    // et iPad/iPhone ne pouvaient rien restaurer (bug récurrent 21/05).
    try {
      const jwtResp = await api('/api/admin/issue-jwt', 'POST');
      if (jwtResp?.jwt) {
        localStorage.setItem('ks_jwt', jwtResp.jwt);
        localStorage.setItem('ks_licence_plan', jwtResp.plan || 'ADMIN');
        if (jwtResp.email) localStorage.setItem('ks_user_email', jwtResp.email);
        if (jwtResp.owner) localStorage.setItem('ks_user_owner', jwtResp.owner);
        if (jwtResp.licence_key) localStorage.setItem('ks_licence_key', jwtResp.licence_key);
        console.log('[S5.6] JWT admin posé, Cloud Vault sync activé pour', jwtResp.email || jwtResp.owner || '(sans email)');
      }
    } catch (e) {
      // Non bloquant : si le backend est ancien (pas encore S5.6 deployé)
      // ou si pas de licence ADMIN en DB, on reste sur le flow legacy.
      console.warn('[S5.6] JWT admin non émis — Cloud Vault sync indisponible cross-device', e.message);
    }

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
// ── Tab routing — niveau 1 (top nav) ───────────────────────────
// Clauses n'est plus un onglet top-level : c'est une sous-section
// de La Fabrique (cf. FABRIQUE_SUB_TABS plus bas).
const TAB_RENDERERS = {
  licences:   renderLicences,
  tools:      renderTools,
  catalog:    renderCatalog,
  promos:     renderPromos,        // À la une — éditeur des bandeaux du hero Key-Store (2026-05-29)
  // messaging : onglet retiré le 2026-06-01 — éclipsé par le Living Layer (même
  // ligne #hero-dst, masquée quand le V2 est ON, càd par défaut). renderMessaging
  // conservé (non câblé) pour réversibilité ; backend /api/admin/messages intact.
  living:     renderLivingLayer,   // Living Layer V2 — Ordinateur de bord (2026-05-28)
  budget:     renderBudget,        // Budget IA — compteur neurones + bridage (2026-05-29)
  monitoring: renderMonitoring,
  devices:    renderDevices,
  audit:      renderAuditLog,      // Sprint S5.4
  settings:   renderSettings,
};

// Mémoire de la sous-section active dans La Fabrique (persiste
// pendant la session — pas en localStorage, repart sur 'pads' au reload).
let fabriqueActiveSubTab = 'pads';
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
// TAB 1 — LICENCES (enrichi Sprint S5.4 — flags S2.5/S4 + stats)
// ══════════════════════════════════════════════════════════════════
// Helper de normalisation : convertit les rows de /api/admin/licences
// (enrichi S5.3) OU /api/licence/list (legacy) vers un format uniforme.
// Permet le fallback gracieux si l'endpoint enrichi throw.
function _normalizeLicenceRow(l) {
  if (!l) return null;
  return {
    key:           l.key,
    owner:         l.owner || '',
    plan:          l.plan || '',
    owned_assets:  Array.isArray(l.owned_assets) ? l.owned_assets : null,
    active:        l.is_active === true || l.active === true,
    createdAt:     l.created_at || l.createdAt || null,
    expiresAt:     l.expires_at || l.expiresAt || null,
    tenant_id:     l.tenant_id || null,
    domain_locked: l.domain_locked || null,
    devices_max:   typeof l.devices_max === 'number' ? l.devices_max : null,
    // S2.5 + S4 — flags whitelistés. Absent en legacy → defaultent à false.
    flag_enforce_devices_v2:         l?.flags?.enforce_devices_v2 === true,
    flag_enforce_vault_per_email_v2: l?.flags?.enforce_vault_per_email_v2 === true,
    flag_enforce_ai_credits_v1:      l?.flags?.enforce_ai_credits_v1 === true,
    // Stats S5.3 — absent en legacy → defaultent à null (affichera '—')
    stats: l.stats || null,
  };
}

async function renderLicences(panel) {
  try {
    // S5.4 — tente d'abord l'endpoint enrichi (S5.3), fallback legacy.
    let licences = [];
    let total = 0;
    let usingEnriched = false;
    try {
      const res = await api('/api/admin/licences');
      licences = (res.licences || []).map(_normalizeLicenceRow);
      total = res.total ?? licences.length;
      usingEnriched = true;
    } catch (e) {
      console.warn('[admin] /api/admin/licences a échoué, fallback /api/licence/list', e.message);
      const res = await api('/api/licence/list');
      licences = (res.licences || []).map(_normalizeLicenceRow);
      total = res.total ?? licences.length;
    }

    const active = licences.filter(l => l.active).length;
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Licences <span>(${total})</span></h2>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="btn-run-reminders" title="Sprint S5.2 — déclenche le cron rappels expiration manuellement (respecte le kill-switch dormant)">⏰ Rappels expiration</button>
          <button class="btn btn-primary" id="btn-new-licence">+ Nouvelle licence</button>
        </div>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Actives</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Révoquées</div><div class="stat-value" style="color:#e05c5c">${total - active}</div></div>
      </div>
      ${!usingEnriched ? '<div style="margin:8px 0 16px 0;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--text-muted)">⚠ Mode legacy : les contrôles par licence sont indisponibles, basculez vers /api/admin/licences pour la version enrichie.</div>' : ''}
      ${total === 0
        ? '<div class="empty-state"><div class="icon">🗝</div><p>Aucune licence enregistrée</p></div>'
        : `<table class="data-table"><thead><tr>
             <th>Clé</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Devices</th><th>Contrôles par licence</th><th>Créée le</th><th>Actions</th>
           </tr></thead><tbody id="licences-tbody"></tbody></table>`}`;

    panel.querySelector('#btn-new-licence').addEventListener('click', () => showCreateLicenceModal(panel));
    panel.querySelector('#btn-run-reminders').addEventListener('click', () => runExpirationRemindersNow(panel));

    if (total > 0) {
      const tbody = panel.querySelector('#licences-tbody');
      licences.forEach(l => {
        const tr = document.createElement('tr');
        const pb = `badge-plan-${(l.plan || '').toLowerCase()}`;
        const date = l.createdAt ? new Date(l.createdAt).toLocaleDateString('fr-FR') : '—';
        const devicesCell = l.stats
          ? `<span style="color:var(--text)">${l.stats.devices_active}</span><span style="color:var(--text-muted)">${l.devices_max != null ? ' / ' + l.devices_max : ''}</span>`
          : '<span style="color:var(--text-muted)">—</span>';

        // Chaque interrupteur a un libellé visible (sinon 3 pastilles
        // identiques = illisible) + une infobulle en français clair.
        const flagsCell = usingEnriched
          ? `<div style="display:flex;gap:16px;align-items:flex-start">
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                <label class="toggle-switch" title="Limiter le nombre d'appareils autorisés par licence" style="display:inline-block">
                  <input type="checkbox" data-key="${esc(l.key)}" data-flag="enforce_devices_v2" ${l.flag_enforce_devices_v2 ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">Appareils</span>
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                <label class="toggle-switch" title="Isoler le coffre-fort de données par adresse e-mail" style="display:inline-block">
                  <input type="checkbox" data-key="${esc(l.key)}" data-flag="enforce_vault_per_email_v2" ${l.flag_enforce_vault_per_email_v2 ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">Coffre / e-mail</span>
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                <label class="toggle-switch" title="Activer le compteur de crédits IA (Concierge, Ghost Writer, Brainstorming)" style="display:inline-block">
                  <input type="checkbox" data-key="${esc(l.key)}" data-flag="enforce_ai_credits_v1" ${l.flag_enforce_ai_credits_v1 ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <span style="font-size:10px;color:var(--gold);white-space:nowrap">Crédits IA</span>
              </div>
            </div>`
          : '<span style="color:var(--text-muted)">—</span>';

        tr.innerHTML = `
          <td><code style="font-size:12px;font-family:'SF Mono',monospace;color:var(--gold)">${esc(l.key)}</code></td>
          <td>${esc(l.owner || '—')}</td>
          <td><span class="badge ${pb}">${esc(l.plan || '—')}</span></td>
          <td><span class="badge ${l.active ? 'badge-active' : 'badge-revoked'}">${l.active ? 'Active' : 'Révoquée'}</span></td>
          <td style="font-size:13px">${devicesCell}</td>
          <td>${flagsCell}</td>
          <td style="color:var(--text-muted);font-size:12px">${date}</td>
          <td style="display:flex;gap:8px;align-items:center">
            ${l.active ? `<button class="btn btn-danger btn-sm" data-key="${esc(l.key)}" data-action="revoke">Révoquer</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-key="${esc(l.key)}" data-owner="${esc(l.owner||'')}" data-plan="${esc(l.plan||'')}" data-assets="${esc((l.owned_assets || []).join(','))}" data-action="edit">Éditer</button>
          </td>`;
        tbody.appendChild(tr);
      });

      // Actions inline (revoke/edit) — event delegation comme avant
      tbody.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'revoke') confirmRevoke(btn.dataset.key, panel);
        if (btn.dataset.action === 'edit')   showEditLicenceModal(btn.dataset.key, btn.dataset.owner, btn.dataset.plan, btn.dataset.assets, panel);
      });

      // S5.4 — toggle flags via POST /api/admin/licences/:key/flag
      tbody.addEventListener('change', async e => {
        const input = e.target.closest('input[type="checkbox"][data-flag]');
        if (!input) return;
        const key = input.dataset.key;
        const flag = input.dataset.flag;
        const value = input.checked ? 1 : 0;
        const prevChecked = !input.checked; // pour rollback si erreur
        input.disabled = true;
        try {
          const res = await api(`/api/admin/licences/${encodeURIComponent(key)}/flag`, 'POST', { flag, value });
          if (res.noop) {
            // pas de changement effectif côté serveur (= état déjà au target)
          }
        } catch (err) {
          input.checked = prevChecked;  // rollback visuel
          alert(`Échec toggle ${flag} : ${err.message}`);
        } finally {
          input.disabled = false;
        }
      });
    }
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// S5.4 — Bouton "Rappels expiration" : trigger manuel du cron S5.2
async function runExpirationRemindersNow(panel) {
  const btn = panel.querySelector('#btn-run-reminders');
  if (!btn) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Analyse en cours…';
  try {
    const res = await api('/api/admin/expiration-reminders/run-now', 'POST');
    const s = res.summary || {};
    const mode = s.enabled ? 'ENVOI ACTIF' : 'MODE DORMANT (kill-switch off)';
    const lines = [
      `${mode}`,
      `Scannées : ${s.scanned ?? 0}`,
      `Éligibles : ${s.eligible ?? 0}`,
      `Envoyées : ${s.sent ?? 0}`,
      `Auraient été envoyées : ${s.would_have_sent ?? 0}`,
      `Ignorées (déjà envoyé/email manquant) : ${s.skipped ?? 0}`,
      `Erreurs : ${s.errors ?? 0}`,
    ];
    alert(`Rappels expiration\n\n${lines.join('\n')}\n\nDétail dans l'onglet Audit Log.`);
  } catch (err) {
    alert(`Échec trigger rappels : ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
        <input type="text" class="form-input" id="m-assets" placeholder="O-IMM-002, O-IMM-010, A-COM-001, …">
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

function showEditLicenceModal(key, owner, plan, assets, panel) {
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
      <div class="form-group form-full">
        <label class="form-label">Outils autorisés <span style="font-weight:400;text-transform:none">(IDs séparés par des virgules — vide = TOUS les outils)</span></label>
        <input type="text" class="form-input" id="e-assets" value="${esc(assets || '')}" placeholder="O-IMM-002, A-COM-001, O-SOC-001, …">
      </div>
    </div>
    <p class="form-error" id="e-error"></p>`,
  `<button class="btn btn-secondary" id="e-cancel">Annuler</button>
   <button class="btn btn-primary"   id="e-confirm">Mettre à jour</button>`);
  document.getElementById('e-cancel').addEventListener('click', closeModal);
  document.getElementById('e-confirm').addEventListener('click', async () => {
    const newOwner  = document.getElementById('e-owner').value.trim();
    const newPlan   = document.getElementById('e-plan').value;
    const rawAssets = document.getElementById('e-assets').value.trim();
    const errEl     = document.getElementById('e-error');
    const btn       = document.getElementById('e-confirm');
    if (!newOwner) { errEl.textContent = 'Propriétaire requis.'; return; }
    // On renvoie TOUJOURS la liste (pré-remplie) → corrige le bug d'effacement
    // de l'upsert. Champ vidé volontairement = null = tous les outils.
    const ownedAssets = rawAssets ? rawAssets.split(',').map(s => s.trim()).filter(Boolean) : null;
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/api/licence/activate', 'POST', { key, plan: newPlan, owner: newOwner, ownedAssets });
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

// ══════════════════════════════════════════════════════════════════
// TAB 2 — LA FABRIQUE (hub avec sous-onglets)
// ══════════════════════════════════════════════════════════════════
// La Fabrique = atelier de production de contenu Keystone. Sous-onglets :
//   • pads     — éditeur des outils/artefacts (manifeste + D1)
//   • clauses  — bibliothèque partagée + locales (catalogue VEFA, etc.)
//   • [futurs] templates HTML sanctuarisés, prompts engine, variables
//
// Routage : la sous-nav est rendue par renderTools(), puis on délègue
// au sous-renderer selon fabriqueActiveSubTab. Chaque sous-renderer
// reçoit le slot DOM `#fabrique-sub-content` à remplir.
const FABRIQUE_SUB_TABS = [
  { id: 'pads',    label: '📐 Pads',      render: renderFabriquePads,    desc: 'Outils & artefacts du dashboard utilisateur' },
  { id: 'clauses', label: '📚 Clauses',   render: renderFabriqueClauses, desc: 'Bibliothèque de clauses partagées + locales' },
  // Sprint à venir :
  // { id: 'templates', label: '📄 Templates', render: renderFabriqueTemplates, desc: 'Templates HTML sanctuarisés (VEFA, etc.)' },
  // { id: 'prompts',   label: '🤖 Prompts IA', render: renderFabriquePrompts,   desc: 'System prompts par tâche × moteur' },
  // { id: 'vars',      label: '🧩 Variables',  render: renderFabriqueVars,      desc: 'Registry des [[VAR]] globales' },
];

async function renderTools(panel) {
  const subTabsHTML = FABRIQUE_SUB_TABS.map(t => `
    <button class="fabrique-sub-btn ${t.id === fabriqueActiveSubTab ? 'active' : ''}"
            data-sub="${t.id}" title="${esc(t.desc)}">
      ${t.label}
    </button>`).join('');

  panel.innerHTML = `
    <div class="fabrique-sub-nav">
      ${subTabsHTML}
    </div>
    <div id="fabrique-sub-content" style="margin-top:18px;"></div>`;

  // Câblage de la sous-nav
  panel.querySelectorAll('.fabrique-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fabriqueActiveSubTab = btn.dataset.sub;
      panel.querySelectorAll('.fabrique-sub-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.sub === fabriqueActiveSubTab));
      const slot = panel.querySelector('#fabrique-sub-content');
      slot.innerHTML = '<div class="loading">Chargement…</div>';
      const def = FABRIQUE_SUB_TABS.find(t => t.id === fabriqueActiveSubTab);
      def?.render(slot);
    });
  });

  // Premier rendu : la sous-section mémorisée
  const slot = panel.querySelector('#fabrique-sub-content');
  slot.innerHTML = '<div class="loading">Chargement…</div>';
  const initial = FABRIQUE_SUB_TABS.find(t => t.id === fabriqueActiveSubTab);
  initial?.render(slot);
}

// ── Sous-onglet : Pads (ex-renderTools complet) ─────────────────
async function renderFabriquePads(panel) {
  try {
    const manifest = await fetchJSON('/K_STORE_ASSETS/PADS/manifest.json');
    const padIds   = manifest.pads || [];
    padsCache = {};
    await Promise.all(padIds.map(async id => {
      try { padsCache[id] = await fetchJSON(`/K_STORE_ASSETS/PADS/${id}.json`); }
      catch { padsCache[id] = null; }
    }));

    // Merge avec les données D1 (source de vérité après toute sauvegarde admin).
    // Les prompts des moteurs alternatifs (GPT-4o, Gemini…) ne sont pas dans
    // les fichiers JSON statiques — ils sont stockés en base uniquement.
    try {
      const d1Data = await api('/api/pads?tenantId=default', 'GET');
      const d1Pads = d1Data.pads || [];
      d1Pads.forEach(p => { if (p?.id) padsCache[p.id] = p; });
    } catch { /* silencieux si le Worker n'est pas joignable */ }

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

  // Artefacts à UI custom (workspace fullscreen hard-codé, ex: SDQR).
  // Pas de Composants/Moteurs/Aperçu — la logique vit dans app/<artefact>.js.
  // Identité seule éditable (métadonnées catalogue).
  const isCustomUi = isArtifact && pad.ui_kind === 'fullscreen';

  container.innerHTML = `
    <div id="card-preview"></div>
    ${isCustomUi ? `
      <div class="editor-tabs-bar">
        <button class="editor-tab-btn active" data-etab="identity">Identité</button>
      </div>
      <div id="etab-identity" class="editor-tab-content active"></div>
      <div id="etab-customui" class="editor-tab-content active" style="margin-top:16px"></div>
    ` : `
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
    `}
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
      <p class="form-error" id="editor-err" style="flex:1;margin:0"></p>
      <button class="btn btn-primary" id="btn-editor-save">Sauvegarder →</button>
    </div>`;

  container.querySelectorAll('.editor-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.editor-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.editor-tab-content').forEach(c => c.classList.toggle('active', c.id === `etab-${btn.dataset.etab}` || (isCustomUi && c.id === 'etab-customui')));
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

  if (isCustomUi) {
    renderCustomUiNotice(container.querySelector('#etab-customui'), pad);
  } else if (pad.type === 'artifact') {
    renderArtifactFieldsTab(container.querySelector('#etab-fields'), pad, container);
    renderEnginesTab(container.querySelector('#etab-engines'), pad, container);
  } else {
    renderToolFieldsTab(container.querySelector('#etab-fields'), pad, container);
    renderEnginesTab(container.querySelector('#etab-engines'), pad, container);
  }

  container.querySelector('#btn-editor-save').addEventListener('click', () => saveFromEditor(container, pad.id, isNew, pad.type));
}

// Panneau informatif pour les artefacts à UI custom (ui_kind=fullscreen).
// Liste où vit le code et pourquoi on n'a pas d'éditeur visuel ici.
function renderCustomUiNotice(el, pad) {
  if (!el) return;
  const moduleHint = pad.id === 'A-COM-001' ? 'app/sdqr.js' : 'app/<artefact>.js';
  el.innerHTML = `
    <div style="padding:24px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.22);border-left:3px solid rgba(99,102,241,.7);border-radius:8px">
      <h3 style="margin:0 0 12px;font-family:'Cormorant Garamond',serif;font-size:18px;color:#c7d2fe">
        Artefact à interface custom (workspace fullscreen)
      </h3>
      <p style="margin:0 0 14px;font-size:13px;color:var(--text-muted);line-height:1.65">
        Cet artefact n'utilise <strong>pas</strong> le pipeline LLM&nbsp;→&nbsp;JSON&nbsp;→&nbsp;Composants des artefacts génériques.
        Sa logique métier (UI, parsers, API calls, rendu SVG) est codée en dur dans le module&nbsp;:
      </p>
      <code style="display:inline-block;padding:6px 12px;background:rgba(0,0,0,.25);border-radius:4px;color:#a5b4fc;font-size:12.5px;margin-bottom:14px">
        ${moduleHint}
      </code>
      <p style="margin:0 0 8px;font-size:13px;color:var(--text-muted);line-height:1.65">
        Pour modifier le comportement utilisateur&nbsp;: <strong>éditer le code source</strong> directement.
        Les onglets <em>Composants / Moteurs / Aperçu</em> ne s'appliquent pas et ont été masqués.
      </p>
      <p style="margin:14px 0 0;padding-top:14px;border-top:1px solid rgba(255,255,255,.07);font-size:12px;color:var(--text-muted)">
        L'onglet <strong>Identité</strong> reste actif pour ajuster le titre, sous-titre, icône, plan tarifaire et tags
        (métadonnées catalogue uniquement).
      </p>
    </div>
  `;
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
    </div>
    <div class="form-group form-full" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--border)">
      <label class="form-label">Vidéo d'aide — notice « ? »</label>
      <div id="help-video-zone"></div>
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

  renderHelpVideoZone(el.querySelector('#help-video-zone'), pad.id);
}

// ── Vidéo d'aide (notice « ? ») — upload R2 par outil ─────────────
// Le binaire part sur R2 (Worker /api/admin/help/media), le mapping
// app_id → clé vit en D1. Le bloc de specs n'est visible qu'ici (admin).
const HELP_VIDEO_SPECS = `
  <div style="padding:12px 14px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.22);border-radius:8px;font-size:12px;color:var(--text-muted);line-height:1.6">
    <strong style="color:#c7d2fe">Format recommandé</strong> (admin) — pour un poids mini et une lecture fluide partout&nbsp;:<br>
    <strong>MP4</strong> (H.264 + AAC) · <strong>1280×720</strong> (720p), ratio <strong>16:9</strong> ·
    débit ~1,5–2 Mbps · durée <strong>30–90 s</strong> · poids cible <strong>&lt; 10 Mo</strong> ·
    poster optionnel 1280×720 (JPEG/WebP). <em>La zone d'affichage ne dépasse pas ~560 px : le 1080p est inutile.</em>
  </div>`;

async function renderHelpVideoZone(zoneEl, appId) {
  if (!zoneEl) return;

  if (!appId) {
    zoneEl.innerHTML = `
      <p style="color:var(--text-muted);font-size:12.5px;margin:0 0 10px">
        Renseigne et enregistre d'abord l'<strong>ID NOMEN-K</strong> de l'outil pour pouvoir y attacher une vidéo.
      </p>${HELP_VIDEO_SPECS}`;
    return;
  }

  zoneEl.innerHTML = `<p style="color:var(--text-muted);font-size:12.5px;margin:0">Chargement…</p>`;

  let info = { video: null };
  try {
    const r = await fetch(`${API_BASE}/api/help/${encodeURIComponent(appId)}/media?_=${Date.now()}`);
    if (r.ok) info = await r.json();
  } catch { /* réseau indispo → état "aucune vidéo" */ }

  const hasVideo = !!(info && info.video && info.video.url);
  const bust     = (u) => u + (u.includes('?') ? '&' : '?') + '_=' + Date.now();

  zoneEl.innerHTML = `
    ${HELP_VIDEO_SPECS}
    <div style="margin-top:12px">
      ${hasVideo ? `
        <video src="${esc(bust(info.video.url))}" controls preload="metadata"
               style="width:100%;max-width:360px;border-radius:8px;background:#000;display:block"></video>
        <p style="color:var(--text-muted);font-size:12px;margin:6px 0 0">
          ✓ Vidéo en ligne${info.video.poster ? ' · poster OK' : ''}${info.updated_at ? ' · MAJ ' + esc(info.updated_at) : ''}
        </p>` : `
        <p style="color:var(--text-muted);font-size:12.5px;margin:0">
          Aucune vidéo — la notice affiche « Démo vidéo bientôt disponible ».
        </p>`}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center">
      <input type="file" id="hv-file" accept="video/mp4,video/webm" hidden>
      <button class="btn btn-secondary btn-sm" id="hv-pick">${hasVideo ? 'Remplacer la vidéo' : 'Choisir une vidéo (MP4 / WebM)'}</button>
      <input type="file" id="hv-poster" accept="image/jpeg,image/png,image/webp" hidden>
      <button class="btn btn-secondary btn-sm" id="hv-poster-pick">Poster (optionnel)</button>
      ${hasVideo ? `<button class="btn btn-sm" id="hv-del" style="color:#ff6b6b;border-color:#ff6b6b44">Supprimer</button>` : ''}
      <span id="hv-status" style="color:var(--text-muted);font-size:12px"></span>
    </div>`;

  const setStatus = (m) => { const s = zoneEl.querySelector('#hv-status'); if (s) s.textContent = m; };

  const doUpload = async (file, kind) => {
    if (!file) return;
    if (kind === 'video' && file.size > 10 * 1024 * 1024) {
      const mb = (file.size / 1048576).toFixed(1);
      if (!confirm(`Ce fichier fait ${mb} Mo (recommandé < 10 Mo). L'envoyer quand même ?`)) return;
    }
    setStatus(kind === 'poster' ? 'Envoi du poster…' : 'Envoi de la vidéo…');
    try {
      const fd = new FormData();
      fd.append('appId', appId);
      fd.append('kind', kind);
      fd.append('file', file);
      await apiUpload('/api/admin/help/media', fd);
      toast(kind === 'poster' ? 'Poster ajouté' : 'Vidéo en ligne', 'success');
      renderHelpVideoZone(zoneEl, appId);
    } catch (e) {
      setStatus('❌ ' + e.message);
      toast(e.message, 'error');
    }
  };

  zoneEl.querySelector('#hv-pick')?.addEventListener('click', () => zoneEl.querySelector('#hv-file').click());
  zoneEl.querySelector('#hv-file')?.addEventListener('change', (e) => doUpload(e.target.files[0], 'video'));
  zoneEl.querySelector('#hv-poster-pick')?.addEventListener('click', () => zoneEl.querySelector('#hv-poster').click());
  zoneEl.querySelector('#hv-poster')?.addEventListener('change', (e) => doUpload(e.target.files[0], 'poster'));
  zoneEl.querySelector('#hv-del')?.addEventListener('click', async () => {
    if (!confirm('Supprimer la vidéo d\'aide de cet outil ?')) return;
    setStatus('Suppression…');
    try {
      await api(`/api/admin/help/media/${encodeURIComponent(appId)}`, 'DELETE');
      toast('Vidéo supprimée', 'success');
      renderHelpVideoZone(zoneEl, appId);
    } catch (e) { setStatus('❌ ' + e.message); }
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
    // Sauvegarde dans Cloudflare D1 (remplace l'ancien file-write)
    await api('/api/admin/pad', 'POST', { ...pad, tenantId: 'default' });

    editingPadId = pad.id;
    toast(`${pad.id}.json sauvegardé ✓`);

    const panel = document.getElementById('tab-tools');
    await renderTools(panel);

    // renderTools efface padsCache et re-charge depuis les fichiers JSON statiques,
    // lesquels ne contiennent pas les prompts des moteurs alternatifs (GPT-4o, Gemini…).
    // On restaure le pad fraîchement sauvegardé pour que l'éditeur affiche les bonnes données.
    padsCache[pad.id] = pad;
    const editorSlot  = panel.querySelector('#pad-editor');
    if (editorSlot) {
      renderEditor(editorSlot, pad, false);
      // Revenir sur l'onglet Moteurs (l'utilisateur venait de le modifier)
      editorSlot.querySelector('[data-etab="engines"]')?.click();
    }
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
    // 1. On tente de charger la version persistée en D1 (source de vérité)
    let loaded = null;
    try {
      const res = await api('/api/admin/catalog?tenantId=default');
      if (res && res.catalog) loaded = res.catalog;
    } catch (_) { /* fallback ci-dessous */ }

    // 2. Fallback sur le fichier statique si rien en D1 (1ère utilisation)
    if (!loaded) loaded = await fetchJSON('/K_STORE_ASSETS/catalog.json');

    catalogData = loaded;
    const items = catalogData.tools || [];
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Catalogue <span>(${items.length} entrées)</span></h2>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" id="btn-new-app">+ Nouvelle app</button>
          <button class="btn btn-secondary" id="btn-import-static" title="Compare D1 et K_STORE_ASSETS/catalog.json : ajoute les nouvelles entrées + met à jour celles dont le titre/sous-titre/longDesc/tags ont changé dans le statique. Liste les modifs avant application. Clique ensuite Sauvegarder pour persister.">↻ Synchroniser avec fichier statique</button>
          <button class="btn btn-secondary" id="btn-raw-catalog">JSON brut</button>
          <button class="btn btn-primary"   id="btn-save-catalog">Sauvegarder</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>ID</th><th>Titre</th><th>Plan</th><th>Prix</th><th>Lifetime</th>
          <th>Publié</th><th>Nouveau</th><th style="text-align:center">Fiche Key-Store</th>
        </tr></thead>
        <tbody id="catalog-tbody"></tbody>
      </table>`;
    const tbody = panel.querySelector('#catalog-tbody');
    items.forEach((item, idx) => {
      // Indicateur visuel : fiche complétée si longDesc + category + ai_optimized présents
      const ficheComplete = !!(item.longDesc && item.category && item.ai_optimized);
      const ficheBadge    = ficheComplete
        ? '<span style="color:#34d399;font-size:11px">● Complétée</span>'
        : '<span style="color:#f59e0b;font-size:11px">○ À compléter</span>';

      // Outil retiré (fusionné/remplacé) : grisé + badge, pour ne pas éditer
      // par erreur une fiche qui n'apparaîtra jamais dans le Key-Store.
      const isRetired = !!item.replacedBy;
      const replTitle = isRetired
        ? (items.find(t => t.id === item.replacedBy)?.title || item.replacedBy)
        : '';

      const tr = document.createElement('tr');
      if (isRetired) { tr.style.opacity = '.5'; tr.style.background = 'rgba(245,158,11,.05)'; }
      tr.innerHTML = `
        <td><code style="font-size:11px;color:var(--gold)">${esc(item.id)}</code></td>
        <td><input data-idx="${idx}" data-field="title" type="text" class="form-input" value="${esc(item.title||'')}"
                   style="padding:5px 9px;font-size:13px;background:transparent;border-color:transparent;width:200px"
                   onfocus="this.style.borderColor='var(--gold)'" onblur="this.style.borderColor='transparent'">${isRetired ? `<div style="font-size:10.5px;color:#f59e0b;margin-top:3px;white-space:nowrap">↳ retiré · remplacé par ${esc(replTitle)}</div>` : ''}</td>
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
          <span class="toggle-slider"></span></label></td>
        <td style="text-align:center;white-space:nowrap">
          <button class="btn btn-secondary btn-ks-fiche" data-idx="${idx}"
                  style="padding:5px 10px;font-size:12px;gap:6px">📝 Éditer</button>
          <div style="margin-top:3px">${ficheBadge}</div>
        </td>`;
      tbody.appendChild(tr);
    });
    panel.querySelectorAll('[data-idx][data-field]').forEach(el => {
      el.addEventListener(el.type==='checkbox'?'change':'input', () => {
        const idx=+el.dataset.idx; const field=el.dataset.field;
        catalogData.tools[idx][field] = el.type==='checkbox' ? el.checked : el.type==='number' ? (el.value===''?undefined:+el.value) : el.value;
      });
    });
    panel.querySelectorAll('.btn-ks-fiche').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const it  = catalogData.tools[idx];
        if (it?.replacedBy) {
          const repl = catalogData.tools.find(t => t.id === it.replacedBy)?.title || it.replacedBy;
          if (!confirm(`« ${it.title} » est un outil RETIRÉ (remplacé par « ${repl} »).\n\nIl n'apparaît pas dans le Key-Store, même si tu y ajoutes une image. Édite plutôt « ${repl} ».\n\nOuvrir quand même cette fiche retirée ?`)) return;
        }
        openKStoreFicheEditor(idx, panel);
      });
    });
    panel.querySelector('#btn-new-app').addEventListener('click', () => createNewKStoreApp(panel));
    panel.querySelector('#btn-save-catalog').addEventListener('click', () => saveCatalog(panel));
    panel.querySelector('#btn-raw-catalog').addEventListener('click', () => showRawCatalogEditor(panel));
    panel.querySelector('#btn-import-static').addEventListener('click', () => importMissingFromStatic(panel));
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB — À LA UNE (bandeaux promo du hero Key-Store)
// Éditeur complet du grand carrousel en haut du Key-Store. Chaque
// bandeau : étiquette / titre / sous-titre / bouton / app liée /
// couleur + photo d'illustration (drag&drop). Persiste dans
// catalogData.promos (même blob D1 que le catalogue → POST /api/admin/catalog).
// Le frontend (_renderKStoreHero) lit catalog.promos, fallback KSTORE_PROMOS.
// ══════════════════════════════════════════════════════════════════
const PROMO_PALETTES = ['indigo', 'violet', 'blue', 'amber', 'emerald'];
function _newPromoId() { return `promo-${Date.now().toString(36)}`; }
function _promoCount(n) { return `(${n} bandeau${n > 1 ? 'x' : ''})`; }

// Barre d'actions visible en bas d'une image deja uploadee (toutes les zones admin).
// `delAttrs` = attribut(s) HTML du bouton Effacer (id/class propre a chaque zone, pour
// que le handler delete existant continue de fonctionner). Le bouton Remplacer n'a
// pas de handler dedie : son clic remonte au slot qui ouvre deja le selecteur de fichier.
// `compact` (slot etroit type icone 100px) = pictos seuls sans libelle.
function _imgActionsBar(delAttrs, compact = false) {
  const ICON_REPLACE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:13px;height:13px;flex:none"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`;
  const ICON_TRASH   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:13px;height:13px;flex:none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  const btn = (extra, label, ico, title) => `
        <button type="button" ${extra} title="${title}"
                style="flex:1;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;
                       padding:${compact ? '5px 0' : '6px 8px'};border-radius:7px;cursor:pointer;
                       font-size:11px;font-weight:600;line-height:1;white-space:nowrap;overflow:hidden;
                       backdrop-filter:blur(4px);${title.includes('Effacer')
                         ? 'border:1px solid rgba(224,92,92,.45);background:rgba(224,92,92,.18);color:#ff9b9b;'
                         : 'border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.13);color:#fff;'}">
          ${ico}${compact ? '' : `<span>${label}</span>`}
        </button>`;
  return `
      <div class="img-act-bar" style="position:absolute;left:0;right:0;bottom:0;display:flex;gap:6px;
                  padding:${compact ? '5px' : '7px'};background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,0))">
        ${btn('class="img-act-replace"', 'Remplacer', ICON_REPLACE, 'Remplacer cette image')}
        ${btn(delAttrs, 'Effacer', ICON_TRASH, 'Effacer cette image')}
      </div>`;
}

async function renderPromos(panel) {
  try {
    // Partage le même catalogData que renderCatalog (tools + promos dans le
    // même blob). On le (re)charge si l'admin ouvre cet onglet en premier.
    if (!catalogData) {
      let loaded = null;
      try {
        const res = await api('/api/admin/catalog?tenantId=default');
        if (res && res.catalog) loaded = res.catalog;
      } catch (_) { /* fallback ci-dessous */ }
      if (!loaded) loaded = await fetchJSON('/K_STORE_ASSETS/catalog.json');
      catalogData = loaded;
    }
    // Amorce : jamais édité → on part des bandeaux live embarqués (KSTORE_PROMOS)
    // pour que « ce que l'admin voit = ce qui est en ligne ». Une fois sauvegardé,
    // catalogData.promos devient la source de vérité (override le statique).
    if (!Array.isArray(catalogData.promos)) {
      catalogData.promos = (Array.isArray(KSTORE_PROMOS) ? KSTORE_PROMOS : []).map(p => ({
        id: p.id || _newPromoId(),
        eyebrow: p.eyebrow || '', title: p.title || '', subtitle: p.subtitle || '',
        cta: p.cta || '', appId: p.appId || '', palette: p.palette || 'indigo',
        imageId: p.imageId || '',
      }));
    }
    const promos = catalogData.promos;
    const apps   = (catalogData.tools || []).filter(t => t && t.id);

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">À la une <span>${_promoCount(promos.length)}</span></h2>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" id="btn-add-promo">+ Nouveau bandeau</button>
          <button class="btn btn-primary"   id="btn-save-promos">Sauvegarder</button>
        </div>
      </div>
      <p style="margin:-6px 0 18px;font-size:12.5px;color:var(--text-muted);max-width:780px;line-height:1.55">
        Ces bandeaux composent le grand carrousel en haut du Key-Store. Pour chaque
        bandeau, le texte s'affiche à gauche sur un panneau de couleur qui se fond vers
        une <strong>photo d'illustration à droite</strong>. Glissez une image dans
        l'emplacement photo (ou laissez vide pour un dégradé de couleur plein).
        Réorganisez l'ordre avec ↑ ↓, puis cliquez <strong>Sauvegarder</strong>.
      </p>
      <div id="promos-list" style="display:flex;flex-direction:column;gap:16px"></div>`;

    const listEl = panel.querySelector('#promos-list');
    const setCount = () => {
      const span = panel.querySelector('.section-title span');
      if (span) span.textContent = _promoCount(promos.length);
    };

    const photoSlotInner = (p) => p.imageId
      ? `<img src="${API_BASE}/api/screenshot/${esc(p.imageId)}" alt=""
              style="width:100%;height:100%;object-fit:cover;object-position:right center;pointer-events:none">
         ${_imgActionsBar('class="promo-photo-del"')}`
      : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
                     color:rgba(255,255,255,.45);font-size:11px;text-align:center;padding:12px;gap:6px;pointer-events:none">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:22px;height:22px;opacity:.6">
             <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
           </svg>
           <div><strong>Photo d'illustration</strong></div>
           <div style="opacity:.75">Glissez une image ou cliquez</div>
         </div>`;

    const cardHTML = (p, i) => `
      <div class="promo-card" data-i="${i}"
           style="border:1px solid var(--border);border-radius:14px;padding:16px;
                  display:grid;grid-template-columns:210px 1fr;gap:18px;background:rgba(255,255,255,.02)">
        <div>
          <div class="promo-photo-slot" data-i="${i}"
               style="position:relative;height:120px;border:1.5px dashed var(--border);border-radius:10px;
                      overflow:hidden;cursor:pointer;background:rgba(255,255,255,.02)">${photoSlotInner(p)}</div>
          <input type="file" accept="image/*" class="promo-photo-input" data-i="${i}" style="display:none">
          <label style="display:block;margin-top:9px;font-size:11px;color:var(--text-muted)">Couleur du panneau</label>
          <select class="form-select promo-f" data-i="${i}" data-field="palette"
                  style="width:100%;padding:6px 8px;font-size:12px;margin-top:3px">
            ${PROMO_PALETTES.map(c => `<option value="${c}" ${p.palette === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:9px">
          <div style="display:flex;gap:6px;align-items:center;justify-content:space-between">
            <span style="font-size:11px;color:var(--text-muted)">Bandeau ${i + 1}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary promo-up"   data-i="${i}" title="Monter"    ${i === 0 ? 'disabled' : ''} style="padding:4px 9px">↑</button>
              <button class="btn btn-secondary promo-down" data-i="${i}" title="Descendre" ${i === promos.length - 1 ? 'disabled' : ''} style="padding:4px 9px">↓</button>
              <button class="btn btn-secondary promo-del"  data-i="${i}" title="Supprimer ce bandeau" style="padding:4px 9px;color:#e05c5c">✕</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
            <div>
              <label style="font-size:11px;color:var(--text-muted)">Étiquette</label>
              <input class="form-input promo-f" data-i="${i}" data-field="eyebrow" value="${esc(p.eyebrow || '')}"
                     placeholder="Nouveau" style="width:100%;padding:7px 9px;font-size:13px;margin-top:3px">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted)">Titre</label>
              <input class="form-input promo-f" data-i="${i}" data-field="title" value="${esc(p.title || '')}"
                     placeholder="Titre du bandeau" style="width:100%;padding:7px 9px;font-size:13px;margin-top:3px">
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted)">Sous-titre</label>
            <input class="form-input promo-f" data-i="${i}" data-field="subtitle" value="${esc(p.subtitle || '')}"
                   placeholder="Phrase d'accroche" style="width:100%;padding:7px 9px;font-size:13px;margin-top:3px">
          </div>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px">
            <div>
              <label style="font-size:11px;color:var(--text-muted)">Bouton (CTA)</label>
              <input class="form-input promo-f" data-i="${i}" data-field="cta" value="${esc(p.cta || '')}"
                     placeholder="Découvrir" style="width:100%;padding:7px 9px;font-size:13px;margin-top:3px">
            </div>
            <div>
              <label style="font-size:11px;color:var(--text-muted)">App liée (clic sur le bandeau)</label>
              <select class="form-select promo-f" data-i="${i}" data-field="appId"
                      style="width:100%;padding:7px 9px;font-size:13px;margin-top:3px">
                <option value="">— aucune (bandeau non cliquable) —</option>
                ${apps.map(a => `<option value="${esc(a.id)}" ${p.appId === a.id ? 'selected' : ''}>${esc(a.title || a.id)} · ${esc(a.id)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>`;

    const renderList = () => { listEl.innerHTML = promos.map((p, i) => cardHTML(p, i)).join(''); wire(); };

    // Persiste les bandeaux en D1. Réutilisé par le bouton « Sauvegarder » ET
    // par l'upload/suppression de photo → la photo « remonte » sans qu'on oublie
    // de cliquer Sauvegarder (piège : le toast d'upload faisait croire que oui).
    const _persistPromos = async () => {
      catalogData.promos = promos.map(p => ({
        id: p.id || _newPromoId(),
        eyebrow:  (p.eyebrow  || '').trim(),
        title:    (p.title    || '').trim(),
        subtitle: (p.subtitle || '').trim(),
        cta:      (p.cta      || '').trim(),
        appId:    p.appId || '',
        palette:  PROMO_PALETTES.includes(p.palette) ? p.palette : 'indigo',
        imageId:  p.imageId || '',
      }));
      catalogData.updatedAt = new Date().toISOString().slice(0, 10);
      await api('/api/admin/catalog', 'POST', { catalog: catalogData, tenantId: 'default' });
    };

    // Upload photo d'un bandeau (réutilise le pipeline screenshot du catalogue).
    const uploadPhoto = async (file, i) => {
      if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.type)) { toast('Format non supporté (JPG, PNG, WebP, GIF)', 'error'); return; }
      if (file.size > 25 * 1024 * 1024) { toast('Image trop volumineuse (max 25 Mo)', 'error'); return; }
      const slot = listEl.querySelector(`.promo-photo-slot[data-i="${i}"]`);
      if (slot) slot.style.opacity = '.5';
      try {
        const { base64: dataBase64, mime } = await compressImageForUpload(file, { maxDim: 1920, budgetBytes: 800 * 1024 });
        const res = await api('/api/admin/screenshot', 'POST', {
          appId: `promo:${promos[i].id}`, mime, dataBase64, tenantId: 'default',
        });
        if (!res?.id) throw new Error('Réponse upload invalide');
        if (promos[i].imageId) api(`/api/admin/screenshot/${encodeURIComponent(promos[i].imageId)}`, 'DELETE').catch(() => {});
        promos[i].imageId = res.id;
        renderList();
        await _persistPromos();   // persiste tout de suite → la photo « remonte »
        toast('Photo du bandeau enregistrée ✓');
      } catch (err) {
        if (slot) slot.style.opacity = '';
        toast(err.message || 'Erreur upload', 'error');
      }
    };

    function wire() {
      // Champs texte/select → met à jour catalogData.promos en mémoire.
      listEl.querySelectorAll('.promo-f').forEach(el => {
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
          promos[+el.dataset.i][el.dataset.field] = el.value;
        });
      });
      // Slots photo : clic (ouvre le sélecteur / supprime) + glisser-déposer.
      listEl.querySelectorAll('.promo-photo-slot').forEach(slot => {
        const i = +slot.dataset.i;
        const input = listEl.querySelector(`.promo-photo-input[data-i="${i}"]`);
        slot.addEventListener('click', (e) => {
          if (e.target.closest('.promo-photo-del')) {
            if (promos[i].imageId) api(`/api/admin/screenshot/${encodeURIComponent(promos[i].imageId)}`, 'DELETE').catch(() => {});
            promos[i].imageId = '';
            renderList();
            _persistPromos().then(() => toast('Photo retirée')).catch(() => toast('Erreur enregistrement', 'error'));
            return;
          }
          input.value = ''; input.click();
        });
        slot.addEventListener('dragover',  (e) => { e.preventDefault(); slot.style.borderColor = '#6366f1'; slot.style.background = 'rgba(99,102,241,.08)'; });
        slot.addEventListener('dragleave', ()  => { slot.style.borderColor = ''; slot.style.background = ''; });
        slot.addEventListener('drop', (e) => {
          e.preventDefault(); slot.style.borderColor = ''; slot.style.background = '';
          const file = e.dataTransfer?.files?.[0]; if (file) uploadPhoto(file, i);
        });
        input.addEventListener('change', () => { const f = input.files?.[0]; if (f) uploadPhoto(f, i); });
      });
      // Réordonnancement + suppression.
      listEl.querySelectorAll('.promo-up').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i; if (i <= 0) return;
        [promos[i - 1], promos[i]] = [promos[i], promos[i - 1]]; renderList();
      }));
      listEl.querySelectorAll('.promo-down').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i; if (i >= promos.length - 1) return;
        [promos[i + 1], promos[i]] = [promos[i], promos[i + 1]]; renderList();
      }));
      listEl.querySelectorAll('.promo-del').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i;
        if (!confirm('Supprimer ce bandeau ?')) return;
        // On NE supprime PAS la photo côté serveur : tant que ce n'est pas
        // sauvegardé, le bandeau live (D1) la référence encore. Orpheline = sans gravité.
        promos.splice(i, 1); renderList(); setCount();
      }));
    }

    renderList();

    panel.querySelector('#btn-add-promo').addEventListener('click', () => {
      promos.push({
        id: _newPromoId(), eyebrow: '', title: '', subtitle: '', cta: 'Découvrir',
        appId: '', palette: PROMO_PALETTES[promos.length % PROMO_PALETTES.length], imageId: '',
      });
      renderList(); setCount();
      listEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    panel.querySelector('#btn-save-promos').addEventListener('click', async () => {
      const btn = panel.querySelector('#btn-save-promos');
      btn.disabled = true; btn.textContent = '…';
      try {
        await _persistPromos();
        toast('Bandeaux « À la une » enregistrés ✓');
      } catch (err) {
        toast(err.message, 'error');
      }
      btn.disabled = false; btn.textContent = 'Sauvegarder';
    });
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// Champs metadata sync depuis le fichier statique vers D1 (Sprint sync v2).
// Exclut category/published/price/lifetimePrice/plan car ces champs sont
// souvent ajustes manuellement en admin D1 (pricing par tenant, etc.).
const _SYNC_FIELDS = ['title', 'subtitle', 'longDesc', 'icon', 'ai_optimized', 'isNew', 'tags'];

function _diffEntry(staticT, d1T) {
  const diffs = [];
  for (const f of _SYNC_FIELDS) {
    const a = staticT[f];
    const b = d1T[f];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      diffs.push({ field: f, before: b, after: a });
    }
  }
  return diffs;
}

function _shortVal(v) {
  if (v === null || v === undefined) return '∅';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

// Compare D1 (catalogData en memoire) et catalog.json statique :
//   - ajoute les entrees absentes de D1
//   - met a jour les champs metadata (titre, sous-titre, longDesc, icon,
//     ai_optimized, isNew, tags) si differents du statique
// Le pricing (plan/price/lifetimePrice), la category et published sont
// PRESERVES car ils peuvent etre ajustes par tenant.
// Stephane doit ensuite cliquer Sauvegarder pour persister D1.
async function importMissingFromStatic(panel) {
  const btn = panel.querySelector('#btn-import-static');
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Analyse…';
  try {
    const staticCatalog = await fetchJSON('/K_STORE_ASSETS/catalog.json');
    const staticTools   = staticCatalog?.tools || [];
    const d1ById        = new Map((catalogData.tools || []).map(t => [t.id, t]));

    const missing = [];   // entrees absentes de D1
    const updates = [];   // { staticT, d1T, diffs[] }

    for (const s of staticTools) {
      if (!s?.id) continue;
      const d = d1ById.get(s.id);
      if (!d) {
        missing.push(s);
      } else {
        const diffs = _diffEntry(s, d);
        if (diffs.length) updates.push({ staticT: s, d1T: d, diffs });
      }
    }

    if (missing.length === 0 && updates.length === 0) {
      btn.textContent = '✓ Tout est à jour';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200);
      return;
    }

    // Construit le résumé textuel pour la confirm()
    const lines = [];
    if (missing.length) {
      lines.push(`AJOUTS (${missing.length}) :`);
      missing.forEach(t => lines.push(`  • ${t.id} — ${t.title || ''}`));
      lines.push('');
    }
    if (updates.length) {
      lines.push(`MISES À JOUR (${updates.length}) :`);
      updates.forEach(u => {
        lines.push(`  • ${u.d1T.id} — ${u.d1T.title || ''}`);
        u.diffs.forEach(d => {
          lines.push(`      ${d.field} : ${_shortVal(d.before)} → ${_shortVal(d.after)}`);
        });
      });
      lines.push('');
    }
    lines.push('Note : pricing, category et published sont préservés (jamais écrasés).');
    lines.push('Clique ensuite "Sauvegarder" pour persister en base.');

    if (!confirm(`Appliquer ces modifications ?\n\n` + lines.join('\n'))) {
      btn.textContent = orig; btn.disabled = false; return;
    }

    // ── Application en memoire ───────────────────────────────────
    // Ajouts : append a la fin
    catalogData.tools = [...(catalogData.tools || []), ...missing];

    // Updates : merge champ par champ (on garde les autres champs D1)
    updates.forEach(u => {
      const idx = catalogData.tools.indexOf(u.d1T);
      if (idx < 0) return;
      u.diffs.forEach(d => { catalogData.tools[idx][d.field] = d.after; });
    });

    btn.textContent = `✓ ${missing.length + updates.length} modif(s) — Clique Sauvegarder`;

    // ── Refresh visuel ───────────────────────────────────────────
    const titleSpan = panel.querySelector('.section-title span');
    if (titleSpan) titleSpan.textContent = `(${catalogData.tools.length} entrées)`;

    const tbody = panel.querySelector('#catalog-tbody');

    // Updates : on met a jour les inputs visibles (title seul est edite
    // directement dans le tableau ; longDesc/subtitle/etc. sont dans la
    // fiche K-Store. On refresh seulement title + isNew toggle.)
    if (tbody) {
      updates.forEach(u => {
        const idx = catalogData.tools.indexOf(u.d1T);
        const titleInput = tbody.querySelector(`input[data-idx="${idx}"][data-field="title"]`);
        if (titleInput) titleInput.value = u.staticT.title || '';
        const isNewToggle = tbody.querySelector(`input[data-idx="${idx}"][data-field="isNew"]`);
        if (isNewToggle && 'isNew' in u.staticT) isNewToggle.checked = !!u.staticT.isNew;
        // Flash visuel sur la row
        const row = titleInput?.closest('tr');
        if (row) {
          row.style.transition = 'background .8s';
          row.style.background = 'rgba(99,102,241,.18)';
          setTimeout(() => { row.style.background = ''; }, 1200);
        }
      });
    }

    // Ajouts : append manuel (meme logique que precedemment)
    if (tbody && missing.length) {
      missing.forEach((item) => {
        const idx = catalogData.tools.indexOf(item);
        const ficheComplete = !!(item.longDesc && item.category && item.ai_optimized);
        const ficheBadge    = ficheComplete
          ? '<span style="color:#34d399;font-size:11px">● Complétée</span>'
          : '<span style="color:#f59e0b;font-size:11px">○ À compléter</span>';
        const tr = document.createElement('tr');
        tr.style.background = 'rgba(184,148,90,.08)';
        tr.innerHTML = `
          <td><code style="font-size:11px;color:var(--gold)">${esc(item.id)}</code> <span style="font-size:10px;color:#34d399">NOUVEAU</span></td>
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
            <span class="toggle-slider"></span></label></td>
          <td style="text-align:center;white-space:nowrap">
            <button class="btn btn-secondary btn-ks-fiche" data-idx="${idx}"
                    style="padding:5px 10px;font-size:12px;gap:6px">📝 Éditer</button>
            <div style="margin-top:3px">${ficheBadge}</div>
          </td>`;
        tbody.appendChild(tr);

        tr.querySelectorAll('[data-idx][data-field]').forEach(el => {
          el.addEventListener(el.type==='checkbox'?'change':'input', () => {
            const i=+el.dataset.idx; const f=el.dataset.field;
            catalogData.tools[i][f] = el.type==='checkbox' ? el.checked : el.type==='number' ? (el.value===''?undefined:+el.value) : el.value;
          });
        });
        tr.querySelector('.btn-ks-fiche')?.addEventListener('click', (e) => {
          openKStoreFicheEditor(+e.currentTarget.dataset.idx, panel);
        });
      });
    }
  } catch (err) {
    btn.textContent = '✗ Erreur — voir console';
    console.error('[importMissingFromStatic]', err);
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
  }
}
async function saveCatalog(panel) {
  const btn = panel.querySelector('#btn-save-catalog');
  btn.disabled = true; btn.textContent = '…';
  catalogData.updatedAt = new Date().toISOString().slice(0,10);
  try {
    await api('/api/admin/catalog', 'POST', { catalog: catalogData, tenantId: 'default' });
    toast('Catalogue sauvegardé ✓');
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
      await api('/api/admin/catalog', 'POST', { catalog: catalogData, tenantId: 'default' });
      closeModal(); toast('Catalogue sauvegardé ✓'); renderCatalog(panel);
    } catch(err) { errEl.textContent=err.message; btn.disabled=false; btn.textContent='Sauvegarder'; }
  });
}

// ══════════════════════════════════════════════════════════════════
// FICHE KEY-STORE — Éditeur de page détail par app
// (longDesc, catégorie, sous-catégorie, moteurs IA, copyright, screenshots)
// ══════════════════════════════════════════════════════════════════
function openKStoreFicheEditor(idx, panel) {
  const item = catalogData.tools[idx];
  if (!item) return;

  // ── Construction du HTML du formulaire ──
  // Selects catégorie + sous-catégorie (la liste sub dépend du parent).
  const catOptions = KSTORE_CATEGORIES.map(c =>
    `<option value="${c.id}" ${item.category===c.id?'selected':''}>${esc(c.label)}</option>`
  ).join('');

  const buildSubOptions = (catId, currentSub) => {
    const cat = KSTORE_CATEGORIES.find(c => c.id === catId);
    if (!cat || !cat.sub) return '<option value="">— (pas de sous-catégorie)</option>';
    return '<option value="">— (toutes)</option>' + cat.sub.map(s =>
      `<option value="${s.id}" ${currentSub===s.id?'selected':''}>#${esc(s.label)}</option>`
    ).join('');
  };

  // Selects "Optimisé pour" + "Compatibles"
  const aiOptOptions = KSTORE_AI_ENGINES.map(e =>
    `<option ${item.ai_optimized===e?'selected':''}>${esc(e)}</option>`
  ).join('');

  const compat = Array.isArray(item.ai_compatible) ? item.ai_compatible : [];
  const aiCmpChecks = KSTORE_AI_ENGINES.map(e => `
    <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;
                  padding:5px 10px;border:1px solid var(--bd);border-radius:6px;
                  cursor:pointer;background:rgba(255,255,255,.02)">
      <input type="checkbox" value="${esc(e)}" class="ks-ai-cmp" ${compat.includes(e)?'checked':''}>
      ${esc(e)}
    </label>
  `).join('');

  // Slots screenshots — nombre ILLIMITÉ (carrousel fiche détail).
  // shotIds est cloné (revert possible sur annulation) et tenu sans trous :
  // une suppression splice l'entrée, un ajout push à la fin.
  let shotIds = (Array.isArray(item.screenshots) ? item.screenshots : []).filter(Boolean);

  // Tuile d'une capture déjà uploadée (index i dans shotIds).
  const filledShotSlot = (i) => `
      <div class="ks-shot-slot" data-shot="${i}"
           style="position:relative;aspect-ratio:16/10;background:rgba(255,255,255,.04);
                  border:1.5px solid rgba(255,255,255,.10);border-radius:8px;
                  overflow:hidden;cursor:pointer;transition:border-color .12s ease, background .12s ease">
        <img src="${API_BASE}/api/screenshot/${esc(shotIds[i])}" alt=""
             style="width:100%;height:100%;object-fit:cover;border-radius:8px;pointer-events:none">
        ${_imgActionsBar('class="ks-shot-delete" data-shot="' + i + '"', true)}
      </div>`;

  // Tuile d'ajout en fin de liste (target = 'add').
  const addShotSlot = () => `
      <div class="ks-shot-slot ks-shot-add" data-shot="add"
           style="position:relative;aspect-ratio:16/10;background:rgba(255,255,255,.04);
                  border:1.5px dashed rgba(255,255,255,.12);border-radius:8px;
                  overflow:hidden;cursor:pointer;transition:border-color .12s ease, background .12s ease">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100%;color:rgba(255,255,255,.45);font-size:11px;text-align:center;
                    padding:14px;gap:6px;pointer-events:none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               style="width:22px;height:22px;opacity:.6">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <div><strong>Ajouter une capture</strong></div>
          <div style="opacity:.75">Glissez une image ici<br>ou cliquez pour parcourir</div>
        </div>
      </div>`;

  // ── Icône (pictogramme de profil app) ──
  let currentIconId  = item.iconId  || null;
  let currentCoverId = item.coverId || null;   // photo de présentation (À la une)
  const iconPreviewHTML = () => currentIconId
    ? `<img src="${API_BASE}/api/screenshot/${esc(currentIconId)}" alt=""
            style="width:100%;height:100%;object-fit:cover;border-radius:18px;pointer-events:none">
       ${_imgActionsBar('id="ksf-icon-delete"', true)}`
    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                   height:100%;color:rgba(255,255,255,.45);font-size:10px;
                   text-align:center;padding:8px;gap:4px;pointer-events:none">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
              style="width:24px;height:24px;opacity:.6">
           <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/>
           <path d="M7 20a5 5 0 0 1 10 0"/>
         </svg>
         <div>Icône</div>
       </div>`;

  const formHTML = `
    <div style="display:grid;gap:18px;font-size:13px">
      <!-- Bandeau icône + ID + sous-titre -->
      <div style="display:grid;grid-template-columns:100px 1fr 1fr;gap:14px;align-items:end">
        <div>
          <label class="form-label">Icône</label>
          <div id="ksf-icon-slot"
               style="position:relative;width:100px;height:100px;
                      background:rgba(255,255,255,.04);
                      border:1.5px dashed rgba(255,255,255,.12);
                      border-radius:18px;overflow:hidden;cursor:pointer;
                      transition:border-color .12s ease, background .12s ease">
            ${iconPreviewHTML()}
          </div>
          <input type="file" id="ksf-icon-input" accept="image/jpeg,image/png,image/webp,image/gif"
                 style="display:none">
        </div>
        <div>
          <label class="form-label">ID</label>
          <input class="form-input" id="ksf-id" type="text" value="${esc(item.id||'')}" readonly
                 style="opacity:.7;cursor:not-allowed">
          <p class="form-hint" style="margin-top:4px;opacity:.5">L'ID est immuable.</p>
        </div>
        <div>
          <label class="form-label">Sous-titre (punchline)</label>
          <input class="form-input" id="ksf-subtitle" type="text" value="${esc(item.subtitle||'')}"
                 placeholder="ex: Notice descriptive conforme RE 2020">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <label class="form-label">Catégorie</label>
          <select class="form-select" id="ksf-category">
            <option value="">— Choisir —</option>
            ${catOptions}
          </select>
        </div>
        <div>
          <label class="form-label">Sous-catégorie</label>
          <select class="form-select" id="ksf-subcategory">
            ${buildSubOptions(item.category, item.subcategory)}
          </select>
        </div>
      </div>

      <!-- Bloc texte explicatif (titre + texte éditables) -->
      <fieldset style="border:1px solid var(--bd);border-radius:8px;padding:14px 14px 12px;
                       margin:0;background:rgba(255,255,255,.02)">
        <legend style="font-size:11px;font-weight:600;color:var(--gold);padding:0 6px;
                       text-transform:uppercase;letter-spacing:.04em">
          Bloc texte explicatif
        </legend>
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">Titre du bloc</label>
            <input class="form-input" id="ksf-desc-title" type="text"
                   value="${esc((item.descTitle && !/^Bloc texte explicatif/i.test(item.descTitle)) ? item.descTitle : '')}"
                   placeholder="Laissez vide pour « À propos de l'application »">
          </div>
          <div>
            <label class="form-label">Texte (paragraphes séparés par une ligne vide)</label>
            <textarea class="form-textarea" id="ksf-longdesc" rows="6"
                      placeholder="Décrivez ce que fait l'app, pour qui, pourquoi c'est utile…">${esc(item.longDesc||'')}</textarea>
          </div>
        </div>
      </fieldset>

      <!-- Bloc RGPD (titre + texte éditables) -->
      <fieldset style="border:1px solid var(--bd);border-radius:8px;padding:14px 14px 12px;
                       margin:0;background:rgba(255,255,255,.02)">
        <legend style="font-size:11px;font-weight:600;color:var(--gold);padding:0 6px;
                       text-transform:uppercase;letter-spacing:.04em">
          Bloc RGPD / Confidentialité
        </legend>
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">Titre du bloc</label>
            <input class="form-input" id="ksf-rgpd-title" type="text"
                   value="${esc((item.rgpdTitle && !/^Bloc texte explicatif/i.test(item.rgpdTitle)) ? item.rgpdTitle : '')}"
                   placeholder="Laissez vide pour « Confidentialité & RGPD »">
          </div>
          <div>
            <label class="form-label">Texte (paragraphes séparés par une ligne vide)</label>
            <textarea class="form-textarea" id="ksf-rgpd-text" rows="5"
                      placeholder="Indiquez votre politique de confidentialité…">${esc(item.rgpdText || 'Cette application respecte les règles de confidentialité et les normes RGPD en vigueur dans l\'Union Européenne. Aucune donnée saisie n\'est stockée sur des serveurs tiers : tout reste sur votre appareil ou transite uniquement vers le moteur d\'IA que vous avez explicitement configuré.')}</textarea>
          </div>
        </div>
      </fieldset>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <label class="form-label">Optimisé pour (moteur principal)</label>
          <select class="form-select" id="ksf-ai-opt">
            <option value="">— Choisir —</option>
            ${aiOptOptions}
          </select>
        </div>
        <div>
          <label class="form-label">Copyright</label>
          <input class="form-input" id="ksf-copyright" type="text"
                 value="${esc(item.copyright || '© 2026-2027 Protein Studio')}">
        </div>
      </div>

      <div>
        <label class="form-label">Moteurs IA compatibles</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px" id="ksf-ai-cmp-wrap">
          ${aiCmpChecks}
        </div>
        <p class="form-hint" style="opacity:.55;margin-top:4px">
          De 1 à ${KSTORE_AI_ENGINES.length} moteurs — laisser vide pour "aucun précisé".
        </p>
      </div>

      <!-- Image de tête de la carte (cover) -->
      <div>
        <label class="form-label">Image de tête de la carte</label>
        <div id="ksf-cover-slot"
             style="position:relative;aspect-ratio:16/10;max-width:340px;
                    background:rgba(255,255,255,.04);
                    border:1.5px dashed rgba(255,255,255,.12);
                    border-radius:10px;overflow:hidden;cursor:pointer;
                    transition:border-color .12s ease, background .12s ease;margin-top:6px">
        </div>
        <input type="file" id="ksf-cover-input" accept="image/jpeg,image/png,image/webp,image/gif"
               style="display:none">
        <p class="form-hint" style="opacity:.55;margin-top:4px">
          Format 16:10 recommandé. C'est l'image affichée en HAUT de la carte de
          l'app partout dans le Key-Store (catalogue, "À la une", "Également pour
          vous"). Sans image, un léger dégradé de couleur prend le relais.
        </p>
      </div>

      <div>
        <label class="form-label">Captures d'écran (carrousel — autant que vous voulez)</label>
        <div id="ksf-shots" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:6px"></div>
        <input type="file" id="ksf-file-input" accept="image/jpeg,image/png,image/webp,image/gif"
               style="display:none">
        <p class="form-hint" style="opacity:.55;margin-top:4px">
          JPG, PNG, WebP ou GIF — 3 Mo max par image. Ajoutez-en autant que vous
          voulez : elles défilent dans le carrousel de la fiche détail de l'app.
          L'upload est immédiat ; cliquez "Enregistrer la fiche" pour valider.
        </p>
      </div>
    </div>
  `;

  openModal(
    `Fiche Key-Store — ${esc(item.title || item.id)}`,
    formHTML,
    `<button class="btn btn-secondary" id="ksf-cancel">Annuler</button>
     <button class="btn btn-primary"   id="ksf-save">Enregistrer la fiche</button>`
  );

  // Wire-up : changement catégorie → reconstruit la liste sous-catégorie
  const catSel = document.getElementById('ksf-category');
  const subSel = document.getElementById('ksf-subcategory');
  catSel.addEventListener('change', () => {
    subSel.innerHTML = buildSubOptions(catSel.value, null);
  });

  // ── Drag-and-drop / click upload des screenshots (illimité) ───
  const shotsContainer  = document.getElementById('ksf-shots');
  const fileInput       = document.getElementById('ksf-file-input');
  let pendingShotTarget = null;   // index numérique d'un slot OU 'add'

  // Rebuild complet de la grille : toutes les captures + la tuile d'ajout finale.
  const renderShots = () => {
    shotsContainer.innerHTML =
      shotIds.map((_, i) => filledShotSlot(i)).join('') + addShotSlot();
  };
  renderShots();

  // Normalise data-shot ('add' ou index numérique).
  const targetOf = (slot) => slot.dataset.shot === 'add' ? 'add' : +slot.dataset.shot;

  // Upload + ajout (target='add') ou remplacement (target=index)
  const uploadShot = async (file, target) => {
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.type)) {
      toast('Format non supporté (JPG, PNG, WebP, GIF)', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('Image trop volumineuse (max 25 Mo)', 'error');
      return;
    }

    const slotEl = shotsContainer.querySelector(`.ks-shot-slot[data-shot="${target}"]`);
    if (slotEl) {
      slotEl.style.opacity = '.5';
      slotEl.style.pointerEvents = 'none';
    }

    try {
      const { base64: dataBase64, mime } = await compressImageForUpload(file, { maxDim: 1600, budgetBytes: 700 * 1024 });
      const res = await api('/api/admin/screenshot', 'POST', {
        appId: item.id,
        mime,
        dataBase64,
        tenantId: 'default',
      });
      if (!res || !res.id) throw new Error('Réponse upload invalide');

      if (target === 'add') {
        shotIds.push(res.id);
      } else {
        // Remplacement : supprime l'ancien côté serveur (best-effort)
        const oldId = shotIds[target];
        if (oldId) {
          api(`/api/admin/screenshot/${encodeURIComponent(oldId)}`, 'DELETE')
            .catch(() => { /* best-effort */ });
        }
        shotIds[target] = res.id;
      }
      renderShots();
      toast('Capture uploadée ✓');
    } catch (err) {
      if (slotEl) {
        slotEl.style.opacity = '';
        slotEl.style.pointerEvents = '';
      }
      toast(err.message || 'Erreur upload', 'error');
    }
  };

  // Délégation : clic sur slot / sur bouton supprimer
  shotsContainer.addEventListener('click', (e) => {
    // Bouton supprimer
    const delBtn = e.target.closest('.ks-shot-delete');
    if (delBtn) {
      e.stopPropagation();
      const i  = +delBtn.dataset.shot;
      const id = shotIds[i];
      if (id) {
        api(`/api/admin/screenshot/${encodeURIComponent(id)}`, 'DELETE')
          .catch(() => { /* best-effort */ });
      }
      shotIds.splice(i, 1);
      renderShots();
      toast('Capture supprimée');
      return;
    }

    // Clic sur un slot → ouvre le file picker
    const slot = e.target.closest('.ks-shot-slot');
    if (slot) {
      pendingShotTarget = targetOf(slot);
      fileInput.value = '';
      fileInput.click();
    }
  });

  // Drag & drop sur les slots
  shotsContainer.addEventListener('dragover', (e) => {
    const slot = e.target.closest('.ks-shot-slot');
    if (!slot) return;
    e.preventDefault();
    slot.style.borderColor = '#6366f1';
    slot.style.background  = 'rgba(99,102,241,.08)';
  });
  shotsContainer.addEventListener('dragleave', (e) => {
    const slot = e.target.closest('.ks-shot-slot');
    if (!slot) return;
    slot.style.borderColor = '';
    slot.style.background  = '';
  });
  shotsContainer.addEventListener('drop', (e) => {
    const slot = e.target.closest('.ks-shot-slot');
    if (!slot) return;
    e.preventDefault();
    slot.style.borderColor = '';
    slot.style.background  = '';
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadShot(file, targetOf(slot));
  });

  // Sélection via file picker
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file && pendingShotTarget !== null) uploadShot(file, pendingShotTarget);
  });

  // ── Upload / delete icône (pictogramme) ───────────────────────
  const iconSlot  = document.getElementById('ksf-icon-slot');
  const iconInput = document.getElementById('ksf-icon-input');

  const refreshIconSlot = () => { iconSlot.innerHTML = iconPreviewHTML(); };

  const uploadIcon = async (file) => {
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.type)) {
      toast('Format non supporté (JPG, PNG, WebP, GIF)', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('Image trop volumineuse (max 25 Mo)', 'error');
      return;
    }
    iconSlot.style.opacity = '.5';
    try {
      // Icône/logo : PNG pour préserver la transparence, petite dimension.
      const { base64: dataBase64, mime } = await compressImageForUpload(file, { maxDim: 512, budgetBytes: 300 * 1024, format: 'png' });
      const res = await api('/api/admin/screenshot', 'POST', {
        appId: item.id + ':icon',  // namespace dédié
        mime, dataBase64, tenantId: 'default',
      });
      if (!res?.id) throw new Error('Réponse upload invalide');

      // Best-effort : delete l'ancienne icône
      if (currentIconId) {
        api(`/api/admin/screenshot/${encodeURIComponent(currentIconId)}`, 'DELETE').catch(() => {});
      }
      currentIconId = res.id;
      iconSlot.style.opacity = '';
      refreshIconSlot();
      toast('Icône uploadée ✓');
    } catch (err) {
      iconSlot.style.opacity = '';
      toast(err.message || 'Erreur upload icône', 'error');
    }
  };

  iconSlot.addEventListener('click', (e) => {
    if (e.target.closest('#ksf-icon-delete')) {
      if (currentIconId) {
        api(`/api/admin/screenshot/${encodeURIComponent(currentIconId)}`, 'DELETE').catch(() => {});
      }
      currentIconId = null;
      refreshIconSlot();
      toast('Icône supprimée');
      return;
    }
    iconInput.value = '';
    iconInput.click();
  });
  iconSlot.addEventListener('dragover', (e) => {
    e.preventDefault();
    iconSlot.style.borderColor = '#6366f1';
    iconSlot.style.background  = 'rgba(99,102,241,.08)';
  });
  iconSlot.addEventListener('dragleave', () => {
    iconSlot.style.borderColor = '';
    iconSlot.style.background  = '';
  });
  iconSlot.addEventListener('drop', (e) => {
    e.preventDefault();
    iconSlot.style.borderColor = '';
    iconSlot.style.background  = '';
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadIcon(file);
  });
  iconInput.addEventListener('change', () => {
    const file = iconInput.files?.[0];
    if (file) uploadIcon(file);
  });

  // ── Upload / delete photo de présentation (cover) ─────────────
  const coverSlot  = document.getElementById('ksf-cover-slot');
  const coverInput = document.getElementById('ksf-cover-input');

  const coverPreviewHTML = () => currentCoverId
    ? `<img src="${API_BASE}/api/screenshot/${esc(currentCoverId)}" alt=""
            style="width:100%;height:100%;object-fit:cover;pointer-events:none">
       ${_imgActionsBar('id="ksf-cover-delete"')}`
    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                   height:100%;color:rgba(255,255,255,.45);font-size:11px;text-align:center;
                   padding:14px;gap:6px;pointer-events:none">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
              style="width:24px;height:24px;opacity:.6">
           <rect x="3" y="3" width="18" height="18" rx="2"/>
           <circle cx="8.5" cy="8.5" r="1.5"/>
           <polyline points="21 15 16 10 5 21"/>
         </svg>
         <div><strong>Photo de présentation</strong></div>
         <div style="opacity:.75">Glissez une image ou cliquez</div>
       </div>`;

  const refreshCoverSlot = () => { coverSlot.innerHTML = coverPreviewHTML(); };
  refreshCoverSlot();

  const uploadCover = async (file) => {
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(file.type)) {
      toast('Format non supporté (JPG, PNG, WebP, GIF)', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('Image trop volumineuse (max 25 Mo)', 'error');
      return;
    }
    coverSlot.style.opacity = '.5';
    try {
      const { base64: dataBase64, mime } = await compressImageForUpload(file, { maxDim: 1600, budgetBytes: 700 * 1024 });
      const res = await api('/api/admin/screenshot', 'POST', {
        appId: item.id + ':cover',
        mime, dataBase64, tenantId: 'default',
      });
      if (!res?.id) throw new Error('Réponse upload invalide');
      if (currentCoverId) {
        api(`/api/admin/screenshot/${encodeURIComponent(currentCoverId)}`, 'DELETE').catch(() => {});
      }
      currentCoverId = res.id;
      coverSlot.style.opacity = '';
      refreshCoverSlot();
      toast('Photo de présentation uploadée ✓');
    } catch (err) {
      coverSlot.style.opacity = '';
      toast(err.message || 'Erreur upload', 'error');
    }
  };

  coverSlot.addEventListener('click', (e) => {
    if (e.target.closest('#ksf-cover-delete')) {
      if (currentCoverId) {
        api(`/api/admin/screenshot/${encodeURIComponent(currentCoverId)}`, 'DELETE').catch(() => {});
      }
      currentCoverId = null;
      refreshCoverSlot();
      toast('Photo de présentation supprimée');
      return;
    }
    coverInput.value = '';
    coverInput.click();
  });
  coverSlot.addEventListener('dragover', (e) => {
    e.preventDefault();
    coverSlot.style.borderColor = '#6366f1';
    coverSlot.style.background  = 'rgba(99,102,241,.08)';
  });
  coverSlot.addEventListener('dragleave', () => {
    coverSlot.style.borderColor = '';
    coverSlot.style.background  = '';
  });
  coverSlot.addEventListener('drop', (e) => {
    e.preventDefault();
    coverSlot.style.borderColor = '';
    coverSlot.style.background  = '';
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadCover(file);
  });
  coverInput.addEventListener('change', () => {
    const file = coverInput.files?.[0];
    if (file) uploadCover(file);
  });

  // Bouton annuler / save
  document.getElementById('ksf-cancel').addEventListener('click', closeModal);
  document.getElementById('ksf-save').addEventListener('click', async () => {
    const btn = document.getElementById('ksf-save');
    btn.disabled = true; btn.textContent = '…';

    // Update local catalogData
    item.subtitle      = document.getElementById('ksf-subtitle').value.trim();
    item.category      = catSel.value || undefined;
    item.subcategory   = subSel.value || undefined;
    item.longDesc      = document.getElementById('ksf-longdesc').value.trim();
    item.descTitle     = document.getElementById('ksf-desc-title').value.trim() || undefined;
    item.rgpdTitle     = document.getElementById('ksf-rgpd-title').value.trim() || undefined;
    item.rgpdText      = document.getElementById('ksf-rgpd-text').value.trim() || undefined;
    item.ai_optimized  = document.getElementById('ksf-ai-opt').value || undefined;
    item.copyright     = document.getElementById('ksf-copyright').value.trim();
    item.ai_compatible = Array.from(document.querySelectorAll('.ks-ai-cmp:checked')).map(c => c.value);

    // Icône (pictogramme de profil app)
    if (currentIconId) item.iconId = currentIconId;
    else               delete item.iconId;

    // Photo de présentation (cover des cards "À la une")
    if (currentCoverId) item.coverId = currentCoverId;
    else                delete item.coverId;

    // Persiste les screenshots (filtre les slots vides)
    const cleanShots = shotIds.filter(Boolean);
    if (cleanShots.length > 0) item.screenshots = cleanShots;
    else                       delete item.screenshots;

    // Persistance D1
    try {
      catalogData.updatedAt = new Date().toISOString().slice(0,10);
      await api('/api/admin/catalog', 'POST', { catalog: catalogData, tenantId: 'default' });
      closeModal();
      toast('Fiche enregistrée ✓');
      renderCatalog(panel);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Enregistrer la fiche';
    }
  });
}

// ── Création d'une nouvelle app vide ───────────────────────────
function createNewKStoreApp(panel) {
  // Demande un id à l'utilisateur (avec génération suggérée)
  const suggestedId = `O-CUSTOM-${String(Date.now()).slice(-6)}`;
  const id = prompt(
    'Identifiant unique de la nouvelle app\n' +
    '(format conseillé : O-XXX-001 — lettres majuscules / chiffres / tirets)',
    suggestedId
  );
  if (!id) return;

  const trimmed = id.trim();
  if (!/^[A-Z0-9-]+$/i.test(trimmed)) {
    toast('Identifiant invalide (lettres, chiffres, tirets uniquement)', 'error');
    return;
  }
  if (catalogData.tools.some(t => t.id === trimmed)) {
    toast('Cet identifiant existe déjà', 'error');
    return;
  }

  // Push entry vide + ouvre l'éditeur
  const newApp = {
    id: trimmed,
    title: 'Nouvelle app',
    subtitle: '',
    plan: 'STARTER',
    price: 0,
    published: false,
    isNew: true,
    copyright: '© 2026-2027 Protein Studio',
    ai_compatible: [],
  };
  catalogData.tools.push(newApp);

  // Re-render la table puis ouvre l'éditeur sur la nouvelle ligne
  renderCatalog(panel);
  setTimeout(() => openKStoreFicheEditor(catalogData.tools.length - 1, panel), 60);
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
// TAB — BUDGET IA (compteur neurones Workers AI + bridage) · 2026-05-29
// ══════════════════════════════════════════════════════════════════
// Compte NOUS-MÊMES chaque appel Workers AI (Cloudflare n'expose aucune
// conso temps réel fiable — tableaux à plusieurs heures de retard).
//   • neurones = chiffre solide (notre comptage)
//   • € = ESTIMATION à caler sur la 1re vraie facture Cloudflare
//   • appels BYOK (Claude/Gemini via clé perso) = hors neurones, non comptés
// Endpoints : GET /api/admin/ai-budget · POST .../throttle · POST .../threshold
let _budgetRefreshTimer = null;

const _BUDGET_TOOL_LABELS = {
  'ghostwriter'  : 'Ghost Writer',
  'brainstorming': 'Brainstorming',
  'living-layer' : 'Living Layer',
  'smart-qr'     : 'Smart QR',
  'ai-generate'  : 'Génération texte',
};
function _budgetToolLabel(t) { return _BUDGET_TOOL_LABELS[t] || (t || '—'); }
function _fmtNeurons(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR'); }
function _fmtEur(n)     { return (Number(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
function _budgetSvg(paths, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;flex-shrink:0">${paths}</svg>`;
}
function _budgetBar(pct, color) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="height:8px;background:var(--navy);border-radius:6px;overflow:hidden;border:1px solid var(--border)">
    <div style="height:100%;width:${w}%;background:${color};transition:width .35s ease"></div></div>`;
}

async function renderBudget(panel) {
  clearInterval(_budgetRefreshTimer);
  let state;
  try {
    state = await api('/api/admin/ai-budget');
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
    return;
  }

  const modelShort = (state.pricing?.model || '').includes('mistral-small-3.1')
    ? 'Mistral Small 3.1 (24B)' : (state.pricing?.model || '—');

  panel.innerHTML = `
    <div class="section-header">
      <h2 class="section-title" style="display:flex;align-items:center;gap:9px">
        ${_budgetSvg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>', 20)} Budget IA
      </h2>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:var(--text-muted)">Actualisation auto · 15 s</span>
        <button class="btn btn-secondary btn-sm" id="budget-refresh">↻ Rafraîchir</button>
      </div>
    </div>

    <p style="color:var(--text-muted);font-size:13px;margin:0 0 18px;max-width:760px">
      Compteur maison des appels au moteur IA interne (${esc(modelShort)}).
      Le chiffre en <strong style="color:var(--text)">neurones</strong> est fiable&nbsp;;
      le chiffre en <strong style="color:var(--text)">€ est une estimation</strong> à caler sur ta 1<sup>re</sup> facture Cloudflare.
      Les générations via ta propre clé (Claude/Gemini) sont facturées ailleurs et ne sont pas comptées ici.
    </p>

    <div id="budget-banner"></div>
    <div id="budget-meter"></div>

    <!-- ── CONTRÔLES ───────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px">

      <!-- Bridage manuel -->
      <div class="stat-card" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700">
          ${_budgetSvg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>')} Interrupteur IA
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:0">
          Coupe immédiatement toutes les fonctions IA internes. Les outils continuent de marcher,
          seules les générations IA sont mises en pause.
        </p>
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;margin-top:2px">
          <span class="toggle-switch">
            <input type="checkbox" id="budget-throttle" ${state.control?.throttle_on ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </span>
          <span id="budget-throttle-label" style="font-size:13px;font-weight:600;color:${state.control?.throttle_on ? 'var(--danger)' : 'var(--success)'}">
            ${state.control?.throttle_on ? 'IA en pause — cliquer pour réactiver' : 'IA active — cliquer pour couper'}
          </span>
        </label>
        <p style="font-size:11px;color:var(--text-muted);margin:0;line-height:1.45">
          ⚠ Réactiver l'IA désactive aussi l'auto-bridage (pour qu'il ne se redéclenche pas tout de suite).
          Réactive l'auto-bridage ci-contre si besoin.
        </p>
      </div>

      <!-- Auto-bridage au seuil -->
      <div class="stat-card" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700">
          ${_budgetSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>')} Coupure automatique
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:0">
          Coupe l'IA toute seule quand l'estimation du mois dépasse ce plafond.
        </p>
        <div style="display:flex;align-items:flex-end;gap:10px">
          <div class="form-group" style="flex:1">
            <label class="form-label" for="budget-threshold">Plafond mensuel (€)</label>
            <input type="number" id="budget-threshold" class="form-input" min="0" max="10000" step="1"
                   value="${Number(state.control?.threshold_eur ?? 10)}">
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:11px;white-space:nowrap">
            <span class="toggle-switch">
              <input type="checkbox" id="budget-auto" ${state.control?.auto_on ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </span>
            <span style="font-size:12px;font-weight:600">Auto</span>
          </label>
        </div>
        <button class="btn btn-primary btn-sm" id="budget-save" style="align-self:flex-start">Enregistrer le réglage</button>
      </div>
    </div>
  `;

  _paintBudget(panel, state);

  // ── Câblage des contrôles ────────────────────────────────────
  panel.querySelector('#budget-refresh')?.addEventListener('click', () => renderBudget(panel));

  panel.querySelector('#budget-throttle')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    try {
      const fresh = await api('/api/admin/ai-budget/throttle', 'POST', { on });
      toast(on ? 'IA mise en pause' : 'IA réactivée', on ? 'error' : 'success');
      renderBudget(panel); // resync complet (l'auto a pu être désactivé)
      return fresh;
    } catch (err) {
      toast(err.message, 'error');
      e.target.checked = !on; e.target.disabled = false;
    }
  });

  panel.querySelector('#budget-save')?.addEventListener('click', async (e) => {
    const eur  = Number(panel.querySelector('#budget-threshold')?.value);
    const auto = !!panel.querySelector('#budget-auto')?.checked;
    e.target.disabled = true; e.target.textContent = '…';
    try {
      await api('/api/admin/ai-budget/threshold', 'POST', { eur, auto });
      toast('Réglage enregistré ✓');
      renderBudget(panel);
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false; e.target.textContent = 'Enregistrer le réglage';
    }
  });

  // ── Auto-refresh du compteur (read-only), s'auto-coupe hors onglet ─
  _budgetRefreshTimer = setInterval(async () => {
    const p = document.getElementById('tab-budget');
    if (!p || !p.classList.contains('active')) { clearInterval(_budgetRefreshTimer); return; }
    try {
      const fresh = await api('/api/admin/ai-budget');
      _paintBudget(panel, fresh);
    } catch (_) { /* silencieux : on retentera au prochain tick */ }
  }, 15000);
}

// Peint UNIQUEMENT les zones read-only (bannière + compteur) + resynchronise
// l'état du toggle de bridage. Ne touche jamais au champ seuil si l'admin est
// en train de le saisir (évite d'écraser sa frappe pendant l'auto-refresh).
function _paintBudget(panel, state) {
  const c = state.control || {};
  const today = state.today || {};
  const month = state.month || {};

  // ── Bannière d'état ──
  const banner = panel.querySelector('#budget-banner');
  if (banner) {
    let bg, border, color, icon, title, sub;
    if (c.throttle_on) {
      bg = 'rgba(224,92,92,0.10)'; border = 'rgba(224,92,92,0.32)'; color = 'var(--danger)';
      icon = _budgetSvg('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>', 18);
      title = 'IA en pause';
      sub = (c.reason === 'auto')
        ? `Coupure automatique : plafond de ${_fmtEur(c.threshold_eur)} atteint.`
        : 'Bridage manuel activé depuis cet écran.';
      if (c.throttled_at) { try { sub += ' Depuis le ' + new Date(c.throttled_at).toLocaleString('fr-FR'); } catch (_) {} }
    } else if (c.near_threshold) {
      bg = 'rgba(201,168,76,0.10)'; border = 'var(--border)'; color = 'var(--gold)';
      icon = _budgetSvg('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 18);
      title = `Proche du plafond (${c.pct}%)`;
      sub = `Estimation du mois : ${_fmtEur(month.eur_est)} sur un plafond de ${_fmtEur(c.threshold_eur)}.`;
    } else {
      bg = 'rgba(76,175,128,0.08)'; border = 'rgba(76,175,128,0.26)'; color = 'var(--success)';
      icon = _budgetSvg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', 18);
      title = 'IA active';
      sub = c.auto_on
        ? `Coupure automatique armée à ${_fmtEur(c.threshold_eur)}/mois.`
        : 'Coupure automatique désactivée.';
    }
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:13px;background:${bg};border:1px solid ${border};border-radius:var(--radius);padding:14px 18px;margin-bottom:20px">
        <span style="color:${color}">${icon}</span>
        <div style="flex:1">
          <div style="font-weight:800;font-size:14px;color:${color};letter-spacing:-0.02em">${title}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${esc(sub)}</div>
        </div>
      </div>`;
  }

  // ── Compteur (stats + barres + détail par outil) ──
  const meter = panel.querySelector('#budget-meter');
  if (meter) {
    const freePct  = today.free_used_pct || 0;
    const freeColor = freePct >= 100 ? 'var(--danger)' : freePct >= 80 ? 'var(--gold)' : 'var(--success)';
    const thrPct   = c.pct || 0;
    const thrColor = thrPct >= 100 ? 'var(--danger)' : thrPct >= 80 ? 'var(--gold)' : 'var(--success)';
    const byTool   = today.by_tool || [];

    meter.innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card">
          <div class="stat-label">Aujourd'hui · neurones</div>
          <div class="stat-value" style="font-size:26px">${_fmtNeurons(today.neurons)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${today.calls || 0} appel${(today.calls || 0) > 1 ? 's' : ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Aujourd'hui · € estimés</div>
          <div class="stat-value" style="font-size:26px;color:${(today.eur_est || 0) > 0 ? 'var(--gold)' : 'var(--success)'}">${_fmtEur(today.eur_est)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">au-delà de l'enveloppe offerte</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ce mois · neurones</div>
          <div class="stat-value" style="font-size:26px">${_fmtNeurons(month.neurons)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${month.calls || 0} appel${(month.calls || 0) > 1 ? 's' : ''} · ${esc(month.prefix || '')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ce mois · € estimés</div>
          <div class="stat-value" style="font-size:26px;color:${(month.eur_est || 0) > 0 ? 'var(--gold)' : 'var(--success)'}">${_fmtEur(month.eur_est)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:6px">facturé par Cloudflare</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:26px">
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
            <span class="stat-label" style="margin:0">Enveloppe offerte du jour</span>
            <span style="font-size:12px;font-weight:700;color:${freeColor}">${freePct}%</span>
          </div>
          ${_budgetBar(freePct, freeColor)}
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">
            ${_fmtNeurons(today.neurons)} / ${_fmtNeurons(today.free_per_day)} neurones gratuits par jour
          </div>
        </div>
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
            <span class="stat-label" style="margin:0">Plafond mensuel</span>
            <span style="font-size:12px;font-weight:700;color:${thrColor}">${thrPct}%</span>
          </div>
          ${_budgetBar(thrPct, thrColor)}
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">
            ${_fmtEur(month.eur_est)} estimés / ${_fmtEur(c.threshold_eur)} de plafond
          </div>
        </div>
      </div>

      <h3 style="font-size:13px;font-weight:700;letter-spacing:-0.02em;margin:0 0 12px">Détail du jour par outil</h3>
      ${byTool.length === 0
        ? '<div class="empty-state" style="padding:32px"><p style="font-size:13px">Aucun appel IA aujourd\'hui.</p></div>'
        : `<table class="data-table">
            <thead><tr><th>Outil</th><th>Appels</th><th>Neurones</th><th>Part du jour</th></tr></thead>
            <tbody>${byTool.map(r => {
              const part = today.neurons > 0 ? Math.round((r.neurons / today.neurons) * 100) : 0;
              return `<tr>
                <td style="font-weight:600">${esc(_budgetToolLabel(r.tool))}</td>
                <td style="color:var(--text-muted)">${r.calls || 0}</td>
                <td>${_fmtNeurons(r.neurons)}</td>
                <td style="color:var(--text-muted)">${part}%</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`}
      <p style="font-size:11px;color:var(--text-muted);margin:14px 0 24px;line-height:1.5">
        Barème indicatif : ${state.pricing?.usd_per_1k_neurons} $ / 1 000 neurones au-delà de
        ${_fmtNeurons(state.pricing?.free_neurons_per_day)} offerts/jour, converti en € au taux ${state.pricing?.usd_to_eur}.
      </p>`;
  }

  // ── Resync non-destructif du toggle de bridage ──
  const tg = panel.querySelector('#budget-throttle');
  if (tg && document.activeElement !== tg) {
    tg.checked = !!c.throttle_on;
    const lbl = panel.querySelector('#budget-throttle-label');
    if (lbl) {
      lbl.textContent = c.throttle_on ? 'IA en pause — cliquer pour réactiver' : 'IA active — cliquer pour couper';
      lbl.style.color = c.throttle_on ? 'var(--danger)' : 'var(--success)';
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// TAB 5 — APPAREILS (Devices)
// ══════════════════════════════════════════════════════════════════
async function renderDevices(panel) {
  try {
    const { devices = [], total = 0, pending = 0, approved = 0 } = await api('/api/admin/devices');
    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Appareils <span>(${total})</span></h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="btn-filter-all"    data-filter="">Tous (${total})</button>
          <button class="btn btn-secondary btn-sm" id="btn-filter-pending" data-filter="false"
                  style="${pending>0?'border-color:var(--gold);color:var(--gold)':''}">
            En attente (${pending})
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-filter-approved" data-filter="true">
            Approuvés (${approved})
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-refresh-devices">↻</button>
        </div>
      </div>
      ${total === 0
        ? '<div class="empty-state"><div class="icon">📱</div><p>Aucun appareil enregistré</p></div>'
        : `<table class="data-table">
            <thead><tr>
              <th>Label</th><th>Email</th><th>Type</th><th>Statut</th>
              <th>Approuvé par</th><th>Dernière connexion</th><th>Actions</th>
            </tr></thead>
            <tbody id="devices-tbody"></tbody>
          </table>`}`;

    if (total > 0) {
      const tbody = panel.querySelector('#devices-tbody');
      _renderDeviceRows(tbody, devices);

      tbody.addEventListener('click', async e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const deviceId = btn.dataset.deviceId;
        if (btn.dataset.action === 'approve') {
          btn.disabled = true; btn.textContent = '…';
          try {
            const res = await api('/api/device/approve', 'POST', { deviceId, approvedBy: 'admin' });
            toast(`✓ Approuvé — Token : ${res.token}`, 'success');
            renderDevices(panel);
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Approuver'; }
        }
        if (btn.dataset.action === 'revoke') {
          if (!confirm(`Révoquer l'appareil "${btn.dataset.label}" ?`)) return;
          btn.disabled = true; btn.textContent = '…';
          try {
            await api('/api/device/revoke', 'POST', { deviceId });
            toast('Appareil révoqué', 'error');
            renderDevices(panel);
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Révoquer'; }
        }
      });

      // Filtres
      panel.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const filter = btn.dataset.filter;
          const url    = filter === '' ? '/api/admin/devices' : `/api/admin/devices?approved=${filter}`;
          const data   = await api(url);
          const tbody  = panel.querySelector('#devices-tbody');
          if (tbody) _renderDeviceRows(tbody, data.devices || []);
          panel.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
        });
      });
    }

    panel.querySelector('#btn-refresh-devices')?.addEventListener('click', () => renderDevices(panel));
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function _renderDeviceRows(tbody, devices) {
  tbody.innerHTML = '';
  if (!devices.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px">Aucun appareil dans ce filtre</td></tr>';
    return;
  }
  devices.forEach(d => {
    const tr = document.createElement('tr');
    const lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString('fr-FR') : '—';
    const created  = d.createdAt ? new Date(d.createdAt).toLocaleDateString('fr-FR') : '—';
    tr.innerHTML = `
      <td>
        <div style="font-weight:600">${esc(d.label||'—')}</div>
        <div style="font-size:11px;color:var(--text-muted)">Créé le ${created}</div>
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${esc(d.email||'—')}</td>
      <td><span class="badge badge-plan-starter">${esc(d.type||'tablet')}</span></td>
      <td>
        <span class="badge ${d.approved ? 'badge-active' : 'badge-revoked'}">
          ${d.approved ? '✓ Approuvé' : '⏳ En attente'}
        </span>
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${esc(d.approvedBy||'—')}</td>
      <td style="font-size:12px;color:var(--text-muted)">${lastSeen}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${!d.approved
          ? `<button class="btn btn-primary btn-sm" data-action="approve" data-device-id="${esc(d.id)}">Approuver</button>`
          : ''}
        <button class="btn btn-danger btn-sm" data-action="revoke"
                data-device-id="${esc(d.id)}" data-label="${esc(d.label)}">Révoquer</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB AUDIT LOG (Sprint S5.4) — listing paginé + filtres
// ══════════════════════════════════════════════════════════════════
// Consomme GET /api/admin/audit (S5.3). Filtres optionnels :
//   action, target, tenant, since, limit.
// Read-only — pas d'action destructive depuis cette vue.
async function renderAuditLog(panel) {
  panel.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Audit Log <span>· Sprint Sécu-4 + S5</span></h2>
      <button class="btn btn-secondary btn-sm" id="btn-audit-refresh">↻ Rafraîchir</button>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--navy-2)">
      <div style="flex:1;min-width:180px">
        <label class="form-label" style="display:block;font-size:11px">Action</label>
        <input type="text" id="audit-f-action" class="form-input" placeholder="ex: licence_revoke" style="width:100%">
      </div>
      <div style="flex:1;min-width:180px">
        <label class="form-label" style="display:block;font-size:11px">Target (clé licence, deviceId...)</label>
        <input type="text" id="audit-f-target" class="form-input" placeholder="ex: KSTN-XXXX-..." style="width:100%">
      </div>
      <div style="flex:1;min-width:140px">
        <label class="form-label" style="display:block;font-size:11px">Tenant</label>
        <input type="text" id="audit-f-tenant" class="form-input" placeholder="ex: default" style="width:100%">
      </div>
      <div style="flex:1;min-width:140px">
        <label class="form-label" style="display:block;font-size:11px">Depuis (ISO)</label>
        <input type="date" id="audit-f-since" class="form-input" style="width:100%">
      </div>
      <div style="flex:0 0 auto;display:flex;align-items:flex-end">
        <button class="btn btn-primary btn-sm" id="btn-audit-apply">Appliquer</button>
      </div>
    </div>

    <div id="audit-table-container"><div class="loading">Chargement…</div></div>
  `;

  const container = panel.querySelector('#audit-table-container');

  async function loadAudit(filters = {}) {
    container.innerHTML = '<div class="loading">Chargement…</div>';
    const qs = new URLSearchParams();
    if (filters.action) qs.set('action', filters.action);
    if (filters.target) qs.set('target', filters.target);
    if (filters.tenant) qs.set('tenant', filters.tenant);
    if (filters.since)  qs.set('since',  filters.since);
    qs.set('limit', '200');
    try {
      const res = await api('/api/admin/audit' + (qs.toString() ? '?' + qs.toString() : ''));
      const entries = res.entries || [];
      if (!entries.length) {
        container.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Aucune entrée audit</p></div>';
        return;
      }
      container.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>Horodatage</th>
              <th>Action</th>
              <th>Acteur</th>
              <th>Target</th>
              <th>Tenant</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">${entries.length} entrée${entries.length > 1 ? 's' : ''} — limite 200</div>
      `;
      const tbody = container.querySelector('tbody');
      entries.forEach(e => {
        const tr = document.createElement('tr');
        const tsStr = e.ts ? new Date(e.ts.replace(' ', 'T') + 'Z').toLocaleString('fr-FR') : '—';
        const details = e.details ? JSON.stringify(e.details, null, 2) : '';
        tr.innerHTML = `
          <td style="white-space:nowrap;font-size:12px;color:var(--text-muted)">${esc(tsStr)}</td>
          <td><code style="font-family:'SF Mono',monospace;font-size:12px;color:var(--gold)">${esc(e.action)}</code></td>
          <td style="font-size:12px">${esc(e.actor || '—')}</td>
          <td style="font-family:'SF Mono',monospace;font-size:11px;color:var(--text)">${esc(e.target || '—')}</td>
          <td style="font-size:12px;color:var(--text-muted)">${esc(e.tenant_id || '—')}</td>
          <td><details style="cursor:pointer"><summary style="font-size:11px;color:var(--text-muted)">${details ? 'voir' : '—'}</summary><pre style="font-size:11px;background:var(--navy);padding:8px;border-radius:6px;margin-top:4px;max-width:480px;overflow:auto">${esc(details)}</pre></details></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      container.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
    }
  }

  panel.querySelector('#btn-audit-refresh').addEventListener('click', () => loadAudit(_currentAuditFilters()));
  panel.querySelector('#btn-audit-apply').addEventListener('click', () => loadAudit(_currentAuditFilters()));

  function _currentAuditFilters() {
    return {
      action: panel.querySelector('#audit-f-action').value.trim(),
      target: panel.querySelector('#audit-f-target').value.trim(),
      tenant: panel.querySelector('#audit-f-tenant').value.trim(),
      since:  panel.querySelector('#audit-f-since').value.trim(),
    };
  }

  await loadAudit();
}

// ══════════════════════════════════════════════════════════════════
// TAB 6 — RÉGLAGES · RGPD
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

    <!-- ── Vault : Clés API Moteurs IA ── -->
    <div class="rgpd-section" id="vault-section">
      <div class="rgpd-section-title">
        🔑 Coffre-fort API — Clés Moteurs IA
        <span class="rgpd-chip">AES-256-GCM</span>
      </div>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.65;margin-bottom:16px">
        Stockez les clés API de chaque moteur de manière chiffrée dans le Worker.
        Les clés ne sont <strong>jamais</strong> transmises en clair côté client.
      </p>
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
        <div class="form-group" style="flex:1;min-width:140px">
          <label class="form-label">Moteur</label>
          <select class="form-input" id="vault-provider">
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT-4o)</option>
            <option value="google">Google (Gemini)</option>
            <option value="mistral">Mistral</option>
            <option value="perplexity">Perplexity</option>
            <option value="grok">Grok (xAI)</option>
          </select>
        </div>
        <div class="form-group" style="flex:2;min-width:200px">
          <label class="form-label">Clé API</label>
          <input type="password" class="form-input" id="vault-api-key"
                 placeholder="sk-…  ou  AIza…" autocomplete="new-password">
        </div>
        <button class="btn btn-primary" id="btn-vault-save" style="flex-shrink:0">
          Chiffrer &amp; Sauvegarder
        </button>
      </div>
      <div id="vault-status" style="font-size:12px;min-height:16px;margin-bottom:12px"></div>
      <div id="vault-configured">
        <div class="loading" style="padding:8px 0;font-size:12px">Chargement des clés configurées…</div>
      </div>
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

  // ── Vault : chargement des clés configurées ───────────────────
  async function _loadVaultKeys() {
    const container = panel.querySelector('#vault-configured');
    try {
      const { keys = [], configured = [] } = await api('/api/admin/keys');
      if (keys.length === 0) {
        container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">Aucune clé configurée pour l\'instant.</p>';
        return;
      }
      const providers = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', mistral: 'Mistral', perplexity: 'Perplexity', grok: 'Grok' };
      container.innerHTML = `
        <table class="data-table" style="margin-top:4px">
          <thead><tr>
            <th>Moteur</th><th>Label</th><th>Enregistré le</th><th></th>
          </tr></thead>
          <tbody>
            ${keys.map(k => `
              <tr>
                <td><span class="badge badge-plan-pro">${esc(providers[k.provider] || k.provider)}</span></td>
                <td style="font-size:12px;color:var(--text-muted)">${esc(k.label || k.provider)}</td>
                <td style="font-size:12px;color:var(--text-muted)">${k.savedAt ? new Date(k.savedAt).toLocaleDateString('fr-FR') : '—'}</td>
                <td>
                  <button class="btn btn-danger btn-sm" data-action="delete-key"
                          data-provider="${esc(k.provider)}">Supprimer</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      container.querySelector('tbody').addEventListener('click', async e => {
        const btn = e.target.closest('[data-action="delete-key"]');
        if (!btn) return;
        const provider = btn.dataset.provider;
        if (!confirm(`Supprimer la clé "${provider}" du coffre ?`)) return;
        btn.disabled = true; btn.textContent = '…';
        try {
          await api('/api/admin/keys', 'DELETE', { provider, tenantId: 'default' });
          toast(`Clé "${provider}" supprimée`, 'error');
          _loadVaultKeys();
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Supprimer'; }
      });
    } catch (err) {
      container.innerHTML = `<p style="font-size:12px;color:var(--danger)">${esc(err.message)}</p>`;
    }
  }
  _loadVaultKeys();

  // ── Vault : save handler ──────────────────────────────────────
  panel.querySelector('#btn-vault-save').addEventListener('click', async () => {
    const providerEl = panel.querySelector('#vault-provider');
    const keyEl      = panel.querySelector('#vault-api-key');
    const statusEl   = panel.querySelector('#vault-status');
    const btn        = panel.querySelector('#btn-vault-save');

    const provider = providerEl.value;
    const apiKey   = keyEl.value.trim();
    if (!apiKey) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = 'La clé API ne peut pas être vide.';
      return;
    }

    btn.disabled = true; btn.textContent = '…';
    statusEl.textContent = '';
    try {
      await api('/api/admin/keys', 'POST', { provider, apiKey, label: providerEl.options[providerEl.selectedIndex].text, tenantId: 'default' });
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ Clé "${provider}" chiffrée et sauvegardée.`;
      keyEl.value = '';
      _loadVaultKeys();
    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `Erreur : ${err.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Chiffrer & Sauvegarder';
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB — MESSAGERIE  ⚠️ DÉSACTIVÉ 2026-06-01 (onglet retiré, fonction non câblée)
// Push de messages dans la zone DST du dashboard client.
// Éclipsé par le Living Layer V2 (même ligne sous "Bonjour, X" ; le DST est masqué
// quand le V2 est ON, càd par défaut). Conservé pour réversibilité — backend intact.
// ══════════════════════════════════════════════════════════════════
async function renderMessaging(panel) {
  try {
    const { messages = [], total = 0 } = await api('/api/admin/messages');
    const active   = messages.filter(m => m.status === 'active').length;
    const expired  = messages.filter(m => m.status === 'expired').length;
    const revoked  = messages.filter(m => m.status === 'revoked').length;

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Messagerie <span>(${total})</span></h2>
        <button class="btn btn-primary" id="btn-new-msg">+ Nouveau message</button>
      </div>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card"><div class="stat-label">Actifs</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Expirés</div><div class="stat-value" style="color:var(--text-muted)">${expired}</div></div>
        <div class="stat-card"><div class="stat-label">Révoqués</div><div class="stat-value" style="color:#e05c5c">${revoked}</div></div>
      </div>
      ${total === 0
        ? '<div class="empty-state"><div class="icon">✉</div><p>Aucun message envoyé</p></div>'
        : `<table class="data-table">
            <thead><tr>
              <th>Statut</th><th>Niveau</th><th>Cible</th><th>Message</th>
              <th>CTA</th><th>Expire</th><th>Créé</th><th style="min-width:230px">Actions</th>
            </tr></thead>
            <tbody>${messages.map(_renderMessageRow).join('')}</tbody>
          </table>`}
    `;

    // Map id -> message pour edition (eviter de re-fetcher)
    const byId = Object.fromEntries(messages.map(m => [m.id, m]));

    panel.querySelector('#btn-new-msg').addEventListener('click', () => showMessageModal(panel));

    // Modifier
    panel.querySelectorAll('[data-action="edit-msg"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = byId[btn.dataset.id];
        if (msg) showMessageModal(panel, msg);
      });
    });

    // Révoquer (soft)
    panel.querySelectorAll('[data-action="revoke-msg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Révoquer ce message ?\n\nIl reste en base et peut être republié plus tard.')) return;
        btn.disabled = true;
        try {
          await api('/api/admin/messages/revoke', 'POST', { id: btn.dataset.id });
          toast('Message révoqué', 'error');
          renderMessaging(panel);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    });

    // Republier
    panel.querySelectorAll('[data-action="republish-msg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Republier ce message ?\n\nIl redevient visible pour les utilisateurs (sans expiration).')) return;
        btn.disabled = true;
        try {
          await api('/api/admin/messages/republish', 'POST', { id: btn.dataset.id, expiresAt: null });
          toast('Message republié ✓');
          renderMessaging(panel);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    });

    // Supprimer (hard delete)
    panel.querySelectorAll('[data-action="delete-msg"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement ce message ?\n\nCette action est irréversible.')) return;
        btn.disabled = true;
        try {
          await api('/api/admin/messages', 'DELETE', { id: btn.dataset.id });
          toast('Message supprimé', 'error');
          renderMessaging(panel);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    });

  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function _renderMessageRow(m) {
  const statusColor = m.status === 'active' ? '#4caf80'
                    : m.status === 'expired' ? 'var(--text-muted)' : '#e05c5c';
  const statusLabel = m.status === 'active'  ? 'Actif'
                    : m.status === 'expired' ? 'Expiré' : 'Révoqué';
  const levelBadge  = m.level === 'urgent' ? '🔴 Urgent'
                    : m.level === 'promo'  ? '🟢 Promo' : '🔵 Info';
  const fullBody = m.title ? `${m.title} — ${m.body}` : m.body;
  const truncated = fullBody.length > 80 ? fullBody.slice(0, 78) + '…' : fullBody;
  const cta = m.cta_label
    ? `<a href="${esc(m.cta_url || '#')}" target="_blank" rel="noopener" style="color:var(--gold);font-size:11px">${esc(m.cta_label)} ↗</a>`
    : '<span style="color:var(--text-muted);font-size:11px">—</span>';
  const expires = m.expires_at
    ? new Date(m.expires_at.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : '<span style="color:var(--text-muted)">∞</span>';
  const created = new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  // Boutons d'action selon le statut
  const editBtn = `<button class="btn btn-sm btn-msg-action" data-action="edit-msg" data-id="${esc(m.id)}" title="Modifier le contenu">✏ Modifier</button>`;
  const delBtn  = `<button class="btn btn-sm btn-msg-action" data-action="delete-msg"   data-id="${esc(m.id)}" title="Supprimer définitivement" style="color:#e05c5c;border-color:rgba(224,92,92,.35)">🗑 Supprimer</button>`;
  const revBtn  = `<button class="btn btn-sm btn-msg-action" data-action="revoke-msg"   data-id="${esc(m.id)}" title="Révoquer (soft)" style="color:#e0a25c">⏸ Révoquer</button>`;
  const repBtn  = `<button class="btn btn-sm btn-msg-action" data-action="republish-msg" data-id="${esc(m.id)}" title="Republier" style="color:#4caf80;border-color:rgba(76,175,128,.35)">▶ Republier</button>`;

  // active: edit + revoke + delete
  // revoked / expired: edit + republish + delete
  const actions = m.status === 'active'
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}${revBtn}${delBtn}</div>`
    : `<div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}${repBtn}${delBtn}</div>`;

  return `<tr>
    <td><span style="color:${statusColor};font-weight:600">${statusLabel}</span></td>
    <td>${levelBadge}</td>
    <td><code style="font-size:11px;color:var(--text-muted)">${esc(m.target)}</code></td>
    <td title="${esc(fullBody)}" style="max-width:340px">${esc(truncated)}</td>
    <td>${cta}</td>
    <td style="font-size:11px">${expires}</td>
    <td style="font-size:11px;color:var(--text-muted)">${created}</td>
    <td>${actions}</td>
  </tr>`;
}

/**
 * Modal Création / Édition de message.
 * @param {HTMLElement} panel — panneau admin pour rerender après save
 * @param {Object|null} existing — message à éditer, null = création
 */
function showMessageModal(panel, existing = null) {
  const isEdit = !!existing;
  // Helper pour générer une expiration ISO (datetime UTC sans Z)
  const toISO = d => d.toISOString().slice(0, 19).replace('T', ' ');

  // Pré-calcul valeurs par défaut
  const v = existing || {};
  const tgt = v.target || 'all';
  const tgtIsLicence = typeof tgt === 'string' && tgt.startsWith('licence:');
  const tgtSelectVal = tgt === 'all' || tgt === 'tenant:default' ? tgt : 'custom-licence';
  const tgtLicenceVal = tgtIsLicence ? tgt.slice('licence:'.length) : '';

  const hasCta = !!(v.cta_label && v.cta_url);

  openModal(isEdit ? 'Modifier le message' : 'Nouveau message', `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Cible</label>
        <select id="msg-target" class="form-input">
          <option value="all"             ${tgtSelectVal==='all'?'selected':''}>Tous les utilisateurs (broadcast)</option>
          <option value="tenant:default"  ${tgtSelectVal==='tenant:default'?'selected':''}>Tenant : Protein Studio (default)</option>
          <option value="custom-licence"  ${tgtSelectVal==='custom-licence'?'selected':''}>Licence individuelle…</option>
        </select>
        <input type="text" id="msg-target-licence" class="form-input"
               placeholder="ex : XXXX-XXXX-XXXX-XXXX"
               value="${esc(tgtLicenceVal)}"
               style="display:${tgtSelectVal==='custom-licence'?'block':'none'};margin-top:8px">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Niveau</label>
          <select id="msg-level" class="form-input">
            <option value="info"   ${(v.level||'info')==='info'?'selected':''}>🔵 Info</option>
            <option value="promo"  ${v.level==='promo'?'selected':''}>🟢 Promo</option>
            <option value="urgent" ${v.level==='urgent'?'selected':''}>🔴 Urgent</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Durée d'affichage</label>
          <select id="msg-duration" class="form-input">
            <option value="permanent" ${!v.expires_at?'selected':''}>∞ Jusqu'à dismiss</option>
            <option value="1h">1 heure</option>
            <option value="24h">24 heures</option>
            <option value="7d">7 jours</option>
            ${isEdit && v.expires_at ? `<option value="keep" selected>Conserver l'expiration actuelle (${esc(v.expires_at)})</option>` : ''}
          </select>
        </div>
      </div>

      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Titre (optionnel)</label>
        <input type="text" id="msg-title" class="form-input"
               placeholder="Maintenance prévue"
               value="${esc(v.title || '')}"
               maxlength="60">
      </div>

      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Corps du message *</label>
        <textarea id="msg-body" class="form-input" rows="3" maxlength="500"
                  placeholder="Une courte phrase qui apparaîtra sous &quot;Bonjour, [prénom]&quot;…"
                  style="resize:vertical;font-family:inherit">${esc(v.body || '')}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          <span id="msg-body-count">${(v.body || '').length}</span> / 500 caractères
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:12px">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="msg-cta-toggle" style="margin:0" ${hasCta?'checked':''}>
          <span>Ajouter un bouton CTA cliquable</span>
        </label>
        <div id="msg-cta-fields" style="display:${hasCta?'grid':'none'};margin-top:12px;gap:12px;grid-template-columns:1fr 2fr">
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Libellé bouton</label>
            <input type="text" id="msg-cta-label" class="form-input" placeholder="Découvrir" maxlength="30" value="${esc(v.cta_label || '')}">
          </div>
          <div>
            <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">URL ou route</label>
            <input type="text" id="msg-cta-url" class="form-input" placeholder="https://… ou /app" value="${esc(v.cta_url || '')}">
          </div>
        </div>
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" id="btn-cancel-msg">Annuler</button>
    <button class="btn btn-primary"   id="btn-send-msg">${isEdit ? 'Enregistrer' : 'Envoyer'}</button>
  `);

  // Wire up dynamic fields
  const targetSel    = document.getElementById('msg-target');
  const licenceField = document.getElementById('msg-target-licence');
  targetSel.addEventListener('change', () => {
    licenceField.style.display = targetSel.value === 'custom-licence' ? 'block' : 'none';
  });

  const ctaToggle = document.getElementById('msg-cta-toggle');
  const ctaFields = document.getElementById('msg-cta-fields');
  ctaToggle.addEventListener('change', () => {
    ctaFields.style.display = ctaToggle.checked ? 'grid' : 'none';
  });

  const bodyEl  = document.getElementById('msg-body');
  const countEl = document.getElementById('msg-body-count');
  bodyEl.addEventListener('input', () => { countEl.textContent = bodyEl.value.length; });

  document.getElementById('btn-cancel-msg').addEventListener('click', closeModal);
  document.getElementById('btn-send-msg').addEventListener('click', async () => {
    const body = bodyEl.value.trim();
    if (!body) { toast('Le corps du message est requis', 'error'); return; }

    let target = targetSel.value;
    if (target === 'custom-licence') {
      const k = licenceField.value.trim();
      if (!k) { toast('Saisis la clé de licence', 'error'); return; }
      target = 'licence:' + k;
    }

    // Calcul de expiresAt
    const dur = document.getElementById('msg-duration').value;
    let expiresAt;
    if (dur === 'keep') {
      // En édition : conserver la valeur actuelle (ne pas envoyer le champ)
      expiresAt = undefined;
    } else if (dur === 'permanent') {
      expiresAt = null;
    } else {
      const ms = dur === '1h' ? 3600e3 : dur === '24h' ? 86400e3 : 7 * 86400e3;
      expiresAt = toISO(new Date(Date.now() + ms));
    }

    const ctaLabel = ctaToggle.checked ? document.getElementById('msg-cta-label').value.trim() : '';
    const ctaUrl   = ctaToggle.checked ? document.getElementById('msg-cta-url').value.trim()   : '';

    if (isEdit) {
      // PATCH — n'envoyer que les champs explicitement présents
      const payload = {
        id:    existing.id,
        target,
        title: document.getElementById('msg-title').value.trim() || null,
        body,
        level: document.getElementById('msg-level').value,
        // CTA : toujours synchronisé (vide = retire le CTA)
        ctaLabel: ctaToggle.checked && ctaLabel ? ctaLabel : null,
        ctaUrl:   ctaToggle.checked && ctaUrl   ? ctaUrl   : null,
      };
      if (expiresAt !== undefined) payload.expiresAt = expiresAt;

      try {
        await api('/api/admin/messages', 'PATCH', payload);
        closeModal();
        toast('Message modifié ✓');
        renderMessaging(panel);
      } catch (err) {
        toast(err.message, 'error');
      }
    } else {
      // POST création
      const payload = {
        tenantId: 'default',
        target,
        title:    document.getElementById('msg-title').value.trim() || null,
        body,
        level:    document.getElementById('msg-level').value,
        expiresAt: expiresAt === undefined ? null : expiresAt,
      };
      if (ctaToggle.checked && ctaLabel && ctaUrl) {
        payload.ctaLabel = ctaLabel;
        payload.ctaUrl   = ctaUrl;
      }

      try {
        await api('/api/admin/messages', 'POST', payload);
        closeModal();
        toast('Message envoyé ✓');
        renderMessaging(panel);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB — LIVING LAYER (Ordinateur de bord, 2026-05-28)
// Pilotables : phrases COURTES rotatives dans le hero du dashboard
// Différent de Messagerie (DST popups dismissables) : ici c'est une
// zone permanente sous "Bonjour, X" qui rotate entre 3 modes.
// ══════════════════════════════════════════════════════════════════
async function renderLivingLayer(panel) {
  try {
    const { messages = [], total = 0 } = await api('/api/admin/living-messages');
    const active    = messages.filter(m => m.effective_status === 'active').length;
    const scheduled = messages.filter(m => m.effective_status === 'scheduled').length;
    const expired   = messages.filter(m => m.effective_status === 'expired').length;
    const archived  = messages.filter(m => m.effective_status === 'archived').length;

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">✦ Living Layer — Pilotables <span>(${total})</span></h2>
        <button class="btn btn-primary" id="btn-new-living">+ Nouveau message</button>
      </div>
      <p style="color:var(--text-muted);font-size:13px;margin:0 0 16px;max-width:720px">
        Annonces poussées dans la zone Living Layer du dashboard.
        Affichées en mode 📢 avec priorité décroissante. Priorité ≥ 80 = URGENT (prend la main sur le cycle IA/Calculateur).
      </p>
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="stat-label">Actifs</div><div class="stat-value" style="color:#4caf80">${active}</div></div>
        <div class="stat-card"><div class="stat-label">Programmés</div><div class="stat-value" style="color:#5cb0e0">${scheduled}</div></div>
        <div class="stat-card"><div class="stat-label">Expirés</div><div class="stat-value" style="color:var(--text-muted)">${expired}</div></div>
        <div class="stat-card"><div class="stat-label">Archivés</div><div class="stat-value" style="color:#888">${archived}</div></div>
      </div>
      ${total === 0
        ? '<div class="empty-state"><div class="icon">✦</div><p>Aucun message Pilotable</p><p style="font-size:12px;color:var(--text-muted)">Crée-en un pour qu\'il apparaisse en mode 📢 sur le dashboard.</p></div>'
        : `<table class="data-table">
            <thead><tr>
              <th>Statut</th><th>Priorité</th><th>Message</th>
              <th>Audience</th><th>Période</th><th style="min-width:240px">Actions</th>
            </tr></thead>
            <tbody>${messages.map(_renderLivingRow).join('')}</tbody>
          </table>`}
    `;

    const byId = Object.fromEntries(messages.map(m => [m.id, m]));

    panel.querySelector('#btn-new-living')?.addEventListener('click', () => showLivingMessageModal(panel));

    panel.querySelectorAll('[data-action="edit-living"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = byId[btn.dataset.id];
        if (msg) showLivingMessageModal(panel, msg);
      });
    });

    panel.querySelectorAll('[data-action="archive-living"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archiver ce message ?\n\nIl ne sera plus visible mais reste consultable dans la liste.')) return;
        btn.disabled = true;
        try {
          await api('/api/admin/living-messages/archive', 'POST', { id: btn.dataset.id });
          toast('Message archivé ✓');
          renderLivingLayer(panel);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    });

    panel.querySelectorAll('[data-action="delete-living"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement ce message ?\n\nCette action est irréversible.')) return;
        btn.disabled = true;
        try {
          await api('/api/admin/living-messages', 'DELETE', { id: btn.dataset.id });
          toast('Message supprimé', 'error');
          renderLivingLayer(panel);
        } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="loading" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function _renderLivingRow(m) {
  const statusColor = m.effective_status === 'active'    ? '#4caf80'
                    : m.effective_status === 'scheduled' ? '#5cb0e0'
                    : m.effective_status === 'expired'   ? 'var(--text-muted)' : '#888';
  const statusLabel = m.effective_status === 'active'    ? 'Actif'
                    : m.effective_status === 'scheduled' ? 'Programmé'
                    : m.effective_status === 'expired'   ? 'Expiré' : 'Archivé';
  const prioLabel = m.priority >= 80 ? `🔴 ${m.priority} URGENT` : `🟢 ${m.priority}`;
  const text = m.text.length > 60 ? esc(m.text.slice(0, 58)) + '…' : esc(m.text);
  const aud  = m.audience === 'all' ? 'Tous' : esc(m.audience).toUpperCase();

  const fmt = (iso) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) { return esc(iso); }
  };
  const period = `${fmt(m.start_at)} → ${fmt(m.end_at)}`;

  const editBtn = `<button class="btn btn-sm" data-action="edit-living" data-id="${esc(m.id)}" title="Modifier">✏ Modifier</button>`;
  const archBtn = m.status !== 'archived'
    ? `<button class="btn btn-sm" data-action="archive-living" data-id="${esc(m.id)}" title="Archiver" style="color:#e0a25c">📦 Archiver</button>`
    : '';
  const delBtn  = `<button class="btn btn-sm" data-action="delete-living" data-id="${esc(m.id)}" title="Supprimer définitivement" style="color:#e05c5c;border-color:rgba(224,92,92,.35)">🗑 Supprimer</button>`;

  return `
    <tr>
      <td><span style="color:${statusColor};font-weight:600">${statusLabel}</span></td>
      <td>${prioLabel}</td>
      <td title="${esc(m.text)}" style="max-width:280px">${text}</td>
      <td><span style="font-size:11px;padding:2px 8px;background:rgba(255,255,255,.05);border-radius:10px">${aud}</span></td>
      <td style="font-size:11px;color:var(--text-muted)">${period}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}${archBtn}${delBtn}</div></td>
    </tr>
  `;
}

// Conversion ISO → datetime-local (input HTML5)
function _toDatetimeLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (e) { return ''; }
}

function showLivingMessageModal(panel, existing = null) {
  const isEdit = !!existing;
  const v = existing || {};
  // Défauts : start = maintenant, end = +7 jours
  const now    = new Date();
  const plus7d = new Date(Date.now() + 7 * 86400000);

  const startVal = _toDatetimeLocal(v.start_at || now.toISOString());
  const endVal   = _toDatetimeLocal(v.end_at   || plus7d.toISOString());

  openModal(isEdit ? 'Modifier le message Pilotable' : 'Nouveau message Pilotable', `
    <div class="form-grid" style="display:grid;gap:14px">
      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Texte (max 120 caractères)</label>
        <textarea id="liv-text" class="form-input" maxlength="120" rows="3"
                  placeholder="Ex : Brainstorming V2 est sorti — découvre le multi-agent IA"
                  style="resize:vertical;font-family:inherit">${esc(v.text || '')}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          <span id="liv-text-count">${(v.text || '').length}</span> / 120 caractères
        </div>
      </div>

      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Début</label>
          <input type="datetime-local" id="liv-start" class="form-input" value="${esc(startVal)}">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Fin</label>
          <input type="datetime-local" id="liv-end" class="form-input" value="${esc(endVal)}">
        </div>
      </div>

      <div>
        <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">
          Priorité : <span id="liv-prio-value">${v.priority ?? 50}</span> / 100
          <span id="liv-prio-tag" style="margin-left:8px;font-weight:600">${(v.priority ?? 50) >= 80 ? '🔴 URGENT' : '🟢 Normal'}</span>
        </label>
        <input type="range" id="liv-prio" min="0" max="100" step="5" value="${v.priority ?? 50}" style="width:100%">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">≥ 80 = URGENT : prend la main sur les modes IA et Calculateur.</div>
      </div>

      <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr">
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Audience</label>
          <select id="liv-audience" class="form-input">
            <option value="all"     ${v.audience === 'all'     || !v.audience ? 'selected' : ''}>Tous les plans</option>
            <option value="demo"    ${v.audience === 'demo'    ? 'selected' : ''}>DEMO uniquement</option>
            <option value="starter" ${v.audience === 'starter' ? 'selected' : ''}>STARTER uniquement</option>
            <option value="pro"     ${v.audience === 'pro'     ? 'selected' : ''}>PRO uniquement</option>
            <option value="max"     ${v.audience === 'max'     ? 'selected' : ''}>MAX uniquement</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:11px;color:var(--text-muted);margin-bottom:6px">Statut</label>
          <select id="liv-status" class="form-input">
            <option value="active"   ${v.status === 'active'   || !v.status ? 'selected' : ''}>Actif (visible)</option>
            <option value="draft"    ${v.status === 'draft'    ? 'selected' : ''}>Brouillon</option>
            <option value="archived" ${v.status === 'archived' ? 'selected' : ''}>Archivé</option>
          </select>
        </div>
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" id="btn-cancel-liv">Annuler</button>
    <button class="btn btn-primary"   id="btn-send-liv">${isEdit ? 'Enregistrer' : 'Publier'}</button>
  `);

  // Compteur live + slider de priorité
  const textEl  = document.getElementById('liv-text');
  const countEl = document.getElementById('liv-text-count');
  textEl.addEventListener('input', () => { countEl.textContent = textEl.value.length; });

  const prioEl    = document.getElementById('liv-prio');
  const prioVal   = document.getElementById('liv-prio-value');
  const prioTag   = document.getElementById('liv-prio-tag');
  prioEl.addEventListener('input', () => {
    prioVal.textContent = prioEl.value;
    const isUrgent = +prioEl.value >= 80;
    prioTag.textContent = isUrgent ? '🔴 URGENT' : '🟢 Normal';
  });

  document.getElementById('btn-cancel-liv').addEventListener('click', closeModal);
  document.getElementById('btn-send-liv').addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) { toast('Le texte est requis', 'error'); return; }
    if (text.length > 120) { toast('Texte trop long (max 120)', 'error'); return; }

    const startIso = new Date(document.getElementById('liv-start').value).toISOString();
    const endIso   = new Date(document.getElementById('liv-end').value).toISOString();
    if (!startIso || !endIso) { toast('Dates invalides', 'error'); return; }
    if (endIso <= startIso)   { toast('La fin doit être après le début', 'error'); return; }

    const payload = {
      text,
      priority: +prioEl.value,
      start_at: startIso,
      end_at:   endIso,
      audience: document.getElementById('liv-audience').value,
      status:   document.getElementById('liv-status').value,
    };

    try {
      if (isEdit) {
        payload.id = existing.id;
        await api('/api/admin/living-messages', 'PATCH', payload);
        toast('Message modifié ✓');
      } else {
        await api('/api/admin/living-messages', 'POST', payload);
        toast('Message publié ✓');
      }
      closeModal();
      renderLivingLayer(panel);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// TAB — CLAUSES (catalogue partagé du DocEngine)
// ══════════════════════════════════════════════════════════════════
// Stockées en tenant='shared' → lisibles par tous les utilisateurs sans
// avoir à seeder. Écriture/édition réservée admin.
//
// API utilisée :
//   GET    /api/data/clauses?tenant=shared        liste shared
//   GET    /api/data/clauses                      union (current + shared)
//   POST   /api/data/clauses   body={tenant:'shared', ...}
//   PATCH  /api/data/clauses/:id  body={tenant:'shared', ...}
//   DELETE /api/data/clauses/:id?tenant=shared

let _clausesView = 'shared';   // 'shared' | 'all'

// Wrapper pour la sous-nav Fabrique → appelle simplement renderClauses
// (l'existant). Permet d'évoluer le sous-onglet plus tard sans toucher
// au renderer historique.
async function renderFabriqueClauses(panel) {
  return renderClauses(panel);
}

async function renderClauses(panel) {
  try {
    const url = _clausesView === 'shared'
      ? '/api/data/clauses?tenant=shared&limit=500'
      : '/api/data/clauses?limit=500';
    const { items = [] } = await api(url);

    // Groupage simple par préfixe template (ex: vefa_, brochure_…)
    // Pour l'instant on a juste VEFA, mais on prépare l'extension.
    const sectorLabels = { IMM: 'Immobilier', COM: 'Communication', ANL: 'Analyse', ADM: 'Admin' };

    panel.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Bibliothèque de clauses <span>(${items.length})</span></h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="btn-clauses-view-shared" ${_clausesView === 'shared' ? 'disabled' : ''}>Catalogue partagé</button>
          <button class="btn" id="btn-clauses-view-all"    ${_clausesView === 'all'    ? 'disabled' : ''}>Vue globale (+ locales)</button>
          <button class="btn" id="btn-clauses-reseed">↻ Re-seed VEFA v1</button>
          <button class="btn" id="btn-clauses-reseed-v2" title="Pousse les 10 clauses techniques en version agnostique (corrige les contradictions PAC/électrique, biosourcé/PSE, etc.)">↻ Re-seed VEFA v2 (correctif)</button>
          <button class="btn" id="btn-clauses-reseed-contrat" title="Charge les 17 clauses juridiques du Contrat de Réservation VEFA (Art. L.261-15 CCH). Préfixées CONTRAT_ pour ne pas collisionner avec la notice.">↻ Seed Contrat VEFA v1</button>
          <button class="btn btn-primary" id="btn-clauses-new">+ Nouvelle clause</button>
        </div>
      </div>

      <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
        ${_clausesView === 'shared'
          ? 'Les clauses du <strong>catalogue partagé</strong> sont automatiquement disponibles pour tous les utilisateurs (Prométhée et futurs clients) sans qu\'ils aient à seeder quoi que ce soit.'
          : 'Vue globale : clauses du catalogue partagé <em>+</em> overrides locaux du tenant courant. Une clause locale (même <code>id</code>) masque celle du catalogue.'}
      </p>

      ${items.length === 0
        ? `<div class="empty-state">Aucune clause. Clique sur <strong>↻ Re-seed VEFA v1</strong> pour charger les 30 clauses standards immobilier neuf.</div>`
        : `<table class="data-table">
            <thead>
              <tr>
                <th>Clé</th>
                <th>Label</th>
                <th>Secteur</th>
                <th>Version</th>
                <th>Tenant</th>
                <th>Taille</th>
                <th>Maj</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(c => {
                const isShared = c._tenant === 'shared';
                const tenantBadge = isShared
                  ? '<span class="badge" style="background:rgba(184,148,90,.15);color:#D4AF7A;border:1px solid rgba(184,148,90,.3)">Partagé</span>'
                  : '<span class="badge" style="background:rgba(99,102,241,.15);color:#a5b4fc;border:1px solid rgba(99,102,241,.3)">Local</span>';
                return `
                  <tr>
                    <td><code style="font-size:12px;color:#a5b4fc">${_esc(c.key || '—')}</code></td>
                    <td>${_esc(c.label || '—')}</td>
                    <td>${_esc(sectorLabels[c.secteur] || c.secteur || '—')}</td>
                    <td>v${c.version ?? 1}</td>
                    <td>${tenantBadge}</td>
                    <td style="color:var(--text-muted);font-size:12px">${((c.content || '').length / 1024).toFixed(1)} Ko</td>
                    <td style="color:var(--text-muted);font-size:11px">${(c._updatedAt || '').slice(0, 10)}</td>
                    <td style="text-align:right">
                      <button class="btn-icon" data-act="edit"  data-id="${_esc(c.id)}" title="Éditer">✎</button>
                      <button class="btn-icon" data-act="bump"  data-id="${_esc(c.id)}" title="Dupliquer en v+1">⎘</button>
                      <button class="btn-icon" data-act="delete" data-id="${_esc(c.id)}" title="Supprimer">✕</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>`}
    `;

    // ── Bindings ──────────────────────────────────────────────
    panel.querySelector('#btn-clauses-view-shared')?.addEventListener('click', () => {
      _clausesView = 'shared'; renderClauses(panel);
    });
    panel.querySelector('#btn-clauses-view-all')?.addEventListener('click', () => {
      _clausesView = 'all'; renderClauses(panel);
    });
    panel.querySelector('#btn-clauses-new')?.addEventListener('click', () => _openClauseEditor(panel));
    panel.querySelector('#btn-clauses-reseed')?.addEventListener('click', () => _reseedVefaClauses(panel, VEFA_CLAUSES_V1, 'v1'));
    panel.querySelector('#btn-clauses-reseed-v2')?.addEventListener('click', () => _reseedVefaClauses(panel, VEFA_CLAUSES_V2, 'v2'));
    panel.querySelector('#btn-clauses-reseed-contrat')?.addEventListener('click', () => _reseedVefaClauses(panel, VEFA_CONTRAT_CLAUSES_V1, 'Contrat v1'));

    panel.querySelectorAll('[data-act]').forEach(btn => {
      const act = btn.dataset.act;
      const id  = btn.dataset.id;
      const clause = items.find(c => c.id === id);
      if (!clause) return;
      if (act === 'edit')   btn.addEventListener('click', () => _openClauseEditor(panel, clause));
      if (act === 'bump')   btn.addEventListener('click', () => _openClauseEditor(panel, {
        ...clause,
        id: (clause.id || '').replace(/_v\d+$/, '') + `_v${(clause.version || 1) + 1}`,
        version: (clause.version || 1) + 1,
      }));
      if (act === 'delete') btn.addEventListener('click', () => _deleteClause(panel, clause));
    });

  } catch (e) {
    panel.innerHTML = `<div class="error-state">Erreur : ${_esc(e.message)}</div>`;
  }
}

function _openClauseEditor(panel, clause = null) {
  const isNew = !clause;
  const data = clause || { id: '', secteur: 'IMM', key: '', label: '', version: 1, content: '' };

  openModal(
    isNew ? 'Nouvelle clause' : 'Éditer la clause',
    `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <label class="form-label">ID stable
          <input type="text" id="cl-id" class="form-input" value="${_esc(data.id)}" placeholder="clause_vefa_GFA_v1" ${clause && !isNew ? 'readonly' : ''}>
        </label>
        <label class="form-label">Secteur
          <select id="cl-secteur" class="form-input">
            ${['IMM','COM','ANL','ADM'].map(s => `<option value="${s}" ${s === data.secteur ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <label class="form-label">Clé (matche [[CLAUSE_<i>KEY</i>]])
          <input type="text" id="cl-key" class="form-input" value="${_esc(data.key)}" placeholder="GFA, FONDATIONS, …">
        </label>
        <label class="form-label">Version
          <input type="number" id="cl-version" class="form-input" value="${data.version || 1}" min="1">
        </label>
        <label class="form-label" style="grid-column:span 2">Libellé humain
          <input type="text" id="cl-label" class="form-input" value="${_esc(data.label)}" placeholder="Garantie Financière d'Achèvement">
        </label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <label class="form-label">Contenu HTML (inséré tel quel dans le template)</label>
          <textarea id="cl-content" class="form-input" style="height:340px;font-family:ui-monospace,monospace;font-size:12px">${_esc(data.content)}</textarea>
        </div>
        <div>
          <label class="form-label">Aperçu live</label>
          <iframe id="cl-preview" style="width:100%;height:340px;background:#fff;border:1px solid var(--border);border-radius:6px"></iframe>
        </div>
      </div>
    `,
    `
      <button class="btn" id="cl-cancel">Annuler</button>
      <button class="btn btn-primary" id="cl-save">${isNew ? 'Créer' : 'Enregistrer'}</button>
    `
  );

  // Preview live
  const textarea = document.getElementById('cl-content');
  const iframe   = document.getElementById('cl-preview');
  const refreshPreview = () => {
    const html = `<html><head><style>body{font:14px/1.5 -apple-system,sans-serif;padding:14px;color:#1a1e2e}</style></head><body>${textarea.value}</body></html>`;
    iframe.srcdoc = html;
  };
  textarea.addEventListener('input', refreshPreview);
  refreshPreview();

  document.getElementById('cl-cancel').addEventListener('click', closeModal);
  document.getElementById('cl-save').addEventListener('click', async () => {
    const payload = {
      tenant: 'shared',
      id     : document.getElementById('cl-id').value.trim(),
      secteur: document.getElementById('cl-secteur').value,
      key    : document.getElementById('cl-key').value.trim(),
      label  : document.getElementById('cl-label').value.trim(),
      version: parseInt(document.getElementById('cl-version').value, 10) || 1,
      content: textarea.value,
    };
    if (!payload.id || !payload.key) { toast('id et key requis', 'error'); return; }
    try {
      await api('/api/data/clauses', 'POST', payload);
      toast(isNew ? 'Clause créée' : 'Clause mise à jour');
      closeModal();
      renderClauses(panel);
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  });
}

async function _deleteClause(panel, clause) {
  if (!confirm(`Supprimer la clause "${clause.label || clause.key}" ?\n\n(Soft delete ; les notices déjà générées ne sont pas affectées.)`)) return;
  try {
    const queryTenant = clause._tenant === 'shared' ? '?tenant=shared' : '';
    await api(`/api/data/clauses/${encodeURIComponent(clause.id)}${queryTenant}`, 'DELETE');
    toast('Clause supprimée');
    renderClauses(panel);
  } catch (e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

// Re-seed parametrable : accepte un set de clauses + un label (v1, v2…)
// Par défaut compatible avec l'appel historique (v1 sans param).
async function _reseedVefaClauses(panel, clausesSet = VEFA_CLAUSES_V1, versionLabel = 'v1') {
  if (!confirm(`Re-seeder ${clausesSet.length} clauses VEFA ${versionLabel} dans le catalogue PARTAGÉ ?\n\nLes clauses existantes au même id seront écrasées par celles du fichier source. Pour les keys existantes, fillClauses() prend automatiquement la version max (donc v2 prime sur v1).`)) return;
  let ok = 0, ko = 0;
  for (const clause of clausesSet) {
    try {
      await api('/api/data/clauses', 'POST', { tenant: 'shared', ...clause });
      ok++;
    } catch (e) {
      console.warn('[reseed] échec sur', clause.id, e);
      ko++;
    }
  }
  toast(`Re-seed ${versionLabel} terminé : ${ok} OK${ko ? `, ${ko} KO` : ''}`, ko ? 'error' : 'success');
  renderClauses(panel);
}

// Helper local d'échappement HTML (utilisé seulement dans ce tab —
// il y en a peut-être déjà un global plus haut mais je m'évite la
// dépendance pour rester portable si on extrait ce module).
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════
// Auto-login si le token est mémorisé (localStorage persiste entre sessions)
if (adminToken) {
  api('/api/licence/list').then(() => showAdmin()).catch(() => logout());
}
