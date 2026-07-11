/* ═══════════════════════════════════════════════════════════════
   booK — moteur d'export autonome (Pad O-BOK-001 · V1)

   Module PUR (aucun DOM, importable en node pour les tests) :
   buildStandaloneHTML(edition) → le fichier .html autoporté.

   INVARIANT N°1 (BOOK_BRIEF §2) — le fichier produit ne dépend de
   RIEN, pas même de Keystone :
   · un seul fichier, images en data URI, CSS/JS inline ;
   · zéro appel réseau (pas de fetch, fonts, CDN, analytics) ;
   · JS « classique » inline, PAS de modules ES (bloqués en file://) ;
   · le manifeste JSON de l'édition est EMBARQUÉ dans le fichier
     (<script type="application/json" id="bk-edition">) → le fichier
     est sa propre source, ré-importable dans booK pour réédition.

   Choix d'archivage : les pages sont de VRAIES balises <img> dans
   <main id="bk-pages"> (pas des blobs dans le JSON). Sans JavaScript
   — navigateur de 2050, lecteur d'e-mail, impression — le document
   reste lisible : les pages s'empilent verticalement. Le lecteur
   (flip desktop / swipe mobile) ne fait que s'ajouter par-dessus.

   ⚠ Le lecteur embarqué (BK_READER_JS) est volontairement écrit en
   ES5 sans backticks ni ${} : il vit dans un template literal.
   ═══════════════════════════════════════════════════════════════ */

export const BK_FORMAT = 'bk-edition';
export const BK_FORMAT_VERSION = 1;

