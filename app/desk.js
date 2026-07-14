// ═══════════════════════════════════════════════════════════════
// desK — Pad O-DSK-001 · DK-4 (adresse de dépôt & digestion)
//
// Chemin de fer vivant d'une revue (DESK_BRIEF.md) : grille de
// planches EN RANGÉES (le chemin de fer papier au mur), curseur de
// taille des cartes à la InDesign, rail des jalons fixe, inspecteur
// latéral, marbre transversal (fraîcheur, reports, rituel de
// bouclage), multi-articles par page (emplacements), sélection
// multiple + opérations par lot, déplacement par insertion (pages
// figées ancrées) — branché sur le worker.
//
// DK-3 : casier de pièces éphémères (upload présigné R2 ou direct
// streamé, glisser des fichiers sur une carte, quota visible, purge
// post-impression côté serveur) + relances « brouillon proposé »
// (§5.4 : la relance À FAIRE est CALCULÉE — échéance + retard moyen
// interne du contributeur — donc le pointage l'annule de lui-même ;
// gabarit déterministe ZÉRO IA, on ajuste puis Resend).
//
// DK-4 : le bac « à trier » (§5.3) — les e-mails des contributeurs
// arrivent sur <slug>@ (worker), la digestion rattache le
// sûr toute seule et pose le doute ICI : bandeau en tête de frise,
// suggestion pré-cochée, confirmation 1 clic, spontanés → marbre.
// Chaque confirmation apprend (e-mail du contributeur, habitude de
// rubrique). Adresse de dépôt réglable (slug) dans les réglages.
//
// ⚠ TENANT = LA PUBLICATION (pas la personne). Le front ne fait que
// choisir une publication ; l'appartenance est contrôlée serveur
// (dk_members). Rôles identiques sur le contenu ; le propriétaire
// administre (renommer, inviter).
//
// Le calcul de marge vit ICI (client), simple et explicable (§2 du
// brief) : copiePrête = max(aujourd'hui, remise) ; le bouclage ne
// contraint QUE les copies non remises (règle apprise au harnais —
// sinon tout s'allume à J−2). La marge d'une CARTE = min des marges
// de ses articles (§2.4). Partage d'équipe : rafraîchissement
// périodique + « modifié par X il y a N min ». PAS de temps réel.
//
// ISOLATION : préfixe dk- (CSS/DOM) / dk_ (localStorage, tables D1).
// ZÉRO IA. Mobile = consultation + pointage (pas de drag au doigt).
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { openGhostwriterChained }             from './ghostwriter.js';   // DK-5 : passerelle relecture (round-trip → relu)

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
const ISSUE_STATUS_DEFS = [
  { key: 'preparation', label: 'préparation' },
  { key: 'production',  label: 'production' },
  { key: 'boucle',      label: 'bouclé' },
  { key: 'imprime',     label: 'imprimé' },
];
const AMBRE_SEUIL = 3;          // marge ≤ 3 j → ambre ; < 0 → rouge (règle dure §3.3)

// ── État ────────────────────────────────────────────────────────
let _root = null, _me = null, _pubs = [], _pubId = null, _issueId = null;
let _D = null;                  // { issue, pages, slots, articles, rubriques } du numéro affiché
let _selN = null, _selSlot = 0, _pollTimer = null, _offline = false;
let _view = 'fer';              // 'fer' | 'marbre'
let _size = (() => { const v = parseInt(localStorage.getItem('dk_cardsize'), 10); return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 2; })();
let _msel = new Set(), _mselAnchor = null, _embark = false;
let _mf = { q: '', rub: '', fresh: '', statut: 'vivant' };   // filtres du marbre
let _toastTimer = null;
let _ppFile = null;             // DK-6 : PDF final retenu en mémoire (contrôle + pont booK)
let _writer = null;             // éditeur d'article ouvert : { artId, timer, dirty, saving, back }

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
// Envoi binaire (casier, mode direct) : le fichier part en body brut,
// streamé par le worker vers R2 — pas de timeout court (photo HD).
async function _apiBlob(path, file) {
  const res = await fetch(API_BASE + '/api/desk' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + _jwt(), 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Erreur ' + res.status));
  return data;
}
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
    <div class="dk-mselbar" data-slot="mselbar"></div>
    <div class="dk-writer" data-slot="writer"></div>
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
  if (_writer) { clearTimeout(_writer.timer); _writer = null; }
  document.removeEventListener('keydown', _onKey);
  document.removeEventListener('visibilitychange', _onVisibility);
  _root.remove();
  _root = null; _me = null; _pubs = []; _pubId = null; _issueId = null;
  _D = null; _selN = null; _selSlot = 0; _offline = false; _view = 'fer';
  _msel = new Set(); _mselAnchor = null; _embark = false;
  _ppFile = null;
  document.body.style.overflow = '';
}

function _onKey(e) {
  if (e.key !== 'Escape') return;
  if (_root.querySelector('.dk-writer.on')) { _closeWriter(); return; }
  if (_root.querySelector('.dk-insp.on')) { _closeInsp(); return; }
  if (_msel.size) { _clearMsel(); return; }
  _onBack();
}
function _onBack() { if (_writer) { _closeWriter(); return; } closeDesk(); }
function _onVisibility() { if (!document.hidden && _issueId && !_writer) _loadIssue(true); }

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
    _pollTimer = setInterval(() => { if (!document.hidden && _issueId && !_writer) _loadIssue(true); }, POLL_MS);
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
    _signalReports();
  } catch (e) {
    if (String(e.message) === 'offline') { _offline = true; if (!silent) _toast('Hors ligne — lecture seule sur la dernière version connue', true); if (_D) _renderFer(); }
    else if (!silent) _toast(e.message, true);
  }
}

