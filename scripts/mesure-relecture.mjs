/* ═══════════════════════════════════════════════════════════════
   desK DK-9 — « la relecture tenue à sa promesse »

   Le modal de relecture affiche, en toutes lettres :
     « Relecture — orthographe, grammaire, typographie.
       Vos paragraphes sont gardés, chaque correction est surlignée. »

   (Libellé arrêté le 2026-08-05 D'APRÈS ce banc. L'ancien promettait
   « les mots de l'auteur sont préservés » : mesuré vrai 37 fois sur 38
   sur de vrais papiers, donc faux.)

   La tuyauterie est prouvée depuis DK-7 (la commande part, la réponse
   se lit, le texte se réécrit). Ce qui n'a JAMAIS été vérifié, c'est la
   deuxième phrase : est-ce que Mistral préserve effectivement les mots
   de l'auteur, ou est-ce qu'il réécrit ?

   Ce script MESURE, il ne devine pas. Il passe de vrais textes dans le
   VRAI chemin de production (mêmes paramètres que `app/desk.js`), puis
   classe chaque correction :

     · typographie   — accents, apostrophes, guillemets, ponctuation.
                       Le mot est le même une fois normalisé.
     · orthographe   — le mot change peu (distance ≤ 2) : accord, faute.
     · réécriture    — un autre mot, une autre tournure. ⚠ C'est CELUI-LÀ
                       qui casse la promesse.
     · ajout/retrait — le prompt système interdit d'ajouter ou de retirer
                       quoi que ce soit. ⚠ Casse la promesse aussi.

   Plus trois contrôles durs : noms propres, chiffres et dates doivent
   ressortir intacts (le prompt le promet explicitement).

   ⚠ NON DÉTERMINISTE ET FACTURÉ : chaque texte = un vrai appel Mistral,
     pris sur l'enveloppe IA du compte. Ce script n'est donc PAS dans
     `npm test`. On le lance à la main, quand on veut re-mesurer (par
     exemple après un changement de modèle ou de prompt système).

   ── Lancer ──────────────────────────────────────────────────────
   1. Le worker (le binding AI tape le VRAI Workers AI même en --local) :
        cd workers && npx wrangler dev --local -c wrangler.dktest.toml \
          --port 8799 --var KS_JWT_SECRET:dk2-test-secret \
          --var "KS_ALLOWED_ORIGIN:*"
   2. Les textes : un fichier .txt par contribution, dans le dossier
      passé en argument (défaut `_design-lab/relecture-dk9/`).
   3. node scripts/mesure-relecture.mjs [dossier]
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API    = process.env.DK_API || 'http://127.0.0.1:8799';
const SECRET = process.env.DK_JWT_SECRET || 'dk2-test-secret';
const DOSSIER = process.argv[2] || '_design-lab/relecture-dk9';
// Reclasser sans rappeler le modèle (met au point le banc, pas la mesure).
const HORS_LIGNE = process.env.MESURE_HORS_LIGNE === '1';

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iat: now, exp: now + 3600, ...claims }));
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest())}`;
}
// plan ADMIN = quota illimité (ghost-quota.js) : on mesure le modèle, pas le quota.
const TOKEN = jwt({ sub: 'dk9-mesure', plan: 'ADMIN', owner: 'Banc DK-9', email: 'dk9@test.dk' });

const gris = s => `\x1b[2m${s}\x1b[0m`;
const gras = s => `\x1b[1m${s}\x1b[0m`;
const vert = s => `\x1b[32m${s}\x1b[0m`;
const ambre = s => `\x1b[33m${s}\x1b[0m`;
const rouge = s => `\x1b[31m${s}\x1b[0m`;

/* ── Le comparatif mot à mot ────────────────────────────────────
   COPIE VERBATIM de `_diffMots` (app/ghostwriter.js) — volontaire.
   Le chiffre que ce banc annonce doit être EXACTEMENT celui que la
   rédactrice verra dans le modal. Réimplémenter « en mieux » ici
   mesurerait autre chose que ce qu'elle a sous les yeux. */
