/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Chronomètre d'ESSAI (pill SVG outline, 7 segments)
   ───────────────────────────────────────────────────────────────
   Descendant direct du chronomètre du mode « Démo Limited » (21/05,
   retiré le 25/07 avec ce mode). La différence qui compte : ici la
   source de vérité est la DATE SERVEUR de la licence (`expires_at`,
   posée depuis l'Admin — essai de 7 jours d'une licence « à date »),
   pas un décompte local posé au premier lancement. Pas de date → pas
   de pill : une licence sans échéance n'a rien à décompter.

   Cadran outline gradué sur 7 segments (un par jour). Les segments
   écoulés sont éteints, les restants allumés. Couleur selon le reste :
     ≥ 3 jours → indigo (var(--gold))      — calme
     1-2 jours → ambre #f59e0b             — ça approche
     0         → rouge (var(--danger))     — terminé (pulse)

   Inséré dans .hero-meta, au-dessus de l'heure, par ui-renderer.js ;
   rafraîchi toutes les 30 s avec l'horloge du bandeau.
   ═══════════════════════════════════════════════════════════════ */

const VIEW_BOX_SIZE = 32;
const CENTER        = 16;
const RADIUS        = 13;
const SEGMENT_COUNT = 7;
const GAP_DEG       = 6;   // dégagement visuel entre segments
const DAY_MS        = 86_400_000;

// ── Jours restants à partir de la date serveur ───────────────────
// `expires_at` vaut soit un jour seul ('2026-08-26' = minuit UTC ce
// jour-là, le format que pose l'Admin), soit un ISO complet. Le serveur
// ferme dès que `new Date(expires_at) < new Date()` : on compte donc en
// jours ENTAMÉS jusqu'à cet instant précis (3 h restantes = « 1 j »),
// pour ne jamais afficher « 0 » alors que l'accès est encore ouvert.
//   → null si pas de date ou date illisible (= pas de pill).
export function daysLeftUntil(expiresAt, now = Date.now()) {
    if (!expiresAt) return null;
    const t = new Date(expiresAt).getTime();
    if (!Number.isFinite(t)) return null;
    const left = t - now;
    if (left <= 0) return 0;
    return Math.ceil(left / DAY_MS);
}

