/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key Brand · Extraction de charte (KB-IMPORT-1)
   ─────────────────────────────────────────────────────────────────
   MOTEUR PUR, DÉTERMINISTE, ZÉRO IA, ZÉRO I/O.

   À partir du HTML d'une page + du texte de ses feuilles de style,
   on déduit une charte partielle :
     • meta      : nom de la marque + baseline (best-effort, éditables)
     • colors    : palette rangée par saillance (theme-color forcée primaire)
     • typography: familles de polices repérées + rôle deviné (title/body)
     • logos     : URL candidates (icônes, og:image, <img> « logo »)

   Ce module ne fait AUCUNE requête réseau et n'écrit rien : le handler
   (key-brand-import.js) fetch les ressources puis appelle extractBrand().
   Les familles de police et les couleurs sont des HINTS : le front
   (KB-IMPORT-2) les normalise (match GOOGLE_FONTS, calcul cmyk/nightHex)
   et laisse l'utilisateur valider avant d'écrire une charte.

   Testé : workers/test/brand-extract.test.mjs (node, assertions pures).
   ═══════════════════════════════════════════════════════════════ */

// ── Couleurs : normalisation & mesures ──────────────────────────

// #rgb | #rrggbb | rgb()/rgba() → '#rrggbb' minuscule, sinon null.
// (hsl() et les mots-clés CSS sont ignorés volontairement : pas de table
//  de conversion à maintenir, on reste sur ce qui est certain.)
export function normHex(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) { const c = m[1]; return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`; }
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return `#${m[1]}`;
  m = s.match(/^#([0-9a-f]{8})$/);       // #rrggbbaa → on lâche l'alpha
  if (m) return `#${m[1].slice(0, 6)}`;
  m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) {
    const to = (n) => {
      let v = parseFloat(n);
      if (v <= 1 && String(n).includes('.')) v = v * 255;  // rgb(0.2 …) très rare
      v = Math.max(0, Math.min(255, Math.round(v)));
      return v.toString(16).padStart(2, '0');
    };
    return `#${to(m[1])}${to(m[2])}${to(m[3])}`;
  }
  return null;
}

function _rgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
function _dist(a, b) {
  const x = _rgb(a), y = _rgb(b);
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);
}
// Gris / quasi-blanc / quasi-noir : présents partout (fonds, textes) mais
// rarement la couleur de marque → on les dé-priorise sans les jeter.
export function isNeutral(hex) {
  const { r, g, b } = _rgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx - mn, light = (mx + mn) / 2;
  return sat < 18 || light >= 246 || light <= 10;
}

// ── Nommage depuis une variable CSS (--brand-blue → « Brand Blue ») ──
export function nameFromVar(v) {
  let s = String(v || '')
    .replace(/^--/, '')
    .replace(/[-_]?(?:colou?r|clr)[-_]?/gi, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim().replace(/\s+/g, ' ');
  // « 500 », « c1 », « col2 »… pas parlant → repli sur un nom positionnel.
  if (!s || s.length <= 2 || /^[0-9]+$/.test(s) || /^[a-z]{1,3}\s*\d+$/i.test(s)) return null;
  return s.split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
    .join(' ').slice(0, 40);
}

// ── Découpe des blocs pour deviner les rôles de police ──────────
const _GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'apple color emoji',
  'noto color emoji', 'segoe ui emoji', 'segoe ui symbol', 'inherit', 'initial',
  'unset', 'revert',
]);
function _cleanFamily(token) {
  const f = String(token || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!f) return null;
  if (_GENERIC_FONTS.has(f.toLowerCase())) return null;
  if (f.length > 48 || /[{}<>;]/.test(f)) return null;
  return f;
}

// ── Extraction couleurs ─────────────────────────────────────────
function _collectColors(cssText, htmlText, themeColor) {
  const freq = new Map();       // hex → poids
  const named = new Map();      // hex → nom (depuis une variable)
  const bump = (hex, w, name) => {
    if (!hex) return;
    freq.set(hex, (freq.get(hex) || 0) + w);
    if (name && !named.has(hex)) named.set(hex, name);
  };

  // 1. Variables CSS de couleur : signal fort + nom parlant.
  const varRe = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g;
  let m;
  while ((m = varRe.exec(cssText))) {
    const hex = normHex(m[2]);
    if (hex) bump(hex, 6, nameFromVar(m[1]));
  }
  // 2. Toutes les autres occurrences de couleur dans le CSS + styles inline.
  const anyRe = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{5,40}\)/g;
  const scan = (txt) => { let x; while ((x = anyRe.exec(txt))) { const h = normHex(x[0]); if (h) bump(h, 1); } };
  scan(cssText);
  // styles inline du HTML (attributs style="…") — souvent la couleur de marque.
  const styleAttrRe = /style\s*=\s*"([^"]*)"/gi;
  while ((m = styleAttrRe.exec(htmlText))) scan(m[1]);

  // 3. theme-color : la couleur que la marque déclare comme la sienne.
  const tc = normHex(themeColor);
  if (tc) bump(tc, 4, named.get(tc) || null);

  // Score = poids, dé-priorise les neutres.
  const scored = [...freq.entries()].map(([hex, w]) => ({
    hex, name: named.get(hex) || null,
    score: w * (isNeutral(hex) ? 0.2 : 1),
  }));
  scored.sort((a, b) => b.score - a.score || (a.hex < b.hex ? -1 : 1));

  // theme-color remonte toujours en tête (couleur de marque affirmée).
  if (tc) {
    const i = scored.findIndex(s => s.hex === tc);
    if (i > 0) { const [t] = scored.splice(i, 1); scored.unshift(t); }
  }

  // Dédup des teintes quasi identiques (garde la mieux classée).
  const kept = [];
  for (const s of scored) {
    if (kept.some(k => _dist(k.hex, s.hex) < 24)) continue;
    kept.push(s);
    if (kept.length >= 8) break;
  }
  return kept;
}

