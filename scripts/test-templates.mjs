#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Smart QR Templates — tests unitaires
   ─────────────────────────────────────────────────────────────
   Valide les 11 templates (1 V1 + 3 V2 + 7 V3) sans toucher à
   la prod. Chaque template doit :
     - renderHTML() : retourne un HTML > 500 bytes, structure complète,
       slot IA présent, CTA continuer présent
     - buildAiPrompt() : retourne {system, user} non vides
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
  short_id:     'MOCKABCD',
  name:         'QR Test',
  qr_type:      'url',
  mode:         'smart',
  metier_brief: 'Promoteur immo neuf à Toulon, spécialité VEFA.',
  payload:      { url: 'https://example.com' },
};
const MOCK_SCAN = {
  country:    'FR',
  device:     'mobile',
  target_url: 'https://example.com',
  qr_type:    'url',
};

const MOCK_DATA = {
  'phrase-simple':       {},
  'panneau-a-vendre':    { titre_bien: 'Villa T5 vue mer', prix: '890 000 €', surface: '180 m²', dpe: 'B', points_forts: 'Vue mer\nGarage' },
  'visite-virtuelle':    { titre_bien: 'Villa contemporaine', type_visite: 'Visite 3D', agence: 'Test Agency' },
  'demande-rappel':      { nom_agent: 'Stéphane Benedetti', agence: 'Protein Immo', tel_agent: '+33612345678', creneau_default: 'Lun-ven 9h-19h' },
  'menu-du-jour':        { nom_etablissement: 'Le Bistrot', specialite: 'Méditerranéenne', plats: 'Risotto cèpes — 22€\nLoup grillé — 32€', entrees: 'Tartare — 14€', desserts: 'Tarte fine — 9€' },
  'carte-vins':          { nom_etablissement: 'La Cave', type_carte: 'Carte des vins', selections: 'Bandol Tempier — Provence — 78€\nNégroni — — 14€' },
  'formule-midi':        { nom_etablissement: 'Le Bistrot', formule_titre: 'Express', prix: '19,90 €', horaires: '12h-14h30', composition: 'Entrée\nPlat\nDessert' },
  'evenement-special':   { nom_evenement: 'Soirée Truffe', date_evenement: 'Vendredi 12 juin', heure: '20h', theme: 'Menu 6 services', description: 'Chef invité', prix: '85€', places_restantes: '8' },
  'tournoi-bowling':     { nom_etablissement: 'Bowling Strike', nom_tournoi: 'Open Printemps', activite: 'Bowling', jackpot: '500 €', places_initiales: '32', joueurs_inscrits: '24', date_finale: 'Sam 15/06', prix_inscription: '25 €' },
  'anniversaire-enfant': { nom_etablissement: 'Bowling Strike', activite_principale: 'Pack Anniversaire', age_min: '6', age_max: '12', prix_par_enfant: '18 €', duree: '2h', inclus: 'Bowling\nGoûter', creneaux_dispo: 'Mer/Sam 14h-16h' },
  'happy-hour':          { nom_etablissement: 'Le Bar des Halles', heure_debut: '18:00', heure_fin: '20:00', jours: 'Lun-ven', offres: 'Pintes — 4€\nCocktails — 7€' },
};

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
    assert(typeof tpl.ai_max_tokens === 'number' && tpl.ai_max_tokens >= 1024,       `${tpl.id} : ai_max_tokens ≥ 1024`);
    assert(typeof tpl.validate === 'function',                                       `${tpl.id} : validate() existe`);
    assert(typeof tpl.buildAiPrompt === 'function',                                  `${tpl.id} : buildAiPrompt() existe`);
    assert(typeof tpl.renderHTML === 'function',                                     `${tpl.id} : renderHTML() existe`);

    // 2. buildAiPrompt
    const prompt = tpl.buildAiPrompt(qr, MOCK_SCAN);
    assert(prompt && typeof prompt === 'object',                                     `${tpl.id} : buildAiPrompt retourne objet`);
    assert(typeof prompt?.system === 'string' && prompt.system.length > 100,          `${tpl.id} : system > 100 chars`);
    assert(typeof prompt?.user === 'string' && prompt.user.length > 50,               `${tpl.id} : user > 50 chars`);
    assert(prompt?.system?.includes('JSON STRICT'),                                   `${tpl.id} : system demande JSON strict`);

    // 3. renderHTML
    const html = tpl.renderHTML(qr, MOCK_SCAN);
    assert(typeof html === 'string' && html.length > 500,                            `${tpl.id} : renderHTML > 500 bytes`);
    assert(html.includes('<!DOCTYPE html>'),                                         `${tpl.id} : HTML5 doctype`);
    assert(html.includes('</html>'),                                                  `${tpl.id} : HTML fermé`);
    assert(html.includes('viewport'),                                                 `${tpl.id} : viewport meta présent`);
    assert(html.includes('/r/MOCKABCD?direct=1'),                                    `${tpl.id} : CTA continuer (/r/SHORT?direct=1)`);
    assert(html.includes('sq-ia') || html.includes('sq-phrase'),                     `${tpl.id} : slot IA présent`);
    assert(html.includes('/api/smartqr/generate-interstitial'),                      `${tpl.id} : script fetch IA présent`);
    assert(html.includes('Keystone'),                                                 `${tpl.id} : branding Keystone`);

    // 4. validate (data vide → erreurs si required)
    const errsEmpty = tpl.validate({});
    assert(Array.isArray(errsEmpty),                                                  `${tpl.id} : validate({}) retourne array`);

    // 5. validate avec data complète → 0 erreurs
    const errsFull = tpl.validate(data);
    assert(Array.isArray(errsFull) && errsFull.length === 0,                          `${tpl.id} : validate(mock data) = 0 erreurs`);
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
      assert(typeof f.type === 'string' && ['text','textarea','select','url','tel','email','number','password','checkbox'].includes(f.type), `${tpl.id}.${f.id} : type valide (${f.type})`);
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

  // 5. canUseTemplate (tier gating)
  assert(canUseTemplate('phrase-simple', 'starter') === true,                       `gating : starter peut utiliser phrase-simple`);
  assert(canUseTemplate('panneau-a-vendre', 'starter') === false,                   `gating : starter ne peut PAS utiliser panneau-a-vendre (pro)`);
  assert(canUseTemplate('panneau-a-vendre', 'pro') === true,                        `gating : pro peut utiliser panneau-a-vendre`);
  assert(canUseTemplate('panneau-a-vendre', 'max') === true,                        `gating : max peut utiliser panneau-a-vendre`);
  assert(isKnownTemplate('menu-du-jour') === true,                                  `isKnownTemplate(menu-du-jour) = true`);
  assert(isKnownTemplate('inexistant-xyz') === false,                               `isKnownTemplate(inconnu) = false`);
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
  console.log(`${C.bold}${C.cyan}║   Smart QR Templates — tests V1 + V2 + V3                 ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);

  await testBackend();
  await testFrontend();
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
