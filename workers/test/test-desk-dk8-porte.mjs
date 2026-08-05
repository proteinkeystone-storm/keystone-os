/* ═══════════════════════════════════════════════════════════════
   desK DK-8 — « la porte d'entrée increvable »
   Suite E2E contre `wrangler dev --local`.

   Deux promesses, et rien d'autre :

   1. LE BAC PLEIN NE REFUSE PLUS RIEN. Avant DK-8, passé 200 plis en
      attente, la digestion répondait `{ ok:false, reason:'bac plein' }`
      et le handler e-mail faisait `setReject('Dépôt refusé')` : l'auteur
      d'une contribution parfaitement légitime recevait un échec SMTP, et
      la rédaction n'en entendait jamais parler. Désormais tout entre ;
      ce qui ne tient pas sur le bureau est MIS DE CÔTÉ (status 'differe')
      et remonte tout seul dès qu'une place se libère.

   2. UN MESSAGE QUI ÉCHOUE À SPF/DKIM NE SE POSE JAMAIS TOUT SEUL SUR
      UNE PAGE. Le rapprochement automatique se fonde entièrement sur
      l'adresse de l'expéditeur — falsifiable. Depuis que l'adresse de
      dépôt est publiée aux contributeurs (4 août 2026), une usurpation
      suffirait à faire entrer un faux papier en page sans qu'un humain
      l'ait vu. Authentification en échec → bac, mention à l'écran.

   Lancer le worker AVANT (session partagée par tous les bancs desK) :
     npx wrangler dev --local -c wrangler.dktest.toml --port 8799 \
       --test-scheduled \
       --var KS_JWT_SECRET:dk2-test-secret --var "KS_ALLOWED_ORIGIN:*" \
       --var KS_ADMIN_SECRET:dk4-admin --var DK_EMAIL_IA:off
   Puis :
     node test/test-desk-dk8-porte.mjs

   ⚠ Ce banc écrit ~480 entrées de bac (l'avalanche est jouée EN VRAI,
     avec les plafonds de production : 200 au bac, 20 par expéditeur).
     Comptez ~30 s. Lancez-le EN DERNIER dans la campagne desK, et
     effacez l'état D1/R2 entre deux campagnes comme d'habitude.
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';

const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const ADMIN = process.env.DK_ADMIN || 'dk4-admin';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return `${h}.${p}.${sig}`;
}
/* Propriétaire NEUF à chaque passage : le banc crée deux publications, et
   `MAX_PUBS_OWNED` finirait par le refuser au bout de quelques relances sur
   un même état local. Avec un `sub` daté, il se relance à volonté sans avoir
   à effacer D1 — ce qui compte quand on vérifie qu'il attrape bien. */
const RUN = Date.now();
const A = jwt({ sub: 'dk8-owner-' + RUN, owner: 'Stéphane', email: `owner+${RUN}@test.dk8` });

async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const inject = (mail) => call(ADMIN, '/email-inject', { method: 'POST', body: mail });

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
function iso(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }
const pageN = (d, n) => d.data.pages.find(p => p.n === n);
const artById = (d, id) => d.data.articles.find(a => a.id === id);

/* En-tête tel que Cloudflare Email Routing le pose en tête du message.
   On rejoue les formes réelles, pas une chaîne inventée. */
const AUTH_OK   = 'mx.cloudflare.com; dkim=pass header.d=contrib.dk8; spf=pass (sender SPF authorized) smtp.mailfrom=contrib.dk8; dmarc=pass header.from=contrib.dk8';
const AUTH_SPF  = 'mx.cloudflare.com; dkim=none (message not signed); spf=fail (domain of contrib.dk8 does not designate 203.0.113.7 as permitted sender) smtp.mailfrom=contrib.dk8; dmarc=fail header.from=contrib.dk8';
const AUTH_DKIM = 'mx.cloudflare.com; dkim=fail (bad signature) header.d=contrib.dk8; spf=pass smtp.mailfrom=contrib.dk8; dmarc=fail header.from=contrib.dk8';
// Un expéditeur malveillant peut GLISSER son propre Authentication-Results
// dans le corps du message ; Cloudflare pose le sien en tête, mais on ne
// veut pas dépendre de l'ordre : le moindre « fail » doit l'emporter.
const AUTH_FORGE = AUTH_SPF + ', forge.example.com; spf=pass; dkim=pass; dmarc=pass';

