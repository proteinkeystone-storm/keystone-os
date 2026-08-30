/* ═══════════════════════════════════════════════════════════════
   desK — numérotation PAR PAGE (août 2026).
   Une revue = DEUX maquettes InDesign : le cahier de couverture
   (C1-C4) s'ENROULE autour de l'intérieur — la 3ᵉ/4ᵉ de couv sont
   les DERNIÈRES pages physiques, le réglage de publication seul
   (cover_unnumbered/first_folio) ne tombait jamais juste. Ici :
   · la logique PURE partagée desK ↔ Kora (dkFolioMap & co) ;
   · l'E2E worker : POST /page/:id/folio (OWNER seul), folio accroché
     à la POSITION physique (move ne le transporte pas, resize garde
     la 4ᵉ de couv marquée), numéro imprimé figé.
   Prérequis worker : cf. entête test-desk-dk4.mjs (mêmes --var,
   même session `wrangler dev --local -c wrangler.dktest.toml`).
   ═══════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
import { dkFolioMap, dkFolio, dkPn, dkHorsNumLabel, dkHorsNumShort } from '../../app/lib/desk-rules.js';

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };

/* ── 1 · Logique pure (desk-rules.js) ─────────────────────────── */
console.log('\ndesK — folio par page · logique pure\n');

const mk = (total, over = {}) => Array.from({ length: total }, (_, i) => {
  const n = i + 1;
  return { n, folio_mode: over[n]?.mode || null, folio_start: over[n]?.start ?? null };
});
const STD = { cover_unnumbered: 0, first_folio: 1 };
const EPA = { cover_unnumbered: 1, first_folio: 0 };

