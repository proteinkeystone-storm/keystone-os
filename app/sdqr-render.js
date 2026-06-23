/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SDQR Custom Renderer (Sprint SDQR-3)
   Moteur de rendu SVG custom : on n'utilise plus createSvgTag() de
   qrcode-generator (rendu monolithique noir/blanc). À la place, on
   itère sur les modules via isDark(row, col) et on dessine nous-même
   chaque cellule selon le design demandé.

   Pourquoi du SVG natif vs canvas ?
     - SVG = vecteur → export print propre (impression bâche, carte)
     - Pas de blur sur retina, scaling parfait
     - On peut animer (hover preview...) sans repaint

   Design schema (stocké dans qr.design) :
     {
       module : { shape: 'square' | 'dot' | 'rounded' },
       anchor : { shape: 'square' | 'dot' | 'rounded' },
       fg     : '#000000',                    // couleur principale
       bg     : '#ffffff',                    // fond ('transparent' = pas de rect)
       gradient: {
         enabled: false,
         from   : '#1B2A4A',
         to     : '#c9a84c',
         angle  : 45                          // degrés (0 = →, 90 = ↓)
       },
       logo   : {
         dataUrl: 'data:image/png;base64,...',
         size   : 0.20                        // ratio du QR (15-25%)
       }
     }
   ═══════════════════════════════════════════════════════════════ */

const QR_CDN = 'https://esm.sh/qrcode-generator@1.4.4';
let _qrLib = null;

async function _loadQrLib() {
  if (_qrLib) return _qrLib;
  const mod = await import(QR_CDN);
  _qrLib = mod.default || mod;
  return _qrLib;
}

// ── Design par défaut (utilisé si l'entité n'a rien de spécifique) ──
// SDQR-3.1 : anchor scindé en `outer` (anneau) + `inner` (centre) pour
// permettre des combinaisons custom (ex: anneau arrondi + centre point).
export const DEFAULT_DESIGN = {
  module : { shape: 'square' },
  anchor : {
    outer: { shape: 'square' },
    inner: { shape: 'square' },
  },
  fg     : '#000000',
  bg     : '#ffffff',
  gradient: { enabled: false, from: '#1B2A4A', to: '#6366f1', angle: 45 },
  logo   : { dataUrl: '', size: 0.20 },
  // SDQR-3.3 — cadre/accroche AUTOUR du QR (le code reste intact, zone de
  // silence préservée → aucune incidence sur la scannabilité).
  frame  : { style: 'none', text: 'Scannez-moi', color: '#1B2A4A' },
  // SDQR-3.4 — couleur d'ACCENT des yeux (finder patterns), distincte des
  // modules. distinct=false → les yeux héritent de la couleur des modules.
  // La signature Keystone = modules navy + yeux or. NB : l'or de marque vif
  // (#c9a84c, ~2:1 sur blanc) casse la détection en petit format (mesuré jsQR
  // à 170px) → on prend un or plus PROFOND #b08d2e qui lit « or » ET décode
  // partout. Le garde-fou de contraste avertit si l'accent choisi est trop clair.
  // SDQR-3.9 — innerColor = pupille (2-tons). Vide → la pupille hérite de color
  // (mono-ton), donc les anciens QR restent identiques.
  eye    : { distinct: false, color: '#b08d2e', innerColor: '' },
};

// Merge sûr : si design est partial (depuis D1), on complète avec DEFAULT.
// Compat retro : ancien format `anchor: { shape: '...' }` est splitté
// automatiquement en outer + inner identiques.
export function mergeDesign(design) {
  const d = design || {};
  const a = d.anchor || {};
  const legacyShape = a.shape;            // ancien format SDQR-3 initial
  return {
    module  : { ...DEFAULT_DESIGN.module,   ...(d.module   || {}) },
    anchor  : {
      outer: { shape: a.outer?.shape || legacyShape || 'square' },
      inner: { shape: a.inner?.shape || legacyShape || 'square' },
    },
    fg      : d.fg || DEFAULT_DESIGN.fg,
    bg      : d.bg || DEFAULT_DESIGN.bg,
    gradient: { ...DEFAULT_DESIGN.gradient, ...(d.gradient || {}) },
    logo    : { ...DEFAULT_DESIGN.logo,     ...(d.logo     || {}) },
    frame   : { ...DEFAULT_DESIGN.frame,    ...(d.frame    || {}) },
    eye     : { ...DEFAULT_DESIGN.eye,      ...(d.eye      || {}) },
  };
}

// ── Cadres (frame + accroche) — dessinés AUTOUR du QR ──────────
// Catalogue des styles : chacun déclare l'espace réservé (pad autour,
// bandeau haut/bas) puis dessine bord + accroche. Le QR garde sa zone de
// silence intégrale → la scannabilité n'est pas affectée (prouvé jsQR).
// 5 styles, tous prouvés scannables (jsQR, banc _design-lab/sdqr/frames.html).
// Le « ticket » (bord pointillé) a été ÉCARTÉ : les tirets perturbent la
// détection jsQR malgré une zone de silence généreuse → non garanti.
export const FRAME_OPTS = [
  { id: 'none',    label: 'Aucun' },
  { id: 'label',   label: 'Bandeau' },
  { id: 'border',  label: 'Encadré' },
  { id: 'badge',   label: 'Pastille' },
  { id: 'header',  label: 'Bandeau haut' },
  // SDQR-3.9 — cadres « pleins » : une PLAQUE BLANCHE sous le QR conserve la
  // zone de silence → le QR reste foncé sur blanc, scannable, même cerné de
  // foncé (prouvé jsQR aux 2 tailles, banc scan-candidates.html).
  { id: 'circle',  label: 'Cercle' },
  { id: 'plaque',  label: 'Plaque' },
  { id: 'corners', label: 'Crochets' },
  { id: 'ring',    label: 'Anneau' },
];

