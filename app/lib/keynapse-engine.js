// ═══════════════════════════════════════════════════════════════
// KEYNAPSE — moteur de constellation (KN-1, Sprint 1)
//
// Moteur MAISON, ZÉRO dépendance (pas de D3) :
//   • boucle de simulation + forces organiques reprises de Trait d'union
//     (respiration déphasée, ancrage individuel, anti-chevauchement,
//     plafond de vélocité, viscosité anti-vibration) — du JS pur ;
//   • canevas INFINI : pan (glisser le fond), zoom (molette + pincement),
//     bornes de zoom, recadrage « Tout voir » ;
//   • traits EN PÉRIPHÉRIE : accrochés au BORD des bulles, tracés SOUS
//     les disques, légèrement arqués → jamais au travers d'une bulle ;
//   • drag d'une bulle (la position lâchée est persistée par le contrôleur) ;
//   • respiration coupée si prefers-reduced-motion ; sim en pause si l'onglet
//     perd le focus.
//
// API : createConstellation({ container, onBubbleClick, onBubbleMoved })
//   → { setData(bubbles, links), fitAll(), zoomBy(f), destroy() }
// ═══════════════════════════════════════════════════════════════

const SVG_NS = 'http://www.w3.org/2000/svg';
const R            = 46;     // rayon d'une bulle (unités monde)
const COLLIDE_PAD  = 16;     // marge anti-chevauchement
const V_DECAY      = 0.30;   // viscosité (supprime les vibrations)
const V_CAP        = 2;      // plafond de vélocité (monde / tick)
const MIN_K        = 0.15;   // dézoom max (vue « constellations »)
const MAX_K        = 3;      // zoom max (détail)
const DRAG_THRESHOLD = 4;    // px écran : en-deçà = tap (pas un drag)
const DEFAULT_COLOR = '#6366f1';

const reduceMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createConstellation({ container, onBubbleClick, onBubbleMoved } = {}) {
  // ── DOM ────────────────────────────────────────────────────
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'kyn-svg');
  // Fond transparent FIXE (hors viewport) : capte les gestes pan/zoom sur les
  // zones vides — un <svg> sans peinture ne reçoit pas les événements pointeur.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
  bg.setAttribute('fill', 'transparent');
  const viewport  = document.createElementNS(SVG_NS, 'g');
  const linkLayer = document.createElementNS(SVG_NS, 'g'); // SOUS les nœuds
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  viewport.appendChild(linkLayer);
  viewport.appendChild(nodeLayer);
  svg.appendChild(bg);
  svg.appendChild(viewport);
  container.appendChild(svg);

  // ── État ───────────────────────────────────────────────────
  let nodes = [], links = [], byId = new Map();
  let raf = null, running = false;
  let k = 1, tx = 0, ty = 0;              // transform monde → écran
  const pointers = new Map();             // pointerId → {x,y}
  let mode = null;                        // 'pan' | 'drag' | 'pinch'
  let dragNode = null, dragMoved = false, dragOff = { x: 0, y: 0 }, downPos = null;
  let panStart = null, pinchStart = null;
  let interacting = false;
  const t0 = performance.now();

  function rect() { const r = container.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600, left: r.left, top: r.top }; }
  (function init() { const s = rect(); tx = s.w / 2; ty = s.h / 2; })();
  function applyTransform() { viewport.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})`); }
  applyTransform();

  function toWorld(px, py) { return { x: (px - tx) / k, y: (py - ty) / k }; }
  function localPt(e) { const s = rect(); return { x: e.clientX - s.left, y: e.clientY - s.top }; }

  // ── Données ────────────────────────────────────────────────
  function setData(bubbles, lks) {
    const prev = byId;
    nodes = (bubbles || []).map((b) => {
      const old = prev.get(b.id);
      return {
        id: b.id,
        title: b.title || '',
        color: b.color || DEFAULT_COLOR,
        x: old ? old.x : (Number(b.x) || 0),
        y: old ? old.y : (Number(b.y) || 0),
        vx: old ? old.vx : 0, vy: old ? old.vy : 0,
        fx: null, fy: null,
        ax: Number(b.x) || 0, ay: Number(b.y) || 0,   // ancre = position persistée
        ph1: Math.random() * Math.PI * 2, ph2: Math.random() * Math.PI * 2,
        fm: 0.55 + Math.random() * 0.9, am: 0.7 + Math.random() * 0.7,
        el: null,
      };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    links = (lks || [])
      .filter((l) => byId.has(l.from_bubble) && byId.has(l.to_bubble))
      .map((l) => ({ from: l.from_bubble, to: l.to_bubble, el: null }));
    build();
    ensureRunning();
  }

  function build() {
    linkLayer.replaceChildren();
    nodeLayer.replaceChildren();
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
      c.setAttribute('fill', n.color);
      c.setAttribute('fill-opacity', '0.16');
      c.setAttribute('stroke', n.color);
      c.setAttribute('stroke-width', '1.6');
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'kyn-bubble-label');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dy', '0.32em');
      t.textContent = truncate(n.title, 14);
      g.appendChild(c); g.appendChild(t);
      n.el = g; nodeLayer.appendChild(g);
    }
    renderPositions();
  }

  // ── Forces (Trait d'union, adaptées au canevas infini) ─────
  function breath() {
    const t = performance.now() - t0;
    for (const n of nodes) {
      if (n.fx != null) continue;
      const a = 0.09 * n.am;
      n.vx += Math.cos(t * 0.00028 * n.fm + n.ph1) * a;
      n.vy += Math.sin(t * 0.00033 * n.fm + n.ph2) * a;
    }
  }
  function anchor() {
    for (const n of nodes) {
      if (n.fx != null) continue;
      n.vx += (n.ax - n.x) * 0.002;
      n.vy += (n.ay - n.y) * 0.002;
    }
  }
  function collide() {
    const min = R * 2 + COLLIDE_PAD;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
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
    if (!reduceMotion) breath();
    anchor();
    collide();
    speedLimit();
    for (const n of nodes) {
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.x += n.vx; n.y += n.vy;
      n.vx *= (1 - V_DECAY); n.vy *= (1 - V_DECAY);
    }
    renderPositions();
  }

  function frame() {
    tick();
    const moving = !reduceMotion || interacting || energy() > 0.001;
    if (running && moving) { raf = requestAnimationFrame(frame); }
    else { running = false; raf = null; }
  }
  function ensureRunning() {
    if (running || document.hidden) return;
    running = true; raf = requestAnimationFrame(frame);
  }

  // ── Rendu ──────────────────────────────────────────────────
  function renderPositions() {
    for (const n of nodes) if (n.el) n.el.setAttribute('transform', `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`);
    for (const l of links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (a && b && l.el) l.el.setAttribute('d', linkPath(a, b));
    }
  }
  // Trait accroché au BORD des deux cercles + léger arc → en périphérie,
  // jamais à travers une bulle.
  function linkPath(a, b) {
    let dx = b.x - a.x, dy = b.y - a.y; const L = Math.hypot(dx, dy);
    if (L < R * 2 + 2) return '';
    const ux = dx / L, uy = dy / L;
    const sx = a.x + ux * R, sy = a.y + uy * R;
    const ex = b.x - ux * R, ey = b.y - uy * R;
    const arc = L * 0.06;
    const mx = (sx + ex) / 2 + (-uy) * arc, my = (sy + ey) / 2 + (ux) * arc;
    return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ── Interaction (pointer events : pan / drag / pinch) ──────
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
    } else {
      mode = 'pan'; interacting = true; panStart = { tx, ty, px: p.x, py: p.y };
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = localPt(e); pointers.set(e.pointerId, p);
    if (mode === 'pinch') { movePinch(); return; }
    if (mode === 'drag' && dragNode) {
      if (!dragMoved && downPos && Math.hypot(p.x - downPos.x, p.y - downPos.y) > DRAG_THRESHOLD) dragMoved = true;
      const w = toWorld(p.x, p.y);
      dragNode.fx = w.x - dragOff.x; dragNode.fy = w.y - dragOff.y;
      dragNode.x = dragNode.fx; dragNode.y = dragNode.fy;
      renderPositions();
    } else if (mode === 'pan' && panStart) {
      tx = panStart.tx + (p.x - panStart.px);
      ty = panStart.ty + (p.y - panStart.py);
      applyTransform();
    }
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (mode === 'drag' && dragNode) {
      const n = dragNode;
      n.fx = null; n.fy = null; n.ax = n.x; n.ay = n.y;   // nouvelle ancre = position lâchée
      if (dragMoved) { onBubbleMoved && onBubbleMoved(n.id, Math.round(n.x), Math.round(n.y)); }
      else { onBubbleClick && onBubbleClick(n); }
      dragNode = null;
    }
    if (mode === 'pinch' && pointers.size === 1) {
      const p = [...pointers.values()][0];
      mode = 'pan'; panStart = { tx, ty, px: p.x, py: p.y };
      return;
    }
    if (pointers.size === 0) { mode = null; interacting = false; ensureRunning(); }
  }
  function onWheel(e) {
    e.preventDefault();
    const p = localPt(e);
    const factor = Math.exp(-e.deltaY * 0.0012);
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * factor));
    tx = p.x - (p.x - tx) * (nk / k);
    ty = p.y - (p.y - ty) * (nk / k);
    k = nk; applyTransform();
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

  function onVis() {
    if (document.hidden) { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }
    else ensureRunning();
  }
  document.addEventListener('visibilitychange', onVis);

  // ── Caméra ─────────────────────────────────────────────────
  function fitAll() {
    const s = rect();
    if (!nodes.length) { tx = s.w / 2; ty = s.h / 2; k = 1; applyTransform(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) { minX = Math.min(minX, n.x - R); minY = Math.min(minY, n.y - R); maxX = Math.max(maxX, n.x + R); maxY = Math.max(maxY, n.y + R); }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), pad = 90;
    k = Math.max(MIN_K, Math.min(MAX_K, Math.min((s.w - pad) / bw, (s.h - pad) / bh)));
    tx = s.w / 2 - ((minX + maxX) / 2) * k;
    ty = s.h / 2 - ((minY + maxY) / 2) * k;
    applyTransform();
  }
  function zoomBy(f) {
    const s = rect(), px = s.w / 2, py = s.h / 2;
    const nk = Math.max(MIN_K, Math.min(MAX_K, k * f));
    tx = px - (px - tx) * (nk / k); ty = py - (py - ty) * (nk / k);
    k = nk; applyTransform();
  }

  function destroy() {
    running = false; if (raf) cancelAnimationFrame(raf); raf = null;
    document.removeEventListener('visibilitychange', onVis);
    svg.remove();
  }

  return { setData, fitAll, zoomBy, destroy };
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
