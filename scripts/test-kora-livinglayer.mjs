#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test action Kora × Living Layer (ll.whats_new, K-13)

   Living Layer = « pas un pad » (KORA_BRIEF §15.2), la surface ambiante :
   UNE action GLOBALE « quoi de neuf ? ». Elle réutilise l'endpoint existant
   POST /api/livinglayer/board (qui calcule la synthèse ET résout le piège
   tenant en interne) et bâtit une réponse conversationnelle. Ce harnais
   teste, SANS réseau ni JWT (fetch + localStorage mockés) :

     - À AGIR : seuls les signaux NON NULS remontent (sites down, publis à
       reprendre, trous, rappels, réponses Key Form, bac/retards desK,
       bouclage imminent ≤ 3 j) ; un bouclage lointain (> 3 j) est exclu ;
     - ALERTE : dérivée de metrics (sitesDown / socialFailed24h), jamais
       du texte ; null quand rien n'est cassé ;
     - POULS : chiffres d'ambiance + QR/site suivi (noms = les siens, OK) ;
     - CALME : tout à zéro → rien_a_signaler + message ;
     - GARDE-FOU PII : le champ `text` du board (qui peut porter des noms de
       contacts networK / texte libre) NE REMONTE JAMAIS au modèle ;
     - REQUÊTE : preferMode:'calculator' (zéro LLM board), aucun BYOK, et
       les clientSensors followedQr/followedSite tirés du localStorage ;
     - GLOBALE : livinglayer est global:true (hors des 12 domaines routables).

   Usage : node scripts/test-kora-livinglayer.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