// Renvoie { padX, padTop, padBottom, deco(boxX,boxY,qrSize) } pour un style.
// deco() reçoit la position du QR dans le canevas final et rend le décor SVG.
function _frameGeometry(style, qrSize, color, text) {
  const esc = _esc;
  const band = Math.round(qrSize * 0.17);          // hauteur du bandeau d'accroche
  const gap  = Math.round(qrSize * 0.05);          // marge blanche autour du QR
  const fs   = Math.max(11, Math.round(qrSize * 0.072));
  const label = esc((text || '').trim() || 'Scannez-moi');
  const tw = n => n.toFixed(2);

  // SDQR-3.9 — plaque blanche (zone de silence) sous le QR, indispensable aux
  // cadres à fond foncé : le QR reste « foncé sur blanc » donc scannable.
  const whitePlaque = (bx, by, s, m) =>
    `<rect x="${tw(bx - m)}" y="${tw(by - m)}" width="${tw(s + 2*m)}" height="${tw(s + 2*m)}" rx="${tw(qrSize*0.05)}" ry="${tw(qrSize*0.05)}" fill="#ffffff"/>`;

  // bandeau plein (texte clair sur couleur) — bas ou haut
  const banner = (x, y, w, h, radiusTop, radiusBottom) => {
    const r = Math.min(h / 2, qrSize * 0.06);
    const rt = radiusTop ? r : 0, rb = radiusBottom ? r : 0;
    return `<path d="M ${tw(x)} ${tw(y + rt)} a ${tw(rt)} ${tw(rt)} 0 0 1 ${tw(rt)} ${tw(-rt)} h ${tw(w - 2*rt)} a ${tw(rt)} ${tw(rt)} 0 0 1 ${tw(rt)} ${tw(rt)} v ${tw(h - rt - rb)} a ${tw(rb)} ${tw(rb)} 0 0 1 ${tw(-rb)} ${tw(rb)} h ${tw(-(w - 2*rb))} a ${tw(rb)} ${tw(rb)} 0 0 1 ${tw(-rb)} ${tw(-rb)} z" fill="${esc(color)}"/>`
         + `<text x="${tw(x + w/2)}" y="${tw(y + h/2)}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#ffffff" letter-spacing="0.5">${label}</text>`;
  };

  switch (style) {
    case 'label':   // QR + bandeau plein dessous (arrondi en bas)
      return { padX: gap, padTop: gap, padBottom: band,
        deco: (bx, by, s, W, H) => banner(bx - gap, by + s + gap*0.4, s + 2*gap, band - gap*0.4, false, true) };
    case 'header':  // bandeau plein au-dessus
      return { padX: gap, padTop: band, padBottom: gap,
        deco: (bx, by, s, W, H) => banner(bx - gap, gap*0.0, s + 2*gap, band - gap*0.4, true, false) };
    case 'border': { // bord arrondi autour + bandeau plein en bas
      return { padX: gap*1.6, padTop: gap*1.6, padBottom: band,
        deco: (bx, by, s, W, H) => {
          const m = gap*0.6, r = qrSize*0.08;
          const bw = s + 2*(gap*1.6) - 2*m, bh = s + (gap*1.6) + band - 2*m;
          return `<rect x="${tw(m)}" y="${tw(m)}" width="${tw(bw)}" height="${tw(bh)}" rx="${tw(r)}" ry="${tw(r)}" fill="none" stroke="${esc(color)}" stroke-width="${tw(qrSize*0.018)}"/>`
               + banner(bx - gap*0.5, by + s + gap*0.5, s + gap, band - gap*0.9, true, true);
        } };
    }
    case 'badge': { // accroche dans une pastille avec flèche vers le QR
      // padBottom élargi : la pastille (flèche + corps) tient sans être rognée.
      return { padX: gap, padTop: gap, padBottom: Math.round(band * 1.35),
        deco: (bx, by, s, W, H) => {
          const pw = Math.min(s, qrSize*0.66), ph = band*0.82;
          const px = bx + (s - pw)/2, py = by + s + gap*0.9;
          const r = ph/2;
          const ar = qrSize*0.035;   // flèche
          return `<path d="M ${tw(bx + s/2 - ar)} ${tw(py)} L ${tw(bx + s/2)} ${tw(py - ar)} L ${tw(bx + s/2 + ar)} ${tw(py)} z" fill="${esc(color)}"/>`
               + `<rect x="${tw(px)}" y="${tw(py)}" width="${tw(pw)}" height="${tw(ph)}" rx="${tw(r)}" ry="${tw(r)}" fill="${esc(color)}"/>`
               + `<text x="${tw(px + pw/2)}" y="${tw(py + ph/2)}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="#ffffff" letter-spacing="0.5">${label}</text>`;
        } };
    }
    // SDQR-3.9 — cadres pleins (plaque blanche = zone de silence préservée).
    case 'circle': {   // disque plein, QR COMPACT + respiration, accroche dessous (réf. cap3)
      const padX = Math.round(qrSize*0.44), padTop = Math.round(qrSize*0.32), padBottom = Math.round(qrSize*0.58);
      return { padX, padTop, padBottom,
        back: (bx, by, s, W, H) => {
          const R = Math.max(W, H)/2;
          return `<circle cx="${tw(W/2)}" cy="${tw(H/2)}" r="${tw(R)}" fill="${esc(color)}"/>` + whitePlaque(bx, by, s, gap*0.7);
        },
        deco: (bx, by, s, W, H) => {
          const ty = by + s + (H - (by + s))/2;
          return `<text x="${tw(W/2)}" y="${tw(ty)}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${tw(fs*1.2)}" font-weight="800" fill="#ffffff" letter-spacing="2">${label}</text>`;
        } };
    }
    case 'plaque': {   // plaque arrondie foncée + QR sur plaque blanche + bandeau bas
      const padX = Math.round(qrSize*0.12), padBottom = Math.round(qrSize*0.12) + band;
      return { padX, padTop: padX, padBottom,
        back: (bx, by, s, W, H) => {
          const r = qrSize*0.10;
          return `<rect x="0" y="0" width="${tw(W)}" height="${tw(H)}" rx="${tw(r)}" ry="${tw(r)}" fill="${esc(color)}"/>` + whitePlaque(bx, by, s, gap);
        },
        deco: (bx, by, s, W, H) => {
          const ty = by + s + (H - (by + s))/2;
          return `<text x="${tw(W/2)}" y="${tw(ty)}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${fs}" font-weight="800" fill="#ffffff" letter-spacing="1">${label}</text>`;
        } };
    }
    case 'corners': {  // cercle FIN contour + crochets viseur ARRONDIS + « SCAN ME » courbe bas + arcs (réf. Modèle Cadre)
      const padX = Math.round(qrSize*0.40), padTop = Math.round(qrSize*0.40), padBottom = Math.round(qrSize*0.40);
      const pid = 'fr_arc_' + Math.random().toString(36).slice(2, 8);
      return { padX, padTop, padBottom,
        back: (bx, by, s, W, H) => {
          const R = qrSize*0.82;
          return `<circle cx="${tw(W/2)}" cy="${tw(H/2)}" r="${tw(R)}" fill="none" stroke="${esc(color)}" stroke-width="${tw(qrSize*0.012)}"/>`;
        },
        deco: (bx, by, s, W, H) => {
          const cx = W/2, cy = H/2;
          // crochets viseur à coins ARRONDIS autour du QR (couleur du cadre, sur blanc).
          const sw = qrSize*0.018, arm = qrSize*0.10, rad = qrSize*0.045, m = gap*1.3;
          const x0 = bx - m, y0 = by - m, x1 = bx + s + m, y1 = by + s + m;
          const L = (px, py, dx, dy) => `<path d="M ${tw(px)} ${tw(py + dy*arm)} L ${tw(px)} ${tw(py + dy*rad)} Q ${tw(px)} ${tw(py)} ${tw(px + dx*rad)} ${tw(py)} L ${tw(px + dx*arm)} ${tw(py)}" fill="none" stroke="${esc(color)}" stroke-width="${tw(sw)}" stroke-linecap="round"/>`;
          const brackets = L(x0,y0,1,1) + L(x1,y0,-1,1) + L(x0,y1,1,-1) + L(x1,y1,-1,-1);
          // 2 arcs « cible » sur les diagonales du HAUT (le bas est réservé au texte).
          const Ra = qrSize*0.70;
          const arcSeg = (a) => { const a1=a-0.34, a2=a+0.34; return `<path d="M ${tw(cx+Ra*Math.cos(a1))} ${tw(cy+Ra*Math.sin(a1))} A ${tw(Ra)} ${tw(Ra)} 0 0 1 ${tw(cx+Ra*Math.cos(a2))} ${tw(cy+Ra*Math.sin(a2))}" fill="none" stroke="${esc(color)}" stroke-width="${tw(qrSize*0.013)}" stroke-linecap="round"/>`; };
          const arcs = arcSeg(5*Math.PI/4) + arcSeg(7*Math.PI/4);
          // « SCAN ME » courbe en bas (arc, sweep=0).
          const Rt = qrSize*0.755;
          const arc = `M ${tw(cx - Rt)} ${tw(cy)} A ${tw(Rt)} ${tw(Rt)} 0 0 0 ${tw(cx + Rt)} ${tw(cy)}`;
          const txt = `<path id="${pid}" d="${arc}" fill="none"/><text font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${tw(fs*0.9)}" font-weight="700" fill="${esc(color)}" letter-spacing="3"><textPath href="#${pid}" xlink:href="#${pid}" startOffset="50%" text-anchor="middle">${label}</textPath></text>`;
          return brackets + arcs + txt;
        } };
    }
    case 'ring': {     // double anneau FIN (sans remplissage) + accroche COURBE dans la gouttière (réf. cap5)
      const padX = Math.round(qrSize*0.40), padTop = Math.round(qrSize*0.40), padBottom = Math.round(qrSize*0.40);
      const pid = 'fr_arc_' + Math.random().toString(36).slice(2, 8);
      // R2 (anneau intérieur) ≈ coins du carré blanc du QR (0.707) → ils le TOUCHENT.
      // R1 (anneau extérieur) laisse une marge depuis le bord du canevas → pas rogné.
      const ringGeom = () => {
        const R2 = qrSize * 0.71;
        const R1 = qrSize * 0.82;
        return { R1, R2, Rt: (R1 + R2)/2 };
      };
      return { padX, padTop, padBottom,
        back: (bx, by, s, W, H) => {
          const { R1, R2 } = ringGeom(), sw = qrSize*0.013;
          return `<circle cx="${tw(W/2)}" cy="${tw(H/2)}" r="${tw(R1)}" fill="none" stroke="${esc(color)}" stroke-width="${tw(sw)}"/>`
            + `<circle cx="${tw(W/2)}" cy="${tw(H/2)}" r="${tw(R2)}" fill="none" stroke="${esc(color)}" stroke-width="${tw(sw)}"/>`;
        },
        deco: (bx, by, s, W, H) => {
          const { Rt } = ringGeom();
          // arc BAS (sweep=0), texte sombre dans la gouttière entre les 2 anneaux.
          const arc = `M ${tw(W/2 - Rt)} ${tw(H/2)} A ${tw(Rt)} ${tw(Rt)} 0 0 0 ${tw(W/2 + Rt)} ${tw(H/2)}`;
          return `<path id="${pid}" d="${arc}" fill="none"/>`
            + `<text font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="${tw(fs*0.92)}" font-weight="700" fill="${esc(color)}" letter-spacing="4"><textPath href="#${pid}" xlink:href="#${pid}" startOffset="50%" text-anchor="middle">${label}</textPath></text>`;
        } };
    }
    default:
      return null;
  }
}

