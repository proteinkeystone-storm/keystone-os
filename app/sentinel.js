// ═══════════════════════════════════════════════════════════════
// SENTINEL — Pad O-GEO-001 · S0 → S2
//
//  · S0  : coquille (sites + détection plateforme + barème).
//  · S1  : battement de cœur — cockpit live (statut, dispo 24 h,
//          sparkline, vérifier, polling à l'écran).
//  · S1.5: alertes web push (site hors ligne / rétabli).
//  · S2  : audit on-page + score (SEO technique, sécurité, accessibilité)
//          + findings priorisés, dans un panneau dédié.
//
// ISOLATION : préfixe snt- (CSS/DOM), routes /api/sentinel/.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-GEO-001', name: 'Sentinel' };
const API_BASE = 'https://keystone-os-api.keystone-os.workers.dev';
const POLL_MS = 45000;
// Clé publique VAPID (doit correspondre au worker — même clé que Keynapse).
const SNT_VAPID_PUBLIC = 'BB0ytfuRYEoK1K6Y4SGGFbXhj6MbSTqsGnLG_gMypV_IVkGyWFiengfTRVyNJFUqmP8Vvg30v-9067t9X5HTlEc';

const PLATFORM_LABEL = { wix: 'Wix', wordpress: 'WordPress', custom: 'Sur-mesure', unknown: 'Plateforme inconnue' };
const AXES = [
  { k: 'disponibilite', label: 'Disponibilité' },
  { k: 'performance',   label: 'Performance' },
  { k: 'seo',           label: 'SEO technique' },
  { k: 'securite',      label: 'Sécurité' },
  { k: 'accessibilite', label: 'Accessibilité' },
];
const SOON_AXES = ['Mots-clés', 'Visibilité IA (GEO)', 'Présence locale'];
const SEV_LABEL = { high: 'Élevé', medium: 'Moyen', low: 'Faible' };

let _root = null;
let _sites = [];
let _limit = 1;
let _plan = '';
let _loading = false;
let _error = null;
let _busy = false;
let _checking = new Set();
let _auditing = new Set();
let _poll = null;
let _alerts = false;
let _alertsSupported = false;
let _panel = null;
let _emailEnabled = false;   // S4.1 — l'envoi webmaster n'est exposé que si le serveur l'a câblé

// ── API ─────────────────────────────────────────────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
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
  _initAlerts();
  _startPoll();
}
export function closeSentinel() {
  if (!_root) return;
  _stopPoll(); _closePanel();
  document.removeEventListener('keydown', _onKey);
  _root.remove(); _root = null;
  document.body.style.overflow = '';
}
function _onKey(e) { if (e.key === 'Escape') { if (_panel) _closePanel(); else closeSentinel(); } }
function _startPoll() { _stopPoll(); _poll = setInterval(() => { if (document.visibilityState === 'visible' && !_panel) _load(true); }, POLL_MS); }
function _stopPoll() { if (_poll) { clearInterval(_poll); _poll = null; } }

// ── Coquille workspace ──────────────────────────────────────────
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
    _sites = d.sites || []; _limit = d.limit || 1; _plan = d.plan || ''; _emailEnabled = !!d.email_enabled; _error = null;
  } catch (e) {
    if (!silent) _error = e.message || 'Chargement impossible.';
  }
  _loading = false; _render();
}

// ── Helpers ─────────────────────────────────────────────────────
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
function _scoreClass(v) { return v >= 80 ? 'good' : (v >= 50 ? 'warn' : 'bad'); }
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

