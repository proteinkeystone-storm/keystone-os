/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Social Manager (O-SOC-001) v1.0 — Workspace fullscreen
   Sprint Social-2 / Pad « Social Manager »
   ─────────────────────────────────────────────────────────────
   Façade UI du moteur de diffusion sociale. V1 minimale :
   - Gauche (saisie)   : message + réseaux connectés + photo (option) + Publier
   - Droite (résultat) : aperçu live du post + résultat de publication
   Auth : localStorage['ks_admin_token'] → Authorization: Bearer.
   Routes Worker : GET /api/social/accounts · POST /api/social/publish
                   · POST /api/social/media (upload image → URL R2).
   Pattern .ws-app / .ws-topbar / .ws-body (cf. annonces-immo.js).
   ═══════════════════════════════════════════════════════════════ */

import { helpButtonHTML, bindHelpButton }    from './lib/help-overlay.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { burgerHTML, bindBurger }            from './lib/topbar-burger.js';
import { icon }                              from './lib/ui-icons.js';
import { CF_API }                            from './pads-loader.js';

const APP_ID    = 'O-SOC-001';
const DRAFT_KEY = 'ks_social_manager_draft_v1';

// Réseaux connus + libellé/emoji pour l'aperçu (pilotés in fine par le
// registre côté Worker ; ici juste l'habillage UI).
const NET_LABEL = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };
const NET_GLYPH = { facebook: 'f', instagram: '◎', linkedin: 'in' };

// ── État module ────────────────────────────────────────────────
let _root     = null;
let _styles   = false;
let _busy     = false;
let _accounts = null;          // null = pas chargé, [] = chargé/vide
let _form     = { text: '', targets: [], imageUrl: null, imageName: null };

const _adminToken = () => { try { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; } catch (_) { return ''; } };
const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ══════════════════════════════════════════════════════════════
// API publique
// ══════════════════════════════════════════════════════════════

export function openSocialManager() {
  if (_root) return;
  _injectStyles();
  _loadDraft();
  _buildShell();
  _renderMain();
  document.body.style.overflow = 'hidden';
  _loadAccounts();
}

export function closeSocialManager() {
  if (!_root) return;
  _saveDraft();
  document.removeEventListener('keydown', _onKey);
  _root.remove();
  _root = null;
  document.body.style.overflow = '';
}

// ══════════════════════════════════════════════════════════════
// Brouillon (localStorage)
// ══════════════════════════════════════════════════════════════
function _saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: _form.text, targets: _form.targets })); } catch (_) {}
}
function _loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) { const d = JSON.parse(raw); _form.text = d.text || ''; _form.targets = Array.isArray(d.targets) ? d.targets : []; }
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
// Shell (topbar + body)
// ══════════════════════════════════════════════════════════════
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour au Dashboard">
          ${icon('chevron-left', 34)}
        </button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('multiportails', 24)}</span>
        <span class="name">Social Manager</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(APP_ID)}
        ${ratingButtonHTML(APP_ID)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click',  _onClick);
  _root.addEventListener('input',  _onInput);
  _root.addEventListener('change', _onChange);
  document.addEventListener('keydown', _onKey);
  bindRatingButton(_root, APP_ID);
  bindHelpButton(_root, APP_ID);
  bindBurger(_root);
}

function _onKey(e) { if (e.key === 'Escape') closeSocialManager(); }

