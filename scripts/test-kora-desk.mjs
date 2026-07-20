#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test actions Kora × desK (dk.*, K-9 20/07/2026)

   Teste, SANS réseau ni JWT (fetch + localStorage/document mockés) :
     - dk.railroad : numéro en fabrication, bouclage en jours, copies à
       relancer (dont en retard), bac à trier — via bootstrap + issue ;
     - _dkResolvePub : une seule revue se résout seule, plusieurs sans
       référence → erreur qui LISTE, match partiel insensible aux accents ;
     - dk.issue_state : sommaire = seuls les articles PLACÉS, abandonnés
       exclus, PAGE en FOLIO (couverture hors-num, départ 0) pas physique,
       et la COPIE (a.notes) n'est JAMAIS renvoyée au modèle ;
     - dk.relances_dues : calcul PARTAGÉ (lib/desk-rules.js) — mêmes
       suggestions que desK affiche, retard en jours, e-mail connu ;
     - dk.inbox : contributions à trier, pièces jointes comptées ;
     - dk.prepare_relance : PRÉPARE seulement (ligne rouge §7) — article
       introuvable/ambigu/rien à relancer répondent SANS ouvrir desK
       (aucun import ui-renderer déclenché : l'envoi reste le geste humain).

   Usage : node scripts/test-kora-desk.mjs   ·   Exit 0 si OK.
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
globalThis.window = {};

/* dates relatives à MAINTENANT (une échéance figée en dur se périmerait) */
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400e3).toISOString().slice(0, 10);
const sqlAgo = (days) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace('T', ' ');

// Une copie longue — elle NE DOIT JAMAIS ressortir dans une réponse Kora.
const SECRET_COPY = 'CORPS_CONFIDENTIEL_DE_L_ARTICLE_'.repeat(40);

/* L'Épaulette : couverture hors-numérotation, folio départ 0.
   → folio(p1)=couv, folio(p2)=0, folio(p3)=1, folio(p4)=2. */
const BOOT_1 = { ok: true, me: { sub: 'me', name: 'Stéphane' }, publications: [
  { id: 'pub-1', name: "L'Épaulette", slug: 'l-epaulette', owner: true,
    cover_unnumbered: 1, first_folio: 0,
    // ⚠ jalons = TEXT JSON BRUT comme le worker le renvoie (dk_issues.jalons
    // TEXT, jamais parsé au bootstrap) — un objet JS ici masquerait le bug.
    issues: [ { id: 'iss-1', pub_id: 'pub-1', num: 143, theme: 'Spécial cohésion',
      status: 'production', jalons: JSON.stringify({ bouclage: ymd(10) }), created_at: sqlAgo(20) } ] },
] };
// Deux revues → désambiguïsation obligatoire.
const BOOT_2 = { ok: true, me: { sub: 'me', name: 'Stéphane' }, publications: [
  BOOT_1.publications[0],
  { id: 'pub-2', name: 'La Sabretache', slug: 'la-sabretache', owner: true,
    cover_unnumbered: 0, first_folio: 1, issues: [] },
] };

const ISSUE_1 = {
  ok: true,
  issue: BOOT_1.publications[0].issues[0],
  pages: [
    { id: 'p1', issue_id: 'iss-1', n: 1, kind: 'fixe', fixe_title: 'Couverture' },
    { id: 'p2', issue_id: 'iss-1', n: 2, kind: 'vide' },
    { id: 'p3', issue_id: 'iss-1', n: 3, kind: 'article' },
    { id: 'p4', issue_id: 'iss-1', n: 4, kind: 'article' },
  ],
  slots: [
    { id: 's1', page_id: 'p3', position: 0, art_id: 'art-1', banc: null, created_at: sqlAgo(3) },
    { id: 's2', page_id: 'p4', position: 0, art_id: 'art-2', banc: null, created_at: sqlAgo(3) },
    { id: 's3', page_id: 'p2', position: 0, art_id: 'art-3', banc: null, created_at: sqlAgo(3) }, // abandonné
  ],
  articles: [
    { id: 'art-1', title: 'Le stage de cohésion', rub_id: 'r1', contrib: 'Martin',
      status: 'attendu', due: ymd(-5), fresh: 'date', notes: SECRET_COPY, histo: '[]' },
    { id: 'art-2', title: 'Retour sur le défilé', rub_id: 'r1', contrib: 'Claire',
      status: 'remis', due: ymd(-8), fresh: 'date', notes: SECRET_COPY, histo: '[]' },
    { id: 'art-3', title: 'Papier abandonné', rub_id: 'r1', contrib: 'Paul',
      status: 'abandonne', due: null, fresh: 'intemporel', notes: '', histo: '[]' },
    // au marbre (pas placé) — sert l'ambiguïté « martin » de prepare_relance
    { id: 'art-4', title: 'Tribune libre', rub_id: 'r2', contrib: 'Martin Durand',
      status: 'attendu', due: ymd(-6), fresh: 'date', notes: '', histo: '[]' },
  ],
  rubriques: [ { id: 'r1', name: 'Vie du corps', color: '#c9a227', position: 0 } ],
  files: [], quota: { used: 0, max: 2147483648 },
  contribs: [
    { id: 'c1', name: 'Martin', email: 'martin@exemple.fr', n_remises: 0, total_delay: 0 },
    { id: 'c2', name: 'Martin Durand', email: 'durand@exemple.fr', n_remises: 0, total_delay: 0 },
  ],
  relances: [],
  inbox: [
    { id: 'in-1', from_email: 'contrib@exemple.fr', from_name: 'Jean Contributeur',
      subject: 'Mon article sur le raid', body: '…', suggestion: '{}',
      attachments: '[{"name":"raid.pdf"},{"name":"photo.jpg"}]', received_at: sqlAgo(1) },
  ],
  mailer: true,
};
// Un numéro SANS aucune copie à relancer (tout remis) — pour prepare_relance.
const ISSUE_CALME = { ...ISSUE_1, articles: [
  { id: 'art-9', title: 'Tout est rentré', contrib: 'Claire', status: 'remis', due: ymd(-8), notes: '', histo: '[]' },
], slots: [], inbox: [], relances: [] };