{ // Base standard : rien de réglé = 1, 2, 3… (et compat 2-args)
  const m = dkFolioMap(mk(4), STD);
  ok(m.get(1) === 1 && m.get(4) === 4, 'standard : p1=1 … p4=4');
  ok(dkFolio(3, STD) === 3 && dkFolio(3, STD, mk(4)) === 3, 'dkFolio : 2-args et 3-args d’accord (standard)');
}
{ // L'Épaulette historique : couverture hors-num, départ 0
  const m = dkFolioMap(mk(4), EPA);
  ok(m.get(1) === null && m.get(2) === 0 && m.get(3) === 1, 'Épaulette : couv, 0, 1 (compat juillet)');
  ok(dkFolio(3, EPA) === 1, 'dkFolio 2-args : le sommaire (3ᵉ physique) porte 1');
  ok(dkPn(1, EPA) === 'couv.', 'dkPn sans pages : couv. (compat)');
}
{ // LE cas de la demande : 68 pages, cahier de couverture qui s'enroule
  const pages = mk(68, { 67: { mode: 'hors' }, 68: { mode: 'hors' } });
  const m = dkFolioMap(pages, EPA);
  ok(m.get(2) === 0 && m.get(3) === 1 && m.get(66) === 64, 'revue 68 p. : intérieur 1…64 (p3…p66)');
  ok(m.get(67) === null && m.get(68) === null, '3ᵉ et 4ᵉ de couv HORS numérotation');
  ok(dkPn(67, EPA, pages) === '3ᵉ de couv.' && dkPn(68, EPA, pages) === '4ᵉ de couv.', 'dkPn : étiquettes 3ᵉ/4ᵉ de couv par la position');
  ok(dkPn(66, EPA, pages) === '64' && dkPn(1, EPA, pages) === 'couv.', 'dkPn : folio au milieu, couv. devant');
}
{ // Cahier complet C1-C4 hors-num (C2 aussi), intérieur 1…64
  const pages = mk(68, { 2: { mode: 'hors' }, 67: { mode: 'hors' }, 68: { mode: 'hors' } });
  const m = dkFolioMap(pages, { cover_unnumbered: 1, first_folio: 1 });
  ok(m.get(2) === null && m.get(3) === 1 && m.get(66) === 64, 'C2 sortie aussi : l’intérieur démarre à 1 sans décalage');
  ok(dkPn(2, { cover_unnumbered: 1, first_folio: 1 }, pages) === '2ᵉ de couv.', 'dkPn : 2ᵉ de couv.');
}
{ // Ancre : recaler la suite en cours de route
  const m = dkFolioMap(mk(8, { 3: { mode: 'ancre', start: 10 } }), STD);
  ok(m.get(2) === 2 && m.get(3) === 10 && m.get(4) === 11 && m.get(8) === 15, 'ancre p3=10 : la suite recoule (11…15)');
}
{ // Ancre 0 (le cas L'Épaulette posé à la main sur C2)
  const m = dkFolioMap(mk(4, { 2: { mode: 'ancre', start: 0 } }), { cover_unnumbered: 1, first_folio: 5 });
  ok(m.get(2) === 0 && m.get(3) === 1, 'ancre 0 sur p2 : 0 puis 1 (le départ publication est battu)');
}
{ // Une ancre sur la page 1 gagne sur cover_unnumbered
  const m = dkFolioMap(mk(4, { 1: { mode: 'ancre', start: 7 } }), EPA);
  ok(m.get(1) === 7 && m.get(2) === 8, 'ancre p1 : le réglage explicite bat la couverture par défaut');
}
{ // Hors-num ne consomme pas de numéro (comme la couverture)
  const m = dkFolioMap(mk(4, { 2: { mode: 'hors' } }), STD);
  ok(m.get(1) === 1 && m.get(2) === null && m.get(3) === 2, 'hors-num au milieu : p3 reprend le fil (2)');
}
{ // Ancre sans start lisible → dégrade en automatique
  const m = dkFolioMap(mk(4, { 3: { mode: 'ancre', start: null } }), STD);
  ok(m.get(3) === 3 && m.get(4) === 4, 'ancre sans numéro : traitée comme automatique');
}
{ // Pages livrées en désordre → même carte
  const pages = mk(6, { 5: { mode: 'ancre', start: 20 } }).reverse();
  const m = dkFolioMap(pages, STD);
  ok(m.get(5) === 20 && m.get(6) === 21 && m.get(2) === 2, 'pages en désordre : la carte trie par n');
}
{ // Étiquettes longues (fiches) et hors de la map (fallback formule)
  ok(dkHorsNumLabel(1, 68) === 'Couverture' && dkHorsNumLabel(2, 68) === '2ᵉ de couverture'
    && dkHorsNumLabel(67, 68) === '3ᵉ de couverture' && dkHorsNumLabel(68, 68) === '4ᵉ de couverture'
    && dkHorsNumLabel(10, 68) === 'Hors numérotation', 'dkHorsNumLabel : 5 positions');
  ok(dkHorsNumShort(10, 68) === 'hors num.', 'dkHorsNumShort : générique au milieu');
  ok(dkFolio(99, STD, mk(4)) === 99, 'n inconnu de la carte : retombe sur la formule');
}

/* ── 2 · E2E worker ───────────────────────────────────────────── */
const API = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
const A = jwt({ sub: 'folio-owner', owner: 'Stéphane', email: 'owner@folio.dk' });
const B = jwt({ sub: 'folio-membre', owner: 'Rédactrice', email: 'membre@folio.dk' });
const C = jwt({ sub: 'folio-tiers', owner: 'Intrus', email: 'tiers@folio.dk' });
async function call(token, path, opts = {}) {
  const res = await fetch(API + '/api/desk' + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const pageN = (d, n) => (d.data.pages || []).find(p => p.n === n);

console.log('\ndesK — folio par page · E2E sur', API, '\n');

let r = await call(A, '/publication', { method: 'POST', body: { name: 'Revue Folio ' + Date.now() } });
ok(r.status === 200, 'publication créée', r.data);
const pubId = r.data.publication.id;
r = await call(A, '/publication/' + pubId + '/issue', { method: 'POST', body: { num: '1', pages: 8, jalons: {} } });
const issueId = r.data.issue.id;
r = await call(A, '/issue/' + issueId);
const p3 = pageN(r, 3), p8 = pageN(r, 8);
ok(p3 && Object.prototype.hasOwnProperty.call(p3, 'folio_mode'), 'PAGE_COLS sert folio_mode/folio_start (NULL par défaut)', p3);

// L'owner sort la 4ᵉ de couv de la numérotation, impose un départ sur p3
r = await call(A, '/page/' + p8.id + '/folio', { method: 'POST', body: { mode: 'hors' } });
ok(r.status === 200, 'owner : page 8 hors numérotation (200)');
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'ancre', start: 5 } });
ok(r.status === 200, 'owner : ancre 5 sur la page 3 (200)');
r = await call(A, '/issue/' + issueId);
ok(pageN(r, 8).folio_mode === 'hors' && pageN(r, 3).folio_mode === 'ancre' && pageN(r, 3).folio_start === 5,
  'le payload issue porte les réglages', { p8: pageN(r, 8), p3: pageN(r, 3) });
{ // La logique partagée lit le payload RÉEL du worker tel quel
  const pub = { cover_unnumbered: 0, first_folio: 1 };
  const m = dkFolioMap(r.data.pages, pub);
  ok(m.get(3) === 5 && m.get(4) === 6 && m.get(8) === null, 'dkFolioMap sur le payload worker : 5, 6… et 4ᵉ de couv hors-num');
}

