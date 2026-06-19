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
  { k: 'presence',      label: 'Présence locale' },
];
const SOON_AXES = ['Mots-clés'];
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
let _geoEnabled = false;     // S5 — la visibilité IA (GEO) n'est exposée que si une clé Gemini est câblée

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
    _sites = d.sites || []; _limit = d.limit || 1; _plan = d.plan || ''; _emailEnabled = !!d.email_enabled; _geoEnabled = !!d.geo_enabled; _error = null;
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

// ── S7 · Cockpit — vue site premium ─────────────────────────────
const _AXIS_ICON = { performance: 'zap', seo: 'search', securite: 'shield-check', accessibilite: 'eye', presence: 'compass', disponibilite: 'check-circle', geo: 'sparkles' };
const _SEV_PRIO = { high: { label: 'Priorité élevée', cls: 'high', gain: 5 }, medium: { label: 'Priorité moyenne', cls: 'medium', gain: 3 }, low: { label: 'À optimiser', cls: 'low', gain: 1 } };
function _until(iso) {
  if (!iso) return '';
  const t = Date.parse(String(iso).replace(' ', 'T') + 'Z'); if (isNaN(t)) return '';
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 0) return 'imminente'; if (s < 60) return `dans ${s} s`;
  const m = Math.floor(s / 60); return `dans ${m} min`;
}

// Findings enrichis : icône d'axe + priorité + gain estimé + tag plateforme + total.
function _findingsHTML(list, platform) {
  if (!list || !list.length) return `<div class="snt-okmsg">${icon('check', 16)} Aucun problème détecté sur les axes audités.</div>`;
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...list].sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3));
  const totalGain = sorted.reduce((s, f) => s + ((_SEV_PRIO[f.sev] || {}).gain || 0), 0);
  const platLabel = PLATFORM_LABEL[platform] || '';
  const head = `<div class="snt-find-h"><span>À corriger en priorité — solutions clé en main</span><span class="snt-find-sum">${sorted.length} action${sorted.length > 1 ? 's' : ''} · gain estimé +${totalGain} pts</span></div>`;
  return head + `<div class="snt-finds">` + sorted.map((f, i) => {
    const prio = _SEV_PRIO[f.sev] || _SEV_PRIO.low;
    const fix = f.fix;
    const steps = (fix && fix.steps && fix.steps.length) ? `<ol class="snt-fix-steps">${fix.steps.map((s) => `<li>${_esc(s)}</li>`).join('')}</ol>` : '';
    const codeId = `snt-code-${i}`;
    const code = (fix && fix.code) ? `<div class="snt-fix-codehead"><span>${_esc(fix.codeLabel || 'Code à coller')}</span><button class="snt-copy" data-act="copy" data-target="${codeId}">${icon('copy', 13)} Copier</button></div><pre class="snt-code" id="${codeId}">${_esc(fix.code)}</pre>` : '';
    const ai = (f.key === 'meta_missing') ? `<div class="snt-ai" id="snt-ai-meta-${i}"><button class="snt-ai-btn" data-act="suggest" data-kind="meta" data-slot="snt-ai-meta-${i}">${icon('sparkles', 14)} Rédiger avec l'IA</button></div>` : '';
    const body = (steps || code || ai) ? `<div class="snt-fix">${steps}${code}${ai}</div>` : '';
    const tag = (platLabel && fix) ? `<span class="snt-find-tag">${_esc(platLabel)}</span>` : '';
    return `<details class="snt-find">
      <summary>
        <span class="snt-find-ic">${icon(_AXIS_ICON[f.axis] || 'alert-triangle', 16)}</span>
        <span class="snt-find-t">${_esc(f.title)}</span>
        ${tag}<span class="snt-prio ${prio.cls}">${prio.label}</span>
        <span class="snt-find-chev">${icon('chevron-down', 16)}</span>
      </summary>
      ${f.detail ? `<div class="snt-find-d">${_esc(f.detail)}</div>` : ''}
      ${body}
    </details>`;
  }).join('') + `</div>`;
}

