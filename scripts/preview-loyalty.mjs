#!/usr/bin/env node
// Rend carte-fidelite en HTML + stub l'endpoint loyalty-stamp pour la preview
// Usage : node scripts/preview-loyalty.mjs > /tmp/preview-loyalty.html
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { default: tpl } = await import(join(ROOT, 'workers/src/routes/smart-templates/carte-fidelite.js'));

const qr = {
  short_id: 'PREVIEWXX',
  name: 'QR Preview Carte Fidélité',
  qr_type: 'url',
  mode: 'smart',
  metier_brief: 'Café de quartier qui fidélise ses habitués avec un café offert tous les 10 passages.',
  payload: { url: 'https://example.com' },
  template_id: 'carte-fidelite',
  template_data: {
    nom_marque:       'Café du Port',
    nom_recompense:   'Café offert',
    nb_tampons_total: 10,
    validite_jours:   90,
    style_tampon:     'encre',
    logo_url:         '',
    accent_color:     '#c9a96e',
  },
};
const scan = { country: 'FR', device: 'mobile', target_url: 'https://example.com', qr_type: 'url' };

let html = tpl.renderHTML(qr, scan);

// Stub fetch() : mock l'endpoint loyalty-stamp pour démo (4 tampons puis +1)
const STAMPS_PREVIOUS = Number(process.env.PREVIEW_STAMPS || 6);
const stub = `
<script>
  // STUB DE PREVIEW : intercepte les fetch vers /api/smartqr/* pour démo locale
  (function() {
    const _fetch = window.fetch;
    window.fetch = function(url, opts) {
      if (typeof url === 'string' && url.includes('/api/smartqr/loyalty-stamp')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            stamps_count:    ${STAMPS_PREVIOUS + 1},
            stamps_total:    10,
            stamps_added:    1,
            reward_unlocked: ${STAMPS_PREVIOUS + 1 >= 10},
            reward_code:     ${STAMPS_PREVIOUS + 1 >= 10 ? "'WIN-A1B2-C3D4'" : "''"},
            reward_name:     'Café offert',
            cycle_reset:     false,
            first_stamp_at:  new Date(Date.now() - 30*86400e3).toISOString(),
          }),
        });
      }
      if (typeof url === 'string' && url.includes('/api/smartqr/generate-interstitial')) {
        return new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: () => Promise.resolve({
            title: 'Tampon ajouté',
            phrase: 'Encore quelques passages et ton café est offert. À très vite !',
          }),
        }), 1200));
      }
      return _fetch.apply(this, arguments);
    };
  })();
</script>
`;
// Injecte le stub AVANT le </head> pour qu'il définisse window.fetch
// avant que les scripts du template ne tournent.
html = html.replace('</head>', stub + '</head>');
process.stdout.write(html);
