/* ═══════════════════════════════════════════════════════════════
   SA-15.3 — PLANCHES ILLUSTRÉES : lecture d'un PDF SUR LE POSTE

   Sur le manuel client, l'image EST souvent le contenu : page 34,
   224 caractères de texte et trois photos — après extraction il ne
   restait qu'une fiche sur la garde, la saisie du Karambit avait
   purement disparu.

   Ce module lit le PDF **entièrement côté client** (pdf.js vendorisé) :
   - il en sort le TEXTE page par page (→ lots d'extraction),
   - et la PLANCHE de chaque page, rasterisée (→ proposition à cocher).

   Deux conséquences qui ne sont pas des détails :
   1. Le PDF ne quitte JAMAIS le poste de l'instructeur. Seuls le texte
      et les planches retenues partent chez Cloudflare.
   2. La borne d'upload de 8 Mo du worker cesse d'être un mur. Le manuel
      client fait 584 Mo : il n'aurait JAMAIS pu être envoyé.

   ── Grain : la PAGE ENTIÈRE ──────────────────────────────────
   Les planches sont composites (photos détourées + tracés vectoriels +
   étiquettes numérotées). Extraire les images embarquées rendrait des
   silhouettes découpées et perdrait lignes, flèches et libellés —
   c'est-à-dire le sens. On rasterise donc la page telle qu'imprimée.

   ── Mémoire ──────────────────────────────────────────────────
   Le durcissement vient de booK._importPDF, éprouvé en prod sur iOS :
   libération du bitmap, cleanup() de la page, respiration entre pages.
   UNE différence assumée : booK garde des dataURI (il exporte du HTML
   autoporté) ; ici on garde des **Blob**. Sur 267 pages, le base64
   coûterait ~33 % de plus, en mémoire JS de surcroît — c'est exactement
   le volume qui fait tomber un iPhone.
   ═══════════════════════════════════════════════════════════════ */

const IS_COARSE  = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } })();
const MAX_PAGE_W = IS_COARSE ? 1200 : 1600;
const MAX_SCALE  = IS_COARSE ? 2 : 2.5;

// Au-delà, on ne rasterise plus : 267 planches sont déjà un chantier de
// relecture (brief §8), 1500 seraient une promesse intenable.
export const PLANCHES_MAX_PAGES = 400;

let _pdfjs = null;
async function _lib() {
  if (_pdfjs) return _pdfjs;
  // Vendorisé (/app/vendor/pdfjs/) → hors dette « imports CDN sans SRI ».
  _pdfjs = await import('/app/vendor/pdfjs/pdf.min.mjs');
  _pdfjs.GlobalWorkerOptions.workerSrc = '/app/vendor/pdfjs/pdf.worker.min.mjs';
  return _pdfjs;
}

// Safari n'a pas toujours l'encodeur WebP : toBlob() retombe alors
// SILENCIEUSEMENT sur PNG (énorme pour une photo). On vérifie le type
// rendu et on force JPEG plutôt que d'envoyer 4 Mo de PNG par page.
function _canvasToBlob(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => {
        if (b && b.type === 'image/webp') return resolve(b);
        canvas.toBlob((j) => resolve(j || b || null), 'image/jpeg', 0.85);
      }, 'image/webp', 0.82);
    } catch (_) { resolve(null); }
  });
}

// Rasterise UNE page avec un plafond de temps.
//
// Trouvé au banc : `page.render()` peut ne jamais rendre la main (observé
// sur un navigateur sans compositing, mais une page pathologique ou un
// iPhone à court de mémoire produiraient le même symptôme). Sans ce
// plafond, UNE page bloque l'import ENTIER d'un manuel de 267 pages, et
// l'instructeur n'a plus qu'à tout reprendre.
// La règle vaut mieux que la planche : on abandonne l'image, on garde le
// texte, on continue. `cancel()` libère le travail en cours côté pdf.js.
const RENDER_TIMEOUT_MS = 20000;

async function _renderPage(page) {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, MAX_PAGE_W / vp1.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // JPEG n'a pas d'alpha

  const task = page.render({ canvasContext: ctx, viewport: vp });
  let timer = null;
  try {
    await Promise.race([
      task.promise,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('render-timeout')), RENDER_TIMEOUT_MS); }),
    ]);
  } catch (e) {
    try { task.cancel(); } catch (_) {}
    canvas.width = canvas.height = 0;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const blob = await _canvasToBlob(canvas);
  canvas.width = canvas.height = 0;    // libère le bitmap TOUT DE SUITE (mémoire iOS)
  return blob;
}

