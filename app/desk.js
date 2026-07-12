// ═══════════════════════════════════════════════════════════════
// desK — Pad O-DSK-001 · DK-1 (socle partagé)
//
// Chemin de fer vivant d'une revue (DESK_BRIEF.md) : frise horizontale
// en cartes-pages, rail des jalons avec marges, inspecteur latéral,
// repagination, pointage, bascule de remplaçant — branché sur le
// worker (publications, membres, rubriques, numéros). L'ergonomie est
// le PORTAGE FIDÈLE du harnais validé (_design-lab/desk-harness.html).
//
// ⚠ TENANT = LA PUBLICATION (pas la personne). Le front ne fait que
// choisir une publication ; l'appartenance est contrôlée serveur
// (dk_members). Rôles identiques sur le contenu ; le propriétaire
// administre (renommer, inviter).
//
// Le calcul de marge vit ICI (client), simple et explicable (§2 du
// brief) : copiePrête = max(aujourd'hui, remise) ; le bouclage ne
// contraint QUE les copies non remises (règle apprise au harnais —
// sinon tout s'allume à J−2). Partage d'équipe : rafraîchissement
// périodique + « modifié par X il y a N min ». PAS de temps réel.
//
// ISOLATION : préfixe dk- (CSS/DOM) / dk_ (localStorage, tables D1).
// ZÉRO IA. Mobile = consultation + pointage (pas de drag au doigt).
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';

const WORKSPACE_META = { id: 'O-DSK-001', name: 'desK' };
// dk_api (localStorage) = override de dev/test — jamais posé en usage normal.
const API_BASE = localStorage.getItem('dk_api') || 'https://keystone-os-api.keystone-os.workers.dev';
const DAY = 86400000;
const POLL_MS = 45000;          // rafraîchissement d'équipe (2-5 personnes, pas de temps réel)

// Statuts d'article : libellé + point + pipeline restant (jours) une fois
// la copie disponible. needsCopy = la remise est encore attendue.
const STATUS = {
  propose:  { label: 'proposé',  dot: '#8d93a8', reluDays: 2, maqDays: 2, needsCopy: true },
  attendu:  { label: 'attendu',  dot: '#6d8dd6', reluDays: 2, maqDays: 2, needsCopy: true },
  remis:    { label: 'remis',    dot: '#c9a227', reluDays: 2, maqDays: 2, needsCopy: false },
  relu:     { label: 'relu',     dot: '#4cc38a', reluDays: 0, maqDays: 2, needsCopy: false },
  maquette: { label: 'maquetté', dot: '#4cc38a', reluDays: 0, maqDays: 0, needsCopy: false },
  publie:   { label: 'publié',   dot: '#4cc38a', reluDays: 0, maqDays: 0, needsCopy: false },
  abandonne:{ label: 'abandonné',dot: '#8d93a8', reluDays: 0, maqDays: 0, needsCopy: false },
};
const JALON_DEFS = [
  { key: 'bouclage',  name: 'Bouclage rédactionnel' },
  { key: 'maquette',  name: 'Fin de maquette' },
  { key: 'imprimeur', name: 'Envoi imprimeur' },
  { key: 'parution',  name: 'Parution' },
];
const AMBRE_SEUIL = 3;          // marge ≤ 3 j → ambre ; < 0 → rouge (règle dure §3.3)

// ── État ────────────────────────────────────────────────────────
let _root = null, _me = null, _pubs = [], _pubId = null, _issueId = null;
let _D = null;                  // { issue, pages, articles, rubriques } du numéro affiché
let _selN = null, _dense = false, _pollTimer = null, _offline = false;
let _toastTimer = null;

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const _fmtD = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
function _relTime(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z')).getTime()) / 60000));
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return 'il y a ' + mins + ' min';
  const h = Math.round(mins / 60);
  if (h < 24) return 'il y a ' + h + ' h';
  return 'le ' + _fmtD(iso);
}

// ── Couche API (pattern networK : JWT + timeout) ────────────────
function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(API_BASE + '/api/desk' + path, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + _jwt(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('offline');
  }
  clearTimeout(timer);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Erreur ' + res.status));
  return data;
}

// ── Ouverture / fermeture ───────────────────────────────────────
export function openDesk() {
  if (_root) return;
  _root = document.createElement('div');
  _root.className = 'ws-app dk-app';
  _root.innerHTML = `
    <header class="ws-topbar">
      <div class="ws-topbar-brand">
        <a class="ws-topbar-logo" href="./app" title="Retour au Dashboard Keystone" aria-label="Retour au Dashboard">
          <img src="./LOGOS/Logo KEYSTONE dark-gold.svg" alt="Keystone" class="ws-logo-dark">
          <img src="./LOGOS/Logo KEYSTONE fond clair.svg" alt="Keystone" class="ws-logo-light">
        </a>
        <button class="ws-topbar-back" data-act="back" title="Retour" aria-label="Retour">${icon('chevron-left', 34)}</button>
      </div>
      <div class="ws-topbar-title">
        <span class="ws-topbar-app-picto">${icon('desk', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      <div class="dk-pub-slot" data-slot="pubslot"></div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <button class="ws-iconbtn" data-act="settings" aria-label="Réglages de la publication" title="Réglages de la publication">${icon('settings', 20)}</button>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main dk-main" data-slot="main"></main>
    </div>
    <aside class="dk-insp" data-slot="insp"></aside>
    <div class="dk-veil" data-slot="veil"></div>
    <div class="dk-toast" data-slot="toast"></div>
  `;
  document.body.appendChild(_root);
  document.body.style.overflow = 'hidden';
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
  _root.querySelector('[data-act="back"]').addEventListener('click', _onBack);
  _root.querySelector('[data-act="settings"]').addEventListener('click', () => _openSettings());
  _root.querySelector('[data-slot="veil"]').addEventListener('click', _closeInsp);
  document.addEventListener('keydown', _onKey);
  document.addEventListener('visibilitychange', _onVisibility);
  _boot();
}

export function closeDesk() {
  if (!_root) return;
  clearInterval(_pollTimer); clearTimeout(_toastTimer);
  document.removeEventListener('keydown', _onKey);
  document.removeEventListener('visibilitychange', _onVisibility);
  _root.remove();
  _root = null; _me = null; _pubs = []; _pubId = null; _issueId = null;
  _D = null; _selN = null; _dense = false; _offline = false;
  document.body.style.overflow = '';
}

function _onKey(e) { if (e.key === 'Escape') { if (_root.querySelector('.dk-insp.on')) _closeInsp(); else _onBack(); } }
function _onBack() { closeDesk(); }
function _onVisibility() { if (!document.hidden && _issueId) _loadIssue(true); }

