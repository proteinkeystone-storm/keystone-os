#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Smart QR Templates — tests unitaires
   ─────────────────────────────────────────────────────────────
   Valide les templates V1 + V4 livrés sans toucher à la prod.
   Chaque template doit :
     - renderHTML() : retourne un HTML > 500 bytes, structure complète,
       CTA continuer présent (les 4 cartes "texte" rendent smart_title)
     - validate() : retourne array, capture les required manquants
     - fields[] (frontend only) : items typés correctement

   Usage :  node scripts/test-templates.mjs
   Exit code : 0 si tous PASS, 1 si au moins 1 FAIL.
   ═══════════════════════════════════════════════════════════════ */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');

// ── Couleurs terminal ─────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

let passCount = 0, failCount = 0;
const fails = [];

function assert(cond, label) {
  if (cond) { passCount++; return true; }
  failCount++; fails.push(label); return false;
}

// ── Mock data réaliste par template ───────────────────────────
const MOCK_QR = {
  short_id:      'MOCKABCD',
  name:          'QR Test',
  qr_type:       'url',
  mode:          'smart',
  smart_title:   'Bienvenue Test 12345',
  smart_message: 'Merci de votre visite, on vous redirige.',
  payload:       { url: 'https://example.com' },
};
const MOCK_SCAN = {
  country:    'FR',
  device:     'mobile',
  target_url: 'https://example.com',
  qr_type:    'url',
};

const MOCK_DATA = {
  // V4.1 livré 2026-05-26
  'storytelling-brand': {
    nom_marque:   'Maison Lumière',
    slogan:       'L\'art de bien recevoir',
    logo_url:     'https://example.com/logo.png',
    visuel_url:   'https://example.com/visuel.jpg',
    accent_color: '#c9a96e',
    style_motion: 'Élégant',
  },
  'countdown-produit': {
    nom_produit:  'Drop Sneaker LX',
    // Date dans le futur (2 jours pour rester réaliste après date du jour)
    date_sortie:  new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 16),
    nom_marque:   'Atelier Sud',
    teaser_text:  'Une silhouette inédite, en série limitée.',
    logo_url:     'https://example.com/logo.png',
    visuel_url:   'https://example.com/sneaker.jpg',
    accent_color: '#ff6b35',
    compte_scans: false,
  },
  // V4.3 livré 2026-05-26
  'machine-a-sous': {
    nom_marque:         'Café du Port',
    symboles_cylindre:  '🍒\n🍋\n⭐\n🔔\n💎\n7️⃣',
    taux_de_gain:       20,
    lots_disponibles:   50,
    message_gain:       'Bravo ! Une glace offerte avec ce QR.',
    message_perte:      'Pas cette fois — retente demain !',
    un_jeu_par_appareil: true,
    logo_url:           'https://example.com/logo.png',
    accent_color:       '#c9a96e',
  },
  'carte-a-gratter': {
    nom_marque:          'Boulangerie Marius',
    texture_grattage:    'Or',
    lots: [
      { label: 'Une partie offerte', proba: 1,  max: 2 },
      { label: 'Un menu',            proba: 5,  max: 20 },
      { label: 'Un soda',            proba: 15, max: 0 },
    ],
    message_perte:       'Pas de chance — reviens demain !',
    un_jeu_par_appareil: true,
    logo_url:            'https://example.com/logo.png',
    accent_color:        '#c9a96e',
  },
  // V4.4 livré 2026-05-26
  'carte-fidelite': {
    nom_marque:       'Café du Port',
    nom_recompense:   'Café offert',
    nb_tampons_total: 10,
    validite_jours:   90,
    style_tampon:     'encre',
    logo_url:         'https://example.com/logo.png',
    accent_color:     '#c9a96e',
  },
  // V4.2 livré 2026-05-26
  'boite-cadeau': {
    nom_marque:    'Boutique Solène',
    occasion:      'Saint Valentin',
    code_promo:    'SAINT-VAL-2026',
    valeur_offre:  '-25% sur tout',
    validite:      'Valable jusqu\'au 14/02',
    couleur_boite: '#7c1d1d',
    couleur_ruban: '#e11d48',
    logo_url:      'https://example.com/logo.png',
    accent_color:  '#e11d48',
  },
  // Concierge VEFA — bloc démo Ollioules (S9, brief BRIEF_CONCIERGE_VEFA.md §2).
  // Programme FICTIF complet, créé de zéro (aucune notice réelle) : promoteur +
  // agence + 6 lots T2->T5 (statuts mélangés) + FAQ VEFA + branding agence.
  'concierge': {
    qr_id:           'ollioules-programme',
    destination_url: 'https://example.com/programme-ollioules',
    programme: {
      nom:              'Les Terrasses d\'Ollioules',
      promoteur:        'Provence Habitat',
      ville:            'Ollioules',
      livraison_prevue: '4e trimestre 2026',
    },
    configurations: [
      {
        reference: 'Maison A', type: 'T3', nb_chambres: 2, statut: 'disponible',
        surface_habitable_m2: 68, surfaces_annexes: { jardin_m2: 45, garage: true },
        exposition: 'Sud', prix_ttc: 389000, stationnement: '1 garage + 1 place',
        prestations: ['Cuisine équipée', 'Volets roulants électriques', 'Climatisation réversible'],
      },
      {
        reference: 'Maison B', type: 'T4', nb_chambres: 3, statut: 'disponible',
        surface_habitable_m2: 92, surfaces_annexes: { jardin_m2: 80, garage: true },
        exposition: 'Sud-Ouest', prix_ttc: 459000, stationnement: '1 garage + 2 places',
        prestations: ['Cuisine équipée', 'Domotique', 'Panneaux solaires'],
      },
      {
        reference: 'Maison C', type: 'T4', nb_chambres: 3, statut: 'optionne',
        surface_habitable_m2: 95, surfaces_annexes: { jardin_m2: 70, garage: true },
        exposition: 'Est', prix_ttc: 472000, stationnement: '1 garage',
        prestations: ['Cuisine équipée', 'Suite parentale'],
      },
      {
        reference: 'Maison D', type: 'T2', nb_chambres: 1, statut: 'vendu',
        surface_habitable_m2: 48, surfaces_annexes: { jardin_m2: 0, garage: false },
        exposition: 'Nord', prix_ttc: 268000, stationnement: '1 place',
        prestations: [],
      },
      {
        reference: 'Maison E', type: 'T5', nb_chambres: 4, statut: 'disponible',
        surface_habitable_m2: 118, surfaces_annexes: { jardin_m2: 110, garage: true },
        exposition: 'Sud', prix_ttc: 595000, stationnement: '2 garages',
        prestations: ['Cuisine équipée', 'Suite parentale', 'Domotique', 'Terrain piscinable'],
      },
      {
        reference: 'Maison F', type: 'T4', nb_chambres: 3, statut: 'disponible',
        surface_habitable_m2: 105, surfaces_annexes: { jardin_m2: 95, garage: true },
        exposition: 'Plein Sud', prix_ttc: 525000, stationnement: '1 garage + 1 place',
        prestations: ['Cuisine équipée', 'Climatisation réversible', 'Panneaux solaires', 'Terrain piscinable'],
      },
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
      nom_agence:        'Agence Horizon',
      logo_url:          '',
      couleur_primaire:  '#15677d',
      couleur_secondaire:'#c9a96e',
      fond:              'clair',
    },
  },
};

// Les 4 templates qui affichent le titre + message saisis par le propriétaire.
// Les 2 cartes-jeux (machine-a-sous, carte-a-gratter) n'affichent pas de texte.
const TEXT_TEMPLATES = new Set([
  'storytelling-brand', 'countdown-produit', 'carte-fidelite', 'boite-cadeau',
]);

// ── Tests : Backend (Worker) ──────────────────────────────────
async function testBackend() {
  console.log(`\n${C.bold}${C.cyan}━━━ BACKEND (Worker templates) ━━━${C.reset}\n`);
  const { listTemplates, getTemplate } = await import(join(ROOT, 'workers/src/routes/smart-templates/index.js'));
  const all = listTemplates();
  console.log(`  ${C.dim}${all.length} templates chargés depuis le registry${C.reset}\n`);

  for (const tpl of all) {
    const data = MOCK_DATA[tpl.id] || {};
    const qr   = { ...MOCK_QR, template_id: tpl.id, template_data: data };

    // 1. Contrat
    assert(typeof tpl.id === 'string' && tpl.id,                                     `${tpl.id} : id présent`);
    assert(typeof tpl.label === 'string' && tpl.label,                               `${tpl.id} : label présent`);
    assert(['starter','pro','max','admin'].includes(tpl.tier_required),              `${tpl.id} : tier_required valide`);
    assert(typeof tpl.validate === 'function',                                       `${tpl.id} : validate() existe`);
    assert(typeof tpl.renderHTML === 'function',                                     `${tpl.id} : renderHTML() existe`);

    // 2. renderHTML
    const html = tpl.renderHTML(qr, MOCK_SCAN);
    assert(typeof html === 'string' && html.length > 500,                            `${tpl.id} : renderHTML > 500 bytes`);
    assert(html.includes('<!DOCTYPE html>'),                                         `${tpl.id} : HTML5 doctype`);
    assert(html.includes('</html>'),                                                  `${tpl.id} : HTML fermé`);
    assert(html.includes('viewport'),                                                 `${tpl.id} : viewport meta présent`);
    assert(html.includes('/r/MOCKABCD?direct=1'),                                    `${tpl.id} : CTA continuer (/r/SHORT?direct=1)`);
    assert(!html.includes('/api/smartqr/generate-interstitial'),                     `${tpl.id} : plus de fetch IA (endpoint supprimé)`);
    assert(html.includes('Keystone'),                                                 `${tpl.id} : branding Keystone`);
    // Les 4 cartes "texte" rendent le titre + message saisis en direct.
    if (TEXT_TEMPLATES.has(tpl.id)) {
      assert(html.includes(MOCK_QR.smart_title),                                     `${tpl.id} : smart_title rendu statiquement`);
    }

    // 4. validate (data vide → erreurs si required)
    const errsEmpty = tpl.validate({});
    assert(Array.isArray(errsEmpty),                                                  `${tpl.id} : validate({}) retourne array`);

    // 5. validate avec data complète → 0 erreurs
    const errsFull = tpl.validate(data);
    assert(Array.isArray(errsFull) && errsFull.length === 0,                          `${tpl.id} : validate(mock data) = 0 erreurs`);

    // 6. XSS hardening : si on injecte une charge dans tous les champs string
    //    du mock, le rendu HTML ne doit JAMAIS contenir la charge brute.
    //    Vérifie que escHtml / safeUrl / safeColor du _shared.js font leur job.
    const XSS = '"><script>alert(1)</script>';
    const dataXss = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? XSS + v : v])
    );
    const qrXss = { ...MOCK_QR, template_id: tpl.id, template_data: dataXss };
    const htmlXss = tpl.renderHTML(qrXss, MOCK_SCAN);
    assert(!htmlXss.includes('<script>alert(1)</script>'),                            `${tpl.id} : pas de script XSS brut injecté`);
    assert(!htmlXss.includes('"><script'),                                            `${tpl.id} : pas d'attribut break-out injecté`);
  }
}

