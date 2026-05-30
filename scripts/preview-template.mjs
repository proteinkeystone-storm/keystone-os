#!/usr/bin/env node
// Rend un Smart QR template en HTML avec stub fetch pour preview locale.
// Usage : node scripts/preview-template.mjs <template-id> > /tmp/keystone-preview/<id>.html
//
// Variables d'env (optionnelles selon le template) :
//   PREVIEW_STAMPS=6     pour carte-fidelite (nb tampons précédents)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const templateId = process.argv[2];
if (!templateId) {
  console.error('Usage : node scripts/preview-template.mjs <template-id>');
  process.exit(1);
}

const { default: tpl } = await import(join(ROOT, 'workers/src/routes/smart-templates/' + templateId + '.js'));

// Mock data par template (cohérent avec test-templates.mjs)
const MOCK = {
  'carte-fidelite': {
    nom_marque:       'Café du Port',
    nom_recompense:   'Café offert',
    nb_tampons_total: 10,
    validite_jours:   90,
    style_tampon:     'encre',
    logo_url:         '',
    accent_color:     '#c9a96e',
  },
  'boite-cadeau': {
    nom_marque:    'Boutique Solène',
    occasion:      'Saint Valentin',
    code_promo:    'SAINT-VAL-2026',
    valeur_offre:  '-25% sur tout',
    validite:      'Valable jusqu\'au 14/02',
    couleur_boite: '#7c1d1d',
    couleur_ruban: '#e11d48',
    logo_url:      '',
    accent_color:  '#e11d48',
  },
};

const qr = {
  short_id: 'PREVIEWXX',
  name: 'QR Preview ' + templateId,
  qr_type: 'url',
  mode: 'smart',
  smart_title: 'Bienvenue chez nous !',
  smart_message: 'Merci de votre visite, on vous redirige vers notre site.',
  payload: { url: 'https://example.com' },
  template_id: templateId,
  template_data: MOCK[templateId] || {},
};
const scan = { country: 'FR', device: 'mobile', target_url: 'https://example.com', qr_type: 'url' };

let html = tpl.renderHTML(qr, scan);

const STAMPS_PREVIOUS = Number(process.env.PREVIEW_STAMPS || 6);
const stub = `
<script>
  // STUB DE PREVIEW : intercepte les fetch vers /api/smartqr/* pour démo locale
  (function() {
    const _fetch = window.fetch;
    window.fetch = function(url, opts) {
      // Carte fidélité
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
      return _fetch.apply(this, arguments);
    };
  })();
</script>
`;
// Injecte le stub AVANT </head> pour qu'il définisse window.fetch
// avant que les scripts du template ne tournent.
html = html.replace('</head>', stub + '</head>');
process.stdout.write(html);