// Rituel de bouclage, versant lecture : « N articles reportés attendent au
// marbre » à l'ouverture d'un numéro en préparation (une fois par appareil).
function _signalReports() {
  if (!_D || !_D.issue || _D.issue.status !== 'preparation') return;
  const key = 'dk_reports_seen_' + _D.issue.id;
  if (localStorage.getItem(key)) return;
  const n = (_D.articles || []).filter(a => _isReported(a) && !['publie', 'abandonne'].includes(a.status) && !_placementsOf(a.id).tit.length).length;
  if (!n) return;
  localStorage.setItem(key, '1');
  _toast(n + (n > 1 ? ' articles reportés attendent' : ' article reporté attend') + ' au marbre.');
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
    _pubId = b.dataset.pub; _issueId = b.dataset.issue; _selN = null; _clearMsel();
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

/* ═══ Numérotation d'affichage (option par publication) ═══
   L'ordre PHYSIQUE des pages (p.n) ne bouge JAMAIS — il pilote le drag, le
   move, la confrontation au PDF. Ces helpers ne changent QUE le folio AFFICHÉ.
   Demande L'Épaulette : la couverture est hors numérotation (« Couverture »),
   la page qui suit démarre à 0, donc le sommaire (3ᵉ page physique) porte le 1. */
function _numOpt() {
  const pub = _pubs.find(p => p.id === _pubId) || {};
  return { cover: !!pub.cover_unnumbered, first: Number.isFinite(pub.first_folio) ? pub.first_folio : 1 };
}
function _dispN(n) {                     // folio affiché ; null = couverture non numérotée
  const o = _numOpt();
  if (o.cover && n === 1) return null;
  return o.first + (n - (o.cover ? 2 : 1));
}
function _pn(n) { const d = _dispN(n); return d === null ? 'couv.' : String(d); }   // pour « p. X », toasts…
function _pageLabel(p) {                 // en-tête de fiche : « page 3 » ou « Couverture »
  const d = _dispN(p.n);
  return d === null ? (p.fixe_tag || p.fixe_title || 'Couverture') : 'page ' + d;
}
function _plancheLabel(pl) {             // libellé sous une planche de la frise
  const o = _numOpt();
  if (o.cover && pl.length === 1 && pl[0].n === 1)
    return _esc(pl[0].fixe_tag || pl[0].fixe_title || 'Couverture');
  return pl.length === 2 ? _pn(pl[0].n) + '–' + _pn(pl[1].n) : _pn(pl[0].n);
}
function _artById(id) { return (_D.articles || []).find(a => a.id === id) || null; }
function _rubById(id) { return (_D.rubriques || []).find(r => r.id === id) || null; }
// Teinte de rubrique pour les cartes (design Stéphane 2026-07-12 : bordure
// + bandeau haut de la couleur de rubrique, fond teinté profond, textes
// recontrastés — la rubrique se lit d'un seul coup d'œil, sans pastille).
function _rgbOf(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return [127, 127, 127];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _rgba(hex, a) { const [r, g, b] = _rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
function _mixTo(hex, target, ratio) {   // mélange chaque canal vers target (0 ou 255)
  const [r, g, b] = _rgbOf(hex).map(c => Math.round(c + (target - c) * ratio));
  return `rgb(${r},${g},${b})`;
}
function _rubVars(rub, alpha = 0.3) {
  if (!rub) return '';
  return ` style="--dk-rub:${rub.color};--dk-rub-tint:${_rgba(rub.color, alpha)};--dk-rub-lite:${_mixTo(rub.color, 255, 0.55)};--dk-rub-deep:${_mixTo(rub.color, 0, 0.4)}"`;
}
function _slotsOf(p) { return (_D.slots || []).filter(s => s.page_id === p.id).sort((a, b) => a.position - b.position); }
function _bancOf(s) { try { const b = JSON.parse(s.banc || '[]'); return Array.isArray(b) ? b : []; } catch (_) { return []; } }
const _isDone = a => ['maquette', 'publie'].includes(a.status);

// Marge d'une CARTE = min des marges de ses articles non terminés (§2.4).
function _computeCard(p) {
  const arts = _slotsOf(p).map(s => _artById(s.art_id)).filter(Boolean);
  let marge = null, allDone = arts.length > 0;
  for (const a of arts) {
    if (_isDone(a) || a.status === 'abandonne') continue;
    allDone = false;
    const m = _computeArt(a).marge;
    if (m !== null && (marge === null || m < marge)) marge = m;
  }
  return { arts, marge, allDone };
}
function _computeJalons() {
  let minB = Infinity, minM = Infinity;
  for (const s of (_D.slots || [])) {
    if (!s.art_id) continue;
    const a = _artById(s.art_id); if (!a) continue;
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

/* ═══════════ Marbre : fraîcheur, reports, réservations ═════════ */
function _freshInfo(a) {
  if (a.fresh !== 'date') return { label: 'intemporel', cls: '' };
  if (!a.perime) return { label: 'daté', cls: '' };
  const d = new Date(a.perime + 'T12:00:00');
  if (d.getTime() < Date.now()) return { label: 'périmé depuis le ' + _fmtD(d), cls: 'rouge' };
  const jP = _jalonDate('parution');
  if (jP && d.getTime() < jP.getTime()) return { label: 'périme le ' + _fmtD(d) + ' — à publier dans ce numéro ou jamais', cls: 'ambre' };
  return { label: 'daté — périme le ' + _fmtD(d), cls: '' };
}
function _histoOf(a) { try { const h = JSON.parse(a.histo || '[]'); return Array.isArray(h) ? h : []; } catch (_) { return []; } }
function _isReported(a) { return _histoOf(a).some(x => /Reversé au marbre|Remplacé au n°/.test(x)); }
function _placementsOf(artId) {
  const tit = [], banc = [];
  const pgById = new Map(_D.pages.map(p => [p.id, p]));
  for (const s of (_D.slots || [])) {
    const pg = pgById.get(s.page_id); if (!pg) continue;
    if (s.art_id === artId) tit.push(pg.n);
    else if (_bancOf(s).includes(artId)) banc.push(pg.n);
  }
  return { tit, banc };
}

/* ═══════════ DK-3 · Casier & relances (helpers) ═════════════════ */
function _filesOf(p) { return (_D.files || []).filter(f => f.page_id === p.id); }
function _fmtSize(b) {
  b = b || 0;
  if (b >= 1073741824) return (b / 1073741824).toFixed(1).replace('.', ',') + ' Go';
  if (b >= 1048576) return (b / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  return Math.max(1, Math.round(b / 1024)) + ' Ko';
}
function _contribByName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return (_D.contribs || []).find(c => (c.name || '').trim().toLowerCase() === n) || null;
}
function _relancesOf(artId) { return (_D.relances || []).filter(r => r.art_id === artId); }

/* La relance À FAIRE se calcule, elle n'est jamais stockée (§5.4) :
   - contributeur fiable ou inconnu → relance DOUCE 2 j après l'échéance ;
   - retard moyen constaté > 5 j → RAPPEL 3 j avant l'échéance ;
   - une relance envoyée < 7 j suspend la suggestion ;
   - le pointage (statut ≠ attendu) la fait disparaître d'elle-même.    */
function _relanceInfo(a) {
  const st = STATUS[a.status] || STATUS.propose;
  if (!st.needsCopy || !a.due || !a.contrib) return null;
  const c = _contribByName(a.contrib);
  const avg = c && c.n_remises ? c.total_delay / c.n_remises : null;
  const offset = (avg !== null && avg > 5) ? -3 : 2;
  const at = new Date(new Date(a.due + 'T12:00:00').getTime() + offset * DAY);
  if (Date.now() < at.getTime()) return null;
  const last = _relancesOf(a.id)[0];
  if (last && (Date.now() - new Date(last.sent_at + (last.sent_at.endsWith('Z') ? '' : 'Z')).getTime()) < 7 * DAY) return null;
  return { at, mode: offset < 0 ? 'avant' : 'apres', email: c ? c.email : null };
}
function _relancesDues() {
  return (_D && _D.articles || []).filter(a => !['publie', 'abandonne'].includes(a.status) && _relanceInfo(a));
}

// Gabarit de brouillon (déterministe, ZÉRO IA) — la voix reste la sienne.
function _relanceDraft(a) {
  const pub = _pubs.find(p => p.id === _pubId);
  const revue = pub ? pub.name : 'La rédaction';
  const num = _D.issue ? _D.issue.num : '';
  const due = a.due ? new Date(a.due + 'T12:00:00') : null;
  const late = due ? Math.round((Date.now() - due.getTime()) / DAY) : 0;
  const jB = _jalonDate('bouclage');
  // Dates en toutes lettres dans la prose (« 7 juillet » — l'abréviation
  // « juil. » créerait un double point en fin de phrase).
  const fmtL = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const subject = `${revue} n° ${num} — votre article « ${a.title} »`;
  let corps;
  if (late > 0) {
    corps = `nous préparons le n° ${num}${_D.issue && _D.issue.theme ? ' (' + _D.issue.theme + ')' : ''} et votre article « ${a.title} » était attendu pour le ${fmtL(due)}.\n\nPourriez-vous nous dire où vous en êtes ? ${jB ? 'Le bouclage rédactionnel est fixé au ' + fmtL(jB) + ' — ' : ''}même un texte encore imparfait nous aide à avancer la maquette.`;
  } else {
    corps = `petit rappel amical : votre article « ${a.title} » pour le n° ${num} est attendu pour le ${fmtL(due)}.${jB ? '\n\nLe bouclage rédactionnel est fixé au ' + fmtL(jB) + '.' : ''}`;
  }
  const body = `Bonjour,\n\n${corps}\n\nMerci beaucoup, bien cordialement,\n${_me && _me.name ? _me.name : 'La rédaction'}`;
  return { subject, body };
}

/* ═══════════ DK-5 · Passerelles (Ghost Writer / networK) ═══════════
   §7 du brief : réutiliser l'existant, ne RIEN dupliquer.
   - Ghost Writer : la copie part en relecture (ortho/typo/style) dans le modal
     léger, PAR-DESSUS desK (aller-retour) — au retour, on marque l'article
     « relu » via l'action déjà là. AUCUN moteur de relecture ici.
   - networK : SUGGESTION seulement (jamais d'aspiration §7) — ouvre networK
     avec le formulaire « nouveau contact » pré-rempli du contributeur. Le
     réseau reste le coffre PERSONNEL de chacun ; desK ne fait que proposer. */
function _hasCopy(a) { return !!(a && typeof a.notes === 'string' && a.notes.trim()); }
function _passerellesHTML(a) {
  const gw  = _hasCopy(a) && a.status !== 'abandonne';
  const net = !!(a && a.contrib);
  if (!gw && !net) return '';
  return `<div class="dk-sec"><h4>Passerelles</h4><div class="dk-btn-row">
      ${gw  ? `<button class="dk-btn" data-act="gw" title="Relecture ortho/typo/style dans Ghost Writer — au retour, marquez « relu »">${icon('ghostwriter', 14)} Relire avec Ghost Writer</button>` : ''}
      ${net ? `<button class="dk-btn" data-act="tonet" title="Suggérer ${_esc(a.contrib || 'le contributeur')} à votre réseau personnel networK">${icon('network', 14)} Ajouter à networK</button>` : ''}
    </div>
  </div>`;
}
function _bindPasserelles(insp, a) {
  insp.querySelector('[data-act="gw"]')?.addEventListener('click', () => {
    try { openGhostwriterChained(a.notes || ''); }   // modal léger, par-dessus desK (round-trip)
    catch (e) { _toast('Ghost Writer indisponible.', true); }
  });
  insp.querySelector('[data-act="tonet"]')?.addEventListener('click', async () => {
    const c = _contribByName(a.contrib);
    const seed = { kind: 'person', name: a.contrib };
    if (c && c.email) seed.email = c.email;
    // networK est un workspace plein écran : on ferme desK avant (piège z-index).
    closeDesk();
    try { const m = await import('./ui-renderer.js'); m.openTool('O-NET-001', { createContact: seed }); } catch (_) {}
  });
}

/* ═══════════ Éditeur d'article — écriture confortable ═══════════
   La copie de l'article vit dans `notes` (durable, 60k côté worker — ce
   n'est PAS le casier éphémère). Surface plein écran, colonne de lecture,
   autosave débounce + à la fermeture. desK reste un chemin de fer : on écrit
   le texte au fil (intertitres = lignes vides), pas de traitement de texte
   riche. Le pont Ghost Writer reste là pour la relecture ortho/typo/style. */
function _wordCount(s) { const t = String(s || '').trim(); return t ? t.split(/\s+/).length : 0; }
function _copyBadge(a) {
  const w = _wordCount(a && a.notes);
  return w ? `${w} mot${w > 1 ? 's' : ''}` : 'aucun texte';
}
function _openWriter(artId, back) {
  const a = _artById(artId);
  if (!a) return;
  const box = _root.querySelector('[data-slot="writer"]');
  _writer = { artId, timer: null, dirty: false, saving: false, back: back || null };
  box.innerHTML = `
    <div class="dk-wr-bar">
      <button class="dk-wr-close" data-act="wrback" aria-label="Fermer l'éditeur" title="Fermer (Échap)">${icon('chevron-left', 22)}<span>desK</span></button>
      <div class="dk-wr-titlewrap">
        <input class="dk-wr-title" data-k="wrtitle" maxlength="240" value="${_esc(a.title)}" placeholder="Titre de l'article" spellcheck="true">
        <div class="dk-wr-sub">${_esc(_rubById(a.rub_id)?.name || 'Sans rubrique')}${a.contrib ? ' · ' + _esc(a.contrib) : ''}</div>
      </div>
      <div class="dk-wr-state" data-slot="wrstate"></div>
    </div>
    <div class="dk-wr-scroll">
      <div class="dk-wr-col">
        <textarea class="dk-wr-body" data-k="wrbody" spellcheck="true" placeholder="Écrivez l'article ici…&#10;&#10;Une ligne vide sépare les paragraphes. Le texte s'enregistre tout seul et voyage avec l'article d'un numéro à l'autre.">${_esc(a.notes || '')}</textarea>
      </div>
    </div>
    <div class="dk-wr-foot"><span data-slot="wrcount"></span></div>`;
  box.classList.add('on');
  const ta = box.querySelector('[data-k="wrbody"]');
  const title = box.querySelector('[data-k="wrtitle"]');
  const count = box.querySelector('[data-slot="wrcount"]');
  const state = box.querySelector('[data-slot="wrstate"]');
  const setCount = () => { const w = _wordCount(ta.value); count.textContent = `${w} mot${w > 1 ? 's' : ''} · ${ta.value.length} car.`; };
  const schedule = () => { _writer.dirty = true; state.textContent = '…'; clearTimeout(_writer.timer); _writer.timer = setTimeout(() => _saveWriter(), 900); };
  setCount();
  ta.addEventListener('input', () => { setCount(); schedule(); });
  title.addEventListener('input', schedule);
  box.querySelector('[data-act="wrback"]').addEventListener('click', () => _closeWriter());
  ta.focus();
}
async function _saveWriter() {
  if (!_writer) return;
  const box = _root.querySelector('[data-slot="writer"]');
  const ta = box?.querySelector('[data-k="wrbody"]');
  const title = box?.querySelector('[data-k="wrtitle"]');
  const state = box?.querySelector('[data-slot="wrstate"]');
  if (!ta) return;
  const a = _artById(_writer.artId);
  const body = {};
  const t = (title.value || '').trim();
  if (t && (!a || t !== a.title)) body.title = t;
  if (!a || ta.value !== (a.notes || '')) body.notes = ta.value;
  if (!Object.keys(body).length) { _writer.dirty = false; if (state) state.textContent = 'Enregistré'; return; }
  _writer.saving = true;
  try {
    await _api('/article/' + _writer.artId, { method: 'PATCH', body });
    _writer.dirty = false;
    if (a) { if (body.notes !== undefined) a.notes = body.notes; if (body.title !== undefined) a.title = body.title; }
    if (state) state.textContent = 'Enregistré';
  } catch (e) {
    if (state) state.textContent = 'Non enregistré';
    _toast('Écriture non enregistrée : ' + e.message, true);
  } finally { _writer.saving = false; }
}
async function _closeWriter() {
  if (!_writer) return;
  const box = _root.querySelector('[data-slot="writer"]');
  clearTimeout(_writer.timer);
  if (_writer.dirty && !_writer.saving) await _saveWriter();
  const { back, artId } = _writer;
  _writer = null;
  box.classList.remove('on');
  box.innerHTML = '';
  await _loadIssue(true);
  if (_view === 'marbre') _renderMarbre();
  if (back) back(); else _openInspMarbre(artId);
}

// Upload d'une liste de fichiers vers le casier d'une page (présigné ou direct).
async function _uploadFiles(page, fileList, refresh) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (_D.casier === 'off') { _toast('Le casier n’est pas configuré sur ce serveur.', true); return; }
  for (const f of files) {
    try {
      _toast('Envoi de « ' + f.name + ' »…');
      const req = await _api('/page/' + page.id + '/casier', { method: 'POST', body: { name: f.name, size: f.size } });
      if (req.upload.mode === 'presigned') {
        const put = await fetch(req.upload.url, { method: 'PUT', body: f, headers: { 'Content-Type': req.upload.content_type } });
        if (!put.ok) throw new Error('le stockage a refusé le fichier (HTTP ' + put.status + ')');
        await _api('/casier/' + req.file.id + '/complete', { method: 'POST' });
      } else {
        await _apiBlob('/casier/' + req.file.id + '/put', f);
      }
      _toast('« ' + f.name + ' » transmis au casier.');
    } catch (e) { _toast('Échec de « ' + f.name + ' » : ' + e.message, true); }
  }
  await _loadIssue(true);
  if (refresh) refresh();
}

// Section « Casier » commune aux inspecteurs de page (article / vide / figée).
function _casierSectionHTML(p) {
  if (!_D || _D.casier === 'off') return '';
  const files = _filesOf(p);
  const q = _D.quota || { used: 0, max: 1 };
  return `<div class="dk-sec"><h4>Casier — pièces (${files.filter(f => f.status === 'ok').length})</h4>
    ${files.map(f => `<div class="dk-file">
      <span class="dk-file-ico">${icon('paperclip', 13)}</span>
      <div class="dk-file-info">
        <div class="dk-file-name">${_esc(f.name)}</div>
        <div class="dk-file-meta">${_fmtSize(f.size)}${f.uploaded_by ? ' · ' + _esc(f.uploaded_by) : ''} · ${_relTime(f.created_at)}${f.status !== 'ok' ? ' · <em>envoi en cours…</em>' : ''}</div>
      </div>
      ${f.status === 'ok' ? `<button class="dk-iconbtn" data-dlf="${f.id}" title="Télécharger" aria-label="Télécharger">${icon('download', 14)}</button>` : ''}
      <button class="dk-iconbtn" data-delf="${f.id}" title="Supprimer la pièce" aria-label="Supprimer">${icon('x', 14)}</button>
    </div>`).join('') || `<p class="dk-empty-line">Aucune pièce — glissez PDF, photos ou textes sur la carte, ou déposez-les ci-dessous.</p>`}
    <div class="dk-btn-row" style="margin-top:8px">
      <button class="dk-btn small" data-act="addfile">${icon('upload-cloud', 14)} Déposer des fichiers</button>
      <input type="file" data-k="fileinput" multiple style="display:none">
    </div>
    <p class="dk-note" title="Casier de transmission éphémère — purgé ~30 j après l'impression du numéro">Purgé ~30 j après impression · ${_fmtSize(q.used)} / ${_fmtSize(q.max)}</p>
  </div>`;
}
function _bindCasier(insp, p, refresh) {
  const input = insp.querySelector('[data-k="fileinput"]');
  if (!input) return;
  insp.querySelector('[data-act="addfile"]').onclick = () => input.click();
  input.addEventListener('change', () => { _uploadFiles(p, input.files, refresh); input.value = ''; });
  _bindFileButtons(insp, refresh);
}
// Télécharger / supprimer une pièce — partagé casier de page & fiche marbre.
function _bindFileButtons(insp, refresh) {
  insp.querySelectorAll('[data-dlf]').forEach(b => b.onclick = async () => {
    try {
      const r = await _api('/casier/' + b.dataset.dlf + '/url');
      const link = document.createElement('a');
      link.href = r.url;
      link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
    } catch (e) { _toast(e.message, true); }
  });
  // Suppression : confirmation INLINE claire (pas d'« armé 2 clics » à minuteur
  // — invisible et fragile : un 2e clic hésitant ré-armait au lieu de supprimer).
  insp.querySelectorAll('[data-delf]').forEach(b => b.onclick = () => {
    const row = b.closest('.dk-file');
    const id = b.dataset.delf;
    if (!row || row.querySelector('.dk-file-confirm')) return;
    const name = (row.querySelector('.dk-file-name')?.textContent || 'cette pièce').trim();
    row.innerHTML = `<div class="dk-file-confirm">
      <span class="dk-file-confirm-q">Supprimer « ${_esc(name)} » ?</span>
      <span class="dk-file-confirm-acts">
        <button class="dk-btn small dk-btn-danger" data-delyes>Supprimer</button>
        <button class="dk-btn small" data-delno>Annuler</button>
      </span></div>`;
    row.querySelector('[data-delno]').onclick = () => { if (refresh) refresh(); };
    row.querySelector('[data-delyes]').onclick = async () => {
      try {
        await _api('/casier/' + id, { method: 'DELETE' });
        _toast('Pièce supprimée.');
        await _loadIssue(true);
        if (refresh) refresh();
      } catch (e) { _toast(e.message, true); }
    };
  });
}

// Déposer des pièces SUR un article, même au marbre (avant tout placement).
// Imputé au numéro couramment consulté (endpoint /article/:id/casier).
async function _uploadFilesToArt(art, fileList, refresh) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (!_D || _D.casier === 'off') { _toast('Le casier n’est pas configuré sur ce serveur.', true); return; }
  for (const f of files) {
    try {
      _toast('Envoi de « ' + f.name + ' »…');
      const req = await _api('/article/' + art.id + '/casier', { method: 'POST', body: { name: f.name, size: f.size, issue_id: _issueId } });
      if (req.upload.mode === 'presigned') {
        const put = await fetch(req.upload.url, { method: 'PUT', body: f, headers: { 'Content-Type': req.upload.content_type } });
        if (!put.ok) throw new Error('le stockage a refusé le fichier (HTTP ' + put.status + ')');
        await _api('/casier/' + req.file.id + '/complete', { method: 'POST' });
      } else {
        await _apiBlob('/casier/' + req.file.id + '/put', f);
      }
      _toast('« ' + f.name + ' » joint à l’article.');
    } catch (e) { _toast('Échec de « ' + f.name + ' » : ' + e.message, true); }
  }
  await _loadIssue(true);
  if (refresh) refresh();
}
// Section « Pièces jointes » de la fiche article (marbre) — upload compris.
function _artCasierSectionHTML(a) {
  if (!_D || _D.casier === 'off') return '';
  const files = (_D.files || []).filter(f => f.art_id === a.id);
  const q = _D.quota || { used: 0, max: 1 };
  return `<div class="dk-sec"><h4>Pièces jointes (${files.filter(f => f.status === 'ok').length})</h4>
    ${files.map(f => `<div class="dk-file">
      <span class="dk-file-ico">${icon('paperclip', 13)}</span>
      <div class="dk-file-info">
        <div class="dk-file-name">${_esc(f.name)}</div>
        <div class="dk-file-meta">${_fmtSize(f.size)}${f.uploaded_by ? ' · ' + _esc(f.uploaded_by) : ''}${f.page_id === '' ? ' · au marbre avec l’article' : ''}${f.status !== 'ok' ? ' · <em>envoi en cours…</em>' : ''}</div>
      </div>
      ${f.status === 'ok' ? `<button class="dk-iconbtn" data-dlf="${f.id}" title="Télécharger" aria-label="Télécharger">${icon('download', 14)}</button>` : ''}
      <button class="dk-iconbtn" data-delf="${f.id}" title="Supprimer la pièce" aria-label="Supprimer">${icon('x', 14)}</button>
    </div>`).join('') || `<p class="dk-empty-line">Aucune pièce — photo, PDF ou document. Déposez-les ci-dessous : elles suivent l’article, même avant sa mise en page.</p>`}
    <div class="dk-btn-row" style="margin-top:8px">
      <button class="dk-btn small" data-act="addartfile">${icon('upload-cloud', 14)} Joindre des fichiers</button>
      <input type="file" data-k="artfileinput" multiple style="display:none">
    </div>
    <p class="dk-note" title="Casier de transmission éphémère — purgé ~30 j après l'impression du numéro">Imputé au n° courant · purgé ~30 j après impression · ${_fmtSize(q.used)} / ${_fmtSize(q.max)}</p>
  </div>`;
}
function _bindArtCasier(insp, a, refresh) {
  const input = insp.querySelector('[data-k="artfileinput"]');
  if (!input) return;
  insp.querySelector('[data-act="addartfile"]').onclick = () => input.click();
  input.addEventListener('change', () => { _uploadFilesToArt(a, input.files, refresh); input.value = ''; });
  _bindFileButtons(insp, refresh);
}

/* ═══════════════════ Le chemin de fer ═══════════════════ */
function _renderFer() {
  if (!_D || !_D.issue) return;
  _renderPubSlot();
  const main = _root.querySelector('[data-slot="main"]');
  main.classList.add('dk-main-fer');
  const marbreN = (_D.articles || []).filter(a => !['publie', 'abandonne'].includes(a.status)).length;
  const newMarbre = _newMarbreCount();
  const newCards = _newCardCount();
  const newTotal = newMarbre + newCards;
  main.innerHTML = `
    ${_offline ? `<div class="dk-offline">Hors ligne — lecture seule sur la dernière version connue</div>` : ''}
    <div class="dk-rail" data-slot="rail"></div>
    <div class="dk-ferbar">
      <div class="dk-seg" data-slot="view">
        <button data-v="fer" class="${_view === 'fer' ? 'on' : ''}">Chemin de fer</button>
        <button data-v="marbre" class="${_view === 'marbre' ? 'on' : ''}">Marbre${marbreN ? ' (' + marbreN + ')' : ''}${newMarbre ? '<span class="dk-seg-new" title="' + newMarbre + ' nouvel article au marbre"></span>' : ''}</button>
      </div>
      ${_view === 'fer' ? `<div class="dk-sizer" title="Taille des cartes">
        ${icon('sliders', 13)}<input type="range" data-k="size" min="0" max="3" step="1" value="${_size}" aria-label="Taille des cartes">
      </div>` : ''}
      <span class="dk-ferbar-issue">n° ${_esc(_D.issue.num)}${_D.issue.theme ? ' · ' + _esc(_D.issue.theme) : ''} · ${_D.pages.length} pages</span>
      <span class="dk-ferbar-spacer"></span>
      ${_relancesDues().length ? `<button class="dk-btn ghost small dk-relbtn" data-act="relances" title="Copies en attente à relancer">${icon('bell', 14)}<span class="dk-btn-txt"> Relances (${_relancesDues().length})</span></button>` : ''}
      <button class="dk-btn ghost small" data-act="prepress" title="Contrôle du PDF final & édition numérique booK">${icon('printer', 14)}<span class="dk-btn-txt"> Pré-impression</span></button>
      <button class="dk-btn ghost small" data-act="newart">${icon('plus', 14)}<span class="dk-btn-txt"> Article</span></button>
    </div>
    ${(_D.inbox || []).length ? `<button class="dk-bacstrip" data-act="bac">${icon('mail', 15)}<span>${_D.inbox.length} contribution${_D.inbox.length > 1 ? 's' : ''} à rattacher</span><span class="dk-bacstrip-go">trier ${icon('chevron-right', 13)}</span></button>` : ''}
    ${newTotal ? `<div class="dk-newstrip"><span class="dk-newstrip-dot"></span><span class="dk-newstrip-txt">${_newLabel(newCards, newMarbre)}</span><button class="dk-newstrip-clear" data-act="markseen">Tout marquer comme vu</button></div>` : ''}
    ${_view === 'fer'
      ? `<div class="dk-frise-wrap" data-size="${_size}"><div class="dk-frise" data-slot="frise"></div></div>`
      : `<div class="dk-marbre-wrap" data-slot="marbre"></div>`}`;
  _renderRail();
  main.querySelector('[data-act="bac"]')?.addEventListener('click', () => _openBacList());
  main.querySelector('[data-act="markseen"]')?.addEventListener('click', () => { _markAllSeen(); _renderFer(); });
  main.querySelector('[data-slot="view"]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (_view !== b.dataset.v) { _view = b.dataset.v; _clearMsel(); _renderFer(); }
  });
  main.querySelector('[data-act="newart"]').addEventListener('click', () => _openArtForm());
  main.querySelector('[data-act="relances"]')?.addEventListener('click', () => _openRelanceList());
  main.querySelector('[data-act="prepress"]')?.addEventListener('click', () => _openPrepress());
  if (_view === 'fer') {
    _renderFrise();
    const sizer = main.querySelector('[data-k="size"]');
    sizer.addEventListener('input', () => {
      _size = parseInt(sizer.value, 10);
      localStorage.setItem('dk_cardsize', String(_size));
      main.querySelector('.dk-frise-wrap').dataset.size = String(_size);
    });
    _bindFrise();
    if (_selN !== null) _openInsp(_selN, true);
  } else {
    _renderMarbre();
  }
  _renderMselBar();
}

// Rail des jalons = TIMELINE graphique v2 (retours Stéphane 2026-07-13).
// COHÉRENCE : l'axe est PROPORTIONNEL AUX DATES — même date = même endroit
// (l'espacement égal « mentait » : deux J−64 se retrouvaient éloignés). Les
// jalons trop proches À L'ÉCRAN fusionnent en un seul nœud (noms empilés),
// l'ordre visuel = l'ordre réel des dates, et un tick doré marque AUJOURD'HUI
// (le remplissage de la ligne = le temps déjà écoulé, il s'arrête au tick).
const JALON_SHORT = { bouclage: 'Bouclage', maquette: 'Maquette', imprimeur: 'Imprimeur', parution: 'Parution' };
function _renderRail() {
  const rail = _root.querySelector('[data-slot="rail"]');
  if (!rail) return;
  const j = _computeJalons();
  const t = Date.now();
  const items = JALON_DEFS.map(def => ({ def, d: _jalonDate(def.key) })).filter(x => x.d)
    .map(x => {
      let marge = null;
      if (x.def.key === 'bouclage') marge = j.boucl;
      if (x.def.key === 'maquette') marge = j.maq;
      let cls = (marge !== null) ? _stateOf(marge) : '';
      let alert = (marge !== null && cls) ? _margeTxt(marge) : '';
      if (x.def.key === 'imprimeur' && j.impProj) { cls = 'rouge'; alert = `projeté ${_fmtD(j.impProj)} (+${j.retard} j)`; }
      return { name: JALON_SHORT[x.def.key] || x.def.name, full: x.def.name, time: x.d.getTime(), cls, alert };
    })
    .sort((a, b) => a.time - b.time);            // l'axe du temps commande, pas l'ordre de saisie
  if (!items.length) { rail.innerHTML = ''; return; }

  // Domaine : d'aujourd'hui (ou du 1er jalon passé) à la dernière échéance.
  const t0 = Math.min(t, items[0].time);
  const t1 = Math.max(items[items.length - 1].time, t0 + DAY);
  const xOf = ms => Math.max(0, Math.min(100, ((ms - t0) / (t1 - t0)) * 100));
  const nowX = xOf(t);

  rail.innerHTML = `<div class="dk-tl" style="--tl-n:${items.length}">
    <div class="dk-tl-track"><i style="width:${nowX.toFixed(2)}%"></i></div>
    <span class="dk-tl-now" style="left:${nowX.toFixed(2)}%" title="Aujourd'hui"></span>
  </div>`;
  const tl = rail.querySelector('.dk-tl');

  // Fusion des jalons trop proches à l'écran (seuil en px, mesuré).
  const W = Math.max(tl.clientWidth || 0, 320);
  const minGap = (96 / W) * 100;
  const clusters = [];
  for (const it of items) {
    const x = xOf(it.time);
    const last = clusters[clusters.length - 1];
    if (last && x - last.anchor < minGap) { last.items.push(it); last.x = (last.anchor + x) / 2; }
    else clusters.push({ anchor: x, x, items: [it] });
  }

  tl.insertAdjacentHTML('beforeend', clusters.map(c => {
    const passed = c.items.every(i => i.time < t);
    const cls = c.items.some(i => i.cls === 'rouge') ? 'rouge' : (c.items.some(i => i.cls === 'ambre') ? 'ambre' : '');
    const jmin = Math.round((Math.min(...c.items.map(i => i.time)) - t) / DAY);
    const dates = [...new Set(c.items.map(i => _fmtD(i.time)))].join(' – ');
    const alert = (c.items.find(i => i.alert) || {}).alert || '';
    const wide = c.items.length > 1 ? ' style="width:210px"' : '';
    return `<div class="dk-tl-node ${cls}${passed ? ' passed' : ''}" style="left:${c.x.toFixed(2)}%" title="${c.items.map(i => i.full + ' — ' + _fmtD(i.time)).join(' · ')}">
      <span class="dk-tl-name"${wide}>${c.items.map(i => `<span class="${i.cls}">${i.name}</span>`).join(' · ')}</span>
      <span class="dk-tl-dot"></span>
      <span class="dk-tl-days">${jmin >= 0 ? 'J−' + jmin : 'J+' + (-jmin)}</span>
      <span class="dk-tl-meta"${wide}>${dates}${alert ? ' · ' + alert : ''}</span>
    </div>`;
  }).join(''));

  // Libellé « aujourd'hui » : seulement si aucun nœud ne l'écraserait.
  if (!clusters.some(c => Math.abs(c.x - nowX) < (110 / W) * 100)) {
    tl.insertAdjacentHTML('beforeend', `<span class="dk-tl-nowlbl" style="left:${nowX.toFixed(2)}%">aujourd'hui</span>`);
  }
}

function _planches() {
  const P = _D.pages;
  if (!P.length) return [];
  const out = [[P[0]]];
  for (let i = 1; i < P.length - 1; i += 2) out.push(P[i + 1] ? [P[i], P[i + 1]] : [P[i]]);
  if (P.length > 1) out.push([P[P.length - 1]]);
  return out;
}

/* ═══════ Signal « nouvel article » (§3.6) : halo + pastille qui pulse ═══════
   Quand un article ARRIVE sur une page (réservé, copie reçue par e-mail, dossier
   étalé) ou AU MARBRE (créé), la carte pulse en doré jusqu'à ce qu'on l'ouvre.
   « Vu » = PAR APPAREIL (localStorage) : `base` posée à la 1re ouverture du numéro
   (rien d'existant ne pulse), `acked[cible]` = dernière arrivée acquittée. Doré
   volontaire — PAS le langage ambre/rouge des échéances (une arrivée est neutre).
   L'horodatage d'arrivée vient du worker (slot/pièce/article `created_at`).      */
function _nowStamp() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function _seenKey() { return 'dk_seen_v1_' + _issueId; }
function _seenState() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(_seenKey()) || 'null'); } catch (_) {}
  if (!st || typeof st !== 'object') { st = { base: _nowStamp(), acked: {} }; _seenSave(st); }
  if (!st.acked || typeof st.acked !== 'object') st.acked = {};
  return st;
}
function _seenSave(st) { try { localStorage.setItem(_seenKey(), JSON.stringify(st)); } catch (_) {} }
// Arrivée d'un article SUR une page : max des created_at des slots (réservation /
// copie e-mail rafraîchie côté worker) et des pièces reçues. PAS a.created_at (un
// vieil article réservé aujourd'hui doit pulser par le slot, pas par sa création).
function _cardArrivalTs(p) {
  let ts = '';
  for (const s of _slotsOf(p)) {
    if (s.created_at && s.created_at > ts) ts = s.created_at;
    for (const f of (_D.files || [])) {
      if (f.art_id === s.art_id && f.status === 'ok' && f.created_at && f.created_at > ts) ts = f.created_at;
    }
  }
  return ts;
}
// Arrivée d'un article AU MARBRE : sa création + ses pièces reçues.
function _artArrivalTs(a) {
  if (!a) return '';
  let ts = a.created_at || '';
  for (const f of (_D.files || [])) {
    if (f.art_id === a.id && f.status === 'ok' && f.created_at && f.created_at > ts) ts = f.created_at;
  }
  return ts;
}
function _isNew(ts, targetId) {
  if (!ts) return false;
  const st = _seenState();
  return ts > st.base && ts > (st.acked[targetId] || '');
}
function _ackSeen(targetId, ts) {
  if (!ts || !targetId) return;
  const st = _seenState();
  if (ts > (st.acked[targetId] || '')) { st.acked[targetId] = ts; _seenSave(st); }
}
function _markAllSeen() { const st = _seenState(); st.base = _nowStamp(); st.acked = {}; _seenSave(st); }
// L'utilisateur vient LUI-MÊME de poser/créer : on acquitte pour ne pas lui
// pulser sa propre action. À appeler APRÈS _loadIssue (created_at à jour).
function _ackCardById(pageId) { const p = (_D?.pages || []).find(x => x.id === pageId); if (p) _ackSeen(p.id, _cardArrivalTs(p)); }
function _ackArtById(artId) { const a = _artById(artId); if (a) _ackSeen(a.id, _artArrivalTs(a)); }
function _cardIsNew(p) { return p && p.kind === 'article' && _slotsOf(p).length > 0 && _isNew(_cardArrivalTs(p), p.id); }
function _marbreIsNew(a) { return _isNew(_artArrivalTs(a), a.id); }
function _newCardCount() { return (_D?.pages || []).filter(_cardIsNew).length; }
function _newMarbreCount() { return (_D?.articles || []).filter(a => !['publie', 'abandonne'].includes(a.status) && _marbreIsNew(a)).length; }
function _newLabel(nc, nm) {
  const t = nc + nm;
  return `${t} nouvel${t > 1 ? 's' : ''} article${t > 1 ? 's' : ''} arrivé${t > 1 ? 's' : ''}${nc && nm ? ` — ${nc} en page, ${nm} au marbre` : (nm ? ' au marbre' : ' en page')}`;
}
// Rafraîchir le bandeau « nouveaux » sans re-render complet (après un ack ponctuel).
function _refreshNewStrip() {
  const strip = _root?.querySelector('.dk-newstrip');
  if (!strip) return;
  const nc = _newCardCount(), nm = _newMarbreCount();
  if (!(nc + nm)) { strip.remove(); return; }
  const txt = strip.querySelector('.dk-newstrip-txt');
  if (txt) txt.textContent = _newLabel(nc, nm);
}