// ── Tests : Frontend (SDQR) ───────────────────────────────────
async function testFrontend() {
  console.log(`\n${C.bold}${C.cyan}━━━ FRONTEND (SDQR templates) ━━━${C.reset}\n`);
  const { listTemplates, getTemplate, isKnownTemplate, canUseTemplate } =
    await import(join(ROOT, 'app/sdqr-templates/index.js'));
  const all = listTemplates();
  console.log(`  ${C.dim}${all.length} templates chargés depuis le registry${C.reset}\n`);

  for (const tpl of all) {
    // 1. Contrat
    assert(typeof tpl.id === 'string' && tpl.id,                                     `${tpl.id} : id présent`);
    assert(typeof tpl.label === 'string' && tpl.label,                               `${tpl.id} : label présent`);
    assert(typeof tpl.description === 'string' && tpl.description.length > 20,       `${tpl.id} : description > 20 chars`);
    assert(typeof tpl.icon === 'string' && tpl.icon,                                 `${tpl.id} : icon présent`);
    assert(['starter','pro','max','admin'].includes(tpl.tier_required),              `${tpl.id} : tier_required valide`);
    assert(Array.isArray(tpl.fields),                                                 `${tpl.id} : fields[] array`);
    assert(typeof tpl.validate === 'function',                                       `${tpl.id} : validate() existe`);
    assert(typeof tpl.summary === 'function',                                        `${tpl.id} : summary() existe`);

    // 2. Fields structure
    for (const f of tpl.fields) {
      assert(typeof f.id === 'string' && f.id,                                       `${tpl.id} : field.${f.id || '?'} id présent`);
      assert(typeof f.label === 'string' && f.label,                                 `${tpl.id}.${f.id} : label présent`);
      assert(typeof f.type === 'string' && ['text','textarea','select','url','tel','email','number','password','checkbox','color','datetime-local','image','lots'].includes(f.type), `${tpl.id}.${f.id} : type valide (${f.type})`);
      if (f.type === 'select') {
        assert(Array.isArray(f.options) && f.options.length > 0,                     `${tpl.id}.${f.id} : options select présentes`);
      }
    }

    // 3. validate (data complète → 0 erreurs)
    const data = MOCK_DATA[tpl.id] || {};
    const errsFull = tpl.validate(data);
    assert(Array.isArray(errsFull) && errsFull.length === 0,                          `${tpl.id} : validate(mock data) = 0 erreurs`);

    // 4. summary
    const summary = tpl.summary(data);
    assert(typeof summary === 'string' && summary.length > 5,                        `${tpl.id} : summary() retourne string`);
  }

  // 5. canUseTemplate (tier gating) + isKnownTemplate
  // Tous les templates survivants sont tier 'pro' (starter exclu).
  assert(canUseTemplate('storytelling-brand', 'starter') === false,                 `gating : starter ne peut PAS utiliser storytelling-brand (pro)`);
  assert(canUseTemplate('storytelling-brand', 'pro') === true,                       `gating : pro peut utiliser storytelling-brand`);
  assert(canUseTemplate('storytelling-brand', 'max') === true,                       `gating : max peut utiliser storytelling-brand`);
  assert(isKnownTemplate('storytelling-brand') === true,                             `isKnownTemplate(storytelling-brand) = true`);
  assert(isKnownTemplate('phrase-simple') === false,                                `isKnownTemplate(phrase-simple) = false (supprimé)`);
  assert(isKnownTemplate('quiz-orientation') === false,                             `isKnownTemplate(quiz-orientation) = false (supprimé)`);
  assert(isKnownTemplate('inexistant-xyz') === false,                               `isKnownTemplate(inconnu) = false`);
}

// ── Tests : helpers _shared.js (sécurité XSS / SSRF) ──────────
async function testSharedHelpers() {
  console.log(`\n${C.bold}${C.cyan}━━━ HELPERS _shared.js (sécurité) ━━━${C.reset}\n`);
  const { safeUrl, safeColor, escHtml } = await import(join(ROOT, 'workers/src/routes/smart-templates/_shared.js'));

  // safeUrl : accepte http(s) + data:image, refuse tout le reste
  assert(safeUrl('https://example.com/logo.png') === 'https://example.com/logo.png',
    'safeUrl : accepte HTTPS');
  assert(safeUrl('http://example.com/logo.png') === 'http://example.com/logo.png',
    'safeUrl : accepte HTTP');
  assert(safeUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=') !== '',
    'safeUrl : accepte data:image/png;base64');
  assert(safeUrl('data:image/jpeg;base64,/9j/4AAQ') !== '',
    'safeUrl : accepte data:image/jpeg');
  assert(safeUrl('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDov') !== '',
    'safeUrl : accepte data:image/svg+xml');
  assert(safeUrl('data:image/webp;base64,UklGRg') !== '',
    'safeUrl : accepte data:image/webp');
  assert(safeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==') === '',
    'safeUrl : REFUSE data:text/html (XSS)');
  assert(safeUrl('data:application/javascript;base64,YWxlcnQoMSk=') === '',
    'safeUrl : REFUSE data:application/javascript');
  assert(safeUrl('javascript:alert(1)') === '',
    'safeUrl : REFUSE javascript:');
  assert(safeUrl('vbscript:msgbox(1)') === '',
    'safeUrl : REFUSE vbscript:');
  assert(safeUrl('file:///etc/passwd') === '',
    'safeUrl : REFUSE file://');
  assert(safeUrl('data:image/png;charset=utf-8,iVBOR') === '',
    'safeUrl : REFUSE data:image sans ;base64,');
  assert(safeUrl('') === '' && safeUrl(null) === '' && safeUrl(undefined) === '',
    'safeUrl : gère vide/null/undefined');

  // safeColor : whitelist hex stricte
  assert(safeColor('#7c8af9') === '#7c8af9', 'safeColor : accepte #rrggbb');
  assert(safeColor('#abc') === '#abc',       'safeColor : accepte #rgb');
  assert(safeColor('red') === '#7c8af9',     'safeColor : refuse nom couleur → fallback');
  assert(safeColor('rgb(0,0,0)') === '#7c8af9', 'safeColor : refuse rgb() → fallback');
  assert(safeColor('') === '#7c8af9',        'safeColor : vide → fallback');

  // escHtml : tous les caractères dangereux
  assert(escHtml('<script>') === '&lt;script&gt;', 'escHtml : <> escaped');
  assert(escHtml('"&\'<>') === '&quot;&amp;&#39;&lt;&gt;', 'escHtml : 5 chars dangereux escaped');
  assert(escHtml(null) === '' && escHtml(undefined) === '', 'escHtml : null/undefined → ""');
}

// ── Tests : Symétrie Backend ↔ Frontend ────────────────────────
async function testSymmetry() {
  console.log(`\n${C.bold}${C.cyan}━━━ SYMÉTRIE Backend ↔ Frontend ━━━${C.reset}\n`);
  const { listTemplates: lsBack }  = await import(join(ROOT, 'workers/src/routes/smart-templates/index.js'));
  const { listTemplates: lsFront } = await import(join(ROOT, 'app/sdqr-templates/index.js'));

  const idsBack  = lsBack().map(t => t.id).sort();
  const idsFront = lsFront().map(t => t.id).sort();

  assert(idsBack.length === idsFront.length,                                          `Symétrie : même nombre de templates (${idsBack.length} vs ${idsFront.length})`);
  assert(JSON.stringify(idsBack) === JSON.stringify(idsFront),                       `Symétrie : mêmes IDs front/back`);

  // Tier_required doit matcher
  const back  = Object.fromEntries(lsBack().map(t => [t.id, t.tier_required]));
  const front = Object.fromEntries(lsFront().map(t => [t.id, t.tier_required]));
  for (const id of idsBack) {
    assert(back[id] === front[id],                                                    `Symétrie tier : ${id} (back=${back[id]}, front=${front[id]})`);
  }
}

