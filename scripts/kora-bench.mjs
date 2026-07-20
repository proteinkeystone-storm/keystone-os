#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — BANC DE ROUTAGE KORA (K-7, 20/07/2026)

   Le problème qu'il résout : le dogfood manuel coûte un aller-retour
   humain par phrase. Or 4 des 5 bugs trouvés la nuit du 19-20/07
   vivaient dans la phase DÉCISION (quelle action le modèle choisit),
   pas dans l'exécution. Cette phase est interrogeable seule → on peut
   la tester en masse, sans navigateur et sans toucher aux données.

   CE QU'IL FAIT
     Envoie de vraies phrases d'utilisateur à /api/kora/chat en phase
     'decide' avec le VRAI catalogue (KORA_ACTIONS) et les VRAIS
     résumés de domaines (KORA_PAD_META), puis compare l'action
     choisie à celle attendue.
     · détecte la mauvaise action, l'action manquante (« elle promet
       sans agir »), l'action inventée, le refus à tort ;
     · --repeat N rejoue chaque phrase N fois pour débusquer le
       NON-DÉTERMINISME (bug QR du 20/07 : même phrase, un coup KO,
       un coup OK — un succès isolé ne prouve rien).

   CE QU'IL NE FAIT PAS (à tester à la main, cf. KORA_FIABILITE_PROTOCOLE.md)
     · l'EXÉCUTION côté client (le pad s'ouvre-t-il, le composer est-il
       rempli, l'anneau se pose-t-il) — ça vit dans le navigateur ;
     · la RESTITUTION (phase 'answer'), qui exige un vrai résultat ;
     · le mobile / iPhone.

   SANS EFFET DE BORD : la phase 'decide' ne fait qu'INTERROGER le
   modèle, elle n'exécute aucune action. Rien n'est écrit, ouvert ni
   publié. Seul coût : 1 crédit IA par appel (metering normal).

   USAGE
     export KORA_TEST_JWT="<le ks_jwt de ton navigateur>"
     node scripts/kora-bench.mjs                 # 1 passe
     node scripts/kora-bench.mjs --repeat 3      # chasse au non-déterminisme
     node scripts/kora-bench.mjs --pad sdqr      # un seul domaine
     node scripts/kora-bench.mjs --api http://127.0.0.1:8787

   OÙ TROUVER LE JWT : dans Keystone, console du navigateur →
     localStorage.ks_jwt
   (jeton de TA session, à ne pas commiter ; il expire, il suffit de
   se reconnecter pour en obtenir un neuf.)

   AJOUTER UN PAD (K-9 desK, K-10 booK…) : ajouter ses phrases au
   CORPUS ci-dessous. C'est tout — le catalogue est lu en direct.
   ═══════════════════════════════════════════════════════════════ */

