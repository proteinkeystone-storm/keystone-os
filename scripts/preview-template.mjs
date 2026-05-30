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
  // Concierge VEFA — bloc démo Ollioules (S9, cf. BRIEF_CONCIERGE_VEFA.md §2).
  // Programme FICTIF complet (aucune notice réelle), miroir du mock test-templates.
  'concierge': {
    qr_id:           'ollioules-programme',
    destination_url: 'https://example.com/programme-ollioules',
    programme: {
      nom: 'Les Terrasses d\'Ollioules', promoteur: 'Provence Habitat',
      ville: 'Ollioules', livraison_prevue: '4e trimestre 2026',
    },
    configurations: [
      { reference: 'Maison A', type: 'T3', nb_chambres: 2, statut: 'disponible',
        surface_habitable_m2: 68, surfaces_annexes: { jardin_m2: 45, garage: true },
        exposition: 'Sud', prix_ttc: 389000, stationnement: '1 garage + 1 place',
        prestations: ['Cuisine équipée', 'Volets roulants électriques', 'Climatisation réversible'] },
      { reference: 'Maison B', type: 'T4', nb_chambres: 3, statut: 'disponible',
        surface_habitable_m2: 92, surfaces_annexes: { jardin_m2: 80, garage: true },
        exposition: 'Sud-Ouest', prix_ttc: 459000, stationnement: '1 garage + 2 places',
        prestations: ['Cuisine équipée', 'Domotique', 'Panneaux solaires'] },
      { reference: 'Maison C', type: 'T4', nb_chambres: 3, statut: 'optionne',
        surface_habitable_m2: 95, surfaces_annexes: { jardin_m2: 70, garage: true },
        exposition: 'Est', prix_ttc: 472000, stationnement: '1 garage',
        prestations: ['Cuisine équipée', 'Suite parentale'] },
      { reference: 'Maison D', type: 'T2', nb_chambres: 1, statut: 'vendu',
        surface_habitable_m2: 48, surfaces_annexes: { jardin_m2: 0, garage: false },
        exposition: 'Nord', prix_ttc: 268000, stationnement: '1 place', prestations: [] },
      { reference: 'Maison E', type: 'T5', nb_chambres: 4, statut: 'disponible',
        surface_habitable_m2: 118, surfaces_annexes: { jardin_m2: 110, garage: true },
        exposition: 'Sud', prix_ttc: 595000, stationnement: '2 garages',
        prestations: ['Cuisine équipée', 'Suite parentale', 'Domotique', 'Terrain piscinable'] },
      { reference: 'Maison F', type: 'T4', nb_chambres: 3, statut: 'disponible',
        surface_habitable_m2: 105, surfaces_annexes: { jardin_m2: 95, garage: true },
        exposition: 'Plein Sud', prix_ttc: 525000, stationnement: '1 garage + 1 place',
        prestations: ['Cuisine équipée', 'Climatisation réversible', 'Panneaux solaires', 'Terrain piscinable'] },
    ],
    faq_validee: [
      { q: 'Quels sont les frais de notaire ?', r: 'En VEFA (achat sur plan), les frais de notaire sont réduits : environ 2 à 3 % du prix, contre 7 à 8 % dans l\'ancien.' },
      { q: 'Quelles garanties couvrent un achat en VEFA ?', r: 'Garantie de parfait achèvement (1 an), garantie biennale (2 ans) et garantie décennale (10 ans).' },
      { q: 'Puis-je personnaliser les finitions ?', r: 'Oui, selon l\'avancement du chantier : carrelages, faïences et peintures se choisissent avec le maître d\'oeuvre. Demandez à votre conseiller.' },
    ],
    questions_suggerees: [
      'Quels modèles sont disponibles ?',
      'Quelle différence entre la A et la B ?',
      'Laquelle pour une famille de 4 ?',
      'Quelle date de livraison ?',
    ],
    contact_humain: { nom: 'Camille Martin', tel: '04 94 00 00 00', email: 'contact@agence-horizon.fr' },
    disclaimer: 'Informations non contractuelles, données à titre indicatif. Pour toute information contractuelle, référez-vous à la notice descriptive et à votre conseiller.',
    persona: { ton: 'professionnel et chaleureux', langue_par_defaut: 'fr' },
    branding: {
      nom_agence: 'Agence Horizon', logo_url: '',
      couleur_primaire: '#15677d', couleur_secondaire: '#c9a96e', fond: 'clair',
    },
  },
  // Concierge GENERIC (S8) — même moteur, vertical « generic » : cartes
  // « offre » (intitulé + attributs libres + description + prix). Aperçu via
  //   PREVIEW_VERTICAL=generic node scripts/preview-template.mjs concierge
  'concierge-generic': {
    vertical: 'generic',
    programme: { nom: 'Nos formules 2026', ville: 'Toulon' },
    configurations: [
      { reference: 'Forfait Découverte', prix_ttc: 75,
        attributs: [{ label: 'Séances', value: '3' }, { label: 'Durée', value: '55 min' }],
        description: 'Idéal pour débuter en douceur.' },
      { reference: 'Forfait Premium', prix_ttc: 190,
        attributs: [{ label: 'Séances', value: 'Illimité' }, { label: 'Coaching', value: 'Inclus' }],
        description: 'Accès libre et suivi personnalisé.' },
      { reference: 'Carte 10 séances', prix_ttc: 250,
        attributs: [{ label: 'Validité', value: '6 mois' }, { label: 'Transférable', value: 'Oui' }],
        description: 'Flexibilité maximale, sans engagement.' },
    ],
    faq_validee: [{ q: 'Puis-je résilier ?', r: 'Oui, à tout moment.' }],
    questions_suggerees: [
      'Quelle formule pour débuter ?', 'Y a-t-il un engagement ?', 'Proposez-vous un essai ?',
    ],
    contact_humain: { nom: 'Léa', tel: '04 94 11 22 33', email: 'hello@pilates.fr' },
    disclaimer: 'Tarifs indicatifs, voir conditions en studio.',
    persona: { ton: 'professionnel et chaleureux', langue_par_defaut: 'fr' },
    branding: {
      nom_agence: 'Studio Pilates Lumière', logo_url: '',
      couleur_primaire: '#0ea5e9', couleur_secondaire: '#f59e0b', fond: 'clair',
    },
  },
};

