// Banc (lab) : charge scan-preview.html dans Chromium headless, vérifie l'absence
// d'erreurs console/page, et écrit le HTML rendu par le VRAI module dans un JSON.
//   node _design-lab/sdqr/dump-cells.mjs [out.json]
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out  = process.argv[2] || '/tmp/sdqr-cells.json';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };

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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const pg = await browser.newPage();
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(`http://127.0.0.1:${port}/_design-lab/sdqr/scan-preview.html`, { waitUntil: 'networkidle2', timeout: 60000 });
try { await pg.waitForFunction('window.__SCAN_DONE === true', { timeout: 30000 }); }
catch (e) { console.error('TIMEOUT — le module n\'a pas rendu (erreur d\'import ?)'); }

const cells = await pg.evaluate(() => window.__CELLS || null);
if (cells) await writeFile(out, JSON.stringify(cells, null, 0));
console.log(JSON.stringify({ rendered: cells ? cells.length : 0, errors: errs.slice(0, 8) }, null, 2));

await browser.close();
server.close();