// Libellé humain de la fin : « jusqu'au mardi 25 août » — la veille
// civile de la coupure quand elle tombe à minuit UTC (cas de l'Admin),
// sinon le jour même de l'ISO complet.
export function trialEndLabel(expiresAt) {
    if (!expiresAt) return '';
    const t = new Date(expiresAt);
    if (!Number.isFinite(t.getTime())) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(expiresAt).trim())
        ? new Date(t.getTime() - DAY_MS)
        : t;
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Géométrie SVG ─────────────────────────────────────────────────
function _polarToCart(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;   // 0° = midi, sens horaire
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function _arcPath(cx, cy, r, startDeg, endDeg) {
    const start = _polarToCart(cx, cy, r, endDeg);
    const end   = _polarToCart(cx, cy, r, startDeg);
    const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}
function _segmentSvg(dayIndex) {
    const segSize = 360 / SEGMENT_COUNT;
    const start   = dayIndex * segSize + GAP_DEG / 2;
    const end     = (dayIndex + 1) * segSize - GAP_DEG / 2;
    return `<path data-day="${dayIndex + 1}" d="${_arcPath(CENTER, CENTER, RADIUS, start, end)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />`;
}

// ── État ──────────────────────────────────────────────────────────
function _colorFor(daysLeft) {
    if (daysLeft <= 0) return 'var(--danger, #e05c5c)';
    if (daysLeft <= 2) return '#f59e0b';
    return 'var(--gold, #6c6cf5)';
}
function _stateClass(daysLeft) {
    if (daysLeft <= 0) return 'ks-trial-chrono--expired';
    if (daysLeft <= 2) return 'ks-trial-chrono--urgent';
    return 'ks-trial-chrono--zen';
}
function _daysText(daysLeft) {
    return daysLeft > 0 ? `${daysLeft} j` : 'terminé';
}
function _title(daysLeft, expiresAt, clickable = false) {
    const fin = trialEndLabel(expiresAt);
    const suite = clickable ? ' · cliquer pour s\'abonner' : '';
    if (daysLeft <= 0) return `Période d'essai terminée${suite}`;
    const reste = `il reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`;
    return `Période d'essai · ${reste}${fin ? ` — jusqu'au ${fin}` : ''}${suite}`;
}

// ═══════════════════════════════════════════════════════════════
// renderTrialChrono({ expiresAt, clickable }) → HTML, ou '' s'il n'y a
// rien à décompter (pas de date / date illisible).
// `clickable` : la pill devient un bouton (curseur, focus clavier) — c'est
// l'appelant qui branche le clic (vers Réglages → Ma Licence, où vit le
// bouton « S'abonner »).
// ═══════════════════════════════════════════════════════════════
export function renderTrialChrono({ expiresAt, clickable = false } = {}) {
    const daysLeft = daysLeftUntil(expiresAt);
    if (daysLeft === null) return '';

    let segments = '';
    for (let i = 0; i < SEGMENT_COUNT; i++) segments += _segmentSvg(i);
    // Segments éteints = jours écoulés sur un cadran de 7 (un essai plus
    // long reste « plein » jusqu'à entrer dans sa dernière semaine).
    const elapsed = Math.max(0, SEGMENT_COUNT - Math.min(SEGMENT_COUNT, daysLeft));
    const title   = _title(daysLeft, expiresAt, clickable);

    return `
    <div class="ks-trial-chrono ${_stateClass(daysLeft)}"
         data-days-left="${daysLeft}"
         data-elapsed-count="${elapsed}"
         ${clickable ? 'data-clickable="true" tabindex="0" role="button"' : 'role="img"'}
         style="color:${_colorFor(daysLeft)}"
         title="${title}"
         aria-label="${title}">
      <svg class="ks-trial-chrono-svg" viewBox="0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}" width="14" height="14" fill="none" aria-hidden="true">
        <circle cx="${CENTER}" cy="${CENTER}" r="${RADIUS}" stroke="currentColor" stroke-opacity="0.12" stroke-width="1" fill="none" />
        <circle cx="${CENTER}" cy="${CENTER}" r="0.8" fill="currentColor" opacity="0.55" />
        ${segments}
      </svg>
      <span class="ks-trial-chrono-label">
        <span class="ks-trial-chrono-tag">Essai</span>
        <span class="ks-trial-chrono-days">${_daysText(daysLeft)}</span>
      </span>
    </div>`;
}

// Rafraîchit un chrono déjà dans le DOM sans le reconstruire (garde les
// transitions). Si la date a disparu (l'essai est devenu un abonnement),
// le retire.
export function refreshTrialChrono(rootEl, { expiresAt } = {}) {
    if (!rootEl) return;
    const daysLeft = daysLeftUntil(expiresAt);
    if (daysLeft === null) { rootEl.remove(); return; }
    rootEl.dataset.daysLeft     = daysLeft;
    rootEl.dataset.elapsedCount = Math.max(0, SEGMENT_COUNT - Math.min(SEGMENT_COUNT, daysLeft));
    rootEl.style.color = _colorFor(daysLeft);
    rootEl.classList.remove('ks-trial-chrono--zen', 'ks-trial-chrono--urgent', 'ks-trial-chrono--expired');
    rootEl.classList.add(_stateClass(daysLeft));
    rootEl.title = _title(daysLeft, expiresAt, rootEl.dataset.clickable === 'true');
    rootEl.setAttribute('aria-label', rootEl.title);
    const daysEl = rootEl.querySelector('.ks-trial-chrono-days');
    if (daysEl) daysEl.textContent = _daysText(daysLeft);
}

// ═══════════════════════════════════════════════════════════════
// CSS — injecté une fois par ui-renderer (pas de feuille dédiée pour
// un composant qui n'apparaît que sur les licences à date).
// ═══════════════════════════════════════════════════════════════
const _elapsedRules = (() => {
    // data-elapsed-count="n" → les n derniers segments (7, 6, …) éteints
    let css = '';
    for (let n = 1; n <= SEGMENT_COUNT; n++) {
        const sel = [];
        for (let d = SEGMENT_COUNT - n + 1; d <= SEGMENT_COUNT; d++) {
            sel.push(`.ks-trial-chrono[data-elapsed-count="${n}"] .ks-trial-chrono-svg path[data-day="${d}"]`);
        }
        css += `${sel.join(',\n')} { opacity: 0.18; }\n`;
    }
    return css;
})();

export const TRIAL_CHRONO_CSS = `
/* ── Chronomètre d'essai (pill du bandeau) ─────────────────────── */
.ks-trial-chrono {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 9px;
  margin-bottom: 8px;
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
.hero-meta .ks-trial-chrono { flex: 0 0 auto; align-self: flex-end; }
.ks-trial-chrono-svg { flex: 0 0 auto; width: 14px; height: 14px; transition: opacity 220ms ease; }
.ks-trial-chrono-svg path[data-day] { transition: opacity 360ms ease; }
${_elapsedRules}
.ks-trial-chrono-label { display: inline-flex; align-items: baseline; gap: 5px; font-weight: 500; }
.ks-trial-chrono-tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.75; }
.ks-trial-chrono-days { font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 600; }
.ks-trial-chrono--urgent,
.ks-trial-chrono--expired { animation: ks-trial-chrono-pulse 2.4s ease-in-out infinite; }
@keyframes ks-trial-chrono-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.78; }
}
.ks-trial-chrono--expired .ks-trial-chrono-days { text-decoration: line-through; opacity: 0.8; }
/* Cliquable (mène au bouton « S'abonner » des Réglages) */
.ks-trial-chrono[data-clickable="true"] { cursor: pointer; }
.ks-trial-chrono[data-clickable="true"]:hover,
.ks-trial-chrono[data-clickable="true"]:focus-visible { background: color-mix(in srgb, currentColor 16%, transparent); outline: none; }
@media (prefers-reduced-motion: reduce) {
  .ks-trial-chrono--urgent, .ks-trial-chrono--expired { animation: none; }
}
`;