// ── Tests : Concierge VEFA (Sprint 1 déterministe + Sprint 3 chat) ─
async function testConcierge() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA (Sprint 1 déterministe + Sprint 3 chat) ━━━${C.reset}\n`);
  const { getTemplate } = await import(join(ROOT, 'workers/src/routes/smart-templates/index.js'));
  const tpl   = getTemplate('concierge');
  const block = MOCK_DATA['concierge'];

  // 1. validate : bon bloc accepté
  assert(tpl.id === 'concierge',                       'concierge : registry retourne le bon template');
  assert(tpl.validate(block).length === 0,             'concierge.validate(bloc Ollioules) = 0 erreur');

  // 2. validate : mauvais blocs rejetés
  assert(tpl.validate({}).length >= 3,                                                                          'concierge.validate({}) rejette (programme + configs + agence)');
  assert(tpl.validate({ ...block, programme: { ...block.programme, nom: '' } }).length >= 1,                    'concierge.validate : programme.nom manquant rejeté');
  assert(tpl.validate({ ...block, configurations: [] }).length >= 1,                                            'concierge.validate : 0 configuration rejetée');
  assert(tpl.validate({ ...block, configurations: [{ type: 'T3' }] }).length >= 1,                              'concierge.validate : config sans référence rejetée');
  assert(tpl.validate({ ...block, configurations: [{ reference: 'X', statut: 'pas-un-statut' }] }).length >= 1, 'concierge.validate : statut invalide rejeté');
  assert(tpl.validate({ ...block, branding: { ...block.branding, nom_agence: '' } }).length >= 1,               'concierge.validate : nom_agence manquant rejeté');

  // 3. renderHTML : contenu déterministe rendu depuis le bloc
  const qr   = { ...MOCK_QR, template_id: 'concierge', template_data: block };
  const html = tpl.renderHTML(qr, MOCK_SCAN);

  assert(html.includes('Agence Horizon'),               'concierge render : nom agence rendu (signe la page)');
  assert(html.includes('Les Terrasses d'),              'concierge render : nom programme rendu');
  assert(html.includes('concierge de Agence Horizon'),  'concierge render : accueil déterministe pré-généré');

  // chiffres canoniques injectés en dur (jamais retapés par un LLM)
  assert(html.includes('389 000'), 'concierge render : prix Maison A déterministe (389 000)');
  assert(html.includes('459 000'), 'concierge render : prix Maison B déterministe (459 000)');
  assert(html.includes('68 m²'),   'concierge render : surface Maison A déterministe (68 m²)');
  assert(html.includes('92 m²'),   'concierge render : surface Maison B déterministe (92 m²)');

  // Le chat reconvertit les repères {{Pa}}... en valeurs exactes via VAL injecté
  // (le modèle perd les zeros : il ne voit jamais les chiffres). Cartes = fmtPrix
  // direct (toujours justes) ; chat = repères -> VAL.
  assert(html.includes('var VAL'),          'concierge render : map VAL injectée (repères -> valeurs)');
  assert(html.includes('"Pa":"389 000 €"'), 'concierge render : VAL porte le prix exact pour {{Pa}}');

  // statuts affichés honnêtement (inventaire) — le filtre "jamais vendu"
  // s'applique au PROMPT IA (Sprint 2), pas aux cartes factuelles.
  assert(html.includes('Disponible'), 'concierge render : statut Disponible affiché');
  assert(html.includes('Optionné'),   'concierge render : statut Optionné affiché');
  assert(html.includes('Vendu'),      'concierge render : statut Vendu affiché (inventaire honnête)');

  // Banniere (cover facon reseau social) : presente si branding.banner_url,
  // sinon accentbar par defaut (zero regression sur les QR existants).
  assert(!html.includes('class="cg-cover"'),         'concierge render : aucune cover sans banner_url');
  assert(html.includes('<div class="cg-accentbar"'), 'concierge render : accentbar par défaut (sans banner)');
  const htmlBan = tpl.renderHTML(
    { ...qr, template_data: { ...block, branding: { ...(block.branding || {}), banner_url: 'https://cdn.test/cover.jpg' } } },
    MOCK_SCAN);
  assert(htmlBan.includes('class="cg-cover"'),            'concierge render : cover affichée si banner_url');
  assert(htmlBan.includes('https://cdn.test/cover.jpg'),  'concierge render : image cover injectée');
  assert(htmlBan.includes('cg-head--cover'),              'concierge render : header bascule en mode cover');
  assert(!htmlBan.includes('<div class="cg-accentbar"'),  'concierge render : accentbar remplacée par la cover');

  // chips questions suggérées
  assert(html.includes('cg-chip'),                          'concierge render : chips présentes');
  assert(html.includes('Quels modèles sont disponibles'),   'concierge render : question suggérée rendue');

  // disclaimer permanent visible
  assert(html.includes('cg-disclaimer'),                          'concierge render : conteneur disclaimer présent');
  assert(html.includes('référez-vous à la notice descriptive'),   'concierge render : texte disclaimer visible');

  // contact agence (conseiller) + tel sanitisé en lien
  assert(html.includes('Camille Martin'), 'concierge render : conseiller agence affiché');
  assert(html.includes('tel:0494000000'), 'concierge render : tel sanitisé en lien tel:');

  // branding = couleurs agence (white-label)
  assert(html.includes('#15677d'), 'concierge render : couleur primaire agence injectée');
  assert(html.includes('#c9a96e'), 'concierge render : couleur secondaire agence injectée');

  // Sprint 3 = chat live interactif (front-end SSE) maintenant présent
  assert(html.includes('/api/smartqr/concierge'), 'concierge render S3 : appelle l\'endpoint concierge');
  assert(html.includes('id="cg-thread"'),         'concierge render S3 : fil de conversation présent');
  assert(html.includes('aria-live="polite"'),     'concierge render S3 : fil annoncé (aria-live a11y)');
  assert(html.includes('cg-inputbar'),            'concierge render S3 : barre de saisie présente');
  assert(html.includes('id="cg-input"'),          'concierge render S3 : champ question présent');
  assert(html.includes('id="cg-send"'),           'concierge render S3 : bouton envoyer présent');
  assert(html.includes('resp.body') && html.includes('getReader'), 'concierge render S3 : lecture du flux SSE (getReader)');
  // pulse "respirante" (vibe Siri/Gemini) + repli prefers-reduced-motion
  assert(html.includes('cg-pulse'),                  'concierge render S3 : orbe pulse présente');
  assert(html.includes('@keyframes cg-breathe'),     'concierge render S3 : animation de respiration définie');
  assert(html.includes('prefers-reduced-motion'),    'concierge render S3 : repli accessibilité (motion réduit)');
  // CTA qui s'intensifie sur intention d'achat
  assert(html.includes('id="cg-cta"'),     'concierge render S3 : CTA ciblable (id présent)');
  assert(html.includes('cg-cta-hot'),      'concierge render S3 : CTA s\'intensifie sur intention');

  // CTA marque → resolver redirect
  assert(html.includes('/r/MOCKABCD?direct=1'), 'concierge render : CTA marque vers le resolver');

  // 4. Auto-contraste texte/accent (accent clair → texte foncé, accent foncé → texte clair)
  const htmlLight = tpl.renderHTML({ ...qr, template_data: { ...block, branding: { ...block.branding, couleur_primaire: '#f4f4f5' } } }, MOCK_SCAN);
  assert(htmlLight.includes('--on-acc: #0f172a'), 'concierge auto-contraste : accent CLAIR → texte foncé');
  const htmlDark  = tpl.renderHTML({ ...qr, template_data: { ...block, branding: { ...block.branding, couleur_primaire: '#101225' } } }, MOCK_SCAN);
  assert(htmlDark.includes('--on-acc: #ffffff'),  'concierge auto-contraste : accent FONCÉ → texte clair');

  // 5. XSS NESTÉ : le bloc Concierge est entièrement nesté ; le harnais
  //    générique ne couvre que les strings top-level → on teste ici le nesté.
  const XSS = '"><script>alert(1)</script>';
  const blockXss = {
    ...block,
    programme:      { ...block.programme, nom: XSS },
    branding:       { ...block.branding, nom_agence: XSS },
    configurations: [{ ...block.configurations[0], reference: XSS, exposition: XSS }],
    disclaimer:     XSS,
  };
  const htmlXss = tpl.renderHTML({ ...qr, template_data: blockXss }, MOCK_SCAN);
  assert(!htmlXss.includes('<script>alert(1)</script>'), 'concierge XSS nesté : pas de script brut injecté');
  assert(!htmlXss.includes('"><script'),                 'concierge XSS nesté : pas de break-out d\'attribut');
}

// ── Tests : Concierge VEFA — Éditeur studio (Sprint 4) ────────────
// L'éditeur nesté vit dans app/sdqr.js et écrit dans _creating.template_data.
// Il est DOM-bound (pas de jsdom dans le projet) : on vérifie donc
//   A. le CÂBLAGE (la source contient le hook + les fonctions + data-cg-path)
//   B. la PARITÉ CSS↔JS (toute classe .sdqr-cg-* utilisée existe en CSS)
//   C. le CONTRAT (la forme produite par l'éditeur valide côté frontend)
//   D. la COERCITION (champ numérique vide → undefined → rendu propre, no NaN)
// Le wiring DOM lui-même est couvert par le smoke test studio (gate Sprint 4).
async function testConciergeEditor() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Éditeur studio (Sprint 4) ━━━${C.reset}\n`);

  // ── A. Câblage source (app/sdqr.js) ──
  const src = readFileSync(join(ROOT, 'app/sdqr.js'), 'utf8');
  assert(/_creating\.template_id === 'concierge'/.test(src) && src.includes('_renderConciergeEditor(wrap)'),
    'éditeur S4 : hook concierge branché dans _renderTemplateFields');
  ['_renderConciergeEditor', '_cgEnsureData', '_cgBlankConfig', '_cgSetPath', '_cgOnScalar',
   '_cgConfigRowHtml', '_cgReadConfig', '_cgBindConfigs', '_cgBindQuestions', '_cgBindFaq'].forEach(fn =>
    assert(src.includes('function ' + fn + '('), `éditeur S4 : fonction ${fn} présente`));
  assert(src.includes("'programme.nom'") && src.includes("'branding.nom_agence'"),
    'éditeur S4 : champs requis programme.nom + branding.nom_agence câblés (data-cg-path)');
  // _cgLogoWidget est paramétré (S7.5) : clé par défaut 'logo_url' pour
  // l'immo inline, 'cg_logo' pour le gabarit générique. Le hidden porte
  // data-payload-key="${key}" et réutilise _bindImageWidgets dans les 2 cas.
  assert(/_cgLogoWidget\(/.test(src) && /key\s*=\s*key\s*\|\|\s*'logo_url'/.test(src) && src.includes('data-payload-key="${key}"'),
    'éditeur S4 : widget logo (data-payload-key, défaut logo_url) réutilise _bindImageWidgets');
  assert(src.includes('cg-c-ref') && src.includes('cg-c-statut'),
    'éditeur S4 : ligne configuration a référence + statut');
  ['disponible', 'optionne', 'vendu'].forEach(s =>
    assert(src.includes(`'${s}'`), `éditeur S4 : statut ${s} proposé dans l'éditeur`));
  assert(src.includes('_bindColorWidgets(wrap)') && src.includes('_bindImageWidgets('),
    'éditeur S4 : réutilise les binders couleur + image existants (zéro duplication)');
  assert(src.includes('_cgScalarBound'),
    'éditeur S4 : listener scalaire posé une seule fois (anti-empilement)');

  // ── B. Parité CSS ↔ JS (toute classe .sdqr-cg-* du JS existe en CSS) ──
  const css = readFileSync(join(ROOT, 'app/style.css'), 'utf8');
  ['.sdqr-cg-editor', '.sdqr-cg-section', '.sdqr-cg-section-h', '.sdqr-cg-config',
   '.sdqr-cg-config-h', '.sdqr-cg-config-n', '.sdqr-cg-del', '.sdqr-cg-line',
   '.sdqr-cg-faq', '.sdqr-cg-add', '.sdqr-cg-hint'].forEach(cls =>
    assert(css.includes(cls), `éditeur S4 : style ${cls} défini dans style.css`));

  // ── C. Contrat : la forme produite par l'éditeur valide (frontend) ──
  const { getTemplate: getFront } = await import(join(ROOT, 'app/sdqr-templates/index.js'));
  const front = getFront('concierge');
  const editorMin = {
    programme:      { nom: 'Programme Test' },
    branding:       { nom_agence: 'Agence Test', couleur_primaire: '#2563EB', couleur_secondaire: '#C9A96E', fond: 'clair' },
    configurations: [{ reference: 'Maison A', type: 'T3', statut: 'disponible', surfaces_annexes: { garage: false }, prestations: [] }],
    questions_suggerees: ['Quels modèles sont disponibles ?'],
    faq_validee:    [],
    contact_humain: {},
    disclaimer:     'x',
    persona:        { ton: 'pro', langue_par_defaut: 'fr' },
  };
  assert(front.validate(editorMin).length === 0,
    'éditeur S4 : forme minimale remplie (1 config) valide côté frontend');
  const editorBlank = { ...editorMin, programme: {}, branding: { nom_agence: '' }, configurations: [{ reference: '', statut: 'disponible' }] };
  assert(front.validate(editorBlank).length >= 1,
    'éditeur S4 : skeleton non rempli signalé par validate (guide l\'utilisateur)');

  // ── D. Coercition numérique : vide → undefined → rendu propre (no NaN) ──
  // Simule le passage sur le réseau : JSON round-trip = les clés undefined
  // disparaissent exactement comme dans body.template_data.
  const { getTemplate: getBack } = await import(join(ROOT, 'workers/src/routes/smart-templates/index.js'));
  const back = getBack('concierge');
  const editorEmptyNums = {
    programme:      { nom: 'P' },
    branding:       { nom_agence: 'A', couleur_primaire: '#2563EB', couleur_secondaire: '#C9A96E' },
    configurations: [{ reference: 'Maison Z', type: 'T3', statut: 'disponible',
      nb_chambres: undefined, surface_habitable_m2: undefined, prix_ttc: undefined,
      surfaces_annexes: { jardin_m2: undefined, garage: false }, prestations: [] }],
    questions_suggerees: [], faq_validee: [], contact_humain: {},
    disclaimer: '', persona: { ton: 'pro', langue_par_defaut: 'fr' },
  };
  const wire   = JSON.parse(JSON.stringify(editorEmptyNums)); // clés undefined droppées
  const hEmpty = back.renderHTML({ ...MOCK_QR, template_id: 'concierge', template_data: wire }, MOCK_SCAN);
  assert(hEmpty.includes('Maison Z'),         'éditeur S4 : config à numériques vides rend quand même la référence');
  assert(!hEmpty.includes('0 ch.'),           'éditeur S4 : chambres vide → PAS de "0 ch." (coercition undefined)');
  assert(hEmpty.includes('Prix sur demande'), 'éditeur S4 : prix vide → "Prix sur demande"');
  assert(!/NaN/.test(hEmpty),                 'éditeur S4 : aucun NaN rendu sur champs vides');
}

