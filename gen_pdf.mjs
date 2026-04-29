import puppeteer from './node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';

const HTML = 'http://localhost:3001/KEYSTONE_NOTICE.html';
const PDF  = './KEYSTONE_NOTICE.pdf';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox']
});

const page = await browser.newPage();
await page.goto(HTML, { waitUntil: 'networkidle0', timeout: 20000 });
await page.evaluate(() => Promise.all(
  [...document.images].map(img => img.complete ? Promise.resolve() :
    new Promise(r => { img.onload = r; img.onerror = r; }))
));
await new Promise(r => setTimeout(r, 1200));

await page.pdf({
  path: PDF,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  preferCSSPageSize: true,
});

await browser.close();
console.log('✓ PDF généré');