const DIFF_MAX_MOTS = 4000;
function _diffMots(avant, apres) {
  const decoupe = s => String(s || '').split(/(\s+)/).filter(x => x !== '');
  const a = decoupe(avant), b = decoupe(apres);
  const neutraliseBlancs = ps => ps.map(p => (p.t !== '=' && /^\s+$/.test(p.mot)) ? { t: '=', mot: p.mot } : p);
  if (!a.length) return neutraliseBlancs(b.map(mot => ({ t: '+', mot })));
  if (a.length > DIFF_MAX_MOTS || b.length > DIFF_MAX_MOTS) return b.map(mot => ({ t: '=', mot }));
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: '=', mot: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: '-', mot: a[i] }); i++; }
    else { out.push({ t: '+', mot: b[j] }); j++; }
  }
  while (i < n) out.push({ t: '-', mot: a[i++] });
  while (j < m) out.push({ t: '+', mot: b[j++] });
  return neutraliseBlancs(out);
}

/* ── Classer une correction ─────────────────────────────────────
   « Normaliser » = ce qu'un correcteur typographique a le droit de
   toucher sans qu'on puisse dire qu'il a changé le mot de l'auteur :
   accents, apostrophes droites/courbes, guillemets, espaces (y compris
   insécables), ponctuation collée, casse. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')      // accents
    .replace(/[’‘‚‛]/g, "'").replace(/[«»“”„]/g, '"')      // apostrophes, guillemets
    .replace(/[   ]/g, ' ')                 // espaces insécables/fines
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[.,;:!?()[\]"']/g, '')                       // ponctuation
    .toLowerCase().trim();
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* Regroupe le diff en « hunks » : une suite de retraits suivie d'une
   suite d'ajouts au même endroit = UNE correction, pas deux.

   ⚠ Les blancs ne ferment PAS un hunk. `_diffMots` découpe sur les espaces
   et neutralise les blancs : une correction typographique qui change le
   nombre de mots — « 6h30 » → « 6 h 30 » (espaces insécables, la règle
   française) — arrive donc en trois morceaux séparés par des espaces « = ».
   Les compter séparément les faisait passer pour une réécriture PLUS deux
   ajouts : trois accusations pour une correction irréprochable. C'est le
   premier faux positif qu'a produit ce banc, le 2026-08-05. */
function hunks(diff) {
  const out = [];
  let cur = null, enAttente = [];
  for (const p of diff) {
    const blanc = /^\s+$/.test(p.mot);
    if (p.t === '=') {
      if (!cur) continue;
      if (blanc) { enAttente.push(p.mot); continue; }   // peut-être au milieu d'un hunk
      out.push(cur); cur = null; enAttente = [];
      continue;
    }
    if (!cur) cur = { moins: [], plus: [] };
    // Le blanc traversé appartenait bien au hunk : il compte des deux côtés.
    if (enAttente.length) { cur.moins.push(...enAttente); cur.plus.push(...enAttente); enAttente = []; }
    (p.t === '-' ? cur.moins : cur.plus).push(p.mot);
  }
  if (cur) out.push(cur);
  return out.filter(h => h.moins.some(x => x.trim()) || h.plus.some(x => x.trim()));
}

/* Comparaison SANS les espaces NI les traits d'union. Deux raisons, toutes
   deux constatées sur de vrais textes le 2026-08-05 :
   · « 6h30 » → « 6 h 30 » : la règle typographique française, pas un mot
     changé — mais le découpage en mots la faisait passer pour trois écarts.
   · « élèves officiers » → « élèves-officiers » : souder un nom composé est
     une correction ORTHOGRAPHIQUE. La compter comme une réécriture accusait
     le modèle d'avoir changé les mots de l'auteur alors qu'il l'avait
     corrigé — et fausser la mesure DANS CE SENS-LÀ est le pire des travers :
     on finirait par relâcher une consigne qui n'avait rien fait de mal. */
const colle = arr => arr.join('').replace(/-/g, '');
function classe(h) {
  const a = h.moins.filter(x => x.trim()), b = h.plus.filter(x => x.trim());
  const na = a.map(norm).filter(Boolean), nb = b.map(norm).filter(Boolean);
  if (colle(na) === colle(nb)) return 'typographie';
  if (!a.length) return 'ajout';
  if (!b.length) return 'retrait';
  // Même découpage en mots → on compare mot à mot.
  if (na.length === nb.length && na.every((x, i) => lev(x, nb[i]) <= 2)) return 'orthographe';
  // Découpage différent (mot composé soudé ou dessoudé) → on compare la suite
  // de lettres : « décors mi Manhattan » → « décor mi-Manhattan » = un « s ».
  if (lev(colle(na), colle(nb)) <= 2) return 'orthographe';
  return 'reecriture';
}