// ── Tests : Concierge VEFA — Contrat & adaptateurs (Sprint 5) ─────
// Le SCHÉMA est le contrat. Un seul bloc canonique, deux verticaux
// (immo | generic), trois sources qui produisent toutes ce MÊME bloc
// via un adaptateur pur. On vérifie ici :
//   A. la méta des verticaux + helpers de coercition du contrat
//   B. normalizeBlock : forme sûre, défauts, idempotence, non-destructif
//   C. validateBlock immo (messages IDENTIQUES = non-régression) + generic
//   D. les 3 adaptateurs (inline / VEFA / Keyform) → bloc valide
// Pur + déterministe : testable sans réseau ni DOM.
async function testConciergeSchema() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Contrat & adaptateurs (Sprint 5) ━━━${C.reset}\n`);
  const {
    VERTICALS, isValidStatut, numOrUndef, normalizeBlock, validateBlock,
    inlineToBlock, vefaProgramToBlock, keyformToBlock, KEYFORM_GABARIT_FIELDS,
  } = await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));

  // ── A. Verticaux + helpers du contrat ──
  assert(VERTICALS.immo.id === 'immo' && VERTICALS.generic.id === 'generic',
    'schéma : 2 verticaux exposés (immo + generic)');
  assert(!!VERTICALS.immo.cards_heading && !!VERTICALS.generic.cards_heading,
    'schéma : méta cards_heading présente (consommée par render/prompt en S8)');
  assert(isValidStatut('disponible') && isValidStatut('vendu') && !isValidStatut('zzz'),
    'schéma : isValidStatut reconnaît les statuts du contrat');

  // Coercition numérique DU CONTRAT : vide/illisible → undefined (jamais 0).
  assert(numOrUndef('')        === undefined, 'numOrUndef : "" → undefined');
  assert(numOrUndef(null)      === undefined, 'numOrUndef : null → undefined');
  assert(numOrUndef(undefined) === undefined, 'numOrUndef : undefined → undefined');
  assert(numOrUndef('abc')     === undefined, 'numOrUndef : illisible → undefined');
  assert(numOrUndef(0)         === 0,         'numOrUndef : 0 explicite → 0 (préservé)');
  assert(numOrUndef('389000')  === 389000,    'numOrUndef : string numérique → number');

  // ── B. normalizeBlock : forme, défauts, idempotence, non-destructif ──
  const nz = normalizeBlock(null);
  assert(nz.vertical === 'immo' && Array.isArray(nz.configurations),
    'normalizeBlock(null) : forme sûre (vertical immo + configurations[])');
  assert(normalizeBlock({ vertical: 'generic' }).vertical === 'generic',
    'normalizeBlock : vertical generic respecté');
  assert(normalizeBlock({ vertical: 'bidon' }).vertical === 'immo',
    'normalizeBlock : vertical inconnu → immo (défaut sûr)');
  assert(nz.persona.ton === 'professionnel et chaleureux' && nz.persona.langue_par_defaut === 'fr',
    'normalizeBlock : persona par défaut (ton + langue)');
  assert(nz.branding.fond === 'clair',
    'normalizeBlock : branding.fond défaut "clair"');

  const once  = normalizeBlock(MOCK_DATA['concierge']);
  const twice = normalizeBlock(once);
  assert(JSON.stringify(once) === JSON.stringify(twice),
    'normalizeBlock : idempotent (forme stable au 2e passage)');
  const input    = { vertical: 'immo', programme: { nom: 'X' }, configurations: [{ reference: 'A' }] };
  const snapshot = JSON.stringify(input);
  normalizeBlock(input);
  assert(JSON.stringify(input) === snapshot,
    'normalizeBlock : non destructif (entrée intacte)');

  // Coercition au niveau item (vide → undefined ; garage string → bool ; prestations filtrées)
  const item = normalizeBlock({ configurations: [{ reference: 'A',
    nb_chambres: '', prix_ttc: '', surface_habitable_m2: '',
    surfaces_annexes: { jardin_m2: '', garage: 'true' },
    prestations: ['', 'Cuisine équipée', ''] }] }).configurations[0];
  assert(item.nb_chambres === undefined && item.prix_ttc === undefined && item.surface_habitable_m2 === undefined,
    'normalizeItem : numériques vides → undefined (droppés sur le fil)');
  assert(item.surfaces_annexes.garage === true,
    'normalizeItem : garage "true" (string) → true');
  assert(item.prestations.length === 1 && item.prestations[0] === 'Cuisine équipée',
    'normalizeItem : prestations vides filtrées');
  const itemFalse = normalizeBlock({ configurations: [{ reference: 'B', surfaces_annexes: { garage: false } }] }).configurations[0];
  assert(itemFalse.surfaces_annexes.garage === false,
    'normalizeItem : garage false → false');

  // ── C. validateBlock : immo (non-régression) + generic ──
  assert(validateBlock(MOCK_DATA['concierge']).length === 0,
    'validateBlock(immo Ollioules) = 0 erreur (non-régression)');
  const eImmo = validateBlock({});
  assert(eImmo.includes('Le nom du programme est obligatoire.'),
    'validateBlock immo : message programme IDENTIQUE à l\'historique');
  assert(eImmo.includes('Au moins une configuration est obligatoire.'),
    'validateBlock immo : message configurations IDENTIQUE');
  assert(eImmo.includes('Le nom de l\'agence (branding) est obligatoire.'),
    'validateBlock immo : message agence IDENTIQUE');
  const eStat = validateBlock({ ...MOCK_DATA['concierge'], configurations: [{ reference: 'X', statut: 'zzz' }] });
  assert(eStat.some(m => m.includes('statut invalide')),
    'validateBlock immo : statut invalide rejeté');

  const genOk = { vertical: 'generic', branding: { nom_agence: 'Enseigne X' }, configurations: [{ reference: 'Offre 1' }] };
  assert(validateBlock(genOk).length === 0,
    'validateBlock(generic minimal) = 0 erreur');
  const eGen = validateBlock({ vertical: 'generic' });
  assert(eGen.includes('Le nom de l\'enseigne (branding) est obligatoire.'),
    'validateBlock generic : message enseigne (parallèle immo)');
  assert(eGen.includes('Au moins une offre est obligatoire.'),
    'validateBlock generic : message offre');
  const eGen2 = validateBlock({ vertical: 'generic', branding: { nom_agence: 'X' }, configurations: [{ reference: '' }] });
  assert(eGen2.some(m => m.includes('intitulé manquant')),
    'validateBlock generic : offre sans intitulé rejetée');

  // ── D1. Adaptateur inline (Source 1, S4) → bloc immo valide ──
  assert(validateBlock(inlineToBlock(MOCK_DATA['concierge'])).length === 0,
    'inlineToBlock : saisie studio S4 → bloc immo valide');

  // ── D2. Adaptateur VEFA (Source 2, S6) : forme à plat → bloc immo ──
  const program = {
    nom: 'Les Jardins de Test', promoteur: 'Promo X', ville: 'Toulon', livraison_prevue: 'T4 2026',
    lots: [
      { reference: 'Lot 1', type: 'T3', nb_chambres: 2, statut: 'disponible',
        surface_habitable_m2: 70, jardin_m2: 40, garage: true, exposition: 'Sud',
        prix_ttc: 350000, stationnement: '1 garage', prestations: ['Cuisine équipée'] },
    ],
    faq: [{ q: 'Frais de notaire ?', r: 'Réduits en VEFA.' }],
    questions: ['Quels lots sont disponibles ?'],
    contact: { nom: 'Jean Dupont', tel: '0494000000', email: 'contact@agence.fr' },
    disclaimer: 'Référez-vous à la notice.',
    agence: { nom: 'Agence Y', logo_url: '', banner_url: 'https://cdn.test/banniere.jpg', couleur_primaire: '#2563eb', couleur_secondaire: '#c9a96e' },
  };
  const vb = vefaProgramToBlock(program);
  assert(vb.vertical === 'immo',                                'vefaProgramToBlock : vertical immo');
  assert(validateBlock(vb).length === 0,                        'vefaProgramToBlock : bloc produit valide');
  assert(vb.programme.nom === 'Les Jardins de Test',            'vefaProgramToBlock : programme.nom mappé');
  assert(vb.configurations[0].surfaces_annexes.jardin_m2 === 40, 'vefaProgramToBlock : jardin_m2 nesté dans surfaces_annexes');
  assert(vb.configurations[0].surfaces_annexes.garage === true,  'vefaProgramToBlock : garage nesté dans surfaces_annexes');
  assert(vb.configurations[0].prix_ttc === 350000,             'vefaProgramToBlock : prix lot préservé');
  assert(vb.branding.nom_agence === 'Agence Y',                'vefaProgramToBlock : agence → branding');
  assert(vb.branding.banner_url === 'https://cdn.test/banniere.jpg', 'vefaProgramToBlock : agence.banner_url → branding.banner_url (cover)');

  // ── D3. Adaptateur Keyform (Source 3, S7) : gabarit canonique → bloc generic ──
  const F = KEYFORM_GABARIT_FIELDS;
  const submission = {
    [F.nom_enseigne]:       'Boutique Test',
    [F.titre_offre]:        'Nos forfaits',
    [F.ville]:              'Bandol',
    [F.couleur_primaire]:   '#2563eb',
    [F.couleur_secondaire]: '#c9a96e',
    [F.logo]:               '',
    [F.items]: [
      { [F.item_nom]: 'Forfait Découverte',
        [F.item_attr_label[0]]: 'Durée', [F.item_attr_value[0]]: '1 h',
        [F.item_attr_label[1]]: 'Niveau', [F.item_attr_value[1]]: 'Débutant',
        [F.item_prix]: 49, [F.item_desc]: 'Idéal pour débuter.' },
    ],
    [F.faq]:       [{ [F.faq_q]: 'Sur réservation ?', [F.faq_r]: 'Oui, en ligne.' }],
    [F.questions]: [{ [F.question]: 'Que proposez-vous ?' }],
    [F.contact_nom]: 'Marie Martin', [F.contact_tel]: '0494000000', [F.contact_email]: 'm@boutique.fr',
    [F.disclaimer]: 'Offres soumises à conditions.',
  };
  const kb = keyformToBlock(submission);
  assert(kb.vertical === 'generic',                          'keyformToBlock : vertical generic');
  assert(validateBlock(kb).length === 0,                     'keyformToBlock : bloc produit valide');
  assert(kb.branding.nom_agence === 'Boutique Test',         'keyformToBlock : nom_enseigne → branding.nom_agence');
  assert(kb.configurations[0].reference === 'Forfait Découverte', 'keyformToBlock : item_nom → reference (intitulé offre)');
  assert(kb.configurations[0].attributs.length === 2,        'keyformToBlock : 2 attributs remplis (3e vide droppé)');
  assert(kb.configurations[0].attributs[0].label === 'Durée' && kb.configurations[0].attributs[0].value === '1 h',
    'keyformToBlock : paire attribut label/value mappée');
  assert(kb.configurations[0].prix_label === '49' && kb.configurations[0].prix_ttc === undefined,
    'keyformToBlock : item_prix → prix_label (texte libre, prix_ttc numérique non utilisé en generic)');
  assert(kb.questions_suggerees[0] === 'Que proposez-vous ?', 'keyformToBlock : question (ligne objet) → string');
  const kb2 = keyformToBlock({ ...submission, [F.questions]: ['Question brute ?'] });
  assert(kb2.questions_suggerees[0] === 'Question brute ?',  'keyformToBlock : questions tolère les lignes string');

  // ── D4. Gabarit « Fiche établissement » (Key Form -> Concierge, Sprint C-b) ──
  // QUE des champs PLATS (zéro répéteur, retiré 2026-05-31 = trop complexe pour
  // un commerçant). gabaritResponseToSubmission assemble les champs remplis en
  // submission keyform -> keyformToBlock -> bloc generic.
  const { buildConciergeFicheGabarit, isConciergeGabarit, gabaritResponseToSubmission,
          GABARIT_MAX, CONCIERGE_GABARIT_PIVOT_ID } =
    await import(join(ROOT, 'app/lib/concierge-keyform-gabarit.js'));
  assert(GABARIT_MAX.offres === 4 && GABARIT_MAX.faq === 4 && GABARIT_MAX.suggestions === 3,
    'gabarit Fiche : plafonds Compact 4/4/3');
  const gab = buildConciergeFicheGabarit();
  const gabFields = gab.sections.flatMap((s) => s.fields || []);
  assert(gabFields.every((f) => f && f.type !== 'repeater'),
    'gabarit Fiche : AUCUN bloc répétable (que des champs simples)');
  const gabIds = new Set(gabFields.map((f) => f && f.id));
  // Champs plats attendus (pivot + 1re offre requise + au moins une paire FAQ).
  ['cg_nom_enseigne', 'cg_titre_offre', 'cg_ville', 'cg_offre1_nom', 'cg_offre1_prix',
   'cg_offre1_desc', 'cg_offre4_nom', 'cg_faq1_q', 'cg_faq1_r', 'cg_sugg1',
   'cg_contact_nom', 'cg_contact_email', 'cg_disclaimer'].forEach((id) =>
    assert(gabIds.has(id), `gabarit Fiche : champ plat "${id}" présent`));
  assert(gabFields.find((f) => f.id === 'cg_nom_enseigne')?.required &&
         gabFields.find((f) => f.id === 'cg_offre1_nom')?.required,
    'gabarit Fiche : enseigne + 1re offre requises (garantit un bloc valide)');
  assert(CONCIERGE_GABARIT_PIVOT_ID === 'cg_nom_enseigne' && isConciergeGabarit(gab),
    'gabarit Fiche : détecté comme gabarit Concierge (pivot cg_nom_enseigne)');
  assert(!isConciergeGabarit({ sections: [{ fields: [{ id: 'fld_xx' }] }] }),
    'gabarit Fiche : un form Key Form quelconque n\'est PAS un gabarit Concierge');

  // Assemblage : réponse PLATE (2 offres remplies + 1 vide ignorée) -> submission.
  const flat = {
    cg_nom_enseigne: 'Bowling de Bandol', cg_titre_offre: 'Le spot loisirs', cg_ville: 'Bandol',
    cg_offre1_nom: 'Partie de bowling', cg_offre1_prix: '6 € la partie', cg_offre1_desc: 'Chaussures incluses.',
    cg_offre2_nom: 'Formule Apéro', cg_offre2_prix: '15 €', cg_offre2_desc: '1 partie + 1 cocktail.',
    cg_offre3_nom: '', cg_offre3_prix: '', cg_offre3_desc: '',   // ligne vide -> ignorée
    cg_faq1_q: 'Vos horaires ?', cg_faq1_r: 'Ouvert 7j/7.',
    cg_faq2_q: '', cg_faq2_r: '',                                 // paire vide -> ignorée
    cg_sugg1: 'Comment reserver ?', cg_sugg2: '', cg_sugg3: '',
    cg_contact_nom: 'Camille', cg_contact_tel: '0494000000', cg_contact_email: 'c@bowling.fr',
    cg_disclaimer: 'Informations non contractuelles.',
  };
  const sub = gabaritResponseToSubmission(flat);
  assert(sub.cg_items.length === 2,     'assemblage : 2 offres remplies (la vide ignorée)');
  assert(sub.cg_items[0].item_nom === 'Partie de bowling' && sub.cg_items[0].item_prix === '6 € la partie',
    'assemblage : offre 1 nom + prix');
  assert(sub.cg_faq.length === 1 && sub.cg_faq[0].faq_q === 'Vos horaires ?', 'assemblage : 1 FAQ (paire vide ignorée)');
  assert(sub.cg_questions.length === 1 && sub.cg_questions[0] === 'Comment reserver ?', 'assemblage : 1 suggestion');

  // submission assemblée -> keyformToBlock -> bloc generic valide.
  const gb = keyformToBlock(sub);
  assert(gb.vertical === 'generic',                          'gabarit Fiche : réponse -> bloc generic');
  assert(validateBlock(gb).length === 0,                     'gabarit Fiche : réponse -> bloc VALIDE (0 erreur)');
  assert(gb.branding.nom_agence === 'Bowling de Bandol',     'gabarit Fiche : enseigne -> branding.nom_agence');
  assert(gb.configurations.length === 2 && gb.configurations[0].reference === 'Partie de bowling',
    'gabarit Fiche : 2 offres -> 2 configurations');
  assert(gb.faq_validee[0].q === 'Vos horaires ?',           'gabarit Fiche : FAQ mappée');
  assert(gb.questions_suggerees[0] === 'Comment reserver ?', 'gabarit Fiche : suggestion mappée');

  // Rétro-compat : réponse contenant déjà des tableaux (ancien répéteur) -> conservée.
  const subOld = gabaritResponseToSubmission({ cg_nom_enseigne: 'X', cg_items: [{ item_nom: 'Direct' }] });
  assert(subOld.cg_items.length === 1 && subOld.cg_items[0].item_nom === 'Direct',
    'assemblage : tableau cg_items préexistant conservé (rétro-compat)');
}

// ══════════════════════════════════════════════════════════════
// CONCIERGE VEFA — Fenêtre Programme (helpers purs, Sprint 6)
// ───────────────────────────────────────────────────────────────
// Garantit que la « forme à plat » produite par VEFA Studio
// (app/lib/concierge-program.js) reste ALIGNÉE avec le contrat
// figé (vefaProgramToBlock, côté Worker). Le round-trip
// blankProgram() → vefaProgramToBlock() → validateBlock() est la
// preuve cross-module : ce que la fenêtre saisit, le moteur le lit.
// ══════════════════════════════════════════════════════════════
async function testConciergeProgram() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Fenêtre Programme (Sprint 6) ━━━${C.reset}\n`);
  const {
    PROGRAM_STORAGE_KEY, LOT_STATUTS,
    blankLot, blankProgram, coerceProgram, validateProgramLight,
  } = await import(join(ROOT, 'app/lib/concierge-program.js'));
  const { vefaProgramToBlock, validateBlock, isValidStatut } =
    await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));

  // ── A. Clés == contrat (linchpin anti-dérive) ──
  // Ces 11 clés sont EXACTEMENT ce que vefaProgramToBlock lit par lot.
  // Si quelqu'un en ajoute/retire une côté front sans toucher le moteur,
  // ce test casse AVANT que la donnée se perde silencieusement sur le fil.
  const CONTRACT_LOT_KEYS = ['reference', 'type', 'nb_chambres', 'statut',
    'surface_habitable_m2', 'jardin_m2', 'garage', 'exposition', 'prix_ttc',
    'stationnement', 'prestations'].sort();
  assert(JSON.stringify(Object.keys(blankLot()).sort()) === JSON.stringify(CONTRACT_LOT_KEYS),
    'blankLot : 11 clés == exactement ce que vefaProgramToBlock lit par lot');
  const PROGRAM_KEYS = ['nom', 'promoteur', 'ville', 'livraison_prevue', 'lots',
    'faq', 'questions', 'contact', 'disclaimer', 'agence'].sort();
  assert(JSON.stringify(Object.keys(blankProgram()).sort()) === JSON.stringify(PROGRAM_KEYS),
    'blankProgram : 10 clés à plat == ce que vefaProgramToBlock lit');
  assert(PROGRAM_STORAGE_KEY === 'ks_concierge_source_vefa_v1',
    'PROGRAM_STORAGE_KEY : clé relais VEFA -> SDQR figée (consommée en S7)');

  // ── B. Défauts sûrs (DOM rend des strings ; numériques en string) ──
  const bl = blankLot();
  assert(bl.statut === 'disponible',                 'blankLot : statut défaut "disponible"');
  assert(bl.garage === false,                        'blankLot : garage bool false');
  assert(Array.isArray(bl.prestations) && bl.prestations.length === 0,
    'blankLot : prestations array vide');
  assert(bl.nb_chambres === '' && bl.prix_ttc === '',
    'blankLot : numériques en string vide (coercés côté moteur)');
  const bp = blankProgram();
  assert(bp.lots.length === 1,                       'blankProgram : démarre avec 1 lot');
  assert(bp.agence.couleur_primaire === '#2563eb' && bp.agence.couleur_secondaire === '#c9a96e',
    'blankProgram : couleurs charte par défaut');
  assert(bp.contact.nom === '' && bp.contact.tel === '' && bp.contact.email === '',
    'blankProgram : contact imbriqué présent (3 champs vides)');

  // ── C. LOT_STATUTS ⊆ statuts du contrat ──
  assert(JSON.stringify(LOT_STATUTS) === JSON.stringify(['disponible', 'optionne', 'vendu']),
    'LOT_STATUTS : 3 statuts attendus');
  assert(LOT_STATUTS.every((s) => isValidStatut(s)),
    'LOT_STATUTS : chaque statut front est valide pour le contrat');

  // ── D. coerceProgram : forme sûre, idempotence, non-destructif ──
  assert(JSON.stringify(coerceProgram(null)) === JSON.stringify(blankProgram()),
    'coerceProgram(null) : retombe sur blankProgram()');
  const dirty = {
    nom: 'X',
    lots: [{ reference: 'A', statut: 'zzz', garage: 'true', nb_chambres: 3,
             prestations: ['', 'Cuisine', ''] }],
    faq: [{ q: 'Q1', r: '' }, { q: '', r: '' }],
    questions: ['Q ?', 42],
  };
  const snap = JSON.stringify(dirty);
  const cp = coerceProgram(dirty);
  assert(JSON.stringify(dirty) === snap,             'coerceProgram : non destructif (entrée intacte)');
  assert(JSON.stringify(coerceProgram(cp)) === JSON.stringify(cp),
    'coerceProgram : idempotent (forme stable au 2e passage)');
  assert(cp.lots[0].statut === 'disponible',         'coerceLot : statut inconnu "zzz" → "disponible"');
  assert(cp.lots[0].garage === true,                 'coerceLot : garage "true" (string) → true');
  assert(cp.lots[0].nb_chambres === '3',             'coerceLot : numérique coercé en string (DOM-safe)');
  assert(cp.lots[0].prestations.length === 1 && cp.lots[0].prestations[0] === 'Cuisine',
    'coerceLot : prestations vides filtrées');
  assert(cp.faq.length === 1 && cp.faq[0].q === 'Q1',
    'coerceProgram : faq sans q ni r droppée');
  assert(cp.questions.length === 2 && cp.questions[1] === '42',
    'coerceProgram : questions coercées en string');
  const partial = coerceProgram({ nom: 'Seul le nom' });
  assert(partial.lots.length === 1 && partial.contact && partial.agence,
    'coerceProgram : objets/arrays imbriqués garantis même sur entrée partielle');

  // ── E. validateProgramLight : garde-fou léger avant envoi ──
  const eEmpty = validateProgramLight(blankProgram());
  assert(eEmpty.length === 2,                         'validateProgramLight : programme vide → 2 erreurs');
  assert(eEmpty.includes('Le nom du programme est obligatoire.'),
    'validateProgramLight : nom manquant signalé');
  assert(eEmpty.includes('Au moins un lot avec une référence est obligatoire.'),
    'validateProgramLight : aucun lot référencé signalé');
  assert(validateProgramLight({ nom: 'X', lots: [{ reference: 'A' }] }).length === 0,
    'validateProgramLight : nom + 1 lot référencé → 0 erreur');
  assert(validateProgramLight({ nom: '', lots: [{ reference: 'A' }] }).length === 1,
    'validateProgramLight : lot ok mais nom manquant → 1 erreur');
  assert(validateProgramLight({ nom: 'X', lots: [{ reference: '' }] }).length === 1,
    'validateProgramLight : nom ok mais lot non référencé → 1 erreur');

  // ── F. Round-trip front → contrat (LA garantie cross-module) ──
  const filled = blankProgram();
  filled.nom              = 'Les Terrasses Ollioules';
  filled.promoteur        = 'Promoteur Horizon';
  filled.ville            = 'Ollioules';
  filled.livraison_prevue = 'T4 2026';
  filled.agence.nom       = 'Agence Horizon';
  filled.lots[0] = { ...blankLot(),
    reference: 'Maison A', type: 'T4', nb_chambres: '', statut: 'optionne',
    surface_habitable_m2: '92', jardin_m2: '250', garage: true, exposition: 'Sud',
    prix_ttc: '389000', stationnement: '2 places',
    prestations: ['Cuisine equipee', 'Volets motorises'] };
  const vb = vefaProgramToBlock(filled);
  assert(vb.vertical === 'immo',                     'round-trip : vertical immo');
  assert(validateBlock(vb).length === 0,             'round-trip : bloc produit valide (0 erreur)');
  const c0 = vb.configurations[0];
  assert(c0.reference === 'Maison A',                'round-trip : référence lot préservée');
  assert(c0.statut === 'optionne',                   'round-trip : statut préservé');
  assert(c0.surface_habitable_m2 === 92,             'round-trip : string DOM "92" → number 92 (coercion moteur)');
  assert(c0.prix_ttc === 389000,                     'round-trip : prix "389000" → number');
  assert(c0.nb_chambres === undefined,               'round-trip : numérique vide "" → undefined (jamais 0 ch.)');
  assert(c0.surfaces_annexes.jardin_m2 === 250,      'round-trip : jardin_m2 nesté dans surfaces_annexes');
  assert(c0.surfaces_annexes.garage === true,        'round-trip : garage nesté dans surfaces_annexes');
  assert(Array.isArray(c0.prestations) && c0.prestations.length === 2,
    'round-trip : 2 prestations transmises');
  assert(vb.branding.nom_agence === 'Agence Horizon', 'round-trip : agence.nom → branding.nom_agence');
}