// ── SDQR-3.10 — CADRES SUR-MESURE (SVG importé) ────────────────
// Un SVG uploadé = du code. On le NETTOIE (DOMParser) avant tout stockage :
// suppression de <script>, gestionnaires on*, <foreignObject>, <use>, <image>
// externe, <style>, balises d'animation, références externes (http///),
// URI javascript:. Le SVG doit réserver un <rect id="qr-slot"> où le QR
// (foncé sur plaque blanche) sera inséré. Renvoie { ok, svg, slot, vb, error }.
export const CUSTOM_FRAME_MAX_BYTES = 32 * 1024;
const _FRAME_DROP_TAGS = new Set([
  'script', 'foreignobject', 'use', 'image', 'style', 'a', 'iframe', 'object',
  'embed', 'audio', 'video', 'link', 'meta', 'animate', 'animatetransform',
  'animatemotion', 'set', 'handler', 'listener', 'filter',
]);
export function sanitizeFrameSvg(svgText) {
  const fail = (error) => ({ ok: false, error });
  if (typeof svgText !== 'string' || !svgText.trim()) return fail('Fichier vide.');
  if (svgText.length > CUSTOM_FRAME_MAX_BYTES * 2) return fail('SVG trop lourd (max 32 Ko).');
  if (typeof DOMParser === 'undefined') return fail('Environnement sans DOMParser.');
  let doc;
  try { doc = new DOMParser().parseFromString(svgText, 'image/svg+xml'); }
  catch (e) { return fail('SVG illisible.'); }
  if (doc.querySelector('parsererror')) return fail('SVG invalide (erreur de parsing).');
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return fail('Le fichier n\'est pas un SVG.');

  // Nettoie les attributs dangereux d'UN élément (gestionnaires on*, refs
  // externes, URI actives). Appliqué à la racine ET à tous les descendants.
  const cleanAttrs = (el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = (attr.value || '').trim();
      if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        // autorise seulement les ancres internes (#id) et data:image
        if (!/^#/.test(val) && !/^data:image\//i.test(val)) el.removeAttribute(attr.name);
        continue;
      }
      if (/javascript:|data:text\/html|expression\s*\(/i.test(val)) el.removeAttribute(attr.name);
    }
  };
  // Parcours : retire les balises dangereuses, nettoie les attributs (racine incluse).
  const walk = (el) => {
    cleanAttrs(el);
    for (const child of Array.from(el.children)) {
      if (_FRAME_DROP_TAGS.has(child.tagName.toLowerCase())) { child.remove(); continue; }
      walk(child);
    }
  };
  walk(svg);

  // viewBox (sinon width/height)
  let vbW, vbH;
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(n => isFinite(n))) { vbW = vb[2]; vbH = vb[3]; }
  else { vbW = parseFloat(svg.getAttribute('width')); vbH = parseFloat(svg.getAttribute('height')); }
  if (!(vbW > 0) || !(vbH > 0)) return fail('Le SVG doit déclarer un viewBox (ou width/height).');

  // slot QR : élément dont l'id (normalisé) vaut/contient « qr-slot ». Tolérant
  // aux variantes d'export Illustrator (qr_slot, qrslot, « QR Slot », qr-slot_1…).
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let slotEl = null;
  for (const el of svg.querySelectorAll('rect, [id]')) {
    const id = norm(el.getAttribute('id'));
    if (id.includes('qrslot') || id === 'qr' || id === 'slot') { slotEl = el; break; }
  }
  if (!slotEl) return fail('Aucun emplacement trouvé : ajoute un carré nommé « qr-slot » à l\'endroit du QR.');
  const sx = parseFloat(slotEl.getAttribute('x')), sy = parseFloat(slotEl.getAttribute('y'));
  const sw = parseFloat(slotEl.getAttribute('width')), sh = parseFloat(slotEl.getAttribute('height'));
  const w = Math.min(sw || 0, sh || sw || 0);
  if (!(sx >= 0) || !(sy >= 0) || !(w > 0)) return fail('Le carré « qr-slot » doit avoir une position et une taille (rectangle simple).');

  // S'assurer d'un viewBox explicite pour le rendu final.
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  const out = svg.outerHTML;
  if (out.length > CUSTOM_FRAME_MAX_BYTES) return fail('SVG trop lourd après nettoyage (max 32 Ko).');
  // Garde-fou ultime : aucun script/handler ne doit subsister.
  if (/<script|\son\w+\s*=/i.test(out)) return fail('Contenu actif détecté.');
  return { ok: true, svg: out, slot: { x: sx, y: sy, w }, vb: { w: vbW, h: vbH } };
}