// Gates : le MEMBRE lit mais ne renumérote pas (owner seul) ; le tiers rien
await call(A, '/publication/' + pubId + '/invite', { method: 'POST', body: { email: 'membre@folio.dk' } });
r = await call(B, '/bootstrap');
ok((r.data.publications || []).some(p => p.id === pubId), 'invitation du membre acceptée au bootstrap');
r = await call(B, '/issue/' + issueId);
ok(r.status === 200, 'le membre lit le numéro (le tenant n’est pas en cause)');
r = await call(B, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'auto' } });
ok(r.status === 403, 'le membre ne renumérote PAS (403 — décision du maquettiste, owner seul)');
r = await call(C, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'auto' } });
ok(r.status === 403, 'un tiers est refusé (403)');

// Validation
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'pagaille' } });
ok(r.status === 400, 'mode inconnu → 400');
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'ancre' } });
ok(r.status === 400, 'ancre sans numéro → 400');
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'ancre', start: 2001 } });
ok(r.status === 400, 'ancre 2001 → 400 (borne)');
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'ancre', start: -1 } });
ok(r.status === 400, 'ancre négative → 400');

// Retour à l'automatique = colonnes remises à NULL
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'auto' } });
r = await call(A, '/issue/' + issueId);
ok(pageN(r, 3).folio_mode === null && pageN(r, 3).folio_start === null, 'auto : réglage effacé (NULL/NULL)');

// Le folio est accroché à la POSITION : un move du contenu ne l'emporte pas
r = await call(A, '/page/' + pageN(r, 2).id + '/folio', { method: 'POST', body: { mode: 'ancre', start: 30 } });
r = await call(A, '/issue/' + issueId + '/move', { method: 'POST', body: { from: [2], to: 6 } });
ok(r.status === 200, 'move : le contenu de la p2 part en p5', r.data);
r = await call(A, '/issue/' + issueId);
ok(pageN(r, 2).folio_mode === 'ancre' && pageN(r, 2).folio_start === 30 && pageN(r, 5).folio_mode === null,
  'l’ancre RESTE sur la position 2 (la structure du fascicule ne suit pas le contenu)');

// Le resize garde la 4ᵉ de couv marquée : elle glisse avec sa page
r = await call(A, '/issue/' + issueId + '/resize', { method: 'POST', body: { pages: 10 } });
ok(r.status === 200, 'resize 8 → 10 pages', r.data);
r = await call(A, '/issue/' + issueId);
ok(pageN(r, 10).folio_mode === 'hors' && pageN(r, 8).folio_mode === null && pageN(r, 9).folio_mode === null,
  'la 4ᵉ de couv « hors-num » reste la DERNIÈRE page (n=10), les vides insérées sont automatiques');

// Numéro imprimé : la numérotation ne bouge plus
r = await call(A, '/issue/' + issueId, { method: 'PATCH', body: { status: 'imprime' } });
ok(r.status === 200, 'rituel de bouclage joué (numéro imprimé)');
r = await call(A, '/page/' + p3.id + '/folio', { method: 'POST', body: { mode: 'hors' } });
ok(r.status === 400, 'numéro imprimé → 400, la numérotation est figée');

console.log(`\n${pass} ✓ · ${fail} ✗\n`);
process.exit(fail ? 1 : 0);