// ══════════════════════════════════════════════════════════════
// Rendu principal (split 60/40)
// ══════════════════════════════════════════════════════════════
function _renderMain() {
  const main = _root && _root.querySelector('[data-slot="main"]');
  if (!main) return;
  const noAdmin = !_adminToken();

  main.innerHTML = `
    <div class="sm-wrap">
      <div class="sm-hero">
        <div class="sm-eyebrow">${icon('multiportails', 13)}&nbsp;O-SOC-001 — Diffusion réseaux sociaux</div>
        <h1 class="sm-title">Social Manager</h1>
        <p class="sm-subtitle">Composez une publication et diffusez-la sur vos réseaux connectés, en un clic.</p>
      </div>

      ${noAdmin ? `<div class="sm-banner sm-banner-warn">${icon('lock', 15)}&nbsp;Connecte-toi en <strong>admin</strong> pour charger tes comptes et publier.</div>` : ''}

      <div class="sm-split">
        <!-- ── Saisie (gauche, 60%) ───────────────────────── -->
        <section class="sm-left">
          <div class="sm-field">
            <label class="sm-label">Message</label>
            <textarea class="sm-textarea" data-field="text" rows="7"
              placeholder="Rédigez votre publication…">${_esc(_form.text)}</textarea>
          </div>

          <div class="sm-field">
            <label class="sm-label">Réseaux cibles</label>
            <div class="sm-nets" data-slot="nets">
              <div class="sm-nets-loading">Chargement des comptes connectés…</div>
            </div>
          </div>

          <div class="sm-field">
            <label class="sm-label">Photo <span class="sm-opt">(optionnel)</span></label>
            <div class="sm-media" data-slot="media">
              <label class="sm-upload">
                <input type="file" accept="image/*" data-field="image" hidden>
                ${icon('image', 16)}&nbsp;<span data-slot="media-label">Choisir une image…</span>
              </label>
            </div>
          </div>

          <div class="sm-actions">
            <button class="sm-btn-primary" data-act="publish" ${noAdmin ? 'disabled' : ''}>
              ${icon('zap', 18)}&nbsp;Publier
            </button>
          </div>
        </section>

        <!-- ── Aperçu / résultat (droite, 40%) ─────────────── -->
        <aside class="sm-right">
          <div class="sm-right-lbl">Aperçu</div>
          <div class="sm-preview" data-slot="preview"></div>
          <div class="sm-result" data-slot="result"></div>
        </aside>
      </div>
    </div>
  `;
  _renderNets();
  _renderPreview();
}

// ── Liste des réseaux (cases) depuis _accounts ─────────────────
function _renderNets() {
  const box = _root && _root.querySelector('[data-slot="nets"]');
  if (!box) return;

  if (_accounts === null) { box.innerHTML = `<div class="sm-nets-loading">Chargement des comptes connectés…</div>`; return; }
  if (_accounts.length === 0) {
    box.innerHTML = `<div class="sm-nets-empty">Aucun compte connecté. Provisionne un réseau côté Worker pour le voir ici.</div>`;
    return;
  }
  box.innerHTML = _accounts.map(a => {
    const p = a.platform;
    const checked = _form.targets.includes(p) ? 'checked' : '';
    return `
      <label class="sm-net ${checked ? 'is-on' : ''}">
        <input type="checkbox" data-net="${_esc(p)}" ${checked} hidden>
        <span class="sm-net-glyph">${_esc(NET_GLYPH[p] || '●')}</span>
        <span class="sm-net-name">${_esc(NET_LABEL[p] || p)}</span>
        <span class="sm-net-handle">${_esc(a.display_name || '')}</span>
      </label>`;
  }).join('');
}

