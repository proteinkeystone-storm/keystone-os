/* ═══════════════════════════════════════════════════════════════
   KORA — la surface de l'agent-OS (étage 1 : pastille · étage 2 :
   anneaux · étage 3 : fenêtre). KORA_BRIEF §3/§8 + Annexe A/B.

   · Design VERROUILLÉ : shader et réglages extraits verbatim des
     harnais _design-lab/kora-galet-*.html (validés + gate iPhone OK).
     Ne pas « améliorer » sans validation.
   · Chargé UNIQUEMENT derrière le flag localStorage ks_kora_enabled='1'
     (cf. main.js) — dormant pour tout le monde tant que non activé.
   · Isolation stricte kora_ / .kora-* ; un pad n'apprend rien de Kora.
   · Ce module est la SURFACE : la boucle LLM (catalogue kora-actions.js)
     s'y branchera — koraSay/koraState/koraRing sont son langage.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const KORA_CSS_V = '8';   /* bumper à CHAQUE modif de kora.css (piège cache connu) */

/* ── Shader (verbatim harnais kora-galet-morph.html) ── */
const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FS = `
precision highp float;
uniform vec2  uRes;
uniform float uT;
uniform vec2  uAB;
uniform float uRad;
uniform float uBand;
uniform float uRimI;
uniform float uHaloI;
uniform float uBloom;
uniform float uPlasma;
uniform float uComet;
uniform float uKnock;
uniform float uLevel;
uniform float uWeave;
uniform vec3  uTintA;
uniform vec3  uTintB;
uniform vec3  uTintC;
uniform float uDim;
uniform vec3  uLay;
uniform float uSharp;
uniform float uWhite;

float sdBox(vec2 pp, vec2 b, float r){
  vec2 d = abs(pp) - b + vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / (0.5*min(uRes.x, uRes.y));
  float f = sdBox(uv, uAB, min(uRad, uAB.y));
  vec3 col = vec3(0.0);

  if (f < 0.01) {
    float hb = max(uAB.y * uBand, 1e-3);
    float yc = -uAB.y * (1.0 - uBand);
    vec2 q = vec2(uv.x / uAB.x, (uv.y - yc) / hb);
    float bandMask = smoothstep(1.25, 0.92, abs(q.y));
    float t = uT;
    float aa = mix(0.12, 0.018, uSharp);
    float fr = mix(1.0, 0.62, uWeave);
    float voiced = mix(1.0, 0.25 + 0.85*uLevel, clamp(uLevel*8.0, 0.0, 1.0));
    float amp = uPlasma * 1.9 * voiced * (1.0 + uKnock*0.35);

    float x = q.x, y = q.y;
    vec3 acc = vec3(0.0);
    float axAtt = smoothstep(0.015, 0.13, abs(y));
    float fine = clamp(uLevel*1.4, 0.0, 1.0);
    float kf = mix(1.0, 6.0, fine);
    float bw = mix(1.0, 0.22, fine);
    float cg = mix(1.0, 1.8, fine);
    vec3 cC = uTintC;

    { float c1 = 0.75*sin(t*0.33);
      float env = 0.16 + 0.62*exp(-pow((x - c1)*1.8, 2.0)) + 0.30*exp(-pow((x + c1*0.7)*2.4, 2.0));
      float yi = amp * uLay.x * env * sin(2.2*3.14159*x*fr + 1.0*t);
      float dyy = abs(y) - abs(yi);
      acc += uTintA * (smoothstep(aa, -aa*0.5, dyy)*0.72*bw + exp(-dyy*dyy*140.0*kf)*0.55*cg*axAtt); }
    { float c1 = 0.75*sin(t*0.41 + 2.1);
      float env = 0.14 + 0.58*exp(-pow((x - c1)*2.1, 2.0)) + 0.26*exp(-pow((x + c1*0.6)*2.6, 2.0));
      float yi = amp * uLay.y * env * sin(3.1*3.14159*x*fr - 1.25*t);
      float dyy = abs(y) - abs(yi);
      acc += uTintB * (smoothstep(aa, -aa*0.5, dyy)*0.68*bw + exp(-dyy*dyy*150.0*kf)*0.50*cg*axAtt); }
    { float c1 = 0.7*sin(t*0.27 + 4.2);
      float env = 0.15 + 0.55*exp(-pow((x - c1)*1.6, 2.0));
      float yi = amp * uLay.z * env * sin(1.7*3.14159*x*fr + 0.8*t);
      float dyy = abs(y) - abs(yi);
      acc += cC * (smoothstep(aa, -aa*0.5, dyy)*0.66*bw + exp(-dyy*dyy*130.0*kf)*0.50*cg*axAtt); }
    { float c1 = 0.65*sin(t*0.37 + 1.3);
      float env = 0.12 + 0.50*exp(-pow((x - c1)*2.2, 2.0));
      float yi = amp * (uLay.x + uLay.y)*0.42*uWhite * env * sin(2.6*3.14159*x*fr - 0.55*t);
      float dyy = abs(y) - abs(yi);
      acc += vec3(0.93,0.95,1.0) * (smoothstep(aa, -aa*0.5, dyy)*0.15*bw + exp(-dyy*dyy*160.0*kf)*0.25*cg*axAtt); }

    acc += mix(uTintA, vec3(1.0), 0.10 + 0.22*uWhite) * exp(-y*y*1600.0) * 0.14;
    float lum = dot(acc, vec3(0.35));
    acc += vec3(1.0) * smoothstep(1.35, 2.4, lum) * 0.4 * (0.2 + 0.8*uWhite);
    float lu = dot(acc, vec3(0.299, 0.587, 0.114));
    acc = clamp(mix(vec3(lu), acc, 1.35), 0.0, 4.0);
    vec3 inner = acc / (1.0 + acc*0.30);
    float inside = smoothstep(0.006, -0.02, f);
    col += max(inner, 0.0) * inside * bandMask;
  }

  float rimLine = smoothstep(0.014, 0.002, abs(f));
  float rimSoft = exp(-abs(f)*30.0);
  float topLight = 0.6 + 0.4 * clamp(-uv.y*1.2 + 0.3, 0.0, 1.0);
  vec3 rimCol = uTintB*0.6 + vec3(0.65, 0.65, 0.95)*0.4;
  col += rimCol * (rimLine*0.9 + rimSoft*0.18) * uRimI * topLight;
  col += rimCol * exp(-abs(f)*7.0) * 0.05 * uHaloI * step(0.0, f);
  col += vec3(1.0, 0.82, 0.42) * (rimLine + rimSoft*0.3) * uKnock * 1.2;

  if (uComet > 0.001) {
    float aF = atan(uv.y/max(uAB.y, 1e-3), uv.x/max(uAB.x, 1e-3));
    float aC = mod(uT*1.35, 6.28318) - 3.14159;
    float da = abs(atan(sin(aF-aC), cos(aF-aC)));
    float trail = exp(-da*4.0) + 0.45*exp(-abs(atan(sin(aF-aC-0.7), cos(aF-aC-0.7)))*6.0);
    col += mix(uTintB, vec3(1.0), 0.55) * exp(-abs(f)*24.0) * trail * 2.0 * uComet;
  }

  col *= uDim;
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/* ── États gravés (Annexe A — ne pas retoucher sans validation) ── */
const R_A=[0.49,0.42,0.94], R_B=[0.29,0.49,0.96], R_C=[0.63,0.42,0.96],
      E_A=[0.10,0.88,0.62], E_B=[0.30,0.95,0.45], E_C=[0.15,0.75,0.85],
      F_A=[0.54,0.36,0.94], F_B=[0.35,0.42,0.96], F_C=[0.78,0.42,0.88],
      T_A=[1.0,0.25,0.68],  T_B=[0.13,0.82,1.0],  T_C=[0.25,0.94,0.63],
      B_A=[0.94,0.16,0.10], B_B=[1.0,0.36,0.14],  B_C=[1.0,0.62,0.30];

const STATES = {
  repos:     { n:4.0,  ratio:2.50, speed:1.65, bloom:0.55, plasma:0.33, comet:0, level:0, weave:0,   knock:0, dim:0.95, A:R_A, B:R_B, C:R_C, white:0.65, breathe:0.45, lay:[0.55,0.35,0.30] },
  ecoute:    { n:2.8,  ratio:1.63, speed:1.15, bloom:0.6,  plasma:0.53, comet:0, level:1, weave:0,   knock:0, dim:1.0,  A:E_A, B:E_B, C:E_C, white:0.40, breathe:0.12, lay:[1.0,0.9,0.8] },
  reflexion: { n:8.5,  ratio:2.76, speed:1.50, bloom:0.5,  plasma:0.64, comet:0, level:0, weave:1,   knock:0, dim:0.9,  A:F_A, B:F_B, C:F_C, white:0.50, breathe:0.2, lay:[0.65,0.6,0.55] },
  travail:   { n:4.5,  ratio:2.72, speed:2.19, bloom:0.65, plasma:0.43, comet:1, level:0, weave:0.2, knock:0, dim:1.15, A:T_A, B:T_B, C:T_C, white:0.30, breathe:0.06, lay:[0.95,0.85,0.75] },
  besoin:    { n:11.4, ratio:2.57, speed:0.32, bloom:0.7,  plasma:0.34, comet:0, level:0, weave:0,   knock:1, dim:1.05, A:B_A, B:B_B, C:B_C, white:0.20, breathe:0.30, lay:[0.9,0.55,0.35] },
};
const SUBTITLES = {
  repos: 'prête', ecoute: 'à l’écoute…', reflexion: 'je réfléchis…',
  travail: 'je travaille…', besoin: 'besoin de toi',
};

/* ── État module ── */
let _inited = false;
let _stateName = 'repos';
let _cur = null;
let _gl = null, _U = null, _cv = null, _dock = null, _panel = null, _sub = null, _log = null, _ccBar = null;
let _radSmooth = 8;
let _simT = 0, _last = 0, _acc = 0;
let _level0 = 0;               // niveau voix (le vocal s'y branchera)
let _ringed = new Map();       // cible → calque .kora-ringbox

function _lerp(a, b, k) { return a + (b - a) * k; }

/* ═══ API publique — le langage de la boucle agent ═══ */

export function koraState(s) {
  if (!STATES[s] || !_inited) return;
  _stateName = s;
  document.body.dataset.koraState = s;
  if (_sub) _sub.textContent = SUBTITLES[s] || '';
}
export function koraOpen() {
  if (!_inited) return;
  _panel.classList.add('kora-open');
  document.body.classList.add('kora-open');   // le dashboard se pousse à gauche
  requestAnimationFrame(() => _panel.classList.add('kora-in'));
}
export function koraClose() {
  if (!_inited) return;
  _panel.classList.remove('kora-in');
  document.body.classList.remove('kora-open');
  setTimeout(() => _panel.classList.remove('kora-open'), 300);
  koraState('repos');
  koraClearRings();
  if (_log) _log.innerHTML = '';
}
export function koraSay(html) {
  if (!_inited || !_log) return null;
  const d = document.createElement('div');
  d.className = 'kora-line';
  d.innerHTML = html;                 // appelant de confiance (la boucle échappe le contenu user/modèle)
  _log.appendChild(d);
  requestAnimationFrame(() => d.classList.add('kora-on'));
  _log.scrollTop = _log.scrollHeight;
  return d;                           // la boucle streame dedans (textContent += chunk)
}
/* Anneaux = calques superposés (les cartes ont overflow:hidden — un
   pseudo-élément serait clippé). Le calque épouse position + rayon
   réels de la cible, ré-alignés à chaque frame par la boucle. */
function _placeRing(el, box) {
  const r = el.getBoundingClientRect();
  const rad = (parseFloat(getComputedStyle(el).borderRadius) || 12) + 3;
  box.style.left = (r.left - 3) + 'px';
  box.style.top = (r.top - 3) + 'px';
  box.style.width = (r.width + 6) + 'px';
  box.style.height = (r.height + 6) + 'px';
  box.style.borderRadius = rad + 'px';
}
export function koraRing(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || _ringed.has(el)) return el || null;
  const box = document.createElement('div');
  box.className = 'kora-ringbox';
  document.body.appendChild(box);
  _placeRing(el, box);
  _ringed.set(el, box);
  return el;
}
export function koraUnring(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const box = el ? _ringed.get(el) : null;
  if (box) box.remove();
  if (el) _ringed.delete(el);
}
export function koraClearRings() {
  for (const box of _ringed.values()) box.remove();
  _ringed.clear();
}

/* Démo du cycle de vie (validation en app réelle, via console : kora.demo()) */
export async function koraDemo() {
  if (!_inited) return;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const card = document.querySelector('.pad-card');
  koraOpen();
  koraState('ecoute');            await wait(2200);
  koraState('reflexion');
  koraSay('Je regarde où tu en es sur ce tableau de bord.');
  if (card) koraRing(card);       await wait(2600);
  koraState('travail');
  koraSay('▸ Lecture du catalogue d’actions — 15 lectures disponibles.');
  await wait(2600);
  koraState('besoin');
  koraSay('<b>À toi :</b> c’est ici que je m’arrêterai pour te laisser trancher.');
  await wait(3600);
  koraClearRings();
  koraState('repos');
}

/* ═══ Init ═══ */
export function initKora() {
  if (_inited) return;
  const bar = document.querySelector('.cc-bar');
  if (!bar) return;
  _ccBar = bar;   // port d'attache du dock quand aucun outil n'est ouvert

  /* feuille de style dédiée, chargée à la demande (aucune trace si flag off) */
  if (!document.getElementById('kora-css')) {
    const link = document.createElement('link');
    link.id = 'kora-css'; link.rel = 'stylesheet';
    link.href = './app/kora.css?v=' + KORA_CSS_V;
    document.head.appendChild(link);
  }

  /* étage 1 : la pastille, dernier bouton de la cc-bar */
  _dock = document.createElement('div');
  _dock.className = 'kora-dock kora-mini';
  _dock.title = 'Kora';
  bar.appendChild(_dock);

  _cv = document.createElement('canvas');
  _cv.className = 'kora-canvas';
  document.body.appendChild(_cv);

  /* étage 3 : la fenêtre sobre */
  _panel = document.createElement('div');
  _panel.className = 'kora-panel';
  _panel.innerHTML = `
    <div class="kora-head">
      <div class="kora-title">K O R A</div>
      <div class="kora-sub"></div>
    </div>
    <div class="kora-log"></div>`;
  document.body.appendChild(_panel);
  _sub = _panel.querySelector('.kora-sub');
  _log = _panel.querySelector('.kora-log');

  /* WebGL */
  _gl = _cv.getContext('webgl', { alpha: true, premultipliedAlpha: true });
  if (!_gl) { _dock.remove(); _cv.remove(); _panel.remove(); return; }
  const sh = (type, src) => {
    const s = _gl.createShader(type); _gl.shaderSource(s, src); _gl.compileShader(s);
    if (!_gl.getShaderParameter(s, _gl.COMPILE_STATUS)) throw new Error(_gl.getShaderInfoLog(s));
    return s;
  };
  const prog = _gl.createProgram();
  _gl.attachShader(prog, sh(_gl.VERTEX_SHADER, VS));
  _gl.attachShader(prog, sh(_gl.FRAGMENT_SHADER, FS));
  _gl.linkProgram(prog); _gl.useProgram(prog);
  const buf = _gl.createBuffer();
  _gl.bindBuffer(_gl.ARRAY_BUFFER, buf);
  _gl.bufferData(_gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), _gl.STATIC_DRAW);
  const locP = _gl.getAttribLocation(prog, 'p');
  _gl.enableVertexAttribArray(locP); _gl.vertexAttribPointer(locP, 2, _gl.FLOAT, false, 0, 0);
  _U = {};
  for (const n of ['uRes','uT','uAB','uRad','uBand','uRimI','uHaloI','uBloom','uPlasma','uComet','uKnock','uLevel','uWeave','uTintA','uTintB','uTintC','uDim','uLay','uSharp','uWhite'])
    _U[n] = _gl.getUniformLocation(prog, n);
  _gl.clearColor(0,0,0,0); _gl.enable(_gl.BLEND); _gl.blendFunc(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);

  _cur = Object.assign({}, STATES.repos,
    { A:[...STATES.repos.A], B:[...STATES.repos.B], C:[...STATES.repos.C], lay:[...STATES.repos.lay] });

  /* tap = ouvrir / ranger (le dock est un vrai bouton partout —
     cc-bar du dashboard ou .ws-topbar-actions des outils) */
  _dock.addEventListener('click', () =>
    _panel.classList.contains('kora-open') ? koraClose() : koraOpen());
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && _panel.classList.contains('kora-open')) koraClose();
  });

  document.body.dataset.koraState = 'repos';
  _sub.textContent = SUBTITLES.repos;
  _inited = true;
  _last = performance.now();
  requestAnimationFrame(_frame);

  /* la boucle conversationnelle (decide/answer + catalogue lecture) */
  import('./kora-loop.js').then(m => m.initKoraLoop(_panel))
    .catch(e => console.warn('[kora] boucle indisponible', e));

  /* accès console pour la validation (pas une API produit) */
  window.kora = { state: koraState, open: koraOpen, close: koraClose,
                  say: koraSay, ring: koraRing, unring: koraUnring,
                  clearRings: koraClearRings, demo: koraDemo };
}

/* ═══ Boucle de rendu — veille énergie gravée (30 fps repos, pause si
   onglet caché via rAF, dpr ≤ 2) ═══ */
const DPR = Math.min(devicePixelRatio || 1, 2);
function _frame(now) {
  if (!_inited) return;
  requestAnimationFrame(_frame);
  const dt = Math.min((now - _last) / 1000, 0.1); _last = now;

  const open = _panel.classList.contains('kora-open');
  const resting = _stateName === 'repos' && !open;
  _acc += dt;
  if (resting && _acc < 1/30) return;          // veille : 30 fps suffisent à respirer
  const step = _acc; _acc = 0;

  /* Kora s'efface : économiseur (nos z-index OS passeraient au-dessus
     du lock) ET K-Store (surface boutique, aucune action Kora là — le
     galet y flottait orphelin, retour Stéphane 18/07).
     ⚠ ces overlays vivent dans le DOM éteints : tester la classe
     d'activation, jamais la présence (leçon lockfix). */
  const locked = !!document.querySelector('#ks-lockscreen.ls-visible, #ks-fullscreen.open');
  _cv.style.visibility = locked ? 'hidden' : 'visible';
  if (locked && _panel.classList.contains('kora-open')) koraClose();

  /* MÊME ergonomie partout (retour Stéphane 18/07) : quand un outil
     plein écran est ouvert, le dock est PHYSIQUEMENT déplacé dans son
     header (.ws-topbar-actions, commun à tous les workspaces) — vrai
     bouton, mêmes dimensions que ses voisins, l'extension les pousse
     par le flex. Outil fermé → retour dans la cc-bar. Visibilité
     RÉELLE testée (les overlays restent dans le DOM éteints). */
  const toolbars = [...document.querySelectorAll('.ws-topbar-actions, .sdqr-topbar-right')]
    .filter(el => el.getBoundingClientRect().width > 0);
  const host = toolbars.length ? toolbars[toolbars.length - 1] : _ccBar;
  if (host && _dock.parentElement !== host) {
    host.appendChild(_dock);
    /* changement de contexte (dashboard ↔ outil, outil ↔ outil) : la
       fenêtre ouverte se RANGE au lieu de se superposer au nouveau
       décor (faille trouvée par Stéphane 18/07) */
    if (_panel.classList.contains('kora-open')) koraClose();
  }
  /* dans un outil, la fenêtre prend sa variante pleine colonne
     (sinon la zone libérée révèle le dashboard sous-jacent) */
  document.body.classList.toggle('kora-in-tool', host !== _ccBar);

  _dock.classList.toggle('kora-mini', resting);

  /* les anneaux suivent leur cible (scroll, resize, réorganisation) */
  for (const [el, box] of _ringed) {
    if (!el.isConnected) { box.remove(); _ringed.delete(el); continue; }
    _placeRing(el, box);
  }

  const target = STATES[_stateName];
  const k = 1 - Math.exp(-step * 3.2);
  for (const p of ['n','ratio','speed','bloom','plasma','comet','level','weave','knock','dim','breathe','white'])
    _cur[p] = _lerp(_cur[p], target[p], k);
  for (let i = 0; i < 3; i++) {
    _cur.A[i] = _lerp(_cur.A[i], target.A[i], k);
    _cur.B[i] = _lerp(_cur.B[i], target.B[i], k);
    _cur.C[i] = _lerp(_cur.C[i], target.C[i], k);
    _cur.lay[i] = _lerp(_cur.lay[i], target.lay[i], k);
  }

  _simT += step * _cur.speed;
  const knock = _cur.knock * (0.30 + 0.70 * Math.max(0, Math.sin(_simT*2.6)) * Math.max(0, Math.sin(_simT*1.3)));
  const level = _cur.level * (_level0 > 0.001 ? (0.08 + 0.92*_level0)
                                              : (0.35 + 0.65*Math.abs(Math.sin(_simT*2.1)*Math.sin(_simT*0.83))));
  const breathe = Math.sin(_simT*0.8) * _cur.breathe + knock * 0.35;

  /* le canvas épouse le dock, où qu'il vive (cc-bar ou header d'outil) */
  const r = _dock.getBoundingClientRect();
  const pad = 14;
  _cv.style.left = (r.left - pad) + 'px'; _cv.style.top = (r.top - pad) + 'px';
  const W = Math.max(2, r.width + pad*2), H = Math.max(2, r.height + pad*2);
  _cv.style.width = W + 'px'; _cv.style.height = H + 'px';
  const rw = Math.round(W * DPR), rh = Math.round(H * DPR);
  if (_cv.width !== rw || _cv.height !== rh) { _cv.width = rw; _cv.height = rh; }
  _gl.viewport(0, 0, _cv.width, _cv.height);

  /* largeur stable, l'ARRONDI porte l'état (formule gravée, adaptée h 26px) */
  const mn = Math.min(W, H);
  const abx = 0.94 * r.width / mn, aby = 0.94 * r.height / mn;
  const isMini = _dock.classList.contains('kora-mini');
  const radTarget = isMini ? 8 + breathe * 1.2
                           : Math.max(3, 13 - (Math.max(2, _cur.n + breathe) - 2) * 1.1);
  _radSmooth += (radTarget - _radSmooth) * (1 - Math.exp(-step * 8));

  _gl.clear(_gl.COLOR_BUFFER_BIT);
  _gl.uniform2f(_U.uRes, _cv.width, _cv.height);
  _gl.uniform1f(_U.uT, _simT);
  _gl.uniform2f(_U.uAB, abx, aby);
  _gl.uniform1f(_U.uRad, 2 * _radSmooth / mn);
  _gl.uniform1f(_U.uBand, 1.0);
  _gl.uniform1f(_U.uRimI, 0.85);
  _gl.uniform1f(_U.uHaloI, 0.4);
  _gl.uniform1f(_U.uBloom, 0);                 /* choix gravé : zéro halo */
  _gl.uniform1f(_U.uPlasma, _cur.plasma);
  _gl.uniform1f(_U.uComet, _cur.comet);
  _gl.uniform1f(_U.uKnock, knock);
  _gl.uniform1f(_U.uLevel, level);
  _gl.uniform1f(_U.uWeave, _cur.weave);
  _gl.uniform1f(_U.uDim, _cur.dim);
  _gl.uniform3fv(_U.uTintA, _cur.A);
  _gl.uniform3fv(_U.uTintB, _cur.B);
  _gl.uniform3fv(_U.uTintC, _cur.C);
  _gl.uniform3fv(_U.uLay, _cur.lay);
  _gl.uniform1f(_U.uSharp, 1.0);               /* choix gravé : net max */
  _gl.uniform1f(_U.uWhite, _cur.white);
  _gl.drawArrays(_gl.TRIANGLES, 0, 3);
}