const LS = {
  ks_jwt: 'jwt-de-test',
  ks_sdqr_followed:    JSON.stringify({ id: 'qr123', name: 'Menu terrasse' }),
  ks_sentinel_followed: JSON.stringify({ id: 'site9', name: 'monsite.fr' }),
};
globalThis.localStorage = { getItem: (k) => (k in LS ? LS[k] : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = {};

/* metrics « quelques signaux » + un `text` porteur de PII tierce (networK). */
const METRICS_SIGNALS = {
  scans24h: 12, scansPrev24h: 8, scans7d: 63, scansTotal: 840,
  keyform24h: 3, formsPublished: 2,
  ghostUsed: 5, ghostQuota: 50,
  gapsOpen: 4, remindersToday: 1,
  sitesDown: 1, sitesTotal: 6,
  socialFailed24h: 2, codexBriefs: 9,
  agentKnowledge: 42, keynapseNotes: 130, socialConnected: 3,
  keybrandCharts: 2, keybrandPublished: 1,
  followedQr: { name: 'Menu terrasse', scans7d: 21, trend: 4, daily7: [1, 3, 2, 4, 3, 4, 4] },
  followedSite: { name: 'monsite.fr', ok: 0, lastMs: 320, lastCheckedAt: '2026-07-21 10:00:00' },
  deskInbox: 2, deskOverdue: 1, deskOverdueNum: '42',
  deskBouclageDays: 2, deskBouclageNum: '42', deskIssuesLive: 1,
};
const BOARD_SIGNALS = {
  mode: 'alert', icon: 'alert-triangle', sticky: true, ttl: 45,
  text: "Aujourd'hui, c'est l'anniversaire de Jean Dupont — pense à le recontacter.",
  metrics: METRICS_SIGNALS,
};

/* metrics « tout calme » : zéros / absences. */
const BOARD_CALM = {
  mode: 'calculator', icon: 'bar-chart', ttl: 90,
  text: 'Rendez-vous demain pour de nouveaux chiffres.',
  metrics: {
    scans24h: 0, scans7d: 0, scansTotal: 0,
    keyform24h: 0, formsPublished: 0,
    ghostUsed: 0, ghostQuota: 0,
    gapsOpen: 0, remindersToday: 0,
    sitesDown: 0, sitesTotal: 0,
    socialFailed24h: 0,
    followedQr: null, followedSite: null,
    deskInbox: 0, deskOverdue: 0, deskBouclageDays: null,
  },
};

/* metrics « bouclage lointain » (> 3 j) : ne doit PAS entrer dans à agir. */
const BOARD_FARBOUCLAGE = {
  mode: 'calculator', metrics: {
    sitesDown: 0, sitesTotal: 3, socialFailed24h: 0, gapsOpen: 0, remindersToday: 0,
    keyform24h: 0, deskInbox: 0, deskOverdue: 0, deskBouclageDays: 10, scans7d: 5,
  },
};

let boardResponse = BOARD_SIGNALS;
let lastBody = null, lastUrl = null, lastMethod = null;
globalThis.fetch = async (url, opts = {}) => {
  lastUrl = String(url); lastMethod = (opts.method || 'GET').toUpperCase();
  try { lastBody = opts.body ? JSON.parse(opts.body) : null; } catch (e) { lastBody = null; }
  return { ok: true, status: 200, json: async () => boardResponse };
};

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — À AGIR (seuls les signaux non nuls)\x1b[0m');
{
  boardResponse = BOARD_SIGNALS;
  const r = await runKoraAction('ll.whats_new', {});
  check('ok', r.ok);
  const j = JSON.stringify(r.data.a_agir);
  check('site hors ligne', /1 site\(s\) hors ligne/.test(j));
  check('publications à reprendre', /2 publication\(s\) à reprendre/.test(j));
  check('trous de savoir', /4 trou\(s\) de savoir/.test(j));
  check('rappels Keynapse', /1 rappel\(s\) Keynapse/.test(j));
  check('réponses Key Form', /3 nouvelle\(s\) réponse\(s\) Key Form/.test(j));
  check('bac desK', /2 contribution\(s\) dans le bac desK/.test(j));
  check('copies en retard desK', /1 copie\(s\) desK en retard/.test(j));
  check('bouclage imminent (2 j ≤ 3)', /bouclage desK dans 2 jour/.test(j));
  check('8 items à agir au total', r.data.a_agir.length === 8);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — ALERTE (dérivée de metrics, jamais du texte)\x1b[0m');
{
  boardResponse = BOARD_SIGNALS;
  const r = await runKoraAction('ll.whats_new', {});
  check('sitesDown>0 → alerte sur le site', /1 site\(s\) hors ligne — à vérifier/.test(r.data.alerte || ''));

  boardResponse = { metrics: { ...METRICS_SIGNALS, sitesDown: 0 } };  // plus de site down → social prend le relais
  const r2 = await runKoraAction('ll.whats_new', {});
  check('sitesDown=0 mais socialFailed>0 → alerte sur les publications', /2 publication\(s\) non aboutie\(s\)/.test(r2.data.alerte || ''));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — POULS (chiffres + QR/site suivi = les siens)\x1b[0m');
{
  boardResponse = BOARD_SIGNALS;
  const r = await runKoraAction('ll.whats_new', {});
  const p = r.data.pouls;
  check('sites en ligne 5/6', p.sites_en_ligne === '5/6');
  check('scans QR 7j', p.scans_qr_7j === 63);
  check('formulaires publiés', p.formulaires_publies === 2);
  check('réseaux connectés', p.reseaux_connectes === 3);
  check('écriture IA used/quota', p.ecriture_ia === '5/50');
  check('QR suivi (nom + scans)', p.qr_suivi && p.qr_suivi.nom === 'Menu terrasse' && p.qr_suivi.scans_7j === 21);
  check('site suivi (nom + hors ligne)', p.site_suivi && p.site_suivi.nom === 'monsite.fr' && p.site_suivi.en_ligne === false);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — CALME (tout à zéro → message)\x1b[0m');
{
  boardResponse = BOARD_CALM;
  const r = await runKoraAction('ll.whats_new', {});
  check('rien_a_signaler = true', r.ok && r.data.rien_a_signaler === true);
  check('à agir vide, alerte null', r.data.a_agir.length === 0 && r.data.alerte === null);
  check('message « tout est calme »', /calme/i.test(r.data.message || ''));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — bouclage lointain (> 3 j) exclu de à agir\x1b[0m');
{
  boardResponse = BOARD_FARBOUCLAGE;
  const r = await runKoraAction('ll.whats_new', {});
  check('bouclage à 10 j → PAS dans à agir', !/bouclage/.test(JSON.stringify(r.data.a_agir)));
  check('rien à agir, mais pouls présent (scans)', r.data.a_agir.length === 0 && r.data.pouls.scans_qr_7j === 5);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — GARDE-FOU PII : le champ `text` ne remonte JAMAIS\x1b[0m');
{
  boardResponse = BOARD_SIGNALS;   // text contient « Jean Dupont » (contact networK)
  const r = await runKoraAction('ll.whats_new', {});
  const dump = JSON.stringify(r.data);
  check('aucun nom de contact tiers (Jean Dupont)', !/Jean Dupont/.test(dump));
  check('aucun fragment du texte networK (anniversaire/recontacter)', !/anniversaire|recontacter/.test(dump));
  check('aucune clé « text » relayée', !/"text"/.test(dump));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — REQUÊTE (calculator, zéro BYOK, clientSensors du localStorage)\x1b[0m');
{
  boardResponse = BOARD_SIGNALS;
  await runKoraAction('ll.whats_new', {});
  check('POST /api/livinglayer/board', lastMethod === 'POST' && /\/api\/livinglayer\/board$/.test(lastUrl));
  check('preferMode = calculator (chemin déterministe, zéro LLM board)', lastBody && lastBody.preferMode === 'calculator');
  check('aucune clé BYOK envoyée (apiKey/engine)', lastBody && !('apiKey' in lastBody) && !('engine' in lastBody));
  check('clientSensors.followedQr tiré du localStorage', lastBody && lastBody.clientSensors && lastBody.clientSensors.followedQr === 'qr123');
  check('clientSensors.followedSite tiré du localStorage', lastBody && lastBody.clientSensors && lastBody.clientSensors.followedSite === 'site9');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — catalogue : ll.whats_new est une GLOBALE lecture\x1b[0m');
{
  const a = KORA_ACTIONS.find(x => x.id === 'll.whats_new');
  check('action présente', !!a);
  check('mode:read (lecture)', a.mode === 'read');
  check('pad livinglayer', a.pad === 'livinglayer');
  check('target #ks-living (anneau sur la barre)', a.target === '#ks-living');
  check('desc ≤ 240 car.', a.desc.length <= 240);
  check('aucun param requis (appelable telle quelle)', (a.params || []).every(p => !p.required));
  const meta = KORA_PAD_META.find(p => p.pad === 'livinglayer');
  check('KORA_PAD_META : livinglayer global:true', meta && meta.global === true);
  check('les 3 globaux = chaine, livinglayer, os', KORA_PAD_META.filter(p => p.global).map(p => p.pad).sort().join(',') === 'chaine,livinglayer,os');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 9 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js', 'workers/src/routes/living-layer-board.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
