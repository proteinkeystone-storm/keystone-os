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

const WORKSPACE_META = { id: 'O-NET-001', name: 'networK' };
const SVGNS = 'http://www.w3.org/2000/svg';

// Paramètres d'animation FIGÉS (réglés au harnais, validés Stéphane).
const P = { dur: 550, stag: 45, ov: 25, cur: 45, pd: 65, ease: 'expo', pillDur: 360, fl: 30 };
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
  const res = await fetch(API_BASE + '/api/network' + path, {
    method: opts.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + _jwt(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { const e = new Error(data.error || ('Erreur ' + res.status)); e.status = res.status; throw e; }
  return data;
}
function _readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } }
function _writeCache(d) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ categories: d.categories, contacts: d.contacts })); } catch (_) {} }

// Groupe les contacts par catégorie → structure de rendu de l'arbre.
function _buildCats(categories, contacts) {
  const byCat = {};
  (contacts || []).forEach(ct => { const k = ct.category_id || '_none'; (byCat[k] = byCat[k] || []).push(ct); });
  return (categories || []).map(c => {
    const all = byCat[c.id] || [];
    return { id: c.id, label: c.label, icon: c.icon, count: all.length,
             contacts: all.slice(0, PER_PAGE), extra: Math.max(0, all.length - PER_PAGE), _all: all };
  });
}
function _defaultCats() {
  return _DEFAULTS.map((d, i) => ({ id: 'def-' + i, label: d.label, icon: d.icon, count: 0, contacts: [], extra: 0, _all: [] }));
}

// Cache d'abord (rendu instantané), puis rafraîchit depuis l'API.
async function _boot() {
  const cached = _readCache();
  if (cached) { _cats = _buildCats(cached.categories, cached.contacts); render(true); }
  try {
    const data = await _api('/bootstrap');
    _writeCache(data);
    _cats = _buildCats(data.categories, data.contacts);
    render(!cached);   // n'anime que si rien n'a encore été peint depuis le cache
  } catch (e) {
    if (!cached && _root) { _cats = _defaultCats(); render(true); }   // hors-ligne / pré-deploy : squelette
  }
}

// ── État module ─────────────────────────────────────────────────
let _root = null, _stage = null, _wires = null, _nodes = null, _scene = null;
let _cats = [];                 // catégories courantes (mock en NK-1)
let openCat = null;             // id de la catégorie dépliée (une seule profondeur)
let seq = 0;                    // invalide les séquences en cours (anti double-clic)
const jobs = new Set();
let rafId = null;
const timeouts = [];
// Zoom / pan (transform sur .nk-scene)
let _zoom = 1, _panX = 0, _panY = 0;
let _drag = null;
let _overlay = null, _popover = null;   // modale de formulaire / menu contextuel
let _fiche = null, _ficheId = null, _ficheTabId = 'resume';   // fiche contact (NK-4)
let _catList = null, _catListId = null;                        // liste catégorie plein écran (mobile)
let _noteTimer = null;

function later(fn, ms) { const t = setTimeout(fn, ms); timeouts.push(t); return t; }
function clearTimers() { timeouts.forEach(clearTimeout); timeouts.length = 0; }

// ── Ouverture / fermeture ───────────────────────────────────────
export function openNetwork(opts = {}) {
  if (_root) return;
  _cats = [];
  _buildShell();
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', _onKey);
  window.addEventListener('resize', _onResize);
  _boot();   // cache → rendu instantané, puis API (« waou » au 1er paint réel)
}
export function closeNetwork() {
  if (!_root) return;
  clearTimers(); jobs.clear(); rafId = null;
  _closePopover(); clearTimeout(_noteTimer);
  document.removeEventListener('keydown', _onKey);
  window.removeEventListener('resize', _onResize);
  _root.remove();
  _root = _stage = _wires = _nodes = _scene = null;
  _overlay = _popover = _fiche = _catList = null;
  _ficheId = _catListId = null; _ficheTabId = 'resume';
  openCat = null; _zoom = 1; _panX = _panY = 0;
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
    // Mobile : « Vous » à gauche + pills catégories empilées, PAS de colonne
    // contact (elle ouvre une liste plein écran). catX serré pour tenir l'écran.
    return { you: { x: 44, y: h * .5 }, catX: 110, perX: 0, catGap: 66, perGap: 0, h, mobile };
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
      `<span class="nk-cat-menu" data-act="nk-cat-menu" data-cat="${esc(c.id)}" aria-label="Gérer la catégorie">${icon('more-horizontal', 16)}</span>` +
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
}