// ── Rendu liste ─────────────────────────────────────────────────
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
        <div>
          <h1 class="snt-title">Sites surveillés</h1>
          <p class="snt-sub"><span class="snt-live"></span>Surveillance active · ${_sites.length} / ${limitTxt} site${_limit > 1 ? 's' : ''} · plan ${_esc(_plan || '—')}</p>
        </div>
        ${_alertsBtn()}
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
  const id = _esc(s.id);
  const checking = _checking.has(s.id);
  const auditing = _auditing.has(s.id);
  return `
    <div class="snt-card">
      <div class="snt-card-top">
        <span class="snt-dot ${st.cls}"></span>
        <span class="snt-host">${_esc(s.label || host)}</span>
        ${s.last_score != null ? `<button class="snt-score ${_scoreClass(s.last_score)}" data-act="score" data-id="${id}" title="Voir le dernier audit">${s.last_score}</button>` : ''}
        <button class="snt-icon" data-act="del" data-id="${id}" aria-label="Retirer ce site" title="Retirer">${icon('trash-2', 16)}</button>
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
        <div class="snt-actions">
          <button class="snt-mini" data-act="check" data-id="${id}"${checking ? ' disabled' : ''}>${icon('refresh', 13)} ${checking ? '…' : 'Vérifier'}</button>
          <button class="snt-mini" data-act="audit" data-id="${id}"${auditing ? ' disabled' : ''}>${icon('search', 13)} ${auditing ? 'Audit…' : 'Auditer'}</button>
        </div>
      </div>
    </div>
  `;
}

function _addBlock(atLimit, limitTxt) {
  if (atLimit) return `<div class="snt-add snt-add-locked">${icon('lock', 18)}<span>Limite de ${limitTxt} site${_limit > 1 ? 's' : ''} atteinte pour le plan ${_esc(_plan || '—')}. Passez à un plan supérieur pour en ajouter.</span></div>`;
  return `
    <form class="snt-add" data-form="add">
      <input class="snt-input" name="url" type="url" inputmode="url" autocomplete="off" placeholder="https://votre-site.com" required aria-label="Adresse du site" />
      <input class="snt-input snt-input-label" name="label" type="text" placeholder="Nom (optionnel)" aria-label="Nom du site" />
      <button class="snt-btn" type="submit"${_busy ? ' disabled' : ''}>${icon('plus', 16)} ${_busy ? 'Ajout…' : 'Ajouter'}</button>
    </form>
    <p class="snt-hint">Sentinel détecte la plateforme et lance la surveillance immédiatement.</p>
  `;
}

// ── Alertes web push (S1.5) ─────────────────────────────────────
function _alertsBtn() {
  if (!_alertsSupported) return '';
  return `<button class="snt-alerts ${_alerts ? 'on' : ''}" data-act="alerts">${icon('bell', 15)} ${_alerts ? 'Alertes activées' : 'Activer les alertes'}</button>`;
}
function _vapidBytes() {
  const s = SNT_VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - s.length % 4) % 4);
  const raw = atob(padded); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function _initAlerts() {
  _alertsSupported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  if (!_alertsSupported) { _render(); return; }
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); _alerts = !!sub && Notification.permission === 'granted'; }
  catch (_) { _alerts = false; }
  _render();
}
async function _toggleAlerts() {
  if (!_alertsSupported) return;
  if (_alerts) {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { try { await _api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch (_) {} await sub.unsubscribe(); } } catch (_) {}
    _alerts = false; _render(); return;
  }
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (_) {} }
  if (perm !== 'granted') { alert('Autorisez les notifications dans votre navigateur pour recevoir les alertes.'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _vapidBytes() });
    const j = sub.toJSON();
    if (j && j.keys) await _api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
    _alerts = true;
  } catch (e) { alert('Activation impossible : ' + (e.message || e)); }
  _render();
}

