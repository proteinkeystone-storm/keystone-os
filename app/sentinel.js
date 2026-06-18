// ═══════════════════════════════════════════════════════════════
// SENTINEL — Pad O-GEO-001 · S0 + S1
//
// Centre de contrôle d'audit web AVEC suivi.
//  · S0 : coquille — ajouter / lister / retirer les sites surveillés,
//    avec détection de plateforme et barème par plan.
//  · S1 : BATTEMENT DE CŒUR — cockpit live : statut en direct (en ligne
//    / hors ligne), disponibilité 24 h, sparkline du temps de réponse,
//    « vérifier maintenant », et polling à l'écran (sensation « ça ne
//    s'arrête jamais »). La surveillance de fond tourne côté worker (cron).
//
// ISOLATION : préfixe snt- (CSS/DOM), routes /api/sentinel/.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-GEO-001', name: 'Sentinel' };
const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';
const POLL_MS = 45000;   // rafraîchissement à l'écran (live feel)

const PLATFORM_LABEL = { wix: 'Wix', wordpress: 'WordPress', custom: 'Sur-mesure', unknown: 'Plateforme inconnue' };

let _root = null;
let _sites = [];
let _limit = 1;
let _plan = '';
let _loading = false;
let _error = null;
let _busy = false;            // ajout en cours
let _checking = new Set();    // ids en cours de « vérifier maintenant »
let _poll = null;

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
  _startPoll();
}
export function closeSentinel() {
  if (!_root) return;
  _stopPoll();
  document.removeEventListener('keydown', _onKey);
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}
function _onKey(e) { if (e.key === 'Escape') closeSentinel(); }
function _startPoll() { _stopPoll(); _poll = setInterval(() => { if (document.visibilityState === 'visible') _load(true); }, POLL_MS); }
function _stopPoll() { if (_poll) { clearInterval(_poll); _poll = null; } }

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
async function _load(silent) {
  if (!silent) { _loading = true; _error = null; _render(); }
  try {
    const d = await _api('/sites');
    _sites = d.sites || []; _limit = d.limit || 1; _plan = d.plan || ''; _error = null;
  } catch (e) {
    if (!silent) _error = e.message || 'Chargement impossible.';
  }
  _loading = false; _render();
}