// ── Boot : bootstrap → publication → numéro ─────────────────────
async function _boot() {
  const main = _root.querySelector('[data-slot="main"]');
  // Cache : rendu instantané du dernier numéro consulté (rafraîchi ensuite)
  const cached = _readCache();
  if (cached) { _pubId = cached.pubId; _issueId = cached.issueId; _D = cached.data; _renderFer(); }
  else main.innerHTML = `<div class="dk-center"><div class="dk-spin"></div></div>`;
  try {
    const b = await _api('/bootstrap');
    _me = b.me; _pubs = b.publications || []; _offline = false;
    if (!_pubs.length) { _renderCreatePub(); return; }
    // Publication courante : mémorisée, sinon la première
    _pubId = _pubs.find(p => p.id === localStorage.getItem('dk_last_pub'))?.id || _pubs[0].id;
    _renderPubSlot();
    const pub = _pubs.find(p => p.id === _pubId);
    if (!pub.issues.length) { _renderCreateIssue(); return; }
    _issueId = pub.issues.find(i => i.id === localStorage.getItem('dk_last_issue'))?.id || pub.issues[0].id;
    await _loadIssue();
    clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { if (!document.hidden && _issueId) _loadIssue(true); }, POLL_MS);
  } catch (e) {
    if (String(e.message) === 'offline' && cached) { _offline = true; _renderFer(); }
    else if (String(e.message) === 'offline') main.innerHTML = `<div class="dk-center dk-empty"><p>Impossible de joindre le serveur.<br>Vérifiez la connexion puis rouvrez desK.</p></div>`;
    else main.innerHTML = `<div class="dk-center dk-empty"><p>${_esc(e.message)}</p></div>`;
  }
}

function _readCache() {
  try {
    const c = JSON.parse(localStorage.getItem('dk_cache_v1') || 'null');
    return c && c.data && c.data.issue ? c : null;
  } catch (_) { return null; }
}
function _writeCache() {
  try { localStorage.setItem('dk_cache_v1', JSON.stringify({ pubId: _pubId, issueId: _issueId, data: _D })); } catch (_) {}
}

async function _loadIssue(silent) {
  if (!_issueId) return;
  try {
    const d = await _api('/issue/' + _issueId);
    _D = d; _offline = false;
    localStorage.setItem('dk_last_pub', _pubId);
    localStorage.setItem('dk_last_issue', _issueId);
    _writeCache();
    _renderFer();
  } catch (e) {
    if (String(e.message) === 'offline') { _offline = true; if (!silent) _toast('Hors ligne — lecture seule sur la dernière version connue', true); if (_D) _renderFer(); }
    else if (!silent) _toast(e.message, true);
  }
}

// ── Sélecteur de publication (topbar) ───────────────────────────
function _renderPubSlot() {
  const slot = _root.querySelector('[data-slot="pubslot"]');
  if (!slot) return;
  const pub = _pubs.find(p => p.id === _pubId);
  const issue = pub && pub.issues.find(i => i.id === _issueId);
  slot.innerHTML = `
    <button class="dk-pub-btn" data-act="pubmenu" title="Changer de publication ou de numéro">
      <span class="dk-pub-name">${_esc(pub ? pub.name : '')}</span>
      ${issue ? `<span class="dk-pub-issue">n° ${_esc(issue.num)}</span>` : ''}
      ${icon('chevron-down', 14)}
    </button>`;
  slot.querySelector('[data-act="pubmenu"]').addEventListener('click', _openPubMenu);
}

function _openPubMenu(e) {
  _root.querySelector('.dk-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'dk-menu';
  menu.innerHTML = _pubs.map(p => `
    <div class="dk-menu-group">${_esc(p.name)}</div>
    ${p.issues.map(i => `<button class="dk-menu-item ${i.id === _issueId ? 'on' : ''}" data-pub="${p.id}" data-issue="${i.id}">n° ${_esc(i.num)}${i.theme ? ' — ' + _esc(i.theme) : ''}</button>`).join('')}
    <button class="dk-menu-item dk-menu-new" data-pub="${p.id}" data-newissue="1">${icon('plus', 13)} Nouveau numéro</button>
  `).join('') + `<button class="dk-menu-item dk-menu-new" data-newpub="1">${icon('plus', 13)} Nouvelle publication</button>`;
  const r = e.currentTarget.getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(10, r.left) + 'px';
  _root.appendChild(menu);
  menu.addEventListener('click', ev => {
    const b = ev.target.closest('.dk-menu-item'); if (!b) return;
    menu.remove();
    if (b.dataset.newpub) { _renderCreatePub(true); return; }
    if (b.dataset.newissue) { _pubId = b.dataset.pub; _renderCreateIssue(); return; }
    _pubId = b.dataset.pub; _issueId = b.dataset.issue; _selN = null;
    _renderPubSlot(); _loadIssue();
  });
  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', h); }
  }), 0);
}

// ── Écrans de création ──────────────────────────────────────────
function _renderCreatePub(extra) {
  const main = _root.querySelector('[data-slot="main"]');
  main.innerHTML = `
    <div class="dk-center">
      <div class="dk-hero">
        <div class="dk-hero-ico">${icon('desk', 44)}</div>
        <h2>${extra ? 'Nouvelle publication' : 'Votre rédaction vous attend'}</h2>
        <p>Une publication = une revue et son équipe. Vous y créerez vos numéros, leur chemin de fer, et inviterez vos co-équipiers — les contributeurs, eux, restent dans l'e-mail.</p>
        <div class="dk-form-row">
          <input type="text" data-k="pubname" maxlength="120" placeholder="Nom de la revue — ex. L'Épaulette">
          <button class="dk-btn primary" data-act="createpub">Créer</button>
        </div>
      </div>
    </div>`;
  const input = main.querySelector('[data-k="pubname"]');
  main.querySelector('[data-act="createpub"]').addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { _toast('Donnez un nom à la publication', true); return; }
    try {
      const r = await _api('/publication', { method: 'POST', body: { name } });
      _pubs.push(r.publication); _pubId = r.publication.id;
      _renderPubSlot(); _renderCreateIssue();
    } catch (e) { _toast(e.message, true); }
  });
  input.focus();
}