// 4 cartes KPI : disponibilité 30 j, score (+ tendance), LCP, SSL.
function _kpiCardsHTML(c) {
  const a = c.audit || {};
  const score = a.score;
  const lcp = a.cwv && a.cwv.lcp;
  const lcpTxt = (lcp != null && lcp > 0) ? (lcp / 1000).toFixed(1) + ' s' : 'n/a';
  const lcpAssess = (lcp == null || lcp <= 0) ? ' ' : (lcp <= 2500 ? '✓ bon' : (lcp <= 4000 ? 'à améliorer' : 'lent'));
  const upTxt = c.uptime30d != null ? String(c.uptime30d).replace('.', ',') + ' %' : 'n/a';
  const upTrend = c.uptimeTrend === 'up' ? '↑ en hausse' : (c.uptimeTrend === 'down' ? '↓ en baisse' : 'stable');
  const st = c.scoreTrend;
  const scoreTrendTxt = (st == null) ? 'première mesure' : (st > 0 ? `↑ +${st} cette semaine` : (st < 0 ? `↓ ${st} cette semaine` : 'stable'));
  const sslSub = c.ssl ? (c.ssl.valid ? 'vérifié à l\'instant' : (c.ssl.https ? 'à vérifier' : 'non sécurisé (HTTP)')) : '—';
  return `<div class="snt-kpis">
    <div class="snt-kpi"><div class="snt-kpi-l">Disponibilité · 30 j</div><div class="snt-kpi-v">${upTxt}</div><div class="snt-kpi-t">${upTrend}</div></div>
    <div class="snt-kpi"><div class="snt-kpi-l">Score global</div><div class="snt-kpi-v ${score != null ? _scoreClass(score) : ''}">${score != null ? score : '—'}<span>/100</span></div><div class="snt-kpi-t">${scoreTrendTxt}</div></div>
    <div class="snt-kpi"><div class="snt-kpi-l">Chargement (LCP)</div><div class="snt-kpi-v">${lcpTxt}</div><div class="snt-kpi-t">${lcpAssess}</div></div>
    <div class="snt-kpi"><div class="snt-kpi-l">Certificat SSL</div><div class="snt-kpi-v snt-kpi-ssl">${icon('lock', 15)} ${c.ssl && c.ssl.valid ? 'Valide' : (c.ssl && c.ssl.https ? '?' : '—')}</div><div class="snt-kpi-t">${sslSub}</div></div>
  </div>`;
}

// Radar SVG — 7 axes qualité vs « Objectif » (85). Disponibilité = KPI, hors radar.
function _radarSVG(scores, geoScore) {
  const axes = [
    ['Performance', scores.performance], ['SEO technique', scores.seo], ['Mots-clés', null],
    ['Visibilité IA', geoScore], ['Présence locale', scores.presence], ['Sécurité', scores.securite], ['Accessibilité', scores.accessibilite],
  ];
  const N = axes.length, W = 520, H = 380, cx = 260, cy = 188, R = 122, OBJ = 85;
  const ang = (i) => (-Math.PI / 2) + i * (2 * Math.PI / N);
  const pt = (i, val) => { const r = R * Math.max(0, Math.min(100, val || 0)) / 100; return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))]; };
  const poly = (val) => axes.map((_, i) => pt(i, val).map((n) => n.toFixed(1)).join(',')).join(' ');
  let grid = '';
  for (const ring of [25, 50, 75, 100]) grid += `<polygon points="${axes.map((_, i) => pt(i, ring).map((n) => n.toFixed(1)).join(',')).join(' ')}" class="snt-radar-ring"/>`;
  let spokes = '', labels = '', dots = '';
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 100); spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="snt-radar-spoke"/>`;
    const lr = R + 16, lx = cx + lr * Math.cos(ang(i)), ly = cy + lr * Math.sin(ang(i));
    const anchor = Math.abs(lx - cx) < 10 ? 'middle' : (lx < cx ? 'end' : 'start');
    const muted = a[1] == null ? ' snt-radar-lbl-soon' : '';
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" class="snt-radar-lbl${muted}">${a[0]}</text>`;
    if (a[1] != null) { const [dx, dy] = pt(i, a[1]); dots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.2" class="snt-radar-dot"/>`; }
  });
  const sitePts = axes.map((a, i) => pt(i, a[1]).map((n) => n.toFixed(1)).join(',')).join(' ');
  return `<svg class="snt-radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="Radar des axes">
    ${grid}${spokes}
    <polygon points="${poly(OBJ)}" class="snt-radar-obj"/>
    <polygon points="${sitePts}" class="snt-radar-site"/>
    ${dots}${labels}
  </svg>`;
}