function _cardHTML(p, prevP) {
  const msel = _msel.has(p.n) ? ' msel' : '';
  const isNew = _cardIsNew(p);
  const newDot = isNew ? `<span class="dk-pc-new" title="Nouvel article arrivé"></span>` : '';
  const nFiles = _filesOf(p).filter(f => f.status === 'ok').length;
  const fileBadge = nFiles ? `<span class="dk-pc-badge">${icon('paperclip', 9)}${nFiles}</span>` : '';
  if (p.kind === 'fixe') {
    return `<div class="dk-pcard fixe locked${msel}" data-n="${p.n}">
      <span class="dk-pc-fixe-tag">${_esc(p.fixe_tag || 'Figée')}</span>
      ${p.fixe_title ? `<div class="dk-pc-title">${_esc(p.fixe_title)}</div>` : ''}
      <div class="dk-pc-foot"><div class="dk-pc-status"><span class="dk-pc-status-dot" style="background:#4cc38a"></span><span>figée</span></div></div>
      ${fileBadge ? `<div class="dk-pc-badges">${fileBadge}</div>` : ''}
    </div>`;
  }
  const slots = _slotsOf(p);
  const a = slots.length ? _artById(slots[0].art_id) : null;
  if (!a) {
    const rub = _rubById(p.rub_id);
    return `<div class="dk-pcard vide${msel}${rub ? ' rubbed' : ''}" data-n="${p.n}"${_rubVars(rub, 0.14)}>
      ${rub ? `<div class="dk-pc-rub dk-pc-rub-vide"><span>${_esc(rub.name)}</span></div>` : ''}
      <span class="dk-pc-vide-ico">${icon('plus', 20)}</span>
      <span class="dk-pc-vide-txt">réserver<br>un article</span>
      ${fileBadge ? `<div class="dk-pc-badges">${fileBadge}</div>` : ''}
    </div>`;
  }
  const st = STATUS[a.status] || STATUS.propose;
  const rub = _rubById(a.rub_id) || _rubById(p.rub_id);
  const card = _computeCard(p);
  const cls = card.allDone ? '' : _stateOf(card.marge);
  // « suite » = même titulaire que la page précédente (article étalé, dossier)
  const suite = prevP && prevP.kind === 'article' && (_slotsOf(prevP)[0] || {}).art_id === a.id;
  const bancTotal = slots.reduce((n, s) => n + _bancOf(s).length, 0);
  const badges = [];
  if (slots.length > 1) badges.push(`<span class="dk-pc-badge">${icon('copy', 9)}${slots.length}</span>`);
  if (bancTotal) badges.push(`<span class="dk-pc-badge">${icon('users', 9)}${bancTotal}</span>`);
  if (fileBadge) badges.push(fileBadge);
  return `<div class="dk-pcard ${cls}${msel}${rub ? ' rubbed' : ''}${isNew ? ' dk-new' : ''}" data-n="${p.n}" data-art="${a.id}"${_rubVars(rub)}>
    ${newDot}
    <div class="dk-pc-rub"><span>${_esc(rub ? rub.name : 'Sans rubrique')}${suite ? ' · suite' : ''}</span></div>
    <div class="dk-pc-title">${_esc(a.title)}</div>
    ${a.contrib ? `<div class="dk-pc-contrib">${_esc(a.contrib)}${slots.length > 1 ? ' +' + (slots.length - 1) : ''}</div>` : ''}
    <div class="dk-pc-foot">
      <div class="dk-pc-status"><span class="dk-pc-status-dot" style="background:${st.dot}"></span><span>${st.label}</span></div>
      <div class="dk-pc-marge">${card.allDone ? 'prêt' : _margeTxt(card.marge)}</div>
    </div>
    ${badges.length ? `<div class="dk-pc-badges">${badges.join('')}</div>` : ''}
  </div>`;
}

function _renderFrise(keepScroll = true) {
  const f = _root.querySelector('[data-slot="frise"]');
  if (!f) return;
  const sc = keepScroll ? f.scrollTop : 0;
  const pls = _planches();
  let prev = null;
  f.innerHTML = pls.map(pl => {
    const html = `
    <div class="dk-planche">
      <div class="dk-planche-pages">${pl.map(p => { const h = _cardHTML(p, prev); prev = p; return h; }).join('')}</div>
      <div class="dk-planche-num">${_plancheLabel(pl)}</div>
    </div>`;
    return html;
  }).join('');
  f.scrollTop = sc;
  if (_selN !== null) f.querySelector(`.dk-pcard[data-n="${_selN}"]`)?.classList.add('sel');
}

/* ── Sélection multiple (§3.5) : Maj+clic plage, Cmd/Ctrl+clic ── */
function _clearMsel() {
  if (!_msel.size && !_embark) return;
  _msel = new Set(); _embark = false;
  _root?.querySelectorAll('.dk-pcard.msel').forEach(x => x.classList.remove('msel'));
  _renderMselBar();
}
function _updateMselClasses() {
  const f = _root.querySelector('[data-slot="frise"]');
  if (!f) return;
  f.querySelectorAll('.dk-pcard').forEach(c => c.classList.toggle('msel', _msel.has(parseInt(c.dataset.n, 10))));
  _renderMselBar();
}
function _renderMselBar() {
  const bar = _root.querySelector('[data-slot="mselbar"]');
  if (!bar) return;
  if (!_msel.size || _view !== 'fer') { bar.classList.remove('on'); bar.innerHTML = ''; return; }
  const hasFixe = [..._msel].some(n => (_D.pages.find(p => p.n === n) || {}).kind === 'fixe');
  bar.innerHTML = `
    <span class="dk-mselbar-count">${_msel.size} page${_msel.size > 1 ? 's' : ''} sélectionnée${_msel.size > 1 ? 's' : ''}</span>
    <button class="dk-btn small" data-mact="rubrique">${icon('tag', 13)} Rubrique</button>
    <button class="dk-btn small" data-mact="contrib">${icon('user', 13)} Contributeur</button>
    <button class="dk-btn small" data-mact="spread">${icon('copy', 13)} Étaler un article</button>
    <button class="dk-btn small" data-mact="fixe">${icon('lock', 13)} Figer</button>
    <button class="dk-btn small" data-mact="libere">${icon('unlock', 13)} Libérer</button>
    ${hasFixe ? `<label class="dk-mselbar-embark" title="Par défaut, les pages figées restent ancrées à leur numéro"><input type="checkbox" data-k="embark" ${_embark ? 'checked' : ''}> déplacer aussi les figées</label>` : ''}
    <button class="dk-btn small ghost" data-mact="clear" aria-label="Effacer la sélection">${icon('x', 14)}</button>
    <div class="dk-mselbar-pop" data-slot="mselpop"></div>`;
  bar.classList.add('on');
  bar.querySelector('[data-k="embark"]')?.addEventListener('change', e => { _embark = e.target.checked; });
  bar.querySelectorAll('[data-mact]').forEach(b => b.addEventListener('click', () => _mselAction(b.dataset.mact)));
}
async function _mselBatch(op, params, okMsg) {
  try {
    const sel = [..._msel];
    const r = await _api('/issue/' + _issueId + '/batch', { method: 'POST', body: { ns: sel, op, ...params } });
    _toast(okMsg(r) + (r.skipped ? ` · ${r.skipped} ignorée${r.skipped > 1 ? 's' : ''}` : ''));
    await _loadIssue(true);
    // Étaler un dossier = mon action → acquitter ces pages (pas de halo pour moi).
    if (op === 'spread') sel.forEach(n => { const p = _D.pages.find(x => x.n === n); if (p) _ackSeen(p.id, _cardArrivalTs(p)); });
    _updateMselClasses();
  } catch (e) { _toast(e.message, true); }
}
function _mselAction(act) {
  const pop = _root.querySelector('[data-slot="mselpop"]');
  pop.innerHTML = '';
  if (act === 'clear') { _clearMsel(); return; }
  if (act === 'fixe') { _mselBatch('fixe', {}, r => `${r.done} page${r.done > 1 ? 's' : ''} figée${r.done > 1 ? 's' : ''}`); return; }
  if (act === 'libere') { _mselBatch('libere', {}, r => `${r.done} page${r.done > 1 ? 's' : ''} libérée${r.done > 1 ? 's' : ''}`); return; }
  if (act === 'rubrique') {
    pop.innerHTML = `<div class="dk-menu">
      ${(_D.rubriques || []).map(r => `<button class="dk-menu-item" data-rub="${r.id}"><span class="dk-pc-dot" style="background:${r.color}"></span>${_esc(r.name)}</button>`).join('')}
      <button class="dk-menu-item" data-rub="">Sans rubrique</button></div>`;
    pop.querySelectorAll('[data-rub]').forEach(b => b.onclick = () => {
      pop.innerHTML = '';
      _mselBatch('rubrique', { rub_id: b.dataset.rub || null }, r => `Rubrique appliquée à ${r.done} page${r.done > 1 ? 's' : ''}`);
    });
    return;
  }
  if (act === 'contrib') {
    pop.innerHTML = `<div class="dk-menu dk-menu-form">
      <input type="text" data-k="mcontrib" maxlength="160" placeholder="Nom du contributeur">
      <button class="dk-btn small primary" data-act="mcontribok">Appliquer</button></div>`;
    const inp = pop.querySelector('[data-k="mcontrib"]');
    inp.focus();
    pop.querySelector('[data-act="mcontribok"]').onclick = () => {
      const v = inp.value.trim();
      pop.innerHTML = '';
      _mselBatch('contrib', { contrib: v }, r => `Contributeur appliqué aux titulaires de ${r.done} page${r.done > 1 ? 's' : ''}`);
    };
    return;
  }
  if (act === 'spread') {
    const cands = (_D.articles || []).filter(a => !['publie', 'abandonne'].includes(a.status));
    pop.innerHTML = `<div class="dk-menu">
      ${cands.length ? cands.slice(0, 40).map(a => `<button class="dk-menu-item" data-sp="${a.id}">${_esc(a.title)}</button>`).join('')
        : `<div class="dk-menu-group">Aucun article disponible</div>`}</div>`;
    pop.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => {
      pop.innerHTML = '';
      _mselBatch('spread', { art_id: b.dataset.sp }, r => `Article étalé sur ${r.done} page${r.done > 1 ? 's' : ''}`);
    });
  }
}

