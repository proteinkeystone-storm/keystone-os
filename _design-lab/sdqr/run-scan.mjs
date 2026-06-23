// Runner local (lab) : sert le repo en statique, ouvre un banc dans Chromium
// headless (Puppeteer), attend le verdict jsQR et l'imprime. NON prod.
//   node _design-lab/sdqr/run-scan.mjs [page] [--shot fichier.png] [--sel #id]
// page défaut = scan-candidates.html ; --shot = capture pleine page.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const page = args.find(a => !a.startsWith('--')) || 'scan-candidates.html';
const shot = (() => { const i = args.indexOf('--shot'); return i >= 0 ? args[i + 1] : null; })();
const sel  = (() => { const i = args.indexOf('--sel');  return i >= 0 ? args[i + 1] : null; })();
const waitGlobal = (() => { const i = args.indexOf('--wait'); return i >= 0 ? args[i + 1] : '__SCAN_DONE'; })();

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const fp = path.join(ROOT, url);
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    const buf = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('not found'); }
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const target = `http://127.0.0.1:${port}/_design-lab/sdqr/${page}`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const pg = await browser.newPage();
await pg.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push(String(e)));

await pg.goto(target, { waitUntil: 'networkidle2', timeout: 60000 });
try { await pg.waitForFunction(`window.${waitGlobal} === true`, { timeout: 60000 }); }
catch (e) { console.error('⚠ timeout attente', waitGlobal); }

const rows = await pg.evaluate(() => window.__SCAN_ROWS || null);
if (rows) {
  const pad = (s, n) => String(s).padEnd(n);
  let pass = 0;
  console.log('\n  CAT        | CANDIDAT                                    | 300 | 170 | VERDICT');
  console.log('  ' + '-'.repeat(92));
  for (const r of rows) {
    if (r.pass) pass++;
    console.log('  ' + pad(r.cat, 10) + ' | ' + pad(r.label, 43) + ' | ' + pad(r.p300?'OK':'XX',3) + ' | ' + pad(r.p170?'OK':'XX',3) + ' | ' + (r.pass ? 'PASS' : 'FAIL ' + (r.got||'illisible')));
  }
  console.log('  ' + '-'.repeat(92));
  console.log(`  ${pass}/${rows.length} candidats scannables aux 2 tailles\n`);
}
if (errs.length) console.log('  console errors:', errs.slice(0, 5));

if (shot) {
  if (sel) { const el = await pg.$(sel); if (el) await el.screenshot({ path: shot }); }
  else await pg.screenshot({ path: shot, fullPage: true });
  console.log('  screenshot →', shot);
}

await browser.close();
server.close();