// Courbe de temps de réponse sur 30 jours (aire + pic annoté).
function _responseChartSVG(series) {
  if (!series || series.length < 2) return `<div class="snt-dim snt-ck-empty">Pas encore assez de relevés pour la courbe 30 jours.</div>`;
  const W = 720, H = 210, padL = 46, padR = 14, padT = 14, padB = 26;
  const n = series.length;
  const vals = series.map((s) => s.ms || 0);
  const max = Math.max(...vals, 100);
  const niceMax = Math.max(200, Math.ceil(max / 200) * 200);
  const x = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1));
  const y = (v) => padT + (1 - v / niceMax) * (H - padT - padB);
  const line = series.map((s, i) => `${x(i).toFixed(1)},${y(s.ms || 0).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)}`;
  let gl = '';
  for (const gv of [0, niceMax / 2, niceMax]) gl += `<line x1="${padL}" y1="${y(gv).toFixed(1)}" x2="${W - padR}" y2="${y(gv).toFixed(1)}" class="snt-ch-grid"/><text x="${padL - 8}" y="${(y(gv) + 4).toFixed(1)}" text-anchor="end" class="snt-ch-axis">${gv} ms</text>`;
  const ticks = [0, Math.floor(n / 2), n - 1].filter((v, idx, arr) => arr.indexOf(v) === idx);
  let xl = ''; for (const ti of ticks) xl += `<text x="${x(ti).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="snt-ch-axis">J${ti + 1}</text>`;
  const peakI = vals.indexOf(max);
  const peak = `<circle cx="${x(peakI).toFixed(1)}" cy="${y(max).toFixed(1)}" r="3.6" class="snt-ch-peak"/>`;
  return `<svg class="snt-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Temps de réponse 30 jours">
    ${gl}<polygon points="${area}" class="snt-ch-area"/><polyline points="${line}" class="snt-ch-line"/>${peak}${xl}
  </svg>`;
}

function _historyHTML(hist) {
  if (!hist || hist.length < 2) return `<div class="snt-dim" style="padding:10px 2px">Pas encore d'historique — relancez l'audit régulièrement pour suivre la progression du score.</div>`;
  const W = 320, H = 56, pad = 4;
  const vals = hist.map((h) => (h.score == null ? 0 : h.score));
  const n = vals.length, x = (i) => pad + (n === 1 ? 0 : i * (W - 2 * pad) / (n - 1)), y = (v) => H - pad - (v / 100) * (H - 2 * pad);
  const line = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" class="snt-radar-dot"/>`).join('');
  const last = hist[hist.length - 1], first = hist[0];
  return `<div class="snt-hist"><div class="snt-hist-h">Historique du score · ${hist.length} audits</div>
    <svg class="snt-hist-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${line}" class="snt-ch-line"/>${dots}</svg>
    <div class="snt-hist-foot">${_esc((first.at || '').slice(0, 10))} : ${first.score ?? '—'} → ${_esc((last.at || '').slice(0, 10))} : ${last.score ?? '—'}</div></div>`;
}
function _historyToggle() { const h = _root && _root.querySelector('#snt-ck-history'); if (h) h.hidden = !h.hidden; }

