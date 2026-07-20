#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × networK (nk.*, K-14 21/07/2026)

   networK (pad O-NET-001, EN PROD) = réseau relationnel anti-CRM. §15.2 :
   le killer conversationnel = « qui recontacter » (relance_at stocké). Trois
   LECTURES, toutes via un seul GET /api/network/bootstrap. Ce harnais teste,
   SANS réseau ni JWT (fetch + localStorage mockés) :

     - nk.network_overview : total, répartition par catégorie (triée), nombre
       de relances dues ; réseau vide → message ; PII : AUCUNE coordonnée ;
     - nk.relances_dues (LE KILLER) : filtre relance_at <= aujourd'hui (dues +
       en retard), tri par date, drapeau en_retard, compteur à venir 7 j,
       motif ; aucune due → message ; PII : nom + date + motif, PAS de
       coordonnées ;
     - nk.contact : résolution par nom (exact/partiel/accents/ambigu/absent),
       fiche (coordonnées LÉGITIMES car ciblées, roles/tags parsés du JSON,
       relance, dernière interaction + journal dérivés de l'activité), et
       garde-fou sobriété : `notes` (champ libre) borné à un extrait ;
     - catalogue (3 lectures, méta, os.open_pad).

   Usage : node scripts/test-kora-network.mjs   ·   Exit 0 si OK.
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

globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = {};

/* date « YYYY-MM-DD » à +/- N jours (relance_at) ; « YYYY-MM-DD HH:MM:SS » pour l'activité */
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sqlDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d.toISOString().slice(0, 19).replace('T', ' '); };

/* notes longues avec un marqueur sensible APRÈS 200 car. → doit être coupé */
const NOTES_C1 = 'A'.repeat(240) + ' SECRET_CONFIDENTIEL_NE_PAS_DEBALLER';

const BOOTSTRAP = {
  ok: true, engine: 'NK-7',
  categories: [
    { id: 'cat1', label: 'Clients', icon: 'users', position: 0 },
    { id: 'cat2', label: 'Fournisseurs', icon: 'truck', position: 1 },
  ],
  contacts: [
    { id: 'c1', category_id: 'cat1', kind: 'person', name: 'Camille Leroy', company: 'Galerie Leroy', title: 'Directrice',
      email: 'camille@galerie-leroy.fr', phone: '0601020304', website: 'galerie-leroy.fr',
      roles: '["client"]', tags: '["VIP","biennale"]', notes: NOTES_C1,
      relance_at: iso(-3), relance_note: 'Relancer sur le devis Biennale', created_at: '2026-01-01 10:00:00' },
    { id: 'c2', category_id: 'cat2', kind: 'person', name: 'Jean Martin', company: 'Imprimerie Martin', title: null,
      email: 'jean@impri-martin.fr', phone: '0605060708', roles: '[]', tags: '[]', notes: '',
      relance_at: iso(0), relance_note: 'Appeler pour le tirage', created_at: '2026-02-01 10:00:00' },
    { id: 'c3', category_id: 'cat1', kind: 'company', name: 'Studio Alpha', company: null, title: null,
      email: null, phone: null, roles: '[]', tags: '[]', notes: '',
      relance_at: iso(5), relance_note: 'Point projet', created_at: '2026-03-01 10:00:00' },
    { id: 'c4', category_id: 'cat2', kind: 'person', name: 'Bob Durand', company: null, title: null,
      email: null, phone: null, roles: '[]', tags: '[]', notes: '', relance_at: null, relance_note: null, created_at: '2026-03-05 10:00:00' },
    { id: 'c5', category_id: 'cat1', kind: 'person', name: 'Camille Bernard', company: null, title: null,
      email: null, phone: null, roles: '[]', tags: '[]', notes: '', relance_at: null, relance_note: null, created_at: '2026-03-06 10:00:00' },
  ],
  activity: [
    { id: 'a1', contact_id: 'c1', type: 'call',  label: 'Appelé pour le devis Biennale', source: 'manual', happened_at: sqlDaysAgo(2) },
    { id: 'a2', contact_id: 'c1', type: 'email', label: 'Envoyé la proposition chiffrée', source: 'manual', happened_at: sqlDaysAgo(12) },
    { id: 'a3', contact_id: 'c2', type: 'meeting', label: 'RDV café centre-ville', source: 'manual', happened_at: sqlDaysAgo(1) },
  ],
};