// Retire la balise <svg> englobante pour ne garder que le décor intérieur.
function _stripSvgTag(svg) {
  return String(svg || '').replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
}

// ── Détection des 3 finder patterns (ancres) ───────────────────
// Les finder patterns occupent 8x8 modules dans les 3 coins (TL, TR, BL).
// On les identifie par coordonnées pour les exclure du rendu standard
// et leur appliquer la forme `anchor.shape`.
function _isAnchorArea(row, col, count) {
  if (row < 8 && col < 8) return 'tl';                        // top-left
  if (row < 8 && col >= count - 8) return 'tr';               // top-right
  if (row >= count - 8 && col < 8) return 'bl';               // bottom-left
  return null;
}

// Origine (row, col) des 3 finder patterns (chaque ancre = bloc 7x7)
function _anchorOrigins(count) {
  return [
    { row: 0,         col: 0,         which: 'tl' },
    { row: 0,         col: count - 7, which: 'tr' },
    { row: count - 7, col: 0,         which: 'bl' },
  ];
}

// Cellule = un module standard. Retourne le path SVG selon la forme.
// Toutes les formes COUVRENT le centre de la cellule (les scanners
// échantillonnent le centre) → scannabilité préservée (prouvée via jsQR,
// banc _design-lab/sdqr/scan-test.html).
// SDQR-3.9 — `ctx` (optionnel) = voisinage sombre {up,down,left,right} pour les
// formes connectées. Les formes existantes l'ignorent (rétro-compatible).
function _moduleShape(shape, x, y, cell, ctx) {
  const f = n => n.toFixed(2);
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  const x2 = x + cell, y2 = y + cell;
  const up = !!(ctx && ctx.up), dn = !!(ctx && ctx.down);
  const lf = !!(ctx && ctx.left), rt = !!(ctx && ctx.right);
  switch (shape) {
    case 'dot': {
      // cercle inscrit avec léger inset pour aération
      const r = cell * 0.42;
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
    }
    case 'fluid': {
      // SDQR-3.9 — modules CONNECTÉS : carré plein, coins arrondis SEULEMENT
      // là où les deux bords sont libres → couverture >= carré, jamais moins
      // scannable que le défaut (prouvé jsQR aux 2 tailles, 3 styles d'yeux).
      const r = cell * 0.46;
      const rTL = (!up && !lf) ? r : 0, rTR = (!up && !rt) ? r : 0;
      const rBR = (!dn && !rt) ? r : 0, rBL = (!dn && !lf) ? r : 0;
      return `<path d="M ${f(x + rTL)} ${f(y)} H ${f(x2 - rTR)} `
        + (rTR ? `A ${f(rTR)} ${f(rTR)} 0 0 1 ${f(x2)} ${f(y + rTR)} ` : `L ${f(x2)} ${f(y)} `)
        + `V ${f(y2 - rBR)} `
        + (rBR ? `A ${f(rBR)} ${f(rBR)} 0 0 1 ${f(x2 - rBR)} ${f(y2)} ` : `L ${f(x2)} ${f(y2)} `)
        + `H ${f(x + rBL)} `
        + (rBL ? `A ${f(rBL)} ${f(rBL)} 0 0 1 ${f(x)} ${f(y2 - rBL)} ` : `L ${f(x)} ${f(y2)} `)
        + `V ${f(y + rTL)} `
        + (rTL ? `A ${f(rTL)} ${f(rTL)} 0 0 1 ${f(x + rTL)} ${f(y)} ` : `L ${f(x)} ${f(y)} `)
        + `Z"/>`;
    }
    case 'petal': {
      // SDQR-3.9 — pétale : carré à 2 coins opposés très arrondis (TR + BL),
      // les 2 autres vifs → goutte douce. Couvre le centre.
      const r = cell * 0.62;
      return `<path d="M ${f(x)} ${f(y)} H ${f(x2 - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x2)} ${f(y + r)} V ${f(y2)} H ${f(x + r)} A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y2 - r)} Z"/>`;
    }
    case 'circle': {
      // point plein, plus généreux (touche les bords) — couverture max
      const r = cell * 0.5;
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/>`;
    }
    case 'rounded': {
      // arrondi modéré : rx = cell * 0.30
      const rr = f(cell * 0.30);
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(cell)}" height="${f(cell)}" rx="${rr}" ry="${rr}"/>`;
    }
    case 'diamond': {
      // losange inscrit (sommets aux milieux des bords)
      return `<path d="M ${f(cx)} ${f(y)} L ${f(x + cell)} ${f(cy)} L ${f(cx)} ${f(y + cell)} L ${f(x)} ${f(cy)} Z"/>`;
    }
    case 'cross': {
      // croix pleine (deux barres au centre) — centre couvert
      const aw  = cell * 0.52;
      const off = (cell - aw) / 2;
      return `<rect x="${f(x + off)}" y="${f(y)}" width="${f(aw)}" height="${f(cell)}"/>`
           + `<rect x="${f(x)}" y="${f(y + off)}" width="${f(cell)}" height="${f(aw)}"/>`;
    }
    case 'classy': {
      // carré « élégant » : 2 coins opposés vifs, 2 arrondis (look feuille)
      const r = cell * 0.5;
      return `<path d="M ${f(x + r)} ${f(y)} H ${f(x + cell)} V ${f(y + cell - r)} `
           + `A ${f(r)} ${f(r)} 0 0 1 ${f(x + cell - r)} ${f(y + cell)} H ${f(x)} V ${f(y + r)} `
           + `A ${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z"/>`;
    }
    case 'square':
    default:
      return `<rect x="${f(x)}" y="${f(y)}" width="${f(cell)}" height="${f(cell)}"/>`;
  }
}