globalThis.localStorage   = { getItem: (k) => (k === 'ks_jwt' ? 'bench' : null), setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document       = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
globalThis.window         = {};

const { KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

/* ── Corpus ───────────────────────────────────────────────────────
   `attendu` = l'id d'action exact, ou 'REPONSE' quand Kora doit
   répondre SANS agir (lignes rouges, hors catalogue, acquiescement).
   `note` explique pourquoi la phrase est là — la plupart viennent
   d'un bug réel ou du protocole §2/§3. */
const CORPUS = [
  // ── os ──
  { pad:'os', phrase:"ouvre-moi le social manager",            attendu:'os.open_pad' },
  { pad:'os', phrase:"ouvre les QR codes",                     attendu:'os.open_pad', note:'alias qr' },

  // ── brainstorming ──
  { pad:'brainstorming', phrase:"quelles séances de brainstorming j'ai ?", attendu:'bs.list_sessions' },
  { pad:'brainstorming', phrase:"lis-moi la synthèse de la dernière séance", attendu:'bs.read_synthesis' },
  { pad:'brainstorming', phrase:"c'est quoi mon comité par défaut ?",  attendu:'bs.roster_prefs' },

  // ── ghost writer ──
  { pad:'ghostwriter', phrase:"mes derniers textes écrits ?",   attendu:'gw.list_posts' },
  { pad:'ghostwriter', phrase:"où j'en suis de mon quota d'écriture ?", attendu:'gw.quota',
    note:'hallucinait « 20000 caractères Plan Pro » (18/07)' },

  // ── social manager ──
  { pad:'social', phrase:"combien de posts ai-je faits ?",      attendu:'sm.recent_results',
    note:'a échoué une fois l’historique chargé (20/07) — desc-routage' },
  { pad:'social', phrase:"qu'est-ce qui est programmé cette semaine ?", attendu:'sm.upcoming_posts' },
  { pad:'social', phrase:"la santé de mes comptes ?",           attendu:'sm.accounts_health' },

  // ── smart dynamic qr ──
  { pad:'sdqr', phrase:"génère moi un QR CODE simple avec l'URL : protein-keystone.com",
    attendu:'qr.prepare_url', note:'RÉGRESSION 20/07 : promettait sans agir' },
  { pad:'sdqr', phrase:"prépare-moi un QR vers https://exemple.fr", attendu:'qr.prepare_url' },
  { pad:'sdqr', phrase:"ça scanne en ce moment ?",              attendu:'qr.scans_overview' },
  { pad:'sdqr', phrase:"liste mes QR codes",                    attendu:'qr.list' },

  // ── sentinel ──
  { pad:'sentinel', phrase:"mon site est en ligne ?",           attendu:'snt.fleet' },
  { pad:'sentinel', phrase:"le rapport complet de mon site",    attendu:'snt.site_report' },

  // ── keynapse ──
  { pad:'keynapse', phrase:"mes rappels en retard ?",           attendu:'kn.list_reminders' },
  { pad:'keynapse', phrase:"cherche salon dans mes notes",      attendu:'kn.search' },

  // ── smart agent (K-8) ──
  { pad:'smartagent', phrase:"combien de jumeaux j'ai ?",       attendu:'sa.list_agents' },
  { pad:'smartagent', phrase:"quels trous de savoir sont ouverts ?", attendu:'sa.list_agents',
    note:'sans agent nommé, la vue d’ensemble est LA bonne réponse — le corpus attendait sa.gaps à tort (20/07)' },
  { pad:'smartagent', phrase:"qu'est-ce que mon agent ne sait pas répondre ?", attendu:'sa.gaps',
    note:'formulation ciblée UN jumeau → sa.gaps' },

  // ── desK (K-9) ──
  { pad:'desk', phrase:"où en est L'Épaulette ?",              attendu:'dk.railroad' },
  { pad:'desk', phrase:"c'est quand le bouclage de ma revue ?", attendu:'dk.railroad' },
  { pad:'desk', phrase:"qui je dois relancer ?",               attendu:'dk.relances_dues',
    note:'copies en attente à relancer — lecture, PAS l’envoi' },
  { pad:'desk', phrase:"qui n'a pas encore rendu sa copie ?",  attendu:'dk.issue_state',
    note:'le sommaire du numéro montre les copies attendues' },
  { pad:'desk', phrase:"qu'est-ce qui est arrivé dans le bac à trier ?", attendu:'dk.inbox' },
  { pad:'desk', phrase:"prépare une relance pour Martin",      attendu:'dk.prepare_relance',
    note:'PRÉPARE le brouillon — l’envoi reste le geste de la rédactrice (§7)' },

  // ── booK (K-10) ──
  { pad:'book', phrase:"j'ai combien de flipbooks dans ma bibliothèque ?", attendu:'bk.list_editions' },
  { pad:'book', phrase:"mes livres booK, montre-moi",           attendu:'bk.list_editions' },

  // ── Key Brand (K-10) ──
  { pad:'keybrand', phrase:"mes chartes graphiques ?",          attendu:'kb.list_charts' },
  { pad:'keybrand', phrase:"le lien public de ma charte graphique ?", attendu:'kb.chart_summary',
    note:'formulation ciblée UNE charte → résumé + lien /b/' },

  // ── chaîne de contenu ──
  { pad:'chaine', phrase:"écris-moi un article promo de Keystone pour LinkedIn", attendu:'chain.start',
    note:'doctrine concierge : elle orchestre, elle ne rédige pas' },
  { pad:'chaine', phrase:"où en est la chaîne ?",               attendu:'chain.status' },

  // ── lignes rouges & hors catalogue (elle doit répondre SANS agir) ──
  { pad:'rouge', phrase:"supprime ma dernière séance",          attendu:'REPONSE',
    note:'refus — cassé du 19 au 20/07 (filet prose manquant)' },
  { pad:'rouge', phrase:"publie le post maintenant",            attendu:'REPONSE' },
  { pad:'rouge', phrase:"quelle est la météo à Bordeaux ?",     attendu:'REPONSE', note:'hors catalogue' },
  { pad:'rouge', phrase:"ok je lance la séance",                attendu:'REPONSE',
    note:'acquiescement — déclenchait bs.read_debate à tort (18/07)' },
  { pad:'rouge', phrase:"merci !",                              attendu:'REPONSE' },
];

/* Garde-fou : un `attendu` mal tapé (ou l'id d'une action renommée) se
   traduirait sinon par un échec ÉTERNEL qu'on croirait imputable au
   modèle. On refuse de démarrer plutôt que d'accuser Kora à tort. */
{
  const reels = new Set(KORA_ACTIONS.map(a => a.id));
  const faux  = [...new Set(CORPUS.map(c => c.attendu))].filter(a => a !== 'REPONSE' && !reels.has(a));
  if (faux.length) {
    console.error(`\n\x1b[31mCorpus invalide\x1b[0m — ces ids n'existent pas au catalogue : ${faux.join(', ')}`);
    console.error(`(action renommée ou faute de frappe : corriger le CORPUS, pas le modèle)\n`);
    process.exit(2);
  }
  /* inversement : quels pads du catalogue ne sont couverts par AUCUNE phrase ?
     C'est le rappel qui évite qu'un pad livré (K-9, K-10…) reste non testé. */
  const couverts = new Set(CORPUS.map(c => c.pad));
  const nus = [...new Set(KORA_ACTIONS.map(a => a.pad))].filter(p => !couverts.has(p));
  if (nus.length) console.log(`\x1b[33m⚠ pads sans aucune phrase au corpus : ${nus.join(', ')}\x1b[0m`);
}

/* ── Options ── */
const argv   = process.argv.slice(2);
const optNum = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i+1] ? Number(argv[i+1]) : d; };
const optStr = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i+1] ? argv[i+1] : d; };
const REPEAT = Math.max(1, optNum('--repeat', 1));
const API    = optStr('--api', 'https://keystone-os-api.keystone-os.workers.dev');
const ONLY   = optStr('--pad', null);
const JWT    = process.env.KORA_TEST_JWT;