// ── Gabarit d'édition (le format pivot, BOOK_BRIEF §3) ──────────
// Le flipbook n'est qu'UN mode de rendu de ce format : la future
// plateforme éditoriale en ajoutera d'autres sur le même JSON.
export function newEdition() {
  return {
    format: BK_FORMAT,
    format_version: BK_FORMAT_VERSION,
    id: 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: '',
    subtitle: '',
    author: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    theme: { tint: '#C9A227', stage: 'dark' },      // stage: dark | light
    options: { doublePage: true },                   // double page sur grand écran
    pages: [],                                       // [{ src: dataURI, alt }]
  };
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Le JSON embarqué vit dans un <script> : la SEULE séquence dangereuse
// est une fermeture de script (+ commentaires HTML par prudence).
function _escJSONForScript(json) {
  return json.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

// Teinte hex → rgba (pour les voiles du lecteur, sans lib).
function _tintRGB(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '201, 162, 39'; // or Keystone par défaut
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
}

/* ─────────────────────────────────────────────────────────────────
   CSS embarqué. Fallback sans JS d'abord (pages empilées lisibles),
   lecteur ensuite (.bk-app est construit par le JS).
   ───────────────────────────────────────────────────────────────── */
function readerCSS(ed) {
  const tint = ed.theme?.tint || '#C9A227';
  const rgb = _tintRGB(tint);
  const dark = (ed.theme?.stage || 'dark') !== 'light';
  const stageBg = dark ? '#101014' : '#e9e6df';
  const stageFg = dark ? 'rgba(255,255,255,.85)' : 'rgba(20,20,24,.85)';
  const stageMut = dark ? 'rgba(255,255,255,.45)' : 'rgba(20,20,24,.45)';
  const barBg = dark ? 'rgba(16,16,20,.82)' : 'rgba(233,230,223,.85)';
  return `
:root { --bk-tint: ${tint}; --bk-tint-rgb: ${rgb}; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  background: ${stageBg}; color: ${stageFg};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  letter-spacing: -0.02em;
  -webkit-font-smoothing: antialiased;
}
/* ── Fallback sans JavaScript : le document reste lisible ── */
#bk-fallback-hd { max-width: 900px; margin: 0 auto; padding: 28px 20px 10px; }
#bk-fallback-hd h1 { font-weight: 900; font-size: 28px; }
#bk-fallback-hd p  { color: ${stageMut}; margin-top: 4px; }
#bk-pages { max-width: 900px; margin: 0 auto; padding: 14px 20px 40px; }
#bk-pages img { display: block; width: 100%; height: auto; margin: 0 0 14px; border-radius: 4px; }
/* ── Lecteur (construit par le JS ; le JS masque le fallback) ── */
body.bk-boot { overflow: hidden; }
body.bk-boot #bk-pages, body.bk-boot #bk-fallback-hd { display: none; }
.bk-app { position: fixed; inset: 0; display: flex; flex-direction: column; }
.bk-hd {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: ${barBg};
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  z-index: 5; min-height: 52px;
}
.bk-hd-title { font-weight: 900; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bk-hd-sub { font-size: 12px; color: ${stageMut}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bk-hd-left { min-width: 0; flex: 1; }
.bk-hd-count { font-size: 12px; color: ${stageMut}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bk-hd button {
  background: none; border: none; color: ${stageFg}; cursor: pointer;
  width: 36px; height: 36px; border-radius: 9px; display: inline-flex;
  align-items: center; justify-content: center; flex: 0 0 auto;
}
.bk-hd button:hover { background: rgba(var(--bk-tint-rgb), .14); color: var(--bk-tint); }
.bk-hd svg { width: 19px; height: 19px; stroke: currentColor; stroke-width: 1.7; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.bk-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 26px 54px; }
.bk-book { position: relative; perspective: 2400px; }
.bk-pg {
  position: absolute; top: 0; height: 100%; overflow: hidden;
  background: #fff; box-shadow: 0 8px 34px rgba(0,0,0,${dark ? '.5' : '.22'});
}
/* contain, jamais cover : une page dont le ratio diffère de la boîte est
   posée ENTIÈRE sur son papier blanc (letterbox), jamais rognée au pli —
   le rognage se lisait comme « la page de droite recouvre la gauche ». */
.bk-pg img { width: 100%; height: 100%; object-fit: contain; display: block; }
.bk-pg-left  { left: 0; border-radius: 6px 0 0 6px; }
.bk-pg-right { right: 0; border-radius: 0 6px 6px 0; }
.bk-pg-single { left: 0; border-radius: 6px; }
.bk-pg-empty { background: transparent; box-shadow: none; }
/* pli central du livre ouvert */
.bk-spine { position: absolute; top: 0; bottom: 0; left: 50%; width: 44px; transform: translateX(-50%); z-index: 2; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.16) 46%, rgba(0,0,0,.26) 50%, rgba(0,0,0,.16) 54%, rgba(0,0,0,0) 100%); }
/* la feuille qui tourne */
.bk-leaf { position: absolute; top: 0; width: 50%; height: 100%; z-index: 3; transform-style: preserve-3d; will-change: transform; }
.bk-leaf-fwd { right: 0; transform-origin: left center; }
.bk-leaf-bwd { left: 0;  transform-origin: right center; }
.bk-leaf-face { position: absolute; inset: 0; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; background: #fff; }
.bk-leaf-face img { width: 100%; height: 100%; object-fit: contain; display: block; }
.bk-leaf-back { transform: rotateY(180deg); }
.bk-leaf-shade { position: absolute; inset: 0; pointer-events: none; background: rgba(0,0,0,0); transition: background .1s linear; }
/* zones de navigation */
.bk-nav {
  position: absolute; top: 0; bottom: 0; width: 22%; max-width: 200px; border: none;
  background: none; cursor: pointer; color: ${stageMut}; z-index: 4;
  display: flex; align-items: center; opacity: 0; transition: opacity .25s;
}
.bk-nav svg { width: 34px; height: 34px; stroke: currentColor; stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.bk-nav:hover, .bk-nav:focus-visible { opacity: 1; color: var(--bk-tint); }
.bk-nav-prev { left: 0; justify-content: flex-start; padding-left: 12px; }
.bk-nav-next { right: 0; justify-content: flex-end; padding-right: 12px; }
.bk-nav[disabled] { visibility: hidden; }
/* barre de progression */
.bk-progress { height: 3px; background: rgba(var(--bk-tint-rgb), .16); }
.bk-progress span { display: block; height: 100%; background: var(--bk-tint); width: 0; transition: width .3s ease; }
/* sommaire (vignettes) */
.bk-thumbs {
  position: absolute; inset: 0; z-index: 6; overflow-y: auto;
  background: ${dark ? 'rgba(10,10,13,.94)' : 'rgba(238,235,228,.96)'};
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  display: none; padding: 74px 22px 30px;
}
.bk-thumbs.on { display: block; }
.bk-thumbs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; max-width: 1080px; margin: 0 auto; }
.bk-thumb { border: 2px solid transparent; border-radius: 6px; padding: 0; background: none; cursor: pointer; overflow: hidden; }
.bk-thumb img { width: 100%; height: auto; display: block; border-radius: 4px; }
.bk-thumb.cur, .bk-thumb:hover { border-color: var(--bk-tint); }
.bk-thumb-num { font-size: 11px; color: ${stageMut}; padding: 3px 0 5px; display: block; text-align: center; }
@media (prefers-reduced-motion: reduce) { .bk-leaf, .bk-progress span { transition: none !important; } }
@media (max-width: 640px) { .bk-stage { padding: 14px 10px; } .bk-hd-sub { display: none; } .bk-nav { opacity: 0 !important; } }
@media print {
  .bk-app { display: none !important; }
  body.bk-boot { overflow: visible; }
  body.bk-boot #bk-pages, body.bk-boot #bk-fallback-hd { display: block; }
  #bk-pages img { page-break-inside: avoid; break-inside: avoid; margin: 0 0 8px; }
}
`;
}

/* ─────────────────────────────────────────────────────────────────
   JS embarqué — le lecteur. ES5 strict, AUCUN module, AUCUN réseau.
   Lit le manifeste (#bk-edition) + les <img> de #bk-pages, masque le
   fallback, construit le lecteur : double page + effet de feuille
   tournée sur grand écran, page seule + swipe sur mobile, clavier,
   sommaire, plein écran.
   ───────────────────────────────────────────────────────────────── */
const BK_READER_JS = `
(function () {
  'use strict';
  var metaEl = document.getElementById('bk-edition');
  var srcEls = document.querySelectorAll('#bk-pages img');
  if (!metaEl || !srcEls.length) return;                 // fichier incomplet → fallback
  var meta;
  try { meta = JSON.parse(metaEl.textContent); } catch (e) { return; }
  var pages = [];
  for (var i = 0; i < srcEls.length; i++) pages.push({ src: srcEls[i].getAttribute('src'), alt: srcEls[i].getAttribute('alt') || ('Page ' + (i + 1)) });
  var N = pages.length;
  var wantDouble = !meta.options || meta.options.doublePage !== false;
  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  document.body.className += ' bk-boot';

  // ── Squelette ──────────────────────────────────────────────────
  var SVG = {
    left:  '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
    grid:  '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    full:  '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    x:     '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var app = el('div', 'bk-app');
  var hd = el('header', 'bk-hd');
  var hdLeft = el('div', 'bk-hd-left',
    '<div class="bk-hd-title">' + esc(meta.title || 'Sans titre') + '</div>' +
    (meta.subtitle ? '<div class="bk-hd-sub">' + esc(meta.subtitle) + '</div>' : ''));
  var count = el('span', 'bk-hd-count');
  var btnThumbs = el('button', null, SVG.grid); btnThumbs.setAttribute('aria-label', 'Sommaire'); btnThumbs.title = 'Sommaire';
  var btnFull = el('button', null, SVG.full); btnFull.setAttribute('aria-label', 'Plein \\u00e9cran'); btnFull.title = 'Plein \\u00e9cran';
  hd.appendChild(hdLeft); hd.appendChild(count); hd.appendChild(btnThumbs); hd.appendChild(btnFull);

  var stage = el('div', 'bk-stage');
  var book = el('div', 'bk-book');
  var prevBtn = el('button', 'bk-nav bk-nav-prev', SVG.left); prevBtn.setAttribute('aria-label', 'Page pr\\u00e9c\\u00e9dente');
  var nextBtn = el('button', 'bk-nav bk-nav-next', SVG.right); nextBtn.setAttribute('aria-label', 'Page suivante');
  stage.appendChild(prevBtn); stage.appendChild(book); stage.appendChild(nextBtn);

  var progress = el('div', 'bk-progress', '<span></span>');
  var thumbs = el('div', 'bk-thumbs');

  app.appendChild(hd); app.appendChild(stage); app.appendChild(progress); app.appendChild(thumbs);
  document.body.appendChild(app);

  // ── Géométrie ──────────────────────────────────────────────────
  var ratio = 210 / 297;                              // défaut A4 portrait, corrigé au 1er load
  var probe = new Image();
  probe.onload = function () { if (probe.naturalWidth && probe.naturalHeight) { ratio = probe.naturalWidth / probe.naturalHeight; layout(); } };
  probe.src = pages[0].src;

  var mode = 'single';                                 // 'single' | 'double'
  var cur = 0;                                         // index de la page de GAUCHE affichée (ou la page seule)
  var busy = false;

  function stageSize() {
    var r = stage.getBoundingClientRect();
    return { w: Math.max(120, r.width - 24), h: Math.max(120, r.height - 12) };
  }
  function layout() {
    var s = stageSize();
    var newMode = (wantDouble && N > 1 && s.w > s.h * 1.05 && s.w > 620) ? 'double' : 'single';
    mode = newMode;
    var pw, ph;
    if (mode === 'double') {
      ph = s.h; pw = ph * ratio;
      if (pw * 2 > s.w) { pw = s.w / 2; ph = pw / ratio; }
    } else {
      ph = s.h; pw = ph * ratio;
      if (pw > s.w) { pw = s.w; ph = pw / ratio; }
    }
    pw = Math.floor(pw); ph = Math.floor(ph);   // entiers : 2 pages de round(pw) pouvaient déborder d'1 px la boîte round(2pw)
    book.style.height = ph + 'px';
    book.style.width = (mode === 'double' && !isCoverAlone() ? pw * 2 : pw) + 'px';
    book._pw = pw; book._ph = ph;
    render();
  }

  // ── Pagination façon livre ─────────────────────────────────────
  // Double page : couverture seule, puis (1,2) (3,4)… ; cur = index pair-1 impair…
  // On travaille en « position » : 0 = couverture ; ensuite gauche = impair.
  function isCoverAlone() { return mode === 'double' && cur === 0; }
  function leftIdx()  { return cur; }                  // page visible gauche (ou seule)
  function rightIdx() { return mode === 'double' && cur > 0 ? cur + 1 : -1; }
  function lastPos()  {
    if (mode !== 'double') return N - 1;
    return N <= 1 ? 0 : (N % 2 === 0 ? N - 1 : N - 2) ; // dernière position gauche impaire
  }
  function normalize() {
    if (mode === 'double') { if (cur > 0 && cur % 2 === 0) cur = cur - 1; }
    if (cur < 0) cur = 0; if (cur > N - 1) cur = N - 1;
  }

  function pageHTML(idx, cls) {
    if (idx < 0 || idx > N - 1) return '<div class="bk-pg ' + cls + ' bk-pg-empty"></div>';
    return '<div class="bk-pg ' + cls + '"><img src="' + pages[idx].src + '" alt="' + esc(pages[idx].alt) + '"></div>';
  }

  function render() {
    normalize();
    var pw = book._pw || 300;
    var html = '';
    if (mode === 'double' && !isCoverAlone()) {
      html = pageHTML(leftIdx(), 'bk-pg-left') + pageHTML(rightIdx(), 'bk-pg-right') + '<div class="bk-spine"></div>';
      book.style.width = Math.round(pw * 2) + 'px';
    } else {
      html = pageHTML(cur, 'bk-pg-single');
      book.style.width = Math.round(pw) + 'px';
    }
    book.innerHTML = html;
    var pgs = book.querySelectorAll('.bk-pg');
    for (var i = 0; i < pgs.length; i++) { pgs[i].style.width = Math.round(pw) + 'px'; }
    updateHUD();
  }

  function updateHUD() {
    var label;
    if (mode === 'double' && !isCoverAlone() && rightIdx() <= N - 1) label = (leftIdx() + 1) + '\\u2013' + (rightIdx() + 1) + ' / ' + N;
    else label = (cur + 1) + ' / ' + N;
    count.textContent = label;
    prevBtn.disabled = cur <= 0;
    nextBtn.disabled = mode === 'double' ? cur >= lastPos() : cur >= N - 1;
    var farthest = mode === 'double' && !isCoverAlone() && rightIdx() >= 0 ? Math.min(rightIdx(), N - 1) : cur;
    progress.firstChild.style.width = (N > 1 ? Math.round(farthest / (N - 1) * 100) : 100) + '%';
    var tbs = thumbs.querySelectorAll('.bk-thumb');
    for (var i = 0; i < tbs.length; i++) {
      var p = parseInt(tbs[i].getAttribute('data-p'), 10);
      var on = (p === cur) || (mode === 'double' && !isCoverAlone() && p === rightIdx());
      tbs[i].className = 'bk-thumb' + (on ? ' cur' : '');
    }
  }

  // ── Navigation + effet feuille tournée ─────────────────────────
  function targetNext() { return mode === 'double' ? (cur === 0 ? 1 : cur + 2) : cur + 1; }
  function targetPrev() { return mode === 'double' ? (cur === 1 ? 0 : cur - 2) : cur - 1; }

  function go(dir) {
    if (busy) return;
    var tgt = dir > 0 ? targetNext() : targetPrev();
    if (dir > 0 && (mode === 'double' ? cur >= lastPos() : cur >= N - 1)) return;
    if (dir < 0 && cur <= 0) return;
    if (REDUCED || mode !== 'double' || cur === 0 || tgt === 0) {
      cur = tgt; render(); return;                     // couverture & mobile : bascule directe
    }
    flip(dir, tgt);
  }

  function flip(dir, tgt) {
    busy = true;
    var frontIdx = dir > 0 ? rightIdx() : leftIdx();       // la face visible qui se soulève
    var backIdx  = dir > 0 ? tgt : (tgt + 1 <= N - 1 ? tgt + 1 : -1); // son verso
    if (dir < 0) backIdx = tgt + 1;                        // en arrière : verso = future page droite
    // le fond montre déjà l'état d'arrivée du côté découvert
    var underL = dir > 0 ? leftIdx() : tgt;
    var underR = dir > 0 ? (tgt + 1 <= N - 1 ? tgt + 1 : -1) : rightIdx();
    book.innerHTML = pageHTML(underL, 'bk-pg-left') + pageHTML(underR, 'bk-pg-right') + '<div class="bk-spine"></div>';
    var pw = book._pw || 300;
    var pgs = book.querySelectorAll('.bk-pg');
    for (var i = 0; i < pgs.length; i++) pgs[i].style.width = Math.round(pw) + 'px';

    var leaf = el('div', 'bk-leaf ' + (dir > 0 ? 'bk-leaf-fwd' : 'bk-leaf-bwd'));
    var faceF = el('div', 'bk-leaf-face');
    if (frontIdx >= 0 && frontIdx <= N - 1) faceF.innerHTML = '<img src="' + pages[frontIdx].src + '" alt="">';
    var faceB = el('div', 'bk-leaf-face bk-leaf-back');
    if (backIdx >= 0 && backIdx <= N - 1) faceB.innerHTML = '<img src="' + pages[backIdx].src + '" alt="">';
    var shade = el('div', 'bk-leaf-shade');
    leaf.appendChild(faceF); leaf.appendChild(faceB); leaf.appendChild(shade);
    book.appendChild(leaf);

    var t0 = null, DUR = 560;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / DUR);
      var e = 1 - Math.pow(1 - t, 3);                  // easeOutCubic
      var ang = (dir > 0 ? -180 : 180) * e;
      leaf.style.transform = 'rotateY(' + ang + 'deg)';
      shade.style.background = 'rgba(0,0,0,' + (0.22 * Math.sin(Math.PI * e)).toFixed(3) + ')';
      if (t < 1) { requestAnimationFrame(step); }
      else { cur = tgt; busy = false; render(); }
    }
    requestAnimationFrame(step);
  }

  prevBtn.onclick = function () { go(-1); };
  nextBtn.onclick = function () { go(1); };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { go(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); e.preventDefault(); }
    else if (e.key === 'Home') { cur = 0; render(); }
    else if (e.key === 'End') { cur = mode === 'double' ? lastPos() : N - 1; render(); }
    else if (e.key === 'Escape' && thumbs.className.indexOf('on') >= 0) toggleThumbs(false);
  });

  // Swipe (mobile) — seuil 40 px, dominante horizontale.
  var tx = null, ty = null;
  stage.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    tx = ty = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  }, { passive: true });
  // Clic direct sur la moitié de page (desktop, en plus des chevrons)
  book.addEventListener('click', function (e) {
    var r = book.getBoundingClientRect();
    go(e.clientX < r.left + r.width / 2 ? -1 : 1);
  });

  // ── Sommaire ───────────────────────────────────────────────────
  var built = false;
  function toggleThumbs(force) {
    var on = typeof force === 'boolean' ? force : thumbs.className.indexOf('on') < 0;
    if (on && !built) {
      built = true;
      var g = '<div class="bk-thumbs-grid">';
      for (var i = 0; i < N; i++) {
        g += '<button class="bk-thumb" data-p="' + i + '"><img loading="lazy" src="' + pages[i].src + '" alt=""><span class="bk-thumb-num">' + (i + 1) + '</span></button>';
      }
      thumbs.innerHTML = g + '</div>';
      thumbs.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.bk-thumb') : null;
        if (!b) return;
        cur = parseInt(b.getAttribute('data-p'), 10);
        toggleThumbs(false); render();
      });
    }
    thumbs.className = 'bk-thumbs' + (on ? ' on' : '');
    btnThumbs.innerHTML = on ? SVG.x : SVG.grid;
    updateHUD();
  }
  btnThumbs.onclick = function () { toggleThumbs(); };

  // ── Plein écran ────────────────────────────────────────────────
  btnFull.onclick = function () {
    var d = document, e = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    } else {
      (e.requestFullscreen || e.webkitRequestFullscreen || function () {}).call(e);
    }
  };

  var rT = null;
  window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(layout, 120); });
  layout();
})();
`;

/* ─────────────────────────────────────────────────────────────────
   Le fichier autoporté.
   ───────────────────────────────────────────────────────────────── */
export function buildStandaloneHTML(edition) {
  const ed = edition || {};
  const pages = Array.isArray(ed.pages) ? ed.pages : [];
  // Manifeste embarqué = l'édition SANS les data URI des pages (elles
  // vivent en <img> juste dessous) — le ré-import recompose les deux.
  const meta = {
    format: BK_FORMAT,
    format_version: ed.format_version || BK_FORMAT_VERSION,
    id: ed.id || '',
    title: ed.title || '',
    subtitle: ed.subtitle || '',
    author: ed.author || '',
    created: ed.created || '',
    updated: ed.updated || '',
    theme: ed.theme || {},
    options: ed.options || {},
    pages: pages.map(p => ({ alt: p.alt || '' })),
  };
  const metaJSON = _escJSONForScript(JSON.stringify(meta));
  const imgs = pages.map((p, i) =>
    `    <img src="${p.src}" alt="${_esc(p.alt || ('Page ' + (i + 1)))}">`
  ).join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Keystone booK ${BK_FORMAT_VERSION}">
<meta name="robots" content="noindex">
<title>${_esc(ed.title || 'Flipbook')}</title>
<style>${readerCSS(ed)}</style>
</head>
<body>
<!-- ═══ Édition booK — fichier autoporté ═══
     Ce document ne dépend d'aucun serveur : ouvrez-le n'importe où,
     pour toujours. Le manifeste ci-dessous permet de le ré-importer
     dans booK (Keystone) pour le rééditer. -->
<script type="application/json" id="bk-edition">${metaJSON}</script>
<header id="bk-fallback-hd">
  <h1>${_esc(ed.title || 'Sans titre')}</h1>
  ${ed.subtitle ? `<p>${_esc(ed.subtitle)}</p>` : ''}
</header>
<main id="bk-pages">
${imgs}
</main>
<script>${BK_READER_JS}</script>
</body>
</html>`;
}