function _paletteFrom(colors) {
  return colors.map((c, i) => {
    const role = i === 0 ? 'primary' : i === 1 ? 'secondary' : 'extra';
    const fallback = i === 0 ? 'Primaire' : i === 1 ? 'Secondaire' : `Couleur ${i + 1}`;
    return {
      name: (c.name || fallback).slice(0, 40),
      hex: c.hex, role,
      cmyk: null, pantone: null, story: null, nightHex: null,   // dérivés côté front
    };
  });
}

// ── Extraction polices ──────────────────────────────────────────
function _googleFamilies(html) {
  // <link href="…fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Lora">
  // ancienne forme : ?family=Roboto:400,700|Lora
  const out = [];
  const linkRe = /<link\b[^>]*href\s*=\s*["']([^"']*fonts\.googleapis\.com\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const href = m[1].replace(/&amp;/g, '&');
    const params = href.split('?')[1] || '';
    for (const part of params.split('&')) {
      if (!part.startsWith('family=')) continue;
      for (const fam of decodeURIComponent(part.slice(7)).split('|')) {
        const spec = fam.split(':');
        const family = spec[0].replace(/\+/g, ' ').trim();
        if (!family) continue;
        // graisses : « wght@400;700 » ou « 400,700 »
        let weights = null;
        if (spec[1]) {
          const w = spec[1].replace(/^[a-z@,]*wght@/i, '').replace(/ital,?/gi, '');
          const nums = (w.match(/\d{3}/g) || []);
          if (nums.length) weights = [...new Set(nums)].join(';');
        }
        out.push({ family, weights });
      }
    }
  }
  return out;
}

function _cssFamilies(cssText) {
  // Pour chaque règle contenant font-family, garde le sélecteur (rôle) +
  // la 1re famille nommée non générique.
  const out = [];
  const ruleRe = /([^{}]{1,300})\{([^{}]*font-family\s*:\s*([^;}]+))[^{}]*\}/gi;
  let m;
  while ((m = ruleRe.exec(cssText))) {
    const selector = m[1].toLowerCase();
    const first = _firstNamedFamily(m[3]);
    if (!first) continue;
    let role = null;
    if (/\b(h[1-6]|\.?title|\.?heading|\.?display|hero)\b/.test(selector)) role = 'title';
    else if (/\b(body|html|:root|\bp\b|paragraph|\.text|font-base)\b/.test(selector)) role = 'body';
    out.push({ family: first, role });
  }
  // @font-face déclare des familles hébergées par la marque (signal fort).
  const faceRe = /@font-face\s*\{[^}]*font-family\s*:\s*([^;}]+)[;}]/gi;
  while ((m = faceRe.exec(cssText))) {
    const first = _firstNamedFamily(m[1]);
    if (first) out.push({ family: first, role: null, hosted: true });
  }
  return out;
}
function _firstNamedFamily(list) {
  for (const tok of String(list).split(',')) {
    const f = _cleanFamily(tok);
    if (f) return f;
  }
  return null;
}

function _mergeFonts(google, cssFams) {
  const byLower = new Map();   // family.toLowerCase() → { family, role, source, weights }
  const add = (family, role, source, weights) => {
    const k = family.toLowerCase();
    const cur = byLower.get(k);
    if (!cur) { byLower.set(k, { family, role: role || null, source, weights: weights || null }); return; }
    if (!cur.role && role) cur.role = role;
    if (source === 'google') { cur.source = 'google'; if (weights) cur.weights = weights; }
    if (!cur.weights && weights) cur.weights = weights;
  };
  for (const g of google) add(g.family, null, 'google', g.weights);
  for (const c of cssFams) add(c.family, c.role, c.hosted ? 'declared' : 'declared', null);

  const items = [...byLower.values()];
  // Rôles : on veut au moins un Titrage et un Texte courant si possible.
  const hasTitle = items.some(i => i.role === 'title');
  const hasBody = items.some(i => i.role === 'body');
  if (!hasTitle && items[0]) items[0].role = 'title';
  if (!hasBody) { const b = items.find(i => i.role !== 'title'); if (b) b.role = 'body'; }
  // Tri : rôle connu d'abord, google avant déclaré.
  const rank = (i) => (i.role === 'title' ? 0 : i.role === 'body' ? 1 : 2) + (i.source === 'google' ? 0 : 0.5);
  items.sort((a, b) => rank(a) - rank(b));

  return items.slice(0, 4).map(i => ({
    role: i.role || 'body',
    source: i.source,                 // hint ; le front re-match contre GOOGLE_FONTS
    family: i.family,
    axis: i.source === 'google' ? (i.weights || null) : null,
    buyUrl: null,
  }));
}