function _renderCreateIssue() {
  const main = _root.querySelector('[data-slot="main"]');
  const pub = _pubs.find(p => p.id === _pubId);
  const y = new Date();
  const d = (m) => { const x = new Date(y.getTime() + m * DAY); return x.toISOString().slice(0, 10); };
  main.innerHTML = `
    <div class="dk-center">
      <div class="dk-hero dk-hero-wide">
        <h2>Nouveau numéro — ${_esc(pub ? pub.name : '')}</h2>
        <p>Le chemin de fer se génère avec ses pages ; la couverture et la 4ᵉ de couv sont posées d'office. Les jalons sont la ligne de vie du numéro — les marges se calculent contre eux.</p>
        <div class="dk-form-grid">
          <label>Numéro<input type="text" data-k="num" maxlength="20" placeholder="143"></label>
          <label>Thème (optionnel)<input type="text" data-k="theme" maxlength="120" placeholder="Le recrutement interne"></label>
          <label>Nombre de pages<input type="number" data-k="pages" min="4" max="400" value="60"></label>
          <label>Bouclage rédactionnel<input type="date" data-k="bouclage" value="${d(30)}"></label>
          <label>Fin de maquette<input type="date" data-k="maquette" value="${d(44)}"></label>
          <label>Envoi imprimeur<input type="date" data-k="imprimeur" value="${d(51)}"></label>
          <label>Parution<input type="date" data-k="parution" value="${d(65)}"></label>
        </div>
        <div class="dk-form-row" style="justify-content:flex-end">
          ${pub && pub.issues.length ? `<button class="dk-btn" data-act="cancelissue">Annuler</button>` : ''}
          <button class="dk-btn primary" data-act="createissue">Créer le numéro</button>
        </div>
      </div>
    </div>`;
  main.querySelector('[data-act="cancelissue"]')?.addEventListener('click', () => { _issueId = pub.issues[0].id; _loadIssue(); });
  main.querySelector('[data-act="createissue"]').addEventListener('click', async () => {
    const g = k => main.querySelector(`[data-k="${k}"]`).value.trim();
    if (!g('num')) { _toast('Indiquez le numéro (ex. 143)', true); return; }
    try {
      const r = await _api('/publication/' + _pubId + '/issue', { method: 'POST', body: {
        num: g('num'), theme: g('theme'), pages: parseInt(g('pages'), 10) || 60,
        jalons: { bouclage: g('bouclage'), maquette: g('maquette'), imprimeur: g('imprimeur'), parution: g('parution') },
      } });
      const pub2 = _pubs.find(p => p.id === _pubId);
      pub2.issues.unshift(r.issue);
      _issueId = r.issue.id;
      _renderPubSlot();
      await _loadIssue();
      _toast('Numéro créé — le chemin de fer est prêt.');
    } catch (e) { _toast(e.message, true); }
  });
}

/* ═══════════════════ Marges (§2 — même règle que le harnais) ═══ */
function _jalonDate(key) {
  try { const j = JSON.parse(_D.issue.jalons || '{}'); return j[key] ? new Date(j[key] + 'T12:00:00') : null; } catch (_) { return null; }
}
function _computeArt(a, simDue) {
  const st = STATUS[a.status] || STATUS.propose;
  const t = Date.now();
  const due = simDue !== undefined ? simDue : (a.due ? new Date(a.due + 'T12:00:00') : null);
  const copyReady = st.needsCopy ? Math.max(t, due ? due.getTime() : t) : t;
  const reluDone = copyReady + st.reluDays * DAY;
  const pageReady = reluDone + st.maqDays * DAY;
  const jB = _jalonDate('bouclage'), jM = _jalonDate('maquette');
  const mBoucl = jB ? Math.round((jB.getTime() - reluDone) / DAY) : null;
  const mMaq = jM ? Math.round((jM.getTime() - pageReady) / DAY) : null;
  // Le bouclage ne contraint QUE les copies non remises (règle du harnais).
  let marge = null;
  if (st.needsCopy) marge = (mBoucl !== null && mMaq !== null) ? Math.min(mBoucl, mMaq) : (mBoucl ?? mMaq);
  else marge = mMaq;
  return { copyReady, reluDone, pageReady, mBoucl, mMaq, marge };
}
function _stateOf(marge) { return marge === null ? '' : (marge < 0 ? 'rouge' : (marge <= AMBRE_SEUIL ? 'ambre' : '')); }
function _margeTxt(m) { return m === null ? '' : (m < 0 ? 'marge brûlée (' + m + ' j)' : 'marge ' + m + ' j'); }
function _artById(id) { return (_D.articles || []).find(a => a.id === id) || null; }
function _rubById(id) { return (_D.rubriques || []).find(r => r.id === id) || null; }
function _bancOf(p) { try { const b = JSON.parse(p.banc || '[]'); return Array.isArray(b) ? b : []; } catch (_) { return []; } }
function _computeJalons() {
  let minB = Infinity, minM = Infinity;
  for (const p of _D.pages) {
    if (p.kind !== 'article' || !p.art_id) continue;
    const a = _artById(p.art_id); if (!a) continue;
    if (a.status === 'maquette' || a.status === 'publie' || a.status === 'abandonne') continue;
    const c = _computeArt(a);
    if ((STATUS[a.status] || {}).needsCopy && c.mBoucl !== null) minB = Math.min(minB, c.mBoucl);
    if (c.mMaq !== null) minM = Math.min(minM, c.mMaq);
  }
  const retard = Math.max(0, -Math.min(minB === Infinity ? 0 : minB, minM === Infinity ? 0 : minM));
  const jI = _jalonDate('imprimeur');
  return {
    boucl: minB === Infinity ? null : minB,
    maq: minM === Infinity ? null : minM,
    impProj: (retard > 0 && jI) ? new Date(jI.getTime() + retard * DAY) : null,
    retard,
  };
}

/* ═══════════════════ Le chemin de fer ═══════════════════ */
function _renderFer() {
  if (!_D || !_D.issue) return;
  _renderPubSlot();
  const main = _root.querySelector('[data-slot="main"]');
  main.classList.add('dk-main-fer');
  const bacHidden = true;   // le bac « à trier » arrive avec la digestion (DK-4)
  main.innerHTML = `
    ${_offline ? `<div class="dk-offline">Hors ligne — lecture seule sur la dernière version connue</div>` : ''}
    <div class="dk-rail" data-slot="rail"></div>
    <div class="dk-ferbar">
      <div class="dk-seg" data-slot="zoom">
        <button data-z="dense" class="${_dense ? 'on' : ''}">Dense</button>
        <button data-z="std" class="${_dense ? '' : 'on'}">Standard</button>
      </div>
      <span class="dk-ferbar-issue">n° ${_esc(_D.issue.num)}${_D.issue.theme ? ' · ' + _esc(_D.issue.theme) : ''} · ${_D.pages.length} pages</span>
      <span class="dk-ferbar-spacer"></span>
      <button class="dk-btn ghost small" data-act="newart">${icon('plus', 14)}<span class="dk-btn-txt"> Article</span></button>
    </div>
    <div class="dk-frise-wrap ${_dense ? 'dense' : ''}">
      <div class="dk-frise" data-slot="frise"></div>
    </div>`;
  _renderRail();
  _renderFrise();
  main.querySelector('[data-slot="zoom"]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    _dense = b.dataset.z === 'dense';
    _renderFer();
  });
  main.querySelector('[data-act="newart"]').addEventListener('click', () => _openArtForm());
  _bindFrise();
  if (_selN !== null) _openInsp(_selN, true);
}

