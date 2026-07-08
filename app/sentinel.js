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
  { k: 'keywords',      label: 'Mots-clés' },   // V2 — Search Console (positions Google réelles)
];
const SOON_AXES = [];
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
  // Handoff (ex. networK → « Auditer un site ») : pré-remplit le champ d'ajout.
  if (opts && opts.prefillUrl) _prefillAddUrl(String(opts.prefillUrl));
}
// Le formulaire d'ajout est toujours rendu en tête de liste ; on attend qu'il
// existe (après le _load async) puis on injecte l'URL et on donne le focus.
function _prefillAddUrl(url) {
  let tries = 0;
  const set = () => {
    const i = _root && _root.querySelector('.snt-add [name="url"]');
    if (i) { i.value = url; try { i.focus(); } catch (_) {} return; }
    if (++tries < 12) setTimeout(set, 120);
  };
  set();
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
// Parse robuste : accepte le format SQLite ("YYYY-MM-DD HH:MM:SS", UTC sans zone)
// ET l'ISO complet ("…T…Z") — sans rajouter un Z en trop (bug d'horodatage vide).
function _parseTs(iso) {
  if (!iso) return NaN;
  let s = String(iso).trim();
  if (s.indexOf('T') === -1) s = s.replace(' ', 'T');
  if (!/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
  return Date.parse(s);
}
function _ago(iso) {
  if (!iso) return '';
  const t = _parseTs(iso); if (isNaN(t)) return '';
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

  // Ergonomie 2026-07 (maquette Stéphane) : l'AJOUT vit en haut — champ URL
  // à liseré accent qu'on ne cherche plus — puis un trait fin sépare la
  // surveillance, pour ne rien mélanger.
  main.innerHTML = `
    <div class="snt-wrap">
      ${_addBlock(atLimit, limitTxt)}
      <div class="snt-sep" role="separator"></div>
      <div class="snt-head">
        <div>
          <h1 class="snt-title">Sites surveillés</h1>
          <p class="snt-sub"><span class="snt-live"></span>Surveillance active · ${_sites.length} / ${limitTxt} site${_limit > 1 ? 's' : ''} · plan ${_esc(_plan || '—')}</p>
        </div>
        ${_alertsBtn()}
      </div>
      ${list}
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
  const followed = _isFollowedSite(s.id);
  return `
    <div class="snt-card">
      <div class="snt-card-top">
        <span class="snt-dot ${st.cls}"></span>
        <span class="snt-host">${_esc(s.label || host)}</span>
        ${s.last_score != null ? `<button class="snt-score ${_scoreClass(s.last_score)}" data-act="score" data-id="${id}" title="Voir le dernier audit">${s.last_score}</button>` : ''}
        <button class="snt-icon" data-act="follow" data-id="${id}" aria-label="${followed ? 'Ne plus suivre' : 'Suivre sur le tableau de bord'}" title="${followed ? 'Ne plus suivre sur le tableau de bord' : 'Suivre sur le tableau de bord'}"${followed ? ' style="color:#6c6cf5"' : ''}>${icon('pin', 16)}</button>
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
    <form class="snt-add snt-add-top" data-form="add">
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
  const t = _parseTs(iso); if (isNaN(t)) return '';
  const s = Math.round((t - Date.now()) / 1000);
  if (s <= 0) return 'imminente'; if (s < 60) return `dans ${s} s`;
  const m = Math.floor(s / 60); return `dans ${m} min`;
}

// V2 crawl — pages concernées par un finding (masqué si seulement la home).
function _findPages(f) {
  if (!f.pages || !f.pages.length || (f.pages.length === 1 && f.pages[0] === '/')) return '';
  const shown = f.pages.slice(0, 6).map((p) => `<code>${_esc(p)}</code>`).join(' ');
  const more = f.pages.length > 6 ? ` +${f.pages.length - 6}` : '';
  return `<div class="snt-find-pages">${f.pages.length} page${f.pages.length > 1 ? 's' : ''} concernée${f.pages.length > 1 ? 's' : ''} : ${shown}${more}</div>`;
}
// V2 crawl — bandeau « pages auditées » (score par page), masqué si une seule page.
function _pagesAuditedHTML(c) {
  const pages = c && c.audit && c.audit.pages;
  if (!pages || pages.length <= 1) return '';
  const chips = pages.map((p) => `<span class="snt-page-chip"><span class="snt-page-path">${_esc(p.path)}</span><span class="snt-page-score ${p.score != null ? _scoreClass(p.score) : ''}">${p.score != null ? p.score : '—'}</span></span>`).join('');
  return `<div class="snt-pages"><div class="snt-pages-h">${icon('search', 14)} ${pages.length} pages auditées · score par page</div><div class="snt-pages-list">${chips}</div></div>`;
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
      ${_findPages(f)}
      ${body}
    </details>`;
  }).join('') + `</div>`;
}

// Énumération « à la française » : « a, b et c ».
function _joinFr(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' et ' + arr[arr.length - 1];
}
// ── Synthèse « En clair » — traduit les résultats en phrases simples ─────
// Déterministe (aucune IA, aucun coût) : lit les données déjà calculées du
// cockpit et les met en mots, pour les utilisateurs qui ne lisent pas les
// scores. Priorisé, avec un code couleur vert / orange / rouge. La LOGIQUE
// est ici (`_summaryData`) ; deux rendus en dépendent (écran + PDF).
function _summaryData(c) {
  const a = c.audit || {};
  const sc = a.scores || {};
  const score = a.score;
  if (score == null) return null;   // pas encore d'audit → le bouton « lancer le premier audit » suffit
  const points = [];
  const add = (cls, html) => points.push({ cls, html });

  // Verdict global (phrase + badge de score).
  const vcls = score >= 70 ? 'good' : (score >= 50 ? 'warn' : 'bad');
  const vtxt = score >= 85 ? 'Votre site est solide sur l\'ensemble des points vérifiés.'
    : score >= 70 ? 'Bon ensemble — quelques améliorations sont possibles, rien d\'urgent.'
    : score >= 50 ? 'Correct, mais plusieurs points méritent votre attention.'
    : 'Plusieurs corrections sont à prévoir en priorité.';

  // Disponibilité (le visiteur a-t-il pu accéder au site ?).
  if (c.uptime30d != null) {
    const u = String(c.uptime30d).replace('.', ',');
    if (c.uptime30d >= 99.5) add('good', `Votre site a été accessible <b>${u} %</b> du temps sur 30 jours — excellent.`);
    else if (c.uptime30d >= 98) add('warn', `Votre site a été accessible ${u} % du temps sur 30 jours — quelques interruptions.`);
    else add('bad', `Votre site n'a été joignable que ${u} % du temps sur 30 jours — des coupures à investiguer.`);
  }

  // Sécurité (HTTPS).
  if (c.ssl) {
    if (c.ssl.valid || c.ssl.https) add('good', 'La connexion est <b>sécurisée</b> (HTTPS) : les échanges sont chiffrés.');
    else add('bad', 'Votre site n\'est <b>pas en HTTPS</b> : à corriger en priorité (sécurité et confiance).');
  }

  // Vitesse d'affichage (LCP).
  const lcp = a.cwv && a.cwv.lcp;
  if (lcp != null && lcp > 0) {
    const s = (lcp / 1000).toFixed(1).replace('.', ',');
    if (lcp <= 2500) add('good', `Vos pages s'affichent vite (${s} s) — bonne expérience pour le visiteur.`);
    else if (lcp <= 4000) add('warn', `Vos pages mettent ${s} s à s'afficher — un peu lent, à optimiser.`);
    else add('bad', `Vos pages sont lentes à s'afficher (${s} s) — cela fait fuir des visiteurs.`);
  }

  // Forces / faiblesses sur les axes qualité.
  const QUAL = [['performance', 'la vitesse'], ['seo', 'le référencement technique'], ['securite', 'la sécurité'], ['accessibilite', 'l\'accessibilité'], ['presence', 'la présence locale']];
  const strong = QUAL.filter(([k]) => sc[k] != null && sc[k] >= 80).map(([, l]) => l);
  const weak = QUAL.filter(([k]) => sc[k] != null && sc[k] < 60).map(([, l]) => l);
  if (strong.length) add('good', `Points forts : ${_joinFr(strong)}.`);
  if (weak.length) add('warn', `À renforcer : ${_joinFr(weak)}.`);

  // Correctifs prioritaires (renvoie vers la liste clé en main ci-dessous).
  const highN = (a.findings || []).filter((f) => f.sev === 'high').length;
  if (highN) add('bad', `${highN} correctif${highN > 1 ? 's' : ''} prioritaire${highN > 1 ? 's' : ''} ${highN > 1 ? 'sont détaillés' : 'est détaillé'} plus bas, avec la marche à suivre prête à appliquer.`);
  // Wix — sous-domaine gratuit : call-out dédié (le piège SEO n°1 sur Wix).
  if ((a.findings || []).some((f) => f.key === 'wix_subdomain')) add('bad', 'Votre site est sur une adresse Wix gratuite (…wixsite.com) : un nom de domaine personnalisé améliorerait nettement votre référencement et votre crédibilité.');

  // Visibilité dans les IA (GEO).
  if (c.geo && c.geo.score != null) {
    const g = c.geo.score;
    if (g >= 70) add('good', `Visibilité dans les IA : bonne (${g}/100) — vous êtes cité quand un prospect interroge une IA.`);
    else add('warn', `Visibilité dans les IA faible (${g}/100) : vous êtes peu ou pas cité par les IA. La FAQ structurée ci-dessus aide à y remédier.`);
  }

  // Mots-clés Google (Search Console).
  if (c.gsc && c.gsc.connected) {
    const t = (c.gsc.results || {}).totals || {};
    if (t.impressions > 0) add(c.gsc.score >= 60 ? 'good' : 'warn', `Sur Google : vous êtes apparu <b>${t.impressions}</b> fois${t.position != null ? ` (position moyenne ${String(t.position).replace('.', ',')})` : ''} ces 28 jours, pour ${t.clicks || 0} clic${(t.clicks || 0) > 1 ? 's' : ''}.`);
    else add('warn', 'Search Console connectée : Google n\'a pas encore assez de données (revenez dans 1 à 2 jours).');
  }

  return { score, vtxt, points };
}
// Rendu ÉCRAN (classes CSS du cockpit, thème sombre).
function _summaryHTML(c) {
  const d = _summaryData(c);
  if (!d) return '';
  const ICO = { good: 'check', warn: 'alert-triangle', bad: 'x' };
  const lis = d.points.map((p) => `<li class="${p.cls}">${icon(ICO[p.cls], 14)}<span>${p.html}</span></li>`).join('');
  return `<div class="snt-summary">
    <div class="snt-summary-head">${icon('sparkles', 16)} En clair — ce que disent ces résultats</div>
    <div class="snt-summary-verdict"><span class="snt-summary-score ${_scoreClass(d.score)}">${d.score}<i>/100</i></span><span>${_esc(d.vtxt)}</span></div>
    <ul class="snt-summary-points">${lis}</ul>
  </div>`;
}
// Rendu PDF (styles inline, thème clair) — même synthèse, en tête du rapport.
function _summaryPdf(p) {
  const d = _summaryData(p);
  if (!d) return '';
  const dot = { good: '#16a34a', warn: '#d97706', bad: '#dc2626' };
  const scCol = d.score >= 80 ? '#16a34a' : (d.score >= 50 ? '#d97706' : '#dc2626');
  const lis = d.points.map((pt) => `<tr><td style="vertical-align:top;padding:3px 8px 3px 0;color:${dot[pt.cls] || '#64748b'};font-weight:800;line-height:1.45">●</td><td style="padding:3px 0;font-size:13px;color:#334155;line-height:1.45">${pt.html}</td></tr>`).join('');
  return `<div style="margin:14px 0 4px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
    <div style="font-size:12px;font-weight:800;color:#6366f1;letter-spacing:.04em;margin-bottom:8px">EN CLAIR — CE QUE DISENT CES RÉSULTATS</div>
    <div style="font-size:14px;color:#0f172a;margin-bottom:10px"><b style="font-size:20px;color:${scCol}">${d.score}</b><span style="font-size:12px;color:#94a3b8">/100</span> &nbsp;${_esc(d.vtxt)}</div>
    <table style="width:100%;border-collapse:collapse">${lis}</table>
  </div>`;
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
function _radarSVG(scores, geoScore, gscScore) {
  const axes = [
    ['Performance', scores.performance], ['SEO technique', scores.seo], ['Mots-clés', (gscScore != null ? gscScore : null)],
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

// Date « JJ/MM » à partir d'un datetime SQLite (browser → new Date OK).
function _fmtDay(at) {
  const s = String(at || '');
  try { const d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')); if (!isNaN(d)) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }); } catch (_) {}
  const m = s.slice(0, 10).split('-'); return m.length === 3 ? `${m[2]}/${m[1]}` : s.slice(0, 10);
}
const _HIST_AXES = [
  { key: 'performance', label: 'Performance' }, { key: 'seo', label: 'SEO technique' },
  { key: 'securite', label: 'Sécurité' }, { key: 'accessibilite', label: 'Accessibilité' },
  { key: 'presence', label: 'Présence locale' },
];
// Mini-graphe gradué (repère 50) d'une jauge dans le temps.
function _miniGauge(series) {
  const W = 140, H = 42, padL = 4, padR = 4, padT = 5, padB = 5, n = series.length;
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1));
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const grid = [0, 50, 100].map((g) => `<line x1="${padL}" y1="${y(g).toFixed(1)}" x2="${W - padR}" y2="${y(g).toFixed(1)}" class="snt-mg-grid"/>`).join('');
  const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dot = n ? `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(series[n - 1]).toFixed(1)}" r="2.6" class="snt-radar-dot"/>` : '';
  return `<svg class="snt-mg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}<polyline points="${line}" class="snt-ch-line"/>${dot}</svg>`;
}
function _historyHTML(hist) {
  if (!hist || !hist.length) return `<div class="snt-dim" style="padding:10px 2px">Aucun audit encore. Lancez un audit pour démarrer l'historique.</div>`;
  const pts = hist.map((h) => ({ at: h.at, v: (h.score == null ? null : h.score) })).filter((p) => p.v != null);
  const n = pts.length;
  // — Graphe gradué du score global —
  const W = 720, H = 200, padL = 30, padR = 14, padT = 14, padB = 24;
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1));
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  let gl = '';
  for (const gv of [0, 25, 50, 75, 100]) gl += `<line x1="${padL}" y1="${y(gv).toFixed(1)}" x2="${W - padR}" y2="${y(gv).toFixed(1)}" class="snt-ch-grid"/><text x="${padL - 7}" y="${(y(gv) + 4).toFixed(1)}" text-anchor="end" class="snt-ch-axis">${gv}</text>`;
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = n > 1 ? `${x(0).toFixed(1)},${y(0).toFixed(1)} ${line} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)}` : '';
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" class="snt-radar-dot"/>`).join('');
  const ticks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])].filter((i) => i >= 0 && i < n);
  let xl = ''; for (const ti of ticks) xl += `<text x="${x(ti).toFixed(1)}" y="${H - 6}" text-anchor="${ti === 0 ? 'start' : ti === n - 1 ? 'end' : 'middle'}" class="snt-ch-axis">${_esc(_fmtDay(pts[ti].at))}</text>`;
  const delta = n > 1 ? pts[n - 1].v - pts[0].v : 0;
  const deltaBadge = n > 1 ? `<span class="snt-hist-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta > 0 ? '+' : ''}${delta} pts</span>` : '';
  const chart = n ? `<svg class="snt-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Historique du score global">${gl}${area ? `<polygon points="${area}" class="snt-ch-area"/>` : ''}<polyline points="${line}" class="snt-ch-line"/>${dots}${xl}</svg>` : '';
  // — Mini-historique par axe (jauges) —
  const cards = _HIST_AXES.map((ax) => {
    const s = hist.map((h) => (h.scores && typeof h.scores[ax.key] === 'number') ? h.scores[ax.key] : null).filter((v) => v != null);
    if (!s.length) return '';
    const cur = s[s.length - 1], d = s.length > 1 ? cur - s[0] : 0;
    return `<div class="snt-axhist"><div class="snt-axhist-top">${icon(_AXIS_ICON[ax.key] || 'circle', 13)}<span class="snt-axhist-l">${ax.label}</span><span class="snt-axhist-v">${cur}</span>${s.length > 1 ? `<span class="snt-axhist-d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</span>` : ''}</div>${_miniGauge(s)}</div>`;
  }).filter(Boolean).join('');
  return `<div class="snt-hist">
    <div class="snt-hist-h">Score global · ${hist.length} audit${hist.length > 1 ? 's' : ''} ${deltaBadge}</div>
    ${chart}
    ${n < 2 ? `<div class="snt-dim" style="margin-top:4px">Relancez l'audit régulièrement pour voir la tendance.</div>` : ''}
    ${cards ? `<div class="snt-axhist-h">Historique par axe</div><div class="snt-axhist-grid">${cards}</div>` : ''}
  </div>`;
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
      ${_summaryHTML(c)}
      ${_kpiCardsHTML(c)}
      <div class="snt-ck-grid">
        <div class="snt-ck-panel">
          <div class="snt-ck-panel-h"><span>Profil du site</span><span class="snt-radar-leg"><i class="snt-radar-leg-site"></i> Ton site${a.score != null ? ' · ' + a.score + '/100' : ''} &nbsp; <i class="snt-radar-leg-obj"></i> Objectif</span></div>
          ${_radarSVG(a.scores || {}, (c.geo && c.geo.score != null) ? c.geo.score : null, (c.gsc && c.gsc.connected && c.gsc.score != null) ? c.gsc.score : null)}
        </div>
        <div class="snt-ck-panel">
          <div class="snt-ck-panel-h"><span>Temps de réponse — 30 jours</span>${next}</div>
          ${_responseChartSVG(c.series30d)}
        </div>
      </div>
      ${_pagesAuditedHTML(c)}
      <div id="snt-ck-history" hidden>${_historyHTML(c.scoreHistory)}</div>
      ${a.findings ? _findingsHTML(a.findings, site.platform) : `<div class="snt-okmsg">${icon('search', 16)} <button class="snt-link-btn" data-act="relaunch">Lancer le premier audit</button> pour obtenir le score et les correctifs.</div>`}
      ${_geoSectionHTML()}
      ${_aeoCardHTML()}
      ${_gscSectionHTML()}
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
  // Toujours rendu : le mode MANUEL (copier-coller) est gratuit et marche sans
  // clé. Le mode AUTO (un clic) n'apparaît que si une clé moteur est câblée.
  const g = (_panel && _panel.geo) || _geoDefault();
  return `<div class="snt-geo" id="snt-geo-sec">${_geoBody(g)}</div>`;
}
function _geoBody(g) {
  const head = `<div class="snt-aeo-head">${icon('compass', 18)}<div><div class="snt-aeo-t">Visibilité dans les IA (GEO)</div><div class="snt-aeo-d">Quand un prospect interroge une IA, votre établissement ressort-il ? Mesurez-le ${_geoEnabled ? 'en un clic (auto) ou ' : ''}gratuitement à la main : on analyse si vous êtes cité, et à quel rang.</div></div></div>`;
  const manualBtn = `<button class="snt-ai-regen" data-act="geo-manual-toggle">${icon('compass', 12)} Tester à la main (gratuit)</button>`;
  const manualPanel = `<div id="snt-geo-manual" hidden>${_geoManualHTML(g)}</div>`;
  const hasResults = g && g.results && g.results.length;
  if (hasResults) {
    const auto = _geoEnabled ? `<button class="snt-ai-btn" data-act="geo-run">${icon('refresh', 13)} Relancer (auto)</button>` : '';
    return head + _geoResultsHTML(g)
      + `<div class="snt-geo-actions">${auto}${manualBtn}<button class="snt-ai-regen" data-act="geo-edit">${icon('edit', 12)} Modifier</button></div>`
      + `<div id="snt-geo-form" hidden>${_geoFormHTML(g)}</div>`
      + manualPanel;
  }
  return head + _geoFormHTML(g) + manualPanel;
}
const _GEO_ENGINE_LABEL = { gemini: 'Gemini', perplexity: 'Perplexity', gpt: 'ChatGPT', autre: 'IA' };
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
// Nettoie un extrait de réponse IA : retire le markdown brut (###, **, `, puces).
function _cleanSnippet(s) {
  return String(s || '')
    .replace(/```[a-z]*/gi, '')
    .replace(/^\s*#{1,6}\s*/gm, '').replace(/#{1,6}\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ').trim();
}
function _geoResultsHTML(g) {
  const sc = g.score;
  const enginesUsed = (Array.isArray(g.engines) && g.engines.length) ? g.engines : null;
  const legend = enginesUsed ? `<div class="snt-geo-legend">Moteurs interrogés : ${enginesUsed.map((e) => _esc(_GEO_ENGINE_LABEL[e] || e)).join(' · ')}</div>` : '';
  const rows = (g.results || []).map((r) => {
    const cells = _geoCells(r);
    const badges = cells.map(_geoCellBadge).join('');
    const repr = cells.find((c) => c.cited && c.snippet) || cells.find((c) => c.snippet && !c.error);
    let snip = '';
    if (repr && repr.snippet) { snip = _cleanSnippet(repr.snippet); if (String(repr.snippet).length >= 278 && snip) snip += '…'; }
    return `<div class="snt-geo-row"><div class="snt-geo-q">${_esc(r.prompt)}</div><div class="snt-geo-engines">${badges}</div>${snip ? `<div class="snt-geo-snip">${_esc(snip)}</div>` : ''}</div>`;
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
    <div class="snt-geo-formbtns">
      <button class="snt-btn snt-btn-sm snt-btn-ghost" data-act="geo-save">${icon('check', 14)} Enregistrer</button>
      ${_geoEnabled ? `<button class="snt-btn snt-btn-sm" data-act="geo-run">${icon('compass', 14)} Mesurer (auto)</button>` : ''}
      <button class="snt-ai-regen" data-act="geo-manual-toggle">${icon('compass', 12)} Tester à la main (gratuit)</button>
    </div>
  </div>`;
}
// ── Mode MANUEL (gratuit) : bloc-prompt à coller dans une IA web → réponses recollées ──
function _geoPromptBlock(g) {
  const lines = (g.prompts || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `Réponds à chacune des questions ci-dessous comme tu le ferais pour un utilisateur qui te demande conseil.
Pour CHAQUE question : commence par une ligne « ### QUESTION N » (N = son numéro), puis donne tes recommandations sous forme de liste numérotée (noms d'entreprises, de marques ou de produits), du plus pertinent au moins pertinent. Cite une source web quand c'est possible.

${lines}`;
}
function _geoManualHTML(g) {
  const has = !!(g.prompts && g.prompts.length);
  return `<div class="snt-geo-manual-in">
    <div class="snt-geo-steps">${icon('sparkles', 15)}<div><b>100 % gratuit, sans clé.</b> ① Copie le bloc · ② colle-le dans l'IA de ton choix (Gemini, Perplexity, ChatGPT…) · ③ recolle SA réponse entière dans le cadre · ④ Analyser.<br><span class="snt-geo-hint">Pour adapter les questions (activité, ville), utilise « Modifier » puis « Enregistrer ».</span></div></div>
    <div class="snt-geo-copyblock"><div class="snt-fix-codehead"><span>1 · Bloc à coller dans l'IA</span><button class="snt-copy" data-act="copy" data-target="snt-geo-block">${icon('copy', 13)} Copier</button></div><pre class="snt-code" id="snt-geo-block">${_esc(_geoPromptBlock(g))}</pre></div>
    <label class="snt-geo-l">2 · Quelle IA as-tu utilisée ?<select class="snt-input" id="snt-geo-engine"><option value="gemini">Gemini</option><option value="perplexity">Perplexity</option><option value="gpt">ChatGPT</option><option value="autre">Autre IA</option></select></label>
    <label class="snt-geo-l">3 · Colle ici la réponse complète de l'IA<textarea class="snt-input snt-geo-mta snt-geo-answer" id="snt-geo-manual-answer" rows="8" placeholder="Colle toute la réponse de l'IA (les sections ### QUESTION 1, 2, 3… avec leurs listes)"></textarea></label>
    <div class="snt-geo-mmsg" id="snt-geo-manual-msg"></div>
    <button class="snt-btn snt-btn-sm" data-act="geo-manual-run"${has ? '' : ' disabled'}>${icon('compass', 14)} Analyser (gratuit)</button>
    ${has ? '' : '<div class="snt-geo-hint">Configure d\'abord tes questions via « Modifier » puis « Enregistrer ».</div>'}
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
// Mode manuel : ouvrir/fermer le panneau.
function _geoManualToggle() {
  const m = _root && _root.querySelector('#snt-geo-manual');
  if (!m) return;
  m.hidden = !m.hidden;
  if (!m.hidden && m.scrollIntoView) try { m.scrollIntoView({ block: 'nearest' }); } catch (_) {}
}
// Lit les champs du formulaire GEO (null si absent / nom manquant).
function _geoReadForm() {
  const nameEl = _root && _root.querySelector('#snt-geo-name');
  if (!nameEl) return null;
  const body = { business_name: (nameEl.value || '').trim() };
  const cityEl = _root.querySelector('#snt-geo-city'); body.city = cityEl ? cityEl.value.trim() : '';
  const actEl = _root.querySelector('#snt-geo-act'); body.activity = actEl ? actEl.value.trim() : '';
  const pEl = _root.querySelector('#snt-geo-prompts'); if (pEl) body.prompts = pEl.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!body.business_name) { alert("Indiquez le nom de l'établissement."); return null; }
  return body;
}
// Enregistre la config GEO (sans lancer de mesure) → POST /geo. Ouvre le manuel.
async function _geoSave() {
  if (!_panel || !_panel.id) return;
  const body = _geoReadForm(); if (!body) return;
  try {
    await _api(`/sites/${encodeURIComponent(_panel.id)}/geo`, { method: 'POST', body });
    _panel.geo = Object.assign({}, _panel.geo || {}, { configured: true, business_name: body.business_name, city: body.city, activity: body.activity, prompts: body.prompts });
    _renderCockpit();
    const m = _root && _root.querySelector('#snt-geo-manual'); if (m) m.hidden = false;
  } catch (e) { alert(e.message || 'Enregistrement impossible.'); }
}
// Analyse les réponses collées (gratuit, zéro clé) → POST /geo/manual.
async function _geoManualRun() {
  if (!_panel || !_panel.id) return;
  const g = _panel.geo || _geoDefault();
  const ansEl = _root && _root.querySelector('#snt-geo-manual-answer');
  const answer = ansEl ? ansEl.value : '';
  if (!answer.trim()) { alert("Colle la réponse de l'IA avant d'analyser."); return; }
  const engineEl = _root && _root.querySelector('#snt-geo-engine');
  const engine = engineEl ? engineEl.value : 'autre';
  const msg = _root && _root.querySelector('#snt-geo-manual-msg');
  if (msg) msg.innerHTML = `<div class="snt-ai-load">${icon('refresh', 14)} Analyse de la réponse…</div>`;
  try {
    const d = await _api(`/sites/${encodeURIComponent(_panel.id)}/geo/manual`, { method: 'POST', body: { business_name: g.business_name, city: g.city, activity: g.activity, engine, prompts: g.prompts, answer }, timeout: 30000 });
    _panel.geo = Object.assign({}, _panel.geo, d.geo);
    _renderCockpit();
    const s2 = _root && _root.querySelector('#snt-geo-sec'); if (s2 && s2.scrollIntoView) try { s2.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  } catch (e) {
    if (msg) msg.innerHTML = `<div class="snt-ai-err">${icon('x', 13)} ${_esc(e.message || 'Analyse impossible.')}</div>`;
  }
}
// ── V2 · Search Console — section « Mots-clés » (positions Google réelles) ──
// N'apparaît que si le serveur a câblé l'OAuth Google (gsc.available). Sinon
// rien : l'axe « Mots-clés » du radar reste en pointillé (« à venir »).
function _gscSectionHTML() {
  const x = (_panel && _panel.gsc) || null;
  if (!x || !x.available) return '';
  const head = `<div class="snt-aeo-head">${icon('bar-chart', 18)}<div><div class="snt-aeo-t">Mots-clés Google (Search Console)</div><div class="snt-aeo-d">Vos positions réelles dans Google : sur quelles requêtes vous apparaissez, à quel rang, et combien de clics. Connexion sécurisée en lecture seule.</div></div></div>`;
  if (!x.connected) {
    return `<div class="snt-geo" id="snt-gsc-sec">${head}
      <div class="snt-gsc-guide">
        <div class="snt-gsc-cards">
          <div class="snt-gsc-card">
            <span class="snt-gsc-badge">1</span>
            <span class="snt-gsc-cic">${icon('shield-check', 24)}</span>
            <span class="snt-gsc-ct">Validez le site sur Google</span>
            <span class="snt-gsc-cd">Une fois. Ça prouve qu'il est à vous. Gratuit.</span>
          </div>
          <span class="snt-gsc-sep">${icon('arrow-right', 18)}</span>
          <div class="snt-gsc-card">
            <span class="snt-gsc-badge">2</span>
            <span class="snt-gsc-cic">${icon('link', 24)}</span>
            <span class="snt-gsc-ct">Cliquez « Connecter »</span>
            <span class="snt-gsc-cd">Même compte Google. C'est tout.</span>
          </div>
        </div>
        <button class="snt-ai-btn snt-gsc-cta" data-act="gsc-connect">${icon('link', 15)} Connecter Search Console</button>
        <details class="snt-gsc-det">
          <summary>${icon('help-circle', 14)} Étape 1 : comment valider mon site ? (2 min)</summary>
          <ol class="snt-gsc-sub">
            <li>Ouvrez <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Search Console</a> avec votre compte Google.</li>
            <li>« Ajouter une propriété » → <b>« Préfixe de l'URL »</b> → collez l'adresse du site.</li>
            <li>Méthode <b>« Balise HTML »</b> : copiez la balise, collez-la dans l'en-tête du site (Wix : Réglages › Code personnalisé › <code>head</code>), publiez.</li>
            <li>Revenez sur Google → <b>« Vérifier »</b>. Terminé.</li>
          </ol>
        </details>
        <div class="snt-geo-hint">« Aucune propriété ne correspond » ? L'étape 1 n'est pas faite, ou ce n'est pas le bon compte Google.</div>
      </div></div>`;
  }
  return `<div class="snt-geo" id="snt-gsc-sec">${head}${_gscResultsHTML(x)}
    <div class="snt-geo-actions">
      <button class="snt-ai-btn" data-act="gsc-run">${icon('refresh', 13)} Rafraîchir</button>
      <button class="snt-ai-regen" data-act="gsc-disconnect">${icon('x', 12)} Déconnecter</button>
    </div></div>`;
}
function _gscResultsHTML(x) {
  const sc = x.score, r = x.results || {}, t = r.totals || {};
  const queries = (r.queries || []).slice(0, 10);
  const propLine = x.property ? `<div class="snt-geo-legend">${_esc(x.property)}${x.account_email ? ' · ' + _esc(x.account_email) : ''}</div>` : '';
  const pos = (v) => (v != null ? 'n°' + String(v).replace('.', ',') : '—');
  const totalsLine = `<div class="snt-gsc-totals"><span>${t.clicks || 0} clic${(t.clicks || 0) > 1 ? 's' : ''}</span><span>${t.impressions || 0} impression${(t.impressions || 0) > 1 ? 's' : ''}</span>${t.position != null ? `<span>position moy. ${String(t.position).replace('.', ',')}</span>` : ''}<span class="snt-geo-hint">sur 28 jours</span></div>`;
  const rows = queries.length
    ? queries.map((q) => `<div class="snt-geo-row"><div class="snt-geo-q">${_esc(q.query)}</div><div class="snt-gsc-m"><span>${pos(q.position)}</span><span>${q.clicks} clic${q.clicks > 1 ? 's' : ''}</span><span>${q.impressions} vue${q.impressions > 1 ? 's' : ''}</span></div></div>`).join('')
    : `<div class="snt-geo-hint">Aucune requête sur la période (site récent, ou trop peu d'impressions pour figurer).</div>`;
  return `<div class="snt-geo-scorewrap"><div class="snt-geo-score ${sc != null ? _scoreClass(sc) : ''}">${sc != null ? sc : '—'}<span>/100</span></div><div class="snt-geo-scorelbl">score Mots-clés${x.run_at ? ' · ' + _ago(x.run_at) : ''}</div></div>${propLine}${totalsLine}<div class="snt-geo-rows">${rows}</div>`;
}
// Démarre l'OAuth Google dans un nouvel onglet (le callback arrive sur le worker).
async function _gscConnect() {
  if (!_panel || !_panel.id) return;
  try {
    const d = await _api(`/sites/${encodeURIComponent(_panel.id)}/gsc/connect`);
    if (d && d.authUrl) { window.open(d.authUrl, '_blank', 'noopener'); _sntToast('Autorise Google dans le nouvel onglet, reviens puis « Rafraîchir ».'); }
  } catch (e) { alert(e.message || 'Connexion impossible.'); }
}
async function _gscRun() {
  if (!_panel || !_panel.id) return;
  const sec = _root && _root.querySelector('#snt-gsc-sec');
  if (sec) sec.innerHTML = `<div class="snt-ai-load">${icon('refresh', 14)} Lecture de Search Console…</div>`;
  try {
    const d = await _api(`/sites/${encodeURIComponent(_panel.id)}/gsc/run`, { method: 'POST', timeout: 45000 });
    _panel.gsc = Object.assign({}, _panel.gsc, d.gsc, { available: true, connected: true });
    _renderCockpit();
  } catch (e) {
    _renderCockpit();
    alert(e.message || 'Lecture impossible.');
  }
}
async function _gscDisconnect() {
  if (!_panel || !_panel.id) return;
  if (!confirm('Déconnecter Search Console de ce site ?')) return;
  try {
    await _api(`/sites/${encodeURIComponent(_panel.id)}/gsc/disconnect`, { method: 'POST' });
    _panel.gsc = Object.assign({}, _panel.gsc, { connected: false, score: null, results: null, property: null, account_email: null });
    _renderCockpit();
  } catch (e) { alert(e.message || 'Déconnexion impossible.'); }
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
// S7.2 — rapport PDF complet, aligné sur le cockpit (KPI + profil + GEO + correctifs).
function _exportPdf() {
  const p = _panel; if (!p) return;
  const site = p.site || {}; const scores = p.scores || {}; const g = p.score;
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const col = (v) => v == null ? '#94a3b8' : (v >= 80 ? '#16a34a' : (v >= 50 ? '#d97706' : '#dc2626'));
  const host = _hostOf(site.url || ''); const plat = PLATFORM_LABEL[site.platform] || '';

  // ── KPI ──
  const lcp = p.cwv && p.cwv.lcp;
  const lcpTxt = (lcp != null && lcp > 0) ? (lcp / 1000).toFixed(1) + ' s' : 'n/a';
  const up = p.uptime30d != null ? String(p.uptime30d).replace('.', ',') + ' %' : 'n/a';
  const scTrend = p.scoreTrend == null ? 'première mesure' : (p.scoreTrend > 0 ? `+${p.scoreTrend} cette semaine` : (p.scoreTrend < 0 ? `${p.scoreTrend} cette semaine` : 'stable'));
  const sslTxt = p.ssl && p.ssl.valid ? 'Valide' : (p.ssl && p.ssl.https ? 'À vérifier' : 'HTTP');
  const kpi = (l, v, s, c) => `<td style="padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;vertical-align:top"><div style="font-size:11px;color:#64748b">${l}</div><div style="font-size:22px;font-weight:800;color:${c || '#0f172a'};margin-top:3px">${v}</div><div style="font-size:11px;color:#64748b;margin-top:3px">${s}</div></td>`;
  const kpis = `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:14px 0 4px"><tr>
    ${kpi('Disponibilité · 30 j', up, p.uptimeTrend === 'down' ? 'en baisse' : (p.uptimeTrend === 'up' ? 'en hausse' : 'stable'))}
    ${kpi('Score global', `${g != null ? g : '—'}<span style="font-size:12px;color:#94a3b8">/100</span>`, scTrend, col(g))}
    ${kpi('Chargement (LCP)', lcpTxt, lcp == null ? 'relancer l\'audit' : (lcp <= 2500 ? 'bon' : 'à améliorer'))}
    ${kpi('Certificat SSL', sslTxt, p.ssl && p.ssl.valid ? 'vérifié à l\'instant' : '')}
  </tr></table>`;

  // ── Profil (axes + mini-barres) ──
  const RADAR_AXES = [
    ['Performance', scores.performance], ['SEO technique', scores.seo], ['Sécurité', scores.securite],
    ['Accessibilité', scores.accessibilite], ['Présence locale', scores.presence],
    ['Mots-clés (Google)', (p.gsc && p.gsc.connected && p.gsc.score != null) ? p.gsc.score : null],
    ['Visibilité IA (GEO)', (p.geo && p.geo.score != null) ? p.geo.score : null], ['Disponibilité', p.uptime30d != null ? Math.round(p.uptime30d) : scores.disponibilite],
  ];
  const axisRows = RADAR_AXES.map(([label, v]) => `<tr>
    <td style="padding:5px 0;font-size:13px;color:#334155;width:150px">${label}</td>
    <td style="padding:5px 8px;width:100%"><div style="background:#eef1f5;border-radius:99px;height:7px"><div style="background:${col(v)};height:7px;border-radius:99px;width:${v == null ? 0 : Math.max(2, Math.min(100, v))}%"></div></div></td>
    <td style="padding:5px 0;text-align:right;font-size:13px;font-weight:700;color:${col(v)};width:48px">${v == null ? 'n/a' : v}</td></tr>`).join('');

  // ── Visibilité IA (GEO) ──
  let geoHtml = '';
  const geo = p.geo;
  if (geo && geo.results && geo.results.length) {
    const engines = [...new Set(geo.results.flatMap((r) => (r.engines || []).map((c) => c.engine)))].map((e) => _GEO_ENGINE_LABEL[e] || e);
    const rows = geo.results.map((r) => {
      const cells = r.engines || [];
      const cited = cells.some((c) => c.cited);
      const detail = cells.map((c) => `${_GEO_ENGINE_LABEL[c.engine] || c.engine} : ${c.error ? 'échec' : (c.cited ? ('cité' + (c.rank ? ' n°' + c.rank : '')) : (c.sourced ? 'source citée' : 'non cité'))}`).join(' · ');
      return `<div class="f"><div class="ft"><b style="color:${cited ? '#16a34a' : '#dc2626'}">${cited ? 'Cité' : 'Non cité'}</b> — ${_esc(r.prompt)}</div><div class="fd">${_esc(detail)}</div></div>`;
    }).join('');
    geoHtml = `<h2>Visibilité dans les IA (GEO) — score ${geo.score != null ? geo.score : '—'}/100</h2><div class="sub2">Moteurs interrogés : ${engines.join(', ') || 'Gemini'}</div>${rows}`;
  }

  // ── À corriger en priorité ──
  const order = { high: 0, medium: 1, low: 2 };
  const sorted = [...(p.findings || [])].sort((a, b) => (order[a.sev] ?? 3) - (order[b.sev] ?? 3));
  const totalGain = sorted.reduce((s, f) => s + ((_SEV_PRIO[f.sev] || {}).gain || 0), 0);
  const finds = sorted.map((f) => {
    const prio = _SEV_PRIO[f.sev] || _SEV_PRIO.low;
    const pc = f.sev === 'high' ? '#dc2626' : (f.sev === 'medium' ? '#d97706' : '#64748b');
    const steps = (f.fix && f.fix.steps) ? `<ol>${f.fix.steps.map((s) => `<li>${_esc(s)}</li>`).join('')}</ol>` : '';
    const code = (f.fix && f.fix.code) ? `<div class="cl">${_esc(f.fix.codeLabel || 'Code')}</div><pre>${_esc(f.fix.code)}</pre>` : '';
    const tag = (plat && f.fix) ? ` · <span style="color:#6366f1">${_esc(plat)}</span>` : '';
    const pages = (f.pages && f.pages.length && !(f.pages.length === 1 && f.pages[0] === '/'))
      ? `<div class="fd" style="color:#94a3b8">${f.pages.length} page${f.pages.length > 1 ? 's' : ''} : ${_esc(f.pages.slice(0, 8).join(', '))}${f.pages.length > 8 ? '…' : ''}</div>` : '';
    return `<div class="f"><div class="ft"><b style="color:${pc}">[${prio.label}]</b> ${_esc(f.title)}${tag}</div>${f.detail ? `<div class="fd">${_esc(f.detail)}</div>` : ''}${pages}${steps}${code}</div>`;
  }).join('');
  // V2 crawl — note « pages auditées ».
  const auditPages = (p.audit && p.audit.pages) || [];
  const pagesNote = auditPages.length > 1 ? `<div class="sub2">Audit réalisé sur ${auditPages.length} pages : ${_esc(auditPages.map((x) => x.path).slice(0, 8).join(', '))}${auditPages.length > 8 ? '…' : ''}</div>` : '';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Sentinel — ${_esc(p.name || 'Audit')}</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;color:#0f172a;max-width:780px;margin:28px auto;padding:0 24px;line-height:1.5}
  h1{font-size:24px;margin:0 0 2px}.sub{color:#64748b;font-size:13px}.sub2{color:#64748b;font-size:12px;margin:-2px 0 8px}
  h2{font-size:16px;margin:22px 0 6px;border-top:2px solid #0f172a;padding-top:10px}
  .f{border-top:1px solid #eee;padding:10px 0}.ft{font-size:14px}.fd{color:#64748b;font-size:13px;margin:2px 0 6px}
  .cl{font-size:12px;color:#64748b;margin:6px 0 2px}ol{margin:6px 0;padding-left:20px;font-size:13px;color:#334155}
  pre{background:#f6f7f9;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-word}
  .foot{margin-top:24px;color:#94a3b8;font-size:11px;border-top:1px solid #eee;padding-top:12px}
  @media print{.f,h2{page-break-inside:avoid}}</style></head><body>
  <div style="font-size:12px;color:#6366f1;font-weight:700;letter-spacing:.04em">KEYSTONE SENTINEL</div>
  <h1>Rapport d'audit — ${_esc(p.name || host || 'site')}</h1>
  <div class="sub">${_esc(host)}${plat ? ' · ' + _esc(plat) : ''} · ${date}${site.last_ok ? ' · en ligne' : ''}</div>
  ${pagesNote}
  ${_summaryPdf(p)}
  ${kpis}
  <h2>Profil du site</h2><table style="width:100%;border-collapse:collapse">${axisRows}</table>
  ${geoHtml}
  <h2>À corriger en priorité — solutions clé en main <span style="font-size:12px;font-weight:600;color:#64748b">· ${sorted.length} action${sorted.length > 1 ? 's' : ''} · gain estimé +${totalGain} pts</span></h2>
  ${finds || '<p>Aucun problème détecté sur les axes audités.</p>'}
  <div class="foot">Généré par Keystone Sentinel — chaque correctif inclut les étapes et le code prêt à coller.</div></body></html>`;
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
// ── Suivi à l'unité (Living Layer) — épingler UN site au tableau de bord ──
// Stockage par device (clé ks_sentinel_followed = {id, name}). Le pad
// Sentinel racontera alors CE site (état en ligne / hors ligne) au lieu de
// l'agrégat. Le worker vérifie que le site appartient au tenant (anti-fuite).
function _isFollowedSite(id) {
  try { const f = JSON.parse(localStorage.getItem('ks_sentinel_followed') || 'null'); return !!(f && f.id === id); }
  catch (e) { return false; }
}
function _toggleFollowSite(id) {
  const s = (_sites || []).find(x => x.id === id);
  let cur = null; try { cur = JSON.parse(localStorage.getItem('ks_sentinel_followed') || 'null'); } catch (e) { cur = null; }
  try {
    if (cur && cur.id === id) {
      localStorage.removeItem('ks_sentinel_followed');
      _sntToast('Site retiré du tableau de bord');
    } else if (s) {
      const name = (s.label || _hostOf(s.url) || 'Site');
      localStorage.setItem('ks_sentinel_followed', JSON.stringify({ id, name }));
      _sntToast('« ' + name + ' » suivi sur le tableau de bord');
    }
  } catch (e) { /* localStorage plein */ }
  _render();
}
function _sntToast(msg) {
  try {
    document.querySelectorAll('.snt-lib-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'snt-lib-toast';
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:99999;'
      + 'background:#1c2234;color:#f8fafc;border:1px solid rgba(255,255,255,.12);'
      + 'padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600;max-width:80vw;'
      + 'box-shadow:0 8px 24px rgba(0,0,0,.32);opacity:0;transition:opacity .2s ease;';
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2400);
  } catch (e) { /* no-op */ }
}

// ── Interactions ────────────────────────────────────────────────
function _onClick(e) {
  const act = e.target.closest('[data-act]'); if (!act) return;
  const a = act.dataset.act;
  if (a === 'close')       return closeSentinel();
  if (a === 'reload')      return _load();
  if (a === 'follow')      return _toggleFollowSite(act.dataset.id);
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
  if (a === 'geo-save')          return _geoSave();
  if (a === 'geo-manual-toggle') return _geoManualToggle();
  if (a === 'geo-manual-run')    return _geoManualRun();
  if (a === 'gsc-connect')       return _gscConnect();
  if (a === 'gsc-run')           return _gscRun();
  if (a === 'gsc-disconnect')    return _gscDisconnect();
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