// ── Meta (nom + baseline) ───────────────────────────────────────
function _metaContent(html, patterns) {
  for (const re of patterns) { const m = html.match(re); if (m && m[1]) return _decode(m[1].trim()); }
  return '';
}
function _decode(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#3?9;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function _extractMeta(html) {
  const name = _metaContent(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
  ]) || (() => {
    const t = _metaContent(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
    // « Marque — slogan » / « Page | Marque » : on garde le segment le plus court « marque ».
    const parts = t.split(/\s[|–—·:\-]\s/).map(s => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts.sort((a, b) => a.length - b.length)[0] : t;
  })();

  const baseline = _metaContent(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  return { name: name.slice(0, 80), baseline: baseline.slice(0, 120) };
}

// ── Logos candidats (URL seulement — l'upload R2 arrive en KB-IMPORT-2) ──
function _extractLogos(html, absUrl) {
  const out = [];
  const push = (url, kind, label) => {
    const abs = absUrl(url);
    if (abs && !out.some(o => o.url === abs)) out.push({ url: abs, kind, label });
  };
  // Icônes déclarées (svg > png ; on lit les tailles pour trier).
  const iconRe = /<link\b[^>]*rel=["']([^"']*\b(?:icon|apple-touch-icon|mask-icon)\b[^"']*)["'][^>]*>/gi;
  let m;
  const icons = [];
  while ((m = iconRe.exec(html))) {
    const tag = m[0];
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const sizes = (tag.match(/sizes=["']([^"']+)["']/i) || [])[1] || '';
    const px = Math.max(0, ...(sizes.match(/\d+/g) || ['0']).map(Number));
    const svg = /\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag);
    icons.push({ href, px, svg });
  }
  icons.sort((a, b) => (b.svg - a.svg) || (b.px - a.px));
  for (const ic of icons) push(ic.href, 'icon', ic.svg ? 'Icône SVG' : (ic.px ? `Icône ${ic.px}px` : 'Icône'));

  // og:image / twitter:image : souvent le logo social.
  const og = _metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ]);
  if (og) push(og, 'social', 'Image sociale');

  // <img> de l'en-tête dont alt/class/src évoque un logo (zone haute de page).
  const head = html.slice(0, 20000);
  const imgRe = /<img\b[^>]*>/gi;
  while ((m = imgRe.exec(head))) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1]
      || (tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1];
    if (src && !/^data:/i.test(src)) push(src, 'img', 'Logo (en-tête)');
  }
  return out.slice(0, 6);
}

// ── Point d'entrée ──────────────────────────────────────────────
/**
 * @param {Object} args
 * @param {string} args.html      HTML de la page
 * @param {string} [args.css]     concaténation du CSS (inline + feuilles liées)
 * @param {string} [args.baseUrl] URL finale (après redirections) pour résoudre les liens
 * @returns {{meta, colors, typography, logos, diagnostics}} charte partielle
 */
export function extractBrand({ html = '', css = '', baseUrl = '' } = {}) {
  const cssAll = String(css || '');
  const htmlS = String(html || '');

  // Résolveur d'URL relatif → absolu (tolérant : renvoie null si impossible).
  const absUrl = (href) => {
    if (!href) return null;
    try { return new URL(href, baseUrl || undefined).toString(); }
    catch (_) { return /^https?:\/\//i.test(href) ? href : null; }
  };

  const themeColor = _metaContent(htmlS, [
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i,
  ]);

  // On inclut aussi les <style> inline dans le CSS analysé.
  let inlineStyle = '';
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm;
  while ((sm = styleRe.exec(htmlS))) inlineStyle += '\n' + sm[1];
  const cssText = cssAll + '\n' + inlineStyle;

  const colors = _collectColors(cssText, htmlS, themeColor);
  const fonts = _mergeFonts(_googleFamilies(htmlS), _cssFamilies(cssText));
  const logos = _extractLogos(htmlS, absUrl);
  const meta = _extractMeta(htmlS);

  const jsHeavy = cssText.replace(/\s/g, '').length < 400 && colors.length < 2;

  return {
    meta,
    colors: { palette: _paletteFrom(colors) },
    typography: { fonts },
    logos,
    diagnostics: {
      colors: colors.length,
      fonts: fonts.length,
      logos: logos.length,
      cssBytes: cssText.length,
      themeColor: normHex(themeColor) || null,
      jsHeavy,
      note: jsHeavy
        ? 'Peu de styles détectés (site très dynamique ?) — complétez à la main.'
        : null,
    },
  };
}