function _renderRail() {
  const rail = _root.querySelector('[data-slot="rail"]');
  if (!rail) return;
  const j = _computeJalons();
  const t = Date.now();
  rail.innerHTML = JALON_DEFS.map(def => {
    const d = _jalonDate(def.key);
    if (!d) return '';
    const jmoins = Math.round((d.getTime() - t) / DAY);
    let marge = null, cls = '', extra = '';
    if (def.key === 'bouclage') marge = j.boucl;
    if (def.key === 'maquette') marge = j.maq;
    if (marge !== null) cls = _stateOf(marge);
    if (def.key === 'imprimeur' && j.impProj) {
      cls = 'rouge';
      extra = `<span class="dk-jalon-marge"><strong>projeté : ${_fmtD(j.impProj)} (+${j.retard} j)</strong></span>`;
    }
    return `<div class="dk-jalon ${cls}">
      <span class="dk-jalon-name">${def.name}</span>
      <span class="dk-jalon-date">${_fmtD(d)} · J${jmoins >= 0 ? '−' + jmoins : '+' + (-jmoins)}</span>
      ${marge !== null ? `<span class="dk-jalon-marge">${_margeTxt(marge)}</span>` : (extra || '<span class="dk-jalon-marge">&nbsp;</span>')}
    </div>`;
  }).join('');
}

function _planches() {
  const P = _D.pages;
  if (!P.length) return [];
  const out = [[P[0]]];
  for (let i = 1; i < P.length - 1; i += 2) out.push(P[i + 1] ? [P[i], P[i + 1]] : [P[i]]);
  if (P.length > 1) out.push([P[P.length - 1]]);
  return out;
}

function _cardHTML(p) {
  if (p.kind === 'fixe') {
    return `<div class="dk-pcard fixe locked" data-n="${p.n}">
      <span class="dk-pc-fixe-tag">${_esc(p.fixe_tag || 'Figée')}</span>
      ${p.fixe_title ? `<div class="dk-pc-title">${_esc(p.fixe_title)}</div>` : ''}
      <div class="dk-pc-foot"><div class="dk-pc-status"><span class="dk-pc-status-dot" style="background:#4cc38a"></span><span>figée</span></div></div>
    </div>`;
  }
  const a = p.kind === 'article' && p.art_id ? _artById(p.art_id) : null;
  if (!a) {
    return `<div class="dk-pcard vide" data-n="${p.n}">
      <span class="dk-pc-vide-ico">${icon('plus', 20)}</span>
      <span class="dk-pc-vide-txt">réserver<br>un article</span>
    </div>`;
  }
  const st = STATUS[a.status] || STATUS.propose;
  const rub = _rubById(a.rub_id);
  const c = _computeArt(a);
  const done = ['maquette', 'publie'].includes(a.status);
  const cls = done ? '' : _stateOf(c.marge);
  const banc = _bancOf(p);
  const badges = [];
  if (banc.length) badges.push(`<span class="dk-pc-badge">${icon('users', 9)}${banc.length}</span>`);
  return `<div class="dk-pcard ${cls}" data-n="${p.n}" data-art="${a.id}">
    <div class="dk-pc-rub"><span class="dk-pc-dot" style="background:${rub ? rub.color : '#8d93a8'}"></span><span>${_esc(rub ? rub.name : 'Sans rubrique')}</span></div>
    <div class="dk-pc-title">${_esc(a.title)}</div>
    ${a.contrib ? `<div class="dk-pc-contrib">${_esc(a.contrib)}</div>` : ''}
    <div class="dk-pc-foot">
      <div class="dk-pc-status"><span class="dk-pc-status-dot" style="background:${st.dot}"></span><span>${st.label}</span></div>
      <div class="dk-pc-marge">${done ? 'prêt' : _margeTxt(c.marge)}</div>
    </div>
    ${badges.length ? `<div class="dk-pc-badges">${badges.join('')}</div>` : ''}
  </div>`;
}

function _renderFrise(keepScroll = true) {
  const f = _root.querySelector('[data-slot="frise"]');
  if (!f) return;
  const sc = keepScroll ? f.scrollLeft : 0;
  f.innerHTML = _planches().map(pl => `
    <div class="dk-planche">
      <div class="dk-planche-pages">${pl.map(_cardHTML).join('')}</div>
      <div class="dk-planche-num">${pl.length === 2 ? pl[0].n + '–' + pl[1].n : pl[0].n}</div>
    </div>`).join('');
  f.scrollLeft = sc;
  if (_selN !== null) f.querySelector(`.dk-pcard[data-n="${_selN}"]`)?.classList.add('sel');
}