// ── Audit (S2) ──────────────────────────────────────────────────
function _bar(label, v) {
  if (v == null) return `<div class="snt-bar"><span class="snt-bar-l">${label}</span><div class="snt-bar-track"></div><span class="snt-bar-v snt-dim">n/a</span></div>`;
  return `<div class="snt-bar"><span class="snt-bar-l">${label}</span><div class="snt-bar-track"><i class="${_scoreClass(v)}" style="width:${v}%"></i></div><span class="snt-bar-v">${v}</span></div>`;
}
function _barSoon(label) { return `<div class="snt-bar"><span class="snt-bar-l">${label}</span><div class="snt-bar-track"></div><span class="snt-bar-v snt-dim">à venir</span></div>`; }
function _findingsHTML(list) {
  if (!list || !list.length) return `<div class="snt-okmsg">${icon('check', 16)} Aucun problème détecté sur les axes audités.</div>`;
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...list].sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3));
  return `<div class="snt-find-h">À corriger en priorité — solutions clé en main</div><div class="snt-finds">` + sorted.map((f, i) => {
    const fix = f.fix;
    const steps = (fix && fix.steps && fix.steps.length) ? `<ol class="snt-fix-steps">${fix.steps.map((s) => `<li>${_esc(s)}</li>`).join('')}</ol>` : '';
    const codeId = `snt-code-${i}`;
    const code = (fix && fix.code) ? `<div class="snt-fix-codehead"><span>${_esc(fix.codeLabel || 'Code à coller')}</span><button class="snt-copy" data-act="copy" data-target="${codeId}">${icon('copy', 13)} Copier</button></div><pre class="snt-code" id="${codeId}">${_esc(fix.code)}</pre>` : '';
    // S4.1 — sur la méta description, l'IA peut rédiger le VRAI texte (pas le gabarit).
    const ai = (f.key === 'meta_missing') ? `<div class="snt-ai" id="snt-ai-meta-${i}"><button class="snt-ai-btn" data-act="suggest" data-kind="meta" data-slot="snt-ai-meta-${i}">${icon('sparkles', 14)} Rédiger avec l'IA</button></div>` : '';
    const body = (steps || code || ai) ? `<div class="snt-fix">${steps}${code}${ai}</div>` : '';
    return `<details class="snt-find">
      <summary><span class="snt-sev ${_esc(f.sev)}">${SEV_LABEL[f.sev] || ''}</span><span class="snt-find-t">${_esc(f.title)}</span><span class="snt-find-chev">${icon('chevron-down', 16)}</span></summary>
      ${f.detail ? `<div class="snt-find-d">${_esc(f.detail)}</div>` : ''}
      ${body}
    </details>`;
  }).join('') + `</div>`;
}
function _openPanel(data) { _panel = data; _renderPanel(); }
function _closePanel() { _panel = null; const el = _root && _root.querySelector('.snt-overlay'); if (el) el.remove(); }
function _renderPanel() {
  if (!_root) return;
  let el = _root.querySelector('.snt-overlay');
  if (!el) { el = document.createElement('div'); el.className = 'snt-overlay'; el.addEventListener('click', (e) => { if (e.target === el) _closePanel(); }); _root.appendChild(el); }
  const p = _panel; if (!p) { el.remove(); return; }
  const scores = p.scores || {}; const g = p.score; const cwv = p.cwv;
  const cwvLine = cwv ? `<div class="snt-cwv">${icon('clock', 13)} LCP ${(cwv.lcp / 1000).toFixed(1)} s · CLS ${cwv.cls} · ${cwv.weightKb >= 1024 ? (cwv.weightKb / 1024).toFixed(1) + ' Mo' : cwv.weightKb + ' Ko'} · ${cwv.requests} requêtes</div>` : '';
  const bars = AXES.map((a) => _bar(a.label, scores[a.k])).join('') + SOON_AXES.map(_barSoon).join('');
  el.innerHTML = `
    <div class="snt-modal">
      <div class="snt-modal-head">
        <div><div class="snt-modal-title">${_esc(p.name || 'Audit')}</div><div class="snt-modal-sub">Audit on-page${p.reachable === false ? ' · site injoignable' : ''}</div></div>
        <div class="snt-modal-actions">
          ${_emailEnabled ? `<button class="snt-mini" data-act="email-toggle">${icon('mail', 13)} Webmaster</button>` : ''}
          <button class="snt-mini" data-act="pdf">${icon('download', 13)} PDF</button>
          <button class="snt-icon" data-act="panel-close" aria-label="Fermer">${icon('x', 18)}</button>
        </div>
      </div>
      <div class="snt-modal-score ${g != null ? _scoreClass(g) : ''}">${g != null ? g : '—'}<span>/100</span></div>
      <div class="snt-bars">${bars}</div>
      ${_findingsHTML(p.findings)}
      ${_aeoCardHTML()}
      ${_emailEnabled ? _emailRowHTML() : ''}
    </div>
  `;
}
// S4.1 — carte « opportunité » AEO : générer une FAQ structurée (pilier GEO).
function _aeoCardHTML() {
  return `<div class="snt-aeo">
    <div class="snt-aeo-head">${icon('sparkles', 18)}<div><div class="snt-aeo-t">Visibilité dans les IA — FAQ structurée</div><div class="snt-aeo-d">Une FAQ Schema.org aide Google et les assistants IA (ChatGPT, Perplexity) à comprendre et citer votre site.</div></div></div>
    <div class="snt-ai" id="snt-ai-faq"><button class="snt-ai-btn" data-act="suggest" data-kind="faq" data-slot="snt-ai-faq">${icon('sparkles', 14)} Rédiger avec l'IA</button></div>
  </div>`;
}
// S4.1 — envoi du rapport au webmaster (replié par défaut).
function _emailRowHTML() {
  return `<div class="snt-email" id="snt-email-row" hidden>
    <div class="snt-email-top">${icon('mail', 15)} Envoyer ce rapport (étapes + code à coller) au webmaster du site.</div>
    <div class="snt-email-form">
      <input class="snt-input" id="snt-email-input" type="email" inputmode="email" autocomplete="off" placeholder="email@du-webmaster.com" aria-label="E-mail du webmaster">
      <button class="snt-btn snt-btn-sm" data-act="send-report">${icon('send', 14)} Envoyer</button>
    </div>
    <div class="snt-email-msg" id="snt-email-msg"></div>
  </div>`;
}
function _copyCode(targetId, btn) {
  const el = _root && _root.querySelector('#' + (targetId || '')); if (!el) return;
  const txt = el.textContent || '';
  if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  if (btn) btn.innerHTML = `${icon('check', 13)} Copié`;
}
function _exportPdf() {
  const p = _panel; if (!p) return;
  const d = new Date();
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const scores = p.scores || {}; const g = p.score;
  const axisRows = AXES.map((a) => `<tr><td>${a.label}</td><td style="text-align:right">${scores[a.k] == null ? 'n/a' : scores[a.k] + ' / 100'}</td></tr>`).join('');
  const order = { high: 0, medium: 1, low: 2 };
  const finds = [...(p.findings || [])].sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3)).map((f) => {
    const steps = (f.fix && f.fix.steps) ? `<ol>${f.fix.steps.map((s) => `<li>${_esc(s)}</li>`).join('')}</ol>` : '';
    const code = (f.fix && f.fix.code) ? `<div class="cl">${_esc(f.fix.codeLabel || 'Code')}</div><pre>${_esc(f.fix.code)}</pre>` : '';
    return `<div class="f"><div class="ft"><b>[${SEV_LABEL[f.sev] || ''}]</b> ${_esc(f.title)}</div>${f.detail ? `<div class="fd">${_esc(f.detail)}</div>` : ''}${steps}${code}</div>`;
  }).join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Sentinel — ${_esc(p.name || 'Audit')}</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.5}
  h1{font-size:24px;margin:0 0 2px}.sub{color:#64748b;font-size:13px;margin-bottom:18px}.score{font-size:52px;font-weight:800;margin:6px 0}
  table{width:100%;border-collapse:collapse;margin:6px 0 18px}td{padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
  h2{font-size:16px;margin:16px 0 6px}.f{border-top:1px solid #eee;padding:10px 0}.ft{font-size:14px}.fd{color:#64748b;font-size:13px;margin:2px 0 6px}
  .cl{font-size:12px;color:#64748b;margin:6px 0 2px}ol{margin:6px 0;padding-left:20px;font-size:13px;color:#334155}
  pre{background:#f6f7f9;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-word}.foot{margin-top:24px;color:#94a3b8;font-size:11px}</style></head><body>
  <h1>Rapport Sentinel — ${_esc(p.name || 'Audit')}</h1><div class="sub">Audit web · ${date}</div>
  <div class="score">${g != null ? g : '—'}<span style="font-size:18px;color:#94a3b8">/100</span></div>
  <table>${axisRows}</table><h2>À corriger en priorité — solutions clé en main</h2>${finds || '<p>Aucun problème détecté.</p>'}
  <div class="foot">Généré par Keystone Sentinel</div></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Autorisez les fenêtres pop-up pour exporter le PDF.'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 400);
}

// ── S4.1 · IA rédactionnel (méta / FAQ AEO) ─────────────────────
function _aiOutHTML(s, slot) {
  if (!s) return `<div class="snt-ai-err">${icon('x', 13)} Réponse vide. Réessayez.</div><button class="snt-ai-regen" data-act="suggest" data-kind="meta" data-slot="${_esc(slot)}">${icon('refresh', 12)} Réessayer</button>`;
  const codeId = `${slot}-code`;
  let preview = '';
  if (s.kind === 'meta') {
    const ideal = s.length >= 130 && s.length <= 160;
    preview = `<div class="snt-ai-meta">${_esc(s.text)}</div><div class="snt-ai-len">${s.length} caractères${ideal ? ' · longueur idéale' : ''}</div>`;
  } else if (s.kind === 'faq' && s.pairs) {
    preview = `<div class="snt-ai-faq">${s.pairs.map((p) => `<div class="snt-ai-qa"><div class="snt-ai-q">${_esc(p.q)}</div><div class="snt-ai-a">${_esc(p.a)}</div></div>`).join('')}</div>`;
  }
  const code = s.code ? `<div class="snt-fix-codehead"><span>${_esc(s.codeLabel || 'Code à coller')}</span><button class="snt-copy" data-act="copy" data-target="${codeId}">${icon('copy', 13)} Copier</button></div><pre class="snt-code" id="${codeId}">${_esc(s.code)}</pre>` : '';
  return `${preview}${code}<button class="snt-ai-regen" data-act="suggest" data-kind="${_esc(s.kind)}" data-slot="${_esc(slot)}">${icon('refresh', 12)} Régénérer</button>`;
}
async function _suggestAI(kind, slot) {
  const box = _root && _root.querySelector('#' + (slot || ''));
  if (!_panel || !_panel.id || !box) return;
  box.innerHTML = `<div class="snt-ai-load">${icon('refresh', 14)} L'IA rédige ${kind === 'faq' ? 'votre FAQ' : 'votre méta description'}…</div>`;
  try {
    const d = await _api(`/sites/${encodeURIComponent(_panel.id)}/suggest`, { method: 'POST', body: { kind }, timeout: 45000 });
    box.innerHTML = _aiOutHTML(d.suggestion, slot);
  } catch (e) {
    box.innerHTML = `<div class="snt-ai-err">${icon('x', 13)} ${_esc(e.message || 'Génération impossible.')}</div><button class="snt-ai-regen" data-act="suggest" data-kind="${_esc(kind)}" data-slot="${_esc(slot)}">${icon('refresh', 12)} Réessayer</button>`;
  }
}

// ── S4.1 · Envoi au webmaster ───────────────────────────────────
function _toggleEmailForm() {
  const row = _root && _root.querySelector('#snt-email-row');
  if (!row) return;
  row.hidden = !row.hidden;
  if (!row.hidden) { const i = row.querySelector('#snt-email-input'); if (i) i.focus(); }
}
async function _sendReport() {
  if (!_panel || !_panel.id) return;
  const input = _root && _root.querySelector('#snt-email-input');
  const msg = _root && _root.querySelector('#snt-email-msg');
  const email = ((input && input.value) || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { if (msg) msg.innerHTML = `<span class="snt-email-err">Adresse e-mail invalide.</span>`; return; }
  if (msg) msg.innerHTML = `<span class="snt-dim">Envoi…</span>`;
  try {
    await _api(`/sites/${encodeURIComponent(_panel.id)}/send-report`, { method: 'POST', body: { email }, timeout: 30000 });
    if (msg) msg.innerHTML = `<span class="snt-email-ok">${icon('check', 13)} Rapport envoyé à ${_esc(email)}.</span>`;
    if (input) input.value = '';
  } catch (e) {
    if (msg) msg.innerHTML = `<span class="snt-email-err">${_esc(e.message || 'Envoi impossible.')}</span>`;
  }
}
async function _auditNow(id) {
  if (_auditing.has(id)) return; _auditing.add(id); _render();
  const site = _sites.find((s) => s.id === id);
  try { const d = await _api(`/sites/${encodeURIComponent(id)}/audit`, { method: 'POST', timeout: 70000 }); _openPanel({ id, name: site ? (site.label || _hostOf(site.url)) : 'Audit', ...d.audit }); }
  catch (e) { alert(e.message || 'Audit impossible.'); }
  _auditing.delete(id); await _load(true);
}
async function _viewAudit(id) {
  const site = _sites.find((s) => s.id === id);
  try { const d = await _api(`/sites/${encodeURIComponent(id)}/audit`); if (!d.audit) return _auditNow(id); _openPanel({ id, name: site ? (site.label || _hostOf(site.url)) : 'Audit', ...d.audit }); }
  catch (e) { alert(e.message || 'Audit indisponible.'); }
}

// ── Interactions ────────────────────────────────────────────────
function _onClick(e) {
  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'close')       return closeSentinel();
  if (a === 'reload')      return _load();
  if (a === 'del')         return _delSite(act.dataset.id);
  if (a === 'check')       return _checkNow(act.dataset.id);
  if (a === 'audit')       return _auditNow(act.dataset.id);
  if (a === 'score')       return _viewAudit(act.dataset.id);
  if (a === 'alerts')      return _toggleAlerts();
  if (a === 'panel-close') return _closePanel();
  if (a === 'pdf')         return _exportPdf();
  if (a === 'copy')        return _copyCode(act.dataset.target, act);
  if (a === 'suggest')     return _suggestAI(act.dataset.kind, act.dataset.slot);
  if (a === 'email-toggle') return _toggleEmailForm();
  if (a === 'send-report') return _sendReport();
}
async function _onSubmit(e) {
  const form = e.target.closest('[data-form="add"]'); if (!form) return;
  e.preventDefault();
  if (_busy) return;
  const url = (form.querySelector('[name="url"]').value || '').trim();
  const label = (form.querySelector('[name="label"]').value || '').trim();
  if (!url) return;
  _busy = true; _render();
  try { await _api('/sites', { method: 'POST', body: { url, label } }); _busy = false; await _load(true); }
  catch (e2) { _busy = false; _render(); alert(e2.message || 'Ajout impossible.'); }
}
async function _checkNow(id) {
  if (!id || _checking.has(id)) return;
  _checking.add(id); _render();
  try { await _api(`/sites/${encodeURIComponent(id)}/check`, { method: 'POST' }); }
  catch (e) { alert(e.message || 'Vérification impossible.'); }
  _checking.delete(id); await _load(true);
}
async function _delSite(id) {
  if (!id) return;
  if (!confirm('Retirer ce site de la surveillance ?')) return;
  try { await _api(`/sites/${encodeURIComponent(id)}`, { method: 'DELETE' }); await _load(true); }
  catch (e) { alert(e.message || 'Suppression impossible.'); }
}