// ── Ouverture / chargement / rendu du cockpit ───────────────────
async function _openCockpit(id) {
  _panel = { id, loading: true };
  _renderCockpit();
  await _loadCockpit(id);
}
async function _loadCockpit(id, opts = {}) {
  try {
    let d = await _api(`/sites/${encodeURIComponent(id)}/cockpit`);
    let c = d.cockpit;
    if (c && !c.audit && !opts.noAutoRun) {
      _panel = { id, name: (c.site && (c.site.label || _hostOf(c.site.url))) || 'Site', ...c, auditing: true };
      _renderCockpit();
      try { await _api(`/sites/${encodeURIComponent(id)}/audit`, { method: 'POST', timeout: 70000 }); d = await _api(`/sites/${encodeURIComponent(id)}/cockpit`); c = d.cockpit; } catch (_) {}
      _load(true);
    }
    const site = _sites.find((s) => s.id === id);
    const name = (c && c.site && (c.site.label || _hostOf(c.site.url))) || (site ? (site.label || _hostOf(site.url)) : 'Site');
    _panel = { id, name, ...c,
      // aplati pour la rétro-compat (PDF, GEO) :
      geo: c ? c.geo : null,
      score: (c && c.audit) ? c.audit.score : null,
      scores: (c && c.audit) ? c.audit.scores : {},
      findings: (c && c.audit) ? c.audit.findings : [],
      cwv: (c && c.audit) ? c.audit.cwv : null,
      platform: (c && c.site) ? c.site.platform : null,
    };
    _renderCockpit();
  } catch (e) {
    _panel = { id, error: e.message || 'Chargement impossible.' };
    _renderCockpit();
  }
}
async function _relaunchAudit() {
  if (!_panel || !_panel.id || _panel.auditing) return;
  _panel.auditing = true; _renderCockpit();
  try { await _api(`/sites/${encodeURIComponent(_panel.id)}/audit`, { method: 'POST', timeout: 70000 }); }
  catch (e) { alert(e.message || 'Audit impossible.'); }
  await _loadCockpit(_panel.id, { noAutoRun: true });
  _load(true);
}
function _closePanel() { _panel = null; const el = _root && _root.querySelector('.snt-overlay'); if (el) el.remove(); }
function _renderCockpit() {
  if (!_root) return;
  let el = _root.querySelector('.snt-overlay');
  if (!el) { el = document.createElement('div'); el.className = 'snt-overlay'; el.addEventListener('click', (e) => { if (e.target === el) _closePanel(); }); _root.appendChild(el); }
  const p = _panel; if (!p) { el.remove(); return; }
  const closeBtn = `<button class="snt-icon" data-act="panel-close" aria-label="Fermer">${icon('x', 18)}</button>`;
  if (p.loading) { el.innerHTML = `<div class="snt-cockpit"><div class="snt-ck-head"><div class="snt-ck-title">${_esc(p.name || 'Site')}</div>${closeBtn}</div><div class="snt-state">${icon('refresh', 26)}<p>${p.auditing ? 'Premier audit en cours…' : 'Chargement du cockpit…'}</p></div></div>`; return; }
  if (p.error) { el.innerHTML = `<div class="snt-cockpit"><div class="snt-ck-head"><div class="snt-ck-title">${_esc(p.name || 'Site')}</div>${closeBtn}</div><div class="snt-state snt-state-err">${icon('x', 26)}<p>${_esc(p.error)}</p><button class="snt-btn" data-act="ck-retry">Réessayer</button></div></div>`; return; }
  const c = p, site = c.site || {}, a = c.audit || {}, host = _hostOf(site.url);
  const next = c.site && c.site.next_check_at ? `<span class="snt-ck-next">${icon('clock', 12)} prochaine vérification ${_until(c.site.next_check_at)}</span>` : '';
  el.innerHTML = `
    <div class="snt-cockpit">
      <div class="snt-ck-head">
        <div class="snt-ck-headl">
          <div class="snt-ck-title">${_esc(site.label || host || p.name)}</div>
          <div class="snt-ck-sub"><a href="${_esc(site.url || '#')}" target="_blank" rel="noopener">${_esc(host)} ${icon('external-link', 12)}</a>${site.platform ? ' · ' + _esc(PLATFORM_LABEL[site.platform] || site.platform) : ''} · ${site.last_ok ? '<span class="snt-ck-on">en ligne</span>' : '<span class="snt-ck-off">hors ligne</span>'}</div>
        </div>
        <div class="snt-ck-actions">
          <button class="snt-mini" data-act="history">${icon('history', 13)} Historique</button>
          <button class="snt-mini" data-act="relaunch"${c.auditing ? ' disabled' : ''}>${icon('refresh', 13)} ${c.auditing ? 'Audit…' : 'Relancer l\'audit'}</button>
          ${_emailEnabled ? `<button class="snt-mini" data-act="email-toggle">${icon('mail', 13)} Webmaster</button>` : ''}
          <button class="snt-mini" data-act="pdf">${icon('download', 13)} PDF</button>
          ${closeBtn}
        </div>
      </div>
      ${_kpiCardsHTML(c)}
      <div class="snt-ck-grid">
        <div class="snt-ck-panel">
          <div class="snt-ck-panel-h"><span>Profil du site</span><span class="snt-radar-leg"><i class="snt-radar-leg-site"></i> Ton site${a.score != null ? ' · ' + a.score + '/100' : ''} &nbsp; <i class="snt-radar-leg-obj"></i> Objectif</span></div>
          ${_radarSVG(a.scores || {}, (c.geo && c.geo.score != null) ? c.geo.score : null)}
        </div>
        <div class="snt-ck-panel">
          <div class="snt-ck-panel-h"><span>Temps de réponse — 30 jours</span>${next}</div>
          ${_responseChartSVG(c.series30d)}
        </div>
      </div>
      <div id="snt-ck-history" hidden>${_historyHTML(c.scoreHistory)}</div>
      ${a.findings ? _findingsHTML(a.findings, site.platform) : `<div class="snt-okmsg">${icon('search', 16)} <button class="snt-link-btn" data-act="relaunch">Lancer le premier audit</button> pour obtenir le score et les correctifs.</div>`}
      ${_geoSectionHTML()}
      ${_aeoCardHTML()}
      ${_emailEnabled ? _emailRowHTML() : ''}
    </div>
  `;
}
// ── S5 · Visibilité IA (GEO) — section du panneau d'audit ────────
function _geoDefault() {
  const s = _panel && _sites.find((x) => x.id === _panel.id);
  const name = (s ? (s.label || _hostOf(s.url)) : (_panel && _panel.name)) || '';
  return { business_name: name, city: '', activity: '', prompts: [], score: null, results: null };
}
function _geoSectionHTML() {
  if (!_geoEnabled) return '';
  const g = (_panel && _panel.geo) || _geoDefault();
  return `<div class="snt-geo" id="snt-geo-sec">${_geoBody(g)}</div>`;
}
function _geoBody(g) {
  const head = `<div class="snt-aeo-head">${icon('compass', 18)}<div><div class="snt-aeo-t">Visibilité dans les IA (GEO)</div><div class="snt-aeo-d">Quand un prospect interroge une IA, votre établissement ressort-il ? On pose la question à plusieurs IA connectées au web (Gemini, Perplexity, ChatGPT) et on mesure si vous êtes cité.</div></div></div>`;
  const hasResults = g && g.results && g.results.length;
  if (hasResults) {
    return head + _geoResultsHTML(g)
      + `<div class="snt-geo-actions"><button class="snt-ai-btn" data-act="geo-run">${icon('refresh', 13)} Relancer la mesure</button><button class="snt-ai-regen" data-act="geo-edit">${icon('edit', 12)} Modifier</button></div>`
      + `<div id="snt-geo-form" hidden>${_geoFormHTML(g)}</div>`;
  }
  return head + _geoFormHTML(g);
}
const _GEO_ENGINE_LABEL = { gemini: 'Gemini', perplexity: 'Perplexity', gpt: 'ChatGPT' };
// Normalise une ligne de résultat → tableau de cellules par moteur (tolère l'ancien format mono-moteur).
function _geoCells(r) {
  if (r && Array.isArray(r.engines)) return r.engines;
  if (r && (r.cited !== undefined || r.error !== undefined)) return [{ engine: 'gemini', cited: r.cited, rank: r.rank, sourced: r.sourced, snippet: r.snippet, error: r.error }];
  return [];
}
function _geoCellBadge(c) {
  const name = _GEO_ENGINE_LABEL[c.engine] || c.engine || 'IA';
  if (c.error) return `<span class="snt-geo-b x">${_esc(name)} · échec</span>`;
  if (c.cited) {
    const sent = c.sentiment === 'positive' ? ' · positif' : (c.sentiment === 'negative' ? ' · négatif' : '');
    return `<span class="snt-geo-b ok">${icon('check', 11)} ${_esc(name)}${c.rank ? ' · n°' + c.rank : ''}${sent}</span>`;
  }
  if (c.sourced) return `<span class="snt-geo-b mid">${_esc(name)} · source citée</span>`;
  return `<span class="snt-geo-b no">${_esc(name)} · non cité</span>`;
}
function _geoResultsHTML(g) {
  const sc = g.score;
  const enginesUsed = (Array.isArray(g.engines) && g.engines.length) ? g.engines : null;
  const legend = enginesUsed ? `<div class="snt-geo-legend">Moteurs interrogés : ${enginesUsed.map((e) => _esc(_GEO_ENGINE_LABEL[e] || e)).join(' · ')}</div>` : '';
  const rows = (g.results || []).map((r) => {
    const cells = _geoCells(r);
    const badges = cells.map(_geoCellBadge).join('');
    const repr = cells.find((c) => c.cited && c.snippet) || cells.find((c) => c.snippet && !c.error);
    return `<div class="snt-geo-row"><div class="snt-geo-q">${_esc(r.prompt)}</div><div class="snt-geo-engines">${badges}</div>${(repr && repr.snippet) ? `<div class="snt-geo-snip">${_esc(repr.snippet)}</div>` : ''}</div>`;
  }).join('');
  // Pont AEO→GEO : citabilité faible → proposer la génération FAQ (générateur S4.1, carte ci-dessous).
  const weak = (sc != null && sc < 70) || (g.results || []).some((r) => _geoCells(r).some((c) => !c.error && !c.cited));
  const cta = weak ? `<div class="snt-geo-cta">${icon('sparkles', 14)}<span>Pas assez cité ? Une FAQ structurée aide les IA à vous citer. <button class="snt-link-btn" data-act="suggest" data-kind="faq" data-slot="snt-ai-faq">Rédiger la FAQ avec l'IA</button> (apparaît juste en dessous).</span></div>` : '';
  return `<div class="snt-geo-scorewrap"><div class="snt-geo-score ${sc != null ? _scoreClass(sc) : ''}">${sc != null ? sc : '—'}<span>/100</span></div><div class="snt-geo-scorelbl">score de citabilité IA${g.run_at ? ' · ' + _ago(g.run_at) : ''}</div></div>${legend}<div class="snt-geo-rows">${rows}</div>${cta}`;
}
function _geoFormHTML(g) {
  const prompts = (g.prompts || []).join('\n');
  return `<div class="snt-geo-form">
    <label class="snt-geo-l">Nom de l'établissement<input class="snt-input" id="snt-geo-name" type="text" value="${_esc(g.business_name || '')}" placeholder="Ex. Boulangerie Martin"></label>
    <div class="snt-geo-two">
      <label class="snt-geo-l">Ville<input class="snt-input" id="snt-geo-city" type="text" value="${_esc(g.city || '')}" placeholder="Ex. Lyon"></label>
      <label class="snt-geo-l">Activité<input class="snt-input" id="snt-geo-act" type="text" value="${_esc(g.activity || '')}" placeholder="Ex. boulangerie artisanale"></label>
    </div>
    <label class="snt-geo-l">Questions testées <span class="snt-geo-hint">(une par ligne · max 5)</span><textarea class="snt-input snt-geo-ta" id="snt-geo-prompts" rows="3" placeholder="Une question de prospect par ligne">${_esc(prompts)}</textarea></label>
    <button class="snt-btn snt-btn-sm" data-act="geo-run">${icon('compass', 14)} Mesurer ma visibilité IA</button>
  </div>`;
}
function _geoEditToggle() { const f = _root && _root.querySelector('#snt-geo-form'); if (f) f.hidden = !f.hidden; }
async function _geoRun() {
  if (!_panel || !_panel.id) return;
  const sec = _root && _root.querySelector('#snt-geo-sec');
  const body = {};
  const nameEl = _root && _root.querySelector('#snt-geo-name');
  if (nameEl) {
    body.business_name = (nameEl.value || '').trim();
    const cityEl = _root.querySelector('#snt-geo-city'); body.city = cityEl ? cityEl.value.trim() : '';
    const actEl = _root.querySelector('#snt-geo-act'); body.activity = actEl ? actEl.value.trim() : '';
    const pEl = _root.querySelector('#snt-geo-prompts'); if (pEl) body.prompts = pEl.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!body.business_name) { alert("Indiquez le nom de l'établissement."); return; }
  }
  if (sec) sec.innerHTML = `<div class="snt-ai-load">${icon('refresh', 14)} Mesure en cours — l'IA interroge le web…</div>`;
  try {
    const d = await _api(`/sites/${encodeURIComponent(_panel.id)}/geo/run`, { method: 'POST', body, timeout: 90000 });
    _panel.geo = Object.assign({}, _panel.geo, d.geo);
    _renderCockpit();
    const s2 = _root && _root.querySelector('#snt-geo-sec'); if (s2 && s2.scrollIntoView) try { s2.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  } catch (e) {
    if (sec) sec.innerHTML = `<div class="snt-ai-err">${icon('x', 13)} ${_esc(e.message || 'Mesure impossible.')}</div><button class="snt-ai-regen" data-act="geo-run">${icon('refresh', 12)} Réessayer</button>`;
  }
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
// ── Interactions ────────────────────────────────────────────────
function _onClick(e) {
  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'close')       return closeSentinel();
  if (a === 'reload')      return _load();
  if (a === 'del')         return _delSite(act.dataset.id);
  if (a === 'check')       return _checkNow(act.dataset.id);
  if (a === 'audit')       return _openCockpit(act.dataset.id);
  if (a === 'score')       return _openCockpit(act.dataset.id);
  if (a === 'relaunch')    return _relaunchAudit();
  if (a === 'history')     return _historyToggle();
  if (a === 'ck-retry')    return (_panel && _panel.id) ? _openCockpit(_panel.id) : null;
  if (a === 'alerts')      return _toggleAlerts();
  if (a === 'panel-close') return _closePanel();
  if (a === 'pdf')         return _exportPdf();
  if (a === 'copy')        return _copyCode(act.dataset.target, act);
  if (a === 'suggest')     return _suggestAI(act.dataset.kind, act.dataset.slot);
  if (a === 'email-toggle') return _toggleEmailForm();
  if (a === 'send-report') return _sendReport();
  if (a === 'geo-run')     return _geoRun();
  if (a === 'geo-edit')    return _geoEditToggle();
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
