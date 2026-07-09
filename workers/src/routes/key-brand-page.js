/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — KEY BRAND · Page publique /b/:slug (Pad O-BRD-001 · KB-6)

   GET /b/:slug — page HTML AUTOPORTÉE servie par le Worker (même origine
   que /api/keybrand/public/* → zéro CORS). La page fetch le snapshot
   PUBLIÉ et rend le mini-site en lecture seule, interactions comprises :
   copie des codes couleur, fonds d'aperçu, téléchargement du logo à la
   carte (PNG canvas), kit .zip, spécimen typographique à taper, interdits
   générés avec le vrai logo. Export PDF = print CSS (window.print).

   Accès : la page s'affiche toujours ; le JSON renvoie 401 needCode si la
   charte est protégée par code (formulaire de code intégré). noindex
   TOUJOURS en v1 (confidentialité d'abord, même en accès « public »).

   NOTE : quelques utilitaires (export PNG, zip, contraste) sont des
   copies volontaires d'app/key-brand-tools.js — la page doit rester
   autoportée, sans dépendance au front Vercel. Source de vérité côté
   éditeur ; garder les deux en phase si l'algo change.

   Durcissement : CSP stricte (nonce sur le module inline, Google Fonts
   seuls tiers autorisés), no-referrer, nosniff.
   ═══════════════════════════════════════════════════════════════ */

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function handleKeyBrandPage(request, env, slug) {
  const nonce = crypto.randomUUID().replace(/-/g, '');

  // Référencement : seule une charte PUBLIÉE et en accès « public » est
  // indexable ; unlisted / code / non publiée restent noindex (par défaut).
  // Repli sûr sur noindex si la DB est indisponible (harnais de rendu).
  let robots = 'noindex, nofollow';
  let pubName = '';
  try {
    if (env && env.DB) {
      const row = await env.DB
        .prepare('SELECT name, status, access FROM kb_charts WHERE slug = ?')
        .bind(String(slug || '')).first();
      if (row && row.status === 'published' && row.access === 'public') {
        robots = 'index, follow';
        pubName = String(row.name || '').replace(/[<>&]/g, '').slice(0, 90);
      }
    }
  } catch (_) { /* noindex par défaut */ }
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${robots}">
<meta name="referrer" content="no-referrer">
<title>${pubName ? pubName + ' — charte graphique' : 'Charte graphique'}</title>
<style>
:root{--ink:#15171c;--muted:#5b6170;--line:#e5e7ee;--bg:#f7f8fb;--panel:#fff;--accent:#3b5bdb;--danger:#e11d48;--ok:#0f9d63}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:0 20px 60px}
button{font-family:inherit}

/* Nav collante */
.nav{position:sticky;top:0;z-index:10;background:rgba(247,248,251,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.nav-in{max-width:860px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;gap:14px;overflow-x:auto;scrollbar-width:none}
.nav-in::-webkit-scrollbar{display:none}
.nav-name{font-weight:900;letter-spacing:-0.02em;white-space:nowrap;margin-right:4px}
.nav a{color:var(--muted);text-decoration:none;font-size:13.5px;font-weight:600;white-space:nowrap}
.nav a:hover{color:var(--ink)}
.nav .sp{flex:1}
.nav .vbadge{font-size:11.5px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 10px;white-space:nowrap;background:var(--panel)}
.nav .print{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--ink)}

/* Héros (la scène) */
.hero{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:20px;margin-top:22px;padding:56px 30px;text-align:center;overflow:hidden}
.hero.has-media{min-height:380px;display:flex;align-items:center;justify-content:center}
.hero-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.has-media .cover-foot{text-shadow:0 1px 14px rgba(0,0,0,.5)}
.hero-inner{position:relative;display:flex;flex-direction:column;align-items:center;gap:16px}
.hero-txt{display:flex;flex-direction:column;gap:10px;align-items:center}
.hero-inner>img{max-width:min(340px,70%);max-height:140px;object-fit:contain}
.hero-name{font-weight:900;font-size:calc(clamp(28px,5vw,42px) * var(--ts,1));letter-spacing:-0.03em;line-height:1.08}
.hero-base{color:var(--muted);font-size:calc(16.5px * var(--bs,1))}
.hero-vr{width:1px;align-self:stretch;background:rgba(255,255,255,.3)}
.hero.hlay-corner{display:flex;align-items:flex-end;justify-content:flex-start;min-height:340px;text-align:left}
.hlay-corner .hero-inner,.hlay-corner .hero-txt{align-items:flex-start}
.hlay-split .hero-inner{flex-direction:row;gap:28px;text-align:left}
.hlay-split .hero-txt{align-items:flex-start}
/* Couverture STATIQUE — motions supprimées (2026-07-05) : une ouverture
   animée = la vidéo du graphiste, plein cadre, rien par-dessus. */

/* ══ Édition (KB-12) — le rythme d'une charte imprimée ══ */
/* Thème sombre optionnel (réglage de l'éditeur). */
body.dark{--ink:#f2f3f7;--muted:#9aa2b1;--line:#262b37;--bg:#0e1016;--panel:#161923}
body.dark .nav{background:rgba(14,16,22,.9)}
body.dark .code,body.dark .ldl{background:#12141c}
body.dark .toast{background:#f2f3f7;color:#15171c}

/* Couverture pleine page (la scène d'ouverture devient la couverture).
   Annule le style « carte » du .hero : pleine largeur, sans cadre. */
.cover,.hero.cover{border:none;border-radius:0;margin-top:0;position:relative;min-height:82vh;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:64px 24px 110px}
.cover.has-media{min-height:86vh}
.cover-foot{position:absolute;bottom:34px;left:0;right:0;text-align:center;font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:.92}
.cover-foot::after{content:"";display:block;width:200px;height:1px;margin:14px auto 0;background:currentColor;opacity:.45}

/* Sommaire sur aplat. */
.toc{padding:70px 24px}
.toc-in{max-width:940px;margin:0 auto}
.tocsep{height:1px;margin:48px 0 8px}
.toc-title{font-weight:900;font-size:clamp(26px,4vw,36px);letter-spacing:-0.02em;text-transform:uppercase;margin:0 0 34px}
.toc ol{list-style:none;margin:0;padding:0;columns:2;column-gap:44px}
.toc li{margin:0 0 12px;break-inside:avoid}
.toc a{color:inherit;text-decoration:none;font-size:15px;font-weight:700}
.toc a:hover{text-decoration:underline}
.toc .tn{font-weight:800;margin-right:10px;opacity:.75}
@media (max-width:560px){.toc ol{columns:1}}

/* Intercalaire de chapitre — pleine couleur, une respiration. */
.chap{padding:clamp(90px,16vh,150px) 24px}
.chap-in{max-width:940px;margin:0 auto;display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}
.chap-n{font-weight:300;font-size:clamp(28px,4.6vw,44px);letter-spacing:.02em}
.chap h2{font-weight:900;font-size:clamp(28px,4.6vw,44px);letter-spacing:-0.02em;text-transform:uppercase;margin:0}

/* Planche : filet + libellé tout-caps, une idée à la fois, de l'air. */
section{max-width:940px;margin:0 auto;padding:80px 24px 72px}
section>h2{font-size:12px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:var(--ink);border-top:1px solid var(--ink);padding-top:18px;margin:0 0 8px}
.sub{color:var(--muted);font-size:13.5px;margin:0 0 30px;max-width:52ch}
.pl-solo{background:#fff;border:1px solid var(--line);border-radius:18px;display:flex;align-items:center;justify-content:center;padding:9% 8%;margin-top:26px}
.pl-solo img{max-width:min(440px,66%);max-height:210px;object-fit:contain}
.pl-tail{max-width:940px;margin:0 auto;padding:26px 24px 0}

/* Couleurs en pastilles rondes (édition). */
.crows{display:flex;flex-direction:column;gap:38px;margin-top:30px}
.crow{display:flex;gap:34px;align-items:center;flex-wrap:wrap}
.cdot{width:clamp(104px,14vw,150px);aspect-ratio:1;border-radius:50%;border:0;cursor:pointer;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.07)}
.cinfo{display:flex;flex-direction:column;gap:9px;min-width:min(300px,100%)}
.talpha{font-size:clamp(21px,3.2vw,32px);line-height:1.4;margin:10px 0 8px;word-break:break-word}

/* La marque — intention & ton de voix (KB-13). */
.idmission{font-weight:900;font-size:clamp(22px,3.4vw,34px);letter-spacing:-0.02em;line-height:1.25;margin:20px 0 18px;max-width:28ch}
.idvals{margin:0 0 16px}
.idstory{color:var(--muted);font-size:15px;line-height:1.7;max-width:62ch;white-space:pre-line;margin:0}
.vo-reg{font-weight:800;font-size:15px;margin:16px 0 4px}
.vo-list{margin:14px 0;padding:0;list-style:none;counter-reset:vo}
.vo-list li{counter-increment:vo;font-size:15px;margin:9px 0;display:flex;gap:14px;align-items:baseline}
.vo-list li::before{content:counter(vo,decimal-leading-zero);font-weight:800;color:var(--accent);font-size:13px}
.vo-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0}
.vo-col{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--panel)}
.vo-col b{font-size:11.5px;text-transform:uppercase;letter-spacing:.09em}
.vo-col.ok b{color:var(--ok)}.vo-col.ko b{color:var(--danger)}
.vo-col p{margin:8px 0 0;font-size:14px;line-height:1.55}
.vo-ex{margin:20px 0 0;padding:14px 22px;border-left:3px solid var(--accent);font-size:17px;font-style:italic}
@media (max-width:560px){.vo-cols{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px}
.hint{color:var(--muted);font-size:12.5px}
.btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:11px;padding:9px 14px;font-size:13.5px;font-weight:600;cursor:pointer;text-decoration:none;transition:border-color .15s}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:transparent;color:#fff}
select,input[type=text]{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:8px 10px;font-size:13.5px;font-family:inherit;outline:none}
select:focus,input[type=text]:focus{border-color:var(--accent)}
/* Flat design : jamais le select natif bombé — flèche chevron custom. */
select{appearance:none;-webkit-appearance:none;-moz-appearance:none;cursor:pointer;padding-right:32px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235b6170' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center}
select::-ms-expand{display:none}

/* Logo */
.bgchips{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.bgchip{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--line);cursor:pointer;padding:0}
.bgchip.on{box-shadow:0 0 0 2px var(--accent)}
.bgchip.ck{background-image:linear-gradient(45deg,#b3b3b3 25%,transparent 25%,transparent 75%,#b3b3b3 75%),linear-gradient(45deg,#b3b3b3 25%,#e3e3e3 25%,#e3e3e3 75%,#b3b3b3 75%);background-size:10px 10px;background-position:0 0,5px 5px}
/* Pastilles de fond DANS chaque carte (fond d'essai indépendant par carte). */
.lcard .bgchips{margin:0;padding:11px 14px;gap:7px;border-bottom:1px solid var(--line)}
.lcard .bgchip{width:24px;height:24px}
.lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.lcard{overflow:hidden;display:flex;flex-direction:column}
.lprev{position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;padding:8%}
.lprev img{position:absolute;inset:0;margin:auto;max-width:84%;max-height:84%;object-fit:contain}
.lmeta{padding:12px 14px;border-top:1px solid var(--line)}
.lmeta b{font-size:14.5px}
.lusage{color:var(--muted);font-size:12.5px;margin-top:2px}
.ldl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);background:#fafbfe}
.protec{display:flex;gap:22px;align-items:center;flex-wrap:wrap;padding:16px;margin-top:14px}
.protec-viz{background:#fff;border:1px solid var(--line);border-radius:12px;padding:calc(var(--pm,28px) + 10px)}
.protec-zone{padding:var(--pm,28px);border:1.5px dashed rgba(0,0,0,.35);border-radius:4px}
.protec-zone img{display:block;height:48px;max-width:200px;object-fit:contain}
.mins{display:flex;flex-direction:column;gap:6px;font-size:13.5px}

/* Couleurs */
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.ccard{overflow:hidden}
.csw{height:96px;display:flex;align-items:center;justify-content:center;border:0;width:100%;cursor:pointer;font-weight:800;font-size:14px;letter-spacing:.02em}
.csw span{opacity:0;transition:opacity .15s}
.csw:hover span{opacity:.95}
.cbody{padding:12px 14px;display:flex;flex-direction:column;gap:7px}
.crow1{display:flex;align-items:center;justify-content:space-between;gap:8px}
.crow1 b{font-size:14.5px}
.crole{color:var(--muted);font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.codes{display:flex;flex-wrap:wrap;gap:6px}
.code{border:1px solid var(--line);background:#fafbfe;border-radius:8px;color:var(--muted);font-size:10.5px;letter-spacing:.04em;padding:4px 8px;cursor:pointer}
.code b{color:var(--ink);letter-spacing:0;font-size:11.5px}
.cstory{color:var(--muted);font-size:12.5px;font-style:italic;margin:0}
.wcags{display:flex;gap:6px;flex-wrap:wrap}
.wcag{font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px;border:1px solid var(--line)}
.wcag.ok{color:var(--ok);border-color:#bfe8d4}
.wcag.ko{color:var(--danger);border-color:#f6c6d2}

/* Typographies */
.tcard{padding:16px 18px;margin-bottom:12px}
.thead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.thead .fam{font-size:19px;font-weight:700}
.thead .role{color:var(--muted);font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.tctl{display:flex;gap:16px;align-items:center;margin:12px 0 2px;font-size:12.5px;color:var(--muted);flex-wrap:wrap}
.tctl-g{display:inline-flex;align-items:center;gap:6px}
.tcolors{display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center}
.tcsw{width:22px;height:22px;border-radius:7px;border:1px solid rgba(0,0,0,.18);cursor:pointer;padding:0}
.tcsw.on{box-shadow:0 0 0 2px var(--accent)}

/* Règles */
.rgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.rcard{overflow:hidden;margin:0}
.rbox{position:relative;height:110px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}
.rbox img{max-width:62%;max-height:56%;object-fit:contain}
.rslash{position:absolute;inset:0;pointer-events:none}
.rslash::before,.rslash::after{content:"";position:absolute;left:-6%;right:-6%;top:50%;height:2px;background:var(--danger);border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.35)}
.rslash::before{transform:translateY(-50%) rotate(-18deg)}
.rslash::after{transform:translateY(-50%) rotate(18deg)}
.rcard figcaption{display:flex;align-items:center;gap:6px;padding:8px 12px;font-size:11.5px;font-weight:600;border-top:1px solid var(--line);color:var(--danger)}
.rcard.good figcaption{color:var(--ok)}
.f-distort img{transform:scaleX(1.7)}.f-tilt img{transform:rotate(-16deg)}
.f-recolor img{filter:hue-rotate(120deg) saturate(1.6)}
.f-invert{background:#1c1c22}.f-invert img{filter:invert(1)}
.f-shadow img{filter:drop-shadow(5px 7px 3px rgba(0,0,0,.55))}
.f-outline img{outline:3px solid var(--danger);outline-offset:8px}
.f-opacity img{opacity:.35}
.f-busybg{background:repeating-linear-gradient(45deg,#ffd800 0 12px,#fc5b47 12px 24px,#2300c8 24px 36px,#00bd9e 36px 48px)}
.f-crowd img{transform:translateX(-14%)}
.crowd-a,.crowd-b{position:absolute;background:#9aa2b1;border-radius:4px}
.crowd-a{width:34%;height:9px;right:6%;top:38%}.crowd-b{width:24%;height:9px;right:6%;top:55%}
.rcustom-grid{margin-top:14px}
.rcard.rtext{display:flex;align-items:center}
.rcard.rtext figcaption{border-top:none;padding:16px 14px;font-size:13.5px;line-height:1.45}
.rbox img.rfull{max-width:78%;max-height:70%}

/* Signe & photo */
.sym{position:relative;background:#fff;border:1px solid var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;padding:34px}
.sym img{max-width:min(340px,70%);max-height:140px;object-fit:contain}
.sym-dot{position:absolute;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(255,255,255,.9)}
.sym-dot{border:none;cursor:pointer;transition:transform .15s}
.sym-dot:hover,.sym-dot.hl{transform:translate(-50%,-50%) scale(1.35)}
.con-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:34px;pointer-events:none}
.sym-list{margin:12px 0 0;padding:0;list-style:none}
.sym-list li{display:flex;gap:10px;align-items:baseline;font-size:14px;margin-bottom:6px;padding:6px 10px;border-radius:10px;cursor:pointer;transition:background .15s}
.sym-list li.hl{background:var(--panel);box-shadow:0 0 0 1px var(--accent) inset}
.sym-list .n{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.sym-t{font-weight:800}
.ic-note{color:var(--muted);font-size:13.5px;font-style:italic;margin:4px 0 14px}
.icgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:10px;margin-top:14px}
.ic-tile{margin:0;aspect-ratio:1;background:#fff;border:1px solid var(--line);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:18%}
.ic-tile img{max-width:100%;max-height:100%;object-fit:contain}
.tset{border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:14px 0;background:var(--panel)}
.tset-t{margin-bottom:10px;word-break:break-word}
.tset-b{color:var(--ink);max-width:60ch}
.tset-note{color:var(--muted);font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;margin:12px 0 0}
.phwords{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.phword{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:6px 14px;font-size:13.5px;font-weight:600}
.phgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:16px}
.phgrid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;border:1px solid var(--line)}

/* Planche d'ambiance (KB-9) */
.bboard{display:grid;gap:18px;align-items:start;margin-top:6px}
.bboard.has-txt{grid-template-columns:minmax(190px,.85fr) 2.15fr}
.bb-txt .phwords{flex-direction:column;align-items:flex-start}
.bb-title{font-weight:900;font-size:clamp(20px,2.6vw,26px);letter-spacing:-0.02em;margin:0 0 10px;line-height:1.15}
.bb-text{color:var(--muted);font-size:14px;line-height:1.6;margin:0 0 14px;white-space:pre-line}
.bb-grid{display:grid;gap:12px}
.bb-grid.tpl-duo,.bb-grid.tpl-atelier,.bb-grid.tpl-mosaic{grid-template-columns:1fr 1fr}
.bb-grid.tpl-atelier [data-cell="c"]{grid-column:1/-1;aspect-ratio:21/9}
.bb-grid.tpl-galerie{grid-template-columns:2fr 1fr;grid-auto-rows:minmax(120px,20vh)}
.bb-grid.tpl-galerie .bb-cell{aspect-ratio:auto}
.bb-grid.tpl-galerie [data-cell="a"]{grid-row:span 2}
.bb-grid.tpl-pano{grid-template-columns:1fr}
.bb-grid.tpl-pano [data-cell="a"]{aspect-ratio:21/8}
.bb-cell{position:relative;aspect-ratio:1;border-radius:14px;overflow:hidden;border:1px solid var(--line)}
.bb-cell img,.bb-cell video{width:100%;height:100%;object-fit:cover;display:block}
.bb-med{position:absolute;transform:translate(-50%,-50%);width:44%;aspect-ratio:1;border-radius:50%;overflow:hidden;box-shadow:0 4px 22px rgba(0,0,0,.28)}
.bb-med img{width:100%;height:100%;object-fit:cover}
@media (max-width:640px){.bboard.has-txt{grid-template-columns:1fr}}

/* Supports de communication (KB-11) — mockups mk- */
/* Supports : plateaux (stages) de HAUTEUR ALIGNÉE — mockup centré, en-tête
   avec bouton de téléchargement. align-items:stretch = pièces d'une même
   rangée à la même hauteur → mise en page nette, plus « fouillis ». */
.supgrid{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:stretch;margin-top:8px}
.supband{display:flex;flex-direction:column;min-width:0}
.supband.supwide{grid-column:1/-1}
.supband-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 10px}
.supband-head h3{font-size:14px;font-weight:800;margin:0;letter-spacing:-0.01em}
.supdls{display:inline-flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.supdl{display:inline-flex;align-items:center;font-size:12px;padding:6px 12px;text-decoration:none}
.supstage{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 28px;background:var(--bg);border:1px solid var(--line);border-radius:18px;min-width:0}
.supcap{width:100%;min-width:0}
.supcap .mk-browser,.supcap .mk-phone{margin-left:auto;margin-right:auto}
.supcap .mk-bizrow{justify-content:center}
.supzip-row{margin:28px 0 0;text-align:center}
.packlist{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px;max-width:620px}
.packlist li{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.packlist b{font-size:14px;font-weight:800;letter-spacing:-0.01em}
.packlist span{font-size:12.5px;color:var(--muted)}
.packdl-row{margin:22px 0 0}
.supgal-title{font-size:14px;font-weight:800;margin:26px 0 0;letter-spacing:-0.01em}
.mk-browser{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;max-width:760px}
.mk-bar{display:flex;align-items:center;gap:12px;padding:9px 14px;background:#eceef2;border-bottom:1px solid #dfe2e8}
.mk-dots{display:inline-flex;gap:5px}
.mk-dots i{width:9px;height:9px;border-radius:50%;background:#c9ced8}
.mk-url{display:inline-flex;align-items:center;gap:7px;background:#fff;border-radius:8px;padding:4px 12px;font-size:11px;color:#5b6170;flex:1;max-width:340px}
.mk-fav{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.mk-page{background:#fff}
.mk-nav{display:flex;align-items:center;gap:14px;padding:12px 18px}
.mk-navlogo img{height:22px;max-width:110px;object-fit:contain;display:block}
.mk-nav>b{font-size:14px;color:#15171c;letter-spacing:-0.02em}
.mk-links{display:inline-flex;gap:14px;margin-left:auto}
.mk-links i{font-style:normal;font-size:11px;color:#5b6170;font-weight:600}
.mk-btn{display:inline-flex;align-items:center;border-radius:8px;padding:5px 13px;font-size:11px;font-weight:700;white-space:nowrap}
.mk-hero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:38px 26px;text-align:center}
.mk-hero strong{font-size:clamp(16px,2.4vw,24px);font-weight:900;letter-spacing:-0.02em;line-height:1.2;max-width:26ch}
.mk-cta{padding:7px 18px;font-size:12px}
.mk-blocks{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:16px 18px}
.mk-blocks i{height:52px;border-radius:9px}
.mk-shot{width:100%;display:block}
.mk-supshot{border-radius:14px}
.mk-bizshot{aspect-ratio:856/540;object-fit:cover;border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.2)}
.mk-phone{position:relative;width:230px;border:1.5px solid var(--line);border-radius:30px;padding:9px;background:#0e0f13;box-shadow:0 10px 34px rgba(0,0,0,.35)}
.mk-notch{position:absolute;top:9px;left:50%;transform:translateX(-50%);width:74px;height:16px;background:#0e0f13;border-radius:0 0 11px 11px;z-index:2}
.mk-screen{border-radius:21px;overflow:hidden;background:#fff;min-height:380px;display:flex;flex-direction:column}
.mk-mpage{display:flex;flex-direction:column;flex:1}
.mk-mnav{display:flex;justify-content:center;padding:22px 12px 10px}
.mk-mnav .mk-navlogo img{height:20px;max-width:100px}
.mk-mnav b{font-size:13px;color:#15171c}
.mk-mhero{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:26px 16px;text-align:center;margin:0 10px;border-radius:12px}
.mk-mhero strong{font-size:16px;font-weight:900;letter-spacing:-0.02em}
.mk-mhero span{font-size:10.5px;opacity:.85}
.mk-mrows{display:flex;flex-direction:column;gap:8px;padding:12px 10px 0}
.mk-mrows i{height:34px;border-radius:8px}
.mk-mcta{align-self:center;margin:14px 0 18px;padding:7px 18px;font-size:11.5px}
.mk-bizrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,270px));gap:16px}
.mk-biz{aspect-ratio:856/540;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px;text-align:center;box-shadow:0 6px 22px rgba(0,0,0,.2)}
.mk-recto{background:#fff;border:1px solid var(--line)}
.mk-bizlogo img{height:34px;max-width:130px;object-fit:contain;display:block;margin-bottom:4px}
.mk-recto b{font-size:16px;color:#15171c;font-weight:900;letter-spacing:-0.02em}
.mk-recto span{font-size:10.5px;color:#5b6170}
.mk-verso b{font-size:14px;font-weight:800}
.mk-verso span{font-size:10.5px;opacity:.88}
.mk-socialrow{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.mk-avatar{width:84px;height:84px;border-radius:50%;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.mk-avatar img{width:66%;height:66%;object-fit:contain}
.mk-avatar b{font-size:30px;color:#15171c}
.mk-banner{flex:1;min-width:240px;aspect-ratio:3.4/1;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:14px;padding:14px 20px;overflow:hidden}
.mk-avatarshot{width:84px;height:84px;border-radius:50%;object-fit:cover;border:1px solid var(--line);flex-shrink:0}
.mk-bannershot{flex:1;min-width:240px;aspect-ratio:3.4/1;object-fit:cover;border-radius:14px}
.mk-bannerlogo img{height:30px;max-width:110px;object-fit:contain;display:block}
.mk-banner>span{font-size:clamp(13px,1.8vw,17px);font-weight:800;letter-spacing:-0.02em}
@media (max-width:760px){.supgrid{grid-template-columns:1fr}.mk-links{display:none}}

/* Changelog + footer + états */
details.chlog{margin-top:10px}
details.chlog summary{cursor:pointer;color:var(--muted);font-size:13px}
.chlog li{font-size:13px;color:var(--muted);margin:4px 0}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12.5px}
footer a{color:inherit;text-decoration:none}
footer a:hover{text-decoration:underline}
.state{max-width:420px;margin:16vh auto;text-align:center;padding:0 20px}
.state h1{font-weight:900;letter-spacing:-0.02em}
.state input{width:100%;margin:10px 0;padding:12px;font-size:15px;text-align:center}
.toast{position:fixed;bottom:24px;left:50%;transform:translate(-50%,12px);background:#1c1f28;color:#fff;padding:10px 18px;border-radius:11px;font-size:13.5px;opacity:0;pointer-events:none;transition:.2s;z-index:20}
.toast.show{opacity:1;transform:translate(-50%,0)}

@media print{
  /* Sans ceci, le navigateur n'imprime PAS les couleurs de fond :
     croix rouges, pastilles de couleur et aplats disparaîtraient du PDF. */
  *,*::before,*::after{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  .nav,.ldl,.bgchips,.tctl,.print,.no-print{display:none !important}
  body{background:#fff}
  .card,.hero,.pl-solo{border-color:#ddd;break-inside:avoid}
  /* Édition paginée : couverture et intercalaires = une page chacun. */
  .cover{min-height:96vh;page-break-after:always}
  .toc{page-break-after:always;padding:60px 24px}
  .chap{page-break-before:always;padding:110px 24px}
  section{padding:34px 24px 24px}
}
@media (max-width:560px){
  .hero{padding:40px 18px}
  .lgrid,.cgrid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div id="app"><div class="state"><p class="hint">Chargement de la charte…</p></div></div>
<div class="toast" id="toast"></div>
<script type="module" nonce="${nonce}">
const SLUG = ${JSON.stringify(String(slug || ''))};
const API = '/api/keybrand/public/' + encodeURIComponent(SLUG);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app = document.getElementById('app');
let CODE = sessionStorage.getItem('kb_code_' + SLUG) || '';
let DATA = null, BG = 'ck';
const DL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="margin-right:6px;vertical-align:-2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

const fileUrl = (id, dl) => API + '/file/' + encodeURIComponent(id) + '?x=1' + (CODE ? '&code=' + encodeURIComponent(CODE) : '') + (dl ? '&dl=1' : '');

// ── Utilitaires (copies volontaires de key-brand-tools.js — page autoportée) ──
function hexToRgb(h){const m=String(h||'').match(/^#?([0-9a-fA-F]{6})$/);if(!m)return null;const n=parseInt(m[1],16);return{r:n>>16&255,g:n>>8&255,b:n&255}}
function lin(v){v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)}
function contrast(a,b){const A=hexToRgb(a),B=hexToRgb(b);if(!A||!B)return null;const la=.2126*lin(A.r)+.7152*lin(A.g)+.0722*lin(A.b),lb=.2126*lin(B.r)+.7152*lin(B.g)+.0722*lin(B.b);const[h,l]=la>=lb?[la,lb]:[lb,la];return(h+.05)/(l+.05)}
function inkOn(h){const r=contrast(h,'#ffffff');return r!==null&&r>=3?'#fff':'#15171c'}
function cmyk(h){const c=hexToRgb(h);if(!c)return'';let{r,g,b}=c;r/=255;g/=255;b/=255;const k=1-Math.max(r,g,b);if(k>=1)return'0 0 0 100';const f=v=>Math.round((1-v-k)/(1-k)*100);return f(r)+' '+f(g)+' '+f(b)+' '+Math.round(k*100)}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('show'),2200)}
async function copy(txt){try{await navigator.clipboard.writeText(txt);toast(txt+' copié')}catch(_){toast('Copie impossible')}}
function saveBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function safeName(n){return(String(n||'').replace(/[/\\\\:*?"<>|]+/g,' ').replace(/\\s+/g,' ').trim().slice(0,80))||'fichier'}
function loadImg(u){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Image illisible'));i.src=u})}
// Rasterisation DOM→PNG (charte interactive) : capture un support TEL QU'AFFICHÉ
// — mockup composé OU visuel importé. On garde les classes et on EMBARQUE la
// feuille de styles de la page dans le foreignObject (inliner tous les styles
// calculés donnait un SVG énorme et invalide) + variables :root sur la racine
// + images en data-URI (sinon non rendues).
let _pageCss=null;
function pageCss(){if(_pageCss==null)_pageCss=[...document.querySelectorAll('style')].map(s=>s.textContent).join('\\n');return _pageCss}
async function _inlineImgs(src,dst){
  const si=src.querySelectorAll('img'),di=dst.querySelectorAll('img');
  for(let i=0;i<si.length;i++){
    try{const r=await fetch(si[i].currentSrc||si[i].src);const b=await r.blob();
      const d=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(b)});
      if(di[i])di[i].setAttribute('src',d);
    }catch(_){}}
}
async function captureNode(node){
  const rect=node.getBoundingClientRect();
  const w=Math.max(1,Math.ceil(rect.width)),h=Math.max(1,Math.ceil(rect.height));
  const clone=node.cloneNode(true);
  await _inlineImgs(node,clone);
  const rc=getComputedStyle(document.documentElement);
  clone.style.margin='0';
  ['--ink','--muted','--line','--bg','--panel','--accent','--danger','--ok'].forEach(v=>clone.style.setProperty(v,rc.getPropertyValue(v)));
  const inner=new XMLSerializer().serializeToString(clone);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><foreignObject x="0" y="0" width="'+w+'" height="'+h+'"><div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA['+pageCss()+']]></style>'+inner+'</div></foreignObject></svg>';
  const img=await loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));
  const scale=3,cv=document.createElement('canvas');cv.width=w*scale;cv.height=h*scale;
  const ctx=cv.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
  return await new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('rendu vide')),'image/png'));
}
async function exportPng(blob,mime,w,bg){
  w=Math.max(16,Math.min(6000,Math.round(w)));let url,h=null;
  if(mime==='image/svg+xml'){let t=await blob.text();const vb=t.match(/viewBox\\s*=\\s*["']\\s*([\\d.eE+-]+)[ ,]+([\\d.eE+-]+)[ ,]+([\\d.eE+-]+)[ ,]+([\\d.eE+-]+)/);let ratio=1;if(vb){const W=parseFloat(vb[3]),H=parseFloat(vb[4]);if(W>0&&H>0)ratio=H/W}
    h=Math.max(1,Math.round(w*ratio));
    t=t.replace(/<svg([^>]*?)\\s(width|height)\\s*=\\s*["'][^"']*["']/gi,'<svg$1').replace(/<svg([^>]*?)\\s(width|height)\\s*=\\s*["'][^"']*["']/gi,'<svg$1').replace(/<svg/i,'<svg width="'+w+'" height="'+h+'"');
    url=URL.createObjectURL(new Blob([t],{type:'image/svg+xml'}));
  } else url=URL.createObjectURL(blob);
  try{const img=await loadImg(url);const iw=img.naturalWidth||w,ih=img.naturalHeight||h||w;if(h===null)h=Math.max(1,Math.round(w*ih/iw));
    const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
    if(bg){x.fillStyle=bg;x.fillRect(0,0,w,h)}x.imageSmoothingQuality='high';x.drawImage(img,0,0,w,h);
    // toBlob peut ne jamais rappeler (renderers throttlés) → repli toDataURL.
    return await new Promise((res,rej)=>{let done=false;const fin=b=>{if(!done){done=true;b?res(b):rej(new Error('Export impossible'))}};
      try{c.toBlob(b=>fin(b),'image/png')}catch(_){}
      setTimeout(()=>{if(done)return;try{const bin=atob(c.toDataURL('image/png').split(',')[1]);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);fin(new Blob([u],{type:'image/png'}))}catch(e){fin(null)}},1500)});
  } finally{URL.revokeObjectURL(url)}
}
let crcT=null;function crc32(u){if(!crcT){crcT=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcT[n]=c>>>0}}let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=crcT[(c^u[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0}
function buildZip(files){const enc=new TextEncoder();const parts=[],cen=[];let off=0;const d=new Date();
  const T=((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1))&0xFFFF,D=(((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF;
  const u16=v=>new Uint8Array([v&255,v>>8&255]),u32=v=>new Uint8Array([v&255,v>>8&255,v>>16&255,v>>>24&255]);
  for(const f of files){const n=enc.encode(f.name),data=f.data,crc=crc32(data);
    const loc=[u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(T),u16(D),u32(crc),u32(data.length),u32(data.length),u16(n.length),u16(0),n,data];
    cen.push({n,crc,size:data.length,off});parts.push(...loc);off+=loc.reduce((s,p)=>s+p.length,0)}
  const cd=off;for(const c of cen){parts.push(u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(T),u16(D),u32(c.crc),u32(c.size),u32(c.size),u16(c.n.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(c.off),c.n);off+=46+c.n.length}
  parts.push(u32(0x06054b50),u16(0),u16(0),u16(cen.length),u16(cen.length),u32(off-cd),u32(cd),u16(0));
  return new Blob(parts,{type:'application/zip'})}

// ── Pack de marque (KB-EXPORT-1) ────────────────────────────────
// Sérialise la charte publiée (DATA.kit) en dossier machine-readable :
//   design-tokens.json (format DTCG) · design-system-spec.json ·
//   brand.md (lisible humain + IA) · logo/*.  → un ZIP à glisser dans
//   Claude Design (voie « upload brut ») ou un outil de tokens.
const _hx6=h=>/^#[0-9a-fA-F]{6}$/.test(String(h||''));
const _tslug=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
async function buildPack(){
  const NL=String.fromCharCode(10),BT=String.fromCharCode(96);   // saut de ligne et backtick sans littéral (template literal serveur)
  const kit=DATA.kit||{},meta=kit.meta||{};
  const palette=(kit.colors&&kit.colors.palette||[]).filter(c=>c&&_hx6(c.hex));
  const fonts=(kit.typography&&kit.typography.fonts||[]).filter(f=>f&&f.family);
  const variants=(kit.logo&&kit.logo.variants||[]).filter(v=>v&&v.assetId);

  // 1) design-tokens.json (DTCG).
  const color={},usedC={};
  palette.forEach((c,i)=>{let n=_tslug(c.name)||('couleur-'+(i+1));if(usedC[n])n=n+'-'+(i+1);usedC[n]=1;
    color[n]={$type:'color',$value:c.hex.toLowerCase()};
    if(_hx6(c.nightHex))color[n+'-dark']={$type:'color',$value:c.nightHex.toLowerCase()}});
  const fontFamily={},fontWeight={},usedF={};
  fonts.forEach((f,i)=>{let n=f.role&&!usedF[f.role]?f.role:('police-'+(i+1));usedF[n]=1;
    fontFamily[n]={$type:'fontFamily',$value:f.family};
    if(f.source==='google'&&f.axis){const ws=weightsOf(f.axis)||[];if(ws.length)fontWeight[n]={$type:'number',$value:ws.includes(700)?700:(ws.includes(400)?400:ws[0])}}});
  const tokens={color};
  if(Object.keys(fontFamily).length)tokens.fontFamily=fontFamily;
  if(Object.keys(fontWeight).length)tokens.fontWeight=fontWeight;

  // 2) design-system-spec.json (manifeste lu par Claude Design).
  const spec={schemaVersion:'1.0',systemName:DATA.name||meta.name||'Marque',
    paths:{tokens:'design-tokens.json',assets:'logo/'},framework:'html',
    generatedBy:'Key Brand',version:DATA.version||1};

  // 3) brand.md (une seule fiche compacte, lisible humain + IA).
  const FL={distort:'Ne pas déformer le logo',tilt:'Ne pas l’incliner',recolor:'Ne pas changer ses couleurs',invert:'Ne pas l’inverser en négatif',shadow:'Ne pas ajouter d’ombre ni d’effet',outline:'Ne pas l’encadrer d’un filet',opacity:'Ne pas baisser son opacité',busybg:'Ne pas le poser sur un fond chargé',crowd:'Ne pas envahir sa zone de protection'};
  const RL={title:'Titrage',body:'Texte courant',office:'Bureautique',substitution:'Substitution'};
  const inter=(kit.rules&&kit.rules.interdits||[]).filter(r=>r.enabled!==false).map(r=>FL[r.key]||r.key);
  const customR=(kit.rules&&kit.rules.custom||[]).filter(r=>r.label);
  const identity=kit.identity||{},voice=identity.voice||{};
  let md='# '+(DATA.name||'Marque')+' — pack de marque'+NL+NL;
  if(meta.baseline)md+='> '+meta.baseline+NL+NL;
  if(palette.length){md+='## Couleurs'+NL+NL;palette.forEach(c=>{md+='- **'+(c.name||c.hex)+'** '+BT+c.hex.toLowerCase()+BT+' — rôle : '+(c.role||'—')+(_hx6(c.nightHex)?' · sombre '+BT+c.nightHex.toLowerCase()+BT:'')+NL})}
  if(fonts.length){md+=NL+'## Typographies'+NL+NL;fonts.forEach(f=>{md+='- **'+f.family+'** — '+(RL[f.role]||f.role||'')+' ('+(f.source==='google'?'Google Fonts':'à installer')+(f.axis?', graisses '+String(f.axis).replace(/;/g,', '):'')+')'+(f.buyUrl?' — '+f.buyUrl:'')+NL})}
  if(variants.length){md+=NL+'## Logo'+NL+NL;variants.forEach(v=>{md+='- '+(v.label||'Logo')+' → '+BT+'logo/'+safeName(v.label||'logo')+'.'+v.ext+BT+NL})}
  if(inter.length||customR.length){md+=NL+'## Règles d’usage'+NL+NL;inter.forEach(x=>{md+='- '+x+NL});customR.forEach(r=>{md+='- '+(r.kind==='good'?'[bon usage] ':'[à éviter] ')+r.label+NL})}
  if(identity.mission||voice.principles&&voice.principles.length||voice.use||voice.avoid){md+=NL+'## Marque & ton de voix'+NL+NL;
    if(identity.mission)md+='**Mission :** '+identity.mission+NL+NL;
    if(voice.principles&&voice.principles.length)md+='Principes : '+voice.principles.filter(Boolean).join(' · ')+NL+NL;
    if(voice.use)md+='À privilégier : '+voice.use+NL+NL;
    if(voice.avoid)md+='À éviter : '+voice.avoid+NL+NL}
  md+=NL+'---'+NL+'Généré depuis Key Brand — charte « '+(DATA.name||'Marque')+' », version '+(DATA.version||1)+'.'+NL;

  // 4) Assemblage du ZIP (JSON + md + fichiers logo en original).
  const enc=new TextEncoder();
  const files=[
    {name:'design-tokens.json',data:enc.encode(JSON.stringify(tokens,null,2))},
    {name:'design-system-spec.json',data:enc.encode(JSON.stringify(spec,null,2))},
    {name:'brand.md',data:enc.encode(md)},
  ];
  const used={};
  for(const v of variants){
    try{const b=await(await fetch(fileUrl(v.assetId,true))).blob();
      let base=safeName(v.label||'logo'),n='logo/'+base+'.'+v.ext;
      for(let i=2;used[n];i++)n='logo/'+base+'-'+i+'.'+v.ext;used[n]=1;
      files.push({name:n,data:new Uint8Array(await b.arrayBuffer())})}
    catch(_){/* un logo indisponible ne bloque pas le pack */}
  }
  saveBlob(buildZip(files),safeName(DATA.name)+' — design-system.zip');
}
function loadFont(fam,axis){const id='pf-'+fam.toLowerCase().replace(/[^a-z0-9]+/g,'-');if(document.getElementById(id))return;
  const l=document.createElement('link');l.id=id;l.rel='stylesheet';
  const f=encodeURIComponent(fam).replace(/%20/g,'+');const spec=axis&&axis!=='400'?':wght@'+axis:'';
  l.href='https://fonts.googleapis.com/css2?family='+f+spec+'&display=swap';document.head.appendChild(l)}
function weightsOf(axis){if(!axis)return[400];if(axis.includes('..')){const[a,b]=axis.split('..').map(Number);const o=[];for(let w=Math.ceil(a/100)*100;w<=b;w+=100)o.push(w);if(!o.includes(a))o.unshift(a);return o}return axis.split(';').map(Number)}

// ── Chargement ──
async function boot(){
  let res;
  try{res=await fetch(API+(CODE?'?code='+encodeURIComponent(CODE):''))}catch(_){return renderState('Charte indisponible','Vérifiez votre connexion puis rechargez.')}
  if(res.status===401){return renderCodeForm()}
  if(!res.ok){return renderState('Charte introuvable','Ce lien ne correspond à aucune charte publiée.')}
  DATA=await res.json();
  document.title='Charte graphique — '+(DATA.name||'');
  render();
}
function renderState(t,p){app.innerHTML='<div class="state"><h1>'+esc(t)+'</h1><p class="hint">'+esc(p)+'</p></div>'}
function renderCodeForm(){
  app.innerHTML='<div class="state"><h1>Charte protégée</h1><p class="hint">Entrez le code d\\'accès transmis par la marque.</p>'+
    '<input type="text" id="codein" placeholder="Code d\\'accès" autocomplete="off">'+
    '<button class="btn primary" id="codego">Ouvrir la charte</button><p class="hint" id="codeerr"></p></div>';
  const go=()=>{CODE=document.getElementById('codein').value.trim();if(!CODE)return;
    sessionStorage.setItem('kb_code_'+SLUG,CODE);
    document.getElementById('codeerr').textContent='';boot().then(()=>{if(!DATA)document.getElementById('codeerr')&&(document.getElementById('codeerr').textContent='Code refusé.')})};
  document.getElementById('codego').addEventListener('click',go);
  document.getElementById('codein').addEventListener('keydown',e=>{if(e.key==='Enter')go()});
}

// ── Rendu (géométrie variable : on ne montre QUE ce qui existe) ──
function render(){
  const kit=DATA.kit||{},meta=kit.meta||{};
  const variants=(kit.logo&&kit.logo.variants||[]).filter(v=>v&&v.assetId);
  const rasterV=variants.filter(v=>v.ext!=='pdf');
  const palette=(kit.colors&&kit.colors.palette||[]).filter(c=>c&&hexToRgb(c.hex));
  const fonts=(kit.typography&&kit.typography.fonts||[]).filter(f=>f&&f.family);
  const inter=(kit.rules&&kit.rules.interdits||[]).filter(r=>r.enabled!==false).map(r=>r.key);
  const customR=(kit.rules&&kit.rules.custom||[]).filter(r=>r.label);
  const sym=(kit.branding&&kit.branding.symbolism||[]).filter(s=>s.text);
  const photo=kit.branding&&kit.branding.photo||null;
  const phWords=(photo&&photo.words||[]).filter(Boolean);
  const phIds=photo&&photo.exampleAssetIds||[];
  const prot=kit.logo&&kit.logo.protection;const mins=kit.logo&&kit.logo.minSizes;
  const primary=palette.find(c=>c.role==='primary')||palette[0];
  if(primary)document.documentElement.style.setProperty('--accent',primary.hex);
  const titleFont=fonts.find(f=>f.role==='title'&&f.source==='google');
  for(const f of fonts)if(f.source==='google')loadFont(f.family,f.axis);
  const heroLogo=rasterV[0];

  // Supports (KB-11) — présent SEULEMENT si le snapshot contient kit.supports
  // (opt-in : l'onglet a été ouvert puis la charte republiée).
  const SUP=(kit.supports&&typeof kit.supports==='object')?kit.supports:null;
  const supOn=k=>SUP&&(!SUP.enabled||SUP.enabled[k]!==false);
  const supGallery=SUP&&Array.isArray(SUP.gallery)?SUP.gallery.filter(Boolean):[];
  const showSupports=!!SUP&&(supOn('web')||supOn('phone')||supOn('card')||supOn('social')||supGallery.length>0);

  // Planche d'ambiance — calculée tôt (elle décide du chapitre « Univers »).
  const BD=(kit.branding&&kit.branding.board)||{};
  const BD_SLOTS={duo:['a','b'],atelier:['a','b','c'],galerie:['a','b','c'],mosaic:['a','b','c','d'],pano:['a']};
  const bdTpl=BD_SLOTS[BD.template]?BD.template:'atelier';
  const bdCells=BD_SLOTS[bdTpl].map(sl=>[sl,BD.cells&&BD.cells[sl]]).filter(p=>p[1]&&p[1].assetId);
  // Iconographie (KB-14)
  const IC=(kit.icons&&typeof kit.icons==='object')?kit.icons:{};
  const icIds=(Array.isArray(IC.assetIds)?IC.assetIds:[]).filter(Boolean);
  const showIcons=!!(IC.stroke||IC.corners||IC.weight||IC.note||icIds.length);
  const showBrand=bdCells.length>0||(sym.length&&rasterV.length)||phWords.length>0||phIds.length>0||showIcons;

  // Édition (KB-12) : thème publié — fond clair/sombre + teinte des
  // intercalaires (réglage éditeur ; défaut = couleur primaire).
  const PUB=(kit.settings&&kit.settings.pub)||{};
  if(PUB.mode==='dark')document.body.classList.add('dark');else document.body.classList.remove('dark');
  const TINT=(hexToRgb(PUB.tint)?PUB.tint:null)||(primary?primary.hex:null)||'#23252d';
  const TINTINK=inkOn(TINT);
  const TINTSOFT=TINTINK==='#fff'?'rgba(255,255,255,.55)':'rgba(0,0,0,.45)';

  // Identité & ton de voix (KB-13) — le chapitre d'ouverture de l'édition.
  const IDN=(kit.identity&&typeof kit.identity==='object')?kit.identity:{};
  const IDV=(Array.isArray(IDN.values)?IDN.values:[]).filter(Boolean);
  const VO=(IDN.voice&&typeof IDN.voice==='object')?IDN.voice:{};
  const VOP=(Array.isArray(VO.principles)?VO.principles:[]).filter(Boolean);
  const showIdent=!!(IDN.mission||IDV.length||IDN.story);
  const showVoice=!!(VO.reg||VOP.length||VO.use||VO.avoid||VO.example);
  const showMarque=showIdent||showVoice;
  // Pack de marque (KB-EXPORT-1) : dès qu'il y a de la matière à exporter.
  const showPack=palette.length>0||fonts.length>0||variants.length>0;

  const navLinks=[];
  if(showMarque)navLinks.push(['#marque','La marque']);
  if(variants.length)navLinks.push(['#logo','Logotype']);
  if(palette.length)navLinks.push(['#couleurs','Couleurs']);
  if(fonts.length)navLinks.push(['#typos','Typographies']);
  if((rasterV.length&&inter.length)||customR.length)navLinks.push(['#regles','Règles']);
  if(showBrand)navLinks.push(['#univers','Univers']);
  if(showPack)navLinks.push(['#pack','Design System']);
  if(showSupports)navLinks.push(['#supports','Supports']);
  // Intercalaire de chapitre — numérotation dynamique (géométrie variable).
  let chapN=0;
  const chap=(id,title)=>{chapN++;return '<div class="chap" id="'+id+'" style="background:'+TINT+'"><div class="chap-in"><span class="chap-n" style="color:'+TINTSOFT+'">'+String(chapN).padStart(2,'0')+'</span><h2 style="color:'+TINTINK+'">'+title+'</h2></div></div>'};

  const FLABELS={distort:'Ne pas déformer le logo',tilt:'Ne pas l\\'incliner',recolor:'Ne pas changer ses couleurs',invert:'Ne pas l\\'inverser en négatif',shadow:'Ne pas ajouter d\\'ombre ni d\\'effet',outline:'Ne pas l\\'encadrer d\\'un filet',opacity:'Ne pas baisser son opacité',busybg:'Ne pas le poser sur un fond chargé',crowd:'Ne pas envahir sa zone de protection'};
  const ROLES={primary:'Primaire',secondary:'Secondaire',extra:'Supplémentaire',bg:'Fond',text:'Texte'};
  const FROLES={title:'Titrage',body:'Texte courant',office:'Bureautique',substitution:'Substitution'};
  const KINDS={color:'Couleur',negative:'Négatif (réserve)',mono:'Monochrome',grayscale:'Niveaux de gris',simplified:'Simplifiée'};

  let h='<div class="nav"><div class="nav-in"><span class="nav-name">'+esc(DATA.name)+'</span>';
  for(const[a,l]of navLinks)h+='<a href="'+a+'">'+l+'</a>';
  h+='<span class="sp"></span><span class="vbadge">Version '+DATA.version+' — '+new Date(DATA.updated_at+'Z').toLocaleDateString('fr-FR')+'</span>'+
     '<button class="print" id="printbtn">Exporter en PDF</button></div></div>';

  // Héros — scène d'ouverture (KB-8 : fond, mise en scène, encre, tempo)
  const SC=(kit.branding&&kit.branding.scene)||{};
  const scBg=['white','color','gradient','image','video'].includes(SC.bgType)?SC.bgType:'white';
  const scLay=['center','corner','split'].includes(SC.layout)?SC.layout:'center';
  const scMedia=(scBg==='image'||scBg==='video')&&SC.assetId?SC.assetId:null;
  const relL=c=>{const r=hexToRgb(c);return r?.2126*lin(r.r)+.7152*lin(r.g)+.0722*lin(r.b):1};
  // Encre : auto = claire sur média ou couleur sombre ; scène sans fond
  // défini → la couverture prend la TEINTE de l'édition (encre assortie).
  let scInk=['light','dark'].includes(SC.ink)?SC.ink:'auto';
  if(scBg==='white')scInk=(TINTINK==='#fff'?'light':'dark');
  else if(scInk==='auto')scInk=scMedia?'light':(SC.c1&&relL(SC.c1)<.45?'light':'dark');
  const inkName=scInk==='light'?'#ffffff':scInk==='dark'?'#15171c':null;
  const inkBase=scInk==='light'?'rgba(255,255,255,.78)':scInk==='dark'?'#5b6170':null;
  let heroStyle='';
  if(scBg==='color'&&SC.c1)heroStyle=' style="background:'+esc(SC.c1)+'"';
  else if(scBg==='gradient'&&SC.c1&&SC.c2)heroStyle=' style="background:linear-gradient(135deg,'+esc(SC.c1)+','+esc(SC.c2)+')"';
  // Édition : scène sans fond défini → la couverture prend la TEINTE.
  if(scBg==='white')heroStyle=' style="background:'+TINT+'"';
  // Titre & texte propres à la scène (priment sur nom/baseline s'ils existent).
  const rawName=String((SC.title&&String(SC.title).trim())||meta.name||DATA.name);
  const heroText=String((SC.text&&String(SC.text).trim())||meta.baseline||'');
  const tSize=Math.min(1.8,Math.max(0.6,Number(SC.titleSize)||1));
  const bSize=Math.min(1.8,Math.max(0.6,Number(SC.textSize)||1));
  let nameHtml=esc(rawName);
  let nmSt='--ts:'+tSize+';';
  if(titleFont)nmSt+='font-family:\\''+esc(titleFont.family)+'\\',sans-serif;';
  if(inkName)nmSt+='color:'+inkName;
  // Couverture pleine page (scène KB-8) + mention façon PDF de charte.
  // Le graphiste choisit QUELLE variante ouvre la scène (logo, picto, puce…).
  const coverLogo=SC.logoId==='none'?null:(rasterV.find(v=>v.assetId===SC.logoId)||heroLogo);
  h+='<div class="hero cover'+(scMedia?' has-media':'')+' hlay-'+scLay+'"'+heroStyle+'>'+
     (scMedia?(scBg==='video'
       ?'<video class="hero-media" src="'+fileUrl(scMedia)+'" muted loop autoplay playsinline></video>'
       :'<img class="hero-media" src="'+fileUrl(scMedia)+'" alt="">'):'')+
     (scMedia?'':'<div class="hero-inner">'+
     (coverLogo?'<img src="'+fileUrl(coverLogo.assetId)+'" alt="'+esc(DATA.name)+'">':'')+
     (scLay==='split'&&coverLogo?'<span class="hero-vr"'+(inkBase?' style="background:'+inkBase+'"':'')+'></span>':'')+
     '<div class="hero-txt"><div class="hero-name"'+(nmSt?' style="'+nmSt+'"':'')+'>'+nameHtml+'</div>'+
     (heroText?'<div class="hero-base" style="--bs:'+bSize+';'+(inkBase?'color:'+inkBase:'')+'">'+esc(heroText)+'</div>':'')+
     '</div></div>')+
     '<div class="cover-foot"'+(inkName?' style="color:'+inkName+'"':'')+'>Charte graphique — <b>version '+DATA.version+'</b></div>'+
     '</div>';

  // Sommaire sur aplat (numéros = mêmes chapitres que la nav).
  if(navLinks.length>1){
    h+='<div class="toc" style="background:'+TINT+';color:'+TINTINK+'"><div class="toc-in"><p class="toc-title">Sommaire</p><ol>';
    navLinks.forEach(([a,l],i)=>{h+='<li><a href="'+a+'"><span class="tn" style="color:'+TINTSOFT+'">'+String(i+1).padStart(2,'0')+'</span>'+l+'</a></li>'});
    h+='</ol><div class="tocsep" style="background:'+TINTSOFT+'"></div></div></div>';
  }

  // Chapitre — La marque (identité + ton de voix, KB-13)
  if(showMarque){
    h+=chap('marque','La marque');
    if(showIdent){
      h+='<section><h2>L\\'intention</h2>';
      if(IDN.mission)h+='<p class="idmission"'+(titleFont?' style="font-family:\\''+esc(titleFont.family)+'\\',sans-serif"':'')+'>'+esc(IDN.mission)+'</p>';
      if(IDV.length)h+='<div class="phwords idvals">'+IDV.map(v=>'<span class="phword">'+esc(v)+'</span>').join('')+'</div>';
      if(IDN.story)h+='<p class="idstory">'+esc(IDN.story)+'</p>';
      h+='</section>';
    }
    if(showVoice){
      const REGL={'vous-sobre':'Vouvoiement, ton sobre','vous-chaleureux':'Vouvoiement, ton chaleureux','tu-complice':'Tutoiement, ton complice','tu-direct':'Tutoiement, ton direct'};
      h+='<section><h2>Le ton de voix</h2><p class="sub">Comment la marque parle — partout, à tous.</p>';
      if(REGL[VO.reg])h+='<p class="vo-reg">'+REGL[VO.reg]+'</p>';
      if(VOP.length){h+='<ol class="vo-list">';for(const p of VOP)h+='<li>'+esc(p)+'</li>';h+='</ol>'}
      if(VO.use||VO.avoid){h+='<div class="vo-cols">'+
        (VO.use?'<div class="vo-col ok"><b>À privilégier</b><p>'+esc(VO.use)+'</p></div>':'')+
        (VO.avoid?'<div class="vo-col ko"><b>À éviter</b><p>'+esc(VO.avoid)+'</p></div>':'')+'</div>'}
      if(VO.example)h+='<blockquote class="vo-ex">«&nbsp;'+esc(VO.example)+'&nbsp;»</blockquote>';
      h+='</section>';
    }
  }

  // Chapitre — Logotype
  if(variants.length){
    h+=chap('logo','Logotype');
    if(heroLogo){
      h+='<section><h2>Le logotype</h2><p class="sub">La version de référence — à reproduire sans modification.</p>'+
         '<div class="pl-solo"><img src="'+fileUrl(heroLogo.assetId)+'" alt="'+esc(DATA.name)+'"></div></section>';
    }
    h+='<section><h2>Déclinaisons</h2><p class="sub">Chaque carte a son propre fond d\\'essai — cliquez pour tester la lisibilité, puis téléchargez le format qu\\'il vous faut.</p>';
    h+='<div class="lgrid">';
    for(const v of variants){
      // Fond initial = celui choisi dans l'éditeur (v.bg) ; pastilles PROPRES
      // à la carte → fond indépendant à gauche et à droite.
      const vbg=/^#[0-9a-fA-F]{6}$/.test(v.bg||'')?v.bg:'ck';
      let chips='<div class="bgchips no-print">'
        +'<button class="bgchip ck'+(vbg==='ck'?' on':'')+'" data-bg="ck" title="Transparent"></button>'
        +'<button class="bgchip'+(vbg==='#ffffff'?' on':'')+'" data-bg="#ffffff" style="background:#fff" title="Clair"></button>'
        +'<button class="bgchip'+(vbg==='#0c0d10'?' on':'')+'" data-bg="#0c0d10" style="background:#0c0d10" title="Sombre"></button>';
      for(const c of palette.slice(0,6))chips+='<button class="bgchip'+((vbg||'').toLowerCase()===c.hex.toLowerCase()?' on':'')+'" data-bg="'+esc(c.hex)+'" style="background:'+esc(c.hex)+'" title="'+esc(c.name||c.hex)+'"></button>';
      chips+='</div>';
      h+='<div class="card lcard">'+chips+'<div class="lprev" data-prev data-initbg="'+esc(vbg)+'">'+(v.ext==='pdf'?'<span class="hint">PDF — téléchargeable</span>':'<img src="'+fileUrl(v.assetId)+'" alt="">')+'</div>'+
        '<div class="lmeta"><b>'+esc(v.label||v.name||'Logo')+'</b> <span class="hint">· '+(KINDS[v.kind]||'')+'</span>'+(v.usage?'<div class="lusage">'+esc(v.usage)+'</div>':'')+'</div>'+
        '<div class="ldl"><a class="btn" href="'+fileUrl(v.assetId,true)+'">Original (.'+esc(v.ext)+')</a>';
      if(v.ext!=='pdf'){
        h+='<select data-size><option value="512">512 px</option><option value="1024">1024 px</option><option value="2000" selected>2000 px</option><option value="4096">4096 px</option></select>'+
           '<select data-bgx><option value="">Transparent</option><option value="#ffffff">Blanc</option><option value="#0c0d10">Noir</option></select>'+
           '<button class="btn primary" data-png="'+esc(v.assetId)+'" data-mime="'+esc(v.mime)+'" data-name="'+esc(v.label||v.name||'logo')+'">PNG</button>';
      }
      h+='</div></div>';
    }
    h+='</div>';
    if(variants.length>1)h+='<p class="no-print" style="margin-top:12px"><button class="btn" id="zipbtn">Télécharger le kit (.zip)</button></p>';
    h+='</section>';
    if((prot&&prot.ratio)||mins&&(mins.printMm||mins.digitalPx)){
      h+='<section><h2>Zone de protection & taille minimale</h2><p class="sub">L\\'espace vital du logotype — rien ne doit y entrer.</p><div class="card protec">';
      if(prot&&prot.ratio&&heroLogo)h+='<div class="protec-viz" style="--pm:'+Math.round(prot.ratio*48)+'px"><div class="protec-zone"><img src="'+fileUrl(heroLogo.assetId)+'" alt=""></div></div>';
      h+='<div class="mins">'+(prot&&prot.ratio?'<div><b>Zone de protection</b> : '+prot.ratio+' × '+esc(prot.basis||'hauteur du logo')+' — aucun élément dans la zone en pointillés.</div>':'');
      if(mins&&mins.printMm)h+='<div><b>Taille minimale impression</b> : '+mins.printMm+' mm de large</div>';
      if(mins&&mins.digitalPx)h+='<div><b>Taille minimale numérique</b> : '+mins.digitalPx+' px de large</div>';
      h+='</div></div></section>';
    }
  }

  // Chapitre — Couleurs (pastilles rondes, façon édition)
  if(palette.length){
    h+=chap('couleurs','Couleurs');
    h+='<section><h2>Les couleurs</h2><p class="sub">Cliquez une pastille ou un code pour le copier. CMJN indicatif.</p><div class="crows">';
    for(const c of palette){
      const rgb=hexToRgb(c.hex);
      const rw=contrast(c.hex,'#ffffff'),rb=contrast(c.hex,'#000000');
      h+='<div class="crow"><button class="cdot" data-copy="'+esc(c.hex)+'" title="Copier '+esc(c.hex)+'" style="background:'+esc(c.hex)+'"></button>'+
        '<div class="cinfo"><div class="crow1"><b>'+esc(c.name||c.hex)+'</b><span class="crole">'+(ROLES[c.role]||'')+'</span></div>'+
        '<div class="codes"><button class="code" data-copy="'+esc(c.hex)+'">HEX <b>'+esc(c.hex)+'</b></button>'+
        '<button class="code" data-copy="'+rgb.r+', '+rgb.g+', '+rgb.b+'">RVB <b>'+rgb.r+' '+rgb.g+' '+rgb.b+'</b></button>'+
        '<button class="code" data-copy="'+cmyk(c.hex)+'">CMJN <b>'+cmyk(c.hex)+'</b></button>'+
        (c.pantone?'<button class="code" data-copy="'+esc(c.pantone)+'">PANTONE <b>'+esc(c.pantone)+'</b></button>':'')+'</div>'+
        '<div class="wcags"><span class="wcag '+(rw>=4.5?'ok':'ko')+'">texte sur blanc '+(rw?rw.toFixed(1):'—')+':1</span>'+
        '<span class="wcag '+(rb>=4.5?'ok':'ko')+'">texte sur noir '+(rb?rb.toFixed(1):'—')+':1</span></div>'+
        (c.story?'<p class="cstory">'+esc(c.story)+'</p>':'')+'</div></div>';
    }
    h+='</div></section>';
  }

  // Chapitre — Typographies (alphabet complet + spécimen à essayer)
  if(fonts.length){
    // Couleurs d'essai du spécimen (fond/titre/paragraphe) — palette + noir/blanc.
    const TC=(kit.typography&&kit.typography.specColors)||{};
    const hexOk=v=>/^#[0-9a-fA-F]{6}$/.test(v||'');
    const tcBg=hexOk(TC.bg)?TC.bg:'#ffffff',tcTitle=hexOk(TC.title)?TC.title:'#15171c',tcBody=hexOk(TC.body)?TC.body:'#15171c';
    h+=chap('typos','Typographies');
    h+='<section><h2>La typographie</h2><p class="sub">L\\'alphabet complet de chaque police — réglez la graisse et la couleur pour l\\'essayer.</p>';
    for(const f of fonts){
      const gg=f.source==='google';
      const fam=gg?'\\''+esc(f.family)+'\\', sans-serif':'inherit';
      const ws=gg?weightsOf(f.axis):[400];
      const w0=ws.includes(700)?700:ws[Math.floor(ws.length/2)];
      // Contrôles interactifs en TÊTE de carte : graisse + couleur d'essai de
      // l'alphabet, limitée aux couleurs de la charte (+ encre par défaut).
      let ctl='';
      if(gg){
        ctl='<div class="tctl no-print"><label class="tctl-g">Graisse <select data-w>'+ws.map(w=>'<option'+(w===w0?' selected':'')+'>'+w+'</option>').join('')+'</select></label>'+
          '<span class="tcolors"><button class="tcsw on" data-tc="#15171c" style="background:#15171c" title="Encre" aria-label="Encre"></button>';
        for(const c of palette.slice(0,8))ctl+='<button class="tcsw" data-tc="'+esc(c.hex)+'" style="background:'+esc(c.hex)+'" title="'+esc(c.name||c.hex)+'" aria-label="'+esc(c.name||c.hex)+'"></button>';
        ctl+='</span></div>';
      }
      h+='<div class="card tcard" data-font><div class="thead"><span class="fam"'+(gg?' style="font-family:'+fam+'"':'')+'>'+esc(f.family)+'</span>'+
         '<span class="role">'+(FROLES[f.role]||'')+'</span>'+
         (gg?'<a class="btn" href="https://fonts.google.com/specimen/'+encodeURIComponent(f.family).replace(/%20/g,'+')+'" target="_blank" rel="noopener noreferrer">Télécharger</a>'
            :(f.buyUrl&&/^https?:/.test(f.buyUrl)?'<a class="btn" href="'+esc(f.buyUrl)+'" target="_blank" rel="noopener noreferrer">Où l\\'obtenir</a>':''))+'</div>'+
         ctl+
         (gg?'<div class="talpha" data-alpha style="font-family:'+fam+';font-weight:'+w0+';color:#15171c">ABCDEFGHIJKLM<br>NOPQRSTUVWXYZ<br>abcdefghijklm nopqrstuvwxyz<br>0123456789</div>'+
             // Réglages prescrits par le graphiste (f.spec, persistés dans la charte).
             (f.spec&&f.spec.title?'<div class="tset" style="background:'+tcBg+'"><div class="tset-t" style="font-family:'+fam+
               ';font-weight:'+(+f.spec.title.w||700)+';font-size:'+Math.min(60,+f.spec.title.size||34)+'px'+
               (f.spec.title.ital?';font-style:italic':'')+';line-height:'+(+f.spec.title.lh||1.15)+
               ';text-align:'+esc(f.spec.title.align||'left')+';color:'+tcTitle+'">'+esc(meta.baseline||DATA.name)+'</div>'+
               '<div class="tset-b" style="font-family:'+fam+';font-weight:'+(+f.spec.body.w||400)+
               ';font-size:'+Math.min(24,+f.spec.body.size||17)+'px'+(f.spec.body.ital?';font-style:italic':'')+
               ';line-height:'+(+f.spec.body.lh||1.5)+';text-align:'+esc(f.spec.body.align||'left')+';color:'+tcBody+
               '">Voici comment cette police compose un paragraphe : la graisse, le corps, l\\'interligne et l\\'alignement prescrits par la charte, appliqués à un texte courant.</div>'+
               '<p class="tset-note">Titrage '+(+f.spec.title.w||700)+' · '+(+f.spec.title.size||34)+' px — Courant '+(+f.spec.body.w||400)+' · '+(+f.spec.body.size||17)+' px · interligne '+(+f.spec.body.lh||1.5)+'</p></div>':'')
            :'<p class="hint">Police déclarée — aperçu indisponible (non hébergée).</p>')+
         '</div>';
    }
    h+='</section>';
  }

  // Chapitre — Règles d'usage
  if((rasterV.length&&inter.length)||customR.length){
    h+=chap('regles','Règles d\\'usage');
    h+='<section><h2>Les interdits</h2><p class="sub">Ce qui protège l\\'identité de la marque.</p>';
    if(rasterV.length&&inter.length){
      const lg=fileUrl(rasterV[0].assetId);
      h+='<div class="rgrid"><figure class="card rcard good"><div class="rbox"><img src="'+lg+'" alt=""></div><figcaption>✓ Le bon usage</figcaption></figure>';
      for(const k of inter){if(!FLABELS[k])continue;
        h+='<figure class="card rcard"><div class="rbox f-'+k+'"><img src="'+lg+'" alt="">'+(k==='crowd'?'<span class="crowd-a"></span><span class="crowd-b"></span>':'')+'<span class="rslash"></span></div><figcaption>✕ '+FLABELS[k]+'</figcaption></figure>';
      }
      h+='</div>';
    }
    if(customR.length){
      h+='<div class="rgrid rcustom-grid">';
      for(const r of customR){
        const good=r.kind==='good', mark=good?'✓ ':'✕ ', gc=good?' good':'';
        if(r.assetId){
          h+='<figure class="card rcard'+gc+'"><div class="rbox"><img class="rfull" src="'+fileUrl(r.assetId)+'" alt="">'+(good?'':'<span class="rslash"></span>')+'</div><figcaption>'+mark+esc(r.label)+'</figcaption></figure>';
        }else{
          h+='<figure class="card rcard rtext'+gc+'"><figcaption>'+mark+esc(r.label)+'</figcaption></figure>';
        }
      }
      h+='</div>';
    }
    h+='</section>';
  }

  // Chapitre — Univers de marque (symbolique + ambiance + direction photo)
  const wordChips=phWords.length?'<div class="phwords">'+phWords.map(w=>'<span class="phword">'+esc(w)+'</span>').join('')+'</div>':'';
  if(showBrand){
    h+=chap('univers','Univers de marque');
    if(sym.length&&heroLogo){
      const CON=(kit.branding&&kit.branding.construction)||{};
      h+='<section><h2>La symbolique du signe</h2><p class="sub">Ce que raconte le logo — cliquez un repère pour le visiter.</p><div class="sym">'+
         '<img src="'+fileUrl(heroLogo.assetId)+'" alt="">';
      if(CON.assetId)h+='<img class="con-overlay" id="conov" src="'+fileUrl(CON.assetId)+'" style="opacity:'+(+CON.opacity||0.5)+'" alt="">';
      sym.forEach((s,i)=>{h+='<button class="sym-dot" data-sym="'+i+'" style="left:'+(s.x*100).toFixed(1)+'%;top:'+(s.y*100).toFixed(1)+'%">'+(i+1)+'</button>'});
      h+='</div>';
      if(CON.assetId)h+='<p class="no-print" style="margin:10px 0 0"><button class="btn" id="conbtn">Masquer la construction</button></p>';
      h+='<ul class="sym-list">';
      sym.forEach((s,i)=>{h+='<li data-sym="'+i+'"><span class="n">'+(i+1)+'</span><span>'+(s.title?'<b class="sym-t">'+esc(s.title)+'</b> — ':'')+esc(s.text)+'</span></li>'});
      h+='</ul></section>';
    }
    // Iconographie & pictogrammes (KB-14)
    if(showIcons){
      const ICL={outline:'Filaire',filled:'Plein',duotone:'Bicolore',rounded:'Angles arrondis',sharp:'Angles vifs',fine:'Trait fin',regular:'Trait régulier',bold:'Trait épais'};
      const traits=[ICL[IC.stroke],ICL[IC.corners],ICL[IC.weight]].filter(Boolean);
      h+='<section><h2>Iconographie & pictogrammes</h2><p class="sub">Le style des pictos de la marque.</p>';
      if(traits.length)h+='<div class="phwords">'+traits.map(t=>'<span class="phword">'+t+'</span>').join('')+'</div>';
      if(IC.note)h+='<p class="ic-note">'+esc(IC.note)+'</p>';
      if(icIds.length){h+='<div class="icgrid">';for(const id of icIds)h+='<figure class="ic-tile"><img src="'+fileUrl(id)+'" alt="" loading="lazy"></figure>';h+='</div>'}
      h+='</section>';
    }
  }
  if(bdCells.length||phWords.length||phIds.length){
    h+='<section id="photo"><h2>Direction photographique</h2><p class="sub">L\\'atmosphère visuelle de la marque.</p>';
    if(bdCells.length){
      const hasTxt=!!(BD.title||BD.text||phWords.length);
      h+='<div class="bboard'+(hasTxt?' has-txt':'')+'">';
      if(hasTxt){
        h+='<div class="bb-txt">'+
           (BD.title?'<h3 class="bb-title"'+(titleFont?' style="font-family:\\''+esc(titleFont.family)+'\\',sans-serif"':'')+'>'+esc(BD.title)+'</h3>':'')+
           (BD.text?'<p class="bb-text">'+esc(BD.text)+'</p>':'')+wordChips+'</div>';
      }
      h+='<div class="bb-grid tpl-'+esc(bdTpl)+'">';
      for(const[sl,c]of bdCells){
        h+='<div class="bb-cell" data-cell="'+sl+'">'+
           (c.video?'<video src="'+fileUrl(c.assetId)+'" muted loop autoplay playsinline></video>':'<img src="'+fileUrl(c.assetId)+'" alt="" loading="lazy">');
        if(c.med&&c.med.assetId)h+='<span class="bb-med" style="left:'+(+c.med.x*100).toFixed(1)+'%;top:'+(+c.med.y*100).toFixed(1)+'%"><img src="'+fileUrl(c.med.assetId)+'" alt=""></span>';
        h+='</div>';
      }
      h+='</div></div>';
    } else if(phWords.length){h+=wordChips}
    if(phIds.length){h+='<div class="phgrid">';for(const id of phIds)h+='<img src="'+fileUrl(id)+'" alt="" loading="lazy">';h+='</div>'}
    h+='</section>';
  }

  // Pack de marque (KB-EXPORT-1) — chapitre : la charte condensée en un
  // dossier machine-readable, téléchargeable ici même.
  if(showPack){
    h+=chap('pack','Design System');
    h+='<section><h2>Le Design System</h2><p class="sub">Toute cette charte réunie en un dossier prêt à donner à une IA de design (Claude Design) ou à un outil de tokens — pour produire des visuels, pages et contenus fidèles à la marque.</p>';
    h+='<ul class="packlist">';
    h+='<li><b>design-tokens.json</b><span>Couleurs & typographies au format standard (DTCG)</span></li>';
    h+='<li><b>brand.md</b><span>La marque en clair : couleurs, polices, règles, ton de voix</span></li>';
    h+='<li><b>design-system-spec.json</b><span>Le manifeste lu par les outils d’import</span></li>';
    if(variants.length)h+='<li><b>logo/</b><span>Vos logos en fichier original</span></li>';
    h+='</ul>';
    h+='<p class="packdl-row no-print"><button class="btn primary" id="packdl">'+DL_ICON+'Télécharger le Design System (.zip)</button></p>';
    h+='</section>';
  }

  // Supports de communication (KB-11) — mockups composés avec la charte
  if(showSupports){
    const P=primary?primary.hex:null;
    const P2=P?palette.map(c=>c.hex).find(x=>x!==P)||null:null;
    const supLogo=rasterV[0]||null;
    const lgIm=supLogo?'<img src="'+fileUrl(supLogo.assetId)+'" alt="">':'';
    const nm=esc(meta.name||DATA.name), bl=meta.baseline?esc(meta.baseline):'';
    const tfSt=titleFont?'font-family:\\''+esc(titleFont.family)+'\\',sans-serif;':'';
    const wm='<b style="'+tfSt+'">'+nm+'</b>';
    const hBg=P?(P2?'background:linear-gradient(135deg,'+P+','+P2+')':'background:'+P):'background:#eef0f4';
    const hInk=P?inkOn(P):'#15171c';
    const bBg=P||'#15171c',bInk=inkOn(bBg);
    const blk=P?'background:color-mix(in srgb, '+P+' 10%, #ffffff)':'background:#f1f3f6';
    const dom=esc((SUP.domain||'').trim()||nm.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)+'.fr');
    const cardD=SUP.card||{};
    h+=chap('supports','Supports de communication');
    h+='<section><h2>La marque en situation</h2><p class="sub">Téléchargez le FICHIER de chaque pièce — les visuels que vous avez importés en original, sinon un rendu de la composition.</p><div class="supgrid">';
    // Chaque pièce téléchargeable : si un visuel a été importé → son FICHIER
    // d'origine (dl=1, dimensions/format réels) ; sinon → rasterisation de la
    // pièce NUE (sans cadre ni mockup). data-capsel = élément composé à capturer.
    const dlCtl=(text,name,asset,capsel)=> asset
      ? '<a class="btn supdl no-print" href="'+fileUrl(asset,true)+'" download data-dlasset="'+esc(asset)+'" data-dlname="'+esc(name)+'">'+DL_ICON+esc(text)+'</a>'
      : '<button class="btn supdl no-print" data-supdl data-capsel="'+esc(capsel)+'" data-dlname="'+esc(name)+'">'+DL_ICON+esc(text)+'</button>';
    const band=(wide,title,ctls,inner)=>'<div class="supband'+(wide?' supwide':'')+'"><div class="supband-head"><h3>'+title+'</h3><span class="supdls">'+ctls+'</span></div><div class="supstage"><div class="supcap">'+inner+'</div></div></div>';
    if(supOn('web')){
      let inner='<div class="mk-browser"><div class="mk-bar"><span class="mk-dots"><i></i><i></i><i></i></span><span class="mk-url">'+(P?'<i class="mk-fav" style="background:'+P+'"></i>':'')+dom+'</span></div>';
      inner+=SUP.webShotId?'<img class="mk-shot" src="'+fileUrl(SUP.webShotId)+'" alt="">':
        '<div class="mk-page"><div class="mk-nav">'+(lgIm?'<span class="mk-navlogo">'+lgIm+'</span>':wm)+'<span class="mk-links"><i>Accueil</i><i>Offre</i><i>Contact</i></span><span class="mk-btn" style="background:'+bBg+';color:'+bInk+'">Contact</span></div>'+
        '<div class="mk-hero" style="'+hBg+'"><strong style="'+tfSt+'color:'+hInk+'">'+(bl||nm)+'</strong><span class="mk-btn mk-cta" style="background:'+(hInk==='#ffffff'?'rgba(255,255,255,.94)':'#15171c')+';color:'+(hInk==='#ffffff'?(P||'#15171c'):'#ffffff')+'">Découvrir</span></div>'+
        '<div class="mk-blocks"><i style="'+blk+'"></i><i style="'+blk+'"></i><i style="'+blk+'"></i></div></div>';
      inner+='</div>';
      h+=band(true,'Site web',dlCtl('Télécharger','Site web',SUP.webShotId,'.mk-page'),inner);
    }
    if(supOn('phone')){
      let inner='<div class="mk-phone"><div class="mk-notch"></div><div class="mk-screen">';
      inner+=SUP.phoneShotId?'<img class="mk-shot" src="'+fileUrl(SUP.phoneShotId)+'" alt="">':
        '<div class="mk-mpage"><div class="mk-mnav">'+(lgIm?'<span class="mk-navlogo">'+lgIm+'</span>':wm)+'</div>'+
        '<div class="mk-mhero" style="'+hBg+'"><strong style="'+tfSt+'color:'+hInk+'">'+nm+'</strong>'+(bl?'<span style="color:'+hInk+'">'+bl+'</span>':'')+'</div>'+
        '<div class="mk-mrows"><i style="'+blk+'"></i><i style="'+blk+'"></i></div><span class="mk-btn mk-mcta" style="background:'+bBg+';color:'+bInk+'">Nous contacter</span></div>';
      inner+='</div></div>';
      h+=band(false,'Smartphone',dlCtl('Télécharger','Smartphone',SUP.phoneShotId,'.mk-mpage'),inner);
    }
    if(supOn('card')){
      // Recto et verso remplaçables séparément (repli : ancien cardShotId = recto).
      const cRecto=SUP.cardRectoId||SUP.cardShotId, cVerso=SUP.cardVersoId;
      let inner='<div class="mk-bizrow">';
      inner+=cRecto?'<img class="mk-shot mk-bizshot" src="'+fileUrl(cRecto)+'" alt="Recto de la carte">':
        '<div class="mk-biz mk-recto">'+(lgIm?'<span class="mk-bizlogo">'+lgIm+'</span>':'')+'<b style="'+tfSt+'">'+nm+'</b>'+(bl?'<span>'+bl+'</span>':'')+'</div>';
      inner+=cVerso?'<img class="mk-shot mk-bizshot" src="'+fileUrl(cVerso)+'" alt="Verso de la carte">':
        '<div class="mk-biz mk-verso" style="background:'+bBg+';color:'+bInk+'"><b>'+esc(cardD.name||meta.name||DATA.name)+'</b>'+
        (cardD.role?'<span>'+esc(cardD.role)+'</span>':'')+(cardD.tel?'<span>'+esc(cardD.tel)+'</span>':'')+
        '<span>'+esc(cardD.email||'contact@'+((SUP.domain||'').trim()||dom))+'</span></div>';
      inner+='</div>';
      h+=band(false,'Carte de visite',dlCtl('Recto','Carte de visite — recto',cRecto,'.mk-recto')+dlCtl('Verso','Carte de visite — verso',cVerso,'.mk-verso'),inner);
    }
    if(supOn('social')){
      // Photo de profil et bannière remplaçables séparément (repli : ancien socialShotId = bannière).
      const sAv=SUP.socialAvatarId, sBan=SUP.socialBannerId||SUP.socialShotId;
      let inner='<div class="mk-socialrow">';
      inner+=sAv?'<img class="mk-shot mk-avatarshot" src="'+fileUrl(sAv)+'" alt="Photo de profil">':
        '<div class="mk-avatar">'+(lgIm||'<b style="'+tfSt+'">'+esc((meta.name||DATA.name).charAt(0).toUpperCase())+'</b>')+'</div>';
      inner+=sBan?'<img class="mk-shot mk-bannershot" src="'+fileUrl(sBan)+'" alt="Bannière">':
        '<div class="mk-banner" style="'+hBg+'">'+(lgIm?'<span class="mk-bannerlogo">'+lgIm+'</span>':'')+'<span style="'+tfSt+'color:'+hInk+'">'+(bl||nm)+'</span></div>';
      inner+='</div>';
      h+=band(true,'Réseaux sociaux',dlCtl('Photo de profil','Photo de profil',sAv,'.mk-avatar')+dlCtl('Bannière','Bannière',sBan,'.mk-banner'),inner);
    }
    h+='</div>';
    h+='<p class="no-print supzip-row"><button class="btn primary" id="supzip">'+DL_ICON+'Télécharger tous les supports (.zip)</button></p>';
    if(supGallery.length){
      h+='<h3 class="supgal-title">Réalisations</h3><div class="phgrid">';
      for(const id of supGallery)h+='<img src="'+fileUrl(id)+'" alt="" loading="lazy">';
      h+='</div>';
    }
    h+='</section>';
  }

  // Fin d'édition : historique des versions + footer (dans leur conteneur —
  // plus de .wrap global, les chapitres sont pleine largeur).
  h+='<div class="pl-tail">';
  if(DATA.changelog&&DATA.changelog.length>1||DATA.changelog&&DATA.changelog[0]&&DATA.changelog[0].note){
    h+='<details class="chlog no-print"><summary>Historique des versions</summary><ul>';
    for(const v of DATA.changelog)h+='<li>Version '+v.version+' — '+new Date(v.published_at+'Z').toLocaleDateString('fr-FR')+(v.note?' · '+esc(v.note):'')+'</li>';
    h+='</ul></details>';
  }
  const credit=meta.credit&&meta.credit.label;
  h+='<footer><span>'+(credit?'Direction artistique : '+esc(credit)+' · ':'')+'Version '+DATA.version+'</span>'+
     '<span><a href="https://protein-keystone.com" target="_blank" rel="noopener noreferrer">'+esc((kit.settings&&kit.settings.footer)||'Réalisé par Protein Keystone Studio')+'</a></span></footer></div>';

  app.innerHTML=h;
  bind(variants);
}

// ── Interactions ──
function bind(variants){
  document.getElementById('printbtn')?.addEventListener('click',()=>window.print());
  // Symbolique v2 : bascule du calque de construction.
  const conbtn=document.getElementById('conbtn'),conov=document.getElementById('conov');
  if(conbtn&&conov)conbtn.addEventListener('click',()=>{const off=conov.style.display==='none';conov.style.display=off?'':'none';conbtn.textContent=off?'Masquer la construction':'Afficher la construction'});
  app.addEventListener('click',async e=>{
    const cp=e.target.closest('[data-copy]');
    if(cp){copy(cp.dataset.copy);return}
    // Symbolique v2 : visite d'un repère — re-clic = éteint.
    const sd=e.target.closest('[data-sym]');
    if(sd){const i=sd.dataset.sym,was=sd.classList.contains('hl');
      app.querySelectorAll('[data-sym]').forEach(el=>el.classList.toggle('hl',!was&&el.dataset.sym===i));
      if(!was&&sd.tagName==='BUTTON'){const li=app.querySelector('li[data-sym="'+i+'"]');if(li)li.scrollIntoView({block:'nearest',behavior:'smooth'})}
      return}
    const bgb=e.target.closest('[data-bg]');
    if(bgb){
      // Fond INDÉPENDANT par carte : le clic ne touche que sa propre carte.
      const card=bgb.closest('.lcard')||app;
      card.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('on',b===bgb));
      const p=card.querySelector('[data-prev]');
      if(p)setPrevBg(p,bgb.dataset.bg);
      return}
    // Couleur d'essai de l'alphabet (couleurs de la charte) — par carte typo.
    const tcsw=e.target.closest('[data-tc]');
    if(tcsw){const card=tcsw.closest('.tcard');
      if(card){card.querySelectorAll('[data-tc]').forEach(b=>b.classList.toggle('on',b===tcsw));
        const a=card.querySelector('[data-alpha]');if(a)a.style.color=tcsw.dataset.tc}
      return}
    // Téléchargement d'une pièce COMPOSÉE (pas de visuel importé) → rendu PNG
    // de la pièce nue. Les pièces importées sont des <a download> (fichier réel).
    const sdl=e.target.closest('[data-supdl]');
    if(sdl){const band=sdl.closest('.supband'),node=band&&band.querySelector(sdl.dataset.capsel);
      if(node){sdl.disabled=true;const old=sdl.innerHTML;sdl.textContent='…';
        try{const blob=await captureNode(node);saveBlob(blob,safeName(DATA.name+' — '+sdl.dataset.dlname)+'.png')}
        catch(err){toast('Téléchargement impossible : '+err.message)}
        sdl.disabled=false;sdl.innerHTML=old}
      return}
    const png=e.target.closest('[data-png]');
    if(png){
      const card=png.closest('.lcard');
      const w=parseInt(card.querySelector('[data-size]').value,10)||2000;
      const bg=card.querySelector('[data-bgx]').value||null;
      png.disabled=true;
      try{const r=await fetch(fileUrl(png.dataset.png));const blob=await r.blob();
        const out=await exportPng(blob,png.dataset.mime,w,bg);
        saveBlob(out,safeName(png.dataset.name)+'-'+w+'px.png')}
      catch(err){toast('Export impossible : '+err.message)}
      png.disabled=false;return}
  });
  document.getElementById('zipbtn')?.addEventListener('click',async()=>{
    toast('Préparation du kit…');
    try{const files=[];const seen=new Set();
      for(const v of variants){const r=await fetch(fileUrl(v.assetId));const b=await r.blob();
        let base=safeName(v.label||v.name||'logo');let n=safeName(DATA.name)+'/'+base+'.'+v.ext;
        for(let i=2;seen.has(n);i++)n=safeName(DATA.name)+'/'+base+'-'+i+'.'+v.ext;seen.add(n);
        files.push({name:n,data:new Uint8Array(await b.arrayBuffer())})}
      saveBlob(buildZip(files),safeName(DATA.name)+' — kit logos.zip')}
    catch(err){toast('Kit impossible : '+err.message)}
  });
  // Pack de marque (KB-EXPORT-1) : tokens DTCG + spec + brand.md + logos.
  document.getElementById('packdl')?.addEventListener('click',async()=>{
    toast('Préparation du pack…');
    try{await buildPack()}catch(err){toast('Pack impossible : '+err.message)}
  });
  // Graisse : pilote l'alphabet complet de la carte.
  app.querySelectorAll('[data-w]').forEach(sel=>{sel.addEventListener('change',()=>{
    const a=sel.closest('[data-font]').querySelector('[data-alpha]');if(a)a.style.fontWeight=sel.value})});
  // « Télécharger tous les supports (.zip) » — visuels importés en ORIGINAL,
  // pièces composées rasterisées ; une entrée par pièce (recto/verso séparés…).
  document.getElementById('supzip')?.addEventListener('click',async()=>{
    const ctls=[...app.querySelectorAll('.supband [data-dlasset],.supband [data-capsel]')];if(!ctls.length)return;
    toast('Préparation des supports…');
    try{const files=[],seen=new Set();
      const add=(base,ext,data)=>{let n=safeName(DATA.name)+'/'+safeName(base)+'.'+ext;for(let i=2;seen.has(n);i++)n=safeName(DATA.name)+'/'+safeName(base)+'-'+i+'.'+ext;seen.add(n);files.push({name:n,data})};
      for(const c of ctls){const name=c.dataset.dlname||'support';
        if(c.dataset.dlasset){const r=await fetch(fileUrl(c.dataset.dlasset,true));const b=await r.blob();
          const ext=(b.type.split('/')[1]||'png').replace('jpeg','jpg').replace('svg+xml','svg');
          add(name,ext,new Uint8Array(await b.arrayBuffer()))}
        else{const node=c.closest('.supband').querySelector(c.dataset.capsel);
          if(node){const blob=await captureNode(node);add(name,'png',new Uint8Array(await blob.arrayBuffer()))}}}
      saveBlob(buildZip(files),safeName(DATA.name)+' — supports.zip')}
    catch(err){toast('Kit impossible : '+err.message)}
  });
  // Fond initial de chaque aperçu = data-initbg (celui choisi dans l'éditeur),
  // damier si transparent — chaque carte est indépendante.
  app.querySelectorAll('[data-prev]').forEach(p=>setPrevBg(p,p.dataset.initbg||'ck'));
}
// Applique un fond à un aperçu logo : 'ck' = damier transparent, sinon aplat.
function setPrevBg(p,bg){
  if(bg==='ck'){p.classList.add('ck-prev');p.style.background='';p.style.backgroundImage='linear-gradient(45deg,#b3b3b3 25%,transparent 25%,transparent 75%,#b3b3b3 75%),linear-gradient(45deg,#b3b3b3 25%,#e3e3e3 25%,#e3e3e3 75%,#b3b3b3 75%)';p.style.backgroundSize='16px 16px';p.style.backgroundPosition='0 0,8px 8px'}
  else{p.classList.remove('ck-prev');p.style.backgroundImage='none';p.style.background=bg}
}

boot();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': robots,
      'Cache-Control': 'no-store',
    },
  });
}
