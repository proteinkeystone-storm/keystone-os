// ═══════════════════════════════════════════════════════════════
// networK — Pad O-NET-001 · NK-2 (Sprint 2 : persistance)
//
// Réseau relationnel vivant (PAS un CRM) : « Vous » au centre-gauche,
// puis les catégories libres, puis les contacts — carte mentale qui se
// déploie G→D. Moteur d'arbre « Keystone Tree » porté du harnais réglé
// (_design-lab/network-tree-harness.html), valeurs figées (§ P ci-dessous).
//
// ⚠ Le centrage vertical vit dans le transform → tout transform animé
// réintègre translate(x, -50%), sinon la pill saute d'une demi-hauteur.
// ⚠ Circulation (gouttes de lumière) : départ retenu par animation-delay
// CSS, JAMAIS de setTimeout (course perdue au resize/clic).
//
// NK-2 = données réelles via l'API worker (/api/network/bootstrap) + cache
// localStorage (rendu instantané puis rafraîchi). Fallback squelette 7
// catégories si hors-ligne / worker pas déployé. V1 100 % manuelle, ZÉRO
// IA. Le CRUD (Ajouter, renommer…) arrive en NK-3. ISOLATION : préfixe nk_.
// ═══════════════════════════════════════════════════════════════

import { icon }                               from './lib/ui-icons.js';
import { ratingButtonHTML, bindRatingButton } from './lib/rating-widget.js';
import { helpButtonHTML, bindHelpButton }     from './lib/help-overlay.js';
import { burgerHTML, bindBurger }             from './lib/topbar-burger.js';
import { getOwnedIds }                        from './pads-loader.js';   // NK-6 : gating raccourcis

const WORKSPACE_META = { id: 'O-NET-001', name: 'networK' };
const SVGNS = 'http://www.w3.org/2000/svg';

// Paramètres d'animation. Valeurs réglées au harnais (défauts) ; ajustables en
// direct via le panneau « Réglages animation » et persistés (localStorage nk_anim).
const P = { dur: 550, stag: 45, ov: 25, cur: 45, pd: 65, ease: 'expo', pillDur: 360, fl: 30 };
const DEFAULT_ANIM = { dur: 550, stag: 45, ov: 25, cur: 45, pd: 65, ease: 'expo', fl: 30 };
const ANIM_KEY = 'nk_anim';
const ANIM_CTRLS = [
  { key: 'dur',  label: 'Durée du tracé',            min: 200, max: 1000, step: 10, unit: ' ms' },
  { key: 'stag', label: 'Cascade (stagger)',         min: 0,   max: 120,  step: 5,  unit: ' ms' },
  { key: 'ov',   label: 'Rebond (overshoot)',        min: 0,   max: 60,   step: 5,  unit: ' %' },
  { key: 'cur',  label: 'Courbure des branches',     min: 10,  max: 90,   step: 5,  unit: ' %' },
  { key: 'pd',   label: 'Départ pill (sur le tracé)', min: 30, max: 100,  step: 5,  unit: ' %' },
  { key: 'fl',   label: 'Circulation',               min: 0,   max: 100,  step: 5,  unit: ' %' },
];
function _loadAnim() { try { const s = JSON.parse(localStorage.getItem(ANIM_KEY) || 'null'); if (s && typeof s === 'object') Object.assign(P, s); } catch (_) {} }
function _saveAnim() { try { localStorage.setItem(ANIM_KEY, JSON.stringify({ dur: P.dur, stag: P.stag, ov: P.ov, cur: P.cur, pd: P.pd, ease: P.ease, fl: P.fl })); } catch (_) {} }
function _applyFlowOpacity() { if (_stage) _stage.style.setProperty('--nk-flowop', P.fl / 100); }
const EASE = {
  expo:  t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  quint: t => 1 - Math.pow(1 - t, 5),
  cubic: t => 1 - Math.pow(1 - t, 3),
};
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE_BP = 820;   // en-dessous : pas de 3ᵉ colonne, la catégorie ouvre une liste plein écran
function _isMobile() { return (_stage ? _stage.getBoundingClientRect().width : window.innerWidth) < MOBILE_BP; }

// ── Couche données (API worker + cache) ─────────────────────────
const API_BASE  = 'https://keystone-os-api.keystone-os.workers.dev';
const CACHE_KEY = 'nk_cache_v1';
const PER_PAGE  = 8;   // contacts affichés avant « Voir les N autres »

// Squelette hors-ligne / pré-déploiement : les 7 catégories par défaut
// (miroir du seed serveur). Jamais persisté ; remplacé dès que l'API répond.
const _DEFAULTS = [
  { label:'Clients', icon:'users' }, { label:'Fournisseurs', icon:'briefcase' },
  { label:'Partenaires', icon:'handshake' }, { label:'Équipe', icon:'users' },
  { label:'Presse & médias', icon:'newspaper' }, { label:'Institutions', icon:'landmark' },
  { label:'Divers', icon:'tag' },
];

function _jwt() { return localStorage.getItem('ks_jwt') || localStorage.getItem('ks_admin_token') || ''; }
async function _api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);   // pas de requête qui pend indéfiniment
  let res;
  try {
    res = await fetch(API_BASE + '/api/network' + path, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + _jwt(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
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
  if (!res.ok) { const e = new Error(data.error || ('Erreur ' + res.status)); e.status = res.status; throw e; }
  return data;
}
function _readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } }
function _writeCache(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ categories: d.categories, contacts: d.contacts, activity: d.activity || [] })); } catch (_) {} }

// ── Activité (NK-5) ─────────────────────────────────────────────
const ACTIVITY_TYPES = [
  { key: 'call',    label: 'Appel',    icon: 'phone' },
  { key: 'email',   label: 'E-mail',   icon: 'mail' },
  { key: 'meeting', label: 'RDV',      icon: 'calendar' },
  { key: 'quote',   label: 'Devis',    icon: 'file-text' },
  { key: 'doc',     label: 'Document', icon: 'paperclip' },
  { key: 'note',    label: 'Note',     icon: 'edit-3' },
  { key: 'other',   label: 'Autre',    icon: 'zap' },
];
function _actMeta(type) { return ACTIVITY_TYPES.find(t => t.key === type) || ACTIVITY_TYPES[ACTIVITY_TYPES.length - 1]; }
function _contactActivity(id) {
  return _activity.filter(a => String(a.contact_id) === String(id))
    .sort((a, b) => String(b.happened_at || '').localeCompare(String(a.happened_at || '')));
}
// Date relative (« Aujourd'hui », « Hier », « Il y a N jours », sinon date courte).
function _relDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return String(iso).slice(0, 10);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  if (days === -1) return 'Demain';
  if (days > 1 && days < 30) return `Il y a ${days} jours`;
  if (days < -1 && days > -30) return `Dans ${-days} jours`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Groupe les contacts par catégorie → structure de rendu de l'arbre.
function _buildCats(categories, contacts) {
  const byCat = {};
  (contacts || []).forEach(ct => { const k = ct.category_id || '_none'; (byCat[k] = byCat[k] || []).push(ct); });
  const mk = (id, label, icon, all, orphan) => ({ id, label, icon, count: all.length,
    contacts: all.slice(0, PER_PAGE), extra: Math.max(0, all.length - PER_PAGE), _all: all, _orphan: orphan });
  const cats = (categories || []).map(c => mk(c.id, c.label, c.icon, byCat[c.id] || [], false));
  // Orphelins : sans catégorie OU rattachés à une catégorie supprimée → panier virtuel
  // (sinon ils disparaissent de l'arbre ET de la recherche). Non renommable/supprimable.
  const known = new Set((categories || []).map(c => String(c.id)));
  const orphans = (contacts || []).filter(ct => !ct.category_id || !known.has(String(ct.category_id)));
  if (orphans.length) cats.push(mk('__none__', 'Sans catégorie', 'folder', orphans, true));
  return cats;
}
function _defaultCats() {
  return _DEFAULTS.map((d, i) => ({ id: 'def-' + i, label: d.label, icon: d.icon, count: 0, contacts: [], extra: 0, _all: [] }));
}

// Cache d'abord (rendu instantané), puis rafraîchit depuis l'API.
async function _boot() {
  const cached = _readCache();
  if (cached) { _cats = _buildCats(cached.categories, cached.contacts); _activity = cached.activity || []; render(true); }
  try {
    const data = await _api('/bootstrap');
    _writeCache(data);
    _cats = _buildCats(data.categories, data.contacts);
    _activity = data.activity || [];
    render(!cached);   // n'anime que si rien n'a encore été peint depuis le cache
  } catch (e) {
    if (!cached && _root) { _cats = _defaultCats(); _activity = []; render(true); }   // hors-ligne / pré-deploy : squelette
  }
}

// ── État module ─────────────────────────────────────────────────
let _root = null, _stage = null, _wires = null, _nodes = null, _scene = null;
let _cats = [];                 // catégories courantes
let _activity = [];             // journal d'activité du tenant (NK-5)
let openCat = null;             // id de la catégorie dépliée (une seule profondeur)
let _expandAll = false;         // « Voir les N autres » : affiche tous les contacts de la catégorie ouverte
let seq = 0;                    // invalide les séquences en cours (anti double-clic)
const jobs = new Set();
let rafId = null;
const timeouts = [];
// Zoom / pan (transform sur .nk-scene)
let _zoom = 1, _panX = 0, _panY = 0;
let _drag = null;
let _overlay = null, _popover = null;   // modale de formulaire / menu contextuel
let _fiche = null, _ficheId = null, _ficheTabId = 'resume';   // fiche contact (NK-4)
let _animPanel = null;   // panneau « Réglages animation »
let _noteTimer = null;
let _lpTimer = null, _lpFired = false;   // appui long sur les actions de fiche (copie)

function later(fn, ms) { const t = setTimeout(fn, ms); timeouts.push(t); return t; }
function clearTimers() { timeouts.forEach(clearTimeout); timeouts.length = 0; }

// ── Ouverture / fermeture ───────────────────────────────────────
export function openNetwork(opts = {}) {
  if (_root) return;
  _cats = [];
  _loadAnim();          // réglages animation persistés (avant le 1er rendu)
  _buildShell();
  _applyFlowOpacity();   // circulation au niveau réglé
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  window.addEventListener('resize', _onResize);
  _boot();   // cache → rendu instantané, puis API (« waou » au 1er paint réel)
}
export function closeNetwork() {
  if (!_root) return;
  clearTimers(); jobs.clear(); rafId = null;
  _closePopover(); clearTimeout(_noteTimer); clearTimeout(_lpTimer); _lpFired = false;
  document.removeEventListener('keydown', _onKey);
  window.removeEventListener('resize', _onResize);
  _root.remove();
  _root = _stage = _wires = _nodes = _scene = null;
  _overlay = _popover = _fiche = _animPanel = null;
  _ficheId = null; _ficheTabId = 'resume';
  openCat = null; _expandAll = false; _zoom = 1; _panX = _panY = 0;
  document.body.style.overflow = '';
}