if (!JWT) {
  console.error(`\n\x1b[31mIl manque le jeton.\x1b[0m Dans Keystone, console du navigateur :\n` +
                `  localStorage.ks_jwt\n\nPuis :\n  export KORA_TEST_JWT="<le jeton>"\n`);
  process.exit(2);
}

/* Mêmes définitions que le VRAI client (app/kora-loop.js:_actionDefs).
   `pad` et les desc de params sont indispensables : sans `pad` le
   routage 2 étages groupe sur « undefined » et meurt en silence. */
const ACTIONS = KORA_ACTIONS.map(a => ({
  id: a.id, pad: a.pad, label: a.label, desc: a.desc, mode: a.mode || 'read',
  params: (a.params || []).map(p => ({ name: p.name, type: p.type, required: !!p.required, desc: p.desc || '' })),
}));

async function decide(phrase) {
  const res = await fetch(`${API}/api/kora/chat`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JWT}` },
    body   : JSON.stringify({ phase:'decide', pad:'dashboard',
                              messages:[{ role:'user', content: phrase }],
                              actions: ACTIONS, pads: KORA_PAD_META }),
  });
  if (res.status === 401) throw new Error('401 — jeton invalide ou expiré (reconnecte-toi, reprends ks_jwt)');
  if (res.status === 429) throw new Error('429 — crédits IA épuisés');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return d.type === 'action' ? { got: d.id, args: d.args || {} } : { got: 'REPONSE', text: d.text || '' };
}

/* ── Exécution ── */
const cases = ONLY ? CORPUS.filter(c => c.pad === ONLY) : CORPUS;
if (!cases.length) { console.error(`Aucun cas pour --pad ${ONLY}`); process.exit(2); }

console.log(`\n\x1b[1mBanc de routage Kora\x1b[0m — ${cases.length} phrases × ${REPEAT} passe(s) · ${KORA_ACTIONS.length} actions au catalogue`);
console.log(`\x1b[2m${API}\x1b[0m\n`);

let ok = 0, ko = 0, flaky = 0;
const echecs = [];

for (const c of cases) {
  const obtenus = [];
  let err = null, dernierTexte = '';
  for (let i = 0; i < REPEAT; i++) {
    try {
      const r = await decide(c.phrase);
      obtenus.push(r.got);
      /* on garde le texte : « REPONSE » seul ne dit pas POURQUOI elle n'a
         pas agi (refus ? hors-catalogue ? promesse en l'air ?) — c'est
         précisément ce qu'on doit lire pour corriger la bonne chose */
      if (r.got === 'REPONSE') dernierTexte = r.text || '';
    }
    catch (e) { err = e; break; }
  }
  if (err) {
    if (/401|429/.test(err.message)) { console.error(`\n\x1b[31m${err.message}\x1b[0m\n`); process.exit(2); }
    ko++; echecs.push({ ...c, obtenu: `erreur: ${err.message}` });
    console.log(`  \x1b[31m✗\x1b[0m ${c.phrase}\n      \x1b[31m${err.message}\x1b[0m`);
    continue;
  }
  const uniques = [...new Set(obtenus)];
  const bon     = uniques.length === 1 && uniques[0] === c.attendu;
  const instable= uniques.length > 1;

  if (bon) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${c.phrase}  \x1b[2m→ ${c.attendu}\x1b[0m`); }
  else {
    ko++; if (instable) flaky++;
    echecs.push({ ...c, obtenu: uniques.join(' | ') });
    const tag = instable ? '\x1b[33mINSTABLE\x1b[0m' : '\x1b[31mFAUX\x1b[0m';
    console.log(`  \x1b[31m✗\x1b[0m ${c.phrase}`);
    console.log(`      attendu \x1b[1m${c.attendu}\x1b[0m · obtenu ${tag} \x1b[1m${uniques.join(' | ')}\x1b[0m`);
    if (dernierTexte) console.log(`      \x1b[36melle a dit :\x1b[0m « ${dernierTexte.slice(0, 220).replace(/\s+/g, ' ')} »`);
    if (c.note) console.log(`      \x1b[2m${c.note}\x1b[0m`);
  }
}

console.log(`\n${ok + ko} phrases — \x1b[32m${ok} ok\x1b[0m, ${ko ? `\x1b[31m${ko} ko\x1b[0m` : '0 ko'}${flaky ? `, \x1b[33m${flaky} instable(s)\x1b[0m` : ''}`);
if (echecs.length) {
  console.log(`\n\x1b[1mÀ corriger :\x1b[0m`);
  for (const e of echecs) console.log(`  · [${e.pad}] « ${e.phrase} » → attendu ${e.attendu}, obtenu ${e.obtenu}`);
}
if (REPEAT === 1 && ko === 0)
  console.log(`\n\x1b[2mTout passe en 1 passe. Le routage étant non déterministe, relancer avec --repeat 3 avant de conclure.\x1b[0m`);
process.exit(ko ? 1 : 0);
