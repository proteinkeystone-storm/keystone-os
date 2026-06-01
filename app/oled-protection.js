// ═══════════════════════════════════════════════════════════════
// KEYSTONE OS — Protection & Maintenance OLED · v1.0 (2026-06-01)
// ───────────────────────────────────────────────────────────────
// Réduit le risque de marquage (burn-in) sur écrans OLED en
// répartissant l'usure de l'écran de veille :
//   • on déplace TRÈS lentement (imperceptiblement) le bloc central
//     (heure + date + logo + aide) autour de sa position ;
//   • en option, on joue une séquence de maintenance multi-phases.
//
//   ⚠️ Ne répare pas / ne régénère pas les pixels. Répartit l'usure.
//   ⚠️ Sur écran non-OLED : purement cosmétique (aucun mal, peu d'effet).
//
// PERFORMANCE — tout passe par transform / opacity / filter (GPU) :
//   • Décalage Standard / Renforcé  → animations CSS pures (0 JS/frame)
//   • Bruit animé                   → texture SVG turbulence tuilée
//                                      translatée (PAS de canvas par frame)
//   • Le JS ne fait qu'orchestrer des attributs + quelques timers.
//
// RÉGLAGES (localStorage) :
//   ks_oled_mode        'off' | 'standard' | 'reinforced'   (déf. 'standard')
//   ks_oled_maint_auto  '1' | '0'  maintenance nocturne auto (déf. '0' — OFF)
//   ks_oled_maint_hour  '0'..'23'  heure de lancement nocturne (déf. '3')
//   ks_reduce_motion    '1' | '0'  réduire les animations    (déf. '0')
//
// La « carte d'usure » (usageMap) de la spec est volontairement
// reportée (marquée optionnelle, ROI faible en v1).
// ═══════════════════════════════════════════════════════════════

const K_MODE   = 'ks_oled_mode';
const K_AUTO   = 'ks_oled_maint_auto';
const K_HOUR   = 'ks_oled_maint_hour';
const K_REDUCE = 'ks_reduce_motion';

// Durées de maintenance (ms) — calées sur la spec (bornes basses raisonnables).
// Total ≈ 40 min. Centralisées ici pour réglage facile / futurs paramètres avancés.
const PHASES_DEFAULT = [
  { name: 'wash',      ms: 5  * 60000 }, // Phase 1 — Pixel Wash
  { name: 'static',    ms: 6000 },       // Phase 2 — Détune TV : neige TV FORTE, plein écran
  // 'noise' (Bruit Animé Faible, sombre) retiré 2026-06-01 : Stéphane voulait une
  // vraie neige TV bien visible, pas un quasi-noir → la phase 'static' EST le bruit.
  // Réactivable en 1 ligne (élément .oled-noise + son CSS conservés, dormants).
  { name: 'gradients', ms: 10 * 60000 }, // Phase 3 — Balayage des gradients
  { name: 'orbit',     ms: 15 * 60000 }, // Phase 4 — Orbite accélérée
];

// Phase 1 — aplats de couleur (fondu entre chacun via transition CSS).
const WASH_COLORS  = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#404040', '#808080', '#bfbfbf'];
const WASH_STEP_MS = 4000; // 2–5 s par état (fondu compris)

let _overlay     = null;
let _maintActive = false;
let _timers      = [];     // setTimeout des phases en cours
let _washTimer   = null;
let _staticTimer = null;   // Détune TV (neige)
let _autoChecker = null;
let _autoRanOn   = null;   // 'YYYY-MM-DD' du dernier lancement auto (anti-doublon)
let _demoTimer   = null;   // aperçu « Voir l'effet »

