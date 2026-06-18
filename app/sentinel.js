// ═══════════════════════════════════════════════════════════════
// SENTINEL — Pad O-GEO-001 · S0 (Sprint 0 : coquille & sites)
//
// Centre de contrôle d'audit web AVEC suivi. S0 = coquille :
// ajouter / lister / retirer les sites surveillés, avec détection
// automatique de la plateforme (Wix / WordPress / sur-mesure) et
// barème par plan (STARTER 1 · PRO 3 · MAX 5). La surveillance réelle
// (uptime, score, GEO, clé en main) arrive aux sprints suivants.
//
// ISOLATION : préfixe snt- (CSS/DOM), routes /api/sentinel/. Aucun
// code partagé avec les autres pads.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-GEO-001', name: 'Sentinel' };
const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';

const PLATFORM_LABEL = { wix: 'Wix', wordpress: 'WordPress', custom: 'Sur-mesure', unknown: 'Plateforme inconnue' };

let _root = null;
let _sites = [];
let _limit = 1;
let _plan = '';
let _loading = false;
let _error = null;
let _busy = false;   // ajout en cours

// ── API ─────────────────────────────────────────────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/sentinel${path}`, {
      method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${_jwt()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw (e && e.name === 'AbortError') ? new Error('Le serveur met trop de temps à répondre — réessayez.') : e;
  }
  clearTimeout(timer);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; e.code = data.code; throw e; }
  return data;
}

// ── Ouverture / fermeture ───────────────────────────────────────
export function openSentinel(opts = {}) {
  if (_root) return;
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  _load();
}
export function closeSentinel() {
  if (!_root) return;
  document.removeEventListener('keydown', _onKey);
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}
function _onKey(e) { if (e.key === 'Escape') closeSentinel(); }

// ── Coquille workspace (classes ws-* partagées : workspace.css) ──
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app snt-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="close" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('sentinel', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main snt-main" data-slot="main"></main>
    </div>
  `;
  document.body.appendChild(_root);
  _root.addEventListener('click', _onClick);
  _root.addEventListener('submit', _onSubmit);
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

function _main() { return _root && _root.querySelector('[data-slot="main"]'); }

// ── Données ─────────────────────────────────────────────────────
async function _load() {
  _loading = true; _error = null; _render();
  try {
    const d = await _api('/sites');
    _sites = d.sites || []; _limit = d.limit || 1; _plan = d.plan || '';
  } catch (e) {
    _error = e.message || 'Chargement impossible.';
  }
  _loading = false; _render();
}

// ── Rendu ───────────────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } }

function _render() {
  const main = _main(); if (!main) return;
  if (_loading) { main.innerHTML = `<div class="snt-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }
  if (_error)   { main.innerHTML = `<div class="snt-state snt-state-err">${icon('x', 28)}<p>${_esc(_error)}</p><button class="snt-btn" data-act="reload">Réessayer</button></div>`; return; }

  const atLimit = _sites.length >= _limit;
  const limitTxt = _limit >= 9999 ? '∞' : String(_limit);
  const list = _sites.length
    ? `<div class="snt-grid">${_sites.map(_siteCard).join('')}</div>`
    : `<div class="snt-state">${icon('eye', 30)}<h2>Aucun site surveillé</h2><p>Ajoutez l'adresse d'un site — Sentinel détecte sa plateforme et le gardera à l'œil.</p></div>`;

  main.innerHTML = `
    <div class="snt-wrap">
      <div class="snt-head">
        <h1 class="snt-title">Sites surveillés</h1>
        <p class="snt-sub">${_sites.length} / ${limitTxt} site${_limit > 1 ? 's' : ''} · plan ${_esc(_plan || '—')}</p>
      </div>
      ${list}
      ${_addBlock(atLimit, limitTxt)}
    </div>
  `;
}

function _siteCard(s) {
  const plat = PLATFORM_LABEL[s.platform] || PLATFORM_LABEL.unknown;
  const host = _hostOf(s.url);
  return `
    <div class="snt-card">
      <div class="snt-card-top">
        <span class="snt-dot" title="Surveillance active au prochain sprint"></span>
        <span class="snt-host">${_esc(s.label || host)}</span>
        <button class="snt-icon" data-act="del" data-id="${_esc(s.id)}" aria-label="Retirer ce site" title="Retirer">${icon('trash-2', 16)}</button>
      </div>
      <a class="snt-url" href="${_esc(s.url)}" target="_blank" rel="noopener">${_esc(host)} ${icon('external-link', 13)}</a>
      <div class="snt-card-foot">
        <span class="snt-badge">${_esc(plat)}</span>
        <span class="snt-soon">Surveillance bientôt active</span>
      </div>
    </div>
  `;
}

function _addBlock(atLimit, limitTxt) {
  if (atLimit) {
    return `<div class="snt-add snt-add-locked">${icon('lock', 18)}<span>Limite de ${limitTxt} site${_limit > 1 ? 's' : ''} atteinte pour le plan ${_esc(_plan || '—')}. Passez à un plan supérieur pour en ajouter.</span></div>`;
  }
  return `
    <form class="snt-add" data-form="add">
      <input class="snt-input" name="url" type="url" inputmode="url" autocomplete="off" placeholder="https://votre-site.com" required aria-label="Adresse du site" />
      <input class="snt-input snt-input-label" name="label" type="text" placeholder="Nom (optionnel)" aria-label="Nom du site" />
      <button class="snt-btn" type="submit"${_busy ? ' disabled' : ''}>${icon('plus', 16)} Ajouter</button>
    </form>
    <p class="snt-hint">Sentinel détecte automatiquement la plateforme (Wix, WordPress, sur-mesure).</p>
  `;
}

// ── Interactions ────────────────────────────────────────────────
function _onClick(e) {
  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'close')  return closeSentinel();
  if (a === 'reload') return _load();
  if (a === 'del')    return _delSite(act.dataset.id);
}
async function _onSubmit(e) {
  const form = e.target.closest('[data-form="add"]'); if (!form) return;
  e.preventDefault();
  if (_busy) return;
  const url   = (form.querySelector('[name="url"]').value || '').trim();
  const label = (form.querySelector('[name="label"]').value || '').trim();
  if (!url) return;
  _busy = true;
  const btn = form.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
  try {
    await _api('/sites', { method: 'POST', body: { url, label } });
    _busy = false;
    await _load();
  } catch (e2) {
    _busy = false;
    if (btn) btn.disabled = false;
    alert(e2.message || 'Ajout impossible.');
  }
}
async function _delSite(id) {
  if (!id) return;
  if (!confirm('Retirer ce site de la surveillance ?')) return;
  try { await _api(`/sites/${encodeURIComponent(id)}`, { method: 'DELETE' }); await _load(); }
  catch (e) { alert(e.message || 'Suppression impossible.'); }
}