// ── Coquille workspace ──────────────────────────────────────────
function _buildShell() {
  _root = document.createElement('div');
  _root.className = 'ws-app nk-app';
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
        <span class="ws-topbar-app-picto">${icon('network', 24)}</span>
        <span class="name">${WORKSPACE_META.name}</span>
      </div>
      ${burgerHTML()}
      <div class="ws-topbar-actions">
        <button class="ws-iconbtn nk-anim-btn" data-act="nk-anim-open" aria-label="Réglages de l'animation" title="Réglages de l'animation">${icon('sliders', 20)}</button>
        ${helpButtonHTML(WORKSPACE_META.id)}
        ${ratingButtonHTML(WORKSPACE_META.id)}
      </div>
    </header>
    <div class="ws-body">
      <main class="ws-main nk-main" data-slot="main">
        <div class="nk-canvas" data-slot="canvas">
          <div class="nk-chrome">
            <div class="nk-search">
              ${icon('search', 18)}
              <input type="text" class="nk-search-input" placeholder="Rechercher une personne, une entreprise…" aria-label="Rechercher dans votre réseau">
            </div>
            <button class="nk-add-btn" data-act="nk-add" aria-label="Ajouter au réseau">
              ${icon('plus', 18)}<span>Ajouter</span>
            </button>
            <button class="nk-io-btn" data-act="nk-io" aria-label="Importer / Exporter" title="Importer / Exporter">
              ${icon('download', 18)}
            </button>
          </div>

          <div class="nk-viewport" data-slot="viewport">
            <div class="nk-scene" data-slot="scene">
              <svg class="nk-wires" data-slot="wires" xmlns="${SVGNS}"></svg>
              <div class="nk-nodes" data-slot="nodes"></div>
            </div>
            <div class="nk-empty" data-slot="empty" hidden>
              <div class="nk-you"><div class="nk-you-avatar">${icon('user', 30)}</div><div class="nk-you-label">Vous</div></div>
              <p class="nk-empty-title">Votre réseau vivant, prêt à se déployer.</p>
              <p class="nk-empty-sub">Ajoutez une première relation pour voir votre réseau prendre forme.</p>
            </div>
          </div>

          <div class="nk-toolbar">
            <button class="nk-tool" data-act="nk-zoom-out" title="Dézoomer" aria-label="Dézoomer">${icon('minus', 18)}</button>
            <button class="nk-tool nk-tool-pct" data-act="nk-zoom-reset" title="Réinitialiser le zoom">100 %</button>
            <button class="nk-tool" data-act="nk-zoom-in" title="Zoomer" aria-label="Zoomer">${icon('plus', 18)}</button>
            <button class="nk-tool" data-act="nk-fit" title="Recentrer" aria-label="Recentrer">${icon('maximize', 17)}</button>
          </div>
        </div>
      </main>
    </div>
  `;
  document.body.appendChild(_root);
  _stage    = _root.querySelector('[data-slot="canvas"]');
  _wires    = _root.querySelector('[data-slot="wires"]');
  _nodes    = _root.querySelector('[data-slot="nodes"]');
  _scene    = _root.querySelector('[data-slot="scene"]');
  const vp  = _root.querySelector('[data-slot="viewport"]');

  if (window.innerWidth < MOBILE_BP) { const si = _root.querySelector('.nk-search-input'); if (si) si.placeholder = 'Rechercher'; }
  _root.addEventListener('click', _onClick);
  _root.addEventListener('submit', _onSubmit);
  _root.addEventListener('input', _onInput);
  _root.addEventListener('pointerdown', _onFicheActDown);
  _root.addEventListener('error', _onImgError, true);   // capture : les erreurs <img> ne bouillonnent pas
  vp.addEventListener('pointerdown', _onPanStart);
  vp.addEventListener('wheel', _onWheel, { passive: false });
  try { bindRatingButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindHelpButton(_root, WORKSPACE_META.id); } catch (_) {}
  try { bindBurger(_root); } catch (_) {}
}

// ══════════════════ MOTEUR « KEYSTONE TREE » ══════════════════
// Un seul rAF anime le dashoffset des fils. File vide → arrêt TOTAL
// (immobilité, exigence brief). Pills en spring CSS. Circulation CSS.

function tick(now) {
  for (const j of jobs) {
    const t = Math.max(0, Math.min(1, (now - j.t0) / j.dur));  // clamp : départ différé = invisible
    j.step(EASE[P.ease](t), t);
    if (t >= 1) { jobs.delete(j); j.done && j.done(); }
  }
  rafId = jobs.size ? requestAnimationFrame(tick) : null;      // silence
}
function _ensureRaf() { if (!rafId) rafId = requestAnimationFrame(tick); }
function addPathJob(path, len, dur, delay, done) {
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
  jobs.add({ t0: performance.now() + delay, dur,
    step: e => { path.style.strokeDashoffset = len * (1 - e); }, done });
  _ensureRaf();
}
function retract(path, len) {
  jobs.add({ t0: performance.now(), dur: 190, step: e => { path.style.strokeDashoffset = len * e; } });
  _ensureRaf();
}

function _dims() {
  const r = _stage.getBoundingClientRect();
  return { w: r.width, h: r.height };
}
function layout() {
  const { w, h } = _dims();
  const mobile = w < MOBILE_BP;
  if (mobile) {
    // Mobile : MÊME graphe que desktop, navigué par glissement horizontal.
    // Colonne contacts hors écran à droite → auto-pan pour la révéler (_focusOpenCategory).
    return { you: { x: 44, y: h * .5 }, catX: 110, perX: 392, catGap: 66, perGap: 62, h, mobile };
  }
  return {
    you:  { x: Math.max(90, w * .10), y: h * .5 },
    catX: Math.max(300, w * .30),
    perX: Math.max(560, w * .30 + 330),
    catGap: 74, perGap: 66, h, mobile
  };
}
function bezier(x0, y0, x1, y1) {
  const dx = Math.max(40, (x1 - x0) * (P.cur / 100) * 2);
  return `M ${x0} ${y0} C ${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}`;
}
function hue(name) { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function initials(name) { return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

// ── Avatar : photo manuelle > logo société (domaine) > initiales ──
// Messageries grand public : leur domaine N'EST PAS l'entreprise du contact → ignoré.
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr',
  'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr', 'aol.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.fr', 'yandex.com', 'zoho.com', 'tutanota.com']);
function _logoDomain(c) {
  let d = '';
  if (c.website) { try { d = new URL(_href(c.website)).hostname; } catch (_) {} }
  if (!d && c.email && c.email.includes('@')) {
    const dom = c.email.split('@').pop().toLowerCase().trim();
    if (dom && !FREEMAIL.has(dom)) d = dom;
  }
  return d.replace(/^www\./, '');
}
// Source d'avatar : photo (data URL) sinon logo société via le favicon souverain de
// DuckDuckGo (pas de clé, pas de donnée perso — juste un domaine public). '' si aucune.
function _avatarSrc(c) {
  if (c.photo) return c.photo;
  const d = _logoDomain(c);
  return d ? `https://icons.duckduckgo.com/ip3/${d}.ico` : '';
}
// <img> à superposer sur l'avatar à initiales ; retiré à l'erreur (_onImgError) → repli initiales.
function _avatarImg(c) {
  const src = _avatarSrc(c);
  if (!src) return '';
  return `<img class="nk-av-img${c.photo ? '' : ' nk-av-logo'}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}

// Le centrage vertical vit dans le transform : tout transform animé le réintègre.
function baseTx(el) { return el.classList.contains('nk-you2') ? '-50%' : '0px'; }

function reveal(el, delay) {
  const b = baseTx(el);
  if (REDUCED) { el.style.transition = 'opacity .3s ease'; later(() => { el.style.opacity = 1; }, delay); return; }
  const ov = P.ov / 100;
  el.style.transform = `translate(calc(${b} - 14px), -50%) scale(.92)`;
  el.style.transitionProperty = 'none';
  later(() => {
    void el.offsetWidth;   // reflow forcé : l'état initial est enregistré → la transition part (robuste, indépendant de rAF)
    el.style.transition = `transform ${P.pillDur}ms cubic-bezier(.30, ${1 + ov}, .40, 1), opacity 240ms ease-out`;
    el.style.transform = `translate(${b}, -50%) scale(1)`;
    el.style.opacity = 1;
    el.addEventListener('transitionend', () => { el.style.willChange = 'auto'; }, { once: true });
  }, delay);
}
function vanish(el) {
  el.style.transition = 'transform 160ms ease-in, opacity 140ms ease-in';
  el.style.transform = `translate(calc(${baseTx(el)} - 8px), -50%) scale(.95)`;
  el.style.opacity = 0;
}

// Circulation : goutte de lumière clonée par-dessus un fil. Départ retenu par
// animation-delay CSS (jamais de setTimeout). Invisible tant que circuit incomplet.
function addFlow(srcPath, idx = 0, delayMs = 0) {
  if (REDUCED || !srcPath || P.fl === 0) return;
  const f = document.createElementNS(SVGNS, 'path');
  f.setAttribute('d', srcPath.getAttribute('d'));
  f.setAttribute('pathLength', '100');
  f.classList.add('nk-flow');
  f.dataset.flow = '1';
  f.style.strokeDashoffset = '1.2';
  f.style.animationDuration = (3.4 + (idx % 4) * .3) + 's';
  f.style.animationDelay = (delayMs + idx * 140) + 'ms';
  if (srcPath.dataset.contact) f.dataset.contact = srcPath.dataset.contact;
  _wires.appendChild(f);
}
function clearFlows() { _wires.querySelectorAll('path[data-flow]').forEach(e => e.remove()); }

// Rendu complet + séquence d'ouverture.
function render(animated = true) {
  if (!_root) return;
  seq++; const my = seq;
  clearTimers(); jobs.clear();
  _stage.classList.remove('nk-focus');
  _wires.innerHTML = ''; _nodes.innerHTML = '';

  const empty = _root.querySelector('[data-slot="empty"]');
  if (!_cats.length) { empty.hidden = false; return; }   // état vide (0 catégorie)
  empty.hidden = true;

  const L = layout();

  // « Vous »
  const you = document.createElement('div');
  you.className = 'nk-node nk-you2 nk-enter';
  you.style.left = L.you.x + 'px'; you.style.top = L.you.y + 'px';
  you.innerHTML = `<div class="nk-you2-avatar">${icon('user', 30)}</div><div class="nk-you2-label">Vous</div>`;
  _nodes.appendChild(you);

  const n = _cats.length;
  const yTop = L.you.y - ((n - 1) / 2) * L.catGap;
  const catStag = Math.max(P.stag, 30) * 1.4;

  _cats.forEach((c, i) => {
    const y = yTop + i * L.catGap;
    const el = document.createElement('div');
    el.className = 'nk-node nk-cat nk-enter' + (openCat === c.id ? ' nk-active' : '');
    el.style.left = L.catX + 'px'; el.style.top = y + 'px';
    el.dataset.cat = c.id;
    el.innerHTML =
      `<span class="nk-cat-ic">${icon(c.icon || 'folder', 16)}</span>` +
      `<span class="nk-cat-lbl">${esc(c.label)}</span>` +
      `<span class="nk-cat-cnt">${c.count}</span>` +
      (c._orphan ? '' : `<span class="nk-cat-menu" data-act="nk-cat-menu" data-cat="${esc(c.id)}" aria-label="Gérer la catégorie">${icon('more-horizontal', 16)}</span>`) +
      `<span class="nk-cat-plus" data-act="nk-cat-add" data-cat="${esc(c.id)}" aria-label="Ajouter un contact">${icon('plus', 15)}</span>`;
    _nodes.appendChild(el);
    c._y = y; c._el = el;

    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', bezier(L.you.x + 46, L.you.y, L.catX - 6, y));
    if (openCat === c.id) p.classList.add('nk-lit');
    _wires.appendChild(p);
    const len = p.getTotalLength();
    c._path = p;

    if (animated && !REDUCED) {
      const delay = 120 + i * catStag;
      addPathJob(p, len, P.dur, delay);
      reveal(el, delay + P.dur * (P.pd / 100));
    } else {
      p.style.strokeDasharray = 'none';
      if (animated) reveal(el, 60 + i * 40);
      else el.style.opacity = 1;
    }
  });

  if (animated) reveal(you, 0); else you.style.opacity = 1;

  if (openCat) {
    const c = _cats.find(x => x.id === openCat);
    if (c) {
      const anim = animated && !REDUCED;
      const baseDelay = anim ? 120 + _cats.indexOf(c) * catStag + P.dur * (P.pd / 100) + 80 : 0;
      later(() => { if (my === seq) spawnContacts(c, L, anim); }, baseDelay);
    }
  }
  // Pan mobile : suit la catégorie ouverte, sinon revient à l'arbre (desktop : drag manuel préservé).
  if (_isMobile()) { if (openCat) _focusOpenCategory(false); else _panTo(0, 0, false); }
}

// Déplie les contacts d'une catégorie (cascade haut → bas).
function spawnContacts(c, L, animated) {
  const my = seq;
  _stage.classList.add('nk-focus');
  const list = _expandAll ? (c._all || c.contacts) : c.contacts;
  const circuitDone = (animated && !REDUCED) ? Math.max(0, list.length - 1) * P.stag + P.dur * .85 + 250 : 0;
  addFlow(c._path, 0, circuitDone);

  // Catégorie vide : une amorce « Ajouter un contact » dans la colonne (sinon on
  // glisse vers du vide, surtout en mobile). Vaut aussi pour desktop.
  if (!list.length) {
    const empty = document.createElement('button');
    empty.className = 'nk-node nk-col-empty nk-enter';
    empty.dataset.contact = c.id;
    empty.dataset.act = 'nk-cat-add'; empty.dataset.cat = c.id;
    empty.style.left = L.perX + 'px'; empty.style.top = c._y + 'px';
    empty.innerHTML = `${icon('plus', 16)} Ajouter un contact`;
    _nodes.appendChild(empty);
    reveal(empty, animated && !REDUCED ? 180 : 0);
    return;
  }

  const yTop = Math.max(70, Math.min(
    c._y - ((list.length - 1) / 2) * L.perGap,
    L.h - 70 - (list.length - 1) * L.perGap - (c.extra ? 44 : 0)));
  const catRightX = L.catX + c._el.offsetWidth + 4;   // offsetWidth ignore le transform → départ stable

  list.forEach((ct, i) => {
    const y = Math.max(70, yTop + i * L.perGap);
    const el = document.createElement('div');
    el.className = 'nk-node nk-person nk-enter';
    el.dataset.contact = c.id;
    if (ct.id) el.dataset.id = ct.id;     // NK-4 : ouverture de la fiche
    el.style.left = L.perX + 'px'; el.style.top = y + 'px';
    const h = hue(ct.name);
    el.innerHTML =
      `<span class="nk-av" style="background:hsl(${h} 42% 38% / .85)">${esc(initials(ct.name))}${_avatarImg(ct)}</span>` +
      `<span class="nk-who"><span class="nk-nm">${esc(ct.name)}</span><span class="nk-co">${esc(ct.company || '')}</span></span>`;
    _nodes.appendChild(el);

    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', bezier(catRightX, c._y, L.perX - 6, y));
    path.dataset.contact = c.id;
    path.classList.add('nk-live');   // fil du circuit actif : reste coloré
    _wires.appendChild(path);
    const len = path.getTotalLength();
    addFlow(path, i + 1, circuitDone);

    if (animated && !REDUCED) {
      const delay = i * P.stag;
      addPathJob(path, len, P.dur * .85, delay);
      reveal(el, delay + P.dur * .85 * (P.pd / 100));
    } else {
      path.style.strokeDasharray = 'none';
      if (animated) reveal(el, i * 30);
      else el.style.opacity = 1;
    }
  });

  if (!_expandAll && c.extra) {
    const y = Math.max(70, yTop + list.length * L.perGap) - 8;
    const more = document.createElement('button');
    more.className = 'nk-node nk-more nk-enter';
    more.style.left = L.perX + 'px'; more.style.top = y + 'px';
    more.dataset.contact = c.id;
    more.dataset.act = 'nk-expand'; more.dataset.cat = c.id;
    more.innerHTML = `${icon('chevron-down', 14)} Voir les ${c.extra} autres`;
    _nodes.appendChild(more);
    reveal(more, animated && !REDUCED ? list.length * P.stag + P.dur * .6 : 0);
  }
}

// « Voir les N autres » : ré-affiche la catégorie ouverte avec TOUS ses contacts.
function _expandCategory(id) {
  const c = _cats.find(x => String(x.id) === String(id || openCat));
  if (!c || !c._el) return;
  _expandAll = true;
  clearFlows();
  _nodes.querySelectorAll('[data-contact]').forEach(e => e.remove());
  _wires.querySelectorAll('path[data-contact]').forEach(e => e.remove());
  spawnContacts(c, layout(), true);
  _focusOpenCategory(false);
}

// Ouvre/ferme une catégorie — une seule profondeur visible.
function toggle(id) {
  seq++; const my = seq;
  _expandAll = false;   // toute nouvelle ouverture repart en pagination
  clearFlows();
  _stage.classList.remove('nk-focus');
  _nodes.querySelectorAll('[data-contact]').forEach(vanish);
  _wires.querySelectorAll('path[data-contact]').forEach(p => {
    const len = p.getTotalLength(); p.style.strokeDasharray = len; retract(p, len);
  });
  _cats.forEach(c => c._el && c._el.classList.remove('nk-active'));
  _wires.querySelectorAll('path.nk-lit').forEach(p => p.classList.remove('nk-lit'));

  const closing = (openCat === id);
  openCat = closing ? null : id;

  const purge = () => {
    _nodes.querySelectorAll('[data-contact]').forEach(e => e.remove());
    _wires.querySelectorAll('path[data-contact]').forEach(e => e.remove());
  };
  if (!closing) {
    const c = _cats.find(x => x.id === id);
    c._el.classList.add('nk-active');
    c._path.classList.add('nk-lit');
    const L = layout();
    later(() => { if (my !== seq) return; purge(); spawnContacts(c, L, true); }, 170);
    _focusOpenCategory(true);   // mobile : glisse vers la colonne contacts
  } else {
    later(() => { if (my === seq) purge(); }, 220);
    if (_isMobile()) _panTo(0, 0, true);   // mobile : retour à l'arbre
  }
}

// ── Zoom / Pan (transform sur .nk-scene) ────────────────────────
function _applyTransform() {
  _scene.style.transform = `translate(${_panX}px, ${_panY}px) scale(${_zoom})`;
  const pct = _root.querySelector('.nk-tool-pct');
  if (pct) pct.textContent = Math.round(_zoom * 100) + ' %';
}
function _setZoom(z) { _zoom = Math.max(0.5, Math.min(1.5, z)); _applyTransform(); }

// Glissement de la scène (navigation horizontale mobile). La transition vit en
// CSS ; ici on décide juste animé (classe retirée) ou instantané (nk-nofx).
function _panTo(x, y, animate) {
  if (!_scene) return;
  _panX = x; if (y != null) _panY = y;
  if (animate) { _scene.classList.remove('nk-nofx'); _applyTransform(); }
  else { _scene.classList.add('nk-nofx'); _applyTransform(); requestAnimationFrame(() => { if (_scene) _scene.classList.remove('nk-nofx'); }); }
}
// Mobile : recentre la vue sur la catégorie ouverte (colonne contacts révélée,
// catégorie active en amorce à gauche). Sur desktop : rien (tout tient à l'écran).
function _focusOpenCategory(animate) {
  if (!_isMobile() || !openCat) return;
  const c = _cats.find(x => String(x.id) === String(openCat));
  const L = layout();
  const catRight = L.catX + (c && c._el ? c._el.offsetWidth : 210);
  // amorce ~52px de la catégorie active à gauche + colonne contacts révélée à droite.
  _panTo(52 - catRight, 0, animate);
}
function _onWheel(e) {
  if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
  e.preventDefault();
  _setZoom(_zoom * (e.deltaY < 0 ? 1.08 : 0.92));
}
function _onPanStart(e) {
  if (e.target.closest('.nk-node, .nk-toolbar, .nk-chrome')) return;   // pan = fond seulement
  _drag = { x: e.clientX, y: e.clientY, px: _panX, py: _panY };
  _scene.style.cursor = 'grabbing';
  _scene.classList.add('nk-nofx');   // drag = instantané (pas de transition)
  window.addEventListener('pointermove', _onPanMove);
  window.addEventListener('pointerup', _onPanEnd, { once: true });
}
function _onPanMove(e) {
  if (!_drag) return;
  _panX = _drag.px + (e.clientX - _drag.x);
  _panY = _drag.py + (e.clientY - _drag.y);
  _applyTransform();
}
function _onPanEnd() { _drag = null; if (_scene) { _scene.style.cursor = ''; _scene.classList.remove('nk-nofx'); } window.removeEventListener('pointermove', _onPanMove); }

// ── Panneau « Réglages animation » (flottant, live, persisté) ───
function _openAnimSettings() {
  if (_animPanel) { _closeAnimSettings(); return; }
  const panel = document.createElement('div');
  panel.className = 'nk-animpanel';
  panel.innerHTML =
    `<div class="nk-animpanel-hd">Réglages animation<button class="nk-animpanel-x" data-act="nk-anim-close" aria-label="Fermer">${icon('x', 16)}</button></div>
     ${ANIM_CTRLS.map(c => `<div class="nk-anim-ctrl"><label>${c.label}<output>${P[c.key]}${c.unit}</output></label><input type="range" data-anim="${c.key}" data-unit="${c.unit}" min="${c.min}" max="${c.max}" step="${c.step}" value="${P[c.key]}"></div>`).join('')}
     <div class="nk-anim-seg" data-anim-ease>${['expo', 'quint', 'cubic'].map(e => `<button type="button" data-ease="${e}"${P.ease === e ? ' class="nk-sel"' : ''}>${e[0].toUpperCase() + e.slice(1)}</button>`).join('')}</div>
     <div class="nk-anim-row"><button class="nk-btn nk-btn-primary" data-act="nk-anim-replay">Rejouer</button><button class="nk-btn" data-act="nk-anim-reset">Défaut</button></div>`;
  _root.appendChild(panel);
  _animPanel = panel;
}
function _closeAnimSettings() { if (_animPanel) { _animPanel.remove(); _animPanel = null; } }
function _resetAnim() { Object.assign(P, DEFAULT_ANIM); _saveAnim(); _applyFlowOpacity(); _closeAnimSettings(); _openAnimSettings(); render(true); }

// ══════════════════ NK-3 — CRUD MANUEL ══════════════════
const KIND_LABELS  = { person: 'Personne', company: 'Entreprise', place: 'Établissement', group: 'Groupe' };
const KIND_DEFAULT_ICON = { person: 'user', company: 'building', place: 'landmark', group: 'users' };
const NK_CAT_ICONS = ['users', 'briefcase', 'handshake', 'newspaper', 'landmark', 'tag', 'building', 'folder', 'network', 'user'];

// Réseaux sociaux : type connu → picto du registre ui-icons (jamais d'emoji).
// Les types sans picto dédié retombent sur 'link' (le libellé reste explicite).
const SOCIAL_TYPES = [
  { key: 'linkedin',  label: 'LinkedIn',    icon: 'linkedin' },
  { key: 'instagram', label: 'Instagram',   icon: 'instagram' },
  { key: 'facebook',  label: 'Facebook',    icon: 'facebook' },
  { key: 'threads',   label: 'Threads',     icon: 'threads' },
  { key: 'telegram',  label: 'Telegram',    icon: 'telegram' },
  { key: 'pinterest', label: 'Pinterest',   icon: 'pinterest' },
  { key: 'x',         label: 'X (Twitter)', icon: 'link' },
  { key: 'youtube',   label: 'YouTube',     icon: 'play' },
  { key: 'tiktok',    label: 'TikTok',      icon: 'link' },
  { key: 'whatsapp',  label: 'WhatsApp',    icon: 'message' },
  { key: 'other',     label: 'Autre lien',  icon: 'globe' },
];
function _socialMeta(key) { return SOCIAL_TYPES.find(s => s.key === key) || SOCIAL_TYPES[SOCIAL_TYPES.length - 1]; }
// href sûr : conserve un schéma explicite (mailto:, tel:, https:…), sinon https://.
function _href(u) { u = String(u || '').trim(); if (!u) return ''; return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; }
function _mapUrl(addr) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(addr || '').trim()); }

function _allContacts() { return _cats.flatMap(c => c._all || []); }
function _contactById(id) { return _allContacts().find(c => String(c.id) === String(id)) || null; }
function _realCats() { return _cats.filter(c => !c._orphan && !String(c.id).startsWith('def-')); }   // vraies catégories (ni squelette hors-ligne, ni panier orphelins)
function _tagsText(c) { try { return (Array.isArray(c.tags) ? c.tags : JSON.parse(c.tags || '[]')).join(' '); } catch (_) { return ''; } }

// ── Overlay (modale de formulaire ; bottom-sheet en mobile via CSS) ──
function _openOverlay(innerHTML, onMount) {
  _closeOverlay();
  const ov = document.createElement('div');
  ov.className = 'nk-overlay';
  ov.innerHTML = `<div class="nk-sheet" role="dialog" aria-modal="true">${innerHTML}</div>`;
  _root.appendChild(ov);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) _closeOverlay(); });
  _overlay = ov;
  if (onMount) onMount(ov);
  return ov;
}
function _closeOverlay() { if (_overlay) { _overlay.remove(); _overlay = null; } }

// ── Popover (menu contextuel ancré : catégorie ⋯) ──
function _openPopover(innerHTML, anchor) {
  _closePopover();
  const pop = document.createElement('div');
  pop.className = 'nk-popover';
  pop.innerHTML = innerHTML;
  _root.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = r.left + 'px';
  requestAnimationFrame(() => {
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 12) pop.style.left = (window.innerWidth - pr.width - 12) + 'px';
    if (pr.bottom > window.innerHeight - 12) pop.style.top = (r.top - pr.height - 6) + 'px';
  });
  _popover = pop;
  setTimeout(() => document.addEventListener('pointerdown', _popoverAway, { once: true }), 0);
}
function _popoverAway(e) { if (_popover && !_popover.contains(e.target)) _closePopover(); }
function _closePopover() { if (_popover) { _popover.remove(); _popover = null; } }

// ── Toast (retour d'action, discret) ──
function _toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'nk-toast nk-toast-' + kind;
  t.textContent = msg;
  _root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('nk-toast-in'));
  setTimeout(() => { t.classList.remove('nk-toast-in'); setTimeout(() => t.remove(), 250); }, 2600);
}

// ── Menu « Ajouter » ──
function _openAddMenu() {
  const items = [
    { act: 'nk-new-person',  icon: 'user',      label: 'Ajouter une personne' },
    { act: 'nk-new-company', icon: 'building',  label: 'Ajouter une entreprise' },
    { act: 'nk-new-place',   icon: 'landmark',  label: 'Ajouter un établissement' },
    { act: 'nk-new-group',   icon: 'users',     label: 'Ajouter un groupe' },
    { act: 'nk-new-cat',     icon: 'folder',    label: 'Nouvelle catégorie' },
  ];
  _openOverlay(
    `<div class="nk-sheet-hd">Ajouter<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <div class="nk-menu">
       ${items.map(i => `<button class="nk-menu-item" data-act="${i.act}"><span class="nk-menu-ic">${icon(i.icon, 20)}</span><span class="nk-menu-lbl">${i.label}</span>${icon('chevron-right', 16)}</button>`).join('')}
     </div>`
  );
}

// Aperçu photo du formulaire : image si présente, sinon initiales, sinon picto.
function _photoPrevInner(seed) {
  if (seed.photo) return `<img class="nk-av-img" src="${esc(seed.photo)}" alt="">`;
  const nm = (seed.name || '').trim();
  return nm ? esc(initials(nm)) : icon('user', 26);
}
// Redimensionne + recadre carré (~200px) côté navigateur → data URL JPEG légère.
const PHOTO_SIZE = 200;
function _resizePhoto(file, cb) {
  const reader = new FileReader();
  reader.onerror = () => cb(null);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => cb(null);
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = PHOTO_SIZE;
        const scale = Math.max(PHOTO_SIZE / img.width, PHOTO_SIZE / img.height);
        const w = img.width * scale, h = img.height * scale;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, (PHOTO_SIZE - w) / 2, (PHOTO_SIZE - h) / 2, w, h);   // recadrage centré (cover)
        cb(cv.toDataURL('image/jpeg', 0.82));
      } catch (_) { cb(null); }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
function _pickPhoto() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return;
    _resizePhoto(f, url => url ? _setFormPhoto(url) : _toast('Image illisible', 'error')); };
  inp.click();
}
function _setFormPhoto(url) {
  if (!_overlay) return;
  const hid = _overlay.querySelector('input[name="photo"]');
  const prev = _overlay.querySelector('[data-photo-prev]');
  const rm = _overlay.querySelector('[data-act="nk-photo-clear"]');
  const btn = _overlay.querySelector('[data-act="nk-photo-pick"]');
  const nm = (_overlay.querySelector('input[name="name"]') || {}).value || '';
  if (hid) hid.value = url;
  if (prev) prev.innerHTML = url ? `<img class="nk-av-img" src="${esc(url)}" alt="">` : (nm.trim() ? esc(initials(nm)) : icon('user', 26));
  if (rm) rm.hidden = !url;
  if (btn) btn.innerHTML = `${icon('image', 15)} ${url ? 'Changer la photo' : 'Ajouter une photo'}`;
}

// Une ligne d'édition « réseau social » (type + URL + retrait).
function _socialRowHTML(s = {}) {
  const cur = s.type || 'linkedin';
  const opts = SOCIAL_TYPES.map(x => `<option value="${x.key}"${x.key === cur ? ' selected' : ''}>${x.label}</option>`).join('');
  return `<div class="nk-social-row">
    <select class="nk-social-type" aria-label="Réseau">${opts}</select>
    <input class="nk-social-url" type="url" inputmode="url" placeholder="https://…" maxlength="400" value="${esc(s.url || '')}" autocomplete="off">
    <button type="button" class="nk-social-del" data-act="nk-social-del" aria-label="Retirer ce réseau">${icon('x', 15)}</button>
  </div>`;
}

// ── Formulaire contact (création / édition) ──
// seed = contact existant (édition si seed.id) OU { kind, category_id } (création)
function _openContactForm(seed = {}) {
  const isEdit = !!(seed && seed.id);
  const kind = seed.kind || 'person';
  const catOpts = _realCats().map(c =>
    `<option value="${esc(c.id)}"${String(seed.category_id) === String(c.id) ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  const kindOpts = Object.entries(KIND_LABELS).map(([k, l]) =>
    `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('');
  const socials = _parseArr(seed.socials);
  _openOverlay(
    `<div class="nk-sheet-hd">${isEdit ? 'Modifier le contact' : 'Nouveau contact'}<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <form class="nk-form" data-form="contact"${isEdit ? ` data-id="${esc(seed.id)}"` : ''}>
       <div class="nk-photo-field">
         <div class="nk-photo-prev" data-photo-prev>${_photoPrevInner(seed)}</div>
         <div class="nk-photo-acts">
           <button type="button" class="nk-photo-btn" data-act="nk-photo-pick">${icon('image', 15)} ${seed.photo ? 'Changer la photo' : 'Ajouter une photo'}</button>
           <button type="button" class="nk-photo-rm" data-act="nk-photo-clear"${seed.photo ? '' : ' hidden'}>Retirer</button>
         </div>
         <input type="hidden" name="photo" value="${esc(seed.photo || '')}">
       </div>
       <label class="nk-field"><span>Nom</span><input name="name" required maxlength="200" value="${esc(seed.name || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Type</span><select name="kind">${kindOpts}</select></label>
       <label class="nk-field"><span>Entreprise</span><input name="company" maxlength="200" value="${esc(seed.company || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Fonction</span><input name="title" maxlength="200" value="${esc(seed.title || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>E-mail</span><input name="email" type="email" maxlength="200" value="${esc(seed.email || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Téléphone</span><input name="phone" type="tel" maxlength="200" value="${esc(seed.phone || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Téléphone 2</span><input name="phone2" type="tel" maxlength="200" value="${esc(seed.phone2 || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Anniversaire <em class="nk-opt">· optionnel</em></span><input name="birthday" type="date" value="${esc(seed.birthday || '')}"></label>
       <label class="nk-check"><input type="checkbox" name="birthday_remind" value="1"${seed.birthday_remind ? ' checked' : ''}><span>Me le rappeler dans le Living Layer <em class="nk-opt">· à la demande</em></span></label>
       <label class="nk-field"><span>Site web</span><input name="website" type="url" inputmode="url" maxlength="400" placeholder="https://…" value="${esc(seed.website || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Adresse</span><textarea name="address" maxlength="400" rows="2" placeholder="N°, rue, code postal, ville…" autocomplete="off">${esc(seed.address || '')}</textarea></label>
       <label class="nk-field"><span>TVA intracommunautaire <em class="nk-opt">· optionnel</em></span><input name="vat_intra" maxlength="64" value="${esc(seed.vat_intra || '')}" placeholder="FR00 000000000" autocomplete="off"></label>
       <div class="nk-field"><span>Réseaux sociaux</span>
         <div class="nk-socials-edit" data-socials>${socials.map(_socialRowHTML).join('')}</div>
         <button type="button" class="nk-social-add" data-act="nk-social-add">${icon('plus', 14)} Ajouter un réseau</button>
       </div>
       <label class="nk-field"><span>Catégorie</span><select name="category_id"><option value="">— Aucune —</option>${catOpts}</select></label>
       <div class="nk-form-actions">
         ${isEdit ? `<button type="button" class="nk-btn nk-btn-danger" data-act="nk-contact-del" data-id="${esc(seed.id)}">Supprimer</button>` : '<span></span>'}
         <button type="submit" class="nk-btn nk-btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
       </div>
     </form>`,
    ov => { const i = ov.querySelector('input[name="name"]'); if (i) i.focus(); }
  );
}

// ── Formulaire catégorie (création / édition) ──
function _openCategoryForm(cat = null) {
  const isEdit = !!(cat && cat.id);
  const cur = (cat && cat.icon) || 'folder';
  const icons = NK_CAT_ICONS.map(k =>
    `<button type="button" class="nk-icon-opt${k === cur ? ' nk-sel' : ''}" data-icon="${k}" aria-label="${k}">${icon(k, 20)}</button>`).join('');
  _openOverlay(
    `<div class="nk-sheet-hd">${isEdit ? 'Modifier la catégorie' : 'Nouvelle catégorie'}<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <form class="nk-form" data-form="category"${isEdit ? ` data-id="${esc(cat.id)}"` : ''}>
       <label class="nk-field"><span>Nom</span><input name="label" required maxlength="200" value="${esc(cat && cat.label || '')}" autocomplete="off"></label>
       <div class="nk-field"><span>Icône</span><input type="hidden" name="icon" value="${esc(cur)}"><div class="nk-icon-grid">${icons}</div></div>
       <div class="nk-form-actions">
         ${isEdit ? `<button type="button" class="nk-btn nk-btn-danger" data-act="nk-cat-del" data-id="${esc(cat.id)}">Supprimer</button>` : '<span></span>'}
         <button type="submit" class="nk-btn nk-btn-primary">${isEdit ? 'Enregistrer' : 'Créer'}</button>
       </div>
     </form>`,
    ov => { const i = ov.querySelector('input[name="label"]'); if (i) i.focus(); }
  );
}

// ── Menu contextuel catégorie (⋯) ──
function _openCatMenu(catId, anchor) {
  const c = _cats.find(x => String(x.id) === String(catId));
  if (!c) return;
  const i = _cats.indexOf(c);
  const canUp = i > 0 && !_cats[i - 1]._orphan;
  const canDown = i < _cats.length - 1 && !_cats[i + 1]._orphan;
  _openPopover(
    `<button class="nk-pop-item" data-act="nk-cat-edit" data-cat="${esc(catId)}">${icon('settings', 16)} Renommer / icône</button>
     <button class="nk-pop-item" data-act="nk-cat-up"   data-cat="${esc(catId)}"${canUp ? '' : ' disabled'}>${icon('chevron-up', 16)} Monter</button>
     <button class="nk-pop-item" data-act="nk-cat-down" data-cat="${esc(catId)}"${canDown ? '' : ' disabled'}>${icon('chevron-down', 16)} Descendre</button>
     <button class="nk-pop-item nk-pop-danger" data-act="nk-cat-del" data-cat="${esc(catId)}">${icon('trash-2', 16)} Supprimer</button>`,
    anchor
  );
}

// ── Recherche live ──
function _renderSearch(q) {
  const box = _root && _root.querySelector('.nk-search');
  if (!box) return;
  let dd = box.querySelector('.nk-search-results');
  if (!q) { if (dd) dd.remove(); return; }
  const ql = q.toLowerCase();
  const hits = _allContacts().filter(c =>
    (c.name || '').toLowerCase().includes(ql) ||
    (c.company || '').toLowerCase().includes(ql) ||
    _tagsText(c).toLowerCase().includes(ql)).slice(0, 8);
  if (!dd) { dd = document.createElement('div'); dd.className = 'nk-search-results'; box.appendChild(dd); }
  dd.innerHTML = hits.length
    ? hits.map(c => `<button class="nk-search-item" data-id="${esc(c.id)}"><span class="nk-av nk-av-sm" style="background:hsl(${hue(c.name)} 42% 38% / .85)">${esc(initials(c.name))}${_avatarImg(c)}</span><span class="nk-who"><span class="nk-nm">${esc(c.name)}</span><span class="nk-co">${esc(c.company || '')}</span></span></button>`).join('')
    : `<div class="nk-search-empty">Aucun résultat</div>`;
}
function _clearSearch() {
  const inp = _root && _root.querySelector('.nk-search-input');
  if (inp) inp.value = '';
  _renderSearch('');
}

// ── Rafraîchit depuis l'API (après mutation) ──
async function _refresh(animated = false) {
  try {
    const data = await _api('/bootstrap');
    _writeCache(data);
    _cats = _buildCats(data.categories, data.contacts);
    _activity = data.activity || [];
    render(animated);
    if (_ficheId) { const c = _contactById(_ficheId); c ? _renderFiche(c) : _closeFiche(); }
    return true;
  } catch (e) { return false; }
}

// ── Mutations ───────────────────────────────────────────────────
async function _submitContact(form) {
  const fd = new FormData(form);
  const id = form.dataset.id || null;
  const socials = [...form.querySelectorAll('.nk-social-row')].map(r => ({
    type: (r.querySelector('.nk-social-type') || {}).value || 'other',
    url:  ((r.querySelector('.nk-social-url') || {}).value || '').trim(),
  })).filter(s => s.url);
  const payload = {
    name: String(fd.get('name') || '').trim(),
    kind: fd.get('kind') || 'person',
    company: String(fd.get('company') || '').trim(),
    title: String(fd.get('title') || '').trim(),
    email: String(fd.get('email') || '').trim(),
    phone: String(fd.get('phone') || '').trim(),
    phone2: String(fd.get('phone2') || '').trim(),
    website: String(fd.get('website') || '').trim(),
    address: String(fd.get('address') || '').trim(),
    vat_intra: String(fd.get('vat_intra') || '').trim().toUpperCase(),
    socials,
    photo: String(fd.get('photo') || ''),
    birthday: String(fd.get('birthday') || ''),
    birthday_remind: fd.get('birthday_remind') ? 1 : 0,
    category_id: fd.get('category_id') || null,
  };
  if (!payload.name) { _toast('Le nom est requis', 'error'); return; }
  const btn = form.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = '…'; }
  try {
    await _api(id ? '/contact/' + id : '/contact', { method: id ? 'PATCH' : 'POST', body: payload });
    await _refresh();
    _closeOverlay();
    _toast(id ? 'Contact modifié' : 'Contact ajouté');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl || 'Enregistrer'; }
    _toast(err.status === 401 ? 'Session expirée — reconnectez-vous' : 'Enregistrement impossible', 'error');
  }
}
async function _submitCategory(form) {
  const fd = new FormData(form);
  const id = form.dataset.id || null;
  const payload = { label: String(fd.get('label') || '').trim(), icon: fd.get('icon') || 'folder' };
  if (!payload.label) { _toast('Le nom est requis', 'error'); return; }
  const btn = form.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = '…'; }
  try {
    await _api(id ? '/category/' + id : '/category', { method: id ? 'PATCH' : 'POST', body: payload });
    await _refresh();
    _closeOverlay();
    _toast(id ? 'Catégorie modifiée' : 'Catégorie créée');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl || 'Créer'; }
    _toast(err.status === 401 ? 'Session expirée — reconnectez-vous' : 'Enregistrement impossible', 'error');
  }
}
async function _deleteContact(id) {
  if (!confirm('Supprimer ce contact ? Son historique sera effacé.')) return;
  try { await _api('/contact/' + id, { method: 'DELETE' }); await _refresh(); _closeOverlay(); _toast('Contact supprimé'); }
  catch (err) { _toast('Suppression impossible', 'error'); }
}
async function _deleteCategory(id) {
  if (!confirm('Supprimer cette catégorie ? Les contacts qu\'elle contient ne seront PAS supprimés (ils deviennent sans catégorie).')) return;
  try { await _api('/category/' + id, { method: 'DELETE' }); if (openCat === id) openCat = null; await _refresh(); _closeOverlay(); _toast('Catégorie supprimée'); }
  catch (err) { _toast('Suppression impossible', 'error'); }
}
async function _moveCategory(id, dir) {
  const i = _cats.findIndex(c => String(c.id) === String(id));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= _cats.length) return;
  const a = _cats[i], b = _cats[j];
  if (a._orphan || b._orphan) return;   // le panier « Sans catégorie » ne se réordonne pas
  try {
    // PATCH concurrents ; en cas d'échec, _refresh réconcilie avec la vérité serveur.
    await Promise.all([
      _api('/category/' + a.id, { method: 'PATCH', body: { position: j } }),
      _api('/category/' + b.id, { method: 'PATCH', body: { position: i } }),
    ]);
    await _refresh();
  } catch (err) { await _refresh(); _toast('Réorganisation impossible', 'error'); }
}

// ══════════════════ NK-4 — FICHE CONTACT ══════════════════
function _parseArr(v) { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (_) { return []; } }

// ── Raccourcis « Continuer avec… » (NK-6) ───────────────────────
// Définition par pad : picto, libellé, et phrase d'usage (mode suggestion si
// non possédé). Le pré-remplissage réel se fait dans _openShortcut.
const SHORTCUT_DEFS = {
  'O-SEC-001': { icon: 'sceau',       t1: 'Envoyer', t2: 'une Missive',   suggest: 'Transmettez un mot de passe ou un document qui s\'autodétruit après lecture.' },
  'A-COM-002': { icon: 'kodex',       t1: 'Générer', t2: 'un Brief',       suggest: 'Rédigez le brief print ou digital parfait, prêt pour votre imprimeur.' },
  'A-COM-005': { icon: 'ghostwriter', t1: 'Écrire',  t2: 'un message',     suggest: 'Réécrivez vos e-mails et textes en trois variantes calibrées.' },
  'O-Keyn-001':{ icon: 'keynapse',    t1: 'Noter',   t2: 'dans Keynapse',  suggest: 'Capturez idées, tâches et rappels dans une constellation de bulles.' },
  'A-COM-001': { icon: 'sdqr',        t1: 'Créer',   t2: 'un QR code',     suggest: 'Générez un QR code (vCard, lien…) tracké et souverain.' },
  'O-GEO-001': { icon: 'sentinel',    t1: 'Auditer', t2: 'un site',        suggest: 'Auditez et surveillez la présence web de ce contact.' },
  'O-BRD-001': { icon: 'keybrand',    t1: 'Ouvrir',  t2: 'une charte',     suggest: 'Composez une charte graphique vivante, partageable d\'un lien.' },
  'A-COM-004': { icon: 'pulsa',       t1: 'Créer',   t2: 'un formulaire',  suggest: 'Bâtissez un formulaire intelligent à partager en un lien.' },
  'O-SOC-001': { icon: 'user',        t1: 'Publier', t2: 'pour ce client', suggest: 'Composez et publiez sur Facebook, Instagram et LinkedIn.' },
  'O-AGT-001': { icon: 'smart-agent', t1: 'Ouvrir',  t2: 'Smart Agent',    suggest: 'Créez un assistant qui répond à ce client, par chat ou QR code.' },
};
// Raccourcis « Continuer avec… » : ensemble fixe des pads reliés à un contact.
function _shortcutsFor(c) {
  return ['O-SEC-001', 'A-COM-002', 'A-COM-005', 'O-Keyn-001', 'A-COM-001', 'O-GEO-001', 'O-BRD-001', 'A-COM-004'];
}
// Possédé ? getOwnedIds() : null = tout (MAX/ADMIN/démo), sinon liste blanche.
function _isOwned(padId) { const o = getOwnedIds(); return o === null || (Array.isArray(o) && o.includes(padId)); }

const FICHE_TABS = [['resume', 'Résumé'], ['activite', 'Activité'], ['notes', 'Notes']];

function _openFiche(contact) {
  if (!contact || !contact.id) return;
  _ficheId = contact.id; _ficheTabId = 'resume';
  const el = document.createElement('div');
  el.className = 'nk-fiche';
  _root.appendChild(el);
  _fiche = el;
  requestAnimationFrame(() => el.classList.add('nk-fiche-open'));
  _renderFiche(contact);
}
function _closeFiche() {
  if (!_fiche) return;
  const el = _fiche; _fiche = null; _ficheId = null;
  el.classList.remove('nk-fiche-open');
  setTimeout(() => { if (el.parentNode) el.remove(); }, 260);
}
function _ficheTab(id) { _ficheTabId = id; const c = _contactById(_ficheId); if (c) _renderFiche(c); }

function _actionBtn(ic, href, label) {
  return href
    ? `<a class="nk-fiche-act" href="${href}" aria-label="${label}">${icon(ic, 20)}</a>`
    : `<span class="nk-fiche-act nk-fiche-act-off" aria-label="${label} indisponible">${icon(ic, 20)}</span>`;
}
// Bouton d'action de fiche : lien si `href`, sinon état inactif grisé. `copy` =
// valeur brute copiée à l'appui long (voir _onFicheActDown). `newTab` pour le web.
function _ficheAct(ic, href, label, copy, newTab) {
  if (!href) return `<span class="nk-fiche-act nk-fiche-act-off" aria-label="${esc(label)} indisponible">${icon(ic, 20)}</span>`;
  const tgt = newTab ? ' target="_blank" rel="noopener noreferrer"' : '';
  const cp  = copy ? ` data-copy="${esc(copy)}"` : '';
  return `<a class="nk-fiche-act" href="${esc(href)}"${tgt}${cp} aria-label="${esc(label)}" title="${esc(label)} · appui long = copier">${icon(ic, 20)}</a>`;
}

// Presse-papiers (Clipboard API + repli execCommand pour les WebView anciennes).
async function _copyText(t) {
  if (!t) return;
  try { await navigator.clipboard.writeText(t); _toast('Copié'); return; } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); ta.remove(); _toast('Copié');
  } catch (_) { _toast('Copie impossible', 'error'); }
}
// Appui long (≥ 480 ms) sur une action de fiche → copie la valeur brute (data-copy)
// au lieu de suivre le lien. Le clic qui suit le relâchement est avalé dans _onClick.
// Logo/photo introuvable → on retire l'<img>, l'avatar à initiales dessous réapparaît.
function _onImgError(e) {
  const t = e.target;
  if (t && t.classList && t.classList.contains('nk-av-img')) t.remove();
}
function _onFicheActDown(e) {
  const a = e.target.closest('.nk-fiche-act[data-copy]');
  if (!a) return;
  _lpFired = false;
  clearTimeout(_lpTimer);
  _lpTimer = setTimeout(() => {
    _lpFired = true;
    _copyText(a.getAttribute('data-copy'));
    a.classList.add('nk-copied');
    setTimeout(() => a.classList.remove('nk-copied'), 900);
  }, 480);
  const cancel = () => {
    clearTimeout(_lpTimer);
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
    a.removeEventListener('pointerleave', cancel);
  };
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  a.addEventListener('pointerleave', cancel);
}
function _chip(field, val, cls) {
  return `<span class="nk-chip ${cls}">${esc(val)}<button class="nk-chip-x" data-act="nk-${field === 'roles' ? 'role' : 'tag'}-del" data-val="${esc(val)}" aria-label="Retirer">${icon('x', 12)}</button></span>`;
}
// Anniversaire : libellé « 12 mars », âge (si année plausible) et jours avant la
// prochaine occurrence (rappel annuel = mois+jour). Renvoie null si vide/invalide.
function _birthdayInfo(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const label = new Date(2000, mo - 1, da).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), mo - 1, da);
  if (next < todayMid) next = new Date(now.getFullYear() + 1, mo - 1, da);
  const days = Math.round((next - todayMid) / 86400000);
  let age = null;
  if (y >= 1900 && y <= now.getFullYear()) {
    age = now.getFullYear() - y;
    const passedThisYear = (now.getMonth() + 1 > mo) || (now.getMonth() + 1 === mo && now.getDate() >= da);
    if (!passedThisYear) age -= 1;
    if (age < 0) age = null;
  }
  return { label, age, days };
}
function _birthdaySection(c) {
  const b = _birthdayInfo(c.birthday); if (!b) return '';
  const bits = [b.label];
  if (b.age != null) bits.push(`${b.age} ans`);
  if (b.days === 0) bits.push("aujourd'hui !");
  else if (b.days === 1) bits.push('demain');
  else if (b.days <= 7) bits.push(`dans ${b.days} jours`);
  const on = c.birthday_remind ? 1 : 0;
  // Cloche = rappel Living Layer OPT-IN (à la demande), bascule en un clic.
  const bell = `<button class="nk-bday-bell${on ? ' nk-on' : ''}" data-act="nk-bday-remind" aria-pressed="${on ? 'true' : 'false'}" aria-label="${on ? 'Rappel activé — cliquer pour désactiver' : 'Activer le rappel annuel dans le Living Layer'}" title="${on ? 'Rappel annuel activé' : 'Activer le rappel annuel'}">${icon('bell', 15)}</button>`;
  return `<div class="nk-fiche-bday${b.days <= 7 ? ' nk-bday-soon' : ''}">${icon('calendar', 15)}<span>${esc(bits.join(' · '))}</span>${bell}</div>`;
}

// Bloc « Coordonnées » de la fiche : adresse + carte embarquée (Google Maps
// keyless, `output=embed` — pas de clé/géocodage) et réseaux sociaux. Tél/mail/
// site vivent désormais dans la barre d'actions du haut. Rendu si au moins un
// champ renseigné.
function _coordSection(c) {
  const socials = _parseArr(c.socials);
  const hasAddr = !!(c.address && c.address.trim());
  const hasVat = !!(c.vat_intra && c.vat_intra.trim());
  if (!hasAddr && !socials.length && !hasVat) return '';
  let inner = '';
  if (hasVat) {
    inner += `<button class="nk-coord nk-coord-copy" data-act="nk-copy" data-copy="${esc(c.vat_intra)}" title="Copier le n° de TVA">` +
      `${icon('file-text', 18)}<span class="nk-coord-tx">TVA ${esc(c.vat_intra)}</span>${icon('copy', 15)}</button>`;
  }
  if (hasAddr) {
    const embed = `https://maps.google.com/maps?q=${encodeURIComponent(c.address.trim())}&z=15&output=embed`;
    inner +=
      `<div class="nk-coord nk-coord-addr">${icon('pin', 18)}<span class="nk-coord-tx">${esc(c.address)}</span>` +
      `<a class="nk-coord-map" href="${esc(_mapUrl(c.address))}" target="_blank" rel="noopener noreferrer">${icon('compass', 14)} Ouvrir en grand</a></div>` +
      `<div class="nk-map"><iframe title="Carte — ${esc(c.address)}" src="${esc(embed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allow="fullscreen"></iframe></div>`;
  }
  if (socials.length) {
    const links = socials.map(s => { const m = _socialMeta(s.type);
      return `<a class="nk-social-link" href="${esc(_href(s.url))}" target="_blank" rel="noopener noreferrer" title="${esc(m.label)}" aria-label="${esc(m.label)}">${icon(m.icon, 18)}</a>`; }).join('');
    inner += `<div class="nk-coord-socials">${links}</div>`;
  }
  return `<div class="nk-fiche-sec"><div class="nk-fiche-lbl">Coordonnées</div><div class="nk-coord-list">${inner}</div></div>`;
}
function _actRow(a, deletable) {
  const m = _actMeta(a.type);
  return `<div class="nk-act-row"><span class="nk-act-ic">${icon(m.icon, 16)}</span>` +
    `<span class="nk-act-body"><span class="nk-act-lbl">${esc(a.label)}</span><span class="nk-act-date">${esc(_relDate(a.happened_at))}</span></span>` +
    (deletable ? `<button class="nk-act-del" data-act="nk-act-del" data-id="${esc(a.id)}" aria-label="Supprimer">${icon('x', 14)}</button>` : '') +
    `</div>`;
}
function _renderFiche(c) {
  if (!_fiche) return;
  const roles = _parseArr(c.roles), tags = _parseArr(c.tags);
  const av = `<span class="nk-fiche-av" style="background:hsl(${hue(c.name)} 42% 38% / .9)">${esc(initials(c.name))}${_avatarImg(c)}</span>`;
  const badge = roles[0] ? `<span class="nk-fiche-badge">${esc(roles[0])}</span>` : `<span class="nk-fiche-badge nk-fiche-badge-soft">${KIND_LABELS[c.kind] || 'Contact'}</span>`;
  const tabs = FICHE_TABS.map(([id, lbl]) => `<button class="nk-fiche-tab${id === _ficheTabId ? ' nk-sel' : ''}" data-act="nk-fiche-tab" data-tab="${id}">${lbl}</button>`).join('');

  const acts = _contactActivity(c.id);
  let body = '';
  if (_ficheTabId === 'resume') {
    const recent = acts.length
      ? `<div class="nk-act-list">${acts.slice(0, 5).map(a => _actRow(a, false)).join('')}</div>` +
        (acts.length > 5 ? `<button class="nk-act-more" data-act="nk-fiche-tab" data-tab="activite">Voir toute l'activité</button>` : '')
      : `<div class="nk-fiche-empty">${icon('history', 22)}<span>Aucune activité pour l'instant.</span></div>`;
    body =
      _birthdaySection(c) +
      _coordSection(c) +
      `<div class="nk-fiche-row2">
         <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Rôles</div><div class="nk-chips" data-chips="roles">${roles.map(r => _chip('roles', r, 'nk-chip-role')).join('')}<button class="nk-chip-add" data-act="nk-role-add" aria-label="Ajouter un rôle">${icon('plus', 14)}</button></div></div>
         <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Tags</div><div class="nk-chips" data-chips="tags">${tags.map(t => _chip('tags', t, 'nk-chip-tag')).join('')}<button class="nk-chip-add" data-act="nk-tag-add" aria-label="Ajouter un tag">${icon('plus', 14)}</button></div></div>
       </div>
       <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Continuer avec…</div><div class="nk-shortcuts">${_shortcutsFor(c).map(id => {
         const d = SHORTCUT_DEFS[id]; if (!d) return '';
         return _isOwned(id)
           ? `<button class="nk-shortcut" data-act="nk-shortcut" data-pad="${id}">${icon(d.icon, 20)}<span><b>${d.t1}</b>${d.t2}</span></button>`
           : `<button class="nk-shortcut nk-shortcut-sug" data-act="nk-discover" data-pad="${id}">${icon(d.icon, 20)}<span><b>${esc(d.t1 + ' ' + d.t2)}</b><i>${esc(d.suggest)}</i></span><span class="nk-sc-tag">Découvrir</span></button>`;
       }).join('')}</div></div>`;
  } else if (_ficheTabId === 'notes') {
    body = `<textarea class="nk-fiche-note" placeholder="Vos notes sur ${esc(c.name)}…" maxlength="8000">${esc(c.notes || '')}</textarea>`;
  } else {
    body =
      `<button class="nk-btn nk-btn-primary nk-act-addbtn" data-act="nk-act-add">${icon('plus', 16)} Ajouter une activité</button>
       <div class="nk-act-list">${acts.length
        ? acts.map(a => _actRow(a, true)).join('')
        : `<div class="nk-fiche-empty nk-fiche-empty-lg">${icon('history', 30)}<span>Aucune activité. Notez appels, e-mails, RDV, devis… pour raconter la relation.</span></div>`}</div>`;
  }

  const tel  = c.phone  ? 'tel:' + encodeURIComponent(c.phone)  : '';
  const tel2 = c.phone2 ? 'tel:' + encodeURIComponent(c.phone2) : '';
  const mail = c.email  ? 'mailto:' + encodeURIComponent(c.email) : '';
  const smsNum = c.phone2 || c.phone;                 // SMS de préférence sur le mobile
  const sms  = smsNum ? 'sms:' + encodeURIComponent(smsNum) : '';
  const site = c.website ? _href(c.website) : '';

  _fiche.innerHTML =
    `<div class="nk-fiche-nav">
       <button class="nk-fiche-navbtn" data-act="nk-fiche-close" aria-label="Retour">${icon('chevron-left', 26)}</button>
       <button class="nk-fiche-navbtn" data-act="nk-fiche-edit" aria-label="Modifier">${icon('more-horizontal', 22)}</button>
     </div>
     <div class="nk-fiche-hd">
       <button class="nk-fiche-x" data-act="nk-fiche-close" aria-label="Fermer">${icon('x', 18)}</button>
       <div class="nk-fiche-top">${av}<div class="nk-fiche-idz"><h2 class="nk-fiche-name">${esc(c.name)}</h2>${badge}${c.company ? `<div class="nk-fiche-org">${esc(c.company)}</div>` : ''}${c.title ? `<div class="nk-fiche-fn">${esc(c.title)}</div>` : ''}</div></div>
       <div class="nk-fiche-acts">
         ${_ficheAct('phone', tel, 'Appeler (fixe)', c.phone)}
         ${_ficheAct('smartphone', tel2, 'Appeler (mobile)', c.phone2)}
         ${_ficheAct('mail', mail, 'E-mail', c.email)}
         ${_ficheAct('message', sms, 'Message', smsNum)}
         ${_ficheAct('globe', site, 'Site web', c.website, true)}
         <button class="nk-fiche-act nk-fiche-act-edit" data-act="nk-fiche-edit" aria-label="Modifier">${icon('settings', 20)}</button>
       </div>
       <div class="nk-fiche-tabs">${tabs}</div>
     </div>
     <div class="nk-fiche-body">${body}</div>`;
}

async function _patchField(id, field, value) {
  try {
    await _api('/contact/' + id, { method: 'PATCH', body: { [field]: value } });
    await _refresh();
  } catch (e) { _toast('Enregistrement impossible', 'error'); }
}
// Ajout d'un rôle/tag via un champ inline (charte : pas de prompt() natif).
function _addChip(field) {
  const wrap = _fiche && _fiche.querySelector(`[data-chips="${field}"]`);
  if (!wrap || wrap.querySelector('.nk-chip-input')) return;
  const addBtn = wrap.querySelector('.nk-chip-add');
  const inp = document.createElement('input');
  inp.className = 'nk-chip-input';
  inp.maxLength = 40;
  inp.placeholder = field === 'roles' ? 'Rôle…' : 'Tag…';
  wrap.insertBefore(inp, addBtn);
  inp.focus();
  let done = false;
  const commit = (save) => {
    if (done) return; done = true;
    const v = inp.value.trim().slice(0, 40);
    inp.remove();
    if (!save || !v) return;
    const c = _contactById(_ficheId); if (!c) return;
    const arr = _parseArr(c[field]);
    if (arr.includes(v)) return;
    arr.push(v); _patchField(c.id, field, arr);
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();   // ne pas laisser Échap fermer la fiche
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  inp.addEventListener('blur', () => { setTimeout(() => commit(true), 120); });
}
function _delChip(field, val) {
  const c = _contactById(_ficheId); if (!c) return;
  _patchField(c.id, field, _parseArr(c[field]).filter(x => x !== val));
}
async function _saveNote(id, text) {
  try {
    await _api('/contact/' + id, { method: 'PATCH', body: { notes: text } });
    const c = _contactById(id); if (c) c.notes = text;
    const cache = _readCache();
    if (cache) { const cc = (cache.contacts || []).find(x => String(x.id) === String(id)); if (cc) { cc.notes = text; _writeCache(cache); } }
  } catch (e) { /* silencieux : réessaie au prochain frappe */ }
}
async function _openShortcut(padId) {
  const c = _contactById(_ficheId);
  // Contrat inter-pads : le contact voyage dans opts.nkContact. Chaque pad
  // cible lit ce qui l'intéresse et ignore le reste (aujourd'hui : Social).
  const nkContact = c ? {
    id: c.id, name: c.name, company: c.company, title: c.title,
    email: c.email, phone: c.phone, phone2: c.phone2, website: c.website,
    address: c.address, socials: _parseArr(c.socials), roles: _parseArr(c.roles),
  } : null;
  const opts = { nkContact };
  // Pré-remplissage réel via la voie EXISTANTE et éprouvée du composer Social
  // (même relais que Ghost Writer → Social). Zéro modif du pad cible.
  if (padId === 'O-SOC-001' && c) {
    const who = c.company ? `${c.name} (${c.company})` : c.name;
    opts.compose = { text: `Pour ${who} :\n\n` };
  }
  // Fermer le workspace networK AVANT d'ouvrir la cible (piège z-index/overlay).
  closeNetwork();
  try { const m = await import('./ui-renderer.js'); m.openTool(padId, opts); } catch (_) {}
}
// Mode suggestion (pad non possédé) : ouvrir sa fiche dans le K-Store.
async function _discover(padId) {
  closeNetwork();
  try { const m = await import('./ui-renderer.js'); m.openKStoreAppDetail(padId); } catch (_) {}
}

// ── Ajout / suppression d'activité (NK-5) ───────────────────────
function _openActivityForm() {
  if (!_ficheId) return;
  const d = new Date();
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const types = ACTIVITY_TYPES.map((t, i) =>
    `<button type="button" class="nk-acttype${i === 0 ? ' nk-sel' : ''}" data-act="nk-act-type" data-type="${t.key}">${icon(t.icon, 18)}<span>${t.label}</span></button>`).join('');
  _openOverlay(
    `<div class="nk-sheet-hd">Ajouter une activité<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <form class="nk-form" data-form="activity">
       <div class="nk-field"><span>Type</span><input type="hidden" name="type" value="call"><div class="nk-acttypes">${types}</div></div>
       <label class="nk-field"><span>Libellé</span><input name="label" required maxlength="200" placeholder="Ex. Appel de suivi, devis envoyé…" autocomplete="off"></label>
       <label class="nk-field"><span>Date</span><input name="happened_at" type="date" value="${iso}"></label>
       <div class="nk-form-actions"><span></span><button type="submit" class="nk-btn nk-btn-primary">Ajouter</button></div>
     </form>`,
    ov => { const i = ov.querySelector('input[name="label"]'); if (i) i.focus(); }
  );
}
async function _submitActivity(form) {
  const fd = new FormData(form);
  const payload = {
    contact_id: _ficheId,
    type: fd.get('type') || 'other',
    label: String(fd.get('label') || '').trim(),
    happened_at: fd.get('happened_at') || undefined,
  };
  if (!payload.label) { _toast('Le libellé est requis', 'error'); return; }
  const btn = form.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.dataset.lbl = btn.textContent; btn.textContent = '…'; }
  try {
    await _api('/activity', { method: 'POST', body: payload });
    await _refresh();
    _closeOverlay();
    _toast('Activité ajoutée');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.lbl || 'Ajouter'; }
    _toast(err.status === 401 ? 'Session expirée — reconnectez-vous' : 'Enregistrement impossible', 'error');
  }
}
async function _deleteActivity(id) {
  if (!confirm('Supprimer cette entrée du journal ?')) return;
  try { await _api('/activity/' + id, { method: 'DELETE' }); await _refresh(); _toast('Activité supprimée'); }
  catch (err) { _toast('Suppression impossible', 'error'); }
}

// ══════════════════ IMPORT / EXPORT ══════════════════
// Export = fichiers standards lisibles par les outils tiers : CSV (tableur,
// triable) + vCard 3.0 (carnet d'adresses iPhone/Google/Outlook). Import = CSV
// à en-têtes tolérants (alias FR/EN). 100 % client (Blob), zéro serveur tiers.

function _openIOMenu() {
  _openOverlay(
    `<div class="nk-sheet-hd">Importer / Exporter<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <div class="nk-menu">
       <button class="nk-menu-item" data-act="nk-export-csv"><span class="nk-menu-ic">${icon('download', 20)}</span><span class="nk-menu-lbl">Exporter en CSV<small>Tableur — Excel, Sheets, Numbers</small></span>${icon('chevron-right', 16)}</button>
       <button class="nk-menu-item" data-act="nk-export-vcf"><span class="nk-menu-ic">${icon('users', 20)}</span><span class="nk-menu-lbl">Exporter en vCard<small>Carnet d'adresses — iPhone, Google, Outlook</small></span>${icon('chevron-right', 16)}</button>
       <button class="nk-menu-item" data-act="nk-import-csv"><span class="nk-menu-ic">${icon('upload-cloud', 20)}</span><span class="nk-menu-lbl">Importer un CSV<small>Ajoutez une liste de contacts</small></span>${icon('chevron-right', 16)}</button>
     </div>`
  );
}

function _download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function _catLabelMap() { const m = {}; _cats.forEach(c => { m[String(c.id)] = c.label; }); return m; }

// ── Export CSV ──
function _csvCell(v) { v = (v == null ? '' : String(v)); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function _exportCSV() {
  const labels = _catLabelMap();
  const cols = ['name', 'kind', 'company', 'title', 'email', 'phone', 'phone2', 'website', 'address', 'vat_intra', 'birthday', 'reminder', 'socials', 'roles', 'tags', 'category', 'notes'];
  const lines = [cols.join(',')];
  for (const c of _allContacts()) {
    const socials = _parseArr(c.socials).map(s => `${s.type}:${s.url}`).join(' | ');
    const row = [c.name, c.kind, c.company, c.title, c.email, c.phone, c.phone2, c.website, c.address, c.vat_intra || '', c.birthday || '', c.birthday_remind ? '1' : '0',
      socials, _parseArr(c.roles).join(' | '), _parseArr(c.tags).join(' | '), labels[String(c.category_id)] || '', c.notes];
    lines.push(row.map(_csvCell).join(','));
  }
  _download('networK-contacts.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  _closeOverlay(); _toast('Export CSV téléchargé');
}

// ── Export vCard 3.0 ──
function _vc(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function _vcardOf(c) {
  const L = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:' + _vc(c.name), 'N:' + _vc(c.name) + ';;;;'];
  if (c.company) L.push('ORG:' + _vc(c.company));
  if (c.title)   L.push('TITLE:' + _vc(c.title));
  if (c.email)   L.push('EMAIL;TYPE=INTERNET:' + _vc(c.email));
  if (c.phone)   L.push('TEL;TYPE=VOICE:' + _vc(c.phone));
  if (c.phone2)  L.push('TEL;TYPE=CELL:' + _vc(c.phone2));
  if (c.website) L.push('URL:' + _vc(_href(c.website)));
  if (c.address) L.push('ADR;TYPE=WORK:;;' + _vc(c.address) + ';;;;');
  if (/^\d{4}-\d{2}-\d{2}$/.test(c.birthday || '')) L.push('BDAY:' + c.birthday);
  if (c.vat_intra) L.push('X-VAT:' + _vc(c.vat_intra));
  _parseArr(c.socials).forEach(s => { if (s.url) L.push('URL:' + _vc(_href(s.url))); });
  const cats = _parseArr(c.roles).concat(_parseArr(c.tags));
  if (cats.length) L.push('CATEGORIES:' + cats.map(_vc).join(','));
  if (c.notes)   L.push('NOTE:' + _vc(c.notes));
  if (c.photo) { const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(c.photo);
    if (m) L.push('PHOTO;ENCODING=b;TYPE=' + m[1].toUpperCase().replace('JPG', 'JPEG') + ':' + m[2]); }
  L.push('END:VCARD');
  return L.join('\r\n');
}
function _exportVCF() {
  const all = _allContacts();
  if (!all.length) { _toast('Aucun contact à exporter', 'error'); return; }
  _download('networK-contacts.vcf', all.map(_vcardOf).join('\r\n') + '\r\n', 'text/vcard;charset=utf-8');
  _closeOverlay(); _toast('Export vCard téléchargé');
}

// ── Import CSV ──
const IMPORT_ALIASES = {
  name:    ['name', 'nom', 'fullname', 'full name', 'display name', 'nom complet', 'contact'],
  first:   ['first name', 'prénom', 'prenom', 'firstname', 'given name'],
  last:    ['last name', 'nom de famille', 'lastname', 'surname', 'family name'],
  company: ['company', 'société', 'societe', 'organization', 'organisation', 'org', 'entreprise', 'company name'],
  title:   ['title', 'job title', 'fonction', 'poste', 'intitulé', 'intitule'],
  email:   ['email', 'e-mail', 'email address', 'e-mail address', 'courriel', 'mail', 'adresse e-mail', 'adresse email'],
  phone:   ['phone', 'phone number', 'téléphone', 'telephone', 'tel', 'fixe', 'landline', 'primary phone', 'business phone', 'téléphone fixe'],
  phone2:  ['phone2', 'mobile', 'mobile phone', 'portable', 'cell', 'cellphone', 'secondary phone', 'téléphone mobile', 'téléphone 2', 'gsm'],
  website: ['website', 'web', 'web page', 'site', 'site web', 'url', 'site internet'],
  address: ['address', 'adresse', 'street address', 'adresse postale', 'location', 'lieu'],
  vat_intra:['vat_intra', 'vat', 'tva', 'tva intracommunautaire', 'vat number', 'n° tva', 'numéro de tva', 'numero de tva', 'vat id'],
  birthday:['birthday', 'anniversaire', 'date de naissance', 'naissance', 'bday', 'birth date', 'birthdate', 'né(e) le', 'ne le'],
  reminder:['reminder', 'rappel', 'birthday_remind', 'rappel anniversaire'],
  category:['category', 'catégorie', 'categorie', 'group', 'groupe', 'liste', 'list'],
  roles:   ['roles', 'rôles', 'role', 'rôle'],
  tags:    ['tags', 'tag', 'étiquettes', 'etiquettes', 'labels'],
  socials: ['socials', 'réseaux sociaux', 'reseaux sociaux', 'social'],
  notes:   ['notes', 'note', 'remarques', 'commentaire', 'comments'],
};
function _splitMulti(v) { return String(v || '').split(/[|;]/).map(x => x.trim()).filter(Boolean); }
// Normalise une date d'import vers 'YYYY-MM-DD' (accepte JJ/MM/AAAA, AAAA/MM/JJ). Sinon ''.
function _normDate(s) {
  s = String(s || '').trim(); if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}
function _socialsCell(v) {
  return _splitMulti(v).map(tok => { const i = tok.indexOf(':'); if (i < 0) return null;
    return { type: tok.slice(0, i).trim() || 'other', url: tok.slice(i + 1).trim() }; }).filter(s => s && s.url);
}
// Parseur CSV robuste : guillemets, "" échappé, CRLF, délimiteur , ou ; (auto).
function _parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const nl = text.indexOf('\n'); const head = nl < 0 ? text : text.slice(0, nl);
  const delim = (head.split(';').length > head.split(',').length) ? ';' : ',';
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') { inQ = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
function _openImportPicker() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,text/csv,text/plain';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; if (!f) return;
    try { const text = await f.text(); await _importCSV(text); }
    catch (_) { _toast('Lecture du fichier impossible', 'error'); }
  });
  input.click();
}
async function _importCSV(text) {
  const rows = _parseCSV(text);
  if (rows.length < 2) { _toast('CSV vide ou illisible', 'error'); return; }
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const colField = {};
  headers.forEach((h, idx) => { for (const f in IMPORT_ALIASES) { if (IMPORT_ALIASES[f].includes(h)) { colField[idx] = f; break; } } });
  const get = (arr, f) => { for (const idx in colField) if (colField[idx] === f) return (arr[idx] || '').trim(); return ''; };

  const contacts = [], labels = new Set();
  for (const r of rows.slice(1, 501)) {
    let name = get(r, 'name');
    if (!name) name = (get(r, 'first') + ' ' + get(r, 'last')).trim();
    if (!name) continue;
    const cat = get(r, 'category'); if (cat) labels.add(cat);
    contacts.push({ name, cat,
      company: get(r, 'company'), title: get(r, 'title'), email: get(r, 'email'),
      phone: get(r, 'phone'), phone2: get(r, 'phone2'), website: get(r, 'website'), address: get(r, 'address'),
      vat_intra: get(r, 'vat_intra'),
      birthday: _normDate(get(r, 'birthday')),
      birthday_remind: /^(1|oui|yes|true|x|vrai)$/i.test(get(r, 'reminder')) ? 1 : 0,
      roles: _splitMulti(get(r, 'roles')), tags: _splitMulti(get(r, 'tags')),
      socials: _socialsCell(get(r, 'socials')), notes: get(r, 'notes') });
  }
  if (!contacts.length) { _toast('Aucun contact valide (colonne « nom » requise)', 'error'); return; }
  if (!confirm(`Importer ${contacts.length} contact(s) depuis ce fichier ?`)) return;
  _closeOverlay();
  _toast(`Import de ${contacts.length} contact(s)…`);

  // Catégories référencées : réutilise l'existant (par libellé), crée le manquant.
  const map = {};
  _cats.forEach(c => { if (!c._orphan && !String(c.id).startsWith('def-')) map[c.label.toLowerCase()] = c.id; });
  for (const lbl of labels) {
    if (map[lbl.toLowerCase()]) continue;
    try { const r = await _api('/category', { method: 'POST', body: { label: lbl, icon: 'folder' } }); if (r && r.category) map[lbl.toLowerCase()] = r.category.id; } catch (_) {}
  }

  let ok = 0;
  for (const c of contacts) {
    try {
      await _api('/contact', { method: 'POST', body: {
        name: c.name, kind: 'person', company: c.company, title: c.title, email: c.email,
        phone: c.phone, phone2: c.phone2, website: c.website, address: c.address, vat_intra: c.vat_intra, birthday: c.birthday, birthday_remind: c.birthday_remind,
        roles: c.roles, tags: c.tags, socials: c.socials,
        category_id: c.cat ? (map[c.cat.toLowerCase()] || null) : null,
      } });
      ok++;
    } catch (_) {}
  }
  await _refresh(true);
  _toast(`${ok}/${contacts.length} contact(s) importé(s)`, ok ? 'ok' : 'error');
}

// ── Événements ──────────────────────────────────────────────────
function _onClick(e) {
  // Appui long qui vient de copier → avaler le clic (pas de navigation du lien).
  if (_lpFired) {
    _lpFired = false;
    if (e.target.closest('.nk-fiche-act[data-copy]')) { e.preventDefault(); e.stopPropagation(); return; }
  }
  // Sélecteur d'icône (formulaire catégorie) — géré avant tout
  const iconOpt = e.target.closest('.nk-icon-opt');
  if (iconOpt && _overlay) {
    _overlay.querySelectorAll('.nk-icon-opt').forEach(o => o.classList.remove('nk-sel'));
    iconOpt.classList.add('nk-sel');
    const hid = _overlay.querySelector('input[name="icon"]');
    if (hid) hid.value = iconOpt.dataset.icon;
    return;
  }
  // Sélecteur d'easing (panneau réglages animation)
  const easeBtn = e.target.closest('[data-ease]');
  if (easeBtn && _animPanel) {
    P.ease = easeBtn.dataset.ease;
    _animPanel.querySelectorAll('[data-ease]').forEach(b => b.classList.toggle('nk-sel', b === easeBtn));
    _saveAnim();
    return;
  }
  // Sélecteur de type d'activité (formulaire activité)
  const actType = e.target.closest('.nk-acttype');
  if (actType && _overlay) {
    _overlay.querySelectorAll('.nk-acttype').forEach(o => o.classList.remove('nk-sel'));
    actType.classList.add('nk-sel');
    const hid = _overlay.querySelector('input[name="type"]');
    if (hid) hid.value = actType.dataset.type;
    return;
  }

  const actEl = e.target.closest('[data-act]');
  const act = actEl && actEl.dataset.act;

  // Boutons internes aux pills catégories (avant le toggle)
  if (act === 'nk-cat-add')  { e.stopPropagation(); return _openContactForm({ category_id: actEl.dataset.cat }); }
  if (act === 'nk-cat-menu') { e.stopPropagation(); return _openCatMenu(actEl.dataset.cat, actEl); }

  const person = e.target.closest('.nk-person');
  if (person && !actEl) return _openFiche(_contactById(person.dataset.id));

  const searchItem = e.target.closest('.nk-search-item');
  if (searchItem) { const c = _contactById(searchItem.dataset.id); _clearSearch(); return _openFiche(c); }

  const catEl = e.target.closest('.nk-cat');
  if (catEl && !actEl) return toggle(catEl.dataset.cat);   // desktop ET mobile : inline + auto-pan mobile

  if (!act) return;
  switch (act) {
    case 'close':          return closeNetwork();
    case 'nk-add':         return _openAddMenu();
    case 'nk-io':          return _openIOMenu();
    case 'nk-export-csv':  return _exportCSV();
    case 'nk-export-vcf':  return _exportVCF();
    case 'nk-import-csv':  return _openImportPicker();
    case 'nk-ov-close':    return _closeOverlay();
    case 'nk-new-person':  _closeOverlay(); return _openContactForm({ kind: 'person' });
    case 'nk-new-company': _closeOverlay(); return _openContactForm({ kind: 'company' });
    case 'nk-new-place':   _closeOverlay(); return _openContactForm({ kind: 'place' });
    case 'nk-new-group':   _closeOverlay(); return _openContactForm({ kind: 'group' });
    case 'nk-new-cat':     _closeOverlay(); return _openCategoryForm(null);
    case 'nk-social-add':  { const w = _overlay && _overlay.querySelector('[data-socials]'); if (w) { w.insertAdjacentHTML('beforeend', _socialRowHTML()); w.lastElementChild.querySelector('.nk-social-url')?.focus(); } return; }
    case 'nk-social-del':  { const row = actEl.closest('.nk-social-row'); if (row) row.remove(); return; }
    case 'nk-photo-pick':  return _pickPhoto();
    case 'nk-photo-clear': return _setFormPhoto('');
    case 'nk-contact-del': return _deleteContact(actEl.dataset.id);
    case 'nk-cat-edit':    { _closePopover(); const c = _cats.find(x => String(x.id) === String(actEl.dataset.cat)); return _openCategoryForm(c); }
    case 'nk-cat-del':     { _closePopover(); return _deleteCategory(actEl.dataset.cat || actEl.dataset.id); }
    case 'nk-cat-up':      { _closePopover(); return _moveCategory(actEl.dataset.cat, -1); }
    case 'nk-cat-down':    { _closePopover(); return _moveCategory(actEl.dataset.cat, +1); }
    case 'nk-fiche-close': return _closeFiche();
    case 'nk-fiche-edit':  { const c = _contactById(_ficheId); if (c) _openContactForm(c); return; }
    case 'nk-fiche-tab':   return _ficheTab(actEl.dataset.tab);
    case 'nk-bday-remind': { const c = _contactById(_ficheId); if (!c) return; const nv = c.birthday_remind ? 0 : 1; _patchField(c.id, 'birthday_remind', nv); _toast(nv ? 'Rappel activé' : 'Rappel désactivé'); return; }
    case 'nk-copy':        return _copyText(actEl.dataset.copy);
    case 'nk-role-add':    return _addChip('roles');
    case 'nk-role-del':    return _delChip('roles', actEl.dataset.val);
    case 'nk-tag-add':     return _addChip('tags');
    case 'nk-tag-del':     return _delChip('tags', actEl.dataset.val);
    case 'nk-act-add':     return _openActivityForm();
    case 'nk-act-del':     return _deleteActivity(actEl.dataset.id);
    case 'nk-expand':      return _expandCategory(actEl.dataset.cat || openCat);
    case 'nk-shortcut':    return _openShortcut(actEl.dataset.pad);
    case 'nk-discover':    return _discover(actEl.dataset.pad);
    case 'nk-zoom-in':     return _setZoom(_zoom * 1.15);
    case 'nk-zoom-out':    return _setZoom(_zoom * 0.87);
    case 'nk-zoom-reset':  return _setZoom(1);
    case 'nk-fit':         _panX = _panY = 0; return _setZoom(1);
    case 'nk-anim-open':   return _openAnimSettings();
    case 'nk-anim-close':  return _closeAnimSettings();
    case 'nk-anim-replay': return render(true);
    case 'nk-anim-reset':  return _resetAnim();
  }
}

function _onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'contact') _submitContact(form);
  else if (form.dataset.form === 'category') _submitCategory(form);
  else if (form.dataset.form === 'activity') _submitActivity(form);
}

let _searchTimer = null;
function _onInput(e) {
  const cls = e.target.classList;
  if (cls && cls.contains('nk-search-input')) {
    const v = e.target.value.trim();
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => _renderSearch(v), 120);
    return;
  }
  if (cls && cls.contains('nk-fiche-note')) {   // autosave des notes (debounce, sans re-render)
    const id = _ficheId, val = e.target.value;
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(() => _saveNote(id, val), 700);
    return;
  }
  if (e.target.dataset && e.target.dataset.anim) {   // curseur réglages animation (live)
    const key = e.target.dataset.anim, v = +e.target.value;
    P[key] = v;
    const out = e.target.closest('.nk-anim-ctrl')?.querySelector('output');
    if (out) out.textContent = v + (e.target.dataset.unit || '');
    if (key === 'fl') _applyFlowOpacity();
    _saveAnim();
  }
}

function _onKey(e) {
  if (e.key !== 'Escape') return;
  if (_animPanel) return _closeAnimSettings();
  if (_popover) return _closePopover();
  if (_overlay)  return _closeOverlay();
  if (_fiche)    return _closeFiche();
  const dd = _root && _root.querySelector('.nk-search-results');
  if (dd) return _clearSearch();
  if (openCat) return toggle(openCat);
  closeNetwork();
}

let _rz = null;
function _onResize() { clearTimeout(_rz); _rz = setTimeout(() => render(false), 150); }