// ── Helpers ─────────────────────────────────────────────────────
function _reduceMotion() {
  if (localStorage.getItem(K_REDUCE) === '1') return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

function _effectiveMode() {
  let m = localStorage.getItem(K_MODE) || 'standard';
  if (m !== 'off' && m !== 'standard' && m !== 'reinforced') m = 'standard';
  if (_reduceMotion() && m === 'reinforced') m = 'standard'; // reduce → jamais renforcé
  return m;
}

// ── Cycle de vie (appelé par lockscreen.js) ─────────────────────
export function start(overlay) {
  _overlay = overlay;
  applySettings();
  _startAutoChecker();
}

export function stop() {
  _abortMaintenance();
  _stopAutoChecker();
  _endPreview();
  if (_overlay) {
    _overlay.removeAttribute('data-oled');
    _overlay.removeAttribute('data-oled-reduce');
    _overlay.removeAttribute('data-maint');
  }
  _overlay = null;
}

/** (Re)lit les réglages et applique le mode de décalage. */
export function applySettings() {
  if (!_overlay || _maintActive) return; // ne pas écraser pendant la maintenance
  _overlay.dataset.oled       = _effectiveMode();           // 'off'|'standard'|'reinforced'
  _overlay.dataset.oledReduce = _reduceMotion() ? '1' : '0';
}

// ── Maintenance ─────────────────────────────────────────────────
/**
 * Lance la séquence de maintenance.
 * @param {object} opts { manual?:bool, force?:bool, phases?:Array }
 *   force/manual : permet de lancer même sous "réduire les animations".
 *   phases       : surcharge des durées (utile pour tests/démo).
 */
export function runMaintenance(opts = {}) {
  if (!_overlay || _maintActive) return;
  if (_reduceMotion() && !opts.force && !opts.manual) return; // pas d'auto sous reduce-motion

  const phases = Array.isArray(opts.phases) && opts.phases.length ? opts.phases : PHASES_DEFAULT;
  _maintActive = true;
  _buildMaintLayers();
  _runPhase(phases, 0);
}

export function isMaintenanceActive() { return _maintActive; }

// ── Aperçu « Voir l'effet » ─────────────────────────────────────
// La vraie protection étant imperceptible (par conception), ce mode
// joue une version VOLONTAIREMENT exagérée et rapide pendant ~10 s
// (déplacement large + respiration lumineuse + légende), puis revient
// au réglage réel. Sert à démontrer la fonction à soi / aux clients.
export function previewEffect(opts = {}) {
  if (!_overlay || _maintActive) return;
  const ms = opts.ms || 10000;
  let cap = _overlay.querySelector('.oled-demo-caption');
  if (!cap) {
    cap = document.createElement('div');
    cap.className = 'oled-demo-caption';
    _overlay.appendChild(cap);
  }
  cap.textContent = 'Aperçu accéléré (~×15) — en usage réel, le mouvement est imperceptible';
  _overlay.dataset.oledDemo = '1';
  clearTimeout(_demoTimer);
  _demoTimer = setTimeout(_endPreview, ms);
}

function _endPreview() {
  clearTimeout(_demoTimer);
  _demoTimer = null;
  if (!_overlay) return;
  _overlay.removeAttribute('data-oled-demo');
  _overlay.querySelector('.oled-demo-caption')?.remove();
}

function _buildMaintLayers() {
  if (!_overlay || _overlay.querySelector('.oled-maint-layer')) return;
  const layer = document.createElement('div');
  layer.className = 'oled-maint-layer';
  layer.innerHTML =
    '<div class="oled-wash"></div>' +
    '<div class="oled-noise"></div>' +
    '<canvas class="oled-static" width="256" height="144"></canvas>' +
    '<div class="oled-static-roll"></div>';
  _overlay.appendChild(layer);
}

function _runPhase(phases, i) {
  if (!_maintActive || !_overlay) return;
  if (i >= phases.length) { _finishMaintenance(); return; } // Phase 5 — retour Standard
  const ph = phases[i];
  _overlay.dataset.maint = ph.name;
  _enterPhase(ph.name);
  const t = setTimeout(() => {
    _exitPhase(ph.name);
    _runPhase(phases, i + 1);
  }, ph.ms);
  _timers.push(t);
}

function _enterPhase(name) {
  if (name === 'wash')   _startWash();
  if (name === 'static') _startStatic();
}
function _exitPhase(name) {
  if (name === 'wash')   _stopWash();
  if (name === 'static') _stopStatic();
}

function _startWash() {
  const el = _overlay?.querySelector('.oled-wash');
  if (!el) return;
  let i = 0;
  const tick = () => {
    el.style.backgroundColor = WASH_COLORS[i % WASH_COLORS.length];
    i++;
    _washTimer = setTimeout(tick, WASH_STEP_MS);
  };
  tick();
}
function _stopWash() { clearTimeout(_washTimer); _washTimer = null; }

// Phase « Détune TV » : neige TV PLEIN CONTRASTE re-tirée à ~20 fps sur un petit
// canvas étiré plein écran (CSS pixelated) — gris 0..255 + ~12 % de grésil coloré
// (look analogique) + roll de synchro CSS. Court (~6 s), après les couleurs.
// (Pas de flash plein champ → reste sûr : neige spatiale, pas un strobe.)
function _startStatic() {
  const cv = _overlay?.querySelector('.oled-static');
  const ctx = cv?.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const draw = () => {
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.random() < 0.12) {                 // ~12 % : grésil coloré
        d[i]     = (Math.random() * 255) | 0;
        d[i + 1] = (Math.random() * 255) | 0;
        d[i + 2] = (Math.random() * 255) | 0;
      } else {                                     // sinon neige grise plein contraste
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    _staticTimer = setTimeout(draw, 50);          // ~20 fps (neige vive)
  };
  draw();
}
function _stopStatic() { clearTimeout(_staticTimer); _staticTimer = null; }

function _finishMaintenance() {
  _maintActive = false;
  _stopWash();
  _stopStatic();
  if (_overlay) {
    _overlay.removeAttribute('data-maint');
    _overlay.querySelector('.oled-maint-layer')?.remove();
  }
  applySettings(); // Phase 5 — reprise du décalage Standard
}

function _abortMaintenance() {
  _timers.forEach(clearTimeout);
  _timers = [];
  _stopWash();
  _stopStatic();
  if (_maintActive) _finishMaintenance();
  _maintActive = false;
}

// ── Auto-maintenance nocturne (OFF par défaut, bridée secteur) ──
function _startAutoChecker() {
  _stopAutoChecker();
  _autoChecker = setInterval(_autoTick, 5 * 60000); // vérif toutes les 5 min
  _autoTick();
}
function _stopAutoChecker() { clearInterval(_autoChecker); _autoChecker = null; }

async function _autoTick() {
  if (!_overlay || _maintActive) return;
  if (localStorage.getItem(K_AUTO) !== '1') return;
  if (_reduceMotion()) return;
  const hour = parseInt(localStorage.getItem(K_HOUR) || '3', 10);
  const now  = new Date();
  if (now.getHours() !== hour) return;
  const today = now.toISOString().slice(0, 10);
  if (_autoRanOn === today) return;          // déjà lancé cette nuit
  if (!(await _onPower())) return;           // jamais sur batterie
  _autoRanOn = today;
  runMaintenance();
}

async function _onPower() {
  try {
    if (!navigator.getBattery) return true;  // API absente → on suppose secteur
    const b = await navigator.getBattery();
    return b.charging === true;
  } catch (_) { return true; }
}

// Objet pratique (utilisé par lockscreen.js).
export const OledProtection = {
  start, stop, applySettings, runMaintenance, isMaintenanceActive, previewEffect,
};
