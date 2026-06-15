// ═══════════════════════════════════════════════════════════════
// KEYNAPSE — moteur de constellation (KN-3, Sprint 3 : zones)
//
// Moteur MAISON, ZÉRO dépendance (pas de D3) :
//   • forces organiques (respiration, ancrage, anti-chevauchement,
//     plafond de vélocité, viscosité) — reprises de Trait d'union ;
//   • ZONES sans contour : cohésion douce des bulles d'une même zone
//     vers leur barycentre + « douve » entre zones différentes (collide
//     élargi) → des amas colorés qui se tiennent, sans cadre ;
//   • libellé de zone flottant au barycentre + ZOOM SÉMANTIQUE
//     (loin = noms de zones / près = titres de bulles) ;
//   • canevas INFINI : pan, zoom molette + pincement, « Tout voir »,
//     recentrage sur une zone ;
//   • traits EN PÉRIPHÉRIE (bord à bord, sous les disques, arqués) ;
//   • drag d'une bulle ; respiration coupée si reduced-motion ; pause
//     si l'onglet perd le focus.
//
// API : createConstellation({ container, onBubbleClick, onBubbleMoved })
//   → { setData(bubbles, links, zones), fitAll(), focusBubbles(ids),
//       zoomBy(f), updateNode(id, patch), destroy() }
// ═══════════════════════════════════════════════════════════════

const SVG_NS = 'http://www.w3.org/2000/svg';
const R            = 46;
const COLLIDE_PAD  = 16;
const ZONE_GAP     = 46;     // douve supplémentaire entre zones différentes
const ZONE_COH     = 0.003;  // cohésion douce vers le barycentre de zone
const ANCHOR       = 0.002;  // rappel à la position posée (placement libre conservé)
const V_DECAY      = 0.30;
const V_CAP        = 2;
const MIN_K        = 0.15;
const MAX_K        = 3;
const DRAG_THRESHOLD = 4;
const DEFAULT_COLOR = '#6366f1';
// Seuils de zoom sémantique (échelle k) : < FAR = constellations,
// entre = intermédiaire, > NEAR = détail.
const Z_FAR = 0.5, Z_NEAR = 0.95;

const reduceMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
// Élasticité du drag : la bulle saisie suit le curseur via un ressort doux
// (fraction du gap rattrapée par tick). 1 = rigide (collé) ; plus bas = plus
// élastique. Rigide si l'utilisateur préfère moins d'animations.
// Drag : la bulle saisie suit le curseur EXACTEMENT (comme Trait d'union, d.fx=
// event.x) ; la fluidité ne vient pas d'un retard du curseur mais des ressorts.
const DRAG_SPRING = 1;
// Ressorts de liens — l'ingrédient « réaliste/fluide » de Trait d'union (d3
// forceLink). Chaque lien tire ses deux bulles vers une distance de REPOS, mais
// ce repos est ADAPTATIF : il suit lentement la distance réelle. Conséquence :
// au repos, force ~nulle (ton rangement est préservé) ; quand tu déplaces une
// bulle, le réseau relié FLÉCHIT de façon organique et transitive, puis se
// repose proprement sans « revenir en arrière ». 0 si reduced-motion.
const LINK_K     = 0.005;                       // raideur du ressort de lien (coupé quand animation OFF)
const REST_ADAPT = 0.08;                        // vitesse d'adaptation du repos