let bootstrap = BOOTSTRAP;
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  if (u.endsWith('/api/network/bootstrap') && method === 'GET')
    return { ok: true, status: 200, json: async () => bootstrap };
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — nk.network_overview\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  const r = await runKoraAction('nk.network_overview', {});
  check('ok + 5 contacts', r.ok && r.data.total === 5);
  const clients = r.data.par_categorie.find(x => x.categorie === 'Clients');
  const fourn = r.data.par_categorie.find(x => x.categorie === 'Fournisseurs');
  check('Clients = 3 (c1,c3,c5)', clients && clients.contacts === 3);
  check('Fournisseurs = 2 (c2,c4)', fourn && fourn.contacts === 2);
  check('tri par catégorie décroissant (Clients en tête)', r.data.par_categorie[0].categorie === 'Clients');
  check('relances dues = 2 (c1 en retard + c2 aujourd’hui)', r.data.relances_dues === 2);
  check('PII : aucune coordonnée dans le survol', !/@|0601|0605|website|email/.test(JSON.stringify(r.data)));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — réseau vide → message\x1b[0m');
{
  bootstrap = { ok: true, categories: [], contacts: [], activity: [] };
  const r = await runKoraAction('nk.network_overview', {});
  check('0 contact → message', r.ok && r.data.total === 0 && /vide/i.test(r.data.message));
  bootstrap = BOOTSTRAP;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — nk.relances_dues (LE KILLER)\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  const r = await runKoraAction('nk.relances_dues', {});
  check('2 relances dues', r.ok && r.data.total_dues === 2);
  check('1 à venir dans 7 j (c3 à +5)', r.data.a_venir_7j === 1);
  check('triées par date : Camille Leroy (−3) avant Jean Martin (0)',
    r.data.a_relancer[0].nom === 'Camille Leroy' && r.data.a_relancer[1].nom === 'Jean Martin');
  check('en retard : c1 oui, c2 (aujourd’hui) non', r.data.a_relancer[0].en_retard === true && r.data.a_relancer[1].en_retard === false);
  check('motif recopié', /devis Biennale/.test(r.data.a_relancer[0].motif));
  check('PII : nom+date+motif seulement, AUCUNE coordonnée', !/@|0601|0605|galerie-leroy|phone|email/.test(JSON.stringify(r.data)));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — aucune relance due → message\x1b[0m');
{
  bootstrap = { ok: true, categories: [], contacts: [
    { id: 'x', name: 'Zoé', category_id: null, roles: '[]', tags: '[]', relance_at: iso(4), relance_note: 'plus tard' },
  ], activity: [] };
  const r = await runKoraAction('nk.relances_dues', {});
  check('0 due mais 1 à venir → message chiffré', r.ok && r.data.total_dues === 0 && r.data.a_venir_7j === 1 && /7 jours/.test(r.data.message));
  bootstrap = BOOTSTRAP;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — nk.contact : résolution par nom\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  const exact = await runKoraAction('nk.contact', { name: 'Camille Leroy' });
  check('match exact', exact.ok && exact.data.contact === 'Camille Leroy');

  const partial = await runKoraAction('nk.contact', { name: 'leroy' });
  check('match partiel unique', partial.ok && partial.data.contact === 'Camille Leroy');

  const accents = await runKoraAction('nk.contact', { name: 'camille leroy' });
  check('insensible casse/accents', accents.ok && accents.data.contact === 'Camille Leroy');

  const ambig = await runKoraAction('nk.contact', { name: 'camille' });
  check('ambigu (2 Camille) → erreur avec candidats', !ambig.ok && /Camille Leroy/.test(ambig.error) && /Camille Bernard/.test(ambig.error));

  const none = await runKoraAction('nk.contact', { name: 'zzz-inconnu' });
  check('introuvable → message honnête', !none.ok && /Aucun contact/.test(none.error));

  const noName = await runKoraAction('nk.contact', {});
  check('sans nom → demande lequel', !noName.ok && /Quel contact/.test(noName.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — nk.contact : façonnage de la fiche\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  const r = await runKoraAction('nk.contact', { name: 'Camille Leroy' });
  check('société + fonction + catégorie', r.data.societe === 'Galerie Leroy' && r.data.fonction === 'Directrice' && r.data.categorie === 'Clients');
  check('roles/tags parsés depuis JSON', Array.isArray(r.data.roles) && r.data.roles[0] === 'client' && r.data.tags.includes('VIP'));
  check('coordonnées présentes (fiche ciblée = légitime)', r.data.coordonnees.email === 'camille@galerie-leroy.fr' && r.data.coordonnees.telephone === '0601020304');
  check('relance présente (date + motif)', r.data.relance && /devis Biennale/.test(r.data.relance.motif));
  check('dernière interaction = la plus récente (a1, 2 j)', !!r.data.derniere_interaction);
  check('journal récent = 2 activités de c1 (pas celle de c2)', r.data.journal_recent.length === 2 && /devis Biennale/.test(r.data.journal_recent[0].quoi));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — GARDE-FOU PII : notes bornées, secret coupé\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  const r = await runKoraAction('nk.contact', { name: 'Camille Leroy' });
  check('notes présentes mais BORNÉES (≤ 200 car.)', typeof r.data.notes === 'string' && r.data.notes.length <= 200);
  check('le marqueur sensible au-delà de 200 est COUPÉ', !/SECRET_CONFIDENTIEL/.test(r.data.notes));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — un seul GET /bootstrap par action (pas de 2e appel)\x1b[0m');
{
  bootstrap = BOOTSTRAP;
  calls.length = 0;
  await runKoraAction('nk.contact', { name: 'Camille Leroy' });
  check('nk.contact = 1 seul appel réseau', calls.length === 1 && /\/api\/network\/bootstrap/.test(calls[0]));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 9 — catalogue (caps + méta + os.open_pad)\x1b[0m');
{
  const nk = KORA_ACTIONS.filter(a => a.pad === 'network');
  check('3 actions network', nk.length === 3);
  check('toutes lectures (V1 = lecture seule)', nk.every(a => a.mode === 'read'));
  check('toutes ≤ 240 car.', nk.every(a => (a.desc || '').length <= 240));
  check('desc de params ≤ 90 car.', nk.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('toute action network déclare un target', nk.every(a => !!a.target));
  check('KORA_PAD_META a une entrée network (label+desc≤160)',
    KORA_PAD_META.some(p => p.pad === 'network' && p.label && p.desc && p.desc.length <= 160));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne network', /network/.test(open.desc) && /network/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 10 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js', 'workers/src/routes/network.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