// Une ancre = 7x7 modules. Composition :
//   - anneau extérieur (7x7 moins le centre 5x5 vide)
//   - centre 3x3 plein (offset 2 modules depuis l'origine)
// outerShape contrôle l'anneau, innerShape contrôle le centre.
// Ils sont indépendants → combinaisons créatives possibles
// (ex: anneau arrondi + centre point = look "viseur").
function _anchorShape(outerShape, innerShape, ox, oy, cell) {
  const size        = 7 * cell;
  const innerOffset = 2 * cell;
  const innerSize   = 3 * cell;
  const cx          = ox + size / 2;
  const cy          = oy + size / 2;
  const innerX      = ox + innerOffset;
  const innerY      = oy + innerOffset;

  // ── Anneau extérieur ──────────────────────────────────────
  let ring = '';
  if (outerShape === 'dot') {
    // Anneau circulaire = disque externe MOINS disque interne (fill-rule)
    const outerR = size / 2 - cell * 0.05;
    const ringR  = size / 2 - cell;
    ring = `<path d="M ${cx.toFixed(2)},${(cy - outerR).toFixed(2)} a ${outerR.toFixed(2)},${outerR.toFixed(2)} 0 1,0 0.1,0 z M ${cx.toFixed(2)},${(cy - ringR).toFixed(2)} a ${ringR.toFixed(2)},${ringR.toFixed(2)} 0 1,1 -0.1,0 z" fill-rule="evenodd"/>`;
  } else if (outerShape === 'rounded') {
    const rr = cell * 1.2;
    const oSide = size - 2 * rr;
    const iRr = cell * 0.7;
    const iSize = size - 2 * cell;
    const iSide = iSize - 2 * iRr;
    const oRect = `M ${ox.toFixed(2)},${(oy + rr).toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${rr.toFixed(2)} -${rr.toFixed(2)} h ${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${rr.toFixed(2)} ${rr.toFixed(2)} v ${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 -${rr.toFixed(2)} ${rr.toFixed(2)} h -${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 -${rr.toFixed(2)} -${rr.toFixed(2)} z`;
    const iRect = `M ${(ox + cell).toFixed(2)},${(oy + cell + iRr).toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 ${iRr.toFixed(2)} -${iRr.toFixed(2)} h ${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 ${iRr.toFixed(2)} ${iRr.toFixed(2)} v ${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 -${iRr.toFixed(2)} ${iRr.toFixed(2)} h -${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 -${iRr.toFixed(2)} -${iRr.toFixed(2)} z`;
    ring = `<path d="${oRect} ${iRect}" fill-rule="evenodd"/>`;
  } else if (outerShape === 'squircle') {
    // SDQR-3.6 — anneau très doux (« Doux ») = rounded à grand rayon.
    const rr = cell * 1.95, oSide = size - 2 * rr;
    const iRr = cell * 1.15, iSize = size - 2 * cell, iSide = iSize - 2 * iRr;
    const oRect = `M ${ox.toFixed(2)},${(oy + rr).toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${rr.toFixed(2)} -${rr.toFixed(2)} h ${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${rr.toFixed(2)} ${rr.toFixed(2)} v ${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 -${rr.toFixed(2)} ${rr.toFixed(2)} h -${oSide.toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 -${rr.toFixed(2)} -${rr.toFixed(2)} z`;
    const iRect = `M ${(ox + cell).toFixed(2)},${(oy + cell + iRr).toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 ${iRr.toFixed(2)} -${iRr.toFixed(2)} h ${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 ${iRr.toFixed(2)} ${iRr.toFixed(2)} v ${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 -${iRr.toFixed(2)} ${iRr.toFixed(2)} h -${iSide.toFixed(2)} a ${iRr.toFixed(2)} ${iRr.toFixed(2)} 0 0 1 -${iRr.toFixed(2)} -${iRr.toFixed(2)} z`;
    ring = `<path d="${oRect} ${iRect}" fill-rule="evenodd"/>`;
  } else if (outerShape === 'leaf') {
    // SDQR-3.6 — anneau « Feuille » : 2 coins opposés vifs (TL, BR), 2 arrondis (TR, BL).
    const rr = cell * 1.8;
    const oPath = `M ${ox.toFixed(2)},${oy.toFixed(2)} h ${(size - rr).toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${rr.toFixed(2)} ${rr.toFixed(2)} v ${(size - rr).toFixed(2)} h ${(-(size - rr)).toFixed(2)} a ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${(-rr).toFixed(2)} ${(-rr).toFixed(2)} z`;
    const m = cell, irr = cell * 1.05, isz = size - 2 * m;
    const iPath = `M ${(ox + m).toFixed(2)},${(oy + m).toFixed(2)} h ${(isz - irr).toFixed(2)} a ${irr.toFixed(2)} ${irr.toFixed(2)} 0 0 1 ${irr.toFixed(2)} ${irr.toFixed(2)} v ${(isz - irr).toFixed(2)} h ${(-(isz - irr)).toFixed(2)} a ${irr.toFixed(2)} ${irr.toFixed(2)} 0 0 1 ${(-irr).toFixed(2)} ${(-irr).toFixed(2)} z`;
    ring = `<path d="${oPath} ${iPath}" fill-rule="evenodd"/>`;
  } else {
    // square (défaut)
    ring = `<path d="M ${ox.toFixed(2)},${oy.toFixed(2)} h ${size.toFixed(2)} v ${size.toFixed(2)} h ${(-size).toFixed(2)} z M ${(ox + cell).toFixed(2)},${(oy + cell).toFixed(2)} v ${(5 * cell).toFixed(2)} h ${(5 * cell).toFixed(2)} v ${(-5 * cell).toFixed(2)} z" fill-rule="evenodd"/>`;
  }

  // ── Centre 3x3 ────────────────────────────────────────────
  let inner = '';
  if (innerShape === 'dot') {
    inner = `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(innerSize / 2).toFixed(2)}"/>`;
  } else if (innerShape === 'rounded') {
    const rr = (cell * 0.55).toFixed(2);
    inner = `<rect x="${innerX.toFixed(2)}" y="${innerY.toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${rr}" ry="${rr}"/>`;
  } else if (innerShape === 'diamond') {
    const r = innerSize / 2;
    inner = `<path d="M ${cx.toFixed(2)} ${(cy - r).toFixed(2)} L ${(cx + r).toFixed(2)} ${cy.toFixed(2)} L ${cx.toFixed(2)} ${(cy + r).toFixed(2)} L ${(cx - r).toFixed(2)} ${cy.toFixed(2)} Z"/>`;
  } else if (innerShape === 'leaf') {
    const r = innerSize * 0.5;
    inner = `<path d="M ${(innerX + r).toFixed(2)} ${innerY.toFixed(2)} H ${(innerX + innerSize).toFixed(2)} V ${(innerY + innerSize - r).toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(innerX + innerSize - r).toFixed(2)} ${(innerY + innerSize).toFixed(2)} H ${innerX.toFixed(2)} V ${(innerY + r).toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(innerX + r).toFixed(2)} ${innerY.toFixed(2)} Z"/>`;
  } else {
    inner = `<rect x="${innerX.toFixed(2)}" y="${innerY.toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}"/>`;
  }

  // SDQR-3.9 — anneau et centre renvoyés SÉPARÉMENT pour la couleur 2-tons
  // (anneau vs pupille). Compat mono-ton : les appelants concatènent ring+inner.
  return { ring, inner };
}