const calls = [];
let bootFixture = BOOT_1;
let issueFixture = ISSUE_1;
const mkFetch = () => async (url) => {
  const u = String(url);
  calls.push(u.replace(/^https:\/\/[^/]+/, ''));
  const body = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
  if (u.includes('/api/desk/bootstrap')) return body(bootFixture);
  if (/\/api\/desk\/issue\/iss-\w+/.test(u)) return body(issueFixture);
  return { ok: false, status: 404, json: async () => ({ error: `route non mockée : ${u}` }) };
};
globalThis.fetch = mkFetch();

const { runKoraAction, KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — dk.railroad (état du chemin de fer)\x1b[0m');
{
  const r = await runKoraAction('dk.railroad', {});
  check('ok + revue résolue seule (une seule)', r.ok && r.data.revue === "L'Épaulette");
  check('numéro en fabrication repéré', r.data.numero === 143 && r.data.statut === 'production');
  check('bouclage en jours (≈10, calculé)', r.data.bouclage_dans_jours >= 8 && r.data.bouclage_dans_jours <= 10);
  check('copies à relancer comptées (art-1, art-4)', r.data.copies_a_relancer === 2 && r.data.dont_en_retard === 2);
  check('bac à trier compté', r.data.a_trier === 1);
  check('aucune copie d’article ne fuit', !JSON.stringify(r.data).includes('CORPS_CONFIDENTIEL'));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — _dkResolvePub (résolution de la revue)\x1b[0m');
{
  bootFixture = BOOT_2;
  const noRef = await runKoraAction('dk.railroad', {});
  check('2 revues sans référence → erreur qui LISTE les deux',
    !noRef.ok && /L'Épaulette/.test(noRef.error) && /Sabretache/.test(noRef.error));

  const partial = await runKoraAction('dk.railroad', { revue: 'épaulette' });
  check('match partiel insensible aux accents/casse', partial.ok && partial.data.revue === "L'Épaulette");

  const none = await runKoraAction('dk.railroad', { revue: 'zzz-inconnu' });
  check('revue introuvable → message honnête', !none.ok && /Aucune revue/.test(none.error));
  bootFixture = BOOT_1;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — dk.issue_state (sommaire, folio, zéro fuite)\x1b[0m');
{
  const r = await runKoraAction('dk.issue_state', {});
  check('ok, numéro 143', r.ok && r.data.numero === 143);
  check('seuls les articles PLACÉS (art-3 abandonné exclu)', r.data.articles_places === 2);
  const a1 = r.data.sommaire.find(i => i.titre === 'Le stage de cohésion');
  check('page en FOLIO, pas physique (p3 → folio 1)', a1 && JSON.stringify(a1.pages) === JSON.stringify(['1']));
  check('statut FR + contributeur', a1.statut === 'attendu' && a1.contributeur === 'Martin');
  check('attend_la_copie vrai pour un « attendu »', a1.attend_la_copie === true);
  check('copies attendues comptées (art-1 seul placé et attendu)', r.data.copies_attendues === 1);
  check('la COPIE (notes) ne fuit JAMAIS', !JSON.stringify(r.data).includes('CORPS_CONFIDENTIEL'));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — dk.relances_dues (calcul PARTAGÉ desk-rules)\x1b[0m');
{
  const r = await runKoraAction('dk.relances_dues', {});
  check('total 2 (art-1 + art-4)', r.ok && r.data.total === 2);
  const m = r.data.a_relancer.find(x => x.contributeur === 'Martin');
  check('retard en jours (> 0)', m && m.retard_jours >= 4);
  check('type = copie en retard', m.type === 'copie en retard');
  check('e-mail connu (contrib avec adresse)', m.email_connu === true);
  check('rappel « l’envoi reste ton geste »', /envoi restera ton geste/i.test(r.data.note || ''));
  check('aucune copie ne fuit', !JSON.stringify(r.data).includes('CORPS_CONFIDENTIEL'));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — dk.inbox (bac à trier)\x1b[0m');
{
  const r = await runKoraAction('dk.inbox', {});
  check('1 contribution à trier', r.ok && r.data.total === 1);
  const it = r.data.a_trier[0];
  check('expéditeur + objet', it.de === 'Jean Contributeur' && /raid/.test(it.objet));
  check('pièces jointes comptées (2)', it.pieces_jointes === 2);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — dk.prepare_relance : PRÉPARE, n’envoie jamais (§7)\x1b[0m');
{
  // Article nommé mais absent des copies dues → refus AVANT d'ouvrir desK.
  calls.length = 0;
  const unknown = await runKoraAction('dk.prepare_relance', { article: 'zzz-personne' });
  check('article introuvable → fait:false', unknown.ok && unknown.data.fait === false);
  check('… et desK jamais ouvert (aucun import ui-renderer)', !calls.some(c => c.includes('ui-renderer')));

  // « martin » matche art-1 (Martin) ET art-4 (Martin Durand) → ambigu, on ne devine pas.
  const ambig = await runKoraAction('dk.prepare_relance', { article: 'martin' });
  check('plusieurs correspondances → fait:false qui demande de préciser',
    ambig.ok && ambig.data.fait === false && /Plusieurs correspondent/.test(ambig.data.raison));

  // Un numéro où rien n'est à relancer → refus honnête, sans ouvrir desK.
  issueFixture = ISSUE_CALME;
  const rien = await runKoraAction('dk.prepare_relance', {});
  check('rien à relancer → fait:false honnête', rien.ok && rien.data.fait === false && /Rien à relancer/.test(rien.data.raison));
  issueFixture = ISSUE_1;
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — catalogue (caps + méta + folio partagé)\x1b[0m');
{
  /* seuil scopé au pad — jamais un total figé qui casserait au pad suivant */
  check('5 actions desk présentes', KORA_ACTIONS.filter(a => a.pad === 'desk').length === 5);
  check('4 lectures + 1 écriture sûre',
    KORA_ACTIONS.filter(a => a.pad === 'desk' && a.mode === 'read').length === 4 &&
    KORA_ACTIONS.filter(a => a.pad === 'desk' && a.mode === 'write').length === 1);
  check('toutes les desc ≤ 240 car.', KORA_ACTIONS.every(a => (a.desc || '').length <= 240));
  check('tous les desc de params ≤ 90 car.', KORA_ACTIONS.every(a => (a.params || []).every(p => (p.desc || '').length <= 90)));
  check('toute action desk déclare un target', KORA_ACTIONS.filter(a => a.pad === 'desk').every(a => !!a.target));
  check('KORA_PAD_META a une entrée desk (label+desc≤160)',
    KORA_PAD_META.some(p => p.pad === 'desk' && p.label && p.desc && p.desc.length <= 160));
  const open = KORA_ACTIONS.find(a => a.id === 'os.open_pad');
  check('os.open_pad mentionne desk', /desk/.test(open.desc) && /desk/.test(open.params[0].desc));
  // La règle de relance est UNE seule (partagée) : desk.js et Kora l'importent.
  const rules = await import('../app/lib/desk-rules.js');
  const dues = rules.dkRelancesDues(ISSUE_1.articles, { contribs: ISSUE_1.contribs, relances: ISSUE_1.relances });
  check('desk-rules.dkRelancesDues = même verdict que l’action (2 dues)', dues.length === 2);
  check('folio partagé : dkFolio(3) = 1 (couverture hors-num, départ 0)',
    rules.dkFolio(3, BOOT_1.publications[0]) === 1 && rules.dkFolio(1, BOOT_1.publications[0]) === null);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 8 — Syntaxe (node --check)\x1b[0m');
for (const f of ['app/kora-actions.js', 'app/lib/desk-rules.js', 'app/desk.js', 'workers/src/routes/kora.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