/* ── Interactions frise : clic/sélection, drag (échange + insertion) ── */
let _down = null, _dragCard = null, _dragGhost = null, _suppressClick = false;
let _insTarget = null;          // { n, x, top, h } — insérer AVANT la page n
let _swapTarget = null;         // carte visée pour un échange
function _bindFrise() {
  const f = _root.querySelector('[data-slot="frise"]');
  if (!f) return;
  f.addEventListener('mousedown', e => {
    const card = e.target.closest('.dk-pcard');
    const draggable = card && !card.classList.contains('locked') && !_offline;
    _down = { x: e.clientX, y: e.clientY, card: draggable ? card : null, started: false, frise: f };
  });
  f.addEventListener('click', e => {
    if (_suppressClick) { _suppressClick = false; return; }
    const card = e.target.closest('.dk-pcard');
    if (!card) { _clearMsel(); return; }
    const n = parseInt(card.dataset.n, 10);
    if (e.shiftKey && _mselAnchor !== null) {
      const [lo, hi] = [Math.min(_mselAnchor, n), Math.max(_mselAnchor, n)];
      for (let i = lo; i <= hi; i++) _msel.add(i);
      _updateMselClasses();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (_msel.has(n)) _msel.delete(n); else _msel.add(n);
      _mselAnchor = n;
      _updateMselClasses();
      return;
    }
    _mselAnchor = n;
    if (_msel.size) _clearMsel();
    _openInsp(n);
  });
  // Pointer §3.5 : glisser des FICHIERS sur une carte → casier de la page.
  f.addEventListener('dragover', e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    const card = e.target.closest('.dk-pcard');
    f.querySelectorAll('.dk-pcard.dropfile').forEach(x => { if (x !== card) x.classList.remove('dropfile'); });
    if (card && !_offline && _D.casier !== 'off') {
      card.classList.add('dropfile');
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  f.addEventListener('dragleave', e => {
    if (!f.contains(e.relatedTarget)) f.querySelectorAll('.dk-pcard.dropfile').forEach(x => x.classList.remove('dropfile'));
  });
  f.addEventListener('drop', e => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const card = e.target.closest('.dk-pcard');
    f.querySelectorAll('.dk-pcard.dropfile').forEach(x => x.classList.remove('dropfile'));
    if (!card || _offline || _D.casier === 'off') return;
    const p = _D.pages.find(x => x.n === parseInt(card.dataset.n, 10));
    if (p) _uploadFiles(p, e.dataTransfer.files, () => { if (_selN === p.n) _openInsp(p.n, true); });
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
    }
    if (_down.card) _moveDrag(e);
  });
  window.addEventListener('mouseup', e => {
    if (!_down || !_root) { _down = null; return; }
    if (_down.started) _suppressClick = true;
    if (_down.card && _down.started) _endDrag(e);
    _down = null;
  });
}
function _dragNs() {
  const n = parseInt(_dragCard.dataset.n, 10);
  return (_msel.has(n) && _msel.size > 1) ? [..._msel].sort((a, b) => a - b) : [n];
}
function _beginDrag(card, e) {
  _dragCard = card;
  const ns = _dragNs();
  ns.forEach(n => _down.frise.querySelector(`.dk-pcard[data-n="${n}"]`)?.classList.add('ghosted'));
  _dragGhost = card.cloneNode(true);
  _dragGhost.classList.remove('ghosted', 'sel', 'msel');
  Object.assign(_dragGhost.style, {
    position: 'fixed', zIndex: 10020, pointerEvents: 'none',
    width: card.offsetWidth + 'px', height: card.offsetHeight + 'px',
    transform: 'rotate(2.5deg)', boxShadow: '0 18px 40px rgba(0,0,0,.5)',
  });
  if (ns.length > 1) {
    const b = document.createElement('span');
    b.className = 'dk-drag-count';
    b.textContent = ns.length;
    _dragGhost.appendChild(b);
  }
  document.body.appendChild(_dragGhost);
  _moveDrag(e);
}
function _moveDrag(e) {
  _dragGhost.style.left = (e.clientX - _dragGhost.offsetWidth / 2) + 'px';
  _dragGhost.style.top = (e.clientY - _dragGhost.offsetHeight / 2) + 'px';
  const f = _down.frise;
  // Auto-défilement vertical près des bords
  const wrap = f.closest('.dk-frise-wrap') || f;
  const wr = wrap.getBoundingClientRect();
  if (e.clientY > wr.bottom - 60) f.scrollTop += 14;
  if (e.clientY < wr.top + 60) f.scrollTop -= 14;

  _swapTarget = null; _insTarget = null;
  f.querySelectorAll('.dk-pcard.drop-hint').forEach(x => x.classList.remove('drop-hint'));
  const ns = _dragNs();
  // Échange : drop SUR une carte (zone centrale), uniquement pour UNE page.
  _dragGhost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  _dragGhost.style.display = '';
  const over = el && el.closest ? el.closest('.dk-pcard') : null;
  if (ns.length === 1 && over && !over.classList.contains('locked') && !over.classList.contains('ghosted')) {
    const r = over.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    if (rel > 0.25 && rel < 0.75) {
      _swapTarget = over;
      over.classList.add('drop-hint');
      _hideInsBar();
      return;
    }
  }
  // Insertion : entre deux planches (indicateur barre verticale dorée)
  _insTarget = _insertionAt(e, f);
  if (_insTarget) _showInsBar(f, _insTarget); else _hideInsBar();
}
function _insertionAt(e, f) {
  const planches = [...f.querySelectorAll('.dk-planche')];
  let best = null;
  for (const pl of planches) {
    const r = pl.getBoundingClientRect();
    if (e.clientY < r.top - 8 || e.clientY > r.bottom + 8) continue;
    const cards = [...pl.querySelectorAll('.dk-pcard')];
    if (!cards.length) continue;
    const firstN = parseInt(cards[0].dataset.n, 10);
    const lastN = parseInt(cards[cards.length - 1].dataset.n, 10);
    if (e.clientX < r.left + r.width / 2) return { n: firstN, x: r.left - 11, top: r.top, h: r.height };
    best = { n: lastN + 1, x: r.right + 11, top: r.top, h: r.height };
  }
  return best;
}
function _showInsBar(f, t) {
  const wrap = f.closest('.dk-frise-wrap');
  let bar = wrap.querySelector('.dk-insbar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'dk-insbar'; wrap.appendChild(bar); }
  const wr = wrap.getBoundingClientRect();
  bar.style.left = (t.x - wr.left) + 'px';
  bar.style.top = (t.top - wr.top) + 'px';
  bar.style.height = t.h + 'px';
  bar.style.display = 'block';
}
function _hideInsBar() { _root?.querySelector('.dk-insbar')?.remove(); }

async function _endDrag(e) {
  const f = _down.frise;
  f.querySelectorAll('.dk-pcard.drop-hint').forEach(x => x.classList.remove('drop-hint'));
  _hideInsBar();
  const ns = _dragNs();
  _dragGhost.remove(); _dragGhost = null;
  f.querySelectorAll('.dk-pcard.ghosted').forEach(x => x.classList.remove('ghosted'));
  _dragCard = null;
  const swap = _swapTarget, ins = _insTarget;
  _swapTarget = null; _insTarget = null;

  if (swap && ns.length === 1) { await _doSwap(ns[0], parseInt(swap.dataset.n, 10)); return; }
  if (ins) { await _doMove(ns, ins.n); return; }
}

// Échange du contenu de deux pages (drop SUR une carte) — optimiste + FLIP.
async function _doSwap(fromN, toN) {
  if (fromN === toN) return;
  const pa = _D.pages.find(p => p.n === fromN), pb = _D.pages.find(p => p.n === toN);
  if (!pa || !pb) return;
  const firstRects = _flipSnapshot([fromN, toN]);
  const keep = { kind: pa.kind, fixe_tag: pa.fixe_tag, fixe_title: pa.fixe_title, rub_id: pa.rub_id };
  Object.assign(pa, { kind: pb.kind, fixe_tag: pb.fixe_tag, fixe_title: pb.fixe_title, rub_id: pb.rub_id });
  Object.assign(pb, keep);
  for (const s of (_D.slots || [])) {
    if (s.page_id === pa.id) s.page_id = pb.id;
    else if (s.page_id === pb.id) s.page_id = pa.id;
  }
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

// Déplacement par insertion (§3.5) — optimiste (même algorithme que le
// worker : les figées hors sélection restent ancrées, le contenu coule).
function _localMove(from, to, embark) {
  const byN = new Map(_D.pages.map(p => [p.n, p]));
  let f = [...new Set(from)].sort((a, b) => a - b).filter(n => byN.has(n));
  if (!embark) f = f.filter(n => byN.get(n).kind !== 'fixe');
  if (!f.length) return 0;
  const fromSet = new Set(f);
  const contentOf = p => ({ kind: p.kind, fixe_tag: p.fixe_tag, fixe_title: p.fixe_title, rub_id: p.rub_id, srcId: p.id });
  const anchored = new Map(), moved = [], flow = [];
  for (const p of _D.pages) {
    if (fromSet.has(p.n)) moved.push(contentOf(p));
    else if (p.kind === 'fixe') anchored.set(p.n, contentOf(p));
    else flow.push({ n: p.n, c: contentOf(p) });
  }
  let idx = 0;
  for (const x of flow) { if (x.n < to) idx++; }
  const nf = flow.map(x => x.c);
  nf.splice(idx, 0, ...moved);
  const remap = new Map();
  let fi = 0;
  for (const p of _D.pages) {
    const c = anchored.get(p.n) || nf[fi++];
    if (c.srcId !== p.id) remap.set(c.srcId, p.id);
    Object.assign(p, { kind: c.kind, fixe_tag: c.fixe_tag, fixe_title: c.fixe_title, rub_id: c.rub_id });
  }
  for (const s of (_D.slots || [])) { const dst = remap.get(s.page_id); if (dst) s.page_id = dst; }
  return f.length;
}
async function _doMove(ns, to) {
  const hasFixe = ns.some(n => (_D.pages.find(p => p.n === n) || {}).kind === 'fixe');
  const embark = _embark && hasFixe;
  const firstRects = _flipSnapshot(_D.pages.map(p => p.n));
  const moved = _localMove(ns, to, embark);
  if (!moved) { _toast('Pages figées ancrées à leur numéro — cochez « déplacer aussi les figées » pour les embarquer.', true); return; }
  if (hasFixe && !embark) _toast('Les pages figées restent ancrées — le contenu a coulé autour.');
  _selN = null; _closeInsp(); _clearMsel();
  _renderFrise(); _flipPlay(firstRects); _renderRail();
  try {
    await _api('/issue/' + _issueId + '/move', { method: 'POST', body: { from: ns, to, embark } });
    _toast(moved > 1 ? `${moved} pages déplacées.` : 'Page déplacée.');
    _writeCache();
  } catch (err2) {
    _toast('Déplacement non enregistré : ' + err2.message, true);
    _loadIssue(true);
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

/* ═══════════════════ Le marbre (§4) ═══════════════════ */
function _renderMarbre() {
  const wrap = _root.querySelector('[data-slot="marbre"]');
  if (!wrap) return;
  const rubs = _D.rubriques || [];
  const arts = (_D.articles || []).filter(a => {
    if (_mf.statut === 'vivant' && ['publie', 'abandonne'].includes(a.status)) return false;
    if (_mf.statut && _mf.statut !== 'vivant' && _mf.statut !== 'tous' && a.status !== _mf.statut) return false;
    if (_mf.rub && a.rub_id !== _mf.rub) return false;
    if (_mf.fresh === 'intemporel' && a.fresh === 'date') return false;
    if (_mf.fresh === 'date' && a.fresh !== 'date') return false;
    if (_mf.fresh === 'perime' && !(a.fresh === 'date' && a.perime && new Date(a.perime + 'T12:00:00').getTime() < Date.now())) return false;
    if (_mf.q) {
      const q = _mf.q.toLowerCase();
      if (!(a.title || '').toLowerCase().includes(q) && !(a.contrib || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const reports = (_D.articles || []).filter(a => _isReported(a) && !['publie', 'abandonne'].includes(a.status) && !_placementsOf(a.id).tit.length);
  wrap.innerHTML = `
    <div class="dk-marbre-head">
      <input type="search" class="dk-marbre-q" data-k="q" placeholder="Chercher un titre, un contributeur…" value="${_esc(_mf.q)}">
      <select data-k="rub"><option value="">Toutes rubriques</option>${rubs.map(r => `<option value="${r.id}" ${_mf.rub === r.id ? 'selected' : ''}>${_esc(r.name)}</option>`).join('')}</select>
      <select data-k="fresh">
        <option value="">Toute fraîcheur</option>
        <option value="intemporel" ${_mf.fresh === 'intemporel' ? 'selected' : ''}>intemporels</option>
        <option value="date" ${_mf.fresh === 'date' ? 'selected' : ''}>datés</option>
        <option value="perime" ${_mf.fresh === 'perime' ? 'selected' : ''}>périmés</option>
      </select>
      <select data-k="statut">
        <option value="vivant" ${_mf.statut === 'vivant' ? 'selected' : ''}>au marbre (vivants)</option>
        <option value="tous" ${_mf.statut === 'tous' ? 'selected' : ''}>tous</option>
        ${Object.keys(STATUS).map(s => `<option value="${s}" ${_mf.statut === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}
      </select>
    </div>
    ${reports.length ? `<div class="dk-marbre-report">${reports.length > 1 ? reports.length + ' articles reportés attendent' : '1 article reporté attend'} au marbre — réservez-les ou tranchez leur fraîcheur.</div>` : ''}
    <div class="dk-marbre-list">
      ${arts.length ? arts.map(a => {
        const rub = _rubById(a.rub_id);
        const st = STATUS[a.status] || STATUS.propose;
        const fresh = _freshInfo(a);
        const pl = _placementsOf(a.id);
        const chips = [];
        pl.tit.forEach(n => chips.push(`<span class="dk-mchip on">p. ${_pn(n)}</span>`));
        pl.banc.forEach(n => chips.push(`<span class="dk-mchip">banc p. ${_pn(n)}</span>`));
        if (!chips.length && !['publie', 'abandonne'].includes(a.status)) chips.push(`<span class="dk-mchip libre">libre</span>`);
        return `<div class="dk-mrow${_marbreIsNew(a) ? ' dk-new' : ''}" data-a="${a.id}">
          <span class="dk-pc-dot" style="background:${rub ? rub.color : '#8d93a8'}"></span>
          <div class="dk-mrow-main">
            <div class="dk-mrow-title">${_marbreIsNew(a) ? '<span class="dk-mrow-new" title="Nouvel article"></span>' : ''}${_esc(a.title)}${_isReported(a) ? ' <span class="dk-mchip report">report</span>' : ''}</div>
            <div class="dk-mrow-meta">${rub ? _esc(rub.name) : 'Sans rubrique'}${a.contrib ? ' · ' + _esc(a.contrib) : ''} · <span style="color:${st.dot}">●</span> ${st.label} · <span class="${fresh.cls}">${fresh.label}</span></div>
          </div>
          <div class="dk-mrow-chips">${chips.join('')}</div>
        </div>`;
      }).join('') : `<p class="dk-empty-line" style="padding:18px">Aucun article ne correspond — le marbre est ${(_D.articles || []).length ? 'filtré' : 'vide : créez un article avec le bouton ci-dessus'}.</p>`}
    </div>`;
  wrap.querySelectorAll('.dk-marbre-head [data-k]').forEach(el => {
    el.addEventListener(el.dataset.k === 'q' ? 'input' : 'change', () => {
      _mf[el.dataset.k] = el.value;
      _renderMarbre();
      if (el.dataset.k === 'q') { const q = wrap.querySelector('[data-k="q"]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    });
  });
  wrap.querySelectorAll('.dk-mrow').forEach(row => row.addEventListener('click', () => _openInspMarbre(row.dataset.a)));
}

// Inspecteur du marbre : fiche article transversale aux numéros.
function _openInspMarbre(artId) {
  const a = _artById(artId);
  if (!a) return;
  // Ouvrir une fiche marbre = « vu » : acquitte l'arrivée, éteint le halo.
  if (_marbreIsNew(a)) {
    _ackSeen(a.id, _artArrivalTs(a));
    const row = _root.querySelector(`.dk-mrow[data-a="${a.id}"]`);
    if (row) { row.classList.remove('dk-new'); row.querySelector('.dk-mrow-new')?.remove(); }
    const seg = _root.querySelector('[data-slot="view"] [data-v="marbre"] .dk-seg-new');
    if (seg && !_newMarbreCount()) seg.remove();
    _refreshNewStrip();
  }
  const insp = _root.querySelector('[data-slot="insp"]');
  const _sy = _inspScrollGet('marbre:' + artId);
  const rub = _rubById(a.rub_id);
  const st = STATUS[a.status] || STATUS.propose;
  const fresh = _freshInfo(a);
  const pl = _placementsOf(a.id);
  const histo = _histoOf(a);
  const vivant = !['publie', 'abandonne'].includes(a.status);
  // Pages où le réserver : vides d'abord, puis pages article (emplacement en plus)
  const targets = vivant ? _D.pages.filter(p => p.kind !== 'fixe' && !_slotsOf(p).some(s => s.art_id === a.id)) : [];
  insp.innerHTML = _inspShell(a.title,
    `<div class="dk-insp-rub"><span class="dk-pc-dot" style="background:${rub ? rub.color : '#8d93a8'}"></span>${_esc(rub ? rub.name : 'Sans rubrique')} · au marbre</div>`,
    `<div class="dk-sec"><h4>Article</h4>
      ${_kv('Contributeur', a.contrib || '—')}
      ${_kv('Statut', st.label)}
      ${_kv('Remise prévue', a.due ? _fmtD(a.due) : '—')}
      ${_kv('Fraîcheur', fresh.label, fresh.cls)}
      ${_kv('Dans ce numéro', pl.tit.length ? 'p. ' + pl.tit.map(_pn).join(', ') : (pl.banc.length ? 'au banc p. ' + pl.banc.map(_pn).join(', ') : 'libre'))}
    </div>
    <div class="dk-sec"><h4>Texte de l'article</h4>
      ${_hasCopy(a)
        ? `<p class="dk-wr-preview">${_esc((a.notes || '').trim().slice(0, 220))}${(a.notes || '').trim().length > 220 ? '…' : ''}</p>
           <div class="dk-btn-row"><button class="dk-btn primary" data-act="write">${icon('edit-3', 14)} Éditer l'article</button>
             <span class="dk-note" style="align-self:center">${_copyBadge(a)}</span></div>`
        : `<p class="dk-empty-line">Pas encore de texte — écrivez l'article ici, confortablement.</p>
           <div class="dk-btn-row"><button class="dk-btn primary" data-act="write">${icon('edit-3', 14)} Écrire l'article</button></div>`}
    </div>
    ${_artCasierSectionHTML(a)}
    ${vivant ? `<div class="dk-sec"><h4>Réserver sur une page du n° ${_esc(_D.issue.num)}</h4>
      <div class="dk-pagepick">${targets.slice(0, 200).map(p => {
        const nb = _slotsOf(p).length;
        return `<button class="dk-pagepick-btn ${nb ? 'has' : ''}" data-pg="${p.id}" data-n="${p.n}" title="${nb ? nb + ' article(s) déjà sur cette page' : 'page vide'}">${_pn(p.n)}${nb ? '+' : ''}</button>`;
      }).join('') || '<p class="dk-empty-line">Aucune page disponible.</p>'}</div>
      <p class="dk-note">Chiffre + = la page porte déjà un article ; le vôtre s'y ajoutera (brèves, encadré…).</p>
    </div>` : ''}
    ${histo.length ? `<div class="dk-sec"><h4>Historique</h4>${histo.slice(0, 20).map(h => `<div class="dk-histo">${_esc(h)}</div>`).join('')}</div>` : ''}
    ${_passerellesHTML(a)}
    <div class="dk-sec"><h4>Actions</h4><div class="dk-btn-row">
      <button class="dk-btn" data-act="editart">${icon('edit-3', 14)} Modifier</button>
      ${(STATUS[a.status] || {}).needsCopy && a.contrib ? `<button class="dk-btn ${_relanceInfo(a) ? 'primary' : ''}" data-act="relancem">${icon('mail', 14)} Relancer</button>` : ''}
      ${vivant ? `<button class="dk-btn" data-act="abandon">Abandonner</button>` : ''}
      <button class="dk-btn ghost" data-act="delart">${icon('trash-2', 14)} Supprimer</button>
    </div><div data-slot="confirm"></div></div>`);
  _bindClose(insp);
  _inspScrollSet('marbre:' + artId, _sy);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  _bindArtCasier(insp, a, () => _openInspMarbre(a.id));
  _bindPasserelles(insp, a);
  insp.querySelector('[data-act="write"]')?.addEventListener('click', () => _openWriter(a.id, () => _openInspMarbre(a.id)));
  insp.querySelectorAll('[data-pg]').forEach(b => b.onclick = async () => {
    try {
      await _api('/page/' + b.dataset.pg + '/slot', { method: 'POST', body: { art_id: a.id } });
      _toast('Article réservé sur la page ' + _pn(parseInt(b.dataset.n, 10)) + '.');
      await _loadIssue(true);
      _ackCardById(b.dataset.pg);   // réservation par moi → pas de halo pour moi
      if (_view === 'marbre') _renderMarbre();
      _openInspMarbre(a.id);
    } catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="editart"]').onclick = () => _openArtForm(null, a, () => _openInspMarbre(a.id));
  insp.querySelector('[data-act="relancem"]')?.addEventListener('click', () => _openRelanceForm(a, () => _openInspMarbre(a.id)));
  const confirmBox = insp.querySelector('[data-slot="confirm"]');
  insp.querySelector('[data-act="abandon"]')?.addEventListener('click', () => {
    confirmBox.innerHTML = `<div class="dk-confirm">Abandonner « ${_esc(a.title)} » ? Il sort du marbre (l'historique est conservé).
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn primary small" data-act="abyes">Abandonner</button>
        <button class="dk-btn small" data-act="abno">Annuler</button></div></div>`;
    confirmBox.querySelector('[data-act="abno"]').onclick = () => { confirmBox.innerHTML = ''; };
    confirmBox.querySelector('[data-act="abyes"]').onclick = async () => {
      try {
        await _api('/article/' + a.id, { method: 'PATCH', body: { status: 'abandonne' } });
        _toast('Article abandonné.');
        await _loadIssue(true); _renderMarbre(); _openInspMarbre(a.id);
      } catch (e) { _toast(e.message, true); }
    };
  });
  insp.querySelector('[data-act="delart"]').onclick = () => {
    confirmBox.innerHTML = `<div class="dk-confirm">Supprimer définitivement « ${_esc(a.title)} » ? Il sera retiré des pages et des bancs. Cette action est irréversible.
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn primary small" data-act="delyes">Supprimer</button>
        <button class="dk-btn small" data-act="delno">Annuler</button></div></div>`;
    confirmBox.querySelector('[data-act="delno"]').onclick = () => { confirmBox.innerHTML = ''; };
    confirmBox.querySelector('[data-act="delyes"]').onclick = async () => {
      try {
        await _api('/article/' + a.id, { method: 'DELETE' });
        _toast('Article supprimé.');
        _closeInsp();
        await _loadIssue(true);
        if (_view === 'marbre') _renderMarbre();
      } catch (e) { _toast(e.message, true); }
    };
  };
}

/* ═══════════════════ Inspecteur (pages) ═══════════════════ */
function _openInsp(n, silent) {
  const p = _D.pages.find(x => x.n === n);
  if (!p) return;
  if (_selN !== n) _selSlot = 0;
  _selN = n;
  _root.querySelectorAll('.dk-pcard.sel').forEach(x => x.classList.remove('sel'));
  // Ouvrir une carte = « vu » : on acquitte son arrivée et on éteint le halo.
  if (_cardIsNew(p)) {
    _ackSeen(p.id, _cardArrivalTs(p));
    const el = _root.querySelector(`[data-slot="frise"] .dk-pcard[data-n="${n}"]`);
    if (el) { el.classList.remove('dk-new'); el.querySelector('.dk-pc-new')?.remove(); }
    const seg = _root.querySelector('[data-slot="view"] [data-v="marbre"] .dk-seg-new');
    if (seg && !_newMarbreCount()) seg.remove();
    _refreshNewStrip();
  }
  _root.querySelector(`[data-slot="frise"] .dk-pcard[data-n="${n}"]`)?.classList.add('sel');
  const insp = _root.querySelector('[data-slot="insp"]');
  const _sy = _inspScrollGet('page:' + n);

  if (p.kind === 'fixe') { _renderInspFixe(insp, p); }
  else if (!_slotsOf(p).length || !_artById((_slotsOf(p)[0] || {}).art_id)) { _renderInspVide(insp, p); }
  else { _renderInspArticle(insp, p); }

  _inspScrollSet('page:' + n, _sy);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
}
function _closeInsp() {
  _root.querySelector('[data-slot="insp"]').classList.remove('on');
  _root.querySelector('[data-slot="veil"]').classList.remove('on');
  _root.querySelectorAll('.dk-pcard.sel').forEach(x => x.classList.remove('sel'));
  _selN = null; _selSlot = 0;
}
function _inspShell(title, rubHTML, body) {
  return `<div class="dk-insp-hd">
    <div class="dk-insp-hd-main">${rubHTML || ''}<div class="dk-insp-title">${_esc(title)}</div></div>
    <button class="dk-insp-close" data-act="close" aria-label="Fermer">${icon('x', 18)}</button>
  </div><div class="dk-insp-body">${body}</div>`;
}
function _kv(k, v, cls) { return `<div class="dk-kv"><span>${k}</span><strong class="${cls || ''}">${_esc(v)}</strong></div>`; }
function _bindClose(insp) { insp.querySelector('[data-act="close"]').onclick = _closeInsp; }

// Défilement de l'inspecteur préservé entre deux rendus du MÊME panneau.
// Chaque action reconstruit .dk-insp-body (insp.innerHTML = …) → sans ça, le
// panneau « remonte en haut » à chaque clic/champ. On lit AVANT de remplacer
// le HTML (_inspScrollGet), on restaure APRÈS (_inspScrollSet). La clé = le
// panneau : re-rendre le même numéro/la même fiche préserve, en changer repart
// en haut. (La frise, elle, garde déjà son scroll via _renderFrise keepScroll.)
function _inspScrollGet(key) {
  const insp = _root && _root.querySelector('[data-slot="insp"]');
  return (insp && insp.dataset.panelKey === String(key)) ? (insp.querySelector('.dk-insp-body')?.scrollTop || 0) : 0;
}
function _inspScrollSet(key, y) {
  const insp = _root && _root.querySelector('[data-slot="insp"]');
  if (!insp) return;
  insp.dataset.panelKey = String(key);
  if (y > 0) { const b = insp.querySelector('.dk-insp-body'); if (b) b.scrollTop = y; }
}

function _renderInspFixe(insp, p) {
  insp.innerHTML = _inspShell(p.fixe_tag || 'Page figée', null,
    `<div class="dk-sec"><h4>${_dispN(p.n) === null ? _esc(_pageLabel(p)) + ' — hors numérotation' : 'Page ' + _pn(p.n) + ' — ancrée à son numéro'}</h4>
      <label class="dk-field"><span>Intitulé</span><input type="text" data-k="fixe_title" maxlength="200" value="${_esc(p.fixe_title || '')}" placeholder="ex. Publicité — GMPA"></label>
      <div class="dk-btn-row">
        <button class="dk-btn primary" data-act="savefixe">Enregistrer</button>
        <button class="dk-btn" data-act="unfixe">Libérer la page</button>
      </div>
      <p class="dk-note">Une page figée ne bouge pas quand le contenu coule autour (repagination) — une pub vendue « page ${_pn(p.n)} » reste page ${_pn(p.n)}.</p>
    </div>
    ${_casierSectionHTML(p)}
    ${p.updated_by ? `<p class="dk-modified">Modifié par ${_esc(p.updated_by)} ${_relTime(p.updated_at)}</p>` : ''}`);
  _bindClose(insp);
  _bindCasier(insp, p, () => _openInsp(p.n, true));
  insp.querySelector('[data-act="savefixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { fixe_title: insp.querySelector('[data-k="fixe_title"]').value } });
      _toast('Page figée mise à jour.'); _loadIssue(true);
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="unfixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'vide', fixe_tag: null, fixe_title: null } });
      _toast('Page libérée.'); await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  };
}

function _renderInspVide(insp, p) {
  // Articles disponibles = pas titulaires d'une autre page de CE numéro.
  const placed = new Set((_D.slots || []).map(s => s.art_id).filter(Boolean));
  const libres = (_D.articles || []).filter(a => !placed.has(a.id) && !['publie', 'abandonne'].includes(a.status));
  const rubs = _D.rubriques || [];
  insp.innerHTML = _inspShell('Emplacement libre — ' + _pageLabel(p), null,
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
      }).join('') : `<p class="dk-empty-line">Aucun article disponible — créez-en un ci-dessous, ou étalez-en un déjà réservé via la sélection multiple.</p>`}
    </div>
    <div class="dk-sec"><h4>Préparer la page</h4>
      <label class="dk-field"><span>Rubrique prévue (avant réservation)</span><select data-k="prerub">
        <option value="">—</option>
        ${rubs.map(r => `<option value="${r.id}" ${p.rub_id === r.id ? 'selected' : ''}>${_esc(r.name)}</option>`).join('')}
      </select></label>
      <div class="dk-btn-row"><button class="dk-btn" data-act="mkfixe">${icon('lock', 14)} Page figée (pub, sommaire…)</button></div>
    </div>
    <div class="dk-sec"><div class="dk-btn-row"><button class="dk-btn primary" data-act="newarthere">${icon('plus', 14)} Nouvel article sur cette page</button></div></div>
    ${_casierSectionHTML(p)}
    ${p.updated_by ? `<p class="dk-modified">Modifié par ${_esc(p.updated_by)} ${_relTime(p.updated_at)}</p>` : ''}`);
  _bindClose(insp);
  _bindCasier(insp, p, () => _openInsp(p.n, true));
  insp.querySelectorAll('[data-act="reserve"]').forEach(b => b.onclick = async () => {
    try {
      await _api('/page/' + p.id + '/slot', { method: 'POST', body: { art_id: b.dataset.a } });
      _toast('Article réservé sur la page ' + _pn(p.n) + '.');
      await _loadIssue(true); _ackCardById(p.id); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-k="prerub"]').addEventListener('change', async e => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { rub_id: e.target.value || null } });
      _toast('Rubrique prévue sur la page ' + _pn(p.n) + '.');
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (err2) { _toast(err2.message, true); }
  });
  insp.querySelector('[data-act="mkfixe"]').onclick = async () => {
    try {
      await _api('/page/' + p.id, { method: 'PATCH', body: { kind: 'fixe', fixe_tag: 'Figée' } });
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="newarthere"]').onclick = () => _openArtForm(p);
}

/* Refonte ergonomique (retour Stéphane 2026-07-13) : moins de lecture, plus
   instinctif. Les 5 lignes clé/valeur deviennent 3 TUILES (la marge en gros,
   colorée — la seule vraie question) ; le statut devient un STEPPER de
   pipeline : un tap sur l'étape suivante avance l'article (remplace les
   boutons « Copie reçue / Marquer relu / Maquetté »). */
const PIPE = ['propose', 'attendu', 'remis', 'relu', 'maquette'];
const STEP_MSG = { attendu: 'Marqué attendu.', remis: 'Copie reçue — marge recalculée.', relu: 'Marqué relu.', maquette: 'Marqué maquetté.' };
const _initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';
function _vitalsHTML(a, c) {
  const dead = a.status === 'abandonne';
  const done = _isDone(a);
  // ⚠ fix : un article abandonné n'a PAS de marge (le calcul la montrait).
  const cls = dead ? '' : (done ? 'vert' : _stateOf(c.marge));
  const margeVal = dead ? '—' : (done ? 'prêt' : (c.marge === null ? '—' : c.marge + ' j'));
  const margeLbl = (!dead && !done && c.marge !== null && c.marge < 0) ? 'Marge brûlée' : 'Marge';
  const st = STATUS[a.status] || STATUS.propose;
  const relDue = _relanceInfo(a);
  const lastRel = _relancesOf(a.id)[0];
  return `<div class="dk-vitals">
      <div class="dk-vital"><span class="dk-vital-k">${margeLbl}</span><span class="dk-vital-v ${cls}">${margeVal}</span></div>
      <div class="dk-vital"><span class="dk-vital-k">Remise</span><span class="dk-vital-v">${a.due ? _fmtD(a.due) : '—'}</span></div>
    </div>
    ${a.contrib ? `<div class="dk-contact">
      <span class="dk-contact-av">${_esc(_initials(a.contrib))}</span>
      <div class="dk-contact-info">
        <div class="dk-contact-name">${_esc(a.contrib)}</div>
        <div class="dk-contact-sub">${relDue ? (relDue.mode === 'avant' ? 'rappel suggéré avant l’échéance' : 'copie en attente — relance suggérée') : (lastRel ? 'relancé ' + _relTime(lastRel.sent_at) : 'contributeur')}</div>
      </div>
      ${st.needsCopy && !dead ? `<button class="dk-btn small ${relDue ? 'primary' : ''}" data-act="relance" title="Brouillon proposé, votre voix — le pointage « copie reçue » annule la relance de lui-même${lastRel ? '. Dernière : ' + _esc(lastRel.email) + ', ' + _relTime(lastRel.sent_at) : ''}">${icon('mail', 13)} Relancer</button>` : ''}
    </div>` : ''}
    ${(!dead && !done) ? `<p class="dk-vitals-sub">Page prête le ${_fmtD(new Date(c.pageReady))}</p>` : ''}`;
}
function _stepsHTML(a) {
  if (a.status === 'abandonne') return `<div class="dk-step-flag">abandonné — l'historique est conservé</div>`;
  const idx = a.status === 'publie' ? PIPE.length : PIPE.indexOf(a.status);
  return `<div class="dk-steps">
    ${PIPE.map((k, i) => {
      const state = i < idx ? 'done' : (i === idx ? 'on' : (i === idx + 1 ? 'next' : ''));
      return `<button class="dk-step ${state}"${state === 'next' ? ` data-step="${k}" title="Passer à « ${STATUS[k].label} »"` : ' disabled'}>
        <span class="dk-step-dot">${i < idx ? icon('check', 9) : ''}</span><span class="dk-step-lbl">${STATUS[k].label}</span>
      </button>`;
    }).join('')}
    ${a.status === 'publie' ? `<span class="dk-step-pub">${icon('check-circle', 12)} publié</span>` : ''}
  </div>`;
}

function _renderInspArticle(insp, p) {
  const slots = _slotsOf(p);
  if (_selSlot >= slots.length) _selSlot = 0;
  const slot = slots[_selSlot];
  const a = _artById(slot.art_id);
  if (!a) { _renderInspVide(insp, p); return; }
  const st = STATUS[a.status] || STATUS.propose;
  const rub = _rubById(a.rub_id);
  const c = _computeArt(a);
  const banc = _bancOf(slot).map(id => _artById(id)).filter(Boolean);
  const histo = _histoOf(a);
  const canSim = st.needsCopy && a.due;
  const card = _computeCard(p);

  insp.innerHTML = _inspShell(a.title,
    `<div class="dk-insp-rub"><span class="dk-pc-dot" style="background:${rub ? rub.color : '#8d93a8'}"></span>${_esc(rub ? rub.name : 'Sans rubrique')} · ${_pageLabel(p)}</div>`,
    `<div class="dk-sec dk-sec-state">
    ${slots.length > 1 ? `<div class="dk-slotchips">${slots.map((s, i) => {
        const sa = _artById(s.art_id);
        return `<button class="dk-slotchip ${i === _selSlot ? 'on' : ''}" data-slotidx="${i}" title="${_esc(sa ? sa.title : '')}">${i + 1}. ${_esc(sa ? (sa.title.length > 18 ? sa.title.slice(0, 17) + '…' : sa.title) : '?')}</button>`;
      }).join('')}</div>
      <p class="dk-note" style="margin:2px 0 10px">${slots.length} articles sur cette page — marge de la carte : <strong class="${_stateOf(card.marge)}">${card.allDone ? 'prêt' : (_margeTxt(card.marge) || '—')}</strong> (la plus serrée).</p>` : ''}
    ${_vitalsHTML(a, c)}
    ${_stepsHTML(a)}
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

    ${_casierSectionHTML(p)}

    ${histo.length ? `<details class="dk-fold"><summary>Historique (${histo.length})</summary>${histo.slice(0, 8).map(h => `<div class="dk-histo">${_esc(h)}</div>`).join('')}</details>` : ''}

    ${_passerellesHTML(a)}

    <div class="dk-sec"><h4>Actions</h4><div class="dk-btn-row">
      <button class="dk-btn primary" data-act="write">${icon('edit-3', 14)} ${_hasCopy(a) ? 'Éditer le texte' : 'Écrire le texte'}</button>
      <button class="dk-btn" data-act="editart">${icon('edit-3', 14)} Modifier la fiche</button>
      <button class="dk-btn" data-act="unreserve">Retirer de la page</button>
      ${slots.length < 12 ? `<button class="dk-btn ghost" data-act="addslot">${icon('plus', 14)} Ajouter un article ici</button>` : ''}
    </div><div data-slot="slotpick"></div></div>
    ${p.updated_by ? `<p class="dk-modified">Carte modifiée par ${_esc(p.updated_by)} ${_relTime(p.updated_at)}</p>` : ''}`);
  _bindClose(insp);

  insp.querySelectorAll('[data-slotidx]').forEach(b => b.onclick = () => { _selSlot = parseInt(b.dataset.slotidx, 10); _openInsp(p.n, true); });
  _bindCasier(insp, p, () => _openInsp(p.n, true));
  _bindPasserelles(insp, a);
  insp.querySelector('[data-act="write"]')?.addEventListener('click', () => _openWriter(a.id, () => _openInsp(p.n, true)));
  insp.querySelector('[data-act="relance"]')?.addEventListener('click', () => _openRelanceForm(a, () => _openInsp(p.n, true)));

  const patchArt = async (body, msg) => {
    try {
      const r = await _api('/article/' + a.id, { method: 'PATCH', body });
      const i = _D.articles.findIndex(x => x.id === a.id);
      if (i >= 0 && r.article) _D.articles[i] = r.article;
      if (msg) _toast(msg);
      _writeCache(); _renderFrise(); _renderRail(); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  };
  // Stepper : un tap sur l'étape SUIVANTE avance l'article (une seule étape
  // cliquable — le retour arrière passe par « Modifier », choix assumé).
  insp.querySelectorAll('.dk-step[data-step]').forEach(b =>
    b.addEventListener('click', () => patchArt({ status: b.dataset.step }, STEP_MSG[b.dataset.step] || 'Statut mis à jour.')));
  insp.querySelector('[data-act="editart"]').addEventListener('click', () => _openArtForm(p, a));
  insp.querySelector('[data-act="unreserve"]').addEventListener('click', async () => {
    try {
      await _api('/slot/' + slot.id, { method: 'DELETE' });
      _toast('Article retiré — il reste au marbre pour une autre page.');
      _selSlot = 0;
      await _loadIssue(true); _openInsp(p.n, true);
    } catch (e) { _toast(e.message, true); }
  });

  // Ajouter un 2ᵉ (3ᵉ…) article sur la même page (§2.4 — brèves, encadré).
  // Toujours offrir la CRÉATION — sinon impasse quand le marbre n'a rien
  // d'autre à proposer (retour terrain L'Épaulette, 2026-07-12).
  insp.querySelector('[data-act="addslot"]')?.addEventListener('click', () => {
    const onPage = new Set(slots.map(s => s.art_id));
    const cands = (_D.articles || []).filter(x => !onPage.has(x.id) && !['publie', 'abandonne'].includes(x.status));
    const box = insp.querySelector('[data-slot="slotpick"]');
    box.innerHTML = `
      <div class="dk-btn-row" style="margin:8px 0"><button class="dk-btn primary small" data-act="newartslot">${icon('plus', 13)} Nouvel article sur cette page</button></div>
      ${cands.length ? cands.slice(0, 30).map(x => `
      <div class="dk-banc-item">
        <div class="dk-banc-info"><div class="dk-banc-title">${_esc(x.title)}</div>
        <div class="dk-banc-meta">${_rubById(x.rub_id) ? _esc(_rubById(x.rub_id).name) : 'Sans rubrique'}${x.contrib ? ' · ' + _esc(x.contrib) : ''} · ${(STATUS[x.status] || {}).label || x.status}</div></div>
        <button class="dk-btn small" data-addslot="${x.id}">Ajouter</button>
      </div>`).join('') : `<p class="dk-empty-line">Aucun autre article au marbre — créez-le ci-dessus.</p>`}`;
    box.querySelector('[data-act="newartslot"]').onclick = () => _openArtForm(p);
    box.querySelectorAll('[data-addslot]').forEach(bp => bp.onclick = async () => {
      try {
        await _api('/page/' + p.id + '/slot', { method: 'POST', body: { art_id: bp.dataset.addslot } });
        _toast('Article ajouté sur la page ' + _pn(p.n) + '.');
        await _loadIssue(true); _ackCardById(p.id); _selSlot = _slotsOf(p).length - 1; _openInsp(p.n, true);
      } catch (e) { _toast(e.message, true); }
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Bascule (confirmation sobre — le titulaire reste au marbre)
  insp.querySelectorAll('[data-act="swap"]').forEach(btn => btn.addEventListener('click', () => {
    const b = _artById(btn.dataset.b);
    const box = insp.querySelector('[data-slot="swapconfirm"]');
    box.innerHTML = `<div class="dk-confirm">
      Remplacer <strong>« ${_esc(a.title)} »</strong> par <strong>« ${_esc(b.title)} »</strong> ?
      <br><span class="dk-note">Le titulaire retourne au marbre avec la mention du remplacement.</span>
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn primary small" data-act="swapyes">Basculer</button>
        <button class="dk-btn small" data-act="swapno">Annuler</button>
      </div></div>`;
    box.querySelector('[data-act="swapno"]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-act="swapyes"]').onclick = async () => {
      try {
        const newBanc = _bancOf(slot).filter(x => x !== b.id);
        await _api('/slot/' + slot.id, { method: 'PATCH', body: { art_id: b.id, banc: newBanc } });
        await _api('/article/' + a.id, { method: 'PATCH', body: { histo_add: `Remplacé au n° ${_D.issue.num} (page ${p.n}) — reversé au marbre` } });
        await _api('/article/' + b.id, { method: 'PATCH', body: { histo_add: `Titularisé p. ${p.n} du n° ${_D.issue.num}` } });
        _toast(`« ${b.title} » devient titulaire.`);
        await _loadIssue(true); _openInsp(p.n, true);
      } catch (e) { _toast(e.message, true); }
    };
  }));
  // Ajouter au banc de CET emplacement (création directe possible — un
  // remplaçant se prépare souvent avant d'exister au marbre)
  insp.querySelector('[data-act="addbanc"]').addEventListener('click', () => {
    const placed = new Set((_D.slots || []).map(s => s.art_id).filter(Boolean));
    const inBanc = new Set(_bancOf(slot));
    const cands = (_D.articles || []).filter(x => x.id !== a.id && !placed.has(x.id) && !inBanc.has(x.id) && !['publie', 'abandonne'].includes(x.status));
    const box = insp.querySelector('[data-slot="bancpick"]');
    box.innerHTML = `
      <div class="dk-btn-row" style="margin:8px 0"><button class="dk-btn primary small" data-act="newartbanc">${icon('plus', 13)} Nouvel article au banc</button></div>
      ${cands.length ? cands.slice(0, 30).map(x => `
      <div class="dk-banc-item">
        <div class="dk-banc-info"><div class="dk-banc-title">${_esc(x.title)}</div>
        <div class="dk-banc-meta">${_rubById(x.rub_id) ? _esc(_rubById(x.rub_id).name) : 'Sans rubrique'} · ${(STATUS[x.status] || {}).label || x.status}</div></div>
        <button class="dk-btn small" data-pick="${x.id}">Au banc</button>
      </div>`).join('') : `<p class="dk-empty-line">Aucun article libre au marbre — créez-le ci-dessus.</p>`}`;
    box.querySelector('[data-act="newartbanc"]').onclick = () =>
      _openArtForm(null, null, () => _openInsp(p.n, true), slot);
    box.querySelectorAll('[data-pick]').forEach(bp => bp.onclick = async () => {
      try {
        await _api('/slot/' + slot.id, { method: 'PATCH', body: { banc: _bancOf(slot).concat(bp.dataset.pick) } });
        await _loadIssue(true); _openInsp(p.n, true);
      } catch (e) { _toast(e.message, true); }
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

/* ═══════════ DK-4 · Le bac « à trier » (§5.3, jamais contourné) ═══
   Chaque e-mail non rattaché automatiquement attend ici : suggestion
   pré-cochée, confirmation humaine en un clic. « L'IA propose,
   l'humain décide. » Chaque confirmation apprend (e-mail, habitude). */
function _bacAtts(row) { try { const a = JSON.parse(row.attachments || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function _bacSugg(row) { try { return JSON.parse(row.suggestion || '{}') || {}; } catch (_) { return {}; } }
const BAC_VIA = { expediteur: 'expéditeur connu', 'expediteur-ambigu': 'expéditeur connu — plusieurs articles possibles', titre: 'titre reconnu', habitude: 'habitude apprise', ia: 'suggestion IA', aucune: '' };

function _openBacList() {
  const insp = _root.querySelector('[data-slot="insp"]');
  const rows = _D.inbox || [];
  insp.innerHTML = _inspShell('À trier — contributions reçues', null,
    `<div class="dk-sec">
      ${rows.length ? rows.map(r => {
        const s = _bacSugg(r), atts = _bacAtts(r);
        const sugArt = s.kind === 'article' ? _artById(s.art_id) : null;
        const sugLine = sugArt ? '→ « ' + sugArt.title + ' »' : (s.rub_id && _rubById(s.rub_id) ? '→ spontané · ' + _rubById(s.rub_id).name : '→ spontané');
        return `<div class="dk-banc-item">
          <div class="dk-banc-info">
            <div class="dk-banc-title">${_esc(r.subject || '(sans objet)')}</div>
            <div class="dk-banc-meta">${_esc(r.from_name || r.from_email || '?')} · ${_relTime(r.received_at)}${atts.length ? ' · ' + atts.length + ' pièce' + (atts.length > 1 ? 's' : '') : ''}<br>${_esc(sugLine)}</div>
          </div>
          <button class="dk-btn small primary" data-bac="${r.id}">Trier</button>
        </div>`;
      }).join('') : `<p class="dk-empty-line">Le bac est vide — tout est rattaché.</p>`}
      <p class="dk-note">Rien ne se range tout seul dans le doute : vous confirmez, l'app apprend (adresse du contributeur, rubrique habituelle).</p>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  insp.querySelectorAll('[data-bac]').forEach(b => b.onclick = () => {
    const row = (_D.inbox || []).find(x => x.id === b.dataset.bac);
    if (row) _openBacItem(row);
  });
}

function _openBacItem(row) {
  const insp = _root.querySelector('[data-slot="insp"]');
  const s = _bacSugg(row), atts = _bacAtts(row);
  const sugArt = s.kind === 'article' ? _artById(s.art_id) : null;
  const candIds = Array.isArray(s.candidates) ? s.candidates : [];
  const attendus = (_D.articles || []).filter(a => ['propose', 'attendu'].includes(a.status));
  const rubs = _D.rubriques || [];
  const via = BAC_VIA[s.via] || '';
  const defMode = sugArt ? 'art' : 'new';
  insp.innerHTML = _inspShell(row.subject || '(sans objet)',
    `<div class="dk-insp-rub">${_esc(row.from_name || row.from_email || 'expéditeur inconnu')}${row.from_email && row.from_name ? ' · ' + _esc(row.from_email) : ''} · ${_relTime(row.received_at)}</div>`,
    `${row.body ? `<div class="dk-sec"><h4>Message</h4><div class="dk-bac-body">${_esc(row.body.slice(0, 1500))}${row.body.length > 1500 ? '…' : ''}</div></div>` : ''}
    ${atts.length ? `<div class="dk-sec"><h4>Pièces jointes (${atts.length})</h4>
      ${atts.map(a => `<div class="dk-file"><span class="dk-file-ico">${icon('paperclip', 13)}</span>
        <div class="dk-file-info"><div class="dk-file-name">${_esc(a.name)}</div><div class="dk-file-meta">${_fmtSize(a.size)}</div></div></div>`).join('')}
      <p class="dk-note">Versées au casier au moment du rattachement.</p></div>` : ''}
    <div class="dk-sec"><h4>Rattacher${via ? ` <span class="dk-bac-via">· ${via}</span>` : ''}</h4>
      ${sugArt ? `<label class="dk-bac-choice"><input type="radio" name="bacmode" value="art" ${defMode === 'art' ? 'checked' : ''}>
        <span>C'est la copie de <strong>« ${_esc(sugArt.title)} »</strong>${sugArt.contrib ? ' (' + _esc(sugArt.contrib) + ')' : ''}</span></label>` : ''}
      ${attendus.length ? `<label class="dk-bac-choice"><input type="radio" name="bacmode" value="autre">
        <span>Un autre article attendu :</span></label>
      <select data-k="bacart" class="dk-bac-select">${attendus.slice(0, 80).map(a => `<option value="${a.id}" ${candIds.includes(a.id) && (!sugArt || a.id !== sugArt.id) ? '' : ''}>${_esc(a.title)}${a.contrib ? ' — ' + _esc(a.contrib) : ''}</option>`).join('')}</select>` : ''}
      <label class="dk-bac-choice"><input type="radio" name="bacmode" value="new" ${defMode === 'new' ? 'checked' : ''}>
        <span>Un spontané — nouvel article au marbre :</span></label>
      <div class="dk-bac-new">
        <label class="dk-field"><span>Titre</span><input type="text" data-k="bactitle" maxlength="240" value="${_esc(row.subject || '')}"></label>
        <label class="dk-field"><span>Rubrique</span><select data-k="bacrub">
          <option value="">Sans rubrique</option>
          ${rubs.map(r => `<option value="${r.id}" ${s.rub_id === r.id ? 'selected' : ''}>${_esc(r.name)}</option>`).join('')}
        </select></label>
        <label class="dk-field"><span>Contributeur</span><input type="text" data-k="baccontrib" maxlength="160" value="${_esc(row.from_name || '')}"></label>
      </div>
      <div class="dk-btn-row" style="margin-top:12px">
        <button class="dk-btn primary" data-act="bacok">${icon('check', 14)} Confirmer</button>
        <button class="dk-btn" data-act="bacreject">Rejeter</button>
        <button class="dk-btn ghost" data-act="bacback">Retour</button>
      </div>
      <div data-slot="bacmsg"></div>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  insp.querySelector('[data-act="bacback"]').onclick = _openBacList;
  insp.querySelector('[data-k="bacart"]')?.addEventListener('change', () => {
    insp.querySelector('input[name="bacmode"][value="autre"]').checked = true;
  });
  insp.querySelector('[data-act="bacok"]').onclick = async () => {
    const mode = insp.querySelector('input[name="bacmode"]:checked')?.value;
    let body = null;
    if (mode === 'art' && sugArt) body = { art_id: sugArt.id };
    else if (mode === 'autre') {
      const id = insp.querySelector('[data-k="bacart"]')?.value;
      if (!id) { _toast('Choisissez un article', true); return; }
      body = { art_id: id };
    } else {
      const title = insp.querySelector('[data-k="bactitle"]').value.trim();
      if (!title) { _toast('Le titre est requis', true); return; }
      body = { create: { title, rub_id: insp.querySelector('[data-k="bacrub"]').value || null, contrib: insp.querySelector('[data-k="baccontrib"]').value.trim() } };
    }
    try {
      await _api('/inbox/' + row.id + '/apply', { method: 'POST', body });
      _toast(body.art_id ? 'Copie rattachée — pointée reçue.' : 'Spontané créé au marbre.');
      await _loadIssue(true);
      if ((_D.inbox || []).length) _openBacList(); else _closeInsp();
      _renderFer();
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="bacreject"]').onclick = async () => {
    const box = insp.querySelector('[data-slot="bacmsg"]');
    box.innerHTML = `<div class="dk-confirm">Rejeter cette contribution ? Les pièces jointes seront supprimées.
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn primary small" data-act="rejyes">Rejeter</button>
        <button class="dk-btn small" data-act="rejno">Annuler</button></div></div>`;
    box.querySelector('[data-act="rejno"]').onclick = () => { box.innerHTML = ''; };
    box.querySelector('[data-act="rejyes"]').onclick = async () => {
      try {
        await _api('/inbox/' + row.id + '/reject', { method: 'POST' });
        _toast('Contribution rejetée.');
        await _loadIssue(true);
        if ((_D.inbox || []).length) _openBacList(); else _closeInsp();
        _renderFer();
      } catch (e) { _toast(e.message, true); }
    };
  };
}

/* ═══════════ DK-3 · Relances (liste + brouillon proposé) ════════ */
// Liste des copies à relancer (calculée — voir _relanceInfo).
function _openRelanceList() {
  const insp = _root.querySelector('[data-slot="insp"]');
  const dues = _relancesDues();
  insp.innerHTML = _inspShell('Relances — copies en attente', null,
    `<div class="dk-sec">
      ${dues.length ? dues.map(a => {
        const pl = _placementsOf(a.id);
        const late = a.due ? Math.round((Date.now() - new Date(a.due + 'T12:00:00').getTime()) / DAY) : 0;
        const ri = _relanceInfo(a);
        return `<div class="dk-banc-item">
          <div class="dk-banc-info">
            <div class="dk-banc-title">${_esc(a.title)}</div>
            <div class="dk-banc-meta">${_esc(a.contrib || '—')} · ${pl.tit.length ? 'p. ' + pl.tit.map(_pn).join(', ') : 'au marbre'}${a.due ? ' · remise le ' + _fmtD(a.due) : ''}${late > 0 ? ` · <span class="rouge">${late} j de retard</span>` : (ri && ri.mode === 'avant' ? ' · rappel avant échéance' : '')}</div>
          </div>
          <button class="dk-btn small primary" data-rel="${a.id}">${icon('mail', 13)} Rédiger</button>
        </div>`;
      }).join('') : `<p class="dk-empty-line">Rien à relancer — toutes les copies attendues sont dans les temps.</p>`}
      <p class="dk-note">Suggestions calculées : échéance de remise + retard moyen constaté du contributeur. Un pointage « copie reçue » retire l'article de lui-même.</p>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  insp.querySelectorAll('[data-rel]').forEach(b => b.onclick = () => {
    const a = _artById(b.dataset.rel);
    if (a) _openRelanceForm(a, _openRelanceList);
  });
}

// Brouillon proposé (§5.4) — gabarit déterministe, la rédactrice ajuste,
// l'envoi part via le worker (Resend) et s'historise sur l'article.
function _openRelanceForm(a, backFn) {
  const insp = _root.querySelector('[data-slot="insp"]');
  const draft = _relanceDraft(a);
  const c = _contribByName(a.contrib);
  const mailer = !!(_D && _D.mailer);
  insp.innerHTML = _inspShell('Relance — ' + (a.contrib || a.title), null,
    `<div class="dk-sec">
      <label class="dk-field"><span>E-mail du contributeur</span><input type="email" data-k="rmail" maxlength="200" value="${_esc(c && c.email || '')}" placeholder="adresse@exemple.fr"></label>
      <label class="dk-field"><span>Objet</span><input type="text" data-k="rsubject" maxlength="200" value="${_esc(draft.subject)}"></label>
      <label class="dk-field"><span>Message</span><textarea data-k="rbody" rows="11" maxlength="6000">${_esc(draft.body)}</textarea></label>
      <div class="dk-btn-row" style="margin-top:10px">
        ${mailer ? `<button class="dk-btn primary" data-act="rsend">${icon('send', 14)} Envoyer</button>` : ''}
        <button class="dk-btn" data-act="rmailto">${icon('mail', 14)} Via ma messagerie</button>
        <button class="dk-btn ghost" data-act="rcancel">Annuler</button>
      </div>
      <p class="dk-note">${mailer
        ? 'L\'envoi est journalisé sur l\'article ; les réponses du contributeur arrivent dans VOTRE boîte (répondre-à).'
        : 'L\'envoi direct n\'est pas encore activé sur ce serveur — « Via ma messagerie » ouvre le brouillon dans votre messagerie habituelle (non journalisé).'}
        L'e-mail saisi est mémorisé pour ${_esc(a.contrib || 'ce contributeur')}.</p>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  const g = k => insp.querySelector(`[data-k="${k}"]`).value;
  const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  insp.querySelector('[data-act="rcancel"]').onclick = () => { if (backFn) backFn(); else _closeInsp(); };
  insp.querySelector('[data-act="rsend"]')?.addEventListener('click', async () => {
    const email = g('rmail').trim().toLowerCase();
    if (!validEmail(email)) { _toast('Indiquez l\'e-mail du contributeur', true); return; }
    try {
      await _api('/article/' + a.id + '/relance', { method: 'POST', body: { email, subject: g('rsubject').trim(), body: g('rbody') } });
      _toast('Relance envoyée à ' + email + '.');
      await _loadIssue(true);
      if (backFn) backFn(); else _closeInsp();
    } catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="rmailto"]').onclick = async () => {
    const email = g('rmail').trim().toLowerCase();
    if (email && validEmail(email) && a.contrib) {
      // Mémoriser l'e-mail même quand l'envoi part de la messagerie perso.
      try { await _api('/publication/' + _pubId + '/contrib', { method: 'POST', body: { name: a.contrib, email } }); _loadIssue(true); } catch (_) {}
    }
    window.location.href = 'mailto:' + encodeURIComponent(email) +
      '?subject=' + encodeURIComponent(g('rsubject').trim()) +
      '&body=' + encodeURIComponent(g('rbody'));
  };
}

// ── Formulaire article (création / édition) ─────────────────────
// page     : créer + réserver comme emplacement de cette page ;
// bancSlot : créer + poser au banc de cet emplacement (remplaçant neuf).
function _openArtForm(page, existing, onDone, bancSlot) {
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
      <label class="dk-field"><span>Fraîcheur</span><select data-k="fresh">
        <option value="intemporel" ${!a || a.fresh !== 'date' ? 'selected' : ''}>intemporel — passe d'un numéro à l'autre sans dommage</option>
        <option value="date" ${a && a.fresh === 'date' ? 'selected' : ''}>daté — lié à une actualité</option>
      </select></label>
      <label class="dk-field" data-slot="perimefield" style="${a && a.fresh === 'date' ? '' : 'display:none'}"><span>Périmé après le (optionnel)</span><input type="date" data-k="perime" value="${a && a.perime ? a.perime : ''}"></label>
      <div class="dk-btn-row" style="margin-top:12px">
        <button class="dk-btn primary" data-act="saveart">${a ? 'Enregistrer' : 'Créer'}</button>
        ${a ? '' : `<button class="dk-btn" data-act="savewrite">${icon('edit-3', 14)} Créer et écrire</button>`}
        <button class="dk-btn" data-act="cancelart">Annuler</button>
      </div>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  insp.querySelector('[data-k="fresh"]').addEventListener('change', e => {
    insp.querySelector('[data-slot="perimefield"]').style.display = e.target.value === 'date' ? '' : 'none';
  });
  const back = () => {
    if (onDone) onDone();
    else if (page) _openInsp(page.n, true);
    else if (_view === 'marbre') { _renderMarbre(); _closeInsp(); }
    else _closeInsp();
  };
  insp.querySelector('[data-act="cancelart"]').onclick = back;
  const doSave = async (thenWrite) => {
    const g = k => insp.querySelector(`[data-k="${k}"]`).value;
    if (!g('title').trim()) { _toast('Le titre est requis', true); return; }
    const body = {
      title: g('title').trim(), rub_id: g('rub') || null, contrib: g('contrib').trim(),
      status: g('status'), due: g('due') || null,
      fresh: g('fresh'), perime: g('fresh') === 'date' ? (g('perime') || null) : null,
    };
    try {
      let artId = a ? a.id : null;
      if (a) {
        await _api('/article/' + a.id, { method: 'PATCH', body });
        _toast('Article mis à jour.');
      } else {
        const r = await _api('/publication/' + _pubId + '/article', { method: 'POST', body });
        artId = r.article.id;
        if (page) await _api('/page/' + page.id + '/slot', { method: 'POST', body: { art_id: artId } });
        else if (bancSlot) await _api('/slot/' + bancSlot.id, { method: 'PATCH', body: { banc: _bancOf(bancSlot).concat(artId) } });
        _toast(page ? 'Article créé et réservé page ' + _pn(page.n) + '.'
          : bancSlot ? 'Article créé et posé au banc des remplaçants.'
          : 'Article créé — il attend au marbre.');
      }
      await _loadIssue(true);
      // Ma propre création/réservation ne doit pas me « pulser ».
      if (!a && artId) { if (page) _ackCardById(page.id); else _ackArtById(artId); }
      if (_view === 'marbre') _renderMarbre();
      if (thenWrite && artId) _openWriter(artId, () => _openInspMarbre(artId));
      else back();
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelector('[data-act="savewrite"]')?.addEventListener('click', () => doSave(true));
  insp.querySelector('[data-act="saveart"]').onclick = () => doSave(false);
}

/* ═══════════ DK-6 · Pré-impression & édition numérique ═══════════
   §8 : le PDF final (export InDesign) confronté au chemin de fer, EN
   CLIENT (pdf.js vendorisé, comme booK) — nombre de pages + articles à
   leur place. Restitution « prêt à imprimer » / liste courte de blocages.
   Puis §7 : « Créer l'édition numérique » → le même PDF devient un
   flipbook booK. ZÉRO worker ; le fichier ne quitte JAMAIS l'appareil. */
function _ppNorm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
// Titre « présent » dans le texte d'une page (tolérant au restyle InDesign) :
// au moins la moitié des mots signifiants (≥ 4 car.) du titre s'y retrouvent.
function _ppTitleInText(title, normText) {
  const toks = _ppNorm(title).split(' ').filter(w => w.length >= 4);
  if (!toks.length) { const whole = _ppNorm(title); return !!whole && normText.includes(whole); }
  const hit = toks.filter(w => normText.includes(w)).length;
  return hit / toks.length >= 0.5;
}

function _openPrepress() {
  if (!_D || !_D.issue) return;
  const insp = _root.querySelector('[data-slot="insp"]');
  insp.innerHTML = _inspShell('Pré-impression & édition',
    `<div class="dk-insp-rub">n° ${_esc(_D.issue.num)}${_D.issue.theme ? ' · ' + _esc(_D.issue.theme) : ''} · ${_D.pages.length} pages au chemin de fer</div>`,
    `<div class="dk-sec"><h4>Le PDF final (export InDesign)</h4>
      <p class="dk-note">Confrontez votre PDF au chemin de fer — nombre de pages, articles à leur place. Le fichier ne quitte pas votre appareil.</p>
      <div class="dk-btn-row">
        <button class="dk-btn primary" data-act="ppfile">${icon('file-text', 14)} ${_ppFile ? 'Choisir un autre PDF' : 'Choisir le PDF…'}</button>
        <input type="file" data-k="ppfile" accept="application/pdf,.pdf" style="display:none">
      </div>
      ${_ppFile ? `<p class="dk-note" style="margin-top:6px">Fichier retenu : <strong>${_esc(_ppFile.name)}</strong> · ${_fmtSize(_ppFile.size)}</p>` : ''}
      <div data-slot="ppresult"></div>
    </div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  const input = insp.querySelector('[data-k="ppfile"]');
  insp.querySelector('[data-act="ppfile"]').onclick = () => input.click();
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!/pdf$/i.test(f.name) && f.type !== 'application/pdf') { _toast('Un PDF est attendu.', true); return; }
    _ppFile = f;
    _openPrepress();          // ré-affiche l'entête (nom du fichier) puis analyse
  });
  if (_ppFile) _prepressCheck();
}

async function _prepressCheck() {
  const box = _root && _root.querySelector('[data-slot="ppresult"]');
  if (!box || !_ppFile) return;
  box.innerHTML = `<div class="dk-pp-run"><span class="dk-spin"></span> Analyse du PDF…</div>`;
  let doc;
  try {
    // pdf.js sert UNIQUEMENT à l'analyse, dans le pad (comme l'import booK).
    const pdfjsLib = await import('/app/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/app/vendor/pdfjs/pdf.worker.min.mjs';
    doc = await pdfjsLib.getDocument({ data: await _ppFile.arrayBuffer() }).promise;
  } catch (e) {
    box.innerHTML = `<p class="dk-pp-line rouge">PDF illisible : ${_esc(e.message || String(e))}</p>${_bookBtnHTML()}`;
    _bindBookBtn(box);
    return;
  }
  const numPages = doc.numPages;
  const expected = _D.pages.length;
  // Texte de chaque page (léger : pas de rendu). Cap de sécurité.
  const CAP = 500, upto = Math.min(numPages, CAP), texts = {};
  for (let i = 1; i <= upto; i++) {
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      texts[i] = _ppNorm(tc.items.map(it => it.str).join(' '));
      page.cleanup();
    } catch (_) { texts[i] = ''; }
  }
  try { doc.destroy(); } catch (_) {}
  if (!_root || !_root.contains(box)) return;   // panneau fermé entre-temps

  // Confrontation article ↔ page attendue (n° de page = n de la carte).
  const warnings = [];
  for (const p of _D.pages) {
    if (p.kind !== 'article') continue;
    for (const s of _slotsOf(p)) {
      const a = _artById(s.art_id);
      if (!a) continue;
      const onPage = texts[p.n] !== undefined ? texts[p.n] : '';
      if (_ppTitleInText(a.title, onPage)) continue;      // à sa place ✓
      let elsewhere = null;
      for (let i = 1; i <= upto; i++) { if (i !== p.n && _ppTitleInText(a.title, texts[i] || '')) { elsewhere = i; break; } }
      warnings.push({ art: a.title, page: p.n, elsewhere, empty: onPage.replace(/\s/g, '').length < 12 });
    }
  }
  const countOk = numPages === expected;
  const problems = warnings.length + (countOk ? 0 : 1);
  let html = '';
  if (!problems) {
    html += `<div class="dk-pp-verdict ok">${icon('check-circle', 22)}<div><strong>Prêt à imprimer.</strong><span class="dk-note">${numPages} pages, chaque article à sa place.</span></div></div>`;
  } else {
    html += `<div class="dk-pp-verdict warn">${icon('alert-triangle', 22)}<div><strong>${problems} point${problems > 1 ? 's' : ''} à vérifier avant impression.</strong></div></div>`;
    html += `<ul class="dk-pp-list">`;
    if (!countOk) html += `<li class="rouge">${numPages} page${numPages > 1 ? 's' : ''} dans le PDF, ${expected} au chemin de fer — écart de ${Math.abs(numPages - expected)}.</li>`;
    for (const w of warnings) {
      const tail = w.elsewhere ? ` — trouvé p. ${_pn(w.elsewhere)}` : (w.empty ? ' — page vide ou photo pleine page' : ' — introuvable');
      html += `<li class="ambre">« ${_esc(w.art)} » attendu p. ${_pn(w.page)}${tail}.</li>`;
    }
    html += `</ul><p class="dk-note">Contrôle déterministe (texte du PDF vs titres du chemin de fer). Un article très restylé ou entièrement en image peut passer pour « introuvable ».</p>`;
  }
  html += _bookBtnHTML();
  box.innerHTML = html;
  _bindBookBtn(box);
}

function _bookBtnHTML() {
  return `<div class="dk-sec"><h4>Édition numérique</h4>
    <p class="dk-note">Transformez ce PDF en flipbook feuilletable dans booK — l'édition numérique de votre numéro.</p>
    <div class="dk-btn-row"><button class="dk-btn" data-act="tobook">${icon('book', 14)} Créer l'édition numérique</button></div>
  </div>`;
}
function _bindBookBtn(box) {
  box.querySelector('[data-act="tobook"]')?.addEventListener('click', () => _toBook());
}
// Pont booK (§7) : le PDF retenu part en flipbook. Workspace plein écran →
// on ferme desK avant (piège z-index) ; le File voyage en mémoire via opts.
async function _toBook() {
  if (!_ppFile) { _toast('Choisissez d’abord le PDF final.', true); return; }
  const pub = _pubs.find(p => p.id === _pubId);
  const title = (pub ? pub.name : 'Revue') + ' — n° ' + (_D.issue ? _D.issue.num : '');
  const file = _ppFile;
  closeDesk();
  try { const m = await import('./ui-renderer.js'); m.openTool('O-BOK-001', { importPdf: file, title }); } catch (_) {}
}

// Réordonner une rubrique (front seul : la colonne `position` et le PATCH
// existent côté worker depuis DK-2). On renormalise TOUTE la liste à 0..n-1
// dans le nouvel ordre et on ne PATCHe que les positions qui bougent — robuste
// même si un ancien `position` avait des trous (rubrique supprimée au milieu).
async function _moveRub(id, dir) {
  const rubs = (_D?.rubriques || []).slice();   // déjà trié par position
  const i = rubs.findIndex(r => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rubs.length) return;
  [rubs[i], rubs[j]] = [rubs[j], rubs[i]];
  try {
    const patches = [];
    rubs.forEach((r, idx) => { if (r.position !== idx) patches.push(_api('/rubrique/' + r.id, { method: 'PATCH', body: { position: idx } })); });
    await Promise.all(patches);
    await _loadIssue(true);
    _openSettings();
  } catch (e) { _toast(e.message, true); }
}

/* ═══════════════════ Réglages (publication / numéro / équipe) ══ */
async function _openSettings() {
  if (!_pubId) return;
  const insp = _root.querySelector('[data-slot="insp"]');
  const pub = _pubs.find(p => p.id === _pubId);
  const _sy = _inspScrollGet('settings');   // avant le spinner (sinon on perd la position)
  insp.innerHTML = _inspShell('Réglages — ' + (pub ? pub.name : ''), null, `<div class="dk-center"><div class="dk-spin"></div></div>`);
  _bindClose(insp);
  insp.classList.add('on');
  _root.querySelector('[data-slot="veil"]').classList.add('on');
  let team = { members: [], invites: [] };
  try { team = await _api('/publication/' + _pubId + '/team'); } catch (_) {}
  const jalons = (() => { try { return JSON.parse(_D?.issue?.jalons || '{}'); } catch (_) { return {}; } })();
  const rubs = _D?.rubriques || [];
  const istatus = _D?.issue?.status || 'preparation';
  insp.innerHTML = _inspShell('Réglages — ' + (pub ? pub.name : ''), null, `
    ${pub && pub.owner ? `<div class="dk-sec"><h4>Publication</h4>
      <div class="dk-form-row">
        <input type="text" data-k="pubname" maxlength="120" value="${_esc(pub.name)}">
        <button class="dk-btn small" data-act="renamepub">Renommer</button>
      </div>
    </div>` : ''}

    ${(() => {
      const em = _D?.email || {};
      const slug = em.slug || pub?.slug || '';
      const addr = em.domain && slug ? `${slug}@${em.domain}` : null;
      return `<div class="dk-sec"><h4>Adresse de dépôt (contributions par e-mail)</h4>
        ${pub && pub.owner ? `<div class="dk-form-row dk-slug-row">
          <input type="text" data-k="pubslug" maxlength="40" value="${_esc(slug)}" spellcheck="false" placeholder="l-epaulette">
          <span class="dk-slug-fix">@${_esc(em.domain || '…')}</span>
          <button class="dk-btn small" data-act="saveslug">Enregistrer</button>
        </div>` : (addr ? `<p class="dk-bac-addr"><strong>${_esc(addr)}</strong></p>` : '')}
        <p class="dk-note">${addr
          ? `Transférez-y (ou mettez en copie) les e-mails des contributeurs : la copie se pointe toute seule quand l'expéditeur est connu, le reste attend dans le bac « à trier ». Rien ne se range en silence.`
          : `Le branchement e-mail arrive — cette adresse s'activera avec le domaine de dépôt. Le bac « à trier » et la digestion sont déjà prêts.`}</p>
      </div>`;
    })()}

    ${pub && pub.owner ? (() => {
      const o = _numOpt();
      return `<div class="dk-sec"><h4>Numérotation des pages</h4>
        <label class="dk-field dk-field-row"><span>Style</span><select data-k="numstyle">
          <option value="standard" ${!o.cover ? 'selected' : ''}>Standard — 1, 2, 3…</option>
          <option value="cover" ${o.cover ? 'selected' : ''}>Couverture hors numérotation</option>
        </select></label>
        <label class="dk-field dk-field-row" data-slot="numstart" style="${o.cover ? '' : 'display:none'}"><span>La page suivant la couverture porte le n°</span>
          <input type="number" data-k="firstfolio" min="-5" max="20" step="1" value="${o.cover ? o.first : 0}"></label>
        <div class="dk-btn-row"><button class="dk-btn small primary" data-act="savenum">Enregistrer</button>
          <span class="dk-note" data-slot="numpreview" style="align-self:center"></span></div>
        <p class="dk-note">La couverture s'affiche « Couverture » sans folio ; la numérotation reprend au numéro choisi (0 pour L'Épaulette, le sommaire devient alors « 1 »). L'ordre réel des pages ne change pas — seul le folio affiché change.</p>
      </div>`;
    })() : ''}

    ${_D?.issue ? `<div class="dk-sec"><h4>Jalons du n° ${_esc(_D.issue.num)}</h4>
      ${JALON_DEFS.map(j => `<label class="dk-field dk-field-row"><span>${j.name}</span><input type="date" data-jalon="${j.key}" value="${jalons[j.key] || ''}"></label>`).join('')}
      <div class="dk-btn-row"><button class="dk-btn small primary" data-act="savejalons">Enregistrer les jalons</button></div>
    </div>

    <div class="dk-sec"><h4>Vie du n° ${_esc(_D.issue.num)}</h4>
      <label class="dk-field dk-field-row"><span>Statut</span><select data-k="istatus">
        ${ISSUE_STATUS_DEFS.map(s => `<option value="${s.key}" ${istatus === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select></label>
      <div data-slot="statusconfirm"></div>
      <p class="dk-note">Passer en « imprimé » déclenche le rituel de bouclage : les articles en page sont marqués publiés, les remplaçants restés au banc sont reversés au marbre avec la mention du report.</p>
    </div>

    <div class="dk-sec"><h4>Nombre de pages du n° ${_esc(_D.issue.num)}</h4>
      <label class="dk-field dk-field-row"><span>Ce numéro compte</span>
        <span class="dk-pagesizer"><input type="number" data-k="pagecount" min="4" max="400" step="1" value="${_D.pages.length}"> pages</span></label>
      <div class="dk-btn-row"><button class="dk-btn small primary" data-act="savepages">Appliquer</button>
        <span class="dk-note" data-slot="pagehint" style="align-self:center">actuellement ${_D.pages.length} pages</span></div>
      <div data-slot="pageconfirm"></div>
      <p class="dk-note">On ajoute ou retire des pages vides <strong>juste avant la 4ᵉ de couverture</strong> — le reste du chemin de fer ne bouge pas. Réduire n'est possible que si les pages retirées sont vides (sinon desK vous dit lesquelles libérer).</p>
    </div>` : ''}

    <div class="dk-sec"><h4>Rubriques (liste fermée)</h4>
      <div data-slot="rublist">${rubs.map((r, i) => `
        <div class="dk-banc-item">
          <span class="dk-rub-move">
            <button class="dk-movebtn" data-rubup="${r.id}" ${i === 0 ? 'disabled' : ''} title="Monter" aria-label="Monter">${icon('chevron-up', 13)}</button>
            <button class="dk-movebtn" data-rubdown="${r.id}" ${i === rubs.length - 1 ? 'disabled' : ''} title="Descendre" aria-label="Descendre">${icon('chevron-down', 13)}</button>
          </span>
          <input type="color" data-rubcolor="${r.id}" value="${_esc(r.color || '#8d93a8')}" title="Choisir la couleur">
          <div class="dk-banc-info"><div class="dk-banc-title">${_esc(r.name)}</div></div>
          <input type="text" class="dk-hex" data-rubhex="${r.id}" value="${_esc(r.color || '')}" maxlength="7" spellcheck="false" title="Code hexadécimal de votre charte (ex. #C9A227)">
          <button class="dk-btn small ghost" data-delrub="${r.id}" title="Supprimer">${icon('x', 13)}</button>
        </div>`).join('')}</div>
      <div class="dk-form-row">
        <input type="text" data-k="newrub" maxlength="60" placeholder="Nouvelle rubrique">
        <input type="color" data-k="newrubcolor" value="#8d93a8" title="Couleur">
        <button class="dk-btn small" data-act="addrub">Ajouter</button>
      </div>
      <p class="dk-note">Les flèches réordonnent la liste — l'ordre choisi se retrouve partout (menus, sélecteurs, tri du chemin de fer). La couleur habille les cartes de la rubrique (liseré + fond). Le champ code accepte l'hexadécimal exact de la charte de votre revue.</p>
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
    </div>

    ${pub && pub.owner ? `<div class="dk-sec dk-danger"><h4>Supprimer la revue</h4>
      <p class="dk-note">Efface définitivement <strong>${_esc(pub.name)}</strong> et TOUT son contenu : numéros, chemin de fer, marbre, casier, bac à trier, contributeurs, équipe. L'adresse de dépôt est libérée. Irréversible.</p>
      <div data-slot="delpub"><button class="dk-btn ghost small dk-btn-danger" data-act="delpub">${icon('trash-2', 14)} Supprimer cette revue…</button></div>
    </div>` : ''}`);
  _bindClose(insp);

  insp.querySelector('[data-act="delpub"]')?.addEventListener('click', () => {
    const box = insp.querySelector('[data-slot="delpub"]');
    box.innerHTML = `<div class="dk-confirm">
      Pour confirmer, saisissez le nom exact de la revue : <strong>${_esc(pub.name)}</strong>
      <input type="text" class="dk-del-input" data-k="delconfirm" placeholder="${_esc(pub.name)}" spellcheck="false" autocomplete="off" style="margin-top:8px">
      <div class="dk-btn-row" style="margin-top:8px">
        <button class="dk-btn small dk-btn-danger" data-act="delyes" disabled>Supprimer définitivement</button>
        <button class="dk-btn small" data-act="delno">Annuler</button>
      </div></div>`;
    const inp = box.querySelector('[data-k="delconfirm"]');
    const yes = box.querySelector('[data-act="delyes"]');
    inp.focus();
    inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== pub.name; });
    box.querySelector('[data-act="delno"]').onclick = () => _openSettings();
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        await _api('/publication/' + _pubId, { method: 'DELETE', body: { confirm: inp.value.trim() } });
        // Retirer la publication de l'état local et repartir proprement.
        _pubs = _pubs.filter(p => p.id !== _pubId);
        _closeInsp();
        _toast('Revue supprimée.');
        if (_pubs.length) {
          _pubId = _pubs[0].id; _issueId = null; _D = null;
          localStorage.removeItem('dk_last_pub'); localStorage.removeItem('dk_last_issue');
          try { localStorage.removeItem('dk_cache_v1'); } catch (_) {}
          _boot();
        } else {
          _pubId = null; _issueId = null; _D = null;
          try { localStorage.removeItem('dk_cache_v1'); } catch (_) {}
          _renderCreatePub();
        }
      } catch (e) { _toast(e.message, true); _openSettings(); }
    };
  });

  insp.querySelector('[data-act="renamepub"]')?.addEventListener('click', async () => {
    const name = insp.querySelector('[data-k="pubname"]').value.trim();
    if (!name) return;
    try { await _api('/publication/' + _pubId, { method: 'PATCH', body: { name } }); pub.name = name; _renderPubSlot(); _toast('Publication renommée.'); }
    catch (e) { _toast(e.message, true); }
  });
  insp.querySelector('[data-act="saveslug"]')?.addEventListener('click', async () => {
    const slug = insp.querySelector('[data-k="pubslug"]').value.trim().toLowerCase();
    if (!slug) return;
    try {
      await _api('/publication/' + _pubId, { method: 'PATCH', body: { slug } });
      if (pub) pub.slug = slug;
      _toast('Adresse de dépôt mise à jour.');
      await _loadIssue(true); _openSettings();
    } catch (e) { _toast(e.message, true); }
  });
  // Numérotation d'affichage (option §L'Épaulette) — aperçu vivant + save.
  {
    const styleSel = insp.querySelector('[data-k="numstyle"]');
    const startRow = insp.querySelector('[data-slot="numstart"]');
    const startInp = insp.querySelector('[data-k="firstfolio"]');
    const preview  = insp.querySelector('[data-slot="numpreview"]');
    if (styleSel) {
      const paint = () => {
        const cover = styleSel.value === 'cover';
        if (startRow) startRow.style.display = cover ? '' : 'none';
        const first = cover ? (parseInt(startInp.value, 10) || 0) : 1;
        // Aperçu linéaire : couverture (ou 1er folio) puis les suivants.
        const seq = [cover ? 'Couverture' : String(first)];
        let k = cover ? first : first + 1;
        for (let i = 0; i < 5; i++) { seq.push(String(k)); k++; }
        if (preview) preview.textContent = 'Aperçu : ' + seq.join(' · ') + ' …';
      };
      paint();
      styleSel.addEventListener('change', paint);
      startInp?.addEventListener('input', paint);
    }
    insp.querySelector('[data-act="savenum"]')?.addEventListener('click', async () => {
      const cover = styleSel.value === 'cover';
      const body = { cover_unnumbered: cover, first_folio: cover ? (parseInt(startInp.value, 10) || 0) : 1 };
      try {
        await _api('/publication/' + _pubId, { method: 'PATCH', body });
        if (pub) { pub.cover_unnumbered = cover; pub.first_folio = body.first_folio; }
        _toast('Numérotation mise à jour.');
        _renderFer();               // frise + rail reprennent le nouveau folio
        _openSettings();
      } catch (e) { _toast(e.message, true); }
    });
  }
  // Nombre de pages du numéro (redimensionnement §avant la 4ᵉ de couv).
  {
    const inp = insp.querySelector('[data-k="pagecount"]');
    const hint = insp.querySelector('[data-slot="pagehint"]');
    const cur = _D.pages.length;
    inp?.addEventListener('input', () => {
      const v = parseInt(inp.value, 10);
      if (!Number.isFinite(v) || v === cur) { hint.textContent = 'actuellement ' + cur + ' pages'; return; }
      hint.textContent = v > cur ? '+ ' + (v - cur) + ' page(s) avant la 4ᵉ de couv' : '− ' + (cur - v) + ' page(s) retirée(s)';
    });
    const apply = async () => {
      const v = parseInt(inp.value, 10);
      if (!Number.isFinite(v) || v < 4) { _toast('Nombre de pages invalide (min. 4).', true); return; }
      try {
        const r = await _api('/issue/' + _issueId + '/resize', { method: 'POST', body: { pages: v } });
        _toast(r.added ? r.added + ' page(s) ajoutée(s).' : r.removed ? r.removed + ' page(s) retirée(s).' : 'Nombre de pages inchangé.');
        await _loadIssue(true); _renderFer(); _openSettings();
      } catch (e) { _toast(e.message, true); _openSettings(); }
    };
    insp.querySelector('[data-act="savepages"]')?.addEventListener('click', () => {
      const v = parseInt(inp.value, 10);
      const box = insp.querySelector('[data-slot="pageconfirm"]');
      if (Number.isFinite(v) && v < cur) {     // réduction → confirmation sobre
        box.innerHTML = `<div class="dk-confirm">Retirer ${cur - v} page(s) vide(s) avant la 4ᵉ de couverture ?
          <div class="dk-btn-row" style="margin-top:8px">
            <button class="dk-btn small primary" data-act="pgyes">Retirer</button>
            <button class="dk-btn small" data-act="pgno">Annuler</button>
          </div></div>`;
        box.querySelector('[data-act="pgno"]').onclick = () => { box.innerHTML = ''; };
        box.querySelector('[data-act="pgyes"]').onclick = apply;
      } else apply();
    });
  }
  insp.querySelector('[data-act="savejalons"]')?.addEventListener('click', async () => {
    const body = {};
    insp.querySelectorAll('[data-jalon]').forEach(i => { if (i.value) body[i.dataset.jalon] = i.value; });
    try { await _api('/issue/' + _issueId, { method: 'PATCH', body: { jalons: body } }); _toast('Jalons enregistrés.'); await _loadIssue(true); }
    catch (e) { _toast(e.message, true); }
  });
  // Statut du numéro — le passage en « imprimé » demande confirmation (rituel).
  insp.querySelector('[data-k="istatus"]')?.addEventListener('change', async e => {
    const v = e.target.value;
    const box = insp.querySelector('[data-slot="statusconfirm"]');
    const apply = async () => {
      try {
        const r = await _api('/issue/' + _issueId, { method: 'PATCH', body: { status: v } });
        if (r.boucle) _toast(`Bouclage du n° ${_D.issue.num} : ${r.boucle.published} publié${r.boucle.published > 1 ? 's' : ''} · ${r.boucle.reversed} reversé${r.boucle.reversed > 1 ? 's' : ''} au marbre.`);
        else _toast('Statut du numéro mis à jour.');
        await _loadIssue(true);
        _openSettings();
      } catch (err2) { _toast(err2.message, true); }
    };
    if (v === 'imprime' && _D.issue.status !== 'imprime') {
      box.innerHTML = `<div class="dk-confirm">Passer le n° ${_esc(_D.issue.num)} en « imprimé » ?
        <br><span class="dk-note">Rituel de bouclage : titulaires marqués publiés, remplaçants non utilisés reversés au marbre, bancs vidés.</span>
        <div class="dk-btn-row" style="margin-top:8px">
          <button class="dk-btn primary small" data-act="styes">Imprimer et boucler</button>
          <button class="dk-btn small" data-act="stno">Annuler</button>
        </div></div>`;
      box.querySelector('[data-act="stno"]').onclick = () => { box.innerHTML = ''; e.target.value = _D.issue.status; };
      box.querySelector('[data-act="styes"]').onclick = apply;
    } else apply();
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
  insp.querySelectorAll('[data-rubup]').forEach(b => b.onclick = () => _moveRub(b.dataset.rubup, -1));
  insp.querySelectorAll('[data-rubdown]').forEach(b => b.onclick = () => _moveRub(b.dataset.rubdown, 1));
  // Recolorer une rubrique : pipette native OU code hexadécimal de la charte.
  const setRubColor = async (id, raw) => {
    let c = String(raw || '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(c)) c = '#' + c;
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) { _toast('Code couleur invalide — attendu #RRGGBB (ex. #C9A227)', true); return; }
    try {
      await _api('/rubrique/' + id, { method: 'PATCH', body: { color: c } });
      _toast('Couleur de rubrique mise à jour.');
      await _loadIssue(true); _openSettings();
    } catch (e) { _toast(e.message, true); }
  };
  insp.querySelectorAll('[data-rubcolor]').forEach(i => i.addEventListener('change', () => setRubColor(i.dataset.rubcolor, i.value)));
  insp.querySelectorAll('[data-rubhex]').forEach(i => {
    i.addEventListener('keydown', e => { if (e.key === 'Enter') setRubColor(i.dataset.rubhex, i.value); });
    i.addEventListener('change', () => setRubColor(i.dataset.rubhex, i.value));
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
  _inspScrollSet('settings', _sy);   // restaure le défilement (ne « remonte » plus en haut)
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