// Mini-aperçu SVG d'un œil (1 finder pattern) pour les cartes du sélecteur.
// SDQR-3.9 — innerColor optionnel (pupille) sinon hérite de color.
export function anchorPreviewSvg(outer, inner, size = 44, color = '#1b2a4a', innerColor) {
  const cell = size / 8;
  const a = _anchorShape(outer, inner, cell, cell, cell);
  const ic = innerColor || color;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><g fill="${color}">${a.ring}</g><g fill="${ic}">${a.inner}</g></svg>`;
}

// ── Rendu principal ────────────────────────────────────────────

export async function renderQrCustom(text, design, sizePx = 280) {
  const qrcode = await _loadQrLib();
  const d = mergeDesign(design);

  // ECC 'H' (highest) si logo central → plus de redondance, scanner OK
  // même si 20% des modules sont occlus.
  const ecc = (d.logo?.dataUrl) ? 'H' : 'M';
  const qr = qrcode(0, ecc);
  qr.addData(text || ' ');
  qr.make();

  const count   = qr.getModuleCount();
  const margin  = 2;                                      // 2 modules de quiet zone
  const totalMods = count + margin * 2;
  const cell    = sizePx / totalMods;
  const offset  = margin * cell;

  // Couleur ou gradient → fill
  const useGradient = d.gradient?.enabled;
  const gradientId  = 'qrgrad_' + Math.random().toString(36).slice(2, 8);
  const fgFill = useGradient ? `url(#${gradientId})` : d.fg;
  // Yeux (finder patterns) : couleur d'accent distincte ou héritée des modules.
  // SDQR-3.9 — 2-tons : anneau = color, pupille = innerColor (sinon hérite de color).
  const eyeOuterFill = d.eye?.distinct ? _esc(d.eye.color || d.fg) : fgFill;
  const eyeInnerFill = d.eye?.distinct ? _esc(d.eye.innerColor || d.eye.color || d.fg) : fgFill;

  // 1. Background
  let bg = '';
  if (d.bg && d.bg !== 'transparent') {
    bg = `<rect width="${sizePx}" height="${sizePx}" fill="${_esc(d.bg)}"/>`;
  }

  // 2. Definitions (gradient + clip pour logo)
  let defs = '';
  if (useGradient) {
    // angle 0 = horizontal (left→right), 90 = vertical (top→bottom)
    const rad = (d.gradient.angle || 45) * Math.PI / 180;
    const x1 = (0.5 - 0.5 * Math.cos(rad)) * 100;
    const y1 = (0.5 - 0.5 * Math.sin(rad)) * 100;
    const x2 = (0.5 + 0.5 * Math.cos(rad)) * 100;
    const y2 = (0.5 + 0.5 * Math.sin(rad)) * 100;
    defs += `
      <linearGradient id="${gradientId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
        <stop offset="0%" stop-color="${_esc(d.gradient.from)}"/>
        <stop offset="100%" stop-color="${_esc(d.gradient.to)}"/>
      </linearGradient>
    `;
  }

  // 3. Modules standards (hors zones d'ancres)
  // Voisinage (forme « fluid ») : un module ne connecte qu'à un AUTRE module
  // standard sombre (jamais vers les ancres, dessinées séparément en yeux).
  const isMod = (r, c) => r >= 0 && c >= 0 && r < count && c < count
    && !_isAnchorArea(r, c, count) && qr.isDark(r, c);
  let modules = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (_isAnchorArea(row, col, count)) continue;
      if (!qr.isDark(row, col)) continue;
      const x = offset + col * cell;
      const y = offset + row * cell;
      const ctx = {
        up: isMod(row - 1, col), down: isMod(row + 1, col),
        left: isMod(row, col - 1), right: isMod(row, col + 1),
      };
      modules += _moduleShape(d.module.shape, x, y, cell, ctx);
    }
  }

  // 4. Ancres (3 finder patterns) — anneau/pupille en groupes SÉPARÉS (2-tons)
  let eyeRings = '', eyeInners = '';
  for (const o of _anchorOrigins(count)) {
    const ox = offset + o.col * cell;
    const oy = offset + o.row * cell;
    const a = _anchorShape(d.anchor.outer.shape, d.anchor.inner.shape, ox, oy, cell);
    eyeRings += a.ring; eyeInners += a.inner;
  }

  // 5. Logo central (avec masque circulaire blanc autour pour contraste scan)
  let logoBlock = '';
  if (d.logo?.dataUrl) {
    const ratio = Math.min(0.30, Math.max(0.10, d.logo.size || 0.20));
    const logoSize = sizePx * ratio;
    const logoMaskSize = logoSize * 1.15;       // 15% de marge blanche autour
    const lx = (sizePx - logoSize) / 2;
    const ly = (sizePx - logoSize) / 2;
    const mx = sizePx / 2;
    const my = sizePx / 2;
    logoBlock = `
      <circle cx="${mx}" cy="${my}" r="${logoMaskSize / 2}" fill="${_esc(d.bg && d.bg !== 'transparent' ? d.bg : '#ffffff')}"/>
      <image href="${_esc(d.logo.dataUrl)}" xlink:href="${_esc(d.logo.dataUrl)}" x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
    `;
  }

  // 6. Cadre / accroche AUTOUR du QR. Le QR (bg + modules + ancres + logo)
  // est placé dans un groupe translaté, sur un canevas agrandi. Sa zone de
  // silence reste intacte → scannabilité préservée (vérifiée jsQR).
  const fr = (d.frame && d.frame.style && d.frame.style !== 'none')
    ? _frameGeometry(d.frame.style, sizePx, d.frame.color || '#1B2A4A', d.frame.text)
    : null;
  const padX      = fr ? fr.padX      : 0;
  const padTop    = fr ? fr.padTop    : 0;
  const padBottom = fr ? fr.padBottom : 0;
  const W = sizePx + 2 * padX;
  const H = sizePx + padTop + padBottom;

  const qrInner = `${bg}<g fill="${fgFill}">${modules}</g><g fill="${eyeOuterFill}">${eyeRings}</g><g fill="${eyeInnerFill}">${eyeInners}</g>${logoBlock}`;

  // SDQR-3.10 — CADRE SUR-MESURE : le SVG importé (déjà sanitizé au stockage)
  // définit le canevas ; on insère le QR (foncé sur plaque blanche) dans son
  // slot. Le QR construit en `sizePx` est mis à l'échelle vers la largeur du slot.
  if (d.frame?.style === 'custom' && d.frame.customSvg && d.frame.customVB && d.frame.customSlot) {
    const vbW = d.frame.customVB.w, vbH = d.frame.customVB.h;
    const slot = d.frame.customSlot;
    const scale = slot.w / sizePx;
    const m = slot.w * 0.05;                         // marge blanche (zone de silence)
    const inner = _stripSvgTag(d.frame.customSvg);
    const plaque = `<rect x="${(slot.x - m).toFixed(2)}" y="${(slot.y - m).toFixed(2)}" width="${(slot.w + 2*m).toFixed(2)}" height="${(slot.w + 2*m).toFixed(2)}" rx="${(slot.w*0.05).toFixed(2)}" ry="${(slot.w*0.05).toFixed(2)}" fill="#ffffff"/>`;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${vbW}" height="${vbH}" viewBox="0 0 ${vbW} ${vbH}">
      ${defs ? `<defs>${defs}</defs>` : ''}
      ${inner}
      ${plaque}
      <g transform="translate(${slot.x.toFixed(2)}, ${slot.y.toFixed(2)}) scale(${scale.toFixed(4)})">${qrInner}</g>
    </svg>`;
  }

  // back() = couche DERRIÈRE le QR (fond foncé + plaque blanche), deco() = devant.
  const back = (fr && fr.back) ? fr.back(padX, padTop, sizePx, W, H) : '';
  const body = fr
    ? `<rect width="${W.toFixed(2)}" height="${H.toFixed(2)}" fill="#ffffff"/>`
      + back
      + `<g transform="translate(${padX.toFixed(2)}, ${padTop.toFixed(2)})">${qrInner}</g>`
      + fr.deco(padX, padTop, sizePx, W, H)
    : qrInner;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W.toFixed(2)}" height="${H.toFixed(2)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}">
      ${defs ? `<defs>${defs}</defs>` : ''}
      ${body}
    </svg>
  `;
}

// ── Contrast checker (WCAG-style) ──────────────────────────────
// Renvoie le ratio de luminance entre fg et bg (1 = no contrast,
// 21 = max). Seuil scannabilité QR pratique : >= 3:1. WCAG AA texte
// normal demande 4.5:1 mais les scanners QR sont plus tolérants.

function _luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fgHex, bgHex) {
  const L1 = _luminance(fgHex);
  const L2 = _luminance(bgHex);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

// Renvoie 'ok' (>=3:1), 'warn' (2-3:1), 'bad' (<2:1)
export function contrastLevel(fgHex, bgHex) {
  const r = contrastRatio(fgHex, bgHex);
  if (r >= 3)   return 'ok';
  if (r >= 2)   return 'warn';
  return 'bad';
}

// ── Utils ─────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