// ── Aperçu live du post ────────────────────────────────────────
function _renderPreview() {
  const box = _root && _root.querySelector('[data-slot="preview"]');
  if (!box) return;
  const txt = _form.text.trim();
  const nets = _form.targets.map(p => NET_LABEL[p] || p);

  box.innerHTML = `
    <div class="sm-card">
      <div class="sm-card-head">
        <div class="sm-card-avatar">P</div>
        <div class="sm-card-meta">
          <div class="sm-card-name">Protein Keystone Studio</div>
          <div class="sm-card-net">${nets.length ? _esc(nets.join(' · ')) : '<span class="sm-muted">aucun réseau sélectionné</span>'}</div>
        </div>
      </div>
      <div class="sm-card-text">${txt ? _esc(txt).replace(/\n/g, '<br>') : '<span class="sm-muted">Votre message apparaîtra ici…</span>'}</div>
      ${_form.imageUrl ? `<div class="sm-card-img"><img src="${_esc(_form.imageUrl)}" alt=""></div>` : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
// Données : comptes connectés
// ══════════════════════════════════════════════════════════════
async function _loadAccounts() {
  const token = _adminToken();
  if (!token) { _accounts = []; _renderNets(); return; }
  try {
    const res = await fetch(`${CF_API}/api/social/accounts`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) { _accounts = []; _renderNets(); _toast('Session admin expirée', 'warn'); return; }
    const data = await res.json().catch(() => ({}));
    _accounts = Array.isArray(data.accounts) ? data.accounts.filter(a => a.status === 'connected') : [];
    // Pré-sélection : tout ce qui est connecté (sauf si un brouillon de cibles existe)
    if (!_form.targets.length) _form.targets = _accounts.map(a => a.platform);
    _renderNets();
    _renderPreview();
  } catch (e) {
    _accounts = [];
    _renderNets();
    _toast('Comptes non chargés : ' + (e?.message || 'erreur'), 'warn');
  }
}

// ══════════════════════════════════════════════════════════════
// Upload image → R2
// ══════════════════════════════════════════════════════════════
async function _uploadImage(file) {
  const token = _adminToken();
  if (!token) { _toast('Connexion admin requise', 'warn'); return; }
  if (!file.type.startsWith('image/')) { _toast('Fichier non image', 'warn'); return; }

  _setMediaLabel(`Envoi de « ${file.name} »…`);
  try {
    const res = await fetch(`${CF_API}/api/social/media`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': file.type },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || `Erreur ${res.status}`);
    _form.imageUrl = data.url;
    _form.imageName = file.name;
    _setMediaLabel(`✓ ${file.name}`);
    _renderPreview();
  } catch (e) {
    _setMediaLabel('Choisir une image…');
    _toast('Upload échoué : ' + (e?.message || 'erreur'), 'warn');
  }
}
function _setMediaLabel(t) {
  const el = _root && _root.querySelector('[data-slot="media-label"]');
  if (el) el.textContent = t;
}

// ══════════════════════════════════════════════════════════════
// Publication
// ══════════════════════════════════════════════════════════════
async function _publish() {
  if (_busy) return;
  const token = _adminToken();
  if (!token) { _toast('Connexion admin requise pour publier', 'warn'); return; }

  const text = _form.text.trim();
  if (!text && !_form.imageUrl) { _toast('Écris un message ou ajoute une photo', 'warn'); return; }
  if (!_form.targets.length)    { _toast('Sélectionne au moins un réseau', 'warn'); return; }

  _busy = true;
  _setResult(`<div class="sm-result-pending">${icon('zap', 16)}&nbsp;Publication en cours…</div>`);
  const btn = _root.querySelector('[data-act="publish"]'); if (btn) btn.disabled = true;

  const body = {
    targets: _form.targets,
    text,
    source: 'social-manager',
    ...(_form.imageUrl ? { media: [{ type: 'image', url: _form.imageUrl }] } : {}),
  };

  try {
    const res = await fetch(`${CF_API}/api/social/publish`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { _setResult(`<div class="sm-result-ko">Session admin expirée — reconnecte-toi.</div>`); return; }
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

    const rows = (data.results || []).map(r => {
      const ok = r.status === 'published';
      const label = NET_LABEL[r.platform] || r.platform;
      return `<li class="${ok ? 'ok' : 'ko'}">
        <span class="sm-res-net">${_esc(label)}</span>
        ${ok
          ? `<a href="${_esc(r.url)}" target="_blank" rel="noopener">voir le post ↗</a>`
          : `<span class="sm-res-err">${_esc(r.error || 'échec')}</span>`}
      </li>`;
    }).join('');

    const ok = data.status === 'published';
    _setResult(`
      <div class="sm-result-head ${ok ? 'ok' : (data.status === 'partial' ? 'warn' : 'ko')}">
        ${ok ? '✓ Publié' : data.status === 'partial' ? '◐ Partiel' : '✕ Échec'}
      </div>
      <ul class="sm-result-list">${rows}</ul>
    `);
    if (ok || data.status === 'partial') _toast('Publication envoyée 🚀', 'ok');
  } catch (e) {
    _setResult(`<div class="sm-result-ko">${_esc(e?.message || 'Erreur de publication')}</div>`);
  } finally {
    _busy = false;
    const b = _root && _root.querySelector('[data-act="publish"]'); if (b) b.disabled = false;
  }
}
function _setResult(html) {
  const el = _root && _root.querySelector('[data-slot="result"]');
  if (el) el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// Événements
// ══════════════════════════════════════════════════════════════
function _onClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close')   { e.preventDefault(); closeSocialManager(); return; }
  if (act === 'publish') { e.preventDefault(); _publish(); return; }

  // Toggle réseau
  const net = e.target.closest('[data-net]');
  if (net) {
    const p = net.dataset.net;
    const i = _form.targets.indexOf(p);
    if (i >= 0) _form.targets.splice(i, 1); else _form.targets.push(p);
    net.closest('.sm-net')?.classList.toggle('is-on');
    _renderPreview();
  }
}

function _onInput(e) {
  if (e.target.dataset.field === 'text') { _form.text = e.target.value; _renderPreview(); _scheduleSave(); }
}

function _onChange(e) {
  if (e.target.dataset.field === 'image' && e.target.files?.[0]) _uploadImage(e.target.files[0]);
}

let _saveT = null;
function _scheduleSave() { clearTimeout(_saveT); _saveT = setTimeout(_saveDraft, 600); }

// ══════════════════════════════════════════════════════════════
// Toast
// ══════════════════════════════════════════════════════════════
let _toastT = null;
function _toast(msg, kind = 'ok') {
  if (!_root) return;
  let t = _root.querySelector('.sm-toast');
  if (!t) { t = document.createElement('div'); t.className = 'sm-toast'; _root.appendChild(t); }
  t.className = `sm-toast sm-toast-${kind} show`;
  t.textContent = msg;
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.classList.remove('show'); }, 3200);
}

// ══════════════════════════════════════════════════════════════
// Styles (namespace .sm-*) — réutilise les variables globales
// ══════════════════════════════════════════════════════════════
function _injectStyles() {
  if (_styles) return; _styles = true;
  const css = `
  .sm-wrap { max-width: 1180px; margin: 0 auto; padding: 28px 28px 60px; }
  .sm-hero { margin-bottom: 22px; }
  .sm-eyebrow { display:inline-flex; align-items:center; font-size:12px; font-weight:700; letter-spacing:.02em; color: var(--gold2); background: var(--gold3); padding:6px 11px; border-radius: var(--r); }
  .sm-title { font-size: 30px; font-weight: 900; letter-spacing: -.02em; margin: 12px 0 6px; color: var(--text); }
  .sm-subtitle { color: var(--tx2); font-size: 14px; max-width: 640px; }
  .sm-banner { display:flex; align-items:center; gap:6px; padding:11px 14px; border-radius: var(--r); font-size:13px; margin-bottom:18px; border:1px solid var(--bd); }
  .sm-banner-warn { background: rgba(251,191,36,.10); color:#fcd34d; border-color: rgba(251,191,36,.25); }

  .sm-split { display:flex; gap:0; align-items:stretch; background: var(--navy2); border:1px solid var(--bd); border-radius: var(--r2); overflow:hidden; }
  .sm-left  { width:60%; padding:24px; border-right:1px solid var(--bd); }
  .sm-right { flex:1; padding:24px; background: var(--navy); display:flex; flex-direction:column; gap:14px; }

  .sm-field { margin-bottom:18px; }
  .sm-label { display:block; font-size:12px; font-weight:700; letter-spacing:.01em; color: var(--tx2); margin-bottom:8px; text-transform:uppercase; }
  .sm-opt   { font-weight:500; text-transform:none; color: var(--tx3); }
  .sm-textarea { width:100%; resize:vertical; min-height:140px; background: var(--navy3); color: var(--text); border:1px solid var(--bd); border-radius: var(--r); padding:12px 14px; font:inherit; font-size:14px; line-height:1.5; }
  .sm-textarea:focus { outline:none; border-color: var(--gold); box-shadow:0 0 0 3px var(--gold3); }

  .sm-nets { display:flex; flex-wrap:wrap; gap:10px; }
  .sm-nets-loading, .sm-nets-empty { color: var(--tx3); font-size:13px; padding:8px 0; }
  .sm-net { display:inline-flex; align-items:center; gap:9px; padding:9px 13px; border:1px solid var(--bd); border-radius: var(--r); cursor:pointer; background: var(--navy3); transition: all .15s; user-select:none; }
  .sm-net:hover { border-color: var(--gold2); }
  .sm-net.is-on { border-color: var(--gold); background: var(--gold3); }
  .sm-net-glyph { width:24px; height:24px; display:grid; place-items:center; border-radius:7px; background: var(--navy); color: var(--gold2); font-weight:800; font-size:12px; }
  .sm-net.is-on .sm-net-glyph { background: var(--gold); color:#fff; }
  .sm-net-name { font-size:13px; font-weight:700; color: var(--text); }
  .sm-net-handle { font-size:11px; color: var(--tx3); }

  .sm-upload { display:inline-flex; align-items:center; gap:6px; padding:9px 14px; border:1px dashed var(--bd); border-radius: var(--r); cursor:pointer; color: var(--tx2); font-size:13px; transition: all .15s; }
  .sm-upload:hover { border-color: var(--gold2); color: var(--text); }

  .sm-actions { margin-top:6px; }
  .sm-btn-primary { display:inline-flex; align-items:center; padding:12px 22px; border:none; border-radius: var(--r); background: var(--gold); color:#fff; font-weight:800; font-size:14px; cursor:pointer; transition: all .15s; }
  .sm-btn-primary:hover:not(:disabled) { background: var(--gold2); transform: translateY(-1px); }
  .sm-btn-primary:disabled { opacity:.45; cursor:not-allowed; }

  .sm-right-lbl { font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color: var(--tx3); }
  .sm-preview { }
  .sm-card { background: var(--navy2); border:1px solid var(--bd); border-radius: var(--r2); padding:16px; }
  .sm-card-head { display:flex; align-items:center; gap:11px; margin-bottom:11px; }
  .sm-card-avatar { width:40px; height:40px; border-radius:50%; background: var(--gold); color:#fff; display:grid; place-items:center; font-weight:900; }
  .sm-card-name { font-weight:800; font-size:14px; color: var(--text); }
  .sm-card-net { font-size:12px; color: var(--gold2); }
  .sm-card-text { font-size:14px; line-height:1.55; color: var(--text); white-space:normal; word-break:break-word; }
  .sm-card-img { margin-top:12px; border-radius: var(--r); overflow:hidden; border:1px solid var(--bd); }
  .sm-card-img img { width:100%; display:block; }
  .sm-muted { color: var(--tx3); font-style:italic; }

  .sm-result { }
  .sm-result-pending { display:flex; align-items:center; color: var(--gold2); font-size:13px; }
  .sm-result-head { font-weight:800; font-size:14px; margin-bottom:8px; }
  .sm-result-head.ok { color:#34d399; } .sm-result-head.warn { color:#fcd34d; } .sm-result-head.ko { color:#f87171; }
  .sm-result-ko { color:#f87171; font-size:13px; }
  .sm-result-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px; }
  .sm-result-list li { display:flex; align-items:center; gap:10px; font-size:13px; }
  .sm-res-net { font-weight:700; color: var(--text); min-width:78px; }
  .sm-result-list li.ok a { color:#34d399; text-decoration:none; }
  .sm-res-err { color:#f87171; }

  .sm-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%) translateY(20px); background: var(--navy3); color: var(--text); border:1px solid var(--bd); padding:11px 18px; border-radius: var(--r); font-size:13px; font-weight:600; opacity:0; pointer-events:none; transition: all .25s; z-index:9999; }
  .sm-toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .sm-toast-ok { border-color: rgba(52,211,153,.4); } .sm-toast-warn { border-color: rgba(251,191,36,.4); }

  @media (max-width: 820px) { .sm-split { flex-direction:column; } .sm-left { width:100%; border-right:none; border-bottom:1px solid var(--bd); } }
  `;
  const tag = document.createElement('style');
  tag.id = 'sm-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
}
