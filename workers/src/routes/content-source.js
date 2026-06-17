/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Content Chain · Récupération de source (juin 2026)
   ─────────────────────────────────────────────────────────────────

   Le client veut écrire sur un sujet qui l'intéresse mais Mistral/Cloudflare
   ne sait pas naviguer. Solution honnête et GRATUITE : le client APPORTE sa
   source, on l'extrait et on l'injecte dans la chaîne (débat + rédaction).

   Route exposée :
     POST /api/content/fetch-source   Body : { url }
     Auth : JWT licence requise.
     Réponse : { text, title, source_ref, truncated }

   Coût : ZÉRO IA. fetch borné + extraction maison `htmlToText`. Pas de vault,
   pas de fiche, pas de crédit — juste de la matière brute pour le prompt.
   Le TEXTE COLLÉ et les FICHIERS .md/.txt/.csv sont lus côté front (aucun
   aller-retour). Les PDF/binaires sont refusés ici (conversion = IA payante,
   contraire à la doctrine flat) → message « collez le texte ».

   Réutilise les briques pures, testées, de Smart Agent (SA-8.1) :
   validateImportUrl (anti-SSRF) · htmlToText · clampExtractText.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
import { validateImportUrl, htmlToText, clampExtractText } from './smart-agent.js';

const FETCH_TIMEOUT_MS = 15000;
const FETCH_MAX_BYTES  = 2 * 1024 * 1024;   // 2 Mo — page web
const SOURCE_MAX_CHARS = 6000;              // borne renvoyée ; le front re-borne pour le prompt

// POST /api/content/fetch-source — { url } → texte brut d'une page web.
export async function handleFetchSource(request, env) {
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

  let res;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    res = await fetch(v.url, {
      signal:   ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'KeystoneSource/1.0 (+https://protein-keystone.com)',
        'Accept':     'text/html,text/plain,*/*',
      },
    });
    clearTimeout(t);
  } catch (_) {
    return err('Page injoignable — vérifiez l\'adresse (ou collez le texte).', 502, origin);
  }
  if (!res.ok) return err(`La page répond « ${res.status} » — vérifiez l'adresse.`, 422, origin);

  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > FETCH_MAX_BYTES) return err('Page trop lourde (2 Mo max) — collez le passage utile.', 413, origin);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > FETCH_MAX_BYTES) return err('Page trop lourde (2 Mo max) — collez le passage utile.', 413, origin);

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  // Binaire (PDF, doc, image…) refusé : la conversion passe par une IA payante.
  if (ctype.includes('application/pdf') || ctype.includes('application/octet-stream')
      || ctype.startsWith('image/') || ctype.startsWith('application/vnd')) {
    return err('Ce type de fichier n\'est pas pris en charge ici — collez le texte de la source.', 415, origin);
  }

  const raw = new TextDecoder().decode(buf);
  const isPlain = ctype.includes('text/plain') || ctype.includes('markdown');
  const extracted = isPlain ? raw : htmlToText(raw);
  const { text, truncated } = clampExtractText(extracted, SOURCE_MAX_CHARS);
  if (text.length < 30) {
    return err('Contenu illisible (page très dynamique ?) — collez plutôt le texte de la source.', 422, origin);
  }

  // Titre best-effort (balise <title>), purement indicatif côté UI.
  const tm = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = tm ? htmlToText(tm[1]).slice(0, 160) : '';

  return json({ text, title, source_ref: v.url, truncated }, 200, origin);
}