// ── Helpers d'affichage ─────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } }
function _ago(iso) {
  if (!iso) return '';
  const t = Date.parse(String(iso).replace(' ', 'T') + 'Z'); if (isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
function _status(s) {
  if (!s.last_checked_at) return { cls: 'wait', txt: 'En attente', sub: 'Première vérification imminente' };
  if (s.last_ok === 1 || s.last_ok === true) return { cls: 'up', txt: 'En ligne', sub: (s.last_ms != null ? `${s.last_ms} ms` : '') };
  return { cls: 'down', txt: 'Hors ligne', sub: s.last_status ? `HTTP ${s.last_status}` : 'Inaccessible' };
}
function _spark(arr) {
  if (!arr || !arr.length) return '';
  const w = 132, h = 30, pad = 2, n = arr.length;
  const vals = arr.map((p) => p.ms || 0);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0), span = Math.max(1, max - min);
  const x = (i) => pad + (n === 1 ? (w - 2 * pad) : i * (w - 2 * pad) / (n - 1));
  const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const pts = arr.map((p, i) => `${x(i).toFixed(1)},${y(p.ms || 0).toFixed(1)}`).join(' ');
  const dots = arr.map((p, i) => p.ok ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(p.ms || 0).toFixed(1)}" r="2.4" style="fill:var(--danger)"/>`).join('');
  return `<svg class="snt-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" style="fill:none;stroke:var(--ws-accent);stroke-width:1.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

// ── Rendu ───────────────────────────────────────────────────────
function _render() {
  const main = _main(); if (!main) return;
  if (_loading) { main.innerHTML = `<div class="snt-state">${icon('refresh', 28)}<p>Chargement…</p></div>`; return; }
  if (_error)   { main.innerHTML = `<div class="snt-state snt-state-err">${icon('x', 28)}<p>${_esc(_error)}</p><button class="snt-btn" data-act="reload">Réessayer</button></div>`; return; }

  const atLimit = _sites.length >= _limit;
  const limitTxt = _limit >= 9999 ? '∞' : String(_limit);
  const list = _sites.length
    ? `<div class="snt-grid">${_sites.map(_siteCard).join('')}</div>`
    : `<div class="snt-state">${icon('eye', 30)}<h2>Aucun site surveillé</h2><p>Ajoutez l'adresse d'un site — Sentinel détecte sa plateforme et le surveille en continu.</p></div>`;

  main.innerHTML = `
    <div class="snt-wrap">
      <div class="snt-head">
        <h1 class="snt-title">Sites surveillés</h1>
        <p class="snt-sub"><span class="snt-live"></span>Surveillance active · ${_sites.length} / ${limitTxt} site${_limit > 1 ? 's' : ''} · plan ${_esc(_plan || '—')}</p>
      </div>
      ${list}
      ${_addBlock(atLimit, limitTxt)}
    </div>
  `;
}

function _siteCard(s) {
  const plat = PLATFORM_LABEL[s.platform] || PLATFORM_LABEL.unknown;
  const host = _hostOf(s.url);
  const st = _status(s);
  const checking = _checking.has(s.id);
  return `
    <div class="snt-card">
      <div class="snt-card-top">
        <span class="snt-dot ${st.cls}"></span>
        <span class="snt-host">${_esc(s.label || host)}</span>
        <button class="snt-icon" data-act="del" data-id="${_esc(s.id)}" aria-label="Retirer ce site" title="Retirer">${icon('trash-2', 16)}</button>
      </div>
      <a class="snt-url" href="${_esc(s.url)}" target="_blank" rel="noopener">${_esc(host)} ${icon('external-link', 13)}</a>
      <div class="snt-status">
        <span class="snt-status-txt ${st.cls}">${st.txt}</span>
        ${st.sub ? `<span class="snt-status-sub">${_esc(st.sub)}</span>` : ''}
      </div>
      ${s.spark && s.spark.length ? `<div class="snt-sparkwrap">${_spark(s.spark)}</div>` : ''}
      <div class="snt-metrics">
        ${s.uptime24h != null ? `<span title="Disponibilité sur 24 h">${s.uptime24h} % en ligne · 24 h</span>` : '<span class="snt-dim">Pas encore d\'historique</span>'}
        ${s.last_checked_at ? `<span class="snt-ago">${_ago(s.last_checked_at)}</span>` : ''}
      </div>
      <div class="snt-card-foot">
        <span class="snt-badge">${_esc(plat)}</span>
        <button class="snt-mini" data-act="check" data-id="${_esc(s.id)}"${checking ? ' disabled' : ''}>${icon('refresh', 13)} ${checking ? 'Vérification…' : 'Vérifier'}</button>
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
      <button class="snt-btn" type="submit"${_busy ? ' disabled' : ''}>${icon('plus', 16)} ${_busy ? 'Ajout…' : 'Ajouter'}</button>
    </form>
    <p class="snt-hint">Sentinel détecte la plateforme et lance la surveillance immédiatement.</p>
  `;
}

// ── Interactions ────────────────────────────────────────────────
function _onClick(e) {
  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'close')  return closeSentinel();
  if (a === 'reload') return _load();
  if (a === 'del')    return _delSite(act.dataset.id);
  if (a === 'check')  return _checkNow(act.dataset.id);
}
async function _onSubmit(e) {
  const form = e.target.closest('[data-form="add"]'); if (!form) return;
  e.preventDefault();
  if (_busy) return;
  const url   = (form.querySelector('[name="url"]').value || '').trim();
  const label = (form.querySelector('[name="label"]').value || '').trim();
  if (!url) return;
  _busy = true; _render();
  try {
    await _api('/sites', { method: 'POST', body: { url, label } });
    _busy = false;
    await _load(true);
  } catch (e2) {
    _busy = false; _render();
    alert(e2.message || 'Ajout impossible.');
  }
}
async function _checkNow(id) {
  if (!id || _checking.has(id)) return;
  _checking.add(id); _render();
  try { await _api(`/sites/${encodeURIComponent(id)}/check`, { method: 'POST' }); }
  catch (e) { alert(e.message || 'Vérification impossible.'); }
  _checking.delete(id);
  await _load(true);
}
async function _delSite(id) {
  if (!id) return;
  if (!confirm('Retirer ce site de la surveillance ?')) return;
  try { await _api(`/sites/${encodeURIComponent(id)}`, { method: 'DELETE' }); await _load(true); }
  catch (e) { alert(e.message || 'Suppression impossible.'); }
}