// ── Interactions frise : molette, pan, drag repagination, clic ──
let _down = null, _dragCard = null, _dragGhost = null, _suppressClick = false;
function _bindFrise() {
  const f = _root.querySelector('[data-slot="frise"]');
  if (!f) return;
  f.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { f.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  f.addEventListener('mousedown', e => {
    const card = e.target.closest('.dk-pcard');
    const draggable = card && !card.classList.contains('locked') && card.dataset.art && !_offline;
    _down = { x: e.clientX, y: e.clientY, sc: f.scrollLeft, card: draggable ? card : null, started: false, frise: f };
  });
  f.addEventListener('click', e => {
    if (_suppressClick) { _suppressClick = false; return; }
    const card = e.target.closest('.dk-pcard');
    if (!card) return;
    _openInsp(parseInt(card.dataset.n, 10));
  });
}
// Les listeners window sont posés UNE fois par module (le pad peut se rouvrir)
if (typeof window !== 'undefined' && !window.__dkWin) {
  window.__dkWin = true;
  window.addEventListener('mousemove', e => {
    if (!_down || !_root) return;
    const dx = e.clientX - _down.x, dy = e.clientY - _down.y;
    if (!_down.started && Math.abs(dx) + Math.abs(dy) < 10) return;    // seuil 10 px (pattern Grid Engine)
    if (!_down.started) {
      _down.started = true;
      if (_down.card) _beginDrag(_down.card, e);
      else _down.frise.classList.add('dragging-bg');
    }
    if (_down.card) _moveDrag(e);
    else _down.frise.scrollLeft = _down.sc - dx;
  });
  window.addEventListener('mouseup', e => {
    if (!_down || !_root) { _down = null; return; }
    if (_down.started) _suppressClick = true;
    if (_down.card && _down.started) _endDrag(e);
    _down.frise?.classList.remove('dragging-bg');
    _down = null;
  });
}
function _beginDrag(card, e) {
  _dragCard = card;
  card.classList.add('ghosted');
  _dragGhost = card.cloneNode(true);
  _dragGhost.classList.remove('ghosted', 'sel');
  Object.assign(_dragGhost.style, {
    position: 'fixed', zIndex: 10020, pointerEvents: 'none',
    width: card.offsetWidth + 'px', height: card.offsetHeight + 'px',
    transform: 'rotate(2.5deg)', boxShadow: '0 18px 40px rgba(0,0,0,.5)',
  });
  document.body.appendChild(_dragGhost);
  _moveDrag(e);
}
function _moveDrag(e) {
  _dragGhost.style.left = (e.clientX - _dragGhost.offsetWidth / 2) + 'px';
  _dragGhost.style.top = (e.clientY - _dragGhost.offsetHeight / 2) + 'px';
  _root.querySelectorAll('.dk-pcard.drop-hint').forEach(x => x.classList.remove('drop-hint'));
  const tgt = _dropTarget(e);
  if (tgt) tgt.classList.add('drop-hint');
  const f = _down.frise, r = f.getBoundingClientRect();
  if (e.clientX > r.right - 70) f.scrollLeft += 14;
  if (e.clientX < r.left + 70) f.scrollLeft -= 14;
}
function _dropTarget(e) {
  _dragGhost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  _dragGhost.style.display = '';
  const c = el && el.closest ? el.closest('.dk-pcard') : null;
  return c && c !== _dragCard && !c.classList.contains('locked') ? c : null;
}
async function _endDrag(e) {
  const tgt = _dropTarget(e);
  _root.querySelectorAll('.dk-pcard.drop-hint').forEach(x => x.classList.remove('drop-hint'));
  const fromN = parseInt(_dragCard.dataset.n, 10);
  _dragGhost.remove(); _dragGhost = null;
  _dragCard.classList.remove('ghosted');
  _dragCard = null;
  if (!tgt) return;
  const toN = parseInt(tgt.dataset.n, 10);
  // Optimiste : échange local + FLIP, puis écriture serveur.
  const pa = _D.pages.find(p => p.n === fromN), pb = _D.pages.find(p => p.n === toN);
  if (!pa || !pb) return;
  const firstRects = _flipSnapshot([fromN, toN]);
  const keep = { kind: pa.kind, art_id: pa.art_id, fixe_tag: pa.fixe_tag, fixe_title: pa.fixe_title, banc: pa.banc };
  Object.assign(pa, { kind: pb.kind, art_id: pb.art_id, fixe_tag: pb.fixe_tag, fixe_title: pb.fixe_title, banc: pb.banc });
  Object.assign(pb, keep);
  if (_selN === fromN) _selN = toN; else if (_selN === toN) _selN = fromN;
  _renderFrise(); _flipPlay(firstRects); _renderRail();
  try {
    await _api('/issue/' + _issueId + '/swap', { method: 'POST', body: { a: fromN, b: toN } });
    _toast(`Pages ${fromN} et ${toN} échangées.`);
    _writeCache();
  } catch (err2) {
    _toast('Échange non enregistré : ' + err2.message, true);
    _loadIssue(true);   // resynchroniser
  }
}
function _flipSnapshot(ns) {
  const f = _root.querySelector('[data-slot="frise"]');
  const map = {};
  ns.forEach(n => { const el = f.querySelector(`.dk-pcard[data-n="${n}"]`); if (el) map[n] = el.getBoundingClientRect(); });
  return map;
}
function _flipPlay(firstRects) {
  const f = _root.querySelector('[data-slot="frise"]');
  Object.keys(firstRects).forEach(n => {
    const el = f.querySelector(`.dk-pcard[data-n="${n}"]`);
    if (!el) return;
    const last = el.getBoundingClientRect(), first = firstRects[n];
    const dx = first.left - last.left, dy = first.top - last.top;
    if (!dx && !dy) return;
    el.style.transform = `translate(${dx}px,${dy}px)`;
    requestAnimationFrame(() => { el.classList.add('flip'); el.style.transform = ''; setTimeout(() => el.classList.remove('flip'), 340); });
  });
}

/* ═══════════════════ Inspecteur ═══════════════════ */
function _openInsp(n, silent) {
  const p = _D.pages.find(x => x.n === n);
  if (!p) return;
  _selN = n;
  _root.querySelectorAll('.dk-pcard.sel').forEach(x => x.classList.remove('sel'));
  _root.querySelector(`[data-slot="frise"] .dk-pcard[data-n="${n}"]`)?.classList.add('sel');
  const insp = _root.querySelector('[data-slot="insp"]');

  if (p.kind === 'fixe') { _renderInspFixe(insp, p); }
  else if (p.kind !== 'article' || !p.art_id || !_artById(p.art_id)) { _renderInspVide(insp, p); }
  else { _renderInspArticle(insp, p, _artById(p.art_id)); }

  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
}
function _closeInsp() {
  _root.querySelector('[data-slot="insp"]').classList.remove('on');
  _root.querySelector('[data-slot="veil"]').classList.remove('on');
  _root.querySelectorAll('.dk-pcard.sel').forEach(x => x.classList.remove('sel'));
  _selN = null;
}
function _inspShell(title, rubHTML, body) {
  return `<div class="dk-insp-hd">
    <div class="dk-insp-hd-main">${rubHTML || ''}<div class="dk-insp-title">${_esc(title)}</div></div>
    <button class="dk-insp-close" data-act="close" aria-label="Fermer">${icon('x', 18)}</button>
  </div><div class="dk-insp-body">${body}</div>`;
}
function _kv(k, v, cls) { return `<div class="dk-kv"><span>${k}</span><strong class="${cls || ''}">${_esc(v)}</strong></div>`; }
function _bindClose(insp) { insp.querySelector('[data-act="close"]').onclick = _closeInsp; }

function _renderInspFixe(insp, p) {
  insp.innerHTML = _inspShell(p.fixe_tag || 'Page figée', null,
    `<div class="dk-sec"><h4>Page ${p.n}</h4>
      <label class="dk-field"><span>Intitulé</span><input type="text" data-k="fixe_title" maxlength="200" value="${_esc(p.fixe_title || '')}" placeholder="ex. Publicité — GMPA"></label>
      <div class="dk-btn-row">
        <button class="dk-btn primary" data-act="savefixe">Enregistrer</button>
        <button class="dk-btn" data-act="unfixe">Libérer la page</button>
      </div>
    </div>
    ${p.updated_by ? `<p class="dk-modified">Modifié par ${_esc(p.updated_by)} ${_relTime(p.updated_at)}</p>` : ''}`);
  _bindClose(insp);
  insp.querySelector('[data-act="savefixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { fixe_title: insp.querySelector('[data-k="fixe_title"]').value } });
      _toast('Page figée mise à jour.'); _loadIssue(true);
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="unfixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'vide', fixe_tag: null, fixe_title: null } });
      _toast('Page libérée.'); _loadIssue(true);
    } catch (e) { _toast(e.message, true); }
  };
}

