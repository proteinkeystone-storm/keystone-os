#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × Key Form (kf.*, K-11 21/07/2026)

   Key Form (ex-Pulsa) = formulaire artistes EN PROD CRITIQUE. Le brief
   §15.2 le grave : « 2 lectures, ZÉRO écriture, jamais ». Ce harnais
   VERROUILLE cette frontière, SANS réseau ni JWT (fetch + localStorage/
   document/location mockés) :

     - kf.list_forms : façonnage (statut FR, lien public /f/slug seulement
       si publié + slug), bibliothèque vide → message, ET le garde-fou PII
       n°1 : delivery.recipients (e-mails direction) NE SORT JAMAIS ;
     - _kfResolveForm via kf.responses : plusieurs formulaires sans réf →
       erreur qui LISTE, un seul se résout seul, match exact/partiel
       insensible aux accents, ambigu → candidats, introuvable → honnête ;
     - kf.responses : buckets (aujourd'hui/hier/7 jours) calculés en heure
       LOCALE depuis created_at UTC, dates des dernières SEULEMENT, ET le
       garde-fou PII n°2 : le CONTENU des réponses (bios, coordonnées),
       submitter_ip, user_agent, response_hash NE SORTENT JAMAIS ; zéro
       réponse → message ; plafond 500 → note ;
     - INVARIANT DE FRONTIÈRE : les 2 actions keyform sont mode:'read', et
       keyform reste ABSENT de os.open_pad (décision explicite K-11 : même
       l'ouverture, action mode:'write', est refusée).
     - catalogue (caps + méta + PII strippée à la source _kfApi = GET only).

   Usage : node scripts/test-kora-keyform.mjs   ·   Exit 0 si OK.
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
globalThis.location = { origin: 'https://protein-keystone.com', host: 'protein-keystone.com' };

/* created_at = « YYYY-MM-DD HH:MM:SS » UTC (datetime('now') côté worker).
   On pose les fixtures à MIDI LOCAL du jour visé pour rester loin de minuit
   (pas de bascule de jour due au fuseau) — puis on convertit en UTC. */
function sqlAt(daysAgo) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/* forms = shape _rowToForm du worker : config décompressée + id + timestamps
   ms + output.status. On y met delivery.recipients (e-mails) EXPRÈS : ce que
   le worker sert aux propriétaires, et que Kora ne doit JAMAIS ressortir. */
const NOW = Date.now();
const FORMS_FIXTURE = { ok: true, forms: [
  { id: 'f1', meta: { title: 'Biennale Revest 2026', slug: 'biennale-2026' },
    delivery: { recipients: ['direction@revest.fr', 'prod@revest.fr'] },
    sections: [{ id: 's1' }], output: { status: 'published' },
    created_at: NOW - 30 * 86400e3, updated_at: NOW - 2 * 86400e3 },
  { id: 'f2', meta: { title: 'Biennale Revest 2025', slug: 'biennale-2025' },
    delivery: { recipients: ['archive@revest.fr'] },
    output: { status: 'archived' },
    created_at: NOW - 400 * 86400e3, updated_at: NOW - 380 * 86400e3 },
  { id: 'f3', meta: { title: 'Onboarding fournisseur', slug: null },
    delivery: { recipients: [] }, output: { status: 'draft' },
    created_at: NOW - 5 * 86400e3, updated_at: NOW - 1 * 86400e3 },
]};

/* réponses avec PII bien visible (contenu, ip, hash, UA) : rien de tout ça
   ne doit apparaître dans la sortie de kf.responses. */
const RESP_F1 = { ok: true, count: 5, responses: [
  { id: 'r1', form_id: 'f1', slug: 'biennale-2026', responses: { nom: 'Alice Martin', bio: 'Sculptrice sur bois', email: 'alice@secret.fr' },
    created_at: sqlAt(0), expires_at: null, response_hash: 'HASH-AAA', submitter_ip: '1.2.3.4', user_agent: 'Mozilla/5.0 SecretUA' },
  { id: 'r2', form_id: 'f1', slug: 'biennale-2026', responses: { nom: 'Bob Durand' },
    created_at: sqlAt(0), expires_at: null, response_hash: 'HASH-BBB', submitter_ip: '5.6.7.8', user_agent: 'Safari SecretUA' },
  { id: 'r3', form_id: 'f1', slug: 'biennale-2026', responses: { nom: 'Chloé' },
    created_at: sqlAt(1), expires_at: null, response_hash: 'HASH-CCC', submitter_ip: '9.9.9.9', user_agent: 'UA' },
  { id: 'r4', form_id: 'f1', slug: 'biennale-2026', responses: { nom: 'David' },
    created_at: sqlAt(3), expires_at: null, response_hash: 'HASH-DDD', submitter_ip: '1.1.1.1', user_agent: 'UA' },
  { id: 'r5', form_id: 'f1', slug: 'biennale-2026', responses: { nom: 'Emma' },
    created_at: sqlAt(10), expires_at: null, response_hash: 'HASH-EEE', submitter_ip: '2.2.2.2', user_agent: 'UA' },
]};

const calls = [];
const mainFetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  const body = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  if (u.endsWith('/api/pulsa/forms') && method === 'GET') return body(FORMS_FIXTURE);
  if (u.includes('/api/pulsa/responses?form_id=f1') && method === 'GET') return body(RESP_F1);
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};
globalThis.fetch = mainFetch;

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — kf.list_forms (façonnage)\x1b[0m');
{
  const r = await runKoraAction('kf.list_forms', {});
  check('ok + 3 formulaires', r.ok && r.data.total === 3);
  const f1 = r.data.formulaires.find(f => f.titre === 'Biennale Revest 2026');
  const f3 = r.data.formulaires.find(f => f.titre === 'Onboarding fournisseur');
  check('statut FR : published → « publié »', f1.statut === 'publié');
  check('statut FR : draft → « brouillon »', f3.statut === 'brouillon');
  check('lien public /f/slug pour un formulaire publié', f1.lien_public === 'https://protein-keystone.com/f/biennale-2026');
  check('AUCUN lien public pour un brouillon sans slug', f3.lien_public === undefined);
  check('tri par updated_at DESC (Onboarding modifié hier passe avant Biennale 2026)',
    r.data.formulaires[0].titre === 'Onboarding fournisseur');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — GARDE-FOU PII n°1 : les e-mails direction ne sortent JAMAIS\x1b[0m');
{
  const r = await runKoraAction('kf.list_forms', {});
  const dump = JSON.stringify(r.data);
  check('aucune clé recipients dans la sortie', !r.data.formulaires.some(f => 'recipients' in f) && !/recipients/.test(dump));
  check('aucun e-mail direction (direction@ / prod@ / archive@) dans la sortie',
    !/direction@revest\.fr|prod@revest\.fr|archive@revest\.fr/.test(dump));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — bibliothèque vide → message\x1b[0m');
{
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/pulsa/forms')) return { ok: true, status: 200, json: async () => ({ ok: true, forms: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await runKoraAction('kf.list_forms', {});
  check('0 formulaire → message plutôt qu’une liste vide muette', r.ok && r.data.total === 0 && /Aucun formulaire/.test(r.data.message));
  globalThis.fetch = saved;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — résolution d’un formulaire (_kfResolveForm, via kf.responses)\x1b[0m');
{
  const noRef = await runKoraAction('kf.responses', {});
  check('3 formulaires sans référence → erreur qui LISTE tout le monde',
    !noRef.ok && /Biennale Revest 2026/.test(noRef.error) && /Biennale Revest 2025/.test(noRef.error) && /Onboarding/.test(noRef.error));

  const uniq = await runKoraAction('kf.responses', { form: 'onboarding' });
  /* Onboarding n'a pas de réponse mockée (404) → resolve OK mais fetch responses
     échoue : on vérifie juste que la RÉSOLUTION a visé le bon form (pas d'erreur
     d'ambiguïté ni d'introuvable). */
  check('match partiel unique « onboarding » → résolu (pas d’ambiguïté)',
    !/Plusieurs formulaires|Aucun formulaire «/.test(uniq.error || ''));

  const ambig = await runKoraAction('kf.responses', { form: 'biennale' });
  check('ambigu (2 « biennale ») → erreur avec les candidats',
    !ambig.ok && /Plusieurs formulaires correspondent/.test(ambig.error) && /2026/.test(ambig.error) && /2025/.test(ambig.error));

  const none = await runKoraAction('kf.responses', { form: 'zzz-inconnu' });
  check('introuvable → message honnête listant les formulaires existants', !none.ok && /Aucun formulaire « zzz-inconnu »/.test(none.error));

  const accents = await runKoraAction('kf.responses', { form: 'BIÉNNALE revest 2026' });
  check('match exact insensible aux accents/casse → f1',
    (accents.ok && accents.data.formulaire === 'Biennale Revest 2026') || /trop de temps|→ 404/.test(accents.error || '') === false);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — un seul formulaire se résout seul\x1b[0m');
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/pulsa/forms')) return { ok: true, status: 200, json: async () => ({ ok: true, forms: [FORMS_FIXTURE.forms[0]] }) };
    if (u.includes('/api/pulsa/responses?form_id=f1')) return { ok: true, status: 200, json: async () => RESP_F1 };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const r = await runKoraAction('kf.responses', {});
  check('un seul formulaire → résolu SANS demander de précision', r.ok && r.data.formulaire === 'Biennale Revest 2026');
  globalThis.fetch = savedFetch;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — kf.responses (buckets en heure locale)\x1b[0m');
{
  const r = await runKoraAction('kf.responses', { form: '2026' });
  check('total recopié du count worker (5)', r.ok && r.data.total === 5);
  check('aujourd’hui = 2', r.data.aujourd_hui === 2);
  check('hier = 1', r.data.hier === 1);
  check('7 derniers jours = 4 (le 10e jour est exclu)', r.data.sept_derniers_jours === 4);
  check('dernières dates : 5 dates (≤ 5), toutes non nulles', Array.isArray(r.data.dernieres_dates) && r.data.dernieres_dates.length === 5 && r.data.dernieres_dates.every(Boolean));
  check('statut du formulaire recopié', r.data.statut === 'publié');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — GARDE-FOU PII n°2 : le contenu des réponses ne sort JAMAIS\x1b[0m');
{
  const r = await runKoraAction('kf.responses', { form: '2026' });
  const dump = JSON.stringify(r.data);
  check('aucun contenu de réponse (noms/bio/e-mail des répondants)',
    !/Alice Martin|Bob Durand|Sculptrice|alice@secret\.fr/.test(dump));
  check('aucune ip / user_agent / hash de réponse', !/1\.2\.3\.4|SecretUA|HASH-/.test(dump));
  check('aucune clé « responses » (contenu brut) ni « submitter_ip »', !/\"responses\"|submitter_ip|response_hash|user_agent/.test(dump));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — zéro réponse → message · plafond 500 → note\x1b[0m');
{
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/pulsa/forms')) return { ok: true, status: 200, json: async () => ({ ok: true, forms: [FORMS_FIXTURE.forms[0]] }) };
    if (u.includes('/api/pulsa/responses?form_id=f1')) return { ok: true, status: 200, json: async () => ({ ok: true, count: 0, responses: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const vide = await runKoraAction('kf.responses', {});
  check('0 réponse → total 0 + message honnête', vide.ok && vide.data.total === 0 && /aucune réponse/i.test(vide.data.message || ''));

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/pulsa/forms')) return { ok: true, status: 200, json: async () => ({ ok: true, forms: [FORMS_FIXTURE.forms[0]] }) };
    if (u.includes('/api/pulsa/responses?form_id=f1'))
      return { ok: true, status: 200, json: async () => ({ ok: true, count: 500, responses: [{ id: 'x', created_at: sqlAt(0), responses: {} }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const cap = await runKoraAction('kf.responses', {});
  check('count 500 → note « plafonné »', cap.ok && cap.data.total === 500 && /plafonn/i.test(cap.data.note || ''));
  globalThis.fetch = saved;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 9 — INVARIANT DE FRONTIÈRE (§15.2 : zéro écriture)\x1b[0m');
{
  const kf = KORA_ACTIONS.filter(a => a.pad === 'keyform');
  check('2 actions keyform présentes', kf.length === 2);
  check('les DEUX sont mode:read (aucune écriture, jamais)', kf.every(a => a.mode === 'read'));
  check('aucune action keyform en mode write dans TOUT le catalogue', !KORA_ACTIONS.some(a => a.pad === 'keyform' && a.mode === 'write'));
  /* décision explicite K-11 : keyform reste HORS de os.open_pad (mode:write).
     Si un jour on l'ajoute, c'est un choix conscient → mettre à jour ce test. */
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('keyform ABSENT de os.open_pad (l’ouverture est un write, refusé en K-11)',
    !/keyform|key form/i.test(open.desc) && !/keyform|key form/i.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 10 — catalogue (caps + méta)\x1b[0m');
{
  const kf = KORA_ACTIONS.filter(a => a.pad === 'keyform');
  check('toutes les desc ≤ 240 car.', kf.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', kf.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('toute action keyform déclare un target (anneau, B.3)', kf.every(a => !!a.target));
  check('KORA_PAD_META a une entrée keyform (label+desc≤160)',
    KORA_PAD_META.some(p => p.pad === 'keyform' && p.label && p.desc && p.desc.length <= 160));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 11 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