// ══════════════════════════════════════════════════════════════
// CONCIERGE VEFA — Glue de sauvegarde + miroir (Sprint 7)
// ───────────────────────────────────────────────────────────────
// S7 câble la source « vefa » de bout en bout sur le chemin immo :
//   · buildConciergeBlockFromVefa (concierge-schema.js, backend) =
//     la glue que le Worker (qr.js) exécute AU SAVE — programme à
//     plat -> bloc canonique validé, ou { error } (1er message).
//   · listConciergeQRs (concierge-program.js, pur) = le miroir
//     Concierge consommé par la liste SDQR + la vue filtrée VEFA.
// On prouve ici que la glue accepte/refuse exactement comme le
// couple vefaProgramToBlock+validateBlock, et que le miroir filtre
// sans jamais planter sur une flotte malformée.
// ══════════════════════════════════════════════════════════════
async function testConciergeS7() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Glue save + miroir (Sprint 7) ━━━${C.reset}\n`);
  const { buildConciergeBlockFromVefa, CONCIERGE_BLOCK_MAX_BYTES,
          vefaProgramToBlock, validateBlock } =
    await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));
  const { listConciergeQRs, CONCIERGE_TEMPLATE_ID, blankProgram } =
    await import(join(ROOT, 'app/lib/concierge-program.js'));

  // ── A. Payload manquant / mal typé → { error } (jamais throw) ──
  const MISSING = 'concierge_payload manquant pour la source VEFA.';
  for (const bad of [null, undefined, [], 'x', 42, true]) {
    const r = buildConciergeBlockFromVefa(bad);
    assert(r && r.error === MISSING && !r.block,
      `buildConciergeBlockFromVefa(${JSON.stringify(bad)}) → { error } payload manquant`);
  }

  // ── B. Programme valide → { block } == vefaProgramToBlock + valide ──
  const prog = {
    nom: 'Les Jardins de Bandol',
    lots: [{ reference: 'A1', statut: 'disponible', surface_habitable_m2: '88' }],
    agence: { nom: 'Agence Sud' },
  };
  const ok = buildConciergeBlockFromVefa(prog);
  assert(ok && ok.block && !ok.error,            'glue : programme valide → { block } (pas d\'erreur)');
  assert(ok.block.vertical === 'immo',           'glue : bloc produit en vertical immo');
  assert(validateBlock(ok.block).length === 0,   'glue : bloc produit passe validateBlock (0 erreur)');
  assert(JSON.stringify(ok.block) === JSON.stringify(vefaProgramToBlock(prog)),
    'glue : { block } IDENTIQUE à vefaProgramToBlock(program) (zéro divergence)');

  // ── C. Programme invalide → { error } == 1er message de validateBlock ──
  const bad = { lots: [{ reference: 'A1' }], agence: { nom: 'Ag' } };  // nom programme manquant
  const expected = validateBlock(vefaProgramToBlock(bad))[0];
  const rBad = buildConciergeBlockFromVefa(bad);
  assert(rBad && rBad.error && !rBad.block,       'glue : programme invalide → { error } (pas de block)');
  assert(rBad.error === expected,                 'glue : { error } == 1er message de validateBlock');
  assert(rBad.error === 'Le nom du programme est obligatoire.',
    'glue : nom de programme manquant correctement signalé');

  // ── D. Cap 64 KB = même garde-fou que template_data côté qr.js ──
  assert(CONCIERGE_BLOCK_MAX_BYTES === 64 * 1024,
    'CONCIERGE_BLOCK_MAX_BYTES : cap 64 KB figé (miroir du garde-fou qr.js)');
  const huge = {
    nom: 'Programme XL',
    lots: [{ reference: 'A1' }],
    agence: { nom: 'Ag' },
    disclaimer: 'x'.repeat(70 * 1024),  // > 64 KB une fois sérialisé
  };
  const rHuge = buildConciergeBlockFromVefa(huge);
  assert(rHuge && rHuge.error === 'template_data trop volumineux (max 64 KB)' && !rHuge.block,
    'glue : bloc > 64 KB → { error } trop volumineux');
  // Le cap se déclenche APRÈS la validation métier (valide mais trop gros).
  assert(validateBlock(vefaProgramToBlock(huge)).length === 0,
    'glue : le programme XL est métier-valide — seul le cap taille le rejette');

  // ── E. listConciergeQRs : miroir robuste sur flotte hétérogène ──
  assert(CONCIERGE_TEMPLATE_ID === 'concierge',
    'CONCIERGE_TEMPLATE_ID : id du template figé == registre SDQR');
  const fleet = [
    { short_id: 'A', template_id: 'concierge' },
    { short_id: 'B', template_id: 'scratch' },
    null,
    { short_id: 'C' },                              // pas de template_id
    { short_id: 'D', template_id: 'concierge' },
    undefined,
  ];
  const only = listConciergeQRs(fleet);
  assert(only.length === 2 && only.every((q) => q.template_id === CONCIERGE_TEMPLATE_ID),
    'listConciergeQRs : ne garde que les QR template_id "concierge"');
  assert(only[0].short_id === 'A' && only[1].short_id === 'D',
    'listConciergeQRs : ordre de la flotte préservé');
  assert(JSON.stringify(listConciergeQRs(null)) === '[]'
      && JSON.stringify(listConciergeQRs(undefined)) === '[]'
      && JSON.stringify(listConciergeQRs('nope')) === '[]'
      && JSON.stringify(listConciergeQRs({})) === '[]',
    'listConciergeQRs : entrée non-array → [] (jamais throw)');
  assert(JSON.stringify(listConciergeQRs([])) === '[]',
    'listConciergeQRs : flotte vide → []');

  // ── F. Round-trip glue depuis blankProgram() rempli (parité S6→S7) ──
  const filled = blankProgram();
  filled.nom        = 'Résidence Test';
  filled.agence.nom = 'Agence Test';
  filled.lots[0].reference = 'Lot-1';
  const rFilled = buildConciergeBlockFromVefa(filled);
  assert(rFilled.block && !rFilled.error,
    'glue : blankProgram() rempli (nom + agence + 1 lot réf) → { block }');
  assert(JSON.stringify(rFilled.block) === JSON.stringify(vefaProgramToBlock(filled)),
    'glue : parité finale glue == adaptateur sur blankProgram rempli');
}

// ══════════════════════════════════════════════════════════════
// CONCIERGE — Source GÉNÉRIQUE « gabarit » studio SDQR (Sprint 7.5)
// ───────────────────────────────────────────────────────────────
// La 3e source (générique, tous métiers) se saisit DANS le studio
// SDQR (Option B) : le studio assemble une submission à plat keyée
// par KEYFORM_GABARIT_FIELDS, le Worker la passe à keyformToBlock
// au save via buildConciergeBlockFromKeyform.
// Le PIVOT anti-dérive = la PARITÉ des ids : blankKeyform()/
// blankKeyformItem() (front) DOIVENT exposer exactement les ids que
// keyformToBlock lit (contrat). Si l'un dérive sans l'autre, ce test
// casse AVANT que la donnée se perde silencieusement sur le fil.
// ══════════════════════════════════════════════════════════════
async function testConciergeKeyform() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE — Source générique « gabarit » studio (Sprint 7.5) ━━━${C.reset}\n`);
  const { buildConciergeBlockFromKeyform, CONCIERGE_BLOCK_MAX_BYTES,
          keyformToBlock, validateBlock, KEYFORM_GABARIT_FIELDS } =
    await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));
  const { blankKeyform, blankKeyformItem, coerceKeyform, validateKeyformLight } =
    await import(join(ROOT, 'app/lib/concierge-program.js'));

  // ── A. PARITÉ des ids (linchpin anti-dérive) ──
  // blankKeyform() expose EXACTEMENT les ids top-level que keyformToBlock lit.
  const F = KEYFORM_GABARIT_FIELDS;
  const expectedTop = [F.nom_enseigne, F.titre_offre, F.ville, F.adresse, F.couleur_primaire,
    F.couleur_secondaire, F.logo, F.items, F.faq, F.questions, F.contact_nom,
    F.contact_tel, F.contact_email, F.disclaimer].sort();
  assert(JSON.stringify(Object.keys(blankKeyform()).sort()) === JSON.stringify(expectedTop),
    'blankKeyform : 14 ids top-level == exactement ce que keyformToBlock lit');
  const expectedItem = [F.item_nom, ...F.item_attr_label, ...F.item_attr_value,
    F.item_prix, F.item_desc].sort();
  assert(JSON.stringify(Object.keys(blankKeyformItem()).sort()) === JSON.stringify(expectedItem),
    'blankKeyformItem : 9 ids == exactement les sous-champs item de keyformToBlock');

  // ── B. Défauts sûrs (DOM rend des strings) ──
  const bk = blankKeyform();
  assert(bk.cg_items.length === 1 && bk.cg_faq.length === 0 && bk.cg_questions.length === 0,
    'blankKeyform : démarre avec 1 offre, faq/questions vides');
  assert(bk.cg_couleur_primaire === '#2563eb' && bk.cg_couleur_secondaire === '#c9a96e',
    'blankKeyform : couleurs charte par défaut');
  assert(blankKeyformItem().item_prix === '',
    'blankKeyformItem : prix en string vide (coercé côté moteur)');

  // ── C. buildConciergeBlockFromKeyform : payload manquant → { error } ──
  const MISSING = 'concierge_payload manquant pour la source Keyform.';
  for (const bad of [null, undefined, [], 'x', 42, true]) {
    const r = buildConciergeBlockFromKeyform(bad);
    assert(r && r.error === MISSING && !r.block,
      `buildConciergeBlockFromKeyform(${JSON.stringify(bad)}) → { error } payload manquant`);
  }

  // ── D. Submission valide → { block } generic == keyformToBlock + valide ──
  const sub = {
    cg_nom_enseigne: 'Studio Lumiere',
    cg_titre_offre:  'Nos forfaits',
    cg_items: [{ item_nom: 'Forfait Pro', item_prix: '120',
                 item_attr1_label: 'Seances', item_attr1_value: '3',
                 item_desc: 'Tout inclus' }],
  };
  const ok = buildConciergeBlockFromKeyform(sub);
  assert(ok && ok.block && !ok.error,            'glue keyform : submission valide → { block }');
  assert(ok.block.vertical === 'generic',        'glue keyform : bloc produit en vertical generic');
  assert(validateBlock(ok.block).length === 0,   'glue keyform : bloc passe validateBlock generic (0 erreur)');
  assert(JSON.stringify(ok.block) === JSON.stringify(keyformToBlock(sub)),
    'glue keyform : { block } IDENTIQUE à keyformToBlock(submission)');
  const c0 = ok.block.configurations[0];
  assert(c0.reference === 'Forfait Pro',         'glue keyform : item_nom → reference');
  assert(c0.prix_label === '120',                'glue keyform : item_prix "120" → prix_label "120" (texte libre)');
  assert(c0.attributs.length === 1 && c0.attributs[0].label === 'Seances' && c0.attributs[0].value === '3',
    'glue keyform : paire attribut label/value transmise');

  // ── E. Submission invalide → { error } == 1er message validateBlock ──
  const subNoEnseigne = { cg_items: [{ item_nom: 'Offre A' }] };
  const expectedErr = validateBlock(keyformToBlock(subNoEnseigne))[0];
  const rBad = buildConciergeBlockFromKeyform(subNoEnseigne);
  assert(rBad && rBad.error && !rBad.block,        'glue keyform : enseigne manquante → { error }');
  assert(rBad.error === expectedErr,               'glue keyform : { error } == 1er message validateBlock');
  assert(rBad.error === 'Le nom de l\'enseigne (branding) est obligatoire.',
    'glue keyform : message enseigne manquante (vertical generic)');

  // ── F. Cap 64 KB (même garde-fou que template_data côté qr.js) ──
  const subHuge = { cg_nom_enseigne: 'X', cg_items: [{ item_nom: 'A' }],
                    cg_disclaimer: 'x'.repeat(70 * 1024) };
  const rHuge = buildConciergeBlockFromKeyform(subHuge);
  assert(rHuge && rHuge.error === 'template_data trop volumineux (max 64 KB)' && !rHuge.block,
    'glue keyform : bloc > 64 KB → { error } trop volumineux');
  assert(CONCIERGE_BLOCK_MAX_BYTES === 64 * 1024,
    'CONCIERGE_BLOCK_MAX_BYTES : cap partagé vefa/keyform (64 KB)');

  // ── G. coerceKeyform : forme sûre, idempotence, non destructif ──
  assert(JSON.stringify(coerceKeyform(null)) === JSON.stringify(blankKeyform()),
    'coerceKeyform(null) : retombe sur blankKeyform()');
  const dirty = {
    cg_nom_enseigne: 'X',
    cg_items: [{ item_nom: 'A', item_prix: 49 }],
    cg_faq: [{ faq_q: 'Q', faq_r: '' }, { faq_q: '', faq_r: '' }],
    cg_questions: ['Q1', { cg_question: 'Q2' }, '', 42],
  };
  const snap = JSON.stringify(dirty);
  const ck = coerceKeyform(dirty);
  assert(JSON.stringify(dirty) === snap,           'coerceKeyform : non destructif (entrée intacte)');
  assert(JSON.stringify(coerceKeyform(ck)) === JSON.stringify(ck),
    'coerceKeyform : idempotent (forme stable au 2e passage)');
  assert(ck.cg_items[0].item_prix === '49',        'coerceKeyformItem : numérique coercé en string (DOM-safe)');
  assert(ck.cg_faq.length === 1 && ck.cg_faq[0].faq_q === 'Q',
    'coerceKeyform : faq sans q ni r droppée');
  assert(ck.cg_questions.length === 2 && ck.cg_questions[1] === 'Q2',
    'coerceKeyform : questions normalisées en strings ({cg_question} ou string)');
  assert(coerceKeyform({}).cg_items.length === 1,
    'coerceKeyform : au moins une offre garantie même sur entrée vide');

  // ── H. validateKeyformLight : garde-fou léger avant envoi ──
  const eEmpty = validateKeyformLight(blankKeyform());
  assert(eEmpty.length === 2,                       'validateKeyformLight : gabarit vide → 2 erreurs');
  assert(eEmpty.includes('Le nom de l\'enseigne est obligatoire.'),
    'validateKeyformLight : enseigne manquante signalée');
  assert(eEmpty.includes('Au moins une offre avec un intitulé est obligatoire.'),
    'validateKeyformLight : aucune offre intitulée signalée');
  assert(validateKeyformLight({ cg_nom_enseigne: 'X', cg_items: [{ item_nom: 'A' }] }).length === 0,
    'validateKeyformLight : enseigne + 1 offre intitulée → 0 erreur');
  assert(validateKeyformLight({ cg_nom_enseigne: '', cg_items: [{ item_nom: 'A' }] }).length === 1,
    'validateKeyformLight : offre ok mais enseigne manquante → 1 erreur');
  assert(validateKeyformLight({ cg_nom_enseigne: 'X', cg_items: [{ item_nom: '' }] }).length === 1,
    'validateKeyformLight : enseigne ok mais offre non intitulée → 1 erreur');

  // ── I. Round-trip front → contrat (garantie cross-module) ──
  const filled = blankKeyform();
  filled.cg_nom_enseigne = 'Studio Lumiere';
  filled.cg_ville        = 'Toulon';
  filled.cg_items[0] = { ...blankKeyformItem(),
    item_nom: 'Forfait Pro', item_prix: '120',
    item_attr1_label: 'Seances', item_attr1_value: '3', item_desc: 'Tout inclus' };
  const blk = keyformToBlock(filled);
  assert(blk.vertical === 'generic',               'round-trip keyform : vertical generic');
  assert(validateBlock(blk).length === 0,          'round-trip keyform : bloc valide (0 erreur)');
  assert(blk.branding.nom_agence === 'Studio Lumiere',
    'round-trip keyform : cg_nom_enseigne → branding.nom_agence');
  assert(blk.programme.ville === 'Toulon',         'round-trip keyform : cg_ville → programme.ville');
  const rt = buildConciergeBlockFromKeyform(filled);
  assert(JSON.stringify(rt.block) === JSON.stringify(keyformToBlock(filled)),
    'round-trip keyform : parité glue == adaptateur sur blankKeyform rempli');
}

