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

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Smart QR Templates — tests V1 + V4                      ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);

  await testBackend();
  await testFrontend();
  await testSharedHelpers();
  await testSymmetry();

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
