#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × Keynapse (kn.*, 19/07/2026)

   Teste, SANS réseau ni JWT (fetch + localStorage/document mockés) :
     - _knResolve via kn.read_bubble : match exact/partiel insensible aux
       accents, référence vide → erreur (jamais de choix automatique,
       contrairement à Sentinel : une constellation a TOUJOURS plusieurs
       bulles), ambigu → candidats, introuvable → message honnête ;
     - kn.search : façonnage (zone jointe, extrait borné, plafond 8 +
       compteur), aucun résultat → message plutôt que liste vide ;
     - kn.list_reminders : retard calculé côté client (Date.parse vs now),
       répétition en français, plafond 10 ;
     - kn.read_bubble : todos faites/restantes, notes/media/audios comptés,
       rappels formatés ;
     - kn.open_bubble : résolution AVANT ouverture (erreur si titre inconnu,
       jamais un Keynapse vide ouvert pour rien) ;
     - kn.create_note : POST vers la bonne bulle, texte requis.

   Usage : node scripts/test-kora-keynapse.mjs   ·   Exit 0 si OK.
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

/* ── Mocks (module inerte : localStorage/document lus à l'exécution) ── */
globalThis.localStorage = { getItem: (k) => (k === 'ks_jwt' ? 'jwt-de-test' : null), setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const STATE_FIXTURE = {
  zones: [{ id: 'z1', name: 'Clients', color: '#6366f1' }],
  bubbles: [
    { id: 'b1', zone_id: 'z1', title: 'Salon de juin 2026', description: 'Stand E42, prévoir roll-up et flyers pour le salon.',
      color: null, icon: null, x: 10, y: 20, created_at: '2026-06-01 09:00:00', updated_at: '2026-06-15 14:30:00' },
    { id: 'b2', zone_id: null, title: 'Idée article été', description: 'Angle : comment Keystone simplifie la rentrée.',
      color: '#22c55e', icon: null, x: -5, y: 8, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { id: 'b3', zone_id: 'z1', title: 'Salon de septembre', description: '',
      color: null, icon: null, x: 0, y: 0, created_at: '2026-07-10 08:00:00', updated_at: '2026-07-10 08:00:00' },
  ],
  links: [],
};

const BUBBLE_B1_DETAIL = {
  bubble: STATE_FIXTURE.bubbles[0],
  todos: [
    { id: 't1', label: 'Réserver le stand', done: 1 },
    { id: 't2', label: 'Commander les flyers', done: 0 },
    { id: 't3', label: 'Prévenir l’équipe', done: 0 },
  ],
  notes: [{ id: 'n1', body: 'Contact organisateur : Marc, 06 xx xx xx xx.' }],
  links: [],
  media: [{ id: 'm1', kind: 'photo' }],
  audios: [{ id: 'a1', transcript: 'Mémo vocal sur le plan du stand' }],
  reminders: [{ id: 'r1', bubble_id: 'b1', label: 'Confirmer le stand', at: '2026-07-25T09:00:00.000Z', repeat: null }],
};

const BUBBLE_B2_DETAIL = {
  bubble: STATE_FIXTURE.bubbles[1],
  todos: [], notes: [], links: [], media: [], audios: [], reminders: [],
};

const REMINDERS_FIXTURE = {
  reminders: [
    { id: 'r1', bubble_id: 'b1', bubble_title: 'Salon de juin 2026', label: 'Confirmer le stand', at: '2099-01-01T09:00:00.000Z', repeat: null, notified_at: null },
    { id: 'r2', bubble_id: 'b2', bubble_title: 'Idée article été', label: null, at: '2020-01-01T09:00:00.000Z', repeat: 'weekly', notified_at: null },
  ],
};

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = (opts.method || 'GET').toUpperCase();
  calls.push(`${method} ${u.replace(/^https:\/\/[^/]+/, '')}`);
  const body = (json) => ({ ok: true, status: 200, json: async () => json });
  if (u.endsWith('/api/keynapse/state') && method === 'GET') return body(STATE_FIXTURE);
  if (u.endsWith('/api/keynapse/reminders') && method === 'GET') return body(REMINDERS_FIXTURE);
  if (u.includes('/bubbles/b1') && u.endsWith('/notes') && method === 'POST') {
    const b = JSON.parse(opts.body); return body({ ok: true, note: { id: 'n2', body: b.body } });
  }
  if (u.includes('/bubbles/b1') && method === 'GET') return body(BUBBLE_B1_DETAIL);
  if (u.includes('/bubbles/b2') && method === 'GET') return body(BUBBLE_B2_DETAIL);
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${method} ${u}` }) };
};

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — résolution d’une bulle (_knResolve)\x1b[0m');
{
  const noRef = await runKoraAction('kn.read_bubble', {});
  check('titre vide → erreur explicite (JAMAIS de choix auto)', !noRef.ok && /titre/i.test(noRef.error));

  const exact = await runKoraAction('kn.read_bubble', { title: 'Idée article été' });
  check('match exact', exact.ok && exact.data.titre === 'Idée article été');

  const partial = await runKoraAction('kn.read_bubble', { title: 'salon de juin' });
  check('match partiel insensible aux accents/casse', partial.ok && partial.data.titre === 'Salon de juin 2026');

  const ambig = await runKoraAction('kn.read_bubble', { title: 'salon' });
  check('ambigu (2 bulles « salon ») → erreur avec candidats', !ambig.ok && /Salon de juin/.test(ambig.error) && /Salon de septembre/.test(ambig.error));

  const none = await runKoraAction('kn.read_bubble', { title: 'zzz-inconnu' });
  check('introuvable → message honnête', !none.ok && /Aucune note/.test(none.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — kn.search\x1b[0m');
{
  const r = await runKoraAction('kn.search', { query: 'salon' });
  check('2 résultats, zone jointe', r.ok && r.data.trouve === 2 && r.data.notes.some(n => n.zone === 'Clients'));
  check('extrait de description présent', r.data.notes.find(n => n.titre === 'Salon de juin 2026').extrait?.includes('Stand E42'));

  const rNone = await runKoraAction('kn.search', { query: 'zzz-inconnu' });
  check('aucun résultat → message (pas une liste vide muette)', rNone.ok && rNone.data.trouve === 0 && /Rien trouvé/.test(rNone.data.message));

  const rEmpty = await runKoraAction('kn.search', {});
  check('query vide → erreur (pas de recherche fantôme)', !rEmpty.ok && /mot-clé/.test(rEmpty.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — kn.list_reminders\x1b[0m');
{
  const r = await runKoraAction('kn.list_reminders', {});
  check('2 rappels, 1 en retard (r2, date 2020)', r.ok && r.data.total === 2 && r.data.en_retard === 1);
  const r1 = r.data.rappels.find(x => x.note === 'Salon de juin 2026');
  const r2 = r.data.rappels.find(x => x.note === 'Idée article été');
  check('rappel à venir (2099) → en_retard false', r1.en_ligne !== true && r1.en_retard === false);
  check('rappel passé (2020) → en_retard true', r2.en_retard === true);
  check('répétition traduite en français', r2.repetition === 'chaque semaine');
  check('libellé null toléré (pas de "null" affiché)', r2.libelle === null);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — kn.read_bubble (détail complet)\x1b[0m');
{
  const r = await runKoraAction('kn.read_bubble', { title: 'Salon de juin' });
  const d = r.data;
  check('zone jointe', d.zone === 'Clients');
  check('tâches : faites/total + restantes nommées', d.taches.faites === 1 && d.taches.total === 3 && d.taches.restantes.includes('Commander les flyers'));
  check('notes libres extraites', d.notes_libres.length === 1 && /Marc/.test(d.notes_libres[0]));
  check('photos/dessins + mémos vocaux comptés', d.photos_dessins === 1 && d.memos_vocaux === 1);
  check('rappel formaté (date FR)', d.rappels.length === 1 && d.rappels[0].libelle === 'Confirmer le stand');
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — kn.open_bubble (résolution AVANT ouverture)\x1b[0m');
{
  const r = await runKoraAction('kn.open_bubble', { title: 'zzz-inconnu' });
  check('titre inconnu → erreur, Keynapse jamais ouvert pour rien', !r.ok && /Aucune note/.test(r.error));
  check('aucun appel d’ouverture tenté (résolution a échoué avant)', !calls.some(c => c.includes('ui-renderer')));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — kn.create_note\x1b[0m');
{
  calls.length = 0;
  const r = await runKoraAction('kn.create_note', { title: 'salon de juin', text: 'RDV confirmé avec Marc.' });
  check('fait:true, POST sur la bonne bulle (b1)', r.ok && r.data.fait === true && calls.some(c => c.includes('POST') && c.includes('/bubbles/b1/notes')));
  check('texte ajouté restitué', r.data.ajoute === 'RDV confirmé avec Marc.');

  const rNoText = await runKoraAction('kn.create_note', { title: 'salon de juin', text: '' });
  check('texte vide → erreur (n’invente pas de contenu)', !rNoText.ok && /texte/i.test(rNoText.error));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — catalogue (caps + méta)\x1b[0m');
{
  check('5 actions keynapse', KORA_ACTIONS.filter(a => a.pad === 'keynapse').length === 5);
  /* seuil, jamais un total exact — sinon chaque futur pad (K-8+) recasse ce test */
  check('≥ 36 actions au total (routage 2 étages désormais ACTIF)', KORA_ACTIONS.length >= 36);
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('KORA_PAD_META a une entrée keynapse (label+desc)', KORA_PAD_META.some(p => p.pad === 'keynapse' && p.label && p.desc));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne keynapse', /keynapse/.test(open.desc) && /keynapse/.test(open.params[0].desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'app/keynapse.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