// ── Tests : Concierge VEFA — Render & prompt GENERIC (Sprint 8) ────
// S8 = le moteur (renderHTML + buildConciergePrompt) devient vertical-aware.
//   A. Immo NON-RÉGRESSION : libellés historiques préservés (cartes + prompt).
//   B. Generic RENDER : cartes « offre » (intitulé + attributs + description +
//      prix), titre « Nos offres », accueil « offres » ; AUCUN libellé immo.
//   C. Generic PROMPT : enseigne/offres + attributs + description fournis à
//      l'IA (le coeur du contenu generic), zéro notion de « statut/vendu ».
async function testConciergeS8() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Render & prompt GENERIC (Sprint 8) ━━━${C.reset}\n`);
  const { getTemplate } = await import(join(ROOT, 'workers/src/routes/smart-templates/index.js'));
  const { buildConciergePrompt } = await import(join(ROOT, 'workers/src/routes/smart-templates/concierge.js'));
  const { keyformToBlock, VERTICALS } = await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));
  const tpl = getTemplate('concierge');

  // Bloc GENERIC réaliste via le VRAI pipeline (gabarit keyform → bloc).
  const genSubmission = {
    cg_nom_enseigne: 'Studio Pilates Lumiere',
    cg_titre_offre:  'Nos formules 2026',
    cg_ville:        'Toulon',
    cg_couleur_primaire:   '#0ea5e9',
    cg_couleur_secondaire: '#f59e0b',
    cg_logo: '',
    cg_items: [
      { item_nom: 'Forfait Decouverte',
        item_attr1_label: 'Seances', item_attr1_value: '3',
        item_attr2_label: 'Duree',   item_attr2_value: '55 min',
        item_prix: '75 €', item_desc: 'Ideal pour debuter en douceur.' },
      { item_nom: 'Forfait Premium',
        item_attr1_label: 'Seances',  item_attr1_value: 'Illimite',
        item_attr2_label: 'Coaching', item_attr2_value: 'Inclus',
        item_prix: '190 € / mois', item_desc: 'Acces libre et suivi personnalise.' },
    ],
    cg_faq:       [{ faq_q: 'Puis-je resilier ?', faq_r: 'Oui, a tout moment.' }],
    cg_questions: [{ cg_question: 'Quelle formule pour debuter ?' }],
    cg_contact_nom: 'Lea', cg_contact_tel: '04 94 11 22 33', cg_contact_email: 'hello@pilates.fr',
    cg_disclaimer: 'Tarifs indicatifs, voir conditions en studio.',
  };
  const genBlock = keyformToBlock(genSubmission);
  assert(genBlock.vertical === 'generic', 'S8 setup : bloc generic produit par keyformToBlock');

  // ── A. Immo NON-RÉGRESSION (libellés historiques) ──
  const immoHtml = tpl.renderHTML({ ...MOCK_QR, template_id: 'concierge', template_data: MOCK_DATA['concierge'] }, MOCK_SCAN);
  assert(immoHtml.includes('Les modèles du programme'), 'S8 immo : titre cartes historique préservé (VERTICALS.immo)');
  assert(immoHtml.includes('pour le programme'),        'S8 immo : accueil historique préservé');
  assert(immoHtml.includes('<dt>Exposition</dt>') && immoHtml.includes('<dt>Chambres</dt>'),
    'S8 immo : specs immo toujours rendues');

  // ── B. Generic RENDER ──
  const genHtml = tpl.renderHTML({ ...MOCK_QR, template_id: 'concierge', template_data: genBlock }, MOCK_SCAN);
  assert(genHtml.includes(VERTICALS.generic.cards_heading) && genHtml.includes('Nos offres'),
    'S8 generic : titre cartes « Nos offres » (VERTICALS.generic)');
  assert(genHtml.includes('Studio Pilates Lumiere'), 'S8 generic : enseigne rendue');
  assert(genHtml.includes('Forfait Decouverte') && genHtml.includes('Forfait Premium'),
    'S8 generic : intitulés d\'offres rendus');
  assert(genHtml.includes('Seances') && genHtml.includes('Illimite'),
    'S8 generic : attributs libres (label + value) rendus');
  assert(genHtml.includes('Ideal pour debuter'), 'S8 generic : description d\'offre rendue');
  assert(genHtml.includes('75 €') && genHtml.includes('190 €'), 'S8 generic : prix déterministes rendus');
  assert(genHtml.includes('découvrir nos offres'), 'S8 generic : accueil cadré « offres »');
  assert(!genHtml.includes('pour le programme'),   'S8 generic : accueil immo ABSENT (pas de fuite de vertical)');
  assert(!genHtml.includes('<dt>Exposition</dt>') && !genHtml.includes('<dt>Chambres</dt>') && !genHtml.includes('<dt>Jardin</dt>'),
    'S8 generic : AUCUN spec immo (cartes « offre » pures)');
  assert(genHtml.includes('cg-card-gen'),          'S8 generic : marqueur carte generic présent (wrap valeur)');
  assert(genHtml.includes('/api/smartqr/concierge') && genHtml.includes('id="cg-thread"'),
    'S8 generic : chat live partagé (endpoint + fil)');
  assert(genHtml.includes('#0ea5e9') && genHtml.includes('#f59e0b'),
    'S8 generic : couleurs enseigne (white-label) injectées');

  // ── C. buildConciergePrompt vertical-aware ──
  const immoPrompt = buildConciergePrompt(MOCK_DATA['concierge']);
  assert(immoPrompt.includes('pour le programme'),         'S8 prompt immo : cadrage programme préservé');
  assert(immoPrompt.includes('configurations de maisons'), 'S8 prompt immo : phrase historique préservée');
  assert(immoPrompt.includes('statut = vendu'),            'S8 prompt immo : règle anti-vendu préservée');
  assert(immoPrompt.includes('{{Pa}}'),                    'S8 prompt immo : prix en repère {{Pa}} (anti perte-de-zeros Mistral)');
  assert(!immoPrompt.includes('389000') && !immoPrompt.includes('389 000'), 'S8 prompt immo : aucun chiffre de prix (tout en repères)');

  const genPrompt = buildConciergePrompt(genBlock);
  assert(genPrompt.includes('Studio Pilates Lumiere'),     'S8 prompt generic : enseigne dans le cadrage');
  assert(genPrompt.includes('offres'),                     'S8 prompt generic : cadrage « offres »');
  assert(genPrompt.includes('Seances') && genPrompt.includes('Illimite'),
    'S8 prompt generic : attributs FOURNIS à l\'IA (le coeur du contenu generic)');
  assert(genPrompt.includes('Ideal pour debuter'),         'S8 prompt generic : description fournie à l\'IA');
  assert(genPrompt.includes('{{Pa}}'),                     'S8 prompt generic : prix en repère {{Pa}} (jamais le chiffre brut)');
  assert(!genPrompt.includes('statut = vendu'),            'S8 prompt generic : pas de règle anti-vendu (pas d\'inventaire)');
  assert(!genPrompt.includes('configurations de maisons'), 'S8 prompt generic : pas de cadrage immo');
}

// ══════════════════════════════════════════════════════════════
// CONCIERGE VEFA — Pont document → programme (CG-10)
// ───────────────────────────────────────────────────────────────
// Le pro saisit le programme et les lots dans Notice & Contrat. CG-10
// reprojette ce _formData sur la forme Concierge SANS double saisie :
//   · vefaDocToLot / vefaDocToProgramHeader = mapping pur déterministe
//   · fillProgramHeaderIfEmpty = seed non destructif de l'en-tête
//   · upsertLot = insert/maj dédupliqué par référence, fusion douce
// On prouve le mapping champ à champ, la non-destruction, la dédup, et
// le round-trip pont → vefaProgramToBlock → validateBlock (0 erreur).
// ══════════════════════════════════════════════════════════════
async function testConciergeBridge() {
  console.log(`\n${C.bold}${C.cyan}━━━ CONCIERGE VEFA — Pont document → programme (CG-10) ━━━${C.reset}\n`);
  const {
    vefaDocToLot, vefaDocToProgramHeader, fillProgramHeaderIfEmpty, upsertLot,
    blankLot, blankProgram, coerceProgram,
  } = await import(join(ROOT, 'app/lib/concierge-program.js'));
  const { vefaProgramToBlock, validateBlock } =
    await import(join(ROOT, 'workers/src/routes/smart-templates/concierge-schema.js'));

  // _formData type Contrat (toutes les clés sources présentes).
  const contrat = {
    nom_programme:  "Les Terrasses d'Ollioules",
    type_logement:  'T4',
    surface:        '92',
    etage:          '2e etage',
    orientation:    'Sud',
    annexes:        'Garage + 1 place',
    lot_numero:     'Maison A',
    surface_carrez: '88.5',
    prix_ttc:       '389000',
    ville:          'Ollioules',
    livraison:      'T4 2026',
    vendeur_nom:    'SCCV Horizon',
  };

  // ── A. vefaDocToLot : mapping champ à champ ──
  const lot = vefaDocToLot(contrat);
  assert(lot.reference === 'Maison A',                'vefaDocToLot : lot_numero → reference');
  assert(lot.type === 'T4',                           'vefaDocToLot : type_logement → type');
  assert(lot.surface_habitable_m2 === '92',           'vefaDocToLot : surface habitable prioritaire → surface_habitable_m2');
  assert(lot.exposition === 'Sud',                    'vefaDocToLot : orientation → exposition');
  assert(lot.prix_ttc === '389000',                   'vefaDocToLot : prix_ttc → prix_ttc');
  assert(lot.stationnement === 'Garage + 1 place',    'vefaDocToLot : annexes → stationnement');
  assert(lot.statut === 'disponible',                 'vefaDocToLot : statut au défaut "disponible"');
  assert(lot.nb_chambres === '' && lot.jardin_m2 === '' && lot.garage === false,
    'vefaDocToLot : champs Concierge-only laissés aux défauts');
  assert(JSON.stringify(Object.keys(lot).sort()) === JSON.stringify(Object.keys(blankLot()).sort()),
    'vefaDocToLot : forme == lot canonique (11 clés)');
  assert(vefaDocToLot({ surface_carrez: '70.2' }).surface_habitable_m2 === '70.2',
    'vefaDocToLot : surface Carrez en repli si pas de surface habitable');
  const nlot = vefaDocToLot({ nom_programme: 'X', type_logement: 'T3', surface: '64', orientation: 'Est', annexes: 'Cave' });
  assert(nlot.reference === '' && nlot.prix_ttc === '',
    'vefaDocToLot : Notice sans lot_numero/prix → reference/prix vides (jamais inventés)');
  assert(nlot.type === 'T3' && nlot.surface_habitable_m2 === '64' && nlot.exposition === 'Est' && nlot.stationnement === 'Cave',
    'vefaDocToLot : Notice → type/surface/exposition/stationnement mappés');
  assert(JSON.stringify(vefaDocToLot(null)) === JSON.stringify(blankLot())
      && JSON.stringify(vefaDocToLot(undefined)) === JSON.stringify(blankLot()),
    'vefaDocToLot : entrée nulle → blankLot() (jamais throw)');

  // ── B. vefaDocToProgramHeader ──
  const hdr = vefaDocToProgramHeader(contrat);
  assert(hdr.nom === "Les Terrasses d'Ollioules" && hdr.promoteur === 'SCCV Horizon'
      && hdr.ville === 'Ollioules' && hdr.livraison_prevue === 'T4 2026',
    'vefaDocToProgramHeader : nom/promoteur(vendeur)/ville/livraison mappés');
  assert(JSON.stringify(vefaDocToProgramHeader(null)) === JSON.stringify({ nom: '', promoteur: '', ville: '', livraison_prevue: '' }),
    'vefaDocToProgramHeader : entrée nulle → 4 scalaires vides');

  // ── C. fillProgramHeaderIfEmpty : seed non destructif ──
  const seeded = fillProgramHeaderIfEmpty(blankProgram(), hdr);
  assert(seeded.nom === "Les Terrasses d'Ollioules" && seeded.ville === 'Ollioules'
      && seeded.promoteur === 'SCCV Horizon' && seeded.livraison_prevue === 'T4 2026',
    'fillProgramHeaderIfEmpty : en-tête vide rempli depuis le document');
  const pNom = { ...blankProgram(), nom: 'Déjà saisi', ville: '' };
  const keep = fillProgramHeaderIfEmpty(pNom, { nom: 'Ecrase ?', ville: 'Ollioules' });
  assert(keep.nom === 'Déjà saisi',                   'fillProgramHeaderIfEmpty : valeur déjà saisie JAMAIS écrasée');
  assert(keep.ville === 'Ollioules',                  'fillProgramHeaderIfEmpty : champ vide bien complété');
  assert(fillProgramHeaderIfEmpty({ ...blankProgram(), nom: 'Z' }, { nom: '' }).nom === 'Z',
    'fillProgramHeaderIfEmpty : header vide ne blanchit pas l\'existant');
  assert(fillProgramHeaderIfEmpty(null, {}).lots.length === 1,
    'fillProgramHeaderIfEmpty : retourne une forme coercée sûre');

  // ── D. upsertLot : insert / maj dédupliquée, fusion douce ──
  const r1 = upsertLot(blankProgram(), vefaDocToLot(contrat));
  assert(r1.action === 'added' && r1.index === 0 && r1.program.lots.length === 1,
    'upsertLot : 1er lot remplace le placeholder (pas d\'empilement)');
  assert(r1.program.lots[0].reference === 'Maison A', 'upsertLot : lot inséré correctement');
  const r2 = upsertLot(r1.program, vefaDocToLot({ ...contrat, lot_numero: 'Maison B', prix_ttc: '459000' }));
  assert(r2.action === 'added' && r2.index === 1 && r2.program.lots.length === 2,
    'upsertLot : 2e référence distincte → ajoutée en fin');
  const r3 = upsertLot(r2.program, vefaDocToLot({ ...contrat, prix_ttc: '399000' }));
  assert(r3.action === 'updated' && r3.index === 0 && r3.program.lots.length === 2,
    'upsertLot : même référence → mise à jour (pas de doublon)');
  assert(r3.program.lots[0].prix_ttc === '399000',    'upsertLot : champ document rafraîchi à la maj');
  const r5 = upsertLot(r1.program, vefaDocToLot({ ...contrat, lot_numero: '  MAISON A  ' }));
  assert(r5.action === 'updated' && r5.program.lots.length === 1,
    'upsertLot : dédup insensible casse/espaces');

  // Fusion douce : les champs Concierge saisis à la main survivent à la maj.
  const manual = coerceProgram(r2.program);
  manual.lots[0].nb_chambres  = '3';
  manual.lots[0].prestations  = ['Cuisine équipée'];
  manual.lots[0].garage       = true;
  const r4 = upsertLot(manual, vefaDocToLot({ ...contrat, surface: '95' }));
  assert(r4.action === 'updated',                     'upsertLot : maj du lot complété à la main');
  assert(r4.program.lots[0].nb_chambres === '3' && r4.program.lots[0].garage === true
      && r4.program.lots[0].prestations[0] === 'Cuisine équipée',
    'upsertLot : champs Concierge saisis à la main PRÉSERVÉS à la maj');
  assert(r4.program.lots[0].surface_habitable_m2 === '95',
    'upsertLot : champ document écrasé par la nouvelle valeur (le doc fait foi)');

  // Non-destructif sur l'entrée.
  const src  = blankProgram(); src.nom = 'SRC';
  const snap = JSON.stringify(src);
  upsertLot(src, vefaDocToLot(contrat));
  assert(JSON.stringify(src) === snap,                'upsertLot : programme d\'entrée non muté');

  // ── E. Round-trip pont → moteur (preuve cross-module) ──
  let prog = fillProgramHeaderIfEmpty(blankProgram(), hdr);
  prog.agence.nom = 'Agence Horizon';
  prog = upsertLot(prog, vefaDocToLot(contrat)).program;
  prog = upsertLot(prog, vefaDocToLot({ ...contrat, lot_numero: 'Maison B', prix_ttc: '459000', surface: '105' })).program;
  const vb = vefaProgramToBlock(prog);
  assert(validateBlock(vb).length === 0,              'round-trip pont : bloc produit valide (0 erreur)');
  assert(vb.configurations.length === 2,              'round-trip pont : 2 lots pontés → 2 configurations');
  assert(vb.configurations[0].reference === 'Maison A' && vb.configurations[0].prix_ttc === 389000
      && vb.configurations[0].surface_habitable_m2 === 92,
    'round-trip pont : lot A nombres exacts (string DOM → number moteur)');
  assert(vb.configurations[1].prix_ttc === 459000 && vb.configurations[1].surface_habitable_m2 === 105,
    'round-trip pont : lot B nombres exacts');
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Smart QR Templates — tests V1 + V4                      ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);

  await testBackend();
  await testFrontend();
  await testSharedHelpers();
  await testSymmetry();
  await testConcierge();
  await testConciergeEditor();
  await testConciergeSchema();
  await testConciergeProgram();
  await testConciergeS7();
  await testConciergeKeyform();
  await testConciergeS8();
  await testConciergeBridge();

  console.log(`\n${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`  ${C.green}✓ ${passCount} PASS${C.reset}    ${failCount ? `${C.red}✗ ${failCount} FAIL${C.reset}` : `${C.dim}✗ 0 FAIL${C.reset}`}`);
  if (fails.length) {
    console.log(`\n${C.red}${C.bold}Échecs :${C.reset}`);
    fails.forEach(f => console.log(`  ${C.red}• ${f}${C.reset}`));
  }
  console.log('');
  process.exit(failCount > 0 ? 1 : 0);
})().catch(e => {
  console.error(`${C.red}${C.bold}Erreur fatale : ${C.reset}${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