// Concierge : vertical « generic » via PREVIEW_VERTICAL=generic (même moteur).
const wantGeneric = templateId === 'concierge' && process.env.PREVIEW_VERTICAL === 'generic';
const mockData    = wantGeneric ? MOCK['concierge-generic'] : (MOCK[templateId] || {});

const qr = {
  short_id: 'PREVIEWXX',
  name: 'QR Preview ' + templateId,
  qr_type: 'url',
  mode: 'smart',
  smart_title: 'Bienvenue chez nous !',
  smart_message: 'Merci de votre visite, on vous redirige vers notre site.',
  payload: { url: 'https://example.com' },
  template_id: templateId,
  template_data: mockData,
};
const scan = { country: 'FR', device: 'mobile', target_url: 'https://example.com', qr_type: 'url' };

let html = tpl.renderHTML(qr, scan);

const STAMPS_PREVIOUS = Number(process.env.PREVIEW_STAMPS || 6);
// Réponse de démo generic (S8) — injectée seulement en PREVIEW_VERTICAL=generic.
const genericAnswer = "Avec plaisir ! Le Forfait Découverte (3 séances, 75 €) est parfait pour commencer en douceur. Pour un accès illimité avec suivi, le Forfait Premium (190 €) est le plus complet. Souhaitez-vous que je vous oriente selon votre objectif ?";
const stub = `
<script>
  // STUB DE PREVIEW : intercepte les fetch vers /api/smartqr/* pour démo locale
  (function() {
    const _fetch = window.fetch;

    // Concierge VEFA — faux flux SSE (start -> chunks -> done) pour voir
    // le chat se remplir + la pulse "respirante" animer, sans Worker ni IA.
    function sseConcierge(question) {
      var enc = new TextEncoder();
      var answer = "Bonne question ! La Maison A (T3, 68 m², 389 000 €) convient à un couple ou une petite famille. La Maison B (T4, 92 m², 459 000 €) ajoute une chambre et un plus grand jardin — idéale pour une famille de 4. Souhaitez-vous organiser une visite ?";
      ${wantGeneric ? 'answer = ' + JSON.stringify(genericAnswer) + ';' : ''}
      var words = answer.split(' ');
      var frames = ['data: ' + JSON.stringify({ type: 'start' }) + '\\n\\n'];
      for (var i = 0; i < words.length; i++) {
        frames.push('data: ' + JSON.stringify({ type: 'chunk', text: words[i] + (i < words.length - 1 ? ' ' : '') }) + '\\n\\n');
      }
      frames.push('data: ' + JSON.stringify({ type: 'done', full_text: answer }) + '\\n\\n');
      var idx = 0;
      var reader = { read: function () {
        return new Promise(function (resolve) {
          if (idx >= frames.length) { resolve({ done: true, value: undefined }); return; }
          var f = frames[idx++];
          setTimeout(function () { resolve({ done: false, value: enc.encode(f) }); }, idx === 1 ? 480 : 85);
        });
      } };
      return Promise.resolve({ ok: true, body: { getReader: function () { return reader; } } });
    }

    window.fetch = function(url, opts) {
      // Concierge VEFA — chat live
      if (typeof url === 'string' && url.includes('/api/smartqr/concierge')) {
        var q = '';
        try { q = (JSON.parse((opts && opts.body) || '{}').question) || ''; } catch (e) {}
        return sseConcierge(q);
      }
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