/* Contrôles durs : ce que le prompt système promet nommément de garder
   — « faits, dates, montants, noms propres ». On vérifie que chaque
   jeton de ce genre présent à l'entrée ressort à la sortie. */
function jetonsDurs(txt) {
  const s = String(txt || '');
  const propres = (s.match(/(?<![.!?]\s|^)\b[A-ZÉÈÊÀÂÔÎÛÇ][\wÀ-ÿ'’-]{2,}/g) || []);
  const nombres = (s.match(/\d[\d  .,\/-]*/g) || []).map(x => x.trim()).filter(x => x.length > 0);
  return { propres: [...new Set(propres)], nombres: [...new Set(nombres.map(n => n.replace(/[\s ]/g, '')))] };
}

async function relire(texte) {
  const res = await fetch(API + '/api/ghostwriter/rewrite', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    // EXACTEMENT ce que `app/desk.js` envoie (_bindPasserelles → openGhostwriterChained).
    body: JSON.stringify({ text: texte, action: 'improve', lengthTarget: 'keep', variants: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`HTTP ${res.status} — ${data.error || 'sans message'}`);
  const v = (data.variants || [])[0];
  if (!v || !v.text) throw new Error('réponse sans texte exploitable');
  return { texte: v.text, model: data.model, usage: data.usage };
}

const mots = s => String(s || '').split(/\s+/).filter(Boolean).length;
/* La mise en paragraphes est un contrôle À PART, et il a fallu ce banc pour
   s'en apercevoir : le comparatif mot à mot du modal NEUTRALISE les blancs
   (`neutraliseBlancs`), donc un article rendu en un seul bloc y apparaît
   « sans correction ». Aucun œil ne pouvait l'attraper — il fallait compter. */
const paragraphes = s => String(s || '').trim().split(/\n\s*\n/).filter(p => p.trim()).length;

async function main() {
  const dir = path.resolve(DOSSIER);
  if (!fs.existsSync(dir)) {
    console.error(`Dossier introuvable : ${dir}\nPosez-y un fichier .txt par contribution, puis relancez.`);
    process.exit(2);
  }
  const fichiers = fs.readdirSync(dir)
    // Les .relu.txt sont les SORTIES du banc : les relire comme des sources
    // mesurerait la relecture d'une relecture.
    .filter(f => f.endsWith('.txt') && !f.endsWith('.relu.txt')).sort();
  if (!fichiers.length) {
    console.error(`Aucun .txt dans ${dir}. Un fichier = une contribution.`);
    process.exit(2);
  }

  console.log(gras('desK DK-9 — ce que la relecture fait VRAIMENT au texte d\'un auteur'));
  console.log(gris(`${API} · ${fichiers.length} texte(s) · dossier ${DOSSIER}\n`));

  const total = { typographie: 0, orthographe: 0, reecriture: 0, ajout: 0, retrait: 0 };
  const alertes = [];

  for (const f of fichiers) {
    const source = fs.readFileSync(path.join(dir, f), 'utf8').trim();
    const cache = path.join(dir, f.replace(/\.txt$/, '.relu.txt'));
    process.stdout.write(gras(`▶ ${f}`) + gris(` (${mots(source)} mots)`) + ' … ');
    let out;
    if (HORS_LIGNE && fs.existsSync(cache)) {
      // Reclasser une mesure déjà payée : mettre au point le classement des
      // corrections ne doit pas coûter un appel modèle de plus à chaque essai.
      out = { texte: fs.readFileSync(cache, 'utf8').trim(), model: '(relu en cache, hors ligne)' };
    } else {
      try { out = await relire(source); }
      catch (e) { console.log(rouge('ÉCHEC — ' + e.message)); alertes.push(`${f} : ${e.message}`); continue; }
    }
    console.log(gris(out.model || 'modèle inconnu'));

    const diff = _diffMots(source, out.texte);
    const nDiff = diff.filter(p => p.t !== '=').length;   // le chiffre du modal
    const hs = hunks(diff);
    const par = { typographie: [], orthographe: [], reecriture: [], ajout: [], retrait: [] };
    for (const h of hs) par[classe(h)].push(h);
    for (const k of Object.keys(total)) total[k] += par[k].length;

    const dm = mots(out.texte) - mots(source);
    const pSrc = paragraphes(source), pOut = paragraphes(out.texte);
    console.log(`   ${gris('longueur')} ${mots(source)} → ${mots(out.texte)} mots (${dm >= 0 ? '+' : ''}${dm}) · ${gris('le modal affichera')} ${nDiff} correction(s)`);
    if (pOut === pSrc) {
      console.log(`   ${vert('  ✓')} mise en paragraphes intacte ${gris(`(${pSrc})`)}`);
    } else {
      console.log(`   ${rouge('  ⚠')} PARAGRAPHES : ${pSrc} → ${pOut} — l'article ne revient pas dans sa forme`);
      alertes.push(`${f} : paragraphes ${pSrc} → ${pOut}`);
    }
    const ligne = (k, lbl, couleur) => {
      const n = par[k].length;
      console.log(`   ${couleur(String(n).padStart(3))} ${lbl}`);
      // On montre les cas qui cassent la promesse, pas les autres : c'est
      // là-dessus qu'il faut trancher, le reste est le travail attendu.
      if (n && (k === 'reecriture' || k === 'ajout' || k === 'retrait')) {
        for (const h of par[k].slice(0, 8)) {
          const av = h.moins.join('').trim(), ap = h.plus.join('').trim();
          console.log(gris(`        « ${av || '∅'} » → « ${ap || '∅'} »`));
        }
        if (n > 8) console.log(gris(`        … et ${n - 8} autre(s)`));
      }
    };
    ligne('typographie', 'typographie (accents, apostrophes, guillemets, ponctuation)', vert);
    ligne('orthographe', 'orthographe / accord (le mot reste le même)', vert);
    ligne('reecriture', 'RÉÉCRITURE — un autre mot, une autre tournure', rouge);
    ligne('ajout', 'AJOUT — le prompt l\'interdit', rouge);
    ligne('retrait', 'RETRAIT — le prompt l\'interdit', rouge);

    const dur = jetonsDurs(source);
    const sortie = out.texte;
    const nsortie = norm(sortie);
    const propresPerdus = dur.propres.filter(p => !sortie.includes(p) && !nsortie.includes(norm(p)));
    const nombresPerdus = dur.nombres.filter(n => !sortie.replace(/[\s ]/g, '').includes(n));
    if (propresPerdus.length) { console.log(`   ${rouge('  ⚠')} noms propres disparus : ${propresPerdus.join(', ')}`); alertes.push(`${f} : noms propres perdus (${propresPerdus.join(', ')})`); }
    if (nombresPerdus.length) { console.log(`   ${rouge('  ⚠')} chiffres/dates disparus : ${nombresPerdus.join(', ')}`); alertes.push(`${f} : chiffres perdus (${nombresPerdus.join(', ')})`); }
    if (!propresPerdus.length && !nombresPerdus.length) {
      console.log(`   ${vert('  ✓')} noms propres, chiffres et dates : tous intacts ${gris(`(${dur.propres.length} + ${dur.nombres.length} contrôlés)`)}`);
    }
    console.log();
    if (!HORS_LIGNE) fs.writeFileSync(cache, out.texte + '\n');
  }

  /* ── Le verdict ────────────────────────────────────────────────
     La promesse porte sur les MOTS. Corriger l'orthographe et la
     typographie, c'est le travail demandé. Substituer un mot, ajouter
     ou retirer quoi que ce soit, c'est la casser. */
  const casse = total.reecriture + total.ajout + total.retrait;
  const attendu = total.typographie + total.orthographe;
  console.log(gras('── Verdict ────────────────────────────────────────────────'));
  console.log(`   travail attendu (typo + orthographe) : ${vert(String(attendu))}`);
  console.log(`   promesse entamée (réécriture/ajout/retrait) : ${casse ? rouge(String(casse)) : vert('0')}`);
  if (alertes.length) { console.log(rouge('\n   Alertes :')); for (const a of alertes) console.log(rouge('   · ' + a)); }
  console.log();
  if (!casse && !alertes.length) {
    console.log(vert('   Le modèle n\'a fait que corriger : la promesse du modal TIENT sur ce corpus.'));
  } else {
    console.log(ambre('   La promesse ne tient pas telle quelle. Deux issues (DESK_PROD_SPRINTS §DK-9) :'));
    console.log(ambre('   resserrer la consigne système (workers/src/routes/ghostwriter.js, branche solo),'));
    console.log(ambre('   ou changer le libellé du modal (app/ghostwriter.js) pour dire ce qui se passe vraiment.'));
  }
  console.log(gris('\n   Les textes corrigés sont écrits à côté des sources (*.relu.txt).'));
  process.exit(casse || alertes.length ? 1 : 0);
}

main().catch(e => { console.error('Mesure interrompue :', e); process.exit(1); });
