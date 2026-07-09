/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key Brand · Import depuis une URL (KB-IMPORT-1)
   ─────────────────────────────────────────────────────────────────

   Le graphiste colle l'URL du site d'une marque → on en déduit une
   charte PARTIELLE (couleurs, polices, logo candidats, nom/baseline)
   qu'il valide ensuite dans l'atelier avant d'écrire une charte.

   Route :
     POST /api/keybrand/import   Body : { url }
     Auth : JWT licence requise (comme /api/content/fetch-source).
     Réponse : { meta, colors, typography, logos, diagnostics }

   Coût : ZÉRO IA. fetch borné (page + quelques feuilles de style) +
   extraction déterministe (workers/src/lib/brand-extract.js). N'écrit
   RIEN : ni D1, ni R2, ni crédit. Le front (KB-IMPORT-2) crée la charte.

   Sécurité : validateImportUrl (anti-SSRF, réutilisé de Smart Agent)
   appliqué à la page ET à chaque feuille de style avant de la fetcher.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { validateImportUrl } from './smart-agent.js';
import { extractBrand } from '../lib/brand-extract.js';

const FETCH_TIMEOUT_MS = 15000;
const PAGE_MAX_BYTES   = 2 * 1024 * 1024;    // 2 Mo — page HTML
const CSS_MAX_BYTES    = 512 * 1024;         // 512 Ko par feuille de style
const CSS_TOTAL_BYTES  = 1024 * 1024;        // 1 Mo de CSS cumulé max
const MAX_STYLESHEETS  = 5;                  // on ne suit pas 50 <link>

const UA = 'KeystoneKeyBrand/1.0 (+https://protein-keystone.com)';

async function _fetchBounded(url, maxBytes, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': accept },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len > maxBytes) return { ok: false, status: 413 };
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return { ok: false, status: 413 };
    return { ok: true, ctype, text: new TextDecoder().decode(buf), finalUrl: res.url || url };
  } catch (_) {
    return { ok: false, status: 0 };       // abort / réseau
  } finally {
    clearTimeout(t);
  }
}

// Liste les <link rel=stylesheet> (résolus en absolu, dédupliqués, bornés).
function _stylesheetUrls(html, baseUrl) {
  const urls = [];
  const re = /<link\b[^>]*rel=["']stylesheet["'][^>]*>|<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && urls.length < MAX_STYLESHEETS * 3) {
    const tag = m[0];
    if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch (_) { continue; }
    if (!/^https?:/i.test(abs)) continue;
    if (!urls.includes(abs)) urls.push(abs);
  }
  return urls.slice(0, MAX_STYLESHEETS);
}

// POST /api/keybrand/import — { url } → charte partielle.
export async function handleKeyBrandImport(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    } });
  }

  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise', 401, origin);

  const body = await parseBody(request);
  const v = validateImportUrl(body?.url);
  if (!v.ok) return err(v.msg, 400, origin);

  // 1. La page.
  const page = await _fetchBounded(v.url, PAGE_MAX_BYTES, 'text/html,*/*');
  if (!page.ok) {
    if (page.status === 413) return err('Page trop lourde (2 Mo max).', 413, origin);
    if (page.status === 0)   return err('Site injoignable — vérifiez l\'adresse.', 502, origin);
    return err(`La page répond « ${page.status} ».`, 422, origin);
  }
  if (!page.ctype.includes('html') && !page.ctype.includes('xml') && page.ctype) {
    return err('Cette adresse ne renvoie pas une page web.', 415, origin);
  }
  const html = page.text;
  const baseUrl = page.finalUrl;

  // 2. Quelques feuilles de style (anti-SSRF sur chacune, budget cumulé borné).
  let css = '';
  for (const sheet of _stylesheetUrls(html, baseUrl)) {
    if (css.length >= CSS_TOTAL_BYTES) break;
    if (!validateImportUrl(sheet).ok) continue;
    const r = await _fetchBounded(sheet, CSS_MAX_BYTES, 'text/css,*/*');
    if (r.ok && r.text) css += '\n' + r.text;
  }

  // 3. Extraction déterministe (moteur pur).
  const brand = extractBrand({ html, css, baseUrl });

  // ids côté serveur pour que le payload soit directement mergeable (crypto worker).
  for (const c of brand.colors.palette) c.id = crypto.randomUUID();
  for (const f of brand.typography.fonts) f.id = crypto.randomUUID();

  return json({ ...brand, source_ref: baseUrl }, 200, origin);
}
