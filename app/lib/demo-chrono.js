/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Chronomètre Démo (composant SVG outline)
   ───────────────────────────────────────────────────────────────
   Cadran circulaire outline gradué sur 7 segments (un par jour).
   Les segments "écoulés" sont fade-out, les "restants" sont actifs.

   Style cohérent ui-icons.js :
     stroke 1.5px, linecap round, no fill, currentColor par défaut.

   Couleur dynamique selon jours restants :
     7-3 jours  → var(--accent) doré            (zen)
     2-1 jours  → #f59e0b amber                 (warning)
     0 jour     → #ef4444 red                   (expired, animation pulse)

   Inséré dans .hero-meta à côté de #hero-time / #hero-date.
   Re-rendu toutes les 30 s en même temps que l'horloge hero.
   ═══════════════════════════════════════════════════════════════ */

import { getDemoState } from './demo-mode.js';

const VIEW_BOX_SIZE = 32;
const CENTER = 16;
const RADIUS = 13;
const SEGMENT_COUNT = 7;
const GAP_DEG = 6; // dégagement visuel entre segments

// Convertit (cx, cy, r, angleDeg) → point cartésien (x, y)
// 0° = 12 h (top), sens horaire.
function _polarToCart(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

// Construit un arc SVG path entre deux angles (degrés)
function _arcPath(cx, cy, r, startDeg, endDeg) {
  const start = _polarToCart(cx, cy, r, endDeg);
  const end   = _polarToCart(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

// Génère le HTML d'un segment d'arc avec data attributes pour le styling
function _segmentSvg(dayIndex, totalSeg, gap) {
  // Jour 1 = top right (0°-51.4°), Jour 7 = top left (jour le plus ancien)
  // En réalité on commence à 12h (top) et tourne dans le sens horaire.
  const segSize = 360 / totalSeg;
  const start   = dayIndex * segSize + gap / 2;
  const end     = (dayIndex + 1) * segSize - gap / 2;
  const d       = _arcPath(CENTER, CENTER, RADIUS, start, end);
  return `<path data-day="${dayIndex + 1}" d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`;
}

// ─── Couleur dynamique selon jours restants ─────────────────────
function _colorForDaysLeft(daysLeft) {
  if (daysLeft <= 0) return 'var(--ks-demo-danger, #ef4444)';
  if (daysLeft <= 2) return 'var(--ks-demo-warning, #f59e0b)';
  return 'var(--accent, #c9a96e)';
}

// ─── État sémantique pour CSS hooks (animation pulse, etc.) ─────
function _stateClass(daysLeft) {
  if (daysLeft <= 0) return 'ks-demo-chrono--expired';
  if (daysLeft <= 2) return 'ks-demo-chrono--urgent';
  return 'ks-demo-chrono--zen';
}

// ═══════════════════════════════════════════════════════════════
// renderDemoChrono — retourne le HTML du composant
// ───────────────────────────────────────────────────────────────
// Si pas en mode démo → retourne chaîne vide (composant absent du DOM).
// ═══════════════════════════════════════════════════════════════
export function renderDemoChrono() {
  const state = getDemoState();
  if (!state.isDemo) return '';

  const daysLeft = state.daysLeft;
  const color    = _colorForDaysLeft(daysLeft);
  const cssClass = _stateClass(daysLeft);

  // Génère les 7 segments
  let segments = '';
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments += _segmentSvg(i, SEGMENT_COUNT, GAP_DEG);
  }

  // Le segment "actif" est le plus haut numéro de jour restant
  // (ex : 5 jours restants → segments 1..5 actifs, 6..7 éteints)
  // CSS gère l'opacity via [data-elapsed="true"] attribute set ci-dessous
  const elapsedCount = SEGMENT_COUNT - daysLeft;

  // Label texte
  const label = daysLeft > 0
    ? `${daysLeft}j`
    : 'expiré';

  return `
    <div class="ks-demo-chrono ${cssClass}"
         data-days-left="${daysLeft}"
         data-elapsed-count="${elapsedCount}"
         style="color:${color}"
         title="Démo ${state.durationDays} jours · ${daysLeft > 0 ? `il reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''}` : 'expirée — choisissez un plan'}"
         role="img"
         aria-label="Chronomètre démo, ${daysLeft} jours restants">
      <svg class="ks-demo-chrono-svg"
           viewBox="0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}"
           width="22" height="22"
           fill="none"
           aria-hidden="true">
        <!-- Cercle fond très subtil (cadran complet) -->
        <circle cx="${CENTER}" cy="${CENTER}" r="${RADIUS}"
                stroke="currentColor"
                stroke-opacity="0.12"
                stroke-width="1"
                fill="none" />
        <!-- Petit point central -->
        <circle cx="${CENTER}" cy="${CENTER}" r="0.8"
                fill="currentColor"
                opacity="0.55" />
        <!-- 7 segments d'arc -->
        ${segments}
      </svg>
      <span class="ks-demo-chrono-label">
        <span class="ks-demo-chrono-tag">Démo</span>
        <span class="ks-demo-chrono-days">${label}</span>
      </span>
    </div>
  `;
}

// Met à jour les attributs data-elapsed des segments depuis JS pur
// (utilisé si le composant existe déjà dans le DOM et qu'on veut
// le rafraîchir sans innerHTML — évite de casser les transitions).
export function refreshDemoChrono(rootEl) {
  if (!rootEl) return;
  const state = getDemoState();
  if (!state.isDemo) {
    rootEl.remove();
    return;
  }
  const daysLeft = state.daysLeft;
  rootEl.dataset.daysLeft = daysLeft;
  rootEl.dataset.elapsedCount = SEGMENT_COUNT - daysLeft;
  rootEl.style.color = _colorForDaysLeft(daysLeft);
  rootEl.classList.remove('ks-demo-chrono--zen', 'ks-demo-chrono--urgent', 'ks-demo-chrono--expired');
  rootEl.classList.add(_stateClass(daysLeft));
  const daysEl = rootEl.querySelector('.ks-demo-chrono-days');
  if (daysEl) daysEl.textContent = daysLeft > 0 ? `${daysLeft}j` : 'expiré';
}

// ═══════════════════════════════════════════════════════════════
// CSS — à injecter dans style.css (ou via <style> inline si besoin)
// Exporté en tant que constante au cas où on veut l'inliner.
// ═══════════════════════════════════════════════════════════════
export const DEMO_CHRONO_CSS = `
/* ── Chronomètre démo (Sprint Démo A+B) ─────────────────────── */
/* Cible : largeur ≤ #hero-time (~81px en HH:MM, font 28px) pour ne
   jamais déborder visuellement de l'heure dans .hero-meta. */
.ks-demo-chrono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;                 /* très compact */
  padding: 4px 8px;         /* serré horizontal pour rentrer sous 81px */
  margin-bottom: 8px;       /* respiration vs heure */
  margin-left: auto;
  min-width: 0;
  border-radius: 999px;
  border: 1px solid currentColor;
  background: color-mix(in srgb, currentColor 8%, transparent);
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  user-select: none;
  cursor: default;
  transition: color 220ms ease, background 220ms ease, border-color 220ms ease;
}
/* Quand dans .hero-meta : pousse à droite + bornée à la largeur de l'heure */
.hero-meta .ks-demo-chrono {
  flex: 0 0 auto;
  align-self: flex-end;
  max-width: 81px;          /* exactement la largeur de l'heure HH:MM (font 28px) */
}
/* SVG compact pour tenir dans la pill ≤ 81px */
.ks-demo-chrono-svg {
  width: 14px !important;
  height: 14px !important;
}
.ks-demo-chrono-tag {
  font-size: 9px;           /* "DÉMO" en petite caps */
  letter-spacing: 0.08em;
  opacity: 0.75;
}
.ks-demo-chrono-days {
  font-size: 11px;
}
.ks-demo-chrono-svg {
  flex: 0 0 auto;
  transition: opacity 220ms ease;
}
.ks-demo-chrono-svg path[data-day] {
  transition: opacity 360ms ease;
}
/* Les segments écoulés sont éteints */
.ks-demo-chrono[data-elapsed-count="0"] .ks-demo-chrono-svg path[data-day] { opacity: 1; }
.ks-demo-chrono[data-elapsed-count="1"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="2"] .ks-demo-chrono-svg path[data-day="6"],
.ks-demo-chrono[data-elapsed-count="2"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="3"] .ks-demo-chrono-svg path[data-day="5"],
.ks-demo-chrono[data-elapsed-count="3"] .ks-demo-chrono-svg path[data-day="6"],
.ks-demo-chrono[data-elapsed-count="3"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="4"] .ks-demo-chrono-svg path[data-day="4"],
.ks-demo-chrono[data-elapsed-count="4"] .ks-demo-chrono-svg path[data-day="5"],
.ks-demo-chrono[data-elapsed-count="4"] .ks-demo-chrono-svg path[data-day="6"],
.ks-demo-chrono[data-elapsed-count="4"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="5"] .ks-demo-chrono-svg path[data-day="3"],
.ks-demo-chrono[data-elapsed-count="5"] .ks-demo-chrono-svg path[data-day="4"],
.ks-demo-chrono[data-elapsed-count="5"] .ks-demo-chrono-svg path[data-day="5"],
.ks-demo-chrono[data-elapsed-count="5"] .ks-demo-chrono-svg path[data-day="6"],
.ks-demo-chrono[data-elapsed-count="5"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="2"],
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="3"],
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="4"],
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="5"],
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="6"],
.ks-demo-chrono[data-elapsed-count="6"] .ks-demo-chrono-svg path[data-day="7"] { opacity: 0.18; }
.ks-demo-chrono[data-elapsed-count="7"] .ks-demo-chrono-svg path[data-day] { opacity: 0.18; }

.ks-demo-chrono-label {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-weight: 500;
}
.ks-demo-chrono-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.75;
}
.ks-demo-chrono-days {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

/* Pulse animation quand urgent (1-2j) ou expiré */
.ks-demo-chrono--urgent,
.ks-demo-chrono--expired {
  animation: ks-demo-chrono-pulse 2.4s ease-in-out infinite;
}
@keyframes ks-demo-chrono-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.78; }
}

/* Expiré : style barré / dimmed sur le label */
.ks-demo-chrono--expired .ks-demo-chrono-days {
  text-decoration: line-through;
  opacity: 0.8;
}

/* Click target pour ouvrir la modale plans (S5 le wire) */
.ks-demo-chrono[data-clickable="true"] { cursor: pointer; }
.ks-demo-chrono[data-clickable="true"]:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
`;