// Déplie les contacts d'une catégorie (cascade haut → bas).
function spawnContacts(c, L, animated) {
  const my = seq;
  _stage.classList.add('nk-focus');
  const circuitDone = (animated && !REDUCED) ? (c.contacts.length - 1) * P.stag + P.dur * .85 + 250 : 0;
  addFlow(c._path, 0, circuitDone);

  const list = c.contacts;
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
      `<span class="nk-av" style="background:hsl(${h} 42% 38% / .85)">${esc(initials(ct.name))}</span>` +
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

  if (c.extra) {
    const y = Math.max(70, yTop + list.length * L.perGap) - 8;
    const more = document.createElement('button');
    more.className = 'nk-node nk-more nk-enter';
    more.style.left = L.perX + 'px'; more.style.top = y + 'px';
    more.dataset.contact = c.id;
    more.innerHTML = `${icon('chevron-down', 14)} Voir les ${c.extra} autres`;
    _nodes.appendChild(more);
    reveal(more, animated && !REDUCED ? list.length * P.stag + P.dur * .6 : 0);
  }
}

// Ouvre/ferme une catégorie — une seule profondeur visible.
function toggle(id) {
  seq++; const my = seq;
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
  } else {
    later(() => { if (my === seq) purge(); }, 220);
  }
}

// ── Zoom / Pan (transform sur .nk-scene) ────────────────────────
function _applyTransform() {
  _scene.style.transform = `translate(${_panX}px, ${_panY}px) scale(${_zoom})`;
  const pct = _root.querySelector('.nk-tool-pct');
  if (pct) pct.textContent = Math.round(_zoom * 100) + ' %';
}
function _setZoom(z) { _zoom = Math.max(0.5, Math.min(1.5, z)); _applyTransform(); }
function _onWheel(e) {
  if (!e.ctrlKey && Math.abs(e.deltaY) < 2) return;
  e.preventDefault();
  _setZoom(_zoom * (e.deltaY < 0 ? 1.08 : 0.92));
}
function _onPanStart(e) {
  if (e.target.closest('.nk-node, .nk-toolbar, .nk-chrome')) return;   // pan = fond seulement
  _drag = { x: e.clientX, y: e.clientY, px: _panX, py: _panY };
  _scene.style.cursor = 'grabbing';
  window.addEventListener('pointermove', _onPanMove);
  window.addEventListener('pointerup', _onPanEnd, { once: true });
}
function _onPanMove(e) {
  if (!_drag) return;
  _panX = _drag.px + (e.clientX - _drag.x);
  _panY = _drag.py + (e.clientY - _drag.y);
  _applyTransform();
}
function _onPanEnd() { _drag = null; if (_scene) _scene.style.cursor = ''; window.removeEventListener('pointermove', _onPanMove); }

// ══════════════════ NK-3 — CRUD MANUEL ══════════════════
const KIND_LABELS  = { person: 'Personne', company: 'Entreprise', place: 'Établissement', group: 'Groupe' };
const KIND_DEFAULT_ICON = { person: 'user', company: 'building', place: 'landmark', group: 'users' };
const NK_CAT_ICONS = ['users', 'briefcase', 'handshake', 'newspaper', 'landmark', 'tag', 'building', 'folder', 'network', 'user'];

function _allContacts() { return _cats.flatMap(c => c._all || []); }
function _contactById(id) { return _allContacts().find(c => String(c.id) === String(id)) || null; }
function _realCats() { return _cats.filter(c => !String(c.id).startsWith('def-')); }   // exclut le squelette hors-ligne
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