function _renderInspVide(insp, p) {
  // Articles disponibles = pas titulaires d'une autre page de CE numéro.
  const placed = new Set(_D.pages.filter(x => x.art_id).map(x => x.art_id));
  const libres = (_D.articles || []).filter(a => !placed.has(a.id) && !['publie', 'abandonne'].includes(a.status));
  insp.innerHTML = _inspShell('Emplacement libre — page ' + p.n, null,
    `<div class="dk-sec"><h4>Réserver un article</h4>
      ${libres.length ? libres.slice(0, 40).map(a => {
        const rub = _rubById(a.rub_id);
        return `<div class="dk-banc-item">
          <div class="dk-banc-info">
            <div class="dk-banc-title">${_esc(a.title)}</div>
            <div class="dk-banc-meta">${rub ? _esc(rub.name) : 'Sans rubrique'}${a.contrib ? ' · ' + _esc(a.contrib) : ''} · ${(STATUS[a.status] || {}).label || a.status}</div>
          </div>
          <button class="dk-btn small" data-act="reserve" data-a="${a.id}">Réserver</button>
        </div>`;
      }).join('') : `<p class="dk-empty-line">Aucun article disponible — créez-en un ci-dessous.</p>`}
    </div>
    <div class="dk-sec"><h4>Ou marquer la page</h4>
      <div class="dk-btn-row"><button class="dk-btn" data-act="mkfixe">${icon('lock', 14)} Page figée (pub, sommaire…)</button></div>
    </div>
    <div class="dk-sec"><div class="dk-btn-row"><button class="dk-btn primary" data-act="newarthere">${icon('plus', 14)} Nouvel article sur cette page</button></div></div>`);
  _bindClose(insp);
  insp.querySelectorAll('[data-act="reserve"]').forEach(b => b.onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'article', art_id: b.dataset.a } });
      _toast('Article réservé sur la page ' + p.n + '.');
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="mkfixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'fixe', fixe_tag: 'Figée' } });
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="newarthere"]').onclick = () => _openArtForm(p);
}

function _renderInspArticle(insp, p, a) {
  const st = STATUS[a.status] || STATUS.propose;
  const rub = _rubById(a.rub_id);
  const c = _computeArt(a);
  const done = ['maquette', 'publie'].includes(a.status);
  const cls = done ? 'vert' : _stateOf(c.marge);
  const banc = _bancOf(p).map(id => _artById(id)).filter(Boolean);
  let histo = [];
  try { histo = JSON.parse(a.histo || '[]'); } catch (_) {}
  const canSim = st.needsCopy && a.due;

  insp.innerHTML = _inspShell(a.title,
    `<div class="dk-insp-rub"><span class="dk-pc-dot" style="background:${rub ? rub.color : '#8d93a8'}"></span>${_esc(rub ? rub.name : 'Sans rubrique')} · page ${p.n}</div>`,
    `<div class="dk-sec"><h4>Article</h4>
      ${_kv('Contributeur', a.contrib || '—')}
      ${_kv('Statut', st.label)}
      ${_kv('Remise prévue', a.due ? _fmtD(a.due) : '—')}
      ${_kv('Page prête le', _fmtD(new Date(c.pageReady)))}
      ${_kv('Marge', done ? 'prêt' : (_margeTxt(c.marge) || '—'), cls)}
    </div>

    ${canSim ? `<div class="dk-sec"><h4>Simuler un report de remise</h4>
      <div class="dk-sim" data-slot="sim">
        <div class="dk-sim-row">
          <input type="range" data-k="simrange" min="-10" max="21" value="0" step="1">
          <span class="dk-sim-val" data-slot="simval">${_fmtD(a.due)}</span>
        </div>
        <div class="dk-sim-live" data-slot="simlive"></div>
        <div class="dk-sim-acts">
          <button class="dk-btn primary small" data-act="simapply">Appliquer cette date</button>
          <button class="dk-btn small" data-act="simcancel">Annuler</button>
        </div>
      </div>
      <p class="dk-note">Glissez : le rail réagit en direct. Rien n'est écrit tant que vous n'appliquez pas.</p>
    </div>` : ''}

    <div class="dk-sec"><h4>Banc des remplaçants (${banc.length})</h4>
      ${banc.map((b, i) => `<div class="dk-banc-item">
        <span class="dk-banc-num">${i + 1}</span>
        <div class="dk-banc-info">
          <div class="dk-banc-title">${_esc(b.title)}</div>
          <div class="dk-banc-meta">${_rubById(b.rub_id) ? _esc(_rubById(b.rub_id).name) : 'Sans rubrique'}${b.contrib ? ' · ' + _esc(b.contrib) : ''} · ${(STATUS[b.status] || {}).label || b.status}</div>
        </div>
        <button class="dk-btn small" data-act="swap" data-b="${b.id}">${icon('refresh-cw', 13)} Basculer</button>
      </div>`).join('') || `<p class="dk-empty-line">Aucun remplaçant préparé.</p>`}
      <div data-slot="swapconfirm"></div>
      <div class="dk-btn-row" style="margin-top:8px"><button class="dk-btn small ghost" data-act="addbanc">${icon('plus', 13)} Ajouter un remplaçant</button></div>
      <div data-slot="bancpick"></div>
    </div>

    ${histo.length ? `<div class="dk-sec"><h4>Historique</h4>${histo.slice(0, 8).map(h => `<div class="dk-histo">${_esc(h)}</div>`).join('')}</div>` : ''}

    <div class="dk-sec"><h4>Actions</h4><div class="dk-btn-row">
      ${st.needsCopy ? `<button class="dk-btn primary" data-act="pointer">${icon('check', 14)} Copie reçue</button>` : ''}
      ${a.status === 'remis' ? `<button class="dk-btn" data-act="markrelu">${icon('check', 14)} Marquer relu</button>` : ''}
      ${a.status === 'relu' ? `<button class="dk-btn" data-act="markmaq">${icon('check', 14)} Maquetté</button>` : ''}
      <button class="dk-btn" data-act="editart">${icon('edit-3', 14)} Modifier</button>
      <button class="dk-btn" data-act="unreserve">Retirer de la page</button>
    </div></div>
    ${p.updated_by ? `<p class="dk-modified">Carte modifiée par ${_esc(p.updated_by)} ${_relTime(p.updated_at)}</p>` : ''}`);
  _bindClose(insp);

  const patchArt = async (body, msg) => {
    try {
      const r = await _api('/article/' + a.id, { method: 'PATCH', body });
      const i = _D.articles.findIndex(x => x.id === a.id);
      if (i >= 0 && r.article) _D.articles[i] = r.article;
      if (msg) _toast(msg);
      _writeCache(); _renderFrise(); _renderRail(); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="pointer"]')?.addEventListener('click', () =>
    patchArt({ status: 'remis' }, 'Copie reçue — marge recalculée.'));
  insp.querySelector('[data-act="markrelu"]')?.addEventListener('click', () => patchArt({ status: 'relu' }, 'Marqué relu.'));
  insp.querySelector('[data-act="markmaq"]')?.addEventListener('click', () => patchArt({ status: 'maquette' }, 'Marqué maquetté.'));
  insp.querySelector('[data-act="editart"]').addEventListener('click', () => _openArtForm(p, a));
  insp.querySelector('[data-act="unreserve"]').addEventListener('click', async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'vide', art_id: null } });
      _toast('Article retiré — il reste disponible pour une autre page.');
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  });

  // Bascule (confirmation sobre — le titulaire reste dans les articles)
  insp.querySelectorAll('[data-act="swap"]').forEach(btn => btn.addEventListener('click', () => {
    const b = _artById(btn.dataset.b);
    const box = insp.querySelector('[data-slot="swapconfirm"]');
    box.innerHTML = `<div class="dk-confirm">
      Remplacer <strong>« ${_esc(a.title)} »</strong> par <strong>« ${_esc(b.title)} »</strong> ?
      <br><span class="dk-note">Le titulaire reste au stock d'articles avec la mention du remplacement.</span>
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn primary small" data-act="swapyes">Basculer</button>
        <button class="dk-btn small" data-act="swapno">Annuler</button>
      </div></div>`;
    box.querySelector('[data-act="swapno"]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-act="swapyes"]').onclick = async () => {
      try {
        const newBanc = _bancOf(p).filter(x => x !== b.id);
        await _api('/page/' + p.id, { method: 'PATCH', body: { art_id: b.id, banc: newBanc } });
        await _api('/article/' + a.id, { method: 'PATCH', body: { histo_add: `Remplacé au n° ${_D.issue.num} (page ${p.n})` } });
        await _api('/article/' + b.id, { method: 'PATCH', body: { histo_add: `Titularisé p. ${p.n} du n° ${_D.issue.num}` } });
        _toast(`« ${b.title} » devient titulaire.`);
        await _loadIssue(true); _openInsp(p.n, true);
      } catch (e) { _toast(e.message, true); }
    };
  }));
  // Ajouter au banc
  insp.querySelector('[data-act="addbanc"]').addEventListener('click', () => {
    const placed = new Set(_D.pages.filter(x => x.art_id).map(x => x.art_id));
    const inBanc = new Set(_bancOf(p));
    const cands = (_D.articles || []).filter(x => x.id !== a.id && !placed.has(x.id) && !inBanc.has(x.id) && !['publie', 'abandonne'].includes(x.status));
    const box = insp.querySelector('[data-slot="bancpick"]');
    box.innerHTML = cands.length ? cands.slice(0, 30).map(x => `
      <div class="dk-banc-item">
        <div class="dk-banc-info"><div class="dk-banc-title">${_esc(x.title)}</div>
        <div class="dk-banc-meta">${_rubById(x.rub_id) ? _esc(_rubById(x.rub_id).name) : 'Sans rubrique'} · ${(STATUS[x.status] || {}).label || x.status}</div></div>
        <button class="dk-btn small" data-pick="${x.id}">Au banc</button>
      </div>`).join('') : `<p class="dk-empty-line">Aucun article libre à mettre au banc.</p>`;
    box.querySelectorAll('[data-pick]').forEach(bp => bp.onclick = async () => {
      try {
        await _api('/page/' + p.id, { method: 'PATCH', body: { banc: _bancOf(p).concat(bp.dataset.pick) } });
        await _loadIssue(true); _openInsp(p.n, true);
      } catch (e) { _toast(e.message, true); }
    });
  });

  // Simulation en direct (recalcul local, rien d'écrit sans Appliquer)
  const range = insp.querySelector('[data-k="simrange"]');
  if (range) {
    const sim = insp.querySelector('[data-slot="sim"]');
    range.addEventListener('input', () => {
      const off = parseInt(range.value, 10);
      const base = new Date(a.due + 'T12:00:00');
      const simDue = new Date(base.getTime() + off * DAY);
      insp.querySelector('[data-slot="simval"]').textContent = _fmtD(simDue) + (off ? ` (${off > 0 ? '+' : ''}${off} j)` : '');
      sim.classList.toggle('active', off !== 0);
      // Recalcul global temporaire : on injecte la date candidate puis on rend
      const realDue = a.due;
      if (off !== 0) a.due = simDue.toISOString().slice(0, 10);
      _renderRail(); _renderFrise();
      const c2 = _computeArt(a);
      a.due = realDue;
      const live = insp.querySelector('[data-slot="simlive"]');
      const j2 = off !== 0 ? (() => { const rd = a.due; a.due = simDue.toISOString().slice(0, 10); const jj = _computeJalons(); a.due = rd; return jj; })() : null;
      live.innerHTML = off === 0 ? '' :
        `Marge de l'article : <strong class="${_stateOf(c2.marge)}">${_margeTxt(c2.marge)}</strong>` +
        (j2 && j2.impProj ? ` · envoi imprimeur projeté : <strong class="rouge">${_fmtD(j2.impProj)}</strong>` : ' · l\'envoi imprimeur tient');
      if (off === 0) { _renderRail(); _renderFrise(); }
    });
    insp.querySelector('[data-act="simapply"]').onclick = () => {
      const off = parseInt(range.value, 10);
      const d = new Date(new Date(a.due + 'T12:00:00').getTime() + off * DAY).toISOString().slice(0, 10);
      patchArt({ due: d }, 'Nouvelle date de remise appliquée.');
    };
    insp.querySelector('[data-act="simcancel"]').onclick = () => { range.value = 0; range.dispatchEvent(new Event('input')); };
  }
}

