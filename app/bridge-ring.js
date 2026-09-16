/* ═══════════════════════════════════════════════════════════════
   BRIDGE RING — l'anneau autour de ce que l'assistant touche
   ───────────────────────────────────────────────────────────────
   Seule pièce visuelle conservée de Kora (abandonnée le 16/09/2026) :
   quand une action du Pont s'exécute dans l'onglet (bridge-actions.js),
   l'élément ciblé reçoit un liseré de 1 px parcouru d'une comète.
   C'est de la confiance par transparence — on voit OÙ ça agit.
   Module autoporté : injecte son propre style, aucun état global hors
   la carte des anneaux posés. Les anneaux suivent leur cible (scroll,
   resize, réorganisation) tant qu'il en reste au moins un.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const CSS = `
.bridge-ringbox{
  position:fixed; z-index:100000; pointer-events:none; padding:1px;
  --bridge-a:0deg; --bridge-1:#ff40ad; --bridge-2:#21d1ff;
  background:conic-gradient(from var(--bridge-a), var(--bridge-1), var(--bridge-2) 30%, transparent 55%, transparent 78%, var(--bridge-1));
  -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite:xor; mask-composite:exclude;
  animation:bridge-spin 1.5s linear infinite;
  filter:drop-shadow(0 0 4px var(--bridge-1));
}
@property --bridge-a { syntax:'<angle>'; inherits:false; initial-value:0deg; }
@keyframes bridge-spin { to { --bridge-a:360deg; } }
`;

const _ringed = new Map();   // cible → calque .bridge-ringbox
let _styled = false, _raf = 0;

function _ensureStyle() {
  if (_styled || typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.id = 'bridge-ring-style';
  st.textContent = CSS;
  document.head.appendChild(st);
  _styled = true;
}
function _place(el, box) {
  const r = el.getBoundingClientRect();
  const rad = parseFloat(getComputedStyle(el).borderRadius) || 8;
  box.style.left = (r.left - 3) + 'px';
  box.style.top = (r.top - 3) + 'px';
  box.style.width = (r.width + 6) + 'px';
  box.style.height = (r.height + 6) + 'px';
  box.style.borderRadius = (rad + 3) + 'px';
}
function _follow() {
  _raf = 0;
  for (const [el, box] of _ringed) {
    if (!el.isConnected) { box.remove(); _ringed.delete(el); continue; }
    _place(el, box);
  }
  if (_ringed.size) _raf = requestAnimationFrame(_follow);
}

/** Pose un anneau sur `target` (sélecteur ou élément). Renvoie l'élément ou null. */
export function bridgeRing(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || _ringed.has(el)) return el || null;
  _ensureStyle();
  const box = document.createElement('div');
  box.className = 'bridge-ringbox';
  document.body.appendChild(box);
  _place(el, box);
  _ringed.set(el, box);
  if (!_raf) _raf = requestAnimationFrame(_follow);
  return el;
}
/** Retire l'anneau d'une cible. */
export function bridgeUnring(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const box = el ? _ringed.get(el) : null;
  if (box) box.remove();
  if (el) _ringed.delete(el);
}
/** Retire tous les anneaux. */
export function bridgeClearRings() {
  for (const box of _ringed.values()) box.remove();
  _ringed.clear();
}