export function createConstellation({ container, onBubbleClick, onBubbleMoved, motion = true } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'kyn-svg');
  // Fond transparent FIXE : capte les gestes pan/zoom sur les zones vides.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
  bg.setAttribute('fill', 'transparent');
  const viewport  = document.createElementNS(SVG_NS, 'g');
  const linkLayer = document.createElementNS(SVG_NS, 'g'); // sous les nœuds
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  const zoneLayer = document.createElementNS(SVG_NS, 'g'); // noms de zones, au-dessus
  zoneLayer.setAttribute('class', 'kyn-zone-layer');
  viewport.appendChild(linkLayer);
  viewport.appendChild(nodeLayer);
  viewport.appendChild(zoneLayer);
  svg.appendChild(bg);
  svg.appendChild(viewport);
  container.appendChild(svg);

  let nodes = [], links = [], zones = [], byId = new Map();
  const zoneLabels = new Map();             // zoneId → <text>
  let raf = null, running = false;
  let motionOn = motion;   // animation ambiante (respiration + flexion des liens) — pilotable à chaud (mal de mer)
  let k = 1, tx = 0, ty = 0;
  const pointers = new Map();
  let mode = null, dragNode = null, dragMoved = false, dragOff = { x: 0, y: 0 }, downPos = null;
  let panStart = null, pinchStart = null, interacting = false;
  const t0 = performance.now();

  function rect() { const r = container.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600, left: r.left, top: r.top }; }
  (function init() { const s = rect(); tx = s.w / 2; ty = s.h / 2; })();
  function applyTransform() {
    viewport.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})`);
    svg.dataset.zoom = k < Z_FAR ? 'far' : (k > Z_NEAR ? 'near' : 'mid');
  }
  applyTransform();
  function toWorld(px, py) { return { x: (px - tx) / k, y: (py - ty) / k }; }
  function localPt(e) { const s = rect(); return { x: e.clientX - s.left, y: e.clientY - s.top }; }

  // ── Données ────────────────────────────────────────────────
  function setData(bubbles, lks, zns) {
    const prev = byId;
    nodes = (bubbles || []).map((b) => {
      const old = prev.get(b.id);
      return {
        id: b.id, title: b.title || '', color: b.color || DEFAULT_COLOR, zone: b.zone_id || null,
        x: old ? old.x : (Number(b.x) || 0), y: old ? old.y : (Number(b.y) || 0),
        vx: old ? old.vx : 0, vy: old ? old.vy : 0, fx: null, fy: null,
        ax: Number(b.x) || 0, ay: Number(b.y) || 0,
        ph1: Math.random() * Math.PI * 2, ph2: Math.random() * Math.PI * 2,
        fm: 0.55 + Math.random() * 0.9, am: 0.7 + Math.random() * 0.7,
        el: null,
      };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    links = (lks || []).filter((l) => byId.has(l.from_bubble) && byId.has(l.to_bubble))
      .map((l) => ({ from: l.from_bubble, to: l.to_bubble, el: null }));
    zones = (zns || []).slice();
    build();
    ensureRunning();
  }

  function build() {
    linkLayer.replaceChildren();
    nodeLayer.replaceChildren();
    zoneLayer.replaceChildren();
    zoneLabels.clear();
    for (const l of links) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'kyn-link');
      l.el = p; linkLayer.appendChild(p);
    }
    for (const n of nodes) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'kyn-bubble');
      g.setAttribute('data-bubble-id', n.id);
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('r', String(R));
      c.setAttribute('fill', n.color); c.setAttribute('fill-opacity', '0.16');
      c.setAttribute('stroke', n.color); c.setAttribute('stroke-width', '1.6');
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'kyn-bubble-label');
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dy', '0.32em');
      t.textContent = truncate(n.title, 14);
      g.appendChild(c); g.appendChild(t);
      n.el = g; nodeLayer.appendChild(g);
    }
    // Libellés de zone (au barycentre, révélés par le zoom).
    for (const z of zones) {
      if (!nodes.some((n) => n.zone === z.id)) continue;     // zone vide = pas de libellé
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'kyn-zone-label');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', z.color || DEFAULT_COLOR);
      t.textContent = String(z.name || '').toUpperCase();
      zoneLabels.set(z.id, t); zoneLayer.appendChild(t);
    }
    renderPositions();
  }

  // ── Barycentres de zone ────────────────────────────────────
  function centroids() {
    const m = new Map();
    for (const n of nodes) {
      if (!n.zone) continue;
      const c = m.get(n.zone) || { x: 0, y: 0, n: 0 };
      c.x += n.x; c.y += n.y; c.n++; m.set(n.zone, c);
    }
    for (const c of m.values()) { c.x /= c.n; c.y /= c.n; }
    return m;
  }

  // ── Forces ─────────────────────────────────────────────────
  function breath() {
    const t = performance.now() - t0;
    for (const n of nodes) {
      if (n.fx != null) continue;
      const a = 0.09 * n.am;
      n.vx += Math.cos(t * 0.00028 * n.fm + n.ph1) * a;
      n.vy += Math.sin(t * 0.00033 * n.fm + n.ph2) * a;
    }
  }
  function cohesion(cents) {
    for (const n of nodes) {
      if (n.fx != null) continue;
      n.vx += (n.ax - n.x) * ANCHOR;          // placement libre conservé
      n.vy += (n.ay - n.y) * ANCHOR;
      if (n.zone && cents.has(n.zone)) {       // + cohésion douce vers la zone
        const c = cents.get(n.zone);
        n.vx += (c.x - n.x) * ZONE_COH;
        n.vy += (c.y - n.y) * ZONE_COH;
      }
    }
  }
  // Ressorts de liens (façon Trait d'union) : agit en CONTINU sur tous les liens.
  // Le repos adaptatif fait qu'au repos la force est ~nulle (placement préservé) ;
  // seuls les mouvements font fléchir le réseau, de proche en proche.
  function linkSpring() {
    if (!motionOn || !LINK_K) return;
    for (const l of links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (l.rest == null) l.rest = d;              // repos initial = distance posée
      l.rest += (d - l.rest) * REST_ADAPT;          // le repos suit lentement le réel
      const f = (d - l.rest) * LINK_K / d;          // ressort vers la distance de repos
      const fx = dx * f, fy = dy * f;
      if (a.fx == null) { a.vx += fx; a.vy += fy; }
      if (b.fx == null) { b.vx -= fx; b.vy -= fy; }
    }
  }
  function collide() {
    const base = R * 2 + COLLIDE_PAD;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        // Douve entre deux zones DIFFÉRENTES (toutes deux assignées).
        const min = (a.zone && b.zone && a.zone !== b.zone) ? base + ZONE_GAP : base;
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d < min) {
          if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          if (a.fx == null) { a.x -= ux * push; a.y -= uy * push; }
          if (b.fx == null) { b.x += ux * push; b.y += uy * push; }
        }
      }
    }
  }
  function speedLimit() {
    for (const n of nodes) {
      if (n.fx != null) continue;
      const s = Math.hypot(n.vx, n.vy);
      if (s > V_CAP) { n.vx = n.vx / s * V_CAP; n.vy = n.vy / s * V_CAP; }
    }
  }
  function energy() { let e = 0; for (const n of nodes) e += n.vx * n.vx + n.vy * n.vy; return e; }

  function tick() {
    const cents = centroids();
    if (motionOn) breath();
    cohesion(cents);
    linkSpring();
    collide();
    speedLimit();
    for (const n of nodes) {
      if (n.fx != null) {            // bulle saisie : suit le curseur avec une légère élasticité
        n.x += (n.fx - n.x) * DRAG_SPRING;
        n.y += (n.fy - n.y) * DRAG_SPRING;
        n.vx = 0; n.vy = 0; continue;
      }
      n.x += n.vx; n.y += n.vy;
      n.vx *= (1 - V_DECAY); n.vy *= (1 - V_DECAY);
    }
    renderPositions(cents);
  }
  function frame() {
    tick();
    const moving = motionOn || interacting || energy() > 0.001;
    if (running && moving) { raf = requestAnimationFrame(frame); }
    else { running = false; raf = null; }
  }
  function ensureRunning() { if (running || document.hidden) return; running = true; raf = requestAnimationFrame(frame); }

  // ── Rendu ──────────────────────────────────────────────────
  function renderPositions(cents) {
    for (const n of nodes) if (n.el) n.el.setAttribute('transform', `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`);
    for (const l of links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (a && b && l.el) l.el.setAttribute('d', linkPath(a, b));
    }
    if (zoneLabels.size) {
      const c = cents || centroids();
      const fs = (15 / k).toFixed(1);          // taille écran ~constante
      for (const [zid, el] of zoneLabels) {
        const ctr = c.get(zid);
        if (!ctr) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.setAttribute('x', ctr.x.toFixed(1));
        el.setAttribute('y', (ctr.y - 78).toFixed(1));   // au-dessus de l'amas
        el.setAttribute('font-size', fs);
      }
    }
  }
  function linkPath(a, b) {
    let dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy);
    if (L < R * 2 + 2) return '';
    const ux = dx / L, uy = dy / L;
    const sx = a.x + ux * R, sy = a.y + uy * R, ex = b.x - ux * R, ey = b.y - uy * R;
    const arc = L * 0.06;
    const mx = (sx + ex) / 2 + (-uy) * arc, my = (sy + ey) / 2 + (ux) * arc;
    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ── Interaction (pan / drag / pinch) ───────────────────────
  function onDown(e) {
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    const p = localPt(e); pointers.set(e.pointerId, p);
    if (pointers.size === 2) { startPinch(); return; }
    const bEl = e.target.closest && e.target.closest('[data-bubble-id]');
    if (bEl) {
      const n = byId.get(bEl.getAttribute('data-bubble-id'));
      if (n) {
        mode = 'drag'; dragNode = n; dragMoved = false; downPos = p; interacting = true;
        const w = toWorld(p.x, p.y); dragOff = { x: w.x - n.x, y: w.y - n.y };
        n.fx = n.x; n.fy = n.y; ensureRunning();
      }
    } else { mode = 'pan'; interacting = true; panStart = { tx, ty, px: p.x, py: p.y }; }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = localPt(e); pointers.set(e.pointerId, p);
    if (mode === 'pinch') { movePinch(); return; }
    if (mode === 'drag' && dragNode) {
      if (!dragMoved && downPos && Math.hypot(p.x - downPos.x, p.y - downPos.y) > DRAG_THRESHOLD) dragMoved = true;
      const w = toWorld(p.x, p.y);
      dragNode.fx = w.x - dragOff.x; dragNode.fy = w.y - dragOff.y;
      // Pas de snap : le tick fait suivre la bulle avec une légère élasticité.
    } else if (mode === 'pan' && panStart) {
      tx = panStart.tx + (p.x - panStart.px); ty = panStart.ty + (p.y - panStart.py); applyTransform();
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (mode === 'drag' && dragNode) {
      const n = dragNode;
      n.fx = null; n.fy = null; n.ax = n.x; n.ay = n.y;
      if (dragMoved) { onBubbleMoved && onBubbleMoved(n.id, Math.round(n.x), Math.round(n.y)); }
      else { onBubbleClick && onBubbleClick(n); }
      dragNode = null;
    }
    if (mode === 'pinch' && pointers.size === 1) {
      const p = [...pointers.values()][0]; mode = 'pan'; panStart = { tx, ty, px: p.x, py: p.y }; return;
    }
    if (pointers.size === 0) { mode = null; interacting = false; ensureRunning(); }
  }
  function onWheel(e) {
    e.preventDefault();
    const p = localPt(e);
    const factor = Math.exp(-e.deltaY * 0.0012);
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * factor));
    tx = p.x - (p.x - tx) * (nk / k); ty = p.y - (p.y - ty) * (nk / k); k = nk; applyTransform();
  }
  function twoPts() { return [...pointers.values()].slice(0, 2); }
  function startPinch() {
    const [p1, p2] = twoPts(); if (!p1 || !p2) return;
    mode = 'pinch'; interacting = true;
    pinchStart = { d: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, k, tx, ty };
  }
  function movePinch() {
    const [p1, p2] = twoPts(); if (!p1 || !p2 || !pinchStart) return;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const nk = Math.max(MIN_K, Math.min(MAX_K, pinchStart.k * (d / pinchStart.d)));
    tx = mx - (pinchStart.mx - pinchStart.tx) * (nk / pinchStart.k);
    ty = my - (pinchStart.my - pinchStart.ty) * (nk / pinchStart.k);
    k = nk; applyTransform();
  }

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  function onVis() { if (document.hidden) { running = false; if (raf) cancelAnimationFrame(raf); raf = null; } else ensureRunning(); }
  document.addEventListener('visibilitychange', onVis);

  // ── Caméra ─────────────────────────────────────────────────
  function fitBox(minX, minY, maxX, maxY) {
    const s = rect();
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), pad = 90;
    k = Math.max(MIN_K, Math.min(MAX_K, Math.min((s.w - pad) / bw, (s.h - pad) / bh)));
    tx = s.w / 2 - ((minX + maxX) / 2) * k;
    ty = s.h / 2 - ((minY + maxY) / 2) * k;
    applyTransform();
  }
  function fitAll() {
    const s = rect();
    if (!nodes.length) { tx = s.w / 2; ty = s.h / 2; k = 1; applyTransform(); return; }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const n of nodes) { a = Math.min(a, n.x - R); b = Math.min(b, n.y - R); c = Math.max(c, n.x + R); d = Math.max(d, n.y + R); }
    fitBox(a, b, c, d);
  }
  function focusBubbles(ids) {
    const set = new Set(ids || []);
    const sel = nodes.filter((n) => set.has(n.id));
    if (!sel.length) { fitAll(); return; }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const n of sel) { a = Math.min(a, n.x - R); b = Math.min(b, n.y - R); c = Math.max(c, n.x + R); d = Math.max(d, n.y + R); }
    fitBox(a, b, c, d);
  }
  function zoomBy(f) {
    const s = rect(), px = s.w / 2, py = s.h / 2;
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * f));
    tx = px - (px - tx) * (nk / k); ty = py - (py - ty) * (nk / k); k = nk; applyTransform();
  }

  function updateNode(id, patch = {}) {
    const n = byId.get(id); if (!n || !n.el) return;
    if (typeof patch.title === 'string') {
      n.title = patch.title;
      const t = n.el.querySelector('.kyn-bubble-label'); if (t) t.textContent = truncate(n.title, 14);
    }
    if (patch.color) {
      n.color = patch.color;
      const c = n.el.querySelector('circle'); if (c) { c.setAttribute('fill', n.color); c.setAttribute('stroke', n.color); }
    }
  }

  function destroy() {
    running = false; if (raf) cancelAnimationFrame(raf); raf = null;
    document.removeEventListener('visibilitychange', onVis);
    svg.remove();
  }

  // Met une bulle en évidence : recentre (sans changer le zoom) + pulsation.
  function centerOn(id) {
    const n = byId.get(id); if (!n) return;
    const s = rect();
    tx = s.w / 2 - n.x * k; ty = s.h / 2 - n.y * k; applyTransform();
  }
  function revealBubble(id) {
    const n = byId.get(id); if (!n || !n.el) return;
    centerOn(id);
    n.el.classList.add('kyn-pulse');
    setTimeout(() => { if (n.el) n.el.classList.remove('kyn-pulse'); }, 1200);
  }

  // Active/coupe l'animation ambiante (respiration + flexion des liens). Coupée :
  // la carte se fige (on annule les vitesses) ; tout reste cliquable/déplaçable.
  function setMotion(on) {
    motionOn = !!on;
    if (!motionOn) { for (const n of nodes) { n.vx = 0; n.vy = 0; } }
    ensureRunning();
  }

  return { setData, fitAll, focusBubbles, revealBubble, zoomBy, updateNode, setMotion, destroy };
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