// ── Formulaire contact (création / édition) ──
// seed = contact existant (édition si seed.id) OU { kind, category_id } (création)
function _openContactForm(seed = {}) {
  const isEdit = !!(seed && seed.id);
  const kind = seed.kind || 'person';
  const catOpts = _realCats().map(c =>
    `<option value="${esc(c.id)}"${String(seed.category_id) === String(c.id) ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  const kindOpts = Object.entries(KIND_LABELS).map(([k, l]) =>
    `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('');
  _openOverlay(
    `<div class="nk-sheet-hd">${isEdit ? 'Modifier le contact' : 'Nouveau contact'}<button class="nk-sheet-x" data-act="nk-ov-close" aria-label="Fermer">${icon('x', 18)}</button></div>
     <form class="nk-form" data-form="contact"${isEdit ? ` data-id="${esc(seed.id)}"` : ''}>
       <label class="nk-field"><span>Nom</span><input name="name" required maxlength="200" value="${esc(seed.name || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Type</span><select name="kind">${kindOpts}</select></label>
       <label class="nk-field"><span>Entreprise</span><input name="company" maxlength="200" value="${esc(seed.company || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Fonction</span><input name="title" maxlength="200" value="${esc(seed.title || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>E-mail</span><input name="email" type="email" maxlength="200" value="${esc(seed.email || '')}" autocomplete="off"></label>
       <label class="nk-field"><span>Téléphone</span><input name="phone" type="tel" maxlength="200" value="${esc(seed.phone || '')}" autocomplete="off"></label>
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
  _openPopover(
    `<button class="nk-pop-item" data-act="nk-cat-edit" data-cat="${esc(catId)}">${icon('settings', 16)} Renommer / icône</button>
     <button class="nk-pop-item" data-act="nk-cat-up"   data-cat="${esc(catId)}"${i === 0 ? ' disabled' : ''}>${icon('chevron-up', 16)} Monter</button>
     <button class="nk-pop-item" data-act="nk-cat-down" data-cat="${esc(catId)}"${i === _cats.length - 1 ? ' disabled' : ''}>${icon('chevron-down', 16)} Descendre</button>
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
    ? hits.map(c => `<button class="nk-search-item" data-id="${esc(c.id)}"><span class="nk-av nk-av-sm" style="background:hsl(${hue(c.name)} 42% 38% / .85)">${esc(initials(c.name))}</span><span class="nk-who"><span class="nk-nm">${esc(c.name)}</span><span class="nk-co">${esc(c.company || '')}</span></span></button>`).join('')
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
    render(animated);
    if (_catListId) { const id = _catListId; _openCatList(id); }        // re-liste (contact ajouté/modifié)
    if (_ficheId) { const c = _contactById(_ficheId); c ? _renderFiche(c) : _closeFiche(); }
    return true;
  } catch (e) { return false; }
}

// ── Mutations ───────────────────────────────────────────────────
async function _submitContact(form) {
  const fd = new FormData(form);
  const id = form.dataset.id || null;
  const payload = {
    name: String(fd.get('name') || '').trim(),
    kind: fd.get('kind') || 'person',
    company: String(fd.get('company') || '').trim(),
    title: String(fd.get('title') || '').trim(),
    email: String(fd.get('email') || '').trim(),
    phone: String(fd.get('phone') || '').trim(),
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
  try { await _api('/category/' + id, { method: 'DELETE' }); if (openCat === id) openCat = null; if (_catListId === id) _closeCatList(); await _refresh(); _closeOverlay(); _toast('Catégorie supprimée'); }
  catch (err) { _toast('Suppression impossible', 'error'); }
}
async function _moveCategory(id, dir) {
  const i = _cats.findIndex(c => String(c.id) === String(id));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= _cats.length) return;
  const a = _cats[i], b = _cats[j];
  try {
    await _api('/category/' + a.id, { method: 'PATCH', body: { position: j } });
    await _api('/category/' + b.id, { method: 'PATCH', body: { position: i } });
    await _refresh();
  } catch (err) { _toast('Réorganisation impossible', 'error'); }
}

// ══════════════════ NK-4 — LISTE MOBILE & FICHE CONTACT ══════════════════
function _parseArr(v) { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (_) { return []; } }

// ── Liste plein écran d'une catégorie (mobile : remplace la 3ᵉ colonne) ──
function _openCatList(catId) {
  const c = _cats.find(x => String(x.id) === String(catId));
  if (!c) return;
  _closeCatList();
  _catListId = catId;
  const rows = c._all || [];
  const panel = document.createElement('div');
  panel.className = 'nk-fullpanel';
  panel.innerHTML =
    `<div class="nk-fp-hd">
       <button class="nk-fp-icon" data-act="nk-catlist-close" aria-label="Retour">${icon('chevron-left', 26)}</button>
       <div class="nk-fp-title">${esc(c.label)} <span>${c.count}</span></div>
       <button class="nk-fp-icon" data-act="nk-catlist-menu" data-cat="${esc(catId)}" aria-label="Gérer la catégorie">${icon('more-horizontal', 22)}</button>
       <button class="nk-fp-icon" data-act="nk-catlist-add" data-cat="${esc(catId)}" aria-label="Ajouter">${icon('plus', 22)}</button>
     </div>
     <div class="nk-fp-body">${rows.length
      ? rows.map(ct => `<button class="nk-list-row" data-id="${esc(ct.id)}"><span class="nk-av" style="background:hsl(${hue(ct.name)} 42% 38% / .85)">${esc(initials(ct.name))}</span><span class="nk-who"><span class="nk-nm">${esc(ct.name)}</span><span class="nk-co">${esc(ct.company || '')}</span></span>${icon('chevron-right', 18)}</button>`).join('')
      : `<div class="nk-fp-empty">${icon('users', 44)}<p>Aucun contact dans « ${esc(c.label)} »</p><button class="nk-btn nk-btn-primary" data-act="nk-catlist-add" data-cat="${esc(catId)}">Ajouter un contact</button></div>`}</div>`;
  _root.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('nk-fullpanel-in'));
  _catList = panel;
}
function _closeCatList() { if (_catList) { _catList.remove(); _catList = null; _catListId = null; } }