// ── Formulaire article (création / édition) ─────────────────────
function _openArtForm(page, existing) {
  const insp = _root.querySelector('[data-slot="insp"]');
  const rubs = _D.rubriques || [];
  const a = existing || null;
  insp.innerHTML = _inspShell(a ? 'Modifier l\'article' : 'Nouvel article', null,
    `<div class="dk-sec">
      <label class="dk-field"><span>Titre</span><input type="text" data-k="title" maxlength="240" value="${_esc(a ? a.title : '')}" placeholder="Titre de l'article"></label>
      <label class="dk-field"><span>Rubrique</span><select data-k="rub">
        <option value="">Sans rubrique</option>
        ${rubs.map(r => `<option value="${r.id}" ${a && a.rub_id === r.id ? 'selected' : ''}>${_esc(r.name)}</option>`).join('')}
      </select></label>
      <label class="dk-field"><span>Contributeur</span><input type="text" data-k="contrib" maxlength="160" value="${_esc(a ? (a.contrib || '') : '')}" placeholder="ex. Col. D. Mahieu"></label>
      <label class="dk-field"><span>Statut</span><select data-k="status">
        ${['propose', 'attendu', 'remis', 'relu', 'maquette'].map(s => `<option value="${s}" ${a && a.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}
      </select></label>
      <label class="dk-field"><span>Remise prévue</span><input type="date" data-k="due" value="${a && a.due ? a.due : ''}"></label>
      <div class="dk-btn-row" style="margin-top:12px">
        <button class="dk-btn primary" data-act="saveart">${a ? 'Enregistrer' : 'Créer'}</button>
        <button class="dk-btn" data-act="cancelart">Annuler</button>
      </div>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  insp.querySelector('[data-act="cancelart"]').onclick = () => { if (page) _openInsp(page.n, true); else _closeInsp(); };
  insp.querySelector('[data-act="saveart"]').onclick = async () => {
    const g = k => insp.querySelector(`[data-k="${k}"]`).value;
    if (!g('title').trim()) { _toast('Le titre est requis', true); return; }
    const body = { title: g('title').trim(), rub_id: g('rub') || null, contrib: g('contrib').trim(), status: g('status'), due: g('due') || null };
    try {
      if (a) {
        await _api('/article/' + a.id, { method: 'PATCH', body });
        _toast('Article mis à jour.');
      } else {
        const r = await _api('/publication/' + _pubId + '/article', { method: 'POST', body });
        if (page) await _api('/page/' + page.id, { method: 'PATCH', body: { kind: 'article', art_id: r.article.id } });
        _toast(page ? 'Article créé et réservé page ' + page.n + '.' : 'Article créé — réservez-le sur un emplacement.');
      }
      await _loadIssue(true);
      if (page) _openInsp(page.n, true); else _closeInsp();
    } catch (e) { _toast(e.message, true); }
  };
}

/* ═══════════════════ Réglages (publication / numéro / équipe) ══ */
async function _openSettings() {
  if (!_pubId) return;
  const insp = _root.querySelector('[data-slot="insp"]');
  const pub = _pubs.find(p => p.id === _pubId);
  insp.innerHTML = _inspShell('Réglages — ' + (pub ? pub.name : ''), null, `<div class="dk-center"><div class="dk-spin"></div></div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  let team = { members: [], invites: [] };
  try { team = await _api('/publication/' + _pubId + '/team'); } catch (_) {}
  const jalons = (() => { try { return JSON.parse(_D?.issue?.jalons || '{}'); } catch (_) { return {}; } })();
  const rubs = _D?.rubriques || [];
  insp.innerHTML = _inspShell('Réglages — ' + (pub ? pub.name : ''), null, `
    ${pub && pub.owner ? `<div class="dk-sec"><h4>Publication</h4>
      <div class="dk-form-row">
        <input type="text" data-k="pubname" maxlength="120" value="${_esc(pub.name)}">
        <button class="dk-btn small" data-act="renamepub">Renommer</button>
      </div>
    </div>` : ''}

    ${_D?.issue ? `<div class="dk-sec"><h4>Jalons du n° ${_esc(_D.issue.num)}</h4>
      ${JALON_DEFS.map(j => `<label class="dk-field dk-field-row"><span>${j.name}</span><input type="date" data-jalon="${j.key}" value="${jalons[j.key] || ''}"></label>`).join('')}
      <div class="dk-btn-row"><button class="dk-btn small primary" data-act="savejalons">Enregistrer les jalons</button></div>
    </div>` : ''}

    <div class="dk-sec"><h4>Rubriques (liste fermée)</h4>
      <div data-slot="rublist">${rubs.map(r => `
        <div class="dk-banc-item">
          <span class="dk-pc-dot" style="background:${r.color}"></span>
          <div class="dk-banc-info"><div class="dk-banc-title">${_esc(r.name)}</div></div>
          <button class="dk-btn small ghost" data-delrub="${r.id}" title="Supprimer">${icon('x', 13)}</button>
        </div>`).join('')}</div>
      <div class="dk-form-row">
        <input type="text" data-k="newrub" maxlength="60" placeholder="Nouvelle rubrique">
        <input type="color" data-k="newrubcolor" value="#8d93a8" title="Couleur">
        <button class="dk-btn small" data-act="addrub">Ajouter</button>
      </div>
    </div>

    <div class="dk-sec"><h4>Équipe</h4>
      ${team.members.map(m => `<div class="dk-banc-item">
        <div class="dk-banc-info"><div class="dk-banc-title">${_esc(m.name || m.email || m.sub.slice(0, 10))}${m.me ? ' (vous)' : ''}</div>
        <div class="dk-banc-meta">${m.owner ? 'propriétaire' : 'membre'}${m.email ? ' · ' + _esc(m.email) : ''}</div></div>
        ${pub && pub.owner && !m.owner ? `<button class="dk-btn small ghost" data-delmember="${m.sub}">${icon('x', 13)}</button>` : ''}
      </div>`).join('')}
      ${team.invites.map(i => `<div class="dk-banc-item" style="opacity:.65">
        <div class="dk-banc-info"><div class="dk-banc-title">${_esc(i.email)}</div><div class="dk-banc-meta">invitation en attente — s'activera à sa prochaine connexion</div></div>
      </div>`).join('')}
      ${pub && pub.owner ? `<div class="dk-form-row">
        <input type="email" data-k="inviteemail" maxlength="200" placeholder="e-mail du membre à inviter">
        <button class="dk-btn small" data-act="invite">Inviter</button>
      </div>
      <p class="dk-note">Le membre doit avoir une licence Keystone : l'invitation s'applique à sa prochaine ouverture de desK (même e-mail).</p>` : ''}
    </div>`);
  _bindClose(insp);

  insp.querySelector('[data-act="renamepub"]')?.addEventListener('click', async () => {
    const name = insp.querySelector('[data-k="pubname"]').value.trim();
    if (!name) return;
    try { await _api('/publication/' + _pubId, { method: 'PATCH', body: { name } }); pub.name = name; _renderPubSlot(); _toast('Publication renommée.'); }
    catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="savejalons"]')?.addEventListener('click', async () => {
    const body = {};
    insp.querySelectorAll('[data-jalon]').forEach(i => { if (i.value) body[i.dataset.jalon] = i.value; });
    try { await _api('/issue/' + _issueId, { method: 'PATCH', body: { jalons: body } }); _toast('Jalons enregistrés.'); await _loadIssue(true); }
    catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="addrub"]')?.addEventListener('click', async () => {
    const name = insp.querySelector('[data-k="newrub"]').value.trim();
    if (!name) return;
    try {
      await _api('/publication/' + _pubId + '/rubrique', { method: 'POST', body: { name, color: insp.querySelector('[data-k="newrubcolor"]').value } });
      await _loadIssue(true); _openSettings();
    } catch (e) { _toast(e.message, true); }
  });
  insp.querySelectorAll('[data-delrub]').forEach(b => b.onclick = async () => {
    try { await _api('/rubrique/' + b.dataset.delrub, { method: 'DELETE' }); await _loadIssue(true); _openSettings(); }
    catch (e) { _toast(e.message, true); }
  });
  insp.querySelectorAll('[data-delmember]').forEach(b => b.onclick = async () => {
    try { await _api('/publication/' + _pubId + '/member/' + b.dataset.delmember, { method: 'DELETE' }); _toast('Membre retiré.'); _openSettings(); }
    catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="invite"]')?.addEventListener('click', async () => {
    const email = insp.querySelector('[data-k="inviteemail"]').value.trim();
    if (!email) return;
    try { await _api('/publication/' + _pubId + '/invite', { method: 'POST', body: { email } }); _toast('Invitation enregistrée pour ' + email + '.'); _openSettings(); }
    catch (e) { _toast(e.message, true); }
  });
}

// ── Toast ───────────────────────────────────────────────────────
function _toast(msg, isErr = false) {
  const t = _root?.querySelector('[data-slot="toast"]');
  if (!t) return;
  t.textContent = msg;
  t.className = 'dk-toast on' + (isErr ? ' err' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('on'), 3200);
}