// Normalise le texte d'une page (même esprit que le desK pré-impression) :
// pdf.js rend des fragments, pas des lignes.
function _pageText(tc) {
  return (tc.items || []).map(it => it.str).join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lit un PDF sur le poste.
 * @param {File|Blob} file
 * @param {object}   opts
 * @param {boolean}  opts.planches  rasteriser les pages (sinon texte seul, bien plus rapide)
 * @param {function} opts.onProgress ({ page, total, phase }) → void
 * @param {function} opts.shouldStop () → bool : interruption demandée par l'utilisateur
 * @returns {Promise<{ pages: Array<{n, text, blob?}>, numPages, stopped, failed, truncated }>}
 */
export async function readPdf(file, { planches = true, onProgress = () => {}, shouldStop = () => false } = {}) {
  const pdfjsLib = await _lib();
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const numPages = doc.numPages;
  const upto = Math.min(numPages, PLANCHES_MAX_PAGES);
  const pages = [];
  let stopped = false;
  let failed = 0;      // planches abandonnées (le texte, lui, est conservé)

  try {
    for (let i = 1; i <= upto; i++) {
      if (shouldStop()) { stopped = true; break; }
      onProgress({ page: i, total: upto, phase: planches ? 'planches' : 'texte' });
      const page = await doc.getPage(i);
      const rec = { n: i, text: '' };

      // 1. Le texte d'abord : c'est lui qui porte le savoir, et il doit
      //    survivre même si la rasterisation de cette page échoue.
      try { rec.text = _pageText(await page.getTextContent()); } catch (_) { rec.text = ''; }

      // 2. La planche. Un échec ici (mémoire, page corrompue, rendu qui
      //    pend) ne doit JAMAIS faire perdre le texte déjà lu, ni arrêter
      //    la lecture des pages suivantes.
      if (planches) {
        try {
          const blob = await _renderPage(page);
          if (blob) rec.blob = blob;
        } catch (_) { failed++; /* planche perdue, texte conservé, on continue */ }
      }

      pages.push(rec);
      try { page.cleanup(); } catch (_) {}
      // Respiration : laisse le GC et le paint passer entre deux pages.
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    try { doc.destroy(); } catch (_) {}
  }

  return { pages, numPages, stopped, failed, truncated: numPages > upto };
}

/* ── SA-15.4 — numéros de photos imprimés sur une page ──────────
   Le manuel écrit « … pivote le pied d'appui - Photo 2 » et imprime le
   chiffre 2 sur la planche. Ces numéros sont LOCAUX à la page : la page 68
   a ses photos 1-2-3, la page 64 sa photo 5. En repérant, page par page,
   quels numéros y figurent, on peut dire à l'instructeur (et à l'agent)
   QUELLE planche montre la photo citée dans une étape.

   Volontairement strict : on ne prend que les formes explicitement
   numérotées. « photographie de la garde » n'est pas un renvoi.
   Pur → testé. */
const PHOTO_REF_RE = /\b(?:photos?|fig\.?|figures?|sch[ée]mas?|planches?)\s*(?:n[°o]\s*)?(\d{1,2})\b/gi;

export function photoRefs(text) {
  const out = [];
  const s = String(text || '');
  PHOTO_REF_RE.lastIndex = 0;
  let m;
  while ((m = PHOTO_REF_RE.exec(s)) !== null) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 99 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

// Légende d'une planche : provenance + numéros imprimés dessus. C'est ce
// que l'instructeur relit, et ce que l'agent pourra citer.
export function plancheAlt(pageN, refs) {
  if (!refs || !refs.length) return `Page ${pageN}`;
  return refs.length === 1
    ? `Page ${pageN} — photo ${refs[0]}`
    : `Page ${pageN} — photos ${refs.join(', ')}`;
}

// Poids total des planches retenues — affiché avant l'envoi : l'instructeur
// doit savoir ce qui part chez Cloudflare, c'est le cœur de l'argument
// de souveraineté.
export function planchesWeight(blobs) {
  const n = blobs.reduce((s, b) => s + (b?.size || 0), 0);
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(n / 1024)} Ko`;
}
