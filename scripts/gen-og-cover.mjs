#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — gen-og-cover
   ─────────────────────────────────────────────────────────────
   Génère la carte de partage social og-cover.png (1200×630) à la
   charte de la landing (fond indigo sombre + aurora + wordmark
   blanc). Un VRAI PNG : les réseaux (LinkedIn, Facebook, X, iMessage)
   ne rendent pas les og:image en SVG.

   Usage : node scripts/gen-og-cover.mjs   →  écrit ./og-cover.png
   Dépendance : puppeteer (déjà dans package.json).
   ═══════════════════════════════════════════════════════════════ */
import puppeteer from 'puppeteer';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const LOGO_URL  = pathToFileURL(resolve(ROOT, 'keystone-logo.svg')).href;
const OUT       = resolve(ROOT, 'og-cover.png');

const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px}
  body{
    position:relative; overflow:hidden;
    background:#020617;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    color:#f8fafc; -webkit-font-smoothing:antialiased;
  }
  /* aurora — repris de body::before de la landing */
  .aurora{position:absolute; inset:-20%; z-index:0;
    background:
      radial-gradient(38% 46% at 18% 22%, rgba(99,102,241,.30) 0%, transparent 60%),
      radial-gradient(34% 42% at 84% 24%, rgba(168,85,247,.24) 0%, transparent 60%),
      radial-gradient(42% 48% at 70% 78%, rgba(56,189,248,.20) 0%, transparent 62%),
      radial-gradient(32% 40% at 26% 84%, rgba(236,72,153,.16) 0%, transparent 60%);}
  .grid{position:absolute; inset:0; z-index:0;
    background-image:
      linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size:64px 64px;
    -webkit-mask-image:radial-gradient(ellipse at center, black 30%, transparent 82%);}
  .wrap{position:relative; z-index:1; height:100%;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:0 90px;}
  .logo{height:96px; width:auto; margin-bottom:46px;
    filter:drop-shadow(0 14px 40px rgba(99,102,241,.45));}
  .tag{font-size:58px; font-weight:900; letter-spacing:-.025em; line-height:1.05; max-width:980px;}
  .tag em{font-style:normal;
    background:linear-gradient(120deg,#a5b4fc,#818cf8 55%,#38bdf8);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;}
  .sub{margin-top:30px; font-size:27px; font-weight:600; color:rgba(248,250,252,.62);
    letter-spacing:.01em;}
  .dot{color:rgba(99,102,241,.9); padding:0 12px; font-weight:800;}
  .url{position:absolute; bottom:46px; left:50%; transform:translateX(-50%); z-index:1;
    font-size:23px; font-weight:700; letter-spacing:.02em; color:rgba(165,180,252,.92);}
</style></head><body>
  <div class="aurora"></div>
  <div class="grid"></div>
  <div class="wrap">
    <img class="logo" src="${LOGO_URL}" alt="Keystone">
    <div class="tag">Tous vos outils métier.<br><em>Un seul OS.</em></div>
    <div class="sub">Modulaire<span class="dot">·</span>Souverain<span class="dot">·</span>Hébergé en Europe</div>
  </div>
  <div class="url">protein-keystone.com</div>
</body></html>`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`✓ og-cover.png écrit (${OUT})`);
} finally {
  await browser.close();
}