async function main() {
  console.log('desK DK-8 — la porte d\'entrée increvable ·', API, '\n');

  const h = await fetch(API + '/api/desk/health').then(r => r.json());
  ok(h.ok && h.schema === 'ready', 'health → schéma prêt', h);
  const ts = RUN;

  /* ═══════════════════════════════════════════════════════════════
     PARTIE 1 · SPF / DKIM — le rattachement automatique sous condition
     ═══════════════════════════════════════════════════════════════ */
  console.log('\n1 · Authentification de l\'expéditeur (SPF/DKIM)');

  const pubA = (await call(A, '/publication', { method: 'POST', body: { name: `Épreuve DK8 auth ${ts}` } })).data.publication.id;
  const slugA = `dk8auth-${ts}`;
  await call(A, '/publication/' + pubA, { method: 'PATCH', body: { slug: slugA } });
  const issA = (await call(A, '/publication/' + pubA + '/issue', { method: 'POST', body: {
    num: '200', pages: 12, jalons: { bouclage: iso(20), maquette: iso(30), imprimeur: iso(37), parution: iso(45) },
  } })).data.issue.id;

  // Un contributeur connu, cinq papiers attendus, chacun posé sur sa page.
  // Titres à vocabulaire DISJOINT : le départage lexical de la digestion doit
  // désigner un gagnant franc, sinon on mesurerait autre chose que DK-8.
  await call(A, '/publication/' + pubA + '/contrib', { method: 'POST', body: { name: 'Dupont', email: 'dupont@contrib.dk8' } });
  const titres = [
    'Chronique alpestre du bivouac',
    'Portrait maritime des mousses',
    'Enquete ferroviaire vers Vierzon',
    'Reportage boulanger dans Rennes',
    'Analyse budgetaire des casernes',
  ];
  const arts = [];
  for (const t of titres) {
    arts.push((await call(A, '/publication/' + pubA + '/article', { method: 'POST', body: {
      title: t, status: 'attendu', due: iso(5), contrib: 'Dupont',
    } })).data.article);
  }
  let d = await call(A, '/issue/' + issA);
  for (let i = 0; i < arts.length; i++) {
    await call(A, '/page/' + pageN(d, i + 2).id + '/slot', { method: 'POST', body: { art_id: arts[i].id } });
  }

  const depot = (extra = {}) => ({ to: `${slugA}@test.dk`, from_email: 'dupont@contrib.dk8', from_name: 'Dupont', ...extra });

  // 1a · Référence : sans en-tête d'authentification (le flux d'avant DK-8,
  // et l'injection admin), rien ne change — le rattachement automatique joue.
  let r = await inject(depot({ subject: titres[0], body: 'Voici ma copie du bivouac.' }));
  ok(r.status === 200 && r.data.mode === 'auto' && r.data.art_id === arts[0].id,
    'sans mention d\'authentification → rattachement automatique (comportement d\'avant, intact)', r.data);
  ok(r.data.auth === null || r.data.auth === undefined, 'aucun verdict inventé quand l\'en-tête est absent', r.data.auth);

  // 1b · Authentification en règle → le rattachement automatique joue aussi.
  r = await inject(depot({ subject: titres[3], body: 'La copie de Rennes.', auth_results: AUTH_OK }));
  ok(r.status === 200 && r.data.mode === 'auto' && r.data.art_id === arts[3].id,
    'SPF+DKIM+DMARC au vert → rattachement automatique (rien de cassé pour les envois légitimes)', r.data);

  // 1c · LE CŒUR : SPF en échec sur un message par ailleurs PARFAIT (expéditeur
  // connu, papier attendu, posé en page). Avant DK-8 il partait tout seul
  // en page 4. Il doit désormais s'arrêter au bac.
  const pj = Buffer.from('copie usurpee').toString('base64');
  r = await inject(depot({ subject: titres[1], body: 'Ma copie des mousses.', auth_results: AUTH_SPF,
    attachments: [{ name: 'mousses.txt', b64: pj }] }));
  ok(r.status === 200 && r.data.ok === true, 'message non authentifié : reçu, jamais refusé', r.data);
  ok(r.data.mode === 'bac', 'SPF en échec → le pli descend au bac (pas de rattachement automatique)', r.data.mode);
  ok(r.data.auth === 'fail', 'verdict d\'authentification retenu : fail', r.data);
  ok(String(r.data.auth_detail || '').includes('spf=fail'), 'le détail nomme le contrôle qui a lâché', r.data.auth_detail);
  ok(r.data.suggestion && r.data.suggestion.art_id === arts[1].id,
    'la cible reste PROPOSÉE — on ne perd pas le travail de la digestion, on demande un humain', r.data.suggestion);
  const inboxSpf = r.data.inboxId;

  d = await call(A, '/issue/' + issA);
  const artSpf = artById(d, arts[1].id);
  ok(artSpf && artSpf.status === 'attendu',
    'l\'article visé est TOUJOURS « attendu » : le faux message ne s\'est pas posé sur sa page', artSpf && artSpf.status);
  ok((d.data.files || []).filter(f => f.art_id === arts[1].id).length === 0,
    'sa pièce jointe n\'est jamais entrée au casier de la page', (d.data.files || []).map(f => f.art_id));
  const auBac = (d.data.inbox || []).find(e => e.id === inboxSpf);
  ok(auBac && auBac.status === 'pending', 'le pli est bien au bac, en attente de tri', auBac && auBac.status);
  ok(auBac && auBac.auth === 'fail',
    'le verdict voyage jusqu\'au front : la mention peut s\'afficher sur le panneau de tri', auBac && auBac.auth);

  // 1d · DKIM seul en échec → même règle.
  r = await inject(depot({ subject: titres[2], body: 'La copie de Vierzon.', auth_results: AUTH_DKIM }));
  ok(r.status === 200 && r.data.mode === 'bac' && r.data.auth === 'fail',
    'DKIM en échec → bac lui aussi (ce n\'est pas qu\'une affaire de SPF)', r.data);
  d = await call(A, '/issue/' + issA);
  ok(artById(d, arts[2].id).status === 'attendu', 'l\'article de Vierzon reste attendu', artById(d, arts[2].id).status);

  // 1e · Lecture fail-safe : un faux « pass » ajouté après coup n'efface pas
  // le vrai « fail ».
  r = await inject(depot({ subject: titres[4], body: 'La copie des casernes.', auth_results: AUTH_FORGE }));
  ok(r.status === 200 && r.data.mode === 'bac' && r.data.auth === 'fail',
    'un second Authentication-Results forgé « pass » ne blanchit pas le vrai « fail »', r.data);

  // 1f · La bannette dit ce qui s'est passé, pour chaque pli.
  const courA = await call(A, '/publication/' + pubA + '/courrier');
  const ligneSpf = (courA.data.courrier || []).find(c => c.id === inboxSpf);
  ok(ligneSpf && ligneSpf.auth === 'fail' && String(ligneSpf.auth_detail || '').includes('spf=fail'),
    'la bannette porte la mention « non authentifié » sur la ligne concernée', ligneSpf && ligneSpf.auth_detail);
  ok((courA.data.courrier || []).filter(c => c.status === 'auto').length === 2,
    'deux rattachements automatiques au total — et seulement ceux dont l\'authentification tenait',
    (courA.data.courrier || []).map(c => c.status));

  /* ═══════════════════════════════════════════════════════════════
     PARTIE 2 · L'avalanche — 300 messages, puis le 301ᵉ contributeur
     ═══════════════════════════════════════════════════════════════ */
  console.log('\n2 · L\'avalanche de 300 messages (plafonds de PRODUCTION : 200 au bac, 20 par expéditeur)');

  const pubB = (await call(A, '/publication', { method: 'POST', body: { name: `Épreuve DK8 avalanche ${ts}` } })).data.publication.id;
  const slugB = `dk8flood-${ts}`;
  await call(A, '/publication/' + pubB, { method: 'PATCH', body: { slug: slugB } });

  const AVALANCHE = 300;
  const t0 = Date.now();
  let refus = 0, erreurs = 0;
  for (let i = 1; i <= AVALANCHE; i++) {
    const rr = await inject({ to: `${slugB}@test.dk`, from_email: 'avalanche@indesirable.dk8',
      subject: `Offre exceptionnelle n°${i}`, body: 'Cliquez vite, offre limitée.' });
    if (rr.status !== 200) erreurs++;
    // « Refusé » se compte sur le SORT, pas sur la forme : un 400 de la route
    // et un `{ ok:false }` en 200 sont le même échec renvoyé à l'auteur.
    if (rr.data.ok !== true) refus++;
  }
  console.log(`    (${AVALANCHE} messages injectés en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  ok(erreurs === 0, `les ${AVALANCHE} messages ont tous été acceptés par la porte (aucune erreur HTTP)`, erreurs);
  ok(refus === 0, `AUCUN des ${AVALANCHE} messages n'a été refusé — même l'indésirable entre et se voit`, refus);

  let cour = await call(A, '/publication/' + pubB + '/courrier?limit=200');
  ok(cour.data.compte.pending === 20,
    'l\'avalanche n\'occupe que 20 lignes du bac (plafond par expéditeur)', cour.data.compte);
  ok(cour.data.compte.differe === AVALANCHE - 20,
    `les ${AVALANCHE - 20} autres sont MISES DE CÔTÉ, pas jetées`, cour.data.compte);
  ok((cour.data.compte.rejete || 0) === 0, 'rien n\'a été écarté dans le dos de la rédaction', cour.data.compte);

  // LE 301ᵉ : un contributeur légitime, jamais vu, arrive juste après l'orage.
  const r301 = await inject({ to: `${slugB}@test.dk`, from_email: 'legitime@contrib.dk8', from_name: 'Une contributrice',
    subject: 'Ma chronique pour le prochain numéro', body: 'Bonjour, voici mon papier promis la semaine dernière.' });
  ok(r301.status === 200 && r301.data.ok === true,
    'le 301ᵉ contributeur légitime n\'est PAS refusé', r301.data);
  ok(r301.data.mode === 'bac',
    'et il n\'est même pas mis de côté : il arrive directement sur le bureau de la rédactrice', r301.data.mode);
  cour = await call(A, '/publication/' + pubB + '/courrier?limit=200');
  ok(cour.data.compte.pending === 21, 'le bac contient 21 plis : 20 d\'avalanche + la contribution', cour.data.compte);

  /* ═══════════════════════════════════════════════════════════════
     PARTIE 3 · Le bac VRAIMENT plein — et le repêchage équitable
     ═══════════════════════════════════════════════════════════════ */
  console.log('\n3 · Le bac rempli à ras bord (200 plis en attente)');

  // 179 plis de plus, répartis sur des expéditeurs distincts pour ne pas
  // buter sur le plafond individuel : 8 × 20 + 1 × 19.
  const t1 = Date.now();
  let remplis = 0, refusRemplissage = 0;
  for (let s = 1; s <= 9; s++) {
    const n = s === 9 ? 19 : 20;
    for (let i = 1; i <= n; i++) {
      const rr = await inject({ to: `${slugB}@test.dk`, from_email: `auteur${s}@contrib.dk8`,
        subject: `Papier ${s}-${i}`, body: 'Un texte de plus dans la pile.' });
      if (rr.status !== 200 || rr.data.ok !== true) refusRemplissage++;
      else remplis++;
    }
  }
  console.log(`    (179 messages injectés en ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  ok(refusRemplissage === 0 && remplis === 179, 'les 179 plis de remplissage sont tous entrés', { remplis, refusRemplissage });
  cour = await call(A, '/publication/' + pubB + '/courrier?limit=200');
  ok(cour.data.compte.pending === 200, 'le bac est exactement plein : 200 plis en attente de tri', cour.data.compte);

  // Le pli de trop : celui qui, AVANT DK-8, recevait un échec SMTP.
  const rTardif = await inject({ to: `${slugB}@test.dk`, from_email: 'tardif@contrib.dk8', from_name: 'Le Tardif',
    subject: 'Mon papier, désolé du retard', body: 'J\'ai fini par le terminer, le voici.' });
  ok(rTardif.status === 200 && rTardif.data.ok === true,
    'bac plein : la contribution est REÇUE (avant DK-8 : « Dépôt refusé » renvoyé à l\'auteur)', rTardif.data);
  ok(rTardif.data.mode === 'differe' && rTardif.data.differe === 'bac-plein',
    'elle est mise de côté, avec le motif — pas refoulée', rTardif.data);
  const idTardif = rTardif.data.inboxId;
  cour = await call(A, '/publication/' + pubB + '/courrier?limit=200');
  const ligneTardif = (cour.data.courrier || []).find(c => c.id === idTardif);
  ok(ligneTardif && ligneTardif.status === 'differe' && ligneTardif.body.includes('J\'ai fini'),
    'son texte est intact dans la bannette : la rédaction PEUT la voir', ligneTardif && ligneTardif.status);

  // La rédactrice traite un pli : une place se libère.
  const unPending = (cour.data.courrier || []).find(c => c.status === 'pending');
  const rj = unPending ? await call(A, '/inbox/' + unPending.id + '/reject', { method: 'POST' })
                       : { status: 0, data: { erreur: 'aucun pli au bac' } };
  ok(rj.status === 200, 'un pli est écarté par la rédaction → une place se libère', rj.data);
  ok(rj.data.repeches === 1, 'le repêchage se déclenche immédiatement, pour un pli exactement', rj.data);

  cour = await call(A, '/publication/' + pubB + '/courrier?limit=200');
  const tardifApres = (cour.data.courrier || []).find(c => c.id === idTardif);
  ok(tardifApres && tardifApres.status === 'pending',
    'C\'EST LA CONTRIBUTION LÉGITIME qui remonte au bac, pas un des 280 messages de l\'avalanche', tardifApres && tardifApres.status);
  ok(cour.data.compte.differe === AVALANCHE - 20,
    'l\'avalanche, elle, reste au plafond de son expéditeur : elle ne double personne', cour.data.compte);
  ok(cour.data.compte.pending === 200, 'et le bac reste rempli à sa mesure', cour.data.compte);

  // Une entrée mise de côté se trie normalement si la rédactrice va la chercher
  // elle-même dans la bannette — « de côté » n'est pas un sort, c'est une file.
  const unDiffere = (cour.data.courrier || []).find(c => c.status === 'differe');
  const rApply = unDiffere
    ? await call(A, '/inbox/' + unDiffere.id + '/apply', { method: 'POST', body: {
        create: { title: 'Trié depuis la file d\'attente' } } })
    : { status: 0, data: { erreur: 'aucun pli mis de côté à trier' } };
  ok(rApply.status === 200 && rApply.data.art_id,
    'un pli mis de côté se trie comme les autres, sans attendre son repêchage', rApply.data);

  console.log(`\n${pass} ✓ · ${fail} ✗`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('Suite interrompue :', e); process.exit(1); });