// ── Fiche contact (panneau glissant desktop / plein écran mobile) ──
const SHORTCUTS = [
  { pad: 'O-SEC-001', icon: 'sceau',       t1: 'Envoyer',  t2: 'une Missive' },
  { pad: 'A-COM-002', icon: 'kodex',       t1: 'Générer',  t2: 'un Brief' },
  { pad: 'O-AGT-001', icon: 'smart-agent', t1: 'Ouvrir',   t2: 'Smart Agent' },
  { pad: 'O-SOC-001', icon: 'user',        t1: 'Publier',  t2: 'pour ce client' },
];
const FICHE_TABS = [['resume', 'Résumé'], ['activite', 'Activité'], ['notes', 'Notes']];

function _openFiche(contact) {
  if (!contact || !contact.id) return;
  _closeCatList();
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
function _chip(field, val, cls) {
  return `<span class="nk-chip ${cls}">${esc(val)}<button class="nk-chip-x" data-act="nk-${field === 'roles' ? 'role' : 'tag'}-del" data-val="${esc(val)}" aria-label="Retirer">${icon('x', 12)}</button></span>`;
}
function _renderFiche(c) {
  if (!_fiche) return;
  const roles = _parseArr(c.roles), tags = _parseArr(c.tags);
  const av = `<span class="nk-fiche-av" style="background:hsl(${hue(c.name)} 42% 38% / .9)">${esc(initials(c.name))}</span>`;
  const badge = roles[0] ? `<span class="nk-fiche-badge">${esc(roles[0])}</span>` : `<span class="nk-fiche-badge nk-fiche-badge-soft">${KIND_LABELS[c.kind] || 'Contact'}</span>`;
  const tabs = FICHE_TABS.map(([id, lbl]) => `<button class="nk-fiche-tab${id === _ficheTabId ? ' nk-sel' : ''}" data-act="nk-fiche-tab" data-tab="${id}">${lbl}</button>`).join('');

  let body = '';
  if (_ficheTabId === 'resume') {
    body =
      `<div class="nk-fiche-sec"><div class="nk-fiche-lbl">Rôles</div><div class="nk-chips">${roles.map(r => _chip('roles', r, 'nk-chip-role')).join('')}<button class="nk-chip-add" data-act="nk-role-add" aria-label="Ajouter un rôle">${icon('plus', 14)}</button></div></div>
       <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Tags</div><div class="nk-chips">${tags.map(t => _chip('tags', t, 'nk-chip-tag')).join('')}<button class="nk-chip-add" data-act="nk-tag-add" aria-label="Ajouter un tag">${icon('plus', 14)}</button></div></div>
       <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Activité récente</div><div class="nk-fiche-empty">${icon('history', 22)}<span>Le journal d'activité arrive bientôt.</span></div></div>
       <div class="nk-fiche-sec"><div class="nk-fiche-lbl">Raccourcis</div><div class="nk-shortcuts">${SHORTCUTS.map(s => `<button class="nk-shortcut" data-act="nk-shortcut" data-pad="${s.pad}">${icon(s.icon, 20)}<span><b>${s.t1}</b>${s.t2}</span></button>`).join('')}</div></div>`;
  } else if (_ficheTabId === 'notes') {
    body = `<textarea class="nk-fiche-note" placeholder="Vos notes sur ${esc(c.name)}…" maxlength="8000">${esc(c.notes || '')}</textarea>`;
  } else {
    body = `<div class="nk-fiche-empty nk-fiche-empty-lg">${icon('history', 30)}<span>Le journal d'activité (appels, e-mails, RDV, devis…) arrive au prochain sprint.</span></div>`;
  }

  const tel = c.phone ? 'tel:' + encodeURIComponent(c.phone) : '';
  const mail = c.email ? 'mailto:' + encodeURIComponent(c.email) : '';
  const sms = c.phone ? 'sms:' + encodeURIComponent(c.phone) : '';

  _fiche.innerHTML =
    `<div class="nk-fiche-nav">
       <button class="nk-fiche-navbtn" data-act="nk-fiche-close" aria-label="Retour">${icon('chevron-left', 26)}</button>
       <button class="nk-fiche-navbtn" data-act="nk-fiche-edit" aria-label="Modifier">${icon('more-horizontal', 22)}</button>
     </div>
     <div class="nk-fiche-hd">
       <button class="nk-fiche-x" data-act="nk-fiche-close" aria-label="Fermer">${icon('x', 18)}</button>
       <div class="nk-fiche-top">${av}<div class="nk-fiche-idz"><h2 class="nk-fiche-name">${esc(c.name)}</h2>${badge}${c.company ? `<div class="nk-fiche-org">${esc(c.company)}</div>` : ''}${c.title ? `<div class="nk-fiche-fn">${esc(c.title)}</div>` : ''}</div></div>
       <div class="nk-fiche-acts">
         ${_actionBtn('phone', tel, 'Appeler')}${_actionBtn('mail', mail, 'E-mail')}${_actionBtn('message', sms, 'Message')}
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
async function _addChip(field) {
  const c = _contactById(_ficheId); if (!c) return;
  const v = prompt(field === 'roles' ? 'Ajouter un rôle' : 'Ajouter un tag');
  if (!v || !v.trim()) return;
  const arr = _parseArr(c[field]); const val = v.trim().slice(0, 40);
  if (arr.includes(val)) return;
  arr.push(val); _patchField(c.id, field, arr);
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
  // NK-6 ajoutera le pré-remplissage (opts.nkContact). Ici : ouverture simple.
  // Fermer le workspace networK AVANT (piège z-index/overlay documenté).
  closeNetwork();
  try { const m = await import('./ui-renderer.js'); m.openTool(padId, {}); } catch (_) {}
}

// ── Événements ──────────────────────────────────────────────────
function _onClick(e) {
  // Sélecteur d'icône (formulaire catégorie) — géré avant tout
  const iconOpt = e.target.closest('.nk-icon-opt');
  if (iconOpt && _overlay) {
    _overlay.querySelectorAll('.nk-icon-opt').forEach(o => o.classList.remove('nk-sel'));
    iconOpt.classList.add('nk-sel');
    const hid = _overlay.querySelector('input[name="icon"]');
    if (hid) hid.value = iconOpt.dataset.icon;
    return;
  }

  const actEl = e.target.closest('[data-act]');
  const act = actEl && actEl.dataset.act;

  // Boutons internes aux pills catégories (avant le toggle)
  if (act === 'nk-cat-add')  { e.stopPropagation(); return _openContactForm({ category_id: actEl.dataset.cat }); }
  if (act === 'nk-cat-menu') { e.stopPropagation(); return _openCatMenu(actEl.dataset.cat, actEl); }

  const person = e.target.closest('.nk-person');
  if (person && !actEl) return _openFiche(_contactById(person.dataset.id));

  const listRow = e.target.closest('.nk-list-row');
  if (listRow && !actEl) return _openFiche(_contactById(listRow.dataset.id));

  const searchItem = e.target.closest('.nk-search-item');
  if (searchItem) { const c = _contactById(searchItem.dataset.id); _clearSearch(); return _openFiche(c); }

  const catEl = e.target.closest('.nk-cat');
  if (catEl && !actEl) return _isMobile() ? _openCatList(catEl.dataset.cat) : toggle(catEl.dataset.cat);

  if (!act) return;
  switch (act) {
    case 'close':          return closeNetwork();
    case 'nk-add':         return _openAddMenu();
    case 'nk-ov-close':    return _closeOverlay();
    case 'nk-new-person':  _closeOverlay(); return _openContactForm({ kind: 'person' });
    case 'nk-new-company': _closeOverlay(); return _openContactForm({ kind: 'company' });
    case 'nk-new-place':   _closeOverlay(); return _openContactForm({ kind: 'place' });
    case 'nk-new-group':   _closeOverlay(); return _openContactForm({ kind: 'group' });
    case 'nk-new-cat':     _closeOverlay(); return _openCategoryForm(null);
    case 'nk-contact-del': return _deleteContact(actEl.dataset.id);
    case 'nk-cat-edit':    { _closePopover(); const c = _cats.find(x => String(x.id) === String(actEl.dataset.cat)); return _openCategoryForm(c); }
    case 'nk-cat-del':     { _closePopover(); return _deleteCategory(actEl.dataset.cat || actEl.dataset.id); }
    case 'nk-cat-up':      { _closePopover(); return _moveCategory(actEl.dataset.cat, -1); }
    case 'nk-cat-down':    { _closePopover(); return _moveCategory(actEl.dataset.cat, +1); }
    case 'nk-catlist-close': return _closeCatList();
    case 'nk-catlist-menu': return _openCatMenu(actEl.dataset.cat, actEl);
    case 'nk-catlist-add': return _openContactForm({ category_id: actEl.dataset.cat });
    case 'nk-fiche-close': return _closeFiche();
    case 'nk-fiche-edit':  { const c = _contactById(_ficheId); if (c) _openContactForm(c); return; }
    case 'nk-fiche-tab':   return _ficheTab(actEl.dataset.tab);
    case 'nk-role-add':    return _addChip('roles');
    case 'nk-role-del':    return _delChip('roles', actEl.dataset.val);
    case 'nk-tag-add':     return _addChip('tags');
    case 'nk-tag-del':     return _delChip('tags', actEl.dataset.val);
    case 'nk-shortcut':    return _openShortcut(actEl.dataset.pad);
    case 'nk-zoom-in':     return _setZoom(_zoom * 1.15);
    case 'nk-zoom-out':    return _setZoom(_zoom * 0.87);
    case 'nk-zoom-reset':  return _setZoom(1);
    case 'nk-fit':         _panX = _panY = 0; return _setZoom(1);
  }
}

function _onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'contact') _submitContact(form);
  else if (form.dataset.form === 'category') _submitCategory(form);
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
  }
}

function _onKey(e) {
  if (e.key !== 'Escape') return;
  if (_popover) return _closePopover();
  if (_overlay)  return _closeOverlay();
  if (_fiche)    return _closeFiche();
  if (_catList)  return _closeCatList();
  const dd = _root && _root.querySelector('.nk-search-results');
  if (dd) return _clearSearch();
  if (openCat) return toggle(openCat);
  closeNetwork();
}

let _rz = null;
function _onResize() { clearTimeout(_rz); _rz = setTimeout(() => render(false), 150); }
